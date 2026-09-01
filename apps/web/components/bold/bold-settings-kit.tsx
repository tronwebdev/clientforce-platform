"use client";

/**
 * Console Bold — the settings surface kit (SURFACE_SPEC_SETTINGS §2 and §4).
 *
 * Two things live here, and they are the reason this unit exists at all:
 *
 *  1. **The containers the prototype uses, and only those.** A right-hand
 *     drawer for the ADDFLOW wizards and the sender drawer; a centred modal
 *     for the buy flow and the workspace switcher; and inline editing in the
 *     row for everything else — which is what the prototype actually does for
 *     every facts/who/gaps row and every `val` row.
 *
 *     B7.5 built to a different rule ("every add and edit opens the drawer,
 *     no inline forms, no modals"), which the owner has since withdrawn in
 *     favour of the prototype's own idiom. The standing rule now: the
 *     prototype governs how a thing LOOKS AND BEHAVES; it does not govern
 *     whether a shipped capability EXISTS. Match the idiom, never delete a
 *     working function because the prototype has no path for it.
 *  2. **The style contract, in one place.** Two-layer elevation, panel
 *     gradients, recessed wells, console radii and the scrim that dims the
 *     page behind every overlay. Written once so the four item pages and the
 *     credits surface cannot drift from each other.
 *
 * The drawer portals to the document body on purpose. The console canvas is a
 * `will-change: transform` containing block, so a scrim rendered inside it
 * dims the canvas and leaves the rail and dock bright — which is not what
 * "dims the page behind it" means. Portalling puts the scrim over the whole
 * console, matching the prototype's own overlays.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { mono } from "./bold-cards";

/* ------------------------------------------------------------ style atoms */

export const SURFACE = {
  /** Raised card: panel gradient + the two-layer elevation. */
  card: {
    background: "var(--cvb-gradient-panel)",
    border: "1px solid var(--cvb-line-ctl)",
    borderRadius: 20,
    boxShadow: "var(--cvb-shadow-two-layer)",
  } as CSSProperties,
  /** Quiet card: flat, hairline only — structure without lift. */
  quiet: {
    background: "var(--cvb-panel-quiet)",
    border: "1px solid var(--cvb-line)",
    borderRadius: 18,
  } as CSSProperties,
  /** Inputs are recessed wells, never more white boxes. */
  well: {
    background: "var(--cvb-well-fill-2)",
    border: "1px solid var(--cvb-well-line-2)",
    boxShadow: "var(--cvb-shadow-well)",
    borderRadius: 14,
    color: "var(--cvb-ink)",
    outline: "none",
  } as CSSProperties,
} as const;

export const chipStyle = (fg: string, bg: string, bd: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 700,
  color: fg,
  background: bg,
  border: `1px solid ${bd}`,
  borderRadius: 999,
  padding: "3px 9px",
  flex: "none",
  whiteSpace: "nowrap",
});

/** The colour roles, as chips. Forest is not the only voice. */
export const CHIP = {
  live: chipStyle("var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"),
  warn: chipStyle("var(--cvb-amber)", "var(--cvb-amber-bg)", "var(--cvb-amber-line)"),
  cyan: chipStyle("var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)"),
  mute: chipStyle("var(--cvb-muted)", "var(--cvb-panel)", "var(--cvb-line-ctl)"),
  danger: chipStyle("var(--cvb-danger)", "var(--cvb-danger-bg)", "#ecd2cb"),
} as const;

export const EYEBROW: CSSProperties = {
  ...mono,
  fontSize: 9.5,
  letterSpacing: ".18em",
  color: "var(--cvb-faint)",
};

/* ------------------------------------------------------------------ atoms */

export function Well({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  testid,
  autoFocus,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  testid?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  const shared: CSSProperties = {
    ...SURFACE.well,
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 14px",
    fontSize: 13.5,
    fontFamily: "var(--cvb-font-ui)",
    lineHeight: 1.5,
  };
  return (
    <label style={{ display: "block" }}>
      <div
        style={{
          ...mono,
          fontSize: 9.5,
          letterSpacing: ".14em",
          color: "var(--cvb-faint)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          data-testid={testid}
          autoFocus={autoFocus}
          rows={4}
          style={{ ...shared, resize: "vertical" }}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && onEnter) onEnter();
          }}
          placeholder={placeholder}
          data-testid={testid}
          autoFocus={autoFocus}
          style={shared}
        />
      )}
    </label>
  );
}

