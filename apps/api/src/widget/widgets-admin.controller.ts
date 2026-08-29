/**
 * B4 (DEC-124): the FIRST widget management surface — the minimal tenant CRUD
 * the Bold site-agent page needs, and the write path DEC-120(2)'s consent-ask
 * toggle was waiting for. One widget per workspace in v1 (`ensure` returns
 * the existing row rather than minting twins); the publicId is minted here
 * and is the only identifier that ever leaves the platform.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { widgetFlowsSchema } from "@clientforce/core";
import { Prisma, Role } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

const patchSchema = z.object({
  design: z.record(z.string(), z.unknown()).optional(),
  flows: widgetFlowsSchema.partial().optional(),
  consentAsk: z.boolean().optional(),
  allowedOrigins: z.array(z.string().min(1).max(200)).max(20).optional(),
});

const row = (w: {
  id: string;
  publicId: string | null;
  design: unknown;
  flows: unknown;
  consentAsk: boolean;
  allowedOrigins: string[];
  agentId: string;
  createdAt: Date;
}) => ({
  id: w.id,
  publicId: w.publicId,
  design: (w.design ?? {}) as Record<string, unknown>,
  flows: (w.flows ?? {}) as Record<string, unknown>,
  consentAsk: w.consentAsk,
  allowedOrigins: w.allowedOrigins,
  agentId: w.agentId,
  createdAt: w.createdAt.toISOString(),
});

@Controller("widgets")
export class WidgetsAdminController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async list() {
    return this.tenant.run(async (tx) => {
      const rows = await tx.widget.findMany({ orderBy: { createdAt: "asc" } });
      return { widgets: rows.map(row) };
    });
  }

  /** The rail/dock/page truth in ONE read: installed = a widget with its
   *  public credential exists; busy = a visitor conversation touched the
   *  last five minutes; counts are the last 30 days, factually scoped. */
  @Get("overview")
  @Roles(Role.OWNER, Role.ADMIN, Role.AGENT)
  async overview() {
    return this.tenant.run(async (tx) => {
      const widget = await tx.widget.findFirst({
        orderBy: { createdAt: "asc" },
        select: { id: true, publicId: true },
      });
      const installed = Boolean(widget?.publicId);
      const since30d = new Date(Date.now() - 30 * 24 * 3600_000);
      const busySince = new Date(Date.now() - 5 * 60_000);
      const [chats30d, booked30d, busyCount] = widget
        ? await Promise.all([
            tx.widgetSession.count({
              where: { widgetId: widget.id, startedAt: { gte: since30d } },
            }),
            tx.meeting.count({
              where: { provider: "widget", createdAt: { gte: since30d } },
            }),
            tx.widgetSession.count({
              where: { widgetId: widget.id, lastEventAt: { gte: busySince }, closedAt: null },
            }),
          ])
        : [0, 0, 0];
      return { installed, busy: busyCount > 0, busyCount, chats30d, booked30d };
    });
  }

  /** One widget per workspace in v1 — returns the existing row or mints one
   *  (publicId + default flows) so the embed snippet is always real. */
  @Post("ensure")
  @Roles(Role.OWNER, Role.ADMIN)
  async ensure() {
    return this.tenant.run(async (tx) => {
      const existing = await tx.widget.findFirst({ orderBy: { createdAt: "asc" } });
      if (existing) return row(existing);
      const agent = await tx.agent.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
      if (!agent) {
        throw new BadRequestException("Create a campaign first — the site agent answers from it.");
      }
      const workspace = await tx.workspace.findUnique({
        where: { id: this.tenant.workspaceId },
        select: { name: true },
      });
      const created = await tx.widget.create({
        data: {
          workspaceId: this.tenant.workspaceId,
          agentId: agent.id,
          publicId: `wgt_${randomBytes(12).toString("hex")}`,
          design: { agentName: workspace?.name ?? "Front desk" },
          fields: {},
          behaviour: {},
          routing: {},
        },
      });
      return row(created);
    });
  }

  @Patch(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async update(@Param("id") id: string, @Body() body: unknown) {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Invalid widget patch",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return this.tenant.run(async (tx) => {
      const widget = await tx.widget.findUnique({ where: { id } });
      if (!widget) throw new NotFoundException(`Widget ${id} not found`);
      const updated = await tx.widget.update({
        where: { id },
        data: {
          ...(parsed.data.design !== undefined
            ? {
                design: {
                  ...((widget.design ?? {}) as Record<string, unknown>),
                  ...parsed.data.design,
                } as Prisma.InputJsonValue,
              }
            : {}),
          ...(parsed.data.flows !== undefined
            ? {
                flows: {
                  ...((widget.flows ?? {}) as Record<string, unknown>),
                  ...parsed.data.flows,
                } as Prisma.InputJsonValue,
              }
            : {}),
          ...(parsed.data.consentAsk !== undefined ? { consentAsk: parsed.data.consentAsk } : {}),
          ...(parsed.data.allowedOrigins !== undefined
            ? { allowedOrigins: parsed.data.allowedOrigins }
            : {}),
        },
      });
      return row(updated);
    });
  }
}
