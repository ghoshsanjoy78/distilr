import { runExplorer } from "../agents/explorer.js";
import { scanAreas, AppArea } from "../agents/area-scan.js";
import {
  readObservations,
  readState,
  writeState,
} from "../store/project.js";
import type { Bus } from "../tui/bus.js";

const MIN_AREAS_FOR_PICKER = 3;

export async function stageExplore(slug: string, bus: Bus): Promise<void> {
  const state = await readState(slug);
  if (state.skippedAuth) {
    bus.emit({
      kind: "info",
      text: "Login was skipped — no authenticated exploration. Synthesizer will work from public-recon observations only.",
    });
    return;
  }

  // Pick the focus areas (or load from state on resume)
  let focusAreas: string[] = state.selectedAreas ?? [];
  if (focusAreas.length === 0) {
    focusAreas = await pickFocusAreas(slug, state.saasName, bus);
    await writeState({ ...state, selectedAreas: focusAreas });
  } else {
    bus.emit({
      kind: "info",
      text: `Resuming with previously selected focus areas: ${focusAreas.join(", ")}`,
    });
  }

  const before = (await readObservations(slug)).length;
  bus.emit({
    kind: "info",
    text:
      focusAreas.length > 0
        ? `Explorer agent driving the authenticated session — focused on: ${focusAreas.join(", ")}`
        : "Explorer agent driving the authenticated session…",
  });
  await runExplorer(slug, state.saasName, bus, focusAreas);
  const after = (await readObservations(slug)).length;
  bus.emit({
    kind: "info",
    text: `Recorded ${after - before} new observations (${after} total).`,
  });
}

/**
 * Run the one-shot LLM scan, present the discovered areas, and let the
 * user multi-select. On any failure, fall back to "explore everything"
 * (return empty list — the explorer treats empty as no constraint).
 */
async function pickFocusAreas(
  slug: string,
  saasName: string,
  bus: Bus,
): Promise<string[]> {
  bus.emit({
    kind: "info",
    text: "Scanning the app for high-level feature areas…",
  });

  let areas: AppArea[] = [];
  try {
    areas = await scanAreas(slug, saasName);
  } catch (e) {
    bus.emit({
      kind: "warning",
      text: `Couldn't scan areas (${(e as Error).message}). Falling back to full exploration.`,
    });
    return [];
  }

  if (areas.length < MIN_AREAS_FOR_PICKER) {
    bus.emit({
      kind: "warning",
      text: `Only ${areas.length} areas found — skipping focus picker, exploring everything.`,
    });
    return [];
  }

  bus.emit({
    kind: "info",
    text: `Found ${areas.length} areas in ${saasName}.`,
  });

  // Sort core → supporting → optional so the most important options appear first.
  const order = { core: 0, supporting: 1, optional: 2 } as const;
  const sorted = [...areas].sort(
    (a, b) => order[a.importance] - order[b.importance],
  );

  const tagFor = (a: AppArea): string =>
    a.importance === "core" ? "[core]" : a.importance === "supporting" ? "[supp]" : "[opt]";

  const picked = await bus.askMultiSelect<string>(
    "Which areas should the agent explore in depth? (the others will be skipped)",
    sorted.map((a) => ({
      label: `${tagFor(a)} ${a.name} — ${a.description}`,
      value: a.name,
    })),
    { minSelected: 1 },
  );

  return picked;
}
