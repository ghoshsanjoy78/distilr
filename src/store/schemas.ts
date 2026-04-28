import { z } from "zod";

export const STAGES = [
  "target",
  "recon",
  "login",
  "explore",
  "synthesize",
  "wizard",
  "architect",
  "emit",
  // Optional. Walks the user through a setup checklist (env vars / API
  // keys → .env.local) and a deck of copy-paste prompts (one per phase)
  // they can paste into their AI coder. Skipped if the user picks
  // "later" at the end of stage 8. Stage key stays "implement" for
  // state.json compatibility across versions even though the user-
  // facing label is now "build".
  "implement",
] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Progress within stage 9 (build). Persisted in state.json so a killed
 * session resumes at the right prompt. Null/absent until the user
 * opts into the build stage.
 */
export const BuildProgressSchema = z.object({
  /**
   * ISO timestamp of when the user finished the setup-checklist phase
   * of stage 9. Null until the last setup item has been
   * pasted-or-skipped.
   */
  setupCompletedAt: z.string().nullable(),
  /**
   * 0-based index of the most-recently-acknowledged prompt in the deck.
   * -1 = haven't shown any prompt yet (still in setup checklist).
   * On resume, stage 9 picks up at lastPromptIndex + 1.
   */
  lastPromptIndex: z.number(),
  /** ISO timestamp of when stage 9 first started. */
  startedAt: z.string(),
});
export type BuildProgress = z.infer<typeof BuildProgressSchema>;

