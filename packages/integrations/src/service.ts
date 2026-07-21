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
import { decryptField, encryptField, withTenant } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import {
  INTEGRATION_REFUSALS,
  calendlyConfigSchema,
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
import { TOKEN_REFRESH_SKEW_MS } from "./constants";
import type { CalendlyAdapter, CalendlyConnectFieldsDto } from "./calendly";

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
        credentialsEnc: encryptCredentials(exchange.credentials),
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
  const adapter = adapterFor(deps, params.provider);
  const row = await getIntegration(deps, params.workspaceId, params.provider);
  if (!row) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.NOT_CONNECTED);
  const from = row.status as IntegrationStatus;
  let to: IntegrationStatus;
  let detail: string;
  let accountLabel = row.accountLabel;
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
  const adapter = adapterFor(deps, params.provider);
  const row = await getIntegration(deps, params.workspaceId, params.provider);
  if (!row) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.NOT_CONNECTED);
  if (adapter.revoke && row.credentialsEnc) {
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
