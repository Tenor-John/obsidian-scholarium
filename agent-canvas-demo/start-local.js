/* Local launcher: the browser never sees the Bridge token. */
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = __dirname;
const HOST = '127.0.0.1';
const REQUESTED_PORT = Number(process.env.AGENT_CANVAS_PORT || 4173);
const REQUESTED_BRIDGE_PORT = Number(process.env.AGENT_BRIDGE_PORT || 4318);
// Must resolve to the exact same file server.js is reading (see the matching
// override there): this launcher reads the token straight off disk to inject
// it into proxied requests, so if the two processes disagreed on which
// config file is "the" config, every /bridge/* request would 401 against a
// stale or mismatched token.
const CONFIG_PATH = process.env.AGENT_BRIDGE_CONFIG_PATH
  ? path.resolve(process.env.AGENT_BRIDGE_CONFIG_PATH)
  : path.join(ROOT, 'bridge', 'bridge.config.json');
const PIDFILE = process.env.AGENT_WEAVER_PIDFILE
  ? path.resolve(process.env.AGENT_WEAVER_PIDFILE)
  : path.join(os.tmpdir(), `scholarium-weaver-${process.pid}.pid.json`);
const RUNTIME_ASSETS_ROOT = process.env.SCHOLARIUM_RUNTIME_ASSETS_ROOT
  ? path.resolve(process.env.SCHOLARIUM_RUNTIME_ASSETS_ROOT)
  : null;
const SHORT_BRIDGE_TIMEOUT_MS = 15000;
// Must exceed the largest runner budget in bridge/server.js's SKILL_RUNNERS
// (scansci-institutional is 40 min). At the old 240s this proxy 504'd first and
// the UI reported "机构通道不可用 … request timed out" while the download was
// still running perfectly well underneath — the step had not failed, the
// connection had just been cut. Let the runner's own timeout fire instead: it
// knows which skill it killed and says so.
const LONG_BRIDGE_TIMEOUT_MS = 45 * 60 * 1000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

let bridge = null;
let stopping = false;
let pendingStart = false;
let actualCanvasPort = 0;
let actualBridgePort = 0;
function writePidfile() {
  try {
    fs.mkdirSync(path.dirname(PIDFILE), { recursive: true });
    fs.writeFileSync(PIDFILE, JSON.stringify({ launcherPid: process.pid, bridgePid: bridge?.pid || null, canvasPort: actualCanvasPort, bridgePort: actualBridgePort, configPath: CONFIG_PATH, startedAt: new Date().toISOString() }, null, 2), 'utf8');
  } catch (error) { console.error(`Could not write Research Weaver pidfile: ${error.message}`); }
}
function removePidfile() {
  try { if (JSON.parse(fs.readFileSync(PIDFILE, 'utf8')).launcherPid === process.pid) fs.unlinkSync(PIDFILE); }
  catch { /* stale/missing pidfile is harmless */ }
}
/* Stop the Bridge AND everything it spawned.
   ------------------------------------------------------------------------
   A bare `bridge.kill()` terminates only server.js. But server.js dispatches
   agents and skills that spawn their own children — Claude, Codex, Python,
   and Playwright's Chromium — and those survive the parent. server.js already
   knows this: its own task-timeout path uses `taskkill /T /F` with the comment
   "these runners spawn Python/Chrome children that outlive a bare child.kill()
   and would keep holding the profile lock."

   The shutdown path needs the same treatment for the same reason. Without it,
   clicking 断开 mid-download leaves Chromium running and holding the browser
   profile lock, and the next 连接 fails on a lock owned by a process the user
   has no way to see. Kill the tree, then fall back to the plain kill so a
   platform without taskkill still stops the Bridge itself. */
function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try { spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }); }
    catch { /* fall through to the direct kill below */ }
  } else {
    // Not a process-group leader (no `detached`), so a group kill is only
    // best-effort; the direct kill below is what reliably stops the Bridge.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* no group, or already gone */ }
  }
  try { child.kill(); } catch { /* already gone */ }
}

function startBridge() {
  if (bridge && bridge.exitCode === null && !bridge.killed) return bridge;
  if (bridge && bridge.exitCode === null && bridge.killed) { pendingStart = true; return bridge; }
  const child = spawn(process.execPath, [path.join(ROOT, 'bridge', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    windowsHide: true,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(REQUESTED_BRIDGE_PORT), AGENT_CANVAS_PORT: String(actualCanvasPort), AGENT_BRIDGE_CONFIG_PATH: CONFIG_PATH }
  });
  bridge = child;
  actualBridgePort = 0;
  child.on('message', (message) => {
    if (message?.type === 'listening' && message.service === 'bridge') {
      actualBridgePort = Number(message.port) || 0;
      writePidfile();
      if (process.send) process.send({ type: 'listening', canvasPort: actualCanvasPort, bridgePort: actualBridgePort, launcherPid: process.pid, bridgePid: child.pid });
    }
    if (message?.type === 'listen-error' && process.send) process.send(message);
  });
  child.on('error', (error) => console.error(`Bridge could not start: ${error.message}`));
  child.on('exit', (code) => {
    if (code && code !== 0 && !stopping) console.error(`Bridge stopped with exit code ${code}.`);
    if (bridge === child) { bridge = null; actualBridgePort = 0; }
    writePidfile();
    if (pendingStart && !stopping) { pendingStart = false; startBridge(); }
  });
  writePidfile();
  return bridge;
}

