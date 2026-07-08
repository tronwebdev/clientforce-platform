import { BadRequestException, Body, ConflictException, Controller, Post, Req } from "@nestjs/common";
import { PrismaService } from "../db/prisma.service";
import { AllowNoMembership } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";

/**
 * A3 first-run (DEC-060): a freshly signed-up principal has a User row (lazy
 * upsert) but no membership — the web's minimal "Create workspace" modal calls
 * this to bootstrap Agency → Workspace → OWNER membership in one shot. Owner
 * client on purpose: there is no tenant to scope to yet. Deliberately
 * first-run ONLY (409 once any membership exists) — additional workspaces are
 * an agency-management concern, not this endpoint's.
 */
@Controller("workspaces")
export class WorkspacesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  @AllowNoMembership()
  async create(@Req() req: AuthenticatedRequest, @Body() body: { name?: string }) {
    const name = String(body?.name ?? "").trim();
    if (name.length < 2 || name.length > 80) {
      throw new BadRequestException("Workspace name must be 2–80 characters");
    }
    const userId = req.auth!.user.id;
    const existing = await this.prisma.admin.membership.count({ where: { userId } });
    if (existing > 0) throw new ConflictException("You already belong to a workspace");

    const slugBase = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace";
    const slug = `${slugBase}-${Date.now().toString(36)}`;

    const workspace = await this.prisma.admin.$transaction(async (tx) => {
      const agency = await tx.agency.create({ data: { name, slug, branding: {} } });
      const ws = await tx.workspace.create({
        data: { agencyId: agency.id, name, slug, settings: {} },
      });
      await tx.membership.create({ data: { userId, workspaceId: ws.id, role: "OWNER" } });
      return ws;
    });
    return { id: workspace.id, name: workspace.name, slug: workspace.slug };
  }
}
