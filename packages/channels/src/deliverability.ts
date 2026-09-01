/**
 * D1 (DEC-173): the send boundary's deliverability rail — the owner's ruling
 * toggle *"Pause if bounces exceed 2% — she stops rather than burn the
 * domain."*
 *
 * The rule CONTRACT (defaults, schema, the breach predicate) lives in
 * `@clientforce/core` so the API and any surface share it; this is the piece
 * that needs a database and a sender, and it is deliberately the ONLY place
 * that loads the rule — the boundary, the SMS twin and the webhook all come
 * through here rather than each growing their own reader.
 */
import { withTenant, type PrismaClient, type SenderConnection } from "@clientforce/db";
import {
  breachesBounceRate,
  formatBounceRatePct,
  resolveDeliverabilityRule,
  type DeliverabilityRule,
} from "@clientforce/core";
import { parseHealthState } from "./health";

/** The workspace's rule, or the platform defaults when it has never set one. */
export async function loadDeliverabilityRule(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<DeliverabilityRule> {
  const row = await withTenant(prisma, { workspaceId }, (tx) =>
    tx.deliverabilityRule.findUnique({ where: { workspaceId } }),
  );
  return resolveDeliverabilityRule(row);
}

/**
 * The rail as the send boundary asks it: the refusal DETAIL when this sender
 * is over the workspace's line, or null when it may send.
 *
 * The measured rate comes from the SAME persisted snapshot the score gate
 * reads — no second notion of "the bounce rate", and the same freshness (the
 * webhook fast path recomputes on every bounce and complaint; the 10-minute
 * sweep is the floor). It is the HARD-bounce rate (DEC-171): soft bounces are
 * their own event and never count toward the line the owner drew.
 *
 * Two properties make an on-by-default refusal safe rather than reckless:
 * below the sample floor the snapshot's `rates` is null, so a sender with nine
 * sends and one bounce is not "at 11%"; and the window is rolling, so a sender
 * that stops bouncing sends again with no intervention.
 *
 * The rule is read ONLY when a rate exists to test — the overwhelming majority
 * of sends are by senders below the floor or with no snapshot at all, and they
 * must not pay a query to be told a rail cannot fire.
 */
export async function bounceRateRefusal(
  prisma: PrismaClient,
  workspaceId: string,
  sender: Pick<SenderConnection, "healthState">,
): Promise<string | null> {
  const rate = parseHealthState(sender.healthState)?.rates?.bounce ?? null;
  if (rate === null) return null;

  const rule = await loadDeliverabilityRule(prisma, workspaceId);
  if (!breachesBounceRate(rule, rate)) return null;
  return `hard-bounce rate ${formatBounceRatePct(rate)} over the ${formatBounceRatePct(
    rule.bounceRateThreshold,
  )} limit — paused rather than burn the domain`;
}
