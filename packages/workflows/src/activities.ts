/**
 * CampaignWorkflow activities (P1.6) — the host-side effects. All DB access is
 * tenant-scoped through `withTenant` (RLS-subject client). The send activity
 * is idempotent by `(enrollmentId, stepNodeId)` against persisted Message rows,
 * so a retried activity can never double-send.
 */
import { ApplicationFailure } from "@temporalio/common";
import {
  ComposeRefusedError,
  sendSmsStep,
  sendStep,
  SendBlockedError,
  type EmailSender,
  type SmsSender,
  type SmsStepComposer,
} from "@clientforce/channels";
import { goalTerminalLabel, parseGuardrails, type StepBrief, type StepContent } from "@clientforce/core";
import { withTenant, type Prisma, type PrismaClient } from "@clientforce/db";
import type { SendOutcome } from "./shared";

export interface ActivityDeps {
  /** RLS-subject client (`createAppPrismaClient`) — never the owner client. */
  prisma: PrismaClient;
  transport: EmailSender;
  /** P2.1 (DEC-061): the SMS transport; absent → sms steps refuse (typed). */
  smsTransport?: SmsSender;
  /** DEC-063: sms allow-list (CHANNELS_SMS_ALLOWLIST resolved by the boundary when omitted). */
  smsAllowlist?: string[];
  /**
   * G1 (DEC-070): the guided-sms composer seam (`createSmsStepComposer` in
   * the worker, prompt-driven fake in tests). Absent → guided steps refuse
   * with the typed COMPOSER_UNCONFIGURED reason (honest absence, the
   * smsTransport pattern) — never a silent skip.
   */
  composeSms?: SmsStepComposer;
  /**
   * G1: persists + fans out one catalog event (the refusal writes
   * `sms.compose_refused.v1` — the Logs tab's amber row). Optional so tests
   * and bus-less environments stay wired-free; the enrollment pause persists
   * regardless.
   */
  publishComposeRefused?: (event: {
    workspaceId: string;
    enrollmentId: string;
    contactId: string;
    campaignId: string;
    stepNodeId: string;
    reason: string;
    detail?: string;
  }) => Promise<void>;
  /** Injectable clock (send-window tests). */
  now?: () => Date;
  /** §G allow-list override; resolves from CHANNELS_ALLOWLIST when omitted. */
  allowlist?: string[];
  /**
   * P1.7: pipeline moves publish `lead.stage_changed.v1` on the event bus —
   * the Logs feed and automations see every stage transition. Optional so
   * tests and bus-less environments stay wired-free; failures are logged,
   * never allowed to fail the workflow's progress.
   */
  publishStageChanged?: (change: {
    workspaceId: string;
    enrollmentId: string;
    contactId: string;
    campaignId: string;
    fromStage: string;
    toStage: string;
    /** C2.9 (DEC-059): set on goal-completion moves — UIs render `label` verbatim. */
    goalKey?: string;
    label?: string;
  }) => Promise<void>;
}

interface EnrollmentScope {
  workspaceId: string;
  enrollmentId: string;
}

/** Enrollment.meta shape — the Logs tab's amber-row source (owner edit 2026-07-04). */
interface EnrollmentMeta {
  blocked?: { nodeId: string; reason: string; detail: string; at: string };
  events?: Array<{ nodeId: string; kind: string; detail: string; at: string }>;
}

const asMeta = (value: Prisma.JsonValue | null | undefined): EnrollmentMeta =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as EnrollmentMeta) : {};

