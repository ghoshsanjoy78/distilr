// Canonical "how distilr studies a SaaS" guidelines. Single source of
// truth — every heavy agent (recon, explorer, synthesizer, architect,
// implementer, decision-evaluator, app-ideas) appends this to its
// system prompt, and the same content is mirrored in user-facing
// docs (README.md + site/index.html) so users can verify what the
// agents are told.
//
// The intent isn't ethical-aspiration — it's product positioning.
// distilr exists to inspire new MVPs, not to clone existing products.
// These rules keep both the agents and the output on the right side
// of "inspired by".

/**
 * Tight guidelines block for injection into agent system prompts.
 * Append to a system prompt with a divider so the model treats it
 * as a binding rule list.
 */
export const PROMPT_GUIDELINES = `═══ GUIDELINES — these apply to every action you take ═══

1. SOURCE CODE is off limits. Don't quote, copy, or transcribe any
   source you encounter (in the page, in DevTools, in network
   responses, anywhere). Summarize behavior and shape, never
   implementation. The user's coding agent writes new code from
   scratch — your job is to describe WHAT, not transcribe HOW.

2. UI DESIGN / LAYOUT / ASSETS — describe patterns ("two-column form
   with a progress bar across the top"), never pixel-perfect copies.
   Do not extract icons, illustrations, custom fonts, or brand
   assets for re-use. Take inspiration, not artifacts.

3. TEXT CONTENT — describe what the text accomplishes; don't quote
   it. Microcopy, onboarding flows, marketing copy, documentation,
   error messages — capture the intent and structure. New copy
   gets written for the new product.

4. TRADEMARKS AND BRANDING — never use the source's product name,
   logo, or trademarked phrases for the new product. Don't position
   the new product as the source's product. The output is
   inspired-by, never a substitute or knockoff.

5. THE SOURCE'S TERMS OF SERVICE — stay on the public, user-facing
   surface (pages a logged-in human can reach normally). Respect
   rate limits. Never reverse-engineer protected APIs. Don't bulk-
   scrape. If a page says "do not scrape", don't.

distilr studies SaaS to inform new MVPs — not to copy them. These
rules apply even when the spec or task seems to invite an exception.`;

/**
 * Short version for the user-facing docs (README.md, site/index.html).
 * Same five points, slightly more readable English. Markdown-ready.
 */
export const DOCS_GUIDELINES = `distilr studies a SaaS to inform a new MVP — never to clone it. Every agent in the pipeline operates under these rules:

1. **Never copy source code** (even partially). We capture behavior and shape; your coding agent writes new code from scratch.
2. **Never reproduce exact UI designs, layouts, or assets.** Describe patterns, not pixel-perfect copies. No extracting icons, illustrations, custom fonts, or brand assets.
3. **Never copy text content** — docs, onboarding flows, microcopy, error messages, marketing copy. Describe what the text accomplishes; new copy is written for the new product.
4. **Never use the source's trademarks or branding** in a way that could be confusing. The output is inspired-by, not a clone or knockoff. Pick a name that's clearly distinct.
5. **Respect the source's Terms of Service.** Stay on the user-facing surface. Respect rate limits. Don't reverse-engineer protected APIs. Don't bulk-scrape.

These are baked into every agent's system prompt — they're not optional and not something you opt into per-run.`;
