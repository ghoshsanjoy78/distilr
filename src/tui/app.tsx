import React, { useEffect, useState } from "react";
import { render, useApp, useInput, Box } from "ink";
import { Layout } from "./components/Layout.js";
import { Header } from "./components/Header.js";
import { Footer } from "./components/Footer.js";
import { MainPane } from "./components/MainPane.js";
import { StageList } from "./components/StageList.js";
import { getBus } from "./bus.js";
import { useBusState } from "./hooks.js";
import { runFromStart, runFromResume } from "../pipeline.js";
import { readState } from "../store/project.js";
import { Stage, STAGES } from "../store/schemas.js";
import { installLogRedirect, uninstallLogRedirect } from "./log-redirect.js";
import { projectPaths } from "../store/project.js";
import { runSetupWizard } from "../setup/wizard.js";
import { isConfigValid } from "../providers.js";

interface AppProps {
  mode: "start" | "resume" | "config";
  slug?: string;
}

function hintForState(
  modal: boolean,
  done: boolean,
  error: boolean,
  stage: Stage | null,
): string {
  if (done) return "press q or enter to exit";
  if (error) return "press r to retry · q to exit";
  if (modal) {
    if (stage === "recon" || stage === "explore") {
      return "↑↓ navigate · enter confirm · esc dismiss · ctrl+c quit";
    }
    if (stage === "implement") {
      return "↑↓ option · enter confirm · ←→ prev/next prompt · ctrl+c quit";
    }
    return "↑↓ navigate · enter confirm · ctrl+c quit";
  }
  if (stage === "recon" || stage === "explore") {
    return "p interrupt · ↑↓ stages · 0 live · ctrl+c quit";
  }
  return "↑↓ stages · 0 live · ctrl+c quit";
}

function isInterruptibleStage(stage: Stage | null): boolean {
  return stage === "recon" || stage === "explore";
}

/**
 * Compute the highest-numbered stage the user is allowed to navigate
 * to. They can browse any completed stage + the active one. Future
 * (pending) stages are still navigable but show "not started yet".
 */
function maxNavigableIndex(
  active: Stage | null,
  lastCompleted: Stage | "none",
): number {
  let idx = -1;
  if (lastCompleted !== "none") idx = STAGES.indexOf(lastCompleted);
  if (active) idx = Math.max(idx, STAGES.indexOf(active));
  return idx;
}

