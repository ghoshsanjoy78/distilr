// Per-project .env.local writer. Used by stage 9's setup checklist:
// the user pastes a value for an architect-suggested env var (e.g.
// `STRIPE_SECRET_KEY`), and we upsert it into the project's local
// `.env.local`. The repo-root `.env.local` (driven by env-file.ts) is
// for distilr's OWN provider keys; this module is for the user's app
// keys, scoped to one project.
//
// CRITICAL — values pasted into the TUI flow through this module to
// disk and never leave the local machine. There is no code path that
// includes a value from .env.local in any LLM prompt.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectPaths } from "../store/project.js";
import { mergeEnvLines, parseEnvFile } from "./env-file.js";

export function projectEnvPath(slug: string): string {
  return join(projectPaths(slug).output, ".env.local");
}

/** Read existing per-project env vars. Empty object if the file
 *  doesn't exist yet. Used by stage 9 to skip already-set items so a
 *  resumed run only asks about what's still missing. */
export function readProjectEnv(slug: string): Record<string, string> {
  const path = projectEnvPath(slug);
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

/**
 * Upsert env vars in the project's `.env.local`. Empty-string values
 * delete a key (same convention as `writeEnvLocal`). Creates the
 * output directory if it doesn't exist yet.
 */
export function writeProjectEnv(
  slug: string,
  updates: Record<string, string>,
): void {
  const path = projectEnvPath(slug);
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const merged = mergeEnvLines(existing, updates);
  writeFileSync(path, merged, "utf8");
}
