/**
 * Outbound webhook delivery (INT W3, DEC-095) — the `send_webhook` action's
 * transport: the SSRF guard, the signed versioned payload, and the SAME
 * claim-then-send / allowance-brake rails as the Slack notifier (deliverSlack
 * is the template; the ledger + audit trail ride the `webhooks` Integration
 * row). A delivery failure NEVER changes the rule-run outcome — the caller
 * (the engine's webhookTransport seam) records the detail and moves on.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { webhooksConfigSchema } from "@clientforce/core";
import { EVENT_TYPES } from "@clientforce/events";
import { withTenant, Prisma } from "@clientforce/db";
import {
  INBOUND_DELIVERY_KINDS,
  INTEGRATION_DAILY_DELIVERY_ALLOWANCE,
  WEBHOOK_MAX_RESPONSE_BYTES,
  WEBHOOK_TIMEOUT_MS,
  utcDayStart,
} from "./constants";
import { IntegrationDeliveryError, type IntegrationsDeps } from "./types";
import { assertPublicHttpsUrl } from "./webhook-guard";

/** The connect-fields body (API boundary DTO — the calendly/stripe twin). */
export const webhooksConnectFieldsSchema = z
  .object({
    defaultUrl: z.string().url().max(500),
  })
  .strict();
export type WebhooksConnectFieldsDto = z.infer<typeof webhooksConnectFieldsSchema>;

export interface WebhookDeliveryResult {
  delivered: boolean;
  /** Redacted destination ("https://api.example.com/…") — never the full path. */
  target?: string;
  detail?: string;
}

/** The versioned outbound payload — additive-only from here (v stays 1). */
export interface WebhookPayloadV1 {
  v: 1;
  eventId: string;
  type: string;
  occurredAt: string;
  workspaceId: string;
  contactId?: string;
  rule: { id: string; name?: string };
  payload: unknown;
}

/** Host + truncated path — enough to recognize the destination, never query/secrets. */
export const redactWebhookTarget = (url: URL): string =>
  `${url.origin}${url.pathname.length > 24 ? `${url.pathname.slice(0, 24)}…` : url.pathname}`;

export const signWebhookBody = (secret: string, t: string, body: string): string =>
  createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");

/**
 * Read at most WEBHOOK_MAX_RESPONSE_BYTES of a response body, then cancel the
 * stream — the error-preview read must never buffer an unbounded body. Runs
 * under the caller's AbortSignal so the 5s timeout also bounds the body.
 */
async function readCappedBody(res: Response, signal: AbortSignal): Promise<string> {
  if (!res.body) {
    try {
      return (await res.text()).slice(0, WEBHOOK_MAX_RESPONSE_BYTES);
    } catch {
      return "";
    }
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < WEBHOOK_MAX_RESPONSE_BYTES && !signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length > 0) {
        chunks.push(Buffer.from(value));
        total += value.length;
      }
    }
  } catch {
    // Aborted or a mid-stream network error — return whatever was buffered.
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, WEBHOOK_MAX_RESPONSE_BYTES);
}

