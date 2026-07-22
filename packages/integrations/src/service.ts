/**
 * Connection lifecycle (INT W1, DEC-093) — connect / probe / disconnect on
 * the ONE `Integration` row per (workspace, provider). Status is PROBE-BACKED:
 * `connected` only after a live token probe; PROVIDER_AUTH → `revoked` (the
 * honest disconnected-with-a-reason state); transient vendor failure →
 * `unhealthy`. Transitions publish `integration.status_changed.v1` on an
 * ACTUAL change only (the sender.status_changed pattern). A user disconnect
 * DELETES the row — the ledger keeps the audit (the automation.deleted
 * stance). Tokens ride `credentialsEnc` (AES-256-GCM under
 * FIELD-ENCRYPTION-KEY — the SenderConnection/DEC-030 rule).
 */
import { randomBytes } from "node:crypto";
import { decryptField, encryptField, withTenant, Prisma } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import {
  INTEGRATION_REFUSALS,
  calendlyConfigSchema,
  stripeConfigSchema,
  webhooksConfigSchema,
  hubspotConfigSchema,
  type IntegrationDto,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@clientforce/core";
import {
  IntegrationDeliveryError,
  IntegrationProviderError,
  type IntegrationAdapter,
  type IntegrationCredentials,
  type IntegrationRow,
  type IntegrationsDeps,
  type OAuthIntegrationAdapter,
} from "./types";
import { TOKEN_REFRESH_SKEW_MS, WEBHOOK_TIMEOUT_MS } from "./constants";
import type { CalendlyAdapter, CalendlyConnectFieldsDto } from "./calendly";
import type { StripeAdapter, StripeConnectFieldsDto } from "./stripe";
import type { HubspotAdapter, HubspotConnectFieldsDto } from "./hubspot";
import { assertPublicHttpsUrl } from "./webhook-guard";
import { signWebhookBody, type WebhooksConnectFieldsDto } from "./webhook-deliver";

/** Typed service-level refusal (the API maps these to 422s verbatim). */
export class IntegrationRefusedError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "IntegrationRefusedError";
  }
}

export function adapterFor(deps: IntegrationsDeps, provider: IntegrationProvider): IntegrationAdapter {
  const adapter = deps.adapters[provider];
  if (!adapter) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.UNKNOWN_PROVIDER);
  return adapter;
}

/** Narrow to the OAuth shape — a fields provider (calendly) refuses typed. */
export function oauthAdapterFor(deps: IntegrationsDeps, provider: IntegrationProvider): OAuthIntegrationAdapter {
  const adapter = adapterFor(deps, provider);
  if (typeof (adapter as OAuthIntegrationAdapter).exchangeCode !== "function") {
    throw new IntegrationRefusedError(
      `${provider} connects with pasted fields, not OAuth — use the connect-fields endpoint`,
    );
  }
  return adapter as OAuthIntegrationAdapter;
}

export const encryptCredentials = (creds: IntegrationCredentials): Uint8Array<ArrayBuffer> => {
  const enc = encryptField(JSON.stringify(creds));
  const out = new Uint8Array(new ArrayBuffer(enc.length));
  out.set(enc);
  return out;
};

export const decryptCredentials = (row: IntegrationRow): IntegrationCredentials => {
  if (!row.credentialsEnc) return {};
  return JSON.parse(decryptField(row.credentialsEnc)) as IntegrationCredentials;
};

export function toIntegrationDto(row: IntegrationRow): IntegrationDto {
  return {
    provider: row.provider as IntegrationProvider,
    status: row.status as IntegrationStatus,
    accountLabel: row.accountLabel,
    scopes: row.scopes,
    config: row.config,
    lastProbeAt: row.lastProbeAt?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    connectedAt: row.createdAt.toISOString(),
  };
}

export async function getIntegration(
  deps: IntegrationsDeps,
  workspaceId: string,
  provider: IntegrationProvider,
): Promise<IntegrationRow | null> {
  return withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.integration.findUnique({ where: { workspaceId_provider: { workspaceId, provider } } }),
  );
}

export async function listIntegrations(deps: IntegrationsDeps, workspaceId: string): Promise<IntegrationRow[]> {
  return withTenant(deps.prisma, { workspaceId }, (tx) =>
    tx.integration.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
  );
}

