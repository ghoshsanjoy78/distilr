// Template stubs for the scaffolded documents under docs/. These start
// as ready-to-edit prose with TODO markers — the implementer fills them
// in as the build progresses.
//
// Functions take a ProductSpec where useful so we can mention the
// chosen stack/auth/hosting in the body.

import { ProductSpec } from "../store/schemas.js";

export const QUALITY_SCORE_TEMPLATE = `# Quality Score

A grading rubric for each product domain and architectural layer. The
implementer should update this regularly — at minimum after every phase
ships — to keep a real-time read on where coverage is solid and where
debt is accumulating.

## How to use this file

Per domain, score each dimension 0-3 with a short note on what's missing
to reach the next level:

  - **Tests** (unit + integration + e2e — coverage of critical paths)
  - **Reliability** (error handling, observability, graceful degradation)
  - **Security** (input validation, auth boundaries, secret handling)
  - **DX** (developer ergonomics — how easy is it to add to or change?)
  - **Docs** (is the product spec / data model up to date?)

## Domains

_The implementer adds entries here as new domains appear in the codebase._

### TODO: <Domain name>

| Dimension   | Score | Notes |
|-------------|-------|-------|
| Tests       |   /3  |       |
| Reliability |   /3  |       |
| Security    |   /3  |       |
| DX          |   /3  |       |
| Docs        |   /3  |       |
`;

export const DESIGN_DOCS_INDEX_TEMPLATE = `# Design Docs

Catalog of design and architecture decisions for this product. Add a new
entry every time a non-trivial decision is made — favored a particular
library, structured a subsystem a specific way, decided NOT to do
something obvious. Future agents read this to understand WHY the code
looks the way it does.

## Files in this directory

- [core-beliefs.md](./core-beliefs.md) — agent-first operating principles
  (parse-don't-validate, layered architecture, etc.). Read first.

## Decision records

_Template for a new decision: copy this block, paste it as a new file
\`<NN>-<short-slug>.md\` in this directory, and link from here._

\`\`\`
# NN: <decision title>

**Status:** accepted | superseded | deprecated
**Date:** YYYY-MM-DD

## Context

What was the situation that needed a decision?

## Decision

What did we decide?

## Consequences

What follows from this — both positive and negative?

## Alternatives considered

What did we look at and reject? Why?
\`\`\`

_TODO: add decision records here as they accumulate._
`;

export const TECH_DEBT_TRACKER_TEMPLATE = `# Tech Debt Tracker

Append-only log of known shortcuts, hacks, and "we'll fix this later"
decisions. Each item carries enough context for a future agent to
understand the cost and decide whether it's worth paying down.

## Format

\`\`\`
## YYYY-MM-DD: <short title>

**Severity:** low | medium | high
**Where:** <path or domain>

What's the shortcut? Why was it taken? What's the cost? What's the
preferred fix when we get to it?
\`\`\`

## Items

_TODO: add tech debt items here as they accumulate._
`;

export const REFERENCES_README_TEMPLATE = `# References

This directory holds external library / framework documentation in a
form the agent can consume during a task. The convention is to drop
\`*-llms.txt\` files here — typically obtained from each project's
\`/llms.txt\` or \`/llms-full.txt\` endpoint.

## When to add a reference

- The implementer reaches for a library it isn't familiar with.
- The library's API surface is large enough that web search alone is
  unreliable.
- The library version pinned in package.json doesn't match what the
  model has in its training set.

## Format

\`\`\`
<library-name>-llms.txt
\`\`\`

For example: \`zod-llms.txt\`, \`prisma-llms.txt\`, \`tailwindcss-llms.txt\`.

## Sources

Most well-maintained libraries publish an llms.txt at:
- \`https://<lib-site>/llms.txt\`
- \`https://<lib-site>/llms-full.txt\`

Otherwise, generate one with [llmstxt.dev](https://llmstxt.dev) or
extract relevant sections of the docs by hand.
`;

export const GENERATED_README_TEMPLATE = `# Generated docs

Output of automated generators that turn code or schemas into markdown
the agent can read in-context. **Do not hand-edit files in this
directory** — they're overwritten by their generator.

## Examples of what lands here

- \`db-schema.md\` — current state of the database schema, generated
  from migrations or the live introspection.
- \`openapi.md\` — human-readable rendering of the OpenAPI spec.
- \`route-tree.md\` — full list of HTTP routes and their handlers.
- \`feature-flags.md\` — current flag definitions and rollout state.

## Wiring up a generator

Each generator should:

1. Live in \`scripts/\` or wherever your codebase puts dev tooling.
2. Be triggerable by a single CLI command (e.g. \`npm run gen:db-schema\`).
3. Be wired into CI so it runs on every PR — failing if the file in
   this directory has drifted from the source of truth.
`;

export function reliabilityTemplate(spec: ProductSpec): string {
  const stackHint = stackToHint(spec);
  return `# Reliability

Reliability targets and the practices that keep us at them. The
implementer updates this as the system grows — start here for
"how do we keep this thing up?"

## Targets

_TODO: pick concrete numbers as the system gains real users._

- **Availability:** 99.5% / month for the primary user-facing path
  (revisit when traffic justifies tighter).
- **P95 page load:** < 2.5 s on the critical user journeys.
- **Error rate:** < 0.5% of requests result in a 5xx.

## Observability

${stackHint.observability}

## Operational practices

- Run health checks per deploy.
- Roll forward, not back, unless data integrity is at risk.
- Every error path that can affect users emits a structured log line
  with the user/request context attached.
- Critical user journeys are exercised by an e2e test before deploy.

## Incident response

When something breaks: write down what happened in
\`docs/design-docs/incidents/YYYY-MM-DD-<slug>.md\`, then update this
file with anything that should change about practices going forward.
`;
}

