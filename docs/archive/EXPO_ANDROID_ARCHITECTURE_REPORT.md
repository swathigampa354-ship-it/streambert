# Streambert Android Architecture Report — Expo/EAS + Native Bridge

**Date:** 2026-09-23
**Purpose:** Answer A-M questions, define correct architecture for porting Streambert to Android APK using Expo/EAS while preserving functionality.

---

## A. What is Streambert built with?

**Current Stack (from package.json, index.js, src/):**

- **Framework:** Electron 40.x (main process `index.js`, preload `preload.js`, renderer `src/`)
- **Frontend:** React 18.2 + React DOM + Vite 7.3 (build tool)
- **Styling:** Global CSS + custom fonts (Bebas Neue, DM Sans)
- **State:** React hooks, localStorage, in-memory caches
- **APIs:**
  - TMDB API `https://api.themoviedb.org/3` for movie/TV metadata, search, trending, seasons, episodes
  - AniList GraphQL `https://graphql.anilist.co` for anime metadata
  - PLAYER_SOURCES: 
    - VidKing `https://www.vidking.net/embed/...`
    - Videasy `https://player.videasy.to/...`
    - VidSrc `https://vsembed.su/embed/...`
    - AllManga `https://allmanga.to` + `api.allanime.day/api` (async resolver via main process)
  - Wyzie API for subtitles (optional, needs key)
- **Stream Resolution:**
  - **WebView + Intercept:** Electron session `webRequest.onBeforeRequest` intercepts `*.m3u8` and `*.vtt` URLs from embedded player iframe, sends to renderer via `m3u8-found` and `subtitle-found` IPC
  - **Header stripping:** Removes `X-Frame-Options` and `Content-Security-Policy` to allow embedding
  - **Ad blocking:** Blocks 50+ ad/tracker hosts via `BLOCKED_HOSTS` list
  - **AllManga:** Main-process HTTP POST to `api.allanime.day/api` with JSON, decrypts hex cipher + AES-256-CTR blobs, follows redirects for YT-mp4, uses yt-dlp if available, serves via local Node http server `setPlayerVideo`
  - **UA:** Chrome 124 `Mozilla/5.0...Chrome/124...`
- **Storage:**
  - `localStorage` for settings, watchlist, history, cache, playback mode, platform override
  - `src/ipc/storage.js` for secure store via Electron `safeStorage` (OS-encrypted)
  - File system for downloads via `src/ipc/downloads.js` (Node fs, child_process)
- **Downloads:** yt-dlp + ffmpeg wrapper via `src/ipc/downloads.js`, progress via IPC
- **Subtitles:** `src/ipc/subtitles.js` searches Wyzie, downloads via Node fs
- **External Player (Desktop):** `src/ipc/player.js` spawns `mpv`/`vlc` binary via `child_process.spawn`, checks `which mpv/vlc`
- **External Player (Android - our implementation):** `src/utils/externalPlayer/` + Java `ExternalPlayerPlugin.java` + `AndroidProxyServer.java` via Capacitor
- **Other:** Discord RPC, auto-updater, window controls, notifications, gamepad support, seasonal events

**Build:**
- Vite builds renderer to `dist/`
- Electron Builder packages `dist/` + `index.js` + `preload.js` + `src/ipc/` into desktop executables (AppImage, deb, rpm, pacman, nsis, dmg)

---

## B. What parts can be reused directly?

**Highly reusable (pure JS/React, no Electron):**

- **UI Components:** `src/components/*.jsx` (MediaCard, SearchModal, Sidebar, etc) — 90% reusable, only need to replace `window.electron` calls with abstraction
- **Pages:** `src/pages/*.jsx` (Home, Movie, TV, Library, Downloads, Settings) — reusable with platform abstraction
- **Utils (pure):**
  - `src/utils/api.js` — TMDB, AniList, PLAYER_SOURCES definitions, fetch logic (uses `fetch`, works on Android)
  - `src/utils/storage.js` — localStorage wrapper (works on Android, but secure store needs replacement)
  - `src/utils/backup.js` — backup/restore logic (uses JSON, works)
  - `src/utils/subtitles.js` — subtitle parsing (pure JS)
  - `src/utils/ageRating.js`, `aniSkip.js`, `episodeMappings.js`, `homeLayout.js`, `appearance.js`, `updates.js`, `useRatings.js`, `useAutoplay.js` — pure logic
  - `src/utils/externalPlayer/*` — our new pure-native Android bridge already works (headerHandler, streamResolver, playerRegistry, androidBridge, etc) — reusable for Expo
