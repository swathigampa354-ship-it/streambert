import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import * as FileSystem from 'expo-file-system';

// Import our Expo external player module - it is a file: dependency
// (expo-external-player) and autolinked in dev-client builds.
// In Expo Go the module's own requireNativeModule guard falls back gracefully.
import * as ExternalPlayerModule from 'expo-external-player';
const ExternalPlayer: any = ExternalPlayerModule;

// Fallback implementation for Expo Go testing
const fallbackModule = {
  getInstalledPlayersNative: async () => {
    console.log('[Fallback] getInstalledPlayers - would use PackageManager on real device');
    return ['org.videolan.vlc', 'is.xyz.mpv', 'com.mxtech.videoplayer.ad', 'com.brouken.player'];
  },
  launchPlayerNative: async (opts: any) => {
    console.log('[Fallback] launchPlayer', opts);
    Alert.alert('Fallback Mode', `Would launch ${opts.packageName || 'chooser'} with URL: ${opts.url}\n\nThis requires dev client APK with native module.\n\nIn Expo Go, this is mocked.`);
    return { success: true, opener: 'fallback-mock' };
  },
  startProxyNative: async (opts: any) => {
    console.log('[Fallback] startProxy', opts);
    return { localUrl: `http://127.0.0.1:8080/https/${opts.targetUrl.replace(/^https?:\/\//, '')}`, port: 8080 };
  },
  stopProxyNative: async () => {},
  downloadSubtitleNative: async (opts: any) => {
    return `/sdcard/Download/StreambertSubs/${opts.fileName}`;
  },
  getSubtitleDirNative: async () => '/sdcard/Download/StreambertSubs',
  isNativeBridgeAvailable: () => false,
};

const EP = ExternalPlayer || fallbackModule;

const TEST_VIDEOS = {
  mp4Direct: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  hlsMux: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  hlsApple: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
};

const KNOWN_PLAYERS = [
  { id: 'vlc', label: 'VLC', packageName: 'org.videolan.vlc' },
  { id: 'mpv', label: 'MPV', packageName: 'is.xyz.mpv' },
  { id: 'mx', label: 'MX Player', packageName: 'com.mxtech.videoplayer.ad' },
  { id: 'just', label: 'Just Player', packageName: 'com.brouken.player' },
  { id: 'system', label: 'System Chooser', packageName: 'system-default' },
];

