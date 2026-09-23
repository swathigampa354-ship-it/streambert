// ── External Player Adapter ─────────────────────────────────────────────
// Fixed: Android path has NO Electron/Node/Termux dependencies.
// Desktop and Android are cleanly separated.

import { DESKTOP_PLAYERS, getPlayerById } from "./playerRegistry.js";
import { PlayerKind, ErrorCodes } from "./types.js";
import { buildIntentUri, buildCapacitorIntentOptions, buildNativeIntentOptions } from "./androidIntent.js";
import { analyzeProxyNeed } from "./headerHandler.js";
import { getBestSubtitle, prepareSubtitleForPlayer } from "./subtitleHandler.js";
import { validateStreamUrl, enrichWithProxyAnalysis } from "./streamResolver.js";
import { getPlatform, PLATFORM, isCapacitorAndroid } from "../platform.js";
import { detectInstalledPlayers, validatePlayerSelection } from "./androidPlayerDetector.js";
import { launchPlayerNative } from "./androidBridge.js";

// ── Desktop-specific helpers (isolated, not used in Android path) ──────────

async function detectDesktopPlayers() {
  let players = [];

  // Only use Electron IPC if in Electron renderer (desktop)
  if (typeof window !== "undefined" && window.electron?.getAvailablePlayers) {
    try {
      const result = await window.electron.getAvailablePlayers();
      if (result?.players) {
        players = result.players.map(id => getPlayerById(id)).filter(Boolean);
      }
    } catch (e) {
      console.warn("[ExternalPlayer] Desktop detection via Electron failed:", e);
    }
  }

  if (players.length === 0) {
    players = [...DESKTOP_PLAYERS];
  }

  players.push({
    id: PlayerKind.SYSTEM_DEFAULT,
    label: "System Default",
    type: "system",
    supportsHeaders: false,
    supportsSubtitles: false,
    supportsHls: true,
  });

  return players;
}

async function launchDesktop(url, player, streamInfo, subtitlePath) {
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

  // Fallback: open URL directly (browser)
  if (typeof window !== "undefined") {
    window.open(url, "_blank");
  }
  return { method: "window.open", ok: true };
}

// ── Android-specific helpers (NO Electron, NO Termux, NO Node) ─────────────

async function detectAndroidPlayersPure() {
  // Real detection via PackageManager through native bridge
  // No Termux, no Electron
  return detectInstalledPlayers();
}

async function launchAndroidPure(url, player, streamInfo, subtitlePath) {
  const title = streamInfo.title || "Streambert";
  const mimeType = streamInfo.mimeType || "video/*";
  const headers = streamInfo.headers || {};

  // Use native bridge that has NO Electron/Termux dependencies
  // It tries Capacitor ExternalPlayer plugin -> StreambertNative -> Intent URI fallback
  const result = await launchPlayerNative({
    url,
    packageName: player.packageNames?.[0] || null, // null for chooser
    mimeType,
    title,
    headers,
    subtitle: subtitlePath,
  });

  if (!result.ok) {
    throw new Error(result.error || "Android launch failed");
  }

  return result;
}

