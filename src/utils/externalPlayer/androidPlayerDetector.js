// ── Android Player Detector ─────────────────────────────────────────────
// Real Android player detection via PackageManager (no Termux, no Electron)

import { KNOWN_PLAYERS } from "./playerRegistry.js";
import { getInstalledPlayersNative } from "./androidBridge.js";

/**
 * Detect installed players via native bridge (real PackageManager)
 * @returns {Promise<Array>} PlayerInfo[]
 */
export async function detectInstalledPlayers() {
  try {
    const installedPackages = await getInstalledPlayersNative();

    if (installedPackages && installedPackages.length > 0) {
      // Map package names to known players
      const detected = [];
      const seenIds = new Set();

      for (const pkg of installedPackages) {
        // Find known player that has this package
        const known = KNOWN_PLAYERS.find(p => p.packageNames && p.packageNames.includes(pkg));
        if (known && !seenIds.has(known.id)) {
          detected.push(known);
          seenIds.add(known.id);
        } else if (!known) {
          // Unknown player that handles video/* - add as generic
          // Check if it's a video player by heuristics (package name contains video, player, vlc, mpv, mx)
          const lower = pkg.toLowerCase();
          if (lower.includes("video") || lower.includes("player") || lower.includes("vlc") || lower.includes("mpv") || lower.includes("mx") || lower.includes("just")) {
            detected.push({
              id: `custom-${pkg}`,
              label: pkg.split(".").pop() || pkg,
              packageNames: [pkg],
              type: "android",
              supportsHeaders: false, // unknown, assume no header support, use proxy if needed
              supportsSubtitles: false,
              supportsHls: true,
              detectionMethod: "packagemanager",
              mimeType: "video/*",
              isCustom: true,
            });
          }
        }
      }

      console.log("[PlayerDetector] Detected via PackageManager:", detected.map(p => p.label));

      // Always add system chooser as option if any players found
      if (detected.length > 0) {
        detected.push({
          id: "system-default",
          label: "System Chooser",
          packageNames: [],
          type: "system",
          supportsHeaders: false,
          supportsSubtitles: false,
          supportsHls: true,
          detectionMethod: "chooser",
          mimeType: "video/*",
          notes: "Shows Android system chooser with all compatible apps",
        });
      }

      return detected;
    }
  } catch (e) {
    console.warn("[PlayerDetector] Native detection failed:", e);
  }

  // Fallback: No native bridge available (pure web)
  // Return empty list - caller will show "No player" error, or use chooser via Intent URI
  // For pure web on Android, Intent URI will still trigger chooser even without detection
  console.log("[PlayerDetector] No native detection, returning chooser fallback for Intent URI");
  return [
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
      notes: "Uses Intent URI to trigger Android chooser (works without native bridge)",
    },
    // Include known players as potential (chooser will filter)
    ...KNOWN_PLAYERS.filter(p => p.type === "android").map(p => ({
      ...p,
      detectionMethod: "intent-uri-fallback",
      notes: p.notes + " (via Intent URI, actual availability depends on installation)",
    })),
  ];
}

/**
 * Check if a specific player is installed
 * @param {string} packageName
 * @returns {Promise<boolean>}
 */
export async function isPlayerInstalled(packageName) {
  try {
    const installed = await getInstalledPlayersNative();
    return installed.includes(packageName);
  } catch {
    return false;
  }
}

/**
 * Get player by package name
 * @param {string} packageName
 * @returns {Object|null}
 */
export function getPlayerByPackage(packageName) {
  return KNOWN_PLAYERS.find(p => p.packageNames && p.packageNames.includes(packageName)) || null;
}

/**
 * Validate player selection
 * @param {string} playerId
 * @param {Array} availablePlayers
 * @returns {{valid: boolean, error?: string}}
 */
export function validatePlayerSelection(playerId, availablePlayers) {
  if (!playerId) {
    return { valid: false, error: "No player selected" };
  }

  if (playerId === "system-default") {
    return { valid: true }; // chooser always valid if any player installed
  }

  const player = availablePlayers.find(p => p.id === playerId);
  if (!player) {
    return { valid: false, error: `Player ${playerId} not found in available list` };
  }

  // For custom players or known players, we already filtered via PackageManager, so they are installed
  // But if detection was fallback (intent-uri), we cannot guarantee installation
  if (player.detectionMethod === "intent-uri-fallback") {
    // Warn but allow - Intent will fail if not installed, and system will show error
    console.warn(`[PlayerDetector] Player ${playerId} detection was fallback, may not be installed`);
  }

  return { valid: true };
}