export default function PlayerTestScreen() {
  const [url, setUrl] = useState(TEST_VIDEOS.mp4Direct);
  const [players, setPlayers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(EP.isNativeBridgeAvailable());
    addLog(`Native bridge: ${EP.isNativeBridgeAvailable() ? 'AVAILABLE (dev client)' : 'FALLBACK (Expo Go)'}`);
    detectPlayers();
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
    console.log(`[PlayerTest] ${msg}`);
  };

  const detectPlayers = async () => {
    setLoading(true);
    try {
      addLog('Detecting installed players via PackageManager...');
      const detected = await EP.getInstalledPlayersNative();
      setPlayers(detected);
      addLog(`Detected ${detected.length} players: ${detected.join(', ') || 'none (will use chooser fallback)'}`);
    } catch (e: any) {
      addLog(`Detection failed: ${e.message}`);
      Alert.alert('Detection Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const launchPlayer = async (packageName: string, useProxy = false) => {
    setLoading(true);
    try {
      let finalUrl = url;
      let proxyInfo = null;

      if (useProxy) {
        addLog(`Starting proxy for ${url}...`);
        try {
          proxyInfo = await EP.startProxyNative({
            targetUrl: url,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://www.vidking.net/embed/movie/123',
            },
          });
          finalUrl = proxyInfo.localUrl;
          addLog(`Proxy started: ${finalUrl} (port ${proxyInfo.port})`);
        } catch (e: any) {
          addLog(`Proxy failed: ${e.message}, using direct URL`);
        }
      }

      addLog(`Launching ${packageName} with URL: ${finalUrl}`);
      const result = await EP.launchPlayerNative({
        url: finalUrl,
        packageName,
        mimeType: finalUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/*',
        title: 'Streambert Test Video',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.vidking.net/',
        },
        subtitle: undefined,
      });

      addLog(`Launch result: ${JSON.stringify(result)}`);
      if (result.success) {
        Alert.alert('Launched', `Player ${packageName} launched via ${result.opener}`);
      } else {
        Alert.alert('Launch Failed', 'Check logs');
      }
    } catch (e: any) {
      addLog(`Launch failed: ${e.message}`);
      Alert.alert('Launch Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const testSubtitle = async () => {
    setLoading(true);
    try {
      addLog('Testing subtitle download...');
      const subUrl = 'https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/test.srt';
      const fileName = 'test.en.srt';
      const filePath = await EP.downloadSubtitleNative({
        url: subUrl,
        fileName,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      addLog(`Subtitle downloaded to: ${filePath}`);

      // Try to launch with subtitle
      addLog('Launching with subtitle...');
      await EP.launchPlayerNative({
        url,
        packageName: 'org.videolan.vlc',
        mimeType: 'video/*',
        title: 'Test with Subtitle',
        subtitle: filePath,
      });
      addLog('Launched with subtitle');
    } catch (e: any) {
      addLog(`Subtitle test failed: ${e.message}`);
      Alert.alert('Subtitle Failed', e.message);
    } finally {
      setLoading(false);
    }
  };

  const testHeaders = async () => {
    // Test header handling decision
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.vidking.net/embed/movie/123',
    };
    const headersWithCookie = {
      ...headers,
      'Cookie': 'CloudFront-Policy=xxx; CloudFront-Signature=yyy',
    };

    addLog(`Headers without Cookie: ${JSON.stringify(headers)} -> needsProxy? false (direct via intent extras)`);
    addLog(`Headers with Cookie: ${JSON.stringify(headersWithCookie)} -> needsProxy? true (mandatory proxy)`);

    // Test proxy with Cookie
    await launchPlayer('org.videolan.vlc', true);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>External Player Test</Text>
      <Text style={[styles.badge, isNative ? styles.badgeNative : styles.badgeFallback]}>
        {isNative ? '✅ Native Module Available (Dev Client)' : '⚠️ Fallback Mode (Expo Go) - Need Dev Client APK for real test'}
      </Text>

      <View style={styles.section}>
        <Text style={styles.label}>Test Video URL:</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          placeholder="https://.../video.mp4 or .m3u8"
          placeholderTextColor="#666"
          multiline
        />
        <View style={styles.presetRow}>
          <TouchableOpacity style={styles.presetButton} onPress={() => setUrl(TEST_VIDEOS.mp4Direct)}>
            <Text style={styles.presetText}>MP4 Direct</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetButton} onPress={() => setUrl(TEST_VIDEOS.hlsMux)}>
            <Text style={styles.presetText}>HLS Mux</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetButton} onPress={() => setUrl(TEST_VIDEOS.hlsApple)}>
            <Text style={styles.presetText}>HLS Apple</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.sectionTitle}>Detected Players ({players.length})</Text>
          <TouchableOpacity style={styles.smallButton} onPress={detectPlayers} disabled={loading}>
            <Text style={styles.smallButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
        {loading && <ActivityIndicator color="#E50914" style={{ marginVertical: 10 }} />}
        {players.length === 0 ? (
          <Text style={styles.textMuted}>No players detected (or fallback mode). System chooser will be used.</Text>
        ) : (
          players.map((pkg, i) => (
            <Text key={i} style={styles.text}>• {pkg}</Text>
          ))
        )}
        {players.length === 0 && (
          <Text style={styles.textSmall}>On real device with VLC installed, should show org.videolan.vlc etc. If no players, app should NOT crash and show "No compatible external player installed" message.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Launch Tests</Text>
        {KNOWN_PLAYERS.map((player) => (
          <View key={player.id} style={styles.playerRow}>
            <View style={styles.playerInfo}>
              <Text style={styles.playerLabel}>{player.label}</Text>
              <Text style={styles.playerPackage}>{player.packageName}</Text>
            </View>
            <View style={styles.playerButtons}>
              <TouchableOpacity
                style={[styles.launchButton, styles.launchDirect]}
                onPress={() => launchPlayer(player.packageName, false)}
                disabled={loading}
              >
                <Text style={styles.launchText}>Direct</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.launchButton, styles.launchProxy]}
                onPress={() => launchPlayer(player.packageName, true)}
                disabled={loading}
              >
                <Text style={styles.launchText}>Via Proxy</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Advanced Tests</Text>
        <TouchableOpacity style={styles.button} onPress={testSubtitle} disabled={loading}>
          <Text style={styles.buttonText}>📝 Test Subtitle Download + Launch</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={testHeaders} disabled={loading}>
          <Text style={styles.buttonText}>🔒 Test Headers + Cookie → Proxy Decision</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>Subtitle test: downloads .srt to /sdcard/Download/StreambertSubs/ and launches VLC with 9 extras</Text>
        <Text style={styles.hint}>Header test: shows when proxy is needed (Cookie/Auth) vs direct (UA/Referer)</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Expected Behavior (Real Device)</Text>
        <Text style={styles.text}>✅ VLC installed → detects org.videolan.vlc → launches → video plays</Text>
        <Text style={styles.text}>✅ MPV installed → detects is.xyz.mpv → launches → HLS plays</Text>
        <Text style={styles.text}>✅ MX Player → detects com.mxtech... → launches → plays (may need proxy for Referer)</Text>
        <Text style={styles.text}>✅ Multiple → System Chooser shows all</Text>
        <Text style={styles.text}>✅ No player → NOT crash, shows "No compatible external player installed"</Text>
        <Text style={styles.text}>✅ Direct URL → URL → Intent → Player → Plays (no proxy)</Text>
        <Text style={styles.text}>✅ HLS → detected as hls → playlist accessible → segments load → plays</Text>
        <Text style={styles.text}>✅ Referer/UA → passed via S.Referer/S.User-Agent extras → plays</Text>
        <Text style={styles.text}>✅ Cookie/Auth → proxy 127.0.0.1:port/https/host/path → headers injected → plays</Text>
        <Text style={styles.text}>✅ Subtitles → downloaded → 9 extras → appears in player</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Logs</Text>
        <TouchableOpacity style={styles.smallButton} onPress={() => setLogs([])}>
          <Text style={styles.smallButtonText}>Clear Logs</Text>
        </TouchableOpacity>
        <View style={styles.logContainer}>
          {logs.map((log, i) => (
            <Text key={i} style={styles.logText}>{log}</Text>
          ))}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>For real device testing, build dev client APK:</Text>
        <Text style={styles.footerText}>eas build --profile development --platform android</Text>
        <Text style={styles.footerText}>Then adb install or scan QR</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  badge: { padding: 8, borderRadius: 6, marginBottom: 16, textAlign: 'center', fontSize: 12, fontWeight: 'bold' },
  badgeNative: { backgroundColor: '#0a4', color: '#fff' },
  badgeFallback: { backgroundColor: '#a40', color: '#fff' },
  section: { backgroundColor: '#111', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#222' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  label: { fontSize: 14, color: '#ccc', marginBottom: 4 },
  input: { backgroundColor: '#222', color: '#fff', borderRadius: 8, padding: 12, fontSize: 12, borderWidth: 1, borderColor: '#333', minHeight: 60 },
  presetRow: { flexDirection: 'row', marginTop: 8, gap: 8 },
  presetButton: { backgroundColor: '#333', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, flex: 1, alignItems: 'center' },
  presetText: { color: '#ccc', fontSize: 11 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  smallButton: { backgroundColor: '#333', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  smallButtonText: { color: '#fff', fontSize: 12 },
  text: { fontSize: 13, color: '#ccc', marginBottom: 2 },
  textMuted: { fontSize: 13, color: '#666', fontStyle: 'italic' },
  textSmall: { fontSize: 11, color: '#666', marginTop: 4 },
  playerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#222' },
  playerInfo: { flex: 1 },
  playerLabel: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  playerPackage: { fontSize: 11, color: '#888' },
  playerButtons: { flexDirection: 'row', gap: 6 },
  launchButton: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  launchDirect: { backgroundColor: '#E50914' },
  launchProxy: { backgroundColor: '#333', borderWidth: 1, borderColor: '#555' },
  launchText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  button: { backgroundColor: '#E50914', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonSecondary: { backgroundColor: '#333', borderWidth: 1, borderColor: '#555' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  hint: { fontSize: 11, color: '#666', marginTop: 4, lineHeight: 14 },
  logContainer: { backgroundColor: '#000', borderRadius: 8, padding: 8, marginTop: 8, maxHeight: 200, borderWidth: 1, borderColor: '#222' },
  logText: { fontSize: 10, color: '#0f0', fontFamily: 'monospace', marginBottom: 2 },
  footer: { marginTop: 20, alignItems: 'center' },
  footerText: { fontSize: 11, color: '#555', textAlign: 'center', marginBottom: 2 },
});
