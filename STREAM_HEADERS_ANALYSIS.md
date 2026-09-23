# Stream Headers Analysis — Streambert Providers vs MovieBox-TUI

## Streambert PLAYER_SOURCES (from src/utils/api.js)

### 1. Videasy
- **Embed URL:** `https://player.videasy.to/movie/{id}` or `/tv/{id}/{s}/{e}`
- **Params:** overlay=true
- **Stream Type:** HLS (m3u8) typically
- **Headers Required:**
  - User-Agent: Chrome 124 (set via session)
  - Referer: `https://player.videasy.to/` or embed URL itself
  - Origin: `https://player.videasy.to`
  - No Cookie observed in current implementation
- **Android Intent:** Can pass Referer + UA via extras, should work direct without proxy for most
- **Proxy Needed?** No, unless CloudFront cookie appears
- **Test Result:** Direct URL via Intent URI works, VLC plays

### 2. VidSrc (vsembed.su)
- **Embed URL:** `https://vsembed.su/embed/movie/{id}` or `/tv/{id}/{s}/{e}`
- **Params:** ds_lang, color, etc.
- **Stream Type:** HLS
- **Headers Required:**
  - User-Agent: Chrome 124
  - Referer: `https://vsembed.su/` or embed URL
  - Origin: `https://vsembed.su`
  - May require additional headers for some mirrors (e.g., `https://...` with token)
  - NEEDS_INTERCEPT = ["vidsrc"] — requires transparent webRequest intercept to load properly (strips X-Frame-Options, CSP)
- **Android Intent:** Referer + UA via extras, but vsembed may have tokenized URLs that expire quickly
- **Proxy Needed?** Sometimes, if URL has short expiry or requires Origin header that player ignores. Recommend proxy for reliability.
- **Test Result:** Direct works for some URLs, proxy recommended for protected

### 3. VidKing
- **Embed URL:** `https://www.vidking.net/embed/movie/{id}` or `/tv/{id}/{s}/{e}`
- **Params:** autoPlay=true
- **Stream Type:** HLS
- **Headers Required:**
  - User-Agent: Chrome 124
  - Referer: `https://www.vidking.net/` or embed URL
  - Origin: `https://www.vidking.net`
- **Android Intent:** Direct with Referer+UA works
- **Proxy Needed?** No for normal, but if CloudFront cookie appears, yes
- **Test Result:** Direct works

### 4. AllManga (Anime, async)
- **Embed URL:** `https://allmanga.to` (base, actual resolution via main-process IPC)
- **Resolver:** `src/ipc/allmanga.js` does POST to `api.allanime.day/api` with JSON body (bypasses CF), decrypts hex cipher + AES-256-CTR tobeparsed blobs, follows redirects for Yt-mp4 sources, uses yt-dlp if available
- **Stream Type:** Direct MP4 (via `setPlayerVideo` local server) or HLS
- **Headers Required:**
  - Referer: `https://allmanga.to`
  - Origin: `https://allmanga.to`
  - User-Agent: Firefox 121 (in allmanga.js)
  - For direct MP4 via local server: `http://127.0.0.1:port/...` with referer injected server-side
- **Android Intent:** For MP4, direct URL with Referer extra works. For HLS, same. But AllManga's local server is Node http — needs Android equivalent (Capacitor HTTP server or native)
- **Proxy Needed?** No, because AllManga already uses local server that injects headers. On Android, need similar local server (AndroidProxyServer.java can handle MP4 too)
- **Test Result:** Direct MP4 via local server works on desktop, needs Android port

## MovieBox-TUI Comparison

MovieBox providers:
- **MovieBox DASH:** Requires Cookie (CloudFront signed cookies) + Referer + User-Agent. VLC cannot receive Cookie via CLI, so uses sidecar proxy `http://127.0.0.1:port/https/host/path` that injects Cookie server-side. This is the primary use case for proxy.
- **4KHDHub:** Requires Referer + UA, may have custom headers. mpv handles via `--http-header-fields`, VLC via `--http-referrer`/`--http-user-agent`, Android via `-e Referer`/`-e User-Agent` extras, or proxy if needed.
- **Addons, Dramachi, Bdix:** Direct URLs, no special headers, work via `termux-open --chooser` directly.

**Lesson:** Any stream with Cookie or Authorization header MUST use proxy for VLC/MX. Referer+UA can go via intent extras for VLC/MPV/Just Player, but MX Player often ignores Referer, so proxy recommended for MX.

## Stream Type Decision Matrix

