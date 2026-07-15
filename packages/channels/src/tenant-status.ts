import { type PrismaClient } from "@clientforce/db";
import { SendBlockedError } from "./types";

/**
 * B1 W1 (DEC-079): tenant-wide platform suspension, enforced at the send
 * boundary. A SUSPENDED workspace — or a workspace whose Agency is SUSPENDED —
 * refuses every send with a typed `TENANT_SUSPENDED`; reactivation restores it.
 *
 * `Workspace`/`Agency` carry no RLS policy, so this reads directly on the
 * RLS-subject client (no GUC needed). A missing workspace is left to the
 * caller's own richer not-found handling.
 */
export async function assertTenantActive(prisma: PrismaClient, workspaceId: string): Promise<void> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { status: true, agency: { select: { status: true } } },
  });
  if (!ws) return;
  if (ws.status !== "ACTIVE") throw new SendBlockedError("TENANT_SUSPENDED", "workspace suspended");
  if (ws.agency.status !== "ACTIVE") {
    throw new SendBlockedError("TENANT_SUSPENDED", "agency suspended");
  }
}

/**
 * B1 W4 (DEC-082): the per-agency/per-channel kill switch, enforced at the send
 * boundary exactly like `assertTenantActive` — an ACTIVE `KillSwitch` for the
 * workspace's agency + channel throws a typed `CHANNEL_KILLED`; clearing it
 * restores sending. Same machinery as TENANT_SUSPENDED, one more reason — no
 * fork. `KillSwitch` is app-READABLE (write-only revoked), so this runs on the
 * RLS-subject client.
 */
export async function assertChannelLive(
  prisma: PrismaClient,
  workspaceId: string,
  channel: string,
): Promise<void> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { agencyId: true },
  });
  if (!ws) return;
  const kill = await prisma.killSwitch.findUnique({
    where: { agencyId_channel: { agencyId: ws.agencyId, channel } },
  });
  if (kill?.active) {
    throw new SendBlockedError("CHANNEL_KILLED", `${channel} killed: ${kill.reason}`);
  }
}
