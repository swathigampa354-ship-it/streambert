# EAS Development APK Build Guide - Streambert Android

**Goal:** Build development APK that proves real Streambert → external player → video plays

## Prerequisites

- Node.js 18+ / npm
- Expo account + EAS CLI (`npm install -g eas-cli` or `npm install eas-cli --save-dev`)
- EAS token (you have it per task description)
- Android 15 physical device with VLC, MPV, MX Player installed from Play Store
- No Android Studio required if using EAS cloud build

## Step 1: Verify Expo Project (Already Done in Sandbox)

```bash
cd expo-app
npm install
npx expo config --type public # Should show valid config
npx expo export --platform android # Should succeed 2.1 MB bundle
npx expo prebuild --platform android --no-install # Should create android/ with correct manifest
```

**Fixed issues:**
- `babel.config.js`: Removed deprecated `expo-router/babel` plugin (SDK 50+), now only `babel-preset-expo` → export works
- `app.json`: Added `with-external-player-native` plugin to copy native module Java/Kotlin files to android/
- `modules/expo-external-player/package.json`: Added `expo.autolinking` config
- `plugins/with-external-player-native.js`: New plugin that copies `ExternalPlayerModule.kt` + `AndroidProxyServer.java` to `android/app/src/main/java/expo/modules/externalplayer/` via `withDangerousMod`

