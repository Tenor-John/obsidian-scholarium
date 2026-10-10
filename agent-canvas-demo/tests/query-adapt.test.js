"use strict";
// Unit tests for query-adapt.js — deterministic per-source query
// translation. No DOM, no Bridge, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const Adapt = require('../query-adapt.js');

test('openalex and scopus preserve portable canonical Boolean syntax', () => {
  const q = 'BiVO4 AND (photocatalysis OR "visible light") NOT electrocatalysis';
  assert.equal(Adapt.adaptQueryForSource(q, 'openalex'), q);
  assert.equal(Adapt.adaptQueryForSource(q, 'scopus'), q);
});

test('unsupported wildcards are removed only for sources that do not reliably support them', () => {
  const q = 'photocatal* AND nano?star';
  assert.equal(Adapt.adaptQueryForSource(q, 'openalex'), 'photocatal AND nanostar');
  assert.equal(Adapt.adaptQueryForSource(q, 'semantic-scholar'), 'photocatal nanostar');
  assert.equal(Adapt.adaptQueryForSource(q, 'pubmed'), 'photocatal* AND nano?star');
  assert.equal(Adapt.adaptQueryForSource(q, 'scopus'), q);
});

test('pubmed: lowercase boolean operators are upper-cased, field tags and phrases untouched', () => {
  const out = Adapt.adaptQueryForSource('BiVO4 and (photocatalysis or "visible light") not electrocatalysis[tiab]', 'pubmed');
  assert.equal(out, 'BiVO4 AND (photocatalysis OR "visible light") NOT electrocatalysis[tiab]');
});

test('pubmed: whole-word match only — never re-cases and/or/not inside other words', () => {
  const out = Adapt.adaptQueryForSource('Andalusian pottery and Notch signaling', 'pubmed');
  assert.equal(out, 'Andalusian pottery AND Notch signaling');
});

test('semantic-scholar: degrades Boolean syntax to a free-text term bag, keeps quoted phrases', () => {
  const out = Adapt.adaptQueryForSource('BiVO4 AND (photocatalysis OR "visible light") NOT electrocatalysis', 'semantic-scholar');
  assert.equal(out, 'BiVO4 photocatalysis "visible light" electrocatalysis');
});

test('semantic-scholar: operators are matched whole-word only (case-insensitive)', () => {
  const out = Adapt.adaptQueryForSource('Andalusian AND Notch OR not-a-drug', 'semantic-scholar');
  assert.equal(out, 'Andalusian Notch not-a-drug');
});

test('adaptQueryForSource: empty/blank input and unknown source are no-ops', () => {
  assert.equal(Adapt.adaptQueryForSource('', 'pubmed'), '');
  assert.equal(Adapt.adaptQueryForSource('   ', 'pubmed'), '');
  assert.equal(Adapt.adaptQueryForSource('a AND b', 'unknown-source'), 'a AND b');
});

test('SOURCES lists all four adapted sources', () => {
  assert.deepEqual(Adapt.SOURCES, ['openalex', 'pubmed', 'semantic-scholar', 'scopus']);
});
