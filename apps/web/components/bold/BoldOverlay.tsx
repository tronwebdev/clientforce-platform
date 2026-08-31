"use client";

/**
 * B6.5 (DEC-154): the console-wide overlay rail — any open popover or sheet
 * dims the page behind it, and a click on the dim closes it.
 *
 * Two things made this a primitive rather than three more inline divs:
 *
 *  1. `.cvb-canvas` sets `will-change: transform` and `overflow: hidden`
 *     (apps/web/app/bold/bold.css). Both make it a containing block, so a
 *     scrim written `position: fixed; inset: 0` INSIDE the canvas covers the
 *     canvas, not the page — every existing bold overlay has this bug, and
 *     the anchored panels are clipped at the canvas edge as well. Portalling
 *     to `document.body` is the only way out of it.
 *  2. Anchored panels must be measured at runtime, never positioned with
 *     hard-coded offsets (the BoldTour precedent). Once portalled they are
 *     positioned from the trigger's own rect, so they follow the trigger
 *     through resizes and scrolls instead of drifting.
 *
 * Scope note: this wave applies it to the Lead finder's own overlays. The
 * ruling is console-wide and the other surfaces adopt it as they are
 * touched — sweeping them here would collide with a parallel session.
 */
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * The ruled scrim: one z-layer below the panel, click-to-close.
 *
 * B7.5 landed `--cvb-scrim` in `packages/theme` as the console-wide token for
 * exactly this value, so that is the source and the literal here is only the
 * fallback for a surface rendered outside the theme.
 */
export const SCRIM_COLOR = "var(--cvb-scrim, rgba(16,22,19,.26))";
const SCRIM_Z = 2000;
const PANEL_Z = 2001;

type Align = "left" | "right";

export function BoldOverlay({
  open,
  onClose,
  anchorRef,
  align = "right",
  width,
  maxHeight = 560,
  testId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The control the panel hangs from. Measured, never assumed. */
  anchorRef: RefObject<HTMLElement | null>;
  align?: Align;
  width: number;
  maxHeight?: number;
  testId?: string;
  children: ReactNode;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (el) setRect(el.getBoundingClientRect());
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open || !rect) return null;

  // Keep the panel on screen: it hangs under the trigger, flipping above it
  // when there is no room below, and never runs off either edge.
  const gap = 8;
  const below = window.innerHeight - rect.bottom - gap;
  const flip = below < Math.min(maxHeight, 260) && rect.top > below;
  const top = flip ? Math.max(8, rect.top - gap - maxHeight) : rect.bottom + gap;
  const rawLeft = align === "right" ? rect.right - width : rect.left;
  const left = Math.max(8, Math.min(rawLeft, window.innerWidth - width - 8));

  return createPortal(
    <>
      <div
        data-testid={testId ? `${testId}-scrim` : "bold-overlay-scrim"}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: SCRIM_COLOR, zIndex: SCRIM_Z, cursor: "default" }}
      />
      <div
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top,
          left,
          width,
          maxHeight,
          overflowY: "auto",
          zIndex: PANEL_Z,
          background: "var(--cvb-card,#fff)",
          border: "1px solid var(--cvb-line,#E4E6E5)",
          borderRadius: 18,
          padding: "15px 16px",
          textAlign: "left",
          boxShadow: "0 1px 2px rgba(16,22,19,.05), 0 26px 52px -22px rgba(16,22,19,.34)",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}

/**
 * A right-hand sheet under the same rail — same scrim, same close behaviour,
 * full height rather than anchored.
 */
export function BoldSheet({
  open,
  onClose,
  width = 420,
  testId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  width?: number;
  testId?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted || !open) return null;
  return createPortal(
    <>
      <div
        data-testid={testId ? `${testId}-scrim` : "bold-sheet-scrim"}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: SCRIM_COLOR, zIndex: SCRIM_Z, cursor: "default" }}
      />
      <div
        data-testid={testId}
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width,
          maxWidth: "92vw",
          overflowY: "auto",
          zIndex: PANEL_Z,
          background: "var(--cvb-card,#fff)",
          borderLeft: "1px solid var(--cvb-line,#E4E6E5)",
          boxShadow: "-26px 0 52px -22px rgba(16,22,19,.34)",
        }}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
