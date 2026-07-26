/**
 * INT W5 (DEC-101) — the Zapier REST rail.
 *
 * TRIGGERS ARE POLLED, deliberately. Zapier's alternative is REST hooks, which
 * would need a subscription store, an outbound delivery path and its own SSRF
 * surface — and the generic "every event as it happens" stream is explicitly
 * NOT built (it is Q-054). Polling the PERSISTED `Event` log instead reuses the
 * exact emissions the webhook action publishes, adds no delivery guarantees to
 * get wrong, and rides an index that already exists
 * (`@@index([workspaceId, type, occurredAt])`). Zapier de-dupes on `id`, so a
 * repeated poll is harmless by construction.
 *
 * Every query runs through `withTenant` on the RLS-subject app role — the guard
 * resolved the workspace, and nothing here widens that scope.
 */
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { withTenant } from "@clientforce/db";
import {
  ZAPIER_REFUSALS,
  zapierInboundWriteSchemas,
  zapierPollQuerySchema,
  type ZapierInboundWriteKind,
} from "@clientforce/core";
import {
  buildZapierManifest,
  isZapierTriggerKey,
  ZAPIER_TRIGGERS,
  type ZapierTriggerKey,
} from "@clientforce/integrations";
import { PrismaService } from "../db/prisma.service";
import { ZAPIER_CTX, ZapierAuthGuard, type ZapierRequestContext } from "./zapier-auth.guard";
import { ZapierWritesService } from "./zapier-writes.service";

const ctxOf = (req: unknown): ZapierRequestContext =>
  (req as Record<string, ZapierRequestContext>)[ZAPIER_CTX]!;

@Controller("zapier/v1")
@UseGuards(ZapierAuthGuard)
export class ZapierController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writes: ZapierWritesService,
  ) {}

  /** Zapier's auth test — renders as the connection label in the Zap editor. */
  @Get("me")
  async me(@Req() req: unknown) {
    const { workspaceId } = ctxOf(req);
    const ws = await this.prisma.admin.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true, agency: { select: { name: true } } },
    });
    return {
      workspaceId,
      label: ws?.name ?? "Clientforce workspace",
      ...(ws?.agency?.name ? { agencyName: ws.agency.name } : {}),
    };
  }

  /** The derived surface, so the app definition can be verified against a live rail. */
  @Get("manifest")
  manifest() {
    return buildZapierManifest();
  }

  /**
   * Poll one trigger. `since` is the previous page's newest `occurredAt`;
   * results come back newest-first, which is the order Zapier expects.
   */
  @Get("triggers/:key")
  async poll(@Param("key") key: string, @Query() query: unknown, @Req() req: unknown) {
    if (!isZapierTriggerKey(key)) throw new NotFoundException(ZAPIER_REFUSALS.UNKNOWN_TRIGGER);
    const parsed = zapierPollQuerySchema.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? "Bad query");

    const { workspaceId } = ctxOf(req);
    const spec = ZAPIER_TRIGGERS[key as ZapierTriggerKey];
    const limit = parsed.data.limit ?? 50;

    const rows = await withTenant(this.prisma.app, { workspaceId }, (tx) =>
      tx.event.findMany({
        where: {
          workspaceId,
          type: { in: [...spec.eventTypes] },
          ...(parsed.data.since ? { occurredAt: { gt: new Date(parsed.data.since) } } : {}),
        },
        orderBy: { occurredAt: "desc" },
        // Over-fetch when a payload predicate applies, so filtering cannot
        // return a short page and make Zapier think the stream ran dry.
        take: spec.matches ? limit * 4 : limit,
        select: {
          id: true,
          type: true,
          occurredAt: true,
          payload: true,
          contactId: true,
          campaignId: true,
          enrollmentId: true,
        },
      }),
    );

    const matched = spec.matches
      ? rows.filter((r) => spec.matches!((r.payload ?? {}) as Record<string, unknown>))
      : rows;

    return matched.slice(0, limit).map((r) => ({
      // Zapier de-dupes on `id`; the Event id is already unique and stable.
      id: r.id,
      type: r.type,
      occurredAt: r.occurredAt.toISOString(),
      contactId: r.contactId,
      campaignId: r.campaignId,
      enrollmentId: r.enrollmentId,
      ...(r.payload && typeof r.payload === "object" ? (r.payload as Record<string, unknown>) : {}),
    }));
  }

  /** Perform an inbound write. The kind must be a registered write. */
  @Post("writes/:kind")
  async write(@Param("kind") kind: string, @Req() req: unknown) {
    const schema = (zapierInboundWriteSchemas as Record<string, { safeParse: (v: unknown) => unknown }>)[
      kind
    ];
    if (!schema) throw new NotFoundException(ZAPIER_REFUSALS.UNKNOWN_WRITE);

    const body = (req as { body?: unknown }).body ?? {};
    const parsed = zapierInboundWriteSchemas[kind as ZapierInboundWriteKind]!.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? "Invalid payload");
    }

    const { workspaceId } = ctxOf(req);
    return this.writes.perform(workspaceId, kind as ZapierInboundWriteKind, parsed.data);
  }
}
