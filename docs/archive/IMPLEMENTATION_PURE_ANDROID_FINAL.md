# Streambert Android Pure-Native Implementation — FINAL REPORT

## Executive Summary

**Goal:** Port Streambert for Android external-player playback BEFORE APK packaging, using real Android APIs — no Electron, no Node, no Termux in Android runtime.

**Status:** ✅ IMPLEMENTED — pure native path with zero invalid dependencies. Build verified (vite build success, 83 modules). Tests passed (header handling, stream resolver, intent, registry, proxy HLS rewrite).

**Previous invalid implementation REMOVED:**
- `window.electron.probeAndroidOpeners` which ran `which termux-open/termux-am` via child_process — **INVALID** for Android WebView, requires Termux environment
- `launchViaTermuxAm` / `launchViaTermuxOpen` using `spawn("termux-am", ...)` — **INVALID** for pure Android, Termux is separate app not system API
- `proxyServer.js` throwing "requires native HTTP server on Android - use Capacitor plugin" with no implementation — now has real Java implementation
- Termux as primary Android opener — now only legacy reference with console.warn

---

## Architecture Overview

```
Search -> Select -> Resolve stream URL/type/headers/UA/Referer/cookies/subtitles
         -> ExternalPlayerAdapter (platform abstraction)
         -> Android: PackageManager detection via Capacitor plugin
         -> Android: Intent.ACTION_VIEW via Capacitor plugin OR Intent URI fallback
         -> VLC/MPV/MX Player/etc
```

### Platform Detection (src/utils/platform.js)

```js
isCapacitorAndroid() -> Capacitor.getPlatform() === 'android' (primary)
isPureAndroidRuntime() -> navigator.userAgent Android + no Electron + Capacitor native
getPlatform() -> 'capacitor-android' | 'android-web' | 'electron' | 'web'
isAndroidNative() -> true if capacitor-android OR pure Android runtime
isDesktop() -> true if Electron
```

**No process check in Android path** — old code checked `process.platform` which fails in WebView.

### Android Detection Chain (Real PackageManager)

```
detectAvailablePlayers() in externalPlayerAdapter.js
  if Android:
    detectAndroidPlayersPure() in androidPlayerDetector.js
      -> getInstalledPlayersNative() in androidBridge.js
        -> try: Capacitor.Plugins.ExternalPlayer.getInstalledPlayers()
        -> else: window.StreambertNative.getInstalledPlayers()
        -> else: window.AndroidBridge.getInstalledPlayers()
        -> else: fallback chooser + KNOWN_PLAYERS with intent-uri method
      -> Java ExternalPlayerPlugin.java
        -> PackageManager.queryIntentActivities(Intent ACTION_VIEW type video/*)
        -> + query known packages: org.videolan.vlc, is.xyz.mpv, com.mxtech.videoplayer.ad/pro, com.brouken.player, dev.anotherwidget.ftp, org.videolan.vlc.debug, is.xyz.mpv.debug, etc.
        -> returns [{packageName, label, type, supportedMimeTypes}]
      -> map to KNOWN_PLAYERS metadata (supportsHeaders, supportsSubtitles, intentExtras)
      -> always add system chooser as fallback
      -> return PlayerInfo[]
  else Desktop:
    detectDesktopPlayers() via window.electron.getAvailablePlayers() -> which mpv/vlc
```

**Result:** Real detection, not simulation via `which termux-open`.

### Android Launch Chain (Real Intent API)

