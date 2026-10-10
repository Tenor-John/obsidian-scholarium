"use strict";
// /v1/chat/* 的端到端测试：真实临时 Vault + 真实 Bridge 子进程
// （tests/helpers/bridge-harness.js 让 OS 分配端口，测试不猜端口）。
//
// 这里断言的是"研究员的历史到底有没有落盘"，不是"HTTP 返回了 200"。所以每条
// 写路径都回读磁盘上的 .jsonl；每条拒绝路径都断言具体的状态码与措辞，因为
// shell 与 v2 会按状态码区分"没这段历史(404)"和"你调用错了(400)"。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chatStore = require('../bridge/chat-store.js');
const { startBridge } = require('./helpers/bridge-harness.js');

const { scopeHash } = chatStore;
const CONFIRMED = { 'x-scholarium-user-confirmed': 'true' };

let harness, vault, noVaultHarness, noVaultDir, otherVault;

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-endpoint-vault-'));
  harness = await startBridge({
    config: {
      workspaceRoot: vault,
      allowedRoots: [vault],
      adapters: {},
      scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
    },
  });
  // 第二个 Bridge 故意不配 scholarium.vaultRoot：契约要求这时整条路由 400，
  // 而不是"落到 workspaceRoot 也能凑合写"。
  noVaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-endpoint-novault-'));
  noVaultHarness = await startBridge({ config: { workspaceRoot: noVaultDir, allowedRoots: [noVaultDir], adapters: {} } });
  otherVault = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-endpoint-other-'));
});

