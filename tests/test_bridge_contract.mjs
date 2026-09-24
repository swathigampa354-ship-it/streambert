// ── Bridge contract tests ───────────────────────────────────────────────────
// Verifies the EXACT code shipped to the WebView (expo-app/app/webviewBridge.js)
// and the EXACT dispatcher used by streambert.tsx (nativeBridgeDispatcher.js)
// round-trip correctly, using a fake ReactNativeWebView + fake native module.
// Run: node tests/test_bridge_contract.mjs
import { Suite } from './helpers/nodeBrowserShim.mjs';

const { WEBVIEW_BRIDGE_JS } = await import('../expo-app/app/webviewBridge.js');
const dispatcher = await import('../expo-app/app/nativeBridgeDispatcher.js');

const suites = [];

// ── Build a fake WebView environment ─────────────────────────────────────────
function makeFakeWebView() {
  const posted = [];
  const win = {
    ReactNativeWebView: { postMessage: (msg) => posted.push(JSON.parse(msg)) },
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 15) wv' },
    localStorage: (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; })(),
    location: { href: 'file:///android_asset/dist/index.html' },
    fetch: async (url) => ({ url: typeof url === 'string' ? url : url.url }),
    XMLHttpRequest: null, // bridge guards with try/catch
    HTMLMediaElement: null,
    MutationObserver: null,
    document: null,
    addEventListener() {}, removeEventListener() {},
  };
  win.window = win;
  return { win, posted };
}

function installBridge(win) {
  // evaluate the exact injected script against the fake window
  const fn = new Function('window', 'document', 'navigator', 'localStorage', 'XMLHttpRequest', 'HTMLMediaElement', 'MutationObserver', 'fetch', 'ReactNativeWebView', WEBVIEW_BRIDGE_JS);
  fn.call(win, win, win.document ?? undefined, win.navigator, win.localStorage, win.XMLHttpRequest ?? function(){}, win.HTMLMediaElement ?? function(){}, win.MutationObserver ?? function(){}, win.fetch, win.ReactNativeWebView);
}

// === 1) bridge installs correct globals =====================================
{
  const s = new Suite('bridgeInstall');
  const { win, posted } = makeFakeWebView();
  installBridge(win);
  s.ok(win.StreambertNative && win.StreambertNative.platform === 'android', 'window.StreambertNative.platform = android (drives getPlatform() detection)');
  for (const m of ['getInstalledPlayers', 'launchPlayer', 'startProxy', 'stopProxy', 'downloadSubtitle', 'getSubtitleDir', 'openExternal']) {
    s.ok(typeof win.StreambertNative[m] === 'function', `StreambertNative.${m} is a function`);
  }
  s.ok(win.electron && typeof win.electron.openExternal === 'function', 'electron shim openExternal');
  s.ok(typeof win.electron.secureGet === 'function' && typeof win.electron.secureSet === 'function', 'electron shim secure storage');
  s.ok(typeof win.electron.onM3u8Found === 'function', 'electron shim onM3u8Found (MoviePage dependency)');
  s.ok(typeof win.__streambertNativeResolve === 'function', 'response entry point installed');
  s.ok(posted.some(m => m.type === 'WEBVIEW_READY'), 'WEBVIEW_READY posted (RN sets loading=false)');
  // electron shim: versions
  s.eq(await win.electron.getAppVersion(), '2.6.0-android', 'electron getAppVersion = 2.6.0-android');
  s.eq(await win.electron.getPlatform(), 'android', 'electron getPlatform = android');
  suites.push(s);
}

