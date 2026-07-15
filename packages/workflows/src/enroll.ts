/**
 * LH1 W3 (DEC-087): ONE enrollment gate, every source — CSV, manual, list,
 * form, widget, future Lead Finder all enter a campaign through
 * `enrollContact`; sources never fork the gate. Host-side only (never
 * imported by the workflow isolate).
 *
 * The ladder (verdicts from the LH1 validation spine):
 *   · `invalid`      → typed refusal `CONTACT_INVALID` + a cataloged Logs row
 *                      (`contact.enrollment_refused.v1`) — never enrolls.
 *   · `unverified`   → HELD (reason `unverified`) — drains progressively as
 *                      verdicts land. EXCEPTION: an already-SUPPRESSED
 *                      address keeps pre-LH1 parity (enrolls; the boundary's
 *                      suppression rail refuses the send with its amber row —
 *                      we never pay to validate the unsendable, and
 *                      suppression outcomes stay byte-identical).
 *   · `risky`        → workspace policy (default HOLD, owner-flippable
 *                      `settings.validation.riskyPolicy`).
 *   · passers        → the per-day-per-campaign enrollment cap: verified
 *                      enrollments created today count; over cap → HELD
 *                      (reason `cap_overflow`), drains next UTC day. The cap
 *                      bounds the QUEUE feeding a warming sender — effective
 *                      send volume stays min(warmup curve, dailyLimit).
 *
 * A hold is an INTENT, not a run: it owns no workflow and becomes an
 * Enrollment only back through this gate (the drain). Re-enrolling a contact
 * with an existing Enrollment row keeps today's idempotent semantics
 * (deduped start / fresh-run-on-latest-graph, DEC-076) — the gate governs
 * first-time entry.
 */
import { randomUUID } from "node:crypto";
import {
  CONTACT_INVALID_MESSAGE,
  ENROLLMENT_DAILY_CAP_DEFAULT,
  parseWorkspaceValidationSettings,
  validateGraph,
  type CampaignGraph,
  type EnrollmentHoldReason,
} from "@clientforce/core";
import { withTenant, type EnrollmentHold, type PrismaClient } from "@clientforce/db";
import { workflowIdFor, type CampaignWorkflowInput } from "./shared";

/** Structural twin of the api's WorkflowEngine — tests inject a fake. */
export interface EnrollEngine {
  start(input: CampaignWorkflowInput): Promise<{ workflowId: string; deduped: boolean }>;
}

export interface EnrollEventInput {
  type: "contact.enrollment_refused.v1";
  workspaceId: string;
  contactId: string;
  campaignId: string;
  payload: Record<string, unknown>;
}

export interface EnrollDeps {
  /** RLS-subject app client — never the owner client. */
  prisma: PrismaClient;
  engine: EnrollEngine;
  publish: (event: EnrollEventInput) => Promise<void>;
  now?: () => Date;
}

export interface EnrollParams {
  workspaceId: string;
  agentId: string;
  contactId: string;
  senderId?: string;
  origin?: { kind: "manual" | "csv" | "list"; listId?: string; listName?: string };
  delayScale?: number;
}

export type EnrollOutcome =
  | {
      kind: "enrolled";
      enrollment: { id: string } & Record<string, unknown>;
      workflowId: string;
      workflowDeduped: boolean;
    }
  | { kind: "held"; holdId: string; reason: EnrollmentHoldReason }
  | { kind: "refused"; code: "CONTACT_INVALID"; message: string }
  | {
      kind: "error";
      code: "AGENT_NOT_FOUND" | "CONTACT_NOT_FOUND" | "NO_CAMPAIGN" | "NO_GRAPH" | "NO_SENDER";
      message: string;
    };

const dayStartUtc = (now: Date): Date => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

