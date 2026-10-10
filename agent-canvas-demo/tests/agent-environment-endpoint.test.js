"use strict";
/* Regression for the 2026-09-05 "绿点说谎" bug.

   The agent picker showed openclaw as 可执行 on a machine where
   `openclaw --version` exits 1 with "Node.js >=22.22.3 <23, >=24.15.0 <25, or
   >=25.9.0 is required (current: v22.13.1)". agentStatus() decided readiness
   with a bare `where.exe` lookup, so a shim on PATH was enough to earn a green
   dot; dispatching to it then failed with nothing explaining why.

   Two further holes are covered here. Auto-detection ran only when no config
   file existed, so everyone upgrading (rather than installing fresh) silently
   kept whatever paths their config already had — including the placeholder
   ones from the example file. And /v1/agents/install spawns npm, so its
   guardrails are part of the contract, not a nicety. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness.js');

// The port is assigned by the OS and reported back by the Bridge. A fixed port
// used to be hard-coded here; on this machine 4407 sits inside a Windows
// excluded port range, so binding it failed with EACCES even when nothing held
// it, and these three tests looked like permanent flakiness for weeks.
let harness;

const get = async (p) => {
  const response = await harness.json(p);
  return [response.status, response.body];
};
const post = async (p, payload) => {
  const response = await harness.json(p, { method: 'POST', body: payload });
  return [response.status, response.body];
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test.before(async () => {
  // Deliberately an "already upgraded from an older build" config: it exists,
  // and it carries no agentDetection provenance field.
  harness = await startBridge({
    config: {
      adapters: {
        openclaw: { command: 'openclaw', args: ['run', '{{prompt}}'], sandboxed: false },
        hermes: { command: 'hermes-does-not-exist', args: ['{{prompt}}'], sandboxed: false },
      },
    },
  });
});

test.after(() => {
  if (harness) harness.stop();
});

test('环境体检报告每个 agent 的可运行性，而不只是路径存在', async () => {
  const [status, report] = await get('/v1/agents/environment?refresh=1');
  assert.equal(status, 200);
  assert.ok(Array.isArray(report.agents) && report.agents.length, '必须返回 agent 列表');
  for (const agent of report.agents) {
    assert.ok(['ready', 'broken', 'missing', 'no_credential'].includes(agent.readiness),
      `未知状态 ${agent.readiness}`);
    // A green state must be backed by something the binary actually said.
    if (agent.readiness === 'ready') assert.ok(agent.version, `${agent.key} 报了 ready 却没有版本号`);
    // And a red state must say why, so the user is not left guessing.
    if (agent.readiness === 'broken') assert.ok(agent.problem, `${agent.key} 报了 broken 却没有原因`);
  }
});

test('体检报告绝不包含完整凭据', async () => {
  // The panel needs to show WHICH provider is in effect; it never needs the
  // key itself, and the vault this plugin lives in is synced.
  const [, report] = await get('/v1/agents/environment');
  const text = JSON.stringify(report);
  assert.ok(!/sk-[A-Za-z0-9_-]{20,}/.test(text), '报告里出现了完整 API key');
  assert.ok(!/eyJ[A-Za-z0-9_-]{30,}/.test(text), '报告里出现了 JWT');
});

test('装了但跑不起来的 adapter 不会拿到 ready', async () => {
  await get('/v1/agents/environment?refresh=1');
  const [status, payload] = await get('/v1/agents');
  assert.equal(status, 200);
  for (const agent of payload.agents) {
    if (agent.readiness === 'ready') {
      assert.notEqual(agent.runnable, false, `${agent.id} 被判为 ready 但 runnable=false`);
    }
    // The unverified state must exist and be distinguishable from ready:
    // collapsing them is what produced the original false green dot.
    assert.ok(['ready', 'broken', 'missing', 'command_detected'].includes(agent.readiness));
  }
  const missing = payload.agents.find((agent) => agent.id === 'hermes');
  assert.equal(missing.readiness, 'missing');
  assert.notEqual(missing.installed, true);
});

test('升级路径也会补跑一次探测', async () => {
  // The config was written without an agentDetection field, exactly as an
  // older build would have left it.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const saved = JSON.parse(fs.readFileSync(harness.configPath, 'utf8'));
    if (saved.agentDetection && saved.agentDetection.status !== 'pending') {
      assert.ok(['ready', 'manual', 'failed'].includes(saved.agentDetection.status));
      assert.ok(Array.isArray(saved.agentRoots), 'agentRoots 必须被补上');
      return;
    }
    await wait(250);
  }
  throw new Error('已有配置在升级后没有补跑探测');
});

test('安装端点的护栏：包名固定、目录受限', async () => {
  // The package name is never taken from the request — an endpoint that ran
  // `npm install <whatever the body said>` would be remote code execution with
  // an install step attached.
  const [unknown, unknownBody] = await post('/v1/agents/install', { agent: 'evil-package', directory: harness.scratch });
  assert.equal(unknown, 400);
  assert.match(unknownBody.error, /不支持自动安装/);

  const [relative, relativeBody] = await post('/v1/agents/install', { agent: 'claude', directory: 'relative/path' });
  assert.equal(relative, 400);
  assert.match(relativeBody.error, /绝对路径/);

  const systemRoot = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'scholarium')
    : '/usr/bin/scholarium';
  const [system, systemBody] = await post('/v1/agents/install', { agent: 'claude', directory: systemRoot });
  assert.equal(system, 400);
  assert.match(systemBody.error, /系统目录/);

  // Nothing above may have created anything on disk.
  assert.equal(fs.existsSync(systemRoot), false, '被拒绝的安装不应留下目录');
});
