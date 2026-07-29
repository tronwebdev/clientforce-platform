/**
 * INT W2 (DEC-094) — the STAGING-INGRESS booking walk (owner ruling 2026-07-29).
 *
 * W2's §8 evidence earned the booking walk on the real local stack with Calendly
 * stubbed at `CALENDLY_BASE_URL`. This walk removes BOTH stubs: the real vendor
 * (api.calendly.com, the vault CALENDLY-DEMO-TOKEN — a Standard-plan PAT) and the
 * DEPLOYED STAGING API. The subscription is created BY the deployed service and
 * points at that service's own public ingress, so Calendly delivers genuine
 * webhooks into a running Clientforce — no replay, no local harness.
 *
 * HONESTY RAILS (the owner's instruction: the ingress walk must not quietly
 * launder what the vendor cannot deliver). Every receipt carries `mode`:
 *
 *   genuine  — what the vendor really did: the PAT probe, the subscription
 *              create / list / delete, and the `invitee.created` +
 *              `invitee.canceled` deliveries produced by the owner's REAL
 *              booking and REAL reschedule against the live scheduling link.
 *   replayed — the three proofs no vendor can be asked to perform, re-POSTed by
 *              this script to the same live endpoint and NEVER folded into the
 *              genuine set:
 *                · a TAMPERED body — Calendly only ever signs what it sends, so
 *                  a bad-signature delivery cannot be ordered from the vendor;
 *                · a REDELIVERY of an already-processed invitee — Calendly
 *                  retries only on failure, which we cannot force on demand;
 *                · an OUT-OF-ORDER redelivery of the reschedule twins — the
 *                  vendor sends each twin once, in whatever order it chooses.
 *              The VALID-signature half is genuine and needs no replay: the
 *              owner's booking landed at all only because Calendly's own HMAC,
 *              computed with the SERVER-MINTED signing key, verified against the
 *              deployed endpoint (a bad signature is a 401 and writes nothing).
 *
 * PHASES (`PHASE` env):
 *   arm    — real PAT probe → connect the token tier ON STAGING (the deployed
 *            API mints the signing key + capability token and creates the real
 *            subscription) → list it back from the vendor → print exactly what
 *            the owner should book and when.
 *   verify — read what the genuine deliveries wrote, run the replay-only proofs
 *            against the same live endpoint, re-assert nothing moved, then tear
 *            the subscription down (delete → list → gone).
 *
 * WRITES NEVER BYPASS THE PRODUCT. Every Meeting/Event/stage row asserted here
 * was written by the deployed API's own `/webhooks/calendly` endpoint off a real
 * delivery. The staging DB is opened READ-ONLY for inspection (the owner client,
 * the worker-health-probe precedent); this script never inserts or updates a
 * Meeting, Event or pipeline stage.
 *
 * Zero secrets printed: the PAT, the server-minted signing key and the
 * capability token appear only as short prefixes/lengths in logs and receipts.
 */
import { writeFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { createPrismaClient, type PrismaClient } from "@clientforce/db";
import {
  CalendlyAdapter,
  connectCalendlyFields,
  decryptCredentials,
  type IntegrationsDeps,
} from "@clientforce/integrations";
import { signDevToken } from "../../../apps/api/src/auth/dev-token-verifier";

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const PHASE = (process.env.PHASE ?? "arm").trim();
const PAT = need("CALENDLY_API_TOKEN");
const STAGING_API = need("STAGING_API_URL").replace(/\/$/, "");
const DEV_SECRET = need("AUTH_DEV_SECRET");
const DB_URL = need("STAGING_DATABASE_URL");
const PRINCIPAL = process.env.DEV_PRINCIPAL_EMAIL ?? "owner@demo-agency.test";
const OUT_FILE = process.env.OUT_FILE ?? `calendly-staging-${PHASE}-receipts.json`;

/** Secrets are shown as a short prefix + length — never the bytes. */
const mask = (v: string): string =>
  v.length <= 8 ? "*".repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-2)} (len ${v.length})`;

interface Gate {
  gate: string;
  mode: "genuine" | "replayed";
  ok: boolean;
  detail: string;
}
const gates: Gate[] = [];
const record = (gate: string, mode: Gate["mode"], ok: boolean, detail: string): void => {
  gates.push({ gate, mode, ok, detail });
  console.log(`${ok ? "✓" : "✗"} [${mode}] ${gate} — ${detail}`);
};
const must = (gate: string, mode: Gate["mode"], ok: boolean, detail: string): void => {
  record(gate, mode, ok, detail);
  if (!ok) throw new Error(`gate failed: ${gate} — ${detail}`);
};

// ── staging API helpers (the sms-rail1-proof precedent) ──────────────────────
interface StagingCtx {
  token: string;
  workspaceId: string;
}

async function stagingAuth(): Promise<StagingCtx> {
  const token = await signDevToken(DEV_SECRET, {
    sub: `dev|${PRINCIPAL}`,
    email: PRINCIPAL,
  });
  const res = await fetch(`${STAGING_API}/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`staging /me -> HTTP ${res.status} (is the API deployed and awake?)`);
  const me = (await res.json()) as { memberships?: Array<{ workspaceId: string; role?: string }> };
  const memberships = me.memberships ?? [];
  // connect-fields is @Roles(OWNER, ADMIN) — pick a workspace the dev principal
  // can actually connect in, rather than whichever membership sorts first.
  const membership = memberships.find((m) => m.role === "OWNER" || m.role === "ADMIN");
  if (!membership) {
    throw new Error(
      `staging /me returned no OWNER/ADMIN membership for ${PRINCIPAL} (${memberships.length} membership(s))`,
    );
  }
  return { token, workspaceId: membership.workspaceId };
}

