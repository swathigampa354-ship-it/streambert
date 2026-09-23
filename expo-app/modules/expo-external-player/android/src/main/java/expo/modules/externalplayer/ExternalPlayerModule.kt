package expo.modules.externalplayer

import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.net.Uri
import android.os.Environment
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.ArrayList

class ExternalPlayerModule : Module() {

  private val knownPlayerPackages = listOf(
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
  )

  private var proxyServer: AndroidProxyServer? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoExternalPlayer")

    // Get installed players via PackageManager
    AsyncFunction("getInstalledPlayers") {
      val context = appContext.reactContext ?: throw Exception("React context not available")
      val pm = context.packageManager
      val installed = mutableListOf<String>()

      // Check known packages
      for (pkg in knownPlayerPackages) {
        try {
          pm.getPackageInfo(pkg, 0)
          installed.add(pkg)
          Log.d(TAG, "Found known player: $pkg")
        } catch (e: PackageManager.NameNotFoundException) {
          // Not installed
        }
      }

      // Query all apps that handle video/*
      try {
        val intent = Intent(Intent.ACTION_VIEW).apply { type = "video/*" }
        val activities = pm.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)
        for (ri in activities) {
          val pkg = ri.activityInfo.packageName
          if (pkg != null && !installed.contains(pkg)) {
            val lower = pkg.lowercase()
            if (knownPlayerPackages.contains(pkg) ||
                lower.contains("video") || lower.contains("player") ||
                lower.contains("vlc") || lower.contains("mpv") || lower.contains("mx") ||
                lower.contains("just") || lower.contains("nova") || lower.contains("kodi")) {
              installed.add(pkg)
              Log.d(TAG, "Found video handler: $pkg")
            }
          }
        }
      } catch (e: Exception) {
        Log.w(TAG, "queryIntentActivities failed", e)
      }

