# distilr — instructions for AI coding agents

distilr is a TypeScript / Ink TUI app that drives a multi-stage pipeline (recon → explore → synthesize → wizard → architect → emit) to distill a SaaS into a build spec for handoff to a coding agent. The repo is at `https://github.com/ghoshsanjoy78/distilr`.

This file is for AI agents (Claude Code, Codex, Aider, etc.) working on **distilr itself**. The per-project `CLAUDE.md` that gets emitted under `projects/<slug>/output/` is a separate file written by the architect agent at runtime — don't confuse the two.

## Build / verify

- `npm run build` — TypeScript compile, emits `dist/`.
- `npm run typecheck` — typecheck only, no emit. Run after every code change.
- `./distilr providers` — sanity-check the build still loads.
- `./distilr --help` — verify the CLI surface.
- No tests yet. Don't fake it; if you add tests, wire them into a `npm test` script.

## When making changes — keep user-facing docs current

User-facing docs are split: a tight `README.md` (landing page) plus deeper docs under `docs/`. **Keep the README focused** — anything technical that runs more than 2-3 sentences belongs in `docs/`. Update the appropriate file whenever any of the following change:

| Change | File to update |
|---|---|
| New CLI command / subcommand / flag | `README.md` (Commands section) + `docs/CONFIGURATION.md` if it touches env or providers |
| New env var, provider, model, or auth method | `docs/CONFIGURATION.md` |
| New stage, behavior change in an existing stage, or new scope guardrail | `docs/PIPELINE.md` |
| New TUI keybinding | `docs/PIPELINE.md` (Interactive controls table) |
| New output file in the generated `output/docs/` tree, or a renamed/removed one | `docs/PIPELINE.md` (Output layout) |
| Schema change visible in saved `state.json`, `feature-catalog.json`, `spec.json`, or emitted markdown | `docs/PIPELINE.md` |
| Change in safety guardrails or the destructive-action regex | `README.md` (Safety section) |
| New common error or fix | `docs/TROUBLESHOOTING.md` |
| New module under `src/` | `docs/ARCHITECTURE.md` |

If you're not sure whether a change is user-facing, treat it as if it is. Out-of-date docs cost more than the change being undocumented in the first place. **Do not bloat the README** — if a section is growing past a paragraph, move it to a `docs/` file and link.

## When changing the emitted output

The output tree under `projects/<slug>/output/` follows OpenAI's [harness-engineering layout](https://openai.com/index/harness-engineering/). Treat that as the authority for what belongs where:

- `AGENTS.md` is a ~100-line table of contents, not a manual. Don't grow it.
- New docs slot under `docs/` (with subdirectories where the article does — `design-docs/`, `product-specs/`, `exec-plans/{active,completed}/`, `references/`, `generated/`).
- Phase files are exec plans (`Status` + spec + `Decision log` + `Progress log`) — they live and breathe as the implementer ships, not just as static specs.
- Templates for files distilr scaffolds (vs architect-writes) live in `src/output/templates.ts`. Architect-written content comes from `ArchitectOutputSchema` fields.

When you add a new emitted doc, also update the Output layout section in `docs/PIPELINE.md`.

## Conventions

- All new code is TypeScript strict.
- Tools (under `src/tools/`) are AI-SDK format. Agents pass them as the `tools` dict to `streamText()`.
- TUI prompts go through the `AgentBus` (`src/tui/bus.ts:askInput / askSelect / askMultiSelect / askConfirm`), never directly through `inquirer` / stdin / `readline`.
- Stray `console.log` will corrupt the Ink frame. Route through `pino` via `src/tui/log-redirect.ts`, or `bus.emit({ kind: "info", text: ... })`.
- Schemas in `src/store/schemas.ts` are strict — every field required, no `.default()` for backward-compat. The architect's prompt is responsible for emitting every field.
- Provider-strict validators (Anthropic's `output_config.format`, others) reject array `.min()/.max()` in tool input schemas. Keep tool schemas loose; validate strictly inside `execute()` if you need invariants.

## Working in plan mode

When asked to plan substantial changes, write to the plan file (one approved by the user) before editing code. Skip plan mode for typo / one-line fixes / pure refactors that don't change behavior.

## Handoff between agents

If a partial change leaves the codebase compiling but with a stale README, leave a note in the next commit explaining why. Better: don't ship the partial change — finish the docs in the same commit.
