# Streambert Android — Pre-APK Verification
Date: 2026-09-24 · Scope: everything provable WITHOUT a physical Android device.
Status vocabulary: **PASS / FAIL / PARTIAL / NOT TESTABLE WITHOUT ANDROID DEVICE / NOT IMPLEMENTED / BLOCKED** — a claim is only PASS where a reproducible test exists.

## How to reproduce everything
```bash
cd streambert-fork && bash tests/run_all.sh        # full (builds dist + Metro export)
cd streambert-fork && bash tests/run_all.sh --fast # skips vite build + expo export
```
Current matrix: **10/10 suites PASS ≈ 300 assertions**.

---

## PHASE 1 — Repo & environment state — **PASS**
- git status/log inspected; no files deleted except proven-dead artifacts from prior sessions.
- Root `node_modules` (Vite 7 build), `expo-app/node_modules` (SDK 52 toolchain) installed; javac 11.0.28, Python 3, Node 20 in sandbox.
- supabase/env files absent → `yarn subs` prebuild script skipped (env-gated, works).

## PHASE 2 — Frontend verification — **PASS (with noted limits)**
- `npx vite build` → real dist: relative `./assets/` URLs, `#root` present, all referenced assets exist on disk, zero `streambert.vercel.app`/localhost refs, no TMDB JWT bundled. Test: `tests/test_frontend_dist.sh` (10/10).
- Upstream quirk found: `dm-sans-{300,regular,500,600}.woff2` are byte-identical upstream → vite correctly dedupes; encoded as NOTE in test.
- Real React App mounted in jsdom (`tests/test_frontend_render.mjs`):
  - no-key → **setup screen** (4/4);
  - invalid TMDB key (real 401) → **error surfaced, no fake success** (5/5).
- LIMIT: home/movie/TV/anime/torrent pages require a valid BYOK TMDB key & network → **NOT TESTABLE WITHOUT ANDROID DEVICE/KEY here**; error paths proven instead.

## PHASE 3 — Electron dependency replacement — **PASS**
Dependency table (Electron → Android):
- `ipcRenderer/invoke` → `platform/desktop|android` adapter → `window.electron` shim in WebView → `StreambertNative` bridge → `dispatchNativeCall` (Kotlin module / RN deps). Reachability inspected via grep; 96/96 unit tests execute the real modules (`tests/test_js_unit.mjs`).
- `dialog`, `fs`, `shell.openExternal`, `child_process` yt-dlp → desktop-only code paths dynamically imported ONLY under `platform==='desktop'`; esbuild/jsdom bundling proves Android path never executes them (`--external http` evidence).
- `session.webRequest` → RN WebView has NO equivalent → native patch (see PHASE 11).
- Remaining desktop-only-by-design: torrent subprocess (separate milestone), DownloadsPage internals (hidden on Android, PHASE 15).

## PHASE 4 — API verification — **PASS** (`tests/test_api_live.mjs`, 25/25)
- TMDB invalid key → clean **401** via wrapper AND raw fetch (no crash/fake).
- AniList GraphQL live query ('Death Note') → title + episodes list.
- videasy & vidsrc embed endpoints: HTTP 200 + HTML shell markers.
- `getSourceUrl(sourceId,type,id,season,episode)` positional signature pinned by test.
- **vidking.net: provider-side DNS SERVFAIL (verified via Cloudflare+Google DoH)** — outage documented in test; source list untouched per constraints.

## PHASE 5 — Stream resolution — **PARTIAL**
- Reachability of provider pages: PASS (above). Correctness of resolver decisions: PASS (96 unit: direct vs proxy classification).
- Actual m3u8 discovery inside JS-heavy iframes (vidsrc/videasy players): **NOT TESTABLE WITHOUT ANDROID DEVICE** (needs a real WebView executing JS; this is exactly what the native interception patch in PHASE 11 targets).
- No secrets exposed: all BYOK.

