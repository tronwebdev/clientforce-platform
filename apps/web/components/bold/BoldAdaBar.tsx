"use client";

import type { AdaContext } from "./bold-data";

interface BoldAdaBarProps {
  ctx: AdaContext;
  onOpen: () => void;
}

/**
 * The Ada bar — pinned at the foot of the canvas column, outside the
 * scrolling content, always on screen (shell contract rule 2). Contextual per
 * surface: label, placeholder and chips change with the active surface.
 */
export function BoldAdaBar({ ctx, onOpen }: BoldAdaBarProps) {
  return (
    <div data-tour="ada" className="cvb-ada-bar" data-testid="bold-ada-bar">
      <div className="cvb-ada-pill" onClick={onOpen}>
        <span className="cvb-ada-mark">✦</span>
        <span className="cvb-ada-hint">{ctx.hint}</span>
        <span className="cvb-ada-send" aria-hidden>
          ↑
        </span>
      </div>
    </div>
  );
}

interface BoldAdaPanelProps {
  ctx: AdaContext;
  onClose: () => void;
  /** B0: the panel is chrome — a chip pick no-ops with a toast (Ada wires in B1+). */
  onNoop: () => void;
}

/** The Ada sheet rising off the bar (74% of the canvas, prototype anatomy:
 *  header → chat window → chip row; the chips are the entry point). */
export function BoldAdaPanel({ ctx, onClose, onNoop }: BoldAdaPanelProps) {
  return (
    <div className="cvb-ada-scrim" onClick={onClose}>
      <div className="cvb-ada-panel" data-testid="bold-ada-panel" onClick={(e) => e.stopPropagation()}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 11, marginBottom: 18 }}>
          <span className="cvb-ada-mark" style={{ width: 32, height: 32, borderRadius: 11, fontSize: 14 }}>
            ✦
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cvb-display" style={{ fontWeight: 900, fontSize: 16, letterSpacing: "-.026em" }}>
              Ada
            </div>
            <div style={{ fontSize: 11, color: "var(--cvb-forest)", fontWeight: 600, marginTop: 1 }}>{ctx.where}</div>
          </div>
          <span className="cvb-ada-close" role="button" aria-label="Close" onClick={onClose}>
            ✕
          </span>
        </div>
        <div className="cvb-ada-chat">
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "76%",
              background: "var(--cvb-card)",
              border: "1px solid var(--cvb-line-ctl)",
              borderRadius: 15,
              padding: "13px 16px",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "var(--cvb-ink)",
              flex: "none",
            }}
          >
            The Bold shell is up — I am wired in from the campaign console wave (B1). Until then this bar shows
            what I will offer on each page.
          </div>
        </div>
        <div className="cvb-ada-chips">
          {ctx.chips.map((c) => (
            <button key={c} type="button" className="cvb-ada-chip" onClick={onNoop}>
              {c}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
