import type { Bus } from "../tui/bus.js";

interface StreamPart {
  type: string;
  [k: string]: unknown;
}

interface StreamLike {
  fullStream: AsyncIterable<StreamPart>;
}

function shortUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.host}${path}${u.search}`;
  } catch {
    return raw;
  }
}

function firstSentence(s: string, max = 200): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const m = trimmed.match(/^(.+?[.!?])(\s|$)/);
  const candidate = m ? m[1]! : trimmed;
  if (candidate.length <= max) return candidate;
  return candidate.slice(0, max - 1) + "…";
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content && typeof content === "object" && "result" in content) {
    return extractToolResultText((content as { result: unknown }).result);
  }
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c
          ? String((c as { text: unknown }).text)
          : "",
      )
      .filter(Boolean)
      .join(" ");
  }
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function isCreditError(message: string): boolean {
  return /credit balance|insufficient/i.test(message);
}

function isStepLimit(message: string): boolean {
  return (
    /max(?:imum)? (?:number of )?steps?/i.test(message) ||
    /step limit/i.test(message) ||
    /max_steps/i.test(message) ||
    /maximum number of turns/i.test(message)
  );
}

function isAbort(e: Error): boolean {
  return (
    e.name === "AbortError" ||
    /\baborted\b/i.test(e.message) ||
    /signal\s+is\s+aborted/i.test(e.message)
  );
}

/**
 * Iterate an AI SDK fullStream, translating events into bus events.
 * Accumulates text-delta into per-step assistant messages.
 *
 * - Tool calls are surfaced as `nav`, `obs`, `submit`, `destructive-request`,
 *   `ask-user-request` events depending on the tool name.
 * - Tool errors → `tool-error` events.
 * - Hitting the step limit is a soft completion (warning + return).
 * - Other model errors are re-thrown so the pipeline can show them in the
 *   error screen with a resume hint.
 */
export async function runAgent(
  result: StreamLike,
  label: string,
  bus: Bus,
): Promise<void> {
  let buffer = "";
  const flushText = () => {
    const beat = firstSentence(buffer);
    if (beat) bus.emit({ kind: "agent-text", text: beat });
    buffer = "";
  };

  // Streaming output token estimate, flushed at step boundaries.
  // (Previously we also tracked tool-input-delta milestones for the
  // big architect_submit / catalog_submit calls, but those agents now
  // use generateObject — neither big-payload tool exists anymore.)

  // Live-token estimate: count chars from text-delta and tool-input-delta
  // (~4 chars per token), then reconcile against the accurate usage on
  // step-finish / finish events.
  let estimatedOutputCharsThisStep = 0;
  const flushEstimatedTokens = () => {
    if (estimatedOutputCharsThisStep > 0) {
      bus.addTokens(0, estimatedOutputCharsThisStep / 4);
      estimatedOutputCharsThisStep = 0;
    }
  };

  try {
    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta": {
          // AI SDK 5+ uses `text` for the delta string on text-delta parts.
          const delta =
            (part as { text?: string; textDelta?: string }).text ??
            (part as { textDelta?: string }).textDelta ??
            "";
          buffer += delta;
          estimatedOutputCharsThisStep += delta.length;
          // Push estimate to bus periodically (every ~100 chars) so the
          // UI ticks live without spamming setState.
          if (estimatedOutputCharsThisStep >= 100) {
            flushEstimatedTokens();
          }
          break;
        }
        case "text-end":
        case "finish-step":
        case "step-finish": {
          flushText();
          flushEstimatedTokens();
          // If the SDK reports accurate step-level usage, reconcile —
          // we may have estimated low or high. Add the "true" delta on
          // top of what we've already accumulated.
          const usage = (
            part as {
              usage?: {
                inputTokens?: number;
                outputTokens?: number;
                promptTokens?: number;
                completionTokens?: number;
              };
            }
          ).usage;
          if (usage) {
            const stepIn = usage.inputTokens ?? usage.promptTokens ?? 0;
            const stepOut = usage.outputTokens ?? usage.completionTokens ?? 0;
            // input is only known at step boundary; just add it through.
            // For output, the estimate already counted approx; we add the
            // residual (true - estimate) which can be negative.
            // Simpler: just trust the SDK and add input only — output
            // estimate is "good enough" for the live feel.
            bus.addTokens(stepIn, 0);
          }
          break;
        }
        case "tool-input-delta": {
          // Count tool-input streaming as output tokens too. (We no
          // longer parse phase/category progress here — both big-payload
          // submit tools have moved to generateObject.)
          const delta =
            (part as { delta?: string; input_text_delta?: string }).delta ??
            (part as { input_text_delta?: string }).input_text_delta ??
            "";
          estimatedOutputCharsThisStep += delta.length;
          if (estimatedOutputCharsThisStep >= 100) {
            flushEstimatedTokens();
          }
          break;
        }
        case "tool-call": {
          const tc = part as unknown as {
            toolName: string;
            input?: Record<string, unknown>;
            args?: Record<string, unknown>;
          };
          const toolName = tc.toolName;
          const input = (tc.input ?? tc.args ?? {}) as Record<string, unknown>;

          if (toolName === "browser_navigate") {
            const url = (input.url as string) ?? "";
            bus.emit({
              kind: "nav",
              url: shortUrl(url),
              pageNumber: bus.getState().stats.pages + 1,
            });
            break;
          }
          if (toolName === "notes_append") {
            const obsKind = (input.kind as string) ?? "?";
            bus.emit({
              kind: "obs",
              obsKind,
              total: bus.getState().stats.observations + 1,
            });
            break;
          }
          // catalog_submit and architect_submit no longer flow through
          // streamText — those agents now use generateObject. The
          // submit events are emitted directly by the agents.
          if (toolName === "ask_user") {
            const q = (input.question as string) ?? "(question)";
            bus.emit({ kind: "ask-user-request", question: q });
            break;
          }
          if (toolName === "browser_click_destructive") {
            const reason = (input.reason as string) ?? "destructive click";
            bus.emit({ kind: "destructive-request", description: reason });
            break;
          }
          // Read-only/silent tools (browser_get_text, list_links, screenshot,
          // etc.) — no event needed.
          break;
        }
        case "tool-error": {
          const msg = extractToolResultText(
            (part as { error?: unknown }).error,
          );
          bus.emit({
            kind: "tool-error",
            message: firstSentence(msg, 240) || "tool error",
          });
          break;
        }
        case "error": {
          const errPart = part as { error?: unknown };
          const msg =
            (errPart.error instanceof Error
              ? errPart.error.message
              : extractToolResultText(errPart.error)) || "model error";
          throw new Error(msg);
        }
        case "finish": {
          flushText();
          break;
        }
        default:
          break;
      }
    }
    flushText();
  } catch (e) {
    flushText();
    const err = e as Error;
    const message = err.message ?? String(e);
    if (isAbort(err)) {
      // The agent's per-attempt restart loop will inspect bus.takeInterruptIntent()
      // and decide what to do (exit cleanly or restart with guidance).
      return;
    }
    if (isStepLimit(message)) {
      bus.emit({
        kind: "warning",
        text: `[${label}] hit step budget — continuing with partial results`,
      });
      return;
    }
    if (isCreditError(message)) {
      throw new Error(`Credit balance is too low — ${message}`);
    }
    throw e;
  }
}

