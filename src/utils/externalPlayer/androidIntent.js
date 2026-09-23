// ── Android Intent Builder ────────────────────────────────────────────────
// Builds Android intents for external player launching.
// Mirrors MovieBox-TUI's android_intent_command_for_opener logic.

import { getIntentHeaders } from "./headerHandler.js";

/**
 * Build intent extras for subtitles (multiple keys for compatibility as MovieBox does)
 * @param {string} subtitlePath - local file path or URL
 * @returns {Array<{flag: string, key: string, value: string}>}
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
 * Build intent extras for headers (User-Agent, Referer)
 * @param {Object} headers
 * @returns {Array<{flag: string, key: string, value: string}>}
 */
export function buildHeaderExtras(headers) {
  const extras = [];
  const intentHeaders = getIntentHeaders(headers);
  for (const [k, v] of Object.entries(intentHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "user-agent") {
      extras.push({ flag: "-e", key: "User-Agent", value: v });
    } else if (lower === "referer") {
      extras.push({ flag: "-e", key: "Referer", value: v });
    }
  }
  return extras;
}

/**
 * Build a termux-am command (as array) for launching external player
 * @param {string} url - stream URL (or proxy URL)
 * @param {Object} options
 * @param {string} [options.subtitle] - subtitle file path
 * @param {Object} [options.headers]
 * @param {string} [options.packageName] - specific package to target, e.g., org.videolan.vlc
 * @param {string} [options.title]
 * @param {string} [options.mimeType] - default video/*
 * @returns {string[]} command args
 */
export function buildTermuxAmCommand(url, options = {}) {
  const {
    subtitle,
    headers = {},
    packageName,
    title,
    mimeType = "video/*",
  } = options;

  const cmd = ["termux-am", "start", "-a", "android.intent.action.VIEW", "-d", url, "-t", mimeType];

  if (packageName) {
    cmd.push("-n", packageName);
  }

  // Title extra
  if (title) {
    cmd.push("-e", "title", title);
    cmd.push("-e", "android.intent.extra.TITLE", title);
  }

  // Header extras
  const headerExtras = buildHeaderExtras(headers);
  for (const { flag, key, value } of headerExtras) {
    cmd.push(flag, key, value);
  }

  // Subtitle extras
  if (subtitle) {
    const subExtras = buildSubtitleExtras(subtitle);
    for (const { flag, key, value } of subExtras) {
      cmd.push(flag, key, value);
    }
  }

  return cmd;
}

/**
 * Build termux-open command
 * @param {string} url
 * @param {Object} options
 * @returns {string[]}
 */
export function buildTermuxOpenCommand(url, options = {}) {
  const { mimeType = "video/*" } = options;
  return ["termux-open", "--chooser", "--content-type", mimeType, url];
}

/**
 * Build termux-open-url command
 * @param {string} url
 * @returns {string[]}
 */
export function buildTermuxOpenUrlCommand(url) {
  return ["termux-open-url", url];
}

/**
 * Build Android Intent URI for use with Capacitor or Web Intent API
 * @param {string} url
 * @param {Object} options
 * @returns {string} intent URI
 */
export function buildIntentUri(url, options = {}) {
  const {
    packageName,
    mimeType = "video/*",
    title,
    headers = {},
    subtitle,
  } = options;

  // Basic intent URI: intent://<host>#Intent;action=android.intent.action.VIEW;type=video/*;S.title=...;S.Referer=...;end
  // For simplicity, we use the full URL as data
  // Format: intent:<url>#Intent;action=VIEW;type=video/*;S.Referer=...;S.User-Agent=...;end

  let intent = `intent:${url}#Intent;`;
  intent += `action=android.intent.action.VIEW;`;
  intent += `type=${mimeType};`;

  if (packageName) {
    intent += `package=${packageName};`;
  }

  if (title) {
    // Escape semicolons
    const escTitle = title.replace(/;/g, "%3B");
    intent += `S.title=${escTitle};`;
    intent += `S.android.intent.extra.TITLE=${escTitle};`;
  }

  // Headers
  const intentHeaders = getIntentHeaders(headers);
  for (const [k, v] of Object.entries(intentHeaders)) {
    const lower = k.toLowerCase();
    const escVal = String(v).replace(/;/g, "%3B");
    if (lower === "user-agent") {
      intent += `S.User-Agent=${escVal};`;
    } else if (lower === "referer") {
      intent += `S.Referer=${escVal};`;
    }
  }

  // Subtitles
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
 * Build Capacitor AppLauncher intent options
 * @param {string} url
 * @param {Object} options
 * @returns {Object}
 */
export function buildCapacitorIntentOptions(url, options = {}) {
  const {
    packageName,
    mimeType = "video/*",
    title,
    headers = {},
    subtitle,
  } = options;

  const extras = {};

  if (title) {
    extras["title"] = title;
    extras["android.intent.extra.TITLE"] = title;
  }

  // Headers
  const intentHeaders = getIntentHeaders(headers);
  for (const [k, v] of Object.entries(intentHeaders)) {
    const lower = k.toLowerCase();
    if (lower === "user-agent") {
      extras["User-Agent"] = v;
    } else if (lower === "referer") {
      extras["Referer"] = v;
    }
  }

  // Subtitles - multiple keys
  if (subtitle) {
    extras["subtitles_location"] = subtitle;
    extras["subs"] = subtitle;
    extras["sub"] = subtitle;
    extras["title_subtitle"] = subtitle;
    extras["subs.enable"] = subtitle;
  }

  return {
    url,
    packageName,
    mimeType,
    extras,
    action: "android.intent.action.VIEW",
  };
}

/**
 * Build web Intent for navigator.share or window.open fallback
 * @param {string} url
 * @param {Object} options
 * @returns {Object}
 */
export function buildWebIntent(url, options = {}) {
  const { mimeType = "video/*" } = options;
  return {
    url,
    mimeType,
    // For web, we can only open URL directly
    // Headers and subs cannot be passed, so proxy is required if headers needed
  };
}

/**
 * Determine best opener based on environment
 * @returns {string} opener type
 */
export function detectBestOpener() {
  if (typeof window !== "undefined") {
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      return "capacitor-intent";
    }
    if (window.__STREAMBERT_ANDROID__ && window.__STREAMBERT_ANDROID__.hasTermuxAm) {
      return "termux-am";
    }
    if (window.__STREAMBERT_ANDROID__ && window.__STREAMBERT_ANDROID__.hasTermuxOpen) {
      return "termux-open";
    }
    // Check for Termux via user agent? Fallback to web intent
    if (navigator.userAgent && /Android/i.test(navigator.userAgent)) {
      return "web-intent";
    }
  }
  return "web-intent";
}
