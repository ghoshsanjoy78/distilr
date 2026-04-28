// Read and write .env.local so the setup wizard can persist the user's
// provider / model / auth-method / API-key choices. Preserves comments
// and existing unrelated entries; updates or appends keys it knows about.
//
// `parseEnvFile` and `mergeEnvLines` are exported so the per-project
// .env.local writer in `src/setup/project-env.ts` can reuse the same
// merge semantics (preserve comments, treat empty value as delete,
// escape shell-special chars, etc.) without duplicating the logic.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENV_LOCAL = ".env.local";

export function envLocalPath(): string {
  return join(process.cwd(), ENV_LOCAL);
}

export function readEnvLocal(): Record<string, string> {
  const path = envLocalPath();
  if (!existsSync(path)) return {};
  return parseEnvFile(readFileSync(path, "utf8"));
}

export function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Update or insert keys in .env.local. Preserves all existing lines
 * (including comments and unrelated entries) and only touches the keys
 * present in `updates`. Empty-string values delete the entry.
 */
export function writeEnvLocal(updates: Record<string, string>): void {
  const path = envLocalPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const merged = mergeEnvLines(existing, updates);
  writeFileSync(path, merged, "utf8");
}

export function mergeEnvLines(
  existing: string,
  updates: Record<string, string>,
): string {
  const seen = new Set<string>();
  const linesIn = existing.split("\n");
  const linesOut: string[] = [];

  for (const line of linesIn) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      linesOut.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      linesOut.push(line);
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      seen.add(key);
      const v = updates[key];
      if (v && v.length > 0) {
        linesOut.push(`${key}=${escapeValue(v)}`);
      }
      // empty value → drop the line (treat as delete)
      continue;
    }
    linesOut.push(line);
  }

  // Append any updates that weren't already in the file.
  for (const [key, val] of Object.entries(updates)) {
    if (seen.has(key)) continue;
    if (val && val.length > 0) {
      linesOut.push(`${key}=${escapeValue(val)}`);
    }
  }

  let result = linesOut.join("\n");
  if (!result.endsWith("\n")) result += "\n";
  return result;
}

function escapeValue(v: string): string {
  // Quote if the value contains whitespace or shell-special chars.
  if (/[\s"#$&'`()|<>]/.test(v)) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

/**
 * After writeEnvLocal, our process's env doesn't auto-update. This
 * applies the same updates to process.env so subsequent code (the
 * pipeline kicked off after the wizard) sees the new values.
 */
export function applyToProcessEnv(updates: Record<string, string>): void {
  for (const [k, v] of Object.entries(updates)) {
    if (!v || v.length === 0) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}
