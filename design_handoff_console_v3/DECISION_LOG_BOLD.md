# DECISION LOG — Console **Bold** era
Every ruling below has a rejected alternative behind it. They were built, reviewed and turned down. **Do not re-litigate during the port** — if a porter thinks the rejected option is better, that is a DEC/Q entry, not a code change.

Format: **Ruling** · what was rejected · why.

---

## Shell and navigation

**Bold replaces v3 wholesale.** *Rejected: restyling v3 to feel bolder.* v3 read as crowded, label-heavy and generically AI-authored. The fix was structural — fewer labels, lower density, bolder type, a fixed three-column frame — not a paint job.

**Page never scrolls; canvas scrolls internally.** *Rejected: document-level scroll.* The Ada bar must always be reachable; page scroll pushed it below the fold at laptop height.

**Focus mode is user-invoked only.** *Rejected: automatic focus on a timer.* An auto-zoom that engaged after 25s was built and tuned across six rounds of motion feedback (pan speed, simultaneity, easing). It was then removed entirely — re-entering zoom when switching campaigns felt awkward and the automation was doing work the user had not asked for. The motion itself was good; the trigger was wrong.

**Rail collapse is an icon.** *Rejected: labelled button; also rejected: collapsing into the receptionist tile.* The collapsed rail lives on the console icon and stays visually separate from the receptionist.

**Dock icon Style A**, Style B saved as the alternate. *Rejected: a third exploration and the all-one-colour treatment.* Alternating shades around the logo read as branded; flat fills did not.

**Chat-bubble pointer comes out of the canvas container** toward the active dock tile. *Rejected: a tail on the tile itself, and an inward-pointing tail.* It must read as the page speaking to the menu.

---

## Information hierarchy

**Stats are one row.** *Rejected: two rows.* Two rows made the hero feel like a report.

**Every figure carries a qualifier.** *Rejected: bare numbers.* `8 of 12 booked` tells a story; `8` is data slop.

**Ada's campaign proposals are rows in the campaign list.** *Rejected: a dedicated rail block above the list.* The block competed with real campaigns for attention. As rows with an amber spine they read as candidates in the same ledger. One muted suggestion at a time.

**Activity `View all` opens a page, not a tab.** *Rejected: a seventh tab.* The page is deep and occasional; tabs are for the six things you check constantly.

**Activity rows with counts drill into their subset.** *Rejected: a static count.* `sent to 22` is a question the user will ask; the answer must be one click away.

**Plan renders as a vertical line with nodes.** *Rejected: the dense per-step card stack from v3.* The line is scannable at a glance and the detail lives one click deeper.

**Branches and rules simplified, not removed.** *Rejected both extremes:* the full always-open rule matrix (unreadable) and hiding rules entirely (users need to see what the agent will do).

**Inbox uses three dropdowns with live counts.** *Rejected: chip rows for type and status.* Chips exposed every label at once — the specific complaint that triggered the Bold rebuild.

---

## Product structure

**One agent, multiple workspaces.** Tiers — **Starter / Growth / Scale** (`PRODUCT_DECISIONS.md` D2) — gate **workspaces · channels · senders · seats · credits**, not agent count, and are set at the **account level only**; workspaces inherit. *Rejected: per-workspace plans, and an "Agency" tier name.* Any copy selling "agents" is retired.

**Agency payouts are v2, not v1.** D2 also rules that the reseller framing and agency payouts are deferred: v1 billing is simply **the agency pays Clientforce**. The Earnings/Stripe-payout surface in the agency prototype is therefore designed-ahead, not v1 scope. *Kept in the prototype deliberately* — the owner sequences it — but a porter must not ship it in v1.

**Credit prices are data, never UI constants.** D1 rules them admin-editable (`CreditPrice`, platform default + per-agency override, effective-dated). Every price Bold displays is a read, not a literal.

**Site agent, not Chatbot.** *Rejected: keeping the toy-sounding name and treating it as a tool page.* It is the only always-on inbound surface in the core plan, so it gets channel treatment: rail presence, dock live indicator, first-class inbox type, outcome credit in money.

**`ALWAYS ON` is its own rail group.** *Rejected: leaving Site agent and Receptionist in the dock only.* Campaigns are outbound and finite; these two are continuous. The rail should show the difference.

**Not-installed states must have teeth.** *Rejected: a quiet grey "inactive" pill.* If the widget is off the site, every surface says so — amber dock dot, amber rail row at `$0`, page banner, cards with no conversion figure, changed Ada line. One flag drives all six.

**Receptionist is an add-on with its own identity**, alone at the top of the dock, its own pop-out and brand. *Rejected: a peer menu item.*

**Web chat and client messages are separate inbox types.** *Rejected: folding portal messages in with campaign threads.* A client asking to pause October is not a lead reply.