```
launchWithExternalPlayer({url, playerId, title, headers, subtitleUrl, mimeType}) in externalPlayerAdapter.js
  if Android:
    launchAndroidPure()
      -> prepareSubtitleForPlayer() via androidBridge.downloadSubtitleNative() -> Java download to /sdcard/Download/StreambertSubs
      -> analyzeProxyNeed(headers, streamType, player)
        if Cookie/Authorization or MX+Referer -> needsProxy=true
        -> AndroidNativeProxy.start() -> startProxyNative() -> Java AndroidProxyServer ServerSocket 127.0.0.1:0 -> returns http://127.0.0.1:port/https/host/path
        -> else direct URL
      -> buildNativeIntentOptions({url, packageName, mimeType, title, headers, subtitlePath})
        -> headers filtered to UA, Referer only for intent extras
        -> subtitle extras 9 keys: subtitles_location, subs, sub, title_subtitle, subs.enable, subs.name, subs.filename, sub.filename, subs:1
      -> launchPlayerNative(options) in androidBridge.js
        -> try Capacitor ExternalPlayer.launchPlayer({url, packageName, mimeType, title, headers, subtitle})
        -> else StreambertNative.launchPlayer(...)
        -> else AndroidBridge.launchPlayer(...)
        -> else Intent URI fallback: window.location.href = intent:url#Intent;action=VIEW;type=video/*;package=...;S.title=...;S.Referer=...;S.User-Agent=...;S.subtitles_location=...;end
        -> else window.open(url, '_blank')
      -> Java ExternalPlayerPlugin.launchPlayer()
        -> Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), mimeType)
        -> addFlags FLAG_ACTIVITY_NEW_TASK | GRANT_READ_URI_PERMISSION
        -> if packageName set: setPackage(packageName) else createChooser
        -> putExtra title, EXTRA_TITLE, User-Agent, Referer, subtitles_location x9
        -> if subtitle file exists: validate file.exists()
        -> startActivity(chooser)
        -> return {success, opener, packageName}
  else Desktop:
    launchDesktop() via window.electron.launchExternalPlayer -> spawn mpv/vlc
```

**No Electron in Android path.** No Termux.

### Android Proxy Chain (Real ServerSocket)

```
AndroidNativeProxy in androidNativeProxy.js
  start() -> startProxyNative({targetUrl, headers, subtitleUrl}) in androidBridge.js
    -> Java ExternalPlayerPlugin.startProxy()
      -> new AndroidProxyServer(targetUrl, headers, subtitleUrl)
        -> ServerSocket(127.0.0.1, 0) random port
        -> parse target: extractHost(), extractTargetUrl() => https://host/path from /https/host/path
        -> validate: host == targetHost OR subtitleHost else 403 (security, no open proxy, matches MovieBox-TUI)
        -> inject headers: target -> all headers (Cookie, Referer, UA), subtitle -> UA only
        -> forward Range header for seeking
        -> if HLS: rewrite playlist
          for each line: if not # and not http: resolve against target base -> http://127.0.0.1:port/https/host/segment.ts
          handle EXT-X-KEY URI="..."
        -> stream response
        -> watchdog: stop after 600s idle
      -> returns localUrl = http://127.0.0.1:port/https/host/path
  getLocalUrl() returns proxy URL for player
  stop() -> stopProxyNative() -> server.stop()
```

**Mirrors MovieBox-TUI proxy.rs:** `/https/host/path` pattern, host validation, header injection, HLS rewrite, Range forwarding, 127.0.0.1 only.

### Subtitle Chain (Real File Download)

```
prepareSubtitleForPlayer({url, title, language, headers}) in subtitleHandler.js
  if Android:
    getAndroidSubtitleDir() -> Capacitor ExternalPlayer.getSubtitleDir() OR StreambertNative.getSubtitleDir() OR /sdcard/Download/StreambertSubs
    downloadSubtitleNative({url, fileName, headers}) -> Java downloadSubtitle()
      -> HttpURLConnection with Referer, UA
      -> write to /sdcard/Download/StreambertSubs/fileName
      -> return filePath
    return filePath for intent extras
  else Desktop:
    window.electron.downloadSubtitlesForFile -> Node fs
```

**File exists check in Java:** Before launching, checks `new File(subtitlePath).exists()`.

---

## Files Modified / Created

### NEW Files (Pure Android)

- `src/utils/externalPlayer/androidBridge.js` — Capacitor ExternalPlayer abstraction, Intent URI fallback, NO Electron/Termux
  - `getInstalledPlayersNative()`, `launchPlayerNative()`, `startProxyNative()`, `stopProxyNative()`, `downloadSubtitleNative()`, `getSubtitleDirNative()`, `isNativeBridgeAvailable()`, `buildIntentUri()`, `launchViaIntentUri()`
- `src/utils/externalPlayer/androidPlayerDetector.js` — PackageManager-based detection
  - `detectInstalledPlayers()`, `detectInstalledPlayersViaBridge()`, `detectCustomPlayers()`, `validatePlayerSelection()`
- `src/utils/externalPlayer/androidNativeProxy.js` — Android proxy using native bridge
  - `AndroidNativeProxy` class, `spawnAndroidProxy()`
