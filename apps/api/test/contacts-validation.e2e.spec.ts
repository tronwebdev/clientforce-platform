/**
 * LH1 W2 (DEC-087): CSV import gains the ASYNC validation pass — chunked
 * imports land on ONE batch (client key), the report endpoint serves counts
 * verdict-for-verdict + row detail + the exclusions CSV, and manual adds get
 * the inline light pass (cache → suppression → syntax → MX) without ever
 * blocking the create. Provider mocked; runs vs real Postgres + RLS.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import { validateEvent } from "@clientforce/events";
import {
  runValidationBatchToSettled,
  type EmailValidationProvider,
  type ProviderResult,
  type ValidationDeps,
  type ValidationEventInput,
} from "@clientforce/validation";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";
import { VALIDATION_LIGHT_DEPS, VALIDATION_QUEUE } from "../src/contacts/validation.providers";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

class MockProvider implements EmailValidationProvider {
  readonly name = "zerobounce";
  seen: string[] = [];
  async validateBatch(addresses: string[]): Promise<ProviderResult[]> {
    this.seen.push(...addresses);
    return addresses.map((address) => ({
      address,
      verdict: address.startsWith("risky") ? ("risky" as const) : ("valid" as const),
      ...(address.startsWith("risky") ? { subStatus: "catch_all" } : {}),
    }));
  }
  async preflight() {
    return { ok: true, detail: "mock" };
  }
}

const mockResolveMx = async (domain: string) => {
  if (domain === "no-mx.test") {
    const err = new Error("no data") as NodeJS.ErrnoException;
    err.code = "ENODATA";
    throw err;
  }
  return [{ exchange: `mx.${domain}`, priority: 10 }];
};

describe.skipIf(!hasDb)("Contacts validation (LH1 W2)", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let appDb: PrismaClient;
  let agencyId: string;
  let ws: string;
  let userId: string;
  let token: string;
  const provider = new MockProvider();
  const events: ValidationEventInput[] = [];
  const deps = (): ValidationDeps => ({
    prisma: appDb,
    ownerPrisma: owner,
    provider,
    publish: async (e) => {
      validateEvent(e);
      events.push(e);
    },
    resolveMx: mockResolveMx,
  });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    appDb = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `val-${suffix}`, slug: `val-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "VAL", slug: `val-${suffix}`, settings: {} },
      })
    ).id;
    const u = await owner.user.create({
      data: { email: `val-${suffix}@t.test`, authProviderId: `auth|val-${suffix}` },
    });
    userId = u.id;
    await owner.membership.create({ data: { userId: u.id, workspaceId: ws, role: "OWNER" } });
    token = await signDevToken(SECRET, { sub: `auth|val-${suffix}`, email: u.email });
    // The pre-suppressed address the import must skip (never billed).
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "email", address: `supp-${suffix}@ok.test`, reason: "BOUNCED" },
    });
    // A fresh cached verdict the light pass serves instantly.
    await owner.emailValidationVerdict.create({
      data: {
        workspaceId: ws,
        address: `cached-${suffix}@ok.test`,
        verdict: "valid",
        source: "zerobounce",
        expiresAt: new Date(Date.now() + 80 * 86_400_000),
      },
    });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(VALIDATION_QUEUE)
      .useValue(null)
      .overrideProvider(VALIDATION_LIGHT_DEPS)
      .useValue({ resolveMx: mockResolveMx })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await appDb?.$disconnect();
  });

  const auth = () => ({ Authorization: `Bearer ${token}`, "x-workspace-id": ws });
  const batchKey = `import-${suffix}`;
  let batchId: string;

  it("chunked imports land on ONE batch; dups add no items; suppressed rows are covered", async () => {
    const chunk1 = await request(app.getHttpServer())
      .post("/contacts/import")
      .set(auth())
      .send({
        validationBatchKey: batchKey,
        rows: [
          { email: `a-${suffix}@ok.test`, firstName: "A" },
          { email: `risky-${suffix}@ok.test`, firstName: "R" },
          { email: `dup-${suffix}@ok.test`, firstName: "D" },
        ],
      });
    expect(chunk1.status).toBe(201);
    expect(chunk1.body.created).toBe(3);
    expect(chunk1.body.validationBatchId).toBeTruthy();

    const chunk2 = await request(app.getHttpServer())
      .post("/contacts/import")
      .set(auth())
      .send({
        validationBatchKey: batchKey,
        rows: [
          { email: `dup-${suffix}@ok.test`, firstName: "D2" }, // workspace dup — skipped
          { email: `supp-${suffix}@ok.test`, firstName: "S" }, // creates, flagged suppressed
        ],
      });
    expect(chunk2.status).toBe(201);
    expect(chunk2.body).toMatchObject({ created: 1, skippedDuplicates: 1, suppressed: 1 });
    expect(chunk2.body.validationBatchId).toBe(chunk1.body.validationBatchId);
    batchId = chunk1.body.validationBatchId as string;

    const items = await owner.validationBatchItem.count({ where: { batchId } });
    expect(items).toBe(4); // a, risky, dup (once), supp — the skipped dup adds nothing
  });

  it("the report matches the fixture verdict-for-verdict as the batch resolves", async () => {
    // Import completed instantly (async stance) — contacts land unverified.
    const before = await request(app.getHttpServer()).get(`/contacts/validation-batches/${batchId}`).set(auth());
    expect(before.status).toBe(200);
    expect(before.body.counts).toMatchObject({ total: 4, pending: 4 });

    const settled = await runValidationBatchToSettled(deps(), ws, batchId);
    expect(settled.status).toBe("completed");
    // The suppressed row provably never billed (free-filter order).
    expect(provider.seen).not.toContain(`supp-${suffix}@ok.test`);

    const res = await request(app.getHttpServer()).get(`/contacts/validation-batches/${batchId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.counts).toMatchObject({
      total: 4,
      pending: 0,
      valid: 2, // a + dup
      risky: 1,
      invalid: 0,
      skippedSuppressed: 1,
    });

    const rows = await request(app.getHttpServer())
      .get(`/contacts/validation-batches/${batchId}/rows?outcome=risky`)
      .set(auth());
    expect(rows.status).toBe(200);
    expect(rows.body.rows).toHaveLength(1);
    expect(rows.body.rows[0]).toMatchObject({
      email: `risky-${suffix}@ok.test`,
      outcome: "risky",
      via: "zerobounce",
      detail: "catch_all",
    });
  });

  it("the exclusions CSV is honest about every excluded row", async () => {
    const res = await request(app.getHttpServer())
      .get(`/contacts/validation-batches/${batchId}/exclusions.csv`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.text.split("\n")[0]).toBe("email,excluded_because,detail");
    expect(res.text).toContain(`supp-${suffix}@ok.test,already suppressed`);
  });

  it("verdicts ride the contacts view rows (the chips' data)", async () => {
    const res = await request(app.getHttpServer()).get("/contacts/view").set(auth());
    expect(res.status).toBe(200);
    const rows = res.body.rows as Array<{ email: string | null; emailVerdict: string }>;
    expect(rows.find((r) => r.email === `risky-${suffix}@ok.test`)?.emailVerdict).toBe("risky");
    expect(rows.find((r) => r.email === `a-${suffix}@ok.test`)?.emailVerdict).toBe("valid");
    expect(rows.find((r) => r.email === `supp-${suffix}@ok.test`)?.emailVerdict).toBe("unverified");
  });

  it("manual add light pass: syntax fail lands invalid INLINE, create never blocks", async () => {
    const res = await request(app.getHttpServer())
      .post("/contacts")
      .set(auth())
      .send({ email: "definitely-not-an-email", firstName: "Bad" });
    expect(res.status).toBe(201);
    expect(res.body.emailVerdict).toBe("invalid");
    expect(res.body.emailVerdictSource).toBe("syntax");
  });

  it("manual add light pass: dead-MX domain lands invalid via mx", async () => {
    const res = await request(app.getHttpServer())
      .post("/contacts")
      .set(auth())
      .send({ email: `x-${suffix}@no-mx.test`, firstName: "NoMx" });
    expect(res.status).toBe(201);
    expect(res.body.emailVerdict).toBe("invalid");
    expect(res.body.emailVerdictSource).toBe("mx");
  });

  it("manual add light pass: a fresh cached verdict serves instantly (free)", async () => {
    const res = await request(app.getHttpServer())
      .post("/contacts")
      .set(auth())
      .send({ email: `CACHED-${suffix}@ok.test`, firstName: "Hit" });
    expect(res.status).toBe(201);
    expect(res.body.emailVerdict).toBe("valid");
    expect(res.body.emailVerdictSource).toBe("cache");
  });

  it("manual add light pass: unresolved address queues a single-contact batch; suppressed does NOT", async () => {
    const ok = await request(app.getHttpServer())
      .post("/contacts")
      .set(auth())
      .send({ email: `fresh-${suffix}@ok.test`, firstName: "Fresh" });
    expect(ok.status).toBe(201);
    expect(ok.body.emailVerdict).toBe("unverified");
    expect(ok.body.suppressed).toBe(false);
    const single = await owner.validationBatch.findMany({
      where: { workspaceId: ws, source: "single" },
      include: { items: true },
    });
    expect(single).toHaveLength(1);
    expect(single[0]?.items[0]?.address).toBe(`fresh-${suffix}@ok.test`);

    const supp = await request(app.getHttpServer())
      .post("/contacts")
      .set(auth())
      .send({ email: `SUPP-${suffix}@ok.test`, firstName: "Held" });
    expect(supp.status).toBe(201);
    expect(supp.body.suppressed).toBe(true);
    expect(supp.body.emailVerdict).toBe("unverified");
    expect(await owner.validationBatch.count({ where: { workspaceId: ws, source: "single" } })).toBe(1);
  });
});
