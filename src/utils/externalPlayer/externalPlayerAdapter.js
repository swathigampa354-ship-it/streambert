// ── External Player Adapter ─────────────────────────────────────────────
// Main abstraction for Android external player playback.
// Mirrors MovieBox-TUI's player detection + launch logic but in JS.

import { KNOWN_PLAYERS, DESKTOP_PLAYERS, getPlayerById, AndroidOpenerType } from "./playerRegistry.js";
import { PlayerKind, ErrorCodes, StreamType } from "./types.js";
import { buildTermuxAmCommand, buildTermuxOpenCommand, buildIntentUri, buildCapacitorIntentOptions, detectBestOpener } from "./androidIntent.js";
import { needsProxy, analyzeProxyNeed, getIntentHeaders } from "./headerHandler.js";
import { ProxyServer, spawnProxy } from "./proxyServer.js";
import { getBestSubtitle, prepareSubtitleForPlayer } from "./subtitleHandler.js";
import { validateStreamUrl, enrichWithProxyAnalysis } from "./streamResolver.js";
import { getPlatform, PLATFORM } from "../platform.js";

export class ExternalPlayerAdapter {
  constructor(options = {}) {
    this.platform = options.platform || getPlatform();
    this.preferredPlayerId = options.preferredPlayerId || null;
    this.proxyServer = null;
    this.availablePlayersCache = null;
    this.lastLaunchResult = null;
  }

  /**
   * Detect available players on current platform
   * @returns {Promise<Array>} PlayerInfo[]
   */
  async detectAvailablePlayers() {
    if (this.availablePlayersCache) return this.availablePlayersCache;

    const platform = this.platform;
    let players = [];

    if (platform === PLATFORM.DESKTOP) {
      // Desktop: check for mpv/vlc binaries via Electron IPC
      if (typeof window !== "undefined" && window.electron?.getAvailablePlayers) {
        try {
          const result = await window.electron.getAvailablePlayers();
          if (result?.players) {
            players = result.players.map(id => getPlayerById(id)).filter(Boolean);
          }
        } catch {}
      }
      // Fallback: assume mpv and vlc available (existing logic)
      if (players.length === 0) {
        players = DESKTOP_PLAYERS;
      }
      // Always add system default
      players.push({
        id: PlayerKind.SYSTEM_DEFAULT,
        label: "System Default",
        type: "system",
        supportsHeaders: false,
        supportsSubtitles: false,
        supportsHls: true,
      });
    } else if (platform === PLATFORM.ANDROID) {
      // Android: detect via native bridge or termux tools
      players = await this.detectAndroidPlayers();
    } else {
      // Web: list all known Android players as potential (chooser will handle)
      players = [...KNOWN_PLAYERS];
    }

    this.availablePlayersCache = players;
    return players;
  }

