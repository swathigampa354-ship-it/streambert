package expo.modules.externalplayer;

import android.util.Log;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

public class AndroidProxyServer {

    private static final String TAG = "StreambertProxy";
    private static final int MAX_LINE_BYTES = 8 * 1024;
    private static final int MAX_HEADERS = 64;
    private static final int WATCHDOG_IDLE_SECS = 600;

    private final String targetUrl;
    private final Map<String, String> headers;
    private final String subtitleUrl;
    private final String targetHost;

    private ServerSocket serverSocket;
    private int port;
    private volatile boolean running = false;
    private ExecutorService executor;
    private AtomicInteger activeConnections = new AtomicInteger(0);
    private volatile long lastActivity;
    private Thread watchdogThread;

    public AndroidProxyServer(String targetUrl, Map<String, String> headers, String subtitleUrl) {
        this.targetUrl = targetUrl;
        this.headers = headers != null ? headers : new java.util.HashMap<>();
        this.subtitleUrl = subtitleUrl;
        this.targetHost = extractHost(targetUrl);
        this.lastActivity = System.currentTimeMillis();
    }

    public static String extractHost(String url) {
        if (url == null) return "";
        try {
            String host = url.replaceAll("^https?://", "").split("/")[0];
            host = host.split(":")[0].split("\\?")[0];
            return host.toLowerCase();
        } catch (Exception e) {
            return "";
        }
    }

    public void start() throws IOException {
        serverSocket = new ServerSocket(0);
        port = serverSocket.getLocalPort();
        running = true;
        executor = Executors.newCachedThreadPool();
        lastActivity = System.currentTimeMillis();

        watchdogThread = new Thread(() -> {
            while (running) {
                try {
                    Thread.sleep(10000);
                    long idle = (System.currentTimeMillis() - lastActivity) / 1000;
                    if (idle > WATCHDOG_IDLE_SECS && activeConnections.get() == 0) {
                        Log.i(TAG, "Watchdog stopping idle proxy after " + idle + "s");
                        stop();
                        break;
                    }
                } catch (InterruptedException e) {
                    break;
                }
            }
        });
        watchdogThread.start();

        executor.submit(() -> {
            while (running) {
                try {
                    Socket client = serverSocket.accept();
                    activeConnections.incrementAndGet();
                    lastActivity = System.currentTimeMillis();
                    executor.submit(() -> handleClient(client));
                } catch (IOException e) {
                    if (running) Log.e(TAG, "Accept failed", e);
                }
            }
        });

        Log.i(TAG, "Proxy started on port " + port + " for " + targetUrl);
    }

    public void stop() {
        running = false;
        try {
            if (serverSocket != null) serverSocket.close();
        } catch (IOException e) {}
        if (executor != null) executor.shutdownNow();
        if (watchdogThread != null) watchdogThread.interrupt();
        Log.i(TAG, "Proxy stopped");
    }

    public int getPort() {
        return port;
    }

