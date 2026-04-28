// Stage 9: build — the user-facing "what now?" stage. Drives the user
// through:
//
//   1. The architect-emitted SETUP CHECKLIST. For each item, a TUI
//      prompt asks them to paste a value (which lands in
//      projects/<slug>/output/.env.local locally — never sent to any
//      LLM) or skip for later. Items already present in .env.local from
//      a prior session are auto-skipped.
//
//   2. The PROMPT DECK. One markdown prompt per step (onboarding,
//      one per phase, final wrap-up). Each prompt is also written to
//      projects/<slug>/output/prompts/NN-name.md so the user can come
//      back to it in their editor. The TUI shows the current prompt in
//      a copy-friendly box; the user copies it into their AI coder
//      (Claude Code, Codex, Cursor, v0, …), runs it externally, comes
//      back, and hits "Next prompt" to advance.
//
// distilr is NOT in the loop on whether the AI coder succeeds — we
// trust the user. State is persisted to state.json's `buildProgress`
// so a killed session resumes at the next unseen prompt.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readArchitectOutput,
  readSpec,
  readState,
  writeState,
} from "../store/project.js";
import type {
  ArchitectOutput,
  ProductSpec,
  SetupChecklistItem,
} from "../store/schemas.js";
import { ensureOutputDirs } from "../output/scaffold.js";
import {
  buildPromptDeck,
  type BuildPrompt,
} from "../output/prompts.js";
import {
  readProjectEnv,
  writeProjectEnv,
} from "../setup/project-env.js";
import { copyToClipboard } from "../tui/clipboard.js";
import type { Bus } from "../tui/bus.js";

/**
 * Thrown when the user picks "Stop here" partway through the prompt
 * deck. The pipeline catches this, emits a "resume with ./distilr
 * build <slug>" hint, and returns WITHOUT marking the implement
 * stage complete — so the project stays in the in-progress list and
 * `lastPromptIndex` resumes correctly on next entry.
 */
export class BuildIncomplete extends Error {
  constructor(public readonly slug: string) {
    super(`build walk-through for ${slug} stopped early`);
    this.name = "BuildIncomplete";
  }
}

interface BuildState {
  /** ISO timestamp set when the last setup item is acknowledged (paste or skip). */
  setupCompletedAt: string | null;
  /** -1 = no prompts shown yet. Otherwise the index of the most-recently-acknowledged prompt. */
  lastPromptIndex: number;
  /** ISO timestamp set on first entry. */
  startedAt: string;
}

async function loadBuildState(slug: string): Promise<BuildState> {
  const state = await readState(slug);
  const existing = state.buildProgress;
  if (existing) {
    return {
      setupCompletedAt: existing.setupCompletedAt,
      lastPromptIndex: existing.lastPromptIndex,
      startedAt: existing.startedAt,
    };
  }
  const fresh: BuildState = {
    setupCompletedAt: null,
    lastPromptIndex: -1,
    startedAt: new Date().toISOString(),
  };
  state.buildProgress = fresh;
  await writeState(state);
  return fresh;
}

async function persistBuildState(slug: string, bs: BuildState): Promise<void> {
  const state = await readState(slug);
  state.buildProgress = bs;
  await writeState(state);
}

// ─── Setup checklist gate ───────────────────────────────────────────────

/**
 * Show the user the full list of env vars / accounts they'll need
 * BEFORE we start asking for them one at a time. Two outcomes:
 *
 *   - "enter" → run walkSetupChecklist, asking for each value one
 *               at a time.
 *   - "skip"  → bypass the per-item walk; user will edit .env.local
 *               manually using SETUP.md as a reference. We still
 *               mark setupCompletedAt so the gate doesn't re-fire on
 *               resume (the user explicitly opted out).
 *
 * If the architect emitted no setup items at all, returns "skip"
 * without showing a modal — there's nothing to ask about.
 */
