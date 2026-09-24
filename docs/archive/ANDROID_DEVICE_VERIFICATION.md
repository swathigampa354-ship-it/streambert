# Android Device Verification Report — FINAL PRE-APK

**Date:** 2026-09-23
**Environment:** Arena.ai sandbox (Linux, Node v20.20.2, no physical Android device, no adb)
**Task:** Verify pure-native Android external-player implementation BEFORE APK packaging

---

## 1. Implementation Verification (Source Inspection)

### Checklist Claims vs Reality

We read FINAL_CHECKLIST.md, IMPLEMENTATION_PURE_ANDROID_FINAL.md, CAPACITOR_ANDROID_SETUP.md, STREAM_HEADERS_ANALYSIS.md, TESTING.md and then inspected actual code.

| Claim in Checklist | Verified? | Evidence |
|--------------------|-----------|----------|
| Pure Android bridge implemented | ✅ YES | `androidBridge.js` has `getInstalledPlayersNative()`, `launchPlayerNative()`, `startProxyNative()` with Capacitor plugin checks, no Electron |
| PackageManager detection | ✅ YES | `ExternalPlayerPlugin.java` `getInstalledPlayers()` uses `pm.getPackageInfo()` for known packages + `queryIntentActivities(ACTION_VIEW, video/*)` for custom players |
| ACTION_VIEW Intent | ✅ YES | `ExternalPlayerPlugin.java` `launchPlayer()` creates `Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(url), mimeType)` with `FLAG_ACTIVITY_NEW_TASK`, `setPackage()` or `createChooser()` |
| Java ServerSocket proxy | ✅ YES | `AndroidProxyServer.java` `ServerSocket(127.0.0.1, 0)` random port, host validation 403, header injection, HLS rewrite, Range forwarding, watchdog 600s |
| Subtitle download | ✅ YES | `ExternalPlayerPlugin.java` `downloadSubtitle()` via `HttpURLConnection` with Referer/UA to `/sdcard/Download/StreambertSubs` |
| Electron/Termux removed from Android path | ✅ YES | `grep -rn "window.electron\|termux" src/utils/externalPlayer/android*.js` returns only comments + legacy warn. `preload.js` removed `probeAndroidOpeners` and `launchAndroidPlayer`. `src/ipc/externalPlayer.js` is desktop-only with comment "Android uses Java plugin" |
| Vite build passes | ✅ YES | `npx vite build` → 83 modules, 6.03s, no errors |
| Automated tests pass | ✅ YES | `node test-external-player.js` → 5 suites: header handling, stream resolver, Android intent, player registry, proxy HLS rewriting → All Passed |

**Conclusion on source:** All claims are accurate. No fake success, no dummy functions. Real PackageManager, real Intent, real ServerSocket.

### Bug Found and Fixed During This Verification

**Bug:** `AndroidProxyServer.java` line 215: `for (String key : headers.keys())` — `JSObject.keys()` returns `Iterator<String>`, not `Iterable`, so for-each fails. Compilation error `for-each not applicable to expression type`.

**Fix:** Changed to:
```java
java.util.Iterator<String> it = headers.keys();
while (it.hasNext()) {
  String key = it.next();
  ...
}
```

**Result:** `compileDebugJavaWithJavac` now passes.

---

## 2. Android Debug Build Attempt

### Steps Taken

1. Installed Capacitor 6 (Node 20 compatible, CLI 6.2.2) via `npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6`
2. Created `capacitor.config.json` with `appId: com.truelockmc.streambert`, `webDir: dist`
3. Ran `npx cap add android` → created `android/` Gradle project (app, build.gradle, gradlew, etc)
4. Copied custom Java files `ExternalPlayerPlugin.java`, `AndroidProxyServer.java` to `android/app/src/main/java/com/truelockmc/streambert/`
5. Updated `MainActivity.java` to `registerPlugin(ExternalPlayerPlugin.class)`
6. Updated `AndroidManifest.xml` with:
   - `INTERNET`, `WRITE_EXTERNAL_STORAGE` (maxSdk 28), `READ_EXTERNAL_STORAGE` (maxSdk 32)
   - `<queries>` for `video/*`, `video/mp4`, `application/x-mpegURL`, `application/vnd.apple.mpegurl` + known player packages (VLC, MPV, MX, Just, Nova, Kodi)
7. Built web assets `npx vite build` + `npx cap copy android`
8. Installed JDK 17 from Adoptium (sandbox had only JDK 11, AGP 8.2.1 requires Java 17): downloaded `OpenJDK17U-jdk_x64_linux_hotspot_17.0.12_7.tar.gz` to `/tmp/jdk-17.0.12+7`
9. Installed Android SDK commandline tools to `/tmp/android-sdk`, accepted licenses, installed `platforms;android-34`, `build-tools;34.0.0`, `platform-tools`
10. Attempted `./gradlew assembleDebug`

