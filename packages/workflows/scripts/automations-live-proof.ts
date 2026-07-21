/**
 * R1-UI (DEC-091) W3 live proof — the ACCOUNT rules surface end-to-end on the
 * ONE evaluator, through the REAL event bus, with the refusal walk under a
 * rule-driven move:
 *
 *   A. CREATE → FIRE → DISABLE → NO-FIRE, all through the real pipeline:
 *      an account Automation (meeting_booked → notify_team) created through
 *      the endpoint's write chain (HTTP semantics = the standing automations
 *      e2e), then a REAL `lead.stage_changed.v1` published through EventBus
 *      (persist → BullMQ enqueue → consumer fan-out, exactly as apps/worker
 *      mounts it) fires it: AutomationRun (rule, eventId) idempotency row +
 *      the `automation.rule.run.v1` scope:"account" ledger twin. Disable
 *      (audited flip, ONE status_changed) — then the SAME trigger fires again
 *      via an enabled twin: the twin's run row for event #2 exists while the
 *      disabled rule's is ABSENT. A POSITIVE no-fire proof — the twin firing
 *      proves the pipeline was live when the disabled rule stayed silent;
 *      no timeout hand-waving.
 *   B. REFUSAL WALK: a campaign rule's terminal `move_to_node` routes a
 *      SUPPRESSED contact into a sub-campaign whose first scripted step hits
 *      the UNCHANGED send boundary → typed SUPPRESSED refusal BEFORE the
 *      transport: `meta.blocked` on the enrollment, status UNSUBSCRIBED,
 *      ZERO Message rows in the whole proof (zero wire sends). The account
 *      twin still rides the same event non-terminally — the shared
 *      first-terminal-wins state across scopes, live.
 *
 * No vendor keys: nothing composes (scripted seeds only) and nothing reaches
 * a transport (the boundary refuses first) — SANDBOX is moot by construction.
 * §G discipline: proof-local rows, root-domain DNS untouched. Runs in the
 * automations-live-proof GitHub workflow; never CI.
 *
 * PROOF_ALLOW_NO_TEMPORAL=1 (local receipts only — the workflow NEVER sets
 * it): when the local Temporal dev server can't start (e.g. a sandboxed
 * network blocking the CLI download), part B is SKIPPED LOUDLY and part A
 * still gates. CI runs the full walk.
 */
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { createPerAgentRules } from "@clientforce/automations";
import { SendGridSender } from "@clientforce/channels";
import {
  addSubcampaign,
  automationWriteSchema,
  repairGraph,
  validateGraph,
  type CampaignGraph,
} from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import {
  EventBus,
  bullConnectionFromUrl,
  createTemporalSignalConsumer,
} from "@clientforce/events";
import { validateEditedGraph } from "@clientforce/planner";
import { createActivities } from "../src/activities";
import { cancelWorkflowById, moveEnrollmentToNode, signalEnrollmentReply } from "../src/client";
import { TASK_QUEUE, workflowIdFor, type CampaignWorkflowInput } from "../src/shared";

