import React from "react";
import { Box, useStdout } from "ink";
import { colors } from "../colors.js";

interface LayoutProps {
  header: React.ReactNode;
  /** Left sidebar — fixed-width stage list. */
  sidebar: React.ReactNode;
  /** Right pane — live activity / past-stage summary / final / error. */
  pane: React.ReactNode;
  footer: React.ReactNode;
}

export function Layout({ header, sidebar, pane, footer }: LayoutProps) {
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;
  // Reserve a couple of rows for borders + footer breathing room.
  const innerWidth = Math.max(60, cols - 2);
  const innerHeight = Math.max(15, rows - 1);

  return (
    <Box flexDirection="column" width={innerWidth} height={innerHeight}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={colors.accent}
        paddingX={1}
        flexGrow={1}
      >
        <Box flexDirection="column">{header}</Box>
        {/* Body — two columns: stage list (fixed width) + right pane (flex). */}
        <Box marginTop={1} flexDirection="row" flexGrow={1}>
          <Box flexDirection="column">{sidebar}</Box>
          <Box marginLeft={2} flexDirection="column" flexGrow={1}>
            {pane}
          </Box>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {footer}
        </Box>
      </Box>
    </Box>
  );
}
