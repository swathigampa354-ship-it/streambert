# Android 15 Physical Device Verification - REAL RESULTS ONLY

**Date:** 2026-09-23
**Device:** [e.g., Pixel 8 Android 15]
**APK:** [EAS build link or local path]
**Players Installed:** VLC [version], MPV [version], MX Player [version]

## Instructions
Per task STEP 12: REPORT ONLY ACTUAL RESULTS, no fake success.
For every PASS/FAIL, record exact error/file/function/cause/fix/retest.
Success = Install APK -> Open Streambert -> Search real content -> Select real movie/show/anime -> Resolve real source -> Launch real VLC/MPV/MX -> REAL VIDEO PLAYING

## STEP 2 - EXPO BUILD

```
EXPO BUILD: PASS - npx expo export succeeded 2.1 MB bundle 817 modules, prebuild created android/ with correct manifest
Evidence: dist/_expo/static/js/android/entry-*.hbc 2.1 MB, android/app/src/main/AndroidManifest.xml has queries for vlc/mpv/mx
```

## STEP 3 - APK INSTALL

```
APK INSTALL: [PASS/FAIL] - [exact result]
Error: [if FAIL, exact error message]
File: [file where error occurs]
Function: [function]
Cause: [why]
Fix: [what fix applied]
Retest: [result after fix]
```

## STEP 4 - STREAMBERT UI

```
STREAMBERT UI: [PASS/FAIL]
Loads from: file:///android_asset/dist/index.html or https://streambert.vercel.app ?
If vercel.app -> FAIL, local asset not packaged
TMDB Search: [PASS/FAIL] - search "Inception" -> results?
Movie Select: [PASS/FAIL]
Source Selection: [PASS/FAIL] - VidKing/Videasy/VidSrc visible?
```

## STEP 5-7 - REAL STREAMING + VLC/MPV/MX

```
REAL STREAM RESOLUTION: [PASS/FAIL]
URL: [actual resolved stream URL, e.g., https://.../master.m3u8]
Headers: [Referer, UA, Cookie, etc]
Subtitle: [URL if any]

VLC Direct: [PASS/FAIL] - video actually plays?
Error: [exact]
File: expo-app/modules/expo-external-player/android/src/main/java/expo/modules/externalplayer/ExternalPlayerModule.kt
Function: launchPlayer
Cause: 
Fix:
Retest:

MPV Direct: [PASS/FAIL] - video plays?

MX PLAYER Direct: [PASS/FAIL] - video plays?

System Chooser: [PASS/FAIL] - shows all players?

VLC via Proxy: [PASS/FAIL] - video plays via 127.0.0.1:port proxy?

MPV via Proxy: [PASS/FAIL]

MX via Proxy: [PASS/FAIL]
```

## STEP 8 - PROXY

```
PROXY: [PASS/FAIL]
Test: Stream requiring headers (Cookie/Auth/Referer)
Direct with extras: [PASS/FAIL] - does player support Referer extra?
Via proxy: [PASS/FAIL] - proxy injects headers, HLS rewrite, Range, watchdog?
HLS master: [PASS/FAIL] - proxy rewrites segment.ts to http://127.0.0.1:port/https/host/segment.ts?
HLS variant: [PASS/FAIL]
Segments: [PASS/FAIL]
Keys: [PASS/FAIL] - EXT-X-KEY URI rewritten?
Subs: [PASS/FAIL]
Redirects: [PASS/FAIL]
Range: [PASS/FAIL] - seeking works?
Query params: [PASS/FAIL]
Relative/absolute: [PASS/FAIL]
Streaming without loading entire file into RAM: [PASS/FAIL]
```

## STEP 9 - SUBTITLES

```
SUBTITLES: [PASS/FAIL]
Discovery: [PASS/FAIL] - subtitle URL found?
Download: [PASS/FAIL] - file exists at /sdcard/Download/StreambertSubs/ or getExternalFilesDir?
File exists: [PASS/FAIL] - check via file manager
Player receives: [PASS/FAIL] - intent extras contain subtitle path? (9 keys: subtitles_location, subs, sub, etc)
Actually displays: [PASS/FAIL] - subtitle visible in VLC/MPV/MX?
VLC subs: [PASS/FAIL]
MPV subs: [PASS/FAIL]
MX subs: [PASS/FAIL]
```

## STEP 10 - STREAM SOURCES

```
VidSrc: [PASS/FAIL] - real movie via vsembed.su?
Videasy: [PASS/FAIL] - real movie via player.videasy.to?
Vidking: [PASS/FAIL] - real movie via vidking.net?
AllManga/anime: [PASS/FAIL] - anime source?
Fake test URL only: [FAIL if only test-streams.mux.dev, must test real sources]
```

## STEP 11 - FIX FAILURES

```
For every FAIL above, fix code, rebuild via eas build --profile development --platform android, retest, record fix and retest result.
Do NOT report "needs future work".
```

## STEP 12 - FINAL REPORT

```
EXPO BUILD: PASS/FAIL
APK INSTALL: PASS/FAIL
STREAMBERT UI: PASS/FAIL
TMDB: PASS/FAIL
ANILIST: PASS/FAIL
REAL STREAM RESOLUTION: PASS/FAIL - URL
VLC: PASS/FAIL - video plays? error/file/function/cause/fix/retest
MPV: PASS/FAIL
MX PLAYER: PASS/FAIL
HLS: PASS/FAIL
HEADERS: PASS/FAIL
COOKIE: PASS/FAIL
REFERER: PASS/FAIL
PROXY: PASS/FAIL
SUBTITLES: PASS/FAIL

Success = APK installed -> real Streambert -> real source -> real stream -> real VLC/MPV/MX -> REAL VIDEO PLAYING
```

## Current Sandbox Results (No Device)

```
EXPO BUILD: PASS - 2.1 MB bundle, 817 modules, prebuild with correct manifest
APK INSTALL: FAIL - cannot test in sandbox, no device, no adb, requires user's Android 15 device
STREAMBERT UI: FAIL - cannot test, requires device
TMDB: FAIL - cannot test
ANILIST: FAIL - cannot test
REAL STREAM RESOLUTION: FAIL - cannot test, injection in place but need device with real sources
VLC: FAIL - cannot test, code ready but need device with VLC installed
MPV: FAIL - cannot test
MX PLAYER: FAIL - cannot test
HLS: FAIL - cannot test, unit test for HLS rewrite passed but real HLS needs device
HEADERS: FAIL - cannot test
COOKIE: FAIL - cannot test
REFERER: FAIL - cannot test
PROXY: FAIL - cannot test, code exists and compiles, unit test passed, but end-to-end needs device
SUBTITLES: FAIL - cannot test

For every FAIL, exact error: No physical Android device in sandbox, no emulator, no adb, no VLC/MPV/MX installed, cannot test real device behavior. Environmental limitation, not code bug. Code ready for EAS build and device test on user's local machine.

Fixes applied: babel config, iterator bug, vercel.app dependency, missing package.json, duplicate implementations, dist gitignored, native module injection via config plugin

Retest: Expo export PASS, AndroidManifest PASS, Java files copied PASS, but full APK assembly FAIL due to OOM in sandbox tmpfs 993M limit, requires EAS cloud build
```

