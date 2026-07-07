import type { ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/** Where the worker process writes its liveness heartbeat (GET /system/health reads it). */
export const WORKER_HEARTBEAT_KEY = "cf:worker:heartbeat";

/**
 * Plain ioredis client for non-queue key/value use (worker heartbeat, health
 * probes). Bounded retries so callers get an error instead of an offline queue
 * that hangs forever when Redis is down — wrap calls accordingly.
 */
export function createRedisClient(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 2 });
}

/**
 * Build BullMQ connection options from a `redis://` URL. Returning plain options
 * (rather than a shared ioredis instance) lets BullMQ manage its own
 * connections and apply the worker-required `maxRetriesPerRequest: null`.
 */
export function redisOptionsFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
  };
}
