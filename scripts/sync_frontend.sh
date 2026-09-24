#!/usr/bin/env bash
# Syncs the Vite-built Streambert frontend into expo-app/assets/dist so the
# Android app can package it (plugins/with-dist-assets.js -> APK assets).
# Usage: bash scripts/sync_frontend.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/dist"
DEST="$ROOT/expo-app/assets/dist"

if [ ! -f "$SRC/index.html" ]; then
  echo "[sync_frontend] $SRC/index.html missing - building frontend first..."
  (cd "$ROOT" && npx vite build)
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/." "$DEST/"

COUNT=$(find "$DEST" -type f | wc -l)
SIZE=$(du -sh "$DEST" | cut -f1)
echo "[sync_frontend] Copied $COUNT files ($SIZE) -> expo-app/assets/dist"
[ -f "$DEST/index.html" ] || { echo "[sync_frontend] ERROR: index.html missing after copy"; exit 1; }
echo "[sync_frontend] index.html present. OK"
