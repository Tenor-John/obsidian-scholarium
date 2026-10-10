"use strict";
// shell 端的对话持久化契约（docs/plans/chat-persistence-contract.md §5）。
//
// shell-ui.js 是在浏览器里跑的 IIFE，spawn 不了、也 require 不了（项目里既有的
// 静态分析测试都基于这个前提，见 tests/shell-ui-error-messages.test.js 的头部
// 说明）。所以这里做的是源码级别的结构断言，而且刻意断言"结构"而不是"某句话
// 出现过"——一句注释里写上"未保存"三个字不该让测试变绿。
//
// 三条真正要咬人的性质：
//   1. 对话正文不再有 localStorage 副本（旧键只读、不写、不删）；
//   2. 正文写入收敛成唯一一条串行队列，两个入口之外的任何地方都不许直写会话；
//   3. 只有两条关键路径 await 这个边界，而且顺序必须是"先落盘再派发/再收尾"。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'shell-ui.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* 注释里的字不该影响结构断言：先把注释剥掉，再数函数、数调用。
 *
 * 这里的块注释只认"整行起、整行止"的那一种（项目里的注释都是这个形状）。用
 * 非贪婪的跨行块注释正则来剥，会把字符串里偶然出现的注释起始符一路吃到很远
 * 的结束符，把中间的真实代码一起删掉——那样测试会因为"看不见代码"而变绿，
 * 比断言失败更糟。 */
function withoutComments(text) {
  return text
    .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}
const code = withoutComments(source);

// 数出现次数时一律带上 g：`String.match` 在非全局正则下只返回第一处，
// 会把 "至少 5 处" 这类断言悄悄变成 "1 处" 而永远为假。
const countOf = (pattern) => (code.match(new RegExp(pattern.source, 'g')) || []).length;

// 取一个函数声明的整段（到函数体那一层的收尾花括号为止）。用固定缩进的收尾
// 行来切，避免手写花括号匹配被模板字符串里的 ${} 带偏。
function functionSpan(signature) {
  const start = code.indexOf(signature);
  assert.ok(start >= 0, `必须在 shell-ui.js 里找到 ${signature}`);
  const end = code.indexOf('\n  }', start);
  assert.ok(end > start, `${signature} 必须有可识别的函数体结尾`);
  return { start, end: end + 4, text: code.slice(start, end + 4) };
}

const SEND = functionSpan('async function sendChatMessage()');

