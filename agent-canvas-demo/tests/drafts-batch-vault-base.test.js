"use strict";
// Regression: schema-v1 drafts (P3-P5 hypotheses/experiments/schedule, Idea
// mode notes) must land under scholarium.vaultRoot even when workspaceRoot
// points at a per-topic subfolder. Before the base field existed, drafts/batch
// resolved every path against workspaceRoot, so an M3 first-loop run executed
// from a topic folder wrote Research/Hypotheses into the topic's subtree and
// the vault-level registry kept showing 假设 0 · 实验 0.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startBridge } = require('./helpers/bridge-harness.js');

let harness, vault, topicDir, auditDir;
const request = (pathname, options = {}) => harness.request(pathname, { method: options.method, body: options.body })
  .then((res) => ({ ...res, body: res.text }));

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-vault-base-'));
  topicDir = path.join(vault, 'TopicSubfolder');
  fs.mkdirSync(topicDir, { recursive: true });
  auditDir = path.join(vault, 'audit');
  harness = await startBridge({ config: {
    workspaceRoot: topicDir, allowedRoots: [topicDir], adapters: {}, fullTaskAuditDir: auditDir,
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
  } });
});

test.after(() => {
  if (harness) harness.stop();
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('base scholarium-vault writes DEC and LES records into the vault root, not the topic workspace', async () => {
  const items = [
    { path: 'Research/Decisions/DEC-900 vault-base.md', content: '# DEC-900\n\nvault base' },
    { path: 'Research/Lessons/LES-900 vault-base.md', content: '# LES-900\n\nvault base' },
  ];
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: { base: 'scholarium-vault', items } });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  assert.equal(batch.base, 'scholarium-vault');

  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);

  assert.ok(fs.existsSync(path.join(vault, 'Research', 'Decisions', 'DEC-900 vault-base.md')), 'decision must land in the vault');
  assert.ok(fs.existsSync(path.join(vault, 'Research', 'Lessons', 'LES-900 vault-base.md')), 'lesson must land in the vault');
  assert.ok(!fs.existsSync(path.join(topicDir, 'Research')), 'nothing may leak into the topic workspace');
});

test('scholarium-vault drafts still reject path traversal before writing', async () => {
  const res = await request('/v1/drafts/batch', {
    method: 'POST',
    body: { base: 'scholarium-vault', items: [{ path: '../escape.md', content: '# escape' }] },
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /relative .md path/);
  assert.equal(fs.existsSync(path.join(path.dirname(vault), 'escape.md')), false);
});

test('full lane still refuses the vault ancestor outside allowedRoots', async () => {
  const res = await request('/v1/full-tasks/preview', {
    method: 'POST',
    body: { category: 'fetch_and_attach_pdf', workspace: vault, prompt: 'Download this DOI only after the researcher confirms it.' },
  });
  assert.equal(res.status, 403, res.body);
  assert.match(JSON.parse(res.body).error, /outside configured allowedRoots/);
});

test('omitting base keeps the legacy workspaceRoot behavior', async () => {
  const items = [{ path: 'notes/local.md', content: '# local\n' }];
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: { items } });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);
  assert.ok(fs.existsSync(path.join(topicDir, 'notes', 'local.md')), 'default base still writes into workspaceRoot');
});

test('an unknown base is rejected with 400 and writes nothing', async () => {
  const res = await request('/v1/drafts/batch', {
    method: 'POST',
    body: { base: 'somewhere-else', items: [{ path: 'x.md', content: 'x' }] },
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /unknown draft base/);
  assert.ok(!fs.existsSync(path.join(vault, 'x.md')));
  assert.ok(!fs.existsSync(path.join(topicDir, 'x.md')));
});
