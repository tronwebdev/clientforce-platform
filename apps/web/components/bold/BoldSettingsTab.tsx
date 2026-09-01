"use client";

/**
 * B3d (DEC-122): HOW MUCH ADA DECIDES — the three-level autonomy radio,
 * read/written through the shipped guardrails PATCH.
 *
 * B7 (DEC-133): the deferred sections come HOME —
 *  - CHANNELS IN PLAY: real toggles on the `guardrails.channels` rider; off
 *    holds that channel's scheduled steps at the send boundary
 *    (CHANNEL_PAUSED — a restriction, never a bypass; replies still send).
 *  - THE LINES SHE WON'T CROSS: the REAL rails — quiet hours + Saturday
 *    from `sendingWindow`, the literal-true suppression rail as a locked
 *    chip, and per-channel daily caps as TYPED RECESSED WELLS (the owner's
 *    Q-081 ruling: the prototype's −/+ steppers are retired console-wide).
 *  - HOW SHE SELLS IT: cards read the live derivations — the selling arc
 *    (selectStrategy, never stored), language + banned phrases (riders),
 *    what she knows (this campaign's gap report), your instructions (the
 *    stored column). Notification routing has no spine — visibly deferred
 *    (Q-110), never dropped.
 */
import { useCallback, useEffect, useState } from "react";
import { selectStrategy, type AgentListItem, type Guardrails } from "@clientforce/core";
import { mono } from "./bold-cards";
import { fetchBoldView, fetchGapReport, patchAgentGuardrails } from "./bold-live";

type Level = "ask" | "limits" | "full";

const LEVELS: ReadonlyArray<readonly [Level, string, string, string]> = [
  ["ask", "Ask me first", "Nothing sends without your tap. Slowest, safest.", "every send queued"],
  [
    "limits",
    "Act inside limits",
    "She sends, books and replies within the guardrails below. Anything outside them waits for you.",
    "the default",
  ],
  [
    "full",
    "Full autonomy",
    "She also moves budget and starts branches. You get receipts, not questions.",
    "for campaigns you trust",
  ],
];

const CHANNELS: ReadonlyArray<
  readonly ["email" | "sms" | "voice", string, string, string, string, string]
> = [
  [
    "email",
    "Email",
    "Off holds her scheduled email steps — replies you send still go.",
    "✉",
    "var(--cvb-mint)",
    "var(--cvb-forest)",
  ],
  [
    "sms",
    "SMS",
    "Off holds her scheduled texts the same way.",
    "✆",
    "var(--cvb-cyan-tint,#E2F3F6)",
    "var(--cvb-cyan,#0E7D93)",
  ],
  [
    "voice",
    "Calls",
    "Off holds her campaign dials — your own calls are yours.",
    "☎",
    "var(--cvb-amber-bg,#F7EFDA)",
    "var(--cvb-amber,#8A6D1A)",
  ],
];

const eyebrow = {
  ...mono,
  fontSize: 9.5,
  letterSpacing: ".18em",
  color: "var(--cvb-faint)",
} as const;
const well = {
  ...mono,
  fontSize: 12.5,
  background: "var(--cvb-well)",
  border: "1px solid var(--cvb-line-ctl)",
  borderRadius: 10,
  padding: "8px 11px",
  width: 64,
  textAlign: "right" as const,
  outline: "none",
  color: "var(--cvb-ink)",
} as const;

