"use strict";
// Regression for the 2026-08-23 "写入成功却报超时未结算" bug: the Obsidian-side
// queue consumer settles items with a FLAT patch ({status, result, error}),
// while the weaver chat poller waits for NESTED item.outcome.status — so every
// successful queued action was falsely reported as a 180s timeout. Fix is
// two-sided: settle() now stores both shapes, and the Bridge's read endpoints
// synthesize `outcome` for legacy archive entries settled before the fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..', '..');
const queue = require(path.join(pluginRoot, 'tools', 'bridge-action-queue.js'));

test('settle() stores outcome both flat and nested', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-settle-'));
  try {
    const item = queue.submit(vault, 'workspace.task_add', { title: 't' });
    queue.settle(vault, item.id, { status: 'completed', result: { taskId: 'x1' } });
    const read = queue.read(vault, item.id);
    assert.equal(read.outcome.status, 'completed', 'poller-facing nested outcome must exist');
    assert.equal(read.outcome.result.taskId, 'x1');
    assert.equal(read.status, 'completed', 'flat fields kept for backward compatibility');
    assert.ok(read.settled_at);
    assert.equal(fs.existsSync(path.join(vault, 'Research', '_runs', 'queue', `${item.id}.json`)), false, 'pending file must be moved out');
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('queue preserves server-derived task/provider provenance through settlement', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-provider-'));
  try {
    const provider = { source: 'cc-switch', trust: 'third-party', label: 'DeepSeek', route: 'cc-switch 本地代理' };
    const item = queue.submit(vault, 'workspace.task_add', { title: 't' }, { sourceTaskId: 'task-123', provider });
    const settled = queue.settle(vault, item.id, { status: 'completed', result: {} });
    assert.equal(settled.source_task_id, 'task-123');
    assert.deepEqual(settled.provider, provider);
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
});

// HTTP-level: a legacy archive entry (flat-only, written by the pre-fix settle)
// must still read back with outcome.status through the Bridge endpoint.
const root = path.resolve(__dirname, '..');
const bridgePort = 46700 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;
let bridge;
let vault;
let configPath;

function request(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: bridgePort, path: pathname, headers: { 'x-agent-bridge-token': TOKEN } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForBridge() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const res = await new Promise((res2, rej2) => {
      const r = http.request({ host: '127.0.0.1', port: bridgePort, path: '/health' }, (x) => res2(x.statusCode));
      r.on('error', rej2); r.end();
    }); if (res === 200) return; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-legacy-vault-'));
  configPath = path.join(os.tmpdir(), `queue-legacy-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN, allowExecution: false, workspaceRoot: vault, allowedRoots: [vault], adapters: {},
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: ['workspace.task_add'] },
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

test('legacy flat-only archive entry reads back with synthesized outcome', async () => {
  // Hand-craft exactly what the pre-fix settle() wrote: flat status/result,
  // settled_at, NO outcome key.
  const id = 'd7f89022-legacy-test';
  const dir = path.join(vault, 'Research', '_runs', 'queue-archive');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
    id, action: 'workspace.task_add', input: { title: 't' },
    status: 'completed', result: { taskId: 'mt4ocbq9ovx7' },
    submitted_at: '2026-08-22T17:50:47.000Z', settled_at: '2026-08-22T17:50:48.417Z',
  }), 'utf8');

  const res = await request(`/v1/scholarium/actions/${id}`);
  assert.equal(res.status, 200);
  const item = JSON.parse(res.body);
  assert.equal(item.outcome.status, 'completed', 'the chat poller must see outcome.status even for pre-fix archive entries');
  assert.equal(item.outcome.result.taskId, 'mt4ocbq9ovx7');
});

test('a still-pending item is returned as-is (no synthesized outcome)', async () => {
  const item = queue.submit(vault, 'workspace.task_add', { title: 'pending one' });
  const res = await request(`/v1/scholarium/actions/${item.id}`);
  assert.equal(res.status, 200);
  const read = JSON.parse(res.body);
  assert.equal(read.status, 'pending');
  assert.equal(read.outcome, undefined);
});

// The two tests above cover the module-level round trip (settle() alone) and
// the legacy-fixture HTTP read (a hand-crafted flat-only archive entry). What
// neither proves is that a real submit -> settle -> HTTP-read pass, using the
// *current* settle() output end to end, actually reaches the chat poller's
// nested outcome.status without relying on normalizeQueueItem()'s fallback —
// i.e. that the primary path works on its own, not just the compat shim.
test('a fresh item settled by the current settle() reads back over HTTP without needing the legacy fallback', async () => {
  const item = queue.submit(vault, 'workspace.task_add', { title: 'fresh round trip' });
  const settled = queue.settle(vault, item.id, { status: 'completed', result: { taskId: 'fresh-1' } });
  assert.ok(settled.outcome, 'settle() must already produce a nested outcome — the fallback below should never need to run for this case');

  const res = await request(`/v1/scholarium/actions/${item.id}`);
  assert.equal(res.status, 200);
  const read = JSON.parse(res.body);
  assert.equal(read.outcome.status, 'completed', 'chat poller must see outcome.status on the primary path, same as it would for a legacy-normalized entry');
  assert.equal(read.outcome.result.taskId, 'fresh-1');
});
