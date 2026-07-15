"use client";

/**
 * Settings — wired Communication sections (checkpoints §6): Email senders,
 * Clientforce Mailer senders, Suppression list, plus the 500px sender detail
 * drawer. P5 W2 (DEC-084): the prototype's Sending-health card (ring · score
 * · week/all-time) and Warm-up schedule card are now LIVE from the W1 engine
 * (ring states = the owner-locked bands); DNS re-check is a real endpoint
 * with honest verified/failed/unchecked states + copyable expected records;
 * pause/resume is typed + audited (designed addition — the prototype footer
 * has no pause control, flagged). ISP reputation / blacklists / token expiry
 * still have no backend and stay omitted (never faked). A4: 5s polling.
 */
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { EmptyState } from "@clientforce/ui";
import {
  authPasses,
  authRows,
  BRICO,
  cf,
  ConnectFlowDrawer,
  DrawerShell,
  EnvelopeLogo,
  ErrorState,
  fmtDate,
  GRAD,
  gradBtn,
  inp,
  lbl,
  microLabel,
  ModalShell,
  PAIR,
  secondaryBtn,
  sectionHead,
  sectionSub,
  SkeletonRows,
  tableCard,
  tbodyRow,
  theadRow,
  type AuthRow,
  type Pair,
  type Sender,
} from "./shared";
import { describeSenderEvent, ringDisplay, sendingPill, warmupPill } from "./health-display";

// ── shared sender plumbing ──────────────────────────────────────────────────

function useSenders() {
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setSenders((await cf("senders")) as Sender[]);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // A4: 5s polling
    return () => clearInterval(t);
  }, [refresh]);
  return { senders, error, refresh };
}

/** Receiving-column status (SenderStatus enum → prototype vocabulary; the
 * Sending column is health-aware via `sendingPill` — DEC-084). */
const SEND_STATUS: Record<string, { label: string } & Pair> = {
  ACTIVE: { label: "Good", ...PAIR.good },
  PAUSED: { label: "Paused", ...PAIR.neutral },
  DISABLED: { label: "Needs verification", ...PAIR.warn },
};
const sendStatus = (s: Sender) => SEND_STATUS[s.status] ?? { label: s.status, ...PAIR.neutral };

/** Drawer status pill — literal enum-derived labels (spec conflict 5: derive, don't invent). */
const DETAIL_STATUS: Record<string, { label: string } & Pair> = {
  ACTIVE: { label: "Active", ...PAIR.good },
  PAUSED: { label: "Paused", ...PAIR.warn },
  DISABLED: { label: "Disabled", ...PAIR.bad },
};

const PROVIDER: Record<string, { sub: string; logo: string }> = {
  GMAIL_OAUTH: { sub: "Gmail · Google Workspace", logo: "#EA4335" },
  OUTLOOK_OAUTH: { sub: "Microsoft 365 / Outlook", logo: "#0F6CBD" },
  SMTP: { sub: "Custom SMTP / IMAP", logo: "#7A8A80" },
};

const authBadge: CSSProperties = { fontSize: 10.5, fontWeight: 700, borderRadius: 6, padding: "2px 6px" };

// ── EMAIL SENDERS (spec 2.H) ────────────────────────────────────────────────

const EMAIL_GRID = "1.7fr .85fr .85fr 1.5fr .7fr 1fr";

