// ── Frontend render smoke test (PHASE 2 UI verification) ────────────────────
// Bundles tests/entry-render.jsx (which mounts the REAL App) and executes it
// against jsdom. Scenario via env SCENARIO:
//   no-key       -> expect setup / API-key screen
//   invalid-key  -> stored invalid TMDB key: app must proceed past setup and
//                   render its shell WITHOUT crashing (API errors handled)
// Run: node tests/test_frontend_render.mjs
import { JSDOM } from 'jsdom';
import { Suite } from './helpers/nodeBrowserShim.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = `/tmp/streambert-render-${process.pid}.esm.js`;
const SCENARIO = process.env.SCENARIO || 'no-key';
const s = new Suite(`frontendRender[${SCENARIO}]`);

// 1) bundle
try {
  execFileSync(path.join(ROOT, 'node_modules/.bin/esbuild'), [
    path.join(ROOT, 'tests/entry-render.jsx'),
    '--bundle', '--format=esm', '--jsx=automatic',
    '--loader:.css=empty', '--loader:.woff2=empty',
    // desktop-only paths (proxyServer.js) require() Node builtins inside
    // Electron's node-integration renderer; they are never executed on
    // Web/Android/jsdom - mark external so the bundle resolves.
    '--external:http', '--external:https', '--external:fs', '--external:path',
    '--external:os', '--external:net', '--external:url', '--external:crypto',
    '--external:child_process', '--external:electron', '--external:stream',
    '--external:zlib', '--external:util', '--external:events', '--external:buffer',
    '--define:process.env.NODE_ENV="production"',
    `--outfile=${OUT}`,
  ], { stdio: 'pipe' });
  s.ok(fs.existsSync(OUT), 'esbuild bundles App tree (entry-render)');
} catch (e) {
  s.ok(false, 'esbuild bundle failed', String(e.stderr || e.message).slice(0, 400));
  console.log(s.summary().line);
  process.exit(1);
}

// 2) jsdom environment
// NOTE: jsdom denies localStorage for opaque (file://) origins; Android WebView
// with domStorageEnabled=true DOES provide DOM storage on file:// URLs (the
// packaged app context). We use an http origin here purely to satisfy jsdom.
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'https://webview.local/',
  pretendToBeVisual: true,
});
const { window } = dom;
for (const [k, v] of Object.entries({
  window, document: window.document, navigator: window.navigator,
  HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
  CustomEvent: window.CustomEvent, Event: window.Event,
  KeyboardEvent: window.KeyboardEvent, MouseEvent: window.MouseEvent,
  getComputedStyle: window.getComputedStyle.bind(window),
  requestAnimationFrame: (cb) => setTimeout(cb, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
})) { try { globalThis[k] = v; } catch {} }
globalThis.localStorage = window.localStorage;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.scrollTo = () => {};

// 3) scenario setup
if (SCENARIO === 'invalid-key') {
  window.localStorage.setItem('streambert_apikey', JSON.stringify('INVALID_TEST_KEY'));
  window.localStorage.setItem('streambert_skippedSetup', JSON.stringify(false));
} else {
  window.localStorage.clear();
}

// 4) execute bundled app (mounts synchronously; effects settle async)
try {
  await import(OUT);
  await new Promise(r => setTimeout(r, 600));
  const rootEl = window.document.getElementById('root');
  const text = (window.document.body.textContent || '').replace(/\s+/g, ' ');
  s.ok(rootEl.children.length > 0, 'App mounts into #root without throwing');
  s.ok(text.length > 20, `App renders visible content (${text.length} chars)`);

  if (SCENARIO === 'no-key') {
    s.ok(/api[- ]?key|tmdb|setup|willkommen|schlüssel|get started|einrichten/i.test(text),
      'setup/API-key screen shown when no key stored', text.slice(0, 160));
  }
  if (SCENARIO === 'invalid-key') {
    // After an (invalid) stored key, the app must NOT hang on a blank screen:
    // it should either show the shell/sidebar or a handled API error.
    const crashFree = rootEl.children.length > 0 && !/white screen/i.test(text);
    s.ok(crashFree, 'invalid stored key: app renders shell or handled error, no crash');
    const handled = /sidebar|home|start|filme|movies|error|fehler|ungültig|invalid|verbind|connect|check/i.test(text);
    s.ok(handled, 'invalid stored key: error is handled in UI (not silent blank)', text.slice(0, 160));
  }
} catch (e) {
  s.ok(false, 'App execution threw', String(e && e.stack || e).slice(0, 400));
} finally {
  fs.rmSync(OUT, { force: true });
}

const { status, line, results } = s.summary();
console.log(line);
if (status === 'FAIL') console.log(results.filter(r => r.includes('FAIL')).join('\n'));
process.exit(status === 'FAIL' ? 1 : 0);
