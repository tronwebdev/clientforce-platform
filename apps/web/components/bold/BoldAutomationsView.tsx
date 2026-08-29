"use client";

/**
 * B5 (DEC-130): the Automations surface — pure UI over the REAL engine
 * (models, triggers, executors, run ledger all shipped). The prototype's
 * table anatomy ports whole: kind-coloured spine, icon chip, name, sub,
 * mono run counter, toggle. Honest departures, flagged:
 *  - the lede drops "Ada proposes" (no automation-suggestion engine exists;
 *    the ✦ Ada's-idea chips are its fixture) — you decide what stays on;
 *  - the detail's "what keeps it safe" states the ENGINE's real guarantees
 *    (once per event, no sends from rules — the Q-039 rail, terminal-first)
 *    instead of the prototype's per-rule knobs that have no stored home.
 */
import { useCallback, useEffect, useState } from "react";
import {
  fetchAutomationRuns,
  fetchAutomations,
  toggleAutomation,
  type BoldAutomationRow,
  type BoldAutomationRunRow,
} from "./bold-live";
import { BoldMetaStrip, mono } from "./bold-cards";

/** trigger kind → [spine colour, icon glyph, plain-words "what starts it"]. */
const TRIGGER_META: Record<string, [string, string, string]> = {
  meeting_booked: ["var(--cvb-forest)", "◷", "Somebody books a slot"],
  payment_received: ["#0E5C2B", "✓", "Somebody pays"],
  reply_classified: ["#B0483A", "!", "A reply of a certain kind arrives"],
  lead_captured: ["#8B968F", "➤", "A contact arrives — form, widget or import"],
  opted_out: ["#B0483A", "✕", "Somebody opts out"],
  email_opened: ["var(--cvb-cyan,#0E7D93)", "◌", "An email is opened"],
  link_clicked: ["var(--cvb-cyan,#0E7D93)", "↗", "A link is clicked"],
  widget_chat_started: ["var(--cvb-forest)", "❋", "A site-agent chat starts"],
  sequence_quiet: ["#D9A82B", "⟳", "A finished sequence goes quiet"],
  call_knowledge_gap: ["#D9A82B", "?", "A call hits a knowledge gap"],
  meeting_rescheduled: ["#D9A82B", "⇄", "A booked meeting moves"],
  meeting_canceled: ["#B0483A", "⊘", "A booked meeting falls through"],
  before_meeting: ["var(--cvb-forest)", "◷", "A booked meeting is coming up"],
};

const ACTION_LABELS: Record<string, string> = {
  notify_team: "tell the team",
  add_tag: "tag the contact",
  set_stage: "move the stage",
  end_enrollment: "end their campaign",
  pause_enrollment: "pause their campaign",
  suppress_contact: "suppress the contact",
  send_booking_link: "carry the booking link next message",
  send_payment_link: "carry the payment link next message",
  send_webhook: "post to your endpoint",
  create_crm_deal: "create the CRM deal",
  update_deal_stage: "advance the CRM deal",
  move_to_node: "move them in the sequence",
  run_automation: "run another rule",
};

const subLine = (a: BoldAutomationRow): string => {
  const t = a.trigger ? (TRIGGER_META[a.trigger.kind]?.[2] ?? a.trigger.kind) : "Unreadable trigger";
  const acts = a.actions.map((x) => ACTION_LABELS[x.kind] ?? x.kind).join(", ");
  return `${t} → ${acts || "nothing"}.`;
};

