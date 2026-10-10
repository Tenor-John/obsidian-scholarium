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
   guardrails are part of the contract, not a nicety.

   ---------------------------------------------------------------------------
   Why every Bridge in this file runs on a fabricated PATH
   ---------------------------------------------------------------------------
   This file used to assert `hermes === 'missing'` against the *host*: a rule
   about the machine, not about the code. Once hermes was installed here the
   assertion failed — and it failed in the shape of a real bug, so the only
   exits were to delete the check or to bend production code. Neither is
   acceptable, because the assertion is genuinely worth having: a binary that
   is present but refuses to run must never earn the green dot back.

   So the machine is replaced instead of the assertion. A `missing` command, a
   command that exists and exits 1, and a command that answers `--version` are
   three facts the test now *creates* (see helpers/isolated-agent-env.js),
   which is also the only way to exercise the third one at all: on a host
   without hermes, `ready` was previously untestable.

   One consequence is deliberate and worth naming. The adapter's `command` is
   set to `hermes`, the same string the family probe resolves, so the
   readiness under test cannot come from a disagreement between "what the
   adapter is configured to run" and "what was probed". That disagreement is
   real — agentStatus() takes readiness from the family probe and uses the
   configured command only for path/installed — but it is a production
   question, reported separately, not something to assert here as correct. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness.js');
const {
  isolatedAgentEnv, READY_VERSION, BROKEN_MESSAGE,
} = require('./helpers/isolated-agent-env.js');

// The port is assigned by the OS and reported back by the Bridge. A fixed port
// used to be hard-coded here; on this machine 4407 sits inside a Windows
// excluded port range, so binding it failed with EACCES even when nothing held
// it, and these three tests looked like permanent flakiness for weeks.
//
// One Bridge per readiness state. `openclaw` is a command this fixture never
// installs, so in all three worlds it must stay missing: that is the adapter
// level's own missing case, independent of the hermes shim.
const ADAPTERS = {
  openclaw: { command: 'openclaw', args: ['run', '{{prompt}}'], sandboxed: false },
  hermes: { command: 'hermes', args: ['{{prompt}}'], sandboxed: false },
};

const STATES = ['missing', 'broken', 'ready'];
const readinessOf = { missing: 'missing', broken: 'broken', ready: 'ready' };

let bridges = {};

test.before(async () => {
  for (const state of STATES) {
    bridges[state] = await startBridge({
      config: { adapters: ADAPTERS },
      env: (scratch) => isolatedAgentEnv(scratch, state === 'missing' ? {} : { hermes: state }),
    });
  }
});

test.after(() => {
  for (const harness of Object.values(bridges)) if (harness) harness.stop();
});

