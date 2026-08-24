# DISPATCH — Console **Bold** port (B0 → B11)
Send this to Claude Code as the kickoff for the console rebuild port. It supersedes `PROMPT_V3_PORT_KICKOFF.md` and `PROMPT_V3_W0_W1_KICKOFF.md`. `PROMPT_V3_W11_ADS_LOOP_KICKOFF.md` still stands for the ads wave (renumbered B11).

---

## Before you write a line of code

1. **Read the repo, not your memory.** `PROGRESS.md` Status table + the DEC ledger tail (`github_search_code` for `DEC-1\d\d`) tell you what is already on main. Confirm merged surfaces, DEC/Q ids in use, and branch divergence before opening a branch. Never infer build status from plan order.
2. **Read `UI_PORTING_RULES.md`.** It governs this port: atoms come from the token doc, composition and behaviour come from the prototype, conflicts get logged as DEC/Q rather than silently decided.
3. **Read the package in this order:** `MIGRATION_NON_BREAKING.md` → `DESIGN_TOKENS_V3.md` (including **§Bold** at the foot) → **`ADDENDUM_4_BOLD.md`** → **`SURFACE_SPECS_BOLD.md`** → **`DECISION_LOG_BOLD.md`** → `BACKEND_TOUCH_MAP.md` → `ADDENDUM_2_CREDITS_VALUE.md` → `ADDENDUM_3_ADS_LOOP_UI.md`.
   **Addendum 4 is newest and wins every conflict.** Addenda 2 and 3 still own credits/value semantics and the Ads Closed Loop product. `SURFACE_SPECS.md` and `CONSOLE_V3_CANON.md` are v3-era: valid for semantics and history, superseded by the Bold docs on shell and composition.
   **`DECISION_LOG_BOLD.md` is not optional reading.** It records what was built, reviewed and rejected. If something in the prototype looks improvable, check there first — it is probably the alternative that already lost.
4. **Open the prototypes and click everything.** `prototypes/Console Bold.dc.html` is the console's pixel truth. `prototypes/legacy/Clientforce Console.dc.html` is the retired v3 console — consult it only to answer a question Bold does not answer, never as a style reference.

---

## What this port is

The v3 console was rebuilt as **Console Bold** after the owner judged v3 crowded and text-heavy. Bold is a different shell, not a restyle: three fixed columns, an internally-scrolling canvas, a bolder type scale, lower density, fewer labels, and roughly a third of the surfaces recomposed.

**Product semantics did not change.** Campaign-rules vocabulary, RBAC enum, provider registry, credits model, value model and the Ads Closed Loop design are all as shipped or as specified in Addenda 2/3. This is a **skin + composition port on shipped semantics**, plus a defined list of additive endpoints.

---

## Non-breaking contract (unchanged, still binding)

### Repo rulings that override the prototype (read first — these are product, not style)

`UI_PORTING_RULES.md` gives composition to the prototype. These three are **product decisions already recorded in `PRODUCT_DECISIONS.md`**, so they beat the prototype and are not DEC-able:

- **D2 — tiers.** Three tiers, seeded `STARTER / GROWTH / SCALE`, set **at agency/account level only**; workspaces inherit and there is no per-workspace plan. **Per-tier limits are TBD and belong in the billing UI** — the onboarding prototype's 1 / 5 / 15 workspaces and 2,500 / 10,000 / 30,000 credits are *proposals for layout*, not values to hard-code. Wire them from `Plan` config.
- **D2 — v1 billing shape.** Agency → Workspace(client) → User, and **the agency pays Clientforce**. The "reseller" framing and **agency payouts are deferred to v2**. The agency prototype's Earnings/Stripe-payout surface is therefore **v2 scope**: port the agency home, sub-accounts, websites and selling tools; **do not build payouts in v1** — stub the route and log a Q.
- **D1 — credit prices.** Admin-editable via `CreditPrice` (platform default + per-agency override, effective-dated). Every per-action price shown in Bold's credits surfaces reads from that table. Never hard-code one in the UI.

1. Bold mounts behind flag `consoleBold` on a parallel route. Legacy screens stay untouched and their e2e smoke stays green every wave.
2. **API changes are additive only.** No renames, no column drops, no behaviour change to existing endpoints. New needs become new routes/tables — the list is in `BACKEND_TOUCH_MAP.md` §NEW plus Addendum 4 §8.
3. Reuse shipped vocabulary verbatim. Bold was built on it deliberately.
4. Order: tokens/ui package → shell → surface-by-surface behind the flag → new-feature endpoints last. One wave, one PR, one PROGRESS.md entry.
5. Flag flip is launch. Legacy removal is a separate owner-sequenced unit.

---

## The shell contract — get this exactly right in B0

```
height:100vh; overflow:hidden; padding:26px; display:flex; gap:18px
  rail   228px  flex:none   height:100%  overflow:hidden
  canvas flex:1 min-width:0 height:100%  overflow:hidden   ← scrolls internally
  dock    52px  flex:none   height:100%
```

Five rules, each of which was a real defect during the design build:

- **The page never scrolls.** Each column owns its scroll.
- **The Ada bar is pinned inside the canvas column**, outside the scrolling content — never inside a fixed-width card.
- Every column is `header (flex:none) → scroll window (flex:1; min-height:0) → footer (flex:none)`. Omitting `min-height:0` pushes footers off-screen.
- **Every card inside a scrolling flex column needs `flex:none`.** Default `flex-shrink:1` collapses the tallest panel to ~2px and `overflow:hidden` clips it: text present in the DOM, invisible on screen. Any "blank panel" bug is this until proven otherwise.
- The dock fits **11 tiles at 540px viewport height** without scrolling.

