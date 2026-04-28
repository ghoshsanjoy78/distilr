import { streamText, stepCountIs } from "ai";
import { buildBrowserTools } from "../tools/browser.js";
import { buildNotesTools } from "../tools/notes.js";
import { buildAskUserTools } from "../tools/ask-user.js";
import { getOrOpen } from "../browser/session.js";
import { getModel } from "../providers.js";
import { runAgent } from "./run.js";
import { PROMPT_GUIDELINES } from "./guidelines.js";
import { TERSE_NARRATION } from "./terse-instruction.js";
import type { Bus } from "../tui/bus.js";

export async function runExplorer(
  slug: string,
  saasName: string,
  bus: Bus,
  focusAreas: string[] = [],
): Promise<void> {
  await getOrOpen(slug);

  const browser = buildBrowserTools(slug);
  const notes = buildNotesTools(slug);
  const askUser = buildAskUserTools();
  const aiSdkTools = { ...browser, ...notes, ...askUser };

  const focusBlock =
    focusAreas.length > 0
      ? `\n\nIMPORTANT — FOCUS AREAS\nThe user has chosen to explore ONLY these areas:\n${focusAreas.map((a) => `  - ${a}`).join("\n")}\nDo NOT spend tool calls on other sections of the app. If the navigation has links outside this list, ignore them. If you're unsure whether a section maps to one of the focus areas, call ask_user.\n`
      : "";

  const system = `You are an in-app exploration agent. The user has manually signed in to "${saasName}". Your job: systematically navigate the authenticated app, identify features, capture screenshots, and record observations.${focusBlock}

Approach:
1. Start by getting an overview: current URL, the top nav and side nav (use browser_list_links and browser_get_a11y_tree).
2. Visit each major section once. For each section, capture:
   - The section's purpose (notes_append kind=feature)
   - Any tables/lists visible (kind=data-model — these reveal entities)
   - Any forms (kind=form — these reveal entity fields)
   - The primary CTAs / actions (kind=cta)
   - Notable UX patterns (kind=ui-pattern)
3. Take a screenshot of each section (browser_screenshot with a meaningful label).

CREATION / IMPORT / UPLOAD FLOWS — handle these specifically:

  Many SaaS apps gate their richest features behind a "Create X / Import Y / Add Z / New chatbot / Connect data" flow that needs REAL user data to do anything useful — a website URL to scrape, a CSV to import, a file to upload, an API key from a third-party, a real email to invite.

  DO NOT try to push through these with fake data. Filling a form with "test@example.com" and clicking Continue rarely produces a meaningful next-page; you'll get an error or land on a half-broken state and learn nothing.

  Instead, for ANY creation / import / upload / connect flow:
    1. Observe the form structure: what fields exist, what types, what validation hints. notes_append kind=form for the field list, kind=feature for the overall flow.
    2. Take ONE screenshot of the form (browser_screenshot).
    3. THEN call ask_user with options:
         - "Skip — observed the form structure, that's enough"
         - "I'll provide real data so you can see what's past this form"
         (and maybe a third option "Continue with placeholder data anyway" if you genuinely think the form might accept anything)
       Phrase the question concretely, e.g.:
         "I'm at the 'Create new agent' flow which needs a website URL to scrape. Skip and observe just the form, or do you want to provide a URL so I can see the agent-setup pages past this?"
    4. If the user picks Skip, move on. Don't keep poking at the form.
    5. If they provide data, paste it via browser_fill, then continue.

WHEN ELSE TO CALL ask_user — be liberal with this, the user is at the keyboard and would rather help once than watch you spin.

  • DIRECTION: when you genuinely don't know which section is worth exploring next, or what an ambiguous UI element means.

  • BLOCKERS — call ask_user immediately when you hit any of these. Don't retry, don't give up — ask. Examples:
      - A file picker / upload dialog opens (the OS native picker; you can't drive it via tools). Ask the user to pick a file, then reply when ready.
      - A CAPTCHA, hCaptcha, Cloudflare turnstile, or "I'm not a robot" check.
      - A two-factor / verification code prompt (SMS, email, authenticator app).
      - An OAuth consent screen on a third-party domain you can't reason about.
      - A Stripe / payment / billing dialog. Never fill these — ask the user to either skip the flow or do it manually if they really want to.
      - The page is stuck loading, hung on a spinner, or behind an interstitial that won't dismiss.
      - You've tried the same action 2-3 times and it isn't producing the expected result.
      - You've made 3+ tool calls in the same area without recording new observations — you're spinning. Ask the user where to go next.

  Give the user a one-sentence instruction (e.g. "Please complete the captcha on the current page and reply continue when done"). They'll handle it in the browser and tell you when to proceed.

CRITICAL SAFETY RULES — violations will be blocked:
- Do NOT click anything that looks destructive (delete, send, publish, pay, charge, billing, invite, cancel). The browser_click tool will refuse these. If you genuinely need to click such a thing for exploration, use browser_click_destructive — the user will be asked to approve.
- Do NOT enter any payment information.
- Do NOT change account settings, invite users, or modify billing.
- Do NOT submit forms in a way that creates real customer-facing artifacts (e.g. don't actually send an email to a real address). It IS fine to fill in a form with obviously-fake data and observe what fields exist, but DO NOT submit.

Stop when you've recorded ~30-50 observations covering the major sections, or when you've visited every section in the main nav once. Quality over quantity.

${PROMPT_GUIDELINES}

${TERSE_NARRATION}`;

  const basePrompt = `Begin exploration of the authenticated ${saasName} app. The browser is already open and signed in.`;
  const STEP_BUDGET = 200;

  let appendedGuidance = "";

  while (true) {
    const controller = new AbortController();
    bus.setAbortController(controller);

    const stats = bus.getState().stats;
    const userPrompt = appendedGuidance
      ? `${basePrompt}

--- Mid-run guidance from the user ---
${appendedGuidance}

Progress so far: ${stats.pages} page${stats.pages === 1 ? "" : "s"} visited, ${stats.observations} observation${stats.observations === 1 ? "" : "s"} recorded. Avoid re-visiting sections you've already covered — focus on the user's guidance above.`
      : basePrompt;

    // messages-array form so the system prompt can be marked with
    // Anthropic's cacheControl. Recon and explorer make many turns
    // (200-step budget here) — the system + tool defs prelude is
    // huge and reused on every turn, so caching it is the single
    // biggest input-cost win available. Other providers ignore the
    // anthropic providerOptions; safe to keep unconditionally.
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
    await runAgent(result, "explorer", bus);

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
