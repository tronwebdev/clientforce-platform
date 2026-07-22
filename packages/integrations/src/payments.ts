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

async function publishSafely(deps: PaymentDeps, input: Parameters<NonNullable<PaymentDeps["publish"]>>[0]): Promise<void> {
  if (!deps.publish) return;
  try {
    await deps.publish(input);
  } catch (err) {
    (deps.log ?? console.warn)(
      `[integrations] payment event publish failed (${input.type}): ${err instanceof Error ? err.message : String(err)} — the delivery claim row is authoritative`,
    );
  }
}

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
    const byEmail = await withTenant(deps.prisma, ctx, (tx) =>
      tx.contact.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { id: true } }),
    );
    if (byEmail) return { contactId: byEmail.id, matchedBy: "email" };
  }
  return { contactId: null, matchedBy: "none" };
}

export async function ingestPayment(deps: PaymentDeps, input: PaymentIngestInput): Promise<PaymentIngestResult> {
  const ctx = { workspaceId: input.workspaceId };

  // ── The idempotency claim (before any observable effect) ──────────────────
  let claimed: { id: string } | null;
  try {
    claimed = await withTenant(deps.prisma, ctx, (tx) =>
      tx.integrationDelivery.create({
        data: {
          workspaceId: input.workspaceId,
          integrationId: input.integrationId,
          sourceEventId: input.externalId,
          kind: "payment",
          status: "delivered",
          detail: { amount: input.amount, ...(input.currency ? { currency: input.currency } : {}) } as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { outcome: "duplicate", contactId: null, matchedBy: "none" };
    }
    throw err;
  }

  const { contactId, matchedBy } = await correlateContact(deps, input);
  if (!contactId) {
    await withTenant(deps.prisma, ctx, (tx) =>
      tx.integrationDelivery.update({
        where: { id: claimed!.id },
        data: { detail: { amount: input.amount, unmatched: true } as Prisma.InputJsonValue },
      }),
    );
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

  await publishSafely(deps, {
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
  return { outcome: "recorded", contactId, matchedBy };
}
