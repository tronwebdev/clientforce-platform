/**
 * B9.5 (DEC-157) — the one charge path, against a real database.
 *
 * This is a money unit, so the tests are the acceptance criteria rather than a
 * sample of them. Each `it` names the SURFACE_SPEC_METERING §7 criterion it
 * discharges. The crux is §7.2: because we charge AFTER the thing happened,
 * the produced row's id is the natural key, and a replayed webhook or a
 * retried worker must leave exactly one row.
 *
 * These drive `charge()` directly rather than through an HTTP surface. That is
 * deliberate: the criteria are about the ledger, and a test that could only
 * reach the ledger through the reveal would leave every future caller
 * unproven. The reveal's own end-to-end charge is asserted separately, in
 * leads.e2e.spec.ts.
 *
 * Skips without Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  charge,
  createPrismaClient,
  priceFor,
  refundCharge,
  refundReason,
  type PrismaClient,
} from "@clientforce/db";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const ACTION = "email_send";

describe.skipIf(!hasDb)("B9.5 metering — the one charge path", () => {
  let db: PrismaClient;
  let agencyId: string;

  /** A workspace with a known balance and no ledger history. */
  const freshWorkspace = async (creditBalance: number): Promise<string> => {
    const w = await db.workspace.create({
      data: {
        agencyId,
        name: `mtr-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
        slug: `mtr-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
        branding: {},
        settings: {},
        creditBalance,
      },
    });
    return w.id;
  };

  const ledgerFor = (workspaceId: string) =>
    db.creditLedger.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  const balanceOf = async (workspaceId: string) =>
    (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { creditBalance: true } }))
      .creditBalance;

  beforeAll(async () => {
    db = createPrismaClient();
    const agency = await db.agency.create({
      data: { name: `mtr-${suffix}`, slug: `mtr-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    // CI never seeds, so the price this suite resolves is its own. Platform
    // default (agencyId null), which is also what production ships.
    await db.creditPrice.create({ data: { agencyId: null, action: ACTION, credits: 3 } });
  });

  afterAll(async () => {
    await db.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await db.creditPrice.deleteMany({ where: { action: ACTION, agencyId: null } }).catch(() => {});
    await db.$disconnect();
  });

  /* §7.2 — the crux. */
  it("charges once for a produced row, however many times the charge is replayed", async () => {
    const w = await freshWorkspace(100);
    const sourceId = `msg-${suffix}-replay`;
    const first = await charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId });
    expect(first).toMatchObject({ outcome: "charged", charged: 3 });

    // A replayed webhook and a retried worker, twice over.
    const second = await charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId });
    const third = await charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId });
    expect(second.outcome).toBe("already_charged");
    expect(third.outcome).toBe("already_charged");

    const rows = await ledgerFor(w);
    expect(rows, "a replay wrote a second ledger row").toHaveLength(1);
    expect(await balanceOf(w)).toBe(97);
    // An already-charged result reports the balance as it STANDS, not as this
    // attempt would have left it.
    expect(second.balanceAfter).toBe(97);
  });

  it("charges concurrent attempts on the same source exactly once", async () => {
    const w = await freshWorkspace(100);
    const sourceId = `msg-${suffix}-race`;
    // The index, not the read, is what makes this safe: five attempts race the
    // same key and ON CONFLICT DO NOTHING settles it.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId }),
      ),
    );
    expect(results.filter((r) => r.outcome === "charged")).toHaveLength(1);
    expect(await ledgerFor(w)).toHaveLength(1);
  });

  it("keeps separate sources, actions and workspaces separately chargeable", async () => {
    const w = await freshWorkspace(100);
    await charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId: `a-${suffix}` });
    await charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId: `b-${suffix}` });
    // Same id, different KIND of row — a call and a message are not the same
    // thing and must not collide.
    await charge(db, { workspaceId: w, action: ACTION, sourceType: "call", sourceId: `a-${suffix}` });
    expect(await ledgerFor(w)).toHaveLength(3);
  });

  /* §7.9 — zero-price actions write nothing. */
  it("writes no row for a zero-priced action, and none for an unpriced one", async () => {
    const w = await freshWorkspace(100);
    await db.creditPrice.create({ data: { agencyId: null, action: `free-${suffix}`, credits: 0 } });
    const free = await charge(db, {
      workspaceId: w,
      action: `free-${suffix}`,
      sourceType: "message",
      sourceId: `f-${suffix}`,
    });
    expect(free).toMatchObject({ outcome: "free", charged: 0 });

    // No CreditPrice row at all is a different statement from "free", and it
    // must not be answered by inventing a price — the deleted `?? 1`.
    const unpriced = await charge(db, {
      workspaceId: w,
      action: `noprice-${suffix}`,
      sourceType: "message",
      sourceId: `u-${suffix}`,
    });
    expect(unpriced).toMatchObject({ outcome: "unpriced", charged: 0 });

    expect(await ledgerFor(w), "a free or unpriced action wrote a ledger row").toHaveLength(0);
    expect(await balanceOf(w)).toBe(100);
  });

  /* §7.10 — price from resolveCreditPrice at charge time; an override changes it. */
  it("charges the agency override, not the platform default", async () => {
    const w = await freshWorkspace(100);
    await db.creditPrice.create({ data: { agencyId, action: ACTION, credits: 7 } });
    const r = await charge(db, {
      workspaceId: w,
      action: ACTION,
      sourceType: "message",
      sourceId: `ovr-${suffix}`,
    });
    expect(r).toMatchObject({ outcome: "charged", charged: 7 });
    expect(await balanceOf(w)).toBe(93);
    await db.creditPrice.deleteMany({ where: { agencyId, action: ACTION } });
  });

  it("multiplies by quantity and records the arithmetic", async () => {
    const w = await freshWorkspace(100);
    const r = await charge(db, {
      workspaceId: w,
      action: ACTION,
      quantity: 4,
      sourceType: "message",
      sourceId: `qty-${suffix}`,
      metadata: { providerMessageId: "pm_1" },
    });
    expect(r).toMatchObject({ outcome: "charged", charged: 12 });
    const [row] = await ledgerFor(w);
    // A bill has to be explainable later without the logs.
    expect(row!.meta).toMatchObject({ quantity: 4, unitPrice: 3, providerMessageId: "pm_1" });
    expect(row!.sourceType).toBe("message");
    expect(row!.balanceAfter).toBe(88);
  });

  /* §7.11 — the balance never goes negative outside a backoffice adjustment. */
  it("refuses typed with the shortfall rather than going negative", async () => {
    const w = await freshWorkspace(2);
    const r = await charge(db, {
      workspaceId: w,
      action: ACTION,
      sourceType: "message",
      sourceId: `poor-${suffix}`,
    });
    expect(r).toMatchObject({ outcome: "refused", reason: "INSUFFICIENT_CREDITS", price: 3, short: 1 });
    expect(await ledgerFor(w), "a refused charge wrote a row").toHaveLength(0);
    expect(await balanceOf(w)).toBe(2);
  });

  /* §7.3 — nothing charges on failure: a boundary that never calls charge()
   * leaves nothing behind. Asserted as the pre-check contract, since that is
   * what a boundary uses to decide. */
  it("lets a boundary pre-check with the same question the charge will ask", async () => {
    const w = await freshWorkspace(2);
    const { price, balance } = await priceFor(db, w, ACTION);
    expect(price).toBe(3);
    expect(balance).toBe(2);
    expect(balance < price!).toBe(true);
    expect(await ledgerFor(w), "a pre-check charged something").toHaveLength(0);
  });

  /* §7.4 — a hard bounce after acceptance nets to zero, append-only. */
  it("refunds a charge with a compensating row, leaving both linked and netting zero", async () => {
    const w = await freshWorkspace(100);
    const sourceId = `bounce-${suffix}`;
    await charge(db, { workspaceId: w, action: ACTION, sourceType: "message", sourceId });
    expect(await balanceOf(w)).toBe(97);

    const refund = await refundCharge(db, {
      workspaceId: w,
      action: ACTION,
      sourceType: "message",
      sourceId,
    });
    expect(refund).toMatchObject({ outcome: "refunded", refunded: 3 });
    expect(await balanceOf(w)).toBe(100);

    const rows = await ledgerFor(w);
    expect(rows).toHaveLength(2);
    // Append-only: the debit is untouched and the credit stands beside it.
    expect(rows[0]!.delta).toBe(-3);
    expect(rows[1]!.delta).toBe(3);
    expect(rows[1]!.reason).toBe(refundReason(ACTION));
    expect(rows[1]!.sourceId, "the refund does not point at what it reverses").toBe(sourceId);
    expect(rows.reduce((n, r) => n + r.delta, 0)).toBe(0);

    // A replayed bounce webhook refunds once, like everything else here.
    const again = await refundCharge(db, {
      workspaceId: w,
      action: ACTION,
      sourceType: "message",
      sourceId,
    });
    expect(again.outcome).toBe("already_refunded");
    expect(await ledgerFor(w)).toHaveLength(2);
    expect(await balanceOf(w)).toBe(100);
  });

  it("refunds nothing when nothing was charged", async () => {
    const w = await freshWorkspace(100);
    const r = await refundCharge(db, {
      workspaceId: w,
      action: ACTION,
      sourceType: "message",
      sourceId: `never-${suffix}`,
    });
    expect(r.outcome).toBe("nothing_to_refund");
    expect(await ledgerFor(w)).toHaveLength(0);
    expect(await balanceOf(w)).toBe(100);
  });
});
