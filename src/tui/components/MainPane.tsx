// Right pane of the 2-column layout. Routes between three views:
//
//   - Live view: when the user is watching the active stage. Same
//     content as the old MainPane — activity feed + progress indicator
//     (+ modal if open).
//   - Past-stage summary: when the user has navigated to a completed
//     stage in the sidebar. One-paragraph summary read from disk.
//   - Pending hint: when the user has navigated to a future stage.
//
// Final + error screens override everything (whole-pane).

import React, { useEffect } from "react";
import { Box, Text } from "ink";
import { ModalRequest, BusState, getBus } from "../bus.js";
import { ActivityFeed } from "./ActivityFeed.js";
import { ProgressIndicator } from "./ProgressIndicator.js";
import { StageSummary } from "./StageSummary.js";
import { TextInputPrompt } from "./prompts/TextInputPrompt.js";
import { SelectPrompt } from "./prompts/SelectPrompt.js";
import { MultiSelectPrompt } from "./prompts/MultiSelectPrompt.js";
import { ConfirmPrompt } from "./prompts/ConfirmPrompt.js";
import { DualListPrompt } from "./prompts/DualListPrompt.js";
import { Stage, STAGES } from "../../store/schemas.js";
import { colors } from "../colors.js";

const STAGE_TITLES: Record<string, string> = {
  target: "Stage 1: Target",
  recon: "Stage 2: Public recon",
  login: "Stage 3: Login handoff",
  explore: "Stage 4: In-app exploration",
  synthesize: "Stage 5: Feature synthesis",
  wizard: "Stage 6: Product wizard",
  architect: "Stage 7: Architecture & phases",
  emit: "Stage 8: Emit project",
  implement: "Stage 9: Implement",
};

/**
 * Pull the optional preamble off a modal (only `select` and `dual-list`
 * carry one today). Returns null when there's nothing to render.
 * MainPane renders this ABOVE the bordered modal box so the box stays
 * focused on the actual question + actions.
 */
function modalDescription(modal: ModalRequest): string | null {
  if (modal.kind === "select") return modal.description ?? null;
  if (modal.kind === "dual-list") return modal.description ?? null;
  return null;
}

function ModalDescription({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {text.split("\n").map((line, i) => (
        // Empty Text collapses to height 0 in Ink, eating blank lines
        // the caller used to separate paragraphs. A single space
        // preserves the paragraph break visually.
        <Text key={i} color={colors.body} wrap="wrap">
          {line.length === 0 ? " " : line}
        </Text>
      ))}
    </Box>
  );
}

function ModalContent({ modal }: { modal: ModalRequest }) {
  const bus = getBus();
  if (modal.kind === "input") {
    return (
      <TextInputPrompt
        question={modal.question}
        defaultValue={modal.default}
        placeholder={modal.placeholder}
        onSubmit={(v) => bus.resolveModal(v)}
      />
    );
  }
  if (modal.kind === "select") {
    return (
      <SelectPrompt
        question={modal.question}
        options={modal.options}
        onSelect={(v) => bus.resolveModal(v)}
      />
    );
  }
  if (modal.kind === "multiselect") {
    return (
      <MultiSelectPrompt
        question={modal.question}
        options={modal.options}
        minSelected={modal.minSelected}
        onSubmit={(v) => bus.resolveModal(v)}
      />
    );
  }
  if (modal.kind === "dual-list") {
    return (
      <DualListPrompt
        question={modal.question}
        description={modal.description}
        leftLabel={modal.leftLabel}
        rightLabel={modal.rightLabel}
        items={modal.items}
        maxLeft={modal.maxLeft}
        minLeft={modal.minLeft}
        loading={modal.loading}
        loadingMessage={modal.loadingMessage}
        onSubmit={(answer) => bus.resolveModal(answer)}
      />
    );
  }
  return (
    <ConfirmPrompt
      question={modal.question}
      defaultValue={modal.default}
      onAnswer={(v) => bus.resolveModal(v)}
    />
  );
}

