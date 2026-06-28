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
required=(DATABASE-URL APP-DATABASE-URL REDIS-URL AUTH-DEV-SECRET)
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
echo "Preflight passed — environment + required secrets present."