/** A radio-style choice row — the shape every "which kind?" step uses. */
export function ChoiceRow({
  title,
  sub,
  meta,
  selected,
  onSelect,
  testid,
}: {
  title: string;
  sub: string;
  meta?: string;
  selected: boolean;
  onSelect: () => void;
  testid?: string;
}) {
  return (
    <div
      onClick={onSelect}
      data-testid={testid}
      role="radio"
      aria-checked={selected}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 13,
        background: selected ? "var(--cvb-mint)" : "var(--cvb-panel-quiet)",
        border: `1px solid ${selected ? "var(--cvb-mint-line)" : "var(--cvb-line)"}`,
        borderRadius: 16,
        padding: 15,
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          flex: "none",
          marginTop: 2,
          border: `2px solid ${selected ? "var(--cvb-forest)" : "#CFD6D1"}`,
          display: "grid",
          placeItems: "center",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: selected ? "var(--cvb-forest)" : "transparent",
          }}
        />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontWeight: 800,
              fontSize: 13.5,
              letterSpacing: "-.02em",
              color: selected ? "#0E3D22" : "var(--cvb-ink)",
            }}
          >
            {title}
          </span>
          {meta ? <span style={{ ...CHIP.live, fontSize: 9.5 }}>{meta}</span> : null}
        </div>
        <div
          style={{
            fontSize: 11.5,
            color: selected ? "#1D5B34" : "var(--cvb-faint)",
            lineHeight: 1.5,
            marginTop: 4,
          }}
        >
          {sub}
        </div>
      </div>
    </div>
  );
}

export function Toggle({
  on,
  onFlip,
  testid,
  label,
}: {
  on: boolean;
  onFlip: () => void;
  testid?: string;
  label: string;
}) {
  return (
    <span
      onClick={onFlip}
      data-testid={testid}
      role="switch"
      aria-checked={on}
      aria-label={label}
      style={{
        width: 44,
        height: 26,
        borderRadius: 999,
        flex: "none",
        background: on ? "var(--cvb-forest)" : "#DCDFDD",
        position: "relative",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(16,22,19,.18)",
          transition: "left .2s var(--cvb-ease)",
        }}
      />
    </span>
  );
}

export function PrimaryButton({
  label,
  onClick,
  busy,
  tone = "forest",
  testid,
}: {
  label: string;
  onClick: () => void;
  busy?: boolean;
  tone?: "forest" | "danger" | "quiet";
  testid?: string;
}) {
  const bg =
    tone === "forest"
      ? "var(--cvb-forest)"
      : tone === "danger"
        ? "var(--cvb-danger)"
        : "var(--cvb-panel)";
  const fg = tone === "quiet" ? "var(--cvb-muted)" : "#fff";
  return (
    <span
      onClick={busy ? undefined : onClick}
      data-testid={testid}
      role="button"
      aria-disabled={busy || undefined}
      style={{
        fontSize: 12.5,
        fontWeight: 800,
        color: fg,
        background: bg,
        border: tone === "quiet" ? "1px solid var(--cvb-line-ctl)" : "none",
        borderRadius: 12,
        padding: "12px 17px",
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
        boxShadow: tone === "forest" ? "var(--cvb-shadow-lift)" : "none",
        flex: "none",
      }}
    >
      {busy ? "Working…" : label}
    </span>
  );
}

/** Absence with a stated reason — the shape every gated field renders as. */
export function AbsentBecause({
  what,
  why,
  testid,
}: {
  what: string;
  why: string;
  testid?: string;
}) {
  return (
    <div
      data-testid={testid}
      style={{
        background: "var(--cvb-well-fill-2)",
        border: "1px dashed var(--cvb-line-ctl)",
        borderRadius: 14,
        padding: "13px 15px",
      }}
    >
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-muted)" }}>{what}</div>
      <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 4 }}>
        {why}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- drawer */

/**
 * The ONE right-hand drawer. Scrim dims the page, sits one z-layer below the
 * panel, and closes on click — everywhere, not per caller.
 */
