"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CampaignGraph, ContactListDto, EffectiveCreditPrices } from "@clientforce/core";
import { goalValueMeta, mainPath, validateGraph } from "@clientforce/core";
import { chainMeta } from "../sequence/SubcampaignCards";
import {
  answerGap,
  createBoldAgent,
  delegateGap,
  deleteBoldAgent,
  enrollContact,
  fetchContextMerged,
  fetchCreditPrices,
  fetchGapReport,
  fetchListMemberIds,
  fetchPlannerGraph,
  fetchPlannerStatus,
  fetchSenders,
  money,
  patchBoldAgent,
  planCampaign,
  putPlannerGraph,
  type BoldGapReport,
} from "./bold-live";
import { BoldCsvImport, type CsvImportOutcome } from "./shared/BoldCsvImport";
import { BoldListPicker } from "./shared/BoldListPicker";
import { BoldSequenceList, stepCredits } from "./shared/BoldSequenceList";
import { CREATE_GOALS, SPEC_QUESTIONS, starterGraph } from "./shared/bold-create-data";

/**
 * Create a campaign (B2.5, prototype `vNew` — DEC-108/DEC-109). Eight rail
 * steps: goal + spec question · who (list picker / CSV ingest — the sourceless
 * prototype options render disabled with their wave, Q-074) · knowledge check
 * (the REAL gap report) · value (the B1 model; nothing prefilled — no invented
 * dollars) · channels (live sender capability, DEC-061) · the plan (Ada via
 * the shipped planner, or the labeled mechanical starter — both land through
 * the one graph write path) · limits (real A8 fields; the literal-true rails
 * render locked, never as toggles) · review → launch.
 *
 * Every write is the SHIPPED create path: POST /agents → context answers →
 * planner → full-A8 guardrails PATCH → status ACTIVE → per-contact
 * enrollments with origin provenance. No parallel creation API exists.
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;

const STEPS = [
  "The goal",
  "Who it reaches",
  "What she needs to know",
  "What a win is worth",
  "How she reaches them",
  "The plan",
  "Her limits",
  "Review and launch",
] as const;

const TITLES = [
  "What should this campaign achieve?",
  "Who should Ada reach?",
  "Does she know enough to do this?",
  "What is one win worth?",
  "How should she reach them?",
  "Here is the plan",
  "What are her limits?",
  "Ready when you are",
] as const;

const SUBS = [
  "The goal decides how value is counted and how she writes.",
  "She only works people you have permission to contact.",
  "She checked what she knows against this goal. Fill anything missing and she stops deflecting.",
  "This is what turns activity into money you can check.",
  "Only connected channels can send — nothing here pretends otherwise.",
  "Ada can draft it, or start simple — either way you can change any step once the campaign exists.",
  "These sit above everything. She cannot cross them.",
  "Nothing sends until you launch it.",
] as const;

interface Audience {
  kind: "list" | "csv";
  listId: string;
  listName: string;
  count: number;
}

export function BoldCreateView({
  resume = null,
  seedAudience = null,
  onCancel,
  onLaunched,
  flash,
}: {
  /** B2.6 (DEC-110): open ON an existing suggested draft — goal/name/summary
   *  prefill from the row and the agent is never re-created. */
  resume?: { agentId: string; goal: string; name: string; summary: string | null } | null;
  /** B6.6: opened FROM a selection — the Lead finder has just written a real
   *  list and hands it over, so the "who" step starts answered instead of
   *  asking again for people the person has already chosen. */
  seedAudience?: Audience | null;
  onCancel: () => void;
  onLaunched: (agentId: string) => void;
  flash: (msg: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [goalKey, setGoalKey] = useState<string | null>(resume?.goal ?? null);
  const [spec, setSpec] = useState(resume?.summary ?? "");
  const [agentId, setAgentId] = useState<string | null>(resume?.agentId ?? null);
  const createdGoal = useRef<string | null>(resume?.goal ?? null);
  const [name, setName] = useState(resume?.name ?? "");
  const [audience, setAudience] = useState<Audience | null>(seedAudience);
  const [whoMode, setWhoMode] = useState<"list" | "csv" | null>(seedAudience ? "list" : null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gaps, setGaps] = useState<BoldGapReport | null>(null);
  const [merged, setMerged] = useState<Record<string, { value?: string } | undefined>>({});
  const [gapInputs, setGapInputs] = useState<Record<string, string>>({});
  const [unitDollars, setUnitDollars] = useState("");
  const [target, setTarget] = useState("");
  const [emailReady, setEmailReady] = useState<boolean | null>(null);
  const [smsReady, setSmsReady] = useState(false);
  const [chan, setChan] = useState<{ email: boolean; sms: boolean }>({ email: true, sms: false });
  const [graph, setGraph] = useState<CampaignGraph | null>(null);
  const [graphSource, setGraphSource] = useState<"ada" | "starter" | null>(null);
  const [planState, setPlanState] = useState<"idle" | "planning" | "failed" | "unreachable">("idle");
  const [planWhy, setPlanWhy] = useState<string | null>(null);
  const [prices, setPrices] = useState<EffectiveCreditPrices | null>(null);
  const [guard, setGuard] = useState({ quiet: true, weekend: false });
  const [autonomy, setAutonomy] = useState<"ask" | "limits" | "full">("limits");
  const [busy, setBusy] = useState(false);
  const [launching, setLaunching] = useState(false);
  const planPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const meta = goalKey ? goalValueMeta(goalKey) : null;
  const card = CREATE_GOALS.find((g) => g.key === goalKey) ?? null;
  const spec4 = goalKey ? SPEC_QUESTIONS[goalKey] ?? SPEC_QUESTIONS.custom! : null;

  useEffect(() => {
    if (resume) {
      void refreshKnowledge(resume.agentId, resume.goal);
      void fetchPlannerGraph(resume.agentId).then((g) => {
        if (g?.graph) {
          try {
            setGraph(validateGraph(g.graph.graph));
            setGraphSource("starter");
          } catch {
            /* unreadable stored row — the plan step offers both paths */
          }
        }
      });
    }
    void fetchCreditPrices().then(setPrices);
    void fetchSenders().then((rows) => {
      const list = rows ?? [];
      const email = list.some((s) => s.type !== "TWILIO_SMS" && s.status === "ACTIVE");
      const sms = list.some((s) => s.type === "TWILIO_SMS" && s.status === "ACTIVE");
      setEmailReady(email);
      setSmsReady(sms);
      setChan({ email, sms: false });
    });
    return () => {
      if (planPoll.current) clearInterval(planPoll.current);
    };
  }, []);

  /* ------------------------------------------------------------- knowledge */

  const refreshKnowledge = useCallback(async (id: string, goal: string) => {
    const [report, ctx] = await Promise.all([fetchGapReport(id, goal), fetchContextMerged(id)]);
    if (report) setGaps(report);
    if (ctx) setMerged(ctx.merged ?? {});
  }, []);

  /* ------------------------------------------------------- agent lifecycle */

  /** Create the DRAFT agent when the goal step completes (the shipped path
   *  needs an agentId for gaps/answers/planner). A goal change after create
   *  deletes and recreates — `goal` is immutable on PATCH by design. */
  const ensureAgent = useCallback(async (): Promise<string | null> => {
    if (!goalKey) return null;
    if (agentId && createdGoal.current === goalKey) return agentId;
    setBusy(true);
    try {
      if (agentId) {
        await deleteBoldAgent(agentId);
        setAgentId(null);
        setGraph(null);
        setGraphSource(null);
        setGaps(null);
      }
      const derived = (spec.trim() || card?.title || "New campaign").slice(0, 80);
      const res = await createBoldAgent({
        name: derived,
        goal: goalKey,
        ...(spec.trim() ? { goalSummary: spec.trim().slice(0, 160) } : {}),
      });
      if (!res.ok) {
        flash(res.error);
        return null;
      }
      const id = (res.body as { id: string }).id;
      setAgentId(id);
      createdGoal.current = goalKey;
      setName(derived);
      void refreshKnowledge(id, goalKey);
      return id;
    } finally {
      setBusy(false);
    }
  }, [goalKey, agentId, spec, card, flash, refreshKnowledge]);

  /* ------------------------------------------------------------------ plan */

  const adoptGraphRow = useCallback((row: { graph: unknown } | null) => {
    if (!row) return false;
    try {
      setGraph(validateGraph(row.graph));
      return true;
    } catch {
      return false;
    }
  }, []);

  const startAdaPlan = useCallback(async () => {
    if (!agentId || planState === "planning") return;
    setPlanState("planning");
    setPlanWhy(null);
    const res = await planCampaign(agentId);
    if (!res.ok) {
      setPlanState("failed");
      setPlanWhy(res.error);
      return;
    }
    let ticks = 0;
    planPoll.current = setInterval(() => {
      void (async () => {
        ticks += 1;
        const [g, st] = await Promise.all([fetchPlannerGraph(agentId), fetchPlannerStatus(agentId)]);
        if (g?.graph && adoptGraphRow(g.graph)) {
          setGraphSource("ada");
          setPlanState("idle");
          if (planPoll.current) clearInterval(planPoll.current);
          return;
        }
        if (st?.state === "failed") {
          setPlanState("failed");
          setPlanWhy(st.failedReason ?? "The planner reported a failure.");
          if (planPoll.current) clearInterval(planPoll.current);
          return;
        }
        // `none` = no queue/worker behind the endpoint (or nothing started).
        if (ticks >= 20 || (ticks >= 4 && st?.state === "none")) {
          setPlanState("unreachable");
          if (planPoll.current) clearInterval(planPoll.current);
        }
      })();
    }, 3000);
  }, [agentId, planState, adoptGraphRow]);

  const useStarter = useCallback(async () => {
    if (!agentId || busy) return;
    setBusy(true);
    try {
      const g = starterGraph({ sms: chan.sms && smsReady });
      const res = await putPlannerGraph(agentId, g);
      if (!res.ok) {
        flash(res.error);
        return;
      }
      setGraph(g);
      setGraphSource("starter");
      setPlanState("idle");
    } finally {
      setBusy(false);
    }
  }, [agentId, busy, chan.sms, smsReady, flash]);

  /* ---------------------------------------------------------------- launch */

  const unitCents = useMemo(() => {
    const n = Number(unitDollars.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  }, [unitDollars]);
  const targetN = useMemo(() => {
    const n = Number(target);
    return Number.isInteger(n) && n > 0 ? n : null;
  }, [target]);
  const projected = meta?.monetary && unitCents != null && targetN != null ? unitCents * targetN : null;

  const planMeta = useMemo(() => {
    if (!graph) return null;
    return chainMeta(mainPath(graph));
  }, [graph]);

  const perContactCredits = useMemo(() => {
    if (!graph) return null;
    let total = 0;
    for (const n of mainPath(graph)) {
      if (n.type !== "step") continue;
      const c = stepCredits(n, prices);
      if (c == null) return null;
      total += c;
    }
    return total;
  }, [graph, prices]);
  const estCredits =
    perContactCredits != null && audience ? perContactCredits * audience.count : null;

  const canLaunch =
    agentId != null && graph != null && audience != null && emailReady === true && !launching;

  async function launch() {
    if (!canLaunch || !agentId || !audience) return;
    setLaunching(true);
    try {
      // 1. The full A8 guardrails object from the limits step (full replace).
      const guardrails = {
        sendingWindow: {
          days: guard.weekend ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5],
          start: guard.quiet ? "08:00" : "00:00",
          end: guard.quiet ? "20:00" : "23:59",
          timezone: "UTC",
        },
        dailyCap: { email: 200, ...(chan.sms && smsReady ? { sms: 50 } : {}) },
        consent: null,
        tracking: { openTracking: true, linkTracking: true },
        unsubscribeFooter: true,
        suppressionCheck: true,
        // B3d: the level the owner chose in the limits step — sent
        // explicitly so the launch rebuild can never reset it.
        autonomy,
      };
      let res = await patchBoldAgent(agentId, {
        guardrails,
        name: name.trim() || undefined,
        ...(spec.trim() ? { goalSummary: spec.trim().slice(0, 160) } : {}),
        ...(meta?.monetary && unitCents != null ? { valueEstCents: unitCents } : {}),
        ...(meta?.monetary && targetN != null ? { valueGoalUnits: targetN } : {}),
      });
      if (!res.ok) {
        flash(res.error);
        return;
      }
      // 2. Live. Nothing sent yet — enrollments below start the workflows.
      res = await patchBoldAgent(agentId, { status: "ACTIVE" });
      if (!res.ok) {
        flash(res.error);
        return;
      }
      // 3. Audience resolves NOW (snapshot at launch, the C2.8 rule) and each
      //    contact enrolls through the ONE gate — held/refused are honest
      //    outcomes, tallied, never retried silently.
      const ids = (await fetchListMemberIds(audience.listId)) ?? [];
      let enrolled = 0;
      let held = 0;
      let refused = 0;
      for (const contactId of ids) {
        const r = await enrollContact(agentId, contactId, {
          kind: audience.kind,
          listId: audience.listId,
          listName: audience.listName,
        });
        if (!r.ok) refused += 1;
        else if ((r.body as { held?: boolean } | null)?.held) held += 1;
        else enrolled += 1;
      }
      const tally = [
        `${enrolled} enrolled`,
        ...(held ? [`${held} held for checks`] : []),
        ...(refused ? [`${refused} refused`] : []),
      ].join(" · ");
      flash(`Campaign live — ${tally}`);
      onLaunched(agentId);
    } finally {
      setLaunching(false);
    }
  }

  /* ------------------------------------------------------------ navigation */

  const knowVal = gaps
    ? gaps.total - gaps.resolved > 0
      ? `${gaps.total - gaps.resolved} gap${gaps.total - gaps.resolved === 1 ? "" : "s"}`
      : "nothing missing"
    : "—";
  const doneVals = [
    card?.title ?? "",
    audience ? `${audience.listName}` : "",
    knowVal,
    projected != null ? `${money(projected)} projected` : meta && !meta.monetary ? "no dollar value" : "value open",
    `${(chan.email ? 1 : 0) + (chan.sms && smsReady ? 1 : 0)} channel${(chan.email ? 1 : 0) + (chan.sms && smsReady ? 1 : 0) === 1 ? "" : "s"}`,
    planMeta ? `${planMeta.steps.length} steps` : "",
    "guardrails set",
    "",
  ];

  const nextLabel =
    step === 7
      ? launching
        ? "Launching…"
        : "Launch it"
      : step === 5
        ? "The plan looks right"
        : step === 2 && gaps && gaps.total - gaps.resolved > 0
          ? "Continue anyway"
          : "Continue";

  const nextEnabled =
    step === 0
      ? goalKey != null && !busy
      : step === 1
        ? audience != null
        : step === 5
          ? graph != null
          : step === 7
            ? canLaunch
            : true;

  async function next() {
    if (!nextEnabled) return;
    if (step === 0) {
      const id = await ensureAgent();
      if (!id) return;
    }
    if (step === 7) {
      void launch();
      return;
    }
    if (step === 1 && agentId && goalKey) void refreshKnowledge(agentId, goalKey);
    setStep((s) => Math.min(7, s + 1));
  }

  /* ---------------------------------------------------------------- render */

  return (
    <div style={{ display: "flex", minHeight: 0, flexWrap: "wrap" }} data-testid="bold-create">
      {/* rail — the 8 steps, completed ones carry their value line */}
      <div style={{ width: 216, flex: "none", borderRight: "1px solid var(--cvb-line-inner)", padding: "26px 20px" }}>
        {STEPS.map((label, i) => {
          const doneStep = i < step;
          const active = i === step;
          return (
            <div
              key={label}
              onClick={() => {
                if (i <= step) setStep(i);
              }}
              data-testid={`bold-create-step-${i}`}
              style={{ display: "flex", alignItems: "flex-start", gap: 11, padding: "9px 8px", borderRadius: 11, cursor: i <= step ? "pointer" : "default", background: active ? "var(--cvb-wash)" : "transparent" }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 8,
                  flex: "none",
                  background: doneStep ? "var(--cvb-forest)" : active ? "var(--cvb-card)" : "var(--cvb-well)",
                  border: `1px solid ${doneStep ? "var(--cvb-forest)" : active ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
                  color: doneStep ? "var(--cvb-card)" : active ? "var(--cvb-forest)" : "var(--cvb-faint)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ...mono,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                {doneStep ? "✓" : i + 1}
              </span>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: active ? 800 : 500, letterSpacing: "-.016em", color: active ? "var(--cvb-ink)" : doneStep ? "var(--cvb-muted)" : "var(--cvb-faint)" }}>
                  {label}
                </div>
                {doneStep && doneVals[i] ? (
                  <div style={{ fontSize: 10.5, color: "var(--cvb-forest)", marginTop: 3, lineHeight: 1.35 }}>{doneVals[i]}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* pane */}
      <div style={{ flex: 1, minWidth: 280, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, padding: "26px 32px" }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)" }}>
            NEW CAMPAIGN · STEP {step + 1} OF 8
          </div>
          <div className="cvb-display" style={{ fontWeight: 900, fontSize: 26, letterSpacing: "-.034em", lineHeight: 1.1, marginTop: 9 }}>
            {TITLES[step]}
          </div>
          <div style={{ fontSize: 13.5, color: "var(--cvb-muted)", lineHeight: 1.6, marginTop: 9, maxWidth: 520 }}>{SUBS[step]}</div>

          {/* ---------------------------------------------------- 0 · goal */}
          {step === 0 ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 11, marginTop: 22 }}>
                {CREATE_GOALS.map((g) => {
                  const on = goalKey === g.key;
                  const basis = goalValueMeta(g.key).valueBasis;
                  return (
                    <div
                      key={g.key}
                      onClick={() => {
                        setGoalKey(g.key);
                        setUnitDollars("");
                        setTarget("");
                      }}
                      data-testid={`bold-goal-${g.key}`}
                      style={{ background: on ? "var(--cvb-mint)" : "var(--cvb-panel)", border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line)"}`, borderRadius: 17, padding: 17, cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 10, flex: "none", background: g.tint[0], border: `1px solid ${g.tint[1]}`, color: g.tint[2], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                          {g.ic}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14, letterSpacing: "-.022em", color: on ? "#0e3d22" : "var(--cvb-ink)" }}>{g.title}</span>
                        {on ? <span style={{ color: "var(--cvb-forest)", fontSize: 12 }}>✓</span> : null}
                      </div>
                      <div style={{ fontSize: 12, color: on ? "#1d5b34" : "var(--cvb-muted)", lineHeight: 1.5, marginTop: 9 }}>{g.sub}</div>
                      <div style={{ ...mono, fontSize: 9.5, color: on ? "#4e8c68" : "var(--cvb-faint)", marginTop: 10 }}>{basis}</div>
                    </div>
                  );
                })}
              </div>
              {goalKey && spec4 ? (
                <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 18, padding: 18, marginTop: 14, maxWidth: 560 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.022em" }}>{spec4.q}</div>
                  <input
                    value={spec}
                    onChange={(e) => setSpec(e.target.value)}
                    placeholder={spec4.ph}
                    data-testid="bold-create-spec"
                    style={{ width: "100%", marginTop: 12, background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 12px", fontSize: 13.5, outline: "none", fontFamily: "inherit" }}
                  />
                  <div style={{ fontSize: 11, color: "var(--cvb-faint)", marginTop: 7 }}>
                    Your words lead the campaign everywhere — the hero, the list, her plan.
                  </div>
                  <div style={{ display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--cvb-line-2)" }}>
                    <span style={{ color: "var(--cvb-forest)", fontSize: 11, flex: "none", lineHeight: 1.5 }}>✦</span>
                    <span style={{ flex: 1, fontSize: 12, color: "var(--cvb-muted)", lineHeight: 1.55 }}>{spec4.core}</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {/* ----------------------------------------------------- 1 · who */}
          {step === 1 ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 11, marginTop: 22 }}>
                {(
                  [
                    ["list", "☰", "A list you already have", "Members enroll at launch — as of launch day.", true, ""],
                    ["csv", "↑", "A file you upload", "CSV — map the columns, duplicates merge, consent honored.", true, ""],
                    ["seg", "◈", "Everyone who matches a rule", "Coming soon — Ada will keep a live segment current.", false, ""],
                    ["find", "⌕", "People Ada finds", "Coming soon — Lead finder builds it from your best customers.", false, ""],
                  ] as const
                ).map(([key, ic, title, sub, ready, why]) => {
                  const on = whoMode === key;
                  return (
                    <div
                      key={key}
                      data-testid={`bold-who-${key}`}
                      onClick={() => {
                        if (!ready) return;
                        setWhoMode(key as "list" | "csv");
                        if (key === "list") setPickerOpen(true);
                      }}
                      style={{ background: on ? "var(--cvb-mint)" : "var(--cvb-panel)", border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line)"}`, borderRadius: 17, padding: 17, cursor: ready ? "pointer" : "default", opacity: ready ? 1 : 0.55 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 10, flex: "none", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", color: "var(--cvb-forest)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                          {ic}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 800, fontSize: 14, letterSpacing: "-.022em" }}>{title}</span>
                        {on && audience ? <span style={{ color: "var(--cvb-forest)", fontSize: 12 }}>✓</span> : null}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--cvb-muted)", lineHeight: 1.5, marginTop: 9 }}>{sub}</div>
                      {ready || why ? (
                        <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-faint)", marginTop: 10 }}>
                          {ready ? (on && audience ? `${audience.listName} · ${audience.count} enroll at launch` : key === "list" ? "pick a saved list" : "new import") : why}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {whoMode === "csv" ? (
                <BoldCsvImport
                  flash={flash}
                  onImported={(o: CsvImportOutcome) => {
                    setAudience({ kind: "csv", listId: o.listId, listName: o.listName, count: o.consented });
                  }}
                />
              ) : null}
            </>
          ) : null}

          {/* ---------------------------------------------------- 2 · know */}
          {step === 2 ? (
            <div style={{ marginTop: 20, maxWidth: 560 }}>
              {gaps === null ? (
                <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>CHECKING WHAT SHE KNOWS</div>
              ) : (
                <>
                  <span
                    data-testid="bold-know-stat"
                    style={{ display: "inline-block", fontSize: 10.5, fontWeight: 700, color: gaps.total - gaps.resolved > 0 ? "var(--cvb-amber)" : "var(--cvb-forest)", background: gaps.total - gaps.resolved > 0 ? "var(--cvb-amber-bg)" : "var(--cvb-mint)", border: `1px solid ${gaps.total - gaps.resolved > 0 ? "var(--cvb-amber-line)" : "var(--cvb-mint-line)"}`, borderRadius: 999, padding: "5px 12px" }}
                  >
                    {gaps.total - gaps.resolved > 0
                      ? `${gaps.total - gaps.resolved} of ${gaps.total} still missing`
                      : `All ${gaps.total} facts on file`}
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 16 }}>
                    {gaps.gaps.map((g) => {
                      const filled = g.status === "covered" || g.status === "typed";
                      const delegated = g.status === "ai_decides";
                      const value = merged[g.key]?.value ?? "";
                      return (
                        <div key={g.key} data-testid={`bold-gap-${g.key}`} style={{ display: "flex", gap: 12, background: filled || delegated ? "var(--cvb-panel)" : "var(--cvb-amber-soft-bg)", border: `1px solid ${filled || delegated ? "var(--cvb-line)" : "var(--cvb-amber-soft-line)"}`, borderRadius: 15, padding: 14 }}>
                          <span style={{ width: 26, height: 26, borderRadius: 9, flex: "none", background: filled ? "var(--cvb-mint)" : delegated ? "var(--cvb-well)" : "var(--cvb-amber-bg)", border: `1px solid ${filled ? "var(--cvb-mint-line)" : delegated ? "var(--cvb-line-ctl)" : "var(--cvb-amber-line)"}`, color: filled ? "var(--cvb-forest)" : delegated ? "var(--cvb-muted)" : "var(--cvb-amber)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>
                            {filled ? "✓" : delegated ? "✦" : "!"}
                          </span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-.018em" }}>{g.label}</div>
                            {filled ? (
                              <div style={{ fontSize: 11.5, color: "var(--cvb-muted)", marginTop: 4, lineHeight: 1.45, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                {value || (g.coveredBy ? "✓ Found in your documents" : "On file")}
                              </div>
                            ) : delegated ? (
                              <div style={{ fontSize: 11.5, color: "var(--cvb-muted)", marginTop: 4 }}>Ada decides at write time — labeled in every message she uses it in.</div>
                            ) : (
                              <>
                                <div style={{ fontSize: 11.5, color: "var(--cvb-amber)", marginTop: 4, lineHeight: 1.45 }}>
                                  She will deflect this to you until it's answered.
                                </div>
                                <input
                                  value={gapInputs[g.key] ?? ""}
                                  onChange={(e) => setGapInputs((m) => ({ ...m, [g.key]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && agentId && goalKey && (gapInputs[g.key] ?? "").trim()) {
                                      void answerGap(agentId, g.key, gapInputs[g.key]!.trim()).then((r) => {
                                        if (!r.ok) flash(r.error);
                                        else void refreshKnowledge(agentId, goalKey);
                                      });
                                    }
                                  }}
                                  placeholder="Type the answer and press Enter — she uses it"
                                  data-testid={`bold-gap-input-${g.key}`}
                                  style={{ width: "100%", marginTop: 9, height: 38, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "0 12px", fontSize: 12.5, outline: "none", fontFamily: "inherit" }}
                                />
                                <span
                                  onClick={() => {
                                    if (agentId && goalKey)
                                      void delegateGap(agentId, g.key).then((r) => {
                                        if (!r.ok) flash(r.error);
                                        else void refreshKnowledge(agentId, goalKey);
                                      });
                                  }}
                                  style={{ display: "inline-block", fontSize: 11, fontWeight: 700, color: "var(--cvb-cyan)", marginTop: 7, cursor: "pointer" }}
                                >
                                  Let Ada decide
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {gaps.gaps.length === 0 ? (
                      <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55 }}>
                        Nothing goal-specific is required here — her core knowledge carries it.
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {/* --------------------------------------------------- 3 · value */}
          {step === 3 && meta ? (
            meta.monetary ? (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 22, maxWidth: 560 }}>
                  <div style={{ flex: 1, minWidth: 190, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 17, padding: 17 }}>
                    <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>
                      $ PER {meta.unitNoun.toUpperCase()}
                    </div>
                    <input
                      value={unitDollars}
                      onChange={(e) => setUnitDollars(e.target.value)}
                      placeholder="e.g. 2400"
                      inputMode="decimal"
                      data-testid="bold-value-unit"
                      style={{ width: "100%", marginTop: 11, background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 12px", fontSize: 15, fontWeight: 700, outline: "none", fontFamily: "inherit" }}
                    />
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.45, marginTop: 10 }}>
                      What one of these is worth to you. Nothing is prefilled — this number is yours.
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 190, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 17, padding: 17 }}>
                    <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>TARGET</div>
                    <input
                      value={target}
                      onChange={(e) => setTarget(e.target.value.replace(/[^\d]/g, ""))}
                      placeholder="e.g. 12"
                      inputMode="numeric"
                      data-testid="bold-value-target"
                      style={{ width: "100%", marginTop: 11, background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 12px", fontSize: 15, fontWeight: 700, outline: "none", fontFamily: "inherit" }}
                    />
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.45, marginTop: 10 }}>
                      How many you want. She paces the sends to hit it.
                    </div>
                  </div>
                </div>
                {projected != null ? (
                  <div style={{ background: "linear-gradient(150deg,#0C2A1B,#0A1524)", borderRadius: 19, padding: "22px 24px", marginTop: 12, maxWidth: 560 }} data-testid="bold-value-proj">
                    <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "rgba(255,255,255,.5)" }}>IF IT HITS THE GOAL</div>
                    <div className="cvb-display" style={{ fontWeight: 900, fontSize: 42, letterSpacing: "-.04em", lineHeight: 1, color: "#fff", marginTop: 11 }}>
                      {money(projected)}
                    </div>
                    <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.6)", lineHeight: 1.5, marginTop: 10 }}>
                      {targetN} × {money(unitCents!)}. Potential while they are booked, realized when they pay.
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 12 }}>
                    Optional — skip it and set the value later from the campaign overview.
                  </div>
                )}
              </>
            ) : (
              <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 18, padding: 18, marginTop: 22, maxWidth: 560, fontSize: 13, color: "var(--cvb-muted)", lineHeight: 1.6 }}>
                {goalKey === "collect_reviews"
                  ? "Reviews do not carry a dollar value — she reports count and sentiment instead."
                  : "This goal has no dollar target — she reports engagement and who warmed up enough to move."}
              </div>
            )
          ) : null}

          {/* ------------------------------------------------ 4 · channels */}
          {step === 4 ? (
            <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 18, overflow: "hidden", marginTop: 22, maxWidth: 560 }}>
              {(
                [
                  ["email", "✉", "Email", emailReady === null ? "Checking senders…" : emailReady ? "A connected sender is ready." : "No active sender — connect one in Settings before launch.", emailReady === true],
                  ["sms", "✆", "SMS", smsReady ? "Twilio sender active and approved." : "Connect a Twilio sender first.", smsReady],
                  ["call", "☎", "Calls", "Coming soon.", false],
                ] as const
              ).map(([key, ic, label, sub, ready], i) => {
                const on = key === "email" ? chan.email : key === "sms" ? chan.sms : false;
                return (
                  <div key={key} data-testid={`bold-chan-${key}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 17px", borderBottom: i === 2 ? "none" : "1px solid var(--cvb-line-inner)", opacity: ready ? 1 : 0.6 }}>
                    <span style={{ width: 32, height: 32, borderRadius: 11, flex: "none", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", color: "var(--cvb-muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
                      {ic}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.018em" }}>{label}</div>
                      <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, lineHeight: 1.45 }}>{sub}</div>
                    </div>
                    <span
                      onClick={() => {
                        if (!ready) return; // the call row is never ready this wave
                        setChan((c) => (key === "email" ? { ...c, email: !c.email } : { ...c, sms: !c.sms }));
                      }}
                      style={{ width: 46, height: 28, borderRadius: 999, flex: "none", background: on ? "var(--cvb-forest)" : "var(--cvb-scrollbar)", position: "relative", cursor: ready ? "pointer" : "default" }}
                    >
                      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.18)", transition: "left .2s cubic-bezier(.32,.72,0,1)" }} />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* ---------------------------------------------------- 5 · plan */}
          {step === 5 ? (
            <div style={{ marginTop: 22, maxWidth: 560 }}>
              {graph === null ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 11 }}>
                    <div
                      onClick={() => void startAdaPlan()}
                      data-testid="bold-plan-ada"
                      style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 17, padding: 17, cursor: "pointer", opacity: planState === "planning" ? 0.7 : 1 }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.022em", color: "var(--cvb-forest)" }}>✦ Ada drafts it</div>
                      <div style={{ fontSize: 12, color: "var(--cvb-muted)", lineHeight: 1.5, marginTop: 8 }}>
                        {planState === "planning" ? "She's drafting — this takes a minute…" : "The real planner writes a sequence from your goal and what she knows."}
                      </div>
                    </div>
                    <div
                      onClick={() => void useStarter()}
                      data-testid="bold-plan-starter"
                      style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 17, padding: 17, cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-.022em" }}>Start simple</div>
                      <div style={{ fontSize: 12, color: "var(--cvb-muted)", lineHeight: 1.5, marginTop: 8 }}>
                        A mechanical starter sequence — placeholder copy, not Ada's writing. Edit every step after create.
                      </div>
                    </div>
                  </div>
                  {planState === "failed" ? (
                    <div style={{ background: "var(--cvb-danger-bg)", border: "1px solid #f0d5ce", borderRadius: 14, padding: 13, marginTop: 14, fontSize: 12, color: "var(--cvb-danger)", lineHeight: 1.5 }}>
                      The planner failed{planWhy ? ` — ${planWhy}` : ""}. Try again, or start simple.
                    </div>
                  ) : null}
                  {planState === "unreachable" ? (
                    <div style={{ background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", borderRadius: 14, padding: 13, marginTop: 14, fontSize: 12, color: "var(--cvb-amber)", lineHeight: 1.5 }} data-testid="bold-plan-unreachable">
                      The planner isn't reachable on this deployment — the simple starter still works, and Ada can regenerate later.
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 11.5, color: graphSource === "ada" ? "var(--cvb-forest)" : "var(--cvb-faint)", marginBottom: 16 }} data-testid="bold-plan-source">
                    {graphSource === "ada"
                      ? "✦ Ada drafted this from your goal and what she knows."
                      : "A mechanical starter — Ada didn't write this copy. Change any step from the Plan tab once the campaign exists."}
                  </div>
                  <BoldSequenceList graph={graph} prices={prices} />
                </>
              )}
            </div>
          ) : null}

          {/* -------------------------------------------------- 6 · limits */}
          {step === 6 ? (
            <>
            {/* B3d (DEC-122): HOW MUCH ADA DECIDES — the campaign's autonomy
                level, chosen at creation (Settings can change it later). */}
            <div style={{ marginTop: 22, maxWidth: 560 }}>
              <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 12 }}>
                HOW MUCH ADA DECIDES
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                {(
                  [
                    ["ask", "Ask me first", "Nothing sends without your tap.", "every send queued"],
                    ["limits", "Act inside limits", "She works within the limits below; anything outside waits.", "the default"],
                    ["full", "Full autonomy", "Receipts, not questions.", "for campaigns you trust"],
                  ] as const
                ).map(([key, title, body, note]) => {
                  const on = autonomy === key;
                  return (
                    <div
                      key={key}
                      onClick={() => setAutonomy(key)}
                      data-testid={`bold-create-auto-${key}`}
                      role="radio"
                      aria-checked={on}
                      style={{ background: on ? "var(--cvb-mint)" : "var(--cvb-card)", border: `1px solid ${on ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`, borderRadius: 15, padding: 14, cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${on ? "var(--cvb-forest)" : "var(--cvb-ghost)"}`, display: "grid", placeItems: "center", flex: "none" }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: on ? "var(--cvb-forest)" : "transparent" }} />
                        </span>
                        <span style={{ fontWeight: 800, fontSize: 12.5, letterSpacing: "-.018em" }}>{title}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: on ? "var(--cvb-forest)" : "var(--cvb-faint)", lineHeight: 1.45, marginTop: 7 }}>{body}</div>
                      <div style={{ ...mono, fontSize: 8.5, color: on ? "var(--cvb-forest)" : "var(--cvb-ghost)", marginTop: 9 }}>{note}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 18, overflow: "hidden", marginTop: 14, maxWidth: 560 }}>
              {(
                [
                  ["quiet", "Quiet hours", "Nothing lands 20:00–08:00 — off means around the clock.", guard.quiet, true],
                  ["weekend", "Weekend sends", "Off keeps Saturday and Sunday silent.", guard.weekend, true],
                  ["suppress", "Unsubscribe + suppression honesty", "Footer on every send, suppression checked — always on, can't be disabled.", true, false],
                ] as const
              ).map(([key, label, sub, on, toggleable], i) => (
                <div key={key} data-testid={`bold-guard-${key}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 17px", borderBottom: i === 2 ? "none" : "1px solid var(--cvb-line-inner)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, letterSpacing: "-.018em" }}>{label}</div>
                    <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 3, lineHeight: 1.45 }}>{sub}</div>
                  </div>
                  {toggleable ? (
                    <span
                      onClick={() => setGuard((g) => (key === "quiet" ? { ...g, quiet: !g.quiet } : { ...g, weekend: !g.weekend }))}
                      style={{ width: 46, height: 28, borderRadius: 999, flex: "none", background: on ? "var(--cvb-forest)" : "var(--cvb-scrollbar)", position: "relative", cursor: "pointer" }}
                    >
                      <span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(16,22,19,.18)", transition: "left .2s cubic-bezier(.32,.72,0,1)" }} />
                    </span>
                  ) : (
                    <span style={{ ...mono, fontSize: 10, color: "var(--cvb-forest)", background: "var(--cvb-mint)", border: "1px solid var(--cvb-mint-line)", borderRadius: 999, padding: "4px 10px", flex: "none" }}>
                      ⚿ ALWAYS ON
                    </span>
                  )}
                </div>
              ))}
            </div>
            </>
          ) : null}

          {/* -------------------------------------------------- 7 · review */}
          {step === 7 ? (
            <>
              <div style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 18, overflow: "hidden", marginTop: 22, maxWidth: 620 }} data-testid="bold-review">
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 17px", borderBottom: "1px solid var(--cvb-line-inner)" }}>
                  <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", width: 88, flex: "none" }}>NAME</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="bold-review-name"
                    style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, letterSpacing: "-.016em", background: "transparent", border: "none", outline: "none", fontFamily: "inherit", color: "var(--cvb-ink)" }}
                  />
                </div>
                {(
                  [
                    ["GOAL", `${card?.title ?? ""}${spec.trim() ? ` — “${spec.trim()}”` : ""}`, 0],
                    ["AUDIENCE", audience ? `${audience.listName} · ${audience.count} enroll at launch` : "—", 1],
                    ["SHE KNOWS", knowVal, 2],
                    [
                      "WORTH",
                      meta && !meta.monetary
                        ? "no dollar value — count and sentiment instead"
                        : projected != null
                          ? `${money(unitCents!)} × ${targetN} = ${money(projected)}`
                          : "not set — edit later from the overview",
                      3,
                    ],
                    ["CHANNELS", [chan.email ? "EMAIL" : null, chan.sms && smsReady ? "SMS" : null].filter(Boolean).join(" · ") || "none yet", 4],
                    ["PLAN", planMeta ? `${planMeta.steps.length} steps over ${Math.max(1, planMeta.days + 1)} days` : "—", 5],
                    ["LIMITS", `${guard.quiet ? "quiet hours" : "around the clock"} · ${guard.weekend ? "weekends on" : "no weekend sends"} · suppression always on`, 6],
                  ] as const
                ).map(([k, v, target2], i) => (
                  <div
                    key={k}
                    onClick={() => setStep(target2)}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 17px", borderBottom: i === 6 ? "none" : "1px solid var(--cvb-line-inner)", cursor: "pointer" }}
                  >
                    <span style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", width: 88, flex: "none" }}>{k}</span>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, letterSpacing: "-.016em" }}>{v}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--cvb-cyan)", flex: "none" }}>Change</span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12, maxWidth: 620 }}>
                <div style={{ flex: 1, minWidth: 180, background: "linear-gradient(150deg,#0C2A1B,#0A1524)", borderRadius: 18, padding: 20 }}>
                  <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "rgba(255,255,255,.5)" }}>PROJECTED</div>
                  <div className="cvb-display" style={{ fontWeight: 900, fontSize: 32, letterSpacing: "-.036em", color: "#fff", lineHeight: 1, marginTop: 10 }}>
                    {projected != null ? money(projected) : "—"}
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 180, background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 18, padding: 20 }} data-testid="bold-review-credits">
                  <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".16em", color: "var(--cvb-faint)" }}>CREDITS</div>
                  <div className="cvb-display" style={{ fontWeight: 900, fontSize: 32, letterSpacing: "-.036em", lineHeight: 1, marginTop: 10 }}>
                    {estCredits != null ? `~${estCredits.toLocaleString("en-US")}` : "—"}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginTop: 9 }}>
                    Estimated for the whole run — the plan's per-step prices × {audience?.count ?? 0} people. SMS prices are per segment.
                  </div>
                </div>
              </div>
              {emailReady === false ? (
                <div style={{ background: "var(--cvb-amber-bg)", border: "1px solid var(--cvb-amber-line)", borderRadius: 14, padding: 13, marginTop: 14, maxWidth: 620, fontSize: 12, color: "var(--cvb-amber)", lineHeight: 1.5 }}>
                  No active email sender — connect one in Settings before this campaign can launch.
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* footer */}
        <div style={{ flex: "none", borderTop: "1px solid var(--cvb-line-inner)", padding: "14px 32px", display: "flex", alignItems: "center", gap: 10 }}>
          <span onClick={onCancel} data-testid="bold-create-cancel" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-muted)", cursor: "pointer" }}>
            Cancel
          </span>
          <span style={{ flex: 1 }} />
          {step > 0 ? (
            <span
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-ink)", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 12, padding: "11px 16px", cursor: "pointer" }}
            >
              Back
            </span>
          ) : null}
          <span
            onClick={() => void next()}
            data-testid="bold-create-next"
            style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: nextEnabled ? "var(--cvb-forest)" : "var(--cvb-ghost)", borderRadius: 12, padding: "11px 18px", cursor: nextEnabled ? "pointer" : "default" }}
          >
            {nextLabel}
          </span>
        </div>
      </div>

      {pickerOpen ? (
        <BoldListPicker
          onClose={() => setPickerOpen(false)}
          onPick={(l: ContactListDto) => {
            setAudience({ kind: "list", listId: l.id, listName: l.name, count: l.memberCount });
            setPickerOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}
