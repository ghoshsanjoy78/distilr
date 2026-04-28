import React from "react";
import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import { SelectOption } from "../../bus.js";
import { colors } from "../../colors.js";

// Override ink-select-input's defaults — its built-in indicator and item
// components both render the highlighted row in plain ANSI `blue`, which
// many terminal themes render almost-invisible on dark backgrounds. We
// use the Ayu accent color for visual consistency with the rest of the
// TUI.

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

interface SelectPromptProps {
  question: string;
  options: SelectOption<unknown>[];
  onSelect: (value: unknown) => void;
}

// `description` (the multi-line preamble) is intentionally NOT rendered
// here — MainPane peels it off and renders it ABOVE the outlined modal
// box, so the box itself stays focused on the question + options.
export function SelectPrompt({
  question,
  options,
  onSelect,
}: SelectPromptProps) {
  const items = options.map((o, i) => ({
    label: o.label,
    value: o.value,
    key: String(i),
  }));
  return (
    <Box flexDirection="column">
      <Text bold color={colors.accent}>
        {question}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <SelectInput
          items={items}
          onSelect={(item) => onSelect(item.value)}
          indicatorComponent={HighlightIndicator}
          itemComponent={HighlightItem}
        />
      </Box>
    </Box>
  );
}
