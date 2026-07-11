/**
 * CampaignWorkflow integration tests (P1.6) on the Temporal TIME-SKIPPING test
 * server: timers, reply-signal routing, default-timeout path, durability
 * across a worker kill/restart, retryable-vs-refused activity failures.
 * Activities are recorded fakes — the P1.5 boundary itself is covered by
 * activities.test.ts + the channels suite; here the WORKFLOW is under test.
 *
 * The test server binary downloads on first use; where it can't (sandboxed
 * egress) every test skips with a warning — CI and the live proof are the
 * acceptance evidence.
 */
import { fileURLToPath } from "node:url";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { bundleWorkflowCode, Worker, type WorkflowBundle } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CampaignGraph } from "@clientforce/core";
import type { CampaignActivities } from "../src/activities";
import { REPLY_SIGNAL, type CampaignWorkflowInput, type SendOutcome } from "../src/shared";

let env: TestWorkflowEnvironment | undefined;
let bundle: WorkflowBundle | undefined;
let unavailable = "";

beforeAll(async () => {
  // `env` is assigned LAST so a bundling failure can never leave the suite
  // half-ready (workers with no workflows registered hang every test).
  let candidate: TestWorkflowEnvironment | undefined;
  try {
    candidate = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      // require.resolve can't see .ts — resolve the source file explicitly.
      workflowsPath: fileURLToPath(new URL("../src/workflows.ts", import.meta.url)),
    });
    env = candidate;
  } catch (err) {
    unavailable = err instanceof Error ? err.message : String(err);
    console.warn(`[workflow.integration] SKIPPING — test env unavailable: ${unavailable}`);
    await candidate?.teardown().catch(() => {});
  }
}, 300_000);

afterAll(async () => {
  await env?.teardown();
});

interface Recorded {
  sends: Array<{ stepNodeId: string; mode?: string; brief?: unknown }>;
  progress: Array<{ currentNode: string; pipelineStage?: string }>;
  blocked: Array<{ nodeId: string; reason: string }>;
  composeRefused: Array<{ nodeId: string; reason: string }>;
  actions: Array<{ nodeId: string; kind: string; detail: string }>;
  completed: Array<{ nodeId: string }>;
}

function recordedActivities(
  sendImpl?: (p: { stepNodeId: string }) => Promise<SendOutcome>,
): { calls: Recorded; acts: CampaignActivities } {
  const calls: Recorded = { sends: [], progress: [], blocked: [], composeRefused: [], actions: [], completed: [] };
  const acts = {
    async sendEnrollmentStep(p: { stepNodeId: string; mode?: string; brief?: unknown }) {
      calls.sends.push(p);
      if (sendImpl) return sendImpl(p);
      return {
        kind: "sent",
        messageId: `m-${calls.sends.length}`,
        providerMessageId: `<m-${calls.sends.length}@test>`,
      } satisfies SendOutcome;
    },
    async updateEnrollmentProgress(p: { currentNode: string; pipelineStage?: string }) {
      calls.progress.push(p);
    },
    async recordEnrollmentBlocked(p: { nodeId: string; reason: string }) {
      calls.blocked.push(p);
    },
    async recordComposeRefused(p: { nodeId: string; reason: string }) {
      calls.composeRefused.push(p);
    },
    async recordIntendedAction(p: { nodeId: string; kind: string; detail: string }) {
      calls.actions.push(p);
    },
    async completeEnrollment(p: { nodeId: string }) {
      calls.completed.push(p);
    },
  } as unknown as CampaignActivities;
  return { calls, acts };
}

const linearGraph: CampaignGraph = {
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "a", body: "b" } },
    { id: "d1", type: "delay", amount: 1, unit: "days" },
    {
      id: "s2",
      type: "step",
      channel: "email",
      content: { subject: "a", body: "c", threaded: true },
      pipelineOnSend: "contacted",
    },
    { id: "end1", type: "end" },
  ],
  edges: [
    { from: "s1", to: "d1" },
    { from: "d1", to: "s2" },
    { from: "s2", to: "end1" },
  ],
};

const branchGraph: CampaignGraph = {
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "a", body: "b" } },
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
    { from: "s1", to: "br" },
    { from: "br", to: "end-a" },
  ],
};

