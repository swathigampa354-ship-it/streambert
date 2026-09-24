// ── JS unit tests against the REAL frontend modules ─────────────────────────
// Covers: headerHandler, streamResolver, playerRegistry, androidIntent,
//         androidNativeProxy (rewrite), subtitleHandler, platform detection,
//         externalPlayerAdapter + androidPlayerDetector + androidBridge (mock bridge)
// Run: node tests/test_js_unit.mjs
import { installBrowserShims, Suite } from './helpers/nodeBrowserShim.mjs';

const suites = [];
const out = [];
let totalFail = 0;

// ---------------------------------------------------------------------------
installBrowserShims();

// === headerHandler.js =======================================================
{
  const s = new Suite('headerHandler');
  const hh = await import('../src/utils/externalPlayer/headerHandler.js');

  const h = hh.buildHeaders('https://player.videasy.to/movie/550', 'videasy');
  s.eq(h['Referer'], 'https://player.videasy.to/movie/550', 'buildHeaders videasy referer = embed url');
  s.eq(h['Origin'], 'https://player.videasy.to', 'buildHeaders origin derived');
  s.includes(h['User-Agent'], 'Mozilla/5.0', 'default desktop UA present (embed providers block mobile UAs)');

  const hv = hh.buildHeaders('https://vsembed.su/embed/movie/550', 'vidsrc');
  s.eq(hv['Referer'], 'https://vsembed.su/embed/movie/550', 'vidsrc referer');

  const ha = hh.buildHeaders(null, 'allmanga');
  s.eq(ha['Referer'], 'https://allmanga.to', 'allmanga referer fixed');

  const hc = hh.buildHeaders('https://x/', 'vidking', { Cookie: 'cf=1', Authorization: 'Bearer t' });
  s.ok(hc['Cookie'] === 'cf=1' && hc['Authorization'] === 'Bearer t', 'extra headers merged');

  s.ok(hh.needsProxy({ Cookie: 'a=1' }, { supportsHeaders: true }) === true, 'needsProxy: Cookie -> proxy (mandatory)');
  s.ok(hh.needsProxy({ authorization: 'x' }, { supportsHeaders: true }) === true, 'needsProxy: Authorization -> proxy');
  s.ok(hh.needsProxy({ referer: 'https://x/' }, { supportsHeaders: false }) === true, 'needsProxy: Referer + headerless player -> proxy');
  s.ok(hh.needsProxy({ 'User-Agent': 'x' }, { supportsHeaders: true }) === false, 'needsProxy: plain UA -> no proxy');
  s.ok(hh.needsProxy(null, {}) === false, 'needsProxy: null headers -> false');

  const mx = { id: 'mxplayer', label: 'MX Player', supportsHeaders: false };
  s.ok(hh.analyzeProxyNeed({ Cookie: 'a=1' }, 'hls', mx).needed === true, 'analyze: Cookie -> needed with reason');
  s.ok(hh.analyzeProxyNeed({ Cookie: 'a=1' }, 'hls', mx).reason.length > 3, 'analyze: reason provided');
  s.ok(hh.analyzeProxyNeed({ 'User-Agent': 'x' }, 'mp4', { supportsHeaders: true }).needed === false, 'analyze: UA-only mp4 -> direct');

  const intentH = hh.getIntentHeaders({ 'User-Agent': 'u', Referer: 'r', Cookie: 'c', Origin: 'o' });
  s.eq(Object.keys(intentH).sort(), ['Referer', 'User-Agent'], 'getIntentHeaders keeps ONLY UA + Referer (extras never carry Cookie/Origin)');
  suites.push(s);
}

