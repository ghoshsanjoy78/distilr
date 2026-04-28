// Stage 5: cluster the recorded observations into a clean feature
// catalog organized by category.
//
// Uses `generateObject` (one structured-output call, schema-validated,
// auto-retried on parse failure) rather than streamText + a submit
// tool — same reasoning as the architect: removes the race condition
// where the model could finish without ever calling the tool.

import { generateObject } from "ai";
import { z } from "zod";
import {
  readObservations,
  writeCatalog,
  projectPaths,
} from "../store/project.js";
import { FeatureCatalogSchema } from "../store/schemas.js";
import { getModel } from "../providers.js";
import { PROMPT_GUIDELINES } from "./guidelines.js";
import type { Bus } from "../tui/bus.js";
import { existsSync } from "node:fs";

// Schema the model produces. Features here have NO id field — we
// generate slug ids from category+name post-hoc, then feed the
// finalized catalog through FeatureCatalogSchema before persisting.
//
// `complexity` is `z.number()` (NOT `.number().int()`) for a subtle
// but critical reason: Zod's toJSONSchema() auto-injects
// `minimum: -9007199254740991, maximum: 9007199254740991` (JS Number
// safe-integer range) on every `.int()` field. Anthropic's
// structured-output validator then rejects the resulting JSON Schema
// with "For 'integer' type, properties maximum, minimum are not
// supported". Using plain `z.number()` keeps the type as "number"
// with no auto-injected bounds — Anthropic accepts it. We round +
// clamp to [1, 5] post-parse.
const FeatureInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  complexity: z
    .number()
    .describe(
      "Integer 1-5: 1 = trivial CRUD/static, 5 = serious distributed/algorithmic work. Produce a whole number in the 1-5 range.",
    ),
  dependencies: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
const CategoryInputSchema = z.object({
  name: z.string(),
  features: z.array(FeatureInputSchema),
});
const CatalogInputSchema = z.object({
  categories: z.array(CategoryInputSchema),
});

export async function runSynthesizer(
  slug: string,
  saasName: string,
  bus: Bus,
): Promise<void> {
  const observations = await readObservations(slug);

  // Hard cap: synthesizer sees at most 100 observations. Keep the newest
  // — auth-walled exploration tends to produce richer observations than
  // the marketing-page recon ones, and they appear later in the file.
  const MAX_OBS = 100;
  const truncated = observations.length > MAX_OBS;
  const slice = truncated ? observations.slice(-MAX_OBS) : observations;
  if (truncated) {
    bus.emit({
      kind: "warning",
      text: `Recorded ${observations.length} observations — synthesizing from the newest ${MAX_OBS} only (cap to keep the catalog focused).`,
    });
  }

  const compactObs = slice.map((o) => ({
    id: o.id.slice(0, 8),
    kind: o.kind,
    page: o.page,
    summary: o.summary,
    evidence: o.evidence,
  }));

  const system = `You are a feature synthesis agent. You will be given a list of observations made while exploring "${saasName}". Your job: cluster them into a clean feature catalog organized by category.

Rules:
- Categories should reflect natural product areas (e.g. "Authentication", "Campaigns", "Analytics").
- Each feature has: name, description (1-2 sentences), complexity 1-5 (1 = trivial CRUD/static, 5 = serious distributed/algorithmic work), dependencies (other feature names this depends on, by exact name), evidence (the observation IDs that support it — use the short 8-char IDs).
- Aim for 15-40 features total across 4-10 categories. Don't include trivia (e.g. "footer has a link to twitter" is not a feature).
- Be conservative on complexity: if you're not sure, lean lower.

Produce the full categorized catalog as a single structured object.

${PROMPT_GUIDELINES}`;

  const userPrompt = `Here are the observations (${compactObs.length}):

\`\`\`json
${JSON.stringify(compactObs, null, 1)}
\`\`\`

Synthesize them into a feature catalog.`;

  bus.emit({ kind: "info", text: "Building feature catalog…" });

  let result;
  try {
    result = await generateObject({
      model: getModel(),
      schema: CatalogInputSchema,
      system,
      prompt: userPrompt,
      maxOutputTokens: 16000,
      maxRetries: 2,
    });
  } catch (e) {
    const err = e as Error;
    throw new Error(
      `Synthesizer failed to produce a valid catalog after retries: ${err.message}. Try resuming with a different provider/model — e.g. \`./distilr resume <slug> --provider openai --model gpt-4o\`.`,
    );
  }

  // Generate slug-style feature IDs (matching the previous tool's
  // execute() output format) and validate the final shape. Complexity
  // is clamped to [1, 5] here since the generation schema can't carry
  // the min/max constraint (Anthropic structured-output rejection).
  const catalog = FeatureCatalogSchema.parse({
    source: saasName,
    generatedAt: new Date().toISOString(),
    categories: result.object.categories.map((c, ci) => ({
      name: c.name,
      features: c.features.map((f, fi) => ({
        id: `${ci + 1}.${fi + 1}-${f.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .slice(0, 30)
          .replace(/^-+|-+$/g, "")}`,
        name: f.name,
        description: f.description,
        complexity: clamp(Math.round(f.complexity), 1, 5),
        dependencies: f.dependencies ?? [],
        evidence: f.evidence ?? [],
      })),
    })),
  });
  await writeCatalog(slug, catalog);

  // Reconcile token usage against the bus's running totals.
  const usage = result.usage as
    | {
        inputTokens?: number;
        outputTokens?: number;
        promptTokens?: number;
        completionTokens?: number;
      }
    | undefined;
  if (usage) {
    bus.addTokens(
      usage.inputTokens ?? usage.promptTokens ?? 0,
      usage.outputTokens ?? usage.completionTokens ?? 0,
    );
  }

  const totalFeatures = catalog.categories.reduce(
    (s, c) => s + c.features.length,
    0,
  );
  bus.emit({ kind: "submit", what: "catalog" });
  bus.emit({
    kind: "info",
    text: `Catalog built: ${catalog.categories.length} categor${catalog.categories.length === 1 ? "y" : "ies"}, ${totalFeatures} feature${totalFeatures === 1 ? "" : "s"}.`,
  });

  if (!existsSync(projectPaths(slug).catalogFile)) {
    throw new Error(
      "Catalog file failed to write. This is a bug — please file an issue.",
    );
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
