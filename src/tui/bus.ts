// Coordination layer between the agent loop and the React/Ink tree.
//
// - Pure TS, no React imports — so MCP tool callbacks can use it freely.
// - Singleton: getBus() returns the same instance.
// - Two patterns:
//     * fire-and-forget events  → bus.emit(e)
//     * modal request/response  → const a = await bus.askInput(...)
// - Listeners get a NEW state object on every change so React's
//   useSyncExternalStore detects updates by reference.

import type { Stage } from "../store/schemas.js";

export type AgentEvent =
  | { kind: "agent-text"; text: string }
  | { kind: "nav"; url: string; pageNumber: number }
  | { kind: "obs"; obsKind: string; total: number }
  | { kind: "submit"; what: "catalog" | "architecture" }
  | { kind: "destructive-request"; description: string }
  | { kind: "ask-user-request"; question: string }
  | { kind: "tool-error"; message: string }
  | { kind: "info"; text: string; color?: string }
  | { kind: "warning"; text: string }
  | { kind: "stage-change"; stage: Stage }
  | { kind: "stage-complete"; stage: Stage };

export interface Stats {
  pages: number;
  observations: number;
  obsByKind: Record<string, number>;
  errors: number;
  toolCalls: number;
  /** Cumulative input tokens consumed across the whole run. */
  tokensIn: number;
  /** Cumulative output tokens emitted by the model across the whole run. */
  tokensOut: number;
  /** When this run began (process start). Never reset on stage change. */
  startedAt: number;
}

export type SelectOption<T> = { label: string; value: T; description?: string };

export type ModalRequest =
  | {
      kind: "input";
      id: string;
      question: string;
      default?: string;
      placeholder?: string;
      resolve: (answer: string) => void;
      reject: (err: Error) => void;
    }
  | {
      kind: "select";
      id: string;
      question: string;
      /**
       * Optional multi-line preamble rendered above the question in
       * normal weight. Use for celebration banners, file-review
       * checklists, etc. — anything that would feel cramped jammed
       * into the bold question line.
       */
      description?: string;
      options: SelectOption<unknown>[];
      resolve: (answer: unknown) => void;
      reject: (err: Error) => void;
    }
  | {
      kind: "multiselect";
      id: string;
      question: string;
      options: SelectOption<unknown>[];
      minSelected?: number;
      resolve: (answer: unknown[]) => void;
      reject: (err: Error) => void;
    }
  | {
      kind: "confirm";
      id: string;
      question: string;
      default?: boolean;
      resolve: (answer: boolean) => void;
      reject: (err: Error) => void;
    }
  /**
   * Two-column picker. Each item starts in `left` or `right`; the user
   * keyboard-navigates and presses space to move items between columns.
   * Used by stage 6 (wizard) for must-have / nice-to-have feature
   * triage. Could be reused for any "choose between two buckets" flow.
   */
  | {
      kind: "dual-list";
      id: string;
      question: string;
      leftLabel: string;
      rightLabel: string;
      /** Multi-line context shown above the columns. Markdown not parsed — plain text. */
      description?: string;
      items: Array<{
        id: string;
        label: string;
        side: "left" | "right";
        meta?: string;
        reasoning?: string;
      }>;
      /** Hard cap on left-column count. Picker blocks moves that would exceed this. */
      maxLeft?: number;
      /** Soft floor on left-column count. Picker shows a confirm warning at submit if below. */
      minLeft?: number;
      /**
       * When true, the picker renders read-only and ignores keyboard
       * input. Used while a streaming pre-classification is filling
       * in items live. Caller flips this off via `updateDualList`
       * once streaming completes.
       */
      loading?: boolean;
      /** Banner text rendered while `loading` is true (e.g. "12/33 classified…"). */
      loadingMessage?: string;
      resolve: (answer: { leftIds: string[]; rightIds: string[] }) => void;
      reject: (err: Error) => void;
    };

export interface BusState {
  stage: Stage | null;
  events: AgentEvent[];
  stats: Stats;
  modal: ModalRequest | null;
  done: boolean;
  error: Error | null;
  /** Identifies the active project (slug). Null until target stage runs. */
  projectSlug: string | null;
  projectSaasName: string | null;
  /**
   * Timestamp (ms epoch) of the most recently emitted event. Used to
   * render a "still working — N seconds since last update" hint when
   * an agent is silent. Defaults to bus creation time.
   */
  lastEventAt: number;
  /**
   * Which stage the user is currently *viewing* in the right pane. By
   * default this auto-follows `stage` (the live active stage), but the
   * user can navigate to any visited stage via the left sidebar to see
   * its summary. Null until the first stage starts.
   */
  selectedStage: Stage | null;
  /**
   * Live "what's the agent doing right now" override for
   * ProgressIndicator. When set, the shimmer renders this text
   * verbatim instead of the static-stage verb or the most-recent
   * "…"-ending event. Used by stages with one big structured-output
   * call (e.g. architect.ts) to surface the field currently
   * streaming in. Cleared back to null when the operation finishes.
   */
  statusOverride: string | null;
}

