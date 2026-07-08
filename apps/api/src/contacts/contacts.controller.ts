import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { contactCustomValuesSchema } from "@clientforce/core";
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
  constructor(private readonly tenant: TenantClient) {}

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
