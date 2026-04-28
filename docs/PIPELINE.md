# Pipeline

distilr runs an 8-stage spec pipeline plus an optional 9th stage that walks you through a setup checklist and a deck of copy-paste prompts you'll run in your AI coder of choice (Claude Code, Codex, Cursor, v0, Aider, Gemini CLI, …). Every stage is checkpointed — `Ctrl-C` is always safe and you can `./distilr resume <slug>` to pick up where you left off.

## The stages

```
1. target      pick the SaaS to study — either name a specific one OR
                describe what you want to build and let AI suggest matching SaaS.
                Runs an LLM scope-realism check; warns if the target is too
                sprawling for an MVP-sized spec.
2. recon       agent explores public pages (homepage, pricing, features, docs).
                Emits a "this looks big" warning if observations / pages exceed
                soft thresholds.
3. login       opens a real Chromium window — you sign up / log in manually
                + auto-verify (LLM checks the page) + skip option (analysis-only mode)
4. explore     scan high-level areas, you pick which to focus on,
                agent drives the authenticated app on the selected areas
5. synthesize  observations → structured feature catalog (categories, complexity 1-5).
                Hard cap of 100 observations into the synthesizer (newest wins).
6. wizard      AI-suggested app name + description, then 9 more questions:
                target user, differentiation, features to keep, look & feel,
                stack, auth, hosting, monetization, implementer.
                Hard cap of 8 must-have features.
7. architect   designs system architecture, design tokens, and a phased build plan
                with rich per-phase product/eng specs. Hard cap of 10 phases.
8. emit        writes the harness-engineering doc tree under output/
9. build       OPTIONAL. Walks you through a setup checklist (env vars
                / API keys → .env.local) and a deck of copy-paste prompts
                (one per phase) to run in your AI coder.
                Run inline at the end of stage 8, or later via `./distilr build <slug>`.
```

## Stage 9: build (the prompt deck)

Optional. Skipped by default — at the end of stage 8 you're prompted whether to walk through the build deck now or later (`./distilr build <slug>`).

What it does:

1. **Setup checklist** — the architect emits a list of external accounts / API keys / secrets your project needs (Supabase, Stripe, OAuth client IDs, etc.). For each item, distilr shows you what it's for and where to get it; you paste the value (which lands in `projects/<slug>/output/.env.local` locally — **never sent to any LLM**) or hit Enter to skip. Items already present in `.env.local` from a prior session are auto-skipped.

2. **Prompt deck** — distilr generates one carefully-crafted markdown prompt per step:
   - Onboarding ("Read these docs first, then start Phase 0")
   - One per phase (each references its `docs/exec-plans/active/phase-NN.md` spec)
   - Final wrap-up ("Verify, deploy, ship v0.1.0")

   Each prompt is shown in the TUI **and** written to `projects/<slug>/output/prompts/NN-name.md`. Copy the prompt into your AI coder (Claude Code, Codex, Cursor, v0, …), run it externally, come back to distilr, hit "Next prompt" to advance.

distilr is **not** in the loop on whether your AI coder succeeds — we trust you. State persists to `state.json.buildProgress`, so a quit-and-resume picks up at the next unseen prompt. distilr makes no LLM calls during stage 9; secrets you paste never leave the local machine.

The prompt files survive distilr exits, so you can come back days later and pick up from your editor — they're plain markdown, version-control them or hand them to a teammate.

## Scope guardrails

distilr produces an MVP-sized spec, not a feature-for-feature clone. Several guardrails enforce that:

- **Stage 1 scope check** — LLM classifies your target as `focused` / `broad` / `sprawling` and offers to narrow before continuing.
- **Post-recon size warning** — if recon recorded > 50 observations or > 15 pages, you get a yellow warning pointing at the area picker as the next narrowing opportunity.
- **Token-budget warnings** — at 50k / 200k / 500k cumulative tokens, you get a one-shot warning with a rough cost estimate. Press `p` to interrupt and steer if the agent is wandering.
- **Hard caps** — 8 must-haves (wizard prompts you to demote if you exceed), 10 phases (architect is told this in its system prompt; the tool execute layer truncates if exceeded), 100 observations (synthesizer drops the oldest).

All warnings are soft — there's always a "continue anyway" path.

## Interactive controls during a run

| Key / Action | Where | Effect |
|---|---|---|
| `p` | recon / explore stages | open the interrupt modal — choose to stop, keep going, or send guidance + restart |
| `Esc` | interrupt / agent modals | dismiss → equivalent to "keep going" |
| `↑` `↓` | sidebar | navigate stages |
| `0` / `Tab` | always | snap selection back to the live active stage |
| `1`–`8` | sidebar | jump to a stage by number |
| `r` | error screen | retry from where it failed |
| `space` | multi-select modals | toggle selection |
| `enter` | any modal | confirm |
| `Ctrl-C` | always | hard interrupt → safe; resume with `./distilr resume <slug>` |
| `q` or `enter` | final / error screen | exit cleanly |

When interrupting recon/explore, the activity feed stays visible above the modal so you can see what's been recorded before deciding.

