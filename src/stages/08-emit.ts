import { emitOutput } from "../output/scaffold.js";
import { closeSession } from "../browser/session.js";
import type { Bus } from "../tui/bus.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the wrapper script reads the auto-cd target dir from. */
function cdTargetFile(): string {
  return join(process.env.TMPDIR ?? "/tmp", "distilr-cd-target");
}

export async function stageEmit(slug: string, bus: Bus): Promise<void> {
  const { outputDir, phaseCount } = await emitOutput(slug);

  await closeSession(slug).catch(() => {});

  // Hand the output dir off to the wrapper script so it can offer to
  // drop the user there after Node exits. Best-effort — silent failure
  // is fine; wrapper just won't prompt.
  try {
    writeFileSync(cdTargetFile(), outputDir, "utf8");
  } catch {
    /* ok */
  }

  // Per-line emits so we can color the cd line distinctly. FinalScreen
  // shows every info event emitted in this stage (filtered by the
  // stage-change marker), so order and granularity here is what the
  // user reads.
  bus.emit({ kind: "info", text: `Generated project: ${outputDir}` });
  bus.emit({ kind: "info", text: `Phases: ${phaseCount}` });
  bus.emit({ kind: "info", text: `` });
  bus.emit({ kind: "info", text: `Next steps:` });
  bus.emit({ kind: "info", text: `  cd ${outputDir}`, color: "yellow" });
  bus.emit({ kind: "info", text: `` });
  bus.emit({ kind: "info", text: `Then run with whichever coding agent you prefer:` });
  bus.emit({ kind: "info", text: `` });

  const commands: [string, string][] = [
    [
      "Claude Code   ",
      `claude "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"`,
    ],
    [
      "OpenAI Codex  ",
      `codex "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"`,
    ],
    [
      "OpenCode      ",
      `opencode "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"`,
    ],
    [
      "Aider         ",
      `aider AGENTS.md docs/PLANS.md docs/exec-plans/active/phase-00.md`,
    ],
    [
      "Cursor        ",
      `open the dir, then ask the agent to read AGENTS.md`,
    ],
    [
      "GitHub Copilot",
      `open the dir, then use Copilot Chat to follow AGENTS.md`,
    ],
    [
      "Gemini CLI    ",
      `gemini "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"`,
    ],
  ];
  for (const [tool, cmd] of commands) {
    bus.emit({ kind: "info", text: `  ${tool}→  ${cmd}` });
  }

  bus.emit({ kind: "info", text: `` });
  bus.emit({
    kind: "info",
    text: `(AGENTS.md is a ~100-line table of contents pointing into docs/.`,
  });
  bus.emit({
    kind: "info",
    text: ` CLAUDE.md is a copy under Claude Code's filename convention.`,
  });
  bus.emit({
    kind: "info",
    text: ` docs/PRODUCT_SENSE.md captures product principles; docs/DESIGN.md`,
  });
  bus.emit({
    kind: "info",
    text: ` has concrete design tokens; docs/exec-plans/active/ holds the`,
  });
  bus.emit({
    kind: "info",
    text: ` phase specs to ship one at a time. Move each phase to`,
  });
  bus.emit({
    kind: "info",
    text: ` docs/exec-plans/completed/ as you ship it.)`,
  });
}
