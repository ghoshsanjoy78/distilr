# Changelog

All notable changes to distilr are recorded here. Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project tries to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — pre-1.0, breaking changes can land on any minor bump.

## [0.1.0] — 2026-04-27

First public release. Works end-to-end: takes a SaaS URL, produces an MVP-sized phased build spec ready for handoff to a coding agent.

### Added

- 8-stage pipeline: target → recon → login → explore → synthesize → wizard → architect → emit. Every stage is checkpointed; `Ctrl-C` is always safe and `distilr resume <slug>` picks up from the last completed stage.
- Multi-provider support via [Vercel AI SDK](https://ai-sdk.dev): Anthropic, OpenAI, Google (Gemini), OpenRouter. Per-run overrides via `--provider` and `--model`.
- TUI setup wizard (`distilr config`) that writes `.env.local` for you on first run. Re-runnable any time.
- Ink-based TUI with live activity feed, shimmer-animated progress indicator, cumulative token + cost estimates.
- Headed Playwright browser session per project, with cookies preserved between runs (`browser-data/` per slug).
- Destructive-action guard: `browser_click` refuses on a hardcoded regex (`delete | remove | unsubscribe | send | publish | pay | charge | invite | …`); `browser_click_destructive` prompts the user for explicit terminal approval.
- Credentials guard: `browser_fill` refuses on `password | cardnumber | cvv | ssn | tax-id` inputs.
- Mid-run interrupt on `p`: stop, keep going, or send guidance + restart.
- Output tree following OpenAI's [harness-engineering layout](https://openai.com/index/harness-engineering/): `AGENTS.md` as a 100-line table of contents, content under `docs/`, phases as exec plans (Status + spec + Decision log + Progress log), per-feature product specs, and stack-aware design / reliability / security templates.
- Tool-agnostic next-steps screen: prints handoff commands for Claude Code, OpenAI Codex, OpenCode, Aider, Cursor, GitHub Copilot, and Gemini CLI.
- `./distilr` wrapper script that auto-cd's into the output directory after stage 8 (via `exec $SHELL` — the cleanest "auto-cd" possible from a child process).
- Two-step quickstart: `npm install` + `./distilr`. The `postinstall` hook downloads Chromium and compiles TypeScript.

### Scope guardrails

A four-layer system keeps the spec MVP-sized when users point distilr at large products:

- **Welcome framing.** README scope callout and an in-TUI welcome message at the start of every run.
- **Stage-1 LLM scope check.** Classifies the target as `focused` / `broad` / `sprawling` and offers to narrow before continuing. Soft warning — there's always a "continue anyway" path.
- **Hard caps.** 8 must-haves (wizard prompts to demote excess), 10 phases (architect prompt + tool truncation), 100 observations (synthesizer drops the oldest).
- **Post-recon size warning + token-budget warnings.** Yellow warnings at 50k / 200k / 500k cumulative tokens with rough cost estimates.

### Known limitations

- No automated tests yet.
- Heavy reliance on tool-calling quality. Anthropic and OpenAI flagship models work best in our experience; Gemini works but accuracy varies; OpenRouter passes through to whatever model you pick.
- Bot-detection challenges (Cloudflare turnstile, hCaptcha) at signup must be solved manually in the headed window.
- No `--max-tokens` flag yet — output length is governed by per-agent prompt budgets.

[0.1.0]: https://github.com/ghoshsanjoy78/distilr/releases/tag/v0.1.0
