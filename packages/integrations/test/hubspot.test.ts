/**
 * INT W4 (DEC-096): the HubSpot adapter vs an injected fetch — the token probe,
 * the one-way push primitives (upsert-by-email search-or-create · create deal ·
 * associate · move stage), and the vendor-spine classification (401 auth · 429
 * rate · 5xx unavailable · other 4xx = a typed CONFIG refusal; missing token =
 * PROVIDER_AUTH before any fetch). No network.
 */
import { describe, expect, it } from "vitest";
import { HubspotAdapter, hubspotConnectFieldsSchema } from "../src/hubspot";
import { IntegrationDeliveryError, IntegrationProviderError } from "../src/types";

type FetchLike = NonNullable<NonNullable<ConstructorParameters<typeof HubspotAdapter>[0]>["fetchImpl"]>;
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const adapterWith = (fetchImpl: FetchLike) => new HubspotAdapter({ baseUrl: "https://hub.test", fetchImpl });
const CREDS = { apiToken: "pat-na1-stub" };

describe("HubspotAdapter — probe + classification", () => {
  it("probe → accountLabel 'HubSpot (portal …)'", async () => {
    const probe = await adapterWith(async () => json({ portalId: 4242, accountType: "STANDARD" })).probe(CREDS);
    expect(probe.ok).toBe(true);
    expect(probe.accountLabel).toBe("HubSpot (portal 4242)");
  });

  it("missing token → PROVIDER_AUTH before any fetch", async () => {
    let fetched = 0;
    const adapter = adapterWith(async () => {
      fetched += 1;
      return json({ portalId: 1 });
    });
    await expect(adapter.probe({})).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    expect(fetched).toBe(0);
  });

  it("classifies 401 auth · 429 rate-limited · 5xx unavailable", async () => {
    await expect(adapterWith(async () => json({}, 401)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
    await expect(adapterWith(async () => json({}, 429)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMITED" });
    await expect(adapterWith(async () => json({}, 503)).probe(CREDS)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });

  it("a 4xx (bad pipeline/stage, missing scope) = a typed CONFIG refusal, never token death", async () => {
    const err = await adapterWith(async () => json({ category: "VALIDATION_ERROR", message: "Invalid dealstage" }, 400))
      .updateDealStage(CREDS, "deal_1", "nope")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrationDeliveryError);
    expect((err as IntegrationDeliveryError).reason).toBe("VALIDATION_ERROR");
  });
});

describe("HubspotAdapter — one-way push primitives", () => {
  it("upsertContact reuses an existing contact by email (no create)", async () => {
    const calls: string[] = [];
    const adapter = adapterWith(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/crm/v3/objects/contacts/search")) return json({ results: [{ id: "c_existing" }] });
      throw new Error("must not create");
    });
    expect(await adapter.upsertContact(CREDS, { email: "ada@demo.test" })).toBe("c_existing");
    expect(calls.some((c) => c.includes("/contacts/search"))).toBe(true);
  });

  it("upsertContact creates when the search is empty", async () => {
    const adapter = adapterWith(async (url) => {
      if (String(url).endsWith("/crm/v3/objects/contacts/search")) return json({ results: [] });
      return json({ id: "c_new" });
    });
    expect(await adapter.upsertContact(CREDS, { email: "ada@demo.test", firstName: "Ada" })).toBe("c_new");
  });

  it("createDeal posts dealname + pipeline/stage and returns the id; associate sends the v4 default PUT", async () => {
    const bodies: Array<{ url: string; body: string; method: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      bodies.push({ url: String(url), body: init?.body ? String(init.body) : "", method: init?.method ?? "GET" });
      return json({ id: "deal_9" });
    });
    const id = await adapter.createDeal(CREDS, { dealname: "Ada — deal", pipeline: "default", stage: "qualifiedtobuy", amount: 1500 });
    expect(id).toBe("deal_9");
    const create = bodies.find((b) => b.url.endsWith("/crm/v3/objects/deals"))!;
    const props = JSON.parse(create.body).properties;
    expect(props).toMatchObject({ dealname: "Ada — deal", pipeline: "default", dealstage: "qualifiedtobuy", amount: "1500" });

    await adapter.associateDealToContact(CREDS, "deal_9", "c_1");
    expect(bodies.some((b) => b.method === "PUT" && b.url.includes("/crm/v4/objects/deals/deal_9/associations/default/contacts/c_1"))).toBe(true);
  });

  it("updateDealStage PATCHes dealstage; a 204 no-body resolves", async () => {
    let patched = "";
    const adapter = adapterWith(async (url, init) => {
      if (init?.method === "PATCH") {
        patched = JSON.parse(String(init.body)).properties.dealstage;
        return new Response(null, { status: 204 });
      }
      return json({});
    });
    await expect(adapter.updateDealStage(CREDS, "deal_9", "closedwon")).resolves.toBeUndefined();
    expect(patched).toBe("closedwon");
  });
});

describe("hubspotConnectFieldsSchema", () => {
  it("requires the token, stays strict, accepts an optional default pipeline", () => {
    expect(hubspotConnectFieldsSchema.safeParse({}).success).toBe(false);
    expect(hubspotConnectFieldsSchema.safeParse({ apiToken: "pat-x" }).success).toBe(true);
    expect(hubspotConnectFieldsSchema.safeParse({ apiToken: "pat-x", defaultPipeline: "sales" }).success).toBe(true);
    expect(hubspotConnectFieldsSchema.safeParse({ apiToken: "pat-x", extra: true }).success).toBe(false);
  });
});
