import { BadRequestException, Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { z } from "zod";
import type { AuthenticatedRequest } from "../auth/request-context";
import { PrismaService } from "../db/prisma.service";
import { TenantClient } from "../db/tenant-client";

/**
 * B9 (DEC-136, tour addendum): /me grows the per-USER settings echo, a
 * narrow settings PATCH (tour-seen persists with the account, never a
 * browser), and the getting-started checklist — every done-state
 * SERVER-DERIVED from real rows, never hard-coded:
 *  - business core filled  → any workspace-layer BusinessContext field with a value
 *  - first campaign live   → any ACTIVE agent
 *  - sender verified       → an ACTIVE email sender whose published DNS
 *                            records ALL read verified (keyless local
 *                            honestly reads unverified)
 *  - site agent embedded   → real widget sessions exist (a row alone is not
 *                            "on your website")
 *  - calendar connected    → a CONNECTED gcal/calendly Integration (a
 *                            revoked token is not a connected calendar)
 *  - contacts imported     → a contact from a real import source
 */
/** The sources a contact carries when a PERSON brought it in (CSV, manual
 *  add, a revealed lead, a Zapier push). Form/widget captures belong to the
 *  site-agent item, and seeded demo rows are nobody's progress. */
const IMPORT_SOURCES = ["csv_import", "manual", "MANUAL", "lead_finder", "zapier"];

const settingsPatchSchema = z.object({ tourSeen: z.boolean().optional() }).strict();

@Controller("me")
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantClient,
  ) {}

  @Get()
  async me(@Req() req: AuthenticatedRequest) {
    // AuthGuard guarantees `auth` is present on non-public routes. It carries
    // only {id, email, name} — settings are read fresh here so a PATCH is
    // visible on the very next GET, not whenever a token re-resolves.
    const auth = req.auth!;
    const active = auth.memberships.find((m) => m.workspaceId === auth.activeWorkspaceId);
    const row = await this.prisma.admin.user.findUnique({
      where: { id: auth.user.id },
      select: { settings: true },
    });
    return {
      user: {
        ...auth.user,
        settings: (row?.settings ?? {}) as Record<string, unknown>,
      },
      memberships: auth.memberships,
      activeWorkspace: active?.workspace ?? null,
      activeAgencyId: auth.activeAgencyId,
      role: auth.role,
    };
  }

  @Patch("settings")
  async patchSettings(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const parsed = settingsPatchSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("Unknown settings key");
    const userId = req.auth!.user.id;
    const user = await this.prisma.admin.user.findUniqueOrThrow({
      where: { id: userId },
      select: { settings: true },
    });
    const merged = { ...((user.settings ?? {}) as Record<string, unknown>), ...parsed.data };
    await this.prisma.admin.user.update({ where: { id: userId }, data: { settings: merged } });
    return { ok: true, settings: merged };
  }

  @Get("getting-started")
  gettingStarted() {
    return this.tenant.run(async (tx) => {
      const [core, liveAgent, senders, sessions, calendar, importedContact] = await Promise.all([
        tx.businessContext.findFirst({ where: { agentId: null }, select: { fields: true } }),
        tx.agent.count({ where: { status: "ACTIVE" } }),
        tx.senderConnection.findMany({
          where: { status: "ACTIVE", type: { not: "TWILIO_SMS" } },
          select: { domainAuthStatus: true },
        }),
        tx.widgetSession.count(),
        tx.integration.count({ where: { provider: { in: ["gcal", "calendly"] }, status: "connected" } }),
        tx.contact.count({ where: { source: { in: IMPORT_SOURCES } } }),
      ]);
      const coreFilled = Object.values((core?.fields ?? {}) as Record<string, { value?: string }>).some(
        (v) => ((v?.value ?? "") as string).trim().length > 0,
      );
      // The checker's real vocabulary is DnsRecordState ("verified" |
      // "failed" | "unchecked") plus a legacy boolean `pass` — read BOTH,
      // and require every published record to have passed, matching the
      // settings surface's own summary rule.
      const senderVerified = senders.some((s) => {
        const st = (s.domainAuthStatus ?? {}) as Record<string, { status?: string; pass?: boolean } | string>;
        const records = Object.values(st);
        if (records.length === 0) return false;
        return records.every((v) => {
          if (typeof v === "object" && v?.pass === true) return true;
          const status = String(typeof v === "object" ? (v?.status ?? "") : v).toLowerCase();
          return status === "verified" || status === "ok" || status === "pass";
        });
      });
      const items = [
        { key: "core", label: "Business core filled in", done: coreFilled },
        { key: "campaign", label: "First campaign live", done: liveAgent > 0 },
        { key: "sender", label: "Email sender verified", done: senderVerified },
        { key: "widget", label: "Site agent on your website", done: sessions > 0 },
        { key: "calendar", label: "Calendar connected", done: calendar > 0 },
        { key: "contacts", label: "Contacts imported", done: importedContact > 0 },
      ];
      return { items, done: items.filter((i) => i.done).length, total: items.length };
    });
  }
}
