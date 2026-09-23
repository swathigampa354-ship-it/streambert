// ── Local Proxy Server ───────────────────────────────────────────────────
// Fixed to remove invalid Android dependencies.
// Desktop uses Node http server via Electron IPC.
// Android uses native bridge (Capacitor plugin with NanoHTTPD) — no Node/Electron in Android path.

import { getPlatform, PLATFORM } from "../platform.js";

/**
 * Base proxy logic shared (HLS rewriting, host extraction)
 */
class BaseProxy {
  static extractHost(url) {
    try {
      const u = new URL(url);
      return u.host;
    } catch {
      const afterScheme = url.replace(/^https?:\/\//, "");
      return afterScheme.split("/")[0] || null;
    }
  }

  static extractTargetUrl(path) {
    if (!path) return null;
    if (path.startsWith("/https/")) return "https://" + path.slice(7);
    if (path.startsWith("/http/")) return "http://" + path.slice(6);
    if (path.startsWith("/")) {
      const trimmed = path.slice(1);
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    }
    return null;
  }

  rewriteHlsPlaylist(playlist, baseUrl, port) {
    const baseUrlObj = new URL(baseUrl);
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

    const resolveUrl = (relative) => {
      if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
      if (relative.startsWith("/")) return `${baseUrlObj.protocol}//${baseUrlObj.host}${relative}`;
      return basePath + relative;
    };

    const urlToProxyPath = (url) => {
      if (url.startsWith("https://")) return `http://127.0.0.1:${port}/https/${url.slice(8)}`;
      if (url.startsWith("http://")) return `http://127.0.0.1:${port}/http/${url.slice(7)}`;
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

/**
 * Desktop proxy (Electron main process) — uses Node http
 * This is ONLY for desktop, NOT used in Android runtime.
 */
export class DesktopProxyServer extends BaseProxy {
  constructor() {
    super();
    this.server = null;
    this.port = null;
    this.targetUrl = null;
    this.headers = {};
    this.subtitleUrl = null;
    this.targetHost = null;
    this.activeConnections = 0;
    this.lastActivity = Date.now();
    this.watchdogTimer = null;
    this.isRunning = false;
  }

  async start(targetUrl, headers = {}, subtitleUrl = null) {
    if (this.isRunning) await this.stop();

    this.targetUrl = targetUrl;
    this.headers = headers;
    this.subtitleUrl = subtitleUrl;
    this.targetHost = BaseProxy.extractHost(targetUrl);

    // Desktop only: delegate to Electron IPC if in renderer
    if (typeof window !== "undefined" && window.electron?.startProxyServer) {
      const result = await window.electron.startProxyServer({ targetUrl, headers, subtitleUrl });
      if (result.ok) {
        this.port = result.port;
        this.isRunning = true;
        this.startWatchdog();
        const proxyPath = targetUrl.startsWith("https://") ? `/https/${targetUrl.slice(8)}` : `/http/${targetUrl.slice(7)}`;
        return `http://127.0.0.1:${result.port}${proxyPath}`;
      } else {
        throw new Error(result.error || "Failed to start desktop proxy");
      }
    }

    // Direct Node (main process)
    if (typeof require === "undefined") {
      throw new Error("DesktopProxyServer requires Node.js or Electron IPC");
    }

    const http = require("http");
    const https = require("https");

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        this.activeConnections++;
        this.lastActivity = Date.now();
        try {
          await this.handleRequest(req, res);
        } catch (e) {
          console.error("[DesktopProxy] Error:", e);
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain", Connection: "close" });
            res.end(`Proxy Error: ${e.message}`);
          }
        } finally {
          this.activeConnections--;
          this.lastActivity = Date.now();
        }
      });

      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server.address();
        this.port = addr.port;
        this.isRunning = true;
        this.startWatchdog();
        const proxyPath = targetUrl.startsWith("https://") ? `/https/${targetUrl.slice(8)}` : `/http/${targetUrl.slice(7)}`;
        const proxyUrl = `http://127.0.0.1:${this.port}${proxyPath}`;
        console.log(`[DesktopProxy] Started port ${this.port} -> ${targetUrl}`);
        resolve(proxyUrl);
      });

