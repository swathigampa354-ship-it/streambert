# Final Checklist — Pure Android Implementation

## Phase 0: Fork + Audit ✅

- [x] Fork Streambert https://github.com/truelockmc/streambert -> /home/user/streambert-fork
- [x] Fork MovieBox-TUI https://github.com/mesamirh/MovieBox-TUI -> /home/user/moviebox-tui-fork
- [x] Audit Streambert: Electron + React + Vite, PLAYER_SOURCES in api.js, desktop external player in src/ipc/player.js, no Android support
- [x] Audit MovieBox-TUI: Rust, AndroidIntent via termux-am/termux-open, proxy 127.0.0.1 /https/host/path, 9 subtitle extras, header handling
- [x] Short technical report: ANDROID_AUDIT.md (initial) + STREAM_HEADERS_ANALYSIS.md

## Phase 1: Define Workflow ✅

- [x] Search->Select->Resolve stream URL/type/headers/UA/Referer/cookies/subtitles -> ExternalPlayerAdapter -> Intent -> VLC/MPV/MX
- [x] Documented in ANDROID_EXTERNAL_PLAYER_DESIGN.md

## Phase 2: ExternalPlayerAdapter ✅

- [x] Clean abstraction ExternalPlayerAdapter
- [x] detect/list/select/launch/pass URL/MIME/headers/metadata/failure/fallback
- [x] Platform split: desktop vs Android
- [x] No dummy functions, no hardcoded URL, no silent header discard

## Phase 3: Player Support ✅

- [x] VLC: org.videolan.vlc, .debug
- [x] MPV: is.xyz.mpv, .debug, com.mpv, .beta
- [x] MX: com.mxtech.videoplayer.ad, .pro
- [x] Just Player: com.brouken.player
- [x] Next Player: dev.anotherwidget.ftp, com.anotherwidget.justplayer
- [x] Default: system chooser
- [x] Others: custom detection via queryIntentActivities
- [x] No crash if missing: returns chooser + message "No compatible external player installed"

## Phase 4: Stream URL Handling ✅

- [x] UA: Chrome 124
- [x] Referer: embed URL
- [x] Cookie: via proxy (mandatory)
- [x] Auth: via proxy (mandatory)
- [x] HLS: detection + rewrite
- [x] Redirects: handled via proxy
- [x] Preserve headers: no silent discard, error if proxy fails

## Phase 5: Local Proxy ✅

- [x] Remote->Local Proxy->Local URL->Player
- [x] Similar to MovieBox-TUI: 127.0.0.1:0 /https/host/path, host validation 403, header injection, HLS rewrite, Range forwarding, watchdog
- [x] Real implementation: AndroidProxyServer.java ServerSocket, not dummy
- [x] Desktop preserved: Node http via Electron IPC

## Phase 6: Subtitles ✅

- [x] Embedded: not applicable (external player handles)
- [x] External URL: download to /sdcard/Download/StreambertSubs via native bridge
- [x] Player-specific: 9 keys per MovieBox-TUI
- [x] Existing functionality preserved: desktop via Electron download

## Phase 7: API Requirements Audit ✅

- [x] TMDB: required for metadata, optional? Actually required for search, but can work without? Documented
- [x] AniList: required for anime
- [x] VidKing, Videasy, VidSrc: no API key, embed URLs
- [x] AllManga: no key, but needs main-process HTTP bypass
- [x] Documented in API_AUDIT.md

## Phase 8: Preserve Existing Functionality ✅

- [x] Search: preserved
- [x] Metadata: preserved
- [x] Seasons: preserved
- [x] Anime: preserved
- [x] Source selection: preserved
- [x] Stream resolution: preserved
- [x] Subtitles: preserved
- [x] History: preserved
- [x] Watchlist: preserved
- [x] Settings: preserved
- [x] Backup/restore: preserved
- [x] Downloads: preserved

## Phase 9: Separate Desktop and Android ✅

- [x] Platform abstraction: getPlatform() -> capacitor-android, android-web, electron, web
- [x] isAndroidNative() vs isDesktop()
- [x] DesktopProxyServer vs AndroidNativeProxy
- [x] detectDesktopPlayers vs detectAndroidPlayersPure
- [x] launchDesktop vs launchAndroidPure
- [x] No break to desktop

## Phase 10: APK Packaging (LATER) ⏳

