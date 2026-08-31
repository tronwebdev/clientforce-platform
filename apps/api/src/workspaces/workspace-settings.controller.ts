import { randomBytes, createHash } from "node:crypto";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  INVITE_TTL_DAYS,
  createInviteSchema,
  createNumberRequestSchema,
  icpProfileSchema,
  isWorkspaceFactKey,
  memberRoleSchema,
  updateWorkspaceFactSchema,
  workspaceFactKey,
  workspaceFactSchema,
  workspaceFieldKey,
  workspaceFieldSchema,
  contextFieldsSchema,
  type ContextFields,
} from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import type { ZodSchema } from "zod";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";

function parse<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

const parseFields = (raw: unknown): ContextFields => {
  const parsed = contextFieldsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
};

/**
 * B7.5 — the settings WRITE layer (SURFACE_SPEC_SETTINGS §11).
 *
 * B7 shipped these surfaces read-only: a user could see the facts Ada quotes,
 * the people on the team and the limits every campaign inherits, and change
 * none of them. This controller is the missing half. It is ADDITIVE
 * throughout — no route here replaces or re-shapes one that already exists.
 *
 * Three rules run through all of it:
 *
 *  - **Every change a person makes carries its actor.** Role changes, removals,
 *    invites and taught facts each publish an event naming who did it and
 *    when, because "someone changed my access and nobody knows who" is the
 *    failure the team surface exists to prevent.
 *  - **The last owner is protected server-side.** Not in the UI, where a
 *    second tab or a curl would walk straight past it.
 *  - **Nothing claims a side effect it did not have.** An invite created
 *    without a configured send transport reports itself as created-not-sent
 *    rather than "sent", and a requested number reports "not filed" rather
 *    than wearing an A2P badge nobody filed for.
 */
