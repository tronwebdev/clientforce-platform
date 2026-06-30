# Phase 1 — Issues to Create (checklist)

> Create these 8 issues in `tronwebdev/clientforce-platform`, in order. Bodies are in
> **`PHASE1_ISSUES.md`** (paste each section as the issue body). Labels: `phase-1`, `claude-code`.
> Work one-PR-per-ticket, plan-comment first, you hand-merge. Prereq: Phase 0 (T0–T8) merged ✅.

| # | Issue title | Package / area | Depends on | Needs a provider key? |
|---|---|---|---|---|
| P1.1 | **LLM gateway** | `packages/ai` | T-phase0 | Anthropic (mocked in CI) |
| P1.2 | **Knowledge ingestion + RAG** | `packages/knowledge` | P1.1 | Embeddings (OpenAI `text-embedding-3-large`, 1536-dim) |
| P1.3 | **Business Context distiller** | `packages/ai` consumer | P1.1, P1.2 | — (uses P1.1) |
| P1.4 | **Planner → CampaignGraph** | planner + T4 validator | P1.1, P1.3 | — |
| P1.5 | **Email channel adapter** | `packages/channels` + SendGrid | T2 | SendGrid (subuser + domain auth) |
| P1.6 | **CampaignWorkflow (Temporal)** | `apps/worker` | T4, P1.5 | Temporal (already in KV) |
| P1.7 | **Inbound → classify → signal** | event bus + `packages/ai` | P1.5, P1.6 | SendGrid inbound parse |
| P1.8 | **Wire the UI + live send** | `apps/web` | all above | SendGrid live (allow-listed addr) |

## Provider keys to line up (into Key Vault, like Phase 0)
Tell the team now so the slow one (SendGrid **domain auth — SPF/DKIM/DMARC DNS**) is ready by P1.5/P1.8.

| KV secret | For | When |
|---|---|---|
| `ANTHROPIC-API-KEY` | P1.1 planner/classifier | before P1.1 (sandbox/test ok) |
| `OPENAI-API-KEY` (or chosen embeddings provider) | P1.2 embeddings | before P1.2 |
| `SENDGRID-API-KEY` | P1.5 send | before P1.5 (sandbox mode first) |
| SendGrid **sending domain + DNS auth** | deliverability | before P1.8 live send (start DNS early) |
| SendGrid **inbound parse webhook** | P1.7 replies | before P1.7 |

> Temporal secrets are already in `clientforce-kv` from Phase 0 — P1.6 reuses them.

## Order of operations
1. Create issues P1.1–P1.8 (titles above; bodies from `PHASE1_ISSUES.md`).
2. Add `ANTHROPIC-API-KEY` to Key Vault; tell the team to start **SendGrid domain auth** (DNS lag).
3. Kick off Claude Code on **P1.1** (plan-comment first).
4. Same merge loop as Phase 0; I sanity-check each PR (especially **P1.4** planner discipline and
   **P1.7** the enroll→send→reply→branch→stage end-to-end test).
5. **P1.8** uses `P1.8_UI_WIRING_NOTES.md` for prototype-accurate screen wiring.

## Definition of done — Phase 1
A real agent built in the UI reads a company's site, plans an email sequence, sends it on a durable
Temporal workflow, and — when the lead replies — classifies intent, branches, and moves the pipeline,
all visible in the app (Inbox + Logs + lead drawer timeline). The product's heartbeat, one channel.