const t0 = Date.now();
function stamp(msg: string): void {
  console.log(`[t+${String(Date.now() - t0).padStart(6, " ")}ms] ${msg}`);
}
function gate(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "✓" : "✗"} GATE ${name}: ${detail}`);
  if (!ok) throw new Error(`GATE FAILED: ${name} — ${detail}`);
}
const waitFor = async <T>(what: string, deadlineMs: number, poll: () => Promise<T | null>) => {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const got = await poll();
    if (got !== null) return got;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
};

/** v1: a 30-day delay entry, then one scripted step — with delayScale 1 the
 *  main path NEVER advances during the proof, so every send-shaped assertion
 *  belongs to the moved-to container alone (and stays at zero). */
function graphV1(): CampaignGraph {
  return {
    entry: "d0",
    nodes: [
      { id: "d0", type: "delay", amount: 30, unit: "days" },
      {
        id: "s1",
        type: "step",
        channel: "email",
        content: { subject: "never sent", body: "Main-path step — the proof never reaches it.\n\n— {{senderName}}" },
      },
      { id: "end-1", type: "end" },
    ],
    edges: [
      { from: "d0", to: "s1" },
      { from: "s1", to: "end-1" },
    ],
  };
}

type Meta = Record<string, unknown>;

async function main(): Promise<void> {
  if (!process.env.REDIS_URL) throw new Error("GATE FAILED: REDIS_URL missing — the proof runs the REAL bus");

  console.log("\n=== R1-UI W3 LIVE PROOF · account rules on the ONE evaluator, real bus + refusal walk ===");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();

  let temporalEnv: TestWorkflowEnvironment | null = null;
  try {
    console.log("Starting local Temporal dev server…");
    temporalEnv = await TestWorkflowEnvironment.createLocal();
  } catch (err) {
    if (process.env.PROOF_ALLOW_NO_TEMPORAL === "1") {
      console.log(
        `\n⚠ TEMPORAL UNAVAILABLE (${err instanceof Error ? err.message.split("\n")[0] : String(err)})` +
          "\n⚠ PROOF_ALLOW_NO_TEMPORAL=1 — part B (refusal walk) will be SKIPPED LOUDLY; part A still gates.\n",
      );
    } else {
      throw err;
    }
  }

  const suffix = `r1ui-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "r1ui-proof", slug: suffix, settings: {} },
  });

  let bus: EventBus | null = null;
  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Rules Prover",
        goal: "book_appointments",
        status: "ACTIVE",
        guardrails: {
          sendingWindow: { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "23:59", timezone: "UTC" },
          dailyCap: { email: 20 },
          consent: null,
          unsubscribeFooter: true,
          suppressionCheck: true,
        },
      },
    });
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws.id, agentId: agent.id, name: "primary", graphId: "" },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws.id,
        type: "CF_MANAGED",
        fromEmail: "proof@send.clientforce.io",
        fromName: "Rules Prover",
        replyTo: "inbound@reply.clientforce.io",
      },
    });
    const v1 = graphV1();
    const v1row = await owner.campaignGraph.create({
      data: { workspaceId: ws.id, campaignId: campaign.id, version: 1, source: "AI", graph: v1 as object },
    });
    await owner.campaign.update({ where: { id: campaign.id }, data: { graphId: v1row.id } });

    const mkContact = (first: string, slug: string) =>
      owner.contact.create({
        data: {
          workspaceId: ws.id,
          source: "live-proof",
          optOut: {},
          tags: [],
          email: `${slug}-${suffix}@proof.test`,
          firstName: first,
          company: "Proof Dental",
        },
      });
    const contactA = await mkContact("Ada", "r1ui-a");
    const contactB = await mkContact("Ben", "r1ui-b");

    const mkEnrollment = async (contactId: string, graphVersion: number) => {
      const row = await owner.enrollment.create({
        data: {
          workspaceId: ws.id,
          campaignId: campaign.id,
          contactId,
          workflowId: workflowIdFor("pending"),
          pipelineStage: "new",
          meta: { graphVersion },
        },
      });
      return owner.enrollment.update({
        where: { id: row.id },
        data: { workflowId: workflowIdFor(row.id) },
      });
    };

    // ── the rules engine + bus, wired EXACTLY as apps/worker mounts them ────
    const busRef: { current?: EventBus } = {};
    const ruleDeps = {
      prisma: app,
      publish: async (input: Parameters<EventBus["publish"]>[0]) => {
        if (busRef.current) await busRef.current.publish(input);
      },
      cancelWorkflow: async ({ workflowId }: { workflowId: string }) => {
        if (!temporalEnv) throw new Error("TEMPORAL unavailable — cancel skipped");
        await cancelWorkflowById(temporalEnv.client, workflowId);
      },
      moveEnrollment: async (params: {
        workspaceId: string;
        enrollmentId: string;
        targetNodeId: string;
        dedupeKey: string;
      }) => {
        if (!temporalEnv) throw new Error("TEMPORAL unavailable — move unavailable");
        await moveEnrollmentToNode(temporalEnv.client, app, params);
      },
      log: (msg: string) => console.log(`  [rules] ${msg}`),
    };
    const rules = createPerAgentRules(ruleDeps);
    const signalConsumer = createTemporalSignalConsumer(
      async (enrollmentId: string, intent: string) => {
        if (!temporalEnv) return;
        const row = await owner.enrollment.findUnique({
          where: { id: enrollmentId },
          select: { workflowId: true },
        });
        await signalEnrollmentReply(temporalEnv.client, enrollmentId, intent, row?.workflowId ?? undefined);
      },
      console.warn,
      rules.shouldContinueGraph,
    );
    bus = new EventBus({
      prisma: app,
      connection: bullConnectionFromUrl(process.env.REDIS_URL),
      consumers: [signalConsumer, rules.consumer],
    });
    busRef.current = bus;
    bus.startConsumer();
    stamp("event-bus consumer started (temporal-signal + R1 rules — the apps/worker wiring)");

    // Stage-move publisher — the enrollments PATCH endpoint's chain inline
    // (same row update, byte-same event shape; HTTP semantics are e2e-pinned).
    const moveStage = async (enrollmentId: string, contactId: string, toStage: string) => {
      const row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      await owner.enrollment.update({ where: { id: enrollmentId }, data: { pipelineStage: toStage } });
      return bus!.publish({
        workspaceId: ws.id,
        type: "lead.stage_changed.v1",
        contactId,
        enrollmentId,
        campaignId: campaign.id,
        payload: {
          fromStage: row.pipelineStage,
          toStage,
          manual: true,
          ...(toStage === "booked" ? { goalKey: "book_appointments", label: "Meeting booked" } : {}),
        },
      });
    };

    // ── A · create → fire ───────────────────────────────────────────────────
    // The POST /automations write chain inline: the ONE engine validation
    // (automationWriteSchema), then the row — guards' HTTP semantics (dup-422,
    // scope-422, ref-422) are pinned by apps/api/test/automations.e2e.spec.ts.
    const dtoA = automationWriteSchema.parse({
      name: "Booked → notify the team",
      trigger: { kind: "meeting_booked" },
      actions: [{ kind: "notify_team", note: "Meeting booked — R1-UI proof" }],
    });
    const autoA = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.automation.create({
        data: {
          workspaceId: ws.id,
          name: dtoA.name,
          enabled: dtoA.enabled,
          trigger: dtoA.trigger as object,
          conditions: dtoA.conditions as object[],
          actions: dtoA.actions as object[],
        },
      }),
    );
    const enrollA = await mkEnrollment(contactA.id, 1); // ACTIVE, no durable run needed for a stage move
    stamp(`account automation A created (${autoA.id}) — moving contact A's stage to "booked" through the REAL bus`);
    const evt1 = await moveStage(enrollA.id, contactA.id, "booked");

    const runA1 = await waitFor("AutomationRun (A, evt1)", 30_000, () =>
      owner.automationRun.findUnique({
        where: { automationId_eventId: { automationId: autoA.id, eventId: evt1.id } },
      }),
    );
    const runA1detail = runA1.detail as { trigger?: string; actions?: Array<{ kind?: string; outcome?: string }> };
    gate(
      "ACCOUNT-RULE-FIRES",
      runA1.status === "fired" &&
        runA1detail.trigger === "meeting_booked" &&
        (runA1detail.actions ?? []).some((a) => a.kind === "notify_team" && a.outcome === "executed"),
      `a REAL lead.stage_changed.v1 (persist → BullMQ → consumer) fired the account pass: AutomationRun ${runA1.id} (rule A, event ${evt1.id}) status=fired, notify_team executed`,
    );
    const ledgerA1 = await waitFor("ledger twin (A, evt1)", 15_000, async () => {
      const rows = await owner.event.findMany({
        where: { workspaceId: ws.id, type: "automation.rule.run.v1" },
      });
      return rows.find((e) => (e.payload as Meta).ruleId === autoA.id) ?? null;
    });
    gate(
      "LEDGER-TWIN",
      (ledgerA1.payload as Meta).scope === "account" &&
        (ledgerA1.payload as Meta).status === "fired" &&
        (ledgerA1.payload as Meta).runId === runA1.id,
      `automation.rule.run.v1 landed with scope:"account", runId=${runA1.id} — the row/timeline twin`,
    );

    // ── A · disable → the POSITIVE no-fire ──────────────────────────────────
    // The PATCH toggle chain inline (audited on ACTUAL change only).
    await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.automation.update({ where: { id: autoA.id }, data: { enabled: false } }),
    );
    await bus.publish({
      workspaceId: ws.id,
      type: "automation.status_changed.v1",
      payload: { automationId: autoA.id, from: "enabled", to: "disabled" },
    });
    // The enabled twin — same trigger, legal now that A is disabled (the
    // dup-422 guards ENABLED rows only; e2e-pinned).
    const dtoB = automationWriteSchema.parse({
      name: "Booked twin (proves the pipeline stayed live)",
      trigger: { kind: "meeting_booked" },
      actions: [{ kind: "notify_team" }],
    });
    const autoB = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.automation.create({
        data: {
          workspaceId: ws.id,
          name: dtoB.name,
          enabled: true,
          trigger: dtoB.trigger as object,
          conditions: [],
          actions: dtoB.actions as object[],
        },
      }),
    );
    await moveStage(enrollA.id, contactA.id, "new");
    const evt2 = await moveStage(enrollA.id, contactA.id, "booked");
    stamp("A disabled (audited) · twin B enabled · the SAME trigger fired again (event #2)");

    const runB2 = await waitFor("AutomationRun (B, evt2)", 30_000, () =>
      owner.automationRun.findUnique({
        where: { automationId_eventId: { automationId: autoB.id, eventId: evt2.id } },
      }),
    );
    const runA2 = await owner.automationRun.findUnique({
      where: { automationId_eventId: { automationId: autoA.id, eventId: evt2.id } },
    });
    const statusAudits = await owner.event.findMany({
      where: { workspaceId: ws.id, type: "automation.status_changed.v1" },
    });
    gate(
      "DISABLED-STAYS-SILENT",
      runB2.status === "fired" && runA2 === null && statusAudits.length === 1,
      `event #2 (${evt2.id}): twin B FIRED (run ${runB2.id}) while disabled A has NO run row — the pipeline was live and A stayed silent; exactly ONE status_changed audit`,
    );

    // ── B · the refusal walk under a rule-driven move ───────────────────────
    if (!temporalEnv) {
      console.log(
        "\n⚠ PART B SKIPPED (Temporal unavailable, PROOF_ALLOW_NO_TEMPORAL=1) — the refusal walk" +
          "\n⚠ (campaign move_to_node → boundary SUPPRESSED refusal → zero sends) runs in the" +
          "\n⚠ automations-live-proof workflow, where the dev-server download is reachable.\n",
      );
    } else {
      // The sub-campaign container with ONE SCRIPTED seed step — the #90
      // creator chain inline (validateEditedGraph admit-new; e2e-pinned).
      const created = await withTenant(app, { workspaceId: ws.id }, async (tx) => {
        const latest = await tx.campaignGraph.findFirstOrThrow({
          where: { campaignId: campaign.id },
          orderBy: { version: "desc" },
        });
        const previous = validateGraph(latest.graph);
        const mutated = addSubcampaign(previous, {
          name: "Booked follow-up",
          seed: [
            {
              channel: "email",
              content: { subject: "About your booking", body: "Hi {{firstName}}, confirming the slot.\n\n— {{senderName}}" },
            },
          ],
        });
        const { graph: repaired, repairs } = repairGraph(mutated.graph);
        const graph = validateEditedGraph(previous, repaired, {
          allowedChannels: ["email"],
          subcampaigns: "admit-new",
        });
        const row = await tx.campaignGraph.create({
          data: {
            workspaceId: ws.id,
            campaignId: campaign.id,
            version: latest.version + 1,
            source: "MANUAL",
            graph: graph as object,
          },
        });
        await tx.campaign.update({ where: { id: campaign.id }, data: { graphId: row.id } });
        const rule = await tx.campaignRule.create({
          data: {
            workspaceId: ws.id,
            campaignId: campaign.id,
            order: 1,
            trigger: { kind: "meeting_booked" },
            actions: [{ kind: "move_to_node", targetNodeId: mutated.subcampaignId }],
            enabled: true,
          },
        });
        return { rule, subcampaignId: mutated.subcampaignId, graph, version: latest.version + 1, repairs };
      });
      gate(
        "CONTAINER-CREATED",
        created.version === 2 && created.repairs.length === 0,
        `sub-campaign "Booked follow-up" (scripted seed) landed as MANUAL v2 + the campaign rule (meeting_booked → move_to_node ${created.subcampaignId})`,
      );

      const worker = await Worker.create({
        connection: temporalEnv.nativeConnection,
        taskQueue: TASK_QUEUE,
        workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
        activities: createActivities({
          prisma: app,
          transport: new SendGridSender(), // never reached — the boundary refuses first
          allowlist: [contactA.email!, contactB.email!],
        }),
      });

      await worker.runUntil(async () => {
        const enrollB = await mkEnrollment(contactB.id, created.version);
        await temporalEnv!.client.workflow.start("campaignWorkflow", {
          taskQueue: TASK_QUEUE,
          workflowId: workflowIdFor(enrollB.id),
          args: [
            {
              workspaceId: ws.id,
              campaignId: campaign.id,
              agentId: agent.id,
              senderId: sender.id,
              enrollmentId: enrollB.id,
              contactId: contactB.id,
              graph: created.graph,
              graphVersion: created.version,
              delayScale: 1, // the 30-day entry delay NEVER elapses — only the move can send
            } satisfies CampaignWorkflowInput,
          ],
        });
        stamp("contact B enrolled, durable run parked on the 30-day entry delay");

        // Suppress B BEFORE the trigger — the suppressions endpoint's chain
        // inline (Suppression row only: enrollment stays ACTIVE + fireable,
        // optOut untouched, so the refusal is deterministically SUPPRESSED).
        await owner.suppression.create({
          data: {
            workspaceId: ws.id,
            channel: "email",
            address: contactB.email!.toLowerCase(),
            reason: "MANUAL",
            source: "live-proof",
          },
        });
        const evt3 = await moveStage(enrollB.id, contactB.id, "booked");
        stamp(`B suppressed, then stage → "booked" (event #3) — the campaign rule moves, the boundary must refuse`);

        const ruleRun = await waitFor("CampaignRuleRun (move rule, evt3)", 30_000, () =>
          owner.campaignRuleRun.findFirst({
            where: { ruleId: created.rule.id, eventId: evt3.id },
          }),
        );
        const ruleDetail = ruleRun.detail as { terminal?: boolean; actions?: Array<{ kind?: string; outcome?: string }> };
        gate(
          "RULE-DRIVEN-MOVE",
          ruleRun.status === "fired" &&
            ruleDetail.terminal === true &&
            (ruleDetail.actions ?? []).some((a) => a.kind === "move_to_node" && a.outcome === "executed"),
          `the campaign rule FIRED terminal on event #3 — move_to_node executed (CampaignRuleRun ${ruleRun.id})`,
        );

        const blockedRow = await waitFor("the typed SUPPRESSED refusal", 60_000, async () => {
          const row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB.id } });
          const blocked = ((row.meta ?? {}) as Meta).blocked as { reason?: string } | undefined;
          return blocked?.reason ? row : null;
        });
        const blocked = ((blockedRow.meta ?? {}) as Meta).blocked as { reason?: string; nodeId?: string };
        gate(
          "BOUNDARY-REFUSES-TYPED",
          blocked.reason === "SUPPRESSED" &&
            blockedRow.status === "UNSUBSCRIBED" &&
            blockedRow.workflowId.includes("-m"),
          `the moved run's FIRST send refused SUPPRESSED before the transport — meta.blocked typed (node ${String(blocked.nodeId)}), status UNSUBSCRIBED, workflowId ${blockedRow.workflowId} (the rule-driven restart)`,
        );

        const runB3 = await owner.automationRun.findUnique({
          where: { automationId_eventId: { automationId: autoB.id, eventId: evt3.id } },
        });
        gate(
          "ACCOUNT-RIDES-ALONG",
          runB3 !== null && runB3.status === "fired",
          `the account twin fired NON-TERMINALLY on the same event the campaign rule terminated — first terminal wins ACROSS scopes, non-terminals still run`,
        );
      });
    }

    // ── the zero-wire floor, whole proof ────────────────────────────────────
    const sends = await owner.message.count({ where: { workspaceId: ws.id } });
    gate("ZERO-WIRE-SENDS", sends === 0, `Message rows in the proof workspace: ${sends} — nothing ever reached a transport`);

    console.log(
      "\nR1-UI W3 complete: the account surface's rules fire through the REAL bus on a REAL stage move," +
        "\nland their AutomationRun + scope:\"account\" ledger twin, and a disabled rule stays silent while" +
        "\nits enabled twin proves the pipeline live." +
        (temporalEnv
          ? " The refusal walk held the rails under a rule-driven" +
            "\nmove: typed SUPPRESSED at the unchanged boundary, zero wire sends."
          : " (Refusal walk SKIPPED this run — see the loud notice above.)"),
    );
    console.log("\n=== END LIVE PROOF ===");
  } finally {
    await bus?.close().catch(() => {});
    await owner.message.deleteMany({ where: { workspaceId: ws.id } }).catch(() => {});
    await temporalEnv?.teardown().catch(() => {});
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
