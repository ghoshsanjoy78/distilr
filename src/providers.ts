// Provider abstraction for the multi-AI-tool support.
//
// One env var (DISTILR_PROVIDER) selects the SDK; another (DISTILR_MODEL)
// optionally overrides the per-provider default model name. Both can be
// overridden at runtime by the CLI flags --provider and --model (cli.ts
// rewrites process.env before the agents call any of these getters).

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

export type Provider = "anthropic" | "openai" | "google" | "openrouter";

export const PROVIDER_NAMES: readonly Provider[] = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
];

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o",
  google: "gemini-2.5-pro",
  openrouter: "anthropic/claude-sonnet-4-6",
};

const API_KEY_VAR: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const API_KEY_HELP: Record<Provider, string> = {
  anthropic: "https://console.anthropic.com/",
  openai: "https://platform.openai.com/api-keys",
  google: "https://aistudio.google.com/app/apikey",
  openrouter: "https://openrouter.ai/keys",
};

export function getProvider(): Provider {
  const raw = (process.env.DISTILR_PROVIDER ?? "anthropic")
    .trim()
    .toLowerCase();
  // accept "gemini" as alias for "google"
  if (raw === "gemini") return "google";
  if ((PROVIDER_NAMES as readonly string[]).includes(raw)) {
    return raw as Provider;
  }
  throw new Error(
    `Unknown provider "${raw}". Supported: ${PROVIDER_NAMES.join(", ")} (or "gemini" as an alias for "google").`,
  );
}

export function getModelName(provider?: Provider): string {
  const p = provider ?? getProvider();
  const override = (process.env.DISTILR_MODEL ?? "").trim();
  if (override) return override;
  return DEFAULT_MODELS[p];
}

export function getModel(): LanguageModel {
  const provider = getProvider();
  const modelName = getModelName(provider);
  switch (provider) {
    case "anthropic":
      return anthropic(modelName);
    case "openai":
      return openai(modelName);
    case "google":
      return google(modelName);
    case "openrouter": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          `OPENROUTER_API_KEY is not set. Get one at ${API_KEY_HELP.openrouter} and add it to .env.local.`,
        );
      }
      const openrouter = createOpenRouter({ apiKey });
      return openrouter.chat(modelName);
    }
  }
}

export function apiKeyVarFor(provider: Provider): string {
  return API_KEY_VAR[provider];
}

export function apiKeyHelpFor(provider: Provider): string {
  return API_KEY_HELP[provider];
}

/**
 * Validate that the API key for the active provider is set. Throws a
 * friendly error if not.
 */
export function assertApiKey(): void {
  const provider = getProvider();
  const varName = API_KEY_VAR[provider];
  if (!process.env[varName]) {
    throw new Error(
      `${varName} is not set for provider "${provider}". Run \`distilr config\` to set it up, or get a key at ${API_KEY_HELP[provider]}.`,
    );
  }
}

/** True if the current config is usable — no exception from assertApiKey. */
export function isConfigValid(): boolean {
  try {
    assertApiKey();
    return true;
  } catch {
    return false;
  }
}

/** Human-readable summary of the active provider/model — used in headers/logs. */
export function getProviderSummary(): string {
  const provider = getProvider();
  return `${provider}/${getModelName(provider)}`;
}
