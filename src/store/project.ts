import { mkdir, readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { homedir, platform } from "node:os";
import {
  ProjectState,
  ProjectStateSchema,
  Observation,
  ObservationSchema,
  Stage,
  STAGES,
  FeatureCatalog,
  FeatureCatalogSchema,
  ProductSpec,
  ProductSpecSchema,
  ArchitectOutput,
  ArchitectOutputSchema,
} from "./schemas.js";

// Anchor PROJECTS_ROOT to the distilr package root so it always lives
// inside distilr/projects/ regardless of the user's cwd. This file is
// compiled to dist/store/project.js, so ../../ reaches the package root.
const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(HERE, "..", "..");
export const PROJECTS_ROOT = join(PACKAGE_ROOT, "projects");

/**
 * Where Chromium's persistent user-data-dir (cookies / localStorage /
 * cache) lives. Platform-conventional cache locations — kept OUT of
 * the project dir so the spec artifacts stay clean and the browser
 * cache doesn't get tar'd up if the user shares a project folder.
 *
 * Honors DISTILR_CACHE_DIR if set (mostly for tests / power users).
 */
function distilrCacheRoot(): string {
  if (process.env.DISTILR_CACHE_DIR) return process.env.DISTILR_CACHE_DIR;
  const home = homedir();
  if (platform() === "darwin") {
    return join(home, "Library", "Caches", "distilr");
  }
  if (platform() === "win32") {
    const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return join(local, "distilr", "Cache");
  }
  // Linux + others: XDG cache dir
  const xdg = process.env.XDG_CACHE_HOME || join(home, ".cache");
  return join(xdg, "distilr");
}

export async function ensureProjectsRoot(): Promise<void> {
  await mkdir(PROJECTS_ROOT, { recursive: true });
}

export function projectDir(slug: string): string {
  return join(PROJECTS_ROOT, slug);
}

export function projectPaths(slug: string) {
  const root = projectDir(slug);
  return {
    root,
    stateFile: join(root, "state.json"),
    observationsFile: join(root, "observations.jsonl"),
    screenshotsDir: join(root, "screenshots"),
    // network.har was previously recorded by Playwright but disabled —
    // it leaked memory on long runs (every request buffered until close).
    // Path retained only for backward compatibility with older state files.
    networkHar: join(root, "network.har"),
    catalogFile: join(root, "feature-catalog.json"),
    specFile: join(root, "spec.json"),
    /**
     * Chromium user-data-dir. Lives in the OS cache location, NOT
     * inside the project tree — keeps the spec artifacts clean and
     * means sharing a project dir doesn't leak cached source-SaaS
     * assets / session cookies.
     */
    browserDataDir: join(distilrCacheRoot(), slug, "browser-data"),
    output: join(root, "output"),
    outputPhasesDir: join(root, "output", "phases"),
    runLog: join(root, "run.log"),
  };
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function initProject(
  slug: string,
  saasName: string,
  saasUrl: string,
): Promise<ProjectState> {
  const paths = projectPaths(slug);
  await mkdir(paths.root, { recursive: true });
  await mkdir(paths.screenshotsDir, { recursive: true });
  await mkdir(paths.browserDataDir, { recursive: true });
  const state: ProjectState = {
    slug,
    saasName,
    saasUrl,
    createdAt: new Date().toISOString(),
    lastCompletedStage: "none",
    skippedAuth: false,
  };
  await writeState(state);
  return state;
}

export async function readState(slug: string): Promise<ProjectState> {
  const paths = projectPaths(slug);
  const raw = await readFile(paths.stateFile, "utf8");
  return ProjectStateSchema.parse(JSON.parse(raw));
}

export async function writeState(state: ProjectState): Promise<void> {
  const paths = projectPaths(state.slug);
  await writeFile(paths.stateFile, JSON.stringify(state, null, 2), "utf8");
}

export async function markStageComplete(
  slug: string,
  stage: Stage,
): Promise<void> {
  const state = await readState(slug);
  state.lastCompletedStage = stage;
  await writeState(state);
}

export function nextStage(state: ProjectState): Stage | null {
  const last = state.lastCompletedStage;
  if (last === "none") return STAGES[0];
  const idx = STAGES.indexOf(last);
  if (idx === -1 || idx === STAGES.length - 1) return null;
  return STAGES[idx + 1];
}

export async function listProjects(): Promise<string[]> {
  if (!existsSync(PROJECTS_ROOT)) return [];
  const entries = await readdir(PROJECTS_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

export interface ProjectSummary {
  slug: string;
  saasName: string;
  saasUrl: string;
  lastCompletedStage: Stage | "none";
  createdAt: string;
}

/**
 * Read state.json from every project directory under projects/. Returns
 * summaries sorted most-recent-first. Skips projects whose state.json is
 * missing or unreadable.
 */
export async function readAllProjectSummaries(): Promise<ProjectSummary[]> {
  const slugs = await listProjects();
  const summaries: ProjectSummary[] = [];
  for (const slug of slugs) {
    try {
      const state = await readState(slug);
      summaries.push({
        slug: state.slug,
        saasName: state.saasName,
        saasUrl: state.saasUrl,
        lastCompletedStage: state.lastCompletedStage,
        createdAt: state.createdAt,
      });
    } catch {
      // ignore unreadable projects
    }
  }
  summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return summaries;
}

/**
 * Projects that haven't completed the FULL pipeline (through stage 9).
 * A project that finished stage 8 (emit) but hasn't walked the build
 * deck yet still counts as in-progress — the user can resume into the
 * stage 9 prompt walk-through.
 */
export async function findUnfinishedProjects(): Promise<ProjectSummary[]> {
  const all = await readAllProjectSummaries();
  return all.filter((p) => p.lastCompletedStage !== "implement");
}

export async function appendObservation(
  slug: string,
  obs: Omit<Observation, "id" | "ts">,
): Promise<Observation> {
  const paths = projectPaths(slug);
  const full: Observation = ObservationSchema.parse({
    ...obs,
    id: randomUUID(),
    ts: new Date().toISOString(),
  });
  await appendFile(paths.observationsFile, JSON.stringify(full) + "\n", "utf8");
  return full;
}

export async function readObservations(slug: string): Promise<Observation[]> {
  const paths = projectPaths(slug);
  if (!existsSync(paths.observationsFile)) return [];
  const raw = await readFile(paths.observationsFile, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => ObservationSchema.parse(JSON.parse(line)));
}

export async function searchObservations(
  slug: string,
  query: string,
  limit = 20,
): Promise<Observation[]> {
  const all = await readObservations(slug);
  const q = query.toLowerCase();
  const matches = all.filter((o) =>
    [o.summary, o.page ?? "", o.url ?? "", o.kind, ...o.evidence]
      .join(" ")
      .toLowerCase()
      .includes(q),
  );
  return matches.slice(0, limit);
}

export async function writeCatalog(
  slug: string,
  catalog: FeatureCatalog,
): Promise<void> {
  const paths = projectPaths(slug);
  await writeFile(paths.catalogFile, JSON.stringify(catalog, null, 2), "utf8");
}

export async function readCatalog(slug: string): Promise<FeatureCatalog> {
  const paths = projectPaths(slug);
  const raw = await readFile(paths.catalogFile, "utf8");
  return FeatureCatalogSchema.parse(JSON.parse(raw));
}

export async function writeSpec(slug: string, spec: ProductSpec): Promise<void> {
  const paths = projectPaths(slug);
  await writeFile(paths.specFile, JSON.stringify(spec, null, 2), "utf8");
}

export async function readSpec(slug: string): Promise<ProductSpec> {
  const paths = projectPaths(slug);
  const raw = await readFile(paths.specFile, "utf8");
  return ProductSpecSchema.parse(JSON.parse(raw));
}

/**
 * Read the architect's output JSON. Filename is hard-coded to match
 * `ARCHITECT_OUTPUT_FILENAME` in `src/agents/architect.ts`. Throws if
 * the file isn't there yet (i.e. architect stage hasn't run).
 */
export async function readArchitectOutput(slug: string): Promise<ArchitectOutput> {
  const paths = projectPaths(slug);
  const raw = await readFile(join(paths.root, "architect-output.json"), "utf8");
  return ArchitectOutputSchema.parse(JSON.parse(raw));
}
