// ── IPC: External Player (Android-compatible playback) ─────────────────────
// Handles:
// - Detection of available desktop players (mpv, vlc)
// - Probing Android openers (termux-am, termux-open, etc.) for simulation
// - Launching external players with headers/subtitles
// - Local proxy server for header-protected streams (Cookie, etc.)

const { ipcMain } = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");

// ── Proxy Server (main process) ────────────────────────────────────────────
// Re-implementation of proxyServer.js logic for main process (Node)

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
        const proxyPath = targetUrl.startsWith("https://")
          ? `/https/${targetUrl.slice(8)}`
          : `/http/${targetUrl.slice(7)}`;
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

// Singleton proxy
let globalProxy = null;

// ── Player detection (desktop) ─────────────────────────────────────────────

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
  // Check common paths
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

// ── Android opener probing (for simulation & Termux env) ────────────────────

function probeAndroidOpeners() {
  const openers = [];

  // Check env override
  const custom = process.env.MOVIEBOX_ANDROID_PLAYER_PATH;
  if (custom) {
    if (custom.endsWith("termux-open-url")) openers.push({ type: "termux-open-url", path: custom });
    else if (custom.endsWith("termux-am")) openers.push({ type: "termux-am", path: custom });
    else openers.push({ type: "termux-open", path: custom });
    return openers;
  }

  // Check PREFIX (Termux)
  const prefix = process.env.PREFIX || "/data/data/com.termux/files/usr";
  const candidates = [
    { type: "termux-am", path: `${prefix}/bin/termux-am` },
    { type: "termux-open", path: `${prefix}/bin/termux-open` },
    { type: "termux-open-url", path: `${prefix}/bin/termux-open-url` },
  ];
  for (const c of candidates) {
    if (fs.existsSync(c.path)) openers.push(c);
  }

  // Check PATH
  const pathChecks = [
    { type: "termux-am", bin: "termux-am" },
    { type: "termux-open", bin: "termux-open" },
    { type: "termux-open-url", bin: "termux-open-url" },
  ];
  for (const check of pathChecks) {
    const found = findInPath(check.bin);
    if (found && !openers.some(o => o.path === found)) {
      openers.push({ type: check.type, path: found });
    }
  }

  // System am (root)
  if (process.platform !== "win32") {
    const systemAm = "/system/bin/am";
    if (fs.existsSync(systemAm)) {
      openers.push({ type: "system-am", path: systemAm });
    }
    const amInPath = findInPath("am");
    if (amInPath && !openers.some(o => o.path === amInPath)) {
      openers.push({ type: "system-am", path: amInPath });
    }
  }

  return openers;
}

// ── Launch helpers ─────────────────────────────────────────────────────────

function buildSubtitleExtras(subtitlePath) {
  if (!subtitlePath) return [];
  return [
    ["-e", "subtitles_location", subtitlePath],
    ["--eu", "subtitles_location", subtitlePath],
    ["-e", "subs", subtitlePath],
    ["--esal", "subs", subtitlePath],
    ["-e", "subs.enable", subtitlePath],
    ["--esal", "subs.enable", subtitlePath],
    ["-e", "sub", subtitlePath],
    ["--eu", "sub", subtitlePath],
    ["-e", "title_subtitle", subtitlePath],
  ];
}

function buildHeaderExtras(headers) {
  const extras = [];
  if (!headers) return extras;
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (lower === "user-agent") extras.push(["-e", "User-Agent", v]);
    else if (lower === "referer") extras.push(["-e", "Referer", v]);
  }
  return extras;
}

function launchViaTermuxAm(url, options) {
  const { subtitle, headers, packageName, title, mimeType = "video/*", openerPath = "termux-am" } = options;

  const args = ["start", "-a", "android.intent.action.VIEW", "-d", url, "-t", mimeType];

  if (packageName) {
    args.push("-n", packageName);
  }

  if (title) {
    args.push("-e", "title", title);
    args.push("-e", "android.intent.extra.TITLE", title);
  }

  for (const [flag, key, val] of buildHeaderExtras(headers)) {
    args.push(flag, key, val);
  }

  if (subtitle) {
    for (const [flag, key, val] of buildSubtitleExtras(subtitle)) {
      args.push(flag, key, val);
    }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(openerPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true, opener: "termux-am", stdout, stderr });
      else reject(new Error(`termux-am exited ${code}: ${stderr || stdout}`));
    });
    proc.on("error", reject);
  });
}

