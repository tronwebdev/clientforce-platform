# PLAN — Contact Lists (owner-directed 2026-07-07)

> Status: **APPROVED (owner, 2026-07-07)** — all four OPEN items yes as
> proposed (CSV step-3 list select · any-member create · snapshot-at-launch
> enrollment · sequenced C2.8, goal-state slides to C2.9). Becomes a DEC +
> checkpoint amendment at kickoff. Restores the C2.5/DEC-044
> approved omissions (add-drawer LIST select, bulk ADD TO LIST) as a working
> feature. Owner framing: lists are used in the Create Agent flow too, and
> later connect to Forms, Widget, and Automations triggers — v1 builds the
> model + core surfaces and the JOIN POINTS, not the integrations.

## Lists vs segments (definition, to prevent scope drift)
- **Segments** (existing tabs: New / Replied / Qualified / Booked / Unsub) =
  dynamic queries over derived status. Never stored membership.
- **Lists** = static, named membership sets ("Q3 dental leads", "Webinar
  invitees"). A contact can be in many lists. Removing from a list never
  deletes the contact.

## Data model
```prisma
model ContactList {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  origin      String  // "manual" | "csv_import" | "form" | "widget" | "automation" (future origins reserved)
  archived    Boolean @default(false)
  createdAt / updatedAt
  @@unique([workspaceId, name])
}
model ContactListMember {
  listId    String
  contactId String
  addedAt   DateTime @default(now())
  addedBy   String   // userId | "import" | "automation"
  @@id([listId, contactId])
}
```
- Archive, never delete (consistent with ContactFieldDef).
- **Event join point:** emit `list.member.added.v1` / `list.member.removed.v1`
  on the existing bus — this is what Automations triggers subscribe to later;
  Forms/Widget will write through the same membership API with their origin.
  No integration UI in v1.

## API
- `GET/POST /lists`, `PATCH /lists/:id` (name/archived).
- `POST /lists/:id/members` (bulk contactIds), `DELETE /lists/:id/members`
  (bulk). Membership changes emit the events above.
- `GET /contacts?listId=` filter; contact payload gains `lists: [{id,name}]`.
- Any member can create/manage lists (working data, not schema — unlike
  custom fields' admin-only rule). OPEN #2 if owner disagrees.

## UI surfaces (v1) — the PROTOTYPE ALREADY DESIGNS MOST OF THIS
Discovery (2026-07-07): `Contacts.dc.html` already carries the full lists
anatomy — 226px LISTS RAIL (All contacts + per-list rows w/ icon + count,
gradient active state, “＋ New list”), list-scoped header (name + green LIST
badge + “N contacts in this list”), New-list modal, add-drawer LIST select,
CSV step-3 “Add to list” select, LIST table column — and `Create Agent
.dc.html` step 3 already has the “Choose a list” source card + 480px list
picker modal. C2.5/C2.3 omitted all of it under DEC-044 (nothing backed it).
So v1 = wire the prototype's existing list anatomy, plus ONE additive v4
state (added 2026-07-07 to the prototype): the bulk-bar “≣ Add to list” is
now a MENU — “Add N to list” header, existing lists w/ icon+count, “＋ New
list from selection” row feeding the New-list modal (assigns the selection on
create).

1. **Lists rail** — live lists w/ real counts, scoping the table; “＋ New
   list” → modal → POST /lists.
2. **Bulk bar** — the v4 add-to-list menu → bulk membership POST; “New list
   from selection” creates + assigns.
3. **Add-contact drawer** — LIST select active (attach on create).
4. **CSV import step 3** — “Add to list” select (existing or none; origin
   csv_import).
5. **Create Agent step 3** — “Choose a list” card + picker modal live
   (members enroll at launch, snapshot semantics).
6. LIST column renders membership (primary list; “+N” when multiple — build
   detail, prototype shows primary).
7. **Contact detail drawer** — List row atop DETAILS (current list + green
   “＋ Add to list” button → the same menu; “＋ New list” assigns this
   contact on create). Added to the v4 prototype 2026-07-07 per owner.

**Unification rule (owner, 2026-07-07): one Add-to-list menu component,
everywhere leads/contacts appear.** The v4 menu anatomy (header · list rows
w/ icon+count · ✓ on current · “＋ New list” footer) is the binding pattern
for: Contacts bulk bar, contact detail drawer, Campaign-view Leads-tab bulk
bar, and the lead detail drawer. The build implements it once (packages/ui)
and mounts it in all four spots — the Contacts prototype is the fidelity
source for all of them (checkpoints §4 amendment references §5's anatomy).
Dropped from v1 (not in prototype): separate list filter dropdown (the rail
IS the filter).

## Deferred (design join points only, do not build)
- Forms / Widget / Automations creating or feeding lists (origins + events
  reserved above; Automations prototype already names "list" triggers).
- Live-sync ("smart") lists; list-based sending caps; list sharing.

## Design pass — DONE (2026-07-07, additive v4)
- `Contacts.dc.html`: bulk-bar add-to-list menu (header “Add N to list”,
  existing lists w/ icon+count, “＋ New list from selection”) + drawer List
  row with the same menu (✓ on current list) + list-override plumbing so
  picks update the LIST column, rail counts, and scoping live.
- Everything else needed already existed in the prototypes (rail, modal,
  drawer select, import select, wizard card + picker).

## Acceptance
Create list from bulk bar (“New list from selection”) → members assigned →
rail count + scope show exactly them; add-to-existing via the bulk menu
updates column + counts; add-drawer LIST select attaches on create; CSV
import into a list lands all rows; step-3 list pick enrolls members at
launch (evidenced in Leads tab); events emitted per membership change (test
asserts payloads); archived list vanishes from pickers, membership
preserved; RLS-scoped; §8 pairs per surface state.

## OPEN — owner decisions
1. CSV step-3 "add to list" in v1 — proposed YES.
2. List create/manage = any member — proposed YES (admin-only alternative).
3. Step-3 enrollment = snapshot at launch — proposed YES (live-sync deferred).
4. Sequencing: after C2.7 as C2.8, with goal-state sliding to C2.9 — or
   swap. Both touch Contacts; lists first is proposed since it closes a
   user-visible gap ("feature looks broken") while goal-state is wording.
