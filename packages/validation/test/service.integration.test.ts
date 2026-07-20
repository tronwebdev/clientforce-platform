/**
 * LH1 (DEC-087): the validation service vs REAL Postgres + RLS — the pinned
 * free-filter order (a suppressed/cached/dup row provably never bills), the
 * spend rails' honest holds, the provider-down typed refusal (zero silent
 * verdicts), cache TTL, exactly-once completion, and turn-granular fairness.
 * Provider mocked (CI rule); skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  type PrismaClient,
} from "@clientforce/db";
import { validateEvent } from "@clientforce/events";
import {
  ValidationProviderError,
  processValidationBatchChunk,
  runValidationBatchToSettled,
  upsertValidationBatch,
  type EmailValidationProvider,
  type ProviderResult,
  type ValidationDeps,
  type ValidationEventInput,
} from "../src";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `lh1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const DAY = 86_400_000;

/** Records every address it is asked to verify — the never-bills invariant. */
class RecordingProvider implements EmailValidationProvider {
  readonly name = "zerobounce";
  calls: string[][] = [];
  verdictFor: (address: string) => ProviderResult = (address) => ({ address, verdict: "valid" });
  fail: ValidationProviderError | null = null;
  async validateBatch(addresses: string[]): Promise<ProviderResult[]> {
    if (this.fail) throw this.fail;
    this.calls.push([...addresses]);
    return addresses.map((a) => this.verdictFor(a));
  }
  async preflight() {
    return { ok: true, detail: "mock" };
  }
  get seen(): string[] {
    return this.calls.flat();
  }
}

