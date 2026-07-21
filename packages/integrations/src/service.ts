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
import { decryptField, encryptField, withTenant } from "@clientforce/db";
import { EVENT_TYPES } from "@clientforce/events";
import {
  INTEGRATION_REFUSALS,
  type IntegrationDto,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@clientforce/core";
import {
  IntegrationProviderError,
  type IntegrationCredentials,
  type IntegrationRow,
  type IntegrationsDeps,
  type OAuthIntegrationAdapter,
} from "./types";

/** Typed service-level refusal (the API maps these to 422s verbatim). */
export class IntegrationRefusedError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = "IntegrationRefusedError";
  }
}

export function adapterFor(deps: IntegrationsDeps, provider: IntegrationProvider): OAuthIntegrationAdapter {
  const adapter = deps.adapters[provider];
  if (!adapter) throw new IntegrationRefusedError(INTEGRATION_REFUSALS.UNKNOWN_PROVIDER);
  return adapter;
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
  const adapter = adapterFor(deps, params.provider);
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
    const probe = await adapter.probe(decryptCredentials(row));
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
