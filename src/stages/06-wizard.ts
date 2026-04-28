import { readCatalog, writeSpec } from "../store/project.js";
import { ProductSpec } from "../store/schemas.js";
import { generateAppIdeas, AppIdea } from "../agents/app-ideas.js";
import {
  classifyFeaturesStream,
  heuristicClassify,
  type Classification,
} from "../agents/feature-classifier.js";
import type { Bus } from "../tui/bus.js";

const MUST_HAVE_CAP = 8;

const PRIORITY_EXPLANATION = `MUST-HAVE → goes into the build plan as its own phase + product-spec doc. The phase is what your AI coder will ship in stage 9.

NICE-TO-HAVE → captured as a "Future" item in docs/PLANS.md. Not put into any phase. Not built unless you reclassify later.`;

// ─── Back-navigation step runner ────────────────────────────────────────
//
// The wizard is a long sequence of modal questions. Users occasionally
// hit Enter on a prompt by mistake (or want to revise an earlier
// answer); the global Esc handler in app.tsx rejects the active modal
// with the message "back" while we're in stage 6. We catch that here
// and rewind one step.
//
// Each step reads from / writes to the shared `WizState` accumulator.
// On rewind, previous answers stay in `state` and become defaults when
// the prompt re-renders. The dual-pane step also caches its `items`
// array (with the user's current column choices) so re-entering it
// doesn't re-run the AI classifier or lose work.

type IdeaChoice = { kind: "idea"; index: number } | { kind: "custom" };

interface DualListItem {
  id: string;
  label: string;
  side: "left" | "right";
  meta?: string;
  reasoning?: string;
}

interface WizState {
  ideas: AppIdea[];
  ideaChoice?: IdeaChoice;
  appName?: string;
  oneLiner?: string;
  targetUser?: ProductSpec["targetUser"];
  differentiation?: ProductSpec["differentiation"];
  dualPaneItems?: DualListItem[];
  selectedFeatures?: ProductSpec["selectedFeatures"];
  lookAndFeel?: ProductSpec["lookAndFeel"];
  techStack?: ProductSpec["techStack"];
  techStackCustom?: string;
  auth?: ProductSpec["auth"];
  hosting?: ProductSpec["hosting"];
  monetization?: ProductSpec["monetization"];
  implementer?: ProductSpec["implementer"];
}

type Step = (s: WizState) => Promise<void>;

function isBackError(e: unknown): boolean {
  return e instanceof Error && e.message === "back";
}

async function runSteps(steps: Step[], state: WizState): Promise<void> {
  let i = 0;
  while (i < steps.length) {
    try {
      await steps[i]!(state);
      i++;
    } catch (e) {
      if (!isBackError(e)) throw e;
      // At step 0 there's nothing to rewind to — re-render the same
      // prompt rather than escape out of the wizard.
      if (i > 0) i--;
    }
  }
}

// ─── Prompt helpers (loop on empty input; Esc throws "back" and
// propagates out of the loop to the step runner) ───────────────────────

async function askName(bus: Bus, defaultValue?: string): Promise<string> {
  while (true) {
    const v = await bus.askInput(
      "What should your new app be called?",
      defaultValue ? { default: defaultValue } : undefined,
    );
    const trimmed = v.trim();
    if (trimmed.length > 0) return trimmed;
  }
}

async function askDescription(
  bus: Bus,
  defaultValue?: string,
): Promise<string> {
  while (true) {
    const v = await bus.askInput(
      "One-line description of the app:",
      defaultValue ? { default: defaultValue } : undefined,
    );
    const trimmed = v.trim();
    if (trimmed.length > 0) return trimmed;
  }
}

