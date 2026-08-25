"use client";

import { useEffect, useState } from "react";
import type { BoldActivityContact, BoldSendRecipient } from "@clientforce/core";
import { avTint, contactName, fetchBoldRecipients, fetchContactTimeline, initials, relTime } from "./bold-live";

/**
 * The Bold right drawer (392px, slides in over the canvas — prototype
 * `overOpen` shell) with the three B1 variants: a stat breakdown (isNum), the
 * sent-to-N recipients subset (isGrp), and the contact peek (isPerson,
 * timeline from the shipped /contacts/:id/timeline read). The full contact
 * detail surface is B3 — this peek only reads.
 */

export type BoldDrawerState =
  | { t: "num"; label: string; v: string; read: string; breakLabel: string; rows: Array<{ n: string; v: string; w: number; c: string }> }
  | { t: "grp"; agentId: string; label: string; name: string; stepNodeId: string | null; day: string }
  | { t: "person"; contact: BoldActivityContact };

const GRP_ST: Record<string, [string, string, string, string]> = {
  replied: ["Replied", "var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
  booked: ["Booked", "var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
  opened: ["Opened", "var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)"],
  delivered: ["Delivered", "var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"],
  sent: ["Sent", "var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"],
};
const GRP_ORDER: Record<string, number> = { replied: 0, booked: 1, opened: 2, delivered: 3, sent: 4 };

const TL_TONES: Record<string, [string, string, string, string]> = {
  goal: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)", "◷"],
  won: ["#e4f3e9", "#c3e2cf", "#0e5c2b", "✓"],
  reply: ["var(--cvb-cyan-tint)", "var(--cvb-cyan-line)", "var(--cvb-cyan)", "↩"],
  send: ["var(--cvb-well)", "var(--cvb-line-ctl)", "var(--cvb-faint)", "➤"],
};
function timelineTone(type: string): [string, string, string, string] {
  if (type === "lead.stage_changed.v1" || type.startsWith("calendar.")) return TL_TONES.goal!;
  if (type === "payment.received.v1" || type.startsWith("proposal.")) return TL_TONES.won!;
  if (type.endsWith(".replied.v1")) return TL_TONES.reply!;
  return TL_TONES.send!;
}
/** Factual line per raw timeline event type — data words, no narrative. */
function timelineLine(type: string, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (type === "lead.stage_changed.v1")
    return typeof p.label === "string" && p.label ? p.label : `Stage → ${String(p.toStage ?? "?")}`;
  if (type === "payment.received.v1") return "Payment received.";
  if (type.endsWith(".replied.v1")) return `Replied${typeof p.intent === "string" ? ` — ${p.intent.replace(/_/g, " ")}` : ""}.`;
  if (type.endsWith(".opened.v1")) return "Opened the message.";
  if (type.endsWith(".delivered.v1")) return "Message delivered.";
  if (type === "lead.enrolled.v1") return "Enrolled in the campaign.";
  if (type === "lead.unsubscribed.v1") return "Unsubscribed.";
  return type.replace(/\.v\d+$/, "").replace(/[._]/g, " ");
}

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

export function BoldDrawer({ state, onClose }: { state: BoldDrawerState; onClose: () => void }) {
  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,.14)", display: "flex", justifyContent: "flex-end", zIndex: 6 }}
      onClick={onClose}
    >
      <div
        data-testid="bold-drawer"
        style={{
          width: 392,
          maxWidth: "88%",
          height: "100%",
          background: "var(--cvb-card)",
          borderLeft: "1px solid var(--cvb-line)",
          padding: "30px 28px",
          overflowY: "auto",
          animation: "cvb-over .32s var(--cvb-ease) both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {state.t === "num" ? <NumBody state={state} onClose={onClose} /> : null}
        {state.t === "grp" ? <GrpBody state={state} onClose={onClose} /> : null}
        {state.t === "person" ? <PersonBody state={state} onClose={onClose} /> : null}
      </div>
    </div>
  );
}

function Closer({ onClose }: { onClose: () => void }) {
  return (
    <span
      role="button"
      aria-label="Close"
      onClick={onClose}
      style={{
        width: 32,
        height: 32,
        borderRadius: 11,
        border: "1px solid var(--cvb-line-ctl)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--cvb-muted)",
        fontSize: 13,
        cursor: "pointer",
        flex: "none",
      }}
    >
      ✕
    </span>
  );
}

function NumBody({ state, onClose }: { state: Extract<BoldDrawerState, { t: "num" }>; onClose: () => void }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>{state.label}</div>
          <div className="cvb-display" style={{ fontWeight: 900, fontSize: 32, letterSpacing: "-.034em", lineHeight: 1, marginTop: 10 }}>
            {state.v}
          </div>
        </div>
        <Closer onClose={onClose} />
      </div>
      <div style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, marginTop: 14 }}>{state.read}</div>
      <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)", marginBottom: 14 }}>{state.breakLabel}</div>
      {state.rows.map((r) => (
        <div key={r.n} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, flex: 1, letterSpacing: "-.014em" }}>{r.n}</span>
            <span style={{ ...mono, fontSize: 10.5, color: "var(--cvb-muted)" }}>{r.v}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--cvb-line-inner)", overflow: "hidden" }}>
            <span
              style={{
                display: "block",
                height: 6,
                width: `${Math.max(0, Math.min(100, r.w))}%`,
                background: r.c,
                borderRadius: 3,
                transformOrigin: "left",
                animation: "cvb-grow .55s var(--cvb-ease) both",
              }}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function GrpBody({ state, onClose }: { state: Extract<BoldDrawerState, { t: "grp" }>; onClose: () => void }) {
  const [recipients, setRecipients] = useState<BoldSendRecipient[] | null>(null);
  const [sort, setSort] = useState<"status" | "age" | "name">("status");
  useEffect(() => {
    let alive = true;
    void fetchBoldRecipients(state.agentId, state.stepNodeId, state.day).then((r) => {
      if (alive) setRecipients(r?.recipients ?? []);
    });
    return () => {
      alive = false;
    };
  }, [state.agentId, state.stepNodeId, state.day]);

  const list = [...(recipients ?? [])];
  if (sort === "status") list.sort((a, b) => (GRP_ORDER[a.status] ?? 9) - (GRP_ORDER[b.status] ?? 9));
  else if (sort === "name") list.sort((a, b) => contactName(a.contact).localeCompare(contactName(b.contact)));
  else list.sort((a, b) => (a.sentAt < b.sentAt ? 1 : -1));
  const tally = new Map<string, number>();
  for (const r of list) tally.set(r.status, (tally.get(r.status) ?? 0) + 1);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>{state.label}</div>
          <div className="cvb-display" style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.03em", lineHeight: 1.2, marginTop: 6 }}>
            {state.name}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 5 }}>
            {recipients == null ? "Loading…" : `${list.length} contacts`}
          </div>
        </div>
        <Closer onClose={onClose} />
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 16 }}>
        {[...tally.entries()].map(([k, v]) => {
          const st = GRP_ST[k] ?? GRP_ST.sent!;
          return (
            <span key={k} style={{ fontSize: 10.5, fontWeight: 700, color: st[1], background: st[2], border: `1px solid ${st[3]}`, borderRadius: 999, padding: "5px 11px" }}>
              {v} {st[0]}
            </span>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 16 }}>
        {(
          [
            ["status", "By what happened"],
            ["age", "By how long ago"],
            ["name", "By name"],
          ] as const
        ).map(([k, l]) => (
          <span
            key={k}
            onClick={() => setSort(k)}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: sort === k ? "var(--cvb-card)" : "var(--cvb-muted)",
              background: sort === k ? "var(--cvb-ink)" : "var(--cvb-card)",
              border: `1px solid ${sort === k ? "var(--cvb-ink)" : "var(--cvb-line-ctl)"}`,
              borderRadius: 999,
              padding: "7px 12px",
              cursor: "pointer",
            }}
          >
            {l}
          </span>
        ))}
      </div>
      <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "18px 0 4px" }} />
      {list.map((r) => {
        const st = GRP_ST[r.status] ?? GRP_ST.sent!;
        const tint = avTint(r.contact.id);
        return (
          <div key={r.contact.id + r.sentAt} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 2px", borderBottom: "1px solid var(--cvb-line-2)" }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                flex: "none",
                background: tint.bg,
                color: tint.fg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              {initials(r.contact)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.018em" }}>{contactName(r.contact)}</div>
              <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 2, lineHeight: 1.4 }}>
                {r.contact.email ?? ""} · sent {relTime(r.sentAt)}
              </div>
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: st[1], background: st[2], border: `1px solid ${st[3]}`, borderRadius: 999, padding: "3px 9px", flex: "none" }}>
              {st[0]}
            </span>
          </div>
        );
      })}
      {recipients != null && list.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", padding: "20px 2px" }}>No recipients found for this send.</div>
      ) : null}
    </>
  );
}