function bridgeToken() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).token; }
  catch { return null; }
}
function cookieValue(req, name) {
  const prefix = `${name}=`;
  const item = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : null;
}
/* Control-plane credential.
   ------------------------------------------------------------------------
   The first design authenticated the toggle with an HttpOnly cookie carrying
   the Bridge token (`SameSite=Strict; Path=/bridge/control`). It could never
   have worked in the place it actually runs: the canvas is an <iframe> whose
   origin is http://127.0.0.1:<port> inside an Obsidian window whose origin is
   app://obsidian.md. That is a CROSS-SITE context, and a SameSite=Strict
   cookie is withheld there — including on same-origin fetches made from
   inside the frame. The cookie was set correctly and simply never came back,
   so every 断开 returned 401 "Bridge control requires the local Bridge token."

   Fix: a control-only token, minted per launcher run and handed to the page
   through a same-origin endpoint. It is deliberately NOT the Bridge token —
   the page still cannot call /v1/* directly, which was the property the
   original design was protecting. It only authorizes start/stop/status on
   this launcher.

   Honest limit: /bridge/control/token has to accept a request with no Origin
   header, because browsers omit Origin on same-origin GETs. A local non-browser
   process can therefore obtain it — but such a process can already read the
   Bridge token straight out of bridge.config.json, so nothing is lost that was
   really being protected. What the Origin check does defend against, and still
   does, is a web page in a browser trying to stop the Bridge: its Origin is its
   own site, so it is refused, and CORS keeps it from reading this response. */
