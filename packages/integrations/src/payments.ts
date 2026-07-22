/**
 * Payment ingest (INT W3, DEC-095) — the booking.ts twin for Stripe checkout:
 * signature verification happens at the controller (raw body); this service
 * claims idempotency, correlates the payer to a contact, and publishes
 * `payment.received.v1` — the RECORD and the `payment_received` trigger
 * carrier in one event (no stage move, no goal machinery, no credits: the
 * dispatch's "credits/proposals OUT").
 *
 * Idempotency: no Payment table exists (additive-only schema, none needed) —
 * the claim is an IntegrationDelivery row under the stripe Integration,
 * kind "payment", sourceEventId = the checkout session id. Redelivery loses
 * the unique race and acks `duplicate`; the row doubles as the drawer
 * Activity trail entry (the ledger stance).
 *
 * Correlation: `client_reference_id` (the per-lead payment-link rider) →
 * contactId; fallback = the payer email against Contact.email (lowercase).
 * Unmatched payers are ACKNOWLEDGED WITHOUT EVENTS — honest "not our lead";
 * the claim row records it.
 */
import { EVENT_TYPES } from "@clientforce/events";
import { withTenant, Prisma } from "@clientforce/db";
import type { IntegrationsDeps } from "./types";

export type PaymentDeps = Pick<IntegrationsDeps, "prisma" | "publish" | "log" | "now">;

export interface PaymentIngestInput {
  workspaceId: string;
  /** The stripe Integration row id (the controller resolved it by token). */
  integrationId: string;
  /** The checkout session id — the redelivery idempotency key. */
  externalId: string;
  /** Integer minor units (Stripe amount_total). */
  amount: number;
  currency?: string;
  /** The per-lead rider (`client_reference_id=<contactId>`), when it survived. */
  clientReferenceId?: string;
  /** The payer email (customer_details.email) — the fallback correlator. */
  payerEmail?: string;
}

export interface PaymentIngestResult {
  outcome: "recorded" | "duplicate" | "unmatched";
  contactId: string | null;
  matchedBy: "reference" | "email" | "none";
}

/**
 * Publish the payment event, letting bus failures PROPAGATE (the caller settles
 * the claim `failed` + surfaces a 5xx so Stripe redelivers and re-drives). No
 * publisher wired → a no-op: the claim row is the record. This is the fix for
 * the "claim marked delivered before publish, publish error swallowed" gap —
 * the row never reaches `delivered` unless the event was actually emitted.
 */
async function publishStrict(deps: PaymentDeps, input: Parameters<NonNullable<PaymentDeps["publish"]>>[0]): Promise<void> {
  if (!deps.publish) return;
  await deps.publish(input);
}

const settleClaim = (
  deps: PaymentDeps,
  ctx: { workspaceId: string },
  id: string,
  status: "delivered" | "failed",
  detail: Record<string, unknown>,
): Promise<unknown> =>
  withTenant(deps.prisma, ctx, (tx) =>
    tx.integrationDelivery.update({ where: { id }, data: { status, detail: detail as Prisma.InputJsonValue } }),
  );

async function correlateContact(
  deps: PaymentDeps,
  input: PaymentIngestInput,
): Promise<{ contactId: string | null; matchedBy: "reference" | "email" | "none" }> {
  const ctx = { workspaceId: input.workspaceId };
  if (input.clientReferenceId) {
    const byId = await withTenant(deps.prisma, ctx, (tx) =>
      tx.contact.findFirst({ where: { id: input.clientReferenceId }, select: { id: true } }),
    );
    if (byId) return { contactId: byId.id, matchedBy: "reference" };
  }
  const email = input.payerEmail?.trim().toLowerCase();
  if (email) {
    // Deterministic tiebreak: Contact.email is not uniquely constrained, so an
    // email shared by two contacts MUST resolve stably (oldest wins) — never
    // "whichever row Postgres returns first" (W3 fix).
    const byEmail = await withTenant(deps.prisma, ctx, (tx) =>
      tx.contact.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      }),
    );
    if (byEmail) return { contactId: byEmail.id, matchedBy: "email" };
  }
  return { contactId: null, matchedBy: "none" };
}

