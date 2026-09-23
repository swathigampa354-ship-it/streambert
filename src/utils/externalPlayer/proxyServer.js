// ── Local Proxy Server ───────────────────────────────────────────────────
// Implements a local HTTP proxy that injects required headers server-side
// and rewrites HLS playlists to route segment requests through the proxy.
// Based on MovieBox-TUI's proxy.rs sidecar approach.

/**
 * Proxy server for Electron (Node.js) environment.
 * For Android, this will be replaced by a Capacitor HTTP server or native proxy.
 */

export class ProxyServer {
  constructor() {
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

  /**
   * Extract host authority from URL
   * @param {string} url
   * @returns {string|null}
   */
  static extractHost(url) {
    try {
      const u = new URL(url);
      return u.host;
    } catch {
      // Try manual parsing
      const afterScheme = url.replace(/^https?:\/\//, "");
      const host = afterScheme.split("/")[0];
      return host || null;
    }
  }

  /**
   * Extract target URL from proxy request path
   * Path format: /https/<host>/path or /http/<host>/path or /<full-url>
   * @param {string} path
   * @returns {string|null}
   */
  static extractTargetUrl(path) {
    if (!path) return null;
    // Format: /https/example.com/path
    if (path.startsWith("/https/")) {
      return "https://" + path.slice(7);
    }
    if (path.startsWith("/http/")) {
      return "http://" + path.slice(6);
    }
    // Try to decode full URL from path
    if (path.startsWith("/")) {
      const trimmed = path.slice(1);
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return trimmed;
      }
    }
    return null;
  }

  /**
   * Start proxy server
   * @param {string} targetUrl - original stream URL
   * @param {Object} headers - headers to inject
   * @param {string} [subtitleUrl]
   * @returns {Promise<string>} proxy URL
   */
  async start(targetUrl, headers = {}, subtitleUrl = null) {
    if (this.isRunning) {
      await this.stop();
    }

    this.targetUrl = targetUrl;
    this.headers = headers;
    this.subtitleUrl = subtitleUrl;
    this.targetHost = ProxyServer.extractHost(targetUrl);

    // Only works in Electron/Node environment
    if (typeof window !== "undefined" && !window.electron && typeof require === "undefined") {
      // Browser environment - cannot start Node server
      // For Android, we need native bridge
      // Return a special proxy URL that will be handled by native side
      if (window.Capacitor) {
        // Capacitor HTTP server plugin would handle this
        throw new Error("ProxyServer requires native HTTP server on Android - use Capacitor plugin");
      }
      throw new Error("ProxyServer requires Node.js environment (Electron)");
    }

    return new Promise((resolve, reject) => {
      try {
        // Dynamic import for Node http module (works in Electron main or via IPC)
        // In renderer, we delegate to main process via IPC
        if (typeof window !== "undefined" && window.electron?.startProxyServer) {
          // Use Electron IPC to start proxy in main process
          window.electron.startProxyServer({ targetUrl, headers, subtitleUrl })
            .then(result => {
              if (result.ok) {
                this.port = result.port;
                this.isRunning = true;
                this.startWatchdog();
                // Build proxy URL
                const proxyPath = targetUrl.startsWith("https://")
                  ? `/https/${targetUrl.slice(8)}`
                  : targetUrl.startsWith("http://")
                  ? `/http/${targetUrl.slice(7)}`
                  : `/https/${targetUrl}`;
                resolve(`http://127.0.0.1:${result.port}${proxyPath}`);
              } else {
                reject(new Error(result.error || "Failed to start proxy"));
              }
            })
            .catch(reject);
          return;
        }

        // Direct Node implementation (for main process)
        const http = require("http");
        const https = require("https");
        const { URL } = require("url");

        this.server = http.createServer(async (req, res) => {
          this.activeConnections++;
          this.lastActivity = Date.now();

          try {
            await this.handleRequest(req, res);
          } catch (e) {
            console.error("[ProxyServer] handleRequest error:", e);
            if (!res.headersSent) {
              res.writeHead(502, { "Content-Type": "text/plain", "Connection": "close" });
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

          const proxyPath = targetUrl.startsWith("https://")
            ? `/https/${targetUrl.slice(8)}`
            : targetUrl.startsWith("http://")
            ? `/http/${targetUrl.slice(7)}`
            : `/https/${targetUrl}`;

          const proxyUrl = `http://127.0.0.1:${this.port}${proxyPath}`;
          console.log(`[ProxyServer] Started on port ${this.port}, target: ${targetUrl}, proxyUrl: ${proxyUrl}`);
          resolve(proxyUrl);
        });

        this.server.on("error", (err) => {
          console.error("[ProxyServer] Server error:", err);
          reject(err);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Handle incoming proxy request
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   */
  async handleRequest(req, res) {
    const http = require("http");
    const https = require("https");

    const targetUrl = ProxyServer.extractTargetUrl(req.url);
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain", "Connection": "close" });
      res.end("Bad Request: Invalid proxy path");
      return;
    }

    // Security: only allow targetHost and subtitle host
    const extractedHost = ProxyServer.extractHost(targetUrl);
    const subtitleHost = this.subtitleUrl ? ProxyServer.extractHost(this.subtitleUrl) : null;
    const isAllowed = extractedHost === this.targetHost || (subtitleHost && extractedHost === subtitleHost);

    if (!isAllowed) {
      res.writeHead(403, { "Content-Type": "text/plain", "Connection": "close" });
      res.end("Forbidden: Host not allowed");
      return;
    }

    // Build upstream request
    const urlObj = new URL(targetUrl);
    const lib = urlObj.protocol === "https:" ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === "https:" ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: req.method,
      headers: {},
    };

    // Inject auth headers if host matches targetHost, else only User-Agent
    if (extractedHost === this.targetHost) {
      for (const [k, v] of Object.entries(this.headers)) {
        options.headers[k] = v;
      }
    } else {
      // Subtitle host: only User-Agent
      for (const [k, v] of Object.entries(this.headers)) {
        if (k.toLowerCase() === "user-agent") {
          options.headers[k] = v;
        }
      }
    }

    // Forward Range header
    if (req.headers.range) {
      options.headers["Range"] = req.headers.range;
    }

    // Forward other relevant headers
    if (req.headers["user-agent"] && !options.headers["User-Agent"]) {
      options.headers["User-Agent"] = req.headers["user-agent"];
    }

    const proxyReq = lib.request(options, (proxyRes) => {
      // Check if HLS playlist and need rewriting
      const contentType = proxyRes.headers["content-type"] || "";
      const isM3u8 = targetUrl.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("x-mpegURL");

      if (isM3u8) {
        // Collect manifest and rewrite
        let data = "";
        proxyRes.on("data", chunk => data += chunk);
        proxyRes.on("end", () => {
          try {
            const rewritten = this.rewriteHlsPlaylist(data, targetUrl);
            const headers = {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Content-Length": Buffer.byteLength(rewritten),
              "Connection": "close",
              "Access-Control-Allow-Origin": "*",
            };
            res.writeHead(proxyRes.statusCode, headers);
            res.end(rewritten);
          } catch (e) {
            console.error("[ProxyServer] Playlist rewrite error:", e);
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(data);
          }
        });
      } else {
        // Stream binary (segment or mp4)
        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          "Connection": "close",
          "Access-Control-Allow-Origin": "*",
        });
        proxyRes.pipe(res);
      }
    });

    proxyReq.on("error", (err) => {
      console.error("[ProxyServer] Upstream error:", err);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "text/plain", "Connection": "close" });
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

  /**
   * Rewrite HLS playlist to route segment URLs through proxy
   * @param {string} playlist
   * @param {string} baseUrl - original playlist URL for resolving relative URLs
   * @returns {string}
   */
  rewriteHlsPlaylist(playlist, baseUrl) {
    const baseUrlObj = new URL(baseUrl);
    const basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

    const lines = playlist.split("\n");
    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        // Handle #EXT-X-KEY URI, #EXT-X-MAP URI, etc.
        if (trimmed.includes('URI="')) {
          return trimmed.replace(/URI="([^"]+)"/g, (match, uri) => {
            const resolved = this.resolveUrl(uri, basePath, baseUrlObj);
            const proxyUri = this.urlToProxyPath(resolved);
            return `URI="${proxyUri}"`;
          });
        }
        return line;
      }
      // This is a segment URL or sub-playlist URL
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        return this.urlToProxyPath(trimmed);
      }
      // Relative URL
      if (trimmed) {
        const resolved = this.resolveUrl(trimmed, basePath, baseUrlObj);
        return this.urlToProxyPath(resolved);
      }
      return line;
    });

