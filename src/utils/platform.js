// ── Platform detection & abstraction ────────────────────────────────────────
// Fixed to remove invalid Android dependencies (no Electron/Node/Termux in Android path)

export const PLATFORM = {
  DESKTOP: "desktop",
  ANDROID: "android",
  WEB: "web",
};

// Pure detection helpers — no Node/Electron in Android path

export function isCapacitor() {
  return typeof window !== "undefined" && !!window.Capacitor;
}

export function isCapacitorAndroid() {
  if (!isCapacitor()) return false;
  try {
    if (window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      const p = window.Capacitor.getPlatform?.();
      return p === "android";
    }
  } catch {}
  return false;
}

export function isElectronRenderer() {
  return typeof window !== "undefined" && !!window.electron;
}

export function isAndroidWebView() {
  if (typeof window === "undefined") return false;
  // Check for Android bridge injected by native WebView (Capacitor or custom)
  if (window.Capacitor && isCapacitorAndroid()) return true;
  // Check for custom native bridge (future APK)
  if (window.StreambertNative && window.StreambertNative.platform === "android") return true;
  // Check user agent for Android + existence of native bridge (not Termux)
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) {
    // If we have any native bridge, treat as Android
    if (window.AndroidBridge || window.StreambertNative || isCapacitorAndroid()) {
      return true;
    }
    // For pure web testing, allow override via localStorage
    try {
      const override = localStorage.getItem("streambert_platform_override");
      if (override === "android") return true;
    } catch {}
  }
  return false;
}

export function getPlatform() {
  // Priority: Capacitor Android > Custom Native Android > Electron > Web
  if (isCapacitorAndroid() || isAndroidWebView()) {
    return PLATFORM.ANDROID;
  }
  if (isElectronRenderer()) {
    return PLATFORM.DESKTOP;
  }
  // Node main process (Electron main)
  if (typeof process !== "undefined" && process.versions && process.versions.electron) {
    return PLATFORM.DESKTOP;
  }
  // Fallback via localStorage override for testing
  if (typeof window !== "undefined") {
    try {
      const override = localStorage.getItem("streambert_platform_override");
      if (override === "android") return PLATFORM.ANDROID;
      if (override === "desktop") return PLATFORM.DESKTOP;
    } catch {}
  }
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
  return isElectronRenderer();
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

// Helper to check if we are in Android runtime without Electron/Termux
export function isPureAndroidRuntime() {
  return isAndroid() && !isElectronRenderer();
}