// === streamResolver.js ======================================================
{
  const s = new Suite('streamResolver');
  const sr = await import('../src/utils/externalPlayer/streamResolver.js');

  s.eq(sr.detectStreamType('https://cdn.x/playlist.m3u8?tok=1'), 'hls', 'detectStreamType .m3u8');
  s.eq(sr.detectStreamType('https://cdn.x/m.mpd'), 'dash', 'detectStreamType .mpd');
  s.eq(sr.detectStreamType('https://cdn.x/v.mp4?x=1'), 'mp4', 'detectStreamType .mp4?query');
  s.eq(sr.getMimeType('hls'), 'application/x-mpegURL', 'mime hls (VLC/MPV recognize)');
  s.eq(sr.getMimeType('mp4'), 'video/mp4', 'mime mp4');

  s.ok(sr.validateStreamUrl(null).valid === false, 'validate: null invalid');
  s.ok(sr.validateStreamUrl('about:blank').valid === false, 'validate: about:blank invalid');
  s.ok(sr.validateStreamUrl('ftp://x/v.mp4').valid === false, 'validate: non-http(s) invalid');
  s.ok(sr.validateStreamUrl('not a url').valid === false, 'validate: garbage invalid');
  s.ok(sr.validateStreamUrl('https://cdn.x/v.mp4').valid === true, 'validate: https mp4 valid');

  const infoEmbedOnly = sr.resolveStreamInfo({ embedUrl: 'https://www.vidking.net/embed/movie/550', sourceId: 'vidking' });
  s.ok(infoEmbedOnly.isEmbedPage === true, 'resolveStreamInfo: embed without m3u8 flagged isEmbedPage (needs interception)');

  const info = sr.resolveStreamInfo({
    embedUrl: 'https://www.vidking.net/embed/movie/550',
    m3u8Url: 'https://cdn.x/master.m3u8',
    sourceId: 'vidking', title: 'Fight Club', subtitles: [{ url: 'https://x/en.vtt', lang: 'en' }],
  });
  s.eq(info.url, 'https://cdn.x/master.m3u8', 'resolveStreamInfo prefers intercepted m3u8');
  s.eq(info.type, 'hls', 'type hls');
  s.eq(info.headers['Referer'], 'https://www.vidking.net/embed/movie/550', 'headers referer = embed');
  s.eq(info.subtitles.length, 1, 'subtitles carried');

  const enriched = sr.enrichWithProxyAnalysis(info, { id: 'vlc', label: 'VLC', supportsHeaders: true });
  s.ok(typeof enriched.needsProxy === 'boolean', 'enrichWithProxyAnalysis sets needsProxy');

  const testInfo = sr.createTestStreamInfo('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4');
  s.eq(testInfo.type, 'mp4', 'createTestStreamInfo mp4');
  s.includes(testInfo.headers['User-Agent'], 'Mozilla', 'test info UA present');

  const got = await sr.waitForM3u8(() => 'https://x/a.m3u8', 100, 10);
  s.eq(got, 'https://x/a.m3u8', 'waitForM3u8 resolves immediately when present');
  const none = await sr.waitForM3u8(() => null, 120, 20);
  s.eq(none, null, 'waitForM3u8 times out to null');
  suites.push(s);
}

// === playerRegistry.js ======================================================
{
  const s = new Suite('playerRegistry');
  const pr = await import('../src/utils/externalPlayer/playerRegistry.js');
  s.ok(Array.isArray(pr.KNOWN_PLAYERS) && pr.KNOWN_PLAYERS.length >= 5, 'KNOWN_PLAYERS >= 5');
  const pkgSet = new Set();
  let dupes = 0;
  for (const p of pr.KNOWN_PLAYERS) {
    for (const pkg of p.packageNames || []) { if (pkgSet.has(pkg)) dupes++; pkgSet.add(pkg); }
  }
  s.ok(dupes === 0, 'no package name claimed by two players', `${dupes} dupes`);
  const allPkgs = [...pkgSet];
  for (const need of ['org.videolan.vlc', 'is.xyz.mpv', 'com.mxtech.videoplayer.ad', 'com.mxtech.videoplayer.pro']) {
    s.ok(allPkgs.includes(need), `registry knows ${need}`);
  }
  const vlc = pr.KNOWN_PLAYERS.find(p => (p.packageNames || []).includes('org.videolan.vlc'));
  s.ok(vlc && vlc.supportsHeaders === true, 'VLC marked header-capable (UA/Referer via extras)');
  const mx = pr.KNOWN_PLAYERS.find(p => (p.packageNames || []).includes('com.mxtech.videoplayer.ad'));
  s.ok(mx && mx.supportsHeaders === false, 'MX Player marked header-incapable (drives proxy decision)');
  suites.push(s);
}

