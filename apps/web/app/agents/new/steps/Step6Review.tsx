"use client";

/**
 * Step 6 — Preview & launch (W3-3, prototype anatomy).
 * 4-up summary cards · Lead capture card · Guardrails & compliance card ·
 * Estimated cost card (COMPUTED — never hardcoded) · balance-strip anatomy
 * carrying the build's readiness line + 🚀 Deploy agent.
 *
 * Honesty rails (DEC-073): the estimate = draft sequence composition ×
 * per-send price × the REAL audience count (scripted steps price by channel
 * from core CREDIT_PRICES; guided steps keep their Q-020 display figures —
 * the same numbers their step cards show); a voice line renders only when
 * voice steps exist (none can, this phase); AP + enrichment lines render
 * only while auto-prospecting is on, as PER-LEAD rates — prospecting volume
 * is unknowable before launch, so no fake totals; inbound is unmetered
 * ("Included"). No credits ledger exists (Q-020), so the prototype's
 * "Workspace balance" sentence is replaced by the readiness line (kept from
 * the pre-W3 build per the kickoff, logged).
 */
import { CREDIT_PRICES, GUIDED_EMAIL_CREDITS, GUIDED_SMS_CREDITS } from "@clientforce/core";
import type { CampaignGraph } from "@clientforce/core";
import { mainSteps } from "../../../../lib/graph-path";
import { GRAD, tzShort, type CaptureState } from "../shared";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** "Mon–Fri" for a contiguous run, else the on-days listed. */
function daysLabel(sendDays: boolean[]): string {
  const onIdx = sendDays.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (onIdx.length === 0) return "No days";
  if (onIdx.length === 7) return "Every day";
  const contiguous = onIdx.every((v, j) => j === 0 || v === onIdx[j - 1]! + 1);
  const names = onIdx.map((i) => DAY_LABELS[i]!);
  return contiguous && names.length > 1 ? `${names[0]}–${names[names.length - 1]}` : names.join(", ");
}
/** "09:00"/"17:00" → the prototype's "9–5" wording (12h, no meridiem). */
const h12 = (hhmm: string) => {
  const h = parseInt(hhmm, 10) || 0;
  return String(h > 12 ? h - 12 : h);
};

interface Step6Props {
  name: string;
  graph: CampaignGraph | null;
  /** W3-7: the real audience arithmetic (adds + referenced lists). */
  audienceTotal: number;
  capture: CaptureState;
  /** W3-10: capture.ap with the goal-fit default resolved. */
  apOn: boolean;
  sendDays: boolean[];
  windowStart: string;
  windowEnd: string;
  timezone: string;
  dailyCap: number;
  smsDailyCap: number;
  allResolved: boolean;
  gapTotal: number;
  gapResolved: number;
  launch: () => Promise<void>;
}