- **Styles:** `src/styles/global.css` + fonts — reusable

**Partially reusable (needs abstraction):**

- `src/App.jsx` — main app logic, but uses `window.electron` for backup, downloads, version, platform, close confirm, etc. Needs platform abstraction layer (we started with `src/utils/platform.js`)
- `src/utils/externalPlayer/externalPlayerAdapter.js` — already has desktop vs Android split, reusable
- `src/utils/externalPlayer/proxyServer.js` — split DesktopProxyServer vs AndroidNativeProxy, reusable

**Not reusable directly:**

- `index.js` (Electron main) — must be replaced
- `preload.js` (Electron contextBridge) — must be replaced
- `popout-preload.js` — Electron specific
- `src/ipc/*` (Electron main IPC handlers) — must be replaced with Expo modules or JS equivalents

**Reuse estimate:** ~70% of codebase can be reused if we create proper platform abstraction.

---

## C. What parts are Electron-only?

**Electron Main Process (`index.js`):**

- `BrowserWindow` creation, window lifecycle
- `session` setup: `setUserAgent`, `webRequest.onHeadersReceived` (strip X-Frame-Options, CSP), `onBeforeRequest` (ad blocking + m3u8/vtt intercept), YouTube consent cookie
- `ipcMain` handlers registration
- RAM flags: `js-flags --max-old-space-size`, `disable-features`, `NetworkServiceInProcess2`, `disk-cache-size`, `renderer-process-limit`
- Ad/tracker block list (50+ hosts)
- Scheduled backup trigger

**Preload (`preload.js`):**

- `contextBridge.exposeInMainWorld("electron", {...})` exposing 30+ IPC methods
- `ipcRenderer.on` for m3u8-found, subtitle-found, download-progress, confirm-close, etc
- `webFrame.setZoomFactor`

**IPC Handlers (`src/ipc/`):**

- `allmanga.js` — main-process HTTP POST to `api.allanime.day`, hex/AES decryption, yt-dlp integration, local http server for video (`setPlayerVideo`). Uses Node `https`, `http`, `child_process`, `fs`. **This is critical for anime.**
- `downloads.js` — yt-dlp + ffmpeg download via `spawn`, file system `fs`, `path`, progress events. Uses Node only.
- `storage.js` — secure store via Electron `safeStorage` (OS keychain)
- `subtitles.js` — search Wyzie API, download via Node `fs`, `https`
- `player.js` — spawn mpv/vlc, `which` check, `shell.openPath`, `openExternal`, window controls, auto-updater (GitHub/Codeberg release assets validation, download, install)
- `externalPlayer.js` (old) — desktop proxy via Node `http`, `https`, spawn. Our new version is desktop-only, Android uses Java.
- `blockStats.js` — in-memory blocked request counter
- `discordRpc.js` — Discord Rich Presence via `discord-rpc` npm

**Renderer Electron usage (`src/`):**

- `window.electron.*` calls everywhere: `onM3u8Found`, `onSubtitleFound`, `getDownloads`, `fileExists`, `pickFolder`, `openExternal`, `openPath`, `getAppVersion`, `onWebviewEnterFullscreen`, `getBlockStats`, `showNotification`, `quitApp`, `getCacheSize`, `clearAppCache`, `searchSubtitles`, `wyzieOpenRedeem`, `secureGet/Set`, `openPipWindow`, `windowMinimize`, `getPlatform`, `getVideoDuration`, `setZoomFactor`, `detectUpdateFormat`, `getScheduledBackupSettings`, etc — 50+ methods

**Conclusion:** ~30% of codebase is Electron-only and must be replaced.

---

## D. What Android architecture should replace Electron?

**Option 1: Capacitor (current implementation)**
- **Pros:** Web-based, reuses Vite build directly, minimal changes to React code, Java plugin system similar to Cordova, we already have working plugin `ExternalPlayerPlugin.java`
- **Cons:** WebView-based, not React Native, may have performance issues, not Expo, user has Expo/EAS not Capacitor
- **Status:** We implemented it, it works for external player, but not aligned with user's Expo/EAS setup

