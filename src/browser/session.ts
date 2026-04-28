import { chromium, BrowserContext, Page } from "playwright";
import { projectPaths, projectDir } from "../store/project.js";
import { join } from "node:path";
import { mkdir, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";

interface Session {
  context: BrowserContext;
  page: Page;
  slug: string;
}

const sessions = new Map<string, Session>();

export async function openSession(slug: string): Promise<Session> {
  const existing = sessions.get(slug);
  if (existing) return existing;

  const paths = projectPaths(slug);
  await migrateLegacyBrowserData(slug, paths.browserDataDir);
  await mkdir(paths.browserDataDir, { recursive: true });
  await mkdir(paths.screenshotsDir, { recursive: true });

  // No HAR recording — we never read the file and on long runs every
  // request gets buffered in-memory until context.close(), which on a
  // chatty site can balloon to tens of GB. Screenshots + observations
  // are enough audit trail.
  //
  // The Chromium flags below cap on-disk caches and V8 heap so a long
  // agent run doesn't drift into multi-GB territory.
  const context = await chromium.launchPersistentContext(paths.browserDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disk-cache-size=52428800", // 50 MB
      "--media-cache-size=52428800", // 50 MB
      "--js-flags=--max-old-space-size=2048", // cap each V8 heap at 2 GB
    ],
  });

  let page: Page;
  const existingPages = context.pages();
  if (existingPages.length > 0) {
    page = existingPages[0]!;
  } else {
    page = await context.newPage();
  }

  const session: Session = { context, page, slug };
  sessions.set(slug, session);

  context.on("close", () => {
    sessions.delete(slug);
  });

  return session;
}

export function getSession(slug: string): Session | undefined {
  return sessions.get(slug);
}

export async function getOrOpen(slug: string): Promise<Session> {
  return sessions.get(slug) ?? openSession(slug);
}

export async function closeSession(slug: string): Promise<void> {
  const s = sessions.get(slug);
  if (!s) return;
  await s.context.close();
  sessions.delete(slug);
}

export async function activePage(slug: string): Promise<Page> {
  const s = await getOrOpen(slug);
  if (s.page.isClosed()) {
    const pages = s.context.pages();
    s.page = pages.find((p) => !p.isClosed()) ?? (await s.context.newPage());
  }
  return s.page;
}

export function screenshotPath(slug: string, label: string): string {
  const safe = label.replace(/[^a-z0-9-]/gi, "_").slice(0, 60);
  const ts = Date.now();
  return join(projectPaths(slug).screenshotsDir, `${ts}-${safe}.png`);
}

/**
 * One-time migration: distilr used to keep Chromium's user-data-dir
 * inside `projects/<slug>/browser-data/`. It now lives in the OS
 * cache location (~/Library/Caches/distilr/<slug>/browser-data on
 * macOS, etc.). For projects created before that change, move the
 * old directory to the new location so the user keeps their session
 * cookies. Idempotent — only fires when the legacy path exists AND
 * the new path doesn't yet.
 */
async function migrateLegacyBrowserData(
  slug: string,
  newPath: string,
): Promise<void> {
  const legacy = join(projectDir(slug), "browser-data");
  if (!existsSync(legacy)) return;
  if (existsSync(newPath)) {
    const entries = await readdir(newPath).catch(() => [] as string[]);
    if (entries.length > 0) return; // new location already populated
  }
  await mkdir(join(newPath, ".."), { recursive: true });
  try {
    await rename(legacy, newPath);
  } catch {
    // rename across filesystems can fail; we accept the loss-of-cookies
    // gracefully (a fresh login is the worst case) and let the new
    // location start clean.
  }
}
