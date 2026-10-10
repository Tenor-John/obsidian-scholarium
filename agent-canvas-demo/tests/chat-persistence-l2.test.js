"use strict";
// L2：动态端口重启后，对话正文逐字一致。
//
// 这条测试直接对应被修掉的那个缺陷：正文此前只存在 localStorage 里，而
// localStorage 是按 Origin 隔离的，canvas 端口每次启动都可能不同 → 换端口
// 就等于换了一个空白存储。所以这里必须真的起一个 Bridge、写两轮对话、把它
// 停掉、再用**不同端口**起一个新的，然后把内容逐字比一遍。
//
// 端口由 harness 让 OS 分配（不猜端口、不探测端口），两个 Bridge 之间只共享
// Vault 目录与 token，不共享任何内存状态。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const chatStore = require('../bridge/chat-store.js');
const { startBridge } = require('./helpers/bridge-harness.js');

const { scopeHash } = chatStore;
const SCOPE_KEY = 'topic:l2-restart';
const TOKEN = 'l2-restart-token';

let vault;
let first, second;
let firstPort, secondPort;
let sessionId;
const written = [];

function sessionFile() {
  return path.join(vault, 'Scholarium', 'Chat', 'v1', scopeHash(SCOPE_KEY), `${sessionId}.jsonl`);
}

function message(messageId, role, text, at, payload) {
  return { messageId, role, text, at, payload };
}

async function startOnVaultIsolatedFrom(otherPort) {
  // 端口冲突极少见，但不能让"OS 又给了同一个端口"变成一次假绿/假红：
  // 重起直到拿到一个不同的端口为止。
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const bridge = await startBridge({
      token: TOKEN,
      config: {
        workspaceRoot: vault,
        allowedRoots: [vault],
        adapters: {},
        scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
      },
    });
    if (bridge.port !== otherPort) return bridge;
    bridge.stop();
  }
  throw new Error('could not obtain a second port for the restart leg');
}

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-vault-'));

  // ── 第一个 Bridge：写两轮对话 ───────────────────────────────────────
  first = await startBridge({
    token: TOKEN,
    config: {
      workspaceRoot: vault,
      allowedRoots: [vault],
      adapters: {},
      scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
    },
  });
  firstPort = first.port;

  const created = await first.json('/v1/chat/sessions', {
    method: 'POST', body: { scopeKey: SCOPE_KEY, topicId: 'l2-restart', title: '重启前' },
  });
  assert.equal(created.status, 200, created.text);
  sessionId = created.body.session.sessionId;

  const rounds = [
    ['m-l2aa01-11112222', 'user', '第一轮：Au@CeO2 的壳厚怎么定？', '2026-09-23T10:00:00.000Z', { round: 1 }],
    ['m-l2aa02-11112222', 'agent', '第一轮答复：先固定光照与 pH，壳厚单变量。', '2026-09-23T10:00:05.000Z', { round: 1, cards: [{ kind: 'draft' }] }],
    ['m-l2aa03-11112222', 'user', '第二轮：那对照组怎么设？', '2026-09-23T10:01:00.000Z', { round: 2 }],
    ['m-l2aa04-11112222', 'agent', '第二轮答复：设 0/2/4/8 nm 四档，n=3。', '2026-09-23T10:01:07.000Z', { round: 2, confirmationStates: { draft: 'confirmed' } }],
  ];
  for (const [messageId, role, text, at, payload] of rounds) {
    const appended = await first.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST', body: { message: message(messageId, role, text, at, payload) },
    });
    assert.equal(appended.status, 200, appended.text);
    assert.deepEqual(appended.body.appended, [messageId]);
    written.push(message(messageId, role, text, at, payload));
  }
  const bytesBefore = fs.readFileSync(sessionFile(), 'utf8');
  assert.equal(bytesBefore.split('\n').filter(Boolean).length, 5, '一行会话头 + 四条正文');

  // ── 停掉 Bridge：模拟 launcher 退出 ────────────────────────────────
  first.stop();
  first = null;

  // ── 第二个 Bridge，不同端口，同一个 Vault ─────────────────────────
  second = await startOnVaultIsolatedFrom(firstPort);
  secondPort = second.port;
  assert.notEqual(secondPort, firstPort, '重启必须换端口，否则测不到 Origin 变化这类丢失');
});

