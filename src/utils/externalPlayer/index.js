// ── External Player Module Index ────────────────────────────────────────

export * from "./types.js";
export * from "./playerRegistry.js";
export * from "./headerHandler.js";
export * from "./androidIntent.js";
export * from "./proxyServer.js";
export * from "./subtitleHandler.js";
export * from "./streamResolver.js";
export * from "./externalPlayerAdapter.js";

// Re-export main adapter as default
export { ExternalPlayerAdapter, externalPlayerAdapter, launchInExternalPlayer } from "./externalPlayerAdapter.js";

// Platform utilities
export { getPlatform, isAndroid, isDesktop, getPlaybackMode, setPlaybackMode, shouldUseExternalPlayer, PLATFORM, PLAYBACK_MODE } from "../platform.js";
