// ── Static config/parity checks across JS <-> TS <-> Kotlin <-> plugins ─────
// These catch the drift class of bugs that previously broke the integration
// (missing exports, name mismatches, queries/PackageManager parity).
// Run: node tests/test_expo_config.mjs
import { Suite } from './helpers/nodeBrowserShim.mjs';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const EA = path.join(ROOT, 'expo-app');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readEA = (p) => fs.readFileSync(path.join(EA, p), 'utf8');

const s = new Suite('expoConfigParity');

// --- app.json ---
const appJson = JSON.parse(readEA('app.json'));
s.eq(appJson.expo.android.package, 'com.truelockmc.streambert', 'android package set');
s.ok(!JSON.stringify(appJson).includes('vercel.app'), 'app.json has no hosted-app dependency');
const plugins = appJson.expo.plugins.map(p => Array.isArray(p) ? p[0] : p);
for (const p of ['./plugins/with-external-player', './plugins/with-dist-assets']) {
  s.ok(plugins.includes(p), `app.json includes ${p}`);
  s.ok(fs.existsSync(path.join(EA, p + '.js')), `plugin file exists: ${p}.js`);
}
s.ok(!plugins.includes('./plugins/with-external-player-native'),
  'dangerous source-copy plugin REMOVED (autolinking replaced it)');
s.ok(plugins.includes('expo-router'), 'expo-router plugin registered');

// --- package.json ---
const pkg = JSON.parse(readEA('package.json'));
s.eq(pkg.dependencies['expo-external-player'], 'file:./modules/expo-external-player', 'native module is a file: dependency (autolinked)');
s.ok(!('eas-cli' in (pkg.devDependencies || {})), 'eas-cli not a project dependency');
s.ok(pkg.dependencies['react-native-webview'], 'react-native-webview pinned');

// --- Kotlin <-> TS contract ---
const kt = readEA('modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/ExternalPlayerModule.kt');
const ts = readEA('modules/expo-external-player/src/index.ts');
const tsxStreambert = readEA('app/streambert.tsx');

s.includes(kt, 'Name("ExpoExternalPlayer")', 'Kotlin registers module name ExpoExternalPlayer');
s.includes(ts, "requireNativeModule('ExpoExternalPlayer')", 'TS requires the same module name');

