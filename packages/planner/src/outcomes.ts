/**
 * F1 (DEC-068) — the ONE row loader behind both outcome consumers: the
 * `GET /agents/:id/outcomes` rollup endpoint and the outcome-aware regen
 * prompt block. Both run it against an RLS-scoped transaction (`withTenant`
 * / the API's TenantClient), and both hand the rows to core's pure
 * `computeOutcomes` — so the regen prompt cites literally the same numbers
 * the endpoint returns.
 */
import {
  computeOutcomes,
  outcomeSignal,
  OUTCOME_EVENT_TYPES,
  SIGNAL_MIN_SENDS,
  validateGraph,
  type CampaignOutcomes,
  type CampaignGraph,
  type OutcomeStepRef,
  type StepNode,
} from "@clientforce/core";
import type { Prisma } from "@clientforce/db";

const THRESHOLDS = { low: SIGNAL_MIN_SENDS.low, ok: SIGNAL_MIN_SENDS.ok };

const ZERO_TOTALS = {
  sent: 0,
  delivered: null,
  replies: 0,
  positiveReplies: 0,
  optOuts: 0,
  replyRatePct: null,
  positiveRatePct: null,
  optOutRatePct: null,
  signal: outcomeSignal(0),
  goalCompletions: 0,
};

/**
 * Agent → primary campaign (A5) → latest graph → ledger rows → outcomes.
 * No campaign / no graph yet → honest zeros (steps: [], all-none), never 404 —
 * a fresh draft simply has nothing to report.
 */
export async function loadCampaignOutcomes(
  tx: Prisma.TransactionClient,
  agentId: string,
): Promise<CampaignOutcomes> {
  const campaign = await tx.campaign.findFirst({
    where: { agentId },
    orderBy: { createdAt: "asc" },
  });
  if (!campaign) {
    return { agentId, campaignId: null, graphVersion: null, thresholds: THRESHOLDS, steps: [], totals: ZERO_TOTALS };
  }

  const graphRow = await tx.campaignGraph.findFirst({
    where: { campaignId: campaign.id },
    orderBy: { version: "desc" },
  });
  let graph: CampaignGraph | null = null;
  try {
    graph = graphRow ? (validateGraph(graphRow.graph) as CampaignGraph) : null;
  } catch {
    graph = null; // malformed stored graph never breaks the rollup
  }
  const steps: OutcomeStepRef[] = (graph?.nodes ?? [])
    .filter((n): n is StepNode => n.type === "step")
    .map((n) => ({ stepNodeId: n.id, channel: n.channel }));

  const eventTypes = [
    ...OUTCOME_EVENT_TYPES.delivered,
    ...OUTCOME_EVENT_TYPES.replied,
    ...OUTCOME_EVENT_TYPES.optOut,
    ...OUTCOME_EVENT_TYPES.goal,
  ];

  // Scale bound (owner decision, F1: pre-launch, no warehouse): the whole
  // campaign ledger is materialized per request — same shape the Inbox tab
  // already accepts (it fetches these rows WITH bodies on a 5s poll). The
  // Phase-10 analytics rollup (DATA_MODEL §8 MetricDaily) supersedes this
  // read at scale; do not bolt silent caps on here (truncation would lie).
  const [messages, enrollments] = await Promise.all([
    tx.message.findMany({
      where: { campaignId: campaign.id },
      select: {
        id: true,
        direction: true,
        stepNodeId: true,
        inReplyToId: true,
        intent: true,
        contactId: true,
        enrollmentId: true,
        sentAt: true,
      },
    }),
    tx.enrollment.findMany({ where: { campaignId: campaign.id }, select: { id: true } }),
  ]);

  // Opt-out events don't reliably carry a campaignId: the unsubscribe-reply
  // path stamps only contact+enrollment (F1 plan §0.3), and two live emitters
  // (contacts bulk-unsub on a lead with no ACTIVE/PAUSED enrollment; the SMS
  // STOP fallback) stamp ONLY contactId. Fetch by campaign OR the campaign's
  // enrollments OR — for opt-out types alone — unstamped events on contacts
  // this campaign messaged; compute dedupes by event id and only attributes
  // where one of THIS campaign's sends precedes the event.
  const contactIds = [...new Set(messages.map((m) => m.contactId))];
  const events = await tx.event.findMany({
    where: {
      type: { in: eventTypes },
      OR: [
        { campaignId: campaign.id },
        { enrollmentId: { in: enrollments.map((e) => e.id) } },
        {
          type: { in: [...OUTCOME_EVENT_TYPES.optOut] },
          campaignId: null,
          enrollmentId: null,
          contactId: { in: contactIds },
        },
      ],
    },
    select: {
      id: true,
      type: true,
      payload: true,
      contactId: true,
      enrollmentId: true,
      occurredAt: true,
    },
  });

  const result = computeOutcomes({
    steps,
    outbound: messages.filter((m) => m.direction === "OUTBOUND"),
    inbound: messages.filter((m) => m.direction === "INBOUND"),
    events,
  });

  return {
    agentId,
    campaignId: campaign.id,
    graphVersion: graphRow?.version ?? null,
    thresholds: THRESHOLDS,
    steps: result.steps,
    totals: result.totals,
  };
}

/**
 * The OBSERVED OUTCOMES prompt section (planner.campaign@v4): one line per
 * step at low+ signal, confidence-labeled, citing the endpoint's own numbers
 * (`replyRatePct` etc. — never recomputed here). Zero qualifying steps → ""
 * (the prompt carries no outcomes section at all; young campaigns plan
 * exactly as v3 did).
 */
export function buildOutcomesPromptBlock(outcomes: CampaignOutcomes): string {
  const qualified = outcomes.steps.filter((s) => s.signal !== "none");
  if (qualified.length === 0) return "";

  const lines = qualified.map((s) => {
    const confidence =
      s.signal === "ok"
        ? `ok (≥${outcomes.thresholds.ok} sends)`
        : `low (${outcomes.thresholds.low}–${outcomes.thresholds.ok - 1} sends — directional only)`;
    return (
      `- ${s.stepNodeId} (${s.channel}): ${s.sent} sent · reply rate ${s.replyRatePct}% · ` +
      `positive-intent ${s.positiveRatePct}% · opt-out ${s.optOutRatePct}% — confidence: ${confidence}`
    );
  });

  return (
    "OBSERVED OUTCOMES (live campaign data — confidence labeled per step):\n" +
    lines.join("\n") +
    `\nSteps below ${outcomes.thresholds.low} sends are omitted — do not infer anything about them. ` +
    "Keep the shape of what works; rewrite weak steps (low/zero reply, high opt-out). Never invent metrics.\n"
  );
}
