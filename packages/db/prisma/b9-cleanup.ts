/**
 * B9 (DEC-136/137) — teardown for the onboarding browser e2e AND the fidelity
 * capture. The flow exercises
 * the REAL first-run bootstrap (agency → workspace → membership → flag →
 * campaign → sender → plan choice), so the spec creates a genuinely new
 * tenant each run; this deletes it by the run's throwaway login email.
 *
 *   tsx prisma/b9-cleanup.ts <email>
 *
 * Honesty rails: only e2e-pattern emails are accepted, deletes cascade from
 * the Agency rows the user owns, and the User row goes last — nothing
 * lingers pretending to be a business.
 */
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const email = process.argv[2] ?? "";
  // Two throwaway identities are allowed and no others: the e2e's random
  // fixture principal, and the fidelity capture's plausible business (owner
  // ruling — design evidence is captured against Bright Smile Dental, the
  // same standard as the Quinn / Demo Agency rulings).
  const ALLOWED = [/^e2e-b9-[a-z0-9-]+@fixture\.test$/, /^owner@brightsmile\.test$/];
  if (!ALLOWED.some((re) => re.test(email))) {
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
