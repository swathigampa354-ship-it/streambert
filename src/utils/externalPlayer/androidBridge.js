// ── Android Native Bridge ────────────────────────────────────────────────
// Real Android-native playback bridge without Electron/Node/Termux dependencies.
// Uses Capacitor plugins or custom native bridge (StreambertNative) or pure Intent URI fallback.

import { KNOWN_PLAYERS } from "./playerRegistry.js";

/**
 * Check if Capacitor ExternalPlayer plugin is available
 * @returns {boolean}
 */
function hasCapacitorExternalPlayerPlugin() {
  if (typeof window === "undefined") return false;
  if (!window.Capacitor) return false;
  const plugins = window.Capacitor.Plugins || {};
  return !!plugins.ExternalPlayer;
}

/**
 * Check if custom StreambertNative bridge is available (for APK)
 * @returns {boolean}
 */
function hasStreambertNativeBridge() {
  if (typeof window === "undefined") return false;
  return !!window.StreambertNative;
}

/**
 * Check if legacy AndroidBridge exists (for backward compat, but not Termux)
 * @returns {boolean}
 */
function hasAndroidBridge() {
  if (typeof window === "undefined") return false;
  // Ensure it's not Termux's AndroidBridge (which would have termux-specific methods)
  // Our bridge should have getInstalledPlayers, launchPlayer, etc., not termux-open
  return !!window.AndroidBridge && typeof window.AndroidBridge.getInstalledPlayers === "function";
}

/**
 * Get installed players via native bridge (real PackageManager query)
 * @returns {Promise<string[]>} array of package names
 */
export async function getInstalledPlayersNative() {
  // Method 1: Capacitor ExternalPlayer plugin (real Android PackageManager)
  if (hasCapacitorExternalPlayerPlugin()) {
    try {
      const { ExternalPlayer } = window.Capacitor.Plugins;
      const result = await ExternalPlayer.getInstalledPlayers();
      // Expected: { players: ["org.videolan.vlc", "is.xyz.mpv", ...] }
      if (result && Array.isArray(result.players)) {
        console.log("[AndroidBridge] Capacitor ExternalPlayer detected:", result.players);
        return result.players;
      }
      // Alternative format: result is array directly
      if (Array.isArray(result)) {
        return result;
      }
    } catch (e) {
      console.warn("[AndroidBridge] Capacitor ExternalPlayer.getInstalledPlayers failed:", e);
    }
  }

  // Method 2: Custom StreambertNative bridge
  if (hasStreambertNativeBridge()) {
    try {
      const bridge = window.StreambertNative;
      if (typeof bridge.getInstalledPlayers === "function") {
        const result = await bridge.getInstalledPlayers();
        const players = typeof result === "string" ? JSON.parse(result) : result;
        if (Array.isArray(players)) return players;
        if (players && Array.isArray(players.players)) return players.players;
      }
    } catch (e) {
      console.warn("[AndroidBridge] StreambertNative.getInstalledPlayers failed:", e);
    }
  }

  // Method 3: Legacy AndroidBridge (if it has proper method, not Termux)
  if (hasAndroidBridge()) {
    try {
      const result = await window.AndroidBridge.getInstalledPlayers();
      const players = typeof result === "string" ? JSON.parse(result) : result;
      if (Array.isArray(players)) return players;
      if (players && Array.isArray(players.players)) return players.players;
    } catch (e) {
      console.warn("[AndroidBridge] AndroidBridge.getInstalledPlayers failed:", e);
    }
  }

  // Method 4: Fallback - query via Intent URI? Not possible in pure web.
  // Return empty, caller will use chooser fallback.
  console.log("[AndroidBridge] No native player detection available, using chooser fallback");
  return [];
}

/**
 * Launch player via native bridge (real Android Intent)
 * @param {Object} options
 * @param {string} options.url - stream URL or proxy URL
 * @param {string} [options.packageName] - specific package, e.g., org.videolan.vlc
 * @param {string} [options.mimeType] - default video/*
 * @param {string} [options.title]
 * @param {Object} [options.headers] - {User-Agent, Referer}
 * @param {string} [options.subtitle] - local subtitle file path
 * @returns {Promise<{ok: boolean, error?: string, method: string}>}
 */
