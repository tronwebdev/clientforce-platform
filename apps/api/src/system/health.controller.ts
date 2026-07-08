import { join } from "node:path";
import { Controller, Get } from "@nestjs/common";
import { createRedisClient, WORKER_HEARTBEAT_KEY } from "@clientforce/events";
import { AzureBlobUploadStore } from "@clientforce/knowledge";

/** Shape the worker writes every 15s (apps/worker startHeartbeat). */
interface WorkerHeartbeat {
  at?: string;
  ingest?: boolean;
  distill?: boolean;
  planner?: boolean;
  storage?: string;
  uploadsRoot?: string;
}

/** Local uploads root — must match the worker's resolution (createUploadStoreFromEnv). */
const uploadsRoot = (): string =>
  process.env.STORAGE_CONNECTION_STRING
    ? "azure"
    : (process.env.UPLOADS_DIR ?? join(process.cwd(), ".uploads"));

/**
 * GET /system/health — environment readiness for the wizard's banner: is the
 * worker heartbeating, are AI workers configured, and do API + worker agree on
 * where local uploads live (the "file uploaded but never ingests" trap).
 * Never 500s: Redis absence/failure degrades to worker "unknown".
 */
@Controller("system")
export class SystemHealthController {
  private redis?: ReturnType<typeof createRedisClient>;
  private blobStore?: AzureBlobUploadStore;
  private storageCheck: { at: number; reachable: boolean } | null = null;

  /**
   * Storage reachability (hardening, wizard bug round #2): one bounded
   * round-trip to the uploads container, cached 60s so the banner's 5s health
   * poll stays cheap. `null` on the file store — nothing remote to probe.
   */
  private async storageReachable(): Promise<boolean | null> {
    if (!process.env.STORAGE_CONNECTION_STRING) return null;
    if (this.storageCheck && Date.now() - this.storageCheck.at < 60_000) {
      return this.storageCheck.reachable;
    }
    try {
      this.blobStore ??= new AzureBlobUploadStore();
      const reachable = await this.blobStore.reachable();
      this.storageCheck = { at: Date.now(), reachable };
      return reachable;
    } catch {
      this.storageCheck = { at: Date.now(), reachable: false };
      return false;
    }
  }

  @Get("health")
  async health() {
    const storage = process.env.STORAGE_CONNECTION_STRING ? "azure" : "file";
    const root = uploadsRoot();
    const storageReachable = await this.storageReachable();
    let worker: "alive" | "stale" | "unknown" = "unknown";
    let heartbeat: WorkerHeartbeat | null = null;
    if (process.env.REDIS_URL) {
      try {
        this.redis ??= createRedisClient(process.env.REDIS_URL);
        const raw = await this.redis.get(WORKER_HEARTBEAT_KEY);
        if (raw) {
          heartbeat = JSON.parse(raw) as WorkerHeartbeat;
          const age = Date.now() - new Date(heartbeat.at ?? 0).getTime();
          worker = Number.isFinite(age) && age >= 0 && age < 60_000 ? "alive" : "stale";
        }
      } catch {
        worker = "unknown";
        heartbeat = null;
      }
    }
    const uploadsMismatch =
      storage === "file" &&
      heartbeat?.storage === "file" &&
      typeof heartbeat.uploadsRoot === "string" &&
      heartbeat.uploadsRoot !== root;
    return {
      worker,
      heartbeat,
      api: { storage, uploadsRoot: root, storageReachable },
      uploadsMismatch,
      checkedAt: new Date().toISOString(),
    };
  }
}
