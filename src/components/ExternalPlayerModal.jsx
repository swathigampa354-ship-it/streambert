import { useState, useEffect } from "react";
import { externalPlayerAdapter } from "../utils/externalPlayer/externalPlayerAdapter.js";
import { getPlatform, PLATFORM } from "../utils/platform.js";

export default function ExternalPlayerModal({
  isOpen,
  onClose,
  streamInfo,
  onLaunch,
}) {
  const [players, setPlayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState(null);
  const [proxyInfo, setProxyInfo] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        const list = await externalPlayerAdapter.detectAvailablePlayers();
        setPlayers(list);
        if (list.length > 0) {
          const preferred = externalPlayerAdapter.getPreferredPlayer();
          const found = preferred ? list.find(p => p.id === preferred) : null;
          setSelectedPlayer(found || list[0]);
        }
        // Analyze proxy need
        if (streamInfo && list.length > 0) {
          const player = list[0];
          const { analyzeProxyNeed } = await import("../utils/externalPlayer/headerHandler.js");
          const analysis = analyzeProxyNeed(streamInfo.headers, streamInfo.type, player);
          setProxyInfo(analysis);
        }
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [isOpen, streamInfo]);

  const handleLaunch = async () => {
    if (!streamInfo?.url) {
      setError("No stream URL available. Wait for video to load or try another source.");
      return;
    }
    if (!selectedPlayer) {
      setError("No player selected");
      return;
    }

    setLaunching(true);
    setError(null);

    try {
      const result = await externalPlayerAdapter.launch(streamInfo, {
        playerId: selectedPlayer.id,
        useProxyIfNeeded: true,
      });

      if (result.ok) {
        externalPlayerAdapter.setPreferredPlayer(selectedPlayer.id);
        onLaunch?.(result);
        onClose();
      } else {
        setError(result.error || "Failed to launch player");
      }
    } catch (e) {
      setError(e.message || "Launch failed");
    } finally {
      setLaunching(false);
    }
  };

  const handleLaunchWithChooser = async () => {
    if (!streamInfo?.url) {
      setError("No stream URL available");
      return;
    }
    setLaunching(true);
    setError(null);
    try {
      const result = await externalPlayerAdapter.launch(streamInfo, {
        useChooser: true,
        useProxyIfNeeded: true,
      });
      if (result.ok) {
        onLaunch?.(result);
        onClose();
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLaunching(false);
    }
  };

  if (!isOpen) return null;

  const platform = getPlatform();
  const isAndroid = platform === PLATFORM.ANDROID;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content external-player-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>Play in External Player</h2>
          <button className="btn btn-ghost modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Stream Info */}
          {streamInfo && (
            <div className="external-player__stream-info" style={{ background: "rgba(255,255,255,0.05)", padding: 12, borderRadius: 8, fontSize: 13 }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--accent, #ff3b3b)" }}>
                {streamInfo.title || "Stream"}
                {streamInfo.season != null && streamInfo.episode != null && ` - S${String(streamInfo.season).padStart(2, "0")}E${String(streamInfo.episode).padStart(2, "0")}`}
              </div>
              <div style={{ wordBreak: "break-all", opacity: 0.8, fontSize: 11, marginBottom: 6 }}>
                {streamInfo.url?.slice(0, 80)}{streamInfo.url?.length > 80 ? "..." : ""}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="badge" style={{ background: "rgba(255,255,255,0.1)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>
                  {streamInfo.type?.toUpperCase() || "UNKNOWN"}
                </span>
                <span className="badge" style={{ background: "rgba(255,255,255,0.1)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>
                  {streamInfo.sourceId}
                </span>
                {streamInfo.subtitles?.length > 0 && (
                  <span className="badge" style={{ background: "rgba(100,200,100,0.2)", padding: "2px 6px", borderRadius: 4, fontSize: 11 }}>
                    {streamInfo.subtitles.length} subs
                  </span>
                )}
              </div>
              {proxyInfo && (
                <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
                  {proxyInfo.needed ? (
                    <span style={{ color: "#ffaa00" }}>⚠ Proxy needed: {proxyInfo.reason}</span>
                  ) : (
                    <span style={{ color: "#66ff66" }}>✓ Direct playback: {proxyInfo.reason}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Loading */}
          {loading && <div style={{ textAlign: "center", padding: 20, opacity: 0.7 }}>Detecting players...</div>}

          {/* No players */}
          {!loading && players.length === 0 && (
            <div style={{ textAlign: "center", padding: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📺</div>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>No compatible player found</div>
              <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
                {isAndroid
                  ? "Install VLC, MPV, MX Player, or Just Player from Play Store. Uses Android native Intent API (no Termux needed)."
                  : "Install MPV or VLC on your system. On Android, this will show system chooser for installed video players."}
              </div>
            </div>
          )}

          {/* Player list */}
          {!loading && players.length > 0 && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.8 }}>Select Player:</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                {players.map(player => (
                  <button
                    key={player.id}
                    className={`btn ${selectedPlayer?.id === player.id ? "btn-primary" : "btn-secondary"}`}
                    style={{ justifyContent: "flex-start", textAlign: "left", padding: "10px 14px" }}
                    onClick={() => setSelectedPlayer(player)}
                  >
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                      <span style={{ fontWeight: 600 }}>{player.label}</span>
                      <span style={{ fontSize: 11, opacity: 0.6 }}>
                        {player.packageNames?.[0] || player.type} • HLS: {player.supportsHls ? "✓" : "✗"} • Subs: {player.supportsSubtitles ? "✓" : "✗"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  onClick={handleLaunch}
                  disabled={launching || !selectedPlayer}
                >
                  {launching ? "Launching..." : `Play in ${selectedPlayer?.label || "Player"}`}
                </button>
                <button
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                  onClick={handleLaunchWithChooser}
                  disabled={launching}
                >
                  System Chooser
                </button>
              </div>

              <div style={{ fontSize: 11, opacity: 0.5, textAlign: "center", marginTop: 4 }}>
                {isAndroid
                  ? "System chooser shows all installed video players (VLC, MPV, MX Player, etc.) via Android native Intent API"
                  : "Desktop: launches via MPV/VLC binary or system default. Android: uses native Intent via the Expo bridge."}
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div style={{ background: "rgba(255,60,60,0.15)", border: "1px solid rgba(255,60,60,0.3)", padding: 10, borderRadius: 6, fontSize: 13, color: "#ff8888" }}>
              ⚠ {error}
            </div>
          )}

          {/* Headers info */}
          {streamInfo?.headers && Object.keys(streamInfo.headers).length > 0 && (
            <details style={{ fontSize: 11, opacity: 0.6 }}>
              <summary style={{ cursor: "pointer" }}>Headers ({Object.keys(streamInfo.headers).length})</summary>
              <div style={{ marginTop: 6, background: "rgba(0,0,0,0.3)", padding: 8, borderRadius: 4, fontFamily: "monospace", wordBreak: "break-all" }}>
                {Object.entries(streamInfo.headers).map(([k, v]) => (
                  <div key={k}>
                    <span style={{ color: "#88aaff" }}>{k}:</span> {String(v).slice(0, 80)}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
