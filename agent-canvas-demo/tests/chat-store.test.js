"use strict";
// 对话正文存储层的契约测试（docs/plans/chat-persistence-contract.md §1–§3）。
//
// 这一层必须自己站得住：Bridge 路由、shell、v2 原生实现都会经过它，而它保护的
// 是研究员几个月后还要读的历史。所以这里测的不是"函数返回了什么"，而是四条
// 不可让步的性质：越界即失败、追加不改写、幂等、最后一行容错且不吞其它损坏。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const chatStore = require('../bridge/chat-store.js');
const { ChatStore, ChatStoreError, scopeHash } = chatStore;

const SESSION_ID_RE = /^s-[a-z0-9]{4,16}-[0-9a-f]{8}$/;

function tempVault(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function storeFor(vault) {
  return new ChatStore(vault);
}

function sessionFile(vault, scopeKey, sessionId) {
  return path.join(vault, 'Scholarium', 'Chat', 'v1', scopeHash(scopeKey), `${sessionId}.jsonl`);
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// 每条消息都带显式 messageId：幂等语义只有在调用方给出稳定 id 时才成立，
// 测试必须使用和 shell 一样的形状（否则测的是一个生产代码不会走的分支）。
function message(index, overrides = {}) {
  return {
    messageId: overrides.messageId || `m-test${String(index).padStart(4, '0')}-aabbccdd`,
    role: overrides.role || 'agent',
    text: overrides.text || `第 ${index} 轮回复`,
    at: overrides.at || new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    payload: overrides.payload === undefined ? { index } : overrides.payload,
  };
}

test('scopeHash 是 24 位小写十六进制，会话文件只落在 Chat/v1 之内', () => {
  const vault = tempVault('chat-store-layout-');
  const store = storeFor(vault);
  const created = store.createSession({ scopeKey: 'topic:flow-analyse-1', topicId: 'flow-analyse-1', title: '课题' });
  assert.match(created.session.sessionId, SESSION_ID_RE);
  assert.equal(created.created, true);
  const hash = scopeHash('topic:flow-analyse-1');
  assert.match(hash, /^[0-9a-f]{24}$/);
  const file = sessionFile(vault, 'topic:flow-analyse-1', created.session.sessionId);
  assert.ok(fs.existsSync(file), '会话文件必须落在 <vaultRoot>/Scholarium/Chat/v1/<24hex>/ 下');
  assert.equal(path.relative(path.join(vault, 'Scholarium', 'Chat', 'v1'), file).split(path.sep)[0], hash);
  // 用户给的课题名不能出现在文件名里：目录名只能是哈希。
  const scoped = store.createSession({ scopeKey: 'topic:../../etc/passwd', topicId: 'x' });
  assert.match(scoped.session.sessionId, SESSION_ID_RE);
  assert.ok(fs.existsSync(sessionFile(vault, 'topic:../../etc/passwd', scoped.session.sessionId)));
});

test('路径越界响亮失败，不做就近修正', () => {
  const vault = tempVault('chat-store-escape-');
  const store = storeFor(vault);
  const root = path.join(vault, 'Scholarium', 'Chat', 'v1');
  assert.throws(() => chatStore.assertInsideRoot(root, path.join(root, '..', '..', 'evil.jsonl')),
    (error) => error instanceof ChatStoreError && error.status === 400
      && error.message === 'session path escaped the chat store root');
  assert.throws(() => chatStore.assertInsideRoot(root, vault), /escaped the chat store root/);
  assert.throws(() => store.readSession('../../evil.jsonl'), /escaped the chat store root/);
  assert.throws(() => store.appendMessages('s-../../x-12345678', [message(1)]), /escaped the chat store root/);
  // 形状合法但不存在 → 404，与越界区分开：前者是"没有这段历史"，后者是"调用方搞错了"。
  assert.throws(() => store.readSession('s-zzzzzzzz-12345678'),
    (error) => error.status === 404 && error.message === 'session not found');
});

test('追加是 append-only，重复 messageId 是空操作', () => {
  const vault = tempVault('chat-store-append-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1' }).session.sessionId;
  const first = store.appendMessages(sessionId, [message(1), message(2)]);
  assert.deepEqual(first.appended, ['m-test0001-aabbccdd', 'm-test0002-aabbccdd']);
  assert.deepEqual(first.duplicates, []);
  assert.equal(first.total, 2);

  const file = sessionFile(vault, 'topic:f1', sessionId);
  const before = fs.readFileSync(file, 'utf8');
  const replay = store.appendMessages(sessionId, [message(1), message(2)]);
  assert.deepEqual(replay.appended, []);
  assert.deepEqual(replay.duplicates, ['m-test0001-aabbccdd', 'm-test0002-aabbccdd']);
  assert.equal(fs.readFileSync(file, 'utf8'), before, '重复追加一个字节都不该动');

  // 同一批里自己重复的，只留第一条。
  const mixed = store.appendMessages(sessionId, [message(3), message(3), message(4)]);
  assert.deepEqual(mixed.appended, ['m-test0003-aabbccdd', 'm-test0004-aabbccdd']);
  assert.deepEqual(mixed.duplicates, ['m-test0003-aabbccdd']);
  assert.equal(readLines(file).length, 1 + 4);
  // payload 原样保存：确认卡、协议审计都在里面，存储层不得裁剪。
  assert.deepEqual(readLines(file)[1].payload, { index: 1 });
});

test('角色与消息形状非法一律 400', () => {
  const vault = tempVault('chat-store-roles-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1' }).session.sessionId;
  assert.throws(() => store.appendMessages(sessionId, [{ messageId: 'm-aaaaaa-11112222', role: 'assistant', text: 'x' }]),
    (error) => error.status === 400 && error.message === 'unsupported role');
  assert.throws(() => store.appendMessages(sessionId, [{ messageId: 'm-aaaaaa-11112222', role: 'error', text: 'x', payload: 'no' }]),
    /payload must be a JSON object/);
  assert.throws(() => store.appendMessages(sessionId, [{ messageId: 'x', role: 'user', text: 'x' }]), /messageId must match/);
  // error 是 shell 已经在用的展示角色，丢不掉。
  assert.deepEqual(store.appendMessages(sessionId, [{ messageId: 'm-aaaaaa-11112222', role: 'error', text: '安全告警' }]).appended,
    ['m-aaaaaa-11112222']);
});