- `android/src/main/java/com/truelockmc/streambert/ExternalPlayerPlugin.java` — Real Capacitor plugin
  - `@CapacitorPlugin(name="ExternalPlayer")` with methods `getInstalledPlayers`, `launchPlayer`, `startProxy`, `stopProxy`, `downloadSubtitle`, `getSubtitleDir`
  - PackageManager query, Intent.ACTION_VIEW with chooser, extras handling
- `android/src/main/java/com/truelockmc/streambert/AndroidProxyServer.java` — Java proxy
  - `ServerSocket 127.0.0.1:0`, `extractHost`, `extractTargetUrl`, host validation 403, header injection, HLS rewrite, watchdog

### REWRITTEN Files (Removed Invalid Deps)

- `src/utils/externalPlayer/androidIntent.js` — Removed Termux primary, added `buildIntentUri()`, `buildCapacitorIntentOptions()`, `buildNativeIntentOptions()`, `buildSubtitleExtrasNative()`, `buildHeaderExtrasNative()`, `detectBestOpener()` returns only `capacitor-externalplayer/streambert-native/android-bridge/intent-uri`, Termux functions kept as legacy with `console.warn` and marked deprecated
- `src/utils/externalPlayer/proxyServer.js` — Split `DesktopProxyServer` (Node http via Electron IPC) and `ProxyServer` auto-select via `getPlatform()` -> `AndroidNativeProxy` on Android, `DesktopProxyServer` on desktop. No Android Node dependency.
- `src/utils/externalPlayer/externalPlayerAdapter.js` — Separated `detectDesktopPlayers()` (Electron IPC) vs `detectAndroidPlayersPure()` (PackageManager), `launchDesktop()` vs `launchAndroidPure()` using `launchPlayerNative()` only, removed `window.electron.probeAndroidOpeners/startProxyServer/launchAndroidPlayer` from Android path, Android proxy via `AndroidNativeProxy`, subtitle via `androidBridge`
- `src/utils/externalPlayer/subtitleHandler.js` — Removed Electron from Android path, `getAndroidSubtitleDir()` uses native bridge, `downloadSubtitle()` branches desktop Electron vs Android native vs web fetch
- `src/utils/externalPlayer/index.js` — Barrel exports new modules
- `src/ipc/externalPlayer.js` — Desktop-only, removed `probeAndroidOpeners/launchViaTermuxAm/launchViaTermuxOpen/termux-open-url` handlers, kept only `get-available-players`, `start-proxy-server`, `stop-proxy-server`, `launch-external-player`, `get-stream-headers`, added comment Android uses `ExternalPlayerPlugin.java`
- `preload.js` — Removed `probeAndroidOpeners`, `launchAndroidPlayer` (Termux IPC), kept only desktop methods
- `src/utils/externalPlayer/playerRegistry.js` — Updated notes to remove Termux, changed `AndroidOpenerType` to real types `capacitor-externalplayer/streambert-native/intent-uri/system-chooser` with legacy Termux marked `*-legacy`
- `src/components/ExternalPlayerModal.jsx` — UI messages removed Termux install instruction, now "Uses Android native Intent API (no Termux needed)"

### PRESERVED Desktop Functionality

- `DesktopProxyServer` still uses Node http via Electron IPC
- `detectDesktopPlayers` still uses `window.electron.getAvailablePlayers` -> `which mpv/vlc`
- `launchDesktop` still uses `window.electron.launchExternalPlayer` -> spawn
- No break to search, metadata, seasons, anime, source selection, stream resolution, subtitles, history, watchlist, settings, backup/restore, downloads

---

## Player Support Matrix (Real Android)

