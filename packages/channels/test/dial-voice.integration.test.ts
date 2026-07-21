/**
 * P3.1 (DEC-078) dial-boundary integration: the voice rails end-to-end
 * against Postgres — happy clearance, then the full refusal matrix in the
 * send-sms rail order: tenant suspension (DEC-079, first gate) → no phone →
 * language gate (D8) → calling window → per-campaign cap → opt-out/suppression
 * (D5: sms consent blocks voice too — the number is shared) → allow-list.
 * Skips without infra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createAppPrismaClient,
  createPrismaClient,
  withTenant,
  type PrismaClient,
} from "@clientforce/db";
import { assertDialAllowed, DEFAULT_VOICE_DAILY_CAP, type DialVoiceDeps } from "../src/dial-voice";
import { SendBlockedError } from "../src/types";

const hasInfra = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const PHONE = "+15005559876";
/** Tuesday 10:00 UTC — inside the Mon–Fri 09:00–17:00 UTC window. */
const IN_WINDOW = () => new Date("2026-07-07T10:00:00Z");
/** Sunday 03:00 UTC — outside it. */
const OUT_OF_WINDOW = () => new Date("2026-07-05T03:00:00Z");

const GUARDRAILS = {
  sendingWindow: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timezone: "UTC" },
  dailyCap: { email: 10, voice: 2 },
  consent: null,
  unsubscribeFooter: true,
  suppressionCheck: true,
};