/** M1b (DEC-068): a v4-planner-shaped graph — six-case reply branch, price
 *  reframe rejoins the branch (loop-back), not_interested closes as lost. */
const playbookGraph: CampaignGraph = {
  entry: "s1",
  nodes: [
    { id: "s1", type: "step", channel: "email", content: { subject: "a", body: "b" } },
    {
      id: "br",
      type: "branch",
      on: "reply",
      cases: [
        { when: { intent: "interested" }, goto: "end-a", pipeline: "booked" },
        { when: { intent: "objection_price" }, goto: "reframe", pipeline: "replied" },
        { when: { intent: "objection_timing" }, goto: "ack", pipeline: "replied" },
        { when: { intent: "wrong_person" }, goto: "referral", pipeline: "replied" },
        { when: { intent: "info_request" }, goto: "answer", pipeline: "replied" },
        { when: { intent: "not_interested" }, goto: "close", pipeline: "lost" },
        { when: "default", goto: "end-b" },
      ],
    },
    { id: "reframe", type: "step", channel: "email", content: { subject: "Re: a", body: "value", threaded: true } },
    { id: "ack", type: "step", channel: "email", content: { subject: "Re: a", body: "later", threaded: true } },
    { id: "dt", type: "delay", amount: 30, unit: "days" },
    { id: "follow", type: "step", channel: "email", content: { subject: "Re: a", body: "back", threaded: true } },
    { id: "referral", type: "step", channel: "email", content: { subject: "Re: a", body: "who", threaded: true } },
    { id: "answer", type: "step", channel: "email", content: { subject: "Re: a", body: "info", threaded: true } },
    { id: "close", type: "step", channel: "email", content: { subject: "Re: a", body: "bye", threaded: true } },
    { id: "end-a", type: "end" },
    { id: "end-b", type: "end" },
  ],
  edges: [
    { from: "s1", to: "br" },
    { from: "reframe", to: "br" }, // loop-back: await the NEXT reply
    { from: "ack", to: "dt" },
    { from: "dt", to: "follow" },
    { from: "follow", to: "br" },
    { from: "referral", to: "end-b" },
    { from: "answer", to: "br" },
    { from: "close", to: "end-b" },
  ],
};

const inputFor = (graph: CampaignGraph, n: number): CampaignWorkflowInput => ({
  workspaceId: "ws-1",
  enrollmentId: `enr-${n}`,
  campaignId: "cmp-1",
  agentId: "agt-1",
  contactId: "cnt-1",
  senderId: "snd-1",
  graph,
});

let seq = 0;
async function makeWorker(
  acts: CampaignActivities,
  taskQueue: string,
  opts: { noSticky?: boolean } = {},
): Promise<Worker> {
  return Worker.create({
    connection: env!.nativeConnection,
    taskQueue,
    workflowBundle: bundle!,
    activities: acts as unknown as object,
    // Kill/restart tests disable the sticky cache: on the frozen-clock
    // time-skipping server the sticky schedule-to-start timeout never expires,
    // so a dead worker's cached workflow task would never reach its successor.
    ...(opts.noSticky ? { maxCachedWorkflows: 0 } : {}),
  });
}

