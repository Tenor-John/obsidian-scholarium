"use strict";
// Unit tests for idea-mode-core.js — the pure module behind Idea mode.
// No DOM, no Bridge, no network: the same file the panel loads.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../idea-mode-core.js');

const RECORDS = [
  { title: 'Strong metal-support interaction in single-atom photocatalysts', doi: '10.1000/a', publication_year: 2024, is_oa: true },
  { title: 'CO2 reduction selectivity on Cu single atoms', doi: '10.1000/b', year: 2023 },
];

/* ---------------------------------------------------------- parseIdeaReply -- */

test('parseIdeaReply accepts a clean JSON reply', () => {
  const raw = JSON.stringify({
    summary: '该领域集中于 SMSI 对选择性的调控。',
    questions: [{ statement: 'SMSI 强度如何定量影响 CO2 还原选择性？', why: '现有工作结论相互矛盾。' }],
    hypotheses: [{ statement: '增强 SMSI 会提高 C2 产物法拉第效率。', rationale: '依据 [1][2]。' }],
  });
  const parsed = Core.parseIdeaReply(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.summary, '该领域集中于 SMSI 对选择性的调控。');
  assert.equal(parsed.questions.length, 1);
  assert.equal(parsed.questions[0].note, '现有工作结论相互矛盾。');
  assert.equal(parsed.hypotheses.length, 1);
  assert.equal(parsed.hypotheses[0].note, '依据 [1][2]。');
});

test('parseIdeaReply extracts JSON from a fenced code block with chatter around it', () => {
  const raw = '好的，以下是综合结果：\n```json\n{"summary":"s","questions":[{"statement":"q1"}],"hypotheses":[]}\n```\n以上。';
  const parsed = Core.parseIdeaReply(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.questions.length, 1);
});

test('parseIdeaReply rejects non-JSON and missing summary', () => {
  assert.equal(Core.parseIdeaReply('完全不是 JSON').ok, false);
  assert.equal(Core.parseIdeaReply('{"questions":[{"statement":"q"}]}').ok, false);
  assert.equal(Core.parseIdeaReply('').ok, false);
});

test('parseIdeaReply rejects when both lists end up empty', () => {
  const raw = JSON.stringify({ summary: 's', questions: [{ why: '没有 statement' }], hypotheses: 'not-array' });
  const parsed = Core.parseIdeaReply(raw);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /没有可用/);
  assert.ok(parsed.dropped.some((d) => /缺 statement/.test(d)));
});

test('parseIdeaReply enforces caps and truncates overlong statements', () => {
  const questions = Array.from({ length: 9 }, (_, i) => ({ statement: `问题${i + 1}` }));
  const long = '长'.repeat(200);
  questions[0].statement = long;
  const parsed = Core.parseIdeaReply(JSON.stringify({ summary: 's', questions, hypotheses: [] }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.questions.length, Core.MAX_QUESTIONS, 'questions capped at MAX_QUESTIONS');
  assert.ok(parsed.questions[0].statement.length <= 120, 'statement clipped to 120 chars');
  assert.ok(parsed.dropped.some((d) => /超出上限/.test(d)));
});

test('parseIdeaReply parses hotspots/gaps as capped short-string lists', () => {
  const raw = JSON.stringify({
    summary: 's',
    hotspots: ['SMSI', '单原子催化', ...Array.from({ length: 8 }, (_, i) => `热点${i}`)],
    gaps: ['缺少原位表征', ''],
    questions: [{ statement: 'q1' }],
    hypotheses: [],
  });
  const parsed = Core.parseIdeaReply(raw);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.hotspots.slice(0, 2), ['SMSI', '单原子催化']);
  assert.equal(parsed.hotspots.length, 6, 'hotspots capped at MAX_HOTSPOTS');
  assert.deepEqual(parsed.gaps, ['缺少原位表征'], 'empty gap string is dropped');
});

