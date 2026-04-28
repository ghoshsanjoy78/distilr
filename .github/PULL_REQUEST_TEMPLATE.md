<!--
Thanks for the PR! A few quick prompts before you submit.
Delete sections that don't apply.
-->

## What this changes

<!-- 1-2 sentences. Why does this PR exist? -->

## How to test

<!--
Concrete steps a reviewer can run.
e.g.
  - npm run typecheck
  - ./distilr providers
  - Run end-to-end against tally.so, observe X.
-->

## Checklist

- [ ] `npm run typecheck` passes locally.
- [ ] User-facing surface still works (smoke-tested with `./distilr providers` or an end-to-end run).
- [ ] If this changes behavior visible to the user, the README and/or `docs/` are updated in this same PR. (See [CLAUDE.md](../CLAUDE.md) for which file maps to which kind of change.)
- [ ] If this adds a new emitted output file or renames one, `docs/PIPELINE.md` (Output layout) is updated.
- [ ] If this changes the CLI / env vars / providers, `docs/CONFIGURATION.md` is updated.
- [ ] If this is a new common error, `docs/TROUBLESHOOTING.md` has an entry.
- [ ] Commit messages explain the *why*, not the *what*.

## Linked issues

<!-- Closes #123 -->
