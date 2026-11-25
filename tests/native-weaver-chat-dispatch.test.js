"use strict";
/**
 * Sending must not depend on a successful transcript repaint. These tests run
 * the actual vendored ResearchWeaverView methods, including the real history
 * that previously persisted user turns without an Agent reply.
 */
const fs = require("node:fs");
const path = require("node:path");
const { describe, it, assert } = require("./harness");
const contract = require("../agent-canvas-demo/plot-tool-contract.js");
const embed = require("../tools/embed-native-weaver.js");

const ROOT = path.join(__dirname, "..");
const HISTORY = path.join(ROOT, "..", "..", "Scholarium/Chat/v1/488d7c98a5987784b1abb8f9/s-2u5e3a0m-81b805a6.jsonl");

function nativeModel() {
  const tools = new Function(
    "schPlotToolContract",
    `${fs.readFileSync(path.join(ROOT, "tools/native-weaver-plot-tools.js"), "utf8")}\nreturn schNativeWeaverPlotTools;`,
  )(contract);
  let page = embed.applyPlotToolPatches(fs.readFileSync(path.join(ROOT, "vendor/native-weaver/scholarium-weaver-native.js"), "utf8"));
  if (typeof embed.applyChatRuntimePatches === "function") page = embed.applyChatRuntimePatches(page);
  const anchor = "  return __toCommonJS(scholarium_embed_exports);";
  assert.equal(page.split(anchor).length - 1, 1);
  page = page.replace(anchor, "  globalThis.__nativeChatTest = { ResearchWeaverView, confirmationCards };\n" + anchor);
  const sandbox = { schNativeWeaverPlotTools: tools, require, console, setInterval, clearInterval, setTimeout, clearTimeout };
  sandbox.globalThis = sandbox;
  new Function("sandbox", `with (sandbox) {\n${page}\n}`)(sandbox);
  return { native: sandbox.__nativeChatTest, tools };
}

const { native, tools } = nativeModel();

