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

> **Two names for the same secret (normal — don't "fix" it):** Azure Key Vault
> doesn't allow underscores, so secrets are named with hyphens there
> (`ANTHROPIC-API-KEY`). Inside the running app the same value appears as an
> environment variable, which can't contain hyphens, so it's underscored
> (`ANTHROPIC_API_KEY`). The mapping between the two lives in
> `infra/main.bicep` and is checked by the deploy preflight — if anyone ever
> asks you "is the Anthropic key set up?", the Key Vault name in the table
> above is the one you look for.

## 3. Test inbox (§G)

`tronwebng@gmail.com` is the only address the platform will send to during
Phase 1 (the allow-list is baked into the deployment). Demo emails arrive
from **agent@send.clientforce.io** — check spam the first time. Sends stay in
SendGrid **sandbox mode** (validated but not delivered) until P1.8 turns real
delivery on deliberately.

## 4. Coming later (you'll get click-by-click when each arrives)

- **P1.6 deploy (Temporal):** the durable campaign engine needs a Temporal
  endpoint in staging. Recommendation: **Temporal Cloud** free tier — a short
  sign-up plus two Key Vault secrets (`TEMPORAL-ADDRESS`,
  `TEMPORAL-API-KEY`). Code, tests, and the live proof do NOT wait on this;
  you'll get the exact steps when we wire the staging deploy.
- **P1.7:** one MX record on `reply.clientforce.io` at SiteGround (inbound
  replies) + enabling the SendGrid event webhook (adds
  `SENDGRID-WEBHOOK-PUBLIC-KEY` to Key Vault) — **this one is now blocking a
  real protection; see §5 below.**
- **P1.8:** turning sandbox off for the live demo sequence.

## 5. Turn the SendGrid event webhook on — ⛔ NOT DONE, and it matters now

**What is wrong today, in one sentence:** we are not receiving a single bounce
or spam-complaint notification, because the secret that proves those messages
really come from SendGrid was never added, and the deployed app correctly
refuses unsigned ones.

**Why it matters more than it used to.** The build now *acts* on bounces and
complaints — a bad address gets suppressed automatically, and a sender that
starts bouncing gets paused before it damages the domain everyone else is
sending from. All of that machinery is waiting on notifications that never
arrive. Until this step is done, the bounce and complaint figures on screen
stay at zero **because nothing is being reported, not because nothing is going
wrong** — which is the more dangerous of the two.

**Roughly ten minutes. Two halves: turn it on at SendGrid, then save the key.**

1. Log in at **app.sendgrid.com** → left menu **Settings → Mail Settings →
   Event Webhook** (on some accounts it is **Settings → Event Webhook**).
2. Click **Create new webhook**.
3. In **Post URL**, paste exactly:

   ```
   https://<the API address>/webhooks/sendgrid
   ```

   If you are not sure of the API address, ask for it before continuing —
   guessing here silently sends the notifications nowhere.
4. Tick these events, and only these: **Delivered · Opened · Clicked ·
   Bounced · Dropped · Spam Reports · Unsubscribed · Group Unsubscribes**.
5. Turn **Signed Event Webhook** **ON**. This is the important switch — it is
   what makes the notifications provable, and without it the app rejects them.
6. Click **Save**. SendGrid now shows a **Verification Key** — a long line of
   letters and numbers. Copy it whole.
7. Go to **portal.azure.com** → search **clientforce-kv** → **Objects →
   Secrets** → **+ Generate/Import**.
8. Name it EXACTLY `SENDGRID-WEBHOOK-PUBLIC-KEY`, paste the key you copied as
   the value, and click **Create**.
9. Tell whoever is on the build — the app only picks up a new secret on its
   next deploy, so one deploy has to be run before anything changes.

**Paste it exactly as SendGrid gives it to you.** Don't add line breaks, don't
add `-----BEGIN PUBLIC KEY-----`, don't trim anything. The app accepts the
plain form SendGrid shows you as well as the wrapped form, so the shortest path
is a straight copy and paste.

**How you will know it worked.** After the next deploy, bounce and complaint
counts on the sender health view stop being permanently zero and start moving
with real sending. If they stay at zero after a real send campaign, the webhook
is still not landing — say so rather than assuming the numbers are good news.