// === 2) request/response round trip with real dispatcher =====================
{
  const s = new Suite('bridgeRoundTrip');
  const { win, posted } = makeFakeWebView();
  installBridge(win);

  // fake native module standing in for expo-external-player
  const fakeCalls = { launch: [], proxy: [] };
  const fakeDeps = {
    ExternalPlayer: {
      getInstalledPlayersNative: async () => ['org.videolan.vlc'],
      launchPlayerNative: async (opts) => { fakeCalls.launch.push(opts); return { success: true, opener: 'intent', packageName: opts.packageName }; },
      startProxyNative: async (opts) => { fakeCalls.proxy.push(opts); return { localUrl: 'http://127.0.0.1:50123/https/cdn.x/master.m3u8', port: 50123 }; },
      stopProxyNative: async () => {},
      downloadSubtitleNative: async (opts ) => ({ filePath: '/sdcard/Download/StreambertSubs/' + opts.fileName }),
      getSubtitleDirNative: async () => '/sdcard/Download/StreambertSubs',
      fileExistsNative: async (p) => p === '/exists/file.srt',
    },
    Linking: { openURL: async () => {} },
    SecureStore: {
      _m: new Map(),
      getItemAsync: async function (k) { return this._m.get(k) ?? null; },
      setItemAsync: async function (k, v) { this._m.set(k, v); },
    },
  };

  // full-duplex pump: WebView post -> dispatcher -> injectJavaScript(resolve)
  async function pump() {
    for (let i = 0; i < posted.length; i++) {
      const msg = posted[i];
      const call = dispatcher.parseNativeCallMessage(JSON.stringify(msg));
      if (!call) continue;
      posted.splice(i, 1); i--;
      const result = await dispatcher.dispatchNativeCall(call.method, call.payload, fakeDeps);
      const script = dispatcher.buildResolveScript(call.id, result.ok, result.ok ? result.data : { error: result.error });
      // simulate RN executing injectJavaScript(script) inside the page
      win.eval ? win.eval(script) : (new Function('window', script))(win);
    }
  }
  async function callAndRespond(promise) {
    // let microtasks flush so nativeCall() posts the message
    await new Promise(r => setTimeout(r, 0));
    await pump();
    return promise;
  }

  // -- getInstalledPlayers
  const players = await callAndRespond(win.StreambertNative.getInstalledPlayers());
  s.eq(players, ['org.videolan.vlc'], 'getInstalledPlayers round trip returns array');

  // -- launchPlayer with JSON-string payload (androidBridge.js style)
  const launchRes = await callAndRespond(win.StreambertNative.launchPlayer(JSON.stringify({ url: 'https://cdn.x/v.mp4', packageName: 'org.videolan.vlc', mimeType: 'video/mp4', headers: { 'User-Agent': 'u' } })));
  s.ok(launchRes.ok === true, 'launchPlayer resolves ok:true');
  s.eq(fakeCalls.launch[0].packageName, 'org.videolan.vlc', 'dispatcher forwarded packageName to native module');
  s.eq(fakeCalls.launch[0].mimeType, 'video/mp4', 'dispatcher forwarded mimeType');

  // -- startProxy localUrl normalization
  const proxyRes = await callAndRespond(win.StreambertNative.startProxy(JSON.stringify({ targetUrl: 'https://cdn.x/master.m3u8', headers: { Referer: 'https://p/' } })));
  s.eq(proxyRes.proxyUrl, 'http://127.0.0.1:50123/https/cdn.x/master.m3u8', 'startProxy normalizes localUrl -> proxyUrl');
  s.eq(proxyRes.port, 50123, 'port carried');

  // -- downloadSubtitle filename|fileName compatibility
  const subRes = await callAndRespond(win.StreambertNative.downloadSubtitle(JSON.stringify({ url: 'https://x/en.vtt', filename: 'Fight.en.vtt', headers: {} })));
  s.eq(subRes.localPath, '/sdcard/Download/StreambertSubs/Fight.en.vtt', 'downloadSubtitle maps filename -> fileName and returns localPath');

  // -- subtitle dir
  s.eq(await callAndRespond(win.StreambertNative.getSubtitleDir()), '/sdcard/Download/StreambertSubs', 'getSubtitleDir string');

  // -- electron secureGet/secureSet through SecureStore
  await callAndRespond(win.electron.secureSet('tmdb_api_key', 'SECRET123'));
  const secret = await callAndRespond(win.electron.secureGet('tmdb_api_key'));
  s.eq(secret, 'SECRET123', 'electron.secureSet/secureGet persist via native SecureStore');

  // -- electron fileExists via native module
  s.eq(await callAndRespond(win.electron.fileExists('/exists/file.srt')), true, 'fileExists true for existing');
  s.eq(await callAndRespond(win.electron.fileExists('/nope.srt')), false, 'fileExists false for missing');

  // -- openExternal
  s.eq(await callAndRespond(win.electron.openExternal('https://github.com/truelockmc/streambert')), true, 'openExternal -> Linking true');

  // -- error propagation: launchPlayer without url -> rejection path inside StreambertNative -> ok:false object
  const badLaunch = await callAndRespond(win.StreambertNative.launchPlayer(JSON.stringify({ url: '' })));
  s.ok(badLaunch.ok === false && typeof badLaunch.error === 'string', 'invalid launch returns {ok:false,error} not an exception');

  // -- unknown native module method surfaces as {ok:false}
  await (async () => {
    const id = 999;
    const res = await dispatcher.dispatchNativeCall('doesNotExist', {}, fakeDeps);
    s.ok(res.ok === false && res.error.includes('Unknown bridge method'), 'unknown method -> structured error');
  })();
  suites.push(s);
}

