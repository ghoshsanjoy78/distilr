// Make page-extracted text safe to send back to LLM providers as JSON.
//
// Two failure modes we defend against:
//
// 1. Truncation that splits a UTF-16 surrogate pair. `string.slice(0, n)`
//    operates on code units, not graphemes — emoji and many other chars
//    take TWO code units. Cutting between them leaves a lone high
//    surrogate, which JSON parsers (Anthropic's, OpenAI's) reject:
//        "no low surrogate in string: line 1 column N (char N-1)"
//
// 2. Page content that already contains lone surrogates. Some sites
//    emit malformed text (e.g. via document.title or aria-label
//    interpolation gone wrong). Round-tripping through UTF-8 replaces
//    lone surrogates with U+FFFD, which is valid JSON.

const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;

function isHighSurrogate(code: number): boolean {
  return code >= HIGH_SURROGATE_START && code <= HIGH_SURROGATE_END;
}

/**
 * Truncate `s` to at most `max` UTF-16 code units, never splitting a
 * surrogate pair, then round-trip through UTF-8 to strip any lone
 * surrogates that may already exist in the input. Always returns a
 * string that's safe to embed as a JSON string.
 */
export function safeTruncate(s: string, max: number): string {
  let result = s;
  if (result.length > max) {
    let cut = max;
    if (cut > 0 && isHighSurrogate(result.charCodeAt(cut - 1))) {
      cut -= 1;
    }
    result = result.slice(0, cut);
  }
  return sanitizeForJson(result);
}

/**
 * Round-trip through UTF-8 so any lone surrogates become U+FFFD. The
 * resulting string is valid UTF-16 with no orphan surrogates and is
 * safe to JSON.stringify into a request body.
 */
export function sanitizeForJson(s: string): string {
  return new TextDecoder("utf-8").decode(new TextEncoder().encode(s));
}