test('对话正文不再写 localStorage：只留 flowId -> sessionId 一个键', () => {
  // 旧写法：按课题拼正文键。这个模板一旦回来，正文就又有了一份 localStorage 副本。
  assert.equal(countOf(/weaver\.shell\.chat\.\$\{/), 0, '不得再按 flowId 拼 localStorage 键');
  assert.equal(countOf(/function chatKey\s*\(/), 0, 'chatKey 助手必须消失');
  assert.equal(countOf(/function readChat\s*\(/), 0);
  assert.equal(countOf(/function writeChat\s*\(/), 0);
  assert.equal(countOf(/JSON\.stringify\(chatMessages/), 0, '整段渲染源不得被序列化进任何地方');

  // 允许写的 localStorage 键（都是界面偏好 + 当前会话指针；没有任何一个能装下
  // 一段对话正文）。新增键必须是有意为之，而不是顺手把正文塞回本地存储。
  const ALLOWED_KEYS = new Set([
    'VIEW_KEY', 'TRACKER_KEY', 'RUN_SUMMARY_COLLAPSED_KEY',
    'CHAT_ACTIVE_SESSION_KEY', 'CHAT_STORE_LEGACY_ARCHIVE', 'WIDTH_KEYS[side]',
  ]);
  const written = [...code.matchAll(/localStorage\.setItem\(\s*([^\s,)]+)/g)].map((match) => match[1]);
  assert.ok(written.length >= 4, `应当能识别到 localStorage 写入点，实际 ${written.length} 个`);
  for (const key of written) {
    assert.ok(ALLOWED_KEYS.has(key), `localStorage.setItem 只允许用已批准的键，发现 ${key}`);
  }
  assert.match(code, /const CHAT_ACTIVE_SESSION_KEY = 'weaver\.shell\.chat\.activeSessionId'/);
  // 旧键的既有处理保持不变：仍然读、仍然归档，不删除（红线 1）。
  assert.match(code, /localStorage\.getItem\(CHAT_STORE_LEGACY\)/);
  assert.match(code, /localStorage\.getItem\(CHAT_STORE_LEGACY_ARCHIVE\)/);
  assert.equal(/localStorage\.removeItem\(CHAT_STORE_LEGACY_ARCHIVE\)/.test(code), false, '不得删除旧版归档键');
});

test('渲染层分页，不再有 slice(-200) 那种数据截断', () => {
  assert.equal(countOf(/slice\(-200\)/), 0, 'slice(-200) 是"磁盘之前先丢历史"，必须删掉');
  // 别的负数截断（比如思考步骤只留最近几条）与正文无关；这里针对的是"对
  // chatMessages 做负数切片"这种把历史裁短的写法。
  assert.equal(/chatMessages[^\n]{0,60}slice\(-\d+\)/.test(code), false, '正文不得再做负数截断');
  assert.equal(/chatMessages\s*=\s*chatMessages\.slice\(/.test(code), false);
  assert.match(code, /const CHAT_PAGE_SIZE = 50/);
  assert.match(code, /加载更早/);
  assert.match(code, /function loadEarlierChat\s*\(/);
  // 分页是"往前取一页接到前面"，不是把数组裁短。
  assert.match(functionSpan('function loadEarlierChat()').text, /chatMessages = \[\.\.\.page\.messages\.map\(chatMessageFromWire\), \.\.\.chatMessages\]/);
});

test('写入收敛成唯一一条串行队列，只有两个入口', () => {
  assert.equal(countOf(/function serializeChatWrite\s*\(/), 1, '串行写链只能有一份实现');
  assert.match(functionSpan('function serializeChatWrite(flowId, task)').text, /tail\.then\(task, task\)/,
    '串行链必须既串行又能跳过前一次的失败，否则一次抖动会卡死这个课题之后的所有写入');
  assert.equal(countOf(/function appendMessage\s*\(/), 1, '入口 1 只能有一份实现');
  assert.equal(countOf(/function updateSession\s*\(/), 1, '入口 2 只能有一份实现');
  // 入口 3 是契约 §2.1 要求的确认事件。它和正文共用同一条串行链，所以"一次确认
  // 与它保护的那次写入"顺序一致；多出来的入口只有这一个。
  assert.equal(countOf(/function appendConfirmation\s*\(/), 1, '入口 3（确认事件）只能有一份实现');
  assert.match(functionSpan('function appendConfirmation(flowId, event)').text, /serializeChatWrite\(flowId/);

  /* 会话级写请求（POST 消息 / PATCH 会话）必须全部落在两个入口里面。
   * 识别方式：URL 是模板字面量，写调用一定紧跟一个 options 对象——也就是闭合
   * 反引号之后是 `, {` 并且不远处就是 method。纯 GET 读调用后面只有 `))`，所以
   * 不会误判（读会话历史本来就该发生在队列之外）。 */
  const writeSites = [];
  for (const match of code.matchAll(/`\/v1\/chat\/sessions\//g)) {
    const close = code.indexOf('`', match.index + 1);
    if (close < 0) continue;
    const after = code.slice(close + 1, close + 200);
    if (/^\s*,\s*\{/.test(after) && /method:\s*'(POST|PATCH)'/.test(after)) writeSites.push(match.index);
  }
  assert.ok(writeSites.length >= 2, `应当识别到会话级写调用，实际 ${writeSites.length} 个（候选 URL ${[...code.matchAll(/\/v1\/chat\/sessions\//g)].length} 处）`);
  const queueSpans = [
    functionSpan('function appendMessage(flowId, message)'),
    functionSpan('function updateSession(flowId, patch, sessionId = null)'),
    functionSpan('function appendConfirmation(flowId, event)'),
  ];
  for (const index of writeSites) {
    assert.ok(queueSpans.some((span) => index >= span.start && index <= span.end),
      `会话写入只能发生在 appendMessage / updateSession / appendConfirmation 里（偏移 ${index}）`);
  }

  // 会话创建是会话生命周期而不是"写正文"，但也只允许出现在 createChatSession
  // 一处：这样"哪里会新建会话"只有一个答案。
  const createSites = [...code.matchAll(/'\/v1\/chat\/sessions'/g)]
    .filter((match) => /method:\s*'POST'/.test(code.slice(match.index, match.index + 400)))
    .map((match) => match.index);
  assert.ok(createSites.length >= 1, '应当能识别到创建会话的调用');
  const createSpan = functionSpan('async function createChatSession(flowId, title)');
  for (const index of createSites) {
    assert.ok(index >= createSpan.start && index <= createSpan.end, `创建会话只能发生在 createChatSession 里（偏移 ${index}）`);
  }

  // 二十来个既有调用点继续调用 saveChat()，没有各自改成 await：这条断言就是
  // 防"退回去逐个 await"的。
  const saveCalls = countOf(/saveChat\(\)/g) - countOf(/function saveChat\s*\(\)/g);
  assert.ok(saveCalls >= 15, `saveChat() 的调用点应当保持原样（至少 15 处），实际 ${saveCalls} 处`);
  assert.equal(countOf(/await saveChat\(/), 0, '调用点不得逐个改成 await saveChat()');
});

test('只有两条关键路径 await 写边界，且顺序是"先落盘再派发 / 再收尾"', () => {
  const awaited = [...code.matchAll(/await flushChat\(/g)].map((match) => match.index);
  assert.equal(awaited.length, 3, 'await flushChat 只应有三处：两条关键路径 + 用户手动的"重试保存"');
  const insideSend = awaited.filter((index) => index >= SEND.start && index <= SEND.end);
  assert.equal(insideSend.length, 2, '关键路径只能有两条，且都在 sendChatMessage 里');
  const retrySpan = functionSpan('async function retryChatPersistence()');
  const outside = awaited.filter((index) => index < SEND.start || index > SEND.end);
  for (const index of outside) {
    assert.ok(index >= retrySpan.start && index <= retrySpan.end, `除关键路径外只有 retryChatPersistence 可以 await 写边界（偏移 ${index}）`);
  }

  // ① 派发任务之前必须先落盘。
  const userFlush = SEND.text.indexOf('await flushChat(ownerFlow, [userMessage])');
  const dispatch = SEND.text.indexOf("bridgeFetch('/v1/tasks'");
  assert.ok(userFlush >= 0, '用户消息必须在派发前 await 落盘');
  assert.ok(dispatch > userFlush, '落盘必须发生在把任务交给 Agent 之前，否则"已发生的回合"会没有正文');
  assert.match(SEND.text.slice(userFlush, dispatch), /persistedUser\.ok/, '落盘失败必须真的拦下发送');

  // ② 回复先落盘，再清掉思考状态（收尾在 finally 里）。
  const replyFlush = SEND.text.indexOf('await flushChat(ownerFlow, [storedReply])');
  const appended = SEND.text.indexOf('appendToChat(ownerFlow, storedReply)');
  const finallyAt = SEND.text.indexOf('} finally {');
  assert.ok(appended >= 0 && replyFlush > appended, '回复必须先追加到渲染源，再交给写队列');
  assert.ok(finallyAt > replyFlush, '落盘必须发生在收尾（清 pending、解锁输入）之前');
  assert.match(SEND.text, /persistedReply\.ok/, '回复落盘失败必须显式处理，不许静默当成功');

  // 归档/改名是用户点出来的动作，可以 await 结果来刷新界面；但它们不许出现在
  // 对话回合的业务路径里。
  const updateAwaits = [...code.matchAll(/await updateSession\(/g)].map((match) => match.index);
  assert.ok(updateAwaits.length >= 1, '归档/改名需要通过写队列');
  for (const index of updateAwaits) {
    for (const span of [SEND, functionSpan('function appendToChat(flowId, message)'), functionSpan('async function flushChat(flowId = chatFlowId, targets = null)')]) {
      assert.ok(index < span.start || index > span.end, '用户点出来的归档/改名不得混进对话回合的写入路径');
    }
  }
});

test('失败必须可见：未保存标记 + 复制 + 重试，离线时发送禁用且不回退 localStorage', () => {
  const sendText = SEND.text;
  // 正文存储不可用时：不发送、不静默、不写本地。
  assert.match(sendText, /if \(chatStorageError \|\| chatStorageBusy \|\| !chatSessions\.get\(ownerFlow\)\)/, '存储不可用时必须直接停下');
  assert.match(sendText, /这句话没有发送，也没有保存/, '必须说清"没发送"和"没保存"两件事');
  assert.match(sendText, /没有保存到 Vault，因此也没有发送给 Agent/);

  assert.match(code, /function unsavedBadge\(message\)/);
  assert.match(code, /未保存：这条还没写进 Vault/);
  assert.match(code, /复制正文/);
  assert.match(code, /重试保存/);
  assert.match(code, /function chatStorageNotice\(kind, text\)/);
  assert.match(code, /function updateComposerState\(\)/);
  assert.match(code, /chatSend\.disabled = chatBusy \|\| chatStorageBusy \|\| Boolean\(chatStorageError\)/,
    '发送按钮必须由"正文存储可用"决定，而不是只由 chatBusy 决定');
  // 离线时不许退回 localStorage 兜底：代码里不能再有把正文写进本地存储的路径。
  assert.equal(countOf(/localStorage\.setItem\(CHAT_STORE_LEGACY\b/g), 0, '旧键只在归档迁移时整体搬运，不能当成正文兜底');
  assert.equal(/localStorage\.setItem\([^)]*chatMessages/.test(code), false);
});

test('八种确认都走 claimed → 投递 → 终态，且 claimed 必须落盘之后才投递', () => {
  // ① 八种 kind 一个都不能少：少一种就是那条路径没有锁定态，重载后还能再点一次。
  const kindsBlock = code.slice(code.indexOf('const CONFIRMATION_KINDS = ['), code.indexOf('const CONFIRMATION_KINDS = [') + 220);
  for (const kind of ['action', 'draft', 'legacyNoteEdit', 'run', 'normalize', 'plot', 'plotRevision', 'suggestReconstruction']) {
    assert.ok(kindsBlock.includes(`'${kind}'`), `CONFIRMATION_KINDS 必须覆盖 ${kind}`);
  }
  assert.match(kindsBlock, /suggestReconstruction'\]/);

  // ② 九个确认执行入口（八个 kind，其中 action 还兼管 experiment.transition 与
  //    provenance invalidation 两条两阶段通道）都必须先 claim 再投递。
  const handlers = [
    'async function executeScholariumActions(flowId, message)',
    'async function executeDraftRequests(flowId, message)',
    'async function executeLegacyNoteEdits(flowId, message)',
    'async function executeRunRequest(flowId, message, index)',
    'async function executeNormalizeRequest(flowId, message, index)',
    'async function executePlotRequest(flowId, message, index)',
    'async function executePlotRevision(flowId, message, index)',
  ];
  for (const signature of handlers) {
    const span = functionSpan(signature);
    assert.match(span.text, /isConfirmableState\(confirmationState\(message, '/, `${signature} 必须先检查锁定态`);
    assert.match(span.text, /beginChatConfirmation\(message, '/, `${signature} 必须先落 claimed 再投递`);
    assert.match(span.text, /settleChatConfirmation\(message, '/, `${signature} 必须追加终态`);
    const claim = span.text.indexOf('beginChatConfirmation(');
    const dispatch = span.text.indexOf('bridgeFetch(');
    assert.ok(dispatch < 0 || claim < dispatch, `${signature}：claimed 必须在任何真实投递之前 await 完成`);
  }
  // 打开重建面板那条也是确认，也要锁定。
  assert.match(functionSpan('function suggestReconstructionCard(message)').text, /beginChatConfirmation\(message, 'suggestReconstruction'/);

  // ③ 只有 pending / failed 可再点；claimed / confirmed / abandoned 是锁定态。
  assert.match(code, /function isConfirmableState\(state\) \{ return state === 'pending'; \}/);
  // 旧卡片里的确认按钮不再只看 abandoned，而是走同一个判据。
  // 旧写法是"这批按钮只在 abandoned 时藏起来"（abandoned 作为该条件的最后一项）。
  // 锁定条的 `state !== 'abandoned' && state !== 'failed'` 是状态分发、不是按钮判据，
  // 不受这条约束。
  assert.equal(countOf(/state !== 'abandoned'\)/), 0, '按钮可点性必须用 isConfirmableState，不能只看 abandoned');
  assert.ok(countOf(/isConfirmableState\(state\)/) >= 5);

  // ④ 状态读的是派生值，不是内存里的独立真相。
  assert.match(functionSpan('function confirmationState(message, kind)').text, /message\?\.confirmations\?\.\[kind\]\?\.state/);
  assert.match(code, /const CHAT_CONFIRMATION_STATES = \['pending', 'claimed', 'confirmed', 'failed', 'abandoned'\]/);
});

test('claimed 卡片只显示"正在核对执行结果"，查账本、禁止重跑，人工落终态', () => {
  const lock = functionSpan('function confirmationLockBar(message, kind)');
  // 锁定的三种状态各有各的呈现，claimed 尤其不能是"再点一次"。
  assert.match(lock.text, /state !== 'claimed' && state !== 'confirmed' && state !== 'abandoned'/);
  assert.match(lock.text, /正在核对执行结果/);
  assert.match(lock.text, /不会再执行第二次/);
  assert.match(lock.text, /已经投递过（或崩在投递前后）/);
  // 查账本是必须的（按 operationId），查不到也要说清楚意味着什么。
  assert.match(lock.text, /bridgeFetchRaw\(`\/v1\/chat\/operations\/\$\{entry\.operationId\}`\)/);
  assert.match(lock.text, /账本里查不到这个编号/);
  // 人工裁决两个方向，且缺编号时不许拿假编号去 resolve。
  assert.match(lock.text, /resolveClaimedConfirmation\(message, kind, entry\.operationId, 'confirmed'\)/);
  assert.match(lock.text, /resolveClaimedConfirmation\(message, kind, entry\.operationId, 'failed'\)/);
  assert.match(lock.text, /if \(entry\.operationId\) bar\.append\(markDone, markFailed\)/);

  const resolveFn = functionSpan('async function resolveClaimedConfirmation(message, kind, operationId, outcome)');
  assert.match(resolveFn.text, /settleChatConfirmation\(message, kind, operationId/);

  // 账本两个动作：claim 在投递前占位，resolve 必须带人工确认头。
  const ledger = functionSpan('async function chatLedger(path, body, options = {})');
  assert.match(ledger.text, /'x-scholarium-user-confirmed': 'true'/);
  const begin = functionSpan('async function beginChatConfirmation(message, kind, request, detail, options = {})');
  assert.match(begin.text, /\/v1\/chat\/operations\/\$\{operationId\}\/claim/);
  assert.ok(begin.text.indexOf('markConfirmation(message, kind, \'claimed\'') < begin.text.indexOf('/claim'),
    'claimed 事件必须先于账本占位：顺序反了就会留下"账本说有、会话文件说没有"的假崩溃窗口');
  assert.match(begin.text, /if \(!claimed\) return \{ ok: false \};/);
  assert.match(begin.text, /if \(!claimed\) return \{ ok: false \}/);
  const settle = functionSpan('async function settleChatConfirmation(message, kind, operationId, outcome = {})');
  assert.match(settle.text, /\/resolve`, \{ outcome: state, detail \}, \{ confirmed: true \}/);
  // 终态只有 confirmed/failed 两种，且 failed 之后重试要生成新编号。
  assert.match(settle.text, /const state = outcome\.error \? 'failed' : 'confirmed'/);
  assert.match(code, /function newOperationId\(\)/);
});

test('一次确认只有一个 operationId，且 abandoned 只能从 pending 到达', () => {
  // ① 号码只在"开一次新确认"的时候铸一次：结算时另铸一个会让 v2 把同一份会话
  //    文件判成损坏（终态 id ≠ claimed id），两个前端对同一份数据给出不同结论。
  assert.equal(countOf(/newOperationId\(\)/g), 2, 'newOperationId 只应被定义与使用各一次');
  const begin = functionSpan('async function beginChatConfirmation(message, kind, request, detail, options = {})');
  assert.match(begin.text, /const operationId = newOperationId\(\)/);
  const settles = [...code.matchAll(/settleChatConfirmation\(/g)].map((match) => match.index);
  assert.ok(settles.length >= 8, `settleChatConfirmation 的调用点应当覆盖八种确认，实际 ${settles.length} 处`);
  for (const index of settles) {
    const call = code.slice(index, index + 120);
    assert.equal(/newOperationId\(\)/.test(call), false, `结算不得另铸号码：${call.split('\n')[0]}`);
    assert.ok(/lifecycle\.operationId|operationId,|entry\.operationId|\(message, kind, operationId/.test(call),
      `结算必须复用 claimed 的那个号码：${call.split('\n')[0]}`);
  }
  // 终态事件的 operationId 必须来自 lifecycle（claimed 那一次），而不是现场新铸。
  assert.equal(countOf(/markConfirmation\(message, kind, 'confirmed', \{ operationId: newOperationId\(\)/g), 0);

  // ② abandoned 只能从 pending 到达：卡片级"暂不执行"只对 pending 渲染，
  //    claimed 之后改主意不是"什么都没发生"，而是留在锁定态等人工核对。
  const abandon = functionSpan('function appendAbandonButton(bar, message, kind)');
  assert.match(abandon.text, /if \(confirmationState\(message, kind\) !== 'pending'\) return;/);
  // 执行中途那个「取消」只改内存里的 actionsCancel，不写 abandoned 事件。
  const cancelSites = [...code.matchAll(/actionsCancel = true/g)].map((match) => match.index);
  assert.ok(cancelSites.length >= 1);
  for (const index of cancelSites) {
    assert.equal(/markConfirmation|abandonConfirmation/.test(code.slice(index, index + 200)), false,
      '「取消剩余项」不得写 abandoned 事件——已投递的部分状态不会因此改变');
  }
  // 写 abandoned 事件的地方全项目只有一处：appendAbandonButton → abandonConfirmation。
  const abandonWrites = [...code.matchAll(/markConfirmation\([^)]*'abandoned'/g)].map((match) => match.index);
  assert.equal(abandonWrites.length, 1, 'abandoned 事件只允许有一个写入点');
  const abandonFn = functionSpan('async function abandonConfirmation(message, kind)');
  assert.ok(abandonWrites[0] >= abandonFn.start && abandonWrites[0] <= abandonFn.end);
  const callers = [...code.matchAll(/abandonConfirmation\(/g)].length;
  assert.equal(callers, 2, 'abandonConfirmation 只应被定义一次、被 appendAbandonButton 调用一次');
  assert.match(abandon.text, /abandonConfirmation\(message, kind\)/);
});

test('投递必须携带稳定 operationId：写端点一律走 chatDispatch，且送的是 claimed 的那一个', () => {
  // ① 唯一的注入点。
  assert.equal(countOf(/function chatDispatch\(path, options, operationId\)/g), 1, '投递入口只能有一份实现');
  const dispatch = functionSpan('function chatDispatch(path, options, operationId)');
  assert.match(dispatch.text, /headers\['x-scholarium-operation-id'\] = sequence === 1 \? operationId : `\$\{operationId\}-\$\{sequence\}`/,
    'operationId 必须真的被写进请求头（fan-out 的第 2 个之后带序号，避免同号换请求被判 409）');
  assert.match(dispatch.text, /if \(!operationId\) return Promise\.reject/, '没有号就不许投递');
  assert.match(dispatch.text, /key\.toLowerCase\(\) === 'x-scholarium-operation-id'/, '大小写不同的同名头必须先去重');

  // ② 八条确认路径里，任何会真实写入的端点调用都不许绕过它。
  const handlers = [
    'async function executeScholariumActions(flowId, message)',
    'async function executeDraftRequests(flowId, message)',
    'async function executeLegacyNoteEdits(flowId, message)',
    'async function executeNormalizeRequest(flowId, message, index)',
    'async function executePlotRequest(flowId, message, index)',
    'async function executePlotRevision(flowId, message, index)',
  ];
  const WRITE_URLS = ['/commit`', '/v1/skills/run', '/v1/scholarium/actions'];
  // runChartRecipe 是 plot / plotRevision 的间接投递点，也要一起扫。
  let checked = 0;
  for (const signature of [...handlers, 'async function runChartRecipe(input, operationId)']) {
    const span = functionSpan(signature);
    for (const url of WRITE_URLS) {
      let index = span.text.indexOf(url);
      while (index >= 0) {
        // URL 字面量后面紧跟的逗号，就是"这次调用带 options 对象"的位置；从那里
        // 往后看 method。同一个前缀也出现在只读轮询（GET /v1/scholarium/actions/:id，
        // 没有 options 对象）上，那种不该带号。
        const comma = span.text.indexOf(',', index);
        const after = comma > index && comma - index < 24 ? span.text.slice(comma, comma + 220) : '';
        const isWriteCall = /^,\s*\{[\s\S]{0,180}method: 'POST'/.test(after);
        if (isWriteCall) {
          const call = span.text.slice(Math.max(0, index - 80), index + 40);
          // 唯一的豁免：sch-data-normalize 的 mode:'inspect'（SKILL.md 明写
          // "Inspection is read-only"），它不写任何东西，也不该占掉这张票据。
          const readOnlyInspect = /mode: 'inspect'/.test(span.text.slice(index, index + 400));
          assert.ok(/chatDispatch\(/.test(call) || readOnlyInspect,
            `${signature} 里的写端点调用绕过了 chatDispatch：${call.replace(/\s+/g, ' ')}`);
          checked += 1;
        }
        index = span.text.indexOf(url, index + 1);
      }
    }
  }
  assert.ok(checked >= 6, `应当扫到六个以上写端点调用点，实际 ${checked}`);
  // 只读的 preview 端点不许被包进去（包了就会先占掉这张票据）。
  assert.equal(/chatDispatch\([^)]*\/preview/.test(code), false, 'preview 是只读的，不要带号');

  // ③ 送出的号必须来自 claimed 那一次铸造，不是现场新铸。
  const sites = [...code.matchAll(/chatDispatch\(/g)].map((match) => match.index);
  assert.ok(sites.length >= 7, `chatDispatch 的调用点应当覆盖所有写路径，实际 ${sites.length}`);
  for (const index of sites) {
    const call = code.slice(index, index + 420);
    assert.equal(/newOperationId\(\)/.test(call), false, `调用点不得现场铸号：${call.split('\n')[0]}`);
    assert.ok(/lifecycle\.operationId|, operationId\)/.test(call),
      `必须复用 claimed 的那个号：${call.split('\n')[0]}`);
  }
  // runChartRecipe 这种间接投递也要把号传进去。
  assert.equal(countOf(/runChartRecipe\(input, lifecycle\.operationId\)/g), 2, 'plot / plotRevision 都必须把号传进 Skill 调用');

  // ④ 两类"投递挂不上头"的确认（run 的派发在 bridge-ui.js、suggestReconstruction 的
  //    写入在重建面板里）必须显式声明 guarded:false —— 它们的账本行只能由 shell
  //    预先占位。写成默认值会让它们既没有端点守卫、也没有账本记录。
  const unguarded = [...code.matchAll(/beginChatConfirmation\(message, '([a-zA-Z]+)'[\s\S]{0,160}?\{ guarded: false \}/g)].map((match) => match[1]);
  assert.deepEqual(unguarded.sort(), ['run', 'suggestReconstruction'],
    `只有这两类可以声明 guarded:false，实际 ${JSON.stringify(unguarded)}`);
  // 其余六类不许声明 guarded:false（它们必须由执行端点守卫）。
  for (const kind of ['action', 'draft', 'legacyNoteEdit', 'normalize', 'plot', 'plotRevision']) {
    const span = code.slice(code.indexOf(`beginChatConfirmation(message, '${kind}'`), code.indexOf(`beginChatConfirmation(message, '${kind}'`) + 200);
    assert.equal(/guarded: false/.test(span), false, `${kind} 必须由执行端点守卫，不能退回 shell 预占位`);
  }
});

test('§2.3：run 的号只透传到 pipeline 入口，且边界写在代码里', () => {
  const run = functionSpan('async function executeRunRequest(flowId, message, index)');
  // 控制器收到的必须是 claimed 那一次铸造的号（不是现场新铸、不是不给）。
  // 号必须来自 claimed 那一次铸造（挂进 request，再由 bridge-ui.js 透传到入口）。
  assert.match(run.text, /request\.operationId = lifecycle\.operationId/,
    '控制器必须收到与确认事件相同的 operationId');
  assert.match(run.text, /window\.runScholariumConversationOperation\(request\)/,
    '调用形状必须保持（既有测试钉着它），号通过 request 传进去');
  assert.equal(countOf(/runScholariumConversationOperation\(/g), 1, '一个处理器里只该有一次控制器调用');
  // 先锁后投：claimed 的持久化（beginChatConfirmation）必须在控制器调用之前。
  assert.ok(run.text.indexOf('beginChatConfirmation(') < run.text.indexOf('runScholariumConversationOperation('),
    'claimed 没落盘就不许调控制器');
  // 边界必须写在代码里：读的人不该以为 run 有执行端幂等。注释被 functionSpan
  // 剥掉了，所以这几条查的是源码原文（注释也是这段代码的一部分）。
  const runRawStart = source.indexOf('async function executeRunRequest');
  const runRaw = source.slice(runRawStart, runRawStart + 3000);
  assert.match(runRaw, /只有 claimed 锁/, '必须写明 run 在 P0 只有 claimed 锁');
  assert.match(runRaw, /literature\.queue[\s\S]{0,80}postMessage/, '必须写明 queue 分支物理上盖不到');
  assert.match(runRaw, /只在\*\*入口\*\*做到幂等/, '必须写明只守入口');
  assert.match(runRaw, /P1/, '必须指向完整的 host/多阶段幂等属于 P1');

  // bridge-ui.js 侧：读号 → 透传 → 只加在入口那一次写请求上。
  const bridgeSource = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');
  const bridgeCode = withoutComments(bridgeSource);
  const dispatchSpan = (() => {
    const start = bridgeCode.indexOf('async function dispatchConversationOperation(request) {');
    assert.ok(start >= 0, 'dispatchConversationOperation 必须存在');
    const end = bridgeCode.indexOf('\n  }\n', start);
    return bridgeCode.slice(start, end);
  })();
  assert.match(dispatchSpan, /const operationId = String\(request\?\.operationId \|\| ''\)/, '必须从 request 里读号');
  assert.match(dispatchSpan, /runLiteratureSearch\(\{ topic: request\.topic, confirmedFromChat: true, operationId \}\)/);
  assert.match(dispatchSpan, /rerunPipelineFromConversation\(\{ \.\.\.request, operationId \}\)/);
  // 边界注释同样查原文（dispatchSpan 是剥掉注释的代码）。
  const dispatchRaw = bridgeSource.slice(bridgeSource.indexOf('async function dispatchConversationOperation'), bridgeSource.indexOf('async function dispatchConversationOperation') + 2000);
  assert.match(dispatchRaw, /literature\.queue[\s\S]{0,120}盖不到/, '必须写明 queue 分支盖不到（走 postMessage，头机制物理上到不了）');
  assert.match(dispatchRaw, /不算端点幂等/);
  assert.match(dispatchRaw, /claimed 锁/);
  // 入口写请求带号：literature.search 的检索调用 + pipeline 的运行记录。
  assert.match(bridgeCode, /const runSearch = \(value\) => bridgeFetch\('\/v1\/literature\/search', \{ method: 'POST', headers: \{ 'content-type': 'application\/json', \.\.\.\(options\.operationId \? \{ 'x-scholarium-operation-id': options\.operationId \} : \{\}\) \}/);
  assert.match(bridgeCode, /async function beginPipelineHistory\(title, workspace, parentRunId = null, operationId = ''\)/);
  // 别依赖行尾格式（bridge-ui.js 是 CRLF）：在函数体里分别找'带头'与'带 body'。
  const historySpan = bridgeCode.slice(bridgeCode.indexOf('async function beginPipelineHistory'), bridgeCode.indexOf('async function checkpointPipelineHistory'));
  assert.match(historySpan, /'x-scholarium-operation-id': operationId \} : \{\}\)/);
  assert.match(historySpan, /body: JSON\.stringify\(\{ title, workspace, parentRunId \}\)/);
  // 只加在入口：pipeline 内部的阶段派发不许带号。
  assert.equal(/x-scholarium-operation-id/.test(bridgeCode.slice(bridgeCode.indexOf('async function runResearchPipeline'))),
    false, '阶段内部不得带号（只在入口）');
});

test('§2.4：failed 不再是可确认状态，只留"本次没有生效"+ 请重新发起', () => {
  assert.match(code, /function isConfirmableState\(state\) \{ return state === 'pending'; \}/,
    'failed 不得再出现在可确认状态里');
  const lock = functionSpan('function confirmationLockBar(message, kind)');
  // failed 也要渲染出来（否则卡片上什么都不显示，像是被吞了）。
  assert.match(lock.text, /state !== 'claimed' && state !== 'confirmed' && state !== 'abandoned' && state !== 'failed'/);
  assert.match(lock.text, /本次没有生效/);
  assert.match(lock.text, /这张卡片不会再执行/);
  assert.match(lock.text, /请核对结果后重新发起一遍这次请求/);
  // failed 分支必须是"只附说明就返回"——不许出现任何按钮。
  const failedBranch = lock.text.slice(lock.text.indexOf("if (state === 'failed')"), lock.text.indexOf("if (state !== 'claimed') return card;"));
  assert.ok(failedBranch.length > 0, 'failed 必须有自己的分支');
  assert.equal(/createElement\('button'\)|\.onclick|markDone|markFailed|resolveClaimedConfirmation/.test(failedBranch), false,
    'failed 卡片上不许有任何执行/重试按钮');
  // 卡片里原本那几处"失败后原位重试"的措辞必须消失。
  assert.equal(countOf(/修复后重试/g), 0, '原位重试的文案必须拿掉，否则读代码的人会以为还能重试');
  assert.equal(countOf(/重新预览并写入失败的记录/g), 0);
  assert.equal(countOf(/重新预览并修改失败的笔记/g), 0);
  // pending 仍然是可确认的，abandon 也仍然只对 pending 开放。
  assert.match(functionSpan('function appendAbandonButton(bar, message, kind)').text, /confirmationState\(message, kind\) !== 'pending'/);
});

test('页面结构：会话列表 / 归档恢复 / 可访问状态文案都在，且旧版导入仍保留只读浏览', () => {
  assert.match(html, /id="chatStorageStatus"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /id="chatHistoryBtn"/);
  assert.match(html, /id="chatArchiveBtn"/);
  assert.match(html, /id="chatLegacyArchiveBtn"/);

  // 旧版归档对话框：只读浏览与"复制全部为文本"必须保留，导入是新加的第三条。
  assert.match(code, /function ensureLegacyArchiveDialog\(\)/);
  assert.match(code, /legacyArchiveCopyBtn/);
  assert.match(code, /复制全部为文本/);
  assert.match(code, /legacyArchiveImportBtn/);
  assert.match(code, /导入到当前课题/);
  // 导入必须先预览再确认：commit 分支出现在前面（按钮是两段式的），所以真正要
  // 断言的是"提交用的票据与指纹只能来自一次成功的预览"——即 commit 只在
  // pendingLegacyImport 已经存在时才会发出，而它只在预览返回后被打上。
  const importFn = functionSpan('async function importLegacyArchiveIntoCurrentTopic(dialog, archived, button)');
  assert.match(importFn.text, /\/v1\/chat\/import\/preview/);
  assert.match(importFn.text, /\/v1\/chat\/import\/commit/);
  assert.match(importFn.text, /'x-scholarium-user-confirmed': 'true'/);
  assert.match(importFn.text, /ticket, fingerprint, confirm: true/);
  assert.match(importFn.text, /sourceSha256/, '导入必须记录来源哈希');
  const gate = importFn.text.indexOf('if (pendingLegacyImport)');
  const commit = importFn.text.indexOf('import/commit');
  const stamp = importFn.text.indexOf('pendingLegacyImport = { ticket: preview.ticket, fingerprint: preview.fingerprint }');
  assert.ok(gate >= 0 && gate < commit, 'commit 必须由"已经拿到预览票据"这个条件把关');
  assert.ok(stamp > importFn.text.indexOf('import/preview'), '票据与指纹只能来自预览的返回值');
  assert.match(importFn.text.slice(gate, commit), /const \{ ticket, fingerprint \} = pendingLegacyImport/,
    '提交时回报的必须正是预览那一份票据与指纹，而不是现场重算的');
});
