// Ink owns stdout. Any stray console.log from Playwright, the SDK, or our own
// code would corrupt the rendered frame. We patch console.* at startup to
// route everything to a per-project log file via pino. The original methods
// are restored on uninstall (called when Ink unmounts).
//
// Why pino: already in deps; structured logging; non-blocking writes.

import pino, { Logger } from "pino";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { dirname } from "node:path";

interface PatchedConsole {
  log: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

let restorePoint: PatchedConsole | null = null;
let logger: Logger | null = null;

export function installLogRedirect(logFilePath: string): void {
  if (restorePoint) return; // already installed

  const dir = dirname(logFilePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const stream = createWriteStream(logFilePath, { flags: "a" });
  logger = pino({ level: "info" }, stream);

  restorePoint = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  const fmt = (args: unknown[]): string =>
    args
      .map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      })
      .join(" ");

  console.log = (...args: unknown[]) => logger?.info(fmt(args));
  console.info = (...args: unknown[]) => logger?.info(fmt(args));
  console.warn = (...args: unknown[]) => logger?.warn(fmt(args));
  console.error = (...args: unknown[]) => logger?.error(fmt(args));
  console.debug = (...args: unknown[]) => logger?.debug(fmt(args));
}

export function uninstallLogRedirect(): void {
  if (!restorePoint) return;
  console.log = restorePoint.log;
  console.warn = restorePoint.warn;
  console.error = restorePoint.error;
  console.info = restorePoint.info;
  console.debug = restorePoint.debug;
  restorePoint = null;
  logger = null;
}
