# PLAN — Contact custom fields (unit "C2.7", owner-directed 2026-07-07)

> Status: **APPROVED (owner, 2026-07-07)** — decisions resolved below; land as
> a DEC + checkpoints §3/§5 amendment with the C2.7 kickoff. Nothing here
> changes the PR #36/#37 fix rounds already in flight (36-1 ships the add
> drawer WITHOUT the custom-fields block, logged as a DEC omission; this unit
> restores it as a working feature).

## Goal
Workspace-defined custom fields on contacts. Users can create fields
**manually** (inline, while adding a contact) and **during CSV import**
(map an unmatched column to a new field). Values are visible and editable on
the contact, and usable as personalization tokens in sequences.

## Data model (1 new model + 1 new column)
```prisma
model ContactFieldDef {
  id          String   @id @default(cuid())
  workspaceId String
  key         String   // slug, immutable ("industry", "source_url")
  label       String   // display ("Industry")
  type        FieldType @default(TEXT)   // TEXT | NUMBER | DATE | SELECT
  options     String[] // SELECT only
  origin      String   // "manual" | "csv_import"
  archived    Boolean  @default(false)
  createdAt / updatedAt
  @@unique([workspaceId, key])
}
```
- Values: new `Contact.custom Json @default("{}")` keyed by def key.
  **Not** `enrichment` — that stays reserved for future auto-enrichment so
  user data and machine data never mix.
- Archive, never delete: archived defs hide from UI; values stay in the JSON
  (un-archive restores them). No destructive migration path needed.
- Guard: max 30 active defs per workspace (server-enforced).

## API
- `GET/POST /contact-fields`, `PATCH /contact-fields/:id` (label, options,
  archived). Key + type immutable after creation.
- Contact create/update accepts `custom: { key: value }` (validated against
  active defs; unknown keys rejected).
- CSV import target list = fixed columns + active defs + `__create__`
  (payload carries `{ label, type: TEXT }`, def created transactionally with
  the import).
- `GET /contacts` returns `custom`.

## UI surfaces (v1)
1. **Add-contact drawer** (the 484px drawer from the 36-1 rebuild): CUSTOM
   FIELDS block per the prototype — active defs render as optional inputs;
   "+ Add field" opens the prototype's inline input ("e.g. Industry, Source
   URL, Plan") → creates a TEXT def + focuses its value input.
2. **CSV import, step 2 (Map your columns)** (from the 36-2 rebuild): each
   unmatched CSV column's target dropdown gains existing custom fields +
   "＋ Create field '<Column name>'". Step 3 review counts them.
3. **Contact detail drawer**: custom values append to the DETAILS list
   (same row anatomy); rows are click-to-edit inline (value only).
4. **Wizard step-2 editor + step editor drawer**: personalization chip picker
   gains `{{custom.<key>}}` tokens. Inserting one requires a **fallback**
   ("or use: ___") — the renderer emits value-or-fallback, **never blank**
   (P1.5 blank-token rule precedent). Send boundary treats a custom token
   with no value AND no fallback as a validation error at save time, not a
   silent send.

## Explicitly deferred (v1.1+, log as such)
- Custom fields as table columns / sort / filters / segment queries.
- Field manager page in Settings (rename/archive UI beyond the API).
- NUMBER/DATE/SELECT **creation** UI — the model supports the types, but v1
  creation surfaces make TEXT only (keeps both create flows one-tap).
- Auto-enrichment writing into `enrichment`.

## RESOLVED — owner decisions (2026-07-07)
1. **Tokens in v1: YES**, with mandatory fallback (never-blank rule).
2. **Field creation is ADMIN-only** (OWNER/ADMIN roles). Non-admins see and
   fill existing custom-field inputs everywhere, but the "+ Add field"
   affordance (drawer) and "＋ Create field" row (CSV map) render only for
   admins; the API rejects def-creation from non-admin roles. CSV import by a
   non-admin maps to existing fields only.
3. **Inline value edit in the detail drawer: in v1** (values only; defs still
   API/create-flows only).
4. **Sequencing: C2.7, after C2.6**, building on the rebuilt drawer + import
   from the #36 fix round.

## Design pass (owner/me, before the build starts)
Update `Contacts.dc.html` → commit as the §5 fidelity source:
- detail-drawer DETAILS list with 2 custom rows + inline edit state
- import step-2 target dropdown open, showing custom targets + create row
- add-drawer custom block: filled def inputs + the inline create state
Plus `Create Agent.dc.html` token picker with one `{{custom.*}}` chip +
fallback input state. Checkpoints §3/§5 amended in the same commit.

## Acceptance (build unit)
Create field inline while adding a contact → appears on a second contact's
add drawer; CSV import creates a field from an unmatched column and values
land; detail drawer shows + edits the value; token with fallback renders
value-or-fallback in a real send (never blank); archived def disappears from
all pickers, values preserved; 31st def rejected with a designed error; all
RLS-scoped; §8 pairs for every surface state above.