**Workspace settings and business profile are one surface.** *Rejected twice:* linking out from the profile to a separate settings page, and bolting the settings tabs onto the profile as extra tabs (which duplicated Profile and Guardrails). The correct answer was to design the merged hierarchy from scratch.

**Guardrails exist at two levels** — workspace-wide in settings, campaign-level in the campaign's own settings. They are not the same object.

**Credits: spend on the workspace side, plans/cards/invoices on the account-owner side.** *Rejected: a full billing pane inside workspace settings.*

**Sub-accounts, never "reseller".** 20 by default. A workspace is a business you run campaigns for inside your own account; a sub-account is a separate login you hand a client. A workspace can be a client for view-and-approve; a sub-account is for clients who actually use the product.

**Stripe connect is prominent on Earnings** and referenced when creating a sub-account. Billing method (Stripe or manual) is chosen per sub-account at creation. *Rejected: "or bill manually instead" as a top-level alternative to connecting Stripe.*

---

## Add-ons

**Ads Closed Loop is one $49/mo entitlement covering Meta and Google.** *Rejected: per-platform pricing.* Connecting the second platform is free.

**Add-on showcases use Clientforce blues and greens.** *Rejected: Meta blue and Google red.* Platform brand colours felt off and made the page look like someone else's product.

**Showcase copy is written for the customer.** Internal strategy notes, pricing mechanics and "rails" asides never render. This leaked into the UI once and was removed.

**Setup happens in a portable container on the page** (~640px, centred). *Rejected: full-bleed takeover.*

---

## Creation model

**Ada guides creation; direct editing manages.** Every artifact (form, chatbot, proposal, automation, campaign) can be built with Ada in chat or edited directly. *Rejected: Ada-only creation* — for simple objects like a new list, routing through the agent is friction, though the agent must still be told the list exists.

**Ada's guided build runs in the chat.** *Rejected: popup wizards.* The instruction was more depth in the setup, not a different interaction model.

**A guided build must reach a complete artifact** — every setting the manual editor exposes, including the unglamorous ones (field types, redirect destination, routing). A flow that produces a half-configured object is not done.

---

## First run

**Plan is its own focused screen at the end.** *Rejected: a plan block at the bottom of the last Core step.*

**Free trial leads, and the card is captured at signup.** $0.00 today, dynamic trial-end date, tier price shown for what happens after, CTA gated until the card validates.

**Onboarding rail is a light panel.** *Rejected: a forest-filled panel.* The dark sidebar is retired brand-wide; a green-filled rail is the same mistake wearing brand colour.

**Ghost dock during setup.** All 11 console tiles sit locked on the right edge and unlock as the Core fills. This is why the console feels familiar on first entry — it is not decoration.

**Onboarding copy is model-neutral.** *Rejected: booking-led copy.* Outcomes are trial, demo, quote or checkout depending on the business.

---

## Visual system

**Bold is an Apple-influenced reading of the brand**: generous whitespace, 900-weight display type with tight tracking, hairlines carrying structure, colour used as a role signal rather than decoration.

**Colour roles.** Forest/mint = Ada, live, create. Cyan `#0E7D93` = navigate/inspect. Amber = needs-you. Red = danger. Green is not the only voice — an all-green interface was the complaint that produced this rule.

**Elevation amendment.** The brand's ZERO-box-shadow rule is amended for Bold: two-layer elevation (1px contact + soft ambient, e.g. `0 1px 2px rgba(16,22,19,.05), 0 14px 38px -14px rgba(16,22,19,.18)`) is permitted on cards and stages, and soft green glows mark live/active elements. **Hard grey drop shadows remain banned**; hairlines still carry structure. Recessed wells (`#F4F6F5` + inset shadow) are the input treatment — more white boxes made everything read as one flat sheet.

**Internal pages get one container background**, not a background per element.

**Numbers and card titles are Schibsted Grotesk 900**; mono is for labels, eyebrows and IDs only. Eyebrows 9.5px/.18em; stat labels 10px/.13em.

---

## Recurring defects (five, each cost real time)

1. **`flex:none` on every card in a scrolling flex column.** Default shrink collapses the tallest panel to ~2px; `overflow:hidden` clips the content. Text present in the DOM, invisible on screen. Hit three times.
2. **`min-height:0` on every `flex:1` scroll window.** Without it the footer leaves the viewport.
3. **Unbalanced `</div>` after partial template edits.** Produced a blank canvas twice. Verify div depth parses to zero after any large string edit.
4. **Every overlay/route discriminant needs an explicit branch.** A missing `t:'block'` case fell through to a lookup returning `undefined` and threw inside render.
5. **State coherence across flags.** One flag must drive every dependent surface together, or the screen contradicts itself.
