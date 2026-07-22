/**
 * One-way CRM push (INT W4, DEC-096) — the `create_crm_deal` / `update_deal_stage`
 * actions' transport, on the SAME claim-then-send / allowance-brake rails as the
 * Slack notifier and the webhook deliverer (the ledger + audit ride the
 * `hubspot` Integration row). A delivery failure NEVER changes the rule-run
 * outcome — the caller (the engine's crmTransport seam) records the created deal
 * id or the typed refusal and moves on. Push is ONE-WAY: no reconciliation of
 * external HubSpot edits (two-way = a recorded Q).
 */
import { hubspotConfigSchema } from "@clientforce/core";
import { EVENT_TYPES } from "@clientforce/events";
import { withTenant, Prisma } from "@clientforce/db";
import { INBOUND_DELIVERY_KINDS, INTEGRATION_DAILY_DELIVERY_ALLOWANCE, utcDayStart } from "./constants";
import { decryptCredentials } from "./service";
import { HubspotAdapter } from "./hubspot";
import { IntegrationDeliveryError, IntegrationProviderError, type IntegrationsDeps } from "./types";

export type CrmOp = "create_deal" | "update_stage";

export interface CrmPushResult {
  delivered: boolean;
  /** The HubSpot deal id (create → the new id; update → the moved deal). */
  dealId?: string;
  /** Redacted-safe outcome detail for the run row. */
  detail?: string;
}

export interface CrmPushInput {
  workspaceId: string;
  op: CrmOp;
  /** Dedupe key — `<eventId>#rule:<id>#a:<i>` (the action-path convention). */
  sourceEventId: string;
  /** Required for create_deal (the upsert); ignored for update_stage. */
  contact?: { email: string; firstName?: string | null; lastName?: string | null; company?: string | null };
  /** create_deal: the deal name (executor-derived); ignored for update_stage. */
  dealname?: string;
  /** The target dealstage — optional for create (pipeline default), required for update. */
  stage?: string;
  /** update_stage: the stored HubSpot deal id (from Enrollment.meta.crmDealId). */
  dealId?: string;
}

const kindFor = (op: CrmOp): string => (op === "create_deal" ? "crm_deal" : "crm_stage");