test('parseIdeaReply defaults hotspots/gaps to empty arrays when absent or malformed', () => {
  const raw = JSON.stringify({ summary: 's', questions: [{ statement: 'q1' }], hypotheses: [] });
  const parsed = Core.parseIdeaReply(raw);
  assert.deepEqual(parsed.hotspots, []);
  assert.deepEqual(parsed.gaps, []);

  const raw2 = JSON.stringify({ summary: 's', hotspots: 'not-an-array', gaps: null, questions: [{ statement: 'q1' }], hypotheses: [] });
  const parsed2 = Core.parseIdeaReply(raw2);
  assert.deepEqual(parsed2.hotspots, []);
  assert.deepEqual(parsed2.gaps, []);
});

/* ------------------------------------------------------------ allocateIds -- */

test('allocateIds starts at 001 on an empty set', () => {
  assert.deepEqual(Core.allocateIds([], 'QUE', 2), ['QUE-001', 'QUE-002']);
});

test('allocateIds continues after the max existing number and ignores other prefixes', () => {
  const ids = ['HYP-001', 'HYP-003', 'QUE-009', 'EXP-100', 'HYP-xyz', 'HYP-2'];
  assert.deepEqual(Core.allocateIds(ids, 'HYP', 2), ['HYP-004', 'HYP-005']);
  assert.deepEqual(Core.allocateIds(ids, 'QUE', 1), ['QUE-010']);
});

/* --------------------------------------------------------- sanitizeFileName -- */

test('sanitizeFileName strips Windows/Obsidian-illegal characters and clips', () => {
  // 先按 24 字截断（超长补省略号），再剔除非法字符
  assert.equal(Core.sanitizeFileName('a/b\\c:d*e?f"g<h>i|j#k^l[m]n'), 'abcdefghijkl…');
  assert.equal(Core.sanitizeFileName('ab/cd'), 'abcd');
  assert.equal(Core.sanitizeFileName('很'.repeat(40)).length, 24);
  assert.equal(Core.sanitizeFileName('///'), '未命名');
});

/* ----------------------------------------------------------- buildIdeaNotes -- */

