# ADDENDUM 4 — Console **Bold** + first-run + agency/portal skin (2026-08-16)
**This is the newest document in the package. Where it disagrees with anything earlier — including Addendum 2 and 3 — this doc wins.**

Delta only. Addenda 2 and 3 still stand for credits/value semantics and the Ads Closed Loop product; what changes here is the **console shell and its composition**, the **first-run flow**, and the **skin of the agency + portal surfaces**.

---

## 0 · The one thing that changed

`Clientforce Console.dc.html` is **retired as pixel truth**. The console was rebuilt from the ground up as **`Console Bold.dc.html`** (5,809 lines) after the owner's judgement that the v3 console read as crowded, text-heavy and generically AI-authored.

Bold is not a restyle of v3. It is a different shell with different composition rules. **Port Bold. Do not port the old console and then "make it bolder."**

What survived from v3 unchanged: all product semantics (campaign rules vocabulary, RBAC, provider registry, credits model, value model, Ads Closed Loop). What changed: the shell, the density, the type scale, the information hierarchy, and roughly a third of the surface compositions.

The old file stays in `prototypes/legacy/` for one reason only — resolving a question Bold does not answer. It is never the reference for how something should look.

---

## 1 · Shell contract (the non-negotiable frame)

```
<div style="height:100vh; overflow:hidden; padding:26px; display:flex; gap:18px">
  rail   228px  flex:none   height:100%  overflow:hidden
  canvas flex:1 min-width:0 height:100%  overflow:hidden  (scrolls INTERNALLY)
  dock    52px  flex:none   height:100%
</div>
```

Rules that fall out of this, all of which were defects at some point in the build:

1. **The page never scrolls.** `overflow:hidden` on the shell; each column owns its own scroll. If the document scrolls, the port is wrong.
2. **The Ada bar is always on screen.** It is pinned inside the canvas column, not inside the scrolling content. It was pinned to a 1240px card once — that put it below the fold at laptop height.
3. **Every column is `header (flex:none) → scroll window (flex:1, min-height:0) → footer (flex:none)`.** A `flex:1` without `min-height:0` does not shrink and pushes the footer off-screen.
4. **Every card inside a scrolling flex column carries `flex:none`.** This is Addendum 3 §F and it recurred twice in Bold. Cards default to `flex-shrink:1`; the tallest child collapses to a couple of px and `overflow:hidden` clips it — the text is in the DOM and invisible on screen. Assume any "blank panel" bug is this.
5. **The dock must fit 11 tiles at 540px viewport height** without scrolling: 38px tiles, 4px gaps, 13px radius.

Verify the frame before porting any surface: at 1280×720 and at 924×540, page scroll must be 0 and the Ada bar fully visible.

---

## 2 · Rail (228px) — four blocks, in this order

| Block | Content | Notes |
|---|---|---|
| Workspace card | mark, business name, **workspace selector** (chevron) | flex:none. Clicking switches workspace — it is not decoration. |
| `CAMPAIGNS` | campaign rows: name, goal chip, live value | Ada's proposals appear **as rows in this list**, amber spine + "Ada's idea" pill + **Start** action — not as a separate rail block, which was tried and rejected. |
| `ALWAYS ON` / `INBOUND` | **Site agent**, **Receptionist** | The structural claim: campaigns are outbound and finite; these two are continuous. Each row shows live state, outcome count and value (`61 chats · 14 booked` / `$33.6k`), a pulsing green dot when active, amber when not installed. |
| ICP + credits card | mark, name, sector, `14 facts / 2 gaps`, credit balance, **Top up** | Pinned bottom, flex:none. No prose — the description line was removed for height. |

Collapsed state: rail shrinks to the icon column; the collapse control is an icon, not a labelled button.

---

## 3 · Dock (52px, 11 tiles, in this order)

`Receptionist · Inbox · Contacts · Lead finder · Automations · Forms · Site agent · Proposals · Analytics · Integrations · Settings`

- Receptionist sits **alone at the top**, separated — it is an add-on with its own brand, not a peer menu item.
- **Live indicator**: pulsing `#35E834` dot, top-right of the tile, when Receptionist is active or the Site agent has someone chatting.
- **Warn indicator**: solid `#E0A83A` dot when the Site agent is not installed on the customer's site.
- Tile titles are dynamic: `Site agent · 2 chatting`, `Site agent · not on your site`, `Receptionist · live`.
- Active tile: mint fill, forest icon, plus a **chat-bubble pointer** protruding from the canvas container toward the active tile.
- Dock icon style: **Style A** (saved alternate: Style B — both in the tokens doc; do not invent a third).

