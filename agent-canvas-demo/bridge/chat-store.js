'use strict';
/* 对话正文的唯一权威存储。
 *
 * 为什么要有这个文件：在此之前，织研者的对话正文只存在于 iframe 那个 Origin 的
 * localStorage 里，而 launcher 每次启动绑定的 canvas 端口都可能不同——不同端口
 * 就是不同 Origin，于是"上次的对话"在换端口后变成一片空白存储。正文因此必须落
 * 到 Vault 里的普通文件，并且由 Bridge（唯一已经校验过 Vault 根的进程）来写。
 *
 * 格式与路径的权威定义在 docs/plans/chat-persistence-contract.md；本文件是它在
 * 部署版 Bridge 里的实现，v2 的 VaultChatStore 读写同一份格式。
 *
 * 两条不可让步的性质：
 *   1. append-only。归档/改名只追加 state 事件，绝不重写、移动或删除正文行——
 *      断电时最多损失正在写的末行，既有行始终可读。
 *   2. 越界即响亮失败。任何试图把会话文件写到 <vaultRoot>/Scholarium/Chat/v1
 *      之外的路径都必须抛错，不做"就近修正"，否则一次调用方的路径拼接错误就会
 *      静默地把用户数据写到 Vault 之外。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = 'scholarium-chat/1';
const STORE_DIR_SEGMENTS = ['Scholarium', 'Chat', 'v1'];
const INDEX_FILENAME = 'index.json';
const OPERATIONS_FILENAME = 'operations.jsonl';
const SESSION_ID_RE = /^s-[a-z0-9]{4,16}-[0-9a-f]{8}$/;
const MESSAGE_ID_RE = /^m-[a-z0-9-]{6,40}$/;
const EVENT_ID_RE = /^evt-[a-z0-9-]{6,40}$/;
const OPERATION_ID_RE = /^op-[a-z0-9-]{6,40}$/;
const SCOPE_HASH_RE = /^[0-9a-f]{24}$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
// 契约 §2.1：八种确认类型一个都不能少。少一种就意味着那条路径没有锁定态，
// 重载后仍可再点一次"确认执行"。
const CONFIRMATION_KINDS = new Set(['action', 'draft', 'legacyNoteEdit', 'run', 'normalize', 'plot', 'plotRevision', 'suggestReconstruction']);
const CONFIRMATION_STATES = new Set(['pending', 'claimed', 'confirmed', 'failed', 'abandoned']);
const OPERATION_STATUSES = new Set(['claimed', 'confirmed', 'failed']);
// `error` 不是"消息角色"的常见取值，但 shell 从 2026-08 起就在用它渲染安全告警
// 气泡。丢弃它会静默改变既有历史的展示，所以它和 user/agent/system 一样合法。
const ROLES = new Set(['user', 'agent', 'system', 'error']);
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;
const MAX_MESSAGES_PER_REQUEST = 500;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
// scopeKey 是 project:<id> / topic:<flowId>，只用于算哈希，永远不拼进文件名。
const MAX_SCOPE_KEY_LENGTH = 300;

class ChatStoreError extends Error {
  constructor(message, status = 400, details = null) {
    super(message);
    this.name = 'ChatStoreError';
    this.status = status;
    this.details = details;
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function scopeHash(scopeKey) {
  return sha256Hex(scopeKey).slice(0, 24);
}

function randomToken(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

function newSessionId() {
  // 形状固定为 s-<8 位 base36 时间>-<8 位随机 hex>，既单调可比又带随机性，
  // 两个进程在同一毫秒创建会话也不会撞名。
  const stamp = Date.now().toString(36).padStart(8, '0').slice(-8);
  return `s-${stamp}-${randomToken(4)}`;
}

function newMessageId() {
  return `m-${Date.now().toString(36)}-${randomToken(4)}`;
}

function requireString(value, field, max = 4000) {
  if (typeof value !== 'string' || !value.trim()) throw new ChatStoreError(`${field} is required`);
  if (value.length > max) throw new ChatStoreError(`${field} is too long`);
  return value;
}

function optionalString(value, field, max = 4000) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new ChatStoreError(`${field} must be a string`);
  if (value.length > max) throw new ChatStoreError(`${field} is too long`);
  return value;
}

function normalizeScopeKey(value) {
  const scopeKey = requireString(value, 'scopeKey', MAX_SCOPE_KEY_LENGTH);
  if (scopeKey.includes('\0')) throw new ChatStoreError('scopeKey contains an illegal character');
  return scopeKey;
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

function laterOf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

function earlierOf(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return Date.parse(b) < Date.parse(a) ? b : a;
}

/* 路径边界。这是本文件唯一允许把字符串拼成文件路径的地方，且只允许拼在
 * root 之下：relative 必须是 root 的真子路径，不能是 '..'，不能被解析成盘符
 * 或绝对路径。任何一条不满足都抛错而不是"取个近似值"。 */
function assertInsideRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  const escaped = !relative
    || relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  if (escaped) throw new ChatStoreError('session path escaped the chat store root', 400);
  return path.resolve(target);
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

/* 规范化 JSON：对象键按字典序递归排序，数组保持原序。
 * 用途只有一个——把"这次要施加的请求载荷"折成一个稳定哈希。键序不同、JSON
 * 文本不同都必须是同一个 operationId，否则一次重试会被误判成"同 ID 不同请求"
 * 而拒绝执行（那会把幂等保护变成拒绝服务）。 */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function operationRequestSha256(request) {
  return sha256Hex(canonicalJson(request));
}

/* 单个会话文件的解析。
 *
 * 容错只有一条：最后一行若解析不了就丢掉（断电正在写的末行）。这一条不能扩大
 * 到"跳过看不懂的行"——那会把一次真实的数据损坏伪装成一次正常的旧格式读取，
 * 用户要等到几个月后才发现历史少了一段。
 *
 * 除了这条容错，读路径一律 fail-closed：非法 JSON、非对象、缺会话头、以及确认
 * 事件的 kind / state 不在白名单内，全部响亮失败并带 file + line。 */
function parseSessionFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n');
  if (raw.endsWith('\n')) lines.pop();
  const events = [];
  const eventLines = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const isLastLine = index === lines.length - 1;
    if (!line.trim()) {
      if (isLastLine) continue;
      throw new ChatStoreError('chat session file is corrupt', 500, { file, line: index + 1 });
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      // 只有最后一行可以残缺。第 1 行残缺意味着连会话头都没有，必须报错，
      // 否则后面会把一个没有 sessionId 的文件当成空会话返回给 UI。
      if (isLastLine && index > 0) continue;
      throw new ChatStoreError('chat session file is corrupt', 500, { file, line: index + 1 });
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new ChatStoreError('chat session file is corrupt', 500, { file, line: index + 1 });
    }
    // 确认事件的 kind / state 白名单**读的时候也要查**（契约 §2.1）。
    //
    // 少了这一步就是一个已经裁过一次的分叉：同一份写着第 9 种 kind 的会话文件，
    // v2 的 parseSessionFile 判它损坏，部署版却照常读出来、把那个 kind 原样放进
    // derived confirmations——两个前端对同一份文件给出相反结论，而"一个被产品
    // 禁止的状态在文件里可表达、又被静默当成合法读进来"正是这套东西要消灭的
    // 失败模式（与 `failed → claimed` 的那次裁定同一条理由）。
    //
    // 写路径的 400（normalizeConfirmation）不变；这里管的是"别人、旧版本或手工
    // 编辑已经写在磁盘上的那一份"。措辞与 v2 的 assertConfirmationKind /
    // assertConfirmationState 逐字对齐（都带具体值），两边互相认得；行号只在解析
    // 阶段拿得到，所以一并挂在 details 上。
    if (event.type === 'confirmation') {
      const kind = String(event.kind ?? '');
      if (!CONFIRMATION_KINDS.has(kind)) {
        throw new ChatStoreError(`unsupported confirmation kind: ${JSON.stringify(kind)}`, 500,
          { file, line: index + 1, kind: event.kind ?? null });
      }
      const state = String(event.state ?? '');
      if (!CONFIRMATION_STATES.has(state)) {
        throw new ChatStoreError(`unsupported confirmation state: ${JSON.stringify(state)}`, 500,
          { file, line: index + 1, state: event.state ?? null });
      }
    }
    if (typeof event.eventId === 'string') eventLines.set(event.eventId, index + 1);
    events.push(event);
  }
  if (!events.length || events[0].type !== 'session') {
    throw new ChatStoreError('chat session file is corrupt', 500, { file, line: 1 });
  }
  // eventId -> 行号：确认事件归并出错时要能指出是哪一行（§4.2 里"带 file、line"
  // 的那条既有风格）。行号只在解析时才有，而归并会先按 at 排序，所以做成查表函数。
  const lineOf = (event) => (typeof event?.eventId === 'string' ? eventLines.get(event.eventId) ?? null : null);
  return { header: events[0], events: events.slice(1), lineOf };
}

/* 确认事件的归并（契约 §2.1 规则 5）。
 *
 * 为什么必须由存储层算，而不是让 shell 自己记：`actionsState` 这类字段是防重复
 * 执行的唯一防线。它们只要还活在内存里，刷新一次就没了，已确认的卡片会重新变成
 * pending，再点一次就是对 Research/Experiments/*.md 的第二次真实写入。
 *
 * 归并顺序：按 at 升序、同 at 按文件顺序（与 v2 的 model.ts 逐条一致）。
 * 合法迁移只有 CONFIRMATION_TRANSITIONS 那几条，其余一律**响亮失败**（读的时候
 * 500，写的时候 400）：
 *   - 任何终态（confirmed / failed / abandoned）都没有出边：终态之后再来 claimed
 *     就是"把一张已经结束的卡片复活"，等于让 UI 的任何 bug 都能重新派发一次结果
 *     未知的投递；
 *   - `failed → claimed` 尤其要挡住：§2.1 规则 3 的重试指的是**新卡片**
 *     （新 messageId、新 operationId、从 pending 重新开始），同一张卡上 failed
 *     就是终态；
 *   - claimed 只有两个出口 confirmed / failed。claimed → abandoned 不在表里：
 *     claimed 落盘之后紧接着就是投递，这一刻没人知道写入有没有发出去，标成
 *     abandoned 等于替研究员断言"什么都没发生"，而账本里可能已经有这次执行了。
 *
 * 这条表不是本文件的发明：它与 D:\scholarium-v2-source\srceatures\chat\model.ts
 * 的 CONFIRMATION_TRANSITIONS 必须逐字一致——两个前端对同一份会话文件给出不同
 * 结论（一个说能派发、一个说损坏）正是这套东西要消灭的失败模式。 */
const CONFIRMATION_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['pending', 'claimed', 'abandoned']),
  claimed: Object.freeze(['confirmed', 'failed']),
  confirmed: Object.freeze([]),
  failed: Object.freeze([]),
  abandoned: Object.freeze([]),
});

function canTransitionConfirmation(from, to) {
  return (CONFIRMATION_TRANSITIONS[from] || []).includes(to);
}

/* 状态机的一步，或者一次响亮失败。之所以要"响亮"：一份写着"已确认、然后又被
 * 重新认领"的会话文件不是一个历史有点奇怪的文件，而是一份被宽松读取就会第二次
 * 写盘的文什——那正是这套东西存在的理由。 */
function applyConfirmation(previous, event, context) {
  const from = previous?.state || 'pending';
  const reject = (why, extra = {}) => {
    throw new ChatStoreError(
      `confirmation state is corrupt: ${why}`,
      500,
      {
        file: context.file ?? null,
        line: context.line ?? null,
        messageId: event.messageId,
        kind: event.kind,
        from,
        to: event.state,
        eventId: event.eventId,
        ...extra,
      },
    );
  };
  if (!canTransitionConfirmation(from, event.state)) {
    reject(`this card cannot go ${from} → ${event.state}`);
  }
  // 结算必须复用 claimed 的那一个 operationId：结算时另铸一个会让同一份文件在
  // v2 里变成"终态 id 与 claimed id 不一致"的损坏文件。
  if (from === 'claimed' && (event.state === 'confirmed' || event.state === 'failed')
    && event.operationId !== previous?.operationId) {
    reject(`a ${event.state} must carry the claimed operationId ${JSON.stringify(previous?.operationId ?? null)}, not ${JSON.stringify(event.operationId ?? null)}`);
  }
  return event;
}

