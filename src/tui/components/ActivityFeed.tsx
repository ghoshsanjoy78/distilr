import React from "react";
import { Box, Text } from "ink";
import { AgentEvent } from "../bus.js";
import { colors } from "../colors.js";

interface ActivityFeedProps {
  events: AgentEvent[];
  /** How many of the most recent events to render (defaults to 18). */
  visible?: number;
}

function eventLine(e: AgentEvent, key: number): React.ReactNode {
  switch (e.kind) {
    case "agent-text":
      return (
        <Text key={key} color={colors.body}>
          {e.text}
        </Text>
      );
    case "nav":
      return (
        <Text key={key} color={colors.info}>
          ▸ visiting <Text color={colors.body}>{e.url}</Text>
          <Text color={colors.dim}>  (page {e.pageNumber})</Text>
        </Text>
      );
    case "obs":
      return (
        <Text key={key} color={colors.success}>
          {"  "}+ {e.obsKind}
          <Text color={colors.dim}>  ({e.total} obs total)</Text>
        </Text>
      );
    case "submit":
      return (
        <Text key={key} bold color={colors.success}>
          ✓ {e.what === "catalog" ? "feature catalog" : "architecture"} submitted
        </Text>
      );
    case "destructive-request":
      return (
        <Text key={key} bold color={colors.warning}>
          ! agent requesting approval: {e.description}
        </Text>
      );
    case "ask-user-request":
      return (
        <Text key={key} bold color={colors.warning}>
          ? agent asking: {e.question}
        </Text>
      );
    case "tool-error":
      return (
        <Text key={key} color={colors.error}>
          ⚠ {e.message}
        </Text>
      );
    case "info":
      return (
        <Text key={key} color={e.color ?? colors.accent}>
          {e.text}
        </Text>
      );
    case "warning":
      return (
        <Text key={key} color={colors.warning}>
          {e.text}
        </Text>
      );
    case "stage-change":
    case "stage-complete":
      return null;
  }
}

export function ActivityFeed({ events, visible = 18 }: ActivityFeedProps) {
  const tail = events.slice(-visible);
  return (
    <Box flexDirection="column">
      {tail.map((e, i) => {
        const node = eventLine(e, i);
        if (!node) return null;
        return (
          <Box key={i} flexDirection="column">
            {node}
          </Box>
        );
      })}
    </Box>
  );
}
