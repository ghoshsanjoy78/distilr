// Quick LLM-backed sanity check that the user is actually signed into the
// target SaaS before we let stage 04 spin up the heavy exploration agent.
//
// Strategy:
//   1. Find the right tab (the one whose URL host matches the source
//      SaaS — the user may have opened multiple tabs).
//   2. Hand the model the URL + page title + a small accessibility-tree
//      snapshot and ask: "Is this user signed in?"
//
// Earlier versions short-circuited to "not logged in" on URL patterns
// (`/auth`, `/about`, `/blog`, etc.) but those tripped on perfectly
// legitimate authenticated paths inside many apps (e.g. `/auth/callback`
// after OAuth, `/about` linked from the dashboard nav). Rather than
// guess from URLs, we always look at the actual page content. The LLM
// is fast and the tree is small.
//
// On any failure (network, model error, structured-output parse), fall
// back to trusting the user's confirmation rather than blocking them.

import { generateObject } from "ai";
import { z } from "zod";
import { getOrOpen } from "../browser/session.js";
import { getModel } from "../providers.js";
import { safeTruncate } from "../browser/sanitize.js";
import type { Page } from "playwright";

const LoggedInDecisionSchema = z.object({
  loggedIn: z
    .boolean()
    .describe(
      "True if the user is signed into the app, false if on login/signup/landing page",
    ),
  reason: z
    .string()
    .describe(
      "One short sentence explaining what indicates logged-in or logged-out",
    ),
});

export interface LoginCheckResult {
  loggedIn: boolean;
  reason: string;
}

export async function verifyLoggedIn(
  slug: string,
  saasName: string,
  saasUrl: string,
): Promise<LoginCheckResult> {
  const page = await pickBestPage(slug, saasUrl);
  const url = page.url();
  const title = await page.title().catch(() => "");

  let tree = "";
  try {
    tree = await page.locator("body").ariaSnapshot({ timeout: 5000 });
  } catch {
    // ignore — empty tree is fine, we'll still call the model with what we have
  }
  const trimmed =
    tree.length > 3500
      ? safeTruncate(tree, 3500) + "\n…(truncated)"
      : safeTruncate(tree, 3500);

  const result = await generateObject({
    model: getModel(),
    schema: LoggedInDecisionSchema,
    prompt: `You are checking whether a user has signed into "${saasName}" in their browser.

URL: ${url}
Title: ${title}

Page accessibility tree (truncated):
\`\`\`
${trimmed}
\`\`\`

Indicators of LOGGED IN: user avatar/menu, dashboard navigation, "log out" link, app-specific data, settings/account menus, an authenticated workspace/team picker, recently created items.

Indicators of NOT LOGGED IN: prominent "Log in" or "Sign up" buttons as primary CTAs, marketing copy ("get started", "start your trial"), login forms, "welcome" landing page with no app data.

Be liberal with "logged in" — if the page clearly shows app surface (any dashboard / list / settings UI) with no login form, that's logged in. URLs like /auth/callback, /about (inside the dashboard), /pricing (linked from the nav) do NOT mean logged out — judge by the page content, not the path.

Decide.`,
  });
  return result.object;
}

/**
 * Among the open tabs, pick the one most likely to be the SaaS the
 * user just logged into. Strategy:
 *   1. If a tab's hostname matches (or is a subdomain of) the SaaS's
 *      hostname, pick that.
 *   2. Otherwise, pick the most-recently-created non-closed page (the
 *      last entry in context.pages() is usually the most recent).
 *   3. If no pages are open at all, create a fresh one (rare — happens
 *      if Chromium was closed and re-opened).
 */
async function pickBestPage(slug: string, saasUrl: string): Promise<Page> {
  const session = await getOrOpen(slug);
  const open = session.context.pages().filter((p) => !p.isClosed());
  if (open.length === 0) return await session.context.newPage();

  let saasHost = "";
  try {
    saasHost = new URL(saasUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    /* malformed saasUrl — skip the host match */
  }

  if (saasHost) {
    const match = open.find((p) => {
      try {
        const h = new URL(p.url()).hostname.toLowerCase().replace(/^www\./, "");
        return h === saasHost || h.endsWith("." + saasHost) || saasHost.endsWith("." + h);
      } catch {
        return false;
      }
    });
    if (match) return match;
  }

  // Fall back: most recently opened tab.
  return open[open.length - 1] ?? open[0]!;
}
