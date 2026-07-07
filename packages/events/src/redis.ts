import type { ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/** Where the worker process writes its liveness heartbeat (GET /system/health reads it). */
export const WORKER_HEARTBEAT_KEY = "cf:worker:heartbeat";

/**
 * Plain ioredis client for non-queue key/value use (worker heartbeat, health
 * probes). Bounded retries so callers get an error instead of an offline queue
 * that hangs forever when Redis is down — wrap calls accordingly. The error
 * listener is mandatory: ioredis emits `error` on connection failures, and an
 * unhandled `error` event kills the process (observed as a risk in the
 * staging-Redis outage diagnosis, 2026-07-07).
 */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: 2 });
  client.on("error", (err: unknown) => {
    console.error("[redis] connection error", err instanceof Error ? err.message : err);
  });
  return client;
}

/**
 * Build BullMQ connection options from a `redis://` or `rediss://` URL.
 * Returning plain options (rather than a shared ioredis instance) lets BullMQ
 * manage its own connections and apply the worker-required
 * `maxRetriesPerRequest: null`.
 *
 * `rediss://` (Azure Cache for Redis default, port 6380) MUST map to a `tls`
 * option here — plain host/port silently downgrades every BullMQ connection
 * to plaintext against a TLS-only endpoint (staging outage diagnosis,
 * 2026-07-07). The plain `createRedisClient` never had this bug: ioredis
 * parses the scheme natively when given the URL string.
 */
export function redisOptionsFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  const tls = u.protocol === "rediss:";
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : tls ? 6380 : 6379,
    ...(u.username ? { username: u.username } : {}),
    ...(u.password ? { password: u.password } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(tls ? { tls: { servername: u.hostname } } : {}),
  };
}
