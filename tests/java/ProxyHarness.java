import expo.modules.externalplayer.AndroidProxyServer;
import java.util.HashMap;
import java.util.Map;

/**
 * Runs the REAL AndroidProxyServer (compiled from the module source) on a JVM.
 * Usage: java ProxyHarness <targetUrl> <referer> <userAgent> <cookie|-> [subtitleUrl|-]
 * Prints: PORT=<port> once listening; then stays alive.
 */
public class ProxyHarness {
    public static void main(String[] args) throws Exception {
        String target = args[0];
        Map<String, String> headers = new HashMap<>();
        if (!"-".equals(args[1])) headers.put("Referer", args[1]);
        if (!"-".equals(args[2])) headers.put("User-Agent", args[2]);
        if (!"-".equals(args[3])) headers.put("Cookie", args[3]);
        String subtitleUrl = args.length > 4 && !"-".equals(args[4]) ? args[4] : null;

        AndroidProxyServer server = new AndroidProxyServer(target, headers, subtitleUrl);
        server.start();
        System.out.println("PORT=" + server.getPort());
        System.out.flush();
        Thread.currentThread().join();
    }
}