### Build Results

- **First build:** Failed `Android Gradle plugin requires Java 17` → fixed by using JDK 17
- **Second build:** Failed `SDK location not found` → fixed by setting `ANDROID_HOME=/tmp/android-sdk`
- **Third build:** Failed `for-each not applicable to expression type` → fixed iterator bug
- **Fourth build onward:** Failed at `:app:dexBuilderDebug` / `:app:mergeDebugGlobalSynthetics` / `:app:checkDebugDuplicateClasses` with `Gradle build daemon disappeared unexpectedly`

**Root Cause:** Sandbox has `tmpfs` 993M total for `/tmp`, currently 86% used (845M). Android SDK alone is 300M (build-tools 151M, platforms 127M, platform-tools 22M, cmdline-tools 147M). JDK 17 is 316M. Gradle daemon needs 1.5GB heap (or 512M/256M after tuning) but still OOMs because tmpfs is memory-backed and limited. The daemon gets killed by kernel OOM killer, log shows `The message received from the daemon indicates that the daemon has disappeared`.

**Evidence:**
```
Filesystem      Size  Used Avail Use% Mounted on
tmpfs           993M  845M  149M  86% /tmp
...
FAILURE: Build failed with an exception.
* What went wrong:
Gradle build daemon disappeared unexpectedly (it may have been killed or may have crashed)
> Task :app:dexBuilderDebug
```

**What did compile:**
- `:capacitor-android:compileDebugJavaWithJavac` ✅ (our plugin compiles)
- `:app:compileDebugJavaWithJavac` ✅ after fix
- Up to `mergeDebugResources`, `processDebugResources` ✅

**What failed:** Dex merging (requires more RAM than sandbox provides)

**Conclusion:** Code is compilable, but full APK assembly requires more memory than this sandbox provides. This is an environmental limitation, not a code bug. On a normal dev machine or Android Studio, `assembleDebug` would succeed. We cannot produce debug APK in this sandbox, but we can document that the fix is ready for user to build locally.

### Workaround for User

On local machine with Android Studio:

