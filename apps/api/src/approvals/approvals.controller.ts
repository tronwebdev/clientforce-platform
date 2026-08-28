/**
 * B3d (DEC-122): the ONE approvals queue — everything waiting on a human
 * tap, typed. Three item sources, one read:
 *
 *  - PENDING Approval rows (level-1 step parks now; budget/branch kinds when
 *    their emitters exist) — decided HERE (approve releases the parked
 *    workflow; dismiss ends that enrollment path visibly);
 *  - campaign proposals — DRAFT agents carrying an undismissed suggestion
 *    (B2.6): approve = Start (the create flow resumes them), dismiss = the
 *    shipped dismissSuggestion PATCH — both stay on their own endpoints;
 *  - reply items — needs-reply threads where Ada can draft (B3b): approve =
 *    draft + send, edit = the composer, dismiss = mark handled — all on the
 *    shipped inbox endpoints.
 *
 * Derived items are NEVER duplicated into Approval rows (one source of
 * truth each); this controller decides only the rows it owns.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { agentSuggestionSchema } from "@clientforce/core";
import { Role } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { assembleInboxThreads } from "../agents/inbox-threads";

export interface ApprovalQueueItem {
  /** step_send | step_call | budget_move | branch_start | campaign_proposal | reply_draft */
  kind: string;
  /** Approval-row id for row-backed items; null for derived ones. */
  approvalId: string | null;
  agentId: string;
  campaignId: string | null;
  contactId: string | null;
  contactName: string | null;
  /** The provenance line the queue renders. */
  reason: string;
  createdAt: string;
  /** Derived reply items carry the thread pointer for edit/dismiss. */
  enrollmentId?: string | null;
  intent?: string | null;
}

@Controller("approvals")
export class ApprovalsController {
  constructor(private readonly tenant: TenantClient) {}

  /** The unified queue — optionally scoped to one campaign (agentId). */
  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async list(@Query("agentId") agentId?: string) {
    return this.tenant.run(async (tx) => {
      const items: ApprovalQueueItem[] = [];

      // 1) Row-backed parks.
      const rows = await tx.approval.findMany({
        where: { status: "PENDING", ...(agentId ? { agentId } : {}) },
        orderBy: { createdAt: "asc" },
      });
      const contactIds = [...new Set(rows.map((r) => r.contactId).filter((v): v is string => !!v))];
      const contacts = await tx.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      });
      const nameOf = new Map(
        contacts.map((c) => [
          c.id,
          [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unknown",
        ]),
      );
      for (const r of rows) {
        items.push({
          kind: r.kind,
          approvalId: r.id,
          agentId: r.agentId,
          campaignId: r.campaignId,
          contactId: r.contactId,
          contactName: r.contactId ? (nameOf.get(r.contactId) ?? null) : null,
          reason: r.reason,
          createdAt: r.createdAt.toISOString(),
          enrollmentId: r.enrollmentId,
        });
      }

      // 2) Campaign proposals (workspace-level — a proposal has no campaign
      //    yet, so a campaign-scoped read skips them).
      if (!agentId) {
        const drafts = await tx.agent.findMany({
          where: { status: "DRAFT", suggestion: { not: { equals: null } } },
          orderBy: { createdAt: "asc" },
        });
        for (const d of drafts) {
          const parsed = agentSuggestionSchema.safeParse(d.suggestion);
          if (!parsed.success || parsed.data.dismissedAt) continue;
          items.push({
            kind: "campaign_proposal",
            approvalId: null,
            agentId: d.id,
            campaignId: null,
            contactId: null,
            contactName: null,
            reason: parsed.data.reason,
            createdAt: d.createdAt.toISOString(),
          });
        }
      }

      // 3) Reply items — needs-reply threads (unread, not handled, not
      //    snoozed): Ada can draft; the human decides.
      const campaigns = await tx.campaign.findMany({
        where: agentId ? { agentId } : {},
        orderBy: { createdAt: "asc" },
        include: { agent: { select: { name: true } } },
      });
      const threads = await assembleInboxThreads(
        tx,
        campaigns.map((c) => ({ id: c.id, name: c.name, agentId: c.agentId, agentName: c.agent.name })),
      );
      const now = new Date().toISOString();
      for (const t of threads) {
        if (!t || !t.unread || t.done) continue;
        if (t.snoozedUntil && t.snoozedUntil > now) continue;
        const who =
          [t.contact?.firstName, t.contact?.lastName].filter(Boolean).join(" ") ||
          t.contact?.email ||
          "Unknown";
        items.push({
          kind: "reply_draft",
          approvalId: null,
          agentId: t.campaign.agentId,
          campaignId: t.campaign.id,
          contactId: t.contactId,
          contactName: who,
          reason: `${who} replied — “${t.preview.slice(0, 90)}”`,
          createdAt: t.lastAt,
          intent: t.intent,
        });
      }

      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { items };
    });
  }

  /** Decide a ROW-backed item. Derived items decide on their own endpoints. */
  @Post(":id/decide")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async decide(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: { decision?: unknown },
  ) {
    const decision = body?.decision;
    if (decision !== "approved" && decision !== "dismissed") {
      throw new BadRequestException("decision must be \"approved\" or \"dismissed\"");
    }
    return this.tenant.run(async (tx) => {
      const row = await tx.approval.findUnique({ where: { id } });
      if (!row) throw new NotFoundException(`Approval ${id} not found`);
      if (row.status !== "PENDING") return row; // already decided — idempotent read-back
      const updated = await tx.approval.update({
        where: { id },
        data: {
          status: decision === "approved" ? "APPROVED" : "DISMISSED",
          decidedById: req.auth?.user.id ?? null,
          decidedAt: new Date(),
        },
      });
      await tx.event.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          campaignId: row.campaignId,
          contactId: row.contactId,
          enrollmentId: row.enrollmentId,
          type: EVENT_TYPES.APPROVAL_DECIDED,
          payload: {
            approvalId: row.id,
            kind: row.kind,
            decision,
            byUserId: req.auth?.user.id,
          },
        },
      });
      return updated;
    });
  }
}
