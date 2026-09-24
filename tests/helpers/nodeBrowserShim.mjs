// Minimal browser-environment shims so the REAL frontend modules
// (src/utils/**) can be imported and exercised under Node 20 (which is all
// Termux provides). Only what the modules touch is implemented.

class LocalStorageShim {
  constructor() { this._m = new Map(); }
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }
  setItem(k, v) { this._m.set(k, String(v)); }
  removeItem(k) { this._m.delete(k); }
  clear() { this._m.clear(); }
  key(i) { return [...this._m.keys()][i] ?? null; }
  get length() { return this._m.size; }
  // Object.keys(localStorage) compat used by storage.js clearAll()
  *[Symbol.iterator]() { yield* this._m.keys(); }
}

export function installBrowserShims(overrides = {}) {
  const ls = new LocalStorageShim();
  // Object.keys support: proxy plain-object behaviour
  const localStorage = new Proxy(ls, {
    ownKeys: (t) => [...t._m.keys()],
    getOwnPropertyDescriptor: (t, k) => t._m.has(k) ? { enumerable: true, configurable: true, value: t._m.get(k) } : undefined,
    get: (t, k) => (typeof t[k] !== 'undefined' ? t[k] : t._m.get(k)),
  });

  const win = {
    localStorage,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 15) StreambertTest/1.0' },
    location: { href: 'file:///android_asset/dist/index.html' },
    addEventListener() {}, removeEventListener() {},
    dispatchEvent() { return true; },
    open() { return null; },
    ...overrides.window,
  };
  win.window = win;

  globalThis.localStorage = localStorage;
  globalThis.window = win;
  if (!globalThis.navigator) {
    try { Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true }); } catch { globalThis.navigator = win.navigator; }
  }
  if (!globalThis.location) {
    try { Object.defineProperty(globalThis, 'location', { value: win.location, configurable: true }); } catch { globalThis.location = win.location; }
  }

  return { window: win, localStorage };
}

// Shareable assertion helpers producing PASS/FAIL lines.
export class Suite {
  constructor(name) {
    this.name = name;
    this.pass = 0; this.fail = 0; this.results = [];
  }
  ok(cond, label, extra = '') {
    if (cond) { this.pass++; this.results.push(`  PASS ${label}`); }
    else { this.fail++; this.results.push(`  FAIL ${label}${extra ? ' :: ' + extra : ''}`); }
    return !!cond;
  }
  eq(actual, expected, label) {
    const a = JSON.stringify(actual), e = JSON.stringify(expected);
    return this.ok(a === e, label, `expected=${e} actual=${a}`);
  }
  includes(haystack, needle, label) {
    return this.ok(String(haystack).includes(needle), label, `missing "${needle}" in ${String(haystack).slice(0, 120)}`);
  }
  async throws(fn, label) {
    try { await fn(); return this.ok(false, label, 'did not throw'); }
    catch { return this.ok(true, label); }
  }
  summary() {
    const status = this.fail === 0 ? 'PASS' : 'FAIL';
    return { status, line: `[${status}] ${this.name}: ${this.pass} passed, ${this.fail} failed`, results: this.results };
  }
}