export async function enrollContact(deps: EnrollDeps, params: EnrollParams): Promise<EnrollOutcome> {
  const now = deps.now?.() ?? new Date();
  const { workspaceId } = params;

  const resolved = await withTenant(deps.prisma, { workspaceId }, async (tx) => {
    const [agent, contact, workspace] = await Promise.all([
      tx.agent.findUnique({ where: { id: params.agentId } }),
      tx.contact.findUnique({ where: { id: params.contactId } }),
      tx.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } }),
    ]);
    if (!agent) return { error: { code: "AGENT_NOT_FOUND" as const, message: `Agent ${params.agentId} not found` } };
    if (!contact) return { error: { code: "CONTACT_NOT_FOUND" as const, message: `Contact ${params.contactId} not found` } };

    // A5: one agent = one auto-created primary campaign (first by createdAt).
    const campaign = await tx.campaign.findFirst({
      where: { agentId: params.agentId },
      orderBy: { createdAt: "asc" },
    });
    if (!campaign) {
      return { error: { code: "NO_CAMPAIGN" as const, message: "Agent has no campaign — plan the campaign first (P1.4)" } };
    }
    const graphRow = await tx.campaignGraph.findFirst({
      where: { campaignId: campaign.id },
      orderBy: { version: "desc" },
    });
    if (!graphRow) {
      return { error: { code: "NO_GRAPH" as const, message: "Campaign has no graph yet — plan the campaign first (P1.4)" } };
    }
    const sender = params.senderId
      ? await tx.senderConnection.findUnique({ where: { id: params.senderId } })
      : await tx.senderConnection.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
    if (!sender || sender.status !== "ACTIVE") {
      return { error: { code: "NO_SENDER" as const, message: "No active sender connection — connect a sender in Settings first (P1.5)" } };
    }
    const prior = await tx.enrollment.findUnique({
      where: { campaignId_contactId: { campaignId: campaign.id, contactId: contact.id } },
    });
    const suppressed = contact.email
      ? Boolean(
          await tx.suppression.findFirst({
            where: { channel: "email", address: contact.email.toLowerCase() },
            select: { id: true },
          }),
        )
      : false;
    return { agent, contact, campaign, graphRow, sender, prior, suppressed, workspace };
  });
  if ("error" in resolved && resolved.error) {
    return { kind: "error", code: resolved.error.code, message: resolved.error.message };
  }
  if ("error" in resolved) throw new Error("unreachable: error branch without payload");
  const { contact, campaign, graphRow, sender, prior, suppressed, workspace } = resolved;

  // ── The gate (first-time entries only — a prior row keeps its semantics) ──
  if (!prior) {
    const verdict = (contact as { emailVerdict?: string }).emailVerdict ?? "unverified";
    const origin = params.origin?.kind ?? "manual";
    if (verdict === "invalid") {
      await refuseHold(deps, workspaceId, campaign.id, params, "CONTACT_INVALID");
      await deps.publish({
        type: "contact.enrollment_refused.v1",
        workspaceId,
        contactId: contact.id,
        campaignId: campaign.id,
        payload: {
          reason: "CONTACT_INVALID",
          detail: `email verdict invalid (${(contact as { emailVerdictSource?: string }).emailVerdictSource ?? "validation"})`,
          origin,
        },
      });
      return { kind: "refused", code: "CONTACT_INVALID", message: CONTACT_INVALID_MESSAGE };
    }
    if (verdict === "unverified" && !suppressed) {
      return holdOutcome(await upsertHold(deps, workspaceId, campaign.id, params, "unverified"));
    }
    if (verdict === "risky") {
      const policy = parseWorkspaceValidationSettings(workspace?.settings).riskyPolicy;
      if (policy === "hold") {
        return holdOutcome(await upsertHold(deps, workspaceId, campaign.id, params, "risky_held"));
      }
    }
    // Per-day-per-campaign enrollment cap (LH1 W3): verified entries today.
    if (campaign.enrollmentCapEnabled) {
      const cap = campaign.enrollmentDailyCap ?? ENROLLMENT_DAILY_CAP_DEFAULT;
      const enrolledToday = await withTenant(deps.prisma, { workspaceId }, (tx) =>
        tx.enrollment.count({
          where: {
            campaignId: campaign.id,
            createdAt: { gte: dayStartUtc(now) },
            contact: { emailVerdict: { in: ["valid", "risky"] } },
          },
        }),
      );
      if (enrolledToday >= cap) {
        return holdOutcome(await upsertHold(deps, workspaceId, campaign.id, params, "cap_overflow"));
      }
    }
  }

  // ── Enrollment create + durable start (pre-LH1 semantics, byte-preserved) ─
  const { enrollment, existed } = await withTenant(deps.prisma, { workspaceId }, async (tx) => {
    const id = prior?.id ?? randomUUID();
    const row =
      prior ??
      (await tx.enrollment.create({
        data: {
          id,
          workspaceId,
          campaignId: campaign.id,
          contactId: contact.id,
          workflowId: workflowIdFor(id),
          pipelineStage: "new",
          // The injectable clock stamps the row it also counts — the cap's
          // day window and the rows inside it can never disagree.
          createdAt: now,
          // 49-3 provenance + DEC-076 graph-version audit ride meta.
          meta: {
            ...(params.origin ? { origin: params.origin } : {}),
            graphVersion: graphRow.version,
          },
        },
      }));
    return { enrollment: row, existed: Boolean(prior) };
  });

  const { workflowId, deduped } = await deps.engine.start({
    workspaceId,
    enrollmentId: enrollment.id,
    campaignId: campaign.id,
    agentId: params.agentId,
    contactId: params.contactId,
    senderId: sender.id,
    // Validated at persist time (P1.4); re-validate on the way into the
    // engine so a hand-edited row can never start a broken run.
    graph: validateGraph(graphRow.graph) as CampaignGraph,
    graphVersion: graphRow.version,
    ...(params.delayScale && Number.isFinite(params.delayScale) && params.delayScale > 0
      ? { delayScale: params.delayScale }
      : {}),
  });

  // W3-4 (DEC-076): a RE-enroll whose prior run already closed starts a fresh
  // run pinned to the LATEST graph — restamp the audit. Deduped keeps the
  // open run's enrolled snapshot.
  let row = enrollment;
  if (existed && !deduped) {
    row = await withTenant(deps.prisma, { workspaceId }, async (tx) => {
      const fresh = await tx.enrollment.findUnique({ where: { id: enrollment.id }, select: { meta: true } });
      const freshMeta =
        typeof fresh?.meta === "object" && fresh.meta !== null ? (fresh.meta as Record<string, unknown>) : {};
      return tx.enrollment.update({
        where: { id: enrollment.id },
        data: { meta: { ...freshMeta, graphVersion: graphRow.version } },
      });
    });
  }
  // A released hold records the enrollment it became.
  await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.enrollmentHold.updateMany({
      where: { campaignId: campaign.id, contactId: contact.id, status: "pending" },
      data: { status: "released", enrollmentId: enrollment.id },
    }),
  );
  return { kind: "enrolled", enrollment: row, workflowId, workflowDeduped: deduped || existed };
}

