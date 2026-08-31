"use client";

import { useEffect, useState } from "react";
import type { BoldActivityContact, BoldSendRecipient, ContactListDto } from "@clientforce/core";
import {
  addContactsToList,
  avTint,
  contactName,
  dialAdaCall,
  sendConsentAsk,
  startBrowserCall,
  enrollContact,
  fetchBoldRecipients,
  fetchCallWindow,
  fetchContactTimeline,
  fetchCreditPrices,
  fetchLists,
  initials,
  money,
  patchContactFacts,
  relTime,
  type BoldContactRow,
  type CallWindowRead,
  type ContactEnrollmentRef,
  type ContactNextStep,
  type ContactSignalFact,
  type TimelineEvent,
} from "./bold-live";
import { BoldCallCard } from "./BoldCallCard";

/**
 * The Bold right drawer (392px, slides in over the canvas — prototype
 * `overOpen` shell) with the three B1 variants: a stat breakdown (isNum), the
 * sent-to-N recipients subset (isGrp), and the contact detail (isPerson).
 * B3a (DEC-112): the peek grew into the §7 detail — avatar header, the
 * actions that EXIST (Message opens their conversation in the workspace
 * inbox; + List is the live membership write), campaigns this contact is in
 * (the timeline read's additive `enrollments`), lists/custom-field facts from
 * the contacts view row when opened from the Contacts page, and the event
 * timeline. Call, tag and note editing have no shipped write path — honest
 * absence, never dead controls (Q-078).
 */

export type BoldDrawerState =
  | { t: "num"; label: string; v: string; read: string; breakLabel: string; rows: Array<{ n: string; v: string; w: number; c: string }> }
  | { t: "grp"; agentId: string; label: string; name: string; stepNodeId: string | null; day: string }
  | { t: "person"; contact: BoldActivityContact; row?: BoldContactRow };

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
  // B3c-1: the Bold voice identity — slate ☎.
  call: ["var(--cvb-slate-tint)", "var(--cvb-slate-line)", "var(--cvb-slate)", "☎"],
};
function timelineTone(type: string): [string, string, string, string] {
  if (type === "lead.stage_changed.v1" || type.startsWith("calendar.")) return TL_TONES.goal!;
  if (type === "payment.received.v1" || type.startsWith("proposal.")) return TL_TONES.won!;
  if (type.endsWith(".replied.v1")) return TL_TONES.reply!;
  if (type.startsWith("call.") || type === "contact.call_consent.v1") return TL_TONES.call!;
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
  // B3c-1: call facts — the D4 outcome words, durations where recorded.
  if (type === "call.started.v1") return p.caller === "human" ? "Team call placed." : "Ada called.";
  if (type === "call.completed.v1") {
    const outcome = typeof p.outcome === "string" ? p.outcome : "completed";
    const secs = typeof p.durationSec === "number" ? p.durationSec : null;
    const dur = secs !== null ? ` (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")})` : "";
    const word =
      outcome === "no_answer" ? "no answer" : outcome === "busy" ? "busy" : outcome === "canceled" ? "canceled" : outcome === "failed" ? "failed" : "completed";
    return `${p.caller === "human" ? "Team call" : "Ada called"} — ${word}${outcome === "completed" ? dur : ""}.`;
  }
  if (type === "call.failed.v1")
    return `${p.caller === "human" ? "Team call" : "Ada called"} — ${typeof p.reason === "string" ? p.reason.replace(/_/g, " ") : "failed"}.`;
  if (type === "call.booked.v1") return "Booked on the call.";
  if (type === "call.refused.v1")
    return `Call not placed — ${typeof p.reason === "string" ? p.reason.replace(/_/g, " ").toLowerCase() : "refused"}.`;
  if (type === "contact.call_consent.v1")
    return `Call consent set to ${typeof p.value === "string" ? p.value : "unknown"}${p.how === "reply" ? " — they said yes by message" : ""}.`;
  if (type === "approval.created.v1")
    return typeof p.reason === "string" ? p.reason : "Waiting for your approval.";
  if (type === "approval.decided.v1")
    return p.decision === "approved" ? "Approved — it went ahead." : "Dismissed.";
  if (type === "campaign.autonomy_changed.v1") {
    const word = (v: unknown) =>
      v === "ask" ? "ask first" : v === "full" ? "full autonomy" : "act inside limits";
    return `How much Ada decides changed — ${word(p.from)} to ${word(p.to)}.`;
  }
  return type.replace(/\.v\d+$/, "").replace(/[._]/g, " ");
}

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

