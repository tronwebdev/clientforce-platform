import { resolveTxt } from "node:dns/promises";
import { join } from "node:path";
import { NativeConnection, Worker } from "@temporalio/worker";
import {
  AiGateway,
  AiProviderError,
  AnthropicProvider,
  OpenAiEmbeddingsProvider,
} from "@clientforce/ai";
import { createClassifyWorker, createEmailStepComposer, createSmsStepComposer, SendGridSender , TwilioSmsSender, ensureWarmupCompletion, recomputeSenderHealth, runSenderDnsCheck } from "@clientforce/channels";
import { isConfigured } from "@clientforce/config";
import { goalKeySchema, type GoalKey } from "@clientforce/core";
import { createDistillQueue, createDistillWorker } from "@clientforce/context";
import {
  createAppPrismaClient,
  createBackofficePrismaClient,
  createPrismaClient,
  withTenant,
  type Prisma,
  type PrismaClient,
} from "@clientforce/db";
import {
  createRecorder,
  createTelemetryConsumer,
  resolveSink,
  type TelemetryStore,
} from "@clientforce/telemetry";
import {
  createPerAgentRules,
  runSequenceQuietSweep,
  type QuietSweepDeps,
} from "@clientforce/automations";
import {
  bullConnectionFromUrl,
  createRedisClient,
  createTemporalSignalConsumer,
  dispatcherConsumer,
  EventBus,
  WORKER_HEARTBEAT_KEY,
} from "@clientforce/events";
import {
  createIngestQueue,
  createIngestWorker,
  createUploadStoreFromEnv,
} from "@clientforce/knowledge";
import { createPlanWorker } from "@clientforce/planner";
import {
  cancelEnrollmentWorkflow,
  cancelWorkflowById,
  connectTemporalClient,
  createActivities,
  moveEnrollmentToNode,
  signalEnrollmentReply,
  TASK_QUEUE,
  WORKFLOWS_PATH,
} from "@clientforce/workflows";

/**
 * Worker entrypoint: BullMQ knowledge-ingest / context-distill / planner /
 * inbound-classify workers + the T2 event-bus consumer (live when REDIS_URL
 * is set) + the Temporal CampaignWorkflow worker (P1.6 — connects when
 * TEMPORAL_ADDRESS is set; TEMPORAL_API_KEY ⇒ Temporal Cloud TLS).
 */

/** Lazy shared Temporal client — null when TEMPORAL_ADDRESS is unset. */
let temporalClientPromise: ReturnType<typeof connectTemporalClient> | undefined;
const temporalClient = () => (temporalClientPromise ??= connectTemporalClient());

/**
 * Ingestion needs embeddings only; P1.6 activities wire their own completions.
 */
function embeddingsOnlyGateway(): AiGateway {
  const notWired = async (): Promise<never> => {
    throw new AiProviderError(
      "Completions are not wired in the worker process until P1.6",
      undefined,
      false,
    );
  };
  return new AiGateway({
    provider: { completeText: notWired, completeTool: notWired },
    embeddings: new OpenAiEmbeddingsProvider(),
  });
}

/** Local uploads root — must match the API's resolution (see GET /system/health). */
const uploadsRoot = (): string =>
  process.env.STORAGE_CONNECTION_STRING
    ? "azure"
    : (process.env.UPLOADS_DIR ?? join(process.cwd(), ".uploads"));

/**
 * Liveness heartbeat: a 45s-TTL Redis key refreshed every 15s so the API's
 * GET /system/health can tell "worker alive" from "jobs will wait forever".
 * Written even when ANTHROPIC_API_KEY is absent — the payload says which
 * workers are actually on.
 */
function startHeartbeat(redisUrl: string): void {
  const redis = createRedisClient(redisUrl);
  const beat = (): void => {
    const payload = JSON.stringify({
      at: new Date().toISOString(),
      ingest: true,
      distill: !!process.env.ANTHROPIC_API_KEY,
      planner: !!process.env.ANTHROPIC_API_KEY,
      storage: process.env.STORAGE_CONNECTION_STRING ? "azure" : "file",
      uploadsRoot: uploadsRoot(),
    });
    redis.setex(WORKER_HEARTBEAT_KEY, 45, payload).catch((err: unknown) => {
      console.error("[worker] heartbeat write failed", err);
    });
  };
  beat();
  setInterval(beat, 15_000);
}

