import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  BackofficeAgencyRow,
  BackofficeAuditRow,
  BackofficeWorkspaceRow,
  TenantStatusName,
} from "@clientforce/core";
import type { Prisma } from "@clientforce/db";
import { BackofficeDb } from "./backoffice-db.service";
import type { BackofficeStaffContext } from "./request";

type SuspendableStatus = "ACTIVE" | "SUSPENDED";

/**
 * All backoffice business logic. Every mutation runs in a transaction that also
 * writes exactly one `BackofficeAuditLog` row (operator, action, target, reason)
 * — the audit trail is never optional. Reads and writes go through the
 * RLS-exempt `BackofficeDb` client; nothing here touches the tenant client.
 */
@Injectable()
export class BackofficeService {
  constructor(private readonly db: BackofficeDb) {}

  private get prisma() {
    return this.db.client;
  }

  /** Agencies (+ their workspaces) with plan, status, created, last activity. */
  async listAgencies(filter: { q?: string; status?: TenantStatusName }): Promise<BackofficeAgencyRow[]> {
    const where: Prisma.AgencyWhereInput = {};
    if (filter.status) where.status = filter.status;
    if (filter.q) {
      const contains = { contains: filter.q, mode: "insensitive" as const };
      where.OR = [
        { name: contains },
        { slug: contains },
        { workspaces: { some: { OR: [{ name: contains }, { slug: contains }] } } },
      ];
    }

    const agencies = await this.prisma.agency.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { workspaces: { orderBy: { createdAt: "asc" } } },
    });

    // "Last activity" = the newest event on the workspace (the event ledger is
    // the backbone). One grouped query for every workspace in the result set.
    const workspaceIds = agencies.flatMap((a) => a.workspaces.map((w) => w.id));
    const activity = workspaceIds.length
      ? await this.prisma.event.groupBy({
          by: ["workspaceId"],
          where: { workspaceId: { in: workspaceIds } },
          _max: { occurredAt: true },
        })
      : [];
    const lastByWorkspace = new Map(activity.map((r) => [r.workspaceId, r._max.occurredAt]));

    return agencies.map((a) => {
      const workspaces: BackofficeWorkspaceRow[] = a.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        status: w.status as TenantStatusName,
        creditBalance: w.creditBalance,
        createdAt: w.createdAt.toISOString(),
        lastActivityAt: lastByWorkspace.get(w.id)?.toISOString() ?? null,
      }));
      const agencyLastActivity = workspaces
        .map((w) => w.lastActivityAt)
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null;
      return {
        id: a.id,
        name: a.name,
        slug: a.slug,
        planTier: a.planTier,
        status: a.status as TenantStatusName,
        createdAt: a.createdAt.toISOString(),
        lastActivityAt: agencyLastActivity,
        workspaces,
      };
    });
  }

  /** Suspend/reactivate an agency (typed, reversible, audited). */
  async setAgencyStatus(
    operator: BackofficeStaffContext,
    agencyId: string,
    status: SuspendableStatus,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const agency = await tx.agency.findUnique({ where: { id: agencyId } });
      if (!agency) throw new NotFoundException("Agency not found");
      const before = agency.status;
      await this.audit(tx, operator, {
        action: status === "SUSPENDED" ? "agency.suspend" : "agency.reactivate",
        targetType: "agency",
        targetId: agencyId,
        reason,
        metadata: { before, after: status },
      });
      return tx.agency.update({ where: { id: agencyId }, data: { status } });
    });
  }

  /** Suspend/reactivate a single workspace (typed, reversible, audited). */
  async setWorkspaceStatus(
    operator: BackofficeStaffContext,
    workspaceId: string,
    status: SuspendableStatus,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!ws) throw new NotFoundException("Workspace not found");
      const before = ws.status;
      await this.audit(tx, operator, {
        action: status === "SUSPENDED" ? "workspace.suspend" : "workspace.reactivate",
        targetType: "workspace",
        targetId: workspaceId,
        reason,
        metadata: { before, after: status },
      });
      return tx.workspace.update({ where: { id: workspaceId }, data: { status } });
    });
  }

  /**
   * A manual credit adjustment: one append-only `CreditLedger` row + the cached
   * `Workspace.creditBalance` moved to match + one audit row, atomically. The
   * ledger row's `refId` links back to the audit row for traceability. Operator
   * overrides may push a balance negative deliberately — that is logged, not
   * blocked (a floor is a later billing-enforcement concern).
   */
  async adjustCredit(
    operator: BackofficeStaffContext,
    workspaceId: string,
    delta: number,
    reason: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!ws) throw new NotFoundException("Workspace not found");
      const balanceAfter = ws.creditBalance + delta;
      const audit = await this.audit(tx, operator, {
        action: "workspace.credit.adjust",
        targetType: "workspace",
        targetId: workspaceId,
        reason,
        metadata: { delta, balanceBefore: ws.creditBalance, balanceAfter },
      });
      const entry = await tx.creditLedger.create({
        data: { workspaceId, delta, reason, refId: audit.id, balanceAfter },
      });
      await tx.workspace.update({ where: { id: workspaceId }, data: { creditBalance: balanceAfter } });
      return { entry, balanceAfter, auditId: audit.id };
    });
  }

  /** Recent ledger rows for one workspace (newest first). */
  recentLedger(workspaceId: string, limit = 50) {
    return this.prisma.creditLedger.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
    });
  }

  /** The audit trail (optionally filtered to one target), newest first. */
  async listAudit(filter: { targetType?: string; targetId?: string; limit?: number }): Promise<
    BackofficeAuditRow[]
  > {
    const rows = await this.prisma.backofficeAuditLog.findMany({
      where: {
        ...(filter.targetType ? { targetType: filter.targetType } : {}),
        ...(filter.targetId ? { targetId: filter.targetId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(filter.limit ?? 100, 500),
    });
    return rows.map((r) => ({
      id: r.id,
      operatorEmail: r.operatorEmail,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      reason: r.reason,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Write one append-only audit row inside the caller's transaction. */
  private audit(
    tx: Prisma.TransactionClient,
    operator: BackofficeStaffContext,
    row: {
      action: string;
      targetType: string;
      targetId: string;
      reason?: string | null;
      metadata?: Prisma.InputJsonValue;
    },
  ) {
    return tx.backofficeAuditLog.create({
      data: {
        operatorId: operator.id,
        operatorEmail: operator.email,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        reason: row.reason ?? null,
        ...(row.metadata !== undefined ? { metadata: row.metadata } : {}),
      },
    });
  }
}
