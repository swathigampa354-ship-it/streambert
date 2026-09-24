# Streambert — APK Build Checklist

Status at authoring: **READY FOR EAS** (all local gates green — see FINAL_AUDIT.md).

## Preconditions (ALL must hold — verified today)
- [x] `npx tsc --noEmit` → 0 errors (expo-app)
- [x] `npx expo-doctor` → 18/18
- [x] `bash tests/run_all.sh` → 10/10 suites PASS
- [x] `npx expo export --platform android` → bundles
- [x] Scoped storage permissions with maxSdkVersion (regenerated manifest checked)
- [x] `assets/dist` committed & in sync with `dist` (`scripts/sync_frontend.sh`)
- [x] `expo-screen-orientation` + `patch-package` in package.json (postinstall wired)
- [x] app.json: package `com.truelockmc.streambert`, version 2.6.0, plugins wired
- [x] eas.json: preview + production profiles (`buildType: apk`), appVersionSource: remote
- [x] index/screens: production route = `/streambert` (auto-replace), dev gates `_DEV__`

## One-time EAS setup (needs the Expo token — user provides)
```bash
cd expo-app
eas whoami                       # login (token)
# projectId is already in app.json (extra.eas.projectId) — no `eas init` needed
```

## Build commands
```bash
# sanity pass first (always run before submitting):
npx expo prebuild --platform android --clean --no-install
npx expo export --platform android --output-dir /tmp/export-check

# cloud build (production APK):
eas build --profile production --platform android

# optional internal variant:
eas build --profile preview --platform android
```

## Post-download device checks
Run `DEVICE_VERIFICATION.md` against the produced APK on hardware:
boot flow → phone mode → TV mode → stream → player → subtitles → back/exit behavior.

## If a future change touches frontend code (`src/`)
```bash
npx vite build && bash scripts/sync_frontend.sh && bash tests/run_all.sh --fast
```
The expo-config parity suite FAILS if assets/dist drifts from the fresh build —
that is the deterministic guard against stale bundled frontends.

## What NOT to do
- Do not edit `expo-app/android/**` directly — it is regenerable prebuild output; change
  `plugins/*` or Gradle entries there will be wiped by the next `--clean` prebuild.
- Do not bypass `with-dist-assets` — prebuild intentionally FAILS without assets/dist.
- Do not re-submit `eas build` in a loop to debug: reproduce locally with the export
  + prebuild commands above first (they catch the same class of failure).
