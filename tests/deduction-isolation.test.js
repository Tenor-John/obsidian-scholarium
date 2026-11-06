"use strict";

const { source, block, sandbox, describe, it, assert } = require("./harness");

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
    const dialogue = block("renderDialogue(t, e, s) {");
    assert.match(dialogue, /deduction-new-topic/);
    assert.match(dialogue, /await this\.persistHistory\(e\)/);
    assert.match(dialogue, /this\.formalTopicId = this\.newDialogueTopic\("formal"\)/);
    assert.match(dialogue, /this\.unboundFormal = true/);
    assert.match(dialogue, /this\.chatTopicId = this\.newDialogueTopic\("chat"\)/);
    assert.noMatch(dialogue, /新话题仅用于普通对话/);
    assert.match(dialogue, /this\.historyProjectId = null/);
    assert.match(dialogue, /this\.compactedSummaryCache = null/);
  });

  it("keeps ordinary chat out of the formal protocol and persists it separately", () => {
    const chat = block("runChatOnly(t, e, s, i) {");
    assert.noMatch(chat, /getCompactedHistory/);
    assert.noMatch(chat, /evidence_requests/);
    assert.match(chat, /chat: true/);
    assert.match(chat, /await this\.persistHistory\(t\)/);
  });

  it("treats an inline formal-mode request as a real thread transition", () => {
    const dialogue = block("renderDialogue(t, e, s) {");
    const activation = block("activateFormalThread(t) {");
    assert.match(dialogue, /__go && this\.formalMode !== true/);
    assert.match(dialogue, /await this\.activateFormalThread\(e\)/);
    assert.match(activation, /await this\.persistHistory\(t\)/);
    assert.match(activation, /this\.formalMode = true/);
    assert.match(activation, /await this\.restoreFormalTopic\(t\)/);
    assert.match(activation, /await this\.loadPersistedHistory\(t\)/);
  });

  it("makes unbound formal history a persistent, rotatable topic instead of one shared bucket", () => {
    const src = source();
    const room = src.indexOf('cls: "deduction-room"');
    const renderStart = src.lastIndexOf("async render(", room);
    const renderEnd = src.indexOf("async context(", room);
    assert.ok(room >= 0 && renderStart >= 0 && renderEnd > renderStart, "deduction render method not found");
    const render = src.slice(renderStart, renderEnd);
    const helpers = [
      block("newDialogueTopic(t) {"),
      block("ensureFormalTopic() {"),
      block("restoreActiveFormalTopic(t) {"),
      block("restoreFormalTopic(t) {"),
      block("currentDesignKey() {"),
    ].join("\n");
    const persistence = block("persistHistory(t) {");
    assert.match(helpers, /activeFormalTopicId/);
    assert.match(helpers, /this\.formalTopicId = this\.newDialogueTopic\("formal"\)/);
    assert.match(helpers, /this\.ensureFormalTopic\(\)/);
    assert.noMatch(helpers, /formal-unassigned/);
    assert.match(persistence, /\w+\.activeFormalTopicId = \w+/);
    assert.match(src, /!this\.selectedId && !this\.unboundFormal && \w+\[0\]/);
    assert.match(render, /await this\.restoreActiveFormalTopic\(\w+\);[\s\S]*?await this\.designs\(\w+\)/);
    assert.match(helpers, /this\.unboundFormal = true/);
  });

  it("labels a formal answer and constrains compression to the active formal thread", () => {
    const src = source();
    assert.match(src, /本轮已启用完整协议/);
    const compact = block("summarizeViaCli(t, e, s) {");
    assert.match(compact, /同一织研者设计线程/);
    assert.match(compact, /不得引入/);
  });

  it("derives fallback evidence queries from the current question, not a project goal", () => {
    const fallback = block("deriveEvidenceQueryFallback(t, e, s) {");
    assert.match(fallback, /input: t/);
    assert.match(fallback, /research question[^]*\$\{t\}/);
    const formal = block("runTheoryCli(t, e, s, i) {");
    assert.match(formal, /deriveEvidenceQueryFallback\(s, \w+, e\)/);
    assert.match(formal, /本轮问题提取/);
    assert.noMatch(formal, /课题目标提取/);
  });
});