const get = (harness) => async (p) => {
  const response = await harness.json(p);
  return [response.status, response.body];
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The environment report is produced by a child process and cached for a
   minute, so `refresh=1` is what guarantees the probe reflects the PATH this
   Bridge was actually spawned with rather than a leftover. */
async function environment(harness) {
  const [status, report] = await get(harness)('/v1/agents/environment?refresh=1');
  assert.equal(status, 200);
  return report;
}
async function pickerAgents(harness) {
  const [status, payload] = await get(harness)('/v1/agents');
  assert.equal(status, 200);
  return payload.agents;
}
function entry(list, key, label) {
  const found = list.find((item) => (item.key || item.id) === key);
  assert.ok(found, `${label}里没有 ${key}`);
  return found;
}

test('环境体检报告每个 agent 的可运行性，而不只是路径存在', async () => {
  // Each world is checked against its own report, so the invariants below are
  // exercised by a `broken` entry and a `ready` entry rather than only by
  // whatever the host happened to provide.
  for (const state of STATES) {
    const report = await environment(bridges[state]);
    assert.ok(Array.isArray(report.agents) && report.agents.length, '必须返回 agent 列表');

    for (const agent of report.agents) {
      assert.ok(['ready', 'broken', 'missing', 'no_credential'].includes(agent.readiness),
        `未知状态 ${agent.readiness}`);
      // A green state must be backed by something the binary actually said.
      if (agent.readiness === 'ready') assert.ok(agent.version, `${agent.key} 报了 ready 却没有版本号`);
      // And a red state must say why, so the user is not left guessing.
      if (agent.readiness === 'broken') assert.ok(agent.problem, `${agent.key} 报了 broken 却没有原因`);
      // Nothing outside the fixture may appear: if a real install on this
      // machine leaked through the isolated PATH, every claim below would be
      // about the host again.
      if (agent.key !== 'hermes') {
        assert.equal(agent.readiness, 'missing',
          `隔离夹具失效：${agent.key} 泄漏了宿主状态（${agent.readiness}）`);
      }
    }

    assert.equal(entry(report.agents, 'hermes', '环境体检').readiness, readinessOf[state]);
  }
});

test('体检报告绝不包含完整凭据', async () => {
  // The panel needs to show WHICH provider is in effect; it never needs the
  // key itself, and the vault this plugin lives in is synced.
  const [, report] = await get(bridges.ready)('/v1/agents/environment');
  const text = JSON.stringify(report);
  assert.ok(!/sk-[A-Za-z0-9_-]{20,}/.test(text), '报告里出现了完整 API key');
  assert.ok(!/eyJ[A-Za-z0-9_-]{30,}/.test(text), '报告里出现了 JWT');
});

test('装了但跑不起来的 adapter 不会拿到 ready', async () => {
  // The three worlds, asked end to end: probe the environment, then read the
  // adapter list the picker renders.
  const seen = {};
  for (const state of STATES) {
    await environment(bridges[state]);
    seen[state] = entry(await pickerAgents(bridges[state]), 'hermes', 'agent 列表');
  }

  // 1. No command anywhere -> missing, and nothing claims otherwise.
  assert.equal(seen.missing.readiness, 'missing');
  assert.notEqual(seen.missing.installed, true);
  assert.equal(seen.missing.runnable, false);
  assert.equal(seen.missing.detectedVersion, null);

  // 2. Found, spawnable, exits 1 -> broken, WITH the binary's own words.
  //    This is the case that used to earn the green dot: `installed` is true
  //    and always was, which is exactly why `runnable` had to be split out.
  assert.equal(seen.broken.readiness, 'broken');
  assert.notEqual(seen.broken.readiness, 'ready');
  assert.equal(seen.broken.installed, true);
  assert.equal(seen.broken.runnable, false);
  assert.ok(seen.broken.problem, 'broken 必须带 problem');
  assert.match(String(seen.broken.problem), new RegExp(BROKEN_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'problem 必须原样带上二进制的拒绝理由，而不是替换成统一的“未找到”');

  // 3. --version answered -> ready, and runnable is not false.
  assert.equal(seen.ready.readiness, 'ready');
  assert.notEqual(seen.ready.runnable, false);
  assert.equal(seen.ready.runnable, true);
  assert.equal(seen.ready.detectedVersion, READY_VERSION);

  // The invariant that produced the original false green dot: ready must
  // never coexist with runnable === false, and the unverified state must
  // stay distinguishable from both.
  for (const state of STATES) {
    const agent = seen[state];
    if (agent.readiness === 'ready') {
      assert.notEqual(agent.runnable, false, `${agent.id} 被判为 ready 但 runnable=false`);
    }
    assert.ok(['ready', 'broken', 'missing', 'command_detected'].includes(agent.readiness));
  }

  // A command the fixture never installs is missing in every world, whatever
  // the shim does — the hermes result cannot be an artefact of the shim.
  for (const state of STATES) {
    const openclaw = entry(await pickerAgents(bridges[state]), 'openclaw', 'agent 列表');
    assert.equal(openclaw.readiness, 'missing', `${state} 世界里 openclaw 应为 missing`);
    assert.equal(openclaw.runnable, false);
  }
});

test('升级路径也会补跑一次探测', async () => {
  // The config was written without an agentDetection field, exactly as an
  // older build would have left it.
  const harness = bridges.ready;
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
  const harness = bridges.ready;
  const post = async (p, payload) => {
    const response = await harness.json(p, { method: 'POST', body: payload });
    return [response.status, response.body];
  };

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