function mergeConfirmations(events, context = {}) {
  const lineOf = typeof context.lineOf === 'function' ? context.lineOf : null;
  // 同一个 eventId 重复追加是幂等重放（写请求可能重试过），不是状态变更。
  const seenEventIds = new Set();
  const unique = [];
  for (const event of events) {
    if (!event || event.type !== 'confirmation') continue;
    if (typeof event.eventId === 'string') {
      if (seenEventIds.has(event.eventId)) continue;
      seenEventIds.add(event.eventId);
    }
    unique.push(event);
  }
  const ordered = unique
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (Date.parse(a.event.at || 0) - Date.parse(b.event.at || 0)) || (a.index - b.index))
    .map((item) => item.event);
  const merged = new Map();
  for (const event of ordered) {
    const key = `${event.messageId} ${event.kind}`;
    const context2 = { file: context.file ?? null, line: lineOf ? lineOf(event) : null };
    merged.set(key, applyConfirmation(merged.get(key), event, context2));
  }
  return merged;
}

/* 把归并结果挂回消息（契约 §2.1 规则 6）：confirmationStates 与 actionsState /
 * draftsState / legacyNoteEditsState 从此都是派生值，渲染只读它们，不再拿内存
 * 里的对象当真相。旧字段只在真的有事件时才写，免得把历史消息伪装成"有状态"。 */
const LEGACY_CONFIRMATION_FIELD = {
  action: 'actionsState',
  draft: 'draftsState',
  legacyNoteEdit: 'legacyNoteEditsState',
};

function deriveConfirmationPayload(payload, messageId, merged) {
  const confirmations = {};
  for (const [key, event] of merged) {
    const separator = key.indexOf(' ');
    if (separator < 0 || key.slice(0, separator) !== messageId) continue;
    confirmations[key.slice(separator + 1)] = {
      state: event.state, operationId: event.operationId || null, detail: event.detail ?? null, at: event.at,
    };
  }
  if (!Object.keys(confirmations).length) return payload;
  const derived = { ...(payload || {}), confirmations };
  derived.confirmationStates = { ...(payload?.confirmationStates || {}) };
  for (const [kind, entry] of Object.entries(confirmations)) {
    derived.confirmationStates[kind] = entry.state;
    const legacyField = LEGACY_CONFIRMATION_FIELD[kind];
    if (legacyField) derived[legacyField] = entry.state;
  }
  return derived;
}

function summarize(header, events) {
  let archived = false;
  let title = typeof header.title === 'string' ? header.title : '未命名课题';
  let updatedAt = header.createdAt || null;
  let firstAt = null;
  let lastAt = null;
  let messageCount = 0;
  for (const event of events) {
    if (event.type === 'state') {
      if (typeof event.archived === 'boolean') archived = event.archived;
      if (typeof event.title === 'string' && event.title) title = event.title;
      updatedAt = laterOf(updatedAt, event.at);
    } else if (event.type === 'message') {
      messageCount += 1;
      firstAt = earlierOf(firstAt, event.at);
      lastAt = laterOf(lastAt, event.at);
      updatedAt = laterOf(updatedAt, event.at);
    }
  }
  return {
    sessionId: header.sessionId,
    scopeKey: header.scopeKey,
    topicId: header.topicId ?? null,
    projectId: header.projectId ?? null,
    title,
    createdAt: header.createdAt || null,
    updatedAt,
    messageCount,
    archived,
    firstAt,
    lastAt,
  };
}

function publicSummary(summary, store) {
  return {
    sessionId: summary.sessionId,
    scopeKey: summary.scopeKey,
    topicId: summary.topicId,
    projectId: summary.projectId,
    title: summary.title,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
    messageCount: summary.messageCount,
    archived: summary.archived,
    firstAt: summary.firstAt,
    lastAt: summary.lastAt,
  };
}

/* 导入消息的去重键。契约指定了字段顺序与截断长度；两边（预览与提交）必须一致，
 * 否则预览说"12 条新增"、提交却写进去 11 条，用户无从核对。 */
function importDuplicateKey(sourceKey, message) {
  return sha256Hex(`${sourceKey}|${message.role}|${message.at}|${message.text}`).slice(0, 32);
}

function sortKeyCompare(a, b) {
  return String(a).localeCompare(String(b));
}

/* 预览内容的指纹（契约 §4.3.1）。只由候选内容本身决定——不含时间戳、请求顺序
 * 或随机量，所以同一条"旧版对话"反复预览永远得到同一个 fingerprint。commit 时
 * 客户端要把预览拿到的这串原样回传，两边不一致就说明预览之后候选内容变过。 */
function importFingerprint(plan) {
  const normalized = plan.map((item) => ({
    scopeKey: item.scopeKey,
    title: item.title,
    sourceKey: item.sourceKey,
    sourceSha256: item.sourceSha256,
    messages: item.messages
      .map((message) => ({ role: message.role, at: message.at, text: message.text }))
      .sort((a, b) => sortKeyCompare(a.role, b.role) || sortKeyCompare(a.at, b.at) || sortKeyCompare(a.text, b.text)),
  })).sort((a, b) => sortKeyCompare(a.scopeKey, b.scopeKey)
    || sortKeyCompare(a.title, b.title)
    || sortKeyCompare(a.sourceKey, b.sourceKey)
    || sortKeyCompare(a.sourceSha256 || '', b.sourceSha256 || ''));
  return sha256Hex(JSON.stringify(normalized)).slice(0, 32);
}

class ChatStore {
  constructor(vaultRoot) {
    if (!vaultRoot) throw new ChatStoreError('chat store requires a vault root');
    this.vaultRoot = path.resolve(vaultRoot);
    this.root = path.join(this.vaultRoot, ...STORE_DIR_SEGMENTS);
    this.indexCache = null;
  }

  fileFor(scopeKey, sessionId) {
    return assertInsideRoot(this.root, path.join(this.root, scopeHash(scopeKey), `${sessionId}.jsonl`));
  }

  relativeFile(target) {
    return path.relative(this.root, target).split(path.sep).join('/');
  }