    return rewritten.join("\n");
  }

  /**
   * Resolve relative URL against base
   * @param {string} relative
   * @param {string} basePath
   * @param {URL} baseUrlObj
   * @returns {string}
   */
  resolveUrl(relative, basePath, baseUrlObj) {
    if (relative.startsWith("http://") || relative.startsWith("https://")) {
      return relative;
    }
    if (relative.startsWith("/")) {
      return `${baseUrlObj.protocol}//${baseUrlObj.host}${relative}`;
    }
    return basePath + relative;
  }

  /**
   * Convert absolute URL to proxy path
   * @param {string} url
   * @returns {string}
   */
  urlToProxyPath(url) {
    if (url.startsWith("https://")) {
      return `http://127.0.0.1:${this.port}/https/${url.slice(8)}`;
    }
    if (url.startsWith("http://")) {
      return `http://127.0.0.1:${this.port}/http/${url.slice(7)}`;
    }
    return url;
  }

  /**
   * Start watchdog to auto-terminate after idle
   */
  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivity;
      // 10 minutes idle + 0 connections => stop
      if (this.activeConnections === 0 && idleMs > 10 * 60 * 1000) {
        console.log("[ProxyServer] Idle timeout, stopping");
        this.stop();
      }
    }, 15000);
  }

  /**
   * Stop proxy server
   */
  async stop() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log("[ProxyServer] Stopped");
          this.server = null;
          this.port = null;
          this.isRunning = false;
          resolve();
        });
      });
    }

    // If using Electron IPC
    if (typeof window !== "undefined" && window.electron?.stopProxyServer) {
      try {
        await window.electron.stopProxyServer();
      } catch {}
    }

    this.port = null;
    this.isRunning = false;
  }

  /**
   * Get current proxy URL if running
   * @returns {string|null}
   */
  getProxyUrl() {
    if (!this.isRunning || !this.port || !this.targetUrl) return null;
    const proxyPath = this.targetUrl.startsWith("https://")
      ? `/https/${this.targetUrl.slice(8)}`
      : `/http/${this.targetUrl.slice(7)}`;
    return `http://127.0.0.1:${this.port}${proxyPath}`;
  }
}

// Singleton instance for easy use
export const globalProxyServer = new ProxyServer();

// Helper function for quick proxy spawning (mirrors MovieBox spawn_sidecar)
export async function spawnProxy(targetUrl, headers, subtitleUrl = null) {
  const proxy = new ProxyServer();
  const proxyUrl = await proxy.start(targetUrl, headers, subtitleUrl);
  return { proxyUrl, proxyServer: proxy };
}
