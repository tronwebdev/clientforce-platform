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
  // B3b (DEC-116, owner ruling): console reply pricing — effective-dated
  // data, admin-editable, nothing hard-coded (D1). Human typing is free; the
  // channel cost applies when a reply SENDS (human or Ada draft alike); the
  // Ada draft itself has its own key, seeded 0.
  { action: "reply_email_send", credits: 1 },
  { action: "reply_sms_send", credits: 5 },
  { action: "reply_draft", credits: 0 },
  // B6 (DEC-131, owner ruling): reveal + intent enrichment are effective-
  // dated DATA shown in the UI, never hard-coded (the prototype's numbers
  // are proposals; these defaults carry them until the owner re-prices).
  { action: "lead_reveal", credits: 1 },
  { action: "intent_enrichment", credits: 2 },
];

/** The 3 agency-level plan tiers (priceMonthly in integer cents). B9
 *  (DEC-136): these numbers are PROPOSALS until an admin confirms them in
 *  the backoffice billing editor (which stamps features.confirmed — D2);
 *  the seed deliberately writes no confirmed marker. */
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

    // B3b (DEC-116): the demo business core — the boundary's CAN-SPAM rail
    // consumes company_address verbatim, so a demo without it can never pass
    // a send (console replies included). Skip-if-present like every block.
    const hasCore = await prisma.businessContext.findFirst({
      where: { workspaceId: workspace.id, agentId: null },
    });
    if (!hasCore) {
      await prisma.businessContext.create({
        data: {
          workspaceId: workspace.id,
          agentId: null,
          fields: {
            company_address: {
              value: "Bright Smile Dental, 412 Congress Ave, Austin, TX 78701",
              citations: [],
              source: "typed",
            },
            offer: {
              value: "Implant consults ($2,400 per plan), whitening kits ($249), cleanings.",
              citations: [],
              source: "typed",
            },
          },
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
        name: "New-patient booking",
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
  // B4 review (DEC-107 vocabulary): a campaign is never called an agent. The
  // demo agent's original name leaked into its derived "— primary" campaign on
  // DBs seeded before the rename — fix both in place, idempotently.
  await prisma.agent.updateMany({
    where: { workspaceId: primary.id, name: "New-Patient Booking Agent" },
    data: { name: "New-patient booking" },
  });
  await prisma.campaign.updateMany({
    where: { workspaceId: primary.id, name: "New-Patient Booking Agent — primary" },
    data: { name: "New-patient booking — primary" },
  });

  // B1 (DEC-104): three more demo campaigns + a small, COHERENT activity
  // fixture on one of them, so the Bold rail/overview/activity surfaces (and
  // their e2e) have real rows to stand on. Same idempotent style as the
  // reconciliation fixtures above; the demo workspace is a dev fixture.
  const implant = await prisma.agent.findFirst({
    where: { workspaceId: primary.id, name: "Implant open day" },
  });
  // B2: schema-valid A8 guardrails (the legacy `{start,end}`-only blob fails
  // `parseGuardrails`, so views honestly render no sending window at all).
  const validGuardrails = {
    sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
    dailyCap: { email: 200 },
    consent: null,
    tracking: { openTracking: true, linkTracking: true },
    unsubscribeFooter: true,
    suppressionCheck: true,
  };
  if (!implant) {
    const guardrails = validGuardrails;
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

  // B2.5 (DEC-108): one ACTIVE demo email sender, so the create flow's
  // channel step and launch gate exercise the REAL capability read (senders
  // were absent in the demo workspace — every surface honestly said so).
  // CF_MANAGED, sandbox-style; idempotent on fromEmail.
  // B7 review fix 2 (the seed-realism standard, same class as the Quinn
  // ruling): the identity looks like the BUSINESS, not the platform. An
  // existing old-identity row upgrades in place — never a second sender.
  const demoSender = await prisma.senderConnection.findFirst({
    where: {
      workspaceId: primary.id,
      fromEmail: { in: ["hello@brightsmile.test", "hello@demo-agency.test"] },
    },
  });
  if (!demoSender) {
    await prisma.senderConnection.create({
      data: {
        workspaceId: primary.id,
        type: "CF_MANAGED",
        fromEmail: "hello@brightsmile.test",
        fromName: "Bright Smile Dental",
        status: "ACTIVE",
        domainAuthStatus: {},
        dailyLimit: 200,
      },
    });
  } else if (demoSender.fromEmail === "hello@demo-agency.test") {
    await prisma.senderConnection.update({
      where: { id: demoSender.id },
      data: { fromEmail: "hello@brightsmile.test", fromName: "Bright Smile Dental" },
    });
  }

  // B2 (DEC-105): the implant campaign's stored CampaignGraph — the Bold PLAN
  // tab reads the real row (B1 seeded messages against stepNodeId
  // "seed-step-1", so the graph's node ids line up with per-step counts).
  // Standalone + idempotent so already-seeded DBs pick it up.
  const implantAgentRow = await prisma.agent.findFirst({
    where: { workspaceId: primary.id, name: "Implant open day" },
  });
  // Repair pass for DBs seeded before B2: swap the unparsable legacy
  // guardrails blob for the schema-valid shape (detected by the missing
  // timezone — the valid shape always carries one).
  if (implantAgentRow) {
    const g = implantAgentRow.guardrails as { sendingWindow?: { timezone?: string } } | null;
    if (!g?.sendingWindow?.timezone) {
      await prisma.agent.update({
        where: { id: implantAgentRow.id },
        data: { guardrails: validGuardrails },
      });
    }
  }
  const implantCampaign = implantAgentRow
    ? await prisma.campaign.findFirst({ where: { agentId: implantAgentRow.id } })
    : null;
  if (implantCampaign) {
    const hasGraph = await prisma.campaignGraph.findFirst({
      where: { campaignId: implantCampaign.id },
    });
    if (!hasGraph) {
      const graphRow = await prisma.campaignGraph.create({
        data: {
          workspaceId: primary.id,
          campaignId: implantCampaign.id,
          version: 1,
          // Hand-authored fixture — "AI" would claim planner provenance the
          // graph does not have (surfaces render the source).
          source: "MANUAL",
          graph: {
            entry: "seed-step-1",
            nodes: [
              {
                id: "seed-step-1",
                type: "step",
                channel: "email",
                content: {
                  subject: "Four consult slots left for the 21st",
                  body: "We set aside a day for implant consults on the 21st — twenty minutes, no obligation, and you leave knowing exactly what it would cost. Four slots left. Want one?",
                },
              },
              { id: "seed-delay-1", type: "delay", amount: 3, unit: "days" },
              {
                id: "seed-step-2",
                type: "step",
                channel: "sms",
                content: {
                  body: "Hi {{firstName}} — Bright Smile here. Still holding a consult slot on the 21st if you want it. Reply YES and I will book you in.",
                },
              },
              {
                id: "seed-branch-reply",
                type: "branch",
                on: "reply",
                cases: [
                  { when: { intent: "interested" }, goto: "seed-reply-1", pipeline: "interested" },
                  { when: "default", goto: "seed-end" },
                ],
              },
              {
                id: "seed-reply-1",
                type: "step",
                channel: "email",
                content: {
                  body: "Great — the two nearest slots are Thursday 11:00 and Friday 14:30. Which works for you?",
                  threaded: true,
                },
              },
              { id: "seed-end", type: "end" },
            ],
            edges: [
              { from: "seed-step-1", to: "seed-delay-1" },
              { from: "seed-delay-1", to: "seed-step-2" },
              { from: "seed-step-2", to: "seed-branch-reply" },
              { from: "seed-reply-1", to: "seed-end" },
            ],
          },
        },
      });
      await prisma.campaign.update({
        where: { id: implantCampaign.id },
        data: { graphId: graphRow.id },
      });
    }

    // B2 (DEC-105): one SMS thread (Sofia Reyes — a prototype fixture name;
    // NEVER Grace Hopper, the workspace-rls spec's demo-2-only sentinel) so
    // the Bold inbox TYPE
    // picker and the pipeline board have real channel/stage variety. The
    // outbound rides "seed-step-2" (the graph's sms step) so it never touches
    // the B1 "Sent to 3" seed-step-1 aggregate the e2e pins.
    const sofiaEmail = "sofia.reyes@example.test";
    // Each sub-resource carries its OWN guard, so a crash mid-block heals on
    // the next run instead of leaving a half-seeded fixture forever.
    let sofia = await prisma.contact.findFirst({
      where: { workspaceId: primary.id, email: sofiaEmail },
    });
    if (!sofia) {
      sofia = await prisma.contact.create({
        data: {
          workspaceId: primary.id,
          email: sofiaEmail,
          phone: "+15125550142",
          firstName: "Sofia",
          lastName: "Reyes",
          company: "Reyes Dental Partners",
          source: "seed",
          optOut: {},
        },
      });
    }
    // B3d (Q-086 interim ruling): the staging deploy reseeds on every run
    // (packages/db/Dockerfile CMD) — this pass makes that reseed also CLEAN
    // the browser suite's accumulated artifacts, so the post-deploy e2e gate
    // stops failing on leftovers. Bounded to rows the specs themselves
    // name-tag with "e2e-": campaigns the create-flow spec launched, CSV
    // contacts, and quote lists. Demo fixtures are untouched.
    {
      const e2eAgents = await prisma.agent.findMany({
        where: {
          workspaceId: primary.id,
          OR: [{ goalSummary: { contains: "e2e" } }, { name: { contains: "e2e" } }],
        },
        select: { id: true },
      });
      const agentIds = e2eAgents.map((a) => a.id);
      if (agentIds.length > 0) {
        const camps = await prisma.campaign.findMany({
          where: { agentId: { in: agentIds } },
          select: { id: true },
        });
        const campIds = camps.map((c) => c.id);
        if (campIds.length > 0) {
          await prisma.enrollmentReplyHold.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.approval.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.call.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.message.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.event.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.enrollment.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.campaignGraph.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.campaignRule.deleteMany({ where: { campaignId: { in: campIds } } });
          await prisma.campaign.deleteMany({ where: { id: { in: campIds } } });
        }
        await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
      }
      const e2eContacts = await prisma.contact.findMany({
        where: { workspaceId: primary.id, email: { startsWith: "e2e-" } },
        select: { id: true },
      });
      const contactIds = e2eContacts.map((c) => c.id);
      if (contactIds.length > 0) {
        await prisma.contactListMember.deleteMany({ where: { contactId: { in: contactIds } } });
        await prisma.message.deleteMany({ where: { contactId: { in: contactIds } } });
        await prisma.event.deleteMany({ where: { contactId: { in: contactIds } } });
        await prisma.enrollment.deleteMany({ where: { contactId: { in: contactIds } } });
        await prisma.contact.deleteMany({ where: { id: { in: contactIds } } });
      }
      await prisma.contactList.deleteMany({
        where: { workspaceId: primary.id, name: { startsWith: "e2e-" } },
      });
      // The browser suite's practice calls (human + browser rows on demo are
      // e2e artifacts by construction) and its autonomy-flip receipts — both
      // displace the seeded activity feed if left to accumulate.
      const practiceCalls = await prisma.call.findMany({
        where: { workspaceId: primary.id, caller: "human" },
        select: { id: true },
      });
      if (practiceCalls.length > 0) {
        const callIds = practiceCalls.map((c) => c.id);
        const callEvents = await prisma.event.findMany({
          where: { workspaceId: primary.id, type: { startsWith: "call." } },
          select: { id: true, payload: true },
        });
        const toDelete = callEvents
          .filter((e) => callIds.includes(((e.payload ?? {}) as { callId?: string }).callId ?? ""))
          .map((e) => e.id);
        if (toDelete.length > 0) await prisma.event.deleteMany({ where: { id: { in: toDelete } } });
        await prisma.call.deleteMany({ where: { id: { in: callIds } } });
      }
      await prisma.event.deleteMany({
        where: { workspaceId: primary.id, type: "campaign.autonomy_changed.v1" },
      });
      await prisma.approval.deleteMany({ where: { workspaceId: primary.id } });
      // The pipeline spec's drag round-trips (manual stage shuffles, two per
      // run) — pure noise that starves the goal filter's window if left.
      await prisma.event.deleteMany({
        where: {
          workspaceId: primary.id,
          type: "lead.stage_changed.v1",
          payload: { path: ["manual"], equals: true },
        },
      });
    }

    // B4 (DEC-124): the demo site agent — a REAL Widget row (stable public
    // credential) with two visitor conversations and one captured callback,
    // so the Bold surface, rail and dock read live truth instead of a
    // fixture. Idempotent: keyed on the fixed publicId / session ids.
    {
      const demoAgentRow = await prisma.agent.findFirst({
        where: { workspaceId: primary.id, name: "Implant open day" },
        select: { id: true },
      });
      if (demoAgentRow) {
        let widget = await prisma.widget.findFirst({
          where: { workspaceId: primary.id },
        });
        if (!widget) {
          widget = await prisma.widget.create({
            data: {
              workspaceId: primary.id,
              agentId: demoAgentRow.id,
              publicId: "wgt_demobrightsmile01",
              // vertical: the DEC-127 vocabulary key (interim home — Q-096).
              design: { agentName: "Bright Smile", accent: "#146B33", vertical: "dental" },
              fields: {},
              behaviour: {},
              routing: {},
            },
          });
        }
        // DEC-127 backfill: widgets seeded before the vocabulary registry
        // carry no vertical — the demo clinic is dental.
        const design = widget.design as Record<string, unknown>;
        if (typeof design.vertical !== "string") {
          widget = await prisma.widget.update({
            where: { id: widget.id },
            data: { design: { ...design, vertical: "dental" } },
          });
        }
        for (const [n, turns] of [
          [1, [
            { id: "t1", role: "visitor", text: "How much is a single implant?", at: new Date().toISOString() },
            { id: "t2", role: "agent", text: "$2,400 per tooth including the crown, and we finance from $180 a month.", at: new Date().toISOString() },
          ]],
          [2, [
            { id: "t1", role: "visitor", text: "Are you open Saturdays?", at: new Date().toISOString() },
            { id: "t2", role: "agent", text: "We are — mornings until noon. Want me to find you a slot?", at: new Date().toISOString() },
          ]],
        ] as const) {
          const sid = `seed-b4-ws-${widget.id}-${n}`;
          const exists = await prisma.widgetSession.findUnique({ where: { id: sid } }).catch(() => null);
          if (!exists) {
            await prisma.widgetSession.create({
              data: {
                id: sid,
                workspaceId: primary.id,
                widgetId: widget.id,
                agentId: widget.agentId,
                status: "closed",
                agentTurns: 1,
                turns: turns as unknown as object,
                closedAt: new Date(),
              },
            });
          }
        }
      }
      // The receptionist wave gate — backoffice-flipped in production; the
      // demo workspace carries it so the panel is reachable.
      await prisma.featureFlag.upsert({
        where: { workspaceId_key: { workspaceId: primary.id, key: "receptionist" } },
        update: { enabled: true },
        create: { workspaceId: primary.id, key: "receptionist", enabled: true },
      });
    }

    // B5 (DEC-130): the Forms / Proposals / Automations demo rows — REAL rows
    // through the real tables so the Bold surfaces render live truth (the
    // eyebrow counts are queries, never strings). Idempotent: keyed on fixed
    // publicIds / titles; automations only use trigger/action kinds the
    // ENGINE genuinely executes today.
    {
      const implantCampaignRow = await prisma.campaign.findFirst({
        where: { workspaceId: primary.id, name: "Implant open day" },
        select: { id: true },
      });
      const openDayFields = [
        { key: "name", label: "Full name", type: "text", required: true },
        { key: "phone", label: "Phone", type: "phone", required: true },
        { key: "email", label: "Email", type: "email", required: false },
        { key: "need", label: "What do you need?", type: "choice", required: true, options: ["Implants", "Whitening", "Cleaning", "Something else"] },
        { key: "day", label: "Preferred day", type: "choice", required: false, options: ["Mornings", "Afternoons", "Any"] },
        { key: "notes", label: "Anything else?", type: "longtext", required: false },
      ];
      const forms = [
        {
          publicId: "frm_demoopenday0001",
          title: "Open day booking",
          status: "live",
          fields: openDayFields,
          design: { intro: "Twenty minutes, no obligation. You leave knowing what it would cost.", submitLabel: "Book my slot", kind: "booking" },
          routing: implantCampaignRow ? { campaignId: implantCampaignRow.id, tag: "from-form" } : { tag: "from-form" },
        },
        {
          publicId: "frm_demoaskus000001",
          title: "Ask us anything",
          status: "live",
          fields: [
            { key: "name", label: "Your name", type: "text", required: true },
            { key: "email", label: "Email", type: "email", required: true },
            { key: "question", label: "Your question", type: "longtext", required: true },
          ],
          design: { submitLabel: "Send it", kind: "enquiry" },
          routing: { tag: "from-form" },
        },
        {
          publicId: null,
          title: "Monthly tips",
          status: "draft",
          fields: [{ key: "email", label: "Email", type: "email", required: true }],
          design: { submitLabel: "Sign me up", kind: "newsletter" },
          routing: {},
        },
      ];
      for (const f of forms) {
        const existing = f.publicId
          ? await prisma.form.findUnique({ where: { publicId: f.publicId } })
          : await prisma.form.findFirst({ where: { workspaceId: primary.id, title: f.title } });
        // B5 review fix 2 backfill: rows seeded before kinds existed.
        if (existing) {
          const design = (existing.design ?? {}) as Record<string, unknown>;
          if (typeof design.kind !== "string") {
            await prisma.form.update({
              where: { id: existing.id },
              data: { design: { ...design, kind: (f.design as { kind: string }).kind } },
            });
          }
        }
        if (!existing) {
          await prisma.form.create({
            data: {
              workspaceId: primary.id,
              title: f.title,
              status: f.status,
              publicId: f.publicId,
              fields: f.fields as object,
              design: f.design as object,
              routing: f.routing as object,
            },
          });
        }
      }
      // Two responses on the open-day form: real submissions from real
      // contact rows (created here with source "form", like the rail writes).
      const openDay = await prisma.form.findUnique({ where: { publicId: "frm_demoopenday0001" } });
      if (openDay) {
        const respondents = [
          { email: "tom.becker@demo-lead.test", firstName: "Tom", lastName: "Becker", answers: { name: "Tom Becker", phone: "+15125550151", need: "Implants", day: "Afternoons", notes: "How long is recovery?" } },
          { email: "grace.obrien@demo-lead.test", firstName: "Grace", lastName: "O'Brien", answers: { name: "Grace O'Brien", phone: "+15125550152", need: "Whitening", day: "Any" } },
        ];
        for (const r of respondents) {
          let contact = await prisma.contact.findFirst({
            where: { workspaceId: primary.id, email: r.email },
          });
          if (!contact) {
            contact = await prisma.contact.create({
              data: {
                workspaceId: primary.id,
                source: "form",
                optOut: {},
                tags: ["from-form"],
                email: r.email,
                firstName: r.firstName,
                lastName: r.lastName,
                phone: (r.answers as { phone?: string }).phone,
              },
            });
          }
          const already = await prisma.formSubmission.findFirst({
            where: { formId: openDay.id, contactId: contact.id },
          });
          if (!already) {
            await prisma.formSubmission.create({
              data: {
                workspaceId: primary.id,
                formId: openDay.id,
                contactId: contact.id,
                answers: r.answers as object,
              },
            });
          }
        }
      }

      // One DRAFT proposal — the only status the build can honestly hold
      // (delivery is Q-100; sent/viewed/signed states need it).
      const propTitle = "Full-arch implant plan";
      const existingProp = await prisma.proposal.findFirst({
        where: { workspaceId: primary.id, title: propTitle },
      });
      if (!existingProp) {
        const marcus = await prisma.contact.findFirst({
          where: { workspaceId: primary.id },
          orderBy: { createdAt: "asc" },
          select: { id: true },
        });
        await prisma.proposal.create({
          data: {
            workspaceId: primary.id,
            title: propTitle,
            status: "draft",
            variables: marcus ? { contactId: marcus.id } : {},
            blocks: [
              { kind: "cover", eyebrow: "PROPOSAL", title: "Full-arch implant plan", body: "Prepared by Bright Smile Dental · valid 14 days" },
              { kind: "text", label: "WHAT YOU TOLD US", title: "You want to eat normally again", body: "You said chewing on the left has been painful for two years, and that a denture is not something you would consider. That ruled out the cheaper route before we started." },
              { kind: "text", label: "THE PLAN", title: "Four months, three visits", body: "Placement in month one, healing through month three, final crowns in month four. You leave every visit able to eat." },
              { kind: "price", label: "PRICING", title: "Three ways to do this", options: [
                { name: "Full arch, both sides", sub: "Everything included, 8 implants", amount: "$8,400", best: true },
                { name: "One side first", sub: "Left side now, right side later", amount: "$4,600" },
                { name: "Monthly, 48 months", sub: "0% for the first year", amount: "$180/mo" },
              ] },
              { kind: "signature", label: "YOUR DECISION", body: "A $500 deposit holds your placement date. Refundable for 14 days." },
            ] as object,
          },
        });
      }

      // Automations the engine GENUINELY executes (notify_team = the run-row
      // notification surface; add_tag; reply_classified narrows by intent;
      // lead_captured fires off form.submitted.v1 — the B5 join point).
      const autos = [
        { name: "Booked → tell the team", enabled: true, trigger: { kind: "meeting_booked" }, actions: [{ kind: "notify_team", note: "A booking landed — check the calendar." }] },
        { name: "Paid → tag for a review ask", enabled: true, trigger: { kind: "payment_received" }, actions: [{ kind: "add_tag", tag: "review-candidate" }] },
        { name: "New lead → tag the source", enabled: true, trigger: { kind: "lead_captured" }, actions: [{ kind: "add_tag", tag: "new-lead" }] },
        { name: "Objection → notify me", enabled: false, trigger: { kind: "reply_classified", intents: ["objection"] }, actions: [{ kind: "notify_team", note: "A price objection is waiting in the inbox." }] },
      ];
      for (const a of autos) {
        const existing = await prisma.automation.findFirst({
          where: { workspaceId: primary.id, name: a.name },
        });
        if (!existing) {
          await prisma.automation.create({
            data: {
              workspaceId: primary.id,
              name: a.name,
              enabled: a.enabled,
              trigger: a.trigger as object,
              conditions: [],
              actions: a.actions as object,
            },
          });
        }
      }
    }

    // B6 (DEC-131): the demo workspace's ICP profile — shape + vertical for
    // the registry-resolved lead-finder surfaces. Idempotent settings merge.
    {
      const ws = await prisma.workspace.findUnique({ where: { id: primary.id } });
      const settings = (ws?.settings ?? {}) as Record<string, unknown>;
      if (!settings.icpProfile) {
        await prisma.workspace.update({
          where: { id: primary.id },
          data: {
            settings: {
              ...settings,
              icpProfile: {
                shape: "local_business",
                vertical: "dental",
                headcountBand: "5–25",
                location: "Austin",
                titles: ["Owner", "Practice Manager"],
                ownerRun: true,
              },
            },
          },
        });
      }

      // B7 (DEC-133): REPAIR pass — the earliest demo agents were seeded with
      // the pre-A8 guardrails shape (`dailyCap: 200` scalar, no window days),
      // which parseGuardrails rightly refuses; every settings control then
      // no-ops on those rows. Upgrade in place, preserving the stored values;
      // rows that already parse are untouched (idempotent).
      {
        const demoAgents = await prisma.agent.findMany({
          where: { workspaceId: primary.id },
          select: { id: true, guardrails: true },
        });
        for (const a of demoAgents) {
          const g = (a.guardrails ?? {}) as Record<string, unknown>;
          const legacyCap = typeof g.dailyCap === "number" ? g.dailyCap : null;
          const win = (g.sendingWindow ?? {}) as Record<string, unknown>;
          const legacyWindow =
            typeof win.start === "string" && !Array.isArray((win as { days?: unknown }).days);
          if (legacyCap == null && !legacyWindow) continue;
          await prisma.agent.update({
            where: { id: a.id },
            data: {
              guardrails: {
                sendingWindow: {
                  days: [1, 2, 3, 4, 5],
                  start: typeof win.start === "string" ? win.start : "09:00",
                  end: typeof win.end === "string" ? win.end : "17:00",
                  timezone: "UTC",
                },
                dailyCap: { email: legacyCap ?? 200 },
                consent: null,
                unsubscribeFooter: true,
                suppressionCheck: true,
              },
            },
          });
        }
      }

      // B8 (DEC-135, owner addition): ~3 weeks of DEMO HISTORY so Stats
      // renders meaningfully on the first walkthrough. These are REAL rows
      // through the real tables — the Stats endpoint aggregates them like
      // any others; nothing is fabricated at the API layer. Every message
      // carries stepNodeId "seed-history" (the reconciliation-fixture
      // labeling precedent) so the set is identifiable and this block is
      // idempotent (skip when any marker row exists). Deterministic day
      // offsets, never random.
      {
        const marker = await prisma.message.findFirst({
          where: { workspaceId: primary.id, stepNodeId: "seed-history" },
          select: { id: true },
        });
        const histAgents = await prisma.agent.findMany({
          where: { workspaceId: primary.id, name: { in: ["Whitening kit push", "Implant open day"] } },
          select: { id: true, name: true },
        });
        if (!marker && histAgents.length === 2) {
          // Campaign rows materialize lazily (DEC-108) — ensure one per agent.
          const campaignFor = async (a: { id: string; name: string }) =>
            (await prisma.campaign.findFirst({ where: { workspaceId: primary.id, agentId: a.id } })) ??
            prisma.campaign.create({
              data: { workspaceId: primary.id, agentId: a.id, name: `${a.name} — primary`, graphId: "" },
            });
          const agentByName = new Map(histAgents.map((a) => [a.name, a]));
          const whitRow = await campaignFor(agentByName.get("Whitening kit push")!);
          const implRow = await campaignFor(agentByName.get("Implant open day")!);
          const whit = { id: whitRow.id, agentId: whitRow.agentId, agent: { name: "Whitening kit push" } };
          const impl = { id: implRow.id, agentId: implRow.agentId, agent: { name: "Implant open day" } };
          const day = (n: number, h = 10) => new Date(Date.now() - n * 86_400_000 + h * 3_600_000 - 10 * 3_600_000);
          /** name · campaign · outbound day offsets · opened? · reply [day, intent] · stages [day, toStage] · sms? */
          const HIST: Array<{
            first: string;
            last: string;
            camp: typeof whit;
            outs: number[];
            opened?: number;
            reply?: [number, string];
            stages?: Array<[number, string]>;
            sms?: number;
          }> = [
            { first: "Ana", last: "Moreau", camp: whit, outs: [20, 16], opened: 19, reply: [18, "interested"], stages: [[17, "interested"], [15, "booked"], [9, "won"]] },
            { first: "Ben", last: "Castillo", camp: whit, outs: [20, 15], opened: 19 },
            { first: "Carla", last: "Nguyen", camp: whit, outs: [19, 14], opened: 18, reply: [16, "question"], sms: 13 },
            { first: "Dev", last: "Sharma", camp: whit, outs: [19], opened: 17 },
            { first: "Elena", last: "Brooks", camp: whit, outs: [18, 12], opened: 16, reply: [12, "interested"], stages: [[11, "booked"], [5, "won"]] },
            { first: "Frank", last: "Osei", camp: whit, outs: [18] },
            { first: "Gina", last: "Petrov", camp: whit, outs: [17, 11], opened: 15, reply: [11, "objection_price"], sms: 9 },
            { first: "Hana", last: "Suzuki", camp: whit, outs: [16, 10], opened: 14 },
            { first: "Ivan", last: "Kovac", camp: whit, outs: [15] },
            { first: "Jill", last: "Mercer", camp: whit, outs: [13, 8], opened: 12, reply: [8, "not_interested"] },
            { first: "Kofi", last: "Adjei", camp: whit, outs: [12, 7], opened: 10, stages: [[6, "booked"]] },
            { first: "Lena", last: "Weiss", camp: whit, outs: [10, 5], opened: 9 },
            { first: "Milo", last: "Ferreira", camp: whit, outs: [8, 4], opened: 7, reply: [4, "interested"], stages: [[3, "booked"]] },
            { first: "Noor", last: "Haddad", camp: whit, outs: [6, 2], opened: 5 },
            { first: "Owen", last: "Gallagher", camp: impl, outs: [21, 17], opened: 20, reply: [17, "interested"], stages: [[16, "booked"], [10, "won"]], sms: 15 },
            { first: "Pia", last: "Lindqvist", camp: impl, outs: [21, 16], opened: 19 },
            { first: "Quim", last: "Serra", camp: impl, outs: [20] },
            { first: "Rita", last: "Okafor", camp: impl, outs: [18, 13], opened: 17, reply: [13, "question"], sms: 11 },
            { first: "Sam", last: "Delacroix", camp: impl, outs: [17, 12], opened: 15, stages: [[10, "booked"]] },
            { first: "Tara", last: "Bianchi", camp: impl, outs: [15, 9], opened: 13, reply: [9, "objection_price"] },
            { first: "Umar", last: "Rashid", camp: impl, outs: [13] },
            { first: "Vera", last: "Sokolova", camp: impl, outs: [11, 6], opened: 10, reply: [6, "interested"], stages: [[5, "booked"]] },
            { first: "Wes", last: "Tanaka", camp: impl, outs: [9, 3], opened: 8, reply: [3, "not_interested"] },
            { first: "Yara", last: "Costa", camp: impl, outs: [7, 2], opened: 6 },
          ];
          const WON_AMOUNT: Record<string, number> = { "Whitening kit push": 24_900, "Implant open day": 240_000 };
          for (const [i, h] of HIST.entries()) {
            const email = `${h.first.toLowerCase()}.${h.last.toLowerCase()}@demo-lead.test`;
            const contact =
              (await prisma.contact.findFirst({ where: { workspaceId: primary.id, email } })) ??
              (await prisma.contact.create({
                data: {
                  workspaceId: primary.id,
                  source: "seed",
                  optOut: {},
                  tags: [],
                  email,
                  firstName: h.first,
                  lastName: h.last,
                },
              }));
            const finalStage = h.stages?.length ? h.stages[h.stages.length - 1]![1] : h.reply?.[1] === "not_interested" ? "lost" : "contacted";
            const enrollment = await prisma.enrollment.create({
              data: {
                workspaceId: primary.id,
                campaignId: h.camp.id,
                contactId: contact.id,
                workflowId: `seed-history-${i}-${contact.id.slice(-6)}`,
                pipelineStage: finalStage,
                status: finalStage === "won" || finalStage === "lost" ? "DONE" : "ACTIVE",
              },
            });
            for (const [j, d] of h.outs.entries()) {
              await prisma.message.create({
                data: {
                  workspaceId: primary.id,
                  campaignId: h.camp.id,
                  enrollmentId: enrollment.id,
                  contactId: contact.id,
                  channel: "email",
                  direction: "OUTBOUND",
                  subject: j === 0 ? "A slot with your name on it" : "Still holding that slot",
                  body: "seed history — demo walkthrough fixture",
                  stepNodeId: "seed-history",
                  sentAt: day(d),
                },
              });
            }
            if (h.sms != null) {
              await prisma.message.create({
                data: {
                  workspaceId: primary.id,
                  campaignId: h.camp.id,
                  enrollmentId: enrollment.id,
                  contactId: contact.id,
                  channel: "sms",
                  direction: "OUTBOUND",
                  body: "seed history — demo walkthrough fixture (sms)",
                  stepNodeId: "seed-history",
                  sentAt: day(h.sms),
                },
              });
            }
            if (h.opened != null) {
              await prisma.event.create({
                data: {
                  workspaceId: primary.id,
                  type: "email.opened.v1",
                  campaignId: h.camp.id,
                  enrollmentId: enrollment.id,
                  contactId: contact.id,
                  payload: { seed: "history" },
                  occurredAt: day(h.opened, 14),
                },
              });
            }
            if (h.reply) {
              await prisma.message.create({
                data: {
                  workspaceId: primary.id,
                  campaignId: h.camp.id,
                  enrollmentId: enrollment.id,
                  contactId: contact.id,
                  channel: "email",
                  direction: "INBOUND",
                  intent: h.reply[1],
                  body:
                    h.reply[1] === "interested"
                      ? "Yes — what times do you have?"
                      : h.reply[1] === "question"
                        ? "How long does the fitting take?"
                        : h.reply[1] === "objection_price"
                          ? "That's a bit more than I hoped — any options?"
                          : "Not for me right now, thanks.",
                  stepNodeId: "seed-history",
                  sentAt: day(h.reply[0], 15),
                },
              });
            }
            let prevStage = "contacted";
            for (const [d, toStage] of h.stages ?? []) {
              await prisma.event.create({
                data: {
                  workspaceId: primary.id,
                  type: "lead.stage_changed.v1",
                  campaignId: h.camp.id,
                  enrollmentId: enrollment.id,
                  contactId: contact.id,
                  payload: { fromStage: prevStage, toStage, seed: "history" },
                  occurredAt: day(d, 16),
                },
              });
              prevStage = toStage;
              if (toStage === "won") {
                await prisma.event.create({
                  data: {
                    workspaceId: primary.id,
                    type: "payment.received.v1",
                    campaignId: h.camp.id,
                    enrollmentId: enrollment.id,
                    contactId: contact.id,
                    payload: { amount: WON_AMOUNT[h.camp.agent.name] ?? 24_900, seed: "history" },
                    occurredAt: day(Math.max(1, d - 1), 17),
                  },
                });
              }
            }
          }
          // A handful of completed Ada calls for the by-channel row.
          const callTargets = HIST.filter((h) => h.sms != null).slice(0, 4);
          for (const [i, h] of callTargets.entries()) {
            const email = `${h.first.toLowerCase()}.${h.last.toLowerCase()}@demo-lead.test`;
            const contact = await prisma.contact.findFirst({ where: { workspaceId: primary.id, email } });
            if (!contact) continue;
            await prisma.call.create({
              data: {
                workspaceId: primary.id,
                campaignId: h.camp.id,
                agentId: h.camp.agentId,
                contactId: contact.id,
                caller: "ada",
                direction: "OUTBOUND",
                status: "COMPLETED",
                outcome: "completed",
                providerCallSid: `seed-history-call-${i}`,
                durationSec: 96 + i * 41,
                startedAt: day((h.sms ?? 10) - 1, 11),
                endedAt: day((h.sms ?? 10) - 1, 12),
                createdAt: day((h.sms ?? 10) - 1, 11),
                meta: { seed: "history" },
              },
            });
          }
        }
      }

      // B7: the demo workspace starts with a credit balance (a real column —
      // the ledger and the spend view read it). Set ONCE: never touched when
      // a balance exists or any ledger row has been written.
      {
        const wsRow = await prisma.workspace.findUniqueOrThrow({
          where: { id: primary.id },
          select: { creditBalance: true },
        });
        const ledgerRows = await prisma.creditLedger.count({ where: { workspaceId: primary.id } });
        if (wsRow.creditBalance === 0 && ledgerRows === 0) {
          await prisma.workspace.update({
            where: { id: primary.id },
            data: { creditBalance: 2340 },
          });
        }
      }

      // B6 review fix 2: two never-worked book contacts carrying REAL facts
      // (a targeted title; call consent) so the keyless pool demonstrates
      // differentiated fits next to the honest "unscored" rows. No messages —
      // inbox and campaign-activity fixtures stay untouched.
      for (const c of [
        {
          email: "marta@nguyenfamilydental.test",
          firstName: "Marta",
          lastName: "Nguyen",
          company: "Nguyen Family Dental",
          title: "Owner",
          callConsent: "granted",
        },
        {
          email: "dev@cedarparksmiles.test",
          firstName: "Dev",
          lastName: "Patel",
          company: "Cedar Park Smiles",
          title: "Practice Manager",
        },
      ]) {
        const exists = await prisma.contact.findFirst({
          where: { workspaceId: primary.id, email: c.email },
        });
        if (!exists) {
          await prisma.contact.create({
            data: { workspaceId: primary.id, source: "seed", optOut: {}, tags: [], ...c },
          });
        }
      }
    }

    // B3c-2 (DEC-121): call-clock fixtures — three phone contacts whose
    // STORED timezones spread across the globe (Chicago / Berlin / Tokyo),
    // so at any wall-clock hour at least one is inside the 08:00–21:00
    // contact-local calling floor. The drawer's window sub-line reads the
    // saved zone ("their saved timezone" — the checkable source), and the
    // human-call evidence/e2e pick whichever contact is awake. Idempotent
    // updates: re-runs restore the fixture clocks.
    await prisma.contact.updateMany({
      where: { workspaceId: primary.id, email: sofiaEmail },
      data: { timezone: "America/Chicago" },
    });
    await prisma.contact.updateMany({
      where: { workspaceId: primary.id, email: "edsger@demo-agency.test" },
      data: { phone: "+15125550143", timezone: "Asia/Tokyo" },
    });
    await prisma.contact.updateMany({
      where: { workspaceId: primary.id, email: "alan@demo-agency.test" },
      data: { phone: "+15125550144", timezone: "Europe/Berlin" },
    });

    const sofiaWf = `seed-b2-wf-${sofia.id}`;
    const hasEnrollment = await prisma.enrollment.findFirst({ where: { workflowId: sofiaWf } });
    if (!hasEnrollment) {
      await prisma.enrollment.create({
        data: {
          workspaceId: primary.id,
          campaignId: implantCampaign.id,
          contactId: sofia.id,
          workflowId: sofiaWf,
          pipelineStage: "interested",
        },
      });
    }
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const hasOutbound = await prisma.message.findFirst({
      where: { contactId: sofia.id, channel: "sms", direction: "OUTBOUND" },
    });
    if (!hasOutbound) {
      await prisma.message.create({
        data: {
          workspaceId: primary.id,
          campaignId: implantCampaign.id,
          contactId: sofia.id,
          channel: "sms",
          direction: "OUTBOUND",
          body: "Hi Sofia — Bright Smile here. Still holding a consult slot on the 21st if you want it. Reply YES and I will book you in.",
          stepNodeId: "seed-step-2",
          sentAt: threeHoursAgo,
        },
      });
    }
    let sofiaReply = await prisma.message.findFirst({
      where: { contactId: sofia.id, channel: "sms", direction: "INBOUND" },
    });
    if (!sofiaReply) {
      sofiaReply = await prisma.message.create({
        data: {
          workspaceId: primary.id,
          campaignId: implantCampaign.id,
          contactId: sofia.id,
          channel: "sms",
          direction: "INBOUND",
          body: "Can this wait until early next month? Mid-move right now.",
          intent: "objection_timing",
          sentAt: new Date(threeHoursAgo.getTime() + 25 * 60 * 1000),
        },
      });
    }
    const hasReplyEvent = await prisma.event.findFirst({
      where: { contactId: sofia.id, type: "sms.replied.v1" },
    });
    if (!hasReplyEvent) {
      await prisma.event.create({
        data: {
          workspaceId: primary.id,
          campaignId: implantCampaign.id,
          contactId: sofia.id,
          type: "sms.replied.v1",
          payload: {
            messageId: sofiaReply.id,
            body: sofiaReply.body,
            intent: "objection_timing",
          },
          occurredAt: new Date(threeHoursAgo.getTime() + 25 * 60 * 1000),
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
    // B9 (DEC-136): the PLATFORM defaults (agencyId null) — what a brand-new
    // agency's plan step resolves before any per-agency override exists.
    // Unconfirmed on purpose: every number stays a proposal until the admin
    // saves it in the backoffice billing editor (D2).
    const platformRow = await prisma.plan.findFirst({ where: { agencyId: null, name: plan.name } });
    if (!platformRow) {
      await prisma.plan.create({
        data: {
          agencyId: null,
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
  // Deterministically the ORIGINAL (oldest) agent/contact — an unordered
  // findFirst could attach these June fixtures to the implant campaign and
  // pollute the Bold inbox/pipeline fixtures.
  const demoAgent = await prisma.agent.findFirst({
    where: { workspaceId: primary.id },
    orderBy: { createdAt: "asc" },
  });
  const demoContact = await prisma.contact.findFirst({
    where: { workspaceId: primary.id },
    orderBy: { createdAt: "asc" },
  });
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
