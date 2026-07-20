/**
 * LH1 (DEC-087): ZeroBounce adapter — the verdict-class fixture matrix
 * (every provider status maps to an owner-locked verdict, pinned) and the
 * typed refusals (missing key / auth / rate limit / outage). No network:
 * fetch is injected.
 */
import { describe, expect, it } from "vitest";
import { ValidationProviderError } from "../src/types";
import { ZEROBOUNCE_STATUS_MAP, ZeroBounceProvider } from "../src/zerobounce";

const fetchJson =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const provider = (impl: typeof fetch) => new ZeroBounceProvider("test-key", "https://bulk.test", "https://api.test", impl);

describe("ZeroBounce status → verdict mapping (fixtures for every class)", () => {
  it("pins the owner-locked map: hostile → invalid, uncertain → risky", () => {
    expect(ZEROBOUNCE_STATUS_MAP).toEqual({
      valid: "valid",
      invalid: "invalid",
      spamtrap: "invalid",
      abuse: "invalid",
      "catch-all": "risky",
      catch_all: "risky",
      unknown: "risky",
      do_not_mail: "risky",
    });
  });

  it("maps a mixed batch verdict-for-verdict and preserves sub-status detail", async () => {
    const statuses: Record<string, { status: string; sub_status?: string }> = {
      "ok@t.test": { status: "valid" },
      "dead@t.test": { status: "invalid", sub_status: "mailbox_not_found" },
      "trap@t.test": { status: "spamtrap" },
      "angry@t.test": { status: "abuse" },
      "catch@t.test": { status: "catch-all" },
      "grey@t.test": { status: "unknown", sub_status: "greylisted" },
      "role@t.test": { status: "do_not_mail", sub_status: "role_based" },
    };
    const p = provider(
      fetchJson(200, {
        email_batch: Object.entries(statuses).map(([address, s]) => ({ address, ...s })),
      }),
    );
    const out = await p.validateBatch(Object.keys(statuses));
    const byAddress = new Map(out.map((r) => [r.address, r]));
    expect(byAddress.get("ok@t.test")?.verdict).toBe("valid");
    expect(byAddress.get("dead@t.test")).toMatchObject({ verdict: "invalid", subStatus: "mailbox_not_found" });
    expect(byAddress.get("trap@t.test")?.verdict).toBe("invalid");
    expect(byAddress.get("angry@t.test")?.verdict).toBe("invalid");
    expect(byAddress.get("catch@t.test")?.verdict).toBe("risky");
    expect(byAddress.get("grey@t.test")).toMatchObject({ verdict: "risky", subStatus: "greylisted" });
    expect(byAddress.get("role@t.test")).toMatchObject({ verdict: "risky", subStatus: "role_based" });
    expect(out).toHaveLength(7);
  });

  it("an unmapped or missing status lands RISKY (held, never guessed valid)", async () => {
    const p = provider(
      fetchJson(200, {
        email_batch: [
          { address: "weird@t.test", status: "brand_new_status" },
          // second address entirely absent from the response
        ],
      }),
    );
    const out = await p.validateBatch(["weird@t.test", "ghost@t.test"]);
    expect(out.find((r) => r.address === "weird@t.test")).toMatchObject({
      verdict: "risky",
      subStatus: "brand_new_status",
    });
    expect(out.find((r) => r.address === "ghost@t.test")?.verdict).toBe("risky");
  });
});

describe("ZeroBounce typed refusals (provider failure is never silent)", () => {
  it("missing key → PROVIDER_AUTH naming the Key Vault secret", async () => {
    const p = new ZeroBounceProvider(undefined, "https://bulk.test", "https://api.test", fetchJson(200, {}));
    await expect(p.validateBatch(["a@t.test"])).rejects.toThrowError(/ZEROBOUNCE-API-KEY/);
    await expect(p.validateBatch(["a@t.test"])).rejects.toBeInstanceOf(ValidationProviderError);
  });

  it("HTTP 429 → PROVIDER_RATE_LIMITED, retryable", async () => {
    const err = await provider(fetchJson(429, {}))
      .validateBatch(["a@t.test"])
      .catch((e: ValidationProviderError) => e);
    expect(err).toBeInstanceOf(ValidationProviderError);
    expect((err as ValidationProviderError).code).toBe("PROVIDER_RATE_LIMITED");
    expect((err as ValidationProviderError).retryable).toBe(true);
  });

  it("HTTP 401 → PROVIDER_AUTH, NOT retryable", async () => {
    const err = await provider(fetchJson(401, {}))
      .validateBatch(["a@t.test"])
      .catch((e: ValidationProviderError) => e);
    expect((err as ValidationProviderError).code).toBe("PROVIDER_AUTH");
    expect((err as ValidationProviderError).retryable).toBe(false);
  });

  it("HTTP 500 and network failure → PROVIDER_UNAVAILABLE, retryable", async () => {
    const server = await provider(fetchJson(500, {}))
      .validateBatch(["a@t.test"])
      .catch((e: ValidationProviderError) => e);
    expect((server as ValidationProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((server as ValidationProviderError).retryable).toBe(true);

    const network = await provider(async () => {
      throw new Error("ECONNREFUSED");
    })
      .validateBatch(["a@t.test"])
      .catch((e: ValidationProviderError) => e);
    expect((network as ValidationProviderError).code).toBe("PROVIDER_UNAVAILABLE");
    expect((network as ValidationProviderError).retryable).toBe(true);
  });

  it("an unreadable batch response is a typed outage, not a crash", async () => {
    const err = await provider(fetchJson(200, { nope: true }))
      .validateBatch(["a@t.test"])
      .catch((e: ValidationProviderError) => e);
    expect((err as ValidationProviderError).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("preflight probes credits and refuses a rejected key", async () => {
    await expect(provider(fetchJson(200, { Credits: "1234" })).preflight()).resolves.toMatchObject({
      ok: true,
    });
    await expect(provider(fetchJson(200, { Credits: "-1" })).preflight()).rejects.toBeInstanceOf(
      ValidationProviderError,
    );
  });

  it("chunks large batches to the API limit", async () => {
    const calls: number[] = [];
    const p = provider(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { email_batch: unknown[] };
      calls.push(body.email_batch.length);
      return new Response(
        JSON.stringify({
          email_batch: body.email_batch.map((e) => ({
            address: (e as { email_address: string }).email_address,
            status: "valid",
          })),
        }),
        { status: 200 },
      );
    });
    const addresses = Array.from({ length: 230 }, (_, i) => `u${i}@t.test`);
    const out = await p.validateBatch(addresses);
    expect(out).toHaveLength(230);
    expect(calls).toEqual([100, 100, 30]);
  });
});
