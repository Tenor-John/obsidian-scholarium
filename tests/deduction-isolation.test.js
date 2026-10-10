"use strict";

const { source, sandbox, describe, it, assert } = require("./harness");

const S = sandbox({
  methods: {
    currentDesignKey: [],
    ensureFormalTopic: [],
    newDialogueTopic: ["t"],
  },
});

describe("织研者线程与模式隔离", () => {
  it("uses distinct keys for ordinary chat, each unbound formal topic, and a selected design", () => {
    S.formalMode = false;
    S.chatTopicId = null;
    S.selectedId = "EXP-D-007";
    assert.eq(S.currentDesignKey(), "chat-default");

    S.chatTopicId = "chat-topic-a";
    assert.eq(S.currentDesignKey(), "chat-topic-a");

    S.formalMode = true;
    S.selectedId = null;
    S.formalTopicId = "formal-topic-a";
    assert.eq(S.currentDesignKey(), "formal-topic-a");
    S.formalTopicId = "formal-topic-b";
    assert.eq(S.currentDesignKey(), "formal-topic-b");
    S.selectedId = "EXP-D-007";
    assert.eq(S.currentDesignKey(), "EXP-D-007");
  });

  it("persists before switching modes or topics, then resets the in-memory thread", () => {
    const src = source();
    const dialogue = src.slice(
      src.indexOf("async renderDialogue(t, e, s) {"),
      src.indexOf("  renderDraft(t) {"),
    );
    assert.match(dialogue, /deduction-new-topic/);
    assert.match(dialogue, /await this\.persistHistory\(e\)/);
    assert.match(dialogue, /this\.formalTopicId = this\.newDialogueTopic\("formal"\)/);
    assert.match(dialogue, /this\.unboundFormal = !0/);
    assert.match(dialogue, /this\.chatTopicId = this\.newDialogueTopic\("chat"\)/);
    assert.noMatch(dialogue, /新话题仅用于普通对话/);
    assert.match(dialogue, /this\.historyProjectId = null/);
    assert.match(dialogue, /this\.compactedSummaryCache = null/);
  });

  it("keeps ordinary chat out of the formal protocol and persists it separately", () => {
    const src = source();
    const chat = src.slice(
      src.indexOf("async runChatOnly(t, e, s, i) {"),
      src.indexOf("  async runTheory(t, e, s, i, fm) {"),
    );
    assert.noMatch(chat, /getCompactedHistory/);
    assert.noMatch(chat, /evidence_requests/);
    assert.match(chat, /chat: !0/);
    assert.match(chat, /await this\.persistHistory\(t\)/);
  });

  it("treats an inline formal-mode request as a real thread transition", () => {
    const src = source();
    const dialogue = src.slice(
      src.indexOf("async renderDialogue(t, e, s) {"),
      src.indexOf("  renderDraft(t) {"),
    );
    const activation = src.slice(
      src.indexOf("async activateFormalThread(t) {"),
      src.indexOf("  async runTheory(t, e, s, i, fm) {"),
    );
    assert.match(dialogue, /__go && this\.formalMode !== !0/);
    assert.match(dialogue, /await this\.activateFormalThread\(e\)/);
    assert.match(activation, /await this\.persistHistory\(t\)/);
    assert.match(activation, /this\.formalMode = !0/);
    assert.match(activation, /await this\.restoreFormalTopic\(t\)/);
    assert.match(activation, /await this\.loadPersistedHistory\(t\)/);
  });

  it("makes unbound formal history a persistent, rotatable topic instead of one shared bucket", () => {
    const src = source();
    const render = src.slice(
      src.indexOf("async render(t) {"),
      src.indexOf("  async context() {"),
    );
    const helpers = src.slice(
      src.indexOf("newDialogueTopic(t) {"),
      src.indexOf("  softRefresh() {"),
    );
    const persistence = src.slice(
      src.indexOf("async persistHistory(t) {"),
      src.indexOf("  parseReply(t) {"),
    );
    assert.match(helpers, /activeFormalTopicId/);
    assert.match(helpers, /this\.formalTopicId = this\.newDialogueTopic\("formal"\)/);
    assert.match(helpers, /this\.ensureFormalTopic\(\)/);
    assert.noMatch(helpers, /formal-unassigned/);
    assert.match(persistence, /p\.activeFormalTopicId = i/);
    assert.match(src, /!this\.selectedId && !this\.unboundFormal && s\[0\]/);
    assert.match(render, /await this\.restoreActiveFormalTopic\(e\);[\s\S]*?await this\.designs\(e\)/);
    assert.match(helpers, /this\.unboundFormal = !0/);
  });

  it("labels a formal answer and constrains compression to the active formal thread", () => {
    const src = source();
    assert.match(src, /\\u672C\\u8F6E\\u5DF2\\u542F\\u7528\\u5B8C\\u6574\\u534F\\u8BAE/);
    const compact = src.slice(
      src.indexOf("async summarizeViaCli(t, e, s) {"),
      src.indexOf("  currentDesignKey() {"),
    );
    assert.match(compact, /\\u540C\\u4E00\\u7EC7\\u7814\\u8005\\u8BBE\\u8BA1\\u7EBF\\u7A0B/);
    assert.match(compact, /\\u4E0D\\u5F97\\u5F15\\u5165/);
  });

  it("derives fallback evidence queries from the current question, not a project goal", () => {
    const src = source();
    const fallback = src.slice(
      src.indexOf("async deriveEvidenceQueryFallback(t, e, s) {"),
      src.indexOf("  async getCompactedHistory(t) {"),
    );
    assert.match(fallback, /input: t/);
    assert.match(fallback, /research question[^]*\$\{t\}/);
    const formal = src.slice(
      src.indexOf("async runTheoryCli(t, e, s, i) {"),
      src.indexOf("  async continueCliTurn(t, e, s, i) {"),
    );
    assert.match(formal, /deriveEvidenceQueryFallback\(s, a, e\)/);
    assert.match(formal, /\\u672C\\u8F6E\\u95EE\\u9898\\u63D0\\u53D6/);
    assert.noMatch(formal, /\\u8BFE\\u9898\\u76EE\\u6807\\u63D0\\u53D6/);
  });
});
