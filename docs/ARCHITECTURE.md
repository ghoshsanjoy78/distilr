# Architecture (of `distilr` itself)

```
src/
  cli.ts                          entrypoint — commander + env loading + TUI mount
  config.ts                       loads .env.local / .env (re-exports provider helpers)
  providers.ts                    provider + auth-method factory
  pipeline.ts                     stage orchestrator with checkpoint/resume + project picker
  stages/                         01-target … 08-emit (each takes a Bus)
  setup/env-file.ts               read/write .env.local
  setup/wizard.ts                 first-run + reconfigure wizard (distilr config)
  agents/                         recon, explorer, synthesizer, architect
  agents/run.ts                   translates AI-SDK fullStream events into Bus events
  agents/tool-selection.ts        pickTools helper (slice tool dicts per agent)
  agents/area-scan.ts             one-shot generateObject scan of authenticated app's areas
  agents/login-check.ts           one-shot generateObject check that user actually signed in
  agents/app-ideas.ts             one-shot generateObject for wizard name/description suggestions
  agents/idea-research.ts         stage-1 SaaS suggestions when user describes an idea
  agents/scope-check.ts           one-shot generateObject scope-realism classifier
  tools/                          5 tool collections: browser, notes, catalog, architect, ask-user
  browser/                        singleton Playwright persistent context per project slug
  browser/sanitize.ts             surrogate-safe truncation for tool returns
  store/                          zod schemas + per-project file layout
  tui/                            Ink (React) TUI: bus, hooks, layout/header/footer/main, prompts
  output/                         writes the generated project from architect output
  output/templates.ts             template strings for the scaffolded docs/ files
```

The UI is a single Ink (React) tree subscribed to an `AgentBus`. Stages and tools push events (`emit`) and request user input via promise-based modals (`askInput`, `askSelect`, `askMultiSelect`, `askConfirm`). Stray `console.log` from the SDK or Playwright is captured to a per-project log file so the TUI frame stays clean.

## Agent runtime

Agents call [Vercel AI SDK](https://ai-sdk.dev)'s `streamText()` with a tightly-scoped `tools` dict (no `Bash` / `Write` / `Edit` etc.). The runner translates `fullStream` events into bus events; the TUI subscribes and renders.

The architect's output JSON is parsed strictly via `ArchitectOutputSchema.parse()` before being written to disk. If the model fails to call the submit tool at all, a post-run check throws a clear "model didn't call submit" error rather than letting the next stage fail on a missing file.
