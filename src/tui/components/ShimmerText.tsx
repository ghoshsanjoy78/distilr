import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { colors, themeMode } from "../colors.js";

// Pre-computed gradient: every column gets a hex color based on the
// shimmer head's distance. Saves recomputing on each render — we just
// look up by index.
//
// Base = `colors.body` (warm near-white on dark theme, near-black on
// light theme). Peak = `colors.accent` (Ayu orange-gold). We use a
// SATURATED accent for the peak rather than pure white/black so the
// motion stays visible even when `body` itself is close to the
// terminal's brightness ceiling — a brightness-only sweep
// (#e6e1cf → #ffffff) is barely visible; a colored sweep
// (#e6e1cf → #e6b450) reads as motion at any base lightness.
//
// (Suppress the unused-import warning since `themeMode` is no longer
// referenced after this change.)
void themeMode;
const DIM = colors.body;
const BRIGHT = colors.accent;
const HALF_WIDTH = 4;

function interpolate(c1: string, c2: string, t: number): string {
  const r1 = parseInt(c1.slice(1, 3), 16);
  const g1 = parseInt(c1.slice(3, 5), 16);
  const b1 = parseInt(c1.slice(5, 7), 16);
  const r2 = parseInt(c2.slice(1, 3), 16);
  const g2 = parseInt(c2.slice(3, 5), 16);
  const b2 = parseInt(c2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (
    "#" +
    r.toString(16).padStart(2, "0") +
    g.toString(16).padStart(2, "0") +
    b.toString(16).padStart(2, "0")
  );
}

const FRAME_INTERVAL_MS = 90;

interface ShimmerTextProps {
  text: string;
  /** Animation pause distance past end-of-text before wrapping back to 0. */
  trailing?: number;
  bold?: boolean;
}

/**
 * Render `text` with a bright highlight that sweeps left-to-right. Each
 * character is its own <Text> with a hex color picked by distance to
 * the shimmer head. Truecolor terminals get smooth interpolation; older
 * terminals fall back to the nearest 256-color match (still readable).
 */
export function ShimmerText({
  text,
  trailing = 8,
  bold,
}: ShimmerTextProps) {
  const [head, setHead] = useState(0);
  const period = text.length + trailing;

  useEffect(() => {
    const id = setInterval(() => {
      setHead((h) => (h + 1) % period);
    }, FRAME_INTERVAL_MS);
    return () => clearInterval(id);
  }, [period]);

  return (
    <Box>
      {[...text].map((ch, i) => {
        const distance = Math.abs(head - i);
        const t = Math.max(0, 1 - distance / HALF_WIDTH);
        const color = interpolate(DIM, BRIGHT, t);
        return (
          <Text key={i} color={color} bold={bold}>
            {ch}
          </Text>
        );
      })}
    </Box>
  );
}