export const ProjectStateSchema = z.object({
  slug: z.string(),
  saasName: z.string(),
  saasUrl: z.string().url(),
  createdAt: z.string(),
  lastCompletedStage: z.union([z.enum(STAGES), z.literal("none")]),
  /**
   * Set to true if the user chose to skip the login + in-app exploration.
   * When true, stage 04 (explore) is a no-op and synthesis runs with only
   * the public-recon observations.
   */
  skippedAuth: z.boolean(),
  /**
   * The high-level feature areas the user picked at the start of stage 04.
   * Set after the initial in-app scan; used to focus the explorer agent
   * on only the areas the user actually wants in their build. Persists across
   * resume so we don't re-scan or re-prompt.
   */
  selectedAreas: z.array(z.string()).optional(),
  /**
   * Stage 9 progress. Null/absent until the user opts into the build
   * stage. Persisted across resume so a killed run picks up at the
   * next unseen prompt.
   */
  buildProgress: BuildProgressSchema.nullable().optional(),
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const ObservationSchema = z.object({
  id: z.string(),
  ts: z.string(),
  page: z.string().optional(),
  url: z.string().optional(),
  kind: z.enum([
    "feature",
    "pricing",
    "integration",
    "data-model",
    "ui-pattern",
    "navigation",
    "form",
    "table",
    "cta",
    "doc",
    "other",
  ]),
  summary: z.string(),
  evidence: z.array(z.string()).default([]),
  screenshotId: z.string().optional(),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  // Plain z.number() (NOT .int()) — see synthesizer.ts FeatureInputSchema
  // for why: Zod's toJSONSchema auto-injects safe-integer min/max on
  // .int() fields and Anthropic's structured-output validator rejects
  // those. Synthesizer rounds + clamps to [1, 5] post-parse.
  complexity: z
    .number()
    .describe(
      "Integer 1-5 scale: 1 = trivial CRUD/static, 5 = serious distributed/algorithmic work",
    ),
  dependencies: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const FeatureCategorySchema = z.object({
  name: z.string(),
  features: z.array(FeatureSchema),
});
export type FeatureCategory = z.infer<typeof FeatureCategorySchema>;

export const FeatureCatalogSchema = z.object({
  source: z.string(),
  generatedAt: z.string(),
  categories: z.array(FeatureCategorySchema),
});
export type FeatureCatalog = z.infer<typeof FeatureCatalogSchema>;

export const ProductSpecSchema = z.object({
  appName: z.string(),
  oneLiner: z.string(),
  targetUser: z.enum(["same", "subset", "adjacent", "different"]),
  differentiation: z.array(
    z.enum([
      "cheaper",
      "simpler",
      "niche",
      "better-ux",
      "open-source",
      "ai-native",
      "mobile-first",
    ]),
  ),
  selectedFeatures: z.array(
    z.object({
      featureId: z.string(),
      priority: z.enum(["must-have", "nice-to-have"]),
    }),
  ),
  lookAndFeel: z.enum([
    "minimal-modern",
    "playful",
    "enterprise",
    "retro-terminal",
    "brutalist",
    "glass-dark",
  ]),
  techStack: z.enum([
    "let-architect-decide",
    "nextjs-postgres",
    "sveltekit",
    "rails",
    "phoenix",
    "django",
    "custom",
  ]),
  techStackCustom: z.string().optional(),
  auth: z.enum([
    "magic-link",
    "oauth",
    "username-password",
    "let-architect-decide",
  ]),
  hosting: z.enum([
    "vercel",
    "fly",
    "render",
    "self-host",
    "let-architect-decide",
  ]),
  monetization: z.enum([
    "free",
    "paid-saas",
    "freemium",
    "open-source",
    "out-of-scope",
  ]),
  implementer: z.enum([
    "claude-code",
    "codex",
    "opencode",
    "cursor",
    "decide-later",
  ]),
});
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

// Rich product/eng spec for one build phase. Every field is required —
// the architect's prompt explicitly tells the model to emit each one
// (with empty arrays / strings where a section genuinely doesn't apply,
// e.g. uiRequirements on a backend-only phase).
export const PhaseSchema = z.object({
  // Plain z.number() (not .int()) — Zod auto-injects safe-integer
  // min/max on .int() and Anthropic's structured-output validator
  // rejects those. Architect rounds + clamps post-parse.
  number: z
    .number()
    .describe("Zero-based phase index (whole number). Phase 0 is scaffolding."),
  title: z.string(),
  goal: z
    .string()
    .describe(
      "One-paragraph statement of what's delivered at the end of this phase",
    ),
  userStories: z
    .array(z.string())
    .describe(
      "Scenarios the user can complete after this phase ships. Format each as: 'As a <role>, I can <action> so that <outcome>.'",
    ),
  scope: z
    .array(z.string())
    .describe(
      "High-level summary of what's in this phase (boundaries, not behaviors).",
    ),
  functionalRequirements: z
    .array(z.string())
    .describe(
      "Concrete, testable behaviors the implementation MUST satisfy. Each item is one specific requirement, not a vague goal.",
    ),
  dataModel: z
    .string()
    .describe(
      "Entities, fields, types, validation rules, and relationships introduced or modified. Use a markdown table or fenced code block for clarity. Empty string if no data changes in this phase.",
    ),
  apiSurface: z
    .string()
    .describe(
      "API endpoints / RPC methods / function signatures introduced. Include path/name, request shape, response shape, status codes or error shapes. Use markdown for clarity. Empty string if N/A.",
    ),
  uiRequirements: z
    .string()
    .describe(
      "Screens, components, key interactions, and visible states (loading/empty/error). Detailed enough that a coding agent can render it without further questions. Empty string if N/A.",
    ),
  edgeCases: z
    .array(z.string())
    .describe(
      "Specific concrete edge cases the implementation must handle correctly (e.g. empty inputs, concurrent edits, network drops).",
    ),
  outOfScope: z
    .array(z.string())
    .describe(
      "Items explicitly deferred to later phases or not part of this product. Prevents scope creep.",
    ),
  acceptanceCriteria: z
    .array(z.string())
    .describe(
      "Testable, observable check-list items proving the phase is complete. Each item is verifiable in <30 seconds.",
    ),
  testApproach: z
    .string()
    .describe(
      "What and how to test (unit / integration / e2e). State what confidence each level provides.",
    ),
  dependencies: z
    .array(z.string())
    .describe(
      "Prior phase numbers/titles or external systems this phase depends on. Empty array if none.",
    ),
  // Plain z.number() (not .int()) — Zod auto-injects safe-integer
  // min/max on .int() and Anthropic's structured-output validator
  // rejects those. Architect rounds + clamps post-parse.
  estimatedDays: z
    .number()
    .describe(
      "Whole-number days of effort. Target 1-7; if you'd want more than 7 the phase is too big — split it.",
    ),
});
export type Phase = z.infer<typeof PhaseSchema>;

/**
 * One row in the architect-emitted setup checklist. The TUI walks the
 * user through these in stage 9 — for each item, the user can paste a
 * value (which lands in `projects/<slug>/output/.env.local` locally)
 * or skip it for later. Pasted values are NEVER sent to any LLM; the
 * checklist only feeds the architect with metadata (envVar/description).
 */
export const SetupChecklistItemSchema = z.object({
  name: z
    .string()
    .describe(
      "Short human label, e.g. 'Supabase project URL' or 'Stripe secret key'.",
    ),
  envVar: z
    .string()
    .describe(
      "Env var key written to .env.local, e.g. 'NEXT_PUBLIC_SUPABASE_URL'. Uppercase, snake_case.",
    ),
  description: z
    .string()
    .describe(
      "1-2 sentences: what this is for in THIS project. Concrete, not generic ('Used by the auth callback at /api/auth' beats 'For authentication').",
    ),
  signupUrl: z
    .string()
    .describe(
      "URL the user visits to obtain this value, e.g. 'https://supabase.com/dashboard/project/_/settings/api'. Empty string if local-only (e.g. a self-generated NEXTAUTH_SECRET).",
    ),
  required: z
    .boolean()
    .describe(
      "True if Phase 0 / Phase 1 cannot run without it. False if a later phase needs it (user can defer).",
    ),
});
export type SetupChecklistItem = z.infer<typeof SetupChecklistItemSchema>;

export const ProductSpecMarkdownSchema = z.object({
  name: z
    .string()
    .describe("Human-readable feature name, e.g. 'Email campaigns'."),
  slug: z
    .string()
    .describe(
      "URL-safe slug used as the filename, e.g. 'email-campaigns'. Lowercase, hyphenated.",
    ),
  markdown: z
    .string()
    .describe("Full product-spec markdown content for this feature."),
});
export type ProductSpecMarkdown = z.infer<typeof ProductSpecMarkdownSchema>;

export const ArchitectOutputSchema = z.object({
  architectureMarkdown: z.string(),
  phasesOverviewMarkdown: z.string(),
  phases: z.array(PhaseSchema),
  // The agent-instructions doc — same content written to both AGENTS.md
  // (cross-tool) and CLAUDE.md (Claude Code's filename). With the
  // harness-engineering layout this is a ~100-line table of contents
  // pointing into docs/, not a monolith.
  claudeMdMarkdown: z.string(),
  readmeMarkdown: z.string(),
  designMarkdown: z.string(),
  productSenseMarkdown: z.string(),
  coreBeliefsMarkdown: z.string(),
  productSpecs: z.array(ProductSpecMarkdownSchema),
  /**
   * External accounts / API keys / secrets the user must obtain to run
   * this app. Drives the stage 9 setup checklist; also written as a
   * static SETUP.md in the output tree.
   */
  setupChecklist: z.array(SetupChecklistItemSchema),
});
export type ArchitectOutput = z.infer<typeof ArchitectOutputSchema>;