interface MainPaneProps {
  state: BusState;
  lastCompleted: Stage | "none";
}

export function MainPane({ state, lastCompleted }: MainPaneProps) {
  // If a modal is open, snap selection back to the live stage so the
  // prompt is visible. (User can't respond to a modal while looking at
  // a past-stage summary.)
  useEffect(() => {
    if (state.modal && state.selectedStage !== state.stage) {
      getBus().snapToActive();
    }
  }, [state.modal, state.selectedStage, state.stage]);

  // Final + error override everything.
  if (state.done) return <FinalScreen state={state} />;
  if (state.error) return <ErrorScreen state={state} />;

  const selected = state.selectedStage;

  // Pre-target: no stage has fired yet. The setup wizard and the
  // unfinished-project picker both surface modals BEFORE any
  // stage-change event lands, so we have to render those modals
  // explicitly here — otherwise they'd be invisible behind the
  // "starting…" placeholder and the run would silently hang.
  if (!selected) {
    if (state.modal) {
      const desc = modalDescription(state.modal);
      return (
        <Box flexDirection="column">
          <Text bold color={colors.warning}>
            distilr setup
          </Text>
          <Box marginTop={1} flexDirection="column">
            {desc ? <ModalDescription text={desc} /> : null}
            <Box
              borderStyle="round"
              borderColor={colors.warning}
              paddingX={1}
              flexDirection="column"
            >
              <ModalContent modal={state.modal} />
            </Box>
          </Box>
        </Box>
      );
    }
    // Surface any pre-stage info / warning events so the user sees
    // the welcome banner while we wait for the pipeline to fire its
    // first stage-change.
    return (
      <Box flexDirection="column">
        <Text color={colors.dim}>starting…</Text>
        <Box marginTop={1}>
          <ActivityFeed events={state.events} visible={6} />
        </Box>
      </Box>
    );
  }

  // Live view — selection matches the active stage.
  if (selected === state.stage) {
    return <LiveStageView state={state} />;
  }

  // Past or pending — derive status from lastCompleted.
  const status: "completed" | "pending" = isCompleted(selected, lastCompleted)
    ? "completed"
    : "pending";

  return (
    <StageSummary stage={selected} slug={state.projectSlug} status={status} />
  );
}

function isCompleted(stage: Stage, lastCompleted: Stage | "none"): boolean {
  if (lastCompleted === "none") return false;
  return STAGES.indexOf(stage) <= STAGES.indexOf(lastCompleted);
}

