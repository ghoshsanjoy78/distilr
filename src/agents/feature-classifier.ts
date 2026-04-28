// One-shot LLM call that pre-classifies the user's selected features
// into "must-have" vs "nice-to-have" for stage 6 (the wizard).
//
// The dual-pane picker that follows uses these classifications as the
// initial column assignments — the user can then move features
// around. If this call fails, the wizard falls back to a simple
// complexity-based heuristic (also exported from this file) so the
// picker still has reasonable defaults.

import { streamObject } from "ai";
import { z } from "zod";
import { getModel } from "../providers.js";
import type { ProductSpec } from "../store/schemas.js";

export const PriorityEnum = z.enum(["must-have", "nice-to-have"]);
export type Priority = z.infer<typeof PriorityEnum>;

export const ClassificationSchema = z.object({
  featureId: z.string(),
  priority: PriorityEnum,
  reasoning: z
    .string()
    .describe(
      "One short sentence explaining why this feature got this priority. Surface to the user in the picker.",
    ),
});
export type Classification = z.infer<typeof ClassificationSchema>;

const ClassifierOutputSchema = z.object({
  classifications: z.array(ClassificationSchema),
});

/** Hard cap from 06-wizard.ts. Mirrored here so heuristicClassify respects it. */
const MUST_HAVE_CAP = 8;

export interface ClassifierFeature {
  id: string;
  name: string;
  description: string;
  category: string;
  complexity: number;
}

export interface ClassifierContext {
  appName: string;
  oneLiner: string;
  targetUser: ProductSpec["targetUser"];
  differentiation: ProductSpec["differentiation"];
  /** Optional — wizard hasn't asked yet at the point classifier runs. */
  monetization?: ProductSpec["monetization"];
  features: ClassifierFeature[];
}

/**
 * Pre-classify features via streaming. Calls `onPartial` whenever
 * the in-flight partial object's `classifications` array grows by
 * one *fully-formed* entry (all three fields non-empty), letting
 * the caller (the wizard's dual-pane picker) light up rows live as
 * the model emits them.
 *
 * Returns the final, cap-enforced classification list. Throws on
 * stream failure; the wizard catches and falls back to
 * `heuristicClassify`.
 *
 * `partialObjectStream` yields `DeepPartial<T>` objects. The trailing
 * entry is often half-built mid-stream (e.g. featureId set but
 * reasoning still streaming); we treat an entry as "ready" only when
 * all three fields are present and non-empty, then dedupe by length
 * so each new ready entry triggers exactly one onPartial call.
 */
export async function classifyFeaturesStream(
  ctx: ClassifierContext,
  onPartial: (classifications: Classification[]) => void,
): Promise<Classification[]> {
  const featureLines = ctx.features
    .map(
      (f) =>
        `  - ${f.id}: ${f.name} (complexity ${f.complexity}/5, category: ${f.category}) — ${f.description}`,
    )
    .join("\n");

  const system = `You are pre-classifying features for an MVP.

PRODUCT
  Name:           ${ctx.appName}
  One-liner:      ${ctx.oneLiner}
  Target user:    ${ctx.targetUser}
  Differentiation: ${ctx.differentiation.join(", ")}${ctx.monetization ? `\n  Monetization:   ${ctx.monetization}` : ""}

WHAT THE TWO PRIORITIES MEAN
  must-have   → goes into the architect's phased build plan.
                Each must-have becomes one or more phases. The
                implementer agent will actually CODE these in stage 9.
                Each must-have also gets its own product-spec doc.
  nice-to-have → captured as a "Future" item in docs/PLANS.md.
                NOT placed in any phase. NOT built unless reclassified.

RULES
  - Aim for 4-6 must-haves. HARD CAP: 8.
  - Bias HEAVILY toward nice-to-have. Every must-have is real
    engineering work the implementer agent will do. With ${ctx.features.length} candidate
    features here, MOST should land in nice-to-have. The default is
    "deferred to Future"; must-have is a deliberate "core to the MVP"
    promotion.
  - Must-have candidates (small set): features core to the one-liner;
    cross-cutting prerequisites (auth, basic CRUD on the primary
    entity); features without which the product doesn't deliver its
    value prop on day one.
  - Nice-to-have candidates (the majority): power-user features,
    polish, integrations, advanced settings, branding/customization,
    multi-channel deployment, custom domains, analytics depth,
    webhook configurations, anything obviously "v1.1+" territory,
    anything tangential to the one-liner.
  - When uncertain → nice-to-have. The user can still promote it later.
  - For each feature, give a one-sentence reasoning. Concrete, not
    generic ("core editor surface — without this no product" beats
    "important feature").

OUTPUT
  One classification per input feature. Use the exact featureId. Do
  not invent features or skip any.

FEATURES (${ctx.features.length}):
${featureLines}`;

  const { partialObjectStream } = streamObject({
    model: getModel(),
    schema: ClassifierOutputSchema,
    system,
    prompt: "Classify all features above.",
    maxRetries: 1,
  });

  let lastReady = 0;
  let final: Classification[] = [];

  for await (const partial of partialObjectStream) {
    const arr = partial?.classifications;
    if (!Array.isArray(arr)) continue;
    // An entry is "ready" once it has a featureId, a valid priority,
    // and a reasoning string. The TRAILING entry is usually still
    // streaming; only consider entries up to the last one whose three
    // fields are all populated.
    const ready: Classification[] = [];
    for (const c of arr) {
      if (!c) break;
      const fid = c.featureId;
      const pri = c.priority;
      const rea = c.reasoning;
      if (
        typeof fid === "string" && fid.length > 0 &&
        (pri === "must-have" || pri === "nice-to-have") &&
        typeof rea === "string" && rea.length > 0
      ) {
        ready.push({ featureId: fid, priority: pri, reasoning: rea });
      } else {
        break;
      }
    }
    if (ready.length > lastReady) {
      lastReady = ready.length;
      final = ready;
      onPartial(ready);
    }
  }

  return enforceCapByComplexity(final, ctx.features);
}

