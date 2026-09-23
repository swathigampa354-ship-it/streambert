// ── IPC: External Player (Desktop only) ───────────────────────────────────
// Fixed: This file is DESKTOP ONLY (Electron main process).
// Android runtime does NOT use this file — it uses native Java plugin (ExternalPlayerPlugin.java)
// No Termux dependencies in Android path. Termux code removed.

const { ipcMain } = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");

// ── Proxy Server (Desktop main process) ────────────────────────────────────
// Node http server for desktop only. Android uses AndroidProxyServer.java (NanoHTTPD)

class MainProxyServer {
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

  async start(targetUrl, headers = {}, subtitleUrl = null) {
    if (this.isRunning) await this.stop();

    this.targetUrl = targetUrl;
    this.headers = headers;
    this.subtitleUrl = subtitleUrl;
    this.targetHost = MainProxyServer.extractHost(targetUrl);

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        this.activeConnections++;
        this.lastActivity = Date.now();
        try {
          await this.handleRequest(req, res);
        } catch (e) {
          console.error("[MainProxy] Error:", e);
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
        console.log(`[MainProxy] Started port ${this.port} -> ${targetUrl}`);
        resolve({ port: this.port, proxyUrl });
      });

      this.server.on("error", reject);
    });
  }

  async handleRequest(req, res) {
    const targetUrl = MainProxyServer.extractTargetUrl(req.url);
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "text/plain", Connection: "close" });
      res.end("Bad Request");
      return;
    }

    const extractedHost = MainProxyServer.extractHost(targetUrl);
    const subtitleHost = this.subtitleUrl ? MainProxyServer.extractHost(this.subtitleUrl) : null;
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
      const isM3u8 = targetUrl.includes(".m3u8") || contentType.includes("mpegurl") || contentType.includes("x-mpegURL");

      if (isM3u8) {
        let data = "";
        proxyRes.on("data", (c) => (data += c));
        proxyRes.on("end", () => {
          try {
            const rewritten = this.rewriteHlsPlaylist(data, targetUrl);
            res.writeHead(proxyRes.statusCode, {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Content-Length": Buffer.byteLength(rewritten),
              Connection: "close",
              "Access-Control-Allow-Origin": "*",
            });
            res.end(rewritten);
          } catch (e) {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(data);
          }
        });
      } else {
        res.writeHead(proxyRes.statusCode, {
          ...proxyRes.headers,
          Connection: "close",
          "Access-Control-Allow-Origin": "*",
        });
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

  rewriteHlsPlaylist(playlist, baseUrl) {
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

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivity;
      if (this.activeConnections === 0 && idleMs > 10 * 60 * 1000) {
        console.log("[MainProxy] Idle timeout, stopping");
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
    this.port = null;
    this.isRunning = false;
  }
}

let globalProxy = null;

function findInPath(bin) {
  const whichCmd = process.platform === "win32" ? "where" : "which";
  try {
    const result = spawnSync(whichCmd, [bin], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim().split("\n")[0].trim();
    }
  } catch {}
  return null;
}

function detectDesktopPlayers() {
  const players = [];
  if (findInPath("mpv")) players.push("mpv");
  if (findInPath("vlc")) players.push("vlc");
  const commonChecks = [
    { id: "mpv", paths: process.platform === "win32" ? ["C:\\Program Files\\mpv\\mpv.exe"] : ["/usr/bin/mpv", "/usr/local/bin/mpv"] },
    { id: "vlc", paths: process.platform === "win32" ? ["C:\\Program Files\\VideoLAN\\VLC\\vlc.exe"] : ["/usr/bin/vlc"] },
  ];
  for (const check of commonChecks) {
    if (players.includes(check.id)) continue;
    for (const p of check.paths) {
      if (fs.existsSync(p)) {
        players.push(check.id);
        break;
      }
    }
  }
  return players;
}

function register() {
  // Desktop only: get available desktop players (mpv, vlc)
  ipcMain.handle("get-available-players", () => {
    const players = detectDesktopPlayers();
    return { ok: true, players };
  });

  // Desktop proxy (Node http) — NOT for Android
  ipcMain.handle("start-proxy-server", async (_, { targetUrl, headers, subtitleUrl }) => {
    try {
      if (!globalProxy) globalProxy = new MainProxyServer();
      const result = await globalProxy.start(targetUrl, headers, subtitleUrl);
      return { ok: true, port: result.port, proxyUrl: result.proxyUrl };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("stop-proxy-server", async () => {
    try {
      if (globalProxy) {
        await globalProxy.stop();
        globalProxy = null;
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Desktop: launch external player (mpv, vlc, system)
  ipcMain.handle("launch-external-player", async (_, { url, playerId, headers, subtitle, title, mimeType }) => {
    try {
      const platform = process.platform;

      const resolveBin = (bin) => {
        if (path.isAbsolute(bin)) return fs.existsSync(bin) ? bin : null;
        return findInPath(bin);
      };

      const tryLaunch = (bin, args) => {
        const resolved = resolveBin(bin);
        if (!resolved) return false;
        try {
          spawn(resolved, args, { detached: true, stdio: "ignore" }).unref();
          return true;
        } catch {
          return false;
        }
      };

      const vlcPaths =
        platform === "win32"
          ? ["C:\\Program Files\\VideoLAN\\VLC\\vlc.exe", "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe", "vlc"]
          : platform === "darwin"
            ? ["/Applications/VLC.app/Contents/MacOS/VLC", "vlc"]
            : ["/usr/bin/vlc", "/usr/local/bin/vlc", "/snap/bin/vlc", "vlc"];

      const mpvPaths =
        platform === "win32"
          ? ["mpv", "C:\\Program Files\\mpv\\mpv.exe"]
          : platform === "darwin"
            ? ["/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "mpv"]
            : ["/usr/bin/mpv", "/usr/local/bin/mpv", "/snap/bin/mpv", "mpv"];

      const mpvHeaderArgs = [];
      const vlcHeaderArgs = [];

      if (headers) {
        for (const [k, v] of Object.entries(headers)) {
          const lower = k.toLowerCase();
          if (lower === "user-agent") {
            mpvHeaderArgs.push(`--user-agent=${v}`);
            vlcHeaderArgs.push(`--http-user-agent=${v}`);
          } else if (lower === "referer") {
            mpvHeaderArgs.push(`--referrer=${v}`);
            vlcHeaderArgs.push(`--http-referrer=${v}`);
          } else {
            mpvHeaderArgs.push(`--http-header-fields=${k}: ${v}`);
          }
        }
      }

      const subArgs = subtitle ? [`--sub-file=${subtitle}`] : [];

      if (playerId === "mpv" || !playerId) {
        for (const mpv of mpvPaths) {
          if (tryLaunch(mpv, [...mpvHeaderArgs, ...subArgs, url])) {
            return { ok: true, player: "mpv", method: "spawn" };
          }
        }
      }

      if (playerId === "vlc" || !playerId) {
        for (const vlc of vlcPaths) {
          if (tryLaunch(vlc, [...vlcHeaderArgs, ...subArgs, url])) {
            return { ok: true, player: "vlc", method: "spawn" };
          }
        }
      }

      const { shell } = require("electron");
      await shell.openExternal(url);
      return { ok: true, player: "system", method: "shell.openExternal" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Get stream headers from session cookies (desktop only)
  ipcMain.handle("get-stream-headers", async (_, { url, sourceId }) => {
    try {
      const { session } = require("electron");
      const playerSession = session.fromPartition("persist:player");
      let cookieHeader = "";
      try {
        const cookies = await playerSession.cookies.get({ url });
        if (cookies && cookies.length) {
          cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join("; ");
        }
      } catch {}

      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: url,
      };

      if (cookieHeader) headers["Cookie"] = cookieHeader;

      return { ok: true, headers };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // NOTE: Android-specific IPC handlers REMOVED
  // Previously had probe-android-openers and launch-android-player using Termux shell commands
  // Those are INVALID for pure Android runtime per task requirements
  // Android now uses native Java plugin (ExternalPlayerPlugin.java) via Capacitor
  // No Electron, no Node, no Termux in Android path
}

module.exports = { register, MainProxyServer, detectDesktopPlayers };
