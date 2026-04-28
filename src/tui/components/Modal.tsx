import React from "react";
import { Box, Text } from "ink";
import { ModalRequest, getBus } from "../bus.js";
import { TextInputPrompt } from "./prompts/TextInputPrompt.js";
import { SelectPrompt } from "./prompts/SelectPrompt.js";
import { MultiSelectPrompt } from "./prompts/MultiSelectPrompt.js";
import { ConfirmPrompt } from "./prompts/ConfirmPrompt.js";
import { colors } from "../colors.js";

interface ModalProps {
  modal: ModalRequest;
}

export function Modal({ modal }: ModalProps) {
  const bus = getBus();

  let body: React.ReactNode = null;
  if (modal.kind === "input") {
    body = (
      <TextInputPrompt
        question={modal.question}
        defaultValue={modal.default}
        placeholder={modal.placeholder}
        onSubmit={(v) => bus.resolveModal(v)}
      />
    );
  } else if (modal.kind === "select") {
    body = (
      <SelectPrompt
        question={modal.question}
        options={modal.options}
        onSelect={(v) => bus.resolveModal(v)}
      />
    );
  } else if (modal.kind === "multiselect") {
    body = (
      <MultiSelectPrompt
        question={modal.question}
        options={modal.options}
        minSelected={modal.minSelected}
        onSubmit={(v) => bus.resolveModal(v)}
      />
    );
  } else if (modal.kind === "confirm") {
    body = (
      <ConfirmPrompt
        question={modal.question}
        defaultValue={modal.default}
        onAnswer={(v) => bus.resolveModal(v)}
      />
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={colors.warning}
      paddingX={2}
      paddingY={1}
    >
      <Text color={colors.warning} bold>
        ⏵ Input needed
      </Text>
      <Box marginTop={1} flexDirection="column">
        {body}
      </Box>
    </Box>
  );
}
