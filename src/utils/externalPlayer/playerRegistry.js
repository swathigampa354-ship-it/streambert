// ── Player Registry ─────────────────────────────────────────────────────────
// Known Android external players with package names, intent behavior,
// and capabilities. Based on MovieBox-TUI implementation + Android docs.

import { PlayerKind } from "./types.js";

export const KNOWN_PLAYERS = [
  {
    id: PlayerKind.VLC,
    label: "VLC",
    packageNames: [
      "org.videolan.vlc",           // official
      "org.videolan.vlc.debug",     // debug
    ],
    type: "android",
    supportsHeaders: true,  // via intent extras User-Agent, Referer + proxy for Cookie
    supportsSubtitles: true,
    supportsHls: true,
    intentExtras: ["subtitles_location", "subs", "sub", "title_subtitle"],
    detectionMethod: "intent",
    mimeType: "video/*",
    notes: "Best compatibility, supports HLS, MP4, subs via extras. Requires proxy for Cookie-protected streams (CloudFront).",
  },
  {
    id: PlayerKind.MPV,
    label: "MPV",
    packageNames: [
      "is.xyz.mpv",                 // official FDroid / GitHub
      "is.xyz.mpv.debug",
      "com.mpv",                    // legacy
      "is.xyz.mpv.beta",
    ],
    type: "android",
    supportsHeaders: true, // via http-header-fields? Actually via intent User-Agent/Referer
    supportsSubtitles: true,
    supportsHls: true,
    intentExtras: ["subs", "subtitles_location", "subs.enable"],
    detectionMethod: "intent",
    mimeType: "video/*",
    notes: "Excellent HLS/DASH support, hardware acceleration. Subtitles via subs extras.",
  },
  {
    id: PlayerKind.MX_PLAYER,
    label: "MX Player",
    packageNames: [
      "com.mxtech.videoplayer.ad",  // free with ads
      "com.mxtech.videoplayer.pro", // pro
    ],
    type: "android",
    supportsHeaders: false, // MX Player ignores most header extras, needs proxy for protected streams
    supportsSubtitles: true, // excellent subtitle auto-loading
    supportsHls: true,
    intentExtras: ["subs", "subtitles_location"],
    detectionMethod: "intent",
    mimeType: "video/*",
    notes: "Most popular Android player, great subtitle support. May need proxy for header-protected streams.",
  },
  {
    id: PlayerKind.JUST_PLAYER,
    label: "Just Player",
    packageNames: [
      "com.brouken.player",         // Just Player
    ],
    type: "android",
    supportsHeaders: true,
    supportsSubtitles: true,
    supportsHls: true,
    intentExtras: ["subs", "subtitles_location"],
    detectionMethod: "intent",
    mimeType: "video/*",
    notes: "Lightweight, ExoPlayer based, good HLS support.",
  },
  {
    id: PlayerKind.NEXT_PLAYER,
    label: "Next Player",
    packageNames: [
      "dev.anishaneja.nextplayer",     // Next Player (Anisha Neja, Play Store / F-Droid)
      "dev.anotherwidget.ftp",         // FTP Video Player by anotherwidget
      "com.anotherwidget.justplayer",  // anotherwidget Just Player variant
    ],
    type: "android",
    supportsHeaders: true,
    supportsSubtitles: true,
    supportsHls: true,
    intentExtras: ["subs", "subtitles_location"],
    detectionMethod: "intent",
    mimeType: "video/*",
    notes: "Modern ExoPlayer based player.",
  },
  {
    id: PlayerKind.ANDROID_SYSTEM,
    label: "Android System Player",
    packageNames: [], // no specific package, uses chooser
    type: "system",
    supportsHeaders: false,
    supportsSubtitles: false,
    supportsHls: true, // depends on system
    intentExtras: [],
    detectionMethod: "chooser",
    mimeType: "video/*",
    notes: "Fallback using Android's default chooser. Will show all compatible apps.",
  },
  {
    id: PlayerKind.SYSTEM_DEFAULT,
    label: "System Default",
    packageNames: [],
    type: "system",
    supportsHeaders: false,
    supportsSubtitles: false,
    supportsHls: true,
    intentExtras: [],
    detectionMethod: "chooser",
    mimeType: "video/*",
    notes: "Uses Android native Intent chooser (Intent.createChooser) to show all compatible apps - no Termux needed.",
  },
];

// Desktop players (existing Streambert logic preserved)
export const DESKTOP_PLAYERS = [
  {
    id: "mpv",
    label: "MPV",
    type: "desktop",
    binaryNames: ["mpv"],
    paths: {
      win32: ["mpv", "C:\\Program Files\\mpv\\mpv.exe"],
      darwin: ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "mpv"],
      linux: ["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv", "mpv"],
    },
    supportsHeaders: true,
    supportsSubtitles: true,
    supportsHls: true,
  },
  {
    id: "vlc",
    label: "VLC",
    type: "desktop",
    binaryNames: ["vlc"],
    paths: {
      win32: ["C:\\Program Files\\VideoLAN\\VLC\\vlc.exe", "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe", "vlc"],
      darwin: ["/Applications/VLC.app/Contents/MacOS/VLC", "vlc"],
      linux: ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc", "vlc"],
    },
    supportsHeaders: true,
    supportsSubtitles: true,
    supportsHls: true,
  },
];

// Helper to get player by id
export function getPlayerById(id) {
  return KNOWN_PLAYERS.find(p => p.id === id) || DESKTOP_PLAYERS.find(p => p.id === id) || null;
}

// Get all Android players (for listing)
export function getAndroidPlayers() {
  return KNOWN_PLAYERS.filter(p => p.type === "android");
}

// Get chooser/system players
export function getSystemPlayers() {
  return KNOWN_PLAYERS.filter(p => p.type === "system");
}

// Android opener types for the production Expo/WebView architecture
export const AndroidOpenerType = {
  // Expo native module bridge (expo-external-player -> PackageManager + Intent)
  STREAMBERT_NATIVE: "streambert-native",
  // intent:// URI fallback via RN Linking (no native module)
  INTENT_URI: "intent-uri",
  // System chooser fallback
  SYSTEM_CHOOSER: "system-chooser",
};
