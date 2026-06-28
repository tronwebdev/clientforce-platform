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

echo "2) Web shell dev sign-in -> /me against the cloud DB"
cookies="$(mktemp)"
# Give the web/api revisions a moment to be ready.
curl -sS --retry 12 --retry-all-errors --retry-delay 6 -o /dev/null "https://$web_fqdn/login"
curl -sS -c "$cookies" -L --data-urlencode "email=owner@demo-agency.test" \
  "https://$web_fqdn/api/auth/dev-login" -o /dev/null
home_code="$(curl -sS -b "$cookies" -o /tmp/home.html -w '%{http_code}' "https://$web_fqdn/")"
[ "$home_code" = "200" ] || { echo "::error::authenticated GET / -> $home_code (expected 200; shell likely bounced to /login)"; exit 1; }
grep -qi "Welcome back" /tmp/home.html || { echo "::error::shell did not render the authenticated dashboard"; exit 1; }

echo "Smoke passed — deployed shell logged in against the cloud DB."
