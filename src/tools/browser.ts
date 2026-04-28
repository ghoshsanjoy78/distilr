import { tool } from "ai";
import { z } from "zod";
import { activePage, screenshotPath } from "../browser/session.js";
import { basename } from "node:path";
import { getBus } from "../tui/bus.js";
import { safeTruncate, sanitizeForJson } from "../browser/sanitize.js";

const DESTRUCTIVE = /\b(delete|remove|cancel|unsubscribe|send|publish|pay|charge|billing|invite|destroy|drop|wipe|deactivate|close.{0,8}account|upgrade|subscribe)\b/i;

function looksDestructive(text: string): boolean {
  return DESTRUCTIVE.test(text);
}

/**
 * Build the browser tool surface for one project. The agent author picks
 * which subset to pass to streamText (e.g. recon doesn't need destructive
 * click; explorer does).
 */
export function buildBrowserTools(slug: string) {
  return {
    browser_navigate: tool({
      description:
        "Navigate the browser to a URL. Waits for the page to settle. Returns the loaded URL and title.",
      inputSchema: z.object({
        url: z.string().describe("Absolute URL to load"),
      }),
      execute: async ({ url }) => {
        const page = await activePage(slug);
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          const title = await page.title();
          return `Loaded ${url}\nTitle: ${title}`;
        } catch (e) {
          throw new Error(`navigate failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_current_url: tool({
      description: "Get the URL and title of the currently active page.",
      inputSchema: z.object({}),
      execute: async () => {
        const page = await activePage(slug);
        return `URL: ${page.url()}\nTitle: ${await page.title()}`;
      },
    }),

    browser_click: tool({
      description:
        "Click an element matching a CSS or text selector. Refuses if the element looks destructive (delete, send, pay, etc.) — use browser_click_destructive for those (with user confirmation).",
      inputSchema: z.object({
        selector: z
          .string()
          .describe("Playwright selector, e.g. 'text=Save' or 'button.primary'"),
      }),
      execute: async ({ selector }) => {
        const page = await activePage(slug);
        try {
          const locator = page.locator(selector).first();
          const text = (await locator.textContent({ timeout: 5000 })) ?? "";
          const aria =
            (await locator.getAttribute("aria-label").catch(() => null)) ?? "";
          const combined = `${text} ${aria}`.trim();
          if (looksDestructive(combined) || looksDestructive(selector)) {
            throw new Error(
              `Refused: element "${combined.slice(0, 60)}" looks destructive. Call browser_click_destructive(selector, reason) instead — the user will be asked to approve.`,
            );
          }
          await locator.click({ timeout: 8000 });
          await page
            .waitForLoadState("domcontentloaded", { timeout: 10000 })
            .catch(() => {});
          return `Clicked "${combined.slice(0, 80)}"`;
        } catch (e) {
          throw new Error(`click failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_click_destructive: tool({
      description:
        "Click an element that looks destructive. Prompts the user in the terminal for approval before clicking.",
      inputSchema: z.object({
        selector: z.string(),
        reason: z.string().describe("Why this click is needed (shown to the user)"),
      }),
      execute: async ({ selector, reason }) => {
        const page = await activePage(slug);
        try {
          const locator = page.locator(selector).first();
          const text = (await locator.textContent({ timeout: 5000 })) ?? "";
          const approved = await getBus().askConfirm(
            `Agent wants to click "${text.slice(0, 60)}" (${reason}). Allow?`,
            { default: false },
          );
          if (!approved) {
            throw new Error("User declined the destructive click");
          }
          await locator.click({ timeout: 8000 });
          return `Clicked (with user approval): ${text.slice(0, 80)}`;
        } catch (e) {
          throw new Error(`click_destructive failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_fill: tool({
      description:
        "Type text into an input or textarea. Refuses on payment/credentials inputs.",
      inputSchema: z.object({
        selector: z.string(),
        value: z.string(),
      }),
      execute: async ({ selector, value }) => {
        if (
          /password|cardnumber|card-number|cvv|cvc|ssn|tax-id/i.test(selector)
        ) {
          throw new Error(
            "Refused: this looks like a credentials/payment field. The agent must not fill those.",
          );
        }
        const page = await activePage(slug);
        try {
          await page.locator(selector).first().fill(value, { timeout: 8000 });
          return `Filled ${selector}`;
        } catch (e) {
          throw new Error(`fill failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_press_key: tool({
      description:
        "Press a keyboard key on the focused element (e.g. 'Enter', 'Tab', 'Escape').",
      inputSchema: z.object({ key: z.string() }),
      execute: async ({ key }) => {
        const page = await activePage(slug);
        try {
          await page.keyboard.press(key);
          return `Pressed ${key}`;
        } catch (e) {
          throw new Error(`press_key failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_get_a11y_tree: tool({
      description:
        "Get a YAML accessibility-tree snapshot of the current page (better than raw HTML for finding elements to interact with). Optionally scope to a selector.",
      inputSchema: z.object({
        selector: z
          .string()
          .optional()
          .describe("If set, snapshot only this part of the page"),
        maxChars: z.number().int().min(500).max(40000).default(8000),
      }),
      execute: async ({ selector, maxChars }) => {
        const page = await activePage(slug);
        try {
          const root = selector
            ? page.locator(selector).first()
            : page.locator("body");
          const yaml = await root.ariaSnapshot({ timeout: 5000 });
          if (yaml.length > maxChars) {
            return (
              safeTruncate(yaml, maxChars) +
              `\n... (truncated, full size ${yaml.length} chars)`
            );
          }
          return sanitizeForJson(yaml);
        } catch (e) {
          throw new Error(`get_a11y_tree failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_get_text: tool({
      description:
        "Get the visible text of the current page or a specific selector.",
      inputSchema: z.object({
        selector: z.string().optional(),
        maxChars: z.number().int().min(200).max(20000).default(4000),
      }),
      execute: async ({ selector, maxChars }) => {
        const page = await activePage(slug);
        try {
          const text = selector
            ? (await page.locator(selector).first().textContent()) ?? ""
            : await page.evaluate(() => document.body.innerText);
          if (text.length > maxChars) {
            return (
              safeTruncate(text, maxChars) +
              `\n... (+${text.length - maxChars} chars)`
            );
          }
          return sanitizeForJson(text);
        } catch (e) {
          throw new Error(`get_text failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_list_links: tool({
      description:
        "List up to N visible links on the current page with their hrefs and visible text.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ limit }) => {
        const page = await activePage(slug);
        try {
          const links = await page.evaluate((lim: number) => {
            const out: { text: string; href: string }[] = [];
            const anchors = Array.from(document.querySelectorAll("a"));
            for (const a of anchors) {
              if (out.length >= lim) break;
              const text = (a.textContent ?? "").trim();
              const href = a.getAttribute("href") ?? "";
              if (text && href) out.push({ text: text.slice(0, 80), href });
            }
            return out;
          }, limit);
          // Sanitize each field individually — link text and hrefs
          // can carry emoji/extended-plane chars that make raw JSON
          // unsafe to forward to the model.
          const safe = links.map((l) => ({
            text: safeTruncate(l.text, 80),
            href: sanitizeForJson(l.href),
          }));
          return JSON.stringify(safe, null, 2);
        } catch (e) {
          throw new Error(`list_links failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_screenshot: tool({
      description:
        "Take a full-page screenshot. Returns the screenshot id (filename) for later reference.",
      inputSchema: z.object({
        label: z.string().describe("Short label, e.g. 'pricing-page'"),
      }),
      execute: async ({ label }) => {
        const page = await activePage(slug);
        try {
          const path = screenshotPath(slug, label);
          await page.screenshot({ path, fullPage: true });
          return `screenshotId: ${basename(path)}`;
        } catch (e) {
          throw new Error(`screenshot failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_wait: tool({
      description:
        "Wait N milliseconds (max 5000). Use sparingly — prefer browser_wait_for_selector.",
      inputSchema: z.object({ ms: z.number().int().min(50).max(5000) }),
      execute: async ({ ms }) => {
        await new Promise((r) => setTimeout(r, ms));
        return `waited ${ms}ms`;
      },
    }),

    browser_wait_for_selector: tool({
      description:
        "Wait for a selector to appear on the page (max 10s).",
      inputSchema: z.object({
        selector: z.string(),
        timeoutMs: z.number().int().min(100).max(10000).default(5000),
      }),
      execute: async ({ selector, timeoutMs }) => {
        const page = await activePage(slug);
        try {
          await page.waitForSelector(selector, { timeout: timeoutMs });
          return `selector appeared: ${selector}`;
        } catch (e) {
          throw new Error(`wait_for_selector failed: ${(e as Error).message}`);
        }
      },
    }),

    browser_go_back: tool({
      description: "Navigate back in browser history.",
      inputSchema: z.object({}),
      execute: async () => {
        const page = await activePage(slug);
        try {
          await page.goBack({
            waitUntil: "domcontentloaded",
            timeout: 10000,
          });
          return `back to ${page.url()}`;
        } catch (e) {
          throw new Error(`go_back failed: ${(e as Error).message}`);
        }
      },
    }),
  };
}
