# Clientforce Platform — Data Model & Contracts

> The keystone spec. Everything (API, Temporal, automations, integrations, analytics) builds against
> the contracts here. Companion to `ARCHITECTURE.md` + `BUILD_PLAN.md`. Stack: PostgreSQL + `pgvector`,
> Prisma. Schema shown in Prisma-flavored pseudocode — close to copy-paste, adjust as you generate.
>
> **Conventions:** every tenant-scoped table carries `workspaceId` and is protected by Postgres **RLS**.
> IDs are `cuid()`. Timestamps `createdAt`/`updatedAt` on every model (omitted below for brevity).
> Money is integer **minor units** (cents). Credits are integers. Enums are Postgres enums.

---

## 1. Tenancy — the 3-level white-label hierarchy

This is foundational and cannot be retrofitted cheaply. Read `ARCHITECTURE.md §3b` first.

```prisma
model Agency {            // the white-label agency — top-level tenant & brand (sells to its own clients)
  id            String   @id @default(cuid())
  name          String
  slug          String   @unique            // subdomain / vanity
  branding      Json                          // logo, colors, custom domain, emailFrom
  planTier      AgencyPlan @default(GROWTH)    // plans are set at the AGENCY level (3 tiers); workspaces inherit
  status        TenantStatus @default(ACTIVE)
  stripeCustomerId String?
  workspaces    Workspace[]
}

model Workspace {           // a client / sub-account — the primary tenant boundary
  id            String   @id @default(cuid())
  agencyId    String
  agency      Agency @relation(fields: [agencyId], references: [id])
  name          String
  slug          String
  status        TenantStatus @default(ACTIVE)
  branding      Json?                          // optional per-workspace overrides
  planId        String?                        // → Plan
  creditBalance Int      @default(0)           // see Billing §7
  settings      Json                           // timezone, sending windows, defaults
  memberships   Membership[]
  // …all domain tables FK to workspaceId
  @@unique([agencyId, slug])
}

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  name          String?
  authProviderId String?  @unique             // Azure AD B2C / Clerk subject
  memberships   Membership[]
}

model Membership {          // user ↔ workspace + role (RBAC)
  id          String  @id @default(cuid())
  userId      String
  workspaceId String
  role        Role    @default(AGENT)          // OWNER | ADMIN | AGENT | VIEWER
  user        User      @relation(fields: [userId], references: [id])
  workspace   Workspace @relation(fields: [workspaceId], references: [id])
  @@unique([userId, workspaceId])
}

enum AgencyPlan { STARTER GROWTH SCALE }   // 3 tiers, set at agency level; rename freely
enum TenantStatus { ACTIVE SUSPENDED ARCHIVED }
enum Role { OWNER ADMIN AGENT VIEWER }
```

**RLS rule (every tenant table):** `USING (workspace_id = current_setting('app.workspace_id')::text)`.
The API sets `app.workspace_id` (and `app.agency_id` for agency-level views) per request after auth.

---

## 2. Knowledge & business context

```prisma
model KnowledgeSource {
  id          String  @id @default(cuid())
  workspaceId String
  agentId     String?                          // null = workspace-wide
  kind        SourceKind                       // WEBSITE | DOCUMENT | CONNECTOR | TEXT
  uri         String?                          // url or blob path
  label       String
  status      IngestStatus @default(PENDING)   // PENDING | INGESTING | READY | FAILED
  meta        Json
  chunks      KnowledgeChunk[]
}

model KnowledgeChunk {
  id          String  @id @default(cuid())
  workspaceId String
  sourceId    String
  content     String
  embedding   Unsupported("vector(1536)")      // pgvector; text-embedding-3-large @ dimensions=1536
  tokens      Int
  @@index([sourceId])
}
```