/**
 * The CENTERED MODAL. A second container, not a variant of the drawer.
 *
 * The prototype uses exactly two of these inside Settings — the buy flow
 * (Console Bold.dc.html:2616) and the workspace switcher (:2836) — and its
 * atoms differ from the drawer's on purpose: 480px wide and centred rather
 * than full-height right, radius 22 not 21, a 30x30/r10 close rather than the
 * drawer's 32x32/r11, and the footer buttons sit INSIDE the card at the end of
 * the content instead of in a pinned bar.
 *
 * B7.5 put the buy flow in a right-hand drawer on a spec line the owner has
 * since withdrawn (REDO §1.1: "My spec said 'right drawer' — wrong"), which
 * left ~450px of dead space under the content. This is the container that
 * line should have described.
 */
export function SettingsModal({
  label,
  title,
  onClose,
  children,
  footer,
  testid,
  width = 480,
}: {
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testid?: string;
  width?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;

  return createPortal(
    <div
      onClick={onClose}
      data-testid="bold-settings-scrim"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--cvb-scrim)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 22,
        // Same stacking as the drawer: above the help launcher (61) and the
        // tour layer (60), or the launcher lands on the primary action.
        zIndex: 62,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        data-testid={testid ?? "bold-settings-modal"}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "100%",
          overflowY: "auto",
          background: "var(--cvb-card)",
          border: "1px solid var(--cvb-line-ctl)",
          borderRadius: 22,
          padding: 24,
          animation: "cvb-rise .3s var(--cvb-ease) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 11 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)" }}
            >
              {label}
            </div>
            <div
              className="cvb-display"
              style={{ fontWeight: 900, fontSize: 21, letterSpacing: "-.03em", marginTop: 6 }}
            >
              {title}
            </div>
          </div>
          <span
            onClick={onClose}
            role="button"
            aria-label="Close"
            data-testid="bold-modal-close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              border: "1px solid var(--cvb-line-ctl)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cvb-muted)",
              fontSize: 12,
              cursor: "pointer",
              flex: "none",
            }}
          >
            ✕
          </span>
        </div>
        {children}
        {/* Footer INSIDE the card, at the end of the content — not a pinned bar. */}
        {footer ? <div style={{ display: "flex", gap: 9, marginTop: 20 }}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export function SettingsDrawer({
  label,
  title,
  onClose,
  children,
  footer,
  testid,
  width = 424,
}: {
  label: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  testid?: string;
  width?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  if (!mounted) return null;

  return createPortal(
    <>
      <div
        onClick={onClose}
        data-testid="bold-settings-scrim"
        // Above the help launcher (61) and the tour layer (60): a modal
        // surface that something else can sit on top of is not modal, and the
        // launcher sat squarely on this drawer's primary action.
        style={{ position: "fixed", inset: 0, background: "var(--cvb-scrim)", zIndex: 62 }}
      />
      <div
        data-testid={testid ?? "bold-settings-drawer"}
        role="dialog"
        aria-label={title}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width,
          maxWidth: "92%",
          zIndex: 63,
          background: "var(--cvb-gradient-panel)",
          borderLeft: "1px solid var(--cvb-line)",
          boxShadow: "var(--cvb-shadow-two-layer)",
          borderRadius: "var(--cvb-r-drawer) 0 0 var(--cvb-r-drawer)",
          display: "flex",
          flexDirection: "column",
          animation: "cvb-over .32s var(--cvb-ease) both",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "26px 26px 16px",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={EYEBROW}>{label}</div>
            <div
              className="cvb-display"
              style={{
                fontWeight: 900,
                fontSize: 22,
                letterSpacing: "-.032em",
                marginTop: 8,
                lineHeight: 1.15,
              }}
            >
              {title}
            </div>
          </div>
          <span
            role="button"
            aria-label="Close"
            onClick={onClose}
            data-testid="bold-settings-drawer-close"
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              border: "1px solid var(--cvb-line-ctl)",
              display: "grid",
              placeItems: "center",
              color: "var(--cvb-muted)",
              fontSize: 12,
              cursor: "pointer",
              flex: "none",
            }}
          >
            ✕
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 26px 20px" }}>
          {children}
        </div>
        {footer ? (
          <div
            style={{
              flex: "none",
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "16px 26px 22px",
              borderTop: "1px solid var(--cvb-line-inner)",
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </>,
    document.body,
  );
}

/** The prompt + help line every drawer step opens with. */
export function StepPrompt({ prompt, help }: { prompt: string; help?: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.45 }}>
        {prompt}
      </div>
      {help ? (
        <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.55, marginTop: 7 }}>
          {help}
        </div>
      ) : null}
    </div>
  );
}

