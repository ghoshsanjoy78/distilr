import { tool } from "ai";
import { z } from "zod";
import { getBus } from "../tui/bus.js";

export function buildAskUserTools() {
  return {
    ask_user: tool({
      description:
        "Pause the agent loop and surface a question to the human at the terminal. " +
        "Use this in two situations:\n\n" +
        "1. UNCERTAINTY: when you're unsure which section to explore next, " +
        "what an ambiguous UI element means, or how to interpret something " +
        "the spec doesn't pin down.\n\n" +
        "2. BLOCKERS: when the browser surface needs a human to do something " +
        "you can't do via tools — examples: file upload via the OS native " +
        "file picker, CAPTCHA / hCaptcha / Cloudflare turnstile, two-factor " +
        "auth challenge, payment / Stripe dialog you should NOT fill, OAuth " +
        "consent on a third-party domain, anything that requires the user's " +
        "fingers on the actual keyboard or a real credential. The human " +
        "will resolve it in the browser, then come back and tell you to " +
        "continue. Don't keep retrying — ask.\n\n" +
        "Provide a clear, one-sentence question. If there's a small set of " +
        "choices, pass them in `options`; otherwise leave it open-ended and " +
        "the user types a free-text reply.",
      inputSchema: z.object({
        question: z.string().describe(
          "The question or request, phrased so a human can answer it. For blockers, say what you need them to do (e.g. 'Please complete the captcha on the current page, then reply continue').",
        ),
        options: z
          .array(z.string())
          .optional()
          .describe(
            "If provided, present as a select; otherwise free-text input. Useful for narrow A/B/C choices.",
          ),
      }),
      execute: async ({ question, options }) => {
        const bus = getBus();
        if (options && options.length > 0) {
          const answer = await bus.askSelect(
            question,
            options.map((o) => ({ label: o, value: o })),
          );
          return `User selected: ${answer}`;
        }
        const answer = await bus.askInput(question);
        return `User said: ${answer}`;
      },
    }),
  };
}
