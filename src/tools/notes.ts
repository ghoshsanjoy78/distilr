import { tool } from "ai";
import { z } from "zod";
import {
  appendObservation,
  searchObservations,
  readObservations,
} from "../store/project.js";
import { ObservationSchema } from "../store/schemas.js";

export function buildNotesTools(slug: string) {
  return {
    notes_append: tool({
      description:
        "Record a single observation about the SaaS being analyzed. Use this generously — anything you notice that helps understand what the product does.",
      inputSchema: z.object({
        kind: ObservationSchema.shape.kind,
        summary: z
          .string()
          .min(5)
          .describe("A one-to-three-sentence summary of what you observed"),
        page: z.string().optional().describe("Page name, e.g. 'Pricing'"),
        url: z.string().optional(),
        evidence: z
          .array(z.string())
          .optional()
          .describe(
            "Short bullets of supporting detail (UI text, button labels, form fields seen, etc.)",
          ),
        screenshotId: z.string().optional(),
      }),
      execute: async (args) => {
        const obs = await appendObservation(slug, {
          kind: args.kind,
          summary: args.summary,
          page: args.page,
          url: args.url,
          evidence: args.evidence ?? [],
          screenshotId: args.screenshotId,
        });
        return `Saved observation ${obs.id} (kind=${obs.kind})`;
      },
    }),

    notes_search: tool({
      description:
        "Search prior observations by substring (lower-cased). Useful for avoiding duplicates.",
      inputSchema: z.object({
        query: z.string(),
        limit: z.number().int().min(1).max(50).default(10),
      }),
      execute: async ({ query, limit }) => {
        const matches = await searchObservations(slug, query, limit);
        if (matches.length === 0) return "(no matches)";
        return matches
          .map(
            (o) =>
              `[${o.id.slice(0, 8)}] ${o.kind} — ${o.page ?? "?"} — ${o.summary}`,
          )
          .join("\n");
      },
    }),

    notes_count: tool({
      description:
        "Return the number of observations recorded so far, broken down by kind.",
      inputSchema: z.object({}),
      execute: async () => {
        const all = await readObservations(slug);
        const by: Record<string, number> = {};
        for (const o of all) by[o.kind] = (by[o.kind] ?? 0) + 1;
        return (
          `Total: ${all.length}\n` +
          Object.entries(by)
            .map(([k, n]) => `  ${k}: ${n}`)
            .join("\n")
        );
      },
    }),
  };
}