export function EmailSendersSection({ toast }: { toast: (m: string) => void }) {
  const { senders, error, refresh } = useSenders();
  const [flowOpen, setFlowOpen] = useState(false);
  const [drawer, setDrawer] = useState<Sender | null>(null);
  const rows = senders?.filter((s) => s.type !== "CF_MANAGED" && s.type !== "TWILIO_SMS") ?? null;

  return (
    <div data-testid="section-email">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={sectionHead}>Email senders</div>
          <div style={sectionSub}>Mailboxes your agents send from.</div>
        </div>
        <span onClick={() => setFlowOpen(true)} style={gradBtn} data-testid="connect-email">+ Connect email</span>
      </div>
      <div style={tableCard} data-testid="email-senders-table">
        <div style={theadRow(EMAIL_GRID, true)}><span>Sender</span><span>Sending</span><span>Receiving</span><span>Domain auth</span><span>Daily</span><span>ID</span></div>
        {rows === null && !error ? (
          <SkeletonRows testid="email-senders-skeleton" />
        ) : error ? (
          <ErrorState what="senders" onRetry={() => void refresh()} testid="email-senders-error" />
        ) : rows !== null && rows.length === 0 ? (
          <div data-testid="email-senders-empty">
            {/* one gradient CTA per view — the header owns it; empty state carries a secondary action */}
            <EmptyState
              kind="empty"
              title="No mailboxes connected"
              body="Connect a Gmail, Outlook or SMTP mailbox — or use the managed Clientforce Mailer — and your agents send from it."
              actions={<span onClick={() => setFlowOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>+ Connect email</span>}
            />
          </div>
        ) : (
          (rows ?? []).map((s) => {
            const sending = sendingPill(s);
            const receiving = sendStatus(s);
            const prov = PROVIDER[s.type] ?? { sub: s.type, logo: "#7A8A80" };
            return (
              <div key={s.id} onClick={() => setDrawer(s)} style={{ ...tbodyRow(EMAIL_GRID), fontSize: 13, color: "#0E1512", cursor: "pointer" }} data-testid="email-sender-row">
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: "#fff", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}><EnvelopeLogo fill={prov.logo} size={18} /></span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.fromEmail}
                      {s.type.endsWith("_OAUTH") ? <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#0F7A28", background: "#D7F5DD", borderRadius: 5, padding: "1px 6px" }}>OAuth2</span> : null}
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "#9AA59E" }}>{prov.sub}</span>
                  </span>
                </span>
                <span><span style={{ fontSize: 11.5, fontWeight: 600, color: sending.fg, background: sending.bg, borderRadius: 100, padding: "4px 9px" }} data-testid="sending-pill">{sending.label}</span></span>
                <span><span style={{ fontSize: 11.5, fontWeight: 600, color: receiving.fg, background: receiving.bg, borderRadius: 100, padding: "4px 9px" }}>{receiving.label}</span></span>
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {authRows(s).map((a) => (
                    <span key={a.key} style={{ ...authBadge, color: a.status === "verified" ? PAIR.good.fg : a.status === "failed" ? PAIR.bad.fg : PAIR.neutral.fg, background: a.status === "verified" ? PAIR.good.bg : a.status === "failed" ? PAIR.bad.bg : PAIR.neutral.bg }}>{a.key}</span>
                  ))}
                </span>
                <span style={{ color: "#5C6B62", fontSize: 12.5 }}>{s.dailyLimit.toLocaleString()} / day</span>
                <span style={{ fontFamily: "monospace", fontSize: 11.5, color: "#8A7F6B" }}>{s.id.slice(0, 8)}</span>
              </div>
            );
          })
        )}
      </div>
      {flowOpen ? <ConnectFlowDrawer channel="email" onClose={() => setFlowOpen(false)} toast={toast} onMailerCreated={refresh} /> : null}
      {drawer ? <SenderDetailDrawer sender={drawer} onClose={() => setDrawer(null)} toast={toast} onChanged={refresh} /> : null}
    </div>
  );
}

// ── SMS SENDERS (P2.1, DEC-061 — §6 amendment: the sms sender surface is LIVE) ─

const SMS_GRID = "1.5fr 1.2fr .9fr .8fr 1fr";

