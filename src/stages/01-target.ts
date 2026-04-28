import { initProject, slugify, projectDir } from "../store/project.js";
import { existsSync } from "node:fs";
import {
  generateClarifyingQuestions,
  suggestSaaSProducts,
  SaasSuggestion,
} from "../agents/idea-research.js";
import { checkScopeRealism } from "../agents/scope-check.js";
import type { Bus } from "../tui/bus.js";

function guessUrl(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `https://${slug}.com`;
}

function isValidUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

async function pickSpecificSaaS(
  bus: Bus,
): Promise<{ saasName: string; saasUrl: string }> {
  let saasName = "";
  while (!saasName) {
    const v = await bus.askInput("Which SaaS do you want to study?");
    if (v.trim().length > 0) saasName = v.trim();
  }
  let saasUrl = "";
  while (!saasUrl) {
    const v = await bus.askInput(`Marketing URL for ${saasName}:`, {
      default: guessUrl(saasName),
    });
    if (isValidUrl(v.trim())) saasUrl = v.trim();
    else
      bus.emit({
        kind: "warning",
        text: "That doesn't look like a valid URL — try again.",
      });
  }
  return { saasName, saasUrl };
}

async function discoverSaaSFromIdea(
  bus: Bus,
): Promise<{ saasName: string; saasUrl: string }> {
  let idea = "";
  while (!idea) {
    const v = await bus.askInput(
      "Describe what you want to build (1-3 sentences):",
    );
    if (v.trim().length > 5) idea = v.trim();
    else
      bus.emit({
        kind: "warning",
        text: "Give me a bit more — even one sentence is fine.",
      });
  }

  bus.emit({
    kind: "info",
    text: "Thinking of a couple of clarifying questions…",
  });

  let questions: string[] = [];
  try {
    questions = await generateClarifyingQuestions(idea);
  } catch (e) {
    bus.emit({
      kind: "warning",
      text: `Couldn't generate clarifying questions (${(e as Error).message}). Skipping.`,
    });
  }

  const clarifications: { question: string; answer: string }[] = [];
  for (const q of questions) {
    const a = await bus.askInput(`${q} (or hit enter to skip)`);
    clarifications.push({ question: q, answer: a });
  }

  bus.emit({
    kind: "info",
    text: "Researching similar SaaS products…",
  });

  let suggestions: SaasSuggestion[] = [];
  try {
    suggestions = await suggestSaaSProducts(idea, clarifications);
  } catch (e) {
    bus.emit({
      kind: "warning",
      text: `Suggestion call failed (${(e as Error).message}). Falling back to specific-SaaS prompt.`,
    });
  }

  if (suggestions.length === 0) {
    bus.emit({
      kind: "warning",
      text: "No suggestions came back — let's pick a specific SaaS instead.",
    });
    return pickSpecificSaaS(bus);
  }

  bus.emit({
    kind: "info",
    text: `Found ${suggestions.length} matching SaaS products.`,
  });

  type PickValue =
    | { kind: "suggestion"; index: number }
    | { kind: "manual" };
  const picked = await bus.askSelect<PickValue>(
    "Which one would you like to study?",
    [
      ...suggestions.map(
        (s, index) =>
          ({
            label: `${s.name} — ${s.oneLiner}  (${s.url})`,
            value: { kind: "suggestion", index } as const,
          }) as const,
      ),
      {
        label: "✎ None of these — let me name a specific SaaS",
        value: { kind: "manual" } as const,
      },
    ],
  );

  if (picked.kind === "manual") {
    return pickSpecificSaaS(bus);
  }

  const sel = suggestions[picked.index]!;
  bus.emit({
    kind: "info",
    text: `Studying ${sel.name} (${sel.url}) — ${sel.why}`,
  });
  return { saasName: sel.name, saasUrl: sel.url };
}

/**
 * After the user picks a SaaS (either path), run a one-shot LLM scope
 * realism check. For sprawling targets the resulting MVP spec is generic
 * mush; for broad ones the area picker matters more than usual.
 *
 * Soft warnings only — every branch has a "continue anyway" path. If the
 * scope-check call itself fails, log and proceed (graceful degrade).
 */
async function runScopeGate(
  bus: Bus,
  saasName: string,
  saasUrl: string,
): Promise<"ok" | "repick"> {
  let assessment;
  try {
    assessment = await checkScopeRealism(saasName, saasUrl);
  } catch (e) {
    bus.emit({
      kind: "warning",
      text: `Couldn't run scope check (${(e as Error).message}). Proceeding.`,
    });
    return "ok";
  }

  if (assessment.sizeCategory === "focused") return "ok";

  if (assessment.sizeCategory === "sprawling") {
    bus.emit({
      kind: "warning",
      text: `${saasName} looks too sprawling for an MVP-sized spec — ${assessment.reason}`,
    });
    const choice = await bus.askSelect<"narrow" | "continue" | "cancel">(
      assessment.narrowingSuggestion
        ? `Suggested narrower scope: ${assessment.narrowingSuggestion}. What now?`
        : "distilr will produce a shallow, generic plan if you continue. What now?",
      [
        { label: "Pick a narrower scope (re-enter target)", value: "narrow" },
        { label: "Continue anyway", value: "continue" },
        { label: "Cancel", value: "cancel" },
      ],
    );
    if (choice === "narrow") return "repick";
    if (choice === "cancel") throw new Error("Cancelled at scope check.");
    return "ok";
  }

  // broad
  bus.emit({
    kind: "warning",
    text: `${saasName} is moderately broad — ${assessment.reason}`,
  });
  const choice = await bus.askSelect<"continue" | "narrow">(
    assessment.narrowingSuggestion
      ? `Suggested narrower scope: ${assessment.narrowingSuggestion}. distilr will work but the area picker in stage 4 matters more than usual.`
      : "distilr will work but the area picker in stage 4 matters more than usual.",
    [
      { label: "Continue", value: "continue" },
      { label: "Pick a narrower scope (re-enter target)", value: "narrow" },
    ],
  );
  return choice === "narrow" ? "repick" : "ok";
}

export async function stageTarget(
  bus: Bus,
): Promise<{ slug: string; saasName: string; saasUrl: string }> {
  let saasName: string;
  let saasUrl: string;

  while (true) {
    const path = await bus.askSelect<"specific" | "idea">(
      "How do you want to start?",
      [
        {
          label: "I have a specific SaaS in mind to study",
          value: "specific",
        },
        {
          label: "Describe what I want to build, get AI suggestions",
          value: "idea",
        },
      ],
    );

    const picked =
      path === "idea"
        ? await discoverSaaSFromIdea(bus)
        : await pickSpecificSaaS(bus);

    bus.emit({
      kind: "info",
      text: `Checking scope realism for ${picked.saasName}…`,
    });
    const verdict = await runScopeGate(bus, picked.saasName, picked.saasUrl);
    if (verdict === "ok") {
      saasName = picked.saasName;
      saasUrl = picked.saasUrl;
      break;
    }
    // repick — loop
  }

  let slug = slugify(saasName);
  if (existsSync(projectDir(slug))) {
    let i = 2;
    while (existsSync(projectDir(`${slug}-${i}`))) i++;
    slug = `${slug}-${i}`;
  }
  await initProject(slug, saasName, saasUrl);
  bus.setProject(slug, saasName);
  bus.emit({ kind: "info", text: `Project initialized: projects/${slug}/` });
  return { slug, saasName, saasUrl };
}
