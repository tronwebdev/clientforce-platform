/**
 * P1.6 live verification (§G): a REAL CampaignWorkflow on a local Temporal dev
 * server driving REAL SendGrid sandbox sends through the full P1.5 boundary.
 * Timeline gates (exit 1 on any miss — a green proof must prove something):
 *   1. step-1 sends (provider id, verbatim company_address footer);
 *   2. step-2 sends ONLY after the delay timer actually elapses (real time,
 *      TEST_DELAY_SCALE-shortened) and threads to step-1 (In-Reply-To, "Re:");
 *   3. a `reply` signal routes the branch (interested → booked) and the
 *      enrollment finishes DONE with the pipeline stage moved;
 *   4. a suppressed recipient's run ends BLOCKED with the refusal recorded on
 *      Enrollment.meta (the Logs-tab amber row), never retried into a send.
 * §G: allow-listed inbox only, sandbox mode, root-domain DNS untouched.
 */
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import {
  SendGridSender,
  type EmailSender,
  type RenderedEmail,
  type SenderConnection,
} from "@clientforce/channels";
import type { CampaignGraph } from "@clientforce/core";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { createActivities } from "../src/activities";
import { REPLY_SIGNAL, TASK_QUEUE, workflowIdFor, type CampaignWorkflowInput } from "../src/shared";

const TEST_INBOX = process.env.LIVE_PROOF_INBOX ?? "tronwebng@gmail.com";
const ADDRESS = process.env.LIVE_PROOF_ADDRESS ?? "Clientforce, Lagos, Nigeria";
// 1 graph-day ≈ 6 real seconds; the 72h branch default timeout ≈ 18s (we
// signal well before it).
const DELAY_SCALE = 6 / 86_400;
const DAY_MS = 6_000;

class TimingTransport implements EmailSender {
  readonly sent: Array<{ email: RenderedEmail; at: number; providerMessageId: string }> = [];
  constructor(private readonly inner: EmailSender) {}
  async send(email: RenderedEmail, sender: SenderConnection) {
    const result = await this.inner.send(email, sender);
    this.sent.push({ email, at: Date.now(), providerMessageId: result.providerMessageId });
    return result;
  }
}

const t0 = Date.now();
const stamp = (msg: string): void => {
  console.log(`[t+${String(Date.now() - t0).padStart(6, " ")}ms] ${msg}`);
};