export function Step6Review(props: Step6Props) {
  const { name, graph, audienceTotal, capture, apOn, sendDays, windowStart, windowEnd, timezone, dailyCap, smsDailyCap, allResolved, gapTotal, gapResolved, launch } = props;
  const steps = graph ? mainSteps(graph) : [];
  const hasSms = steps.some((n) => n.channel === "sms");
  const channelNames = [...new Set(steps.map((n) => (n.channel === "sms" ? "SMS" : "Email")))];

  // W3-3: per-send rate per step — scripted prices by channel (CREDIT_PRICES),
  // guided steps keep the Q-020 display figure their cards already show.
  const perContact = steps.reduce(
    (acc, n) =>
      acc +
      (n.mode === "guided"
        ? n.channel === "sms"
          ? GUIDED_SMS_CREDITS
          : GUIDED_EMAIL_CREDITS
        : n.channel === "sms"
          ? CREDIT_PRICES.sms_segment
          : CREDIT_PRICES.email_send),
    0,
  );
  const outboundTotal = perContact * audienceTotal;
  const costRows: { label: string; value: string }[] = [
    { label: `Outbound sends (${channelNames.join(" · ") || "Email"})`, value: `${outboundTotal.toLocaleString()} credits` },
    // a voice line would join here if voice steps existed — the planner
    // can't emit them this phase, so none can (honest absence, W3-3)
    ...(capture.enabled && apOn
      ? [
          { label: "Auto-prospecting", value: `${CREDIT_PRICES.signal_lead} credits / found lead` },
          { label: "Lead enrichment", value: `${CREDIT_PRICES.enrichment} credits / enriched lead` },
        ]
      : []),
    { label: "Inbound forms & widgets", value: "Included" },
  ];

  const captureRows: { label: string; value: string; on: boolean }[] = [
    { label: "Auto-prospecting", value: apOn ? "On" : "Off", on: apOn },
    { label: "On-site widget", value: capture.widget ? "On — pick an asset" : "Off", on: capture.widget },
    { label: "Hosted form link", value: capture.form ? "On — pick an asset" : "Off", on: capture.form },
    { label: "Embed on website", value: capture.embed ? "On — pick an asset" : "Off", on: capture.embed },
  ];

  const guardRows: { label: string; value: string }[] = [
    { label: "Opt-out & unsubscribe handling", value: "Automatic" },
    { label: "Suppression & Do-Not-Contact", value: "Honored" },
    { label: "Sending window", value: `${daysLabel(sendDays)} · ${h12(windowStart)}–${h12(windowEnd)} ${tzShort(timezone)}` },
    { label: "Daily send limits", value: `${(dailyCap + (hasSms ? smsDailyCap : 0)).toLocaleString()} / day` },
  ];

  return (
    <div style={{ maxWidth: 820 }}>
      {/* 4-up summary — prototype card scale (radius 14 · padding 16 · 12.5/600 label · 16/700 value) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 18 }} data-testid="review-summary">
        {[
          { label: "Agent", value: name || "—" },
          { label: "Channels", value: `${channelNames.length || 1} channel${channelNames.length === 1 ? "" : "s"}` },
          { label: "Sequence", value: `${steps.length} step${steps.length === 1 ? "" : "s"}` },
          { label: "Audience", value: `${audienceTotal.toLocaleString()} contact${audienceTotal === 1 ? "" : "s"}` },
        ].map((c) => (
          <div key={c.label} style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: 16, boxShadow: "0 4px 16px rgba(14,21,18,.04)" }} data-testid={`review-tile-${c.label.toLowerCase()}`}>
            <div style={{ fontSize: 12.5, color: "#8A7F6B", fontWeight: 600, marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* lead capture */}
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: 22, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18 }} data-testid="review-capture-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Lead capture</span>
          {capture.enabled ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 8, padding: "4px 10px" }}>Enabled</span>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#8A7F6B", background: "#F2EEE4", borderRadius: 8, padding: "4px 10px" }}>Off</span>
          )}
        </div>
        {captureRows.map((c) => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #F2EEE4" }} data-testid="review-capture-row">
            <span style={{ fontSize: 14, color: "#5C6B62", flex: 1 }}>{c.label}</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: capture.enabled && c.on ? "#16A82A" : "#9AA59E" }}>{capture.enabled ? c.value : "Off"}</span>
          </div>
        ))}
      </div>

      {/* guardrails & compliance */}
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: 22, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18 }} data-testid="review-guardrails-card">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", flex: 1 }}>Guardrails &amp; compliance</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#16A82A", background: "rgba(53,232,52,.12)", borderRadius: 8, padding: "4px 10px" }}>CAN-SPAM · GDPR · CASL ✓</span>
        </div>
        {guardRows.map((g) => (
          <div key={g.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderTop: "1px solid #F2EEE4" }} data-testid="review-guardrail-row">
            <span style={{ color: "#16A82A", fontSize: 14, flex: "none" }}>✓</span>
            <span style={{ fontSize: 14, color: "#5C6B62", flex: 1 }}>{g.label}</span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#0E1512" }}>{g.value}</span>
          </div>
        ))}
      </div>

      {/* estimated cost — COMPUTED (W3-3) */}
      <div style={{ background: "#fff", border: "1px solid #EBE3D6", borderRadius: 16, padding: 22, boxShadow: "0 4px 16px rgba(14,21,18,.04)", marginBottom: 18 }} data-testid="review-cost-card">
        <div style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 700, fontSize: 17, color: "#0E1512", marginBottom: 14 }}>Estimated cost</div>
        {costRows.map((c) => (
          <div key={c.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 0", borderTop: "1px solid #F2EEE4" }} data-testid="review-cost-row">
            <span style={{ fontSize: 14, color: "#5C6B62" }}>{c.label}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0E1512" }}>{c.value}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, marginTop: 6, borderTop: "2px solid #EBE3D6" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#0E1512" }}>Total to launch</span>
          <span style={{ fontFamily: "'Bricolage Grotesque',sans-serif", fontWeight: 800, fontSize: 22, color: "#0E1512" }} data-testid="review-cost-total">{outboundTotal.toLocaleString()} <span style={{ fontSize: 14, color: "#8A7F6B", fontWeight: 600 }}>credits</span></span>
        </div>
      </div>

      {/* launch strip — prototype composition; the balance sentence is replaced
          by the readiness line (no ledger exists — Q-020), kept + logged */}
      {allResolved ? (
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(53,232,52,.07)", border: "1px solid rgba(53,232,52,.25)", borderRadius: 14, padding: "16px 20px" }} data-testid="launch-strip">
          <span style={{ fontSize: 14, color: "#5C6B62", flex: 1 }}>✓ Everything the agent needs is resolved — <strong style={{ color: "#0E1512" }}>ready to launch</strong>.</span>
          <span onClick={() => void launch()} style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: "#0A0F0C", background: GRAD, borderRadius: 12, padding: "13px 28px", boxShadow: "0 6px 18px rgba(53,232,52,.3)", cursor: "pointer", flex: "none" }} data-testid="launch-strip-deploy">🚀 Deploy agent</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(232,196,91,.12)", border: "1px solid rgba(232,196,91,.5)", borderRadius: 14, padding: "16px 20px" }} data-testid="launch-gate">
          <span style={{ fontSize: 14, color: "#5C6B62", flex: 1 }}>✦ {gapTotal - gapResolved} unresolved gap{gapTotal - gapResolved === 1 ? "" : "s"} — resolve them in step 1 (type it or let AI decide) before launching.</span>
          <span title="Resolve every gap before launching" style={{ fontFamily: "'Hanken Grotesk',sans-serif", fontWeight: 700, fontSize: 16, color: "#A99F8C", background: "#EDE8DC", borderRadius: 12, padding: "13px 28px", cursor: "default", flex: "none" }} data-testid="launch-strip-deploy-disabled">🚀 Deploy agent</span>
        </div>
      )}
    </div>
  );
}