function startKnowledgeWorkers(): void {
  if (!process.env.REDIS_URL) {
    console.log("[worker] REDIS_URL not set — knowledge-ingest/context-distill workers disabled");
    return;
  }
  console.log(`[worker] uploads root: ${uploadsRoot()}`);
  startHeartbeat(process.env.REDIS_URL);
  startStrandedSourceSweep();
  const prisma = createAppPrismaClient();
  const distillQueue = createDistillQueue();

  const ingest = createIngestWorker({
    prisma,
    gateway: embeddingsOnlyGateway(),
    store: createUploadStoreFromEnv(),
  });
  ingest.on("completed", (job) => {
    console.log(`[worker] knowledge-ingest completed source=${job.data.sourceId}`);
    // Knowledge changed → re-distill the source's layer (DEC-024 trigger);
    // agent gaps covered by new WORKSPACE docs resolve through the layer merge
    // without touching the agent rows.
    void enqueueRedistill(prisma, distillQueue, job.data).catch((err: unknown) => {
      console.error(`[worker] re-distill enqueue failed for ${job.data.sourceId}`, err);
    });
  });
  ingest.on("failed", (job, err) => {
    console.error(`[worker] knowledge-ingest failed source=${job?.data.sourceId}: ${err.message}`);
  });
  console.log("[worker] knowledge-ingest worker started (P1.2)");

  // P1.7: the T2 event-bus consumer — consumer #1 is REAL: a *.replied.v1
  // event signals the enrollment's CampaignWorkflow (skips with a log when
  // Temporal isn't configured; the Event row is persisted regardless).
  // R1 (DEC-074): consumer #2 is now REAL too — the per-agent campaign-rules
  // evaluator, with its gate on consumer #1 (rails → rules → graph
  // continuation; a terminal rule action skips the reply signal). Cross-
  // tenant reads (stored-workflowId lookup, sweep discovery) use the owner
  // client — the stranded-source-sweep precedent; all writes stay tenant-scoped.
  const owner = createPrismaClient();
  // Late-bound: the rules deps need the bus, the bus's consumer list needs
  // the rules — the holder breaks the construction cycle.
  const busRef: { current?: EventBus } = {};
  const ruleDeps = {
    prisma,
    publish: async (input: Parameters<EventBus["publish"]>[0]) => {
      if (busRef.current) await busRef.current.publish(input);
    },
    cancelWorkflow: async ({ workflowId }: { workflowId: string }) => {
      const client = await temporalClient();
      if (!client) throw new Error("TEMPORAL_ADDRESS not configured — cancel skipped");
      await cancelWorkflowById(client, workflowId);
    },
    moveEnrollment: async (params: {
      workspaceId: string;
      enrollmentId: string;
      targetNodeId: string;
      dedupeKey: string;
    }) => {
      const client = await temporalClient();
      if (!client) throw new Error("TEMPORAL_ADDRESS not configured — move unavailable");
      await moveEnrollmentToNode(client, prisma, params);
    },
  };
  const rules = createPerAgentRules(ruleDeps);

  // B1 W3 (DEC-081): the 4th consumer — product telemetry. Domain sends/replies
  // become PII-free telemetry, dual-written to the backoffice-only TelemetryEvent
  // store (via the RLS-exempt role) and forwarded to the configured sink
  // (NoopSink unless POSTHOG_* is set). Never breaks the bus.
  const telemetryDb = createBackofficePrismaClient();
  const telemetryStore: TelemetryStore = {
    async save(r) {
      await telemetryDb.telemetryEvent.create({
        data: {
          name: r.name,
          actorType: r.actorType,
          actorId: r.actorId ?? null,
          workspaceId: r.workspaceId ?? null,
          agencyId: r.agencyId ?? null,
          entityId: r.entityId ?? null,
          props: r.props as Prisma.InputJsonValue,
          occurredAt: new Date(r.occurredAt),
        },
      });
    },
  };
  const recordTelemetry = createRecorder(resolveSink(), telemetryStore);

  const bus = new EventBus({
    prisma,
    connection: bullConnectionFromUrl(process.env.REDIS_URL),
    consumers: [
      createTemporalSignalConsumer(
        async (enrollmentId, intent) => {
          const client = await temporalClient();
          if (!client) throw new Error("TEMPORAL_ADDRESS not configured — signal skipped");
          // R1: a moved enrollment runs under a new workflow id — signal the
          // STORED one (falls back to the enroll-time id when absent).
          const row = await owner.enrollment.findUnique({
            where: { id: enrollmentId },
            select: { workflowId: true },
          });
          await signalEnrollmentReply(client, enrollmentId, intent, row?.workflowId ?? undefined);
          console.log(`[worker] reply signal delivered: enrollment=${enrollmentId} intent=${intent}`);
        },
        console.warn,
        rules.shouldContinueGraph,
      ),
      rules.consumer,
      dispatcherConsumer,
      createTelemetryConsumer({ record: recordTelemetry }),
    ],
  });
  busRef.current = bus;
  bus.startConsumer();
  console.log("[worker] event-bus consumer started (P1.7 temporal-signal + R1 campaign rules live)");
  startSequenceQuietSweep({ ...ruleDeps, ownerPrisma: owner });
  // P5 W1 (DEC-083): sender health recompute + warmup completion (10 min) and
  // DNS re-verification (6 h) — the stranded-source-sweep pattern: cross-tenant
  // discovery on the owner client, tenant-scoped writes, resilient per sender.
  startSenderHealthSweep({ prisma, ownerPrisma: owner, publish: ruleDeps.publish });
  startSenderDnsSweep({ prisma, ownerPrisma: owner });

  // Distilling/classifying need real completions; without the key those
  // workers stay off (ingest + bus are unaffected) and jobs wait in Redis.
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("[worker] ANTHROPIC_API_KEY not set — distill/planner/classify workers disabled");
    return;
  }
  const realGateway = new AiGateway({
    provider: new AnthropicProvider(),
    embeddings: new OpenAiEmbeddingsProvider(),
  });
  const distiller = createDistillWorker({ prisma, gateway: realGateway });
  distiller.on("completed", (job) => {
    console.log(
      `[worker] context-distill completed ws=${job.data.workspaceId} agent=${job.data.agentId ?? "workspace-layer"}`,
    );
  });
  distiller.on("failed", (job, err) => {
    console.error(`[worker] context-distill failed ws=${job?.data.workspaceId}: ${err.message}`);
  });
  console.log("[worker] context-distill worker started (P1.3)");

  const planner = createPlanWorker({ prisma, gateway: realGateway });
  planner.on("completed", (job) => {
    const ms =
      job.finishedOn !== undefined && job.processedOn !== undefined
        ? `${job.finishedOn - job.processedOn}ms`
        : "unknown";
    console.log(
      `[worker] planner completed ws=${job.data.workspaceId} agent=${job.data.agentId} duration=${ms}`,
    );
  });
  planner.on("failed", (job, err) => {
    console.error(`[worker] planner failed agent=${job?.data.agentId}: ${err.message}`);
  });
  console.log("[worker] planner worker started (P1.4)");

  // P1.7: classify inbound replies (Sonnet, engagement-aware), publish
  // email.replied.v1 (bus → temporal-signal), apply unsubscribe side effects.
  const classifier = createClassifyWorker({
    prisma,
    gateway: realGateway,
    bus,
    stopWorkflow: async (enrollmentId) => {
      const client = await temporalClient();
      if (client) await cancelEnrollmentWorkflow(client, enrollmentId);
    },
  });
  classifier.on("completed", (job, result) => {
    console.log(
      `[worker] inbound-classify completed message=${job.data.messageId} intent=${(result as { intent?: string })?.intent}`,
    );
  });
  classifier.on("failed", (job, err) => {
    console.error(`[worker] inbound-classify failed message=${job?.data.messageId}: ${err.message}`);
  });
  console.log("[worker] inbound-classify worker started (P1.7)");
}

