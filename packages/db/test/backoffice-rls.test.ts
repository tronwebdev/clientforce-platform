/**
 * Backoffice access-model pins (B1 W1, DEC-079). Complements `rls.test.ts`:
 *
 *   1. the RLS-EXEMPT `clientforce_backoffice` role reads across EVERY tenant
 *      with NO GUC set (its whole purpose — BYPASSRLS);
 *   2. the RLS-subject `clientforce_app` role STILL fails closed with no GUC
 *      (the tenant path is untouched — regression pinned);
 *   3. `clientforce_app` cannot even read the backoffice tables (REVOKEd).
 *
 * Always exercises the real dedicated role: when BACKOFFICE_DATABASE_URL is not
 * set (CI), it derives the connection from APP_DATABASE_URL by swapping the role
 * name, so it never silently falls back to the superuser.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createBackofficePrismaClient,
  createPrismaClient,
  type PrismaClient,
} from "../src/index";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Prefer the explicit backoffice URL; else derive the dedicated role from the
 *  app URL so CI exercises `clientforce_backoffice`, not the superuser. */
function backofficeUrl(): string | undefined {
  if (process.env.BACKOFFICE_DATABASE_URL) return process.env.BACKOFFICE_DATABASE_URL;
  const base = process.env.APP_DATABASE_URL;
  if (base && base.includes("clientforce_app")) {
    return base.replace("clientforce_app", "clientforce_backoffice");
  }
  return undefined;
}

describe.skipIf(!hasDb)("backoffice RLS-exempt access", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let backoffice: PrismaClient;
  let agencyId: string;
  let wsA: string;
  let wsB: string;
  let contactA: string;
  let contactB: string;

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    backoffice = createBackofficePrismaClient({ url: backofficeUrl() });

    const agency = await owner.agency.create({
      data: { name: `bo-rls-${suffix}`, slug: `bo-rls-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    wsA = (await owner.workspace.create({ data: { agencyId, name: "A", slug: `bo-rls-a-${suffix}`, settings: {} } })).id;
    wsB = (await owner.workspace.create({ data: { agencyId, name: "B", slug: `bo-rls-b-${suffix}`, settings: {} } })).id;
    contactA = (await owner.contact.create({ data: { workspaceId: wsA, source: "manual", optOut: {}, tags: [], email: `bo-a-${suffix}@x.test` } })).id;
    contactB = (await owner.contact.create({ data: { workspaceId: wsB, source: "manual", optOut: {}, tags: [], email: `bo-b-${suffix}@x.test` } })).id;
  });

  afterAll(async () => {
    if (owner && agencyId) {
      await owner.contact.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      // KillSwitch/FeatureFlag carry no FK to Agency/Workspace (backoffice tables),
      // so the agency cascade won't reach them — delete explicitly.
      await owner.killSwitch.deleteMany({ where: { agencyId } });
      await owner.featureFlag.deleteMany({ where: { workspaceId: { in: [wsA, wsB] } } });
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
    }
    await owner?.$disconnect();
    await app?.$disconnect();
    await backoffice?.$disconnect();
  });

  it("backoffice role reads BOTH tenants' contacts with no GUC (BYPASSRLS)", async () => {
    const rows = await backoffice.contact.findMany({ where: { id: { in: [contactA, contactB] } } });
    expect(rows.map((r) => r.id).sort()).toEqual([contactA, contactB].sort());
  });

  it("app role STILL sees nothing with no GUC (fail-closed — tenant path untouched)", async () => {
    const rows = await app.contact.findMany({ where: { id: { in: [contactA, contactB] } } });
    expect(rows.length).toBe(0);
  });

  it("app role cannot read the backoffice tables (REVOKEd)", async () => {
    await expect(app.platformStaff.findMany()).rejects.toThrow();
    // B1 W3 (DEC-081): product telemetry is internal-only — the tenant/RLS-subject
    // role cannot read TelemetryEvent, so product events can never surface in
    // tenant-facing Analytics.
    await expect(app.telemetryEvent.findMany()).rejects.toThrow();
  });

  it("backoffice role can read the backoffice tables", async () => {
    // Does not throw (grant present); count is environment-dependent.
    await expect(backoffice.platformStaff.count()).resolves.toBeTypeOf("number");
    await expect(backoffice.telemetryEvent.count()).resolves.toBeTypeOf("number");
  });

  // B1 W4 (DEC-082): KillSwitch/FeatureFlag are the deliberate exception — they
  // are backoffice-WRITTEN but app-READABLE. The send boundary (RLS-subject app
  // role) READS KillSwitch to enforce the kill switch, so the app keeps SELECT
  // but loses every write. This is NOT the fully-revoked pattern of the tables
  // above; pinning both halves guards against a copy-paste REVOKE ALL regression.
  it("app role CAN read KillSwitch/FeatureFlag (SELECT kept — the boundary reads them)", async () => {
    // Seed one of each via the ONLY writer (the backoffice role).
    await backoffice.killSwitch.create({
      data: { agencyId, channel: `email-${suffix}`, active: true, reason: "rls pin" },
    });
    await backoffice.featureFlag.create({
      data: { workspaceId: wsA, key: `pin-${suffix}`, enabled: true },
    });
    // The app role reads them (no throw) — this is what `assertChannelLive` and
    // the feature gates depend on.
    const ks = await app.killSwitch.findMany({ where: { agencyId } });
    expect(ks.length).toBeGreaterThan(0);
    const ff = await app.featureFlag.findMany({ where: { workspaceId: wsA } });
    expect(ff.length).toBeGreaterThan(0);
  });

  it("app role CANNOT write KillSwitch/FeatureFlag (INSERT/UPDATE/DELETE REVOKEd)", async () => {
    await expect(
      app.killSwitch.create({
        data: { agencyId, channel: `sms-${suffix}`, active: true, reason: "should fail" },
      }),
    ).rejects.toThrow();
    await expect(
      app.featureFlag.create({ data: { workspaceId: wsA, key: `nope-${suffix}`, enabled: true } }),
    ).rejects.toThrow();
  });

  it("backoffice role can read + write KillSwitch/FeatureFlag", async () => {
    await expect(backoffice.killSwitch.count()).resolves.toBeTypeOf("number");
    await expect(backoffice.featureFlag.count()).resolves.toBeTypeOf("number");
  });
});
