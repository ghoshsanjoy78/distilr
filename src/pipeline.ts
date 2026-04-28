import { Stage, STAGES } from "./store/schemas.js";
import {
  readState,
  markStageComplete,
  nextStage,
  findUnfinishedProjects,
} from "./store/project.js";
import type { Bus } from "./tui/bus.js";

function progressLabel(last: Stage | "none"): string {
  if (last === "none") return "not started";
  const idx = STAGES.indexOf(last);
  const next = STAGES[idx + 1];
  return `${idx + 1}/${STAGES.length} done${next ? ` · next: ${next}` : ""}`;
}

import { stageTarget } from "./stages/01-target.js";
import { stageRecon } from "./stages/02-recon.js";
import { stageLogin } from "./stages/03-login.js";
import { stageExplore } from "./stages/04-explore.js";
import { stageSynthesize } from "./stages/05-synthesize.js";
import { stageWizard } from "./stages/06-wizard.js";
import { stageArchitect } from "./stages/07-architect.js";
import { stageEmit } from "./stages/08-emit.js";
import { stageBuild, BuildIncomplete } from "./stages/09-build.js";

async function runStage(stage: Stage, slug: string, bus: Bus): Promise<void> {
  bus.emit({ kind: "stage-change", stage });
  switch (stage) {
    case "target":
      throw new Error("target stage handled by runFromStart");
    case "recon":
      await stageRecon(slug, bus);
      break;
    case "login":
      await stageLogin(slug, bus);
      break;
    case "explore":
      await stageExplore(slug, bus);
      break;
    case "synthesize":
      await stageSynthesize(slug, bus);
      break;
    case "wizard":
      await stageWizard(slug, bus);
      break;
    case "architect":
      await stageArchitect(slug, bus);
      break;
    case "emit":
      await stageEmit(slug, bus);
      break;
    case "implement":
      await stageBuild(slug, bus);
      break;
  }
  await markStageComplete(slug, stage);
  bus.emit({ kind: "stage-complete", stage });
}

type BuildIntent = "yes" | "later";

/**
 * Stage 9 (build) is opt-in. If the user picks "later", the pipeline
 * exits cleanly with the spec on disk. They can resume any time with
 * `./distilr build <slug>`.
 */
async function askToBuild(slug: string, bus: Bus): Promise<BuildIntent> {
  const outputDir = `projects/${slug}/output`;
  const description = `✓ Build spec is ready at ${outputDir}/

Take a moment to review the docs before deciding what's next:
  • ARCHITECTURE.md           — system layout
  • docs/PLANS.md              — phase overview (read this first)
  • docs/exec-plans/active/    — per-phase execution specs
  • docs/product-specs/        — per-feature specs
  • docs/DESIGN.md             — design tokens (colors, fonts, spacing)
  • docs/PRODUCT_SENSE.md      — target user, differentiation, voice
  • SETUP.md                   — env vars / API keys you'll need

Edit any of these directly if something looks off — the markdown IS
the spec your AI coder will follow.

distilr can walk you through a setup checklist (paste env vars into
.env.local — never sent to any LLM) and a deck of copy-paste prompts
(one per phase) you'll run in your AI coder of choice (Claude Code,
Codex, Cursor, v0, …). Or you can stop here and ship the spec however
you like.`;

  const choice = await bus.askSelect<BuildIntent>(
    "Walk through the setup + build prompts now?",
    [
      {
        label: "Yes — show me the setup checklist + phase prompts",
        value: "yes",
      },
      {
        label: `Later (run \`./distilr build ${slug}\` when I'm ready)`,
        value: "later",
      },
    ],
    { description },
  );
  return choice;
}

export async function runFromStart(bus: Bus): Promise<void> {
  // Scope-framing welcome — sets expectations before stage 1. Soft nudge,
  // doesn't block. Reinforced by the stage-1 LLM scope check, post-recon
  // warning, and wizard caps.
  bus.emit({
    kind: "warning",
    text: "distilr produces an MVP-sized build spec inspired by the source SaaS — not a full reproduction. For best results, target a single-purpose product with a focused feature surface, rather than a sprawling enterprise platform or creative-app suite. You'll be asked to narrow scope at multiple points.\n",
  });

  // If there are in-progress projects, let the user pick one to resume
  // before falling through to the new-project flow.
  const unfinished = await findUnfinishedProjects();
  if (unfinished.length > 0) {
    const picked = await bus.askSelect<string>(
      "You have in-progress projects. Continue one, or start a new project?",
      [
        ...unfinished.map((p) => ({
          label: `${p.saasName} (${p.slug}) — ${progressLabel(p.lastCompletedStage)}`,
          value: `resume:${p.slug}`,
        })),
        { label: "Start a new project", value: "new" },
      ],
    );
    if (picked.startsWith("resume:")) {
      const slug = picked.slice("resume:".length);
      await runFromResume(slug, bus);
      return;
    }
    // fall through to the new-project flow
  }

  bus.emit({ kind: "stage-change", stage: "target" });
  const { slug } = await stageTarget(bus);
  await markStageComplete(slug, "target");
  bus.emit({ kind: "stage-complete", stage: "target" });

  for (const stage of STAGES) {
    if (stage === "target") continue;
    if (stage === "implement") {
      const intent = await askToBuild(slug, bus);
      if (intent === "later") {
        bus.emit({
          kind: "info",
          text: `Spec ready at projects/${slug}/output/. Run \`./distilr build ${slug}\` when you're ready to walk through setup + prompts.`,
        });
        return;
      }
      // Special-case the implement stage: stageBuild throws
      // BuildIncomplete if the user picks "Stop here" mid-deck. We
      // catch that, print a friendly hint, and return without
      // markStageComplete so the project stays in the in-progress
      // list and the user can pick up at the next unseen prompt.
      try {
        await runStage(stage, slug, bus);
      } catch (e) {
        if (e instanceof BuildIncomplete) return;
        throw e;
      }
      continue;
    }
    await runStage(stage, slug, bus);
  }
}

export async function runFromResume(slug: string, bus: Bus): Promise<void> {
  const state = await readState(slug);
  bus.setProject(state.slug, state.saasName);
  let next = nextStage(state);
  if (next == null) {
    bus.emit({
      kind: "info",
      text: "Project is already complete. Re-emit by deleting state.json's lastCompletedStage.",
    });
    return;
  }
  if (next === "target") {
    await markStageComplete(slug, "target");
    next = nextStage(await readState(slug));
  }
  while (next != null) {
    if (next === "implement") {
      // If buildProgress is already set, the user has been here
      // before — resume directly into stageBuild without re-asking.
      // Otherwise prompt yes/later first.
      const live = await readState(slug);
      if (!live.buildProgress) {
        const intent = await askToBuild(slug, bus);
        if (intent === "later") {
          bus.emit({
            kind: "info",
            text: `Spec ready at projects/${slug}/output/. Run \`./distilr build ${slug}\` when you're ready.`,
          });
          return;
        }
      }
      // Same BuildIncomplete catch as in runFromStart — let the user
      // walk away mid-deck without their project disappearing from
      // the in-progress list.
      try {
        await runStage(next, slug, bus);
      } catch (e) {
        if (e instanceof BuildIncomplete) return;
        throw e;
      }
      next = nextStage(await readState(slug));
      continue;
    }
    await runStage(next, slug, bus);
    next = nextStage(await readState(slug));
  }
}
