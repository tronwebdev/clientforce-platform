"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Shared overlay contract (checkpoints §0): Esc closes the TOPMOST layer only,
 * focus is trapped inside the panel, and focus returns to the opener on close.
 * A module-level stack tracks layer order across drawers/modals.
 */
const stack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useOverlayBehavior(
  open: boolean,
  onClose: (() => void) | undefined,
  panelRef: RefObject<HTMLDivElement | null>,
): void {
  const idRef = useRef<symbol | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = Symbol("overlay");
    idRef.current = id;
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;

    // Initial focus: the dialog container itself (tabIndex=-1) — keeps focus
    // inside the trap without flashing a focus ring on the close button.
    const panel = panelRef.current;
    panel?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (stack[stack.length - 1] !== id) return; // not the topmost layer
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key === "Tab" && panel) {
        // Focus trap: cycle within the panel.
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        if (!firstEl || !lastEl) return;
        const active = document.activeElement;
        if (e.shiftKey && (active === firstEl || !panel.contains(active))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (active === lastEl || !panel.contains(active))) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const idx = stack.indexOf(id);
      if (idx !== -1) stack.splice(idx, 1);
      opener?.focus(); // restore focus to the opener
    };
  }, [open, onClose, panelRef]);
}