export async function stageWizard(slug: string, bus: Bus): Promise<void> {
  const catalog = await readCatalog(slug);
  const allFeatures = catalog.categories.flatMap((c) =>
    c.features.map((f) => ({ category: c.name, ...f })),
  );

  bus.emit({
    kind: "info",
    text: `Walking through the product wizard. ${allFeatures.length} features available.`,
  });

  // Brainstorm name+description suggestions up front, before the step
  // runner. This is a long-running call; doing it inside step 0 would
  // re-run on every back-nav rewind into step 0.
  let ideas: AppIdea[] = [];
  if (allFeatures.length > 0) {
    bus.emit({ kind: "info", text: "Brainstorming a few product directions…" });
    try {
      ideas = await generateAppIdeas(catalog);
    } catch (e) {
      bus.emit({
        kind: "warning",
        text: `Couldn't generate suggestions (${(e as Error).message}). You'll write your own.`,
      });
    }
  }

  const state: WizState = { ideas };

  const steps: Step[] = [];

  // Q1: pick an idea (or "custom"). Skipped entirely if no ideas were
  // generated — askName/askDescription handle the no-suggestions path.
  if (ideas.length > 0) {
    steps.push(async (s) => {
      s.ideaChoice = await bus.askSelect<IdeaChoice>(
        "Pick a name + description, or write your own:",
        [
          ...ideas.map(
            (idea, index) =>
              ({
                label: `${idea.name} — ${idea.description}`,
                value: { kind: "idea", index } as IdeaChoice,
              }) as const,
          ),
          {
            label: "✎ Type my own name and description",
            value: { kind: "custom" } as IdeaChoice,
          },
        ],
      );
    });
  }

  // Q1b: app name. Default seeded from the picked idea (if any) or the
  // previous answer (on back-nav rewind).
  steps.push(async (s) => {
    const fromIdea =
      s.ideaChoice?.kind === "idea"
        ? s.ideas[s.ideaChoice.index]?.name
        : undefined;
    const def = s.appName ?? fromIdea;
    s.appName = await askName(bus, def);
  });

  // Q2: one-liner. Same default-seeding logic.
  steps.push(async (s) => {
    const fromIdea =
      s.ideaChoice?.kind === "idea"
        ? s.ideas[s.ideaChoice.index]?.description
        : undefined;
    const def = s.oneLiner ?? fromIdea;
    s.oneLiner = await askDescription(bus, def);
  });

  // Q3: target user.
  steps.push(async (s) => {
    s.targetUser = await bus.askSelect<ProductSpec["targetUser"]>(
      "Who's the target user, relative to the source SaaS?",
      [
        { label: "Same audience", value: "same" },
        { label: "A subset of their audience", value: "subset" },
        { label: "An adjacent audience", value: "adjacent" },
        { label: "A different audience entirely", value: "different" },
      ],
    );
  });

  // Q4: differentiation (multi-select, ≥1).
  steps.push(async (s) => {
    s.differentiation = await bus.askMultiSelect<
      ProductSpec["differentiation"][number]
    >(
      "How will your product differentiate? (pick at least one)",
      [
        { label: "Cheaper", value: "cheaper" },
        { label: "Simpler", value: "simpler" },
        { label: "Niche / vertical-specific", value: "niche" },
        { label: "Better UX", value: "better-ux" },
        { label: "Open source", value: "open-source" },
        { label: "AI-native", value: "ai-native" },
        { label: "Mobile-first", value: "mobile-first" },
      ],
      { minSelected: 1 },
    );
  });

  // Q5: dual-pane priority picker.
  //
  // First entry: open the picker IMMEDIATELY in loading mode (all
  // features shown as nice-to-have, no reasoning yet) and stream
  // classifications in. The picker ignores keyboard input until the
  // stream settles, then flips to interactive. This keeps the user
  // staring at a populated picker rather than a "Pre-classifying… 53s"
  // info line in the activity log.
  //
  // Back-nav re-entry: reuse cached items (skip classification).
  steps.push(async (s) => {
    const allFeatureContext = allFeatures.map((f) => ({
      id: f.id,
      name: f.name,
      description: f.description,
      category: f.category,
      complexity: f.complexity,
    }));

    const buildItems = (
      classifications: Classification[],
    ): DualListItem[] =>
      allFeatures.map((f) => {
        const c = classifications.find((cls) => cls.featureId === f.id);
        return {
          id: f.id,
          label: `[${f.category}] ${f.name}`,
          side: ((c?.priority ?? "nice-to-have") === "must-have"
            ? "left"
            : "right") as "left" | "right",
          meta: `complexity ${f.complexity}/5 · ${f.category}`,
          reasoning: c?.reasoning,
        };
      });

    const cached = s.dualPaneItems !== undefined;
    const initialItems: DualListItem[] = cached
      ? s.dualPaneItems!
      : buildItems([]);
    // Keep `s.dualPaneItems` in sync with what the modal shows so that
    // submission (which always reflects the latest streamed items)
    // can write user choices back without nullability gymnastics.
    s.dualPaneItems = initialItems;

    // Promise of the user's eventual submission. The picker stays
    // open while we stream the classifier into it.
    const pickerPromise = bus.askDualList({
      question: "Which features ship in your MVP?",
      description: PRIORITY_EXPLANATION,
      leftLabel: "MUST-HAVE",
      rightLabel: "NICE-TO-HAVE",
      items: initialItems,
      maxLeft: MUST_HAVE_CAP,
      minLeft: 0,
      loading: !cached,
      loadingMessage: cached
        ? undefined
        : `Pre-classifying 0/${allFeatures.length}`,
    });

    if (!cached) {
      // Capture the active modal's id right after opening it. If the
      // user back-navs while the stream is in flight, a subsequent
      // re-entry will open a NEW modal with a different id; updates
      // tagged with the old id are then dropped by the bus.
      const modalId = bus.getState().modal?.id;

      // Fire-and-forget the streaming classifier. It mutates the
      // open modal in place via bus.updateDualList. On success or
      // failure (heuristic fallback), it ends with `loading: false`
      // so the picker becomes interactive.
      void (async () => {
        try {
          const finalClassifications = await classifyFeaturesStream(
            {
              appName: s.appName!,
              oneLiner: s.oneLiner!,
              targetUser: s.targetUser!,
              differentiation: s.differentiation!,
              features: allFeatureContext,
            },
            (partial) => {
              const items = buildItems(partial);
              s.dualPaneItems = items;
              bus.updateDualList({
                id: modalId,
                items,
                loadingMessage: `Pre-classifying ${partial.length}/${allFeatures.length}`,
              });
            },
          );
          const items = buildItems(finalClassifications);
          s.dualPaneItems = items;
          bus.updateDualList({
            id: modalId,
            items,
            loading: false,
            loadingMessage: undefined,
          });
        } catch (e) {
          bus.emit({
            kind: "warning",
            text: `AI classifier failed (${(e as Error).message}). Using complexity heuristic.`,
          });
          const items = buildItems(heuristicClassify(allFeatureContext));
          s.dualPaneItems = items;
          bus.updateDualList({
            id: modalId,
            items,
            loading: false,
            loadingMessage: undefined,
          });
        }
      })();
    }

    const { leftIds, rightIds } = await pickerPromise;

    // Persist the user's column choices into the cached items so that
    // a future rewind back into this step resumes from where they were.
    const leftSet = new Set(leftIds);
    s.dualPaneItems = s.dualPaneItems.map((it) => ({
      ...it,
      side: leftSet.has(it.id) ? "left" : "right",
    }));
    s.selectedFeatures = [
      ...leftIds.map(
        (id) => ({ featureId: id, priority: "must-have" as const }),
      ),
      ...rightIds.map(
        (id) => ({ featureId: id, priority: "nice-to-have" as const }),
      ),
    ];
  });

  // Q6: look and feel.
  steps.push(async (s) => {
    s.lookAndFeel = await bus.askSelect<ProductSpec["lookAndFeel"]>(
      "Look and feel?",
      [
        { label: "Minimal modern (clean, lots of whitespace)", value: "minimal-modern" },
        { label: "Playful (rounded, friendly, color)", value: "playful" },
        { label: "Enterprise (data-dense, professional)", value: "enterprise" },
        { label: "Retro terminal (monospace, CRT vibes)", value: "retro-terminal" },
        { label: "Brutalist (raw, sharp edges)", value: "brutalist" },
        { label: "Glass dark (frosted, dark mode)", value: "glass-dark" },
      ],
    );
  });

  // Q7: tech stack (+ custom). Custom path is its own loop on empty
  // input; back-nav out of the custom prompt rewinds to the tech-stack
  // pick.
  steps.push(async (s) => {
    s.techStack = await bus.askSelect<ProductSpec["techStack"]>(
      "Tech stack preference?",
      [
        { label: "Let the architect decide", value: "let-architect-decide" },
        { label: "Next.js + Postgres", value: "nextjs-postgres" },
        { label: "SvelteKit", value: "sveltekit" },
        { label: "Rails", value: "rails" },
        { label: "Phoenix (Elixir)", value: "phoenix" },
        { label: "Django", value: "django" },
        { label: "Custom (specify)", value: "custom" },
      ],
    );
    if (s.techStack === "custom") {
      let custom = "";
      while (!custom) {
        const v = await bus.askInput("Describe your custom stack:", {
          default: s.techStackCustom,
        });
        if (v.trim().length > 0) custom = v.trim();
      }
      s.techStackCustom = custom;
    } else {
      s.techStackCustom = undefined;
    }
  });

  // Q8: auth.
  steps.push(async (s) => {
    s.auth = await bus.askSelect<ProductSpec["auth"]>("Auth method?", [
      { label: "Magic link / passwordless email", value: "magic-link" },
      { label: "OAuth (Google, GitHub, etc.)", value: "oauth" },
      { label: "Username + password", value: "username-password" },
      { label: "Let the architect decide", value: "let-architect-decide" },
    ]);
  });

  // Q9: hosting.
  steps.push(async (s) => {
    s.hosting = await bus.askSelect<ProductSpec["hosting"]>(
      "Where will it be hosted?",
      [
        { label: "Vercel", value: "vercel" },
        { label: "Fly.io", value: "fly" },
        { label: "Render", value: "render" },
        { label: "Self-host", value: "self-host" },
        { label: "Let the architect decide", value: "let-architect-decide" },
      ],
    );
  });

  // Q10: monetization.
  steps.push(async (s) => {
    s.monetization = await bus.askSelect<ProductSpec["monetization"]>(
      "Monetization model?",
      [
        { label: "Free / no monetization", value: "free" },
        { label: "Paid SaaS", value: "paid-saas" },
        { label: "Freemium", value: "freemium" },
        { label: "Open source", value: "open-source" },
        { label: "Out of scope for MVP", value: "out-of-scope" },
      ],
    );
  });

  // Q11: implementer.
  steps.push(async (s) => {
    s.implementer = await bus.askSelect<ProductSpec["implementer"]>(
      "Which coding agent will you use to implement?",
      [
        { label: "Claude Code", value: "claude-code" },
        { label: "OpenAI Codex CLI", value: "codex" },
        { label: "OpenCode", value: "opencode" },
        { label: "Cursor", value: "cursor" },
        { label: "Decide later", value: "decide-later" },
      ],
    );
  });

  await runSteps(steps, state);

  const spec: ProductSpec = {
    appName: state.appName!,
    oneLiner: state.oneLiner!,
    targetUser: state.targetUser!,
    differentiation: state.differentiation!,
    selectedFeatures: state.selectedFeatures!,
    lookAndFeel: state.lookAndFeel!,
    techStack: state.techStack!,
    techStackCustom: state.techStackCustom,
    auth: state.auth!,
    hosting: state.hosting!,
    monetization: state.monetization!,
    implementer: state.implementer!,
  };
  await writeSpec(slug, spec);
  bus.emit({
    kind: "info",
    text: `Spec saved: ${spec.appName} (${spec.selectedFeatures.length} features selected)`,
  });
}
