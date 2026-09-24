// ── UI adaptation + TV mode verification suite ──────────────────────────────
// Layers:
//   STATIC    – code/shape assertions (CSS breakpoints, dialog, orientation
//               calls, dev-only gating, sidebar wiring, dist sync)
//   MODULE    – real src/utils/tvMode.js executed against shims + fake bridge
//   COMPONENT – real <Sidebar/> rendered in jsdom (bundled entry), TV button
//               click behavior, Quit-button gating on Android
// Run: node tests/test_ui_tv.mjs
import { Suite, installBrowserShims } from './helpers/nodeBrowserShim.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const suites = [];
const CSS = read('src/styles/responsive.css');
const GLOBAL_CSS = read('src/styles/global.css');
const SIDEBAR = read('src/components/Sidebar.jsx');
const APP = read('src/App.jsx');
const TVMODE = read('src/utils/tvMode.js');
const BRIDGE = read('expo-app/app/webviewBridge.js');
const DISPATCHER = read('expo-app/app/nativeBridgeDispatcher.js');
const SCREEN = read('expo-app/app/streambert.tsx');
const ICONS = read('src/components/Icons.jsx');
const MAIN = read('src/main.jsx');

// ============================== STATIC ======================================
{
  const s = new Suite('uiStatic');
  // CSS breakpoints
  for (const mq of ['@media (max-width: 640px)', '@media (max-width: 380px)', '(orientation: landscape) and (max-height: 520px)'])
    s.includes(CSS, mq, `responsive.css has breakpoint ${mq}`);
  s.includes(CSS, 'body.tv-mode', 'tv-mode body class rules present');
  s.includes(CSS, ':focus-visible', 'tv mode focus ring for d-pad/keyboard');
  s.includes(CSS, 'minmax(170px, 1fr)', 'tv mode larger cards');
  s.includes(CSS, 'tv-mode-confirm', 'confirm dialog styles present');
  s.ok(!GLOBAL_CSS.includes('.tv-mode-confirm-overlay'), 'global.css untouched by tv additions (additive layer only)');
  s.includes(GLOBAL_CSS, 'body.compact-mode', 'existing compact-mode preserved');
  s.includes(MAIN, 'responsive.css', 'main.jsx imports responsive layer');

  // tvMode module shape
  s.includes(TVMODE, "streambert_tv_mode", 'persistence key');
  s.includes(TVMODE, "classList.toggle(\"tv-mode\"", 'body class toggle');
  s.includes(TVMODE, 'StreambertNative?.setTvMode', 'native call guarded');
  s.includes(TVMODE, 'syncTvModeOnBoot', 'boot sync export');

  // bridge/dispatcher wiring
  s.includes(BRIDGE, 'setTvMode: function', 'bridge exposes setTvMode');
  s.includes(BRIDGE, "nativeCall('setTvMode'", 'bridge forwards method');
  s.includes(DISPATCHER, "'setTvMode'", 'dispatcher allowlist');
  s.includes(DISPATCHER, 'deps.setTvMode', 'dispatcher calls native dep');
  s.includes(DISPATCHER, 'enabled (boolean) required', 'payload validation');

  // RN shell: orientation lock + lifecycle + production-clean UI
  s.includes(SCREEN, 'expo-screen-orientation', 'orientation dep imported');
  s.includes(SCREEN, 'OrientationLock.LANDSCAPE', 'tv mode locks landscape');
  s.includes(SCREEN, 'OrientationLock.PORTRAIT_UP', 'exit restores portrait');
  s.includes(SCREEN, 'AppState', 'AppState lifecycle handled');
  s.ok(/__DEV__ && \(\s*<View style=\{styles\.controls\}>/.test(SCREEN), 'debug controls dev-gated');
  s.ok(/__DEV__ && \(\s*<View style=\{styles\.header\}>/.test(SCREEN), 'debug header dev-gated');
  s.ok(!/Streambert \(Local Packaged\)/.test(SCREEN), 'no permanent production header');

  suites.push(s);
}

{
  const s = new Suite('tvUiWiring');
  s.includes(ICONS, 'TvIcon', 'TvIcon exported');
  s.includes(SIDEBAR, 'TvIcon', 'Sidebar imports TvIcon');
  s.includes(SIDEBAR, 'isAndroid() && (', 'TV button Android-gated');
  s.includes(SIDEBAR, '"Exit TV Mode"', 'exit label present');
  s.includes(SIDEBAR, '"TV Mode"', 'enter label present');
  s.ok(SIDEBAR.includes('!isAndroid()') && SIDEBAR.includes('quitApp'), 'Quit button hidden on Android');
  s.includes(APP, 'showTvConfirm', 'confirm modal state');
  s.includes(APP, 'Rotate your phone horizontally for the best experience.', 'instruction text verbatim');
  s.includes(APP, 'confirmTvMode', 'Continue handler');
  s.includes(APP, 'syncTvModeOnBoot', 'boot sync used');
  s.includes(APP, 'onToggleTvMode={handleToggleTvMode}', 'Sidebar prop wired');
  // dist sync: built css must contain tv-mode classes (proves dist rebuilt w/ responsive layer)
  const distCss = fs.readdirSync(path.join(ROOT, 'dist/assets')).filter((f) => f.endsWith('.css'));
  const cssTxt = distCss.map((f) => fs.readFileSync(path.join(ROOT, 'dist/assets', f), 'utf8')).join('');
  s.includes(cssTxt, '.tv-mode-confirm-overlay', 'built dist CSS contains tv styles (sync needed if missing)');
  s.includes(cssTxt, 'tv-mode', 'built dist CSS contains tv-mode class');
  // entry route: production boots straight into /streambert, dev keeps menu
  const INDEX = read('expo-app/app/index.tsx');
  s.includes(INDEX, "router.replace('/streambert')", 'index replaces to /streambert in production');
  s.ok(/if \(!__DEV__\)/.test(INDEX), 'dev menu gated by __DEV__');
  s.ok(!/Architecture\n/.test(INDEX), 'no docs-heavy launcher');
  // no back-loop: at root without WebView history, production exits the app
  s.includes(SCREEN, 'BackHandler.exitApp()', 'production back exits app (no index->streambert redirect loop)');
  suites.push(s);
}

// ============================== MODULE ======================================
{
  const s = new Suite('tvModeModule');
  const calls = [];
  installBrowserShims(); // localStorage + window + Android UA
  globalThis.document = {
    body: {
      classList: {
        _s: new Set(),
        toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
        contains(c) { return this._s.has(c); },
      },
    },
  };

  const tv = await import(`${path.join(ROOT, 'src/utils/tvMode.js')}?fresh=1`);

  // off-Android (no StreambertNative): toggles class + persists, no native call
  let r = await tv.requestTvMode(true);
  s.eq(r.tvMode, true, 'off-Android requestTvMode(true) resolves intent');
  s.eq(globalThis.localStorage.getItem('streambert_tv_mode'), '1', 'persisted intent=1');
  s.eq(tv.isTvModeOn(), true, 'isTvModeOn reads persistence');

  // on-Android with bridge: native call fired with enabled
  globalThis.window.StreambertNative = {
    platform: 'android',
    setTvMode: (payload) => { calls.push(payload); return Promise.resolve({ tvMode: payload }); },
  };
  r = await tv.requestTvMode(false);
  s.eq(calls[0], false, 'Android exit calls native setTvMode(false)');
  s.eq(globalThis.localStorage.getItem('streambert_tv_mode'), '0', 'exit persists intent=0');

  globalThis.localStorage.setItem('streambert_tv_mode', '1');
  const booted = await tv.syncTvModeOnBoot();
  s.eq(booted, true, 'boot sync restores ON intent');
  s.eq(calls[calls.length - 1], true, 'boot sync re-asserts native lock');
  s.eq(globalThis.document.body.classList.contains('tv-mode'), true, 'body.tv-mode class applied');
  suites.push(s);
}

// ============================ COMPONENT (jsdom) =============================
{
  const s = new Suite('tvSidebarComponent[jsdom]');
  // build the sidebar-test entry on the fly (separate React tree from render test)
  const entry = path.join(ROOT, 'tests/entry-sidebar.jsx');
  if (!fs.existsSync(entry)) {
    s.ok(false, 'tests/entry-sidebar.jsx missing');
  } else {
    const OUT = `/tmp/streambert-sidebar-${process.pid}.esm.js`;
    try {
      execFileSync(path.join(ROOT, 'node_modules/.bin/esbuild'), [
        entry, '--bundle', '--format=esm', '--jsx=automatic',
        '--loader:.css=empty', '--loader:.woff2=empty',
        '--external:http', '--external:https', '--external:fs', '--external:path',
        '--external:os', '--external:net', '--external:url', '--external:crypto',
        '--external:child_process', '--external:electron', '--external:stream',
        '--external:zlib', '--external:util', '--external:events', '--external:buffer',
        '--define:process.env.NODE_ENV="production"',
        `--outfile=${OUT}`,
      ], { stdio: 'pipe' });
      s.ok(true, 'sidebar entry bundles');

      const { JSDOM } = await import('jsdom');
      const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
        url: 'https://webview.local/', pretendToBeVisual: true,
      });
      const { window } = dom;
      for (const [k, v] of Object.entries({
        window, document: window.document, navigator: window.navigator,
        HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
        getComputedStyle: window.getComputedStyle.bind(window),
        requestAnimationFrame: (cb) => setTimeout(cb, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
      })) { try { globalThis[k] = v; } catch {} }
      globalThis.localStorage = window.localStorage;
      globalThis.CustomEvent = window.CustomEvent;
      window.localStorage.setItem('streambert_platform_override', 'android'); // -> isAndroid()
      globalThis.window = window;

      await import(`file://${OUT}`);
      await new Promise((r) => setTimeout(r, 300));

      const doc = window.document;
      const tips = [...doc.querySelectorAll('.sidebar-btn .tooltip')].map((t) => t.textContent.trim());
      s.ok(tips.some((t) => t === 'TV Mode' || t === 'Exit TV Mode'), `TV button rendered on Android (tooltips: ${JSON.stringify(tips)})`);
      s.ok(!tips.includes('Quit App'), 'Quit App button hidden on Android');

      // click TV -> onToggleTvMode fired (entry stores calls on window.__toggleCalls)
      const btn = [...doc.querySelectorAll('.sidebar-btn')].find((b) =>
        b.querySelector('.tooltip')?.textContent.trim() === 'TV Mode');
      s.ok(!!btn, 'TV Mode button findable');
      if (btn) {
        btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        s.ok((window.__toggleCalls || 0) >= 1, 'click invokes onToggleTvMode (opens confirm upstream)');
      }
    } catch (e) {
      s.ok(false, 'sidebar component test executed', String(e.message || e).slice(0, 300));
    }
  }
  suites.push(s);
}

// -------------------------------- summary -----------------------------------
let totalFail = 0;
const out = [];
for (const s of suites) {
  const { status, line, results } = s.summary();
  out.push(line);
  if (status === 'FAIL') out.push(...results.filter((r) => r.includes('FAIL')));
  totalFail += s.fail;
}
console.log(out.join('\n'));
console.log(totalFail === 0 ? 'ALL_UI_TV_PASS' : `UI_TV_FAILURES=${totalFail}`);
process.exit(totalFail === 0 ? 0 : 1);
