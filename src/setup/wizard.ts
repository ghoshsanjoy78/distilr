// First-run setup + reconfiguration wizard. Runs inside the TUI via the
// existing AgentBus modal machinery, writes choices to .env.local, and
// updates process.env so the rest of the run picks up the new values
// without a restart.

import type { Bus } from "../tui/bus.js";
import {
  Provider,
  apiKeyVarFor,
  apiKeyHelpFor,
} from "../providers.js";
import { applyToProcessEnv, writeEnvLocal } from "./env-file.js";

interface ProviderInfo {
  value: Provider;
  label: string;
  defaultModel: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    value: "anthropic",
    label: "Anthropic (Claude)",
    defaultModel: "claude-sonnet-4-6",
  },
  { value: "openai", label: "OpenAI (GPT)", defaultModel: "gpt-4o" },
  {
    value: "google",
    label: "Google (Gemini)",
    defaultModel: "gemini-2.5-pro",
  },
  {
    value: "openrouter",
    label: "OpenRouter (universal proxy)",
    defaultModel: "anthropic/claude-sonnet-4-6",
  },
];

export async function runSetupWizard(bus: Bus): Promise<void> {
  bus.emit({
    kind: "info",
    text: "Setting up distilr — this updates .env.local in the repo root.",
  });

  // 1. Provider
  const provider = await bus.askSelect<Provider>(
    "Which AI provider would you like to use?",
    PROVIDERS.map((p) => ({ label: p.label, value: p.value })),
  );
  const info = PROVIDERS.find((p) => p.value === provider)!;

  // 2. API key
  const updates: Record<string, string> = {
    DISTILR_PROVIDER: provider,
  };

  const varName = apiKeyVarFor(provider);
  const helpUrl = apiKeyHelpFor(provider);
  let key = "";
  while (!key) {
    const v = await bus.askInput(
      `Paste your ${varName} (get one at ${helpUrl}):`,
    );
    const trimmed = v.trim();
    if (trimmed.length >= 16) {
      key = trimmed;
    } else if (trimmed.length === 0) {
      bus.emit({
        kind: "warning",
        text: "Need an API key to continue — paste one or Ctrl-C to abort.",
      });
    } else {
      bus.emit({
        kind: "warning",
        text: "That looks too short for an API key — try again.",
      });
    }
  }
  updates[varName] = key;

  // 3. Model override (optional — empty string means use the provider default)
  const wantsModelOverride = await bus.askConfirm(
    `Use the default model for ${provider} (${info.defaultModel})?`,
    { default: true },
  );
  if (!wantsModelOverride) {
    const v = await bus.askInput(
      `Model id (or hit enter for ${info.defaultModel}):`,
      { default: info.defaultModel },
    );
    if (v.trim() && v.trim() !== info.defaultModel) {
      updates.DISTILR_MODEL = v.trim();
    } else {
      // Clear any prior override so we fall back to the provider default.
      updates.DISTILR_MODEL = "";
    }
  } else {
    updates.DISTILR_MODEL = "";
  }

  // 4. Persist to .env.local AND apply to current process so the rest
  //    of this run picks up the new values without a restart.
  writeEnvLocal(updates);
  applyToProcessEnv(updates);

  bus.emit({
    kind: "info",
    text: `Saved: ${provider} (${updates.DISTILR_MODEL || info.defaultModel}) — API key written to .env.local.`,
  });
}