/** A write that failed says so, in the API's own words. */
export function DrawerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      data-testid="bold-settings-drawer-error"
      style={{
        background: "var(--cvb-danger-bg)",
        border: "1px solid #ecd2cb",
        borderRadius: 13,
        padding: "11px 13px",
        fontSize: 12.5,
        color: "var(--cvb-danger)",
        lineHeight: 1.5,
        marginTop: 14,
      }}
    >
      {message}
    </div>
  );
}

export function StepDots({ step, of }: { step: number; of: number }) {
  return (
    <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>
      {step + 1} OF {of}
    </span>
  );
}

/* -------------------------------------------------------- item-page rows */

/**
 * The 32px leading tile. The prototype tints it PER TAB, not per status
 * (Console Bold.dc.html:4724-4763): email `✉` mint, numbers `✆` cyan,
 * knowledge sources `◍`/`◫` plum, form fields `≡` grey. Rows on every other
 * tab take the generic branch at :4757 and carry NO tile — an icon there
 * would be a new deviation, not a restoration.
 */
export type RowTint = "mint" | "cyan" | "plum" | "grey";

const TINT: Record<RowTint, { bg: string; bd: string; fg: string }> = {
  mint: { bg: "var(--cvb-mint)", bd: "var(--cvb-mint-line)", fg: "var(--cvb-forest)" },
  cyan: { bg: "var(--cvb-cyan-tint)", bd: "var(--cvb-cyan-line)", fg: "var(--cvb-cyan)" },
  plum: { bg: "var(--cvb-plum-tint)", bd: "var(--cvb-plum-line)", fg: "var(--cvb-plum)" },
  grey: { bg: "var(--cvb-well)", bd: "var(--cvb-line-ctl)", fg: "var(--cvb-faint)" },
};

/** Fields every row kind may carry. */
type RowBase = {
  key: string;
  n: string;
  sub: string;
  /** Leading tile glyph. Only the four tabs above are entitled to one. */
  ic?: string;
  tint?: RowTint;
  /**
   * The sub-line IS the edit surface. In the prototype every `facts`/`who`/
   * `gaps` row and every `val` row is `isEditable`, rendering a dashed-underline
   * input in the row instead of static text (:4736-4740, :4772-4775). There is
   * no edit drawer behind these rows — this is the whole editing model.
   */
  edit?: { value: string; onChange: (v: string) => void; onCommit?: () => void; label?: string };
};

export type SettingsRow =
  | (RowBase & {
      t: "chip";
      chip: string;
      tone: keyof typeof CHIP;
      onOpen?: () => void;
    })
  | (RowBase & { t: "val"; val: string; onOpen?: () => void })
  | (RowBase & {
      t: "tg";
      on: boolean;
      onFlip: () => void;
      /** A rail the schema enforces — shown on, and honestly not flippable. */
      locked?: boolean;
    });