test('末行残缺可容忍，其它任何一行损坏都响亮失败', () => {
  const vault = tempVault('chat-store-corrupt-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1' }).session.sessionId;
  store.appendMessages(sessionId, [message(1), message(2)]);
  const file = sessionFile(vault, 'topic:f1', sessionId);

  // 断电正在写：没有换行的半行。
  fs.appendFileSync(file, '{"type":"message","messageId":"m-half');
  const survived = store.readSession(sessionId, {});
  assert.equal(survived.total, 2, '残缺末行必须被忽略，既有行照常可读');

  // 中间行损坏：不是"跳过"，是响亮失败，并且要指出文件与行号。先把残缺的半行
  // 截掉回到干净文件，否则半行会和下一次追加粘成一行，测的就不是"中间行"了。
  const raw = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, raw.slice(0, raw.lastIndexOf('\n') + 1), 'utf8');
  fs.appendFileSync(file, '{"type":"message",oops}\n{"type":"message","messageId":"m-abcdef-11112222"}\n');
  assert.throws(() => store.readSession(sessionId, {}), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, 'chat session file is corrupt');
    assert.equal(error.details.file, file);
    assert.equal(error.details.line, 4);
    return true;
  });
});

test('读路径 fail-closed：白名单外的 confirmation kind / state 是响亮失败，不是静默容忍', () => {
  /* 为什么单独钉这一条：写路径早在 normalizeConfirmation 就以 400 拒收这些值，
   * 但"别人、旧版本或手工编辑已经写在磁盘上的那一份"只有读路径管得到。此前读路径
   * 是容忍的——v2 的 parseSessionFile 判同一份文件损坏，部署版却照常读出来，两个
   * 前端对同一份数据给出相反结论。下面三组断言把这条分叉封死。 */
  const vault = tempVault('chat-store-kindgate-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:kgate' }).session.sessionId;
  store.appendMessages(sessionId, [message(1)]);
  const file = sessionFile(vault, 'topic:kgate', sessionId);
  const clean = fs.readFileSync(file, 'utf8');
  const appendRaw = (event) => fs.appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  const rawConfirmation = (overrides = {}) => ({
    type: 'confirmation', eventId: 'evt-kgate01-00000001', messageId: 'm-test0001-aabbccdd',
    kind: 'action', state: 'claimed', operationId: 'op-kgate01-00000001',
    at: '2026-01-01T00:00:01.000Z', ...overrides,
  });

  // ① 未知 kind：读会话响亮失败，错误里必须同时有 file、line 和那个具体值，
  //    措辞与 v2 的 assertConfirmationKind 逐字对齐（两边互相认得）。
  const kindLine = readLines(file).length + 1;
  appendRaw(rawConfirmation({ kind: 'bogusKind' }));
  assert.throws(() => store.readSession(sessionId, {}), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, 'unsupported confirmation kind: "bogusKind"');
    assert.equal(error.details.file, file);
    assert.equal(error.details.line, kindLine);
    assert.equal(error.details.kind, 'bogusKind');
    return true;
  });
  // 会话列表也不许把它当成一份正常文件列出来——静默跳过文件同样是一种容忍。
  assert.throws(() => store.listSessions({}), (error) => {
    assert.equal(error.status, 500);
    assert.match(error.message, /unsupported confirmation kind: "bogusKind"/);
    assert.equal(error.details.line, kindLine);
    return true;
  });

  // ①' 未知 state：同一条规则，错误里带的是 state 的值。
  fs.writeFileSync(file, clean, 'utf8');
  appendRaw(rawConfirmation({ state: 'bogusState' }));
  assert.throws(() => store.readSession(sessionId, {}), (error) => {
    assert.equal(error.status, 500);
    assert.equal(error.message, 'unsupported confirmation state: "bogusState"');
    assert.equal(error.details.file, file);
    assert.equal(error.details.line, kindLine);
    assert.equal(error.details.state, 'bogusState');
    return true;
  });

  // ①'' 缺 kind / 缺 state 等同于白名单外（空串），不是"默认通过"。
  fs.writeFileSync(file, clean, 'utf8');
  appendRaw(rawConfirmation({ kind: undefined }));
  assert.throws(() => store.readSession(sessionId, {}), /unsupported confirmation kind: ""/);
  fs.writeFileSync(file, clean, 'utf8');
  appendRaw(rawConfirmation({ state: undefined }));
  assert.throws(() => store.readSession(sessionId, {}), /unsupported confirmation state: ""/);

  // ② 反面：八种 kind 的合法事件仍然读得出来——不许为了堵漏把正常路径一起堵死。
  fs.writeFileSync(file, clean, 'utf8');
  const KINDS = ['action', 'draft', 'legacyNoteEdit', 'run', 'normalize', 'plot', 'plotRevision', 'suggestReconstruction'];
  KINDS.forEach((kind, index) => {
    const suffix = String(index).padStart(8, '0');
    appendRaw(rawConfirmation({ eventId: `evt-kgate02-${suffix}`, kind, operationId: `op-kgate02-${suffix}` }));
  });
  const read = store.readSession(sessionId, {});
  assert.equal(read.confirmations.length, KINDS.length, '八种 kind 一条都不能被读路径挡掉');
  assert.deepEqual(read.confirmations.map((entry) => entry.kind).sort(), [...KINDS].sort());
  assert.equal(read.messages[0].payload.confirmations.action.state, 'claimed', '派生值必须照常产出');
  // 读取容错那条老规矩没有被这次收紧株连：末行残缺仍然可以忽略。
  fs.appendFileSync(file, '{"type":"confirmation","eventId":"evt-kgate03-0000', 'utf8');
  assert.equal(store.readSession(sessionId, {}).confirmations.length, KINDS.length);
});