**B0 acceptance:** at 1280×720 and 924×540 — document scroll height equals viewport height, Ada bar fully visible, all 11 dock tiles visible, rail scrolls internally with its bottom card pinned.

---

## Waves

| Wave | Scope | Flag |
|---|---|---|
| **B0** | Tokens + shell: three-column frame, rail blocks, dock (Style A), Ada bar, collapse/focus, tour scaffold | `consoleBold` |
| **B1** | Campaign console: rail campaign list + inline Ada proposals, hero with goal label, one-row stats, activity feed, full activity page, tab frame | `consoleBold` |
| **B2** | Plan + branches (simplified), pipeline board **and** list, campaign inbox | `consoleBold` |
| **B3** | Contacts + detail + lists + CSV; workspace inbox incl. **web chat** and **client messages** types | `consoleBold` |
| **B4** | **Site agent** (channel treatment, install states, live preview) + Receptionist add-on (incoming call, setup, transcripts) | `consoleBold` + `receptionist` |
| **B5** | Forms, Proposals, Automations — each with its Ada guided build | `consoleBold` |
| **B6** | Lead finder: Ada mode (staged) + Direct mode (filter-first) + BuyerPing tier | `consoleBold` |
| **B7** | Settings & Business core as ONE surface, sender wizards, workspace guardrails, credits spend view | `consoleBold` |
| **B8** | Integrations grid + ads group chrome (no ads product yet); Analytics | `consoleBold` |
| **B9** | First run: auth, 6-step Core, ghost dock, plan screen **with card capture** | `firstRunBold` |
| **B10** | Agency suite + client portal skin pass; DFY website templates | `agencyBold` |
| **B11** | Ads Closed Loop product — per `ADDENDUM_3` + `PROMPT_V3_W11_ADS_LOOP_KICKOFF.md` | `adsLoop` |

---

## Per-wave protocol

- Branch per wave, PR per wave, `PROGRESS.md` entry per wave with DEC/Q ids allocated from the live ledger tail (check first — collisions are the failure mode).
- **Fidelity checkpoints** per `PHASE1_FIDELITY_CHECKPOINTS.md`: screenshot pairs, prototype vs port, attached to the PR. Every state, not just the happy one — empty, loading, error, over-quota, not-installed.
- Legacy e2e smoke green before merge.
- Anything the prototype does not answer → DEC/Q entry, do not invent.

---

## Wave-specific notes the specs alone will not give you

**B1 — campaign console.** Ada's suggested campaigns are rows *inside* the campaign list (amber spine, "Ada's idea" pill, Start action), not a separate rail block; that arrangement was built and rejected. Stats are one row and every figure carries a qualifier (`8 of 12 booked`) — bare numbers were rejected twice. Activity rows carrying a count (`sent to 22`) must open the sorted subset of those 22.

**B3 — inbox.** TYPE / STATUS / SORT are dropdowns with per-option live counts, not chip rows. Web chat is a first-class type with its own colour and icon; client-portal messages are a separate type from campaign threads. Site-agent threads carry a provenance pill above the messages.

**B4 — site agent.** One flag drives **all** of: dock tile title, dock dot colour, rail row, page header, banner, assistant cards and Ada's context line. Partial wiring produces a screen that contradicts itself — cards claiming "LIVE · 61 chats" while the widget is off the site was a real defect caught in review. Match the widget appearance to `Agent Widget v3 - Mock.dc.html`.

**B7 — settings.** Workspace settings and the business profile are **one surface**, not two linked pages. Senders sit at the top under their own heading, above what-the-agent-knows. Add-email and add-number are separate wizards. Credits here show **spend only** — plans, cards and invoices are account-owner side.

**B9 — first run.** The plan screen is its own focused screen at the end, free trial leading, and it **captures a card**: number / expiry / CVC, Stripe-secured, `$0.00 charged today`, dynamic trial-end date, tier price shown for what happens after. The CTA is disabled until the card validates. Tokenise with Stripe Elements + a SetupIntent — the prototype's plain inputs are shape only; never post a PAN to our API, and let the server-confirmed SetupIntent be what starts the trial. The ghost dock (11 locked console tiles that unlock as the Core fills) is why the console feels familiar on first entry — port it, it is not decoration.

**Tier semantics:** one agent, multiple workspaces. Tiers (**Starter / Growth / Scale**, per `PRODUCT_DECISIONS.md` D2) gate **workspaces · channels · senders · seats · credits**, never agent count, and are set **at the account level only** — workspaces inherit, there is no per-workspace plan. Retire any copy that sells "agents". The 1/5/15 workspace counts are the open D2 number: confirm in-repo before hard-coding.

---

## Definition of done for the port

A workspace owner can, entirely inside Bold behind the flag: sign up → let Ada read their site → assemble the Core in six steps → choose a plan and enter a card → land in the console → create a campaign against any of the ten goals → watch activity, work the inbox across five channel types → open any contact and act on it → build a form, a proposal, an automation and the site agent with Ada → find leads in either mode → tune settings, senders and guardrails → see credit spend → and read analytics. With legacy untouched and green.
