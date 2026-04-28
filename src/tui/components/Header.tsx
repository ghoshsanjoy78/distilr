import React from "react";
import { Box, Text } from "ink";
import { colors } from "../colors.js";

// 6-row ASCII wordmark for "distilr". Rendered in colors.accent (the
// Ayu orange-gold) to match the "STAGES" sidebar header — same brand
// color anchors both top corners of the layout.
const ASCII_ROWS: readonly string[] = [
  `    .___.__          __  .__.__         `,
  `  __| _/|__| _______/  |_|__|  |_______ `,
  ` / __ | |  |/  ___/\\   __\\  |  |\\_  __ \\`,
  `/ /_/ | |  |\\___ \\  |  | |  |  |_|  | \\/`,
  `\\____ | |__/____  > |__| |__|____/__|   `,
  `     \\/         \\/                      `,
];

interface HeaderProps {
  saasName: string | null;
  slug: string | null;
}

export function Header({ saasName, slug }: HeaderProps) {
  const subtitleParts: string[] = [];
  if (saasName) subtitleParts.push(saasName);
  else if (slug) subtitleParts.push(slug);
  const subtitle = subtitleParts.join(" · ");

  return (
    <Box flexDirection="column">
      {ASCII_ROWS.map((row, i) => (
        <Text key={i} color={colors.accent} wrap="truncate-end">
          {row}
        </Text>
      ))}
      {subtitle ? (
        <Box marginTop={0}>
          <Text color={colors.dim}>· {subtitle}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
