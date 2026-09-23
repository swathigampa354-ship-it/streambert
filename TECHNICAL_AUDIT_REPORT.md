# Streambert — Phase 0 Technical Audit Report
**Date:** 2026-09-23
**Forks:**
- Main: https://github.com/swathigampa354-ship-it/streambert (forked from truelockmc/streambert v2.6.0)
- Reference: https://github.com/swathigampa354-ship-it/MovieBox-Tui (forked from mesamirh/MovieBox-TUI)

---

## 1. Streambert Architecture Overview

### 1.1 Project Type
- **Electron + Vite + React 18** desktop app
- `index.js` = main process (BrowserWindow, session setup, IPC registration, ad-blocking, backup trigger, PiP window)
- `preload.js` = contextBridge exposing ~40 IPC methods to renderer
- `src/main.jsx` + `src/App.jsx` = React SPA entry
- Pages: HomePage, MoviePage, TVPage, LibraryPage, SettingsPage, DownloadsPage
- Build: electron-builder (AppImage, deb, rpm, pacman, exe/nsis, dmg)

### 1.2 Renderer Flow
```
App.jsx
 ├─ SetupScreen (first run, TMDB API key)
 ├─ Sidebar + SearchModal + WindowTitlebar
 └─ Pages (lazy loaded)
     ├─ HomePage -> TrendingCarousel, MediaCard
     ├─ MoviePage -> player webview + metadata
     ├─ TVPage -> season/episode + player webview
     ├─ LibraryPage, SettingsPage, DownloadsPage
```

### 1.3 Player Source System (`src/utils/api.js`)
```js
PLAYER_SOURCES = [
  { id: "videasy", label: "Videasy", movieUrl: "https://player.videasy.to/movie/{id}", tvUrl: ".../tv/{id}/{s}/{e}" },
  { id: "vidsrc",   label: "VidSrc",  movieUrl: "https://vsembed.su/embed/movie/{id}" },
  { id: "vidking",  label: "VidKing", movieUrl: "https://www.vidking.net/embed/movie/{id}" },
  { id: "allmanga", label: "AllManga", async: true, tag: "ANIME" }
]
```
- `getSourceUrl()` builds final embed URL with accent color + subtitle lang params.
- `NEEDS_INTERCEPT = ["vidsrc"]` — requires transparent webRequest intercept.

### 1.4 Stream Resolution (Current Desktop Implementation)
- **MoviePage.jsx / TVPage.jsx**:
  - Holds `webviewRef` pointing to `<webview partition="persist:player" src={embedUrl}>`
  - `webview` loads embed site (e.g., vidking.net). That site's internal player resolves HLS.
  - Main process `index.js` `setupSession()`:
    - Sets UA: `Mozilla/5.0 (Windows NT 10.0; ...) Chrome/124.0.0.0`
    - Strips `X-Frame-Options` / `CSP` to allow iframe embedding
    - `onBeforeRequest` filter: BLOCKED_HOSTS (analytics, ads) + MEDIA_URLS (`*.m3u8*`, `*.vtt*`)
    - For `.m3u8` -> `mainWindow.webContents.send("m3u8-found", url)` -> renderer stores `m3u8Url` state
    - For `.vtt` -> sends `subtitle-found` with lang extracted via `src/ipc/subtitles.js`
  - Progress tracking: `webview.executeJavaScript()` polling `video.currentTime`
  - Download: `DownloadModal.jsx` uses `m3u8Url` + external downloader binary via `src/ipc/downloads.js`
- **AllManga Anime** (`src/ipc/allmanga.js`):
  - Main-process HTTPS POST to `api.allanime.day/api` (bypasses CORS/CF)
  - Decrypts hex cipher + AES-256-CTR `tobeparsed` blobs
  - Resolves direct MP4 or HLS, then `setPlayerVideo` spins local HTTP server? Actually creates player URL via `playerUrl` (localhost) for direct mp4.
  - Renderer receives resolved URL.

### 1.5 IPC Modules (`src/ipc/`)
- `player.js`: `open-path-at-time` — launches local file in mpv/VLC via `spawn`, validates extensions, searches common binary paths (win32, darwin, linux). Also window controls, ffprobe duration, auto-updater (GitHub + Codeberg trusted sources).
- `storage.js`: secureStore (safeStorage OS keychain) + scheduled backup settings
- `downloads.js`: manages downloader binary detection via token registry, spawn download process, parse frag progress, ffmpeg progress, subtitle file download.
- `subtitles.js`: Wyzie API search + OpenSubtitles? Actually Wyzie key redemption, subtitle download.
- `allmanga.js`: anime resolver + local player server
- `blockStats.js`, `discordRpc.js`