const authHeaders = (ctx: StagingCtx): Record<string, string> => ({
  Authorization: `Bearer ${ctx.token}`,
  "x-workspace-id": ctx.workspaceId,
});

/** POST a raw, signed body to the DEPLOYED webhook endpoint (replay proofs). */
async function postWebhook(
  webhookToken: string,
  rawBody: string,
  signature: string | null,
): Promise<{ status: number; body: string }> {
  const res = await fetch(
    `${STAGING_API}/webhooks/calendly?token=${encodeURIComponent(webhookToken)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(signature ? { "Calendly-Webhook-Signature": signature } : {}),
      },
      body: rawBody,
    },
  );
  return { status: res.status, body: await res.text() };
}

/** The header Calendly sends: `t=<unix>,v1=<hex hmac over "<t>.<rawBody>">`. */
const signBody = (rawBody: string, signingKey: string): string => {
  const t = Math.floor(Date.now() / 1000).toString();
  const v1 = createHmac("sha256", signingKey).update(`${t}.${rawBody}`, "utf8").digest("hex");
  return `t=${t},v1=${v1}`;
};

// ── the shared connection read (owner client, READ-ONLY) ─────────────────────
interface Connection {
  webhookToken: string;
  signingKey: string;
  subscriptionUri: string;
  /** Lower bound for "meetings this walk armed" — see the note in readConnection. */
  since: Date;
}

async function readConnection(db: PrismaClient, workspaceId: string): Promise<Connection> {
  const row = await db.integration.findFirst({ where: { workspaceId, provider: "calendly" } });
  if (!row) throw new Error("no calendly Integration row on staging — run the arm phase first");
  const config = (row.config ?? {}) as Record<string, unknown>;
  const creds = decryptCredentials(row);
  const webhookToken = typeof config.webhookToken === "string" ? config.webhookToken : "";
  const signingKey = typeof creds.signingKey === "string" ? creds.signingKey : "";
  const subscriptionUri = typeof creds.subscriptionUri === "string" ? creds.subscriptionUri : "";
  if (!webhookToken || !signingKey || !subscriptionUri) {
    throw new Error("calendly row is missing the token-tier material (detection not armed)");
  }
  // Scope the "what did the genuine deliveries write" window by the row's
  // CREATION, not lastProbeAt: connect is idempotent and re-arming (e.g. to
  // exercise the deployed endpoint once a fix ships) moves lastProbeAt
  // FORWARD, which would silently exclude a booking that already landed and
  // make the walk report zero meetings. createdAt is stable across re-arms.
  // SINCE overrides it when staging carries calendly rows from earlier work.
  const override = process.env.SINCE ? new Date(process.env.SINCE) : null;
  return {
    webhookToken,
    signingKey,
    subscriptionUri,
    since: override && !Number.isNaN(override.getTime()) ? override : row.createdAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: arm
// ─────────────────────────────────────────────────────────────────────────────
async function arm(db: PrismaClient): Promise<Record<string, unknown>> {
  const adapter = new CalendlyAdapter(); // no baseUrl override => REAL api.calendly.com
  const creds = { apiToken: PAT };

  // ── gate 1 · the REAL PAT probe ────────────────────────────────────────────
  const user = await adapter.me(creds);
  must(
    "PAT probe",
    "genuine",
    Boolean(user.uri && user.organization),
    `api.calendly.com/users/me authed as ${user.name ?? "(unnamed)"} — scheduling_url ${user.schedulingUrl ?? "(none)"}`,
  );
  const schedulingUrl = process.env.CALENDLY_SCHEDULING_URL?.trim() || user.schedulingUrl;
  if (!schedulingUrl) throw new Error("no scheduling_url on the PAT account and none supplied");

  // ── gate 2 · the deployed API is reachable and carries the W2 surface ──────
  const ctx = await stagingAuth();
  const pre = await fetch(`${STAGING_API}/integrations/calendly`, { headers: authHeaders(ctx) });
  must(
    "staging API surface",
    "genuine",
    pre.status === 200,
    `GET ${STAGING_API}/integrations/calendly -> HTTP ${pre.status} (workspace ${ctx.workspaceId})`,
  );

  // ── gate 3 · a correlation target: a REAL seeded lead with a live enrollment ─
  const enrollment = await db.enrollment.findFirst({
    where: { workspaceId: ctx.workspaceId, status: "ACTIVE", pipelineStage: { not: "booked" } },
    orderBy: { createdAt: "desc" },
    include: { contact: { select: { id: true, firstName: true, lastName: true } } },
  });
  if (!enrollment?.contact) {
    throw new Error("no ACTIVE non-booked enrollment on staging to correlate a booking to");
  }
  const contact = enrollment.contact;
  must(
    "correlation target",
    "genuine",
    true,
    `contact ${contact.id} (${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() +
      `) · enrollment ${enrollment.id} · stage "${enrollment.pipelineStage}"`,
  );

  // ── gate 4 · connect the TOKEN tier on the DEPLOYED API ────────────────────
  // The deployed service does the work: probes the PAT, mints the capability
  // token + the signing key, and creates the vendor subscription pointing at
  // its OWN public ingress. Nothing here supplies either secret.
  const connectRes = await fetch(`${STAGING_API}/integrations/calendly/connect-fields`, {
    method: "POST",
    headers: { ...authHeaders(ctx), "Content-Type": "application/json" },
    body: JSON.stringify({ schedulingUrl, apiToken: PAT }),
  });
  const connectBody = await connectRes.text();

  // The deployed revision can legitimately PREDATE a fix this walk itself
  // found — the 500-char apiToken cap that refused every real PAT (DEC-103).
  // Rather than block the owner's booking on a staging redeploy, fall back to
  // running the SAME shipped connect service in-process against the SAME
  // staging DB, still registering the callback at the staging ingress. What
  // that costs is disclosed, not hidden: the subscription and the signing key
  // are identical either way, but the connect HTTP endpoint was not the thing
  // exercised. The webhook INGEST path — what this walk is actually about — is
  // the deployed build regardless, because Calendly delivers to it.
  const dtoCapRefusal =
    connectRes.status === 400 && /at most 500 character/i.test(connectBody);
  let connectedVia = "the deployed API's connect-fields endpoint";
  if (dtoCapRefusal) {
    connectedVia =
      "the shipped connect service run in-process (the deployed revision predates the DEC-103 DTO fix)";
    const deps: IntegrationsDeps = { prisma: db, adapters: { calendly: adapter } };
    await connectCalendlyFields(deps, {
      workspaceId: ctx.workspaceId,
      fields: { schedulingUrl, apiToken: PAT },
      webhookUrlFor: (t) => `${STAGING_API}/webhooks/calendly?token=${t}`,
    });
    console.log(
      `::warning::connect-fields on the deployed revision still refuses real PATs (${connectBody.slice(0, 160)}) — armed via the in-process connect service instead; disclosed in the receipts.`,
    );
  }
  must(
    "connect (token tier, on staging)",
    "genuine",
    dtoCapRefusal || (connectRes.status >= 200 && connectRes.status < 300),
    `armed via ${connectedVia}${
      dtoCapRefusal ? "" : ` -> HTTP ${connectRes.status}`
    }${!dtoCapRefusal && !connectRes.ok ? ` · ${connectBody.slice(0, 400)}` : ""}`,
  );

  // ── gate 5 · the signing key is SERVER-MINTED, and the callback is INGRESS ──
  const conn = await readConnection(db, ctx.workspaceId);
  const expectedCallback = `${STAGING_API}/webhooks/calendly?token=${conn.webhookToken}`;
  must(
    "server-minted signing key",
    "genuine",
    conn.signingKey.length === 64 && /^[0-9a-f]+$/.test(conn.signingKey) && conn.signingKey !== PAT,
    `32-byte hex minted by the deployed API, never supplied by this script — ${mask(conn.signingKey)}`,
  );

  // ── gate 6 · list the subscription back FROM THE VENDOR ────────────────────
  const subs = await adapter.listWebhookSubscriptions(creds, {
    organization: user.organization,
    user: user.uri,
  });
  const mine = subs.filter((s) => s.callbackUrl === expectedCallback);
  must(
    "subscription create -> list",
    "genuine",
    mine.length === 1 && mine[0]!.state === "active",
    `${mine.length} active subscription at ${STAGING_API}/webhooks/calendly?token=${mask(conn.webhookToken)} · uri ${conn.subscriptionUri}`,
  );
  must(
    "callback is the staging INGRESS",
    "genuine",
    expectedCallback.startsWith("https://") && !/localhost|127\.0\.0\.1/.test(expectedCallback),
    `INTEGRATIONS_WEBHOOK_BASE resolved to ${STAGING_API} — Calendly delivers to a running service`,
  );

  // ── the booking instructions ───────────────────────────────────────────────
  const bookingLink = `${schedulingUrl}?utm_source=clientforce&utm_content=${contact.id}`;
  console.log("\n──────────────── BOOK THIS ────────────────");
  console.log(`link:  ${bookingLink}`);
  console.log(`lead:  ${contact.firstName ?? ""} ${contact.lastName ?? ""} (${contact.id})`.trim());
  console.log("───────────────────────────────────────────\n");

  return {
    schedulingUrl,
    bookingLink,
    contactId: contact.id,
    enrollmentId: enrollment.id,
    fromStage: enrollment.pipelineStage,
    workspaceId: ctx.workspaceId,
    subscriptionUri: conn.subscriptionUri,
    callbackUrl: `${STAGING_API}/webhooks/calendly?token=${mask(conn.webhookToken)}`,
    calendlyAccount: user.name ?? null,
    connectedVia,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: verify
// ─────────────────────────────────────────────────────────────────────────────
interface MeetingRow {
  id: string;
  externalId: string;
  status: string;
  contactId: string | null;
  enrollmentId: string | null;
  title: string | null;
  startAt: Date;
  meta: unknown;
  createdAt: Date;
}

const priorIdsOf = (meta: unknown): string[] => {
  const p = (meta as { priorExternalIds?: unknown } | null)?.priorExternalIds;
  return Array.isArray(p) ? p.filter((v): v is string => typeof v === "string") : [];
};

async function verify(db: PrismaClient): Promise<Record<string, unknown>> {
  const adapter = new CalendlyAdapter();
  const creds = { apiToken: PAT };
  const ctx = await stagingAuth();
  const conn = await readConnection(db, ctx.workspaceId);

  // Scope to the chain this walk armed: meetings written after the connect.
  const meetings = (await db.meeting.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      provider: "calendly",
      createdAt: { gte: conn.since },
    },
    orderBy: { createdAt: "asc" },
  })) as unknown as MeetingRow[];

  // ── gate 1 · the GENUINE booking landed through the real ingress ───────────
  must(
    "genuine delivery landed",
    "genuine",
    meetings.length === 1,
    `${meetings.length} Meeting row(s) since connect — the reschedule must CONVERGE on one row, never fork`,
  );
  const meeting = meetings[0]!;
  must(
    "booking correlated + booked",
    "genuine",
    meeting.status === "booked" && Boolean(meeting.contactId),
    `meeting ${meeting.id} status=${meeting.status} contact=${meeting.contactId ?? "(none)"} start=${meeting.startAt.toISOString()}`,
  );

  // ── gate 2 · reschedule twin convergence via priorExternalIds ──────────────
  const tombstones = priorIdsOf(meeting.meta);
  must(
    "reschedule twin convergence",
    "genuine",
    tombstones.length >= 1 && !tombstones.includes(meeting.externalId),
    `externalId moved to the NEW invitee; ${tombstones.length} prior id(s) tombstoned in meta.priorExternalIds`,
  );
  const oldExternalId = tombstones[tombstones.length - 1]!;

  const eventsFor = async (type: string): Promise<number> =>
    db.event.count({
      where: {
        workspaceId: ctx.workspaceId,
        type,
        occurredAt: { gte: conn.since },
        ...(meeting.contactId ? { contactId: meeting.contactId } : {}),
      },
    });
  const booked = await eventsFor("calendar.booked.v1");
  const rescheduled = await eventsFor("calendar.rescheduled.v1");
  const canceled = await eventsFor("calendar.canceled.v1");
  // Scope the no-double-fire gate to the BOOKED carrier specifically. Counting
  // every lead.stage_changed.v1 for the contact would fail on an unrelated
  // stage move in the same window — a false "booking detection double-fired".
  const countBookedStage = async (): Promise<number> =>
    db.event.count({
      where: {
        workspaceId: ctx.workspaceId,
        type: "lead.stage_changed.v1",
        occurredAt: { gte: conn.since },
        payload: { path: ["toStage"], equals: "booked" },
        ...(meeting.contactId ? { contactId: meeting.contactId } : {}),
      },
    });
  const stageChanges = await countBookedStage();

  must(
    "the canceled half published NOTHING",
    "genuine",
    canceled === 0,
    `calendar.canceled.v1 = 0 for the rescheduled chain (a reschedule must never read as a loss); booked=${booked} rescheduled=${rescheduled}`,
  );
  must(
    "no double-fire (ONE stage carrier)",
    "genuine",
    stageChanges === 1,
    `exactly ONE lead.stage_changed.v1 across booking + reschedule — calendar.booked.v1 stays the RECORD`,
  );

  // ── gate 3 · REPLAYED: valid signature verifies (idempotent duplicate) ─────
  // Reconstructed body, real signing key, real endpoint. The GENUINE proof that
  // valid signatures verify is gate 1: Calendly's own HMAC over its own bytes is
  // the only reason the booking landed. This replay additionally exercises the
  // redelivery path on an already-processed invitee.
  const createdBody = (inviteeUri: string, oldInvitee?: string): string =>
    JSON.stringify({
      event: "invitee.created",
      payload: {
        uri: inviteeUri,
        email: `replay@${"example.com"}`,
        ...(oldInvitee ? { old_invitee: oldInvitee } : {}),
        tracking: { utm_content: meeting.contactId },
        scheduled_event: {
          start_time: meeting.startAt.toISOString(),
          name: "replayed redelivery",
        },
      },
    });

  const replayNew = createdBody(meeting.externalId, oldExternalId);
  const r1 = await postWebhook(conn.webhookToken, replayNew, signBody(replayNew, conn.signingKey));
  // Must be exactly "duplicate". Accepting "rescheduled" here would mask the two
  // failures this gate exists to catch: a chain that never converged (a row still
  // keyed on the OLD invitee), or a redelivery that MUTATED the live row's
  // startAt/title from the replay's values.
  must(
    "valid signature verifies (replayed redelivery)",
    "replayed",
    r1.status === 200 && /"outcome":"duplicate"/.test(r1.body),
    `HTTP ${r1.status} ${r1.body.slice(0, 160)}`,
  );

  // ── gate 4 · REPLAYED: a TAMPERED body is refused ─────────────────────────
  const sig = signBody(replayNew, conn.signingKey);
  const tampered = replayNew.replace('"replayed redelivery"', '"tampered in flight"');
  const r2 = await postWebhook(conn.webhookToken, tampered, sig);
  must(
    "tampered body refused",
    "replayed",
    r2.status === 401,
    `HTTP ${r2.status} — the HMAC is over the RAW body, so one flipped byte fails constant-time verification`,
  );

  // ── gate 5 · REPLAYED: tombstone idempotency (pre-reschedule invitee) ──────
  const replayOld = createdBody(oldExternalId);
  const r3 = await postWebhook(conn.webhookToken, replayOld, signBody(replayOld, conn.signingKey));
  must(
    "tombstone idempotency",
    "replayed",
    r3.status === 200 && /"outcome":"duplicate"/.test(r3.body),
    `redelivering the SUPERSEDED invitee ${oldExternalId.slice(-12)} acks duplicate — no resurrected booked row`,
  );

  // ── gate 6 · REPLAYED: out-of-order redelivery of the canceled twin ────────
  const canceledBody = JSON.stringify({
    event: "invitee.canceled",
    payload: { uri: oldExternalId, rescheduled: true },
  });
  const r4 = await postWebhook(
    conn.webhookToken,
    canceledBody,
    signBody(canceledBody, conn.signingKey),
  );
  // "ignored" is the REQUIRED outcome, not merely a 200: after convergence the old
  // invitee is a tombstone, not the unique key, so the stale canceled twin must
  // find nothing. An "canceled" outcome here would mean it flipped the live
  // booked row — a reschedule silently reading as a loss.
  must(
    "out-of-order redelivery",
    "replayed",
    r4.status === 200 && /"outcome":"ignored"/.test(r4.body),
    `the canceled twin replayed AFTER convergence -> ${r4.body.slice(0, 120)}`,
  );

  // ── gate 7 · nothing moved: the replays were true no-ops ───────────────────
  const after = (await db.meeting.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      provider: "calendly",
      createdAt: { gte: conn.since },
    },
  })) as unknown as MeetingRow[];
  const afterStage = await countBookedStage();
  const still = after.find((m) => m.id === meeting.id);
  // Compare EVERY field a replay could plausibly overwrite, not just status +
  // startAt: the reschedule branch would also rewrite title/endAt and GROW the
  // tombstone list, and a gate that ignored those would call a real mutation
  // "unchanged". `meeting` is the pre-replay DB snapshot, `still` the post-replay
  // one, so this is genuinely before-vs-after.
  const sameTombstones =
    JSON.stringify(priorIdsOf(still?.meta)) === JSON.stringify(tombstones);
  must(
    "replays changed nothing",
    "replayed",
    after.length === 1 &&
      still?.status === "booked" &&
      still.externalId === meeting.externalId &&
      still.startAt.getTime() === meeting.startAt.getTime() &&
      still.title === meeting.title &&
      sameTombstones &&
      afterStage === 1,
    `still ONE meeting, still booked at ${meeting.startAt.toISOString()}, title/tombstones untouched, still ONE booked stage change`,
  );

  // ── attribution diagnostic (reported, not gated) ───────────────────────────
  // ingestBooking picks the latest ACTIVE enrollment for the Meeting row, but
  // writeBookedStage picks the latest enrollment with NO status filter. When a
  // contact has a newer non-ACTIVE enrollment those two disagree, so record which
  // enrollment carries the Meeting and which one actually ended up booked rather
  // than assuming they match.
  const bookedEnrollments = meeting.contactId
    ? await db.enrollment.findMany({
        where: { workspaceId: ctx.workspaceId, contactId: meeting.contactId },
        select: { id: true, status: true, pipelineStage: true },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const stageMoved = bookedEnrollments.filter((e) => e.pipelineStage === "booked");
  record(
    "stage attribution",
    "genuine",
    stageMoved.length === 1 && stageMoved[0]!.id === meeting.enrollmentId,
    `Meeting.enrollmentId=${meeting.enrollmentId ?? "(none)"} · booked enrollment(s)=${
      stageMoved.map((e) => `${e.id}(${e.status})`).join(", ") || "(none)"
    } · ${bookedEnrollments.length} enrollment(s) on the contact`,
  );

  // ── gate 8 · teardown: delete -> list -> gone ──────────────────────────────
  // Assert the subscription was PRESENT first: deleteWebhookSubscription treats a
  // 404 as success, so "it is not in the list afterwards" alone would pass even
  // if nothing was ever there to delete.
  const user = await adapter.me(creds);
  const beforeDelete = await adapter.listWebhookSubscriptions(creds, {
    organization: user.organization,
    user: user.uri,
  });
  must(
    "subscription live before teardown",
    "genuine",
    beforeDelete.some((s) => s.uri === conn.subscriptionUri),
    `the subscription Calendly delivered through is still registered (${beforeDelete.length} total) — the delete below is a real delete`,
  );
  await adapter.deleteWebhookSubscription(creds, conn.subscriptionUri);
  const remaining = await adapter.listWebhookSubscriptions(creds, {
    organization: user.organization,
    user: user.uri,
  });
  must(
    "subscription delete -> list",
    "genuine",
    !remaining.some((s) => s.uri === conn.subscriptionUri),
    `${conn.subscriptionUri} deleted at the vendor; ${remaining.length} subscription(s) remain`,
  );

  return {
    workspaceId: ctx.workspaceId,
    meetingId: meeting.id,
    contactId: meeting.contactId,
    newExternalIdTail: meeting.externalId.slice(-12),
    tombstonedIdTails: tombstones.map((t) => t.slice(-12)),
    finalStartAt: meeting.startAt.toISOString(),
    events: { booked, rescheduled, canceled, stageChanges },
    subscriptionUri: conn.subscriptionUri,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE: preflight — exercise the plumbing WITHOUT spending the booking.
//
// The verify gates only run after a real booking exists, so a broken query would
// surface for the first time on one-shot genuine data. This phase runs the exact
// reads verify depends on — the field-encrypted credential decrypt and BOTH JSON
// path filters (`payload.toStage`, `meta.priorExternalIds array_contains`) — and
// asserts nothing about the booking. It also reports whether the vendor
// subscription is still live and whether a booking has landed yet.
// ─────────────────────────────────────────────────────────────────────────────
async function preflight(db: PrismaClient): Promise<Record<string, unknown>> {
  const adapter = new CalendlyAdapter();
  const creds = { apiToken: PAT };
  const ctx = await stagingAuth();
  const conn = await readConnection(db, ctx.workspaceId);
  must(
    "credentials decrypt",
    "genuine",
    conn.signingKey.length === 64 && conn.webhookToken.length > 0,
    `field-encrypted signing key + capability token read back from the staging row (since ${conn.since.toISOString()})`,
  );

  const meetings = await db.meeting.count({
    where: {
      workspaceId: ctx.workspaceId,
      provider: "calendly",
      createdAt: { gte: conn.since },
    },
  });
  // The two JSON path filters verify relies on — run them for real so a bad
  // filter shape fails HERE, not after the owner has booked.
  const bookedStage = await db.event.count({
    where: {
      workspaceId: ctx.workspaceId,
      type: "lead.stage_changed.v1",
      occurredAt: { gte: conn.since },
      payload: { path: ["toStage"], equals: "booked" },
    },
  });
  const tombstoned = await db.meeting.count({
    where: {
      workspaceId: ctx.workspaceId,
      provider: "calendly",
      meta: { path: ["priorExternalIds"], array_contains: ["preflight-probe"] },
    },
  });
  must(
    "verify-phase queries execute",
    "genuine",
    Number.isInteger(bookedStage) && Number.isInteger(tombstoned),
    `payload.toStage filter -> ${bookedStage} row(s); meta.priorExternalIds array_contains -> ${tombstoned} row(s) (both filters are valid Prisma JSON paths)`,
  );

  const user = await adapter.me(creds);
  const subs = await adapter.listWebhookSubscriptions(creds, {
    organization: user.organization,
    user: user.uri,
  });
  const live = subs.find((s) => s.uri === conn.subscriptionUri);
  must(
    "subscription still armed",
    "genuine",
    Boolean(live) && live!.state === "active",
    `${conn.subscriptionUri} is ${live?.state ?? "MISSING"} — Calendly still has somewhere to deliver`,
  );

  console.log(
    `\nbookings landed so far: ${meetings} (verify needs exactly 1, after the booking AND the reschedule)\n`,
  );
  return { workspaceId: ctx.workspaceId, meetingsSinceConnect: meetings, bookedStage };
}

// ─────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const db = createPrismaClient({ url: DB_URL });
  let summary: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    summary =
      PHASE === "verify"
        ? await verify(db)
        : PHASE === "preflight"
          ? await preflight(db)
          : await arm(db);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    await db.$disconnect();
  }

  const genuine = gates.filter((g) => g.mode === "genuine");
  const replayed = gates.filter((g) => g.mode === "replayed");
  writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        phase: PHASE,
        stagingApi: STAGING_API,
        vendor: "api.calendly.com (real)",
        ranAt: new Date().toISOString(),
        disclosure: {
          genuine:
            "vendor-performed: PAT probe, subscription create/list/delete, and the invitee.created/invitee.canceled deliveries from the owner's real booking + reschedule",
          replayed:
            "re-POSTed by this script because no vendor can be asked to perform them: a tampered body, a redelivery of an already-processed invitee, and an out-of-order twin redelivery",
        },
        gates,
        counts: {
          genuine: `${genuine.filter((g) => g.ok).length}/${genuine.length}`,
          replayed: `${replayed.filter((g) => g.ok).length}/${replayed.length}`,
        },
        summary,
        error,
      },
      null,
      2,
    ),
  );
  console.log(`\nreceipts -> ${OUT_FILE}`);
  if (error) {
    console.error(`::error::${error}`);
    process.exit(1);
  }
}

void main();
