/* Shell wiring for the 织研者 operating-surface design.
 *
 * Deliberately additive: app.js and bridge-ui.js keep every DOM id they already
 * address, and this file only rearranges where their output surfaces. Two
 * behavioural changes: the run dialog no longer covers the workspace (steps and
 * results render in the right-hand tracker rail), and the chat view hosts a
 * real conversation with the agent via Bridge /v1/tasks. During pipeline runs,
 * the chat view shows a compact status card (not a 1:1 mirror); the right
 * tracker retains the full step-by-step with interactive controls.
 */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const VIEW_KEY = 'weaver.shell.view';
  const TRACKER_KEY = 'weaver.shell.tracker';
  const RUN_SUMMARY_COLLAPSED_KEY = 'weaver.shell.run-summary-collapsed';
  let runSummaryCollapsed = false;
  try { runSummaryCollapsed = localStorage.getItem(RUN_SUMMARY_COLLAPSED_KEY) === '1'; } catch { /* private mode */ }

  /* ------------------------------------------------------------ views -- */

  // The canvas view is retired (kept in the DOM, hidden, because app.js still
  // binds to its nodes); chat is the only live view. setView stays as a
  // compatibility shim for any lingering caller.
  const views = {
    chat: { tab: $('#viewChatTab'), pane: $('#chatView') }
  };

  function setView() {
    views.chat.pane?.classList.add('is-active');
    views.chat.tab?.classList.add('is-active');
    views.chat.tab?.setAttribute('aria-selected', 'true');
    try { localStorage.setItem(VIEW_KEY, 'chat'); } catch { /* private mode */ }
  }

  views.chat.tab?.addEventListener('click', () => setView());

  /* ---------------------------------------------------------- tracker -- */

  const trackerTabs = {
    steps: { tab: $('#trackerStepsTab'), pane: $('#trackerStepsPane') },
    evolution: { tab: $('#trackerEvoTab'), pane: $('#trackerEvoPane') },
    tree: { tab: $('#trackerTreeTab'), pane: $('#trackerTreePane') },
    ideas: { tab: $('#trackerIdeasTab'), pane: $('#trackerIdeasPane') },
    graph: { tab: $('#trackerGraphTab'), pane: $('#trackerGraphPane') }
  };

  function setTracker(name) {
    const target = trackerTabs[name] ? name : 'steps';
    Object.entries(trackerTabs).forEach(([key, item]) => {
      const active = key === target;
      item.pane?.classList.toggle('is-active', active);
      item.tab?.classList.toggle('is-active', active);
    });
    try { localStorage.setItem(TRACKER_KEY, target); } catch { /* private mode */ }
  }

  trackerTabs.steps.tab?.addEventListener('click', () => setTracker('steps'));
  trackerTabs.evolution.tab?.addEventListener('click', () => setTracker('evolution'));
  trackerTabs.tree.tab?.addEventListener('click', () => {
    setTracker('tree');
    // Lazy-load on first visit so the tab opens instantly afterwards.
    window.weaverIdeaTree?.ensureLoaded?.();
  });
  trackerTabs.ideas.tab?.addEventListener('click', () => {
    setTracker('ideas');
    window.weaverIdeaList?.ensureLoaded?.();
  });
  trackerTabs.graph.tab?.addEventListener('click', () => {
    setTracker('graph');
    window.weaverGraphList?.ensureLoaded?.();
  });

  /* The run dialog stays in the DOM for compatibility but never opens: its
   * children (#runTitle, #runSteps, #runResult) now live in the tracker rail,
   * so showing an empty modal would only hide the progress the user wants. */
  const runDialog = $('#runDialog');
  if (runDialog) {
    runDialog.showModal = () => { setTracker('steps'); };
    runDialog.show = () => { setTracker('steps'); };
    runDialog.close = () => {};
  }

  const runSteps = $('#runSteps');
  const runResult = $('#runResult');
  const runTitle = $('#runTitle');
  const trackerEmpty = $('#trackerEmpty');
  const progressBar = $('#runProgressBar');
  const progressText = $('#runProgressText');
  const trackerScroll = document.querySelector('.wv-tracker-scroll');

  function stepRows() {
    return runSteps ? [...runSteps.querySelectorAll('.run-step')] : [];
  }

  function refreshProgress() {
    const steps = stepRows();
    const total = steps.length;
    const done = steps.filter((step) => !step.classList.contains('pending')).length;
    if (progressBar) progressBar.style.width = total ? `${Math.round((done / total) * 100)}%` : '0';
    if (progressText) progressText.textContent = `${done} / ${total}`;
    const hasOutput = total > 0 || (runResult && !runResult.classList.contains('hidden'));
    if (trackerEmpty) trackerEmpty.hidden = hasOutput;
    if (hasOutput && trackerScroll) trackerScroll.scrollTop = trackerScroll.scrollHeight;
  }

  /* ------------------------------------------------- chat conversation -- */

  const narrative = $('#chatNarrative');
  const chatInput = $('#chatInput');
  const chatSend = $('#chatSend');
  // Each research topic (workflow) owns its own conversation. Storage keys are
  // scoped by flow id; the legacy unscoped key migrates onto the flow active at
  // first load after this change, so no existing history is lost.
  const CHAT_STORE_LEGACY = 'weaver.shell.chat';
  // Archive-only, never auto-merged into a topic: an earlier version of this
  // migration wrote the legacy blob straight into whichever topic happened to
  // be open at first load, silently attaching days of unrelated cross-topic
  // history to that topic with no way to tell it apart afterwards (see
  // bridge-control-plane-status.md, "追加二十" — the researcher had to dig it
  // out of localStorage by hand). Any one-time migration with a side effect
  // like this must not run silently: archive first, surface a visible notice
  // in whichever topic is open, and let the researcher decide what to do with
  // it, rather than guessing which topic it "belongs" to.
  const CHAT_STORE_LEGACY_ARCHIVE = 'weaver.shell.chat.legacy-archived';
  // 正文本身一律在 Vault 的 Scholarium/Chat/v1/ 里，localStorage 只剩这一件
  // 事：记住每个课题当前打开的是哪个会话。此前整段对话正文都存在
  // `weaver.shell.chat.<flowId>` 里，而 canvas 端口每次启动都可能不同——不同
  // 端口就是不同 Origin，于是"上次的对话"在换端口后变成一片空白存储。这个键
  // 现在只读不写，也绝不删除：旧值留给恢复工具，见 docs/plans/chat-persistence-contract.md §5。
  const CHAT_ACTIVE_SESSION_KEY = 'weaver.shell.chat.activeSessionId';
  const CHAT_PAGE_SIZE = 50;   // 首屏条数；更早的靠"加载更早"翻，绝不截断磁盘数据
  let chatFlowId = window.researchWeaver?.activeFlowId || 'default';
  let chatMessages = [];   // 渲染源：内存里已载入的这段历史（不再写 localStorage）
  let chatBusy = false;     // true while waiting for agent reply
  let chatHasMore = false;  // 还有更早的消息没载入
  let chatNextCursor = null;
  let chatTotal = 0;
  let chatStorageError = '';    // 非空 = 正文存储不可用；对话区必须说出来，不许假装已保存
  let chatStorageBusy = true;   // 首次读取完成前不允许发送

  function newChatMessageId() {
    return `m-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  }
  function readActiveSessionMap() {
    try { return JSON.parse(localStorage.getItem(CHAT_ACTIVE_SESSION_KEY) || '{}') || {}; } catch { return {}; }
  }
  function rememberActiveSession(flowId, sessionId) {
    const map = readActiveSessionMap();
    map[flowId] = sessionId;
    try { localStorage.setItem(CHAT_ACTIVE_SESSION_KEY, JSON.stringify(map)); } catch { /* private mode */ }
  }
  // 会话归属：绑定课题就用 project:<projectId>，没绑定才退回 topic:<flowId>。
  // 两者都只用于算目录哈希，原文不会进文件名。
  function chatScopeFor(flowId) {
    const bound = flowId === chatFlowId ? (window.researchWeaver?.activeTopic?.projectId || '') : '';
    const topicId = flowId || 'default';
    return { scopeKey: bound ? `project:${bound}` : `topic:${topicId}`, topicId, projectId: bound || null };
  }

  /* 正文消息在会话文件里的形状：role/text/at 是契约字段，其余原始字段（确认卡、
   * 协议审计、confirmationStates、绘图请求……）整包进 payload。存储层不解释
   * payload，所以这里放什么，重新载入时就原样回来什么。 */
  function chatWireMessage(message) {
    const { messageId, role, text, at, taskId, provider, ...rest } = message;
    return {
      messageId: messageId || newChatMessageId(),
      role,
      text: String(text ?? ''),
      at: at || new Date().toISOString(),
      taskId: taskId ?? null,
      provider: provider ?? null,
      payload: rest,
    };
  }
  function chatMessageFromWire(wire) {
    const payload = wire.payload && typeof wire.payload === 'object' ? wire.payload : {};
    return { ...payload, messageId: wire.messageId, role: wire.role, text: wire.text, at: wire.at };
  }

  /* ------------------------------------------------- 对话写队列（唯一） --
   * 为什么要有它：`saveChat()` 有二十来个调用点，散落在确认卡执行、绘图、笔记
   * 修改、归档各处。把每一处单独改成 await，等于让"落盘"渗透进所有业务逻辑，
   * 漏掉任何一处都是静默丢历史。所以正文写入收敛成两个入口——appendMessage
   * 与 updateSession——它们共用一条串行链：后一次写必须等前一次 settle，磁盘上
   * 的顺序才会和对话里看到的顺序一致。调用点只把增量交给队列，不碰 HTTP。
   *
   * await 这个边界的点分三类，口径写全（只说"只有 N 处"会让读的人以为别处没有，
   * 而冻结审计据此就会报一条假 BLOCK）：
   *   1. **关键路径**——`await flushChat` 恰好 3 处：用户消息派发任务前、Agent
   *      回复标记完成前，再加用户手点的"重试保存"（retryChatPersistence）。
   *      只有前两处是"顺序不变量"的闸门：它们之后分别要派发任务、要收尾解锁，
   *      所以必须等落盘真的 settle。
   *   2. 历史列表里的归档/改名——`await updateSession` 3 处：用户点出来的动作，
   *      要拿返回值刷新列表，**不在对话回合的路径上**，不构成闸门。
   *   3. 确认事件——`await appendConfirmation` 1 处：契约 §2.1 硬性规则 1 要求
   *      "先落 claimed 再投递"，它等的是确认事件而不是正文，同样不在正文回合
   *      的路径上，闸门由它自己那条规则定义。 */
  const chatSessions = new Map();        // flowId -> { sessionId, scopeKey, ..., persisted, failed }
  const chatSessionOpens = new Map();    // flowId -> Promise，防止并发开出两个会话
  const chatWriteChains = new Map();     // flowId -> 串行链尾

  function serializeChatWrite(flowId, task) {
    // 前一次失败也要继续往下走（then(task, task)），否则一次网络抖动会卡死
    // 这个课题之后的所有写入。
    const tail = chatWriteChains.get(flowId) || Promise.resolve(true);
    const next = tail.then(task, task);
    chatWriteChains.set(flowId, next);
    return next;
  }

  /* 入口 1：追加一条正文。已开好的会话必须**同步**入队：如果这里先 await 再
   * serializeChatWrite，调用方紧接着读到的链尾就还是旧的，await flushChat 会在
   * 这次写真正发生之前就返回——"先落盘再派发"于是变成一句空话。 */
  function appendMessage(flowId, message) {
    const ctx = chatSessions.get(flowId);
    if (!ctx) return ensureChatSession(flowId).then((opened) => (opened ? appendMessage(flowId, message) : false));
    // 同一条消息已经在队列里就不要重复发一次：saveChat 与关键路径常常都会碰
    // 到同一条消息，服务端虽然幂等，但没必要为它多跑一趟网络。
    if (ctx.inFlight.has(message.messageId)) return chatWriteChains.get(flowId) || Promise.resolve(true);
    ctx.inFlight.add(message.messageId);
    return serializeChatWrite(flowId, async () => {
      try {
        await bridgeFetch(`/v1/chat/sessions/${ctx.sessionId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: chatWireMessage(message) }) });
        ctx.persisted.add(message.messageId);
        if (ctx.failed.delete(message.messageId)) scheduleChatPaint(flowId);
        ctx.lastError = '';
        return true;
      } catch (error) {
        if (!ctx.failed.has(message.messageId)) { ctx.failed.add(message.messageId); scheduleChatPaint(flowId); }
        ctx.lastError = chatStorageErrorMessage(error);
        return false;
      } finally {
        // 成功或失败都出队：失败的消息留在 failed 里，下一次 flush 会再试一次。
        ctx.inFlight.delete(message.messageId);
      }
    });
  }

  /* 入口 2：改会话本身（只有 title / archived）。归档只是追加一个状态事件，
   * 正文行一个字节都不动，所以随时可以恢复。
   * sessionId 可省略（默认改当前会话）：历史会话列表里归档/改名别的会话时，改的
   * 必须是点中的那一个，而不是碰巧打开着的那一个。 */
  function updateSession(flowId, patch, sessionId = null) {
    const ctx = chatSessions.get(flowId);
    if (!ctx) return ensureChatSession(flowId).then((opened) => (opened ? updateSession(flowId, patch, sessionId) : null));
    const target = sessionId || ctx.sessionId;
    return serializeChatWrite(flowId, async () => {
      try {
        const updated = await bridgeFetch(`/v1/chat/sessions/${target}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
        if (target === ctx.sessionId) {
          ctx.title = updated?.session?.title ?? ctx.title;
          ctx.archived = Boolean(updated?.session?.archived);
        }
        return updated?.session || null;
      } catch (error) {
        ctx.lastError = chatStorageErrorMessage(error);
        return null;
      }
    });
  }

  /* 渲染源和队列的分工：chatMessages 永远是唯一的渲染源（顺序、字段都不变），
   * 队列只负责把"还没落盘的"按顺序送出去。所以 saveChat 不再是"把整个数组写
   * 进 localStorage"，而是"把增量交给队列"——二十来个调用点因此一个都不用改。 */
  function saveChat() {
    const ctx = chatSessions.get(chatFlowId);
    if (!ctx) { void ensureChatSession(chatFlowId); return Promise.resolve(false); }
    void flushChat(chatFlowId);
    return chatWriteChains.get(chatFlowId) || Promise.resolve(true);
  }

  /* 交给队列并等它 settle。
   *
   * ok 的含义是"调用方真正关心的那几条消息确实进 Vault 了"。两条关键路径会传
   * targets（就是那条用户消息 / 那条 Agent 回复），所以一条更早的失败不会让现在
   * 这一条被误判；不传 targets 时，当前课题按本次排队的增量算，切走的课题按它
   * 自己整条链算（那上面只有这一轮的消息）。 */
  async function flushChat(flowId = chatFlowId, targets = null) {
    if (!chatSessions.has(flowId)) {
      const opened = await ensureChatSession(flowId);
      if (!opened) return { ok: false, failed: [], error: chatStorageError || '正文存储不可用' };
    }
    const ctx = chatSessions.get(flowId);
    const outstanding = [];
    if (flowId === chatFlowId) {
      for (const message of chatMessages) {
        if (!message || typeof message !== 'object') continue;
        if (!message.messageId) message.messageId = newChatMessageId();
        if (!ctx.persisted.has(message.messageId)) { outstanding.push(message); appendMessage(flowId, message); }
      }
    }
    await (chatWriteChains.get(flowId) || Promise.resolve(true));
    const watched = targets || (flowId === chatFlowId ? outstanding : [...ctx.failed]);
    const failed = watched.filter((message) => ctx.failed.has(message.messageId)).map((message) => message.messageId);
    return { ok: failed.length === 0, failed, error: ctx.lastError };
  }

  // 用户手动点"重试保存"：第三条 await 这个边界的地方，但它是人触发的重试，
  // 不是关键路径。
  async function retryChatPersistence() {
    await flushChat(chatFlowId);
    renderChat();
  }

  // 入口 3：追加一条确认事件（契约 §2.1）。和正文共用同一条串行链——确认状态
  // 是防重复执行的锁，它必须和它保护的那次写入一样"要么落盘、要么没发生"。
  function appendConfirmation(flowId, event) {
    const ctx = chatSessions.get(flowId);
    if (!ctx) return ensureChatSession(flowId).then((opened) => (opened ? appendConfirmation(flowId, event) : false));
    if (ctx.inFlight.has(event.eventId)) return chatWriteChains.get(flowId) || Promise.resolve(true);
    ctx.inFlight.add(event.eventId);
    return serializeChatWrite(flowId, async () => {
      try {
        const response = await bridgeFetch(`/v1/chat/sessions/${ctx.sessionId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: event }) });
        ctx.persisted.add(event.eventId);
        if (ctx.failed.delete(event.eventId)) scheduleChatPaint(flowId);
        return Boolean(response?.ok);
      } catch (error) {
        if (!ctx.failed.has(event.eventId)) { ctx.failed.add(event.eventId); scheduleChatPaint(flowId); }
        ctx.lastError = chatStorageErrorMessage(error);
        return false;
      } finally {
        ctx.inFlight.delete(event.eventId);
      }
    });
  }
  let legacyMigrationNotice = null;
  try {
    const legacy = localStorage.getItem(CHAT_STORE_LEGACY);
    if (legacy) {
      if (!localStorage.getItem(CHAT_STORE_LEGACY_ARCHIVE)) localStorage.setItem(CHAT_STORE_LEGACY_ARCHIVE, legacy);
      localStorage.removeItem(CHAT_STORE_LEGACY);
      legacyMigrationNotice = '检测到升级前的旧版对话记录（未按课题分区，可能横跨多个课题）。为避免把不相关的历史内容混进当前课题，这份记录已归档、不会自动出现在任何课题的对话框里。如需查看，点击本对话区顶部的"旧版对话归档"按钮即可只读浏览、或复制为文本。';
    }
  } catch { /* private mode */ }
  /* 打开某个课题的会话：先用记住的 sessionId 直接读；读不到（会话被删、换了
   * Vault、换了机器）就退回按 scope 找最近一个；一个都没有才新建。整个过程只
   * 读不写，所以 Bridge 不在时页面照样不是空白——只是明确告诉你读不到。 */
  function adoptChatSession(flowId, page) {
    const session = page.session;
    const ctx = {
      sessionId: session.sessionId,
      scopeKey: session.scopeKey,
      topicId: session.topicId,
      projectId: session.projectId,
      title: session.title,
      archived: Boolean(session.archived),
      persisted: new Set(page.messages.map((message) => message.messageId)),
      failed: new Set(),
      inFlight: new Set(),
      lastError: '',
    };
    chatSessions.set(flowId, ctx);
    rememberActiveSession(flowId, session.sessionId);
    if (flowId === chatFlowId) {
      chatMessages = page.messages.map(chatMessageFromWire);
      chatHasMore = Boolean(page.hasMore);
      chatNextCursor = page.nextCursor || null;
      chatTotal = page.total;
      chatStorageBusy = false;
      chatStorageError = '';
      renderChat();
    }
    return ctx;
  }

  async function openChatSession(flowId) {
    const scope = chatScopeFor(flowId);
    const remembered = readActiveSessionMap()[flowId];
    if (remembered) {
      try {
        const page = await bridgeFetch(`/v1/chat/sessions/${remembered}?limit=${CHAT_PAGE_SIZE}`);
        return adoptChatSession(flowId, page);
      } catch { /* 记住的会话读不到：退回按 scope 找，而不是直接报错 */ }
    }
    const listed = await bridgeFetch(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scope.scopeKey)}&includeArchived=1`);
    const candidates = listed.sessions || [];
    const latest = candidates.find((item) => !item.archived) || candidates[0];
    if (latest) return adoptChatSession(flowId, await bridgeFetch(`/v1/chat/sessions/${latest.sessionId}?limit=${CHAT_PAGE_SIZE}`));
    return createChatSession(flowId, chatTopicName());
  }

  // 会话创建只有这一处：包括"新建会话"按钮。"正文写队列"管的是往已有会话里
  // 追加，而创建会话是会话生命周期，所以它独立成一个函数——不是为了绕过队列，
  // 而是为了让"哪里会新建会话"这个问题只有一个答案。
  async function createChatSession(flowId, title) {
    const scope = chatScopeFor(flowId);
    const created = await bridgeFetch('/v1/chat/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scopeKey: scope.scopeKey, topicId: scope.topicId, projectId: scope.projectId, title: title || chatTopicName() }) });
    return adoptChatSession(flowId, await bridgeFetch(`/v1/chat/sessions/${created.session.sessionId}?limit=${CHAT_PAGE_SIZE}`));
  }

  function ensureChatSession(flowId) {
    const existing = chatSessions.get(flowId);
    if (existing) return Promise.resolve(existing);
    if (!chatSessionOpens.has(flowId)) {
      const opening = openChatSession(flowId).then((ctx) => {
        chatSessionOpens.delete(flowId);
        return ctx;
      }).catch((error) => {
        chatSessionOpens.delete(flowId);
        if (flowId === chatFlowId) setChatStorageError(chatStorageErrorMessage(error));
        return null;
      });
      chatSessionOpens.set(flowId, opening);
    }
    return chatSessionOpens.get(flowId);
  }

  // 正文存储不可用时的措辞：这里最常见的失败根本不是"接口报错"，而是 Bridge
  // 进程没起来（代理还在，fetch 拿到一个 HTML 错误页，JSON 解析直接炸）。把
  // 这种底层报错直接甩给研究员，只会让人看到 "Unexpected token <"。
  function chatStorageErrorMessage(error) {
    const raw = String(error?.message || error || '');
    if (/Failed to fetch|NetworkError|Unexpected token|not valid JSON|JSON at position/.test(raw)) {
      return '连不上本机 Bridge（读写正文需要它）。请确认 npm start 仍在运行，然后点左下角「检查本机 Bridge」。';
    }
    return humanizeActionError(raw);
  }

  function setChatStorageError(text) {
    const next = String(text || '');
    const changed = next !== chatStorageError;
    chatStorageError = next;
    chatStorageBusy = false;
    updateChatStorageStatus();
    updateComposerState();
    if (changed) renderChat();
  }

  // 首次（以及 Bridge 重新连上、用户点重试之后）把当前课题的正文读回来。
  // 这里只读：读不到就停在"明确提示 + 发送禁用"，绝不退回 localStorage 兜底——
  // 那只会让"暂时读不到"变成"两份互不相干的历史"。
  async function bootstrapChat(force = false) {
    if (force) { chatSessions.delete(chatFlowId); chatSessionOpens.delete(chatFlowId); }
    else if (chatSessions.has(chatFlowId)) return;
    chatStorageBusy = true;
    chatStorageError = '';
    updateComposerState();
    renderChat();
    await ensureChatSession(chatFlowId);
  }

  function loadEarlierChat() {
    const ctx = chatSessions.get(chatFlowId);
    if (!ctx || !chatNextCursor) return Promise.resolve();
    return bridgeFetch(`/v1/chat/sessions/${ctx.sessionId}?limit=${CHAT_PAGE_SIZE}&before=${encodeURIComponent(chatNextCursor)}`)
      .then((page) => {
        // 分页只在渲染层：更早的消息接到前面，磁盘上一条都没被删过。
        chatMessages = [...page.messages.map(chatMessageFromWire), ...chatMessages];
        chatHasMore = Boolean(page.hasMore);
        chatNextCursor = page.nextCursor || null;
        chatTotal = page.total;
        renderChat();
      })
      .catch((error) => { window.researchWeaver?.toast?.(`读取更早的对话失败：${error.message}`); });
  }

  let chatPaintTimer = null;
  function scheduleChatPaint(flowId) {
    if (flowId && flowId !== chatFlowId) return;
    clearTimeout(chatPaintTimer);
    // 一次写入刚失败/刚恢复时重绘一下，让"未保存"标记跟着真实状态走；正常
    // 成功不重绘，避免每条消息落地都翻一次滚动位置。
    chatPaintTimer = setTimeout(() => { updateChatStorageStatus(); renderChat(); }, 60);
  }

  function updateChatStorageStatus() {
    const node = document.getElementById('chatStorageStatus');
    if (!node) return;
    if (chatStorageError) node.textContent = `正文未保存：${chatStorageError}`;
    else if (chatStorageBusy) node.textContent = '正在读取本课题的对话正文…';
    else {
      const failed = chatSessions.get(chatFlowId)?.failed?.size || 0;
      node.textContent = failed
        ? `有 ${failed} 条消息未保存到 Vault`
        : `正文已存入 Vault · 本会话 ${chatTotal} 条`;
    }
    node.hidden = false;
  }

  // 发送按钮的可用状态只有一个来源：正在等 Agent、正文还没读回来、或正文存储
  // 明确不可用。输入框不禁用——正文存不下去不代表不能再打字。
  function updateComposerState() {
    if (chatSend) chatSend.disabled = chatBusy || chatStorageBusy || Boolean(chatStorageError);
  }

  function isChatMessageUnsaved(message) {
    const ctx = chatSessions.get(chatFlowId);
    return Boolean(message?.messageId && ctx && ctx.failed.has(message.messageId));
  }

  if (legacyMigrationNotice) {
    // 这条提示以前是塞进对话数组里的（于是刷新后就没了，或者被当成历史的一
    // 部分）。现在它不属于任何一段会话正文，所以放在正文上面单独显示。
    const notice = document.getElementById('chatNotice');
    if (notice) { notice.textContent = legacyMigrationNotice; notice.hidden = false; }
  }
  // The system-bubble notice above only ever appears once, in whichever topic
  // happened to be open the moment the migration ran — reload the page, switch
  // topics, or come back next week and it is gone with no way to know the
  // archive exists. This button is not one-shot: it reflects the archive key's
  // presence on every load, and the DevTools-console instruction the notice
  // used to be the *only* way to actually read the archive is replaced below
  // by an in-app read-only viewer.
  function ensureLegacyArchiveDialog() {
    let dialog = document.querySelector('#legacyArchiveDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'legacyArchiveDialog';
    dialog.className = 'registry-dialog pipeline-topic-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
        <div class="run-header">
          <div><span class="eyebrow">ARCHIVE</span><h2>旧版对话归档</h2></div>
          <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
        </div>
        <div class="pipeline-topic-body">
          <div class="wv-faint">这是"每个课题独立对话"功能上线前的旧版记录，未按课题分区，可能横跨多个课题，因此只读展示、不会自动合并进任何课题。想保留的内容请手动复制。</div>
          <div id="legacyArchiveList" class="wv-narrative wv-legacy-archive-list"></div>
        </div>
        <footer class="pipeline-topic-actions">
          <button type="button" class="button ghost" id="legacyArchiveCopyBtn">复制全部为文本</button>
          <button type="button" class="button ghost" id="legacyArchiveImportBtn">导入到当前课题…</button>
          <button type="button" class="button primary" id="legacyArchiveCloseBtn">关闭</button>
        </footer>
        <div id="legacyArchiveImportState" class="wv-faint" role="status" aria-live="polite"></div>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /* 旧数据导入：preview 先给研究员看条数/首尾时间/来源哈希，人点确认后才
   * commit；commit 必须带 x-scholarium-user-confirmed 与预览的指纹，服务端
   * 还要求一次性 ticket。来源（localStorage 里的旧键）全程只读——导入只新建
   * 会话，绝不合并进现有会话，也绝不改写旧键。 */
  // 导入按钮是两段式的（先预览、再确认），因为"人看过这份清单"这件事必须由人
  // 在界面上做出，而不是由调用方在请求里声称。第二次点击才发 commit，并且带上
  // 头、ticket 与 preview 给的指纹。
  let pendingLegacyImport = null;

  async function importLegacyArchiveIntoCurrentTopic(dialog, archived, button) {
    const state = dialog.querySelector('#legacyArchiveImportState');
    const say = (text) => { if (state) state.textContent = text; };
    if (pendingLegacyImport) {
      const { ticket, fingerprint } = pendingLegacyImport;
      pendingLegacyImport = null;
      button.textContent = '导入到当前课题…';
      try {
        const committed = await bridgeFetch('/v1/chat/import/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-scholarium-user-confirmed': 'true' },
          body: JSON.stringify({ ticket, fingerprint, confirm: true }),
        });
        const imported = committed.imported?.[0];
        say(imported
          ? `已导入 ${imported.count} 条，新会话 ${imported.sessionId}（可在"历史会话"里打开）。旧记录与来源键都保持原样。`
          : '提交完成，但没有新建会话。');
        window.researchWeaver?.toast?.(imported ? `已导入 ${imported.count} 条旧版对话。` : '导入完成。');
      } catch (error) {
        say(`导入失败，没有写入任何内容：${chatStorageErrorMessage(error)}。门票是一次性的，重试需要重新预览。`);
      }
      return;
    }
    const scope = chatScopeFor(chatFlowId);
    let sourceSha256;
    try {
      sourceSha256 = await sha256Hex(localStorage.getItem(CHAT_STORE_LEGACY_ARCHIVE) || '');
    } catch {
      say('无法计算来源哈希（当前环境不提供 SHA-256），因此没有做任何改动。');
      return;
    }
    button.disabled = true;
    say('正在生成预览…');
    let preview;
    try {
      preview = await bridgeFetch('/v1/chat/import/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [{
            scopeKey: scope.scopeKey,
            topicId: scope.topicId,
            projectId: scope.projectId,
            title: `旧版对话归档 · ${chatTopicName()}`,
            sourceOrigin: location.origin,
            sourcePath: null,
            sourceKey: CHAT_STORE_LEGACY_ARCHIVE,
            sourceSha256,
            messages: archived.map((msg) => ({ role: msg.role, text: msg.text, at: msg.at })),
          }],
        }),
      });
    } catch (error) {
      say(`预览失败，没有做任何改动：${chatStorageErrorMessage(error)}`);
      return;
    } finally { button.disabled = false; }
    const item = preview.items?.[0] || {};
    const summary = `共 ${preview.totalMessages} 条，重复跳过 ${preview.duplicateMessages} 条，实际写入 ${item.count ?? 0} 条\n首条 ${item.firstAt || '未知'} · 末条 ${item.lastAt || '未知'}\n来源哈希 ${sourceSha256.slice(0, 16)}… · 预览指纹 ${String(preview.fingerprint).slice(0, 12)}…\n目标课题 ${scope.scopeKey}（只新建会话，不合并进当前会话；旧记录保持原样）`;
    if (!item.count) { say(`没有可导入的内容。\n${summary}`); return; }
    pendingLegacyImport = { ticket: preview.ticket, fingerprint: preview.fingerprint };
    button.textContent = `确认导入 ${item.count} 条`;
    say(`请确认下列内容后再次点击按钮：\n${summary}`);
  }
  function openLegacyArchiveDialog() {
    const dialog = ensureLegacyArchiveDialog();
    let archived = [];
    try { archived = JSON.parse(localStorage.getItem(CHAT_STORE_LEGACY_ARCHIVE) || '[]'); } catch { archived = []; }
    const list = dialog.querySelector('#legacyArchiveList');
    const fragment = document.createDocumentFragment();
    if (!archived.length) fragment.appendChild(chatBubble('system', '没有找到旧版对话归档。'));
    else for (const msg of archived) fragment.appendChild(chatBubble(msg.role, msg.text));
    list.replaceChildren(fragment);
    dialog.querySelector('#legacyArchiveCopyBtn').onclick = async () => {
      const roleLabel = (role) => (role === 'user' ? '你' : role === 'agent' ? '织研者' : '系统');
      const text = archived.map((msg) => `[${roleLabel(msg.role)}] ${msg.text}`).join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        window.researchWeaver?.toast?.('已复制到剪贴板。');
      } catch {
        window.researchWeaver?.toast?.('复制失败，请手动选中文字复制。');
      }
    };
    const importBtn = dialog.querySelector('#legacyArchiveImportBtn');
    pendingLegacyImport = null;
    importBtn.textContent = '导入到当前课题…';
    importBtn.onclick = () => { void importLegacyArchiveIntoCurrentTopic(dialog, archived, importBtn); };
    const close = () => dialog.close();
    dialog.querySelector('.pipeline-topic-close').onclick = close;
    dialog.querySelector('#legacyArchiveCloseBtn').onclick = close;
    const importState = dialog.querySelector('#legacyArchiveImportState');
    if (importState) importState.textContent = '';
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function updateLegacyArchiveButton() {
    const btn = document.getElementById('chatLegacyArchiveBtn');
    if (!btn) return;
    let hasArchive = false;
    try { hasArchive = !!localStorage.getItem(CHAT_STORE_LEGACY_ARCHIVE); } catch { /* private mode */ }
    btn.hidden = !hasArchive;
  }
  updateLegacyArchiveButton();
  document.getElementById('chatLegacyArchiveBtn')?.addEventListener('click', openLegacyArchiveDialog);

  /* 历史会话 / 归档 · 恢复。会话列表按当前 scope 取，ARCHIVED 的也列出来（否则
   * "归档"就等于"再也找不到"）。归档只追加状态事件，正文不改，所以恢复就是
   * 再追加一个 archived:false。 */
  function ensureChatSessionsDialog() {
    let dialog = document.querySelector('#chatSessionsDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'chatSessionsDialog';
    dialog.className = 'registry-dialog pipeline-topic-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
        <div class="run-header">
          <div><span class="eyebrow">SESSIONS</span><h2>本课题的历史会话</h2></div>
          <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
        </div>
        <div class="pipeline-topic-body">
          <div class="wv-faint">对话正文保存在 Vault 的 Scholarium/Chat/v1/ 下。归档不移动、不删除任何正文，随时可以恢复。</div>
          <div id="chatSessionsList" class="wv-narrative"></div>
        </div>
        <footer class="pipeline-topic-actions">
          <button type="button" class="button ghost" id="chatSessionsNewBtn">新建会话</button>
          <button type="button" class="button primary" id="chatSessionsCloseBtn">关闭</button>
        </footer>
        <div id="chatSessionsState" class="wv-faint" role="status" aria-live="polite"></div>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  async function renderChatSessionsDialog(dialog) {
    const list = dialog.querySelector('#chatSessionsList');
    const state = dialog.querySelector('#chatSessionsState');
    const scope = chatScopeFor(chatFlowId);
    let sessions = [];
    try {
      sessions = (await bridgeFetch(`/v1/chat/sessions?scopeKey=${encodeURIComponent(scope.scopeKey)}&includeArchived=1`)).sessions || [];
    } catch (error) {
      list.replaceChildren(chatBubble('system', `读取会话列表失败：${humanizeActionError(String(error?.message || error))}`));
      return;
    }
    if (state) state.textContent = `共 ${sessions.length} 个会话`;
    const active = chatSessions.get(chatFlowId)?.sessionId;
    const fragment = document.createDocumentFragment();
    for (const session of sessions) {
      const row = document.createElement('div');
      row.className = 'wv-action-card';
      const head = document.createElement('div');
      head.className = 'wv-action-title';
      head.textContent = `${session.archived ? '［已归档］' : ''}${session.title || '未命名课题'}${session.sessionId === active ? ' · 当前' : ''}`;
      const meta = document.createElement('div');
      meta.className = 'wv-faint';
      meta.textContent = `${session.messageCount} 条 · 最后更新 ${session.updatedAt || session.createdAt || '未知'} · ${session.sessionId}`;
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      const open = document.createElement('button');
      open.type = 'button'; open.className = 'wv-btn wv-btn-sm'; open.textContent = '打开';
      open.onclick = () => {
        chatSessions.delete(chatFlowId);
        chatSessionOpens.delete(chatFlowId);
        chatStorageBusy = true;
        updateComposerState();
        adoptChatSession(chatFlowId, { session, messages: [], hasMore: false, nextCursor: null, total: session.messageCount });
        bridgeFetch(`/v1/chat/sessions/${session.sessionId}?limit=${CHAT_PAGE_SIZE}`)
          .then((page) => adoptChatSession(chatFlowId, page))
          .catch((error) => setChatStorageError(chatStorageErrorMessage(error)));
        void renderChatSessionsDialog(dialog);
      };
      const toggle = document.createElement('button');
      toggle.type = 'button'; toggle.className = 'wv-btn wv-btn-sm';
      toggle.textContent = session.archived ? '恢复' : '归档';
      // 每一行都改自己那一行对应的会话：不能因为某一行被点，就把当前打开着的
      // 会话归档掉。
      toggle.onclick = async () => {
        const updated = await updateSession(chatFlowId, { archived: !session.archived }, session.sessionId);
        if (!updated) { window.researchWeaver?.toast?.('归档/恢复失败，请稍后重试。'); return; }
        if (session.sessionId === chatSessions.get(chatFlowId)?.sessionId) updateChatStorageStatus();
        void renderChatSessionsDialog(dialog);
      };
      const rename = document.createElement('button');
      rename.type = 'button'; rename.className = 'wv-btn wv-btn-sm'; rename.textContent = '改名';
      rename.onclick = async () => {
        const next = window.prompt('会话名称', session.title || '');
        if (next === null || !next.trim()) return;
        const updated = await updateSession(chatFlowId, { title: next.trim().slice(0, 200) }, session.sessionId);
        if (!updated) { window.researchWeaver?.toast?.('改名失败，请稍后重试。'); return; }
        if (session.sessionId === chatSessions.get(chatFlowId)?.sessionId) syncChatTopicLabel();
        void renderChatSessionsDialog(dialog);
      };
      bar.append(open, toggle, rename);
      row.append(head, meta, bar);
      fragment.appendChild(row);
    }
    if (!sessions.length) fragment.appendChild(chatBubble('system', '这个课题还没有会话。'));
    list.replaceChildren(fragment);
  }

  function openChatSessionsDialog() {
    const dialog = ensureChatSessionsDialog();
    dialog.querySelector('#chatSessionsNewBtn').onclick = async () => {
      chatSessions.delete(chatFlowId);
      chatSessionOpens.delete(chatFlowId);
      chatStorageBusy = true;
      updateComposerState();
      try {
        await createChatSession(chatFlowId, `${chatTopicName()} · 新会话`);
        void renderChatSessionsDialog(dialog);
      } catch (error) { setChatStorageError(chatStorageErrorMessage(error)); }
    };
    dialog.querySelector('.pipeline-topic-close').onclick = () => dialog.close();
    dialog.querySelector('#chatSessionsCloseBtn').onclick = () => dialog.close();
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
    void renderChatSessionsDialog(dialog);
  }

  document.getElementById('chatHistoryBtn')?.addEventListener('click', openChatSessionsDialog);
  document.getElementById('chatArchiveBtn')?.addEventListener('click', async () => {
    const ctx = chatSessions.get(chatFlowId);
    if (!ctx) { window.researchWeaver?.toast?.('正文存储还没有就绪，暂时无法归档。'); return; }
    const updated = await updateSession(chatFlowId, { archived: !ctx.archived });
    if (!updated) { window.researchWeaver?.toast?.(`归档失败：${ctx.lastError || '未知原因'}`); return; }
    window.researchWeaver?.toast?.(updated.archived ? '已归档本会话（正文未改动，可随时在"历史会话"里恢复）。' : '已恢复本会话。');
    updateChatStorageStatus();
  });
  // Bridge 重新连上后重试读取：这是"离线→在线"的唯一恢复入口，用户点重试也走它。
  window.addEventListener('bridge:agents', () => {
    if (chatStorageError) void bootstrapChat(true);
  });

  // A reply landing after the user switched topics still belongs to the topic
  // that started the turn: hand that single message to the write queue, which
  // already knows that topic's session. Loading that topic's whole transcript
  // here would be wrong: the render source is the open topic only.
  function appendToChat(flowId, message) {
    if (!message.messageId) message.messageId = newChatMessageId();
    if (flowId === chatFlowId) { chatMessages.push(message); renderChat(); void flushChat(flowId); return; }
    void appendMessage(flowId, message);
  }

  const CONFIRMATION_KINDS = ['action', 'draft', 'legacyNoteEdit', 'run', 'normalize', 'plot', 'plotRevision', 'suggestReconstruction'];
  let focusPendingCardsOnNextRender = true;

  /* 确认状态一律读**派生值**（契约 §2.1 规则 6）。
   *
   * `message.confirmations[kind].state` 是 Bridge 从会话文件里的 confirmation 事件
   * 归并出来的（本地刚写完一条时也是同一形状），它才是防重复执行的唯一真相。
   * 下面是给 P0 之前写下的老消息留的兼容推导——那时候状态只活在内存/localStorage
   * 里，磁盘上没有事件可依据，只能按展示字段猜，猜的结果就是 "pending"。 */
  const CHAT_CONFIRMATION_STATES = ['pending', 'claimed', 'confirmed', 'failed', 'abandoned'];
  /* 只有 pending 可再点（契约 §2.4）。failed 也**不再**在原卡上提供重试：控制器
   * 抛错意味着"这次投递的结果未知或不完整"（可能已经写了一半），fail-closed 的
   * 做法是让研究员重新走一遍产生这张卡的流程，而不是把同一个请求再发一次。
   * claimed/confirmed/abandoned 同样锁死。 */
  function isConfirmableState(state) { return state === 'pending'; }

  function confirmationState(message, kind) {
    const derived = message?.confirmations?.[kind]?.state;
    if (CHAT_CONFIRMATION_STATES.includes(derived)) return derived;
    const explicit = message.confirmationStates?.[kind];
    if (['pending', 'confirmed', 'abandoned'].includes(explicit)) return explicit;
    if (kind === 'action' && Array.isArray(message.actions) && message.actions.length)
      return message.actionsState ? 'confirmed' : 'pending';
    if (kind === 'draft' && Array.isArray(message.drafts) && message.drafts.length)
      return message.draftsState ? 'confirmed' : 'pending';
    if (kind === 'legacyNoteEdit' && Array.isArray(message.legacyNoteEdits) && message.legacyNoteEdits.length)
      return message.legacyNoteEditsState ? 'confirmed' : 'pending';
    if (kind === 'run' && Array.isArray(message.runs) && message.runs.length)
      return message.runs.some((item) => item.state) ? 'confirmed' : 'pending';
    if (kind === 'normalize' && Array.isArray(message.normalizations) && message.normalizations.length)
      return message.normalizations.some((item) => item.state) ? 'confirmed' : 'pending';
    if (kind === 'plot' && Array.isArray(message.plots) && message.plots.length)
      return message.plots.some((item) => item.state) ? 'confirmed' : 'pending';
    if (kind === 'plotRevision' && Array.isArray(message.plotRevisions) && message.plotRevisions.length)
      return message.plotRevisions.some((item) => item.state) ? 'confirmed' : 'pending';
    if (kind === 'suggestReconstruction' && Array.isArray(message.suggestReconstructions) && message.suggestReconstructions.length)
      return 'pending';
    return 'none';
  }

  function confirmationStates(message) {
    return Object.fromEntries(CONFIRMATION_KINDS.map((kind) => [kind, confirmationState(message, kind)]));
  }

  // 待确认与待核对分开数：claimed 的卡片不能点、但需要人去看——如果只在"待确认"
  // 里数 pending，崩溃窗口里的那些卡片在界面上就完全没有入口了。
  function confirmationCounts() {
    let pending = 0;
    let claimed = 0;
    for (const message of chatMessages) {
      for (const kind of CONFIRMATION_KINDS) {
        const state = confirmationState(message, kind);
        if (state === 'pending') pending += 1;
        else if (state === 'claimed') claimed += 1;
      }
    }
    return { pending, claimed };
  }

  function ensurePendingConfirmationButton() {
    let button = document.getElementById('chatPendingConfirmations');
    if (button) return button;
    const row = document.querySelector('.wv-chat-topic-row');
    if (!row) return null;
    button = document.createElement('button');
    button.id = 'chatPendingConfirmations';
    button.type = 'button';
    button.className = 'wv-btn wv-pending-confirmations';
    button.title = '跳到本课题最早一张尚未确认的请求卡片';
    button.addEventListener('click', () => { focusPendingCardsOnNextRender = true; renderChat(); });
    row.appendChild(button);
    return button;
  }

  function updatePendingConfirmationButton() {
    const button = ensurePendingConfirmationButton();
    if (!button) return;
    const count = pendingConfirmationCount();
    button.hidden = count === 0;
    button.textContent = `待确认请求 ${count}`;
  }

  function protocolAuditPayload(message, event, submission) {
    const audit = message.protocolAudit || {};
    return {
      event,
      taskId: message.taskId,
      flowId: message.flowId || chatFlowId,
      replyLength: audit.replyLength || 0,
      blocks: audit.blocks || {},
      renderedCards: audit.renderedCards || 0,
      cardStates: confirmationStates(message),
      writeClaim: audit.writeClaim || '',
      // This is the final, renderer-built Skill recipe—not a model protocol
      // block.  It makes a later audit able to distinguish model intent from
      // what the researcher-confirmed card actually submitted.
      submission: submission || undefined,
    };
  }

  async function auditChatTurn(message, event = 'confirmation-state', submission) {
    if (!message?.taskId || !message?.protocolAudit) return;
    try {
      await bridgeFetch('/v1/chat-turns/audit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(protocolAuditPayload(message, event, submission)),
      });
    } catch { /* audit is best-effort and must never break the conversation */ }
  }

  const LEGACY_CONFIRMATION_FIELD = { action: 'actionsState', draft: 'draftsState', legacyNoteEdit: 'legacyNoteEditsState' };

  function newEventId() {
    return `evt-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  }
  function newOperationId() {
    return `op-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`;
  }

  /* 写一条确认事件并等它落盘。返回 false 表示没写进去——调用方**不许**在这种情况下
   * 继续投递真实写入（契约 §2.1 硬性规则 1）。
   *
   * 本地派生值在 await 之前就先按"意图"更新：卡片要立刻锁住，不能让第二次点击
   * 在等待期间挤进来。真正的权威仍然是落盘后重新读回来的那一份。 */
  async function markConfirmation(message, kind, state, options = {}) {
    if (!message?.messageId) return false;
    const event = {
      eventId: options.eventId || newEventId(),
      messageId: message.messageId,
      kind,
      state,
      operationId: options.operationId || null,
      detail: options.detail ?? null,
      at: new Date().toISOString(),
    };
    message.confirmations = { ...(message.confirmations || {}), [kind]: { state, operationId: event.operationId, detail: event.detail, at: event.at } };
    message.confirmationStates = { ...(message.confirmationStates || {}), [kind]: state };
    if (LEGACY_CONFIRMATION_FIELD[kind]) message[LEGACY_CONFIRMATION_FIELD[kind]] = state;
    void auditChatTurn(message);
    renderChat();
    const stored = await appendConfirmation(chatFlowId, event);
    if (!stored) window.researchWeaver?.toast?.('确认状态没能保存到 Vault；这次没有执行任何写入，请检查 Bridge 后重试。');
    return stored;
  }

  async function abandonConfirmation(message, kind) {
    await markConfirmation(message, kind, 'abandoned');
    renderChat();
  }

  /* 账本（§2.2）：claim 在投递之前占位，resolve 在事后闭合（confirmed / failed）。
   * 用 bridgeFetchRaw 而不是 bridgeFetch —— 这里必须看得见状态码：409 与 404 是
   * 不同的处置方式（"已经占过位" vs "查无此单"），不能被压成同一句错误文本。 */
  async function chatLedger(path, body, options = {}) {
    return bridgeFetchRaw(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.confirmed ? { 'x-scholarium-user-confirmed': 'true' } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  /* 投递的唯一入口：把 operationId 注入每一个**会真实写入**的请求。
   *
   * 为什么要收敛成一个函数：八个确认处理器里有十几处写端点调用，逐个手加请求头
   * 一定会漏，而漏掉的那一处就是"点了两次写两次"——和 `saveChat` 那次的教训一模
   * 一样。只读的 preview / 查询端点（`/v1/.../preview`、`/v1/skills`、
   * `/v1/scholarium/status`、`/v1/scholarium/actions/:id` 轮询）不走这里：它们
   * 不需要幂等，带上号反而会先占掉这张票据。
   *
   * 一次确认可能fan-out 出多个写请求（一批草稿 = N 个批次、一次改版 = 预览 + 提交）。
   * 账本按 operationId 唯一，所以第 2 个之后的写请求用 `<operationId>-<n>`：可追溯、
   * 可重放（同一次确认重放的顺序一致，号码就一致），又不会互相撞成
   * "operation id reused with a different request"。 */
  const chatDispatchCounts = new Map();
  function chatDispatch(path, options, operationId) {
    if (!operationId) return Promise.reject(new Error('chatDispatch 缺少 operationId：这张卡片没有可重放的依据'));
    const sequence = (chatDispatchCounts.get(operationId) || 0) + 1;
    chatDispatchCounts.delete(operationId);
    chatDispatchCounts.set(operationId, sequence);
    // 页面可以开很久，这张表不能只涨不消：顺序号只在一次确认的投递期间有用，
    // 留最近 200 次确认足够（Map 保插入序，删最早的）。
    while (chatDispatchCounts.size > 200) chatDispatchCounts.delete(chatDispatchCounts.keys().next().value);
    const headers = { ...(options?.headers || {}) };
    // 大小写不同也算同一个头：同一次请求里出现两个拼写，服务端读到哪个是不确定的。
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'x-scholarium-operation-id') delete headers[key];
    }
    headers['x-scholarium-operation-id'] = sequence === 1 ? operationId : `${operationId}-${sequence}`;
    return bridgeFetch(path, { ...options, headers });
  }

  /* 一次人工确认的完整生命周期。八个确认处理器共用它，区别只在 request（要施加
   * 的载荷）与 guarded（执行端能不能自己守卫）。
   *   claimed 没落盘 → 不投递；
   *   投递成功 → confirmed；抛错 → failed（重试必须生成新的 operationId）。
   *
   * guarded=true（action/draft/legacyNoteEdit/normalize/plot/plotRevision）：账本
   * 那一行由**执行端点**在收到 `x-scholarium-operation-id` 时创建并闭合——这样
   * 投递本身就幂等，重放时由端点返回原结果、一个字节都不写。shell 不预先占位，
   * 否则同一个号码会被占两次（预占一次 + 端点一次），第二次就被判成"同 ID 换请求"。
   * guarded=false（run 的真实派发在 bridge-ui.js，挂不上头；suggestReconstruction
   * 的真实写入在重建面板里）：账本那一行只能由 shell 预先占位，用来记录"这张卡片
   * 投过"，并且保证它不会再被投第二次。 */
  async function beginChatConfirmation(message, kind, request, detail, options = {}) {
    if (!message?.messageId) return { ok: false };
    if (!isConfirmableState(confirmationState(message, kind))) return { ok: false, locked: true };
    const guarded = options.guarded !== false;
    const operationId = newOperationId();
    const claimed = await markConfirmation(message, kind, 'claimed', { operationId, detail: detail ?? null });
    if (!claimed) return { ok: false };
    if (guarded) return { ok: true, operationId };
    let claim;
    try {
      claim = await chatLedger(`/v1/chat/operations/${operationId}/claim`, { kind, messageId: message.messageId, request: request ?? null });
    } catch (error) {
      await markConfirmation(message, kind, 'failed', { operationId, detail: { reason: chatStorageErrorMessage(error) } });
      return { ok: false, operationId, error: chatStorageErrorMessage(error) };
    }
    if (claim.status !== 200) {
      const reason = String(claim.payload?.error || `HTTP ${claim.status}`);
      await markConfirmation(message, kind, 'failed', { operationId, detail: { reason, needsReview: true } });
      appendToChat(chatFlowId, {
        role: 'system',
        text: `这次确认没有执行：${reason}。为避免重复写入，请先核对账本（operationId ${operationId}）确认上一次到底写了什么，再重新发起一次新的确认。`,
        at: new Date().toISOString(),
      });
      return { ok: false, operationId, error: reason };
    }
    return { ok: true, operationId };
  }

  async function settleChatConfirmation(message, kind, operationId, outcome = {}) {
    const state = outcome.error ? 'failed' : 'confirmed';
    const detail = outcome.error ? { reason: outcome.error } : (outcome.detail ?? null);
    await markConfirmation(message, kind, state, { operationId, detail });
    try {
      await chatLedger(`/v1/chat/operations/${operationId}/resolve`, { outcome: state, detail }, { confirmed: true });
    } catch { /* 账本闭合失败不影响"这次确实执行过"这个事实；会话文件里已有终态 */ }
    return state;
  }

  /* 重载后处于 claimed 的卡片：显示"正在核对执行结果"，按 operationId 查账本，
   * **禁止直接重跑**。研究员核对过 Vault 之后自己决定标 confirmed 还是 failed。 */
  async function resolveClaimedConfirmation(message, kind, operationId, outcome) {
    const detail = outcome === 'confirmed'
      ? { note: '研究员核对 Vault 后确认这次执行已经生效' }
      : { reason: '研究员核对 Vault 后确认这次执行没有生效' };
    await settleChatConfirmation(message, kind, operationId, {
      error: outcome === 'failed' ? detail.reason : null, detail,
    });
    appendToChat(chatFlowId, {
      role: 'system',
      text: `已把这次确认标记为「${outcome === 'confirmed' ? '已完成' : '未生效'}」。${outcome === 'confirmed' ? '' : '如果需要重新执行，请重新发起一次新的确认（会生成新的一次性编号）。'}`,
      at: new Date().toISOString(),
    });
    renderChat();
  }

  function appendAbandonButton(bar, message, kind) {
    if (confirmationState(message, kind) !== 'pending') return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wv-action-cancel';
    button.textContent = '暂不执行';
    button.addEventListener('click', () => abandonConfirmation(message, kind));
    bar.appendChild(button);
  }

  function chatBubble(role, text) {
    const row = document.createElement('div');
    row.className = `wv-msg wv-msg-${role}`;
    const head = document.createElement('div');
    head.className = 'wv-msg-head';
    const who = document.createElement('span');
    who.className = 'wv-msg-who';
    who.textContent = role === 'user' ? '你' : role === 'agent' ? '织研者' : '系统';
    head.appendChild(who);
    const body = document.createElement('div');
    body.className = 'wv-msg-body';
    // The dedicated renderer keeps ordinary agent prose readable (including
    // Markdown tables) without ever treating the reply itself as HTML.
    const renderMarkdown = window.weaverChatMarkdown?.renderMarkdown;
    body.innerHTML = renderMarkdown
      ? renderMarkdown(text)
      : String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    row.append(head, body);
    return row;
  }

  // The in-flight turn is state, not a stray DOM node: renderChat() rebuilds the
  // transcript, and an appended indicator would be silently swept away by that
  // rebuild. It now lives in its own host (see refreshPending) so run-step ticks
  // no longer touch it at all.
  let pending = null; // { taskId, adapter, status, stage, startedAt }

  function pendingLabel() {
    if (!pending) return '';
    const seconds = Math.max(0, Math.round((Date.now() - pending.startedAt) / 1000));
    const where = pending.stage || (pending.status === 'queued' ? '正在启动 Agent' : '正在思考');
    return `${where}…（${pending.adapter} · ${seconds}s）`;
  }

  function pendingCard() {
    // The thinking indicator only shows in the topic that started the turn;
    // the poll keeps running and the reply lands in that topic's transcript.
    if (!pending || (pending.flowId && pending.flowId !== chatFlowId)) return null;
    const el = document.createElement('div');
    el.className = 'wv-thinking';
    el.id = 'chatThinking';
    const bar = document.createElement('div');
    bar.className = 'wv-thinking-bar';
    bar.innerHTML = '<span></span>';
    const text = document.createElement('span');
    text.className = 'wv-thinking-text';
    text.textContent = pendingLabel();
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wv-thinking-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', cancelPending);
    el.append(bar, text, cancel);
    // 过程展示：像 Claude Code 一样列出 Agent 正在做什么（思考/工具调用/命令返回），
    // 数据来自 Bridge 任务事件流（pollTaskFull 写入 pending.steps）。
    if (pending.steps?.length) {
      const steps = document.createElement('div');
      steps.className = 'wv-thinking-steps';
      for (const step of pending.steps.slice(-6)) {
        const line = document.createElement('div');
        line.className = 'wv-thinking-step';
        line.textContent = step;
        steps.appendChild(line);
      }
      el.appendChild(steps);
    }
    return el;
  }

  // Cheap per-second refresh: rewrite the label and step list in place rather
  // than re-render the transcript, so scroll position and selection survive.
  setInterval(() => {
    if (!pending) return;
    const label = document.querySelector('#chatThinking .wv-thinking-text');
    if (label) label.textContent = pendingLabel();
    const stepsEl = document.querySelector('#chatThinking .wv-thinking-steps');
    if (stepsEl && pending.steps?.length) {
      const latest = pending.steps.slice(-6);
      if (stepsEl.childElementCount !== latest.length || stepsEl.lastElementChild?.textContent !== latest[latest.length - 1]) {
        stepsEl.innerHTML = '';
        for (const step of latest) {
          const line = document.createElement('div');
          line.className = 'wv-thinking-step';
          line.textContent = step;
          stepsEl.appendChild(line);
        }
      }
    }
  }, 1000);

  async function cancelPending() {
    if (!pending?.taskId) return;
    try { await bridgeFetch(`/v1/tasks/${pending.taskId}/cancel`, { method: 'POST' }); }
    catch { /* the poll loop reports whatever state the task ends in */ }
  }

  // Compact run summary card (NOT a 1:1 mirror of tracker)
  function runSummaryCard() {
    const rows = runSteps ? [...runSteps.querySelectorAll('.run-step')] : [];
    if (!rows.length) return null;
    const total = rows.length;
    const done = rows.filter(r => !r.classList.contains('pending')).length;
    const title = runTitle?.textContent || '运行中';
    const card = document.createElement('div');
    card.className = 'wv-run-summary';
    if (runSummaryCollapsed) {
      card.classList.add('is-collapsed');
      const reopen = document.createElement('button');
      reopen.type = 'button';
      reopen.className = 'wv-run-summary-reopen';
      reopen.title = '重新显示 Pipeline 进度卡';
      reopen.setAttribute('aria-label', '重新显示 Pipeline 进度卡');
      reopen.setAttribute('aria-expanded', 'false');
      const icon = document.createElement('span');
      icon.className = 'wv-run-summary-reopen-icon';
      icon.textContent = '▸';
      const label = document.createElement('span');
      label.textContent = '显示 Pipeline 进度';
      const progress = document.createElement('span');
      progress.className = 'wv-run-summary-progress';
      progress.textContent = `${done} / ${total}`;
      reopen.append(icon, label, progress);
      reopen.addEventListener('click', () => setRunSummaryCollapsed(false));
      card.appendChild(reopen);
      return card;
    }
    const head = document.createElement('div');
    head.className = 'wv-run-summary-head';
    const heading = document.createElement('b');
    heading.textContent = title;
    const actions = document.createElement('span');
    actions.className = 'wv-run-summary-head-actions';
    const progress = document.createElement('span');
    progress.className = 'wv-run-summary-progress';
    progress.textContent = `${done} / ${total}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wv-run-summary-toggle';
    close.textContent = '×';
    close.title = '收起 Pipeline 进度卡（不会停止任务）';
    close.setAttribute('aria-label', '收起 Pipeline 进度卡，不会停止任务');
    close.setAttribute('aria-expanded', 'true');
    close.addEventListener('click', () => setRunSummaryCollapsed(true));
    actions.append(progress, close);
    head.append(heading, actions);
    const chips = document.createElement('div');
    chips.className = 'wv-run-summary-steps';
    for (const row of rows) {
      const name = row.querySelector('b')?.textContent || '';
      const short = name.replace(/^阶段\s*[\d.]+\s*·\s*/, '').slice(0, 20);
      let cls = '';
      if (row.classList.contains('pending')) cls = '';
      else if (row.querySelector('i')?.textContent.trim() === '!') cls = 'error';
      else cls = 'done';
      const chip = document.createElement('span');
      chip.className = `wv-run-chip ${cls}`;
      chip.textContent = short;
      chips.appendChild(chip);
    }
    card.append(head, chips);
    return card;
  }

  // The transcript and the run summary change on completely different clocks:
  // messages only when someone sends one, the summary on every step tick (and,
  // since the download progress bar landed, several times a second). Rebuilding
  // the bubbles for a summary update is what made the chat visibly flicker and
  // snap to the bottom mid-read, so the two live in separate containers and are
  // refreshed independently.
  let summaryHost = null;
  let downloadHost = null;
  let pendingHost = null;

  function ensureHosts() {
    if (!narrative) return false;
    if (!summaryHost || !summaryHost.isConnected) {
      summaryHost = document.createElement('div');
      summaryHost.className = 'wv-chat-summary-host';
      narrative.appendChild(summaryHost);
    }
    if (!downloadHost || !downloadHost.isConnected) {
      downloadHost = document.createElement('div');
      downloadHost.className = 'wv-chat-download-host';
      narrative.appendChild(downloadHost);
    }
    if (!pendingHost || !pendingHost.isConnected) {
      pendingHost = document.createElement('div');
      pendingHost.className = 'wv-chat-pending-host';
      narrative.appendChild(pendingHost);
    }
    return true;
  }

  // Only stick to the bottom if the reader is already there; otherwise a tick
  // arriving while they scroll back through the transcript yanks them away.
  function withScrollAnchor(update) {
    if (!narrative) return;
    const atBottom = narrative.scrollHeight - narrative.scrollTop - narrative.clientHeight < 48;
    update();
    if (atBottom) narrative.scrollTop = narrative.scrollHeight;
  }

  let lastSummaryHtml = null;
  function setRunSummaryCollapsed(collapsed) {
    runSummaryCollapsed = !!collapsed;
    try { localStorage.setItem(RUN_SUMMARY_COLLAPSED_KEY, runSummaryCollapsed ? '1' : '0'); } catch { /* private mode */ }
    // Force one small-host replacement so the newly attached close/reopen
    // handler is installed immediately; the transcript itself stays untouched.
    lastSummaryHtml = null;
    refreshRunSummary();
  }
  function refreshRunSummary() {
    if (!ensureHosts()) return;
    const summary = runSummaryCard();
    // replaceChildren on this small host only — the bubbles above are untouched.
    // 内容没变就跳过重绘：此前每次步骤行文本被重写（例如每秒的等待计时）
    // 都会走到这里重建卡片，wvFadeUp 动画随之重播——这就是用户看到的
    // "长条方块一直在闪"。卡片 HTML 不变时原地不动，闪烁消失。
    const html = summary ? summary.innerHTML : '';
    if (html === lastSummaryHtml && (summaryHost.firstChild || !html)) return;
    lastSummaryHtml = html;
    withScrollAnchor(() => summaryHost.replaceChildren(...(summary ? [summary] : [])));
  }

  // Unlike the compact run summary, this card is intentionally stable for the
  // entire download.  We create it once and only change text/width in place on
  // each DOI tick; no child replacement means no layout or transcript flash.
  let downloadCardTimer = null;        // 终态 10 秒自动消失计时器
  let downloadCardDismissedFor = null; // 用户 × 掉的批次签名（total|current）
  function refreshDownloadProgress(state = window.weaverDownloadProgress?.state) {
    if (!ensureHosts()) return;
    // window.weaverDownloadProgress starts life as { state: null, ... } (see
    // bridge-ui.js) before any download has ever run this session, and a
    // default parameter only kicks in for `undefined` - not for an explicit
    // `null`. So the very first renderChat() -> refreshDownloadProgress()
    // call of a session left `state` as `null` here, and every unguarded
    // `state.xxx` read below (starting with __staleMs) threw a synchronous
    // TypeError. That exception aborted the rest of shell-ui.js's top-level
    // setup, including the makeResizable() calls further down - which is why
    // the left/right column drag handles silently stopped working (live
    // repro via DevTools console, 2026-08-19: "Cannot read properties of
    // null (reading '__staleMs')" at this line, called from renderChat()).
    state = state || {};
    const isRunning = state?.status === 'running';
    let card = downloadHost.querySelector('.wv-chat-download-progress');
    const staleMs = Number(state.__staleMs) || 0;
    const staleThreshold = Number(window.weaverDownloadProgress?.staleThresholdMs) || (3 * 60 * 1000);
    // 超过 dead 阈值仍自称 running 的任务文件（子进程死在中途，永远不会再写
    // 终态）按终态处理：展示最终数字后自动消失，而不是永远挂"可能已停止"。
    const deadThreshold = Number(window.weaverDownloadProgress?.deadThresholdMs) || (15 * 60 * 1000);
    const dead = isRunning && staleMs > deadThreshold;
    // Do not resurrect a completed/dead card when the page itself has just
    // loaded and there is no existing element for it. `dead` must count the
    // same as `!isRunning` here even though state.status still says "running"
    // - otherwise a dead-on-arrival file (page reload after the downloader
    // child already died) falls through to the "!isRunning || dead" branch
    // below with card still null and throws on card.querySelector(...).
    // Retaining an existing card between institutional/browser-fallback
    // hand-off is still just an in-place text update, never a remove/reinsert
    // flash or layout shift.
    if ((!isRunning || dead) && !card) return;
    // 终态（真完成 / 判定已死亡）：展示一次最终结果，10 秒后自动移除卡片。
    // 用户要求"结束了就消失"；死了的任务不消失正是这个抱怨的来源。
    if (!isRunning || dead) {
      if (!card) return; // 页面刚加载时不为已死/已完成的下载复活卡片
      const total0 = Number(state.total) || 0, done0 = Number(state.done) || 0;
      const downloaded0 = Number(state.downloaded) || 0, failed0 = Number(state.failed) || 0;
      card.querySelector('.wv-chat-download-head b').textContent = dead ? '后台静默下载（已停止）' : '后台静默下载已完成';
      card.querySelector('.wv-chat-download-count').textContent = `${done0} / ${total0}`;
      card.querySelector('.wv-chat-download-track span').style.width = `${total0 > 0 ? Math.min(100, Math.round((done0 / total0) * 100)) : 0}%`;
      card.querySelector('.wv-chat-download-detail').textContent = `已下载 ${downloaded0}，失败 ${failed0}${dead ? ' · 长时间无更新，任务已停止' : ''}。此卡片将在 10 秒后自动消失。`;
      card.classList.remove('wv-chat-download-stale');
      if (!downloadCardTimer) {
        downloadCardTimer = window.setTimeout(() => {
          downloadCardTimer = null;
          card.isConnected && card.remove();
        }, 10000);
      }
      return;
    }
    // 运行中但已过 stale 阈值、还没到 dead：用户可以用 × 手动关掉这个提示；
    // 关掉后记住该批次的签名，后续轮询 tick 不会把它重新创建出来。
    const signature = `${state.total}|${String(state.current || '')}`;
    if (downloadCardDismissedFor && downloadCardDismissedFor === signature) {
      card && card.remove();
      return;
    }
    // 新的运行状态到达：取消上一轮终态的 10 秒自动消失，避免误删新批次。
    if (downloadCardTimer) { window.clearTimeout(downloadCardTimer); downloadCardTimer = null; }
    if (!card) {
      card = document.createElement('section');
      card.className = 'wv-chat-download-progress';
      card.innerHTML = '<div class="wv-chat-download-head"><b>后台静默下载</b><span class="wv-chat-download-count"></span><button type="button" class="wv-chat-download-dismiss" title="隐藏此提示（下载在后台继续）">×</button></div>'
        + '<div class="wv-chat-download-track"><span></span></div>'
        + '<p class="wv-chat-download-detail"></p>';
      withScrollAnchor(() => downloadHost.appendChild(card));
    }
    const total = Number(state.total) || 0;
    const done = Number(state.done) || 0;
    const downloaded = Number(state.downloaded) || 0;
    const failed = Number(state.failed) || 0;
    const skipped = Number(state.skipped_or_resumed) || 0;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    // bridge-ui.js's poller stamps __staleMs onto every published state (real
    // file-mtime age, not "time since we last polled"), but previously only its
    // own inline per-row progress bar read it. A downloader child that dies
    // mid-batch never writes a terminal status, so this card - the one that
    // stays visible in the transcript long after that row is gone - would
    // otherwise say "后台静默下载" (running) forever with no way to tell a slow
    // batch from a dead one.
    const stale = staleMs > staleThreshold;
    card.classList.toggle('wv-chat-download-stale', stale);
    card.querySelector('.wv-chat-download-head b').textContent = stale ? '后台静默下载（可能已停止）' : '后台静默下载';
    // 只有"可能已停止"时才露出 ×：正常运行的下载不该被顺手关掉提示。
    const dismissBtn = card.querySelector('.wv-chat-download-dismiss');
    dismissBtn.style.display = stale ? '' : 'none';
    dismissBtn.onclick = () => { downloadCardDismissedFor = signature; card.remove(); };
    card.querySelector('.wv-chat-download-count').textContent = `${done} / ${total}`;
    card.querySelector('.wv-chat-download-track span').style.width = `${pct}%`;
    const current = String(state.current || '').slice(0, 72);
    const staleNote = stale ? ` · 已 ${Math.max(1, Math.round(staleMs / 60000))} 分钟没有更新，任务可能已经停止或崩溃（点右上角 × 可隐藏）` : '';
    card.querySelector('.wv-chat-download-detail').textContent = `已下载 ${downloaded}，失败 ${failed}${skipped ? `，续传/跳过 ${skipped}` : ''}${current ? ` · ${current}` : ''}${staleNote}`;
  }

  function refreshPending() {
    if (!ensureHosts()) return;
    const waiting = pendingCard();
    withScrollAnchor(() => pendingHost.replaceChildren(...(waiting ? [waiting] : [])));
  }

  function chatTopicName() {
    return window.researchWeaver?.activeTopic?.name
      || document.querySelector('#flowTitle')?.textContent?.trim()
      || '未命名课题';
  }
  function syncChatTopicLabel() {
    const label = document.getElementById('chatTopicLabel');
    if (label) label.textContent = `课题对话 · ${chatTopicName()}`;
  }
  // app.js announces every topic create/switch; swap the transcript to match.
  window.addEventListener('weaver:flow-changed', (event) => {
    const flowId = event.detail?.flowId || 'default';
    if (flowId !== chatFlowId) {
      saveChat();   // 切走前把上一个课题还没落盘的增量交给队列，它记得那是哪个会话
      chatFlowId = flowId;
      // 新课题的正文还没有：先清空、停在"正在读取"，读到之前发送是禁用的。
      // 这里绝不 readChat(flowId) —— 正文不再有 localStorage 副本。
      chatMessages = [];
      chatHasMore = false;
      chatNextCursor = null;
      chatTotal = 0;
      chatStorageBusy = true;
      chatStorageError = '';
      focusPendingCardsOnNextRender = true;
      updateComposerState();
      void ensureChatSession(flowId);
    }
    syncChatTopicLabel();
    renderChat();
  });

  // Old conversations are persisted locally, so a renderer-only correction
  // cannot assume every malformed block arrived after this build.  Derive a
  // safe display object without mutating the stored transcript or reviving an
  // old request into something executable.
  function displayMessageForChat(message) {
    if (message?.role !== 'agent') return message;
    const concealed = concealMalformedProtocolBlocks(message?.text);
    const existingFailures = Array.isArray(message.protocolFailures) ? message.protocolFailures : [];
    if (!concealed.failures.length && !existingFailures.length) return message;
    // A newly received message already persists its concealed failure in
    // protocolFailures.  On later renders the historic raw text is inspected
    // again, so concatenate-without-dedup would turn one old safe rejection
    // into two identical red cards after a reload.
    const failures = [...existingFailures, ...concealed.failures].filter((failure, index, all) =>
      all.findIndex((candidate) => candidate?.protocol === failure?.protocol
        && candidate?.target === failure?.target
        && candidate?.guidance === failure?.guidance) === index);
    return { ...message, text: concealed.text, protocolFailures: failures };
  }

  // 正文存储不可用/还没读完时的提示条。绝不静默：读不到就说读不到，页面上
  // 其余部分照常渲染（"不空白"），发送按钮在 updateComposerState 里禁用。
  function chatStorageNotice(kind, text) {
    const row = document.createElement('div');
    row.className = `wv-msg wv-msg-system wv-chat-storage-${kind}`;
    row.setAttribute('role', 'status');
    row.setAttribute('aria-live', 'polite');
    const head = document.createElement('div');
    head.className = 'wv-msg-head';
    const who = document.createElement('span');
    who.className = 'wv-msg-who';
    who.textContent = kind === 'error' ? '正文未保存' : '正文存储';
    const body = document.createElement('div');
    body.className = 'wv-msg-body';
    body.textContent = text;
    head.appendChild(who);
    row.append(head, body);
    if (kind === 'error') {
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'wv-btn wv-btn-sm wv-chat-storage-retry';
      retry.textContent = '重试连接并读取';
      retry.addEventListener('click', () => { void bootstrapChat(true); });
      row.appendChild(retry);
    }
    return row;
  }

  // "未保存"标记 + 复制 + 重试：既不能伪称已保存，也不能让人只能靠截图救回
  // 一段正文。重试走的是同一条写队列，不新增任何写路径。
  function unsavedBadge(message) {
    const box = document.createElement('div');
    box.className = 'wv-msg-unsaved';
    const label = document.createElement('span');
    label.textContent = '未保存：这条还没写进 Vault，刷新页面会丢。';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'wv-btn wv-btn-sm';
    copy.textContent = '复制正文';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(message.text || ''));
        window.researchWeaver?.toast?.('已复制这条未保存的正文。');
      } catch { window.researchWeaver?.toast?.('复制失败，请手动选中文字复制。'); }
    });
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'wv-btn wv-btn-sm';
    retry.textContent = '重试保存';
    retry.addEventListener('click', () => { void retryChatPersistence(); });
    box.append(label, copy, retry);
    return box;
  }

  // 八种确认类型各自的载荷字段与中文名（锁定条与账本提示都要用）。
  const CONFIRMATION_ITEMS = {
    action: 'actions', draft: 'drafts', legacyNoteEdit: 'legacyNoteEdits', run: 'runs',
    normalize: 'normalizations', plot: 'plots', plotRevision: 'plotRevisions',
    suggestReconstruction: 'suggestReconstructions',
  };
  const CONFIRMATION_LABEL = {
    action: '面板动作', draft: '记录草稿', legacyNoteEdit: '既有笔记修改', run: '对话运行',
    normalize: '数据规范化', plot: '绘图', plotRevision: '图表改版', suggestReconstruction: '种子重建',
  };

  function confirmationDetailText(detail) {
    if (!detail) return '';
    try {
      const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
      return text.length > 160 ? `${text.slice(0, 157)}…` : text;
    } catch { return ''; }
  }

  /* 锁定态卡片：claimed / confirmed / abandoned。
   *
   * claimed 是崩溃窗口的形状——"点了确认、但没人知道那次写入到底发生没有"。这时
   * 唯一正确的做法是不再执行、去账本和 Vault 里核对，然后由研究员落一个终态。
   * 抢着重跑一次才是真正的危险：experiment.transition 会再改一遍研究记录。 */
  function confirmationLockBar(message, kind) {
    const items = message?.[CONFIRMATION_ITEMS[kind]];
    if (!Array.isArray(items) || !items.length) return null;
    const state = confirmationState(message, kind);
    if (state !== 'claimed' && state !== 'confirmed' && state !== 'abandoned' && state !== 'failed') return null;
    const entry = message.confirmations?.[kind] || {};
    const card = document.createElement('div');
    card.className = `wv-action-card wv-confirmation-lock is-${state}`;
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-title';
    title.textContent = state === 'claimed'
      ? `${CONFIRMATION_LABEL[kind]}：正在核对执行结果`
      : state === 'failed'
        ? `${CONFIRMATION_LABEL[kind]}：本次没有生效`
        : `${CONFIRMATION_LABEL[kind]}：${state === 'confirmed' ? '已执行' : '已放弃'}`;
    const meta = document.createElement('div');
    meta.className = 'wv-faint';
    meta.textContent = `一次性编号 ${entry.operationId || '（旧记录没有编号）'}${entry.at ? ` · ${entry.at}` : ''}`
      + `${entry.detail ? ` · ${confirmationDetailText(entry.detail)}` : ''}`;
    card.append(title, meta);
    if (state === 'failed') {
      // §2.4：只是一段说明 + 明确的下一步，**没有**执行按钮。原位重试被拿掉了，
      // 因为"这次投递的结果未知"时把同一个请求再发一次正是要避免的事。
      const note = document.createElement('div');
      note.className = 'wv-faint';
      note.textContent = '这张卡片不会再执行。控制器这次没有完整成功，磁盘上可能已经有一部分写入；请核对结果后重新发起一遍这次请求（需要预览的类型会重新预览），那会是一次新的确认。';
      card.appendChild(note);
      return card;
    }
    if (state !== 'claimed') return card;

    const note = document.createElement('div');
    note.className = 'wv-faint';
    note.textContent = '这张卡片已经投递过（或崩在投递前后），不会再执行第二次。请先核对 Vault 里是否已经出现这次写入，再选择下面两项之一。';
    const ledger = document.createElement('div');
    ledger.className = 'wv-faint';
    ledger.textContent = '正在查询执行账本…';
    const bar = document.createElement('div');
    bar.className = 'wv-action-bar';
    const markDone = document.createElement('button');
    markDone.type = 'button';
    markDone.className = 'wv-action-confirm';
    markDone.textContent = '已核对：这次执行生效了';
    markDone.addEventListener('click', () => { void resolveClaimedConfirmation(message, kind, entry.operationId, 'confirmed'); });
    const markFailed = document.createElement('button');
    markFailed.type = 'button';
    markFailed.className = 'wv-action-cancel';
    markFailed.textContent = '已核对：这次没有生效';
    markFailed.addEventListener('click', () => { void resolveClaimedConfirmation(message, kind, entry.operationId, 'failed'); });
    // 编号缺失（P0 之前的老卡片）时不能拿一个假编号去 resolve：只提示人工处理。
    if (entry.operationId) bar.append(markDone, markFailed);
    else markFailed.disabled = true;
    card.append(note, ledger, bar);
    if (entry.operationId) {
      bridgeFetchRaw(`/v1/chat/operations/${entry.operationId}`)
        .then(({ status, payload }) => {
          ledger.textContent = status === 200
            ? `账本记录：${payload.status}${payload.error ? `（${payload.error}）` : ''} · ${payload.at || ''}`
            : `账本里查不到这个编号（HTTP ${status}）——说明它崩在占位之前，磁盘上应该没有这次写入。`;
        })
        .catch((error) => { ledger.textContent = `账本查询失败：${chatStorageErrorMessage(error)}`; });
    }
    return card;
  }

  function loadEarlierRow() {
    const row = document.createElement('div');
    row.className = 'wv-chat-load-earlier';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wv-btn wv-btn-sm';
    button.textContent = `加载更早（已载入 ${chatMessages.length} / ${chatTotal} 条）`;
    button.addEventListener('click', () => { void loadEarlierChat(); });
    row.appendChild(button);
    return row;
  }

  function renderChat() {
    if (!narrative) return;
    const fragment = document.createDocumentFragment();
    if (chatStorageError) fragment.appendChild(chatStorageNotice('error', `${chatStorageError}\n对话正文没有保存到 Vault，也没有从 Vault 读回来。已读到的历史仍显示在下面；发送已禁用，并且不会退回浏览器本地存储。`));
    else if (chatStorageBusy) fragment.appendChild(chatStorageNotice('pending', '正在从 Vault 读取本课题的对话正文…'));
    if (chatHasMore) fragment.appendChild(loadEarlierRow());
    if (!chatMessages.length && !chatStorageError && !chatStorageBusy) {
      fragment.appendChild(chatBubble('system', `这是「${chatTopicName()}」的专属对话区。每个研究主题的对话相互独立，新建或切换主题时对话记录会一起切换。`));
    }
    for (const storedMessage of chatMessages) {
      const msg = displayMessageForChat(storedMessage);
      const unsaved = isChatMessageUnsaved(msg);
      if (msg.role !== 'agent' || String(msg.text || '').trim()) {
        const bubble = chatBubble(msg.role, msg.text);
        if (unsaved) bubble.appendChild(unsavedBadge(msg));
        fragment.appendChild(bubble);
      }
      const runRequest = runRequestCard(msg);
      if (runRequest) fragment.appendChild(runRequest);
      const card = actionCard(msg);
      if (card) fragment.appendChild(card);
      const draft = draftCard(msg);
      if (draft) fragment.appendChild(draft);
      const legacyNoteEdit = legacyNoteEditCard(msg);
      if (legacyNoteEdit) fragment.appendChild(legacyNoteEdit);
      const normalizeRequest = normalizeRequestCard(msg);
      if (normalizeRequest) fragment.appendChild(normalizeRequest);
      const plotRequest = plotRequestCard(msg);
      if (plotRequest) fragment.appendChild(plotRequest);
      const plotRevision = plotRevisionCard(msg);
      if (plotRevision) fragment.appendChild(plotRevision);
      const protocolFailure = protocolFailureCard(msg);
      if (protocolFailure) fragment.appendChild(protocolFailure);
      const suggestReconstruction = suggestReconstructionCard(msg);
      if (suggestReconstruction) fragment.appendChild(suggestReconstruction);
      // 锁定态（claimed/confirmed/abandoned）不是"卡片上的一个开关"，而是这次
      // 确认自己的状态，所以单独渲染在卡片下面，且不随业务卡片的重绘而消失。
      for (const kind of CONFIRMATION_KINDS) {
        const lock = confirmationLockBar(msg, kind);
        if (lock) fragment.appendChild(lock);
      }
    }
    narrative.replaceChildren(fragment);
    summaryHost = null;
    downloadHost = null;
    pendingHost = null;
    ensureHosts();
    refreshRunSummary();
    refreshDownloadProgress();
    refreshPending();
    updatePendingConfirmationButton();
    const firstPending = narrative.querySelector('[data-confirmation-state="pending"]');
    if (focusPendingCardsOnNextRender && firstPending) firstPending.scrollIntoView({ block: 'center' });
    else narrative.scrollTop = narrative.scrollHeight;
    focusPendingCardsOnNextRender = false;
    updateChatStorageStatus();
  }

  // A task can also end as 'cancelled'. Waiting only for completed|failed meant
  // a cancelled turn span the spinner for the full timeout with no explanation.
  const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

  async function pollTaskFull(taskId) {
    for (let i = 0; i < 800; i++) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const info = await bridgeFetch(`/v1/tasks/${taskId}`);
      if (pending) {
        pending.status = info.status || pending.status;
        // The Bridge narrates progress as 'stage' events; surfacing the latest
        // one turns a blind spinner into something a user can judge.
        const stages = (info.events || []).filter((item) => item.type === 'stage');
        if (stages.length) pending.stage = stages[stages.length - 1].text;
        // 'step' 事件是过程明细（思考/工具调用/命令返回），去重后保留最近若干条
        // 展示在思考卡片里，让用户看见 Agent 在做什么而不是盲等。
        const steps = (info.events || []).filter((item) => item.type === 'step').map((item) => item.text);
        pending.steps = [...new Set(steps)].slice(-12);
      }
      if (TERMINAL.has(info.status)) return info;
    }
    throw new Error('Agent 超过 12 分钟仍未返回，已停止等待。可在 npm start 窗口查看 CLI 是否卡住。');
  }

  // task.finalMessage is only populated for adapters whose output the Bridge
  // parses (Codex `--json`). Everything else has to be recovered from the event
  // log, and a failure there is far more useful to show than a generic message.
  function extractReply(task) {
    const direct = String(task.finalMessage || '').trim();
    if (direct) return { role: 'agent', text: direct };
    const events = Array.isArray(task.events) ? [...task.events].reverse() : [];
    const result = events.find((item) => item.type === 'result')?.text?.trim();
    if (result) return { role: 'agent', text: result };
    const failure = events.find((item) => item.type === 'error')?.text?.trim();
    if (failure) return { role: 'system', text: `Agent 未给出回复：${failure}` };
    if (task.status === 'cancelled') return { role: 'system', text: '已取消本轮对话。' };
    return { role: 'system', text: '任务结束，但 Bridge 没有返回可展示的内容。' };
  }

  // Both Codex JSONL and Claude's --output-format json envelope are normalized
  // by the Bridge into task.finalMessage. Keep the selected conversational
  // Agent instead of silently forcing every research turn through Codex.
  function chatProfile() {
    // Orchestrator-selected agent takes priority
    if (window.weaverOrchestrator) {
      const selectedId = window.weaverOrchestrator.getSelectedAgent();
      if (selectedId && zhiyanBridge.agents.some((a) => a.id === selectedId && a.installed)) {
        const match = (window.researchWeaver?.profiles || []).find((p) => p.adapterId === selectedId);
        if (match) return match;
        return { id: selectedId, name: selectedId, adapterId: selectedId, role: '' };
      }
    }
    const profiles = window.researchWeaver?.profiles || [];
    const installed = (id) => zhiyanBridge.agents.some((agent) => agent.id === id && agent.installed);
    // 科研车道优先：claude-research 有 WebSearch/WebFetch + 受限 Vault MCP，
    // 不暴露 Bash/PowerShell/Write/Edit。
    // + 白名单 MCP，是唯一能执行受控联网核查与 Vault 只读检索的聊天适配器；
    // 不存在时退回原只读适配器，行为与之前完全一致。
    if (installed('claude-research')) {
      const researchProfile = profiles.find((profile) => profile.adapterId === 'claude-research');
      if (researchProfile) return researchProfile;
      return { id: 'claude-research', name: 'claude-research', adapterId: 'claude-research', role: '' };
    }
    const codex = profiles.find((profile) => profile.adapterId === 'codex' && installed('codex'));
    if (codex) return codex;
    return (typeof runnableProfile === 'function')
      ? runnableProfile({ type: 'agent', profileId: 'research-theory-agent' })
      : null;
  }

  // 车道能力声明：告诉模型当前适配器到底有没有网络。codex 沙箱禁网——
  // 不说清楚的话它会沉默地只用本地库硬答（2026-08-21 实测复现）。
  function laneCapabilities(adapterId) {
    if (adapterId === 'claude-research') {
      return `你当前在「科研车道」（claude-research）：可以使用 WebSearch、WebFetch，并可通过受限 mcp__scholarium__* 工具搜索/读取 Vault 安全文本；没有 Bash、PowerShell、Write 或 Edit。读取本机 Scholarium/Obsidian 时必须优先使用受限 MCP，禁止用 WebFetch、curl 或猜测 localhost 端口访问本机 Bridge。凡涉及文献、DOI、配方、实验数据的问题，必须联网核查真实来源（OpenAlex/Crossref/WebSearch），不允许只凭本地文献库或记忆作答；本地库命中只作补充。`;
    }
    if (adapterId === 'codex') {
      return `你当前的适配器（codex）没有网络访问能力（沙箱禁网），只能使用本地文件与文献库。若问题需要联网核查（文献、DOI、最新数据），在回答开头明确说明"当前车道无法联网，以下仅基于本地库"，并建议研究员改用 claude-research 车道重问。`;
    }
    return '';
  }

  // ── Scholarium 面板控制能力 ─────────────────────────────────────
  // 注入到每轮对话 prompt 的能力清单。分两层：
  // 1. L0 只读：agent 直接用 WebFetch 打 GET /v1/scholarium/state，立即拿数据；
  // 2. L1 写入：agent 只能「请求」——输出 ```scholarium-action  fenced 块，
  //    由面板解析后渲染成确认卡片，用户点击才投递队列执行。模型永远够不到
  //    写路径本身，这和 action-registry 的 requires_confirmation 是同一道闸。
  function scholariumCapabilities() {
    // DEF-003（2026-08-27）：这份能力清单随 prompt 送达 Bridge 拉起的 CLI 进程，
    // 它跑在页面之外，没有"当前 origin"的概念——相对路径 /bridge/... 拿去
    // WebFetch 不可用，模型只能瞎猜地址（实测猜成 27123 端口，ECONNREFUSED）。
    // 这里解析成绝对 URL：页面 origin + /bridge 代理前缀。走代理是对的——
    // start-local.js 把 /bridge/* 转发给本机 Bridge 并注入令牌，CLI 侧永远
    // 不需要也拿不到令牌本身。
    return `你可以直接读取和操作研究员的 Scholarium 插件（Obsidian 里的科研管理系统）。

【读取：立即执行】对任何"库里有什么/我的日程/订阅文章评分"类问题，使用 mcp__scholarium__scholarium_state（参数 action 与 input）拿真实数据再回答，不要凭记忆编造。要查整个 Obsidian 仓库中的文件，使用 mcp__scholarium__vault_search；要读取命中的文本文件，使用 mcp__scholarium__vault_read。MCP 是本地只读控制通道，不依赖 localhost WebFetch，也不需要 Bash/PowerShell。
可用读取动作：
- workspace.get_state —— 博士工作台。input {"section":"timeblocks|checkin|tasks|captures|focus|habits|emotions|..."} 取某分区；不带 input 返回各分区摘要。
- material.list —— 素材库全部条目和分类。
- project.list / project.get —— 课题列表 / 单个课题（input {"display_id":"PRJ-001"}）。
- experiment.scan_outcomes —— 实验记录扫描（拿 experiment_uid）。
- workspace.timeblock_drift_audit —— 时间块↔实验正式关联的漂移检查（input 可选 {"project_uid":"..."} 限定课题）。返回每条已关联时间块的 flags：orphaned（关联的实验记录已不存在）、blocked（实验仍有未清 blocked_by）、unreviewed（review_status 不是 confirmed）、unbackfilled（日期已过但从没人回填过 execution_status——最基础的一类，该主动问）、stale（日期已过、已经回填过 execution_status，但实验记录状态没跟上——回填了但没传导到正式记录）。unbackfilled 和 stale 互斥。
- idea.list —— Idea 卡片列表。
- decision.list —— 已落盘的决策记录（input 可选 {"project_uid":"..."} 限定课题）；project.get 的返回里也已经带了当前课题的 decisions，多数情况不用单独调这个。
- lesson.list —— 已确认的经验候选（input 可选 {"project_uid":"..."} 限定课题；project_uid 为空的经验是跨课题都成立的方法论层面经验，任何限定下都会带上）。project.get 的返回里也已经带了当前课题相关的 lessons，多数情况不用单独调这个。经验候选怎么从执行回填/漂移/决策里提炼、怎么写成 scholarium-draft，见对话协议规则17——只在研究员明确要求总结经验时才做，不主动提炼。
- workspace.rescan_pending —— 全量（不限于当前绑定课题）回扫：所有已关联实验的时间块里带 flags 的条目（orphaned/blocked/unreviewed/unbackfilled/stale），以及所有 active 且填了 trigger_condition 的决策。每条都带一个稳定的 marker 字符串（RESCAN-TB:<id> / RESCAN-DEC:<uid>），用来和已经生成过的工作台任务去重。返回里还带 due（布尔，是否到了该提醒的时候——节流周期由研究员在 bridge.config.json 里配置，默认每天最多一次，日期数学在服务端算好，不要自己心算）、last_checked_at（上次真正提醒是什么时候，null 表示从没提醒过）、cadence_days、next_due_at。见下方规则 9，due 是这批数据能不能拿去提议任务的唯一判据。
示例：调用 mcp__scholarium__scholarium_state，参数 {"action":"workspace.get_state","input":{"section":"timeblocks"}}。若 MCP 工具真实返回错误，如实报告工具名和错误；不得把“没有调用工具”误报为 Bridge 不在线。

【修改：只能请求，不能自称已做】要修改 Scholarium 里的任何内容（排日程、打卡、记心情/习惯、加任务、登记素材、改文章评分、标已读收藏、给实验记日志），在回复末尾输出一个或多个如下格式的代码块：
\`\`\`scholarium-action
{"action":"workspace.timeblock_add","input":{"date":"2026-08-21","start":"09:00","end":"11:00","title":"HPLC 测液相产物"},"reason":"研究员要求"}
\`\`\`
可用修改动作（input 字段）：
- workspace.timeblock_add {date:YYYY-MM-DD, start:HH:MM, end:HH:MM, title, category?, note?, experiment_uid?, experiment_display_id?} —— 排日程；这段时间对应某个已存在的 EXP 时，用 experiment_uid（从 experiment.scan_outcomes/project.get 读到的真实 uid）或 experiment_display_id（人类可读的 "EXP-007"，会被服务端解析成 uid）做正式关联——不要只把 EXP 编号写进 note，note 不参与关联判断，系统不会去解析它。
- workspace.timeblock_update {id, 待改字段, experiment_uid?, experiment_display_id?, execution_status?, execution_note?} —— 同上；experiment_uid 传空字符串可解除既有关联。execution_status（"completed"|"not_completed"|"blocked"）是执行回填专用字段：研究员告诉你某块已排期的时间实际发生了什么后，用它写回最小事实，execution_note 放研究员实际说的情况；execution_status 必填，execution_note 可留空但不能反过来只给 note 不给 status / workspace.timeblock_remove {id}
- workspace.checkin_upsert {date, period:morning|afternoon|evening, note?, clear?} —— 考勤打卡
- workspace.habit_add {name, cadence?} / workspace.habit_log {habit_id, date?, done?, note?}
- workspace.emotion_log {mood, score?, note?, date?} —— 记心情
- workspace.task_add {title, due?, note?} / workspace.task_update {id, title?/status?/due?/note?} / workspace.task_remove {id}
- workspace.focus_log {title, date?, start?, end?, minutes?} —— 补记专注
- workspace.capture_add {text} —— 速记
- material.add {path:vault相对路径, name?, category?} / material.update {id, name?/category?} / material.remove {id} / material.category_add {name} / material.category_remove {name} —— 删除分类前必须先用 material.list 确认没有任何条目仍在使用它；被使用的分类会被服务端拒绝。
- rss.set_article_score {article_id, overall_score:0-100, reason:必填} —— 改单篇文章评分
- rss.mark_article {article_id, read?, starred?} —— 标已读/收藏
- experiment.append_note {experiment_uid, text} —— 给实验记录追加日志
- experiment.validate_chem {smiles? 或 reaction_smiles?（至少给一个）} —— 只读化学门禁：检查结构能否解析；反应式检查逐元素守恒和净电荷守恒。只有返回 valid:true 且 status:balanced 才能称为已配平并继续写入。
- experiment.insert_chem {experiment_uid, smiles? 或 reaction_smiles?（至少给一个）, title?, type?, molfile?, ket?} —— 往实验记录正文插入一个化学结构块，研究员点"编辑"能直接用 Ketcher 打开继续画。它只固化结构表示，不自动证明方程式正确：调用前必须确认物种来源和反应物/产物边界，逐元素核对原子数与净电荷，涉及氧化还原再核对电子/氧化数，涉及离子/配位物再核对价态与配位数；系数化为最小整数比并给出人类可读方程式。Ketcher 把重复物种画成多个图形不等于显示了系数。任一项未核实就标为“待核验/方程式不完整”，拿不准就问研究员或用 experiment.append_note 写文字，绝不编造 SMILES、分子式、产物或“已配平”结论。
- experiment.transition {experiment_uid, to_status, reason:必填} —— 推进实验生命周期状态（idea→designed→ready→running→data_pending→analyzing→concluded→integrated，一次只能走到紧挨着当前状态的下一步，不能跳级）。这个动作不经 Obsidian 队列，走独立的两阶段确认通道，点确认后 Bridge 直接执行、不用等 Obsidian 打开。
- experiment.invalidate_provenance {experiment_uid, data_origin:"simulated"|"demonstration"|"unverifiable", reason:必填, data_provenance_note:必填} —— 研究者完成来源判定后，使实验进入 invalidated，并在一个带恢复快照的事务中同步降级其 Evidence、撤出 Hypothesis 正式关系。只有研究者在本轮明确声明来源类别并要求处置时才可请求；Agent 的文件推断、审计发现或“看起来像模拟”都不构成研究者声明。unknown 是尚未判定，unverifiable 是研究者已完成追溯但仍无法核实，两者不得混用。
规则：
1. 需要 id 的修改，先用读取动作查到真实 id，禁止编造。
2. 日期推算以对话中给出的"今天"日期为准，"明天"=今天+1 天。
3. 输出动作块后，在正文里明确说"已提交修改请求，等你确认后生效"——绝对不能声称修改已经完成，确认按钮在研究员手里。
4. 研究员只是询问或讨论时不要输出动作块。
5. 排日程用 workspace.timeblock_add，加没有具体时间的待办才用 workspace.task_add——两者不能混用。研究员说"安排/排进/几点做什么/设计一天一周的实验"这类带时间意图的请求，即使没给出具体日期时间，也要用 timeblock_add 给出你安排的日期/时间段（并在正文说明这是你排的、请确认），不要因为怕排错时间就退化成一堆不带时间的 task_add，那样研究员在工作台的日程视图里什么都看不到。
6. 这段时间对应某个已存在的 EXP-00X（研究员点名了，或上文 project.get/experiment.scan_outcomes 里能查到）时，timeblock_add/update 必须带上 experiment_uid 或 experiment_display_id 做正式关联，不能只在 note 里写"对应 EXP-007"——那样系统读不出这条关联，之后既查不到这块时间是为哪个实验排的，也没法做漂移检查。不确定具体是哪个 EXP、或研究员还没定下来时，宁可不关联，也不要猜一个填上去。
7. 新增指向某个 EXP 的时间块前，或研究员在讨论本周/下周安排时，建议先用 workspace.timeblock_drift_audit 查一遍：若目标实验仍 blocked（有未清 blocked_by）或 unreviewed（review_status 非 confirmed），要在正文里如实提醒"这个实验还没准备好/还没审核，按计划排上但可能执行不了"，不要当没看见就直接排；若发现已有关联时间块被标 unbackfilled（日期已过、从没人说过实际发生了什么），主动问一句这块时间完成情况；被标 stale（已经回填过但实验记录没跟上）则告诉研究员这个执行落差，这不是你的错误。
8. 研究员回答了某个已排期时间块的完成情况（完成/没完成/被卡住，附带原因或结果）：输出 workspace.timeblock_update {id, execution_status, execution_note} 写回最小事实；若这条回答本身构成一条值得记录的实验观察，同时输出 experiment.append_note {experiment_uid, text} 追加进实验日志——两个动作块可以在同一条回复里一起给。研究员的话若明确到"该推进状态了"（不只是汇报完成情况，而是一次状态判断），可以额外输出 experiment.transition {experiment_uid, to_status, reason}——2026-08-27 起这条通道已接通（走 /v1/edits 两阶段确认，面板会同步执行、不用等 Obsidian 轮询）。to_status 只能是生命周期里紧挨着当前状态的下一步，不能跳级；reason 必填。拿不准算不算"正式判断"时，宁可只做 append_note、在正文里问一句要不要推进，不要替研究员做这个决定。
9. 这次对话是本次会话的第一条消息（没有此前对话）时，先调用 workspace.rescan_pending 做一次全量回扫。只看它返回的 due：
   - due 为 false：说明距上次提醒还没到节流周期（cadence_days 天），什么都不用做——不要提议任务，也不要在正文里提"我查了一下"，当作这一步没发生过。
   - due 为 true：再调用 workspace.get_state {"section":"tasks"} 看已有任务的 note 里有没有 RESCAN-TB:<id> / RESCAN-DEC:<uid> 这样的 marker——已经出现过 marker 的条目不再重复提议。对剩下真正新出现的条目，按 blocked/unreviewed 优先、其次 unbackfilled、再 stale、最后决策触发条件的顺序，最多挑 8 条，各输出一个 workspace.task_add {title, note}，note 里必须原样带上对应 marker（比如 "RESCAN-TB:tb-20260810-01 · unbackfilled：日期已过未回填"），这样它才能被下一轮识别、去重。即使去重后一条新的都没有，也要调用 mcp__scholarium__rescan_checkpoint_mark，把节流计时重置——这一步不需要研究员确认，它只记录“什么时候查过”，不改任何研究内容。只有 due 为 true 这一分支才允许调用，due 为 false 时绝不能调用。
10. 研究员在描述某个实验的反应体系、底物或产物，而对应的 EXP 记录里还没有这条结构时，可以输出 experiment.insert_chem 把它固化进笔记正文。先调用 experiment.validate_chem；只有 valid:true 且 status:balanced，才允许继续调用 experiment.insert_chem 并传 strict_validation:true。验证器返回 unbalanced、invalid 或 unavailable 时禁止写入反应式，改用 experiment.append_note 记录“待核验/方程式不完整”。前提是结构本身来自研究员的话、文献原文或已有记录——你自己推断出来的、或只是"大概是这么个反应"的，一律不要写：一条编造的 SMILES 在笔记里和一条真实结构长得一模一样，事后没人分得清。

【对话运行：只能请求，确认后执行】当研究员明确要求“运行完整 Pipeline”“只检索文献”或“从某个步骤重新运行”时，在回复末尾输出一个且只输出一个运行块。你不能声称任务已经启动；面板会把它变成确认卡，研究员点击后才运行。
- 完整 Pipeline：
\`\`\`scholarium-run
{"operation":"pipeline.run","topic":"研究主题或问题","reason":"研究员明确要求运行完整链条"}
\`\`\`
- 仅检索文献（不下载、不生成证据卡/图谱/手稿）：
\`\`\`scholarium-run
{"operation":"literature.search","query":"检索主题或问题","reason":"研究员明确要求只检索"}
\`\`\`
- 将已经核实的 DOI 清单放入“文献订阅 → Pipeline 待处理”，供研究员逐篇选择下载，并在确认后直接打开该列表：
\`\`\`scholarium-run
{"operation":"literature.queue","items":[{"doi":"10.xxxx/xxxx","title":"论文标题","url":"https://doi.org/10.xxxx/xxxx","reason":"P0 · 摘要命中核心问题"}],"open":true,"reason":"研究员要求加入人工下载队列"}
\`\`\`
- 研究员同时要求扫描摘要、打标签并保存文献笔记时：先核实每篇摘要，再输出一个 \`\`\`scholarium-draft 块，items 中每篇一份 Markdown，建议路径为 Literature/<安全文件名>.md。每篇 frontmatter 只写 paper 的科研内容字段：type: paper、title、source（真实 DOI/出版方 URL）、doi、tags；uid、PAPER 编号、schema_version、时间戳与 AI 草稿状态由 Bridge 生成。JSON 顶层设 "open_after_commit":true。不得把没有拿到的摘要补造出来；只拿到元数据时明确写“摘要待补”。队列块与草稿块可以在同一回复中各出现一次，二者会分别显示确认卡。
- 修改已经存在的人工实验笔记时，不得输出 scholarium-draft（它只会新建文件，绝不覆盖）。只允许修改 \`Experiments/\` 下的既有 Markdown，必须输出一个严格的三反引号 \`\`\`scholarium-note-edit 围栏块：{"path":"Experiments/现有文件.md","content":"完整修改后 Markdown","reason":"研究员要求","changes":[{"location":"位置","before":"原文","after":"修改后"}]}。changes 至少列出每处实质修改，面板会把它渲染成确认表格；研究员点击确认后 Bridge 才会预览、检测并发改动并原子写入。不得用这条路径修改 Research/ 下的 schema-v1 对象、\`.obsidian\` 文件或任何非 Markdown 文件。
- 研究员想对素材库里的 XLSX 工作簿绘图时：先输出一个 \`\`\`scholarium-normalize 围栏块，把它结构化转换成一份带源哈希的 UTF-8 CSV（TXT/DAT 不需要这一步，绘图器直接嗅探它们的分隔符；只有确实需要把分隔符和表头行固化下来时才规范化）：
\`\`\`scholarium-normalize
{"data_path":"Materials/kinetics.xlsx","sheet":"Raw","header_row":2,"formula_mode":"cached","reason":"工作簿有多个工作表，研究员点名用 Raw"}
\`\`\`
data_path 必须是 Vault 内相对路径，后缀只能是 .csv/.tsv/.txt/.dat/.xlsx。sheet 只在工作簿有多个可见工作表时必填，且必须是研究员点名或你实际读到的工作表名——不要猜一个填上去。header_row 不确定时整个字段省略，交给 Skill 自动识别，不要编一个行号。formula_mode 默认 cached（读公式格已缓存的值）；研究员明确要求保留公式文本时用 formula_text；要求"有公式就别转"时用 reject。
绝不要输出 allow_missing_formula_cache：公式格没有缓存值时 Skill 会拒绝，这是对的——那种情况下转换出来的是一整列空白，接着画出的图看着完全正常。只有研究员能在确认卡上自己解除这道闸，你没有办法知道那些公式本该算出什么。
这条链是两段的，不要合并：规范化完成后面板会告诉研究员产物路径，绘图是另一次明确请求，x/y 列与图型必须由研究员指定。不要在同一条回复里既请求规范化又声称已经画好图。原文件全程只读，转换不清洗、不过滤、不平滑任何数值；你也不得在正文里把转换描述成"数据已整理好"。
- 研究员指定了数据文件和要画的列之后，输出一个 \`\`\`scholarium-plot 围栏块请求出图（data_path 接受 .csv/.tsv/.txt/.dat；绘图器会嗅探 TXT/DAT 的分隔符、跳过注释行，分隔符有歧义时会拒绝而不是猜。只有 XLSX 工作簿必须先走上面的 normalize）：
\`\`\`scholarium-plot
{"data_path":"Materials/_normalized/<哈希>/normalized.csv","x_column":"time","y_columns":["signal"],"plot_kind":"line","title":"信号随时间变化","chart_style":{"theme":"publication"},"reason":"研究员点名 time 对 signal"}
\`\`\`
x_column / y_columns 必须是你在该文件表头里实际读到的列名，不得猜测、不得改写大小写或空格。plot_kind 只能是 line/scatter/bar。拿不准画哪一列就先问研究员，不要挑一个看起来合理的填上去——图画出来之后没人会回头核对列名选得对不对。
- 只改已有图的外观（配色、字号、网格、图例、坐标范围、标注等）时，用 \`\`\`scholarium-plot-revise，指向那张图的 manifest：
\`\`\`scholarium-plot-revise
{"target_manifest_path":"Materials/_analysis/<目录>/plot-manifest.json","chart_style":{"theme":"soft","show_grid":false,"series_colors":["#3366cc"]},"reason":"研究员要求去掉网格线"}
\`\`\`
改版块里绝不要写 data_path、x_column、y_columns 或 save_mode——换数据或换列就是另一张图，必须走完整的 scholarium-plot 重新确认；覆盖旧版本只能由研究员在卡片上勾选。整块带了这些字段会被直接拒绝。
你永远不直接编辑 SVG，只提交渲染参数，由绘图器从源 CSV 确定性重画——这样每一张图都始终能从数据复现。也不要把改样式说成"更新了数据"或"修正了曲线"。
- 从最近一次 Pipeline 的指定步骤重跑：
\`\`\`scholarium-run
{"operation":"pipeline.rerun","run_id":"latest","from_step":"search","query":"可选：研究员明确给出的新检索式","reason":"研究员要求从检索步骤重新运行"}
\`\`\`
可用 from_step 只有：query-builder、concept-matrix、query-refine、search、quality-gate、extra-providers、final-screen、degraded-gate、dedupe、download、nature-reader、obsidian-bases、knowledge-graph、deep-research、nature-writing、nature-polishing。研究员说“第 3.7 步”时用 quality-gate；说“重新检索”时用 search；说“重新下载”时用 download。除非研究员点名某个真实运行 id，否则 run_id 用 latest，禁止编造 id。研究员同时明确给出新课题主题时可加 topic；明确给出新 Boolean 检索式时可加 query。修改主题会由面板安全回退到第 1 步，修改 query 且所选步骤晚于 search 时会回退到 search。旧任务没有状态包或目标步骤缺上游状态时，面板会拒绝跨步并解释需要从哪里重跑。研究员只是讨论 Pipeline、询问为什么失败或问某一步做什么时，不输出运行块。`;
  }

  // 从 agent 回复中剥离 ```scholarium-action 块。纯函数核心在
  // chat-actions-core.js（双端模块，有单测）；这里只做绑定。
  const parseActionRequests = window.weaverChatActionsCore.parseActionRequests;
  const detectWriteClaim = window.weaverChatActionsCore.detectWriteClaim;
  // ```scholarium-run``` 块只描述运行意图；由聊天确认卡调用浏览器侧编排器。
  const parseRunRequests = window.weaverChatActionsCore.parseRunRequests;
  // ```scholarium-draft 块：新建 Markdown 记录（EXP/HYP 等）的保存请求，
  // 走 /v1/drafts/batch 预防式两段提交（设计文档 §7，不走 full 车道）。
  const parseDraftRequests = window.weaverChatActionsCore.parseDraftRequests;
  const parseLegacyNoteEditRequests = window.weaverChatActionsCore.parseLegacyNoteEditRequests;
  // ```scholarium-normalize``` 块：把 XLSX/TXT/DAT 结构化转换成带源哈希的
  // UTF-8 CSV（Materials/_normalized/<hash>/），原文件只读、数值不做任何清洗。
  // 模型只能提议，研究员在卡片上确认后才由 Bridge 调 sch-data-normalize。
  const parseNormalizeRequests = window.weaverChatActionsCore.parseNormalizeRequests;
  // 绘图与改图都只传可复现的 manifest 参数，不能把模型生成的 SVG 当作数据图。
  // revise 解析器尤其不接受 source/column 字段，防止“改样式”偷换数据配方。
  const parsePlotRequests = window.weaverChatActionsCore.parsePlotRequests;
  const parsePlotRevisionRequests = window.weaverChatActionsCore.parsePlotRevisionRequests;
  const concealMalformedProtocolBlocks = window.weaverChatActionsCore.concealMalformedProtocolBlocks;
  // ```scholarium-suggest-reconstruction``` 块：比 scholarium-action/-draft 都
  // 更弱的一类——模型只能表达"建议从这个种子 DOI 做一轮证据重建"的意图，卡片
  // 只有一个跳转按钮，点击后打开项目面板的种子重建弹窗，不发起任何网络请求
  // 或写入。真正的候选发现/审计/下载/准入全部在弹窗里，受各自已有权限车道约束。
  const parseSuggestReconstructionRequests = window.weaverChatActionsCore.parseSuggestReconstructionRequests;

  // 草稿确认执行：preview 拿批次 id → commit 原子落盘。服务端在 commit 前
  // 重新校验路径越界与"目标已存在"——任一文件冲突则整批回滚，不会半写。
  //
  // 2026-08-26 修复：这里此前没有传 base，`POST /v1/drafts/batch` 会默认落到
  // config.workspaceRoot（CLI/技能执行任务的本地读取边界，当前部署下这是一个
  // 课题子文件夹，不是 vault 根）。但 EXP/HYP/Idea/Decision 这些 schema-v1
  // 对象是"vault 级状态"——bridge/server.js 里 draftBaseRoot() 自己的注释早
  // 就写明"必须落在 scholarium.vaultRoot 下，调用方要传 base:'scholarium-
  // vault'"，只是这条聊天草稿路径一直没照做。查过课题子文件夹，里面确实没有
  // Research/ 树，说明这条路径一旦被触发，会在错误的地方新建一棵 Research/，
  // project.get 等只读端点根本读不到——不是理论风险，是实际会发生的静默错位。
  async function executeDraftRequests(flowId, message) {
    if (!message.drafts || !isConfirmableState(confirmationState(message, 'draft'))) return;
    const lifecycle = await beginChatConfirmation(message, 'draft', { drafts: message.drafts });
    if (!lifecycle.ok) return;
    message.draftsState = 'executing';
    saveChat(); renderChat();
    const outcomes = [];
    const retryableDrafts = [];
    for (const req of message.drafts) {
      try {
        const batch = await bridgeFetch('/v1/drafts/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // sourceTaskId 让审计能把这批草稿回指到产生它的那次 Agent 任务
          // （服务端仅作元数据记录，不参与校验）。base 固定传 'scholarium-vault'：
          // 这条路径写的从来都是 schema-v1 对象，没有"落在 workspaceRoot 也可以
          // 接受"的场景。
          body: JSON.stringify({
            items: req.items, sourceTaskId: message.taskId, base: 'scholarium-vault',
            serverManagedMetadata: true, projectDisplayId: message.projectDisplayId || '',
          }),
        });
        const committed = await chatDispatch(`/v1/drafts/batch/${batch.id}/commit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }, lifecycle.operationId);
        const paths = committed.items.map((item) => item.path);
        outcomes.push({ paths, status: 'completed' });
        if (req.openAfterCommit && paths[0]) {
          try { window.parent.postMessage({ type: 'scholarium:open-vault-file', path: paths[0] }, '*'); }
          catch { /* standalone browser mode has no Obsidian host */ }
        }
      } catch (error) {
        outcomes.push({ paths: req.items.map((item) => item.path), status: 'failed', detail: humanizeActionError(String(error.message || error)) });
        retryableDrafts.push(req);
      }
    }
    // A transient Bridge/schema error must not turn the only confirmation card
    // into a dead end.  Keep just the failed requests on the card so the user
    // can correct/retry them without asking the Agent to regenerate every
    // successfully committed sibling draft.
    message.drafts = retryableDrafts;
    message.draftsState = retryableDrafts.length ? 'failed' : 'settled';
    const lines = outcomes.map((o) => o.status === 'completed'
      ? `✔ 已写入：${o.paths.join('、')}`
      : `✘ 未写入 ${o.paths.join('、')}：${o.detail}`);
    appendToChat(flowId, { role: 'system', text: '记录保存结果：\n' + lines.join('\n') + '\n（新建的记录为 review_status: pending，请到 Scholarium 面板核实后确认）', at: new Date().toISOString() });
    await settleChatConfirmation(message, 'draft', lifecycle.operationId,
      retryableDrafts.length ? { error: `有 ${retryableDrafts.length} 组草稿未写入` } : { detail: { paths: outcomes.flatMap((o) => o.paths) } });
    saveChat(); renderChat();
  }

  // Existing legacy notes are a separate authority surface from drafts. The
  // click creates a fresh preview, then commits that exact preview; the Bridge
  // rejects any note changed after preview instead of overwriting it.
  async function executeLegacyNoteEdits(flowId, message) {
    if (!message.legacyNoteEdits || !isConfirmableState(confirmationState(message, 'legacyNoteEdit'))) return;
    const lifecycle = await beginChatConfirmation(message, 'legacyNoteEdit', { edits: message.legacyNoteEdits });
    if (!lifecycle.ok) return;
    message.legacyNoteEditsState = 'executing';
    saveChat(); renderChat();
    const outcomes = [];
    const retryable = [];
    for (const edit of message.legacyNoteEdits) {
      try {
        const preview = await bridgeFetch('/v1/legacy-note-edits/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-scholarium-user-confirmed': 'true' },
          body: JSON.stringify({ path: edit.path, content: edit.content, reason: edit.reason, changes: edit.changes, sourceTaskId: message.taskId }),
        });
        const committed = await chatDispatch(`/v1/edits/${preview.id}/commit`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-scholarium-user-confirmed': 'true' }, body: '{}',
        }, lifecycle.operationId);
        outcomes.push({ path: committed.path || edit.path, status: 'completed' });
      } catch (error) {
        outcomes.push({ path: edit.path, status: 'failed', detail: humanizeActionError(String(error.message || error)) });
        retryable.push(edit);
      }
    }
    message.legacyNoteEdits = retryable;
    message.legacyNoteEditsState = retryable.length ? 'failed' : 'settled';
    const lines = outcomes.map((outcome) => outcome.status === 'completed'
      ? `✔ 已修改：${outcome.path}`
      : `✘ 未修改 ${outcome.path}：${outcome.detail}`);
    appendToChat(flowId, { role: 'system', text: '既有笔记修改结果：\n' + lines.join('\n'), at: new Date().toISOString() });
    await settleChatConfirmation(message, 'legacyNoteEdit', lifecycle.operationId,
      retryable.length ? { error: `有 ${retryable.length} 条笔记未修改` } : { detail: { paths: outcomes.map((o) => o.path) } });
    saveChat(); renderChat();
  }

  // 草稿确认卡片：列出将新建的文件（路径 + 大小 + 理由），用户点确认才落盘。
  function draftCard(message) {
    if (!Array.isArray(message.drafts) || !message.drafts.length) return null;
    const state = confirmationState(message, 'draft');
    const card = document.createElement('div');
    card.className = 'wv-action-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-title';
    title.textContent = state === 'abandoned'
      ? `新建记录（已放弃，${message.drafts.reduce((sum, d) => sum + d.items.length, 0)} 个文件未写入）`
      : `新建记录（${message.drafts.reduce((sum, d) => sum + d.items.length, 0)} 个文件，确认后才写入）`;
    card.appendChild(title);
    card.appendChild(providerNotice(message.provider));
    for (const req of message.drafts) {
      if (req.reason) {
        const reason = document.createElement('div');
        reason.className = 'wv-action-detail';
        reason.textContent = req.reason;
        card.appendChild(reason);
      }
      for (const item of req.items) {
        const row = document.createElement('div');
        row.className = 'wv-action-row';
        const name = document.createElement('code');
        name.textContent = item.path;
        const detail = document.createElement('span');
        detail.className = 'wv-action-detail';
        detail.textContent = `${item.content.length} 字符`;
        row.append(name, detail);
        card.appendChild(row);
      }
    }
    if (isConfirmableState(state) && message.draftsState !== 'settled') {
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wv-action-confirm';
      btn.disabled = message.draftsState === 'executing';
      btn.textContent = message.draftsState === 'executing'
        ? '正在写入…'
        : '确认写入（新建文件，不会覆盖已有记录）';
      btn.addEventListener('click', () => executeDraftRequests(chatFlowId, message));
      bar.appendChild(btn);
      appendAbandonButton(bar, message, 'draft');
      card.appendChild(bar);
    }
    return card;
  }

  function legacyNoteEditCard(message) {
    if (!Array.isArray(message.legacyNoteEdits) || !message.legacyNoteEdits.length) return null;
    const state = confirmationState(message, 'legacyNoteEdit');
    const card = document.createElement('div');
    card.className = 'wv-action-card wv-legacy-note-edit-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-title';
    title.textContent = state === 'abandoned'
      ? `修改既有笔记（已放弃，${message.legacyNoteEdits.length} 个文件未修改）`
      : `修改既有笔记（${message.legacyNoteEdits.length} 个文件，确认后才写入）`;
    card.append(title, providerNotice(message.provider));
    for (const edit of message.legacyNoteEdits) {
      const path = document.createElement('code');
      path.className = 'wv-action-detail';
      path.textContent = edit.path;
      card.appendChild(path);
      if (edit.reason) {
        const reason = document.createElement('div');
        reason.className = 'wv-action-detail';
        reason.textContent = edit.reason;
        card.appendChild(reason);
      }
      if (edit.changes?.length) {
        const table = document.createElement('table');
        table.className = 'wv-legacy-note-edit-table';
        const head = document.createElement('thead');
        const headRow = document.createElement('tr');
        for (const label of ['位置', '原文', '修改后']) {
          const cell = document.createElement('th');
          cell.textContent = label;
          headRow.appendChild(cell);
        }
        head.appendChild(headRow); table.appendChild(head);
        const body = document.createElement('tbody');
        for (const change of edit.changes) {
          const row = document.createElement('tr');
          for (const value of [change.location, change.before, change.after]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.appendChild(cell);
          }
          body.appendChild(row);
        }
        table.appendChild(body); card.appendChild(table);
      }
    }
    if (isConfirmableState(state) && message.legacyNoteEditsState !== 'settled') {
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'wv-action-confirm';
      button.disabled = message.legacyNoteEditsState === 'executing';
      button.textContent = message.legacyNoteEditsState === 'executing' ? '正在预览并写入…' : '确认修改（会检测并发改动）';
      button.addEventListener('click', () => executeLegacyNoteEdits(chatFlowId, message));
      bar.appendChild(button); appendAbandonButton(bar, message, 'legacyNoteEdit'); card.appendChild(bar);
    }
    return card;
  }

  // A malformed protocol must be visible, but its giant JSON payload belongs
  // neither in the prose transcript nor in a clickable confirmation card.
  // This card is explicitly non-executable; it states what the renderer could
  // safely identify and why the researcher needs to ask again.
  function protocolFailureCard(message) {
    if (!Array.isArray(message.protocolFailures) || !message.protocolFailures.length) return null;
    const legacyDrafts = message.protocolFailures.filter((failure) =>
      failure?.protocol === 'scholarium-draft' && /^Experiments\//i.test(String(failure?.target || '')));
    const onlyLegacyDrafts = legacyDrafts.length === message.protocolFailures.length;
    const card = document.createElement('div');
    // A legacy draft pointed at an existing note is a deliberate safety
    // rejection, not a malformed request and not a failed write.  Present it
    // as neutral history so researchers are not told that their note is in an
    // error state after the safe edit flow has already completed.
    card.className = `wv-action-card ${onlyLegacyDrafts ? 'wv-protocol-compatibility-card' : 'wv-protocol-failure-card'}`;
    card.dataset.confirmationState = 'abandoned';
    const title = document.createElement('div');
    title.className = 'wv-action-title';
    title.textContent = onlyLegacyDrafts
      ? `旧草稿请求已安全跳过（${message.protocolFailures.length} 条）`
      : `未执行的格式错误请求（${message.protocolFailures.length} 条）`;
    card.appendChild(title);
    for (const failure of message.protocolFailures) {
      const detail = document.createElement('div');
      detail.className = 'wv-action-detail';
      detail.textContent = `${failure.protocol} · ${failure.target}`;
      const guidance = document.createElement('div');
      guidance.className = 'wv-action-detail';
      guidance.textContent = failure.guidance;
      card.append(detail, guidance);
    }
    return card;
  }

  // 种子重建建议卡：只有一个跳转按钮，不做任何 POST。project_uid 未知时（聊天
  // 里没有课题上下文）退化为提示手动打开面板，不猜测/不硬绑某个课题。
  function suggestReconstructionCard(message) {
    if (!Array.isArray(message.suggestReconstructions) || !message.suggestReconstructions.length) return null;
    const state = confirmationState(message, 'suggestReconstruction');
    const card = document.createElement('div');
    card.className = 'wv-action-card';
    card.dataset.confirmationState = state;
    for (const s of message.suggestReconstructions) {
      const row = document.createElement('div');
      row.className = 'wv-action-row';
      const label = document.createElement('span');
      label.textContent = `建议从 ${s.seed_doi} 开始做一轮种子文献证据重建${s.reason ? '：' + s.reason : ''}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wv-action-confirm';
      btn.textContent = state === 'abandoned' ? '已放弃' : state === 'failed' ? '本次没有生效' : state === 'confirmed' ? '再次打开重建面板' : '打开重建面板';
      btn.disabled = !isConfirmableState(state) && state !== 'confirmed';
      btn.addEventListener('click', async () => {
        const displayId = message.projectDisplayId || document.querySelector('.project-mode-seed-reconstruct')?.dataset.project;
        if (!displayId) return window.researchWeaver.toast('请先在项目面板打开对应课题，再点击"从种子重建 P1–P2"。');
        // 这一步本身只是"打开重建面板"，真实写入在面板里由研究员逐步确认；但
        // 它同样是一次人工确认，同样要有锁定态——否则刷新后这条建议又能被反复
        // 打开，而面板里那一步的进度已经无从对应。
        // 种子重建的真实写入发生在重建面板自己的多步确认里（不在本卡片范围内），
        // 同样只能由 shell 预先占位。
        const lifecycle = await beginChatConfirmation(message, 'suggestReconstruction', { suggestions: [s] }, null, { guarded: false });
        if (!lifecycle.ok) return;
        await settleChatConfirmation(message, 'suggestReconstruction', lifecycle.operationId, { detail: { opened: s.seed_doi } });
        updatePendingConfirmationButton();
        window.weaverSeedReconstruction?.openSeedReconstructionDialog(displayId, s.seed_doi);
      });
      row.append(label, btn);
      card.appendChild(row);
    }
    if (isConfirmableState(state)) {
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      appendAbandonButton(bar, message, 'suggestReconstruction');
      card.appendChild(bar);
    }
    return card;
  }

  const RUN_LABEL = {
    'pipeline.run': '运行完整文献 Pipeline',
    'literature.search': '仅检索文献',
    'literature.queue': '加入人工下载队列',
    'pipeline.rerun': '从指定步骤重新运行 Pipeline',
  };

  function runRequestDetail(request) {
    if (request.operation === 'literature.queue') {
      return `论文：${request.items.length} 篇\n去向：文献订阅 → Pipeline 待处理${request.open === false ? '' : '（完成后自动打开）'}\n${request.items.map((item) => `${item.doi} · ${item.title}`).join('\n')}`;
    }
    if (request.operation === 'pipeline.rerun') {
      const step = window.weaverPipelineSteps?.stepById?.(request.from_step);
      return `历史任务：${request.run_id === 'latest' ? '当前工作区最近一次 Pipeline' : request.run_id}\n起点：${step?.title || request.from_step}\n该步骤及其下游旧产物会先从状态包中清除。`;
    }
    return `主题：${request.topic}`;
  }

  async function executeRunRequest(flowId, message, index) {
    const request = message.runs?.[index];
    if (!request || request.state === 'running' || request.state === 'completed') return;
    if (!isConfirmableState(confirmationState(message, 'run'))) return;
    if (typeof window.runScholariumConversationOperation !== 'function') {
      window.researchWeaver.toast('对话运行控制器未加载，请重载 Scholarium 后重试。');
      return;
    }
    /* 这一条的派发不在 Bridge 路由里（它走 launcher 里的 pipeline/skill 派发，
     * bridge-ui.js 的代码不在本次改动范围内），所以没法把 operationId 挂到请求头
     * 上。仍然先在账本占位：这样崩溃之后能查、能人工核对，而且同一张卡片在
     * claimed 期间不许再被点一次——这是"点了两次跑两次"最现实的那条路径。 */
    // run 的真实派发在 bridge-ui.js 的 pipeline/skill 派发里，挂不上 x-scholarium-operation-id，
    // 所以账本那一行只能由 shell 预先占位（guarded: false），保证它不会被投第二次。
    const lifecycle = await beginChatConfirmation(message, 'run', { runs: [request] }, null, { guarded: false });
    if (!lifecycle.ok) return;
    request.state = 'running';
    void auditChatTurn(message);
    saveChat(); renderChat();
    try {
      // 契约 §2.3：号随请求交给控制器（它一路透传到 pipeline 入口的写请求头）。
      // 说清边界——run 在 P0 **只有 claimed 锁**：literature.queue 分支走
      // postMessage 交宿主，头机制物理上到不了；literature.search / pipeline.rerun
      // 只在**入口**做到幂等，阶段内部的写入不受保护。不要在别处宣称 run 有执行端
      // 幂等；完整的 host / 多阶段幂等属于 P1。
      // 号挂在 request 上而不是改调用形状：`runScholariumConversationOperation(request)`
      // 这一行的形状有既有测试钉着（tests/pipeline-resume.test.js），而 request 本身
      // 在这个处理器里本来就是被就地改的（下面的 request.state 等），所以就地加一个
      // 字段既不改变调用契约，也不会写进任何持久化载荷。
      request.operationId = lifecycle.operationId;
      const outcome = await window.runScholariumConversationOperation(request);
      request.state = outcome?.status === 'stopped' ? 'stopped' : 'completed';
      request.resolvedRunId = outcome?.runId || '';
      const detail = outcome?.detail || (request.operation === 'literature.search'
        ? `检索完成：${outcome?.count ?? 0} 条；实际检索式：${outcome?.query || request.topic}`
        : request.operation === 'pipeline.rerun'
          ? `已从 ${request.from_step} 发起重跑${outcome?.runId ? `（父任务 ${outcome.runId}）` : ''}。`
          : 'Pipeline 已完成。');
      appendToChat(flowId, { role: 'system', text: `对话运行结果：${detail}`, at: new Date().toISOString() });
    } catch (error) {
      request.state = 'failed';
      request.error = humanizeActionError(String(error?.message || error));
      appendToChat(flowId, { role: 'system', text: `对话运行失败：${request.error}`, at: new Date().toISOString() });
    }
    await settleChatConfirmation(message, 'run', lifecycle.operationId,
      request.state === 'failed' ? { error: request.error || '运行失败' } : { detail: { runId: request.resolvedRunId || '', state: request.state } });
    saveChat(); renderChat();
  }

  // 数据规范化确认执行：把 XLSX/TXT/DAT 结构化转换成带源哈希的 UTF-8 CSV。
  // 原文件只读；产物落在 Materials/_normalized/<hash>/；不清洗、不过滤、不平滑
  // 任何数值。allow_missing_formula_cache 只能由研究员在这张卡上勾选——公式格
  // 没有缓存值时会静默产出空白列，模型无从知道那些公式本该算出什么。
  function normalizeSheetChoices(error) {
    const match = String(error || '').match(/multiple visible sheets:\s*(.+)$/i);
    if (!match) return [];
    return match[1].split(/,\s*/).map((entry) => {
      const sheet = entry.match(/^\d+:(.+?)\s*\((visible|hidden|veryHidden)\)$/i);
      return sheet ? { name: sheet[1], state: sheet[2] } : null;
    }).filter(Boolean);
  }

  async function inspectNormalizeSheets(flowId, message, index) {
    const request = message.normalizations?.[index];
    if (!request || request.inspectingSheets || request.state === 'running' || request.state === 'completed') return;
    request.inspectingSheets = true;
    delete request.inspectError;
    saveChat(); renderChat();
    try {
      const [skills, vaultStatus] = await Promise.all([
        bridgeFetch('/v1/skills'), bridgeFetch('/v1/scholarium/status'),
      ]);
      const skill = skills.skills.find((item) => item.name === 'sch-data-normalize');
      if (!skill) throw new Error('未找到 sch-data-normalize 本机 Skill；请重新启动 Research Weaver。');
      const vaultRoot = String(vaultStatus?.vaultRoot || '');
      if (!vaultStatus?.vaultRootExists || !vaultRoot) {
        throw new Error('scholarium.vaultRoot 未配置或不存在；无法读取 Vault 的 XLSX 工作表。');
      }
      const response = await bridgeFetch('/v1/skills/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId: skill.id, workspace: vaultRoot, input: JSON.stringify({ mode: 'inspect', data_path: request.data_path }) }),
      });
      const sheets = Array.isArray(response?.manifest?.workbook?.sheets) ? response.manifest.workbook.sheets : [];
      request.sheetChoices = sheets
        .filter((sheet) => String(sheet?.state || 'visible') === 'visible' && String(sheet?.name || '').trim())
        .map((sheet) => ({ name: String(sheet.name), state: String(sheet.state || 'visible') }));
      if (request.sheetChoices.length === 1) request.sheet = request.sheetChoices[0].name;
      if (!request.sheetChoices.length) throw new Error('工作簿中没有可选择的可见工作表。');
      delete request.error;
    } catch (error) {
      request.inspectError = humanizeActionError(String(error?.message || error));
    } finally {
      delete request.inspectingSheets;
      saveChat(); renderChat();
    }
  }

  async function executeNormalizeRequest(flowId, message, index) {
    const request = message.normalizations?.[index];
    if (!request || request.state === 'running' || request.state === 'completed') return;
    if (!isConfirmableState(confirmationState(message, 'normalize'))) return;
    const lifecycle = await beginChatConfirmation(message, 'normalize', { normalizations: [request] });
    if (!lifecycle.ok) return;
    request.state = 'running';
    delete request.error;
    saveChat(); renderChat();
    try {
      const skills = await bridgeFetch('/v1/skills');
      const skill = skills.skills.find((item) => item.name === 'sch-data-normalize');
      if (!skill) throw new Error('未找到 sch-data-normalize 本机 Skill；请重新启动 Research Weaver。');
      const input = { data_path: request.data_path };
      if (request.sheet) input.sheet = request.sheet;
      if (request.header_row) input.header_row = request.header_row;
      if (request.formula_mode) input.formula_mode = request.formula_mode;
      if (request.allowMissingFormulaCache) input.allow_missing_formula_cache = true;
      // 数据素材的 data_path 是 Vault 相对路径（Materials/...），而
      // workspaceRoot 是当前课题的子目录。把后者传给 Skill 会让一个正确的
      // Materials/... 路径被解析为 <课题>/Materials/...，从而在素材库场景
      // 必然报“文件不在授权工作区”。Vault 根由 Bridge 的只读状态端点提供，
      // 不从聊天文本或 DOM 猜测；不存在时 fail-closed，不运行任何转换。
      const vaultStatus = await bridgeFetch('/v1/scholarium/status');
      const vaultRoot = String(vaultStatus?.vaultRoot || '');
      if (!vaultStatus?.vaultRootExists || !vaultRoot) {
        throw new Error('scholarium.vaultRoot 未配置或不存在；无法从 Vault 的 Materials/ 目录规范化数据。');
      }
      void auditChatTurn(message, 'skill-submission', { kind: 'normalize', skill: 'sch-data-normalize', input });
      const response = await chatDispatch('/v1/skills/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId: skill.id, workspace: vaultRoot, input: JSON.stringify(input) }),
      }, lifecycle.operationId);
      const manifest = response?.manifest || {};
      request.state = 'completed';
      request.result = {
        ready_path: String(manifest?.ready_for?.data_path || ''),
        sheet: String(manifest?.selection?.sheet || ''),
        header_row: manifest?.selection?.header_row ?? null,
        formula_mode: String(manifest?.selection?.formula_mode || ''),
      };
      // 规范化成功不自动绘图：x/y 列与图型仍然是研究者的显式选择，只把产物
      // 路径作为下一张确认卡的预填输入。
      appendToChat(flowId, {
        role: 'system',
        text: `规范化完成：${request.result.ready_path || '（未返回产物路径）'}`
          + `${request.result.sheet ? `\nsheet：${request.result.sheet}` : ''}`
          + `${request.result.header_row ? `　表头行：${request.result.header_row}` : ''}`
          + `${request.result.formula_mode ? `　公式模式：${request.result.formula_mode}` : ''}`
          + '\n原文件未被修改。下一步绘图需要你指定 x/y 列与图型，不会自动执行。',
        at: new Date().toISOString(),
      });
    } catch (error) {
      request.state = 'failed';
      request.error = humanizeActionError(String(error?.message || error));
      appendToChat(flowId, { role: 'system', text: `规范化失败：${request.error}`, at: new Date().toISOString() });
    }
    await settleChatConfirmation(message, 'normalize', lifecycle.operationId,
      request.state === 'failed' ? { error: request.error || '规范化失败' } : { detail: request.result || null });
    saveChat(); renderChat();
  }

  function normalizeRequestCard(message) {
    if (!Array.isArray(message.normalizations) || !message.normalizations.length) return null;
    const state = confirmationState(message, 'normalize');
    const card = document.createElement('div');
    card.className = 'wv-action-card wv-run-request-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-card-title';
    title.textContent = '织研者请求规范化数据文件（确认后才生效）';
    card.append(title, providerNotice(message.provider));
    message.normalizations.forEach((request, index) => {
      const row = document.createElement('div');
      row.className = 'wv-action-row';
      const copy = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = request.data_path;
      const detail = document.createElement('div');
      detail.className = 'wv-action-detail';
      detail.style.whiteSpace = 'pre-line';
      detail.textContent = [
        `sheet：${request.sheet || '（单工作表或由 Skill 判定）'}`,
        `表头行：${request.header_row || '自动识别'}　公式模式：${request.formula_mode || 'cached'}`,
        '产物：Materials/_normalized/<源哈希>/ 下的 UTF-8 CSV；原文件只读，数值不做任何清洗或过滤。',
        request.reason ? `理由：${request.reason}` : '',
        request.result?.ready_path ? `产物路径：${request.result.ready_path}` : '',
        request.error ? `失败：${request.error}` : '',
      ].filter(Boolean).join('\n');
      copy.append(name, detail);
      row.appendChild(copy);
      if (isConfirmableState(state) && (!request.state || request.state === 'failed')) {
        const knownSheets = Array.isArray(request.sheetChoices) && request.sheetChoices.length
          ? request.sheetChoices
          : normalizeSheetChoices(request.error);
        if (/\.xlsx$/i.test(String(request.data_path || '')) && !request.sheet) {
          if (knownSheets.length) {
            const label = document.createElement('label');
            label.className = 'wv-action-detail';
            label.append(document.createTextNode('工作表：'));
            const select = document.createElement('select');
            select.setAttribute('aria-label', '选择要规范化的 XLSX 工作表');
            select.append(new Option('请选择工作表（必选）', ''));
            knownSheets.forEach((sheet) => select.append(new Option(`${sheet.name} (${sheet.state})`, sheet.name)));
            select.value = request.sheet || '';
            select.addEventListener('change', () => {
              request.sheet = select.value || undefined;
              if (request.sheet) delete request.error;
              saveChat(); renderChat();
            });
            label.append(select);
            copy.appendChild(label);
          } else {
            const inspect = document.createElement('button');
            inspect.type = 'button';
            inspect.className = 'wv-action-confirm';
            inspect.textContent = request.inspectingSheets ? '正在读取工作表…' : '读取工作表';
            inspect.disabled = Boolean(request.inspectingSheets);
            inspect.addEventListener('click', () => inspectNormalizeSheets(chatFlowId, message, index));
            copy.appendChild(inspect);
            if (request.inspectError) {
              const inspectError = document.createElement('div');
              inspectError.className = 'wv-action-detail';
              inspectError.textContent = `读取工作表失败：${request.inspectError}`;
              copy.appendChild(inspectError);
            }
          }
        }
        // 只有研究员能解除“公式无缓存值”这道闸；模型的提议里读不到这个字段。
        const allow = document.createElement('label');
        allow.className = 'wv-action-detail';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = Boolean(request.allowMissingFormulaCache);
        box.addEventListener('change', () => { request.allowMissingFormulaCache = box.checked; saveChat(); });
        allow.append(box, document.createTextNode(' 允许公式缺少缓存值（会产生空白列，仅在你确认无妨时勾选）'));
        copy.appendChild(allow);
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wv-action-confirm';
        const needsExplicitSheet = /\.xlsx$/i.test(String(request.data_path || '')) && knownSheets.length > 1 && !request.sheet;
        button.textContent = needsExplicitSheet ? '先选择工作表' : '确认并规范化';
        button.disabled = needsExplicitSheet;
        button.addEventListener('click', () => executeNormalizeRequest(chatFlowId, message, index));
        row.appendChild(button);
      } else {
        const status = document.createElement('span');
        status.className = 'wv-action-detail';
        status.textContent = state === 'abandoned'
          ? '已放弃'
          : ({ running: '正在规范化…', completed: '已完成' })[request.state] || request.state;
        row.appendChild(status);
      }
      card.appendChild(row);
    });
    if (isConfirmableState(state)) {
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      appendAbandonButton(bar, message, 'normalize');
      card.appendChild(bar);
    }
    return card;
  }

  // 绘图执行始终以 Bridge 配置的 Vault 根为基准：聊天协议中的 Materials/…
  // 是 Vault 相对路径，不能用当前课题子目录解释。模型只给出 recipe；此处
  // 固定调用 allow-listed sch-data-plot，SVG 只会由确定性脚本生成。
  async function chartSkillContext() {
    const [skills, vaultStatus] = await Promise.all([
      bridgeFetch('/v1/skills'), bridgeFetch('/v1/scholarium/status'),
    ]);
    const skill = skills.skills.find((item) => item.name === 'sch-data-plot');
    if (!skill) throw new Error('未找到 sch-data-plot 本机 Skill；请重新启动 Research Weaver。');
    const vaultRoot = String(vaultStatus?.vaultRoot || '');
    if (!vaultStatus?.vaultRootExists || !vaultRoot)
      throw new Error('scholarium.vaultRoot 未配置或不存在；无法对 Vault 的 Materials/ 数据绘图。');
    return { skill, vaultRoot };
  }

  function chartOutput(manifest, name) {
    return (Array.isArray(manifest?.outputs) ? manifest.outputs : []).find((path) => String(path).endsWith(name)) || '';
  }

  // operationId 由调用方（确认处理器）传进来：Skill 写的是真实的图表产物，
  // 同一次确认重复到达时必须由执行端认出"这单已经跑过"。
  async function runChartRecipe(input, operationId) {
    const { skill, vaultRoot } = await chartSkillContext();
    return chatDispatch('/v1/skills/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId: skill.id, workspace: vaultRoot, input: JSON.stringify(input) }),
    }, operationId);
  }

  async function readChartManifest(targetManifestPath) {
    const response = await bridgeFetch('/v1/scholarium/vault/read', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: targetManifestPath, max_chars: 100000 }),
    });
    if (response?.truncated || response?.path !== targetManifestPath)
      throw new Error('目标绘图 manifest 无法完整、精确地读取；拒绝据此改版。');
    let manifest;
    try { manifest = JSON.parse(String(response.content || '')); }
    catch { throw new Error('目标绘图 manifest 不是有效 JSON；拒绝改版。'); }
    const source = String(manifest?.source?.path || '');
    const plot = manifest?.plot || {};
    const yColumns = Array.isArray(plot.y_columns) ? plot.y_columns.map(String) : [];
    if (manifest?.skill !== 'sch-data-plot' || !source || !String(plot.x_column || '') || !yColumns.length || !['line', 'scatter', 'bar'].includes(String(plot.kind || '')))
      throw new Error('目标不是完整的 sch-data-plot manifest；拒绝改版。');
    return { manifest, source, plot, yColumns };
  }

  function revisedChartStyle(previous, patch) {
    const prior = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
    const next = { ...prior, ...patch };
    if (prior.spines || patch.spines) next.spines = { ...(prior.spines || {}), ...(patch.spines || {}) };
    if (prior.series_colors || patch.series_colors) next.series_colors = { ...(prior.series_colors || {}), ...(patch.series_colors || {}) };
    return next;
  }

  async function executePlotRequest(flowId, message, index) {
    const request = message.plots?.[index];
    if (!request || request.state === 'running' || request.state === 'completed') return;
    if (!isConfirmableState(confirmationState(message, 'plot'))) return;
    const lifecycle = await beginChatConfirmation(message, 'plot', { plots: [request] });
    if (!lifecycle.ok) return;
    request.state = 'running';
    delete request.error;
    saveChat(); renderChat();
    try {
      const input = {
        data_path: request.data_path, x_column: request.x_column, y_columns: request.y_columns,
        plot_kind: request.plot_kind, chart_style: request.chart_style, save_mode: 'new',
      };
      if (request.title) input.title = request.title;
      void auditChatTurn(message, 'skill-submission', { kind: 'plot', skill: 'sch-data-plot', input });
      const response = await runChartRecipe(input, lifecycle.operationId);
      const manifest = response?.manifest || {};
      request.state = 'completed';
      request.result = {
        svg_path: chartOutput(manifest, 'plot.svg'),
        manifest_path: chartOutput(manifest, 'plot-manifest.json'),
      };
      appendToChat(flowId, {
        role: 'system',
        text: `绘图完成：${request.result.svg_path || '（未返回 SVG 路径）'}`
          + `${request.result.manifest_path ? `\nmanifest：${request.result.manifest_path}` : ''}`
          + '\n这是新的可复现图表版本；源数据未被修改。',
        at: new Date().toISOString(),
      });
    } catch (error) {
      request.state = 'failed';
      request.error = humanizeActionError(String(error?.message || error));
      appendToChat(flowId, { role: 'system', text: `绘图失败：${request.error}`, at: new Date().toISOString() });
    }
    await settleChatConfirmation(message, 'plot', lifecycle.operationId,
      request.state === 'failed' ? { error: request.error || '绘图失败' } : { detail: request.result || null });
    saveChat(); renderChat();
  }

  async function executePlotRevision(flowId, message, index) {
    const request = message.plotRevisions?.[index];
    if (!request || request.state === 'running' || request.state === 'completed') return;
    if (!isConfirmableState(confirmationState(message, 'plotRevision'))) return;
    const lifecycle = await beginChatConfirmation(message, 'plotRevision', { plotRevisions: [request] });
    if (!lifecycle.ok) return;
    request.state = 'running';
    delete request.error;
    saveChat(); renderChat();
    try {
      // Source, variables and plot kind are read fresh from the selected
      // manifest—not from the model's revision block. The plotter rechecks
      // the target/source relationship before an explicit overwrite.
      const { manifest: previous, source, plot, yColumns } = await readChartManifest(request.target_manifest_path);
      const input = {
        data_path: source, x_column: String(plot.x_column), y_columns: yColumns,
        plot_kind: String(plot.kind), chart_style: revisedChartStyle(plot.chart_style, request.chart_style),
        // This flag is deliberately distinct from any model proposal fields.
        // Only the researcher-operated checkbox below can set it.  In
        // particular, old persisted `allowOverwrite` values are ignored so a
        // stale card can never turn a later confirmation into an overwrite.
        save_mode: request.overwriteConfirmedByResearcher === true ? 'overwrite' : 'new',
      };
      if (plot.title) input.title = String(plot.title);
      // Pass the selected parent in both modes. In new mode the plotter stores
      // it as immutable lineage and includes it in the artifact identity; in
      // overwrite mode it also names the only directory that may be replaced.
      input.target_manifest_path = request.target_manifest_path;
      void auditChatTurn(message, 'skill-submission', { kind: 'plotRevision', skill: 'sch-data-plot', input });
      const response = await runChartRecipe(input, lifecycle.operationId);
      const manifest = response?.manifest || {};
      request.state = 'completed';
      request.result = {
        svg_path: chartOutput(manifest, 'plot.svg'),
        manifest_path: chartOutput(manifest, 'plot-manifest.json'),
        revision_mode: String(manifest?.revision?.mode || input.save_mode),
        source_path: String(manifest?.source?.path || source),
        based_on_created_at: String(previous?.created_at || ''),
      };
      appendToChat(flowId, {
        role: 'system',
        text: `图表改版完成：${request.result.svg_path || '（未返回 SVG 路径）'}`
          + `${request.result.manifest_path ? `\nmanifest：${request.result.manifest_path}` : ''}`
          + `\n模式：${request.result.revision_mode === 'overwrite' ? '已覆盖研究员选定版本' : '已生成新的可复现版本'}`
          + '\n源数据、x/y 列和图型均继承自目标 manifest，未被模型改写。',
        at: new Date().toISOString(),
      });
    } catch (error) {
      request.state = 'failed';
      request.error = humanizeActionError(String(error?.message || error));
      appendToChat(flowId, { role: 'system', text: `图表改版失败：${request.error}`, at: new Date().toISOString() });
    }
    await settleChatConfirmation(message, 'plotRevision', lifecycle.operationId,
      request.state === 'failed' ? { error: request.error || '图表改版失败' } : { detail: request.result || null });
    saveChat(); renderChat();
  }

  function plotRequestCard(message) {
    if (!Array.isArray(message.plots) || !message.plots.length) return null;
    const state = confirmationState(message, 'plot');
    const card = document.createElement('div');
    card.className = 'wv-action-card wv-run-request-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-card-title';
    title.textContent = '织研者请求生成数据图（确认后才生效）';
    card.append(title, providerNotice(message.provider));
    message.plots.forEach((request, index) => {
      const row = document.createElement('div'); row.className = 'wv-action-row';
      const copy = document.createElement('div');
      const name = document.createElement('b'); name.textContent = request.title || `${request.y_columns.join('、')} vs ${request.x_column}`;
      const detail = document.createElement('div'); detail.className = 'wv-action-detail'; detail.style.whiteSpace = 'pre-line';
      detail.textContent = [
        `数据：${request.data_path}`, `X：${request.x_column}　Y：${request.y_columns.join('、')}　图型：${request.plot_kind}`,
        `保存：新版本（原图、SVG 与源数据都不会被覆盖）`, request.reason ? `理由：${request.reason}` : '',
        request.result?.svg_path ? `SVG：${request.result.svg_path}` : '', request.error ? `失败：${request.error}` : '',
      ].filter(Boolean).join('\n');
      copy.append(name, detail); row.appendChild(copy);
      if (isConfirmableState(state) && (!request.state || request.state === 'failed')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'wv-action-confirm';
        button.textContent = '确认并生成图表';
        button.addEventListener('click', () => executePlotRequest(chatFlowId, message, index)); row.appendChild(button);
      } else {
        const status = document.createElement('span'); status.className = 'wv-action-detail';
        status.textContent = state === 'abandoned' ? '已放弃' : ({ running: '正在确定性绘图…', completed: '已完成' })[request.state] || request.state;
        row.appendChild(status);
      }
      card.appendChild(row);
    });
    if (isConfirmableState(state)) { const bar = document.createElement('div'); bar.className = 'wv-action-bar'; appendAbandonButton(bar, message, 'plot'); card.appendChild(bar); }
    return card;
  }

  function plotRevisionCard(message) {
    if (!Array.isArray(message.plotRevisions) || !message.plotRevisions.length) return null;
    const state = confirmationState(message, 'plotRevision');
    const card = document.createElement('div');
    card.className = 'wv-action-card wv-run-request-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div'); title.className = 'wv-action-card-title';
    title.textContent = '织研者请求改版数据图（确认后才生效）';
    card.append(title, providerNotice(message.provider));
    message.plotRevisions.forEach((request, index) => {
      const row = document.createElement('div'); row.className = 'wv-action-row';
      const copy = document.createElement('div');
      const name = document.createElement('b'); name.textContent = request.target_manifest_path;
      const detail = document.createElement('div'); detail.className = 'wv-action-detail'; detail.style.whiteSpace = 'pre-line';
      detail.textContent = [
        '仅改视觉配方；源数据、x/y 列和图型将从此 manifest 重新读取。',
        `样式：${Object.keys(request.chart_style || {}).join('、') || '（无）'}`,
        `保存：${request.overwriteConfirmedByResearcher === true ? '覆盖目标版本（研究员明确选择）' : '新版本（默认）'}`,
        request.reason ? `理由：${request.reason}` : '', request.result?.svg_path ? `SVG：${request.result.svg_path}` : '', request.error ? `失败：${request.error}` : '',
      ].filter(Boolean).join('\n');
      copy.append(name, detail); row.appendChild(copy);
      if (isConfirmableState(state) && (!request.state || request.state === 'failed')) {
        // Overwrite is not model-controlled: the parser rejects this field.
        // This researcher-only checkbox is its sole path.  Do not resurrect
        // legacy `allowOverwrite`: a saved/stale card must fail closed.
        const allow = document.createElement('label'); allow.className = 'wv-action-detail';
        const box = document.createElement('input'); box.type = 'checkbox'; box.checked = request.overwriteConfirmedByResearcher === true;
        box.addEventListener('change', () => {
          request.overwriteConfirmedByResearcher = box.checked;
          delete request.allowOverwrite;
          saveChat(); renderChat();
        });
        allow.append(box, document.createTextNode(' 覆盖此目标版本（会重写该 SVG、报告和 manifest）'));
        copy.appendChild(allow);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'wv-action-confirm';
        button.textContent = '确认并改版';
        button.addEventListener('click', () => executePlotRevision(chatFlowId, message, index)); row.appendChild(button);
      } else {
        const status = document.createElement('span'); status.className = 'wv-action-detail';
        status.textContent = state === 'abandoned' ? '已放弃' : ({ running: '正在确定性改版…', completed: '已完成' })[request.state] || request.state;
        row.appendChild(status);
      }
      card.appendChild(row);
    });
    if (isConfirmableState(state)) { const bar = document.createElement('div'); bar.className = 'wv-action-bar'; appendAbandonButton(bar, message, 'plotRevision'); card.appendChild(bar); }
    return card;
  }

  function runRequestCard(message) {
    if (!Array.isArray(message.runs) || !message.runs.length) return null;
    const state = confirmationState(message, 'run');
    const card = document.createElement('div');
    card.className = 'wv-action-card wv-run-request-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-card-title';
    title.textContent = '织研者请求执行 Scholarium 操作（确认后才生效）';
    card.append(title, providerNotice(message.provider));
    message.runs.forEach((request, index) => {
      const row = document.createElement('div');
      row.className = 'wv-action-row';
      const copy = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = RUN_LABEL[request.operation] || request.operation;
      const detail = document.createElement('div');
      detail.className = 'wv-action-detail';
      detail.style.whiteSpace = 'pre-line';
      detail.textContent = `${runRequestDetail(request)}${request.reason ? `\n理由：${request.reason}` : ''}${request.error ? `\n失败：${request.error}` : ''}`;
      copy.append(name, detail);
      row.appendChild(copy);
      if (isConfirmableState(state) && (!request.state || request.state === 'failed')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'wv-action-confirm';
        button.textContent = '确认并运行';
        button.addEventListener('click', () => executeRunRequest(chatFlowId, message, index));
        row.appendChild(button);
      } else {
        const status = document.createElement('span');
        status.className = 'wv-action-detail';
        status.textContent = state === 'abandoned'
          ? '已放弃'
          : ({ running: '正在运行…', completed: '已完成', stopped: '已安全停止' })[request.state] || request.state;
        row.appendChild(status);
      }
      card.appendChild(row);
    });
    if (isConfirmableState(state)) {
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      appendAbandonButton(bar, message, 'run');
      card.appendChild(bar);
    }
    return card;
  }

  // 用户点「确认执行」后逐个投递队列并轮询结算，结果作为系统消息回到对话。
  // 执行中按钮逐条显示进度（i/n + 动作名），并提供「取消」——取消的语义如实：
  // 已经投递并结算的动作无法撤回（它们是真实写入），取消只是不再投递剩余项。
  async function executeScholariumActions(flowId, message) {
    if (!message.actions || !isConfirmableState(confirmationState(message, 'action'))) return;
    // 先落 claimed 再投递：这一步是 experiment.transition 不会被写第二次的前提。
    const lifecycle = await beginChatConfirmation(message, 'action', { actions: message.actions });
    if (!lifecycle.ok) return;
    message.actionsState = 'executing';
    message.actionsDone = 0;
    message.actionsCancel = false;
    saveChat(); renderChat();
    const outcomes = [];
    for (const req of message.actions) {
      if (message.actionsCancel) { outcomes.push({ action: req.action, status: 'skipped', detail: '用户取消，未投递' }); continue; }
      // experiment.transition 走 2026-08-27 新开的 /v1/edits 两阶段通道，不经
      // Obsidian 队列——main.js 的 SCH_SCHOLARIUM_QUEUE_ACTIONS 白名单不可改，
      // 但这个动作本来就只操作 Research/Experiments/*.md，和 drafts/batch 写
      // DEC/LES 同一类"Bridge 直接读写 vault"路径。preview+commit 都是 Bridge
      // 进程内同步执行，不需要像队列动作那样轮询等待 Obsidian 消费。
      if (req.action === 'experiment.transition' || req.action === 'experiment.invalidate_provenance') {
        try {
          const invalidating = req.action === 'experiment.invalidate_provenance';
          const endpoint = invalidating ? '/v1/edits/provenance-invalidation/preview' : '/v1/edits/experiment-transition/preview';
          const payload = invalidating
            ? { ...req.input, sourceTaskId: message.taskId }
            : { experiment_uid: req.input.experiment_uid, to_status: req.input.to_status, reason: req.input.reason, sourceTaskId: message.taskId };
          const preview = await bridgeFetch(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const committed = await chatDispatch(`/v1/edits/${preview.id}/commit`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
          }, lifecycle.operationId);
          const plan = committed.result || {};
          outcomes.push({
            action: req.action,
            status: 'completed',
            detail: invalidating
              ? `${plan.display_id || req.input.experiment_uid}: ${plan.from_status} → ${plan.to_status}；降级 ${(plan.evidence_uids || []).length} 条 Evidence，撤出 ${(plan.hypothesis_uids || []).length} 条 Hypothesis 关系`
              : (plan.noop ? `${plan.from} 未变化（已经是该状态）` : `${plan.from} → ${plan.to}`),
          });
        } catch (error) {
          outcomes.push({ action: req.action, status: 'failed', detail: humanizeActionError(String(error.message || error)) });
        }
        message.actionsDone = outcomes.filter((o) => o.status !== 'skipped').length;
        saveChat(); renderChat();
        continue;
      }
      try {
        const submitted = await chatDispatch('/v1/scholarium/actions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: req.action, input: req.input, by: 'weaver-chat-confirmed', sourceTaskId: message.taskId }),
        }, lifecycle.operationId);
        let item = submitted;
        for (let i = 0; i < 90 && !(item.outcome && item.outcome.status); i++) {
          if (message.actionsCancel) break;
          await new Promise((resolve) => setTimeout(resolve, 2000));
          item = await bridgeFetch(`/v1/scholarium/actions/${submitted.id}`);
        }
        if (message.actionsCancel && !(item.outcome && item.outcome.status)) {
          outcomes.push({ action: req.action, status: 'unknown', detail: '取消时已投递未结算；它仍可能在 Obsidian 里完成，请到对应面板核实' });
          continue;
        }
        const outcome = item.outcome || { status: 'timeout' };
        outcomes.push({ action: req.action, status: outcome.status, detail: outcome.error ? humanizeActionError(outcome.error) : JSON.stringify(outcome.result || {}).slice(0, 300) });
      } catch (error) {
        outcomes.push({ action: req.action, status: 'failed', detail: humanizeActionError(String(error.message || error)) });
      }
      message.actionsDone = outcomes.filter((o) => o.status !== 'skipped').length;
      saveChat(); renderChat();
    }
    message.actionsState = 'settled';
    const label = { completed: '✔ 已生效', failed: '✘ 失败', skipped: '— 已跳过', timeout: '？超时未结算', unknown: '？状态未知' };
    // 2026-08-28 发布冲刺项4 P1：completed 状态默认不带 detail，是因为队列
    // 动作成功时 detail 是一坨原始 result JSON（见上面 832 行），直接展示很
    // 吵，标签本身已经够用。但 experiment.transition 的 detail 是专门拼好
    // 的人话（`${from} → ${to}` 或并发去重时的 `${from} 未变化（已经是该
    // 状态）`），这条被同一条规则一起吞掉，导致并发 noop 和真实写入在聊天
    // 里长得一模一样——项3实测（发布冲刺项4清单第4类）明确记录了这个缺口。
    // Provenance invalidation also returns a deliberately human-readable
    // whole-graph summary; showing it is part of proving the cascade happened.
    const showCompletedDetail = new Set(['experiment.transition', 'experiment.invalidate_provenance']);
    // 2026-08-28 发布冲刺项4 P2（清单缺陷#4）：结算行直接打印动作标识符
    // （如 experiment.transition、workspace.timeblock_add），这些是开发侧
    // 命名，不是给研究员看的。ACTION_LABEL 这份映射本来就是为确认卡片
    // （见下方 935 行左右）准备的，这里复用同一份而不是另起一套，避免同一
    // 个动作在"确认前"和"确认后"用两种不同的名字。未登记的动作名原样
    // 兜底显示，不会因为漏填映射而丢信息。
    const lines = outcomes.map((o) => {
      const suppress = o.status === 'completed' && !showCompletedDetail.has(o.action);
      const humanAction = ACTION_LABEL[o.action] || o.action;
      return `${label[o.status] || o.status} ${humanAction}${suppress ? '' : '：' + o.detail}`;
    });
    // 2026-08-28 发布冲刺项4 P1（交付清单第4类第3项）："Obsidian 未打开/开关
    // 未开"这句提示，只在动作提交后一直等不到结算（timeout/unknown——真正
    // 可能是 Obsidian 没在跑或执行开关没开）时才成立。项3实测发现它被无条件
    // 加在结算消息末尾，连 schema 校验失败（服务端已经给出"缺哪个字段"这种
    // 明确原因）都会带上，把研究员往错的方向引——字段缺失和 Obsidian 有没有
    // 打开毫无关系。改成只在真的有 timeout/unknown 这类"不知道是否到达
    // Obsidian"的结果时才附加这句排查提示。
    const hasAmbiguousOutcome = outcomes.some((o) => o.status === 'timeout' || o.status === 'unknown');
    const ambiguousHint = hasAmbiguousOutcome
      ? '\n（可切到对应面板查看；若显示失败，通常是 Obsidian 未打开或「允许织研者执行 Scholarium 动作」开关未开）'
      : '';
    appendToChat(flowId, { role: 'system', text: '面板修改执行结果：\n' + lines.join('\n') + ambiguousHint, at: new Date().toISOString() });
    // 有超时/未知的动作时不算"已确认完成"：那正是崩溃窗口的形状，留给研究员按
    // 账本核对（锁定条会显示"正在核对执行结果"），而不是自己宣布成功。
    const unresolved = outcomes.some((o) => o.status === 'timeout' || o.status === 'unknown');
    await settleChatConfirmation(message, 'action', lifecycle.operationId, unresolved
      ? { error: '部分动作未结算（超时或状态未知），需要人工核对', detail: { outcomes } }
      : { detail: { outcomes: outcomes.map((o) => ({ action: o.action, status: o.status })) } });
    saveChat(); renderChat();
  }

  // 确认卡片：跟在含动作块的那条 agent 消息下面。整卡居中；如果整批都是
  // 排日程（timeblock_add），渲染成一张真正的计划表格而不是 key=value 堆叠。
  const ACTION_LABEL = {
    'workspace.timeblock_add': '排日程', 'workspace.timeblock_update': '改日程', 'workspace.timeblock_remove': '删日程',
    'workspace.checkin_upsert': '考勤打卡', 'workspace.habit_add': '新建习惯', 'workspace.habit_log': '习惯打卡',
    'workspace.emotion_log': '记心情', 'workspace.task_add': '加任务', 'workspace.task_update': '改任务', 'workspace.task_remove': '删任务',
    'workspace.focus_log': '补记专注', 'workspace.capture_add': '速记',
    'material.add': '登记素材', 'material.update': '改素材', 'material.remove': '移除素材登记', 'material.category_add': '加素材分类', 'material.category_remove': '移除空素材分类',
    'rss.set_article_score': '改文章评分', 'rss.mark_article': '标已读/收藏',
    'experiment.append_note': '实验日志', 'experiment.transition': '推进实验状态',
    'experiment.invalidate_provenance': '失效并隔离实验来源链',
    'experiment.insert_chem': '插入化学结构',
  };
  // Each confirmation card carries the provider snapshot captured by Bridge at
  // task dispatch. Never infer it from reply text or a model-supplied field.
  function providerNotice(provider) {
    const note = document.createElement('div');
    note.className = 'wv-provider-notice';
    if (provider?.trust === 'official-provider') {
      note.classList.add('is-official');
      note.textContent = `来源：${provider.label} · ${provider.route}（由 cc-switch 配置判定）`;
    } else if (provider?.trust === 'third-party') {
      note.classList.add('is-warning');
      note.textContent = `⚠️ 本条内容来自 ${provider.label} · ${provider.route}，非官方 Claude；请核对后再确认。`;
    } else {
      note.classList.add('is-warning');
      note.textContent = '⚠️ 本条内容的 provider 无法独立确认，按第三方链路处理；请核对后再确认。';
    }
    return note;
  }
  function actionCard(message) {
    if (!Array.isArray(message.actions) || !message.actions.length) return null;
    const state = confirmationState(message, 'action');
    const card = document.createElement('div');
    card.className = 'wv-action-card';
    card.dataset.confirmationState = state;
    const title = document.createElement('div');
    title.className = 'wv-action-card-title';
    const done = Number(message.actionsDone || 0);
    title.textContent = state === 'abandoned'
      ? '修改请求（已放弃，未执行）'
      : message.actionsState === 'settled'
      ? '修改请求（已执行）'
      : message.actionsState === 'executing'
        ? `正在执行 ${done}/${message.actions.length}…`
        : `织研者请求修改 Scholarium（${message.actions.length} 项）`;
    card.appendChild(title);
    card.appendChild(providerNotice(message.provider));
    const allTimeblocks = message.actions.every((r) => r.action === 'workspace.timeblock_add' && r.input && r.input.start && r.input.end && r.input.title);
    if (allTimeblocks) {
      // 关联实验列只显示模型实际打算发送的值（experiment_display_id 优先，
      // 否则原样展示 experiment_uid）——这是"即将发送的请求"的预览，不在
      // 客户端猜测或解析，真正的存在性校验在服务端 resolveExperimentUid 里。
      const showsExperimentColumn = message.actions.some((r) => r.input.experiment_uid || r.input.experiment_display_id);
      const table = document.createElement('table');
      table.className = 'wv-action-plan';
      table.innerHTML = `<thead><tr><th>时间</th><th>安排</th><th>类别</th>${showsExperimentColumn ? '<th>关联实验</th>' : ''}</tr></thead>`;
      const tbody = document.createElement('tbody');
      for (const req of message.actions) {
        const tr = document.createElement('tr');
        const date = String(req.input.date || '');
        const cells = [`${date.slice(5)} ${req.input.start}–${req.input.end}`, String(req.input.title || ''), String(req.input.category || 'research')];
        if (showsExperimentColumn) cells.push(String(req.input.experiment_display_id || req.input.experiment_uid || '—'));
        for (const value of cells) { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      card.appendChild(table);
    } else {
      for (const req of message.actions) {
        const row = document.createElement('div');
        row.className = 'wv-action-row';
        const name = document.createElement('code');
        name.textContent = ACTION_LABEL[req.action] || req.action;
        const detail = document.createElement('span');
        detail.className = 'wv-action-detail';
        detail.textContent = Object.entries(req.input).map(([k, v]) => `${k}=${v}`).join('  ');
        row.append(name, detail);
        card.appendChild(row);
      }
    }
    if (isConfirmableState(state) && message.actionsState !== 'settled') {
      const bar = document.createElement('div');
      bar.className = 'wv-action-bar';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wv-action-confirm';
      btn.disabled = message.actionsState === 'executing';
      btn.textContent = message.actionsState === 'executing' ? `正在执行 ${done}/${message.actions.length}…` : '确认执行（写入 Scholarium）';
      btn.addEventListener('click', () => executeScholariumActions(chatFlowId, message));
      bar.appendChild(btn);
      appendAbandonButton(bar, message, 'action');
      if (message.actionsState === 'executing') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'wv-action-cancel';
        cancel.textContent = '取消剩余项';
        cancel.addEventListener('click', () => { message.actionsCancel = true; saveChat(); renderChat(); });
        bar.appendChild(cancel);
      }
      card.appendChild(bar);
    }
    return card;
  }

  // 2026-08-28 发布冲刺项4 P1（交付清单第2/3类）：项3实测发现好几类恢复类
  // 报错都是英文原文直出、且没写"具体怎么办"，而它们的恢复方式各不相同：
  // - `Local Bridge is not running.`：代理还活着但 Bridge 子进程已死/未起，
  //   必须重启 npm start。
  // - `invalid or missing Agent Bridge token`：代理转发的 token 和 Bridge
  //   进程内存里的不一致（常见于改了 bridge.config.json 但 Bridge 还没重
  //   启，或反过来），只需把 token 改回一致，不需要重启任何进程。
  // - `... not found or expired` / `... expired; ...`（draft batch 与
  //   experiment-transition 的两阶段确认卡片共用同一套措辞）：确认卡片本身
  //   没坏，只是这一次的中间态过期或已被消费，重新问一遍生成新卡片即可。
  // 所以不能翻译成一句通用的"出错了"，必须按原因给出对应步骤；未识别的
  // 错误原样透出，不额外包装，保持可诊断性。
  function humanizeActionError(message) {
    const raw = String(message || '').trim();
    if (/Local Bridge is not running/.test(raw)) {
      return '本地 Bridge 进程没有在运行（代理还在，但 Bridge 子进程已经退出或从未启动）。请在启动织研者的终端重新执行 npm start（或单独执行 node bridge/server.js），看到监听信息后点左下角「检查本机 Bridge」确认恢复，再重新发送这句话。';
    }
    if (/invalid or missing Agent Bridge token/.test(raw)) {
      return '本机令牌不一致（通常是刚改过 agent-canvas-demo/bridge/bridge.config.json 里的 token，Bridge 进程还记着旧值，或反过来）。打开该文件核对 token 字段、改回一致后保存即可恢复，不需要重启任何进程，也不需要重载 Obsidian 插件。';
    }
    if (/not found or expired/.test(raw) || /expired;/.test(raw)) {
      return `这张确认卡片已经失效（${raw}），不是写入失败——请重新向我提出同样的请求，我会生成一张新的确认卡片。`;
    }
    return raw;
  }

  async function sendChatMessage() {
    const text = (chatInput?.value || '').trim();
    if (!text || chatBusy) return;
    const ownerFlow = chatFlowId; // the reply lands here even if the user switches topics mid-turn

    // 正文存储没就绪（Bridge 不在/读不到）时连本地都不留：既不能假装已保存，
    // 也不能退回 localStorage 生成第二份互不相干的历史。输入框内容保留。
    if (chatStorageError || chatStorageBusy || !chatSessions.get(ownerFlow)) {
      chatMessages.push({ role: 'system', text: `这句话没有发送，也没有保存：${chatStorageError || '正文存储还在读取中'}。输入的内容仍在输入框里；等左下角显示「本机 Bridge 已连接」、或对话区顶部的提示消失后，再按 Enter 重发即可。`, at: new Date().toISOString() });
      renderChat();
      return;
    }

    // Add user message
    const userMessage = { messageId: newChatMessageId(), role: 'user', text, at: new Date().toISOString() };
    chatMessages.push(userMessage);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    renderChat();

    // ── 关键路径 ①：先把这句落进 Vault，再派发任务 ──────────────────────
    // 为什么必须在这里 await：任务一旦派出去，Agent 会开始按这句话行动。
    // 如果此时正文还没落盘，用户看到的是一个已经"发生过"的回合，而磁盘上
    // 什么都没有——这正是这次要修的缺陷本身。落盘失败就到此为止，不发送。
    const persistedUser = await flushChat(ownerFlow, [userMessage]);
    if (!persistedUser.ok) {
      chatMessages.push({ role: 'system', text: `这句话没有保存到 Vault，因此也没有发送给 Agent（${persistedUser.error || '原因未知'}）。上面那条气泡标了"未保存"，可以复制正文，或修好 Bridge 后点"重试保存"再重发。`, at: new Date().toISOString() });
      renderChat(); return;
    }

    // Check Bridge
    if (!zhiyanBridge.online) {
      chatMessages.push({ role: 'system', text: '这句话已保存到本课题的会话里，但 Bridge 未连接，所以没有发给 Agent。请先在启动织研者的终端确认 npm start 仍在运行（看到监听信息即正常）；如果它已经退出，重新执行 npm start，再点左下角「检查本机 Bridge」连接后重发。', at: new Date().toISOString() });
      renderChat(); return;
    }

    // Show thinking
    chatBusy = true;
    updateComposerState();

    try {
      const profile = chatProfile();
      if (!profile) throw new Error('没有可用的 Agent CLI。请确认 Bridge 已连接且至少一个 CLI 已安装。');
      pending = { taskId: null, adapter: profile.adapterId, status: 'queued', stage: '', startedAt: Date.now(), flowId: ownerFlow };
      renderChat();

      // "生成知识图谱" is an executable conversational capability, not a
      // canned answer. The selected Agent performs semantic extraction and the
      // bundled ZRL renderer writes validated JSON + offline HTML. Keep this
      // narrow: merely discussing graphs must not create files.
      const kgCore = window.weaverKnowledgeGraphCore;
      if (kgCore?.isExplicitGraphRequest?.(text) && typeof window.researchWeaverGenerateKnowledgeGraph === 'function') {
        const output = await window.researchWeaverGenerateKnowledgeGraph(text);
        const manifest = output?.manifest || {};
        const warningText = manifest.warnings?.length ? `\n\n质量警告：\n${manifest.warnings.map((item) => `- ${item}`).join('\n')}` : '';
        appendToChat(ownerFlow, {
          role: 'agent',
          text: `已调用 zrl-knowledge-graph：生成 ${manifest.nodes || 0} 个语义实体、${manifest.edges || 0} 条可追溯关系。\n\n交互式 HTML：${manifest.html}\n图数据：${manifest.graph}\n审计报告：${manifest.report}${warningText}`,
          at: new Date().toISOString(),
        });
        return;
      }

      // Build a conversational prompt with workspace context
      const workspace = workspaceRoot || $('#workspaceRoot')?.value || '';
      const taskGoal = $('#taskGoal')?.value || '';

      // 先检索已入库的文献语料（best-effort：RAG 不可用就静默降级为普通对话）
      let ragBlock = '';
      try {
        const rag = await bridgeFetch('/v1/rag/query', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: text, k: 4 }),
        });
        const hits = rag?.manifest?.results || [];
        if (hits.length) {
          const retrieval = rag?.manifest?.retrieval || 'unknown';
          const warning = (rag?.manifest?.warnings || []).join('；');
          ragBlock = `\n\n你的文献库检索命中（实际检索：${retrieval}${warning ? `；告警：${warning}` : ''}。回答时优先基于这些内容，并在相关处用（来源：文件路径#小节）标注出处；命中内容不相关就忽略，不要硬引）：\n`
            + hits.map((h, i) => `[${i + 1}] 来源：${h.source}${h.heading ? `#${h.heading}` : ''}\n${h.snippet}`).join('\n\n');
        }
      } catch { /* RAG offline: plain conversation */ }

      // 启动上下文装载：读取工作区 .scholarium/agent/ 长期记忆，注入与本轮
      // 问题最相关的片段（best-effort：目录不可写或 Bridge 过旧时静默降级）。
      let memoryBlock = '';
      try {
        const memory = await bridgeFetch(`/v1/agent-memory/context?query=${encodeURIComponent(text.slice(0, 2000))}`);
        if (memory?.block) memoryBlock = `\n\n${memory.block}\n`;
      } catch { /* memory offline: plain conversation */ }

      const chatCore = window.weaverResearchChatCore;
      if (!chatCore?.buildResearchChatPrompt) throw new Error('科研对话协议未加载，请重载 Scholarium 面板后重试。');
      // 项目状态与 RAG/长期记忆一样由编排层预取，不把“是否读取真实 EXP/HYP”
      // 这件事留给模型自行决定。projectId 是每个聊天主题显式保存的绑定；没有
      // 绑定时明确注入未验证状态，绝不从工作区路径或侧栏展开行猜测。
      const projectId = window.researchWeaver?.activeTopic?.projectId || '';
      let projectState = null, outcomeState = null, driftState = null, projectStateError = '';
      if (projectId) {
        try {
          const projectQuery = new URLSearchParams({ action: 'project.get', input: JSON.stringify({ display_id: projectId }) });
          const outcomesQuery = new URLSearchParams({ action: 'experiment.scan_outcomes', input: JSON.stringify({ project_uid: '' }) });
          const projectResponse = await bridgeFetch(`/v1/scholarium/state?${projectQuery.toString()}`);
          const projectUid = projectResponse?.result?.project?.uid || '';
          const scopedOutcomesQuery = new URLSearchParams({ action: 'experiment.scan_outcomes', input: JSON.stringify({ project_uid: projectUid }) });
          const outcomesResponse = projectUid
            ? await bridgeFetch(`/v1/scholarium/state?${scopedOutcomesQuery.toString()}`)
            : await bridgeFetch(`/v1/scholarium/state?${outcomesQuery.toString()}`);
          projectState = projectResponse?.result || null;
          outcomeState = outcomesResponse?.result || null;
          // Same best-effort prefetch discipline as project.get/scan_outcomes
          // above (2026-08-26): only meaningful once we have a real project
          // uid to scope it to, since workspace.timeblocks isn't itself
          // project-scoped.
          if (projectUid) {
            const driftQuery = new URLSearchParams({ action: 'workspace.timeblock_drift_audit', input: JSON.stringify({ project_uid: projectUid }) });
            const driftResponse = await bridgeFetch(`/v1/scholarium/state?${driftQuery.toString()}`);
            driftState = driftResponse?.result || null;
          }
        } catch (error) { projectStateError = error?.message || '读取失败'; }
      }
      const projectBlock = chatCore.projectContextBlock
        ? chatCore.projectContextBlock(projectId, projectState, outcomeState, projectStateError, driftState)
        : '';
      const prompt = chatCore.buildResearchChatPrompt({
        message: text,
        messages: chatMessages,
        taskGoal,
        workspace,
        ragBlock,
        memoryBlock,
        projectBlock,
        capabilities: `${laneCapabilities(profile.adapterId)}\n\n${scholariumCapabilities()}`,
      });

      const created = await bridgeFetch('/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentId: profile.adapterId,
          cwd: workspace,
          prompt,
          permission: 'read',
          execute: true
        })
      });
      if (!created?.id) throw new Error('Bridge 未返回任务 ID；请检查 npm start 窗口是否报错。');
      if (pending) pending.taskId = created.id;
      const finished = await pollTaskFull(created.id);
      const reply = extractReply(finished);
      const rawReply = reply.text;
      let protocolBlocks = null;
      // 织研者可以在回复里用 ```scholarium-action 块请求对 Scholarium 面板
      // 的实际修改（排日程、打卡、改评分等）。块从正文剥离，渲染成确认卡片，
      // 用户点「确认执行」后才真正投递队列——模型自己永远无法直接落笔。
      if (reply.role === 'agent') {
        const runParsed = parseRunRequests(reply.text);
        if (runParsed.runs.length) {
          reply.text = runParsed.text;
          reply.runs = runParsed.runs;
        }
        const parsed = parseActionRequests(reply.text);
        if (parsed.actions.length) {
          reply.text = parsed.text;
          reply.actions = parsed.actions;
        }
        const draftParsed = parseDraftRequests(reply.text);
        if (draftParsed.drafts.length) {
          reply.text = draftParsed.text;
          reply.drafts = draftParsed.drafts;
        }
        const legacyNoteEditParsed = parseLegacyNoteEditRequests(reply.text);
        if (legacyNoteEditParsed.edits.length) {
          reply.text = legacyNoteEditParsed.text;
          reply.legacyNoteEdits = legacyNoteEditParsed.edits;
        }
        const normalizeParsed = parseNormalizeRequests(reply.text);
        if (normalizeParsed.normalizations.length) {
          reply.text = normalizeParsed.text;
          reply.normalizations = normalizeParsed.normalizations;
        }
        const plotParsed = parsePlotRequests(reply.text);
        if (plotParsed.plots.length) {
          reply.text = plotParsed.text;
          reply.plots = plotParsed.plots;
        }
        const plotRevisionParsed = parsePlotRevisionRequests(reply.text);
        if (plotRevisionParsed.revisions.length) {
          reply.text = plotRevisionParsed.text;
          reply.plotRevisions = plotRevisionParsed.revisions;
        }
        const suggestParsed = parseSuggestReconstructionRequests(reply.text);
        if (suggestParsed.suggestions.length) {
          reply.text = suggestParsed.text;
          reply.suggestReconstructions = suggestParsed.suggestions;
        }
        // Keep rejected protocol attempts visible as a concise, non-executable
        // renderer card—not as a giant escaped JSON code block in the chat.
        const concealed = concealMalformedProtocolBlocks(reply.text);
        reply.text = concealed.text;
        if (concealed.failures.length) reply.protocolFailures = concealed.failures;
        protocolBlocks = {
          run: runParsed.stats,
          action: parsed.stats,
          draft: draftParsed.stats,
          legacyNoteEdit: legacyNoteEditParsed.stats,
          normalize: normalizeParsed.stats,
          plot: plotParsed.stats,
          plotRevision: plotRevisionParsed.stats,
          suggestReconstruction: suggestParsed.stats,
        };
        reply.confirmationStates = {
          run: runParsed.runs.length ? 'pending' : 'none',
          action: parsed.actions.length ? 'pending' : 'none',
          draft: draftParsed.drafts.length ? 'pending' : 'none',
          legacyNoteEdit: legacyNoteEditParsed.edits.length ? 'pending' : 'none',
          normalize: normalizeParsed.normalizations.length ? 'pending' : 'none',
          plot: plotParsed.plots.length ? 'pending' : 'none',
          plotRevision: plotRevisionParsed.revisions.length ? 'pending' : 'none',
          suggestReconstruction: suggestParsed.suggestions.length ? 'pending' : 'none',
        };
        reply.protocolAudit = {
          replyLength: rawReply.length,
          blocks: protocolBlocks,
          renderedCards: [runParsed.runs, parsed.actions, draftParsed.drafts, legacyNoteEditParsed.edits, normalizeParsed.normalizations, plotParsed.plots, plotRevisionParsed.revisions, suggestParsed.suggestions].filter((items) => items.length).length,
          writeClaim: detectWriteClaim(rawReply),
        };
      }
      const storedReply = { ...reply, taskId: created.id, provider: created.provider, projectDisplayId: projectId, flowId: ownerFlow, at: new Date().toISOString() };
      appendToChat(ownerFlow, storedReply);
      // ── 关键路径 ②：回复先落盘，再把它当成"已完成" ────────────────────
      // 思考指示熄灭、输入框解锁，对用户来说就是"这轮结束了"。如果这时正文
      // 还没进 Vault，人会以为已经记下来，而磁盘上什么都没有。所以这里必须
      // 等出结果；失败就明确标"未保存"，不改成"看起来成功了"。
      const persistedReply = await flushChat(ownerFlow, [storedReply]);
      if (!persistedReply.ok) {
        appendToChat(ownerFlow, {
          role: 'system',
          text: `织研者这条回复没有保存到 Vault（${persistedReply.error || '原因未知'}）。上面那条气泡标了"未保存"，请先用"复制正文"留底；Bridge 恢复后点"重试保存"即可补上，不需要再问一遍 Agent。`,
          at: new Date().toISOString(),
        });
      }
      if (storedReply.protocolAudit) {
        void auditChatTurn(storedReply, 'parsed');
        const writeParsed = (protocolBlocks.action?.parsed || 0) + (protocolBlocks.draft?.parsed || 0) + (protocolBlocks.legacyNoteEdit?.parsed || 0);
        const writeRejected = (protocolBlocks.action?.rejected || 0) + (protocolBlocks.draft?.rejected || 0) + (protocolBlocks.legacyNoteEdit?.rejected || 0);
        if (storedReply.protocolAudit.writeClaim && writeParsed === 0) {
          const detail = writeRejected > 0
            ? '检测到动作/草稿协议块，但没有一块通过解析；错误内容已渲染为不可执行的格式错误卡。'
            : '本轮没有产生任何可执行的动作或草稿请求。';
          appendToChat(ownerFlow, {
            role: 'error',
            text: `安全告警：织研者使用了“${storedReply.protocolAudit.writeClaim}”一类已完成表述，但${detail}实际什么都没有写入。`,
            taskId: created.id,
            at: new Date().toISOString(),
          });
        }
      }
      // 任务结束 checkpoint + 分级记忆（best-effort，不影响对话本身）：
      // checkpoint 全量覆写 task-checkpoint.md，新会话启动时自动续接；
      // 回复中"建议记入 xxx：…"的长期记忆建议按"待确认"级别自动落盘，
      // 由研究员在 .scholarium/agent/ 笔记中确认后提升状态。
      if (reply.role === 'agent') {
        try {
          // 回复摘要是给"下次续接"看的，不是存档全文：剥掉 Markdown 标记、
          // 只取前两个句号/换行截止的句子，上限 300 字（之前直接 slice(0,800)
          // 把整篇含标题/链接的回复塞进了 checkpoint，续接时反而淹没问题本身）。
          const plainReply = reply.text
            .replace(/```[\s\S]*?```/g, ' ').replace(/[#>*`\[\]()]/g, '')
            .replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
          // 最多取前两句（中文/英文句末标点都算），两句总长仍超 300 字再硬截。
          const parts = plainReply.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
          const excerpt = (parts.slice(0, 2).join('') || plainReply).slice(0, 300);
          await bridgeFetch('/v1/agent-memory/checkpoint', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ lastQuestion: text, replyExcerpt: excerpt }),
          });
          const suggestions = reply.text.match(/建议记入\s*(decisions|evidence-ledger|lessons)[：:]\s*([^\n]+)/g) || [];
          for (const line of suggestions.slice(0, 3)) {
            const match = line.match(/建议记入\s*(decisions|evidence-ledger|lessons)[：:]\s*([^\n]+)/);
            if (!match) continue;
            await bridgeFetch('/v1/agent-memory/entry', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ file: `${match[1]}.md`, title: match[2].slice(0, 80), body: match[2], status: '待确认' }),
            });
          }
        } catch { /* memory write failed: conversation unaffected */ }
      }
    } catch (error) {
      appendToChat(ownerFlow, { role: 'system', text: `对话失败：${humanizeActionError(error.message)}`, at: new Date().toISOString() });
    } finally {
      pending = null;
      chatBusy = false;
      saveChat();   // 把 finally 之前产生的增量交给队列；关键路径已各自 await 过
      updateComposerState();
      renderChat();
    }
  }

  // Wire chat input
  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  chatInput?.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });
  chatSend?.addEventListener('click', sendChatMessage);

  // Observe run progress changes — update the compact summary in chat
  let paintTimer = null;
  function scheduleRender() {
    clearTimeout(paintTimer);
    // refreshProgress() writes styles/textContent in place and refreshRunSummary()
    // touches one small container. Neither rebuilds the transcript — calling
    // renderChat() here was the flicker.
    paintTimer = setTimeout(() => { refreshProgress(); refreshRunSummary(); }, 120);
  }

  function isDownloadProgressMutation(mutation) {
    const node = mutation.target;
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return Boolean(element?.closest?.('.wv-download-inline-progress'));
  }
  if (runSteps) {
    new MutationObserver((mutations) => {
      // DOI-level updates have their own fixed card below the dialog.  Ignoring
      // them here prevents the separate run-summary card from repainting every
      // time the download counter changes.
      if (mutations.some((mutation) => !isDownloadProgressMutation(mutation))) scheduleRender();
    }).observe(runSteps, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
  }
  if (runResult) {
    new MutationObserver(scheduleRender).observe(runResult, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  $('#workspaceRoot')?.addEventListener('change', scheduleRender);
  window.addEventListener('bridge:agents', scheduleRender);
  window.addEventListener('weaver:download-progress', (event) => refreshDownloadProgress(event.detail));
  refreshProgress();
  syncChatTopicLabel();
  renderChat();

  // Chat-view actions delegate to the buttons bridge-ui already bound.
  $('#chatRunPipeline')?.addEventListener('click', () => $('#runPipeline')?.click());
  $('#chatRunWorkflow')?.addEventListener('click', () => $('#runWorkflow')?.click());
  $('#chatSearch')?.addEventListener('click', () => $('#searchLiterature')?.click());

  /* -------------------------------------------------------- header UI -- */

  const moreButton = $('#moreActions');
  const moreMenu = $('#moreMenu');
  function closeMenu() {
    if (!moreMenu) return;
    moreMenu.hidden = true;
    moreButton?.setAttribute('aria-expanded', 'false');
  }
  moreButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!moreMenu) return;
    moreMenu.hidden = !moreMenu.hidden;
    moreButton.setAttribute('aria-expanded', String(!moreMenu.hidden));
  });
  moreMenu?.addEventListener('click', () => setTimeout(closeMenu, 0));
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });

  $('#openProfiles')?.addEventListener('click', () => $('#showProfiles')?.click());
  $('#openSkills')?.addEventListener('click', () => $('#showSkills')?.click());

  /* --------------------------------------------------- column resizers -- */

  // Left/right rails are user-resizable; widths live in CSS custom properties
  // on :root so the grid, the resizer positions and persistence stay in sync.
  const WIDTH_KEYS = { left: 'weaver.shell.leftWidth', right: 'weaver.shell.rightWidth' };
  const rootStyle = document.documentElement.style;

  function applyStoredWidths() {
    try {
      const left = Number(localStorage.getItem(WIDTH_KEYS.left));
      const right = Number(localStorage.getItem(WIDTH_KEYS.right));
      if (left) rootStyle.setProperty('--wv-left-w', `${left}px`);
      if (right) rootStyle.setProperty('--wv-right-w', `${right}px`);
    } catch { /* private mode */ }
  }

  function makeResizable(handle, side) {
    if (!handle) return;
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('is-dragging');
      const startX = event.clientX;
      const app = document.querySelector('.wv-app');
      const startWidth = side === 'left'
        ? (document.querySelector('.wv-left')?.getBoundingClientRect().width || 232)
        : (document.querySelector('.wv-right')?.getBoundingClientRect().width || 288);
      const move = (moveEvent) => {
        const delta = moveEvent.clientX - startX;
        const raw = side === 'left' ? startWidth + delta : startWidth - delta;
        const clamped = Math.min(480, Math.max(180, Math.round(raw)));
        rootStyle.setProperty(side === 'left' ? '--wv-left-w' : '--wv-right-w', `${clamped}px`);
      };
      const up = () => {
        handle.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        try {
          const width = Math.round((side === 'left'
            ? document.querySelector('.wv-left')
            : document.querySelector('.wv-right'))?.getBoundingClientRect().width || 0);
          if (width) localStorage.setItem(WIDTH_KEYS[side], String(width));
        } catch { /* private mode */ }
        void app;
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  applyStoredWidths();
  makeResizable($('#resizeLeft'), 'left');
  makeResizable($('#resizeRight'), 'right');

  /* ------------------------------------------------- project summary -- */

  const taskGoal = $('#taskGoal');
  const goalPreview = $('#projectGoalPreview');
  function syncGoal() {
    if (!goalPreview) return;
    const text = (taskGoal?.value || '').trim();
    goalPreview.textContent = text || '尚未填写任务目标。';
  }
  taskGoal?.addEventListener('input', syncGoal);
  syncGoal();

  const permission = $('#projectPermission');
  const permissionField = $('#fieldPermission');
  const permissionLabels = { read: '只读', propose: '提议', write: '写入' };
  permissionField?.addEventListener('change', () => {
    if (permission) permission.textContent = permissionLabels[permissionField.value] || '只读';
  });

  /* ------------------------------------------------------ canvas zoom -- */

  const stage = $('#canvasStage');
  const zoomLevel = $('#zoomLevel');
  if (stage && zoomLevel) {
    const readZoom = () => {
      const match = /scale\(([\d.]+)\)/.exec(stage.style.transform || '');
      zoomLevel.textContent = `${Math.round((match ? Number(match[1]) : 1) * 100)}%`;
    };
    new MutationObserver(readZoom).observe(stage, { attributes: true, attributeFilter: ['style'] });
    readZoom();
  }

  /* --------------------------------------------------------- start-up -- */

  let storedView = 'chat';
  let storedTracker = 'steps';
  try {
    storedView = localStorage.getItem(VIEW_KEY) || 'chat';
    storedTracker = localStorage.getItem(TRACKER_KEY) || 'steps';
  } catch { /* private mode */ }
  setView(storedView);
  setTracker(storedTracker);

  // 正文读取放在整个模块初始化之后：renderChat 会用到后面才声明的宿主节点，
  // 在这里调用才保证那些 let 已经初始化（否则就是 TDZ 报错，而不是"读不到"）。
  void bootstrapChat();
})();