async function main(): Promise<void> {
  if (!process.env.SENDGRID_API_KEY) throw new Error("SENDGRID_API_KEY missing");
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const transport = new TimingTransport(new SendGridSender(undefined, /* sandbox */ true));

  console.log("Starting local Temporal dev server…");
  const env = await TestWorkflowEnvironment.createLocal();

  const suffix = `wf-proof-${Date.now()}`;
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "proof", slug: suffix, settings: {} },
  });

  try {
    console.log("\n=== P1.6 LIVE PROOF · CampaignWorkflow timeline ===");
    const agent = await owner.agent.create({
      data: {
        workspaceId: ws.id,
        name: "Demo Booker",
        goal: "book_appointments",
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
        fromEmail: "agent@send.clientforce.io",
        fromName: "Clientforce Demo Agent",
        replyTo: "inbound@reply.clientforce.io",
      },
    });
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws.id,
        source: "live-proof",
        optOut: {},
        tags: [],
        email: TEST_INBOX,
        firstName: "Godswill",
        company: "Tronweb",
      },
    });
    await owner.businessContext.create({
      data: {
        workspaceId: ws.id,
        agentId: null,
        status: "READY",
        fields: { company_address: { value: ADDRESS, citations: [], source: "typed" } },
      },
    });

    const graph: CampaignGraph = {
      entry: "s1",
      nodes: [
        {
          id: "s1",
          type: "step",
          channel: "email",
          content: {
            subject: "A quick idea for {{company}}",
            body: "Hi {{firstName}}, step 1 of the P1.6 durable-run live proof.\n\n— {{senderName}}",
          },
        },
        { id: "d1", type: "delay", amount: 1, unit: "days" },
        {
          id: "s2",
          type: "step",
          channel: "email",
          content: {
            subject: "ignored — threaded steps inherit",
            body: "Bump, {{firstName}} — step 2, after the timer.\n\n— {{senderName}}",
            threaded: true,
          },
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

    const enrollment = await owner.enrollment.create({
      data: {
        workspaceId: ws.id,
        campaignId: campaign.id,
        contactId: contact.id,
        workflowId: workflowIdFor("pending"),
        pipelineStage: "new",
        meta: {},
      },
    });
    await owner.enrollment.update({
      where: { id: enrollment.id },
      data: { workflowId: workflowIdFor(enrollment.id) },
    });

    const worker = await Worker.create({
      connection: env.nativeConnection,
      taskQueue: TASK_QUEUE,
      // require.resolve can't see .ts — resolve the source file explicitly.
      workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
      activities: createActivities({ prisma: app, transport, allowlist: [TEST_INBOX] }),
    });

    const input: CampaignWorkflowInput = {
      workspaceId: ws.id,
      enrollmentId: enrollment.id,
      campaignId: campaign.id,
      agentId: agent.id,
      contactId: contact.id,
      senderId: sender.id,
      graph,
      delayScale: DELAY_SCALE,
    };

    await worker.runUntil(async () => {
      stamp("workflow start");
      const handle = await env.client.workflow.start("campaignWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId: workflowIdFor(enrollment.id),
        args: [input],
      });

      // Wait for both sends (step-2 comes only after the real timer).
      const deadline = Date.now() + 60_000;
      while (transport.sent.length < 2) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for the two sends");
        await new Promise((r) => setTimeout(r, 200));
      }
      const [first, second] = transport.sent;
      stamp(`step-1 SENT (sandbox): ${first.providerMessageId}`);
      stamp(`timer fired; step-2 SENT (sandbox): ${second.providerMessageId}`);

      stamp('reply signal → "interested" (P1.7\'s classifier will do this for real)');
      await handle.signal(REPLY_SIGNAL, "interested");
      const result = await handle.result();
      stamp(`workflow result: ${JSON.stringify(result)}`);

      // ── §G gates ──────────────────────────────────────────────────────────
      if (!first.providerMessageId) throw new Error("step-1 returned no provider id");
      if (!first.email.body.includes(ADDRESS))
        throw new Error("step-1 footer does not carry company_address verbatim");
      if (!first.email.body.includes("Unsubscribe: "))
        throw new Error("step-1 unsubscribe footer missing");

      const gap = second.at - first.at;
      if (gap < DAY_MS * 0.75)
        throw new Error(`step-2 fired ${gap}ms after step-1 — the timer did not gate it`);
      stamp(`delay gate: step-2 came ${gap}ms after step-1 (scaled 1-day timer) ✓`);

      if (second.email.inReplyTo !== first.providerMessageId)
        throw new Error("step-2 In-Reply-To does not reference step-1 (owner rule 3)");
      if (!second.email.subject.startsWith("Re: ") || !second.email.subject.includes("Tronweb"))
        throw new Error(`step-2 subject did not inherit+prefix: "${second.email.subject}"`);
      stamp(`threading gate: "${second.email.subject}" In-Reply-To ${second.email.inReplyTo} ✓`);

      if (result.status !== "completed" || result.endNode !== "end-a")
        throw new Error(`expected completed@end-a, got ${JSON.stringify(result)}`);
      const row = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
      if (row.status !== "DONE" || row.pipelineStage !== "booked" || row.currentNode !== "end-a")
        throw new Error(
          `enrollment state wrong: status=${row.status} stage=${row.pipelineStage} node=${row.currentNode}`,
        );
      const events = (row.meta as { events?: Array<{ detail: string }> }).events ?? [];
      if (!events.some((e) => e.detail.includes("intent:interested")))
        throw new Error("branch routing not recorded on Enrollment.meta");
      stamp(`branch gate: interested → end-a, pipeline "booked", enrollment DONE ✓`);

      // ── Refusal path: suppressed lead ends BLOCKED, recorded, never sent ──
      const contact2 = await owner.contact.create({
        data: {
          workspaceId: ws.id,
          source: "live-proof",
          optOut: {},
          tags: [],
          email: TEST_INBOX,
          firstName: "Suppressed",
          company: "Tronweb",
        },
      });
      await withTenant(app, { workspaceId: ws.id }, (tx) =>
        tx.suppression.create({
          data: { workspaceId: ws.id, channel: "email", address: TEST_INBOX, reason: "MANUAL" },
        }),
      );
      const enrollment2 = await owner.enrollment.create({
        data: {
          workspaceId: ws.id,
          campaignId: campaign.id,
          contactId: contact2.id,
          workflowId: `${workflowIdFor("blocked-proof")}-${Date.now()}`,
          pipelineStage: "new",
          meta: {},
        },
      });
      const sendsBefore = transport.sent.length;
      const blockedHandle = await env.client.workflow.start("campaignWorkflow", {
        taskQueue: TASK_QUEUE,
        workflowId: enrollment2.workflowId,
        args: [{ ...input, enrollmentId: enrollment2.id, contactId: contact2.id }],
      });
      const blockedResult = await blockedHandle.result();
      if (blockedResult.status !== "blocked" || blockedResult.reason !== "SUPPRESSED")
        throw new Error(`expected blocked/SUPPRESSED, got ${JSON.stringify(blockedResult)}`);
      if (transport.sent.length !== sendsBefore)
        throw new Error("a suppressed contact was retried into a send");
      const row2 = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment2.id } });
      const blocked = (row2.meta as { blocked?: { reason?: string } }).blocked;
      if (row2.status !== "UNSUBSCRIBED" || blocked?.reason !== "SUPPRESSED")
        throw new Error(
          `refusal not recorded: status=${row2.status} meta.blocked=${JSON.stringify(blocked)}`,
        );
      stamp(`refusal gate: SUPPRESSED run BLOCKED, amber-row data on Enrollment.meta ✓`);
    });

    console.log(
      "\n§G gate passed: durable timeline (send → timer → threaded send → signal → route → DONE) + refusal path proven.",
    );
    console.log("\n=== END LIVE PROOF ===");
  } finally {
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