async function publishSafely(deps: IntegrationsDeps, input: Parameters<NonNullable<IntegrationsDeps["publish"]>>[0]): Promise<void> {
  if (!deps.publish) return;
  try {
    await deps.publish(input);
  } catch (err) {
    (deps.log ?? console.warn)(
      `[integrations] event publish failed (${input.type}): ${err instanceof Error ? err.message : String(err)} — row state is authoritative`,
    );
  }
}

/**
 * OAuth completion: exchange the code, PROBE the fresh token (never
 * "connected" without one), encrypt, upsert, audit. Returns the row.
 */
export async function completeConnect(
  deps: IntegrationsDeps,
  params: {
    workspaceId: string;
    provider: IntegrationProvider;
    code: string;
    redirectUri: string;
    connectedById?: string;
  },
): Promise<IntegrationRow> {
  const adapter = oauthAdapterFor(deps, params.provider);
  const exchange = await adapter.exchangeCode({ code: params.code, redirectUri: params.redirectUri });
  const priorRow = await getIntegration(deps, params.workspaceId, params.provider);
  const priorCreds = priorRow?.credentialsEnc ? decryptCredentials(priorRow) : undefined;
  const probe = await adapter.probe(exchange.credentials);
  const now = (deps.now ?? (() => new Date()))();
  const accountLabel = probe.accountLabel ?? exchange.accountLabel ?? null;
  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.upsert({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: params.provider } },
      create: {
        workspaceId: params.workspaceId,
        provider: params.provider,
        status: "connected",
        config: {},
        credentialsEnc: encryptCredentials(exchange.credentials),
        accountLabel,
        scopes: exchange.scopes,
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
      update: {
        status: "connected",
        // Review-round fix: Google omits refresh_token on re-consent — a
        // reconnect must MERGE the stored one in, never overwrite with null
        // (a refresh-token-less refreshing connection self-revokes in ~1h).
        credentialsEnc: encryptCredentials(
          exchange.credentials.refreshToken == null && typeof priorCreds?.refreshToken === "string"
            ? { ...exchange.credentials, refreshToken: priorCreds.refreshToken }
            : exchange.credentials,
        ),
        accountLabel,
        scopes: exchange.scopes,
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
    }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_CONNECTED,
    payload: { provider: params.provider, ...(accountLabel ? { accountLabel } : {}) },
  });
  return row;
}

/**
 * INT W2 (DEC-094): run a vendor call with FRESH credentials. Providers whose
 * adapters implement `refresh` (Google) get a proactive refresh when the
 * stored `expiresAt` is past (or within the skew): refresh → re-encrypt via
 * the SAME `encryptCredentials` path → persist → run. A refresh-time
 * `invalid_grant` (PROVIDER_AUTH) flips the row to the honest `revoked`
 * state via `markRevoked` and rethrows; so does a PROVIDER_AUTH from the
 * call itself (the deliverSlack stance). Slack has no `refresh` method and
 * this helper leaves its behavior byte-identical (regression-pinned).
 */
export async function withFreshCredentials<T>(
  deps: IntegrationsDeps,
  row: IntegrationRow,
  fn: (creds: IntegrationCredentials) => Promise<T>,
): Promise<T> {
  const adapter = adapterFor(deps, row.provider as IntegrationProvider);
  let creds = decryptCredentials(row);
  if (adapter.refresh) {
    const expiresAt = typeof creds.expiresAt === "string" ? Date.parse(creds.expiresAt) : Number.NaN;
    const now = (deps.now ?? (() => new Date()))();
    const stale = !Number.isFinite(expiresAt) || expiresAt - TOKEN_REFRESH_SKEW_MS <= now.getTime();
    if (stale) {
      try {
        creds = await adapter.refresh(creds);
      } catch (err) {
        if (err instanceof IntegrationProviderError && err.code === "PROVIDER_AUTH") {
          await markRevoked(deps, row, err.message);
        }
        throw err;
      }
      await withTenant(deps.prisma, { workspaceId: row.workspaceId }, (tx) =>
        tx.integration.update({ where: { id: row.id }, data: { credentialsEnc: encryptCredentials(creds) } }),
      );
    }
  }
  try {
    return await fn(creds);
  } catch (err) {
    if (err instanceof IntegrationProviderError && err.code === "PROVIDER_AUTH") {
      await markRevoked(deps, row, err.message);
    }
    throw err;
  }
}

/**
 * The live health probe. Classifies the outcome into the honest status set,
 * persists it, and publishes the transition when the status ACTUALLY changed.
 */
