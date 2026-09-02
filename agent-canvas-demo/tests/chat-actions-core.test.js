"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseActionRequests, parseDraftRequests, parseSuggestReconstructionRequests } = require("../chat-actions-core.js");

test("parses a well-formed action block and strips it from the text", () => {
  const reply = '收到，明天上午安排 HPLC。\n```scholarium-action\n{"action":"workspace.timeblock_add","input":{"date":"2026-08-21","start":"09:00","end":"11:00","title":"HPLC"},"reason":"研究员要求"}\n```\n已提交修改请求，等你确认后生效。';
  const { text, actions } = parseActionRequests(reply);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, "workspace.timeblock_add");
  assert.equal(actions[0].input.date, "2026-08-21");
  assert.equal(actions[0].reason, "研究员要求");
  assert.ok(!text.includes("scholarium-action"), "block must be stripped from the visible text");
  assert.ok(text.includes("等你确认后生效"), "surrounding prose survives");
});

test("parses multiple blocks in one reply", () => {
  const reply = '```scholarium-action\n{"action":"workspace.task_add","input":{"title":"配标样"}}\n```\n中间的话\n```scholarium-action\n{"action":"workspace.emotion_log","input":{"mood":"平静"}}\n```';
  const { actions } = parseActionRequests(reply);
  assert.equal(actions.length, 2);
  assert.deepEqual(actions.map((a) => a.action), ["workspace.task_add", "workspace.emotion_log"]);
});

test("malformed JSON stays visible and produces no action", () => {
  const reply = '```scholarium-action\n{"action":"workspace.task_add", input 缺引号\n```';
  const { text, actions } = parseActionRequests(reply);
  assert.equal(actions.length, 0);
  assert.ok(text.includes("scholarium-action"), "malformed block must NOT be silently swallowed");
});

test("parseSuggestReconstructionRequests only carries seed_doi/reason — no executable payload", () => {
  const reply = '这篇种子文献值得做一轮引用链重建。\n```scholarium-suggest-reconstruction\n{"seed_doi":"10.1039/D0TA00811G","reason":"课题画像的种子文献从未被 P1 覆盖"}\n```\n打开面板后可以逐项审阅。';
  const { text, suggestions } = parseSuggestReconstructionRequests(reply);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].seed_doi, "10.1039/D0TA00811G");
  assert.ok(!text.includes("scholarium-suggest-reconstruction"));
  assert.ok(text.includes("打开面板后可以逐项审阅"));
});

test("parseSuggestReconstructionRequests requires a non-empty seed_doi, otherwise leaves the block visible", () => {
  const reply = '```scholarium-suggest-reconstruction\n{"reason":"忘了写 DOI"}\n```';
  const { text, suggestions } = parseSuggestReconstructionRequests(reply);
  assert.equal(suggestions.length, 0);
  assert.ok(text.includes("scholarium-suggest-reconstruction"));
});

test("a block without a dotted action name is rejected", () => {
  const reply = '```scholarium-action\n{"action":"delete_everything","input":{}}\n```';
  const { actions } = parseActionRequests(reply);
  assert.equal(actions.length, 0);
});

test("common input aliases are accepted without losing the action payload", () => {
  for (const key of ["params", "arguments", "payload"]) {
    const reply = `\`\`\`scholarium-action\n{"action":"workspace.timeblock_update","${key}":{"id":"tb-001","execution_status":"completed"}}\n\`\`\``;
    const { text, actions } = parseActionRequests(reply);
    assert.equal(actions.length, 1, `${key} must be accepted`);
    assert.deepEqual(actions[0].input, { id: "tb-001", execution_status: "completed" });
    assert.equal(text, "");
  }
});

test("missing, empty, or non-object input stays visible instead of making an empty action card", () => {
  for (const body of [
    '{"action":"workspace.timeblock_update"}',
    '{"action":"workspace.timeblock_update","input":{}}',
    '{"action":"workspace.timeblock_update","input":"bogus"}',
  ]) {
    const reply = `\`\`\`scholarium-action\n${body}\n\`\`\``;
    const { text, actions } = parseActionRequests(reply);
    assert.equal(actions.length, 0);
    assert.ok(text.includes("scholarium-action"), "invalid payload must remain visible");
  }
});

test("a reply with no blocks passes through unchanged", () => {
  const reply = "普通回复，没有动作块。";
  const { text, actions } = parseActionRequests(reply);
  assert.equal(text, reply);
  assert.equal(actions.length, 0);
});

/* --- scholarium-draft（/v1/drafts/batch 预防式落盘，设计文档 §7）--- */

test("scholarium-draft: 单文件块被解析并剥离正文", () => {
  const reply = '已整理好实验记录。\n```scholarium-draft\n{"path":"records/scholarium/EXP-006.md","content":"---\\nuid: \\"abc\\"\\n---\\n双 85 老化","reason":"研究员要求保存"}\n```\n等你确认后写入。';
  const { text, drafts } = parseDraftRequests(reply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items.length, 1);
  assert.equal(drafts[0].items[0].path, "records/scholarium/EXP-006.md");
  assert.ok(drafts[0].items[0].content.includes("uid"));
  assert.ok(!text.includes("scholarium-draft"));
  assert.ok(text.includes("等你确认后写入"));
});

test("scholarium-draft: items 批量形态（EXP+HYP 关联对）", () => {
  const reply = '```scholarium-draft\n{"items":[{"path":"a/EXP-006.md","content":"x"},{"path":"a/HYP-004.md","content":"y"}]}\n```';
  const { drafts } = parseDraftRequests(reply);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].items.length, 2);
});

test("scholarium-draft: 越界/绝对/非 .md 路径被拒绝且原块保留", () => {
  for (const bad of ["../escape.md", "/abs/path.md", "C:\\\\win.md", "records/x.txt", ""]) {
    const reply = `\`\`\`scholarium-draft\n{"path":${JSON.stringify(bad)},"content":"x"}\n\`\`\``;
    const { text, drafts } = parseDraftRequests(reply);
    assert.equal(drafts.length, 0, `path ${bad} must be rejected`);
    assert.ok(text.includes("scholarium-draft"), "rejected block stays visible");
  }
});

test("scholarium-draft: 空内容或坏 JSON 不产生草稿", () => {
  assert.equal(parseDraftRequests('```scholarium-draft\n{"path":"a/x.md","content":"  "}\n```').drafts.length, 0);
  assert.equal(parseDraftRequests('```scholarium-draft\n不是 JSON\n```').drafts.length, 0);
});