test('归档只追加 state 事件，正文行一个字节不动', () => {
  const vault = tempVault('chat-store-archive-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1', title: '原标题' }).session.sessionId;
  store.appendMessages(sessionId, [message(1)]);
  const file = sessionFile(vault, 'topic:f1', sessionId);
  const bodyBefore = fs.readFileSync(file, 'utf8');

  const archived = store.patchSession(sessionId, { archived: true, title: '新标题' });
  assert.equal(archived.session.archived, true);
  assert.equal(archived.session.title, '新标题');
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(after.startsWith(bodyBefore), '归档/改名不得重写已有行，只能往后追加');
  const events = readLines(file);
  assert.equal(events[0].type, 'session');
  assert.equal(events.filter((event) => event.type === 'message').length, 1);
  assert.deepEqual(events.slice(2).map((event) => event.type), ['state', 'state']);

  // 列表默认隐藏已归档，显式要求时才出现；恢复同样只是追加状态。
  assert.equal(store.listSessions({ scopeKey: 'topic:f1' }).length, 0);
  assert.equal(store.listSessions({ scopeKey: 'topic:f1', includeArchived: true }).length, 1);
  assert.equal(store.patchSession(sessionId, { archived: false }).session.archived, false);
  assert.throws(() => store.patchSession(sessionId, { nope: 1 }), /unsupported field: nope/);
  assert.throws(() => store.patchSession(sessionId, { archived: 'yes' }), /archived must be a boolean/);
  assert.throws(() => store.patchSession(sessionId, {}), /title or archived is required/);
  assert.equal(store.loadSession(sessionId).events.filter((event) => event.type === 'message').length, 1);
});

test('index.json 缺失或损坏都只是重建，不是丢数据', () => {
  const vault = tempVault('chat-store-index-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1', title: 'T' }).session.sessionId;
  store.appendMessages(sessionId, [message(1), message(2)]);
  const indexFile = path.join(vault, 'Scholarium', 'Chat', 'v1', 'index.json');
  assert.ok(fs.existsSync(indexFile), '创建会话后就该有一份索引缓存');
  assert.equal(JSON.parse(fs.readFileSync(indexFile, 'utf8')).sessions[0].messageCount, 2);

  fs.rmSync(indexFile);
  store.indexCache = null;
  const rebuilt = store.listSessions({ scopeKey: 'topic:f1' });
  assert.equal(rebuilt.length, 1);
  assert.equal(rebuilt[0].messageCount, 2);
  assert.ok(fs.existsSync(indexFile), '缺失的索引必须被重建出来');

  fs.writeFileSync(indexFile, '{ 这不是 JSON', 'utf8');
  store.indexCache = null;
  assert.equal(store.listSessions({ scopeKey: 'topic:f1' })[0].sessionId, sessionId);
  assert.equal(JSON.parse(fs.readFileSync(indexFile, 'utf8')).sessions.length, 1);

  // 索引撒谎（手工删掉磁盘上的会话）时，磁盘才是权威。
  fs.rmSync(sessionFile(vault, 'topic:f1', sessionId));
  store.indexCache = null;
  assert.deepEqual(store.listSessions({ scopeKey: 'topic:f1' }), []);
});

