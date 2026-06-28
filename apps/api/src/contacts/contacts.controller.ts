import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";
import { TenantClient } from "../db/tenant-client";

interface CreateContactDto {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phone?: string;
}

/**
 * Minimal tenant-scoped resource used to exercise tenancy + RBAC:
 *   - GET is readable by any member (rows scoped by RLS to the active workspace).
 *   - POST is a write restricted to OWNER/ADMIN/AGENT (VIEWER denied).
 */
@Controller("contacts")
export class ContactsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  list() {
    return this.tenant.run((tx) => tx.contact.findMany({ orderBy: { createdAt: "asc" } }));
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  create(@Req() req: AuthenticatedRequest, @Body() body: CreateContactDto) {
    const workspaceId = req.auth!.activeWorkspaceId;
    return this.tenant.run((tx) =>
      tx.contact.create({
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
        },
      }),
    );
  }
}