**Option 2: Expo + React Native + WebView (RECOMMENDED)**
- **Architecture:**
  ```
  Expo App (React Native)
  ├── React Native UI (reused Streambert components adapted to RN, or WebView wrapping existing React web app)
  ├── Expo Modules (custom native modules for external player, proxy, storage, etc)
  ├── Android Native (Java/Kotlin) for Intent, PackageManager, ServerSocket, file download
  └── EAS Build for APK
  ```
- **Two sub-options:**
  - **2a: Expo + WebView wrapper:** Keep existing React web app (`dist/`) inside `react-native-webview`, intercept m3u8 via WebView `onShouldStartLoadWithRequest` or injected JS, bridge to native via `window.ReactNativeWebView.postMessage`. Minimal UI rewrite, fastest.
  - **2b: Expo + React Native rewrite of UI:** Rewrite UI components to React Native (View, Text, etc), reuse logic (api.js, etc). More work, better native feel.
- **Pros:** User already has Expo/EAS, EAS can build dev APK early, custom native modules via config plugins, good Android integration, can use Expo Router, good for Play Store
- **Cons:** Need to adapt web React to React Native or use WebView, need to rewrite Electron IPC to Expo modules
- **Recommendation:** Start with **2a WebView wrapper** for fastest dev APK, then migrate to **2b** incrementally.

**Option 3: Pure React Native (no Expo)**
- Similar to Expo but without Expo tooling. User has Expo, so Expo is better.

**Option 4: Tauri / Neutralino / Other**
- Not relevant, user has Expo.

**RECOMMENDED ARCHITECTURE:**

```
Streambert Android = Expo App

├── Frontend:
│   ├── Option A (fast): WebView loading dist/index.html (existing Vite build)
│   │   ├── Injected JS to capture m3u8 URLs (replaces Electron webRequest)
│   │   └── postMessage to React Native for external player
│   └── Option B (long-term): React Native components (reuse logic from src/utils/api.js)
│
├── Bridge:
│   ├── Expo Config Plugin to add permissions & queries to AndroidManifest
│   ├── Custom Expo Module: ExternalPlayerModule (Java)
│   │   ├── getInstalledPlayers() -> PackageManager
│   │   ├── launchPlayer(url, packageName, mimeType, title, headers, subtitle) -> Intent
│   │   ├── startProxy(targetUrl, headers) -> AndroidProxyServer (ServerSocket)
│   │   ├── stopProxy()
│   │   ├── downloadSubtitle(url, fileName) -> HttpURLConnection
│   │   └── getSubtitleDir() -> /sdcard/Download/StreambertSubs or getExternalFilesDir
│   ├── Expo FileSystem for downloads (replaces Node fs)
│   ├── Expo SecureStore for secure storage (replaces safeStorage)
│   └── Expo modules for other features: notifications, etc
│
├── Stream Resolution:
│   ├── Keep PLAYER_SOURCES logic from api.js (JS, works)
│   ├── For m3u8 intercept: WebView with custom user agent + JS injection to detect video sources
│   │   - Inject script that observes <video> tags, XHR, fetch for .m3u8
│   │   - Or use WebView's onFileDownload / shouldOverrideUrlLoading
│   ├── For AllManga: Port allmanga.js from Node to JS (fetch + WebCrypto for AES) - possible, since it uses https and crypto, can be done in JS with subtle crypto
│   └── For headers: Use proxy when needed (Cookie/Auth) else intent extras
│
├── Storage:
│   ├── localStorage -> AsyncStorage (React Native) or keep localStorage in WebView
│   ├── Downloads -> Expo FileSystem + MediaLibrary
│   ├── History/Watchlist -> AsyncStorage or SQLite (expo-sqlite)
│   └── Backup/Restore -> FileSystem
│
└── Build:
    ├── Expo Dev Client (development APK with custom native code)
    ├── EAS Build: eas build --profile development --platform android
    ├── Install on device: adb install or Expo Go? No, need dev client for custom native
    └── Production: eas build --profile production --platform android
```

**Why Expo?**
- User already has Expo/EAS token and experience
- EAS can build dev APK early (critical for testing real device)
- Config plugins allow adding native permissions, queries, Java code
- Custom native modules are supported via `expo-modules`
- Can reuse JS logic (api.js, etc) directly

**Why not Capacitor for final?**
- User explicitly says they have Expo/EAS, not Capacitor
- Capacitor is web-only, Expo is more native and better for Play Store
- But our Capacitor plugin code can be adapted to Expo module (Java code is same, only bridge changes)

---

## E. Can Expo/EAS be used as the Android application/build system?

**YES, absolutely.**

