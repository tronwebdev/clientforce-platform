# ADDENDUM 2 — Credits, Billing & Campaign Value Model (2026-08-15)
Extends the Console v3 pack. Read AFTER PROMPT_V3_PORT_KICKOFF.md; prototypes in /prototypes are refreshed to include everything below. Build notes §12–14 carry the full detail.

## A. New surfaces shipped in the prototypes
**Workspace (Console.dc.html)**
- Settings → "Plan & billing" (ops:billing): plan header, credit balance + burn bar, working auto top-up toggle, rate card, client rebill invoices. RBAC: page Owner/Admin.
- Credits strip pinned to the rail business card (all pages): live balance + Top up. Chip visible to ALL roles; Top up button Owner/Admin only.
- Top-up modal: packs 2,500/5,000/10,000 @ $0.016 rebilled (2.0×), pool line, cadence note, success state; balance updates app-wide.
- Campaign value model: campaignDefs now carry vKind (book|sell|react|lead|review), vUnit, vEst $/unit (editable in the overview strip), optional vSalesGoal. Overview value strip (REVENUE / BOOKED / RECOVERED / PIPELINE VALUE), rail $ goal tags, 5th stat tile. review-kind = native metric, no $.
- Lead finder header notes enrichment 1 cr/contact.

**Agency (Account.dc.html)**
- Plans & billing: credit pool card (wholesale $0.008/cr, auto top-up 10k@15k floor, margin line) + buy modal (10k/25k/50k, VISA, pool updates) + workspace allocation table with per-row drill (BY CHANNEL bars / BY AGENT / BY CAMPAIGN + ledger link) + sub-account resale card (global $0.020/cr, per-sub override, margin).
- Sub-account create wizard step 2: Starting credits pills (default 2,500) + resale note; review shows Credits line. Sub rows show per-sub balance beside plan.
- Workspaces redesigned: summary band (active / contacts / booked / needs-attention) + list rows with photo logos (letter-tint fallback), plan+status, mono stats, actions, "+ New workspace" footer row → existing 4-step wizard.

**Portal (Client Portal.dc.html)**: report carries a credits-only meter line — never dollars.

## B. Locked decisions (owner, via form 2026-08-15)
1. Workspace top-ups draw from the agency pool, rebilled at markup (never client card directly).
2. Subs: allocation AND self-serve purchase at resale rate — global default $0.020/cr with per-sub override.
3. Auto top-up on by default; floor per workspace. Off = pause paid sends at zero.
4. Rebill cadence is a per-client setting (default monthly consolidated on the 1st).
5. Credits chip visible to all workspace roles; Top up gated Owner/Admin.
6. Client portal shows credits only — no dollar amounts, ever.
7. Usage history grain: per channel + per agent + per campaign (no CSV ledger for now).

## C. Account tiers — one system, flags not forks
- Solo (1 ws): credits attach to the workspace, retail on own card; pool/allocation/markup blocks don't render.
- Multi-workspace business: account pool + allocation, NO markup/rebill (pills read "Included").
- Agency: full model (markup, rebill modes, sub resale).
Workspace-side UI identical in all tiers; only the source fine-print line changes. One ledger model + account-type flag → upgrades need no migration.

## D. Backend model additions (extend BACKEND_TOUCH_MAP.md)
- account.type flag (solo|multi|agency); credit_ledger (event-grain: ws, agent, channel, campaign, cr, ts); pool + per-ws balances; allocation config (monthly cr, markup, rebill_mode per client, floor, auto_topup); resale_rate global + per-sub override; Stripe: pool purchase + rebill invoice generation; low-balance alerts.
- Campaign model: v_kind, v_unit, v_est_cents (editable), v_sales_goal_cents nullable; realized value computed from receipts.

## E. Port guardrails for Claude Code
- Do NOT hardcode "Booked" as the campaign metric — labels derive from v_kind/v_unit (see Whitening kit push = REVENUE in the prototype).
- Portal never renders $ for credits. Wholesale rates never render workspace-side.
- Existing "do not restyle shipped surfaces" rule stands; these are NEW surfaces behind the v3 flags per MIGRATION_NON_BREAKING.md. Billing surfaces ride the existing port order: workspace pane with the Console settings phase, agency blocks with the Account phase.

## F. UI polish since the previous pack export (also in prototypes + build notes)
- Focus choreography LOCKED sharp: rail fade .22s / slide-out crisp, canvas .34s scale, dock unfold .38s, all cubic-bezier(.32,.72,0,1). Slow-premium recipe preserved in build notes ("Focus choreography variants") for one-edit flip-back.
- Focus toggle is a 27px gradient capsule (double-chevron, green glow) in the rail header.
- Page-container chat tail: the canvas grows a 19px chat-bubble tail on its right edge pointing at the ACTIVE dock tile — position measured at runtime from the tile's rect (resize-aware), slides .3s between menus; dock pages only.
- Rail campaign cards carry a small mint tail toward the canvas when selected; ✦ tags on agent-suggested campaigns; GOAL MET pill.
- Workspaces page (Account): photo logo tiles, summary band, gradient top edge + ambient shadow (see §A).
All of the above ship inside the refreshed prototypes in /prototypes; behavioral specs live in CONSOLE_V3_BUILD_NOTES.md §9–14.

## G. Ads Closed Loop add-on (locked 2026-08-15 — all angles in)
See build notes §15 and PRD v2 §7 (AR-1…AR-8). Summary: Meta/Google lead webhooks with full ad context into Ada's openers (P0) · click-ID capture + ad-aware widget (P0) · value passback via CAPI/offline conversions carrying v_est dollars → value-based bidding (P0, the moat) · first-party audience syncs from goal state incl. suppression-as-exclusion (P1) · per-ad ROI analytics (P1) · objection→creative intel (P2) · Ada media copilot, approve-to-act (P2) · shipped as add-on entitlement, metered sync credits, passback free. Compliance: consent at capture, SHA-256 hashing, no cookie/cross-client audience sales. NEW: ad_context, click_id store, audience_sync jobs, entitlement; integrations registry pattern EXISTS.
