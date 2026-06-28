#!/usr/bin/env bash
# Preflight gate: fail if any hardcoded secret / connection-string appears in
# tracked files. Secrets must live in Key Vault, never the repo (T7 acceptance).
set -euo pipefail

# High-signal patterns (low false-positive on a TS/infra repo).
patterns=(
  '(postgres(ql)?|rediss?|mongodb(\+srv)?|amqps?)://[A-Za-z0-9._%-]+:[^@/[:space:]]+@' # creds in a URL
  'AccountKey=[A-Za-z0-9+/=]{20,}'        # Azure Storage key
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'   # PEM private key
  'sk_live_[A-Za-z0-9]+'                  # Stripe / Clerk live secret
  'SG\.[A-Za-z0-9_-]{16,}'               # SendGrid
  'AKIA[0-9A-Z]{16}'                      # AWS access key id
  'xox[baprs]-[A-Za-z0-9-]+'             # Slack token
)
# Allowed to contain example/placeholder strings.
exclude=(':!pnpm-lock.yaml' ':!**/*.md' ':!**/.env.example' ':!infra/scripts/secret-scan.sh')

found=0
for p in "${patterns[@]}"; do
  # `-e` so patterns beginning with '-' (e.g. PEM headers) aren't read as flags.
  if git grep -nIE -e "$p" -- "${exclude[@]}"; then
    echo "::error::secret-like pattern matched: $p"
    found=1
  fi
done

if [ "$found" -ne 0 ]; then
  echo "Repo secret scan FAILED — move secrets to Key Vault."
  exit 1
fi
echo "Repo secret scan passed — no hardcoded secrets."