      return@AsyncFunction mapOf("players" to installed)
    }

    // Launch player via ACTION_VIEW Intent
    AsyncFunction("launchPlayer") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exception("React context not available")
      val url = options["url"] as? String ?: throw Exception("No URL provided")
      val packageName = options["packageName"] as? String
      val mimeType = options["mimeType"] as? String ?: "video/*"
      val title = options["title"] as? String
      @Suppress("UNCHECKED_CAST")
      val headers = options["headers"] as? Map<String, String>
      val subtitle = options["subtitle"] as? String

      if (url == "about:blank") throw Exception("Invalid URL: about:blank")
      if (url.isEmpty()) throw Exception("No URL provided")

      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(url), mimeType)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      }

      // Specific package or chooser
      if (!packageName.isNullOrEmpty() && packageName != "system-default") {
        try {
          context.packageManager.getPackageInfo(packageName, 0)
          intent.setPackage(packageName)
          Log.d(TAG, "Launching with package: $packageName")
        } catch (e: PackageManager.NameNotFoundException) {
          Log.w(TAG, "Package not installed: $packageName, using chooser")
        }
      }

      // Title
      if (!title.isNullOrEmpty()) {
        intent.putExtra("title", title)
        intent.putExtra(Intent.EXTRA_TITLE, title)
        intent.putExtra("android.intent.extra.TITLE", title)
      }

      // Headers
      headers?.let {
        it["User-Agent"]?.let { ua ->
          intent.putExtra("User-Agent", ua)
          intent.putExtra("android.media.intent.extra.USER_AGENT", ua)
        }
        it["Referer"]?.let { ref ->
          intent.putExtra("Referer", ref)
          intent.putExtra("android.media.intent.extra.REFERER", ref)
        }
      }

      // Subtitles - 9 keys for compatibility
      if (!subtitle.isNullOrEmpty()) {
        if (subtitle.startsWith("/")) {
          val subFile = File(subtitle)
          if (!subFile.exists()) {
            Log.w(TAG, "Subtitle file doesn't exist: $subtitle, but still passing extra")
          }
        }
        intent.putExtra("subtitles_location", subtitle)
        intent.putExtra("subs", subtitle)
        intent.putExtra("sub", subtitle)
        intent.putExtra("title_subtitle", subtitle)
        intent.putExtra("subs.enable", subtitle)
        intent.putExtra("subs.name", subtitle)
        intent.putExtra("subs.filename", subtitle)
        intent.putExtra("sub.filename", subtitle)
        // ArrayList versions
        val list = ArrayList<String>().apply { add(subtitle) }
        intent.putStringArrayListExtra("subs", list)
        intent.putStringArrayListExtra("subs.enable", list)
        intent.putExtra("subs:1", subtitle)
      }

      try {
        if (packageName.isNullOrEmpty() || packageName == "system-default") {
          val chooser = Intent.createChooser(intent, "Play with")
          chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(chooser)
          Log.i(TAG, "Launched chooser for $url")
          return@AsyncFunction mapOf("success" to true, "opener" to "system-chooser", "packageName" to "chooser")
        } else {
          context.startActivity(intent)
          Log.i(TAG, "Launched $packageName for $url")
          return@AsyncFunction mapOf("success" to true, "opener" to "intent", "packageName" to packageName)
        }
      } catch (e: Exception) {
        Log.e(TAG, "Launch failed", e)
        throw Exception("Failed to launch player: ${e.message}")
      }
    }

    // Start proxy server
    AsyncFunction("startProxy") { options: Map<String, Any?> ->
      val targetUrl = options["targetUrl"] as? String ?: throw Exception("No targetUrl")
      @Suppress("UNCHECKED_CAST")
      val headers = options["headers"] as? Map<String, String> ?: emptyMap()
      val subtitleUrl = options["subtitleUrl"] as? String

      // Stop existing
      proxyServer?.stop()

      val server = AndroidProxyServer(targetUrl, headers, subtitleUrl)
      server.start()
      proxyServer = server

      val port = server.getPort()
      val localUrl = "http://127.0.0.1:$port/https/${targetUrl.removePrefix("https://").removePrefix("http://")}"
      // Actually construct properly
      val hostPath = targetUrl.replace(Regex("^https?://"), "")
      val scheme = if (targetUrl.startsWith("https://")) "https" else "http"
      val finalLocalUrl = "http://127.0.0.1:$port/$scheme/$hostPath"

      Log.i(TAG, "Proxy started: $finalLocalUrl -> $targetUrl")
      return@AsyncFunction mapOf("localUrl" to finalLocalUrl, "port" to port)
    }

    // Stop proxy
    AsyncFunction("stopProxy") {
      proxyServer?.stop()
      proxyServer = null
      return@AsyncFunction mapOf("stopped" to true)
    }

    // Download subtitle
    AsyncFunction("downloadSubtitle") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exception("React context not available")
      val url = options["url"] as? String ?: throw Exception("No URL")
      val fileName = options["fileName"] as? String ?: "subtitle.srt"
      @Suppress("UNCHECKED_CAST")
      val headers = options["headers"] as? Map<String, String> ?: emptyMap()

      val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "StreambertSubs")
      if (!dir.exists()) dir.mkdirs()

      val file = File(dir, fileName)

      try {
        val urlObj = URL(url)
        val conn = urlObj.openConnection() as HttpURLConnection
        conn.connectTimeout = 15000
        conn.readTimeout = 15000
        conn.requestMethod = "GET"
        headers["Referer"]?.let { conn.setRequestProperty("Referer", it) }
        headers["User-Agent"]?.let { conn.setRequestProperty("User-Agent", it) }
        conn.connect()

        if (conn.responseCode != 200) {
          throw Exception("HTTP ${conn.responseCode}")
        }

        conn.inputStream.use { input ->
          FileOutputStream(file).use { output ->
            input.copyTo(output)
          }
        }

        Log.i(TAG, "Downloaded subtitle to ${file.absolutePath}")
        return@AsyncFunction mapOf("filePath" to file.absolutePath, "exists" to file.exists())
      } catch (e: Exception) {
        Log.e(TAG, "Subtitle download failed", e)
        throw Exception("Download failed: ${e.message}")
      }
    }

    // Get subtitle dir
    AsyncFunction("getSubtitleDir") {
      val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "StreambertSubs")
      if (!dir.exists()) dir.mkdirs()
      return@AsyncFunction mapOf("path" to dir.absolutePath)
    }
  }

  companion object {
    private const val TAG = "ExpoExternalPlayer"
  }
}
