// ── Platform detection & abstraction ────────────────────────────────────────
// Used to separate Desktop (Electron) and Android (Capacitor / Termux) logic
// without breaking existing desktop functionality.

export const PLATFORM = {
  DESKTOP: "desktop",
  ANDROID: "android",
  WEB: "web",
};

export function getPlatform() {
  // Check for Capacitor (Android APK)
  if (typeof window !== "undefined") {
    // Capacitor global
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      const capPlatform = window.Capacitor.getPlatform?.();
      if (capPlatform === "android") return PLATFORM.ANDROID;
    }
    // Custom flag set by Android bridge
    if (window.__STREAMBERT_ANDROID__) return PLATFORM.ANDROID;
    // Electron renderer
    if (window.electron) return PLATFORM.DESKTOP;
    // Termux / Android browser detection via user agent or env
    const ua = navigator.userAgent || "";
    if (/Android/i.test(ua) && typeof window.AndroidBridge !== "undefined") {
      return PLATFORM.ANDROID;
    }
    // Fallback: if localStorage has explicit platform override
    try {
      const override = localStorage.getItem("streambert_platform_override");
      if (override === "android") return PLATFORM.ANDROID;
      if (override === "desktop") return PLATFORM.DESKTOP;
    } catch {}
  }
  // Node/Electron main process
  if (typeof process !== "undefined" && process.versions && process.versions.electron) {
    return PLATFORM.DESKTOP;
  }
  // Default to web (for testing) but treat as desktop-like
  return PLATFORM.WEB;
}

export function isAndroid() {
  return getPlatform() === PLATFORM.ANDROID;
}

export function isDesktop() {
  const p = getPlatform();
  return p === PLATFORM.DESKTOP || p === PLATFORM.WEB;
}

export function isElectron() {
  return typeof window !== "undefined" && !!window.electron;
}

// Playback mode setting: internal (webview) vs external (Android player)
export const PLAYBACK_MODE = {
  INTERNAL: "internal",
  EXTERNAL: "external",
  AUTO: "auto", // auto-detect: external on Android, internal on desktop
};

export function getPlaybackMode() {
  try {
    const mode = localStorage.getItem("streambert_playback_mode");
    if (mode && Object.values(PLAYBACK_MODE).includes(mode)) return mode;
  } catch {}
  // Auto: if Android -> external, else internal
  return isAndroid() ? PLAYBACK_MODE.EXTERNAL : PLAYBACK_MODE.INTERNAL;
}

export function setPlaybackMode(mode) {
  if (!Object.values(PLAYBACK_MODE).includes(mode)) return false;
  try {
    localStorage.setItem("streambert_playback_mode", mode);
    window.dispatchEvent(new CustomEvent("streambert:playback-mode-changed", { detail: mode }));
    return true;
  } catch {
    return false;
  }
}

export function shouldUseExternalPlayer() {
  const mode = getPlaybackMode();
  if (mode === PLAYBACK_MODE.EXTERNAL) return true;
  if (mode === PLAYBACK_MODE.INTERNAL) return false;
  // AUTO
  return isAndroid();
}