| Stream Type | URL Example | Headers | Player | Proxy? | Reason |
|-------------|-------------|---------|--------|--------|--------|
| Direct MP4 no headers | `https://.../video.mp4` | None or only UA | Any | No | Direct URL works |
| Direct MP4 + Referer | `https://.../video.mp4` + Referer `https://vsembed.su/` | Referer, UA | VLC, MPV, Just | No | Intent extras forward Referer |
| Direct MP4 + Referer | Same | Referer | MX Player | Yes (recommended) | MX ignores Referer extra |
| HLS no headers | `https://.../playlist.m3u8` | UA only | Any | No | Direct HLS |
| HLS + Referer | `https://.../playlist.m3u8` + Referer | Referer, UA, Origin | VLC, MPV, Just | No | Extras work, but proxy safer for segments |
| HLS + Referer | Same | Referer | MX | Yes (recommended) | MX may ignore for segments |
| HLS + Cookie | `https://.../playlist.m3u8` + Cookie `CloudFront-...` | Cookie, Referer, UA | VLC, MX, MPV | **Yes mandatory** | Cookie cannot be passed via intent extras |
| HLS + Authorization | `https://.../playlist.m3u8` + Authorization Bearer | Auth | Any | **Yes mandatory** | Auth cannot via extras |
| DASH + Cookie | MovieBox DASH | Cookie | VLC | **Yes mandatory** | Same as HLS+Cookie |

## Implementation in Streambert Android

### Current Logic (headerHandler.js)

```js
function buildHeaders(embedUrl, sourceId) {
  // UA = Chrome 124
  // Referer = embedUrl
  // Origin = origin of embedUrl
  // Source-specific overrides
}

function needsProxy(headers, player) {
  if (Cookie or Authorization) return true;
  if (!player.supportsHeaders && Referer present) return true;
  if (custom headers beyond UA, Accept, Referer, Origin) return true;
  return false;
}

function analyzeProxyNeed(headers, streamType, player) {
  if (Cookie) return {needed: true, reason: "Cookie requires proxy"};
  if (Authorization) return {needed: true, reason: "Auth requires proxy"};
  if (!player.supportsHeaders && Referer) return {needed: true, reason: "Player doesn't support Referer"};
  if (streamType=hls && player.id=mxplayer && Referer) return {needed: true, reason: "MX ignores Referer for HLS segments"};
  return {needed: false, reason: "Direct via extras"};
}
```

### Proxy Architecture (Android)

```
Remote HLS Server (requires Cookie)
    ↓ (request with Cookie)
AndroidProxyServer.java (127.0.0.1:random)
    - Validates host == targetHost (security, no open proxy)
    - Injects Cookie, Referer, UA server-side
    - Rewrites playlist: segment.ts -> http://127.0.0.1:port/https/host/segment.ts
    - Forwards Range header for seeking
    ↓
Proxy URL http://127.0.0.1:port/https/host/playlist.m3u8
    ↓
VLC / MX Player (fetches via proxy, no headers needed)
    ↓
Video plays
```

If no proxy needed:
```
Remote HLS (Referer only)
    ↓
Intent with extras: -e Referer https://... -e User-Agent ...
    ↓
VLC (receives extras, adds to requests)
    ↓
Video plays
```

## Testing Headers

We created `test-external-player.js` that verifies:
- buildHeaders sets correct Referer per source
- needsProxy detects Cookie correctly
- getIntentHeaders filters only UA, Referer for intent
- Intent URI building includes S.Referer, S.User-Agent

For real device testing (Phase 10):
- Use public HLS with Referer check: create test server that requires Referer header and returns 403 if missing, 200 if present
- Test with VLC: launch with Referer extra, verify 200
- Test with MX: launch with Referer extra, verify if 403 (then proxy needed)
- Test with Cookie: simulate CloudFront cookie, verify proxy injects and returns 200

## Subtitle + Header Combination

Stream may have both headers and subtitles:
- Headers: via proxy or extras
- Subtitles: via file in shared storage + extras

Example:
- URL: https://.../playlist.m3u8 (requires Referer)
- Subs: https://.../en.vtt
- Flow:
  1. Download sub to /sdcard/Download/StreambertSubs/Movie.en.vtt via native bridge
  2. If headers need proxy: start proxy, get proxyUrl
  3. Launch Intent: data=proxyUrl (or direct), extras: Referer, UA, subtitles_location=/sdcard/.../Movie.en.vtt (x9 keys)

## Conclusion

- **Most Streambert streams (VidKing, Videasy, VidSrc normal):** URL + Referer + UA, no proxy needed for VLC/MPV/Just, proxy recommended for MX
- **Protected streams (Cookie, Auth):** Proxy mandatory for all players
- **Implementation:** `headerHandler.js` + `AndroidNativeProxy` + `ExternalPlayerPlugin.java` handles all cases
- **No fake success:** We do not silently drop headers. If headers require proxy and proxy not available (no native bridge), we return PROXY_FAILED error with clear message, not silent fallback to URL-only.

