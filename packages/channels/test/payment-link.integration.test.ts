/**
 * INT W3 (DEC-095) vs REAL Postgres + RLS: the payment-link plumbing — the
 * booking-link twin with its ONE deliberate difference: NO ambient talking
 * point. The link enters copy ONLY via the send_payment_link flag (→ mustSay
 * on the next composed send, grounded by the same substring) or the scripted
 * `{{paymentLink}}` token (missing config → MissingTokenError, the house
 * rule); the boundary clears the flag once a sent body carried the link.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAppPrismaClient, createPrismaClient, type PrismaClient } from "@clientforce/db";
import {
  augmentBriefWithPaymentLink,
  clearPaymentLinkFlagAfterSend,
  renderTokens,
  resolvePaymentLink,
  withClientReference,
} from "../src/index";
import { MissingTokenError } from "../src/render";

process.env.FIELD_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const suffix = `payl-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const LINK = "https://buy.stripe.com/demo123";

const BRIEF = { objective: "Collect the audit fee", talkingPoints: ["the audit is complete"] };

describe.skipIf(!hasDb)("payment-link plumbing (INT W3)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let agencyId: string;
  let ws: string;
  let contactId: string;
  let enrollmentId: string;
  let fullLink: string;

  const connectStripe = () =>
    owner.integration.create({
      data: {
        workspaceId: ws,
        provider: "stripe",
        status: "connected",
        config: { paymentLinkUrl: LINK },
        scopes: [],
      },
    });

  beforeAll(async () => {
    owner = createPrismaClient();
    app = createAppPrismaClient();
    const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
    agencyId = agency.id;
    ws = (await owner.workspace.create({ data: { agencyId, name: "pl", slug: suffix, settings: {} } })).id;
    const agentId = (
      await owner.agent.create({ data: { workspaceId: ws, name: "Closer", goal: "close_deals", guardrails: {} } })
    ).id;
    const campaignId = (
      await owner.campaign.create({ data: { workspaceId: ws, agentId, name: "primary", graphId: "" } })
    ).id;
    contactId = (
      await owner.contact.create({
        data: { workspaceId: ws, source: "test", optOut: {}, tags: [], email: `ada-${suffix}@t.test`, firstName: "Ada" },
      })
    ).id;
    enrollmentId = (
      await owner.enrollment.create({
        data: { workspaceId: ws, campaignId, contactId, workflowId: `pl-${suffix}`, pipelineStage: "engaged", meta: {} },
      })
    ).id;
    fullLink = withClientReference(LINK, contactId);
  });

  beforeEach(async () => {
    await owner.integration.deleteMany({ where: { workspaceId: ws } });
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { meta: {} } });
  });

  afterAll(async () => {
    await owner.agency.delete({ where: { id: agencyId } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  });

  it("resolvePaymentLink appends client_reference_id; unconfigured/revoked → null", async () => {
    expect(await resolvePaymentLink(app, ws, contactId)).toBeNull();
    await connectStripe();
    expect(await resolvePaymentLink(app, ws, contactId)).toBe(`${LINK}?client_reference_id=${contactId}`);
    await owner.integration.updateMany({ where: { workspaceId: ws }, data: { status: "revoked" } });
    expect(await resolvePaymentLink(app, ws, contactId)).toBeNull();
  });

  it("NO flag → the brief passes through UNTOUCHED even when configured (never an ambient payment ask)", async () => {
    await connectStripe();
    const out = await augmentBriefWithPaymentLink({ prisma: app }, { workspaceId: ws, contactId, enrollmentId }, BRIEF);
    expect(out).toEqual(BRIEF);
  });

  it("flag set + configured → the FULL per-lead link joins mustSay; unconfigured keeps the flag honest", async () => {
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { meta: { paymentLinkRequested: true } } });
    // Unconfigured: pass-through, the flag survives for a later configured send.
    const bare = await augmentBriefWithPaymentLink({ prisma: app }, { workspaceId: ws, contactId, enrollmentId }, BRIEF);
    expect(bare).toEqual(BRIEF);

    await connectStripe();
    const out = await augmentBriefWithPaymentLink({ prisma: app }, { workspaceId: ws, contactId, enrollmentId }, BRIEF);
    expect(out.mustSay).toEqual([fullLink]);
    expect(out.talkingPoints).toEqual(BRIEF.talkingPoints); // never an ambient point
  });

  it("clearPaymentLinkFlagAfterSend clears ONLY when the sent body carried the base link", async () => {
    await connectStripe();
    await owner.enrollment.update({ where: { id: enrollmentId }, data: { meta: { paymentLinkRequested: true } } });

    await clearPaymentLinkFlagAfterSend(app, { workspaceId: ws, enrollmentId, sentBody: "no link here" });
    let meta = (await owner.enrollment.findUnique({ where: { id: enrollmentId } }))!.meta as Record<string, unknown>;
    expect(meta.paymentLinkRequested).toBe(true);

    await clearPaymentLinkFlagAfterSend(app, {
      workspaceId: ws,
      enrollmentId,
      sentBody: `Pay here: ${fullLink} — thanks!`,
    });
    meta = (await owner.enrollment.findUnique({ where: { id: enrollmentId } }))!.meta as Record<string, unknown>;
    expect(meta.paymentLinkRequested).toBeUndefined();
  });

  it("{{paymentLink}} renders the resolved link; an undefined value throws MissingTokenError (house rule)", () => {
    const contact = { firstName: "Ada", lastName: null, company: null, email: "a@t.test", custom: null };
    expect(renderTokens("Pay: {{paymentLink}}", contact, "Maya", { paymentLink: fullLink })).toBe(`Pay: ${fullLink}`);
    expect(() => renderTokens("Pay: {{paymentLink}}", contact, "Maya", {})).toThrowError(MissingTokenError);
  });
});
