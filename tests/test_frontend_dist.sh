#!/usr/bin/env bash
# Validates the Vite-built frontend that will be packaged into the APK.
# Usage: bash tests/test_frontend_dist.sh [--skip-build]
set -euo pipefail
cd "$(dirname "$0")/.."
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; }

if [ "${1:-}" != "--skip-build" ]; then
  echo "[build] npx vite build"
  npx vite build >/tmp/vite-build.log 2>&1 || { echo "FAIL vite build"; tail -20 /tmp/vite-build.log; exit 1; }
  ok
fi

D=dist
[ -f "$D/index.html" ] && ok || bad "dist/index.html missing"

# base must be relative ("./") for file:// loading inside the WebView
if grep -q 'src="./assets/' "$D/index.html" || grep -q 'href="./assets/' "$D/index.html"; then ok
else bad "index.html uses non-relative asset URLs (would break file:// loading)"; fi

# every referenced local asset must exist on disk
MISSING=0
for ref in $(grep -oE '(src|href)="\./[^"]+"' "$D/index.html" | sed -E 's/(src|href)="\.\///; s/"$//'); do
  [ -f "$D/$ref" ] || { bad "referenced asset missing: $ref"; MISSING=1; }
done
[ $MISSING -eq 0 ] && ok

# hashed chunks referenced INSIDE the JS/CSS must also exist (they import each other)
JSASSETS=$(grep -rhoE '"[A-Za-z0-9_.-]+\.(js|css|woff2)"' $D/assets/*.js $D/assets/*.css 2>/dev/null | tr -d '"' | sort -u || true)
for a in $JSASSETS; do
  if ! ls $D/assets/$a >/dev/null 2>&1; then
    # many matches are dynamic-import names without hash prefix matching; check contains-hash file exists
    if ! ls $D/assets/ | grep -q -- "${a%%.*}"; then bad "chunk referenced but missing in dist/assets: $a"; fi
  fi
done
ok

# fonts packaged. NOTE: upstream Streambert ships dm-sans-300/regular/500/600
# as BYTE-IDENTICAL files (md5-verified) - vite correctly dedupes them to one
# asset. 2 unique fonts emitted is CORRECT. Upstream cosmetic issue (DM Sans
# renders weight 300, browser synthesizes heavier weights) - documented, not
# modified (do-not-rewrite-unrelated-functionality constraint).
FCOUNT=$(ls $D/assets/*.woff2 2>/dev/null | wc -l)
[ "$FCOUNT" -ge 2 ] && ok || bad "expected >=2 unique woff2 fonts (bebas + dm-sans dedup), found $FCOUNT"
DUPES=$(md5sum src/styles/fonts/*.woff2 2>/dev/null | awk '{print $1}' | sort | uniq -d | wc -l)
[ "$DUPES" -gt 0 ] && echo "  NOTE upstream issue: duplicate font files in src/styles/fonts (cosmetic, documented)" || true

# no remote app dependency anywhere in the packaged frontend
if grep -rqi "streambert.vercel.app\|vercel.app" $D/ 2>/dev/null; then bad "dist references vercel.app (production must be self-contained)"; else ok; fi
# no localhost dev URLs baked in
if grep -rqi "localhost:5173\|127.0.0.1:5173" $D/ 2>/dev/null; then bad "dist references vite dev server"; else ok; fi

# TMDB API key must NOT be bundled (BYOK at runtime)
if grep -rqE "eyJhbGciOiJIUzI1NiJ9\.[A-Za-z0-9_-]{20,}" $D/ 2>/dev/null; then bad "TMDB JWT-looking token bundled in dist"; else ok; fi

# React root present
grep -q 'id="root"' "$D/index.html" && ok || bad "index.html missing #root mount point"

# report
FILES=$(find $D -type f | wc -l); SIZE=$(du -sh $D | cut -f1)
echo "  dist: $FILES files, $SIZE"
echo "[$( [ $FAIL -eq 0 ] && echo PASS || echo FAIL )] frontendDist: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]
