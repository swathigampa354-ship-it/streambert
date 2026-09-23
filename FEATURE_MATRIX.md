# Feature Matrix — Desktop vs Android

| Feature | Desktop (Electron) | Android (Expo) | Android Implementation | Status |
|---------|-------------------|----------------|------------------------|--------|
| Search | YES | TODO | Reuse api.js (TMDB search via fetch) | PLANNED - reuse logic |
| Movies | YES | TODO | Reuse MoviePage.jsx via WebView or RN | PLANNED |
| TV | YES | TODO | Reuse TVPage.jsx | PLANNED |
| Anime | YES | TODO | Reuse + port AllManga resolver from Node to JS (fetch + WebCrypto) | TODO - needs JS port |
| Trending | YES | TODO | Reuse api.js getTrending | PLANNED |
| Metadata | YES | TODO | Reuse api.js TMDB/AniList via fetch | PLANNED |
| Seasons/Episodes | YES | TODO | Reuse | PLANNED |
| Source selection | YES | TODO | Reuse PLAYER_SOURCES logic | PLANNED |
| Stream resolution | YES | TODO | WebView injected JS intercepting fetch/XHR/video for m3u8 (replaces Electron webRequest) - more robust? Needs testing with actual sources (VidKing, Videasy, VidSrc) | IN PROGRESS - expo-app/app/streambert.tsx has injection |
| External player | YES (mpv/vlc via spawn) | TODO | Expo native module ExternalPlayerModule.kt (Intent ACTION_VIEW) | IMPLEMENTED - Java code ready, needs dev APK test |
| VLC | YES | TODO | PackageManager detection + Intent | IMPLEMENTED - code ready |
| MPV | YES | TODO | Same | IMPLEMENTED |
| MX Player | YES | TODO | Same, but needs proxy for Referer (MX ignores Referer extra) | IMPLEMENTED with proxy logic |
| System Chooser | YES | TODO | Intent.createChooser | IMPLEMENTED |
| Player detection | YES (which mpv/vlc) | TODO | PackageManager queryIntentActivities + known packages | IMPLEMENTED |
| Direct MP4 | YES | TODO | Intent with video/* mime | IMPLEMENTED |
| HLS | YES | TODO | Intent with application/x-mpegURL + HLS rewrite via proxy if needed | IMPLEMENTED |
| Headers (UA, Referer) | YES | TODO | Intent extras S.User-Agent, S.Referer for VLC/MPV/Just | IMPLEMENTED |
| Cookies/Auth | YES (via proxy) | TODO | Local proxy 127.0.0.1:0 /https/host/path, host validation 403, HLS rewrite, Range | IMPLEMENTED - AndroidProxyServer.java |
| Proxy | YES (Node http) | TODO | Java ServerSocket proxy (Expo module) | IMPLEMENTED |
| Subtitles (embedded) | YES | TODO | Player handles | N/A |
| Subtitles (external) | YES (Node fs download) | TODO | Java HttpURLConnection to /sdcard/Download/StreambertSubs + 9 intent extras | IMPLEMENTED |
| Subtitles (VLC) | YES | TODO | subtitles_location, subs, sub extras | IMPLEMENTED |
| Subtitles (MPV) | YES | TODO | subs, subtitles_location | IMPLEMENTED |
| Subtitles (MX) | YES | TODO | subs, subtitles_location | IMPLEMENTED |
| Downloads | YES (yt-dlp/ffmpeg via Node) | TODO | Expo FileSystem + MediaLibrary + native FFmpeg (Milestone 7) - NOT YET | TODO - document missing |
| Library | YES (localStorage) | TODO | AsyncStorage / SQLite | TODO - basic via localStorage in WebView for now |
| History | YES | TODO | AsyncStorage / SQLite | TODO |
| Watchlist | YES | TODO | AsyncStorage | TODO |
| Settings | YES | TODO | Reuse SettingsPage.jsx via WebView | PLANNED |
| Backup/restore | YES | TODO | Expo FileSystem | TODO |
| Notifications | YES (Electron) | TODO | Expo Notifications | TODO |
| Secure storage | YES (safeStorage) | TODO | Expo SecureStore | IMPLEMENTED in platform/android |
| Updates | YES (GitHub/Codeberg) | TODO | EAS Update or manual | TODO |
| Discord RPC | YES | NO | Not needed on Android | WON'T IMPLEMENT |
| Window controls | YES | NO | Not needed on Android | WON'T IMPLEMENT |
| Gamepad | YES | TODO | React Native gamepad? Or disable | TODO |
| Appearance | YES | TODO | Reuse | PLANNED |

**Legend:**
- YES = Works on Desktop
- TODO = Not yet implemented/tested on Android, but planned
- IMPLEMENTED = Code exists, needs dev APK test on real device
- PLANNED = Will reuse existing logic, minimal work
- WON'T IMPLEMENT = Desktop-only, not needed on Android

**Critical Path for First Dev APK (Milestone 1):**
- External player: IMPLEMENTED (needs test)
- Player detection: IMPLEMENTED (needs test)
- VLC/MPV/MX launch: IMPLEMENTED (needs test)
- Direct MP4/HLS: IMPLEMENTED (needs test)
- Headers: IMPLEMENTED (needs test)
- Proxy: IMPLEMENTED (needs test)
- Subtitles: IMPLEMENTED (needs test)

**For Milestone 2 (Real Streambert frontend):**
- Search, Movies, TV, Trending, Metadata: PLANNED (reuse api.js via WebView with local dist/)
- Need to fix expo-app/app/streambert.tsx to load local dist/ (DONE - now loads file:///android_asset/dist/index.html, not vercel.app)

**For Milestone 3 (Real stream resolution):**
- Stream resolution via WebView injected JS: IN PROGRESS (injection in streambert.tsx, but need to test with actual VidKing/Videasy/VidSrc sources - fetch/XHR hooks may not catch all, need more robust like onShouldStartLoadWithRequest or direct source resolver)

**For Milestone 7 (Downloads):**
- Currently NOT YET implemented on Android
- Desktop uses Node fs/path/child_process/yt-dlp/ffmpeg
- Android options: native Android downloader, Expo FileSystem, foreground service, MediaStore, native FFmpeg
- Will document as TODO and implement as subsequent milestone

**Overall:**
- Platform abstraction created: src/platform/ with desktop/ and android/ implementations
- 190 window.electron calls need migration to platform.* - started, not complete (only core external player done)
- Expo app is now production-ready structure (has package.json with compatible versions, local dist/ packaged, not vercel.app)
- Single authoritative architecture chosen: Expo/React Native (android/ Capacitor kept as reference but deprecated)