---

## 4 · Canvas — 18 surfaces

`vOverview vCamps vNew vActivity vPipeline vPlan vInbox vNumbers vSettings vContacts vCards vAutomations vLead vWsSettings vItem vAds vCredits vInt`

Campaign tabs: **Overview · Pipeline · Plan · Inbox · Stats · Settings** (Plan sits mid-order, Inbox after it — this order was set deliberately).

### 4.1 Campaign overview
- **Hero** carries the goal label explicitly + a one-line description of what that goal means, then the value expectation for that goal type.
- **Stats are one row.** Two rows was rejected. Each stat carries a qualifier (`8 of 12 booked`), never a bare number.
- **"Happening now"** carries a live pulse.
- Recent activity: colour-coded types, each row clickable through to its subject (contact, thread, booking). `View all` opens the full **Activity page** (`vActivity`), which is reachable only from there — not a tab.
- Activity rows with a count (`sent to 22`) open the **sorted subset** of those 22 when probed.
- Contacts in activity rows show avatars.

### 4.2 Goal types (10) — value semantics per goal
`book` value per booking · `sell` price per unit · `revive` average visit value · `review` no direct revenue · `lead` value per closed deal · `quote` value per accepted quote · `event` value per attendee · `renew` value per renewal · `nurture` no direct revenue · `winback` value per recovered deal.

Every goal expresses **both** the count and the money: `8 booked × $2,400 = $19.2k potential`. "Booked" is not the universal outcome — the campaign creation flow picks the goal first and the whole surface follows it.

### 4.3 Plan tab
Steps render as a **vertical line with nodes** (simple, scannable). Each step opens a detail sheet (email: subject, length, preview; SMS: character count; delay: editable). Branches and rules kept, simplified — one summary line per branch, expand for the rule vocabulary. Every step shows its credit cost.

### 4.4 Inbox (campaign + workspace)
Three **dropdown pickers**, not chip rows: `TYPE`, `STATUS`, `SORT`. Each menu row = colour dot + label + live count.
Types: All · Email · SMS · **Web chat** · Calls · **Client messages**. Web chat is first-class (cyan `#0E7D93`, ◈); client-portal messages are separate from campaign threads and carry their own icon.
Threads from the Site agent carry a **provenance pill** above the messages: `Site agent · came from your Meta ad · booked in 3 minutes`.
Actions are live: move, assign, snooze, approve draft, open contact.

### 4.5 Contacts
Search field + **grid/list toggle**. Circular avatars with real photos. Segment toggle (All / Prospects / Customers) that aggregates across lists. Contact detail: avatar row intact, call / message / add-to-list / tag / note actions, campaigns the contact is in, full activity timeline, ad-context rows where present. **Add to list is available anywhere a contact appears.**

### 4.6 Lead finder — two modes
- **Ada mode** (default): the pre-run ICP result shows first if it exists; `Run a new search` reveals the search parameters; results appear on run. Nothing is stacked all at once.
- **Direct mode** (legacy/Apollo-style): filter-first search for operators who know exactly what they want.
- Rows carry a **fit score**; BuyerPing intent is a second tier, not the headline.
- `Add all to a list` / enroll-to-campaign from results.

### 4.7 Site agent (was "Chatbot")
Renamed everywhere. It is the only always-on inbound surface in the core plan, so it gets channel treatment:
- Header reads `INBOUND CHANNEL · ON YOUR SITE` / `· NOT INSTALLED`.
- Installed: status strip with pulse, verified date, `Remove from site`.
- Not installed: amber banner — *"She is not on your site yet · every visitor to brightsmile.co leaves unanswered"* + `Add it to my site`. The assistant cards go to `Not on your site` with no conversion figure. **All states must stay coherent** — cards claiming "LIVE · 61 chats" while the widget is off the site was a real defect.
- Preview is live inside the setup, not a separate tab. Colour/appearance customisation matches `Agent Widget v3 - Mock.dc.html`.

### 4.8 Receptionist add-on
Incoming call arrives as a pop-out: `INCOMING CALL`, caller, `Not in your contacts`, two choices — **Take the call** / **Let her handle it**. Ringing treatment. 3-step setup, editable rules, call transcripts. `$39/mo` label disappears once live; the pop-out background changes state when active.

### 4.9 Credits (workspace side)
**Spend only.** Balance, burn rate, runs-out estimate, per-agent / per-channel / per-campaign breakdown, history. **Plans, cards and invoices live on the account-owner side** — they were removed from workspace settings.