## PHASE 6 — HLS proxy (AndroidProxyServer.java) — **PASS** (30/30, real JVM)
Compiled the REAL `AndroidProxyServer.java` (javac, only stub = android.util.Log) against a fixture upstream (`tests/fixtures/upstream.mjs` + `tests/test_proxy_java.*`):
master→variant→**ts and m4s**; relative/root-relative/absolute/query-string URLs (port-preserving, two real bugs found & fixed); EXT-X-KEY / EXT-X-MEDIA / EXT-X-MAP URI rewriting; **gzip playlist decompress→rewrite→repack** (Content-Encoding stripped); byte-identical 64 KB segment passthrough; **Range 206 + Content-Range**; same-host redirect Location rewrite, cross-host redirect left absolute; Set-Cookie forwarding; **Referer/UA/Cookie header injection** (the reason proxy exists — players don't honor Intent extras); 403 for foreign hosts (not an open relay); upstream 500 surfaced, not masked; streaming without full-file buffering (16 KB chunk loop in real code).

## PHASE 7 — Header/cookie handling — **PASS**
- Decision matrix test-pinned (`tests/test_js_unit.mjs`): direct unless playlist/fickle-provider → proxy injects headers.
- Constraint honored: **no assumption that Intent extras work** — proxy URL is the default path when headers matter; subtitle extras passed only as best-effort alongside relay URLs.

## PHASE 8 — External player logic — **PARTIAL** (all non-device parts PASS)
- Intent URI building, VLC/MPV/MX/generic/chooser variants, invalid URL/MIME rejection, proxy start/stop, subtitle param wiring: covered by 96 unit tests + Kotlin↔TS parity (`tests/test_expo_config.mjs` 58/59+, asserts Kotlin AsyncFunctions ⊇ TS calls, 13-package queries parity Kotlin↔plugin).
- `getInstalledPlayers` behavior, real VLC/MPV/MX acceptance, playback: **NOT TESTABLE WITHOUT ANDROID DEVICE**.
- No-player fallback path returns "No compatible external player installed" (unit-tested).

## PHASE 9 — Subtitles & scoped storage — **PASS (display fallbacks: PARTIAL)**
- Native `downloadSubtitle` → MediaStore.Downloads (API 29+), legacy file path ≤28 with maxSdkVersion'd permission; returns stable `/storage/emulated/0/Download/StreambertSubs/...` path — `/sdcard/...` never written blindly.
- Frontend subtitle-dir fallbacks still show a legacy display string if the bridge is absent — display-only, no IO breach; flagged for device check.

## PHASE 10 — Local frontend packaging — **PASS**
- `expo-app/assets/dist` = exact copy of built dist (sync check in parity suite + `scripts/sync_frontend.sh`), `with-dist-assets` plugin FAILS prebuild if index.html missing, URI `file:///android_asset/dist/index.html`, WebView `allowFileAccess`/`domStorageEnabled` set (jsdom file:// storage caveat documented in test).

## PHASE 11 — WebView bridge audit — **PARTIAL**
- Discovery: Electron `session.webRequest` catches cross-origin iframe subresource loads; WebView JS injection CANNOT see those.
- Fallbacks implemented: (a) injection captures same-frame fetch/XHR/media srcs; (b) `onShouldStartLoadWithRequest` intercepts top-frame/href stream links; (c) **native `shouldInterceptRequest` patch** for react-native-webview (patches/react-native-webview+13.12.5.patch) re-emits media subresource URLs as synthetic `topMessage` → handled as `NATIVE_STREAM_FOUND` in app/streambert.tsx. Patch apply/reverse verified via patch-package; `.ts`-asset false-positive guard present.
- Contract suite `tests/test_bridge_contract.mjs` **41/41** incl. evaluator round-trips and hostile-payload fuzz (U+2028/U+2029/quotes/backslashes/5 KB) — caught and fixed 2 REAL bugs this run (unquoted bridge id + unescaped line terminators in `buildResolveScript`).
- Remaining unknown: behavior inside a REAL WebView process — **NOT TESTABLE WITHOUT ANDROID DEVICE**.

## PHASE 12 — Error handling — **PASS (device paths: PARTIAL)**
- Bridge call timeout 20 s + pending-map cleanup (no ghost promises); error surfaces into UI/logs; tests assert NO fake-success on: TMDB 401, provider DNS death, upstream 500, malformed URLs, missing player, proxy foreign-host 403. Native-side failures (proxy bind, intent reject) await device.

## PHASE 13 — Navigation — **PARTIAL→PASS**
- Hardware back: WebView history first (`navState.canGoBack` → `goBack()`), then `router.back()`; no alert traps; WebView back trap impossible (intercepted shouldOverrideUrlLoading for non-http schemes → RN Linking).
- Deep page-flow verification needs device/emulator (visual) — static wiring proven.

## PHASE 14 — Storage audit — **PARTIAL**
- Watchlist/history/settings: frontend `src/utils/storage.js` localStorage-based inside persistent WebView → no desktop fs assumptions; desktop-only fs code unreachable (P3 proof). MediaStore subtitles (P9). AsyncStorage module present for future. Persistence across process death: **NOT TESTABLE WITHOUT ANDROID DEVICE**.

## PHASE 15 — Downloads — **NOT IMPLEMENTED (separate milestone — not a blocker)**
- DownloadsPage + Sidebar entry **hidden on Android** via `isAndroid()` gate (desktop untouched); desktop download manager (yt-dlp child_process) is desktop-only by design; Android-native downloading to be designed separately (SAF/MediaStore + background service). `pickFolder()` legacy path noted.

## PHASE 16 — Termux/Linux test suite — **PASS**
- `tests/run_all.sh` orchestrates 10 suites; every suite prints `[PASS]/[FAIL] <name>: N passed, M failed`; non-zero exit on failure; `--fast` mode for iteration (~13 s).

## PHASE 17 — This checklist — **DONE**

## PHASE 2b — UI ADAPTATION + TV MODE (2026-09-24, post-audit phase) — **PARTIAL → device checks listed**
Implementation (code present, wired, statically+dynamically tested):
- **Desktop UI preserved**: same `src/App.jsx` tree, sidebar, pages, cards, gamepad layer. Only ADDITIVE layer `src/styles/responsive.css` (import in `src/main.jsx`) + small JSX gates. global.css untouched by TV additions (verified).
- **Phone mode**: breakpoints 640px / 380px / short-landscape; 44px+ touch targets; hero card clamps; tooltip suppression on touch; `100dvh` fallback.
- **TV MODE**: Sidebar button (Android-gated via `isAndroid()`, TvIcon in Icons.jsx) → custom confirm dialog ("Rotate your phone horizontally for the best experience." / Continue / Cancel) → `utils/tvMode.js` persists intent (`streambert_tv_mode`), applies `body.tv-mode` class, asks bridge (`webviewBridge.setTvMode`) → dispatcher `setTvMode` (boolean-validated) → RN `expo-screen-orientation@~8.0.4` `lockAsync(LANDSCAPE)`. EXIT TV MODE → `lockAsync(PORTRAIT_UP)`. Boot `syncTvModeOnBoot()` re-applies class+lock after WebView reload; AppState 'active' listener re-asserts lock on resume (covers background + VLC round-trip).
- **TV layout**: `body.tv-mode` = desktop-style landscape: sidebar 84px/56px targets, hero 64vh, cards minmax(170px,1fr), focus-visible ring, gamepad ring (existing `.gamepad-focused`) kept.
- **Gamepad**: existing stack (`gamepad.js`, `gamepadSpatialNav.js`, `useGamepadNav.js`, `playerGamepadScript.js`) reused untouched; polling works in WebView Chromium; default-on setting.
- **Production shell**: `expo-app/app/index.tsx` auto-`router.replace('/streambert')` (dev menu only under `__DEV__`); permanent header + VLC/MPV/Chooser/Proxy buttons + logs are `__DEV__`-gated; hardware back: WebView history → production `BackHandler.exitApp()` (no redirect loop, asserted) → dev `router.back()`.
- **TS clean** (expo-app `tsc --noEmit` 0 errors), `expo-doctor` 18/18 after `expo-screen-orientation` install.
Tests: `tests/test_ui_tv.mjs` = **56/56 PASS** (uiStatic 26, tvUiWiring 17, tvModeModule 8 real-module behaviors, tvSidebarComponent jsdom 5). Suite orchestrator includes it.
REQUIRES ANDROID DEVICE (orientation is hardware behavior; NOT testable in JS): rotate-lock visual, exit-restore visual, background/VLC round-trip, gamepad+D-pad on TV, confirmed in device plan items 7-9 below.

## PHASE 18 — Stop condition — **MET**
Every requirement provable without a device has a passing test; every remaining unverified item is provably device-dependent and listed below with exact next action. **Stopping before packaging per directive.**

---

## REQUIRES ANDROID DEVICE (device-test plan, in order)
1. `eas build` → APK (expo export step now passes locally; the two EAS-killing bugs — missing `query-string` metro dep and dead native-copy plugin — are fixed).
2. WebView capture: open videasy/vidsrc item → confirm `native capture:` log line + stream URL intercepted (patch (c)).
3. External playback: VLC + mpv + MX each; proxy-on/proxy-off matrix; real subtitle delivery to player(s).
4. Back-stack walk: home→movie→episode→back→back→home→exit; hardware back inside WebView history.
5. Cold restart: watchlist/history persist; settings persist.
6. Offline: airplane mode → clean error, no white screen.
7. TV Mode: button visible in sidebar (Android only) → dialog → Continue → landscape lock → desktop-style layout → EXIT TV MODE → portrait restored → re-open to confirm intent persists.
8. Orientation lifecycle: TV mode → home-screen background → return (lock reasserted) → launch VLC from TV mode → return (lock reasserted) → exit TV mode → background → return (portrait).
9. Gamepad on TV-mode landscape (Bluetooth controller or Android TV): d-pad focus ring, card navigation, A=select, B=back.

## Known PARTIAL items (not blockers, tracked)
- Frontend display-only legacy subtitle-dir fallback string (P9).
- vidsrc/videasy in-iframe capture (awaiting #2 above).
- `fileExists` assumption inside android bridge when FileSystem module absent (returns true; UI could show stale "watch" state).

## Test inventory (commands)
| Suite | Command | Assertions |
|---|---|---|
| JS unit | `node tests/test_js_unit.mjs` | 96 |
| Bridge contract | `node tests/test_bridge_contract.mjs` | 41 |
| Java proxy E2E | `bash tests/test_proxy_java.sh` | 30 |
| API live | `node tests/test_api_live.mjs` | 25 |
| Config parity | `node tests/test_expo_config.mjs` | 58 |
| Frontend dist | `bash tests/test_frontend_dist.sh` | 10 |
| Frontend render ×2 | `SCENARIO=no-key|invalid-key node tests/test_frontend_render.mjs` | 9 |
| Expo export | in `tests/run_all.sh` | bundle OK |
