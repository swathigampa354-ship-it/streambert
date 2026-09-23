// ── Subtitle Handler ─────────────────────────────────────────────────────
// Manages subtitle downloading, storage, and intent extra mapping for Android.

/**
 * Extract subtitle language from URL (mirrors Streambert's existing logic)
 * @param {string} url
 * @returns {string}
 */
export function extractSubtitleLang(url) {
  if (!url) return "unknown";
  try {
    const lower = url.toLowerCase();
    // Try to parse lang from URL like .../en.vtt or .../english.vtt or ?lang=en
    const match = lower.match(/[\/_-]([a-z]{2,3})(?:-[a-z]{2})?(?:\.vtt|\.srt|\.ass)/);
    if (match) return match[1];
    const urlObj = new URL(url);
    const langParam = urlObj.searchParams.get("lang") || urlObj.searchParams.get("language");
    if (langParam) return langParam;
  } catch {}
  return "unknown";
}

/**
 * Get subtitle extension from URL
 * @param {string} url
 * @returns {string}
 */
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

/**
 * Generate safe filename for subtitle
 * @param {string} title
 * @param {number} season
 * @param {number} episode
 * @param {string} lang
 * @param {string} ext
 * @returns {string}
 */
export function generateSubtitleFilename(title, season, episode, lang, ext) {
  const safeTitle = (title || "subtitle").replace(/[^a-zA-Z0-9 _-]/g, "").trim().substring(0, 50) || "subtitle";
  if (season != null && episode != null) {
    return `${safeTitle} - S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}.${lang}${ext}`;
  }
  return `${safeTitle}.${lang}${ext}`;
}

/**
 * Get Android shared storage path for subtitles
 * @returns {string}
 */
export function getAndroidSubtitleDir() {
  // MovieBox-TUI uses ~/storage/downloads/moviebox_subs or /sdcard/Download/moviebox_subs
  // For Streambert, use similar: /sdcard/Download/StreambertSubs
  // In Termux, ~/storage/downloads/ is symlink to /sdcard/Download
  if (typeof window !== "undefined" && window.__STREAMBERT_ANDROID__?.subtitleDir) {
    return window.__STREAMBERT_ANDROID__.subtitleDir;
  }
  // Fallback paths to try
  return "/sdcard/Download/StreambertSubs";
}

/**
 * Download subtitle to local file (for Electron/desktop)
 * @param {string} url
 * @param {string} destPath
 * @param {Object} headers
 * @returns {Promise<boolean>}
 */
export async function downloadSubtitle(url, destPath, headers = {}) {
  if (!url) return false;

  // If Electron, use IPC
  if (typeof window !== "undefined" && window.electron?.downloadSubtitlesForFile) {
    try {
      const result = await window.electron.downloadSubtitlesForFile({ url, destPath, headers });
      return !!result?.ok;
    } catch {
      return false;
    }
  }

  // Browser fetch fallback
  try {
    const response = await fetch(url, {
      headers: headers,
    });
    if (!response.ok) return false;
    const blob = await response.blob();
    // In browser, we can't write to filesystem directly; return blob URL
    // For Android, this will be handled by native bridge
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepare subtitle for external player launch
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

  // For Android, we want to download to shared storage
  // For now, return remote URL and intended local path
  // Actual download will be done by native bridge or main process

  const androidDir = getAndroidSubtitleDir();
  const localPath = `${androidDir}/${filename}`;

  // If we're in Electron, try to download via IPC to temp dir
  if (typeof window !== "undefined" && window.electron) {
    // Use Electron's temp handling
    return {
      localPath: null, // will be handled by main process
      remoteUrl: subtitle.url,
      lang,
      filename,
      androidPath: localPath,
    };
  }

  // For Android Capacitor, native bridge will handle download
  return {
    localPath,
    remoteUrl: subtitle.url,
    lang,
    filename,
    androidPath: localPath,
  };
}

/**
 * Prepare multiple subtitles
 * @param {Array} subtitles
 * @param {Object} mediaInfo
 * @param {Object} headers
 * @returns {Promise<Array>}
 */
export async function prepareSubtitlesForPlayer(subtitles, mediaInfo, headers) {
  if (!subtitles || !subtitles.length) return [];
  const results = [];
  for (const sub of subtitles) {
    const prepared = await prepareSubtitleForPlayer(sub, mediaInfo, headers);
    if (prepared) results.push(prepared);
  }
  return results;
}

/**
 * Get best subtitle (e.g., English preferred) for single-subtitle players
 * @param {Array} subtitles
 * @param {string} preferredLang - e.g., "en"
 * @returns {Object|null}
 */
export function getBestSubtitle(subtitles, preferredLang = "en") {
  if (!subtitles || !subtitles.length) return null;
  // Prefer requested lang
  const preferred = subtitles.find(s => s.lang?.toLowerCase().startsWith(preferredLang.toLowerCase()));
  if (preferred) return preferred;
  // Prefer English
  const english = subtitles.find(s => s.lang?.toLowerCase().startsWith("en"));
  if (english) return english;
  // First one
  return subtitles[0];
}