### 4.10 Settings & Business core
Per Addendum 3 §G, plus: workspace settings and the business profile are **one surface**, not two. Senders grouped at the top under their own heading, above "what the agent knows". Add email and add number are **separate wizards** with real provider icons. Every field is directly editable. Knowledge sources can be added. Guardrails here are **workspace-wide** and distinct from campaign guardrails.

### 4.11 Tour
Anchored product tour over: `ws · camps · sugg · core · canvas · tabs · hero · act · ada · dock`. Per-page help exists on every surface, not just campaigns.

---

## 5 · First run — `Business Core Onboarding.dc.html`

Replaces the older `Onboarding.dc.html` for the business path. 528 lines. Three phases:

### 5.1 Auth (split screen)
Left: dark radial panel (`#12512C → #0A2A38 → #0A0F14`), logo, eyebrow, 46px/900 headline, description at 16px/500, 78px left padding. Right: **466px** card, Google button, four fields, primary CTA.
Screens: `Create your account` · `Check your email` (6-digit) · `Sign in`.

### 5.2 Core assembly — 6 steps
1. **Skip the setup forms** — she reads the URL. (`No website? Tell her about the business instead`)
2. **This is what she will say about you** — confirm/correct the read
3. **Who is worth chasing?** — ICP
4. **What counts as a win?** — goal, including *Take payment or sign-up* (checkout, trial start, subscription)
5. **One thing she cannot guess** — the fact no site carries
6. **Where should replies land?**
Then `YOUR CORE IS LIVE` → `Your first campaign is written`.

Rail: light panel (`#FBFDFB`/`#FCFCFC`, hairline) — **not** a forest-filled panel; the dark sidebar is retired brand-wide. Carries the **Business Core facet ledger** with a live `% assembled` counter, and an Ada state card.

**Ghost dock**: all 11 console tiles sit on the right edge at console geometry, greyed and locked with a vertical `LOCKED` marker, titled *"unlocks when your Core is live"*. They fade in progressively as the Core fills, then go live with the marker flipping to `READY`. This is why the console feels familiar on first entry.

### 5.3 Plan — its own focused screen (last)
Not a block at the bottom of a step. **Free trial leads.** Tiers per the repo's own ruling (`PRODUCT_DECISIONS.md` **D2**): **Starter `$49`** (1 workspace · email · 2,500 credits) · **Growth `$149`** (5 workspaces · email and SMS · 10,000 credits) · **Scale `$399`** (15 workspaces · every channel · 30,000 credits).

> **Tier semantics (repo-grounded, do not re-derive):** one agent (Ada), so tiers differentiate on **workspaces · channels · senders · seats · credits**, never agent count. Tier is set **at the account/agency level only** — workspaces inherit it; there is no per-workspace plan. **Per-tier limits are TBD in the repo and belong in the billing UI** (`PRODUCT_DECISIONS.md` D2 leaves them open) — the 1 / 5 / 15 workspaces and 2,500 / 10,000 / 30,000 credits shown here exist to make the screen real; wire them from `Plan` config rather than hard-coding.
>
> **Related D2 ruling:** v1 billing is Agency → Workspace(client) → User with **the agency paying Clientforce**; the reseller framing and **agency payouts are deferred to v2**. The agency prototype's Earnings surface is designed-ahead, not v1 scope.

**Card is captured here, at signup.** Below the tiers: `CARD DETAILS` heading with a *Secured by Stripe* lock, then a single recessed well — card number (auto-formats in groups of four, brand marks fade once typing starts), then a split row of `MM / YY` and `CVC`. Beneath it a mint confirmation row: *"Free until {trial_end} — then {tier price}/mo. Charged today · **$0.00**"*. The trial-end date and the tier price are both live — changing tier changes the line.

CTA is **gated**: `Add your card to start the trial` on a muted `#8FA79A` until the card validates (≥15 digits, expiry, ≥3-digit CVC), then it turns forest and reads `Start free trial — open my console →`. Footer: *"Cancel any time before {trial_end} and you are never charged. One click, inside billing."*

Port note: tokenise client-side via Stripe Elements — the prototype's plain inputs are shape only, never send a PAN to our API. The gate is UX, not validation; server-side confirmation of the SetupIntent is what actually starts the trial.

> **Tier semantics changed**: one agent, multiple workspaces. Tiers gate **workspaces · channels · senders · seats · credits**, not agents, and are set at the **account level only** (workspaces inherit). Any earlier copy selling "agents" or a per-workspace plan is retired.

---

## 6 · Agency suite, client portal, DFY site

