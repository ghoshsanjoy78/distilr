// Centralized color palette for the TUI. Semantically-named roles
// (accent / body / dim / success / warning / error / info / accent2)
// resolve to hex values from the Ayu theme — Ayu Dark by default, Ayu
// Light if the terminal is detected as a light-background terminal.
//
// Why hex instead of Ink's named colors ("yellow", "cyanBright", …):
// the named colors map to whatever the user's terminal theme says
// "yellow" is, which differs wildly. Hex pins us to the Ayu palette
// regardless. Truecolor terminals render exactly; older 256-color
// terminals fall back to the closest match (still on-brand).
//
// Detection order:
//   1. DISTILR_THEME env var ("dark" / "light" / "auto") — explicit override
//   2. COLORFGBG env var (most modern terminals set this)
//   3. Fallback: dark
//
// The palette is computed once at module load. If the user changes
// terminal themes mid-session, they'll need to restart distilr — which
// is fine for a CLI session.

export type ThemeMode = "dark" | "light";

export interface Palette {
  /** Brand / primary accent. Used for borders, brand title, "STAGES" header. */
  accent: string;
  /** Normal foreground for body text and high-emphasis numbers. */
  body: string;
  /** Faded / hint text. Comments-color in editor terms. */
  dim: string;
  /** Success: ✓ checkmarks, "completed" labels. */
  success: string;
  /** Warning: yellow alerts, current-stage highlights, modal borders. */
  warning: string;
  /** Error: red ✗ messages, error screen. */
  error: string;
  /** Info / secondary accent: cooler tone for navigation hints, links. */
  info: string;
  /** Tertiary accent: mint / teal for occasional highlights (e.g. selected option). */
  accent2: string;
}

// Ayu Dark — bg #0a0e14. Orange-forward warm theme.
//
// `body` is bumped to Ayu's highlight foreground (#e6e1cf) — close to
// white but with a touch of warmth so the ShimmerText interpolation
// from body→#ffffff still reads as motion. `dim` takes the value of
// the previous `body` (#b3b1ad), so secondary text is now where the
// old primary text was — a one-step lift across the whole palette.
const AYU_DARK: Palette = {
  accent: "#e6b450", // Ayu's signature orange-gold
  body: "#e6e1cf",
  dim: "#b3b1ad",
  success: "#aad94c",
  warning: "#ff8f40", // saturated orange — visually distinct from accent
  error: "#f07178",
  info: "#39bae6",
  accent2: "#95e6cb",
};

// Ayu Light — bg #fafafa. Same one-step contrast lift applied
// symmetrically: body pushes closer to black, dim takes the previous
// body value.
const AYU_LIGHT: Palette = {
  accent: "#fa8d3e",
  body: "#3a3a3a",
  dim: "#5c6166",
  success: "#86b300",
  warning: "#ed9366",
  error: "#f07171",
  info: "#399ee6",
  accent2: "#4cbf99",
};

function detectThemeMode(): ThemeMode {
  const override = (process.env.DISTILR_THEME ?? "auto").trim().toLowerCase();
  if (override === "dark") return "dark";
  if (override === "light") return "light";
  // override === "auto" or anything else → fall through to detection.

  const cfb = process.env.COLORFGBG;
  if (cfb) {
    // Format: "fg;bg" with ANSI color indices 0–15. bg = last segment.
    //   0=black, 7=white, 8=bright black, 15=bright white.
    // dark terminals: bg 0 or 8. light terminals: bg 7 or 15.
    const parts = cfb.split(";");
    const last = parts[parts.length - 1];
    const bg = last !== undefined ? parseInt(last, 10) : NaN;
    if (!Number.isNaN(bg)) {
      // 7 (white) or 15 (bright white) → light. Anything else → dark.
      if (bg === 7 || bg === 15) return "light";
      return "dark";
    }
  }
  // No signal → default to dark (the most common case).
  return "dark";
}

export const themeMode: ThemeMode = detectThemeMode();
export const colors: Palette = themeMode === "light" ? AYU_LIGHT : AYU_DARK;