- **Expo SDK:** Latest supports custom native modules via `expo-modules-core`, config plugins
- **EAS Build:** Can build APK with custom native code using development builds (`expo-dev-client`)
- **EAS Token:** User has token, can build via `eas build`
- **Development APK:** `eas build --profile development --platform android` creates dev client APK that includes custom native modules and can load JS via Expo
- **Production APK:** `eas build --profile production --platform android` creates final APK

**Steps to use Expo:**

1. Initialize Expo app: `npx create-expo-app StreambertAndroid` or `npx expo init`
2. Install `expo-dev-client`, `react-native-webview`, `expo-file-system`, `expo-secure-store`, `expo-sqlite`, etc
3. Create custom native module: `npx create-expo-module expo-external-player` with Java code (adapt our `ExternalPlayerPlugin.java`)
4. Create config plugin to add AndroidManifest permissions and queries
5. Copy Streambert `dist/` or `src/` logic
6. Build dev APK via EAS
7. Test on device
8. Iterate

**Potential issues:**

- Expo Go app cannot include custom native code, must use dev client
- Need to configure `eas.json` with development and production profiles
- Need to handle WebView vs React Native UI decision

**Conclusion:** Expo/EAS is not only possible, it's the best fit given user's existing setup.

---

## F. Which native Android modules are required?

**Essential (for external player):**

1. **ExternalPlayerModule (Java/Kotlin)**
   - `getInstalledPlayers()` — PackageManager query for `video/*` + known packages (VLC, MPV, MX, Just, etc)
   - `launchPlayer({url, packageName, mimeType, title, headers, subtitle})` — Intent ACTION_VIEW with chooser, extras for title, Referer, User-Agent, subtitles_location x9
   - `startProxy({targetUrl, headers, subtitleUrl})` — ServerSocket 127.0.0.1:0, host validation, HLS rewrite, Range, watchdog
   - `stopProxy()`
   - `downloadSubtitle({url, fileName, headers})` — HttpURLConnection to shared storage
   - `getSubtitleDir()` — returns path
   - **We already have this as `ExternalPlayerPlugin.java` + `AndroidProxyServer.java`, just need to adapt from Capacitor `@CapacitorPlugin` to Expo `@ExpoModule`

2. **Storage Module**
   - For downloads, history, etc. Can use Expo FileSystem, but may need custom for performance
   - `expo-file-system` for file operations
   - `expo-media-library` for saving to Downloads
   - `expo-sqlite` or `AsyncStorage` for history/watchlist

3. **Secure Storage**
   - `expo-secure-store` for API keys (TMDB, Wyzie)

4. **Other (optional but good):**
   - `expo-notifications` for download complete
   - `expo-screen-orientation` for player
   - `expo-keep-awake` during playback
   - `expo-intent-launcher` (existing library) could be used instead of custom, but custom gives more control for headers/subs

**Permissions needed (AndroidManifest.xml):**

- `INTERNET` — for API, streaming, proxy, subs
- `WRITE_EXTERNAL_STORAGE` (maxSdk 28) + `READ_EXTERNAL_STORAGE` (maxSdk 32) — for subtitle file in public Downloads (or use `getExternalFilesDir` to avoid)
- `READ_MEDIA_VIDEO` (Android 13+) for downloads
- `<queries>` for video players (Android 11+ package visibility):
  ```xml
  <queries>
    <intent><action android:name="android.intent.action.VIEW" /><data android:mimeType="video/*" /></intent>
    <intent><action android:name="android.intent.action.VIEW" /><data android:mimeType="video/mp4" /></intent>
    <intent><action android:name="android.intent.action.VIEW" /><data android:mimeType="application/x-mpegURL" /></intent>
    <package android:name="org.videolan.vlc" />
    <package android:name="is.xyz.mpv" />
    <package android:name="com.mxtech.videoplayer.ad" />
    ...
  </queries>
  ```

---

## G. How will external players be launched?

**Same as our current pure-native implementation, adapted to Expo:**

1. **Detection:**
   ```java
   PackageManager pm = context.getPackageManager();
   // Known packages
   for (String pkg : KNOWN_PLAYERS) {
     try { pm.getPackageInfo(pkg, 0); installed.add(pkg); } catch (NameNotFoundException e) {}
   }
   // Custom players via queryIntentActivities
   Intent intent = new Intent(Intent.ACTION_VIEW); intent.setType("video/*");
   List<ResolveInfo> activities = pm.queryIntentActivities(intent, MATCH_DEFAULT_ONLY);
   // Filter for video/player keywords
   ```

