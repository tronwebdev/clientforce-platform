/**
 * Seed — enums/defaults + a usable, multi-tenant demo (DATA_MODEL.md §9).
 *
 * One Agency → TWO Workspaces (so the workspace switcher has somewhere to go) →
 * one OWNER user who belongs to both → a sample Agent + the default
 * PipelineStages per workspace, plus the editable CreditPrice rows and the 3
 * Plan tiers. Each workspace gets a DISTINCT set of contacts (3 vs 1) so the T8
 * smoke can prove RLS re-scoping on workspace switch — the same 3-vs-1 shape as
 * the prototype demo.
 *
 * Runs as the privileged owner connection (bypasses RLS), so it can create
 * across tenants. Fully idempotent: re-running (every deploy, via the migrate
 * job's `prisma migrate deploy && pnpm db:seed`) creates nothing twice.
 */
import { createPrismaClient, type Prisma } from "../src/index";

const prisma = createPrismaClient();

/** Default workspace pipeline (DATA_MODEL.md §4; matches T8/#9). */
const DEFAULT_PIPELINE_STAGES = [
  "New",
  "Contacted",
  "Engaged",
  "Interested",
  "Booked",
  "Won",
  "Lost",
] as const;

/**
 * Platform-default credit prices (agencyId = null). Seeded from rough market
 * rate + a small markup; these are admin-editable at runtime (per-agency
 * overrides allowed) and the exact numbers are an open product decision.
 */
const DEFAULT_CREDIT_PRICES: ReadonlyArray<{ action: string; credits: number }> = [
  { action: "email_send", credits: 1 },
  { action: "sms_segment", credits: 5 },
  { action: "whatsapp_msg", credits: 8 },
  { action: "voice_minute", credits: 40 },
  { action: "enrichment", credits: 10 },
  { action: "signal_lead", credits: 15 },
];

/** The 3 agency-level plan tiers (priceMonthly in integer cents). */
const PLAN_TIERS: ReadonlyArray<{
  name: string;
  priceMonthly: number;
  limits: Prisma.InputJsonValue;
}> = [
  { name: "STARTER", priceMonthly: 9900, limits: { workspaces: 3, emailsPerMonth: 10_000 } },
  { name: "GROWTH", priceMonthly: 29900, limits: { workspaces: 15, emailsPerMonth: 100_000 } },
  { name: "SCALE", priceMonthly: 99900, limits: { workspaces: 100, emailsPerMonth: 1_000_000 } },
];

interface SeedContact {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
}

/**
 * Distinct contacts per workspace. The asymmetric 3-vs-1 split makes the RLS
 * re-scope visible and unambiguous in the smoke: switching from `demo` to
 * `demo-2` must drop the list from 3 rows to 1, with zero overlap.
 */
const WORKSPACES: ReadonlyArray<{ slug: string; name: string; contacts: SeedContact[] }> = [
  {
    slug: "demo",
    name: "Demo Workspace",
    contacts: [
      {
        email: "ada@demo-agency.test",
        firstName: "Ada",
        lastName: "Lovelace",
        company: "Analytical Engines",
      },
      {
        email: "alan@demo-agency.test",
        firstName: "Alan",
        lastName: "Turing",
        company: "Bletchley Park",
      },
      {
        email: "edsger@demo-agency.test",
        firstName: "Edsger",
        lastName: "Dijkstra",
        company: "Eindhoven",
      },
    ],
  },
  {
    slug: "demo-2",
    name: "Demo Workspace 2",
    contacts: [
      {
        email: "grace@demo-agency.test",
        firstName: "Grace",
        lastName: "Hopper",
        company: "UNIVAC",
      },
    ],
  },
];

async function main(): Promise<void> {
  const agency = await prisma.agency.upsert({
    where: { slug: "demo-agency" },
    update: {},
    create: {
      name: "Demo Agency",
      slug: "demo-agency",
      branding: { logo: null, colors: { brand: "#35E834" }, emailFrom: "hello@demo-agency.test" },
      planTier: "GROWTH",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "owner@demo-agency.test" },
    update: {},
    create: { email: "owner@demo-agency.test", name: "Demo Owner" },
  });

  for (const ws of WORKSPACES) {
    const workspace = await prisma.workspace.upsert({
      where: { agencyId_slug: { agencyId: agency.id, slug: ws.slug } },
      update: {},
      create: {
        agencyId: agency.id,
        name: ws.name,
        slug: ws.slug,
        settings: {
          timezone: "UTC",
          sendingWindow: { start: "09:00", end: "17:00" },
          dailyCap: 200,
        },
      },
    });

    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
      update: { role: "OWNER" },
      create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
    });

    const stageCount = await prisma.pipelineStage.count({
      where: { workspaceId: workspace.id, campaignId: null },
    });
    if (stageCount === 0) {
      await prisma.pipelineStage.createMany({
        data: DEFAULT_PIPELINE_STAGES.map((key, order) => ({
          workspaceId: workspace.id,
          key: key.toLowerCase(),
          label: key,
          order,
        })),
      });
    }

    for (const c of ws.contacts) {
      const exists = await prisma.contact.findFirst({
        where: { workspaceId: workspace.id, email: c.email },
      });
      if (!exists) {
        await prisma.contact.create({
          data: {
            workspaceId: workspace.id,
            source: "seed",
            optOut: {},
            tags: [],
            email: c.email,
            firstName: c.firstName,
            lastName: c.lastName,
            company: c.company,
          },
        });
      }
    }
  }

  // Sample Agent lives in the primary workspace (one usable agent, per #9).
  const primary = await prisma.workspace.findFirstOrThrow({
    where: { agencyId: agency.id, slug: "demo" },
  });
  const agentCount = await prisma.agent.count({ where: { workspaceId: primary.id } });
  if (agentCount === 0) {
    await prisma.agent.create({
      data: {
        workspaceId: primary.id,
        name: "New-Patient Booking Agent",
        goal: "Book new-patient appointments for the clinic.",
        status: "DRAFT",
        guardrails: {
          sendingWindow: { start: "09:00", end: "17:00" },
          dailyCap: 200,
          consentRequired: true,
        },
      },
    });
  }

  for (const plan of PLAN_TIERS) {
    const exists = await prisma.plan.findFirst({ where: { agencyId: agency.id, name: plan.name } });
    if (!exists) {
      await prisma.plan.create({
        data: {
          agencyId: agency.id,
          name: plan.name,
          priceMonthly: plan.priceMonthly,
          features: {},
          limits: plan.limits,
        },
      });
    }
  }

  for (const price of DEFAULT_CREDIT_PRICES) {
    const exists = await prisma.creditPrice.findFirst({
      where: { agencyId: null, action: price.action },
    });
    if (!exists) {
      await prisma.creditPrice.create({
        data: { agencyId: null, action: price.action, credits: price.credits },
      });
    }
  }

  const totalContacts = WORKSPACES.reduce((n, w) => n + w.contacts.length, 0);
  console.log(
    `Seeded agency=${agency.slug} owner=${user.email} ` +
      `(${WORKSPACES.length} workspaces, ${totalContacts} contacts, ` +
      `${DEFAULT_PIPELINE_STAGES.length} stages/ws, ${PLAN_TIERS.length} plans, ${DEFAULT_CREDIT_PRICES.length} credit prices).`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