### 1.6 Subtitles
- Intercepted from embed player requests (`.vtt` URLs)
- `extractSubtitleLang(url)` parses lang code
- `interceptedSubs` state array in MoviePage/TVPage
- DownloadModal allows external subtitle files
- Player's `open-path-at-time` accepts `subtitlePaths` for local files.

### 1.7 Downloads / Storage / API Config
- **Storage**: `src/utils/storage.js` wrapper over localStorage + secureStorage for API keys
  - Keys: `saved`, `progress`, `history`, `watched`, `playerSource`, `accentColor`, `subtitleLang`, `downloaderFolder`, etc.
- **API Requirements** (from source audit):
  - **TMDB API Key** (required, user-provided via SetupScreen): `api.themoviedb.org/3` — search, trending, movie/tv details, collections, episode groups, ratings. Stored via secureStore `tmdb_api_key`.
  - **Wyzie API Key** (optional, for subtitles): Wyzie API `api.wyzie.ru` — subtitle search. Flow: user redeems via `wyzie-open-redeem` (opens browser), validates via `wyzie-validate-key`.
  - **AniList GraphQL** (no key, public): `https://graphql.anilist.co` — anime metadata, relations for seasons. Cached 7 days in localStorage.
  - **AllManga / AllAnime API** (no key): `https://api.allanime.day/api` + `https://allmanga.to` — anime episode sources.
  - No other hard API keys found. TMDB is mandatory; Wyzie optional; AniList public.
- **Filesystem**: Electron `app.getPath("userData")` for secure-store.json, downloads, cache. `fs` access via IPC only.
- **Backup/Restore**: `src/utils/backup.js` collects all localStorage + settings into JSON.

### 1.8 Electron-Specific Components (Must Be Abstracted for Android)
- `BrowserWindow`, `session.fromPartition("persist:player")`, `webContents`, `webviewTag`
- `ipcMain.handle` / `ipcRenderer.invoke`
- `safeStorage`, `app.getPath`, `shell.openPath`, `spawn` (mpv/vlc)
- `webRequest.onBeforeRequest` / `onHeadersReceived` (adblock + m3u8 intercept)
- `preload.js` contextBridge
- Node `fs`, `path`, `https`, `http`, `crypto`, `os`
- Auto-updater (GitHub/Codeberg) — not needed on Android
- Discord RPC
- `popout-preload.js` PiP window

---

## 2. MovieBox-TUI Android External-Player Implementation (Reference)

### 2.1 Project Type
- **Rust TUI** (Ratatui) + Tokio async runtime
- `src/player.rs` = player detection & command construction
- `src/proxy.rs` = sidecar local HTTP proxy for VLC cookie/header injection
- `src/tui/app/playback.rs` = playback resolution, header compatibility gate, launch logic
- `docs/players.md` = detailed player command table

### 2.2 PlayerKind Enum
```rust
enum PlayerKind { Mpv, Iina, Vlc, AndroidIntent }
- label(): "mpv", "IINA", "VLC", "Android Player"
- config_key(): "mpv", "iina", "vlc", "android"
- parse(): from string "android", "androidintent", etc.
```

### 2.3 Detection (`detect() -> Vec<PlayerKind>`)
- Checks Termux env via `is_termux_environment()` (PREFIX env var, /data/data/com.termux)
- `probe_android_openers()` searches for:
  - Custom path via `MOVIEBOX_ANDROID_PLAYER_PATH` env
  - `$PREFIX/bin/termux-am`, `termux-open`, `termux-open-url`
  - Static `/data/data/com.termux/files/usr/bin/termux-*`
  - `which termux-am` etc via PATH
  - On Android non-Termux root: `/system/bin/am`, `which am`
- If any opener found + is_termux => push AndroidIntent
- Then check mpv executable, vlc executable, iina (macOS)
- If not termux but android openers exist, push AndroidIntent last.

### 2.4 AndroidOpener Enum
```rust
enum AndroidOpener {
  TermuxAm(String),       // termux-am binary path
  TermuxOpen(String),     // termux-open
  TermuxOpenUrl(String),  // termux-open-url
  SystemAm(String)        // /system/bin/am (root Android)
}
```

