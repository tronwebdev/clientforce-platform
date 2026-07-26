/**
 * The workspace-notification consumer + the notify_team transport (INT W1,
 * DEC-093 — closes the Slack half of Q-042).
 *
 * One shared delivery path: idempotent per (integrationId, sourceEventId,
 * kind) via the IntegrationDelivery unique (redelivery-safe, the
 * CampaignRuleRun stance), allowance-braked (honest `held` rows + the
 * rising-edge cost alert), typed on failure (PROVIDER_AUTH flips the row to
 * `revoked` — the honest disconnected state — and says so on the ledger).
 * The consumer NEVER throws: a Slack outage must not dead-letter the bus.
 */
import { Prisma, withTenant } from "@clientforce/db";
import { EVENT_TYPES, type BusEvent, type ConsumerHook } from "@clientforce/events";
import { slackConfigSchema, type SlackNotificationKind } from "@clientforce/core";
import { INBOUND_DELIVERY_KINDS, INTEGRATION_DAILY_DELIVERY_ALLOWANCE, utcDayStart } from "./constants";
import { decryptCredentials, markRevoked } from "./service";
import type { SlackAdapter } from "./slack";
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type IntegrationRow,
  type IntegrationsDeps,
} from "./types";

/** notify_team rides the same path with its own kind (rule-driven, no toggle). */
export type DeliveryKind = SlackNotificationKind | "notify_team";

export interface DeliveryResult {
  delivered: boolean;
  /** Human-readable destination ("#clientforce-alerts"). */
  target?: string;
  detail?: string;
}

/** Map a bus event to the workspace-notification kind it announces (if any). */
export function matchNotificationKind(event: BusEvent): SlackNotificationKind | null {
  if (event.type.endsWith(".replied.v1")) return "new_reply";
  if (event.type === "call.booked.v1") return "meeting_booked";
  if (event.type === "lead.stage_changed.v1") {
    const payload = (event.payload ?? {}) as { toStage?: string; goalKey?: string };
    // A booked stage that IS the goal announces once — meeting_booked wins
    // (the matchTrigger meeting_booked precedent; outcomes.ts isGoal parity).
    if (payload.toStage === "booked") return "meeting_booked";
    if (typeof payload.goalKey === "string") return "goal_completed";
  }
  return null;
}

const contactLabel = (c: { firstName: string | null; lastName: string | null; email: string | null } | null): string | null => {
  if (!c) return null;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return name || c.email;
};

/** Deterministic owner-readable copy — never AI, never a secret. */
export function notificationText(
  kind: DeliveryKind,
  ctx: { contact?: string | null; intent?: string; label?: string; note?: string },
): string {
  switch (kind) {
    case "new_reply":
      return `↩ New reply${ctx.contact ? ` from ${ctx.contact}` : ""}${ctx.intent ? ` — ${ctx.intent.replace(/_/g, " ")}` : ""}`;
    case "meeting_booked":
      return `📅 Meeting booked${ctx.contact ? ` with ${ctx.contact}` : ""}`;
    case "goal_completed":
      return `🎯 Goal completed${ctx.label ? ` — ${ctx.label}` : ""}${ctx.contact ? ` (${ctx.contact})` : ""}`;
    case "notify_team":
      return `🔔 ${ctx.note?.trim() || "Automation rule fired"}${ctx.contact ? ` — ${ctx.contact}` : ""}`;
  }
}

async function lookupContact(
  deps: IntegrationsDeps,
  workspaceId: string,
  contactId: string | null | undefined,
): Promise<string | null> {
  if (!contactId) return null;
  try {
    const row = await withTenant(deps.prisma, { workspaceId }, (tx) =>
      tx.contact.findUnique({
        where: { id: contactId },
        select: { firstName: true, lastName: true, email: true },
      }),
    );
    return contactLabel(row);
  } catch {
    return null; // copy degrades gracefully — delivery still goes out
  }
}

/**
 * The ONE Slack delivery path (consumer + notify_team transport). Vendor
 * failures resolve to a typed result; DB failures DO propagate — the
 * consumer's outer catch is the load-bearing never-dead-letter rail.
 */
