import { createVerify } from "node:crypto";
import {
  withTenant,
  type Message,
  type PrismaClient,
  type SuppressionReason,
} from "@clientforce/db";
import type { DeliverabilityRule } from "@clientforce/core";
import type { EventType } from "@clientforce/events";
import { z } from "zod";
import { bounceFactsFrom, classifyBounce, classifyDrop } from "./bounce";
import { loadDeliverabilityRule } from "./deliverability";

/**
 * SendGrid event webhooks → normalized internal shapes (P1.5). P1.7 puts
 * these on the event bus; this layer parses, verifies, and applies the
 * suppression side-effects (A7: unsubscribe/bounce/spam write `Suppression`
 * AND `Contact.optOut`).
 */
export const normalizedEmailEventSchema = z.object({
  type: z.enum(["delivered", "open", "click", "bounce", "spam_report", "unsubscribe", "other"]),
  email: z.string(),
  providerMessageId: z.string().nullable(),
  occurredAt: z.coerce.date(),
  raw: z.record(z.unknown()),
  /**
   * D1 (DEC-174): the provider's own per-event id (`sg_event_id`) — the key a
   * replayed batch is deduplicated on. Null when the provider omits it (older
   * payloads, hand-rolled fixtures), in which case the event is processed as
   * before: dedup is best-effort by construction and must never DROP an event
   * it cannot identify.
   */
  eventId: z.string().nullable().optional(),
  /**
   * D1 (DEC-171): hard/soft, present only on `type: "bounce"`. Absent means
   * "not a bounce"; a bounce always carries it.
   */
  bounce: z
    .object({
      kind: z.enum(["hard", "soft"]),
      reason: z.string().optional(),
      status: z.string().optional(),
      classification: z.string().optional(),
    })
    .optional(),
});
export type NormalizedEmailEvent = z.infer<typeof normalizedEmailEventSchema>;

const sendgridEventSchema = z
  .object({
    event: z.string(),
    email: z.string(),
    timestamp: z.number(),
    sg_message_id: z.string().optional(),
    sg_event_id: z.string().optional(),
  })
  .passthrough();

const EVENT_MAP: Record<string, NormalizedEmailEvent["type"]> = {
  delivered: "delivered",
  open: "open",
  click: "click",
  bounce: "bounce",
  spamreport: "spam_report",
  unsubscribe: "unsubscribe",
  group_unsubscribe: "unsubscribe",
};

/**
 * D1 (DEC-171): `dropped` is not an outcome of its own — it says SendGrid
 * declined to send, and its `reason` says which EARLIER outcome caused that.
 * Pre-D1 every drop was mapped to `bounce`, so a "Spam Reported" drop was
 * counted as a hard bounce (30-weight signal) instead of a complaint
 * (40-weight), and a "Duplicate" drop suppressed an address that had never
 * failed at all. A drop whose reason proves nothing about the address now
 * resolves to `other` and has no consequence.
 */
function droppedType(raw: Record<string, unknown>): NormalizedEmailEvent["type"] {
  const reason = typeof raw.reason === "string" ? raw.reason : undefined;
  switch (classifyDrop(reason)) {
    case "complaint":
      return "spam_report";
    case "unsubscribe":
      return "unsubscribe";
    case "bounce":
      return "bounce";
    default:
      return "other";
  }
}

export function normalizeSendGridEvents(payload: unknown): NormalizedEmailEvent[] {
  const events = z.array(sendgridEventSchema).parse(payload);
  return events.map((e) => {
    const raw = e as Record<string, unknown>;
    const type = e.event === "dropped" ? droppedType(raw) : (EVENT_MAP[e.event] ?? "other");
    const facts = bounceFactsFrom(raw);
    return {
      type,
      email: e.email,
      // SendGrid appends ".filter…" to the original Message-ID — strip it.
      providerMessageId: e.sg_message_id ? e.sg_message_id.split(".filter")[0]! : null,
      occurredAt: new Date(e.timestamp * 1000),
      raw,
      eventId: e.sg_event_id ?? null,
      ...(type === "bounce"
        ? {
            bounce: {
              kind: classifyBounce(facts),
              ...(facts.reason ? { reason: facts.reason } : {}),
              ...(facts.status ? { status: facts.status } : {}),
              ...(facts.classification ? { classification: facts.classification } : {}),
            },
          }
        : {}),
    };
  });
}