  /**
   * Detect Android players via various methods
   * @returns {Promise<Array>}
   */
  async detectAndroidPlayers() {
    const players = [];

    // Method 1: Capacitor AppLauncher plugin (if available)
    if (typeof window !== "undefined" && window.Capacitor) {
      try {
        // Try to use custom Android bridge
        if (window.AndroidBridge?.getInstalledPlayers) {
          const installed = await window.AndroidBridge.getInstalledPlayers();
          for (const pkg of installed) {
            const player = KNOWN_PLAYERS.find(p => p.packageNames.includes(pkg));
            if (player) players.push(player);
          }
        }
      } catch {}
    }

    // Method 2: Termux detection (termux-am, termux-open existence)
    // In Electron simulation, we check via IPC
    if (typeof window !== "undefined" && window.electron?.probeAndroidOpeners) {
      try {
        const openers = await window.electron.probeAndroidOpeners();
        if (openers && openers.length > 0) {
          // If any opener exists, we can at least use chooser
          // Add all known players as potentially available via chooser
          // (Android chooser will filter to actually installed)
          players.push(...KNOWN_PLAYERS.filter(p => p.type === "android"));
          players.push({
            id: PlayerKind.SYSTEM_DEFAULT,
            label: "Android System Chooser",
            packageNames: [],
            type: "system",
            supportsHeaders: false,
            supportsSubtitles: false,
            supportsHls: true,
            detectionMethod: "chooser",
            mimeType: "video/*",
          });
          // Deduplicate
          const seen = new Set();
          return players.filter(p => {
            if (seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
          });
        }
      } catch {}
    }

    // Method 3: Check for __STREAMBERT_ANDROID__ global (set by Android WebView)
    if (typeof window !== "undefined" && window.__STREAMBERT_ANDROID__) {
      const android = window.__STREAMBERT_ANDROID__;
      if (android.installedPlayers && Array.isArray(android.installedPlayers)) {
        for (const pkg of android.installedPlayers) {
          const player = KNOWN_PLAYERS.find(p => p.packageNames.includes(pkg));
          if (player) players.push(player);
        }
      }
      // If has termux-open, add chooser
      if (android.hasTermuxOpen || android.hasTermuxAm) {
        if (players.length === 0) {
          players.push(...KNOWN_PLAYERS.filter(p => p.type === "android"));
        }
        players.push({
          id: PlayerKind.SYSTEM_DEFAULT,
          label: "Android System Chooser",
          packageNames: [],
          type: "system",
          supportsHeaders: false,
          supportsSubtitles: false,
          supportsHls: true,
          detectionMethod: "chooser",
          mimeType: "video/*",
        });
      }
    }

    // Fallback: if on Android UA but no detection, assume chooser available
    if (players.length === 0 && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent)) {
      players.push(...KNOWN_PLAYERS);
    }

    // Deduplicate
    const seen = new Set();
    return players.filter(p => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }

  /**
   * List available players with details
   * @returns {Promise<Array>}
   */
  async listPlayers() {
    const players = await this.detectAvailablePlayers();
    return players.map(p => ({
      id: p.id,
      label: p.label,
      packageNames: p.packageNames || [],
      type: p.type,
      supportsHeaders: p.supportsHeaders,
      supportsSubtitles: p.supportsSubtitles,
      supportsHls: p.supportsHls,
    }));
  }

  /**
   * Check if any compatible player is installed
   * @returns {Promise<boolean>}
   */
  async hasCompatiblePlayer() {
    const players = await this.detectAvailablePlayers();
    return players.length > 0;
  }

  /**
   * Get player by id or preferred
   * @param {string} [playerId]
   * @returns {Promise<Object|null>}
   */
  async getPlayer(playerId = null) {
    const id = playerId || this.preferredPlayerId;
    const players = await this.detectAvailablePlayers();

    if (id) {
      const found = players.find(p => p.id === id);
      if (found) return found;
      // Try global registry
      const global = getPlayerById(id);
      if (global) return global;
    }

    // Return first available
    return players[0] || null;
  }

  /**
   * Launch stream in external player
   * @param {Object} streamInfo - StreamInfo
   * @param {Object} options
   * @param {string} [options.playerId] - specific player to use
   * @param {boolean} [options.useProxyIfNeeded] - default true
   * @param {boolean} [options.useChooser] - force chooser, default false
   * @returns {Promise<LaunchResult>}
   */
  async launch(streamInfo, options = {}) {
    const {
      playerId = null,
      useProxyIfNeeded = true,
      useChooser = false,
    } = options;

    // Validate URL
    const validation = validateStreamUrl(streamInfo.url);
    if (!validation.valid) {
      return {
        ok: false,
        error: validation.error,
        errorCode: ErrorCodes.INVALID_URL,
      };
    }

    // Detect players
    const available = await this.detectAvailablePlayers();
    if (available.length === 0) {
      return {
        ok: false,
        error: "No compatible external player installed. Please install VLC, MPV, MX Player or another video player.",
        errorCode: ErrorCodes.NO_PLAYER,
      };
    }

    // Select player
    let player = null;
    if (useChooser) {
      player = available.find(p => p.type === "system") || available[0];
    } else if (playerId) {
      player = available.find(p => p.id === playerId) || getPlayerById(playerId);
    } else if (this.preferredPlayerId) {
      player = available.find(p => p.id === this.preferredPlayerId) || available[0];
    } else {
      player = available[0];
    }

    if (!player) {
      return {
        ok: false,
        error: "Selected player not available",
        errorCode: ErrorCodes.PLAYER_NOT_INSTALLED,
      };
    }

    // Enrich with proxy analysis
    const enriched = enrichWithProxyAnalysis(streamInfo, player);
    let finalUrl = streamInfo.url;
    let usedProxy = false;
    let proxyUrl = null;

    // Handle proxy if needed
    if (useProxyIfNeeded && enriched.needsProxy) {
      console.log(`[ExternalPlayer] Proxy needed: ${enriched.proxyReason}`);
      try {
        const result = await this.startProxy(streamInfo.url, streamInfo.headers, streamInfo.subtitles?.[0]?.url);
        finalUrl = result.proxyUrl;
        proxyUrl = result.proxyUrl;
        usedProxy = true;
        console.log(`[ExternalPlayer] Proxy started: ${proxyUrl}`);
      } catch (e) {
        console.error("[ExternalPlayer] Proxy failed:", e);
        return {
          ok: false,
          error: `Failed to start proxy: ${e.message}. Stream requires headers that cannot be passed directly.`,
          errorCode: ErrorCodes.PROXY_FAILED,
          player,
        };
      }
    }

    // Prepare subtitles
    let subtitlePath = null;
    if (streamInfo.subtitles && streamInfo.subtitles.length > 0) {
      const bestSub = getBestSubtitle(streamInfo.subtitles, "en");
      if (bestSub) {
        // For Android, we need local path
        // In real implementation, subtitle would be downloaded to shared storage
        // For now, use remote URL as fallback, or local path if prepared
        const prepared = await prepareSubtitleForPlayer(bestSub, {
          title: streamInfo.title,
          season: streamInfo.season,
          episode: streamInfo.episode,
        }, streamInfo.headers);

        if (prepared) {
          subtitlePath = prepared.localPath || prepared.remoteUrl;
        }
      }
    }

    // Launch based on platform
    try {
      let launchResult;
      if (this.platform === PLATFORM.DESKTOP) {
        launchResult = await this.launchDesktop(finalUrl, player, streamInfo, subtitlePath);
      } else {
        launchResult = await this.launchAndroid(finalUrl, player, streamInfo, subtitlePath);
      }

      this.lastLaunchResult = {
        ok: true,
        player,
        launchedUrl: finalUrl,
        usedProxy,
        proxyUrl,
        ...launchResult,
      };
      return this.lastLaunchResult;
    } catch (e) {
      console.error("[ExternalPlayer] Launch failed:", e);
      return {
        ok: false,
        error: e.message || "Failed to launch player",
        errorCode: ErrorCodes.INTENT_FAILED,
        player,
        launchedUrl: finalUrl,
        usedProxy,
        proxyUrl,
      };
    }
  }

  /**
   * Launch on desktop (Electron)
   * @param {string} url
   * @param {Object} player
   * @param {Object} streamInfo
   * @param {string} subtitlePath
   * @returns {Promise<Object>}
   */
  async launchDesktop(url, player, streamInfo, subtitlePath) {
    if (typeof window !== "undefined" && window.electron?.launchExternalPlayer) {
      const result = await window.electron.launchExternalPlayer({
        url,
        playerId: player.id,
        headers: streamInfo.headers,
        subtitle: subtitlePath,
        title: streamInfo.title,
        mimeType: streamInfo.mimeType,
      });
      if (!result.ok) throw new Error(result.error || "Desktop launch failed");
      return result;
    }

    // Fallback: try to open URL directly (browser will handle)
    window.open(url, "_blank");
    return { method: "window.open" };
  }

  /**
   * Launch on Android
   * @param {string} url
   * @param {Object} player
   * @param {Object} streamInfo
   * @param {string} subtitlePath
   * @returns {Promise<Object>}
   */
  async launchAndroid(url, player, streamInfo, subtitlePath) {
    const title = streamInfo.title || "Streambert";
    const mimeType = streamInfo.mimeType || "video/*";
    const headers = streamInfo.headers || {};

    // Method 1: Capacitor AppLauncher
    if (typeof window !== "undefined" && window.Capacitor) {
      try {
        const { AppLauncher } = window.Capacitor.Plugins || {};
        if (AppLauncher) {
          const intentOptions = buildCapacitorIntentOptions(url, {
            packageName: player.packageNames?.[0],
            mimeType,
            title,
            headers,
            subtitle: subtitlePath,
          });

          // Try to open with specific package if available
          if (intentOptions.packageName) {
            const canOpen = await AppLauncher.canOpenUrl({ url: `intent:${url}#Intent;package=${intentOptions.packageName};end` });
            if (canOpen.value) {
              await AppLauncher.openUrl({ url: intentOptions.url });
              return { method: "capacitor-applauncher", package: intentOptions.packageName };
            }
          }

          // Fallback to generic VIEW intent
          // Use Browser plugin or App plugin to open
          if (window.Capacitor.Plugins.Browser) {
            await window.Capacitor.Plugins.Browser.open({ url });
            return { method: "capacitor-browser" };
          }
        }
      } catch (e) {
        console.warn("[ExternalPlayer] Capacitor launch failed, falling back:", e);
      }
    }

    // Method 2: Android Bridge (custom WebView bridge)
    if (typeof window !== "undefined" && window.AndroidBridge?.launchPlayer) {
      try {
        const result = await window.AndroidBridge.launchPlayer(JSON.stringify({
          url,
          packageName: player.packageNames?.[0],
          mimeType,
          title,
          headers,
          subtitle: subtitlePath,
        }));
        const parsed = typeof result === "string" ? JSON.parse(result) : result;
        if (parsed.ok) return { method: "android-bridge", package: player.packageNames?.[0] };
        throw new Error(parsed.error || "Android bridge launch failed");
      } catch (e) {
        console.warn("[ExternalPlayer] Android bridge failed:", e);
      }
    }

    // Method 3: Termux via Electron IPC (simulation)
    if (typeof window !== "undefined" && window.electron?.launchAndroidPlayer) {
      try {
        const result = await window.electron.launchAndroidPlayer({
          url,
          playerId: player.id,
          packageName: player.packageNames?.[0],
          headers,
          subtitle: subtitlePath,
          title,
          mimeType,
        });
        if (result.ok) return { method: "termux", opener: result.opener };
        throw new Error(result.error);
      } catch (e) {
        console.warn("[ExternalPlayer] Termux IPC launch failed:", e);
      }
    }

    // Method 4: Intent URI (works in Chrome on Android)
    try {
      const intentUri = buildIntentUri(url, {
        packageName: player.packageNames?.[0],
        mimeType,
        title,
        headers,
        subtitle: subtitlePath,
      });

      // For system chooser, don't specify package
      const finalIntent = player.type === "system" ? buildIntentUri(url, { mimeType, title, headers, subtitle: subtitlePath }) : intentUri;

      console.log("[ExternalPlayer] Launching via intent URI:", finalIntent);

      // Try to navigate to intent URI
      // This will trigger Android system to show chooser or open app
      window.location.href = finalIntent;

      // Also try window.open as fallback after short delay
      setTimeout(() => {
        try {
          window.open(url, "_blank");
        } catch {}
      }, 1000);

      return { method: "intent-uri", intent: finalIntent };
    } catch (e) {
      console.error("[ExternalPlayer] Intent URI failed:", e);
    }

    // Method 5: Direct URL open (last resort)
    window.open(url, "_blank");
    return { method: "direct-url" };
  }

  /**
   * Launch with fallback to other players if first fails
   * @param {Object} streamInfo
   * @param {Object} options
   * @returns {Promise<LaunchResult>}
   */
  async launchWithFallback(streamInfo, options = {}) {
    const players = await this.detectAvailablePlayers();
    if (players.length === 0) {
      return {
        ok: false,
        error: "No compatible external player installed.",
        errorCode: ErrorCodes.NO_PLAYER,
      };
    }

    let lastError = null;
    for (const player of players) {
      try {
        const result = await this.launch(streamInfo, { ...options, playerId: player.id });
        if (result.ok) return result;
        lastError = result;
      } catch (e) {
        lastError = { ok: false, error: e.message, errorCode: ErrorCodes.UNKNOWN, player };
      }
    }

    return lastError || {
      ok: false,
      error: "All players failed",
      errorCode: ErrorCodes.UNKNOWN,
    };
  }

  /**
   * Start proxy server
   * @param {string} url
   * @param {Object} headers
   * @param {string} subtitleUrl
   * @returns {Promise<{proxyUrl: string, proxyServer: ProxyServer}>}
   */
  async startProxy(url, headers, subtitleUrl = null) {
    if (this.proxyServer) {
      await this.proxyServer.stop();
    }

    const proxy = new ProxyServer();
    const proxyUrl = await proxy.start(url, headers, subtitleUrl);
    this.proxyServer = proxy;
    return { proxyUrl, proxyServer: proxy };
  }

  /**
   * Stop proxy server
   */
  async stopProxy() {
    if (this.proxyServer) {
      await this.proxyServer.stop();
      this.proxyServer = null;
    }
  }

  /**
   * Set preferred player
   * @param {string} playerId
   */
  setPreferredPlayer(playerId) {
    this.preferredPlayerId = playerId;
    try {
      localStorage.setItem("streambert_preferred_player", playerId);
    } catch {}
  }

  /**
   * Get preferred player from storage
   * @returns {string|null}
   */
  getPreferredPlayer() {
    if (this.preferredPlayerId) return this.preferredPlayerId;
    try {
      return localStorage.getItem("streambert_preferred_player");
    } catch {
      return null;
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.availablePlayersCache = null;
  }
}

// Singleton instance
export const externalPlayerAdapter = new ExternalPlayerAdapter();

// Helper function for quick launch
export async function launchInExternalPlayer(streamInfo, options = {}) {
  const adapter = new ExternalPlayerAdapter(options);
  return adapter.launch(streamInfo, options);
}
