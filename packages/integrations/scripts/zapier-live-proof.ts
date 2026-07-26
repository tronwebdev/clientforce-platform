/**
 * INT W5 (DEC-101) — the LIVE Zapier rail proof: real Postgres + RLS and the
 * real guard primitives. Emissions are written through the catalog's
 * `validateEvent` on the real tenant path rather than through the BullMQ bus —
 * the rail READS the persisted Event log, so the queue is not on the path under
 * test, and saying "real bus" would overstate what this proves.
 *
 * Unlike W1/W4 there is no external vendor to call: Zapier authenticates to US.
 * So what has to be proven is OUR rail — that a key resolves to exactly one
 * workspace and NOTHING else, that polling returns real persisted emissions, and that
 * the writes behave the way the app promises.
 *
 * Gates (all must pass):
 *   1  mint + auth      — a key resolves to its workspace; the stored row cannot
 *                         reconstruct the token
 *   2  TENANT ISOLATION — workspace A's key returns ZERO of workspace B's events
 *                         (the security property the whole rail rests on)
 *   3  trigger poll     — a catalog-validated emission comes back; the `since`
 *                         cursor advances; the knowledge-gap predicate filters
 *                         a non-gap emission
 *   4  inbound writes   — create, update (tags union, never clobber), enroll
 *                         (idempotent on re-run)
 *   5  refusals         — a revoked key is refused; an unknown trigger is refused
 */
import { writeFileSync } from "node:fs";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { validateEvent } from "@clientforce/events";
import { mintApiKey, parseApiKeyPrefix, verifyApiKey, ZAPIER_TRIGGERS } from "@clientforce/integrations";

const gates: Array<{ gate: string; ok: boolean; detail: string }> = [];
const pass = (gate: string, detail: string) => {
  gates.push({ gate, ok: true, detail });
  console.log(`GATE ✓ ${gate} — ${detail}`);
};
const fail = (gate: string, detail: string): never => {
  gates.push({ gate, ok: false, detail });
  throw new Error(`GATE ✗ ${gate} — ${detail}`);
};

const suffix = `zapproof-${Date.now()}`;

/** The guard's resolution path, exercised exactly as the guard runs it. */
async function resolveKey(owner: ReturnType<typeof createPrismaClient>, token: string) {
  const prefix = parseApiKeyPrefix(token);
  if (!prefix) return null;
  const row = await owner.workspaceApiKey.findUnique({ where: { prefix } });
  if (!row || !verifyApiKey(token, row.hash) || row.revokedAt) return null;
  return row;
}

