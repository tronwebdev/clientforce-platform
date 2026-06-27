/**
 * RLS isolation test (acceptance criterion for T1/#2).
 *
 * Seeds two workspaces (A, B) via the privileged owner client, then proves that
 * the non-superuser app client, scoped to workspace A, can never see or touch
 * workspace B's rows — and that with no tenant scope set, nothing is visible.
 *
 * Requires a real Postgres. Skips when APP_DATABASE_URL is unset so `pnpm test`
 * stays green locally without a database (CI provides one).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, withTenant, type PrismaClient } from "../src/index";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("RLS tenant isolation", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let contactA: string;
  let contactB: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();

    const agency = await owner.agency.create({
      data: { name: `t-${suffix}`, slug: `t-${suffix}`, branding: {} },
    });
    agencyId = agency.id;

    const a = await owner.workspace.create({
      data: { agencyId, name: "A", slug: `a-${suffix}`, settings: {} },
    });
    const b = await owner.workspace.create({
      data: { agencyId, name: "B", slug: `b-${suffix}`, settings: {} },
    });
    wsA = a.id;
    wsB = b.id;

    const ca = await owner.contact.create({
      data: { workspaceId: wsA, source: "manual", optOut: {}, tags: [], email: "a@x.test" },
    });
    const cb = await owner.contact.create({
      data: { workspaceId: wsB, source: "manual", optOut: {}, tags: [], email: "b@x.test" },
    });
    contactA = ca.id;
    contactB = cb.id;
  });

  afterAll(async () => {
    // Owner bypasses RLS; cascading delete of the agency clears both workspaces.
    if (owner && agencyId) {
      await owner.contact.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
  });

  it("scoped to A, sees only A's contacts (zero from B)", async () => {
    const rows = await withTenant(app, { workspaceId: wsA }, (tx) => tx.contact.findMany());
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.workspaceId === wsA)).toBe(true);
    expect(rows.some((r) => r.id === contactB)).toBe(false);
  });

  it("cannot read B's row by id while scoped to A", async () => {
    const found = await withTenant(app, { workspaceId: wsA }, (tx) =>
      tx.contact.findUnique({ where: { id: contactB } }),
    );
    expect(found).toBeNull();
  });

  it("scoped to B, sees only B's contacts", async () => {
    const rows = await withTenant(app, { workspaceId: wsB }, (tx) => tx.contact.findMany());
    expect(rows.map((r) => r.id)).toEqual([contactB]);
  });

  it("rejects a write whose workspaceId mismatches the tenant scope (WITH CHECK)", async () => {
    await expect(
      withTenant(app, { workspaceId: wsA }, (tx) =>
        tx.contact.create({
          data: { workspaceId: wsB, source: "manual", optOut: {}, tags: [] },
        }),
      ),
    ).rejects.toThrow();
  });

  it("sees nothing when no tenant scope is set (fail-closed)", async () => {
    const rows = await app.contact.findMany({ where: { id: { in: [contactA, contactB] } } });
    expect(rows.length).toBe(0);
  });
});