const runLine = (a: BoldAutomationRow): string => {
  if (a.runs === 0) return "never run";
  const last = a.lastRunAt
    ? ` · last ${new Date(a.lastRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `${a.runs} run${a.runs === 1 ? "" : "s"}${last}`;
};

export function BoldAutomationsView({
  onBuild,
  onCounts,
  flash,
}: {
  onBuild: () => void;
  onCounts: (rules: number, on: number) => void;
  flash: (msg: string) => void;
}) {
  const [rows, setRows] = useState<BoldAutomationRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runs, setRuns] = useState<BoldAutomationRunRow[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetchAutomations();
    if (res) {
      setRows(res);
      onCounts(res.length, res.filter((r) => r.enabled).length);
    }
  }, [onCounts]);
  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (a: BoldAutomationRow) => {
      const res = await toggleAutomation(a.id, !a.enabled);
      if (!res.ok) {
        flash(res.error);
        return;
      }
      flash(a.enabled ? "Turned off" : "Turned on");
      void load();
    },
    [flash, load],
  );

  const open = useCallback(async (id: string) => {
    setOpenId(id);
    setRuns(null);
    const r = await fetchAutomationRuns(id);
    if (r) setRuns(r);
  }, []);

  /* ---------------------------------------------------------------- list */
  if (!openId) {
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-automations">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, flex: 1 }}>
            Rules that run without you. You decide what stays on.
          </div>
          <span onClick={onBuild} data-testid="bold-automations-build" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 12, padding: "11px 17px", cursor: "pointer", flex: "none" }}>
            New automation
          </span>
        </div>
        <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, overflow: "hidden", marginTop: 22 }}>
          {(rows ?? []).map((a, i) => {
            const [spine, icon] = a.trigger ? (TRIGGER_META[a.trigger.kind] ?? ["#8B968F", "•"]) : ["#B0483A", "!"];
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: 18, borderBottom: i === (rows?.length ?? 0) - 1 ? "none" : "1px solid var(--cvb-line-inner)" }}>
                <span style={{ width: 3, height: 38, borderRadius: 2, background: a.enabled ? spine : "var(--cvb-line-ctl)", flex: "none" }} />
                <span style={{ width: 34, height: 34, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", fontSize: 14, flex: "none" }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => void open(a.id)} data-testid={`bold-auto-row-${i}`}>
                  <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "-.02em" }}>
                    {a.name}
                    {a.invalid ? <span style={{ fontSize: 9.5, fontWeight: 700, color: "#B0483A", marginLeft: 8 }}>needs attention</span> : null}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cvb-ghost)", marginTop: 2 }}>{subLine(a)}</div>
                  <div style={{ ...mono, fontSize: 10, color: "var(--cvb-ghost)", marginTop: 5 }}>{runLine(a)}</div>
                </div>
                <span
                  onClick={() => void toggle(a)}
                  data-testid={`bold-auto-toggle-${i}`}
                  role="switch"
                  aria-checked={a.enabled}
                  style={{ width: 46, height: 28, borderRadius: 15, flex: "none", background: a.enabled ? "var(--cvb-forest)" : "var(--cvb-scrollbar)", position: "relative", cursor: "pointer" }}
                >
                  <span style={{ position: "absolute", top: 3, left: a.enabled ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.2)", transition: "left .2s cubic-bezier(.32,.72,0,1)" }} />
                </span>
              </div>
            );
          })}
          {rows && rows.length === 0 ? (
            <div style={{ padding: 22, fontSize: 12.5, color: "var(--cvb-faint)" }}>No rules yet — build the first one and it runs on the live event stream.</div>
          ) : null}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- detail */
  const a = rows?.find((r) => r.id === openId);
  if (!a) return null;
  const back = () => {
    setOpenId(null);
    void load();
  };
  return (
    <div data-testid="bold-auto-detail">
      <BoldMetaStrip
        items={[
          ["RUNS", String(a.runs), a.runs === 0 ? "never fired" : "since it went on"],
          ["STATUS", a.enabled ? "On" : "Off", a.enabled ? "watching the stream" : "stored, silent"],
          ["LAST RUN", a.lastRunAt ? new Date(a.lastRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—", a.lastRunAt ? "" : "nothing yet"],
        ]}
      />
      <div style={{ padding: "18px 40px 40px", maxWidth: 680 }}>
        <span onClick={back} data-testid="bold-auto-back" style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)" }}>
          ← All rules
        </span>
        <Section title="WHAT STARTS IT">
          <Row
            name={a.trigger ? (TRIGGER_META[a.trigger.kind]?.[2] ?? a.trigger.kind) : "This rule's trigger can't be read"}
            sub={
              a.trigger?.kind === "reply_classified"
                ? `Classified as ${(a.trigger.intents ?? []).join(" or ")}`
                : "Fires off the live event stream"
            }
            chip="Live"
          />
        </Section>
        <Section title="WHAT IT DOES">
          {a.actions.map((x, i) => (
            <Row key={i} name={ACTION_LABELS[x.kind] ?? x.kind} sub={x.tag ? `Tag: “${x.tag}”` : x.note ? x.note : x.stage ? `Stage: ${x.stage}` : "Runs the moment the trigger lands"} chip="Live" />
          ))}
        </Section>
        <Section title="WHAT KEEPS IT SAFE">
          <Row name="Once per event, ever" sub="A redelivered event can never fire it twice" chip="Built in" />
          <Row name="It can never send" sub="Messages, calls and replies stay behind the send boundary — rules flag, people and campaigns send" chip="Built in" />
          <Row name="First terminal action wins" sub="Ending, pausing or suppressing stops everything after it" chip="Built in" />
        </Section>
        <Section title="RECENT RUNS">
          {runs === null ? (
            <div style={{ padding: "12px 15px", fontSize: 12, color: "var(--cvb-ghost)" }}>Loading…</div>
          ) : runs.length === 0 ? (
            <div style={{ padding: "12px 15px", fontSize: 12, color: "var(--cvb-ghost)" }}>Never fired — the ledger starts with its first run.</div>
          ) : (
            runs.slice(0, 8).map((r) => (
              <Row key={r.id} name={r.contactLabel ?? "A contact"} sub={r.detail ?? r.status} chip={r.status === "ok" ? "OK" : r.status} />
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 8 }}>{title}</div>
      <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 14, overflow: "hidden" }}>{children}</div>
    </div>
  );
}

function Row({ name, sub, chip }: { name: string; sub: string; chip: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 15px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>{name}</div>
        <div style={{ fontSize: 11.5, color: "var(--cvb-ghost)", marginTop: 2 }}>{sub}</div>
      </div>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 8px", flex: "none" }}>{chip}</span>
    </div>
  );
}