### 2.5 Command Construction
- `android_intent_command_for_opener(opener, url, subtitle, headers) -> Command`
  - **TermuxOpen**: `termux-open --chooser --content-type video/* <url>` — triggers Android chooser, no extras
  - **TermuxOpenUrl**: `termux-open-url <url>` — simplest
  - **TermuxAm**: `termux-am start -a android.intent.action.VIEW -d <url> -t video/*` + extras:
    - Subtitles: `-e subtitles_location <path> --eu subtitles_location <path> -e subs <path> --esal subs <path> -e subs.enable <path> --esal subs.enable <path> -e sub <path> --eu sub <path> -e title_subtitle <path>`
    - Headers: `-e User-Agent <value>` if header name is User-Agent, `-e Referer <value>` if Referer
  - **SystemAm**: `am start --user 0 -a android.intent.action.VIEW -d <url> -t video/*` + same extras

### 2.6 Header Handling
- `supports_headers(kind, headers) -> bool`:
  - If headers empty => true
  - For mpv, iina, vlc, android => true (all support headers via different mechanisms)
  - But earlier versions gated; now all true, but `header_capable_players()` returns all 4.
- In `playback.rs` `resolve_playback_player()`:
  - Checks `ENV_MOVIEBOX_PLAYER` env var override
  - Checks `default_player` from config.json
  - Validates via `supports_headers(chosen, source.headers)`; if incompatible, returns `ExplicitPlayerIncompatible` with alternatives
  - If no preferred, finds first compatible from `available_players`
- Headers source: `PlaybackSource.headers` from provider models (e.g., MovieBox DASH has Cookie, Referer, User-Agent)

### 2.7 Proxy (Critical for Protected Streams)
- `spawn_sidecar(target_url, headers, subtitle_url) -> Result<String>`:
  - Gets current exe path, spawns `exe --proxy-for-vlc <url> <headers_json> <sub>`
  - Child prints `PORT <port>` on stdout, parent reads it with 8s timeout
  - Returns `http://127.0.0.1:<port>/https/<host>/path` (or /http/)
- `run_sidecar(target_url, headers, subtitle_url)`:
  - Binds `TcpListener` on 127.0.0.1:0 (random)
  - Prints PORT
  - Watchdog: if 0 conns + 600s idle, exit
  - `handle_connection()`:
    - Parses request line, extracts target URL from path `/https/<host>/path` or `/http/`
    - Validates host matches allowed target_host or subtitle host (403 otherwise) — prevents open proxy
    - Builds reqwest client request, injects **all auth headers** if host == target_host, else only User-Agent for subtitle host
    - Forwards Range header
    - Copies status, headers (Content-Length, Content-Type, etc), streams body via `StreamExt`
    - Handles HLS playlist rewriting? Actually proxy.rs rewrites? In code: it forwards raw, but client handles HLS? Need to check manifest handling: code has `MAX_MANIFEST_BYTES`, checks if content-type is m3u8, then rewrites segment URLs to proxy form? The truncated code shows manifest handling logic exists.
  - Used for VLC when stream has Cookie headers (CloudFront signed cookies for MovieBox DASH) that VLC CLI cannot receive via `--http-header-fields`? Actually VLC can receive User-Agent/Referer via flags, but Cookie via proxy.
- **When proxy used**: In `playback.rs` launch logic, if `kind == Vlc` and headers contain Cookie, spawn sidecar and replace URL with proxy URL.

### 2.8 Subtitles
- Desktop: mpv receives remote URL directly via `--sub-file=<url>` with headers applied; VLC/IINA download to temp file preserving extension, pass local path.
- Android: download subtitles to shared storage `~/storage/downloads/moviebox_subs` or `/sdcard/Download/moviebox_subs` named `<Title> - S02E05.<ext>` or `<Title>.<ext>`, pass via intent extras (`subtitles_location`, `subs`, etc.). Players like MX Player auto-load; VLC for Android, mpv-android require manual picker but file is available in Downloads. Retained during playback, purged 24h retention or via Clear Cache.

### 2.9 Failure Handling
- `launch_player()` spawns with null stdin, piped stderr, own process group
- Concurrent stderr drain thread with 2s timeout after exit to avoid pipe deadlock (VLC forks)
- Clean exit normalization:
  - VLC exit 1 + empty stderr = clean (normal under --play-and-exit)
  - Unix SIGTERM 15 = clean (user closed window)
  - Non-zero with stderr = PlayerCrashed with diagnostics
  - No stderr + exit 2 = "Stream Dead: Link expired"
  - Exit 1 = "Player Error"
- Android specific diagnostics:
  - No player installed => "No Player: Install a video player"
  - Missing termux-tools => "Termux Setup: Run 'pkg install termux-tools'"
  - CLI mpv headless => "CLI mpv: Switch to Android Player"
  - SELinux exit 126 => detects Termux, prevents illegal /system/bin/am invocation, preserves LD_PRELOAD