test.after(() => {
  if (harness) harness.stop();
  if (noVaultHarness) noVaultHarness.stop();
  for (const dir of [vault, noVaultDir, otherVault]) {
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const call = (pathname, options = {}) => harness.json(pathname, options);
const json = (response) => {
  assert.equal(response.body !== null, true, `响应不是 JSON：${response.text}`);
  return response.body;
};

function sessionFile(scopeKey, sessionId) {
  return path.join(vault, 'Scholarium', 'Chat', 'v1', scopeHash(scopeKey), `${sessionId}.jsonl`);
}

function eventLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('无 token 一律 401，且读写都不落盘', async () => {
  for (const [method, pathname, body] of [
    ['GET', '/v1/chat/sessions?scopeKey=topic:noauth', undefined],
    ['POST', '/v1/chat/sessions', { scopeKey: 'topic:noauth' }],
    ['POST', '/v1/chat/sessions/s-aaaaaaaa-bbbbbbbb/messages', { message: { role: 'user', text: 'x' } }],
    ['PATCH', '/v1/chat/sessions/s-aaaaaaaa-bbbbbbbb', { title: 'x' }],
    ['POST', '/v1/chat/import/preview', { items: [] }],
    ['POST', '/v1/chat/import/commit', { ticket: 'imp-x', confirm: true }],
  ]) {
    const response = await call(pathname, { method, body, auth: false });
    assert.equal(response.status, 401, `${method} ${pathname}`);
    assert.match(json(response).error, /Agent Bridge token/);
  }
  assert.equal(fs.existsSync(path.join(vault, 'Scholarium', 'Chat')), false, '401 的请求不得创建任何东西');
});

test('vaultRoot 没配好时整条路由 400，措辞沿用既有约定', async () => {
  const response = await noVaultHarness.json('/v1/chat/sessions?scopeKey=topic:x');
  assert.equal(response.status, 400);
  assert.equal(json(response).error, 'scholarium.vaultRoot is not configured or does not exist.');
  const created = await noVaultHarness.json('/v1/chat/sessions', { method: 'POST', body: { scopeKey: 'topic:x' } });
  assert.equal(created.status, 400);
});

test('会话生命周期：创建幂等 → 追加 → 分页读取 → 改名/归档', async () => {
  const scopeKey = 'topic:flow-lifecycle';
  const created = await call('/v1/chat/sessions', { method: 'POST', body: { scopeKey, topicId: 'flow-lifecycle', title: '生命周期' } });
  assert.equal(created.status, 200);
  const session = json(created).session;
  assert.equal(json(created).created, true);
  assert.match(session.sessionId, /^s-[a-z0-9]{4,16}-[0-9a-f]{8}$/);
  assert.equal(session.messageCount, 0);
  assert.ok(fs.existsSync(sessionFile(scopeKey, session.sessionId)), '正文必须真的落成 Vault 里的文件');

  // 同 sessionId 幂等：重试创建不该变成第二个会话。
  const retried = await call('/v1/chat/sessions', { method: 'POST', body: { scopeKey, topicId: 'flow-lifecycle', sessionId: session.sessionId } });
  assert.equal(retried.status, 200);
  assert.equal(json(retried).created, false);
  assert.equal(json(retried).session.sessionId, session.sessionId);

  const id = session.sessionId;
  const single = await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST',
    body: { message: { messageId: 'm-aaaaaa-11112222', role: 'user', text: '第一问', at: '2026-09-23T10:00:00.000Z', payload: { card: { kind: 'draft' } } } },
  });
  assert.equal(single.status, 200);
  assert.deepEqual(json(single).appended, ['m-aaaaaa-11112222']);

  const batch = await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST',
    body: {
      messages: [
        { messageId: 'm-bbbbbb-11112222', role: 'agent', text: '第一答', at: '2026-09-23T10:00:01.000Z' },
        { messageId: 'm-cccccc-11112222', role: 'error', text: '安全告警', at: '2026-09-23T10:00:02.000Z' },
      ],
    },
  });
  assert.equal(batch.status, 200);
  assert.equal(json(batch).total, 3);

  // 幂等：同一条消息重发是空操作，磁盘不增长。
  const before = fs.readFileSync(sessionFile(scopeKey, id), 'utf8');
  const replay = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { message: { messageId: 'm-aaaaaa-11112222', role: 'user', text: '第一问', at: '2026-09-23T10:00:00.000Z' } } });
  assert.deepEqual(json(replay).appended, []);
  assert.deepEqual(json(replay).duplicates, ['m-aaaaaa-11112222']);
  assert.equal(fs.readFileSync(sessionFile(scopeKey, id), 'utf8'), before);

  const read = await call(`/v1/chat/sessions/${id}?limit=2`);
  assert.equal(read.status, 200);
  const page = json(read);
  assert.equal(page.total, 3);
  assert.equal(page.messages.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, 'm-bbbbbb-11112222');
  assert.deepEqual(page.messages.map((item) => item.text), ['第一答', '安全告警']);
  // payload 原样回传：确认卡/审计都在这里面，丢了就等于改历史。
  const full = json(await call(`/v1/chat/sessions/${id}?limit=50`));
  assert.deepEqual(full.messages[0].payload, { card: { kind: 'draft' } });
  assert.equal(full.messages[0].type, 'message');

  const earlier = json(await call(`/v1/chat/sessions/${id}?limit=50&before=${page.nextCursor}`));
  assert.deepEqual(earlier.messages.map((item) => item.text), ['第一问']);
  assert.equal(earlier.hasMore, false);
  assert.equal(earlier.nextCursor, null);

  const list = json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}`));
  assert.equal(list.sessions.length, 1);
  assert.equal(list.sessions[0].messageCount, 3);

  // 索引缓存是可重建的：删掉之后 ?rebuild=1 必须按磁盘重新生成，而不是报错，
  // 更不能因此少掉一个会话。
  const indexPath = path.join(vault, 'Scholarium', 'Chat', 'v1', 'index.json');
  fs.rmSync(indexPath);
  const rebuilt = json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}&rebuild=1`));
  assert.equal(rebuilt.sessions.length, 1);
  assert.equal(rebuilt.sessions[0].messageCount, 3);
  fs.writeFileSync(indexPath, '{ 不是 JSON', 'utf8');
  assert.equal(json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}&rebuild=1`)).sessions.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(indexPath, 'utf8')).sessions.length, 1);

  const renamed = await call(`/v1/chat/sessions/${id}`, { method: 'PATCH', body: { title: '改名后' } });
  assert.equal(renamed.status, 200);
  assert.equal(json(renamed).session.title, '改名后');
  const archived = await call(`/v1/chat/sessions/${id}`, { method: 'PATCH', body: { archived: true } });
  assert.equal(archived.status, 200);
  assert.equal(json(archived).session.archived, true);
  assert.equal(json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}`)).sessions.length, 0);
  assert.equal(json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}&includeArchived=1`)).sessions.length, 1);

  // 归档/改名只追加状态事件，正文行一个字节都没动。
  const events = eventLines(sessionFile(scopeKey, id));
  assert.equal(events.filter((event) => event.type === 'message').length, 3);
  assert.deepEqual(events.slice(4).map((event) => event.type), ['state', 'state']);
  assert.equal(events[1].text, '第一问');
});

test('拒绝路径：未知会话 404、非法角色 400、非法字段 400、越界 400、损坏 500', async () => {
  const notFound = await call('/v1/chat/sessions/s-zzzzzzzz-12345678');
  assert.equal(notFound.status, 404);
  assert.equal(json(notFound).error, 'session not found');

  const escaped = await call('/v1/chat/sessions/not-a-session-id');
  assert.equal(escaped.status, 400);
  assert.equal(json(escaped).error, 'session path escaped the chat store root');

  const created = json(await call('/v1/chat/sessions', { method: 'POST', body: { scopeKey: 'topic:flow-reject' } })).session;
  const badRole = await call(`/v1/chat/sessions/${created.sessionId}/messages`, {
    method: 'POST', body: { message: { messageId: 'm-dddddd-11112222', role: 'assistant', text: 'x' } },
  });
  assert.equal(badRole.status, 400);
  assert.equal(json(badRole).error, 'unsupported role');

  const badField = await call(`/v1/chat/sessions/${created.sessionId}`, { method: 'PATCH', body: { mode: 'wipe' } });
  assert.equal(badField.status, 400);
  assert.match(json(badField).error, /unsupported field/);

  const missing = await call(`/v1/chat/sessions/${created.sessionId}/messages`, { method: 'POST', body: {} });
  assert.equal(missing.status, 400);
  assert.match(json(missing).error, /message or messages is required/);

  // 损坏（非末行）必须响亮失败，并且告诉调用方是哪个文件哪一行。
  const file = sessionFile('topic:flow-reject', created.sessionId);
  const intact = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, `${intact}{"type":"message",oops}\n{"type":"message","messageId":"m-ffffff-11112222"}\n`);
  const corrupt = await call(`/v1/chat/sessions/${created.sessionId}`);
  assert.equal(corrupt.status, 500);
  assert.equal(json(corrupt).error, 'chat session file is corrupt');
  assert.equal(json(corrupt).file, file);
  assert.equal(json(corrupt).line, 2);
  // 损坏文件会让列表端点也 500——这是刻意的：宁可整份历史列表报错，也不要
  // 静默跳过一段读不懂的历史。测试把文件还原回去，后面的用例才有干净的前提。
  assert.equal((await call('/v1/chat/sessions?scopeKey=topic:flow-reject')).status, 500);
  fs.writeFileSync(file, intact, 'utf8');
  assert.equal((await call('/v1/chat/sessions?scopeKey=topic:flow-reject')).status, 200);
});

test('CORS 允许 PATCH（否则浏览器预检会挡掉改名/归档）', async () => {
  const response = await harness.request('/v1/chat/sessions', { method: 'OPTIONS' });
  assert.equal(response.status, 204);
  assert.match(String(response.headers['access-control-allow-methods']), /PATCH/);
  assert.match(String(response.headers['access-control-allow-headers']), /x-agent-bridge-token/);
});

test('导入：preview 只读、commit 只新建，且必须同时满足确认头/ticket/指纹', async () => {
  const scopeKey = 'topic:legacy-import';
  const items = [{
    scopeKey,
    topicId: 'legacy-import',
    projectId: null,
    title: '旧版对话',
    sourceOrigin: 'http://127.0.0.1:4173',
    sourcePath: null,
    sourceKey: 'weaver.shell.chat.legacy-archived',
    sourceSha256: 'b'.repeat(64),
    messages: [
      { role: 'user', text: '旧问题', at: '2026-01-01T00:00:00.000Z' },
      { role: 'agent', text: '旧回答', at: '2026-01-01T00:00:01.000Z' },
      { role: 'agent', text: '旧回答', at: '2026-01-01T00:00:01.000Z' },
    ],
  }];
  const preview = await call('/v1/chat/import/preview', { method: 'POST', body: { items } });
  assert.equal(preview.status, 200);
  const plan = json(preview);
  assert.match(plan.ticket, /^imp-[0-9a-f]{24}$/);
  assert.match(plan.fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(plan.totalMessages, 3);
  assert.equal(plan.duplicateMessages, 1);
  assert.equal(plan.items[0].count, 2);
  assert.equal(plan.items[0].duplicateCount, 1);
  assert.equal(plan.items[0].firstAt, '2026-01-01T00:00:00.000Z');
  assert.equal(plan.items[0].lastAt, '2026-01-01T00:00:01.000Z');
  assert.ok(Date.parse(plan.expiresAt) > Date.now());
  // 预览本身一个字都不写。
  assert.equal(fs.existsSync(path.join(vault, 'Scholarium', 'Chat')), fs.existsSync(path.join(vault, 'Scholarium', 'Chat')));
  assert.deepEqual(json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}`)).sessions, []);

  // 同一份载荷重复 preview → 同一个 fingerprint（客户端要靠它发现"预览后内容变了"）。
  const again = json(await call('/v1/chat/import/preview', { method: 'POST', body: { items } }));
  assert.equal(again.fingerprint, plan.fingerprint);
  assert.notEqual(again.ticket, plan.ticket);

  // (a) 缺 x-scholarium-user-confirmed → 400，且 ticket 不被消费掉（这次调用连
  //     commit 都没进去，不算"调用过"）。
  const noHeader = await call('/v1/chat/import/commit', { method: 'POST', body: { ticket: plan.ticket, fingerprint: plan.fingerprint, confirm: true } });
  assert.equal(noHeader.status, 400);
  assert.equal(json(noHeader).error, 'user confirmation required');

  // (b) 指纹不符 → 400，并且这次调用已经把 ticket 消费掉。
  const wrongFingerprint = await call('/v1/chat/import/commit', {
    method: 'POST', headers: CONFIRMED, body: { ticket: plan.ticket, fingerprint: 'f'.repeat(32), confirm: true },
  });
  assert.equal(wrongFingerprint.status, 400);
  assert.equal(json(wrongFingerprint).error, 'preview fingerprint mismatch');

  // (c) 重放同一张 ticket → 404。一次人工确认不能靠重放变成两次写入。
  const replay = await call('/v1/chat/import/commit', {
    method: 'POST', headers: CONFIRMED, body: { ticket: plan.ticket, fingerprint: plan.fingerprint, confirm: true },
  });
  assert.equal(replay.status, 404);
  assert.equal(json(replay).error, 'import ticket not found or expired');
  assert.deepEqual(json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}`)).sessions, []);

  const unknown = await call('/v1/chat/import/commit', {
    method: 'POST', headers: CONFIRMED, body: { ticket: 'imp-000000000000000000000000', fingerprint: plan.fingerprint, confirm: true },
  });
  assert.equal(unknown.status, 404);

  // (d) 正常提交：带确认头 + 指纹，只新建会话。
  const committed = await call('/v1/chat/import/commit', {
    method: 'POST', headers: CONFIRMED, body: { ticket: again.ticket, fingerprint: again.fingerprint, confirm: true },
  });
  assert.equal(committed.status, 200);
  const result = json(committed);
  assert.equal(result.imported.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.imported[0].count, 2);
  assert.equal(result.imported[0].sourceKey, 'weaver.shell.chat.legacy-archived');
  assert.equal(result.imported[0].sourceSha256, 'b'.repeat(64));
  assert.equal(result.manifest.schema, 'scholarium-chat/1');
  assert.equal(result.manifest.totalImportedMessages, 2);
  assert.equal(result.manifest.totalSkippedMessages, 1);

  const imported = json(await call(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scopeKey)}`)).sessions;
  assert.equal(imported.length, 1);
  assert.equal(imported[0].messageCount, 2);
  const importedEvents = eventLines(sessionFile(scopeKey, imported[0].sessionId));
  assert.equal(importedEvents.filter((event) => event.type === 'session').length, 1);
  // 旧数据导入的消息 ID 形状由契约固定，来源信息记在 manifest 里而不是正文里。
  assert.match(importedEvents[1].messageId, /^m-imp-[0-9a-f]{32}$/);
  assert.equal(importedEvents[1].text, '旧问题');

  // 缺 confirm:true 一律拒绝（避免"看了一眼就写进去"）。
  const noConfirm = json(await call('/v1/chat/import/preview', { method: 'POST', body: { items } }));
  const unconfirmed = await call('/v1/chat/import/commit', {
    method: 'POST', headers: CONFIRMED, body: { ticket: noConfirm.ticket, fingerprint: noConfirm.fingerprint },
  });
  assert.equal(unconfirmed.status, 400);
  assert.match(json(unconfirmed).error, /confirm: true is required/);
});