const SUPPRESSING: Partial<Record<NormalizedEmailEvent["type"], SuppressionReason>> = {
  bounce: "BOUNCED",
  spam_report: "SPAM_COMPLAINT",
  unsubscribe: "UNSUBSCRIBED",
};

export interface ApplyEmailEventDeps {
  now?: () => Date;
}

export interface ApplyEmailEventResult {
  suppressed: boolean;
  /**
   * D1 (DEC-171): present when the event was a SOFT bounce. `strikes` is the
   * tally after this one; `suppressed` on the outer result says whether that
   * tally crossed the threshold and wrote the suppression.
   */
  softBounce?: { strikes: number; threshold: number };
}

/**
 * THE suppression write. Every path that suppresses an address goes through
 * this one function — hard bounce, complaint, unsubscribe, and the soft-bounce
 * threshold alike — so there is exactly one place that decides what a
 * suppression looks like, and `Suppression` stays the only store a send reads.
 */
async function suppressAddress(
  prisma: PrismaClient,
  workspaceId: string,
  email: string,
  reason: SuppressionReason,
  source: string,
): Promise<void> {
  const address = email.toLowerCase();
  await withTenant(prisma, { workspaceId }, async (tx) => {
    await tx.suppression.upsert({
      where: {
        // P5 W3 (DEC-085): suppression addresses are stored lowercase.
        workspaceId_channel_address: { workspaceId, channel: "email", address },
      },
      create: { workspaceId, channel: "email", address, reason, source },
      update: { reason },
    });
    const contacts = await tx.contact.findMany({ where: { workspaceId, email } });
    for (const c of contacts) {
      const optOut = { ...((c.optOut ?? {}) as Record<string, unknown>), email: true };
      await tx.contact.update({ where: { id: c.id }, data: { optOut } });
    }
  });
}

/**
 * D1 (DEC-171): record one soft bounce and report the tally. A window that has
 * aged out RESETS rather than accumulates, so the count is always readable
 * from the row alone — no sweeper, no derived state elsewhere.
 */
