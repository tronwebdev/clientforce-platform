# MIGRATION_NON_BREAKING — Console v3 port contract
1. FLAG + PARALLEL ROUTE. All v3 screens mount behind feature flag consoleV3 (per-workspace, default off) on parallel routes (/v3/*). Legacy routes untouched; legacy e2e smoke must stay green in every wave's CI.
2. ADDITIVE-ONLY API. No renames, drops, or behavior changes to shipped endpoints/models. New needs = new routes + new tables. Shared reads reuse existing endpoints as-is; if a v3 view needs one more field, add nullable field or new endpoint — never repurpose.
3. SHIPPED VOCABULARY IS LAW. campaign-rules.ts unions (13 triggers/13 actions, first-wins terminals), RBAC enum OWNER/ADMIN/AGENT/VIEWER, provider registry (7 providers, health states), sender DNS posture — v3 UI already renders these verbatim; port must import types from packages/core, never redeclare.
4. WAVE ORDER (each = own PR + PROGRESS.md entry + fidelity screenshots):
   W0 tokens: additive variants in packages/ui (v3 tokens beside legacy, no overwrites)
   W1 shell: wash/rail/dock/canvas + focus choreography + Ada bar chrome (no surface content)
   W2–W9 surface-by-surface: campaign tabs → contacts → forms/chatbot/proposals → automations/integrations → analytics → business/settings → workspace inbox → lead finder
   W10+ NEW-product endpoints (scouts, receptionist, portal, agency suite, gb log, tour state) — each behind its own sub-flag
5. LAUNCH = flag flip per workspace; legacy removal is a separate owner-sequenced unit (CLAUDE.md product note). Rollback = flag off, zero migrations to unwind.
6. DEC/Q LEDGER. Any proto-vs-shipped conflict → PROGRESS.md entry (BLOCKING stops thread; NON-BLOCKING proceeds with stated default). No silent choices.