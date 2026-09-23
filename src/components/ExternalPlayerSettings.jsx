import { useState, useEffect } from "react";
import { storage, STORAGE_KEYS } from "../utils/storage";
import { externalPlayerAdapter } from "../utils/externalPlayer/externalPlayerAdapter.js";
import { getPlaybackMode, setPlaybackMode, PLAYBACK_MODE, getPlatform, PLATFORM } from "../utils/platform.js";
import { KNOWN_PLAYERS } from "../utils/externalPlayer/playerRegistry.js";

export default function ExternalPlayerSettings() {
  const [playbackMode, setPlaybackModeState] = useState(() => getPlaybackMode());
  const [preferredPlayer, setPreferredPlayer] = useState(() => storage.get(STORAGE_KEYS.PREFERRED_EXTERNAL_PLAYER) || "system-default");
  const [useProxy, setUseProxy] = useState(() => storage.get(STORAGE_KEYS.USE_PROXY_FOR_EXTERNAL) !== false);
  const [availablePlayers, setAvailablePlayers] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [testUrl, setTestUrl] = useState("https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8");
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    detectPlayers();
  }, []);

  const detectPlayers = async () => {
    setDetecting(true);
    try {
      const players = await externalPlayerAdapter.detectAvailablePlayers();
      setAvailablePlayers(players);
    } catch (e) {
      console.error("Detect players failed", e);
    } finally {
      setDetecting(false);
    }
  };

  const handlePlaybackModeChange = (mode) => {
    setPlaybackMode(mode);
    setPlaybackModeState(mode);
  };

  const handlePreferredPlayerChange = (playerId) => {
    setPreferredPlayer(playerId);
    storage.set(STORAGE_KEYS.PREFERRED_EXTERNAL_PLAYER, playerId);
    externalPlayerAdapter.setPreferredPlayer(playerId);
  };

  const handleUseProxyChange = (val) => {
    setUseProxy(val);
    storage.set(STORAGE_KEYS.USE_PROXY_FOR_EXTERNAL, val);
  };

  const handleTestPlayback = async () => {
    setTestResult({ ok: false, message: "Testing..." });
    try {
      const { createTestStreamInfo } = await import("../utils/externalPlayer/streamResolver.js");
      const streamInfo = createTestStreamInfo(testUrl, {
        title: "Test Stream - Streambert",
        sourceId: "test",
      });

      const result = await externalPlayerAdapter.launch(streamInfo, {
        playerId: preferredPlayer === "system-default" ? null : preferredPlayer,
        useProxyIfNeeded: useProxy,
      });

      if (result.ok) {
        setTestResult({ ok: true, message: `Launched in ${result.player?.label || "player"} via ${result.method || result.opener || "intent"}` });
      } else {
        setTestResult({ ok: false, message: result.error || "Failed" });
      }
    } catch (e) {
      setTestResult({ ok: false, message: e.message });
    }
  };

  const platform = getPlatform();
  const isAndroid = platform === PLATFORM.ANDROID;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Info banner */}
      <div style={{ background: "rgba(100,150,255,0.1)", border: "1px solid rgba(100,150,255,0.2)", borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>📺 Android External Player Support</div>
        <div style={{ opacity: 0.8 }}>
          Streambert can now hand off video streams to installed Android players like VLC, MPV, MX Player, Just Player.
          This is required for Android because the desktop webview player cannot render video directly on Android.
          On desktop, this is optional and uses MPV/VLC binaries.
        </div>
      </div>

      {/* Playback Mode */}
      <div>
        <div className="settings-section-title">Playback Mode</div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
          Choose how video playback should work. Auto detects based on platform.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { id: PLAYBACK_MODE.AUTO, label: "Auto", desc: isAndroid ? "External player on Android, internal on desktop (recommended)" : "Internal player on desktop, external on Android" },
            { id: PLAYBACK_MODE.INTERNAL, label: "Internal (Desktop WebView)", desc: "Use built-in webview player (desktop only, not recommended on Android)" },
            { id: PLAYBACK_MODE.EXTERNAL, label: "External Player", desc: "Always use external player (VLC/MPV/MX) - required for Android" },
          ].map(opt => (
            <div
              key={opt.id}
              onClick={() => handlePlaybackModeChange(opt.id)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 14px",
                background: playbackMode === opt.id ? "rgba(229,9,20,0.1)" : "var(--surface)",
                border: `1px solid ${playbackMode === opt.id ? "var(--red)" : "var(--border)"}`,
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <div style={{
                width: 18, height: 18, borderRadius: "50%",
                border: `2px solid ${playbackMode === opt.id ? "var(--red)" : "var(--border)"}`,
                background: playbackMode === opt.id ? "var(--red)" : "transparent",
                flexShrink: 0, marginTop: 2,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {playbackMode === opt.id && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{opt.label}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>{opt.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Preferred Player */}
      <div>
        <div className="settings-section-title">Preferred External Player</div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>
          Detected {availablePlayers.length} player(s). Select your preferred player. System Chooser will show Android's app picker.
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className="btn btn-secondary" onClick={detectPlayers} disabled={detecting} style={{ fontSize: 13 }}>
            {detecting ? "Detecting..." : "🔍 Detect Players"}
          </button>
          {availablePlayers.length === 0 && !detecting && (
            <span style={{ fontSize: 12, color: "var(--text3)", alignSelf: "center" }}>
              No players detected. Install VLC/MPV/MX Player.
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
          {[
            { id: "system-default", label: "System Chooser (Recommended)", packageNames: [], type: "system", supportsHls: true, supportsSubtitles: false },
            ...KNOWN_PLAYERS,
            ...availablePlayers.filter(p => !KNOWN_PLAYERS.some(k => k.id === p.id) && p.id !== "system-default"),
          ]
            .filter((v, i, a) => a.findIndex(t => t.id === v.id) === i)
            .map(player => (
              <div
                key={player.id}
                onClick={() => handlePreferredPlayerChange(player.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: preferredPlayer === player.id ? "rgba(229,9,20,0.1)" : "var(--surface)",
                  border: `1px solid ${preferredPlayer === player.id ? "var(--red)" : "var(--border)"}`,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  border: `2px solid ${preferredPlayer === player.id ? "var(--red)" : "var(--border)"}`,
                  background: preferredPlayer === player.id ? "var(--red)" : "transparent",
                  flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {preferredPlayer === player.id && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{player.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>
                    {player.packageNames?.[0] || player.type} • HLS {player.supportsHls ? "✓" : "✗"} • Subs {player.supportsSubtitles ? "✓" : "✗"}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Proxy toggle */}
      <div>
        <div className="settings-section-title">Local Proxy for Protected Streams</div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12, lineHeight: 1.6 }}>
          Some streams require headers like Cookie, Referer, Authorization that cannot be passed directly to external players.
          A local proxy (127.0.0.1) injects these headers server-side and rewrites HLS playlists. This is similar to MovieBox-TUI's sidecar proxy.
          Only binds to loopback, not exposed externally.
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input type="checkbox" checked={useProxy} onChange={e => handleUseProxyChange(e.target.checked)} />
          <span style={{ fontSize: 14 }}>Enable local proxy when needed (recommended)</span>
        </label>
        {useProxy && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--text3)", background: "var(--surface)", padding: 8, borderRadius: 6 }}>
            Proxy will start automatically on 127.0.0.1:random-port when a stream requires Cookie/Auth headers.
            HLS manifests will be rewritten to route segments through proxy. Terminates after 10 min idle.
          </div>
        )}
      </div>

      {/* Test playback */}
      <div>
        <div className="settings-section-title">Test External Playback</div>
        <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 12 }}>
          Test with a public HLS stream. This verifies external player integration without needing to resolve a real movie.
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            className="apikey-input"
            style={{ flex: 1, minWidth: 260, marginBottom: 0, fontSize: 12 }}
            value={testUrl}
            onChange={e => setTestUrl(e.target.value)}
            placeholder="https://.../playlist.m3u8"
          />
          <button className="btn btn-primary" onClick={handleTestPlayback} style={{ fontSize: 13 }}>
            ▶ Test Play
          </button>
        </div>
        {testResult && (
          <div style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 6,
            fontSize: 13,
            background: testResult.ok ? "rgba(72,199,116,0.15)" : "rgba(255,56,96,0.15)",
            border: `1px solid ${testResult.ok ? "rgba(72,199,116,0.3)" : "rgba(255,56,96,0.3)"}`,
            color: testResult.ok ? "#48c774" : "#ff3860",
          }}>
            {testResult.ok ? "✓ " : "✗ "}{testResult.message}
          </div>
        )}
      </div>

      {/* Player support matrix */}
      <div>
        <div className="settings-section-title">Player Support Matrix</div>
        <div style={{ fontSize: 12, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>Player</th>
                <th style={{ padding: "6px 8px" }}>Package</th>
                <th style={{ padding: "6px 8px" }}>HLS</th>
                <th style={{ padding: "6px 8px" }}>Headers</th>
                <th style={{ padding: "6px 8px" }}>Subs</th>
                <th style={{ padding: "6px 8px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {KNOWN_PLAYERS.map(p => {
                const isAvailable = availablePlayers.some(ap => ap.id === p.id);
                return (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", opacity: isAvailable ? 1 : 0.5 }}>
                    <td style={{ padding: "6px 8px", fontWeight: 500 }}>{p.label}</td>
                    <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 11 }}>{p.packageNames[0] || "chooser"}</td>
                    <td style={{ padding: "6px 8px" }}>{p.supportsHls ? "✓" : "✗"}</td>
                    <td style={{ padding: "6px 8px" }}>{p.supportsHeaders ? "✓" : "proxy"}</td>
                    <td style={{ padding: "6px 8px" }}>{p.supportsSubtitles ? "✓" : "✗"}</td>
                    <td style={{ padding: "6px 8px" }}>{isAvailable ? "✓ Detected" : "Not installed"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