test('分页返回最新 limit 条并给出升序窗口与游标，total 不受分页影响', () => {
  const vault = tempVault('chat-store-page-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1' }).session.sessionId;
  const all = [];
  for (let index = 0; index < 120; index += 1) all.push(message(index));
  store.appendMessages(sessionId, all);

  const page1 = store.readSession(sessionId, { limit: 50 });
  assert.equal(page1.messages.length, 50);
  assert.equal(page1.total, 120);
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextCursor, all[70].messageId);
  assert.deepEqual(page1.messages.map((item) => item.text), all.slice(70).map((item) => item.text));

  const page2 = store.readSession(sessionId, { limit: 50, before: page1.nextCursor });
  assert.equal(page2.messages.length, 50);
  assert.equal(page2.nextCursor, all[20].messageId);
  const page3 = store.readSession(sessionId, { limit: 50, before: page2.nextCursor });
  assert.equal(page3.messages.length, 20);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.nextCursor, null);
  // limit 被钳到 1..500：0 与 1000 都不是"随便取"的理由。
  assert.equal(store.readSession(sessionId, { limit: 0 }).messages.length, 1);
  assert.equal(store.readSession(sessionId, { limit: 1000 }).messages.length, 120);
  assert.throws(() => store.readSession(sessionId, { before: 'm-nosuch-11112222' }), /unknown cursor messageId/);
});

