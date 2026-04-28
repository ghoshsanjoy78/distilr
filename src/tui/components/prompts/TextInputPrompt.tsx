import React, { useState } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../../colors.js";

interface TextInputPromptProps {
  question: string;
  defaultValue?: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

export function TextInputPrompt({
  question,
  defaultValue = "",
  placeholder,
  onSubmit,
}: TextInputPromptProps) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Box flexDirection="column">
      <Text bold>{question}</Text>
      <Box marginTop={1}>
        <Text color={colors.accent}>› </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => onSubmit(v.trim().length > 0 ? v.trim() : defaultValue)}
          placeholder={placeholder}
        />
      </Box>
    </Box>
  );
}
