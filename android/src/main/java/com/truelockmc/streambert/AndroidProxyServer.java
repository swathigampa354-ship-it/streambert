package com.truelockmc.streambert;

import android.util.Log;

import com.getcapacitor.JSObject;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Android local proxy server for protected streams
 * Mirrors MovieBox-TUI proxy.rs logic:
 * - Binds 127.0.0.1:0 random port
 * - Path format /https/<host>/path or /http/<host>/path
 * - Validates host (only targetHost or subtitleHost allowed, else 403)
 * - Injects headers (all for targetHost, only UA for subtitleHost)
 * - Forwards Range header
 * - Rewrites HLS playlists to route segments through proxy
 * - Watchdog: stops after 10 min idle + 0 connections
 * - Only loopback, not exposed externally
 */
public class AndroidProxyServer {

    private static final String TAG = "StreambertProxy";
    private static final int MAX_LINE_BYTES = 8 * 1024;
    private static final int MAX_HEADERS = 64;
    private static final int WATCHDOG_IDLE_SECS = 600; // 10 min
    private static final int CHUNK_IDLE_TIMEOUT_SECS = 60;

    private final String targetUrl;
    private final JSObject headers;
    private final String subtitleUrl;
    private final String targetHost;

    private ServerSocket serverSocket;
    private int port;
    private volatile boolean running = false;
    private ExecutorService executor;
    private AtomicInteger activeConnections = new AtomicInteger(0);
    private volatile long lastActivity;
    private Thread watchdogThread;

    public AndroidProxyServer(String targetUrl, JSObject headers, String subtitleUrl) {
        this.targetUrl = targetUrl;
        this.headers = headers != null ? headers : new JSObject();
        this.subtitleUrl = subtitleUrl;
        this.targetHost = extractHost(targetUrl);
        this.lastActivity = System.currentTimeMillis();
    }

    public static String extractHost(String url) {
        try {
            URL u = new URL(url);
            return u.getHost() + (u.getPort() != -1 ? ":" + u.getPort() : "");
        } catch (Exception e) {
            try {
                String afterScheme = url.replaceFirst("^https?://", "");
                String host = afterScheme.split("/")[0];
                return host;
            } catch (Exception e2) {
                return null;
            }
        }
    }

    public static String extractTargetUrl(String path) {
        if (path == null) return null;
        if (path.startsWith("/https/")) return "https://" + path.substring(7);
        if (path.startsWith("/http/")) return "http://" + path.substring(6);
        if (path.startsWith("/")) {
            String trimmed = path.substring(1);
            if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
        }
        return null;
    }

    public void start() throws IOException {
        serverSocket = new ServerSocket(0, 50, java.net.InetAddress.getByName("127.0.0.1"));
        port = serverSocket.getLocalPort();
        running = true;
        executor = Executors.newCachedThreadPool();

        // Watchdog
        watchdogThread = new Thread(() -> {
            while (running) {
                try {
                    Thread.sleep(15000);
                    long idleMs = System.currentTimeMillis() - lastActivity;
                    if (activeConnections.get() == 0 && idleMs > WATCHDOG_IDLE_SECS * 1000L) {
                        Log.i(TAG, "Idle timeout, stopping proxy");
                        stop();
                        break;
                    }
                } catch (InterruptedException e) {
                    break;
                }
            }
        });
        watchdogThread.setDaemon(true);
        watchdogThread.start();

        // Accept loop
        Thread acceptThread = new Thread(() -> {
            while (running) {
                try {
                    Socket socket = serverSocket.accept();
                    activeConnections.incrementAndGet();
                    lastActivity = System.currentTimeMillis();
                    executor.submit(() -> {
                        try {
                            handleConnection(socket);
                        } catch (Exception e) {
                            Log.e(TAG, "handleConnection error", e);
                        } finally {
                            activeConnections.decrementAndGet();
                            lastActivity = System.currentTimeMillis();
                            try {
                                socket.close();
                            } catch (IOException ignored) {}
                        }
                    });
                } catch (IOException e) {
                    if (running) {
                        Log.w(TAG, "Accept error", e);
                        try {
                            Thread.sleep(50);
                        } catch (InterruptedException ignored) {}
                    }
                }
            }
        });
        acceptThread.setDaemon(true);
        acceptThread.start();

        Log.i(TAG, "Proxy started on 127.0.0.1:" + port + " target=" + targetUrl);
    }

