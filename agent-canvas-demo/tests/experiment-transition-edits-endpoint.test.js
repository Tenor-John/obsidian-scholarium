"use strict";
// 2026-08-27 发布冲刺项2验收发现的真实缺口：/v1/edits/experiment-transition/
// {preview,commit} 此前只有 tests/scholarium-bridge-endpoints.test.js 对
// server.js 源码做静态字符串匹配（有没有 dryRun:true / confirmed:true 这些
// 关键字），从没有真正起一个 Bridge 进程、对一份真实的 Experiment 记录走一
// 遍 preview -> commit，确认磁盘上的文件真的按预期变了、重复提交真的被拒、
// commit 真的是基于磁盘最新状态重新校验（而不是照抄 preview 时缓存的 plan）。
// 这份测试补的就是这一层，风格照抄 drafts-batch-vault-validation.test.js /
// drafts-batch-production-topology.test.js：起一个真实子进程 + 真实 HTTP。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const bridgeRoot = path.resolve(__dirname, '..');
const schemaObjects = require(path.join(repoRoot, 'tools', 'schema-objects.js'));

const TOKEN = 'exp-transition-edits-' + process.pid;
let nextPort = 47700 + (process.pid % 200);

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

// Builds a real, schema-v1-valid Experiment note directly on disk (via the
// same schema-objects.js the server itself validates against), independent
// of the /v1/drafts/batch channel — this test is about the edit channel, not
// about how the record originally got there.
function writeExperiment(vault, status) {
  const object = schemaObjects.createObject('experiment', {
    project_uid: '01919c7a-0001-7abc-89ab-1234567890ab',
    title: 'live transition fixture',
    status,
    data_origin: 'planned',
    // schema-objects.js's experiment-specific validateObject block (added to
    // guard against a real defect where legacy data-origin claims went
    // unattributed) requires data_recorded_by/data_recorded_at whenever
    // data_origin is set at all, not only for measured/imported data.
    // data_recorded_by must literally be "user" — an Agent may never declare
    // where data came from.
    data_recorded_by: 'user',
    data_recorded_at: '2026-08-27T00:00:00Z',
  }, { uid: '01919c7a-0002-7abc-89ab-1234567890ab', display_id: 'EXP-001' });
  const file = path.join(vault, 'Research', 'Experiments', 'EXP-001.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, schemaObjects.serializeObject(object, '# fixture\n'), 'utf8');
  return { object, file };
}

function readStatus(file) {
  const { object } = schemaObjects.parseObject(fs.readFileSync(file, 'utf8'));
  return object;
}

async function launch(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-transition-edits-'));
  const vault = path.join(temp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const configPath = path.join(temp, 'bridge.config.json');
  const secretsPath = path.join(temp, 'bridge.env');
  const port = nextPort++;
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN, allowExecution: false, workspaceRoot: vault, allowedRoots: [vault], adapters: {},
    // allowedActions 刻意留空数组：experiment.transition 走 /v1/edits，不经
    // scholarium.allowedActions 那张队列白名单，这本身就是要验证的行为之一
    // （见 scholarium-bridge-endpoints.test.js 的 "is not folded into
    // scholarium.allowedActions" 静态测试）。
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
  }, null, 2), 'utf8');
  const bridge = spawn(process.execPath, [path.join(bridgeRoot, 'bridge', 'server.js')], {
    cwd: bridgeRoot,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(port), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: secretsPath },
    stdio: 'ignore', windowsHide: true,
  });
  t.after(() => {
    if (!bridge.killed) bridge.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForBridge(port);
  return { port, vault };
}

test('preview computes the plan without writing; commit actually advances the on-disk status and appends status_history', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');

  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'ready', reason: '设计已确认，可以进入准备阶段' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const previewBody = JSON.parse(preview.body);
  assert.equal(previewBody.plan.from, 'designed');
  assert.equal(previewBody.plan.to, 'ready');
  assert.equal(previewBody.plan.noop, false);

  // Preview must be a pure dry-run: the file on disk is untouched so far.
  assert.equal(readStatus(file).status, 'designed');

  const commit = await request(port, `/v1/edits/${previewBody.id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  const commitBody = JSON.parse(commit.body);
  assert.equal(commitBody.result.from, 'designed');
  assert.equal(commitBody.result.to, 'ready');

  const after = readStatus(file);
  assert.equal(after.status, 'ready');
  assert.ok(Array.isArray(after.status_history) && after.status_history.length === 1, 'status_history must record the transition');
  assert.equal(after.status_history[0].from, 'designed');
  assert.equal(after.status_history[0].to, 'ready');
  assert.equal(after.status_history[0].reason, '设计已确认，可以进入准备阶段');
});

test('committing the same preview id a second time is rejected — the edit preview is consumed on first success', async (t) => {
  const { port, vault } = await launch(t);
  const { object } = writeExperiment(vault, 'designed');

  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'ready', reason: 'first confirm' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const { id } = JSON.parse(preview.body);

  const firstCommit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(firstCommit.status, 200, firstCommit.body);

  const secondCommit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(secondCommit.status, 404, secondCommit.body);
  assert.match(JSON.parse(secondCommit.body).error, /edit preview not found or expired/);
});

test('committing an id that was never previewed is rejected the same way (no way to forge a commit without a real preview)', async (t) => {
  const { port } = await launch(t);
  const res = await request(port, '/v1/edits/never-previewed-id/commit', { method: 'POST', body: '{}' });
  assert.equal(res.status, 404, res.body);
  assert.match(JSON.parse(res.body).error, /edit preview not found or expired/);
});

test('preview rejects a multi-step jump before anything is written, and the file stays untouched', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');

  // designed -> running skips over "ready"; experiment-workflow.js's NEXT map
  // only allows one lifecycle step at a time.
  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'running', reason: 'skip ahead' }),
  });
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /invalid_experiment_transition/);
  assert.equal(readStatus(file).status, 'designed');
});

test('commit re-derives the transition from the current on-disk status, not the plan cached at preview time', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');

  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'ready', reason: '准备阶段' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const { id } = JSON.parse(preview.body);

  // Simulate the record having already been advanced to "ready" by some
  // other confirmed action between preview and commit (e.g. a second click,
  // or a concurrent session). If commit blindly replayed the preview's
  // cached { from: 'designed', to: 'ready' } plan, this would either silently
  // overwrite an already-current status_history or misreport the transition.
  const current = readStatus(file);
  fs.writeFileSync(file, schemaObjects.serializeObject({ ...current, status: 'ready' }, '# fixture\n'), 'utf8');

  const commit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  const commitBody = JSON.parse(commit.body);
  // transitionPlan() sees from === to on the freshly re-read record and
  // reports a noop, proving commit re-read the disk rather than trusting the
  // preview's stale snapshot.
  assert.equal(commitBody.result.noop, true);
  assert.equal(commitBody.result.from, 'ready');
});

// True 15-minute TTL expiry (DRAFT_TTL_MS, shared with /v1/drafts/batch) is
// not exercised live here with a real wait, for the same reason none of the
// other TTL-bound preview/commit channels in this suite (drafts batch, full
// tasks, idea promotion) do either: 15 minutes is too slow for a test run,
// and this codebase has no test-only clock override. The `Date.parse(...) <=
// Date.now()` check and its ordering relative to the not-found check are
// covered by static analysis in scholarium-bridge-endpoints.test.js ("commit
// checks the preview exists and has not expired before running anything").
// This file instead exercises the reachable, real-time part of the same
// contract: a *consumed* preview (the practical everyday case — a duplicate
// click) is rejected with the identical "not found or expired" response, via
// the same code path a genuinely expired id would take.
