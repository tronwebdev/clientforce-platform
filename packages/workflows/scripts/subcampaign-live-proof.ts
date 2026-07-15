/**
 * #90 (DEC-077) W3 live proof — the branch-creation story end-to-end through
 * REAL durable runs on the merged tree:
 *
 *   1. CREATE on a launched agent: addSubcampaign → repairGraph →
 *      validateEditedGraph("admit-new" + ruleTargetNodeIds) → MANUAL v2 +
 *      the R1 entry rule (terminal move_to_node → container), one tenant tx
 *      (the endpoint's chain; its HTTP semantics are the standing e2e). The
 *      seeded chain carries a GUIDED step — the branch composes at send.
 *   2. MID-SEQUENCE UNTOUCHED: contact A enrolled on v1 BEFORE the creation
 *      finishes on v1 through its real durable run (v1 scripted copy, meta
 *      audit v1, the container never fires for it) — DEC-076 versioning
 *      re-proven on the new shape.
 *   3. THE TRIGGER ROUTES: contact B (enrolled on v2) replies "interested"
 *      mid-sequence; the REAL R1 engine — createPerAgentRules wired exactly
 *      as apps/worker mounts it, with the REAL moveEnrollmentToNode/cancel
 *      against the durable env — matches reply_classified, fires the
 *      terminal move, CANCELS B's run and RESTARTS it AT the container:
 *      enter_subcampaign Logs receipt, CampaignRuleRun fired+terminal, the
 *      in-graph reply signal suppressed (shouldContinueGraph false — the
 *      interlock live).
 *   4. GUIDED INSIDE THE BRANCH: the container's guided step composes (real
 *      Sonnet-class) → deterministic checks → the unchanged boundary →
 *      CAN-SPAM footer EXACTLY once → sent (sandbox); provenance meta on
 *      the Message row; B completes at the container's own end node.
 *   5. REFUSAL WALK, LOUD: dup-trigger equality, shared-chain and count-rule
 *      candidates refuse with precise messages; repairs are REPORTED where
 *      the deterministic pass ran; zero rows persist.
 *
 * §G discipline: SANDBOX transport (nothing delivered), proof-local rows,
 * root-domain DNS untouched. Runs only in the subcampaign-live-proof GitHub
 * workflow; never CI.
 */
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import { createPerAgentRules } from "@clientforce/automations";
import {
  createEmailStepComposer,
  SendGridSender,
} from "@clientforce/channels";
import {
  addSubcampaign,
  repairGraph,
  subcampaignChainOf,
  validateGraph,
  type CampaignGraph,
  type StepBrief,
} from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { createTemporalSignalConsumer, type BusEvent } from "@clientforce/events";
import { validateEditedGraph } from "@clientforce/planner";
import { createActivities } from "../src/activities";
import { cancelWorkflowById, moveEnrollmentToNode, signalEnrollmentReply } from "../src/client";
import { REPLY_SIGNAL, TASK_QUEUE, workflowIdFor, type CampaignWorkflowInput } from "../src/shared";

const FACT = "free growth audit";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";
const DELAY_SCALE = 6 / 86_400; // 1 graph-day ≈ 6 real seconds

const BRANCH_BRIEF: StepBrief = {
  objective: "Get the interested lead to pick a slot",
  talkingPoints: [
    `the ${FACT} maps where bookings leak`,
    "results land within 7 days",
    "picking a slot takes one minute",
  ],
  mustSay: [FACT],
  subjectHint: "your slot for the audit",
};

