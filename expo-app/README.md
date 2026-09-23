# Streambert Android - Expo App

This is the Expo/EAS Android version of Streambert, built on top of existing Streambert functionality + Android compatibility layer.

## Architecture

```
EXISTING STREAMBERT (70% reusable)
  + ANDROID COMPATIBILITY LAYER
  + EXPO/REACT NATIVE APP SHELL
  + NATIVE ANDROID BRIDGE (Java)
  = STREAMBERT ANDROID APK
```

## Structure

- `app/` - Expo Router screens
  - `index.tsx` - Home, architecture overview
  - `player-test.tsx` - Dev APK test for external player (PackageManager, Intent, proxy, subs)
  - `streambert.tsx` - WebView wrapper loading Streambert dist/ + m3u8 intercept via injected JS
- `modules/expo-external-player/` - Custom native module
  - `android/src/main/java/expo/modules/externalplayer/ExternalPlayerModule.kt` - Kotlin module (getInstalledPlayers, launchPlayer, startProxy, etc)
  - `android/src/main/java/expo/modules/externalplayer/AndroidProxyServer.java` - Java proxy (ServerSocket 127.0.0.1:0, host validation, HLS rewrite)
  - `src/index.ts` - JS interface with Intent URI fallback
- `plugins/with-external-player.js` - Config plugin adding AndroidManifest permissions & queries
- `app.json` - Expo config (appId com.truelockmc.streambert, permissions)
- `eas.json` - EAS Build profiles (development, preview, production)

## Native Module

Adapted from Capacitor version `ExternalPlayerPlugin.java` to Expo module:

- `getInstalledPlayers()` -> PackageManager query for video/* + known packages (VLC, MPV, MX, Just, etc)
- `launchPlayer({url, packageName, mimeType, title, headers, subtitle})` -> Intent ACTION_VIEW with chooser, extras for title, Referer, UA, subtitles_location x9
- `startProxy({targetUrl, headers})` -> ServerSocket 127.0.0.1:0 random port, host validation 403, HLS rewrite, Range, watchdog
- `downloadSubtitle({url, fileName})` -> HttpURLConnection to /sdcard/Download/StreambertSubs
- `getSubtitleDir()` -> returns path

## Stream Resolution

- **WebView intercept:** Injected JS in `streambert.tsx` intercepts fetch/XHR/video tags for .m3u8/.mp4, posts to React Native via `window.ReactNativeWebView.postMessage`
- **Replaces Electron:** Electron's `webRequest.onBeforeRequest` for m3u8/vtt intercept is replaced by WebView injected JS
- **Headers:** Direct via intent extras (UA, Referer) for VLC/MPV/Just, proxy for Cookie/Auth/MX
- **Proxy:** Same as MovieBox-TUI: /https/host/path, host allowlist, HLS rewrite

## Build

### Development APK (for testing native bridge)

```bash
cd expo-app
npm install
eas build --profile development --platform android
# Or local: npx expo run:android
```

Install on device, test with VLC/MPV/MX installed.

### Production APK

```bash
eas build --profile production --platform android
```

## Testing

- `player-test` screen: test PackageManager detection, Intent launch (direct vs proxy), subtitle download
- `streambert` screen: loads Streambert UI in WebView, detects m3u8, launches external player

See `ANDROID_DEVICE_VERIFICATION.md` and `EXPO_ANDROID_ARCHITECTURE_REPORT.md` for full details.

## Preservation of Existing Functionality

- Search, movies, TV, anime, metadata, seasons, episodes, source selection, stream resolution, subtitles, history, watchlist, settings, backup/restore, downloads - all preserved via platform abstraction
- Electron-only parts replaced: index.js (main) -> App.js, preload.js -> Expo modules, src/ipc/* -> Expo FileSystem/SecureStore/etc + custom native module
- `src/utils/api.js` (TMDB, AniList, PLAYER_SOURCES) reused directly (fetch works)
- `src/utils/externalPlayer/*` reused (pure JS + native bridge)

## Why Expo?

- User has Expo/EAS token and experience
- EAS can build dev APK early for real device testing
- Config plugins allow custom native code
- Custom native modules supported
- Better than Capacitor for Play Store and native feel

## Status

- Architecture report: DONE (EXPO_ANDROID_ARCHITECTURE_REPORT.md)
- Native module: DONE (Java/Kotlin + JS interface)
- Dev APK screens: DONE (player-test, streambert WebView)
- Build: Requires local Android Studio / EAS (sandbox has memory limits)
- Real device test: Pending (needs physical device)

## Next Steps

1. Build dev APK via EAS
2. Install on device with VLC/MPV/MX
3. Test detection, launch, proxy, subs
4. Add Streambert dist/ to WebView or rewrite UI to RN
5. Port AllManga resolver from Node to JS
6. Iterate dev APKs
7. Production APK
