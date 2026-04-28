/**
 * Type-safe Pick for tools dicts. Used by each agent to slice the full
 * tool surface (e.g. all browser tools) down to the subset the agent
 * actually needs. Loose value type — AI-SDK's Tool<I, O> is invariant
 * on I, so a stricter constraint forces awkward casts at every call site.
 */
export function pickTools<
  T extends Record<string, unknown>,
  K extends keyof T,
>(src: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = src[k];
  return out;
}
