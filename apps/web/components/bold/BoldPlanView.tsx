"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgentListItem,
  BranchNode,
  CampaignGraph,
  EffectiveCreditPrices,
  GraphNode,
  Guardrails,
  StepNode,
} from "@clientforce/core";
import {
  GraphMutationError,
  addStep,
  mainPath,
  smsSegmentCount,
  strategyChains,
  subcampaignChains,
  updateDelay,
  updateStepContent,
} from "@clientforce/core";
import { branchWhenLabel, intentTint } from "../../lib/intents";
import { triggerChip } from "../../lib/triggers";
import { BoldSequenceList, CH_LABEL, CH_TILE, stepCredits } from "./shared/BoldSequenceList";
import { chainMeta, stepPillText } from "../sequence/SubcampaignCards";
import { LIVE_GRAPH_NOTICE } from "../sequence/shared";
import {
  fetchBoldInbox,
  fetchBoldView,
  fetchCreditPrices,
  fetchSenders,
  fetchSubcampaignRules,
  patchAgentGuardrails,
  putPlannerGraph,
  type BoldAgentView,
  type SubcampaignRuleRow,
} from "./bold-live";

/**
 * Plan tab (B2, prototype `vPlan`) — THE SEQUENCE on a vertical line with
 * nodes (the ruling: the dense card stack was rejected), branches simplified
 * to one summary card per reply case, and the sending-window card with an
 * editable timezone. Everything reads the SHIPPED graph from
 * `GET /agents/:id/view`; every write is a pure core mutation + the ONE
 * whole-graph `PUT /planner/graph` (DEC-076 — 409 means the sequence changed
 * underneath the edit, 422 carries the gate's owner-readable message).
 *
 * Credit cost per step, always shown (spec §4.4): scripted steps price from
 * the resolved CreditPrice read (`GET /credit-prices` — D1, prices are data);
 * guided steps carry the shipped compose credits. No price row → no chip
 * (honest absence, never an invented number).
 */

const mono = { fontFamily: "var(--cvb-font-mono)" } as const;


/** Intent → Bold dot tone (labels stay the shipped intent vocabulary;
 *  colors are skin — console-v3 tokens, never the legacy palette). */
function intentDot(intent: string): string {
  if (intent === "interested") return "var(--cvb-forest)";
  if (intent === "objection_price" || intent === "objection_timing") return "var(--cvb-dot-amber)";
  if (intent === "not_interested" || intent === "not") return "var(--cvb-danger)";
  if (intent === "info_request" || intent === "question") return "var(--cvb-cyan)";
  return "var(--cvb-faint)";
}



const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function daysLabel(days: number[]): string {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 7) return "Every day";
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1);
  if (contiguous && sorted.length > 2)
    return `${DAY_NAMES[sorted[0]!]}–${DAY_NAMES[sorted[sorted.length - 1]!]}`;
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}
const stripZero = (t: string) => t.replace(/^0(\d:)/, "$1");

const FALLBACK_TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
  "America/Phoenix", "America/Toronto", "Europe/London", "Europe/Berlin",
  "Europe/Paris", "Australia/Sydney", "Asia/Tokyo", "UTC",
];
function allTimezones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    // Bare "UTC" is the A8 default but engines list only "Etc/UTC".
    return zones.includes("UTC") ? zones : ["UTC", ...zones];
  } catch {
    return FALLBACK_TIMEZONES;
  }
}

type Sheet = { kind: "step" | "delay"; id: string };