const MAX_EVENTS = 500;

/**
 * Token totals that trigger a one-shot warning when crossed. The
 * spec-generation pipeline (stages 1-8) is the only place that burns
 * provider tokens — stage 9 makes no LLM calls, just walks the user
 * through the prompt deck.
 */
const TOKEN_THRESHOLDS = [50_000, 200_000, 500_000] as const;

function freshStats(): Stats {
  return {
    pages: 0,
    observations: 0,
    obsByKind: {},
    errors: 0,
    toolCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    startedAt: Date.now(),
  };
}

function freshState(): BusState {
  return {
    stage: null,
    events: [],
    stats: freshStats(),
    modal: null,
    done: false,
    error: null,
    projectSlug: null,
    projectSaasName: null,
    lastEventAt: Date.now(),
    selectedStage: null,
    statusOverride: null,
  };
}

function applyEvent(state: BusState, e: AgentEvent): BusState {
  let stats = state.stats;
  let stage = state.stage;
  let selectedStage = state.selectedStage;

  if (e.kind === "stage-change") {
    // Cumulative stats across the whole run — do NOT reset here, so the
    // user sees their total progress instead of watching counters zero
    // out every time a stage transitions.
    stage = e.stage;
    // Auto-follow rule: if the user was watching the previously-active
    // stage live (or hadn't picked anything yet), keep following the
    // new active stage. If they had navigated to a *past* stage to
    // inspect it, leave selection alone — they're reading something
    // and we shouldn't yank them away.
    if (selectedStage === null || selectedStage === state.stage) {
      selectedStage = e.stage;
    }
  } else if (e.kind === "nav") {
    stats = { ...stats, pages: stats.pages + 1 };
  } else if (e.kind === "obs") {
    stats = {
      ...stats,
      observations: stats.observations + 1,
      obsByKind: {
        ...stats.obsByKind,
        [e.obsKind]: (stats.obsByKind[e.obsKind] ?? 0) + 1,
      },
    };
  } else if (e.kind === "tool-error") {
    stats = { ...stats, errors: stats.errors + 1 };
  }

  const events = [...state.events, e];
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);

  return {
    ...state,
    stage,
    selectedStage,
    stats,
    events,
    lastEventAt: Date.now(),
  };
}

/**
 * The user's choice when they press 'p' during recon/explore. Set by
 * openInterruptModal(); consumed by the agent's restart loop.
 */
export type InterruptIntent =
  | "exit"
  | { kind: "guidance"; text: string }
  | null;

class AgentBus {
  private state: BusState = freshState();
  private listeners = new Set<(s: BusState) => void>();
  private nextId = 0;
  private currentAbortController: AbortController | null = null;
  private interruptIntent: InterruptIntent = null;
  /** Token-budget thresholds we've already warned about this run. */
  private warnedThresholds = new Set<number>();

  getState(): BusState {
    return this.state;
  }

