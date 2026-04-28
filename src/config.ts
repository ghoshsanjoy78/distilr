import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Load env files in priority order: .env.local overrides .env.
// `override: false` on the second call means values already loaded are kept.
let loaded = false;
function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  const cwd = process.cwd();
  const localPath = join(cwd, ".env.local");
  const defaultPath = join(cwd, ".env");
  if (existsSync(localPath)) loadDotenv({ path: localPath });
  if (existsSync(defaultPath)) loadDotenv({ path: defaultPath, override: false });
}

loadEnv();

// Re-export provider helpers so callers can import everything from one place
// if they prefer. The actual implementations live in providers.ts.
export { assertApiKey, getModel, getProviderSummary } from "./providers.js";
