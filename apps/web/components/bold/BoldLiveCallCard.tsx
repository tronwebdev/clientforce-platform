"use client";

/**
 * B4.5 (DEC-128): the live-call card — the OLD console prototype's
 * `rcpCallOpen` treatment (owner ruling at the B4 addendum: floating card
 * top-right, ~344px, gradient top edge, three-state lifecycle) rendered in
 * Bold tokens, serving BOTH duties:
 *
 *  - mode "live": a REAL call. Phases read from the polled Call row —
 *    dialing (QUEUED) → on the line (IN_PROGRESS, per-turn transcript rows
 *    landing as Ada speaks) → yours (a human jumped in) → handled
 *    (COMPLETED/FAILED). "Jump in" is the real takeover: mic preflight,
 *    the contact leg moves into the call's conference room, the browser
 *    leg joins (B3c-2 Device; keyless sandbox mounts no Device and says so).
 *    Today the live mode serves Ada OUTBOUND calls — the prototype's
 *    inbound copy ("Incoming call", "Take it myself", receptionist naming)
 *    arrives with Q-090's engine; an outbound dial says what is true.
 *  - mode "preview": the receptionist pitch's scripted call — the old
 *    console's rcpPreview timeline VERBATIM (1s ticks, ring to t=4, a line
 *    every 3s, handled at t=18), but LABELED as a preview and never
 *    claiming a log the way the prototype did (owner ruling: clearly
 *    labeled, never fake-logged; nothing is written anywhere).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCallDetail, jumpIntoCall, type CallDetailRead } from "./bold-live";

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

/** The old prototype's scripted preview call, verbatim (RL). */
const PREVIEW_LINES: ReadonlyArray<readonly ["R" | "C", string]> = [
  ["R", "Bright Smile Dental — you've reached the AI receptionist. How can I help?"],
  ["C", "Hi — I got a text about my six-month cleaning."],
  ["R", "I can book that now. Thursday 2:10 or Friday 9:40?"],
  ["C", "Thursday works."],
];

const HANDSET =
  "M3 14v-3a9 9 0 0 1 18 0v3 M21 15a2 2 0 0 1-2 2h-1a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h3v4z M3 15a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1H3v4z M17.5 21H13";

const clockFmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, "0")}`;

interface TwilioCallLike {
  disconnect: () => void;
  on: (ev: string, cb: () => void) => void;
}
interface TwilioDeviceLike {
  connect: (o: { params: Record<string, string> }) => Promise<TwilioCallLike>;
  destroy: () => void;
}

type Mode = { kind: "preview" } | { kind: "live"; callId: string };

export function BoldLiveCallCard({
  mode,
  onClose,
  flash,
}: {
  mode: Mode;
  onClose: () => void;
  flash?: (msg: string) => void;
}) {
  // ── preview clock (the prototype's rcpT machine, 1s ticks) ──
  const [pt, setPt] = useState(0);
  useEffect(() => {
    if (mode.kind !== "preview") return;
    const iv = setInterval(() => setPt((t) => Math.min(t + 1, 18)), 1000);
    return () => clearInterval(iv);
  }, [mode.kind]);

  // ── live detail poll (2s while the call is open) ──
  const [detail, setDetail] = useState<CallDetailRead | null>(null);
  useEffect(() => {
    if (mode.kind !== "live") return;
    let stop = false;
    const load = async () => {
      const d = await fetchCallDetail(mode.callId);
      if (!stop && d) setDetail(d);
    };
    void load();
    const iv = setInterval(() => {
      void load();
    }, 2000);
    return () => {
      stop = true;
      clearInterval(iv);
    };
  }, [mode]);

  // ── live elapsed clock ──
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  // ── jump-in: preflight → takeover → (Device | sandbox) ──
  const [joinState, setJoinState] = useState<"idle" | "joining" | "joined" | "sandbox" | "mic_denied" | "failed">("idle");
  const deviceRef = useRef<TwilioDeviceLike | null>(null);
  const legRef = useRef<TwilioCallLike | null>(null);
  useEffect(
    () => () => {
      legRef.current?.disconnect();
      deviceRef.current?.destroy();
    },
    [],
  );
  const jumpIn = useCallback(async () => {
    if (mode.kind !== "live" || joinState === "joining" || joinState === "joined") return;
    setJoinState("joining");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      setJoinState("mic_denied");
      return;
    }
    const res = await jumpIntoCall(mode.callId);
    if (!res.ok) {
      setJoinState("failed");
      flash?.(res.error);
      return;
    }
    const body = (res.body ?? {}) as { sandbox?: boolean; token?: string };
    if (body.sandbox || !body.token) {
      setJoinState("sandbox");
      return;
    }
    try {
      const sdk = (await import("@twilio/voice-sdk")) as unknown as {
        Device: new (token: string, opts?: Record<string, unknown>) => TwilioDeviceLike;
      };
      const device = new sdk.Device(body.token, { logLevel: "silent" });
      deviceRef.current = device;
      const leg = await device.connect({ params: { joinCallId: mode.callId } });
      legRef.current = leg;
      leg.on("accept", () => setJoinState("joined"));
      leg.on("disconnect", () => setJoinState("idle"));
      leg.on("error", () => setJoinState("failed"));
    } catch {
      setJoinState("failed");
    }
  }, [mode, joinState, flash]);

  // ── phase + view-model ──
  const isPreview = mode.kind === "preview";
  const call = detail?.call;
  const takenOver = Boolean((call?.meta as { takenOver?: unknown } | null | undefined)?.takenOver);
  const phase: "ring" | "live" | "yours" | "done" = isPreview
    ? pt < 4
      ? "ring"
      : pt < 18
        ? "live"
        : "done"
    : !call || call.status === "QUEUED"
      ? "ring"
      : call.status === "IN_PROGRESS"
        ? takenOver || joinState === "joined" || joinState === "sandbox"
          ? "yours"
          : "live"
        : "done";

  const contactName = isPreview
    ? "Maria Vidal"
    : [detail?.contact?.firstName, detail?.contact?.lastName].filter(Boolean).join(" ") || "Contact";
  const initials =
    contactName
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

  const elapsedSec = call?.startedAt ? Math.max(0, Math.floor((nowMs - new Date(call.startedAt).getTime()) / 1000)) : 0;
  const title = isPreview
    ? phase === "ring"
      ? "Incoming call"
      : phase === "live"
        ? "✦ Receptionist on the line"
        : "Call handled"
    : phase === "ring"
      ? "Calling out"
      : phase === "live"
        ? "✦ Ada on the line"
        : phase === "yours"
          ? "You are on the call"
          : "Call handled";
  const sub = isPreview
    ? phase === "done"
      ? "Preview finished · nothing was logged"
      : "Bright Smile main line · (512) 555-0144"
    : phase === "done"
      ? `Outcome logged · ${contactName}`
      : `Ada's line · ${detail?.call && (detail.call.meta as { sandbox?: boolean } | null)?.sandbox ? "practice dial" : "outbound"}`;
  const clock = isPreview
    ? phase === "ring"
      ? "ringing"
      : phase === "live"
        ? clockFmt(pt - 4)
        : "0:14"
    : phase === "ring"
      ? "dialing"
      : phase === "done"
        ? clockFmt(call?.durationSec ?? 0)
        : clockFmt(elapsedSec);

  const lines: Array<{ who: string; fg: string; text: string }> = isPreview
    ? PREVIEW_LINES.filter((_, i) => pt >= 6 + i * 3).map(([who, text]) => ({
        who,
        fg: who === "R" ? "var(--cvb-forest)" : "var(--cvb-ghost)",
        text,
      }))
    : (detail?.transcript ?? []).map((m) => ({
        who: m.direction === "OUTBOUND" ? "A" : "C",
        fg: m.direction === "OUTBOUND" ? "var(--cvb-forest)" : "var(--cvb-ghost)",
        text: m.body,
      }));

  const outcome = call?.outcome ?? null;
  const pill =
    isPreview || outcome === "completed"
      ? { label: isPreview ? "Booked" : "Done", fg: "var(--cvb-forest)", bg: "var(--cvb-mint)", bd: "var(--cvb-mint-line)" }
      : outcome === "no_answer" || outcome === "busy"
        ? { label: outcome === "busy" ? "Busy" : "No answer", fg: "#8A6D1A", bg: "#F7EFDA", bd: "#EAD9A8" }
        : { label: "Failed", fg: "var(--cvb-faint)", bg: "var(--cvb-panel)", bd: "var(--cvb-line-ctl)" };

  const ghostBtn = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--cvb-faint)",
    border: "1px solid var(--cvb-line-ctl)",
    borderRadius: 11,
    padding: "9px 12px",
    cursor: "pointer",
    textAlign: "center" as const,
    background: "var(--cvb-card)",
  };
  const solidBtn = {
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    background: "var(--cvb-forest)",
    borderRadius: 11,
    padding: "9px 12px",
    cursor: "pointer",
    textAlign: "center" as const,
  };

  return (
    <div
      data-testid="bold-livecall"
      style={{
        position: "absolute",
        right: 88,
        top: 20,
        width: 344,
        background: "var(--cvb-card)",
        border: "1px solid var(--cvb-mint-line)",
        borderRadius: 20,
        boxShadow: "0 28px 70px rgba(16,22,19,.26)",
        overflow: "hidden",
        zIndex: 60,
      }}
    >
      <div style={{ height: 3, background: "var(--cvb-gradient-signature, linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B))" }} />

      {/* Header — gradient handset tile (ping while ringing), title/sub, mono clock. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--cvb-panel)", borderBottom: "1px solid var(--cvb-line-inner)" }}>
        <span style={{ position: "relative", width: 36, height: 36, borderRadius: 13, display: "grid", placeItems: "center", background: "var(--cvb-gradient-signature, linear-gradient(135deg,#36D7ED,#35E834 55%,#D0F56B))", flex: "none" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#0A1F12" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
            <path d={HANDSET} />
          </svg>
          {phase === "ring" ? (
            <span style={{ position: "absolute", inset: -2, borderRadius: 14, border: "2px solid #35E834", opacity: 0.55, animation: "cvb-ping 1.15s ease-out infinite" }} />
          ) : null}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.01em" }}>{title}</div>
          <div style={{ fontSize: 10.5, color: "var(--cvb-faint)" }}>{sub}</div>
        </div>
        {isPreview ? (
          <span data-testid="bold-livecall-preview-chip" style={{ ...mono, fontSize: 8.5, letterSpacing: ".14em", fontWeight: 700, color: "var(--cvb-amber)", background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", borderRadius: 999, padding: "3px 8px", flex: "none" }}>
            PREVIEW
          </span>
        ) : null}
        <span data-testid="bold-livecall-clock" style={{ ...mono, fontSize: 11, color: "var(--cvb-forest)", flex: "none" }}>{clock}</span>
      </div>

      {/* Contact row — initials, name, the known-contact chip. */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
        <span style={{ width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", background: "linear-gradient(135deg,var(--cvb-forest),#35E834)", color: "#fff", fontSize: 11, fontWeight: 700, flex: "none" }}>
          {initials}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{contactName}</div>
          <div style={{ fontSize: 10.5, color: "var(--cvb-ghost)" }}>
            {isPreview ? "Patient since 2022 · overdue 6-mo recall" : "On this workspace's list"}
          </div>
        </div>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "2px 8px", flex: "none" }}>
          Known contact
        </span>
      </div>

      {/* ── ringing ── */}
      {phase === "ring" ? (
        isPreview ? (
          <div style={{ display: "flex", gap: 8, padding: "11px 14px", background: "var(--cvb-panel)" }}>
            <span onClick={() => { flash?.("In a real call this hands it to you — preview closed."); onClose(); }} style={{ ...ghostBtn, flex: 1 }}>
              Take it myself
            </span>
            <span onClick={() => setPt(4)} data-testid="bold-livecall-answer" style={{ ...solidBtn, flex: 1.4 }}>
              ✦ Let Receptionist answer
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "11px 14px", background: "var(--cvb-panel)" }}>
            <span style={{ flex: 1, fontSize: 10, color: "var(--cvb-ghost)", lineHeight: 1.4 }}>
              Ada is dialing — the card wakes up when the line answers.
            </span>
            <span onClick={onClose} data-testid="bold-livecall-hide" style={{ ...ghostBtn, flex: "none" }}>
              Hide
            </span>
          </div>
        )
      ) : null}

      {/* ── transcript (live / yours / done all show what was said) ── */}
      {phase !== "ring" ? (
        <div data-testid="bold-livecall-lines" style={{ display: "flex", flexDirection: "column", gap: 6, padding: "11px 14px", maxHeight: 240, overflowY: "auto" }}>
          {lines.length === 0 ? (
            <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)" }}>
              {phase === "live" ? "transcribing — the first line lands as she speaks" : "no words were exchanged"}
            </div>
          ) : (
            lines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                <span style={{ ...mono, fontSize: 9, color: l.fg, width: 12, flex: "none" }}>{l.who}</span>
                <span style={{ fontSize: 12, lineHeight: 1.5, flex: 1 }}>{l.text}</span>
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* ── yours: the honest takeover band ── */}
      {phase === "yours" && !isPreview ? (
        <div style={{ margin: "0 14px 11px", background: "rgba(54,215,237,.12)", border: "1px solid rgba(54,215,237,.35)", borderRadius: 13, padding: "10px 12px" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>You are on the call</div>
          <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-faint)", marginTop: 2 }}>
            {joinState === "sandbox"
              ? "practice takeover — no live audio leg in this environment"
              : "Ada stepped out — her notes up to here are saved"}
          </div>
        </div>
      ) : null}

      {/* ── footer per phase ── */}
      {phase === "live" ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--cvb-line-inner)", background: "var(--cvb-panel)" }}>
          <span style={{ flex: 1, fontSize: 10, color: "var(--cvb-ghost)", lineHeight: 1.4 }}>
            {isPreview ? "Handled hands-free — step in any time." : "Handled hands-free — jump in any time."}
          </span>
          {isPreview ? null : joinState === "mic_denied" ? (
            <span style={{ fontSize: 10, color: "var(--cvb-amber)", maxWidth: 150 }}>Mic declined — allow it and try again.</span>
          ) : (
            <span onClick={() => void jumpIn()} data-testid="bold-livecall-jumpin" style={{ ...solidBtn, flex: "none", opacity: joinState === "joining" ? 0.6 : 1 }}>
              {joinState === "joining" ? "Joining…" : "Jump in"}
            </span>
          )}
        </div>
      ) : null}
      {phase === "yours" && !isPreview ? (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "10px 14px", borderTop: "1px solid var(--cvb-line-inner)", background: "var(--cvb-panel)" }}>
          {joinState === "joined" ? (
            <span
              onClick={() => {
                legRef.current?.disconnect();
                deviceRef.current?.destroy();
                setJoinState("idle");
              }}
              style={{ ...solidBtn, background: "#B0483A" }}
            >
              Hang up
            </span>
          ) : (
            <span onClick={onClose} data-testid="bold-livecall-done" style={{ ...solidBtn }}>
              Done
            </span>
          )}
        </div>
      ) : null}
      {phase === "done" ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderTop: "1px solid var(--cvb-line-inner)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: pill.fg, background: pill.bg, border: `1px solid ${pill.bd}`, borderRadius: 999, padding: "3px 10px", flex: "none" }}>
              {pill.label}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>
                {isPreview ? "Cleaning · Thu 2:10 PM · confirmed by SMS" : outcome === "completed" ? "Call finished · transcript saved" : "The line was never answered"}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--cvb-ghost)" }}>
                {isPreview
                  ? "A real call lands on the timeline — this preview doesn't."
                  : `Logged to ${contactName.split(" ")[0]}'s timeline · ${clockFmt(call?.durationSec ?? 0)}`}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--cvb-line-inner)", background: "var(--cvb-panel)" }}>
            <span style={{ flex: 1, fontSize: 10, color: "var(--cvb-ghost)" }}>
              {isPreview
                ? "✦ A scripted preview — no call happened, nothing was spent."
                : takenOver
                  ? "You took this one — Ada's notes run to the takeover."
                  : "✦ Handled end-to-end by Ada."}
            </span>
            <span onClick={onClose} data-testid="bold-livecall-done" style={{ ...solidBtn, flex: "none" }}>
              Done
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}