export function RowList({ rows, testid }: { rows: SettingsRow[]; testid?: string }) {
  return (
    <div data-testid={testid}>
      {rows.map((r, i) => {
        const last = i === rows.length - 1;
        const clickable = r.t !== "tg" && typeof r.onOpen === "function";
        const tint = r.tint ? TINT[r.tint] : null;
        return (
          <div
            key={r.key}
            data-testid={`bold-row-${r.key}`}
            onClick={clickable ? r.onOpen : undefined}
            className="cvb-settings-row"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "15px 4px",
              borderBottom: last ? "none" : "1px solid var(--cvb-line-inner)",
              // An editable row is a text field; an inert row must not look clickable.
              cursor: clickable ? "pointer" : r.edit ? "text" : "default",
            }}
          >
            {r.ic && tint ? (
              <span
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 11,
                  flex: "none",
                  background: tint.bg,
                  border: `1px solid ${tint.bd}`,
                  color: tint.fg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                }}
              >
                {r.ic}
              </span>
            ) : null}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 700,
                  letterSpacing: "-.016em",
                  lineHeight: 1.4,
                }}
              >
                {r.n}
              </div>
              {r.edit ? (
                <input
                  value={r.edit.value}
                  onChange={(e) => r.edit?.onChange(e.target.value)}
                  onBlur={() => r.edit?.onCommit?.()}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={r.edit.label ?? r.n}
                  data-testid={`bold-rowedit-${r.key}`}
                  style={{
                    width: "100%",
                    fontFamily: "var(--cvb-font-ui)",
                    fontSize: 12,
                    color: "var(--cvb-ink-soft,#3E4B44)",
                    background: "transparent",
                    border: "none",
                    borderBottom: "1px dashed var(--cvb-line-dash,#DCDFDD)",
                    outline: "none",
                    padding: "4px 0 3px",
                    marginTop: 3,
                  }}
                />
              ) : (
                <div
                  style={{
                    fontSize: 11.5,
                    color: "var(--cvb-faint)",
                    marginTop: 3,
                    lineHeight: 1.45,
                  }}
                >
                  {r.sub}
                </div>
              )}
            </div>
            {r.t === "chip" ? <span style={CHIP[r.tone]}>{r.chip}</span> : null}
            {r.t === "val" ? (
              <span style={{ ...mono, fontSize: 10.5, color: "var(--cvb-muted)", flex: "none" }}>
                {r.val}
              </span>
            ) : null}
            {r.t === "tg" ? (
              r.locked ? (
                <span style={CHIP.live}>Always on</span>
              ) : (
                <Toggle on={r.on} onFlip={r.onFlip} label={r.n} testid={`bold-tg-${r.key}`} />
              )
            ) : null}
            {/* No chevron. The prototype's row template has no such element on any
                tab — not even on the sender rows, which DO open a drawer. Rows
                signal their affordance with the cursor and the hover wash. */}
          </div>
        );
      })}
    </div>
  );
}

/** The dashed add row. Cyan, because adding is navigating into a drawer. */
export function AddRow({
  label,
  onClick,
  testid,
}: {
  label: string;
  onClick: () => void;
  testid?: string;
}) {
  return (
    <div
      onClick={onClick}
      data-testid={testid}
      role="button"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "18px 4px",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          width: 32,
          height: 32,
          borderRadius: 11,
          flex: "none",
          border: "1px dashed #CFD6D1",
          color: "var(--cvb-faint)",
          display: "grid",
          placeItems: "center",
          fontSize: 15,
        }}
      >
        +
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cvb-cyan)" }}>{label}</span>
    </div>
  );
}

/**
 * The ✦ note. It takes an observation DERIVED from the page's own data and an
 * action that performs a real write — a generic sentence here is a defect, so
 * the caller passes null when it has nothing true to say and the note simply
 * does not render.
 */
export function AdaNote({
  note,
  actionLabel,
  onAct,
  testid,
}: {
  note: string | null;
  actionLabel?: string;
  onAct?: () => void;
  testid?: string;
}) {
  if (!note) return null;
  return (
    <div
      data-testid={testid ?? "bold-ada-note"}
      style={{
        background: "var(--cvb-mint)",
        border: "1px solid var(--cvb-mint-line)",
        borderRadius: 20,
        padding: "18px 20px",
        marginTop: 28,
      }}
    >
      <div style={{ display: "flex", gap: 10 }}>
        <span style={{ color: "var(--cvb-forest)", fontSize: 13, flex: "none" }}>✦</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: "#1D5B34", lineHeight: 1.6 }}>{note}</div>
          {actionLabel && onAct ? (
            <span
              onClick={onAct}
              role="button"
              data-testid="bold-ada-note-act"
              style={{
                display: "inline-block",
                fontSize: 12.5,
                fontWeight: 800,
                color: "#fff",
                background: "var(--cvb-forest)",
                borderRadius: 12,
                padding: "11px 16px",
                marginTop: 14,
                cursor: "pointer",
              }}
            >
              {actionLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The mono record line at the foot of every item page. */
export function RecordLine({ id }: { id: string }) {
  return (
    <div
      data-testid="bold-record-line"
      style={{
        ...mono,
        fontSize: 9.5,
        letterSpacing: ".1em",
        color: "var(--cvb-ghost)",
        marginTop: 26,
      }}
    >
      {id}
    </div>
  );
}
