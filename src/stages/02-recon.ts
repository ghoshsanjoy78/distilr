import { runRecon } from "../agents/recon.js";
import { readObservations, readState } from "../store/project.js";
import type { Bus } from "../tui/bus.js";

const MIN_OBSERVATIONS_TO_PROCEED = 5;

export async function stageRecon(slug: string, bus: Bus): Promise<void> {
  const state = await readState(slug);
  bus.emit({
    kind: "info",
    text: `Recon agent exploring ${state.saasUrl} (public pages only)`,
  });
  await runRecon(slug, state.saasName, state.saasUrl, bus);
  const obs = await readObservations(slug);
  const pages = bus.getState().stats.pages;
  bus.emit({
    kind: "info",
    text: `Recorded ${obs.length} observation${obs.length === 1 ? "" : "s"}.`,
  });
  if (obs.length < MIN_OBSERVATIONS_TO_PROCEED) {
    throw new Error(
      `Only ${obs.length} observations recorded — too few to proceed. The agent likely got blocked. Try resuming, or pick a less bot-protected target.`,
    );
  }
  // Soft "this looks big" nudge — high observation / page counts usually
  // mean a sprawling product where distilr will produce shallow output.
  // Doesn't block; just warns + points at the area picker as the next
  // narrowing opportunity.
  if (obs.length > 50 || pages > 15) {
    bus.emit({
      kind: "warning",
      text: `This looks like a large product (${obs.length} observations across ${pages} pages). distilr works best when focused — use the area picker in the next stages to narrow.`,
    });
  }
}
