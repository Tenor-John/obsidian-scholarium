"use strict";
// DEF-005 negative regression: the fix widens which vaultRoot-vs-allowedRoots
// *shapes* are accepted (ancestor as well as descendant/self), but must not
// turn draftBaseRoot()/promotionVault() into an open write anywhere. When
// scholarium.vaultRoot is configured but the directory does not exist, drafts
// with base:'scholarium-vault' must still fail closed with the original
// "not configured or does not exist" error, exactly as before this fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 47200 + (process.pid % 300);
const token = 'def005-neg-token-' + process.pid;

let bridge, topicDir, configPath;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { 'content-type': 'application/json' } : {};
    headers['x-agent-bridge-token'] = token;
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

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
  topicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'def005-neg-topic-'));
  configPath = path.join(os.tmpdir(), `def005-neg-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token, allowExecution: false,
    workspaceRoot: topicDir,
    allowedRoots: [topicDir],
    adapters: {},
    // enabled, but vaultRoot points at a directory that does not exist.
    scholarium: { enabled: true, vaultRoot: path.join(topicDir, 'nonexistent-vault'), allowedActions: [] },
  }, null, 2), 'utf8');

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(port), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (configPath && fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
  if (topicDir && fs.existsSync(topicDir)) fs.rmSync(topicDir, { recursive: true, force: true });
});

test('drafts/batch with base scholarium-vault fails closed, not open, when vaultRoot does not exist', async () => {
  const res = await request('/v1/drafts/batch', {
    method: 'POST',
    body: JSON.stringify({ base: 'scholarium-vault', items: [{ path: 'Research/Decisions/DEC-X.md', content: 'x' }] }),
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /vaultRoot is not configured or does not exist/);
});
