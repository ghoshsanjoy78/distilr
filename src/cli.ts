#!/usr/bin/env node
import "./config.js"; // loads .env.local / .env before anything else
import { Command, Option } from "commander";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  listProjects,
  ensureProjectsRoot,
  projectPaths,
  PROJECTS_ROOT,
} from "./store/project.js";
import { getProviderSummary } from "./providers.js";
import { renderApp } from "./tui/app.js";
import { PROVIDER_NAMES } from "./providers.js";
import { STAGES, type Stage } from "./store/schemas.js";
import { planReset, applyReset } from "./reset.js";

interface ProviderOpts {
  provider?: string;
  model?: string;
}

function applyProviderOpts(opts: ProviderOpts): void {
  if (opts.provider) process.env.DISTILR_PROVIDER = opts.provider;
  if (opts.model) process.env.DISTILR_MODEL = opts.model;
}

const providerOption = new Option(
  "--provider <name>",
  "AI provider to use (overrides DISTILR_PROVIDER env)",
).choices([...PROVIDER_NAMES, "gemini"]);

const modelOption = new Option(
  "--model <name>",
  "Model name within the chosen provider (overrides DISTILR_MODEL env)",
);

const program = new Command();

program
  .name("distilr")
  .description(
    "Terminal agent that distills any SaaS into a complete build spec — research, design tokens, architecture, and a phased plan, ready for your AI coding agent.",
  )
  .version("0.1.0")
  .addHelpText(
    "after",
    `
Environment variables (read from .env.local; CLI flags override):

  DISTILR_PROVIDER             Default provider. One of:
                                 anthropic (default), openai, google, gemini, openrouter
  DISTILR_MODEL                Override the model id within the active provider.

  ANTHROPIC_API_KEY              Required when provider = anthropic.
                                 Get one at https://console.anthropic.com/
  OPENAI_API_KEY                 Required when provider = openai.
                                 Get one at https://platform.openai.com/api-keys
  GOOGLE_GENERATIVE_AI_API_KEY   Required when provider = google or gemini.
                                 Get one at https://aistudio.google.com/app/apikey
  OPENROUTER_API_KEY             Required when provider = openrouter.
                                 Get one at https://openrouter.ai/keys

Default model per provider:

  anthropic    →  claude-sonnet-4-6
  openai       →  gpt-4o
  google       →  gemini-2.5-pro
  openrouter   →  anthropic/claude-sonnet-4-6

Per-command flags (start / resume / providers):

  --provider <name>    Override DISTILR_PROVIDER for this run.
  --model <name>       Override DISTILR_MODEL for this run.

Examples:

  $ distilr                                            # start (default)
  $ distilr config                                     # (re-)run the setup wizard
  $ distilr resume my-project
  $ distilr build my-project                           # walk the build prompt deck
  $ distilr reset my-project --to architect            # rewind to before stage 7
  $ distilr list
  $ distilr providers
  $ distilr --provider openai --model gpt-4o
  $ distilr --provider gemini --model gemini-2.5-flash
  $ distilr resume my-project --provider openrouter

First run: if .env.local is missing or doesn't have a key for the active
provider, the setup wizard runs automatically before stage 1.

Interactive controls during a run:

  p          Interrupt the recon/explore agent (open the steer/stop modal).
  Esc        Dismiss agent-stage modals (= "keep going").
  ↑ ↓        Navigate options · space toggle · enter confirm.
  Ctrl-C     Hard interrupt — always safe; resume with: distilr resume <slug>
  q          Quit the final / error screen.

Output (in projects/<slug>/output/):

  ARCHITECTURE.md                       System layout, data model, services,
                                        mermaid diagram.
  README.md                             Short project README.
  AGENTS.md / CLAUDE.md                 Agent table-of-contents (~100 lines)
                                        pointing into docs/. Same content under
                                        both filenames for cross-tool support.
  SETUP.md                              Env vars / API keys this project needs.
  .env.local                            (created in stage 9) your pasted secrets.
  .gitignore                            Minimal — implementer extends in Phase 0.
  prompts/NN-*.md                       (created in stage 9) one prompt per
                                        phase, copy-paste into your AI coder.
  docs/PLANS.md                         High-level phase overview.
  docs/DESIGN.md                        Concrete design tokens — palette, type,
                                        spacing, motion.
  docs/PRODUCT_SENSE.md                 Target user, differentiation, voice.
  docs/exec-plans/active/phase-NN.md    Per-phase product/eng spec (user stories,
                                        requirements, data model, API surface,
                                        UI requirements, edge cases, out-of-scope,
                                        acceptance criteria, test approach).
  docs/product-specs/<slug>.md          One per must-have feature.
  docs/design-docs/core-beliefs.md      Agent-first operating principles.

More: https://github.com/ghoshsanjoy78/distilr
`,
  );

