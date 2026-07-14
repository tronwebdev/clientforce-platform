/**
 * W3-4 (DEC-076) deferred proof — issue #89: the Temporal live receipt for
 * graph versioning, through a REAL durable run (the staging edit→versioning
 * walk). The persistence layer is already proven (sequence-editor.e2e.spec.ts
 * 8/8 vs real Postgres+RLS); what this run adds is the DURABLE side on the
 * merged #88 editor:
 *
 *   1. MID-SEQUENCE PIN — contact A enrolls on graph v1 and advances to the
 *      delay timer; the edit lands v2 while A waits; A's next send is still
 *      the v1 SCRIPTED copy (no provenance meta, v1 body verbatim, sent AFTER
 *      v2 persisted) and A finishes DONE on v1's end node. The workflow never
 *      re-fetches: the Temporal history's WorkflowExecutionStarted input
 *      carries the pinned v1 graph (graphVersion 1, no v2 nodes).
 *   2. EDIT GATE — the edit is produced by the REAL core mutations
 *      (setStepMode → guided + addStep) and lands as the next MANUAL version
 *      through the PUT /planner/graph chain verbatim: repairGraph →
 *      validateEditedGraph(previous, …) → new CampaignGraph row + graphId
 *      pointer move, all through the RLS-subject client. A regressing
 *      candidate (reply branch dropped) refuses loudly and persists nothing.
 *   3. NEW ENROLLMENT ON v2 — contact B enrolls after the edit (same
 *      latest-version load as the enrollments controller), walks the edited
 *      graph through a REAL durable run: the flipped-to-guided step COMPOSES
 *      per lead (real Sonnet-class composer) → deterministic checks → the
 *      unchanged sendStep boundary → CAN-SPAM footer appended EXACTLY once —
 *      provenance meta {mode:"guided", briefVersion:2, composerVersion}
 *      persisted on the Message row (the Logs/Message receipts) — then the
 *      ADDED step sends scripted, and B finishes DONE with graphVersion 2.
 *
 * §G discipline: SendGrid transport in SANDBOX (nothing delivered),
 * proof-local rows only, root-domain DNS untouched. Runs only in the
 * sequence-editor-live-proof GitHub workflow; never CI.
 */
import { fileURLToPath } from "node:url";
import { defaultPayloadConverter, type Payload } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { AiGateway, AnthropicProvider } from "@clientforce/ai";
import {
  createEmailStepComposer,
  EMAIL_COMPOSE_MAX_WORDS,
  EMAIL_SUBJECT_MAX_CHARS,
  SendGridSender,
} from "@clientforce/channels";
import {
  addStep,
  repairGraph,
  setStepMode,
  validateGraph,
  type CampaignGraph,
  type StepBrief,
} from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { validateEditedGraph } from "@clientforce/planner";
import { createActivities } from "../src/activities";
import { REPLY_SIGNAL, TASK_QUEUE, workflowIdFor, type CampaignWorkflowInput } from "../src/shared";

const FACT = "free growth audit";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";
const V1_STEP2_BODY = "Bump, {{firstName}} — v1 scripted step-2, before the edit.\n\n— {{senderName}}";
// 1 graph-day ≈ 6 real seconds (the live-proof.ts scale).
const DELAY_SCALE = 6 / 86_400;
const DAY_MS_LABEL = "1 day ≈ 6s";

const BRIEF: StepBrief = {
  objective: "Earn a quick yes/no reply about the audit",
  talkingPoints: [
    `the ${FACT} shows where bookings leak`,
    "results land within 7 days",
    "no commitment to take a look",
  ],
  mustSay: [FACT],
  subjectHint: "where bookings leak",
};

