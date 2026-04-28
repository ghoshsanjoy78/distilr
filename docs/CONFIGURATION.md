# Configuration

All configuration lives in `.env.local` (gitignored). See `.env.example` for the full template. The minimum to run is one provider's API key.

## Environment variables

| Variable | Required? | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | required when provider = `anthropic` | — | https://console.anthropic.com/ |
| `OPENAI_API_KEY` | required when provider = `openai` | — | https://platform.openai.com/api-keys |
| `GOOGLE_GENERATIVE_AI_API_KEY` | required when provider = `google` / `gemini` | — | https://aistudio.google.com/app/apikey |
| `OPENROUTER_API_KEY` | required when provider = `openrouter` | — | https://openrouter.ai/keys |
| `DISTILR_PROVIDER` | optional | `anthropic` | one of: `anthropic`, `openai`, `google` (alias `gemini`), `openrouter` |
| `DISTILR_MODEL` | optional | per-provider default (see below) | model id within the chosen provider |
| `DISTILR_THEME` | optional | `auto` | TUI palette: `dark` (Ayu Dark), `light` (Ayu Light), or `auto` (detect from `COLORFGBG`; falls back to dark) |
| `DISTILR_CACHE_DIR` | optional | platform default (see below) | Where Chromium's persistent profile lives. Defaults to `~/Library/Caches/distilr` (macOS), `~/.cache/distilr` / `$XDG_CACHE_HOME/distilr` (Linux), `%LOCALAPPDATA%\distilr\Cache` (Windows). Set this to relocate the browser session storage (e.g. to a faster disk) |

`distilr` only reads the API key matching the active provider — the other keys in `.env.example` can stay blank.

## CLI flags (override env per-run)

| Flag | Effect | Example |
|---|---|---|
| `--provider <name>` | overrides `DISTILR_PROVIDER` | `--provider openai` |
| `--model <name>` | overrides `DISTILR_MODEL` | `--model gpt-4o-mini` |

Both flags work on `start`, `resume`, and `providers` commands.

## Providers

`distilr` runs the same agent code against any of four providers.

| Provider | Default model | API key env var |
|---|---|---|
| `anthropic` (default) | `claude-sonnet-4-6` | `ANTHROPIC_API_KEY` |
| `openai` | `gpt-4o` | `OPENAI_API_KEY` |
| `google` (alias `gemini`) | `gemini-2.5-pro` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `openrouter` | `anthropic/claude-sonnet-4-6` | `OPENROUTER_API_KEY` |

> **Quality varies by provider.** All four agents (recon, explorer, synthesizer, architect) need solid tool-calling. Anthropic and OpenAI flagship models do this best in our experience. Gemini works but tool-call accuracy varies. OpenRouter passes through to whatever model you pick — quality matches that underlying model.

> **Why no "use my Claude subscription" option?** Anthropic's terms don't permit third-party tools to integrate `claude.ai` login or rate limits, so distilr bills against an API key. See [the Claude Agent SDK quickstart](https://docs.claude.com/en/agent-sdk/quickstart) for context.

## First-run setup

If `.env.local` is missing or doesn't have a key for the active provider, `distilr` runs a TUI setup wizard before stage 1. The wizard asks: provider → API key → model. You can re-run it any time:

```bash
./distilr config
```

Override the model with `DISTILR_MODEL=...` or `--model ...`. Useful examples:

```bash
./distilr --provider openai --model gpt-4o
./distilr --provider gemini --model gemini-2.5-flash
./distilr --provider openrouter --model meta-llama/llama-3.3-70b-instruct
```

Check what's currently active:

```bash
./distilr providers
# Active: anthropic/claude-sonnet-4-6
# Available: anthropic, openai, google, openrouter (alias: gemini → google)
```
