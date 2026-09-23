// ── Header Handling ────────────────────────────────────────────────────────
// Manages required HTTP headers for protected streams.
// Based on MovieBox-TUI's header handling + Streambert's session UA.

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_HEADERS = {
  "User-Agent": DEFAULT_USER_AGENT,
  "Accept": "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};

/**
 * Build required headers for a given embed source.
 * @param {string} embedUrl - e.g., https://www.vidking.net/embed/movie/123
 * @param {string} sourceId - e.g., "vidking", "vidsrc", "videasy"
 * @param {Object} [extra] - extra headers from provider
 * @returns {Object} headers map
 */
export function buildHeaders(embedUrl, sourceId, extra = {}) {
  const headers = { ...DEFAULT_HEADERS };

  if (embedUrl) {
    try {
      const urlObj = new URL(embedUrl);
      headers["Referer"] = embedUrl;
      headers["Origin"] = urlObj.origin;
    } catch {}
  }

  // Source-specific headers (from Streambert's known behavior)
  switch (sourceId) {
    case "vidsrc":
      // vsembed.su typically needs Referer = https://vsembed.su/ and Origin
      headers["Referer"] = embedUrl || "https://vsembed.su/";
      break;
    case "vidking":
      headers["Referer"] = embedUrl || "https://www.vidking.net/";
      break;
    case "videasy":
      headers["Referer"] = embedUrl || "https://player.videasy.to/";
      break;
    case "allmanga":
      headers["Referer"] = "https://allmanga.to";
      headers["Origin"] = "https://allmanga.to";
      break;
    default:
      break;
  }

  // Merge extra headers (e.g., Cookie, Authorization from provider)
  for (const [k, v] of Object.entries(extra)) {
    if (v) headers[k] = v;
  }

  return headers;
}

/**
 * Convert headers object to array of [key, value] tuples (for MovieBox compat)
 * @param {Object} headers
 * @returns {Array<[string, string]>}
 */
export function headersToArray(headers) {
  return Object.entries(headers).map(([k, v]) => [k, String(v)]);
}

/**
 * Convert array to object
 * @param {Array<[string, string]>} arr
 * @returns {Object}
 */
export function headersArrayToObject(arr) {
  const obj = {};
  for (const [k, v] of arr) obj[k] = v;
  return obj;
}

/**
 * Check if headers require proxy (e.g., Cookie, Authorization that cannot be passed via intent)
 * Based on MovieBox-TUI logic: VLC can receive User-Agent/Referer via flags, but Cookie needs proxy.
 * Android intent via termux-am can only pass User-Agent and Referer as extras, not Cookie.
 * @param {Object} headers
 * @param {Object} player - PlayerInfo
 * @returns {boolean}
 */
export function needsProxy(headers, player) {
  if (!headers) return false;
  const keys = Object.keys(headers).map(k => k.toLowerCase());

  // If Cookie or Authorization present, always need proxy for most players
  if (keys.includes("cookie") || keys.includes("authorization") || keys.includes("auth")) {
    return true;
  }

  // For players that don't support headers at all, need proxy if any custom headers beyond UA
  if (player && !player.supportsHeaders) {
    // If headers contain Referer or custom headers, need proxy
    if (keys.includes("referer") || keys.includes("origin")) return true;
  }

  // Check for custom headers beyond standard ones
  const standard = ["user-agent", "accept", "accept-language", "accept-encoding", "referer", "origin"];
  const hasCustom = keys.some(k => !standard.includes(k));
  if (hasCustom) return true;

  return false;
}

/**
 * Determine if proxy is needed based on headers and stream type
 * @param {Object} headers
 * @param {string} streamType - hls, mp4, etc.
 * @param {Object} player
 * @returns {{needed: boolean, reason: string}}
 */
export function analyzeProxyNeed(headers, streamType, player) {
  if (!headers) return { needed: false, reason: "no headers" };

  const lowerKeys = Object.keys(headers).map(k => k.toLowerCase());

  if (lowerKeys.includes("cookie")) {
    return { needed: true, reason: "Cookie header present (CloudFront/auth) requires proxy for VLC/MX" };
  }
  if (lowerKeys.includes("authorization")) {
    return { needed: true, reason: "Authorization header requires proxy" };
  }

  // HLS with Referer: many Android players ignore Referer extra, so proxy is safer
  // But termux-am does forward Referer, so not always needed. We check player capability.
  if (player && !player.supportsHeaders && lowerKeys.includes("referer")) {
    return { needed: true, reason: `${player.label} doesn't support Referer header directly, proxy needed` };
  }

  // For HLS, if we have custom headers, proxy ensures segments also get headers
  if (streamType === "hls" && lowerKeys.length > 2) {
    // If more than UA + Accept, consider proxy for reliability
    const hasReferer = lowerKeys.includes("referer");
    if (hasReferer && player && player.id === "mxplayer") {
      return { needed: true, reason: "MX Player may ignore Referer extra for HLS segments, proxy recommended" };
    }
  }

  return { needed: false, reason: "headers can be passed via intent extras" };
}

/**
 * Get headers that can be passed via Android intent extras (User-Agent, Referer)
 * @param {Object} headers
 * @returns {Object} filtered headers for intent extras
 */
export function getIntentHeaders(headers) {
  const intentHeaders = {};
  if (!headers) return intentHeaders;
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "user-agent" || lower === "referer") {
      intentHeaders[k] = v;
    }
  }
  return intentHeaders;
}

/**
 * Get all headers that must be injected via proxy
 * @param {Object} headers
 * @returns {Object}
 */
export function getProxyHeaders(headers) {
  return headers || {};
}