    private void handleConnection(Socket socket) throws IOException {
        BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream()));
        java.io.OutputStream out = socket.getOutputStream();

        // Read request line
        String requestLine = reader.readLine();
        if (requestLine == null || requestLine.isEmpty()) return;
        if (requestLine.length() > MAX_LINE_BYTES) {
            sendError(out, 431, "Request Header Fields Too Large");
            return;
        }

        String[] parts = requestLine.split(" ");
        if (parts.length < 2) {
            sendError(out, 400, "Bad Request");
            return;
        }

        String method = parts[0];
        String pathAndQuery = parts[1];

        // Read headers
        String rangeHeader = null;
        int headerCount = 0;
        String line;
        while ((line = reader.readLine()) != null && !line.isEmpty()) {
            if (line.length() > MAX_LINE_BYTES) break;
            headerCount++;
            if (headerCount > MAX_HEADERS) break;
            String lower = line.toLowerCase();
            if (lower.startsWith("range:")) {
                rangeHeader = line.substring(6).trim();
            }
        }

        String targetUrl = extractTargetUrl(pathAndQuery);
        if (targetUrl == null) {
            sendError(out, 400, "Bad Request - Invalid proxy path");
            return;
        }

        // Security: only allow targetHost and subtitleHost
        String extractedHost = extractHost(targetUrl);
        String subtitleHost = subtitleUrl != null ? extractHost(subtitleUrl) : null;
        boolean isAllowed = extractedHost != null && extractedHost.equals(targetHost) ||
                            (subtitleHost != null && extractedHost != null && extractedHost.equals(subtitleHost));

        if (!isAllowed) {
            Log.w(TAG, "Forbidden host: " + extractedHost + " not in allowed " + targetHost);
            sendError(out, 403, "Forbidden");
            return;
        }

        // Build upstream request
        try {
            URL url = new URL(targetUrl);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setRequestMethod(method.equals("HEAD") ? "HEAD" : "GET");
            conn.setInstanceFollowRedirects(true);

            // Inject headers
            if (extractedHost != null && extractedHost.equals(targetHost)) {
                // All headers for target host
                java.util.Iterator<String> it = headers.keys();
                while (it.hasNext()) {
                    String key = it.next();
                    try {
                        String val = headers.getString(key);
                        if (val != null) {
                            conn.setRequestProperty(key, val);
                        }
                    } catch (Exception ignored) {}
                }
            } else {
                // Only User-Agent for subtitle host
                if (headers.has("User-Agent")) {
                    try {
                        conn.setRequestProperty("User-Agent", headers.getString("User-Agent"));
                    } catch (Exception ignored) {}
                }
            }

            if (rangeHeader != null) {
                conn.setRequestProperty("Range", rangeHeader);
            }

            conn.connect();

            int responseCode = conn.getResponseCode();
            String responseMessage = conn.getResponseMessage();
            String contentType = conn.getContentType();

            boolean isM3u8 = targetUrl.contains(".m3u8") || 
                             (contentType != null && (contentType.contains("mpegurl") || contentType.contains("x-mpegURL")));

            if (isM3u8) {
                // Read manifest and rewrite
                InputStream in = conn.getInputStream();
                StringBuilder sb = new StringBuilder();
                BufferedReader br = new BufferedReader(new InputStreamReader(in));
                String l;
                while ((l = br.readLine()) != null) {
                    sb.append(l).append("\n");
                }
                br.close();

                String playlist = sb.toString();
                String rewritten = rewriteHlsPlaylist(playlist, targetUrl);

                String response = "HTTP/1.1 " + responseCode + " " + responseMessage + "\r\n" +
                        "Content-Type: application/vnd.apple.mpegurl\r\n" +
                        "Content-Length: " + rewritten.getBytes().length + "\r\n" +
                        "Connection: close\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "\r\n" + rewritten;

                out.write(response.getBytes());
                out.flush();

                Log.d(TAG, "Rewrote HLS playlist for " + targetUrl + " length=" + rewritten.length());

            } else {
                // Stream binary
                StringBuilder headerBuilder = new StringBuilder();
                headerBuilder.append("HTTP/1.1 ").append(responseCode).append(" ").append(responseMessage).append("\r\n");

                // Copy relevant headers
                String contentLength = conn.getHeaderField("Content-Length");
                if (contentLength != null) {
                    headerBuilder.append("Content-Length: ").append(contentLength).append("\r\n");
                }
                if (contentType != null) {
                    headerBuilder.append("Content-Type: ").append(contentType).append("\r\n");
                }
                String acceptRanges = conn.getHeaderField("Accept-Ranges");
                if (acceptRanges != null) {
                    headerBuilder.append("Accept-Ranges: ").append(acceptRanges).append("\r\n");
                }
                String contentRange = conn.getHeaderField("Content-Range");
                if (contentRange != null) {
                    headerBuilder.append("Content-Range: ").append(contentRange).append("\r\n");
                }

                headerBuilder.append("Connection: close\r\n");
                headerBuilder.append("Access-Control-Allow-Origin: *\r\n");
                headerBuilder.append("\r\n");

                out.write(headerBuilder.toString().getBytes());
                out.flush();

                // Stream body
                InputStream in = conn.getInputStream();
                byte[] buffer = new byte[8192];
                int len;
                while ((len = in.read(buffer)) != -1) {
                    out.write(buffer, 0, len);
                }
                out.flush();
                in.close();

                Log.d(TAG, "Streamed segment: " + targetUrl);
            }

        } catch (Exception e) {
            Log.e(TAG, "Upstream error for " + targetUrl, e);
            String body = "Gateway Error: " + e.getMessage();
            String response = "HTTP/1.1 502 Bad Gateway\r\n" +
                    "Content-Length: " + body.length() + "\r\n" +
                    "Connection: close\r\n\r\n" + body;
            out.write(response.getBytes());
            out.flush();
        }
    }

    private String rewriteHlsPlaylist(String playlist, String baseUrl) {
        try {
            URL baseUrlObj = new URL(baseUrl);
            String basePath = baseUrl.substring(0, baseUrl.lastIndexOf("/") + 1);

            StringBuilder sb = new StringBuilder();
            String[] lines = playlist.split("\n");

            for (String line : lines) {
                String trimmed = line.trim();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                    if (trimmed.contains("URI=\"")) {
                        // Rewrite URI="..."
                        String rewritten = trimmed.replaceAll("URI=\"([^\"]+)\"", 
                            java.util.regex.Matcher.quoteReplacement("URI=\"") + 
                            rewriteUrl("$1", basePath, baseUrlObj) + "\"");
                        // Actually need to properly rewrite each URI match
                        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("URI=\"([^\"]+)\"");
                        java.util.regex.Matcher matcher = pattern.matcher(trimmed);
                        StringBuffer buf = new StringBuffer();
                        while (matcher.find()) {
                            String uri = matcher.group(1);
                            String resolved = resolveUrl(uri, basePath, baseUrlObj);
                            String proxied = urlToProxyPath(resolved);
                            matcher.appendReplacement(buf, "URI=\"" + java.util.regex.Matcher.quoteReplacement(proxied) + "\"");
                        }
                        matcher.appendTail(buf);
                        sb.append(buf.toString()).append("\n");
                    } else {
                        sb.append(line).append("\n");
                    }
                } else {
                    // Segment URL
                    String resolved;
                    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                        resolved = trimmed;
                    } else {
                        resolved = resolveUrl(trimmed, basePath, baseUrlObj);
                    }
                    sb.append(urlToProxyPath(resolved)).append("\n");
                }
            }

            return sb.toString();

        } catch (Exception e) {
            Log.e(TAG, "Playlist rewrite failed", e);
            return playlist;
        }
    }

    private String resolveUrl(String relative, String basePath, URL baseUrlObj) {
        if (relative.startsWith("http://") || relative.startsWith("https://")) return relative;
        if (relative.startsWith("/")) return baseUrlObj.getProtocol() + "://" + baseUrlObj.getHost() + (baseUrlObj.getPort() != -1 ? ":" + baseUrlObj.getPort() : "") + relative;
        return basePath + relative;
    }

    private String urlToProxyPath(String url) {
        if (url.startsWith("https://")) return "http://127.0.0.1:" + port + "/https/" + url.substring(8);
        if (url.startsWith("http://")) return "http://127.0.0.1:" + port + "/http/" + url.substring(7);
        return url;
    }

    private String rewriteUrl(String uri, String basePath, URL baseUrlObj) {
        String resolved = resolveUrl(uri, basePath, baseUrlObj);
        return urlToProxyPath(resolved);
    }

    private void sendError(java.io.OutputStream out, int code, String message) throws IOException {
        String body = message;
        String response = "HTTP/1.1 " + code + " " + message + "\r\n" +
                "Content-Length: " + body.length() + "\r\n" +
                "Connection: close\r\n\r\n" + body;
        out.write(response.getBytes());
        out.flush();
    }

    public int getPort() {
        return port;
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException e) {
            Log.w(TAG, "Error closing server socket", e);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        if (watchdogThread != null) {
            watchdogThread.interrupt();
        }
        Log.i(TAG, "Proxy stopped");
    }
}
