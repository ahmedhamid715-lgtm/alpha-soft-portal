#!/usr/bin/env bash
# Independent, re-runnable verification of Module 04's core security claims
# against the ACTUAL running app and database — not a report to trust, a
# script to read and run yourself. Every check below does a real HTTP
# request against a real server and/or a real write to Postgres; nothing
# here is mocked or simulated.
#
# Usage:
#   DATABASE_URL="postgresql://ahmed@localhost:5432/alpha_os_dev" \
#   BASE_URL="http://localhost:3000" \
#   ./scripts/verify-auth-security.sh
#
# Requires: the app already running (npm run build && npm run start),
# curl, psql, python3. Exits non-zero if any check fails.

set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
DATABASE_URL="${DATABASE_URL:-postgresql://ahmed@localhost:5432/alpha_os_dev}"
EMAIL="${TEST_EMAIL:-customer@alpha-os.test}"
PASSWORD="${TEST_PASSWORD:-alpha-os-dev-password}"
PROTECTED_PATH="/dashboard"

PASS=0
FAIL=0
JAR="$(mktemp)"

pass() { echo "  PASS — $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL — $1"; FAIL=$((FAIL+1)); }
section() { echo; echo "== $1 =="; }

cleanup() { rm -f "$JAR" "$JAR.2" "$JAR.3"; }
trap cleanup EXIT

# --- sanity ------------------------------------------------------------
section "Server reachability"
if ! curl -sf "$BASE_URL/api/health" >/dev/null; then
  echo "Server not reachable at $BASE_URL — start it first (npm run build && npm run start)."
  exit 2
fi
pass "server reachable at $BASE_URL"

if ! psql "$DATABASE_URL" -c "SELECT 1;" >/dev/null 2>&1; then
  echo "Cannot reach Postgres at $DATABASE_URL — this script needs direct DB access to simulate revocation/expiry."
  exit 2
fi
pass "database reachable"