export async function deliverCrm(deps: IntegrationsDeps, input: CrmPushInput): Promise<CrmPushResult> {
  const log = deps.log ?? console.warn;
  const adapter = deps.adapters.hubspot as unknown as HubspotAdapter | undefined;
  if (!adapter) return { delivered: false, detail: "hubspot adapter not wired" };

  const row = await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
    tx.integration.findUnique({
      where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "hubspot" } },
    }),
  );
  if (!row) return { delivered: false, detail: "HubSpot not connected" };
  if (row.status === "revoked") return { delivered: false, detail: "HubSpot token revoked — reconnect to resume" };
  const config = hubspotConfigSchema.safeParse(row.config);
  const defaultPipeline = config.success ? config.data.defaultPipeline : undefined;
  const creds = decryptCredentials(row);

  // update_stage with no stored deal is a typed refusal, never a silent no-op.
  if (input.op === "update_stage" && !input.dealId) {
    return { delivered: false, detail: "no HubSpot deal on this contact yet — add a Create CRM deal step first" };
  }

  const now = (deps.now ?? (() => new Date()))();
  const dayStart = utcDayStart(now);
  const allowance = deps.config?.dailyDeliveryAllowance ?? INTEGRATION_DAILY_DELIVERY_ALLOWANCE;
  const attemptsToday = await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
    tx.integrationDelivery.count({
      where: {
        workspaceId: input.workspaceId,
        createdAt: { gte: dayStart },
        status: { in: ["delivered", "failed"] },
        kind: { notIn: [...INBOUND_DELIVERY_KINDS] },
      },
    }),
  );
  if (attemptsToday >= allowance) {
    const heldBefore = await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
      tx.integrationDelivery.count({
        where: { workspaceId: input.workspaceId, createdAt: { gte: dayStart }, status: "held", kind: { notIn: [...INBOUND_DELIVERY_KINDS] } },
      }),
    );
    const heldRow = await claimDelivery(deps, row.id, input, "held", { reason: "workspace_delivery_allowance" });
    if (!heldRow) return { delivered: false, detail: "duplicate delivery skipped" };
    if (heldBefore === 0) {
      console.error(
        `[integrations] COST ALERT: workspace ${input.workspaceId} hit the daily integration delivery allowance (${allowance}) — CRM pushes held for the day`,
      );
      await publishSafely(deps, {
        workspaceId: input.workspaceId,
        type: EVENT_TYPES.INTEGRATION_DELIVERY_HELD,
        payload: { provider: "hubspot", reason: "workspace_delivery_allowance" },
      });
    }
    return { delivered: false, detail: `held — daily delivery allowance (${allowance}) reached` };
  }

  // CLAIM before any network I/O (the at-most-once rail). A redelivery of a
  // create returns the already-created deal id (from the claim detail).
  const claimed = await claimDelivery(deps, row.id, input, "pending", {});
  if (!claimed) {
    const existing = await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
      tx.integrationDelivery.findUnique({
        where: {
          integrationId_sourceEventId_kind: { integrationId: row.id, sourceEventId: input.sourceEventId, kind: kindFor(input.op) },
        },
      }),
    );
    const priorDealId = ((existing?.detail ?? {}) as { dealId?: unknown }).dealId;
    return {
      delivered: existing?.status === "delivered",
      ...(typeof priorDealId === "string" ? { dealId: priorDealId } : {}),
      detail: existing?.status === "pending" ? "CRM push in flight" : "duplicate delivery skipped",
    };
  }
  const settle = (status: "delivered" | "failed", detail: Record<string, unknown>) =>
    withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
      tx.integrationDelivery.update({ where: { id: claimed.id }, data: { status, detail: detail as Prisma.InputJsonValue } }),
    );

  try {
    let dealId: string;
    if (input.op === "create_deal") {
      if (!input.contact?.email) {
        await settle("failed", { op: input.op, error: "no contact email" });
        return { delivered: false, detail: "no contact email — HubSpot needs an email to upsert the contact" };
      }
      const contactId = await adapter.upsertContact(creds, input.contact);
      dealId = await adapter.createDeal(creds, {
        dealname: input.dealname ?? `Deal — ${input.contact.email}`,
        ...(defaultPipeline ? { pipeline: defaultPipeline } : {}),
        ...(input.stage ? { stage: input.stage } : {}),
      });
      await adapter.associateDealToContact(creds, dealId, contactId);
    } else {
      dealId = input.dealId!;
      await adapter.updateDealStage(creds, dealId, input.stage!);
    }
    await settle("delivered", { op: input.op, dealId });
    await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { lastSyncAt: now } }),
    );
    await publishSafely(deps, {
      workspaceId: input.workspaceId,
      type: EVENT_TYPES.INTEGRATION_NOTIFIED,
      payload: { provider: "hubspot", kind: kindFor(input.op), sourceEventId: input.sourceEventId },
    });
    return { delivered: true, dealId, detail: input.op === "create_deal" ? `deal ${dealId} created` : `deal ${dealId} moved to ${input.stage}` };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await settle("failed", { op: input.op, error: detail });
    await publishSafely(deps, {
      workspaceId: input.workspaceId,
      type: EVENT_TYPES.INTEGRATION_SYNC_FAILED,
      payload: { provider: "hubspot", error: detail },
    });
    // A dead token flips the row to the honest revoked state (the delivery-time
    // PROVIDER_AUTH rail); config refusals + transient errors leave status alone.
    if (err instanceof IntegrationProviderError && err.code === "PROVIDER_AUTH" && row.status !== "revoked") {
      await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
        tx.integration.update({ where: { id: row.id }, data: { status: "revoked" } }),
      );
      await publishSafely(deps, {
        workspaceId: input.workspaceId,
        type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
        payload: { provider: "hubspot", from: row.status, to: "revoked" },
      });
    }
    if (!(err instanceof IntegrationDeliveryError) && !(err instanceof IntegrationProviderError)) {
      log(`[integrations] unexpected hubspot push failure: ${detail}`);
    }
    return { delivered: false, detail };
  }
}

/** Insert the unique delivery row; null = another run already owns the key. */
async function claimDelivery(
  deps: IntegrationsDeps,
  integrationId: string,
  input: CrmPushInput,
  status: "pending" | "held",
  detail: Record<string, unknown>,
): Promise<{ id: string } | null> {
  try {
    return await withTenant(deps.prisma, { workspaceId: input.workspaceId }, (tx) =>
      tx.integrationDelivery.create({
        data: {
          workspaceId: input.workspaceId,
          integrationId,
          sourceEventId: input.sourceEventId,
          kind: kindFor(input.op),
          status,
          detail: detail as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
    throw err;
  }
}

async function publishSafely(
  deps: IntegrationsDeps,
  input: Parameters<NonNullable<IntegrationsDeps["publish"]>>[0],
): Promise<void> {
  if (!deps.publish) return;
  try {
    await deps.publish(input);
  } catch (err) {
    (deps.log ?? console.warn)(`[integrations] event publish failed (${input.type}): ${err instanceof Error ? err.message : String(err)}`);
  }
}