describe.skipIf(!hasInfra)("assertDialAllowed boundary integration", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let contactId: string;

  const deps = (over: Partial<DialVoiceDeps> = {}): DialVoiceDeps => ({
    prisma: app,
    now: IN_WINDOW,
    allowlist: [PHONE],
    ...over,
  });
  const base = () => ({ workspaceId: ws, campaignId, agentId, contactId });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `voice-${suffix}`, slug: `voice-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    const workspace = await owner.workspace.create({
      data: { agencyId, name: "voice", slug: `voice-ws-${suffix}`, settings: {} },
    });
    ws = workspace.id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Voice Agent", goal: "book_appointments", guardrails: GUARDRAILS },
    });
    agentId = agent.id;
    const campaign = await owner.campaign.create({
      data: { workspaceId: ws, agentId, name: "primary", graphId: "" },
    });
    campaignId = campaign.id;
    const contact = await owner.contact.create({
      data: {
        workspaceId: ws,
        source: "test",
        optOut: {},
        tags: [],
        email: `voice-${suffix}@t.test`,
        phone: PHONE,
        firstName: "Sam",
      },
    });
    contactId = contact.id;
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  const reasonOf = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return "(allowed)";
    } catch (err) {
      if (err instanceof SendBlockedError) return err.reason;
      throw err;
    }
  };

  it("happy path: clears with the normalized phone, guardrails, and English", async () => {
    const clearance = await assertDialAllowed(deps(), base());
    expect(clearance.phone).toBe(PHONE);
    expect(clearance.language).toBe("en");
    expect(clearance.guardrails.dailyCap.voice).toBe(2);
  });

  it("TENANT_SUSPENDED (DEC-079): a suspended workspace — or agency — never dials", async () => {
    await owner.workspace.update({ where: { id: ws }, data: { status: "SUSPENDED" } });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("TENANT_SUSPENDED");
    await owner.workspace.update({ where: { id: ws }, data: { status: "ACTIVE" } });
    await owner.agency.update({ where: { id: agencyId }, data: { status: "SUSPENDED" } });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("TENANT_SUSPENDED");
    await owner.agency.update({ where: { id: agencyId }, data: { status: "ACTIVE" } });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("(allowed)");
  });

  it('CHANNEL_KILLED (DEC-082 ride-along): an ACTIVE agency "voice" kill switch blocks the dial', async () => {
    await owner.killSwitch.create({
      data: { agencyId, channel: "voice", active: true, reason: "abuse review" },
    });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("CHANNEL_KILLED");
    await owner.killSwitch.update({
      where: { agencyId_channel: { agencyId, channel: "voice" } },
      data: { active: false },
    });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("(allowed)");
    await owner.killSwitch.deleteMany({ where: { agencyId } });
  });

  it("CONTACT_NO_PHONE: a contact without a phone never dials", async () => {
    const noPhone = await owner.contact.create({
      data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `np-${suffix}@t.test` },
    });
    expect(await reasonOf(assertDialAllowed(deps(), { ...base(), contactId: noPhone.id }))).toBe(
      "CONTACT_NO_PHONE",
    );
  });

  it("VOICE_LANGUAGE_UNSUPPORTED (D8): a German agent refuses honestly — Aura-2 is English-only", async () => {
    const de = await owner.agent.create({
      data: {
        workspaceId: ws,
        name: "Termine",
        goal: "book_appointments",
        guardrails: { ...GUARDRAILS, language: "de", languageSource: "owner" },
      },
    });
    expect(await reasonOf(assertDialAllowed(deps(), { ...base(), agentId: de.id }))).toBe(
      "VOICE_LANGUAGE_UNSUPPORTED",
    );
  });

  it("OUTSIDE_SENDING_WINDOW: tz-aware calling window (agent guardrails tz — D6)", async () => {
    expect(await reasonOf(assertDialAllowed(deps({ now: OUT_OF_WINDOW }), base()))).toBe(
      "OUTSIDE_SENDING_WINDOW",
    );
  });

  it("DAILY_CAP_REACHED: today's OUTBOUND Call rows count against guardrails.dailyCap.voice", async () => {
    const today = IN_WINDOW();
    await withTenant(app, { workspaceId: ws }, (tx) =>
      tx.call.createMany({
        data: [1, 2].map((n) => ({
          workspaceId: ws,
          campaignId,
          agentId,
          contactId,
          direction: "OUTBOUND" as const,
          status: "COMPLETED" as const,
          providerCallSid: `CA-cap-${suffix}-${n}`,
          createdAt: today,
        })),
      }),
    );
    // now() is the same day the rows were created on — cap of 2 is met.
    expect(await reasonOf(assertDialAllowed(deps({ now: () => new Date("2026-07-07T11:00:00Z") }), base()))).toBe(
      "DAILY_CAP_REACHED",
    );
    await withTenant(app, { workspaceId: ws }, (tx) =>
      tx.call.deleteMany({ where: { campaignId } }),
    );
    expect(DEFAULT_VOICE_DAILY_CAP).toBe(20);
  });

  it("OPTED_OUT (D5): sms opt-out blocks the dial — the phone number is shared", async () => {
    await owner.contact.update({ where: { id: contactId }, data: { optOut: { sms: true } } });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("OPTED_OUT");
    await owner.contact.update({ where: { id: contactId }, data: { optOut: { voice: true } } });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("OPTED_OUT");
    await owner.contact.update({ where: { id: contactId }, data: { optOut: {} } });
  });

  it("SUPPRESSED (D5): an sms-channel Suppression row blocks voice too — fails toward suppression", async () => {
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "sms", address: PHONE, reason: "UNSUBSCRIBED" },
    });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("SUPPRESSED");
    await owner.suppression.deleteMany({ where: { workspaceId: ws, address: PHONE } });
    await owner.suppression.create({
      data: { workspaceId: ws, channel: "voice", address: PHONE, reason: "MANUAL" },
    });
    expect(await reasonOf(assertDialAllowed(deps(), base()))).toBe("SUPPRESSED");
    await owner.suppression.deleteMany({ where: { workspaceId: ws, address: PHONE } });
  });

  it("RECIPIENT_NOT_ALLOWLISTED: a non-empty allow-list gates; empty = no restriction (sandbox is the guard)", async () => {
    expect(
      await reasonOf(assertDialAllowed(deps({ allowlist: ["+15005550000"] }), base())),
    ).toBe("RECIPIENT_NOT_ALLOWLISTED");
    expect(await reasonOf(assertDialAllowed(deps({ allowlist: [] }), base()))).toBe("(allowed)");
  });
});
