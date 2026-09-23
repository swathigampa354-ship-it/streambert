// ── External Player Types ───────────────────────────────────────────────────

/**
 * @typedef {Object} PlayerInfo
 * @property {string} id - unique id, e.g. "vlc"
 * @property {string} label - human readable, e.g. "VLC"
 * @property {string[]} packageNames - Android package names
 * @property {string} type - "android" | "desktop" | "system"
 * @property {boolean} supportsHeaders - whether player can receive headers via intent extras
 * @property {boolean} supportsSubtitles - whether player can receive subtitles via intent
 * @property {boolean} supportsHls - HLS support
 * @property {string[]} intentExtras - list of supported subtitle intent extra keys
 * @property {string} detectionMethod - how to detect
 */

/**
 * @typedef {Object} StreamInfo
 * @property {string} url - playable URL (m3u8 or mp4)
 * @property {string} originalUrl - original embed URL
 * @property {string} type - "hls" | "mp4" | "dash" | "unknown"
 * @property {Object} headers - required headers map
 * @property {string} [headers.User-Agent]
 * @property {string} [headers.Referer]
 * @property {string} [headers.Origin]
 * @property {string} [headers.Cookie]
 * @property {string} [headers.Authorization]
 * @property {Array<{url: string, lang: string, label?: string}>} subtitles
 * @property {string} [title]
 * @property {number} [season]
 * @property {number} [episode]
 * @property {string} [mimeType] - e.g. "video/*", "application/x-mpegURL"
 * @property {string} sourceId - e.g. "vidking", "vidsrc"
 */

/**
 * @typedef {Object} LaunchResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {string} [errorCode] - machine readable
 * @property {PlayerInfo} [player]
 * @property {string} [launchedUrl] - actual URL launched (may be proxy URL)
 * @property {boolean} [usedProxy]
 * @property {string} [proxyUrl]
 */

export const PlayerKind = {
  VLC: "vlc",
  MPV: "mpv",
  MX_PLAYER: "mxplayer",
  MX_PLAYER_PRO: "mxplayer-pro",
  JUST_PLAYER: "justplayer",
  NEXT_PLAYER: "nextplayer",
  ANDROID_SYSTEM: "android-system",
  SYSTEM_DEFAULT: "system-default",
};

export const StreamType = {
  HLS: "hls",
  MP4: "mp4",
  DASH: "dash",
  UNKNOWN: "unknown",
};

export const ErrorCodes = {
  NO_PLAYER: "NO_PLAYER",
  PLAYER_NOT_INSTALLED: "PLAYER_NOT_INSTALLED",
  INVALID_URL: "INVALID_URL",
  HEADERS_REQUIRED: "HEADERS_REQUIRED",
  PROXY_FAILED: "PROXY_FAILED",
  INTENT_FAILED: "INTENT_FAILED",
  NETWORK_ERROR: "NETWORK_ERROR",
  UNKNOWN: "UNKNOWN",
};