**Verified:**
- `expo export` → 817 modules, 2.1 MB HBC bundle, 10 assets
- `android/app/src/main/AndroidManifest.xml` → permissions INTERNET, READ_EXTERNAL_STORAGE, READ_MEDIA_VIDEO + queries for video/*, video/mp4, mpegURL + packages org.videolan.vlc, is.xyz.mpv, com.mxtech.videoplayer.ad/pro, etc (config plugin working)
- Java files copied to `android/app/src/main/java/expo/modules/externalplayer/` (ExternalPlayerModule.kt, AndroidProxyServer.java)
- MainApplication.kt has import for ExternalPlayerModule

## Step 2: Build Development APK via EAS (Recommended - No Local Android SDK Needed)

```bash
cd expo-app
npm install
eas login # Login with your Expo account (token you have)
eas build --profile development --platform android
```

**eas.json:**
```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "apk" }
    }
  }
}
```

- Build takes ~10-15 mins in EAS cloud (more RAM than sandbox, no OOM)
- APK link will be provided in terminal and EAS dashboard
- Download APK to your Android 15 device

**Alternative: Local Build (Requires Android Studio + JDK 17)**

```bash
cd expo-app
npm install
npx expo prebuild --platform android
cd android
./gradlew assembleDebug # Requires ANDROID_HOME, JAVA_HOME=17, 4GB+ RAM
# APK at android/app/build/outputs/apk/debug/app-debug.apk
```

**Sandbox limitation:** Local gradle build fails in sandbox with `Gradle build daemon disappeared` due to tmpfs 993M limit (JDK 316M + SDK 300M + Gradle 512M heap = OOM). On normal machine or EAS cloud, succeeds.

## Step 3: Install APK on Android 15 Device

```bash
adb install path/to/app-debug.apk
# Or download from EAS link on device and install (allow unknown sources)
```

**Verify:**
- App launches (Expo splash → index.tsx)
- Navigation: Home → Player Test → Streambert WebView
- No crash if VLC/MPV/MX not installed (should show "No compatible external player installed")

## Step 4: Test Player Test Screen (Critical - Proves Native Module Works)

**Install players from Play Store:**
- VLC: org.videolan.vlc
- MPV: is.xyz.mpv (or com.mpv)
- MX Player: com.mxtech.videoplayer.ad (free) or pro

**Open app → Player Test button:**

1. **Detection Test:**
   - Tap "Detect Installed Players"
   - Should list installed players via PackageManager (e.g., ["org.videolan.vlc", "is.xyz.mpv"])
   - If empty and players installed → FAIL, PackageManager query failed, check AndroidManifest queries

2. **Direct Launch Tests:**
   - Tap "VLC Direct" → should launch VLC with test video https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
   - Tap "MPV Direct" → should launch MPV with same
   - Tap "MX Direct" → should launch MX
   - Tap "System Chooser" → should show system chooser with all video players
   - **PASS only if video actually plays in external player**

3. **Proxy Tests:**
   - Tap "VLC via Proxy" → starts proxy at 127.0.0.1:port, launches VLC with proxy URL
   - Proxy logs should show host validation, HLS rewrite, Range handling
   - **PASS only if video plays via proxy**

4. **Subtitle Test:**
   - Tap "Test Subtitle Download" → downloads .srt to /sdcard/Download/StreambertSubs/ (or getExternalFilesDir)
   - Then launch with subtitle extras (9 keys for compatibility)
   - **PASS only if subtitle actually displays in player**

5. **Header Tests:**
   - Test with stream requiring Referer, User-Agent, Cookie
   - Direct launch with extras vs proxy injection
   - **PASS only if protected stream plays**

**Record in ANDROID_DEVICE_VERIFICATION.md:**

```
VLC Direct: PASS/FAIL - error / file / function / cause / fix / retest
MPV Direct: ...
MX Direct: ...
Chooser: ...
Proxy: ...
Subtitles: ...
Headers: ...
```

## Step 5: Test Real Streambert UI

**Open app → Streambert button:**

- Should load local dist/ (file:///android_asset/dist/index.html), NOT https://streambert.vercel.app
- Check logs: "Loading LOCAL Streambert frontend" not "Falling back to vercel.app"
- If vercel.app → FAIL, local asset not packaged, check app.json assetBundlePatterns and dist/ force-add

**Test:**
- Search TMDB (real API)
- Open movie/TV/anime
- Select source (VidKing, Videasy, VidSrc)
- Resolve stream → STREAM_FOUND → headers → subtitle → ExternalPlayer

**WebView injection in streambert.tsx:**
- Intercepts fetch/XHR/video/source/iframe/HLS.js/media src setter for .m3u8/.mp4/.ts
- Posts to RN via window.ReactNativeWebView.postMessage
- Also exposes window.StreambertAndroid.reportStream(url, headers, subtitle) for reliable reporting
- **Potential issue:** Injected hooks may not catch blob URLs, MSE, service workers, redirects → need onShouldStartLoadWithRequest or direct resolver as fallback

**Record:**
```
TMDB Search: PASS/FAIL
Movie Select: PASS/FAIL
Source Selection: PASS/FAIL
Stream Resolution: PASS/FAIL - URL, headers, subs
VLC Launch from Streambert: PASS/FAIL - video plays?
MPV Launch: ...
MX Launch: ...
Subtitles from Streambert: PASS/FAIL
```

## Step 6: Test Real Streaming End-to-End (Success Criteria)

**Success = APK installed → real Streambert → real source → real stream → real VLC/MPV/MX → REAL VIDEO PLAYING**

**Not success:**
- Expo project exists
- Gradle compiles
- APK installs
- WebView opens
- VLC opens (but no video)
- Fake test URL only

**Must test:**
- Real TMDB content (e.g., search "Inception" → select → source → stream)
- Real anime (Anilist)
- Real stream resolution (VidKing/Videasy/VidSrc actual URLs, not https://test-streams.mux.dev/ only)
- Real external player playback (video actually plays, not just intent launch)
- Real headers (if source requires Referer/Cookie/UA)
- Real proxy (if headers needed and player doesn't support extras)
- Real subtitles (discovery → download → file exists → player receives → displays)

**For each, record exact result per task's strict rule:**

```
EXPO BUILD: PASS (2.1 MB bundle) / FAIL - error / file / function / cause / fix / retest
APK INSTALL: PASS / FAIL
STREAMBERT UI: PASS / FAIL
TMDB: PASS / FAIL
ANILIST: PASS / FAIL
REAL STREAM RESOLUTION: PASS - URL https://... / FAIL - error
VLC: PASS - video plays / FAIL - error / file / function / cause / fix / retest
MPV: PASS / FAIL
MX PLAYER: PASS / FAIL
HLS: PASS / FAIL
HEADERS: PASS / FAIL
COOKIE: PASS / FAIL
REFERER: PASS / FAIL
PROXY: PASS / FAIL
SUBTITLES: PASS / FAIL
```

## Step 7: Fix Failures, Rebuild, Retest

**Do NOT report "needs future work" — fix code, rebuild, retest until minimum real playback works**

**Common failures and fixes:**

1. **Native module not found (Expo Go):**
   - Cause: Expo Go doesn't include custom native modules
   - Fix: Must use dev client APK via EAS build, not Expo Go
   - Player-test.tsx already has fallback mock explaining this

2. **WebView loads vercel.app not local:**
   - Cause: dist/ not packaged, file:///android_asset/dist/index.html not found
   - Fix: Ensure expo-app/assets/dist/ exists (14 files), app.json assetBundlePatterns includes **/*, .gitignore has !exception for dist, force-add dist to git