# --- real login, capture a real cookie ---------------------------------
section "Real login flow"
CSRF=$(curl -s -c "$JAR" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
LOGIN_HEADERS=$(curl -s -D - -o /dev/null -c "$JAR" -b "$JAR" -X POST "$BASE_URL/api/auth/callback/credentials" \
  -d "email=$EMAIL" -d "password=$PASSWORD" -d "csrfToken=$CSRF" -d "json=true" | tr -d '\r')

# Judged by outcome, not by guessing Auth.js's exact redirect target: a
# failed credentials attempt redirects to /login?error=..., a successful
# one does not carry an ?error= param and does set the session cookie.
if echo "$LOGIN_HEADERS" | grep -qi "^location:.*error=" ; then
  fail "login did not succeed — check TEST_EMAIL/TEST_PASSWORD match a real seeded account (default: prisma/seed.ts)"
elif echo "$LOGIN_HEADERS" | grep -qi "^set-cookie:.*authjs.session-token="; then
  pass "login succeeded for $EMAIL"
else
  fail "login outcome unclear — no error redirect and no session cookie set; inspect \$LOGIN_HEADERS manually"
fi

COOKIE_LINE=$(echo "$LOGIN_HEADERS" | grep -i "^set-cookie: authjs.session-token=")
JWT=$(echo "$COOKIE_LINE" | sed -n 's/^[Ss]et-[Cc]ookie: authjs.session-token=\([^;]*\);.*/\1/p')

# Cookie flags
if echo "$COOKIE_LINE" | grep -qi "httponly"; then pass "session cookie is HttpOnly"; else fail "session cookie is NOT HttpOnly"; fi
if echo "$COOKIE_LINE" | grep -qi "samesite=lax"; then pass "session cookie is SameSite=Lax"; else fail "session cookie SameSite flag unexpected"; fi
if [[ "$BASE_URL" == https://* ]]; then
  if echo "$COOKIE_LINE" | grep -qi "secure"; then pass "session cookie is Secure (HTTPS deployment)"; else fail "HTTPS deployment but cookie is NOT Secure"; fi
else
  echo "  INFO — Secure flag not expected over plain HTTP ($BASE_URL); re-run this script against your real HTTPS deployment before trusting that flag."
fi

# JWT is a JWE (encrypted), not a bare signed JWT
JWE_HEADER=$(echo "$JWT" | cut -d. -f1 | base64 -d 2>/dev/null)
if echo "$JWE_HEADER" | grep -q '"enc"'; then
  pass "session token is a JWE (encrypted, not just signed) — header: $JWE_HEADER"
else
  fail "session token does not look like a JWE — got header: $JWE_HEADER"
fi

# --- valid session actually works ---------------------------------------
section "Valid session grants access"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" "$BASE_URL$PROTECTED_PATH")
[[ "$CODE" == "200" ]] && pass "valid session -> $PROTECTED_PATH returns 200" || fail "valid session -> $PROTECTED_PATH returned $CODE, expected 200"

# --- no session denied ---------------------------------------------------
section "No session is denied"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$PROTECTED_PATH")
[[ "$CODE" == "307" || "$CODE" == "302" ]] && pass "no cookie -> $PROTECTED_PATH redirected ($CODE)" || fail "no cookie -> $PROTECTED_PATH returned $CODE, expected a redirect"

# --- tampered JWT denied --------------------------------------------------
section "Tampered session token is denied"
TAMPERED=$(python3 -c "
s = '''$JWT'''
i = len(s) - 8
print(s[:i] + ('X' if s[i] != 'X' else 'Y') + s[i+1:])
")
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: authjs.session-token=$TAMPERED" "$BASE_URL$PROTECTED_PATH")
[[ "$CODE" == "307" || "$CODE" == "302" ]] && pass "tampered token -> $PROTECTED_PATH redirected ($CODE)" || fail "tampered token -> $PROTECTED_PATH returned $CODE, expected a redirect (JWE decryption should reject this)"

# --- garbage cookie denied -------------------------------------------------
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Cookie: authjs.session-token=not-a-real-token" "$BASE_URL$PROTECTED_PATH")
[[ "$CODE" == "307" || "$CODE" == "302" ]] && pass "garbage token -> $PROTECTED_PATH redirected ($CODE)" || fail "garbage token -> $PROTECTED_PATH returned $CODE, expected a redirect"

# --- revoked session denied (the proxy.ts-is-not-the-boundary proof) -----
section "DB-revoked session is denied (proves proxy.ts is not the security boundary)"
psql "$DATABASE_URL" -q -c "
  UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'verify-script'
  WHERE id = (SELECT id FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = '$EMAIL') ORDER BY created_at DESC LIMIT 1);
" >/dev/null
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR" "$BASE_URL$PROTECTED_PATH")
[[ "$CODE" == "307" || "$CODE" == "302" ]] && pass "still-cryptographically-valid but DB-revoked cookie -> $PROTECTED_PATH redirected ($CODE)" || fail "revoked session still granted access ($CODE) — CRITICAL if this fails"

# --- fresh login, then force expiry directly in Postgres (timezone-bug regression) ---
section "DB-expired session is denied (regression check for the timezone read bug)"
CSRF2=$(curl -s -c "$JAR.2" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
curl -s -o /dev/null -c "$JAR.2" -b "$JAR.2" -X POST "$BASE_URL/api/auth/callback/credentials" \
  -d "email=$EMAIL" -d "password=$PASSWORD" -d "csrfToken=$CSRF2" -d "json=true"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR.2" "$BASE_URL$PROTECTED_PATH")
if [[ "$CODE" != "200" ]]; then
  fail "fresh login did not grant access ($CODE) — cannot run the expiry check"
else
  psql "$DATABASE_URL" -q -c "
    UPDATE user_sessions SET expires_at = now() - interval '1 minute'
    WHERE id = (SELECT id FROM user_sessions WHERE user_id = (SELECT id FROM users WHERE email = '$EMAIL') ORDER BY created_at DESC LIMIT 1);
  " >/dev/null
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR.2" "$BASE_URL$PROTECTED_PATH")
  [[ "$CODE" == "307" || "$CODE" == "302" ]] && pass "expires_at forced into the past -> $PROTECTED_PATH redirected ($CODE)" || fail "expired session still granted access ($CODE) — this is exactly the timezone bug this audit found; if it fails, the fix in src/lib/db/client.ts regressed"
fi

# --- forged role via session-update endpoint ------------------------------
section "Role/identity forgery via /api/auth/session is rejected"
CSRF3=$(curl -s -c "$JAR.3" "$BASE_URL/api/auth/csrf" | python3 -c "import sys,json;print(json.load(sys.stdin)['csrfToken'])")
curl -s -o /dev/null -c "$JAR.3" -b "$JAR.3" -X POST "$BASE_URL/api/auth/callback/credentials" \
  -d "email=$EMAIL" -d "password=$PASSWORD" -d "csrfToken=$CSRF3" -d "json=true"
FORGE_CODE=$(curl -s -o /dev/null -w "%{http_code}" -b "$JAR.3" -X POST "$BASE_URL/api/auth/session" \
  -H "Content-Type: application/json" \
  -d '{"user":{"id":"11111111-1111-7111-8111-111111111111","role":"admin"},"sessionId":"22222222-2222-7222-8222-222222222222"}')
[[ "$FORGE_CODE" == "400" ]] && pass "forged session-update payload rejected (400)" || fail "forged session-update payload got $FORGE_CODE, expected 400"

REAL_ID=$(curl -s -b "$JAR.3" "$BASE_URL/api/auth/session" | python3 -c "import sys,json;print(json.load(sys.stdin).get('user',{}).get('id','MISSING'))")
if [[ "$REAL_ID" != "11111111-1111-7111-8111-111111111111" && "$REAL_ID" != "MISSING" ]]; then
  pass "session still resolves the real account, not the forged id ($REAL_ID)"
else
  fail "session resolved unexpected identity: $REAL_ID"
fi

# --- enumeration protection ------------------------------------------------
section "Enumeration protection on /login"
NONEXISTENT_BODY=$(curl -s -X POST "$BASE_URL/api/auth/callback/credentials" \
  -d "email=nonexistent-$$-$(date +%s)@alpha-os.test" -d "password=whatever" -d "csrfToken=$CSRF" -d "json=true")
WRONGPW_BODY=$(curl -s -X POST "$BASE_URL/api/auth/callback/credentials" \
  -d "email=$EMAIL" -d "password=definitely-wrong" -d "csrfToken=$CSRF" -d "json=true")
if [[ "$NONEXISTENT_BODY" == "$WRONGPW_BODY" ]]; then
  pass "nonexistent account and wrong password produce identical API responses"
else
  fail "responses differ between nonexistent account and wrong password — possible enumeration vector"
fi

# --- summary -----------------------------------------------------------
section "Summary"
echo "  $PASS passed, $FAIL failed"
if [[ "$FAIL" -gt 0 ]]; then
  echo
  echo "One or more checks FAILED. Do not treat Module 04 as verified until every check above passes."
  exit 1
else
  echo
  echo "All checks passed against the live app and database."
fi