## Output layout

Each project lives in `projects/<slug>/`:

```
projects/<slug>/
├── state.json              current pipeline stage
├── observations.jsonl      every observation the agents recorded
├── screenshots/            full-page screenshots, one per major view
├── feature-catalog.json    synthesizer output: categories + features
├── spec.json               your wizard answers
└── output/                 ← the deliverable, what you hand to your coding agent
    ├── AGENTS.md           ~100-line table of contents (cross-tool convention)
    ├── CLAUDE.md           same content as AGENTS.md (Claude Code's filename)
    ├── ARCHITECTURE.md     system layout, data model, services, mermaid diagram
    ├── README.md           short project README
    ├── SETUP.md            checklist of env vars / API keys this project needs
    ├── .env.local          (stage 9) your pasted secret values — gitignored
    ├── .gitignore          minimal — implementer extends in Phase 0
    ├── prompts/            (stage 9) one .md per phase prompt
    └── docs/
        ├── DESIGN.md                       design tokens — palette, type,
        │                                   spacing, motion (architect-written)
        ├── PLANS.md                        high-level phase overview
        ├── PRODUCT_SENSE.md                target user, differentiation,
        │                                   monetization, voice (architect-written)
        ├── QUALITY_SCORE.md                template — implementer fills as ships
        ├── RELIABILITY.md                  template — stack-aware reliability
        ├── SECURITY.md                     template — stack-aware security
        ├── FRONTEND.md                     template — frontend conventions
        ├── design-docs/
        │   ├── index.md                    template — decision-record catalog
        │   └── core-beliefs.md             agent-first operating principles
        ├── product-specs/
        │   ├── index.md                    catalog of features
        │   └── <slug>.md                   one per must-have feature
        ├── exec-plans/
        │   ├── active/
        │   │   ├── phase-00.md             scaffolding (full product/eng spec)
        │   │   ├── phase-01.md             thin slice of top must-have
        │   │   └── ...
        │   ├── completed/                  empty initially — phases move here
        │   └── tech-debt-tracker.md        template — append-only debt log
        ├── references/                     drop llms.txt files for stack libs here
        └── generated/                      auto-generated docs (db-schema, openapi)
```

The layout follows OpenAI's [harness-engineering pattern](https://openai.com/index/harness-engineering/) for fully agent-generated codebases: the **repository is the system of record**, `AGENTS.md` is a 100-line table of contents (not a manual), and content is catalogued under `docs/` so future agents can navigate intentionally instead of pattern-matching.

> **Browser session lives outside the project dir.** Chromium's persistent profile (cookies, localStorage, HTTP cache) is kept at the OS cache location — `~/Library/Caches/distilr/<slug>/browser-data/` on macOS, `~/.cache/distilr/<slug>/browser-data/` on Linux, `%LOCALAPPDATA%\distilr\Cache\<slug>\browser-data\` on Windows (override with `DISTILR_CACHE_DIR`). This keeps the project tree clean of operational data and means accidentally tar-ing the project never ships your session cookies or cached source-SaaS assets. Login persistence across `Ctrl-C` + `./distilr resume` works exactly the same — only the storage location changed.

Each `phase-NN.md` is a full product/eng spec **plus living state**: a `Status` flag (`planned` → `active` → `completed`), user stories, scope, functional requirements, data model, API surface, UI requirements, edge cases, out-of-scope, acceptance criteria, test approach, plus an empty `Decision log` and `Progress log` the implementer fills in as they execute. Each `docs/product-specs/<slug>.md` is the user-facing description of one feature.

`CLAUDE.md` and `AGENTS.md` contain the **same** content under different filenames — Claude Code reads `CLAUDE.md` by default; Codex / Aider / Cursor / OpenCode / Copilot / Gemini CLI all read `AGENTS.md`.

## Handoff

When stage 8 finishes and you press `q` or `enter` to dismiss the final screen, the `./distilr` wrapper offers to drop you straight into the output dir:

```
→ cd into /Users/you/.../projects/<slug>/output ? [Y/n]
```

Hit enter to accept and you're in a fresh interactive shell rooted in the output directory, ready to run your coding agent. Type `n` to stay in your original shell. (A child process can't change its parent shell's `cwd` in Unix, so this is the cleanest "auto-cd" we can do — see the wrapper script for details.)

Stage 8's final screen also prints exact commands for every common implementer:

```
Next steps:
  cd /Users/you/projects/distilr/projects/<slug>/output

Then run with whichever coding agent you prefer:

  Claude Code    →  claude "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"
  OpenAI Codex   →  codex "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"
  OpenCode       →  opencode "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"
  Aider          →  aider AGENTS.md docs/PLANS.md docs/exec-plans/active/phase-00.md
  Cursor         →  open the dir, then ask the agent to read AGENTS.md
  GitHub Copilot →  open the dir, then use Copilot Chat to follow AGENTS.md
  Gemini CLI     →  gemini "Read AGENTS.md and start docs/exec-plans/active/phase-00.md"
```