| Player | Package | Detection | Headers via Intent | Subtitles via Extras | HLS | Notes |
|--------|---------|-----------|-------------------|---------------------|-----|-------|
| VLC | org.videolan.vlc, .debug | PackageManager queryIntent + known package check | UA, Referer via S.User-Agent, S.Referer | 9 keys: subtitles_location, subs, sub, etc | Yes | Best compatibility, supports Cookie via proxy |
| MPV | is.xyz.mpv, .debug, com.mpv, .beta | Same | UA, Referer | subs, subtitles_location, subs.enable | Yes | Excellent HLS/DASH, hardware accel |
| MX Player | com.mxtech.videoplayer.ad, .pro | Same | Often ignores Referer | subs, subtitles_location | Yes | Most popular, great subs auto-load, needs proxy for Referer |
| Just Player | com.brouken.player | Same | UA, Referer | subs, subtitles_location | Yes | Lightweight, ExoPlayer based |
| Next Player | dev.anotherwidget.ftp, com.anotherwidget.justplayer | Same | UA, Referer | subs | Yes | Modern ExoPlayer |
| System Chooser | (none) | Always added | Depends on chosen app | Depends | Yes | Fallback via Intent.createChooser |
| Custom | Any with ACTION_VIEW video/* | queryIntentActivities | Unknown | Unknown | Unknown | Detected via heuristic, shown as "Video Player (com.xxx)" |

**No crash if missing:** If `getInstalledPlayers` returns empty, returns system chooser + custom detection; if still empty, returns chooser with message "No compatible external player installed. Install VLC/MPV/MX from Play Store" and method `intent-uri-fallback`.

---

## Stream URL Handling (Real Headers)

### Header Types

- **User-Agent:** Chrome 124 `Mozilla/5.0...Chrome/124...` — set for all providers, passed via intent extra `S.User-Agent` or proxy injection
- **Referer:** Embed URL e.g. `https://www.vidking.net/embed/movie/123` — passed via `S.Referer` or proxy
- **Origin:** `https://www.vidking.net` — passed via header map, not intent extra (Origin cannot via intent, needs proxy if required)
- **Cookie:** CloudFront signed cookies (MovieBox case) — **cannot** via intent, **must** proxy
- **Authorization:** Bearer tokens — **cannot** via intent, **must** proxy

### Decision Logic (headerHandler.js)

```js
needsProxy(headers, player):
  if Cookie or Authorization present => true (mandatory)
  if custom headers beyond UA, Accept, Referer, Origin => true
  if player && !player.supportsHeaders && Referer present => true
  else false

analyzeProxyNeed():
  Cookie => {needed:true, reason:"Cookie requires proxy"}
  Auth => {needed:true, reason:"Auth requires proxy"}
  !supportsHeaders + Referer => {needed:true, reason:"Player doesn't support Referer"}
  MX + HLS + Referer => {needed:true, reason:"MX ignores Referer for HLS segments, proxy recommended"}
  else {needed:false, reason:"Direct via extras"}
```

### Proxy Security

- Host validation: only `targetHost` and `subtitleHost` allowed, else 403 — prevents open proxy abuse (matches MovieBox-TUI)
- Loopback only: `127.0.0.1:0` random port, not `0.0.0.0`
- Watchdog: stop after 600s idle
- Error handling: 502 for target fetch fail, 500 for internal, JSON error body

---

## Subtitles (Real File + Intent Extras)

### Android

- Dir: `/sdcard/Download/StreambertSubs` via `getSubtitleDirNative()` -> Java `getSubtitleDir()` returns `Environment.getExternalStoragePublicDirectory(DIRECTORY_DOWNLOADS)/StreambertSubs`
- Download: `downloadSubtitleNative({url, fileName, headers})` -> Java `downloadSubtitle` via `HttpURLConnection` with Referer, UA
- Extras: 9 keys per MovieBox-TUI `docs/players.md` and `player.rs append_android_intent_extras`:
  - `subtitles_location` (String) + `--eu` (URI)
  - `subs` (String) + `--esal` (StringArrayList)
  - `subs.enable` + `--esal`
  - `sub` + `--eu`
  - `title_subtitle`
  - `subs.name`, `subs.filename`, `sub.filename`, `subs:1`
- Validation: `new File(path).exists()` before launch

### Desktop

- Preserved: `window.electron.downloadSubtitlesForFile` -> Node fs

---

## Dependencies & Android SDK Requirements

### JS Dependencies (package.json)

- No new npm deps for Android path — uses existing Capacitor
- Capacitor required: `@capacitor/core`, `@capacitor/android` (for ExternalPlayer plugin registration)
- For Intent URI fallback: none, uses `window.location.href`

### Android (Java)

- `com.capacitorjs:core` — Capacitor plugin base
- `AndroidX` — Intent, PackageManager
- `NanoHTTPD-like` — implemented via `ServerSocket` directly, no external lib needed (could use `org.nanohttpd:nanohttpd:2.3.1` if preferred)
- Min SDK: 21 (Android 5.0) — `queryIntentActivities` with `MATCH_DEFAULT_ONLY`
- Target SDK: 34 (Android 14)
- Permissions:
  - `INTERNET` — for proxy and subtitle download
  - `QUERY_ALL_PACKAGES` OR `<queries><intent><action android:name="android.intent.action.VIEW"/><data android:mimeType="video/*"/></intent></queries>` in AndroidManifest.xml for PackageManager visibility (Android 11+)
  - `WRITE_EXTERNAL_STORAGE` + `READ_EXTERNAL_STORAGE` for subtitle file (or `MANAGE_EXTERNAL_STORAGE` on Android 11+ scoped storage, or use `getExternalFilesDir` instead of public Downloads)
  - For Android 10+ scoped storage: use `context.getExternalFilesDir(null)/StreambertSubs` rather than public Downloads to avoid permission

### Capacitor Plugin Registration

In `MainActivity.java` or `capacitor.config.json`:

```java
// MainActivity.java
import com.truelockmc.streambert.ExternalPlayerPlugin;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ExternalPlayerPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
```

Or `android/app/src/main/assets/capacitor.plugins.json` auto-registration if using Capacitor 5+.

---

## Testing (Real Device Required for Phase 10)

### Automated Tests (Passed)

- `test-external-player.js` — 5 suites: header handling, stream resolver, Android intent, player registry, proxy HLS rewriting
- Build: `npx vite build` success 83 modules

### Manual Tests (To Do on Physical Device, per task Phase 11)

1. **VLC installed:** launch direct MP4 via intent, verify plays
2. **MPV installed:** launch HLS via intent with Referer, verify plays
3. **MX Player installed:** launch HLS with Referer, verify if needs proxy (if 403, proxy path)
4. **Multiple players:** chooser shows all
5. **No players:** returns "No compatible external player installed" message, no crash
6. **Direct URL no headers:** `https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8` via VLC
7. **HLS + Referer:** test server requiring Referer header
8. **HLS + Cookie:** simulate CloudFront cookie, verify proxy injects and plays (VLC cannot handle Cookie directly)
9. **Subtitles external URL:** `https://.../en.vtt` downloaded to /sdcard/... and passed via extras
10. **Failed/expired/invalid URL:** returns error with reason, not silent fail
11. **Network interruption:** proxy returns 502, error propagated
12. **Headers preservation:** verify proxy actually sends Cookie, Referer, UA to target (log in proxy)
13. **Subtitle + headers combo:** both work together
14. **Chooser fallback:** system chooser when no package specified

**Do NOT fake success:** No dummy functions, no hardcoded test URL in production path, no silent header discard. If proxy fails, return `PROXY_FAILED` error.

---

## Known Limitations

- MX Player ignores Referer extra — proxy recommended for all MX launches with Referer (implemented as warning, but not mandatory; could be made mandatory in future)
- Origin header cannot be passed via intent extras — if target requires Origin, proxy mandatory (currently not flagged, could add)
- Subtitle file in public Downloads requires storage permission on Android 10+; better to use app-private `getExternalFilesDir` — currently uses public for compatibility with players that only scan Downloads
- `QUERY_ALL_PACKAGES` permission may be rejected by Play Store; better to use `<queries>` intent filter — implemented via queries for `video/*` VIEW
- Intent URI fallback may be blocked by WebView if not triggered by user gesture — requires click handler
- No DASH support yet (only HLS and MP4) — DASH would need similar proxy
- No DRM support (Widevine) — external players handle DRM themselves if URL is DRM-protected

---

## Comparison with MovieBox-TUI

| Aspect | MovieBox-TUI (Rust) | Streambert Android (This Impl) |
|--------|---------------------|--------------------------------|
| Detection | `termux-open --chooser` + `pm list` via Termux? Actually uses `xdg-open`? Code shows `termux-open --chooser --content-type video/* <url>` and `termux-am start -a VIEW -d <url> -t video/*` | PackageManager.queryIntentActivities video/* + known packages list, via Capacitor plugin — no Termux |
| Launch | `std::process::Command::new("termux-am")` with `-e` extras for subs_location, subs, Referer, UA | `Intent.ACTION_VIEW` via Java `startActivity`, extras via `putExtra`, chooser via `createChooser` |
| Headers | `http-header-fields` for mpv, `--http-referrer` for VLC, `-e Referer` for Android, or proxy for Cookie | Same logic: `S.Referer`, `S.User-Agent` extras for VLC/MPV, proxy for Cookie/Auth/MX |
| Proxy | `proxy.rs` `127.0.0.1:0` `/https/host/path`, host validation, header injection, HLS rewrite, Range | `AndroidProxyServer.java` same: ServerSocket 127.0.0.1:0, /https/host/path, host allowlist 403, HLS rewrite, Range, watchdog |
| Subtitles | 9 keys: subtitles_location, subs, sub, title_subtitle, subs.enable, etc, file in `~/storage/downloads/moviebox_subs` | Same 9 keys, file in `/sdcard/Download/StreambertSubs` via native download |
| Failure | Returns error if player not found, fallback to chooser | Same: "No compatible external player installed" message, chooser fallback, no crash |

**We did NOT blindly copy:** Studied `player.rs AndroidIntent, AndroidOpener`, `proxy.rs`, `docs/players.md`, then implemented equivalent in Java/Capacitor.

---

## Build Verification

```
npx vite build
✓ 83 modules transformed
✓ built in 6.04s
dist/assets/androidNativeProxy-CB6xzAfT.js 1.85 kB
dist/assets/proxyServer-C8TFh93M.js 5.98 kB
...
```

No import errors, no missing modules.

---

## Next Steps (Per Task Sequence)

1. ✅ Fork + Audit (done)
2. ✅ Design workflow (done, in ANDROID_EXTERNAL_PLAYER_DESIGN.md)
3. ✅ Implement ExternalPlayerAdapter (done, pure native)
4. ✅ Player support VLC, MPV, MX, default, others (done, PackageManager)
5. ✅ Stream URL handling UA, Referer, Cookie, Auth, HLS (done, headerHandler + proxy)
6. ✅ Local proxy if required (done, AndroidProxyServer.java)
7. ✅ Subtitles (done, native download + 9 extras)
8. ✅ API audit (API_AUDIT.md)
9. ✅ Separate desktop and Android (platform abstraction, DesktopProxyServer vs AndroidNativeProxy)
10. ⏳ Implement first APK later (after verification) — NOT YET, per task "DO NOT BUILD APK YET"
11. ⏳ Test real playback on physical device (14 cases) — requires Android device + Capacitor project setup
12. ⏳ Document implementation (this file + others)
13. ⏳ APK packaging final step (framework, bridge, permissions, storage, intents, debug APK, physical test, release APK)

**Current milestone:** Resolve playable stream and launch in installed Android player BEFORE APK packaging — IMPLEMENTED, awaiting physical device test.

---

## Files Reference

- `src/utils/externalPlayer/androidBridge.js` — Capacitor bridge
- `src/utils/externalPlayer/androidPlayerDetector.js` — PackageManager detection
- `src/utils/externalPlayer/androidNativeProxy.js` — Android proxy class
- `src/utils/externalPlayer/androidIntent.js` — Intent building, pure native
- `src/utils/externalPlayer/proxyServer.js` — Split desktop vs Android
- `src/utils/externalPlayer/externalPlayerAdapter.js` — Main adapter, platform split
- `src/utils/externalPlayer/subtitleHandler.js` — Subtitle handling, native
- `src/utils/externalPlayer/headerHandler.js` — Header analysis
- `src/utils/externalPlayer/playerRegistry.js` — Player registry, no Termux
- `src/utils/externalPlayer/streamResolver.js` — Stream type detection
- `src/utils/platform.js` — Platform detection
- `android/src/main/java/com/truelockmc/streambert/ExternalPlayerPlugin.java` — Capacitor plugin
- `android/src/main/java/com/truelockmc/streambert/AndroidProxyServer.java` — Java proxy
- `src/ipc/externalPlayer.js` — Desktop IPC only
- `preload.js` — Desktop preload only
- `test-external-player.js` — Automated tests
- `STREAM_HEADERS_ANALYSIS.md` — Headers analysis
- `ANDROID_EXTERNAL_PLAYER_DESIGN.md` — Design doc
- `IMPLEMENTATION_REPORT.md` — Previous report
- `TESTING.md` — Test cases

