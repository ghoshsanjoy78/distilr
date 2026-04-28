// `distilr reset <slug> --to <stage>` — roll a project back so the
// given stage is the next one to run. Removes the artifacts produced
// by that stage and every stage after, and rewinds
// `state.json.lastCompletedStage` accordingly.
//
// The cleanup logic is intentionally per-stage: each stage owns the
// files / state fields it produces, and resetting "to <stage>"
// removes everything that stage and all later stages contributed.
//
// Some artifacts are shared across stages (observations.jsonl is
// appended by both recon and explore). For those, the policy is:
// resetting to a stage that's a strict consumer wipes them; resetting
// to a stage that's the same producer or a later sibling (e.g. "to
// explore") leaves them in place — accepting that re-running explore
// will append on top of recon's data, and the synthesizer's 100-newest
// cap handles the bloat.

import { existsSync } from "node:fs";
import { rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  projectPaths,
  readState,
  writeState,
} from "./store/project.js";
import { STAGES, type Stage } from "./store/schemas.js";
import { ARCHITECT_OUTPUT_FILENAME } from "./agents/architect.js";

interface CleanupSpec {
  /** Stage AFTER which the project should resume. e.g. resetting "to architect" sets this to "wizard". */
  newLastCompleted: Stage | "none";
  /** Files (absolute paths) to delete if present. */
  files: string[];
  /** Directories (absolute paths) to recursively delete if present. */
  dirs: string[];
  /** State.json fields to clear. */
  clearStateFields: ("skippedAuth" | "selectedAreas" | "buildProgress")[];
  /** Human-readable summary lines printed before the user confirms. */
  summary: string[];
}

const ARCHITECT_SNAPSHOTS = [
  "architect-docs.json",
  "architect-plans.json",
  "architect-specs.json",
];

function previousStage(target: Stage): Stage | "none" {
  const idx = STAGES.indexOf(target);
  if (idx <= 0) return "none";
  return STAGES[idx - 1]!;
}

function emittedRoot(slug: string): string {
  return projectPaths(slug).output;
}

function projectRoot(slug: string): string {
  return projectPaths(slug).root;
}

/**
 * Build the cleanup plan for resetting <slug> back to <target>. Pure —
 * no I/O. Caller prints the plan, asks for confirmation, then calls
 * `applyCleanup`.
 */
export function planReset(slug: string, target: Stage): CleanupSpec {
  const paths = projectPaths(slug);
  const root = projectRoot(slug);
  const out = emittedRoot(slug);

  // Build the spec by accumulating "things produced by stage X and
  // every later stage" — order matters so the summary reads top-down.
  const files: string[] = [];
  const dirs: string[] = [];
  const clearStateFields: CleanupSpec["clearStateFields"] = [];
  const summary: string[] = [];

  // Helper: union-add items if not already in the list.
  const addFile = (p: string, label: string) => {
    if (!files.includes(p)) {
      files.push(p);
      summary.push(`  delete  ${label}`);
    }
  };
  const addDir = (p: string, label: string) => {
    if (!dirs.includes(p)) {
      dirs.push(p);
      summary.push(`  delete  ${label}/`);
    }
  };
  const addStateField = (
    field: CleanupSpec["clearStateFields"][number],
    label: string,
  ) => {
    if (!clearStateFields.includes(field)) {
      clearStateFields.push(field);
      summary.push(`  clear   state.${field}  (${label})`);
    }
  };

  const idx = STAGES.indexOf(target);
  // Walk from the target stage to the end, collecting cleanup for each.
  for (let i = idx; i < STAGES.length; i++) {
    const s = STAGES[i]!;
    switch (s) {
      case "target":
        // Resetting "to target" means wiping the project state file
        // itself. We don't support that here — the user can just `rm
        // -rf projects/<slug>` if they want a clean slate.
        break;
      case "recon":
        addFile(paths.observationsFile, "observations.jsonl");
        addDir(paths.screenshotsDir, "screenshots");
        addStateField("skippedAuth", "set during login");
        addStateField("selectedAreas", "set during explore");
        break;
      case "login":
        // Login itself produces no files; it just toggles
        // state.skippedAuth, which is already cleared by the recon
        // entry above when applicable.
        addStateField("skippedAuth", "user re-decides login");
        break;
      case "explore":
        // Explore appends to observations.jsonl alongside recon.
        // Resetting *to* explore (i.e. preserving recon) leaves the
        // file in place — re-running explore will append on top, and
        // the synthesizer's 100-newest cap absorbs the duplicate
        // entries. Document this in the summary so the user knows.
        addStateField("selectedAreas", "user re-picks areas");
        summary.push(
          "  note    observations.jsonl kept (recon's data) — explore will append",
        );
        break;
      case "synthesize":
        addFile(paths.catalogFile, "feature-catalog.json");
        break;
      case "wizard":
        addFile(paths.specFile, "spec.json");
        break;
      case "architect":
        addFile(join(root, ARCHITECT_OUTPUT_FILENAME), ARCHITECT_OUTPUT_FILENAME);
        for (const snap of ARCHITECT_SNAPSHOTS) {
          addFile(join(root, snap), snap);
        }
        break;
      case "emit":
        addDir(out, "output");
        break;
      case "implement":
        // Stage 9 writes into output/. If we already nuked output/
        // above (when target ≤ emit), these specific items are a
        // no-op. Otherwise (target === implement) we surgically
        // remove just the stage-9 artifacts so the spec docs stay.
        if (!dirs.includes(out)) {
          addFile(join(out, ".env.local"), "output/.env.local");
          addDir(join(out, "prompts"), "output/prompts");
        }
        addStateField("buildProgress", "stage 9 walk-through state");
        break;
    }
  }

  return {
    newLastCompleted: previousStage(target),
    files,
    dirs,
    clearStateFields,
    summary,
  };
}

export async function applyReset(
  slug: string,
  spec: CleanupSpec,
): Promise<void> {
  for (const f of spec.files) {
    if (existsSync(f)) await unlink(f);
  }
  for (const d of spec.dirs) {
    if (existsSync(d)) await rm(d, { recursive: true, force: true });
  }
  const state = await readState(slug);
  state.lastCompletedStage = spec.newLastCompleted;
  for (const field of spec.clearStateFields) {
    if (field === "skippedAuth") state.skippedAuth = false;
    else if (field === "selectedAreas") state.selectedAreas = undefined;
    else if (field === "buildProgress") state.buildProgress = null;
  }
  await writeState(state);
}