export async function probeIntegration(
  deps: IntegrationsDeps,
  params: { workspaceId: string; provider: IntegrationProvider },
): Promise<{ status: IntegrationStatus; detail: string }> {
  const row = await getIntegration(deps, params.workspaceId, params.provider);
  if (!row) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.NOT_CONNECTED);
  const from = row.status as IntegrationStatus;
  let to: IntegrationStatus;
  let detail: string;
  let accountLabel = row.accountLabel;
  // W3: the Webhooks provider has no vendor token — its honest health check
  // is the delivery guard against the default URL (a URL that stopped
  // resolving or went private flips unhealthy, never revoked).
  if (params.provider === "webhooks") {
    const cfg = webhooksConfigSchema.safeParse(row.config);
    const url = cfg.success ? cfg.data.defaultUrl : undefined;
    try {
      if (!url) throw new Error("no default Payload URL configured");
      await assertPublicHttpsUrl(url);
      to = "connected";
      detail = "destination passes the delivery guard";
    } catch (err) {
      to = "unhealthy";
      detail = err instanceof Error ? err.message : String(err);
    }
    const nowTs = (deps.now ?? (() => new Date()))();
    await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { status: to, lastProbeAt: nowTs } }),
    );
    if (from !== to) {
      await publishSafely(deps, {
        workspaceId: params.workspaceId,
        type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
        payload: { provider: params.provider, from, to },
      });
    }
    return { status: to, detail };
  }
  const adapter = adapterFor(deps, params.provider);
  // Review-round fix (W2, generalized W3): a LINK-tier calendly/stripe row
  // (no credentials BY DESIGN) probes the LINK — its honest health check;
  // the token probe would throw PROVIDER_AUTH and flip a healthy connection
  // to revoked.
  if ((params.provider === "calendly" || params.provider === "stripe") && !row.credentialsEnc) {
    const url =
      params.provider === "calendly"
        ? (() => {
            const cfg = calendlyConfigSchema.safeParse(row.config);
            return cfg.success ? cfg.data.schedulingUrl : undefined;
          })()
        : (() => {
            const cfg = stripeConfigSchema.safeParse(row.config);
            return cfg.success ? cfg.data.paymentLinkUrl : undefined;
          })();
    if (url) {
      try {
        await (adapter as unknown as { probeLink(u: string): Promise<void> }).probeLink(url);
        to = "connected";
        detail = params.provider === "calendly" ? "scheduling link reachable" : "payment link reachable";
      } catch (err) {
        to = "unhealthy";
        detail = err instanceof Error ? err.message : String(err);
      }
      const nowTs = (deps.now ?? (() => new Date()))();
      await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
        tx.integration.update({ where: { id: row.id }, data: { status: to, lastProbeAt: nowTs } }),
      );
      if (from !== to) {
        await publishSafely(deps, {
          workspaceId: params.workspaceId,
          type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
          payload: { provider: params.provider, from, to },
        });
      }
      return { status: to, detail };
    }
  }
  // W3 review fix: a KEY-tier stripe row's health is the account probe AND the
  // webhook endpoint detection depends on — `detection` must reflect a LIVE
  // endpoint, never an assumed one. If the endpoint was deleted/disabled
  // out-of-band, flip detection off (honest) rather than keep rendering it live.
  if (params.provider === "stripe" && row.credentialsEnc) {
    const stripeAdapter = adapter as unknown as {
      account(creds: IntegrationCredentials): Promise<{ id: string; businessName?: string }>;
      listWebhookEndpoints(creds: IntegrationCredentials): Promise<Array<{ id: string; status: string }>>;
    };
    const creds = decryptCredentials(row);
    const cfg = stripeConfigSchema.safeParse(row.config);
    try {
      const account = await stripeAdapter.account(creds);
      accountLabel = account.businessName ? `${account.businessName} (${account.id})` : account.id;
      to = "connected";
      detail = `stripe reachable — authed as ${accountLabel}`;
      const endpointId = typeof creds.webhookEndpointId === "string" ? creds.webhookEndpointId : undefined;
      if (cfg.success && cfg.data.detection && endpointId) {
        const endpoints = await stripeAdapter.listWebhookEndpoints(creds);
        const live = endpoints.some((e) => e.id === endpointId && e.status === "enabled");
        if (!live) {
          await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
            tx.integration.update({
              where: { id: row.id },
              data: { config: { ...cfg.data, detection: false } as Prisma.InputJsonValue },
            }),
          );
          detail = `${detail} — payment detection endpoint missing; reconnect the key tier to restore`;
        }
      }
    } catch (err) {
      if (err instanceof IntegrationProviderError) {
        to = err.code === "PROVIDER_AUTH" ? "revoked" : "unhealthy";
      } else {
        to = "unhealthy";
      }
      detail = err instanceof Error ? err.message : String(err);
    }
    const nowTs = (deps.now ?? (() => new Date()))();
    await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { status: to, lastProbeAt: nowTs, accountLabel } }),
    );
    if (from !== to) {
      await publishSafely(deps, {
        workspaceId: params.workspaceId,
        type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
        payload: { provider: params.provider, from, to },
      });
    }
    return { status: to, detail };
  }
  try {
    // W2: refreshing providers probe on a FRESH token (an expired-but-
    // refreshable Google token is healthy, not revoked). No-refresh adapters
    // (Slack) take the pre-W2 path byte-identical.
    const probe = adapter.refresh
      ? await probeWithRefresh(deps, row, adapter)
      : await adapter.probe(decryptCredentials(row));
    to = "connected";
    detail = probe.detail;
    accountLabel = probe.accountLabel ?? accountLabel;
  } catch (err) {
    if (err instanceof IntegrationProviderError) {
      to = err.code === "PROVIDER_AUTH" ? "revoked" : "unhealthy";
      detail = err.message;
    } else {
      to = "unhealthy";
      detail = err instanceof Error ? err.message : String(err);
    }
  }
  const now = (deps.now ?? (() => new Date()))();
  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.update({
      where: { id: row.id },
      data: { status: to, lastProbeAt: now, accountLabel },
    }),
  );
  if (from !== to) {
    await publishSafely(deps, {
      workspaceId: params.workspaceId,
      type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
      payload: { provider: params.provider, from, to },
    });
  }
  return { status: to, detail };
}

