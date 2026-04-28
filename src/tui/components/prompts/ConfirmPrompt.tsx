import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { colors } from "../../colors.js";

// See SelectPrompt for why we override ink-select-input's defaults.
function HighlightIndicator({ isSelected }: { isSelected?: boolean }) {
  return (
    <Text color={colors.accent} bold>
      {isSelected ? "▸ " : "  "}
    </Text>
  );
}

function HighlightItem({
  isSelected,
  label,
}: {
  isSelected?: boolean;
  label: string;
}) {
  return (
    <Text color={isSelected ? colors.accent : undefined} bold={isSelected}>
      {label}
    </Text>
  );
}

interface ConfirmPromptProps {
  question: string;
  defaultValue?: boolean;
  onAnswer: (yes: boolean) => void;
}

export function ConfirmPrompt({
  question,
  defaultValue = true,
  onAnswer,
}: ConfirmPromptProps) {
  const items = defaultValue
    ? [
        { label: "Yes", value: true, key: "y" },
        { label: "No", value: false, key: "n" },
      ]
    : [
        { label: "No", value: false, key: "n" },
        { label: "Yes", value: true, key: "y" },
      ];
  return (
    <Box flexDirection="column">
      <Text bold>{question}</Text>
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onAnswer(item.value)}
          indicatorComponent={HighlightIndicator}
          itemComponent={HighlightItem}
        />
      </Box>
    </Box>
  );
}