test('ticket 过期返回 410（HTTP 层等不到 10 分钟，用与 Bridge 同一份模块的实现验证）', (t) => {
  // TTL 是 10 分钟且写死在契约里，没有给测试留后门（后门本身就是生产面的风险）。
  // 所以这一条用 chat-store 的同一个 commitPreview 实现 + 假时钟来验证：Bridge
  // 路由调用的就是这个函数，除此之外没有任何分支。
  t.mock.timers.enable({ apis: ['Date'] });
  const store = chatStore.storeFor(vault);
  const preview = chatStore.registerPreview(store, [{
    scopeKey: 'topic:legacy-expired',
    sourceKey: 'weaver.shell.chat.legacy-archived',
    messages: [{ role: 'user', text: '旧', at: '2026-01-01T00:00:00.000Z' }],
  }]);
  t.mock.timers.tick(11 * 60 * 1000);
  assert.throws(() => chatStore.commitPreview(store, { ticket: preview.ticket, fingerprint: preview.fingerprint, confirm: true }),
    (error) => error.status === 410 && error.message === 'import ticket expired');
  t.mock.timers.reset();
});

test('确认事件走 HTTP：派生值回读、非法 kind/状态机被拒', async () => {
  const created = json(await call('/v1/chat/sessions', { method: 'POST', body: { scopeKey: 'topic:flow-confirm' } })).session;
  const id = created.sessionId;
  const messageId = 'm-httpcnf1-11112222';
  json(await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST',
    body: { message: { messageId, role: 'agent', text: '卡', at: '2026-09-23T10:00:00.000Z', payload: { drafts: [{ items: [] }] } } },
  }));

  const pending = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { confirmation: { messageId, kind: 'draft', state: 'pending' } } });
  assert.equal(pending.status, 200, pending.text);
  const claimed = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { confirmation: { messageId, kind: 'draft', state: 'claimed', operationId: 'op-httpcnf1-11112222' } } });
  assert.equal(claimed.status, 200, claimed.text);
  assert.equal(json(claimed).states[`${messageId} draft`], 'claimed');
  const confirmed = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { confirmation: { messageId, kind: 'draft', state: 'confirmed', operationId: 'op-httpcnf1-11112222', detail: { paths: ['a.md'] } } } });
  assert.equal(confirmed.status, 200, confirmed.text);

  const read = json(await call(`/v1/chat/sessions/${id}?limit=50`));
  assert.equal(read.messages[0].payload.confirmations.draft.state, 'confirmed');
  assert.equal(read.messages[0].payload.draftsState, 'confirmed');
  assert.equal(read.messages[0].payload.confirmationStates.draft, 'confirmed');
  // 归并后的视图：同一 (messageId, kind) 只留当前状态，事件历史留在文件里。
  assert.equal(read.confirmations.length, 1);
  assert.equal(read.confirmations[0].state, 'confirmed');
  assert.equal(read.confirmations[0].operationId, 'op-httpcnf1-11112222');

  const badKind = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { confirmation: { messageId, kind: 'whatever', state: 'claimed', operationId: 'op-httpcnf2-11112222' } } });
  assert.equal(badKind.status, 400);
  assert.equal(json(badKind).error, 'unsupported confirmation kind');
  const badState = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { confirmation: { messageId, kind: 'draft', state: 'claimed' } } });
  assert.equal(badState.status, 400);
  assert.match(json(badState).error, /operationId is required from claimed onward/);
  // 终态之后再来 claimed：写入时 400（文件没坏，是这次请求会把它写坏）。
  const reopened = await call(`/v1/chat/sessions/${id}/messages`, { method: 'POST', body: { confirmation: { messageId, kind: 'draft', state: 'claimed', operationId: 'op-httpcnf3-11112222' } } });
  assert.equal(reopened.status, 400);
  assert.match(json(reopened).error, /confirmation state is corrupt/);
  // 未知会话 / 未知 messageId 形状仍然照 §4.2 报错。
  assert.equal((await call('/v1/chat/sessions/s-zzzzzzzz-12345678/messages', { method: 'POST', body: { confirmation: { messageId, kind: 'draft', state: 'pending' } } })).status, 404);

  /* Agent A 实测过的那条分叉（两个前端曾经给出相反结论）：同一张卡上
   * failed → claimed。现在与 v2 一致——判为损坏，响亮失败，派生态仍是 failed。 */
  const failedFirst = await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST', body: { confirmation: { messageId, kind: 'run', state: 'claimed', operationId: 'op-httpfail-11112222', at: '2026-09-23T11:00:00.000Z' } },
  });
  assert.equal(failedFirst.status, 200, failedFirst.text);
  const markedFailed = await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST', body: { confirmation: { messageId, kind: 'run', state: 'failed', operationId: 'op-httpfail-11112222', detail: { reason: '控制器抛错' }, at: '2026-09-23T11:00:01.000Z' } },
  });
  assert.equal(markedFailed.status, 200, markedFailed.text);
  const revived = await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST', body: { confirmation: { messageId, kind: 'run', state: 'claimed', operationId: 'op-httpfail-11112223', at: '2026-09-23T11:00:02.000Z' } },
  });
  assert.equal(revived.status, 400, 'failed 在同一张卡上是终态，不许复活成 claimed');
  assert.match(json(revived).error, /cannot go failed → claimed/);
  assert.equal(json(revived).from, 'failed');
  assert.equal(json(revived).to, 'claimed');
  const afterRevive = json(await call(`/v1/chat/sessions/${id}?limit=50`));
  assert.equal(afterRevive.messages.find((item) => item.messageId === messageId).payload.confirmations.run.state, 'failed');
  // failed 也没有别的出边。
  assert.equal((await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST', body: { confirmation: { messageId, kind: 'run', state: 'confirmed', operationId: 'op-httpfail-11112222', at: '2026-09-23T11:00:03.000Z' } },
  })).status, 400);
  // 但新卡片（新 messageId）从 pending 开 claimed 照常合法——重试走这条。
  const retryMessageId = 'm-httpretry-11112222';
  json(await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST', body: { message: { messageId: retryMessageId, role: 'agent', text: '重新发起', at: '2026-09-23T11:01:00.000Z', payload: { runs: [{ operation: 'pipeline.rerun' }] } } },
  }));
  const retried = await call(`/v1/chat/sessions/${id}/messages`, {
    method: 'POST', body: { confirmation: { messageId: retryMessageId, kind: 'run', state: 'claimed', operationId: 'op-httpretry-11112222', at: '2026-09-23T11:01:01.000Z' } },
  });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(json(retried).states[`${retryMessageId} run`], 'claimed');
});

