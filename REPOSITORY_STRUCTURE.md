# Streambert — Repository Structure

One repo, two products sharing one frontend codebase:

```
streambert-fork/
├── package.json            # Electron/Vite app (desktop) — main: index.js
├── index.js                # Electron MAIN process (desktop only, never bundled)
├── preload.js              # Electron preload: window.electron context bridge
├── popout-preload.js       # Electron preload for pop-out player window
├── index.html              # Vite entry (renderer shell)
├── vite.config.js          # Vite 7 build config (cssMinify: lightningcss)
│
├── src/                    # THE Streambert frontend (shared: desktop + Android WebView)
│   ├── main.jsx            # React entry; imports global.css + responsive.css
│   ├── App.jsx             # Root component: all pages, modals, TV mode flow
│   ├── components/         # 19 UI components (Sidebar, SearchModal, Icons, …)
│   ├── pages/              # HomePage, MoviePage, TVPage, AnimePage, DownloadsPage… (lazy-loaded)
│   ├── platform/           # Runtime platform layer: index.js router + desktop/ + android/
│   ├── styles/             # global.css (desktop foundation), responsive.css (additive phone/TV)
│   ├── ipc/                # Electron-only renderer-side IPC helpers (dead code on Android)
│   └── utils/
│       ├── api.js          # TMDB/AniList/PLAYER_SOURCES (+NEEDS_INTERCEPT) — used on both platforms
│       ├── platform.js     # isAndroid/isDesktop/getPlatform detection
│       ├── tvMode.js       # TV mode intent persistence + bridge call + body class
│       ├── storage.js      # localStorage-mediated storage + secureStorage (desktop)
│       ├── gamepad*.js     # gamepad loop/spatial-nav/player-control (all platforms)
│       └── externalPlayer/ # stream resolver, proxy decisions, intent building, bridge client,
│                           # player registry, subtitle handling (Android paths run in WebView)
│
├── expo-app/               # Android shell app (its OWN git repo → outer gitlink)
│   ├── app/
│   │   ├── index.tsx       # entry route: prod → replace('/streambert'), dev → menu
│   │   ├── streambert.tsx  # production screen: WebView + bridge + TV lock + debug(dev-only)
│   │   ├── player-test.tsx # dev-only native-module test harness (unlinked in prod)
│   │   ├── webviewBridge.js# injected JS: StreambertNative + electron shim + stream capture
│   │   └── nativeBridgeDispatcher.js  # validated method dispatch + resolve-script builder
│   ├── modules/expo-external-player/  # local Expo module (file: dep, autolinked)
│   │   ├── src/index.ts    # TS wrapper (getInstalledPlayers/launchPlayer/proxy/subtitles)
│   │   └── android/…/      # Kotlin ExternalPlayerModule + AndroidProxyServer.java (on-request proxy,
│   │                       #   link-layer rewriting, gzip/staticroot support, host allowlist)
│   ├── plugins/            # with-external-player (manifest: queries + scoped perms),
│   │                       # with-dist-assets (dist → app/src/main/assets/dist, fails if missing),
│   │                       # with-external-player-native.js (DEAD — not referenced in app.json)
│   ├── patches/react-native-webview+13.12.5.patch  # native shouldInterceptRequest → NATIVE_STREAM_FOUND
│   ├── assets/dist/        # COMMITTED copy of the frontend build (sync_frontend.sh output)
│   ├── app.json / eas.json / package.json / tsconfig.json
│   └── android/            # PREBUILD OUTPUT — regenerable, git-ignored
│
├── tests/                  # AUTHORED VERIFICATION SUITE (Termux/Linux runnable)
│   ├── run_all.sh          # orchestrator, prints PASS/FAIL matrix, --fast mode
│   ├── test_js_unit.mjs / test_bridge_contract.mjs / test_ui_tv.mjs  # real-module JS suites
│   ├── test_proxy_java.sh|py / java/ / fixtures/  # real Java proxy compiled+exercised on JVM
│   ├── test_api_live.mjs / test_frontend_dist.sh / test_frontend_render.mjs / test_expo_config.mjs
│   └── helpers/nodeBrowserShim.mjs
│
├── scripts/                # sync_frontend.sh (dist → expo-app/assets/dist), test-external-player.js
├── public/                 # Vite public assets
├── docs/archive/           # 12 superseded session reports (Capacitor-era etc.)
├── *.md (root)             # PRE_APK_VERIFICATION, ARCHITECTURE, REPOSITORY_STRUCTURE,
│                           # APK_BUILD_CHECKLIST, DEVICE_VERIFICATION, FINAL_AUDIT, README…
├── .github/                # upstream CI (desktop build) — kept
└── screenshots/            # upstream marketing assets — kept
```

## Ownership rules
- **Desktop (Electron)**: `index.js` + `preload.js` + `src/ipc/*` + `src/platform/desktop/*`. Must keep working.
- **Android APK**: `expo-app/**` ONLY (plus the shared `src/**` build injected via `assets/dist`). Nothing else is shipped.
- **Shared frontend**: everything under `src/` must build for BOTH (Vite bundling proves it).
- dist/ (root build output) is git-ignored; expo-app/assets/dist IS tracked and synced.

## Removed during final audit (2026-09-24; history retains them)
- `android/` (abandoned Capacitor project), `capacitor.config.json`, `@capacitor/*` deps
- `approve`, `scripts` npm packages (unused)
- `test-external-player.js` → moved to `scripts/`
- Dead code: `isCapacitor*` helpers, `buildCapacitorIntentOptions`, `buildTermux*` legacy fns,
  Capacitor branches in `androidBridge.js`, deprecated registry opener types