export function securityTemplate(spec: ProductSpec): string {
  const stackHint = stackToHint(spec);
  return `# Security

The minimum bar for any feature touching user data. The implementer
extends this as new attack surfaces appear.

## Identity & access

- Auth: ${spec.auth}.
- Sessions: ${stackHint.sessions}
- Authorization: every protected endpoint validates the caller has
  permission for the specific resource — not just "is logged in".

## Input handling

- Parse-don't-validate at every boundary (HTTP, queue, DB row → typed
  domain object). ${stackHint.parser}
- Reject early; log the rejection with enough context to debug; never
  echo unsanitized input back in error messages.
- Rate-limit the auth and write paths.

## Secrets

- Never commit secrets to the repo (\`.env\` is gitignored).
- Rotate keys at least annually.
- Use the host's secret manager (${stackHint.secrets}) in production.

## Data protection

- TLS for all external traffic.
- Database backups encrypted at rest.
- PII fields are tagged in the schema (see DATA_MODEL section in
  ARCHITECTURE.md once it lands).

## Disclosure

If you find a vulnerability: see SECURITY.md at the repo root once
this product has external users.
`;
}

export function frontendTemplate(spec: ProductSpec): string {
  const stack = stackToHint(spec);
  if (stack.kind === "backend-only") {
    return `# Frontend

This product is currently backend-only — no UI surface yet. When a UI
is added, this file should be filled in with:

- Framework choice and version
- Component library / design system
- State management conventions
- Routing conventions
- Form / validation conventions
- Accessibility checklist

For visual tokens (colors, type, spacing), see
[../docs/DESIGN.md](./DESIGN.md).
`;
  }
  return `# Frontend

Conventions for the UI layer. Read [DESIGN.md](./DESIGN.md) for visual
tokens (colors, typography, spacing). This file covers the *code-side*
conventions.

## Framework

${stack.frontend}

## Component conventions

- One component per file. Filename matches the export.
- Server components by default (where the framework supports it); mark
  client components explicitly.
- Props are typed at the boundary, never \`any\`.

## State

- Local UI state: framework primitives (\`useState\` / signals / etc.).
- Server state: a dedicated query library (TanStack Query / SWR / etc.).
- Avoid global state stores until at least three components share state.

## Forms

- Validate inputs at the boundary using the same schema library as the
  backend (e.g. Zod) so types and validation rules stay in sync.
- Render server-side errors inline next to the field, not as a generic
  banner.

## Accessibility

- Every interactive element has a keyboard-reachable focus state.
- Color contrast meets WCAG AA against the palette in DESIGN.md.
- Forms label every input; errors are linked to inputs via
  \`aria-describedby\`.
`;
}

interface StackHint {
  kind: "frontend-and-backend" | "backend-only";
  frontend: string;
  observability: string;
  sessions: string;
  parser: string;
  secrets: string;
}

function stackToHint(spec: ProductSpec): StackHint {
  const isBackend = (() => {
    // Heuristic: pure-API stacks would be set by the user as custom and
    // typically marked. We conservatively treat all known stacks as
    // having a frontend, since most produce both.
    return false;
  })();

  if (isBackend) {
    return {
      kind: "backend-only",
      frontend: "N/A — no frontend yet.",
      observability: "Use a structured logger and ship logs to your hosting provider's log drain. Add request-id propagation through every layer.",
      sessions: "JWT or signed cookies — pick at Phase 0 and don't change it later.",
      parser: "Use a runtime validator (Zod for TS, Pydantic for Python).",
      secrets: hostingSecrets(spec),
    };
  }

  return {
    kind: "frontend-and-backend",
    frontend: framework(spec),
    observability: "Use a structured logger and ship logs to your hosting provider's log drain. Add request-id propagation through every layer. For the UI, send page/error telemetry (Sentry, PostHog, etc.) from Phase 0.",
    sessions: "JWT or signed cookies — pick at Phase 0 and don't change it later.",
    parser: "Use a runtime validator (Zod for TS / Valibot for TS / Pydantic for Python) — never trust the client.",
    secrets: hostingSecrets(spec),
  };
}

function framework(spec: ProductSpec): string {
  switch (spec.techStack) {
    case "nextjs-postgres":
      return "Next.js (App Router). React Server Components by default; client components only where interactivity is required.";
    case "sveltekit":
      return "SvelteKit. Server endpoints + Svelte components.";
    case "rails":
      return "Rails with Hotwire (Turbo + Stimulus). Server-rendered HTML; sprinkles of JS where needed.";
    case "phoenix":
      return "Phoenix LiveView. Server-rendered with bidirectional updates over websocket.";
    case "django":
      return "Django + django-htmx (or HTMX directly). Server-rendered templates; HTMX for interactivity.";
    case "custom":
      return spec.techStackCustom ?? "Custom stack — fill this in.";
    case "let-architect-decide":
    default:
      return "TBD — Phase 0 should lock the framework choice. Update this file after that lands.";
  }
}

function hostingSecrets(spec: ProductSpec): string {
  switch (spec.hosting) {
    case "vercel":
      return "Vercel project env vars";
    case "fly":
      return "fly secrets set";
    case "render":
      return "Render environment groups";
    case "self-host":
      return "your secret manager (Doppler, Infisical, AWS Secrets Manager, …)";
    case "let-architect-decide":
    default:
      return "your hosting provider's secret manager — locked in at Phase 0";
  }
}

export const PRODUCT_SPECS_INDEX_HEADER = `# Product specs

Catalog of all features in this product. Each entry is a USER-FACING
spec — what the feature does, who uses it, what it's NOT. Implementation
details belong in the per-phase exec plans under
[../exec-plans/active/](../exec-plans/active/).

## Features

`;
