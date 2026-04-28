import React from "react";
import { Box, Text } from "ink";
import { Stats } from "../bus.js";
import { useElapsed } from "../hooks.js";
import { colors } from "../colors.js";

interface FooterProps {
  stats: Stats;
  hint?: string;
  showStats?: boolean;
}

export function Footer({ stats, hint, showStats = true }: FooterProps) {
  const elapsed = useElapsed(stats.startedAt);

  const obsKindParts = Object.entries(stats.obsByKind)
    .map(([k, n]) => `${k}:${n}`)
    .join(" ");

  return (
    <Box flexDirection="column">
      {showStats ? (
        <Box>
          <Text color={colors.dim}>
            pages: <Text color={colors.body}>{stats.pages}</Text>
            {"   "}
            obs: <Text color={colors.body}>{stats.observations}</Text>
            {obsKindParts ? (
              <Text color={colors.dim}> [{obsKindParts}]</Text>
            ) : null}
            {"   "}
            errors:{" "}
            <Text color={stats.errors > 0 ? colors.error : colors.body}>
              {stats.errors}
            </Text>
            {"   "}
            elapsed: <Text color={colors.body}>{elapsed}</Text>
          </Text>
        </Box>
      ) : null}
      <Box>
        <Text color={colors.dim}>{hint ?? "ctrl+c interrupt"}</Text>
      </Box>
    </Box>
  );
}