describe.skipIf(!hasInfra)("validation service (LH1 W1)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;

  const newWorkspace = async (tag: string): Promise<string> => {
    const ws = await owner.workspace.create({
      data: { agencyId, name: tag, slug: `${suffix}-${tag}`, settings: {} },
    });
    return ws.id;
  };

  const newContact = async (ws: string, email: string) =>
    owner.contact.create({ data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email } });

  const makeDeps = (
    provider: RecordingProvider,
    events: ValidationEventInput[],
    overrides: Partial<ValidationDeps> = {},
  ): ValidationDeps => ({
    prisma: app,
    ownerPrisma: owner,
    provider,
    publish: async (e) => {
      validateEvent(e); // every emission stays catalog-valid
      events.push(e);
    },
    resolveMx: async (domain) => {
      if (domain === "no-mx-domain.test") {
        const err = new Error("no data") as NodeJS.ErrnoException;
        err.code = "ENODATA";
        throw err;
      }
      if (domain === "flaky-domain.test") {
        const err = new Error("timeout") as NodeJS.ErrnoException;
        err.code = "ETIMEOUT";
        throw err;
      }
      return [{ exchange: `mx.${domain}`, priority: 10 }];
    },
    ...overrides,
  });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
  });
  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    // Workspace rows cascade; verdict/batch/hold rows are workspace-keyed but
    // FK-less — sweep them by the suffix-scoped workspace ids we created.
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("pinned free-filter order: dedupe → cache → suppressed → syntax → MX; only survivors bill", async () => {
    const ws = await newWorkspace("order");
    const now = new Date();

    const dup1 = await newContact(ws, `dup-${suffix}@t.test`);
    const dup2 = await newContact(ws, `DUP-${suffix}@T.TEST`); // same normalized address
    const cached = await newContact(ws, `cached-${suffix}@t.test`);
    const suppressed = await newContact(ws, `suppressed-${suffix}@t.test`);
    const badSyntax = await newContact(ws, "not-an-email");
    const noMx = await newContact(ws, `user-${suffix}@no-mx-domain.test`);
    const flakyMx = await newContact(ws, `user-${suffix}@flaky-domain.test`);
    const ok = await newContact(ws, `ok-${suffix}@t.test`);

    await owner.emailValidationVerdict.create({
      data: {
        workspaceId: ws,
        address: `cached-${suffix}@t.test`,
        verdict: "risky",
        subStatus: "catch_all",
        source: "zerobounce",
        checkedAt: new Date(now.getTime() - 10 * DAY),
        expiresAt: new Date(now.getTime() + 80 * DAY),
        billedAt: new Date(now.getTime() - 10 * DAY),
        costMicros: 8000,
      },
    });
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `suppressed-${suffix}@t.test`, reason: "BOUNCED" },
    });

    const contacts = [dup1, dup2, cached, suppressed, badSyntax, noMx, flakyMx, ok];
    const { batchId } = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "csv_import",
      clientKey: `order-${suffix}`,
      contacts: contacts.map((c) => ({ contactId: c.id, email: c.email! })),
    });

    const provider = new RecordingProvider();
    const events: ValidationEventInput[] = [];
    const result = await runValidationBatchToSettled(makeDeps(provider, events), ws, batchId);
    expect(result.status).toBe("completed");

    // The provider saw ONLY the survivors — deduped once, no cached, no
    // suppressed, no syntax-fail, no dead-MX row. Flaky MX fails OPEN.
    expect([...provider.seen].sort()).toEqual(
      [`dup-${suffix}@t.test`, `user-${suffix}@flaky-domain.test`, `ok-${suffix}@t.test`].sort(),
    );

    // Item outcomes, verdict-for-verdict.
    const items = await owner.validationBatchItem.findMany({ where: { batchId } });
    const byContact = new Map(items.map((i) => [i.contactId, i]));
    expect(byContact.get(dup1.id)).toMatchObject({ outcome: "valid", via: "zerobounce", billed: true });
    expect(byContact.get(dup2.id)).toMatchObject({ outcome: "valid", via: "zerobounce" });
    expect(byContact.get(cached.id)).toMatchObject({ outcome: "risky", via: "cache", billed: false });
    expect(byContact.get(suppressed.id)).toMatchObject({
      outcome: "skipped_suppressed",
      via: "suppression",
      billed: false,
    });
    expect(byContact.get(badSyntax.id)).toMatchObject({ outcome: "invalid", via: "syntax", billed: false });
    expect(byContact.get(noMx.id)).toMatchObject({ outcome: "invalid", via: "mx", billed: false });
    expect(byContact.get(flakyMx.id)).toMatchObject({ outcome: "valid", via: "zerobounce", billed: true });
    expect(byContact.get(ok.id)).toMatchObject({ outcome: "valid", via: "zerobounce", billed: true });

    // Contact verdict columns — the gate's read. Suppressed rows are SKIPPED,
    // never verdicted (the ledger stays authoritative; no spend, no claim).
    const fresh = await owner.contact.findMany({ where: { id: { in: contacts.map((c) => c.id) } } });
    const verdictOf = (id: string) => fresh.find((c) => c.id === id)?.emailVerdict;
    expect(verdictOf(dup1.id)).toBe("valid");
    expect(verdictOf(dup2.id)).toBe("valid");
    expect(verdictOf(cached.id)).toBe("risky");
    expect(verdictOf(suppressed.id)).toBe("unverified");
    expect(verdictOf(badSyntax.id)).toBe("invalid");
    expect(verdictOf(noMx.id)).toBe("invalid");
    expect(verdictOf(ok.id)).toBe("valid");

    // Exactly one paid verification per SURVIVING unique address; free
    // verdicts cache without billedAt (dup billed once — 3 paid total).
    const billedRows = await owner.emailValidationVerdict.findMany({
      where: { workspaceId: ws, billedAt: { gte: new Date(now.getTime() - 60_000) } },
    });
    expect(billedRows.map((r) => r.address).sort()).toEqual(
      [`dup-${suffix}@t.test`, `user-${suffix}@flaky-domain.test`, `ok-${suffix}@t.test`].sort(),
    );
    const freeRows = await owner.emailValidationVerdict.findMany({
      where: { workspaceId: ws, address: `user-${suffix}@no-mx-domain.test` },
    });
    expect(freeRows[0]).toMatchObject({ verdict: "invalid", source: "mx", billedAt: null });

    // The completion event: counts match the fixture verdict-for-verdict,
    // emitted exactly once (guarded transition).
    const completions = events.filter((e) => e.type === "validation.batch_completed.v1");
    expect(completions).toHaveLength(1);
    expect(completions[0]?.payload).toMatchObject({
      batchId,
      total: 8,
      valid: 4,
      risky: 1,
      invalid: 2,
      skippedSuppressed: 1,
      billed: 3,
      cacheHits: 1,
    });

    // Re-import of the same addresses: NOTHING re-bills (cache serves all
    // but the suppressed skip).
    const rerun = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "csv_import",
      clientKey: `order2-${suffix}`,
      contacts: contacts.map((c) => ({ contactId: c.id, email: c.email! })),
    });
    const provider2 = new RecordingProvider();
    const events2: ValidationEventInput[] = [];
    const rerunResult = await runValidationBatchToSettled(makeDeps(provider2, events2), ws, rerun.batchId);
    expect(rerunResult.status).toBe("completed");
    expect(provider2.seen).toEqual([]);
    const rerunCompletion = events2.find((e) => e.type === "validation.batch_completed.v1");
    // 7 rows served by cache (the dup address covers two rows); the
    // suppressed row skips. billed: 0 is the whole point — never re-bill.
    expect(rerunCompletion?.payload).toMatchObject({ billed: 0, cacheHits: 7, skippedSuppressed: 1 });
  });

  it("an EXPIRED cache row re-bills (TTL ~90d)", async () => {
    const ws = await newWorkspace("ttl");
    const now = new Date();
    const c = await newContact(ws, `stale-${suffix}@t.test`);
    await owner.emailValidationVerdict.create({
      data: {
        workspaceId: ws,
        address: `stale-${suffix}@t.test`,
        verdict: "valid",
        source: "zerobounce",
        checkedAt: new Date(now.getTime() - 100 * DAY),
        expiresAt: new Date(now.getTime() - 10 * DAY),
        billedAt: new Date(now.getTime() - 100 * DAY),
      },
    });
    const { batchId } = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "manual",
      contacts: [{ contactId: c.id, email: c.email! }],
    });
    const provider = new RecordingProvider();
    await runValidationBatchToSettled(makeDeps(provider, []), ws, batchId);
    expect(provider.seen).toEqual([`stale-${suffix}@t.test`]);
    const row = await owner.emailValidationVerdict.findUnique({
      where: { workspaceId_address: { workspaceId: ws, address: `stale-${suffix}@t.test` } },
    });
    expect(row?.billedAt && row.billedAt.getTime()).toBeGreaterThan(now.getTime() - 60_000);
  });

  it("provider outage = typed refusal: batch HELD, items pending, contacts unverified, paused event — zero invented verdicts", async () => {
    const ws = await newWorkspace("outage");
    const good = await newContact(ws, `up-${suffix}@t.test`);
    const bad = await newContact(ws, "still-not-an-email");
    const { batchId } = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "csv_import",
      clientKey: `outage-${suffix}`,
      contacts: [
        { contactId: good.id, email: good.email! },
        { contactId: bad.id, email: bad.email! },
      ],
    });

    const provider = new RecordingProvider();
    provider.fail = new ValidationProviderError("PROVIDER_UNAVAILABLE", "down for the test", true);
    const events: ValidationEventInput[] = [];
    const deps = makeDeps(provider, events);

    await expect(processValidationBatchChunk(deps, ws, batchId)).rejects.toBeInstanceOf(
      ValidationProviderError,
    );

    // Free-filter work persisted (syntax fail landed); the provider-bound
    // item stayed PENDING and its contact UNVERIFIED — held, never guessed.
    const batch = await owner.validationBatch.findUniqueOrThrow({ where: { id: batchId } });
    expect(batch).toMatchObject({ status: "held", heldReason: "provider_unavailable" });
    const items = await owner.validationBatchItem.findMany({ where: { batchId } });
    expect(items.find((i) => i.contactId === bad.id)?.outcome).toBe("invalid");
    expect(items.find((i) => i.contactId === good.id)?.outcome).toBe("pending");
    expect((await owner.contact.findUniqueOrThrow({ where: { id: good.id } })).emailVerdict).toBe("unverified");
    const paused = events.filter((e) => e.type === "validation.paused.v1");
    expect(paused).toHaveLength(1);
    expect(paused[0]?.payload).toMatchObject({ reason: "provider_unavailable", pendingCount: 1 });

    // A second failing turn is quiet (rising edge — no event spam)…
    await expect(processValidationBatchChunk(deps, ws, batchId)).rejects.toBeInstanceOf(
      ValidationProviderError,
    );
    expect(events.filter((e) => e.type === "validation.paused.v1")).toHaveLength(1);

    // …and the retry after recovery completes the batch exactly once.
    provider.fail = null;
    const settled = await runValidationBatchToSettled(deps, ws, batchId);
    expect(settled.status).toBe("completed");
    expect((await owner.contact.findUniqueOrThrow({ where: { id: good.id } })).emailVerdict).toBe("valid");
    expect(events.filter((e) => e.type === "validation.batch_completed.v1")).toHaveLength(1);
  });

  it("workspace allowance holds honestly and drains the NEXT UTC day", async () => {
    const ws = await newWorkspace("allowance");
    const contacts = await Promise.all(
      Array.from({ length: 4 }, (_, i) => newContact(ws, `quota-${i}-${suffix}@t.test`)),
    );
    const { batchId } = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "csv_import",
      clientKey: `quota-${suffix}`,
      contacts: contacts.map((c) => ({ contactId: c.id, email: c.email! })),
    });

    const provider = new RecordingProvider();
    const events: ValidationEventInput[] = [];
    let clock = new Date();
    const deps = makeDeps(provider, events, {
      now: () => clock,
      config: { dailyAllowance: 2, chunkSize: 10 },
    });

    const turn1 = await processValidationBatchChunk(deps, ws, batchId);
    expect(turn1).toMatchObject({ status: "held", heldReason: "workspace_allowance", requeue: true });
    expect(turn1.requeueDelayMs).toBeGreaterThan(0);
    expect(provider.seen).toHaveLength(2); // exactly the headroom, deterministic
    const paused = events.filter((e) => e.type === "validation.paused.v1");
    expect(paused).toHaveLength(1);
    expect(paused[0]?.payload).toMatchObject({ reason: "workspace_allowance", pendingCount: 2 });

    // Next UTC day: the held remainder drains to completion.
    clock = new Date(clock.getTime() + DAY);
    const settled = await runValidationBatchToSettled(deps, ws, batchId);
    expect(settled.status).toBe("completed");
    expect(provider.seen).toHaveLength(4);
    expect(events.filter((e) => e.type === "validation.batch_completed.v1")).toHaveLength(1);
  });

  it("platform spend ceiling: new validation pauses, cost alert fires, valid contacts stay valid", async () => {
    const ws = await newWorkspace("ceiling");
    const c = await newContact(ws, `ceil-${suffix}@t.test`);
    const { batchId } = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "manual",
      contacts: [{ contactId: c.id, email: c.email! }],
    });
    const provider = new RecordingProvider();
    const events: ValidationEventInput[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const deps = makeDeps(provider, events, { config: { ceilingChecks: 0, chunkSize: 10 } });
      const turn = await processValidationBatchChunk(deps, ws, batchId);
      expect(turn).toMatchObject({ status: "held", heldReason: "platform_spend_ceiling" });
      expect(provider.seen).toEqual([]); // nothing billed past the ceiling
      expect(events.filter((e) => e.type === "validation.paused.v1")[0]?.payload).toMatchObject({
        reason: "platform_spend_ceiling",
      });
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("COST ALERT"));
    } finally {
      errSpy.mockRestore();
    }
  });

  it("claim lease: a concurrent turn on the same batch skips instead of double-billing", async () => {
    const ws = await newWorkspace("claim");
    const c = await newContact(ws, `claimed-${suffix}@t.test`);
    const { batchId } = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "manual",
      contacts: [{ contactId: c.id, email: c.email! }],
    });
    await owner.validationBatch.update({
      where: { id: batchId },
      data: { claimedUntil: new Date(Date.now() + 60_000) },
    });
    const provider = new RecordingProvider();
    const turn = await processValidationBatchChunk(makeDeps(provider, []), ws, batchId);
    expect(turn.status).toBe("skipped");
    expect(turn.requeue).toBe(true);
    expect(provider.seen).toEqual([]);
  });

  it("workspace concurrency slice: a third simultaneous batch stays queued", async () => {
    const ws = await newWorkspace("slice");
    const mk = async (tag: string) => {
      const c = await newContact(ws, `${tag}-${suffix}@t.test`);
      return upsertValidationBatch(app, {
        workspaceId: ws,
        source: "csv_import",
        clientKey: `${tag}-${suffix}`,
        contacts: [{ contactId: c.id, email: c.email! }],
      });
    };
    const b1 = await mk("slice1");
    const b2 = await mk("slice2");
    const b3 = await mk("slice3");
    await owner.validationBatch.updateMany({
      where: { id: { in: [b1.batchId, b2.batchId] } },
      data: { status: "running" },
    });
    const provider = new RecordingProvider();
    const turn = await processValidationBatchChunk(
      makeDeps(provider, [], { config: { workspaceConcurrency: 2 } }),
      ws,
      b3.batchId,
    );
    expect(turn.status).toBe("skipped");
    expect(turn.requeue).toBe(true);
    expect((await owner.validationBatch.findUniqueOrThrow({ where: { id: b3.batchId } })).status).toBe(
      "queued",
    );
  });

  it("fairness is turn-granular: two workspaces' imports interleave chunk-by-chunk", async () => {
    const wsA = await newWorkspace("fairA");
    const wsB = await newWorkspace("fairB");
    const mkBatch = async (ws: string, tag: string, n: number) => {
      const contacts = await Promise.all(
        Array.from({ length: n }, (_, i) => newContact(ws, `${tag}-${i}-${suffix}@t.test`)),
      );
      return upsertValidationBatch(app, {
        workspaceId: ws,
        source: "csv_import",
        clientKey: `${tag}-${suffix}`,
        contacts: contacts.map((c) => ({ contactId: c.id, email: c.email! })),
      });
    };
    const a = await mkBatch(wsA, "faira", 2);
    const b = await mkBatch(wsB, "fairb", 2);
    const provider = new RecordingProvider();
    const deps = makeDeps(provider, [], { config: { chunkSize: 1 } });

    // Simulate the queue's round-robin: each turn resolves at most one item
    // and reports requeue — the huge upload can never hold the worker.
    const turns = [
      await processValidationBatchChunk(deps, wsA, a.batchId),
      await processValidationBatchChunk(deps, wsB, b.batchId),
      await processValidationBatchChunk(deps, wsA, a.batchId),
      await processValidationBatchChunk(deps, wsB, b.batchId),
    ];
    expect(turns.every((t) => t.resolved <= 1)).toBe(true);
    expect(turns[0]?.requeue).toBe(true);
    expect(turns[1]?.requeue).toBe(true);
    const aDone = await runValidationBatchToSettled(deps, wsA, a.batchId);
    const bDone = await runValidationBatchToSettled(deps, wsB, b.batchId);
    expect(aDone.status).toBe("completed");
    expect(bDone.status).toBe("completed");
  });

  it("upsertValidationBatch is idempotent on the client key (chunked imports land on ONE batch)", async () => {
    const ws = await newWorkspace("idem");
    const c1 = await newContact(ws, `idem1-${suffix}@t.test`);
    const c2 = await newContact(ws, `idem2-${suffix}@t.test`);
    const first = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "csv_import",
      clientKey: `idem-${suffix}`,
      contacts: [{ contactId: c1.id, email: c1.email! }],
    });
    const second = await upsertValidationBatch(app, {
      workspaceId: ws,
      source: "csv_import",
      clientKey: `idem-${suffix}`,
      contacts: [
        { contactId: c1.id, email: c1.email! }, // duplicate — must not double
        { contactId: c2.id, email: c2.email! },
      ],
    });
    expect(second.batchId).toBe(first.batchId);
    expect(second.added).toBe(1);
    expect(await owner.validationBatchItem.count({ where: { batchId: first.batchId } })).toBe(2);
  });
});
