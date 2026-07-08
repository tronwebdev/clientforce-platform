import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  contactListMembersSchema,
  createContactListSchema,
  updateContactListSchema,
  type ContactListDto,
} from "@clientforce/core";
import { EVENT_TYPES } from "@clientforce/events";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import type { ZodSchema } from "zod";

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

/**
 * Contact lists (C2.8, docs/PLAN_CONTACT_LISTS.md). Lists are explicit stored
 * membership — segments stay derived queries. ANY member creates/manages
 * (owner decision: working data, unlike C2.7's admin-only field defs); no
 * list cap; archive, never delete. Every membership change publishes
 * `list.member.added.v1` / `list.member.removed.v1` — the Forms/Widget/
 * Automations join points (they also land as Event rows on the contact
 * timeline via the publisher).
 */
@Controller("lists")
export class ContactListsController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  @Get()
  async list(): Promise<ContactListDto[]> {
    return this.tenant.run(async (tx) => {
      const lists = await tx.contactList.findMany({
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { members: true } } },
      });
      return lists.map((l) => ({
        id: l.id,
        name: l.name,
        origin: l.origin,
        archived: l.archived,
        memberCount: l._count.members,
        createdAt: l.createdAt.toISOString(),
      }));
    });
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async create(@Req() req: AuthenticatedRequest, @Body() body: unknown): Promise<ContactListDto> {
    const dto = parse(createContactListSchema, body ?? {});
    const workspaceId = this.tenant.workspaceId;
    const addedBy = req.auth!.user.id;
    const created = await this.tenant.run(async (tx) => {
      const existing = await tx.contactList.findUnique({
        where: { workspaceId_name: { workspaceId, name: dto.name } },
      });
      if (existing) {
        throw new ConflictException(
          existing.archived
            ? `A list named "${dto.name}" exists in the archive — restore it instead.`
            : `A list named "${dto.name}" already exists.`,
        );
      }
      const list = await tx.contactList.create({
        data: { workspaceId, name: dto.name, origin: dto.origin ?? "manual" },
      });
      // "New list from selection" — assign the selection on create.
      const contactIds = await validMemberIds(tx, dto.contactIds ?? []);
      if (contactIds.length > 0) {
        await tx.contactListMember.createMany({
          data: contactIds.map((contactId) => ({
            workspaceId,
            listId: list.id,
            contactId,
            addedBy,
          })),
          skipDuplicates: true,
        });
      }
      return { list, contactIds };
    });
    await this.publishAdded(created.list, created.contactIds, addedBy);
    return {
      id: created.list.id,
      name: created.list.name,
      origin: created.list.origin,
      archived: created.list.archived,
      memberCount: created.contactIds.length,
      createdAt: created.list.createdAt.toISOString(),
    };
  }

  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async update(@Param("id") id: string, @Body() body: unknown): Promise<ContactListDto> {
    const dto = parse(updateContactListSchema, body ?? {});
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const list = await tx.contactList.findUnique({ where: { id } });
      if (!list) throw new NotFoundException();
      if (dto.name && dto.name !== list.name) {
        const dup = await tx.contactList.findUnique({
          where: { workspaceId_name: { workspaceId, name: dto.name } },
        });
        if (dup) throw new ConflictException(`A list named "${dto.name}" already exists.`);
      }
      const updated = await tx.contactList.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.archived !== undefined ? { archived: dto.archived } : {}),
        },
        include: { _count: { select: { members: true } } },
      });
      return {
        id: updated.id,
        name: updated.name,
        origin: updated.origin,
        archived: updated.archived,
        memberCount: updated._count.members,
        createdAt: updated.createdAt.toISOString(),
      };
    });
  }

  /** Bulk add. Existing members are skipped (no duplicate events). */
  @Post(":id/members")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async addMembers(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const dto = parse(contactListMembersSchema, body ?? {});
    const workspaceId = this.tenant.workspaceId;
    const addedBy = req.auth!.user.id;
    const result = await this.tenant.run(async (tx) => {
      const list = await tx.contactList.findUnique({ where: { id } });
      if (!list) throw new NotFoundException();
      if (list.archived) {
        throw new UnprocessableEntityException(
          `"${list.name}" is archived — restore it before adding contacts.`,
        );
      }
      const candidates = await validMemberIds(tx, dto.contactIds);
      const existing = await tx.contactListMember.findMany({
        where: { listId: id, contactId: { in: candidates } },
        select: { contactId: true },
      });
      const existingSet = new Set(existing.map((m) => m.contactId));
      const added = candidates.filter((c) => !existingSet.has(c));
      if (added.length > 0) {
        await tx.contactListMember.createMany({
          data: added.map((contactId) => ({ workspaceId, listId: id, contactId, addedBy })),
          skipDuplicates: true,
        });
      }
      return { list, added };
    });
    await this.publishAdded(result.list, result.added, addedBy);
    return { added: result.added.length, skipped: dto.contactIds.length - result.added.length };
  }

  /** Bulk remove. Removing from a list never deletes the contact. */
  @Delete(":id/members")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async removeMembers(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const dto = parse(contactListMembersSchema, body ?? {});
    const removedBy = req.auth!.user.id;
    const result = await this.tenant.run(async (tx) => {
      const list = await tx.contactList.findUnique({ where: { id } });
      if (!list) throw new NotFoundException();
      const existing = await tx.contactListMember.findMany({
        where: { listId: id, contactId: { in: dto.contactIds } },
        select: { contactId: true },
      });
      const removed = existing.map((m) => m.contactId);
      if (removed.length > 0) {
        await tx.contactListMember.deleteMany({
          where: { listId: id, contactId: { in: removed } },
        });
      }
      return { list, removed };
    });
    for (const contactId of result.removed) {
      await this.publisher.publish({
        type: EVENT_TYPES.LIST_MEMBER_REMOVED,
        workspaceId: this.tenant.workspaceId,
        contactId,
        payload: { listId: result.list.id, listName: result.list.name, removedBy },
      });
    }
    return { removed: result.removed.length };
  }

  private async publishAdded(
    list: { id: string; name: string; origin: string },
    contactIds: string[],
    addedBy: string,
  ): Promise<void> {
    for (const contactId of contactIds) {
      await this.publisher.publish({
        type: EVENT_TYPES.LIST_MEMBER_ADDED,
        workspaceId: this.tenant.workspaceId,
        contactId,
        payload: { listId: list.id, listName: list.name, addedBy, origin: list.origin },
      });
    }
  }
}

/** RLS scopes the lookup — ids outside the workspace simply don't resolve. */
async function validMemberIds(
  tx: { contact: { findMany: (args: object) => Promise<{ id: string }[]> } },
  contactIds: string[],
): Promise<string[]> {
  if (contactIds.length === 0) return [];
  const rows = await tx.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
