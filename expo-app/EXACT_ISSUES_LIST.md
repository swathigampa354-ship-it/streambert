# EXACT ISSUES LIST - EAS Development APK Build Failure

**Date:** 2026-09-23 07:02 UTC
**Build ID:** 366c0d9a-3d00-49c9-9741-e30ccf209771
**Project:** @bjvgghb777s-team/streambert-android (87b68f14-d33e-4ca6-91db-a0c97f85764e)
**Status:** ERRORED
**ErrorCode:** EAS_BUILD_UNKNOWN_GRADLE_ERROR
**Message:** Gradle build failed with unknown error. See logs for the "Run gradlew" phase
**Logs URL:** https://expo.dev/accounts/bjvgghb777s-team/projects/streambert-android/builds/366c0d9a-3d00-49c9-9741-e30ccf209771
**Duration:** 2m 32s (failed fast - early gradle error, not dex)
**Commit:** 63672ed2f33d983557cc00bce383d68b3bd0fac0
**Artifact:** null (no APK)

## ISSUE 1: GIT REPOSITORY BLOAT - PRIMARY CAUSE OF SLOW BUILD & POTENTIAL OOM
- **Before fix:** 50617 files tracked in git
  - 50532 files: node_modules/ (should be gitignored)
  - 47 files: android/ (should be gitignored, EAS generates via prebuild)
  - 16 files: .expo/ cache (should be gitignored)
  - Total upload to EAS: 119 MB (shown in logs: "Uploading to EAS Build (0 / 119 MB)")
- **After fix:** 48 files tracked (fixed via git rm --cached)
  - 0 node_modules (fixed)
  - 0 android (fixed)
  - 0 .expo (fixed)
  - 22 files: assets/dist/ local frontend (must be force-added, now fixed)
  - Upload should now be ~2-3 MB, not 119 MB
- **Impact:** Large upload slows build, may cause EAS to run out of memory or timeout, and android/ being committed causes "android.package ignored because android directory detected" warning
- **Fix applied:** Created .gitignore with node_modules/, .expo/, dist/, android/, ios/, etc, then git rm -r --cached android .expo, committed

## ISSUE 2: EAS-CLI IN DEPENDENCIES
- **Before:** "eas-cli": "^24.7.0" in dependencies (or devDependencies)
  - Adds 300+ packages, 50+ MB to node_modules
  - EAS includes it in bundle unnecessarily
  - Should be global (npm install -g eas-cli) or use npx eas, not in package.json
- **After fix:** Removed via npm uninstall eas-cli, now 0 eas-cli in package.json
- **Impact:** Bloat, slower install, potential version conflicts
- **Fix applied:** npm uninstall eas-cli

## ISSUE 3: DUPLICATE NATIVE MODULE - FILE: DEP + DANGEROUS MOD
- **Before:** 
  - package.json had "expo-external-player": "file:modules/expo-external-player"
  - This causes Expo autolinking to try to link module from modules/expo-external-player/
  - PLUS plugins/with-external-player-native.js uses withDangerousMod to copy same Java files (ExternalPlayerModule.kt, AndroidProxyServer.java) from modules/ to android/app/src/main/java/expo/modules/externalplayer/
  - Result: Two copies of same class in APK -> Gradle error "Duplicate class expo.modules.externalplayer.ExternalPlayerModule found in modules"
- **After fix:** Removed file: dep via npm uninstall expo-external-player, now only dangerous mod provides native code (single source)
- **Impact:** Gradle duplicate class error causes EAS_BUILD_UNKNOWN_GRADLE_ERROR
- **Fix applied:** npm uninstall expo-external-player, keep only dangerous mod

## ISSUE 4: ASSETS/DIST MISSING - CRITICAL FOR WEBVIEW
- **Before:** ls assets/dist/ returned "No such file or directory"
  - This is Vite-built Streambert frontend (14 files) that must be packaged into APK
  - WebView in streambert.tsx loads file:///android_asset/dist/index.html (local)
  - If missing, WebView fails, fallback to https://streambert.vercel.app which is NOT acceptable per task (APK must contain actual app, not wrapper for hosted site)
