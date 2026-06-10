#!/usr/bin/env bash
# ─── E2E smoke suite ─────────────────────────────────────────────────────────
#
# A handful of curl checks against a locally running gateway: health, the
# autoreg → /users/me happy path, and a couple of negative cases. Extend it as
# you add endpoints.
#
# Usage:
#   bash tools/e2e-smoke.sh [BASE_URL]   # default http://localhost:3000
#
# Prerequisites:
#   1. docker compose up -d mongodb redis rabbitmq
#   2. pnpm start:dev:gateway &   pnpm start:dev:user &
#   3. Wait for health: curl http://localhost:3000/health
set -uo pipefail

BASE="${1:-http://localhost:3000}"
DEVICE_ID="smoke-$(date +%s)"
FINGERPRINT="$(printf 'smoke-fp-%s' "$(date +%s)" | sha256sum | cut -d' ' -f1)"
pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $name ($actual)"
    pass=$((pass + 1))
  else
    echo "  ✗ $name — expected $expected, got $actual"
    fail=$((fail + 1))
  fi
}

status() { # METHOD PATH [BODY] [EXTRA_HEADER...]
  local method="$1" path="$2" body="${3:-}"
  shift 3 2>/dev/null || shift $#
  local args=(-s -o /dev/null -w '%{http_code}' -X "$method" "$BASE$path")
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' -d "$body")
  for h in "$@"; do args+=(-H "$h"); done
  curl "${args[@]}"
}

echo "Smoke against $BASE"

echo "[health]"
check "GET /health/live" 200 "$(status GET /health/live)"

echo "[auth]"
AUTOREG_BODY="{\"deviceFingerprint\":\"$FINGERPRINT\"}"
check "POST /v1/auth/autoreg" 201 \
  "$(status POST /v1/auth/autoreg "$AUTOREG_BODY" "x-device-id: $DEVICE_ID")"
check "POST /v1/auth/autoreg without device id → 400" 400 \
  "$(status POST /v1/auth/autoreg "$AUTOREG_BODY")"

# Capture a token for the authenticated checks (fresh fingerprint).
RESP=$(curl -s -X POST "$BASE/v1/auth/autoreg" \
  -H 'Content-Type: application/json' -H "x-device-id: $DEVICE_ID" \
  -d "{\"deviceFingerprint\":\"${FINGERPRINT}b\"}")
ACCESS=$(printf '%s' "$RESP" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')

echo "[users]"
check "GET /v1/users/me (no token) → 401" 401 "$(status GET /v1/users/me)"
if [[ -n "$ACCESS" ]]; then
  check "GET /v1/users/me (with token) → 200" 200 \
    "$(status GET /v1/users/me '' "Authorization: Bearer $ACCESS")"
else
  echo "  ! could not parse access token — skipping authed /users/me"
fi

echo
echo "Passed: $pass  Failed: $fail"
[[ $fail -eq 0 ]]
