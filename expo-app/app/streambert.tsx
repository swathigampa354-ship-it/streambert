import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, BackHandler, Linking, AppState } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';

import WEBVIEW_BRIDGE_JS from './webviewBridge';
import { dispatchNativeCall, parseNativeCallMessage, buildResolveScript } from './nativeBridgeDispatcher';

// Native module - file: dependency (expo-external-player), autolinked by expo-modules-core.
// Falls back gracefully when the native module is unavailable (Expo Go / web).
import * as ExternalPlayer from 'expo-external-player';

let SecureStore: any = null;
try {
  SecureStore = require('expo-secure-store');
} catch {
  SecureStore = null;
}

const LOCAL_DIST_URI = 'file:///android_asset/dist/index.html';

export default function StreambertScreen() {
  const [currentStreamUrl, setCurrentStreamUrl] = useState<string | null>(null);
  const [currentHeaders, setCurrentHeaders] = useState<Record<string, string> | null>(null);
  const [currentSubtitle, setCurrentSubtitle] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [navState, setNavState] = useState<{ canGoBack: boolean; url: string }>({ canGoBack: false, url: '' });
  const [tvMode, setTvModeState] = useState(false);
  const tvModeRef = useRef(false);   // ref mirror for use inside AppState subscription
  const webViewRef = useRef<WebView>(null);
  const router = useRouter();

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 30));
    console.log(`[StreambertWebView] ${msg}`);
  }, []);

  // ── TV MODE: orientation lock (expo-screen-orientation) ───────────────────
  const applyOrientation = useCallback(async (enabled: boolean) => {
    try {
      await ScreenOrientation.lockAsync(
        enabled
          ? ScreenOrientation.OrientationLock.LANDSCAPE
          : ScreenOrientation.OrientationLock.PORTRAIT_UP
      );
    } catch (e) {
      addLog(`Orientation lock failed: ${String(e)}`);
      throw e;
    }
  }, [addLog]);

  const setTvMode = useCallback(async (enabled: boolean) => {
    await applyOrientation(enabled);
    tvModeRef.current = enabled;
    setTvModeState(enabled);
    addLog(enabled ? 'TV mode ON (landscape locked)' : 'TV mode OFF (portrait restored)');
    return { tvMode: enabled };
  }, [applyOrientation, addLog]);

  // Lifecycle: re-assert the orientation lock whenever the app returns to the
  // foreground (covers background switch and external-player round-trips).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        applyOrientation(tvModeRef.current).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [applyOrientation]);

  // ── Android hardware back: WebView history first, then RN navigation ───────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navState.canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true; // consumed - stay on screen
      }
      if (__DEV__) {
        router.back();           // dev: return to dev menu
      } else {
        BackHandler.exitApp();   // production: /streambert is the root screen
      }
      return true;
    });
    return () => sub.remove();
  }, [navState.canGoBack, router]);

  const isStreamUrl = useCallback((url: string) => {
    return /\.(m3u8|m3u|mp4|m4v|webm|mkv)(\?|$|\/)/i.test(url) || /\/hls\/|\/dash\/|manifest\.|master\.|playlist\./i.test(url);
  }, []);

  // Push a captured stream URL INTO the page (feeds window.electron.onM3u8Found handlers)
  const pushStreamIntoPage = useCallback((url: string) => {
    if (!webViewRef.current) return;
    const esc = JSON.stringify(url);
    if (/\.(vtt|srt|ass|ssa)(\?|$)/i.test(url)) {
      webViewRef.current.injectJavaScript(`window.__streambertSubtitleCaptured && window.__streambertSubtitleCaptured(${esc}); true;`);
    } else {
      webViewRef.current.injectJavaScript(`window.__streambertStreamCaptured && window.__streambertStreamCaptured(${esc}); true;`);
    }
  }, []);

  // ── WebView message handler ───────────────────────────────────────────────
  const handleMessage = useCallback(async (event: any) => {
    const raw = event?.nativeEvent?.data;
    if (!raw) return;

    // 1) Native bridge calls (request/response)
    const call = parseNativeCallMessage(raw);
    if (call) {
      const result = await dispatchNativeCall(call.method, call.payload, {
        ExternalPlayer,
        Linking,
        SecureStore,
        setTvMode,
        notify: async (title, body) => { addLog(`Notification: ${title} - ${body}`); return true; },
      });
      if (result.ok === false) {
        const err = (result as { ok: false; error: string }).error;
        addLog(`Native ${call.method} failed: ${err}`);
        webViewRef.current?.injectJavaScript(buildResolveScript(call.id, false, { error: err }));
      } else {
        webViewRef.current?.injectJavaScript(buildResolveScript(call.id, true, (result as { ok: true; data: unknown }).data));
      }
      return;
    }

    // 2) Informational messages from the injected script
    let data: any;
    try { data = JSON.parse(raw); } catch { return; }

    switch (data.type) {
      case 'NATIVE_STREAM_FOUND':
        // Emitted by our patched RNCWebViewClient.shouldInterceptRequest for
        // media URLs loaded INSIDE cross-origin iframes (patches/react-native-webview*)
        if (data.url && typeof data.url === 'string') {
          setCurrentStreamUrl((prev) => prev || data.url);
          pushStreamIntoPage(data.url); // feeds window.electron.onM3u8Found in the page
          addLog(`Native capture: ${data.url.slice(0, 80)}`);
        }
        break;
      case 'STREAM_FOUND':
        if (data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
          setCurrentStreamUrl(data.url);
          addLog(`Stream detected (${data.source}): ${data.url.slice(0, 80)}`);
        }
        break;
      case 'SUBTITLE_FOUND':
        if (data.url) {
          setCurrentSubtitle(data.url);
          addLog(`Subtitle: ${data.url.slice(0, 80)}`);
        }
        break;
      case 'STREAMBERT_STREAM':
        if (data.url) {
          setCurrentStreamUrl(data.url);
          setCurrentHeaders(data.headers || null);
          setCurrentSubtitle(data.subtitle || null);
          addLog(`Streambert stream: ${data.url.slice(0, 80)}`);
        }
        break;
      case 'STREAMBERT_ERROR':
        addLog(`Streambert error: ${data.error}`);
        break;
      case 'WEBVIEW_READY':
        setLoading(false);
        addLog('Bridge injected: StreambertNative + electron shim + capture active');
        break;
      default:
        break;
    }
  }, [addLog]);

  // ── Navigation state: iframe/subframe navigations surface stream URLs ─────
  const handleNavState = useCallback((state: any) => {
    setNavState({ canGoBack: !!state.canGoBack, url: state.url || '' });
    if (state.url && isStreamUrl(state.url)) {
      setCurrentStreamUrl((prev) => prev || state.url);
      pushStreamIntoPage(state.url);
      addLog(`Stream via navigation: ${state.url.slice(0, 80)}`);
    }
  }, [isStreamUrl, pushStreamIntoPage, addLog]);

  const handleShouldStart = useCallback((request: any) => {
    const url = request?.url || '';
    if (url === 'about:blank') return false;
    if (isStreamUrl(url)) {
      // Intercept top-level stream navigations; players handle them externally
      setCurrentStreamUrl(url);
      pushStreamIntoPage(url);
      addLog(`Stream URL in request: ${url.slice(0, 80)}`);
      return false; // don't navigate the WebView itself to the media file
    }
    return true;
  }, [isStreamUrl, pushStreamIntoPage, addLog]);

  // ── External player actions ───────────────────────────────────────────────
  const defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Referer': navState.url && navState.url.startsWith('http') ? navState.url : 'https://www.vidking.net/',
  };

  const playExternally = useCallback(async (packageName: string) => {
    if (!currentStreamUrl) {
      Alert.alert('No Stream', 'No stream URL detected yet. Search a title in Streambert, pick a source and let the player start loading.');
      return;
    }
    try {
      addLog(`Launch ${packageName}: ${currentStreamUrl.slice(0, 60)}`);
      const result = await ExternalPlayer.launchPlayerNative({
        url: currentStreamUrl,
        packageName: packageName === 'system-default' ? undefined : packageName,
        mimeType: currentStreamUrl.includes('.m3u8') ? 'application/x-mpegURL' : 'video/*',
        title: 'Streambert Video',
        headers: currentHeaders || defaultHeaders,
        subtitle: currentSubtitle || undefined,
      });
      addLog(`Launch result: ${JSON.stringify(result)}`);
    } catch (e: any) {
      addLog(`Launch failed: ${e.message}`);
      Alert.alert('Launch Failed', e.message);
    }
  }, [currentStreamUrl, currentHeaders, currentSubtitle, addLog, defaultHeaders]);

  const playViaProxy = useCallback(async () => {
    if (!currentStreamUrl) {
      Alert.alert('No Stream', 'No URL detected');
      return;
    }
    try {
      const headers = currentHeaders || defaultHeaders;
      addLog(`Proxy start: ${currentStreamUrl.slice(0, 60)}`);
      const proxyResult = await ExternalPlayer.startProxyNative({ targetUrl: currentStreamUrl, headers });
      const proxyUrl = (proxyResult as any).localUrl || (proxyResult as any).proxyUrl;
      addLog(`Proxy: ${proxyUrl}`);
      const result = await ExternalPlayer.launchPlayerNative({
        url: proxyUrl,
        packageName: 'org.videolan.vlc',
        mimeType: 'application/x-mpegURL',
        title: 'Streambert via Proxy',
        subtitle: currentSubtitle || undefined,
      });
      addLog(`Proxy launch: ${JSON.stringify(result)}`);
    } catch (e: any) {
      addLog(`Proxy failed: ${e.message}`);
      Alert.alert('Proxy Failed', e.message);
    }
  }, [currentStreamUrl, currentHeaders, currentSubtitle, addLog, defaultHeaders]);

  if (loadError) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorTitle}>Local frontend failed to load</Text>
        <Text style={styles.errorText}>{loadError}</Text>
        <Text style={styles.errorTextSmall}>
          The production APK packages the Vite-built frontend at{'\n'}android/app/src/main/assets/dist/{'\n'}
          via plugins/with-dist-assets.js. Rebuild the frontend and re-run prebuild.
        </Text>
        <TouchableOpacity style={styles.button} onPress={() => setLoadError(null)}>
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => router.back()}>
          <Text style={styles.buttonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Production: no permanent header — the Streambert UI itself is the app.
          Debug header renders only in dev builds (__DEV__). */}
      {__DEV__ && (
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Streambert (DEV{tvMode ? ' · TV MODE' : ''})</Text>
          <View style={styles.backButton} />
        </View>
      )}

      <View style={styles.webViewContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: LOCAL_DIST_URI }}
          injectedJavaScriptBeforeContentLoaded={WEBVIEW_BRIDGE_JS}
          onMessage={handleMessage}
          onNavigationStateChange={handleNavState}
          onShouldStartLoadWithRequest={handleShouldStart}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={(e) => {
            const desc = e?.nativeEvent?.description || 'unknown error';
            addLog(`WebView error: ${desc}`);
            setLoadError(`WebView load error: ${desc} (uri=${LOCAL_DIST_URI})`);
          }}
          onHttpError={(e) => {
            addLog(`HTTP error ${e?.nativeEvent?.statusCode}: ${e?.nativeEvent?.url?.slice(0, 60)}`);
          }}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs
          mixedContentMode="always"
          setSupportMultipleWindows={false}
          originWhitelist={['*']}
          userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
          style={styles.webView}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#E50914" />
            <Text style={styles.loadingText}>Loading packaged Streambert frontend…</Text>
          </View>
        )}
      </View>

      {/* Debug controls + logs: dev (Metro) builds only. In production builds
          the WebView IS the entire screen; external-player integration is
          exercised from within the Streambert UI via the native bridge. */}
      {__DEV__ && (
        <View style={styles.controls}>
          <Text style={styles.controlsTitle} numberOfLines={2}>
            Stream: {currentStreamUrl ? currentStreamUrl.slice(0, 70) + '…' : 'None detected — start playback in the app'}
          </Text>
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
              <Text style={styles.buttonText}>Proxy→VLC</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.button} onPress={() => setTvMode(!tvMode)}>
              <Text style={styles.buttonText}>{tvMode ? 'TV MODE ✕' : 'TV MODE'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.logs}>
            {logs.map((log, i) => (
              <Text key={i} style={styles.logText}>{log}</Text>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#111', borderBottomWidth: 1, borderBottomColor: '#222' },
  backButton: { padding: 8, minWidth: 60 },
  backText: { color: '#fff', fontSize: 16 },
  headerTitle: { flex: 1, textAlign: 'center', color: '#fff', fontWeight: 'bold', fontSize: 16 },
  webViewContainer: { flex: 1, position: 'relative' },
  webView: { flex: 1, backgroundColor: '#000' },
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 12, fontWeight: 'bold' },
  controls: { backgroundColor: '#111', padding: 12, borderTopWidth: 1, borderTopColor: '#222' },
  controlsTitle: { color: '#ccc', fontSize: 11, marginBottom: 8 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  button: { backgroundColor: '#E50914', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, flex: 1, alignItems: 'center', marginTop: 8 },
  buttonProxy: { backgroundColor: '#333', borderWidth: 1, borderColor: '#555' },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  logs: { backgroundColor: '#000', padding: 8, maxHeight: 120, borderTopWidth: 1, borderTopColor: '#222' },
  logText: { color: '#0f0', fontSize: 10, fontFamily: 'monospace', marginBottom: 2 },
  errorTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
  errorText: { color: '#f88', fontSize: 13, textAlign: 'center', marginBottom: 12 },
  errorTextSmall: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 16, lineHeight: 18 },
});
