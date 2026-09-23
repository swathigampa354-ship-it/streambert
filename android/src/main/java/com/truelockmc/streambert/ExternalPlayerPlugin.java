package com.truelockmc.streambert;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Environment;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Real Android-native External Player Plugin
 * No Electron, no Node.js, no Termux — pure Android Intent/PackageManager APIs
 * 
 * Handles:
 * - Player detection via PackageManager
 * - Launch via ACTION_VIEW Intent
 * - Proxy server for protected streams (via NanoHTTPD or custom)
 * - Subtitle download to shared storage
 */
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

    private static final String TAG = "StreambertExternalPlayer";
    private static final List<String> KNOWN_PLAYER_PACKAGES = Arrays.asList(
        "org.videolan.vlc",
        "org.videolan.vlc.debug",
        "is.xyz.mpv",
        "is.xyz.mpv.debug",
        "com.mpv",
        "com.mxtech.videoplayer.ad",
        "com.mxtech.videoplayer.pro",
        "com.brouken.player",
        "com.anotherwidget.justplayer",
        "dev.anotherwidget.ftp",
        "org.courville.nova",
        "org.xbmc.kodi"
    );

    private AndroidProxyServer proxyServer = null;

    /**
     * Get installed players via PackageManager (real detection, no Termux)
     */
    @PluginMethod
    public void getInstalledPlayers(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            List<String> installed = new ArrayList<>();

            // Check known packages
            for (String pkg : KNOWN_PLAYER_PACKAGES) {
                try {
                    pm.getPackageInfo(pkg, 0);
                    installed.add(pkg);
                    Log.d(TAG, "Found known player: " + pkg);
                } catch (PackageManager.NameNotFoundException e) {
                    // Not installed
                }
            }

            // Query all apps that handle video/* (for custom players)
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setType("video/*");
            List<ResolveInfo> activities = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo ri : activities) {
                String pkg = ri.activityInfo.packageName;
                if (pkg != null && !installed.contains(pkg)) {
                    // Filter out non-video players (browser, etc) by checking if package is known or contains video/player keywords
                    String lower = pkg.toLowerCase();
                    if (KNOWN_PLAYER_PACKAGES.contains(pkg) || 
                        lower.contains("video") || lower.contains("player") || 
                        lower.contains("vlc") || lower.contains("mpv") || lower.contains("mx") ||
                        lower.contains("just") || lower.contains("nova") || lower.contains("kodi")) {
                        installed.add(pkg);
                        Log.d(TAG, "Found video handler: " + pkg);
                    }
                }
            }

            JSArray array = new JSArray();
            for (String pkg : installed) {
                array.put(pkg);
            }

            JSObject ret = new JSObject();
            ret.put("players", array);
            call.resolve(ret);

            Log.i(TAG, "Detected players: " + installed.toString());

        } catch (Exception e) {
            Log.e(TAG, "getInstalledPlayers failed", e);
            call.reject("Failed to detect players: " + e.getMessage());
        }
    }

    /**
     * Launch player via ACTION_VIEW Intent (real Android API, no shell)
     * 
     * Expected call data:
     * {
     *   url: "https://.../playlist.m3u8" or "http://127.0.0.1:port/https/...",
     *   packageName: "org.videolan.vlc" or null for chooser,
     *   mimeType: "video/*" or "application/x-mpegURL",
     *   title: "Movie Title",
     *   headers: { "User-Agent": "...", "Referer": "..." },
     *   subtitle: "/sdcard/Download/StreambertSubs/Movie.en.vtt"
     * }
     */
    @PluginMethod
    public void launchPlayer(PluginCall call) {
        String url = call.getString("url");
        String packageName = call.getString("packageName");
        String mimeType = call.getString("mimeType", "video/*");
        String title = call.getString("title");
        JSObject headers = call.getObject("headers");
        String subtitle = call.getString("subtitle");

        if (url == null || url.isEmpty()) {
            call.reject("No URL provided");
            return;
        }

        if (url.equals("about:blank")) {
            call.reject("Invalid URL: about:blank");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(url), mimeType);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);

            // Specific package or chooser
            if (packageName != null && !packageName.isEmpty() && !packageName.equals("system-default")) {
                // Validate package is installed
                try {
                    getContext().getPackageManager().getPackageInfo(packageName, 0);
                    intent.setPackage(packageName);
                    Log.d(TAG, "Launching with package: " + packageName);
                } catch (PackageManager.NameNotFoundException e) {
                    Log.w(TAG, "Package not installed: " + packageName + ", using chooser");
                    // Fall through to chooser
                }
            }

            // Title
            if (title != null && !title.isEmpty()) {
                intent.putExtra("title", title);
                intent.putExtra(Intent.EXTRA_TITLE, title);
                intent.putExtra("android.intent.extra.TITLE", title);
            }

            // Headers via intent extras (User-Agent, Referer) - like MovieBox-TUI
            if (headers != null) {
                if (headers.has("User-Agent")) {
                    String ua = headers.getString("User-Agent");
                    if (ua != null) {
                        intent.putExtra("User-Agent", ua);
                        intent.putExtra("android.media.intent.extra.USER_AGENT", ua);
                        Log.d(TAG, "Added User-Agent extra");
                    }
                }
                if (headers.has("Referer")) {
                    String ref = headers.getString("Referer");
                    if (ref != null) {
                        intent.putExtra("Referer", ref);
                        intent.putExtra("android.media.intent.extra.REFERER", ref);
                        Log.d(TAG, "Added Referer extra");
                    }
                }
                // Note: Cookie, Authorization cannot be passed via intent extras
                // For those, proxy must be used (handled before calling launchPlayer)
            }

            // Subtitles - multiple keys for compatibility (like MovieBox)
            if (subtitle != null && !subtitle.isEmpty()) {
                // Check if file exists (for local paths)
                if (subtitle.startsWith("/")) {
                    File subFile = new File(subtitle);
                    if (!subFile.exists()) {
                        Log.w(TAG, "Subtitle file doesn't exist: " + subtitle + ", but still passing extra for player to handle");
                    }
                }

                intent.putExtra("subtitles_location", subtitle);
                intent.putExtra("subs", subtitle);
                intent.putExtra("sub", subtitle);
                intent.putExtra("title_subtitle", subtitle);
                intent.putExtra("subs.enable", subtitle);
                intent.putExtra("subs.filename", subtitle);
                // For MX Player
                intent.putExtra("subs.name", new String[]{subtitle});
                Log.d(TAG, "Added subtitle extras: " + subtitle);
            }

            // For chooser, wrap in createChooser
            Intent finalIntent;
            if (packageName == null || packageName.isEmpty() || packageName.equals("system-default")) {
                finalIntent = Intent.createChooser(intent, "Play with");
                Log.d(TAG, "Launching chooser for: " + url);
            } else {
                finalIntent = intent;
                Log.d(TAG, "Launching directly: " + url + " with " + packageName);
            }

            finalIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(finalIntent);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("method", "intent");
            ret.put("package", packageName);
            call.resolve(ret);

            Log.i(TAG, "Launched player successfully: " + url);

        } catch (Exception e) {
            Log.e(TAG, "launchPlayer failed for url: " + url, e);
            call.reject("Failed to launch player: " + e.getMessage());
        }
    }

    /**
     * Start proxy server for protected streams
     * Handles HLS playlist rewriting and header injection
     */
    @PluginMethod
    public void startProxy(PluginCall call) {
        String targetUrl = call.getString("targetUrl");
        JSObject headers = call.getObject("headers");
        String subtitleUrl = call.getString("subtitleUrl");

        if (targetUrl == null || targetUrl.isEmpty()) {
            call.reject("No targetUrl");
            return;
        }

        try {
            // Stop existing proxy if running
            if (proxyServer != null) {
                proxyServer.stop();
                proxyServer = null;
            }

            proxyServer = new AndroidProxyServer(targetUrl, headers, subtitleUrl);
            proxyServer.start();

            int port = proxyServer.getPort();
            String proxyPath;
            if (targetUrl.startsWith("https://")) {
                proxyPath = "/https/" + targetUrl.substring(8);
            } else if (targetUrl.startsWith("http://")) {
                proxyPath = "/http/" + targetUrl.substring(7);
            } else {
                proxyPath = "/https/" + targetUrl;
            }

            String proxyUrl = "http://127.0.0.1:" + port + proxyPath;

            JSObject ret = new JSObject();
            ret.put("proxyUrl", proxyUrl);
            ret.put("port", port);
            ret.put("ok", true);
            call.resolve(ret);

            Log.i(TAG, "Proxy started on port " + port + " -> " + targetUrl + " => " + proxyUrl);

        } catch (Exception e) {
            Log.e(TAG, "startProxy failed", e);
            call.reject("Failed to start proxy: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopProxy(PluginCall call) {
        try {
            if (proxyServer != null) {
                proxyServer.stop();
                proxyServer = null;
                Log.i(TAG, "Proxy stopped");
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "stopProxy failed", e);
            call.reject(e.getMessage());
        }
    }

    /**
     * Download subtitle to shared storage (/sdcard/Download/StreambertSubs)
     */
    @PluginMethod
    public void downloadSubtitle(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename", "subtitle.srt");
        JSObject headers = call.getObject("headers");

        if (url == null || url.isEmpty()) {
            call.reject("No URL");
            return;
        }

        try {
            // Create directory
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File subsDir = new File(downloadsDir, "StreambertSubs");
            if (!subsDir.exists()) {
                boolean created = subsDir.mkdirs();
                Log.d(TAG, "Created subtitle dir: " + subsDir.getAbsolutePath() + " success=" + created);
            }

            File destFile = new File(subsDir, filename);

            // Download via HttpURLConnection with headers
            URL u = new URL(url);
            HttpURLConnection conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(15000);
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");

            if (headers != null) {
                // Add Referer, etc.
                if (headers.has("Referer")) {
                    conn.setRequestProperty("Referer", headers.getString("Referer"));
                }
                if (headers.has("User-Agent")) {
                    conn.setRequestProperty("User-Agent", headers.getString("User-Agent"));
                }
            }

            conn.connect();

            int code = conn.getResponseCode();
            if (code != 200) {
                call.reject("HTTP " + code + " for subtitle: " + url);
                return;
            }

            InputStream in = conn.getInputStream();
            FileOutputStream out = new FileOutputStream(destFile);

            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) != -1) {
                out.write(buffer, 0, len);
            }

            out.close();
            in.close();

            JSObject ret = new JSObject();
            ret.put("localPath", destFile.getAbsolutePath());
            ret.put("ok", true);
            call.resolve(ret);

            Log.i(TAG, "Subtitle downloaded: " + destFile.getAbsolutePath() + " from " + url);

        } catch (Exception e) {
            Log.e(TAG, "downloadSubtitle failed for " + url, e);
            call.reject("Failed to download subtitle: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getSubtitleDir(PluginCall call) {
        try {
            File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            File subsDir = new File(downloadsDir, "StreambertSubs");
            JSObject ret = new JSObject();
            ret.put("path", subsDir.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
