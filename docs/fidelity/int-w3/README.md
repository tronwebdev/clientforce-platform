# INT W3 — Payments & the generic webhook · §8 evidence (11 build shots + 4 proto twins + walk receipts, 1440×900)

Canon: `design_handoff_clientforce_restyle/prototypes/Integrations.dc.html`
(the Stripe payments card — shipped CONNECTED in the canon, so its twin is
the connected drawer — and the Webhooks card's wizard: `fields` Payload URL +
signing secret → events pick → test step), plus the builder/Inbox/Leads/Logs
surfaces the payment rows land on.

Every frame is the REAL stack (Postgres 16 + pgvector at branch head, Redis,
api/worker/web production builds, dev sign-in, the seeded demo workspace
carrying the W2 walk's history — one thread now tells the whole journey:
outreach → booking → invoice → payment). **Vendors at their HTTP-seam
stubs** (`STRIPE_BASE_URL`, plus the W2 seams); two in-process intercepts
disclosed below. Nothing UI-side is mocked; every state EARNED through the
API/bus/engine.

## Frames

| Frame | What it proves |
| ----- | -------------- |
| `build-integrations-grid-payments-live` | Stripe + Webhooks cards flip LIVE off the core union (absent entries retired); the honest connected count carries the W2 connections. |
| `build-stripe-fields-step` ↔ `proto-stripe-drawer-connected` | **Flagged adaptation:** the canon ships Stripe pre-connected with a simulated OAuth; the build connects via the canon `fields` step KIND (the SMTP/Calendly precedent) — Payment Link (tier 1) + restricted API key (tier 2, `pw`), both visible. |
| `build-stripe-drawer-connected` | The key tier EARNED: accountLabel "Demo Agency (acct_1QDemo42)" from the real `/v1/account` probe (the canon's "Business (acct_…)" shape), "✓ Payment detection live — webhook endpoint active", the capability webhook endpoint row — **Stripe minted the signing secret at create; it landed field-encrypted**. |
| `build-webhooks-fields-step` ↔ `proto-webhooks-wizard-fields` | The canon Payload URL field built verbatim; the canon's signing-secret INPUT is a designed delta — the build MINTS the per-workspace secret server-side (a typed secret would be weaker and unrecoverable); it surfaces on the connected drawer instead. |
| `build-webhooks-drawer-connected` ↔ `proto-webhooks-wizard-test` | The canon test step is REAL: connect ran the delivery guard + a SIGNED test POST (`webhook.test`, receipt #1 in the JSON) and only a 2xx became `connected`. The drawer shows the Payload URL + the signing secret with copy + the signature scheme line. |
| `proto-webhooks-wizard-events` | The canon events-pick step — the STREAM half deliberately NOT built (honest absence, re-filed → Q-048); shot as the canon record of what re-files. |
| `build-trigger-picker-payment-live` | "Payment succeeded" LIVE in Proposals & revenue (the canon literal, kind `payment_received`); the absent entry retired; Payment failed / Invoice overdue / proposals stay honestly absent beside it. |
| `build-action-picker-webhook-url` | ONE rule, three actions through the real builder: notify_team + TWO `send_webhook` rows — the public ops endpoint and the PRIVATE intranet twin — each with its own URL input (blank = the integration default). A second `payment_received` RULE was refused by the duplicate-trigger 422 (the honest reason one rule carries both probes). |
| `build-inbox-thread-payment-link-email` + receipts | **The `send_payment_link` flag walk:** the flag promoted the per-lead payment link (`?client_reference_id=<Ada's contactId>`) to mustSay → the real composer included it VERBATIM (the checks refuse otherwise) → the real boundary sent it and CLEARED the flag (asserted). The payment link never rides as an ambient talking point — flag-gated only (the documented default). |
| `build-inbox-thread-payment-system-row` | **The payment, end-to-end:** a SIGNED `checkout.session.completed` (t/v1 over the raw body with the minted endpoint secret) → the @Public endpoint → reference correlation → `payment.received.v1` (claim-first idempotent) → the thread's "💳 Payment received — $1,500.00" system row beneath the W2 booking row — one thread, the full journey. |
| `build-lead-drawer-payment-timeline` | The lead timeline: the 💳 row beside the W2 calendar rows — Event-sourced, never a fabricated Message. |
| `build-automation-drawer-run-row` + `w3-stub-receipts.json` | **The rule fired ONCE with all three outcomes in one run row** (the receipts carry the run detail verbatim): `notify_team → delivered to Slack #clientforce-alerts` · `send_webhook → delivered to https://1.1.1.1:8443/w3-evidence` (receipt #2: the signed POST with `x-clientforce-event: payment.received.v1`, verifiable against the workspace secret) · `send_webhook → skipped (the destination resolves to a non-public address — webhooks deliver to public endpoints only)` — **the guard's typed refusal beside a successful delivery, same event, same run.** |

## Capture environment & disclosures

- **Two in-process intercepts, both flagged:** (1) the W2 link-probe shim
  extended to stripe.com page GETs (the SSRF-pinned hosts have no env seam by
  design; the sandbox proxy blocks them); (2) a worker/api fetch shim
  answering EXACTLY `https://1.1.1.1:8443/…` and recording the signed POST —
  **the delivery guard ran for real** (a public literal passes it; the shim
  stands in for the owner's receiver because the sandbox has no egress). The
  guard's real refusal is separately evidenced by the intranet twin, which no
  shim touches.
- The walk is script-fired, rails-real (the W2 precedent): the script plays
  only the send timer and Stripe's POST; compose/boundary/verify/ingest/
  engine/deliveries are all the real code paths.
- The builder walk exercised the REAL duplicate-trigger refusal (a second
  `payment_received` rule 422s) — why one rule carries both webhook probes.
- Capability tokens in the receipts are masked; the stub-minted signing
  secret is labeled, never printed.
