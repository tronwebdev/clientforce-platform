/**
 * D1 (DEC-171): bounce CLASSIFICATION — the pure, fixture-tested predicate that
 * decides what a provider failure event actually means, so the consequence can
 * differ. Before this unit every failure collapsed to one "bounce" and
 * suppressed the address PERMANENTLY, which is wrong twice over:
 *
 *  - a full mailbox or a transient block killed the address forever, and
 *  - a `dropped` event whose reason was "Spam Reported" counted against the
 *    HARD-BOUNCE signal instead of the complaint signal — the two carry very
 *    different weights in the health engine (30 vs 40) and very different
 *    meanings to a receiver.
 *
 * The classification is DETERMINISTIC and provider-shaped: no AI, no guessing.
 * Signal priority, most trustworthy first:
 *
 *  1. `type` — SendGrid's own hard/soft verdict. `blocked` and `expired` are
 *     transient by definition (an IP/content block, or repeated deferral
 *     timing out); they are NOT the recipient's fault and must never
 *     permanently suppress them. This OUTRANKS the SMTP status, because a
 *     reputation block arrives as 5.7.1 — a 5xx code about US, not them.
 *  2. `status` — the SMTP enhanced code. 4.x.x transient, 5.x.x permanent.
 *  3. `bounce_classification` — SendGrid's own bucket, for events carrying
 *     neither of the above.
 *  4. Default HARD — the pre-D1 behaviour, so anything this table does not
 *     recognise keeps suppressing exactly as it does today. Widening the soft
 *     set is a deliberate act, never an accident of an unmatched string.
 */

/** What a failure event means for the address it names. */
export type BounceKind = "hard" | "soft";

export interface BounceFacts {
  /** SendGrid `event` — "bounce" | "dropped" | … */
  event: string;
  /** SendGrid `type` on a bounce event — "bounce" | "blocked" | "expired". */
  type?: string | undefined;
  /** SMTP enhanced status, e.g. "5.1.1" / "4.2.2". */
  status?: string | undefined;
  /** SendGrid `bounce_classification`, e.g. "Invalid Address". */
  classification?: string | undefined;
  /** Free-text SMTP reason, or a `dropped` event's drop reason. */
  reason?: string | undefined;
}

/** `type` values that are transient by definition, whatever the SMTP code says. */
const SOFT_TYPES = new Set(["blocked", "expired", "deferred"]);

/**
 * `bounce_classification` buckets that are transient. "Mailbox Unavailable" is
 * deliberately NOT here: it is dominated by "no such mailbox", and a genuinely
 * temporary full mailbox arrives with a 4.x.x status that outranks this table.
 */
const SOFT_CLASSIFICATIONS = new Set([
  "frequency or volume too high",
  "technical",
  "content",
  "reputation",
]);

/**
 * Reasons a `dropped` event carries when SendGrid suppressed the send itself.
 * A drop is an ECHO of a prior outcome, not a fresh one — so it inherits that
 * outcome's meaning rather than becoming a bounce of its own.
 */
const DROP_COMPLAINT = /spam\s*report/i;
const DROP_UNSUBSCRIBE = /unsubscrib/i;
const DROP_BOUNCE = /bounce|invalid/i;

/** What a `dropped` event really was. `null` = not a suppressing outcome. */
export type DropEcho = "complaint" | "unsubscribe" | "bounce" | null;

export function classifyDrop(reason: string | undefined): DropEcho {
  if (!reason) return null;
  // Order matters: "Spam Reported" must not be read as a bounce.
  if (DROP_COMPLAINT.test(reason)) return "complaint";
  if (DROP_UNSUBSCRIBE.test(reason)) return "unsubscribe";
  if (DROP_BOUNCE.test(reason)) return "bounce";
  // "Duplicate", "Invalid SMTP" handled above, anything else: SendGrid chose
  // not to send, but nothing about the ADDRESS is proven. No suppression.
  return null;
}

/**
 * Hard or soft, by the documented priority above. Callers only ask this for
 * events already known to be bounces.
 */
export function classifyBounce(facts: BounceFacts): BounceKind {
  const type = facts.type?.trim().toLowerCase();
  if (type && SOFT_TYPES.has(type)) return "soft";

  const status = facts.status?.trim();
  if (status?.startsWith("4")) return "soft";
  if (status?.startsWith("5")) return "hard";

  const classification = facts.classification?.trim().toLowerCase();
  if (classification && SOFT_CLASSIFICATIONS.has(classification)) return "soft";

  // Unrecognised → the pre-D1 behaviour, unchanged.
  return "hard";
}

/** Pull the classification inputs out of a raw provider event. */
export function bounceFactsFrom(raw: Record<string, unknown>): BounceFacts {
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  return {
    event: str(raw.event) ?? "",
    type: str(raw.type),
    status: str(raw.status),
    classification: str(raw.bounce_classification),
    reason: str(raw.reason),
  };
}
