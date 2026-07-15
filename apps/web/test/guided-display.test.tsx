/**
 * DEC-086 — the three owner-reported guided display defects, pinned (one
 * root cause: display read stored copy, never the composeMode rider):
 *   A  wizard step-2 cards under a guided rider render "Objective: …" +
 *      "✦ Composed at send", never the scripted body;
 *   B  the agent-view Steps tab renders the same treatment (+ the pending
 *      banner) instead of mode-blind scripted summaries;
 *   C  the segmented control's selected state derives from the STORED
 *      rider (the prop), so it survives tab-switch and reload by
 *      construction.
 * Baked-guided cards keep the G1/G2 anatomy; a MIXED sequence is deliberate
 * per-step state, so its scripted steps keep the baked truth (no pending
 * treatment). DEC-075 Regenerate-to-apply semantics untouched throughout.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CampaignGraph, GraphNode } from "@clientforce/core";
import { guidedCardDisplay } from "../components/sequence/shared";
import { Step2Sequence } from "../app/agents/new/steps/Step2Sequence";
import { StepsTab } from "../app/(shell)/agents/[agentId]/[tab]/StepsTab";
import type { AgentViewData } from "../app/(shell)/agents/[agentId]/[tab]/AgentView";

type StepNode = Extract<GraphNode, { type: "step" }>;

const SCRIPTED_BODY_1 = "Hi {{firstName}}, most practices lose bookings to phone tag. Our scheduler fills the gaps automatically.";
const SCRIPTED_BODY_2 = "Hi {{firstName}}, quick nudge from BrightPath — want the free audit? Reply YES.";

const scriptedGraph = (): CampaignGraph => ({
  entry: "step-1",
  nodes: [
    { id: "step-1", type: "step", channel: "email", content: { subject: "Quick question about {{company}}", body: SCRIPTED_BODY_1 } },
    { id: "delay-1", type: "delay", amount: 2, unit: "days" },
    { id: "step-2", type: "step", channel: "sms", content: { body: SCRIPTED_BODY_2 } },
    {
      id: "branch-reply",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-won", pipeline: "booked" },
        { when: "default", goto: "end-lost" },
      ],
    },
    { id: "end-won", type: "end" },
    { id: "end-lost", type: "end" },
  ],
  edges: [
    { from: "step-1", to: "delay-1" },
    { from: "delay-1", to: "step-2" },
    { from: "step-2", to: "branch-reply" },
  ],
});

const mixedGraph = (): CampaignGraph => {
  const g = scriptedGraph();
  const s2 = g.nodes.find((n) => n.id === "step-2") as StepNode;
  s2.mode = "guided";
  s2.content = {};
  s2.brief = { objective: "Nudge the unopened email with one easy yes", talkingPoints: ["reference the audit", "one question", "under one segment"] };
  return g;
};

const AGENT = { goal: "reactivate_leads", category: "Dental & Orthodontics" };
// selectStrategy(reactivate_leads, Dental) → the revive-relationship arc;
// substrings chosen apostrophe-free so HTML escaping can't break matching.
const OPENER_ROLE_FRAGMENT = "reference the past relationship and what";
const BREAKUP_ROLE_FRAGMENT = "close the loop politely with an easy out";

describe("guidedCardDisplay (the shared resolver)", () => {
  const steps = scriptedGraph().nodes.filter((n): n is StepNode => n.type === "step");

  it("baked-guided → the REAL brief, whatever the rider says", () => {
    const s2 = mixedGraph().nodes.find((n) => n.id === "step-2") as StepNode;
    for (const pending of [true, false]) {
      const gd = guidedCardDisplay(s2, pending, { index: 2, count: 2 }, AGENT);
      expect(gd).toEqual({ kind: "brief", brief: s2.brief });
    }
  });

  it("pending (rider guided, plan predates the flip) → the deterministic seed objective at the step's arc slot", () => {
    const first = guidedCardDisplay(steps[0]!, true, { index: 1, count: 2 }, AGENT);
    const last = guidedCardDisplay(steps[1]!, true, { index: 2, count: 2 }, AGENT);
    expect(first?.kind).toBe("pending");
    expect(last?.kind).toBe("pending");
    if (first?.kind === "pending") expect(first.objective).toContain(OPENER_ROLE_FRAGMENT);
    if (last?.kind === "pending") expect(last.objective).toContain(BREAKUP_ROLE_FRAGMENT);
  });

  it("not pending (scripted rider, or a MIXED plan — deliberate per-step state) → null: baked truth renders", () => {
    expect(guidedCardDisplay(steps[0]!, false, { index: 1, count: 2 }, AGENT)).toBeNull();
  });

  it("non-briefable channel under a pending rider → '✦ AI draft' (stays as written — the canon gStep mapping)", () => {
    const wa: StepNode = { id: "step-w", type: "step", channel: "whatsapp", content: { body: "template text" } };
    expect(guidedCardDisplay(wa, true, { index: 1, count: 2 }, AGENT)).toEqual({ kind: "aidraft" });
    expect(guidedCardDisplay(wa, false, { index: 1, count: 2 }, AGENT)).toBeNull();
  });
});

/** Full Step2Sequence prop set — display fixtures + no-op plumbing. */
function wizardProps(graph: CampaignGraph, composeMode: "scripted" | "guided") {
  const noop = () => {};
  const anoop = async () => {};
  return {
    drafting: false,
    graph,
    graphSource: "AI",
    graphVersion: 1,
    outcomes: null,
    seqView: "sequence" as const,
    setSeqView: noop as never,
    regenError: null,
    regenerate: anoop,
    addStep: anoop,
    branchCases: (graph.nodes.find((n) => n.type === "branch") as Extract<GraphNode, { type: "branch" }>).cases,
    windowStart: "09:00",
    windowEnd: "17:00",
    timezone: "UTC",
    audienceTotal: 0,
    composeMode,
    setSequenceMode: anoop as never,
    editNode: null,
    setEditNode: noop as never,
    editSubject: "",
    setEditSubject: noop as never,
    editBody: "",
    setEditBody: noop as never,
    editBrief: null,
    setEditBrief: noop as never,
    briefPointInput: "",
    setBriefPointInput: noop as never,
    briefMustInput: "",
    setBriefMustInput: noop as never,
    briefNeverInput: "",
    setBriefNeverInput: noop as never,
    previewBusy: false,
    preview: null,
    setPreview: noop as never,
    fieldDefs: [],
    customTokenKey: null,
    setCustomTokenKey: noop as never,
    customFallback: "",
    setCustomFallback: noop as never,
    delayEdit: null,
    setDelayEdit: noop as never,
    delayAmount: 2,
    setDelayAmount: noop as never,
    editStepIndex: 0,
    editStrategyIntent: null,
    insertCustomToken: noop,
    saveEditedStep: anoop,
    sampleCompose: anoop,
    saveDelay: anoop,
    agentId: "agent-1",
    goal: AGENT.goal,
    category: AGENT.category,
    emailConnected: true,
    subRules: [],
    subNewOpen: false,
    setSubNewOpen: noop as never,
    subNewPrefill: null,
    setSubNewPrefill: noop as never,
    onSubcampaignCreated: noop as never,
  };
}

