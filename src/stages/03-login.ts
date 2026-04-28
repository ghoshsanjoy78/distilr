import { openSession, activePage } from "../browser/session.js";
import { readState, writeState } from "../store/project.js";
import { verifyLoggedIn } from "../agents/login-check.js";
import type { Bus } from "../tui/bus.js";

type LoginChoice = "ready" | "more-time" | "skip" | "trust-me";

export async function stageLogin(slug: string, bus: Bus): Promise<void> {
  const state = await readState(slug);
  await ensureBrowserOpen(slug, bus);

  bus.emit({ kind: "info", text: `A browser window is open. Please:` });
  bus.emit({
    kind: "info",
    text: `  1. Sign up or log in to ${state.saasName}.`,
  });
  bus.emit({
    kind: "info",
    text: `  2. Make it past any onboarding so you're inside the app.`,
  });
  bus.emit({
    kind: "info",
    text: `  3. Come back here and choose what to do next.`,
  });

  let failedVerifications = 0;

  while (true) {
    // Build the option list. After a failed auto-verify, surface an
    // explicit "trust me" so the user isn't stuck looping when the
    // model is wrong about their login state.
    const options: { label: string; value: LoginChoice }[] = [
      {
        label: "I'm logged in and inside the app — continue",
        value: "ready",
      },
      {
        label:
          "I need more time — let me keep working in the browser, then ask again",
        value: "more-time",
      },
      {
        label:
          "Skip login — analyze public pages only (no in-app exploration)",
        value: "skip",
      },
    ];
    if (failedVerifications > 0) {
      options.splice(1, 0, {
        label: `Trust me — I'm logged in, skip the auto-check (verifier wrong ${failedVerifications}× already)`,
        value: "trust-me",
      });
    }

    const choice = await bus.askSelect<LoginChoice>(
      "Where are you?",
      options,
    );

    if (choice === "skip") {
      const updated = { ...state, skippedAuth: true };
      await writeState(updated);
      bus.emit({
        kind: "warning",
        text: "Skipping authenticated exploration. Only public-recon observations will be used downstream.",
      });
      return;
    }

    if (choice === "more-time") {
      // Make sure the browser is still around — if the user closed it
      // accidentally, re-open silently so they can keep working.
      await ensureBrowserOpen(slug, bus);
      bus.emit({
        kind: "info",
        text: "OK — finish in the browser, then I'll ask again.",
      });
      continue;
    }

    if (choice === "trust-me") {
      // User explicitly bypassed verification. Stage 4 will use whatever
      // tabs are open in the browser as the "logged in" surface.
      await ensureBrowserOpen(slug, bus);
      bus.emit({
        kind: "info",
        text:
          "Continuing without auto-verification. Stage 4 will explore whatever's currently open in the browser.",
      });
      return;
    }

    // choice === "ready" → run the LLM verifier
    await ensureBrowserOpen(slug, bus); // user might have closed Chromium
    bus.emit({ kind: "info", text: "Checking that you're signed in…" });
    try {
      const { loggedIn, reason } = await verifyLoggedIn(
        slug,
        state.saasName,
        state.saasUrl,
      );
      if (loggedIn) {
        bus.emit({ kind: "info", text: `Confirmed: ${reason}` });
        try {
          const page = await activePage(slug);
          bus.emit({ kind: "info", text: `Continuing from: ${page.url()}` });
        } catch {
          /* page might have been closed; not fatal */
        }
        return;
      }
      failedVerifications++;
      bus.emit({
        kind: "warning",
        text: `Auto-verifier says you're not logged in: ${reason}`,
      });
      bus.emit({
        kind: "info",
        text:
          failedVerifications === 1
            ? "If you ARE logged in, the next prompt will offer a 'Trust me' option to bypass the check."
            : "Bypass option is available in the prompt below.",
      });
      // loop back to the select prompt
    } catch (e) {
      // Verification itself failed — don't block the user.
      bus.emit({
        kind: "warning",
        text: `Couldn't auto-verify (${(e as Error).message}). Trusting your answer and continuing.`,
      });
      return;
    }
  }
}

/**
 * Idempotent: if the persistent context is already alive, no-op. If
 * the user closed Chromium, openSession() spins up a fresh one
 * (cookies persist via the user-data-dir, so they stay logged in).
 */
async function ensureBrowserOpen(slug: string, bus: Bus): Promise<void> {
  try {
    const session = await openSession(slug);
    try {
      // Bring the most recent visible page to the front so the user
      // sees something useful when they switch back.
      const pages = session.context.pages().filter((p) => !p.isClosed());
      const page = pages[pages.length - 1];
      if (page) await page.bringToFront();
    } catch {
      /* best-effort */
    }
  } catch (e) {
    bus.emit({
      kind: "warning",
      text: `Couldn't (re)open the browser: ${(e as Error).message}. You can still 'Skip login' to continue.`,
    });
  }
}