function launchViaTermuxOpen(url, options) {
  const { mimeType = "video/*", openerPath = "termux-open" } = options;
  const args = ["--chooser", "--content-type", mimeType, url];

  return new Promise((resolve, reject) => {
    const proc = spawn(openerPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdout = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve({ ok: true, opener: "termux-open", stdout, stderr });
      else reject(new Error(`termux-open exited ${code}: ${stderr || stdout}`));
    });
    proc.on("error", reject);
  });
}

// ── IPC Registration ───────────────────────────────────────────────────────

function register() {
  // Get available desktop players
  ipcMain.handle("get-available-players", () => {
    const players = detectDesktopPlayers();
    return { ok: true, players };
  });

  // Probe Android openers
  ipcMain.handle("probe-android-openers", () => {
    const openers = probeAndroidOpeners();
    return { ok: true, openers };
  });

  // Start proxy server
  ipcMain.handle("start-proxy-server", async (_, { targetUrl, headers, subtitleUrl }) => {
    try {
      if (!globalProxy) globalProxy = new MainProxyServer();
      const result = await globalProxy.start(targetUrl, headers, subtitleUrl);
      return { ok: true, port: result.port, proxyUrl: result.proxyUrl };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Stop proxy server
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

  // Launch external player (desktop)
  ipcMain.handle("launch-external-player", async (_, { url, playerId, headers, subtitle, title, mimeType }) => {
    try {
      // For desktop, use existing player.js logic but for stream URLs
      // Try mpv first, then vlc, then shell.open
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

      // Build header args for mpv/vlc
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
            // Custom headers via --http-header-fields for mpv
            mpvHeaderArgs.push(`--http-header-fields=${k}: ${v}`);
          }
        }
      }

      const subArgs = subtitle ? [`--sub-file=${subtitle}`] : [];

      // Try based on preferred playerId
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

      // Fallback to shell open
      const { shell } = require("electron");
      await shell.openExternal(url);
      return { ok: true, player: "system", method: "shell.openExternal" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Launch Android player (Termux simulation)
  ipcMain.handle("launch-android-player", async (_, { url, playerId, packageName, headers, subtitle, title, mimeType }) => {
    try {
      const openers = probeAndroidOpeners();
      if (openers.length === 0) {
        return { ok: false, error: "No Android opener found (termux-am, termux-open not installed)" };
      }

      // Prefer termux-am for header/subtitle support, fallback to termux-open
      const amOpener = openers.find(o => o.type === "termux-am");
      if (amOpener) {
        try {
          const result = await launchViaTermuxAm(url, {
            subtitle,
            headers,
            packageName,
            title,
            mimeType,
            openerPath: amOpener.path,
          });
          return { ok: true, opener: "termux-am", ...result };
        } catch (e) {
          console.warn("[ExternalPlayer] termux-am failed, trying termux-open:", e.message);
        }
      }

      const openOpener = openers.find(o => o.type === "termux-open");
      if (openOpener) {
        const result = await launchViaTermuxOpen(url, {
          mimeType,
          openerPath: openOpener.path,
        });
        return { ok: true, opener: "termux-open", ...result };
      }

      // Try termux-open-url
      const openUrlOpener = openers.find(o => o.type === "termux-open-url");
      if (openUrlOpener) {
        return new Promise((resolve, reject) => {
          const proc = spawn(openUrlOpener.path, [url], { stdio: "ignore" });
          proc.on("close", (code) => {
            if (code === 0) resolve({ ok: true, opener: "termux-open-url" });
            else reject(new Error(`termux-open-url exited ${code}`));
          });
          proc.on("error", reject);
        });
      }

      return { ok: false, error: "No suitable Android opener succeeded" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Get stream headers for URL (from session cookies)
  ipcMain.handle("get-stream-headers", async (_, { url, sourceId }) => {
    try {
      const { session } = require("electron");
      const playerSession = session.fromPartition("persist:player");

      // Get cookies for URL
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
}

module.exports = { register, MainProxyServer, detectDesktopPlayers, probeAndroidOpeners };