/** Correlate → publish → settle. Publish failure settles `failed` + rethrows. */
async function driveMatched(
  deps: PaymentDeps,
  input: PaymentIngestInput,
  ctx: { workspaceId: string },
  claimId: string,
): Promise<PaymentIngestResult> {
  const { contactId, matchedBy } = await correlateContact(deps, input);
  if (!contactId) {
    // Unmatched payer — a terminal, event-free ack (honest "not our lead").
    await settleClaim(deps, ctx, claimId, "delivered", { amount: input.amount, unmatched: true });
    return { outcome: "unmatched", contactId: null, matchedBy: "none" };
  }

  // Envelope refs: the latest ACTIVE enrollment gives rules their campaign
  // context when one exists — a payment with no live enrollment still records.
  const enrollment = await withTenant(deps.prisma, ctx, (tx) =>
    tx.enrollment.findFirst({
      where: { contactId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: { id: true, campaignId: true },
    }),
  );

  try {
    await publishStrict(deps, {
      workspaceId: input.workspaceId,
      type: EVENT_TYPES.PAYMENT_RECEIVED,
      contactId,
      ...(enrollment ? { enrollmentId: enrollment.id, campaignId: enrollment.campaignId } : {}),
      payload: {
        amount: input.amount,
        ...(input.currency ? { currency: input.currency } : {}),
        provider: "stripe",
        externalId: input.externalId,
      },
    });
  } catch (err) {
    // Transient bus/Redis failure: settle `failed` (NOT delivered) so a Stripe
    // redelivery re-drives, and rethrow so the controller 5xx's → Stripe retries.
    await settleClaim(deps, ctx, claimId, "failed", {
      amount: input.amount,
      error: err instanceof Error ? err.message : String(err),
    });
    (deps.log ?? console.warn)(
      `[integrations] payment event publish failed (${input.externalId}) — claim left recoverable, surfacing for Stripe retry`,
    );
    throw err;
  }
  await settleClaim(deps, ctx, claimId, "delivered", {
    amount: input.amount,
    ...(input.currency ? { currency: input.currency } : {}),
  });
  return { outcome: "recorded", contactId, matchedBy };
}

export async function ingestPayment(deps: PaymentDeps, input: PaymentIngestInput): Promise<PaymentIngestResult> {
  const ctx = { workspaceId: input.workspaceId };

  // ── The idempotency claim, `pending` BEFORE any observable effect ─────────
  // The unique (integrationId, sourceEventId, kind) key reserves at-most-once;
  // the row only reaches `delivered` after the event actually publishes.
  let claimId: string;
  try {
    const claimed = await withTenant(deps.prisma, ctx, (tx) =>
      tx.integrationDelivery.create({
        data: {
          workspaceId: input.workspaceId,
          integrationId: input.integrationId,
          sourceEventId: input.externalId,
          kind: "payment",
          status: "pending",
          detail: { amount: input.amount, ...(input.currency ? { currency: input.currency } : {}) } as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
    );
    claimId = claimed.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Redelivery. Re-drive ONLY a row that never reached `delivered` — its
      // prior publish failed (`failed`). A `delivered` row is a true duplicate;
      // a `pending` row is a concurrent in-flight attempt (ack, don't double-fire).
      const existing = await withTenant(deps.prisma, ctx, (tx) =>
        tx.integrationDelivery.findUnique({
          where: {
            integrationId_sourceEventId_kind: {
              integrationId: input.integrationId,
              sourceEventId: input.externalId,
              kind: "payment",
            },
          },
          select: { id: true, status: true },
        }),
      );
      if (existing?.status === "failed") {
        return driveMatched(deps, input, ctx, existing.id);
      }
      return { outcome: "duplicate", contactId: null, matchedBy: "none" };
    }
    throw err;
  }

  return driveMatched(deps, input, ctx, claimId);
}