test.after(() => {
  if (first) first.stop();
  if (second) second.stop();
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('换端口重启后，会话仍能被列出并原样读出', async () => {
  const listed = await second.json(`/v1/chat/sessions?scopeKey=${encodeURIComponent(SCOPE_KEY)}`);
  assert.equal(listed.status, 200, listed.text);
  assert.equal(listed.body.sessions.length, 1, '新端口必须能发现旧端口写的会话');
  assert.equal(listed.body.sessions[0].sessionId, sessionId);
  assert.equal(listed.body.sessions[0].messageCount, 4);

  const read = await second.json(`/v1/chat/sessions/${sessionId}?limit=50`);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.total, 4);
  // 逐字一致，而不是"大致还在"：文本、角色、时间戳、payload 全部逐个比。
  assert.deepEqual(read.body.messages.map((item) => ({
    messageId: item.messageId, role: item.role, text: item.text, at: item.at, payload: item.payload,
  })), written);
});

test('重启不修改磁盘上的正文：逐字节一致', async () => {
  const bytes = fs.readFileSync(sessionFile(), 'utf8');
  for (const item of written) {
    assert.ok(bytes.includes(JSON.stringify(item.text)), `正文里必须逐字保留：${item.text}`);
  }
  // 行数不变、没有重写、没有把 JSONL 变成别的形状。
  const lines = bytes.split('\n').filter(Boolean);
  assert.equal(lines.length, 5);
  assert.equal(JSON.parse(lines[0]).type, 'session');
  assert.deepEqual(lines.slice(1).map((line) => JSON.parse(line).messageId), written.map((item) => item.messageId));
});

test('重启后继续追加不会回头破坏已有行', async () => {
  const before = fs.readFileSync(sessionFile(), 'utf8');
  const appended = await second.json(`/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: { message: message('m-l2aa05-11112222', 'user', '第三轮：重启后写的。', '2026-09-23T10:02:00.000Z', { round: 3 }) },
  });
  assert.equal(appended.status, 200, appended.text);
  assert.equal(appended.body.total, 5);
  const after = fs.readFileSync(sessionFile(), 'utf8');
  assert.ok(after.startsWith(before), '新的一轮只能是追加，已有正文必须逐字保留');
  assert.equal(after.length > before.length, true);
});

test('重启后再重启（第三个端口）依旧逐字一致', async () => {
  const third = await startOnVaultIsolatedFrom(secondPort);
  try {
    assert.notEqual(third.port, secondPort);
    const read = await third.json(`/v1/chat/sessions/${sessionId}?limit=50`);
    assert.equal(read.status, 200, read.text);
    assert.equal(read.body.total, 5);
    assert.deepEqual(read.body.messages.slice(0, 4).map((item) => item.text), written.map((item) => item.text));
  } finally {
    third.stop();
  }
});

/* ==================================================================== *
 * 确认锁定态 + 执行幂等账本（契约 §2.1 / §2.2）的五条 L2 场景
 *
 * 这一组要证明的是那个发布阻断项真的被堵住了：确认一次真实写入
 * （experiment.transition 会改 Research/Experiments/*.md）之后，刷新页面不许
 * 让同一张卡片回到"待确认"，重复提交同一个 operationId 也不许再改一个字节。
 * ==================================================================== */

const repoRoot = path.resolve(__dirname, '..', '..');
const schemaObjects = require(path.join(repoRoot, 'tools', 'schema-objects.js'));

const CONFIRM_SCOPE = 'topic:l2-confirm';
const CONFIRM_TOKEN = 'l2-confirm-token';
const CONFIRMED_HEADER = { 'x-scholarium-user-confirmed': 'true' };

function writeExperimentFixture(vault, status) {
  const object = schemaObjects.createObject('experiment', {
    project_uid: '01919c7a-0001-7abc-89ab-1234567890ab',
    title: 'l2 confirmation fixture',
    status,
    data_origin: 'planned',
    data_recorded_by: 'user',
    data_recorded_at: '2026-09-23T00:00:00Z',
  }, { uid: '01919c7a-0002-7abc-89ab-1234567890ab', display_id: 'EXP-001' });
  const file = path.join(vault, 'Research', 'Experiments', 'EXP-001.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, schemaObjects.serializeObject(object, '# fixture\n'), 'utf8');
  return file;
}

// 直接读磁盘上的状态字段：这一组断言的是"文件到底变没变"，不是接口怎么回的。
function experimentStatus(file) {
  return schemaObjects.parseObject(fs.readFileSync(file, 'utf8')).object.status;
}

function experimentFileCount(vault) {
  const dir = path.join(vault, 'Research', 'Experiments');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.md')).length : 0;
}

function experimentBytes(file) {
  const raw = fs.readFileSync(file);
  return { sha256: crypto.createHash('sha256').update(raw).digest('hex'), length: raw.length };
}

function launchConfirmBridge(vault) {
  return startBridge({
    token: CONFIRM_TOKEN,
    config: {
      workspaceRoot: vault,
      allowedRoots: [vault],
      adapters: {},
      scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
    },
  });
}

// 模拟 shell 的一次确认：只写 claimed 事件（账本行由执行端点创建），投递后
// 再追加终态。顺序就是契约 §2.1 硬性规则 1 的顺序，测试里也照这个顺序走。
// expectTicket='ok'：账本里这一单存在（受守卫的路径，由执行端点创建）。
// expectTicket='missing'：投递从未发生，账本里没有这一单——shell 的 settle 会
// 吞掉这个 404（没有账本行不代表这次确认不能闭合），会话文件里仍然必须留终态。
async function settleConfirmation(bridge, sessionId, messageId, kind, operationId, outcome, detail, expectTicket = 'ok') {
  const appended = await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: { confirmation: { messageId, kind, state: outcome, operationId, detail, at: new Date().toISOString() } },
  });
  assert.equal(appended.status, 200, appended.text);
  const resolved = await bridge.json(`/v1/chat/operations/${operationId}/resolve`, {
    method: 'POST', headers: CONFIRMED_HEADER, body: { outcome, detail },
  });
  assert.equal(resolved.status, expectTicket === 'ok' ? 200 : 404, resolved.text);
  return resolved.body;
}

// 卡片按钮可点性的唯一判据（与 shell-ui.js 的 isConfirmableState 一致）。
const confirmable = (state) => state === 'pending' || state === 'failed';

async function readConfirmationState(bridge, sessionId, messageId, kind) {
  const read = await bridge.json(`/v1/chat/sessions/${sessionId}?limit=50`);
  assert.equal(read.status, 200, read.text);
  const message = read.body.messages.find((item) => item.messageId === messageId);
  assert.ok(message, '必须能读回那条带确认卡的消息');
  const entry = message.payload?.confirmations?.[kind];
  return { state: entry?.state || read.body.confirmations.find((c) => c.messageId === messageId && c.kind === kind)?.state || 'pending', message, entry };
}

test('L2 场景 1-3：确认 experiment.transition → 换端口重载 → 卡片不能再次确认', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-confirm-'));
  const experiment = writeExperimentFixture(vault, 'designed');
  let bridge = await launchConfirmBridge(vault);
  const firstPort = bridge.port;
  try {
    const created = await bridge.json('/v1/chat/sessions', { method: 'POST', body: { scopeKey: CONFIRM_SCOPE, topicId: 'l2-confirm', title: '确认' } });
    assert.equal(created.status, 200, created.text);
    const sessionId = created.body.session.sessionId;
    const messageId = 'm-l2cnf01-11112222';
    const operationId = 'op-l2cnf001-11112222';

    // 一张真实的 experiment.transition 确认卡（payload 与 shell 写进去的形状一致）。
    const appended = await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: {
        message: {
          messageId, role: 'agent', text: '准备把 EXP-001 推进到 running。', at: new Date().toISOString(),
          payload: { actions: [{ action: 'experiment.transition', input: { experiment_uid: '01919c7a-0002-7abc-89ab-1234567890ab', to_status: 'ready', reason: 'L2 fixture' } }] },
        },
      },
    });
    assert.equal(appended.status, 200, appended.text);

    // ① 确认：claimed（会话）→ 账本占位 → preview + commit（真实写入）→ confirmed。
    // shell 只写 claimed 事件；账本那一行由执行端点在收到 operationId 时创建
    // （受守卫的确认不预先占位，否则同一个号会被占两次，第二次被判"同 ID 换请求"）。
    const claimEvent = await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { confirmation: { messageId, kind: 'action', state: 'claimed', operationId, at: new Date().toISOString() } },
    });
    assert.equal(claimEvent.status, 200, claimEvent.text);
    assert.equal((await bridge.json(`/v1/chat/operations/${operationId}`)).status, 404, '投递之前账本里不该有这一单');
    const preview = await bridge.json('/v1/edits/experiment-transition/preview', {
      method: 'POST',
      body: { experiment_uid: '01919c7a-0002-7abc-89ab-1234567890ab', to_status: 'ready', reason: 'L2 fixture' },
    });
    assert.equal(preview.status, 201, preview.text);
    // 投递必须带 operationId（shell 的 chatDispatch 注入的就是这个头）：执行端
    // 据此建账本行并把它闭合，重放时才有"原结果 + 不写文件"可返回。
    const commit = await bridge.json(`/v1/edits/${preview.body.id}/commit`, {
      method: 'POST', body: {}, headers: { 'x-scholarium-operation-id': operationId },
    });
    assert.equal(commit.status, 200, commit.text);
    assert.equal(experimentStatus(experiment), 'ready', '这次确认必须真的改了实验记录');
    const ledgerAfterCommit = await bridge.json(`/v1/chat/operations/${operationId}`);
    assert.equal(ledgerAfterCommit.status, 200, ledgerAfterCommit.text);
    assert.equal(ledgerAfterCommit.body.status, 'confirmed', '带号的投递必须在账本里留下终态');
    await settleConfirmation(bridge, sessionId, messageId, 'action', operationId, 'confirmed', { paths: ['Research/Experiments/EXP-001.md'] });

    const afterCommit = {
      files: experimentFileCount(vault),
      bytes: experimentBytes(experiment),
      state: (await readConfirmationState(bridge, sessionId, messageId, 'action')).state,
    };
    assert.equal(afterCommit.state, 'confirmed');
    assert.equal(confirmable(afterCommit.state), false, 'confirmed 是锁定态，卡片不许再点');

    // ② 重载页面：停掉 Bridge，换一个端口重新起来（换了 Origin 就是换了页面）。
    bridge.stop();
    bridge = null;
    let restarted = await launchConfirmBridge(vault);
    for (let attempt = 0; attempt < 5 && restarted.port === firstPort; attempt += 1) {
      restarted.stop();
      restarted = await launchConfirmBridge(vault);
    }
    bridge = restarted;
    assert.notEqual(bridge.port, firstPort, '重载必须换端口，否则测不到 Origin 变化那类丢失');

    const reloaded = await readConfirmationState(bridge, sessionId, messageId, 'action');
    assert.equal(reloaded.state, 'confirmed', '③ 重载后绝不回落成 pending');
    assert.equal(confirmable(reloaded.state), false, '③ 重载后卡片仍然不能再次确认');
    assert.equal(reloaded.entry.operationId, operationId);
    const readBack = await bridge.json(`/v1/chat/sessions/${sessionId}?limit=50`);
    assert.equal(readBack.body.messages[0].payload.actionsState, 'confirmed', '旧字段也要是派生后的值');

    // ③ 想再确认一次是**写不进去**的：存储层把"终态之后又来 claimed"判成损坏。
    const illegal = await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { confirmation: { messageId, kind: 'action', state: 'claimed', operationId: 'op-l2cnf002-11112222' } },
    });
    assert.equal(illegal.status, 400);
    assert.match(illegal.body.error, /confirmation state is corrupt/);

    // 而整个会话的读取也必须响亮失败（而不是把卡片悄悄渲染回 pending）。
    const file = path.join(vault, 'Scholarium', 'Chat', 'v1', chatStore.scopeHash(CONFIRM_SCOPE), `${sessionId}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify({ type: 'confirmation', eventId: 'evt-l2manual-11112222', messageId, kind: 'action', state: 'claimed', operationId: 'op-l2cnf003-11112222', at: new Date(Date.now() + 60000).toISOString() })}\n`, 'utf8');
    const corrupt = await bridge.json(`/v1/chat/sessions/${sessionId}?limit=50`);
    assert.equal(corrupt.status, 500);
    assert.match(corrupt.body.error, /confirmation state is corrupt/);
    assert.equal(corrupt.body.kind, 'action');
    // 但实验文件没有被这次非法尝试动过。
    assert.deepEqual(experimentBytes(experiment), afterCommit.bytes, '当掉的那次确认不许改动任何实验文件');
    assert.equal(experimentFileCount(vault), afterCommit.files);
  } finally {
    if (bridge) bridge.stop();
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('L2 场景 4：同一个 operationId 再提交一次，实验文件数量与内容哈希不变', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-replay-'));
  const experiment = writeExperimentFixture(vault, 'designed');
  const bridge = await launchConfirmBridge(vault);
  try {
    const preview = await bridge.json('/v1/edits/experiment-transition/preview', {
      method: 'POST',
      body: { experiment_uid: '01919c7a-0002-7abc-89ab-1234567890ab', to_status: 'ready', reason: 'L2 replay' },
    });
    assert.equal(preview.status, 201, preview.text);
    const operationId = 'op-l2rply01-11112222';
    const commitPath = `/v1/edits/${preview.body.id}/commit`;
    const first = await bridge.json(commitPath, { method: 'POST', body: {}, headers: { 'x-scholarium-operation-id': operationId } });
    assert.equal(first.status, 200, first.text);
    assert.equal(experimentStatus(experiment), 'ready');
    const afterFirst = { files: experimentFileCount(vault), bytes: experimentBytes(experiment) };

    // 同一次确认（同 ID、同请求）重放：一个字节都不许再写。
    const second = await bridge.json(commitPath, { method: 'POST', body: {}, headers: { 'x-scholarium-operation-id': operationId } });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.replayed, true, '终态 + 同请求必须是重放，而不是再执行一次');
    assert.equal(second.body.ok, true);
    assert.equal(experimentStatus(experiment), 'ready');
    assert.deepEqual(experimentBytes(experiment), afterFirst.bytes, '重放不得改动实验文件的任何一个字节');
    assert.equal(experimentFileCount(vault), afterFirst.files, '重放不得新建/删除任何文件');

    // 同 ID 但换了请求（另一个端点、另一份载荷）→ 409，绝不执行。
    const reused = await bridge.json('/v1/skills/run', {
      method: 'POST',
      body: { skillId: 'whatever', workspace: vault, input: '{}' },
      headers: { 'x-scholarium-operation-id': operationId },
    });
    assert.equal(reused.status, 409, reused.text);
    assert.equal(reused.body.error, 'operation id reused with a different request');
    assert.deepEqual(experimentBytes(experiment), afterFirst.bytes, '同 ID 换请求不得改动任何文件');
    assert.equal(experimentFileCount(vault), afterFirst.files);

    // 账本可以直接查询到这条执行。
    const readLedger = await bridge.json(`/v1/chat/operations/${operationId}`);
    assert.equal(readLedger.status, 200, readLedger.text);
    assert.equal(readLedger.body.status, 'confirmed');
    assert.equal((await bridge.json('/v1/chat/operations/op-nosuch00-11112222')).status, 404);
  } finally {
    bridge.stop();
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('L2 场景 5a：崩溃在 claimed→dispatch 之间——不许自动重跑，只能人工核对', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-crash1-'));
  const experiment = writeExperimentFixture(vault, 'designed');
  let bridge = await launchConfirmBridge(vault);
  const firstPort = bridge.port;
  try {
    const created = await bridge.json('/v1/chat/sessions', { method: 'POST', body: { scopeKey: CONFIRM_SCOPE } });
    const sessionId = created.body.session.sessionId;
    const messageId = 'm-l2crash1-11112222';
    const operationId = 'op-l2crash01-11112222';
    await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { message: { messageId, role: 'agent', text: '确认卡', at: new Date().toISOString(), payload: { actions: [{ action: 'experiment.transition', input: {} }] } } },
    });
    // 写了 claimed 事件，然后"崩"在这里——投递从未发生。
    // 受守卫的确认（action / draft / …）**不**由 shell 预先占位：账本那一行是执行
    // 端点收到 x-scholarium-operation-id 时创建的。所以崩溃在投递之前时，账本里
    // 查不到任何东西——这正是"磁盘上应该什么都没有"的证据。
    const claimedEvent = await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { confirmation: { messageId, kind: 'action', state: 'claimed', operationId, at: new Date().toISOString() } },
    });
    assert.equal(claimedEvent.status, 200, claimedEvent.text);
    const beforeCrash = experimentBytes(experiment);
    bridge.stop();
    bridge = await launchConfirmBridge(vault);
    assert.notEqual(bridge.port, firstPort);

    // 重载后：锁定在 claimed，卡片不可点 —— 这正是"正在核对执行结果"的形状。
    const reloaded = await readConfirmationState(bridge, sessionId, messageId, 'action');
    assert.equal(reloaded.state, 'claimed');
    assert.equal(confirmable(reloaded.state), false, 'claimed 期间禁止再次投递');
    // 账本里没有这一单：投递根本没发生，所以磁盘上也不该有痕迹。
    const missingTicket = await bridge.json(`/v1/chat/operations/${operationId}`);
    assert.equal(missingTicket.status, 404);
    assert.equal(missingTicket.body.error, 'operation not found');
    // 研究员核对 Vault：什么都没有发生过 → 标 failed，实验文件一个字节没动。
    assert.deepEqual(experimentBytes(experiment), beforeCrash, '崩溃窗口里实验文件必须原样');
    const nothingToClose = await bridge.json(`/v1/chat/operations/${operationId}/resolve`, {
      method: 'POST', headers: CONFIRMED_HEADER, body: { outcome: 'failed', detail: { reason: '研究员核对：Vault 里没有本次写入' } },
    });
    assert.equal(nothingToClose.status, 404, '账本里没有这一单，resolve 只能 404');
    // shell 的 settle 会吞掉这个 404（没有账本行不代表这次确认不能闭合），
    // 所以会话文件里仍然必须留下终态——否则这张卡片会永远卡在 claimed。
    await settleConfirmation(bridge, sessionId, messageId, 'action', operationId, 'failed', { reason: '未生效' }, 'missing');
    const after = await readConfirmationState(bridge, sessionId, messageId, 'action');
    assert.equal(after.state, 'failed');
    assert.equal(confirmable(after.state), true, 'failed 之后可以用**新的**号码重试（新的一次确认）');
    assert.deepEqual(experimentBytes(experiment), beforeCrash);

    /* 另一半：真实派发挂不上头的那些确认（run / suggestReconstruction）由 shell
     * 预先占位，此时"崩溃窗口"必须能挡住重投——同一张票据再占位 409，换请求也 409。 */
    const unguarded = 'op-l2run0001-11112222';
    const preClaim = await bridge.json(`/v1/chat/operations/${unguarded}/claim`, {
      method: 'POST', body: { kind: 'run', messageId, request: { runs: [{ operation: 'literature.search' }] } },
    });
    assert.equal(preClaim.status, 200, preClaim.text);
    assert.equal(preClaim.body.proceed, true);
    const reclaim = await bridge.json(`/v1/chat/operations/${unguarded}/claim`, {
      method: 'POST', body: { kind: 'run', messageId, request: { runs: [{ operation: 'literature.search' }] } },
    });
    assert.equal(reclaim.status, 409);
    assert.equal(reclaim.body.error, 'operation already claimed');
    const reused = await bridge.json(`/v1/chat/operations/${unguarded}/claim`, {
      method: 'POST', body: { kind: 'run', messageId, request: { runs: [{ operation: 'literature.queue' }] } },
    });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error, 'operation id reused with a different request');
    // 人工核对后闭合；重复调用幂等。
    const closed = await bridge.json(`/v1/chat/operations/${unguarded}/resolve`, {
      method: 'POST', headers: CONFIRMED_HEADER, body: { outcome: 'failed', detail: { reason: '研究员核对：未生效' } },
    });
    assert.equal(closed.status, 200, closed.text);
    assert.equal(closed.body.resolved, true);
    const reResolve = await bridge.json(`/v1/chat/operations/${unguarded}/resolve`, {
      method: 'POST', headers: CONFIRMED_HEADER, body: { outcome: 'confirmed' },
    });
    assert.equal(reResolve.status, 200, reResolve.text);
    assert.equal(reResolve.body.replayed, true, '已结的票据不许被第二次改写');
    // 缺确认头一律拒绝。
    const unconfirmed = await bridge.json(`/v1/chat/operations/${unguarded}/resolve`, { method: 'POST', body: { outcome: 'confirmed' } });
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.body.error, 'user confirmation required');
  } finally {
    if (bridge) bridge.stop();
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('§2.3：pipeline 入口带号之后，同一张票据第二次投递不会再建运行记录', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-entry-'));
  const bridge = await launchConfirmBridge(vault);
  try {
    const operationId = 'op-l2entry01-11112222';
    const body = { title: '入口幂等探针', workspace: vault };
    const headers = { 'x-scholarium-operation-id': operationId };
    const first = await bridge.json('/v1/pipeline-runs', { method: 'POST', body, headers });
    assert.equal(first.status, 201, first.text);
    assert.ok(first.body.id, '第一次必须真的建出运行记录');
    // 同一张票据再来一次：入口直接重放原记录，第二次 pipeline 不会启动。
    const second = await bridge.json('/v1/pipeline-runs', { method: 'POST', body, headers });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.body.replayed, true, '第二次必须是重放，不能真的再跑一遍');
    assert.equal(second.body.id, first.body.id, '重放必须返回同一条运行记录，而不是新建一条');
    const ledger = await bridge.json(`/v1/chat/operations/${operationId}`);
    assert.equal(ledger.status, 200, ledger.text);
    assert.equal(ledger.body.status, 'confirmed');
    assert.equal(ledger.body.kind, 'pipeline.entry');
    // 不带号的调用方（既有流程）行为不变：照常各自建一条记录。
    const unnumbered = await bridge.json('/v1/pipeline-runs', { method: 'POST', body });
    assert.equal(unnumbered.status, 201, unnumbered.text);
    assert.notEqual(unnumbered.body.id, first.body.id);
  } finally {
    bridge.stop();
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('§2.4：跨层——shell 的可点判据与存储层派生出来的五个状态必须一致', async () => {
  // 判据本身从 shell 源码里取，不靠注释对齐两层。
  const shellSource = fs.readFileSync(path.join(__dirname, '..', 'shell-ui.js'), 'utf8');
  const predicate = /function isConfirmableState\(state\) \{ return state === '(\w+)'; \}/.exec(shellSource);
  assert.ok(predicate, 'isConfirmableState 必须是"只允许一个状态"的形状');
  const confirmable = (state) => state === predicate[1];
  assert.equal(predicate[1], 'pending', '§2.4：只有 pending 可以再点');

  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-states-'));
  const bridge = await launchConfirmBridge(vault);
  try {
    const sessionId = (await bridge.json('/v1/chat/sessions', { method: 'POST', body: { scopeKey: CONFIRM_SCOPE } })).body.session.sessionId;
    const messageId = 'm-l2state1-11112222';
    await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { message: { messageId, role: 'agent', text: '确认卡', at: new Date().toISOString(), payload: { runs: [{ operation: 'literature.search' }] } } },
    });
    // pending（没有事件）= 唯一可点的那一个。
    assert.equal((await readConfirmationState(bridge, sessionId, messageId, 'run')).state, 'pending');
    assert.equal(confirmable('pending'), true);

    const write = (confirmation) => bridge.json(`/v1/chat/sessions/${sessionId}/messages`, { method: 'POST', body: { confirmation } });
    await write({ messageId, kind: 'run', state: 'claimed', operationId: 'op-l2state1-11112222' });
    // claimed：只能核对结果，不能执行。
    assert.equal(confirmable((await readConfirmationState(bridge, sessionId, messageId, 'run')).state), false);
    await write({ messageId, kind: 'run', state: 'failed', operationId: 'op-l2state1-11112222', detail: { reason: '控制器抛错' } });
    // failed：本次没有生效，但**没有**原位重试按钮（§2.4）。
    assert.equal(confirmable((await readConfirmationState(bridge, sessionId, messageId, 'run')).state), false, 'failed 不许在原卡上重试');
    // confirmed 与 abandoned 同样锁定。
    await write({ messageId, kind: 'plot', state: 'abandoned' });
    assert.equal(confirmable('abandoned'), false);
    await write({ messageId, kind: 'normalize', state: 'claimed', operationId: 'op-l2state2-11112222' });
    await write({ messageId, kind: 'normalize', state: 'confirmed', operationId: 'op-l2state2-11112222' });
    const read = await bridge.json(`/v1/chat/sessions/${sessionId}?limit=50`);
    assert.equal(read.body.messages[0].payload.confirmations.normalize.state, 'confirmed');
    assert.equal(confirmable('confirmed'), false);
    // 每个状态都只被 shell 的判据放行一次真相：这五个状态里只有 pending 可点。
    assert.deepEqual(['pending', 'claimed', 'confirmed', 'failed', 'abandoned'].filter(confirmable), ['pending']);
  } finally {
    bridge.stop();
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test('L2 场景 5b：崩溃在 dispatch→confirmed 之间——文件已写、状态仍 claimed，人工核对后闭合', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-l2-crash2-'));
  const experiment = writeExperimentFixture(vault, 'designed');
  let bridge = await launchConfirmBridge(vault);
  const firstPort = bridge.port;
  try {
    const created = await bridge.json('/v1/chat/sessions', { method: 'POST', body: { scopeKey: CONFIRM_SCOPE } });
    const sessionId = created.body.session.sessionId;
    const messageId = 'm-l2crash2-11112222';
    const operationId = 'op-l2crash02-11112222';
    await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { message: { messageId, role: 'agent', text: '确认卡', at: new Date().toISOString(), payload: { actions: [{ action: 'experiment.transition', input: {} }] } } },
    });
    // claimed 事件落了盘；投递走带 operationId 的执行端点（它自己会占位并闭合），
    // 然后页面在追加 confirmed 事件之前"崩"了。
    const claimedEvent = await bridge.json(`/v1/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: { confirmation: { messageId, kind: 'action', state: 'claimed', operationId, at: new Date().toISOString() } },
    });
    assert.equal(claimedEvent.status, 200, claimedEvent.text);
    const preview = await bridge.json('/v1/edits/experiment-transition/preview', {
      method: 'POST',
      body: { experiment_uid: '01919c7a-0002-7abc-89ab-1234567890ab', to_status: 'ready', reason: 'L2 crash 5b' },
    });
    const commit = await bridge.json(`/v1/edits/${preview.body.id}/commit`, {
      method: 'POST', body: {}, headers: { 'x-scholarium-operation-id': operationId },
    });
    assert.equal(commit.status, 200, commit.text);
    assert.equal(experimentStatus(experiment), 'ready');
    const writtenBytes = experimentBytes(experiment);
    // ← 这里就是崩溃点：没有追加 confirmed 事件。
    bridge.stop();
    bridge = await launchConfirmBridge(vault);
    assert.notEqual(bridge.port, firstPort);

    const reloaded = await readConfirmationState(bridge, sessionId, messageId, 'action');
    assert.equal(reloaded.state, 'claimed', '会话文件只知道"投递过"，不知道结果——这正是要人工核对的状态');
    assert.equal(confirmable(reloaded.state), false, '禁止直接重跑');
    // 但账本知道：这次执行已经成功闭合过。
    const ledger = await bridge.json(`/v1/chat/operations/${operationId}`);
    assert.equal(ledger.status, 200, ledger.text);
    assert.equal(ledger.body.status, 'confirmed', '账本必须记得这次写入已经生效');
    assert.equal(ledger.body.result?.ok, true);

    // 重放同一个执行请求不会写第二遍。
    const replay = await bridge.json(`/v1/edits/${preview.body.id}/commit`, {
      method: 'POST', body: {}, headers: { 'x-scholarium-operation-id': operationId },
    });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(experimentBytes(experiment), writtenBytes, '重放不动实验文件');

    // 研究员核对后把这次确认标成 confirmed：卡片从此锁定。
    await settleConfirmation(bridge, sessionId, messageId, 'action', operationId, 'confirmed', { note: '核对账本：已生效' });
    const settled = await readConfirmationState(bridge, sessionId, messageId, 'action');
    assert.equal(settled.state, 'confirmed');
    assert.equal(confirmable(settled.state), false);
    assert.deepEqual(experimentBytes(experiment), writtenBytes);
    assert.equal(experimentFileCount(vault), 1);
  } finally {
    if (bridge) bridge.stop();
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
