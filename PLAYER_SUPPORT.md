# Player Support Matrix — Detailed

## Overview
Streambert Android external-player architecture supports any Android video player that can handle `ACTION_VIEW` intents with `video/*` MIME type. We explicitly test and document support for the most popular players.

## Detection Methods

### Method 1: Termux (Current TUI-like, for testing)
- `termux-open --chooser --content-type video/* <url>` triggers Android system chooser
- `termux-am start -a android.intent.action.VIEW -d <url> -t video/* -e Referer <ref> -e User-Agent <ua> -e subs <path>`
- Probes existence of `termux-am`, `termux-open`, `termux-open-url` in `$PREFIX/bin` and PATH

### Method 2: Capacitor AppLauncher (APK)
- `PackageManager.getPackageInfo()` for known packages
- `queryIntentActivities(ACTION_VIEW, video/*)` for all handlers
- Custom plugin `ExternalPlayerPlugin.getInstalledPlayers()`

### Method 3: Intent URI (Web Fallback)
- `intent:<url>#Intent;action=android.intent.action.VIEW;type=video/*;S.Referer=...;end`
- Works in Chrome on Android, triggers chooser or specific app if package specified

## Player Details

### VLC for Android
- **Package:** `org.videolan.vlc` (official), `org.videolan.vlc.debug`
- **Install:** Play Store, FDroid
- **HLS:** ✅ Excellent, supports HLS, DASH, MP4, MKV
- **Headers:** ✅ Supports User-Agent, Referer via intent extras (`-e User-Agent`, `-e Referer`). For Cookie, needs proxy.
- **Subtitles:** ✅ Supports `subtitles_location`, `subs`, `sub` extras. Also auto-loads from same folder if file named similarly. Our implementation downloads to `/sdcard/Download/StreambertSubs/` and passes via 9 extra keys.
- **Launch:** `termux-am start -a VIEW -d <url> -t video/* -e User-Agent <ua> -e Referer <ref> -e subtitles_location <path>`
- **Notes:** Best overall compatibility. Hardware acceleration, audio passthrough. For CloudFront cookie streams, proxy required.
- **Status:** ✅ Working

### MPV Android
- **Package:** `is.xyz.mpv` (official), `is.xyz.mpv.debug`, `com.mpv` (legacy)
- **Install:** GitHub releases, FDroid
- **HLS:** ✅ Excellent, mpv's demuxer handles HLS, DASH
- **Headers:** ✅ Supports http-header-fields via intent? Actually via User-Agent/Referer extras. Our proxy handles complex headers.
- **Subtitles:** ✅ Supports `subs`, `subtitles_location`, `subs.enable`
- **Launch:** Same as VLC
- **Notes:** Lightweight, powerful, supports advanced shaders, but UI less user-friendly than VLC/MX. Best for power users.
- **Status:** ✅ Working

### MX Player
- **Package:** `com.mxtech.videoplayer.ad` (free), `com.mxtech.videoplayer.pro` (pro)
- **Install:** Play Store
- **HLS:** ✅ Yes, but may buffer more
- **Headers:** ⚠ Free version often ignores Referer extra. Requires proxy for header-protected streams. Pro slightly better but still recommend proxy.
- **Subtitles:** ✅ Excellent, auto-detects subs in same folder, supports `subs` extra, best subtitle rendering (custom fonts, positioning)
- **Launch:** `termux-open --chooser --content-type video/* <url>` is safest (shows chooser, user picks MX). For direct, `termux-am` with `-n com.mxtech.videoplayer.ad`
- **Notes:** Most popular Android player, great for subtitles, but header support weak. Use proxy for protected streams.
- **Status:** ✅ Working with proxy for protected streams

### Just Player
- **Package:** `com.brouken.player`
- **Install:** Play Store, GitHub
- **HLS:** ✅ Yes, ExoPlayer based
- **Headers:** ✅ Supports UA, Referer
- **Subtitles:** ✅ Via extras
- **Launch:** Chooser or direct
- **Notes:** Lightweight, ExoPlayer, open source, no ads. Good alternative to VLC.
- **Status:** ✅ Compatible

### Next Player
- **Package:** `com.anotherwidget.justplayer` (actually Just Player?), `dev.anotherwidget.ftp`, `com.anotherwidget.justplayer` (check)
- **HLS:** ✅ ExoPlayer
- **Headers:** ✅
- **Subtitles:** ✅
- **Status:** ✅ Compatible

