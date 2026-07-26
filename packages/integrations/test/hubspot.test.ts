/**
 * INT W4 (DEC-096): the HubSpot adapter vs an injected fetch — the token probe,
 * the one-way push primitives (upsert-by-email search-or-create · create deal ·
 * associate · move stage), and the vendor-spine classification (401 auth · 429
 * rate · 5xx unavailable · other 4xx = a typed CONFIG refusal; missing token =
 * PROVIDER_AUTH before any fetch). No network.
 */
import { describe, expect, it, vi } from "vitest";
import { HubspotAdapter, hubspotConnectFieldsSchema } from "../src/hubspot";
import { IntegrationDeliveryError } from "../src/types";

type FetchLike = NonNullable<
  NonNullable<ConstructorParameters<typeof HubspotAdapter>[0]>["fetchImpl"]
>;
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const adapterWith = (fetchImpl: FetchLike) =>
  new HubspotAdapter({ baseUrl: "https://hub.test", fetchImpl });
const CREDS = { apiToken: "pat-na1-stub" };

describe("HubspotAdapter — probe + classification", () => {
  it("probe → accountLabel 'HubSpot (portal …)'", async () => {
    const probe = await adapterWith(async () =>
      json({ portalId: 4242, accountType: "STANDARD" }),
    ).probe(CREDS);
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
    await expect(adapterWith(async () => json({}, 401)).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_AUTH",
    });
    await expect(adapterWith(async () => json({}, 429)).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_RATE_LIMITED",
    });
    await expect(adapterWith(async () => json({}, 503)).probe(CREDS)).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("a 4xx (bad pipeline/stage, missing scope) = a typed CONFIG refusal, never token death", async () => {
    const err = await adapterWith(async () =>
      json({ category: "VALIDATION_ERROR", message: "Invalid dealstage" }, 400),
    )
      .updateDealStage(CREDS, "deal_1", "nope")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrationDeliveryError);
    expect((err as IntegrationDeliveryError).reason).toBe("VALIDATION_ERROR");
  });
});

describe("HubspotAdapter — one-way push primitives", () => {
  it("upsertContact is CREATE-FIRST — a fresh email creates, never searches (write-only tokens can't read)", async () => {
    const calls: string[] = [];
    const adapter = adapterWith(async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      if (String(url).endsWith("/crm/v3/objects/contacts")) return json({ id: "c_new" });
      throw new Error("must not search");
    });
    expect(await adapter.upsertContact(CREDS, { email: "ada@demo.test", firstName: "Ada" })).toBe(
      "c_new",
    );
    expect(calls.every((c) => !c.includes("/search"))).toBe(true);
  });

  it("upsertContact reuses the Existing ID from a 409 CONFLICT (no read scope needed)", async () => {
    const adapter = adapterWith(async () =>
      json(
        {
          status: "error",
          category: "CONFLICT",
          message: "Contact already exists. Existing ID: 1552",
        },
        409,
      ),
    );
    expect(await adapter.upsertContact(CREDS, { email: "ada@demo.test" })).toBe("1552");
  });

  it("createDeal posts dealname + pipeline/stage and returns the id; associate sends the v4 default PUT", async () => {
    const bodies: Array<{ url: string; body: string; method: string }> = [];
    const adapter = adapterWith(async (url, init) => {
      bodies.push({
        url: String(url),
        body: init?.body ? String(init.body) : "",
        method: init?.method ?? "GET",
      });
      return json({ id: "deal_9" });
    });
    const id = await adapter.createDeal(CREDS, {
      dealname: "Ada — deal",
      pipeline: "default",
      stage: "qualifiedtobuy",
      amount: 1500,
    });
    expect(id).toBe("deal_9");
    const create = bodies.find((b) => b.url.endsWith("/crm/v3/objects/deals"))!;
    const props = JSON.parse(create.body).properties;
    expect(props).toMatchObject({
      dealname: "Ada — deal",
      pipeline: "default",
      dealstage: "qualifiedtobuy",
      amount: "1500",
    });

    await adapter.associateDealToContact(CREDS, "deal_9", "c_1");
    // the v4 DEFAULT association PUT (no body) — HubSpot resolves the built-in deal→contact type
    expect(
      bodies.some(
        (b) =>
          b.method === "PUT" &&
          b.url.includes("/crm/v4/objects/deals/deal_9/associations/default/contacts/c_1"),
      ),
    ).toBe(true);
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

describe("HubspotAdapter — regional base (data-residency, INT W4)", () => {
  const capture = (opts?: { baseUrl?: string }) => {
    const urls: string[] = [];
    const adapter = new HubspotAdapter({
      ...opts,
      fetchImpl: async (url) => (urls.push(String(url)), json({ portalId: 1 })),
    });
    return { adapter, urls };
  };

  it("derives the EU host from a pat-eu1- token — api-eu1 (HYPHEN; the dot form is NXDOMAIN, the bug W4's proofs hit)", async () => {
    const { adapter, urls } = capture();
    await adapter.probe({ apiToken: "pat-eu1-abc123" });
    expect(new URL(urls[0]!).host).toBe("api-eu1.hubapi.com");
  });

  it("keeps a US pat-na1- token on the bare api.hubapi.com (no region subdomain)", async () => {
    vi.stubEnv("HUBSPOT_BASE_URL", ""); // no env override → the US default
    const { adapter, urls } = capture();
    await adapter.probe({ apiToken: "pat-na1-abc123" });
    expect(new URL(urls[0]!).host).toBe("api.hubapi.com");
    vi.unstubAllEnvs();
  });

  it("an explicit baseUrl (the stub/test path) overrides region derivation", async () => {
    const { adapter, urls } = capture({ baseUrl: "https://hub.test" });
    await adapter.probe({ apiToken: "pat-eu1-abc123" });
    expect(new URL(urls[0]!).host).toBe("hub.test");
  });
});

describe("hubspotConnectFieldsSchema", () => {
  it("requires the token, stays strict, accepts an optional default pipeline", () => {
    expect(hubspotConnectFieldsSchema.safeParse({}).success).toBe(false);
    expect(hubspotConnectFieldsSchema.safeParse({ apiToken: "pat-x" }).success).toBe(true);
    expect(
      hubspotConnectFieldsSchema.safeParse({ apiToken: "pat-x", defaultPipeline: "sales" }).success,
    ).toBe(true);
    expect(hubspotConnectFieldsSchema.safeParse({ apiToken: "pat-x", extra: true }).success).toBe(
      false,
    );
  });
});
