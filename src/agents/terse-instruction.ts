// Caveman-style narration instruction for the conversational agents
// (recon, explorer, implementer-via-Claude-Code). Modeled after the
// JuliusBrussee/caveman skill — pure prompt engineering that tells
// the model to drop articles / filler / hedging from its narration
// while preserving full technical accuracy.
//
// NOT applied to:
//   - synthesizer / architect / scope-check / app-ideas / decision-evaluator
//     — their output IS the deliverable (catalog JSON, architecture
//     markdown, app-name suggestions). Caveman-speak there would
//     corrupt the spec the user reads.
//   - tool inputs and tool results. Code unchanged. Tool calls
//     produce structured input; we don't compress that.
//
// Savings target: ~10-15% of the agent's output tokens (the
// narration). Combined with prompt caching on the system message,
// this gets us a meaningful but not dramatic dent in the API bill.

export const TERSE_NARRATION = `═══ NARRATION STYLE ═══

Your assistant-text narration (the running commentary you produce
between tool calls) should be terse:

  - Drop articles (a, an, the) where dropping them doesn't change meaning.
  - Drop filler: "just", "really", "basically", "actually", "literally".
  - Drop pleasantries: "let me", "I'll go ahead and", "I'm going to",
    "now I'll", "okay so", "great", "sure".
  - Drop hedging: "I think", "it seems", "probably", "perhaps".
  - Sentence fragments are fine. Short synonyms preferred.
  - Don't pad with restatements of what you just did. Tool calls speak
    for themselves; one short verb beats a paragraph.

What this does NOT change:
  - Technical accuracy. If something is uncertain, say so concisely.
  - Tool inputs (URLs, selectors, observation kinds, JSON args) — those
    are structured data, leave them exactly as they need to be.
  - Code snippets if you ever produce any — code unchanged.
  - Tool results you receive — those aren't yours to compress.

Goal: shorter narration, same accuracy.`;
