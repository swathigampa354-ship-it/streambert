#!/usr/bin/env bash
# Compiles the REAL AndroidProxyServer.java (+ Log stub + harness) and runs
# integration assertions against a local fixture upstream.
# Usage: bash tests/test_proxy_java.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BUILD=build/proxy-test
rm -rf "$BUILD"; mkdir -p "$BUILD/classes" "$BUILD/logs"

SRC=expo-app/modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/AndroidProxyServer.java
[ -f "$SRC" ] && cp "$SRC" "$BUILD/AndroidProxyServer.java"

echo "[1/4] compiling proxy sources (javac)..."
javac -d "$BUILD/classes" tests/java/android/util/Log.java "$BUILD/AndroidProxyServer.java" tests/java/ProxyHarness.java 2>&1 | tee "$BUILD/logs/javac.log" || { echo "PROXY_COMPILE_FAIL"; exit 1; }

echo "[2/4] starting fixture upstream..."
node tests/fixtures/upstream.mjs > "$BUILD/logs/upstream.log" 2>&1 &
UP_PID=$!
trap 'kill $UP_PID $PX_PID 2>/dev/null || true' EXIT
for i in $(seq 1 50); do grep -q PORT= "$BUILD/logs/upstream.log" 2>/dev/null && break; sleep 0.1; done
UP_PORT=$(grep -oP 'PORT=\K\d+' "$BUILD/logs/upstream.log")
[ -n "$UP_PORT" ] || { echo "UPSTREAM_START_FAIL"; exit 1; }

echo "[3/4] starting real AndroidProxyServer (JVM) target=master.m3u8 headers=Referer+UA+Cookie..."
java -cp "$BUILD/classes" ProxyHarness \
  "http://127.0.0.1:$UP_PORT/master.m3u8" \
  "https://provider.example/embed/1" \
  "StreambertTestUA/1.0" \
  "cf_clearance=xyz" > "$BUILD/logs/proxy.log" 2>&1 &
PX_PID=$!
for i in $(seq 1 50); do grep -q PORT= "$BUILD/logs/proxy.log" 2>/dev/null && break; sleep 0.1; done
PX_PORT=$(grep -oP 'PORT=\K\d+' "$BUILD/logs/proxy.log" | head -1)
[ -n "$PX_PORT" ] || { echo "PROXY_START_FAIL"; cat "$BUILD/logs/proxy.log"; exit 1; }
echo "    upstream=$UP_PORT proxy=$PX_PORT"

echo "[4/4] running assertions..."
python3 tests/test_proxy_java.py "$UP_PORT" "$PX_PORT"
