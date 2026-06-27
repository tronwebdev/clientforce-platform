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
  embedding   Unsupported("vector(3072)")      // pgvector; text-embedding-3-large
  tokens      Int
  @@index([sourceId])
}

model BusinessContext {     // Claude-distilled profile the planner reads
  id          String  @id @default(cuid())
  workspaceId String
  agentId     String  @unique
  offer       String
  icp         Json                              // industries, titles, geos, size
  proofPoints Json                              // case studies, stats
  tone        String
  constraints Json                              // claims to avoid, compliance notes
  rawSummary  String                            // full distilled brief
}

enum SourceKind { WEBSITE DOCUMENT CONNECTOR TEXT }
enum IngestStatus { PENDING INGESTING READY FAILED }
```

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
  guardrails   Json                              // consent, sending window, daily caps
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
  "entry": "n1",                       // id of the first node
  "nodes": [
    { "id": "n1", "type": "step",
      "channel": "email",              // email | sms | whatsapp | voice | linkedin
      "content": {
        "subject": "Quick question about {{company}}",   // email only
        "body": "Hi {{firstName}}, …",                   // tokens = personalization vars
        "template": "cf_case_study_v2",                   // whatsapp approved template id
        "buttons": ["Book a call","Send breakdown"],      // whatsapp quick replies
        "voice": { "persona": "ava-warm", "objective": "qualify & book", "script": "…" }
      },
      "pipelineOnSend": "contacted" },                    // optional stage move
    { "id": "d1", "type": "delay", "amount": 2, "unit": "days" },
    { "id": "n2", "type": "step", "channel": "sms", "content": { "body": "…" } },
    { "id": "b1", "type": "branch",
      "on": "reply",                                       // reply | open | click | call_outcome | no_response
      "cases": [
        { "when": { "intent": "interested" }, "goto": "sub:interested", "pipeline": "engaged" },
        { "when": { "intent": "not_now" },    "goto": "d2" },
        { "when": "default",                  "goto": "n2" }
      ] },
    { "id": "sub:interested", "type": "subcampaign", "ref": "subcampaign_id" }
  ],
  "edges": [ { "from": "n1", "to": "d1" }, { "from": "d1", "to": "n2" }, { "from": "n2", "to": "b1" } ]
}
```
Node types: **`step`** (a channel send), **`delay`** (durable Temporal timer), **`branch`** (waits on an
event signal, routes by classified intent/condition), **`subcampaign`** (jump into a triggered sub-flow),
**`action`** (fire an agent tool / integration — e.g. send_proposal, book_meeting), **`end`**.
Tokens (`{{firstName}}`, `{{company}}`, `{{calendarLink}}`) resolve per-lead at render time.

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
  enrichment  Json?                             // appended provider data
  tags        String[]
  optOut      Json                              // { email:false, sms:false, whatsapp:false }
  lists       ListMembership[]
  enrollments Enrollment[]
  events      ActivityEvent[]
  @@index([workspaceId, email])
  @@index([workspaceId, phone])
}

model Enrollment {          // a contact's run through one campaign = 1 Temporal workflow
  id           String  @id @default(cuid())
  workspaceId  String
  campaignId   String
  contactId    String
  workflowId   String  @unique                  // Temporal workflow id
  pipelineStage String                          // current PipelineStage.key
  currentNode  String?                          // node id in the graph
  status       EnrollmentStatus @default(ACTIVE) // ACTIVE | PAUSED | DONE | UNSUBSCRIBED | BOUNCED
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

model ContactList {
  id String @id @default(cuid()) workspaceId String name String
  members ListMembership[]
}
model ListMembership { id String @id @default(cuid()) listId String contactId String @@unique([listId, contactId]) }

enum EnrollmentStatus { ACTIVE PAUSED DONE UNSUBSCRIBED BOUNCED }
```

---

## 5. The event catalog (the backbone — `ARCHITECTURE.md §3c`)
Every meaningful thing is an immutable event. Stored once, fanned out to **(1)** Temporal signals,
**(2)** the Automations engine, **(3)** integrations/webhooks/Zapier + the analytics warehouse.

```prisma
model Event {
  id          String  @id @default(cuid())
  workspaceId String
  type        String                            // see catalog below — versioned: "lead.replied.v1"
  contactId   String?
  enrollmentId String?
  campaignId  String?
  payload     Json
  occurredAt  DateTime @default(now())
  @@index([workspaceId, type, occurredAt])
  @@index([enrollmentId])
}
```

**Canonical event types (v1):**

| Domain | Events | Key payload fields |
|---|---|---|
| Messaging | `email.sent · email.delivered · email.opened · email.clicked · email.bounced · email.spam · email.replied` | messageId, channel, stepNodeId, link?, intent? |
| | `sms.sent · sms.delivered · sms.replied · sms.opted_out` | segmentCount, body, intent? |
| | `whatsapp.sent · whatsapp.delivered · whatsapp.replied · whatsapp.button_clicked` | templateId, button? |
| Voice | `call.started · call.completed · call.failed · call.booked` | durationSec, transcriptId, outcome, recordingUrl |
| Inbound | `form.submitted · widget.conversation_started · widget.lead_captured · linkedin.captured` | formId/widgetId, fields, routedTo |
| Proposals | `proposal.sent · proposal.viewed · proposal.accepted · proposal.paid` | proposalId, trackedLinkId, amount? |
| Pipeline | `lead.enrolled · lead.stage_changed · lead.unsubscribed · lead.replied` | fromStage, toStage, intent |
| Billing | `payment.received · credits.consumed · credits.low` | amount, channel, balance |
| Integrations | `integration.connected · integration.sync_failed` | provider |

> **Rule:** classify inbound replies (`*.replied`) with Claude → attach `intent` to the payload →
> the matching enrollment's Temporal workflow receives it as a **signal** and branches.

---

## 6. Automations, integrations, channels
```prisma
model Automation {          // standalone When → If → Then rules
  id          String @id @default(cuid())
  workspaceId String
  name        String
  enabled     Boolean @default(true)
  trigger     Json                              // { event:"lead.replied", filter:{...} }
  conditions  Json                              // [{ field, op, value }]  (AND)
  actions     Json                              // [{ type, params }]  ordered
  runs        AutomationRun[]
}
model AutomationRun { id String @id @default(cuid()) workspaceId String automationId String status String detail Json ranAt DateTime @default(now()) }

model Integration {
  id          String @id @default(cuid())
  workspaceId String
  provider    String                            // hubspot | salesforce | gcal | calendly | stripe | slack | zapier | webhook | sendgrid | twilio …
  status      String  @default("connected")
  credentials Json                              // encrypted (Key Vault ref)
  config      Json                              // events subscribed, field maps
}

model Sender {               // email/phone identities a campaign sends from
  id          String @id @default(cuid())
  workspaceId String
  channel     String                            // email | sms | whatsapp | voice
  identity    String                            // address or number
  provider    String                            // sendgrid(subuser) | twilio
  health      Int     @default(0)               // 0–100
  warmup      Json?                             // { day, of, dailyCap }
  auth        Json?                             // { spf, dkim, dmarc } for email
  dailyLimit  Int
}
```
Outbound **WebhookEndpoint** (`url`, `secret`, `events[]`) + delivery log; Zapier rides the same dispatcher.

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
