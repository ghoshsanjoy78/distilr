import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { SelectOption } from "../../bus.js";
import { colors } from "../../colors.js";

interface MultiSelectPromptProps {
  question: string;
  options: SelectOption<unknown>[];
  minSelected?: number;
  onSubmit: (values: unknown[]) => void;
}

export function MultiSelectPrompt({
  question,
  options,
  minSelected = 0,
  onSubmit,
}: MultiSelectPromptProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(options.length - 1, c + 1));
      return;
    }
    if (input === " ") {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      setError(null);
      return;
    }
    if (input === "a") {
      setSelected((prev) =>
        prev.size === options.length
          ? new Set()
          : new Set(options.map((_, i) => i)),
      );
      return;
    }
    if (key.return) {
      if (selected.size < minSelected) {
        setError(`Pick at least ${minSelected}`);
        return;
      }
      const values = Array.from(selected)
        .sort((a, b) => a - b)
        .map((i) => options[i]!.value);
      onSubmit(values);
    }
  });

  const PAGE = 12;
  const start = Math.max(0, Math.min(cursor - PAGE + 3, options.length - PAGE));
  const end = Math.min(options.length, start + PAGE);
  const slice = options.slice(start, end).map((o, idx) => ({ ...o, idx: start + idx }));

  return (
    <Box flexDirection="column">
      <Text bold>{question}</Text>
      <Text color={colors.dim}>
        space toggle · a all/none · enter confirm
        {minSelected > 0 ? ` · pick at least ${minSelected}` : ""}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {slice.map(({ label, idx }) => {
          const isCursor = idx === cursor;
          const isSelected = selected.has(idx);
          return (
            <Text
              key={idx}
              color={isCursor ? colors.accent : undefined}
              bold={isCursor}
            >
              {isCursor ? "▸ " : "  "}
              {isSelected ? "[x] " : "[ ] "}
              {label}
            </Text>
          );
        })}
        {start > 0 ? (
          <Text color={colors.dim}>  ↑ {start} more above</Text>
        ) : null}
        {end < options.length ? (
          <Text color={colors.dim}>  ↓ {options.length - end} more below</Text>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text color={colors.dim}>
          {selected.size} of {options.length} selected
        </Text>
        {error ? <Text color={colors.error}>  {error}</Text> : null}
      </Box>
    </Box>
  );
}
