# Streambert — FINAL PRE-APK AUDIT (2026-09-24)

Audit method: full repository inventory → file-by-file inspection → targeted greps
(TODO/FIXME/HACK/debugger/console.log/catch{}/hardcoded URLs/secrets/storage APIs) →
dependency tree analysis → dead-reference graph pass → restructure → fix → verify.
Nothing below is claimed without an executed check.

---

## FIXED (every significant problem found & fixed)

**F1. Scoped-storage permissions shipped uncapped (modern Android breakage).**
`plugins/with-external-player.js` declared WRITE/READ_EXTERNAL_STORAGE with
maxSdkVersion only when it *created* the entry; the base template already shipped
them bare, so the guard skipped them and the generated manifest was non-compliant
for Android 13+ (silent blanket permission). Plugin now **normalizes existing
entries too**; regenerated manifest shows
`WRITE_EXTERNAL_STORAGE android:maxSdkVersion="28"` /
`READ_EXTERNAL_STORAGE ...maxSdkVersion="32"`. Kotlin path uses MediaStore ≥29 —
verified by code inspection + re-prebuild diff.

**F2. Abandoned Capacitor architecture shipped in repo + deps.**
Full `android/` Capacitor project (56 tracked files), `capacitor.config.json`,
`@capacitor/{android,cli,core}` deps + dead `window.Capacitor` code branches in
`src/utils/externalPlayer/*` (guarded execution paths that looked like live fallbacks).
Removed: dir, config, deps (`npm install` → **69 packages pruned**), and the dead
code paths (`isCapacitor()`, `isCapacitorAndroid()`, 7 capacitor "Method 1" blocks in
androidBridge.js, Capacitor branch in subtitleHandler/androidIntent,
`AndroidOpenerType.CAPACITOR_*` + Termux-legacy enum entries).

**F3. Dead exports & unused legacy utilities.**
`buildCapacitorIntentOptions` (imported but never called), `buildTermuxAmCommand`,
`buildTermuxOpenCommand`, `buildTermuxOpenUrlCommand` (no consumers anywhere) —
removed with callers/imports pruned. Stale "for use with Capacitor or Web Intent API"
docstring corrected on `buildIntentUri`. `AndroidOpenerType` trimmed to the three
REAL opners (STREAMBERT_NATIVE / INTENT_URI / SYSTEM_CHOOSER).

**F4. Root repo clutter / non-deterministic build outputs.**
`build/proxy-test/` artifact dir (compiled classes + logs + stale copy of
AndroidProxyServer.java) deleted; `build/` added to .gitignore.
`test-external-player.js` moved → `scripts/test-external-player.js`.
12 superseded session md reports → `docs/archive/` (EARLIER architecture rounds —
Capacitor, pure-Android variants: kept for history, out of the active tree).

**F5. Unused npm packages persisted in prod deps.**
`approve` + `scripts` — zero references anywhere; removed.
Prod runtime tree is now exactly `{react, react-dom}` (+ Electron devToolchain).
No missing/extraneous packages (`npm ls --omit=dev` clean).

**F6. INTER_LOCAL bridge id/escaping device-breaker (landed previously, re-verified).**
`buildResolveScript` unquoted ids + U+2028/U+2029 unpreserved — fuzz test in
`test_bridge_contract.mjs` actively re-proves the fix every run.

## CHANGED (major architectural/file changes)
- **C1.** Repo root restructured: only production-relevant files + docs/ + tests/ + scripts/ remain at top level; structure documented in REPOSITORY_STRUCTURE.md.
- **C2.** Frontend CSS is now two-layer: `global.css` (desktop foundation, untouched) + `responsive.css` (additive phone/tablet/TV breakpoints + `body.tv-mode` rules + confirm-dialog styles).
- **C3.** TV mode pipeline finalized: sidebar button (Android-only) → confirm dialog → `utils/tvMode.js` (localStorage intent + body class + boot sync) → bridge `setTvMode` (validated) → RN `ScreenOrientation.lockAsync` + AppState re-assert.
- **C4.** Production shell hardening completed: entry route auto-replaces to `/streambert`; dev launcher/`player-test`/debug controls/logs strictly `__DEV__`; production root back-behaviour = `BackHandler.exitApp()` (loop-proof).
- **C5.** Native stream coverage widened: patch-package patch on react-native-webview emits `NATIVE_STREAM_FOUND` from `shouldInterceptRequest` and `streambert.tsx` handles it (closes the Electron-webRequest gap for iframe-embedded players).

## VERIFIED (commands executed + results)
```
npx tsc --noEmit                          → 0 errors (expo-app)
npx expo-doctor                           → 18/18 checks passed
bash tests/run_all.sh                      → 10/10 suites ALL PASS (~355 assertions)
node tests/test_ui_tv.mjs                  → ALL_UI_TV_PASS (56)
npx expo export --platform android         → Bundled 914 modules OK (in run_all)
npx expo prebuild --platform android       → OK; regenerated manifest shows scoped perms
npx vite build                             → OK (26 files incl responsive css)
npm ls --omit=dev (root + expo-app)        → consistent, no missing/extraneous
git secrets sweep                          → no tokens/keys/passwords in tracked files
scripts/sync_frontend.sh                   → dist ⇄ assets/dist in sync (parity suite asserts)
```

## REMAINING (genuine issues only)
1. TV/page-flow visuals not yet reviewed on real screens (see hardware section).
2. `: any` types at RN↔JS boundaries in expo-app (16 occurrences) — pragmatic, tsc-clean; could be tightened later without behavior change.
3. `player-test.tsx` dev route exists (dev-only, unreachable in production) — intentionally retained for device debugging of the native module.
4. `docs/archive/` session reports retained by design (history, not clutter).
5. EAS builds themselves still unproven end-to-end (per task order: awaiting token). The two previously observed EAS-killers (metro dep, dead-native-copy plugin) are fixed and locally validated via `expo export` + prebuild.

## HARDWARE REQUIRED (see DEVICE_VERIFICATION.md)
Hardware back/exit-app behavior · orientation lock & lifecycle · TV-mode layout on real displays · gamepad/D-pad focus + VLC round-trip · MediaStore subtitle delivery to players · provider capture on device (vidsrc/videasy) · Airplane-mode handling · permission prompts.

## APK READINESS
**READY** — software-side gate (item 24 of the task list) is fully green. The
repository is in a deterministic build state: same `npm ci` → same `vite build` →
same `sync_frontend.sh` → same `expo prebuild` → same `expo export` → same `doctor`.
EAS packaging is the sole remaining step and is gated only on providing the Expo
account token (NOT requested during this audit, per instructions).