export async function launchPlayerNative(options) {
  const {
    url,
    packageName,
    mimeType = "video/*",
    title,
    headers = {},
    subtitle,
  } = options;

  if (!url) {
    return { ok: false, error: "No URL", method: "none" };
  }

  // Method 1: Capacitor ExternalPlayer plugin (real Intent)
  if (hasCapacitorExternalPlayerPlugin()) {
    try {
      const { ExternalPlayer } = window.Capacitor.Plugins;
      const result = await ExternalPlayer.launchPlayer({
        url,
        packageName: packageName || null,
        mimeType,
        title: title || null,
        headers: headers || {},
        subtitle: subtitle || null,
      });
      console.log("[AndroidBridge] Launched via Capacitor ExternalPlayer:", result);
      // Plugin should return {ok: true} or throw
      if (result && result.ok === false) {
        return { ok: false, error: result.error || "Launch failed", method: "capacitor-externalplayer" };
      }
      return { ok: true, method: "capacitor-externalplayer", package: packageName };
    } catch (e) {
      console.warn("[AndroidBridge] Capacitor launch failed:", e);
      // Don't return error yet, try next method
    }
  }

  // Method 2: Custom StreambertNative bridge
  if (hasStreambertNativeBridge()) {
    try {
      const bridge = window.StreambertNative;
      if (typeof bridge.launchPlayer === "function") {
        const payload = JSON.stringify({
          url,
          packageName: packageName || null,
          mimeType,
          title: title || null,
          headers: headers || {},
          subtitle: subtitle || null,
        });
        const resultStr = await bridge.launchPlayer(payload);
        const result = typeof resultStr === "string" ? JSON.parse(resultStr) : resultStr;
        if (result && result.ok) {
          console.log("[AndroidBridge] Launched via StreambertNative");
          return { ok: true, method: "streambert-native", package: packageName };
        } else {
          return { ok: false, error: result?.error || "StreambertNative launch failed", method: "streambert-native" };
        }
      }
    } catch (e) {
      console.warn("[AndroidBridge] StreambertNative launch failed:", e);
    }
  }

  // Method 3: Legacy AndroidBridge
  if (hasAndroidBridge()) {
    try {
      const payload = JSON.stringify({
        url,
        packageName: packageName || null,
        mimeType,
        title: title || null,
        headers: headers || {},
        subtitle: subtitle || null,
      });
      const resultStr = await window.AndroidBridge.launchPlayer(payload);
      const result = typeof resultStr === "string" ? JSON.parse(resultStr) : resultStr;
      if (result && result.ok) {
        return { ok: true, method: "android-bridge", package: packageName };
      }
    } catch (e) {
      console.warn("[AndroidBridge] AndroidBridge launch failed:", e);
    }
  }

  // Method 4: Pure Intent URI fallback (works in Chrome/WebView on Android, no Electron/Termux)
  // This is valid Android mechanism without native bridge, uses window.location.href to trigger Intent
  try {
    const { buildIntentUri } = await import("./androidIntent.js");
    const intentUri = buildIntentUri(url, {
      packageName: packageName || null,
      mimeType,
      title,
      headers,
      subtitle,
    });

    console.log("[AndroidBridge] Launching via Intent URI:", intentUri);

    // For system chooser, don't specify package
    // Intent URI will trigger Android system to show chooser or open app
    // We need to actually navigate to it
    if (typeof window !== "undefined") {
      // Use location.href to trigger intent
      window.location.href = intentUri;

      // Fallback: also try to open direct URL after delay in case intent fails
      // (e.g., if no app handles intent, browser will try to open URL)
      setTimeout(() => {
        try {
          // Only if still on same page (intent didn't navigate away)
          if (window.location.href !== intentUri) {
            // Intent likely succeeded (page unloaded or chooser shown)
            return;
          }
        } catch {}
        // Intent didn't work, try direct URL
        console.log("[AndroidBridge] Intent URI didn't trigger, trying direct URL");
        window.open(url, "_blank");
      }, 1500);
    }

    return { ok: true, method: "intent-uri", intent: intentUri };
  } catch (e) {
    console.error("[AndroidBridge] Intent URI failed:", e);
    // Last resort: direct URL
    try {
      if (typeof window !== "undefined") {
        window.open(url, "_blank");
      }
      return { ok: true, method: "direct-url" };
    } catch (e2) {
      return { ok: false, error: e2.message || "All launch methods failed", method: "none" };
    }
  }
}

/**
 * Start proxy server via native bridge (Android native HTTP server)
 * @param {string} targetUrl
 * @param {Object} headers
 * @param {string} [subtitleUrl]
 * @returns {Promise<{proxyUrl: string, port: number}>}
 */