test('导入预览的 fingerprint 稳定，commit 是一次性 ticket', () => {
  const vault = tempVault('chat-store-import-');
  const store = storeFor(vault);
  const items = [{
    scopeKey: 'topic:legacy-1',
    topicId: 'legacy-1',
    title: '旧版对话',
    sourceOrigin: 'http://127.0.0.1:4173',
    sourcePath: null,
    sourceKey: 'weaver.shell.chat.legacy-archived',
    sourceSha256: 'a'.repeat(64),
    messages: [
      { role: 'user', text: '第一问', at: '2026-01-01T00:00:00.000Z' },
      { role: 'agent', text: '第一答', at: '2026-01-01T00:00:01.000Z' },
      { role: 'agent', text: '第一答', at: '2026-01-01T00:00:01.000Z' },
    ],
  }];
  const preview = chatStore.registerPreview(store, items);
  assert.match(preview.ticket, /^imp-[0-9a-f]{24}$/);
  assert.match(preview.fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(preview.totalMessages, 3);
  assert.equal(preview.duplicateMessages, 1);
  assert.equal(preview.items[0].count, 2, 'count 是真正会写入的条数');
  assert.equal(preview.items[0].duplicateCount, 1);
  assert.ok(Date.parse(preview.expiresAt) > Date.now());

  // 同一份内容重复预览 → 同一个 fingerprint（不含时间戳/随机量）。
  const again = chatStore.registerPreview(store, items);
  assert.equal(again.fingerprint, preview.fingerprint);
  assert.notEqual(again.ticket, preview.ticket);

  const committed = chatStore.commitPreview(store, {
    ticket: preview.ticket, fingerprint: preview.fingerprint, confirm: true,
  });
  assert.equal(committed.imported.length, 1);
  assert.equal(committed.imported[0].count, 2);
  assert.equal(committed.manifest.items[0].sourceSha256, 'a'.repeat(64));
  assert.equal(committed.manifest.items[0].sourceOrigin, 'http://127.0.0.1:4173');
  assert.ok(committed.imported[0].file.startsWith(scopeHash('topic:legacy-1')));

  // 来源只读：导入后来源载荷里的内容不会被改动，而且只新建会话。
  assert.equal(store.listSessions({ scopeKey: 'topic:legacy-1' }).length, 1);
  assert.throws(() => chatStore.commitPreview(store, {
    ticket: preview.ticket, fingerprint: preview.fingerprint, confirm: true,
  }), (error) => error.status === 404 && error.message === 'import ticket not found or expired');
  assert.throws(() => chatStore.commitPreview(store, { ticket: 'imp-nope', fingerprint: again.fingerprint, confirm: true }),
    (error) => error.status === 404);
  assert.throws(() => chatStore.commitPreview(store, { ticket: again.ticket, fingerprint: 'f'.repeat(32), confirm: true }),
    /preview fingerprint mismatch/);
  // 指纹不符的那一次同样把 ticket 消费掉了：一次人工确认对应一次写入机会。
  assert.throws(() => chatStore.commitPreview(store, { ticket: again.ticket, fingerprint: again.fingerprint, confirm: true }),
    (error) => error.status === 404);
  assert.throws(() => chatStore.commitPreview(store, { ticket: 'imp-x', confirm: true }), /not found or expired/);
});

test('过期的 ticket 返回 410，并且不会被复用', (t) => {
  t.mock.timers.enable({ apis: ['Date'] });
  const vault = tempVault('chat-store-expiry-');
  const store = storeFor(vault);
  const preview = chatStore.registerPreview(store, [{
    scopeKey: 'topic:legacy-2',
    title: '旧版对话',
    sourceKey: 'weaver.shell.chat.legacy-archived',
    messages: [{ role: 'user', text: '旧', at: '2026-01-01T00:00:00.000Z' }],
  }]);
  t.mock.timers.tick(11 * 60 * 1000);
  assert.throws(() => chatStore.commitPreview(store, {
    ticket: preview.ticket, fingerprint: preview.fingerprint, confirm: true,
  }), (error) => error.status === 410 && error.message === 'import ticket expired');
  assert.deepEqual(store.listSessions({ scopeKey: 'topic:legacy-2' }), [], '过期 ticket 绝不能写进去任何东西');
  t.mock.timers.reset();
});

test('不存在的 scopeKey 或空 items 直接拒绝', () => {
  const vault = tempVault('chat-store-validation-');
  const store = storeFor(vault);
  assert.throws(() => store.createSession({}), /scopeKey is required/);
  assert.throws(() => store.createSession({ scopeKey: 'topic:f', sessionId: 'not-a-session' }), /sessionId must match/);
  assert.throws(() => store.createSession({ scopeKey: 'topic:f', title: 'x'.repeat(300) }), /title is too long/);
  assert.throws(() => chatStore.registerPreview(store, []), /items must be a non-empty array/);
  assert.throws(() => chatStore.registerPreview(store, [{ scopeKey: 'topic:f', sourceSha256: 'zz' }]), /sourceSha256/);
  assert.throws(() => chatStore.registerPreview(store, [{ scopeKey: 'topic:f', messages: [{ role: 'nope', text: 'x' }] }]),
    /unsupported role/);
  // 同 sessionId 幂等：调用方重试创建不该得到第二个会话。
  const created = store.createSession({ scopeKey: 'topic:f', sessionId: 's-abcdefgh-deadbeef' });
  assert.equal(created.created, true);
  const retried = store.createSession({ scopeKey: 'topic:f', sessionId: 's-abcdefgh-deadbeef' });
  assert.equal(retried.created, false);
  assert.equal(retried.session.sessionId, 's-abcdefgh-deadbeef');
  assert.equal(store.listSessions({ scopeKey: 'topic:f' }).length, 1);
});

test('确认事件：八种 kind，claimed 起必须有 operationId，终态不可回退', () => {
  const vault = tempVault('chat-store-confirm-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f1' }).session.sessionId;
  const messageId = 'm-confirm0-11112222';
  store.appendMessages(sessionId, [{ messageId, role: 'agent', text: '确认卡', payload: { actions: [{ action: 'experiment.transition' }] } }]);

  // 八种 kind 全部接受（少一种就是那条路径没有锁定态）。pending 是最初态，
  // 所以给一个比后面所有事件都早的 at——状态机是按 at 升序重放的。
  for (const kind of ['action', 'draft', 'legacyNoteEdit', 'run', 'normalize', 'plot', 'plotRevision', 'suggestReconstruction']) {
    const appended = store.appendConfirmations(sessionId, { messageId, kind, state: 'pending', at: '2026-09-23T09:00:00.000Z' });
    assert.equal(appended.appended.length, 1, `${kind} 必须被接受`);
  }
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'notAKind', state: 'pending' }), /unsupported confirmation kind/);
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'weird' }), /unsupported confirmation state/);
  // claimed 起没有 operationId 就不许写：否则崩溃窗口无从对应。
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'claimed' }), /operationId is required from claimed onward/);
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'claimed', operationId: 'nope' }), /operationId must match/);

  const op = 'op-confirm1-11112222';
  store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'claimed', operationId: op, at: '2026-09-23T10:00:01.000Z' });
  store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'confirmed', operationId: op, detail: { paths: ['a.md'] }, at: '2026-09-23T10:00:02.000Z' });
  // eventId 幂等：同一条事件重复追加是空操作。
  const drained = store.loadSession(sessionId).events.filter((event) => event.type === 'confirmation').length;
  const replay = store.appendConfirmations(sessionId, store.loadSession(sessionId).events.find((event) => event.type === 'confirmation' && event.state === 'confirmed'));
  assert.deepEqual(replay.appended, []);
  assert.equal(replay.duplicates.length, 1);
  assert.equal(store.loadSession(sessionId).events.filter((event) => event.type === 'confirmation').length, drained);

  // 派生值：读回来的是归并后的状态，不是文件里最后一行。
  const read = store.readSession(sessionId, {});
  assert.equal(read.messages[0].payload.confirmationStates.action, 'confirmed');
  assert.equal(read.messages[0].payload.actionsState, 'confirmed');
  assert.equal(read.messages[0].payload.confirmations.action.operationId, op);
  assert.deepEqual(read.messages[0].payload.confirmations.action.detail, { paths: ['a.md'] });
  assert.deepEqual(read.confirmations.find((entry) => entry.kind === 'action'), {
    messageId, kind: 'action', state: 'confirmed', operationId: op, detail: { paths: ['a.md'] }, at: '2026-09-23T10:00:02.000Z',
  });

  // 结算必须复用 claimed 的那一个 operationId；另铸一个 = 损坏（v2 会把这种文件
  // 判成读不了，两边对同一份数据给出不同结论是最糟的失败模式）。
  store.appendConfirmations(sessionId, { messageId, kind: 'run', state: 'claimed', operationId: 'op-settle1-11112222' });
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'run', state: 'confirmed', operationId: 'op-settle2-11112222' }),
    (error) => error.status === 400 && /must carry the claimed operationId/.test(error.message));
  assert.equal(store.readSession(sessionId, {}).messages[0].payload.confirmations.run.state, 'claimed', '被拒的那次结算不许改动状态');
  // 用同一个 id 结算当然可以。
  store.appendConfirmations(sessionId, { messageId, kind: 'run', state: 'confirmed', operationId: 'op-settle1-11112222' });
  assert.equal(store.readSession(sessionId, {}).messages[0].payload.confirmations.run.state, 'confirmed');

  // claimed → abandoned 也是损坏：claimed 之后紧接着就是投递，这一刻没人知道写入
  // 到底有没有发出去，标 abandoned 等于替研究员断言"什么都没发生"。
  store.appendConfirmations(sessionId, { messageId, kind: 'normalize', state: 'claimed', operationId: 'op-abandon-11112222' });
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'normalize', state: 'abandoned', operationId: 'op-abandon-11112222' }),
    (error) => error.status === 400 && /cannot go claimed → abandoned/.test(error.message));
  // pending → abandoned 仍然是合法的（用户改主意，但还没投递）。
  store.appendConfirmations(sessionId, { messageId, kind: 'plot', state: 'abandoned' });
  assert.equal(store.readSession(sessionId, {}).messages[0].payload.confirmations.plot.state, 'abandoned');

  // pending 事件也不许把已锁定的状态推回去：v2 的转移表里 pending 没有从终态回来
  // 的边（pending: [pending, claimed, abandoned]），所以这是一次非法迁移，响亮失败。
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'pending', at: '2099-01-01T00:00:00.000Z' }),
    (error) => error.status === 400 && /cannot go confirmed → pending/.test(error.message));
  assert.equal(store.readSession(sessionId, {}).messages[0].payload.confirmations.action.state, 'confirmed');
  assert.equal(store.readSession(sessionId, {}).messages[0].payload.actionsState, 'confirmed');

  // confirmed 之后又 claimed = 损坏：写入时 400，读文件时 500。
  assert.throws(() => store.appendConfirmations(sessionId, { messageId, kind: 'action', state: 'claimed', operationId: 'op-confirm2-11112222' }),
    (error) => error.status === 400 && /cannot go confirmed → claimed/.test(error.message));
  const file = sessionFile(vault, 'topic:f1', sessionId);
  fs.appendFileSync(file, `${JSON.stringify({ type: 'confirmation', eventId: 'evt-manual-11112222', messageId, kind: 'action', state: 'claimed', operationId: 'op-confirm3-11112222', at: '2026-09-23T11:00:00.000Z' })}\n`);
  assert.throws(() => store.readSession(sessionId, {}), (error) => error.status === 500 && /corrupt/.test(error.message));

  /* failed 在**同一张卡**上是终态（§2.1 规则 3 改定后：重试是新的 messageId、
   * 新的 claimed、新的 operationId，从 pending 重新开始）。所以同一张卡上
   * failed → claimed 必须被拒——否则 UI 出任何 bug 都能把一张"结果未知"的卡复活
   * 成可派发状态。 */
  const store2 = storeFor(tempVault('chat-store-confirm2-'));
  const session2 = store2.createSession({ scopeKey: 'topic:f2' }).session.sessionId;
  const message2 = 'm-confirm1-11112222';
  store2.appendMessages(session2, [{ messageId: message2, role: 'agent', text: 'x', payload: { plots: [{}] } }]);
  store2.appendConfirmations(session2, { messageId: message2, kind: 'plot', state: 'claimed', operationId: 'op-retry01-11112222' });
  store2.appendConfirmations(session2, { messageId: message2, kind: 'plot', state: 'failed', operationId: 'op-retry01-11112222', detail: { reason: 'boom' } });
  assert.equal(store2.readSession(session2, {}).messages[0].payload.confirmations.plot.state, 'failed');
  assert.throws(() => store2.appendConfirmations(session2, { messageId: message2, kind: 'plot', state: 'claimed', operationId: 'op-retry02-11112222' }),
    (error) => error.status === 400 && /cannot go failed → claimed/.test(error.message), '同一张卡 failed 是终态，不许复活');
  assert.equal(store2.readSession(session2, {}).messages[0].payload.confirmations.plot.state, 'failed', '被拒的那次不许改动状态');
  // failed 也没有别的出边：confirmed / abandoned 同样被拒。
  assert.throws(() => store2.appendConfirmations(session2, { messageId: message2, kind: 'plot', state: 'confirmed', operationId: 'op-retry01-11112222' }),
    (error) => error.status === 400 && /cannot go failed → confirmed/.test(error.message));
  assert.throws(() => store2.appendConfirmations(session2, { messageId: message2, kind: 'plot', state: 'abandoned' }),
    (error) => error.status === 400 && /cannot go failed → abandoned/.test(error.message));
  // claimed 上换 operationId 重投：claimed 只有 confirmed/failed 两个出口。
  assert.throws(() => store2.appendConfirmations(session2, { messageId: message2, kind: 'plot', state: 'claimed', operationId: 'op-retry03-11112222' }),
    (error) => error.status === 400 && /cannot go failed → claimed/.test(error.message));

  /* 但**新卡片**（新 messageId）从 pending 开 claimed 必须照常合法——别把正常路径
   * 一起堵死：重试就是走这条。 */
  const message2b = 'm-confirm2-11112222';
  store2.appendMessages(session2, [{ messageId: message2b, role: 'agent', text: '重发一次', payload: { plots: [{}] } }]);
  const retried = store2.appendConfirmations(session2, { messageId: message2b, kind: 'plot', state: 'claimed', operationId: 'op-retry02-11112222' });
  assert.deepEqual(retried.states[`${message2b} plot`], 'claimed');
  const afterRetry = store2.readSession(session2, {});
  assert.equal(afterRetry.messages.find((item) => item.messageId === message2).payload.confirmations.plot.state, 'failed', '老卡片保持终态');
  assert.equal(afterRetry.messages.find((item) => item.messageId === message2b).payload.confirmations.plot.state, 'claimed', '新卡片从 pending 正常开始');
  // 同 at 按文件顺序、后写覆盖前写。
  store2.appendConfirmations(session2, { messageId: message2, kind: 'normalize', state: 'claimed', operationId: 'op-sameat1-11112222', at: '2026-09-23T12:00:00.000Z' });
  store2.appendConfirmations(session2, { messageId: message2, kind: 'normalize', state: 'confirmed', operationId: 'op-sameat1-11112222', at: '2026-09-23T12:00:00.000Z' });
  assert.equal(store2.readSession(session2, {}).messages[0].payload.confirmations.normalize.state, 'confirmed');
});

