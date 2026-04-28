// Helpers that read the per-project persisted files and produce a
// short, human-readable summary string for any completed stage.
//
// Used by the right-pane StageSummary component when the user navigates
// to a past stage in the left sidebar. Pure async data — no React.

import { existsSync } from "node:fs";
import {
  projectPaths,
  readState,
  readObservations,
  readCatalog,
  readSpec,
  readArchitectOutput,
} from "../store/project.js";
import type { Stage } from "../store/schemas.js";

const NOT_AVAILABLE = "(no data captured for this stage yet)";

/**
 * Returns a short paragraph describing what happened in the given
 * stage of the given project. Falls back to a generic
 * "(not available)" string if a required artifact is missing.
 */
export async function summarizeStage(
  stage: Stage,
  slug: string,
): Promise<string> {
  try {
    switch (stage) {
      case "target":
        return await summarizeTarget(slug);
      case "recon":
        return await summarizeRecon(slug);
      case "login":
        return await summarizeLogin(slug);
      case "explore":
        return await summarizeExplore(slug);
      case "synthesize":
        return await summarizeSynthesize(slug);
      case "wizard":
        return await summarizeWizard(slug);
      case "architect":
        return await summarizeArchitect(slug);
      case "emit":
        return await summarizeEmit(slug);
      case "implement":
        return await summarizeImplement(slug);
    }
  } catch {
    return NOT_AVAILABLE;
  }
}

async function summarizeTarget(slug: string): Promise<string> {
  const s = await readState(slug);
  return `Project: ${s.slug} · ${s.saasName} (${s.saasUrl})`;
}

async function summarizeRecon(slug: string): Promise<string> {
  const obs = await readObservations(slug);
  if (obs.length === 0) return NOT_AVAILABLE;
  const pages = new Set(obs.map((o) => o.page).filter(Boolean)).size;
  const top = topKindCounts(obs, 4);
  return `Recorded ${obs.length} observation${obs.length === 1 ? "" : "s"} across ${pages} page${pages === 1 ? "" : "s"}. Top kinds: ${top}.`;
}

async function summarizeLogin(slug: string): Promise<string> {
  const s = await readState(slug);
  if (s.skippedAuth) {
    return "Skipped — analysis-only mode (no in-app exploration).";
  }
  return "Signed in. Authenticated app surface available for exploration.";
}

async function summarizeExplore(slug: string): Promise<string> {
  const s = await readState(slug);
  const obs = await readObservations(slug);
  const areas = s.selectedAreas ?? [];
  const areaText = areas.length > 0 ? areas.join(", ") : "(no focus areas selected)";
  if (obs.length === 0) return NOT_AVAILABLE;
  return `Focus areas: ${areaText}. Total observations recorded: ${obs.length}.`;
}

async function summarizeSynthesize(slug: string): Promise<string> {
  const c = await readCatalog(slug);
  const totalFeatures = c.categories.reduce(
    (sum, cat) => sum + cat.features.length,
    0,
  );
  const top = c.categories
    .slice()
    .sort((a, b) => b.features.length - a.features.length)
    .slice(0, 3)
    .map((cat) => `${cat.name} (${cat.features.length})`)
    .join(", ");
  return `${c.categories.length} categor${c.categories.length === 1 ? "y" : "ies"}, ${totalFeatures} features. Top: ${top}.`;
}

async function summarizeWizard(slug: string): Promise<string> {
  const spec = await readSpec(slug);
  const must = spec.selectedFeatures.filter((f) => f.priority === "must-have").length;
  const total = spec.selectedFeatures.length;
  const stack =
    spec.techStack === "custom"
      ? spec.techStackCustom ?? "custom"
      : spec.techStack;
  return `${spec.appName} — "${spec.oneLiner}". ${total} feature${total === 1 ? "" : "s"} selected (${must} must-have). Stack: ${stack}. Look: ${spec.lookAndFeel}.`;
}

async function summarizeArchitect(slug: string): Promise<string> {
  const out = await readArchitectOutput(slug);
  const lastTitle = out.phases.length > 0
    ? out.phases[out.phases.length - 1]?.title ?? "(unknown)"
    : "(none)";
  return `${out.phases.length} phase${out.phases.length === 1 ? "" : "s"}, ${out.productSpecs.length} product-spec${out.productSpecs.length === 1 ? "" : "s"}. Phase 0: scaffolding. Last phase: "${lastTitle}".`;
}

async function summarizeEmit(slug: string): Promise<string> {
  const paths = projectPaths(slug);
  if (!existsSync(paths.output)) return NOT_AVAILABLE;
  return `Output written to projects/${slug}/output/. Open AGENTS.md to start your coding agent.`;
}

async function summarizeImplement(slug: string): Promise<string> {
  const s = await readState(slug);
  const bp = s.buildProgress;
  if (!bp) return "Not started.";
  const idx = bp.lastPromptIndex;
  if (idx < 0) return "Setup checklist in progress.";
  return `Walked through ${idx + 1} prompt${idx + 1 === 1 ? "" : "s"} so far.`;
}

function topKindCounts(
  obs: Array<{ kind: string }>,
  n: number,
): string {
  const counts = new Map<string, number>();
  for (const o of obs) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
}
