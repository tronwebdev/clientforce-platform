"use client";

import { useRef, type ReactNode } from "react";
import { useOverlayBehavior } from "./overlay";
import { XIcon } from "./icons";

export type DrawerWidth = 460 | 480 | 500;

export interface AppDrawerProps {
  open: boolean;
  onClose?: () => void;
  /** Prototype variants: 460 lead drawer · 480 manual-add · 500 sender detail. */
  width?: DrawerWidth;
  title: string;
  subtitle?: string;
  /** Extra header content (pills, actions) rendered before the close button. */
  headerExtra?: ReactNode;
  children?: ReactNode;
}

/**
 * Right-slide drawer over a fixed scrim — panel bg #FBF7F0, white header band,
 * width/shadow pairs lifted verbatim from the prototypes (C1 plan).
 * Esc/scrim close, focus trap + restore per checkpoints §0.
 */
export function AppDrawer({
  open,
  onClose,
  width = 460,
  title,
  subtitle,
  headerExtra,
  children,
}: AppDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useOverlayBehavior(open, onClose, panelRef);
  if (!open) return null;
  return (
    <div className="cf-overlay" onClick={onClose} data-testid="cf-drawer-overlay">
      <div
        ref={panelRef}
        className={`cf-drawer cf-drawer--${width}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cf-drawer__header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cf-drawer__title">{title}</div>
            {subtitle ? <div className="cf-drawer__subtitle">{subtitle}</div> : null}
          </div>
          {headerExtra}
          <button type="button" className="cf-overlay__close" aria-label="Close" onClick={onClose}>
            <XIcon size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="cf-drawer__body">{children}</div>
      </div>
    </div>
  );
}
