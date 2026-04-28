// Right-pane content when the user has navigated to a stage that
// isn't the live active one. Loads a one-paragraph summary from the
// persisted JSON files via `summarizeStage()`.

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { Stage } from "../../store/schemas.js";
import { summarizeStage } from "../stage-summary.js";
import { colors } from "../colors.js";

interface StageSummaryProps {
  stage: Stage;
  slug: string | null;
  /**
   * Status of this stage relative to the run:
   *   - "completed" → checkmark heading
   *   - "pending"   → "not started yet" message, no file read
   */
  status: "completed" | "pending";
}

const TITLES: Record<Stage, string> = {
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

export function StageSummary({ stage, slug, status }: StageSummaryProps) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status !== "completed" || !slug) {
      setText(null);
      return;
    }
    let mounted = true;
    setLoading(true);
    (async () => {
      const summary = await summarizeStage(stage, slug);
      if (mounted) {
        setText(summary);
        setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [stage, slug, status]);

  if (status === "pending") {
    return (
      <Box flexDirection="column">
        <Text color={colors.dim}>· {TITLES[stage]} — not started yet</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={colors.success}>
          ✓ {TITLES[stage]} — completed
        </Text>
      </Box>
      {loading ? (
        <Text color={colors.dim}>
          <Spinner type="dots" /> loading summary…
        </Text>
      ) : (
        <Text color={colors.body} wrap="wrap">
          {text ?? "(no data)"}
        </Text>
      )}
    </Box>
  );
}
