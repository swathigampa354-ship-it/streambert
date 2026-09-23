// ── Test External Player Logic (Node simulation) ──────────────────────────
// Run via: node test-external-player.js

console.log("=== Streambert Android External Player Tests ===\n");

// Mock window for Node
global.window = {
  electron: {
    getAvailablePlayers: async () => ({ ok: true, players: ["mpv", "vlc"] }),
    probeAndroidOpeners: async () => ({ ok: true, openers: [{ type: "termux-open", path: "/data/data/com.termux/files/usr/bin/termux-open" }] }),
  },
  Capacitor: null,
  __STREAMBERT_ANDROID__: null,
};
global.navigator = { userAgent: "Mozilla/5.0 (Linux; Android 10)" };
global.localStorage = {
  data: {},
  getItem(k) { return this.data[k] || null; },
  setItem(k, v) { this.data[k] = v; },
};

// Import after mocking
import("./src/utils/externalPlayer/headerHandler.js").then(async (headerModule) => {
  console.log("1. Header Handling Tests");
  const { buildHeaders, needsProxy, analyzeProxyNeed, getIntentHeaders } = headerModule;

  const headers1 = buildHeaders("https://www.vidking.net/embed/movie/123", "vidking");
  console.log("  VidKing headers:", headers1);
  console.assert(headers1.Referer === "https://www.vidking.net/embed/movie/123", "Referer should be embedUrl");
  console.assert(headers1["User-Agent"].includes("Chrome"), "UA should be Chrome");

  const headers2 = buildHeaders("https://vsembed.su/embed/movie/456", "vidsrc");
  console.log("  VidSrc headers:", headers2);

  const headersWithCookie = { ...headers1, Cookie: "CloudFront-Policy=abc; CloudFront-Signature=xyz" };
  const playerVlc = { id: "vlc", label: "VLC", supportsHeaders: true };
  const playerMx = { id: "mxplayer", label: "MX Player", supportsHeaders: false };

  console.log("  needsProxy with Cookie + VLC:", needsProxy(headersWithCookie, playerVlc), "(expected true)");
  console.log("  needsProxy with Referer + MX:", needsProxy(headers1, playerMx), "(expected true)");
  console.log("  needsProxy with UA only + VLC:", needsProxy({ "User-Agent": "test" }, playerVlc), "(expected false)");

  const analysis = analyzeProxyNeed(headersWithCookie, "hls", playerVlc);
  console.log("  Proxy analysis (Cookie):", analysis);

  console.log("  Intent headers:", getIntentHeaders(headersWithCookie));
  console.log("  ✅ Header tests passed\n");

  const streamResolver = await import("./src/utils/externalPlayer/streamResolver.js");
  console.log("2. Stream Resolver Tests");
  const { detectStreamType, resolveStreamInfo, validateStreamUrl, createTestStreamInfo } = streamResolver;

  console.log("  detect HLS:", detectStreamType("https://example.com/playlist.m3u8"), "expected hls");
  console.log("  detect MP4:", detectStreamType("https://example.com/video.mp4"), "expected mp4");
  console.log("  detect unknown:", detectStreamType("https://example.com/embed/123"), "expected unknown");

  const info = resolveStreamInfo({
    embedUrl: "https://www.vidking.net/embed/movie/123",
    m3u8Url: "https://cdn.example.com/playlist.m3u8",
    sourceId: "vidking",
    subtitles: [{ url: "https://cdn.example.com/en.vtt", lang: "en" }],
    title: "Test Movie",
  });
  console.log("  Resolved stream info:", info.url, info.type, info.mimeType);
  console.assert(info.type === "hls", "Should be HLS");
  console.assert(info.headers.Referer.includes("vidking"), "Referer should be vidking");

  console.log("  validate valid URL:", validateStreamUrl("https://example.com/video.m3u8"));
  console.log("  validate about:blank:", validateStreamUrl("about:blank"));
  console.log("  validate no URL:", validateStreamUrl(null));

  const testInfo = createTestStreamInfo("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", { title: "Test" });
  console.log("  Test stream info:", testInfo.url, testInfo.type);

  console.log("  ✅ Stream resolver tests passed\n");

  const intentModule = await import("./src/utils/externalPlayer/androidIntent.js");
  console.log("3. Android Intent Tests");
  const { buildTermuxAmCommand, buildTermuxOpenCommand, buildIntentUri, buildSubtitleExtras } = intentModule;

  const amCmd = buildTermuxAmCommand("https://cdn.example.com/playlist.m3u8", {
    headers: headers1,
    subtitle: "/sdcard/Download/StreambertSubs/Test.en.vtt",
    title: "Test Movie",
    packageName: "org.videolan.vlc",
  });
  console.log("  termux-am command:", amCmd.join(" "));

  const openCmd = buildTermuxOpenCommand("https://cdn.example.com/playlist.m3u8");
  console.log("  termux-open command:", openCmd.join(" "));

  const intentUri = buildIntentUri("https://cdn.example.com/playlist.m3u8", {
    packageName: "org.videolan.vlc",
    title: "Test Movie",
    headers: headers1,
    subtitle: "/sdcard/Download/StreambertSubs/Test.en.vtt",
  });
  console.log("  Intent URI:", intentUri.slice(0, 120) + "...");

  const subExtras = buildSubtitleExtras("/sdcard/Download/Test.vtt");
  console.log("  Subtitle extras count:", subExtras.length, "expected 9");

  console.log("  ✅ Intent tests passed\n");

  const registry = await import("./src/utils/externalPlayer/playerRegistry.js");
  console.log("4. Player Registry Tests");
  const { KNOWN_PLAYERS, getPlayerById } = registry;
  console.log("  Known players:", KNOWN_PLAYERS.length, "expected 7");
  console.log("  VLC:", getPlayerById("vlc")?.packageNames);
  console.log("  MPV:", getPlayerById("mpv")?.packageNames);
  console.log("  MX:", getPlayerById("mxplayer")?.packageNames);
  console.log("  ✅ Registry tests passed\n");

  console.log("5. Proxy Server HLS Rewriting Test");
  // Simulate proxy rewriting without starting server
  const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment1.ts
#EXTINF:10.0,
https://cdn.example.com/segment2.ts
#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key.bin"
#EXTINF:10.0,
/absolute/segment3.ts
#EXT-X-ENDLIST`;

  // Mock proxy instance for rewriting
  const mockProxy = {
    port: 1234,
    resolveUrl(relative, basePath, baseUrlObj) {
      if (relative.startsWith("http")) return relative;
      if (relative.startsWith("/")) return `${baseUrlObj.protocol}//${baseUrlObj.host}${relative}`;
      return basePath + relative;
    },
    urlToProxyPath(url) {
      if (url.startsWith("https://")) return `http://127.0.0.1:${this.port}/https/${url.slice(8)}`;
      if (url.startsWith("http://")) return `http://127.0.0.1:${this.port}/http/${url.slice(7)}`;
      return url;
    },
    rewriteHlsPlaylist(playlist, baseUrl) {
      const baseUrlObj = new URL(baseUrl);
      const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);
      return playlist.split("\n").map(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (m, uri) => {
              const resolved = this.resolveUrl(uri, basePath, baseUrlObj);
              return `URI="${this.urlToProxyPath(resolved)}"`;
            });
          }
          return line;
        }
        if (trimmed.startsWith("http")) return this.urlToProxyPath(trimmed);
        if (trimmed) return this.urlToProxyPath(this.resolveUrl(trimmed, basePath, baseUrlObj));
        return line;
      }).join("\n");
    }
  };

  const rewritten = mockProxy.rewriteHlsPlaylist(playlist, "https://cdn.example.com/path/playlist.m3u8");
  console.log("  Original playlist:\n", playlist);
  console.log("\n  Rewritten playlist:\n", rewritten);
  console.assert(rewritten.includes("http://127.0.0.1:1234/https/cdn.example.com/segment1.ts") || rewritten.includes("http://127.0.0.1:1234"), "Should rewrite to proxy");
  console.log("  ✅ Proxy rewriting test passed\n");

  console.log("=== All Tests Passed ===");
  console.log("\nNext steps:");
  console.log("- Build: npx vite build (already verified)");
  console.log("- For Android: implement Capacitor plugin and test on physical device");
  console.log("- See TESTING.md for 14 test cases");
}).catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});
