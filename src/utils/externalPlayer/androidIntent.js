// ── Android Intent Builder ────────────────────────────────────────────────
// Real Android-native Intent building without Termux/Electron dependencies.
// Termux commands are kept only as legacy reference, NOT used in pure Android runtime.

import { getIntentHeaders } from "./headerHandler.js";

/**
 * Build intent extras for subtitles (multiple keys for compatibility as MovieBox does)
 * @param {string} subtitlePath - local file path or URL
 * @returns {Array<{flag: string, key: string, value: string}>} For Termux compatibility (legacy)
 */
export function buildSubtitleExtras(subtitlePath) {
  if (!subtitlePath) return [];
  // MovieBox sends same subtitle via many extra keys for max compatibility
  return [
    { flag: "-e", key: "subtitles_location", value: subtitlePath },
    { flag: "--eu", key: "subtitles_location", value: subtitlePath },
    { flag: "-e", key: "subs", value: subtitlePath },
    { flag: "--esal", key: "subs", value: subtitlePath },
    { flag: "-e", key: "subs.enable", value: subtitlePath },
    { flag: "--esal", key: "subs.enable", value: subtitlePath },
    { flag: "-e", key: "sub", value: subtitlePath },
    { flag: "--eu", key: "sub", value: subtitlePath },
    { flag: "-e", key: "title_subtitle", value: subtitlePath },
  ];
}

/**
 * Build subtitle extras as plain object for native Intent (Android native, no Termux flags)
 * @param {string} subtitlePath
 * @returns {Object} extras map
 */
export function buildSubtitleExtrasNative(subtitlePath) {
  if (!subtitlePath) return {};
  return {
    "subtitles_location": subtitlePath,
    "subs": subtitlePath,
    "sub": subtitlePath,
    "title_subtitle": subtitlePath,
    "subs.enable": subtitlePath,
  };
}

/**
 * Build intent extras for headers (User-Agent, Referer) - Termux flag format (legacy)
 * @param {Object} headers
 * @returns {Array<{flag: string, key: string, value: string}>}
 */
export function buildHeaderExtras(headers) {
  const extras = [];
  const intentHeaders = getIntentHeaders(headers);
  for (const [k, v] of Object.entries(intentHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "user-agent") extras.push({ flag: "-e", key: "User-Agent", value: v });
    else if (lower === "referer") extras.push({ flag: "-e", key: "Referer", value: v });
  }
  return extras;
}

/**
 * Build header extras as plain object for native Intent (Android native)
 * @param {Object} headers
 * @returns {Object}
 */
export function buildHeaderExtrasNative(headers) {
  const extras = {};
  const intentHeaders = getIntentHeaders(headers);
  for (const [k, v] of Object.entries(intentHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "user-agent") extras["User-Agent"] = v;
    else if (lower === "referer") extras["Referer"] = v;
  }
  return extras;
}





// ── REAL Android-native implementations (no Termux, no Electron) ──

/**
 * Build Android intent:// URI for the Linking fallback (Chrome/WebView, no native module)
 * This is REAL Android mechanism, works in Chrome/WebView without Termux/Electron
 * @param {string} url
 * @param {Object} options
 * @returns {string} intent URI
 */
export function buildIntentUri(url, options = {}) {
  const { packageName, mimeType = "video/*", title, headers = {}, subtitle } = options;

  let intent = `intent:${url}#Intent;`;
  intent += `action=android.intent.action.VIEW;`;
  intent += `type=${mimeType};`;

  if (packageName) intent += `package=${packageName};`;

  if (title) {
    const escTitle = title.replace(/;/g, "%3B");
    intent += `S.title=${escTitle};`;
    intent += `S.android.intent.extra.TITLE=${escTitle};`;
  }

  const intentHeaders = getIntentHeaders(headers);
  for (const [k, v] of Object.entries(intentHeaders)) {
    const lower = k.toLowerCase();
    const escVal = String(v).replace(/;/g, "%3B");
    if (lower === "user-agent") intent += `S.User-Agent=${escVal};`;
    else if (lower === "referer") intent += `S.Referer=${escVal};`;
  }

  if (subtitle) {
    const escSub = subtitle.replace(/;/g, "%3B");
    intent += `S.subtitles_location=${escSub};`;
    intent += `S.subs=${escSub};`;
    intent += `S.sub=${escSub};`;
  }

  intent += `end`;
  return intent;
}

/**
 * Build native Intent options for custom StreambertNative bridge
 * @param {string} url
 * @param {Object} options
 * @returns {Object}
 */
export function buildNativeIntentOptions(url, options = {}) {
  const { packageName, mimeType = "video/*", title, headers = {}, subtitle } = options;
  return {
    url,
    packageName: packageName || null,
    mimeType,
    title: title || null,
    headers: buildHeaderExtrasNative(headers),
    subtitle: subtitle || null,
    extras: {
      ...buildHeaderExtrasNative(headers),
      ...buildSubtitleExtrasNative(subtitle),
      ...(title ? { title, "android.intent.extra.TITLE": title } : {}),
    },
  };
}

/**
 * Build web Intent fallback (direct URL, no headers/subs, requires proxy if headers needed)
 * @param {string} url
 * @param {Object} options
 * @returns {Object}
 */
export function buildWebIntent(url, options = {}) {
  const { mimeType = "video/*" } = options;
  return { url, mimeType };
}

/**
 * Determine best opener for pure Android runtime (no Termux, no Electron)
 * @returns {string} opener type
 */
export function detectBestOpener() {
  if (typeof window !== "undefined") {
    // Real Android native
    if (window.StreambertNative) return "streambert-native";
    if (window.AndroidBridge && typeof window.AndroidBridge.getInstalledPlayers === "function") {
      return "android-bridge";
    }
    // Pure web Intent URI fallback (works on Android Chrome without any bridge)
    if (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) {
      return "intent-uri";
    }
  }
  return "web-intent";
}
