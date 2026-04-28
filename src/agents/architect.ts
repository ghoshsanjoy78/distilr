// Stage 7: turn the synthesized feature catalog + the user's wizard
// answers into a complete architecture + phased build plan.
//
// Three sequential `streamObject` calls — split for two reasons:
//
//   1. Token headroom. A single combined call has to fit ~6 markdown
//      docs + up to 10 rich phase specs + N per-feature specs into one
//      response. On bigger projects that pushes 50-60k output tokens,
//      bumping into provider caps and risking mid-JSON truncation.
//      Splitting keeps each call comfortably within ~20-50k.
//
//   2. Local failure modes. If "phases" goes wrong, we don't lose the
//      already-validated docs. Each call's output is fully validated
//      before the next starts, and earlier outputs are passed forward
//      as context so later calls stay coherent.
//
// Call order is fixed:
//   A. DOCS    → architecture + readme + design + sense + beliefs + claude/agents
//   B. PLANS   → phasesOverviewMarkdown + phases[] (sees architecture)
//   C. SPECS   → productSpecs[] (sees phase titles)
//
// Wall time ≈ sum of three calls (no parallelism — earlier the user
// chose sequential over parallel; coordinating phases & specs across
// concurrent streams is fragile).

import { streamObject } from "ai";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readCatalog, readSpec, projectPaths } from "../store/project.js";
import { getModel } from "../providers.js";
import {
  ArchitectOutputSchema,
  PhaseSchema,
  ProductSpecMarkdownSchema,
  SetupChecklistItemSchema,
  type ArchitectOutput,
  type Phase,
  type ProductSpecMarkdown,
  type SetupChecklistItem,
  type ProductSpec,
  type FeatureCatalog,
} from "../store/schemas.js";
import { PROMPT_GUIDELINES } from "./guidelines.js";
import {
  ensureOutputDirs,
  writeFileAt,
  phaseToMarkdown,
  buildProductSpecsIndex,
} from "../output/scaffold.js";
import type { Bus } from "../tui/bus.js";

/** Filename of the architect's output JSON, under `projects/<slug>/`. */
export const ARCHITECT_OUTPUT_FILENAME = "architect-output.json";

/**
 * Per-call snapshot filenames. Written under `projects/<slug>/` after
 * each call succeeds. On retry, runArchitect reads these and skips the
 * matching call so we don't burn tokens redoing already-validated work.
 * Deleted once the final architect-output.json is written.
 */
const DOCS_SNAPSHOT = "architect-docs.json";
const PLANS_SNAPSHOT = "architect-plans.json";
const SPECS_SNAPSHOT = "architect-specs.json";

const PHASE_CAP = 10;

// ─── Per-call schemas ───────────────────────────────────────────────────
//
// Each schema is a strict subset of ArchitectOutputSchema. We re-merge
// the three call results into a full ArchitectOutput at the end.

const DocsSchema = z.object({
  architectureMarkdown: z.string(),
  readmeMarkdown: z.string(),
  designMarkdown: z.string(),
  productSenseMarkdown: z.string(),
  coreBeliefsMarkdown: z.string(),
  claudeMdMarkdown: z.string(),
  setupChecklist: z.array(SetupChecklistItemSchema),
});
type DocsOutput = z.infer<typeof DocsSchema>;

const PlansSchema = z.object({
  phasesOverviewMarkdown: z.string(),
  phases: z.array(PhaseSchema),
});
type PlansOutput = z.infer<typeof PlansSchema>;

const SpecsSchema = z.object({
  productSpecs: z.array(ProductSpecMarkdownSchema),
});
type SpecsOutput = z.infer<typeof SpecsSchema>;

