/**
 * B5 (DEC-130) form-spine e2e in a fresh workspace:
 *  - CRUD: create draft → publish mints the ONE public credential → the list
 *    carries real counts;
 *  - the public rail serves the SERVER-owned spec only while live, validates
 *    required + choice membership, and refuses a taken-down form;
 *  - a submit writes the contact (source "form", routed tag), the
 *    FormSubmission row, the IDEMPOTENT enrollment into the routed campaign,
 *    and publishes form.submitted.v1 — which the automations engine's
 *    lead_captured trigger matches (asserted at the match layer end-to-end
 *    via the event row; engine execution is covered by its own suite);
 *  - a repeat submit with the same email dedupes onto the SAME contact and
 *    never stacks a second enrollment.
 * Skips without Postgres.
 */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import { AppModule } from "../src/app.module";
import { signDevToken } from "../src/auth/dev-token-verifier";

const hasDb = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
const SECRET = process.env.AUTH_DEV_SECRET ?? "test-dev-secret";
const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

describe.skipIf(!hasDb)("Form spine e2e", () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let agencyId: string;
  let ws: string;
  let agentId: string;
  let campaignId: string;
  let userIds: string[] = [];
  let ownerToken: string;
  let formId: string;
  let publicId: string;

  const api = () => request(app.getHttpServer());
  const asOwner = () => ({ Authorization: `Bearer ${ownerToken}`, "x-workspace-id": ws });

  beforeAll(async () => {
    process.env.AUTH_DEV_SECRET = SECRET;
    owner = createPrismaClient();
    const agency = await owner.agency.create({
      data: { name: `fm-${suffix}`, slug: `fm-${suffix}`, branding: {} },
    });
    agencyId = agency.id;
    ws = (
      await owner.workspace.create({
        data: { agencyId, name: "FM", slug: `fm-ws-${suffix}`, settings: {} },
      })
    ).id;
    const agent = await owner.agent.create({
      data: { workspaceId: ws, name: "Form intake", goal: "book_appointments", guardrails: {} },
    });
    agentId = agent.id;
    campaignId = (
      await owner.campaign.create({
        data: { workspaceId: ws, agentId, name: "intake — primary", graphId: "" },
      })
    ).id;
    const u1 = await owner.user.create({
      data: { email: `fm-owner-${suffix}@t.test`, authProviderId: `auth|fm-owner-${suffix}` },
    });
    await owner.membership.create({ data: { userId: u1.id, workspaceId: ws, role: "OWNER" } });
    userIds = [u1.id];
    ownerToken = await signDevToken(SECRET, { sub: `auth|fm-owner-${suffix}`, email: u1.email });

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (owner && agencyId) {
      await owner.agency.delete({ where: { id: agencyId } }).catch(() => undefined);
      await owner.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await owner?.$disconnect();
  });

  it("create → publish mints the credential; the list carries real counts", async () => {
    const created = await api()
      .post("/forms")
      .set(asOwner())
      .send({
        title: "Book a time",
        intro: "It takes a minute.",
        submitLabel: "Book it",
        fields: [
          { key: "name", label: "Your name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
          { key: "topic", label: "What about?", type: "choice", required: true, options: ["A quote", "A question"] },
        ],
        // The write-side agent hint resolves to the campaign server-side.
        routing: { agentId, tag: "from-form" },
      })
      .expect(201);
    formId = created.body.id;
    expect(created.body.status).toBe("draft");
    expect(created.body.publicId).toBeNull();
    expect(created.body.routing.campaignId).toBe(campaignId);
    expect(created.body.routing.agentId).toBeUndefined();

    // Draft = no public spec.
    const detail0 = await api().get(`/forms/${formId}`).set(asOwner()).expect(200);
    expect(detail0.body.responses).toBe(0);

    const published = await api()
      .patch(`/forms/${formId}`)
      .set(asOwner())
      .send({ status: "live" })
      .expect(200);
    publicId = published.body.publicId;
    expect(publicId).toMatch(/^frm_[a-z0-9]{8,32}$/);

    const list = await api().get("/forms").set(asOwner()).expect(200);
    const row = list.body.forms.find((f: { id: string }) => f.id === formId);
    expect(row.responses).toBe(0);
    expect(row.status).toBe("live");
  });

  it("the public rail serves the spec only while live and validates per the server's spec", async () => {
    const spec = await api().get(`/forms/v1/${publicId}`).expect(200);
    expect(spec.body.title).toBe("Book a time");
    expect(spec.body.fields).toHaveLength(3);

    // Required missing → typed visitor-safe refusal.
    await api()
      .post(`/forms/v1/${publicId}/submit`)
      .send({ answers: { name: "Ana Ivers" } })
      .expect(422);
    // A choice outside the offered options → refusal.
    await api()
      .post(`/forms/v1/${publicId}/submit`)
      .send({ answers: { name: "Ana Ivers", email: `ana-${suffix}@t.test`, topic: "Nonsense" } })
      .expect(422);
  });

  it("a submit writes contact + submission + idempotent enrollment and publishes form.submitted.v1", async () => {
    const email = `ana-${suffix}@t.test`;
    await api()
      .post(`/forms/v1/${publicId}/submit`)
      .send({ answers: { name: "Ana Ivers", email, topic: "A quote" } })
      .expect(201);

    const contact = await owner.contact.findFirst({ where: { workspaceId: ws, email } });
    expect(contact).not.toBeNull();
    expect(contact!.source).toBe("form");
    expect(contact!.tags).toContain("from-form");
    expect(contact!.firstName).toBe("Ana");

    const sub = await owner.formSubmission.findFirst({
      where: { formId, contactId: contact!.id },
    });
    expect((sub!.answers as { topic?: string }).topic).toBe("A quote");

    const enrollment = await owner.enrollment.findFirst({
      where: { workspaceId: ws, campaignId, contactId: contact!.id },
    });
    expect(enrollment).not.toBeNull();
    expect((enrollment!.meta as { source?: string }).source).toBe("form");

    const ev = await owner.event.findFirst({
      where: { workspaceId: ws, type: "form.submitted.v1" },
    });
    expect(ev!.payload).toMatchObject({ formId, routedTo: campaignId });
    expect(ev!.contactId).toBe(contact!.id);

    // Same email again: SAME contact, ONE enrollment, second submission row.
    await api()
      .post(`/forms/v1/${publicId}/submit`)
      .send({ answers: { name: "Ana Ivers", email, topic: "A question" } })
      .expect(201);
    expect(await owner.contact.count({ where: { workspaceId: ws, email } })).toBe(1);
    expect(
      await owner.enrollment.count({ where: { workspaceId: ws, campaignId, contactId: contact!.id } }),
    ).toBe(1);
    expect(await owner.formSubmission.count({ where: { formId } })).toBe(2);
  });

  it("taking the form down closes the public rail honestly", async () => {
    await api().patch(`/forms/${formId}`).set(asOwner()).send({ status: "draft" }).expect(200);
    await api().get(`/forms/v1/${publicId}`).expect(404);
    await api()
      .post(`/forms/v1/${publicId}/submit`)
      .send({ answers: { name: "Late Arrival" } })
      .expect(404);
  });
});
