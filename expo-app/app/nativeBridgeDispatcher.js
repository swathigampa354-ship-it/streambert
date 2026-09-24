// ── Native Bridge Dispatcher (RN side) ──────────────────────────────────────
// Receives NATIVE_CALL messages from the WebView bridge (webviewBridge.js) and
// routes them to native capabilities. Dependencies are INJECTED so the exact
// same dispatcher logic is unit-testable in Node with fakes.
//
// Message : { type:'NATIVE_CALL', id, method, payload }
// Response: { ok:true, data } | { ok:false, error }
//
// Contract per method (must match window.StreambertNative in webviewBridge.js):
//   getInstalledPlayers () -> { players: string[] }
//   launchPlayer        ({url, packageName?, mimeType?, title?, headers?, subtitle?}) -> { ok:true, opener, packageName }
//   startProxy          ({targetUrl, headers?, subtitleUrl?}) -> { proxyUrl|localUrl, port }
//   stopProxy           () -> { stopped:true }
//   downloadSubtitle    ({url, fileName, headers?}) -> { localPath } | { filePath }
//   getSubtitleDir      () -> { path }
//   openExternal        ({url}) -> { opened:true }
//   secureGet           ({key}) -> { value|null }
//   secureSet           ({key, value}) -> { ok:true }
//   fileExists          ({path}) -> { exists:boolean }
//   showNotification    ({title, body}) -> { ok:true }

export const BRIDGE_METHODS = [
  'getInstalledPlayers',
  'launchPlayer',
  'startProxy',
  'stopProxy',
  'downloadSubtitle',
  'getSubtitleDir',
  'openExternal',
  'secureGet',
  'secureSet',
  'fileExists',
  'showNotification',
  'setTvMode',
];

/**
 * @param {string} method
 * @param {object} payload
 * @param {object} deps
 * @param {object} deps.ExternalPlayer  expo-external-player module (or fake in tests)
 * @param {object} deps.Linking         react-native Linking (or fake)
 * @param {object} [deps.SecureStore]   expo-secure-store (or fake; optional)
 * @param {(title:string, body:string)=>Promise<boolean>} [deps.notify]
 * @param {(enabled:boolean)=>Promise<object>} [deps.setTvMode]  TV mode orientation lock (Android)
 * @returns {Promise<{ok:true, data:any}|{ok:false, error:string}>}
 */
