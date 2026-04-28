// Two-column picker for "this side OR that side" buckets. Used by
// stage 6 (wizard) to triage features into must-have vs nice-to-have.
//
// Keyboard:
//   ↑ / ↓     — move cursor within the active column
//   ← / →     — switch active column (cursor lands at the
//               visually-aligned row, clamped to the column's length)
//   space     — move the highlighted item to the OTHER column.
//               Blocked (with a one-line error) if doing so would
//               exceed the active maxLeft.
//   enter     — confirm. If left is below minLeft (or empty), a
//               nested confirm asks before resolving.
//   esc       — cancel (rejects the modal).

import React, { useState, useMemo, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import Spinner from "ink-spinner";
import { colors } from "../../colors.js";
import { ShimmerText } from "../ShimmerText.js";

export interface DualListItem {
  id: string;
  label: string;
  side: "left" | "right";
  meta?: string;
  reasoning?: string;
}

interface DualListPromptProps {
  question: string;
  description?: string;
  leftLabel: string;
  rightLabel: string;
  items: DualListItem[];
  maxLeft?: number;
  minLeft?: number;
  /**
   * When true, renders read-only and ignores keyboard input. The
   * parent (the wizard, via the bus) is streaming classifications
   * into `items` live; once it's done it flips this off and the
   * user takes over.
   */
  loading?: boolean;
  /** Banner text rendered while `loading` is true. */
  loadingMessage?: string;
  onSubmit: (answer: { leftIds: string[]; rightIds: string[] }) => void;
}

export function DualListPrompt({
  question,
  description,
  leftLabel,
  rightLabel,
  items: initialItems,
  maxLeft,
  minLeft,
  loading,
  loadingMessage,
  onSubmit,
}: DualListPromptProps) {
  const [items, setItems] = useState<DualListItem[]>(initialItems);
  const [cursor, setCursor] = useState<{ side: "left" | "right"; index: number }>(
    () => ({ side: initialItems[0]?.side ?? "left", index: 0 }),
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingEmpty, setConfirmingEmpty] = useState(false);

  // While the parent is streaming classifications in, mirror its
  // `items` prop into local state so the columns update live. Once
  // `loading` flips false, the parent stops pushing updates and we
  // own the items array (the user starts moving things around).
  useEffect(() => {
    if (loading) setItems(initialItems);
  }, [initialItems, loading]);

  const left = useMemo(() => items.filter((i) => i.side === "left"), [items]);
  const right = useMemo(() => items.filter((i) => i.side === "right"), [items]);
  const activeList = cursor.side === "left" ? left : right;

  // Clamp cursor index whenever the active column shrinks.
  const safeIdx = Math.min(cursor.index, Math.max(0, activeList.length - 1));
  const highlighted = activeList[safeIdx];

  function moveCursor(delta: number) {
    if (activeList.length === 0) return;
    const next = (safeIdx + delta + activeList.length) % activeList.length;
    setCursor({ side: cursor.side, index: next });
    setError(null);
  }

  function switchColumn(toSide: "left" | "right") {
    const targetList = toSide === "left" ? left : right;
    if (targetList.length === 0) return;
    const next = Math.min(safeIdx, targetList.length - 1);
    setCursor({ side: toSide, index: next });
    setError(null);
  }

  function moveItemToOtherSide() {
    if (!highlighted) return;
    const targetSide = highlighted.side === "left" ? "right" : "left";
    if (targetSide === "left" && maxLeft !== undefined && left.length >= maxLeft) {
      setError(`To keep the MVP scoped, ${leftLabel} is limited to ${maxLeft}. Move something out first.`);
      return;
    }
    setItems((prev) =>
      prev.map((it) => (it.id === highlighted.id ? { ...it, side: targetSide } : it)),
    );
    // Keep the cursor on the SAME item — which is now in the other
    // column. Recompute its index in the destination list.
    const newDest = items
      .map((it) => (it.id === highlighted.id ? { ...it, side: targetSide } : it))
      .filter((it) => it.side === targetSide);
    const newIdx = newDest.findIndex((it) => it.id === highlighted.id);
    setCursor({ side: targetSide, index: newIdx >= 0 ? newIdx : 0 });
    setError(null);
  }

  function attemptSubmit() {
    if (minLeft !== undefined && left.length < minLeft) {
      setConfirmingEmpty(true);
      return;
    }
    if (left.length === 0) {
      setConfirmingEmpty(true);
      return;
    }
    finalize();
  }

  function finalize() {
    onSubmit({
      leftIds: items.filter((i) => i.side === "left").map((i) => i.id),
      rightIds: items.filter((i) => i.side === "right").map((i) => i.id),
    });
  }

  useInput((input, key) => {
    // Block all input while streaming classifications in. Esc still
    // bubbles up to the global handler, which respects modal state
    // — but here we explicitly ignore everything else so the user
    // can't move items mid-stream.
    if (loading) return;
    if (confirmingEmpty) {
      if (input === "y" || input === "Y") {
        finalize();
        return;
      }
      if (input === "n" || input === "N" || key.escape) {
        setConfirmingEmpty(false);
        return;
      }
      return;
    }

    if (key.upArrow) {
      moveCursor(-1);
      return;
    }
    if (key.downArrow) {
      moveCursor(1);
      return;
    }
    if (key.leftArrow) {
      switchColumn("left");
      return;
    }
    if (key.rightArrow) {
      switchColumn("right");
      return;
    }
    if (input === " ") {
      moveItemToOtherSide();
      return;
    }
    if (key.return) {
      attemptSubmit();
      return;
    }
    // Esc handled by the parent app's modal-cancel path.
  });

  // Render
  const PAGE = 12;
  const renderColumn = (
    list: DualListItem[],
    side: "left" | "right",
    headerLabel: string,
    headerColor: string,
    countSuffix: string,
    width: number,
  ) => {
    const isActive = cursor.side === side;
    const start = isActive
      ? Math.max(0, Math.min(safeIdx - PAGE + 3, list.length - PAGE))
      : 0;
    const end = Math.min(list.length, start + PAGE);
    const slice = list.slice(start, end);

    return (
      <Box flexDirection="column" width={width} marginRight={1}>
        <Text color={headerColor} bold>
          {headerLabel} {countSuffix}
        </Text>
        <Text color={colors.dim}>{"─".repeat(Math.max(10, width - 2))}</Text>
        {list.length === 0 ? (
          <Text color={colors.dim}>(empty)</Text>
        ) : (
          slice.map((it, i) => {
            const realIdx = start + i;
            const isCursor = isActive && realIdx === safeIdx;
            return (
              <Text
                key={it.id}
                color={
                  isCursor
                    ? colors.accent
                    : side === "left"
                      ? colors.body
                      : colors.dim
                }
                bold={isCursor}
                wrap="truncate-end"
              >
                {isCursor ? "▸ " : "  "}
                {it.label}
              </Text>
            );
          })
        )}
        {start > 0 ? (
          <Text color={colors.dim}>  ↑ {start} more above</Text>
        ) : null}
        {end < list.length ? (
          <Text color={colors.dim}>  ↓ {list.length - end} more below</Text>
        ) : null}
      </Box>
    );
  };

  // Equal-ish widths; let Ink wrap if terminal is too narrow.
  const colWidth = 38;

  // `description` is rendered ABOVE the modal box by MainPane, not
  // here — keeps the boxed area focused on the columns + actions.
  void description;

  return (
    <Box flexDirection="column">
      <Text bold color={colors.accent}>
        {question}
      </Text>

      <Box marginTop={1} flexDirection="row">
        {renderColumn(
          left,
          "left",
          leftLabel,
          colors.accent,
          `(${left.length})`,
          colWidth,
        )}
        {renderColumn(
          right,
          "right",
          rightLabel,
          colors.body,
          `(${right.length})`,
          colWidth,
        )}
      </Box>

      {/* Highlighted-feature footer — full untruncated name + reasoning + meta.
          Label and reasoning render in colors.warning (orange) so they read
          as the "active" content the user is judging. The `why:` prefix
          flips back to colors.accent2 (mint/teal) so it visually punctuates
          the body without competing with it. */}
      {highlighted ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={colors.warning} wrap="wrap" bold>
            {highlighted.label}
          </Text>
          {highlighted.reasoning ? (
            <Text color={colors.warning} wrap="wrap">
              <Text color={colors.accent2} bold>
                why:{" "}
              </Text>
              {highlighted.reasoning}
            </Text>
          ) : null}
          {highlighted.meta ? (
            <Text color={colors.dim}>{highlighted.meta}</Text>
          ) : null}
        </Box>
      ) : null}

      {/* Loading banner / error / confirm-empty / hint */}
      <Box marginTop={1}>
        {loading ? (
          <>
            <Text color={colors.warning}>
              <Spinner type="dots" />
            </Text>
            <Text> </Text>
            <ShimmerText
              text={`${loadingMessage ?? "Pre-classifying features"}…`}
              bold
            />
          </>
        ) : confirmingEmpty ? (
          <Text color={colors.warning} bold>
            {leftLabel} list is empty — stage 9 will have nothing to build. Continue? [y / n]
          </Text>
        ) : error ? (
          <Text color={colors.error}>{error}</Text>
        ) : (
          <Text color={colors.body}>
            ↑↓ navigate · ←→ switch column · space move · enter confirm · esc cancel
          </Text>
        )}
      </Box>
    </Box>
  );
}
