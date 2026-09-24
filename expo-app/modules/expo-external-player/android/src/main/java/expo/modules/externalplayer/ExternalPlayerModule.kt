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
    "dev.anishaneja.nextplayer",
    "org.courville.nova",
    "org.xbmc.kodi"
  )

  private var proxyServer: AndroidProxyServer? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoExternalPlayer")

    AsyncFunction("getInstalledPlayers") {
      val context = appContext.reactContext ?: throw Exception("React context not available")
      val pm = context.packageManager
      val installed = mutableListOf<String>()

      for (pkg in knownPlayerPackages) {
        try {
          pm.getPackageInfo(pkg, 0)
          installed.add(pkg)
          Log.d(TAG, "Found known player: $pkg")
        } catch (e: PackageManager.NameNotFoundException) {
        }
      }

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

      if (!packageName.isNullOrEmpty() && packageName != "system-default") {
        try {
          context.packageManager.getPackageInfo(packageName, 0)
          intent.setPackage(packageName)
          Log.d(TAG, "Launching with package: $packageName")
        } catch (e: PackageManager.NameNotFoundException) {
          Log.w(TAG, "Package not installed: $packageName, using chooser")
        }
      }

      if (!title.isNullOrEmpty()) {
        intent.putExtra("title", title)
        intent.putExtra(Intent.EXTRA_TITLE, title)
        intent.putExtra("android.intent.extra.TITLE", title)
      }

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

    AsyncFunction("startProxy") { options: Map<String, Any?> ->
      val targetUrl = options["targetUrl"] as? String ?: throw Exception("No targetUrl")
      @Suppress("UNCHECKED_CAST")
      val headers = options["headers"] as? Map<String, String> ?: emptyMap()
      val subtitleUrl = options["subtitleUrl"] as? String

      proxyServer?.stop()

      val server = AndroidProxyServer(targetUrl, headers, subtitleUrl)
      server.start()
      proxyServer = server

      val port = server.getPort()
      val hostPath = targetUrl.replace(Regex("^https?://"), "")
      val scheme = if (targetUrl.startsWith("https://")) "https" else "http"
      val finalLocalUrl = "http://127.0.0.1:$port/$scheme/$hostPath"

      Log.i(TAG, "Proxy started: $finalLocalUrl -> $targetUrl")
      return@AsyncFunction mapOf("localUrl" to finalLocalUrl, "port" to port)
    }

    AsyncFunction("stopProxy") {
      proxyServer?.stop()
      proxyServer = null
      return@AsyncFunction mapOf("stopped" to true)
    }

    AsyncFunction("downloadSubtitle") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exception("React context not available")
      val url = options["url"] as? String ?: throw Exception("No URL")
      val fileName = (options["fileName"] as? String ?: "subtitle.srt").replace(Regex("[^A-Za-z0-9._-]"), "_")
      @Suppress("UNCHECKED_CAST")
      val headers = options["headers"] as? Map<String, String> ?: emptyMap()

      try {
        // 1) Fetch subtitle bytes
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
        val bytes = conn.inputStream.use { it.readBytes() }
        conn.disconnect()
        if (bytes.isEmpty()) throw Exception("Empty subtitle response")

        // 2) Persist scoped-storage-safe:
        //    API 29+  -> MediaStore.Downloads (no storage permission required)
        //    API <=28 -> direct write (WRITE_EXTERNAL_STORAGE granted at install)
        val absolutePath = if (android.os.Build.VERSION.SDK_INT >= 29) {
          val resolver = context.contentResolver
          val collection = android.provider.MediaStore.Downloads.getContentUri(android.provider.MediaStore.VOLUME_EXTERNAL_PRIMARY)
          val relativePath = Environment.DIRECTORY_DOWNLOADS + "/StreambertSubs/"

          // Remove any previous entry with the same display name (idempotent re-download)
          val projection = arrayOf(android.provider.MediaStore.MediaColumns._ID)
          val selection = "${android.provider.MediaStore.MediaColumns.DISPLAY_NAME}=? AND ${android.provider.MediaStore.MediaColumns.RELATIVE_PATH}=?"
          resolver.query(collection, projection, selection, arrayOf(fileName, relativePath), null)?.use { cursor ->
            while (cursor.moveToFirst()) {
              val id = cursor.getLong(0)
              resolver.delete(android.content.ContentUris.withAppendedId(collection, id), null, null)
            }
          }

          val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fileName)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, if (fileName.endsWith(".vtt")) "text/vtt" else "application/x-subrip")
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, relativePath)
          }
          val uri = resolver.insert(collection, values) ?: throw Exception("MediaStore insert failed")
          resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw Exception("MediaStore openOutputStream failed")

          // Deterministic public path so external players (VLC/MX/MPV with their
          // own storage/media permissions or all-files access) can open it.
          File(Environment.getExternalStorageDirectory(), "Download/StreambertSubs/$fileName").absolutePath
        } else {
          val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "StreambertSubs")
          if (!dir.exists()) dir.mkdirs()
          val file = File(dir, fileName)
          FileOutputStream(file).use { it.write(bytes) }
          file.absolutePath
        }

        Log.i(TAG, "Downloaded subtitle to $absolutePath (${bytes.size} bytes)")
        return@AsyncFunction mapOf("filePath" to absolutePath, "exists" to true)
      } catch (e: Exception) {
        Log.e(TAG, "Subtitle download failed", e)
        throw Exception("Download failed: ${e.message}")
      }
    }

    AsyncFunction("getSubtitleDir") {
      return@AsyncFunction mapOf("path" to File(Environment.getExternalStorageDirectory(), "Download/StreambertSubs").absolutePath)
    }

    AsyncFunction("fileExists") { path: String ->
      return@AsyncFunction try {
        File(path).exists()
      } catch (e: Exception) {
        false
      }
    }
  }

  companion object {
    private const val TAG = "ExpoExternalPlayer"
  }
}