- **`Clientforce Account.dc.html`** (agency home, two-path setup, sub-accounts, websites, selling tools, earnings/Stripe, reports) — full skin pass to Bold: same shell metrics, type scale, hairlines, depth. Composition unchanged from Addendum 2; **do not re-litigate it**. Sub-accounts are `sub-accounts` (never "reseller"), 20 by default, Stripe connect prominent on Earnings and referenced at sub-account creation, per-account billing choice of Stripe or manual.
- **`Clientforce Client Portal.dc.html`** — skin pass to Bold. Client messages route to the workspace inbox as their own type (§4.4).
- **`Clientforce Agency Website.dc.html`** — **ships as-is.** Four DFY variants, preview links, colour/font/style templates in setup, optional lead-magnet tick. No further design work; port the templates and the wizard.

---

## 7 · Defects found while building Bold (read before porting)

1. **`flex:none` on cards in scrolling flex columns** — §1.4. Cost three debugging rounds. It will bite in every detail pane.
2. **Unbalanced `</div>` from partial template edits** — twice produced a blank canvas. When editing a large template by string replacement, re-verify div depth parses to zero.
3. **Missing resolver branch** — `over: {t:'block'}` had no case and fell through to a lookup that returned `undefined`, throwing inside render. Every overlay `t` value needs an explicit branch.
4. **Stale-render false positives** — an `innerText` probe can pass while the element has 2px height. Verify geometry, not just text presence.
5. **State coherence across flags** — one flag (`wcOn`) must drive dock tile, rail row, header, banner, cards and Ada context together. Partial wiring produces surfaces that contradict each other.

---

## 8 · Backend delta (extend BACKEND_TOUCH_MAP)

Additive to Addenda 2/3. Nothing here renames or drops anything shipped.

| Item | Kind | Note |
|---|---|---|
| `site_agent_install` (workspace, domain, verified_at, state) | NEW | drives installed/not-installed everywhere |
| `web` channel on threads | EXTEND | inbox type + provenance; joins `ad_context` where present |
| `campaign.goal` enum → 10 values + `value_basis` | EXTEND | additive enum values only |
| `campaign_value` (goal, unit_value_cents, count, projected) | NEW | powers the money expression per goal |
| `activity_event.kind` colour/type set | EXTEND | additive kinds for the activity page |
| `list_membership` quick-add from any contact surface | EXISTS | expose the existing endpoint on more surfaces |
| `lead_search_mode` (ada / direct) | EXTEND | direct mode reuses the shipped filter search |
| `credit_ledger` per workspace × agent × channel × campaign | EXTEND | breakdown reads; plan/card/invoice stay owner-side |
| `onboarding_session` (step, facets json, core_state, plan_choice, trial) | NEW | resumable first run |
| Stripe **SetupIntent** at signup + `trial_ends_at` on subscription | NEW | card captured during onboarding, $0 today, auto-converts at trial end unless cancelled |
| `workspace_entitlement` tier gating on workspaces + channels | EXTEND | tiers no longer gate agent count |
| `tour_state` (workspace, user, seen steps) | NEW | tour + per-page help |

---

## 9 · Port order (supersedes the earlier wave map)

The old W0/W1 targeted the v3 shell. Re-issue against Bold.

| Wave | Scope | Flag |
|---|---|---|
| **B0** | Tokens + shell: three-column frame, rail, dock, Ada bar, focus/collapse, tour scaffold | `consoleBold` |
| **B1** | Campaign console: rail list + Ada proposals, overview/hero/stats/activity, activity page, tabs frame | `consoleBold` |
| **B2** | Plan + branches, pipeline (board + list), campaign inbox | `consoleBold` |
| **B3** | Contacts + detail + lists + CSV; workspace inbox incl. web chat and client messages | `consoleBold` |
| **B4** | Site agent (channel treatment, install states, preview) + Receptionist add-on | `consoleBold` + `receptionist` |
| **B5** | Forms, Proposals, Automations — Ada guided build on each | `consoleBold` |
| **B6** | Lead finder (both modes) + BuyerPing tier | `consoleBold` |
| **B7** | Settings & Business core (one surface), senders wizards, guardrails, credits spend view | `consoleBold` |
| **B8** | Integrations grid + ads group chrome; Analytics | `consoleBold` |
| **B9** | First run: auth, 6-step Core, ghost dock, plan screen + trial | `firstRunBold` |
| **B10** | Agency suite + client portal skin; DFY templates | `agencyBold` |
| **B11** | Ads Closed Loop product (Addendum 3, unchanged) | `adsLoop` |

Every wave: its own PR, its own PROGRESS.md entry, screenshot pairs (prototype vs port) per PHASE1_FIDELITY_CHECKPOINTS.md, legacy e2e green.