async function setupGate(
  slug: string,
  items: readonly SetupChecklistItem[],
  bus: Bus,
): Promise<"enter" | "skip"> {
  if (items.length === 0) return "skip";

  const alreadySet = readProjectEnv(slug);
  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);

  const renderItem = (i: SetupChecklistItem): string => {
    const has =
      alreadySet[i.envVar] && alreadySet[i.envVar].trim().length > 0;
    const mark = has ? "✓" : "·";
    return `  ${mark} ${i.name}  (${i.envVar})`;
  };

  const lines: string[] = [];
  lines.push(
    "This project needs the following accounts / API keys to run:",
  );
  lines.push("");
  if (required.length > 0) {
    lines.push("Required (Phase 0 / Phase 1 needs these):");
    for (const i of required) lines.push(renderItem(i));
  }
  if (optional.length > 0) {
    if (required.length > 0) lines.push("");
    lines.push("Optional (used by a later phase — fine to defer):");
    for (const i of optional) lines.push(renderItem(i));
  }
  const haveSome = items.some(
    (i) => alreadySet[i.envVar] && alreadySet[i.envVar].trim().length > 0,
  );
  if (haveSome) {
    lines.push("");
    lines.push("(✓ = already set in .env.local from a prior session)");
  }
  lines.push("");
  lines.push(
    `Pasted values land in projects/${slug}/output/.env.local locally — never sent to any LLM. SETUP.md has the full details for each key (description, where to get it).`,
  );

  return await bus.askSelect<"enter" | "skip">(
    `${items.length} env var${items.length === 1 ? "" : "s"} to set up — enter values now?`,
    [
      {
        label: "Yes — walk me through them one at a time",
        value: "enter",
      },
      {
        label: "Skip — I'll edit .env.local manually using SETUP.md",
        value: "skip",
      },
    ],
    { description: lines.join("\n") },
  );
}

// ─── Setup checklist walk-through ───────────────────────────────────────

async function walkSetupChecklist(
  slug: string,
  items: readonly SetupChecklistItem[],
  bs: BuildState,
  bus: Bus,
): Promise<void> {
  if (items.length === 0) {
    bs.setupCompletedAt = new Date().toISOString();
    await persistBuildState(slug, bs);
    return;
  }

  // Skip items already present in projects/<slug>/output/.env.local
  // from an earlier session.
  const alreadySet = readProjectEnv(slug);

  bus.emit({
    kind: "info",
    text: `Setup checklist — ${items.length} item${items.length === 1 ? "" : "s"}. Paste a value or hit Enter to skip.\n`,
  });

  for (const item of items) {
    if (alreadySet[item.envVar] && alreadySet[item.envVar].trim().length > 0) {
      bus.emit({
        kind: "info",
        text: `  ✓ ${item.name} (${item.envVar}) — already set in .env.local, skipping.`,
      });
      continue;
    }

    const description = `${item.description}

Env var: ${item.envVar}${item.signupUrl ? `\nGet it: ${item.signupUrl}` : ""}
Required: ${item.required ? "yes (Phase 0/1 needs it)" : "no (used by a later phase — fine to defer)"}`;

    const value = await bus.askInput(
      `${item.name} — paste value (or hit Enter to skip):`,
      { placeholder: description },
    );
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      bus.emit({
        kind: "info",
        text: `  ⏭ ${item.name} — skipped. Add it to .env.local manually later.`,
      });
      continue;
    }

    writeProjectEnv(slug, { [item.envVar]: trimmed });
    bus.emit({
      kind: "info",
      text: `  ✓ ${item.name} — saved to .env.local.`,
    });
  }

  bs.setupCompletedAt = new Date().toISOString();
  await persistBuildState(slug, bs);
  bus.emit({
    kind: "info",
    text: "\nSetup done. Onto the build prompts.\n",
  });
}

// ─── Prompt deck walk-through ───────────────────────────────────────────

async function writePromptsToDisk(
  promptsDir: string,
  deck: readonly BuildPrompt[],
): Promise<void> {
  for (const p of deck) {
    await writeFile(join(promptsDir, p.filename), p.body, "utf8");
  }
}

