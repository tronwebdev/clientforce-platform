import type { ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";

/**
 * Shared BullMQ key prefix, hash-tagged for Redis Cluster: BullMQ's multi-key
 * Lua scripts require every key in one hash slot, and the braces make
 * `{cf}:…:wait` / `{cf}:…:active` hash together. Without this, a clustered
 * cache (Azure Managed Redis / OSS cluster policy) rejects every script with
 * CROSSSLOT — the 2026-07-08 staging diagnosis. Plain (non-cluster) Redis
 * treats the braces as ordinary characters, so local/dev behavior is
 * unchanged. EVERY Queue/Worker construction must pass this prefix.
 */
export const BULL_PREFIX = "{cf}";

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
 *
 * Credentials MUST be percent-decoded: WHATWG `URL.username`/`URL.password`
 * return the ENCODED form, and Redis AUTH takes the raw secret — an Azure
 * access key ending in `=` arrives as `%3D` and gets WRONGPASS on every
 * BullMQ connection while `createRedisClient` (ioredis's own URL parser,
 * which decodes) stays healthy. That split-brain — heartbeat alive, every
 * queue dead — was the final layer of the 2026-07-08 staging outage.
 */
export function redisOptionsFromUrl(url: string): ConnectionOptions {
  const u = new URL(url);
  const tls = u.protocol === "rediss:";
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : tls ? 6380 : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.pathname.length > 1 ? { db: Number(u.pathname.slice(1)) } : {}),
    ...(tls ? { tls: { servername: u.hostname } } : {}),
  };
}
