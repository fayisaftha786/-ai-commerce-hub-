#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: $REPO_ROOT/.env is missing. Copy ops/oci/backend.env.example to .env and configure it privately." >&2
  exit 1
fi

ENV_MODE="$(stat -c '%a' .env)"
if [[ ! "$ENV_MODE" =~ ^[0-7]*00$ ]]; then
  echo "ERROR: .env permissions are too open (mode $ENV_MODE). Run chmod 600 .env." >&2
  exit 1
fi

echo "Checking Docker Compose configuration…"
docker compose -f compose.oci.yml config --quiet

echo "Building the backend image for a private environment preflight…"
docker compose -f compose.oci.yml build app

echo "Validating the private environment without printing credential values…"
docker compose -f compose.oci.yml run --rm --no-deps app node scripts/oci-preflight.js

SITE_HOST="$(awk -F= '$1 == "SITE_HOST" { print substr($0, index($0, "=") + 1); exit }' .env)"
if [[ -z "$SITE_HOST" ]]; then
  echo "ERROR: SITE_HOST is missing from .env." >&2
  exit 1
fi

echo "Starting the same-origin HTTPS backend and reverse proxy…"
docker compose -f compose.oci.yml up -d --no-build --remove-orphans

echo "Waiting for the public HTTPS health endpoint…"
if ! curl --fail --silent --show-error --retry 12 --retry-delay 5 --retry-connrefused "https://$SITE_HOST/health" >/dev/null; then
  echo "ERROR: HTTPS health check did not pass. Inspect: docker compose -f compose.oci.yml logs --tail=100 app caddy" >&2
  exit 1
fi

echo "Checking the social-provider readiness endpoint (no secrets are displayed)…"
if ! curl --fail --silent --show-error "https://$SITE_HOST/api/social/providers" >/dev/null; then
  echo "ERROR: The backend is healthy, but the social-provider readiness endpoint failed." >&2
  exit 1
fi

docker compose -f compose.oci.yml ps
echo "DEPLOYMENT HEALTH CHECK: PASS"
echo "OAuth readiness is configuration-only. Connect provider accounts and perform live upload tests in the app."
