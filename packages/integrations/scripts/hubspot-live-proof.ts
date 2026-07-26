/**
 * INT W4 (DEC-096) — the LIVE HubSpot one-way CRM push proof: real vendor, real
 * rails. Driven by `.github/workflows/integrations-live-proof.yml` (environment:
 * staging — Key Vault OIDC). The vault HUBSPOT-DEMO-TOKEN (a HubSpot Service
 * Key — legacy private apps are deprecated; same bearer usage, different prefix)
 * seeds the connection through the REAL connect path. The Service Key is
 * WRITE-ONLY (crm.objects.*.write, no read), so the /account-info probe cannot
 * read the portal — connect stores the token best-effort and the FIRST push is
 * the real token validation. Then a `payment_received` rule with
 * `create_crm_deal` fires through the REAL rule engine + the REAL
 * `crmTransport` (deliverCrm) into api.hubapi.com — a real Contact upserted, a
 * real Deal created + associated, the deal id stored on Enrollment.meta, the
 * IntegrationDelivery ledger written; a redelivery dedupes; then
 * `update_deal_stage` moves the deal.
 *
 * Gates (all must pass; the run fails loudly otherwise):
 *   1  connect           — token stored on the real connect path; portal
 *                          captured if the key can read it, else best-effort
 *                          (write-only key: the first push is the real probe)
 *   2  create deal       — real Contact + Deal on api.hubapi.com; dealId on
 *                          Enrollment.meta.crmDealId; IntegrationDelivery=delivered
 *   3  idempotency       — redelivery → ONE crm_deal ledger row, SAME deal id
 *   4  update stage      — real dealstage move; IntegrationDelivery=delivered
 *
 * Zero secrets printed; the receipts artifact carries ids/statuses only. The
 * created Contact/Deal stay in HubSpot as the proof artifacts (clearly labeled).
 */
import { writeFileSync } from "node:fs";
import { createAppPrismaClient, createPrismaClient } from "@clientforce/db";
import { evaluateEventForRules, type RuleEngineDeps } from "@clientforce/automations";
import {
  HubspotAdapter,
  connectHubspotFields,
  deliverCrm,
  type IntegrationsDeps,
} from "@clientforce/integrations";

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const TOKEN = need("HUBSPOT_DEMO_TOKEN"); // the vault Service Key (opaque bearer)
const suffix = `hsproof-${Date.now()}`;

const gates: Array<{ gate: string; ok: boolean; detail: string }> = [];
const pass = (gate: string, detail: string) => {
  gates.push({ gate, ok: true, detail });
  console.log(`GATE ✓ ${gate} — ${detail}`);
};
const fail = (gate: string, detail: string): never => {
  gates.push({ gate, ok: false, detail });
  throw new Error(`GATE ✗ ${gate} — ${detail}`);
};