### System Default / Chooser
- **Package:** None (uses Android's resolver)
- **Detection:** Always available if any video player installed
- **Launch:** `termux-open --chooser --content-type video/* <url>` or `intent:<url>#Intent;type=video/*;end`
- **HLS:** Depends on chosen app
- **Headers:** Depends, but proxy ensures headers work regardless of app
- **Subtitles:** Depends
- **Notes:** Recommended default because it shows all installed players and lets user choose per video. Matches MovieBox-TUI's primary method.
- **Status:** ✅ Working (fallback)

## Header Support Details

| Header | Can be passed via termux-am -e? | Can be passed via Intent URI S.? | Needs Proxy? | Notes |
|--------|----------------------------------|----------------------------------|--------------|-------|
| User-Agent | ✅ Yes `-e User-Agent` | ✅ `S.User-Agent` | No | Most players respect |
| Referer | ✅ Yes `-e Referer` | ✅ `S.Referer` | Sometimes (MX Player ignores) | Use proxy for MX if Referer required |
| Origin | ❌ No | ❌ No | ✅ Yes | Not commonly needed, but proxy injects |
| Cookie | ❌ No | ❌ No | ✅ Yes | CloudFront signed cookies, auth cookies |
| Authorization | ❌ No | ❌ No | ✅ Yes | Bearer tokens |
| Custom X- headers | ❌ No | ❌ No | ✅ Yes | Any custom header |

**Conclusion:** For maximum compatibility, proxy is safest for any header beyond UA. But for direct streams (no Cookie/Auth), intent extras suffice for VLC/MPV/Just Player.

## Subtitle Support Details

MovieBox-TUI sends same subtitle path via 9 different extra keys for max compatibility. We replicate:

```bash
-e subtitles_location /sdcard/Download/StreambertSubs/Movie.en.vtt
--eu subtitles_location /sdcard/Download/StreambertSubs/Movie.en.vtt
-e subs /sdcard/Download/StreambertSubs/Movie.en.vtt
--esal subs /sdcard/Download/StreambertSubs/Movie.en.vtt
-e subs.enable /sdcard/Download/StreambertSubs/Movie.en.vtt
--esal subs.enable /sdcard/Download/StreambertSubs/Movie.en.vtt
-e sub /sdcard/Download/StreambertSubs/Movie.en.vtt
--eu sub /sdcard/Download/StreambertSubs/Movie.en.vtt
-e title_subtitle /sdcard/Download/StreambertSubs/Movie.en.vtt
```

- **MX Player:** Auto-loads if `subs` extra present, or if sub file in same folder as video (but we have remote HLS, not local file, so extra required). Best support.
- **VLC:** Supports `subtitles_location`, but sometimes needs manual selection in UI: Subtitles -> Open subtitles file -> navigate to Download/StreambertSubs/
- **MPV:** Supports `subs`, `sub` extras, auto-loads.
- **Just Player:** ExoPlayer based, supports `subs`.

**File Location:** `/sdcard/Download/StreambertSubs/` is chosen because:
- Accessible to all players (scoped storage allows Downloads)
- User can see files
- MovieBox uses similar `~/storage/downloads/moviebox_subs`
- For Android 10+, use MediaStore to create file in Downloads

**Retention:** Subtitles retained during playback, purged on 24h cycle or via Clear Cache in Settings (like MovieBox).

## Proxy Details

When proxy needed (Cookie, Auth, MX Player + Referer):
- Starts `http://127.0.0.1:<random>/https/<host>/path.m3u8`
- Rewrites HLS playlist:
  - Original: `segment1.ts` (relative) -> Proxy: `http://127.0.0.1:port/https/host/segment1.ts`
  - Original: `https://cdn.example.com/seg.ts` -> Proxy: `http://127.0.0.1:port/https/cdn.example.com/seg.ts`
  - Handles `#EXT-X-KEY:URI="https://.../key"` -> rewritten to proxy
- Forwards Range header for seeking
- Injects all headers for target host, only UA for subtitle host
- Security: 403 if host != targetHost and != subtitleHost (prevents open proxy)
- Watchdog: stops after 10 min idle + 0 connections

## Failure Handling

- **No player:** Return `NO_PLAYER` error, UI shows "No compatible external player installed. Please install VLC, MPV, MX Player..."
- **Player not installed (specific):** Try fallback to next player via `launchWithFallback()`
- **Invalid URL (about:blank):** `INVALID_URL`
- **Proxy failed:** `PROXY_FAILED`, error message includes reason
- **Intent failed:** `INTENT_FAILED`, includes stderr if available (from termux-am)
- **Network:** `NETWORK_ERROR`, timeout 15s

MovieBox's clean exit normalization:
- VLC exit 1 + empty stderr = clean (normal under --play-and-exit)
- SIGTERM 15 = clean (user closed)
- Exit 2 = "Stream Dead: Link expired"
- Exit 1 = "Player Error"

We replicate similar in JS: if launch succeeds but player exits quickly, don't treat as error unless stderr present.

## Android-Specific Diagnostics (from MovieBox)

- **Missing video player:** "No Player: Install a video player."
- **Missing termux-tools:** "Termux Setup: Run 'pkg install termux-tools'."
- **CLI mpv headless:** "CLI mpv: Switch to Android Player in /settings." (Termux mpv pkg is audio-only, no video output)
- **SELinux exit 126:** When trying to exec /system/bin/am from unrooted Termux, Android blocks via SELinux. Detect and prevent, use termux-am instead, preserve LD_PRELOAD.

## Recommendations

- **Default:** System Chooser (`termux-open --chooser`) - shows all players, user picks, no hardcoding
- **For automation:** Allow user to set preferred player in Settings, but still allow chooser button
- **For protected streams:** Always use proxy for reliability, even if player claims header support
- **For subtitles:** Download to shared storage, pass via 9 extras, keep file for manual picker fallback

## Test Matrix

See TESTING.md for 14 test cases.

## Future Players to Investigate

- **Nova Video Player:** `org.courville.nova` (open source, good HLS)
- **Fermata Auto:** `me.aap.fermata.auto` (for Android Auto)
- **Kodi:** `org.xbmc.kodi` (supports intents, but more complex)
- **XPlayer:** `video.player.all.format`