// ── Main Adapter Class ─────────────────────────────────────────────────────

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
   * Android path: NO Electron, NO Termux, uses PackageManager via native bridge
   * @returns {Promise<Array>} PlayerInfo[]
   */
  async detectAvailablePlayers() {
    if (this.availablePlayersCache) return this.availablePlayersCache;

    let players = [];

    if (this.platform === PLATFORM.DESKTOP) {
      players = await detectDesktopPlayers();
    } else if (this.platform === PLATFORM.ANDROID) {
      players = await detectAndroidPlayersPure();
    } else {
      // Web fallback: return chooser + known players as potential (Intent URI will handle)
      const { KNOWN_PLAYERS } = await import("./playerRegistry.js");
      players = [
        {
          id: "system-default",
          label: "System Chooser",
          packageNames: [],
          type: "system",
          supportsHeaders: false,
          supportsSubtitles: false,
          supportsHls: true,
          detectionMethod: "intent-uri",
          mimeType: "video/*",
        },
        ...KNOWN_PLAYERS.filter(p => p.type === "android"),
      ];
    }

    this.availablePlayersCache = players;
    return players;
  }

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
      detectionMethod: p.detectionMethod || "unknown",
    }));
  }

  async hasCompatiblePlayer() {
    const players = await this.detectAvailablePlayers();
    return players.length > 0;
  }

  async getPlayer(playerId = null) {
    const id = playerId || this.preferredPlayerId;
    const players = await this.detectAvailablePlayers();

    if (id) {
      const found = players.find(p => p.id === id);
      if (found) return found;
      const global = getPlayerById(id);
      if (global) return global;
    }

    return players[0] || null;
  }

  /**
   * Launch stream in external player
   * Android path has NO Electron/Termux/Node dependencies
   * @param {Object} streamInfo
   * @param {Object} options
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
      const validation = validatePlayerSelection(playerId, available);
      if (!validation.valid) {
        return {
          ok: false,
          error: validation.error,
          errorCode: ErrorCodes.PLAYER_NOT_INSTALLED,
        };
      }
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
          error: `Failed to start proxy: ${e.message}. Stream requires headers that cannot be passed directly. On Android, this requires native proxy support (Capacitor ExternalPlayer plugin).`,
          errorCode: ErrorCodes.PROXY_FAILED,
          player,
        };
      }
    }

    // Prepare subtitles (Android native download via bridge if available)
    let subtitlePath = null;
    if (streamInfo.subtitles && streamInfo.subtitles.length > 0) {
      const bestSub = getBestSubtitle(streamInfo.subtitles, "en");
      if (bestSub) {
        try {
          const prepared = await prepareSubtitleForPlayer(bestSub, {
            title: streamInfo.title,
            season: streamInfo.season,
            episode: streamInfo.episode,
          }, streamInfo.headers);

          if (prepared) {
            // For Android, try native download to shared storage
            if (this.platform === PLATFORM.ANDROID) {
              const { downloadSubtitleNative, getSubtitleDirNative } = await import("./androidBridge.js");
              const subDir = await getSubtitleDirNative();
              const localPath = `${subDir}/${prepared.filename}`;

              // Try native download
              const dlResult = await downloadSubtitleNative(prepared.remoteUrl, prepared.filename, streamInfo.headers);
              if (dlResult && dlResult.localPath) {
                subtitlePath = dlResult.localPath;
                console.log(`[ExternalPlayer] Subtitle downloaded to: ${subtitlePath}`);
              } else {
                // Fallback: use remote URL or intended local path
                // For VLC/MX, remote URL may work, or file in Downloads may be manually picked
                subtitlePath = prepared.localPath || prepared.remoteUrl;
                console.log(`[ExternalPlayer] Subtitle using fallback path: ${subtitlePath}`);
              }
            } else {
              // Desktop: use remote URL or temp path
              subtitlePath = prepared.localPath || prepared.remoteUrl;
            }
          }
        } catch (e) {
          console.warn("[ExternalPlayer] Subtitle preparation failed:", e);
          // Continue without subtitle, don't fail launch
        }
      }
    }

    // Launch based on platform (clean separation, no cross-dependencies)
    try {
      let launchResult;
      if (this.platform === PLATFORM.DESKTOP) {
        launchResult = await launchDesktop(finalUrl, player, streamInfo, subtitlePath);
      } else {
        launchResult = await launchAndroidPure(finalUrl, player, streamInfo, subtitlePath);
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

  async startProxy(url, headers, subtitleUrl = null) {
    if (this.proxyServer) {
      await this.proxyServer.stop();
    }

    // Platform-specific proxy
    if (this.platform === PLATFORM.ANDROID) {
      const { AndroidNativeProxy } = await import("./androidNativeProxy.js");
      const proxy = new AndroidNativeProxy();
      const proxyUrl = await proxy.start(url, headers, subtitleUrl);
      this.proxyServer = proxy;
      return { proxyUrl, proxyServer: proxy };
    } else {
      const { DesktopProxyServer } = await import("./proxyServer.js");
      const proxy = new DesktopProxyServer();
      const proxyUrl = await proxy.start(url, headers, subtitleUrl);
      this.proxyServer = proxy;
      return { proxyUrl, proxyServer: proxy };
    }
  }

  async stopProxy() {
    if (this.proxyServer) {
      await this.proxyServer.stop();
      this.proxyServer = null;
    }
  }

  setPreferredPlayer(playerId) {
    this.preferredPlayerId = playerId;
    try {
      localStorage.setItem("streambert_preferred_player", playerId);
    } catch {}
  }

  getPreferredPlayer() {
    if (this.preferredPlayerId) return this.preferredPlayerId;
    try {
      return localStorage.getItem("streambert_preferred_player");
    } catch {
      return null;
    }
  }

  clearCache() {
    this.availablePlayersCache = null;
  }
}

// Singleton
export const externalPlayerAdapter = new ExternalPlayerAdapter();

export async function launchInExternalPlayer(streamInfo, options = {}) {
  const adapter = new ExternalPlayerAdapter(options);
  return adapter.launch(streamInfo, options);
}