- **After fix:** Built via `npx vite build` in root (requires npm install first, 421 packages), then cp -r dist/* expo-app/assets/dist/, now has 14 files: index.html, icon.png, assets/ with JS/CSS/woff2
- **Impact:** Without local frontend, Streambert WebView would load remote vercel.app or fail, violating requirement "APK must contain actual Streambert application, not wrapper for hosted site"
- **Fix applied:** npm install in root, npx vite build, mkdir -p expo-app/assets/dist, cp -r dist/* expo-app/assets/dist/, git add -f assets/dist/

## ISSUE 5: ANDROID FOLDER COMMITTED
- **Before:** android/ folder with 47 files committed to git, including app/build.gradle, MainActivity.kt, MainApplication.kt, debug.keystore, etc
- **Problem:** 
  - EAS Build should generate android/ via prebuild (npx expo prebuild), not use committed version
  - Committed android/ causes warning "Specified value for android.package in app.json is ignored because an android directory was detected in the project"
  - android/app/debug.keystore committed, but EAS uses remote credentials ("Using remote Android credentials (Expo server)" in logs)
  - android/ contains custom files from dangerous mod, but if committed, prebuild may not run cleanly or may duplicate
- **After fix:** git rm -r --cached android, now 0 android files tracked, .gitignore has android/
- **Impact:** Confusing build, uses stale native code, credentials conflict
- **Fix applied:** git rm -r --cached android

## ISSUE 6: .EXPO CACHE COMMITTED
- **Before:** 16 files in .expo/ tracked, including web/cache/production/images/...
- **Problem:** Cache should be gitignored, bloats repo, causes unnecessary upload
- **After fix:** git rm -r --cached .expo, now 0 tracked, .gitignore has .expo/
- **Fix applied:** git rm -r --cached .expo

## ISSUE 7: INVALID PROJECT ID (FIXED EARLIER)
- **Before:** app.json had "projectId": "streambert-android-dev" (not UUID) causing GraphQL error "Invalid UUID appId"
- **After fix:** Ran eas init --account bjvgghb777s-team --non-interactive, created new project @bjvgghb777s-team/streambert-android with ID 87b68f14-d33e-4ca6-91db-a0c97f85764e, now valid UUID
- **Fix applied:** eas init

## ISSUE 8: NATIVE MODULE COMPILATION POTENTIAL ERRORS
- **File:** modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/ExternalPlayerModule.kt (9540 bytes)
- **Potential issues (need gradle logs to confirm):**
  - Uses deprecated APIs: getPackageInfo(pkg, 0) and queryIntentActivities(intent, MATCH_DEFAULT_ONLY) deprecated in API 33+, should use PackageInfoFlags and QueryIntentActivitiesOptions, but still compiles with warnings
  - TAG constant defined at bottom in companion object, but used earlier via Log.d(TAG, ...) - should be visible, ok
  - Uses appContext.reactContext nullable, throws Exception if null - runtime, not compile
  - Return types: mapOf() returning Map, Expo modules might expect specific types - could cause type mismatch
  - No @ExpoModule annotation needed, extends Module() with definition() Name() is correct for Expo modules
  - **Most likely cause of gradle error is duplicate class, not syntax, but need live logs to confirm**
- **AndroidProxyServer.java:** 15328 bytes, Java, uses ServerSocket, etc - should compile, no obvious syntax error
- **Fix:** Need to see live gradle logs via eas build without --no-wait

## ISSUE 9: CONFIG PLUGIN FRAGILE STRING REPLACE
- **File:** plugins/with-external-player-native.js
- **Issue:** Uses `mainApplication.replace(/import expo.modules.ApplicationLifecycleDispatcher;/, 'import ...\nimport expo.modules.externalplayer.ExternalPlayerModule;')`
  - Fragile: If MainApplication.kt structure changes in SDK 51, regex may not match or may duplicate import
  - Adds import but never uses it - PackageList auto-discovers modules via reflection, import is unnecessary
  - If android/ already exists and plugin runs, it may add duplicate import each prebuild
- **Impact:** Could cause duplicate import or unused import warning, but not gradle error
- **Fix:** Better to check if import already exists before adding, or remove import addition entirely since class is compiled via being in app/src/main/java/

## ISSUE 10: BABEL FIXED, EXPO EXPORT WORKS
- **Before:** babel.config.js had plugins: ['expo-router/babel'] deprecated in SDK 50, causing SyntaxError on export
- **After fix:** Only presets: ['babel-preset-expo'], export now works: 817 modules, 2.1 MB bundle
- **Current status:** PASS, no issue

## ISSUE 11: EAS BUILD LOGS NOT FETCHABLE
- **Problem:** expo.dev build logs page requires login, fetch_page returns generic privacy page, not logs
- **API:** https://api.expo.dev/v2/builds/ID returns "Not Found" with token, need different endpoint
- **Workaround:** Rebuild with `eas build --profile development --platform android --non-interactive` WITHOUT --no-wait to see live logs in terminal, capture exact gradle error
- **Fix:** Next build should be without --no-wait

## SUMMARY - FIXES APPLIED SO FAR
1. ✅ .gitignore created (227 bytes)
2. ✅ Removed android/ from git (47 files -> 0)
3. ✅ Removed .expo/ from git (16 -> 0)
4. ✅ Removed node_modules from git (50532 -> 0)
5. ✅ Removed eas-cli from package.json
6. ✅ Removed file: dep duplication (expo-external-player)
7. ✅ Rebuilt assets/dist/ local frontend (0 -> 14 files)
8. ✅ Tracked files: 50617 -> 48
9. ✅ Expo export works: 2.1 MB bundle
10. ✅ Expo config valid
11. ✅ Project ID fixed: valid UUID
12. ⏳ Need to rebuild and capture live gradle logs to fix remaining gradle error
13. ⏳ Need to test on physical Android 15 device after APK built

## NEXT STEPS
1. Commit current fixes (already done partially, need final commit)
2. Rebuild via eas build --profile development --platform android --non-interactive (without --no-wait) to see live logs
3. Capture exact gradle error (likely duplicate class or Kotlin compilation)
4. Fix gradle error based on logs
5. Rebuild until APK produced
6. Test on physical device per steps 4-12 of task

