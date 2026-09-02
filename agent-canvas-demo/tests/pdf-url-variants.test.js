"use strict";
// pdfUrlVariants 纯函数单测：ScienceDirect /pdf → /pdfft 回退是唯一规则，
// 其余 URL 原样单元素返回。规则来自 2026-08-19 的真实 403 故障。
const test = require('node:test');
const assert = require('node:assert/strict');
const { pdfUrlVariants } = require('../bridge/pdf-url-variants');

test('ScienceDirect /pdf URL gains /pdfft fallbacks, original first', () => {
  const variants = pdfUrlVariants('https://www.sciencedirect.com/science/article/pii/S2215038222000322/pdf');
  assert.equal(variants[0], 'https://www.sciencedirect.com/science/article/pii/S2215038222000322/pdf');
  assert.equal(variants[1], 'https://www.sciencedirect.com/science/article/pii/S2215038222000322/pdfft?isDTMRedir=true&download=true');
  assert.equal(variants[2], 'https://www.sciencedirect.com/science/article/pii/S2215038222000322/pdfft');
});

test('ScienceDirect URL without /pdf suffix is left alone', () => {
  const url = 'https://www.sciencedirect.com/science/article/pii/S2215038222000322';
  assert.deepEqual(pdfUrlVariants(url), [url]);
});

test('non-ScienceDirect URLs are returned as-is', () => {
  const url = 'https://arxiv.org/pdf/1706.03762';
  assert.deepEqual(pdfUrlVariants(url), [url]);
});

test('linkinghub.elsevier.com does NOT match (its /retrieve/pii/ path shape differs — a /pdfft rewrite would be wrong there)', () => {
  const url = 'https://linkinghub.elsevier.com/retrieve/pii/S2215038222000322';
  assert.deepEqual(pdfUrlVariants(url), [url]);
});

test('empty and junk input degrade to a single pass-through entry', () => {
  assert.deepEqual(pdfUrlVariants(''), ['']);
  assert.deepEqual(pdfUrlVariants(null), ['']);
});