test('buildIdeaNotes renders schema-v1 notes with ai/pending markers and safe paths', () => {
  const items = Core.buildIdeaNotes({
    topic: 'SMSI 对 CO2 还原选择性的影响',
    summary: '总结正文。',
    questions: [{ statement: '问题一？', note: '为什么' }],
    hypotheses: [{ statement: '假设一：含/非法:字符', note: '理由 [1]' }],
    existingIds: ['QUE-002', 'HYP-001'],
    records: RECORDS,
    at: '2026-08-17T00:00:00.000Z',
    uidFn: (() => { let n = 0; return () => `uid-${++n}`; })(),
  });
  assert.equal(items.length, 2);

  const [que, hyp] = items;
  assert.match(que.path, /^Research\/Questions\/QUE-003 .+\.md$/);
  assert.match(hyp.path, /^Research\/Hypotheses\/HYP-002 .+\.md$/);
  assert.ok(!/[\\/:*?"<>|#^[\]]/.test(hyp.path.split('/').pop().replace(/\.md$/, '')), 'file name carries no illegal chars');

  for (const item of items) {
    assert.match(item.content, /^---\n/, 'frontmatter opens the file');
    assert.match(item.content, /schema_version: 1/);
    assert.match(item.content, /created_by: "ai"/);
    assert.match(item.content, /review_status: "pending"/);
    assert.match(item.content, /source: "idea-mode"/);
    assert.match(item.content, /idea_topic: "SMSI 对 CO2 还原选择性的影响"/);
    assert.match(item.content, /created_at: "2026-08-17T00:00:00\.000Z"/);
    assert.match(item.content, /## 检索线索/);
    assert.match(item.content, /doi:10\.1000\/a/);
  }
  assert.match(que.content, /type: "question"/);
  assert.match(que.content, /status: "open"/);
  assert.match(hyp.content, /type: "hypothesis"/);
  assert.match(hyp.content, /status: "proposed"/);
  assert.match(que.content, /## 为什么值得追\n\n为什么/);
  assert.match(hyp.content, /## 提出理由\n\n理由 \[1\]/);
});

test('buildIdeaNotes skips the source section when there are no records', () => {
  const items = Core.buildIdeaNotes({
    topic: 't', summary: 's', questions: [{ statement: 'q' }], hypotheses: [], existingIds: [], records: [],
  });
  assert.equal(items.length, 1);
  assert.ok(!items[0].content.includes('## 检索线索'));
});

/* ----------------------------------------------------------- buildIdeaCard -- */

test('buildIdeaCard renders a schema-v1 idea note, always exploring, never fabricating key_papers', () => {
  const card = Core.buildIdeaCard({
    topic: 'SMSI 对 CO2 还原选择性的影响',
    summary: '总结正文。',
    hotspots: ['SMSI', '单原子'],
    gaps: ['缺少原位表征'],
    records: RECORDS,
    existingIds: ['IDEA-002', 'HYP-009'],
  });
  assert.match(card.path, /^Research\/Ideas\/IDEA-003 .+\.md$/);
  assert.equal(card.displayId, 'IDEA-003');
  assert.match(card.content, /^---\n/);
  assert.match(card.content, /type: "idea"/);
  assert.match(card.content, /status: "exploring"/);
  assert.match(card.content, /title: "SMSI 对 CO2 还原选择性的影响"/);
  assert.match(card.content, /created_by: "ai"/);
  assert.match(card.content, /source: "idea-mode"/);
  assert.match(card.content, /promoted_to: ""/);
  assert.match(card.content, /summary: "总结正文。"/);
  assert.match(card.content, /hotspots:\n {2}- "SMSI"\n {2}- "单原子"/);
  assert.match(card.content, /gaps:\n {2}- "缺少原位表征"/);
  // Only the two records that actually carry a doi become key_papers; the
  // agent never gets a chance to invent one.
  assert.match(card.content, /key_papers:\n {2}- "10\.1000\/a"\n {2}- "10\.1000\/b"/);
  assert.match(card.content, /## 研究热点/);
  assert.match(card.content, /## 明显空白点/);
});

test('buildIdeaCard omits key_papers entries and renders empty arrays when no record has a doi', () => {
  const card = Core.buildIdeaCard({ topic: 't', summary: 's', records: [{ title: 'no doi here' }] });
  assert.equal(card.displayId, 'IDEA-001');
  assert.match(card.content, /key_papers: \[\]/);
  assert.match(card.content, /hotspots: \[\]/);
  assert.match(card.content, /gaps: \[\]/);
});

/* ---------------------------------------------------------- buildIdeaPrompt -- */

test('buildIdeaPrompt embeds every record and the no-fabrication rules', () => {
  const prompt = Core.buildIdeaPrompt({ topic: 'SMSI', records: RECORDS });
  assert.match(prompt, /主题：SMSI/);
  assert.match(prompt, /\[1\] Strong metal-support interaction/);
  assert.match(prompt, /doi:10\.1000\/a/);
  assert.match(prompt, /\[2\] CO2 reduction selectivity/);
  assert.match(prompt, /不得虚构文献/);
  assert.match(prompt, /只输出 JSON/);
  assert.ok(!prompt.includes('[C1]'), '无文献库命中时不出现 Cn 编号');
});

test('buildIdeaPrompt adds a corpus block with [Cn] refs when the library hits', () => {
  const corpus = [{ source: 'Experiments/Literature/x.pdf', heading: 'Introduction', snippet: 'HEPES 既作还原剂又作包覆剂。' }];
  const prompt = Core.buildIdeaPrompt({ topic: 't', records: RECORDS, corpus });
  assert.match(prompt, /文献库中命中的相关片段/);
  assert.match(prompt, /\[C1\] HEPES 既作还原剂又作包覆剂。（来源：Experiments\/Literature\/x\.pdf#Introduction）/);
  assert.match(prompt, /用 \[Cn\] 引用文献库片段/);
});