describe("defect A — wizard step-2 cards key off the rider", () => {
  it("guided selected over a scripted plan: Objective + ✦ Composed at send + credits, NEVER the scripted body; banner + relabel intact", () => {
    const html = renderToStaticMarkup(<Step2Sequence {...wizardProps(scriptedGraph(), "guided")} />);
    expect(html).toContain('data-testid="seq-brief-pending"');
    expect(html).toContain("Objective: ");
    expect(html).toContain(OPENER_ROLE_FRAGMENT);
    expect(html).toContain("✦ Composed at send");
    expect(html).toContain("credits / send");
    expect(html).not.toContain("phone tag"); // the scripted body never renders
    expect(html).not.toContain("quick nudge from BrightPath");
    // DEC-075 locked affordances stay: banner mismatch line + relabel
    expect(html).toContain("These steps were planned as scripted");
    expect(html).toContain("✦ Regenerate to apply");
  });

  it("scripted selected: cards render copy exactly as before (no pending treatment, no guided chips)", () => {
    const html = renderToStaticMarkup(<Step2Sequence {...wizardProps(scriptedGraph(), "scripted")} />);
    expect(html).toContain("phone tag");
    expect(html).toContain("✦ AI draft");
    expect(html).not.toContain('data-testid="seq-brief-pending"');
    expect(html).not.toContain("✦ Composed at send");
  });

  it("MIXED plan under a guided rider: baked truth — the guided step renders its REAL brief, the scripted step keeps its copy", () => {
    const html = renderToStaticMarkup(<Step2Sequence {...wizardProps(mixedGraph(), "guided")} />);
    expect(html).toContain("Nudge the unopened email with one easy yes");
    expect(html).toContain("phone tag"); // deliberate per-step scripted state stays visible
    expect(html).not.toContain('data-testid="seq-brief-pending"');
  });
});