async function walkPromptDeck(
  slug: string,
  deck: readonly BuildPrompt[],
  bs: BuildState,
  bus: Bus,
): Promise<void> {
  if (deck.length === 0) return;

  // Resume at the next unseen prompt. lastPromptIndex = -1 → start at 0.
  let i = Math.max(0, bs.lastPromptIndex + 1);
  if (i >= deck.length) {
    bus.emit({
      kind: "info",
      text: "All build prompts already acknowledged. Walk-through is complete.",
    });
    return;
  }

  while (i < deck.length) {
    const p = deck[i]!;
    const isLast = i === deck.length - 1;
    const bodyLines = p.body.split("\n").length;

    // Prompt context is rendered in the MODAL DESCRIPTION (above the
    // action box) rather than the activity feed. This way fast ←/→
    // navigation doesn't spam the feed with repeated headers — the
    // current prompt info is always shown ONCE, in the modal that's
    // currently open. The activity feed only carries ephemeral
    // status (e.g. "✓ Copied prompt to clipboard").
    const promptDescription = `──── Prompt ${p.index} of ${String(deck.length).padStart(2, "0")} — ${p.title} ────

${bodyLines}-line prompt · saved to: projects/${slug}/output/prompts/${p.filename}

(use the "Copy" option below or open the file directly to read the full body)`;

    // Loop until the user advances or stops. "Copy to clipboard" is
    // an idempotent action that re-prompts so the user can copy more
    // than once if their first paste went to the wrong window.
    //
    // The user can also press ← / → at any point to rewind / advance
    // to the previous / next prompt — app.tsx handles those keys by
    // cancelling the modal with reason "prev" / "next", which we
    // catch here and translate into index moves.
    let copied = false;
    let choice: "next" | "stop" | "prev";
    while (true) {
      let c: "copy" | "next" | "stop" | "prev";
      try {
        c = await bus.askSelect<"copy" | "next" | "stop">(
          isLast
            ? copied
              ? "Last prompt. Done with the walk-through?"
              : "Last prompt. Copy it, then exit?"
            : copied
              ? "Copied. Ready for the next prompt?"
              : "Copy this prompt into your AI coder?",
          [
            {
              label: copied
                ? "Copy again to clipboard"
                : "Copy prompt to clipboard",
              value: "copy",
            },
            {
              label: isLast
                ? "Done — exit the walk-through"
                : "Next prompt (or press →)",
              value: "next",
            },
            {
              label: `Stop here — resume later with \`./distilr build ${slug}\``,
              value: "stop",
            },
          ],
          { description: promptDescription },
        );
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "prev" || msg === "next") {
          c = msg;
        } else {
          throw e;
        }
      }
      if (c === "copy") {
        copyToClipboard(p.body);
        bus.emit({
          kind: "info",
          text: "✓ Copied prompt to clipboard.",
          color: "green",
        });
        copied = true;
        continue;
      }
      choice = c;
      break;
    }

    if (choice === "prev") {
      // ← arrow: rewind. Don't move lastPromptIndex backwards — the
      // user may bounce between prompts to reread something. Just
      // walk i back; the next iteration re-renders the previous
      // prompt's modal description. No-op at i=0 (no event emitted —
      // would spam the feed on rapid keypress; the modal description
      // staying on Prompt 01 is signal enough).
      if (i > 0) i -= 1;
      continue;
    }

    bs.lastPromptIndex = i;
    await persistBuildState(slug, bs);

    if (choice === "stop") {
      bus.emit({
        kind: "info",
        text: `Stopped at prompt ${p.index}. Resume with \`./distilr build ${slug}\`.`,
      });
      // Throw so the pipeline doesn't mark stage 9 complete — that
      // would drop the project from the in-progress list.
      throw new BuildIncomplete(slug);
    }

    i += 1;
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────

export async function stageBuild(slug: string, bus: Bus): Promise<void> {
  const out: ArchitectOutput = await readArchitectOutput(slug);
  const spec: ProductSpec = await readSpec(slug);

  // Make sure the prompts/ dir exists for the on-disk write.
  const paths = await ensureOutputDirs(slug);

  const bs = await loadBuildState(slug);

  bus.emit({
    kind: "info",
    text: `Build walk-through — set up env vars, then ${out.phases.length} phase prompt${out.phases.length === 1 ? "" : "s"} to copy into your AI coder.\n`,
  });

  // 1. Setup. Two phases: a GATE that lists the keys this project
  //    needs and asks "enter now or skip?", then (if "enter") the
  //    per-item walk that actually collects the values. Both paths
  //    set setupCompletedAt so the gate doesn't re-fire on resume.
  if (!bs.setupCompletedAt) {
    const intent = await setupGate(slug, out.setupChecklist ?? [], bus);
    if (intent === "enter") {
      await walkSetupChecklist(slug, out.setupChecklist ?? [], bs, bus);
    } else {
      bs.setupCompletedAt = new Date().toISOString();
      await persistBuildState(slug, bs);
      bus.emit({
        kind: "info",
        text: "Skipped — see SETUP.md to fill in .env.local manually.\n",
      });
    }
  }

  // 2. Prompt deck. Always materialize all prompts to disk first so the
  //    user can browse them ahead of acknowledging — they may want to
  //    skim Phase 3 before starting Phase 0.
  const deck = buildPromptDeck(out, spec);
  await writePromptsToDisk(paths.prompts, deck);
  bus.emit({
    kind: "info",
    text: `Wrote ${deck.length} prompt${deck.length === 1 ? "" : "s"} to projects/${slug}/output/prompts/.`,
  });

  // 3. Walk the deck, advancing on user "Next" / stopping on "Stop".
  await walkPromptDeck(slug, deck, bs, bus);
}
