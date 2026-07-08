import { afterEach, describe, expect, it } from "vitest";
import { Cluster } from "ioredis";
import { bullConnectionFromUrl, redisClusterEnabled, redisOptionsFromUrl } from "../src/redis";

/** Staging-outage regression (2026-07-07): rediss:// must map to TLS options —
 *  plain host/port silently downgraded every BullMQ connection to plaintext
 *  against Azure Cache for Redis (TLS-only, 6380). */
describe("redisOptionsFromUrl", () => {
  it("redis:// maps to plain host/port (default 6379), no tls option", () => {
    expect(redisOptionsFromUrl("redis://localhost:6379")).toEqual({ host: "localhost", port: 6379 });
    expect(redisOptionsFromUrl("redis://localhost")).toEqual({ host: "localhost", port: 6379 });
  });

  // Credentialed URLs are BUILT at runtime: a literal `scheme://user:pass@`
  // in a tracked file (rightly) trips infra/scripts/secret-scan.sh, which
  // gates every deploy — this very test blocked the 2026-07-07 hotfix rollout.
  const withCreds = (base: string, username: string, password: string) => {
    const u = new URL(base);
    u.username = username;
    u.password = password;
    return u.toString();
  };

  it("rediss:// carries tls with SNI servername and defaults to 6380", () => {
    const url = withCreds("rediss://cache.redis.cache.windows.net:6380", "", "fakepw");
    const opts = redisOptionsFromUrl(url) as {
      host: string;
      port: number;
      password?: string;
      tls?: { servername: string };
    };
    expect(opts.host).toBe("cache.redis.cache.windows.net");
    expect(opts.port).toBe(6380);
    expect(opts.password).toBe("fakepw");
    expect(opts.tls).toEqual({ servername: "cache.redis.cache.windows.net" });

    expect((redisOptionsFromUrl("rediss://cache.example.net") as { port: number }).port).toBe(6380);
  });

  it("keeps username and db selection", () => {
    expect(redisOptionsFromUrl(withCreds("redis://h:6380/2", "user", "pw"))).toEqual({
      host: "h",
      port: 6380,
      username: "user",
      password: "pw",
      db: 2,
    });
  });

  /** Staging-outage regression (2026-07-08, layer 5): WHATWG URL getters return
   *  credentials percent-ENCODED (an Azure access key's trailing `=` reads as
   *  `%3D`), and Redis AUTH wants the raw secret. Passing the getter value
   *  through unmapped made every BullMQ connection WRONGPASS while the plain
   *  ioredis client (whose own URL parser decodes) kept the heartbeat green.
   *  The URL setters used here encode on assignment, so round-tripping the
   *  original strings is exactly the property under test. */
  it("percent-decodes username and password (reserved chars like = @ + /)", () => {
    const url = withCreds("rediss://cache.example.net:6380", "us=er", "p@ss=word+end=");
    expect(url).toContain("%3D"); // the setter really did encode — guard the fixture
    const opts = redisOptionsFromUrl(url) as { username?: string; password?: string };
    expect(opts.username).toBe("us=er");
    expect(opts.password).toBe("p@ss=word+end=");
  });
});

/** Staging-outage regression (2026-07-08, layer 6): the live cache is
 *  OSS-cluster-policy — a standalone client gets `MOVED <slot> <node>` for any
 *  key owned by another shard, and only a Cluster INSTANCE makes BullMQ speak
 *  cluster (plain options always construct a standalone client). */
describe("bullConnectionFromUrl", () => {
  afterEach(() => {
    delete process.env.REDIS_CLUSTER;
  });

  it("REDIS_CLUSTER flag parsing: true/1 on, everything else off", () => {
    expect(redisClusterEnabled("true")).toBe(true);
    expect(redisClusterEnabled("TRUE")).toBe(true);
    expect(redisClusterEnabled("1")).toBe(true);
    expect(redisClusterEnabled("false")).toBe(false);
    expect(redisClusterEnabled("")).toBe(false);
    expect(redisClusterEnabled(undefined)).toBe(false);
  });

  it("returns plain options without the flag (local/CI behavior unchanged)", () => {
    expect(bullConnectionFromUrl("redis://localhost:6379")).toEqual({
      host: "localhost",
      port: 6379,
    });
  });

  it("returns an ioredis Cluster instance when REDIS_CLUSTER=true", () => {
    process.env.REDIS_CLUSTER = "true";
    const conn = bullConnectionFromUrl("rediss://cache.example.net:6380");
    expect(conn).toBeInstanceOf(Cluster);
    (conn as Cluster).disconnect();
  });
});
