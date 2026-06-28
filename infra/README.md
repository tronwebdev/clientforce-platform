# infra/ — Clientforce IaC (T7)

Bicep + the CD scripts that deploy the workloads onto the existing
team-provisioned platform. **No secret values live here** — every credential is a
Key Vault reference resolved at runtime via a user-assigned managed identity.

## Layout
- `main.bicep` — the app-deploy layer (what CD applies): user-assigned managed
  identity + RBAC (`Key Vault Secrets User`, `AcrPull`), the `api` / `worker` /
  `web` Container Apps with `secretRef`→Key Vault, and the `migrate` Container
  Apps Job. Existing platform resources (Postgres/Redis/Storage/KV/ACR/env) are
  **referenced (`existing`), not created or mutated**.
- `scripts/` — `secret-scan.sh`, `preflight.sh`, `run-migrate-job.sh`, `smoke.sh`
  (used by `.github/workflows/deploy.yml`).

## Deploy
Automatic on merge to `main` via `deploy.yml`:
**secret-scan → OIDC login → preflight → build/push 4 images → `az deployment group create` → migrate Job → smoke.**

Manual (from a machine with `az` + rights):
```bash
az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters location=westus \
    containerAppsEnvName=managedEnvironment-clientforcedev-95a2 \
    keyVaultName=clientforce-kv \
    acrName=clientforcedev acrLoginServer=clientforcedev.azurecr.io \
    imageTag=<sha>
```

## Required config (GitHub → Settings)
- **Secrets:** `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`.
- **Variables:** `AZURE_RESOURCE_GROUP`, `AZURE_LOCATION`, `ACR_NAME`,
  `ACR_LOGIN_SERVER`, `CONTAINER_APPS_ENV`, `KEY_VAULT_NAME`.

## Not yet codified (deliberate)
A full `platform.bicep` declaring the §A resources (for fresh-env standup / DR) is
a follow-up — the dev platform already exists and is referenced here to avoid
mutating it. Temporal mTLS wiring for the worker lands with the workflows (T4+).
See `../T7_VERIFICATION.md`.
