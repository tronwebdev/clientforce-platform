# INT W5 — Zapier private app · §8 evidence

Canon: `design_handoff_clientforce_restyle/prototypes/Integrations.dc.html` (the
Zapier card, previously honest-absent). W5 flips it live.

**Staging proof PASSED** — [run 30211376898](https://github.com/tronwebdev/clientforce-platform/actions/runs/30211376898),
all 5 gates on real Postgres + RLS.

## Frames

| Artifact | What it shows |
| -------- | ------------- |
| `build-integrations-grid.png` | The LIVE grid at 1440×900 — the `zapier` card now **"✓ Connected"** with a **Manage** button, flipped off core `INTEGRATION_PROVIDERS` with zero web registry edits (availability derives). The honest-absent neighbours (Salesforce, Gmail, Outlook, WhatsApp) are unchanged, and Twilio still deep-links to its managed surface. |
| `build-zapier-drawer.png` | The LIVE drawer — "Live · Connected", Account **Zapier (private app)**, the masked key `cfk_58237caa1827_…` (prefix only — the secret is unrecoverable by construction), the invite URL, the private-app disclosure, and WHAT'S SYNCING rendering the three derived rows. |

## Two things the frames deliberately show

**The key is masked, because it cannot be unmasked.** Only `prefix` and a
SHA-256 `hash` are stored, so the drawer *cannot* redisplay a key even if the
UI wanted to — a lost key is re-minted, never recovered. The copy says so.

**The third sync row is an honest negative.** It reads *"Rule actions (stage,
tags, suppression, CRM deal) — decided, not yet published as Zap steps"*. The
exposure map decides every rule-action kind, but the published app renders only
the inbound writes until the engine transports are wired (Q-060). An earlier
capture listed those actions flatly, which advertised steps a Zapier user
cannot pick; the row was corrected rather than the screenshot retaken around it.

## Capture environment & disclosures

- 1440×900 on the REAL local stack: web production build (`next start`) + api +
  PG16 + Redis, dev sign-in as `owner@demo-agency.test`, with a seeded `zapier`
  connection (a real minted key row + the invite URL in config). The connection
  STATE is seeded — this is the UI-state capture; the RAIL is proven separately
  by the staging proof above.
- No prototype twin is included for the drawer: the canon ships Zapier only as a
  grid card with no drawer design, so there is nothing to pair against. Flagged
  rather than fabricated. The grid frame pairs against the canon card directly.
- Capture script deleted before commit (the G-fidelity discipline).

## Test-pinned behaviour

- `packages/integrations/test/zapier.test.ts` (19) — the exposure map covers
  exactly the engine's kinds, declines carry reasons, keys are unique, no step
  claims to send, triggers name only real catalog events, the gap predicate
  matches the rule matcher, and the manifest offers nothing for unregistered
  capabilities (forms, proposals).
- `packages/integrations/test/api-key.test.ts` (11) — the stored row cannot
  reconstruct a token, one-character mutations fail, a valid prefix with a
  forged secret fails, and the base64url `_` regression is pinned over 300 mints.
- `apps/zapier/src/app.test.ts` (8) — the app renders only implemented steps
  (shipped creates ⊆ implemented), derives input fields from the zod contracts,
  and ships no send step under any name.