/**
 * Fallback when classifyFeaturesStream throws — used by the wizard
 * when the LLM call fails (network, schema rejection, credits, etc.).
 *
 * Heuristic: lowest-complexity features become must-have until we
 * hit the cap (or 40% of total features, whichever's smaller). Rest
 * are nice-to-have. Reasoning is generic but truthful.
 */
export function heuristicClassify(
  features: ClassifierFeature[],
): Classification[] {
  const target = Math.min(MUST_HAVE_CAP, Math.max(1, Math.ceil(features.length * 0.4)));
  // Sort by complexity ascending so the simplest ones go must-have.
  const byComplexity = [...features].sort((a, b) => a.complexity - b.complexity);
  const mustHaveIds = new Set(byComplexity.slice(0, target).map((f) => f.id));
  return features.map((f) => ({
    featureId: f.id,
    priority: mustHaveIds.has(f.id) ? "must-have" : "nice-to-have",
    reasoning: mustHaveIds.has(f.id)
      ? `Heuristic pick: lower complexity (${f.complexity}/5) — start with this if cheap to build.`
      : `Heuristic pick: deferred to keep MVP lean (complexity ${f.complexity}/5).`,
  }));
}

/**
 * If the classifier returned more than MUST_HAVE_CAP must-haves,
 * demote the highest-complexity ones until we're at the cap. Keeps
 * reasoning intact for kept must-haves; updates reasoning for demoted
 * ones to flag the auto-demotion.
 */
function enforceCapByComplexity(
  classifications: Classification[],
  features: ClassifierFeature[],
): Classification[] {
  const mustHaves = classifications.filter((c) => c.priority === "must-have");
  if (mustHaves.length <= MUST_HAVE_CAP) return classifications;

  const complexityById = new Map(features.map((f) => [f.id, f.complexity]));
  // Sort must-haves by complexity descending — highest complexity gets demoted first.
  const sorted = [...mustHaves].sort(
    (a, b) =>
      (complexityById.get(b.featureId) ?? 0) -
      (complexityById.get(a.featureId) ?? 0),
  );
  const toDemote = new Set(
    sorted.slice(0, mustHaves.length - MUST_HAVE_CAP).map((c) => c.featureId),
  );

  return classifications.map((c) =>
    toDemote.has(c.featureId)
      ? {
          ...c,
          priority: "nice-to-have" as const,
          reasoning: `${c.reasoning} (auto-demoted: classifier exceeded the ${MUST_HAVE_CAP} must-have cap; this had the highest complexity.)`,
        }
      : c,
  );
}