const ktFns = [...kt.matchAll(/AsyncFunction\("([a-zA-Z]+)"/g)].map(m => m[1]);
for (const fn of ['getInstalledPlayers', 'launchPlayer', 'startProxy', 'stopProxy', 'downloadSubtitle', 'getSubtitleDir', 'fileExists']) {
  s.ok(ktFns.includes(fn), `Kotlin implements AsyncFunction("${fn}")`);
}
const tsCalls = [...ts.matchAll(/ExternalPlayerModule\.([a-zA-Z]+)\(/g)].map(m => m[1]);
for (const call of tsCalls) {
  s.ok(ktFns.includes(call), `TS call ${call}() has a matching Kotlin AsyncFunction`);
}

// --- expo-module.config.json <-> Kotlin class ---
const modCfg = JSON.parse(readEA('modules/expo-external-player/expo-module.config.json'));
// expo-module.config.json MUST use the string FQCN form ("pkg.Class"), not
// {packageName, className} objects — object entries make expo-modules-autolinking
// emit ``[object Object].class`` into ExpoModulesPackageList.java (EAS javac fail).
s.ok(modCfg.android.modules.every(m => typeof m === 'string'), 'config modules are FQCN strings, not objects');
s.ok(modCfg.android.modules.includes('expo.modules.externalplayer.ExternalPlayerModule'),
  'config contains expo.modules.externalplayer.ExternalPlayerModule FQCN');
s.includes(kt, 'package expo.modules.externalplayer', 'Kotlin package declaration matches');

// --- manifest queries <-> Kotlin known packages parity ---
const plugin = readEA('plugins/with-external-player.js');
const pluginPkgs = [...plugin.matchAll(/'([a-z][a-z0-9._]+)'/g)].map(m => m[1]).filter(p => p.includes('.'));
const ktPkgsBlock = kt.split('knownPlayerPackages = listOf(')[1].split(')')[0];
const ktPkgs = [...ktPkgsBlock.matchAll(/"([a-z][a-z0-9._]+)"/g)].map(m => m[1]);
s.ok(ktPkgs.length >= 12, `Kotlin tracks ${ktPkgs.length} known player packages`);
const missingInPlugin = ktPkgs.filter(p => !pluginPkgs.includes(p));
s.eq(missingInPlugin, [], 'every Kotlin-known package declared in manifest <queries> (else getPackageInfo is blocked on Android 11+)');

// --- proxy URL scheme matches between Kotlin localUrl builder and Java parser ---
s.includes(kt, '"http://127.0.0.1:$port/$scheme/$hostPath"', 'Kotlin builds /scheme/host/path proxy URL');
const java = readEA('modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/AndroidProxyServer.java');
s.includes(java, 'scheme + "://" + path.substring(schemeEnd + 1)', 'Java proxy reassembles scheme://host/path (regression-fixed)');

// --- WebView bridge contract ---
const bridge = readEA('app/webviewBridge.js');
s.includes(bridge, "platform: 'android'", 'bridge sets StreambertNative.platform=android');
s.includes(bridge, 'window.electron', 'bridge installs electron shim');
s.includes(bridge, 'onM3u8Found', 'bridge exposes onM3u8Found used by MoviePage/TVPage');
const disp = readEA('app/nativeBridgeDispatcher.js');
const dispCases = [...disp.matchAll(/case '([a-zA-Z]+)'/g)].map(m => m[1]);
const dispExported = [...disp.matchAll(/'([a-zA-Z]+)',?$/gm)].map(m => m[1]);
for (const m of ['getInstalledPlayers', 'launchPlayer', 'startProxy', 'stopProxy', 'downloadSubtitle', 'getSubtitleDir', 'openExternal', 'secureGet', 'secureSet', 'fileExists', 'showNotification']) {
  s.ok(dispCases.includes(m), `dispatcher implements NATIVE_CALL '${m}'`);
}
s.includes(tsxStreambert, 'dispatchNativeCall', 'streambert.tsx wires the dispatcher');
s.includes(tsxStreambert, 'BackHandler', 'streambert.tsx handles Android hardware back');
s.includes(tsxStreambert, 'file:///android_asset/dist/index.html', 'streambert.tsx loads LOCAL packaged frontend');
s.ok(!tsxStreambert.includes('vercel.app'), 'streambert.tsx has NO vercel.app reference');
s.ok(!tsxStreambert.includes('Alert.prompt'), 'streambert.tsx does not use iOS-only Alert.prompt');

// --- frontend wiring ---
const platAndroid = read('src/platform/android/index.js');
s.includes(platAndroid, 'launchInExternalPlayer', 'platform/android uses existing export launchInExternalPlayer');
s.ok(!platAndroid.includes('launchWithExternalPlayer'), 'no import of non-existent launchWithExternalPlayer');
const ab = read('src/utils/externalPlayer/androidBridge.js');
s.includes(ab, 'export function isNativeBridgeAvailable', 'androidBridge exports isNativeBridgeAvailable');

// --- dist packaged assets mirror current build ---
const distIndex = path.join(EA, 'assets/dist/index.html');
s.ok(fs.existsSync(distIndex), 'expo-app/assets/dist/index.html exists (run scripts/sync_frontend.sh)');
const rootDist = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
const eaDist = fs.existsSync(distIndex) ? fs.readFileSync(distIndex, 'utf8') : '';
s.ok(rootDist === eaDist, 'expo-app/assets/dist is in sync with root dist build');

// Regression trap for EAS gradle failure (build c0eace4f, 2026-09-24):
// bare `Node` identifier (resolves to groovy class) instead of "node"
// string in module build.gradle -> "Cannot run program \"class groovy.util.Node\""
{
  const mg = fs.readFileSync(path.join(EA, 'modules/expo-external-player/android/build.gradle'), 'utf8');
  s.ok(!/\[Node,\s*"--print"/.test(mg), 'module build.gradle uses "node" string, not bare Node identifier');
  s.ok(mg.includes('["node", "--print"'), 'module build.gradle has correct ["node", ...] exec form');
}

const { status, line, results } = s.summary();
console.log(line);
if (status === 'FAIL') console.log(results.filter(r => r.includes('FAIL')).join('\n'));
process.exit(status === 'FAIL' ? 1 : 0);