### 2.10 Player Selection
- Settings Hub lists detected players, saves to config.json `default_player`
- Env var `MOVIEBOX_PLAYER` overrides
- If multiple Android players installed, `termux-open --chooser` shows Android system chooser (user picks VLC/MX/MPV each time) — no hardcoding.
- If `termux-am` used, still chooser unless package specified via `-n <package>`? Actually code doesn't set package, so chooser still appears.

---

## 3. Gap Analysis: Streambert vs Android Requirement

| Aspect | Streambert (Desktop) | MovieBox-TUI (Android) | Gap / Action Needed |
|--------|----------------------|------------------------|---------------------|
| **Stream URL** | Intercepted `.m3u8` from webview, but primary playback is webview embed URL, not direct URL | Direct URL from provider client (resolved via API) | Streambert needs explicit stream resolver that extracts playable URL + headers from embed page OR uses intercepted m3u8 as primary source for external player |
| **Headers** | UA set at session level, no per-request Referer/Cookie forwarding to external player | PlaybackSource.headers contains UA, Referer, Cookie, passed via intent extras or proxy | Need to capture embed URL as Referer, plus UA, and any cookies from session, and forward |
| **Player Launch** | `webview` tag + `open-path-at-time` for local files via spawn mpv/vlc | `termux-open --chooser --content-type video/* <url>` or `termux-am start -a VIEW -d <url> -t video/*` | Need ExternalPlayerAdapter abstraction with Android implementation using Intent |
| **Detection** | Searches PATH for mpv/vlc binaries | Probes termux-* binaries, checks `is_termux_environment` | Need Android detection via Termux tools + package manager query (for Capacitor) |
| **Proxy** | None for streaming (only AllManga local server for mp4) | Sidecar proxy on 127.0.0.1 that injects headers server-side for VLC | Need Node http proxy that rewrites HLS playlists and forwards segments with headers |
| **Subtitles** | Intercepted .vtt URLs, stored in state, passed to DownloadModal | Downloaded to shared storage, passed via intent extras | Need subtitle downloader + intent extra mapping |
| **Platform Abstraction** | None, Electron only | PlayerKind enum + detect() + command() + supports_headers() | Need Platform abstraction: Desktop vs Android, ExternalPlayerAdapter interface |

---

## 4. Target Workflow for Android

```
User
 ↓
Streambert (React)
 ↓
Search (TMDB API)
 ↓
Select movie/show/anime (MoviePage/TVPage)
 ↓
Select source (Videasy/VidSrc/VidKing/AllManga)
 ↓
Resolve playable stream:
  - embedUrl (e.g., https://www.vidking.net/embed/movie/123)
  - intercepted m3u8Url (from webRequest) OR direct mp4 from AllManga
  - stream type detection (hls vs mp4)
  - headers: User-Agent (Chrome 124), Referer (embedUrl), Origin (embed origin), Cookie (if any)
  - subtitles: [{url, lang}]
 ↓
Android External Player Adapter
  ├─ detectAvailablePlayers() -> [VLC, MPV, MX Player, ...] or chooser
  ├─ check header compatibility
  ├─ if headers require proxy (Cookie present, or player cannot receive Referer):
  │    Local Android Proxy (127.0.0.1:port) that injects headers
  │    Returns http://127.0.0.1:port/https/host/path.m3u8
  └─ build Android Intent:
       ACTION_VIEW, data=streamUrl (or proxyUrl), type=video/*
       extras: User-Agent, Referer, subtitles_location, title
 ↓
Android Intent / termux-open / termux-am
 ↓
Installed video player (VLC / MPV / MX Player)
 ↓
VIDEO PLAYS
```

---

## 5. Implementation Plan (Next Phases)

### Phase 2: External Player System
- Create `src/utils/platform.js`: `isAndroid()`, `isElectron()`, `getPlatform()`
- Create `src/utils/externalPlayer/`:
  - `types.js`: PlayerKind, PlayerInfo, StreamInfo, LaunchResult
  - `playerRegistry.js`: KNOWN_PLAYERS list with package names, intent actions, detection
  - `androidIntent.js`: `buildIntentUri()`, `buildAmCommand()`, `buildTermuxOpenCommand()`
  - `headerHandler.js`: `extractHeaders(embedUrl)`, `normalizeHeaders()`, `needsProxy()`
  - `proxyServer.js`: Node http proxy + HLS rewriting (for Electron) + Capacitor HTTP server stub for Android
  - `subtitleHandler.js`: download subtitles, manage shared storage path, intent extras
  - `externalPlayerAdapter.js`: main class with `detect()`, `list()`, `launch()`, `launchWithFallback()`
  - `streamResolver.js`: from m3u8Url + embedUrl + sourceId -> StreamInfo

