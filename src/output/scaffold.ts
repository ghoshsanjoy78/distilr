import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  projectPaths,
  readSpec,
} from "../store/project.js";
import {
  ArchitectOutputSchema,
  ProductSpecMarkdown,
  ProductSpec,
  SetupChecklistItem,
} from "../store/schemas.js";
import { ARCHITECT_OUTPUT_FILENAME } from "../agents/architect.js";
import {
  QUALITY_SCORE_TEMPLATE,
  DESIGN_DOCS_INDEX_TEMPLATE,
  TECH_DEBT_TRACKER_TEMPLATE,
  REFERENCES_README_TEMPLATE,
  GENERATED_README_TEMPLATE,
  PRODUCT_SPECS_INDEX_HEADER,
  reliabilityTemplate,
  securityTemplate,
  frontendTemplate,
} from "./templates.js";

function bullets(items: readonly string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

// Minimal .gitignore distilr scaffolds so .env.local (written by
// stage 9 with the user's pasted secrets) is never accidentally
// committed before the implementer writes a stack-specific one.
const SCAFFOLD_GITIGNORE = `# distilr-scaffolded — extend this during Phase 0 for your stack.

# Secrets — NEVER commit
.env
.env.local
.env.*.local

# Common
node_modules/
dist/
build/
.next/
.turbo/
.vercel/
.DS_Store
*.log
`;

function checkboxList(items: readonly string[]): string {
  return items.map((s) => `- [ ] ${s}`).join("\n");
}

function section(title: string, body: string): string {
  if (!body || body.trim().length === 0) return "";
  return `\n## ${title}\n\n${body}\n`;
}

export function phaseToMarkdown(p: import("../store/schemas.js").Phase): string {
  const parts: string[] = [];
  parts.push(`# Phase ${p.number}: ${p.title}\n`);
  parts.push(`**Status:** \`planned\`  ← \`active\` while implementing, \`completed\` when shipped\n`);
  parts.push(`**Goal:** ${p.goal}\n`);
  parts.push(
    `**Estimated time:** ${p.estimatedDays} day${p.estimatedDays === 1 ? "" : "s"}\n`,
  );
  if (p.dependencies.length > 0) {
    parts.push(`**Depends on:** ${p.dependencies.join(", ")}\n`);
  }
  if (p.userStories.length > 0) parts.push(section("User stories", bullets(p.userStories)));
  if (p.scope.length > 0) parts.push(section("Scope", bullets(p.scope)));
  if (p.functionalRequirements.length > 0)
    parts.push(section("Functional requirements", bullets(p.functionalRequirements)));
  if (p.dataModel.trim()) parts.push(section("Data model", p.dataModel.trim()));
  if (p.apiSurface.trim()) parts.push(section("API surface", p.apiSurface.trim()));
  if (p.uiRequirements.trim()) parts.push(section("UI requirements", p.uiRequirements.trim()));
  if (p.edgeCases.length > 0) parts.push(section("Edge cases", bullets(p.edgeCases)));
  if (p.outOfScope.length > 0) parts.push(section("Out of scope", bullets(p.outOfScope)));
  parts.push(section("Acceptance criteria", checkboxList(p.acceptanceCriteria)));
  parts.push(section("Test approach", p.testApproach));

  // Living sections — implementer fills these in during execution.
  // The article calls these "execution plans" — specs paired with
  // progress + decision logs checked into the repo.
  parts.push(
    section(
      "Decision log",
      "_Append a record every time a non-trivial decision is made while implementing this phase. Format:_\n\n```\n## YYYY-MM-DD — <short title>\nDecision: <what was decided>\nWhy: <reasoning>\nAlternatives considered: <list>\n```\n\n_(no entries yet)_",
    ),
  );
  parts.push(
    section(
      "Progress log",
      "_Append-only log of progress. Each entry: date, what changed, what's next. Keep entries short._\n\n```\n## YYYY-MM-DD\n- Did: <work>\n- Next: <work>\n```\n\n_(no entries yet)_",
    ),
  );

  return parts.join("");
}

/**
 * Render the architect-emitted setup checklist as a static SETUP.md
 * the user can read in their editor (alongside the interactive walk-
 * through in the TUI). One section per item: name, description,
 * sign-up URL, env var to set in `.env.local`.
 */
export function buildSetupChecklistMarkdown(
  items: readonly SetupChecklistItem[],
): string {
  const header = `# Setup checklist

Before running this project, you'll need to obtain values for the
following accounts / API keys / secrets and put them in a local
\`.env.local\` file at the root of this project (next to \`AGENTS.md\`).

distilr's "build" walk-through guides you through these one at a time
in the TUI — paste a value or skip for later. This file is the static
reference if you'd rather configure them by hand.

> Never commit \`.env.local\` to git. The scaffolded \`.gitignore\`
> already excludes it.

`;

  if (items.length === 0) {
    return header + "_The architect did not flag any setup items for this project._\n";
  }

  const required = items.filter((i) => i.required);
  const optional = items.filter((i) => !i.required);

  const renderItem = (i: SetupChecklistItem) => {
    const lines: string[] = [];
    lines.push(`### ${i.name}`);
    lines.push("");
    lines.push(i.description);
    lines.push("");
    if (i.signupUrl && i.signupUrl.trim().length > 0) {
      lines.push(`**Get it:** ${i.signupUrl}`);
      lines.push("");
    }
    lines.push("Add to `.env.local`:");
    lines.push("");
    lines.push("```bash");
    lines.push(`${i.envVar}=...`);
    lines.push("```");
    return lines.join("\n");
  };

  const parts: string[] = [header];
  if (required.length > 0) {
    parts.push("## Required (Phase 0 / Phase 1 won't run without these)\n");
    parts.push(required.map(renderItem).join("\n\n"));
    parts.push("\n");
  }
  if (optional.length > 0) {
    parts.push("## Optional (a later phase needs these — defer if you want)\n");
    parts.push(optional.map(renderItem).join("\n\n"));
    parts.push("\n");
  }
  return parts.join("\n");
}

export function buildProductSpecsIndex(specs: ProductSpecMarkdown[]): string {
  if (specs.length === 0) {
    return PRODUCT_SPECS_INDEX_HEADER + "_No product specs yet._\n";
  }
  const lines = specs.map(
    (s) => `- [${s.name}](./${s.slug}.md)`,
  );
  return PRODUCT_SPECS_INDEX_HEADER + lines.join("\n") + "\n";
}

export async function writeFileAt(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

/**
 * Output-tree directory layout. Computed from `projectPaths(slug).output`.
 * Shared between stage 8 (emitOutput) and the architect's progressive
 * write helpers so both agree on where each doc lands.
 */
export interface OutputPaths {
  root: string;
  docs: string;
  designDocs: string;
  productSpecs: string;
  execPlans: string;
  active: string;
  completed: string;
  references: string;
  generated: string;
  /** Stage 9 writes one .md prompt per step under here. */
  prompts: string;
}

export function outputPaths(slug: string): OutputPaths {
  const root = projectPaths(slug).output;
  const docs = join(root, "docs");
  const execPlans = join(docs, "exec-plans");
  return {
    root,
    docs,
    designDocs: join(docs, "design-docs"),
    productSpecs: join(docs, "product-specs"),
    execPlans,
    active: join(execPlans, "active"),
    completed: join(execPlans, "completed"),
    references: join(docs, "references"),
    generated: join(docs, "generated"),
    prompts: join(root, "prompts"),
  };
}

/**
 * mkdir -p every directory the output tree needs. Safe to call
 * repeatedly. The architect calls this before progressive writes;
 * emitOutput also calls it as part of its full run.
 */
export async function ensureOutputDirs(slug: string): Promise<OutputPaths> {
  const p = outputPaths(slug);
  for (const d of [
    p.root,
    p.docs,
    p.designDocs,
    p.productSpecs,
    p.execPlans,
    p.active,
    p.completed,
    p.references,
    p.generated,
    p.prompts,
  ]) {
    await mkdir(d, { recursive: true });
  }
  return p;
}

export async function emitOutput(slug: string): Promise<{
  outputDir: string;
  phaseCount: number;
}> {
  const paths = projectPaths(slug);
  const raw = await readFile(join(paths.root, ARCHITECT_OUTPUT_FILENAME), "utf8");
  const out = ArchitectOutputSchema.parse(JSON.parse(raw));
  const spec: ProductSpec = await readSpec(slug);

  const {
    root,
    docs,
    designDocs,
    productSpecs,
    execPlans,
    active,
    completed,
    references,
    generated,
  } = await ensureOutputDirs(slug);

  // ─── Architect-generated content ───────────────────────────────────────

  // Same content under both filenames so any coding agent finds the file
  // it conventionally reads. Claude Code reads CLAUDE.md; Codex / Aider /
  // Cursor / OpenCode / Copilot / Gemini CLI read AGENTS.md.
  await writeFileAt(join(root, "AGENTS.md"), out.claudeMdMarkdown);
  await writeFileAt(join(root, "CLAUDE.md"), out.claudeMdMarkdown);
  await writeFileAt(join(root, "ARCHITECTURE.md"), out.architectureMarkdown);
  await writeFileAt(join(root, "README.md"), out.readmeMarkdown);
  await writeFileAt(
    join(root, "SETUP.md"),
    buildSetupChecklistMarkdown(out.setupChecklist ?? []),
  );
  // Minimal .gitignore so stage 9's .env.local (with the user's pasted
  // keys) is excluded from any subsequent commit. The implementer will
  // extend this during Phase 0 with stack-specific entries.
  await writeFileAt(
    join(root, ".gitignore"),
    SCAFFOLD_GITIGNORE,
  );

  await writeFileAt(join(docs, "DESIGN.md"), out.designMarkdown);
  await writeFileAt(join(docs, "PLANS.md"), out.phasesOverviewMarkdown);
  await writeFileAt(join(docs, "PRODUCT_SENSE.md"), out.productSenseMarkdown);
  await writeFileAt(join(designDocs, "core-beliefs.md"), out.coreBeliefsMarkdown);

  // Per-phase exec plans
  for (const phase of out.phases) {
    const fname = `phase-${String(phase.number).padStart(2, "0")}.md`;
    await writeFileAt(join(active, fname), phaseToMarkdown(phase));
  }

  // Per-feature product specs
  for (const ps of out.productSpecs) {
    if (!ps.slug?.trim() || !ps.markdown?.trim()) continue;
    await writeFileAt(join(productSpecs, `${ps.slug}.md`), ps.markdown);
  }
  await writeFileAt(
    join(productSpecs, "index.md"),
    buildProductSpecsIndex(out.productSpecs),
  );

  // ─── Scaffolded templates (implementer fills these as they ship) ─────

  await writeFileAt(join(docs, "QUALITY_SCORE.md"), QUALITY_SCORE_TEMPLATE);
  await writeFileAt(join(docs, "RELIABILITY.md"), reliabilityTemplate(spec));
  await writeFileAt(join(docs, "SECURITY.md"), securityTemplate(spec));
  await writeFileAt(join(docs, "FRONTEND.md"), frontendTemplate(spec));
  await writeFileAt(
    join(designDocs, "index.md"),
    DESIGN_DOCS_INDEX_TEMPLATE,
  );
  await writeFileAt(
    join(execPlans, "tech-debt-tracker.md"),
    TECH_DEBT_TRACKER_TEMPLATE,
  );
  await writeFileAt(
    join(references, "README.md"),
    REFERENCES_README_TEMPLATE,
  );
  await writeFileAt(
    join(generated, "README.md"),
    GENERATED_README_TEMPLATE,
  );
  // Empty .gitkeep so the active/completed split is visible from a
  // fresh clone even before any phase has been moved.
  await writeFileAt(join(completed, ".gitkeep"), "");

  return { outputDir: root, phaseCount: out.phases.length };
}