const holdOutcome = (hold: EnrollmentHold): EnrollOutcome => ({
  kind: "held",
  holdId: hold.id,
  reason: hold.reason as EnrollmentHoldReason,
});

async function upsertHold(
  deps: EnrollDeps,
  workspaceId: string,
  campaignId: string,
  params: EnrollParams,
  reason: EnrollmentHoldReason,
): Promise<EnrollmentHold> {
  return withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.enrollmentHold.upsert({
      where: { campaignId_contactId: { campaignId, contactId: params.contactId } },
      create: {
        workspaceId,
        campaignId,
        agentId: params.agentId,
        contactId: params.contactId,
        senderId: params.senderId ?? null,
        origin: params.origin ?? undefined,
        reason,
      },
      // A re-attempt refreshes the reason and re-opens a refused hold — the
      // gate re-decides from the CURRENT verdict every time.
      update: { reason, status: "pending", refusalCode: null },
    }),
  );
}

async function refuseHold(
  deps: EnrollDeps,
  workspaceId: string,
  campaignId: string,
  params: EnrollParams,
  code: string,
): Promise<void> {
  await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.enrollmentHold.upsert({
      where: { campaignId_contactId: { campaignId, contactId: params.contactId } },
      create: {
        workspaceId,
        campaignId,
        agentId: params.agentId,
        contactId: params.contactId,
        senderId: params.senderId ?? null,
        origin: params.origin ?? undefined,
        reason: "unverified",
        status: "refused",
        refusalCode: code,
      },
      update: { status: "refused", refusalCode: code },
    }),
  );
}