export function BoldDrawer({
  state,
  onClose,
  flash,
  onMessage,
}: {
  state: BoldDrawerState;
  onClose: () => void;
  flash?: (msg: string) => void;
  onMessage?: (contactId: string) => void;
}) {
  return (
    <div
      // Console-wide scrim: every overlay dims the page behind it, at one
      // shared value rather than a per-surface guess.
      style={{ position: "absolute", inset: 0, background: "var(--cvb-scrim)", display: "flex", justifyContent: "flex-end", zIndex: 6 }}
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
        {state.t === "person" ? <PersonBody state={state} onClose={onClose} flash={flash} onMessage={onMessage} /> : null}
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

function PersonBody({
  state,
  onClose,
  flash,
  onMessage,
}: {
  state: Extract<BoldDrawerState, { t: "person" }>;
  onClose: () => void;
  flash?: (msg: string) => void;
  onMessage?: (contactId: string) => void;
}) {
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [enrollments, setEnrollments] = useState<ContactEnrollmentRef[]>([]);
  const [signalFacts, setSignalFacts] = useState<ContactSignalFact[]>([]);
  const [nextStep, setNextStep] = useState<ContactNextStep | null>(null);
  const [lists, setLists] = useState<ContactListDto[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const [tags, setTags] = useState<string[]>(state.row?.tags ?? []);
  // B3c-1: the Ada-call sheet + consent state.
  const [callOpen, setCallOpen] = useState(false);
  const [callWindow, setCallWindow] = useState<CallWindowRead | null>(null);
  const [browserCall, setBrowserCall] = useState<{ callId: string; sandbox: boolean; token?: string } | null>(null);
  const [humanDialing, setHumanDialing] = useState(false);
  const [consent, setConsent] = useState<string>(state.row?.callConsent ?? "unknown");
  const [voicePrice, setVoicePrice] = useState<number | null>(null);
  const [dialing, setDialing] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [note, setNote] = useState<string>(state.row?.notes ?? "");
  const [noteSaved, setNoteSaved] = useState<string>(state.row?.notes ?? "");
  useEffect(() => {
    let alive = true;
    void fetchContactTimeline(state.contact.id).then((r) => {
      if (!alive) return;
      setTimeline(r?.events ?? []);
      setEnrollments(r?.enrollments ?? []);
      setSignalFacts(r?.signalFacts ?? []);
      setNextStep(r?.nextStep ?? null);
    });
    void fetchLists().then((l) => {
      if (alive) setLists((l ?? []).filter((x) => !x.archived));
    });
    void fetchCreditPrices().then((p) => {
      if (alive) setVoicePrice(p?.effective?.voice_minute ?? null);
    });
    return () => {
      alive = false;
    };
  }, [state.contact.id]);
  const tint = avTint(state.contact.id);
  const row = state.row;

  async function addToList(list: ContactListDto) {
    setListOpen(false);
    const res = await addContactsToList(list.id, [state.contact.id]);
    if (!res.ok) {
      flash?.(res.error);
      return;
    }
    const added = (res.body as { added?: number } | null)?.added ?? 0;
    flash?.(added === 0 ? `Already in “${list.name}” — nothing to add.` : `Added to “${list.name}”.`);
  }

  // B3a review (DEC-112(7)): tags full-replace + notes on the shipped PATCH.
  async function saveTags(next: string[]) {
    const prev = tags;
    setTags(next);
    const res = await patchContactFacts(state.contact.id, { tags: next });
    if (!res.ok) {
      setTags(prev);
      flash?.(res.error);
    }
  }
  // B3b (DEC-114): the one live write the slot performs itself — the other
  // live actions hand off to the reply composer via Message.
  async function addToWinback() {
    if (!nextStep?.agentId) return;
    const res = await enrollContact(nextStep.agentId, state.contact.id, { kind: "manual" });
    if (!res.ok) {
      flash?.(res.error);
      return;
    }
    flash?.(`Added to “${nextStep.agentName ?? "the win-back campaign"}”.`);
    const r = await fetchContactTimeline(state.contact.id);
    setNextStep(r?.nextStep ?? null);
    setEnrollments(r?.enrollments ?? []);
  }

  // B3c-1 (DEC-118/119): the Ada-call sheet — window read on open (the
  // checkable claim comes from the SAME resolver the rail enforces).
  const callAgentId = enrollments.find((e) => e.agentId)?.agentId ?? null;
  // Race-proof: the window read follows whenever the sheet is open and the
  // agent id has landed (enrollments load async) — and it refreshes the
  // consent chips from the SERVER, so a reopened drawer never shows a stale
  // row value.
  useEffect(() => {
    let alive = true;
    if (callOpen && callAgentId) {
      void fetchCallWindow(callAgentId, state.contact.id).then((w) => {
        if (!alive) return;
        setCallWindow(w);
        if (w) setConsent(w.callConsent);
      });
    }
    return () => {
      alive = false;
    };
  }, [callOpen, callAgentId, state.contact.id]);
  function toggleCallSheet() {
    setCallOpen((v) => !v);
  }
  const [asking, setAsking] = useState(false);
  async function askConsent() {
    if (!callAgentId || asking) return;
    setAsking(true);
    try {
      const res = await sendConsentAsk(callAgentId, state.contact.id);
      if (!res.ok) {
        flash?.(res.error || "The ask was not sent.");
        return;
      }
      const channel = (res.body as { channel?: string })?.channel;
      flash?.(`Asked by ${channel === "sms" ? "text" : "email"} — a yes flips it automatically.`);
    } finally {
      setAsking(false);
    }
  }

  async function startHumanCall() {
    if (!callAgentId || humanDialing || browserCall) return;
    setHumanDialing(true);
    try {
      const res = await startBrowserCall(callAgentId, state.contact.id);
      if (!res.ok) {
        flash?.(res.error || "The call was refused.");
        return;
      }
      const body = res.body as { callId: string; sandbox: boolean; token?: string };
      setBrowserCall({ callId: body.callId, sandbox: body.sandbox, ...(body.token ? { token: body.token } : {}) });
    } finally {
      setHumanDialing(false);
    }
  }

  async function queueAdaCall() {
    if (!callAgentId || dialing) return;
    setDialing(true);
    try {
      const res = await dialAdaCall(callAgentId, state.contact.id, "best_time");
      if (!res.ok) {
        flash?.(res.error);
        return;
      }
      const body = res.body as { queued?: boolean; scheduledAt?: string } | null;
      if (body?.queued && body.scheduledAt) {
        const at = new Date(body.scheduledAt);
        const tz = callWindow?.window.timezone;
        // The time renders in the CONTACT's zone it is labeled with — a
        // viewer-local time under their zone label would be a false claim.
        let when: string;
        try {
          when = at.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
        } catch {
          when = at.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
        }
        flash?.(`Queued — Ada calls ${when}${tz ? ` (${tz})` : ""}.`);
      } else {
        flash?.("Ada is calling now.");
      }
      setCallOpen(false);
    } finally {
      setDialing(false);
    }
  }
  async function setCallConsent(value: "granted" | "denied" | "unknown") {
    const prev = consent;
    setConsent(value);
    const res = await patchContactFacts(state.contact.id, { callConsent: value });
    if (!res.ok) {
      setConsent(prev);
      flash?.(res.error);
      return;
    }
    flash?.(value === "granted" ? "Ada may call them now." : value === "denied" ? "Ada will not call them." : "Call permission cleared.");
  }

  async function saveNote() {
    const trimmed = note.trim();
    if (trimmed === noteSaved.trim()) return;
    const res = await patchContactFacts(state.contact.id, { notes: trimmed || null });
    if (!res.ok) {
      flash?.(res.error);
      return;
    }
    setNoteSaved(trimmed);
    flash?.("Saved.");
  }

  // B3a: the factual segment pill — derived from the latest enrollment's
  // stage, exactly the contacts page's derivation (DEC-112): won = Customer,
  // booked = Booked, anything else = Prospect.
  const seg = row ? (row.unsub ? "Unsubscribed" : row.stage === "won" ? "Customer" : row.stage === "booked" ? "Booked" : "Prospect") : null;
  const segTone: Record<string, [string, string, string]> = {
    Customer: ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"],
    Booked: ["var(--cvb-cyan)", "var(--cvb-cyan-tint)", "var(--cvb-cyan-line)"],
    Prospect: ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"],
    Unsubscribed: ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce"],
  };
  const st = seg ? segTone[seg]! : null;

  const metaLine = [row?.company, state.contact.email ?? row?.email, row?.phone].filter(Boolean).join(" · ");

  const sectionLabel = (l: string) => (
    <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)", marginBottom: 12 }}>{l}</div>
  );

  return (
    <>
      {/* §7: the avatar header row (must — it went missing twice). */}
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
          <div className="cvb-display" style={{ fontWeight: 900, fontSize: 20, letterSpacing: "-.03em", lineHeight: 1.15 }} data-testid="bold-person-name">
            {contactName(state.contact)}
          </div>
          <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>{metaLine || "No email on record"}</div>
          {st ? (
            <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, color: st[0], background: st[1], border: `1px solid ${st[2]}`, borderRadius: 999, padding: "3px 10px", marginTop: 8 }}>
              {seg}
            </span>
          ) : null}
        </div>
        <Closer onClose={onClose} />
      </div>

      {/* Live actions first; Call and Book render visibly deferred — every
          prototype element is built or shown as coming, never dropped
          silently (owner ruling, B3a review). */}
      <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
        {onMessage ? (
          <span
            onClick={() => onMessage(state.contact.id)}
            data-testid="bold-person-message"
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 11, padding: "9px 13px", cursor: "pointer" }}
          >
            ✉ Message
          </span>
        ) : null}
        <span style={{ position: "relative" }}>
          <span
            onClick={() => setListOpen((v) => !v)}
            data-testid="bold-person-addlist"
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--cvb-cyan)", background: "var(--cvb-cyan-tint)", border: "1px solid var(--cvb-cyan-line)", borderRadius: 11, padding: "9px 13px", cursor: "pointer" }}
          >
            ＋ List
          </span>
          {listOpen ? (
            <span style={{ position: "absolute", left: 0, top: "100%", marginTop: 5, width: 200, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 5, zIndex: 5, boxShadow: "var(--cvb-shadow-card)", display: "block" }}>
              {lists.map((l) => (
                <span key={l.id} onClick={() => void addToList(l)} style={{ display: "block", padding: "9px 10px", borderRadius: 9, cursor: "pointer", fontSize: 12.5, fontWeight: 500 }}>
                  {l.name}
                  <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginLeft: 6 }}>{l.memberCount}</span>
                </span>
              ))}
              {lists.length === 0 ? <span style={{ display: "block", padding: "9px 10px", fontSize: 12, color: "var(--cvb-faint)" }}>No lists yet.</span> : null}
            </span>
          ) : null}
        </span>
        {/* B3c-1 (DEC-118): the Call action goes LIVE — Ada places the
            call through the one dial rail; Book stays visibly deferred. */}
        <span
          onClick={toggleCallSheet}
          data-testid="bold-person-call"
          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--cvb-slate)", background: "var(--cvb-slate-tint)", border: "1px solid var(--cvb-slate-line)", borderRadius: 11, padding: "9px 13px", cursor: "pointer" }}
        >
          ☎ Call
        </span>
        <span
          data-testid="bold-person-book"
          title="Coming soon"
          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 700, color: "var(--cvb-faint)", background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 11, padding: "9px 13px", cursor: "default" }}
        >
          ◷ Book
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--cvb-ghost)" }}>Coming soon</span>
        </span>
      </div>

      {/* The Ada-call sheet: consent-honest, with the checkable best-time
          window (its SOURCE named) and the live per-minute price. */}
      {callOpen ? (
        <div data-testid="bold-person-callsheet" style={{ marginTop: 12, background: "var(--cvb-panel)", border: "1px solid var(--cvb-slate-line)", borderRadius: 13, padding: "13px 15px" }}>
          {!callAgentId ? (
            <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.5 }}>
              No campaign to call from yet — add them to a campaign first.
            </div>
          ) : consent !== "granted" ? (
            <div data-testid="bold-person-call-blocked" style={{ fontSize: 12.5, color: "var(--cvb-amber)", lineHeight: 1.5 }}>
              {row
                ? "Ada only calls people who said yes. Set call permission below and this opens up."
                : "Ada only calls people who said yes. Set call permission from their contact page."}
              {callAgentId ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: "var(--cvb-muted)", flex: 1, lineHeight: 1.45 }}>
                    Or have Ada ask them — a yes by message flips it.
                  </span>
                  <span
                    onClick={() => void askConsent()}
                    data-testid="bold-person-consent-ask"
                    style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: asking ? "var(--cvb-ghost)" : "var(--cvb-forest)", borderRadius: 10, padding: "7px 12px", cursor: "pointer", flex: "none" }}
                  >
                    {asking ? "Sending…" : "Ask them"}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.016em" }}>Ada picks the best time</div>
              <div data-testid="bold-person-call-window" style={{ ...mono, fontSize: 10, color: "var(--cvb-muted)", marginTop: 6, lineHeight: 1.5 }}>
                {callWindow
                  ? `${callWindow.window.start < callWindow.window.floorStart ? callWindow.window.floorStart : callWindow.window.start}–${
                      callWindow.window.end > callWindow.window.floorEnd ? callWindow.window.floorEnd : callWindow.window.end
                    } · ${callWindow.window.timezone} (${
                      callWindow.window.source === "contact"
                        ? "their saved timezone"
                        : callWindow.window.source === "calendar"
                          ? "from their booking"
                          : "campaign time"
                    })${callWindow.window.source !== "campaign" ? " · inside campaign hours" : ""}`
                  : "Reading the calling window…"}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", flex: 1 }}>
                  {/* B7 review fix 1: the set rate, honest about when it bills —
                      nothing but lead reveals draws down credits yet (Q-108),
                      and the credits page says the same thing. */}
                  {voicePrice != null
                    ? `${voicePrice} credit${voicePrice === 1 ? "" : "s"} / minute — the set rate; minutes don't draw down credits yet`
                    : ""}
                </span>
                <span
                  onClick={() => {
                    if (!callWindow) return; // never a live button on an unread window
                    void queueAdaCall();
                  }}
                  data-testid="bold-person-call-queue"
                  style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: callWindow ? "var(--cvb-forest)" : "var(--cvb-ghost)", borderRadius: 10, padding: "8px 13px", cursor: callWindow ? "pointer" : "default", flex: "none", opacity: dialing ? 0.6 : 1 }}
                >
                  {dialing ? "Queueing…" : callWindow?.insideNow ? "Call now" : "Queue the call"}
                </span>
              </div>
            </>
          )}
          {callAgentId ? (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--cvb-line-ctl)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 12, color: "var(--cvb-muted)", lineHeight: 1.45, flex: 1 }}>
                Or call them yourself — your mic, through the business line.
              </span>
              <span
                onClick={() => void startHumanCall()}
                data-testid="bold-person-call-human"
                style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-slate)", background: "var(--cvb-slate-tint)", border: "1px solid var(--cvb-slate-line)", borderRadius: 10, padding: "8px 13px", cursor: "pointer", flex: "none", opacity: humanDialing || browserCall ? 0.6 : 1 }}
              >
                {humanDialing ? "Connecting…" : "Call now"}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {browserCall ? (
        <BoldCallCard
          callId={browserCall.callId}
          contactName={contactName(state.contact)}
          sandbox={browserCall.sandbox}
          {...(browserCall.token ? { token: browserCall.token } : {})}
          flash={(m) => flash?.(m)}
          onDone={() => setBrowserCall(null)}
        />
      ) : null}

      {/* Call permission (DEC-118(2)) — every flip lands provenance on the
          timeline. Unknown = Ada may not call; humans key off DNC (B3c-2). */}
      {row ? (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-faint)", flex: "none" }}>CALLS</span>
          {(
            [
              ["granted", "They said yes"],
              ["unknown", "Not asked"],
              ["denied", "Declined"],
            ] as const
          ).map(([v, label]) => {
            const on = consent === v;
            const tone =
              v === "granted"
                ? ["var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)"]
                : v === "denied"
                  ? ["var(--cvb-danger)", "var(--cvb-danger-bg)", "#f0d5ce"]
                  : ["var(--cvb-muted)", "var(--cvb-well)", "var(--cvb-line-ctl)"];
            return (
              <span
                key={v}
                onClick={() => void setCallConsent(v)}
                data-testid={`bold-person-consent-${v}`}
                style={{ fontSize: 11, fontWeight: 700, color: on ? tone[0] : "var(--cvb-faint)", background: on ? tone[1] : "transparent", border: `1px solid ${on ? tone[2] : "var(--cvb-line-ctl)"}`, borderRadius: 999, padding: "5px 11px", cursor: "pointer" }}
              >
                {label}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* B3b (DEC-114): the next-best-action slot, LIVE — the server's
          five-rule table decides; provenance renders beside the action; a
          rule whose action is not shipped shows visibly deferred (DEC-115);
          when no rule fires the slot renders NOTHING — never a generic
          button. */}
      {nextStep ? (
        <div data-testid="bold-person-nextstep" style={{ marginTop: 14, background: "var(--cvb-panel)", border: `1px ${nextStep.live ? "solid" : "dashed"} var(--cvb-line-ctl)`, borderRadius: 13, padding: "11px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-faint)", flex: "none" }}>NEXT STEP</span>
          <span data-testid="bold-person-nextstep-why" style={{ ...mono, fontSize: 10, color: "var(--cvb-muted)", flex: 1, minWidth: 90 }}>{nextStep.provenance}</span>
          {nextStep.live ? (
            <span
              onClick={() => {
                if (nextStep.key === "add_winback") void addToWinback();
                else onMessage?.(state.contact.id);
              }}
              data-testid="bold-person-nextstep-go"
              style={{ fontSize: 12, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 10, padding: "8px 13px", cursor: "pointer", flex: "none" }}
            >
              {nextStep.label}
            </span>
          ) : (
            <span data-testid="bold-person-nextstep-deferred" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-faint)", flex: "none" }}>
              {nextStep.label} — coming soon
            </span>
          )}
        </div>
      ) : null}

      {/* §7 tags + notes — live writes on the shipped contact PATCH
          (B3a review). Ada's compose-time read of notes is not built yet
          (Q-079) — the placeholder wording is the owner's ruling. */}
      {row ? (
        <>
          <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
          {sectionLabel("TAGS")}
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            {tags.map((t) => (
              <span
                key={t}
                data-testid={`bold-person-tag-${t}`}
                style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "var(--cvb-muted)", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 999, padding: "5px 11px" }}
              >
                {t}
                <span
                  onClick={() => void saveTags(tags.filter((x) => x !== t))}
                  data-testid={`bold-person-tag-remove-${t}`}
                  style={{ fontSize: 10, color: "var(--cvb-faint)", cursor: "pointer" }}
                >
                  ✕
                </span>
              </span>
            ))}
            {tagOpen ? (
              <input
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const t = tagDraft.trim();
                    setTagDraft("");
                    setTagOpen(false);
                    if (t && !tags.includes(t)) void saveTags([...tags, t]);
                  }
                  if (e.key === "Escape") {
                    setTagDraft("");
                    setTagOpen(false);
                  }
                }}
                onBlur={() => {
                  setTagDraft("");
                  setTagOpen(false);
                }}
                placeholder="Tag name"
                data-testid="bold-person-tag-input"
                style={{ width: 110, fontSize: 11.5, border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "5px 11px", background: "var(--cvb-card)", color: "var(--cvb-ink)", outline: "none" }}
              />
            ) : (
              <span
                onClick={() => setTagOpen(true)}
                data-testid="bold-person-tag-add"
                style={{ fontSize: 11, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "5px 11px", cursor: "pointer" }}
              >
                + tag
              </span>
            )}
          </div>

          <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
          {sectionLabel("NOTES")}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void saveNote()}
            placeholder="Anything Ada should know — she reads these before she writes."
            data-testid="bold-person-notes"
            rows={3}
            style={{ width: "100%", fontSize: 13, lineHeight: 1.5, border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: "12px 14px", background: "var(--cvb-panel)", color: "var(--cvb-ink)", outline: "none", resize: "vertical", fontFamily: "inherit" }}
          />
        </>
      ) : null}

      {/* §7: campaigns this contact is in — the additive enrollments read. */}
      {enrollments.length > 0 ? (
        <>
          <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
          {sectionLabel("CAMPAIGNS")}
          {enrollments.map((e) => (
            <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0" }} data-testid={`bold-person-camp-${e.id}`}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", flex: "none", background: e.status === "ACTIVE" ? "var(--cvb-forest)" : "var(--cvb-ghost)" }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, letterSpacing: "-.016em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.agentName ?? e.campaignName ?? "A campaign"}
              </span>
              <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", flex: "none" }}>
                {e.stage}
                {e.status !== "ACTIVE" ? ` · ${e.status.toLowerCase()}` : ""}
              </span>
            </div>
          ))}
        </>
      ) : null}

      {/* Facts from the contacts-view row (Contacts-page opens only). */}
      {row ? (
        <>
          <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
          {sectionLabel("DETAILS")}
          {[
            ["Phone", row.phone],
            ["Source", row.source],
            ["Email check", row.emailVerdict],
            ["Lists", row.lists.length > 0 ? row.lists.map((l) => l.name).join(" · ") : null],
            ...Object.entries(row.custom).map(([k, v]) => [k, v == null ? null : String(v)] as [string, string | null]),
          ]
            .filter((r): r is [string, string] => Boolean(r[1]))
            .map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0" }}>
                <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", flex: "none", minWidth: 80 }}>{k.toUpperCase()}</span>
                <span style={{ fontSize: 12.5, color: "var(--cvb-ink)", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
              </div>
            ))}
          {row.valueEstCents != null && row.goal && (row.stage === "booked" || row.stage === "won") ? (
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "5px 0" }}>
              <span style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", flex: "none", minWidth: 80 }}>POTENTIAL</span>
              <span style={{ fontSize: 12.5, color: "var(--cvb-forest)", fontWeight: 700 }}>
                {money(row.valueEstCents)} — the campaign’s per-win estimate, not a payment
              </span>
            </div>
          ) : null}
        </>
      ) : null}

      <div style={{ height: 1, background: "var(--cvb-line-inner)", margin: "22px 0" }} />
      {sectionLabel("TIMELINE")}
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

      {/* ✦ footer — the B2.6 sweep condition THIS contact meets, dates and
          counts only (shared signal vocabulary, DEC-112(7)); absent when no
          condition holds. Priority mirrors the sweep order. */}
      {(() => {
        const order = ["winback_stalled", "quiet_contacts", "collect_reviews"];
        const fact = order.map((k) => signalFacts.find((f) => f.signal === k)).find(Boolean);
        if (!fact) return null;
        const line =
          fact.signal === "winback_stalled"
            ? `Said not now ${relTime(fact.at)} — Ada flags replies like this for a win-back.`
            : fact.signal === "quiet_contacts"
              ? `Quiet for ${fact.days} days — Ada flags contacts like this for a re-open.`
              : `Booked ${relTime(fact.at)} — Ada flags outcomes like this for a review ask.`;
        return (
          <div
            data-testid="bold-person-ada"
            style={{ display: "flex", alignItems: "flex-start", gap: 9, background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 13, padding: "12px 14px", marginTop: 8 }}
          >
            <span style={{ color: "var(--cvb-forest)", fontSize: 12, flex: "none" }}>✦</span>
            <span style={{ fontSize: 12.5, color: "var(--cvb-forest)", lineHeight: 1.5 }}>{line}</span>
          </div>
        );
      })()}
    </>
  );
}
