// ── Stream Resolver ──────────────────────────────────────────────────────
// Resolves playable stream URL + headers + subtitles from Streambert's
// existing player infrastructure (webview m3u8 intercept + AllManga).

import { buildHeaders, analyzeProxyNeed } from "./headerHandler.js";
import { StreamType } from "./types.js";

/**
 * Detect stream type from URL
 * @param {string} url
 * @returns {string}
 */
export function detectStreamType(url) {
  if (!url) return StreamType.UNKNOWN;
  const lower = url.toLowerCase();
  if (lower.includes(".m3u8") || lower.includes("application/vnd.apple.mpegurl") || lower.includes("application/x-mpegurl")) {
    return StreamType.HLS;
  }
  if (lower.includes(".mpd") || lower.includes("dash")) {
    return StreamType.DASH;
  }
  if (lower.match(/\.(mp4|mkv|avi|mov|webm|m4v|ts)($|\?)/)) {
    return StreamType.MP4;
  }
  // Default to HLS for streaming sites, MP4 for direct
  return StreamType.UNKNOWN;
}

/**
 * Get MIME type for stream
 * @param {string} streamType
 * @returns {string}
 */
export function getMimeType(streamType) {
  switch (streamType) {
    case StreamType.HLS:
      return "application/x-mpegURL";
    case StreamType.DASH:
      return "application/dash+xml";
    case StreamType.MP4:
      return "video/mp4";
    default:
      return "video/*";
  }
}

/**
 * Resolve stream info from current player state
 * This is the core function that takes Streambert's intercepted m3u8 + embed URL
 * and produces a StreamInfo suitable for external player.
 *
 * @param {Object} params
 * @param {string} params.embedUrl - e.g., https://www.vidking.net/embed/movie/123
 * @param {string} [params.m3u8Url] - intercepted m3u8 URL
 * @param {string} params.sourceId - e.g., "vidking"
 * @param {Array} [params.subtitles] - [{url, lang}]
 * @param {string} [params.title]
 * @param {number} [params.season]
 * @param {number} [params.episode]
 * @param {Object} [params.extraHeaders] - additional headers from provider
 * @returns {Object} StreamInfo
 */
export function resolveStreamInfo(params) {
  const {
    embedUrl,
    m3u8Url,
    sourceId,
    subtitles = [],
    title,
    season,
    episode,
    extraHeaders = {},
  } = params;

  // Primary URL: use intercepted m3u8 if available, else embedUrl (for direct mp4 sources like AllManga)
  let primaryUrl = m3u8Url || embedUrl;

  // For AllManga, m3u8Url may actually be direct mp4 URL set via setPlayerVideo
  // Detect if primaryUrl is still an embed page (contains /embed/) and no m3u8 available
  // In that case, we cannot resolve direct stream yet - need to wait for interception
  const isEmbedPage = primaryUrl && (primaryUrl.includes("/embed/") || primaryUrl.includes("player.videasy.to") || primaryUrl.includes("vsembed.su"));

  if (isEmbedPage && !m3u8Url) {
    // We have only embed page, no direct stream yet
    // For external player, we can still try to launch embed page? But requirement says resolve playable stream.
    // Return embedUrl with note that it needs further resolution
    // The actual m3u8 will be captured by webview; caller should wait.
    console.warn("[StreamResolver] Only embed URL available, no m3u8 yet. Need to wait for interception.");
  }

  const streamType = detectStreamType(primaryUrl);
  const mimeType = getMimeType(streamType);
  const headers = buildHeaders(embedUrl, sourceId, extraHeaders);

  // For AllManga direct MP4, headers may include Referer = https://allmanga.to
  // That's already handled in buildHeaders

  return {
    url: primaryUrl,
    originalUrl: embedUrl,
    type: streamType,
    mimeType,
    headers,
    subtitles,
    title,
    season,
    episode,
    sourceId,
    isEmbedPage: isEmbedPage && !m3u8Url,
    requiresProxyCheck: true,
  };
}

/**
 * Wait for m3u8 URL to be intercepted (for embed sources)
 * @param {Function} getM3u8Url - function that returns current m3u8Url
 * @param {number} timeoutMs - timeout in ms, default 15000
 * @param {number} pollInterval - poll interval ms, default 500
 * @returns {Promise<string|null>}
 */
export function waitForM3u8(getM3u8Url, timeoutMs = 15000, pollInterval = 500) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const url = getM3u8Url();
      if (url) {
        resolve(url);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      setTimeout(check, pollInterval);
    };
    check();
  });
}

/**
 * Validate stream URL
 * @param {string} url
 * @returns {{valid: boolean, error?: string}}
 */
export function validateStreamUrl(url) {
  if (!url) return { valid: false, error: "No URL provided" };
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol)) {
      return { valid: false, error: `Unsupported protocol: ${u.protocol}` };
    }
    // Check for obviously invalid URLs
    if (url === "about:blank" || url.includes("about:blank")) {
      return { valid: false, error: "URL is about:blank" };
    }
    return { valid: true };
  } catch (e) {
    return { valid: false, error: `Invalid URL: ${e.message}` };
  }
}

/**
 * Enrich stream info with proxy analysis
 * @param {Object} streamInfo
 * @param {Object} player - PlayerInfo
 * @returns {Object} enriched streamInfo
 */
export function enrichWithProxyAnalysis(streamInfo, player) {
  const analysis = analyzeProxyNeed(streamInfo.headers, streamInfo.type, player);
  return {
    ...streamInfo,
    proxyAnalysis: analysis,
    needsProxy: analysis.needed,
    proxyReason: analysis.reason,
  };
}

/**
 * Create stream info for testing / direct URL
 * @param {string} url
 * @param {Object} options
 * @returns {Object}
 */
export function createTestStreamInfo(url, options = {}) {
  const {
    title = "Test Stream",
    sourceId = "test",
    headers = {},
    subtitles = [],
  } = options;

  return {
    url,
    originalUrl: url,
    type: detectStreamType(url),
    mimeType: getMimeType(detectStreamType(url)),
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ...headers,
    },
    subtitles,
    title,
    sourceId,
    isEmbedPage: false,
  };
}
