import type { ConnectionOptions } from "bullmq";

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