/** Probe-path refresh: refresh + persist, NO markRevoked (probeIntegration
 *  owns the status classification + the single transition event). */
async function probeWithRefresh(
  deps: IntegrationsDeps,
  row: IntegrationRow,
  adapter: IntegrationAdapter,
): Promise<{ ok: boolean; detail: string; accountLabel?: string }> {
  let creds = decryptCredentials(row);
  const expiresAt = typeof creds.expiresAt === "string" ? Date.parse(creds.expiresAt) : Number.NaN;
  const now = (deps.now ?? (() => new Date()))();
  if (!Number.isFinite(expiresAt) || expiresAt - TOKEN_REFRESH_SKEW_MS <= now.getTime()) {
    creds = await adapter.refresh!(creds);
    await withTenant(deps.prisma, { workspaceId: row.workspaceId }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { credentialsEnc: encryptCredentials(creds) } }),
    );
  }
  return adapter.probe(creds);
}

/**
 * User-initiated disconnect: best-effort vendor revoke (a dead vendor must
 * not trap the user in a connection), row DELETED, audit event emitted.
 */
export async function disconnectIntegration(
  deps: IntegrationsDeps,
  params: { workspaceId: string; provider: IntegrationProvider },
): Promise<void> {
  // W3: the Webhooks provider has no vendor adapter — nothing to revoke.
  const adapter = params.provider === "webhooks" ? null : adapterFor(deps, params.provider);
  const row = await getIntegration(deps, params.workspaceId, params.provider);
  if (!row) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.NOT_CONNECTED);
  if (adapter?.revoke && row.credentialsEnc) {
    try {
      await adapter.revoke(decryptCredentials(row));
    } catch (err) {
      (deps.log ?? console.warn)(
        `[integrations] ${params.provider} revoke failed (${err instanceof Error ? err.message : String(err)}) — disconnecting anyway`,
      );
    }
  }
  await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.delete({ where: { id: row.id } }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_DISCONNECTED,
    payload: { provider: params.provider, reason: "user" },
  });
}

/**
 * A delivery-time PROVIDER_AUTH means the token died out-of-band (revoked in
 * the vendor console). Flip the row to `revoked` — the honest disconnected
 * state — and say so on the ledger; never keep rendering "connected".
 */
