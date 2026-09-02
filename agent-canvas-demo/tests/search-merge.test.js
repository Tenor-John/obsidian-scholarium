"use strict";
// Unit tests for bridge/search-merge.js — multi-source merge and dedupe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeDoi, mergeSearchRecords } = require('../bridge/search-merge.js');

test('normalizeDoi strips scheme, host, prefix and case', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/ABC'), '10.1000/abc');
  assert.equal(normalizeDoi('doi: 10.1000/ABC'), '10.1000/abc');
  assert.equal(normalizeDoi('10.1000/abc'), '10.1000/abc');
  assert.equal(normalizeDoi(''), '');
  assert.equal(normalizeDoi(null), '');
});

test('mergeSearchRecords dedupes by DOI across sources and accumulates source tags', () => {
  const merged = mergeSearchRecords([
    { source: 'openalex', records: [{ title: 'A Paper', doi: '10.1000/x', openalex_id: 'W1' }] },
    { source: 'pubmed', records: [{ title: 'A Paper (different casing)', doi: 'https://doi.org/10.1000/X', pmid: '123' }] },
    { source: 'scopus', records: [{ title: 'Other Paper', doi: '10.1000/y' }] },
  ]);
  assert.equal(merged.length, 2);
  const a = merged.find((r) => r.openalex_id === 'W1');
  assert.deepEqual(a.sources.sort(), ['openalex', 'pubmed']);
  assert.equal(a.source, 'openalex', 'first-hit source kept as primary');
  assert.equal(a.openalex_id, 'W1', 'first record keeps its own fields');
});

test('mergeSearchRecords falls back to normalized title when DOI is missing', () => {
  const merged = mergeSearchRecords([
    { source: 'openalex', records: [{ title: 'Strong Metal-Support Interactions!' }] },
    { source: 'semantic-scholar', records: [{ title: 'strong metal support interactions' }] },
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].sources.sort(), ['openalex', 'semantic-scholar']);
});

test('mergeSearchRecords keeps unidentifiable records and survives garbage input', () => {
  const merged = mergeSearchRecords([
    { source: 'pubmed', records: [{ doi: '10.1/a' }, null, 'junk', {}] },
    { source: 'oops', records: null },
  ]);
  // {doi} merges by doi key; {} has no key but is kept as-is
  assert.equal(merged.length, 2);
  assert.equal(merged[0].source, 'pubmed');
});