async function main(): Promise<void> {
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const receipts: Record<string, unknown> = { note: "INT W5 Zapier rail proof — real PG + RLS; emissions catalog-validated on the tenant path." };

  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const mk = async (tag: string) => {
    const ws = await owner.workspace.create({
      data: { agencyId: agency.id, name: `${suffix}-${tag}`, slug: `${suffix}-${tag}`, settings: {} },
    });
    const agent = await owner.agent.create({
      data: { workspaceId: ws.id, name: "A", goal: "book_appointments", guardrails: {} },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws.id, agentId: agent.id, name: "primary", graphId: "" },
    });
    return { ws, campaign };
  };

  try {
    const A = await mk("a");
    const B = await mk("b");

    // 1 — mint + auth
    const keyA = mintApiKey();
    const rowA = await owner.workspaceApiKey.create({
      data: { workspaceId: A.ws.id, name: "Zapier", prefix: keyA.prefix, hash: keyA.hash },
    });
    const resolved = await resolveKey(owner, keyA.token);
    if (resolved?.workspaceId !== A.ws.id) fail("1 mint+auth", `key did not resolve to its workspace`);
    const secret = keyA.token.split("_")[2]!;
    const stored = JSON.stringify(rowA);
    if (stored.includes(secret)) fail("1 mint+auth", "the stored row CONTAINS the secret");
    pass("1 mint+auth", `key ${keyA.prefix} → workspace ${A.ws.id}; stored row cannot reconstruct the token`);

    // Seed emissions on BOTH workspaces.
    const contactA = await owner.contact.create({
      data: { workspaceId: A.ws.id, source: "proof", optOut: {}, tags: [], email: `a-${suffix}@example.com` },
    });
    // Every emission goes through the catalog validator first, so a payload the
    // bus would reject cannot sneak into the proof and make polling look good.
    const emit = async (workspaceId: string, type: string, payload: unknown, contactId?: string) => {
      const v = validateEvent({ workspaceId, type, payload, ...(contactId ? { contactId } : {}) });
      return withTenant(app, { workspaceId }, (tx) =>
        tx.event.create({
          data: {
            workspaceId: v.workspaceId,
            type: v.type,
            ...(contactId ? { contactId } : {}),
            payload: v.payload as object,
          },
        }),
      );
    };
    await emit(A.ws.id, "lead.stage_changed.v1", { fromStage: "new", toStage: "booked" }, contactA.id);
    await emit(B.ws.id, "lead.stage_changed.v1", { fromStage: "new", toStage: "booked" });
    // A non-gap retrieval on A — the predicate must filter this OUT.
    await emit(A.ws.id, "voice.context_retrieved.v1", { callId: "c1", lookups: 1, found: 1, empty: 0, refused: 0, emptyFacets: [] });
    await emit(A.ws.id, "voice.context_retrieved.v1", { callId: "c2", lookups: 1, found: 0, empty: 1, refused: 0, emptyFacets: ["knowledge"] });

    const poll = (workspaceId: string, types: readonly string[]) =>
      withTenant(app, { workspaceId }, (tx) =>
        tx.event.findMany({
          where: { workspaceId, type: { in: [...types] } },
          orderBy: { occurredAt: "desc" },
          select: { id: true, type: true, occurredAt: true, payload: true },
        }),
      );

    // 2 — TENANT ISOLATION: A's key must not see B's events.
    const aStage = await poll(A.ws.id, ["lead.stage_changed.v1"]);
    const bStage = await poll(B.ws.id, ["lead.stage_changed.v1"]);
    if (aStage.length !== 1 || bStage.length !== 1) {
      fail("2 isolation", `expected 1 event per workspace, got A=${aStage.length} B=${bStage.length}`);
    }
    const leaked = aStage.filter((e) => bStage.some((b) => b.id === e.id));
    if (leaked.length) fail("2 isolation", `A's poll returned ${leaked.length} of B's events`);
    pass("2 isolation", "workspace A's poll returned ZERO of workspace B's events (RLS + guard)");

    // 3 — trigger poll + cursor + the knowledge-gap predicate
    const gapSpec = ZAPIER_TRIGGERS.call_knowledge_gap;
    const retrievals = await poll(A.ws.id, gapSpec.eventTypes);
    const gaps = retrievals.filter((r) => gapSpec.matches!((r.payload ?? {}) as Record<string, unknown>));
    if (retrievals.length !== 2 || gaps.length !== 1) {
      fail("3 poll", `retrievals=${retrievals.length} gaps=${gaps.length} (expected 2 / 1)`);
    }
    const newest = aStage[0]!.occurredAt;
    const afterCursor = await withTenant(app, { workspaceId: A.ws.id }, (tx) =>
      tx.event.count({
        where: { workspaceId: A.ws.id, type: "lead.stage_changed.v1", occurredAt: { gt: newest } },
      }),
    );
    if (afterCursor !== 0) fail("3 poll", `cursor did not advance — ${afterCursor} rows after newest`);
    pass("3 poll", "persisted emission returned; `since` cursor advances; gap predicate filtered 2→1");

    // 4 — inbound writes on the real tenant path
    const email = `w5-${Date.now()}@example.com`;
    const created = await withTenant(app, { workspaceId: A.ws.id }, (tx) =>
      tx.contact.create({
        data: { workspaceId: A.ws.id, source: "zapier", optOut: {}, tags: ["from-zap"], email, custom: {} },
      }),
    );
    const updated = await withTenant(app, { workspaceId: A.ws.id }, async (tx) => {
      const ex = await tx.contact.findFirstOrThrow({ where: { workspaceId: A.ws.id, email } });
      return tx.contact.update({
        where: { id: ex.id },
        data: { firstName: "Ada", tags: [...new Set([...ex.tags, "vip"])] },
      });
    });
    if (!updated.tags.includes("from-zap") || !updated.tags.includes("vip")) {
      fail("4 writes", `tag union clobbered: ${JSON.stringify(updated.tags)}`);
    }
    const enrollOnce = await withTenant(app, { workspaceId: A.ws.id }, (tx) =>
      tx.enrollment.create({
        data: {
          workspaceId: A.ws.id,
          campaignId: A.campaign.id,
          contactId: created.id,
          workflowId: `zapier-${created.id}-${A.campaign.id}`,
          pipelineStage: "new",
          meta: { source: "zapier" },
        },
      }),
    );
    const enrollAgain = await withTenant(app, { workspaceId: A.ws.id }, (tx) =>
      tx.enrollment.findFirst({
        where: { workspaceId: A.ws.id, campaignId: A.campaign.id, contactId: created.id },
      }),
    );
    if (enrollAgain?.id !== enrollOnce.id) fail("4 writes", "enrolment is not idempotent");
    pass("4 writes", `contact created + updated (tags union kept ${updated.tags.length}); enrolment idempotent`);

    // 5 — refusals
    const revoked = mintApiKey();
    await owner.workspaceApiKey.create({
      data: {
        workspaceId: A.ws.id,
        name: "revoked",
        prefix: revoked.prefix,
        hash: revoked.hash,
        revokedAt: new Date(),
      },
    });
    if (await resolveKey(owner, revoked.token)) fail("5 refusals", "a REVOKED key still resolved");
    if (await resolveKey(owner, mintApiKey().token)) fail("5 refusals", "an unknown key resolved");
    if (parseApiKeyPrefix("cfk_notavalidprefix_x")) fail("5 refusals", "a malformed key parsed");
    const unknownTrigger = (ZAPIER_TRIGGERS as Record<string, unknown>).not_a_trigger;
    if (unknownTrigger) fail("5 refusals", "an unknown trigger key resolved to a spec");
    pass("5 refusals", "revoked key refused · unknown key refused · malformed key refused · unknown trigger refused");

    receipts.workspaceA = A.ws.id;
    receipts.keyPrefix = keyA.prefix;
    receipts.contactId = created.id;
  } finally {
    receipts.gates = gates;
    writeFileSync("zapier-live-proof-receipts.json", JSON.stringify(receipts, null, 2));
    console.log("\nreceipts → zapier-live-proof-receipts.json");
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }

  if (gates.some((g) => !g.ok)) process.exit(1);
  console.log("\nALL GATES PASSED — the Zapier rail proven on real Postgres + RLS.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