async function recordSoftBounce(
  prisma: PrismaClient,
  workspaceId: string,
  event: NormalizedEmailEvent,
  rule: DeliverabilityRule,
  now: Date,
): Promise<number> {
  const address = event.email.toLowerCase();
  const windowStart = new Date(now.getTime() - rule.softBounceWindowDays * 86_400_000);
  const reason = event.bounce?.reason ?? null;

  return withTenant(prisma, { workspaceId }, async (tx) => {
    const key = { workspaceId_channel_address: { workspaceId, channel: "email", address } };
    const existing = await tx.softBounce.findUnique({ where: key });
    if (!existing) {
      try {
        const created = await tx.softBounce.create({
          data: {
            workspaceId,
            channel: "email",
            address,
            count: 1,
            firstAt: now,
            lastAt: now,
            lastReason: reason,
          },
        });
        return created.count;
      } catch (err) {
        // Two batches can carry a soft bounce for the same address at once.
        // The unique index is the arbiter; the loser falls through to the
        // increment rather than throwing away a strike.
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
    }
    // Aged out → this bounce starts a fresh window rather than joining a stale
    // one. A single soft bounce a year must never be the third strike.
    const current = existing ?? (await tx.softBounce.findUniqueOrThrow({ where: key }));
    const stale = current.firstAt < windowStart;
    const updated = await tx.softBounce.update({
      where: { id: current.id },
      data: {
        count: stale ? 1 : current.count + 1,
        ...(stale ? { firstAt: now, suppressedAt: null } : {}),
        lastAt: now,
        lastReason: reason,
      },
    });
    return updated.count;
  });
}

/**
 * Apply one normalized event for a workspace: suppressing events upsert a
 * `Suppression` row and flip `Contact.optOut.email` (both — A7).
 *
 * D1 (DEC-171) splits the bounce consequence in two. A HARD bounce still
 * suppresses immediately and permanently — the address does not exist and
 * sending to it again is what burns a domain. A SOFT bounce (a transient
 * block, an expired retry, a 4.x.x) no longer suppresses on sight: it takes a
 * strike, and only the Nth strike inside the window reaches the SAME
 * suppression path. Nothing here is a second suppression store — the tally
 * decides *when* to call `suppressAddress`, and `Suppression` remains the only
 * thing the send boundary consults.
 */
export async function applyEmailEvent(
  prisma: PrismaClient,
  workspaceId: string,
  event: NormalizedEmailEvent,
  deps: ApplyEmailEventDeps = {},
): Promise<ApplyEmailEventResult> {
  const reason = SUPPRESSING[event.type];
  if (!reason) return { suppressed: false };

  if (event.type === "bounce" && event.bounce?.kind === "soft") {
    const now = deps.now?.() ?? new Date();
    const rule = await loadDeliverabilityRule(prisma, workspaceId);
    const strikes = await recordSoftBounce(prisma, workspaceId, event, rule, now);
    const softBounce = { strikes, threshold: rule.softBounceThreshold };
    if (strikes < rule.softBounceThreshold) return { suppressed: false, softBounce };
    await suppressAddress(prisma, workspaceId, event.email, "BOUNCED", "soft-bounce-threshold");
    await withTenant(prisma, { workspaceId }, (tx) =>
      tx.softBounce.updateMany({
        where: { workspaceId, channel: "email", address: event.email.toLowerCase() },
        data: { suppressedAt: now },
      }),
    );
    return { suppressed: true, softBounce };
  }

  await suppressAddress(prisma, workspaceId, event.email, reason, "webhook");
  return { suppressed: true };
}

/**
 * Resolve the workspace an event belongs to via the persisted `Message` row
 * (SendGrid events carry no tenant) — owner-client lookup by unique
 * providerMessageId, then all side-effects run tenant-scoped.
 */
export async function resolveEventWorkspace(
  ownerPrisma: PrismaClient,
  event: NormalizedEmailEvent,
): Promise<string | null> {
  return (await resolveEventMessage(ownerPrisma, event))?.workspaceId ?? null;
}

/** Like {@link resolveEventWorkspace} but returns the whole Message row (P1.7). */
export async function resolveEventMessage(
  ownerPrisma: PrismaClient,
  event: NormalizedEmailEvent,
): Promise<Message | null> {
  if (!event.providerMessageId) return null;
  const candidates = [event.providerMessageId, `<${event.providerMessageId}>`];
  return ownerPrisma.message.findFirst({
    where: { providerMessageId: { in: candidates } },
  });
}

/** Minimal publishable shape — satisfied by `EventBus.publish` inputs. */
export interface BusEventInput {
  type: EventType;
  workspaceId: string;
  contactId?: string;
  enrollmentId?: string;
  campaignId?: string;
  /** P5 W1 (DEC-083): sender attribution for per-sender health rollups. */
  senderId?: string;
  payload: Record<string, unknown>;
}

/** Sender attribution off a Message row — the column, meta for pre-backfill rows. */
export function messageSenderId(message: Message): string | null {
  if (message.senderId) return message.senderId;
  const meta = message.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const fromMeta = (meta as Record<string, unknown>).senderId;
    if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  }
  return null;
}

const TYPED_EVENT: Partial<Record<NormalizedEmailEvent["type"], EventType>> = {
  delivered: "email.delivered.v1",
  open: "email.opened.v1",
  click: "email.clicked.v1",
  bounce: "email.bounced.v1",
  spam_report: "email.spam.v1",
};

/**
 * P1.7 engagement awareness: a normalized provider event + its resolved
 * Message become typed bus events — persisted `Event` rows on the lead that
 * feed the Logs tab, the lead-drawer timeline, and the classifier's context.
 * Suppressing events additionally emit `lead.unsubscribed.v1`.
 */
