/**
 * P1.3 distiller integration: evidence-cited fills persisted with real chunk
 * ids, invalid/unrequested fills dropped server-side, typed answers surviving
 * re-distill, two-layer separation (agent-only evidence), and the RLS
 * round-trip. Requires Postgres; embeddings + completions are fakes (no
 * network). Skips without infra so `pnpm test` stays green.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AiGateway } from "@clientforce/ai";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { ingestSource, MemoryUploadStore, uploadPathFor } from "@clientforce/knowledge";
import { distill, parseFields } from "../src/distill";
import { checkGaps } from "../src/gaps";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Deterministic embeddings (term-presence direction, as in the P1.2 suite). */
const VOCAB = ["appointment", "pricing", "audit", "address", "different"];
function fakeVector(text: string): number[] {
  const v = new Array(1536).fill(0.0001);
  const lower = text.toLowerCase();
  VOCAB.forEach((term, i) => {
    if (lower.includes(term)) v[i] = 1;
  });
  return v;
}

/**
 * Fake completion provider: reads the evidence chunk ids straight out of the
 * rendered prompt (the `[<uuid>]` lines) and fills a fixed set of fields
 * citing the first real id — plus one fill with a bogus citation and one for
 * a key that was never requested, both of which the server-side validation
 * must drop.
 */
const FILLS = ["offer", "usp", "tone", "pricing", "company_address"];
let lastPrompt = "";
function fakeCompleteTool(prompt: string): { input: unknown } {
  lastPrompt = prompt;
  const ids = [...prompt.matchAll(/^\[([0-9a-f-]{36})\]$/gim)].map((m) => m[1]!);
  const requested = [...prompt.matchAll(/^- ([a-z_]+) — /gim)].map((m) => m[1]!);
  const fields = requested
    .filter((k) => FILLS.includes(k))
    .map((key) => ({ key, value: `Distilled ${key} from evidence`, citations: [ids[0]!] }));
  fields.push({
    key: "pricing",
    value: "hallucinated",
    citations: ["00000000-0000-0000-0000-000000000000"],
  });
  fields.push({ key: "not_a_registry_key", value: "junk", citations: [ids[0]!] });
  // L1 (DEC-072): a model following the v2 prompt writes the brief in the
  // requested language — the fake honors the prompt's own rule line.
  const rawSummary = prompt.includes("written in German (Deutsch)")
    ? "Ein Zahnarzt-Wachstumsunternehmen — aus den eigenen Unterlagen destilliert."
    : prompt.includes("written in French (Français)")
      ? "Une entreprise de croissance dentaire — distillée à partir de ses propres documents."
      : "A dental growth business distilled from evidence.";
  return {
    input: {
      fields,
      rawSummary,
      proposedAsks: [],
    },
  };
}