function PersonBody({ state, onClose }: { state: Extract<BoldDrawerState, { t: "person" }>; onClose: () => void }) {
  const [timeline, setTimeline] = useState<Array<{ id: string; type: string; payload: unknown; occurredAt: string }> | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchContactTimeline(state.contact.id).then((r) => {
      if (alive) setTimeline(r ?? []);
    });
    return () => {
      alive = false;
    };
  }, [state.contact.id]);
  const tint = avTint(state.contact.id);

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span
          style={{
            width: 62,
            height: 62,
            borderRadius: "50%",
            flex: "none",
            background: tint.bg,
            color: tint.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 900,
          }}
        >
          {initials(state.contact)}
        </span>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 3 }}>
          <div className="cvb-display" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.03em", lineHeight: 1.15 }}>
            {contactName(state.contact)}
          </div>
          <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{state.contact.email ?? "No email on record"}</div>
        </div>
        <Closer onClose={onClose} />
      </div>
      {/* Full contact actions (call · message · lists · tags · notes) are the
          B3 contact-detail wave — this peek reads the shipped timeline only. */}
      <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
      <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)", marginBottom: 16 }}>TIMELINE</div>
      {timeline == null ? <div style={{ fontSize: 12.5, color: "var(--cvb-faint)" }}>Loading…</div> : null}
      {timeline?.map((e, i) => {
        const tone = timelineTone(e.type);
        return (
          <div key={e.id} style={{ display: "flex", gap: 13 }}>
            <div style={{ width: 26, flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 9,
                  flex: "none",
                  background: tone[0],
                  border: `1px solid ${tone[1]}`,
                  color: tone[2],
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10.5,
                }}
              >
                {tone[3]}
              </span>
              <span style={{ width: 2, flex: 1, background: "var(--cvb-line-inner)", minHeight: i === timeline.length - 1 ? 0 : 18 }} />
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 18 }}>
              <div style={{ fontSize: 13, color: "var(--cvb-ink)", lineHeight: 1.5 }}>{timelineLine(e.type, e.payload)}</div>
              <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 4 }}>{relTime(e.occurredAt)}</div>
            </div>
          </div>
        );
      })}
      {timeline != null && timeline.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--cvb-faint)" }}>Nothing recorded yet.</div>
      ) : null}
    </>
  );
}
