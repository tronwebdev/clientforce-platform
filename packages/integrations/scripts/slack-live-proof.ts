/**
 * INT W1 (DEC-093) — the LIVE Slack proof: real vendor, real bus, real rails.
 *
 * Driven by `.github/workflows/integrations-live-proof.yml` (environment:
 * staging — Key Vault OIDC). The owner's SLACK-BOT-TOKEN (chat:write ·
 * chat:write.public · channels:read) seeds the connection — token-seeded, not
 * OAuth-connected (the app CLIENT pair is a separate owner step for the UI
 * connect flow); everything downstream is the production path: the token is
 * field-encrypted through the real service helpers, the probe is a REAL
 * auth.test, the channel list is REAL, the notification walks the REAL
 * EventBus (Redis) through the REAL notifier consumer into a REAL
 * chat.postMessage in the owner's Slack workspace.
 *
 * Gates (all must pass; the run fails loudly otherwise):
 *   1  live probe        — auth.test ok, real team name captured
 *   2  channel list      — conversations.list returns the proof channel
 *   3  notify delivered  — email.replied.v1 → bus → notifier → REAL post;
 *                          IntegrationDelivery=delivered + integration.notified.v1
 *   4  redelivery dedupe — same event id again → still ONE delivery row
 *   5  notify_team       — the transport posts the rule-note for a contact
 *   6  revoked honesty   — a corrupted token probes to `revoked` via a REAL
 *                          invalid_auth + ONE status_changed; the good token
 *                          probes back to `connected` (second transition)
 *   7  disconnect audit  — row DELETED, integration.disconnected.v1 outlives
 *                          it (vendor revoke deliberately SKIPPED — the
 *                          owner's bot token is shared infrastructure, an
 *                          auth.revoke would kill it for everyone)
 *
 * Zero secrets printed; the receipts artifact carries ids/statuses only.
 */