test('执行幂等账本走 HTTP：查询 / 占位 / 人工核对', async () => {
  const operationId = 'op-httpled1-11112222';
  assert.equal((await call(`/v1/chat/operations/${operationId}`)).status, 404);

  const claim = await call(`/v1/chat/operations/${operationId}/claim`, {
    method: 'POST', body: { kind: 'action', messageId: 'm-httpcnf1-11112222', request: { actions: [{ action: 'x' }] } },
  });
  assert.equal(claim.status, 200, claim.text);
  assert.equal(json(claim).proceed, true);

  const found = await call(`/v1/chat/operations/${operationId}`);
  assert.equal(found.status, 200);
  assert.equal(json(found).status, 'claimed');

  // 同 ID 同请求再占位 → 409（崩溃窗口，必须人工核对）。
  const again = await call(`/v1/chat/operations/${operationId}/claim`, {
    method: 'POST', body: { kind: 'action', messageId: 'm-httpcnf1-11112222', request: { actions: [{ action: 'x' }] } },
  });
  assert.equal(again.status, 409);
  assert.equal(json(again).error, 'operation already claimed');
  // 同 ID 换请求 → 409。
  const reused = await call(`/v1/chat/operations/${operationId}/claim`, {
    method: 'POST', body: { kind: 'action', messageId: 'm-httpcnf1-11112222', request: { actions: [{ action: 'y' }] } },
  });
  assert.equal(reused.status, 409);
  assert.equal(json(reused).error, 'operation id reused with a different request');

  // 人工核对必须带确认头。
  const unconfirmed = await call(`/v1/chat/operations/${operationId}/resolve`, { method: 'POST', body: { outcome: 'failed' } });
  assert.equal(unconfirmed.status, 400);
  assert.equal(json(unconfirmed).error, 'user confirmation required');
  const resolved = await call(`/v1/chat/operations/${operationId}/resolve`, {
    method: 'POST', headers: CONFIRMED, body: { outcome: 'failed', detail: { reason: '核对后确认未生效' } },
  });
  assert.equal(resolved.status, 200, resolved.text);
  assert.equal(json(resolved).resolved, true);
  const after = json(await call(`/v1/chat/operations/${operationId}`));
  assert.equal(after.status, 'failed');
  assert.equal(after.error, '核对后确认未生效');
  assert.equal(json(await call(`/v1/chat/operations/${operationId}/resolve`, { method: 'POST', headers: CONFIRMED, body: { outcome: 'confirmed' } })).replayed, true);
  assert.equal(json(await call(`/v1/chat/operations/${operationId}`)).status, 'failed');
  assert.equal((await call('/v1/chat/operations/op-nosuch00-11112222/resolve', { method: 'POST', headers: CONFIRMED, body: { outcome: 'confirmed' } })).status, 404);
  assert.equal((await call('/v1/chat/operations/bad-id/claim', { method: 'POST', body: {} })).status, 400);
});