2. **Launch:**
   ```java
   Intent intent = new Intent(Intent.ACTION_VIEW);
   intent.setDataAndType(Uri.parse(url), mimeType); // video/* or application/x-mpegURL
   intent.addFlags(FLAG_ACTIVITY_NEW_TASK | FLAG_GRANT_READ_URI_PERMISSION);
   if (packageName != null && !packageName.equals("system-default")) {
     intent.setPackage(packageName);
   }
   if (title != null) {
     intent.putExtra("title", title);
     intent.putExtra(EXTRA_TITLE, title);
   }
   if (headers != null) {
     if (headers.has("User-Agent")) intent.putExtra("User-Agent", ua);
     if (headers.has("Referer")) intent.putExtra("Referer", ref);
   }
   if (subtitle != null) {
     // 9 keys for compatibility
     intent.putExtra("subtitles_location", subtitle);
     intent.putExtra("subs", subtitle);
     intent.putExtra("sub", subtitle);
     intent.putExtra("title_subtitle", subtitle);
     intent.putExtra("subs.enable", subtitle);
     // + --eu and --esal via Bundle?
     // Actually via putExtra with String and ArrayList
     ArrayList<String> list = new ArrayList<>(); list.add(subtitle);
     intent.putStringArrayListExtra("subs", list);
     intent.putStringArrayListExtra("subs.enable", list);
   }
   if (packageName == null) {
     Intent chooser = Intent.createChooser(intent, "Play with");
     startActivity(chooser);
   } else {
     startActivity(intent);
   }
   ```

3. **Fallback:** Intent URI `intent:url#Intent;action=VIEW;type=video/*;package=...;S.title=...;end` via `window.location.href` or `Linking.openURL` in React Native

**Player-specific extras (from MovieBox-TUI docs/players.md):**

- VLC: supports `subtitles_location`, `subs`, `sub`, `title_subtitle`, `User-Agent`, `Referer` via extras
- MPV: `subs`, `subtitles_location`, `subs.enable`
- MX Player: `subs`, `subtitles_location` (ignores Referer often, needs proxy)
- Just Player: `subs`, `subtitles_location`

**Our implementation already handles this in `ExternalPlayerPlugin.java` and `androidIntent.js`**

---

## H. How will headers/cookies/referer be handled?

**Current Streambert headers (from headerHandler.js, STREAM_HEADERS_ANALYSIS.md):**