export async function deliverWebhook(
  deps: IntegrationsDeps,
  params: {
    workspaceId: string;
    /** The action's url override; absent → the integration's defaultUrl. */
    url?: string;
    payload: WebhookPayloadV1;
    /** Dedupe key — `<eventId>#rule:<id>#a:<i>` (the action-path convention). */
    sourceEventId: string;
  },
): Promise<WebhookDeliveryResult> {
  const log = deps.log ?? console.warn;

  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.findUnique({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: "webhooks" } },
    }),
  );
  if (!row) return { delivered: false, detail: "webhooks integration not connected" };
  const config = webhooksConfigSchema.safeParse(row.config);
  const secret = config.success ? config.data.signingSecret : undefined;
  const destination = params.url ?? (config.success ? config.data.defaultUrl : undefined);
  if (!secret) return { delivered: false, detail: "no signing secret — reconnect the Webhooks integration" };
  if (!destination) return { delivered: false, detail: "no destination URL — set a default Payload URL or one on the action" };

  const now = (deps.now ?? (() => new Date()))();
  const dayStart = utcDayStart(now);
  const allowance = deps.config?.dailyDeliveryAllowance ?? INTEGRATION_DAILY_DELIVERY_ALLOWANCE;
  // INBOUND ingest claims (kind `payment`) are receipts, not sends — they must
  // never count toward the outbound-delivery brake (W3 review fix; same as the
  // Slack notifier's shared workspace pool).
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
    const heldRow = await claimDelivery(deps, row.id, params, "held", { reason: "workspace_delivery_allowance" });
    if (!heldRow) return { delivered: false, detail: "duplicate delivery skipped" };
    if (heldBefore === 0) {
      console.error(
        `[integrations] COST ALERT: workspace ${params.workspaceId} hit the daily integration delivery allowance (${allowance}) — webhook deliveries held for the day`,
      );
      await publishSafely(deps, {
        workspaceId: params.workspaceId,
        type: EVENT_TYPES.INTEGRATION_DELIVERY_HELD,
        payload: { provider: "webhooks", reason: "workspace_delivery_allowance" },
      });
    }
    return { delivered: false, detail: `held — daily delivery allowance (${allowance}) reached` };
  }

  // CLAIM before any network I/O (the W1 at-most-once rail).
  const claimed = await claimDelivery(deps, row.id, params, "pending", {});
  if (!claimed) {
    const existing = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integrationDelivery.findUnique({
        where: {
          integrationId_sourceEventId_kind: {
            integrationId: row.id,
            sourceEventId: params.sourceEventId,
            kind: "webhook",
          },
        },
      }),
    );
    return {
      delivered: existing?.status === "delivered",
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

  let target = destination;
  try {
    // The guard names its rule in the typed refusal; the settle detail carries it.
    const guarded = await assertPublicHttpsUrl(destination);
    target = redactWebhookTarget(guarded.url);

    const body = JSON.stringify(params.payload);
    const t = String(Math.floor(now.getTime() / 1000));
    const v1 = signWebhookBody(secret, t, body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
    try {
      const res = await fetch(guarded.url.toString(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Clientforce-Webhook/1",
          "x-clientforce-signature": `t=${t},v1=${v1}`,
          "x-clientforce-event": params.payload.type,
        },
        body,
        redirect: "manual",
        signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        throw new IntegrationDeliveryError("webhook_redirect_refused", `destination answered a redirect (HTTP ${res.status}) — redirects are not followed`);
      }
      if (res.status >= 400) {
        // Read the error body INSIDE the timeout scope and cap it at the
        // transport (W3 fix): a hostile public receiver could otherwise stream
        // a multi-GB/slow 4xx body — res.text() would buffer all of it with no
        // active AbortSignal. The stream stops at the cap.
        const preview = await readCappedBody(res, controller.signal);
        throw new IntegrationDeliveryError("webhook_rejected", `destination answered HTTP ${res.status}${preview ? ` — ${preview.slice(0, 140)}` : ""}`);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? `destination timed out after ${WEBHOOK_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    await settle("failed", { error: detail, target });
    await publishSafely(deps, {
      workspaceId: params.workspaceId,
      type: EVENT_TYPES.INTEGRATION_SYNC_FAILED,
      payload: { provider: "webhooks", error: detail },
    });
    if (!(err instanceof IntegrationDeliveryError)) {
      log(`[integrations] unexpected webhook delivery failure: ${detail}`);
    }
    return { delivered: false, target, detail };
  }

  await settle("delivered", { target });
  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.update({ where: { id: row.id }, data: { lastSyncAt: now } }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_NOTIFIED,
    payload: { provider: "webhooks", kind: "webhook", target, sourceEventId: params.sourceEventId },
  });
  return { delivered: true, target };
}

/** Insert the unique delivery row; null = another run already owns the key. */
async function claimDelivery(
  deps: IntegrationsDeps,
  integrationId: string,
  params: { workspaceId: string; sourceEventId: string },
  status: "pending" | "held",
  detail: Record<string, unknown>,
): Promise<{ id: string } | null> {
  try {
    return await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integrationDelivery.create({
        data: {
          workspaceId: params.workspaceId,
          integrationId,
          sourceEventId: params.sourceEventId,
          kind: "webhook",
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
    (deps.log ?? console.warn)(
      `[integrations] event publish failed (${input.type}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
