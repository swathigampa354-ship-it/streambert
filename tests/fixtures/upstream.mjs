// Fixture "CDN" upstream for proxy integration tests.
// Serves master/variant playlists (relative/absolute/query strings/keys/alt-audio),
// binary TS + M4S segments, Range-capable file, redirects, cookies, header echo.
// Usage: node tests/fixtures/upstream.mjs  (prints PORT=<n>)
import http from 'node:http';
import zlib from 'node:zlib';

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const path = u.pathname;

  const send = (code, body, headers = {}) => {
    res.writeHead(code, { 'Content-Type': 'application/octet-stream', ...headers });
    res.end(body);
  };

  if (path === '/echo') {
    // reflect request headers back so tests can assert header injection
    return send(200, JSON.stringify(req.headers), { 'Content-Type': 'application/json' });
  }

  if (path === '/master.m3u8') {
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",URI="audio/prog_index.m3u8?tok=aa"',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,AUDIO="aud"',
      'variant.m3u8?tok=bb',
      '',
    ].join('\n');
    return send(200, body, { 'Content-Type': 'application/vnd.apple.mpegurl' });
  }

  if (path === '/audio/prog_index.m3u8') {
    const body = ['#EXTM3U', '#EXT-X-VERSION:6', '#EXTINF:6.0,', 'a1.ts', ''].join('\n');
    return send(200, body, { 'Content-Type': 'application/vnd.apple.mpegurl' });
  }

  if (path === '/variant.m3u8') {
    const host = req.headers.host;
    const body = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-KEY:METHOD=AES-128,URI="http://${host}/keys/key.bin?k=1",IV=0x00`,
      '#EXT-X-MAP:URI="/init/map.m4s"',
      '#EXTINF:6.0,',
      'seg1.ts?sign=abc',
      '#EXTINF:6.0,',
      '/abs/seg2.m4s?sign=def',
      '#EXTINF:6.0,',
      `http://${host}/full/seg3.ts?sign=ghi`,
      '#EXT-X-ENDLIST',
      '',
    ].join('\n');
    return send(200, body, { 'Content-Type': 'application/vnd.apple.mpegurl' });
  }

  if (path === '/gzipped.m3u8') {
    const body = ['#EXTM3U', '#EXTINF:6.0,', 'seg1.ts', ''].join('\n');
    const gz = zlib.gzipSync(body);
    return send(200, gz, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Content-Encoding': 'gzip' });
  }

  if (path === '/keys/key.bin') {
    return send(200, Buffer.alloc(16, 7), { 'Content-Type': 'application/octet-stream' });
  }

  if (path === '/init/map.m4s') {
    return send(200, Buffer.alloc(32, 9), { 'Content-Type': 'video/iso.segment' });
  }

  if (path === '/seg1.ts' || path === '/abs/seg2.m4s' || path === '/full/seg3.ts' || path === '/audio/a1.ts') {
    const seg = Buffer.alloc(64 * 1024, path.length); // deterministic non-zero bytes
    return send(200, seg, { 'Content-Type': 'video/mp2t' });
  }

  if (path === '/range.bin') {
    const full = Buffer.alloc(256 * 1024);
    for (let i = 0; i < full.length; i++) full[i] = i % 251;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d+)?/.exec(range);
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : full.length - 1;
      const slice = full.subarray(start, Math.min(end + 1, full.length));
      return send(206, slice, {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${full.length}`,
        'Accept-Ranges': 'bytes',
      });
    }
    return send(200, full, { 'Accept-Ranges': 'bytes' });
  }

  if (path === '/redir') {
    return send(302, '', { Location: '/variant.m3u8' });
  }

  if (path === '/redir-cross-host') {
    return send(302, '', { Location: 'http://totally.other.host/x.m3u8' });
  }

  if (path === '/setcookie') {
    return send(200, 'ok', { 'Set-Cookie': 'session=abc123; Path=/', 'Content-Type': 'text/plain' });
  }

  if (path === '/sub/en.vtt') {
    return send(200, 'WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n', { 'Content-Type': 'text/vtt' });
  }

  if (path === '/fail500') {
    return send(500, 'broken', { 'Content-Type': 'text/plain' });
  }

  return send(404, 'not found: ' + path, { 'Content-Type': 'text/plain' });
});

server.listen(0, '127.0.0.1', () => {
  console.log('PORT=' + server.address().port);
});
