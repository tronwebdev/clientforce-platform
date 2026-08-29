"use client";

/**
 * B7 (DEC-132): Settings & Business core as ONE surface — the prototype's
 * wssettings hub (six cards) + the WORKSPACE item pages (Business core ·
 * Senders · Team · Guardrails), every number a query, nothing canned.
 *
 * Honesty rails on this page:
 *  - Facts/gaps are the REAL context spine: workspace-layer fields + the
 *    union of the live campaigns' gap reports (gaps are goal-relative;
 *    the union is "what your live campaigns still miss"). Answering a gap
 *    here writes the WORKSPACE layer, so every campaign benefits.
 *  - Sender rows are the shipped `/senders` read (DNS posture, health,
 *    warm-up, today's count); the add-identity wizard rides the SAME
 *    create/dns-check endpoints the classic console uses. DEC-123: one
 *    identity per workspace per channel, resolved automatically.
 *  - Team lists the REAL memberships (roles are the real enum — Owner,
 *    Admin, Agent). Invites have no spine yet — visibly deferred (Q-112).
 *  - Guardrails here are the workspace DEFAULTS a NEW campaign starts
 *    from; editing one never rewrites a live campaign (Q-109) and the
 *    overrides tab says which campaigns currently differ. Value inputs are
 *    typed recessed wells — the owner's Q-081 ruling (steppers retired).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTEXT_FIELD_META } from "@clientforce/core";
import { mono, BoldMetaStrip } from "./bold-cards";
import {
  answerWorkspaceGap,
  createEmailSender,
  fetchBoldAgents,
  fetchCreditsSummary,
  fetchGapReport,
  fetchGuardrailDefaults,
  fetchSenders,
  fetchWorkspaceMembers,
  patchGuardrailDefaults,
  runDnsCheck,
  type BoldGapItem,
  type BoldSenderRow,
  type GuardrailDefaultsView,
  type WorkspaceMemberRow,
} from "./bold-live";

type ItemKey = null | "core" | "senders" | "team" | "guard";

const CH = {
  well: {
    ...mono,
    fontSize: 12.5,
    background: "var(--cvb-well)",
    border: "1px solid var(--cvb-line-ctl)",
    borderRadius: 10,
    padding: "8px 11px",
    width: 76,
    textAlign: "right" as const,
    outline: "none",
    color: "var(--cvb-ink)",
  },
  chip: (fg: string, bg: string, bd: string) => ({
    fontSize: 9.5,
    fontWeight: 700 as const,
    color: fg,
    background: bg,
    border: `1px solid ${bd}`,
    borderRadius: 999,
    padding: "3px 9px",
    flex: "none" as const,
  }),
};

const CHIP_LIVE = CH.chip("var(--cvb-forest)", "var(--cvb-mint)", "var(--cvb-mint-line)");
const CHIP_WARN = CH.chip("var(--cvb-amber,#8A6D1A)", "var(--cvb-amber-bg,#F7EFDA)", "var(--cvb-amber-line,#EAD9A8)");
const CHIP_MUTE = CH.chip("var(--cvb-faint)", "var(--cvb-panel)", "var(--cvb-line-ctl)");

interface CoreField {
  key: string;
  label: string;
  value: string;
  source: string;
}
interface GapUnionRow extends BoldGapItem {
  campaigns: string[];
}

function rowStyle(last: boolean) {
  return {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "15px 4px",
    borderBottom: last ? "none" : "1px solid var(--cvb-line-inner)",
  } as const;
}

export function BoldWsSettingsView({
  onOpenCredits,
  flash,
}: {
  onOpenCredits: () => void;
  flash: (msg: string) => void;
}) {
  const [item, setItem] = useState<ItemKey>(null);
  const [tab, setTab] = useState(0);

  const [fields, setFields] = useState<CoreField[] | null>(null);
  const [coreTouched, setCoreTouched] = useState<string | null>(null);
  const [gaps, setGaps] = useState<GapUnionRow[] | null>(null);
  const [sources, setSources] = useState<Array<{ id: string; name: string; status: string; kind: string }> | null>(null);
  const [senders, setSenders] = useState<BoldSenderRow[] | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberRow[] | null>(null);
  const [guard, setGuard] = useState<GuardrailDefaultsView | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [connectedInts, setConnectedInts] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [ctx, agentList, senderRows, memberRows, guardView, credits, ints] = await Promise.all([
      fetch("/api/cf/context").then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{
        workspace?: { fields?: Record<string, { value?: string; source?: string }>; updatedAt?: string } | null;
        merged?: Record<string, { value?: string; source?: string } | undefined>;
      } | null>,
      fetchBoldAgents(),
      fetchSenders(),
      fetchWorkspaceMembers(),
      fetchGuardrailDefaults(),
      fetchCreditsSummary(),
      fetch("/api/cf/integrations").then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{
        integrations?: Array<{ status?: string }>;
      } | null>,
    ]);
    const wsFields = (ctx?.workspace?.fields ?? {}) as Record<string, { value?: string; source?: string }>;
    setFields(
      Object.entries(wsFields)
        .filter(([, v]) => (v?.value ?? "").trim().length > 0)
        .map(([key, v]) => ({
          key,
          label: (CONTEXT_FIELD_META as Record<string, { label: string }>)[key]?.label ?? key,
          value: v.value ?? "",
          source: v.source ?? "typed",
        })),
    );
    setCoreTouched(ctx?.workspace?.updatedAt ?? null);
    const live = (agentList ?? []).filter((a) => a.status === "ACTIVE" || a.status === "PAUSED");
    const reports = await Promise.all(live.map((a) => fetchGapReport(a.id, a.goal)));
    const union = new Map<string, GapUnionRow>();
    reports.forEach((rep, i) => {
      for (const g of rep?.gaps ?? []) {
        if (g.status !== "open") continue;
        const prior = union.get(g.key);
        if (prior) prior.campaigns.push(live[i]!.name);
        else union.set(g.key, { ...g, campaigns: [live[i]!.name] });
      }
    });
    setGaps([...union.values()]);
    setSenders(senderRows ?? []);
    setMembers(memberRows ?? []);
    setGuard(guardView);
    setBalance(credits?.balance ?? null);
    setConnectedInts(ints ? (ints.integrations ?? []).filter((s) => s.status === "connected").length : null);
    const src = (await fetch("/api/cf/knowledge/sources").then((r) => (r.ok ? r.json() : null)).catch(() => null)) as Array<{
      id: string;
      label: string;
      status: string;
      kind: string;
    }> | null;
    setSources(
      (Array.isArray(src) ? src : []).map((s) => ({
        id: s.id,
        name: s.label || "Untitled source",
        status: s.status,
        kind: s.kind.toLowerCase(),
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const emailSenders = (senders ?? []).filter((s) => s.type !== "TWILIO_SMS");
  const smsSenders = (senders ?? []).filter((s) => s.type === "TWILIO_SMS");
  const gapCount = gaps?.length ?? 0;
  const openItem = (k: Exclude<ItemKey, null>) => {
    setItem(k);
    setTab(0);
  };

  /* ------------------------------------------------------------------ hub */
  if (item === null) {
    const cards: Array<{
      key: Exclude<ItemKey, null> | "credits" | "integrations";
      n: string;
      sub: string;
      ic: string;
      tint: [string, string, string];
      flag?: { label: string; tone: "live" | "warn" };
      testid: string;
    }> = [
      {
        key: "core",
        n: "Business core",
        sub:
          fields === null
            ? "Who you are, what you sell — everything Ada quotes."
            : `${fields.length} facts she quotes from. ${gapCount === 0 ? "Your live campaigns are not missing anything." : `${gapCount} thing${gapCount === 1 ? "" : "s"} your live campaigns still miss.`}`,
        ic: "◉",
        tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
        flag: gaps === null ? undefined : gapCount > 0 ? { label: `${gapCount} gap${gapCount === 1 ? "" : "s"}`, tone: "warn" } : { label: "No gaps", tone: "live" },
        testid: "bold-wss-core",
      },
      {
        key: "senders",
        n: "Senders",
        sub:
          senders === null
            ? "Your sending identities per channel."
            : `${emailSenders.length} email identit${emailSenders.length === 1 ? "y" : "ies"} · ${smsSenders.length} number${smsSenders.length === 1 ? "" : "s"}. One identity per channel — campaigns pick it up automatically.`,
        ic: "✉",
        tint: ["var(--cvb-cyan-tint,#E2F3F6)", "var(--cvb-cyan-line,#BFE3EB)", "var(--cvb-cyan,#0E7D93)"],
        flag:
          senders === null
            ? undefined
            : emailSenders.some((s) => s.health?.state === "unhealthy")
              ? { label: "Needs a look", tone: "warn" }
              : { label: `${(senders ?? []).filter((s) => s.status === "ACTIVE").length} active`, tone: "live" },
        testid: "bold-wss-senders",
      },
      {
        key: "team",
        n: "Team and roles",
        sub: members === null ? "Who can do what here." : `${members.length} ${members.length === 1 ? "person" : "people"} plus Ada. Owner, admin, agent.`,
        ic: "◍",
        tint: ["var(--cvb-plum-bg,#F0EDF9)", "var(--cvb-plum-line,#DCD5EF)", "var(--cvb-plum,#5B4A8A)"],
        testid: "bold-wss-team",
      },
      {
        key: "guard",
        n: "Guardrails",
        sub: "The limits every NEW campaign starts from — live campaigns keep their own.",
        ic: "⛨",
        tint: ["var(--cvb-amber-bg,#F7EFDA)", "var(--cvb-amber-line,#EAD9A8)", "var(--cvb-amber,#8A6D1A)"],
        testid: "bold-wss-guard",
      },
      {
        key: "credits",
        n: "Credits and usage",
        sub: balance === null ? "Where they go and what things cost." : `${balance.toLocaleString("en-US")} left. Where they go, what things cost.`,
        ic: "◆",
        tint: ["var(--cvb-mint)", "var(--cvb-mint-line)", "var(--cvb-forest)"],
        testid: "bold-wss-credits",
      },
      {
        key: "integrations",
        n: "Integrations",
        sub: connectedInts === null ? "Calendar, payments and the rest." : `${connectedInts} connected.`,
        ic: "⇄",
        tint: ["var(--cvb-panel)", "var(--cvb-line-ctl)", "var(--cvb-muted)"],
        flag: connectedInts != null && connectedInts > 0 ? { label: `${connectedInts} connected`, tone: "live" } : undefined,
        testid: "bold-wss-integrations",
      },
    ];
    return (
      <div data-testid="bold-wssettings" style={{ padding: "26px 40px 40px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {cards.map((c) => (
            <div
              key={c.key}
              data-testid={c.testid}
              onClick={() => {
                if (c.key === "credits") onOpenCredits();
                else if (c.key === "integrations") flash("Integrations live in the dock — opening soon here");
                else openItem(c.key);
              }}
              style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 20, padding: 20, cursor: "pointer" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 34, height: 34, borderRadius: 12, flex: "none", background: c.tint[0], border: `1px solid ${c.tint[1]}`, color: c.tint[2], display: "grid", placeItems: "center", fontSize: 14 }}>
                  {c.ic}
                </span>
                <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", flex: 1 }}>{c.n}</span>
                <span style={{ fontSize: 13, color: "var(--cvb-faint)" }}>→</span>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 11 }}>{c.sub}</div>
              {c.flag ? (
                <span style={{ ...(c.flag.tone === "live" ? CHIP_LIVE : CHIP_WARN), display: "inline-block", marginTop: 12 }}>{c.flag.label}</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------- item shell */
  const back = (
    <span onClick={() => setItem(null)} data-testid="bold-wss-back" style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)" }}>
      ← Settings
    </span>
  );
  const tabRow = (labels: string[]) => (
    <div style={{ display: "flex", gap: 18, padding: "14px 40px 0", borderBottom: "1px solid var(--cvb-line-inner)", alignItems: "center", flexWrap: "wrap" }}>
      {back}
      {labels.map((l, i) => (
        <span
          key={l}
          onClick={() => setTab(i)}
          style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, padding: "6px 2px 12px", color: tab === i ? "var(--cvb-ink,#101613)" : "var(--cvb-faint)", borderBottom: tab === i ? "2px solid var(--cvb-forest)" : "2px solid transparent" }}
        >
          {l}
        </span>
      ))}
    </div>
  );

  if (item === "core") {
    return (
      <BoldCoreItem
        fields={fields ?? []}
        gaps={gaps ?? []}
        sources={sources ?? []}
        touched={coreTouched}
        tab={tab}
        tabRow={tabRow}
        flash={flash}
        reload={load}
      />
    );
  }
  if (item === "senders") {
    return <BoldSendersItem email={emailSenders} sms={smsSenders} tab={tab} tabRow={tabRow} flash={flash} reload={load} />;
  }
  if (item === "team") {
    return <BoldTeamItem members={members ?? []} tab={tab} tabRow={tabRow} />;
  }
  return <BoldGuardItem view={guard} tab={tab} tabRow={tabRow} flash={flash} reload={load} />;
}