function historicalRecords() {
  return fs.readFileSync(HISTORY, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

function logicView(overrides = {}) {
  const notices = [];
  const view = Object.create(native.ResearchWeaverView.prototype);
  Object.assign(view, {
    mode: "chat",
    busy: false,
    pageId: "page-test",
    pendingTurns: new Map(),
    stoppingTurns: new Set(),
    thinkingTimer: null,
    thinkingEl: null,
    thinkingBodyEl: null,
    notices,
    textareaEl: { value: "继续修改" },
    composerHintEl: { textContent: "" },
    canDispatch: () => true,
    withActiveNote: (text) => text,
    renderStatus() {},
    renderAll() {},
    renderMessages() {},
    renderSessions() {},
    renderSideTabs() {},
    syncWindow() {},
    scrollToBottom() {},
    async refreshSessions() {},
    async applyProposedTitle() {},
    showNotice(message, kind = "error") { notices.push({ message, kind }); },
  }, overrides);
  return { view, notices };
}

describe("native 织研者对话：重绘异常不能阻断 Agent", () => {
  it("消息持久化后，即使发送前全页重绘抛错也仍进入 dispatch", async () => {
    const sent = [];
    const targetSession = {
      snapshot: () => ({ sessionId: "s-existing" }),
      send: async (text) => { sent.push(text); return { dispatched: true }; },
    };
    const { view, notices } = logicView({
      session: targetSession,
      renderAll() { throw new Error("历史卡重绘失败"); },
      async dispatch(session) { view.dispatched = session; },
    });
    await view.onSend();
    assert.deepEqual(sent, ["继续修改"]);
    assert.equal(view.dispatched, targetSession);
    assert.equal(view.busy, false);
    assert.ok(notices.some((entry) => entry.message.includes("历史卡重绘失败")), "重绘错误必须可诊断");
  });

  it("startThinking 的重绘抛错仍调用 Agent，并最终释放会话锁", async () => {
    const records = historicalRecords();
    const messages = records.filter((record) => record.type === "message");
    const sessionId = records[0].sessionId;
    const replies = [];
    const releases = [];
    let resolveAgent;
    let agentCalls = 0;
    let thinkingWhenCalled = false;
    const targetSession = {
      snapshot: () => ({ sessionId, messages, archived: false, status: "ready", title: records[0].title, unsaved: [] }),
      async recordReply(reply) { replies.push(reply); return { ok: true }; },
    };
    const { view, notices } = logicView({
      session: targetSession,
      deps: {
        scope: { scopeKey: records[0].scopeKey },
        store: {
          claimTurn: () => true,
          releaseTurn: (...args) => releases.push(args),
        },
        sendToAgent: async () => {
          agentCalls += 1;
          thinkingWhenCalled = view.pendingTurns.has(sessionId);
          return new Promise((resolve) => { resolveAgent = resolve; });
        },
      },
      renderMessages() { throw new Error("运行卡重绘失败"); },
      renderAll() { throw new Error("结算重绘失败"); },
    });
    const pending = view.dispatch(targetSession);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(agentCalls, 1);
    assert.equal(thinkingWhenCalled, true, "Agent 调用前已建立 pendingTurns 运行状态");
    resolveAgent({ role: "agent", text: "已完成" });
    await pending;
    assert.equal(replies.length, 1);
    assert.equal(releases.length, 1);
    assert.equal(view.pendingTurns.size, 0);
    assert.ok(notices.some((entry) => entry.message.includes("运行卡重绘失败")));
  });
});

class FakeNode {
  constructor(tag, text = null) {
    this.tag = tag;
    this.children = [];
    this.parentElement = null;
    this.attrs = {};
    this.className = "";
    this.textContent = text ?? "";
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
  }
  append(...nodes) {
    for (const node of nodes.flat()) {
      if (node == null) continue;
      if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((child) => child !== node);
      node.parentElement = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener() {}
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }
  find(predicate, found = []) {
    if (predicate(this)) found.push(this);
    for (const child of this.children) child.find(predicate, found);
    return found;
  }
}

function historicalView() {
  const records = historicalRecords();
  const messages = records.filter((record) => record.type === "message");
  const sessionId = records[0].sessionId;
  const ledger = { entries: new Map(), events: [] };
  const session = {
    snapshot: () => ({ sessionId, messages, archived: false, status: "ready", title: records[0].title, unsaved: [], error: null }),
    cards: () => native.confirmationCards(messages, ledger),
    derivedStates: () => ({ actionsState: "none", draftsState: "none" }),
    isCardHidden: () => false,
  };
  const doc = { createElement: (tag) => new FakeNode(tag), createTextNode: (text) => new FakeNode("#text", String(text)) };
  const { view } = logicView({
    document: doc,
    session,
    displayed: messages,
    lastSearch: null,
    messagesEl: new FakeNode("div"),
    noticeEl: new FakeNode("div"),
    contextEl: new FakeNode("div"),
    scopeCardEl: new FakeNode("div"),
    sessionsEl: new FakeNode("div"),
    traceEl: new FakeNode("div"),
    railStateEl: new FakeNode("div"),
    sessionTitleEl: new FakeNode("div"),
    sessionMetaEl: new FakeNode("div"),
    pendingTagEl: new FakeNode("div"),
    composerHintEl: new FakeNode("div"),
    sendButton: new FakeNode("button"),
    runtimeFooterEl: new FakeNode("div"),
    earlierButton: null,
    host: { containerEl: new FakeNode("div") },
    cardButtons: [],
    expandedMessages: new Set(),
    deps: {
      plotTools: tools,
      bridge: { status: "online" },
      scope: { scopeKey: records[0].scopeKey },
      executePlotTool: async () => { throw new Error("渲染测试不应执行绘图"); },
      sendToAgent: async () => null,
      cancelAgentTurn: async () => "已停止",
    },
    context: { projectId: records[0].projectId, flowId: records[0].topicId, agentId: "claude", workspaceRoot: "" },
    sessions: [{ sessionId, title: records[0].title, archived: false, messageCount: messages.length, updatedAt: messages.at(-1).at }],
    workbench: { renderLiteratureCard: () => null },
    railPanels: new Map(),
    railTab: "trace",
    agents: [],
    agentsLoaded: false,
    sideTabsEl: null,
    historyRowsEl: null,
  });
  return { view, sessionId };
}

describe("native 织研者对话：真实历史运行卡", () => {
  it("完整重绘保留三张绘图卡，startThinking 追加可停止的正在处理卡", () => {
    const { view, sessionId } = historicalView();
    view.renderAll = native.ResearchWeaverView.prototype.renderAll;
    view.renderMessages = native.ResearchWeaverView.prototype.renderMessages;
    view.renderStatus = native.ResearchWeaverView.prototype.renderStatus;
    view.renderAll();
    assert.equal(view.messagesEl.find((node) => node.className.includes("scholarium-weaver__plot-card")).length, 3);
    view.startThinking(sessionId, view.session);
    const thinking = view.messagesEl.find((node) => node.attrs["data-role"] === "thinking");
    assert.equal(thinking.length, 1);
    assert.equal(view.messagesEl.find((node) => node.attrs["data-role"] === "stop-turn").length, 1);
    assert.equal(view.composerHintEl.textContent, "织研者正在处理…");
    assert.equal(view.pendingTurns.has(sessionId), true);
    view.stopThinking(sessionId, view.session);
  });
});
