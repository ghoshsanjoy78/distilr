// Single-call LLM check that classifies the chosen SaaS by how realistic
// it is to spec as an MVP. Used by stage 01 (target) to warn the user
// upfront when they pick something sprawling — before any agent burns
// tokens trying to catalog 200+ features. Soft warning: never blocks;
// user always has a "continue anyway" option.

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../providers.js";

export const ScopeAssessmentSchema = z.object({
  sizeCategory: z
    .enum(["focused", "broad", "sprawling"])
    .describe(
      "focused = a single product distilr can spec as an MVP; broad = several products in one (workable but the area picker matters more); sprawling = a vast multi-product suite that won't produce a useful MVP spec",
    ),
  reason: z
    .string()
    .describe("One short sentence — why this category"),
  narrowingSuggestion: z
    .string()
    .describe(
      "If broad/sprawling, a specific sub-product or module to focus on instead. Empty string if focused.",
    ),
});
export type ScopeAssessment = z.infer<typeof ScopeAssessmentSchema>;

export async function checkScopeRealism(
  saasName: string,
  saasUrl: string,
): Promise<ScopeAssessment> {
  const result = await generateObject({
    model: getModel(),
    schema: ScopeAssessmentSchema,
    prompt: `Classify "${saasName}" (${saasUrl}) by how realistic it is to spec as an MVP-sized derivative product.

Categories (use the descriptions as calibration — judge based on the actual feature surface and product breadth, not on brand recognition):

  focused — a single, well-bounded product doing one job. Typical
  surface: ~10-30 features across 3-6 areas. A small team built it.
  distilr will spec it cleanly. Examples of categories: form builders,
  link-in-bio tools, schedulers, single-stack analytics dashboards,
  newsletter tools, single-purpose CRMs, lightweight project trackers,
  read-later apps, single-purpose chat clients.

  broad — multiple products bundled in one platform, or a single
  product with many distinct large feature areas. distilr can work,
  but the user must aggressively narrow during the area picker.
  Typical surface: ~50-100 features across 8-15 areas. Examples of
  categories: all-in-one workspace tools, full-suite marketing
  platforms, multi-purpose database / no-code platforms, sales /
  support / ticketing platforms with several embedded products.

  sprawling — vast enterprise platforms or creative-app suites with
  many distinct flagship products under one brand. distilr will
  produce shallow generic output. Strongly suggest narrowing to a
  specific sub-product before continuing. Typical surface: 200+
  features across many flagship sub-products. Examples of categories:
  enterprise CRMs, ERPs, HR platforms, IT-service-management suites,
  office productivity bundles, creative-design suites, CAD packages.

For broad/sprawling, narrowingSuggestion should be a concrete sub-product or single module description (e.g. "the support-ticket / Cases surface"; "the color-correction surface"; "the doc-editor with comments and shares") — describe the surface, don't name the parent brand.

For focused, narrowingSuggestion is an empty string.`,
  });
  return result.object;
}
