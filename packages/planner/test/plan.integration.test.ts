/**
 * P1.4 acceptance integration: planning a seeded agent persists a validated
 * CampaignGraph v1 (source AI) on the primary campaign, the executor
 * round-trips it in dry-run, step copy is grounded in the stored
 * BusinessContext (DEC-015: ≥2 traceable facts) and carries the merge tokens;
 * broken model output is caught and never persisted. Requires Postgres;
 * completions are a prompt-parsing fake (no network). Skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
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

/** "good" emits a grounded valid graph; "broken" emits a dangling branch goto. */
let mode: "good" | "broken" = "good";

function fakeGraph(prompt: string): object {
  // Grounding simulation: only use facts that actually appear in the prompt's
  // context block (as the real prompt instructs the model).
  const audit = prompt.includes(FACT_AUDIT) ? FACT_AUDIT : "our service";
  const price = prompt.includes(FACT_PRICE) ? FACT_PRICE : "our pricing";
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

const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => ({
      input: fakeGraph(params.prompt),
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(() => new Array(1536).fill(0.001)),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

describe.skipIf(!hasInfra)("planCampaign integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let agentId: string;
  let emptyAgentId: string;
  const deps = () => ({ prisma: app, gateway });

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
    mode = "good";
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
    mode = "good";
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
    mode = "good";
    await expect(planCampaign(deps(), { workspaceId: wsB, agentId: emptyAgentId })).rejects.toThrow(
      /BusinessContext is empty/,
    );
  });
});
