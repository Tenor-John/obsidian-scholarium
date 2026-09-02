"use strict";
// Unit tests for p7-rehearsal.js — the pure module behind the P7 read-only
// settlement rehearsal. Runs the same file the panel loads; no DOM, no Bridge.
const test = require('node:test');
const assert = require('node:assert/strict');
const P7 = require('../p7-rehearsal.js');

const KNOWN = { hypotheses: ['HYP-001', 'HYP-002'], experiments: ['EXP-001', 'EXP-005'] };
const HYPOTHESES = [
  { display_id: 'HYP-001', statement: '双波长条件存在非线性动力学协同。', status: 'proposed', settlement: { supports: 0, contradicts: 0, qualifies: 0 } },
  { display_id: 'HYP-002', statement: '界面电荷转移是主导因素。', status: 'proposed', settlement: { supports: 1, contradicts: 0, qualifies: 0 } },
];
const EXPERIMENTS = [
  { display_id: 'EXP-001', title: '双波长活性对比', conclusion: '协同因子 2.38 vs 1.47。', tests: ['HYP-001', 'HYP-002'], data_origin: 'measured' },
  { display_id: 'EXP-005', title: '时序对照', conclusion: '同步为交替的约 2 倍。', tests: ['HYP-001'], data_origin: 'simulated' },
];

test('extractFrontmatterField reads JSON-quoted multiline values losslessly', () => {
  const note = '---\ntitle: "测试"\nconclusion: "第一行。\\n\\n第二行，含\\"引号\\"。"\nstatus: concluded\n---\n正文';
  assert.equal(P7.extractFrontmatterField(note, 'conclusion'), '第一行。\n\n第二行，含"引号"。');
  assert.equal(P7.extractFrontmatterField(note, 'status'), 'concluded');
  assert.equal(P7.extractFrontmatterField(note, 'missing'), '');
  assert.equal(P7.extractFrontmatterField('没有 frontmatter', 'conclusion'), '');
});

test('buildRehearsalPrompt embeds every hypothesis, experiment, the simulated warning and the ID whitelist', () => {
  const prompt = P7.buildRehearsalPrompt({ project: { display_id: 'PRJ-001', title: '课题' }, hypotheses: HYPOTHESES, experiments: EXPERIMENTS });
  assert.match(prompt, /HYP-001/); assert.match(prompt, /HYP-002/);
  assert.match(prompt, /双波长条件存在非线性动力学协同/);
  assert.match(prompt, /EXP-001/); assert.match(prompt, /协同因子 2\.38/);
  assert.match(prompt, /data_origin: simulated/, 'simulated experiments must carry the evidence-tier warning');
  assert.match(prompt, /只允许引用这些编号/);
  assert.match(prompt, /inconclusive 是合法答案/);
  assert.match(prompt, /```json/);
});

test('parseRehearsalReply parses a fenced reply and keeps valid settlements', () => {
  const reply = '先说五句总结。\n```json\n{"settlements":[{"hypothesis":"HYP-001","verdict":"supports","based_on":["EXP-001"],"reason":"协同因子 2.38 显著大于 1。"}],"spillover":[],"notes":"建议补 TRPL。"}\n```';
  const parsed = P7.parseRehearsalReply(reply, KNOWN);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.settlements.length, 1);
  assert.equal(parsed.settlements[0].hypothesis, 'HYP-001');
  assert.equal(parsed.notes, '建议补 TRPL。');
  assert.equal(parsed.dropped.length, 0);
});

test('parseRehearsalReply drops hallucinated ids, illegal verdicts and basis-free claims — with reasons', () => {
  const reply = '{"settlements":[' +
    '{"hypothesis":"HYP-099","verdict":"supports","based_on":["EXP-001"],"reason":"编造的假设编号"},' +
    '{"hypothesis":"HYP-001","verdict":"proves","based_on":["EXP-001"],"reason":"非法 verdict"},' +
    '{"hypothesis":"HYP-001","verdict":"supports","based_on":["EXP-999"],"reason":"编造实验"},' +
    '{"hypothesis":"HYP-001","verdict":"supports","based_on":[],"reason":"无依据"},' +
    '{"hypothesis":"HYP-002","verdict":"qualifies","based_on":["EXP-005"],"reason":"固定光通量下成立"}' +
    ']}';
  const parsed = P7.parseRehearsalReply(reply, KNOWN);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.settlements.length, 1, 'only the fully valid settlement survives');
  assert.equal(parsed.settlements[0].hypothesis, 'HYP-002');
  assert.equal(parsed.dropped.length, 4);
  assert.match(parsed.dropped.map((d) => d.why).join('\n'), /HYP-099/);
  assert.match(parsed.dropped.map((d) => d.why).join('\n'), /EXP-999/);
});

test('parseRehearsalReply tolerates preface text and braces inside strings', () => {
  const reply = '好的{"不是目标": "带 } 的花括号"}。最终：\n{"settlements":[{"hypothesis":"HYP-001","verdict":"inconclusive","based_on":["EXP-005"],"reason":"统计功效不足"}]}';
  const parsed = P7.parseRehearsalReply(reply, KNOWN);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.settlements[0].verdict, 'inconclusive');
});

test('parseRehearsalReply reports a clean error when no settlements JSON exists', () => {
  const parsed = P7.parseRehearsalReply('完全没有 JSON 的回复', KNOWN);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /settlements/);
});

test('renderRehearsalMarkdown marks the draft as non-authoritative and records dropped items', () => {
  const parsed = P7.parseRehearsalReply('{"settlements":[{"hypothesis":"HYP-001","verdict":"supports","based_on":["EXP-001"],"reason":"含 | 竖线的理由"}],"spillover":[{"experiment":"EXP-001","hypothesis":"HYP-002","note":"暗示界面转移"}],"notes":"提醒"}', KNOWN);
  parsed.dropped.push({ item: {}, why: '假设编号不在本次白名单内：HYP-099' });
  const md = P7.renderRehearsalMarkdown(parsed, { project: 'PRJ-001', agent: 'codex', at: '2026-08-17T05:00:00.000Z' });
  assert.match(md, /status: draft-awaiting-user-review/);
  assert.match(md, /不改变假设账本/);
  assert.match(md, /\| HYP-001 \| 支持 \| EXP-001 \| 含 \\\| 竖线的理由 \|/, 'table pipes in reasons must be escaped');
  assert.match(md, /EXP-001 → HYP-002：暗示界面转移/);
  assert.match(md, /被校验丢弃/);
  assert.match(md, /HYP-099/);
});
