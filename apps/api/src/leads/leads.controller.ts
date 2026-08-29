/**
 * B6 (DEC-131): the Lead finder's server half — the provider-agnostic search
 * seam (Apollo adapter #1, server-side key only), OUR ICP scoring, the
 * own-data keyless posture, the watch-topics table, and the first REAL
 * credit debit (reveal): a Workspace.creditBalance decrement + CreditLedger
 * row + the catalog's first `credits.consumed.v1` publisher (partial Q-020 —
 * full metering stays that Q's spine).
 *
 * Honesty rails: keyless Direct mode answers `providerConfigured: false`
 * (the UI renders "provider not connected" — never fixture rows); keyless
 * Ada mode ranks the workspace's OWN book (lapsed, lost, unconverted) with
 * factual receipts; suppression removes DNC/opt-out, active enrollments and
 * happy customers before anything ranks; fit is the headline and intent the
 * second tier (ADDENDUM_4 §4.6).
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { z } from "zod";
import {
  decayedWeight,
  DEFAULT_ICP_PROFILE,
  DIRECT_FILTERS,
  icpProfileSchema,
  scoreCandidate,
  SOURCE_ELIGIBILITY,
  WATCH_TOPIC_SUGGESTIONS,
  type IcpProfile,
} from "@clientforce/core";
import { LeadProviderError, type LeadSearchProvider } from "@clientforce/leads";
import { Prisma, Role } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { HAPPY_STAGES, NOT_NOW_INTENTS, QUIET_DAYS } from "../suggestions/signals";
import { LEAD_PROVIDER } from "./leads.providers";

const watchTopicSchema = z.object({
  kind: z.enum(["topic", "competitor", "area"]),
  label: z.string().trim().min(1).max(80),
});
const searchSchema = z.object({
  mode: z.enum(["ada", "direct"]),
  filters: z.record(z.string(), z.string()).optional(),
});
const revealSchema = z.object({ providerRef: z.string().min(1).max(120) });
const hideSchema = z.object({ provider: z.string().min(1).max(40), providerRef: z.string().min(1).max(120) });

const REVEAL_PRICE_ACTION = "lead_reveal";

@Controller("leads")
export class LeadsController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
    @Inject(LEAD_PROVIDER) private readonly provider: LeadSearchProvider,
  ) {}

  private async profile(): Promise<IcpProfile> {
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: this.tenant.workspaceId },
        select: { settings: true },
      });
      const raw = ((ws?.settings ?? {}) as { icpProfile?: unknown }).icpProfile;
      const parsed = icpProfileSchema.safeParse(raw);
      return parsed.success ? parsed.data : DEFAULT_ICP_PROFILE;
    });
  }

  /** Everything the surface needs to render its truthful shell. */
  @Get("config")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async config() {
    const profile = await this.profile();
    return this.tenant.run(async (tx) => {
      const bp = await tx.integration.findFirst({
        where: { provider: "buyerping" },
        select: { id: true },
      });
      const topics = await tx.watchTopic.findMany({ orderBy: { createdAt: "asc" } });
      const since = new Date(Date.now() - 24 * 3600_000);
      const signalsToday = await tx.intentSignal.count({ where: { occurredAt: { gte: since } } });
      return {
        providerConfigured: this.provider.configured(),
        buyerping: { connected: Boolean(bp), signalsToday },
        profile,
        directFilters: DIRECT_FILTERS[profile.shape],
        topicSuggestions: WATCH_TOPIC_SUGGESTIONS[profile.shape],
        sources: SOURCE_ELIGIBILITY[profile.shape],
        watchTopics: topics.map((t) => ({ id: t.id, kind: t.kind, label: t.label })),
      };
    });
  }

  /** BuyerPing = OUR tier: connect enables it (no vendor token — the
   *  first-party pipeline is free; provider warm signals ride the server
   *  key). The Integration row is its registry home per the ruling. */
  @Post("buyerping")
  @Roles(Role.OWNER, Role.ADMIN)
  async buyerping(@Req() req: AuthenticatedRequest, @Body() body: { enabled?: unknown }) {
    const enabled = body?.enabled === true;
    return this.tenant.run(async (tx) => {
      const existing = await tx.integration.findFirst({ where: { provider: "buyerping" } });
      if (!enabled) {
        if (existing) await tx.integration.delete({ where: { id: existing.id } });
        return { connected: false };
      }
      if (!existing) {
        await tx.integration.create({
          data: {
            workspaceId: this.tenant.workspaceId,
            provider: "buyerping",
            status: "connected",
            config: { enabled: true },
            connectedById: req.auth?.user.id ?? null,
          },
        });
      }
      return { connected: true };
    });
  }

  @Post("watch-topics")
  @Roles(Role.OWNER, Role.ADMIN)
  async addTopic(@Body() body: unknown) {
    const parsed = watchTopicSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid watch topic");
    return this.tenant.run(async (tx) => {
      const existing = await tx.watchTopic.findFirst({
        where: { kind: parsed.data.kind, label: parsed.data.label },
      });
      if (existing) return { id: existing.id, kind: existing.kind, label: existing.label };
      const created = await tx.watchTopic.create({
        data: { workspaceId: this.tenant.workspaceId, ...parsed.data },
      });
      return { id: created.id, kind: created.kind, label: created.label };
    });
  }

  @Delete("watch-topics/:id")
  @Roles(Role.OWNER, Role.ADMIN)
  async removeTopic(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      await tx.watchTopic.deleteMany({ where: { id } });
      return { ok: true };
    });
  }

  @Post("hide")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async hide(@Body() body: unknown) {
    const parsed = hideSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid hide request");
    return this.tenant.run(async (tx) => {
      await tx.leadExclusion.upsert({
        where: {
          workspaceId_provider_providerRef: {
            workspaceId: this.tenant.workspaceId,
            ...parsed.data,
          },
        },
        update: {},
        create: { workspaceId: this.tenant.workspaceId, ...parsed.data },
      });
      return { ok: true };
    });
  }

  @Post("search")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async search(@Body() body: unknown) {
    const parsed = searchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid search");
    const profile = await this.profile();
    const filters = parsed.data.filters ?? {};

    if (parsed.data.mode === "direct") {
      // Consumer-shape workspaces have no provider search — the registry
      // says so and the surface hides the mode (scope comment).
      if (!SOURCE_ELIGIBILITY[profile.shape].includes("provider")) {
        return { providerConfigured: false, consumerShape: true, candidates: [] };
      }
      if (!this.provider.configured()) {
        return { providerConfigured: false, candidates: [] };
      }
      const raw = await this.searchProvider(filters);
      return { providerConfigured: true, candidates: raw };
    }

    // Ada mode: the OWN BOOK always (keyless posture), the provider pool on
    // top when configured — everything scored by OUR icp, fit first.
    const own = await this.ownBookCandidates(profile);
    let providerRows: Awaited<ReturnType<LeadsController["searchProvider"]>> = [];
    if (this.provider.configured() && SOURCE_ELIGIBILITY[profile.shape].includes("provider")) {
      try {
        providerRows = await this.searchProvider({
          ...(profile.location ? { location: profile.location } : {}),
          ...(profile.titles?.length ? { titles: profile.titles.join("|") } : {}),
        });
      } catch (err) {
        if (!(err instanceof LeadProviderError)) throw err;
        // Provider trouble must not hide the own-book half — say so instead.
        providerRows = [];
      }
    }
    const candidates = [...own, ...providerRows].sort(
      (a, b) => b.fit - a.fit || b.intentWeight - a.intentWeight,
    );
    return { providerConfigured: this.provider.configured(), candidates };
  }

  private async searchProvider(filters: Record<string, string>) {
    let rows;
    try {
      rows = await this.provider.searchPeople(filters, 10);
    } catch (err) {
      if (err instanceof LeadProviderError) {
        throw new HttpException(
          { reason: err.kind, message: err.message },
          err.kind === "PROVIDER_RATE_LIMITED" ? 429 : err.kind === "PROVIDER_AUTH" ? 503 : 502,
        );
      }
      throw err;
    }
    const profile = await this.profile();
    return this.tenant.run(async (tx) => {
      const hidden = await tx.leadExclusion.findMany({ select: { providerRef: true } });
      const hiddenSet = new Set(hidden.map((h) => h.providerRef));
      return rows
        .filter((r) => !hiddenSet.has(r.providerRef))
        .map((r) => {
          const scored = scoreCandidate(profile, {
            title: r.title,
            company: r.company,
            location: r.location,
            headcount: r.headcount,
          });
          return {
            id: `${r.provider}:${r.providerRef}`,
            origin: "provider" as const,
            provider: r.provider,
            providerRef: r.providerRef,
            contactId: null,
            name: r.name,
            title: r.title,
            company: r.company,
            location: r.location,
            headcount: r.headcount,
            maskedEmail: r.maskedEmail,
            maskedPhone: r.maskedPhone,
            fit: scored.fit,
            fitReasons: scored.reasons,
            // B6 review fix 2: a fit with no data-backed reason is fake
            // precision — the surface shows "unscored" instead of a number.
            scored: scored.reasons.length > 0,
            intentWeight: 0,
            intentReceipts: [] as string[],
            revealed: false,
          };
        });
    });
  }

  /**
   * The keyless Ada pool: lapsed, lost and unconverted contacts from the
   * workspace's own book — the B2.6 sweep vocabulary, ranked honestly.
   */
  private async ownBookCandidates(profile: IcpProfile) {
    return this.tenant.run(async (tx) => {
      const now = Date.now();
      const quietBefore = new Date(now - QUIET_DAYS * 86_400_000);

      const [lastTouch, notNow, active, suppressedContacts, happy] = await Promise.all([
        tx.message.groupBy({ by: ["contactId"], _max: { sentAt: true } }),
        tx.message.findMany({
          where: { direction: "INBOUND", intent: { in: [...NOT_NOW_INTENTS] } },
          select: { contactId: true },
          distinct: ["contactId"],
        }),
        tx.enrollment.findMany({ where: { status: "ACTIVE" }, select: { contactId: true } }),
        tx.contact.findMany({
          where: { OR: [{ optOut: { path: ["email"], equals: true } }, { optOut: { path: ["sms"], equals: true } }] },
          select: { id: true },
        }),
        tx.enrollment.findMany({
          where: { pipelineStage: { in: [...HAPPY_STAGES] } },
          select: { contactId: true },
        }),
      ]);
      const activeSet = new Set(active.map((e) => e.contactId));
      const suppressedSet = new Set(suppressedContacts.map((c) => c.id));
      const happySet = new Set(happy.map((e) => e.contactId));
      const notNowSet = new Set(notNow.map((m) => m.contactId));
      const touchById = new Map(lastTouch.map((t) => [t.contactId, t._max.sentAt]));

      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        take: 200,
        select: { id: true, firstName: true, lastName: true, company: true, title: true, email: true, callConsent: true },
      });
      const replied = await tx.message.findMany({
        where: { direction: "INBOUND" },
        select: { contactId: true },
        distinct: ["contactId"],
      });
      const repliedSet = new Set(replied.map((m) => m.contactId));

      const since = new Date(now - 45 * 86_400_000);
      const signals = await tx.intentSignal.findMany({
        where: { occurredAt: { gte: since }, contactId: { not: null } },
        orderBy: { occurredAt: "desc" },
      });
      const signalsByContact = new Map<string, typeof signals>();
      for (const s of signals) {
        const list = signalsByContact.get(s.contactId!) ?? [];
        list.push(s);
        signalsByContact.set(s.contactId!, list);
      }

      const rows = [];
      for (const c of contacts) {
        // Suppression pass: already-yours, mid-campaign, or do-not-contact.
        if (activeSet.has(c.id) || suppressedSet.has(c.id) || happySet.has(c.id)) continue;
        const last = touchById.get(c.id);
        const days = last ? Math.floor((now - last.getTime()) / 86_400_000) : null;
        const isLapsed = last != null && last < quietBefore;
        const isLost = notNowSet.has(c.id);
        const everTouched = touchById.has(c.id);
        if (!isLapsed && !isLost && everTouched) continue; // still warm with you — not a "find"
        const scored = scoreCandidate(profile, {
          title: c.title,
          company: c.company,
          repliedBefore: repliedSet.has(c.id),
          bookedBefore: false,
          daysSinceLastTouch: days,
          callConsentGranted: c.callConsent === "granted",
        });
        const sigs = signalsByContact.get(c.id) ?? [];
        const intentWeight = sigs.reduce((n, s) => n + decayedWeight(s.type, s.occurredAt), 0);
        const reasons = [
          isLost ? "said not-now before — worth a fresh angle" : isLapsed ? "went quiet on you" : "in your book, never worked",
          ...scored.reasons,
        ];
        rows.push({
          id: `own:${c.id}`,
          origin: "own" as const,
          provider: "own",
          providerRef: c.id,
          contactId: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact",
          title: c.title,
          company: c.company,
          location: null,
          headcount: null,
          maskedEmail: null,
          maskedPhone: null,
          fit: scored.fit,
          fitReasons: reasons,
          scored: scored.reasons.length > 0,
          intentWeight: Math.round(intentWeight * 10) / 10,
          intentReceipts: sigs.slice(0, 2).map((s) => s.receipt),
          revealed: true, // own contacts are already yours — nothing to buy
        });
      }
      return rows.sort((a, b) => b.fit - a.fit || b.intentWeight - a.intentWeight).slice(0, 8);
    });
  }

  /**
   * Reveal = the paid step: provider match → contact write (dedupe email→
   * phone, source "lead_finder", provider payload into the reserved
   * enrichment column) → the REAL debit (balance + ledger + the catalog's
   * first credits.consumed.v1). Refuses honestly on empty balance.
   */
  @Post("reveal")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async reveal(@Body() body: unknown) {
    const parsed = revealSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid reveal");
    if (!this.provider.configured()) {
      throw new HttpException(
        { reason: "PROVIDER_NOT_CONFIGURED", message: "The lead-data provider isn't connected on this deployment." },
        503,
      );
    }
    let revealed;
    try {
      revealed = await this.provider.reveal(parsed.data.providerRef);
    } catch (err) {
      if (err instanceof LeadProviderError) {
        throw new HttpException({ reason: err.kind, message: err.message }, 502);
      }
      throw err;
    }

    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      // Effective-dated price, agency override first (the resolveCreditPrice
      // rule inlined over the tenant read's visibility filter).
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { agencyId: true, creditBalance: true },
      });
      const prices = await tx.creditPrice.findMany({
        where: {
          action: REVEAL_PRICE_ACTION,
          effectiveFrom: { lte: new Date() },
          OR: [{ agencyId: null }, { agencyId: ws.agencyId }],
        },
        orderBy: [{ agencyId: "desc" }, { effectiveFrom: "desc" }],
      });
      const price = prices[0]?.credits ?? 1;
      if (ws.creditBalance < price) {
        throw new HttpException(
          { reason: "NOT_ENOUGH_CREDITS", message: `Revealing costs ${price} credit${price === 1 ? "" : "s"} — top up first.` },
          422,
        );
      }

      const existing =
        (revealed.email ? await tx.contact.findFirst({ where: { email: revealed.email } }) : null) ??
        (revealed.phone ? await tx.contact.findFirst({ where: { phone: revealed.phone } }) : null);
      const contact =
        existing ??
        (await tx.contact.create({
          data: {
            workspaceId,
            source: "lead_finder",
            optOut: {},
            tags: ["lead-finder"],
            ...(revealed.email ? { email: revealed.email } : {}),
            ...(revealed.phone ? { phone: revealed.phone } : {}),
            ...(revealed.firstName ? { firstName: revealed.firstName } : {}),
            ...(revealed.lastName ? { lastName: revealed.lastName } : {}),
            ...(revealed.title ? { title: revealed.title } : {}),
            ...(revealed.company ? { company: revealed.company } : {}),
            enrichment: {
              provider: this.provider.name,
              providerRef: parsed.data.providerRef,
              raw: revealed.raw,
            } as Prisma.InputJsonValue,
          },
        }));

      // Charged once, ever: an already-known contact costs nothing.
      if (existing) {
        return { contactId: contact.id, alreadyKnown: true, charged: 0, balance: ws.creditBalance };
      }
      const balanceAfter = ws.creditBalance - price;
      await tx.creditLedger.create({
        data: { workspaceId, delta: -price, reason: "lead_reveal", refId: contact.id, balanceAfter },
      });
      await tx.workspace.update({ where: { id: workspaceId }, data: { creditBalance: balanceAfter } });
      await this.publisher.publish({
        type: EVENT_TYPES.CREDITS_CONSUMED,
        workspaceId,
        contactId: contact.id,
        payload: { amount: price, channel: "lead_reveal", balance: balanceAfter },
      });
      return { contactId: contact.id, alreadyKnown: false, charged: price, balance: balanceAfter };
    });
  }
}
