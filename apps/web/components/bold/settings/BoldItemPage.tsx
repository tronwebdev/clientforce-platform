"use client";

/**
 * The shared item-page anatomy (SURFACE_SPEC_SETTINGS §4).
 *
 * All four `ws:*` pages are THIS component with different data. B7 hand-rolled
 * four near-copies that drifted apart within one unit; the layout living in one
 * place is what stops the Team page growing a stat strip the Senders page
 * doesn't have.
 *
 * Top to bottom: back + kind eyebrow + title + status pill · three stats whose
 * value colour carries meaning · tab row · the active tab's rows · the add
 * button that opens the right drawer · the ✦ note derived from THIS page's
 * data · the mono record line.
 */
import type { ReactNode } from "react";
import { mono, BoldMetaStrip } from "../bold-cards";
import { AdaNote, CHIP, EYEBROW, RecordLine } from "../bold-settings-kit";

export interface ItemStat {
  label: string;
  value: string;
  sub: string;
  /** forest = good · amber = needs you · ink = neutral. */
  tone?: "forest" | "amber" | "ink";
}

const TONE: Record<string, string> = {
  forest: "var(--cvb-forest)",
  amber: "var(--cvb-amber)",
  ink: "var(--cvb-ink,#101613)",
};

export function BoldItemPage({
  kind,
  title,
  status,
  stats,
  tabs,
  tab,
  onTab,
  onBack,
  children,
  ada,
  recordId,
  testid,
}: {
  kind: string;
  title: string;
  status?: { label: string; tone: "live" | "warn" | "mute" } | null;
  stats: ItemStat[];
  tabs: string[];
  tab: number;
  onTab: (i: number) => void;
  onBack: () => void;
  children: ReactNode;
  ada: { note: string | null; actionLabel?: string; onAct?: () => void };
  recordId: string | null;
  testid: string;
}) {
  return (
    <div data-testid={testid}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 40px 14px", flexWrap: "wrap" }}>
        <span
          onClick={onBack}
          role="button"
          data-testid="bold-wss-back"
          style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)", cursor: "pointer", flex: "none" }}
        >
          ← Settings
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={EYEBROW}>{kind}</div>
          <div
            className="cvb-display"
            style={{ fontWeight: 900, fontSize: 27, letterSpacing: "-.036em", marginTop: 6, lineHeight: 1.1 }}
          >
            {title}
          </div>
        </div>
        {status ? (
          <span style={status.tone === "live" ? CHIP.live : status.tone === "warn" ? CHIP.warn : CHIP.mute}>
            {status.label}
          </span>
        ) : null}
      </div>

      <BoldMetaStrip items={stats.map((s) => [s.label, s.value, s.sub, TONE[s.tone ?? "ink"]!])} />

      <div
        style={{
          display: "flex",
          gap: 22,
          padding: "22px 40px 0",
          borderBottom: "1px solid var(--cvb-line-inner)",
          flexWrap: "wrap",
        }}
      >
        {tabs.map((l, i) => (
          <span
            key={l}
            onClick={() => onTab(i)}
            role="tab"
            aria-selected={tab === i}
            data-testid={`bold-wss-tab-${i}`}
            style={{
              fontSize: 14,
              fontWeight: tab === i ? 800 : 500,
              letterSpacing: "-.018em",
              color: tab === i ? "var(--cvb-ink,#101613)" : "var(--cvb-faint)",
              paddingBottom: 13,
              marginBottom: -1,
              borderBottom: `2px solid ${tab === i ? "var(--cvb-forest)" : "transparent"}`,
              cursor: "pointer",
            }}
          >
            {l}
          </span>
        ))}
      </div>

      <div style={{ padding: "22px 40px 40px" }}>
        {children}
        <AdaNote note={ada.note} actionLabel={ada.actionLabel} onAct={ada.onAct} />
        {recordId ? <RecordLine id={recordId} /> : null}
      </div>
    </div>
  );
}

/** An empty tab still owes the reader a reason. */
export function EmptyTab({ line, testid }: { line: string; testid?: string }) {
  return (
    <div data-testid={testid} style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6, padding: "6px 0" }}>
      {line}
    </div>
  );
}

/** A plain explanatory line under a tab's rows — used for stated absences. */
export function TabNote({ children }: { children: ReactNode }) {
  return (
    <div style={{ ...mono, fontSize: 10, letterSpacing: ".1em", color: "var(--cvb-faint)", lineHeight: 1.7, marginTop: 16 }}>
      {children}
    </div>
  );
}