export function BoldPlanView({ agent, flash }: { agent: AgentListItem; flash: (msg: string) => void }) {
  const [view, setView] = useState<BoldAgentView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [prices, setPrices] = useState<EffectiveCreditPrices | null>(null);
  const [scRules, setScRules] = useState<SubcampaignRuleRow[] | null>(null);
  const [smsReady, setSmsReady] = useState(false);
  const [intentCounts, setIntentCounts] = useState<Record<string, number> | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const v = await fetchBoldView(agent.id);
    if (v) setView(v);
    setLoaded(true);
  }, [agent.id]);

  useEffect(() => {
    void refresh();
    void fetchCreditPrices().then(setPrices);
    void fetchSubcampaignRules(agent.id).then(setScRules);
    void fetchSenders().then((rows) => {
      // DEC-061: SMS steps only where an ACTIVE Twilio sender exists.
      setSmsReady((rows ?? []).some((s) => s.type === "TWILIO_SMS" && s.status === "ACTIVE"));
    });
    void fetchBoldInbox(agent.id).then((res) => {
      if (!res) return;
      const counts: Record<string, number> = {};
      for (const t of res.threads) if (t.intent) counts[t.intent] = (counts[t.intent] ?? 0) + 1;
      setIntentCounts(counts);
    });
  }, [agent.id, refresh]);

  const graph = view?.graph ?? null;
  const path = useMemo(() => (graph ? mainPath(graph) : []), [graph]);
  const chains = useMemo(() => (graph ? strategyChains(graph) : []), [graph]);
  const subChains = useMemo(() => (graph ? subcampaignChains(graph) : []), [graph]);

  /** Push a mutated graph through the ONE write path; owner-readable errors. */
  const saveGraph = useCallback(
    async (mutate: (g: CampaignGraph) => CampaignGraph, doneMsg: string): Promise<boolean> => {
      if (!graph || busy) return false;
      let next: CampaignGraph;
      try {
        next = mutate(graph);
      } catch (err) {
        flash(err instanceof GraphMutationError ? err.message : String(err));
        return false;
      }
      setBusy(true);
      const res = await putPlannerGraph(agent.id, next);
      setBusy(false);
      if (!res.ok) {
        flash(res.error);
        return false;
      }
      // The server accepted `next` — adopt it locally NOW, so a fail-soft
      // refresh can never leave a stale graph that a later save would base on
      // (silently reverting this edit). The refresh corrects graphVersion.
      setView((v) => (v ? { ...v, graph: next } : v));
      flash(doneMsg);
      void refresh();
      return true;
    },
    [graph, busy, agent.id, flash, refresh],
  );

  if (!loaded) {
    return (
      <div style={{ padding: "26px 40px 40px" }} data-testid="bold-plan">
        <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>LOADING PLAN</div>
      </div>
    );
  }
  if (!graph) {
    return (
      <div style={{ padding: "26px 40px 40px", textAlign: "center" }} data-testid="bold-plan">
        <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cvb-muted)", paddingTop: 40 }}>No sequence stored yet</div>
        <div style={{ fontSize: 13, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 6 }}>
          The planner writes the sequence when the campaign is created.
        </div>
      </div>
    );
  }

  const sw = view?.guardrails?.sendingWindow ?? null;
  const noWeekend = sw ? !sw.days.includes(6) && !sw.days.includes(7) : false;

  const sheetNode = sheet ? path.find((n) => n.id === sheet.id) ?? null : null;

  return (
    <div style={{ padding: "26px 40px 40px" }} data-testid="bold-plan">
      {agent.status === "ACTIVE" ? (
        <div data-testid="bold-plan-notice" style={{ fontSize: 11.5, color: "var(--cvb-faint)", marginBottom: 18, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ color: "var(--cvb-dot-amber)" }}>◷</span>
          {LIVE_GRAPH_NOTICE}
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 44, flexWrap: "wrap" }}>
        {/* ------------------------------------------------ the sequence */}
        <div style={{ flex: 1, minWidth: 300 }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 22 }}>THE SEQUENCE</div>
          <BoldSequenceList
            graph={graph}
            prices={prices}
            onNodeClick={(n) => setSheet({ kind: n.type === "delay" ? "delay" : "step", id: n.id })}
          />

          {/* add-step — dashed tile + anchored "Choose a step type" popover
              (Campaign View canon W3-4); live channels enable, the rest
              disclose honestly (DEC-061). */}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 18 }}>
            <span
              onClick={() => setAddOpen((v) => !v)}
              data-testid="bold-plan-add"
              style={{ width: 40, height: 40, borderRadius: 14, flex: "none", border: "1px dashed var(--cvb-line-hover)", color: "var(--cvb-faint)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, cursor: "pointer" }}
            >
              +
            </span>
            <span onClick={() => setAddOpen((v) => !v)} style={{ fontSize: 13.5, fontWeight: 700, color: "var(--cvb-cyan)", cursor: "pointer" }}>
              Add a step
            </span>
            {addOpen ? (
              <div style={{ position: "absolute", left: 0, top: "calc(100% + 8px)", width: 236, background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 5, zIndex: 5, boxShadow: "var(--cvb-shadow-card)" }}>
                <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", padding: "8px 10px 4px" }}>CHOOSE A STEP TYPE</div>
                {(
                  [
                    ["email", true, ""],
                    ["sms", smsReady, "Connect a Twilio sender first"],
                  ] as const
                ).map(([ch, ready, why]) => {
                  const tile = CH_TILE[ch]!;
                  return (
                    <div
                      key={ch}
                      data-testid={`bold-plan-add-${ch}`}
                      onClick={() => {
                        if (!ready) return;
                        setAddOpen(false);
                        void saveGraph(
                          (g) => addStep(g, { container: { kind: "main" }, channel: ch }).graph,
                          "Step added",
                        );
                      }}
                      style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 9, cursor: ready ? "pointer" : "default", opacity: ready ? 1 : 0.5 }}
                    >
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: tile[1], border: `1px solid ${tile[2]}`, color: tile[3], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flex: "none" }}>
                        {tile[0]}
                      </span>
                      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{CH_LABEL[ch]}</span>
                      {!ready ? <span style={{ fontSize: 10, color: "var(--cvb-faint)" }}>{why}</span> : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        {/* --------------------------------------------- branches + window */}
        <div style={{ width: 300, flex: "none" }}>
          <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".18em", color: "var(--cvb-faint)", marginBottom: 22 }}>WHEN THEY REPLY</div>
          {chains.map(({ intent, chain, steps }) => {
            const tint = intentTint(intent);
            const dot = intentDot(intent);
            const meta = chainMeta(chain);
            const n = intentCounts?.[intent];
            const open = expanded === intent;
            return (
              <div key={intent} data-testid={`bold-plan-branch-${intent}`} style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: 20, marginBottom: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: dot, flex: "none" }} />
                  <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", flex: 1 }}>{tint.label}</span>
                  {n != null ? (
                    <span className="cvb-display" title={`${n} conversation${n === 1 ? "" : "s"} now classified “${tint.label}”`} style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.028em", color: dot }}>
                      {n}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 10 }}>
                  {meta.steps.length} step{meta.steps.length === 1 ? "" : "s"}
                  {meta.days > 0 ? ` · ${meta.days} day${meta.days === 1 ? "" : "s"}` : ""}
                  {steps[0] ? ` — “${stepPillText(steps[0])}”` : ""}
                </div>
                <div
                  onClick={() => setExpanded(open ? null : intent)}
                  style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-cyan)", marginTop: 12, cursor: "pointer" }}
                >
                  {open ? "Hide ↑" : `See the ${meta.steps.length} message${meta.steps.length === 1 ? "" : "s"} →`}
                </div>
                {open ? (
                  <div style={{ marginTop: 12, borderTop: "1px solid var(--cvb-line-2)", paddingTop: 12 }}>
                    <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".1em", color: "var(--cvb-faint)", marginBottom: 8 }}>
                      {branchWhenLabel({ intent }).toUpperCase()}
                    </div>
                    {chain.map((cn) =>
                      cn.type === "step" ? (
                        <div key={cn.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
                          <span style={{ color: (CH_TILE[cn.channel] ?? CH_TILE.email!)[3], fontSize: 11 }}>{(CH_TILE[cn.channel] ?? CH_TILE.email!)[0]}</span>
                          <span style={{ color: "var(--cvb-ink-soft)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{stepPillText(cn)}</span>
                        </div>
                      ) : cn.type === "delay" ? (
                        <div key={cn.id} style={{ ...mono, fontSize: 10, color: "var(--cvb-faint)", padding: "3px 0 3px 19px" }}>
                          wait {cn.amount} {cn.unit}
                        </div>
                      ) : null,
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
          {(() => {
            // The default case — where a reply outside the named intents goes.
            const reply = path.find((x): x is BranchNode => x.type === "branch" && x.on === "reply") ?? (graph.nodes.find((x) => x.type === "branch" && (x as BranchNode).on === "reply") as BranchNode | undefined);
            const def = reply?.cases.find((c) => c.when === "default");
            if (!def) return null;
            const target = graph.nodes.find((x) => x.id === def.goto);
            const explicit = new Set(chains.map((c) => c.intent));
            const otherCount = intentCounts
              ? Object.entries(intentCounts).reduce((acc, [k, v]) => (explicit.has(k) ? acc : acc + v), 0)
              : null;
            return (
              <div data-testid="bold-plan-branch-default" style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: 20, marginBottom: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--cvb-faint)", flex: "none" }} />
                  <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", flex: 1 }}>{branchWhenLabel("default")}</span>
                  {otherCount != null && otherCount > 0 ? (
                    <span className="cvb-display" style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.028em", color: "var(--cvb-faint)" }}>{otherCount}</span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 10 }}>
                  {target?.type === "end" ? "The sequence completes — the thread stays in your inbox." : "Continues the stored sequence."}
                </div>
              </div>
            );
          })()}
          {subChains.map(({ node, chain }) => {
            const rule = (scRules ?? []).find((r) => r.targetNodeId === node.id);
            const meta = chainMeta(chain);
            return (
              <div key={node.id} data-testid={`bold-plan-sub-${node.id}`} style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: 20, marginBottom: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--cvb-slate)", flex: "none" }} />
                  <span style={{ fontWeight: 800, fontSize: 14.5, letterSpacing: "-.022em", flex: 1 }}>{node.ref}</span>
                </div>
                {rule ? (
                  <div style={{ ...mono, fontSize: 10, color: "var(--cvb-slate)", marginTop: 10 }}>{triggerChip(rule.trigger)}</div>
                ) : null}
                <div style={{ fontSize: 12.5, color: "var(--cvb-muted)", lineHeight: 1.55, marginTop: 6 }}>
                  {meta.steps.length} step{meta.steps.length === 1 ? "" : "s"}
                  {meta.days > 0 ? ` · ${meta.days} day${meta.days === 1 ? "" : "s"}` : ""}
                </div>
              </div>
            );
          })}

          {sw ? (
            <SendingWindowCard
              sw={sw}
              noWeekend={noWeekend}
              guardrails={view!.guardrails!}
              agentId={agent.id}
              flash={flash}
              onSaved={refresh}
            />
          ) : (
            // Guardrails absent or unparsable → honest absence, and no edit
            // control (a timezone write needs the full object to send back).
            <div data-testid="bold-plan-window" style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: "18px 20px" }}>
              <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>SENDING WINDOW</div>
              <div style={{ fontSize: 12.5, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 8 }}>
                Not configured for this campaign yet.
              </div>
            </div>
          )}
        </div>
      </div>

      {sheet && sheetNode ? (
        <PlanSheet
          node={sheetNode}
          index={path.findIndex((n) => n.id === sheetNode.id) + 1}
          view={view!}
          credits={sheetNode.type === "step" ? stepCredits(sheetNode, prices) : null}
          busy={busy}
          onClose={() => setSheet(null)}
          onSaveStep={(id, patch) =>
            saveGraph((g) => updateStepContent(g, id, patch), "Step saved").then((ok) => {
              if (ok) setSheet(null);
            })
          }
          onSaveDelay={(id, amount) =>
            saveGraph((g) => updateDelay(g, id, amount), "Delay saved").then((ok) => {
              if (ok) setSheet(null);
            })
          }
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- the sheet */

function PlanSheet({
  node,
  index,
  view,
  credits,
  busy,
  onClose,
  onSaveStep,
  onSaveDelay,
}: {
  node: GraphNode;
  index: number;
  view: BoldAgentView;
  credits: number | null;
  busy: boolean;
  onClose: () => void;
  onSaveStep: (id: string, patch: { subject?: string; body?: string }) => void;
  onSaveDelay: (id: string, amount: number) => void;
}) {
  const step = node.type === "step" ? node : null;
  const delay = node.type === "delay" ? node : null;
  const [subject, setSubject] = useState(step?.content.subject ?? "");
  const [body, setBody] = useState(step?.content.body ?? "");
  const [amount, setAmount] = useState(String(delay?.amount ?? 1));

  const perStep = step ? view.perStep[step.id] : undefined;
  const scripted = step != null && step.mode !== "guided";
  const smsLen = body.length;
  // The ONE segment estimate (GSM-7/UCS-2 aware) the send path meters with.
  const smsSegments = smsSegmentCount(body);

  const label = step
    ? `${(CH_LABEL[step.channel] ?? step.channel).toUpperCase()} · STEP ${index}`
    : `DELAY · STEP ${index}`;
  const tile = step ? CH_TILE[step.channel] ?? CH_TILE.email! : null;

  const wellInput = {
    width: "100%",
    background: "var(--cvb-well)",
    border: "1px solid var(--cvb-line-ctl)",
    borderRadius: 11,
    padding: "10px 12px",
    fontSize: 13.5,
    color: "var(--cvb-ink)",
    outline: "none",
    fontFamily: "inherit",
  } as const;

  return (
    <div
      style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,.14)", display: "flex", justifyContent: "flex-end", zIndex: 6 }}
      onClick={onClose}
    >
      <div
        data-testid="bold-plan-sheet"
        style={{ width: 392, maxWidth: "88%", height: "100%", background: "var(--cvb-card)", borderLeft: "1px solid var(--cvb-line)", padding: "30px 28px", overflowY: "auto", animation: "cvb-over .32s var(--cvb-ease) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {tile ? (
            <span style={{ width: 40, height: 40, borderRadius: 14, flex: "none", background: tile[1], border: `1px solid ${tile[2]}`, color: tile[3], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>
              {tile[0]}
            </span>
          ) : (
            <span style={{ width: 40, height: 40, borderRadius: 14, flex: "none", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", color: "var(--cvb-faint)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>◷</span>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".14em", color: "var(--cvb-faint)" }}>{label}</div>
            <div className="cvb-display" style={{ fontWeight: 900, fontSize: 19, letterSpacing: "-.028em", marginTop: 3 }}>
              {step ? step.content.subject?.trim() || CH_LABEL[step.channel] : "Wait"}
            </div>
          </div>
          <span
            role="button"
            aria-label="Close"
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 11, border: "1px solid var(--cvb-line-ctl)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--cvb-muted)", fontSize: 13, cursor: "pointer", flex: "none" }}
          >
            ✕
          </span>
        </div>

        {/* chips — real counts (perStep) + the resolved cost, nothing invented */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 18 }}>
          {step ? (
            <>
              <Chip>{`${perStep?.sent ?? 0} sent`}</Chip>
              <Chip>{`${perStep?.replies ?? 0} replies`}</Chip>
              {credits != null ? (
                <Chip tone="mint">{`${credits} credit${credits === 1 ? "" : "s"} / ${step.channel === "sms" && step.mode !== "guided" ? "segment" : "send"}`}</Chip>
              ) : null}
            </>
          ) : delay ? (
            <Chip>{`${delay.amount} ${delay.unit}`}</Chip>
          ) : null}
        </div>

        {step ? (
          scripted ? (
            <div style={{ marginTop: 22 }}>
              {step.channel === "email" ? (
                <>
                  <FieldLabel>SUBJECT</FieldLabel>
                  <input data-testid="bold-sheet-subject" value={subject} onChange={(e) => setSubject(e.target.value)} style={wellInput} />
                  <div style={{ ...mono, fontSize: 9.5, color: subject.length > 78 ? "var(--cvb-amber)" : "var(--cvb-faint)", marginTop: 5 }}>
                    {subject.length} chars{subject.length > 78 ? " — long for a subject line" : ""}
                  </div>
                </>
              ) : null}
              <div style={{ marginTop: 14 }}>
                <FieldLabel>MESSAGE</FieldLabel>
                <textarea data-testid="bold-sheet-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} style={{ ...wellInput, resize: "vertical", lineHeight: 1.55 }} />
                <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-faint)", marginTop: 5 }}>
                  {step.channel === "sms"
                    ? `${smsLen} chars · ${smsSegments} segment${smsSegments === 1 ? "" : "s"}`
                    : `${body.trim() === "" ? 0 : body.trim().split(/\s+/).length} words`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <span
                  onClick={() => {
                    if (busy) return;
                    onSaveStep(step.id, step.channel === "email" ? { subject, body } : { body });
                  }}
                  data-testid="bold-sheet-save"
                  style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 16px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? "Saving…" : "Save"}
                </span>
                <span onClick={onClose} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-muted)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 16px", cursor: "pointer" }}>
                  Cancel
                </span>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 22 }}>
              <FieldLabel>THE BRIEF</FieldLabel>
              <div style={{ background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: "14px 16px", fontSize: 13, lineHeight: 1.6, color: "var(--cvb-ink-soft)" }}>
                <div style={{ fontWeight: 700 }}>{step.brief?.objective}</div>
                {(step.brief?.talkingPoints ?? []).map((p) => (
                  <div key={p} style={{ marginTop: 6 }}>· {p}</div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--cvb-faint)", lineHeight: 1.5, marginTop: 10 }}>
                Ada composes each send from this brief. Brief editing arrives with a later Bold wave — the sequence editor keeps it until then.
              </div>
            </div>
          )
        ) : null}

        {delay ? (
          <div style={{ marginTop: 22 }}>
            <FieldLabel>WAIT</FieldLabel>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                data-testid="bold-sheet-delay"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                style={{ ...wellInput, width: 82, ...mono, fontSize: 15, textAlign: "center" }}
              />
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--cvb-muted)" }}>{delay.unit}</span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
              <span
                onClick={() => {
                  if (busy) return;
                  const n = Number(amount);
                  onSaveDelay(delay.id, n);
                }}
                data-testid="bold-sheet-save"
                style={{ fontSize: 12.5, fontWeight: 800, color: "var(--cvb-card)", background: "var(--cvb-forest)", borderRadius: 11, padding: "10px 16px", cursor: "pointer", opacity: busy ? 0.6 : 1 }}
              >
                {busy ? "Saving…" : "Save"}
              </span>
              <span onClick={onClose} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--cvb-muted)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 11, padding: "10px 16px", cursor: "pointer" }}>
                Cancel
              </span>
            </div>
          </div>
        ) : null}

        {/* record line — real fields only (node id · mode · stored version) */}
        <div style={{ ...mono, fontSize: 9.5, color: "var(--cvb-ghost)", marginTop: 26, lineHeight: 1.6 }}>
          {node.type === "step"
            ? `step ${node.id} · ${(node as StepNode).mode ?? "scripted"} · graph v${view.graphVersion ?? "—"}`
            : `${node.type} ${node.id} · graph v${view.graphVersion ?? "—"}`}
        </div>
      </div>
    </div>
  );
}

function Chip({ children, tone }: { children: string; tone?: "mint" }) {
  return (
    <span
      style={{
        ...mono,
        fontSize: 10,
        color: tone === "mint" ? "var(--cvb-forest)" : "var(--cvb-muted)",
        background: tone === "mint" ? "var(--cvb-mint)" : "var(--cvb-well)",
        border: `1px solid ${tone === "mint" ? "var(--cvb-mint-line)" : "var(--cvb-line-ctl)"}`,
        borderRadius: 999,
        padding: "4px 10px",
      }}
    >
      {children}
    </span>
  );
}

function FieldLabel({ children }: { children: string }) {
  return <div style={{ ...mono, fontSize: 9.5, letterSpacing: ".13em", color: "var(--cvb-faint)", marginBottom: 7 }}>{children}</div>;
}

/* ------------------------------------------------- sending window + tz edit */

function SendingWindowCard({
  sw,
  noWeekend,
  guardrails,
  agentId,
  flash,
  onSaved,
}: {
  sw: Guardrails["sendingWindow"];
  noWeekend: boolean;
  guardrails: Guardrails;
  agentId: string;
  flash: (msg: string) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const zones = useMemo(() => allTimezones(), []);
  const shown = zones.filter((z) => z.toLowerCase().includes(q.toLowerCase())).slice(0, 10);

  async function pick(tz: string) {
    if (saving) return;
    setSaving(true);
    // Full replace (the shipped PATCH contract) — everything this card does
    // not render is sent back untouched, so no other surface's write erodes.
    // Re-fetch first: replaying a mount-time snapshot would silently revert
    // anything another surface wrote since this tab loaded.
    const fresh = await fetchBoldView(agentId);
    const base = fresh?.guardrails ?? guardrails;
    const res = await patchAgentGuardrails(agentId, {
      ...base,
      sendingWindow: { ...base.sendingWindow, timezone: tz },
    });
    setSaving(false);
    setOpen(false);
    setQ("");
    if (!res.ok) {
      flash(res.error);
      return;
    }
    flash(`Timezone set to ${tz}`);
    onSaved();
  }

  return (
    <div data-testid="bold-plan-window" style={{ background: "var(--cvb-panel)", border: "1px solid var(--cvb-line)", borderRadius: 20, padding: "18px 20px", position: "relative" }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: ".13em", color: "var(--cvb-faint)" }}>SENDING WINDOW</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 8, letterSpacing: "-.02em" }}>
        {daysLabel(sw.days)}, {stripZero(sw.start)}–{stripZero(sw.end)}
      </div>
      <div style={{ fontSize: 12, color: "var(--cvb-faint)", marginTop: 4 }}>
        {sw.timezone}
        {noWeekend ? " · no weekend sends" : ""}
      </div>
      <div onClick={() => setOpen((v) => !v)} data-testid="bold-plan-tz" style={{ fontSize: 12, fontWeight: 700, color: "var(--cvb-cyan)", marginTop: 10, cursor: "pointer" }}>
        Change timezone
      </div>
      {open ? (
        <div style={{ position: "absolute", left: 12, right: 12, top: "calc(100% - 8px)", background: "var(--cvb-card)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 13, padding: 8, zIndex: 5, boxShadow: "var(--cvb-shadow-card)" }}>
          <input
            autoFocus
            placeholder="Search timezones"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            data-testid="bold-plan-tz-search"
            style={{ width: "100%", background: "var(--cvb-well)", border: "1px solid var(--cvb-line-ctl)", borderRadius: 9, padding: "8px 10px", fontSize: 12.5, outline: "none", fontFamily: "inherit" }}
          />
          <div style={{ maxHeight: 218, overflowY: "auto", marginTop: 5 }}>
            {shown.map((z) => (
              <div
                key={z}
                onClick={() => void pick(z)}
                style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12.5, fontWeight: z === sw.timezone ? 700 : 500, color: z === sw.timezone ? "var(--cvb-forest)" : "var(--cvb-ink)", cursor: "pointer", background: z === sw.timezone ? "var(--cvb-mint)" : "transparent" }}
              >
                {z}
              </div>
            ))}
            {shown.length === 0 ? <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--cvb-faint)" }}>No matches.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