const gateway = new AiGateway({
  provider: {
    completeText: async () => ({ text: "", usage: { inputTokens: 0, outputTokens: 0 } }),
    completeTool: async (params: { prompt: string }) => ({
      ...fakeCompleteTool(params.prompt),
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
  },
  embeddings: {
    embed: async (texts: string[]) => ({
      vectors: texts.map(fakeVector),
      usage: { inputTokens: texts.length, outputTokens: 0 },
    }),
  },
  config: { maxRetries: 0 },
});

describe.skipIf(!hasInfra)("distill integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let agentId: string;
  const deps = () => ({ prisma: app, gateway });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `ctx-${suffix}`, slug: `ctx-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (
      await owner.workspace.create({
        data: { agencyId, name: "CA", slug: `ctxa-${suffix}`, settings: {} },
      })
    ).id;
    wsB = (
      await owner.workspace.create({
        data: { agencyId, name: "CB", slug: `ctxb-${suffix}`, settings: {} },
      })
    ).id;
    agentId = (
      await owner.agent.create({
        data: { workspaceId: wsA, name: "Booker", goal: "book_appointments", guardrails: {} },
      })
    ).id;

    // Workspace-scoped knowledge (Brand-kit docs) — TEXT sources through the
    // real P1.2 pipeline so chunks carry real ids + embeddings.
    const mkSource = (workspaceId: string, agent: string | null, label: string, text: string) =>
      withTenant(app, { workspaceId }, (tx) =>
        tx.knowledgeSource.create({
          data: { workspaceId, agentId: agent, kind: "TEXT", label, meta: { text } },
        }),
      );
    const store = new MemoryUploadStore();
    const wsSource = await mkSource(
      wsA,
      null,
      "site",
      "We are Acme Dental Growth. We book dental appointments with a free growth audit.\n" +
        "Our pricing starts at 99 dollars per booked appointment.\n" +
        "We are different because only we guarantee 15 new patients.\n" +
        "Our address is 1 Main Street, Austin TX 78701.",
    );
    await ingestSource(
      { prisma: app, gateway, store },
      { sourceId: wsSource.id, workspaceId: wsA },
    );
    const agentSource = await mkSource(
      wsA,
      agentId,
      "agent-notes",
      "This campaign books appointment slots on Tuesdays. Audit pricing for this audience is 79 dollars.",
    );
    await ingestSource(
      { prisma: app, gateway, store },
      { sourceId: agentSource.id, workspaceId: wsA },
    );
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("workspace-layer distill persists cited fills; invalid citations and unknown keys are dropped", async () => {
    const row = await distill(deps(), { workspaceId: wsA });
    expect(row.agentId).toBeNull();
    expect(row.status).toBe("READY");
    expect(row.distilledAt).not.toBeNull();

    const fields = parseFields(row.fields);
    // Cited fills landed as SNAPSHOTS with REAL chunk ids (DEC-028)…
    const chunkIds = new Set(
      (await owner.knowledgeChunk.findMany({ where: { workspaceId: wsA } })).map((c) => c.id),
    );
    for (const key of ["offer", "usp", "tone", "pricing", "company_address"]) {
      expect(fields[key], key).toBeDefined();
      expect(fields[key]!.source).toBe("distilled");
      expect(fields[key]!.citations.length).toBeGreaterThan(0);
      for (const c of fields[key]!.citations) {
        expect(chunkIds.has(c.chunkId)).toBe(true);
        // Render-ready snapshot: label + type + locator + verbatim quote.
        expect(c.sourceLabel).toBe("site");
        expect(c.sourceType).toBe("TEXT");
        expect(c.locator).toBe("site");
        expect(c.quote).toContain("Acme Dental Growth");
      }
    }
    // …the hallucinated citation was filtered out of pricing's citations,
    // and the unknown key never persisted.
    expect(fields.pricing!.citations.map((c) => c.chunkId)).not.toContain(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(fields.not_a_registry_key).toBeUndefined();
    expect(row.rawSummary).toContain("distilled from evidence");
  });

  it("agent-layer distill + gap checker: workspace-covered fields never re-asked; the rest gap", async () => {
    const agentRow = await distill(deps(), {
      workspaceId: wsA,
      agentId,
      goal: "book_appointments",
    });
    expect(agentRow.goal).toBe("book_appointments");

    const wsRow = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.businessContext.findFirstOrThrow({ where: { workspaceId: wsA, agentId: null } }),
    );
    const report = checkGaps({
      goal: "book_appointments",
      workspaceFields: parseFields(wsRow.fields),
      agentFields: parseFields(agentRow.fields),
    });
    const by = Object.fromEntries(report.gaps.map((g) => [g.key, g]));
    // Covered by the workspace docs → "✓ Found in your docs", never re-asked.
    expect(by.offer!.status).toBe("covered");
    expect(by.company_address!.status).toBe("covered");
    // Nothing in the evidence answers these → open gaps, launch gated.
    expect(by.icp!.status).toBe("open");
    expect(by.booking_link!.status).toBe("open");
    expect(report.launchReady).toBe(false);
  });

  it("typed answers persist across re-distill (DEC-024 'Type it')", async () => {
    const row = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.businessContext.findFirstOrThrow({ where: { workspaceId: wsA, agentId } }),
    );
    const typedFields = {
      ...parseFields(row.fields),
      icp: { value: "Dentists in Austin", citations: [], source: "typed" as const },
    };
    await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.businessContext.update({ where: { id: row.id }, data: { fields: typedFields } }),
    );

    const after = await distill(deps(), { workspaceId: wsA, agentId, goal: "book_appointments" });
    const fields = parseFields(after.fields);
    expect(fields.icp).toEqual({ value: "Dentists in Austin", citations: [], source: "typed" });
  });

  it("re-distill updates after adding a source (original P1.3 acceptance)", async () => {
    const before = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.businessContext.findFirstOrThrow({ where: { workspaceId: wsA, agentId: null } }),
    );
    const src = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.create({
        data: {
          workspaceId: wsA,
          kind: "TEXT",
          label: "new-doc",
          meta: {
            text: "New pricing audit tier: 149 dollars per appointment for premium clinics.",
          },
        },
      }),
    );
    await ingestSource(
      { prisma: app, gateway, store: new MemoryUploadStore() },
      { sourceId: src.id, workspaceId: wsA },
    );
    const row = await distill(deps(), { workspaceId: wsA });
    expect(row.distilledAt!.getTime()).toBeGreaterThanOrEqual(before.distilledAt!.getTime());
    expect(Object.keys(parseFields(row.fields)).length).toBeGreaterThan(0);
  });

  it("RLS: a workspace with no sources distills to no fields (and cannot see A's chunks)", async () => {
    const row = await distill(deps(), { workspaceId: wsB });
    expect(parseFields(row.fields)).toEqual({});
    expect(row.rawSummary).toBe("");
  });

  // ── L1 (DEC-072): evidence-pack language detection ─────────────────────────

  const GERMAN_SITE =
    "Wir helfen Zahnarztpraxen dabei, mehr Termine zu buchen und weniger Ausfälle zu haben. " +
    "Unsere Software erinnert Ihre Patienten automatisch und füllt freie Termine innerhalb weniger Stunden. " +
    "Über zweihundert Praxen in Deutschland vertrauen bereits auf unsere Lösung. " +
    "Die Einrichtung dauert nur einen Tag, und Ihr Team braucht keine Schulung. " +
    "Vereinbaren Sie noch heute ein kostenloses Beratungsgespräch mit unseren Experten.";
  const ENGLISH_DOC =
    "We help dental practices book more appointments and cut no-shows. " +
    "Our software reminds your patients automatically and fills open slots within hours. " +
    "More than two hundred practices already trust our solution across the country. " +
    "Setup takes a single day and your team needs no training at all. " +
    "Book a free consultation with our experts today and see the revenue you are missing.";

  const guardrailsOf = async (id: string) =>
    (await owner.agent.findUniqueOrThrow({ where: { id }, select: { guardrails: true } }))
      .guardrails as Record<string, unknown>;

  const mkAgent = (workspaceId: string, name: string, guardrails: object = {}) =>
    owner.agent.create({
      data: { workspaceId, name, goal: "book_appointments", guardrails },
    });

  const mkAgentText = async (workspaceId: string, agent: string, label: string, text: string) => {
    const src = await withTenant(app, { workspaceId }, (tx) =>
      tx.knowledgeSource.create({
        data: { workspaceId, agentId: agent, kind: "TEXT", label, meta: { text } },
      }),
    );
    await ingestSource(
      { prisma: app, gateway, store: new MemoryUploadStore() },
      { sourceId: src.id, workspaceId },
    );
    return src;
  };

  it("GERMAN-site agent: distill detects de, writes the detected default, and briefs in German", async () => {
    const agent = await mkAgent(wsA, "DE-Site");
    await mkAgentText(wsA, agent.id, "german-site", GERMAN_SITE);

    const row = await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });

    const g = await guardrailsOf(agent.id);
    expect(g.language).toBe("de");
    expect(g.languageSource).toBe("detected");
    // The v2 prompt carried the language rule; the brief came back German.
    expect(lastPrompt).toContain("written in German (Deutsch)");
    expect(row.rawSummary).toContain("Zahnarzt");
  });

  it("DOC-ONLY agent (German document, no website): detection is source-agnostic → de", async () => {
    const agent = await mkAgent(wsA, "DE-DocOnly");
    const store = new MemoryUploadStore();
    const src = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.create({
        data: { workspaceId: wsA, agentId: agent.id, kind: "DOCUMENT", label: "unterlagen.txt", meta: {} },
      }),
    );
    const path = uploadPathFor(wsA, src.id, "unterlagen.txt");
    await store.put(path, Buffer.from(GERMAN_SITE, "utf8"), "text/plain");
    await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.knowledgeSource.update({ where: { id: src.id }, data: { uri: path } }),
    );
    await ingestSource({ prisma: app, gateway, store }, { sourceId: src.id, workspaceId: wsA });

    await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });

    const g = await guardrailsOf(agent.id);
    expect(g.language).toBe("de");
    expect(g.languageSource).toBe("detected");
  });

  it("MIXED evidence (German site + English doc) → English default; a prior detector write is CLEARED", async () => {
    const agent = await mkAgent(wsA, "Mixed");
    await mkAgentText(wsA, agent.id, "german-first", GERMAN_SITE);
    await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });
    expect((await guardrailsOf(agent.id)).language).toBe("de"); // sequential wizard reality

    await mkAgentText(wsA, agent.id, "english-later", ENGLISH_DOC);
    await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });

    const g = await guardrailsOf(agent.id);
    expect(g.language).toBeUndefined(); // mixed pack → not confident → absent = English
    expect(g.languageSource).toBeUndefined();
    expect(lastPrompt).not.toContain("written in"); // v1 prompt again — English brief
  });

  it("AMBIGUOUS/thin evidence → English default (nothing written)", async () => {
    const agent = await mkAgent(wsA, "Thin");
    await mkAgentText(wsA, agent.id, "thin", "Beste Zahnarztpraxis Berlin best dental care.");
    await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });

    const g = await guardrailsOf(agent.id);
    expect(g.language).toBeUndefined();
    expect(g.languageSource).toBeUndefined();
  });

  it("owner-set language is STICKY: detection never touches it and the brief follows the owner", async () => {
    const agent = await mkAgent(wsA, "OwnerFr", {
      sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
      dailyCap: { email: 200 },
      consent: null,
      language: "fr",
      languageSource: "owner",
      unsubscribeFooter: true,
      suppressionCheck: true,
    });
    await mkAgentText(wsA, agent.id, "german-site-owner-fr", GERMAN_SITE);

    const row = await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });

    const g = await guardrailsOf(agent.id);
    expect(g.language).toBe("fr");
    expect(g.languageSource).toBe("owner");
    expect(lastPrompt).toContain("written in French (Français)");
    expect(row.rawSummary).toContain("dentaire");
  });

  it("ENGLISH agent regression: v1 prompt byte-shape (no language rule), confident en recorded as detected", async () => {
    const agent = await mkAgent(wsA, "EnDetected");
    await mkAgentText(wsA, agent.id, "english-site", ENGLISH_DOC);
    await distill(deps(), { workspaceId: wsA, agentId: agent.id, goal: "book_appointments" });

    expect(lastPrompt).not.toContain("written in"); // the v1 literal — no language rule line
    const g = await guardrailsOf(agent.id);
    expect(g.language).toBe("en");
    expect(g.languageSource).toBe("detected");
    // Behavior identical to absent (= English) — the parse proves it.
    expect((g as { unsubscribeFooter?: boolean }).unsubscribeFooter).toBe(true);
  });

  it("the WORKSPACE layer never detects (no agent to write to)", async () => {
    await distill(deps(), { workspaceId: wsA });
    expect(lastPrompt).not.toContain("written in");
  });
});