test('确认状态机转移表冻结（与本仓抄本比对；**不构成跨仓验证**）', () => {
  /* 这条测试的名字此前叫"与 v2 逐字一致"，那是**名不副实**的：它读的不是
   * D:\scholarium-v2-source\src\features\chat\model.ts，而是下面这份**手抄快照**。
   * 也就是说：v2 单方面改表，这条测试**不会**变红。名称与注释必须说清楚，否则它
   * 给的是一份虚假保证——真正去读 model.ts 的逐字比对归 Agent Q 的跨仓冻结审计，
   * 那边才是"两个前端必须给同一份文件同一个结论"的证据。
   *
   * 保留它的理由：手抄快照仍能挡住**本仓**的单方面改动。同一份会话文件在两个前端
   * 里得到相反结论（一个说"可派发"、一个说"损坏"）正是这套东西要消灭的失败模式，
   * 所以本仓这一侧不许悄悄漂移。 */
  assert.deepEqual(
    Object.fromEntries(Object.entries(chatStore.CONFIRMATION_TRANSITIONS).map(([from, to]) => [from, [...to]])),
    {
      pending: ['pending', 'claimed', 'abandoned'],
      claimed: ['confirmed', 'failed'],
      confirmed: [],
      failed: [],
      abandoned: [],
    },
  );
  assert.equal(chatStore.canTransitionConfirmation('pending', 'claimed'), true);
  assert.equal(chatStore.canTransitionConfirmation('pending', 'abandoned'), true);
  assert.equal(chatStore.canTransitionConfirmation('pending', 'pending'), true);
  assert.equal(chatStore.canTransitionConfirmation('claimed', 'confirmed'), true);
  assert.equal(chatStore.canTransitionConfirmation('claimed', 'failed'), true);
  // 终态没有出边；claimed 也不能回到 pending 或被放弃。
  for (const [from, to] of [
    ['claimed', 'pending'], ['claimed', 'claimed'], ['claimed', 'abandoned'],
    ['failed', 'claimed'], ['failed', 'confirmed'], ['failed', 'abandoned'], ['failed', 'pending'],
    ['confirmed', 'claimed'], ['confirmed', 'abandoned'], ['confirmed', 'pending'],
    ['abandoned', 'claimed'], ['abandoned', 'confirmed'], ['abandoned', 'pending'],
  ]) {
    assert.equal(chatStore.canTransitionConfirmation(from, to), false, `${from} → ${to} 不该是合法迁移`);
  }
});