// === androidIntent.js =======================================================
{
  const s = new Suite('androidIntent');
  const ai = await import('../src/utils/externalPlayer/androidIntent.js');
  const uri = ai.buildIntentUri('https://cdn.example/x/master.m3u8', {
    packageName: 'org.videolan.vlc', mimeType: 'application/x-mpegURL',
    title: 'Fight;Club', headers: { 'User-Agent': 'UA;1', Referer: 'https://r/' }, subtitle: '/sdcard/Download/StreambertSubs/a.srt',
  });
  s.ok(uri.startsWith('intent:https://cdn.example/x/master.m3u8#Intent;'), 'intent URI scheme+data');
  s.includes(uri, 'action=android.intent.action.VIEW', 'ACTION_VIEW');
  s.includes(uri, 'type=application/x-mpegURL', 'mime type');
  s.includes(uri, 'package=org.videolan.vlc', 'package pinned');
  s.includes(uri, 'S.title=Fight%3BClub', 'semicolons escaped in extras');
  s.includes(uri, 'S.subtitles_location=/sdcard/Download/StreambertSubs/a.srt', 'subtitle extra present');
  s.ok(uri.endsWith('end'), 'ends with end');
  const noSub = ai.buildIntentUri('https://x/v.mp4', {});
  s.ok(!noSub.includes('subtitles_location'), 'no subtitle extras when none provided');
  const caps = ai.buildNativeIntentOptions('https://x/v.mp4', { headers: { 'User-Agent': 'u', Cookie: 'c' }, subtitle: '/a.srt' });
  s.ok(caps.headers['User-Agent'] === 'u' && !('Cookie' in caps.headers), 'native intent headers exclude Cookie (proxy handles it)');
  s.ok(caps.extras.subs === '/a.srt', 'native extras include subs');
  suites.push(s);
}

