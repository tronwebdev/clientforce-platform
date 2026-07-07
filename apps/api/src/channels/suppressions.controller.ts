import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { Role, type SuppressionReason } from "@clientforce/db";
import { Roles } from "../auth/decorators";
import { TenantClient } from "../db/tenant-client";

const REASONS: SuppressionReason[] = ["UNSUBSCRIBED", "BOUNCED", "SPAM_COMPLAINT", "MANUAL"];

/**
 * Suppression list (C2.6, checkpoints §6). Rows written here are the SAME
 * rows the P1.5 send boundary checks — adding an address genuinely blocks
 * the next send to it (§6 acceptance). Email-only phase: channel is always
 * "email" from the UI; the field stays explicit per the model.
 */
@Controller("suppressions")
export class SuppressionsController {
  constructor(private readonly tenant: TenantClient) {}

  @Get()
  async list(@Query("q") q?: string) {
    return this.tenant.run(async (tx) => {
      const rows = await tx.suppression.findMany({
        where: q ? { address: { contains: q.trim(), mode: "insensitive" } } : {},
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((r) => ({
        id: r.id,
        address: r.address,
        channel: r.channel,
        reason: r.reason,
        source: r.source,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  @Post()
  @Roles(Role.OWNER, Role.ADMIN)
  async add(@Body() body: { address?: string; reason?: string; channel?: string }) {
    const address = String(body?.address ?? "").trim().toLowerCase();
    if (!/.+@.+\..+/.test(address)) throw new BadRequestException("A valid email address is required");
    const reason = (body?.reason ?? "MANUAL") as SuppressionReason;
    if (!REASONS.includes(reason)) throw new BadRequestException("Unknown reason");
    const channel = body?.channel ?? "email";
    if (channel !== "email") throw new BadRequestException("Email is the only live channel this phase");
    const workspaceId = this.tenant.workspaceId;
    return this.tenant.run((tx) =>
      tx.suppression.upsert({
        where: { workspaceId_channel_address: { workspaceId, channel, address } },
        create: { workspaceId, channel, address, reason, source: "settings-manual" },
        update: { reason },
      }),
    );
  }

  @Delete(":id")
  @Roles(Role.OWNER, Role.ADMIN)
  async remove(@Param("id") id: string) {
    return this.tenant.run(async (tx) => {
      const row = await tx.suppression.findUnique({ where: { id } });
      if (!row) throw new NotFoundException();
      await tx.suppression.delete({ where: { id } });
      return { ok: true };
    });
  }
}
