/**
 * P1.4 acceptance integration: planning a seeded agent persists a validated
 * CampaignGraph v1 (source AI) on the primary campaign, the executor
 * round-trips it in dry-run, step copy is grounded in the stored
 * BusinessContext (DEC-015: ≥2 traceable facts) and carries the merge tokens;
 * broken model output is caught and never persisted. Requires Postgres;
 * completions are a prompt-parsing fake (no network). Skips without infra.
 *
 * M1a (DEC-064): the fake is PROMPT-DRIVEN like the original grounding
 * simulation — it emits the selling-craft arc shape only when the prompt
 * carries the v3 STRATEGY block, and honors the prompt's NEVER SAY list
 * (violating once/always per test mode). The structural assertions walk the
 * planned graph in flow order: opener word-cap + ends with its single
 * question, one CTA per step, strictly decreasing length, breakup last.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import { OPENER_WORD_CAP, type CampaignGraph, type StepNode } from "@clientforce/core";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { planCampaign, PlannerError } from "../src/plan";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// The facts the fake planner lifts from the prompt's BUSINESS CONTEXT block —
// the DEC-015 assertion then traces them back to the stored BusinessContext.
const FACT_AUDIT = "free growth audit";
const FACT_PRICE = "99 dollars per booked appointment";

/** "good" emits a valid graph; "broken" emits a dangling branch goto. */
let mode: "good" | "broken" = "good";
/** M1a: whether the fake violates the prompt's NEVER SAY list. */
let banMode: "none" | "once" | "always" = "none";
let toolCalls = 0;
let lastPrompt = "";

/**
 * The pre-M1a fake shape, kept VERBATIM — what a planner without the playbook
 * produced. The structural before/after asserts this shape violates the arc.
 */
