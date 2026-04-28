import { runArchitect } from "../agents/architect.js";
import type { Bus } from "../tui/bus.js";

export async function stageArchitect(slug: string, bus: Bus): Promise<void> {
  bus.emit({
    kind: "info",
    text: "Architect agent designing system + phased build plan…",
  });
  await runArchitect(slug, bus);
  bus.emit({ kind: "info", text: "Architecture and phases generated." });
}
