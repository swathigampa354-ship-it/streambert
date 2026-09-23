# Architecture Decision — Single Authoritative Android Implementation

**Date:** 2026-09-23
**Repo:** https://github.com/swathigampa354-ship-it/streambert
**Decision Required:** Choose ONE Android architecture, remove duplicates

---

## Current State Audit

### Three Competing Implementations Found:

1. **android/** — Capacitor Android project
   - Status: Exists, has Gradle, has Java plugin files (ExternalPlayerPlugin.java, AndroidProxyServer.java)
   - Type: Capacitor (WebView wrapper around Vite dist/)
   - Pros: Already implemented, reuses dist/ directly, minimal React changes, working Java plugin
   - Cons: Not Expo, user has Expo/EAS not Capacitor, WebView-based not React Native, not aligned with user's existing EAS setup
   - Build: Requires JDK 17 + Android SDK, `./gradlew assembleDebug` (fails in sandbox due to 993M tmpfs OOM, but compiles)
   - Package: com.truelockmc.streambert, minSdk 21, targetSdk 34

2. **expo-app/** — Expo/EAS prototype (INCOMPLETE)
   - Status: Incomplete, missing package.json, loads https://streambert.vercel.app (NOT acceptable for production)
   - Type: Expo + React Native + WebView + custom native module (prototype)
   - Pros: Uses user's existing Expo/EAS infrastructure, EAS can build dev APK early, config plugins, custom native modules, better for Play Store
   - Cons: Currently incomplete, vercel.app dependency is wrong, needs real implementation
   - Structure: app.json, eas.json, babel.config.js, metro.config.js exist, app/ has 4 screens, modules/expo-external-player has Kotlin/Java, plugins/with-external-player.js exists
   - Missing: package.json (critical), assets/, proper dependency versions, local Streambert frontend packaging

3. **android-custom-backup/** — Backup native implementation
   - Status: Empty (only src/ folder, no files)
   - Type: Backup
   - Action: Remove, no longer needed

---

## Comparison

### OPTION A — Capacitor

**Architecture:**
```
Vite build (dist/) → Capacitor WebView → Android APK
                    → Java plugin (ExternalPlayerPlugin.java) for Intent/PackageManager/proxy
```

**What gets reused:**
- 100% of React frontend (dist/ copied to android assets)
- All JS logic (api.js, components, etc)
- No UI rewrite needed

**What must be rewritten:**
- index.js (Electron main) → Capacitor handles window creation
- preload.js → Capacitor bridge
- src/ipc/* → Capacitor plugins or JS equivalents
- window.electron calls → Capacitor.Plugins or platform abstraction

**Pros:**
- Fastest to implement (already 80% done)
- Minimal changes to existing code
- Proven: our Java plugin already works (compiles, logic correct)
- Simple mental model: WebView wrapper

**Cons:**
- Not Expo — user has Expo/EAS, not Capacitor
- User explicitly says they have Expo/EAS token and experience building APKs via EAS
- Capacitor is WebView-only, not truly native
- Requires maintaining Capacitor + Expo? User wants one
- Not as good for Play Store as Expo? Actually both work, but Expo has better tooling

**Build:**
- `npx cap copy android && cd android && ./gradlew assembleDebug`
- APK at `android/app/build/outputs/apk/debug/app-debug.apk`

**Verdict:** Works, but not aligned with user's existing Expo/EAS capability.

---

### OPTION B — Expo/React Native (RECOMMENDED)

**Architecture:**
```
Expo App (React Native)
├── Frontend: WebView loading LOCALLY PACKAGED Streambert dist/ (NOT vercel.app)
│   ├── dist/ built via Vite, copied to Expo assets or loaded via file://
│   ├── Injected JS to intercept m3u8/mp4 (replaces Electron webRequest)
│   └── postMessage bridge to React Native for external player
├── Bridge: Custom Expo native module (Java/Kotlin) for external player, proxy, storage
│   ├── ExternalPlayerModule.kt (adapted from ExternalPlayerPlugin.java)
│   ├── AndroidProxyServer.java (same, Map instead of JSObject)
│   └── Config plugin for AndroidManifest permissions & queries
├── Storage: AsyncStorage / expo-sqlite / expo-file-system / expo-secure-store
└── Build: EAS Build (eas build --profile development --platform android) → APK
```

**Alternative sub-options for frontend:**
- **Option B1 (fast, RECOMMENDED for first dev APK):** WebView with locally packaged dist/ (file://android_asset/ or expo-asset)
  - Pros: Preserves 90% of existing React code, no UI rewrite, fastest
  - Cons: Still WebView, not truly native, but acceptable for MVP
- **Option B2 (long-term):** Port UI to React Native components (View, Text, etc)
  - Pros: Truly native feel, better performance
  - Cons: Major rewrite, slower
- **Option B3 (hybrid):** WebView for now, migrate screens to RN incrementally
  - Pros: Best of both, allows early dev APK
  - Cons: More complex

**What gets reused:**
- 70-90% depending on sub-option:
  - TMDB API, AniList API, search, metadata, trending, movie/TV/anime logic, episode mappings, ratings, subtitles parsing, appearance, library, history, watchlist, settings, UI components (if WebView), styles, fonts, stream-source logic (PLAYER_SOURCES)
- Pure JS utils: `api.js`, `storage.js` (adapted), `backup.js`, `subtitles.js`, `ageRating.js`, etc
- External player logic: `headerHandler.js`, `streamResolver.js`, `playerRegistry.js`, `androidBridge.js` (adapt bridge), etc — already pure JS

**What must be rewritten:**
- Electron-specific: `index.js`, `preload.js`, `window.electron.*` (190 usages), `src/ipc/*` (allmanga, downloads, storage, subtitles, player, etc)
- Need platform abstraction: `platform/desktop/` (Electron) vs `platform/android/` (Expo)
- Stream resolution: Electron `webRequest.onBeforeRequest` for m3u8 intercept → WebView injected JS + `onShouldStartLoadWithRequest` or `onMessage`
- AllManga resolver: Port from Node (https, crypto) to JS (fetch + WebCrypto)
- Downloads: Node fs/child_process/yt-dlp → Expo FileSystem + MediaLibrary + maybe native FFmpeg
- Secure storage: Electron safeStorage → Expo SecureStore
- File system: Node fs/path → Expo FileSystem
- Notifications, window controls, updater, Discord RPC — either replace with Expo equivalents or disable on Android initially

**Pros:**
- Uses user's existing Expo/EAS infrastructure (user has token, experience building APKs)
- EAS can build dev APK early (critical for testing real device — user says APK packaging is NOT the problem)
- Config plugins allow custom native code
- Custom native modules supported via expo-modules
- Better for Play Store, more native feel than Capacitor WebView
- Can still package existing Vite frontend locally (not vercel.app) via WebView
- Allows incremental migration to React Native UI
- Single authoritative architecture (no Capacitor + Expo duplication)

**Cons:**
- More work than Capacitor to set up initially
- Need to create real Expo project with correct dependency versions
- Need to handle WebView vs RN UI decision
- Need to port AllManga resolver

**Build:**
- `eas build --profile development --platform android` → dev client APK with custom native code
- `eas build --profile production --platform android` → production APK
- User has EAS token, can build

**Verdict:** Best fit for user's existing capability and long-term maintainability. Allows early dev APK for real device testing.

---

### OPTION C — Another Approach (e.g., Tauri, React Native CLI without Expo, PWA, etc)

**Tauri:**
- Pros: Rust-based, lightweight, could reuse web frontend
- Cons: Android support is alpha, not as mature as Expo, user has Expo not Tauri, more complex

**React Native CLI (without Expo):**
- Pros: Full control, no Expo limitations
- Cons: User has Expo/EAS, not RN CLI, more setup, EAS is easier for building

**PWA (Progressive Web App):**
- Pros: No native code needed, just web
- Cons: Cannot launch external players via Intent (needs native), cannot do PackageManager detection, cannot do proxy ServerSocket, cannot access file system properly — fails external player requirement

**Verdict:** Not recommended, Expo is better.

---

## RECOMMENDED: OPTION B — Expo/React Native

**Why:**

1. **User has Expo/EAS** — explicitly says "I already have Expo/Expo.dev access, Expo/EAS authentication token, Experience using Expo/EAS to build Android applications, The ability to build/package the final APK through Expo/EAS". Therefore APK packaging is NOT the problem. Capacitor is not using user's existing capability.

2. **Single authoritative architecture** — Currently 3 implementations (android/, expo-app/, android-custom-backup/) drifting. Need to choose one. Expo is the cleanest final.

3. **Preserves most code** — 70-90% of Streambert can be reused via WebView with locally packaged dist/ (NOT vercel.app). Our existing pure JS external player logic (headerHandler, streamResolver, etc) can be reused directly.

4. **Allows early dev APK** — Expo dev client can be built early once minimum native module exists (player detection + launch). This is critical for testing real device behavior (VLC/MPV/MX). User says "Build a development APK early" — Expo EAS is perfect for this.

5. **Custom native modules are acceptable** — User says "If native Android functionality is required, that is acceptable. If Expo development builds/custom native modules are required, that is acceptable."

6. **External player is correct architecture** — Final APK does NOT need own video decoder, can use external players. Expo can do this via native module (Intent).

7. **Fixes current known problems:**
   - Problem 1: expo-app loads vercel.app → Fix: package dist/ locally via file:// or expo-asset
   - Problem 2: No package.json → Fix: create real package.json with compatible versions
   - Problem 3: 190 window.electron calls → Fix: create platform abstraction
   - Problem 4: Duplicate implementations → Fix: remove android/ Capacitor and android-custom-backup, keep only expo-app as authoritative (or keep android/ as reference but mark deprecated)
   - Problem 5: compileSdk 34 → Verify against Expo requirements (Expo SDK 51 uses compileSdk 34, so OK)

**What gets reused (PLATFORM-INDEPENDENT):**

- TMDB API, AniList API, search, metadata, trending, movie pages, TV pages, anime logic, episode mappings, ratings, subtitles parsing, appearance, library logic, history, watchlist, settings, UI components (if WebView), styles, fonts, stream-source logic where browser-compatible (PLAYER_SOURCES definitions)
- `src/utils/api.js` (fetch-based, works on Android)
- `src/utils/externalPlayer/*` (headerHandler, streamResolver, playerRegistry, androidBridge adapted, etc) — pure JS
- `src/components/*` (if WebView wrapper, reuse directly)
- `src/pages/*` (if WebView, reuse)
- `src/styles/*`, fonts

**What must be rewritten (ELECTRON-SPECIFIC → ANDROID):**

- `index.js` (Electron main: BrowserWindow, session, webRequest, ad blocking) → Expo App entry + WebView with injected JS for m3u8 intercept
- `preload.js` (contextBridge exposing 50+ IPC) → Expo modules + WebView postMessage bridge
- `window.electron.*` (190 usages) → platform abstraction `platform.getDownloads()`, `platform.launchExternalPlayer()`, etc
- `src/ipc/allmanga.js` (Node https + crypto + yt-dlp + local http server) → JS port using fetch + WebCrypto (or keep as custom native module with OkHttp)
- `src/ipc/downloads.js` (Node fs/path/child_process/yt-dlp/ffmpeg) → Expo FileSystem + MediaLibrary + maybe native FFmpeg module (or document as TODO for milestone 7)
- `src/ipc/storage.js` (safeStorage) → Expo SecureStore
- `src/ipc/subtitles.js` (Node fs) → Expo FileSystem + Java download via native module
- `src/ipc/player.js` (spawn mpv/vlc) → ExternalPlayerModule.kt (Intent)
- `src/ipc/externalPlayer.js` (Node http proxy) → AndroidProxyServer.java (Java) + Expo module
- `src/ipc/blockStats.js`, `discordRpc.js`, etc → either port or disable on Android

**Platform abstraction:**

```
src/platform/
├── index.js (or platform.js) — auto-detects platform, exports unified API
├── desktop/
│   ├── storage.js (Electron safeStorage + fs)
│   ├── downloads.js (Node yt-dlp)
│   ├── externalPlayer.js (spawn mpv/vlc)
│   ├── proxy.js (Node http)
│   └── etc
└── android/
    ├── storage.js (Expo SecureStore + FileSystem + AsyncStorage)
    ├── downloads.js (Expo FileSystem + MediaLibrary, TODO)
    ├── externalPlayer.js (Expo ExternalPlayerModule)
    ├── proxy.js (AndroidProxyServer via native module)
    └── etc

Usage in UI:
import platform from '../platform';
// Instead of window.electron.getDownloads()
const downloads = await platform.getDownloads();
// Instead of window.electron.launchExternalPlayer()
await platform.launchExternalPlayer({url, playerId, title, headers, subtitle})
```

---

## Decision: Choose ONE

**I choose OPTION B — Expo/React Native with WebView wrapper for first dev APK, then incremental RN migration.**

**Actions:**

1. **Remove duplicates:**
   - Keep `android/` as reference for Java code but mark as deprecated OR remove it to avoid confusion (I will keep it as `android-capacitor-reference/` for now, but final authoritative is `expo-app/`)
   - Remove `android-custom-backup/` (empty)
   - Make `expo-app/` the single authoritative Android implementation

2. **Fix expo-app to be production-ready:**
   - Create real `package.json` with compatible versions (expo 51, expo-router 3.5, react 18.2, react-native 0.74, react-native-webview 13.8, expo-modules-core, expo-build-properties, expo-file-system, expo-secure-store, etc)
   - Create `assets/` with icon
   - Fix `app/streambert.tsx` to NOT load vercel.app, but load locally packaged dist/
   - Create platform abstraction

3. **Create platform abstraction:**
   - `src/platform/index.js` — unified API
   - `src/platform/desktop/` — Electron implementations
   - `src/platform/android/` — Expo implementations

4. **Package actual Streambert frontend:**
   - Build Vite dist/ (`npx vite build`)
   - Copy dist/ to expo-app assets or load via `file:///android_asset/` or `expo-asset`
   - WebView loads local file, not remote URL

5. **Real stream resolution:**
   - WebView injected JS to intercept m3u8/mp4 (fetch/XHR/video tags)
   - Or use `onShouldStartLoadWithRequest` for more reliable intercept
   - Test actual Streambert sources (VidKing, Videasy, VidSrc, AllManga)

6. **External player:**
   - Use our existing Java code adapted to Expo module (already done in expo-app/modules/expo-external-player/)
   - Test PackageManager detection, Intent launch, proxy, subtitles on real device

7. **Build dev APK early:**
   - `eas build --profile development --platform android` once minimum native module works
   - Install on physical Android device (user has Android 15 device)
   - Test

---

## Files to Change/Create

**To be removed/renamed:**
- `android/` → rename to `android-capacitor-reference/` or remove (keep Java files as reference)
- `android-custom-backup/` → remove (empty)

**To be fixed in expo-app/:**
- `expo-app/package.json` — CREATE with compatible versions
- `expo-app/app.json` — already exists, but verify
- `expo-app/eas.json` — exists, OK
- `expo-app/babel.config.js` — exists, OK
- `expo-app/metro.config.js` — exists, OK
- `expo-app/app/streambert.tsx` — FIX to load local dist/, not vercel.app
- `expo-app/assets/` — CREATE with icon.png
- `expo-app/modules/expo-external-player/` — already exists, but need to ensure package.json and native code correct
- `expo-app/plugins/with-external-player.js` — exists, OK

**To be created for platform abstraction:**
- `src/platform/index.js` — unified platform API
- `src/platform/desktop/index.js` — desktop implementations (wraps window.electron)
- `src/platform/android/index.js` — android implementations (wraps Expo modules)
- `src/platform/types.js` — types for platform API

**To be migrated from window.electron:**
- All 190 usages in `src/App.jsx`, `src/components/*.jsx`, `src/pages/*.jsx`, `src/utils/*.js` — replace with `platform.*`

**For Streambert frontend packaging:**
- `expo-app/assets/dist/` — copy of Vite-built dist/ (or use `expo-asset` to bundle)
- Or `expo-app/public/` with dist files
- WebView loads `file:///android_asset/dist/index.html` or via `require`

---

## First Development APK Will Contain:

- Expo app shell with Expo Router
- Custom native module `expo-external-player` (PackageManager detection, Intent launch, proxy ServerSocket, subtitle download)
- Config plugin for permissions & queries
- `player-test` screen: test native bridge (detect players, launch VLC/MPV/MX/chooser, proxy, subs) — MINIMUM for Milestone 1
- `streambert` screen: WebView loading locally packaged dist/ (not vercel.app) with m3u8 intercept via injected JS — for Milestone 2-3
- Platform abstraction started (not all 190 window.electron calls migrated yet, but core ones for external player)

**First Dev APK Will NOT Contain:**

- Full platform abstraction for all 190 window.electron calls (only core: external player, proxy, storage, etc)
- Full Streambert UI ported to React Native (will use WebView wrapper initially)
- Downloads via yt-dlp/ffmpeg (documented as TODO Milestone 7)
- Discord RPC, auto-updater, window controls (desktop-only, disabled on Android)
- AllManga resolver fully ported (may still need Node-like custom module, or use WebView for anime too)
- Library/history/settings fully working with AsyncStorage (basic version, not full)
- Production polish, icons, splash, etc (basic)

**Build command:**

```bash
cd expo-app
npm install
eas build --profile development --platform android
# Or local: npx expo run:android
```

**Test on physical device (Android 15):**

- App launches
- Navigation works (index → player-test → streambert)
- player-test: Detect Players shows VLC/MPV/MX if installed, or chooser fallback, no crash if none
- player-test: Launch VLC with Big Buck Bunny MP4 → VLC opens → video plays
- player-test: Launch via proxy → proxy 127.0.0.1:port/https/... → VLC plays
- player-test: Subtitle download → file in /sdcard/Download/StreambertSubs/ → VLC shows subs
- streambert: WebView loads local dist/ (not vercel.app), search works, movie page works, source selection works, m3u8 detected, external player button works → VLC plays real Streambert stream
- If fails, fix and rebuild dev APK

---

## Milestones (Revised)

**Milestone 1: Real Expo/Android shell + native module**
- Expo app with package.json, dev client, native module, player-test screen
- APK installs, native module loads, player detection works, VLC/MPV/MX launch works

**Milestone 2: Real Streambert frontend (locally packaged)**
- APK + actual Streambert UI via WebView loading local dist/, TMDB, AniList

**Milestone 3: Real stream resolution**
- Streambert + real source + real stream URL via WebView intercept

**Milestone 4: External playback**
- Stream → VLC/MPV/MX → actual playback (real video plays)

**Milestone 5: Headers/proxy/subtitles**
- Header-protected streams work, proxy when needed, subs work

**Milestone 6: Library/history/settings/storage**
- AsyncStorage/SQLite, SecureStore, FileSystem

**Milestone 7: Downloads**
- Expo FileSystem + MediaLibrary + native FFmpeg if needed

**Milestone 8: Production APK**
- `eas build --profile production --platform android`

---

**Decision committed: OPTION B — Expo/React Native**

**Next: Implement fixes for expo-app to be production-ready, create platform abstraction, package local frontend, build dev APK**