const CONTROL_TOKEN = crypto.randomBytes(24).toString('hex');
function controlAuthorized(req) {
  if (req.headers['x-scholarium-control-token'] === CONTROL_TOKEN) return true;
  const token = bridgeToken();
  if (!token) return false;
  return req.headers['x-agent-bridge-token'] === token || cookieValue(req, 'scholarium_bridge_token') === token;
}
function corsHeaders(req) {
  // The token stays in this launcher. Only the local Research Weaver page and
  // the Obsidian desktop origin may ask this launcher to proxy a Bridge call.
  const origin = req.headers.origin;
  if (origin !== 'app://obsidian.md' && origin !== `http://${HOST}:${actualCanvasPort}`) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type, x-scholarium-control-token, x-scholarium-user-confirmed',
    'access-control-allow-credentials': 'true',
    'access-control-max-age': '600',
    vary: 'Origin'
  };
}
function localControlOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === 'app://obsidian.md' || origin === `http://${HOST}:${actualCanvasPort}`;
}
function controlResponse(res, status, payload, req) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(req) }).end(JSON.stringify(payload));
}
function bridgeControl(req, res, url) {
  const controlPath = ['/bridge/control/token', '/bridge/control/status', '/bridge/control/start', '/bridge/control/shutdown'].includes(url.pathname);
  if (!controlPath) return false;
  if (!localControlOrigin(req)) return controlResponse(res, 403, { error: 'Bridge control is local-only.' }, req);
  // The bootstrap: hands the page its control credential. Origin-checked like
  // everything else here, but necessarily not token-checked — it is where the
  // token comes from.
  if (req.method === 'GET' && url.pathname === '/bridge/control/token')
    return controlResponse(res, 200, { token: CONTROL_TOKEN }, req);
  if (!controlAuthorized(req)) return controlResponse(res, 401, { error: 'Bridge control requires the local Bridge token.' }, req);
  if (req.method === 'GET' && url.pathname === '/bridge/control/status') {
    return controlResponse(res, 200, { online: Boolean(bridge && bridge.exitCode === null && !bridge.killed), launcherPid: process.pid, bridgePid: bridge?.pid || null, canvasPort: actualCanvasPort, bridgePort: actualBridgePort }, req);
  }
  if (req.method !== 'POST') return controlResponse(res, 405, { error: 'Bridge control requires POST.' }, req);
  if (url.pathname === '/bridge/control/start') {
    startBridge();
    return controlResponse(res, 202, { ok: true, starting: true, bridgePid: bridge?.pid || null }, req);
  }
  if (url.pathname === '/bridge/control/shutdown') {
    if (bridge && bridge.exitCode === null && !bridge.killed) killTree(bridge);
    writePidfile();
    return controlResponse(res, 200, { ok: true, online: false }, req);
  }
  return false;
}
function proxyBridge(req, res, url) {
  const control = bridgeControl(req, res, url);
  if (control !== false) return;
  const token = bridgeToken();
  const cors = corsHeaders(req);
  if (!actualBridgePort) { res.writeHead(503, { 'content-type': 'application/json', ...cors }).end(JSON.stringify({ error: 'Local Bridge is starting. Retry in a moment.' })); return; }
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
    // This marker is intentionally the only caller-controlled authority header
    // forwarded to Bridge. It represents an explicit click in the local UI;
    // every other authority and all schema metadata remain server-owned.
    if (String(req.headers['x-scholarium-user-confirmed'] || '').toLowerCase() === 'true')
      headers['x-scholarium-user-confirmed'] = 'true';
    const bridgePath = url.pathname.slice('/bridge'.length) + url.search;
    // Literature search is synchronous at the Bridge boundary: one request can
    // fan out to several scholarly providers and legitimately take longer than
    // the generic 15-second UI timeout.  Treat it like Agent/Skill execution so
    // the query-refinement loop is not reported as a mysterious failure while
    // its real-record sampling is still running upstream.
    const isLongBridgeRequest = /^\/v1\/(?:skills\/run|tasks|literature\/search)(?:\/|$)/.test(bridgePath);
    const timeout = isLongBridgeRequest ? LONG_BRIDGE_TIMEOUT_MS : SHORT_BRIDGE_TIMEOUT_MS;
    const upstream = http.request({ host: HOST, port: actualBridgePort, path: bridgePath, method: req.method, headers, timeout }, (upstreamResponse) => {
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
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
    // The control plane uses the same token as /v1/*, but keeps it out of page
    // JavaScript. An HttpOnly cookie lets the local canvas toggle the Bridge;
    // arbitrary local processes without the token can no longer stop it.
    if (requested === '/') {
      const token = bridgeToken();
      if (token) headers['set-cookie'] = `scholarium_bridge_token=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/bridge/control`;
    }
    res.writeHead(200, headers);
    res.end(content);
  });
}
function serveRuntimeAsset(req, res, url) {
  const prefix = '/runtime-assets/ketcher/';
  if (!url.pathname.startsWith(prefix)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end('Method not allowed');
    return true;
  }
  if (!RUNTIME_ASSETS_ROOT) {
    res.writeHead(404).end('Runtime assets are not configured');
    return true;
  }
  const name = decodeURIComponent(url.pathname.slice(prefix.length));
  if (name !== 'ketcher.js' && name !== 'ketcher.css') {
    res.writeHead(404).end('Runtime asset not found');
    return true;
  }
  const ketcherRoot = path.join(RUNTIME_ASSETS_ROOT, 'ketcher');
  const file = path.join(ketcherRoot, name);
  if (path.dirname(file) !== ketcherRoot) {
    res.writeHead(403).end('Forbidden');
    return true;
  }
  fs.readFile(file, (error, content) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Runtime asset unavailable');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'content-length': content.length,
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(content);
  });
  return true;
}
const web = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${actualCanvasPort || REQUESTED_PORT || 80}`);
  if ((url.pathname === '/bridge' || url.pathname.startsWith('/bridge/')) && req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req)).end(); return;
  }
  if (url.pathname === '/bridge' || url.pathname.startsWith('/bridge/')) return proxyBridge(req, res, url);
  if (serveRuntimeAsset(req, res, url)) return;
  return serveFile(req, res, url);
});
web.on('error', (error) => {
  if (error.code === 'EADDRINUSE') console.error(`Port ${REQUESTED_PORT} is already in use. Stop the other Research Weaver window, then run npm start again.`);
  else console.error(`Local web server could not start: ${error.message}`);
  if (process.send) process.send({ type: 'listen-error', service: 'canvas', code: error.code || 'LISTEN_FAILED', message: error.message });
  if (bridge) killTree(bridge);
  process.exitCode = 1;
});
web.listen(REQUESTED_PORT, HOST, () => {
  const address = web.address();
  actualCanvasPort = address && typeof address === 'object' ? address.port : REQUESTED_PORT;
  writePidfile();
  console.log(`Research Weaver: http://${HOST}:${actualCanvasPort}`);
  startBridge();
});

function shutdown() {
  if (stopping) return;
  stopping = true;
  web.close();
  // Closing Obsidian must not orphan Chromium either — same reasoning as the
  // 断开 button, and the more common path of the two.
  if (bridge) killTree(bridge);
  bridge = null;
  removePidfile();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('message', (message) => {
  if (message && message.type === 'shutdown') shutdown();
});
