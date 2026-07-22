/**
 * INT W3 (DEC-095) review-round pins vs REAL Postgres + RLS — the Stripe
 * fields-connect lifecycle hardening:
 *   1. the link probe runs BEFORE the vendor is mutated (a bad link never
 *      orphans a webhook endpoint);
 *   2. a URL-matched endpoint whose id differs from the stored one is NOT
 *      trusted with the stored secret — it is recreated so the secret it
 *      signs with is the one we hold (no silent signature death);
 *   3. probe re-verifies the webhook endpoint detection depends on — a
 *      deleted endpoint flips `detection` off instead of reading healthy.
 * The Stripe API is a stateful in-memory script (create-only secret
 * semantics modelled faithfully); no network, no DB skip → runs on infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { StripeAdapter } from "../src/stripe";
import {
  connectStripeFields,
  decryptCredentials,
  probeIntegration,
  type IntegrationRow,
  type IntegrationsDeps,
} from "../src";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `intw3sc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A stateful Stripe API: an in-memory endpoint list with create-only secrets. */
function statefulStripe() {
  let nextId = 1;
  const endpoints: Array<{ id: string; url: string; status: string; secret: string }> = [];
  let linkStatus = 200;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const adapter = new StripeAdapter({
    baseUrl: "https://stripe.test",
    fetchImpl: async (url, init) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("buy.stripe.com")) return new Response("x", { status: linkStatus });
      if (u.endsWith("/v1/account")) return json({ id: "acct_demo", business_profile: { name: "Demo" } });
      if (u.includes("/v1/webhook_endpoints/") && method === "DELETE") {
        const id = u.split("/v1/webhook_endpoints/")[1]!.split("?")[0]!;
        const idx = endpoints.findIndex((e) => e.id === id);
        if (idx === -1) return json({ error: { code: "resource_missing" } }, 404);
        endpoints.splice(idx, 1);
        return json({ id, deleted: true });
      }
      if (u.includes("/v1/webhook_endpoints") && method === "GET")
        return json({ data: endpoints.map((e) => ({ id: e.id, url: e.url, status: e.status })) }); // NO secret (create-only)
      if (u.endsWith("/v1/webhook_endpoints") && method === "POST") {
        const body = new URLSearchParams(String(init?.body));
        const id = `we_${nextId++}`;
        const secret = `whsec_${id}`;
        endpoints.push({ id, url: body.get("url")!, status: "enabled", secret });
        return json({ id, secret, status: "enabled" });
      }
      return json({ error: { code: "unknown" } }, 400);
    },
  });
  return {
    adapter,
    endpoints,
    setLinkStatus: (s: number) => {
      linkStatus = s;
    },
    createCount: () => nextId - 1,
  };
}

describe.skipIf(!hasInfra)("stripe fields connect — review-round hardening (INT W3)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;

  const webhookUrlFor = (token: string) => `https://api.test/webhooks/stripe?token=${token}`;
  const newWs = async (tag: string) =>
    (await owner.workspace.create({ data: { agencyId, name: tag, slug: `${suffix}-${tag}`, settings: {} } })).id;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    agencyId = (await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } })).id;
  });
  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("a bad payment link refuses BEFORE any endpoint is created (no orphan)", async () => {
    const ws = await newWs("reorder");
    const stripe = statefulStripe();
    stripe.setLinkStatus(404); // the link 404s → probeLink throws
    const deps: IntegrationsDeps = { prisma: app, adapters: { stripe: stripe.adapter }, publish: async () => {} };
    await expect(
      connectStripeFields(deps, {
        workspaceId: ws,
        fields: { apiKey: "rk_test_x", paymentLinkUrl: "https://buy.stripe.com/dead" },
        webhookUrlFor,
      }),
    ).rejects.toThrow();
    // The vendor was never mutated — the link validated first.
    expect(stripe.createCount()).toBe(0);
    expect(stripe.endpoints).toHaveLength(0);
    expect(await owner.integration.findFirst({ where: { workspaceId: ws, provider: "stripe" } })).toBeNull();
  });

  it("a reconnect that URL-matches a DIFFERENT endpoint id recreates the secret (no stale-secret sign death)", async () => {
    const ws = await newWs("identity");
    const stripe = statefulStripe();
    const deps: IntegrationsDeps = { prisma: app, adapters: { stripe: stripe.adapter }, publish: async () => {} };

    const row1 = await connectStripeFields(deps, { workspaceId: ws, fields: { apiKey: "rk_test_a" }, webhookUrlFor });
    const creds1 = decryptCredentials(row1 as IntegrationRow);
    expect(typeof creds1.webhookEndpointId).toBe("string");
    const e1 = creds1.webhookEndpointId as string;
    const s1 = creds1.webhookSigningSecret as string;

    // Simulate a cross-mode/account switch: the SAME callback URL now resolves
    // to a DIFFERENT endpoint (the stored secret belongs to the gone e1).
    const url = webhookUrlFor((row1.config as { webhookToken: string }).webhookToken);
    stripe.endpoints.splice(0, stripe.endpoints.length, { id: "we_foreign", url, status: "enabled", secret: "whsec_foreign" });

    const row2 = await connectStripeFields(deps, { workspaceId: ws, fields: { apiKey: "rk_test_a" }, webhookUrlFor });
    const creds2 = decryptCredentials(row2 as IntegrationRow);
    // NOT paired with the foreign endpoint + the stale secret (the bug); a fresh
    // endpoint whose minted secret we actually hold.
    expect(creds2.webhookEndpointId).not.toBe("we_foreign");
    expect(creds2.webhookEndpointId).not.toBe(e1);
    expect(creds2.webhookSigningSecret).toBe(`whsec_${creds2.webhookEndpointId}`);
    expect(creds2.webhookSigningSecret).not.toBe(s1);
    // The stored secret must match the endpoint that will actually sign.
    const live = stripe.endpoints.find((e) => e.id === creds2.webhookEndpointId);
    expect(live?.secret).toBe(creds2.webhookSigningSecret);
  });

  it("probe flips detection OFF when the webhook endpoint was deleted out-of-band", async () => {
    const ws = await newWs("probe");
    const stripe = statefulStripe();
    const deps: IntegrationsDeps = { prisma: app, adapters: { stripe: stripe.adapter }, publish: async () => {} };
    const row = await connectStripeFields(deps, { workspaceId: ws, fields: { apiKey: "rk_test_p" }, webhookUrlFor });
    expect((row.config as { detection?: boolean }).detection).toBe(true);

    // Owner deletes the endpoint in the Stripe dashboard.
    stripe.endpoints.splice(0, stripe.endpoints.length);
    const probe = await probeIntegration(deps, { workspaceId: ws, provider: "stripe" });
    expect(probe.status).toBe("connected"); // the account is still reachable
    expect(probe.detail).toContain("detection endpoint missing");
    const after = await owner.integration.findUniqueOrThrow({ where: { id: row.id } });
    expect((after.config as { detection?: boolean }).detection).toBe(false);
  });
});
