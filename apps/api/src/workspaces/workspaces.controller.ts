import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import {
  guardrailDefaultsSchema,
  parseGuardrailDefaults,
  parseGuardrails,
  type GuardrailDefaults,
} from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";
import { AllowNoMembership, Roles } from "../auth/decorators";
import type { AuthenticatedRequest } from "../auth/request-context";

/**
 * A3 first-run (DEC-060): a freshly signed-up principal has a User row (lazy
 * upsert) but no membership — the web's minimal "Create workspace" modal calls
 * this to bootstrap Agency → Workspace → OWNER membership in one shot. Owner
 * client on purpose: there is no tenant to scope to yet. Deliberately
 * first-run ONLY (409 once any membership exists) — additional workspaces are
 * an agency-management concern, not this endpoint's.
 *
 * B7 (DEC-133) adds the settings-surface reads/writes: the workspace's
 * members (the Team page's first real data), and the guardrail DEFAULTS —
 * the values a NEW campaign starts from, stored additively in
 * `Workspace.settings.guardrailDefaults`. Editing a default never rewrites a
 * live campaign (live inheritance is Q-109); the GET returns each campaign's
 * CURRENT values so the surface can say which ones differ.
 */
@Controller("workspaces")
export class WorkspacesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantClient,
  ) {}

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

    const slugBase =
      name
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

  /**
   * B7: the active workspace's people. Memberships are read tenant-scoped;
   * the shared User rows are then fetched by exactly those ids through the
   * owner client (User has no workspaceId — it is outside the RLS set — and
   * the id list came from the tenant read, so nothing crosses a tenant).
   */
  @Get("members")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async members() {
    const memberships = await this.tenant.run((tx) =>
      tx.membership.findMany({ orderBy: { createdAt: "asc" } }),
    );
    const users = await this.prisma.admin.user.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return memberships.map((m) => {
      const u = byId.get(m.userId);
      return {
        userId: m.userId,
        name: u?.name ?? null,
        email: u?.email ?? "",
        role: m.role,
        since: m.createdAt,
      };
    });
  }

  /** B7: the stored defaults + every campaign's CURRENT values (diff view). */
  @Get("guardrail-defaults")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async guardrailDefaults() {
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const defaults = parseGuardrailDefaults(
        ((ws.settings ?? {}) as { guardrailDefaults?: unknown }).guardrailDefaults,
      );
      // Drafts included: they hold guardrails that launch as-is. Only the
      // archived are out of the picture.
      const agents = await tx.agent.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true, status: true, guardrails: true },
        orderBy: { createdAt: "asc" },
      });
      const campaigns = agents.map((a) => {
        let dailyCap: { email: number; sms?: number; voice?: number } | null = null;
        let window: { start: string; end: string; days: number[]; timezone: string } | null = null;
        try {
          const g = parseGuardrails(a.guardrails);
          dailyCap = g.dailyCap;
          window = g.sendingWindow;
        } catch {
          // a malformed row shows as "unreadable" rather than crashing the page
        }
        return { id: a.id, name: a.name, status: a.status, dailyCap, sendingWindow: window };
      });
      return { defaults, campaigns };
    });
  }

  /** B7: write the defaults (merge into settings; other keys untouched). */
  @Patch("guardrail-defaults")
  @Roles(Role.OWNER, Role.ADMIN)
  async patchGuardrailDefaults(@Body() body: unknown) {
    const parsed = guardrailDefaultsSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const defaults: GuardrailDefaults = parsed.data;
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run(async (tx) => {
      const ws = await tx.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { settings: true },
      });
      const settings = { ...((ws.settings ?? {}) as Record<string, unknown>) };
      settings.guardrailDefaults = defaults;
      await tx.workspace.update({
        where: { id: workspaceId },
        data: { settings: settings as Prisma.InputJsonValue },
      });
      return { ok: true, defaults };
    });
  }
}