  subscribe(fn: (s: BusState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private setState(s: BusState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  emit(e: AgentEvent): void {
    this.setState(applyEvent(this.state, e));
  }

  setProject(slug: string, saasName: string): void {
    this.setState({ ...this.state, projectSlug: slug, projectSaasName: saasName });
  }

  /**
   * Increment cumulative token counters. Called by the agent runners as
   * tokens stream in (rough chars/4 estimate during text-delta) and
   * again with the accurate value at step boundaries / finish events.
   *
   * Side effect: emits a one-shot warning the first time the cumulative
   * total crosses each budget threshold (50k / 200k / 500k tokens). Helps
   * the user catch a runaway run before it gets expensive.
   */
  addTokens(deltaIn: number, deltaOut: number): void {
    if (deltaIn === 0 && deltaOut === 0) return;
    const prevTotal = this.state.stats.tokensIn + this.state.stats.tokensOut;
    const tokensIn = Math.max(
      0,
      this.state.stats.tokensIn + Math.round(deltaIn),
    );
    const tokensOut = Math.max(
      0,
      this.state.stats.tokensOut + Math.round(deltaOut),
    );
    this.setState({
      ...this.state,
      stats: { ...this.state.stats, tokensIn, tokensOut },
    });

    // Threshold check — fire once per crossed threshold per run. Rough
    // cost estimate uses a Sonnet-blended ~$15 / 1M tokens; the message
    // says "rough" so users don't read it as billing-grade.
    const newTotal = tokensIn + tokensOut;
    for (const t of TOKEN_THRESHOLDS) {
      if (prevTotal < t && newTotal >= t && !this.warnedThresholds.has(t)) {
        this.warnedThresholds.add(t);
        const dollars = ((newTotal * 15) / 1_000_000).toFixed(2);
        const tokens =
          t >= 1000 ? `${Math.round(t / 1000)}k` : `${t}`;
        this.emit({
          kind: "warning",
          text: `This run has used ~${tokens} tokens (~$${dollars} rough estimate). Press 'p' to interrupt and steer if the agent is wandering.`,
        });
      }
    }
  }

  /**
   * Set the stage the user is viewing in the right pane. Pass `null`
   * to fall back to auto-follow (selectedStage tracks the live stage).
   */
  selectStage(stage: Stage | null): void {
    if (this.state.selectedStage === stage) return;
    this.setState({ ...this.state, selectedStage: stage });
  }

  /**
   * Snap the right-pane selection back to the live active stage.
   * Used when the user presses 0 / Tab / Esc-when-no-modal, or
   * automatically when a modal opens (so the prompt is visible).
   */
  snapToActive(): void {
    const live = this.state.stage;
    if (this.state.selectedStage === live) return;
    this.setState({ ...this.state, selectedStage: live });
  }

  setError(error: Error): void {
    this.setState({ ...this.state, error });
  }

  /**
   * Clear the error state. Used when the user picks "retry" from the
   * error screen — the next pipeline run starts with a clean error
   * field, while events / stats / selectedStage / projectSlug all
   * persist (so the activity-feed history is preserved across retries).
   */
  clearError(): void {
    if (this.state.error === null) return;
    this.setState({ ...this.state, error: null });
  }

  setDone(): void {
    this.setState({ ...this.state, done: true });
  }

  reset(): void {
    this.setState(freshState());
  }

  // ─── Modal API ──────────────────────────────────────────────────────────

  askInput(
    question: string,
    options?: { default?: string; placeholder?: string },
  ): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const id = String(++this.nextId);
      this.setState({
        ...this.state,
        modal: {
          kind: "input",
          id,
          question,
          default: options?.default,
          placeholder: options?.placeholder,
          resolve,
          reject,
        },
      });
    });
  }