test('执行账本：四种情形、人工核对、损坏行', () => {
  const vault = tempVault('chat-store-ledger-');
  const store = storeFor(vault);
  const request = { b: 2, a: [1, { z: 1, y: 2 }] };
  const sha = chatStore.operationRequestSha256(request);
  // 规范化哈希只看内容，不看键序/JSON 文本。
  assert.equal(sha, chatStore.operationRequestSha256({ a: [1, { y: 2, z: 1 }], b: 2 }));
  const op = 'op-ledger01-11112222';

  const first = store.beginOperation({ operationId: op, kind: 'draft', messageId: 'm-ledger0-11112222', requestSha256: sha });
  assert.deepEqual(first, { proceed: true, operationId: op, status: 'claimed' });
  // 已有 claimed 且同请求 → 409（崩溃窗口，人工核对），不写任何文件。
  const before = fs.readFileSync(path.join(vault, 'Scholarium', 'Chat', 'v1', 'operations.jsonl'), 'utf8');
  assert.throws(() => store.beginOperation({ operationId: op, kind: 'draft', requestSha256: sha }),
    (error) => error.status === 409 && error.message === 'operation already claimed');
  assert.equal(fs.readFileSync(path.join(vault, 'Scholarium', 'Chat', 'v1', 'operations.jsonl'), 'utf8'), before);
  // 同 ID 换请求 → 409。
  assert.throws(() => store.beginOperation({ operationId: op, kind: 'draft', requestSha256: 'b'.repeat(64) }),
    (error) => error.status === 409 && error.message === 'operation id reused with a different request');

  const finished = store.finishOperation({ operationId: op, status: 'confirmed', result: { ok: true, items: [{ path: 'a.md' }] } });
  assert.equal(finished.status, 'confirmed');
  // 终态 + 同请求 → 重放，返回原结果，不再写账本。
  const bytesAfterFinish = fs.readFileSync(path.join(vault, 'Scholarium', 'Chat', 'v1', 'operations.jsonl'), 'utf8');
  const replayed = store.beginOperation({ operationId: op, kind: 'draft', requestSha256: sha });
  assert.equal(replayed.proceed, false);
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.result, { ok: true, items: [{ path: 'a.md' }] });
  assert.equal(fs.readFileSync(path.join(vault, 'Scholarium', 'Chat', 'v1', 'operations.jsonl'), 'utf8'), bytesAfterFinish, '重放不得追加任何账本行');
  // finish 重复调用不会写第二条终态。
  store.finishOperation({ operationId: op, status: 'failed', error: 'x' });
  assert.equal(store.readOperation(op).status, 'confirmed');
  assert.equal(store.readOperation(op).history, 2);

  // 人工核对：只有 claimed 能被落终态，重复调用幂等。
  const op2 = 'op-ledger02-11112222';
  store.beginOperation({ operationId: op2, kind: 'run', requestSha256: sha });
  const resolved = store.resolveOperation({ operationId: op2, outcome: 'failed', detail: { reason: '研究员核对：未生效' } });
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.operation.status, 'failed');
  assert.equal(resolved.operation.error, '研究员核对：未生效');
  assert.equal(store.resolveOperation({ operationId: op2, outcome: 'confirmed' }).replayed, true);
  assert.equal(store.readOperation(op2).status, 'failed', '已结的票据不许被第二次改写');
  assert.throws(() => store.resolveOperation({ operationId: 'op-nosuch00-11112222', outcome: 'confirmed' }),
    (error) => error.status === 404 && error.message === 'operation not found');
  assert.throws(() => store.resolveOperation({ operationId: op2, outcome: 'maybe' }), /outcome must be confirmed or failed/);
  assert.throws(() => store.finishOperation({ operationId: 'op-nosuch00-11112222', status: 'confirmed' }), /operation not found/);
  assert.throws(() => store.beginOperation({ operationId: 'bad id', requestSha256: sha }), /operationId must match/);
  assert.equal(store.readOperation(op2).kind, 'run');

  // 账本损坏（非末行）响亮失败；末行残缺按同一条容错规则忽略。
  const ledger = path.join(vault, 'Scholarium', 'Chat', 'v1', 'operations.jsonl');
  fs.appendFileSync(ledger, '{"type":"operation","operationId":"op-half');
  assert.equal(store.readOperation(op2).status, 'failed', '残缺末行必须被忽略');
  fs.appendFileSync(ledger, '{"type":"operation",broken}\n{"type":"operation","operationId":"op-ok000001-11112222","status":"claimed"}\n');
  assert.throws(() => store.readOperation(op2), (error) => error.status === 500 && error.message === 'chat operations ledger is corrupt');
});

test('会话头恰好一行，正文逐行一个 JSON 事件', () => {
  const vault = tempVault('chat-store-shape-');
  const store = storeFor(vault);
  const sessionId = store.createSession({ scopeKey: 'topic:f', title: '形状' }).session.sessionId;
  store.appendMessages(sessionId, [message(1, { role: 'user', text: '多行\n文本\n也要原样' })]);
  const raw = fs.readFileSync(sessionFile(vault, 'topic:f', sessionId), 'utf8');
  assert.ok(raw.endsWith('\n'), '每个事件都必须以 \\n 结尾');
  const events = readLines(sessionFile(vault, 'topic:f', sessionId));
  assert.equal(events.filter((event) => event.type === 'session').length, 1);
  assert.equal(events[0].schema, 'scholarium-chat/1');
  assert.equal(events[0].v, 1);
  assert.equal(events[0].sessionId, sessionId);
  assert.equal(events[0].scopeKey, 'topic:f');
  assert.equal(events[0].projectId, null);
  assert.equal(events[1].text, '多行\n文本\n也要原样');
});