export async function startProxyNative(targetUrl, headers = {}, subtitleUrl = null) {
  // Method 1: Capacitor ExternalPlayer plugin has proxy
  if (hasCapacitorExternalPlayerPlugin()) {
    try {
      const { ExternalPlayer } = window.Capacitor.Plugins;
      if (typeof ExternalPlayer.startProxy === "function") {
        const result = await ExternalPlayer.startProxy({
          targetUrl,
          headers: headers || {},
          subtitleUrl: subtitleUrl || null,
        });
        console.log("[AndroidBridge] Proxy started via Capacitor:", result);
        if (result && result.proxyUrl) {
          return { proxyUrl: result.proxyUrl, port: result.port || 0 };
        }
      }
    } catch (e) {
      console.warn("[AndroidBridge] Capacitor startProxy failed:", e);
    }
  }

  // Method 2: StreambertNative bridge
  if (hasStreambertNativeBridge()) {
    try {
      const bridge = window.StreambertNative;
      if (typeof bridge.startProxy === "function") {
        const payload = JSON.stringify({ targetUrl, headers, subtitleUrl });
        const resultStr = await bridge.startProxy(payload);
        const result = typeof resultStr === "string" ? JSON.parse(resultStr) : resultStr;
        if (result && result.proxyUrl) {
          return { proxyUrl: result.proxyUrl, port: result.port || 0 };
        }
      }
    } catch (e) {
      console.warn("[AndroidBridge] StreambertNative startProxy failed:", e);
    }
  }

  // Method 3: No native proxy available - throw clear error
  // For pure web, we cannot start native HTTP server
  // Caller should handle this and either use direct URL or show error
  throw new Error("Native proxy not available - requires Capacitor ExternalPlayer plugin or StreambertNative bridge. For testing, use direct URL if headers allow.");
}

/**
 * Stop proxy via native bridge
 * @returns {Promise<void>}
 */
export async function stopProxyNative() {
  if (hasCapacitorExternalPlayerPlugin()) {
    try {
      const { ExternalPlayer } = window.Capacitor.Plugins;
      if (typeof ExternalPlayer.stopProxy === "function") {
        await ExternalPlayer.stopProxy();
        console.log("[AndroidBridge] Proxy stopped via Capacitor");
        return;
      }
    } catch (e) {
      console.warn("[AndroidBridge] Capacitor stopProxy failed:", e);
    }
  }

  if (hasStreambertNativeBridge()) {
    try {
      const bridge = window.StreambertNative;
      if (typeof bridge.stopProxy === "function") {
        await bridge.stopProxy();
        return;
      }
    } catch {}
  }

  // No-op if no native bridge
}

/**
 * Download subtitle to shared storage via native bridge
 * @param {string} url
 * @param {string} filename
 * @param {Object} headers
 * @returns {Promise<{localPath: string}|null>}
 */
export async function downloadSubtitleNative(url, filename, headers = {}) {
  if (hasCapacitorExternalPlayerPlugin()) {
    try {
      const { ExternalPlayer } = window.Capacitor.Plugins;
      if (typeof ExternalPlayer.downloadSubtitle === "function") {
        const result = await ExternalPlayer.downloadSubtitle({
          url,
          filename,
          headers: headers || {},
        });
        if (result && result.localPath) {
          return { localPath: result.localPath };
        }
      }
    } catch (e) {
      console.warn("[AndroidBridge] Capacitor downloadSubtitle failed:", e);
    }
  }

  if (hasStreambertNativeBridge()) {
    try {
      const bridge = window.StreambertNative;
      if (typeof bridge.downloadSubtitle === "function") {
        const payload = JSON.stringify({ url, filename, headers });
        const resultStr = await bridge.downloadSubtitle(payload);
        const result = typeof resultStr === "string" ? JSON.parse(resultStr) : resultStr;
        if (result && result.localPath) {
          return { localPath: result.localPath };
        }
      }
    } catch (e) {
      console.warn("[AndroidBridge] StreambertNative downloadSubtitle failed:", e);
    }
  }

  // Fallback: cannot download in pure web, return null to use remote URL
  return null;
}

/**
 * Get subtitle directory via native bridge
 * @returns {Promise<string>}
 */
export async function getSubtitleDirNative() {
  if (hasCapacitorExternalPlayerPlugin()) {
    try {
      const { ExternalPlayer } = window.Capacitor.Plugins;
      if (typeof ExternalPlayer.getSubtitleDir === "function") {
        const result = await ExternalPlayer.getSubtitleDir();
        if (result && result.path) return result.path;
        if (typeof result === "string") return result;
      }
    } catch {}
  }

  if (hasStreambertNativeBridge()) {
    try {
      const bridge = window.StreambertNative;
      if (typeof bridge.getSubtitleDir === "function") {
        const result = await bridge.getSubtitleDir();
        const parsed = typeof result === "string" ? result : result?.path;
        if (parsed) return parsed;
      }
    } catch {}
  }

  return "/sdcard/Download/StreambertSubs";
}