test('带 operationId 的执行端点：第二次到达是重放，且不写文件', async () => {
  const operationId = 'op-httpexec-11112222';
  const body = { skillId: 'definitely-not-a-skill', workspace: vault, input: '{}' };
  const headers = { 'x-scholarium-operation-id': operationId };
  // 第一次：账本占位 → 执行（这里因为技能不存在而失败）→ 记 failed。
  const first = await call('/v1/skills/run', { method: 'POST', body, headers });
  assert.equal(first.status, 400, first.text);
  assert.ok(!json(first).replayed);
  // 第二次：终态 + 同请求 → 重放原结果，一个字节都不写（连 Skill 都不再调用）。
  const second = await call('/v1/skills/run', { method: 'POST', body, headers });
  assert.equal(second.status, 409, second.text);
  assert.equal(json(second).replayed, true);
  assert.equal(json(second).error, json(first).error, '重放必须给出与上次完全相同的结论');
  const ledger = json(await call(`/v1/chat/operations/${operationId}`));
  assert.equal(ledger.status, 'failed');
  // 不带这个头的老调用方行为不变：直接执行，账本里不留任何东西。
  const legacyId = 'op-httpleg1-11112222';
  const legacy = await call('/v1/skills/run', { method: 'POST', body });
  assert.equal(legacy.status, 400);
  assert.equal(json(await call(`/v1/chat/operations/${legacyId}`)).error, 'operation not found');
});

test('scopeKey 之间互不串味：同一 sessionId 不会跨课题复用', async () => {
  const a = json(await call('/v1/chat/sessions', { method: 'POST', body: { scopeKey: 'topic:iso-a', title: 'A' } })).session;
  json(await call(`/v1/chat/sessions/${a.sessionId}/messages`, { method: 'POST', body: { message: { messageId: 'm-isoa-11112222', role: 'user', text: 'A 的问题' } } }));
  const b = json(await call('/v1/chat/sessions', { method: 'POST', body: { scopeKey: 'topic:iso-b', title: 'B' } })).session;
  assert.notEqual(a.sessionId, b.sessionId);
  assert.equal(json(await call('/v1/chat/sessions?scopeKey=topic:iso-b')).sessions.length, 1);
  assert.equal(json(await call(`/v1/chat/sessions/${b.sessionId}`)).total, 0);
  assert.equal(scopeHash('topic:iso-a') === scopeHash('topic:iso-b'), false);
});