const waitFor = async (cond: () => boolean, ms = 15_000): Promise<void> => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("CampaignWorkflow (time-skipping Temporal)", () => {
  it("walks step → delay(timer) → step → end in order and completes", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-linear-${seq}`,
        args: [inputFor(linearGraph, seq)],
      });
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end1" });
    });
    expect(calls.sends.map((s) => s.stepNodeId)).toEqual(["s1", "s2"]);
    // The delay node advanced currentNode before the timer, s2 moved pipeline.
    expect(calls.progress).toContainEqual(expect.objectContaining({ currentNode: "d1" }));
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "s2", pipelineStage: "contacted" }),
    );
    expect(calls.completed).toEqual([expect.objectContaining({ nodeId: "end1" })]);
  }, 60_000);

  it("routes a reply signal at the branch and moves the pipeline stage", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-signal-${seq}`,
        args: [inputFor(branchGraph, seq)],
      });
      // Signal once step 1 is out (P1.7's classifier will do exactly this).
      await waitFor(() => calls.sends.length === 1);
      await handle.signal(REPLY_SIGNAL, "interested");
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end-a" });
    });
    expect(calls.actions).toContainEqual(
      expect.objectContaining({ nodeId: "br", detail: "intent:interested → end-a" }),
    );
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "br", pipelineStage: "booked" }),
    );
  }, 60_000);

  it("takes the default case when no reply arrives before the timeout", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-timeout-${seq}`,
        args: [inputFor(branchGraph, seq)],
      });
      // No signal: awaiting the result time-skips the 72h default timeout.
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end-b" });
    });
    expect(calls.actions).toContainEqual(
      expect.objectContaining({ nodeId: "br", detail: "default → end-b" }),
    );
  }, 60_000);

  // ── M1b (DEC-068): six-intent branch routing ────────────────────────────────

  it("ACCEPTANCE: objection_price → value-reframe send → rejoin branch → interested → booked", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-objection-${seq}`,
        args: [inputFor(playbookGraph, seq)],
      });
      await waitFor(() => calls.sends.length === 1); // opener out
      await handle.signal(REPLY_SIGNAL, "objection_price");
      await waitFor(() => calls.sends.length === 2); // the REFRAME went out
      await handle.signal(REPLY_SIGNAL, "interested");
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end-a" });
    });
    // The reframe step is the objection_price case's target — sent exactly once.
    expect(calls.sends.map((s) => s.stepNodeId)).toEqual(["s1", "reframe"]);
    // Stage journey: replied (objection recorded) → booked (goal met).
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "br", pipelineStage: "replied" }),
    );
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "br", pipelineStage: "booked" }),
    );
    expect(calls.actions).toContainEqual(
      expect.objectContaining({ nodeId: "br", detail: "intent:objection_price → reframe" }),
    );
    expect(calls.actions).toContainEqual(
      expect.objectContaining({ nodeId: "br", detail: "intent:interested → end-a" }),
    );
  }, 120_000);

  it("L1 (DEC-071): a GERMAN graph executes identically — German copy sent, intent routes the branch, stage moves", async (t) => {
    if (!env) return t.skip();
    // The playbook shape with German copy — what planner v7 persists for a
    // German agent. Routing keys (ids, intents, pipeline values) stay English
    // machine identifiers; only the copy is German.
    const germanGraph: CampaignGraph = {
      entry: "s1",
      nodes: [
        {
          id: "s1",
          type: "step",
          channel: "email",
          content: { subject: "wo Termine verloren gehen", body: "Mir ist aufgefallen, dass {{company}} noch telefonisch bucht. Lohnt sich ein Blick, {{firstName}}?" },
        },
        {
          id: "br",
          type: "branch",
          on: "reply",
          cases: [
            { when: { intent: "interested" }, goto: "end-a", pipeline: "booked" },
            { when: { intent: "objection_price" }, goto: "reframe", pipeline: "replied" },
            { when: { intent: "objection_timing" }, goto: "reframe", pipeline: "replied" },
            { when: { intent: "wrong_person" }, goto: "close", pipeline: "replied" },
            { when: { intent: "info_request" }, goto: "reframe", pipeline: "replied" },
            { when: { intent: "not_interested" }, goto: "close", pipeline: "lost" },
            { when: "default", goto: "end-b" },
          ],
        },
        { id: "reframe", type: "step", channel: "email", content: { subject: "Re: wo Termine verloren gehen", body: "Verständlicher Einwand — Sie sehen die Zahl, bevor Sie etwas ausgeben.", threaded: true } },
        { id: "close", type: "step", channel: "email", content: { subject: "Re: wo Termine verloren gehen", body: "Alles gut — die Tür bleibt offen.", threaded: true } },
        { id: "end-a", type: "end" },
        { id: "end-b", type: "end" },
      ],
      edges: [
        { from: "s1", to: "br" },
        { from: "reframe", to: "br" },
        { from: "close", to: "end-b" },
      ],
    };
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-german-${seq}`,
        args: [inputFor(germanGraph, seq)],
      });
      await waitFor(() => calls.sends.length === 1); // German opener out
      // The intent arrives from classification of the GERMAN reply — the
      // channels suite pins that mapping; the workflow routes the value.
      await handle.signal(REPLY_SIGNAL, "objection_price");
      await waitFor(() => calls.sends.length === 2); // German reframe out
      await handle.signal(REPLY_SIGNAL, "interested");
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end-a" });
    });
    // The sends carried the German copy end-to-end (persisted as rendered at
    // the boundary — A6; the boundary appends the German footer, own suite).
    const sent = calls.sends as Array<{ stepNodeId: string; content?: { subject?: string } }>;
    expect(sent.map((s) => s.stepNodeId)).toEqual(["s1", "reframe"]);
    expect(sent[0]!.content?.subject).toBe("wo Termine verloren gehen");
    expect(sent[1]!.content?.subject).toBe("Re: wo Termine verloren gehen");
    // Stage journey identical to the English acceptance: replied → booked.
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "br", pipelineStage: "replied" }),
    );
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "br", pipelineStage: "booked" }),
    );
  }, 120_000);

  it("not_interested → graceful close send → enrollment completes with stage lost (no suppression path exists here)", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-lost-${seq}`,
        args: [inputFor(playbookGraph, seq)],
      });
      await waitFor(() => calls.sends.length === 1);
      await handle.signal(REPLY_SIGNAL, "not_interested");
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end-b" });
    });
    // Graceful close SENT (a real goodbye, not a silent stop), then done.
    expect(calls.sends.map((s) => s.stepNodeId)).toEqual(["s1", "close"]);
    expect(calls.progress).toContainEqual(
      expect.objectContaining({ currentNode: "br", pipelineStage: "lost" }),
    );
    // The enrollment COMPLETED — never blocked/unsubscribed (not_interested ≠ unsubscribe).
    expect(calls.completed).toEqual([expect.objectContaining({ nodeId: "end-b" })]);
    expect(calls.blocked).toHaveLength(0);
  }, 120_000);

  it("BACK-COMPAT: a legacy 1-branch graph routes a NEW intent to its default case and completes", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();
    const worker = await makeWorker(acts, tq);
    await worker.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq,
        workflowId: `t-legacy-${seq}`,
        args: [inputFor(branchGraph, seq)], // the pre-M1b shape: interested + default
      });
      await waitFor(() => calls.sends.length === 1);
      await handle.signal(REPLY_SIGNAL, "objection_price");
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end-b" });
    });
    expect(calls.actions).toContainEqual(
      expect.objectContaining({ nodeId: "br", detail: "default → end-b" }),
    );
  }, 120_000);

  it("resumes after the worker is killed mid-run (durability)", async (t) => {
    if (!env) return t.skip();
    const tq = `tq-${++seq}`;
    const { calls, acts } = recordedActivities();

    const worker1 = await makeWorker(acts, tq, { noSticky: true });
    const run1 = worker1.run();
    const handle = await env!.client.workflow.start("campaignWorkflow", {
      taskQueue: tq,
      workflowId: `t-durable-${seq}`,
      args: [inputFor(linearGraph, seq)],
    });
    await waitFor(() => calls.sends.length === 1);
    // Kill the worker while the workflow sits on the delay timer.
    worker1.shutdown();
    await run1;

    const worker2 = await makeWorker(acts, tq, { noSticky: true });
    await worker2.runUntil(async () => {
      const result = await handle.result();
      expect(result).toMatchObject({ status: "completed", endNode: "end1" });
    });
    // Exactly one send per step across BOTH workers — no replay double-send.
    expect(calls.sends.map((s) => s.stepNodeId)).toEqual(["s1", "s2"]);
  }, 240_000); // 120s flaked twice on slow CI runners (time-skipping env + worker restart)

  it("retries infra failures with backoff, but a SendBlockedError refusal is terminal", async (t) => {
    if (!env) return t.skip();

    // (a) flaky transport: fails twice, then succeeds → workflow completes.
    let attempts = 0;
    const flaky = recordedActivities(async () => {
      attempts++;
      if (attempts < 3) throw new Error("transient provider outage");
      return { kind: "sent", messageId: "m-ok", providerMessageId: null };
    });
    const tq1 = `tq-${++seq}`;
    const worker1 = await makeWorker(flaky.acts, tq1);
    await worker1.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq1,
        workflowId: `t-retry-${seq}`,
        args: [
          inputFor(
            {
              entry: "s1",
              nodes: [
                { id: "s1", type: "step", channel: "email", content: {} },
                { id: "e", type: "end" },
              ],
              edges: [{ from: "s1", to: "e" }],
            },
            seq,
          ),
        ],
      });
      await expect(handle.result()).resolves.toMatchObject({ status: "completed" });
    });
    expect(attempts).toBe(3);

    // (b) refusal: non-retryable — ONE attempt, path ends blocked + recorded.
    const refused = recordedActivities(async () => {
      throw ApplicationFailure.create({
        type: "SendBlockedError",
        nonRetryable: true,
        message: "Send blocked (SUPPRESSED)",
        details: [{ reason: "SUPPRESSED", detail: "Send blocked (SUPPRESSED)" }],
      });
    });
    const tq2 = `tq-${++seq}`;
    const worker2 = await makeWorker(refused.acts, tq2);
    await worker2.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq2,
        workflowId: `t-blocked-${seq}`,
        args: [inputFor(branchGraph, seq)],
      });
      await expect(handle.result()).resolves.toMatchObject({
        status: "blocked",
        node: "s1",
        reason: "SUPPRESSED",
      });
    });
    expect(refused.calls.sends).toHaveLength(1); // never retried into a send
    expect(refused.calls.blocked).toEqual([
      expect.objectContaining({ nodeId: "s1", reason: "SUPPRESSED" }),
    ]);
    expect(refused.calls.completed).toHaveLength(0);
  }, 240_000); // 120s flaked twice on slow CI runners (time-skipping env + worker restart)

  it("G1: a guided step's brief reaches the activity; a ComposeRefusedError routes to recordComposeRefused and pauses THAT run", async (t) => {
    if (!env) return t.skip();

    const guidedGraph: CampaignGraph = {
      entry: "g1",
      nodes: [
        {
          id: "g1",
          type: "step",
          channel: "sms",
          mode: "guided",
          content: {},
          brief: { objective: "earn a reply", talkingPoints: ["a", "b", "c"] },
        },
        { id: "end1", type: "end" },
      ],
      edges: [{ from: "g1", to: "end1" }],
    };

    // (a) happy path: mode + brief + graphVersion ride the send activity.
    const ok = recordedActivities();
    const tq1 = `tq-${++seq}`;
    const worker1 = await makeWorker(ok.acts, tq1);
    await worker1.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq1,
        workflowId: `t-guided-${seq}`,
        args: [{ ...inputFor(guidedGraph, seq), graphVersion: 7 }],
      });
      await expect(handle.result()).resolves.toMatchObject({ status: "completed" });
    });
    expect(ok.calls.sends[0]).toMatchObject({
      stepNodeId: "g1",
      mode: "guided",
      brief: expect.objectContaining({ objective: "earn a reply" }),
      graphVersion: 7,
    });

    // (b) refusal: non-retryable — ONE attempt, recordComposeRefused (NOT the
    // send-blocked path), run ends blocked with the typed reason.
    const refusing = recordedActivities(async () => {
      throw ApplicationFailure.create({
        type: "ComposeRefusedError",
        nonRetryable: true,
        message: "Compose refused (NEVER_SAY_VIOLATION)",
        details: [{ reason: "NEVER_SAY_VIOLATION", detail: 'contains "rock-bottom prices"' }],
      });
    });
    const tq2 = `tq-${++seq}`;
    const worker2 = await makeWorker(refusing.acts, tq2);
    await worker2.runUntil(async () => {
      const handle = await env!.client.workflow.start("campaignWorkflow", {
        taskQueue: tq2,
        workflowId: `t-guided-refused-${seq}`,
        args: [inputFor(guidedGraph, seq)],
      });
      await expect(handle.result()).resolves.toMatchObject({
        status: "blocked",
        node: "g1",
        reason: "NEVER_SAY_VIOLATION",
      });
    });
    expect(refusing.calls.sends).toHaveLength(1); // the composer's own retry is INSIDE the activity
    expect(refusing.calls.composeRefused).toEqual([
      expect.objectContaining({ nodeId: "g1", reason: "NEVER_SAY_VIOLATION" }),
    ]);
    expect(refusing.calls.blocked).toHaveLength(0);
    expect(refusing.calls.completed).toHaveLength(0);
  }, 240_000);
});