function LiveStageView({ state }: { state: BusState }) {
  const stage = state.stage;
  const title = stage ? STAGE_TITLES[stage] ?? stage : "starting…";

  // During agent stages (recon/explore/synth/arch) and the build stage
  // (implement), if a modal opens keep activity feed visible above it.
  // Stage 9 in particular needs split-modal so the user can see the
  // current prompt body in the feed while answering the "Copied?"
  // ask-select modal.
  const isAgentStage =
    stage === "recon" ||
    stage === "explore" ||
    stage === "synthesize" ||
    stage === "architect" ||
    stage === "implement";
  const splitModal = state.modal && isAgentStage;
  // Stage 9 ("build" walk-through) emits the full prompt body to the
  // activity feed. Show more lines than usual so the prompt is
  // readable without scroll-back.
  const isBuildStage = stage === "implement";

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Text bold color={colors.warning}>
        {title}
      </Text>
      <Box marginTop={1} flexDirection="column" flexGrow={1}>
        {splitModal && state.modal ? (
          <>
            {/*
             * Activity feed takes whatever vertical space is left
             * after the modal box claims its natural height. The
             * `flexShrink={1}` + `overflow="hidden"` combo clips the
             * top of the feed when its content exceeds the available
             * space — without those, a long prompt body in stage 9
             * would push the modal off the bottom of the terminal.
             *
             * On stage 9 specifically, the visible event budget is
             * smaller than other agent stages because each prompt is
             * emitted as ONE big multi-line info event; the feed's
             * row count is dominated by that event's body.
             */}
            {/*
             * Feed wrapper has natural (content-driven) height. The
             * parent inner Box has flexGrow=1, so any unused height
             * accumulates at the BOTTOM of the inner Box (below the
             * modal) — never between the header and the feed.
             *
             * On a short terminal where natural feed + modal exceeds
             * the inner Box, the feed (flexShrink default = 1) will
             * shrink to absorb the deficit and overflow:hidden clips
             * its overflow. The modal (flexShrink=0) stays rigid.
             */}
            <Box flexDirection="column" overflow="hidden">
              <ActivityFeed events={state.events} visible={6} />
            </Box>
            {(() => {
              const desc = modalDescription(state.modal);
              return (
                <Box marginTop={1} flexDirection="column" flexShrink={0}>
                  {desc ? <ModalDescription text={desc} /> : null}
                  <Box
                    borderStyle="round"
                    borderColor={colors.warning}
                    paddingX={1}
                    flexDirection="column"
                  >
                    <ModalContent modal={state.modal} />
                  </Box>
                </Box>
              );
            })()}
          </>
        ) : state.modal ? (
          (() => {
            const desc = modalDescription(state.modal);
            return (
              <Box flexDirection="column" flexShrink={0}>
                {desc ? <ModalDescription text={desc} /> : null}
                <Box
                  borderStyle="round"
                  borderColor={colors.warning}
                  paddingX={1}
                  flexDirection="column"
                >
                  <ModalContent modal={state.modal} />
                </Box>
              </Box>
            );
          })()
        ) : (
          <>
            <ActivityFeed
              events={state.events}
              visible={isBuildStage ? 24 : 18}
            />
            <ProgressIndicator />
          </>
        )}
      </Box>
    </Box>
  );
}

function ErrorScreen({ state }: { state: BusState }) {
  const message = state.error?.message ?? "unknown error";
  const isCreditError = /credit balance|insufficient/i.test(message);
  return (
    <Box flexDirection="column">
      <Text bold color={colors.error}>
        ✗ {message}
      </Text>
      {isCreditError ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.warning}>
            Top up at https://console.anthropic.com/, then press r to retry.
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color={colors.accent} bold>[r]</Text>
          <Text color={colors.body}> Retry from where it failed</Text>
        </Text>
        <Text>
          <Text color={colors.accent} bold>[q]</Text>
          <Text color={colors.body}> Exit</Text>
          {state.projectSlug ? (
            <Text color={colors.dim}>
              {" "}
              (resume later with: ./distilr resume {state.projectSlug})
            </Text>
          ) : null}
        </Text>
      </Box>
    </Box>
  );
}

function FinalScreen({ state }: { state: BusState }) {
  // Show all info/warning events emitted during the final emit stage so
  // the multi-line "Next steps" block (split into per-color emits) all
  // surfaces here. Falls back to last 12 events if no emit-stage marker
  // is found (shouldn't happen in normal flow).
  const events = state.events;
  let emitStartIdx = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e && e.kind === "stage-change" && e.stage === "emit") {
      emitStartIdx = i;
      break;
    }
  }
  const slice =
    emitStartIdx >= 0 ? events.slice(emitStartIdx + 1) : events.slice(-12);
  const lastInfo = slice.filter(
    (e) => e.kind === "info" || e.kind === "warning",
  );
  return (
    <Box flexDirection="column">
      <Text bold color={colors.success}>
        ✓ All done.
      </Text>
      <Box marginTop={1} flexDirection="column">
        {lastInfo.map((e, i) => {
          if (e.kind === "warning") {
            return (
              <Text key={i} color={colors.warning}>
                {e.text}
              </Text>
            );
          }
          return (
            <Text key={i} color={e.color ?? "cyanBright"}>
              {e.text}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.dim}>Press q or enter to exit.</Text>
      </Box>
    </Box>
  );
}
