import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';

let ExternalPlayer: any = null;
try {
  ExternalPlayer = require('../modules/expo-external-player/src/index.ts');
} catch {
  try {
    ExternalPlayer = require('../modules/expo-external-player/src/index');
  } catch {
    ExternalPlayer = {
      launchPlayerNative: async (opts: any) => {
        Alert.alert('Fallback', `Would launch ${opts.packageName} with ${opts.url}`);
        return { success: true };
      },
      startProxyNative: async (opts: any) => ({ localUrl: opts.targetUrl, port: 8080 }),
      isNativeBridgeAvailable: () => false,
    };
  }
}

// Injected JS to detect m3u8 and video sources (replaces Electron webRequest intercept)
const INJECTED_JS = `
(function() {
  // Store original fetch and XHR
  const originalFetch = window.fetch;
  const originalOpen = XMLHttpRequest.prototype.open;

  function notifyStream(url) {
    if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('.m3u')) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'STREAM_FOUND', url: url }));
    }
  }

  function notifySubtitle(url, lang) {
    if (url.includes('.vtt') || url.includes('.srt')) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SUBTITLE_FOUND', url: url, lang: lang || 'en' }));
    }
  }

  // Intercept fetch
  window.fetch = function(...args) {
    const url = args[0];
    if (typeof url === 'string') {
      notifyStream(url);
      notifySubtitle(url);
    }
    return originalFetch.apply(this, args);
  };

  // Intercept XHR
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (typeof url === 'string') {
      notifyStream(url);
      notifySubtitle(url);
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  // Observe video elements
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.tagName === 'VIDEO' && node.src) {
          notifyStream(node.src);
        }
        if (node.tagName === 'SOURCE' && node.src) {
          notifyStream(node.src);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Also check existing videos
  document.querySelectorAll('video').forEach(v => {
    if (v.src) notifyStream(v.src);
    if (v.currentSrc) notifyStream(v.currentSrc);
  });

  // Listen for HLS.js events
  window.addEventListener('hlsManifestParsed', (e) => {
    if (e.detail && e.detail.url) notifyStream(e.detail.url);
  });

  // Notify ready
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'WEBVIEW_READY' }));

  true;
})();
`;

export default function StreambertScreen() {
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const webViewRef = useRef(null);
  const router = useRouter();

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 20));
    console.log(`[StreambertWebView] ${msg}`);
  };

  const handleMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      addLog(`Message: ${data.type} ${data.url || ''}`);

      if (data.type === 'STREAM_FOUND' && data.url) {
        // Validate URL
        if (data.url.includes('about:blank') || data.url.length < 10) return;
        if (!data.url.startsWith('http')) return;

        setCurrentStreamUrl(data.url);
        addLog(`Stream found: ${data.url}`);

        // Auto-show option to play externally
        // In real app, this would be triggered by user clicking external player button
      }

      if (data.type === 'SUBTITLE_FOUND') {
        addLog(`Subtitle found: ${data.url} lang=${data.lang}`);
      }

      if (data.type === 'WEBVIEW_READY') {
        addLog('WebView ready, injection active');
        setLoading(false);
      }
    } catch (e) {
      addLog(`Message parse error: ${e}`);
    }
  };

  const playExternally = async (packageName = 'system-default') => {
    if (!currentStreamUrl) {
      Alert.alert('No Stream', 'No m3u8/mp4 URL detected yet. Play a video in the WebView first.');
      return;
    }

    try {
      addLog(`Launching ${packageName} with ${currentStreamUrl}`);
      const result = await ExternalPlayer.launchPlayerNative({
        url: currentStreamUrl,
        packageName,
        mimeType: currentStreamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/*',
        title: 'Streambert Video',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://www.vidking.net/',
        },
      });
      addLog(`Launch result: ${JSON.stringify(result)}`);
      Alert.alert('Launched', `Player ${packageName} launched`);
    } catch (e: any) {
      addLog(`Launch failed: ${e.message}`);
      Alert.alert('Launch Failed', e.message);
    }
  };

  const playViaProxy = async () => {
    if (!currentStreamUrl) {
      Alert.alert('No Stream', 'No URL detected');
      return;
    }

    try {
      addLog(`Starting proxy for ${currentStreamUrl}`);
      const proxyResult = await ExternalPlayer.startProxyNative({
        targetUrl: currentStreamUrl,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://www.vidking.net/',
        },
      });
      addLog(`Proxy started: ${proxyResult.localUrl}`);

      const result = await ExternalPlayer.launchPlayerNative({
        url: proxyResult.localUrl,
        packageName: 'org.videolan.vlc',
        mimeType: 'application/x-mpegURL',
        title: 'Streambert via Proxy',
      });
      addLog(`Proxy launch: ${JSON.stringify(result)}`);
    } catch (e: any) {
      addLog(`Proxy failed: ${e.message}`);
      Alert.alert('Proxy Failed', e.message);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Streambert</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: 'https://streambert.vercel.app' }} // Or local dist/index.html
          // For local testing, use: { uri: 'file:///android_asset/public/index.html' } or serve dist via expo-asset
          // For now, using placeholder that will be replaced with actual Streambert dist
          injectedJavaScriptBeforeContentLoaded={INJECTED_JS}
          onMessage={handleMessage}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback={true}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          style={styles.webView}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#E50914" />
            <Text style={styles.loadingText}>Loading Streambert...</Text>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <Text style={styles.controlsTitle}>Stream: {currentStreamUrl ? currentStreamUrl.slice(0, 60) + '...' : 'None detected yet'}</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.button} onPress={() => playExternally('org.videolan.vlc')}>
            <Text style={styles.buttonText}>VLC</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => playExternally('is.xyz.mpv')}>
            <Text style={styles.buttonText}>MPV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => playExternally('system-default')}>
            <Text style={styles.buttonText}>Chooser</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.buttonProxy]} onPress={playViaProxy}>
            <Text style={styles.buttonText}>Via Proxy</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>WebView intercepts m3u8 via injected JS (replaces Electron webRequest). When stream found, buttons enable external playback.</Text>
      </View>

      <View style={styles.logs}>
        <Text style={styles.logsTitle}>Logs</Text>
        {logs.map((log, i) => (
          <Text key={i} style={styles.logText}>{log}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222' },
  backButton: { padding: 8 },
  backText: { color: '#fff', fontSize: 16 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontWeight: 'bold', fontSize: 16 },
  headerSpacer: { width: 60 },
  webViewContainer: { flex: 1, position: 'relative' },
  webView: { flex: 1, backgroundColor: '#000' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 12 },
  controls: { backgroundColor: '#111', padding: 12, borderTopWidth: 1, borderTopColor: '#222' },
  controlsTitle: { color: '#ccc', fontSize: 12, marginBottom: 8 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  button: { backgroundColor: '#E50914', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, flex: 1, alignItems: 'center' },
  buttonProxy: { backgroundColor: '#333', borderWidth: 1, borderColor: '#555' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  hint: { color: '#666', fontSize: 10, marginTop: 8, lineHeight: 14 },
  logs: { backgroundColor: '#000', padding: 8, maxHeight: 120, borderTopWidth: 1, borderTopColor: '#222' },
  logsTitle: { color: '#fff', fontSize: 12, fontWeight: 'bold', marginBottom: 4 },
  logText: { color: '#0f0', fontSize: 10, fontFamily: 'monospace', marginBottom: 2 },
});
