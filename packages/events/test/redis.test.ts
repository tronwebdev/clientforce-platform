import { describe, expect, it } from "vitest";
import { redisOptionsFromUrl } from "../src/redis";

/** Staging-outage regression (2026-07-07): rediss:// must map to TLS options —
 *  plain host/port silently downgraded every BullMQ connection to plaintext
 *  against Azure Cache for Redis (TLS-only, 6380). */
describe("redisOptionsFromUrl", () => {
  it("redis:// maps to plain host/port (default 6379), no tls option", () => {
    expect(redisOptionsFromUrl("redis://localhost:6379")).toEqual({ host: "localhost", port: 6379 });
    expect(redisOptionsFromUrl("redis://localhost")).toEqual({ host: "localhost", port: 6379 });
  });

  it("rediss:// carries tls with SNI servername and defaults to 6380", () => {
    const opts = redisOptionsFromUrl("rediss://:secretpw@cache.redis.cache.windows.net:6380") as {
      host: string;
      port: number;
      password?: string;
      tls?: { servername: string };
    };
    expect(opts.host).toBe("cache.redis.cache.windows.net");
    expect(opts.port).toBe(6380);
    expect(opts.password).toBe("secretpw");
    expect(opts.tls).toEqual({ servername: "cache.redis.cache.windows.net" });

    expect((redisOptionsFromUrl("rediss://cache.example.net") as { port: number }).port).toBe(6380);
  });

  it("keeps username and db selection", () => {
    expect(redisOptionsFromUrl("redis://user:pw@h:6380/2")).toEqual({
      host: "h",
      port: 6380,
      username: "user",
      password: "pw",
      db: 2,
    });
  });
});
