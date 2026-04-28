# Contributing to distilr

Thanks for your interest! distilr is open source under the [MIT license](./LICENSE.md). PRs, bug reports, and design discussions are all welcome.

By contributing, you agree your work is licensed under the MIT license, and you accept the project [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to help

The bar for "this is useful" is low — a typo fix, a clarified error message, a new troubleshooting entry are all valuable. Larger areas where help is most needed right now:

- **Tests.** There are none yet. A first pass at unit tests for `src/store/`, `src/tools/`, and `src/agents/run.ts` would unblock everything else.
- **Synthesizer quality.** The catalog step is one-shot. Iterative clustering / dedup would produce sharper categories on noisy targets.
- **Chunked observations.** Large multi-product SaaS targets blow past the 100-observation cap. A "synthesize per area, then merge" pass would let distilr handle them.
- **Bot-protection detection.** Cloudflare turnstile / hCaptcha currently just hangs the recon agent. Detect, surface clearly, ask the user to solve.
- **More implementer integrations.** The next-steps screen prints commands for Claude Code, Codex, OpenCode, Aider, Cursor, Copilot, Gemini CLI. Adding a new one is ~5 lines in `src/output/scaffold.ts`.
- **Per-agent `--max-tokens`.** Users want to tune output length per stage.
- **Output template polish.** The architect-emitted docs (DESIGN.md, PRODUCT_SENSE.md, phase specs) are good but not great. Sharper prompts → sharper output.

Open an issue first if the change is non-trivial — saves both of us cycles.

## Development loop

```bash
git clone https://github.com/ghoshsanjoy78/distilr.git
cd distilr
npm install              # downloads Chromium + compiles TS via postinstall
./distilr config       # set provider + API key (writes .env.local)
npm run typecheck        # before any commit
./distilr              # smoke test against a small target
```

Useful scripts:

- `npm run build` — TypeScript compile, emits `dist/`.
- `npm run dev` — `tsc --watch`.
- `npm run typecheck` — type-check only, no emit. Run after every code change.
- `npm run setup` — re-download Chromium if it goes missing.
- `./distilr providers` — sanity-check the build loads.
- `./distilr --help` — verify the CLI surface.

There's no test runner yet. If you add one, wire it into `npm test` and document it in this file.

## Code conventions

- **TypeScript strict.** No `any`, no `// @ts-ignore`. If a type is genuinely unknowable, use `unknown` and narrow at the boundary.
- **Tools are AI-SDK format** (`src/tools/`). Define each one with `tool({...})` and pass to `streamText()` via the `tools` dict.
- **TUI prompts go through the AgentBus** (`src/tui/bus.ts:askInput / askSelect / askMultiSelect / askConfirm`). Never use `inquirer` / stdin / `readline` directly — they corrupt the Ink frame.
- **No stray `console.log`.** Route through `pino` via `src/tui/log-redirect.ts`, or `bus.emit({ kind: "info", text: ... })`.
- **Schemas are strict** (`src/store/schemas.ts`). Every field required, no `.default()` fallbacks. The architect's prompt is responsible for emitting every field.
- **Tool input schemas stay loose.** Some provider validators (Anthropic's `output_config.format`, others) reject array `.min()/.max()` constraints. Validate strictly inside `execute()` instead.

See **[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)** for the bigger picture, and **[CLAUDE.md](./CLAUDE.md)** for the rules AI agents working on distilr follow (which double as rules humans follow too).

## Documentation

The README is the user's first impression — keep it tight. Anything technical that goes deeper than 2-3 sentences belongs in `docs/`. See [CLAUDE.md](./CLAUDE.md) for the table mapping each kind of change to the file that documents it.

## Pull request workflow

1. Fork → branch → commit → PR.
2. Keep PRs focused on a single concern. If a refactor and a feature are tangled, split them.
3. Run `npm run typecheck` before opening the PR.
4. Update relevant docs in the same PR. A code change with stale docs is a half-finished change.
5. Use clear commit messages — explain the *why*, not the *what*. The diff shows what.

## Reporting bugs

File an issue with:
- distilr version (`./distilr --help` shows it).
- Provider + model.
- The target SaaS URL (or "not applicable" if it's a CLI / TUI bug).
- What you expected vs. what happened.
- A snippet of `distilr.log` or the per-project `projects/<slug>/log/...` if relevant.

Use the issue templates under [.github/ISSUE_TEMPLATE/](./.github/ISSUE_TEMPLATE/) — they prompt for the right info.

## Security

Found a vulnerability? Don't open a public issue. See **[SECURITY.md](./SECURITY.md)** for the disclosure process.

## License

By contributing, you agree your contributions are licensed under the [MIT License](./LICENSE.md), the same license as the rest of the project.