// === 3) stream capture + onM3u8Found wiring ==================================
{
  const s = new Suite('bridgeCapture');
  const { win, posted } = makeFakeWebView();
  installBridge(win);

  // onM3u8Found: native capture pushes into page
  const got = [];
  win.electron.onM3u8Found((url) => got.push(url));
  win.__streambertStreamCaptured('https://cdn.x/master.m3u8');
  win.__streambertStreamCaptured('https://cdn.x/master.m3u8'); // dedup
  win.__streambertSubtitleCaptured('https://cdn.x/subs/en.vtt');
  s.eq(got, ['https://cdn.x/master.m3u8'], 'onM3u8Found handler receives captured URL once (dedup)');
  s.ok(posted.some(m => m.type === 'STREAM_FOUND' && m.url.includes('master.m3u8')), 'STREAM_FOUND posted to RN');
  s.ok(posted.some(m => m.type === 'SUBTITLE_FOUND' && m.url.includes('en.vtt')), 'SUBTITLE_FOUND posted to RN');

  // top-document fetch hook captures stream URLs
  await win.fetch('https://cdn.x/playlist.m3u8?token=1');
  s.ok(got.includes('https://cdn.x/playlist.m3u8?token=1'), 'fetch() interception feeds onM3u8Found');
  // but ignores non-stream assets
  const before = got.length;
  await win.fetch('https://cdn.x/app.js');
  await win.fetch('https://cdn.x/logo.png');
  s.eq(got.length, before, 'fetch() ignores js/css/png assets');
  suites.push(s);
}

// === 4) dispatcher input hardening ===========================================
{
  const s = new Suite('dispatcherHardening');
  const d = dispatcher;
  s.eq(d.parseNativeCallMessage('not json'), null, 'parse: garbage -> null');
  s.eq(d.parseNativeCallMessage(JSON.stringify({ type: 'OTHER' })), null, 'parse: non-NATIVE_CALL -> null');
  s.eq(d.parseNativeCallMessage(JSON.stringify({ type: 'NATIVE_CALL', id: 'x', method: 5 })), null, 'parse: bad id/method types -> null');
  const okParse = d.parseNativeCallMessage(JSON.stringify({ type: 'NATIVE_CALL', id: 7, method: 'getSubtitleDir' }));
  s.eq(okParse && okParse.id, 7, 'parse: valid message');
  const script = d.buildResolveScript(7, true, { path: '/a"b\\c' });
  s.includes(script, '__streambertNativeResolve("7", true,', 'resolve script targets entry point (id JSON-quoted: survives non-numeric ids)');
  // the payload string must survive special chars round-trip
  let captured = null;
  const fakeWin = { __streambertNativeResolve: (id, ok, payload) => { captured = { id, ok, payload: JSON.parse(payload) }; } };
  new Function('window', script)(fakeWin);
  s.eq(captured.payload, { path: '/a"b\\c' }, 'resolve script payload survives quotes/backslashes');

  // fuzz: hostile payloads incl U+2028/U+2029 (valid JSON, INVALID raw in old-JS
  // string literals), newlines, lone surrogates region, 5KB value
  const fuzzPayloads = [
    { players: ["vlc'quote", 'x\\back', 'nl\nline'], nested: { u: 'line\u2028sep' } },
    'para:\u2028 / line:\u2029',
    { url: "https://e.com/v.m3u8?t=1&h=a'\n'b", error: null },
    { big: 'x'.repeat(5000), q: '"', emoji: '🎬🎥', emoji2: '👨‍👩‍👧‍👦' },
    [0, true, false, null, 'null', 3.14159],
  ];
  let fuzzOk = true; let fuzzDetail = '';
  for (const [i, payload] of fuzzPayloads.entries()) {
    const script = d.buildResolveScript(`fuzz-${i}`, true, payload);
    let got = null;
    const fw = { __streambertNativeResolve: (id, ok, p) => { got = JSON.parse(p); } };
    new Function('window', script)(fw);
    if (JSON.stringify(got) !== JSON.stringify(payload)) { fuzzOk = false; fuzzDetail = `payload ${i} mangled: ${JSON.stringify(got)?.slice(0, 100)}`; break; }
  }
  s.ok(fuzzOk, 'buildResolveScript fuzz payloads round-trip (5 hostile payloads)' + (fuzzDetail ? ' — ' + fuzzDetail : ''));
  suites.push(s);
}

// ---------------------------------------------------------------------------
let totalFail = 0;
const out = [];
for (const s of suites) {
  const { status, line, results } = s.summary();
  out.push(line);
  if (status === 'FAIL') out.push(...results.filter(r => r.includes('FAIL')));
  totalFail += s.fail;
}
console.log(out.join('\n'));
console.log(totalFail === 0 ? 'ALL_BRIDGE_CONTRACT_PASS' : `BRIDGE_FAILURES=${totalFail}`);
process.exit(totalFail === 0 ? 0 : 1);
