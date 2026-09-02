"use strict";
// DEF-005 negative regression cases.  Each test owns a Bridge process and a
// config/secrets pair, so no request can read the developer's running Bridge
// or live vault configuration.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const TOKEN = 'vault-validation-' + process.pid;
let nextPort = 47200 + (process.pid % 200);

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-agent-bridge-token': TOKEN };
    if (options.body) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForBridge(port) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await request(port, '/health')).status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

async function launch(t, vaultRoot) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-vault-validation-'));
  const topic = path.join(temp, 'TopicSubfolder');
  fs.mkdirSync(topic, { recursive: true });
  const configPath = path.join(temp, 'bridge.config.json');
  const secretsPath = path.join(temp, 'bridge.env');
  const port = nextPort++;
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN, allowExecution: false, workspaceRoot: topic, allowedRoots: [topic], adapters: {},
    scholarium: { enabled: true, vaultRoot, allowedActions: [] },
  }, null, 2), 'utf8');
  const bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(port), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: secretsPath },
    stdio: 'ignore', windowsHide: true,
  });
  t.after(() => {
    if (!bridge.killed) bridge.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForBridge(port);
  return port;
}

test('scholarium-vault rejects a missing vaultRoot without writing', async (t) => {
  const port = await launch(t, null);
  const res = await request(port, '/v1/drafts/batch', {
    method: 'POST',
    body: JSON.stringify({ base: 'scholarium-vault', items: [{ path: 'Research/Decisions/DEC-901.md', content: '# DEC' }] }),
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /scholarium\.vaultRoot is not configured or does not exist/);
});

test('scholarium-vault rejects a nonexistent vaultRoot without writing', async (t) => {
  const nonexistentVault = path.join(os.tmpdir(), `missing-vault-${process.pid}-${Date.now()}`);
  const port = await launch(t, nonexistentVault);
  const res = await request(port, '/v1/drafts/batch', {
    method: 'POST',
    body: JSON.stringify({ base: 'scholarium-vault', items: [{ path: 'Research/Lessons/LES-901.md', content: '# LES' }] }),
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /scholarium\.vaultRoot is not configured or does not exist/);
  assert.equal(fs.existsSync(path.join(nonexistentVault, 'Research', 'Lessons', 'LES-901.md')), false);
});