import { writeFileSync } from "node:fs";
import { createAppPrismaClient, createPrismaClient, withTenant } from "@clientforce/db";
import { EventBus, bullConnectionFromUrl } from "@clientforce/events";
import {
  SlackAdapter,
  createIntegrationNotifier,
  createNotifyTeamTransport,
  deliverSlack,
  disconnectIntegration,
  encryptCredentials,
  probeIntegration,
  type IntegrationsDeps,
} from "@clientforce/integrations";

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const BOT_TOKEN = need("SLACK_BOT_TOKEN");
const REDIS_URL = need("REDIS_URL");
const PROOF_CHANNEL = process.env.SLACK_PROOF_CHANNEL; // name, optional — else first channel
const suffix = `slackproof-${Date.now()}`;

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
  const adapter = new SlackAdapter(); // real https://slack.com/api
  const agency = await owner.agency.create({ data: { name: suffix, slug: suffix, branding: {} } });
  const ws = await owner.workspace.create({
    data: { agencyId: agency.id, name: "Slack proof", slug: suffix, settings: {} },
  });
  const contact = await owner.contact.create({
    data: { workspaceId: ws.id, source: "proof", optOut: {}, tags: [], email: "ada@proof.test", firstName: "Ada", lastName: "Lovelace" },
  });

  const deps: IntegrationsDeps = { prisma: app, adapters: { slack: adapter } };
  const bus = new EventBus({
    prisma: app,
    connection: bullConnectionFromUrl(REDIS_URL),
    consumers: [createIntegrationNotifier(deps)],
  });
  deps.publish = async (input) => {
    await bus.publish(input as Parameters<EventBus["publish"]>[0]);
  };
  bus.startConsumer();

  try {
    // 1 — live probe on the vault token
    const creds = { accessToken: BOT_TOKEN };
    const probe = await adapter.probe(creds).catch((err) => fail("1 live probe", String(err?.message ?? err)));
    if (!probe.ok) fail("1 live probe", probe.detail);
    pass("1 live probe", `auth.test ok — ${probe.accountLabel ?? "workspace"}`);

    // token-seed the connection through the real persistence path
    const row = await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.integration.create({
        data: {
          workspaceId: ws.id,
          provider: "slack",
          status: "connected",
          config: {},
          credentialsEnc: encryptCredentials(creds),
          accountLabel: probe.accountLabel ?? null,
          scopes: ["chat:write", "chat:write.public", "channels:read"],
          lastProbeAt: new Date(),
        },
      }),
    );
    await deps.publish({
      workspaceId: ws.id,
      type: "integration.connected.v1",
      payload: { provider: "slack", ...(probe.accountLabel ? { accountLabel: probe.accountLabel } : {}) },
    });

    // 2 — real channel list, pick the proof channel. DEGRADED path: a token
    // minted before channels:read was added refuses conversations.list with
    // missing_scope (Slack tokens never gain scopes retroactively — the app
    // must be REINSTALLED to re-mint). chat:write.public still posts to any
    // public channel BY NAME, so a dispatch-provided channel keeps the walk
    // honest: the gate records the degraded mode + the owner fix loudly.
    let channel: { id: string; name: string };
    try {
      const channels = await adapter.listChannels(creds);
      if (channels.length === 0) fail("2 channel list", "conversations.list returned no channels");
      channel = (PROOF_CHANNEL && channels.find((c) => c.name === PROOF_CHANNEL)) || channels[0]!;
      pass("2 channel list", `${channels.length} channels — posting to #${channel.name}`);
    } catch (err) {
      const reason = (err as { reason?: string }).reason;
      if (reason !== "missing_scope") throw err;
      if (!PROOF_CHANNEL) {
        fail(
          "2 channel list",
          "missing_scope on conversations.list — the vault token predates channels:read (reinstall the Slack app to re-mint SLACK-BOT-TOKEN), or re-dispatch with the channel input to run degraded by name",
        );
      }
      channel = { id: `#${PROOF_CHANNEL}`, name: PROOF_CHANNEL as string };
      pass(
        "2 channel list",
        `DEGRADED — missing_scope on conversations.list (the UI picker path needs channels:read; reinstall the app to re-mint the token); posting by name to #${PROOF_CHANNEL} via chat:write.public`,
      );
    }
    await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { config: { channel: { id: channel.id, name: channel.name } } } }),
    );

    // 3 — REAL notification through the REAL bus + notifier consumer
    await deps.publish({
      workspaceId: ws.id,
      type: "email.replied.v1",
      contactId: contact.id,
      payload: { messageId: `proof-${suffix}`, intent: "interested" },
    });
    let delivery = null;
    for (let i = 0; i < 30 && !delivery; i += 1) {
      await new Promise((r) => setTimeout(r, 1000));
      delivery = await owner.integrationDelivery.findFirst({
        where: { workspaceId: ws.id, kind: "new_reply", status: "delivered" },
      });
    }
    if (!delivery) fail("3 notify delivered", "no delivered IntegrationDelivery row within 30s — check the worker consumer");
    const notified = await owner.event.findFirst({ where: { workspaceId: ws.id, type: "integration.notified.v1" } });
    if (!notified) fail("3 notify delivered", "integration.notified.v1 missing from the ledger");
    pass("3 notify delivered", `REAL Slack post in #${channel.name} — delivery ${delivery.id}`);

    // 4 — redelivery dedupe (same source event id)
    const sourceEventId = delivery.sourceEventId as string;
    const dup = await deliverSlack(deps, { workspaceId: ws.id, kind: "new_reply", text: "dup probe", sourceEventId });
    const count = await owner.integrationDelivery.count({ where: { workspaceId: ws.id, kind: "new_reply" } });
    if (count !== 1 || dup.detail?.includes("duplicate") !== true) fail("4 redelivery dedupe", `rows=${count} detail=${dup.detail}`);
    pass("4 redelivery dedupe", "second delivery skipped, ONE row");

    // 5 — the notify_team transport (Q-042's Slack half), a second REAL post
    const transport = createNotifyTeamTransport(deps);
    const res = await transport({
      workspaceId: ws.id,
      sourceKey: `proofevt#rule:proof-rule#a:0`,
      note: "Hot lead — live-proof walk",
      contactId: contact.id,
    });
    if (!res.delivered) fail("5 notify_team", res.detail ?? "not delivered");
    pass("5 notify_team", `rule note posted to ${res.target}`);

    // 6 — revoked honesty WITHOUT harming the shared token: corrupt, probe, restore
    await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { credentialsEnc: encryptCredentials({ accessToken: `${BOT_TOKEN.slice(0, 6)}-corrupted` }) } }),
    );
    const revoked = await probeIntegration(deps, { workspaceId: ws.id, provider: "slack" });
    if (revoked.status !== "revoked") fail("6 revoked honesty", `expected revoked, got ${revoked.status}`);
    await withTenant(app, { workspaceId: ws.id }, (tx) =>
      tx.integration.update({ where: { id: row.id }, data: { credentialsEnc: encryptCredentials(creds) } }),
    );
    const recovered = await probeIntegration(deps, { workspaceId: ws.id, provider: "slack" });
    if (recovered.status !== "connected") fail("6 revoked honesty", `recovery expected connected, got ${recovered.status}`);
    const transitions = await owner.event.count({ where: { workspaceId: ws.id, type: "integration.status_changed.v1" } });
    if (transitions !== 2) fail("6 revoked honesty", `expected 2 transitions, got ${transitions}`);
    pass("6 revoked honesty", "REAL invalid_auth → revoked → recovery → connected (2 transitions)");

    // 7 — disconnect audit; vendor revoke DELIBERATELY skipped (shared token)
    const noRevokeAdapter = new SlackAdapter();
    (noRevokeAdapter as { revoke?: unknown }).revoke = undefined;
    await disconnectIntegration({ ...deps, adapters: { slack: noRevokeAdapter } }, { workspaceId: ws.id, provider: "slack" });
    const gone = await owner.integration.findFirst({ where: { workspaceId: ws.id } });
    const disconnected = await owner.event.findFirst({ where: { workspaceId: ws.id, type: "integration.disconnected.v1" } });
    if (gone || !disconnected) fail("7 disconnect audit", `row=${Boolean(gone)} event=${Boolean(disconnected)}`);
    pass("7 disconnect audit", "row deleted; the ledger outlives it (vendor revoke skipped — shared token)");

    writeFileSync(
      "slack-live-proof-receipts.json",
      JSON.stringify(
        {
          at: new Date().toISOString(),
          workspace: ws.id,
          channel: `#${channel.name}`,
          gates,
          ledger: await owner.event.findMany({
            where: { workspaceId: ws.id, type: { startsWith: "integration." } },
            select: { type: true, payload: true, occurredAt: true },
            orderBy: { occurredAt: "asc" },
          }),
        },
        null,
        2,
      ),
    );
    console.log(`\nALL ${gates.length} GATES GREEN — real Slack delivery proven end-to-end.`);
  } finally {
    await bus.close?.().catch(() => {});
    await owner.agency.delete({ where: { id: agency.id } }).catch(() => {});
    await owner.$disconnect();
    await app.$disconnect();
  }
  process.exit(0);
}

void main().catch((err) => {
  console.error(err);
  writeFileSync("slack-live-proof-receipts.json", JSON.stringify({ gates, error: String(err?.message ?? err) }, null, 2));
  process.exit(1);
});
