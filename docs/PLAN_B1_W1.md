# PLAN — Platform backoffice, wave W1 (unit "B1 W1", DEC-079, 2026-07-15)

> Status: **IN REVIEW** — branch `claude/session-oxcd68`. This is the plan comment
> for W1 of the B1 unit ("Platform backoffice + product telemetry", Phase 10.5).
> W2–W4 ship as their own PRs (scope fences below).

## Goal

Give the **platform operator** (not the agency admin) a console to run the
business. Every admin surface built so far is tenant-side; FR-ADMIN-01 needs an
**internal** surface that reads across tenants deliberately, scoped, and
audited. W1 delivers the shell + staff auth + audit log + tenant management
(list-search, suspend/reactivate, manual credit adjustments).

## Access model (the load-bearing decision)

The backoffice is a **separate trust boundary**. It does NOT ride tenant RBAC or
RLS.

- **Separate identity + auth rail.** Platform staff are an owner-managed
  allow-list (`PlatformStaff`), distinct from tenant `User`s, on their own cookie
  (`cf_staff_session`) and token audience (`clientforce-backoffice`). A tenant
  dev-JWT (audience `clientforce`) fails the backoffice guard outright; login
  only mints a token for an ACTIVE allow-list row. **Two gates** (audience +
  allow-list) → a tenant credential can never open the backoffice (proven in the
  API e2e).
- **RLS-exempt DB role, backoffice-only.** A dedicated `clientforce_backoffice`
  role carries `BYPASSRLS`; the RLS-subject `clientforce_app` role is REVOKEd
  from the backoffice tables. Tenant/feature paths keep `withTenant` +
  `createAppPrismaClient` untouched (regression pinned).
- **Every action is audited.** Each mutation writes one append-only
  `BackofficeAuditLog` row (operator, action, target, reason) in the same tx.

## Data model (additive only)

```prisma
model PlatformStaff {            // owner-managed allow-list, distinct from tenant Users
  id String @id @default(cuid())
  email String @unique
  name String?
  role   PlatformStaffRole   @default(OPERATOR)   // OPERATOR | ADMIN
  status PlatformStaffStatus @default(ACTIVE)     // ACTIVE | DISABLED
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  auditLog BackofficeAuditLog[]
}

model BackofficeAuditLog {       // append-only; one row per backoffice mutation
  id String @id @default(cuid())
  operatorId String
  operator PlatformStaff @relation(fields: [operatorId], references: [id])
  operatorEmail String            // denormalized so the audit survives staff renames
  action String                   // "agency.suspend", "workspace.credit.adjust", …
  targetType String               // "agency" | "workspace"
  targetId String
  reason String?
  metadata Json?                  // { before, after, delta, balanceAfter, … }
  createdAt DateTime @default(now())
}
```

Both tables are **platform-global** (no `workspaceId`, no RLS policy — same
precedent as `Plan`/`CreditPrice`). The migration also:
`CREATE ROLE clientforce_backoffice LOGIN BYPASSRLS` + grants; and
`REVOKE ALL ON PlatformStaff, BackofficeAuditLog FROM clientforce_app`.

No destructive change. Suspend/reactivate reuses the existing
`TenantStatus { ACTIVE, SUSPENDED, ARCHIVED }`; credit grants reuse the existing
append-only `CreditLedger` (its write path, previously absent, is defined here).

## API (NestJS, zod DTOs in `packages/core`)

`BackofficeModule` — self-contained: owns the RLS-exempt client (`BackofficeDb`),
the staff-auth guard, and the service; imports NO tenant modules. Controllers are
`@Public()` (bypass the global tenant guards) and governed by
`BackofficeAuthGuard`.

- `POST /backoffice/session` — dev-rail login; mints a staff token for an ACTIVE
  allow-list email only.
- `GET  /backoffice/me` — the operator identity.
- `GET  /backoffice/agencies?q&status` — agencies + workspaces (plan, status,
  created, last activity from the event ledger, credit balance).
- `POST /backoffice/agencies/:id/{suspend,reactivate}` — typed, reversible, audited.
- `POST /backoffice/workspaces/:id/{suspend,reactivate}` — same.
- `POST /backoffice/workspaces/:id/credit-adjustments` — one append-only ledger
  row + moved `Workspace.creditBalance`, atomically; ledger `refId` → audit row.
- `GET  /backoffice/workspaces/:id/credit-ledger` · `GET /backoffice/audit-log`.

**Send-boundary integration (no fork).** A new `TENANT_SUSPENDED` value on
`SendBlockReason`; a shared `assertTenantActive` gate at the top of the email +
SMS boundaries refuses a SUSPENDED workspace/agency (disposition PAUSED —
reversible). Reason enum extended, send path unchanged.

## UI surfaces (web)

A separate `/backoffice` route tree on its own auth rail (no tenant `Sidebar`):

1. `/backoffice/login` — operator sign-in (outside the authed layout).
2. `/backoffice/tenants` — search + per-agency cards, each with a workspaces
   `DataTable` (status pills, credits, created, last activity) and
   suspend/reactivate + credit-grant modals (reason required, audited).
3. `/backoffice/audit` — the append-only audit trail.

Auth plumbing: `/api/staff-auth/{login,logout}` (cookie mint/clear) and
`/api/bo/[...path]` (staff-cookie → Bearer proxy to `/backoffice/*`), with a
dedicated `backofficeMiddleware` branch gating `/backoffice/*` on
`cf_staff_session`.

## Explicitly deferred (own PRs)

- **W2** — usage rollups, provider-invoice reconciliation, credit-price editor
  (FR-ADMIN-02/03, FR-BILL-02/04). `CreditPrice` is already the backing store.
- **W3** — product telemetry + adoption dashboards (FR-TELEM-01..04); telemetry
  provider proposed in W3's plan comment for owner confirm.
- **W4** — fleet health, abuse surfacing, per-agency/channel kill switch,
  read-only impersonation, feature flags (FR-ADMIN-04/05/06). The kill switch
  extends the SAME `SendBlockReason` machinery seeded here.

## Fidelity

The backoffice is an **internal** surface — there is no design-handoff prototype
to diff against (flagged per A12). Built to `DESIGN_TOKENS.md` atoms + `packages/ui`
(warm canvas, `#35E834`, Bricolage/Hanken). §8 build set: `docs/fidelity/b1-w1/`.

## Acceptance (all verified locally against real Postgres + Redis)

- a platform-staff login sees ALL tenants; a tenant credential cannot open the
  backoffice (401, proven); disabled/non-allow-listed staff → 403;
- suspend → the tenant's sends refuse `TENANT_SUSPENDED` (422) → reactivate
  restores (driven through the real `/senders/test-send` boundary);
- a manual credit grant lands as an append-only ledger row + moved balance;
- every mutation writes a `BackofficeAuditLog` row;
- RLS regression pinned: `clientforce_backoffice` reads cross-tenant with no GUC
  while `clientforce_app` still fails closed and cannot read the backoffice tables.

`pnpm build` · `pnpm lint` · `pnpm test` all green (API 107 tests incl. the new
backoffice e2e; DB RLS pins). Web rail smoke-tested end to end.
