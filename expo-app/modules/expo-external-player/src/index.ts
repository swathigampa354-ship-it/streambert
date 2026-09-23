// Expo External Player Module - JS Interface
// Pure-native Android external player bridge, no Electron/Termux

import { NativeModulesProxy, requireNativeModule } from 'expo-modules-core';

let ExternalPlayerModule: any = null;

try {
  ExternalPlayerModule = requireNativeModule('ExpoExternalPlayer');
} catch (e) {
  console.warn('[ExpoExternalPlayer] Native module not available, using fallback:', e);
  // Fallback for web or when native module not linked
  ExternalPlayerModule = NativeModulesProxy.ExpoExternalPlayer || null;
}

export interface PlayerInfo {
  packageName: string;
  label: string;
  type: string;
  supportedMimeTypes?: string[];
}

export interface LaunchOptions {
  url: string;
  packageName?: string;
  mimeType?: string;
  title?: string;
  headers?: Record<string, string>;
  subtitle?: string;
}

export interface ProxyOptions {
  targetUrl: string;
  headers?: Record<string, string>;
  subtitleUrl?: string;
}

export interface ProxyResult {
  localUrl: string;
  port: number;
}

export interface SubtitleDownloadOptions {
  url: string;
  fileName: string;
  headers?: Record<string, string>;
}

/**
 * Get installed players via PackageManager (real detection)
 */
export async function getInstalledPlayersNative(): Promise<string[]> {
  if (!ExternalPlayerModule) {
    console.log('[ExpoExternalPlayer] No native module, returning empty - will use chooser fallback');
    return [];
  }
  try {
    const result = await ExternalPlayerModule.getInstalledPlayers();
    if (Array.isArray(result)) return result;
    if (result && Array.isArray(result.players)) return result.players;
    return [];
  } catch (e) {
    console.warn('[ExpoExternalPlayer] getInstalledPlayers failed:', e);
    return [];
  }
}

/**
 * Launch player via ACTION_VIEW Intent
 */
export async function launchPlayerNative(options: LaunchOptions): Promise<{ success: boolean; opener?: string; packageName?: string }> {
  if (!ExternalPlayerModule) {
    // Fallback to Intent URI via Linking
    console.log('[ExpoExternalPlayer] No native module, using Intent URI fallback');
    return launchViaIntentUri(options);
  }
  try {
    const result = await ExternalPlayerModule.launchPlayer(options);
    return result;
  } catch (e) {
    console.warn('[ExpoExternalPlayer] launchPlayer failed, trying Intent URI fallback:', e);
    return launchViaIntentUri(options);
  }
}

/**
 * Start proxy server for protected streams
 */
export async function startProxyNative(options: ProxyOptions): Promise<ProxyResult> {
  if (!ExternalPlayerModule) {
    throw new Error('Proxy requires native module - not available in fallback');
  }
  return await ExternalPlayerModule.startProxy(options);
}

/**
 * Stop proxy server
 */
export async function stopProxyNative(): Promise<void> {
  if (!ExternalPlayerModule) return;
  try {
    await ExternalPlayerModule.stopProxy();
  } catch (e) {
    console.warn('[ExpoExternalPlayer] stopProxy failed:', e);
  }
}

/**
 * Download subtitle to shared storage
 */
export async function downloadSubtitleNative(options: SubtitleDownloadOptions): Promise<string> {
  if (!ExternalPlayerModule) {
    throw new Error('Subtitle download requires native module');
  }
  const result = await ExternalPlayerModule.downloadSubtitle(options);
  if (typeof result === 'string') return result;
  if (result && result.filePath) return result.filePath;
  return result;
}

/**
 * Get subtitle directory
 */
export async function getSubtitleDirNative(): Promise<string> {
  if (!ExternalPlayerModule) {
    return '/sdcard/Download/StreambertSubs';
  }
  try {
    const result = await ExternalPlayerModule.getSubtitleDir();
    if (typeof result === 'string') return result;
    if (result && result.path) return result.path;
    return '/sdcard/Download/StreambertSubs';
  } catch {
    return '/sdcard/Download/StreambertSubs';
  }
}

/**
 * Check if native bridge available
 */
export function isNativeBridgeAvailable(): boolean {
  return !!ExternalPlayerModule;
}

/**
 * Intent URI fallback (no native module)
 */
function buildIntentUri(options: LaunchOptions): string {
  const { url, packageName, mimeType = 'video/*', title, headers, subtitle } = options;
  let uri = `intent:${encodeURI(url)}#Intent;action=android.intent.action.VIEW;type=${mimeType};`;
  if (packageName && packageName !== 'system-default') {
    uri += `package=${packageName};`;
  }
  if (title) {
    uri += `S.title=${encodeURIComponent(title)};S.android.intent.extra.TITLE=${encodeURIComponent(title)};`;
  }
  if (headers) {
    if (headers['User-Agent']) {
      uri += `S.User-Agent=${encodeURIComponent(headers['User-Agent'])};`;
    }
    if (headers['Referer']) {
      uri += `S.Referer=${encodeURIComponent(headers['Referer'])};`;
    }
  }
  if (subtitle) {
    uri += `S.subtitles_location=${encodeURIComponent(subtitle)};S.subs=${encodeURIComponent(subtitle)};S.sub=${encodeURIComponent(subtitle)};`;
  }
  uri += 'end';
  return uri;
}

async function launchViaIntentUri(options: LaunchOptions): Promise<{ success: boolean; opener: string }> {
  const uri = buildIntentUri(options);
  console.log('[ExpoExternalPlayer] Intent URI:', uri);
  try {
    // For Expo, use Linking
    const { Linking } = await import('react-native');
    const canOpen = await Linking.canOpenURL(uri);
    if (canOpen) {
      await Linking.openURL(uri);
      return { success: true, opener: 'intent-uri' };
    }
    // Fallback to web intent
    if (typeof window !== 'undefined') {
      window.location.href = uri;
      return { success: true, opener: 'intent-uri-web' };
    }
    return { success: false };
  } catch (e) {
    console.warn('[ExpoExternalPlayer] Intent URI failed:', e);
    return { success: false };
  }
}

export default {
  getInstalledPlayersNative,
  launchPlayerNative,
  startProxyNative,
  stopProxyNative,
  downloadSubtitleNative,
  getSubtitleDirNative,
  isNativeBridgeAvailable,
};