> **P1.2 amendment (PR #25):** embeddings are pinned to **1536 dimensions**
> (`text-embedding-3-large` with `dimensions: 1536`, via `@clientforce/ai`'s
> `embed()`) so the column fits pgvector's 2,000-dim index ceiling, and the
> column carries an **hnsw cosine index**
> (`KnowledgeChunk_embedding_hnsw_idx`, `vector_cosine_ops`) — this resolves
> T1's TODO(phase-1). Retrieval is cosine top-k via `<=>`, always through the
> RLS-subject client.

```prisma

model BusinessContext {     // Claude-distilled profile the planner reads
  id          String  @id @default(cuid())
  workspaceId String
  agentId     String?                           // null = the WORKSPACE layer (Brand kit)
  goal        String?                           // agent layer: the wizard goal key
  status      ContextStatus @default(READY)     // DISTILLING | READY (A4 polling)
  fields      Json    @default("{}")            // registry-keyed map, see amendment below
  rawSummary  String  @default("")              // full distilled brief
  distilledAt DateTime?
}

enum ContextStatus { DISTILLING READY }

enum SourceKind { WEBSITE DOCUMENT CONNECTOR TEXT }
enum IngestStatus { PENDING INGESTING READY FAILED }
```

> **P1.3 amendment (PR #26, DEC-024/025):** `BusinessContext` is **two-layer** —
> one row per agent plus one **workspace-layer** row (`agentId` null; canonical
> home Settings → Brand kit). Uniqueness = partial unique indexes
> (`UNIQUE(agentId) WHERE agentId IS NOT NULL`, `UNIQUE(workspaceId) WHERE
agentId IS NULL` — Prisma can't express these, they live in the migration).
> The legacy fixed columns are replaced by **`fields`**: a map keyed by the
> owner-approved field registry (`packages/core`), each entry
> `{ value: string, citations: chunkId[], source: "distilled" | "typed" | "ai_decides" }`.
> Fills are **evidence-cited only** — a field without citations is a gap, never
> filled from model priors. The planner reads workspace + agent layers merged
> (agent wins); the gap checker evaluates both layers.

---

## 3. Agents, campaigns & the Campaign Graph

```prisma
model Agent {
  id           String  @id @default(cuid())
  workspaceId  String
  name         String
  goal         String                           // the primary objective
  category     String?
  instructions String?                          // freeform agent guidance
  status       AgentStatus @default(DRAFT)       // DRAFT | ACTIVE | PAUSED | ARCHIVED
  guardrails   Json                              // TYPED — must match the Guardrails schema in §3.2
  draftState   Json?                             // TYPED (core draftStateSchema) — wizard resume
                                                 // working set; NULL once launched (B6, PR #39)
  campaigns    Campaign[]
}

model Campaign {
  id          String  @id @default(cuid())
  workspaceId String
  agentId     String
  name        String
  graphId     String                            // → CampaignGraph (active version)
  status      CampaignStatus @default(ACTIVE)
  enrollments Enrollment[]
}

model CampaignGraph {       // versioned; the planner emits these, executor runs them
  id          String  @id @default(cuid())
  workspaceId String
  campaignId  String
  version     Int
  graph       Json                              // the typed graph — schema in §3.1
  source      GraphSource @default(AI)           // AI | TEMPLATE | MANUAL
  @@unique([campaignId, version])
}

enum AgentStatus { DRAFT ACTIVE PAUSED ARCHIVED }
enum CampaignStatus { ACTIVE PAUSED COMPLETED ARCHIVED }
enum GraphSource { AI TEMPLATE MANUAL }
```

### 3.1 CampaignGraph JSON schema (the planner's output contract)

A directed graph of typed nodes + conditional edges. **Validate every graph against this before it runs.**

```jsonc
{
  "entry": "n1", // id of the first node
  "nodes": [
    {
      "id": "n1",
      "type": "step",
      "channel": "email", // email | sms | whatsapp | voice | linkedin
      "content": {
        "subject": "Quick question about {{company}}", // email only
        "body": "Hi {{firstName}}, …", // tokens = personalization vars
        "template": "cf_case_study_v2", // whatsapp approved template id
        "buttons": ["Book a call", "Send breakdown"], // whatsapp quick replies
        "voice": { "persona": "ava-warm", "objective": "qualify & book", "script": "…" },
      },
      "pipelineOnSend": "contacted",
    }, // optional stage move
    { "id": "d1", "type": "delay", "amount": 2, "unit": "days" },
    { "id": "n2", "type": "step", "channel": "sms", "content": { "body": "…" } },
    {
      "id": "b1",
      "type": "branch",
      "on": "reply", // reply | open | click | call_outcome | no_response
      "cases": [
        { "when": { "intent": "interested" }, "goto": "sub:interested", "pipeline": "engaged" },
        { "when": { "intent": "not" }, "goto": "d2" },
        { "when": "default", "goto": "n2" },
      ],
    },
    { "id": "sub:interested", "type": "subcampaign", "ref": "subcampaign_id" },
  ],
  "edges": [
    { "from": "n1", "to": "d1" },
    { "from": "d1", "to": "n2" },
    { "from": "n2", "to": "b1" },
  ],
}
```

Node types: **`step`** (a channel send), **`delay`** (durable Temporal timer), **`branch`** (waits on an
event signal, routes by classified intent/condition), **`subcampaign`** (jump into a triggered sub-flow),
**`action`** (fire an agent tool / integration — e.g. send_proposal, book_meeting), **`end`**.
Tokens (`{{firstName}}`, `{{company}}`, `{{calendarLink}}`, `{{paymentLink}}` — INT W3, DEC-095)
resolve per-lead at render time.

### 3.2 Guardrails schema (typed contract — `PHASE1_HANDOFF.md §A8`)

`Agent.guardrails` is **not** freeform: it must match this shape (zod schema lives in
`packages/core`, enforced by the channel adapter **and** the workflow at the send boundary).
The wizard's Guardrails step and the agent-view Settings tab read/write exactly this:

```ts
Guardrails = {
  sendingWindow: { days: number[],           // 1–7, ISO weekday
                   start: string, end: string, // "09:00"/"17:00"
                   timezone: string },
  dailyCap:      { email: number },           // per-channel, extended later
  consent:       { attestedBy: string, attestedAt: string } | null,
  unsubscribeFooter: true,                    // literal true — not disableable
  suppressionCheck:  true                     // literal true — not disableable
}
```

---

## 4. Leads, enrollment & pipeline

```prisma
model Contact {             // a person in the workspace's CRM (deduped)
  id          String  @id @default(cuid())
  workspaceId String
  email       String?
  phone       String?
  firstName   String?
  lastName    String?
  company     String?
  title       String?
  source      String                            // auto-prospecting | import | form | widget | linkedin | manual
  enrichment  Json?                             // appended provider data (machine enrichment ONLY)
  custom      Json @default("{}")               // C2.7: user-entered custom-field values keyed by
                                                // ContactFieldDef.key — never mixed with enrichment
  tags        String[]
  optOut      Json                              // { email:false, sms:false, whatsapp:false }
  // LH1 (DEC-087): the validation verdict of record — valid | risky | invalid |
  // unverified (default). The enrollment gate reads this; the Suppression
  // ledger stays authoritative and a verdict NEVER un-suppresses.
  emailVerdict          String @default("unverified")
  emailVerdictCheckedAt DateTime?
  emailVerdictSource    String?                 // zerobounce | cache | syntax | mx
  lists       ContactListMember[]
  enrollments Enrollment[]
  events      ActivityEvent[]
  @@index([workspaceId, email])
  @@index([workspaceId, phone])
  @@index([workspaceId, emailVerdict])
}

model ContactFieldDef {      // C2.7 (docs/PLAN_CUSTOM_FIELDS.md): workspace custom field
  id          String  @id @default(cuid())
  workspaceId String
  key         String                            // slug, IMMUTABLE ("industry", "source_url")
  label       String                            // display ("Industry")
  type        FieldType @default(TEXT)          // TEXT | NUMBER | DATE | SELECT (creation UI: TEXT only)
  options     String[]                          // SELECT only
  origin      String                            // manual | csv_import
  archived    Boolean @default(false)           // archive-never-delete; values stay in Contact.custom
  @@unique([workspaceId, key])                  // max 30 ACTIVE defs per workspace (server-enforced)
}
// Personalization: {{custom.<key>|fallback}} — the fallback is MANDATORY at save
// time and the renderer emits value-or-fallback, never blank (P1.5 rule).

model Enrollment {          // a contact's run through one campaign = 1 Temporal workflow
  id           String  @id @default(cuid())
  workspaceId  String
  campaignId   String
  contactId    String
  workflowId   String  @unique                  // Temporal workflow id
  pipelineStage String                          // current PipelineStage.key
  currentNode  String?                          // node id in the graph
  status       EnrollmentStatus @default(ACTIVE) // ACTIVE | PAUSED | DONE | UNSUBSCRIBED | BOUNCED
  meta         Json    @default("{}")            // P1.6: user-visible run audit — {blocked:{nodeId,reason,detail,at}} + events[] (branch routing, deferred actions); the Logs tab renders refusals as amber rows (owner edit 2026-07-04)
  @@unique([campaignId, contactId])
}

model PipelineStage {
  id          String @id @default(cuid())
  workspaceId String
  campaignId  String?                           // null = workspace default pipeline
  key         String                            // contacted | engaged | interested | booked | won | lost
  label       String
  order       Int
}

// C2.8 (docs/PLAN_CONTACT_LISTS.md): lists = explicit stored membership;
// segments stay derived queries. origin reserves "form"|"widget"|"automation"
// for the integrations; archive, never delete. Membership changes emit
// list.member.added.v1 / list.member.removed.v1 (the Automations join points).
model ContactList {
  id String @id @default(cuid()) workspaceId String name String
  origin String                                  // manual | csv_import | form | widget | automation
  archived Boolean @default(false)
  members ContactListMember[]
  @@unique([workspaceId, name])
}
model ContactListMember {
  id String @id @default(cuid()) workspaceId String listId String contactId String
  addedAt DateTime @default(now()) addedBy String // userId | "import" | "automation"
  @@unique([listId, contactId])
}

enum EnrollmentStatus { ACTIVE PAUSED DONE UNSUBSCRIBED BOUNCED }

// LH1 (DEC-087): list hygiene — email validation at every ingress. One
// validation spine (ZeroBounce behind a swappable adapter), one enrollment
// gate; async, never blocking a flow. `Campaign` additionally gains
// `enrollmentDailyCap Int?` + `enrollmentCapEnabled Boolean @default(true)`
// (the per-day-per-campaign enrollment cap — bounds the QUEUE feeding the
// send caps; effective send volume stays min(warmup curve, dailyLimit)).

model EmailValidationVerdict {  // workspace-scoped verdict cache (TTL ~90d)
  id          String  @id @default(cuid())
  workspaceId String
  address     String                            // normalized lowercase — the cache key
  verdict     String                            // valid | risky | invalid
  subStatus   String?                           // provider sub-status (report detail)
  source      String                            // zerobounce | syntax | mx
  checkedAt   DateTime @default(now())
  expiresAt   DateTime
  billedAt    DateTime?                         // set ONLY on a PAID provider call — the COGS meter
  costMicros  Int      @default(0)              // (B1-W2 usage + zerobounce reconciliation read billedAt)
  @@unique([workspaceId, address])
}

model ValidationBatch {         // one async validation run (a CSV import, a single add)
  id          String  @id @default(cuid())
  workspaceId String
  clientKey   String?                           // web import idempotency key — all chunks, ONE batch
  source      String                            // csv_import | manual | single
  status      String  @default("queued")        // queued | running | held | completed
  heldReason  String?                           // workspace_allowance | platform_spend_ceiling | provider_unavailable
  listId      String?
  claimedUntil DateTime?                        // chunk-claim lease (double-billing guard)
  completedAt DateTime?
  items       ValidationBatchItem[]
  @@unique([workspaceId, clientKey])
}

model ValidationBatchItem {     // per-row report outcome, landing progressively
  id          String  @id @default(cuid())
  workspaceId String
  batchId     String
  contactId   String
  address     String
  outcome     String  @default("pending")       // pending | valid | risky | invalid | skipped_suppressed
  via         String?                           // zerobounce | cache | syntax | mx | suppression
  detail      String?
  billed      Boolean @default(false)
  @@unique([batchId, contactId])
}

model EnrollmentHold {          // the gate's hold queue — a persisted INTENT to enroll
  id           String @id @default(cuid())      // (owns NO workflow; becomes an Enrollment only back
  workspaceId  String                           //  through the gate as verdicts land / the cap frees)
  campaignId   String
  agentId      String
  contactId    String
  senderId     String?
  origin       Json?
  reason       String                           // unverified | risky_held | cap_overflow
  status       String @default("pending")       // pending | released | refused
  refusalCode  String?                          // CONTACT_INVALID
  enrollmentId String?                          // set when released
  @@unique([campaignId, contactId])
}
```

### 4.1 Message — the durable message store (`PHASE1_HANDOFF.md §A6`; migration in P1.5)

`Event` rows are a fan-out contract, **not** a message store. Every outbound is persisted here
**as rendered** at send time (P1.5); every inbound + its classified intent is persisted here (P1.7).
The Inbox threads and the lead-drawer timeline read `Message` (+ `Event` for non-message events);
events reference `messageId` in payloads rather than carrying bodies.

```prisma
model Message {
  id                String   @id @default(cuid())
  workspaceId       String
  campaignId        String
  enrollmentId      String?
  contactId         String
  channel           String              // "email" this phase
  direction         MessageDirection    // OUTBOUND | INBOUND
  subject           String?
  body              String              // rendered (outbound) / parsed (inbound)
  providerMessageId String?  @unique
  inReplyToId       String?             // → Message.id (threading)
  intent            String?             // inbound only, from P1.7 classification
  stepNodeId        String?             // outbound only, graph node that sent it
  sentAt            DateTime
  meta              Json?
  @@index([workspaceId, contactId, sentAt])
  @@index([workspaceId, campaignId, sentAt])
}
enum MessageDirection { OUTBOUND INBOUND }
```

### 4.2 Suppression — the opt-out ledger (`PHASE1_HANDOFF.md §A7`; enforcement in P1.5)

The workspace-level source of truth for "never send to this address". The email adapter checks
Suppression **and** `Contact.optOut` before every send (both tested); unsubscribe events write
both. Settings → Suppression is its UI.

```prisma
model Suppression {
  id          String   @id @default(cuid())
  workspaceId String
  channel     String              // "email" this phase
  address     String              // email address (or phone later)
  reason      SuppressionReason   // UNSUBSCRIBED | BOUNCED | SPAM_COMPLAINT | MANUAL
  source      String?             // "reply" | "link" | "import" | "admin"
  createdAt   DateTime @default(now())
  @@unique([workspaceId, channel, address])
}
enum SuppressionReason { UNSUBSCRIBED BOUNCED SPAM_COMPLAINT MANUAL }
```

### 4.3 Call — one row per phone call (P3.1 amendment, DEC-078)

The Calls tab's backing data. Transcript turns stay on `Message(channel:"voice")`
rows carrying `meta.callId` (the spike-proven A6 mapping — no Message change);
this row holds the call-level facts. Transcripts persist regardless of the
recording setting — the transcript is the always-on operational record.
`providerCallSid` is the idempotency key against Twilio callbacks. Message-style
loose references (no FKs) + indexes; RLS like every `workspaceId` table.

```prisma
model Call {
  id              String     @id @default(cuid())
  workspaceId     String
  campaignId      String
  agentId         String
  contactId       String
  enrollmentId    String?
  direction       MessageDirection   // OUTBOUND this phase (inbound calls are future)
  status          CallStatus @default(QUEUED)   // QUEUED | IN_PROGRESS | COMPLETED | FAILED
  outcome         String?            // deterministic set: completed | no_answer | busy | failed | canceled
  providerCallSid String?    @unique // Twilio CallSid — idempotency
  startedAt       DateTime?
  endedAt         DateTime?
  durationSec     Int?
  costUsd         Float?             // logging-grade estimate (gateway precedent)
  meta            Json?              // disclosureVariant/Completed, spokenNameSource, endpointing params, cost breakdown
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  @@index([workspaceId, agentId, createdAt])
  @@index([workspaceId, contactId, createdAt])
}
enum CallStatus { QUEUED IN_PROGRESS COMPLETED FAILED }
```

---

## 5. The event catalog (the backbone — `ARCHITECTURE.md §3c`)

Every meaningful thing is an immutable event. Stored once, fanned out to **(1)** Temporal signals,
**(2)** the Automations engine, **(3)** integrations/webhooks/Zapier + the analytics warehouse.

```prisma
model Event {
  id          String  @id @default(cuid())
  workspaceId String
  type        String                            // see catalog below — version suffix MANDATORY: "email.replied.v1"
  contactId   String?
  enrollmentId String?
  campaignId  String?
  payload     Json
  occurredAt  DateTime @default(now())
  @@index([workspaceId, type, occurredAt])
  @@index([enrollmentId])
}
```

**Canonical event types (version suffix mandatory — `PHASE1_HANDOFF.md §A9`):**

| Domain       | Events                                                                                                                          | Key payload fields                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Messaging    | `email.sent.v1 · email.delivered.v1 · email.opened.v1 · email.clicked.v1 · email.bounced.v1 · email.spam.v1 · email.replied.v1` | messageId, channel, stepNodeId, link?, intent?   |
|              | `sms.sent.v1 · sms.delivered.v1 · sms.replied.v1 · sms.opted_out.v1`                                                            | segmentCount, body, intent?                      |
|              | `whatsapp.sent.v1 · whatsapp.delivered.v1 · whatsapp.replied.v1 · whatsapp.button_clicked.v1`                                   | templateId, button?                              |
| Voice        | `call.started.v1 · call.completed.v1 · call.failed.v1 · call.booked.v1 · call.refused.v1 · voice.compose_refused.v1` (P3.1)     | durationSec, transcriptId, outcome, recordingUrl; refusals carry reason/detail (no callId on `call.refused.v1` — no Call row exists) |
| Inbound      | `form.submitted.v1 · widget.conversation_started.v1 · widget.lead_captured.v1 · linkedin.captured.v1`                           | formId/widgetId, fields, routedTo                |
| Proposals    | `proposal.sent.v1 · proposal.viewed.v1 · proposal.accepted.v1 · proposal.paid.v1`                                               | proposalId, trackedLinkId, amount?               |
| Pipeline     | `lead.enrolled.v1 · lead.stage_changed.v1 · lead.unsubscribed.v1`                                                               | campaignId?, fromStage, toStage, channel?        |
| Billing      | `payment.received.v1 · credits.consumed.v1 · credits.low.v1`                                                                    | amount, channel, balance                         |
| Integrations | `integration.connected.v1 · integration.sync_failed.v1`                                                                         | provider                                         |

> **There is no `lead.replied`** — a reply is always channel-specific (`email.replied.v1`,
> `sms.replied.v1`, …); consumers that want "any reply" filter `*.replied.v1`.
>
> **Rule:** classify inbound replies (`*.replied.v1`) with Claude → attach `intent` to the payload
> (which references `messageId`, never the body — bodies live on `Message`, §4.1) → the matching
> enrollment's Temporal workflow receives it as a **signal** and branches.
>
> **Intent labels (P1.7 amendment, DEC-034):** the canonical set is the prototype's Inbox
> category chips — `interested · booked · replied · question · not · ooo` — plus `unsubscribe`
> (side-effect label, never a chip). One enum (`IntentSchema` in `packages/events`) shared by the
> classifier, this catalog, branch cases, and the P1.8 Inbox UI.

---

## 6. Automations, integrations, channels

```prisma
model Automation {          // account-scope When → If → Then rules — LIVE on the ONE R1 evaluator (R1-UI, DEC-091)
  id          String @id @default(cuid())
  workspaceId String
  name        String
  enabled     Boolean @default(true)
  trigger     Json                              // R1-UI (DEC-091): the ONE core union (campaignRuleTriggerSchema) — the pre-R1 {event, filter} sketch is superseded
  conditions  Json                              // R1-UI (DEC-091): campaignRuleConditionSchema[], max ONE this phase (multi-AND stays reserved)
  actions     Json                              // R1-UI (DEC-091): the ONE core action union, ordered; ACCOUNT_ACTION_KINDS at the boundary (no move_to_node, no sends)
  runs        AutomationRun[]
}
model AutomationRun { id String @id @default(cuid()) workspaceId String automationId String eventId String? status String detail Json ranAt DateTime @default(now()) } // R1-UI (DEC-091): +eventId, unique (automationId, eventId) — redelivery idempotency, mirrors CampaignRuleRun

model CampaignRule {         // R1 (DEC-074): per-agent automation rules (ARCHITECTURE §151)
  id          String @id @default(cuid())
  workspaceId String
  campaignId  String                            // → Campaign (cascade) — the campaign-scoped sibling of Automation (§152)
  order       Int                               // evaluation order; first terminal action wins conflicts
  trigger     Json                              // typed union in @clientforce/core (campaignRuleTriggerSchema)
  condition   Json?                             // optional refinement (keyword_contains) — never the primary match
  actions     Json                              // typed union, ordered; terminal = end · move · pause · suppress
  enabled     Boolean @default(true)            // disabled rules never fire; flipping is instant, no re-plan
  seededFrom  String?                           // goal-seed provenance (W2); seeds are rows like any other
  runs        CampaignRuleRun[]
}
model CampaignRuleRun {      // R1: run history — mirrors AutomationRun; unique (ruleId, eventId) = redelivery idempotency
  id String @id @default(cuid()) workspaceId String ruleId String enrollmentId String? contactId String?
  eventId String status String detail Json depth Int @default(0) ranAt DateTime @default(now())
}

model Integration {                             // INT W1 (DEC-093): LIVE — one row per (workspace, provider), @@unique
  id          String @id @default(cuid())
  workspaceId String
  provider    String                            // the LIVE set is @clientforce/core INTEGRATION_PROVIDERS (wave-gated: slack W1 · gcal/calendly W2 · stripe/webhook W3 · hubspot W4)
  status      String  @default("connected")     // PROBE-BACKED honest states: connected | unhealthy | revoked (never "connected" without a live token probe; user disconnect DELETES the row)
  credentials Json    @default("{}")            // RETIRED in place (INT W1) — never read or written; tokens live in credentialsEnc
  credentialsEnc Bytes?                         // AES-256-GCM under FIELD-ENCRYPTION-KEY (the SenderConnection/DEC-030 rule)
  config      Json                              // per-provider user config (Slack: channel + notification toggles) — never secrets
  accountLabel String?                          // vendor-side display, probe-refreshed
  scopes      String[]                          // what the vendor actually GRANTED
  // + lastProbeAt · lastSyncAt · connectedById (audit)
}

model Meeting {                                 // INT W2 (DEC-094): CURRENT booking state + the before_meeting sweep anchor
  id           String @id @default(cuid())
  workspaceId  String
  contactId    String?                          // NULL = an invitee we could not correlate (honest "not our lead")
  enrollmentId String?
  campaignId   String?
  provider     String                           // calendly (detection tier) now; more later
  externalId   String                           // the invitee URI — moves on reschedule (ONE row per chain)
  status       String @default("booked")        // booked | canceled | no_show (guarded transitions; cancel ≠ stage change)
  startAt      DateTime                         // reschedules update this — the sweep key re-arms
  // + endAt? · timezone? · inviteeEmail? · rescheduleUrl? · cancelUrl? · title? · meta
  // @@unique([workspaceId, provider, externalId]) — webhook redelivery idempotency
  // @@index([workspaceId, status, startAt]) — the before_meeting sweep scan
}

model IntegrationDelivery {                     // INT W1 (DEC-093): outbound delivery audit + redelivery idempotency
  id            String @id @default(cuid())
  workspaceId   String
  integrationId String                          // → Integration (cascade)
  sourceEventId String?                         // the causing catalog Event id (NULL for manual tests)
  kind          String                          // new_reply | meeting_booked | goal_completed | notify_team (W1)
  status        String                          // pending (pre-send claim, at-most-once) | delivered | failed | held
  detail        Json?
  // @@unique([integrationId, sourceEventId, kind]) — bus redeliveries dedupe
}

model SenderConnection {     // P1.5: the three-tier sender model (replaces `Sender` — DEC-030)
  id               String       @id @default(cuid())
  workspaceId      String
  type             SenderType                   // CF_MANAGED | GMAIL_OAUTH | OUTLOOK_OAUTH | SMTP
  fromEmail        String
  fromName         String?                      // owner rule 1: send FAILS at the boundary without it
  replyTo          String?
  status           SenderStatus @default(ACTIVE)
  domainAuthStatus Json         @default("{}")  // { spf, dkim } badges (checkpoints §6)
  dailyLimit       Int          @default(200)
  sendingWindow    Json?
  credentialsEnc   Bytes?                       // per-tenant creds, AES-256-GCM under FIELD-ENCRYPTION-KEY
  warmupState      Json?                        // reserved (DEC-019)
  dedicatedIp      String?                      // reserved (CF_MANAGED dedicated tier)
  ipPoolId         String?
  subuser          String?
}
enum SenderType { CF_MANAGED GMAIL_OAUTH OUTLOOK_OAUTH SMTP }
enum SenderStatus { ACTIVE PAUSED DISABLED }

model Message {              // P1.5 (A6): every outbound persisted AS RENDERED; P1.7 adds inbound + intent
  id                String   @id @default(cuid())
  workspaceId       String
  campaignId        String
  enrollmentId      String?
  contactId         String
  channel           String                      // "email" this phase
  direction         MessageDirection            // OUTBOUND | INBOUND
  subject           String?
  body              String                      // rendered (outbound) / parsed (inbound)
  providerMessageId String?  @unique
  inReplyToId       String?                     // → Message.id (threading, owner rule 3)
  intent            String?                     // inbound only (P1.7)
  stepNodeId        String?
  sentAt            DateTime
  meta              Json?                       // { senderId, threaded, sanitized? }
}
enum MessageDirection { OUTBOUND INBOUND }

model Suppression {          // P1.5 (A7): checked at the send boundary with Contact.optOut
  id          String   @id @default(cuid())
  workspaceId String
  channel     String
  address     String
  reason      SuppressionReason                 // UNSUBSCRIBED | BOUNCED | SPAM_COMPLAINT | MANUAL
  source      String?                           // "webhook" | "import" | "admin"
  @@unique([workspaceId, channel, address])
}
enum SuppressionReason { UNSUBSCRIBED BOUNCED SPAM_COMPLAINT MANUAL }
```

> **P1.5 amendment (PR #29, DEC-030):** `Sender` is replaced by
> `SenderConnection` (three-tier model, issue P1.5); `Message` and
> `Suppression` land per handoff **A6/A7**. Per-tenant credentials are
> encrypted at rest (AES-256-GCM, master key = Key Vault
> `FIELD-ENCRYPTION-KEY`); CF_MANAGED shared pool carries no tenant secret.
> The send boundary enforces the A8 guardrails plus the three owner send-time
> rules: no from-name → fail · CAN-SPAM footer = workspace `company_address`
> **verbatim** (no address → fail) · real threading only — a "Re:"/"Fwd:"
> prefix is stripped + audited unless the message genuinely threads to a prior
> send (`In-Reply-To`/`References` = prior `providerMessageId`).

> **R1 amendment (PR #86, DEC-074):** `CampaignRule` + `CampaignRuleRun` land
> ADDITIVELY as the per-agent automation-rules layer (ARCHITECTURE §151) —
> `Automation`/`AutomationRun` stay byte-untouched for the Phase-6 standalone
> engine (§152). Both layers share ONE typed trigger/condition/action
> vocabulary (`@clientforce/core` `campaign-rules.ts`) and ONE evaluator
> (`packages/automations`, mounted on the T2 automations consumer hook) —
> never two evaluators, never two trigger vocabularies. Rules are a DISTINCT
> entity (row order, goal seeds, wizard-draft lifecycle, graph interlock),
> not `Automation` rows with a nullable campaignId. Each evaluation outcome
> persists a `CampaignRuleRun` row and emits **`automation.rule.run.v1`**
> `{ruleId, runId, status, trigger, detail?}` (append-only catalog entry —
> the one new event kind this unit names, A9). Existing campaigns simply
> have zero rules.

> **LH1 amendment (DEC-087):** three append-only catalog entries.
> **`contact.enrollment_refused.v1`** `{reason, detail?, origin?}` — the
> enrollment GATE refused a contact (typed, never silent); cataloged because
> a gate refusal has no Enrollment row to carry `meta.blocked` (the
> compose_refused precedent) — the Event row's campaignId/contactId columns
> put it in the campaign Logs feed. **`validation.batch_completed.v1`**
> `{batchId, source, total, valid, risky, invalid, skippedSuppressed,
> billed, cacheHits}` — one async validation run finished (guarded
> transition, exactly once; `billed` counts unique paid ADDRESSES).
> **`validation.paused.v1`** `{batchId, reason, pendingCount}` — a batch
> HELD (allowance / spend ceiling / provider down): the honest "validation
> queued" state, rising-edge per hold episode; the ceiling variant doubles
> as the vendor-spine cost alert. Send-boundary rails are untouched — the
> gate lives at enrollment; suppression stays authoritative at the boundary.

> **R1-UI amendment (PR #105, DEC-091):** the account surface goes LIVE NOW on
> the ONE evaluator — the R1 amendment's "`Automation`/`AutomationRun` stay
> byte-untouched for the Phase-6 standalone engine" sentence is SUPERSEDED
> (the models woke early; §6's original `{event, filter}` sketch comments are
> corrected in place above). `Automation.trigger/conditions/actions` carry the
> SAME core unions as `CampaignRule` (one vocabulary, one executor — scope is
> the storage parent, never a fork; DEC-074 D1's distinct-models ruling stands;
> `conditions` = an array holding at most ONE entry this phase, multi-AND
> reserved). `AutomationRun` gains additive `eventId` + unique
> (automationId, eventId) — the CampaignRuleRun redelivery idempotency
> mirrored; every run now emits `automation.rule.run.v1` carrying the additive
> optional **`scope`** rider (`"account"`; absent = campaign — byte-compatible).
> Two append-only catalog entries: **`automation.status_changed.v1`**
> `{automationId, from, to}` (ACTUAL flips only — the sender.status_changed
> pattern) and **`automation.deleted.v1`** `{automationId, name, trigger}`
> (the ledger outlives the row — delete audit). The account action set is
> `ACCOUNT_ACTION_KINDS` = the union minus `move_to_node` (campaign-scoped,
> typed 422 at the boundary); NO send actions exist at account scope BY
> DESIGN — sends ride move_to_node → graph steps → the unchanged boundary.

Outbound **WebhookEndpoint** (`url`, `secret`, `events[]`) + delivery log; Zapier rides the same dispatcher.
**INT W3 (DEC-095) — the url+secret half LANDED:** the `webhooks` Integration row carries the default
Payload URL + the server-minted per-workspace signing secret; the delivery log is `IntegrationDelivery`
(claim-then-send, the W1 rails); the rule-fired `send_webhook` action POSTs signed
(`X-Clientforce-Signature: t=…,v1=HMAC-SHA256(secret, "t.body")`) through the general SSRF guard.
The `events[]` stream half (every catalog event as it happens) + the incoming trigger stay open → Q-048.

---

## 7. Billing, credits & forms/proposals

```prisma
model Plan { id String @id @default(cuid()) agencyId String? name String priceMonthly Int features Json limits Json }   // 3 tiers; set at the agency level

model CreditPrice {         // EDITABLE pricing — admin-managed via UI, not hard-coded
  id        String  @id @default(cuid())
  agencyId  String?                            // null = platform default; per-agency override allowed
  action    String                             // email_send | sms_segment | whatsapp_msg | voice_minute | enrichment | signal_lead
  credits   Int                                // seed from market rates + small markup; changeable anytime
  effectiveFrom DateTime @default(now())
  @@index([agencyId, action])
}

model CreditLedger {        // append-only; balance = sum(delta)
  id          String @id @default(cuid())
  workspaceId String
  delta       Int                               // + top-up, − consumption
  reason      String                            // channel send, voice minute, enrichment…
  channel     String?
  refId       String?                           // event/message id
  balanceAfter Int
}

// Client-billing / agency payouts (agency charging its own clients through the platform) are a
// DEFERRED v2 concern — not in the initial build. v1 billing = the agency pays Clientforce.
// model AgencyPayout { id String @id @default(cuid()) agencyId String periodStart DateTime periodEnd DateTime amount Int status String }

model Form {
  id String @id @default(cuid()) workspaceId String title String
  fields Json                                   // [{ name, label, type, required, options? }]
  design Json                                   // colors, dark mode, double-opt-in, redirect, success
  routing Json                                  // → campaignId / listId
  submissions FormSubmission[]
}
model FormSubmission { id String @id @default(cuid()) workspaceId String formId String contactId String? answers Json submittedAt DateTime @default(now()) }

model Proposal {
  id String @id @default(cuid()) workspaceId String title String
  blocks Json                                   // cover, details, pricing/line-items, cta
  variables Json                                // dynamic personalization tokens
  status String @default("draft")               // draft | sent | viewed | accepted | paid
  sends ProposalSend[]
}
model ProposalSend {
  id String @id @default(cuid()) workspaceId String proposalId String contactId String
  channel String trackedLinkId String @unique
  viewedAt DateTime? acceptedAt DateTime? paidAt DateTime? amount Int?
}

model Widget {              // embeddable chat config
  id String @id @default(cuid()) workspaceId String agentId String
  design Json                                   // brand color, launcher, theme, position
  fields Json                                   // capture fields + CRM mapping
  behaviour Json                                // booking questions, proposal questions
  routing Json                                  // powering agent, calendar, CRM tags
}
```

---

## 8. Analytics

Events (§5) are the source of truth. Roll up async into summary tables (don't query raw events for
dashboards). Minimum: `MetricDaily(workspaceId, date, agentId?, channel?, metric, value)` powering the
KPI/funnel/channel/revenue/leaderboard views, plus on-demand funnel queries
(`qualified → booked → showed → closed`). Export = CSV from the same query layer.

---

## 9. What to hand Claude Code first (maps to BUILD_PLAN Phase 0)

1. Generate the **Prisma schema** from §1–§7; enable `pgvector`; add RLS policies on every `workspaceId` table.
2. Generate **TypeScript types** in `packages/core` for `CampaignGraph` (§3.1) + a **validator** (zod) + a unit-tested **graph executor** skeleton.
3. Generate the **event catalog** (§5) as typed constants + payload types in `packages/events`.
4. Seed script: one Agency → one Workspace → one User (OWNER) → a sample Agent + default PipelineStages.

> Open product decisions that refine this (don't block Phase 0): exact **credit prices per channel**,
> **v1 integration list**, **Lead Finder signal sources**, and the **default pipeline stages**. Captured
> as the "remaining product decisions" doc next.
