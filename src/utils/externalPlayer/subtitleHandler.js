// ── Subtitle Handler ─────────────────────────────────────────────────────
// Fixed: Android path uses native bridge, no Electron dependency in pure Android runtime.

import { getPlatform, PLATFORM } from "../platform.js";

/**
 * Extract subtitle language from URL (mirrors Streambert's existing logic)
 * @param {string} url
 * @returns {string}
 */
export function extractSubtitleLang(url) {
  if (!url) return "unknown";
  try {
    const lower = url.toLowerCase();
    const match = lower.match(/[\/_-]([a-z]{2,3})(?:-[a-z]{2})?(?:\.vtt|\.srt|\.ass)/);
    if (match) return match[1];
    const urlObj = new URL(url);
    const langParam = urlObj.searchParams.get("lang") || urlObj.searchParams.get("language");
    if (langParam) return langParam;
  } catch {}
  return "unknown";
}

export function getSubtitleExtension(url) {
  if (!url) return ".srt";
  const lower = url.toLowerCase();
  if (lower.includes(".vtt")) return ".vtt";
  if (lower.includes(".ass")) return ".ass";
  if (lower.includes(".ssa")) return ".ssa";
  if (lower.includes(".srt")) return ".srt";
  if (lower.includes(".sub")) return ".sub";
  return ".srt";
}

export function generateSubtitleFilename(title, season, episode, lang, ext) {
  const safeTitle = (title || "subtitle").replace(/[^a-zA-Z0-9 _-]/g, "").trim().substring(0, 50) || "subtitle";
  if (season != null && episode != null) {
    return `${safeTitle} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}.${lang}${ext}`;
  }
  return `${safeTitle}.${lang}${ext}`;
}

/**
 * Get Android shared storage path for subtitles
 * Android native path: /sdcard/Download/StreambertSubs (no Electron)
 * @returns {string}
 */
export function getAndroidSubtitleDir() {
  // Try native bridge first (pure Android, no Electron)
  if (typeof window !== "undefined") {
    if (window.StreambertNative?.subtitleDir) {
      return window.StreambertNative.subtitleDir;
    }
    // For Capacitor, the bridge will provide dir via async method, but sync fallback:
    if (window.Capacitor) {
      return "/sdcard/Download/StreambertSubs";
    }
  }
  return "/sdcard/Download/StreambertSubs";
}

/**
 * Download subtitle to local file
 * Desktop: uses Electron IPC (isolated, not in Android path)
 * Android: uses native bridge (no Electron)
 * Web: fetch blob (fallback)
 * @param {string} url
 * @param {string} destPath
 * @param {Object} headers
 * @returns {Promise<boolean>}
 */
export async function downloadSubtitle(url, destPath, headers = {}) {
  if (!url) return false;

  const platform = getPlatform();

  if (platform === PLATFORM.DESKTOP) {
    // Desktop only: Electron IPC
    if (typeof window !== "undefined" && window.electron?.downloadSubtitlesForFile) {
      try {
        const result = await window.electron.downloadSubtitlesForFile({ url, destPath, headers });
        return !!result?.ok;
      } catch {
        return false;
      }
    }
  } else if (platform === PLATFORM.ANDROID) {
    // Android: native bridge (no Electron)
    try {
      const { downloadSubtitleNative } = await import("./androidBridge.js");
      const filename = destPath.split("/").pop() || "subtitle.srt";
      const result = await downloadSubtitleNative(url, filename, headers);
      return !!result;
    } catch {
      return false;
    }
  }

  // Web fallback
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return false;
    await response.blob();
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepare subtitle for external player launch
 * Android path: NO Electron, uses native bridge for download to shared storage
 * @param {Object} subtitle - {url, lang}
 * @param {Object} mediaInfo - {title, season, episode}
 * @param {Object} headers
 * @returns {Promise<{localPath: string|null, remoteUrl: string, lang: string}>}
 */
export async function prepareSubtitleForPlayer(subtitle, mediaInfo = {}, headers = {}) {
  if (!subtitle?.url) return null;

  const lang = subtitle.lang || extractSubtitleLang(subtitle.url);
  const ext = getSubtitleExtension(subtitle.url);
  const filename = generateSubtitleFilename(
    mediaInfo.title,
    mediaInfo.season,
    mediaInfo.episode,
    lang,
    ext
  );

  const androidDir = getAndroidSubtitleDir();
  const localPath = `${androidDir}/${filename}`;

  const platform = getPlatform();

  if (platform === PLATFORM.DESKTOP) {
    // Desktop: Electron handles temp
    return {
      localPath: null,
      remoteUrl: subtitle.url,
      lang,
      filename,
      androidPath: localPath,
    };
  } else if (platform === PLATFORM.ANDROID) {
    // Android: try native download, but return intended path immediately
    // Actual download will be done by caller via androidBridge
    return {
      localPath,
      remoteUrl: subtitle.url,
      lang,
      filename,
      androidPath: localPath,
    };
  }

  // Web
  return {
    localPath,
    remoteUrl: subtitle.url,
    lang,
    filename,
    androidPath: localPath,
  };
}

export async function prepareSubtitlesForPlayer(subtitles, mediaInfo, headers) {
  if (!subtitles || !subtitles.length) return [];
  const results = [];
  for (const sub of subtitles) {
    const prepared = await prepareSubtitleForPlayer(sub, mediaInfo, headers);
    if (prepared) results.push(prepared);
  }
  return results;
}

export function getBestSubtitle(subtitles, preferredLang = "en") {
  if (!subtitles || !subtitles.length) return null;
  const preferred = subtitles.find(s => s.lang?.toLowerCase().startsWith(preferredLang.toLowerCase()));
  if (preferred) return preferred;
  const english = subtitles.find(s => s.lang?.toLowerCase().startsWith("en"));
  if (english) return english;
  return subtitles[0];
}
