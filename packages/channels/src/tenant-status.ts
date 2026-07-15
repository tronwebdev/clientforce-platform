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