function legacyGraph(audit: string, price: string): object {
  return {
    entry: "step-1",
    nodes: [
      {
        id: "step-1",
        type: "step",
        channel: "email",
        content: {
          subject: `A ${audit} for {{company}}`,
          body: `Hi {{firstName}}, we run a ${audit} — pricing starts at ${price}. Worth a look for {{company}}?`,
        },
      },
      { id: "delay-1", type: "delay", amount: 3, unit: "days" },
      {
        id: "step-2",
        type: "step",
        channel: "email",
        content: {
          subject: "Following up",
          body: `Hi {{firstName}}, circling back on the ${audit}.`,
        },
      },
      {
        id: "branch-reply",
        type: "branch",
        on: "reply",
        cases: [
          { when: { intent: "interested" }, goto: mode === "broken" ? "nowhere" : "end-won" },
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
  };
}

/**
 * The arc-compliant shape a model following the v3 playbook emits: opener ≤
 * cap ending with its one question, value/proof, objection-preempt, breakup
 * last and shortest — strictly decreasing, one CTA each. `dirty` appends a
 * banned phrase (parsed from the prompt) to the value step.
 */
function craftGraph(audit: string, price: string, dirty: string): object {
  return {
    entry: "step-1",
    nodes: [
      {
        id: "step-1",
        type: "step",
        channel: "email",
        content: {
          subject: "where bookings leak",
          body:
            `Noticed {{company}} still books most patients by phone — usually where no-shows creep in. ` +
            `We run a ${audit} that shows practices exactly where bookings leak, {{firstName}}. Worth a 15-minute look?`,
        },
      },
      { id: "delay-1", type: "delay", amount: 2, unit: "days" },
      {
        id: "step-2",
        type: "step",
        channel: "email",
        content: {
          subject: "the audit numbers",
          body: `One number from that ${audit}: ${price} — measured, not promised. Want the two-line summary for {{company}}, {{firstName}}?${dirty}`,
        },
      },
      {
        id: "branch-reply",
        type: "branch",
        on: "reply",
        cases: [
          { when: { intent: "interested" }, goto: mode === "broken" ? "nowhere" : "end-won" },
          { when: "default", goto: "step-3" },
        ],
      },
      {
        id: "step-3",
        type: "step",
        channel: "email",
        content: {
          subject: "one 20-minute call",
          body: `It's one 20-minute call, {{firstName}} — no prep, no commitment. Open to it?`,
        },
      },
      { id: "delay-2", type: "delay", amount: 4, unit: "days" },
      {
        id: "step-4",
        type: "step",
        channel: "email",
        content: {
          subject: "closing the file",
          body: `Closing the file on {{company}}, {{firstName}} — no worries either way.`,
        },
      },
      { id: "end-won", type: "end" },
      { id: "end-lost", type: "end" },
    ],
    edges: [
      { from: "step-1", to: "delay-1" },
      { from: "delay-1", to: "step-2" },
      { from: "step-2", to: "branch-reply" },
      { from: "step-3", to: "delay-2" },
      { from: "delay-2", to: "step-4" },
      { from: "step-4", to: "end-lost" },
    ],
  };
}

function fakeGraph(prompt: string): object {
  // Grounding simulation: only use facts that actually appear in the prompt's
  // context block (as the real prompt instructs the model).
  const audit = prompt.includes(FACT_AUDIT) ? FACT_AUDIT : "our service";
  const price = prompt.includes(FACT_PRICE) ? FACT_PRICE : "our pricing";

  // v2-shaped prompts (no STRATEGY block) get the pre-playbook shape.
  if (!prompt.includes("STRATEGY (the selling method")) return legacyGraph(audit, price);

  // NEVER SAY simulation: a compliant model avoids the terms; the banMode
  // modes model a model that slips once (repaired) or keeps slipping (typed
  // failure). The repair prompt is recognizable by its FAILED marker.
  const isRepair = prompt.includes("FAILED validation");
  const terms = [...(prompt.match(/NEVER SAY[^:]*: (.+)/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
    (m) => m[1]!,
  );
  const violate = banMode === "always" || (banMode === "once" && !isRepair);
  const dirty = violate && terms.length > 0 ? ` We offer ${terms[0]}.` : "";
  return craftGraph(audit, price, dirty);
}

const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => {
      toolCalls += 1;
      lastPrompt = params.prompt;
      return {
        input: fakeGraph(params.prompt),
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(() => new Array(1536).fill(0.001)),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

// ── Structural helpers (M1a acceptance — asserted, not eyeballed) ────────────

/** Steps in the order a NON-replying lead experiences them (branch → default). */
function followUpSteps(graph: CampaignGraph): StepNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const next = new Map(graph.edges.map((e) => [e.from, e.to]));
  const steps: StepNode[] = [];
  let cursor: string | undefined = graph.entry;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) break;
    if (node.type === "step") steps.push(node);
    cursor =
      node.type === "branch"
        ? node.cases.find((c) => c.when === "default")?.goto
        : next.get(cursor);
  }
  return steps;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const questions = (s: string) => (s.match(/\?/g) ?? []).length;

/** Violations of the arc structure; empty = the sequence exhibits the arc. */
function arcViolations(graph: CampaignGraph): string[] {
  const steps = followUpSteps(graph);
  const v: string[] = [];
  if (steps.length < 3) v.push(`only ${steps.length} follow-up steps — no room for objection-preempt + breakup roles`);
  const opener = steps[0];
  if (opener) {
    const body = opener.content.body ?? "";
    if (words(body) > OPENER_WORD_CAP) v.push(`opener over the ${OPENER_WORD_CAP}-word cap`);
    if (!body.trim().endsWith("?")) v.push("opener does not end with its question");
    if (questions(body) !== 1) v.push("opener must ask exactly one question");
  }
  for (const s of steps) {
    if (questions(s.content.body ?? "") > 1) v.push(`${s.id} asks more than one question (one CTA per message)`);
  }
  for (let i = 1; i < steps.length; i++) {
    if (words(steps[i]!.content.body ?? "") >= words(steps[i - 1]!.content.body ?? "")) {
      v.push(`${steps[i]!.id} is not shorter than ${steps[i - 1]!.id}`);
    }
  }
  const last = steps[steps.length - 1];
  if (last && !/no worries|either way|close|closing|door'?s open/i.test(last.content.body ?? "")) {
    v.push("last step is not a polite breakup (no easy-out language)");
  }
  return v;
}

describe.skipIf(!hasInfra)("planCampaign integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let agentId: string;
  let emptyAgentId: string;
  let craftAgentId: string;
  const deps = () => ({ prisma: app, gateway });

  beforeEach(() => {
    mode = "good";
    banMode = "none";
    toolCalls = 0;
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `pl-${suffix}`, slug: `pl-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "PA", slug: `pla-${suffix}`, settings: {} },
      })
    ).id;
    wsB = (
      await owner.workspace.create({
        data: { agencyId, name: "PB", slug: `plb-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: wsA, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    emptyAgentId = (
      await owner.agent.create({
        data: { workspaceId: wsB, name: "NoContext", goal: "book_appointments", guardrails: {} },
      })
    ).id;
    // M1a fixture: same goal, a persisted category, and a strategy block
    // riding guardrails (notes + neverSay).
    craftAgentId = (
      await owner.agent.create({
        data: {
          workspaceId: wsA,
          name: "Crafted",
          goal: "book_appointments",
          category: "Dental & Orthodontics",
          guardrails: {
            sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
            dailyCap: { email: 200 },
            consent: null,
            strategy: {
              strategyNotes: "Lead with the audit, never discount.",
              neverSay: ["rock-bottom prices"],
            },
            unsubscribeFooter: true,
            suppressionCheck: true,
          },
        },
      })
    ).id;

    // Stored BusinessContext (workspace layer) carrying the concrete facts the
    // planner's copy must trace to (DEC-015).
    const snapshot = {
      chunkId: "chunk-x",
      sourceId: "src-x",
      sourceLabel: "site",
      sourceType: "TEXT",
      locator: "site",
      quote: "verbatim",
    };
    await owner.businessContext.create({
      data: {
        workspaceId: wsA,
        agentId: null,
        status: "READY",
        fields: {
          offer: {
            value: `We book dental appointments with a ${FACT_AUDIT}.`,
            citations: [snapshot],
            source: "distilled",
          },
          pricing: {
            value: `Pricing starts at ${FACT_PRICE}.`,
            citations: [snapshot],
            source: "distilled",
          },
          usp: {
            value: "Only we guarantee 15 new patients.",
            citations: [snapshot],
            source: "distilled",
          },
          icp: { value: "Dentists in Austin", citations: [], source: "typed" },
        },
        rawSummary: "Dental growth business.",
      },
    });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("plans, validates, dry-runs, and persists v1 (source AI) on the primary campaign", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });

    expect(result.campaign.agentId).toBe(agentId);
    expect(result.campaign.graphId).toBe(result.graphRow.id);
    expect(result.graphRow.version).toBe(1);
    expect(result.graphRow.source).toBe("AI");

    // Executor round-trip: reply branch resolved as "interested".
    const kinds = result.dryRun.map((a) => a.kind);
    expect(kinds).toContain("send");
    expect(kinds).toContain("wait");
    expect(kinds).toContain("branch");
    expect(kinds[kinds.length - 1]).toBe("end");

    // Tokens appear in step content (P1.4 acceptance).
    const copy = JSON.stringify(result.graph);
    expect(copy).toContain("{{firstName}}");
    expect(copy).toContain("{{company}}");

    // DEC-015: ≥2 concrete facts traceable to the STORED BusinessContext.
    const stored = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.businessContext.findFirstOrThrow({ where: { workspaceId: wsA, agentId: null } }),
    );
    const storedValues = JSON.stringify(stored.fields);
    for (const fact of [FACT_AUDIT, FACT_PRICE]) {
      expect(copy).toContain(fact);
      expect(storedValues).toContain(fact);
    }
  });

  it("re-planning bumps the version and repoints the campaign", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });
    expect(result.graphRow.version).toBe(2);
    expect(result.campaign.graphId).toBe(result.graphRow.id);
  });

  it("broken model output is caught after one repair and NEVER persisted", async () => {
    mode = "broken";
    const before = await owner.campaignGraph.count({ where: { workspaceId: wsA } });
    const beforeCampaign = await owner.campaign.findFirstOrThrow({ where: { agentId } });

    await expect(planCampaign(deps(), { workspaceId: wsA, agentId })).rejects.toThrow(PlannerError);

    expect(await owner.campaignGraph.count({ where: { workspaceId: wsA } })).toBe(before);
    const afterCampaign = await owner.campaign.findFirstOrThrow({ where: { agentId } });
    expect(afterCampaign.graphId).toBe(beforeCampaign.graphId);
  });

  it("refuses to plan without a BusinessContext (DEC-015 grounding)", async () => {
    await expect(planCampaign(deps(), { workspaceId: wsB, agentId: emptyAgentId })).rejects.toThrow(
      /BusinessContext is empty/,
    );
  });

  // ── M1a (DEC-064): selling craft + strategy block ──────────────────────────

  it("the planned sequence exhibits the arc STRUCTURALLY; the pre-playbook shape does not", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId });

    // After: opener ≤ cap ending with its single question, one CTA per step,
    // strictly decreasing length, breakup last — zero violations.
    expect(arcViolations(result.graph)).toEqual([]);
    const steps = followUpSteps(result.graph);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(words(steps[0]!.content.body ?? "")).toBeLessThanOrEqual(OPENER_WORD_CAP);

    // Before: the pre-M1a shape (kept verbatim) violates the arc.
    const legacy = legacyGraph(FACT_AUDIT, FACT_PRICE) as CampaignGraph;
    expect(arcViolations(legacy).length).toBeGreaterThan(0);

    // The prompt carried the agent's derived arc + owner strategy (wiring proof).
    expect(lastPrompt).toContain("Arc: Diagnose, then prescribe");
    expect(lastPrompt).toContain("patient-outcome-first");
    expect(lastPrompt).toContain("Lead with the audit, never discount.");
    expect(lastPrompt).toContain('"rock-bottom prices"');

    // Grounding is unchanged by the craft pass (DEC-015 still holds).
    const copy = JSON.stringify(result.graph);
    expect(copy).toContain(FACT_AUDIT);
    expect(copy).toContain("{{firstName}}");
    expect(copy).toContain("{{company}}");
  });

  it("neverSay violation → bounded auto-repair → clean graph persisted (2 model calls)", async () => {
    banMode = "once";
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId });
    expect(toolCalls).toBe(2);
    expect(JSON.stringify(result.graph).toLowerCase()).not.toContain("rock-bottom prices");
    // The repaired graph is a real persisted version.
    expect(result.graphRow.source).toBe("AI");
  });

  it("neverSay still violated after repair → typed failure, NOTHING persisted", async () => {
    banMode = "always";
    const before = await owner.campaignGraph.count({ where: { workspaceId: wsA } });
    await expect(
      planCampaign(deps(), { workspaceId: wsA, agentId: craftAgentId }),
    ).rejects.toThrow(PlannerError);
    expect(toolCalls).toBe(2);
    expect(await owner.campaignGraph.count({ where: { workspaceId: wsA } })).toBe(before);
  });

  it("REGRESSION: an agent with legacy guardrails and no category plans end-to-end unchanged", async () => {
    const result = await planCampaign(deps(), { workspaceId: wsA, agentId });
    expect(result.graphRow.source).toBe("AI");
    // The prompt renders the defaults — no owner strategy, no bans, and the
    // goal's default arc under the neutral tone (legacy rows never crash).
    expect(lastPrompt).toContain("Owner strategy notes: (none)");
    expect(lastPrompt).toMatch(/NEVER SAY[^:]*: \(none\)/);
    expect(lastPrompt).toContain("Arc: Diagnose, then prescribe");
    expect(lastPrompt).toContain("default professional tone");
  });
});
