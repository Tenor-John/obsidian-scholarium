/* Local launcher: the browser never sees the Bridge token. */
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENT_CANVAS_PORT || 4173);
const BRIDGE_PORT = Number(process.env.AGENT_BRIDGE_PORT || 4318);
// Must resolve to the exact same file server.js is reading (see the matching
// override there): this launcher reads the token straight off disk to inject
// it into proxied requests, so if the two processes disagreed on which
// config file is "the" config, every /bridge/* request would 401 against a
// stale or mismatched token.
const CONFIG_PATH = process.env.AGENT_BRIDGE_CONFIG_PATH
  ? path.resolve(process.env.AGENT_BRIDGE_CONFIG_PATH)
  : path.join(ROOT, 'bridge', 'bridge.config.json');
const SHORT_BRIDGE_TIMEOUT_MS = 15000;
// Must exceed the largest runner budget in bridge/server.js's SKILL_RUNNERS
// (scansci-institutional is 40 min). At the old 240s this proxy 504'd first and
// the UI reported "机构通道不可用 … request timed out" while the download was
// still running perfectly well underneath — the step had not failed, the
// connection had just been cut. Let the runner's own timeout fire instead: it
// knows which skill it killed and says so.
const LONG_BRIDGE_TIMEOUT_MS = 45 * 60 * 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge', 'server.js')], {
  cwd: ROOT,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, AGENT_BRIDGE_PORT: String(BRIDGE_PORT) }
});
bridge.on('error', (error) => console.error(`Bridge could not start: ${error.message}`));
bridge.on('exit', (code) => { if (code && code !== 0) console.error(`Bridge stopped with exit code ${code}.`); });

function bridgeToken() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).token; }
  catch { return null; }
}
function corsHeaders(req) {
  // The token stays in this launcher. Only the local Research Weaver page and
  // the Obsidian desktop origin may ask this launcher to proxy a Bridge call.
  const origin = req.headers.origin;
  if (origin !== 'app://obsidian.md' && origin !== `http://${HOST}:${PORT}`) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'Origin'
  };
}
function proxyBridge(req, res, url) {
  const token = bridgeToken();
  const cors = corsHeaders(req);
  if (!token) { res.writeHead(503, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ error: 'Local Bridge is starting. Retry in a moment.' })); return; }
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    const headers = {
      'content-type': req.headers['content-type'] || 'application/json',
      'content-length': rawBody.length,
      'x-agent-bridge-token': token
    };
    const bridgePath = url.pathname.slice('/bridge'.length) + url.search;
    // Literature search is synchronous at the Bridge boundary: one request can
    // fan out to several scholarly providers and legitimately take longer than
    // the generic 15-second UI timeout.  Treat it like Agent/Skill execution so
    // the query-refinement loop is not reported as a mysterious failure while
    // its real-record sampling is still running upstream.
    const isLongBridgeRequest = /^\/v1\/(?:skills\/run|tasks|literature\/search)(?:\/|$)/.test(bridgePath);
    const timeout = isLongBridgeRequest ? LONG_BRIDGE_TIMEOUT_MS : SHORT_BRIDGE_TIMEOUT_MS;
    const upstream = http.request({ host: HOST, port: BRIDGE_PORT, path: bridgePath, method: req.method, headers, timeout }, (upstreamResponse) => {
      res.writeHead(upstreamResponse.statusCode || 502, { ...upstreamResponse.headers, ...cors });
      upstreamResponse.pipe(res);
    });
    upstream.on('timeout', () => {
      upstream.destroy();
      if (!res.headersSent) res.writeHead(504, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ error: `Local Bridge request timed out after ${Math.round(timeout / 1000)} seconds. Restart the Bridge if this repeats.` }));
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ error: 'Local Bridge is not running.' }));
    });
    upstream.end(rawBody);
  });
  req.on('error', () => {
    if (!res.headersSent) res.writeHead(400, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ error: 'Invalid browser request.' }));
  });
}
function serveFile(req, res, url) {
  const requested = url.pathname;
  const file = path.resolve(ROOT, requested === '/' ? 'index.html' : `.${decodeURIComponent(requested)}`);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  });
}
const web = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if ((url.pathname === '/bridge' || url.pathname.startsWith('/bridge/')) && req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req)).end(); return;
  }
  if (url.pathname === '/bridge' || url.pathname.startsWith('/bridge/')) return proxyBridge(req, res, url);
  return serveFile(req, res, url);
});
web.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Stop the other Research Weaver window, then run npm start again.`);
  else console.error(`Local web server could not start: ${error.message}`);
  bridge.kill();
  process.exitCode = 1;
});
web.listen(PORT, HOST, () => console.log(`Research Weaver: http://${HOST}:${PORT}`));

function shutdown() { web.close(); bridge.kill(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