export async function markRevoked(
  deps: IntegrationsDeps,
  row: IntegrationRow,
  detail: string,
): Promise<void> {
  const from = row.status as IntegrationStatus;
  if (from === "revoked") return;
  await withTenant(deps.prisma, { workspaceId: row.workspaceId }, (tx) =>
    tx.integration.update({ where: { id: row.id }, data: { status: "revoked" } }),
  );
  await publishSafely(deps, {
    workspaceId: row.workspaceId,
    type: EVENT_TYPES.INTEGRATION_STATUS_CHANGED,
    payload: { provider: row.provider as IntegrationProvider, from, to: "revoked" },
  });
  (deps.log ?? console.warn)(`[integrations] ${row.provider} token revoked out-of-band — ${detail}`);
}

/**
 * INT W2 (DEC-094): the FIELDS connect path (Calendly) — probe-backed like
 * OAuth completion, two honest tiers:
 *
 *   LINK tier (schedulingUrl only): live GET of the link (a REAL probe) →
 *   config carries `schedulingUrl`; credentialsEnc untouched; detection off.
 *
 *   TOKEN tier (apiToken present): `/users/me` probe → per-workspace
 *   `webhookToken` (capability-URL, config) + signing key (SECRET,
 *   credentialsEnc) minted (reused across reconnects so the webhook URL
 *   stays stable) → IDEMPOTENT webhook subscription pointing at
 *   `webhookUrlFor(webhookToken)` → PAT + signingKey + subscriptionUri
 *   field-encrypted; config gains `detection: true`.
 *
 * A free-plan webhook refusal (Calendly 403) maps to the typed
 * CALENDLY_TOKEN_REQUIRED_FOR_DETECTION refusal — tier 1 keeps working.
 */
export async function connectCalendlyFields(
  deps: IntegrationsDeps,
  params: {
    workspaceId: string;
    fields: CalendlyConnectFieldsDto;
    /** Builds the API-public callback URL from the minted webhook token. */
    webhookUrlFor: (webhookToken: string) => string;
    connectedById?: string;
  },
): Promise<IntegrationRow> {
  const adapter = deps.adapters.calendly as unknown as CalendlyAdapter | undefined;
  if (!adapter) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.UNKNOWN_PROVIDER);
  const now = (deps.now ?? (() => new Date()))();

  const existing = await getIntegration(deps, params.workspaceId, "calendly");
  const existingConfig = calendlyConfigSchema.safeParse(existing?.config ?? {});
  const existingCreds = existing ? decryptCredentials(existing) : {};

  // ── Token tier ─────────────────────────────────────────────────────────────
  let credentials: IntegrationCredentials | undefined;
  let accountLabel = existing?.accountLabel ?? null;
  let schedulingUrl = params.fields.schedulingUrl?.trim() || undefined;
  const config: Record<string, unknown> = existingConfig.success ? { ...existingConfig.data } : {};

  if (params.fields.apiToken) {
    const tokenCreds: IntegrationCredentials = { apiToken: params.fields.apiToken };
    const user = await adapter.me(tokenCreds); // the live token probe — PROVIDER_AUTH refuses upstream
    accountLabel = user.name ? `${user.name} (Calendly)` : (user.schedulingUrl ?? "Calendly account");
    schedulingUrl ??= user.schedulingUrl;
    // Reused across reconnects: a rotated token must not orphan the vendor-side
    // subscription or move the capability URL.
    const webhookToken =
      (existingConfig.success && existingConfig.data.webhookToken) || randomBytes(24).toString("hex");
    const signingKey =
      (typeof existingCreds.signingKey === "string" && existingCreds.signingKey) ||
      randomBytes(32).toString("hex");
    try {
      const subscription = await adapter.ensureWebhookSubscription(tokenCreds, {
        organization: user.organization,
        user: user.uri,
        callbackUrl: params.webhookUrlFor(webhookToken),
        signingKey,
      });
      credentials = {
        apiToken: params.fields.apiToken,
        signingKey,
        subscriptionUri: subscription.uri,
        userUri: user.uri,
        organizationUri: user.organization,
      };
    } catch (err) {
      if (err instanceof IntegrationDeliveryError) {
        // The free-plan (or permission) refusal — typed, plan-naming, tier 1 intact.
        throw new IntegrationRefusedError(
          `${INTEGRATION_REFUSALS.CALENDLY_TOKEN_REQUIRED_FOR_DETECTION} (Calendly said: ${err.message})`,
        );
      }
      throw err;
    }
    config.webhookToken = webhookToken;
    config.detection = true;
  }

  // ── Link tier (both tiers store/refresh the link when one exists) ──────────
  if (!schedulingUrl) {
    throw new IntegrationRefusedError(INTEGRATION_REFUSALS.BOOKING_NOT_CONFIGURED);
  }
  try {
    await adapter.probeLink(schedulingUrl); // the live link probe — never connected without one
  } catch (err) {
    if (err instanceof IntegrationDeliveryError) {
      throw new IntegrationRefusedError(INTEGRATION_REFUSALS.CALENDLY_LINK_INVALID);
    }
    throw err;
  }
  config.schedulingUrl = schedulingUrl;

  const parsedConfig = calendlyConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    throw new IntegrationRefusedError(INTEGRATION_REFUSALS.CALENDLY_LINK_INVALID);
  }

  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.upsert({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: "calendly" } },
      create: {
        workspaceId: params.workspaceId,
        provider: "calendly",
        status: "connected",
        config: parsedConfig.data,
        ...(credentials ? { credentialsEnc: encryptCredentials(credentials) } : {}),
        accountLabel,
        scopes: [],
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
      update: {
        status: "connected",
        config: parsedConfig.data,
        ...(credentials ? { credentialsEnc: encryptCredentials(credentials) } : {}),
        accountLabel,
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
    }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_CONNECTED,
    payload: { provider: "calendly", ...(accountLabel ? { accountLabel } : {}) },
  });
  return row;
}

