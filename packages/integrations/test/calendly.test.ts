/**
 * INT W2 (DEC-094): the Calendly adapter vs an injected fetch — the two-tier
 * probes, the idempotent webhook-subscription lifecycle, and the constant-
 * time signature verification (t/v1 over "<t>.<rawBody>"). No network.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CalendlyAdapter,
  calendlyConnectFieldsSchema,
  parseCalendlySignatureHeader,
  verifyCalendlySignature,
} from "../src/calendly";
import { IntegrationDeliveryError, IntegrationProviderError } from "../src/types";
import { CALENDLY_WEBHOOK_EVENTS } from "../src/constants";

type FetchLike = NonNullable<NonNullable<ConstructorParameters<typeof CalendlyAdapter>[0]>["fetchImpl"]>;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const adapterWith = (fetchImpl: FetchLike) =>
  new CalendlyAdapter({ baseUrl: "https://calendly.test", fetchImpl });

const CREDS = { apiToken: "stubtok-calendly-pat" };
const ME = {
  resource: {
    uri: "https://calendly.test/users/U1",
    current_organization: "https://calendly.test/organizations/O1",
    name: "Ada Lovelace",
    scheduling_url: "https://calendly.com/ada",
    timezone: "Europe/London",
  },
};

describe("CalendlyAdapter", () => {
  it("is always configured (fields adapter — no platform owner clock)", () => {
    expect(adapterWith(async () => jsonResponse({})).configured).toBe(true);
  });

  it("probeLink accepts a reachable scheduling URL and types 4xx/network as delivery refusals", async () => {
    await expect(adapterWith(async () => new Response("ok", { status: 200 })).probeLink("https://calendly.com/ada")).resolves.toBeUndefined();
    await expect(
      adapterWith(async () => new Response("nope", { status: 404 })).probeLink("https://calendly.com/nope"),
    ).rejects.toBeInstanceOf(IntegrationDeliveryError);
    await expect(
      adapterWith(async () => {
        throw new Error("ENOTFOUND");
      }).probeLink("https://calendly.invalid/x"),
    ).rejects.toBeInstanceOf(IntegrationDeliveryError);
  });

  it("me() probes /users/me with the bearer PAT → uris + accountLabel material", async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    const adapter = adapterWith(async (url, init) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("Authorization") ?? undefined });
      return jsonResponse(ME);
    });
    const user = await adapter.me(CREDS);
    expect(calls[0]?.url).toBe("https://calendly.test/users/me");
    expect(calls[0]?.auth).toBe("Bearer stubtok-calendly-pat");
    expect(user).toMatchObject({
      uri: "https://calendly.test/users/U1",
      organization: "https://calendly.test/organizations/O1",
      name: "Ada Lovelace",
      schedulingUrl: "https://calendly.com/ada",
    });
    const probe = await adapter.probe(CREDS);
    expect(probe.ok).toBe(true);
    expect(probe.accountLabel).toBe("Ada Lovelace (Calendly)");
  });

  it("classifies 401 as PROVIDER_AUTH, 429 rate-limited, 5xx unavailable; no token refuses locally", async () => {
    await expect(adapterWith(async () => jsonResponse({}, 401)).me(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
      retryable: false,
    });
    await expect(adapterWith(async () => jsonResponse({}, 429)).me(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
    await expect(adapterWith(async () => jsonResponse({}, 500)).me(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    await expect(adapterWith(async () => jsonResponse(ME)).me({})).rejects.toBeInstanceOf(IntegrationProviderError);
  });

  it("ensureWebhookSubscription is idempotent: an active subscription on the same callback URL is reused", async () => {
    const posts: string[] = [];
    const adapter = adapterWith(async (url, init) => {
      if (init?.method === "GET" || !init?.method) {
        return jsonResponse({
          collection: [
            { uri: "https://calendly.test/webhook_subscriptions/W1", callback_url: "https://api.test/webhooks/calendly?token=tok1", state: "active" },
            { uri: "https://calendly.test/webhook_subscriptions/W0", callback_url: "https://api.test/webhooks/calendly?token=old", state: "disabled" },
          ],
        });
      }
      posts.push(String(init?.body));
      return jsonResponse({ resource: { uri: "https://calendly.test/webhook_subscriptions/W2", state: "active" } }, 201);
    });
    const reused = await adapter.ensureWebhookSubscription(CREDS, {
      organization: "https://calendly.test/organizations/O1",
      user: "https://calendly.test/users/U1",
      callbackUrl: "https://api.test/webhooks/calendly?token=tok1",
      signingKey: "sk",
    });
    expect(reused.uri).toBe("https://calendly.test/webhook_subscriptions/W1");
    expect(posts).toHaveLength(0); // never re-created

    const created = await adapter.ensureWebhookSubscription(CREDS, {
      organization: "https://calendly.test/organizations/O1",
      user: "https://calendly.test/users/U1",
      callbackUrl: "https://api.test/webhooks/calendly?token=FRESH",
      signingKey: "sk",
    });
    expect(created.uri).toBe("https://calendly.test/webhook_subscriptions/W2");
    expect(posts).toHaveLength(1);
    const posted = JSON.parse(posts[0] ?? "{}") as Record<string, unknown>;
    expect(posted).toMatchObject({
      url: "https://api.test/webhooks/calendly?token=FRESH",
      events: [...CALENDLY_WEBHOOK_EVENTS],
      scope: "user",
      signing_key: "sk",
    });
  });

  it("subscription create on a free plan (403) types as a delivery refusal with Calendly's message", async () => {
    const adapter = adapterWith(async (url, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ title: "Permission Denied", message: "Please upgrade your Calendly account to Professional" }, 403);
      }
      return jsonResponse({ collection: [] });
    });
    await expect(
      adapter.ensureWebhookSubscription(CREDS, {
        organization: "o",
        user: "u",
        callbackUrl: "https://api.test/webhooks/calendly?token=t",
        signingKey: "sk",
      }),
    ).rejects.toMatchObject({ name: "IntegrationDeliveryError", message: expect.stringContaining("upgrade") });
  });

  it("deleteWebhookSubscription resolves quietly on 404 (already gone)", async () => {
    const adapter = adapterWith(async () => jsonResponse({ title: "Not Found" }, 404));
    await expect(
      adapter.deleteWebhookSubscription(CREDS, "https://calendly.test/webhook_subscriptions/W9"),
    ).resolves.toBeUndefined();
  });
});

describe("verifyCalendlySignature", () => {
  const KEY = "signing-key-123";
  const BODY = JSON.stringify({ event: "invitee.created", payload: { uri: "x" } });
  const T = "1721600000";
  const sign = (t: string, body: string, key: string): string =>
    createHmac("sha256", key).update(`${t}.${body}`, "utf8").digest("hex");

  it("accepts the correct HMAC over '<t>.<rawBody>' and rejects every tampered part", () => {
    const v1 = sign(T, BODY, KEY);
    expect(verifyCalendlySignature(T, v1, BODY, KEY)).toBe(true);
    expect(verifyCalendlySignature("1721600001", v1, BODY, KEY)).toBe(false); // timestamp swap
    expect(verifyCalendlySignature(T, v1, `${BODY} `, KEY)).toBe(false); // body tamper
    expect(verifyCalendlySignature(T, v1, BODY, "other-key")).toBe(false); // wrong key
    expect(verifyCalendlySignature(T, sign(T, BODY, "other-key"), BODY, KEY)).toBe(false);
    expect(verifyCalendlySignature(T, "", BODY, KEY)).toBe(false);
    expect(verifyCalendlySignature(T, "deadbeef", BODY, KEY)).toBe(false); // length mismatch path
    expect(verifyCalendlySignature(T, v1, BODY, "")).toBe(false);
  });

  it("parses the vendor header shape and rejects malformed ones", () => {
    const v1 = sign(T, BODY, KEY);
    expect(parseCalendlySignatureHeader(`t=${T},v1=${v1}`)).toEqual({ t: T, v1 });
    expect(parseCalendlySignatureHeader(`v1=${v1}`)).toBeNull();
    expect(parseCalendlySignatureHeader("")).toBeNull();
    expect(parseCalendlySignatureHeader(undefined)).toBeNull();
  });
});

describe("calendlyConnectFieldsSchema", () => {
  it("accepts either field, both fields, and rejects neither/unknown keys", () => {
    expect(calendlyConnectFieldsSchema.safeParse({ schedulingUrl: "https://calendly.com/ada" }).success).toBe(true);
    expect(calendlyConnectFieldsSchema.safeParse({ apiToken: "pat" }).success).toBe(true);
    expect(
      calendlyConnectFieldsSchema.safeParse({ schedulingUrl: "https://calendly.com/ada", apiToken: "pat" }).success,
    ).toBe(true);
    expect(calendlyConnectFieldsSchema.safeParse({}).success).toBe(false);
    expect(calendlyConnectFieldsSchema.safeParse({ schedulingUrl: "not-a-url" }).success).toBe(false);
    expect(calendlyConnectFieldsSchema.safeParse({ schedulingUrl: "https://x.test", extra: 1 }).success).toBe(false);
  });
});
