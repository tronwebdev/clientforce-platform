# T7 — Infra & Deploy Verification

This is how T7 proves the cloud environment is correctly provisioned and that the
deploy is reproducible + secret-clean. **Part 1** is the one-time provisioning
record; **Part 2** is the automated preflight gate the CD pipeline runs on every
deploy.

The deploy itself runs in **GitHub Actions** (`.github/workflows/deploy.yml`),
which authenticates to Azure via **OIDC** — there are no Azure credentials, and no
secret values, anywhere in this repo.

---

## Part 1 — Provisioning record (`clientforce-dev`, westus)

Confirmed by the platform team and corroborated by DNS existence checks:

| Resource | Name |
|---|---|
| Resource group | `clientforce-dev` |
| Postgres Flexible Server | `clientforce-dev-db` — `pgvector` allow-listed; admin `clientforcedev` |
| — RLS role | `clientforce_app` = **non-superuser, no BYPASSRLS** (`rolsuper=f`, `rolbypassrls=f`) |
| Redis | `clientforce-redis` |
| Storage | `clientforcedevstorage` |
| Key Vault | `clientforce-kv` (RBAC authorization mode) |
| Container Registry | `clientforcedev.azurecr.io` |
| Container Apps env | `managedEnvironment-clientforcedev-95a2` |

**Key Vault secrets** hold every connection string / key. The deploy *consumes*
`DATABASE-URL`, `APP-DATABASE-URL`, `REDIS-URL`, `AUTH-DEV-SECRET`; the
Temporal/Clerk secrets are provisioned for later phases.

---

## Part 2 — Preflight CI gate (runs before every deploy)

Two gates, both in `deploy.yml`, implemented by `infra/scripts/`:

### 2a. Repo secret scan — `secret-scan.sh`
`git grep` over tracked files for connection-strings-with-credentials, Azure
`AccountKey=`, PEM private keys, and common provider key prefixes (Stripe/Clerk,
SendGrid, AWS, Slack). **Fails the build if any match** (allow-list: lockfile,
`*.md`, `*.env.example`). This is the "zero secrets in repo" acceptance check.

### 2b. Environment + secret presence — `preflight.sh`
After OIDC login: asserts the ACR and Container Apps environment exist, and that
the **Key Vault secrets the apps secretRef** are present (`DATABASE-URL`,
`APP-DATABASE-URL`, `REDIS-URL`, `AUTH-DEV-SECRET`). Fails fast with the exact
missing name, so a misnamed/absent secret never reaches a half-deploy.

---

## How the acceptance criteria are met

| Criterion (#8) | Mechanism |
|---|---|
| Merge to `main` deploys to staging automatically | `deploy.yml` on `push: [main]` |
| Deployed web shell logs in against the cloud DB; migrations applied | migrate Job (`prisma migrate deploy` + seed) → `smoke.sh` does dev sign-in → `/me` → 200 dashboard |
| Secrets resolved from Key Vault (none in repo) | Container Apps `secretRef` → Key Vault via the user-assigned managed identity (`main.bicep`); `secret-scan.sh` gate |

---

## Prerequisites the team owns (outside this repo)

- **GitHub Actions secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (federated/OIDC credential for `repo:tronwebdev/clientforce-platform` on `main` + `environment:staging`).
- **GitHub Actions variables:** `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `ACR_NAME`, `ACR_LOGIN_SERVER`, `CONTAINER_APPS_ENV`, `KEY_VAULT_NAME`.
- **RBAC for the deploy identity:** `AcrPush`, Container Apps deploy on the RG, and `User Access Administrator` (so `main.bicep` can create the app identity's role assignments) — or pre-create those role assignments.
- **Key Vault** in RBAC authorization mode; secret **`AUTH-DEV-SECRET`** present (the dev env runs the dev verifier so the existing sign-in flow works; Clerk secrets remain the production toggle).
