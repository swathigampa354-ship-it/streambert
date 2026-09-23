// ── Android Native Proxy ────────────────────────────────────────────────
// Proxy implementation for Android that uses native bridge (Capacitor plugin with NanoHTTPD)
// No Electron/Node dependencies in Android path.

import { startProxyNative, stopProxyNative } from "./androidBridge.js";

/**
 * Proxy server for Android native runtime
 * Uses native bridge to start HTTP server on 127.0.0.1
 * No Electron, no Node http module in Android path
 */
export class AndroidNativeProxy {
  constructor() {
    this.proxyUrl = null;
    this.port = null;
    this.targetUrl = null;
    this.headers = {};
    this.subtitleUrl = null;
    this.isRunning = false;
  }

  static extractHost(url) {
    try {
      const u = new URL(url);
      return u.host;
    } catch {
      const afterScheme = url.replace(/^https?:\/\//, "");
      return afterScheme.split("/")[0] || null;
    }
  }

  static extractTargetUrl(reqPath) {
    if (!reqPath) return null;
    if (reqPath.startsWith("/https/")) return "https://" + reqPath.slice(7);
    if (reqPath.startsWith("/http/")) return "http://" + reqPath.slice(6);
    if (reqPath.startsWith("/")) {
      const trimmed = reqPath.slice(1);
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    }
    return null;
  }

  /**
   * Start proxy
   * @param {string} targetUrl
   * @param {Object} headers
   * @param {string} [subtitleUrl]
   * @returns {Promise<string>} proxyUrl
   */
  async start(targetUrl, headers = {}, subtitleUrl = null) {
    if (this.isRunning) {
      await this.stop();
    }

    this.targetUrl = targetUrl;
    this.headers = headers;
    this.subtitleUrl = subtitleUrl;

    try {
      const result = await startProxyNative(targetUrl, headers, subtitleUrl);
      this.proxyUrl = result.proxyUrl;
      this.port = result.port;
      this.isRunning = true;
      console.log(`[AndroidNativeProxy] Started: ${this.proxyUrl} -> ${targetUrl}`);
      return this.proxyUrl;
    } catch (e) {
      console.error("[AndroidNativeProxy] Failed to start:", e);
      throw e;
    }
  }

  /**
   * Stop proxy
   * @returns {Promise<void>}
   */
  async stop() {
    try {
      await stopProxyNative();
      console.log("[AndroidNativeProxy] Stopped");
    } catch (e) {
      console.warn("[AndroidNativeProxy] Stop failed:", e);
    } finally {
      this.proxyUrl = null;
      this.port = null;
      this.isRunning = false;
    }
  }

  getProxyUrl() {
    return this.proxyUrl;
  }

  /**
   * Rewrite HLS playlist to use proxy URLs (pure JS, no Node)
   * This is used for testing and for native side that may need JS rewriting
   * @param {string} playlist
   * @param {string} baseUrl
   * @returns {string}
   */
  rewriteHlsPlaylist(playlist, baseUrl) {
    if (!this.port) {
      throw new Error("Proxy not running, no port");
    }

    const baseUrlObj = new URL(baseUrl);
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

    const resolveUrl = (relative) => {
      if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
      if (relative.startsWith("/")) return `${baseUrlObj.protocol}//${baseUrlObj.host}${relative}`;
      return basePath + relative;
    };

    const urlToProxyPath = (url) => {
      if (url.startsWith("https://")) return `http://127.0.0.1:${this.port}/https/${url.slice(8)}`;
      if (url.startsWith("http://")) return `http://127.0.0.1:${this.port}/http/${url.slice(7)}`;
      return url;
    };

    return playlist
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/g, (m, uri) => {
              const resolved = resolveUrl(uri);
              return `URI="${urlToProxyPath(resolved)}"`;
            });
          }
          return line;
        }
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
          return urlToProxyPath(trimmed);
        }
        if (trimmed) {
          return urlToProxyPath(resolveUrl(trimmed));
        }
        return line;
      })
      .join("\n");
  }
}

// Singleton for Android
export const androidProxy = new AndroidNativeProxy();

/**
 * Spawn proxy helper (mirrors MovieBox spawn_sidecar but Android native)
 * @param {string} targetUrl
 * @param {Object} headers
 * @param {string} [subtitleUrl]
 * @returns {Promise<{proxyUrl: string, proxyServer: AndroidNativeProxy}>}
 */
export async function spawnAndroidProxy(targetUrl, headers, subtitleUrl = null) {
  const proxy = new AndroidNativeProxy();
  const proxyUrl = await proxy.start(targetUrl, headers, subtitleUrl);
  return { proxyUrl, proxyServer: proxy };
}