export function toBusEvents(
  event: NormalizedEmailEvent,
  message: Message,
  /** D1 (DEC-171): the soft-bounce strike count, when the caller has it. */
  softBounceAttempt?: number,
): BusEventInput[] {
  const senderId = messageSenderId(message);
  const base = {
    workspaceId: message.workspaceId,
    contactId: message.contactId,
    ...(message.enrollmentId ? { enrollmentId: message.enrollmentId } : {}),
    campaignId: message.campaignId,
    // P5 W1 (DEC-083): provider events inherit the message's sender, so the
    // health engine's per-sender rollup is one indexed Event scan.
    ...(senderId ? { senderId } : {}),
  };
  const out: BusEventInput[] = [];
  const typed = TYPED_EVENT[event.type];
  if (typed === "email.clicked.v1") {
    out.push({
      ...base,
      type: typed,
      payload: { messageId: message.id, link: String(event.raw.url ?? "") },
    });
  } else if (typed === "email.bounced.v1") {
    // D1 (DEC-171): `email.bounced.v1` is the HARD-bounce event and always was
    // in everything that reads it — the Logs tab renders it verbatim as
    // "Email to … hard-bounced" and the health engine's 30-weight signal is
    // documented as the hard-bounce rate. Pre-D1 soft bounces were emitted
    // under it too, so both the timeline and the score were being told
    // something untrue. Soft bounces now get their own catalog event and stay
    // out of the hard-bounce rate entirely.
    const soft = event.bounce?.kind === "soft";
    const reason = event.bounce?.reason ?? (typeof event.raw.reason === "string" ? event.raw.reason : undefined);
    out.push({
      ...base,
      type: soft ? "email.soft_bounced.v1" : typed,
      payload: {
        messageId: message.id,
        ...(reason ? { reason } : {}),
        ...(soft && event.bounce?.status ? { status: event.bounce.status } : {}),
        ...(soft && softBounceAttempt ? { attempt: softBounceAttempt } : {}),
      },
    });
  } else if (typed) {
    out.push({ ...base, type: typed, payload: { messageId: message.id } });
  }
  if (event.type === "unsubscribe" || event.type === "spam_report") {
    out.push({ ...base, type: "lead.unsubscribed.v1", payload: { channel: "email" } });
  }
  return out;
}

/**
 * D1 (DEC-170): SendGrid hands the Signed Event Webhook key out of its console
 * as a BARE base64 SPKI/DER string — no PEM armour, no line breaks. That is
 * what an owner copies, and what they will paste into Key Vault. Node's
 * `createVerify().verify()` needs a PEM (or a KeyObject), so the bare form
 * throws rather than returning false, and verification never gets a chance to
 * succeed. Accept BOTH forms and normalize to PEM here, so the owner action is
 * "paste the key" and not "paste the key, wrapped, at the right line width".
 */
export function normalizeSendGridPublicKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) return trimmed;
  // Bare base64 (possibly whitespace-wrapped by a copy-paste) → PEM SPKI.
  const body = trimmed.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

/**
 * SendGrid Signed Event Webhook verification (ECDSA P-256 / SHA-256). The
 * public key comes from Key Vault (`SENDGRID-WEBHOOK-PUBLIC-KEY`) once event
 * webhooks are enabled; with no key configured the caller decides whether to
 * accept (dev) or reject (deployed).
 *
 * `payload` MUST be the RAW request body, byte for byte. SendGrid signs the
 * bytes it put on the wire; a re-serialized `JSON.stringify(parsedBody)` is a
 * different string (spacing, unicode escaping, numeric formatting) and fails
 * against a perfectly valid signature — see the controller, which reads
 * `req.rawBody` exactly as the Calendly and Stripe routes already do.
 *
 * Returns FALSE on any malformed input rather than throwing: a bad key or a
 * junk signature is an authentication failure, not a 500, and a webhook route
 * that 500s is one SendGrid will keep retrying forever.
 */
export function verifySendGridSignature(
  publicKeyPem: string,
  payload: string,
  signature: string,
  timestamp: string,
): boolean {
  try {
    const verifier = createVerify("sha256");
    verifier.update(timestamp + payload);
    return verifier.verify(normalizeSendGridPublicKey(publicKeyPem), signature, "base64");
  } catch {
    return false;
  }
}

/**
 * D1 (DEC-170): the honest posture of the event webhook, for the owner action
 * and for anything that reports readiness. `absent` is the state the staging
 * deploy is in today — `SENDGRID-WEBHOOK-PUBLIC-KEY` is not in Key Vault, so
 * `SENDGRID_WEBHOOK_PUBLIC_KEY` is unset, so the route rejects every signed
 * event in production and NO bounce or complaint reaches this system at all.
 */
export type WebhookKeyState = "present" | "absent";

export function sendGridWebhookKeyState(
  env: { SENDGRID_WEBHOOK_PUBLIC_KEY?: string | undefined } = process.env,
): WebhookKeyState {
  return env.SENDGRID_WEBHOOK_PUBLIC_KEY?.trim() ? "present" : "absent";
}
