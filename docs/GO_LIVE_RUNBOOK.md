# Go-live runbook

Config gates that must hold before (and after) any production flip. Two
kinds of item:

- **Pipeline-verified** — asserted by a workflow/deploy gate on every run;
  listed for completeness, no human action unless red.
- **HUMAN-VERIFIED** — console-only settings no pipeline can assert. These
  regress silently (a re-created vendor resource comes back with defaults),
  so a named person re-checks each one at go-live and after any vendor-side
  re-provisioning.

## Email (SendGrid)

| # | Item | Kind | How verified |
|---|------|------|--------------|
| E1 | `SENDGRID_SANDBOX` stays `'true'` everywhere; ONLY an explicit production parameter flips it (DEC-060a) | Pipeline | Bicep param default; live-send-proof runs with sandbox off in-script only |
| E2 | Domain authentication for the send domain valid (SPF/DKIM) + `_dmarc` TXT present | Pipeline | `live-send-proof` hard-gates on the SendGrid domain-auth API + DNS lookup before any real send |
| E3 | Recipient allow-list (`CHANNELS_ALLOWLIST`, DEC-014) widened only by a logged DEC | HUMAN-VERIFIED | Owner decision recorded in PROGRESS.md before the env value changes |
| E4 | Root-domain mail DNS (`clientforce.io` MX / SPF on `@`) untouched — product mail lives on `send.` / `reply.` subdomains only (DEC-013, handoff §G) | HUMAN-VERIFIED | Any DNS change reviewed against this rule before saving |

## SMS (Twilio)

| # | Item | Kind | How verified |
|---|------|------|--------------|
| S1 | `SMS_SANDBOX` stays `'true'` everywhere; ONLY an explicit production parameter flips it (DEC-061) | Pipeline | Bicep param default; sms-live-proof runs with sandbox off in-script only |
| S2 | **Advanced Opt-Out ON** on the Messaging Service (rail 1 of the DEC-062 double rail) | **HUMAN-VERIFIED** | Console-only config with NO API — a new/re-created Messaging Service comes back with it OFF and nothing in the pipeline can detect that. Check: Twilio console → Messaging → Services → service → Opt-Out Management → Advanced Opt-Out enabled. Evidence of a regression: STOP replies get no confirmation and `sms-inbound-probe` shows no `outbound-reply` record (see DEC-064 verification) |
| S3 | Messaging Service inbound webhook = `https://<api-fqdn>/webhooks/twilio-inbound`, POST (rail 2) | HUMAN-VERIFIED | `sms-inbound-probe` prints the configured `inbound_request_url` — dispatch it after any Messaging Service change |
| S4 | SMS recipient allow-list — Key Vault `SMS-ALLOWLIST` secret → `CHANNELS_SMS_ALLOWLIST` (DEC-063/067; numbers never in the repo) — widened only by a logged DEC | HUMAN-VERIFIED | Owner decision recorded in PROGRESS.md before the secret value changes |
| S5 | International note: inbound MO from non-US handsets to the US 10DLC number works for the owner's NG test route today, but is carrier-dependent — audiences outside the US need an inbound-capable number decision before SMS go-live in that market. Twilio's opt-out keyword handling (rail 1) is US/CA-scoped and NEVER engages for non-US/CA handsets (DEC-067) — rail 2 (our webhook suppression) is the rail the product controls for those routes | HUMAN-VERIFIED | Product/config decision, logged as a DEC |
| S6 | Standing US test handset: one platform-owned US local number, Twilio FriendlyName `clientforce-us-test`, Key Vault `SMS-US-TEST-NUMBER`, attached to the platform messaging service (sends under the approved A2P campaign; the pool holds 2 numbers). Sole purpose: driving rail-1 keyword proofs via `sms-us-rail1-proof` (DEC-067) | HUMAN-VERIFIED | Number exists in the Twilio console under that FriendlyName; releasing it re-opens the rail-1 evidence gap |

## Auth (Clerk)

| # | Item | Kind | How verified |
|---|------|------|--------------|
| A1 | Clerk quartet in Key Vault (`CLERK-PUBLISHABLE-KEY`/`CLERK-SECRET-KEY`/`CLERK-JWKS-URL`/`CLERK-ISSUER`) — all four or Clerk stays OFF | Pipeline | deploy probe + preflight partial-set warning |
| A2 | Clerk session-token template includes the `email` claim (lazy User upsert requires it, DEC-060) | HUMAN-VERIFIED | Clerk dashboard → Sessions → token template; a missing claim surfaces as `401 Unknown principal` on first login |
| A3 | Dev rail (`AUTH_DEV_SECRET`) is a staging convenience — production removes the secret so only OIDC verifies (DEC-060b dual verifier selects by configured env) | HUMAN-VERIFIED | Production parameter review: no `AUTH-DEV-SECRET` in the production vault |

## Platform

| # | Item | Kind | How verified |
|---|------|------|--------------|
| P1 | Secret scan green (`infra/scripts/secret-scan.sh`) | Pipeline | Gates every deploy |
| P2 | Redis access-key rotation (long-standing platform-team item) | HUMAN-VERIFIED | Tracked in PROGRESS.md open questions until done |