/**
 * INT W3 (DEC-095): the Stripe fields connect — the connectCalendlyFields
 * anatomy on payments. Key tier first (probe /v1/account, ensure the webhook
 * endpoint — STRIPE MINTS THE SIGNING SECRET at create; a reused endpoint
 * without a stored secret refuses typed), then the link tier (live payment-
 * link probe; both tiers store/refresh the link when one exists).
 */
export async function connectStripeFields(
  deps: IntegrationsDeps,
  params: {
    workspaceId: string;
    fields: StripeConnectFieldsDto;
    /** Builds the API-public callback URL from the minted webhook token. */
    webhookUrlFor: (webhookToken: string) => string;
    connectedById?: string;
  },
): Promise<IntegrationRow> {
  const adapter = deps.adapters.stripe as unknown as StripeAdapter | undefined;
  if (!adapter) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.UNKNOWN_PROVIDER);
  const now = (deps.now ?? (() => new Date()))();

  const existing = await getIntegration(deps, params.workspaceId, "stripe");
  const existingConfig = stripeConfigSchema.safeParse(existing?.config ?? {});
  const existingCreds = existing ? decryptCredentials(existing) : {};

  let credentials: IntegrationCredentials | undefined;
  let accountLabel = existing?.accountLabel ?? null;
  const paymentLinkUrl = params.fields.paymentLinkUrl?.trim() || undefined;
  const config: Record<string, unknown> = existingConfig.success ? { ...existingConfig.data } : {};

  // ── Link tier probe FIRST (read-only) ──────────────────────────────────────
  // A bad link must refuse BEFORE the key tier mutates Stripe (creates an
  // endpoint) — otherwise every failed attempt orphans a webhook endpoint at a
  // never-persisted capability URL that no later code path can match or revoke.
  if (paymentLinkUrl) {
    try {
      await adapter.probeLink(paymentLinkUrl); // the live link probe
    } catch (err) {
      if (err instanceof IntegrationDeliveryError) {
        throw new IntegrationRefusedError(INTEGRATION_REFUSALS.STRIPE_LINK_INVALID);
      }
      throw err;
    }
    config.paymentLinkUrl = paymentLinkUrl;
  } else if (!config.paymentLinkUrl && !params.fields.apiKey) {
    throw new IntegrationRefusedError(INTEGRATION_REFUSALS.PAYMENT_NOT_CONFIGURED);
  }

  // ── Key tier (vendor-mutating — runs only after the link validated) ────────
  if (params.fields.apiKey) {
    const keyCreds: IntegrationCredentials = { apiKey: params.fields.apiKey };
    const account = await adapter.account(keyCreds); // the live key probe — PROVIDER_AUTH refuses upstream
    accountLabel = account.businessName ? `${account.businessName} (${account.id})` : account.id;
    // Reused across reconnects: a rotated key must not move the capability URL.
    const webhookToken =
      (existingConfig.success && existingConfig.data.webhookToken) || randomBytes(24).toString("hex");
    const priorSecret =
      typeof existingCreds.webhookSigningSecret === "string" ? existingCreds.webhookSigningSecret : undefined;
    const priorEndpointId =
      typeof existingCreds.webhookEndpointId === "string" ? existingCreds.webhookEndpointId : undefined;
    try {
      const endpoint = await adapter.ensureWebhookEndpoint(keyCreds, {
        callbackUrl: params.webhookUrlFor(webhookToken),
      });
      let secret = endpoint.secret;
      let endpointId = endpoint.id;
      if (!secret) {
        // A URL-matched endpoint returns NO secret (Stripe reveals it only at
        // create). The stored secret is trustworthy ONLY when it belongs to
        // THIS SAME endpoint — reusing it against a different endpoint id (a
        // test↔live or account-switch reconnect that matched a different row)
        // silently mismatches every signature. Verify identity; else recreate.
        if (priorSecret && priorEndpointId === endpoint.id) {
          secret = priorSecret;
        } else {
          await adapter.deleteWebhookEndpoint(keyCreds, endpoint.id);
          const fresh = await adapter.ensureWebhookEndpoint(keyCreds, {
            callbackUrl: params.webhookUrlFor(webhookToken),
          });
          if (!fresh.secret) {
            throw new IntegrationRefusedError(
              `${INTEGRATION_REFUSALS.STRIPE_TOKEN_REQUIRED_FOR_DETECTION} (Stripe returned no signing secret for the webhook endpoint)`,
            );
          }
          secret = fresh.secret;
          endpointId = fresh.id;
        }
      }
      // Strand cleanup: a previously-stored endpoint that is NOT the one we now
      // keep (account/mode switch) would keep POSTing unverifiable events at the
      // capability URL and could never be revoked later — best-effort delete it.
      if (priorEndpointId && priorEndpointId !== endpointId) {
        await adapter.deleteWebhookEndpoint(keyCreds, priorEndpointId).catch(() => {});
      }
      credentials = {
        apiKey: params.fields.apiKey,
        webhookSigningSecret: secret,
        webhookEndpointId: endpointId,
        accountId: account.id,
      };
    } catch (err) {
      if (err instanceof IntegrationDeliveryError) {
        // A restricted key without Webhook Endpoints write — typed, permission-naming.
        throw new IntegrationRefusedError(
          `${INTEGRATION_REFUSALS.STRIPE_TOKEN_REQUIRED_FOR_DETECTION} (Stripe said: ${err.message})`,
        );
      }
      throw err;
    }
    config.webhookToken = webhookToken;
    config.detection = true;
  }

  const parsedConfig = stripeConfigSchema.safeParse(config);
  if (!parsedConfig.success) {
    throw new IntegrationRefusedError(INTEGRATION_REFUSALS.STRIPE_LINK_INVALID);
  }

  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.upsert({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: "stripe" } },
      create: {
        workspaceId: params.workspaceId,
        provider: "stripe",
        status: "connected",
        config: parsedConfig.data,
        ...(credentials ? { credentialsEnc: encryptCredentials(credentials) } : {}),
        accountLabel,
        scopes: [],
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
      update: {
        status: "connected",
        config: parsedConfig.data,
        ...(credentials ? { credentialsEnc: encryptCredentials(credentials) } : {}),
        accountLabel,
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
    }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_CONNECTED,
    payload: { provider: "stripe", ...(accountLabel ? { accountLabel } : {}) },
  });
  return row;
}

