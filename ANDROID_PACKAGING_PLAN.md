# Android APK Packaging Plan (Phase 14 - AFTER Source Implementation)

> **IMPORTANT:** Do not start APK packaging until source implementation passes playback tests. This document is the plan for AFTER verification.

## Decision: Capacitor

We choose **Capacitor** over Cordova, React Native, Tauri Mobile because:
- Preserves existing React + Vite frontend (no rewrite)
- Existing `dist/` build works directly
- Plugin ecosystem for AppLauncher, Browser, Filesystem, Preferences
- Easy to add custom native Java plugin for external player
- Officially supported, good docs

Alternatives considered:
- Cordova: older, less maintained
- React Native WebView: would require rewriting UI
- Tauri Mobile: Rust-based, promising but less Android maturity

## Steps

### 1. Initialize Capacitor

```bash
cd /home/user/streambert-fork
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init --web-dir=dist --app-id=com.truelockmc.streambert --app-name=Streambert
npx cap add android
```

### 2. Configure capacitor.config.ts

```ts
import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.truelockmc.streambert',
  appName: 'Streambert',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: true, // allow http://127.0.0.1 proxy
  },
  plugins: {
    AppLauncher: {},
    Browser: {},
  },
};

export default config;
```

### 3. Create Custom Native Plugin: ExternalPlayer

File: `android/app/src/main/java/com/truelockmc/streambert/ExternalPlayerPlugin.java`

```java
package com.truelockmc.streambert;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

    @PluginMethod
    public void getInstalledPlayers(PluginCall call) {
        List<String> knownPackages = List.of(
            "org.videolan.vlc",
            "is.xyz.mpv",
            "com.mxtech.videoplayer.ad",
            "com.mxtech.videoplayer.pro",
            "com.brouken.player"
        );
        PackageManager pm = getContext().getPackageManager();
        List<String> installed = new ArrayList<>();
        for (String pkg : knownPackages) {
            try {
                pm.getPackageInfo(pkg, 0);
                installed.add(pkg);
            } catch (PackageManager.NameNotFoundException e) {
                // not installed
            }
        }
        // Also query all that handle video/*
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setType("video/*");
        List<ResolveInfo> activities = pm.queryIntentActivities(intent, 0);
        for (ResolveInfo ri : activities) {
            String pkg = ri.activityInfo.packageName;
            if (!installed.contains(pkg)) installed.add(pkg);
        }
        call.resolve(new JSObject().put("players", new JSArray(installed)));
    }

    @PluginMethod
    public void launchPlayer(PluginCall call) {
        String url = call.getString("url");
        String packageName = call.getString("packageName");
        String mimeType = call.getString("mimeType", "video/*");
        String title = call.getString("title");
        JSObject headers = call.getObject("headers");
        String subtitle = call.getString("subtitle");

        if (url == null) {
            call.reject("No URL");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(url), mimeType);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            if (packageName != null && !packageName.isEmpty()) {
                intent.setPackage(packageName);
            }

            if (title != null) {
                intent.putExtra("title", title);
                intent.putExtra(Intent.EXTRA_TITLE, title);
            }

            // Headers
            if (headers != null) {
                if (headers.has("User-Agent")) {
                    intent.putExtra("User-Agent", headers.getString("User-Agent"));
                }
                if (headers.has("Referer")) {
                    intent.putExtra("Referer", headers.getString("Referer"));
                }
            }

            // Subtitles - multiple keys for compatibility
            if (subtitle != null) {
                intent.putExtra("subtitles_location", subtitle);
                intent.putExtra("subs", subtitle);
                intent.putExtra("sub", subtitle);
                intent.putExtra("title_subtitle", subtitle);
                intent.putExtra("subs.enable", subtitle);
            }

            getContext().startActivity(intent);
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void downloadSubtitle(PluginCall call) {
        // Implement via DownloadManager or OkHttp
        // For now, placeholder
        call.resolve(new JSObject().put("ok", true));
    }
}
```

Register in `MainActivity.java`:
```java
add(ExternalPlayerPlugin.class);
```

### 4. Proxy Server Native (NanoHTTPD)

Add dependency in `android/app/build.gradle`:
```gradle
implementation 'org.nanohttpd:nanohttpd:2.3.1'
```

Create `ProxyServer.java` that mirrors `MainProxyServer` logic:
- Binds 127.0.0.1:0
- Handles /https/ and /http/ paths
- Injects headers
- Rewrites HLS playlists

Expose via plugin methods `startProxy`, `stopProxy`.

### 5. AndroidManifest.xml

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />
<uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" tools:ignore="QueryAllPackagesPermission" />

<queries>
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <data android:mimeType="video/*" />
    </intent>
    <package android:name="org.videolan.vlc" />
    <package android:name="is.xyz.mpv" />
    <package android:name="com.mxtech.videoplayer.ad" />
    <package android:name="com.mxtech.videoplayer.pro" />
    <package android:name="com.brouken.player" />
</queries>

<application
    android:usesCleartextTraffic="true"
    ...>
```

### 6. Storage

- Subtitles: Use `Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)/StreambertSubs`
- For Android 10+, use `MediaStore.Downloads`
- Request `MANAGE_EXTERNAL_STORAGE` or use SAF if needed

### 7. WebView m3u8 Interception

In `MainActivity`, override `WebViewClient.shouldInterceptRequest` to capture m3u8 URLs:
```java
@Override
public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
    String url = request.getUrl().toString();
    if (url.contains(".m3u8") || url.contains(".vtt")) {
        // Notify JS via bridge
        bridge.triggerWindowJSEvent("m3u8-found", url);
    }
    return super.shouldInterceptRequest(view, request);
}
```

Alternatively, load embed page in hidden WebView, wait for m3u8, then launch external player.

### 8. Build

```bash
npx cap copy android
npx cap open android
# In Android Studio: Build -> Build APK -> Debug
# Or via CLI:
cd android
./gradlew assembleDebug
# APK at app/build/outputs/apk/debug/app-debug.apk
```

### 9. Install & Test

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
adb logcat | grep -i streambert
```

### 10. Release

- Generate keystore: `keytool -genkey -v -keystore streambert.keystore -alias streambert -keyalg RSA -keysize 2048 -validity 10000`
- Configure signing in `android/app/build.gradle`
- `./gradlew assembleRelease`
- Sign, align, test

### 11. Permissions & Security

- Proxy only binds 127.0.0.1, not 0.0.0.0
- Validate host in proxy (only targetHost allowed)
- No open proxy
- Subtitles only in app-specific or Downloads folder, not private

### 12. Future Enhancements

- Picture-in-Picture for external player? Not needed, external player handles its own PiP
- Background playback tracking via VLC HTTP interface
- DRM support via ExoPlayer in custom player (if we build own player, but goal is external)
- Cast support (Chromecast)

---

*This plan is for AFTER source implementation verification. Do not start until Phase 13 report is complete.*
