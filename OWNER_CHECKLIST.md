# OWNER_CHECKLIST — everything the owner does by hand (Q-005)

> Written for a non-technical owner: every step says exactly where to click.
> Authored in P1.5 (PR #29), referenced by `PHASE1_HANDOFF.md §G`. When a step
> is already done it is marked ✅ — keep it here as the record of how it was
> done, in case it ever needs redoing.

## 1. Email domain authentication — ✅ DONE (verified 2026-07-03)

SendGrid domain authentication for `clientforce.io` is **verified** (you added
the CNAME records at SiteGround). Nothing to do. For the record, if SendGrid
ever asks again:

1. Log in at **app.sendgrid.com** → left menu **Settings → Sender
   Authentication → Authenticate Your Domain**.
2. SendGrid shows 3 CNAME records. At **SiteGround** → **Websites → Site
   Tools → Domain → DNS Zone Editor**, add each one as a **CNAME** exactly as
   shown.
3. Back in SendGrid click **Verify**.

⚠️ **Never add or change MX, SPF, or TXT records on the root domain
(`clientforce.io` itself)** — your company mailboxes live there. Everything
the product needs lives on the `send.` and `reply.` subdomains, and the only
MX we ever add is on `reply.clientforce.io` (that step comes with P1.7
inbound parse — you will get its own click-by-click then).

## 2. Key Vault secrets — ✅ ALL PRESENT (as of 2026-07-04)

| Secret name                         | Status | Used for                          |
| ----------------------------------- | ------ | --------------------------------- |
| `DATABASE-URL` / `APP-DATABASE-URL` | ✅     | database                          |
| `REDIS-URL`                         | ✅     | job queues                        |
| `AUTH-DEV-SECRET`                   | ✅     | dev sign-in                       |
| `ANTHROPIC-API-KEY`                 | ✅     | AI planning/distilling            |
| `OPENAI-API-KEY`                    | ✅     | embeddings (knowledge search)     |
| `SENDGRID-API-KEY`                  | ✅     | sending email                     |
| `STORAGE-CONNECTION-STRING`         | ✅     | document uploads                  |
| `FIELD-ENCRYPTION-KEY`              | ✅     | encrypting per-tenant credentials |

To add or replace any secret: **portal.azure.com** → search **clientforce-kv**
→ **Objects → Secrets** → **+ Generate/Import** → type the name EXACTLY as in
the table → paste the value → **Create**. (For `FIELD-ENCRYPTION-KEY`, use the
Cloud Shell command from PR #29 so the value is properly random.)

## 3. Test inbox (§G)

`tronwebng@gmail.com` is the only address the platform will send to during
Phase 1 (the allow-list is baked into the deployment). Demo emails arrive
from **agent@send.clientforce.io** — check spam the first time. Sends stay in
SendGrid **sandbox mode** (validated but not delivered) until P1.8 turns real
delivery on deliberately.

## 4. Coming later (you'll get click-by-click when each arrives)

- **P1.7:** one MX record on `reply.clientforce.io` at SiteGround (inbound
  replies) + enabling the SendGrid event webhook (adds
  `SENDGRID-WEBHOOK-PUBLIC-KEY` to Key Vault).
- **P1.8:** turning sandbox off for the live demo sequence.
