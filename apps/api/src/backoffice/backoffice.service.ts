import { Injectable, NotFoundException } from "@nestjs/common";
import { loadConfig } from "@clientforce/ai";
import {
  CLASSIFY_PROMPT_NAME,
  CLASSIFY_PROMPT_VERSION,
  COMPOSER_EMAIL_PROMPT_NAME,
  COMPOSER_EMAIL_PROMPT_VERSION,
  COMPOSER_PROMPT_NAME,
  COMPOSER_PROMPT_VERSION,
} from "@clientforce/channels";
import {
  resolveCreditPrice,
  type AdoptionQueryDto,
  type AdoptionSummary,
  type BackofficeAgencyRow,
  type BackofficeAuditRow,
  type BackofficeWorkspaceRow,
  type CreditPriceUpsertDto,
  type FeatureFlagRow,
  type FeatureFlagSetDto,
  type FleetHealthView,
  type FunnelStep,
  type ImpersonateDto,
  type ImpersonationMessage,
  type ImpersonationSession,
  type KillSwitchRow,
  type KillSwitchSetDto,
  type ReconciliationQueryDto,
  type ReconciliationRow,
  type TenantStatusName,
  type UsageQueryDto,
  type UsageRollup,
  type VersionPins,
} from "@clientforce/core";
import type { KillSwitch, Prisma } from "@clientforce/db";
import { BackofficeDb } from "./backoffice-db.service";
import type { BackofficeStaffContext } from "./request";
import { SenderHealthClient } from "./sender-health";

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
  constructor(
    private readonly db: BackofficeDb,
    private readonly senderHealth: SenderHealthClient,
  ) {}

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

  // ── B1 W3 (DEC-081): product adoption, computed from the local telemetry store ─

  /** Activation funnel · DAU/WAU · feature adoption, from `TelemetryEvent`. */
  async adoption(q: AdoptionQueryDto): Promise<AdoptionSummary> {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    const range = { gte: from, lte: to };

    const distinctBy = async (field: "workspaceId" | "actorId", name: string) =>
      (
        await this.prisma.telemetryEvent.findMany({
          where: { name, occurredAt: range, [field]: { not: null } },
          distinct: [field],
          select: { [field]: true },
        })
      ).length;

    // signup counts users; the rest count workspaces reaching each milestone.
    const counts = [
      { step: "signup", count: await distinctBy("actorId", "product.signup.v1") },
      { step: "agent", count: await distinctBy("workspaceId", "product.agent_created.v1") },
      { step: "launch", count: await distinctBy("workspaceId", "product.agent_launched.v1") },
      { step: "first send", count: await distinctBy("workspaceId", "product.send.v1") },
      { step: "first reply", count: await distinctBy("workspaceId", "product.reply.v1") },
      { step: "goal", count: await distinctBy("workspaceId", "product.goal.v1") },
    ];
    const funnel: FunnelStep[] = counts.map((s, i) => ({
      step: s.step,
      count: s.count,
      conversionPct:
        i === 0 || counts[i - 1]!.count === 0
          ? null
          : Math.round((s.count / counts[i - 1]!.count) * 1000) / 10,
    }));

    const activeWorkspaces = async (windowMs: number) =>
      (
        await this.prisma.telemetryEvent.findMany({
          where: { occurredAt: { gte: new Date(to.getTime() - windowMs) }, workspaceId: { not: null } },
          distinct: ["workspaceId"],
          select: { workspaceId: true },
        })
      ).length;
    const dau = await activeWorkspaces(86_400_000);
    const wau = await activeWorkspaces(7 * 86_400_000);

    const featureEvents = await this.prisma.telemetryEvent.findMany({
      where: { name: "feature.first_used.v1", occurredAt: range },
      select: { props: true, workspaceId: true },
    });
    const byFeature = new Map<string, Set<string>>();
    for (const e of featureEvents) {
      const feature = (e.props as { feature?: string } | null)?.feature;
      if (!feature || !e.workspaceId) continue;
      (byFeature.get(feature) ?? byFeature.set(feature, new Set()).get(feature)!).add(e.workspaceId);
    }
    const featureAdoption = [...byFeature.entries()]
      .map(([feature, ws]) => ({ feature, workspaces: ws.size }))
      .sort((a, b) => b.workspaces - a.workspaces);

    // Statistical-honesty floor (the F1 pattern): below sample size → "low data".
    const SAMPLE_FLOOR = 5;
    const totalEvents = await this.prisma.telemetryEvent.count({ where: { occurredAt: range } });

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      funnel,
      dau,
      wau,
      featureAdoption,
      lowData: totalEvents < SAMPLE_FLOOR,
    };
  }

  // ── B1 W4 (DEC-082): kill switch · flags · impersonation · fleet health ─────

  /** Every kill switch (any channel, any agency), stablest order for the UI. */
  async listKillSwitches(): Promise<KillSwitchRow[]> {
    const rows = await this.prisma.killSwitch.findMany({
      orderBy: [{ agencyId: "asc" }, { channel: "asc" }],
    });
    return rows.map((r) => this.toKillSwitchRow(r));
  }

  /**
   * Set/clear a per-agency/per-channel kill switch (audited, reversible). Upsert
   * on the `(agencyId, channel)` unique — `active:false` KEEPS the row (so its
   * history/reason survives) but lets the send boundary through. The boundary
   * (`assertChannelLive`) reads this exact row; W1's suspend/reactivate is the
   * pattern, one scope narrower.
   */
  async setKillSwitch(operator: BackofficeStaffContext, dto: KillSwitchSetDto): Promise<KillSwitchRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const prior = await tx.killSwitch.findUnique({
        where: { agencyId_channel: { agencyId: dto.agencyId, channel: dto.channel } },
      });
      const saved = await tx.killSwitch.upsert({
        where: { agencyId_channel: { agencyId: dto.agencyId, channel: dto.channel } },
        create: { agencyId: dto.agencyId, channel: dto.channel, active: dto.active, reason: dto.reason },
        update: { active: dto.active, reason: dto.reason },
      });
      await this.audit(tx, operator, {
        action: dto.active ? "channel.kill" : "channel.restore",
        targetType: "agency",
        targetId: dto.agencyId,
        reason: dto.reason,
        metadata: { channel: dto.channel, before: prior?.active ?? false, after: dto.active },
      });
      return saved;
    });
    return this.toKillSwitchRow(row);
  }

  /** Per-tenant feature flags for one workspace (stable order for the UI). */
  async listFlags(workspaceId: string): Promise<FeatureFlagRow[]> {
    const rows = await this.prisma.featureFlag.findMany({
      where: { workspaceId },
      orderBy: { key: "asc" },
    });
    return rows.map((r) => ({ key: r.key, enabled: r.enabled, updatedAt: r.updatedAt.toISOString() }));
  }

  /** Set a per-tenant feature flag (upsert on `(workspaceId, key)`, audited). */
  async setFlag(
    operator: BackofficeStaffContext,
    workspaceId: string,
    dto: FeatureFlagSetDto,
  ): Promise<FeatureFlagRow> {
    const row = await this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({ where: { id: workspaceId } });
      if (!ws) throw new NotFoundException("Workspace not found");
      const prior = await tx.featureFlag.findUnique({
        where: { workspaceId_key: { workspaceId, key: dto.key } },
      });
      const saved = await tx.featureFlag.upsert({
        where: { workspaceId_key: { workspaceId, key: dto.key } },
        create: { workspaceId, key: dto.key, enabled: dto.enabled },
        update: { enabled: dto.enabled },
      });
      await this.audit(tx, operator, {
        action: "flag.set",
        targetType: "workspace",
        targetId: workspaceId,
        metadata: { key: dto.key, before: prior?.enabled ?? false, after: dto.enabled },
      });
      return saved;
    });
    return { key: row.key, enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
  }

  /**
   * Start a READ-ONLY impersonation session (FR-ADMIN-05): audit `impersonate.start`
   * and return a banner-marked session. There is NO token and NO write path — the
   * operator only reads tenant content (via `impersonationMessages`); the audit row
   * is the accountable anchor for the whole session.
   */
  async startImpersonation(
    operator: BackofficeStaffContext,
    dto: ImpersonateDto,
  ): Promise<ImpersonationSession> {
    return this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: dto.workspaceId },
        include: { agency: true },
      });
      if (!ws) throw new NotFoundException("Workspace not found");
      const audit = await this.audit(tx, operator, {
        action: "impersonate.start",
        targetType: "workspace",
        targetId: dto.workspaceId,
        reason: dto.reason,
        metadata: { agencyId: ws.agencyId, mode: "read-only" },
      });
      return {
        workspaceId: ws.id,
        workspace: { id: ws.id, name: ws.name, slug: ws.slug, status: ws.status as TenantStatusName },
        agency: { id: ws.agency.id, name: ws.agency.name },
        readOnly: true as const,
        startedAt: audit.createdAt.toISOString(),
        auditId: audit.id,
      };
    });
  }

  /**
   * Read-only message rows for the impersonation viewer. Bodies are truncated to
   * a preview — enough for support to see the thread, no write path anywhere.
   */
  async impersonationMessages(workspaceId: string, limit = 50): Promise<ImpersonationMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { workspaceId },
      orderBy: { sentAt: "desc" },
      take: Math.min(limit, 200),
    });
    return rows.map((m) => ({
      id: m.id,
      channel: m.channel,
      direction: m.direction,
      subject: m.subject,
      preview: m.body.slice(0, 200),
      sentAt: m.sentAt.toISOString(),
      contactId: m.contactId,
    }));
  }

  /**
   * Fleet sender health (FR-ADMIN-04) + abuse/deliverability outliers. Health
   * scores are CONSUMED from P5-W1's endpoint via `SenderHealthClient` — the
   * backoffice NEVER recomputes them; when P5-W1 isn't wired the view says so
   * (`health.wired:false`). Outliers ARE a backoffice concern: bounce/spam/SMS-
   * failure counts per workspace over the last 7d, above a floor.
   */
  async fleetHealth(): Promise<FleetHealthView> {
    const health = await this.senderHealth.scores();

    const since = new Date(Date.now() - 7 * 86_400_000);
    const OUTLIER_METRICS: Record<string, string> = {
      "email.bounced.v1": "bounces",
      "email.spam.v1": "spam",
      "sms.failed.v1": "sms_failures",
    };
    const OUTLIER_FLOOR = 5; // below this per workspace/metric it isn't an outlier.

    const grouped = await this.prisma.event.groupBy({
      by: ["workspaceId", "type"],
      where: { type: { in: Object.keys(OUTLIER_METRICS) }, occurredAt: { gte: since } },
      _count: { _all: true },
    });
    const flagged = grouped.filter((g) => g._count._all >= OUTLIER_FLOOR);
    const workspaceIds = [...new Set(flagged.map((g) => g.workspaceId))];
    const wsRows = workspaceIds.length
      ? await this.prisma.workspace.findMany({
          where: { id: { in: workspaceIds } },
          select: { id: true, agencyId: true },
        })
      : [];
    const agencyByWorkspace = new Map(wsRows.map((w) => [w.id, w.agencyId]));

    const outliers = flagged
      .map((g) => ({
        agencyId: agencyByWorkspace.get(g.workspaceId) ?? "unknown",
        workspaceId: g.workspaceId,
        metric: OUTLIER_METRICS[g.type]!,
        count: g._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    const totalSignals = grouped.reduce((s, g) => s + g._count._all, 0);
    return { health, outliers, lowData: totalSignals < OUTLIER_FLOOR };
  }

  /**
   * Model + prompt version-pin visibility (FR-ADMIN-06), READ-ONLY. Sourced from
   * the live AI config (per-task model routing, env-overridable per deploy) and
   * the code-pinned prompt versions. `scope:"platform"` is honest: these pins are
   * platform-global today, not per-tenant.
   */
  versionPins(): VersionPins {
    const config = loadConfig();
    return {
      scope: "platform",
      models: Object.entries(config.models).map(([task, model]) => ({ task, model })),
      embeddingModel: config.embeddingModel,
      prompts: [
        { name: COMPOSER_EMAIL_PROMPT_NAME, version: COMPOSER_EMAIL_PROMPT_VERSION },
        { name: COMPOSER_PROMPT_NAME, version: COMPOSER_PROMPT_VERSION },
        { name: CLASSIFY_PROMPT_NAME, version: CLASSIFY_PROMPT_VERSION },
      ],
    };
  }

  private toKillSwitchRow(r: KillSwitch): KillSwitchRow {
    return {
      id: r.id,
      agencyId: r.agencyId,
      channel: r.channel,
      active: r.active,
      reason: r.reason,
      updatedAt: r.updatedAt.toISOString(),
    };
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