interface UsageDelta {
  inputTokens?: number;
  outputTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface ProjectContext {
  catalog: FeatureCatalog;
  spec: ProductSpec;
  mustHaves: ProductSpec["selectedFeatures"];
  niceToHaves: ProductSpec["selectedFeatures"];
  /** must-have features hydrated with their catalog details. */
  mustHaveDetails: { category: string; name: string; description: string; complexity: number }[];
  /** nice-to-haves hydrated with their catalog details. */
  niceToHaveDetails: { category: string; name: string; description: string; complexity: number }[];
  stackText: string;
}

function buildProjectContext(
  catalog: FeatureCatalog,
  spec: ProductSpec,
): ProjectContext {
  const mustHaves = spec.selectedFeatures.filter((s) => s.priority === "must-have");
  const niceToHaves = spec.selectedFeatures.filter((s) => s.priority === "nice-to-have");

  const featuresById = new Map(
    catalog.categories.flatMap((c) =>
      c.features.map((f) => [f.id, { ...f, category: c.name }]),
    ),
  );

  const renderFeatures = (
    sel: typeof spec.selectedFeatures,
  ) =>
    sel
      .map((s) => featuresById.get(s.featureId))
      .filter((f): f is NonNullable<typeof f> => f != null)
      .map((f) => ({
        category: f.category,
        name: f.name,
        description: f.description,
        complexity: f.complexity,
      }));

  return {
    catalog,
    spec,
    mustHaves,
    niceToHaves,
    mustHaveDetails: renderFeatures(mustHaves),
    niceToHaveDetails: renderFeatures(niceToHaves),
    stackText:
      spec.techStack === "custom"
        ? `Custom: ${spec.techStackCustom}`
        : spec.techStack,
  };
}

function projectContextBlock(ctx: ProjectContext): string {
  return `PROJECT CONTEXT:
  Tech stack:    ${ctx.stackText}
  Auth:          ${ctx.spec.auth}
  Hosting:       ${ctx.spec.hosting}
  Look & feel:   ${ctx.spec.lookAndFeel}
  Monetization:  ${ctx.spec.monetization}
  Source SaaS:   ${ctx.catalog.source}

Product spec:
\`\`\`json
${JSON.stringify({ ...ctx.spec, selectedFeatures: undefined }, null, 2)}
\`\`\`

Must-have features (${ctx.mustHaves.length}):
\`\`\`json
${JSON.stringify(ctx.mustHaveDetails, null, 2)}
\`\`\`

Nice-to-have features (${ctx.niceToHaves.length}):
\`\`\`json
${JSON.stringify(ctx.niceToHaveDetails, null, 2)}
\`\`\``;
}

// ─── Call A: top-level docs ─────────────────────────────────────────────

async function runDocsCall(
  ctx: ProjectContext,
  bus: Bus,
): Promise<{ output: DocsOutput; usage: UsageDelta | undefined }> {
  const STRING_FIELD_DOCS: Record<string, string> = {
    architectureMarkdown: "ARCHITECTURE.md",
    readmeMarkdown: "README.md",
    designMarkdown: "docs/DESIGN.md",
    productSenseMarkdown: "docs/PRODUCT_SENSE.md",
    coreBeliefsMarkdown: "docs/design-docs/core-beliefs.md",
    claudeMdMarkdown: "AGENTS.md / CLAUDE.md",
  };

  const system = `You are a senior architect designing a fully agent-generated repository following OpenAI's harness-engineering layout. The repository IS the system of record — anything not in the docs tree is invisible to the implementing AI agent.

This call (1 of 3) produces the TOP-LEVEL DOCS only. Two later calls produce the phased build plan and per-feature specs.

OUTPUT FIELDS (you produce all of these):

1. architectureMarkdown — Full ARCHITECTURE.md. One-paragraph summary, mermaid system diagram, data model (entities + key fields), services / module layout, key libraries with stack-aware justifications, deployment topology.

2. readmeMarkdown — README.md. Short. Title, one-liner, status ("scaffolded by distilr, not yet built"), how to start dev once Phase 0 lands.

3. designMarkdown — Lands at docs/DESIGN.md. MUST translate lookAndFeel ("${ctx.spec.lookAndFeel}") into concrete specs. Include:
   - Visual direction (one paragraph mood/feel/inspirations).
   - Color palette: 6-10 LABELED HEX values (background, surface, text, primary, accent, success, warning, error).
   - Typography: heading font + body font (Google Fonts or system), modular scale, line-heights.
   - Spacing system: base unit + scale.
   - Layout density (spacious/balanced/compact + rationale).
   - Motion (when to animate, easing, durations).
   - Component aesthetic (corner radius, border weight, shadow, button shape, input style).
   Implementer copies hex codes and font names directly. Don't just describe the category — pick values.

4. productSenseMarkdown — Lands at docs/PRODUCT_SENSE.md (~400-900 chars). The product's principles:
   - Target user (concrete description).
   - Differentiation strategy (drawing from the user's chosen angle: ${ctx.spec.differentiation.join(", ")}).
   - Monetization model in concrete terms (${ctx.spec.monetization}).
   - What makes this DIFFERENT from "${ctx.catalog.source}" — be specific.
   - Voice / tone (matching the chosen lookAndFeel).

5. coreBeliefsMarkdown — Lands at docs/design-docs/core-beliefs.md (~500-1200 chars). Agent-first operating principles. Be SPECIFIC to the chosen stack. Cover at minimum:
   - Parse-don't-validate at boundaries (mention the right library for the stack: Zod for TS, Pydantic for Python, etc.).
   - Structured logging (mention the conventional library).
   - Layered domain architecture (Types → Config → Repo → Service → UI; cross-cutting concerns through Providers).
   - Prefer "boring" tech the model knows well.
   - Repo is the system of record — Slack threads, Google Docs, etc. don't exist to the agent.
   - Taste enforced via linters and tests, not comments.
   - Tests first; commit per phase; ask before destructive ops.

6. claudeMdMarkdown — Lands at AGENTS.md AND CLAUDE.md. KEEP IT SHORT — 80-120 LINES. This is a TABLE OF CONTENTS, not a manual. Each section is 1-3 lines pointing to a specific docs/ path with a one-line description.

   Required sections (in order):
   - "How to work in this repo" (read order: README.md → docs/PRODUCT_SENSE.md → docs/design-docs/core-beliefs.md → ARCHITECTURE.md → docs/DESIGN.md → docs/PLANS.md → pick lowest phase from docs/exec-plans/active/)
   - "Per-domain references" (one line each: docs/FRONTEND.md, docs/RELIABILITY.md, docs/SECURITY.md, docs/QUALITY_SCORE.md, docs/exec-plans/tech-debt-tracker.md, docs/references/)
   - "Working rules" (5-7 short rules: write tests first; one PR per phase; move phase from active/ to completed/ when shipped; ask before destructive ops; parse-don't-validate at boundaries; prefer shared utilities over hand-rolled; repo is the system of record — update relevant docs as you go).

   Tool-agnostic — do NOT assume any specific coding agent's conventions. Refer to the file as "AGENTS.md" since that's the cross-tool name.

7. setupChecklist[] — Every external account / API key / secret the user must obtain to run THIS app. Derived from the tech stack ("${ctx.stackText}"), auth ("${ctx.spec.auth}"), hosting ("${ctx.spec.hosting}"), monetization ("${ctx.spec.monetization}"), and the libraries you chose in architectureMarkdown. distilr will walk the user through these one-at-a-time in a TUI step where they can paste a value (which lands in .env.local locally) or skip for later.

   For each item:
   - name: short human label, e.g. "Supabase project URL", "Stripe secret key", "OpenAI API key".
   - envVar: the env var key written to .env.local. Uppercase snake_case (e.g. NEXT_PUBLIC_SUPABASE_URL, STRIPE_SECRET_KEY).
   - description: 1-2 sentences. Concrete to THIS project — "Used by the auth callback at /api/auth/callback to verify Supabase sessions" beats "For Supabase auth".
   - signupUrl: the exact URL the user visits to obtain this value (e.g. "https://supabase.com/dashboard/project/_/settings/api"). Empty string if the value is locally generated (e.g. NEXTAUTH_SECRET → user runs \`openssl rand -base64 32\`).
   - required: true ONLY if Phase 0 / Phase 1 cannot run without it. False for keys a later phase needs (user can defer).

   RULES:
   - 3-8 items. Aim for the most-common ones; the user can add more later.
   - Include the auth provider's keys (e.g. OAuth client id/secret, Supabase URL+anon key, NEXTAUTH_SECRET).
   - Include the database URL if the stack uses a managed DB.
   - Include monetization keys ONLY if the chosen monetization is paid-saas / freemium (Stripe secret + publishable + webhook).
   - Include any AI/LLM keys ONLY if a must-have feature requires it (e.g. an AI-native feature using OpenAI).
   - DO NOT include keys distilr already configured for itself (this is the user's app, not distilr).
   - DO NOT include hosting platform CLI tokens unless required for runtime (Vercel/Fly/Render auth is a one-time \`vercel login\` — no env var needed).

Produce all 7 fields. Every field is required.

${PROMPT_GUIDELINES}`;

  const userPrompt = `${projectContextBlock(ctx)}

Draft the top-level docs.`;

  bus.setStatus("Drafting ARCHITECTURE.md");

  const stream = streamObject({
    model: getModel(),
    schema: DocsSchema,
    system,
    prompt: userPrompt,
    maxOutputTokens: 32000,
    maxRetries: 2,
  });

  const seen = new Set<string>();
  for await (const partial of stream.partialObjectStream) {
    if (!partial) continue;
    const p = partial as Record<string, unknown>;
    for (const [field, doc] of Object.entries(STRING_FIELD_DOCS)) {
      if (seen.has(field)) continue;
      const v = p[field];
      if (typeof v === "string" && v.length > 0) {
        seen.add(field);
        bus.setStatus(`Drafting ${doc}`);
      }
    }
  }

  const output = (await stream.object) as DocsOutput;
  const usage = (await stream.usage) as UsageDelta | undefined;
  return { output, usage };
}

// ─── Call B: phases overview + per-phase exec specs ─────────────────────

async function runPlansCall(
  ctx: ProjectContext,
  docs: DocsOutput,
  bus: Bus,
): Promise<{ output: PlansOutput; usage: UsageDelta | undefined }> {
  const system = `You are a senior architect drafting the phased build plan for a fully agent-generated repository.

This call (2 of 3) produces the PHASE PLAN. The architecture and design docs are already written (passed below for reference). A later call will produce per-feature product specs.

OUTPUT FIELDS:

1. phasesOverviewMarkdown — Lands at docs/PLANS.md. High-level overview of each phase (number, title, one-line goal). Order phases so each is independently demoable.

2. phases[] — Structured per-phase data. **HARD CAP: AT MOST ${PHASE_CAP} PHASES.** Phase 0 is ALWAYS "scaffolding" (init repo, deps, dev loop, CI — NO features). Phase 1 is a thin slice of the most important must-have feature, end-to-end. Each subsequent phase adds 1-3 features. Last phase is polish/launch. ≤7 estimatedDays each. If you find yourself wanting an 11th phase, the scope is too big — collapse smaller features into existing phases or move them to a "Future" note in the phasesOverviewMarkdown. Each phase MUST include rich spec fields:
   - userStories (2-5): "As a <role>, I can <action> so that <outcome>."
   - scope (3-6 bullets): high-level boundaries.
   - functionalRequirements (5-15): SPECIFIC testable behaviors, not goals.
   - dataModel: markdown describing entities/fields/types/validation/relationships introduced in this phase.
   - apiSurface: endpoints/methods with request/response shapes, status codes/errors. Empty if N/A.
   - uiRequirements: screens/components/states/interactions. Empty for backend-only phases.
   - edgeCases (3-8): specific scenarios.
   - outOfScope (3-8): explicit non-goals.
   - acceptanceCriteria (5-10): testable observable checks.
   - testApproach: paragraph covering unit/integration/e2e.
   - DO NOT include filesToCreate (the implementer decides file layout).

The phases overview and the phases array MUST agree on count, numbering, and titles. Both phasesOverviewMarkdown and phases[] are part of the same answer — make them consistent.

Make sure the data model and api surface honor the entities/decisions described in ARCHITECTURE.md (passed as context).

${PROMPT_GUIDELINES}`;

  const userPrompt = `${projectContextBlock(ctx)}

Already-written ARCHITECTURE.md (for reference — design phases that fit this architecture):
\`\`\`markdown
${docs.architectureMarkdown}
\`\`\`

Draft the phased build plan.`;

  bus.setStatus("Drafting docs/PLANS.md");

  const stream = streamObject({
    model: getModel(),
    schema: PlansSchema,
    system,
    prompt: userPrompt,
    // Phases tend to be the heaviest call — 10 phases × ~4-5K tokens each
    // is 40-50K. Keep headroom comfortable.
    maxOutputTokens: 64000,
    maxRetries: 2,
  });

  let plansHeaderAnnounced = false;
  for await (const partial of stream.partialObjectStream) {
    if (!partial) continue;
    const p = partial as Record<string, unknown>;

    if (
      !plansHeaderAnnounced &&
      typeof p.phasesOverviewMarkdown === "string" &&
      p.phasesOverviewMarkdown.length > 0
    ) {
      plansHeaderAnnounced = true;
      bus.setStatus("Drafting docs/PLANS.md");
    }

    const phasesArr = p.phases;
    if (Array.isArray(phasesArr) && phasesArr.length > 0) {
      const idx = phasesArr.length - 1;
      const latest = phasesArr[idx] as
        | { number?: unknown; title?: unknown }
        | undefined;
      const rawNum =
        typeof latest?.number === "number" ? latest.number : idx;
      const num = String(Math.max(0, Math.round(rawNum))).padStart(2, "0");
      const title =
        typeof latest?.title === "string" && latest.title.length > 0
          ? ` — ${latest.title}`
          : "";
      bus.setStatus(`Drafting docs/exec-plans/active/phase-${num}.md${title}`);
    }
  }

  const output = (await stream.object) as PlansOutput;
  const usage = (await stream.usage) as UsageDelta | undefined;
  return { output, usage };
}

// ─── Call C: per-feature product specs ──────────────────────────────────

async function runSpecsCall(
  ctx: ProjectContext,
  phases: Phase[],
  bus: Bus,
): Promise<{ output: SpecsOutput; usage: UsageDelta | undefined }> {
  const phaseTitles = phases
    .map((p) => `  - phase ${p.number}: ${p.title}`)
    .join("\n");

  const system = `You are a senior architect drafting per-feature product specs for an agent-generated repository.

This call (3 of 3) produces ONE product spec per MUST-HAVE feature. The architecture and phase plan are already written (the phase titles are listed below for cross-reference).

OUTPUT FIELDS:

productSpecs[] — ONE entry per MUST-HAVE feature (${ctx.mustHaves.length} feature${ctx.mustHaves.length === 1 ? "" : "s"}). Each entry: { name, slug, markdown }. Slug is lowercase-hyphenated (e.g. "email-campaigns"). Markdown is ~300-600 chars covering:
   - One-paragraph user-facing description.
   - Primary user stories (2-3).
   - Key functional requirements (3-6 bullets).
   - Out-of-scope items (1-3 bullets).
   This is a USER-FACING product spec — what the feature DOES, not how to build it (that's the phase spec's job).

Use the exact must-have feature names from the project context. Do not invent features. Produce one entry per must-have, in the same order they appear in the project context.

${PROMPT_GUIDELINES}`;

  const userPrompt = `${projectContextBlock(ctx)}

Phase plan (already drafted — for reference; DO NOT redo phase content):
${phaseTitles}

Draft one product-spec entry per must-have feature.`;

  bus.setStatus("Drafting docs/product-specs/…");

  const stream = streamObject({
    model: getModel(),
    schema: SpecsSchema,
    system,
    prompt: userPrompt,
    // Specs are short (~500 chars × N features). 16k is plenty even
    // with the cap-of-8 must-haves.
    maxOutputTokens: 16000,
    maxRetries: 2,
  });

  for await (const partial of stream.partialObjectStream) {
    if (!partial) continue;
    const p = partial as Record<string, unknown>;
    const specsArr = p.productSpecs;
    if (Array.isArray(specsArr) && specsArr.length > 0) {
      const idx = specsArr.length - 1;
      const latest = specsArr[idx] as { slug?: unknown } | undefined;
      const slug =
        typeof latest?.slug === "string" && latest.slug.length > 0
          ? latest.slug
          : `feature-${idx + 1}`;
      bus.setStatus(`Drafting docs/product-specs/${slug}.md`);
    }
  }

  const output = (await stream.object) as SpecsOutput;
  const usage = (await stream.usage) as UsageDelta | undefined;
  return { output, usage };
}

// ─── Progressive output writes ──────────────────────────────────────────
//
// After each call succeeds, materialize the relevant markdown into
// `projects/<slug>/output/` immediately. Stage 8 (emit) will overwrite
// these idempotently with the same content + add scaffolded templates.
//
// Doing this here means the user can `tail -f` files mid-run, and a
// crashed architect leaves usable partial output behind.

async function writeDocsToOutput(slug: string, docs: DocsOutput): Promise<void> {
  const p = await ensureOutputDirs(slug);
  await Promise.all([
    writeFileAt(join(p.root, "AGENTS.md"), docs.claudeMdMarkdown),
    writeFileAt(join(p.root, "CLAUDE.md"), docs.claudeMdMarkdown),
    writeFileAt(join(p.root, "ARCHITECTURE.md"), docs.architectureMarkdown),
    writeFileAt(join(p.root, "README.md"), docs.readmeMarkdown),
    writeFileAt(join(p.docs, "DESIGN.md"), docs.designMarkdown),
    writeFileAt(join(p.docs, "PRODUCT_SENSE.md"), docs.productSenseMarkdown),
    writeFileAt(join(p.designDocs, "core-beliefs.md"), docs.coreBeliefsMarkdown),
  ]);
}

async function writePlansToOutput(slug: string, overview: string, phases: Phase[]): Promise<void> {
  const p = await ensureOutputDirs(slug);
  await writeFileAt(join(p.docs, "PLANS.md"), overview);
  await Promise.all(
    phases.map((phase) => {
      const fname = `phase-${String(phase.number).padStart(2, "0")}.md`;
      return writeFileAt(join(p.active, fname), phaseToMarkdown(phase));
    }),
  );
}

async function writeSpecsToOutput(slug: string, specs: ProductSpecMarkdown[]): Promise<void> {
  const p = await ensureOutputDirs(slug);
  const valid = specs.filter((ps) => ps?.slug?.trim() && ps?.markdown?.trim());
  await Promise.all(
    valid.map((ps) =>
      writeFileAt(join(p.productSpecs, `${ps.slug}.md`), ps.markdown),
    ),
  );
  await writeFileAt(
    join(p.productSpecs, "index.md"),
    buildProductSpecsIndex(valid),
  );
}

// ─── Per-call snapshot persistence (for retry-skip) ─────────────────────

async function readSnapshot<T>(
  slug: string,
  filename: string,
  schema: z.ZodType<T>,
): Promise<T | null> {
  try {
    const raw = await readFile(join(projectPaths(slug).root, filename), "utf8");
    return schema.parse(JSON.parse(raw));
  } catch {
    // Missing, malformed, or schema mismatch — re-run the call.
    return null;
  }
}

async function writeSnapshot(
  slug: string,
  filename: string,
  data: unknown,
): Promise<void> {
  await writeFile(
    join(projectPaths(slug).root, filename),
    JSON.stringify(data, null, 2),
    "utf8",
  );
}

async function deleteSnapshots(slug: string): Promise<void> {
  const root = projectPaths(slug).root;
  for (const f of [DOCS_SNAPSHOT, PLANS_SNAPSHOT, SPECS_SNAPSHOT]) {
    try {
      await unlink(join(root, f));
    } catch {
      // Already gone — fine.
    }
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────

export async function runArchitect(slug: string, bus: Bus): Promise<void> {
  const catalog = await readCatalog(slug);
  const spec = await readSpec(slug);
  const ctx = buildProjectContext(catalog, spec);

  bus.emit({
    kind: "info",
    text: "Drafting architecture in three passes (docs → plan → specs)…",
  });

  const totalUsage: UsageDelta = {};
  const addUsage = (u: UsageDelta | undefined) => {
    if (!u) return;
    totalUsage.inputTokens =
      (totalUsage.inputTokens ?? 0) +
      (u.inputTokens ?? u.promptTokens ?? 0);
    totalUsage.outputTokens =
      (totalUsage.outputTokens ?? 0) +
      (u.outputTokens ?? u.completionTokens ?? 0);
  };

  let docs: DocsOutput;
  let plans: PlansOutput;
  let specsRaw: ProductSpecMarkdown[];

  try {
    // Call A: docs. Skip if a valid snapshot exists from a prior run.
    const cachedDocs = await readSnapshot(slug, DOCS_SNAPSHOT, DocsSchema);
    if (cachedDocs) {
      bus.emit({
        kind: "info",
        text: "Reusing previously-drafted docs from disk (skipping call A).",
      });
      docs = cachedDocs;
    } else {
      const docsRes = await runDocsCall(ctx, bus);
      addUsage(docsRes.usage);
      docs = docsRes.output;
      await writeSnapshot(slug, DOCS_SNAPSHOT, docs);
      await writeDocsToOutput(slug, docs);
    }

    // Call B: plans. Same retry-skip pattern.
    const cachedPlans = await readSnapshot(slug, PLANS_SNAPSHOT, PlansSchema);
    if (cachedPlans) {
      bus.emit({
        kind: "info",
        text: "Reusing previously-drafted plan from disk (skipping call B).",
      });
      plans = cachedPlans;
    } else {
      const plansRes = await runPlansCall(ctx, docs, bus);
      addUsage(plansRes.usage);
      plans = plansRes.output;
      await writeSnapshot(slug, PLANS_SNAPSHOT, plans);
      await writePlansToOutput(slug, plans.phasesOverviewMarkdown, plans.phases);
    }

    // Call C: per-feature product specs.
    const cachedSpecs = await readSnapshot(slug, SPECS_SNAPSHOT, SpecsSchema);
    if (cachedSpecs) {
      bus.emit({
        kind: "info",
        text: "Reusing previously-drafted product specs from disk (skipping call C).",
      });
      specsRaw = cachedSpecs.productSpecs;
    } else {
      const specsRes = await runSpecsCall(ctx, plans.phases, bus);
      addUsage(specsRes.usage);
      specsRaw = specsRes.output.productSpecs;
      await writeSnapshot(slug, SPECS_SNAPSHOT, specsRes.output);
      await writeSpecsToOutput(slug, specsRaw);
    }
  } catch (e) {
    bus.setStatus(null);
    const err = e as Error;
    throw new Error(
      `Architect failed to produce a valid spec after retries: ${err.message}. Try resuming with a different provider/model — e.g. \`./distilr resume <slug> --provider openai --model gpt-4o\`. Already-completed calls are cached on disk and will be skipped on retry.`,
    );
  }

  bus.setStatus(null);

  // ─── Cap & clean phases ───────────────────────────────────────────────

  const phaseCount = plans.phases.length;
  const truncated = phaseCount > PHASE_CAP;
  const rawPhases = truncated ? plans.phases.slice(0, PHASE_CAP) : plans.phases;
  if (truncated) {
    bus.emit({
      kind: "warning",
      text: `Architect emitted ${phaseCount} phases — capped to ${PHASE_CAP}. Trailing phases dropped.`,
    });
  }

  // Clamp numeric fields to their intended ranges. The schema can't
  // express min/max on integers because Anthropic's structured-output
  // validator rejects those constraints; the model should produce
  // values in range based on the .describe() hints, but we enforce
  // here so downstream stages always see sensible numbers.
  const phases = rawPhases.map((p, i) => ({
    ...p,
    number: Math.max(0, Math.round(p.number ?? i)),
    estimatedDays: Math.max(1, Math.min(7, Math.round(p.estimatedDays ?? 3))),
  }));

  // ─── Filter empty/duplicate product specs ────────────────────────────

  const seenSlugs = new Set<string>();
  const productSpecs = specsRaw.filter((ps) => {
    if (!ps?.slug?.trim() || !ps?.markdown?.trim()) return false;
    if (seenSlugs.has(ps.slug)) return false;
    seenSlugs.add(ps.slug);
    return true;
  });

  // ─── Merge into the canonical ArchitectOutput ────────────────────────

  // Filter empty/duplicate setup-checklist items by envVar.
  const seenEnv = new Set<string>();
  const setupChecklist: SetupChecklistItem[] = (docs.setupChecklist ?? []).filter(
    (item) => {
      if (!item?.envVar?.trim() || !item?.name?.trim()) return false;
      if (seenEnv.has(item.envVar)) return false;
      seenEnv.add(item.envVar);
      return true;
    },
  );

  const output: ArchitectOutput = ArchitectOutputSchema.parse({
    architectureMarkdown: docs.architectureMarkdown,
    phasesOverviewMarkdown: plans.phasesOverviewMarkdown,
    phases,
    claudeMdMarkdown: docs.claudeMdMarkdown,
    readmeMarkdown: docs.readmeMarkdown,
    designMarkdown: docs.designMarkdown,
    productSenseMarkdown: docs.productSenseMarkdown,
    coreBeliefsMarkdown: docs.coreBeliefsMarkdown,
    productSpecs,
    setupChecklist,
  });

  const out = projectPaths(slug);
  await writeFile(
    join(out.root, ARCHITECT_OUTPUT_FILENAME),
    JSON.stringify(output, null, 2),
    "utf8",
  );

  // Final canonical JSON is now on disk — drop the per-call snapshots
  // so they don't shadow a future run on this same project.
  await deleteSnapshots(slug);

  bus.addTokens(totalUsage.inputTokens ?? 0, totalUsage.outputTokens ?? 0);

  bus.emit({ kind: "submit", what: "architecture" });
  bus.emit({
    kind: "info",
    text: `Architecture drafted: ${output.phases.length} phase${output.phases.length === 1 ? "" : "s"}, ${output.productSpecs.length} product-spec${output.productSpecs.length === 1 ? "" : "s"}.`,
  });
}
