"use client";

/**
 * B5 (DEC-130): the prototype's shared card-grid chassis (vCards) — segment
 * pills + cover-band cards — used by Forms and Proposals. Anatomy per the
 * extraction: 150px cover with a cycling gradient, mono kind eyebrow, the
 * LIVE dot badge, 900-weight title; foot = status pill · value · who line.
 */
import type { ReactNode } from "react";

export const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

export const CARD_COVERS: ReadonlyArray<[string, string]> = [
  ["linear-gradient(150deg,#0C2A1B,#0A1524)", "#fff"], // DARK
  ["linear-gradient(150deg,#EAF5EE,#CFE8D8)", "var(--cvb-ink,#101613)"], // MINT
  ["linear-gradient(150deg,#E2F3F6,#BFE3EB)", "var(--cvb-ink,#101613)"], // SKY
  ["linear-gradient(150deg,#F7EFDA,#EFE0BC)", "var(--cvb-ink,#101613)"], // SAND
  ["linear-gradient(150deg,#F0EDF9,#DCD5EF)", "var(--cvb-ink,#101613)"], // PLUM
];

export const ST_PILL: Record<string, [string, string, string]> = {
  live: ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
  draft: ["var(--cvb-faint)", "var(--cvb-panel)", "var(--cvb-line-ctl)"],
  warn: ["#8A6D1A", "#F7EFDA", "#EAD9A8"],
};

export function BoldSegRow({
  segments,
  active,
  onPick,
  cta,
  onCta,
  ctaTestId,
}: {
  segments: string[];
  active: string;
  onPick: (s: string) => void;
  cta: string;
  onCta: () => void;
  ctaTestId?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      {segments.map((s) => {
        const on = s === active;
        return (
          <span
            key={s}
            onClick={() => onPick(s)}
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              padding: "9px 16px",
              borderRadius: 11,
              cursor: "pointer",
              background: on ? "var(--cvb-ink,#101613)" : "var(--cvb-panel)",
              color: on ? "#fff" : "var(--cvb-faint)",
              border: `1px solid ${on ? "var(--cvb-ink,#101613)" : "var(--cvb-line-ctl)"}`,
            }}
          >
            {s}
          </span>
        );
      })}
      <span style={{ flex: 1 }} />
      <span
        onClick={onCta}
        data-testid={ctaTestId}
        style={{
          fontSize: 12.5,
          fontWeight: 800,
          color: "#fff",
          background: "var(--cvb-forest)",
          borderRadius: 12,
          padding: "11px 17px",
          cursor: "pointer",
        }}
      >
        {cta}
      </span>
    </div>
  );
}

export function BoldCoverCard({
  index,
  kind,
  title,
  live,
  pillTone,
  pillText,
  value,
  who,
  onOpen,
  testId,
}: {
  index: number;
  kind: string;
  title: string;
  live?: boolean;
  pillTone: keyof typeof ST_PILL | string;
  pillText: string;
  value: ReactNode;
  who: string;
  onOpen?: () => void;
  testId?: string;
}) {
  const [bg, fg] = CARD_COVERS[index % CARD_COVERS.length]!;
  const [pf, pb, pd] = ST_PILL[pillTone] ?? ST_PILL.draft!;
  return (
    <div
      onClick={onOpen}
      data-testid={testId}
      style={{
        border: "1px solid var(--cvb-line)",
        borderRadius: 20,
        overflow: "hidden",
        background: "var(--cvb-card)",
        cursor: onOpen ? "pointer" : "default",
      }}
    >
      <div
        style={{
          height: 150,
          background: bg,
          padding: 20,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <span
            style={{
              ...mono,
              fontSize: 9,
              letterSpacing: ".16em",
              color: fg,
              opacity: 0.75,
              flex: 1,
            }}
          >
            {kind}
          </span>
          {live ? (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(255,255,255,.9)",
                borderRadius: 999,
                padding: "3px 9px",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--cvb-forest)",
                }}
              />
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--cvb-forest)" }}>LIVE</span>
            </span>
          ) : null}
        </div>
        <div
          style={{
            marginTop: "auto",
            fontFamily: "var(--cvb-font-display)",
            fontWeight: 900,
            fontSize: 20,
            letterSpacing: "-.03em",
            color: fg,
          }}
        >
          {title}
        </div>
      </div>
      <div style={{ padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: pf,
              background: pb,
              border: `1px solid ${pd}`,
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            {pillText}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontFamily: "var(--cvb-font-display)", fontWeight: 900, fontSize: 16 }}>
            {value}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--cvb-ghost)",
            marginTop: 10,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {who}
        </div>
      </div>
    </div>
  );
}

export function BoldCardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(236px,1fr))",
        gap: 16,
        marginTop: 22,
      }}
    >
      {children}
    </div>
  );
}

/** The detail meta strip — label / value / sub triplets on a panel band. */
export function BoldMetaStrip({ items }: { items: Array<[string, string, string, string?]> }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 34,
        padding: "12px 40px",
        background: "var(--cvb-panel)",
        borderTop: "1px solid var(--cvb-line-inner)",
        borderBottom: "1px solid var(--cvb-line-inner)",
        flexWrap: "wrap",
      }}
    >
      {items.map(([label, value, sub, color]) => (
        <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{ ...mono, fontSize: 8.5, letterSpacing: ".14em", color: "var(--cvb-faint)" }}
          >
            {label}
          </span>
          <span
            style={{
              fontFamily: "var(--cvb-font-display)",
              fontWeight: 900,
              fontSize: 15,
              color: color ?? "var(--cvb-ink,#101613)",
            }}
          >
            {value}
          </span>
          <span style={{ ...mono, fontSize: 9, color: "var(--cvb-ghost)" }}>{sub}</span>
        </div>
      ))}
    </div>
  );
}