describe("defect C — the segmented control reflects the STORED rider", () => {
  const activePill = (html: string, tid: string) => {
    const m = html.match(new RegExp(`<span[^>]*data-testid="${tid}"[^>]*>`));
    return m ? /background:#fff/.test(m[0]) && /font-weight:700/.test(m[0]) : false;
  };

  it("composeMode=guided → the Guided segment carries the selected pill; Scripted does not", () => {
    const html = renderToStaticMarkup(<Step2Sequence {...wizardProps(scriptedGraph(), "guided")} />);
    expect(activePill(html, "seq-mode-guided")).toBe(true);
    expect(activePill(html, "seq-mode-scripted")).toBe(false);
  });

  it("composeMode=scripted → the Scripted segment carries the selected pill", () => {
    const html = renderToStaticMarkup(<Step2Sequence {...wizardProps(scriptedGraph(), "scripted")} />);
    expect(activePill(html, "seq-mode-scripted")).toBe(true);
    expect(activePill(html, "seq-mode-guided")).toBe(false);
  });
});

function view(graph: CampaignGraph, composeMode?: "scripted" | "guided"): AgentViewData {
  return {
    agent: { id: "agent-1", name: "Riverbend Reactivation", goal: AGENT.goal, category: AGENT.category, status: "ACTIVE", createdAt: "2026-07-01T00:00:00Z" },
    campaign: { id: "c-1", name: "Riverbend campaign" },
    graph,
    graphVersion: 1,
    graphSource: "AI",
    sentToday: 0,
    dailyCap: 200,
    guardrails: {
      sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 200, sms: 50 },
      ...(composeMode ? { composeMode } : {}),
      unsubscribeFooter: true,
      suppressionCheck: true,
    },
    perStep: {},
    eventCounts: {},
  };
}

describe("defect B — Steps tab card summaries key off the rider (2026-07-15 Campaign View canon)", () => {
  it("guided rider over a scripted plan: pending treatment + the canon banner with the mismatch line, NEVER the scripted body", () => {
    const html = renderToStaticMarkup(<StepsTab view={view(scriptedGraph(), "guided")} outcomes={null} />);
    expect(html).toContain('data-testid="step-brief-pending"');
    expect(html).toContain(OPENER_ROLE_FRAGMENT);
    expect(html).toContain("✦ Composed at send");
    expect(html).toContain("credits / send");
    expect(html).not.toContain("phone tag");
    expect(html).toContain('data-testid="steps-guided-banner"');
    expect(html).toContain('data-testid="steps-regen-to-apply-note"');
    expect(html).toContain("These steps were planned as scripted");
    expect(html).toContain("✦ Regenerate to apply");
  });

  it("MIXED plan under a guided rider: baked truth per card + the canon banner WITHOUT the mismatch line; the deliberate scripted step tags '✦ AI draft' (hasModeTag = guidedOn)", () => {
    const html = renderToStaticMarkup(<StepsTab view={view(mixedGraph(), "guided")} outcomes={null} />);
    expect(html).toContain("Nudge the unopened email with one easy yes");
    expect(html).toContain("phone tag");
    expect(html).not.toContain('data-testid="step-brief-pending"');
    expect(html).toContain('data-testid="steps-guided-banner"');
    expect(html).not.toContain('data-testid="steps-regen-to-apply-note"');
    expect(html).toContain('data-testid="step-aidraft-tag"');
  });

  it("no rider (legacy scripted agent): cards byte-stable — copy, no guided chips, no banner, no mode tags (canon: tags render only under guided)", () => {
    const html = renderToStaticMarkup(<StepsTab view={view(scriptedGraph())} outcomes={null} />);
    expect(html).toContain("phone tag");
    expect(html).not.toContain("✦ Composed at send");
    expect(html).not.toContain('data-testid="steps-guided-banner"');
    expect(html).not.toContain('data-testid="step-aidraft-tag"');
  });
});

describe("defect C (dashboard) — the canon header control reflects the STORED rider", () => {
  const activePill = (html: string, tid: string) => {
    const m = html.match(new RegExp(`<span[^>]*data-testid="${tid}"[^>]*>`));
    return m ? /background:#fff/.test(m[0]) && /font-weight:700/.test(m[0]) : false;
  };

  it("guided rider → the Guided segment carries the selected pill (persisted state, straight from the store)", () => {
    const html = renderToStaticMarkup(<StepsTab view={view(scriptedGraph(), "guided")} outcomes={null} />);
    expect(html).toContain('data-testid="steps-mode-control"');
    expect(activePill(html, "steps-mode-guided")).toBe(true);
    expect(activePill(html, "steps-mode-scripted")).toBe(false);
  });

  it("absent rider → Scripted selected (absent = scripted, the G1 default)", () => {
    const html = renderToStaticMarkup(<StepsTab view={view(scriptedGraph())} outcomes={null} />);
    expect(activePill(html, "steps-mode-scripted")).toBe(true);
    expect(activePill(html, "steps-mode-guided")).toBe(false);
  });
});
