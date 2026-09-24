#!/usr/bin/env bash
# ── Streambert Android pre-APK test suite (Termux/Linux) ────────────────────
# Runs every testable pre-APK verification and prints a PASS/FAIL matrix.
# Usage:  bash tests/run_all.sh [--fast]   (--fast skips vite build + expo export)
set -uo pipefail
cd "$(dirname "$0")/.."
FAST="${1:-}"
RESULTS=()
ANY_FAIL=0

run() {
  local name="$1"; shift
  local out rc
  out=$("$@" 2>&1); rc=$?
  local status="PASS"; [ $rc -ne 0 ] && { status="FAIL"; ANY_FAIL=1; }
  RESULTS+=("$(printf '%-28s %s' "$name" "$status")")
  echo "$out" | grep -E "^\[|FAIL " | sed "s/^/  /" | tail -4
}

echo "════ Streambert Android pre-APK test suite ════"

run "JS unit (real modules)"        node tests/test_js_unit.mjs
run "Bridge contract"               node tests/test_bridge_contract.mjs
run "Java proxy E2E (javac+JVM)"    bash tests/test_proxy_java.sh
run "API live (network)"            node tests/test_api_live.mjs
run "Expo config parity"            node tests/test_expo_config.mjs
run "Frontend dist"                 bash tests/test_frontend_dist.sh ${FAST:+$FAST}
run "UI + TV mode (static/module/jsdom)" node tests/test_ui_tv.mjs
if ! node -e "require.resolve('jsdom')" 2>/dev/null; then
  echo "  [SKIP] frontendRender: jsdom not installed (run: npm install)"
  RESULTS+=("$(printf '%-28s %s' "Frontend render (jsdom)" "SKIP")")
else
  run "Frontend render no-key"      env SCENARIO=no-key node tests/test_frontend_render.mjs
  run "Frontend render invalid-key" env SCENARIO=invalid-key node tests/test_frontend_render.mjs
fi

if [ "$FAST" != "--fast" ]; then
  echo "  [expo export] bundling JS app with Metro (catches missing metro deps)..."
  out=$(cd expo-app && npx expo export --platform android --output-dir /tmp/streambert-export-check 2>&1); rc=$?
  if [ $rc -eq 0 ] && echo "$out" | grep -q "Bundled"; then
    RESULTS+=("$(printf '%-28s %s' "Expo export (Metro bundle)" "PASS")")
  else
    RESULTS+=("$(printf '%-28s %s' "Expo export (Metro bundle)" "FAIL")"); ANY_FAIL=1
    echo "$out" | grep -iE "error|unable" | head -5 | sed 's/^/  /'
  fi
  rm -rf /tmp/streambert-export-check
fi

echo ""
echo "════ MATRIX ════"
for r in "${RESULTS[@]}"; do echo "$r"; done
echo ""
[ $ANY_FAIL -eq 0 ] && echo "SUITE RESULT: ALL PASS" || echo "SUITE RESULT: FAILURES PRESENT"
exit $ANY_FAIL
