const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
let canvasPort;
let bridgePort;
// The real bridge.config.json on this machine points workspaceRoot at the
// researcher's live Obsidian vault (not at this project directory), so a
// test process reading it would validate paths against the vault and write
// (or fail to find) files there instead of under `root`. Point the spawned
// Bridge at a disposable config file instead: with no file at this path yet,
// server.js's loadConfig() falls back to its built-in default, which sets
// workspaceRoot to the Bridge's own project root — exactly `root` above.
const configPath = path.join(os.tmpdir(), `agent-canvas-bridge-test-${process.pid}.config.json`);
const pidfilePath = `${configPath}.pid.json`;
const runtimeAssetsRoot = path.join(os.tmpdir(), `agent-canvas-runtime-assets-${process.pid}`);
let launcher;
let launcherOutput = '';
let controlHeaders = {};
let controlCookie = '';

// PORT-HARNESS-EXEMPT: freePort remains only until the documented runtime
// port-consistency work is implemented; see docs/runtime-port-consistency-2026-09-17.md
// (25d4696). Do not copy this pattern into other tests.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(options.body) } : {}), ...(options.headers || {}) };
    const req = http.request({ host: '127.0.0.1', port: canvasPort, path: pathname, method: options.method || 'GET', headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
function requestBridge(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: bridgePort,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}
async function waitForServer() {
  let lastError;
  // First-run config generation probes PATH and common install locations;
  // antivirus and a cold npm shim can make that take several seconds.
  for (let attempt = 0; attempt < 120; attempt++) {
    try { const response = await request('/bridge/health'); if (response.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${lastError?.message || 'local launcher did not start'}\n${launcherOutput}`);
}

test.before(async () => {
  fs.mkdirSync(path.join(runtimeAssetsRoot, 'ketcher'), { recursive: true });
  fs.writeFileSync(path.join(runtimeAssetsRoot, 'ketcher', 'ketcher.js'), 'globalThis.__ketcherFixture = true;\n');
  fs.writeFileSync(path.join(runtimeAssetsRoot, 'ketcher', 'ketcher.css'), '.ketcher-fixture { color: green; }\n');
  canvasPort = await freePort();
  while (canvasPort === 4173) canvasPort = await freePort();
  bridgePort = await freePort();
  while (bridgePort === canvasPort) bridgePort = await freePort();
  launcherOutput = `ports ${canvasPort}/${bridgePort}\n`;
  launcher = spawn(process.execPath, ['start-local.js'], { cwd: root, env: { ...process.env, AGENT_CANVAS_PORT: String(canvasPort), AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_WEAVER_PIDFILE: pidfilePath, SCHOLARIUM_RUNTIME_ASSETS_ROOT: runtimeAssetsRoot }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  launcher.stdout.on('data', (data) => { launcherOutput += String(data); });
  launcher.stderr.on('data', (data) => { launcherOutput += String(data); });
  launcher.on('error', (error) => { launcherOutput += `launcher error: ${error.message}\n`; });
  launcher.on('exit', (code, signal) => { launcherOutput += `launcher exit: ${code}/${signal}\n`; });
  await waitForServer();
  controlHeaders = { 'x-agent-bridge-token': JSON.parse(fs.readFileSync(configPath, 'utf8')).token };
});

test('Bridge CORS reflects only the actual canvas or Obsidian origin', async () => {
  const actualCanvasOrigin = `http://127.0.0.1:${canvasPort}`;
  const allowedCanvas = await requestBridge('/health', { headers: { origin: actualCanvasOrigin } });
  assert.equal(allowedCanvas.status, 200, allowedCanvas.body);
  assert.equal(allowedCanvas.headers['access-control-allow-origin'], actualCanvasOrigin);

  const allowedObsidian = await requestBridge('/health', { headers: { origin: 'app://obsidian.md' } });
  assert.equal(allowedObsidian.status, 200, allowedObsidian.body);
  assert.equal(allowedObsidian.headers['access-control-allow-origin'], 'app://obsidian.md');

  for (const rejectedOrigin of ['http://127.0.0.1:4173', `${actualCanvasOrigin}.evil.example`]) {
    const rejected = await requestBridge('/health', { headers: { origin: rejectedOrigin } });
    assert.equal(rejected.status, 200, rejected.body);
    assert.equal(rejected.headers['access-control-allow-origin'], undefined,
      `Bridge must not authorize stale or hostile origin ${rejectedOrigin}`);
  }
});
test.after(async () => {
  if (launcher && launcher.exitCode === null) {
    launcher.send({ type: 'shutdown', reason: 'local-launcher-test' });
    await new Promise((resolve) => launcher.once('exit', resolve));
  }
  if (fs.existsSync(configPath)) fs.rmSync(configPath);
  if (fs.existsSync(pidfilePath)) fs.rmSync(pidfilePath);
  if (fs.existsSync(runtimeAssetsRoot)) fs.rmSync(runtimeAssetsRoot, { recursive: true, force: true });
});

test('local launcher serves the canvas and injects Bridge authentication', async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Research Weaver/);
  assert.match(page.headers['set-cookie']?.[0] || '', /^scholarium_bridge_token=[^;]+;/, 'the launcher must issue an HttpOnly control cookie');
  controlCookie = page.headers['set-cookie'][0].split(';', 1)[0];

  const diagnostics = await request('/bridge/v1/diagnostics');
  assert.equal(diagnostics.status, 200);
  const payload = JSON.parse(diagnostics.body);
  assert.equal(typeof payload.executionEnabled, 'boolean');
  assert.equal(typeof payload.workspace.root, 'string');
  assert.ok(payload.agents.every((agent) => ['command_detected', 'missing'].includes(agent.readiness)));

  const skills = await request('/bridge/v1/skills');
  assert.equal(skills.status, 200);
  assert.ok(Array.isArray(JSON.parse(skills.body).skills));
  const generated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(generated.agentDetection, 'a first-run config records the detection provenance');
  assert.ok(generated.adapters && typeof generated.adapters === 'object');
  if (generated.agentDetection.results?.claude?.ok) {
    assert.match(generated.adapters.claude.args.join(' '), /--output-format json/);
    assert.match(generated.adapters.claude.args.join(' '), /--strict-mcp-config/);
  }
});

test('packaged Ketcher assets are served from a narrow read-only route', async () => {
  const script = await request('/runtime-assets/ketcher/ketcher.js');
  assert.equal(script.status, 200, script.body);
  assert.match(script.headers['content-type'], /javascript/);
  assert.match(script.body, /__ketcherFixture/);

  const style = await request('/runtime-assets/ketcher/ketcher.css');
  assert.equal(style.status, 200, style.body);
  assert.match(style.headers['content-type'], /css/);
  assert.match(style.body, /ketcher-fixture/);

  for (const unsafe of [
    '/runtime-assets/ketcher/../bridge/server.js',
    '/runtime-assets/ketcher/%2e%2e%2fbridge%2fserver.js',
    '/runtime-assets/ketcher/other.js',
  ]) {
    const refused = await request(unsafe);
    assert.notEqual(refused.status, 200, `${unsafe} must not escape the Ketcher allow-list`);
  }
});

test('local launcher forwards only an explicit manual-draft confirmation marker', async () => {
  const origin = `http://127.0.0.1:${canvasPort}`;
  const withoutConfirmation = await request('/bridge/v1/manual-drafts/batch', {
    method: 'POST', body: '{}', headers: { origin },
  });
  assert.equal(withoutConfirmation.status, 403, withoutConfirmation.body);
  assert.match(JSON.parse(withoutConfirmation.body).error, /explicit user confirmation/i);

  const withConfirmation = await request('/bridge/v1/manual-drafts/batch', {
    method: 'POST', body: '{}', headers: { origin, 'x-scholarium-user-confirmed': 'true' },
  });
  assert.equal(withConfirmation.status, 400, withConfirmation.body);
  assert.match(JSON.parse(withConfirmation.body).error, /items must be a non-empty array/i);
  assert.match(withConfirmation.headers['access-control-allow-headers'] || '', /x-scholarium-user-confirmed/i);
});

test('Bridge can be stopped and started again without killing the canvas launcher', async () => {
  const unauthorized = await request('/bridge/control/status');
  assert.equal(unauthorized.status, 401);
  const stopped = await request('/bridge/control/shutdown', { method: 'POST', headers: { cookie: controlCookie } });
  assert.equal(stopped.status, 200);
  assert.equal(JSON.parse(stopped.body).online, false);
  const status = await request('/bridge/control/status', { headers: { cookie: controlCookie } });
  assert.equal(JSON.parse(status.body).online, false);

  const started = await request('/bridge/control/start', { method: 'POST', headers: controlHeaders });
  assert.equal(started.status, 202);
  await waitForServer();
  const restarted = await request('/bridge/control/status', { headers: { cookie: controlCookie } });
  assert.equal(JSON.parse(restarted.body).online, true);
  assert.ok(JSON.parse(fs.readFileSync(pidfilePath, 'utf8')).bridgePid);
});

test('manual agent paths are accepted only after a real version probe', async () => {
  const configured = await request('/bridge/v1/agents/configure', { method: 'POST', body: JSON.stringify({ overrides: { claude: process.execPath } }) });
  assert.equal(configured.status, 200);
  const payload = JSON.parse(configured.body);
  assert.equal(payload.ok, true);
  const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(saved.adapters.claude.command, process.execPath);
  assert.match(saved.adapters.claude.args.join(' '), /--output-format json/);

  const rejected = await request('/bridge/v1/agents/configure', { method: 'POST', body: JSON.stringify({ overrides: { claude: path.join(os.tmpdir(), 'does-not-exist-claude.cmd') } }) });
  assert.equal(rejected.status, 400);
});

test('long-running literature search is not assigned the 15-second proxy timeout', () => {
  const launcherSource = fs.readFileSync(path.join(root, 'start-local.js'), 'utf8');
  assert.match(launcherSource, /tasks\|literature\\\/search/);
  assert.match(launcherSource, /isLongBridgeRequest \? LONG_BRIDGE_TIMEOUT_MS/);
});

test('workspace endpoint rejects unsafe paths, but can explicitly create a fresh topic folder', async () => {
  const response = await request('/bridge/v1/workspace', { method: 'PUT', body: JSON.stringify({ root: 'not-an-absolute-path' }) });
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /absolute local path/);

  const fresh = path.join(root, `workspace-created-by-test-${process.pid}`);
  try {
    const created = await request('/bridge/v1/workspace', { method: 'PUT', body: JSON.stringify({ root: fresh, createMissing: true }) });
    assert.equal(created.status, 200);
    assert.equal(JSON.parse(created.body).root, fresh);
    assert.ok(fs.statSync(fresh).isDirectory());
    const restored = await request('/bridge/v1/workspace', { method: 'PUT', body: JSON.stringify({ root }) });
    assert.equal(restored.status, 200);
  } finally {
    if (fs.existsSync(fresh)) fs.rmSync(fresh, { recursive: true, force: true });
  }
});

test('source inventory is an allow-listed read-only executable Skill', async () => {
  const skillList = await request('/bridge/v1/skills');
  const inventory = JSON.parse(skillList.body).skills.find((skill) => skill.name === 'research-source-inventory');
  assert.ok(inventory, 'the local inventory Skill should be discoverable');
  const run = await request('/bridge/v1/skills/run', { method: 'POST', body: JSON.stringify({ skillId: inventory.id, workspace: root }) });
  assert.equal(run.status, 200);
  const payload = JSON.parse(run.body);
  assert.equal(payload.skill.name, 'research-source-inventory');
  assert.equal(typeof payload.manifest.no_scientific_sources_found, 'boolean');
  assert.ok(Array.isArray(payload.manifest.candidate_evidence));
});

test('query builder produces an unexecuted, reproducible search manifest', async () => {
  const skillList = await request('/bridge/v1/skills');
  const builder = JSON.parse(skillList.body).skills.find((skill) => skill.name === 'research-query-builder');
  assert.ok(builder, 'the local query builder Skill should be discoverable');
  const run = await request('/bridge/v1/skills/run', { method: 'POST', body: JSON.stringify({ skillId: builder.id, workspace: root, input: 'Au nanoparticles on semiconductors for visible-light CO2 reduction' }) });
  assert.equal(run.status, 200);
  const manifest = JSON.parse(run.body).manifest;
  assert.match(manifest.query_v0, /Au|gold/i);
  assert.match(manifest.query_v0, /CO2 reduction/i);
  assert.equal(manifest.database_status, 'database-neutral draft; not executed');
});

test('research question coach is discoverable as a local conversational Skill', async () => {
  const skillList = await request('/bridge/v1/skills');
  const coach = JSON.parse(skillList.body).skills.find((skill) => skill.name === 'research-question-coach');
  assert.ok(coach, 'the research question coach should be discoverable');
  assert.match(coach.description, /falsifiable research question/i);
});

test('draft notes require a fresh preview and never overwrite an existing note', async () => {
  const relativePath = `agent-output/bridge-draft-${process.pid}.md`;
  const target = path.join(root, relativePath);
  try {
    const created = await request('/bridge/v1/drafts', { method: 'POST', body: JSON.stringify({ path: relativePath, content: '# 保真 Markdown\n\n| a | b |\n| --- | --- |\n| 1 | 2 |' }) });
    assert.equal(created.status, 201);
    const draft = JSON.parse(created.body);
    assert.ok(draft.expiresAt);
    const committed = await request(`/bridge/v1/drafts/${draft.id}/commit`, { method: 'POST' });
    assert.equal(committed.status, 200);
    assert.match(fs.readFileSync(target, 'utf8'), /\| a \| b \|/);

    const duplicate = await request('/bridge/v1/drafts', { method: 'POST', body: JSON.stringify({ path: relativePath, content: 'replacement' }) });
    assert.equal(duplicate.status, 409);
  } finally {
    if (fs.existsSync(target)) fs.rmSync(target);
  }
});

test('final workflow stage is required to synthesize a decision report, not concatenate stages', () => {
  const client = fs.readFileSync(path.join(root, 'bridge-ui.js'), 'utf8');
  assert.match(client, /function finalSynthesisProtocol/);
  assert.match(client, /统一证据矩阵/);
  assert.match(client, /停止条件/);
  assert.match(client, /audit-appendix/);
  assert.match(client, /reportQualityGate/);
  assert.match(client, /function finalAcceptance/);
  assert.match(client, /function repairFinalReport/);
  assert.match(client, /function executeSkillNode/);
  assert.match(client, /open-access-download/);
  assert.match(client, /本机 Skill 已实际执行/);
  assert.match(client, /最终验收：未通过，禁止写入笔记/);
});

test('bridge converts quota diagnostics into a safe, actionable retry message', () => {
  const server = fs.readFileSync(path.join(root, 'bridge', 'server.js'), 'utf8');
  assert.match(server, /function actionableFailure/);
  assert.match(server, /Codex 使用额度已耗尽/);
  assert.match(server, /stderr: undefined/);
  assert.match(server, /diagnostics: undefined/);
  assert.match(server, /task\.failureMessage/);
  assert.match(server, /余额或账单不可用/);
  const client = fs.readFileSync(path.join(root, 'bridge-ui.js'), 'utf8');
  assert.match(client, /partial-run/);
  assert.match(client, /未生成最终综合报告/);
  assert.match(client, /function runnableProfile/);
  assert.match(client, /科研论单 Agent 模式/);
  assert.match(client, /科研论主 Agent/);
  assert.match(client, /const upstream = outputs\.slice\(-4\)/);
});

/* Regression guard for the 断开 path, added 2026-09-05.

   `bridge.kill()` stops server.js and nothing else. server.js dispatches
   agents and skills that spawn their own children — Claude, Codex, Python,
   Playwright's Chromium — and its OWN timeout path kills those with
   `taskkill /T /F`, with a comment explaining that a bare kill leaves Chromium
   holding the browser profile lock. The shutdown path did not do that, so
   pressing 断开 mid-download orphaned Chromium and the next 连接 failed on a
   lock owned by a process the user could not see.

   Asserted against the source rather than by spawning a real process tree:
   the failure mode is "someone simplifies this back to child.kill()", and
   that is exactly what a source assertion catches. */
test('every shutdown path kills the Bridge process tree, not just the Bridge', () => {
  const source = fs.readFileSync(path.join(root, 'start-local.js'), 'utf8');

  assert.match(source, /function killTree\(/, 'killTree helper must exist');
  if (process.platform === 'win32' || /taskkill/.test(source))
    assert.match(source, /taskkill\.exe['"],\s*\[['"]\/pid['"],\s*String\(child\.pid\),\s*['"]\/T['"],\s*['"]\/F['"]/,
      'Windows must kill the whole tree, matching server.js task-timeout behaviour');

  // The three ways the Bridge can stop: the 断开 button, the launcher failing
  // to bind its port, and Obsidian closing. All three must route through
  // killTree; none may fall back to a bare kill on the Bridge handle.
  // lastIndexOf, not indexOf: the first occurrence is the allow-list array of
  // control paths, not the handler that acts on the request.
  const shutdownRoute = source.slice(source.lastIndexOf("url.pathname === '/bridge/control/shutdown'"));
  assert.match(shutdownRoute.slice(0, 400), /killTree\(bridge\)/,
    '断开 must kill the tree');
  assert.match(source, /EADDRINUSE[\s\S]{0,400}killTree\(bridge\)/,
    'a failed launcher start must not orphan the Bridge tree');
  assert.match(source, /function shutdown\(\)[\s\S]{0,400}killTree\(bridge\)/,
    'closing Obsidian must not orphan Chromium either');

  // Strip comments first: killTree's own explanation quotes `bridge.kill()`
  // to say why it is wrong, and counting that would fail the test for
  // documenting the bug it fixes.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const bareKills = code.match(/\bbridge\.kill\(\)/g) || [];
  assert.equal(bareKills.length, 0,
    'no shutdown path may use a bare bridge.kill(): ' + bareKills.length + ' left');
});

/* The 断开 button, exercised the way the iframe actually calls it.

   Regression for a live failure on 2026-09-05: 断开 returned
   "Bridge control requires the local Bridge token." The control plane
   authenticated with an HttpOnly `SameSite=Strict` cookie, and the canvas runs
   in an iframe whose origin (http://127.0.0.1:<port>) differs from Obsidian's
   (app://obsidian.md). That is a cross-site context, so the cookie was set and
   then never sent back — on every request, forever.

   The distinguishing detail is what this test does NOT send: no cookie, no
   Bridge token. Only an allowed Origin, exactly like the frame. */
test('the toggle authenticates without a cookie, the way the Obsidian iframe does', async () => {
  const origin = `http://127.0.0.1:${canvasPort}`;
  const call = (p, init = {}) => fetch(`${origin}/bridge${p}`, {
    ...init, headers: { origin, ...(init.headers || {}) },
  });

  const bare = await call('/control/shutdown', { method: 'POST' });
  assert.equal(bare.status, 401, 'an uncredentialed request must still be refused');

  const bootstrap = await call('/control/token');
  assert.equal(bootstrap.status, 200);
  const { token } = await bootstrap.json();
  assert.ok(token && token.length >= 32, 'control token must be a real secret');

  const auth = { 'x-scholarium-control-token': token };

  const stop = await call('/control/shutdown', { method: 'POST', headers: auth });
  assert.equal(stop.status, 200, await stop.text());
  await new Promise((resolve) => setTimeout(resolve, 800));
  assert.equal((await (await call('/control/status', { headers: auth })).json()).online, false);

  const start = await call('/control/start', { method: 'POST', headers: auth });
  assert.equal(start.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal((await (await call('/control/status', { headers: auth })).json()).online, true,
    'the toggle must be able to reconnect after disconnecting');

  // Holding a valid token is not enough from a hostile page: the Origin check
  // is what stops a web page in a browser from stopping the local Bridge.
  const evil = await fetch(`${origin}/bridge/control/shutdown`, {
    method: 'POST', headers: { origin: 'https://evil.example', ...auth },
  });
  assert.equal(evil.status, 403, 'a foreign origin must be refused even with a valid token');
});
