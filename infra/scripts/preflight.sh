#!/usr/bin/env bash
# Preflight gate: confirm the environment is provisioned + the secrets the apps
# consume exist in Key Vault, before building/deploying (T7_VERIFICATION.md §2).
set -euo pipefail
: "${KEY_VAULT_NAME:?}" "${ACR_NAME:?}" "${RG:?}" "${CONTAINER_APPS_ENV:?}"

echo "Verifying ACR '$ACR_NAME' ..."
az acr show --name "$ACR_NAME" -o none

echo "Verifying Container Apps environment '$CONTAINER_APPS_ENV' ..."
az containerapp env show --name "$CONTAINER_APPS_ENV" --resource-group "$RG" -o none

echo "Verifying Key Vault secrets consumed by the deploy ..."
# Only the secrets the apps actually secretRef (main.bicep). Temporal/Clerk
# secrets are provisioned for later phases and aren't required by T7.
required=(DATABASE-URL APP-DATABASE-URL REDIS-URL AUTH-DEV-SECRET OPENAI-API-KEY ANTHROPIC-API-KEY SENDGRID-API-KEY FIELD-ENCRYPTION-KEY)
present="$(az keyvault secret list --vault-name "$KEY_VAULT_NAME" --query "[].name" -o tsv)"

missing=0
for name in "${required[@]}"; do
  if ! grep -qxF "$name" <<<"$present"; then
    echo "::error::Key Vault secret missing: $name"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo "Preflight FAILED — populate the missing Key Vault secrets."
  exit 1
fi

# P1.2: STORAGE-CONNECTION-STRING is OPTIONAL until the owner adds it (PR #25
# step) — the Bicep wiring is conditional, so its absence only disables
# DOCUMENT uploads, never the deploy.
if ! grep -qxF "STORAGE-CONNECTION-STRING" <<<"$present"; then
  echo "::warning::Key Vault secret STORAGE-CONNECTION-STRING not present — DOCUMENT uploads stay disabled this deploy (WEBSITE/TEXT sources unaffected)."
fi

# P1.6/P1.7: the Temporal trio + the inbound-parse token are OPTIONAL the same
# way (conditional Bicep wiring) — warn so a half-configured vault is visible.
for name in TEMPORAL-ADDRESS TEMPORAL-NAMESPACE TEMPORAL-API-KEY INBOUND-PARSE-TOKEN SENDGRID-WEBHOOK-PUBLIC-KEY; do
  if ! grep -qxF "$name" <<<"$present"; then
    echo "::warning::Key Vault secret $name not present — the feature it gates stays disabled this deploy (OWNER_CHECKLIST §4 / P1.7 owner steps)."
  fi
done

# Verify the DEPLOY identity itself can do everything the pipeline needs, before
# anything destructive runs. This is the read-only "is all access in?" gate:
# push to ACR, create the Container Apps/identity/job, and (the non-obvious one)
# create the app identity's role assignments in main.bicep. We assert effective
# roles at each scope (--include-inherited covers RG/subscription inheritance, so
# an Owner grant higher up satisfies everything).
echo "Verifying deploy identity RBAC ..."
caller="$(az account show --query user.name -o tsv)"      # appId for an SP login
sub="$(az account show --query id -o tsv)"
rg_id="/subscriptions/$sub/resourceGroups/$RG"
acr_id="$(az acr show --name "$ACR_NAME" --query id -o tsv)"

rg_roles="$(az role assignment list --assignee "$caller" --scope "$rg_id" --include-inherited --query "[].roleDefinitionName" -o tsv)"
acr_roles="$(az role assignment list --assignee "$caller" --scope "$acr_id" --include-inherited --query "[].roleDefinitionName" -o tsv)"
echo "  RG '$RG' roles:  $(echo "$rg_roles" | paste -sd, - )"
echo "  ACR '$ACR_NAME' roles: $(echo "$acr_roles" | paste -sd, - )"

rbac_ok=1
has() { grep -qxF "$1" <<<"$2"; }

# Push the 4 images.
if ! { has Owner "$acr_roles" || has AcrPush "$acr_roles"; }; then
  echo "::error::deploy identity needs 'AcrPush' (or 'Owner') on ACR '$ACR_NAME' to push images"
  rbac_ok=0
fi
# Create/update the Container Apps, user-assigned identity, and migrate job.
if ! { has Owner "$rg_roles" || has Contributor "$rg_roles"; }; then
  echo "::error::deploy identity needs 'Contributor' (or 'Owner') on resource group '$RG'"
  rbac_ok=0
fi
# Create the app identity's role assignments (kvRole + acrRole in main.bicep).
if ! { has Owner "$rg_roles" || has "User Access Administrator" "$rg_roles"; }; then
  echo "::error::deploy identity needs 'User Access Administrator' (or 'Owner') on '$RG' so main.bicep can create the app identity's role assignments"
  rbac_ok=0
fi

if [ "$rbac_ok" -ne 1 ]; then
  echo "Preflight FAILED — deploy identity is missing required RBAC (see errors above)."
  exit 1
fi
echo "Preflight passed — environment, required secrets, and deploy RBAC all present."