export interface DrainDeps extends EnrollDeps {
  /** Self-heal: queue validation for an unverified held contact that has no
   *  pending batch (a manual add from before LH1, a lost job). Optional —
   *  absent in contexts without the queue. */
  enqueueValidation?: (workspaceId: string, contactId: string, email: string) => Promise<void>;
}

export interface DrainSummary {
  scanned: number;
  released: number;
  refused: number;
  capHeld: number;
  stillHeld: number;
}

/**
 * Drain pending holds for a workspace (optionally one campaign): re-run each
 * through the SAME gate, oldest first — contacts flow into the sequence
 * progressively as verdicts return, bounded by the daily cap (with the cap
 * this is natural throttling; a warming sender's cap is far lower than bulk
 * validation's clearance rate, so validation never becomes the felt
 * bottleneck). Never throws per-hold: a failing start leaves the hold
 * pending for the next pass.
 */
export async function drainEnrollmentHolds(
  deps: DrainDeps,
  scope: { workspaceId: string; campaignId?: string; limit?: number },
): Promise<DrainSummary> {
  const { workspaceId } = scope;
  const holds = await withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.enrollmentHold.findMany({
      where: { status: "pending", ...(scope.campaignId ? { campaignId: scope.campaignId } : {}) },
      orderBy: { requestedAt: "asc" },
      take: scope.limit ?? 500,
    }),
  );
  const summary: DrainSummary = { scanned: holds.length, released: 0, refused: 0, capHeld: 0, stillHeld: 0 };
  // Campaigns whose cap is exhausted this pass — skip their remaining holds
  // without burning a gate round-trip each.
  const capExhausted = new Set<string>();
  for (const hold of holds) {
    if (capExhausted.has(hold.campaignId)) {
      summary.capHeld += 1;
      continue;
    }
    try {
      const contact = await withTenant(deps.prisma, { workspaceId }, (tx) =>
        tx.contact.findUnique({
          where: { id: hold.contactId },
          select: { id: true, email: true, emailVerdict: true },
        }),
      );
      if (!contact) {
        summary.stillHeld += 1;
        continue;
      }
      if (contact.emailVerdict === "unverified" && contact.email) {
        const address = contact.email.toLowerCase();
        const [suppressed, pendingItem] = await withTenant(deps.prisma, { workspaceId }, (tx) =>
          Promise.all([
            tx.suppression.findFirst({ where: { channel: "email", address }, select: { id: true } }),
            tx.validationBatchItem.findFirst({
              where: { contactId: hold.contactId, outcome: "pending" },
              select: { id: true },
            }),
          ]),
        );
        if (!suppressed) {
          // Still waiting on a verdict — self-heal a missing batch, stay held.
          if (!pendingItem && deps.enqueueValidation) {
            await deps.enqueueValidation(workspaceId, contact.id, address);
          }
          summary.stillHeld += 1;
          continue;
        }
        // Suppressed + unverified: pre-LH1 parity — the gate enrolls it and
        // the boundary's suppression rail refuses the send (amber row).
      }
      const origin =
        hold.origin && typeof hold.origin === "object" && !Array.isArray(hold.origin)
          ? (hold.origin as EnrollParams["origin"])
          : undefined;
      const outcome = await enrollContact(deps, {
        workspaceId,
        agentId: hold.agentId,
        contactId: hold.contactId,
        ...(hold.senderId ? { senderId: hold.senderId } : {}),
        ...(origin ? { origin } : {}),
      });
      if (outcome.kind === "enrolled") summary.released += 1;
      else if (outcome.kind === "refused") summary.refused += 1;
      else if (outcome.kind === "held" && outcome.reason === "cap_overflow") {
        summary.capHeld += 1;
        capExhausted.add(hold.campaignId);
      } else summary.stillHeld += 1;
    } catch (err) {
      // Engine unavailable / transient failure — the hold stays pending and
      // the next sweep retries. Never a silent drop, never a crash.
      summary.stillHeld += 1;
      console.error(`[enroll-drain] hold ${hold.id} deferred: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