export function SmsSendersSection({ toast }: { toast: (m: string) => void }) {
  const { senders, error, refresh } = useSenders();
  const [flowOpen, setFlowOpen] = useState(false);
  const [drawer, setDrawer] = useState<Sender | null>(null);
  const rows = senders?.filter((s) => s.type === "TWILIO_SMS") ?? null;

  return (
    <div data-testid="section-sms">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={sectionHead}>SMS senders</div>
          <div style={sectionSub}>Twilio numbers your agents text from — STOP replies suppress automatically.</div>
        </div>
        <span onClick={() => setFlowOpen(true)} style={gradBtn} data-testid="connect-sms">+ Add SMS sender</span>
      </div>
      <div style={tableCard} data-testid="sms-senders-table">
        <div style={theadRow(SMS_GRID)}><span>Number</span><span>Label</span><span>Status</span><span>Daily</span><span>ID</span></div>
        {rows === null && !error ? (
          <SkeletonRows testid="sms-senders-skeleton" rows={2} />
        ) : error ? (
          <ErrorState what="SMS senders" onRetry={() => void refresh()} testid="sms-senders-error" />
        ) : rows !== null && rows.length === 0 ? (
          <div data-testid="sms-senders-empty">
            <EmptyState
              kind="empty"
              title="No SMS numbers connected"
              body="Connect a Twilio number + messaging service and your agents can text — sequences may then mix email and SMS steps."
              actions={<span onClick={() => setFlowOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>+ Add SMS sender</span>}
            />
          </div>
        ) : (
          (rows ?? []).map((s) => {
            const st = sendingPill(s);
            return (
              <div key={s.id} onClick={() => setDrawer(s)} style={{ ...tbodyRow(SMS_GRID), fontSize: 13, color: "#0E1512", cursor: "pointer" }} data-testid="sms-sender-row">
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ width: 30, height: 30, borderRadius: 8, flex: "none", background: "rgba(53,232,52,.12)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✆</span>
                  <span style={{ fontWeight: 600, fontFamily: "monospace", fontSize: 12.5 }}>{s.fromEmail}</span>
                </span>
                <span style={{ color: "#3B463F" }}>{s.fromName ?? "—"}</span>
                <span><span style={{ fontSize: 11.5, fontWeight: 600, color: st.fg, background: st.bg, borderRadius: 100, padding: "4px 9px" }} data-testid="sending-pill">{st.label}</span></span>
                <span style={{ color: "#5C6B62", fontSize: 12.5 }}>{s.dailyLimit.toLocaleString()} / day</span>
                <span style={{ fontFamily: "monospace", fontSize: 11.5, color: "#8A7F6B" }}>{s.id.slice(0, 8)}</span>
              </div>
            );
          })
        )}
      </div>
      {flowOpen ? <ConnectFlowDrawer channel="phone" onClose={() => setFlowOpen(false)} toast={toast} onMailerCreated={refresh} /> : null}
      {drawer ? <SenderDetailDrawer sender={drawer} onClose={() => setDrawer(null)} toast={toast} onChanged={refresh} /> : null}
    </div>
  );
}

// ── MAILER SENDERS (spec 2.I) ───────────────────────────────────────────────

const MAILER_GRID = "1.6fr 1.2fr 1fr 1.1fr 44px";

export function MailerSendersSection({ toast }: { toast: (m: string) => void }) {
  const { senders, error, refresh } = useSenders();
  const [flowOpen, setFlowOpen] = useState(false);
  const [drawer, setDrawer] = useState<Sender | null>(null);
  const rows = senders?.filter((s) => s.type === "CF_MANAGED") ?? null;

  return (
    <div data-testid="section-mailer">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={sectionHead}>
            Clientforce Mailer <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", color: "#1192A6", background: "rgba(54,215,237,.16)", borderRadius: 6, padding: "2px 7px", verticalAlign: "middle" }}>BETA</span>
          </div>
          <div style={sectionSub}>Verified from-addresses on the Clientforce mailer.</div>
        </div>
        <span onClick={() => setFlowOpen(true)} style={gradBtn} data-testid="add-mailer-sender">+ Add sender</span>
      </div>
      <div style={tableCard} data-testid="mailer-senders-table">
        <div style={theadRow(MAILER_GRID)}><span>From address</span><span>Display name</span><span>Domain</span><span>ID</span><span /></div>
        {rows === null && !error ? (
          <SkeletonRows testid="mailer-senders-skeleton" rows={2} />
        ) : error ? (
          <ErrorState what="senders" onRetry={() => void refresh()} testid="mailer-senders-error" />
        ) : rows !== null && rows.length === 0 ? (
          <div data-testid="mailer-senders-empty">
            <EmptyState
              kind="empty"
              title="No mailer senders yet"
              body="Add a verified from-address on the managed Clientforce Mailer — deliverability and warm-up are handled for you."
              actions={<span onClick={() => setFlowOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>+ Add sender</span>}
            />
          </div>
        ) : (
          (rows ?? []).map((s) => {
            const verified = authPasses(s) === 3;
            const badge = verified ? { label: "Verified", ...PAIR.good } : { label: "Pending", ...PAIR.warn };
            return (
              <div key={s.id} onClick={() => setDrawer(s)} style={{ ...tbodyRow(MAILER_GRID), fontSize: 13.5, color: "#0E1512", cursor: "pointer" }} data-testid="mailer-sender-row">
                <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.fromEmail}</span>
                <span style={{ color: "#5C6B62" }}>{s.fromName ?? "—"}</span>
                <span><span style={{ fontSize: 12, fontWeight: 600, color: badge.fg, background: badge.bg, borderRadius: 100, padding: "4px 10px" }}>{badge.label}</span></span>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "#8A7F6B" }} title={s.id}>{s.id.slice(0, 8)}</span>
                <span onClick={(e) => { e.stopPropagation(); toast("Row actions"); }} style={{ textAlign: "center", color: "#9AA59E", fontWeight: 700, cursor: "pointer" }}>⋯</span>
              </div>
            );
          })
        )}
      </div>
      {flowOpen ? <ConnectFlowDrawer channel="mailer" onClose={() => setFlowOpen(false)} toast={toast} onMailerCreated={refresh} /> : null}
      {drawer ? <SenderDetailDrawer sender={drawer} onClose={() => setDrawer(null)} toast={toast} onChanged={refresh} /> : null}
    </div>
  );
}

// ── SENDER DETAIL DRAWER (spec 3.7, 500px — the P5 cards are LIVE) ──────────

const subCard: CSSProperties = { background: "#fff", border: "1px solid #EBE3D6", borderRadius: 14, padding: "16px 18px", boxSizing: "border-box" };
const tinyLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "#9AA59E", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 2 };

/** GET /senders/:id/health — the fresh computation + the drawer-only tiles. */
interface SenderDetail {
  score: number | null;
  state: "healthy" | "unhealthy" | "low_data";
  band: "healthy" | "watch" | "at_risk" | "paused" | null;
  sample: { sent: number };
  sentAllTime: number;
  warmup: Sender["warmup"];
  domainAuthStatus: Record<string, unknown> | null;
}
interface SenderEvent { id: string; type: string; payload: Record<string, unknown>; occurredAt: string }

