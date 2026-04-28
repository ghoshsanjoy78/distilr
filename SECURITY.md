# Security policy

## Reporting a vulnerability

If you've found a security issue in distilr, **please do not open a public GitHub issue**. Instead, report it privately so it can be triaged and fixed before details become public.

**Contact:** ghoshsanjoy@gmail.com

If possible, include:

- A short description of the issue and its potential impact.
- Steps to reproduce, or a minimal proof-of-concept.
- The distilr version, provider, and Node version you observed it on.
- Any suggested mitigation.

You'll get an acknowledgement within a few business days. From there:

1. The issue is reproduced and severity assessed.
2. A fix is developed in a private branch.
3. A patch release is published, and the issue is disclosed in the release notes.
4. If a CVE is appropriate, one is requested at disclosure time.

Please give the maintainer a reasonable window to ship a fix before publishing details. The default is 90 days, but most fixable issues land much faster.

## Supported versions

distilr is pre-1.0. Only the current `main` branch and the latest published release receive security fixes. If you're running an older release, the fix is to upgrade.

| Version | Supported |
|---|---|
| `0.1.x` (current) | yes |
| `< 0.1.0` | no |

## Scope

In scope:

- The distilr CLI / TUI itself (`src/`).
- The Playwright browser automation, including the destructive-action and credentials guards (`src/tools/browser.ts`).
- The setup wizard's handling of API keys and `.env.local`.
- The architect's tool input parsing and the per-project file layout (`src/store/`).

Out of scope:

- Issues in upstream dependencies (Anthropic / OpenAI / Google SDKs, Playwright, Ink, etc.) — report those upstream. distilr will pull in the fix.
- The content of generated `output/` trees — they're produced by an LLM and should always be reviewed before being shipped to production.
- Targets that distilr is *pointed at* (the SaaS being studied). distilr is a study tool, not a security scanner.

## Hardening notes

A few design choices that reduce blast radius if distilr is misused:

- The browser is **always headed** — automation is observable.
- `browser_click` refuses on a hardcoded destructive-verb regex (`delete | remove | unsubscribe | send | publish | pay | charge | invite | …`). The agent must call `browser_click_destructive` for those, which prompts for explicit user approval at the terminal.
- `browser_fill` refuses on credential-shaped input names (`password | cardnumber | cvv | ssn | tax-id`).
- The user signs in manually — the agent never sees credentials.
- Every stage is checkpointed, so `Ctrl-C` is always safe.
- API keys live only in `.env.local`, which is gitignored.

If you find a way around any of these, that's exactly the kind of report this policy is for.
