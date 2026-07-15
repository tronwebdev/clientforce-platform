# PLAN — Platform backoffice, wave W4 (unit "B1 W4", DEC-082, 2026-07-15)

> Status: **PLAN POSTED** — branch `claude/session-oxcd68`. The final wave of the
> B1 unit (builds on W1/#95 · W2/#97 · W3/#98, all merged). Plan-comment-first per
> protocol. **This closes the B1 unit.**

## Goal

Operational safety + control (FR-ADMIN-04/05/06): fleet sender-health, abuse
outlier surfacing, a per-agency/per-channel kill switch, audited read-only
impersonation + delivery diagnostics, and per-tenant feature flags +
model/prompt version-pin visibility. All on the W1 backoffice rail (platform-staff
auth, RLS-exempt client, audited mutations).

## Load-bearing constraints (owner-directed)

1. **Kill switch EXTENDS the existing boundary refusal enum** (the W1
   `TENANT_SUSPENDED` pattern) — a new `SendBlockReason` value + a boundary gate,
   **never a fork** of the send path.
2. **Impersonation is READ-ONLY** — banner-marked in the UI, an audit row per
   session, and **no write path to tenant content** whatsoever.
3. **Fleet sender-health CONSUMES P5-W1's health-score endpoint** — health is
   computed ONCE, by P5-W1. P5-W1 is **not on main yet**, so the backoffice codes
   against its **contract** (a `SenderHealthClient` interface + DTO) and **pins the
   interlock**; when P5-W1 isn't wired, the score is an honest absence
   ("pending P5-W1"), never a second computation in the backoffice.
4. **Feature flags + version-pin visibility are READ-ONLY where they must be** —
   flags are per-tenant toggles (audited); model/prompt version pins are
   display-only.

## Data model (additive only)

> **Access-model refinement (found at build):** unlike the fully-REVOKEd W1–W3
> backoffice tables, `KillSwitch` and `FeatureFlag` are **app-READABLE** — the send
> boundary reads `KillSwitch` on the RLS-subject `clientforce_app` client
> (`assertChannelLive`, no GUC → no RLS policy), and feature gates read
> `FeatureFlag`. So `clientforce_app` KEEPS `SELECT` but loses INSERT/UPDATE/DELETE
> (only the backoffice writes). Both halves are RLS-regression-pinned.

```prisma
model KillSwitch {            // per-agency / per-channel; presence+active = killed
  id        String   @id @default(cuid())
  agencyId  String
  channel   String   // "email" | "sms" | "whatsapp" | "voice"
  active    Boolean  @default(true)
  reason    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@unique([agencyId, channel])
}

model FeatureFlag {           // per-tenant flags (workspace-scoped)
  id          String   @id @default(cuid())
  workspaceId String
  key         String
  enabled     Boolean  @default(false)
  updatedAt   DateTime @updatedAt
  @@unique([workspaceId, key])
}
```

Impersonation reuses `BackofficeAuditLog` (`action: "impersonate.start"`); no new
model. Fleet health consumes P5-W1's endpoint — no new model.

## Send boundary (extend, don't fork)

A new `SendBlockReason` value **`CHANNEL_KILLED`**; a shared
`assertChannelLive(prisma, workspaceId, channel)` gate called alongside
`assertTenantActive` at the top of the email + SMS boundaries. It looks up an
active `KillSwitch` for the workspace's agency + channel and throws the typed
refusal (disposition PAUSED — reversible; clearing the switch restores sending).
Reason enum extended, path unchanged — exactly the W1 `TENANT_SUSPENDED` shape.

## API (backoffice, staff-auth + audited)

- **Fleet health** — `GET /backoffice/fleet-health`: per-sender health SCORE from
  the injected `SenderHealthClient` (P5-W1's endpoint; honest "pending" when
  unwired) + backoffice-computed **bounce/spam/refusal outliers** and suppression
  anomalies from the event ledger (`email.bounced/spam.v1`, `sms.failed.v1`,
  `*.compose_refused.v1`) — thresholds + human review, no ML (v1).
- **Kill switch** — `GET /backoffice/kill-switches`, `POST /backoffice/kill-switches`
  (set/clear per agency+channel, typed, reversible, audited).
- **Impersonation** — `POST /backoffice/impersonate` (audited session start,
  `impersonate.start`) + read-only `GET /backoffice/workspaces/:id/messages`
  (rendered previews). No write endpoints.
- **Feature flags** — `GET/POST /backoffice/workspaces/:id/flags` (audited) +
  `GET /backoffice/version-pins` (read-only model/prompt pin visibility).

## UI (backoffice)

`/backoffice/fleet` (health + outliers + version pins) · `/backoffice/kill-switches`
(per-agency/per-channel toggles) · `/backoffice/impersonate` (workspace picker →
read-only message viewer, **banner**) · `/backoffice/flags` (workspace picker +
per-flag toggles). Statistical-honesty + honest-absence throughout.

## Acceptance

- kill switch stops one channel for one agency with a typed `CHANNEL_KILLED`
  refusal (a Logs row) → clearing it restores (driven through the real send
  boundary); reason enum extended, send path unchanged;
- impersonation is read-only + banner-marked + writes an audit row; there is NO
  tenant-content write path (proven);
- fleet health consumes the P5-W1 contract (interlock pinned); the backoffice does
  not recompute the health score (honest "pending" when P5-W1 is unwired);
- feature flags toggle per tenant (audited); version pins are read-only;
- RLS regression pinned: `clientforce_app` is SELECT-only on `KillSwitch`/`FeatureFlag`
  (write REVOKEd), the W1–W3 backoffice tables stay fully REVOKEd; API suite
  green vs real Postgres; §8 build evidence under `docs/fidelity/b1-w4/`.

## Explicitly out (per the unit's scope fences)

Automated abuse ML (v1 is thresholds + human review); agency-facing analytics;
tenant-visible status page; agency payouts.

DEC-082 claimed at dispatch (collision-free vs main `1adbad8`). **Closes B1.**