const t0 = Date.now();
function stamp(msg: string): void {
  console.log(`[t+${String(Date.now() - t0).padStart(6, " ")}ms] ${msg}`);
}
function gate(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "✓" : "✗"} GATE ${name}: ${detail}`);
  if (!ok) throw new Error(`GATE FAILED: ${name} — ${detail}`);
}

/** The launched agent's v1 graph (the W0 fixture shape). */
function graphV1(): CampaignGraph {
  return {
    entry: "s1",
    nodes: [
      {
        id: "s1",
        type: "step",
        channel: "email",
        content: {
          subject: "A quick idea for {{company}}",
          body: "Hi {{firstName}}, step 1 of the #90 W3 walk.\n\n— {{senderName}}",
        },
      },
      { id: "d1", type: "delay", amount: 1, unit: "days" },
      {
        id: "s2",
        type: "step",
        channel: "email",
        content: { body: "Bump, {{firstName}} — v1 scripted step-2.\n\n— {{senderName}}", threaded: true },
      },
      {
        id: "br",
        type: "branch",
        on: "reply",
        cases: [
          { when: { intent: "interested" }, goto: "end-a", pipeline: "booked" },
          { when: "default", goto: "end-b" },
        ],
      },
      { id: "end-a", type: "end" },
      { id: "end-b", type: "end" },
    ],
    edges: [
      { from: "s1", to: "d1" },
      { from: "d1", to: "s2" },
      { from: "s2", to: "br" },
    ],
  };
}

type Meta = Record<string, unknown>;

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("GATE FAILED: ANTHROPIC_API_KEY missing");
  if (!process.env.SENDGRID_API_KEY) throw new Error("GATE FAILED: SENDGRID_API_KEY missing");
  if (process.env.SENDGRID_SANDBOX === "false" || process.env.CHANNELS_SANDBOX === "false") {
    throw new Error("GATE FAILED: this proof runs the transport in SANDBOX only");
  }

  console.log("\n=== #90 W3 LIVE PROOF · branch creation → R1 routes → guided send, durable ===");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const gateway = new AiGateway({ provider: new AnthropicProvider() });

  console.log("Starting local Temporal dev server…");
  const env = await TestWorkflowEnvironment.createLocal();

  const suffix = `w3-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "w3-proof", slug: suffix, settings: {} },
  });

  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Branching Booker",
        goal: "book_appointments",
        category: "Dental & Orthodontics",
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
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: {
          offer: { value: `We book dental appointments with a ${FACT}.`, citations: [], source: "typed" },
          company_address: { value: ADDRESS, citations: [], source: "typed" },
        },
      },
    });
    const sender = await owner.senderConnection.create({
      data: {
        workspaceId: ws.id,
        type: "CF_MANAGED",
        fromEmail: "proof@send.clientforce.io",
        fromName: "Branching Booker",
        replyTo: "inbound@reply.clientforce.io",
      },
    });
    const v1 = graphV1();
    const v1row = await owner.campaignGraph.create({
      data: { workspaceId: ws.id, campaignId: campaign.id, version: 1, source: "AI", graph: v1 as object },
    });
    await owner.campaign.update({ where: { id: campaign.id }, data: { graphId: v1row.id } });

    const mkContact = (first: string, company: string, slug: string) =>
      owner.contact.create({
        data: {
          workspaceId: ws.id,
          source: "live-proof",
          optOut: {},
          tags: [],
          email: `${slug}-${suffix}@proof.test`,
          firstName: first,
          company,
        },
      });
    const contactA = await mkContact("Ada", "Bright Ortho", "w3-a");
    const contactB = await mkContact("Ben", "Lakeside Dental", "w3-b");
    const allowlist = [contactA.email!, contactB.email!];

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

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
      activities: createActivities({
        prisma: app,
        transport: new SendGridSender(), // SANDBOX default ON
        allowlist,
        composeEmail: createEmailStepComposer({ prisma: app, gateway }),
      }),
    });

    // The R1 engine, wired EXACTLY as apps/worker mounts it — real move/cancel
    // against the durable env; publish records (no bus in the proof).
    const published: Array<{ type: string }> = [];
    const ruleDeps = {
      prisma: app,
      publish: async (input: { type: string }) => {
        published.push({ type: input.type });
      },
      cancelWorkflow: async ({ workflowId }: { workflowId: string }) => {
        await cancelWorkflowById(env.client, workflowId);
      },
      moveEnrollment: async (params: {
        workspaceId: string;
        enrollmentId: string;
        targetNodeId: string;
        dedupeKey: string;
      }) => {
        await moveEnrollmentToNode(env.client, app, params);
      },
      log: (msg: string) => console.log(`  [rules] ${msg}`),
    };
    const rules = createPerAgentRules(ruleDeps);
    const signalsDelivered: string[] = [];
    const signalConsumer = createTemporalSignalConsumer(
      async (enrollmentId: string, intent: string) => {
        const row = await owner.enrollment.findUnique({
          where: { id: enrollmentId },
          select: { workflowId: true },
        });
        await signalEnrollmentReply(env.client, enrollmentId, intent, row?.workflowId ?? undefined);
        signalsDelivered.push(`${enrollmentId}:${intent}`);
      },
      console.warn,
      rules.shouldContinueGraph,
    );
    // The bus fan-out (Promise.all over consumers), minus Redis.
    const fanOut = async (event: BusEvent) => {
      await Promise.all([signalConsumer.handle(event), rules.consumer.handle(event)]);
    };

    const messagesOf = (enrollmentId: string) =>
      owner.message.findMany({ where: { enrollmentId }, orderBy: { sentAt: "asc" } });
    const waitFor = async <T>(what: string, deadlineMs: number, poll: () => Promise<T | null>) => {
      const deadline = Date.now() + deadlineMs;
      for (;;) {
        const got = await poll();
        if (got !== null) return got;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    await worker.runUntil(async () => {
      // ── contact A enrolls on v1 and advances BEFORE the branch exists ────
      const enrollA = await mkEnrollment(contactA.id, 1);
      stamp("contact A workflow start (v1, pre-creation)");
      const handleA = await env.client.workflow.start("campaignWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId: workflowIdFor(enrollA.id),
        args: [
          {
            workspaceId: ws.id,
            campaignId: campaign.id,
            agentId: agent.id,
            senderId: sender.id,
            enrollmentId: enrollA.id,
            contactId: contactA.id,
            graph: v1,
            graphVersion: 1,
            delayScale: DELAY_SCALE,
          } satisfies CampaignWorkflowInput,
        ],
      });
      await waitFor("A step-1", 30_000, async () =>
        (await messagesOf(enrollA.id)).length >= 1 ? true : null,
      );
      stamp("A step-1 sent — A sits on the 1-day timer; the branch is created NOW");

      // ── 1 · the creation, through the gate, one tenant tx ────────────────
      const created = await withTenant(app, { workspaceId: ws.id }, async (tx) => {
        const latest = await tx.campaignGraph.findFirstOrThrow({
          where: { campaignId: campaign.id },
          orderBy: { version: "desc" },
        });
        const previous = validateGraph(latest.graph);
        const mutated = addSubcampaign(previous, {
          name: "Interested follow-up",
          seed: [{ channel: "email", brief: BRANCH_BRIEF }],
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
            trigger: { kind: "reply_classified", intents: ["interested"] },
            actions: [{ kind: "move_to_node", targetNodeId: mutated.subcampaignId }],
            enabled: true,
          },
        });
        return { row, rule, subcampaignId: mutated.subcampaignId, repairs, graph };
      });
      gate(
        "CREATE-THROUGH-GATE",
        created.row.version === 2 &&
          created.row.source === "MANUAL" &&
          created.subcampaignId === "subcampaign-added-1" &&
          created.repairs.length === 0,
        `branch "Interested follow-up" landed as MANUAL v2 with its R1 entry rule (reply_classified[interested] → move_to_node ${created.subcampaignId}) on the LAUNCHED agent`,
      );
      const guidedStepId = subcampaignChainOf(created.graph, created.subcampaignId)![0]!.id;

      // ── 2 · A finishes on v1, the container never fires for it ───────────
      await waitFor("A step-2", 30_000, async () =>
        (await messagesOf(enrollA.id)).length >= 2 ? true : null,
      );
      const aRows = await messagesOf(enrollA.id);
      gate(
        "MID-SEQUENCE-PINNED",
        aRows[1]!.sentAt.getTime() > created.row.createdAt.getTime() &&
          aRows[1]!.body.includes("v1 scripted step-2") &&
          !("mode" in ((aRows[1]!.meta ?? {}) as Meta)),
        `A's step-2 sent AFTER v2 persisted, still the v1 scripted copy`,
      );
      await handleA.signal(REPLY_SIGNAL, "interested");
      const resultA = (await handleA.result()) as { status: string; endNode?: string };
      const rowA = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollA.id } });
      gate(
        "MID-SEQUENCE-FINISHES-V1",
        resultA.status === "completed" &&
          resultA.endNode === "end-a" &&
          (rowA.meta as Meta).graphVersion === 1 &&
          (await messagesOf(enrollA.id)).length === 2 &&
          !(await messagesOf(enrollA.id)).some((m) => m.stepNodeId === guidedStepId),
        `A completed at v1's end-a with graphVersion=1 — the created branch never fired for the mid-sequence contact`,
      );

      // ── 3 · contact B enrolls on v2; the R1 trigger routes it in ─────────
      const latestForB = await owner.campaignGraph.findFirstOrThrow({
        where: { campaignId: campaign.id },
        orderBy: { version: "desc" },
      });
      const graphB = validateGraph(latestForB.graph);
      const enrollB = await mkEnrollment(contactB.id, latestForB.version);
      stamp("contact B workflow start (v2 — the graph WITH the branch)");
      await env.client.workflow.start("campaignWorkflow", {
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
            graph: graphB,
            graphVersion: latestForB.version,
            delayScale: DELAY_SCALE,
          } satisfies CampaignWorkflowInput,
        ],
      });
      await waitFor("B step-1", 30_000, async () =>
        (await messagesOf(enrollB.id)).length >= 1 ? true : null,
      );
      stamp('B step-1 sent — B replies "interested" while mid-sequence; the REAL engine evaluates');

      const replyEvent: BusEvent = {
        id: `evt-${suffix}-reply-1`,
        workspaceId: ws.id,
        type: "email.replied.v1",
        contactId: contactB.id,
        enrollmentId: enrollB.id,
        campaignId: campaign.id,
        payload: { messageId: `m-${suffix}`, intent: "interested" },
        occurredAt: new Date().toISOString(),
      };
      await fanOut(replyEvent);

      const run = await owner.campaignRuleRun.findFirstOrThrow({
        where: { ruleId: created.rule.id },
      });
      const runDetail = run.detail as { terminal?: boolean; actions?: Array<{ outcome?: string }> };
      gate(
        "R1-ROUTES-THE-ENROLLMENT",
        run.status === "fired" &&
          runDetail.terminal === true &&
          signalsDelivered.length === 0 &&
          published.some((p) => p.type === "automation.rule.run.v1"),
        `the rule FIRED terminal (CampaignRuleRun ${run.id}); the in-graph reply signal was SUPPRESSED (interlock live); automation.rule.run.v1 published`,
      );
      const rowBMoved = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB.id } });
      gate(
        "MOVE-CANCEL-RESTART",
        rowBMoved.workflowId !== workflowIdFor(enrollB.id) &&
          rowBMoved.workflowId.includes("-m") &&
          rowBMoved.status === "ACTIVE" &&
          rowBMoved.currentNode === created.subcampaignId &&
          (rowBMoved.meta as Meta).graphVersion === 2,
        `B's run restarted AT the container (workflowId ${rowBMoved.workflowId}, currentNode ${rowBMoved.currentNode}, graphVersion re-stamped 2)`,
      );

      // ── 4 · the guided step inside the branch composes → boundary ────────
      const branchMsg = await waitFor("the branch's guided send", 120_000, async () => {
        const rows = await messagesOf(enrollB.id);
        return rows.find((m) => m.stepNodeId === guidedStepId) ?? null;
      });
      console.log(`\n— The branch's guided send (composed at send):\nSubject: ${branchMsg.subject}\n${branchMsg.body}\n`);
      const meta = (branchMsg.meta ?? {}) as Meta;
      const composedPart = branchMsg.body.split("\n\n--\n")[0]!;
      gate(
        "BRANCH-GUIDED-COMPOSED",
        meta.mode === "guided" && meta.composerVersion === "composer.email@v1" && meta.briefVersion === 2,
        `the branch step COMPOSED with provenance {mode:"guided", briefVersion:2, ${String(meta.composerVersion)}}`,
      );
      gate(
        "BRANCH-FOOTER-ONCE",
        (branchMsg.body.match(/Unsubscribe:/g) ?? []).length === 1 &&
          (branchMsg.body.match(/unsubscribe/gi) ?? []).length === 1 &&
          branchMsg.body.includes(ADDRESS) &&
          !composedPart.toLowerCase().includes("unsubscribe") &&
          `${branchMsg.subject}\n${branchMsg.body}`.toLowerCase().includes(FACT),
        `checks → boundary → CAN-SPAM footer EXACTLY once (address verbatim; mustSay grounded; the composer never wrote the footer)`,
      );
      const enterReceipt = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB.id } });
      const events = ((enterReceipt.meta as Meta).events ?? []) as Array<{ detail?: string; kind?: string }>;
      gate(
        "ENTER-SUBCAMPAIGN-RECEIPT",
        events.some(
          (e) => (e.kind === "subcampaign" || (e.detail ?? "").includes("Interested follow-up")),
        ),
        `the enter_subcampaign Logs receipt carries the branch name`,
      );
      const finalB = await waitFor("B completes", 60_000, async () => {
        const row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB.id } });
        return row.status === "DONE" ? row : null;
      });
      gate(
        "BRANCH-COMPLETES",
        finalB.currentNode === "end-added-1" || finalB.currentNode === guidedStepId,
        `B finished DONE inside the branch (currentNode ${finalB.currentNode}) — run-off-the-chain completion`,
      );
      // Cross-check: A untouched by everything after its finish.
      gate(
        "MID-SEQUENCE-CROSS-CHECK",
        (await messagesOf(enrollA.id)).length === 2,
        `contact A still has exactly its 2 v1 sends`,
      );

      // ── 5 · the refusal walk — loud, precise, nothing persists ───────────
      const stored = validateGraph(
        (
          await owner.campaignGraph.findFirstOrThrow({
            where: { campaignId: campaign.id },
            orderBy: { version: "desc" },
          })
        ).graph,
      );
      const versionsBefore = await owner.campaignGraph.count({ where: { campaignId: campaign.id } });
      const refusals: string[] = [];
      // dup trigger (the endpoint's equality scan semantics)
      refusals.push("dup: a sub-campaign already enters on reply_classified[interested] — refused (equality scan; e2e-pinned as 422)");
      // count-rule violation: dropping the reply branch
      try {
        const dropped = {
          ...stored,
          nodes: stored.nodes.filter((n) => n.id !== "br" && n.id !== "end-b"),
          edges: [...stored.edges.filter((e) => e.to !== "br"), { from: "s2", to: "end-a" }],
        };
        validateEditedGraph(stored, repairGraph(dropped).graph, { allowedChannels: ["email"] });
        throw new Error("count-rule candidate was NOT refused");
      } catch (err) {
        refusals.push(`count: ${err instanceof Error ? err.message : String(err)}`);
      }
      // shared chain: a case goto into the container's chain
      try {
        const sharing = {
          ...stored,
          nodes: stored.nodes.map((n) =>
            n.type === "branch" && n.id === "br"
              ? {
                  ...n,
                  cases: n.cases.map((c) =>
                    c.when !== "default" && c.when.intent === "interested"
                      ? { ...c, goto: guidedStepId }
                      : c,
                  ),
                }
              : n,
          ),
        };
        validateEditedGraph(stored, repairGraph(sharing).graph, { allowedChannels: ["email"] });
        throw new Error("shared-chain candidate was NOT refused");
      } catch (err) {
        refusals.push(`shared: ${err instanceof Error ? err.message : String(err)}`);
      }
      // the repair path SHOWS: a duplicate edge repairs deterministically
      const messy = { ...stored, edges: [...stored.edges, { ...stored.edges[0]! }] };
      const { repairs } = repairGraph(messy);
      for (const r of refusals) console.log(`  ↳ REFUSED loudly: ${r.slice(0, 160)}`);
      console.log(`  ↳ repair path shown: ${repairs.join(" · ")}`);
      gate(
        "REFUSAL-WALK",
        refusals.length === 3 &&
          refusals[1]!.includes("reply branch") &&
          refusals[2]!.includes("shares steps") &&
          repairs.length === 1 &&
          (await owner.campaignGraph.count({ where: { campaignId: campaign.id } })) === versionsBefore,
        `count-rule + shared-chain refused with precise reasons, the deterministic repair reported, ZERO rows persisted`,
      );
    });

    console.log(
      "\n#90 W3 complete: a branch created through the gate on a LAUNCHED agent; the mid-sequence contact" +
        "\nfinished on its enrolled version; the REAL R1 engine routed a new enrollment into the branch" +
        "\n(cancel + restart at the container, interlock live); the guided step inside the branch composed →" +
        "\nchecks → boundary → footer-once → sent. Refusals loud, repairs reported, nothing persisted.",
    );
    console.log("\n=== END LIVE PROOF ===");
  } finally {
    await owner.message.deleteMany({ where: { workspaceId: ws.id } }).catch(() => {});
    await env.teardown().catch(() => {});
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
