// One-shot LLM call that scans the authenticated app's landing page and
// extracts the high-level feature areas a user might want to include in their build.
// Used by stage 04 to gate the deep-exploration agent on only the areas
// the user explicitly selects.
//
// Uses generateObject (single call, structured output) rather than a
// full agent loop — this is purely descriptive, no tool use needed.

import { generateObject } from "ai";
import { z } from "zod";
import { activePage } from "../browser/session.js";
import { getModel } from "../providers.js";
import { safeTruncate, sanitizeForJson } from "../browser/sanitize.js";

// Schemas kept loose — provider structured-output validators (notably
// Gemini) reject array minItems > 1 and string length constraints.
// We communicate sizing via .describe() and validate after the call.
export const AppAreaSchema = z.object({
  name: z
    .string()
    .describe("Short human-readable name, e.g. 'Campaigns', 'Contacts', 'Settings'"),
  description: z
    .string()
    .describe("One-sentence description of what this area does"),
  importance: z
    .enum(["core", "supporting", "optional"])
    .describe(
      "core = the product's main purpose; supporting = useful adjuncts; optional = admin/settings/peripheral",
    ),
});
export type AppArea = z.infer<typeof AppAreaSchema>;

const ScanResultSchema = z.object({
  areas: z
    .array(AppAreaSchema)
    .describe("Major feature areas of the app — aim for 5-12"),
});

interface PageLink {
  text: string;
  href: string;
}

export async function scanAreas(
  slug: string,
  saasName: string,
): Promise<AppArea[]> {
  const page = await activePage(slug);
  const url = page.url();
  const title = await page.title().catch(() => "");

  let tree = "";
  try {
    tree = await page.locator("body").ariaSnapshot({ timeout: 5000 });
  } catch {
    /* ok — we'll send what we have */
  }
  const trimmedTree =
    tree.length > 4000
      ? safeTruncate(tree, 4000) + "\n…(truncated)"
      : sanitizeForJson(tree);

  let links: PageLink[] = [];
  try {
    links = await page.evaluate(() => {
      const out: { text: string; href: string }[] = [];
      const anchors = Array.from(document.querySelectorAll("a"));
      for (const a of anchors) {
        if (out.length >= 80) break;
        const text = (a.textContent ?? "").trim();
        const href = a.getAttribute("href") ?? "";
        if (text && href) out.push({ text: text.slice(0, 60), href });
      }
      return out;
    });
  } catch {
    /* ok */
  }
  const linksText = safeTruncate(
    links.map((l) => `- "${l.text}" → ${l.href}`).join("\n"),
    3000,
  );

  const prompt = `You are looking at the authenticated dashboard of "${saasName}". Identify the major FEATURE AREAS — the top-level things a user does in this product.

URL: ${url}
Title: ${title}

Visible navigation links:
${linksText || "(none captured)"}

Page accessibility snapshot (truncated):
\`\`\`
${trimmedTree}
\`\`\`

Rules:
- Aim for 5–12 areas. Group sub-pages under their natural parent (e.g. "Account / Billing / Profile" → one area called "Account & Settings").
- Each area is something a user-facing feature; skip pure-utility links like "Help", "Logout", "Notifications", "Search" unless they look like substantive features.
- Mark importance: "core" = the product's main job, "supporting" = useful adjuncts, "optional" = admin / preferences / peripheral.
- Names must be short and human, not URL slugs. Description is one sentence about what happens in that area.`;

  const result = await generateObject({
    model: getModel(),
    schema: ScanResultSchema,
    prompt,
  });
  return result.object.areas
    .filter((a) => a.name.trim().length > 0)
    .slice(0, 20);
}
