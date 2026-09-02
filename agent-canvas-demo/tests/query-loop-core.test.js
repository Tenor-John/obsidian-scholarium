"use strict";
// Unit tests for query-loop-core.js — deterministic cycle control for the
// builder/critic search-query loop. No DOM, no Bridge, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../query-loop-core.js');

/* ------------------------------------------------------------- builder -- */

test('buildBuilderPrompt embeds topic and, on revision, the critique', () => {
  const first = Core.buildBuilderPrompt({ topic: 'SMSI 与 CO2 还原', cycle: 1 });
  assert.match(first, /研究主题：SMSI 与 CO2 还原/);
  assert.match(first, /第 1 轮/);
  assert.match(first, /只保留 2 个真正必需的概念块/);
  assert.match(first, /不得加入 DOI、已知论文标题或 NOT/);
  assert.ok(!first.includes('上一轮质疑者'));

  const revised = Core.buildBuilderPrompt({
    topic: 't', cycle: 3,
    feedback: { problems: ['漏了单原子同义词', '范围过宽'], suggestion: '加 OR "single-atom"', query: 'old query' },
  });
  assert.match(revised, /第 3 轮/);
  assert.match(revised, /漏了单原子同义词/);
  assert.match(revised, /加 OR "single-atom"/);
  assert.match(revised, /上一轮检索式：old query/);
});

test('parseBuilderReply accepts fenced JSON and rejects missing query', () => {
  const ok = Core.parseBuilderReply('说明几句\n```json\n{"query":"a OR b","rationale":"理由"}\n```');
  assert.equal(ok.ok, true);
  assert.equal(ok.query, 'a OR b');
  assert.equal(ok.rationale, '理由');

  assert.equal(Core.parseBuilderReply('not json').ok, false);
  assert.equal(Core.parseBuilderReply('{"rationale":"x"}').ok, false);
  assert.equal(Core.parseBuilderReply('{"query":"ab"}').ok, false, 'query < 3 chars rejected');
});

/* -------------------------------------------------------------- critic -- */

test('buildCriticPrompt embeds query, sampled records and the transparent rubric', () => {
  const records = Array.from({ length: 20 }, (_, i) => ({ title: `Paper ${i + 1}`, publication_year: 2024, source: 'pubmed' }));
  const prompt = Core.buildCriticPrompt({ topic: 't', query: 'q', records });
  assert.match(prompt, /待评估检索式：q/);
  assert.match(prompt, /共 20 条/);
  assert.match(prompt, /\[15\] Paper 15/);
  assert.ok(!prompt.includes('Paper 16'), 'sample capped at 15');
  assert.match(prompt, /样本相关性 0-40/);
  assert.match(prompt, /发现阶段召回 0-25/);
  assert.match(prompt, /跨库可执行性 0-15/);
  assert.match(prompt, /简洁与渐进性 0-20/);
  assert.match(prompt, /达到 75 即通过/);
});

test('parseCriticReply sums bounded components plus deterministic simplicity', () => {
  const pass = Core.parseCriticReply('{"score_breakdown":{"relevance":40,"recall":25,"executability":15},"problems":[],"suggestion":"s"}', { query: '(gold OR Au) AND photocatalysis', cycle: 1 });
  assert.equal(pass.ok, true);
  assert.equal(pass.score, 100);
  assert.equal(pass.verdict, 'pass');
  assert.deepEqual(pass.breakdown, { relevance: 40, recall: 25, executability: 15, simplicity: 20 });

  const clamped = Core.parseCriticReply('{"score_breakdown":{"relevance":140,"recall":99,"executability":99},"problems":[]}', { query: 'a AND b' });
  assert.equal(clamped.score, 100);

  assert.equal(Core.parseCriticReply('{"score":90}').ok, false, 'opaque total without breakdown rejected');
  assert.equal(Core.parseCriticReply('garbage').ok, false);
});

test('simplicity score penalizes query bloat, early NOT and DOI stuffing', () => {
  const simple = Core.scoreQuerySimplicity('(Au OR gold) AND (photocatalysis OR plasmonic)', 1);
  const bloated = Core.scoreQuerySimplicity('(Au OR gold) AND CeO2 AND photocatalysis AND hydrogen NOT dye OR 10.1039/D0TA00811G', 1);
  assert.equal(simple.score, 20);
  assert.ok(bloated.score < simple.score);
  assert.ok(bloated.penalties.some((item) => /必需概念块/.test(item.reason)));
  assert.ok(bloated.penalties.some((item) => /过早使用 NOT/.test(item.reason)));
  assert.ok(bloated.penalties.some((item) => /DOI/.test(item.reason)));
});

test('parseBuilderReply and parseCriticReply tolerate prose around the JSON block', () => {
  const withPreamble = Core.parseBuilderReply('好的，这是我构建的检索式：\n{"query":"a AND b","rationale":"r"}\n希望有帮助。');
  assert.equal(withPreamble.ok, true);
  assert.equal(withPreamble.query, 'a AND b');

  // A stray "{" in prose before the real JSON must not break extraction —
  // the old first-"{"-to-last-"}" slice would have grabbed from here and
  // produced an unparseable blob.
  const strayBrace = Core.parseCriticReply('分数依据（见 {论文数量} 等因素）：\n{"score_breakdown":{"relevance":20,"recall":15,"executability":12},"problems":["p1"]}', { query: 'a AND b' });
  assert.equal(strayBrace.ok, true);
  assert.equal(strayBrace.score, 67);

  // Braces embedded inside a quoted string value must not miscount depth.
  const braceInString = Core.parseCriticReply('{"score_breakdown":{"relevance":35,"recall":20,"executability":14},"problems":["格式看起来像 {this}，需要修"],"suggestion":"s"}', { query: 'a AND b' });
  assert.equal(braceInString.ok, true);
  assert.equal(braceInString.score, 89);
  assert.deepEqual(braceInString.problems, ['格式看起来像 {this}，需要修']);
});

/* --------------------------------------------------------- cycle control -- */

test('decideNext: accept at threshold, revise below, exhausted at max cycles', () => {
  assert.equal(Core.decideNext({ cycle: 1, score: 75 }), 'accept');
  assert.equal(Core.decideNext({ cycle: 1, score: 74 }), 'revise');
  assert.equal(Core.decideNext({ cycle: 3, score: 74 }), 'exhausted');
  assert.equal(Core.decideNext({ cycle: 2, score: 10 }), 'revise');
  assert.equal(Core.decideNext({ cycle: 3, score: 95 }), 'accept');
  assert.equal(Core.MAX_CYCLES, 3);
  assert.equal(Core.SCORE_THRESHOLD, 75);
});