function App({ mode, slug }: AppProps) {
  const { exit } = useApp();
  const state = useBusState();
  const [lastCompleted, setLastCompleted] = useState<Stage | "none">("none");
  // Bumped by the retry handler. The pipeline effect depends on it,
  // so incrementing this re-runs the pipeline from where it failed
  // (via runFromResume if a project exists, otherwise runFromStart).
  const [runVersion, setRunVersion] = useState(0);

  // Kick off the pipeline as soon as the TUI mounts. The setup wizard
  // and the project picker both surface modals via the bus; MainPane
  // renders pre-stage modals explicitly so they show up immediately.
  // Re-runs whenever `runVersion` increments (retry handler).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bus = getBus();
      try {
        if (mode === "config") {
          // Standalone wizard run — no pipeline afterwards.
          await runSetupWizard(bus);
        } else {
          // For start/resume, run the wizard FIRST if the config is
          // missing/invalid (typical first-run experience, OR after a
          // retry where the user reconfigured providers).
          if (!isConfigValid()) {
            bus.emit({
              kind: "info",
              text: "First-run setup — let's get you configured.",
            });
            await runSetupWizard(bus);
          }
          // Decide whether to start fresh or pick up from where we
          // left off. On the FIRST run with mode="start" we use
          // runFromStart (no project yet). On retry (runVersion > 0)
          // OR mode="resume", we use runFromResume — which reads
          // state.json's lastCompletedStage and re-attempts the next
          // stage. On retry without a slug yet (errored before stage 1
          // created the project), fall back to runFromStart.
          const liveSlug = bus.getState().projectSlug ?? slug;
          if (mode === "resume" || (runVersion > 0 && liveSlug)) {
            if (!liveSlug) throw new Error("resume requires a slug");
            await runFromResume(liveSlug, bus);
          } else {
            await runFromStart(bus);
          }
        }
        if (!cancelled) bus.setDone();
      } catch (e) {
        if (!cancelled) bus.setError(e as Error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, slug, runVersion]);

  // Refresh lastCompleted from state.json whenever a project is set or a stage completes.
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!state.projectSlug) return;
      try {
        const s = await readState(state.projectSlug);
        if (mounted) setLastCompleted(s.lastCompletedStage);
      } catch {
        // state.json may not exist yet
      }
    })();
    return () => {
      mounted = false;
    };
  }, [
    state.projectSlug,
    // re-fetch on every stage-complete event
    state.events.filter((e) => e.kind === "stage-complete").length,
  ]);

  // Global keybindings.
  useInput((input, key) => {
    const bus = getBus();

    if (state.done && (input === "q" || key.return)) {
      exit();
      return;
    }
    if (state.error) {
      // Retry: clear the error and re-run the pipeline. The effect
      // dependency on runVersion picks up the change and resumes from
      // wherever we left off (last completed stage + 1).
      if (input === "r" || input === "R") {
        bus.clearError();
        bus.snapToActive();
        setRunVersion((v) => v + 1);
        bus.emit({
          kind: "info",
          text: "──── Retrying… ────",
        });
        return;
      }
      if (input === "q" || key.escape) {
        exit();
        return;
      }
    }
    // Interrupt the recon/explore agent. Only fires when the run is live
    // and no other modal is currently demanding the user's attention.
    if (
      !state.done &&
      !state.error &&
      !state.modal &&
      isInterruptibleStage(state.stage) &&
      (input === "p" || input === "P")
    ) {
      void bus.openInterruptModal();
      return;
    }
    // Esc dismisses the currently-open modal in stages that opt in.
    //
    //   - Agent-stage interrupts (recon / explore): each call site
    //     (openInterruptModal, click_destructive, ask_user) already
    //     treats any rejection as "no input / continue", so dismissal
    //     is safe.
    //   - Wizard (stage 6): cancellation rewinds the wizard to its
    //     previous step. The wizard's step runner catches the "back"
    //     reason and re-renders the prior prompt with previous
    //     answers preserved as defaults.
    //
    // Other stages don't catch modal rejections, so we deliberately
    // do NOT cancel their modals on Esc — that would crash the run.
    if (
      key.escape &&
      state.modal &&
      !state.done &&
      !state.error &&
      (isInterruptibleStage(state.stage) || state.stage === "wizard")
    ) {
      bus.cancelModal(state.stage === "wizard" ? "back" : "dismissed by user");
      return;
    }

    // ─── Stage 9 prompt-deck nav (← prev / → next) ──────────────────
    // While a prompt-step modal is open, ← rewinds to the previous
    // prompt and → advances to the next. Implemented as modal cancels
    // with reasons "prev" / "next" — walkPromptDeck catches those and
    // moves the index accordingly. Faster than picking from the menu.
    if (
      state.stage === "implement" &&
      state.modal &&
      !state.done &&
      !state.error &&
      (key.leftArrow || key.rightArrow)
    ) {
      bus.cancelModal(key.leftArrow ? "prev" : "next");
      return;
    }

    // ─── Sidebar stage navigation ────────────────────────────────────
    // Only when there's no modal open and we're not on the final/error
    // screens. Lets the user browse summaries of completed stages
    // without pausing the live agent.
    if (state.modal || state.done || state.error) return;

    const maxIdx = maxNavigableIndex(state.stage, lastCompleted);
    if (maxIdx < 0) return;

    // 0 / Tab → snap back to live
    if (input === "0" || key.tab) {
      bus.snapToActive();
      return;
    }
    // ↑ / ↓ → move stage selection within [0, maxIdx]
    if (key.upArrow || key.downArrow) {
      const currentIdx = state.selectedStage
        ? STAGES.indexOf(state.selectedStage)
        : maxIdx;
      const next = key.upArrow
        ? Math.max(0, currentIdx - 1)
        : Math.min(maxIdx, currentIdx + 1);
      const nextStage = STAGES[next];
      if (nextStage && nextStage !== state.selectedStage) {
        bus.selectStage(nextStage);
      }
      return;
    }
    // Number keys 1-8 → jump directly to a stage
    const numMatch = input.match(/^[1-8]$/);
    if (numMatch) {
      const idx = parseInt(input, 10) - 1;
      if (idx <= maxIdx) {
        const nextStage = STAGES[idx];
        if (nextStage) bus.selectStage(nextStage);
      }
      return;
    }
  });

  return (
    <Layout
      header={
        <Header
          saasName={state.projectSaasName}
          slug={state.projectSlug}
        />
      }
      sidebar={
        <StageList
          active={state.stage}
          selected={state.selectedStage}
          lastCompleted={lastCompleted}
        />
      }
      pane={<MainPane state={state} lastCompleted={lastCompleted} />}
      footer={
        <Footer
          stats={state.stats}
          hint={hintForState(state.modal != null, state.done, state.error != null, state.stage)}
          showStats={!state.done && !state.error}
        />
      }
    />
  );
}

/**
 * Mount the Ink TUI for a start or resume run. Returns when the app
 * unmounts (user exited or pipeline finished).
 */
export async function renderApp(props: AppProps): Promise<void> {
  if (!process.stdout.isTTY) {
    throw new Error(
      "distilr requires an interactive terminal — pipes/CI are not supported.",
    );
  }

  // Determine log path. For "start" we don't yet know the slug; log to a
  // shared default until the project is initialized. Resume knows the slug.
  const logPath = props.slug
    ? projectPaths(props.slug).runLog
    : `${process.cwd()}/distilr.log`;
  installLogRedirect(logPath);

  try {
    const instance = render(<App mode={props.mode} slug={props.slug} />);
    await instance.waitUntilExit();
  } finally {
    uninstallLogRedirect();
  }

  // Print the final handoff command in plain text after Ink unmounts so
  // the user can copy/paste from a clean terminal. Use the same filter
  // as FinalScreen — events emitted during the emit stage.
  const state = getBus().getState();
  let emitStartIdx = -1;
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i];
    if (e && e.kind === "stage-change" && e.stage === "emit") {
      emitStartIdx = i;
      break;
    }
  }
  const eventSlice =
    emitStartIdx >= 0
      ? state.events.slice(emitStartIdx + 1)
      : state.events.slice(-12);
  const infoEvents = eventSlice.filter((e) => e.kind === "info");
  if (state.done && infoEvents.length > 0) {
    process.stdout.write("\n");
    for (const e of infoEvents) {
      if (e.kind === "info") process.stdout.write(`${e.text}\n`);
    }
    process.stdout.write("\n");
  }
  if (state.error) {
    process.stderr.write(`\n${state.error.message}\n`);
    process.exitCode = 1;
  }
}

// Suppress unused-import warning when JSX isn't recognized as React usage.
void React;
void Box;
