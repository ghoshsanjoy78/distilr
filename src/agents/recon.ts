import { streamText, stepCountIs } from "ai";
import { buildBrowserTools } from "../tools/browser.js";
import { buildNotesTools } from "../tools/notes.js";
import { openSession } from "../browser/session.js";
import { getModel } from "../providers.js";
import { runAgent } from "./run.js";
import { pickTools } from "./tool-selection.js";
import { PROMPT_GUIDELINES } from "./guidelines.js";
import { TERSE_NARRATION } from "./terse-instruction.js";
import type { Bus } from "../tui/bus.js";

export async function runRecon(
  slug: string,
  saasName: string,
  saasUrl: string,
  bus: Bus,
): Promise<void> {
  await openSession(slug);
  const browserAll = buildBrowserTools(slug);
  const notesAll = buildNotesTools(slug);

  // Recon-specific subset — read-only browser ops + notes. No
  // click_destructive, fill, press_key, wait, ask_user.
  const browser = pickTools(browserAll, [
    "browser_navigate",
    "browser_current_url",
    "browser_click",
    "browser_get_a11y_tree",
    "browser_get_text",
    "browser_list_links",
    "browser_screenshot",
    "browser_wait_for_selector",
    "browser_go_back",
  ]);
  const notes = pickTools(notesAll, [
    "notes_append",
    "notes_search",
    "notes_count",
  ]);
  const aiSdkTools = { ...browser, ...notes };

  const system = `You are a public-website recon agent. Your job: explore the public marketing surface of "${saasName}" (${saasUrl}) efficiently and record observations.

Approach:
1. Start at the homepage. Call browser_list_links to find nav.
2. Visit each major nav destination ONCE: pricing, features (or product), integrations, docs/help, customers, /about. Skip /blog, careers, legal — they don't help.
3. After loading each page, do ONE pass: get_text to read it, then add 1-3 notes_append calls SUMMARIZING what that page reveals. Do NOT add a separate observation for every paragraph or feature bullet — group related things together.
4. Take ONE screenshot per major page (browser_screenshot).
5. Stop after ~10 page visits OR ~25 observations, whichever comes first.

Efficiency rules:
- Be parsimonious with tool calls. Each tool call costs a step; you have a limited budget.
- Prefer get_text over get_a11y_tree on marketing pages (text is enough; you don't need to click anything).
- Don't re-visit pages you've already seen. Use notes_count occasionally to track progress.
- When you've covered the obvious surface, STOP — don't pad.

Hard rules:
- Do NOT log in or click Sign up / Start trial / Get started CTAs that lead to signup. Stay on public pages.
- Do NOT submit forms.

Observation kinds: feature, pricing, integration, data-model, ui-pattern, navigation, form, table, cta, doc, other.

${PROMPT_GUIDELINES}

${TERSE_NARRATION}`;

  const basePrompt = `Begin recon on ${saasName} at ${saasUrl}.`;
  const STEP_BUDGET = 80;

  let appendedGuidance = "";

  while (true) {
    const controller = new AbortController();
    bus.setAbortController(controller);

    const stats = bus.getState().stats;
    const userPrompt = appendedGuidance
      ? `${basePrompt}

--- Mid-run guidance from the user ---
${appendedGuidance}

Progress so far: ${stats.pages} page${stats.pages === 1 ? "" : "s"} visited, ${stats.observations} observation${stats.observations === 1 ? "" : "s"} recorded. Avoid re-visiting pages you've already covered — focus on the user's guidance above.`
      : basePrompt;

    // Convert to messages array (instead of `system: string`) so we
    // can mark the system block with Anthropic's cacheControl. Saves
    // 80%+ of input cost on the system + tools prelude across the
    // many turns this agent makes (recon's step budget is 80 turns).
    // Other providers ignore providerOptions.anthropic — safe to keep
    // unconditionally.
    const result = streamText({
      model: getModel(),
      messages: [
        {
          role: "system",
          content: system,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        { role: "user", content: userPrompt },
      ],
      tools: aiSdkTools,
      stopWhen: stepCountIs(STEP_BUDGET),
      abortSignal: controller.signal,
    });
    await runAgent(result, "recon", bus);

    bus.setAbortController(null);

    const intent = bus.takeInterruptIntent();
    if (!intent) break;
    if (intent === "exit") {
      bus.emit({
        kind: "info",
        text: "Stopped — using observations recorded so far.",
      });
      break;
    }
    appendedGuidance = appendedGuidance
      ? `${appendedGuidance}\n\n${intent.text}`
      : intent.text;
    bus.emit({
      kind: "info",
      text: `Restarting with: "${intent.text.slice(0, 100)}${intent.text.length > 100 ? "…" : ""}"`,
    });
  }
}
