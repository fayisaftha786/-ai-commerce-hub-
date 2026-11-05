#!/usr/bin/env bash
set -euo pipefail

CONFIG="wrangler.jsonc"
PORT="${CLIPREWARD_LOCAL_PORT:-18787}"
BASE_URL="http://127.0.0.1:${PORT}"
LOG_FILE="${TMPDIR:-/tmp}/clipreward-wrangler-local.log"
DEV_VARS=".dev.vars"
WRANGLER_PID=""

cleanup() {
  if [ -n "${WRANGLER_PID}" ]; then
    kill "${WRANGLER_PID}" >/dev/null 2>&1 || true
    wait "${WRANGLER_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${DEV_VARS}"
}
trap cleanup EXIT

if [ ! -f "${CONFIG}" ]; then
  echo "Missing ${CONFIG}; run the Cloudflare bundle setup step first." >&2
  exit 1
fi

# This is a disposable key for the local test only. It is never uploaded.
LOCAL_KEY="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"
printf 'SOCIAL_TOKEN_ENCRYPTION_KEY=%s\n' "${LOCAL_KEY}" > "${DEV_VARS}"
chmod 600 "${DEV_VARS}"

npx --yes wrangler@4 d1 migrations apply clipreward-studio --local --config "${CONFIG}"

CI=true npx --yes wrangler@4 dev --local --ip 127.0.0.1 --port "${PORT}" --config "${CONFIG}" > "${LOG_FILE}" 2>&1 &
WRANGLER_PID=$!

ready=false
for attempt in $(seq 1 35); do
  HEALTH_STATUS="$(curl --silent --show-error --output /tmp/clipreward-worker-health.json --write-out '%{http_code}' "${BASE_URL}/health" || true)"
  if [ "${HEALTH_STATUS}" = "200" ]; then
    ready=true
    break
  fi
  if [ "${HEALTH_STATUS}" = "503" ]; then
    echo "Worker initialization returned HTTP 503:" >&2
    cat /tmp/clipreward-worker-health.json >&2
    cat "${LOG_FILE}" >&2
    exit 1
  fi
  if ! kill -0 "${WRANGLER_PID}" >/dev/null 2>&1; then
    cat "${LOG_FILE}" >&2
    echo "Wrangler local Worker exited before becoming healthy." >&2
    exit 1
  fi
  sleep 1
done

if [ "${ready}" != "true" ]; then
  cat "${LOG_FILE}" >&2
  echo "Wrangler local Worker did not become healthy within 35 seconds." >&2
  exit 1
fi

node - <<'NODE'
const fs = require("node:fs");
const health = JSON.parse(fs.readFileSync("/tmp/clipreward-worker-health.json", "utf8"));
if (health.ok !== true || health.service !== "ai-commerce-hub-social-api") {
  throw new Error("Unexpected Cloudflare Worker health payload: " + JSON.stringify(health));
}
NODE

curl --fail --silent --show-error --output /tmp/clipreward-worker-app.html "${BASE_URL}/content-rewards-assistant/"
grep -qi "ClipReward" /tmp/clipreward-worker-app.html
curl --fail --silent "${BASE_URL}/api/social/providers" > /tmp/clipreward-worker-providers.json
curl --fail --silent "${BASE_URL}/api/discovery/status" > /tmp/clipreward-worker-discovery.json
curl --fail --silent "${BASE_URL}/api/discovery/campaigns" > /tmp/clipreward-worker-campaigns.json

node - <<'NODE'
const fs = require("node:fs");
const providers = JSON.parse(fs.readFileSync("/tmp/clipreward-worker-providers.json", "utf8"));
const discovery = JSON.parse(fs.readFileSync("/tmp/clipreward-worker-discovery.json", "utf8"));
const campaigns = JSON.parse(fs.readFileSync("/tmp/clipreward-worker-campaigns.json", "utf8"));
if (!Array.isArray(providers.providers) || providers.providers.length !== 3) {
  throw new Error("Worker social provider endpoint did not return all three provider readiness records.");
}
if (discovery.scheduler !== "disabled" || !Number.isInteger(discovery.campaignCount)) {
  throw new Error("Worker D1 discovery status endpoint returned an unexpected payload.");
}
if (!Array.isArray(campaigns.campaigns) || !Number.isInteger(campaigns.totalSaved)) {
  throw new Error("Worker discovery campaign endpoint returned an unexpected payload.");
}
console.log("Cloudflare local Worker runtime smoke test passed (HTTP, Assets, D1, providers, discovery).");
NODE

MEDIA_TOKEN="$(printf 'a%.0s' {1..64})"
MEDIA_STATUS="$(curl --silent --output /dev/null --write-out '%{http_code}' "${BASE_URL}/media/instagram/${MEDIA_TOKEN}")"
if [ "${MEDIA_STATUS}" != "404" ]; then
  echo "Unexpected R2-backed temporary media status: ${MEDIA_STATUS} (expected 404 for an unknown token)." >&2
  exit 1
fi
