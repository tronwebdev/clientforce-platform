/**
 * B6.5 (DEC-150..154) — teardown for the Lead-finder fidelity capture.
 *
 * The capture builds its own throwaway Bright Smile tenant through the REAL
 * first-run bootstrap (agency → workspace → membership → flag → ICP profile)
 * and then writes a handful of its own contacts, so the finder has real
 * own-book rows to rank. This deletes that tenant by its login email.
 *
 *   tsx prisma/b65-cleanup.ts <email>
 *
 * Honesty rails: only the capture's own throwaway identity is accepted,
 * deletes cascade from the Agency rows the user owns, and the User row goes
 * last — nothing lingers pretending to be a business. Separate from
 * b9-cleanup.ts on purpose: a parallel session may be editing that file, and
 * a shared teardown is the worst place to take a merge conflict.
 */
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const email = process.argv[2] ?? "";
  if (!/^owner@b65\.brightsmile\.test$/.test(email)) {
    throw new Error(`refusing to clean up non-throwaway email: "${email}"`);
  }
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.log("nothing to clean");
      return;
    }
    const memberships = await prisma.membership.findMany({ where: { userId: user.id } });
    const workspaces = await prisma.workspace.findMany({
      where: { id: { in: memberships.map((m) => m.workspaceId) } },
      select: { agencyId: true },
    });
    for (const agencyId of new Set(workspaces.map((w) => w.agencyId))) {
      await prisma.agency.delete({ where: { id: agencyId } }).catch(() => {});
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    console.log("cleaned");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