  ensureRoot(file = null) {
    fs.mkdirSync(this.root, { recursive: true });
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  /* 只认 root 下 24 位十六进制目录名里的 <sessionId>.jsonl。目录扫描是权威来源：
   * index.json 只是缓存，缺了、坏了或者落后于磁盘都不能影响"会话是否读得到"。 */
  scanFiles() {
    if (!fs.existsSync(this.root)) return [];
    const found = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !SCOPE_HASH_RE.test(entry.name)) continue;
      const dir = path.join(this.root, entry.name);
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.slice(0, -'.jsonl'.length);
        if (!SESSION_ID_RE.test(sessionId)) continue;
        found.push({ sessionId, scopeHash: entry.name, file: path.join(dir, file) });
      }
    }
    return found.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  }

  findSession(sessionId) {
    // 形状不对的 id 直接响亮失败而不是"找不到"：它只可能来自路径拼接错误或
    // 一次想读到别的目录去的请求，两者都不该被 404 掩盖成"会话不存在"。
    if (!SESSION_ID_RE.test(String(sessionId || ''))) {
      throw new ChatStoreError('session path escaped the chat store root', 400);
    }
    const cached = this.indexCache?.sessions?.find((session) => session.sessionId === sessionId);
    if (cached && SCOPE_HASH_RE.test(cached.scopeHash || '') && fs.existsSync(path.join(this.root, cached.scopeHash, `${sessionId}.jsonl`))) {
      return { sessionId, scopeHash: cached.scopeHash, file: this.fileFor(cached.scopeKey, sessionId) };
    }
    return this.scanFiles().find((item) => item.sessionId === sessionId) || null;
  }

  loadSession(sessionId) {
    const found = this.findSession(sessionId);
    if (!found) return null;
    const { header, events, lineOf } = parseSessionFile(found.file);
    if (header.sessionId !== sessionId) {
      throw new ChatStoreError('chat session file is corrupt', 500, { file: found.file, line: 1 });
    }
    return { ...found, header, events, lineOf, summary: summarize(header, events) };
  }

  /* index.json：可重建缓存。读不出来就当作没有，绝不让一次缓存损坏变成一次
   * "会话不存在"。 */
  loadIndex() {
    if (this.indexCache) return this.indexCache;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(this.root, INDEX_FILENAME), 'utf8'));
      if (parsed && parsed.schema === SCHEMA && Array.isArray(parsed.sessions)) this.indexCache = parsed;
    } catch { /* 缺失或损坏：下面按磁盘重建 */ }
    return this.indexCache;
  }

  writeIndex(sessions, { force = false } = {}) {
    this.ensureRoot();
    const file = path.join(this.root, INDEX_FILENAME);
    // 列表是 GET，内容没变就不落盘：每次读都把 mtime 推进会让任何"Vault 有没有
    // 被改过"的判断永远为真。?rebuild=1 走 force 分支，明确要求重写一次。
    const body = JSON.stringify(sessions);
    // 内存内容和磁盘一致、且文件确实还在，才跳过写入。
    if (!force && this.indexCache && JSON.stringify(this.indexCache.sessions) === body && fs.existsSync(file)) return this.indexCache;
    const index = {
      schema: SCHEMA,
      version: 1,
      generatedAt: new Date().toISOString(),
      sessions,
    };
    fs.writeFileSync(file, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    this.indexCache = index;
    return index;
  }

  indexEntries() {
    return this.scanFiles().map((found) => {
      const { header, events } = parseSessionFile(found.file);
      const summary = summarize(header, events);
      return {
        ...summary,
        scopeHash: found.scopeHash,
        file: this.relativeFile(found.file),
      };
    });
  }

  rebuildIndex() {
    return this.writeIndex(this.indexEntries());
  }

  listSessions({ scopeKey, includeArchived = false, rebuild = false } = {}) {
    const wanted = scopeKey ? String(scopeKey) : null;
    // 磁盘是权威，索引是派生：列表按磁盘重算再对齐缓存，这样别的进程（或用户
    // 手工删过文件）改过磁盘也不会让列表停在旧快照上。索引缺失/损坏在这里只是
    // 一次多余的重建，绝不表现为"会话不见了"。rebuild=1 额外要求把缓存重写一次。
    const entries = this.indexEntries();
    this.writeIndex(entries, { force: Boolean(rebuild) });
    return entries
      .filter((entry) => (!wanted || entry.scopeKey === wanted) && (includeArchived || !entry.archived))
      .sort((a, b) => (Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)))
      .map((entry) => publicSummary(entry, this));
  }

  createSession(input = {}) {
    const scopeKey = normalizeScopeKey(input.scopeKey);
    const sessionId = input.sessionId === undefined || input.sessionId === null
      ? newSessionId()
      : requireString(input.sessionId, 'sessionId', 64);
    if (!SESSION_ID_RE.test(sessionId)) throw new ChatStoreError('sessionId must match ^s-[a-z0-9]{4,16}-[0-9a-f]{8}$');
    const topicId = optionalString(input.topicId, 'topicId', MAX_SCOPE_KEY_LENGTH)
      ?? (scopeKey.includes(':') ? scopeKey.slice(scopeKey.indexOf(':') + 1) : scopeKey);
    const projectId = optionalString(input.projectId, 'projectId', MAX_SCOPE_KEY_LENGTH);
    const title = optionalString(input.title, 'title', 200) || '未命名课题';

    const existing = this.findSession(sessionId);
    if (existing) {
      const loaded = this.loadSession(sessionId);
      return { session: publicSummary(loaded.summary, this), created: false };
    }

    const file = this.fileFor(scopeKey, sessionId);
    this.ensureRoot(file);
    const header = {
      v: 1,
      schema: SCHEMA,
      type: 'session',
      sessionId,
      scopeKey,
      topicId,
      projectId,
      title,
      createdAt: new Date().toISOString(),
    };
    try {
      // 'wx' 而不是"先查再写"：两个并发的创建请求里必须只有一个真的建文件，
      // 另一个走幂等分支返回既有会话，而不是互相覆盖。
      fs.writeFileSync(file, jsonLine(header), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const loaded = this.loadSession(sessionId);
      if (!loaded) throw error;
      return { session: publicSummary(loaded.summary, this), created: false };
    }
    const summary = summarize(header, []);
    this.upsertIndex(false, file, summary);
    return { session: publicSummary(summary, this), created: true };
  }

  upsertIndex(rebuild, file, summary) {
    const entries = rebuild
      ? this.indexEntries()
      : (this.loadIndex()?.sessions || []).filter((entry) => entry.sessionId !== summary.sessionId);
    if (!rebuild) {
      entries.push({ ...summary, scopeHash: scopeHash(summary.scopeKey), file: this.relativeFile(file) });
    }
    this.writeIndex(entries);
  }

  readSession(sessionId, { limit, before } = {}) {
    const loaded = this.loadSession(sessionId);
    if (!loaded) throw new ChatStoreError('session not found', 404);
    const messages = loaded.events.filter((event) => event.type === 'message');
    // 归并一遍确认事件：损坏的（终态被回退、锁定态被重投）在这里响亮失败，
    // 而不是把一张已经确认过的卡片悄悄渲染回 pending。
    const merged = mergeConfirmations(loaded.events, { file: loaded.file, lineOf: loaded.lineOf });
    const cap = clampLimit(limit);
    let end = messages.length;
    if (before) {
      const cursor = String(before);
      end = messages.findIndex((message) => message.messageId === cursor);
      if (end < 0) throw new ChatStoreError('unknown cursor messageId', 400);
    }
    const start = Math.max(0, end - cap);
    const page = messages.slice(start, end);
    const hasMore = start > 0;
    return {
      session: publicSummary(loaded.summary, this),
      messages: page.map((message) => ({
        ...message,
        payload: deriveConfirmationPayload(message.payload ?? null, message.messageId, merged),
      })),
      confirmations: [...merged.values()].map((event) => ({
        messageId: event.messageId, kind: event.kind, state: event.state,
        operationId: event.operationId || null, detail: event.detail ?? null, at: event.at,
      })),
      hasMore,
      nextCursor: hasMore && page.length ? page[0].messageId : null,
      total: messages.length,
    };
  }

  /* 追加确认事件（§2.1）。与消息一样是 append-only 幂等追加；区别是写入前还要
   * 校验状态机——把"confirmed 之后又 claimed"这种损坏挡在写入之前，而不是等
   * 读的时候才发现。 */
  normalizeConfirmation(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ChatStoreError('confirmation must be a JSON object');
    }
    const messageId = String(input.messageId || '');
    if (!MESSAGE_ID_RE.test(messageId)) throw new ChatStoreError('messageId must match ^m-[a-z0-9-]{6,40}$');
    const kind = String(input.kind || '');
    if (!CONFIRMATION_KINDS.has(kind)) throw new ChatStoreError('unsupported confirmation kind');
    const state = String(input.state || '');
    if (!CONFIRMATION_STATES.has(state)) throw new ChatStoreError('unsupported confirmation state');
    let eventId = input.eventId;
    if (eventId === undefined || eventId === null || eventId === '') eventId = `evt-${Date.now().toString(36)}-${randomToken(4)}`;
    if (typeof eventId !== 'string' || !EVENT_ID_RE.test(eventId)) {
      throw new ChatStoreError('eventId must match ^evt-[a-z0-9-]{6,40}$');
    }
    // claimed 起必须有 operationId：没有它，账本里那条"正在执行"的记录就无从
    // 对应，崩溃窗口也就无从人工核对。
    const needsOperation = state === 'claimed' || state === 'confirmed' || state === 'failed';
    const operationId = input.operationId === undefined || input.operationId === null || input.operationId === ''
      ? null
      : String(input.operationId);
    if (needsOperation && !operationId) throw new ChatStoreError('operationId is required from claimed onward');
    if (operationId !== null && !OPERATION_ID_RE.test(operationId)) {
      throw new ChatStoreError('operationId must match ^op-[a-z0-9-]{6,40}$');
    }
    const at = optionalString(input.at, 'at', 64) || new Date().toISOString();
    if (Number.isNaN(Date.parse(at))) throw new ChatStoreError('confirmation at must be an ISO timestamp');
    const detail = input.detail === undefined ? null : input.detail;
    if (detail !== null && (typeof detail !== 'object' || Array.isArray(detail))) {
      throw new ChatStoreError('confirmation detail must be a JSON object or null');
    }
    return { type: 'confirmation', eventId, messageId, kind, state, operationId, detail, at };
  }

  appendConfirmations(sessionId, inputs) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (!list.length) throw new ChatStoreError('no confirmations to append');
    const loaded = this.loadSession(sessionId);
    if (!loaded) throw new ChatStoreError('session not found', 404);
    const seen = new Set(loaded.events.filter((event) => event.type === 'confirmation').map((event) => event.eventId));
    const appended = [];
    const duplicates = [];
    const stored = [];
    for (const input of list) {
      const event = this.normalizeConfirmation(input);
      if (seen.has(event.eventId)) { duplicates.push(event.eventId); continue; }
      // 写入前先套一遍状态机：这一步必须在 append 之前，否则损坏已经落盘了。
      // 读取时同类损坏是 500（文件坏了）；这里是 400——文件没坏，是这次请求本身
      // 会把它写坏，所以拒收并让调用方重新走一次新的确认。
      try {
        mergeConfirmations([...loaded.events, ...stored, event], { file: loaded.file, lineOf: loaded.lineOf });
      } catch (error) {
        throw new ChatStoreError(error.message, 400, error.details);
      }
      seen.add(event.eventId);
      appended.push(event.eventId);
      stored.push(event);
    }
    if (stored.length) {
      this.ensureRoot(loaded.file);
      fs.appendFileSync(loaded.file, stored.map(jsonLine).join(''), 'utf8');
      this.upsertIndex(false, loaded.file, summarize(loaded.header, [...loaded.events, ...stored]));
    }
    const merged = mergeConfirmations([...loaded.events, ...stored], { file: loaded.file, lineOf: loaded.lineOf });
    return {
      ok: true,
      appended,
      duplicates,
      total: loaded.events.filter((event) => event.type === 'confirmation').length + stored.length,
      confirmations: stored.map((event) => ({
        messageId: event.messageId, kind: event.kind, state: event.state,
        operationId: event.operationId, detail: event.detail, at: event.at,
      })),
      states: Object.fromEntries(stored.map((event) => [`${event.messageId} ${event.kind}`, merged.get(`${event.messageId} ${event.kind}`)?.state || null])),
    };
  }

  /* 单条消息的规范化。存储层不理解 payload 的内容（确认卡、协议审计都在里面），
   * 只要求它是个 JSON 对象——裁剪 payload 等于静默改变历史。 */
  normalizeMessage(input, { allowGeneratedId = true } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ChatStoreError('message must be a JSON object');
    }
    const role = String(input.role || '');
    if (!ROLES.has(role)) throw new ChatStoreError('unsupported role');
    if (typeof input.text !== 'string') throw new ChatStoreError('message text must be a string');
    const at = optionalString(input.at, 'at', 64) || new Date().toISOString();
    if (Number.isNaN(Date.parse(at))) throw new ChatStoreError('message at must be an ISO timestamp');
    let messageId = input.messageId;
    if (messageId === undefined || messageId === null || messageId === '') {
      if (!allowGeneratedId) throw new ChatStoreError('messageId is required');
      messageId = newMessageId();
    }
    if (typeof messageId !== 'string' || !MESSAGE_ID_RE.test(messageId)) {
      throw new ChatStoreError('messageId must match ^m-[a-z0-9-]{6,40}$');
    }
    const payload = input.payload === undefined ? null : input.payload;
    if (payload !== null && (typeof payload !== 'object' || Array.isArray(payload))) {
      throw new ChatStoreError('message payload must be a JSON object or null');
    }
    return {
      type: 'message',
      messageId,
      role,
      text: input.text,
      at,
      taskId: optionalString(input.taskId, 'taskId', 200),
      provider: optionalString(input.provider, 'provider', 200),
      payload,
    };
  }

  appendMessages(sessionId, inputs) {
    const list = Array.isArray(inputs) ? inputs : [inputs];
    if (!list.length) throw new ChatStoreError('no messages to append');
    if (list.length > MAX_MESSAGES_PER_REQUEST) throw new ChatStoreError(`at most ${MAX_MESSAGES_PER_REQUEST} messages per request`);
    const loaded = this.loadSession(sessionId);
    if (!loaded) throw new ChatStoreError('session not found', 404);
    const seen = new Set(loaded.events.filter((event) => event.type === 'message').map((event) => event.messageId));
    const appended = [];
    const duplicates = [];
    const stored = [];
    const lines = [];
    for (const input of list) {
      const message = this.normalizeMessage(input);
      // 幂等：同一个会话里重复出现的 messageId 是空操作。用"已存在的集合 + 本批
      // 已排队的集合"一起判，同一批里自己重复的那几条也只留第一条。
      if (seen.has(message.messageId)) { duplicates.push(message.messageId); continue; }
      seen.add(message.messageId);
      appended.push(message.messageId);
      stored.push(message);
      lines.push(jsonLine(message));
    }
    if (lines.length) {
      // 单次 appendFileSync 只写一行的量级：要么整批都在，要么（断电时）只有
      // 最后一行残缺——读取端的末行容错正好覆盖这一种损失。
      this.ensureRoot(loaded.file);
      fs.appendFileSync(loaded.file, lines.join(''), 'utf8');
      const summary = summarize(loaded.header, [...loaded.events, ...stored]);
      this.upsertIndex(false, loaded.file, summary);
    }
    const total = loaded.summary.messageCount + appended.length;
    return { ok: true, appended, duplicates, total };
  }

  patchSession(sessionId, input = {}) {
    const loaded = this.loadSession(sessionId);
    if (!loaded) throw new ChatStoreError('session not found', 404);
    const keys = Object.keys(input || {}).filter((key) => input[key] !== undefined);
    const unknown = keys.filter((key) => key !== 'title' && key !== 'archived');
    if (unknown.length) throw new ChatStoreError(`unsupported field: ${unknown.join(', ')}`);
    if (!keys.length) throw new ChatStoreError('title or archived is required');
    const events = [];
    const at = new Date().toISOString();
    if (input.title !== undefined) {
      const title = requireString(input.title, 'title', 200);
      events.push({ type: 'state', at, title });
    }
    if (input.archived !== undefined) {
      if (typeof input.archived !== 'boolean') throw new ChatStoreError('archived must be a boolean');
      events.push({ type: 'state', at, archived: input.archived });
    }
    // 归档只追加状态事件。正文行一个字节都不动——"归档"必须随时可以撤销，
    // 且断电也不能让一段历史消失。
    fs.appendFileSync(loaded.file, events.map(jsonLine).join(''), 'utf8');
    const summary = summarize(loaded.header, [...loaded.events, ...events]);
    this.upsertIndex(false, loaded.file, summary);
    return { session: publicSummary(summary, this) };
  }

  /* -------------------------------------------------- 执行幂等账本 -- *
   * 契约 §2.2。只落盘 `claimed` 还不够：claimed 落盘之后、真实写入之前的崩溃
   * 仍然是已知窗口。所以执行端要按 operationId 幂等——同一次确认重复到达时，
   * 要么返回上一次的原结果（replayed），要么明确拒绝（claimed / 换请求），
   * 总之不许再写第二次。
   *
   * 账本在 store 根下（不按 scope 分目录）：一次确认可能跨会话、跨课题，而它
   * 的幂等性只跟 operationId 有关。 */
  operationsPath() {
    return path.join(this.root, OPERATIONS_FILENAME);
  }

  readOperationEvents() {
    const file = this.operationsPath();
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n');
    if (raw.endsWith('\n')) lines.pop();
    const events = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const isLastLine = index === lines.length - 1;
      if (!line.trim()) { if (isLastLine) continue; throw new ChatStoreError('chat operations ledger is corrupt', 500, { file, line: index + 1 }); }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // 与正文同一条容错规则：只容忍正在写的末行。
        if (isLastLine && index > 0) continue;
        throw new ChatStoreError('chat operations ledger is corrupt', 500, { file, line: index + 1 });
      }
      if (!event || typeof event !== 'object' || event.type !== 'operation' || !OPERATION_ID_RE.test(String(event.operationId || '')) || !OPERATION_STATUSES.has(String(event.status || ''))) {
        throw new ChatStoreError('chat operations ledger is corrupt', 500, { file, line: index + 1 });
      }
      events.push(event);
    }
    return events;
  }

  operationRecords() {
    const records = new Map();
    for (const event of this.readOperationEvents()) {
      const previous = records.get(event.operationId);
      records.set(event.operationId, {
        operationId: event.operationId,
        kind: event.kind ?? previous?.kind ?? null,
        messageId: event.messageId ?? previous?.messageId ?? null,
        status: event.status,
        requestSha256: event.requestSha256 || previous?.requestSha256 || null,
        result: event.result ?? previous?.result ?? null,
        error: event.error ?? previous?.error ?? null,
        at: event.at || previous?.at || null,
        history: (previous?.history || 0) + 1,
      });
    }
    return records;
  }

  readOperation(operationId) {
    return this.operationRecords().get(String(operationId)) || null;
  }

  appendOperation(event) {
    this.ensureRoot();
    const record = {
      type: 'operation',
      operationId: event.operationId,
      kind: event.kind ?? null,
      messageId: event.messageId ?? null,
      status: event.status,
      requestSha256: event.requestSha256 ?? null,
      result: event.result ?? null,
      error: event.error ?? null,
      at: event.at || new Date().toISOString(),
    };
    fs.appendFileSync(this.operationsPath(), jsonLine(record), 'utf8');
    return record;
  }

  requireOperationId(operationId, requestSha256) {
    const id = String(operationId || '');
    if (!OPERATION_ID_RE.test(id)) throw new ChatStoreError('operationId must match ^op-[a-z0-9-]{6,40}$');
    const sha = String(requestSha256 || '');
    if (!SHA256_RE.test(sha)) throw new ChatStoreError('requestSha256 must be a 64-character lowercase hex digest');
    return { id, sha };
  }

  /* 交付 §2.2 那张表：无记录 → claim 后执行；终态同 sha → 不写任何文件、原结果
   * 重放；claimed 同 sha → 409（崩溃窗口，人工核对）；同 ID 不同 sha → 409。 */
  beginOperation({ operationId, kind = null, messageId = null, requestSha256 }) {
    const { id, sha } = this.requireOperationId(operationId, requestSha256);
    const record = this.readOperation(id);
    if (!record) {
      this.appendOperation({ operationId: id, kind, messageId, status: 'claimed', requestSha256: sha });
      return { proceed: true, operationId: id, status: 'claimed' };
    }
    if (record.requestSha256 !== sha) {
      throw new ChatStoreError('operation id reused with a different request', 409, { operationId: id });
    }
    if (record.status === 'claimed') {
      throw new ChatStoreError('operation already claimed', 409, { operationId: id, at: record.at });
    }
    return {
      proceed: false, replayed: true, operationId: id, status: record.status,
      result: record.result, error: record.error, at: record.at,
    };
  }

  finishOperation({ operationId, status, result = null, error = null }) {
    if (status !== 'confirmed' && status !== 'failed') throw new ChatStoreError('operation status must be confirmed or failed');
    const { id } = this.requireOperationId(operationId, '0'.repeat(64));
    const record = this.readOperation(id);
    if (!record) throw new ChatStoreError('operation not found', 404, { operationId: id });
    // 已经是终态就不再追加：一次执行只能有一个结果，重复 finish 只可能是
    // 调用方重放，不该在账本里留下两条互相矛盾的终态。
    if (record.status !== 'claimed') return record;
    return this.appendOperation({
      operationId: id, kind: record.kind, messageId: record.messageId,
      status, requestSha256: record.requestSha256, result, error,
    });
  }

  resolveOperation({ operationId, outcome, detail = null }) {
    const { id } = this.requireOperationId(operationId, '0'.repeat(64));
    if (outcome !== 'confirmed' && outcome !== 'failed') {
      throw new ChatStoreError('outcome must be confirmed or failed');
    }
    const record = this.readOperation(id);
    if (!record) throw new ChatStoreError('operation not found', 404, { operationId: id });
    if (record.status !== 'claimed') return { operation: record, resolved: false, replayed: true };
    const updated = this.appendOperation({
      operationId: id, kind: record.kind, messageId: record.messageId, status: outcome,
      requestSha256: record.requestSha256,
      result: outcome === 'confirmed' ? (detail ?? null) : record.result,
      error: outcome === 'failed' ? (detail?.reason ? String(detail.reason) : 'marked failed by researcher') : null,
    });
    return { operation: { ...record, status: updated.status, result: updated.result, error: updated.error, at: updated.at }, resolved: true };
  }

  /* ------------------------------------------------------------ 导入 --
   * 旧数据的来源（LevelDB / 旧 Markdown / 旧 localStorage 键）一律只读：
   * 这里拿到的只是调用方已经解析好的消息数组，本模块既不打开也不改写来源。
   * commit 只创建新会话，绝不合并进或覆盖既有会话。
   */
  previewImport(items) {
    if (!Array.isArray(items) || !items.length) throw new ChatStoreError('items must be a non-empty array');
    const seen = new Set();
    const total = { messages: 0, duplicates: 0 };
    const plan = items.map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ChatStoreError(`items[${index}] must be a JSON object`);
      const scopeKey = normalizeScopeKey(raw.scopeKey);
      const sourceKey = optionalString(raw.sourceKey, 'sourceKey', 200) || '';
      const sourceSha256 = raw.sourceSha256 === undefined || raw.sourceSha256 === null ? null : String(raw.sourceSha256);
      if (sourceSha256 !== null && !SHA256_RE.test(sourceSha256)) {
        throw new ChatStoreError('sourceSha256 must be a 64-character lowercase hex digest');
      }
      const messages = Array.isArray(raw.messages) ? raw.messages : [];
      const keep = [];
      const normalizedMessages = [];
      let duplicateCount = 0;
      for (const candidate of messages) {
        const role = String(candidate?.role || '');
        if (!ROLES.has(role)) throw new ChatStoreError('unsupported role');
        if (typeof candidate?.text !== 'string') throw new ChatStoreError('message text must be a string');
        const at = optionalString(candidate.at, 'at', 64) || new Date().toISOString();
        const message = { role, text: candidate.text, at };
        normalizedMessages.push(message);
        const key = importDuplicateKey(sourceKey, message);
        if (seen.has(key)) { duplicateCount += 1; continue; }
        seen.add(key);
        keep.push({ ...message, messageId: `m-imp-${key}` });
      }
      total.messages += messages.length;
      total.duplicates += duplicateCount;
      return {
        index,
        scopeKey,
        topicId: optionalString(raw.topicId, 'topicId', MAX_SCOPE_KEY_LENGTH)
          ?? (scopeKey.includes(':') ? scopeKey.slice(scopeKey.indexOf(':') + 1) : scopeKey),
        projectId: optionalString(raw.projectId, 'projectId', MAX_SCOPE_KEY_LENGTH),
        title: optionalString(raw.title, 'title', 200) || '旧版对话',
        sourceOrigin: optionalString(raw.sourceOrigin, 'sourceOrigin', 300),
        sourcePath: optionalString(raw.sourcePath, 'sourcePath', 500),
        sourceKey,
        sourceSha256,
        messageCount: messages.length,
        duplicateCount,
        messages: normalizedMessages,
        keep,
      };
    });
    return {
      plan,
      items: plan.map((item) => ({
        index: item.index,
        scopeKey: item.scopeKey,
        title: item.title,
        count: item.keep.length,
        firstAt: item.keep[0]?.at || null,
        lastAt: item.keep[item.keep.length - 1]?.at || null,
        duplicateCount: item.duplicateCount,
      })),
      totalMessages: total.messages,
      duplicateMessages: total.duplicates,
    };
  }

  commitImport(plan, { confirm } = {}) {
    if (confirm !== true) throw new ChatStoreError('confirm: true is required to commit an import');
    const imported = [];
    const skipped = [];
    const manifestItems = [];
    let totalImportedMessages = 0;
    let totalSkippedMessages = 0;
    for (const item of plan) {
      if (!item.keep.length) {
        skipped.push({ index: item.index, scopeKey: item.scopeKey, title: item.title, reason: 'no messages to import' });
        totalSkippedMessages += item.messageCount;
        continue;
      }
      const created = this.createSession({
        scopeKey: item.scopeKey,
        topicId: item.topicId,
        projectId: item.projectId,
        title: item.title,
      });
      const sessionId = created.session.sessionId;
      this.appendMessages(sessionId, item.keep);
      const entry = {
        index: item.index,
        sessionId,
        scopeKey: item.scopeKey,
        title: created.session.title,
        count: item.keep.length,
        file: this.relativeFile(this.fileFor(item.scopeKey, sessionId)),
        sourceOrigin: item.sourceOrigin,
        sourcePath: item.sourcePath,
        sourceKey: item.sourceKey,
        sourceSha256: item.sourceSha256,
        firstAt: item.keep[0]?.at || null,
        lastAt: item.keep[item.keep.length - 1]?.at || null,
        duplicateCount: item.duplicateCount,
      };
      imported.push(entry);
      manifestItems.push(entry);
      totalImportedMessages += item.keep.length;
      totalSkippedMessages += item.duplicateCount;
    }
    return {
      imported,
      skipped,
      manifest: {
        schema: SCHEMA,
        version: 1,
        generatedAt: new Date().toISOString(),
        storeRoot: this.root,
        items: manifestItems,
        totalImportedMessages,
        totalSkippedMessages,
      },
    };
  }
}

