// ── Unified Platform Abstraction ────────────────────────────────────────────
// Replaces direct window.electron calls with platform-agnostic API
// Desktop: Electron, Android: Expo native modules, Web: fallback

import { getPlatform, PLATFORM, isAndroid, isDesktop, isElectron } from '../utils/platform.js';

// Lazy load platform implementations
let desktopPlatform = null;
let androidPlatform = null;

async function getDesktopPlatform() {
  if (!desktopPlatform) {
    const mod = await import('./desktop/index.js');
    desktopPlatform = mod.default || mod;
  }
  return desktopPlatform;
}

async function getAndroidPlatform() {
  if (!androidPlatform) {
    const mod = await import('./android/index.js');
    androidPlatform = mod.default || mod;
  }
  return androidPlatform;
}

function getCurrentPlatform() {
  return getPlatform();
}

// ── Unified API ─────────────────────────────────────────────────────────────

export const platform = {
  // Platform detection
  getPlatform: () => getCurrentPlatform(),
  isAndroid: () => isAndroid(),
  isDesktop: () => isDesktop(),
  isElectron: () => isElectron(),
  isWeb: () => getCurrentPlatform() === PLATFORM.WEB,

  // App version
  async getAppVersion() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.getAppVersion();
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.getAppVersion();
    }
    return '2.6.0'; // fallback
  },

  // Platform string (win32, darwin, linux, android)
  async getPlatformString() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.getPlatform();
    }
    return p;
  },

  // Downloads
  async getDownloads() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.getDownloads();
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.getDownloads();
    }
    return [];
  },

  async deleteDownload(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.deleteDownload(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.deleteDownload(args);
    }
  },

  async checkDownloader(folder) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.checkDownloader(folder);
    }
    return { available: false, reason: 'Not supported on Android yet (Milestone 7)' };
  },

  async runDownload(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.runDownload(args);
    }
    return { error: 'Downloads not yet implemented on Android (Milestone 7)' };
  },

  // File operations
  async fileExists(path) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.fileExists(path);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.fileExists(path);
    }
    return false;
  },

  async showInFolder(path) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.showInFolder(path);
    }
    return false;
  },

  async pickFolder() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.pickFolder();
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.pickFolder();
    }
    return null;
  },

  async openExternal(url) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.openExternal(url);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.openExternal(url);
    }
    window.open(url, '_blank');
  },

  async openPath(filePath) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.openPath(filePath);
    }
    return false;
  },

  async openPathAtTime(filePath, seconds, subtitlePaths) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.openPathAtTime(filePath, seconds, subtitlePaths);
    }
    return false;
  },

  // Secure storage
  async secureGet(key) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.secureGet(key);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.secureGet(key);
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async secureSet(key, value) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.secureSet(key, value);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.secureSet(key, value);
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  // Subtitles
  async searchSubtitles(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.searchSubtitles(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.searchSubtitles(args);
    }
    return [];
  },

  async downloadSubtitlesForFile(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.downloadSubtitlesForFile(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.downloadSubtitlesForFile(args);
    }
    return null;
  },

  async deleteSubtitleFile(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.deleteSubtitleFile(args);
    }
    return false;
  },

  // External player (unified)
  async getAvailablePlayers() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.getAvailablePlayers();
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.getAvailablePlayers();
    }
    return [];
  },

  async launchExternalPlayer(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.launchExternalPlayer(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.launchExternalPlayer(args);
    }
    throw new Error('External player not supported on this platform');
  },

  async startProxyServer(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.startProxyServer(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.startProxyServer(args);
    }
  },

  async stopProxyServer() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.stopProxyServer();
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.stopProxyServer();
    }
  },

  async getStreamHeaders(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.getStreamHeaders(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.getStreamHeaders(args);
    }
    return {};
  },

  // AllManga resolver
  async resolveAllManga(args) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.resolveAllManga(args);
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.resolveAllManga(args);
    }
    throw new Error('AllManga resolver not implemented on this platform yet');
  },

  // Notifications
  async showNotification({ title, body, silent }) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.showNotification({ title, body, silent });
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.showNotification({ title, body, silent });
    }
    // Web fallback
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, silent });
    }
  },

  // Window controls (desktop only)
  async windowMinimize() {
    if (getCurrentPlatform() === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.windowMinimize();
    }
  },

  async windowToggleMaximize() {
    if (getCurrentPlatform() === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.windowToggleMaximize();
    }
  },

  async windowClose() {
    if (getCurrentPlatform() === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.windowClose();
    }
  },

  // Cache / storage cleaning
  async getCacheSize() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.getCacheSize();
    }
    return 0;
  },

  async clearAppCache() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.clearAppCache();
    }
    try {
      localStorage.clear();
      return true;
    } catch {
      return false;
    }
  },

  // Wyzie
  async wyzieOpenRedeem() {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.wyzieOpenRedeem();
    } else if (p === PLATFORM.ANDROID) {
      const ap = await getAndroidPlatform();
      return ap.wyzieOpenRedeem();
    }
  },

  async wyzieValidateKey(key) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      const dp = await getDesktopPlatform();
      return dp.wyzieValidateKey(key);
    }
    return false;
  },

  // Events
  onM3u8Found(cb) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      if (typeof window !== 'undefined' && window.electron?.onM3u8Found) {
        return window.electron.onM3u8Found(cb);
      }
    } else if (p === PLATFORM.ANDROID) {
      // For Android WebView, m3u8 detection via injected JS postMessage
      const handler = (event) => {
        if (event.data && event.data.type === 'STREAM_FOUND') {
          cb(event.data.url);
        }
      };
      window.addEventListener('message', handler);
      return handler;
    }
    return null;
  },

  offM3u8Found(handler) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      if (typeof window !== 'undefined' && window.electron?.offM3u8Found) {
        window.electron.offM3u8Found(handler);
      }
    } else {
      window.removeEventListener('message', handler);
    }
  },

  onSubtitleFound(cb) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      if (typeof window !== 'undefined' && window.electron?.onSubtitleFound) {
        return window.electron.onSubtitleFound(cb);
      }
    }
    return null;
  },

  offSubtitleFound(handler) {
    const p = getCurrentPlatform();
    if (p === PLATFORM.DESKTOP) {
      if (typeof window !== 'undefined' && window.electron?.offSubtitleFound) {
        window.electron.offSubtitleFound(handler);
      }
    }
  },
};

export default platform;
