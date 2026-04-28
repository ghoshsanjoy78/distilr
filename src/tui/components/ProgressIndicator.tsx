import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Stage } from "../../store/schemas.js";
import { ShimmerText } from "./ShimmerText.js";
import { useBusState } from "../hooks.js";
import { colors } from "../colors.js";
import type { AgentEvent, BusState } from "../bus.js";

/**
 * Static "the agent is working" verbs for the long-running streamText
 * loops. These render whenever the stage is active, even between
 * tool calls / model turns where no activity event is in flight —
 * the shimmer is always there to tell the user "yes, something IS
 * happening on this stage right now."
 */
const STATIC_STAGE_VERBS: Partial<Record<Stage, string>> = {
  recon: "recon agent working",
  explore: "explorer agent working",
};

function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v < 1000) return String(v);
  if (v < 100000) return `${(v / 1000).toFixed(1)}k`;
  return `${Math.round(v / 1000)}k`;
}

function formatSecs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem}s`;
}

/**
 * Walk back through events to find the most recent info / warning
 * with text ending in an ellipsis ("…" or "..."). That's our signal
 * that some short-running operation (a one-shot LLM call: scope
 * check, synth, architect, app-ideas, feature classification, etc.)
 * is in progress.
 *
 * If a more recent info/warning DOESN'T end with ellipsis, return
 * null — that means the "…" operation completed (most recent
 * messaging is post-completion text, no longer "thinking…").
 */
function findActiveEllipsisVerb(state: BusState): string | null {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e: AgentEvent | undefined = state.events[i];
    if (!e) continue;
    if (e.kind !== "info" && e.kind !== "warning") continue;
    const text = (e as { text?: string }).text;
    if (typeof text !== "string") continue;
    if (text.endsWith("…") || text.endsWith("...")) {
      // Strip trailing punctuation and surrounding whitespace; we'll
      // append the shimmer's own "…" decoration when rendering.
      return text.replace(/[.…\s]+$/u, "").trim();
    }
    // Most recent info/warning isn't an in-flight indicator → done.
    return null;
  }
  return null;
}

/**
 * Live "the agent is working" indicator at the bottom of the activity
 * feed. Two modes:
 *
 *   1. STATIC stage verbs (recon, explore) — agents that loop for
 *      tens of turns; they should always show "agent working".
 *
 *   2. DYNAMIC verbs from the event log — for stages with one-shot
 *      LLM calls (synthesize, architect, scope check at stage 1,
 *      wizard's app-ideas + feature-classifier). The most recent
 *      "…"-ending info / warning event becomes the shimmer text. When
 *      that operation finishes (next event has no ellipsis), the
 *      indicator hides.
 *
 * Renders nothing if neither signal is active.
 *
 * Layout:  ✶ <shimmering verb…>  (Ns since last update · ↑ Nk tokens)
 *
 * The shimmer animation runs on its own timer inside ShimmerText. The
 * "Ns since last update" ticks via a 1-Hz interval here. Token counts
 * are pulled from the AgentBus and update whenever runAgent emits new
 * counts (every ~100 chars of model output).
 */
export function ProgressIndicator() {
  const state = useBusState();
  // Stages with one big structured-output call drive `statusOverride`
  // directly so the shimmer can track WHICH field is streaming in
  // without spamming the activity feed with one event per field.
  const overrideVerb = state.statusOverride;
  const staticVerb = overrideVerb
    ? null
    : state.stage
      ? STATIC_STAGE_VERBS[state.stage]
      : undefined;
  const dynamicVerb =
    overrideVerb || staticVerb ? null : findActiveEllipsisVerb(state);
  const verb = overrideVerb ?? staticVerb ?? dynamicVerb ?? null;

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!verb) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [verb]);

  if (!verb) return null;

  const elapsed = formatSecs((now - state.lastEventAt) / 1000);
  const tokensOut = state.stats.tokensOut;
  const showTokens = tokensOut > 0;

  return (
    <Box marginTop={1}>
      <Text color={colors.warning}>
        <Spinner type="dots" />
      </Text>
      <Text> </Text>
      <ShimmerText text={`${verb}…`} />
      <Text color={colors.dim}>  (</Text>
      <Text color={colors.dim}>{elapsed} since last update</Text>
      {showTokens ? (
        <>
          <Text color={colors.dim}> · </Text>
          <Text color={colors.accent}>↑ {formatTokens(tokensOut)} tokens</Text>
        </>
      ) : null}
      <Text color={colors.dim}>)</Text>
    </Box>
  );
}
