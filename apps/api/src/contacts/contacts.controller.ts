import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { contactCustomValuesSchema, importContactsSchema } from "@clientforce/core";
import { EVENT_TYPES } from "@clientforce/events";
import { EVENTS_PUBLISHER, type EventsPublisher } from "../events/publisher";
import { Role, type Prisma } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";

interface CreateContactDto {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
  title?: string;
  custom?: unknown;
}


/**
 * Minimal tenant-scoped resource used to exercise tenancy + RBAC:
 *   - GET is readable by any member (rows scoped by RLS to the active workspace).
 *   - POST is a write restricted to OWNER/ADMIN/AGENT (VIEWER denied).
 * C2.7 adds `custom` values (validated against ACTIVE workspace defs, unknown
 * keys rejected) on create, and PATCH :id for the detail-drawer inline edit.
 */
@Controller("contacts")
export class ContactsController {
  constructor(
    private readonly tenant: TenantClient,
    @Inject(EVENTS_PUBLISHER) private readonly publisher: EventsPublisher,
  ) {}

  /**
   * IMP-3 (owner bug round 2026-07-08): CSV import executes server-side — ONE
   * transactional call per chunk replaces the per-row request storm. Within-
   * batch dedupe (first occurrence wins) + workspace dedupe (case-insensitive
   * email), suppression flagging (suppressed rows still create — A7 blocks at
   * send time), C2.7 custom-value validation, C2.8 list attach. Per-row
   * failures are collected BEFORE any write: a mid-transaction create failure
   * would poison the Postgres tx, so everything that can fail is validated
   * up front and the write phase is all-or-nothing per chunk.
   */
  @Post("import")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async import(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = importContactsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const dto = parsed.data;
    const workspaceId = req.auth!.activeWorkspaceId;
    const addedBy = req.auth!.user.id;

    const result = await this.tenant.run(async (tx) => {
      // Within-batch dedupe — first occurrence wins, later repeats skip.
      const seen = new Set<string>();
      const batch: Array<{ index: number; email: string; row: (typeof dto.rows)[number] }> = [];
      let skippedDuplicates = 0;
      dto.rows.forEach((row, index) => {
        const email = row.email.trim().toLowerCase();
        if (seen.has(email)) {
          skippedDuplicates += 1;
          return;
        }
        seen.add(email);
        batch.push({ index, email, row });
      });

      // Workspace dedupe (case-insensitive) + suppression flags, one query each.
      const [existing, suppressions] = await Promise.all([
        tx.contact.findMany({
          where: { OR: batch.map((b) => ({ email: { equals: b.email, mode: "insensitive" as const } })) },
          select: { email: true },
        }),
        tx.suppression.findMany({ where: { channel: "email" }, select: { address: true } }),
      ]);
      const existingSet = new Set(existing.map((e) => (e.email ?? "").toLowerCase()));
      const suppressedSet = new Set(suppressions.map((s) => s.address.toLowerCase()));

      // C2.7 custom validation, batched: one defs fetch for the whole chunk.
      const allKeys = new Set<string>();
      for (const b of batch) for (const k of Object.keys(b.row.custom ?? {})) allKeys.add(k);
      const activeDefs =
        allKeys.size > 0
          ? await tx.contactFieldDef.findMany({
              where: { key: { in: [...allKeys] }, archived: false },
              select: { key: true },
            })
          : [];
      const knownKeys = new Set(activeDefs.map((d) => d.key));

      const failed: Array<{ index: number; email: string; reason: string }> = [];
      const creatable: typeof batch = [];
      for (const b of batch) {
        if (existingSet.has(b.email)) {
          skippedDuplicates += 1;
          continue;
        }
        const unknown = Object.keys(b.row.custom ?? {}).filter((k) => !knownKeys.has(k));
        if (unknown.length > 0) {
          failed.push({
            index: b.index,
            email: b.row.email,
            reason: `Unknown or archived custom field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
          });
          continue;
        }
        creatable.push(b);
      }

      let created = 0;
      let suppressed = 0;
      const createdIds: string[] = [];
      for (const b of creatable) {
        const c = await tx.contact.create({
          data: {
            workspaceId,
            source: "csv_import",
            optOut: {},
            tags: [],
            email: b.row.email.trim(),
            firstName: b.row.firstName ?? null,
            lastName: b.row.lastName ?? null,
            company: b.row.company ?? null,
            phone: b.row.phone ?? null,
            title: b.row.title ?? null,
            ...(b.row.custom && Object.keys(b.row.custom).length > 0
              ? { custom: b.row.custom as Prisma.InputJsonValue }
              : {}),
          },
        });
        createdIds.push(c.id);
        created += 1;
        if (suppressedSet.has(b.email)) suppressed += 1;
      }

      // C2.8 list attach — archived lists never gain members.
      let list: { id: string; name: string; origin: string } | null = null;
      if (dto.listId && createdIds.length > 0) {
        const row = await tx.contactList.findUnique({ where: { id: dto.listId } });
        if (row && !row.archived) {
          await tx.contactListMember.createMany({
            data: createdIds.map((contactId) => ({ workspaceId, listId: row.id, contactId, addedBy })),
            skipDuplicates: true,
          });
          list = { id: row.id, name: row.name, origin: row.origin };
        }
      }
      return { created, skippedDuplicates, suppressed, failed, createdIds, list };
    });

    // Membership events publish after the transaction commits (C2.8 join points).
    if (result.list) {
      for (const contactId of result.createdIds) {
        await this.publisher.publish({
          type: EVENT_TYPES.LIST_MEMBER_ADDED,
          workspaceId,
          contactId,
          payload: {
            listId: result.list.id,
            listName: result.list.name,
            addedBy,
            origin: result.list.origin,
          },
        });
      }
    }
    return {
      created: result.created,
      skippedDuplicates: result.skippedDuplicates,
      suppressed: result.suppressed,
      failed: result.failed,
    };
  }

  /** C2.8: `?listId=` scopes to explicit membership; rows carry active lists. */
  @Get()
  list(@Query("listId") listId?: string) {
    return this.tenant.run(async (tx) => {
      const contacts = await tx.contact.findMany({
        orderBy: { createdAt: "asc" },
        ...(listId ? { where: { lists: { some: { listId } } } } : {}),
        include: {
          lists: { select: { list: { select: { id: true, name: true, archived: true } } } },
        },
      });
      return contacts.map(({ lists, ...c }) => ({
        ...c,
        lists: lists
          .filter((m) => !m.list.archived)
          .map((m) => ({ id: m.list.id, name: m.list.name })),
      }));
    });
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  create(@Req() req: AuthenticatedRequest, @Body() body: CreateContactDto) {
    const workspaceId = req.auth!.activeWorkspaceId;
    return this.tenant.run(async (tx) => {
      const custom = await validateCustom(tx, body.custom);
      return tx.contact.create({
        data: {
          workspaceId,
          source: "manual",
          optOut: {},
          tags: [],
          email: body.email ?? null,
          firstName: body.firstName ?? null,
          lastName: body.lastName ?? null,
          company: body.company ?? null,
          phone: body.phone ?? null,
          title: body.title ?? null,
          ...(custom ? { custom: custom as Prisma.InputJsonValue } : {}),
        },
      });
    });
  }

  /** C2.7: custom-value edit (detail drawer). Values merge; defs never change here. */
  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  update(@Param("id") id: string, @Body() body: { custom?: unknown }) {
    return this.tenant.run(async (tx) => {
      const contact = await tx.contact.findUnique({ where: { id } });
      if (!contact) throw new NotFoundException(`Contact ${id} not found`);
      const custom = await validateCustom(tx, body.custom);
      if (!custom) throw new BadRequestException("Provide custom values to update");
      const merged = {
        ...(contact.custom && typeof contact.custom === "object" && !Array.isArray(contact.custom)
          ? (contact.custom as Record<string, unknown>)
          : {}),
        ...custom,
      };
      return tx.contact.update({
        where: { id },
        data: { custom: merged as Prisma.InputJsonValue },
      });
    });
  }
}

/** Validates `custom` against ACTIVE defs — unknown/archived keys reject (400). */
async function validateCustom(
  tx: Prisma.TransactionClient,
  raw: unknown,
): Promise<Record<string, string> | null> {
  if (raw === undefined || raw === null) return null;
  const parsed = contactCustomValuesSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException("custom must map field keys to string values");
  const keys = Object.keys(parsed.data);
  if (keys.length === 0) return null;
  const defs = await tx.contactFieldDef.findMany({
    where: { key: { in: keys }, archived: false },
    select: { key: true },
  });
  const known = new Set(defs.map((d) => d.key));
  const unknown = keys.filter((k) => !known.has(k));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `Unknown or archived custom field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
    );
  }
  return parsed.data;
}
