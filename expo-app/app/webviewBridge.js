// ── WebView Bridge (injected into the packaged Streambert frontend) ─────────
// Single source of truth for the JS that runs inside the Android WebView.
// It is a plain string so streambert.tsx can inject it AND the Node test-suite
// can evaluate the exact same code against a mock ReactNativeWebView.
//
// Provides inside the WebView:
//   window.StreambertNative   – async request/response bridge to native code
//                               (getInstalledPlayers / launchPlayer / startProxy /
//                                stopProxy / downloadSubtitle / getSubtitleDir /
//                                openExternal / secureGet / secureSet / probeStream /
//                                fileExists / showNotification)
//   window.electron           – minimal Electron-renderer shim so the 201
//                               window.electron?.call sites in the frontend work
//                               (unguarded or optional-chained). Unimplemented
//                               methods stay undefined; every callsite is guarded
//                               with ?.method checks (verified by audit).
//   stream capture            – fetch / XHR / <video>/<source> / media src setter
//                               interception (top document) reporting STREAM_FOUND.
//   window.electron.onM3u8Found / onSubtitleFound – event subscription used by
//                               MoviePage/TVPage. Events are pushed from native:
//                               top-document capture (this script) + native
//                               WebView request interception + iframe navigations.
//
// Response path: native calls injectJavaScript(
//   window.__streambertNativeResolve(<id>, <ok>, <jsonString>))

