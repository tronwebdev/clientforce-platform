#!/usr/bin/env bash
# Start the Container Apps migration job and wait for it to finish.
set -euo pipefail
JOB="${1:?usage: run-migrate-job.sh <job-name>}"
: "${RG:?}"

echo "Starting migration job '$JOB' ..."
exec_name="$(az containerapp job start --name "$JOB" --resource-group "$RG" --query name -o tsv)"
echo "Execution: $exec_name"

for i in $(seq 1 90); do
  status="$(az containerapp job execution show \
    --name "$JOB" --resource-group "$RG" --job-execution-name "$exec_name" \
    --query "properties.status" -o tsv 2>/dev/null || echo "Unknown")"
  echo "  [$i] status=$status"
  case "$status" in
    Succeeded) echo "Migration job succeeded."; exit 0 ;;
    Failed | Degraded) echo "::error::Migration job $status"; exit 1 ;;
  esac
  sleep 10
done

echo "::error::Migration job did not reach a terminal state in time"
exit 1
