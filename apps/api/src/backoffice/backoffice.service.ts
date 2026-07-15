import { Injectable, NotFoundException } from "@nestjs/common";
import {
  resolveCreditPrice,
  type BackofficeAgencyRow,
  type BackofficeAuditRow,
  type BackofficeWorkspaceRow,
  type CreditPriceUpsertDto,
  type ReconciliationQueryDto,
  type ReconciliationRow,
  type TenantStatusName,
  type UsageQueryDto,
  type UsageRollup,
} from "@clientforce/core";
import type { Prisma } from "@clientforce/db";
import { BackofficeDb } from "./backoffice-db.service";
import type { BackofficeStaffContext } from "./request";

/** Which of our metered signals backs each provider/metric (null = not metered). */
type MeteredMetric = "email_sends" | "sms_segments" | "voice_minutes";
const METERED: Record<string, MeteredMetric> = {
  email_sends: "email_sends",
  sms_segments: "sms_segments",
  voice_minutes: "voice_minutes",
};

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

  // ── B1 W2 (DEC-080): usage · reconciliation · credit-price editor ──────────

  /** Per-tenant consumption, on-demand from the event + credit ledgers. */
  async usage(q: UsageQueryDto): Promise<UsageRollup> {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    const workspaceIds =
      q.scope === "workspace"
        ? [q.id]
        : (await this.prisma.workspace.findMany({ where: { agencyId: q.id }, select: { id: true } })).map(
            (w) => w.id,
          );
    if (workspaceIds.length === 0) throw new NotFoundException("No workspaces for that scope");

    const [sends, calls, ledger] = await Promise.all([
      this.prisma.message.groupBy({
        by: ["channel"],
        where: { workspaceId: { in: workspaceIds }, direction: "OUTBOUND", sentAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      this.prisma.event.findMany({
        where: { workspaceId: { in: workspaceIds }, type: "call.completed.v1", occurredAt: { gte: from, lte: to } },
        select: { payload: true },
      }),
      this.prisma.creditLedger.findMany({
        where: { workspaceId: { in: workspaceIds }, createdAt: { gte: from, lte: to } },
        select: { delta: true },
      }),
    ]);

    const sendsByChannel: Record<string, number> = {};
    for (const s of sends) sendsByChannel[s.channel] = s._count._all;
    const voiceSeconds = calls.reduce((sum, e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return sum + (typeof p.durationSec === "number" ? p.durationSec : 0);
    }, 0);
    const creditBurn = ledger.filter((l) => l.delta < 0).reduce((s, l) => s - l.delta, 0);
    const creditGranted = ledger.filter((l) => l.delta > 0).reduce((s, l) => s + l.delta, 0);
    const signals = Object.values(sendsByChannel).reduce((a, b) => a + b, 0) + calls.length + ledger.length;

    return {
      scope: q.scope,
      id: q.id,
      from: from.toISOString(),
      to: to.toISOString(),
      sendsByChannel,
      voiceMinutes: Math.round(voiceSeconds / 60),
      creditBurn,
      creditGranted,
      aiSpendCredits: null, // honest absence — AI spend is not metered yet
      lowData: signals < 5,
    };
  }

  /** Our metered usage vs the seeded provider invoices, per provider per month. */
  async reconciliation(q: ReconciliationQueryDto): Promise<ReconciliationRow[]> {
    const invoices = await this.prisma.providerInvoice.findMany({
      where: q.provider ? { provider: q.provider } : {},
      orderBy: { periodStart: "desc" },
    });
    const rows: ReconciliationRow[] = [];
    for (const inv of invoices) {
      const month = inv.periodStart.toISOString().slice(0, 7);
      if (q.month && month !== q.month) continue;
      const metered = await this.meteredUsage(inv.metric, inv.periodStart, inv.periodEnd);
      if (metered === null) {
        // We don't meter this metric yet — reconcile honestly as "not metered".
        rows.push({
          provider: inv.provider,
          metric: inv.metric,
          month,
          meteredQuantity: null,
          invoiceQuantity: inv.quantity,
          invoiceAmount: inv.amount,
          variance: null,
          variancePct: null,
          matchesInvoice: null,
        });
        continue;
      }
      const variance = metered - inv.quantity;
      rows.push({
        provider: inv.provider,
        metric: inv.metric,
        month,
        meteredQuantity: metered,
        invoiceQuantity: inv.quantity,
        invoiceAmount: inv.amount,
        variance,
        variancePct: inv.quantity !== 0 ? Math.round((variance / inv.quantity) * 1000) / 10 : null,
        matchesInvoice: variance === 0,
      });
    }
    return rows;
  }

  /** The metered quantity for a reconciliation metric in a period (null = not metered). */
  private async meteredUsage(metric: string, start: Date, end: Date): Promise<number | null> {
    const kind = METERED[metric];
    if (!kind) return null;
    if (kind === "voice_minutes") {
      const calls = await this.prisma.event.findMany({
        where: { type: "call.completed.v1", occurredAt: { gte: start, lte: end } },
        select: { payload: true },
      });
      const seconds = calls.reduce((sum, e) => {
        const p = (e.payload ?? {}) as Record<string, unknown>;
        return sum + (typeof p.durationSec === "number" ? p.durationSec : 0);
      }, 0);
      return Math.round(seconds / 60);
    }
    const channel = kind === "email_sends" ? "email" : "sms";
    return this.prisma.message.count({
      where: { direction: "OUTBOUND", channel, sentAt: { gte: start, lte: end } },
    });
  }

  /** Effective credit prices (defaults + optional agency overrides) + full history. */
  async listCreditPrices(agencyId?: string) {
    const rows = await this.prisma.creditPrice.findMany({
      where: agencyId ? { OR: [{ agencyId }, { agencyId: null }] } : {},
      orderBy: [{ action: "asc" }, { effectiveFrom: "desc" }],
    });
    const priceRows = rows.map((r) => ({
      agencyId: r.agencyId,
      action: r.action,
      credits: r.credits,
      effectiveFrom: r.effectiveFrom,
    }));
    const actions = [...new Set(rows.map((r) => r.action))].sort();
    const effective = actions.map((action) => ({
      action,
      credits: resolveCreditPrice(priceRows, { agencyId: agencyId ?? null, action }),
    }));
    return { agencyId: agencyId ?? null, effective, history: rows };
  }

  /** Append an effective-dated credit price (audited); never updates in place. */
  async setCreditPrice(operator: BackofficeStaffContext, dto: CreditPriceUpsertDto) {
    const agencyId = dto.agencyId ?? null;
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();
    return this.prisma.$transaction(async (tx) => {
      const prior = await tx.creditPrice.findFirst({
        where: { agencyId, action: dto.action },
        orderBy: { effectiveFrom: "desc" },
      });
      const created = await tx.creditPrice.create({
        data: { agencyId, action: dto.action, credits: dto.credits, effectiveFrom },
      });
      await this.audit(tx, operator, {
        action: "price.set",
        targetType: agencyId ? "agency" : "platform",
        targetId: agencyId ?? "platform",
        metadata: {
          action: dto.action,
          credits: dto.credits,
          priorCredits: prior?.credits ?? null,
          effectiveFrom: effectiveFrom.toISOString(),
        },
      });
      return created;
    });
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