export async function dispatchNativeCall(method, payload = {}, deps) {
  const { ExternalPlayer, Linking, SecureStore, notify } = deps;

  try {
    switch (method) {
      case 'getInstalledPlayers': {
        const players = await ExternalPlayer.getInstalledPlayersNative();
        return { ok: true, data: { players: Array.isArray(players) ? players : [] } };
      }

      case 'launchPlayer': {
        if (!payload.url || typeof payload.url !== 'string') {
          return { ok: false, error: 'launchPlayer: url required' };
        }
        if (payload.url === 'about:blank') {
          return { ok: false, error: 'launchPlayer: invalid url about:blank' };
        }
        const result = await ExternalPlayer.launchPlayerNative({
          url: payload.url,
          packageName: payload.packageName || undefined,
          mimeType: payload.mimeType || 'video/*',
          title: payload.title || undefined,
          headers: payload.headers || undefined,
          subtitle: payload.subtitle || undefined,
        });
        if (result && result.success) {
          return { ok: true, data: { ok: true, opener: result.opener || 'native', packageName: result.packageName || null } };
        }
        return { ok: false, error: (result && result.error) || 'launch failed' };
      }

      case 'startProxy': {
        if (!payload.targetUrl || typeof payload.targetUrl !== 'string') {
          return { ok: false, error: 'startProxy: targetUrl required' };
        }
        const result = await ExternalPlayer.startProxyNative({
          targetUrl: payload.targetUrl,
          headers: payload.headers || {},
          subtitleUrl: payload.subtitleUrl || undefined,
        });
        // normalize: module returns { localUrl, port }
        const proxyUrl = result.proxyUrl || result.localUrl;
        if (!proxyUrl) return { ok: false, error: 'startProxy: no local URL returned' };
        return { ok: true, data: { proxyUrl, port: result.port || 0 } };
      }

      case 'stopProxy': {
        await ExternalPlayer.stopProxyNative();
        return { ok: true, data: { stopped: true } };
      }

      case 'downloadSubtitle': {
        if (!payload.url) return { ok: false, error: 'downloadSubtitle: url required' };
        const filePath = await ExternalPlayer.downloadSubtitleNative({
          url: payload.url,
          fileName: payload.fileName || payload.filename || 'subtitle.srt',
          headers: payload.headers || {},
        });
        const path = typeof filePath === 'string' ? filePath : filePath && (filePath.filePath || filePath.localPath);
        if (!path) return { ok: false, error: 'downloadSubtitle: no path returned' };
        return { ok: true, data: { localPath: path } };
      }

      case 'getSubtitleDir': {
        const dir = await ExternalPlayer.getSubtitleDirNative();
        const path = typeof dir === 'string' ? dir : dir && dir.path;
        return { ok: true, data: { path: path || '' } };
      }

      case 'openExternal': {
        if (!payload.url) return { ok: false, error: 'openExternal: url required' };
        await Linking.openURL(payload.url);
        return { ok: true, data: { opened: true } };
      }

      case 'secureGet': {
        if (!payload.key) return { ok: false, error: 'secureGet: key required' };
        if (!SecureStore) return { ok: true, data: { value: null } };
        const value = await SecureStore.getItemAsync(payload.key);
        return { ok: true, data: { value: value ?? null } };
      }

      case 'secureSet': {
        if (!payload.key) return { ok: false, error: 'secureSet: key required' };
        if (!SecureStore) return { ok: false, error: 'secureSet: SecureStore unavailable' };
        await SecureStore.setItemAsync(payload.key, String(payload.value ?? ''));
        return { ok: true, data: { ok: true } };
      }

      case 'fileExists': {
        if (!payload.path) return { ok: true, data: { exists: false } };
        if (typeof ExternalPlayer.fileExistsNative === 'function') {
          const exists = await ExternalPlayer.fileExistsNative(payload.path);
          return { ok: true, data: { exists: !!exists } };
        }
        return { ok: true, data: { exists: false } };
      }

      case 'showNotification': {
        if (notify) {
          await notify(String(payload.title || ''), String(payload.body || ''));
        }
        return { ok: true, data: { ok: true } };
      }

      case 'setTvMode': {
        // enable/disable TV mode on the native side (orientation lock etc).
        // deps.setTvMode is REQUIRED on Android; optional elsewhere.
        if (typeof payload.enabled !== 'boolean') {
          return { ok: false, error: 'setTvMode: enabled (boolean) required' };
        }
        if (typeof deps.setTvMode !== 'function') {
          return { ok: false, error: 'setTvMode: not supported on this platform' };
        }
        const state = await deps.setTvMode(payload.enabled);
        return { ok: true, data: { tvMode: !!(state && state.tvMode !== undefined ? state.tvMode : payload.enabled) } };
      }

      default:
        return { ok: false, error: `Unknown bridge method: ${method}` };
    }
  } catch (e) {
    return { ok: false, error: `${method} failed: ${e && e.message ? e.message : String(e)}` };
  }
}

/**
 * Parse a raw WebView message; returns {id, method, payload} or null when the
 * message is not a NATIVE_CALL.
 */
export function parseNativeCallMessage(rawData) {
  let data;
  try {
    data = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
  } catch {
    return null;
  }
  if (!data || data.type !== 'NATIVE_CALL') return null;
  if (typeof data.id !== 'number' || typeof data.method !== 'string') return null;
  return { id: data.id, method: data.method, payload: data.payload || {} };
}

/**
 * Build the injectJavaScript snippet that resolves a pending WebView promise.
 * JSON-encodes the payload string safely.
 */
export function buildResolveScript(id, ok, data) {
  // id may be a non-numeric string (frontend bridge ids use Date.now_counter),
  // payload may contain U+2028/U+2029 (valid in JSON, but line terminators in
  // JS string literals) — both must be encoded to survive injectJavaScript.
  const idJson = JSON.stringify(String(id));
  const payloadJson = JSON.stringify(JSON.stringify(data ?? null))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `window.__streambertNativeResolve(${idJson}, ${ok ? 'true' : 'false'}, ${payloadJson}); true;`;
}

export default dispatchNativeCall;
