// ── External Player Module Index ────────────────────────────────────────
// Fixed: Android path has no Electron/Termux dependencies

export * from "./types.js";
export * from "./playerRegistry.js";
export * from "./headerHandler.js";
export * from "./androidIntent.js";
export * from "./proxyServer.js";
export * from "./subtitleHandler.js";
export * from "./streamResolver.js";
export * from "./externalPlayerAdapter.js";
export * from "./androidBridge.js";
export * from "./androidPlayerDetector.js";
export * from "./androidNativeProxy.js";

// Re-export main adapter as default
export { ExternalPlayerAdapter, externalPlayerAdapter, launchInExternalPlayer } from "./externalPlayerAdapter.js";

// Platform utilities (pure, no Electron/Termux in Android path)
export { getPlatform, isAndroid, isDesktop, isPureAndroidRuntime, getPlaybackMode, setPlaybackMode, shouldUseExternalPlayer, PLATFORM, PLAYBACK_MODE } from "../platform.js";
