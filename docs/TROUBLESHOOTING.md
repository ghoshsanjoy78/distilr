# Troubleshooting

- **`<PROVIDER>_API_KEY is not set`** — run `./distilr config` to walk through the wizard, or paste your key directly into `.env.local`.
- **`Executable doesn't exist` from Playwright** — run `npm run setup`.
- **Bot-detection at signup (Cloudflare turnstile, hCaptcha)** — solve the challenge yourself in the headed window, then continue. The agent doesn't try to bypass.
- **Login auto-verify says "doesn't look like you're logged in"** — finish in the browser (past any onboarding modal) and re-confirm. Or pick "Skip login" to do public-only analysis.
- **Agent stops with "hit step budget"** — the target was too sprawling for the configured budget. The pipeline continues with whatever was captured. To extend, raise `stopWhen: stepCountIs(N)` in `src/agents/explorer.ts` (or `recon.ts`), or pick fewer focus areas in stage 4.
- **`Synthesizer finished without calling catalog_submit`** / **`Architect finished without calling architect_submit`** — the model didn't call the structured-output tool. Try a different provider/model with `--provider openai` or `--provider anthropic`.
- **`The request body is not valid JSON: no low surrogate in string`** — fixed in v0.1.x; rebuild with `npm run build`.
- **Chromium memory growing into many GB** — fixed in v0.1.x (HAR recording was the cause); rebuild with `npm run build`.
- **TUI selected option text hard to read** — your terminal renders ANSI cyan/yellow as too dark or too neon. The TUI uses `cyanBright` for highlights; if your terminal theme remaps that, try iTerm2 / Alacritty / kitty for cleaner rendering.
- **TUI box outline looks like broken pipes** — that's terminal line-spacing, not a bug. Set line spacing to 1.0 in your terminal preferences (Terminal.app: Settings → Profile → Text → Line spacing). Or switch to a terminal that handles box-drawing characters seamlessly (iTerm2, Alacritty, kitty).
- **Token-budget warning at 50k / 200k / 500k** — informational only. Press `p` to interrupt and steer if the agent is wandering, or "continue anyway" to keep going.
