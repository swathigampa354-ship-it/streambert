# Streambert — Architecture

## One frontend, two shells

```
                  ┌──────────────────────────────────────┐
                  │  STREAMBERT FRONTEND (src/)          │
                  │  React 18 + Vite · pages · sidebar   │
                  │  gamepad nav · cards · search        │
                  │  responsive.css (phone + body.tv-mode)│
                  └──────────────┬───────────────────────┘
                                 │
            ┌────────────────────┴────────────────────┐
            │                                         │
     DESKTOP (Electron)                        ANDROID (Expo APK)
     index.js (main)                           expo-app/app/streambert.tsx
     preload.js → window.electron              react-native-webview
     src/ipc/* (fs, dialog, child_process)     WEBVIEW_BRIDGE_JS injection
            │                                         │
            │                    ┌────────────────────┴─────────────┐
            │                    │ NATIVE BRIDGE                    │
            │                    │ window.StreambertNative (JS)     │
            │                    │  → ReactNativeWebView.postMessage│
            │                    │  → nativeBridgeDispatcher (RN)   │
            │                    │  → validated methods only:       │
            │                    │    getInstalledPlayers launchPlayer│
            │                    │    startProxy stopProxy          │
            │                    │    downloadSubtitle getSubtitleDir│
            │                    │    openExternal secureGet/Set    │
            │                    │    fileExists showNotification   │
            │                    │    setTvMode                     │
            │                    └────────────┬─────────────────────┘
            │                                 │
            │                    modules/expo-external-player (Kotlin)
            │                    ├─ PackageManager → installed players
            │                    ├─ Intent launch (VLC/MPV/MX/chooser)
            │                    ├─ AndroidProxyServer (127.0.0.1, on-request
            │                    │   HLS/MP4 proxying, link rewriting,
            │                    │   gzip, EXT-X-KEY/MEDIA/MAP, host allowlist,
            │                    │   Referer/UA/Cookie injection)
            │                    └─ MediaStore subtitles (scoped storage ≥29)
            │
     EXTERNAL PLAYERS (VLC / MPV / MX …) ← Intent with proxy URL + subtitle extras
```

## Platform selection (src/utils/platform.js)
`desktop` (Electron preload present) · `android` (window.StreambertNative.platform==='android' and/or Android UA + bridge) · `web` (fallback). Platform-adapters (`src/platform/{desktop,android}`) are dynamically imported; desktop-only code (node builtins) never executes on Android — esbuild bundling proved the import graph is sound (desktop ipc modules are marked external in tests and never hit at runtime on Android).

## Stream resolution & proxy decision
`externalPlayer/streamResolver` classifies a captured stream URL: direct-play vs proxy-required (header-bearing providers, playlists, listed NEEDS_INTERCEPT sources). Captured via four channels:
1. Injected top-document fetch/XHR/`<video>` interception (WEBVIEW_BRIDGE_JS)
2. `onShouldStartLoadWithRequest` top-frame navigations
3. Patched `RNCWebViewClient.shouldInterceptRequest` (patch-package) → synthetic `topMessage` `NATIVE_STREAM_FOUND` (iframe-internal subresource media)
4. `onM3u8Found` event shim consumed by MoviePage's saved desktop logic

## TV mode state machine
`localStorage[streambert_tv_mode]` (intent) → `utils/tvMode.js` → `window.StreambertNative.setTvMode(bool)` → dispatcher → RN `ScreenOrientation.lockAsync(LANDSCAPE|PORTRAIT_UP)` + `body.tv-mode` CSS + AppState 'active' re-assert. Boot sync re-applies on every WebView reload.

## Production vs development
- prod entry: `index.tsx` → `router.replace('/streambert')`; back at root → `BackHandler.exitApp()`
- dev (`__DEV__`): dev menu, `/player-test`, debug header/controls/logs inside `streambert.tsx`
- All debug UI gated by `__DEV__` (Metro constant). Downloads page entry hidden on Android via `isAndroid()` (separate milestone).

## Test pyramid
JVM-real proxy (30) · real-module JS unit (96) · bridge contract+fuzz (41) · API live (25) · config parity (58+) · dist integrity (10) · jsdom App render ×2 (9) · UI/TV suite (56) · Metro export · `tsc --noEmit` (0) · `expo-doctor` (18/18)
