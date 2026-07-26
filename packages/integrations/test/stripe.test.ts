/**
 * INT W3 (DEC-095): the Stripe adapter vs an injected fetch — the two-tier
 * probes (host-pinned link SSRF stance), the webhook-endpoint lifecycle with
 * Stripe's create-only signing-secret semantics, and the error
 * classification (401 auth · 403 = a restricted-key CONFIG refusal, never
 * token death · 429/5xx transient). No network.
 */
import { describe, expect, it } from "vitest";
import { StripeAdapter, stripeConnectFieldsSchema } from "../src/stripe";
import { IntegrationDeliveryError, IntegrationProviderError } from "../src/types";
import { STRIPE_WEBHOOK_EVENTS } from "../src/constants";

type FetchLike = NonNullable<NonNullable<ConstructorParameters<typeof StripeAdapter>[0]>["fetchImpl"]>;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const adapterWith = (fetchImpl: FetchLike) => new StripeAdapter({ baseUrl: "https://stripe.test", fetchImpl });

const CREDS = { apiKey: "rk_test_stub" };
const ACCOUNT = {
  id: "acct_1Q0000",
  business_profile: { name: "BrightPath Growth" },
  settings: { dashboard: { display_name: "BrightPath" } },
};

describe("StripeAdapter — link tier", () => {
  it("accepts a reachable buy.stripe.com link", async () => {
    await expect(
      adapterWith(async () => new Response("ok", { status: 200 })).probeLink("https://buy.stripe.com/abc123"),
    ).resolves.toBeUndefined();
  });

  it("pins the host: non-stripe and non-https links refuse typed with NO fetch", async () => {
    let fetched = 0;
    const adapter = adapterWith(async () => {
      fetched += 1;
      return jsonResponse({});
    });
    await expect(adapter.probeLink("https://evil.example.com/pay")).rejects.toMatchObject({ reason: "link_not_stripe" });
    await expect(adapter.probeLink("http://buy.stripe.com/abc")).rejects.toMatchObject({ reason: "link_not_stripe" });
    await expect(adapter.probeLink("https://buy.stripe.com.evil.com/x")).rejects.toMatchObject({ reason: "link_not_stripe" });
    await expect(adapter.probeLink("not a url")).rejects.toMatchObject({ reason: "link_invalid" });
    expect(fetched).toBe(0);
  });

  it("types 4xx and network failures as link_unreachable", async () => {
    await expect(
      adapterWith(async () => new Response("nope", { status: 404 })).probeLink("https://buy.stripe.com/gone"),
    ).rejects.toMatchObject({ reason: "link_unreachable" });
    await expect(
      adapterWith(async () => {
        throw new Error("ENOTFOUND");
      }).probeLink("https://buy.stripe.com/x"),
    ).rejects.toMatchObject({ reason: "link_unreachable" });
  });
});

describe("StripeAdapter — key tier", () => {
  it("probe → accountLabel 'Business (acct_…)' (the canon shape)", async () => {
    const probe = await adapterWith(async () => jsonResponse(ACCOUNT)).probe(CREDS);
    expect(probe.ok).toBe(true);
    expect(probe.accountLabel).toBe("BrightPath Growth (acct_1Q0000)");
  });

  it("missing key → PROVIDER_AUTH before any fetch", async () => {
    let fetched = 0;
    const adapter = adapterWith(async () => {
      fetched += 1;
      return jsonResponse(ACCOUNT);
    });
    await expect(adapter.probe({})).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(fetched).toBe(0);
  });

  it("classifies 401 auth · 429 rate-limited · 5xx unavailable", async () => {
    await expect(adapterWith(async () => jsonResponse({}, 401)).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
    });
    await expect(adapterWith(async () => jsonResponse({}, 429)).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
    await expect(adapterWith(async () => jsonResponse({}, 500)).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("403 permission-missing = a typed CONFIG refusal (restricted key), never token death", async () => {
    const err = await adapterWith(async () =>
      jsonResponse({ error: { type: "invalid_request_error", code: "permission_denied", message: "This key does not have access" } }, 403),
    )
      .probe(CREDS)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrationDeliveryError);
    expect((err as IntegrationDeliveryError).reason).toBe("permission_denied");
  });
});

describe("StripeAdapter — webhook endpoint lifecycle", () => {
  it("create sends the checkout event set and returns the MINTED secret", async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      if (String(url).includes("webhook_endpoints") && init?.method === "GET") return jsonResponse({ data: [] });
      return jsonResponse({ id: "we_1", secret: "whsec_minted", status: "enabled" });
    });
    const endpoint = await adapter.ensureWebhookEndpoint(CREDS, { callbackUrl: "https://api.example/webhooks/stripe?token=t" });
    expect(endpoint.secret).toBe("whsec_minted");
    const create = calls.find((c) => c.body);
    expect(create!.body).toContain("url=https%3A%2F%2Fapi.example%2Fwebhooks%2Fstripe%3Ftoken%3Dt");
    for (const [i, ev] of STRIPE_WEBHOOK_EVENTS.entries()) {
      expect(decodeURIComponent(create!.body!)).toContain(`enabled_events[${i}]=${ev}`);
    }
  });

  it("an ENABLED endpoint at the same URL is reused — WITHOUT a secret (create-only semantics)", async () => {
    const adapter = adapterWith(async (url, init) => {
      if (init?.method === "GET")
        return jsonResponse({ data: [{ id: "we_old", url: "https://api.example/webhooks/stripe?token=t", status: "enabled" }] });
      throw new Error("must not create");
    });
    const endpoint = await adapter.ensureWebhookEndpoint(CREDS, { callbackUrl: "https://api.example/webhooks/stripe?token=t" });
    expect(endpoint.id).toBe("we_old");
    expect(endpoint.secret).toBeUndefined();
  });

  it("delete resolves quietly on resource_missing", async () => {
    const adapter = adapterWith(async () =>
      jsonResponse({ error: { code: "resource_missing", message: "No such webhook endpoint" } }, 404),
    );
    await expect(adapter.deleteWebhookEndpoint(CREDS, "we_gone")).resolves.toBeUndefined();
  });
});

describe("stripeConnectFieldsSchema", () => {
  it("requires at least one tier and stays strict", () => {
    expect(stripeConnectFieldsSchema.safeParse({}).success).toBe(false);
    expect(stripeConnectFieldsSchema.safeParse({ paymentLinkUrl: "https://buy.stripe.com/x" }).success).toBe(true);
    expect(stripeConnectFieldsSchema.safeParse({ apiKey: "rk_x" }).success).toBe(true);
    expect(stripeConnectFieldsSchema.safeParse({ apiKey: "rk_x", extra: true }).success).toBe(false);
  });
});
