"use strict";
// Unit tests for bridge/rag-core.js — chunking and BM25 retrieval.
const test = require('node:test');
const assert = require('node:assert/strict');
const { tokenize, chunkMarkdown, bm25Rank } = require('../bridge/rag-core.js');

test('tokenize covers latin words and CJK bigrams', () => {
  const t = tokenize('CO2 Reduction 光催化还原');
  assert.ok(t.includes('co2'));
  assert.ok(t.includes('reduction'));
  assert.ok(t.includes('光催') && t.includes('催化') && t.includes('化还') && t.includes('还原'));
});

test('chunkMarkdown splits on headings and keeps heading context', () => {
  const md = '# 标题\n\n引言段落：这一节的正文内容写得足够长，确保一定能够超过三十个字符的最小长度过滤门槛。\n\n## 方法\n\n实验部分：这一节的正文内容同样写得足够长，确保一定能够超过三十个字符的最小长度过滤门槛。\n';
  const chunks = chunkMarkdown(md);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, '标题');
  assert.equal(chunks[1].heading, '方法');
});

test('chunkMarkdown slices overlong sections with overlap and drops tiny scraps', () => {
  const long = '字'.repeat(3000);
  const chunks = chunkMarkdown(`## 长节\n${long}\n\n## 碎\n短`, { maxChars: 1000, overlap: 100 });
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.text.length <= 1000);
  assert.ok(chunks.every((c) => c.heading === '长节'), '短碎片被过滤，长块都带标题');
  // 重叠：相邻块共享后缀/前缀
  assert.ok(chunks[0].text.slice(-50) === chunks[1].text.slice(0, 50));
});

test('bm25Rank ranks the relevant chunk first and returns empty on no match', () => {
  const chunks = [
    { heading: '方法', text: 'HEPES buffer gold nanostars one-pot synthesis seed-mediated growth' },
    { heading: '食谱', text: '红烧肉的做法：先焯水，再炒糖色，最后慢炖四十分钟出锅装盘' },
    { heading: '背景', text: 'photocatalysis co2 reduction selectivity single atom catalyst' },
  ];
  const ranked = bm25Rank(chunks, 'gold nanostars HEPES', 2);
  assert.equal(ranked.length, 1, '只有含查询词的块得分>0');
  assert.equal(ranked[0].index, 0);
  assert.equal(bm25Rank(chunks, '完全无关的词汇zzz', 5).length, 0);
  assert.equal(bm25Rank([], 'anything', 5).length, 0);
});

test('bm25Rank handles CJK queries via bigrams', () => {
  const chunks = [
    { heading: '', text: '单原子催化剂中金属载体强相互作用调控二氧化碳还原选择性' },
    { heading: '', text: ' completely unrelated english text about cooking recipes ' },
  ];
  const ranked = bm25Rank(chunks, '二氧化碳还原', 5);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].index, 0);
});
