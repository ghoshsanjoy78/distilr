// Stage 9 prompt deck — pure functions, no I/O.
//
// `buildPromptDeck` turns an ArchitectOutput into an ordered list of
// markdown prompts the user copy-pastes into their AI coder. The deck
// has three sections:
//
//   1. Onboarding — read the docs, then start Phase 0.
//   2. One prompt per phase, in order. Each references its
//      docs/exec-plans/active/phase-NN.md spec by path; the prompt
//      itself stays terse so the user can paste it into any tool
//      (Claude Code, Codex, Cursor, Aider, v0, …).
//   3. Final — verify, deploy, ship v0.1.0.
//
// distilr writes each prompt to `projects/<slug>/output/prompts/NN-…md`
// AND surfaces it in the TUI. Files survive distilr exits; the TUI is
// just a copy-paste convenience.

import type { ArchitectOutput, Phase, ProductSpec } from "../store/schemas.js";

export interface BuildPrompt {
  /** Zero-padded numeric prefix used for filename ordering, e.g. "01", "02". */
  index: string;
  /** Filename under projects/<slug>/output/prompts/. */
  filename: string;
  /** Display label for the TUI step list. */
  title: string;
  /** Full markdown body the user copies into their AI coder. */
  body: string;
}

function pad2(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(2, "0");
}

function bullets(items: readonly string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

function onboardingPrompt(out: ArchitectOutput, spec: ProductSpec): BuildPrompt {
  const firstPhase = out.phases[0];
  const firstPhaseFile = firstPhase
    ? `phase-${pad2(firstPhase.number)}.md`
    : "phase-00.md";
  const phaseCount = out.phases.length;

  const body = `# Read the spec, then start Phase 0

You're being asked to build **${spec.appName}** — ${spec.oneLiner}

The complete specification for this project lives in this directory.
Read the docs first, then start with Phase 0.

## Read these in order

1. \`AGENTS.md\` — ~100-line table of contents pointing into docs/.
2. \`README.md\` — what this project is.
3. \`docs/PRODUCT_SENSE.md\` — target user, differentiation, voice.
4. \`docs/design-docs/core-beliefs.md\` — operating principles for this stack.
5. \`ARCHITECTURE.md\` — system layout, data model, libraries.
6. \`docs/DESIGN.md\` — color palette, typography, spacing tokens (copy hex codes directly).
7. \`docs/PLANS.md\` — overview of all ${phaseCount} phase${phaseCount === 1 ? "" : "s"}.
8. \`docs/exec-plans/active/${firstPhaseFile}\` — your first phase.

## Ground rules

- The repo IS the system of record. Anything not in the docs tree is invisible to you. If you make a non-trivial decision, log it in the active phase's "Decision log" section before continuing.
- Tests-first. Commit per phase. Move each \`docs/exec-plans/active/phase-NN.md\` to \`docs/exec-plans/completed/\` when its acceptance criteria pass.
- Ask before destructive ops (deleting branches, dropping tables, force-pushing).

## Your task right now

Start \`docs/exec-plans/active/${firstPhaseFile}\` (Phase 0). Phase 0 is **scaffolding only** — initialize the repo, install deps, set up the dev loop and CI. Do **not** implement features yet; those come in Phase 1+.

Work through Phase 0's acceptance criteria. When all pass:
1. Commit your work.
2. Move \`docs/exec-plans/active/${firstPhaseFile}\` → \`docs/exec-plans/completed/${firstPhaseFile}\`.
3. Stop and report what you've done.
`;

  return {
    index: "01",
    filename: "01-onboarding.md",
    title: "Read the spec, start Phase 0",
    body,
  };
}

function phasePrompt(
  phase: Phase,
  index: number,
  totalPhases: number,
): BuildPrompt {
  void totalPhases;
  const num = pad2(phase.number);
  const orderIndex = pad2(index + 2); // onboarding is 01, so phase 0 is 02
  const phaseFile = `docs/exec-plans/active/phase-${num}.md`;

  // Show the FIRST 5 acceptance criteria as a teaser; the full list
  // lives in the phase file itself.
  const acceptanceTeaser = phase.acceptanceCriteria.slice(0, 5);
  const acceptanceMore =
    phase.acceptanceCriteria.length > acceptanceTeaser.length
      ? `\n\n_(${phase.acceptanceCriteria.length - acceptanceTeaser.length} more in the phase file.)_`
      : "";

  const dependenciesNote =
    phase.dependencies.length > 0
      ? `\n\n**Depends on:** ${phase.dependencies.join(", ")}`
      : "";

  const body = `# Phase ${phase.number}: ${phase.title}

We're shipping **Phase ${phase.number}: ${phase.title}**.

## Read first

- \`${phaseFile}\` — the full spec for this phase.
- \`AGENTS.md\` — refresher on read order and working rules.
- \`docs/product-specs/\` — per-feature product specs. Cross-reference any feature this phase implements.

## Goal

${phase.goal}${dependenciesNote}

## Acceptance criteria (preview)

${bullets(acceptanceTeaser)}${acceptanceMore}

## Workflow

1. Enter your tool's plan mode (e.g. Claude Code's \`/plan\`, Cursor's plan, Codex's "explain plan first"). Read \`${phaseFile}\` end-to-end.
2. Cross-reference the relevant \`docs/product-specs/<feature>.md\` for any feature this phase introduces.
3. Plan the work, then implement.
4. Update the phase's "Progress log" section with what you did.
5. Run the test approach from the phase spec.

## When done

1. Commit your work.
2. Move \`${phaseFile}\` → \`docs/exec-plans/completed/phase-${num}.md\`.
3. Stop and report what you've done.
`;

  return {
    index: orderIndex,
    filename: `${orderIndex}-phase-${num}.md`,
    title: `Phase ${phase.number}: ${phase.title}`,
    body,
  };
}

function finalPrompt(out: ArchitectOutput, totalPhases: number): BuildPrompt {
  const orderIndex = pad2(totalPhases + 2); // onboarding(01) + N phases + final
  const phaseCount = totalPhases;

  const body = `# Wrap up & ship

You've shipped all ${phaseCount} phase${phaseCount === 1 ? "" : "s"}. Final cleanup:

## Verify

- Every \`docs/exec-plans/active/phase-NN.md\` has been moved to \`docs/exec-plans/completed/\`.
- Run the full test suite — \`docs/QUALITY_SCORE.md\` for what to check.
- Smoke-test the deployed build against \`docs/PLANS.md\`'s phase-by-phase user stories.

## Ship

- Update \`README.md\` with deployment instructions for the chosen hosting target.
- Tag \`v0.1.0\` and push.

## What's next

Anything in \`docs/PLANS.md\`'s "Future" section is deferred — promote items there when you're ready to ship v0.2.

If \`docs/PRODUCT_SENSE.md\` or \`ARCHITECTURE.md\` no longer matches the shipped reality, update them. The repo is the system of record; out-of-date docs are worse than no docs.
`;

  return {
    index: orderIndex,
    filename: `${orderIndex}-final.md`,
    title: "Wrap up & ship",
    body,
  };
}

/**
 * Build the full prompt deck. Order: onboarding → phase 0 → phase 1 →
 * … → final wrap-up. The TUI walks the user through one at a time.
 */
export function buildPromptDeck(
  out: ArchitectOutput,
  spec: ProductSpec,
): BuildPrompt[] {
  const total = out.phases.length;
  const phases = out.phases.map((p, i) => phasePrompt(p, i, total));
  return [onboardingPrompt(out, spec), ...phases, finalPrompt(out, total)];
}
