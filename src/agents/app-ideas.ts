// Single generateObject call that produces a few paired "app name +
// one-line description" suggestions for the wizard. Inputs: the source
// SaaS name + the synthesized feature catalog. Output: 3-6 product ideas
// the user can pick from in stage 06.
//
// Kept deliberately thin — no agent loop, no tools. One round-trip.

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../providers.js";
import { FeatureCatalog } from "../store/schemas.js";
import { PROMPT_GUIDELINES } from "./guidelines.js";

// Schemas kept loose — Gemini's structured-output rejects array minItems
// other than 0/1 and is strict about string length constraints. We
// communicate sizing via .describe() and validate manually after.
export const AppIdeaSchema = z.object({
  name: z.string().describe("Short, memorable product name — 1-3 words"),
  description: z
    .string()
    .describe(
      "One sentence (~12-20 words) describing what this product lets users do",
    ),
});
export type AppIdea = z.infer<typeof AppIdeaSchema>;

const IdeasResultSchema = z.object({
  ideas: z
    .array(AppIdeaSchema)
    .describe(
      "3-6 distinct product directions — each varied in tone and angle",
    ),
});

export async function generateAppIdeas(
  catalog: FeatureCatalog,
): Promise<AppIdea[]> {
  const featureSummary = catalog.categories
    .map(
      (c) =>
        `${c.name}: ${c.features.map((f) => f.name).join(", ")}`,
    )
    .join("\n");

  const prompt = `You are helping someone build a product inspired by the SaaS "${catalog.source}". Suggest 4 distinct product directions — each with a catchy name and a one-line description.

The source product's features (organized by category):
${featureSummary}

Rules:
- Names: short (1-3 words), memorable, original. NO trademark infringement — do not produce a slight modification of the source SaaS's name (e.g. swapping a vowel, adding a suffix), and do not produce a name that's a real product on the market. Mix styles — some descriptive, some evocative, some abstract.
- Descriptions: one sentence, ~12-20 words, action-focused — what it lets users DO.
- The 4 ideas should differ meaningfully in angle (e.g. "for solo users", "open-source", "AI-native", "vertical-specific") so the user has real choices.
- Don't be cute or punny if it sounds forced. Boring-but-clear beats clever-but-confusing.

${PROMPT_GUIDELINES}`;

  const result = await generateObject({
    model: getModel(),
    schema: IdeasResultSchema,
    prompt,
  });
  // Cap at 6, drop any suspiciously empty entries.
  return result.object.ideas
    .filter((i) => i.name.trim().length > 0 && i.description.trim().length > 0)
    .slice(0, 6);
}
