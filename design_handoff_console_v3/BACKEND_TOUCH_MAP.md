# BACKEND_TOUCH_MAP — per surface: EXISTS / EXTEND / NEW
> **Addendum 3 (2026-08-15):** Ads Closed Loop add-on tables/jobs are specified in ADDENDUM_3_ADS_LOOP_UI.md §I — `ads_loop` entitlement (ONE per workspace, covers Meta+Google, $49/mo), `ad_context`, `click_id_store`, `value_passback` (CAPI + offline conversions carrying v_est_cents, never metered), `audience_sync` (nightly, credits-metered), `ads_suggestion` (approve-to-act). Provider health reuses the shipped integrations registry — no second registry. Compliance gates: consent at capture, SHA-256 before upload, per-client audience scope, no cookie/cross-client sale.
Legend: EXISTS = shipped endpoint/model, reuse as-is · EXTEND = additive field/route on shipped area · NEW = net-new table+routes (own wave, own flag). File pointers = repo @ main (verify at port time; PROGRESS.md DEC ledger wins).

| Surface | Reads | Writes | Status |
|---|---|---|---|
| Shell/rail | campaigns list w/ goal state (docs/PLAN_GOAL_STATE.md) | — | EXISTS; goal-met pill = EXTEND (expose goalMet bool on list) |
| Overview/activity | events bus receipts (packages/events), planner state | approve/dismiss needs-you | EXISTS (P1.8 wiring notes); activity FILTER kinds form/proposal = EXTEND event kinds already emitted |
| Campaign inbox | threads/messages (packages/channels) | reply send, move, done, draft approve | EXISTS |
| Pipeline | stage rollup | stage moves, nudge queue | EXISTS |
| Plan/sequence | sequence editor (CHECKLIST_W3_4) | step CRUD, delays, tz | EXISTS; "closer" step type = EXTEND (step template flag; vertical from business profile) |
| Branches/rules | campaign-rules.ts | rule CRUD | EXISTS verbatim |
| Suggested automations | planner suggestions | accept→rule create | EXTEND (suggestion source tag ✦) |
| Contacts/lists/CSV | contacts, lists (docs/PLAN_CONTACT_LISTS.md), custom fields (PLAN_CUSTOM_FIELDS.md) | list membership, tags, notes, stage, import | EXISTS; relationship (customer/prospect) = EXTEND field if not present (check DATA_MODEL) |
| Quick-list everywhere | same | list membership | EXISTS (pure FE affordance) |
| Lead finder core | NEW provider search svc + scoring vs ICP (packages/core icp) | enroll→campaign (EXISTS enrollment), save list (EXISTS) | NEW search/enrich routes; enroll path EXISTS |
| Scouts | NEW scouts table (query, cadence, lastRun) | needs-you items (EXISTS bus) | NEW |
| BuyerPing | integrations registry (EXISTS pattern) | key store, topics | EXTEND registry + NEW watch-topics table |
| Forms | forms CRUD, submissions, embed (apps/api forms) | field/schema, settings, opt-in, accent/btn | EXISTS core; accent/submit-btn/double-opt-in = EXTEND settings json |
| Chatbot/widget | packages/widget config (docs/PLAN_WIDGET_WIRING.md) | config publish | EXISTS; behavior(unread/open4/exit) + features(callback hours/voice/proposal) = EXTEND config json; callback scheduling = EXISTS voice callback path (verify apps/voice) |
| Proposals | proposals CRUD + blocks + tracking (old proto parity) | block edits, send, CTA config | VERIFY: if proposals svc not yet shipped → NEW (table+routes per SURFACE_SPECS §6) |
| Automations UI | campaign-rules.ts types | rule CRUD | EXISTS verbatim — import types, never redeclare |
| Integrations | integrations.ts registry, health, ledger | connect/disconnect, per-provider config | EXISTS (INT W1–W5, DEC-093) |
| Analytics | rollups + sample floor | — | EXISTS; team-member filter = EXTEND if rollup lacks actor dim |
| Business/profile | workspace profile, knowledge, strategy/language/guardrails (packages/core) | section edits, train corrections | EXISTS |
| Senders email | senders.controller (DNS posture SPF/DKIM/DMARC) | add/verify/warm-up | EXISTS |
| Numbers buy | provisioning path (T7 runbook) | number purchase, A2P registration state | EXISTS/EXTEND (surface A2P status on sender row) |
| Numbers PORT | NEW port-request (number, carrier, acct, PIN enc, LOA doc, milestones) | milestone notifications | NEW |
| Team/roles | RBAC enum role-map.ts | invites w/ role | EXISTS |
| Workspace inbox | cross-campaign threads | same as inbox | EXISTS; portal-thread SEPARATION = EXTEND (source=portal filter) |
| Client portal | NEW portal session (magic link), outcomes read, comments, approvals | comments→workspace (separate stream), approvals | NEW |
| Agency suite | NEW agency entity, sub-accounts (B1 backoffice waves overlap — check docs/PLAN_B1_W1–W4 before creating), sites builder, selling-tools content, earnings+Stripe Connect | sub-account create w/ billing mode | PART EXISTS (B1 waves) / PART NEW — reconcile against B1 checklist FIRST |
| Receptionist | NEW add-on entitlement, inbound numbers, rules, call log + transcripts (apps/voice EXISTS for calls) | rules CRUD, action-permission toggle | NEW on top of EXISTS voice |
| gb engine | — | entity creates (each EXISTS/NEW per its surface) + NEW gb_session receipt log (optional, provenance) | FE engine; creates route through normal APIs |
| Tour/help/checklist | — | NEW user_flags json (tourDone, checklist states) | EXTEND user prefs |
| Credits honesty | cost model (COST_MODEL_AND_PRICING.md) | — | EXISTS; every action card shows credits BEFORE run |

Hard rule: anything marked VERIFY/PART gets checked against PROGRESS.md + tree BEFORE its wave prompt is written — no guesswork into prompts.