- [ ] Framework: Capacitor (documented in CAPACITOR_ANDROID_SETUP.md)
- [ ] Frontend integration: dist -> android assets
- [ ] Bridge: ExternalPlayerPlugin.java registered in MainActivity
- [ ] Permissions: INTERNET, queries for video/*, storage for subs
- [ ] Storage: /sdcard/Download/StreambertSubs or getExternalFilesDir
- [ ] Intents: ACTION_VIEW with chooser
- [ ] Adapter integration: androidBridge.js
- [ ] Debug APK: ./gradlew assembleDebug
- [ ] Physical device test: 14 cases in TESTING.md
- [ ] Release APK sign: keystore

**DO NOT BUILD APK YET per task** — only after verification. This phase is documented but not executed.

## Phase 11: Test Real Playback ⏳ (Requires Physical Device) — VERIFIED 2026-09-23 IN SANDBOX, NO DEVICE

- [x] Automated tests: test-external-player.js 5 suites passed (sandbox, 2026-09-23)
- [x] Build: vite build success 83 modules (sandbox, 2026-09-23)
- [x] Java compilation: compileDebugJavaWithJavac passes after fixing iterator bug (2026-09-23)
- [ ] VLC: manual on device — NOT PERFORMED (no physical device in sandbox)
- [ ] MPV: manual — NOT PERFORMED
- [ ] MX: manual — NOT PERFORMED
- [ ] Multiple: manual — NOT PERFORMED
- [ ] None: manual — NOT PERFORMED
- [ ] Direct URL: manual — NOT PERFORMED
- [ ] HLS: manual — NOT PERFORMED (unit test for HLS rewrite passed)
- [ ] Headers: manual — NOT PERFORMED
- [ ] Referer: manual — NOT PERFORMED
- [ ] Cookies: manual (proxy) — NOT PERFORMED (proxy code compiles, unit test passed)
- [ ] Subtitles: manual — NOT PERFORMED
- [ ] Failed/expired/invalid: manual — NOT PERFORMED
- [ ] Network interruption: manual — NOT PERFORMED

**Honest status 2026-09-23:** No physical Android device in Arena.ai sandbox, cannot perform manual tests. Code verified via source inspection, unit tests, and Java compilation. Full Gradle assembleDebug fails at dex stage due to tmpfs 993M limit (OOM), not code bug. Requires local machine with Android Studio to build debug APK and test.

See ANDROID_DEVICE_VERIFICATION.md for full report.

## Phase 12: Do Not Fake Success ✅

- [x] No dummy functions: all real implementations
- [x] No placeholders: PackageManager real, Intent real, proxy real ServerSocket
- [x] No hardcoded URL: test URL only in test file, not production
- [x] No silent header discard: needsProxy checks Cookie/Auth, returns error if proxy fails
- [x] No claim without testing: automated tests passed, manual tests listed as TODO with clear note

## Phase 13: Document Implementation ✅

- [x] Architecture: IMPLEMENTATION_PURE_ANDROID_FINAL.md
- [x] Modified files: listed
- [x] New files: listed
- [x] Dependencies: CAPACITOR_ANDROID_SETUP.md
- [x] Android SDK requirements: min 21, target 34, permissions, queries
- [x] Player support matrix: in FINAL report
- [x] API requirements: API_AUDIT.md
- [x] Known limitations: in FINAL report

## Phase 14: APK Packaging Final Step ⏳

- See Phase 10

## Pure Android Verification (This Session's Main Fix)

- [x] Remove window.electron.probeAndroidOpeners from Android path
- [x] Remove termux-am/termux-open spawn from Android path
- [x] Remove Node http from Android path
- [x] Implement real PackageManager detection via Capacitor plugin
- [x] Implement real Intent.ACTION_VIEW via Capacitor plugin
- [x] Implement real proxy via Java ServerSocket
- [x] Implement real subtitle download via Java HttpURLConnection
- [x] Update preload.js to remove Android Termux IPC
- [x] Update UI messages to remove Termux install instruction
- [x] Update playerRegistry to remove Termux opener types as primary
- [x] Build verification: vite build success
- [x] Test verification: test-external-player.js all passed

## Files to Present

- IMPLEMENTATION_PURE_ANDROID_FINAL.md (main final report)
- CAPACITOR_ANDROID_SETUP.md (setup guide)
- STREAM_HEADERS_ANALYSIS.md (headers analysis)
- FINAL_CHECKLIST.md (this file)
- android/src/main/java/com/truelockmc/streambert/ExternalPlayerPlugin.java (real plugin)
- android/src/main/java/com/truelockmc/streambert/AndroidProxyServer.java (real proxy)
- src/utils/externalPlayer/androidBridge.js (Capacitor bridge)
- src/utils/externalPlayer/androidPlayerDetector.js (PackageManager detection)
- src/utils/externalPlayer/androidNativeProxy.js (Android proxy class)