export function createActivities(deps: ActivityDeps) {
  const { prisma, transport } = deps;

  async function mergeMeta(
    scope: EnrollmentScope,
    merge: (meta: EnrollmentMeta) => EnrollmentMeta,
    data: Omit<Prisma.EnrollmentUpdateInput, "meta"> = {},
  ): Promise<void> {
    await withTenant(prisma, { workspaceId: scope.workspaceId }, async (tx) => {
      const enrollment = await tx.enrollment.findUnique({ where: { id: scope.enrollmentId } });
      if (!enrollment) throw new Error(`Enrollment ${scope.enrollmentId} not found`);
      await tx.enrollment.update({
        where: { id: scope.enrollmentId },
        data: { ...data, meta: merge(asMeta(enrollment.meta)) as Prisma.InputJsonValue },
      });
    });
  }

  return {
    /**
     * Send one graph step through the FULL P1.5 boundary. Idempotent: an
     * existing OUTBOUND Message for this (enrollment, stepNode) short-circuits
     * to a duplicate outcome — retries and workflow replays never double-send.
     * A SendBlockedError becomes a NON-RETRYABLE failure the workflow handles.
     */
    async sendEnrollmentStep(params: {
      workspaceId: string;
      enrollmentId: string;
      campaignId: string;
      agentId: string;
      contactId: string;
      senderId: string;
      stepNodeId: string;
      content: StepContent;
      /** P2.1: the step node's channel — "email" (default) or "sms". */
      channel?: string;
      /** G1 (DEC-070): the step node's mode — absent = scripted. */
      mode?: "scripted" | "guided";
      /** G1: the guided step's brief (present exactly when mode is guided). */
      brief?: StepBrief;
      /** G1: the graph version the brief came from (Message.meta provenance). */
      graphVersion?: number | null;
    }): Promise<SendOutcome> {
      const existing = await withTenant(prisma, { workspaceId: params.workspaceId }, (tx) =>
        tx.message.findFirst({
          where: {
            workspaceId: params.workspaceId,
            enrollmentId: params.enrollmentId,
            stepNodeId: params.stepNodeId,
            direction: "OUTBOUND",
          },
        }),
      );
      if (existing) {
        return {
          kind: "duplicate",
          messageId: existing.id,
          providerMessageId: existing.providerMessageId,
        };
      }
      try {
        let message;
        if (params.channel === "sms") {
          // P2.1 (DEC-061): sms steps resolve the workspace's ACTIVE Twilio
          // sender themselves — the enrollment's senderId is the EMAIL sender.
          if (!deps.smsTransport) {
            throw new SendBlockedError("SENDER_NOT_SMS", "no sms transport configured");
          }
          const smsSender = await withTenant(prisma, { workspaceId: params.workspaceId }, (tx) =>
            tx.senderConnection.findFirst({ where: { type: "TWILIO_SMS", status: "ACTIVE" } }),
          );
          if (!smsSender) throw new SendBlockedError("SENDER_NOT_SMS", "no active TWILIO_SMS sender");

          // G1 (DEC-070): a guided step composes per lead BEFORE the boundary
          // — the rails below neither know nor care who wrote the copy. Runs
          // after the idempotency check so replays never re-spend a model call.
          let content = params.content;
          let composed: { mode: "guided"; briefVersion: number | null; composerVersion: string } | undefined;
          if (params.mode === "guided") {
            if (!params.brief) {
              throw new ComposeRefusedError(
                "COMPOSER_UNCONFIGURED",
                `guided step ${params.stepNodeId} carries no brief — graphs are validated at persist time`,
              );
            }
            if (!deps.composeSms) {
              throw new ComposeRefusedError(
                "COMPOSER_UNCONFIGURED",
                "no composer configured on this worker (ANTHROPIC_API_KEY absent)",
              );
            }
            const result = await deps.composeSms({
              workspaceId: params.workspaceId,
              agentId: params.agentId,
              campaignId: params.campaignId,
              contactId: params.contactId,
              enrollmentId: params.enrollmentId,
              stepNodeId: params.stepNodeId,
              brief: params.brief,
            });
            content = { body: result.body };
            composed = {
              mode: "guided",
              briefVersion: params.graphVersion ?? null,
              composerVersion: result.composerVersion,
            };
          }
          message = await sendSmsStep(
            { prisma, transport: deps.smsTransport, now: deps.now, allowlist: deps.smsAllowlist },
            {
              workspaceId: params.workspaceId,
              campaignId: params.campaignId,
              agentId: params.agentId,
              enrollmentId: params.enrollmentId,
              contactId: params.contactId,
              senderId: smsSender.id,
              stepNodeId: params.stepNodeId,
              content,
              ...(composed ? { composed } : {}),
            },
          );
        } else {
          message = await sendStep(
            { prisma, transport, now: deps.now, allowlist: deps.allowlist },
            {
              workspaceId: params.workspaceId,
              campaignId: params.campaignId,
              agentId: params.agentId,
              enrollmentId: params.enrollmentId,
              contactId: params.contactId,
              senderId: params.senderId,
              stepNodeId: params.stepNodeId,
              content: params.content,
            },
          );
        }
        return { kind: "sent", messageId: message.id, providerMessageId: message.providerMessageId };
      } catch (err) {
        if (err instanceof SendBlockedError) {
          throw ApplicationFailure.create({
            type: "SendBlockedError",
            nonRetryable: true,
            message: err.message,
            details: [{ reason: err.reason, detail: err.message }],
          });
        }
        // G1: a check-refusal is a decision, not an outage — never retried
        // (infra/model errors are NOT this type; they keep normal retries).
        if (err instanceof ComposeRefusedError) {
          throw ApplicationFailure.create({
            type: "ComposeRefusedError",
            nonRetryable: true,
            message: err.message,
            details: [{ reason: err.reason, detail: err.detail }],
          });
        }
        throw err;
      }
    },

    /** Persist live position (+ optional pipeline-stage move) — A4 polling reads this. */
    async updateEnrollmentProgress(params: {
      workspaceId: string;
      enrollmentId: string;
      currentNode: string;
      pipelineStage?: string;
    }): Promise<void> {
      const prior = await withTenant(prisma, { workspaceId: params.workspaceId }, async (tx) => {
        const row = await tx.enrollment.findUniqueOrThrow({
          where: { id: params.enrollmentId },
          include: { campaign: { select: { agent: { select: { goal: true, guardrails: true } } } } },
        });
        await tx.enrollment.update({
          where: { id: params.enrollmentId },
          data: {
            currentNode: params.currentNode,
            ...(params.pipelineStage ? { pipelineStage: params.pipelineStage } : {}),
          },
        });
        return row;
      });
      const moved =
        params.pipelineStage !== undefined && params.pipelineStage !== prior.pipelineStage;
      if (moved && deps.publishStageChanged) {
        // C2.9: goal-completion moves carry the campaign goal + terminal label.
        let goal: { goalKey: string; label: string } | undefined;
        if (params.pipelineStage === "booked") {
          let customLabel: string | undefined;
          try {
            customLabel = parseGuardrails(prior.campaign.agent.guardrails).goalLabel;
          } catch {
            customLabel = undefined; // legacy/invalid guardrails never block the move
          }
          goal = {
            goalKey: prior.campaign.agent.goal,
            label: goalTerminalLabel(prior.campaign.agent.goal, customLabel),
          };
        }
        await deps
          .publishStageChanged({
            workspaceId: params.workspaceId,
            enrollmentId: params.enrollmentId,
            contactId: prior.contactId,
            campaignId: prior.campaignId,
            fromStage: prior.pipelineStage,
            toStage: params.pipelineStage!,
            ...(goal ?? {}),
          })
          .catch((err: unknown) => {
            console.warn(
              `[workflows] lead.stage_changed publish failed for ${params.enrollmentId}: ` +
                `${err instanceof Error ? err.message : String(err)} — progress persisted regardless`,
            );
          });
      }
    },

    /**
     * A send-boundary refusal ended this path. USER-VISIBLE data (the Logs tab
     * renders it as an amber row), not just a server log. Suppression/opt-out
     * refusals mark the enrollment UNSUBSCRIBED; anything else pauses it for a
     * human to look at.
     */
    async recordEnrollmentBlocked(params: {
      workspaceId: string;
      enrollmentId: string;
      nodeId: string;
      reason: string;
      detail: string;
    }): Promise<void> {
      const status =
        params.reason === "SUPPRESSED" || params.reason === "OPTED_OUT"
          ? ("UNSUBSCRIBED" as const)
          : ("PAUSED" as const);
      await mergeMeta(
        params,
        (meta) => ({
          ...meta,
          blocked: {
            nodeId: params.nodeId,
            reason: params.reason,
            detail: params.detail,
            at: new Date().toISOString(),
          },
        }),
        { status, currentNode: params.nodeId },
      );
    },

    /**
     * G1 (DEC-070): the composer refused after its bounded retry — pause THAT
     * lead's enrollment with the typed reason (user-visible on the Logs tab
     * via `Enrollment.meta.blocked`) AND write the `sms.compose_refused.v1`
     * Event row (amber Logs row). Never a silent skip: other leads on the
     * same step keep composing/sending.
     */
    async recordComposeRefused(params: {
      workspaceId: string;
      enrollmentId: string;
      contactId: string;
      campaignId: string;
      nodeId: string;
      reason: string;
      detail: string;
    }): Promise<void> {
      await mergeMeta(
        params,
        (meta) => ({
          ...meta,
          blocked: {
            nodeId: params.nodeId,
            reason: params.reason,
            detail: params.detail,
            at: new Date().toISOString(),
          },
        }),
        { status: "PAUSED", currentNode: params.nodeId },
      );
      if (deps.publishComposeRefused) {
        await deps
          .publishComposeRefused({
            workspaceId: params.workspaceId,
            enrollmentId: params.enrollmentId,
            contactId: params.contactId,
            campaignId: params.campaignId,
            stepNodeId: params.nodeId,
            reason: params.reason,
            detail: params.detail,
          })
          .catch((err: unknown) => {
            console.warn(
              `[workflows] sms.compose_refused publish failed for ${params.enrollmentId}: ` +
                `${err instanceof Error ? err.message : String(err)} — pause persisted regardless`,
            );
          });
      }
    },

    /** Append a non-send event (branch routing, deferred actions) to the audit trail. */
    async recordIntendedAction(params: {
      workspaceId: string;
      enrollmentId: string;
      nodeId: string;
      kind: string;
      detail: string;
    }): Promise<void> {
      await mergeMeta(params, (meta) => ({
        ...meta,
        events: [
          ...(meta.events ?? []),
          {
            nodeId: params.nodeId,
            kind: params.kind,
            detail: params.detail,
            at: new Date().toISOString(),
          },
        ],
      }));
    },

    /** Terminal node reached — the enrollment is DONE. */
    async completeEnrollment(params: {
      workspaceId: string;
      enrollmentId: string;
      nodeId: string;
    }): Promise<void> {
      await withTenant(prisma, { workspaceId: params.workspaceId }, (tx) =>
        tx.enrollment.update({
          where: { id: params.enrollmentId },
          data: { status: "DONE", currentNode: params.nodeId },
        }),
      );
    },
  };
}

export type CampaignActivities = ReturnType<typeof createActivities>;
