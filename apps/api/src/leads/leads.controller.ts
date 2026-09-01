/**
 * B6 (DEC-131): the Lead finder's server half — the provider-agnostic search
 * seam (Apollo adapter #1, server-side key only), OUR ICP scoring, the
 * own-data keyless posture, the watch-topics table, and the first REAL
 * credit debit (reveal): a Workspace.creditBalance decrement + CreditLedger
 * row + the catalog's first `credits.consumed.v1` publisher (partial Q-020 —
 * full metering stays that Q's spine).
 *
 * Honesty rails: keyless Direct mode answers `providerConfigured: false`
 * and the UI renders an OPERATOR condition — "Search is temporarily
 * unavailable · nothing for you to fix" — never a vendor name and never a
 * connect affordance (ADDENDUM_5 §1, DEC-150). Keyless Ada mode ranks the
 * workspace's OWN book (lapsed, lost, unconverted) with factual receipts;
 * suppression removes DNC/opt-out, active enrollments and happy customers
 * before anything ranks; fit is the headline and intent the second tier
 * (ADDENDUM_4 §4.6).
 *
 * B6.5 (DEC-150..153) rebuilds the surface's server half as a STANDING
 * WATCH: typed feed rows carrying their own signal group, firing time,
 * receipt, source tag and lawful basis; TIER GATING so a `bp` type produces
 * no row anywhere in the response until BuyerPing is on (SURFACE_SPEC
 * §12.1); server-derived counts for every control that shows one; ONE
 * suppression source behind both the feed foot and the pool header
 * (§12.7); and the pool's bands, of which only ALREADY YOURS can be counted
 * from shipped data — the paid bands say plainly that their number needs
 * the provider rather than showing an invented estimate (DEC-115, Q-140).
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
  briefWatchTopics,
  DEFAULT_ICP_PROFILE,
  DIRECT_FILTERS,
  icpProfileSchema,
  INTENT_SIGNALS,
  intentReceipt,
  intentScore,
  isVisibleSignal,
  leadFinderTitle,
  leadFinderWatchTitle,
  lockedSignalTypes,
  plainWhen,
  POOL_BANDS,
  PROVIDER_PEOPLE_SEARCH,
  scoreCandidate,
  SIGNAL_GROUP_META,
  signalApplies,
  SOURCE_ELIGIBILITY,
  subjectNounFor,
  WATCH_TOPIC_SUGGESTIONS,
  type IcpProfile,
  type SignalGroup,
} from "@clientforce/core";
import { LeadProviderError, type LeadSearchProvider } from "@clientforce/leads";
import { charge, priceFor, Prisma, Role } from "@clientforce/db";
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

/**
 * B6.6: the one place a contact's PLACE comes from.
 *
 * `Contact` has no location column. The only place we ever hold one is the
 * provider payload kept on `enrichment.raw` when a lead was revealed, so
 * that is what this reads — and it returns null for every contact that was
 * imported or entered by hand, which is most of them. That null is the
 * honest answer, not a gap to paper over: inferring a city from an area
 * code or a campaign's target area would be inventing a fact about a person
 * (DEC-115). Giving own-book contacts a real place is Q-160.
 */
function contactLocation(enrichment: Prisma.JsonValue | null | undefined): string | null {
  if (!enrichment || typeof enrichment !== "object" || Array.isArray(enrichment)) return null;
  const raw = (enrichment as Record<string, unknown>).raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const loc = (raw as Record<string, unknown>).location;
  return typeof loc === "string" && loc.trim().length > 0 ? loc.trim() : null;
}

/** The brief edit (SURFACE_SPEC §11 `Edit brief`). Additive: the profile is
 *  written at first run by POST /workspaces; this is the only update path. */
const briefSchema = icpProfileSchema;

/**
 * The lawful-basis sentence, in plain words, composed from the bases the
 * workspace's OWN active signal types actually carry — never a fixed
 * paragraph (ADDENDUM_5 §9 / SURFACE_SPEC §12.9).
 */
function basisSentence(types: string[]): string {
  const bases = new Set(types.map((t) => INTENT_SIGNALS[t]?.basis).filter(Boolean));
  const parts: string[] = [];
  if (bases.has("first_party")) {
    parts.push(
      "Your own records and your own visitors can be replied to in any channel they used.",
    );
  }
  if (bases.has("licensed") || bases.has("public_record")) {
    parts.push(
      "Movers, life events and public complaints are licensed or public data: she may email them and put them in ads, but she may not call or text until they have said yes.",
    );
  }
  return parts.join(" ");
}