/**
 * INT W3: the Webhooks fields connect — no vendor, so the "probe" IS the
 * canon test step: a real signed POST to the default Payload URL through the
 * full delivery guard (SSRF rules + timeout + no-redirects). The signing
 * secret is server-minted once and kept across reconnects (rotating it would
 * silently break the owner's receiver); it rides config deliberately (the
 * calendly webhookToken capability precedent — redacted below OWNER/ADMIN).
 */
export async function connectWebhooksFields(
  deps: IntegrationsDeps,
  params: {
    workspaceId: string;
    fields: WebhooksConnectFieldsDto;
    connectedById?: string;
  },
): Promise<IntegrationRow> {
  const now = (deps.now ?? (() => new Date()))();
  const existing = await getIntegration(deps, params.workspaceId, "webhooks");
  const existingConfig = webhooksConfigSchema.safeParse(existing?.config ?? {});
  const signingSecret =
    (existingConfig.success && existingConfig.data.signingSecret) || `whsec_cf_${randomBytes(24).toString("hex")}`;
  const defaultUrl = params.fields.defaultUrl.trim();

  // The live probe: guard + a real signed test delivery. Guard refusals name
  // their rule; a refused destination NEVER becomes a connected row.
  const guarded = await assertPublicHttpsUrl(defaultUrl).catch((err) => {
    if (err instanceof IntegrationDeliveryError) {
      throw new IntegrationRefusedError(`${INTEGRATION_REFUSALS.WEBHOOK_URL_UNSAFE} (${err.message})`);
    }
    throw err;
  });
  const testBody = JSON.stringify({
    v: 1,
    eventId: `test-${randomBytes(8).toString("hex")}`,
    type: "webhook.test",
    occurredAt: now.toISOString(),
    workspaceId: params.workspaceId,
    rule: { id: "connect-test" },
    payload: { message: "Clientforce webhook test — connection succeeded" },
  });
  const t = String(Math.floor(now.getTime() / 1000));
  const v1 = signWebhookBody(signingSecret, t, testBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(guarded.url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Clientforce-Webhook/1",
        "x-clientforce-signature": `t=${t},v1=${v1}`,
        "x-clientforce-event": "webhook.test",
      },
      body: testBody,
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (err) {
    const detail =
      err instanceof Error && err.name === "AbortError"
        ? `test delivery timed out after ${WEBHOOK_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    throw new IntegrationRefusedError(`The test delivery could not reach that URL (${detail})`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status >= 300) {
    throw new IntegrationRefusedError(
      `The test delivery was not accepted — the destination answered HTTP ${res.status} (2xx confirms the receiver)`,
    );
  }

  const config = { defaultUrl, signingSecret };
  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.upsert({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: "webhooks" } },
      create: {
        workspaceId: params.workspaceId,
        provider: "webhooks",
        status: "connected",
        config,
        accountLabel: guarded.url.hostname,
        scopes: [],
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
      update: {
        status: "connected",
        config,
        accountLabel: guarded.url.hostname,
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
    }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_CONNECTED,
    payload: { provider: "webhooks", accountLabel: guarded.url.hostname },
  });
  return row;
}

/**
 * INT W4 (DEC-096): the HubSpot fields connect — the single private-app token
 * tier (no OAuth clock; the Calendly/Stripe token precedent). The token is
 * LIVE-probed (/account-info) and refuses typed on rejection; the portal id
 * rides config (label), the token rides credentialsEnc. The row is never
 * "connected" without the probe.
 */
export async function connectHubspotFields(
  deps: IntegrationsDeps,
  params: { workspaceId: string; fields: HubspotConnectFieldsDto; connectedById?: string },
): Promise<IntegrationRow> {
  const adapter = deps.adapters.hubspot as unknown as HubspotAdapter | undefined;
  if (!adapter) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.UNKNOWN_PROVIDER);
  const now = (deps.now ?? (() => new Date()))();
  const creds: IntegrationCredentials = { apiToken: params.fields.apiToken };

  let portalId: string;
  try {
    portalId = (await adapter.account(creds)).portalId; // the live token probe
  } catch (err) {
    if (
      (err instanceof IntegrationProviderError && err.code === "PROVIDER_AUTH") ||
      err instanceof IntegrationDeliveryError
    ) {
      throw new IntegrationRefusedError(INTEGRATION_REFUSALS.HUBSPOT_TOKEN_INVALID);
    }
    throw err;
  }
  const accountLabel = `HubSpot (portal ${portalId})`;
  const parsedConfig = hubspotConfigSchema.safeParse({
    portalId,
    ...(params.fields.defaultPipeline ? { defaultPipeline: params.fields.defaultPipeline } : {}),
  });
  if (!parsedConfig.success) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.HUBSPOT_TOKEN_INVALID);

  const row = await withTenant(deps.prisma, { workspaceId: params.workspaceId }, (tx) =>
    tx.integration.upsert({
      where: { workspaceId_provider: { workspaceId: params.workspaceId, provider: "hubspot" } },
      create: {
        workspaceId: params.workspaceId,
        provider: "hubspot",
        status: "connected",
        config: parsedConfig.data,
        credentialsEnc: encryptCredentials(creds),
        accountLabel,
        scopes: [],
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
      update: {
        status: "connected",
        config: parsedConfig.data,
        credentialsEnc: encryptCredentials(creds),
        accountLabel,
        lastProbeAt: now,
        connectedById: params.connectedById ?? null,
      },
    }),
  );
  await publishSafely(deps, {
    workspaceId: params.workspaceId,
    type: EVENT_TYPES.INTEGRATION_CONNECTED,
    payload: { provider: "hubspot", accountLabel },
  });
  return row;
}