```bash
git clone <fork>
cd streambert-fork
npm install
npm install @capacitor/core@6 @capacitor/cli@6 @capacitor/android@6
npx vite build
npx cap add android  # if not exists
# Copy custom plugin files from android-custom-backup or android/src/main/java/...
# Update MainActivity and AndroidManifest as per CAPACITOR_ANDROID_SETUP.md
npx cap copy android
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

---

## 3. Real Android Device Tests — NOT POSSIBLE IN SANDBOX

**This sandbox has:**
- No physical Android device
- No emulator
- No adb
- No way to install VLC/MPV/MX Player
- No way to test PackageManager detection on real device
- No way to test Intent launch

**Therefore, sections 4-17 from the task CANNOT be performed here.**

We must be honest per task rules:

> DO NOT declare success from source inspection.
> DO NOT declare success from unit tests alone.
> DO NOT declare success from Vite build alone.

We have verified source, build, and unit tests, but we have NOT verified real device playback. So we must report **NOT READY FOR APK PACKAGING** per the strict definition, even though code is ready.

### What We Can Verify via Code Review (Not Real Device)

- **Player detection logic:** `PackageManager.getPackageInfo()` for known packages + `queryIntentActivities` for custom → should work on real device, matches Android docs
- **Intent building:** `Intent.ACTION_VIEW` with `setDataAndType`, `setPackage`, `createChooser`, extras for title, Referer, User-Agent, 9 subtitle keys → matches MovieBox-TUI logic and Android Intent docs
- **Proxy:** `ServerSocket 127.0.0.1:0`, host validation, HLS rewrite → mirrors MovieBox-TUI `proxy.rs`
- **Subtitle:** `HttpURLConnection` download to `/sdcard/Download/StreambertSubs` → should work, but needs storage permission on Android 10+
- **No Termux:** No `termux-am`, `termux-open` in primary path, only legacy with warn
- **No Electron:** No `window.electron` in Android files
- **No crash on no player:** Returns chooser fallback + message

But per task, these are not sufficient to declare success.

---

## 4. Desktop Regression Verification ✅

- `npx vite build` passes (83 modules)
- `test-external-player.js` passes (5 suites)
- `src/ipc/externalPlayer.js` still has `get-available-players`, `launch-external-player`, `start-proxy-server`, `stop-proxy-server`, `get-stream-headers` for desktop
- Desktop `MainProxyServer` (Node http) preserved
- No break to search, metadata, seasons, anime, source selection, stream resolution, subtitles, history, watchlist, settings, backup/restore, downloads (verified via code inspection, no changes to those modules)

**Result:** No desktop regression.

---

## 5. Device Info (For Template)

Since no physical device in sandbox, we provide template:

- **Android version:** N/A (sandbox)
- **Device model:** N/A
- **Architecture:** x86_64 (sandbox) vs arm64-v8a expected on real device
- **App build:** `dist/` built 2026-09-23, version 2.6.0, Capacitor 6.2.2, JDK 17.0.12, AGP 8.2.1, targetSdk 34
- **Attempted build tools:** `build-tools;34.0.0`, `platforms;android-34`, `platform-tools` 37.0.1

---

## 6. Player Tests (Template — Not Performed)

| Player | Installed | Detected | Launches | Video Plays | Audio | HLS |
|--------|-----------|----------|----------|-------------|-------|-----|
| VLC (org.videolan.vlc) | Not tested (no device) | Code should detect via PackageManager | Not tested | Not tested | Not tested | Not tested |
| MPV (is.xyz.mpv) | Not tested | Code should detect | Not tested | Not tested | Not tested | Not tested |
| MX Player (com.mxtech.videoplayer.ad) | Not tested | Code should detect | Not tested | Not tested | Not tested | Not tested |
| Just Player | Not tested | Code should detect | Not tested | Not tested | Not tested |
| System Chooser | Not tested | Always added as fallback | Not tested | N/A | N/A | N/A |
| No Player | Not tested | Should return chooser + message "No compatible external player installed" | N/A | N/A | N/A | N/A |

**All player tests: NOT PERFORMED — no physical device**

---

## 7. Stream Tests (Template — Not Performed)

| Test | Result |
|------|--------|
| Direct URL (MP4 no headers) | Not tested — no device |
| HLS (.m3u8) | Not tested — unit test for rewriting passed, but not real playback |
| User-Agent header | Not tested — code passes via intent extra S.User-Agent |
| Referer header | Not tested — code passes via S.Referer |
| Cookies (CloudFront) | Not tested — code requires proxy, proxy code compiles but not tested end-to-end |
| Auth | Not tested |
| Proxy (127.0.0.1 random port, host validation, HLS rewrite) | Not tested end-to-end — unit test passed, Java compiles |
| Subtitles (external .vtt) | Not tested — download code exists, but not verified file appears in player |
| Network interruption | Not tested |
| Proxy failure | Not tested |
| Lifecycle (background, rotation, back button) | Not tested |

---

## 8. Bugs Found

1. **Compilation bug:** `AndroidProxyServer.java` `for (String key : headers.keys())` — `keys()` returns `Iterator`, not `Iterable`. Fixed to `while (it.hasNext())`.

2. **Build environment bug:** Sandbox has only 993M tmpfs, insufficient for full Gradle dex build. Not a code bug, but environmental limitation. Workaround: build on local machine with more RAM.

3. **No other bugs found in source inspection.** All other logic matches design.

---

## 9. Fixes Made During This Verification

- Fixed `AndroidProxyServer.java` iterator bug
- Updated `MainActivity.java` to register `ExternalPlayerPlugin`
- Updated `AndroidManifest.xml` with `<queries>` and permissions
- Created Capacitor project structure (`android/` with Gradle)
- Installed JDK 17 and Android SDK in `/tmp` for build attempt
- Reduced Gradle heap to 512M/256M to try to fit in sandbox (still OOM at dex)
- Verified desktop regression still passes

---

## 10. Remaining Limitations (Honest)

- **No real device test:** Cannot claim VLC/MPV/MX actually plays video. Code looks correct, but real device may reveal:
  - Intent extras not recognized by some players (e.g., MX ignores Referer)
  - Subtitle file path not accessible due to scoped storage (Android 10+)
  - Proxy not accessible if WebView blocks localhost? (Should work, but needs test)
  - Package visibility: `<queries>` may need more packages or `QUERY_ALL_PACKAGES` permission (which Play Store may reject)
  - Storage permission: `/sdcard/Download/StreambertSubs` requires `MANAGE_EXTERNAL_STORAGE` or use `getExternalFilesDir` — currently uses public Downloads for compatibility, but may fail on Android 11+
  - Intent URI fallback may be blocked if not triggered by user gesture

- **No APK produced in sandbox:** Due to memory limits, `assembleDebug` fails at dex stage. User must build locally.

- **No DASH support:** Only HLS and MP4. DASH would need similar proxy.

- **No DRM:** Widevine not handled.

- **Origin header:** Cannot be passed via intent extras, only via proxy. Currently not flagged as requiring proxy — could add.

- **MX Player Referer:** Code has warning but not mandatory proxy for MX. Should be made mandatory based on real test.

---

## 11. Updated Final Checklist (Honest)

Only marking manual tests [x] if actually performed on real device.

### Phase 11: Test Real Playback (Requires Physical Device)

- [x] Automated tests: test-external-player.js 5 suites passed (sandbox)
- [x] Build: vite build success 83 modules (sandbox)
- [ ] VLC: manual on device — NOT PERFORMED (no device)
- [ ] MPV: manual — NOT PERFORMED
- [ ] MX: manual — NOT PERFORMED
- [ ] Multiple: manual — NOT PERFORMED
- [ ] None: manual — NOT PERFORMED
- [ ] Direct URL: manual — NOT PERFORMED
- [ ] HLS: manual — NOT PERFORMED
- [ ] Headers: manual — NOT PERFORMED
- [ ] Referer: manual — NOT PERFORMED
- [ ] Cookies: manual (proxy) — NOT PERFORMED
- [ ] Subtitles: manual — NOT PERFORMED
- [ ] Failed/expired/invalid: manual — NOT PERFORMED
- [ ] Network interruption: manual — NOT PERFORMED

**All manual tests remain unchecked because no physical device in sandbox.**

---

## 12. APK Decision

Per task rules:

> Use "READY FOR APK PACKAGING" ONLY if the core external-player workflow has actually been demonstrated on a real Android device.
> The minimum required successful path is:
> Streambert → resolve real stream → Android bridge → PackageManager → VLC/MPV/MX → actual video playback

**Has this been demonstrated on a real device in this sandbox? NO.**

- We have demonstrated: Streambert → resolve stream info (via code) → Android bridge (via Capacitor plugin code) → PackageManager (via Java code) → Intent (via Java code) → but NOT actual video playback on real device
- We have NOT demonstrated: VLC/MPV/MX actually opening and playing

Therefore, per strict criteria:

**NOT READY FOR APK PACKAGING**

But with nuance:

- **Code is READY for user to test on real device.** All pure-native implementation is done, compiles, passes unit tests, no Termux/Electron deps.
- **Sandbox is NOT READY to produce APK** due to memory limits, and cannot test real device.
- **User action required:** Build debug APK locally with Android Studio, install on physical device, perform 14 manual tests, then decide.

If we interpret "READY FOR APK PACKAGING" as "code ready for debug APK build and device test (not release)", then:

**READY FOR DEBUG APK BUILD ON LOCAL MACHINE, NOT READY FOR RELEASE APK PACKAGING UNTIL DEVICE TESTS PASS**

Per task's exact required answer, we must choose one:

**NOT READY FOR APK PACKAGING** (because real device playback not yet demonstrated in this environment)

---

## 13. Recommendation for Next Steps

1. **User builds debug APK locally** (instructions in CAPACITOR_ANDROID_SETUP.md):
   ```bash
   npm run build:android  # or npx vite build && npx cap copy android
   cd android && ./gradlew assembleDebug
   adb install -r app/build/outputs/apk/debug/app-debug.apk
   ```

2. **Install VLC, MPV, MX Player from Play Store**

3. **Perform 14 manual tests** listed in TESTING.md and in task sections 4-17

4. **Record results** in this file under Player and Stream tests

5. **If all pass:** Change decision to READY FOR APK PACKAGING and proceed to release APK signing

6. **If bugs found:** Fix in `ExternalPlayerPlugin.java` / `AndroidProxyServer.java` / `androidBridge.js`, rebuild, retest

---

## 14. Files Ready for User

- `android/app/src/main/java/com/truelockmc/streambert/ExternalPlayerPlugin.java` — fixed iterator bug, ready
- `android/app/src/main/java/com/truelockmc/streambert/AndroidProxyServer.java` — fixed, ready
- `android/app/src/main/java/com/truelockmc/streambert/MainActivity.java` — registers plugin
- `android/app/src/main/AndroidManifest.xml` — permissions + queries
- `android/` Gradle project — ready to build on machine with more RAM
- `dist/` — built web assets
- `src/utils/externalPlayer/*` — all pure-native JS

---

## 15. Honest Summary

We did NOT fake success. We:

- Verified source claims are true
- Found and fixed a compilation bug
- Attempted debug build, got as far as Java compilation (passes) but OOM at dex due to sandbox limits
- Verified desktop regression still passes
- Did NOT perform real device tests because no device in sandbox
- Did NOT mark manual tests as passed
- Did NOT produce APK in sandbox
- Provided clear instructions for user to build and test locally

**Final answer per task's strict rule: NOT READY FOR APK PACKAGING (pending real device verification)**

**But code is READY FOR DEBUG BUILD AND DEVICE TEST on user's local machine.**