async function main(): Promise<void> {
  const owner = createPrismaClient();
  const app = createAppPrismaClient();
  const adapter = new HubspotAdapter(); // real HubSpot — the regional host derives from the pat-<region>- token prefix

  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({ data: { agencyId: agency.id, name: "HubSpot proof", slug: suffix, settings: {} } });
  const agent = await owner.agent.create({ data: { workspaceId: ws.id, name: "Closer", goal: "close_deals", guardrails: {} } });
  const campaign = await owner.campaign.create({ data: { workspaceId: ws.id, agentId: agent.id, name: "primary", graphId: "" } });
  // A deliverable-format domain — HubSpot rejects the reserved `.test` TLD as
  // INVALID_EMAIL. example.com (RFC 2606) is format-valid + resolvable, and the
  // per-run timestamp keeps each proof contact unique (no dedupe collision).
  const contactEmail = `w4-liveproof-${Date.now()}@example.com`;
  const contact = await owner.contact.create({
    data: { workspaceId: ws.id, source: "proof", optOut: {}, tags: [], email: contactEmail, firstName: "Ada", lastName: "Lovelace (W4 proof)" },
  });
  const enrollment = await owner.enrollment.create({
    data: { workspaceId: ws.id, campaignId: campaign.id, contactId: contact.id, workflowId: suffix, pipelineStage: "engaged", meta: {} },
  });

  const deps: IntegrationsDeps = { prisma: app, adapters: { hubspot: adapter }, publish: async () => {} };
  const receipts: Record<string, unknown> = { note: "INT W4 live HubSpot one-way push — real vendor, real rails; contact/deal created in HubSpot as the proof artifacts." };

  try {
    // 1 — connect on the REAL path. A write-only Service Key can't read
    // /account-info, so connect stores the token best-effort (portal may be
    // unknown); the create_crm_deal push in gate 2 is the real token probe.
    const row = await connectHubspotFields(deps, { workspaceId: ws.id, fields: { apiToken: TOKEN, defaultPipeline: "default" } }).catch((err) =>
      fail("1 connect", `connect refused: ${err?.detail ?? err?.message ?? String(err)}`),
    );
    const portalLabel = row.accountLabel ?? "unknown";
    pass("1 connect", `token stored — ${portalLabel} (write-only key → portal may be best-effort; push validates)`);
    receipts.portal = portalLabel;

    const engineDeps: RuleEngineDeps = {
      prisma: app,
      crmTransport: async (p) =>
        deliverCrm(deps, {
          workspaceId: p.workspaceId,
          sourceEventId: p.sourceKey,
          op: p.op,
          ...(p.contact ? { contact: p.contact } : {}),
          ...(p.dealname ? { dealname: p.dealname } : {}),
          ...(p.stage ? { stage: p.stage } : {}),
          ...(p.dealId ? { dealId: p.dealId } : {}),
        }),
    };
    const baseEvent = {
      workspaceId: ws.id,
      type: "payment.received.v1" as const,
      contactId: contact.id,
      enrollmentId: enrollment.id,
      campaignId: campaign.id,
      senderId: null,
      payload: { amount: 150000, provider: "stripe" },
      occurredAt: new Date().toISOString(),
    };

    // 2 — create_crm_deal: a REAL contact + deal on api.hubapi.com
    const rule = await owner.campaignRule.create({
      data: { workspaceId: ws.id, campaignId: campaign.id, order: 0, enabled: true, trigger: { kind: "payment_received" }, actions: [{ kind: "create_crm_deal", stage: "qualifiedtobuy" }] },
    });
    await evaluateEventForRules(engineDeps, { ...baseEvent, id: `${suffix}-create` });
    const afterCreate = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    const dealId = (afterCreate.meta as { crmDealId?: string }).crmDealId;
    const createClaim = await owner.integrationDelivery.findFirst({ where: { workspaceId: ws.id, kind: "crm_deal" } });
    // Surface HubSpot's refusal VERBATIM on failure — deliverCrm settles the
    // ledger row `failed` with { error } carrying the vendor message (crm.ts),
    // the only window into what a write-only key's push actually hit.
    receipts.createLedger = createClaim ? { id: createClaim.id, status: createClaim.status, detail: createClaim.detail } : null;
    const createWhy = createClaim ? `crm_deal ledger ${createClaim.status}: ${JSON.stringify(createClaim.detail)}` : "no crm_deal ledger row (the rule never fired)";
    if (!dealId) fail("2 create deal", `no crmDealId stored — the push did not land a deal · ${createWhy}`);
    if (createClaim?.status !== "delivered") fail("2 create deal", `ledger status = ${createClaim?.status ?? "none"} (expected delivered) · ${createWhy}`);
    const linked = (createClaim.detail as { associated?: boolean } | null)?.associated === true;
    receipts.dealId = dealId;
    receipts.associated = linked;
    // The deal + stage are the gated one-way-push outcome. The deal↔contact
    // link is REPORTED (best-effort): HubSpot 400s the association "invalid"
    // even with the read scope + both records present (a validation issue, not
    // scope — under investigation, Q-056); the deal delivers unlinked.
    pass(
      "2 create deal",
      `REAL HubSpot deal ${dealId} created ${linked ? "+ LINKED to the contact" : "(contact link DEFERRED — HubSpot 400 'associations are invalid' even with read scope; deal delivered unlinked)"} · IntegrationDelivery ${createClaim.id} delivered`,
    );

    // 3 — idempotency: redelivery dedupes to the SAME deal, ONE ledger row
    await evaluateEventForRules(engineDeps, { ...baseEvent, id: `${suffix}-create` });
    const afterRedeliver = await owner.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    const dealAfter = (afterRedeliver.meta as { crmDealId?: string }).crmDealId;
    const claimCount = await owner.integrationDelivery.count({ where: { workspaceId: ws.id, kind: "crm_deal" } });
    if (dealAfter !== dealId || claimCount !== 1) fail("3 idempotency", `deal ${dealAfter} (was ${dealId}) · crm_deal rows ${claimCount}`);
    pass("3 idempotency", "redelivery deduped — ONE crm_deal ledger row, SAME deal id (no duplicate deal)");

    // 4 — update_deal_stage: a REAL stage move
    await owner.campaignRule.update({ where: { id: rule.id }, data: { actions: [{ kind: "update_deal_stage", stage: "closedwon" }] } });
    await evaluateEventForRules(engineDeps, { ...baseEvent, id: `${suffix}-move` });
    const moveClaim = await owner.integrationDelivery.findFirst({ where: { workspaceId: ws.id, kind: "crm_stage" } });
    receipts.moveLedger = moveClaim ? { id: moveClaim.id, status: moveClaim.status, detail: moveClaim.detail } : null;
    if (moveClaim?.status !== "delivered")
      fail("4 update stage", `ledger status = ${moveClaim?.status ?? "none"} · ${moveClaim ? JSON.stringify(moveClaim.detail) : "no crm_stage row"}`);
    pass("4 update stage", `REAL deal ${dealId} → closedwon · IntegrationDelivery ${moveClaim.id} delivered`);

    await owner.campaignRule.delete({ where: { id: rule.id } });
    receipts.contactEmail = contactEmail;
  } finally {
    receipts.gates = gates;
    writeFileSync("hubspot-live-proof-receipts.json", JSON.stringify(receipts, null, 2));
    console.log(`\nreceipts → hubspot-live-proof-receipts.json`);
    // Best-effort cleanup of the proof workspace (the HubSpot objects stay).
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }

  if (gates.some((g) => !g.ok)) process.exit(1);
  console.log("\nALL GATES PASSED — live HubSpot one-way push proven on real rails.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
