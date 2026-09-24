#!/usr/bin/env python3
"""End-to-end assertions for the REAL AndroidProxyServer (running on JVM)
against the fixture upstream (tests/fixtures/upstream.mjs).

Usage: python3 tests/test_proxy_java.py <upstreamPort> <proxyPort>
Prints PASS/FAIL per assertion, exits non-zero on any failure."""
import sys, urllib.request, urllib.error, re

UP = int(sys.argv[1])
PP = int(sys.argv[2])
U = f"http://127.0.0.1:{UP}"
P = f"http://127.0.0.1:{PP}"

results = []

def check(label, cond, extra=""):
    results.append((bool(cond), label, extra))

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

_opener = urllib.request.build_opener(_NoRedirect)

def fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with _opener.open(req, timeout=15) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

# 1) master playlist via proxy: rewritten variant + EXT-X-MEDIA URI, query strings kept
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/master.m3u8")
text = body.decode()
check("master: HTTP 200 via proxy", st == 200, f"status={st}")
check("master: variant rewritten to proxy", f"{P}/http/127.0.0.1:{UP}/variant.m3u8?tok=bb" in text, text[:300])
check("master: EXT-X-MEDIA alt-audio URI rewritten", f'URI="{P}/http/127.0.0.1:{UP}/audio/prog_index.m3u8?tok=aa"' in text, text[:300])
check("master: query strings preserved", "tok=bb" in text and "tok=aa" in text)
check("master: no stale Content-Length forwarded (rewritten body)",
      "Content-Length" not in hd or hd.get("Content-Length") == str(len(body)),
      f"headers={ {k:v for k,v in hd.items() if k.lower() in ('content-length','content-type')} }")

# 2) variant playlist: key URI + map URI + every segment kind rewritten
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/variant.m3u8")
text = body.decode()
check("variant: HTTP 200", st == 200)
check("variant: EXT-X-KEY URI rewritten", f'URI="{P}/http/127.0.0.1:{UP}/keys/key.bin?k=1"' in text, text[:400])
check("variant: EXT-X-MAP (init segment) rewritten", f'URI="{P}/http/127.0.0.1:{UP}/init/map.m4s"' in text, text[:400])
check("variant: relative segment rewritten", f"{P}/http/127.0.0.1:{UP}/seg1.ts?sign=abc" in text)
check("variant: root-relative m4s segment rewritten", f"{P}/http/127.0.0.1:{UP}/abs/seg2.m4s?sign=def" in text)
check("variant: absolute segment rewritten", f"{P}/http/127.0.0.1:{UP}/full/seg3.ts?sign=ghi" in text)
check("variant: EXT-X-ENDLIST preserved", "#EXT-X-ENDLIST" in text)

# 3) gzipped playlist is decompressed, rewritten, and NOT forwarded as gzip
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/gzipped.m3u8")
text = body.decode(errors="replace")
check("gzip playlist: HTTP 200", st == 200)
check("gzip playlist: decompressed + rewritten", "seg1.ts" in text and P in text, body[:80].hex())
check("gzip playlist: Content-Encoding stripped after transform", "Content-Encoding" not in hd, str(hd))

# 4) binary segment passthrough is byte-identical (seek-critical)
st1, _, direct = fetch(f"{U}/seg1.ts")
st2, _, proxied = fetch(f"{P}/http/127.0.0.1:{UP}/seg1.ts")
check("segment: 200 both", st1 == 200 and st2 == 200, f"{st1}/{st2}")
check("segment: byte-identical 64KB passthrough", direct == proxied, f"{len(direct)} vs {len(proxied)}")

# 5) Range request forwarded -> 206 + Content-Range + correct slice
st, hd, proxied = fetch(f"{P}/http/127.0.0.1:{UP}/range.bin", {"Range": "bytes=1000-1999"})
st2, hd2, direct = fetch(f"{U}/range.bin", {"Range": "bytes=1000-1999"})
check("range: proxy returns 206", st == 206, f"status={st}")
check("range: Content-Range forwarded", "Content-Range" in hd and "bytes 1000-1999" in hd["Content-Range"], str(hd.get("Content-Range")))
check("range: bytes identical to direct range fetch", proxied == direct, f"{len(proxied)} vs {len(direct)}")

# 6) redirect Location rewritten to stay inside the proxy
st, hd, _ = fetch(f"{P}/http/127.0.0.1:{UP}/redir")
check("redirect: 302 forwarded", st == 302, f"status={st}")
check("redirect: Location rewritten through proxy", hd.get("Location", "").startswith(f"{P}/http/127.0.0.1:{UP}/"), hd.get("Location"))

# 7) cross-host redirect NOT rewritten (host validation boundary)
st, hd, _ = fetch(f"{P}/http/127.0.0.1:{UP}/redir-cross-host")
check("cross-host redirect: Location left absolute (client re-enters proxy w/ valid host check)", hd.get("Location") == "http://totally.other.host/x.m3u8", hd.get("Location"))

# 8) cookie header from upstream forwarded to player
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/setcookie")
check("set-cookie: forwarded to client", "session=abc123" in hd.get("Set-Cookie", ""), hd.get("Set-Cookie"))

# 9) configured headers (Referer/UA/Cookie) injected upstream
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/echo")
h = dict((k.lower(), v) for k, v in __import__("json").loads(body.decode()).items())
check("headers: Referer injected", h.get("referer") == "https://provider.example/embed/1", str(h))
check("headers: User-Agent injected", h.get("user-agent") == "StreambertTestUA/1.0", str(h))
check("headers: Cookie injected (proxy mandatory reason)", h.get("cookie") == "cf_clearance=xyz", str(h))

# 10) host validation: foreign host -> 403 (proxy is not an open relay)
st, hd, body = fetch(f"{P}/http/evil.example.com/master.m3u8")
check("security: foreign host blocked 403", st == 403, f"status={st}")

# 11) subtitle host was NOT configured for this proxy instance -> 403
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/sub/en.vtt".replace(f"127.0.0.1:{UP}", f"127.0.0.1:{UP}"))
# same host is the target host, so this is allowed - validate content instead
check("subtitle via proxy (same host): served", st == 200 and body.startswith(b"WEBVTT"), f"status={st}")

# 12) upstream 5xx surfaces as proxy 502 or forwarded 5xx (never fake 200)
st, hd, body = fetch(f"{P}/http/127.0.0.1:{UP}/fail500")
check("error: upstream 500 not masked", st >= 500, f"status={st}")

# --- report ----------------------------------------------------------------
fails = [r for r in results if not r[0]]
for okflag, label, extra in results:
    if not okflag:
        print(f"  FAIL {label} :: {extra[:200]}")
print(f"[{'PASS' if not fails else 'FAIL'}] proxyJavaE2E: {len(results)-len(fails)} passed, {len(fails)} failed")
sys.exit(1 if fails else 0)
