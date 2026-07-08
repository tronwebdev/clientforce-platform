import type { ConnectionOptions } from "bullmq";
import { Cluster, Redis, type RedisOptions } from "ioredis";

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
export function createRedisClient(url: string): Redis | Cluster {
  if (redisClusterEnabled()) return clusterFromUrl(url, { maxRetriesPerRequest: 2 });
  const client = new Redis(url, { maxRetriesPerRequest: 2 });
  client.on("error", (err: unknown) => {
    console.error("[redis] connection error", err instanceof Error ? err.message : err);
  });
  return client;
}

/**
 * `REDIS_CLUSTER=true` (set by infra/main.bicep on api + worker) switches every
 * Redis client to cluster mode. The flag is explicit rather than sniffed: a
 * standalone client against the OSS-cluster-policy staging cache doesn't fail
 * on connect — it fails per-key with `MOVED <slot> <ip>:<port>` whenever the
 * slot lives on another shard (the layer after the 2026-07-08 WRONGPASS fix:
 * upload → enqueue → MOVED 4633 → 500), and a cluster client against plain
 * local Redis fails outright (`CLUSTER SLOTS` is disabled there).
 */
export function redisClusterEnabled(flag = process.env.REDIS_CLUSTER): boolean {
  return flag === "1" || flag?.toLowerCase() === "true";
}

/**
 * Cluster client for an Azure OSS-cluster-policy cache, built from the same
 * URL shape as everything else. Two Azure-documented quirks: `CLUSTER SLOTS`
 * announces shard nodes by raw IP, so (1) `dnsLookup` must pass the address
 * through un-resolved, and (2) TLS must pin SNI/verification to the cache
 * hostname or every shard connection fails its certificate check.
 */
function clusterFromUrl(url: string, redisOverrides: RedisOptions = {}): Cluster {
  const { host, port, ...nodeOptions } = redisOptionsFromUrl(url) as RedisOptions & {
    host: string;
    port: number;
  };
  const cluster = new Redis.Cluster([{ host, port }], {
    dnsLookup: (address, callback) => callback(null, address),
    redisOptions: { ...nodeOptions, ...redisOverrides },
  });
  cluster.on("error", (err: unknown) => {
    console.error("[redis-cluster] connection error", err instanceof Error ? err.message : err);
  });
  return cluster;
}

/**
 * The connection every BullMQ Queue/Worker construction must use: plain
 * options normally (BullMQ manages its own standalone clients), a `Cluster`
 * instance when `REDIS_CLUSTER` is set — BullMQ only speaks cluster when
 * handed an instance; options always instantiate a standalone client, which
 * cannot follow MOVED redirects. `maxRetriesPerRequest` is left at the ioredis
 * default so producers still surface errors instead of queueing forever
 * (BullMQ nulls it internally where blocking commands require it).
 */
export function bullConnectionFromUrl(url: string): ConnectionOptions {
  // Cast: bullmq's ConnectionOptions names the Cluster type from its OWN
  // ioredis dependency (5.10.x), which is nominally distinct from ours
  // (5.11.x) under pnpm strict node_modules — same runtime class, types-only
  // skew.
  return redisClusterEnabled()
    ? (clusterFromUrl(url) as unknown as ConnectionOptions)
    : redisOptionsFromUrl(url);
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