export const WEBVIEW_BRIDGE_JS = String.raw`
(function () {
  if (window.__streambertBridgeInstalled) return;
  window.__streambertBridgeInstalled = true;

  var CALL_TIMEOUT_MS = 20000;
  var _nextId = 1;
  var _pending = {};

  function hasRN() {
    return !!(window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function');
  }

  function post(obj) {
    try {
      if (hasRN()) window.ReactNativeWebView.postMessage(JSON.stringify(obj));
    } catch (e) { /* never break the page */ }
  }

  // Response entry point - invoked by native via injectJavaScript.
  window.__streambertNativeResolve = function (id, ok, payloadJson) {
    var entry = _pending[id];
    if (!entry) return;
    delete _pending[id];
    var parsed = null;
    if (typeof payloadJson === 'string') {
      try { parsed = JSON.parse(payloadJson); } catch (e) { parsed = payloadJson; }
    } else {
      parsed = payloadJson;
    }
    if (ok) entry.resolve(parsed);
    else entry.reject(new Error(parsed && parsed.error ? parsed.error : String(parsed)));
  };

  function nativeCall(method, payload) {
    return new Promise(function (resolve, reject) {
      if (!hasRN()) {
        reject(new Error('ReactNativeWebView bridge not available'));
        return;
      }
      var id = _nextId++;
      var timer = setTimeout(function () {
        if (_pending[id]) {
          delete _pending[id];
          reject(new Error('Native call timeout: ' + method));
        }
      }, CALL_TIMEOUT_MS);
      _pending[id] = {
        resolve: function (v) { clearTimeout(timer); resolve(v); },
        reject: function (e) { clearTimeout(timer); reject(e); }
      };
      post({ type: 'NATIVE_CALL', id: id, method: method, payload: payload || {} });
    });
  }

  // ── window.StreambertNative (contract consumed by utils/externalPlayer/androidBridge.js)
  // Methods accept EITHER an object or a JSON string payload (androidBridge sends JSON strings)
  // and ALWAYS resolve to plain objects with the documented keys.
  function parsePayload(p) {
    if (typeof p === 'string') { try { return JSON.parse(p); } catch (e) { return {}; } }
    return p || {};
  }

  window.StreambertNative = {
    platform: 'android',

    getInstalledPlayers: function () {
      return nativeCall('getInstalledPlayers', {}).then(function (res) {
        // normalize: {players:[...]} or [...]
        if (Array.isArray(res)) return res;
        if (res && Array.isArray(res.players)) return res.players;
        return [];
      });
    },

    launchPlayer: function (payload) {
      var opts = parsePayload(payload);
      return nativeCall('launchPlayer', opts).then(function (res) {
        if (res && (res.ok === true || res.success === true)) return { ok: true, method: res.opener || res.method || 'native', package: res.packageName || opts.packageName || null };
        return { ok: false, error: (res && res.error) || 'launch failed' };
      }).catch(function (e) { return { ok: false, error: e.message || String(e) }; });
    },

    startProxy: function (payload) {
      var opts = parsePayload(payload);
      return nativeCall('startProxy', opts).then(function (res) {
        // normalize localUrl -> proxyUrl for the frontend contract
        var proxyUrl = res && (res.proxyUrl || res.localUrl);
        if (proxyUrl) return { proxyUrl: proxyUrl, port: res.port || 0 };
        throw new Error((res && res.error) || 'proxy start failed');
      });
    },

    stopProxy: function () {
      return nativeCall('stopProxy', {}).then(function () { return true; }).catch(function () { return true; });
    },

    downloadSubtitle: function (payload) {
      var opts = parsePayload(payload);
      return nativeCall('downloadSubtitle', { url: opts.url, fileName: opts.fileName || opts.filename, headers: opts.headers || {} })
        .then(function (res) {
          if (res && res.localPath) return { localPath: res.localPath };
          if (res && res.filePath) return { localPath: res.filePath };
          return null;
        }).catch(function () { return null; });
    },

    getSubtitleDir: function () {
      return nativeCall('getSubtitleDir', {}).then(function (res) {
        if (typeof res === 'string') return res;
        if (res && res.path) return res.path;
        return '';
      }).catch(function () { return ''; });
    },

    openExternal: function (url) {
      return nativeCall('openExternal', { url: url }).then(function () { return true; }).catch(function () { return false; });
    }
  };

  // ── Minimal window.electron shim ───────────────────────────────────────────
  // ONLY productive methods. Everything else intentionally undefined; audit
  // showed every unimplemented callsite is guarded with window.electron?.method.
  window.electron = {
    openExternal: function (url) {
      return nativeCall('openExternal', { url: url }).then(function () { return true; }).catch(function () { return false; });
    },
    showNotification: function (opts) {
      return nativeCall('showNotification', opts || {}).then(function () { return true; }).catch(function () { return false; });
    },
    // TV mode: lock landscape (enabled=true) / restore portrait (enabled=false).
    // Resolves { tvMode: boolean } via the dispatcher (native setTvMode dep).
    setTvMode: function (enabled) {
      return nativeCall('setTvMode', { enabled: !!enabled });
    },
    getAppVersion: function () { return Promise.resolve('2.6.0-android'); },
    getPlatform: function () { return Promise.resolve('android'); },
    secureGet: function (key) {
      return nativeCall('secureGet', { key: key }).then(function (res) { return res && res.value !== undefined ? res.value : null; }).catch(function () { return null; });
    },
    secureSet: function (key, value) {
      return nativeCall('secureSet', { key: key, value: value == null ? '' : String(value) }).then(function () { return true; }).catch(function () { return false; });
    },
    fileExists: function (path) {
      return nativeCall('fileExists', { path: path }).then(function (res) { return !!(res && res.exists); }).catch(function () { return false; });
    },
    pickFolder: function () {
      // Android: SAF picker is a later milestone; use deterministic public path.
      return nativeCall('getSubtitleDir', {}).then(function () { return '/sdcard/Download/Streambert'; }).catch(function () { return null; });
    },
    // m3u8/subtitle capture events (fed by native + this script's top-document capture)
    onM3u8Found: function (cb) {
      if (typeof cb !== 'function') return function () {};
      _m3u8Handlers.push(cb);
      return function () { _removeHandler(_m3u8Handlers, cb); };
    },
    offM3u8Found: function (cb) { _removeHandler(_m3u8Handlers, cb); },
    onSubtitleFound: function (cb) {
      if (typeof cb !== 'function') return function () {};
      _subHandlers.push(cb);
      return function () { _removeHandler(_subHandlers, cb); };
    },
    offSubtitleFound: function (cb) { _removeHandler(_subHandlers, cb); }
  };

  var _m3u8Handlers = [];
  var _subHandlers = [];
  function _removeHandler(arr, cb) {
    var i = arr.indexOf(cb); if (i >= 0) arr.splice(i, 1);
  }
  function _emitM3u8(url) {
    for (var i = 0; i < _m3u8Handlers.length; i++) { try { _m3u8Handlers[i](url); } catch (e) {} }
  }
  function _emitSub(url, kind) {
    for (var i = 0; i < _subHandlers.length; i++) { try { _subHandlers[i]({ url: url, kind: kind || 'auto' }); } catch (e) {} }
  }
  // Native pushes captured URLs through here (native shouldInterceptRequest /
  // iframe navigations). Registered before page scripts run.
  // NOTE: notifyStream/notifySubtitle already emit to handlers AND dedup -
  // these entry points must NOT emit a second time (regression: triple events).
  window.__streambertStreamCaptured = function (url) {
    if (typeof url === 'string' && url) {
      notifyStream(url, 'native');
    }
  };
  window.__streambertSubtitleCaptured = function (url) {
    if (typeof url === 'string' && url) {
      notifySubtitle(url);
    }
  };

  // ── Stream capture (top document) ─────────────────────────────────────────
  var STREAM_RE = /\.(m3u8|m3u|mp4|m4v|webm|mkv|ts)(\?|$|\/)|\/hls\/|\/dash\/|manifest\.|master\.|playlist\./i;
  var SUB_RE = /\.(vtt|srt|ass|ssa)(\?|$)/i;
  var _seen = {};

  function _dedup(url) {
    if (_seen[url]) return true;
    _seen[url] = 1;
    return false;
  }

  function notifyStream(url, type) {
    if (!url || typeof url !== 'string') return;
    if (url.indexOf('about:') === 0 || url.indexOf('blob:') === 0 || url.indexOf('data:') === 0) return;
    if (url.indexOf('http://') !== 0 && url.indexOf('https://') !== 0) return;
    if (!STREAM_RE.test(url)) return;
    if (/\.(js|css|png|jpg|jpeg|gif|svg|woff2?)(\?|$)/i.test(url)) return;
    if (_dedup(url)) return;
    post({ type: 'STREAM_FOUND', url: url, source: type || 'unknown' });
    _emitM3u8(url);
  }

  function notifySubtitle(url, lang) {
    if (!url || typeof url !== 'string') return;
    if (!SUB_RE.test(url)) return;
    if (_dedup(url)) return;
    post({ type: 'SUBTITLE_FOUND', url: url, lang: lang || 'en' });
    _emitSub(url);
  }

  try {
    var originalFetch = window.fetch;
    if (originalFetch) {
      window.fetch = function () {
        var url = arguments[0];
        if (typeof url === 'string') { notifyStream(url, 'fetch'); notifySubtitle(url); }
        else if (url && url.url) { notifyStream(url.url, 'fetch'); notifySubtitle(url.url); }
        return originalFetch.apply(this, arguments).then(function (response) {
          try { if (response && response.url) notifyStream(response.url, 'fetch-response'); } catch (e) {}
          return response;
        });
      };
    }
  } catch (e) {}

  try {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__streambertUrl = url;
      if (typeof url === 'string') { notifyStream(url, 'xhr-open'); notifySubtitle(url); }
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      var self = this;
      try {
        this.addEventListener('load', function () {
          if (self.responseURL) notifyStream(self.responseURL, 'xhr-response');
        });
      } catch (e) {}
      return originalSend.apply(this, arguments);
    };
  } catch (e) {}

  try {
    var desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (desc && desc.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        set: function (value) { notifyStream(value, 'media-src'); return desc.set.call(this, value); },
        get: desc.get,
        configurable: true
      });
    }
  } catch (e) {}

  function scanVideo(v) {
    try {
      if (v.src) notifyStream(v.src, 'video-src');
      if (v.currentSrc) notifyStream(v.currentSrc, 'video-currentSrc');
    } catch (e) {}
  }

  try {
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (!node || !node.tagName) return;
          if (node.tagName === 'VIDEO') scanVideo(node);
          if (node.tagName === 'SOURCE' && node.src) notifyStream(node.src, 'source-tag');
        });
        if (m.type === 'attributes' && m.target && m.target.tagName === 'VIDEO') scanVideo(m.target);
      });
    });
    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }
  } catch (e) {}

  // Compatibility API kept for the frontend's Android adapter paths
  window.StreambertAndroid = {
    reportStream: function (url, headers, subtitle) {
      notifyStream(url, 'streambert-direct');
      post({ type: 'STREAMBERT_STREAM', url: url, headers: headers, subtitle: subtitle });
    },
    reportError: function (error) {
      post({ type: 'STREAMBERT_ERROR', error: String(error) });
    }
  };

  post({ type: 'WEBVIEW_READY' });
  true;
})();
`;

export default WEBVIEW_BRIDGE_JS;