export async function deliverSlack(
  deps: IntegrationsDeps,
  params: {
    workspaceId: string;
    kind: DeliveryKind;
    text: string;
    /** Dedupe key — the bus event id (consumer) or `<eventId>#rule:<id>` (transport). */
    sourceEventId: string;
  },
): Promise<DeliveryResult> {
  const log = deps.log ?? console.warn;
  const adapter = deps.adapters.slack as SlackAdapter | undefined;
  if (!adapter) return { delivered: false, detail: "slack adapter not wired" };

  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.findUnique({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: "slack" } },
    }),
  );
  if (!row) return { delivered: false, detail: "slack not connected" };
  if (row.status === "revoked") return { delivered: false, detail: "slack token revoked — reconnect to resume" };

  const config = slackConfigSchema.safeParse(row.config);
  const channel = config.success ? config.data.channel : undefined;
  if (!channel) return { delivered: false, detail: "no Slack channel configured yet" };

  const now = (deps.now ?? (() => new Date()))();
  const dayStart = utcDayStart(now);

  const allowance = deps.config?.dailyDeliveryAllowance ?? INTEGRATION_DAILY_DELIVERY_ALLOWANCE;
  // Pending rows are in-flight claims, not attempts — only settled outcomes
  // count against the allowance. INBOUND ingest claims (kind `payment`) are
  // NOT outbound sends and must never brake the outbound budget (W3 fix).
  const attemptsToday = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integrationDelivery.count({
      where: {
        workspaceId: params.workspaceId,
        createdAt: { gte: dayStart },
        status: { in: ["delivered", "failed"] },
        kind: { notIn: [...INBOUND_DELIVERY_KINDS] },
      },
    }),
  );
  if (attemptsToday >= allowance) {
    const heldBefore = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integrationDelivery.count({
        where: {
          workspaceId: params.workspaceId,
          createdAt: { gte: dayStart },
          status: "held",
          kind: { notIn: [...INBOUND_DELIVERY_KINDS] },
        },
      }),
    );
    const heldRow = await recordDelivery(deps, row, params, "held", { reason: "workspace_delivery_allowance" });
    if (!heldRow) {
      return { delivered: false, detail: "duplicate delivery skipped" };
    }
    if (heldBefore === 0) {
      // Rising edge per hold episode — the vendor-spine cost alert.
      console.error(
        `[integrations] COST ALERT: workspace ${params.workspaceId} hit the daily integration delivery allowance (${allowance}) — Slack deliveries held for the day`,
      );
      await publishSafely(deps, {
        workspaceId: params.workspaceId,
        type: EVENT_TYPES.INTEGRATION_DELIVERY_HELD,
        payload: { provider: "slack", reason: "workspace_delivery_allowance" },
      });
    }
    return { delivered: false, detail: `held — daily delivery allowance (${allowance}) reached` };
  }

  // CLAIM before the vendor call (review-round hardening): the unique
  // (integrationId, sourceEventId, kind) row is inserted as `pending` first,
  // so a concurrent/bus redelivery loses the race BEFORE any post — at-most-
  // once toward Slack (a crash between claim and post costs one notification,
  // the right trade; the visible `pending` row is the honest record of it).
  const claimed = await recordDelivery(deps, row, params, "pending", {});
  if (!claimed) {
    const existing = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integrationDelivery.findUnique({
        where: {
          integrationId_sourceEventId_kind: {
            integrationId: row.id,
            sourceEventId: params.sourceEventId,
            kind: params.kind,
          },
        },
      }),
    );
    return {
      delivered: existing?.status === "delivered",
      target: `#${channel.name}`,
      detail: existing?.status === "pending" ? "delivery in flight" : "duplicate delivery skipped",
    };
  }
  const settle = (status: "delivered" | "failed", detail: Record<string, unknown>) =>
    withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integrationDelivery.update({
        where: { id: claimed.id },
        data: { status, detail: detail as Prisma.InputJsonValue },
      }),
    );

  try {
    await adapter.postMessage(decryptCredentials(row), { channelId: channel.id, text: params.text });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await settle("failed", { error: detail });
    await publishSafely(deps, {
      workspaceId: params.workspaceId,
      type: EVENT_TYPES.INTEGRATION_SYNC_FAILED,
      payload: { provider: "slack", error: detail },
    });
    if (err instanceof IntegrationProviderError && err.code === "PROVIDER_AUTH") {
      await markRevoked(deps, row, detail);
    } else if (!(err instanceof IntegrationDeliveryError) && !(err instanceof IntegrationProviderError)) {
      log(`[integrations] unexpected slack delivery failure: ${detail}`);
    }
    return { delivered: false, detail };
  }

  await settle("delivered", { channel: channel.name });
  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.update({ where: { id: row.id }, data: { lastSyncAt: now } }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_NOTIFIED,
    payload: {
      provider: "slack",
      kind: params.kind,
      target: `#${channel.name}`,
      sourceEventId: params.sourceEventId,
    },
  });
  return { delivered: true, target: `#${channel.name}` };
}

