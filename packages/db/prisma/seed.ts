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
  // WID2 (DEC-101): one agent turn in an embedded widget. Registering the
  // delta TYPE is the spine-2 ride-along; metering stays with Phase 10's
  // reconciliation — the checklist forbids a parallel meter.
  { action: "widget_turn", credits: 2 },
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

  // A3 Google acceptance (DEC-060c): the owner's real account gets OWNER
  // membership in BOTH demo workspaces so the switcher re-scope step has
  // somewhere to go. `update: {}` on both upserts is load-bearing — the row
  // may be the Clerk-lazy-upserted first-run user (authProviderId set) and
  // must never be touched; their self-created first-run workspace is not
  // referenced here at all, so it stays intact as first-run evidence.
  const ownerAccount = await prisma.user.upsert({
    where: { email: "tronwebng@gmail.com" },
    update: {},
    create: { email: "tronwebng@gmail.com", name: "Godswill" },
  });

  // B1 W1 (DEC-079): platform-staff allow-list — the backoffice's own identities,
  // owner-managed and DISTINCT from tenant `User`s. The real owner account is a
  // platform ADMIN; a dedicated ops OPERATOR (no tenant membership anywhere)
  // proves the surface is not tied to any tenant login. `update: {}` keeps it
  // idempotent and never disturbs a status flip made in the backoffice.
  await prisma.platformStaff.upsert({
    where: { email: "tronwebng@gmail.com" },
    update: {},
    create: { email: "tronwebng@gmail.com", name: "Godswill", role: "ADMIN" },
  });
  await prisma.platformStaff.upsert({
    where: { email: "ops@clientforce.io" },
    update: {},
    create: { email: "ops@clientforce.io", name: "Platform Ops", role: "OPERATOR" },
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

    await prisma.membership.upsert({
      where: { userId_workspaceId: { userId: ownerAccount.id, workspaceId: workspace.id } },
      update: {},
      create: { userId: ownerAccount.id, workspaceId: workspace.id, role: "OWNER" },
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

    // C2.8 (docs/PLAN_CONTACT_LISTS.md): the prototype's five base lists become
    // real rows in the primary workspace, with real memberships over the seeded
    // contacts, so the lists rail renders honest counts from day one.
    if (ws.slug === "demo") {
      const listNames = [
        "Dental — local",
        "SaaS founders Q2",
        "Cold list — agencies",
        "Webinar follow-up",
        "Lapsed clients Q3",
      ];
      const listIds = new Map<string, string>();
      for (const name of listNames) {
        const list = await prisma.contactList.upsert({
          where: { workspaceId_name: { workspaceId: workspace.id, name } },
          update: {},
          create: { workspaceId: workspace.id, name, origin: "manual" },
        });
        listIds.set(name, list.id);
      }
      const memberships: Array<[email: string, listName: string]> = [
        ["ada@demo-agency.test", "SaaS founders Q2"],
        ["alan@demo-agency.test", "Cold list — agencies"],
        ["edsger@demo-agency.test", "Dental — local"],
      ];
      for (const [email, listName] of memberships) {
        const contact = await prisma.contact.findFirst({
          where: { workspaceId: workspace.id, email },
        });
        const listId = listIds.get(listName);
        if (contact && listId) {
          await prisma.contactListMember.createMany({
            data: [{ workspaceId: workspace.id, listId, contactId: contact.id, addedBy: "import" }],
            skipDuplicates: true,
          });
        }
      }
    }
  }

  // Sample Agent lives in the primary workspace (one usable agent, per #9).
  const primary = await prisma.workspace.findFirstOrThrow({
    where: { agencyId: agency.id, slug: "demo" },
  });
  // B0 (Console Bold): the flag defaults OFF everywhere; the seed enables it
  // for the demo workspace only, so the dev stack and the Bold e2e can reach
  // /bold. Launch stays a per-workspace backoffice flag flip (Flags spine).
  await prisma.featureFlag.upsert({
    where: { workspaceId_key: { workspaceId: primary.id, key: "consoleBold" } },
    update: { enabled: true },
    create: { workspaceId: primary.id, key: "consoleBold", enabled: true },
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

  // B1 (DEC-104): three more demo campaigns + a small, COHERENT activity
  // fixture on one of them, so the Bold rail/overview/activity surfaces (and
  // their e2e) have real rows to stand on. Same idempotent style as the
  // reconciliation fixtures above; the demo workspace is a dev fixture.
  const implant = await prisma.agent.findFirst({
    where: { workspaceId: primary.id, name: "Implant open day" },
  });
  if (!implant) {
    const guardrails = {
      sendingWindow: { start: "09:00", end: "17:00" },
      dailyCap: 200,
      consentRequired: true,
    };
    const implantAgent = await prisma.agent.create({
      data: {
        workspaceId: primary.id,
        name: "Implant open day",
        goal: "book_appointments",
        status: "ACTIVE",
        guardrails,
        valueEstCents: 240_000,
        valueGoalUnits: 12,
      },
    });
    await prisma.agent.create({
      data: {
        workspaceId: primary.id,
        name: "Whitening kit push",
        goal: "promote_offer",
        status: "ACTIVE",
        guardrails,
        valueEstCents: 24_900,
      },
    });
    await prisma.agent.create({
      data: {
        workspaceId: primary.id,
        name: "Review asks",
        goal: "collect_reviews",
        status: "DRAFT",
        guardrails,
      },
    });

    const campaign = await prisma.campaign.create({
      data: {
        workspaceId: primary.id,
        agentId: implantAgent.id,
        name: "Implant open day — primary",
        graphId: "seed-graph-implant",
      },
    });
    const demoContacts = await prisma.contact.findMany({
      where: { workspaceId: primary.id },
      orderBy: { createdAt: "asc" },
      take: 3,
    });
    const stages = ["booked", "interested", "contacted"];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const hourLater = new Date(yesterday.getTime() + 60 * 60 * 1000);
    for (const [i, contact] of demoContacts.entries()) {
      await prisma.enrollment.create({
        data: {
          workspaceId: primary.id,
          campaignId: campaign.id,
          contactId: contact.id,
          workflowId: `seed-b1-wf-${contact.id}`,
          pipelineStage: stages[i] ?? "contacted",
        },
      });
      const outbound = await prisma.message.create({
        data: {
          workspaceId: primary.id,
          campaignId: campaign.id,
          contactId: contact.id,
          channel: "email",
          direction: "OUTBOUND",
          subject: "Four consult slots left for the 21st",
          body: "seed fixture — the open-day opener",
          stepNodeId: "seed-step-1",
          sentAt: yesterday,
        },
      });
      await prisma.event.create({
        data: {
          workspaceId: primary.id,
          campaignId: campaign.id,
          contactId: contact.id,
          type: "email.delivered.v1",
          payload: { messageId: outbound.id },
          occurredAt: new Date(yesterday.getTime() + 5 * 60 * 1000),
        },
      });
      if (i < 2) {
        await prisma.event.create({
          data: {
            workspaceId: primary.id,
            campaignId: campaign.id,
            contactId: contact.id,
            type: "email.opened.v1",
            payload: { messageId: outbound.id },
            occurredAt: new Date(yesterday.getTime() + 20 * 60 * 1000),
          },
        });
      }
      if (i === 0 || i === 1) {
        const intent = i === 0 ? "interested" : "info_request";
        const inbound = await prisma.message.create({
          data: {
            workspaceId: primary.id,
            campaignId: campaign.id,
            contactId: contact.id,
            channel: "email",
            direction: "INBOUND",
            body: i === 0 ? "Thursday works — book me in." : "What does recovery look like?",
            intent,
            sentAt: hourLater,
            meta: i === 0 ? { done: true } : {},
          },
        });
        await prisma.event.create({
          data: {
            workspaceId: primary.id,
            campaignId: campaign.id,
            contactId: contact.id,
            type: "email.replied.v1",
            payload: { messageId: inbound.id, intent },
            occurredAt: hourLater,
          },
        });
      }
    }
    const bookedContact = demoContacts[0];
    if (bookedContact) {
      await prisma.event.create({
        data: {
          workspaceId: primary.id,
          campaignId: campaign.id,
          contactId: bookedContact.id,
          type: "lead.stage_changed.v1",
          payload: {
            fromStage: "interested",
            toStage: "booked",
            goalKey: "book_appointments",
            label: "Meeting booked",
          },
          occurredAt: new Date(hourLater.getTime() + 30 * 60 * 1000),
        },
      });
      await prisma.event.create({
        data: {
          workspaceId: primary.id,
          campaignId: campaign.id,
          contactId: bookedContact.id,
          type: "payment.received.v1",
          payload: { amount: 240_000, channel: "email" },
          occurredAt: new Date(hourLater.getTime() + 26 * 60 * 60 * 1000),
        },
      });
    }
  }

  // B1: one undone inbound reply in demo-2 so the cross-workspace needs pill
  // ("N elsewhere", GET /me/needs) has real data behind it.
  const second = await prisma.workspace.findFirst({
    where: { agencyId: agency.id, slug: "demo-2" },
  });
  if (second) {
    const needsMarker = await prisma.message.findFirst({
      where: { workspaceId: second.id, stepNodeId: "seed-b1-needs" },
    });
    const graceContact = await prisma.contact.findFirst({ where: { workspaceId: second.id } });
    if (!needsMarker && graceContact) {
      const agent2 = await prisma.agent.create({
        data: {
          workspaceId: second.id,
          name: "Clinic reactivation",
          goal: "reactivate_leads",
          status: "ACTIVE",
          guardrails: {
            sendingWindow: { start: "09:00", end: "17:00" },
            dailyCap: 100,
            consentRequired: true,
          },
        },
      });
      const campaign2 = await prisma.campaign.create({
        data: {
          workspaceId: second.id,
          agentId: agent2.id,
          name: "Clinic reactivation — primary",
          graphId: "seed-graph-reactivation",
        },
      });
      await prisma.message.create({
        data: {
          workspaceId: second.id,
          campaignId: campaign2.id,
          contactId: graceContact.id,
          channel: "email",
          direction: "INBOUND",
          body: "seed fixture — a reply waiting in the second workspace",
          intent: "info_request",
          stepNodeId: "seed-b1-needs",
          sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });
    }
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

  // B1 W2 (DEC-080): a reconciliation fixture — a provider invoice plus the
  // matching metered usage, so the backoffice reconciliation view shows a real
  // zero-variance match on a fresh staging DB (June 2026), plus a deliberate
  // voice-minutes variance to exercise the mismatch path. Idempotent.
  const PERIOD_START = new Date("2026-06-01T00:00:00.000Z");
  const PERIOD_END = new Date("2026-06-30T23:59:59.000Z");
  const SENT_AT = new Date("2026-06-15T12:00:00.000Z");
  const TARGET_SENDS = 3;
  const demoAgent = await prisma.agent.findFirst({ where: { workspaceId: primary.id } });
  const demoContact = await prisma.contact.findFirst({ where: { workspaceId: primary.id } });
  if (demoAgent && demoContact) {
    const campaign =
      (await prisma.campaign.findFirst({
        where: { workspaceId: primary.id, agentId: demoAgent.id },
      })) ??
      (await prisma.campaign.create({
        data: {
          workspaceId: primary.id,
          agentId: demoAgent.id,
          name: `${demoAgent.name} — primary`,
          graphId: "",
        },
      }));
    const seededSends = await prisma.message.count({
      where: {
        workspaceId: primary.id,
        channel: "email",
        direction: "OUTBOUND",
        sentAt: { gte: PERIOD_START, lte: PERIOD_END },
      },
    });
    if (seededSends < TARGET_SENDS) {
      await prisma.message.createMany({
        data: Array.from({ length: TARGET_SENDS - seededSends }, (_v, i) => ({
          workspaceId: primary.id,
          campaignId: campaign.id,
          contactId: demoContact.id,
          channel: "email",
          direction: "OUTBOUND" as const,
          subject: `Reconciliation fixture ${i + 1}`,
          body: "seed fixture — metered usage for the reconciliation demo",
          sentAt: SENT_AT,
          stepNodeId: "seed-fixture",
        })),
      });
    }
    for (const inv of [
      { provider: "sendgrid", metric: "email_sends", quantity: TARGET_SENDS, amount: 300 },
      { provider: "twilio", metric: "voice_minutes", quantity: 10, amount: 1200 },
    ]) {
      const exists = await prisma.providerInvoice.findFirst({
        where: { provider: inv.provider, metric: inv.metric, periodStart: PERIOD_START },
      });
      if (!exists) {
        await prisma.providerInvoice.create({
          data: { ...inv, periodStart: PERIOD_START, periodEnd: PERIOD_END, source: "manual" },
        });
      }
    }
  }

  const totalContacts = WORKSPACES.reduce((n, w) => n + w.contacts.length, 0);
  const staffCount = await prisma.platformStaff.count();
  console.log(
    `Seeded agency=${agency.slug} owner=${user.email} ` +
      `(${WORKSPACES.length} workspaces, ${totalContacts} contacts, ` +
      `${DEFAULT_PIPELINE_STAGES.length} stages/ws, ${PLAN_TIERS.length} plans, ` +
      `${DEFAULT_CREDIT_PRICES.length} credit prices, ${staffCount} platform staff).`,
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