- User-Agent: Chrome 124
- Referer: embed URL (e.g., https://www.vidking.net/embed/movie/123)
- Origin: origin of embed URL
- Cookie: CloudFront signed cookies (for some providers like MovieBox DASH, not currently in Streambert but may appear)
- Authorization: Bearer tokens (if any)

**Android Intent limitations:**

- Can pass User-Agent and Referer via `S.User-Agent` and `S.Referer` extras — VLC, MPV, Just Player respect these
- Cannot pass Cookie, Authorization, Origin via intent extras
- MX Player often ignores Referer extra

**Solution (same as MovieBox-TUI):**

1. **Direct Intent (no proxy) when:**
   - Only UA and Referer needed
   - Player supports headers (VLC, MPV, Just) and not MX with Referer
   - No Cookie/Auth

2. **Local Proxy (mandatory) when:**
   - Cookie or Authorization present
   - Custom headers beyond UA, Accept, Referer, Origin
   - Player doesn't support Referer (MX) and Referer needed
   - HLS with Referer for MX (recommended)

**Proxy architecture:**

```
Remote Server (requires Cookie)
  ↓ (request with Cookie, Referer, UA)
AndroidProxyServer (127.0.0.1:random)
  - Validates host == targetHost else 403
  - Injects headers server-side
  - Rewrites HLS playlist: segment.ts -> http://127.0.0.1:port/https/host/segment.ts
  - Forwards Range header for seeking
  ↓
Proxy URL http://127.0.0.1:port/https/host/path
  ↓
VLC/MX Player (fetches via proxy, no headers needed)
```

**Implementation:** `AndroidProxyServer.java` already does this, mirrors MovieBox-TUI `proxy.rs`

**For Expo:** Same Java code, just wrapped as Expo module.

---

## I. Is a local proxy required?

**YES, but only for protected streams.**

- **Not required for:** Most Streambert streams (VidKing, Videasy, VidSrc normal) which only need Referer + UA — direct Intent works for VLC/MPV/Just
- **Required for:**
  - Cookie-protected (CloudFront) — mandatory for all players
  - Authorization header — mandatory
  - MX Player with Referer — recommended (MX ignores Referer extra)
  - Origin header if required (cannot via intent)

**Decision logic (headerHandler.js):**

```js
function needsProxy(headers, player) {
  if (headers.Cookie || headers.Authorization) return true;
  if (custom headers beyond UA, Accept, Referer, Origin) return true;
  if (player && !player.supportsHeaders && headers.Referer) return true;
  return false;
}
```

**Our implementation already has this logic and real proxy.**

**For Expo:** Keep proxy, it's essential for protected streams.

---

## J. How will subtitles work?

**Current Streambert:**

- Embedded: Player handles
- External: Wyzie API search, download via Node fs to local file, pass to mpv/vlc via `--sub-file` or similar
- For Android external player: Download to `/sdcard/Download/StreambertSubs/Movie.en.vtt`, pass via 9 intent extras

**Android implementation (our code):**

1. **Download:**
   ```java
   // In ExternalPlayerPlugin.java
   HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
   conn.setRequestProperty("Referer", referer);
   conn.setRequestProperty("User-Agent", ua);
   InputStream in = conn.getInputStream();
   FileOutputStream out = new FileOutputStream("/sdcard/Download/StreambertSubs/fileName");
   // copy
   ```

2. **Extras (9 keys for compatibility, from MovieBox-TUI):**
   - `subtitles_location` (String) + `--eu` (URI)
   - `subs` (String) + `--esal` (StringArrayList)
   - `subs.enable` + `--esal`
   - `sub` + `--eu`
   - `title_subtitle`
   - `subs.name`, `subs.filename`, `sub.filename`, `subs:1`

3. **Storage:**
   - Current: `/sdcard/Download/StreambertSubs/` (public Downloads, needs WRITE_EXTERNAL_STORAGE on Android 9 and below, works on 10+ with MediaStore or scoped storage)
   - Better for Android 10+ scoped storage: `context.getExternalFilesDir(null)/StreambertSubs` (app-private, no permission needed, but players may not scan it)
   - VLC scans Downloads automatically, so public path is more compatible
   - Alternative: Use `MediaStore` API for Android 10+

**For Expo:** Use `expo-file-system` to download, or keep Java download. Pass file path via intent extras.

**Our code already implements this in `subtitleHandler.js` and `ExternalPlayerPlugin.java`**

---

## K. What APIs are required?

**From src/utils/api.js audit:**

1. **TMDB API** `https://api.themoviedb.org/3`
   - Required: Yes, for all movie/TV metadata, search, trending, seasons, episodes
   - Key: Required, stored in secure storage (Expo SecureStore)
   - Rate limit: 40 requests per 10 seconds (we have queue with max 4 concurrent)
   - Cache: In-memory + localStorage, 5 min TTL
   - Android impact: Works via fetch, no change needed, just need to store key securely

2. **AniList API** `https://graphql.anilist.co`
   - Required: For anime metadata (when TMDB genre 16 Animation + JP)
   - Key: No key, public GraphQL
   - Cache: localStorage, 7 days TTL
   - Android impact: Works via fetch

3. **PLAYER_SOURCES (no API key):**
   - VidKing `https://www.vidking.net/embed/...` — embed URL, no key, returns HLS via webview intercept
   - Videasy `https://player.videasy.to/...` — embed URL, no key, HLS
   - VidSrc `https://vsembed.su/embed/...` — embed URL, no key, HLS, needs intercept (NEEDS_INTERCEPT = ["vidsrc"] — strips X-Frame-Options, CSP)
   - AllManga `https://allmanga.to` + `api.allanime.day/api` — no key, but needs main-process HTTP bypass + decryption (hex cipher + AES-256-CTR). Currently Node only, needs port to JS.

4. **Wyzie API** (subtitles, optional)
   - Required: No, but for subtitles
   - Key: Optional, needs redemption via `wyzie-open-redeem` (Electron shell open external)
   - Android impact: Works via fetch, key stored securely

5. **Other:**
   - YouTube for trailers — embed, no key
   - Discord RPC — optional, not needed on Android

**All APIs work via fetch, so Android can reuse directly. Only AllManga resolver needs port from Node to JS (possible with WebCrypto).**

---

## L. What is the minimum development APK architecture?

**Minimum viable dev APK for testing external player:**

```
Expo App (blank + WebView + ExternalPlayerModule)

├── App.js:
│   ├── WebView loading https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8 or Streambert dist/index.html
│   ├── Button "Detect Players" -> calls ExternalPlayerModule.getInstalledPlayers()
│   ├── Button "Play in VLC" -> calls ExternalPlayerModule.launchPlayer({url, packageName: "org.videolan.vlc"})
│   └── Button "Play via Proxy" -> startProxy + launchPlayer with proxy URL
│
├── Native Module:
│   ├── ExternalPlayerModule.java (from our ExternalPlayerPlugin.java adapted)
│   └── AndroidProxyServer.java (same)
│
├── AndroidManifest.xml:
│   ├── INTERNET permission
│   └── <queries> for video players
│
└── Build:
    ├── expo-dev-client
    ├── eas.json with development profile
    └── EAS Build -> APK
```

**Even more minimal (no Streambert UI yet):**

- Expo app with 2 buttons: Detect Players and Play Test Video (Big Buck Bunny MP4 + HLS)
- Tests PackageManager detection and Intent launch
- Proves native bridge works
- Then add Streambert UI

**Steps:**

1. `npx create-expo-app StreambertAndroid --template blank`
2. `npx expo install expo-dev-client react-native-webview`
3. `npx create-expo-module expo-external-player --local` (creates local module)
4. Copy Java code from `ExternalPlayerPlugin.java` to module's `android/src/main/java/expo/modules/externalplayer/ExternalPlayerModule.kt` (or Java)
5. Create config plugin for AndroidManifest
6. Write App.js with test buttons
7. `eas build --profile development --platform android` (needs EAS token, user has it)
8. Install APK on device via `adb install` or EAS link
9. Test detection and playback with VLC

**After that works, add Streambert:**

- Copy `dist/` to Expo assets or load via WebView
- Implement message bridge between WebView and React Native for stream URL
- Or rewrite UI to React Native incrementally

---

## M. What needs to be implemented before the first development APK?

**Phase 0 (Already done):**
- [x] Fork Streambert and MovieBox-TUI
- [x] Audit Streambert and MovieBox-TUI
- [x] Implement pure-native external player bridge (Capacitor version, can be adapted to Expo)
- [x] Build verification (vite build, unit tests, Java compilation)

**Phase 1 (For first dev APK):**

1. **Expo app init:**
   - [ ] `npx create-expo-app` or use existing `streambert-fork` as base and add Expo
   - [ ] Install `expo-dev-client`, `react-native-webview`, `expo-file-system`, `expo-secure-store`
   - [ ] Configure `app.json` / `app.config.js` with appId `com.truelockmc.streambert`, name Streambert, permissions

2. **Custom native module:**
   - [ ] Create local Expo module `expo-external-player` (or `expo-modules` structure)
   - [ ] Adapt `ExternalPlayerPlugin.java` to Expo module:
     - Change from `@CapacitorPlugin` to `@ExpoModule` / `ModuleDefinition`
     - Methods: `getInstalledPlayers`, `launchPlayer`, `startProxy`, `stopProxy`, `downloadSubtitle`, `getSubtitleDir`
   - [ ] Copy `AndroidProxyServer.java` as is (no Expo dependency, pure Java)
   - [ ] Create config plugin to add AndroidManifest permissions and queries

3. **Minimal UI for testing:**
   - [ ] App.js with:
     - TextInput for test URL (default Big Buck Bunny MP4 and HLS)
     - Button Detect Players -> shows list
     - Button Play in VLC / MPV / MX / System Chooser
     - Button Play via Proxy (tests proxy)
     - Button Test Subtitle download
   - [ ] No Streambert UI yet, just native bridge test

4. **EAS Build setup:**
   - [ ] `eas.json` with development profile (dev client)
   - [ ] `eas build --profile development --platform android` using user's EAS token
   - [ ] Get APK link

5. **Device test:**
   - [ ] Install dev APK on physical Android device
   - [ ] Install VLC, MPV, MX Player from Play Store
   - [ ] Test detection, launch, playback, proxy, subtitles
   - [ ] Record results in `ANDROID_DEVICE_VERIFICATION.md`

**Phase 2 (After dev APK works):**

6. **Streambert integration:**
   - [ ] Copy Streambert `dist/` to Expo app's assets or serve via WebView
   - [ ] Implement WebView wrapper that loads Streambert UI
   - [ ] Bridge m3u8 detection from WebView to React Native (via `onMessage` / injected JS)
   - [ ] Connect stream URL to ExternalPlayerModule.launchPlayer
   - [ ] Test full flow: Search -> Movie -> Source -> Stream URL -> External Player -> Video Plays

7. **Port remaining Electron features:**
   - [ ] Storage: localStorage -> AsyncStorage or keep in WebView
   - [ ] Secure storage: `expo-secure-store` for TMDB key
   - [ ] Downloads: `expo-file-system` + `expo-media-library` (or keep disabled initially)
   - [ ] AllManga resolver: Port from Node to JS (fetch + WebCrypto for AES)
   - [ ] History/Watchlist/Library: AsyncStorage or SQLite
   - [ ] Settings: reuse SettingsPage.jsx
   - [ ] Backup/Restore: FileSystem

8. **Iterate dev APKs:**
   - [ ] Build new dev APK after each major feature
   - [ ] Test on device
   - [ ] Fix bugs

9. **Production APK:**
   - [ ] After stable, `eas build --profile production --platform android`
   - [ ] Sign with keystore, publish to Play Store or direct APK

---

## Summary & Recommendation

**Current status:**
- We have pure-native Android external player implementation using Capacitor (works, but user has Expo/EAS)
- Java code (`ExternalPlayerPlugin.java`, `AndroidProxyServer.java`) is 90% reusable for Expo module (only bridge annotation changes)
- JS code (`androidBridge.js`, etc) is reusable for Expo (just change from `window.Capacitor.Plugins` to `expo-modules` import)

**Recommended next steps:**

1. **Create Expo app** (or convert existing `streambert-fork` to Expo app) with dev client
2. **Create Expo native module** `expo-external-player` adapting our Java code
3. **Build minimal dev APK** testing only native bridge (detect + launch)
4. **Test on real device** with VLC/MPV/MX
5. **Add Streambert UI via WebView** and connect stream resolver
6. **Iterate**

**Why this is correct:**

- Preserves 70% of Streambert code (React components, api.js, etc)
- Replaces only Electron-specific parts (30%)
- Uses user's existing Expo/EAS infrastructure
- Allows early dev APK for real device testing (critical)
- External player is the correct architecture for Android (no need to implement own decoder)
- Proxy is required only for protected streams (Cookie/Auth/MX+Referer), not for all
- Subtitles work via file + intent extras (9 keys)

**What we should NOT do:**

- Rewrite Streambert from scratch
- Create new streaming app inspired by Streambert
- Convert Windows .exe to APK (impossible)
- Ignore existing Streambert logic
- Fake success without real device test

**Final objective remains:**

```
Android APK (Expo/EAS)
  → Streambert (reused logic + Android compatibility layer)
  → real APIs (TMDB, AniList, VidKing, etc)
  → real stream resolution (WebView intercept + AllManga port)
  → real external player (VLC/MPV/MX via Intent)
  → real video playback
```

---

## Appendix: File Mapping for Expo

| Streambert (Electron) | Expo Android (proposed) |
|-----------------------|-------------------------|
| `index.js` (Electron main) | `App.js` (Expo entry) + `app.json` config |
| `preload.js` (contextBridge) | Expo modules + WebView `postMessage` bridge |
| `src/ipc/player.js` (spawn mpv/vlc) | `ExternalPlayerModule.java` (Intent) |
| `src/ipc/externalPlayer.js` (Node proxy) | `AndroidProxyServer.java` (Java proxy) + Expo module |
| `src/ipc/downloads.js` (yt-dlp) | `expo-file-system` + `expo-media-library` (or disable initially) |
| `src/ipc/storage.js` (safeStorage) | `expo-secure-store` |
| `src/ipc/subtitles.js` (Node fs) | `ExternalPlayerModule.downloadSubtitle` (Java) + `expo-file-system` |
| `src/ipc/allmanga.js` (Node http + crypto) | JS port using `fetch` + `WebCrypto` (or keep Node-like via custom module) |
| `src/utils/api.js` (TMDB, etc) | Reuse directly (fetch works) |
| `src/components/*.jsx` | Reuse in WebView or rewrite to RN |
| `src/pages/*.jsx` | Reuse in WebView or rewrite |
| `src/utils/externalPlayer/*` | Reuse, adapt bridge from Capacitor to Expo |

---

**End of Architecture Report**

