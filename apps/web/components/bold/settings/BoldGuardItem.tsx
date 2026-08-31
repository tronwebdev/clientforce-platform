"use client";

/**
 * Guardrails (SURFACE_SPEC_SETTINGS §8) — Sending limits · What she may say ·
 * Quiet hours · Campaign overrides.
 *
 * Two rules from the spec drive the shape of this file:
 *
 *  - **Caps are typed recessed wells, not steppers.** A stepper on a number
 *    that ranges to four figures is a joke on the person using it; the owner
 *    ruled on this once already and it stays ruled.
 *  - **Nothing is inert.** Every toggle writes on flip, with a toast naming
 *    what changed. There is no Save button on this page because a Save button
 *    is how a setting ends up looking changed while nothing was written.
 *
 * The overrides tab is the important one. These are the values a NEW campaign
 * starts from; a live campaign keeps the values it was created with. That is a
 * real behaviour with a real failure mode — a workspace default a campaign
 * silently ignores — so the tab names every campaign that differs and by how
 * much, rather than leaving the difference invisible.
 */
import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_GUARDRAILS,
  type GuardrailDefaults,
} from "@clientforce/core";
import { RowList, Toggle, type SettingsRow } from "../bold-settings-kit";
import { patchGuardrailDefaults, type GuardrailDefaultsView } from "../bold-live";
import { BoldItemPage, EmptyTab, TabNote, type ItemHeader } from "./BoldItemPage";
import { pluralise, type SettingsSnapshot } from "./settings-data";

const TABS = ["Sending limits", "What she may say", "Quiet hours", "Campaign overrides"];

const CHANNELS = [
  { key: "email" as const, label: "Daily email ceiling", sub: "Across every campaign this workspace starts" },
  { key: "sms" as const, label: "Daily SMS ceiling", sub: "Texts cost more and annoy faster — this is the brake" },
  { key: "voice" as const, label: "Daily call ceiling", sub: "Outbound calls she may place in a day" },
];

/** The rails the schema enforces — shown on, and honestly not flippable. */
const ALWAYS_ON: Array<[string, string]> = [
  ["Unsubscribe footer on every email", "Structural — the schema cannot store it off"],
  ["Suppression check before every send", "Opt-outs and do-not-contact always hold"],
  ["A human reply pauses her", "Nothing scheduled sends into a live conversation until you resume her"],
  ["Only quote what is in your business core", "She never invents a price or a policy"],
];

