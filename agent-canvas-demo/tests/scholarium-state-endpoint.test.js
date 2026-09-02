"use strict";
// Real end-to-end test for GET /v1/scholarium/state: spawns the actual Bridge
// against a disposable config + fixture vault, then exercises auth, gates,
// whitelist and the L0-only refusal over HTTP. The plugin-side static checks
// (tests/scholarium-bridge-endpoints.test.js) cover source ordering; this file
// proves the route actually works when the process is running.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pluginRoot = path.resolve(root, '..');
const S = require(path.join(pluginRoot, 'tools', 'schema-objects.js'));
const bridgePort = 46100 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;

let bridge;
let vault;
let configPath;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: bridgePort, path: pathname, method: options.method || 'GET', headers: options.headers || {}, }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.end();
  });
}
const authed = (pathname) => request(pathname, { headers: { 'x-agent-bridge-token': TOKEN } });

async function waitForBridge() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const res = await request('/health'); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-state-endpoint-vault-'));
  const prj = S.createObject('project', { title: '端点测试课题', status: 'active' });
  const dir = path.join(vault, 'Research', 'Projects');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PRJ-001.md'), S.serializeObject(prj, '\n# 端点测试课题\n'), 'utf8');

  configPath = path.join(os.tmpdir(), `p7-state-endpoint-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN,
    allowExecution: false,
    workspaceRoot: vault,
    allowedRoots: [vault],
    adapters: {},
    scholarium: {
      enabled: true,
      vaultRoot: vault,
      allowedActions: ['rss.refresh_feed', 'project.list', 'project.get', 'experiment.scan_outcomes'],
    },
  }, null, 2), 'utf8');

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (configPath && fs.existsSync(configPath)) fs.rmSync(configPath);
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('rejects requests without the bridge token', async () => {
  const res = await request('/v1/scholarium/state?action=project.list');
  assert.equal(res.status, 401);
});

test('project.list returns the fixture project over HTTP', async () => {
  const res = await authed('/v1/scholarium/state?action=project.list');
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.action, 'project.list');
  assert.equal(payload.result.total, 1);
  assert.equal(payload.result.projects[0].display_id, 'PRJ-001');
  assert.equal(payload.result.projects[0].title, '端点测试课题');
});

test('project.get accepts a display_id and resolves it to the object', async () => {
  const res = await authed('/v1/scholarium/state?action=project.get&input=' + encodeURIComponent(JSON.stringify({ display_id: 'PRJ-001' })));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).result.project.title, '端点测试课题');
});

test('malformed input JSON fails fast with 400', async () => {
  const res = await authed('/v1/scholarium/state?action=project.get&input=%7Bnot-json');
  assert.equal(res.status, 400);
});

test('an L1 action is refused and told to use the queued POST route', async () => {
  const res = await authed('/v1/scholarium/state?action=rss.refresh_feed');
  assert.equal(res.status, 409);
  assert.match(JSON.parse(res.body).error, /L0 read-only actions only/);
});

test('an action outside the whitelist is refused', async () => {
  const res = await authed('/v1/scholarium/state?action=vault.validate');
  assert.equal(res.status, 403);
});

test('state reads never write into the vault (no queue, no audit dir)', async () => {
  await authed('/v1/scholarium/state?action=project.list');
  await authed('/v1/scholarium/state?action=experiment.scan_outcomes');
  assert.equal(fs.existsSync(path.join(vault, 'Research', '_runs')), false, 'L0 reads must not create Research/_runs');
});
