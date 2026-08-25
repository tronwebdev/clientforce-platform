import { Controller, Get, Req } from "@nestjs/common";
import type { MeNeedsResponse, WorkspaceNeeds } from "@clientforce/core";
import { withTenant } from "@clientforce/db";
import type { AuthenticatedRequest } from "../auth/request-context";
import { PrismaService } from "../db/prisma.service";

/**
 * GET /me/needs (B1, DEC-104) — replies waiting in the caller's OTHER
 * workspaces, for the Bold rail workspace-card amber pill ("3 elsewhere" —
 * owner-filed to B1 on the B0 review, on REAL data only).
 *
 * "A reply waiting" = an inbound Message not yet marked done (the shipped
 * PATCH /messages/:id/done resolution bit). Each workspace is read through
 * withTenant on the RLS-subject app client with that workspace's own GUC —
 * the caller only ever sees workspaces they are a member of.
 */
@Controller("me")
export class MeNeedsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("needs")
  async needs(@Req() req: AuthenticatedRequest): Promise<MeNeedsResponse> {
    const auth = req.auth!;
    const others = auth.memberships.filter((m) => m.workspaceId !== auth.activeWorkspaceId);
    const elsewhere: WorkspaceNeeds[] = [];
    for (const m of others) {
      const rows = await withTenant(
        this.prisma.app,
        { workspaceId: m.workspaceId, agencyId: m.workspace.agencyId },
        (tx) => tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*) AS count
          FROM "Message"
          WHERE "workspaceId" = ${m.workspaceId}
            AND "direction" = 'INBOUND'::"MessageDirection"
            AND COALESCE(("meta"->>'done')::boolean, false) = false
        `,
      );
      const repliesWaiting = Number(rows[0]?.count ?? 0n);
      if (repliesWaiting > 0) {
        elsewhere.push({
          workspaceId: m.workspaceId,
          name: m.workspace.name,
          slug: m.workspace.slug,
          repliesWaiting,
        });
      }
    }
    elsewhere.sort((a, b) => b.repliesWaiting - a.repliesWaiting);
    return {
      elsewhere,
      totalElsewhere: elsewhere.reduce((n, w) => n + w.repliesWaiting, 0),
    };
  }
}
