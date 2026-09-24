// Android platform implementation - uses Expo modules + native bridge
// For WebView version, uses window.AndroidBridge or Expo modules
// For React Native version, uses Expo modules directly

import { getInstalledPlayersNative, launchPlayerNative, startProxyNative, stopProxyNative, downloadSubtitleNative, getSubtitleDirNative, isNativeBridgeAvailable } from '../../utils/externalPlayer/androidBridge.js';

// Try to load Expo modules if available (React Native), fallback to web
let FileSystem = null;
let SecureStore = null;
let MediaLibrary = null;

try {
  // These will only be available in Expo environment
  if (typeof require !== 'undefined') {
    try { FileSystem = require('expo-file-system'); } catch {}
    try { SecureStore = require('expo-secure-store'); } catch {}
    try { MediaLibrary = require('expo-media-library'); } catch {}
  }
} catch {}

const androidPlatform = {
  async getAppVersion() {
    return '2.6.0-android';
  },

  async getPlatform() {
    return 'android';
  },

  // Downloads - TODO Milestone 7
  async getDownloads() {
    // For Android, use FileSystem or AsyncStorage
    try {
      const raw = localStorage.getItem('streambert_downloads');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  async deleteDownload(args) {
    try {
      const raw = localStorage.getItem('streambert_downloads');
      const list = raw ? JSON.parse(raw) : [];
      const filtered = list.filter(d => d.id !== args.id);
      localStorage.setItem('streambert_downloads', JSON.stringify(filtered));
      return true;
    } catch {
      return false;
    }
  },

  async checkDownloader(folder) {
    return { available: false, reason: 'Downloads use Expo FileSystem on Android (Milestone 7)' };
  },

  async runDownload(args) {
    return { error: 'Downloads not yet implemented on Android - use external player for streaming (Milestone 7)' };
  },

  async fileExists(path) {
    if (FileSystem) {
      try {
        const info = await FileSystem.getInfoAsync(path);
        return info.exists;
      } catch {
        return false;
      }
    }
    // Fallback: check if it's a subtitle file we downloaded via native bridge
    if (path.includes('StreambertSubs')) {
      // Native bridge will check existence
      return true; // Assume exists if we have path
    }
    return false;
  },

  async showInFolder(path) {
    return false; // Not applicable on Android
  },

  async pickFolder() {
    // On Android, use Storage Access Framework or default to Downloads
    return '/sdcard/Download/Streambert';
  },

  async openExternal(url) {
    if (typeof window !== 'undefined' && window.ReactNativeWebView) {
      // In WebView, postMessage to RN to open via Linking
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_EXTERNAL', url }));
      return true;
    }
    // Try Linking if in RN
    try {
      const { Linking } = require('react-native');
      await Linking.openURL(url);
      return true;
    } catch {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank');
        return true;
      }
    }
    return false;
  },

  async openPath(filePath) {
    return false;
  },

  async openPathAtTime(filePath, seconds, subtitlePaths) {
    return false;
  },

  async secureGet(key) {
    if (SecureStore) {
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    }
    // Inside the Expo WebView the injected shim routes this to Expo SecureStore
    if (typeof window !== 'undefined' && window.electron?.secureGet) {
      try {
        return await window.electron.secureGet(key);
      } catch {}
    }
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  async secureSet(key, value) {
    if (SecureStore) {
      try {
        await SecureStore.setItemAsync(key, value);
        return true;
      } catch {
        return false;
      }
    }
    if (typeof window !== 'undefined' && window.electron?.secureSet) {
      try {
        return await window.electron.secureSet(key, value);
      } catch {}
    }
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  async searchSubtitles(args) {
    // For Android, use Wyzie API directly via fetch (no Electron IPC)
    // This is a simplified version - real implementation would use same logic as desktop but via fetch
    try {
      const { searchSubtitles } = await import('../../utils/subtitles.js');
      return searchSubtitles(args);
    } catch {
      return [];
    }
  },

  async downloadSubtitlesForFile(args) {
    // Use native bridge for Android
    // androidBridge.downloadSubtitleNative has POSITIONAL signature (url, filename, headers)
    try {
      const result = await downloadSubtitleNative(
        args.url || args.subtitleUrl,
        args.fileName || args.filename || 'subtitle.srt',
        args.headers || {},
      );
      const filePath = result && result.localPath ? result.localPath : null;
      if (!filePath) return null;
      return { filePath, success: true };
    } catch (e) {
      console.warn('[AndroidPlatform] downloadSubtitlesForFile failed:', e);
      return null;
    }
  },

  async deleteSubtitleFile(args) {
    return false;
  },

  // External player - REAL implementation using native bridge
  async getAvailablePlayers() {
    try {
      const packages = await getInstalledPlayersNative();
      // Map package names to player info
      const { KNOWN_PLAYERS } = await import('../../utils/externalPlayer/playerRegistry.js');
      const players = [];

      for (const pkg of packages) {
        const known = KNOWN_PLAYERS.find(p => p.packageNames.includes(pkg));
        if (known) {
          players.push({
            id: known.id,
            label: known.label,
            packageName: pkg,
            type: 'android',
            supportsHeaders: known.supportsHeaders,
            supportsSubtitles: known.supportsSubtitles,
          });
        } else {
          // Custom player
          players.push({
            id: pkg,
            label: `Video Player (${pkg})`,
            packageName: pkg,
            type: 'android',
            supportsHeaders: false,
            supportsSubtitles: false,
          });
        }
      }

      // Always add system chooser
      players.push({
        id: 'system-default',
        label: 'System Default (Chooser)',
        packageName: 'system-default',
        type: 'system',
        supportsHeaders: false,
        supportsSubtitles: false,
      });

      if (players.length === 1) {
        // Only chooser, no real players
        return {
          players: [],
          error: 'No compatible external player installed. Install VLC, MPV, or MX Player from Play Store.',
          hasChooser: true,
        };
      }

      return { players };
    } catch (e) {
      console.warn('[AndroidPlatform] getAvailablePlayers failed:', e);
      return { players: [], error: e.message };
    }
  },

  async launchExternalPlayer(args) {
    // Use the Android pure-native adapter (actual exported name is launchInExternalPlayer)
    const { launchInExternalPlayer } = await import('../../utils/externalPlayer/externalPlayerAdapter.js');
    return launchInExternalPlayer(args);
  },

  async startProxyServer(args) {
    const { targetUrl, headers, subtitleUrl } = args;
    // androidBridge.startProxyNative has POSITIONAL signature (targetUrl, headers, subtitleUrl)
    const result = await startProxyNative(targetUrl, headers, subtitleUrl);
    return result;
  },

  async stopProxyServer() {
    await stopProxyNative();
  },

  async getStreamHeaders(args) {
    // For Android, build headers via headerHandler
    const { buildHeaders } = await import('../../utils/externalPlayer/headerHandler.js');
    return buildHeaders(args.embedUrl, args.sourceId);
  },

  async resolveAllManga(args) {
    // Port of src/ipc/allmanga.js to JS using fetch + WebCrypto
    // For now, try to use the same logic but with fetch
    // This is a simplified version - full port needs AES decryption via WebCrypto
    console.log('[AndroidPlatform] resolveAllManga called, attempting JS port...');
    try {
      // Try to import and use a JS version
      const { resolveAllManga } = await import('../../utils/externalPlayer/streamResolver.js');
      // This is placeholder - real implementation needs to port allmanga.js
      return { error: 'AllManga resolver JS port not yet complete - use WebView for anime (Milestone 3)' };
    } catch (e) {
      return { error: e.message };
    }
  },

  async showNotification({ title, body, silent }) {
    // In the Expo WebView, route through the injected electron shim to native
    if (typeof window !== 'undefined' && window.electron?.showNotification) {
      try {
        await window.electron.showNotification({ title, body, silent });
        return true;
      } catch {}
    }
    console.log(`[Notification] ${title}: ${body}`);
    return true;
  },

  async wyzieOpenRedeem() {
    // Open Wyzie redeem page via Linking
    const url = 'https://wyzie.ru/redeem';
    return this.openExternal(url);
  },

  async wyzieValidateKey(key) {
    return false;
  },
};

export default androidPlatform;