      this.server.on("error", reject);
    });
  }

  async handleRequest(req, res) {
    const http = require("http");
    const https = require("https");

    const targetUrl = BaseProxy.extractTargetUrl(req.url);
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain", Connection: "close" });
      res.end("Bad Request");
      return;
    }

    const extractedHost = BaseProxy.extractHost(targetUrl);
    const subtitleHost = this.subtitleUrl ? BaseProxy.extractHost(this.subtitleUrl) : null;
    const isAllowed = extractedHost === this.targetHost || (subtitleHost && extractedHost === subtitleHost);

    if (!isAllowed) {
      res.writeHead(403, { "Content-Type": "text/plain", Connection: "close" });
      res.end("Forbidden");
      return;
    }

    const urlObj = new URL(targetUrl);
    const lib = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: req.method,
      headers: {},
    };

    if (extractedHost === this.targetHost) {
      for (const [k, v] of Object.entries(this.headers)) options.headers[k] = v;
    } else {
      for (const [k, v] of Object.entries(this.headers)) {
        if (k.toLowerCase() === "user-agent") options.headers[k] = v;
      }
    }

    if (req.headers.range) options.headers["Range"] = req.headers.range;

    const proxyReq = lib.request(options, (proxyRes) => {
      const contentType = proxyRes.headers["content-type"] || "";
      const isM3u8 = targetUrl.includes(".m3u8") || contentType.includes("mpegurl");

      if (isM3u8) {
        let data = "";
        proxyRes.on("data", (c) => (data += c));
        proxyRes.on("end", () => {
          try {
            const rewritten = this.rewriteHlsPlaylist(data, targetUrl, this.port);
            res.writeHead(proxyRes.statusCode, {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Content-Length": Buffer.byteLength(rewritten),
              Connection: "close",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(rewritten);
          } catch {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(data);
          }
        });
      } else {
        res.writeHead(proxyRes.statusCode, { ...proxyRes.headers, Connection: "close", "Access-Control-Allow-Origin": "*" });
        proxyRes.pipe(res);
      }
    });

    proxyReq.on("error", (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain", Connection: "close" });
        res.end(`Gateway Error: ${err.message}`);
      }
    });

    proxyReq.setTimeout(15000, () => {
      proxyReq.destroy();
      if (!res.headersSent) {
        res.writeHead(504, { "Content-Type": "text/plain" });
        res.end("Gateway Timeout");
      }
    });

    proxyReq.end();
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivity;
      if (this.activeConnections === 0 && idleMs > 10 * 60 * 1000) {
        console.log("[DesktopProxy] Idle timeout, stopping");
        this.stop();
      }
    }, 15000);
  }

  async stop() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.server = null;
          this.port = null;
          this.isRunning = false;
          resolve();
        });
      });
    }
    if (typeof window !== "undefined" && window.electron?.stopProxyServer) {
      try {
        await window.electron.stopProxyServer();
      } catch {}
    }
    this.port = null;
    this.isRunning = false;
  }

  getProxyUrl() {
    if (!this.isRunning || !this.port || !this.targetUrl) return null;
    const proxyPath = this.targetUrl.startsWith("https://") ? `/https/${this.targetUrl.slice(8)}` : `/http/${this.targetUrl.slice(7)}`;
    return `http://127.0.0.1:${this.port}${proxyPath}`;
  }
}

// For backward compatibility, ProxyServer = DesktopProxyServer on desktop, AndroidNativeProxy on Android
// But we explicitly separate to avoid invalid dependencies

/**
 * ProxyServer class that auto-selects implementation based on platform
 * Desktop: uses DesktopProxyServer (Node/Electron)
 * Android: uses AndroidNativeProxy (native bridge, no Node)
 */
export class ProxyServer extends BaseProxy {
  constructor() {
    super();
    this.impl = null;
    this.platform = getPlatform();
  }

  async start(targetUrl, headers = {}, subtitleUrl = null) {
    if (this.platform === PLATFORM.ANDROID) {
      // Android: use native proxy (no Node/Electron)
      const { AndroidNativeProxy } = await import("./androidNativeProxy.js");
      this.impl = new AndroidNativeProxy();
      return this.impl.start(targetUrl, headers, subtitleUrl);
    } else {
      // Desktop: use Node proxy
      this.impl = new DesktopProxyServer();
      return this.impl.start(targetUrl, headers, subtitleUrl);
    }
  }

  async stop() {
    if (this.impl) {
      await this.impl.stop();
      this.impl = null;
    }
  }

  getProxyUrl() {
    return this.impl?.getProxyUrl?.() || null;
  }

  get isRunning() {
    return this.impl?.isRunning || false;
  }

  get port() {
    return this.impl?.port || null;
  }
}

// Singleton
export const globalProxyServer = new ProxyServer();

export async function spawnProxy(targetUrl, headers, subtitleUrl = null) {
  const platform = getPlatform();
  if (platform === PLATFORM.ANDROID) {
    const { spawnAndroidProxy } = await import("./androidNativeProxy.js");
    return spawnAndroidProxy(targetUrl, headers, subtitleUrl);
  } else {
    const proxy = new DesktopProxyServer();
    const proxyUrl = await proxy.start(targetUrl, headers, subtitleUrl);
    return { proxyUrl, proxyServer: proxy };
  }
}