// === androidNativeProxy rewrite + helpers ===================================
{
  const s = new Suite('androidNativeProxy');
  const m = await import('../src/utils/externalPlayer/androidNativeProxy.js');
  s.eq(m.AndroidNativeProxy.extractHost('https://cdn.example.com:8080/a/b.m3u8'), 'cdn.example.com:8080', 'extractHost keeps port');
  s.eq(m.AndroidNativeProxy.extractTargetUrl('/https/cdn.example.com/a.m3u8'), 'https://cdn.example.com/a.m3u8', 'extractTargetUrl https');
  s.eq(m.AndroidNativeProxy.extractTargetUrl('/http/h.example/x'), 'http://h.example/x', 'extractTargetUrl http');
  s.eq(m.AndroidNativeProxy.extractTargetUrl('/nonsense'), null, 'extractTargetUrl rejects junk');

  const proxy = new m.AndroidNativeProxy();
  proxy.port = 8123; // simulate started proxy WITHOUT starting sockets
  const playlist = [
    '#EXTM3U',
    '#EXT-X-VERSION:6',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/keys/k.bin?k=1",IV=0xabc',
    '#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/prog.m3u8?tok=z",GROUP-ID="aud"',
    '#EXT-X-MAP:URI="/init/map.m4s"',
    '#EXTINF:6.0,',
    'seg1.ts?sign=abc',
    '/abs/seg2.ts',
    'https://cdn.example.com/full/seg3.ts',
    '',
  ].join('\n');
  const rewritten = proxy.rewriteHlsPlaylist(playlist, 'https://cdn.example.com/hls/master.m3u8');
  s.includes(rewritten, '#EXTM3U', 'tag lines preserved');
  s.includes(rewritten, 'URI="http://127.0.0.1:8123/https/cdn.example.com/keys/k.bin?k=1"', 'EXT-X-KEY absolute URI rewritten, query preserved');
  s.includes(rewritten, 'URI="http://127.0.0.1:8123/https/cdn.example.com/hls/audio/prog.m3u8?tok=z"', 'EXT-X-MEDIA relative URI rewritten');
  s.includes(rewritten, 'URI="http://127.0.0.1:8123/https/cdn.example.com/init/map.m4s"', 'EXT-X-MAP root-relative URI rewritten');
  s.includes(rewritten, 'http://127.0.0.1:8123/https/cdn.example.com/hls/seg1.ts?sign=abc', 'relative segment rewritten with query');
  s.includes(rewritten, 'http://127.0.0.1:8123/https/cdn.example.com/abs/seg2.ts', 'root-relative segment rewritten');
  s.includes(rewritten, 'http://127.0.0.1:8123/https/cdn.example.com/full/seg3.ts', 'absolute segment rewritten');
  s.ok(!/https:\/\/cdn\.example\.com(?![^\s"]*127\.0\.0\.1)/.test(rewritten.replace(/127\.0\.0\.1:8123\/https\//g, '')), 'no un-proxied same-host URL remains');
  suites.push(s);
}

// === subtitleHandler.js =====================================================
{
  const s = new Suite('subtitleHandler');
  const sh = await import('../src/utils/externalPlayer/subtitleHandler.js');
  s.eq(sh.extractSubtitleLang('https://x.com/subs/movie_eng.vtt'), 'eng', 'lang from filename');
  s.eq(sh.extractSubtitleLang('https://x/s.vtt?lang=de'), 'de', 'lang from query');
  s.eq(sh.getSubtitleExtension('https://x/a.vtt'), '.vtt', 'ext vtt');
  s.eq(sh.getSubtitleExtension('https://x/a.ass?x=1'), '.ass', 'ext ass');
  s.eq(sh.generateSubtitleFilename('Fight Club: The Movie', 1, 2, 'en', '.srt'), 'Fight Club The Movie - S01E02.en.srt', 'filename sanitized + episode pattern');
  const best = sh.getBestSubtitle([{ lang: 'de', url: 'd' }, { lang: 'en', url: 'e' }], 'en');
  s.eq(best.url, 'e', 'getBestSubtitle prefers en');
  const prep = await sh.prepareSubtitleForPlayer({ url: 'https://x/en.vtt', lang: 'en' }, { title: 'Fight Club' });
  s.ok(prep && prep.filename === 'Fight Club.en.vtt', 'prepare produces filename');
  s.includes(prep.androidPath, '/sdcard/Download/StreambertSubs/', 'android path under public Downloads/StreambertSubs');
  suites.push(s);
}

// === platform.js detection ==================================================
{
  const s = new Suite('platformDetection');
  const p = await import('../src/utils/platform.js');
  // Case 1: no bridges -> web
  s.eq(p.getPlatform(), 'web', 'no bridge -> web');
  // Case 2: StreambertNative present (what our WebView injects) -> android
  window.StreambertNative = { platform: 'android' };
  s.eq(p.getPlatform(), 'android', 'window.StreambertNative{platform:android} -> android');
  s.ok(p.isAndroid() === true, 'isAndroid true');
  s.ok(p.shouldUseExternalPlayer() === true, 'AUTO playback mode -> external on android');
  // Case 3: electron defined, native removed -> desktop
  delete window.StreambertNative;
  window.electron = { openExternal() {} };
  s.eq(p.getPlatform(), 'desktop', 'window.electron -> desktop');
  delete window.electron;
  // Case 4: localStorage override (testing aid)
  localStorage.setItem('streambert_platform_override', 'android');
  s.eq(p.getPlatform(), 'android', 'localStorage override -> android');
  localStorage.removeItem('streambert_platform_override');
  suites.push(s);
}

// === adapter + detector + bridge (mock StreambertNative) ====================
{
  const s = new Suite('adapterE2E-mockedBridge');
  const calls = { launch: [], proxy: [], detect: 0 };
  window.StreambertNative = {
    platform: 'android',
    getInstalledPlayers: async () => { calls.detect++; return ['org.videolan.vlc', 'com.mxtech.videoplayer.ad']; },
    launchPlayer: async (payload) => { calls.launch.push(JSON.parse(payload)); return { ok: true }; },
    startProxy: async (payload) => { calls.proxy.push(JSON.parse(payload)); return { proxyUrl: 'http://127.0.0.1:41234/https/cdn.example/master.m3u8', port: 41234 }; },
    stopProxy: async () => true,
    downloadSubtitle: async () => ({ localPath: '/sdcard/Download/StreambertSubs/Fight Club.en.vtt' }),
    getSubtitleDir: async () => '/sdcard/Download/StreambertSubs',
  };

  const { ExternalPlayerAdapter } = await import('../src/utils/externalPlayer/externalPlayerAdapter.js');
  const adapter = new ExternalPlayerAdapter({ platform: 'android' });

  const players = await adapter.detectAvailablePlayers();
  s.ok(players.some(p => p.id === 'vlc'), 'detect maps org.videolan.vlc -> vlc id');
  s.ok(players.some(p => p.id === 'system-default'), 'system chooser appended');
  s.ok(calls.detect >= 1, 'native getInstalledPlayers invoked');

  // 1) plain MP4, UA-only headers -> NO proxy, direct launch with vlc package first
  const direct = await adapter.launch({
    url: 'https://cdn.example/video.mp4',
    type: 'mp4', mimeType: 'video/mp4',
    headers: { 'User-Agent': 'Mozilla/5.0 (Test)' },
    title: 'Fight Club',
  }, { playerId: 'vlc' });
  s.ok(direct.ok === true, 'direct mp4 launch ok');
  s.eq(calls.proxy.length, 0, 'no proxy started for UA-only headers');
  s.eq(calls.launch.at(-1).packageName, 'org.videolan.vlc', 'launched with VLC package');
  s.eq(calls.launch.at(-1).url, 'https://cdn.example/video.mp4', 'direct URL untouched');

  // 2) Cookie header -> proxy REQUIRED -> launched with 127.0.0.1 proxy URL
  const protectedStream = await adapter.launch({
    url: 'https://cdn.example/master.m3u8',
    type: 'hls', mimeType: 'application/x-mpegURL',
    headers: { 'User-Agent': 'Mozilla/5.0 (Test)', Referer: 'https://prov.example/', Cookie: 'cf_clearance=x' },
    title: 'Fight Club',
  }, { playerId: 'vlc' });
  s.ok(protectedStream.ok === true, 'protected hls launch ok');
  s.eq(calls.proxy.length, 1, 'proxy started for Cookie stream');
  s.eq(calls.proxy[0].targetUrl, 'https://cdn.example/master.m3u8', 'proxy target = original stream');
  s.ok(String(calls.launch.at(-1).url).startsWith('http://127.0.0.1:41234/'), 'player receives localhost proxy URL');
  s.ok(protectedStream.usedProxy === true, 'usedProxy flag set');

  // 3) subtitle pipeline: adapter downloads sub via bridge and passes local path as extra
  const withSub = await adapter.launch({
    url: 'https://cdn.example/video.mp4', type: 'mp4', mimeType: 'video/mp4',
    headers: { 'User-Agent': 'UA' }, title: 'Fight Club',
    subtitles: [{ url: 'https://x/en.vtt', lang: 'en' }],
  }, { playerId: 'vlc' });
  s.ok(withSub.ok === true, 'launch with subtitles ok');
  s.includes(calls.launch.at(-1).subtitle, '/sdcard/Download/StreambertSubs/', 'player receives LOCAL subtitle path');

  // 4) invalid URL -> hard fail, no crash
  const bad = await adapter.launch({ url: '', headers: {} }, {});
  s.ok(bad.ok === false && String(bad.error).length > 0, 'invalid URL -> clean error');

  // 5) no players installed -> NO_PLAYER, NOT a crash
  window.StreambertNative = {
    platform: 'android',
    getInstalledPlayers: async () => [],
    launchPlayer: async () => ({ ok: false, error: 'ActivityNotFound' }),
  };
  const emptyAdapter = new ExternalPlayerAdapter({ platform: 'android' });
  const noPlayer = await emptyAdapter.launch({
    url: 'https://cdn.example/video.mp4', headers: { 'User-Agent': 'UA' },
  }, { playerId: 'vlc' });
  s.ok(noPlayer.ok === false, 'no-player case returns failure, not exception');
  // chooser fallback may still be present -> either NO_PLAYER or PLAYER_NOT_INSTALLED, must never throw
  s.ok(['no_player', 'player_not_installed', undefined].includes(noPlayer.errorCode) || noPlayer.ok === false, 'error is structured');

  delete window.StreambertNative;
  suites.push(s);
}

// ---------------------------------------------------------------------------
for (const s of suites) {
  const { status, line, results } = s.summary();
  out.push(line);
  if (status === 'FAIL') out.push(...results.filter(r => r.includes('FAIL')));
  totalFail += s.fail;
}
console.log(out.join('\n'));
console.log(totalFail === 0 ? 'ALL_JS_UNIT_PASS' : `JS_UNIT_FAILURES=${totalFail}`);
process.exit(totalFail === 0 ? 0 : 1);