### Phase 3: Player Support
- Known players:
  - VLC: org.videolan.vlc (official), also org.videolan.vlc.debug
  - MPV: is.xyz.mpv, is.xyz.mpv.debug, com.mpv (legacy), is.xyz.mpv (FDroid)
  - MX Player: com.mxtech.videoplayer.ad (free), com.mxtech.videoplayer.pro (pro)
  - Just Player: com.brouken.player
  - Next Player: com.anotherwidget.justplayer? Actually "Just (Video) Player" is com.brouken.player, "Next Player" is com.anotherwidget.justplayer
  - System default: no package, use chooser
- Detection: On Android via Capacitor App Launcher plugin or via termux-open existence; on desktop via binary existence (existing logic preserved)
- Launch: Use `termux-open --chooser --content-type video/* <url>` as primary (matches MovieBox), fallback to `termux-am` with extras for headers/subtitles

### Phase 4: Stream URL Handling
- For non-AllManga sources: use intercepted m3u8Url as primary stream URL; if not yet intercepted, use embedUrl as fallback and let external player handle? But requirement says resolve playable stream.
- For AllManga: already has direct mp4/m3u8 URL via main-process resolver; reuse that.
- Headers: Always include:
  - User-Agent: Chrome 124 UA (same as session)
  - Referer: embedUrl
  - Origin: origin of embedUrl
  - Cookie: if available from session cookies (need to expose via IPC)
- HLS handling: proxy must rewrite playlist segment URLs to go through proxy if headers needed.

### Phase 5: Local Proxy
- Implement `ProxyServer` class:
  - `start(targetUrl, headers, subtitleUrl) -> proxyUrl`
  - Listens on 127.0.0.1:0, prints port
  - `handleRequest`: extracts target from path `/https/<host>/path`, validates host, forwards with headers, rewrites m3u8 manifests (replace segment URLs with proxy URLs)
  - `stop()` cleanly
  - Only bind to loopback, not 0.0.0.0
  - Use for streams with Cookie or when player cannot receive Referer (e.g., MX Player free may ignore extras)

### Phase 6: Subtitles
- Reuse intercepted subs + Wyzie subs
- For Android: download to `/sdcard/Download/StreambertSubs/` or `~/storage/downloads/streambert_subs/`
- Pass via intent extras: `subtitles_location`, `subs`, `sub`, etc. (multiple keys for compatibility as MovieBox does)
- For VLC Android, also need to ensure subtitle file is in accessible path.

### Phase 7: API Requirements (Documented)
- TMDB: required, secureStore
- Wyzie: optional, secureStore
- AniList: public, no key, cached
- AllAnime: public, no key

### Phase 8: Preserve Existing Functionality
- Desktop build must continue working: webview playback remains default
- Add setting "Playback Mode": "Internal (Desktop)" vs "External (Android)" — stored in localStorage
- Only when external mode selected, use ExternalPlayerAdapter

### Phase 9: Separate Desktop and Android
- Platform abstraction: `platform.js` detects
- Desktop: `DesktopPlayerAdapter` (existing webview + open-path-at-time)
- Android: `AndroidExternalPlayerAdapter`
- Shared interface: `play(streamInfo)` etc.

---

## 6. Risks & Mitigations
- **Embed sites require JS execution to resolve m3u8**: Currently Streambert relies on webview JS to trigger m3u8 request. For external player, we need to wait for m3u8 interception before launching. Implement `waitForM3u8(timeout)` in streamResolver.
- **Headers not sufficient**: Some streams use CloudFront signed cookies that cannot be passed via intent extras; proxy is mandatory. Implement proxy detection via `needsProxy(headers)` checking for Cookie.
- **Subtitle injection varies per player**: MX Player supports `subs` extra, VLC supports `subtitles_location`, MPV Android supports `subs.enable`. Send all variants as MovieBox does.
- **Android package detection without native bridge**: In pure web context, cannot query installed packages. Use chooser via termux-open as fallback, which always works if any player installed. For Capacitor, use `AppLauncher` plugin to query.

---

## 7. Next Steps
1. Implement `src/utils/externalPlayer/` modules
2. Add IPC `externalPlayer` for Electron simulation of Android intent
3. Modify MoviePage/TVPage to add "Play in External Player" button
4. Implement proxyServer
5. Test with real streams (VLC, MPV, MX Player installed)
6. Document architecture, modified files, dependencies, player support matrix
7. Only then begin APK packaging (Capacitor)

---
*End of Phase 0 Report*
