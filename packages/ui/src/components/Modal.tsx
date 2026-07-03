"use client";

import { useRef, type ReactNode } from "react";
import { useOverlayBehavior } from "./overlay";
import { XIcon } from "./icons";

export interface ModalProps {
  open: boolean;
  onClose?: () => void;
  title: string;
  subtitle?: string;
  /** Panel width — 460 volume-modal default; the CSV modal uses 480. */
  width?: number;
  /** "bg" = #FBF7F0 volume-modal skin (default) · "surface" = white CSV skin. */
  skin?: "bg" | "surface";
  /** Footer actions; last child is pushed right (prototype anatomy). */
  footer?: ReactNode;
  children?: ReactNode;
}

/**
 * Centered modal — radius 18, white header/footer bands, body on the panel
 * skin; anatomy ported from the volume/limits editor (Campaign View).
 * Esc/scrim close, focus trap + restore per checkpoints §0.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  width = 460,
  skin = "bg",
  footer,
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useOverlayBehavior(open, onClose, panelRef);
  if (!open) return null;
  return (
    <div className="cf-overlay cf-overlay--center" onClick={onClose} data-testid="cf-modal-overlay">
      <div
        ref={panelRef}
        className={`cf-modal${skin === "surface" ? " cf-modal--surface" : ""}`}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cf-modal__header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cf-modal__title">{title}</div>
            {subtitle ? <div className="cf-modal__subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="cf-overlay__close" aria-label="Close" onClick={onClose}>
            <XIcon size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="cf-modal__body">{children}</div>
        {footer ? <div className="cf-modal__footer">{footer}</div> : null}
      </div>
    </div>
  );
}
