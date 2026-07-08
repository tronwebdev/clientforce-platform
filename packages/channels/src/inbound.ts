/**
 * Inbound email ingestion (P1.7): normalize a SendGrid Inbound Parse POST,
 * resolve which thread (workspace/campaign/enrollment/contact) it belongs to,
 * and persist it as an INBOUND `Message` (A6: every inbound + its intent —
 * the intent lands asynchronously via the classify worker).
 *
 * Inbound Parse payloads are UNSIGNED — the caller (API webhook) enforces the
 * shared-secret URL token before anything here runs.
 */
import { Queue } from "bullmq";
import { BULL_PREFIX, bullConnectionFromUrl } from "@clientforce/events";
import type { ConnectionOptions } from "bullmq";
import { withTenant, type Message, type PrismaClient } from "@clientforce/db";

export const INBOUND_CLASSIFY_QUEUE = "clientforce.inbound.classify";

/** Normalized inbound email — provider-agnostic. */
export interface InboundEmail {
  fromEmail: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  /** RFC 5322 Message-IDs this reply references (In-Reply-To + References). */
  referencedIds: string[];
}

const addressRe = /<([^<>@\s]+@[^<>\s]+)>/;

/** "Jane Doe <jane@acme.com>" → { email, name } (bare addresses pass through). */
export function parseAddress(raw: string): { email: string; name?: string } {
  const match = raw.match(addressRe);
  if (match?.[1]) {
    const name = raw.slice(0, raw.indexOf("<")).trim().replace(/^"|"$/g, "");
    return { email: match[1].toLowerCase(), ...(name ? { name } : {}) };
  }
  return { email: raw.trim().toLowerCase() };
}

/** Pull In-Reply-To + References Message-IDs out of the raw headers blob. */
export function extractReferencedIds(rawHeaders: string): string[] {
  const ids = new Set<string>();
  for (const header of ["In-Reply-To", "References"]) {
    // Header value may wrap over continuation lines (leading whitespace).
    const re = new RegExp(`^${header}:((?:.*(?:\\r?\\n[ \\t].*)*))`, "im");
    const value = rawHeaders.match(re)?.[1];
    if (!value) continue;
    for (const id of value.match(/<[^<>\s]+>/g) ?? []) ids.add(id);
  }
  return [...ids];
}

export class MalformedInboundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedInboundError";
  }
}

/**
 * Normalize the Inbound Parse form fields (multipart text fields as a plain
 * record). Throws `MalformedInboundError` when the essentials are missing.
 */
export function normalizeInboundParse(form: Record<string, unknown>): InboundEmail {
  const str = (key: string): string => (typeof form[key] === "string" ? (form[key] as string) : "");
  const fromRaw = str("from");
  const text = str("text") || str("html");
  if (!fromRaw || !text) {
    throw new MalformedInboundError("Inbound payload missing 'from' or body ('text'/'html')");
  }
  const { email, name } = parseAddress(fromRaw);
  return {
    fromEmail: email,
    ...(name ? { fromName: name } : {}),
    to: parseAddress(str("to") || str("envelope")).email,
    subject: str("subject"),
    text,
    referencedIds: extractReferencedIds(str("headers")),
  };
}

export interface ThreadResolution {
  workspaceId: string;
  campaignId: string;
  contactId: string;
  enrollmentId: string | null;
  /** The outbound Message this reply answers (threading anchor), if found. */
  outbound: Message | null;
}

/**
 * Find the thread a reply belongs to. Precedence:
 *   1. In-Reply-To/References ↔ the OUTBOUND Message's wire RFC Message-ID
 *      (persisted at `meta.rfcMessageId` since PR #31; `providerMessageId`
 *      doubles as the wire id for older sandbox rows).
 *   2. Fallback: the most recent OUTBOUND Message to the sender's address.
 * Events carry no tenant — this runs on the OWNER client, then everything
 * downstream is tenant-scoped with the resolved workspaceId.
 */
export async function resolveInboundThread(
  owner: PrismaClient,
  inbound: InboundEmail,
): Promise<ThreadResolution | null> {
  let outbound: Message | null = null;
  for (const id of inbound.referencedIds) {
    outbound = await owner.message.findFirst({
      where: {
        direction: "OUTBOUND",
        OR: [{ meta: { path: ["rfcMessageId"], equals: id } }, { providerMessageId: id }],
      },
      orderBy: { sentAt: "desc" },
    });
    if (outbound) break;
  }
  if (!outbound) {
    const contacts = await owner.contact.findMany({
      where: { email: inbound.fromEmail },
      select: { id: true },
    });
    if (contacts.length === 0) return null;
    outbound = await owner.message.findFirst({
      where: { direction: "OUTBOUND", contactId: { in: contacts.map((c) => c.id) } },
      orderBy: { sentAt: "desc" },
    });
  }
  if (!outbound) return null;
  return {
    workspaceId: outbound.workspaceId,
    campaignId: outbound.campaignId,
    contactId: outbound.contactId,
    enrollmentId: outbound.enrollmentId,
    outbound,
  };
}

export interface IngestInboundDeps {
  /** Owner client — thread resolution is cross-tenant by nature. */
  owner: PrismaClient;
  /** RLS-subject client — everything after resolution is tenant-scoped. */
  app: PrismaClient;
  now?: () => Date;
}

/**
 * Persist the inbound as an INBOUND `Message` on the resolved thread.
 * Returns null when no thread matches (not our mail — logged by the caller,
 * never an error a sender could probe with).
 */
export async function ingestInboundEmail(
  deps: IngestInboundDeps,
  inbound: InboundEmail,
): Promise<{ message: Message; resolution: ThreadResolution } | null> {
  const resolution = await resolveInboundThread(deps.owner, inbound);
  if (!resolution) return null;
  const message = await withTenant(deps.app, { workspaceId: resolution.workspaceId }, (tx) =>
    tx.message.create({
      data: {
        workspaceId: resolution.workspaceId,
        campaignId: resolution.campaignId,
        enrollmentId: resolution.enrollmentId,
        contactId: resolution.contactId,
        channel: "email",
        direction: "INBOUND",
        subject: inbound.subject,
        body: inbound.text,
        inReplyToId: resolution.outbound?.id ?? null,
        sentAt: deps.now?.() ?? new Date(),
        meta: {
          fromEmail: inbound.fromEmail,
          ...(inbound.fromName ? { fromName: inbound.fromName } : {}),
          to: inbound.to,
        },
      },
    }),
  );
  return { message, resolution };
}

export interface ClassifyJobData {
  workspaceId: string;
  messageId: string;
}

export function createClassifyQueue(connection?: ConnectionOptions): Queue<ClassifyJobData> {
  return new Queue<ClassifyJobData>(INBOUND_CLASSIFY_QUEUE, {
    connection:
      connection ?? bullConnectionFromUrl(process.env.REDIS_URL ?? "redis://localhost:6379"),
    prefix: BULL_PREFIX,
  });
}