/* ---------------------------------------------------------- Business core */

function BoldCoreItem({
  fields,
  gaps,
  sources,
  touched,
  tab,
  tabRow,
  flash,
  reload,
}: {
  fields: CoreField[];
  gaps: GapUnionRow[];
  sources: Array<{ id: string; name: string; status: string; kind: string }>;
  touched: string | null;
  tab: number;
  tabRow: (labels: string[]) => React.ReactNode;
  flash: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const touchedDays = touched ? Math.floor((Date.now() - new Date(touched).getTime()) / 86_400_000) : null;
  const IDENTITY_KEYS = new Set(["company_address", "offer", "usp", "icp", "services"]);
  const identity = fields.filter((f) => IDENTITY_KEYS.has(f.key));
  const knows = fields;

  async function answer(key: string) {
    const value = (draft[key] ?? "").trim();
    if (!value) return;
    // No agentId: the write lands on the WORKSPACE layer, so every campaign
    // that needs this fact stops asking (the B2.5 answers rail, same rules).
    const res = await answerWorkspaceGap(key, value);
    if (!res.ok) {
      flash(res.error || "That answer did not save — try again.");
      return;
    }
    setDraft((d) => ({ ...d, [key]: "" }));
    flash("Saved — every campaign that needs it now has it.");
    await reload();
  }

  return (
    <div data-testid="bold-wss-core-item">
      <BoldMetaStrip
        items={[
          ["FACTS SHE KNOWS", String(fields.length), "from your business core"],
          ["GAPS", String(gaps.length), gaps.length === 0 ? "nothing missing for your live campaigns" : "she will not invent them"],
          ["LAST TOUCHED", touchedDays === null ? "—" : touchedDays === 0 ? "today" : `${touchedDays}d`, "the workspace layer"],
        ]}
      />
      {tabRow(["What she knows", "Gaps", "Who you are", "Where it comes from"])}
      <div style={{ padding: "22px 40px 40px" }}>
        {tab === 0 ? (
          knows.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>No workspace facts yet — answer a gap and it lands here.</div>
          ) : (
            knows.map((f, i) => (
              <div key={f.key} style={rowStyle(i === knows.length - 1)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.018em" }}>{f.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2, lineHeight: 1.45, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.value}</div>
                </div>
                <span style={f.source === "typed" ? CHIP_LIVE : CHIP_MUTE}>{f.source === "typed" ? "You told her" : f.source === "ai_decides" ? "Ada decides" : "Distilled"}</span>
              </div>
            ))
          )
        ) : null}
        {tab === 1 ? (
          gaps.length === 0 ? (
            <div data-testid="bold-wss-gaps-none" style={{ fontSize: 13, color: "var(--cvb-faint)" }}>
              Nothing is missing for your live campaigns. New campaigns may ask for more — their gaps show up here.
            </div>
          ) : (
            gaps.map((g, i) => (
              <div key={g.key} style={{ ...rowStyle(i === gaps.length - 1), alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.018em" }}>{g.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                    Needed by {g.campaigns.join(", ")}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                    <input
                      value={draft[g.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [g.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void answer(g.key);
                      }}
                      placeholder="Type the answer…"
                      data-testid={`bold-wss-gap-input-${g.key}`}
                      style={{ ...CH.well, width: "min(420px, 100%)", textAlign: "left" }}
                    />
                    <span onClick={() => void answer(g.key)} style={{ fontSize: 12, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 10, padding: "8px 13px", cursor: "pointer", alignSelf: "center" }}>
                      Save
                    </span>
                  </div>
                </div>
                <span style={CHIP_WARN}>Gap</span>
              </div>
            ))
          )
        ) : null}
        {tab === 2 ? (
          identity.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>The identity facts — who you are, what you sell — land here as you answer them.</div>
          ) : (
            identity.map((f, i) => (
              <div key={f.key} style={rowStyle(i === identity.length - 1)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{f.label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2, lineHeight: 1.5 }}>{f.value}</div>
                </div>
                <span style={CHIP_LIVE}>Core</span>
              </div>
            ))
          )
        ) : null}
        {tab === 3 ? (
          sources.length === 0 ? (
            <div data-testid="bold-wss-sources-none" style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
              No sources yet. Everything she knows was typed by you — add your website or upload a price list from a campaign&rsquo;s
              knowledge step and it shows up here.
            </div>
          ) : (
            sources.map((s, i) => (
              <div key={s.id} style={rowStyle(i === sources.length - 1)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.name}</div>
                  <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginTop: 2 }}>{s.kind}</div>
                </div>
                <span style={s.status === "READY" || s.status === "ready" ? CHIP_LIVE : CHIP_MUTE}>{s.status.toLowerCase()}</span>
              </div>
            ))
          )
        ) : null}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Senders */

function BoldSendersItem({
  email,
  sms,
  tab,
  tabRow,
  flash,
  reload,
}: {
  email: BoldSenderRow[];
  sms: BoldSenderRow[];
  tab: number;
  tabRow: (labels: string[]) => React.ReactNode;
  flash: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const [wiz, setWiz] = useState<null | { step: 0 | 1; fromEmail: string; fromName: string; replyTo: string; senderId?: string; dns?: string }>(null);
  const sentToday = [...email, ...sms].reduce((n, s) => n + (s.sentToday ?? 0), 0);

  const dnsSummary = (s: BoldSenderRow): ["pass" | "pending" | "unknown", string] => {
    const st = s.domainAuthStatus ?? {};
    const vals = Object.values(st).map((v) => String((v as { status?: string })?.status ?? v));
    if (vals.length === 0) return ["unknown", "not checked yet"];
    if (vals.every((v) => v.toLowerCase().includes("pass") || v.toLowerCase() === "ok" || v.toLowerCase() === "verified")) return ["pass", "SPF, DKIM verified"];
    return ["pending", "records pending"];
  };

  async function createIdentity() {
    if (!wiz) return;
    const res = await createEmailSender({
      fromEmail: wiz.fromEmail.trim(),
      ...(wiz.fromName.trim() ? { fromName: wiz.fromName.trim() } : {}),
      ...(wiz.replyTo.trim() ? { replyTo: wiz.replyTo.trim() } : {}),
    });
    if (!res.ok) {
      flash(res.error || "That identity did not save — check the address.");
      return;
    }
    const id = (res.body as { id?: string })?.id;
    setWiz({ ...wiz, step: 1, senderId: id });
    flash("Identity created — now verify the domain records.");
    await reload();
  }

  async function checkDns() {
    if (!wiz?.senderId) return;
    const res = await runDnsCheck(wiz.senderId);
    if (!res.ok) {
      setWiz({ ...wiz, dns: res.error || "The check did not run — try again." });
      return;
    }
    setWiz({ ...wiz, dns: "Checked — the posture is on the sender row now." });
    await reload();
  }

  return (
    <div data-testid="bold-wss-senders-item">
      <BoldMetaStrip
        items={[
          ["EMAIL IDENTITIES", String(email.length), email.length === 1 ? "campaigns use it automatically" : email.length === 0 ? "none yet" : "the first active one sends"],
          ["NUMBERS", String(sms.length), sms.length === 0 ? "outbound calls use the platform line" : "SMS identity"],
          ["SENT TODAY", String(sentToday), "across every identity"],
        ]}
      />
      {tabRow(["Email", "Numbers", "Health"])}
      <div style={{ padding: "22px 40px 40px" }}>
        <div style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", marginBottom: 14, lineHeight: 1.6 }}>
          ONE IDENTITY PER WORKSPACE PER CHANNEL — CAMPAIGNS RESOLVE IT AUTOMATICALLY, NO PICKERS
        </div>
        {tab === 0 ? (
          <>
            {email.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>No email identity yet — add one below and campaigns pick it up.</div>
            ) : (
              email.map((s, i) => {
                const [dns, dnsLine] = dnsSummary(s);
                return (
                  <div key={s.id} style={rowStyle(i === email.length - 1)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.fromEmail}</div>
                      <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                        {s.fromName ? `Sends as ${s.fromName}` : "No from-name yet — sends fail without one"}
                        {s.replyTo ? ` · replies to ${s.replyTo}` : ""} · {dnsLine}
                      </div>
                    </div>
                    <span style={dns === "pass" ? CHIP_LIVE : dns === "pending" ? CHIP_WARN : CHIP_MUTE}>
                      {s.status === "ACTIVE" ? (dns === "pass" ? "Verified" : dns === "pending" ? "Verifying" : "Unchecked") : s.status.toLowerCase()}
                    </span>
                  </div>
                );
              })
            )}
            {!wiz ? (
              <div
                onClick={() => setWiz({ step: 0, fromEmail: "", fromName: "", replyTo: "" })}
                data-testid="bold-wss-add-sender"
                style={{ display: "flex", alignItems: "center", gap: 12, border: "1px dashed var(--cvb-line-ctl)", borderRadius: 16, padding: 15, cursor: "pointer", marginTop: 14 }}
              >
                <span style={{ width: 30, height: 30, borderRadius: 10, border: "1px dashed var(--cvb-line-ctl)", color: "var(--cvb-faint)", display: "grid", placeItems: "center", fontSize: 14, flex: "none" }}>+</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cvb-cyan,#0E7D93)" }}>Add an email identity</span>
              </div>
            ) : (
              <div data-testid="bold-wss-sender-wizard" style={{ background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 18, padding: 18, marginTop: 14 }}>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>
                  {wiz.step === 0 ? "NEW EMAIL IDENTITY · 1 OF 2" : "VERIFY THE DOMAIN · 2 OF 2"}
                </div>
                {wiz.step === 0 ? (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, marginTop: 14 }}>
                      {(
                        [
                          ["Address it sends from", "fromEmail", "hello@yourpractice.com"],
                          ["The name people see", "fromName", "Bright Smile Dental"],
                          ["Replies go to (optional)", "replyTo", "front-desk@yourpractice.com"],
                        ] as const
                      ).map(([label, key, ph]) => (
                        <label key={key} style={{ display: "block" }}>
                          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", marginBottom: 6 }}>{label.toUpperCase()}</div>
                          <input
                            value={wiz[key]}
                            onChange={(e) => setWiz({ ...wiz, [key]: e.target.value })}
                            placeholder={ph}
                            data-testid={`bold-wss-wiz-${key}`}
                            style={{ ...CH.well, width: "100%", textAlign: "left", boxSizing: "border-box" as const }}
                          />
                        </label>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
                      <span onClick={() => void createIdentity()} data-testid="bold-wss-wiz-create" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }}>
                        Create it
                      </span>
                      <span onClick={() => setWiz(null)} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)", padding: "10px 12px", cursor: "pointer" }}>
                        Not now
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.6, marginTop: 12 }}>
                      The identity exists. Run the domain check — it reads your DNS and stamps the SPF/DKIM posture on the row; until it
                      passes, sends from this identity stay held by the boundary.
                    </div>
                    {wiz.dns ? <div style={{ ...mono, fontSize: 11, color: "var(--cvb-forest)", marginTop: 10 }}>{wiz.dns}</div> : null}
                    <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
                      <span onClick={() => void checkDns()} data-testid="bold-wss-wiz-dns" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 15px", cursor: "pointer" }}>
                        Check the records
                      </span>
                      <span onClick={() => setWiz(null)} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-faint)", padding: "10px 12px", cursor: "pointer" }}>
                        Done
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        ) : null}
        {tab === 1 ? (
          <>
            {sms.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
                No SMS number yet — connecting one needs your Twilio messaging service (the classic console&rsquo;s SMS section walks
                through it). Outbound calls dial from the platform line until the number unit lands.
              </div>
            ) : (
              sms.map((s, i) => (
                <div key={s.id} style={rowStyle(i === sms.length - 1)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.fromEmail}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>SMS · {s.sentToday ?? 0} sent today of {s.dailyLimit ?? "—"}</div>
                  </div>
                  <span style={s.status === "ACTIVE" ? CHIP_LIVE : CHIP_MUTE}>{s.status.toLowerCase()}</span>
                </div>
              ))
            )}
            <div style={{ ...rowStyle(true), opacity: 0.75 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Voice</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                  Outbound calls dial from the platform line. Your own number — one identity for SMS, calls and the receptionist — arrives
                  with the numbering unit.
                </div>
              </div>
              <span style={CHIP_MUTE}>Platform line</span>
            </div>
          </>
        ) : null}
        {tab === 2 ? (
          [...email, ...sms].length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>Health arrives with your first identity.</div>
          ) : (
            [...email, ...sms].map((s, i, arr) => (
              <div key={s.id} style={rowStyle(i === arr.length - 1)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{s.fromEmail}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                    {s.sentToday ?? 0} today of {s.dailyLimit ?? "—"} · {s.health?.score != null ? `health ${s.health.score}/100` : "no health sweep yet — never invented"}
                    {s.warmup?.cap != null ? ` · warming, today's ceiling ${s.warmup.cap}` : ""}
                  </div>
                </div>
                <span style={s.health?.state === "unhealthy" ? CHIP_WARN : s.health?.score != null ? CHIP_LIVE : CHIP_MUTE}>
                  {s.health?.state ?? "no data"}
                </span>
              </div>
            ))
          )
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Team */

function BoldTeamItem({
  members,
  tab,
  tabRow,
}: {
  members: WorkspaceMemberRow[];
  tab: number;
  tabRow: (labels: string[]) => React.ReactNode;
}) {
  const owners = members.filter((m) => m.role === "OWNER").length;
  const ROLES: Array<[string, string]> = [
    ["Owner", "Everything, including senders, guardrails and credits."],
    ["Admin", "Campaigns, inbox, contacts and settings — cannot change who is on the team."],
    ["Agent", "Works campaigns and the inbox."],
  ];
  return (
    <div data-testid="bold-wss-team-item">
      <BoldMetaStrip
        items={[
          ["PEOPLE", String(members.length), "plus Ada"],
          ["OWNERS", String(owners), owners === 1 ? "just one" : "shared"],
          ["PENDING INVITES", "—", "invites are on their way"],
        ]}
      />
      {tabRow(["People", "What roles can do"])}
      <div style={{ padding: "22px 40px 40px" }}>
        {tab === 0 ? (
          <>
            {members.map((m) => (
              <div key={m.userId} style={rowStyle(false)}>
                <span style={{ width: 34, height: 34, borderRadius: 12, flex: "none", background: "var(--cvb-mint)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontWeight: 900, fontSize: 13 }}>
                  {(m.name ?? m.email).slice(0, 2).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{m.name ?? m.email}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>{m.email}</div>
                </div>
                <span style={m.role === "OWNER" ? CHIP_LIVE : CHIP_MUTE}>{m.role.toLowerCase()}</span>
              </div>
            ))}
            <div style={rowStyle(true)}>
              <span style={{ width: 34, height: 34, borderRadius: 12, flex: "none", background: "var(--cvb-mint)", color: "var(--cvb-forest)", display: "grid", placeItems: "center", fontSize: 14 }}>✦</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Ada</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>Acts inside your guardrails — every action lands on the timeline.</div>
              </div>
              <span style={CHIP_MUTE}>agent</span>
            </div>
            <div
              data-testid="bold-wss-invite-deferred"
              style={{ marginTop: 18, background: "var(--cvb-well)", border: "1px dashed var(--cvb-line-ctl)", borderRadius: 14, padding: "12px 15px", fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.5 }}
            >
              Inviting someone new is on its way — today the classic console&rsquo;s team page shows the same people.
            </div>
          </>
        ) : (
          ROLES.map(([n, sub], i) => (
            <div key={n} style={rowStyle(i === ROLES.length - 1)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{n}</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>{sub}</div>
              </div>
              <span style={CHIP_MUTE}>role</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Guardrails */

function BoldGuardItem({
  view,
  tab,
  tabRow,
  flash,
  reload,
}: {
  view: GuardrailDefaultsView | null;
  tab: number;
  tabRow: (labels: string[]) => React.ReactNode;
  flash: (m: string) => void;
  reload: () => Promise<void>;
}) {
  const d = view?.defaults ?? {};
  const [caps, setCaps] = useState<{ email: string; sms: string; voice: string }>({
    email: d.dailyCap?.email != null ? String(d.dailyCap.email) : "",
    sms: d.dailyCap?.sms != null ? String(d.dailyCap.sms) : "",
    voice: d.dailyCap?.voice != null ? String(d.dailyCap.voice) : "",
  });
  const [win, setWin] = useState<{ start: string; end: string }>({
    start: d.sendingWindow?.start ?? "09:00",
    end: d.sendingWindow?.end ?? "17:00",
  });
  const [weekend, setWeekend] = useState<boolean>(
    (d.sendingWindow?.days ?? [1, 2, 3, 4, 5]).some((n) => n === 6 || n === 7),
  );
  useEffect(() => {
    const dd = view?.defaults ?? {};
    setCaps({
      email: dd.dailyCap?.email != null ? String(dd.dailyCap.email) : "",
      sms: dd.dailyCap?.sms != null ? String(dd.dailyCap.sms) : "",
      voice: dd.dailyCap?.voice != null ? String(dd.dailyCap.voice) : "",
    });
    setWin({ start: dd.sendingWindow?.start ?? "09:00", end: dd.sendingWindow?.end ?? "17:00" });
    setWeekend((dd.sendingWindow?.days ?? [1, 2, 3, 4, 5]).some((n) => n === 6 || n === 7));
  }, [view]);

  const campaigns = view?.campaigns ?? [];
  const differing = useMemo(() => {
    const de = d.dailyCap?.email ?? 200;
    return campaigns.filter((c) => c.dailyCap != null && c.dailyCap.email !== de).length;
  }, [campaigns, d]);

  async function save() {
    const dailyCap: Record<string, number> = {};
    for (const k of ["email", "sms", "voice"] as const) {
      const raw = caps[k].trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        flash(`The ${k} cap needs a whole number of sends.`);
        return;
      }
      dailyCap[k] = n;
    }
    const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!timeOk.test(win.start) || !timeOk.test(win.end)) {
      flash("Quiet hours need HH:MM times.");
      return;
    }
    const days = weekend ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    const res = await patchGuardrailDefaults({
      ...(Object.keys(dailyCap).length ? { dailyCap } : {}),
      sendingWindow: { days, start: win.start, end: win.end, timezone: d.sendingWindow?.timezone ?? "UTC" },
    });
    if (!res.ok) {
      flash(res.error || "The defaults did not save — try again.");
      return;
    }
    flash("Saved — new campaigns start from these.");
    await reload();
  }

  return (
    <div data-testid="bold-wss-guard-item">
      <BoldMetaStrip
        items={[
          ["WHAT THESE ARE", "Defaults", "every NEW campaign starts here"],
          ["LIVE CAMPAIGNS", String(campaigns.length), "each keeps its own limits"],
          ["DIFFER FROM DEFAULTS", String(differing), "see Campaign overrides"],
        ]}
      />
      {tabRow(["Sending limits", "What she may say", "Campaign overrides"])}
      <div style={{ padding: "22px 40px 40px" }}>
        {tab === 0 ? (
          <div style={{ maxWidth: 560 }}>
            {(
              [
                ["Daily email ceiling", "email", "a day, per campaign"],
                ["Daily SMS ceiling", "sms", "a day, per campaign"],
                ["Daily call ceiling", "voice", "a day, per campaign"],
              ] as const
            ).map(([label, key, sub]) => (
              <div key={key} style={rowStyle(false)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>{sub}</div>
                </div>
                <input
                  value={caps[key]}
                  onChange={(e) => setCaps((c) => ({ ...c, [key]: e.target.value }))}
                  placeholder={key === "email" ? "200" : "—"}
                  inputMode="numeric"
                  data-testid={`bold-wss-cap-${key}`}
                  style={CH.well}
                />
              </div>
            ))}
            <div style={rowStyle(false)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Sending hours</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>Nothing lands outside them ({d.sendingWindow?.timezone ?? "UTC"})</div>
              </div>
              <input value={win.start} onChange={(e) => setWin((w) => ({ ...w, start: e.target.value }))} data-testid="bold-wss-win-start" style={{ ...CH.well, width: 62 }} />
              <span style={{ color: "var(--cvb-faint)" }}>–</span>
              <input value={win.end} onChange={(e) => setWin((w) => ({ ...w, end: e.target.value }))} data-testid="bold-wss-win-end" style={{ ...CH.well, width: 62 }} />
            </div>
            <div style={rowStyle(true)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>Saturday sending</div>
                <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>Off means weekends stay silent</div>
              </div>
              <span
                onClick={() => setWeekend((w) => !w)}
                data-testid="bold-wss-weekend"
                role="switch"
                aria-checked={weekend}
                style={{ width: 46, height: 28, borderRadius: 999, flex: "none", background: weekend ? "var(--cvb-forest)" : "var(--cvb-line-ctl)", position: "relative", cursor: "pointer" }}
              >
                <span style={{ position: "absolute", top: 3, left: weekend ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.18)", transition: "left .2s" }} />
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
              <span onClick={() => void save()} data-testid="bold-wss-guard-save" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 16px", cursor: "pointer" }}>
                Save defaults
              </span>
              <span style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.5 }}>
                Applies to campaigns you create from now on — live ones keep their own limits.
              </span>
            </div>
          </div>
        ) : null}
        {tab === 1 ? (
          <>
            {(
              [
                ["Unsubscribe footer on every email", "Structural — the schema cannot store it off.", true],
                ["Suppression check before every send", "Opt-outs and do-not-contact always hold.", true],
                ["A human reply pauses Ada", "Nothing scheduled sends into a live conversation until you resume her.", true],
                ["Quiet hours in their clock", "Calls also respect the contact's own 08:00–21:00 floor.", true],
              ] as const
            ).map(([n, sub], i, arr) => (
              <div key={n} style={rowStyle(i === arr.length - 1)}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{n}</div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>{sub}</div>
                </div>
                <span style={CHIP_LIVE}>Always on</span>
              </div>
            ))}
            <div style={{ marginTop: 16, fontSize: 12, color: "var(--cvb-faint)", lineHeight: 1.6 }}>
              Per-campaign voice — the selling arc, banned phrases, her standing instructions — lives on each campaign&rsquo;s Settings tab.
            </div>
          </>
        ) : null}
        {tab === 2 ? (
          campaigns.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--cvb-faint)" }}>No live campaigns yet — they show up here with their limits.</div>
          ) : (
            campaigns.map((c, i) => {
              const de = d.dailyCap?.email ?? 200;
              const differs = c.dailyCap != null && c.dailyCap.email !== de;
              return (
                <div key={c.id} style={rowStyle(i === campaigns.length - 1)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{c.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 2 }}>
                      {c.dailyCap ? `Email ${c.dailyCap.email}/day${c.dailyCap.sms ? ` · SMS ${c.dailyCap.sms}/day` : ""}${c.dailyCap.voice ? ` · calls ${c.dailyCap.voice}/day` : ""}` : "Limits unreadable"}
                      {c.sendingWindow ? ` · ${c.sendingWindow.start}–${c.sendingWindow.end}` : ""}
                    </div>
                  </div>
                  <span style={differs ? CHIP_WARN : CHIP_MUTE}>{differs ? "Differs" : "Matches defaults"}</span>
                </div>
              );
            })
          )
        ) : null}
      </div>
    </div>
  );
}