  askSelect<T>(
    question: string,
    options: SelectOption<T>[],
    opts?: { description?: string },
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = String(++this.nextId);
      this.setState({
        ...this.state,
        modal: {
          kind: "select",
          id,
          question,
          description: opts?.description,
          options: options as SelectOption<unknown>[],
          resolve: resolve as (a: unknown) => void,
          reject,
        },
      });
    });
  }

  askMultiSelect<T>(
    question: string,
    options: SelectOption<T>[],
    opts?: { minSelected?: number },
  ): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      const id = String(++this.nextId);
      this.setState({
        ...this.state,
        modal: {
          kind: "multiselect",
          id,
          question,
          options: options as SelectOption<unknown>[],
          minSelected: opts?.minSelected,
          resolve: resolve as (a: unknown[]) => void,
          reject,
        },
      });
    });
  }

  askConfirm(question: string, opts?: { default?: boolean }): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const id = String(++this.nextId);
      this.setState({
        ...this.state,
        modal: {
          kind: "confirm",
          id,
          question,
          default: opts?.default,
          resolve,
          reject,
        },
      });
    });
  }

  /**
   * Open a dual-pane picker. Items start in `left` or `right` based
   * on their `side` field; the user moves items between columns with
   * the keyboard. Resolves with the final `{ leftIds, rightIds }`
   * partition.
   */
  askDualList(opts: {
    question: string;
    leftLabel: string;
    rightLabel: string;
    description?: string;
    items: Array<{
      id: string;
      label: string;
      side: "left" | "right";
      meta?: string;
      reasoning?: string;
    }>;
    maxLeft?: number;
    minLeft?: number;
    loading?: boolean;
    loadingMessage?: string;
  }): Promise<{ leftIds: string[]; rightIds: string[] }> {
    return new Promise((resolve, reject) => {
      const id = String(++this.nextId);
      this.setState({
        ...this.state,
        modal: {
          kind: "dual-list",
          id,
          question: opts.question,
          leftLabel: opts.leftLabel,
          rightLabel: opts.rightLabel,
          description: opts.description,
          items: opts.items,
          maxLeft: opts.maxLeft,
          minLeft: opts.minLeft,
          loading: opts.loading,
          loadingMessage: opts.loadingMessage,
          resolve,
          reject,
        },
      });
    });
  }

  /**
   * Mutate the active dual-list modal in place. Used by the wizard's
   * streaming classifier to push partial classifications into the
   * picker as they arrive, and to flip `loading` off when the stream
   * settles. No-op if the active modal isn't dual-list (e.g. the
   * user closed it in the meantime via cancelModal).
   */
  updateDualList(updates: {
    /**
     * If set, the update is dropped unless the active dual-list modal
     * has this id. Used by the wizard to discard partial writes from
     * a stream that started before the user back-navved out.
     */
    id?: string;
    items?: Array<{
      id: string;
      label: string;
      side: "left" | "right";
      meta?: string;
      reasoning?: string;
    }>;
    loading?: boolean;
    loadingMessage?: string;
  }): void {
    const m = this.state.modal;
    if (!m || m.kind !== "dual-list") return;
    if (updates.id !== undefined && m.id !== updates.id) return;
    this.setState({
      ...this.state,
      modal: {
        ...m,
        items: updates.items ?? m.items,
        loading: updates.loading !== undefined ? updates.loading : m.loading,
        loadingMessage:
          updates.loadingMessage !== undefined
            ? updates.loadingMessage
            : m.loadingMessage,
      },
    });
  }

  resolveModal(answer: unknown): void {
    const m = this.state.modal;
    if (!m) return;
    this.setState({ ...this.state, modal: null });
    // Cast is safe — each kind's resolve has the right signature for what we got.
    (m.resolve as (a: unknown) => void)(answer);
  }

  cancelModal(reason = "user cancelled"): void {
    const m = this.state.modal;
    if (!m) return;
    this.setState({ ...this.state, modal: null });
    m.reject(new Error(reason));
  }

  /**
   * Drive the ProgressIndicator shimmer directly, bypassing the
   * stage-static-verb / latest-ellipsis-event lookup. Pass a fresh
   * string to update what the user sees; pass null to clear the
   * override and fall back to the default lookup. Stages with one
   * monolithic structured-output call (architect.ts) call this
   * repeatedly to track which doc / field is currently streaming.
   */
  setStatus(text: string | null): void {
    if (this.state.statusOverride === text) return;
    this.setState({ ...this.state, statusOverride: text });
  }

  // ─── Interrupt support (for recon/explore) ─────────────────────────────

  setAbortController(c: AbortController | null): void {
    this.currentAbortController = c;
  }

  abortCurrent(): void {
    this.currentAbortController?.abort();
  }

  takeInterruptIntent(): InterruptIntent {
    const intent = this.interruptIntent;
    this.interruptIntent = null;
    return intent;
  }

  /**
   * Open the interrupt-modal flow. Triggered from app.tsx when the user
   * presses 'p' during recon/explore. Stacks askSelect → optional askInput.
   *
   * - "exit"     → set intent to "exit" and abort the agent.
   * - "continue" → no-op, return immediately.
   * - "guidance" → ask for text, set intent to {guidance}, abort the agent.
   *
   * Resolves once the user has chosen. The agent observes the abort signal
   * asynchronously; the per-agent restart loop consumes the intent via
   * takeInterruptIntent().
   */
  async openInterruptModal(): Promise<void> {
    let choice: "exit" | "continue" | "guidance";
    try {
      choice = await this.askSelect<"exit" | "continue" | "guidance">(
        "Pause requested. What now?",
        [
          {
            label: "Stop now — use what's been recorded so far",
            value: "exit",
          },
          {
            label: "Keep going — dismiss this",
            value: "continue",
          },
          {
            label: "Send guidance to the agent and restart this step",
            value: "guidance",
          },
        ],
      );
    } catch {
      // modal was cancelled — treat as "continue"
      return;
    }

    if (choice === "continue") return;

    if (choice === "exit") {
      this.interruptIntent = "exit";
      this.abortCurrent();
      return;
    }

    // guidance
    let text: string;
    try {
      text = await this.askInput(
        "What guidance for the agent? (e.g. 'stop after pricing, skip docs')",
      );
    } catch {
      return; // cancelled — treat as continue
    }
    if (!text.trim()) return; // empty input — treat as continue
    this.interruptIntent = { kind: "guidance", text: text.trim() };
    this.abortCurrent();
  }
}

let _bus: AgentBus | null = null;
export function getBus(): AgentBus {
  if (!_bus) _bus = new AgentBus();
  return _bus;
}

export type Bus = AgentBus;
