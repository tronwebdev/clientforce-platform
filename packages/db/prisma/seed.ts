/**
 * Seed — enums/defaults + a minimal usable tenant (DATA_MODEL.md §9).
 *
 * T1 keeps this intentionally small: one Agency → Workspace → User(OWNER) → a
 * sample Agent + default PipelineStages, plus the editable CreditPrice rows and
 * the 3 Plan tiers. The richer end-to-end seed + smoke test is T8. Runs as the
 * privileged owner connection (bypasses RLS), so it can create across tenants.
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
const PLAN_TIERS: ReadonlyArray<{ name: string; priceMonthly: number; limits: Prisma.InputJsonValue }> =
  [
    { name: "STARTER", priceMonthly: 9900, limits: { workspaces: 3, emailsPerMonth: 10_000 } },
    { name: "GROWTH", priceMonthly: 29900, limits: { workspaces: 15, emailsPerMonth: 100_000 } },
    { name: "SCALE", priceMonthly: 99900, limits: { workspaces: 100, emailsPerMonth: 1_000_000 } },
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

  const workspace = await prisma.workspace.upsert({
    where: { agencyId_slug: { agencyId: agency.id, slug: "demo" } },
    update: {},
    create: {
      agencyId: agency.id,
      name: "Demo Workspace",
      slug: "demo",
      settings: { timezone: "UTC", sendingWindow: { start: "09:00", end: "17:00" }, dailyCap: 200 },
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "owner@demo-agency.test" },
    update: {},
    create: { email: "owner@demo-agency.test", name: "Demo Owner" },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: user.id, workspaceId: workspace.id } },
    update: { role: "OWNER" },
    create: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
  });

  const agentCount = await prisma.agent.count({ where: { workspaceId: workspace.id } });
  if (agentCount === 0) {
    await prisma.agent.create({
      data: {
        workspaceId: workspace.id,
        name: "New-Patient Booking Agent",
        goal: "Book new-patient appointments for the clinic.",
        status: "DRAFT",
        guardrails: { sendingWindow: { start: "09:00", end: "17:00" }, dailyCap: 200, consentRequired: true },
      },
    });
  }

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

  console.log(
    `Seeded agency=${agency.slug} workspace=${workspace.slug} owner=${user.email} ` +
      `(${DEFAULT_PIPELINE_STAGES.length} stages, ${PLAN_TIERS.length} plans, ${DEFAULT_CREDIT_PRICES.length} credit prices).`,
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