const t0 = Date.now();
function stamp(msg: string): void {
  console.log(`[t+${String(Date.now() - t0).padStart(6, " ")}ms] ${msg}`);
}
function gate(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "✓" : "✗"} GATE ${name}: ${detail}`);
  if (!ok) throw new Error(`GATE FAILED: ${name} — ${detail}`);
}

/** The v1 graph a launched agent would be running (live-proof.ts shape). */
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
          body: "Hi {{firstName}}, step 1 of the #89 versioning walk.\n\n— {{senderName}}",
        },
      },
      { id: "d1", type: "delay", amount: 1, unit: "days" },
      {
        id: "s2",
        type: "step",
        channel: "email",
        content: { subject: "ignored — threaded steps inherit", body: V1_STEP2_BODY, threaded: true },
        pipelineOnSend: "contacted",
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
const hasProvenance = (meta: Meta): boolean =>
  "mode" in meta || "briefVersion" in meta || "composerVersion" in meta;

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("GATE FAILED: ANTHROPIC_API_KEY missing (Key Vault ANTHROPIC-API-KEY)");
  }
  if (!process.env.SENDGRID_API_KEY) throw new Error("GATE FAILED: SENDGRID_API_KEY missing");
  if (process.env.SENDGRID_SANDBOX === "false" || process.env.CHANNELS_SANDBOX === "false") {
    throw new Error("GATE FAILED: this proof runs the transport in SANDBOX only");
  }

  console.log("\n=== #89 LIVE PROOF · sequence-editor versioning through a REAL durable run ===");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const gateway = new AiGateway({ provider: new AnthropicProvider() });

  console.log("Starting local Temporal dev server…");
  const env = await TestWorkflowEnvironment.createLocal();

  const suffix = `w0-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "w0-proof", slug: suffix, settings: {} },
  });

  try {
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Versioning Walk Agent",
        goal: "book_appointments",
        category: "Dental & Orthodontics",
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
    // The composer's only permitted fact source; company_address doubles as
    // the boundary's CAN-SPAM footer input.
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
        fromName: "Versioning Walk Agent",
        replyTo: "inbound@reply.clientforce.io",
      },
    });

    // v1 persisted the way a launch would leave it: version 1, source AI,
    // Campaign.graphId pointing at it.
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
    const mkEnrollment = (contactId: string, graphVersion: number) =>
      owner.enrollment.create({
        data: {
          workspaceId: ws.id,
          campaignId: campaign.id,
          contactId,
          workflowId: workflowIdFor("pending"),
          pipelineStage: "new",
          // The enrollments controller's audit stamp (DEC-076): the enrolled
          // version rides meta at create.
          meta: { graphVersion },
        },
      });

    const contactA = await mkContact("Ada", "Bright Ortho", "w0-a");
    const contactB = await mkContact("Ben", "Lakeside Dental", "w0-b");
    const allowlist = [contactA.email!, contactB.email!];

    const enrollA = await mkEnrollment(contactA.id, 1);
    await owner.enrollment.update({
      where: { id: enrollA.id },
      data: { workflowId: workflowIdFor(enrollA.id) },
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      // require.resolve can't see .ts — resolve the source file explicitly.
      workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
      activities: createActivities({
        prisma: app,
        transport: new SendGridSender(), // SANDBOX default ON — no delivery
        allowlist,
        composeEmail: createEmailStepComposer({ prisma: app, gateway }),
      }),
    });

    const baseInput = {
      workspaceId: ws.id,
      campaignId: campaign.id,
      agentId: agent.id,
      senderId: sender.id,
      delayScale: DELAY_SCALE,
    };

    const messagesOf = (enrollmentId: string) =>
      owner.message.findMany({ where: { enrollmentId }, orderBy: { sentAt: "asc" } });
    const waitForMessages = async (enrollmentId: string, count: number, deadlineMs: number) => {
      const deadline = Date.now() + deadlineMs;
      for (;;) {
        const rows = await messagesOf(enrollmentId);
        if (rows.length >= count) return rows;
        if (Date.now() > deadline) {
          throw new Error(`Timed out waiting for ${count} messages on enrollment ${enrollmentId}`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    await worker.runUntil(async () => {
      // ── 1 · launch: contact A enrolls on v1 and advances mid-sequence ────
      stamp("contact A workflow start (graph v1 pinned into the input)");
      const inputA: CampaignWorkflowInput = {
        ...baseInput,
        enrollmentId: enrollA.id,
        contactId: contactA.id,
        graph: v1,
        graphVersion: 1,
      };
      const handleA = await env.client.workflow.start("campaignWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId: workflowIdFor(enrollA.id),
        args: [inputA],
      });
      await waitForMessages(enrollA.id, 1, 30_000);
      stamp(`A step-1 sent (sandbox) — A now sits on the 1-day timer (scaled ${DAY_MS_LABEL})`);

      // ── 2 · the edit, mid-run, through the REAL gate ──────────────────────
      // The drawer's Save: real core mutations produce the candidate…
      let candidate = setStepMode(v1, "s2", { mode: "guided", brief: BRIEF });
      const added = addStep(candidate, {
        container: { kind: "main" },
        channel: "email",
        content: {
          subject: "One more thought for {{company}}",
          body: "Hi {{firstName}}, the v2 ADDED step — only new enrollments see this.\n\n— {{senderName}}",
        },
        delayDays: 1,
      });
      candidate = added.graph;
      gate(
        "EDIT-MUTATIONS",
        added.stepId === "step-added-1" &&
          candidate.nodes.some((n) => n.id === "step-added-1") &&
          candidate.nodes.some((n) => n.id === "s2" && n.type === "step" && n.mode === "guided"),
        `setStepMode(s2 → guided) + addStep appended "${added.stepId}" under the stable node-id policy`,
      );

      // …and the PUT /planner/graph chain persists it, verbatim order
      // (repairGraph → validateEditedGraph vs the stored version → next
      // MANUAL version + graphId pointer), through the RLS-subject client.
      const v2row = await withTenant(app, { workspaceId: ws.id }, async (tx) => {
        const latest = await tx.campaignGraph.findFirst({
          where: { campaignId: campaign.id },
          orderBy: { version: "desc" },
        });
        if (!latest) throw new Error("no stored graph");
        const previous = validateGraph(latest.graph);
        const { graph: repaired, repairs } = repairGraph(candidate);
        // No ACTIVE Twilio sender in this fixture — email-only capability.
        const edited = validateEditedGraph(previous, repaired, { allowedChannels: ["email"] });
        if (repairs.length > 0) stamp(`repairGraph reported: ${repairs.join(" · ")}`);
        const row = await tx.campaignGraph.create({
          data: {
            workspaceId: ws.id,
            campaignId: campaign.id,
            version: latest.version + 1,
            source: "MANUAL",
            graph: edited as object,
          },
        });
        await tx.campaign.update({ where: { id: campaign.id }, data: { graphId: row.id } });
        return row;
      });
      gate(
        "EDIT-GATE-MANUAL-V2",
        v2row.version === 2 && v2row.source === "MANUAL",
        `edit landed as version 2, source MANUAL, graphId pointer moved — while A is mid-sequence`,
      );

      // The gate refuses a regression loudly and persists nothing: a
      // STRUCTURALLY VALID candidate that drops the reply branch (s2 rewired
      // straight to the end node), so the refusal comes from the POLICY
      // layer's reply-branch-count rule — the deliberate extension point the
      // #90 unit later extends — not from the structural layer.
      let refusal = "";
      try {
        const dropped: CampaignGraph = {
          ...v1,
          nodes: v1.nodes.filter((n) => n.id !== "br" && n.id !== "end-b"),
          edges: [...v1.edges.filter((e) => e.to !== "br"), { from: "s2", to: "end-a" }],
        };
        validateEditedGraph(v1, repairGraph(dropped).graph, { allowedChannels: ["email"] });
      } catch (err) {
        refusal = err instanceof Error ? err.message : String(err);
      }
      const rowsAfter = await owner.campaignGraph.count({ where: { campaignId: campaign.id } });
      gate(
        "EDIT-GATE-REFUSAL",
        refusal.includes("reply branch") && rowsAfter === 2,
        `branch-dropping candidate refused loudly ("${refusal}") — nothing persisted (still 2 graph rows)`,
      );

      // ── 3 · A finishes on its enrolled version (the DEC-076 sentence) ────
      const aRows = await waitForMessages(enrollA.id, 2, 30_000);
      const aStep2 = aRows[1]!;
      gate(
        "PIN-SEND-AFTER-EDIT",
        aStep2.sentAt.getTime() > v2row.createdAt.getTime(),
        `A's step-2 sent ${aStep2.sentAt.getTime() - v2row.createdAt.getTime()}ms AFTER v2 persisted — the edit truly landed mid-sequence`,
      );
      gate(
        "PIN-V1-SCRIPTED",
        aStep2.stepNodeId === "s2" &&
          aStep2.body.includes("v1 scripted step-2") &&
          !hasProvenance((aStep2.meta ?? {}) as Meta),
        `A's step-2 is the v1 SCRIPTED copy (no provenance meta) — not the v2 guided compose`,
      );
      gate(
        "PIN-V1-RENDERED",
        aStep2.body.includes("Bump, Ada") && (aStep2.subject ?? "").startsWith("Re: "),
        `A's step-2 rendered the v1 template ("${aStep2.subject}") and threaded onto step-1`,
      );

      stamp('reply signal → "interested" for A');
      await handleA.signal(REPLY_SIGNAL, "interested");
      const resultA = (await handleA.result()) as { status: string; endNode?: string };
      gate(
        "PIN-FINISHES-V1",
        resultA.status === "completed" && resultA.endNode === "end-a",
        `A completed at v1's end-a through the REAL durable run: ${JSON.stringify(resultA)}`,
      );
      const rowA = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollA.id } });
      const metaA = (rowA.meta ?? {}) as Meta;
      const aFinal = await messagesOf(enrollA.id);
      gate(
        "PIN-AUDIT",
        rowA.status === "DONE" &&
          rowA.currentNode === "end-a" &&
          metaA.graphVersion === 1 &&
          aFinal.length === 2 &&
          !aFinal.some((m) => m.stepNodeId === "step-added-1"),
        `enrollment A: DONE @ end-a, meta.graphVersion=1, exactly 2 sends, v2's added step never fired for A`,
      );

      // Temporal history receipt: the started-event input carries the pinned
      // v1 graph — the workflow never re-fetched.
      const history = await handleA.fetchHistory();
      const started = history.events?.find((e) => e.workflowExecutionStartedEventAttributes);
      const payload = started?.workflowExecutionStartedEventAttributes?.input?.payloads?.[0];
      if (!payload) throw new Error("GATE FAILED: HISTORY-PIN — no started-event input payload");
      const pinned = defaultPayloadConverter.fromPayload<CampaignWorkflowInput>(payload as Payload);
      gate(
        "HISTORY-PIN",
        pinned.graphVersion === 1 &&
          !pinned.graph.nodes.some((n) => n.id === "step-added-1") &&
          pinned.graph.nodes.some((n) => n.id === "s2" && n.type === "step" && n.mode === undefined),
        `Temporal history WorkflowExecutionStarted input = graphVersion 1, no v2 nodes, s2 still scripted (the pinned graph)`,
      );

      // ── 4 · a NEW enrollment walks the edited graph ───────────────────────
      // The enrollments controller's start path: load the LATEST version,
      // re-validate, stamp the audit meta, pin the graph into the input.
      const latestForB = await owner.campaignGraph.findFirst({
        where: { campaignId: campaign.id },
        orderBy: { version: "desc" },
      });
      if (!latestForB) throw new Error("no graph row for B");
      gate(
        "NEW-ENROLLMENT-LOADS-V2",
        latestForB.version === 2 && latestForB.source === "MANUAL",
        `B's enrollment loads latest = v2 MANUAL (the controller's findFirst-by-version-desc)`,
      );
      const graphB = validateGraph(latestForB.graph);
      const enrollB = await mkEnrollment(contactB.id, latestForB.version);
      await owner.enrollment.update({
        where: { id: enrollB.id },
        data: { workflowId: workflowIdFor(enrollB.id) },
      });
      stamp("contact B workflow start (edited graph v2 pinned into the input)");
      const handleB = await env.client.workflow.start("campaignWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId: workflowIdFor(enrollB.id),
        args: [
          {
            ...baseInput,
            enrollmentId: enrollB.id,
            contactId: contactB.id,
            graph: graphB,
            graphVersion: latestForB.version,
          } satisfies CampaignWorkflowInput,
        ],
      });

      // B: s1 (scripted) → 1d timer → s2 GUIDED composes per lead → 1d timer
      // → step-added-1 (scripted) → branch. Compose rides a real model call;
      // give it a generous deadline.
      const bRows = await waitForMessages(enrollB.id, 3, 120_000);
      const [bStep1, bStep2, bAdded] = bRows;
      console.log(`\n— B's guided step-2 (composed at send):\nSubject: ${bStep2!.subject}\n${bStep2!.body}\n`);

      gate(
        "V2-WALK-ORDER",
        bStep1!.stepNodeId === "s1" && bStep2!.stepNodeId === "s2" && bAdded!.stepNodeId === "step-added-1",
        `B walked the EDITED graph: s1 → s2 (guided) → step-added-1`,
      );
      gate(
        "V2-SCRIPTED-UNTOUCHED",
        !hasProvenance((bStep1!.meta ?? {}) as Meta) && bStep1!.body.includes("Ben"),
        `B's step-1 stayed scripted byte-style (no provenance keys, tokens rendered)`,
      );

      const metaB2 = (bStep2!.meta ?? {}) as Meta;
      const composedPart = bStep2!.body.split("\n\n--\n")[0]!;
      gate(
        "V2-GUIDED-COMPOSED",
        metaB2.mode === "guided" &&
          metaB2.briefVersion === 2 &&
          metaB2.composerVersion === "composer.email@v1",
        `the flipped step COMPOSED with provenance meta {mode:"guided", briefVersion:2, composerVersion:"${String(metaB2.composerVersion)}"}`,
      );
      gate(
        "V2-GUIDED-CHECKS",
        (bStep2!.subject ?? "").length <= EMAIL_SUBJECT_MAX_CHARS &&
          !(bStep2!.subject ?? "").includes("!") &&
          composedPart.trim().split(/\s+/).length <= EMAIL_COMPOSE_MAX_WORDS &&
          !/\{\{/.test(`${bStep2!.subject}\n${bStep2!.body}`) &&
          `${bStep2!.subject}\n${bStep2!.body}`.toLowerCase().includes(FACT),
        `deterministic checks held: subject ≤${EMAIL_SUBJECT_MAX_CHARS} clean · composed ≤${EMAIL_COMPOSE_MAX_WORDS} words · zero {{tokens}} · mustSay fact grounded`,
      );
      gate(
        "V2-FOOTER-ONCE",
        (bStep2!.body.match(/Unsubscribe:/g) ?? []).length === 1 &&
          (bStep2!.body.match(/unsubscribe/gi) ?? []).length === 1 &&
          bStep2!.body.includes(ADDRESS) &&
          !composedPart.toLowerCase().includes("unsubscribe"),
        `the boundary appended the CAN-SPAM footer EXACTLY once (address verbatim; the composer never wrote it)`,
      );
      gate(
        "V2-GUIDED-THREADED",
        bStep2!.inReplyToId === bStep1!.id,
        `B's guided step threaded onto B's REAL step-1 send (inReplyToId receipt)`,
      );
      gate(
        "V2-ADDED-STEP",
        bAdded!.body.includes("the v2 ADDED step") &&
          !hasProvenance((bAdded!.meta ?? {}) as Meta) &&
          (bAdded!.body.match(/Unsubscribe:/g) ?? []).length === 1,
        `the ADDED step sent scripted with the usual single footer — new enrollments walk the new shape`,
      );

      stamp('reply signal → "interested" for B');
      await handleB.signal(REPLY_SIGNAL, "interested");
      const resultB = (await handleB.result()) as { status: string; endNode?: string };
      const rowB = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollB.id } });
      const metaBEnroll = (rowB.meta ?? {}) as Meta;
      gate(
        "V2-FINISHES",
        resultB.status === "completed" &&
          resultB.endNode === "end-a" &&
          rowB.status === "DONE" &&
          metaBEnroll.graphVersion === 2,
        `enrollment B: DONE @ end-a on the edited graph, meta.graphVersion=2`,
      );

      // Cross-check: B's walk changed nothing for A.
      const aStill = await messagesOf(enrollA.id);
      gate(
        "PIN-CROSS-CHECK",
        aStill.length === 2,
        `contact A still has exactly its 2 v1 sends — the edit + B's walk never touched the mid-sequence contact`,
      );
    });

    console.log(
      "\n#89 runbook complete: mid-sequence contact finished on its ENROLLED version through a REAL durable run;" +
        "\nthe edit landed as MANUAL v2 through the three-layer gate; a NEW enrollment walked the edited graph with" +
        "\nthe flipped-to-guided step composing → checks → boundary → footer-once. DEC-076's deferred proof is live.",
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
