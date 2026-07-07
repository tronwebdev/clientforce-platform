#!/usr/bin/env bash
# Smoke test: API health + the deployed web shell logs in against the cloud DB.
set -euo pipefail
: "${RG:?}"

api_fqdn="$(az containerapp show --name clientforce-api --resource-group "$RG" --query "properties.configuration.ingress.fqdn" -o tsv)"
web_fqdn="$(az containerapp show --name clientforce-web --resource-group "$RG" --query "properties.configuration.ingress.fqdn" -o tsv)"
echo "api=$api_fqdn  web=$web_fqdn"

echo "1) API health"
code="$(curl -sS -o /dev/null -w '%{http_code}' --retry 12 --retry-all-errors --retry-delay 6 "https://$api_fqdn/healthz")"
[ "$code" = "200" ] || { echo "::error::api /healthz -> $code"; exit 1; }

echo "2) Web shell dev sign-in -> authenticated dashboard against the cloud DB"
cookies="$(mktemp)"
# Give the web revision a moment to be ready.
curl -fsS --retry 12 --retry-all-errors --retry-delay 6 -o /dev/null "https://$web_fqdn/login"

# Dev sign-in sets the session cookie on its 3xx response. Do NOT follow the
# redirect (-L): the app builds an absolute Location from its internal bind
# address (http://0.0.0.0:3000/), which is unreachable from here. We only need
# the Set-Cookie, then we hit the public host directly over 443 with the cookie.
login_code="$(curl -sS -c "$cookies" -o /dev/null -w '%{http_code}' \
  --data-urlencode "email=owner@demo-agency.test" \
  "https://$web_fqdn/api/auth/dev-login")"
case "$login_code" in
  2??|3??) ;;
  *) echo "::error::dev-login https://$web_fqdn/api/auth/dev-login -> $login_code (expected 2xx/3xx)"; exit 1;;
esac

# C2.1 landed the shell on /agents (handoff §C): `/` now 307s there BY DESIGN,
# which made this assertion stale — every deploy since PR #33 failed here while
# the deployment itself succeeded (masking the real Redis outage found
# 2026-07-07). Assert the designed landing page instead.
home_code="$(curl -sS -b "$cookies" -o /tmp/home.html -w '%{http_code}' "https://$web_fqdn/agents")"
[ "$home_code" = "200" ] || { echo "::error::authenticated GET https://$web_fqdn/agents -> $home_code (expected 200; shell likely bounced to /login)"; exit 1; }
grep -qi "Add agent" /tmp/home.html || { echo "::error::shell did not render the authenticated Agents screen"; exit 1; }

echo "Smoke passed — deployed shell logged in against the cloud DB."