    private void handleClient(Socket client) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(client.getInputStream()));
            String requestLine = reader.readLine();
            if (requestLine == null) {
                client.close();
                return;
            }

            if (requestLine.length() > MAX_LINE_BYTES) {
                sendError(client, 414, "Request-URI Too Long");
                return;
            }

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                sendError(client, 400, "Bad Request");
                return;
            }

            String method = parts[0];
            String path = parts[1];

            Map<String, String> reqHeaders = new java.util.HashMap<>();
            String line;
            int headerCount = 0;
            while ((line = reader.readLine()) != null && !line.isEmpty()) {
                if (line.length() > MAX_LINE_BYTES || headerCount++ > MAX_HEADERS) {
                    sendError(client, 431, "Request Header Fields Too Large");
                    return;
                }
                int idx = line.indexOf(":");
                if (idx > 0) {
                    String key = line.substring(0, idx).trim();
                    String value = line.substring(idx + 1).trim();
                    reqHeaders.put(key, value);
                }
            }

            if (!path.startsWith("/http/") && !path.startsWith("/https/")) {
                sendError(client, 400, "Invalid proxy path, must start with /http/ or /https/");
                return;
            }

            // "/https/cdn.example.com/a/b?x=1" -> "https://cdn.example.com/a/b?x=1"
            // (previous substring(1) produced "https/cdn.example.com/..." - broken URL)
            int schemeEnd = path.indexOf('/', 1);
            if (schemeEnd < 0 || schemeEnd + 1 >= path.length()) {
                sendError(client, 400, "Invalid proxy path");
                return;
            }
            String scheme = path.substring(1, schemeEnd);
            String actualUrl = scheme + "://" + path.substring(schemeEnd + 1);
            String host = extractHost(actualUrl);
            String targetHostLower = targetHost.toLowerCase();
            String subtitleHost = subtitleUrl != null ? extractHost(subtitleUrl).toLowerCase() : "";

            boolean isTarget = host.equals(targetHostLower) || host.endsWith("." + targetHostLower);
            boolean isSubtitle = !subtitleHost.isEmpty() && (host.equals(subtitleHost) || host.endsWith("." + subtitleHost));

            if (!isTarget && !isSubtitle) {
                Log.w(TAG, "Host validation failed: " + host + " not in " + targetHost + " or " + subtitleUrl);
                sendError(client, 403, "Forbidden: host not allowed");
                return;
            }

            proxyRequest(client, method, actualUrl, reqHeaders, isSubtitle);

        } catch (Exception e) {
            Log.e(TAG, "handleClient failed", e);
            try { client.close(); } catch (IOException ex) {}
        } finally {
            activeConnections.decrementAndGet();
            lastActivity = System.currentTimeMillis();
        }
    }

    private void proxyRequest(Socket client, String method, String urlStr, Map<String, String> reqHeaders, boolean isSubtitle) {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            conn.setInstanceFollowRedirects(false);

            if (isSubtitle) {
                String ua = headers.get("User-Agent");
                if (ua != null) conn.setRequestProperty("User-Agent", ua);
            } else {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    conn.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }

            String range = reqHeaders.get("Range");
            if (range != null) conn.setRequestProperty("Range", range);

            int responseCode = conn.getResponseCode();
            String responseMessage = conn.getResponseMessage();

            // Decide whether we will TRANSFORM the body (playlist rewrite).
            // Only then must upstream Content-Length / Content-Encoding be dropped:
            // forwarding them with a rewritten body corrupts playback (hangs/truncation).
            InputStream rawIn = responseCode >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String contentType = conn.getContentType();
            String contentEncoding = conn.getContentEncoding();
            boolean isPlaylist = rawIn != null && contentType != null &&
                    (contentType.contains("mpegurl") || contentType.contains("x-mpegURL") ||
                     contentType.contains("application/octet-stream") && urlStr.contains(".m3u8") ||
                     urlStr.contains(".m3u8"));
            boolean gzipped = "gzip".equalsIgnoreCase(contentEncoding);
            boolean transform = isPlaylist; // playlists are small; always safe to buffer+rewrite

            java.io.OutputStream out = client.getOutputStream();
            String statusLine = "HTTP/1.1 " + responseCode + " " + responseMessage + "\r\n";
            out.write(statusLine.getBytes());

            for (Map.Entry<String, java.util.List<String>> entry : conn.getHeaderFields().entrySet()) {
                String key = entry.getKey();
                if (key == null) continue;
                // Hop-by-hop: HttpURLConnection already de-chunked the body for us.
                if (key.equalsIgnoreCase("Transfer-Encoding")) continue;
                // Body length/encoding only valid when we forward bytes untouched.
                if (transform && key.equalsIgnoreCase("Content-Length")) continue;
                if (transform && key.equalsIgnoreCase("Content-Encoding")) continue;
                for (String value : entry.getValue()) {
                    if (key.equalsIgnoreCase("Location")) {
                        value = rewriteUrlIfNeeded(value, urlStr);
                    }
                    String headerLine = key + ": " + value + "\r\n";
                    out.write(headerLine.getBytes());
                }
            }
            if (transform) {
                // No Content-Length -> clients read until close; we close after the body.
                out.write("Connection: close\r\n".getBytes());
            }
            out.write("\r\n".getBytes());

            if (rawIn != null) {
                InputStream in = gzipped && transform ? new java.util.zip.GZIPInputStream(rawIn) : rawIn;
                if (transform) {
                    BufferedReader br = new BufferedReader(new InputStreamReader(in));
                    StringBuilder sb = new StringBuilder();
                    String l;
                    while ((l = br.readLine()) != null) {
                        String trimmed = l.trim();
                        if (trimmed.isEmpty()) {
                            sb.append(l).append("\n");
                        } else if (!trimmed.startsWith("#")) {
                            // Segment / variant playlist URL line
                            sb.append(rewriteUrlIfNeeded(trimmed, urlStr)).append("\n");
                        } else if (trimmed.contains("URI=\"")) {
                            // EXT-X-KEY, EXT-X-MEDIA (alt audio/subs), EXT-X-MAP,
                            // EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-KEY, ...
                            sb.append(rewriteAllUriAttributes(l, urlStr)).append("\n");
                        } else {
                            sb.append(l).append("\n");
                        }
                    }
                    out.write(sb.toString().getBytes());
                } else {
                    // Byte-stream passthrough (segments); never buffered whole-file.
                    byte[] buffer = new byte[16384];
                    int len;
                    while ((len = in.read(buffer)) != -1) {
                        out.write(buffer, 0, len);
                    }
                }
                in.close();
            }
            out.flush();
            client.close();

        } catch (Exception e) {
            Log.e(TAG, "proxyRequest failed for " + urlStr, e);
            try { sendError(client, 502, "Bad Gateway: " + e.getMessage()); } catch (IOException ex) {}
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String rewriteUrlIfNeeded(String url, String baseUrl) {
        if (url == null || url.isEmpty()) return url;
        if (url.startsWith("http://") || url.startsWith("https://")) {
            try {
                URL base = new URL(baseUrl);
                String baseHost = base.getHost();
                String urlHost = new URL(url).getHost();
                if (urlHost.equals(targetHost) || urlHost.endsWith("." + targetHost)) {
                    String scheme = url.startsWith("https://") ? "https" : "http";
                    String hostPath = url.replaceAll("^https?://", "");
                    return "http://127.0.0.1:" + port + "/" + scheme + "/" + hostPath;
                }
            } catch (Exception e) {}
            return url;
        }
        if (url.startsWith("/")) {
            try {
                URL base = new URL(baseUrl);
                String newUrl = base.getProtocol() + "://" + authorityOf(base) + url;
                return rewriteUrlIfNeeded(newUrl, baseUrl);
            } catch (Exception e) {
                return url;
            }
        }
        try {
            URL base = new URL(baseUrl);
            String basePath = base.getPath();
            int lastSlash = basePath.lastIndexOf("/");
            String dir = lastSlash >= 0 ? basePath.substring(0, lastSlash + 1) : "/";
            String newUrl = base.getProtocol() + "://" + authorityOf(base) + dir + url;
            return rewriteUrlIfNeeded(newUrl, baseUrl);
        } catch (Exception e) {
            return url;
        }
    }

    /** host[:port] - URL.getHost() alone DROPS the port (regression: rewritten
     *  URLs pointed at port 80 and upstreams on non-standard ports broke). */
    private static String authorityOf(URL u) {
        return u.getPort() != -1 ? u.getHost() + ":" + u.getPort() : u.getHost();
    }

    /**
     * Rewrites every URI="..." attribute inside an #EXT-X-* tag line
     * (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP, EXT-X-I-FRAME-STREAM-INF, EXT-X-SESSION-KEY).
     * Handles multiple URI attributes per line (defensive).
     */
    private String rewriteAllUriAttributes(String line, String baseUrl) {
        StringBuilder result = new StringBuilder();
        int cursor = 0;
        while (true) {
            int uriStart = line.indexOf("URI=\"", cursor);
            if (uriStart < 0) {
                result.append(line.substring(cursor));
                break;
            }
            int start = uriStart + 5;
            int end = line.indexOf("\"", start);
            if (end < 0) {
                result.append(line.substring(cursor));
                break;
            }
            result.append(line, cursor, start);
            String uri = line.substring(start, end);
            result.append(rewriteUrlIfNeeded(uri, baseUrl));
            result.append("\"");
            cursor = end + 1;
        }
        return result.toString();
    }

    private void sendError(Socket client, int code, String message) throws IOException {
        String body = message;
        String response = "HTTP/1.1 " + code + " " + message + "\r\n" +
                "Content-Type: text/plain\r\n" +
                "Content-Length: " + body.length() + "\r\n" +
                "Connection: close\r\n\r\n" + body;
        client.getOutputStream().write(response.getBytes());
        client.close();
    }
}
