"use strict";
// Real end-to-end tests for the async skill-run pair: POST /v1/skill-runs
// (start a run in the background) and GET /v1/skill-runs/:id (poll status).
// These exist so a dead task can never masquerade as "运行中" forever — the
// run record is the source of truth for child-process liveness, and
// lastOutputAt lets clients separate "quiet but alive" from "stuck".
// Spawns the actual Bridge against a disposable config + temp workspace,
// same pattern as tests/drafts-batch-endpoint.test.js.
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
let workspace;
let configPath;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { 'content-type': 'application/json' } : {};
    if (!options.noAuth) headers['x-agent-bridge-token'] = TOKEN;
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
    try { const res = await request('/health', { noAuth: true }); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-runs-workspace-'));
  configPath = path.join(os.tmpdir(), `skill-runs-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN, allowExecution: false, workspaceRoot: workspace, allowedRoots: [workspace], adapters: {},
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
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
});

async function findGraphSkillId() {
  const res = await request('/v1/skills');
  assert.equal(res.status, 200);
  const { skills } = JSON.parse(res.body);
  const match = skills.find((item) => String(item.id || '').toLowerCase().includes('/agent-canvas-demo/skills/paper-knowledge-graph/'));
  assert.ok(match, 'paper-knowledge-graph skill should be discoverable');
  return match.id;
}

async function findNatureReaderSkillId() {
  const res = await request('/v1/skills');
  assert.equal(res.status, 200);
  const { skills } = JSON.parse(res.body);
  const match = skills.find((item) => String(item.id || '').toLowerCase().includes('/agent-canvas-demo/skills/nature-reader/'));
  assert.ok(match, 'nature-reader skill should be discoverable');
  return match.id;
}

test('rejects starting a run without the bridge token', async () => {
  const res = await request('/v1/skill-runs', { method: 'POST', noAuth: true, body: JSON.stringify({ skillId: 'x', input: '' }) });
  assert.equal(res.status, 401);
});

test('rejects an unknown skill id synchronously', async () => {
  const res = await request('/v1/skill-runs', { method: 'POST', body: JSON.stringify({ skillId: 'no/such/skill.md', input: '' }) });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.body).error, /unknown local skill/);
});

test('rejects a workspace outside allowedRoots', async () => {
  const skillId = await findGraphSkillId();
  const res = await request('/v1/skill-runs', { method: 'POST', body: JSON.stringify({ skillId, workspace: os.tmpdir(), input: '' }) });
  assert.equal(res.status, 403);
});

test('returns 404 for an unknown or expired run id', async () => {
  const res = await request('/v1/skill-runs/does-not-exist');
  assert.equal(res.status, 404);
  // The message matters: a Bridge restart drops in-flight runs, and the
  // client must treat that as "stopped", never as silent success.
  assert.match(JSON.parse(res.body).error, /treat as stopped/);
});

test('runs a skill to completion and exposes a coherent snapshot', async () => {
  const skillId = await findGraphSkillId();
  const started = await request('/v1/skill-runs', { method: 'POST', body: JSON.stringify({ skillId, workspace, input: '{}' }) });
  assert.equal(started.status, 201);
  const { id, status } = JSON.parse(started.body);
  assert.ok(id);
  assert.equal(status, 'running');

  let snapshot = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    const res = await request(`/v1/skill-runs/${id}`);
    assert.equal(res.status, 200);
    snapshot = JSON.parse(res.body);
    if (snapshot.status !== 'running') break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(snapshot, 'never received a run snapshot');
  assert.equal(snapshot.status, 'completed', `run should complete in an empty workspace, got: ${JSON.stringify(snapshot).slice(0, 400)}`);
  assert.ok(snapshot.output && snapshot.output.manifest, 'completed run must carry the skill output');
  assert.ok(snapshot.startedAt > 0 && snapshot.lastOutputAt > 0 && snapshot.finishedAt >= snapshot.startedAt);
});

test('nature-reader exposes file progress and can be cancelled through the Bridge', async () => {
  const pdfs = [];
  for (let index = 0; index < 120; index++) {
    const file = path.join(workspace, `cancel-${index}.pdf`);
    fs.writeFileSync(file, Buffer.alloc(64 * 1024, index % 255));
    pdfs.push(file);
  }
  const skillId = await findNatureReaderSkillId();
  const started = await request('/v1/skill-runs', {
    method: 'POST',
    body: JSON.stringify({ skillId, workspace, input: JSON.stringify({ pdf_paths: pdfs }) }),
  });
  assert.equal(started.status, 201);
  const { id } = JSON.parse(started.body);

  const cancelled = await request(`/v1/skill-runs/${id}/cancel`, { method: 'POST' });
  assert.equal(cancelled.status, 200);
  assert.equal(JSON.parse(cancelled.body).status, 'cancelling');

  let snapshot = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const res = await request(`/v1/skill-runs/${id}`);
    assert.equal(res.status, 200);
    snapshot = JSON.parse(res.body);
    if (snapshot.status === 'cancelled') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(snapshot?.status, 'cancelled');
  assert.equal(snapshot.cancelRequested, true);
});
