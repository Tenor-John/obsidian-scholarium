"use strict";
// Regression: schema-v1 drafts (P3-P5 hypotheses/experiments/schedule, Idea
// mode notes) must land under scholarium.vaultRoot even when workspaceRoot
// points at a per-topic subfolder. Before the base field existed, drafts/batch
// resolved every path against workspaceRoot, so an M3 first-loop run executed
// from a topic folder wrote Research/Hypotheses into the topic's subtree and
// the vault-level registry kept showing 假设 0 · 实验 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bridgePort = 46800 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;

let bridge;
let vault;
let topicDir;
let configPath;
let secretsPath;
let auditDir;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { 'content-type': 'application/json' } : {};
    headers['x-agent-bridge-token'] = TOKEN;
    const req = http.request({
      host: '127.0.0.1', port: bridgePort, path: pathname, method: options.method || 'GET', headers,
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
    try { const res = await request(new URL(`http://127.0.0.1:${bridgePort}/health`).pathname, {}); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-vault-base-'));
  topicDir = path.join(vault, 'TopicSubfolder');
  fs.mkdirSync(topicDir, { recursive: true });
  configPath = path.join(vault, 'bridge.config.json');
  secretsPath = path.join(vault, 'bridge.env');
  auditDir = path.join(vault, 'audit');
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN,
    allowExecution: false,
    workspaceRoot: topicDir, // the M3 failure shape: workspace is a topic subfolder
    // Production topology: this is deliberately narrower than the vault.
    // allowedRoots remains the full-lane sandbox boundary.
    allowedRoots: [topicDir],
    adapters: {},
    fullTaskAuditDir: auditDir,
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
  }, null, 2), 'utf8');

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: secretsPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('base scholarium-vault writes DEC and LES records into the vault root, not the topic workspace', async () => {
  const items = [
    { path: 'Research/Decisions/DEC-900 vault-base.md', content: '# DEC-900\n\nvault base' },
    { path: 'Research/Lessons/LES-900 vault-base.md', content: '# LES-900\n\nvault base' },
  ];
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ base: 'scholarium-vault', items }) });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  assert.equal(batch.base, 'scholarium-vault');

  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);

  assert.ok(fs.existsSync(path.join(vault, 'Research', 'Decisions', 'DEC-900 vault-base.md')), 'decision must land in the vault');
  assert.ok(fs.existsSync(path.join(vault, 'Research', 'Lessons', 'LES-900 vault-base.md')), 'lesson must land in the vault');
  assert.ok(!fs.existsSync(path.join(topicDir, 'Research')), 'nothing may leak into the topic workspace');
});

test('scholarium-vault drafts still reject path traversal before writing', async () => {
  const res = await request('/v1/drafts/batch', {
    method: 'POST',
    body: JSON.stringify({ base: 'scholarium-vault', items: [{ path: '../escape.md', content: '# escape' }] }),
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /relative .md path/);
  assert.equal(fs.existsSync(path.join(path.dirname(vault), 'escape.md')), false);
});

test('full lane still refuses the vault ancestor outside allowedRoots', async () => {
  const res = await request('/v1/full-tasks/preview', {
    method: 'POST',
    body: JSON.stringify({ category: 'fetch_and_attach_pdf', workspace: vault, prompt: 'Download this DOI only after the researcher confirms it.' }),
  });
  assert.equal(res.status, 403, res.body);
  assert.match(JSON.parse(res.body).error, /outside configured allowedRoots/);
});

test('omitting base keeps the legacy workspaceRoot behavior', async () => {
  const items = [{ path: 'notes/local.md', content: '# local\n' }];
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items }) });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);
  assert.ok(fs.existsSync(path.join(topicDir, 'notes', 'local.md')), 'default base still writes into workspaceRoot');
});

test('an unknown base is rejected with 400 and writes nothing', async () => {
  const res = await request('/v1/drafts/batch', {
    method: 'POST',
    body: JSON.stringify({ base: 'somewhere-else', items: [{ path: 'x.md', content: 'x' }] }),
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /unknown draft base/);
  assert.ok(!fs.existsSync(path.join(vault, 'x.md')));
  assert.ok(!fs.existsSync(path.join(topicDir, 'x.md')));
});