export function BoldSettingsTab({
  agent,
  flash,
}: {
  agent: AgentListItem;
  flash?: (msg: string) => void;
}) {
  const [guardrails, setGuardrails] = useState<Guardrails | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [know, setKnow] = useState<{ resolved: number; total: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [caps, setCaps] = useState<{ email: string; sms: string; voice: string }>({
    email: "",
    sms: "",
    voice: "",
  });
  const [win, setWin] = useState<{ start: string; end: string }>({ start: "09:00", end: "17:00" });

  const load = useCallback(async () => {
    const [view, gaps] = await Promise.all([
      fetchBoldView(agent.id),
      fetchGapReport(agent.id, agent.goal),
    ]);
    const g = view?.guardrails ?? null;
    setGuardrails(g);
    setCategory((view?.agent as { category?: string | null } | undefined)?.category ?? null);
    setInstructions(
      (view?.agent as { instructions?: string | null } | undefined)?.instructions ?? null,
    );
    setKnow(gaps ? { resolved: gaps.resolved, total: gaps.total } : null);
    if (g) {
      setCaps({
        email: String(g.dailyCap.email),
        sms: g.dailyCap.sms != null ? String(g.dailyCap.sms) : "",
        voice: g.dailyCap.voice != null ? String(g.dailyCap.voice) : "",
      });
      setWin({ start: g.sendingWindow.start, end: g.sendingWindow.end });
    }
    setLoaded(true);
  }, [agent.id, agent.goal]);

  useEffect(() => {
    setLoaded(false);
    void load();
  }, [load]);

  const level: Level = (guardrails?.autonomy as Level | undefined) ?? "limits";

  async function write(next: Guardrails, toast: string) {
    if (saving) return;
    if (!loaded) return;
    setSaving(true);
    try {
      const res = await patchAgentGuardrails(agent.id, next);
      if (!res.ok) {
        flash?.(res.error || "The setting did not save — try again.");
        return;
      }
      setGuardrails(next);
      flash?.(toast);
    } finally {
      setSaving(false);
    }
  }

  // DEC-115: a row whose stored limits don't parse says so instead of
  // silently ignoring every control (the pre-A8 legacy-guardrails case).
  const unreadable = loaded && guardrails == null;
  function refuseUnreadable(): boolean {
    if (!unreadable) return false;
    flash?.("This campaign's stored limits are unreadable — nothing was changed.");
    return true;
  }

  async function pick(next: Level, title: string) {
    if (refuseUnreadable()) return;
    if (!guardrails || next === level) return;
    await write({ ...guardrails, autonomy: next }, title);
  }

  async function toggleChannel(ch: "email" | "sms" | "voice", label: string) {
    if (refuseUnreadable()) return;
    if (!guardrails) return;
    const on = guardrails.channels?.[ch] !== false;
    await write(
      { ...guardrails, channels: { ...(guardrails.channels ?? {}), [ch]: !on ? true : false } },
      `${label} ${on ? "paused — scheduled steps hold" : "back on"}`,
    );
  }

  async function saveLimits() {
    if (refuseUnreadable()) return;
    if (!guardrails) return;
    const dailyCap: { email: number; sms?: number; voice?: number } = {
      email: guardrails.dailyCap.email,
    };
    for (const k of ["email", "sms", "voice"] as const) {
      const raw = caps[k].trim();
      if (!raw) {
        if (k !== "email") delete dailyCap[k];
        continue;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        flash?.(`The ${k} cap needs a whole number.`);
        return;
      }
      dailyCap[k] = n;
    }
    const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeOk.test(win.start) || !timeOk.test(win.end)) {
      flash?.("Quiet hours need HH:MM times.");
      return;
    }
    await write(
      {
        ...guardrails,
        dailyCap,
        sendingWindow: { ...guardrails.sendingWindow, start: win.start, end: win.end },
      },
      "Limits saved.",
    );
  }

  async function toggleWeekend() {
    if (refuseUnreadable()) return;
    if (!guardrails) return;
    const has = guardrails.sendingWindow.days.some((n) => n === 6 || n === 7);
    const days = has
      ? guardrails.sendingWindow.days.filter((n) => n < 6)
      : [...guardrails.sendingWindow.days, 6];
    await write(
      {
        ...guardrails,
        sendingWindow: { ...guardrails.sendingWindow, days: days.sort((a, b) => a - b) },
      },
      has ? "Weekends go silent" : "Saturday sending on",
    );
  }

  const weekend = guardrails?.sendingWindow.days.some((n) => n === 6 || n === 7) ?? false;
  const strategy = selectStrategy(agent.goal, category);
  const neverSay = guardrails?.strategy?.neverSay ?? [];
  const notes = guardrails?.strategy?.strategyNotes ?? "";

  const voiceCards: Array<{
    k: string;
    label: string;
    v: string;
    body: string;
    deferred?: boolean;
  }> = [
    {
      k: "arc",
      label: "SELLING ARC",
      v: strategy.arc.label,
      body: strategy.arc.description,
    },
    {
      k: "lang",
      label: "AGENT LANGUAGE",
      v: guardrails?.language ? guardrails.language.toUpperCase() : "English",
      body:
        neverSay.length > 0
          ? `${neverSay.length} banned phrase${neverSay.length === 1 ? "" : "s"} — checked on every draft, not just asked for.`
          : "No banned phrases yet — add them below in your instructions.",
    },
    {
      k: "know",
      label: "WHAT SHE KNOWS",
      v: know ? `${know.resolved} of ${know.total} facts` : "—",
      body: know
        ? know.resolved === know.total
          ? "Everything this campaign needs is answered. She never invents the rest."
          : `${know.total - know.resolved} still missing — she will not invent them. Fill them in workspace Settings → Business core.`
        : "The gap report did not load.",
    },
    {
      k: "inst",
      label: "YOUR INSTRUCTIONS",
      v: instructions?.trim() || notes.trim() ? "Standing rules" : "None yet",
      body:
        [instructions?.trim(), notes.trim()].filter(Boolean).join(" · ").slice(0, 140) ||
        "Things you tell her once that she never forgets — in your words. Edit them from the campaign's plan step.",
    },
    {
      k: "notify",
      label: "WHO GETS TOLD",
      v: "On its way",
      body: "Routing bookings and objections to the right person is coming — today everything lands in the app.",
      deferred: true,
    },
  ];

  return (
    <div data-testid="bold-settings" style={{ padding: "26px 40px 40px" }}>
      {unreadable ? (
        <div
          data-testid="bold-settings-unreadable"
          style={{
            marginBottom: 20,
            background: "var(--cvb-amber-bg,#F7EFDA)",
            border: "1px solid var(--cvb-amber-line,#EAD9A8)",
            borderRadius: 14,
            padding: "12px 15px",
            fontSize: 12.5,
            color: "var(--cvb-amber,#8A6D1A)",
            lineHeight: 1.5,
          }}
        >
          This campaign&rsquo;s stored limits don&rsquo;t parse, so the controls below can&rsquo;t
          save. The safety rails still hold at the send boundary — fix the limits in the classic
          console&rsquo;s campaign settings.
        </div>
      ) : null}
      <div style={{ ...eyebrow, marginBottom: 16 }}>HOW MUCH ADA DECIDES</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 11,
        }}
      >
        {LEVELS.map(([key, title, body, note]) => {
          const on = loaded && level === key;
          return (
            <div
              key={key}
              onClick={() => void pick(key, title)}
              data-testid={`bold-auto-${key}`}
              aria-checked={on}
              role="radio"
              style={{
                background: on ? "var(--cvb-mint)" : "var(--cvb-card)",
                border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                borderRadius: 18,
                padding: 18,
                cursor: "pointer",
                opacity: loaded ? (saving ? 0.7 : 1) : 0.55,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    border: `2px solid ${on ? "var(--cvb-forest)" : "var(--cvb-ghost)"}`,
                    display: "grid",
                    placeItems: "center",
                    flex: "none",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: on ? "var(--cvb-forest)" : "transparent",
                    }}
                  />
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: 14,
                    letterSpacing: "-.022em",
                    color: on ? "var(--cvb-forest-ink, #0E3D22)" : "var(--cvb-ink)",
                  }}
                >
                  {title}
                </span>
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: on ? "var(--cvb-forest)" : "var(--cvb-muted)",
                  lineHeight: 1.55,
                  marginTop: 10,
                }}
              >
                {body}
              </div>
              <div
                style={{
                  ...mono,
                  fontSize: 9,
                  color: on ? "var(--cvb-forest)" : "var(--cvb-faint)",
                  marginTop: 12,
                }}
              >
                {note}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 14, lineHeight: 1.6 }}
      >
        Whatever the level, nothing skips the safety rails — quiet hours, consent, do-not-contact
        and the pause-when-a-human-replies rule always hold.
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 34 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ ...eyebrow, marginBottom: 16 }}>CHANNELS IN PLAY</div>
          <div
            style={{
              background: "var(--cvb-card)",
              border: "1px solid var(--cvb-line-ctl)",
              borderRadius: 20,
              overflow: "hidden",
            }}
          >
            {CHANNELS.map(([key, label, sub, ic, bg, fg], i) => {
              const on = loaded && guardrails?.channels?.[key] !== false;
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: 17,
                    borderBottom:
                      i === CHANNELS.length - 1 ? "none" : "1px solid var(--cvb-line-inner)",
                  }}
                >
                  <span
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 12,
                      flex: "none",
                      background: bg,
                      color: fg,
                      display: "grid",
                      placeItems: "center",
                      fontSize: 14,
                    }}
                  >
                    {ic}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-.02em" }}>
                      {label}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--cvb-faint)",
                        marginTop: 2,
                        lineHeight: 1.4,
                      }}
                    >
                      {sub}
                    </div>
                  </div>
                  <span
                    onClick={() => void toggleChannel(key, label)}
                    data-testid={`bold-ch-${key}`}
                    role="switch"
                    aria-checked={on}
                    style={{
                      width: 46,
                      height: 28,
                      borderRadius: 999,
                      flex: "none",
                      background: on ? "var(--cvb-forest)" : "var(--cvb-line-ctl)",
                      position: "relative",
                      cursor: "pointer",
                      opacity: loaded ? 1 : 0.55,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        top: 3,
                        left: on ? 21 : 3,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "#fff",
                        boxShadow: "0 1px 3px rgba(16,22,19,.18)",
                        transition: "left .2s cubic-bezier(.32,.72,0,1)",
                      }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 280 }}>
          <div style={{ ...eyebrow, marginBottom: 16 }}>THE LINES SHE WON&rsquo;T CROSS</div>
          <div
            style={{
              background: "var(--cvb-card)",
              border: "1px solid var(--cvb-line-ctl)",
              borderRadius: 20,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 17px",
                borderBottom: "1px solid var(--cvb-line-inner)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.018em" }}>
                  Sending hours
                </div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                  {guardrails?.sendingWindow.timezone ?? "UTC"} — nothing lands outside them
                </div>
              </div>
              <input
                value={win.start}
                onChange={(e) => setWin((w) => ({ ...w, start: e.target.value }))}
                data-testid="bold-gr-win-start"
                style={well}
              />
              <span style={{ color: "var(--cvb-faint)" }}>–</span>
              <input
                value={win.end}
                onChange={(e) => setWin((w) => ({ ...w, end: e.target.value }))}
                data-testid="bold-gr-win-end"
                style={well}
              />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 17px",
                borderBottom: "1px solid var(--cvb-line-inner)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Honest suppression</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                  Opt-outs and do-not-contact always hold — this cannot be turned off
                </div>
              </div>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: "var(--cvb-forest)",
                  background: "var(--cvb-mint)",
                  border: "1px solid var(--cvb-mint-line)",
                  borderRadius: 999,
                  padding: "3px 9px",
                  flex: "none",
                }}
              >
                ALWAYS ON
              </span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 17px",
                borderBottom: "1px solid var(--cvb-line-inner)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Saturday sending</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                  Off means the weekend stays silent
                </div>
              </div>
              <span
                onClick={() => void toggleWeekend()}
                data-testid="bold-gr-weekend"
                role="switch"
                aria-checked={weekend}
                style={{
                  width: 46,
                  height: 28,
                  borderRadius: 999,
                  flex: "none",
                  background: weekend ? "var(--cvb-forest)" : "var(--cvb-line-ctl)",
                  position: "relative",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    top: 3,
                    left: weekend ? 21 : 3,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#fff",
                    boxShadow: "0 1px 3px rgba(16,22,19,.18)",
                    transition: "left .2s",
                  }}
                />
              </span>
            </div>
            {(
              [
                ["Daily email cap", "email"],
                ["Daily SMS cap", "sms"],
                ["Daily call cap", "voice"],
              ] as const
            ).map(([label, key]) => (
              <div
                key={key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "13px 17px",
                  borderBottom: "1px solid var(--cvb-line-inner)",
                  background: "var(--cvb-well)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</div>
                </div>
                <input
                  value={caps[key]}
                  onChange={(e) => setCaps((c) => ({ ...c, [key]: e.target.value }))}
                  placeholder={key === "email" ? "" : "—"}
                  inputMode="numeric"
                  data-testid={`bold-gr-cap-${key}`}
                  style={{ ...well, background: "var(--cvb-card)" }}
                />
              </div>
            ))}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "13px 17px",
                background: "var(--cvb-well)",
              }}
            >
              <span style={{ fontSize: 11, color: "var(--cvb-faint)", flex: 1, lineHeight: 1.5 }}>
                Typed limits — she stops at the number, and holds show up in the activity feed.
              </span>
              <span
                onClick={() => void saveLimits()}
                data-testid="bold-gr-save"
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: "#fff",
                  background: "var(--cvb-forest)",
                  borderRadius: 10,
                  padding: "8px 13px",
                  cursor: "pointer",
                  flex: "none",
                }}
              >
                Save limits
              </span>
            </div>
            <div
              data-testid="bold-gr-deferred"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 17px",
                borderTop: "1px dashed var(--cvb-line-ctl)",
                fontSize: 11.5,
                color: "var(--cvb-faint)",
                lineHeight: 1.5,
              }}
            >
              Two more lines are on their way: holding a new sender&rsquo;s first batch for your
              look, and staying quiet on holidays from your calendar.
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...eyebrow, margin: "34px 0 16px" }}>HOW SHE SELLS IT</div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 12,
        }}
      >
        {voiceCards.map((v) => (
          <div
            key={v.k}
            data-testid={`bold-voice-${v.k}`}
            style={{
              background: "var(--cvb-card)",
              border: v.deferred
                ? "1px dashed var(--cvb-line-ctl)"
                : "1px solid var(--cvb-line-ctl)",
              borderRadius: 20,
              padding: 20,
              opacity: v.deferred ? 0.75 : 1,
            }}
          >
            <div
              style={{ ...mono, fontSize: 9, letterSpacing: ".16em", color: "var(--cvb-faint)" }}
            >
              {v.label}
            </div>
            <div
              style={{
                fontFamily: "var(--cvb-font-display)",
                fontWeight: 900,
                fontSize: 17,
                letterSpacing: "-.028em",
                marginTop: 10,
              }}
            >
              {v.v}
            </div>
            <div
              style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 9 }}
            >
              {v.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