program
  .command("start", { isDefault: true })
  .description("Start a new project (or resume one in-progress)")
  .addOption(providerOption)
  .addOption(modelOption)
  .action(async (opts: ProviderOpts) => {
    try {
      applyProviderOpts(opts);
      // Note: we intentionally don't call assertApiKey() here — the
      // TUI app runs the setup wizard first if the config is missing.
      await ensureProjectsRoot();
      await renderApp({ mode: "start" });
    } catch (e) {
      process.stderr.write(`✗ ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("resume")
  .description("Resume an in-progress project")
  .argument("<slug>", "project slug under projects/")
  .addOption(providerOption)
  .addOption(modelOption)
  .action(async (slug: string, opts: ProviderOpts) => {
    try {
      applyProviderOpts(opts);
      await ensureProjectsRoot();
      await renderApp({ mode: "resume", slug });
    } catch (e) {
      process.stderr.write(`✗ ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("build")
  .description(
    "Walk through the build prompts for an emitted project (stage 9). Shows a setup checklist (env vars / API keys → .env.local) and a deck of copy-paste prompts (one per phase) you'll run in your AI coder. Requires stages 1-8 done.",
  )
  .argument("<slug>", "project slug under projects/")
  .addOption(providerOption)
  .addOption(modelOption)
  .action(async (slug: string, opts: ProviderOpts) => {
    try {
      applyProviderOpts(opts);
      await ensureProjectsRoot();
      await renderApp({ mode: "resume", slug });
    } catch (e) {
      process.stderr.write(`✗ ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("config")
  .description(
    "(Re-)run the setup wizard to choose provider, model, and API key. Saves to .env.local.",
  )
  .action(async () => {
    try {
      await renderApp({ mode: "config" });
    } catch (e) {
      process.stderr.write(`✗ ${(e as Error).message}\n`);
      process.exitCode = 1;
    }
  });

program
  .command("list")
  .description("List existing projects")
  .action(async () => {
    await ensureProjectsRoot();
    const projects = await listProjects();
    process.stdout.write(`Projects directory: ${PROJECTS_ROOT}\n`);
    if (projects.length === 0) {
      process.stdout.write("No projects yet. Run `distilr start` to begin.\n");
      return;
    }
    for (const slug of projects) process.stdout.write(`  ${slug}\n`);
  });

program
  .command("reset")
  .description(
    "Roll a project back so the given stage is the next one to run. Removes the artifacts produced by that stage and every stage after, and rewinds state.json's lastCompletedStage. Asks before deleting unless --yes is passed.",
  )
  .argument("<slug>", "project slug under projects/")
  .requiredOption(
    "--to <stage>",
    `target stage to reset to: ${STAGES.filter((s) => s !== "target").join(" | ")}`,
  )
  .option("-y, --yes", "skip the confirmation prompt", false)
  .action(
    async (
      slug: string,
      opts: { to: string; yes: boolean },
    ) => {
      try {
        const target = opts.to as Stage;
        if (!STAGES.includes(target)) {
          process.stderr.write(
            `✗ unknown stage "${opts.to}". Valid: ${STAGES.join(", ")}\n`,
          );
          process.exitCode = 1;
          return;
        }
        if (target === "target") {
          process.stderr.write(
            "✗ resetting to 'target' would wipe the project. Run `rm -rf projects/<slug>` instead.\n",
          );
          process.exitCode = 1;
          return;
        }
        const paths = projectPaths(slug);
        if (!existsSync(paths.stateFile)) {
          process.stderr.write(
            `✗ project not found: ${paths.root}\n`,
          );
          process.exitCode = 1;
          return;
        }
        const spec = planReset(slug, target);
        process.stdout.write(
          `Reset ${slug} so '${target}' is the next stage to run.\n`,
        );
        process.stdout.write(
          `New state.lastCompletedStage: '${spec.newLastCompleted}'.\n\n`,
        );
        if (spec.summary.length === 0) {
          process.stdout.write(
            "Nothing to delete — only the state pointer will move.\n",
          );
        } else {
          for (const line of spec.summary) {
            process.stdout.write(`${line}\n`);
          }
          process.stdout.write("\n");
        }
        if (!opts.yes) {
          const rl = createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          const ans = (await rl.question("Proceed? [y/N] ")).trim().toLowerCase();
          rl.close();
          if (ans !== "y" && ans !== "yes") {
            process.stdout.write("Aborted.\n");
            return;
          }
        }
        await applyReset(slug, spec);
        process.stdout.write(
          `✓ Reset complete. Run \`./distilr resume ${slug}\` to pick up at '${target}'.\n`,
        );
      } catch (e) {
        process.stderr.write(`✗ ${(e as Error).message}\n`);
        process.exitCode = 1;
      }
    },
  );

program
  .command("providers")
  .description("Show available providers and the active selection")
  .addOption(providerOption)
  .addOption(modelOption)
  .action((opts: ProviderOpts) => {
    applyProviderOpts(opts);
    process.stdout.write(`Active: ${getProviderSummary()}\n`);
    process.stdout.write(`Available: ${PROVIDER_NAMES.join(", ")} (alias: gemini → google)\n`);
  });

program.parseAsync(process.argv).catch((e) => {
  process.stderr.write(`✗ ${(e as Error).message}\n`);
  process.exit(1);
});
