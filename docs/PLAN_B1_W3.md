# PLAN — Platform backoffice, wave W3 (unit "B1 W3", DEC-081, 2026-07-15)

> Status: **PLAN POSTED** — branch `claude/session-oxcd68`. Wave W3 of the B1 unit
> (builds on W1/DEC-079 #95 + W2/DEC-080 #97, merged). Plan-comment-first per
> protocol; W4 follows as its own PR.
>
> **Provider: self-hosted PostHog behind the adapter — owner-confirmed 2026-07-15.**

## Goal

Make product decisions evidence-based (FR-TELEM-01..04): instrument operator/product
actions as **versioned, PII-free** events behind a swappable adapter, and show the
adoption picture in the backoffice — activation funnel, DAU/WAU, feature-adoption
matrix, cohort retention — with statistical-honesty floors.

## Privacy rail (the load-bearing constraint — a pinned test, not a convention)

**Payloads carry ids + event names only — never message bodies, contact PII, or
knowledge content. Internal-only, excluded from tenant-facing Analytics.**

Enforced structurally: every telemetry event's zod payload schema admits **only**
id-shaped fields (`workspaceId`, `agencyId`, `actorId`, `agentId`, `entityId`) plus
enums / counts / durations. A **schema-pinned test** asserts no telemetry schema
declares any key on the PII/body denylist (`email`, `phone`, `name`, `body`,
`subject`, `content`, `text`, `message`, `address`, `firstName`, `lastName`, …).
PII cannot be represented, so it cannot leak — and the test fails the build if a
future event tries.

## Data model (additive only)

```prisma
model TelemetryEvent {           // platform-global, backoffice-only (REVOKEd from app role)
  id         String   @id @default(cuid())
  name       String   // versioned type, e.g. "product.agent_launched.v1"
  actorType  String   // "operator" | "user" | "system"
  actorId    String?  // id only — never an email/name
  workspaceId String?
  agencyId   String?
  entityId   String?  // agent/campaign/… id the event is about
  props      Json     // ids/enums/counts ONLY (privacy rail)
  occurredAt DateTime
  createdAt  DateTime @default(now())
  @@index([name, occurredAt])
  @@index([workspaceId, occurredAt])
}
```

Powers the backoffice dashboards + the sample floor; **dual-written** with the
PostHog forward so dashboards are self-contained and testable even with the
vendor mocked.

## Telemetry catalog (`packages/telemetry`) — versioned like all events

`product.signup.v1` · `product.agent_created.v1` · `wizard.step_completed.v1` ·
`wizard.step_abandoned.v1` · `product.agent_launched.v1` · `product.first_send.v1` ·
`product.first_reply.v1` · `feature.first_used.v1` · `agent.takeover.v1` ·
`agent.regenerated.v1` · `settings.edited.v1`. Additive; a new version is a new
`.v2` key, old keys kept forever (the A9 rule).

## Adapter (provider stays swappable)

```ts
export interface TelemetrySink { capture(e: TelemetryEvent): Promise<void> | void; }
```
- **`PostHogSink`** (self-hosted) — POSTs to `${POSTHOG_HOST}/capture/` with
  `api_key` + `event` + `distinct_id` + id-only `properties`. **SDK-free (fetch)**;
  the ONLY place the provider is referenced. Enabled when `POSTHOG_HOST`+`POSTHOG_KEY`
  are set (config in `packages/config`).
- **`NoopSink`** — the default (CI/tests; vendors mocked per the rails).
- **`LogSink`** — dev.

## Instrumentation (additive, from the event catalog)

A **telemetry consumer** on the existing event bus (a 4th `ConsumerHook`, the
DEC-035 injected-deps pattern) maps domain events → PII-stripped telemetry →
`{ sink, TelemetryEvent store }`: e.g. `email.sent.v1` → first-send (first per
workspace), `email.replied.v1` → first-reply, `lead.enrolled.v1` → activation,
agent lifecycle → created/launched. A handful of thin, id-only emit points cover
non-domain actions (wizard step complete/abandon, takeover, regen, settings edit).
No planner/prompt changes; no send-path changes.

## Dashboards (backoffice)

`/backoffice/adoption` (or tabs): **activation funnel** (signup → agent → launch →
first send → first reply → goal, counts + conversion), **DAU/WAU** per workspace,
**feature-adoption matrix**, **cohort retention** — all computed from
`TelemetryEvent`. Below the sample floor → **"low data"**, never an invented rate.

## Explicitly deferred

- **W4** — fleet health, abuse surfacing, per-agency/channel kill switch, read-only
  impersonation, feature flags.
- **`ai.spend.v1` metering** (the W2 honest-absence gap) rides here as a telemetry
  event, closing the AI-spend column in W2's usage view.

## Acceptance

- the activation funnel populates from real staged operator actions;
- **telemetry payloads contain zero message/PII content** (schema-pinned test);
- the low-data floor renders below sample size, never a fabricated metric;
- swapping the sink (Noop ↔ PostHog) leaves instrumentation + call sites untouched;
- dashboards compute from the local `TelemetryEvent` store (vendor mocked in CI);
- RLS regression pinned (`TelemetryEvent` REVOKEd from `clientforce_app`).
- `pnpm build`/`lint`/`test` green vs real Postgres.

DEC-081 claimed at dispatch (collision-free vs main `e9b0a0e`).
