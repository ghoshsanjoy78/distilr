import { runSynthesizer } from "../agents/synthesizer.js";
import { readCatalog, readState } from "../store/project.js";
import type { Bus } from "../tui/bus.js";

export async function stageSynthesize(slug: string, bus: Bus): Promise<void> {
  const state = await readState(slug);
  bus.emit({
    kind: "info",
    text: "Synthesizing observations into a feature catalog…",
  });
  await runSynthesizer(slug, state.saasName, bus);
  const catalog = await readCatalog(slug);
  const total = catalog.categories.reduce((s, c) => s + c.features.length, 0);
  bus.emit({
    kind: "info",
    text: `Catalog: ${catalog.categories.length} categories, ${total} features.`,
  });
}