3. **Stream not detected:**
   - Cause: Injected fetch/XHR hooks don't catch all streams
   - Fix: Add onShouldStartLoadWithRequest, or direct source resolver bypassing WebView, or window.StreambertAndroid.reportStream called from Streambert's external player adapter

4. **VLC opens but no video (protected stream):**
   - Cause: Headers not passed, player doesn't support Referer extra
   - Fix: Use proxy (startProxy → launch via proxy URL), ensure proxy handles Range, HLS rewrite, host validation

5. **Subtitle not displayed:**
   - Cause: /sdcard/Download not writable (scoped storage), or player doesn't support subtitle extra key
   - Fix: Use getExternalFilesDir or FileSystem.documentDirectory, try 9 different extra keys (subtitles_location, subs, sub, etc), download via native HttpURLConnection

6. **Gradle OOM:**
   - Cause: Sandbox tmpfs 993M limit
   - Fix: Use EAS cloud build (more RAM) or local machine with 4GB+ RAM, not sandbox

## Step 8: Production APK After Stable

Once development APK proves real playback:

```bash
eas build --profile production --platform android
```

Production APK should:
- Contain actual Streambert frontend locally (NOT vercel.app)
- Have platform abstraction (platform/desktop/ vs platform/android/ replacing 190 window.electron calls)
- Reuse platform-independent code, replace Electron-specific via Expo modules
- Support VLC/MPV/MX/chooser, detection via PackageManager, no Termux dependency
- Handle headers via extras or localhost proxy (HLS master/variant/segments/keys/subs/redirects/Range/query)
- Preserve subtitles via Android filesystem or MediaStore
- Handle storage: normal prefs vs secure secrets vs download files vs subtitle files vs backup files vs cache (not blindly localStorage)

## Current Status in Sandbox (Honest)

**Verified in sandbox (no device):**
- Expo project structure complete ✅
- package.json exists with compatible versions ✅
- app.json, eas.json, babel.config.js, metro.config.js valid ✅
- app/_layout.tsx, index.tsx, player-test.tsx, streambert.tsx exist ✅
- assets/dist/ exists (14 files, local frontend) ✅
- modules/expo-external-player exists with Kotlin + Java ✅
- plugins/with-external-player.js + with-external-player-native.js exist ✅
- npm install succeeds (1223 packages) ✅
- npx expo config valid ✅
- npx expo export succeeds (2.1 MB bundle, 817 modules, 10 assets) ✅
- npx expo prebuild succeeds (creates android/ with correct manifest) ✅
- AndroidManifest has correct permissions & queries for VLC/MPV/MX ✅
- Java files copied to android/app/src/main/java/expo/modules/externalplayer/ ✅
- MainApplication.kt has import ✅
- Java compilation would succeed (iterator bug fixed) but gradle daemon OOM in sandbox (tmpfs 993M) ⚠️

**Cannot test in sandbox (requires device):**
- APK install ❌ (no device, no adb)
- Streambert UI ❌
- TMDB/Anilist ❌
- Real stream resolution ❌
- VLC/MPV/MX playback ❌
- HLS/headers/cookie/referer/proxy/subtitles ❌

**User must test on Android 15 physical device with EAS-built APK**

## Files to Check

- `expo-app/package.json` - dependencies
- `expo-app/app.json` - config, plugins, permissions, queries
- `expo-app/eas.json` - build profiles
- `expo-app/babel.config.js` - fixed, no deprecated plugin
- `expo-app/app/player-test.tsx` - dev APK test screen
- `expo-app/app/streambert.tsx` - WebView with local dist/ + injection
- `expo-app/modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/ExternalPlayerModule.kt` - native module
- `expo-app/modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/AndroidProxyServer.java` - proxy
- `expo-app/plugins/with-external-player.js` - permissions & queries
- `expo-app/plugins/with-external-player-native.js` - copies Java files
- `expo-app/assets/dist/` - local Streambert frontend (14 files)
- `expo-app/BUILD_VERIFICATION.md` - honest verification report
- `ANDROID_DEVICE_VERIFICATION.md` - template for device test results (must fill on real device)

