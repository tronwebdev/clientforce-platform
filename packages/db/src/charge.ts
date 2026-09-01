/**
 * B9.5 (DEC-157): THE credit charge path. One helper, every debit.
 *
 * Before this, two writers touched the ledger — the lead reveal and backoffice
 * adjustments — and the reveal had inlined its own copy of the price rule with
 * a hard-coded `?? 1` fallback. This EXTRACTS that transaction; the reveal
 * becomes its first caller rather than a sibling implementation, which is the
 * standing "no parallel meter" constraint (CHECKLIST_B1 §64): billing
 * enforcement consumes W2's reconciliation, so there must be exactly one place
 * that moves a balance.
 *
 * WHY IT LIVES IN `packages/db`: it needs a Prisma transaction client and the
 * generated types. `packages/core` is deliberately pure (zod only) and holds
 * the price RULE — `resolveCreditPrice`, which this calls. The rule stays
 * pure and testable; the transaction lives beside the client. Every consumer
 * that charges (apps/api, packages/channels, apps/worker) already depends on
 * this package, so there is no second path for anyone to reach for.
 *
 * The invariants, all from SURFACE_SPEC_METERING §2:
 *
 *  1. APPEND-ONLY. A ledger row is never updated or deleted. A correction is
 *     a new row (see `refundCharge`).
 *  2. ONE TRANSACTION with the balance move, and `balanceAfter` on the row.
 *  3. PRICE RESOLVED AT CHARGE TIME through `resolveCreditPrice` — never a
 *     literal, never a value the caller passed in, never a number cached by a
 *     surface.
 *  4. QUANTITY × PRICE, with the caller stating quantity in the action's own
 *     unit (segments, minutes, turns) and rounding done before it gets here.
 *  5. IDEMPOTENT on `(workspaceId, sourceType, sourceId, reason)`.
 *  6. ZERO-PRICE ACTIONS WRITE NOTHING — anything Ada writes is free, and a
 *     0-credit row would make "nothing has drawn down credits" false.
 */
import { Prisma } from "@prisma/client";
import { resolveCreditPrice } from "@clientforce/core";

/**
 * The kind of row that produced the charge. Not free text: it is half of the
 * idempotency key, so a typo would silently create a second chargeable
 * identity for the same event.
 */
export const CHARGE_SOURCE_TYPES = [
  "message",
  "call",
  "contact",
  "sync",
  "widget_turn",
  "reveal",
] as const;
export type ChargeSourceType = (typeof CHARGE_SOURCE_TYPES)[number];

export interface ChargeInput {
  workspaceId: string;
  /** A `CreditPrice.action` key. Also the ledger row's `reason`. */
  action: string;
  /** In the action's own unit. Rounding is the caller's, and stated there. */
  quantity?: number;
  sourceType: ChargeSourceType;
  /** The id of the row that was actually produced. The natural key. */
  sourceId: string;
  channel?: string | null;
  /** Provider ids, rounding inputs — whatever makes the charge auditable. */
  metadata?: Record<string, unknown>;
}

export type ChargeResult =
  /** A row was written and the balance moved. */
  | { outcome: "charged"; charged: number; balanceAfter: number }
  /** This exact source was already charged. No second row, no second debit. */
  | { outcome: "already_charged"; charged: 0; balanceAfter: number }
  /** Priced at zero — free by design. No row, by invariant 6. */
  | { outcome: "free"; charged: 0; balanceAfter: number }
  /** No CreditPrice row applies. We do not invent a price. No row. */
  | { outcome: "unpriced"; charged: 0; balanceAfter: number }
  /** The balance cannot cover it. No row; the balance never goes negative. */
  | { outcome: "refused"; reason: "INSUFFICIENT_CREDITS"; price: number; short: number; balanceAfter: number };

/** Just enough of the client to charge — so tests can pass a transaction. */
type ChargeClient = Pick<Prisma.TransactionClient, "workspace" | "creditPrice" | "creditLedger">;

/**
 * What one unit of `action` costs this workspace right now, or `null` when no
 * price applies. Exported because a BOUNDARY must be able to pre-check before
 * doing the work (SURFACE_SPEC §5: refuse before the action, not after it),
 * and it must ask the same question the charge will ask.
 */
export async function priceFor(
  tx: ChargeClient,
  workspaceId: string,
  action: string,
): Promise<{ price: number | null; balance: number; agencyId: string }> {
  const ws = await tx.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { agencyId: true, creditBalance: true },
  });
  // Read every row that could apply and let the PURE rule decide. The rule is
  // override-first then newest-first, and re-implementing it in SQL is how the
  // reveal drifted into a second implementation in the first place.
  const rows = await tx.creditPrice.findMany({
    where: { action, OR: [{ agencyId: null }, { agencyId: ws.agencyId }] },
    select: { agencyId: true, action: true, credits: true, effectiveFrom: true },
  });
  return {
    price: resolveCreditPrice(rows, { agencyId: ws.agencyId, action }),
    balance: ws.creditBalance,
    agencyId: ws.agencyId,
  };
}

