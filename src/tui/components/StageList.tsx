// Left-sidebar stage list. Shows all 8 pipeline stages with a status
// icon (✓ done / ⠋ active spinner / · pending), the stage name, and
// a selection marker on whichever row the user is currently viewing
// in the right pane.

import React from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { Stage, STAGES } from "../../store/schemas.js";
import { colors } from "../colors.js";

interface StageListProps {
  active: Stage | null;
  selected: Stage | null;
  lastCompleted: Stage | "none";
}

const NAMES: Record<Stage, string> = {
  target: "target",
  recon: "recon",
  login: "login",
  explore: "explore",
  synthesize: "synthesize",
  wizard: "wizard",
  architect: "architect",
  emit: "emit",
  implement: "implement",
};

function isCompleted(stage: Stage, lastCompleted: Stage | "none"): boolean {
  if (lastCompleted === "none") return false;
  return STAGES.indexOf(stage) <= STAGES.indexOf(lastCompleted);
}

export function StageList({ active, selected, lastCompleted }: StageListProps) {
  return (
    <Box flexDirection="column" width={26}>
      <Text bold color={colors.accent}>
        STAGES
      </Text>
      <Text color={colors.dim}>────────────────────</Text>
      {STAGES.map((stage, i) => {
        const isActive = stage === active;
        const isSelected = stage === selected;
        const done = isCompleted(stage, lastCompleted);

        // Status icon column (2 chars).
        let icon: React.ReactNode;
        if (done && !isActive) {
          icon = <Text color={colors.success}>✓ </Text>;
        } else if (isActive) {
          icon = (
            <Text color={colors.accent}>
              <Spinner type="dots" />{" "}
            </Text>
          );
        } else {
          icon = <Text color={colors.dim}>· </Text>;
        }

        // Name color: dim for pending, bright for active, body for done.
        let nameColor: string = colors.dim;
        if (isActive) nameColor = colors.accent;
        else if (done) nameColor = colors.body;

        return (
          <Box key={stage}>
            {icon}
            <Text color={nameColor} bold={isActive}>
              {i + 1}. {NAMES[stage]}
            </Text>
            {isSelected ? (
              <Text color={colors.warning}> ◀</Text>
            ) : null}
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color={colors.dim} wrap="truncate-end">
          ↑↓ stage · 0 live
        </Text>
      </Box>
    </Box>
  );
}
