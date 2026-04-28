# distilr

```
    .___.__          __  .__.__
  __| _/|__| _______/  |_|__|  |_______
 / __ | |  |/  ___/\   __\  |  |\_  __ \
/ /_/ | |  |\___ \  |  | |  |  |_|  | \/
\____ | |__/____  > |__| |__|____/__|
     \/         \/
```

<p align="center">
  <a href="./LICENSE.md"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg" alt="Node 20+" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6.svg" alt="TypeScript strict" /></a>
  <a href="./CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-ff69b4.svg" alt="PRs welcome" /></a>
</p>

Terminal agent that distills any SaaS into a complete build spec — research, design tokens, architecture, and a phased plan, ready for your AI coding agent.

Point it at any SaaS — a form builder, a scheduling tool, a project tracker, an email tool, anything with a focused feature surface. distilr explores the public site and the authenticated app in a real browser, distills what it sees into a feature catalog, walks you through a wizard, and emits a phased build spec your coding agent (Claude Code, Codex, OpenCode, Aider, Cursor, Copilot, Gemini CLI) can execute.

You stay in the loop. The agent **never enters payment info, sends emails, or clicks destructive buttons** without explicit terminal approval. Press `p` any time to interrupt and steer.

> **Scope:** distilr produces an MVP-sized **inspired-by** spec — typically 5-10 phases, ≤ 8 must-have features. It's **not** a tool for reproducing sprawling enterprise platforms or creative-app suites feature-for-feature. Pointed at one of those, the output will be shallow. Narrow your target to a specific module — e.g. just the support-ticket surface of a CRM, or just the color-correction surface of an image editor. distilr warns you at multiple points if your target looks too big.

> **Status:** v0.1.0 — works end-to-end. Bug reports welcome.

## Quickstart

```bash
git clone https://github.com/ghoshsanjoy78/distilr.git
cd distilr
npm install
./distilr
```

`npm install` runs a `postinstall` step that downloads Chromium for Playwright and compiles TypeScript — the binary is ready immediately. The first run launches a TUI **setup wizard** for provider, API key, and model (writes `.env.local` for you). Re-run any time with `./distilr config`.

Pick something with a focused feature surface for your first run — a single-purpose product (one job, done well) tends to produce a sharper spec than a sprawling multi-product suite.

Requires Node 20+, ~250 MB free for Chromium, and a UTF-8 capable terminal.

## Commands

```
distilr                       start (or pick from in-progress projects)
distilr resume <slug>         resume a project from its last checkpoint
distilr build <slug>          walk the stage-9 prompt deck (setup checklist
                              + per-phase copy-paste prompts)
distilr reset <slug> --to <stage>
                              roll a project back so the named stage is the
                              next to run; deletes that stage's artifacts
                              and everything after, asks before deleting
                              (use -y / --yes to skip confirmation)
distilr config                (re-)run the setup wizard
distilr list                  list all projects under projects/
distilr providers             show the active provider/model
distilr --help                full CLI help
```

Per-run overrides: `--provider <name>` and `--model <name>`.

### `distilr reset <slug> --to <stage>`

Rewinds `state.json.lastCompletedStage` and removes the artifacts the named stage and every later stage produced. Useful when you want to redo a step — e.g. re-run the architect with different wizard answers, or re-emit after editing the architect's output JSON.

Stages: `recon | login | explore | synthesize | wizard | architect | emit | implement`.

Examples:

```
distilr reset chatbase --to architect       # redo stages 7+ (architect, emit, build)
distilr reset chatbase --to wizard          # redo stages 6+ (wizard, architect, emit, build)
distilr reset chatbase --to implement       # just clear the build walk-through state
distilr reset chatbase --to architect -y    # skip confirmation
```

Resetting `--to target` isn't supported — that would wipe the whole project. Run `rm -rf projects/<slug>` instead. Note: resetting `--to explore` keeps `observations.jsonl` (recon's data) in place — re-running explore will append on top, and the synthesizer's 100-newest cap absorbs duplicates.

## Safety

- **Always headed.** You can watch every action.
- **Destructive-action guard.** `browser_click` refuses on selectors / labels matching `delete | remove | unsubscribe | send | publish | pay | charge | invite | …`. The agent must call `browser_click_destructive` for those, which prompts you for explicit approval.
- **Credentials guard.** `browser_fill` refuses on `password | cardnumber | cvv | ssn | tax-id` inputs.
- **You sign in.** The agent never sees your credentials.
- **Checkpointed everywhere.** `Ctrl-C` is always safe; `resume` picks up exactly where you left off.

The destructive-verb regex lives at the top of `src/tools/browser.ts`.

## How distilr respects the source

distilr studies a SaaS to inform a *new* MVP — never to clone it. Every agent in the pipeline operates under these rules, baked into their system prompts (see [`src/agents/guidelines.ts`](src/agents/guidelines.ts)):

1. **Never copy source code** (even partially). We capture behavior and shape; your coding agent writes new code from scratch.
2. **Never reproduce exact UI designs, layouts, or assets.** Describe patterns, not pixel-perfect copies. No extracting icons, illustrations, custom fonts, or brand assets.
3. **Never copy text content** — docs, onboarding flows, microcopy, error messages, marketing copy. Describe what the text accomplishes; new copy is written for the new product.
4. **Never use the source's trademarks or branding** in a confusing way. The output is *inspired-by*, not a clone or knockoff. Pick a name that's clearly distinct.
5. **Respect the source's Terms of Service.** Stay on the user-facing surface. Respect rate limits. Don't reverse-engineer protected APIs. Don't bulk-scrape.

These are not opt-in — they're injected into every heavy agent's system prompt at build time. The source of truth is one file ([`src/agents/guidelines.ts`](src/agents/guidelines.ts)) so the prompts and these public docs cannot drift apart.

## Docs

- **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** — env vars, CLI flags, providers.
- **[docs/PIPELINE.md](docs/PIPELINE.md)** — the 8 spec stages + optional build-prompt walk-through, scope guardrails, interactive controls, output layout, handoff.
- **[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)** — common errors and fixes.
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — how distilr itself is built (for contributors).

## Contributing

PRs and issues welcome. Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)** — it covers the development loop, code conventions, and the kinds of changes most needed right now.

By participating, you agree to abide by the **[Code of Conduct](./CODE_OF_CONDUCT.md)**. Found a security issue? See **[SECURITY.md](./SECURITY.md)** for how to report it privately.

## License

[MIT](./LICENSE.md) © Sanjoy Ghosh