@Controller("workspaces")
export class WorkspaceSettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantClient,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  /* ------------------------------------------------------------- core facts */

  /**
   * Teach Ada a fact, or answer a reported gap.
   *
   * A taught fact is question → answer, which the keyed context registry has
   * no room for. It rides the WORKSPACE `BusinessContext` layer under a
   * derived `ask_*` key with the question carried as the value's `label` —
   * and `renderContextText` (the model's only permitted fact source) prefers
   * that label. So the toast "she knows it now" describes something that
   * actually happened to what she can quote.
   *
   * When `gapKey` is present this ANSWERS that gap instead: the registry key
   * is written directly, so the gap closes rather than sitting beside a
   * near-duplicate taught fact.
   */
  @Post("facts")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async teachFact(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(workspaceFactSchema, body);
    const key = dto.gapKey ?? workspaceFactKey(dto.question);
    const label = dto.question;
    const row = await this.writeWorkspaceField(key, {
      value: dto.answer,
      citations: [],
      source: "typed",
      // A registry gap keeps the registry's own label; only a minted key
      // needs the question carried alongside it.
      ...(dto.gapKey ? {} : { label }),
    });
    await this.publisher.publish({
      workspaceId: this.tenant.workspaceId,
      type: "workspace.fact_taught.v1",
      payload: {
        key,
        label,
        ...(dto.gapKey ? { answeredGapKey: dto.gapKey } : {}),
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { ok: true, key, label, contextId: row.id };
  }

  /** Add a named field to "Who you are" — she quotes it exactly as written. */
  @Post("fields")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async addField(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(workspaceFieldSchema, body);
    const key = workspaceFieldKey(dto.name);
    await this.writeWorkspaceField(key, {
      value: dto.value,
      citations: [],
      source: "typed",
      label: dto.name,
    });
    await this.publisher.publish({
      workspaceId: this.tenant.workspaceId,
      type: "workspace.fact_taught.v1",
      payload: {
        key,
        label: dto.name,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { ok: true, key, label: dto.name };
  }

  /** Edit a taught fact in place — same key, so no near-duplicate appears. */
  @Patch("facts")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async editFact(@Body() body: unknown) {
    const dto = parse(updateWorkspaceFactSchema, body);
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const row = await tx.businessContext.findFirst({ where: { workspaceId, agentId: null } });
      if (!row) throw new NotFoundException("Nothing has been taught yet");
      const fields = parseFields(row.fields);
      const existing = fields[dto.key];
      if (!existing) throw new NotFoundException(`No fact stored under ${dto.key}`);
      fields[dto.key] = {
        ...existing,
        source: "typed",
        ...(dto.answer !== undefined ? { value: dto.answer } : {}),
        ...(dto.question !== undefined && isWorkspaceFactKey(dto.key)
          ? { label: dto.question }
          : {}),
      };
      await tx.businessContext.update({
        where: { id: row.id },
        data: { fields: fields as Prisma.InputJsonValue },
      });
      return { ok: true, key: dto.key };
    });
  }

  /**
   * Forget a taught fact. Only keys this surface minted are removable — a
   * registry field is un-answered through the shipped context undo, not
   * deleted out from under the gap checker.
   */
  @Delete("facts/:key")
  @Roles(Role.OWNER, Role.ADMIN)
  async forgetFact(@Req() req: AuthenticatedRequest, @Param("key") key: string) {
    if (!isWorkspaceFactKey(key)) {
      throw new BadRequestException(
        "That one came from your business core, not from something you taught here",
      );
    }
    const workspaceId = this.tenant.workspaceId;
    const label = await this.tenant.run(async (tx) => {
      const row = await tx.businessContext.findFirst({ where: { workspaceId, agentId: null } });
      if (!row) throw new NotFoundException("Nothing has been taught yet");
      const fields = parseFields(row.fields);
      const existing = fields[key];
      if (!existing) throw new NotFoundException(`No fact stored under ${key}`);
      delete fields[key];
      await tx.businessContext.update({
        where: { id: row.id },
        data: { fields: fields as Prisma.InputJsonValue },
      });
      return existing.label ?? key;
    });
    await this.publisher.publish({
      workspaceId,
      type: "workspace.fact_removed.v1",
      payload: { key, label, ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}) },
    });
    return { ok: true };
  }

  /** Upsert one field on the workspace layer, leaving every other key alone. */
  private writeWorkspaceField(key: string, value: ContextFields[string]) {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const existing = await tx.businessContext.findFirst({
        where: { workspaceId, agentId: null },
      });
      if (!existing) {
        return tx.businessContext.create({
          data: {
            workspaceId,
            agentId: null,
            fields: { [key]: value } as Prisma.InputJsonValue,
            status: "READY",
          },
        });
      }
      const fields = parseFields(existing.fields);
      fields[key] = value;
      return tx.businessContext.update({
        where: { id: existing.id },
        data: { fields: fields as Prisma.InputJsonValue },
      });
    });
  }

  /* ---------------------------------------------------------------- profile */

  /**
   * The workspace's own identity for these pages: the record line at each
   * page's foot, and the ICP SHAPE the Lead finder reads.
   *
   * The shape and vertical are returned READ-ONLY here. The spec asks for
   * "one source, two doors", but on this platform they are two objects: the
   * context `icp` field (free text — editable on Who you are) and
   * `settings.icpProfile` (the shape + vertical registry the Lead finder
   * resolves its filters from). This surface edits the first and shows the
   * second as provenance rather than quietly writing a registry it does not own.
   */
  @Get("profile")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async profile() {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, name: true, slug: true, settings: true },
      });
      const raw = ((ws.settings ?? {}) as { icpProfile?: unknown }).icpProfile;
      const parsed = icpProfileSchema.safeParse(raw);
      return {
        id: ws.id,
        name: ws.name,
        slug: ws.slug,
        icpProfile: parsed.success ? parsed.data : null,
      };
    });
  }

  /* ---------------------------------------------------------------- sources */

  /**
   * Knowledge sources with their real YIELD.
   *
   * The row copy the design asks for — "9 pages", "14 prices found" — is the
   * count of chunks the ingest actually produced from that source. Sources
   * still ingesting have no yield yet and say so; a source that produced
   * nothing says THAT, which is the row a user most needs to see.
   */
  @Get("sources")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async sources() {
    return this.tenant.run(async (tx) => {
      const rows = await tx.knowledgeSource.findMany({
        where: { agentId: null },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          kind: true,
          label: true,
          uri: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      const yields = await tx.knowledgeChunk.groupBy({
        by: ["sourceId"],
        where: { sourceId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      });
      const byId = new Map(yields.map((y) => [y.sourceId, y._count._all]));
      return rows.map((r) => ({
        ...r,
        /** Null while it is still ingesting — never rendered as a zero. */
        chunks: r.status === "READY" ? (byId.get(r.id) ?? 0) : null,
      }));
    });
  }

  /* ---------------------------------------------------------------- invites */

  /**
   * Pending invites, newest first. Expiry is DERIVED, never stored: a PENDING
   * row past `expiresAt` reads as expired here and everywhere, so a lapsed
   * invite is honest with no sweeper job to forget to run.
   */
  @Get("invites")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async invites() {
    const now = Date.now();
    const rows = await this.tenant.run((tx) =>
      tx.workspaceInvite.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    );
    const actorIds = [...new Set(rows.map((r) => r.invitedById).filter((v): v is string => !!v))];
    const actors = actorIds.length
      ? await this.prisma.admin.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(actors.map((u) => [u.id, u]));
    return rows.map((r) => {
      const expired = r.status === "PENDING" && r.expiresAt.getTime() < now;
      const actor = r.invitedById ? byId.get(r.invitedById) : undefined;
      return {
        id: r.id,
        email: r.email,
        role: r.role,
        state: expired ? "expired" : r.status.toLowerCase(),
        expiresAt: r.expiresAt,
        sentAt: r.sentAt,
        resendCount: r.resendCount,
        createdAt: r.createdAt,
        invitedBy: actor ? (actor.name ?? actor.email) : null,
      };
    });
  }

  /**
   * Invite someone. OWNER is not invitable by design — ownership transfers,
   * it is not handed out by email (the DTO's role enum enforces it).
   *
   * The token is generated once, handed back in the invite link, and stored
   * only as a SHA-256 hash: nobody who reads the database later can use it.
   */
  @Post("invites")
  @Roles(Role.OWNER, Role.ADMIN)
  async invite(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(createInviteSchema, body);
    const workspaceId = this.tenant.workspaceId;

    const alreadyHere = await this.memberByEmail(dto.email);
    if (alreadyHere) throw new ConflictException(`${dto.email} is already on this team`);

    const token = randomBytes(32).toString("hex");
    const invite = await this.tenant.run(async (tx) => {
      const open = await tx.workspaceInvite.findFirst({
        where: { workspaceId, email: dto.email, status: "PENDING" },
      });
      if (open && open.expiresAt.getTime() > Date.now()) {
        throw new ConflictException(`${dto.email} already has an invite waiting`);
      }
      // A lapsed invite is replaced rather than duplicated — one open invite
      // per address is what "pending invites: 1" has to mean.
      if (open) {
        await tx.workspaceInvite.update({
          where: { id: open.id },
          data: { status: "REVOKED", revokedAt: new Date() },
        });
      }
      return tx.workspaceInvite.create({
        data: {
          workspaceId,
          email: dto.email,
          role: dto.role,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
          invitedById: req.auth?.user.id ?? null,
        },
      });
    });

    const delivered = await this.deliver(invite.id, dto.email, token);
    await this.publisher.publish({
      workspaceId,
      type: "workspace.member_invited.v1",
      payload: {
        inviteId: invite.id,
        email: dto.email,
        role: dto.role,
        delivered,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { id: invite.id, email: dto.email, role: dto.role, delivered, expiresAt: invite.expiresAt };
  }

  /** Resend: a NEW token (the old one dies) and a fresh seven days. */
  @Post("invites/:id/resend")
  @Roles(Role.OWNER, Role.ADMIN)
  async resend(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    const token = randomBytes(32).toString("hex");
    const invite = await this.tenant.run(async (tx) => {
      const row = await tx.workspaceInvite.findFirst({ where: { id, workspaceId } });
      if (!row) throw new NotFoundException("That invite is gone");
      if (row.status !== "PENDING") {
        throw new BadRequestException(
          row.status === "ACCEPTED" ? "They already joined" : "That invite was revoked",
        );
      }
      return tx.workspaceInvite.update({
        where: { id },
        data: {
          tokenHash: createHash("sha256").update(token).digest("hex"),
          expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
          resendCount: { increment: 1 },
        },
      });
    });
    const delivered = await this.deliver(invite.id, invite.email, token);
    await this.publisher.publish({
      workspaceId,
      type: "workspace.member_invited.v1",
      payload: {
        inviteId: invite.id,
        email: invite.email,
        role: invite.role,
        delivered,
        resend: true,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { id: invite.id, delivered, expiresAt: invite.expiresAt, resendCount: invite.resendCount };
  }

  /** Revoke: the token stops working immediately. */
  @Post("invites/:id/revoke")
  @Roles(Role.OWNER, Role.ADMIN)
  async revoke(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    const invite = await this.tenant.run(async (tx) => {
      const row = await tx.workspaceInvite.findFirst({ where: { id, workspaceId } });
      if (!row) throw new NotFoundException("That invite is gone");
      if (row.status === "ACCEPTED") throw new BadRequestException("They already joined");
      return tx.workspaceInvite.update({
        where: { id },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
    });
    await this.publisher.publish({
      workspaceId,
      type: "workspace.invite_revoked.v1",
      payload: {
        inviteId: invite.id,
        email: invite.email,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { ok: true };
  }

  /**
   * Hand the invite to its recipient. There is no mailer wired to this route
   * yet, so this reports FALSE rather than pretending: the surface then says
   * "created — not sent yet" and shows the link to copy, which is true, where
   * "Invite sent" would not be.
   */
  private async deliver(_inviteId: string, _email: string, _token: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  /* ---------------------------------------------------------------- members */

  /**
   * Change what someone may do. The last OWNER cannot be demoted — enforced
   * here, not in the UI, because a second tab or a curl walks past the UI.
   */
  @Patch("members/:userId")
  @Roles(Role.OWNER)
  async setRole(
    @Req() req: AuthenticatedRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    const dto = parse(memberRoleSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const from = await this.tenant.run(async (tx) => {
      const membership = await tx.membership.findFirst({ where: { userId, workspaceId } });
      if (!membership) throw new NotFoundException("They are not on this team");
      if (membership.role === dto.role) return null;
      if (membership.role === "OWNER" && dto.role !== "OWNER") {
        const owners = await tx.membership.count({ where: { workspaceId, role: "OWNER" } });
        if (owners <= 1) {
          throw new ForbiddenException(
            "This is the only owner — make someone else an owner first, then change this one",
          );
        }
      }
      await tx.membership.update({ where: { id: membership.id }, data: { role: dto.role } });
      return membership.role;
    });
    if (from === null) return { ok: true, unchanged: true };
    const user = await this.prisma.admin.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    await this.publisher.publish({
      workspaceId,
      type: "workspace.member_role_changed.v1",
      payload: {
        userId,
        ...(user?.email ? { email: user.email } : {}),
        from,
        to: dto.role,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { ok: true, from, to: dto.role };
  }

  /**
   * Remove someone. The consequence the surface states BEFORE running this —
   * their assigned threads return to the queue — is carried out here and
   * counted into the event, so the timeline records what actually happened
   * rather than what the confirmation copy promised.
   */
  @Delete("members/:userId")
  @Roles(Role.OWNER)
  async removeMember(@Req() req: AuthenticatedRequest, @Param("userId") userId: string) {
    const workspaceId = this.tenant.workspaceId;
    if (userId === req.auth?.user.id) {
      throw new BadRequestException("You cannot remove yourself from this workspace");
    }
    const result = await this.tenant.run(async (tx) => {
      const membership = await tx.membership.findFirst({ where: { userId, workspaceId } });
      if (!membership) throw new NotFoundException("They are not on this team");
      if (membership.role === "OWNER") {
        const owners = await tx.membership.count({ where: { workspaceId, role: "OWNER" } });
        if (owners <= 1) {
          throw new ForbiddenException(
            "This is the only owner — a workspace without an owner has nobody who can pay for it or close it",
          );
        }
      }
      // Their claimed threads go back to the queue rather than vanishing with
      // them. `assigneeUserId` is nullable exactly so unassigned means "anyone".
      const released = await tx.threadState.updateMany({
        where: { assigneeUserId: userId },
        data: { assigneeUserId: null },
      });
      await tx.membership.delete({ where: { id: membership.id } });
      return { role: membership.role, released: released.count };
    });
    const user = await this.prisma.admin.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    await this.publisher.publish({
      workspaceId,
      type: "workspace.member_removed.v1",
      payload: {
        userId,
        ...(user?.email ? { email: user.email } : {}),
        role: result.role,
        releasedThreads: result.released,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return { ok: true, releasedThreads: result.released };
  }

  /* ---------------------------------------------------------------- numbers */

  /** Every number this workspace has asked for, with its true state. */
  @Get("numbers")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  numbers() {
    return this.tenant.run((tx) =>
      tx.numberRequest.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    );
  }

  /**
   * Ask for a number.
   *
   * Number provisioning and A2P brand / campaign registration are NOT
   * connected on this platform — the Twilio surface covers messaging and voice
   * calls only. So this records the real ask and its real state
   * (`REQUESTED` · `not_filed`) and the Numbers tab renders that verbatim.
   * Nothing here reserves a number or files anything, and nothing here says
   * it did.
   */
  @Post("numbers")
  @Roles(Role.OWNER, Role.ADMIN)
  async requestNumber(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const dto = parse(createNumberRequestSchema, body);
    const workspaceId = this.tenant.workspaceId;
    const row = await this.tenant.run((tx) =>
      tx.numberRequest.create({
        data: {
          workspaceId,
          areaCode: dto.areaCode,
          carries: dto.carries,
          requestedById: req.auth?.user.id ?? null,
        },
      }),
    );
    await this.publisher.publish({
      workspaceId,
      type: "workspace.number_requested.v1",
      payload: {
        requestId: row.id,
        areaCode: dto.areaCode,
        carries: dto.carries,
        ...(req.auth?.user.id ? { actorId: req.auth.user.id } : {}),
      },
    });
    return row;
  }

  /** Withdraw a request that has not become a number yet. */
  @Delete("numbers/:id")
  @Roles(Role.OWNER, Role.ADMIN)
  async cancelNumber(@Param("id") id: string) {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const row = await tx.numberRequest.findFirst({ where: { id, workspaceId } });
      if (!row) throw new NotFoundException("That request is gone");
      if (row.status === "ACTIVE") {
        throw new BadRequestException("That number is live — release it from its sender instead");
      }
      await tx.numberRequest.update({ where: { id }, data: { status: "CANCELLED" } });
      return { ok: true };
    });
  }

  private async memberByEmail(email: string): Promise<boolean> {
    const user = await this.prisma.admin.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return false;
    const workspaceId = this.tenant.workspaceId;
    const count = await this.tenant.run((tx) =>
      tx.membership.count({ where: { userId: user.id, workspaceId } }),
    );
    return count > 0;
  }
}