const DAY_LABEL = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function BoldGuardItem({
  data,
  reload,
  flash,
  onBack,
  onHeader,
  onOpenCampaign,
}: {
  data: SettingsSnapshot;
  reload: () => Promise<void>;
  flash: (m: string) => void;
  onBack: () => void;
  onHeader: (h: ItemHeader | null) => void;
  onOpenCampaign: (agentId: string) => void;
}) {
  const [tab, setTab] = useState(0);
  const view: GuardrailDefaultsView | null = data.guard;
  const stored = view?.defaults ?? {};
  const window = stored.sendingWindow ?? DEFAULT_GUARDRAILS.sendingWindow;

  const [caps, setCaps] = useState({ email: "", sms: "", voice: "" });
  const [times, setTimes] = useState({ start: "", end: "" });
  const [busy, setBusy] = useState(false);

  /**
   * The page renders before the defaults arrive, so anyone typing quickly is
   * typing into a field the load is about to overwrite. Syncing only the
   * fields the person has NOT touched keeps a fast typist's input — the
   * alternative silently discards a number they watched themselves enter.
   */
  const serverCaps = useRef({ email: "", sms: "", voice: "" });
  const serverTimes = useRef({ start: "", end: "" });
  useEffect(() => {
    const d = view?.defaults ?? {};
    const w = d.sendingWindow ?? DEFAULT_GUARDRAILS.sendingWindow;
    const next = {
      email: d.dailyCap?.email != null ? String(d.dailyCap.email) : "",
      sms: d.dailyCap?.sms != null ? String(d.dailyCap.sms) : "",
      voice: d.dailyCap?.voice != null ? String(d.dailyCap.voice) : "",
    };
    setCaps((draft) => ({
      email: draft.email === serverCaps.current.email ? next.email : draft.email,
      sms: draft.sms === serverCaps.current.sms ? next.sms : draft.sms,
      voice: draft.voice === serverCaps.current.voice ? next.voice : draft.voice,
    }));
    serverCaps.current = next;
    setTimes((draft) => ({
      start: draft.start === serverTimes.current.start ? w.start : draft.start,
      end: draft.end === serverTimes.current.end ? w.end : draft.end,
    }));
    serverTimes.current = { start: w.start, end: w.end };
  }, [view]);

  /** One write path. Every control on this page goes through it and toasts
   *  what it changed — no control writes silently, none defers to a Save. */
  async function write(patch: GuardrailDefaults, said: string) {
    setBusy(true);
    const next: GuardrailDefaults = {
      dailyCap: { ...(stored.dailyCap ?? {}), ...(patch.dailyCap ?? {}) },
      sendingWindow: patch.sendingWindow ?? stored.sendingWindow ?? window,
    };
    if (next.dailyCap && Object.keys(next.dailyCap).length === 0) delete next.dailyCap;
    const res = await patchGuardrailDefaults(next);
    setBusy(false);
    if (!res.ok) {
      flash(res.error);
      await reload();
      return;
    }
    flash(said);
    await reload();
  }

  async function commitCap(key: "email" | "sms" | "voice") {
    const raw = caps[key].trim();
    if (raw === "") return;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) {
      flash(`A ${key} ceiling is a whole number between 1 and 10,000.`);
      return;
    }
    if (stored.dailyCap?.[key] === n) return;
    await write({ dailyCap: { [key]: n } }, `${CHANNELS.find((c) => c.key === key)!.label} is now ${n} a day.`);
  }

  const campaigns = view?.campaigns ?? [];
  const baseEmail = stored.dailyCap?.email ?? DEFAULT_GUARDRAILS.dailyCap.email;
  const departures = campaigns
    .map((c) => {
      if (c.dailyCap == null) return null;
      const diffs: string[] = [];
      if (c.dailyCap.email !== baseEmail) diffs.push(`email ${c.dailyCap.email} a day instead of ${baseEmail}`);
      const sms = stored.dailyCap?.sms;
      if (sms != null && c.dailyCap.sms != null && c.dailyCap.sms !== sms)
        diffs.push(`SMS ${c.dailyCap.sms} instead of ${sms}`);
      const voice = stored.dailyCap?.voice;
      if (voice != null && c.dailyCap.voice != null && c.dailyCap.voice !== voice)
        diffs.push(`calls ${c.dailyCap.voice} instead of ${voice}`);
      if (c.sendingWindow && (c.sendingWindow.start !== times.start || c.sendingWindow.end !== times.end))
        diffs.push(`sends ${c.sendingWindow.start}–${c.sendingWindow.end}`);
      return diffs.length > 0 ? { c, diffs } : null;
    })
    .filter((x): x is { c: (typeof campaigns)[number]; diffs: string[] } => x !== null);

  const limitsOn =
    (stored.dailyCap ? Object.keys(stored.dailyCap).length : 0) + ALWAYS_ON.length + (stored.sendingWindow ? 1 : 0);

  const stats = [
    { label: "LIMITS ON", value: String(limitsOn), sub: "workspace-wide", tone: "forest" as const },
    {
      label: "CAMPAIGNS INHERITING",
      value: String(campaigns.length - departures.length),
      sub: campaigns.length === 0 ? "none yet" : departures.length === 0 ? "all of them" : `of ${campaigns.length}`,
      tone: "ink" as const,
    },
    {
      label: "OVERRIDES",
      value: String(departures.length),
      sub: departures.length === 0 ? "nothing departs" : departures[0]!.c.name,
      tone: departures.length === 0 ? ("forest" as const) : ("amber" as const),
    },
  ];

  const worst = departures[0];
  const ada: { note: string | null; actionLabel?: string; onAct?: () => void } = worst
    ? {
        note: `${worst.c.name} runs on its own limits — ${worst.diffs.join(", ")}. Changing a workspace default does not reach a campaign that already exists, so that difference stays until someone changes it there.`,
        actionLabel: `Open ${worst.c.name}`,
        onAct: () => onOpenCampaign(worst.c.id),
      }
    : stored.dailyCap == null
      ? {
          note: `Nothing is set here yet, so every new campaign starts from the platform baseline — ${DEFAULT_GUARDRAILS.dailyCap.email} emails a day, ${DEFAULT_GUARDRAILS.sendingWindow.start}–${DEFAULT_GUARDRAILS.sendingWindow.end}. Typing a ceiling below makes it yours.`,
        }
      : { note: null };

  const voiceRows: SettingsRow[] = ALWAYS_ON.map(([n, sub]) => ({
    t: "tg",
    key: n,
    n,
    sub,
    on: true,
    locked: true,
    onFlip: () => undefined,
  }));

  const overrideRows: SettingsRow[] = campaigns.map((c) => {
    const dep = departures.find((d) => d.c.id === c.id);
    return {
      t: "chip",
      key: c.id,
      n: c.name,
      sub: dep ? dep.diffs.join(" · ") : "Inherits everything",
      chip: dep ? "Tighter" : "Default",
      tone: dep ? "warn" : "mute",
      onOpen: () => onOpenCampaign(c.id),
    };
  });

  const weekendOn = (window.days ?? []).some((d) => d === 6 || d === 7);

  return (
    <BoldItemPage
      kind="WORKSPACE"
      title="Guardrails"
      status={{ label: "Every new campaign inherits these", tone: "live" }}
      stats={stats}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      onBack={onBack}
      onHeader={onHeader}
      ada={ada}
      recordId={data.workspaceId}
      testid="bold-wss-guard-item"
    >
      {tab === 0 ? (
        <div style={{ maxWidth: 620 }}>
          {CHANNELS.map((c, i) => (
            <div
              key={c.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "15px 4px",
                borderBottom: i === CHANNELS.length - 1 ? "none" : "1px solid var(--cvb-line-inner)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "-.016em" }}>{c.label}</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3 }}>
                  {stored.dailyCap?.[c.key] == null
                    ? c.key === "email"
                      ? `${c.sub} — the platform baseline is ${DEFAULT_GUARDRAILS.dailyCap.email}`
                      : `${c.sub} — no ceiling of your own yet`
                    : c.sub}
                </div>
              </div>
              <input
                value={caps[c.key]}
                onChange={(e) => setCaps((v) => ({ ...v, [c.key]: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                onBlur={() => void commitCap(c.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commitCap(c.key);
                }}
                inputMode="numeric"
                aria-label={c.label}
                placeholder={c.key === "email" ? String(DEFAULT_GUARDRAILS.dailyCap.email) : "—"}
                data-testid={`bold-guard-cap-${c.key}`}
                style={{
                  background: "var(--cvb-well-fill-2)",
                  border: "1px solid var(--cvb-well-line-2)",
                  boxShadow: "var(--cvb-shadow-well)",
                  borderRadius: 12,
                  padding: "9px 12px",
                  width: 84,
                  textAlign: "right",
                  fontFamily: "var(--cvb-font-mono)",
                  fontSize: 12.5,
                  color: "var(--cvb-ink)",
                  outline: "none",
                  flex: "none",
                }}
              />
            </div>
          ))}
          <TabNote>
            A CEILING SAVES THE MOMENT YOU LEAVE THE FIELD. IT APPLIES TO CAMPAIGNS YOU CREATE FROM NOW ON — LIVE ONES
            KEEP THE LIMITS THEY WERE CREATED WITH, AND THE OVERRIDES TAB NAMES THEM.
          </TabNote>
        </div>
      ) : null}

      {tab === 1 ? (
        <>
          <RowList rows={voiceRows} testid="bold-guard-voice" />
          <TabNote>
            THESE ARE ENFORCED AT THE SEND BOUNDARY, NOT IN THE INTERFACE — THEY HOLD EVEN IF SOMETHING ELSE ASKS FOR A
            SEND. PER-CAMPAIGN VOICE — THE SELLING ARC, BANNED PHRASES, HER STANDING INSTRUCTIONS — LIVES ON EACH
            CAMPAIGN&rsquo;S OWN SETTINGS.
          </TabNote>
        </>
      ) : null}

      {tab === 2 ? (
        <div style={{ maxWidth: 620 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 4px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>Sending hours</div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3 }}>
                Nothing lands outside them ({window.timezone})
              </div>
            </div>
            {(["start", "end"] as const).map((k) => (
              <input
                key={k}
                value={times[k]}
                onChange={(e) => setTimes((t) => ({ ...t, [k]: e.target.value }))}
                onBlur={() => {
                  const ok = /^([01]\d|2[0-3]):[0-5]\d$/;
                  if (!ok.test(times.start) || !ok.test(times.end)) {
                    flash("Quiet hours need times like 09:00 and 17:00.");
                    return;
                  }
                  if (times.start === window.start && times.end === window.end) return;
                  void write(
                    { sendingWindow: { ...window, start: times.start, end: times.end } },
                    `She sends between ${times.start} and ${times.end} now.`,
                  );
                }}
                aria-label={k === "start" ? "Sending starts" : "Sending ends"}
                data-testid={`bold-guard-window-${k}`}
                style={{
                  background: "var(--cvb-well-fill-2)",
                  border: "1px solid var(--cvb-well-line-2)",
                  boxShadow: "var(--cvb-shadow-well)",
                  borderRadius: 12,
                  padding: "9px 12px",
                  width: 70,
                  textAlign: "center",
                  fontFamily: "var(--cvb-font-mono)",
                  fontSize: 12.5,
                  color: "var(--cvb-ink)",
                  outline: "none",
                  flex: "none",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "15px 4px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>Weekend sending</div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3 }}>
                {weekendOn ? "Saturdays included" : "Off means weekends stay silent"}
              </div>
            </div>
            <Toggle
              on={weekendOn}
              label="Weekend sending"
              testid="bold-guard-weekend"
              onFlip={() => {
                if (busy) return;
                const days = weekendOn ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6];
                void write(
                  { sendingWindow: { ...window, days } },
                  weekendOn ? "Weekends are silent again." : "Saturday sending is on.",
                );
              }}
            />
          </div>
          <TabNote>
            CURRENTLY {(window.days ?? []).map((d) => DAY_LABEL[d]).filter(Boolean).join(" · ").toUpperCase()} ·{" "}
            {window.start}–{window.end} {window.timezone.toUpperCase()}. CALLS ALSO RESPECT THE CONTACT&rsquo;S OWN
            LOCAL HOURS ON TOP OF THIS.
          </TabNote>
        </div>
      ) : null}

      {tab === 3 ? (
        campaigns.length === 0 ? (
          <EmptyTab
            testid="bold-guard-over-none"
            line="No campaigns yet. Once you have some, the ones running on their own limits are named here."
          />
        ) : (
          <>
            <RowList rows={overrideRows} testid="bold-guard-over" />
            <TabNote>
              {departures.length === 0
                ? "EVERY CAMPAIGN MATCHES THESE DEFAULTS RIGHT NOW."
                : `${pluralise(departures.length, "CAMPAIGN DEPARTS", "CAMPAIGNS DEPART").toUpperCase()} FROM THE WORKSPACE DEFAULT. OPEN ONE TO CHANGE IT THERE — THIS PAGE SETS WHAT NEW CAMPAIGNS START FROM.`}
            </TabNote>
          </>
        )
      ) : null}
    </BoldItemPage>
  );
}