/** Insert the unique delivery row; null = another run already owns the key. */
async function recordDelivery(
  deps: IntegrationsDeps,
  row: IntegrationRow,
  params: { workspaceId: string; kind: DeliveryKind; sourceEventId: string },
  status: "pending" | "delivered" | "failed" | "held",
  detail: Record<string, unknown>,
): Promise<{ id: string } | null> {
  try {
    return await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integrationDelivery.create({
        data: {
          workspaceId: params.workspaceId,
          integrationId: row.id,
          sourceEventId: params.sourceEventId,
          kind: params.kind,
          status,
          detail: detail as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null; // raced redelivery
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
    (deps.log ?? console.warn)(
      `[integrations] event publish failed (${input.type}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Consumer #5: workspace notifications. Toggles default ON once a channel is
 * picked (the canon wizard's default-on toggles); an explicit `false` opts a
 * kind out. `integration.*` events never notify (loop safety, the R1 stance).
 */
export function createIntegrationNotifier(deps: IntegrationsDeps): ConsumerHook {
  return {
    name: "integration-notify",
    async handle(event: BusEvent): Promise<void> {
      try {
        if (event.type.startsWith("integration.")) return;
        const kind = matchNotificationKind(event);
        if (!kind) return;

        const row = await withTenant(deps.prisma, { workspaceId: event.workspaceId }, (tx) =>
          tx.integration.findUnique({
            where: { workspaceId_provider: { workspaceId: event.workspaceId, provider: "slack" } },
            select: { config: true, status: true },
          }),
        );
        if (!row || row.status === "revoked") return;
        const config = slackConfigSchema.safeParse(row.config);
        if (config.success && config.data.notifications?.[kind] === false) return;

        const payload = (event.payload ?? {}) as { intent?: string; label?: string };
        const contact = await lookupContact(deps, event.workspaceId, event.contactId);
        const text = notificationText(kind, {
          contact,
          ...(typeof payload.intent === "string" ? { intent: payload.intent } : {}),
          ...(typeof payload.label === "string" ? { label: payload.label } : {}),
        });
        await deliverSlack(deps, {
          workspaceId: event.workspaceId,
          kind,
          text,
          sourceEventId: event.id,
        });
      } catch (err) {
        (deps.log ?? console.warn)(
          `[integrations] notifier failed for event ${event.id}: ${err instanceof Error ? err.message : String(err)} — event persisted regardless`,
        );
      }
    },
  };
}

/**
 * The notify_team transport (Q-042's Slack half): the R1 executor calls this
 * when wired; absence keeps the pre-W1 behavior byte-identical (the run row
 * + Logs row stay the Phase-1 transport). Dedupe key is `<eventId>#rule:<id>`
 * — two rules notifying on one event deliver once EACH.
 */
export function createNotifyTeamTransport(deps: IntegrationsDeps) {
  return async (params: {
    workspaceId: string;
    sourceKey: string;
    note?: string;
    contactId?: string | null;
  }): Promise<DeliveryResult> => {
    const contact = await lookupContact(deps, params.workspaceId, params.contactId);
    const text = notificationText("notify_team", { contact, ...(params.note ? { note: params.note } : {}) });
    return deliverSlack(deps, {
      workspaceId: params.workspaceId,
      kind: "notify_team",
      text,
      sourceEventId: params.sourceKey,
    });
  };
}
