import { NativeConnection, Worker } from "@temporalio/worker";
import { isConfigured } from "@clientforce/config";

const TASK_QUEUE = "clientforce";

/**
 * Temporal worker entrypoint.
 *
 * T0: build-only stub. The `@temporalio/worker` dependency and the connection
 * code are wired and type-checked, but the worker only attempts to connect when
 * `TEMPORAL_ADDRESS` is set — so `dev` and CI start cleanly without a live
 * Temporal endpoint. The real `CampaignWorkflow` + activities land in T4
 * (ARCHITECTURE.md §3.1).
 */
async function run(): Promise<void> {
  const address = process.env.TEMPORAL_ADDRESS;
  if (!address) {
    console.log(
      `[worker] T0 stub running (config ok=${isConfigured()}). ` +
        `Set TEMPORAL_ADDRESS to connect; workflows land in T4.`,
    );
    return;
  }

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    taskQueue: TASK_QUEUE,
    // workflows + activities are registered in T4.
    activities: {},
  });
  await worker.run();
}

void run().catch((err: unknown) => {
  console.error("[worker] failed to start", err);
  process.exitCode = 1;
});