/**
 * Stranded-source sweep (hardening, wizard bug round #2): sources whose ingest
 * enqueue was lost — outage, worker death mid-job — sit in PENDING/INGESTING
 * forever, because nothing in the product re-enqueues them (the 2026-07-08
 * outage left 17 such rows; a manual drain workflow recovered them). On boot
 * and every 10 minutes, re-enqueue anything stale for >10 minutes: never a
 * live job (a healthy ingest moves the row in seconds), and re-ingest is
 * idempotent (P1.2). Cross-tenant maintenance read — owner client, same
 * precedent as P1.7 inbound thread resolution.
 */
function startStrandedSourceSweep(): void {
  const owner = createPrismaClient();
  const queue = createIngestQueue();
  const sweep = async (): Promise<void> => {
    const stale = await owner.knowledgeSource.findMany({
      where: {
        status: { in: ["PENDING", "INGESTING"] },
        updatedAt: { lt: new Date(Date.now() - 10 * 60_000) },
      },
      select: { id: true, workspaceId: true },
      take: 100,
    });
    for (const s of stale) {
      await queue.add(
        "ingest",
        { sourceId: s.id, workspaceId: s.workspaceId },
        { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
      );
      console.log(`[worker] stranded-source sweep re-enqueued source=${s.id}`);
    }
    if (stale.length > 0) console.log(`[worker] stranded-source sweep: ${stale.length} re-enqueued`);
  };
  void sweep().catch((err: unknown) => console.error("[worker] stranded-source sweep failed", err));
  setInterval(() => {
    void sweep().catch((err: unknown) =>
      console.error("[worker] stranded-source sweep failed", err),
    );
  }, 10 * 60_000);
}

/**
 * Sequence-quiet sweep (R1, DEC-074): the "sequence completed + N days quiet"
 * rule trigger — the one trigger with no bus event to subscribe to. Runs on
 * boot + hourly (the stranded-source-sweep pattern); fire-once semantics live
 * in the run key (`quiet:<enrollmentId>` under the ruleId+eventId unique),
 * so the poll cadence only bounds latency and multi-replica double-runs are
 * no-ops.
 */
function startSequenceQuietSweep(deps: QuietSweepDeps): void {
  const sweep = async (): Promise<void> => {
    const { checked, fired } = await runSequenceQuietSweep(deps);
    if (fired > 0) {
      console.log(`[worker] sequence-quiet sweep: ${fired} rule run(s) fired (${checked} checked)`);
    }
  };
  void sweep().catch((err: unknown) => console.error("[worker] sequence-quiet sweep failed", err));
  setInterval(() => {
    void sweep().catch((err: unknown) =>
      console.error("[worker] sequence-quiet sweep failed", err),
    );
  }, 60 * 60_000);
}

/** Cap per sweep pass — logged when hit, never silently truncated. */
const SENDER_SWEEP_TAKE = 500;

interface SenderSweepDeps {
  prisma: PrismaClient;
  ownerPrisma: PrismaClient;
  publish: (input: Parameters<EventBus["publish"]>[0]) => Promise<void>;
}

/**
 * Sender health sweep (P5 W1, DEC-083): on boot + every 10 minutes, recompute
 * every sender's ledger-derived health snapshot (collapse/recovery transitions
 * emit their catalog events exactly once — the guarded persist in
 * `recomputeSenderHealth`) and stamp finished warmup ramps. The SendGrid
 * webhook path additionally recomputes on bounce/spam for immediate collapse;
 * this sweep is the cadence floor (recovery, SMS senders, drain-to-low-data).
 */
function startSenderHealthSweep(deps: SenderSweepDeps): void {
  const sweep = async (): Promise<void> => {
    const senders = await deps.ownerPrisma.senderConnection.findMany({
      select: { id: true, workspaceId: true },
      take: SENDER_SWEEP_TAKE,
      orderBy: { createdAt: "asc" },
    });
    if (senders.length === SENDER_SWEEP_TAKE) {
      console.warn(`[worker] sender-health sweep hit the ${SENDER_SWEEP_TAKE}-sender page cap — split the sweep before this is real`);
    }
    let transitions = 0;
    for (const s of senders) {
      try {
        const result = await recomputeSenderHealth(
          { prisma: deps.prisma, publish: deps.publish },
          { workspaceId: s.workspaceId, senderId: s.id },
        );
        if (result?.transition) {
          transitions++;
          console.log(`[worker] sender-health ${result.transition}: sender=${s.id} score=${result.snapshot.score ?? "n/a"}`);
        }
        const warmup = await ensureWarmupCompletion(
          { prisma: deps.prisma, publish: deps.publish },
          { workspaceId: s.workspaceId, senderId: s.id },
        );
        if (warmup.completed) {
          console.log(`[worker] warmup complete: sender=${s.id}${warmup.emitted ? "" : " (stamped silently — aged out unobserved)"}`);
        }
      } catch (err) {
        console.error(`[worker] sender-health sweep failed for sender=${s.id}`, err);
      }
    }
    if (transitions > 0) console.log(`[worker] sender-health sweep: ${transitions} transition(s)`);
  };
  void sweep().catch((err: unknown) => console.error("[worker] sender-health sweep failed", err));
  setInterval(() => {
    void sweep().catch((err: unknown) => console.error("[worker] sender-health sweep failed", err));
  }, 10 * 60_000);
}

/**
 * Sender DNS sweep (P5 W1, DEC-083): on boot + every 6 hours, re-verify
 * SPF/DKIM/DMARC per email sender with REAL lookups (SendGrid domain auth +
 * `_dmarc` TXT). Every pass REPLACES `domainAuthStatus` — an unreachable
 * provider writes `unchecked` with the reason, never a stale "verified".
 */
function startSenderDnsSweep(deps: { prisma: PrismaClient; ownerPrisma: PrismaClient }): void {
  const sweep = async (): Promise<void> => {
    const senders = await deps.ownerPrisma.senderConnection.findMany({
      where: { type: { not: "TWILIO_SMS" } },
      select: { id: true, workspaceId: true },
      take: SENDER_SWEEP_TAKE,
      orderBy: { createdAt: "asc" },
    });
    for (const s of senders) {
      try {
        await runSenderDnsCheck(
          {
            prisma: deps.prisma,
            resolveTxt,
            ...(process.env.SENDGRID_API_KEY ? { sendgridApiKey: process.env.SENDGRID_API_KEY } : {}),
          },
          { workspaceId: s.workspaceId, senderId: s.id },
        );
      } catch (err) {
        console.error(`[worker] sender-dns sweep failed for sender=${s.id}`, err);
      }
    }
    if (senders.length > 0) console.log(`[worker] sender-dns sweep: ${senders.length} sender(s) re-checked`);
  };
  void sweep().catch((err: unknown) => console.error("[worker] sender-dns sweep failed", err));
  setInterval(() => {
    void sweep().catch((err: unknown) => console.error("[worker] sender-dns sweep failed", err));
  }, 6 * 3_600_000);
}

async function enqueueRedistill(
  prisma: PrismaClient,
  queue: ReturnType<typeof createDistillQueue>,
  job: { sourceId: string; workspaceId: string },
): Promise<void> {
  const source = await withTenant(prisma, { workspaceId: job.workspaceId }, (tx) =>
    tx.knowledgeSource.findUnique({ where: { id: job.sourceId } }),
  );
  if (!source || source.status !== "READY") return;
  let goal: GoalKey | null = null;
  let customObjective: string | undefined;
  if (source.agentId) {
    const agent = await withTenant(prisma, { workspaceId: job.workspaceId }, (tx) =>
      tx.agent.findUnique({ where: { id: source.agentId! } }),
    );
    const parsed = goalKeySchema.safeParse(agent?.goal);
    goal = parsed.success ? parsed.data : null;
    customObjective = agent?.instructions ?? undefined;
  }
  await queue.add(
    "distill",
    { workspaceId: job.workspaceId, agentId: source.agentId ?? null, goal, customObjective },
    { attempts: 3, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true },
  );
}

async function run(): Promise<void> {
  startKnowledgeWorkers();

  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) {
    console.log(
      `[worker] Temporal not connected (config ok=${isConfigured()}). ` +
        `Set TEMPORAL_ADDRESS to run CampaignWorkflows (P1.6); ` +
        `queues above keep running either way.`,
    );
    // Stay alive as a healthy long-running container until the owner
    // provisions a Temporal endpoint — otherwise the process would exit and
    // the Container App would crash-loop.
    await new Promise<never>(() => {});
    return;
  }

  // P1.6: the real CampaignWorkflow worker. TEMPORAL_API_KEY implies Temporal
  // Cloud (TLS); a bare address is a dev/self-hosted server.
  const apiKey = process.env.TEMPORAL_API_KEY;
  const connection = await NativeConnection.connect({
    address,
    ...(apiKey ? { tls: true, apiKey } : {}),
  });
  // P1.7: pipeline moves at branches publish lead.stage_changed.v1 (bus needs
  // Redis; without it the move still persists, just without the event).
  const activityPrisma = createAppPrismaClient();
  const stageBus = process.env.REDIS_URL
    ? new EventBus({
        prisma: activityPrisma,
        connection: bullConnectionFromUrl(process.env.REDIS_URL),
      })
    : undefined;
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: WORKFLOWS_PATH,
    activities: createActivities({
      prisma: activityPrisma,
      transport: new SendGridSender(),
      // P2.1 (DEC-061): sms steps route through Twilio (SMS_SANDBOX default ON).
      smsTransport: new TwilioSmsSender(),
      // G1 (DEC-070) / G2 (DEC-071): guided steps compose per lead on the
      // copy route — key absent → guided steps refuse typed
      // (COMPOSER_UNCONFIGURED), the same honest-absence pattern as the
      // transports. One gateway serves both channel composers.
      ...(process.env.ANTHROPIC_API_KEY
        ? (() => {
            const composeGateway = new AiGateway({ provider: new AnthropicProvider() });
            return {
              composeSms: createSmsStepComposer({
                prisma: activityPrisma,
                gateway: composeGateway,
              }),
              composeEmail: createEmailStepComposer({
                prisma: activityPrisma,
                gateway: composeGateway,
              }),
            };
          })()
        : {}),
      ...(stageBus
        ? {
            publishStageChanged: async (change) => {
              await stageBus.publish({
                type: "lead.stage_changed.v1",
                workspaceId: change.workspaceId,
                contactId: change.contactId,
                enrollmentId: change.enrollmentId,
                campaignId: change.campaignId,
                payload: {
                  fromStage: change.fromStage,
                  toStage: change.toStage,
                  // C2.9: present on goal-completion moves (DEC-059).
                  ...(change.goalKey ? { goalKey: change.goalKey, label: change.label } : {}),
                },
              });
            },
            // G1/G2: the composer refusal's Logs row (Event) — the pause
            // itself persists in the activity regardless of the bus; the
            // step's channel picks the catalog twin.
            publishComposeRefused: async (refusal) => {
              await stageBus.publish({
                type:
                  refusal.channel === "email"
                    ? "email.compose_refused.v1"
                    : "sms.compose_refused.v1",
                workspaceId: refusal.workspaceId,
                contactId: refusal.contactId,
                enrollmentId: refusal.enrollmentId,
                campaignId: refusal.campaignId,
                payload: {
                  stepNodeId: refusal.stepNodeId,
                  reason: refusal.reason,
                  ...(refusal.detail ? { detail: refusal.detail } : {}),
                },
              });
            },
          }
        : {}),
    }),
  });
  console.log(`[worker] Temporal worker started (P1.6) — task queue "${TASK_QUEUE}"`);
  await worker.run();
}

void run().catch((err: unknown) => {
  console.error("[worker] failed to start", err);
  process.exitCode = 1;
});