/* 预览句柄：进程内存里的**一次性** ticket，TTL 10 分钟。
 *
 * 为什么要 ticket 而不是只认 token：Bridge token 只证明"调用方是本机 Bridge"，
 * 不证明"研究员看过这份候选清单"。一次人工确认必须对应一次写入，所以 ticket 在
 * commit 被调用的那一刻就被删掉，成功失败都不复用——重放一次 commit 请求不可能
 * 变成第二次导入。 */
const pendingImports = new Map();

function registerPreview(store, items) {
  for (const [ticket, entry] of pendingImports) {
    if (entry.expiresAt < Date.now()) pendingImports.delete(ticket);
  }
  const preview = store.previewImport(items);
  const ticket = `imp-${randomToken(12)}`;
  const fingerprint = importFingerprint(preview.plan);
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  pendingImports.set(ticket, { plan: preview.plan, root: store.root, fingerprint, expiresAt });
  return {
    ticket,
    fingerprint,
    items: preview.items,
    totalMessages: preview.totalMessages,
    duplicateMessages: preview.duplicateMessages,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

function commitPreview(store, input = {}) {
  const ticket = String(input.ticket || '');
  const entry = pendingImports.get(ticket);
  if (!entry || entry.root !== store.root) {
    throw new ChatStoreError('import ticket not found or expired', 404);
  }
  // 先消费再校验：任何走到这一步的调用（包括下面要拒绝的那些）都不能让同一张
  // ticket 再被用第二次。
  pendingImports.delete(ticket);
  if (entry.expiresAt < Date.now()) {
    throw new ChatStoreError('import ticket expired', 410);
  }
  if (input.confirm !== true) throw new ChatStoreError('confirm: true is required to commit an import');
  if (String(input.fingerprint || '') !== entry.fingerprint) {
    throw new ChatStoreError('preview fingerprint mismatch');
  }
  return store.commitImport(entry.plan, { confirm: true });
}

const stores = new Map();

function storeFor(vaultRoot) {
  const resolved = path.resolve(vaultRoot);
  if (!stores.has(resolved)) stores.set(resolved, new ChatStore(resolved));
  return stores.get(resolved);
}

// 仅供测试：清掉按根缓存的实例与内存预览句柄，避免用例之间互相看见对方的会话。
function resetStores() {
  stores.clear();
  pendingImports.clear();
}

module.exports = {
  ChatStore,
  ChatStoreError,
  SCHEMA,
  STORE_DIR_SEGMENTS,
  OPERATIONS_FILENAME,
  SESSION_ID_RE,
  MESSAGE_ID_RE,
  EVENT_ID_RE,
  OPERATION_ID_RE,
  CONFIRMATION_KINDS,
  CONFIRMATION_STATES,
  CONFIRMATION_TRANSITIONS,
  canTransitionConfirmation,
  OPERATION_STATUSES,
  canonicalJson,
  operationRequestSha256,
  mergeConfirmations,
  deriveConfirmationPayload,
  sha256Hex,
  ROLES,
  chatStoreRoot: (vaultRoot) => path.join(path.resolve(vaultRoot), ...STORE_DIR_SEGMENTS),
  scopeHash,
  storeFor,
  registerPreview,
  commitPreview,
  importFingerprint,
  importDuplicateKey,
  resetStores,
  summarize,
  parseSessionFile,
  assertInsideRoot,
};