function SenderDetailDrawer({ sender, onClose, toast, onChanged }: { sender: Sender; onClose: () => void; toast: (m: string) => void; onChanged?: () => void | Promise<void> }) {
  const [live, setLive] = useState<Sender>(sender);
  const [detail, setDetail] = useState<SenderDetail | null>(null);
  const [activity, setActivity] = useState<SenderEvent[] | null>(null);
  const [busy, setBusy] = useState<"" | "dns" | "status" | "limit">("");
  const [limitEdit, setLimitEdit] = useState<string | null>(null);

  const isMailer = live.type === "CF_MANAGED";
  // 54-1 (review): drawer blocks gate by sender TYPE — an SMS sender has no
  // SPF/DKIM/DMARC story; its trust rails are A2P registration + the STOP
  // double rail, so the domain-auth card simply doesn't render.
  const isSms = live.type === "TWILIO_SMS";
  const prov = PROVIDER[live.type];
  const st = DETAIL_STATUS[live.status] ?? { label: live.status, ...PAIR.neutral };
  const providerChip = isMailer ? "Clientforce Mailer" : isSms ? "Twilio SMS" : (prov?.sub ?? live.type);

  const refreshDetail = useCallback(async () => {
    try {
      const d = (await cf(`senders/${sender.id}/health`)) as SenderDetail;
      setDetail(d);
      setLive((prev) => ({
        ...prev,
        warmup: d.warmup,
        domainAuthStatus: d.domainAuthStatus ?? prev.domainAuthStatus,
        health: prev.health
          ? { ...prev.health, score: d.score, state: d.state, band: d.band }
          : prev.health,
      }));
    } catch {
      /* the list snapshot stays — honest fallback, no invented freshness */
    }
  }, [sender.id]);
  const refreshActivity = useCallback(async () => {
    try {
      setActivity((await cf(`senders/${sender.id}/events`)) as SenderEvent[]);
    } catch {
      setActivity([]);
    }
  }, [sender.id]);
  useEffect(() => {
    void refreshDetail();
    void refreshActivity();
  }, [refreshDetail, refreshActivity]);

  // The ring prefers the fresh computation; the list snapshot is the fallback.
  const ring = ringDisplay(
    detail ? ({ score: detail.score, state: detail.state, band: detail.band } as Sender["health"]) : live.health,
  );
  const pct = Math.min(100, Math.round((live.sentToday / Math.max(1, live.dailyLimit)) * 100));

  async function setStatus(to: "ACTIVE" | "PAUSED") {
    if (busy) return;
    setBusy("status");
    try {
      const updated = (await cf(`senders/${sender.id}`, { method: "PATCH", body: JSON.stringify({ status: to }) })) as { status: string };
      setLive((prev) => ({ ...prev, status: updated.status }));
      await Promise.all([refreshActivity(), onChanged?.()]);
      toast(to === "PAUSED" ? "Sender paused — sends refuse until you resume" : "Sender resumed");
    } catch {
      toast("Couldn’t update the sender — try again.");
    } finally {
      setBusy("");
    }
  }
  async function saveLimit() {
    const n = Number(limitEdit);
    if (!Number.isInteger(n) || n < 1 || n > 10_000 || busy) return;
    setBusy("limit");
    try {
      const updated = (await cf(`senders/${sender.id}`, { method: "PATCH", body: JSON.stringify({ dailyLimit: n }) })) as { dailyLimit: number };
      setLive((prev) => ({ ...prev, dailyLimit: updated.dailyLimit }));
      setLimitEdit(null);
      await Promise.all([refreshDetail(), onChanged?.()]);
      toast(`Daily limit set to ${updated.dailyLimit.toLocaleString()} / day`);
    } catch {
      toast("Couldn’t update the daily limit — try again.");
    } finally {
      setBusy("");
    }
  }
  async function recheckDns() {
    if (busy) return;
    setBusy("dns");
    try {
      const res = (await cf(`senders/${sender.id}/dns-check`, { method: "POST" })) as { domainAuthStatus: Record<string, unknown> };
      setLive((prev) => ({ ...prev, domainAuthStatus: res.domainAuthStatus }));
      toast("DNS re-checked");
    } catch {
      toast("Couldn’t re-check DNS — try again.");
    } finally {
      setBusy("");
    }
  }
  function copyExpected(a: AuthRow) {
    if (!a.expected) return;
    void navigator.clipboard?.writeText(a.expected).then(
      () => toast(`${a.key} record copied — publish it at your DNS provider`),
      () => toast("Couldn’t copy — select the record text manually"),
    );
  }

  return (
    <DrawerShell width={500} title="Sender details" onClose={onClose} z={57} shadow="-28px 0 70px rgba(0,0,0,.30)" testid="sender-drawer"
      footer={
        <div style={{ background: "#fff", padding: "14px 20px", borderTop: "1px solid #EBE3D6", flex: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* pause/resume — designed addition (no prototype footer control); typed + audited via sender.status_changed.v1 */}
          {live.status !== "DISABLED" ? (
            <span
              onClick={() => void setStatus(live.status === "PAUSED" ? "ACTIVE" : "PAUSED")}
              style={{ textAlign: "center", fontSize: 14, fontWeight: 600, color: "#0E1512", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: 12, cursor: "pointer" }}
              data-testid="pause-resume-sender"
            >{busy === "status" ? "Saving…" : live.status === "PAUSED" ? "Resume sender" : "Pause sender"}</span>
          ) : null}
          <span
            onClick={() => toast("Sender removal arrives with a later phase")}
            title="Sender removal arrives with a later phase — no delete endpoint yet"
            style={{ textAlign: "center", fontSize: 13.5, fontWeight: 600, color: "#C9543F", cursor: "pointer", padding: 8 }}
            data-testid="remove-sender"
          >Remove sender</span>
        </div>
      }
    >
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* identity */}
        <div style={subCard} data-testid="sender-identity">
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: "#fff", border: "1.5px solid #EBE3D6", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", boxSizing: "border-box" }}>
              {isMailer ? (
                <div style={{ width: 28, height: 28, borderRadius: 7, background: GRAD, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: BRICO, fontWeight: 800, fontSize: 14, color: "#0A0F0C" }}>f</div>
              ) : isSms ? (
                <span style={{ width: 28, height: 28, borderRadius: 7, background: "rgba(53,232,52,.12)", color: "#16A82A", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>✆</span>
              ) : (
                <EnvelopeLogo fill={prov?.logo ?? "#7A8A80"} size={24} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0E1512", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{live.fromEmail}</div>
              <div style={{ fontSize: 12.5, color: "#9AA59E" }}>{live.fromName ?? "—"}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 700, color: st.fg, background: st.bg, borderRadius: 100, padding: "4px 11px", flex: "none" }} data-testid="sender-status-pill">{st.label}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid #F2EEE4" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#5C6B62", background: "#F2EEE4", borderRadius: 7, padding: "3px 9px" }}>{providerChip}</span>
            {live.dedicatedIp ? <span style={{ fontSize: 11, fontWeight: 700, color: "#1192A6", background: "rgba(54,215,237,.16)", borderRadius: 7, padding: "3px 9px" }}>Dedicated IP</span> : null}
          </div>
        </div>

        {/* sending health — LIVE (P5 W1 engine; ring states = the locked bands) */}
        <div style={subCard} data-testid="sender-health-card">
          <div style={{ ...microLabel, marginBottom: 13 }}>Sending health</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <div style={{ width: 58, height: 58, borderRadius: "50%", border: `4px solid ${ring.color}`, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", boxSizing: "border-box" }}>
              <span style={{ fontSize: 17, fontWeight: 800, color: ring.color }} data-testid="health-score">{ring.score}</span>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: ring.color }} data-testid="health-label">{ring.label}</div>
              <div style={{ fontSize: 12, color: "#9AA59E" }}>{ring.sub}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: BRICO, fontSize: 24, fontWeight: 800, color: "#0E1512", lineHeight: 1 }}>{live.sentToday.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "#9AA59E" }}>sends today</div>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "#5C6B62" }}>
                Daily limit
                {limitEdit === null ? (
                  <span onClick={() => setLimitEdit(String(live.dailyLimit))} title="Edit daily limit" style={{ marginLeft: 6, fontSize: 11, color: "#16A82A", cursor: "pointer", fontWeight: 600 }} data-testid="edit-daily-limit">Edit</span>
                ) : null}
              </span>
              {limitEdit === null ? (
                <span style={{ fontSize: 12, color: "#9AA59E" }}>{live.sentToday.toLocaleString()} / {live.dailyLimit.toLocaleString()}</span>
              ) : (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input value={limitEdit} onChange={(e) => setLimitEdit(e.target.value)} inputMode="numeric" style={{ ...inp, height: 28, width: 90, fontSize: 12, padding: "0 8px" }} data-testid="daily-limit-input" />
                  <span onClick={() => void saveLimit()} style={{ fontSize: 11.5, fontWeight: 700, color: "#16A82A", cursor: "pointer" }} data-testid="daily-limit-save">{busy === "limit" ? "…" : "Save"}</span>
                  <span onClick={() => setLimitEdit(null)} style={{ fontSize: 11.5, color: "#9AA59E", cursor: "pointer" }}>Cancel</span>
                </span>
              )}
            </div>
            <div style={{ height: 7, borderRadius: 100, background: "#F2EEE4", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 100, background: ring.color }} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, borderTop: "1px solid #F2EEE4", paddingTop: 12 }}>
            <div><div style={tinyLabel}>This week</div><div style={{ fontSize: 18, fontWeight: 700, color: "#0E1512", fontFamily: BRICO }} data-testid="sent-week">{detail ? detail.sample.sent.toLocaleString() : "—"}</div></div>
            <div><div style={tinyLabel}>All time</div><div style={{ fontSize: 18, fontWeight: 700, color: "#0E1512", fontFamily: BRICO }} data-testid="sent-all-time">{detail ? detail.sentAllTime.toLocaleString() : "—"}</div></div>
          </div>
        </div>

        {/* warm-up schedule — LIVE (curve v2 + the health-interlock hold) */}
        {live.warmup ? (
          <div style={subCard} data-testid="sender-warmup">
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <div style={{ ...microLabel, flex: 1 }}>Warm-up schedule</div>
              {(() => { const wp = warmupPill(live.warmup); return (
                <span style={{ fontSize: 11, fontWeight: 700, color: wp.fg, background: wp.bg, borderRadius: 100, padding: "3px 10px" }} data-testid="warmup-pill">{wp.label}</span>
              ); })()}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 13 }}>
              <div><div style={tinyLabel}>Day</div><div style={{ fontSize: 20, fontWeight: 800, color: "#0E1512", fontFamily: BRICO }}>{live.warmup.day}</div></div>
              <div><div style={tinyLabel}>Current limit</div><div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>{live.warmup.currentCap.toLocaleString()} / day</div></div>
              <div><div style={tinyLabel}>Target</div><div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>{live.warmup.target.toLocaleString()} / day</div></div>
            </div>
            <div style={{ height: 7, borderRadius: 100, background: "#F2EEE4", overflow: "hidden", marginBottom: 5 }}>
              <div style={{ height: "100%", width: `${live.warmup.pct}%`, borderRadius: 100, background: "linear-gradient(90deg,#36D7ED,#35E834)" }} />
            </div>
            <div style={{ fontSize: 11, color: "#9AA59E", textAlign: "right" }} data-testid="warmup-caption">
              Day {live.warmup.day} of {live.warmup.days}
              {live.warmup.completedAt ? " — Complete" : live.warmup.holding ? " — held (deliverability spike)" : ""}
            </div>
          </div>
        ) : null}

        {/* dedicated IP — the IP only; blacklist/reputation rows have no backend */}
        {live.dedicatedIp ? (
          <div style={subCard} data-testid="sender-dedicated-ip">
            <div style={{ ...microLabel, marginBottom: 10 }}>Dedicated IP</div>
            <div style={{ fontFamily: "monospace", fontSize: 13.5, fontWeight: 600, color: "#0E1512", background: "#F7F9F8", border: "1px solid #EBE3D6", borderRadius: 9, padding: "9px 13px" }}>{live.dedicatedIp}</div>
          </div>
        ) : null}

        {/* P2.1 (54-1): sms senders carry opt-out rails instead of DNS auth */}
        {isSms ? (
          <div style={subCard} data-testid="sender-sms-optout">
            <div style={{ ...microLabel, marginBottom: 12 }}>Opt-out compliance</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { key: "Advanced Opt-Out", detail: "Twilio messaging-service level (rail 1)" },
                { key: "STOP webhook rail", detail: "Suppression + opt-out + unenroll on STOP (rail 2)" },
                { key: "Opt-out line", detail: "\u201CReply STOP to opt out.\u201D on every first outbound" },
              ].map((a) => (
                <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#FBF7F0", borderRadius: 10 }}>
                  <span style={{ fontSize: 14, color: "#16A82A", fontWeight: 800, width: 18, textAlign: "center" }}>✓</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>{a.key}</div>
                    <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div style={subCard} data-testid="sender-domain-auth">
          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <div style={{ ...microLabel, flex: 1 }}>Domain authentication</div>
            <span
              onClick={() => void recheckDns()}
              style={{ fontSize: 12, fontWeight: 600, color: "#16A82A", cursor: "pointer" }}
              data-testid="recheck-dns"
            >{busy === "dns" ? "Checking…" : "Re-check DNS"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {authRows(live).map((a) => {
              const chip = a.status === "verified" ? { label: "Pass", ...PAIR.good } : a.status === "failed" ? { label: "Fail", ...PAIR.bad } : { label: "Unchecked", ...PAIR.warn };
              const icon = a.status === "verified" ? { glyph: "✓", color: "#16A82A" } : a.status === "failed" ? { glyph: "✕", color: "#C9543F" } : { glyph: "–", color: "#A87B16" };
              return (
                <div key={a.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#FBF7F0", borderRadius: 10 }} data-testid={`dns-row-${a.key.toLowerCase()}`}>
                  <span style={{ fontSize: 14, color: icon.color, fontWeight: 800, width: 18, textAlign: "center" }}>{icon.glyph}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0E1512" }}>{a.key}</div>
                    {a.detail ? <div style={{ fontSize: 11, color: "#9AA59E", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.detail}>{a.detail}</div> : null}
                    {a.status === "failed" && a.expected ? (
                      <div onClick={() => copyExpected(a)} style={{ fontSize: 11, fontWeight: 600, color: "#16A82A", cursor: "pointer", marginTop: 2 }} title={a.expected} data-testid={`copy-expected-${a.key.toLowerCase()}`}>⧉ Copy expected record</div>
                    ) : null}
                  </div>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: chip.fg, background: chip.bg, borderRadius: 6, padding: "2px 8px", flex: "none" }}>{chip.label}</span>
                </div>
              );
            })}
          </div>
        </div>
        )}

        {/* activity — health transitions, warm-up completion, pause/resume
            (designed addition: sender events carry no agent/campaign context,
            so the agent Logs tab can't surface them; the ledger rows land here) */}
        <div style={subCard} data-testid="sender-activity">
          <div style={{ ...microLabel, marginBottom: 12 }}>Activity</div>
          {activity === null ? (
            <div style={{ fontSize: 12.5, color: "#9AA59E" }}>Loading…</div>
          ) : (() => {
            const rows = activity
              .map((e) => ({ e, d: describeSenderEvent(e.type, e.payload) }))
              .filter((r): r is { e: SenderEvent; d: NonNullable<ReturnType<typeof describeSenderEvent>> } => r.d !== null);
            return rows.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#9AA59E" }} data-testid="activity-empty">No activity yet — health changes, warm-up milestones and pauses land here.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.slice(0, 12).map(({ e, d }) => (
                  <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#FBF7F0", borderRadius: 10 }} data-testid="activity-row">
                    <span style={{ width: 22, height: 22, borderRadius: 7, background: d.bg, color: d.fg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flex: "none" }}>{d.icon}</span>
                    <span style={{ flex: 1, fontSize: 12.5, color: "#0E1512", minWidth: 0 }}>{d.text}</span>
                    <span style={{ fontSize: 11, color: "#9AA59E", flex: "none" }}>{fmtDate(e.occurredAt)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        {/* "Used by agents" card omitted — no sender↔agent assignment model this phase */}
      </div>
    </DrawerShell>
  );
}

// ── SUPPRESSION LIST (spec 2.J — wired; columns extended per §6) ────────────

interface SuppressionRow {
  id: string;
  channel: string;
  address: string;
  reason: string;
  source: string | null;
  createdAt: string;
}

/** SuppressionReason enum → prototype pill literals ("Complaint" ↔ SPAM_COMPLAINT). */
const REASON: Record<string, { label: string } & Pair> = {
  UNSUBSCRIBED: { label: "Unsubscribed", ...PAIR.bad },
  BOUNCED: { label: "Bounced", ...PAIR.neutral },
  SPAM_COMPLAINT: { label: "Complaint", ...PAIR.warn },
  MANUAL: { label: "Manual", ...PAIR.neutral },
};
const REASON_OPTIONS = ["UNSUBSCRIBED", "BOUNCED", "SPAM_COMPLAINT", "MANUAL"] as const;

// prototype grid `2fr 1.1fr 1fr 44px` extended with Channel + Source (§6 columns)
const SUPPRESS_GRID = "2fr .8fr 1.1fr 1fr 1fr 44px";

export function SuppressionSection({ toast }: { toast: (m: string) => void }) {
  const [rows, setRows] = useState<SuppressionRow[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addReason, setAddReason] = useState<string>("UNSUBSCRIBED");
  const [reasonDD, setReasonDD] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      setRows((await cf(`suppressions${query}`)) as SuppressionRow[]);
      setError(false);
    } catch {
      setError(true);
    }
  }, [q]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000); // A4: 5s polling
    return () => clearInterval(t);
  }, [refresh]);

  const addValid = /.+@.+\..+/.test(addEmail);
  async function add() {
    if (!addValid || busy) return;
    setBusy(true);
    try {
      await cf("suppressions", { method: "POST", body: JSON.stringify({ channel: "email", address: addEmail.trim(), reason: addReason }) });
      setAddOpen(false);
      setAddEmail("");
      setAddReason("UNSUBSCRIBED");
      await refresh();
      toast("Address suppressed");
    } catch {
      toast("Couldn’t suppress that address — it may already be on the list.");
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    await cf(`suppressions/${id}`, { method: "DELETE" }).catch(() => {});
    await refresh();
    toast("Removed from suppression list");
  }

  return (
    <div data-testid="section-suppress">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div>
          <div style={sectionHead}>Suppression list</div>
          <div style={sectionSub}>Addresses agents will never contact.</div>
        </div>
        <span onClick={() => toast("CSV upload arrives with a later phase")} title="CSV upload arrives with a later phase" style={{ ...secondaryBtn, marginLeft: "auto" }} data-testid="suppress-upload-csv">↥ Upload CSV</span>
        <span onClick={() => { setAddOpen(true); setReasonDD(false); }} style={{ ...gradBtn, padding: "10px 16px" }} data-testid="suppress-add">+ Add</span>
      </div>
      {/* §0 search — custom-fields search-box literal */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: "0 0 300px", display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, padding: "11px 16px", boxSizing: "border-box" }}>
          <span style={{ color: "#9AA59E" }}>⚲</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search addresses…" style={{ border: "none", background: "transparent", fontSize: 14, color: "#0E1512", flex: 1, minWidth: 0, padding: 0, outline: "none", fontFamily: "'Hanken Grotesk',sans-serif" }} data-testid="suppress-search" />
          {q ? <span onClick={() => setQ("")} style={{ color: "#9AA59E", fontSize: 13, cursor: "pointer" }}>✕</span> : null}
        </div>
      </div>
      <div style={tableCard} data-testid="suppress-table">
        <div style={theadRow(SUPPRESS_GRID)}><span>Address</span><span>Channel</span><span>Reason</span><span>Source</span><span>Added</span><span /></div>
        {rows === null && !error ? (
          <SkeletonRows testid="suppress-skeleton" />
        ) : error ? (
          <ErrorState what="the suppression list" onRetry={() => void refresh()} testid="suppress-error" />
        ) : rows !== null && rows.length === 0 && q.trim() ? (
          <div data-testid="suppress-filtered-empty">
            {/* filtered-empty carries secondary actions only (DEC-021) */}
            <EmptyState
              kind="filtered"
              title="No addresses match"
              body="Try a different search — suppressed addresses are matched on the email."
              actions={<span onClick={() => setQ("")} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>Clear search</span>}
            />
          </div>
        ) : rows !== null && rows.length === 0 ? (
          <div data-testid="suppress-empty">
            <EmptyState
              kind="empty"
              title="No suppressed addresses"
              body="Unsubscribes, bounces and complaints land here automatically — every send checks this list first."
              actions={<span onClick={() => setAddOpen(true)} style={{ fontSize: 13, fontWeight: 700, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 10, padding: "9px 16px", cursor: "pointer" }}>+ Add an address</span>}
            />
          </div>
        ) : (
          (rows ?? []).map((r) => {
            const rp = REASON[r.reason] ?? { label: r.reason, ...PAIR.neutral };
            return (
              <div key={r.id} style={{ ...tbodyRow(SUPPRESS_GRID), fontSize: 13.5, color: "#0E1512" }} data-testid="suppress-row">
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.address}</span>
                <span style={{ color: "#5C6B62" }}>{r.channel}</span>
                <span><span style={{ fontSize: 12, fontWeight: 600, color: rp.fg, background: rp.bg, borderRadius: 100, padding: "4px 10px" }}>{rp.label}</span></span>
                <span style={{ color: "#5C6B62", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.source ?? "—"}</span>
                <span style={{ color: "#9AA59E" }}>{fmtDate(r.createdAt)}</span>
                <span onClick={() => void remove(r.id)} style={{ textAlign: "center", color: "#9AA59E", fontWeight: 700, cursor: "pointer" }} data-testid="suppress-remove">✕</span>
              </div>
            );
          })
        )}
      </div>

      {/* add-suppression modal (MCFG.addSuppression, wired) */}
      {addOpen ? (
        <ModalShell
          width={440}
          title="Add to suppression list"
          onClose={() => setAddOpen(false)}
          testid="suppress-add-modal"
          footer={
            <>
              <span onClick={() => setAddOpen(false)} style={{ marginLeft: "auto", fontSize: 14, fontWeight: 600, color: "#5C6B62", background: "#fff", border: "1px solid #EBE3D6", borderRadius: 11, padding: "10px 18px", cursor: "pointer" }}>Cancel</span>
              <span onClick={() => void add()} style={{ fontSize: 14, fontWeight: 700, color: addValid ? "#0A0F0C" : "#9AA59E", background: addValid ? GRAD : "#ECE7DC", borderRadius: 11, padding: "10px 20px", cursor: addValid ? "pointer" : "not-allowed", boxShadow: addValid ? "0 6px 16px rgba(53,232,52,.26)" : "none" }} data-testid="suppress-add-save">{busy ? "Adding…" : "Add"}</span>
            </>
          }
        >
          <div style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: 13 }}>
            <div>
              <label style={lbl}>Email</label>
              <input value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="name@company.com" style={{ ...inp, height: 44 }} data-testid="suppress-add-email" />
            </div>
            <div style={{ position: "relative" }}>
              <label style={lbl}>Reason</label>
              <div onClick={() => setReasonDD((v) => !v)} style={{ height: 44, borderRadius: 11, background: "#fff", border: "1px solid #EBE3D6", display: "flex", alignItems: "center", padding: "0 14px", fontSize: 14, color: "#0E1512", cursor: "pointer", boxSizing: "border-box" }} data-testid="suppress-add-reason">
                {REASON[addReason]?.label ?? addReason}
                <span style={{ marginLeft: "auto", color: "#9AA59E" }}>⌄</span>
              </div>
              {reasonDD ? (
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#fff", border: "1px solid #EBE3D6", borderRadius: 12, boxShadow: "0 16px 44px rgba(0,0,0,.18)", zIndex: 25, overflow: "hidden" }}>
                  {REASON_OPTIONS.map((o) => (
                    <div key={o} onClick={() => { setAddReason(o); setReasonDD(false); }} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 14px", fontSize: 13.5, color: "#0E1512", borderBottom: "1px solid #F7F2EA", cursor: "pointer" }}>
                      <span style={{ flex: 1 }}>{REASON[o]?.label}</span>
                      <span style={{ color: "#16A82A", visibility: addReason === o ? "visible" : "hidden" }}>✓</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
