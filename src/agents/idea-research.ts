// Two one-shot generateObject calls that turn a user's free-text product
// idea into a curated list of existing SaaS products to study. Used by
// stage 01 when the user hasn't decided on a specific SaaS to study.
//
// Step 1: produce 2-3 clarifying questions (skippable).
// Step 2: produce 5-8 SaaS suggestions with name + URL + one-liner.
//
// Schemas kept loose — provider structured-output validators (notably
// Anthropic's `output_config.format`) reject array min/max constraints.

import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "../providers.js";

export const SaasSuggestionSchema = z.object({
  name: z.string().describe("Real product name (no fictional companies)."),
  url: z
    .string()
    .describe(
      "Real marketing URL, including https:// — must point to an actual product, not a placeholder.",
    ),
  oneLiner: z
    .string()
    .describe("One-sentence description of what the product does."),
  why: z
    .string()
    .describe(
      "One short sentence explaining why this matches the user's idea (helps them choose).",
    ),
});
export type SaasSuggestion = z.infer<typeof SaasSuggestionSchema>;

const ClarifyingQuestionsSchema = z.object({
  questions: z
    .array(z.string())
    .describe(
      "2-3 short clarifying questions. One sentence each. Focus on target audience, narrowest valuable use case, and what makes the user's vision different.",
    ),
});

const SuggestionsSchema = z.object({
  suggestions: z
    .array(SaasSuggestionSchema)
    .describe(
      "5-8 existing SaaS products that match the user's idea. Mix well-known leaders, smaller alternatives, and notably different takes.",
    ),
});

export async function generateClarifyingQuestions(
  idea: string,
): Promise<string[]> {
  const result = await generateObject({
    model: getModel(),
    schema: ClarifyingQuestionsSchema,
    prompt: `A user wants to build a SaaS product. Their idea:

"${idea}"

Generate 2-3 brief clarifying questions to narrow down what they actually want. Keep each question to one sentence. Useful angles:
- Who's the user / target audience?
- What's the smallest valuable use case?
- What would make this different from existing tools?
- What's the scope — solo product, team product, enterprise?

Skip generic questions ("what's your timeline?"). Ask things that genuinely change what SaaS we'd recommend they study.`,
  });
  return result.object.questions
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .slice(0, 3);
}

export async function suggestSaaSProducts(
  idea: string,
  clarifications: { question: string; answer: string }[],
): Promise<SaasSuggestion[]> {
  const clarifyText = clarifications
    .filter((c) => c.answer.trim().length > 0)
    .map((c) => `Q: ${c.question}\nA: ${c.answer}`)
    .join("\n\n");

  const result = await generateObject({
    model: getModel(),
    schema: SuggestionsSchema,
    prompt: `A user wants to build a SaaS. Their idea:

"${idea}"

${clarifyText ? `Their clarifications:\n${clarifyText}\n\n` : ""}Suggest 5-8 EXISTING SaaS products that match this idea — products distilr could analyze to inform what the user should build. Mix:
  - 2-3 well-known leaders in the category
  - 2-3 smaller / niche / indie alternatives (often more approachable than the giants)
  - 1-2 notably different takes on the same problem

Rules:
  - REAL products only. Do NOT invent products. If you're unsure a product exists, skip it.
  - URLs must be real and direct (https://product.com), NOT search results or aggregators.
  - One-liner: what the product does, in one short sentence.
  - "why" line: why this is a useful study target for the user's idea (e.g. "matches your <X> requirement", "smaller scope than <Y>, easier to spec").

If the user's idea is vague, lean toward the most common interpretations. If it's very specific, pick the closest matches even if they're niche.`,
  });
  return result.object.suggestions
    .filter((s) => {
      if (!s.name?.trim() || !s.url?.trim()) return false;
      try {
        const u = new URL(s.url);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 8);
}