/** What a row's basis permits, as the chip states it. */
function channelChip(basis: string | undefined): { label: string; warm: boolean } {
  return basis === "first_party"
    ? { label: "any channel she used", warm: true }
    : { label: "email ok · no call consent", warm: false };
}

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
      const tierOn = await this.readTier(tx);
      const topics = await tx.watchTopic.findMany({ orderBy: { createdAt: "asc" } });
      const since = new Date(Date.now() - 24 * 3600_000);
      const signalsToday = await tx.intentSignal.count({ where: { occurredAt: { gte: since } } });
      const ws = await tx.workspace.findUnique({
        where: { id: this.tenant.workspaceId },
        select: { createdAt: true, settings: true },
      });
      const scoredAgainst = await tx.contact.count();

      const vertical = profile.vertical ?? null;
      const applicable = Object.entries(INTENT_SIGNALS).filter(([, def]) =>
        signalApplies(def, profile.shape, vertical),
      );
      const activeTypes = applicable.filter(([, d]) => d.tier === "core" || tierOn).map(([k]) => k);

      // Group catalogue: what she watches, and what is held back. A group is
      // ON when at least one of its types is available to this workspace at
      // its current tier — the panel lists what a person recognises, not our
      // event keys.
      const groupsOf = (types: Array<[string, (typeof INTENT_SIGNALS)[string]]>) => {
        const seen = new Map<SignalGroup, { tier: "core" | "bp"; types: string[] }>();
        for (const [key, def] of types) {
          const cur = seen.get(def.group) ?? { tier: def.tier, types: [] };
          cur.types.push(key);
          // A group containing any core type is INCLUDED; only an all-paid
          // group carries the BUYERPING badge.
          if (def.tier === "core") cur.tier = "core";
          seen.set(def.group, cur);
        }
        return [...seen.entries()].map(([group, v]) => {
          const meta = SIGNAL_GROUP_META[group];
          const flav = vertical ? meta.byVertical?.[vertical] : undefined;
          return {
            key: group,
            label: flav?.label ?? meta.label,
            why: flav?.why ?? meta.why,
            tier: v.tier,
            types: v.types,
          };
        });
      };
      const watching = groupsOf(applicable.filter(([, d]) => d.tier === "core" || tierOn));
      const lockedTypes = lockedSignalTypes(profile.shape, vertical);
      const locked = tierOn
        ? []
        : groupsOf(applicable.filter(([, d]) => d.tier === "bp")).map((g) => ({
            ...g,
            // No producer exists for licensed supply yet, so we cannot say
            // what it "would find". Naming the kinds honestly is the whole
            // truth we have (DEC-115; the count is Q-140).
            estimate: null as string | null,
          }));

      const settings = (ws?.settings ?? {}) as { briefUpdatedAt?: unknown };
      const briefUpdatedAt =
        typeof settings.briefUpdatedAt === "string" ? settings.briefUpdatedAt : null;
      // The brief is written at first run by POST /workspaces, so the
      // workspace's own creation is when the watch genuinely started; an
      // edit moves it. Never a decorative date.
      const watchingSince = briefUpdatedAt ?? ws?.createdAt?.toISOString() ?? null;

      return {
        providerConfigured: this.provider.configured(),
        buyerping: { connected: tierOn, signalsToday },
        profile,
        directFilters: DIRECT_FILTERS[profile.shape],
        providerPeopleSearch: PROVIDER_PEOPLE_SEARCH[profile.shape],
        topicSuggestions: WATCH_TOPIC_SUGGESTIONS[profile.shape],
        sources: SOURCE_ELIGIBILITY[profile.shape],
        // B6.6: the brief's own words and places FIRST, then the ones a
        // person typed. Reading only the `WatchTopic` table left this block
        // empty on every workspace that had never hand-typed a chip — while
        // the workspace had in fact stated its services and its area at
        // first run. A derived chip is not deletable here: its home is the
        // brief, so the surface sends you there instead of offering a delete
        // that would leave the profile and the panel disagreeing.
        watchTopics: [
          ...briefWatchTopics(profile),
          ...topics.map((t) => ({ id: t.id, kind: t.kind, label: t.label, derived: false })),
        ],
        // ── B6.5: the standing-watch shell ──
        title: leadFinderTitle(profile.shape, vertical),
        // B6.6: the panel names the standing brief; the page asks the
        // question. They are two different sentences in the prototype and
        // the build had been printing the page question in both.
        watchTitle: leadFinderWatchTitle(profile.shape),
        noun: subjectNounFor(profile.shape, vertical),
        brief: {
          sentence: this.briefSentence(profile),
          provenance: this.briefProvenance(profile, scoredAgainst, watching),
          watchingSince,
          scoredAgainst,
        },
        watching,
        locked,
        lockedTypes,
        basis: basisSentence(activeTypes),
        poolBands: POOL_BANDS,
      };
    });
  }

  /**
   * The brief in one plain sentence, composed from the profile the workspace
   * actually holds. Every clause is a fact it stated at first run; a field it
   * never gave simply does not appear.
   */
  private briefSentence(p: IcpProfile): string {
    const noun = subjectNounFor(p.shape, p.vertical ?? null).many;
    const where = p.location
      ? p.radiusMiles
        ? `within ${p.radiusMiles} miles of ${p.location}`
        : `in ${p.location}`
      : null;
    const who =
      p.shape === "consumer"
        ? null
        : p.headcountBand
          ? `${p.headcountBand} in size`
          : null;
    const role = p.titles?.length ? `reached through ${p.titles.slice(0, 3).join(", ")}` : null;
    const clauses = [where, who, role].filter(Boolean);
    if (clauses.length === 0) return `Any ${noun} who might need what you sell.`;
    return `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${clauses.join(", ")}.`;
  }

  /** Where the scoring came from and what is being watched — both real. */
  private briefProvenance(
    p: IcpProfile,
    scoredAgainst: number,
    watching: Array<{ label: string }>,
  ): string {
    const noun = subjectNounFor(p.shape, p.vertical ?? null).many;
    const scored =
      scoredAgainst > 0
        ? `Fit scored against your ${scoredAgainst} ${noun}`
        : "Fit scored from your brief — you have no contacts on file yet";
    if (watching.length === 0) return `${scored}.`;
    // A colon, not "watching X": the group labels are noun phrases, and
    // "watching reading your pages" does not read like a person wrote it.
    const list = watching.map((w) => w.label.toLowerCase());
    const tail = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`;
    return `${scored} · watching: ${tail}`;
  }

  /** BuyerPing = OUR tier: connect enables it (no vendor token — the
   *  first-party pipeline is free; provider warm signals ride the server
   *  key). The Integration row is its registry home per the ruling. */
  @Post("buyerping")
  @Roles(Role.OWNER, Role.ADMIN)
  async buyerping(@Req() req: AuthenticatedRequest, @Body() body: { enabled?: unknown }) {
    const enabled = body?.enabled === true;
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const settings = (ws.settings ?? {}) as Record<string, unknown>;
      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          settings: {
            ...settings,
            buyerping: {
              enabled,
              changedAt: new Date().toISOString(),
              changedBy: req.auth?.user.id ?? null,
            },
          } as Prisma.InputJsonValue,
        },
      });
      // Retire the legacy Integration row on first touch — the tier is not an
      // integration and must not keep a card's worth of state alive.
      const legacy = await tx.integration.findFirst({ where: { provider: "buyerping" } });
      if (legacy) await tx.integration.delete({ where: { id: legacy.id } });
      return { connected: enabled };
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
      // Person-level provider search is not something we sell to a
      // consumer-shape workspace — its Direct search is over its own book
      // (SURFACE_SPEC §7). This is a PRODUCT boundary, not a lawful one, and
      // is separate from which suppliers may produce signals (DEC-150).
      if (!PROVIDER_PEOPLE_SEARCH[profile.shape]) {
        return { providerConfigured: false, consumerShape: true, candidates: [] };
      }
      if (!this.provider.configured()) {
        // Operator condition. The body never names a vendor.
        return { providerConfigured: false, candidates: [] };
      }
      const raw = await this.searchProvider(filters);
      return { providerConfigured: true, candidates: raw };
    }

    // Ada mode: the OWN BOOK always (keyless posture), the provider pool on
    // top when configured — everything scored by OUR icp, fit first.
    const tierOn = await this.tierOn();
    const own = await this.ownBookCandidates(profile, tierOn);
    let providerRows: Awaited<ReturnType<LeadsController["searchProvider"]>> = [];
    if (this.provider.configured() && PROVIDER_PEOPLE_SEARCH[profile.shape]) {
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
    // Same rule for provider candidates: "matches your brief — no signal
    // firing yet" is not something that happened, so it may not sit under a
    // recency divider. Those rows are the POOL's job and Direct search's.
    const all = [...own, ...providerRows]
      .filter((r) => r.occurredAt !== null)
      .sort((a, b) => b.fit - a.fit || b.intentWeight - a.intentWeight);

    // Every count the surface shows is computed here, over the SAME set the
    // rows come from — no control may show a number the list cannot justify
    // (SURFACE_SPEC §12.4).
    const groupCounts: Record<string, number> = {};
    for (const r of all) if (r.group) groupCounts[r.group] = (groupCounts[r.group] ?? 0) + 1;
    const inWindow = (r: (typeof all)[number], w: string) =>
      w === "any" ? true : r.bucket === w;
    const counts = {
      groups: groupCounts,
      when: {
        any: all.length,
        today: all.filter((r) => r.bucket === "today").length,
        week: all.filter((r) => r.bucket === "week").length,
      },
      fit: {
        any: all.length,
        "80": all.filter((r) => r.fit >= 80).length,
        "90": all.filter((r) => r.fit >= 90).length,
      },
    };

    const group = typeof filters.group === "string" ? filters.group : null;
    const when = typeof filters.when === "string" ? filters.when : "any";
    const fitMin = Number(filters.fitMin ?? 0) || 0;
    const candidates = all.filter(
      (r) => (!group || r.group === group) && inWindow(r, when) && r.fit >= fitMin,
    );

    return {
      providerConfigured: this.provider.configured(),
      tierOn,
      counts,
      waiting: candidates.length,
      suppression: await this.suppressionBreakdown(),
      candidates,
    };
  }

  /**
   * Is the BuyerPing tier on?
   *
   * DEC-152: the tier LEFT the integrations registry (ADDENDUM_5 §2) — it is
   * not an integration, there is nothing to connect and no vendor to name, so
   * an Integration row was the wrong home for it. Its interim home is
   * `Workspace.settings.buyerping`, the same additive-JSON pattern as
   * `icpProfile`; the real home is an agency-level plan entitlement, which
   * lands with the rest of tier gating in B10.5 (Q-141).
   *
   * A workspace switched on before this wave still has the legacy Integration
   * row, so that is read as true and migrated on the next toggle. Nobody's
   * tier silently turns off.
   */
  private async readTier(tx: Prisma.TransactionClient): Promise<boolean> {
    const ws = await tx.workspace.findUnique({
      where: { id: this.tenant.workspaceId },
      select: { settings: true },
    });
    const bp = ((ws?.settings ?? {}) as { buyerping?: { enabled?: unknown } }).buyerping;
    if (bp && typeof bp.enabled === "boolean") return bp.enabled;
    const legacy = await tx.integration.findFirst({
      where: { provider: "buyerping" },
      select: { id: true },
    });
    return Boolean(legacy);
  }

  private async tierOn(): Promise<boolean> {
    return this.tenant.run((tx) => this.readTier(tx));
  }

  /**
   * ONE source for the held-back numbers, read by the feed foot AND the pool
   * header (SURFACE_SPEC §12.7). Every reason is a real query — the same
   * passes that already remove these contacts before anything ranks.
   */
  private async suppressionBreakdown() {
    return this.tenant.run(async (tx) => {
      const [active, happy, optOut, hidden] = await Promise.all([
        tx.enrollment.findMany({ where: { status: "ACTIVE" }, select: { contactId: true } }),
        tx.enrollment.findMany({
          where: { pipelineStage: { in: [...HAPPY_STAGES] } },
          select: { contactId: true },
        }),
        tx.contact.findMany({
          where: {
            OR: [
              { optOut: { path: ["email"], equals: true } },
              { optOut: { path: ["sms"], equals: true } },
              { optOut: { path: ["voice"], equals: true } },
            ],
          },
          select: { id: true },
        }),
        tx.leadExclusion.count(),
      ]);
      const activeSet = new Set(active.map((e) => e.contactId));
      const happySet = new Set(happy.map((e) => e.contactId));
      const optOutSet = new Set(optOut.map((c) => c.id));
      // A contact counted once, in the strictest bucket that applies.
      for (const id of optOutSet) {
        activeSet.delete(id);
        happySet.delete(id);
      }
      for (const id of activeSet) happySet.delete(id);
      const reasons = [
        { key: "yours", label: "already yours", n: happySet.size },
        { key: "mid_campaign", label: "mid-campaign with you", n: activeSet.size },
        { key: "do_not_contact", label: "asked not to be contacted", n: optOutSet.size },
        { key: "hidden", label: "you hid them", n: hidden },
      ].filter((r) => r.n > 0);
      return { total: reasons.reduce((n, r) => n + r.n, 0), reasons };
    });
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
          const chip = channelChip("licensed");
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
            // ── B6.5 row contract (SURFACE_SPEC §5 / §10): a row carries
            // every field its drawer may read, and no drawer reads more.
            signalType: null as string | null,
            group: null as string | null,
            receipt: "Matches your brief — no signal firing yet",
            about: [r.title, r.company, r.location].filter(Boolean).join(" · "),
            sourceTag: "DIRECT SEARCH",
            basis: "licensed" as string,
            channelLabel: chip.label,
            channelWarm: chip.warm,
            occurredAt: null as string | null,
            bucket: "older" as "today" | "week" | "older",
            actionable: true,
          };
        });
    });
  }

  /**
   * The keyless Ada pool: lapsed, lost and unconverted contacts from the
   * workspace's own book — the B2.6 sweep vocabulary, ranked honestly.
   *
   * B6.5: each row now carries the TYPED own-book signal that produced it
   * (`went_quiet` / `said_not_now` / `never_worked`), its firing time and its
   * registry receipt, so the feed can group by recency and the panel can
   * count by group. Nothing here is invented — every one of the three is
   * derived from the same rows the suppression pass already reads.
   */
  private async ownBookCandidates(profile: IcpProfile, tierOn: boolean) {
    const vertical = profile.vertical ?? null;
    return this.tenant.run(async (tx) => {
      const now = Date.now();
      const quietBefore = new Date(now - QUIET_DAYS * 86_400_000);

      const [lastTouch, notNow, active, suppressedContacts, happy, excluded] = await Promise.all([
        tx.message.groupBy({ by: ["contactId"], _max: { sentAt: true } }),
        tx.message.findMany({
          where: { direction: "INBOUND", intent: { in: [...NOT_NOW_INTENTS] } },
          select: { contactId: true, sentAt: true },
          orderBy: { sentAt: "desc" },
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
        // B6.5 bug fix: "Not for me" wrote a LeadExclusion row that only the
        // PROVIDER path consulted, so hiding one of your own records did
        // nothing and the row came straight back on the next search.
        tx.leadExclusion.findMany({ where: { provider: "own" }, select: { providerRef: true } }),
      ]);
      const activeSet = new Set(active.map((e) => e.contactId));
      const suppressedSet = new Set(suppressedContacts.map((c) => c.id));
      const happySet = new Set(happy.map((e) => e.contactId));
      const notNowAt = new Map<string, Date>();
      for (const m of notNow) if (!notNowAt.has(m.contactId)) notNowAt.set(m.contactId, m.sentAt);
      const excludedSet = new Set(excluded.map((e) => e.providerRef));
      const touchById = new Map(lastTouch.map((t) => [t.contactId, t._max.sentAt]));

      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        take: 200,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          company: true,
          title: true,
          email: true,
          callConsent: true,
          createdAt: true,
        },
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
        const def = INTENT_SIGNALS[s.type];
        // Tier gate (SURFACE_SPEC §12.1): a paid type must be ABSENT from the
        // response, not merely hidden. Decay floor: a faded signal stops
        // being shown rather than lingering as noise.
        if (def && def.tier === "bp" && !tierOn) continue;
        if (!isVisibleSignal(s.type, s.occurredAt)) continue;
        const list = signalsByContact.get(s.contactId!) ?? [];
        list.push(s);
        signalsByContact.set(s.contactId!, list);
      }

      const bucketOf = (d: Date | null): "today" | "week" | "older" => {
        if (!d) return "older";
        const days = (now - d.getTime()) / 86_400_000;
        return days < 1 ? "today" : days < 7 ? "week" : "older";
      };

      const rows = [];
      for (const c of contacts) {
        // Suppression pass: already-yours, mid-campaign, or do-not-contact.
        if (activeSet.has(c.id) || suppressedSet.has(c.id) || happySet.has(c.id)) continue;
        if (excludedSet.has(c.id)) continue;
        const last = touchById.get(c.id);
        const days = last ? Math.floor((now - last.getTime()) / 86_400_000) : null;
        const isLapsed = last != null && last < quietBefore;
        const notNowOn = notNowAt.get(c.id) ?? null;
        const isLost = notNowOn != null;
        const everTouched = touchById.has(c.id);
        const sigs = signalsByContact.get(c.id) ?? [];
        // "Still warm with you" is not a find — UNLESS something just fired.
        // A contact who asked what it costs this morning is precisely who
        // belongs at the top of "in the market"; the own-book warm filter was
        // dropping them before their signal was ever looked at.
        if (!isLapsed && !isLost && everTouched && sigs.length === 0) continue;
        const scored = scoreCandidate(profile, {
          title: c.title,
          company: c.company,
          repliedBefore: repliedSet.has(c.id),
          bookedBefore: false,
          daysSinceLastTouch: days,
          callConsentGranted: c.callConsent === "granted",
        });
        // The typed own-book signal that put this row here. Derived from the
        // very rows the suppression pass read — never a stored fiction.
        const ownType = isLost ? "said_not_now" : isLapsed ? "went_quiet" : "never_worked";
        // B6.5 review fix 1 (owner ruling): a row may only claim a DAY if a
        // real event carries an `occurredAt`. `went_quiet` and `said_not_now`
        // both have one — the last message, and the not-now reply. But
        // `never_worked` is the ABSENCE of an event: a contact reaches your
        // book by import or by hand, and `createdAt` is when the ROW was
        // written, not something that happened to them. Dating a row from it
        // put six dormant records under TODAY and lit the 🔥 for nothing.
        const ownEventAt: Date | null = isLost ? notNowOn! : isLapsed ? last! : null;
        const def = INTENT_SIGNALS[ownType];
        // The headline is the newest REAL event — a first-party signal, or the
        // own-book event. A signal always outranks an undated own-book state.
        const newest = sigs[0];
        let headlineType = ownType;
        let headlineAt: Date | null = ownEventAt;
        if (newest && (headlineAt === null || newest.occurredAt > headlineAt)) {
          headlineType = newest.type;
          headlineAt = newest.occurredAt;
        }
        // Dormant: nothing happened, so it cannot be news. It stays in the
        // pool's ALREADY YOURS band, where "on file and a match" is the whole
        // claim — the market feed is for things that actually happened.
        if (headlineAt === null) continue;
        const headlineDef = INTENT_SIGNALS[headlineType];
        const receipt =
          headlineType === ownType
            ? (intentReceipt(ownType, vertical, { when: plainWhen(headlineAt) }) ?? ownType)
            : newest!.receipt;
        const chip = channelChip(headlineDef?.basis ?? def?.basis);
        const reasons = [receipt, ...scored.reasons];
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
          intentWeight: intentScore([
            ...sigs.map((s) => ({ type: s.type, occurredAt: s.occurredAt })),
            ...(ownEventAt ? [{ type: ownType, occurredAt: ownEventAt }] : []),
          ]),
          intentReceipts: sigs.slice(0, 2).map((s) => s.receipt),
          revealed: true, // own contacts are already yours — nothing to buy
          signalType: headlineType,
          group: headlineDef?.group ?? def?.group ?? null,
          receipt,
          about: [c.title, c.company].filter(Boolean).join(" · "),
          sourceTag: headlineDef?.sourceTag ?? def?.sourceTag ?? "YOUR RECORDS",
          basis: headlineDef?.basis ?? def?.basis ?? "first_party",
          channelLabel: chip.label,
          channelWarm: chip.warm,
          occurredAt: headlineAt.toISOString(),
          bucket: bucketOf(headlineAt),
          actionable: true,
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
      // B9.5 (DEC-157): the price and the balance now come from the ONE charge
      // path. This used to re-implement `resolveCreditPrice` as a Prisma
      // orderBy and fall back to a hard-coded `?? 1` — a second implementation
      // of the rule, and a literal price in the charge path (§7.10). Both are
      // gone; `priceFor` asks exactly the question `charge` will ask.
      const { price, balance } = await priceFor(tx, workspaceId, REVEAL_PRICE_ACTION);
      if (price !== null && price > 0 && balance < price) {
        throw new HttpException(
          {
            reason: "NOT_ENOUGH_CREDITS",
            message: `Revealing costs ${price} credit${price === 1 ? "" : "s"} — top up first.`,
            short: price - balance,
          },
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

      // Charged once, ever: an already-known contact costs nothing. This is
      // dedupe, and it is BELT to the charge path's braces — the idempotency
      // key on (workspace, contact, lead_reveal) means a retry of this very
      // request cannot double-charge even for a brand-new contact.
      if (existing) {
        // B6.5 bug fix: the provider payload was fetched and then thrown
        // away, so a second reveal of the same person re-hit the provider
        // and still learned nothing. Merge it onto the contact we already
        // hold — no charge, no ledger row, but the data is kept.
        await tx.contact.update({
          where: { id: existing.id },
          data: {
            ...(existing.phone ? {} : revealed.phone ? { phone: revealed.phone } : {}),
            ...(existing.email ? {} : revealed.email ? { email: revealed.email } : {}),
            ...(existing.title ? {} : revealed.title ? { title: revealed.title } : {}),
            ...(existing.company ? {} : revealed.company ? { company: revealed.company } : {}),
            enrichment: {
              provider: this.provider.name,
              providerRef: parsed.data.providerRef,
              raw: revealed.raw,
            } as Prisma.InputJsonValue,
          },
        });
        return { contactId: contact.id, alreadyKnown: true, charged: 0, balance };
      }
      const result = await charge(tx, {
        workspaceId,
        action: REVEAL_PRICE_ACTION,
        // The contact is the produced row, so revealing the same person twice
        // — by retry or by race — charges exactly once, ever.
        sourceType: "contact",
        sourceId: contact.id,
        channel: REVEAL_PRICE_ACTION,
        metadata: { provider: this.provider.name, providerRef: parsed.data.providerRef },
      });
      if (result.outcome === "refused") {
        throw new HttpException(
          {
            reason: "NOT_ENOUGH_CREDITS",
            message: `Revealing costs ${result.price} credit${result.price === 1 ? "" : "s"} — top up first.`,
            short: result.short,
          },
          422,
        );
      }
      // Only a charge that actually moved the balance is spend to announce; a
      // replay already published its event the first time.
      if (result.outcome === "charged") {
        await this.publisher.publish({
          type: EVENT_TYPES.CREDITS_CONSUMED,
          workspaceId,
          contactId: contact.id,
          payload: { amount: result.charged, channel: REVEAL_PRICE_ACTION, balance: result.balanceAfter },
        });
      }
      return {
        contactId: contact.id,
        alreadyKnown: false,
        charged: result.outcome === "charged" ? result.charged : 0,
        balance: result.balanceAfter,
      };
    });
  }

  /**
   * "All who fit" — the standing pool as BANDS, cheapest first. 4,180 people
   * cannot be browsed row by row, so the surface is volume and cost.
   *
   * Only ALREADY YOURS can be counted from shipped data: it is the workspace's
   * own contacts, scored by our own scorer. The three paid bands describe the
   * open market, whose size only the provider knows — so their count is
   * `null` with a plain reason, never an invented estimate (DEC-115). Provider
   * match counts are B10.5 (Q-140).
   */
  @Get("pool")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async pool() {
    const profile = await this.profile();
    const suppression = await this.suppressionBreakdown();
    return this.tenant.run(async (tx) => {
      const now = Date.now();
      // B6.6: the pool asks the scorer the SAME question the market feed
      // asks. It used to pass only `{title, company}` — so on any book whose
      // people are not job titles (every local_business and consumer
      // workspace: patients, households, members) no reason could ever
      // match, every row came back with zero reasons, and the surface
      // correctly but uselessly printed `unscored` on all of them with no
      // why-chips beside it. The facts below are the ones `ownBookCandidates`
      // already reads; sharing them is what makes one score mean one thing.
      const [active, happy, optOut, lastTouch, replied] = await Promise.all([
        tx.enrollment.findMany({ where: { status: "ACTIVE" }, select: { contactId: true } }),
        tx.enrollment.findMany({
          where: { pipelineStage: { in: [...HAPPY_STAGES] } },
          select: { contactId: true },
        }),
        tx.contact.findMany({
          where: {
            OR: [
              { optOut: { path: ["email"], equals: true } },
              { optOut: { path: ["sms"], equals: true } },
            ],
          },
          select: { id: true },
        }),
        tx.message.groupBy({ by: ["contactId"], _max: { sentAt: true } }),
        tx.message.findMany({
          where: { direction: "INBOUND" },
          select: { contactId: true },
          distinct: ["contactId"],
        }),
      ]);
      const out = new Set([
        ...active.map((e) => e.contactId),
        ...happy.map((e) => e.contactId),
        ...optOut.map((c) => c.id),
      ]);
      const touchById = new Map(lastTouch.map((t) => [t.contactId, t._max.sentAt]));
      const repliedSet = new Set(replied.map((m) => m.contactId));
      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        take: 500,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          title: true,
          company: true,
          callConsent: true,
          enrichment: true,
        },
      });
      const yours = contacts
        .filter((c) => !out.has(c.id))
        .filter((c) => Boolean(c.email) || Boolean(c.phone))
        .map((c) => {
          const last = touchById.get(c.id) ?? null;
          const scored = scoreCandidate(profile, {
            title: c.title,
            company: c.company,
            location: contactLocation(c.enrichment),
            repliedBefore: repliedSet.has(c.id),
            daysSinceLastTouch: last ? Math.floor((now - last.getTime()) / 86_400_000) : null,
            callConsentGranted: c.callConsent === "granted",
          });
          return {
            id: `own:${c.id}`,
            contactId: c.id,
            name:
              [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed contact",
            fit: scored.fit,
            // B6.5 review fix 2 (owner ruling): ONE scoring vocabulary. The
            // feed said `unscored` while the pool printed `50 fit` for the
            // same person — and 50 is the scorer's BASE with zero matching
            // facts, which is the fake precision ruled out at the B6 review.
            // When no fact backs a number, both surfaces say `unscored`.
            scored: scored.reasons.length > 0,
            why: scored.reasons,
            // The prototype's descriptor line is "38 · Austin". We hold
            // neither an age nor a city on a contact (Q-160, Q-161) — so this
            // says what we DO hold and nothing more: the title and company
            // when the book is businesses, and the place the provider gave
            // us when the row came from a reveal. A workspace whose people
            // are patients gets an empty line rather than a made-up one.
            about: [c.title, c.company, contactLocation(c.enrichment)]
              .filter(Boolean)
              .join(" · "),
            sourceTag: "YOUR RECORDS",
            onFile: true,
          };
        })
        // No fit floor here, deliberately. `POOL_BANDS.yours` declares
        // `min: null`: the band is defined by ALREADY HOLDING the details,
        // not by a score, and "below 70 is not offered" is about buying
        // strangers. Applying the paid floor here emptied the one band a
        // day-one workspace can actually work.
        .sort((a, b) => b.fit - a.fit);

      const bands = POOL_BANDS.map((b) =>
        b.key === "yours"
          ? {
              ...b,
              count: yours.length,
              estimate: false,
              rows: yours.slice(0, 12),
              // B6.6: the WHOLE band, not just the twelve rows on screen.
              // The bulk action says "Add 312 to a campaign" and has to mean
              // it — adding the visible twelve under that label would be a
              // lie. Only the free band carries these: every other band is
              // people whose details we do not hold, so they have no contact
              // id to add.
              contactIds: yours.map((r) => r.contactId),
              note: null as string | null,
            }
          : {
              ...b,
              // Honest absence: the open market's size is the provider's to
              // report and no provider count exists on this deployment.
              count: null,
              estimate: false,
              rows: [] as typeof yours,
              contactIds: [] as string[],
              note: "This band counts the open market, which needs the search provider — it is not a number we can estimate honestly yet.",
            },
      );
      return {
        bands,
        total: yours.length,
        noun: subjectNounFor(profile.shape, profile.vertical ?? null),
        scoredNote: this.briefSentence(profile),
        suppression,
      };
    });
  }

  /** The detail behind "Show them" — one source, same numbers as the foot. */
  @Get("suppressed")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async suppressed() {
    return this.suppressionBreakdown();
  }

  /**
   * `Edit brief` (SURFACE_SPEC §11). The ICP profile is written once at first
   * run by POST /workspaces; this is its only update path, and it stamps when
   * the watch was last changed so `WATCHING SINCE` is a real date.
   */
  @Post("brief")
  @Roles(Role.OWNER, Role.ADMIN)
  async brief(@Body() body: unknown) {
    const parsed = briefSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid brief");
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const settings = (ws.settings ?? {}) as Record<string, unknown>;
      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          settings: {
            ...settings,
            icpProfile: parsed.data,
            briefUpdatedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return { ok: true, profile: parsed.data };
    });
  }
}