/**
 * Charge for something that has ALREADY happened.
 *
 * Idempotency uses `createMany({ skipDuplicates: true })` rather than
 * insert-and-catch. That matters: in Postgres a unique violation ABORTS the
 * surrounding transaction, so catching P2002 and continuing would leave the
 * caller holding a poisoned tx — every subsequent statement fails. Prisma
 * compiles `skipDuplicates` to `ON CONFLICT DO NOTHING`, which raises nothing,
 * so a replay is an ordinary zero-row insert and the transaction survives.
 * `count === 0` is therefore "already charged", which is a SUCCESS: the work
 * was paid for the first time round.
 */
export async function charge(tx: ChargeClient, input: ChargeInput): Promise<ChargeResult> {
  const quantity = input.quantity ?? 1;
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error(`charge: quantity must be a non-negative number, got ${String(input.quantity)}`);
  }
  const { price, balance } = await priceFor(tx, input.workspaceId, input.action);

  // No price row applies. We charge nothing rather than guess — the reveal's
  // old `?? 1` was exactly that guess, and it is a literal price in the charge
  // path (§7.10). An unpriced action is not a free action, and the surface
  // says so separately; this only refuses to invent a number.
  if (price === null) return { outcome: "unpriced", charged: 0, balanceAfter: balance };
  // Free by design (invariant 6) — and quantity 0 costs nothing either.
  if (price === 0 || quantity === 0) return { outcome: "free", charged: 0, balanceAfter: balance };

  const cost = price * quantity;
  // The balance never goes negative outside an explicit backoffice adjustment
  // (§7.11). The boundary's pre-check is what makes this rare; reaching it
  // means the balance moved between the check and the charge.
  if (balance < cost) {
    return {
      outcome: "refused",
      reason: "INSUFFICIENT_CREDITS",
      price,
      short: cost - balance,
      balanceAfter: balance,
    };
  }

  const balanceAfter = balance - cost;
  const { count } = await tx.creditLedger.createMany({
    data: [
      {
        workspaceId: input.workspaceId,
        delta: -cost,
        reason: input.action,
        channel: input.channel ?? null,
        refId: input.sourceId,
        balanceAfter,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        // The arithmetic, kept: quantity and unit price are what make a
        // charge explainable months later.
        meta: {
          quantity,
          unitPrice: price,
          ...(input.metadata ?? {}),
        } as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });

  if (count === 0) {
    // A replay. Report the balance as it actually stands, not as this attempt
    // would have left it — the first charge already moved it.
    const existing = await tx.workspace.findUniqueOrThrow({
      where: { id: input.workspaceId },
      select: { creditBalance: true },
    });
    return { outcome: "already_charged", charged: 0, balanceAfter: existing.creditBalance };
  }

  await tx.workspace.update({
    where: { id: input.workspaceId },
    data: { creditBalance: balanceAfter },
  });
  return { outcome: "charged", charged: cost, balanceAfter };
}

/** A refund's reason is the action's, prefixed — `refund_email_send`. */
export const refundReason = (action: string): string => `refund_${action}`;

/**
 * Give credits back for a charge the outcome later invalidated — a hard bounce
 * after the provider accepted the message.
 *
 * The ledger is APPEND-ONLY, so this writes a compensating POSITIVE row rather
 * than touching the debit. It points at the same source, so the pair is
 * auditable and nets to zero, and its own reason makes it idempotent under the
 * same partial index: refunding twice writes one row.
 *
 * Soft bounces and complaints are NOT refundable (the ruling), so nothing in
 * the bounce path may call this without first establishing the bounce was hard.
 */
export async function refundCharge(
  tx: ChargeClient,
  input: { workspaceId: string; action: string; sourceType: ChargeSourceType; sourceId: string },
): Promise<{ outcome: "refunded" | "already_refunded" | "nothing_to_refund"; refunded: number; balanceAfter: number }> {
  const original = await tx.creditLedger.findFirst({
    where: {
      workspaceId: input.workspaceId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      reason: input.action,
    },
    select: { delta: true },
  });
  const ws = await tx.workspace.findUniqueOrThrow({
    where: { id: input.workspaceId },
    select: { creditBalance: true },
  });
  // Nothing was charged for this source, so there is nothing to give back —
  // a refused send, or an action that was free.
  if (!original || original.delta >= 0) {
    return { outcome: "nothing_to_refund", refunded: 0, balanceAfter: ws.creditBalance };
  }

  const refunded = -original.delta;
  const balanceAfter = ws.creditBalance + refunded;
  const { count } = await tx.creditLedger.createMany({
    data: [
      {
        workspaceId: input.workspaceId,
        delta: refunded,
        reason: refundReason(input.action),
        refId: input.sourceId,
        balanceAfter,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        meta: { refundOf: input.action } as Prisma.InputJsonValue,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) {
    return { outcome: "already_refunded", refunded: 0, balanceAfter: ws.creditBalance };
  }
  await tx.workspace.update({
    where: { id: input.workspaceId },
    data: { creditBalance: balanceAfter },
  });
  return { outcome: "refunded", refunded, balanceAfter };
}
