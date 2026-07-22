/**
 * Payment-link plumbing (INT W3, DEC-095) — the booking-link twin on the
 * workspace's Stripe `Integration` row. The per-lead link carries
 * `?client_reference_id=<contactId>` — Stripe's official checkout passthrough
 * (the utm twin), so the webhook correlates the payer back to the contact and
 * the FULL final URL grounds composed copy by construction.
 *
 * ONE deliberate difference from the booking link (documented default): the
 * payment link does NOT ride every compose as an ambient talking point — a
 * payment ask is contextual, not standing copy. It enters a message ONLY via
 * (a) the `send_payment_link` flag (→ mustSay on the next composed send) or
 * (b) the scripted `{{paymentLink}}` render token. No config → the flag
 * refuses at save time and the token throws MissingTokenError (house rule).
 */
import { stripeConfigSchema, type StepBrief } from "@clientforce/core";
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";

/** The workspace payment link off the stripe Integration row (null = unconfigured/revoked). */
export async function loadPaymentLinkUrl(prisma: PrismaClient, workspaceId: string): Promise<string | null> {
  const row = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.integration.findUnique({
      where: { workspaceId_provider: { workspaceId, provider: "stripe" } },
      select: { config: true, status: true },
    }),
  );
  if (!row || row.status === "revoked") return null;
  const config = stripeConfigSchema.safeParse(row.config);
  if (!config.success || !config.data.paymentLinkUrl) return null;
  return config.data.paymentLinkUrl;
}

/** Append the per-lead correlation rider to the payment link. */
export function withClientReference(paymentLinkUrl: string, contactId: string): string {
  const sep = paymentLinkUrl.includes("?") ? "&" : "?";
  return `${paymentLinkUrl}${sep}client_reference_id=${encodeURIComponent(contactId)}`;
}

/** The full per-lead payment link, or null when no link is configured. */
export async function resolvePaymentLink(
  prisma: PrismaClient,
  workspaceId: string,
  contactId: string,
): Promise<string | null> {
  const url = await loadPaymentLinkUrl(prisma, workspaceId);
  return url ? withClientReference(url, contactId) : null;
}

/** `{{paymentLink}}` reference test — resolution is lazy, only on reference. */
export const PAYMENT_LINK_TOKEN_RE = /\{\{\s*paymentLink\s*\}\}/;

/** Enrollment.meta reader for the send_payment_link flag (R1 action, INT W3). */
export async function paymentLinkRequested(
  prisma: PrismaClient,
  workspaceId: string,
  enrollmentId: string,
): Promise<boolean> {
  const enrollment = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.enrollment.findUnique({ where: { id: enrollmentId }, select: { meta: true } }),
  );
  const meta = (enrollment?.meta ?? {}) as Record<string, unknown>;
  return meta.paymentLinkRequested === true;
}

/**
 * Compose-time augmentation for the send_payment_link flag ONLY: when the
 * flag is set and a link is configured, the FULL per-lead link joins mustSay
 * (verbatim inclusion, grounded by the same substring). No flag / no config →
 * the brief passes through untouched — never an ambient payment ask.
 */
export async function augmentBriefWithPaymentLink(
  deps: { prisma: PrismaClient },
  params: { workspaceId: string; contactId: string; enrollmentId?: string },
  brief: StepBrief,
): Promise<StepBrief> {
  if (!params.enrollmentId) return brief;
  if (!(await paymentLinkRequested(deps.prisma, params.workspaceId, params.enrollmentId))) return brief;
  const link = await resolvePaymentLink(deps.prisma, params.workspaceId, params.contactId);
  if (!link) return brief; // unconfigured — the flag stays for a later configured send
  return {
    ...brief,
    // The link must also be visible material for the ungrounded-URL check —
    // mustSay feeds allowedMaterial, so mustSay alone suffices.
    mustSay: [...(brief.mustSay ?? []), link],
  };
}

/**
 * Send-boundary flag clear: once a SENT message actually carried the
 * workspace payment link (mustSay injection or a scripted {{paymentLink}}),
 * the queued request is fulfilled. Substring on the BASE link (the per-lead
 * rider follows it). Best-effort — never unwinds a send.
 */
export async function clearPaymentLinkFlagAfterSend(
  prisma: PrismaClient,
  params: { workspaceId: string; enrollmentId: string; sentBody: string },
): Promise<void> {
  try {
    if (!(await paymentLinkRequested(prisma, params.workspaceId, params.enrollmentId))) return;
    const paymentLinkUrl = await loadPaymentLinkUrl(prisma, params.workspaceId);
    if (!paymentLinkUrl) return;
    if (!params.sentBody.toLowerCase().includes(paymentLinkUrl.toLowerCase())) return;
    await withTenant(prisma, { workspaceId: params.workspaceId }, async (tx) => {
      const enrollment = await tx.enrollment.findUnique({ where: { id: params.enrollmentId } });
      if (!enrollment) return;
      const meta = { ...((enrollment.meta ?? {}) as Record<string, unknown>) };
      if (meta.paymentLinkRequested !== true) return;
      delete meta.paymentLinkRequested;
      await tx.enrollment.update({
        where: { id: enrollment.id },
        data: { meta: meta as Prisma.InputJsonValue },
      });
    });
  } catch (err) {
    console.warn(
      `[channels] payment-link flag clear failed for enrollment ${params.enrollmentId}: ` +
        `${err instanceof Error ? err.message : String(err)} — send already persisted`,
    );
  }
}
