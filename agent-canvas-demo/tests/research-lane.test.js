/* research lane 派发门槛测试：
 * - lane:'research' 适配器在 researchLaneEnabled=false 时必须被拒（fail-closed）
 * - researchLaneEnabled=true 时放行
 * - 无 lane 标记且 sandboxed!==true 的适配器仍然被拒（原有行为不变） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function withBridge(t, adapters, extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-test-'));
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const configPath = path.join(tmp, 'bridge.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    token: 'lanetoken', allowExecution: true, workspaceRoot: workspace, allowedRoots: [workspace],
    skillDirectories: [], scholarium: { enabled: false, vaultRoot: workspace, allowedActions: [] },
    fullTaskCategories: {}, adapters, ...extra,
  }), 'utf8');
  const PORT = 4523;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bridge', 'server.js')], {
    env: { ...process.env, AGENT_BRIDGE_PORT: String(PORT), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: path.join(tmp, 's.env') },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await new Promise((r) => setTimeout(r, 600)); // 等被派发的子进程退出并释放目录句柄
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); return; }
      catch { await new Promise((r) => setTimeout(r, 500)); }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await new Promise((r) => setTimeout(r, 1200));
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': 'lanetoken' };
  return (agentId) => fetch(`http://127.0.0.1:${PORT}/v1/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ agentId, cwd: workspace, prompt: 'ping', permission: 'read', execute: true }),
  }).then((r) => r.json());
}

test('lane:research 在 researchLaneEnabled=false 时被拒', async (t) => {
  const dispatch = await withBridge(t, { fake: { command: 'node', args: ['-e', '1'], lane: 'research' } }, { researchLaneEnabled: false });
  const res = await dispatch('fake');
  assert.equal(res.error?.includes('refusing to dispatch'), true);
});

test('lane:research 在 researchLaneEnabled=true 时放行', async (t) => {
  const dispatch = await withBridge(t, { fake: { command: 'node', args: ['-e', '1'], lane: 'research' } }, { researchLaneEnabled: true });
  const res = await dispatch('fake');
  assert.ok(['queued', 'running'].includes(res.status), `expected dispatch accepted, got ${JSON.stringify(res)}`);
});

test('旧配置缺省 researchLaneEnabled=false（loadConfig fail-closed 回填）', async (t) => {
  // 不传 researchLaneEnabled 字段，模拟 2026-08-21 之前的旧配置
  const dispatch = await withBridge(t, { fake: { command: 'node', args: ['-e', '1'], lane: 'research' } });
  const res = await dispatch('fake');
  assert.equal(res.error?.includes('refusing to dispatch'), true);
});

test('无 lane 且无 sandboxed 的适配器依旧被拒（原行为不变）', async (t) => {
  const dispatch = await withBridge(t, { fake: { command: 'node', args: ['-e', '1'] } }, { researchLaneEnabled: true });
  const res = await dispatch('fake');
  assert.equal(res.error?.includes('refusing to dispatch'), true);
});

test('research 车道任务带快照审计：写入被 diff 检出并出现在事件里', async (t) => {
  // 用 node 子进程模拟"会写文件的 Agent"：不需要真实 Claude，验证 start() 的
  // 快照 diff 逻辑本身（越界探测需真实模型，由 probe-path-scope.js 负责）。
  const writeSnippet = 'require("node:fs").writeFileSync("audit-target.md","x")';
  let bridge;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-audit-'));
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const configPath = path.join(tmp, 'bridge.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    token: 'lanetoken', allowExecution: true, workspaceRoot: workspace, allowedRoots: [workspace],
    skillDirectories: [], scholarium: { enabled: false, vaultRoot: workspace, allowedActions: [] },
    fullTaskCategories: {}, researchLaneEnabled: true,
    adapters: { fake: { command: 'node', args: ['-e', writeSnippet], lane: 'research' } },
  }), 'utf8');
  const PORT = 4525;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bridge', 'server.js')], {
    env: { ...process.env, AGENT_BRIDGE_PORT: String(PORT), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: path.join(tmp, 's.env') },
    stdio: 'ignore',
  });
  t.after(async () => {
    child.kill();
    await new Promise((r) => setTimeout(r, 600));
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(tmp, { recursive: true, force: true }); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
    }
  });
  await new Promise((r) => setTimeout(r, 1200));
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': 'lanetoken' };
  const created = await fetch(`http://127.0.0.1:${PORT}/v1/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ agentId: 'fake', cwd: workspace, prompt: 'p', permission: 'read', execute: true }),
  }).then((r) => r.json());
  assert.ok(created.id, JSON.stringify(created));
  let info = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    info = await fetch(`http://127.0.0.1:${PORT}/v1/tasks/${created.id}`, { headers }).then((r) => r.json());
    if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
  }
  assert.equal(fs.existsSync(path.join(workspace, 'audit-target.md')), true);
  const auditEvent = (info.events || []).find((e) => /本轮实际写入了 1 个文件/.test(e.text));
  assert.ok(auditEvent, '应产生写入审计事件');
  assert.ok(auditEvent.text.includes('audit-target.md'));
  void bridge;
});
