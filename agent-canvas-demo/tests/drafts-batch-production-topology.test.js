"use strict";
// DEF-005 regression: real production deployments configure allowedRoots to
// a single topic subfolder while scholarium.vaultRoot points at its
// *ancestor* vault directory (the subfolder lives inside the vault). Before
// this fix, allowedRoot()'s "target must be a descendant of some listed
// root" check ran on scholarium.vaultRoot itself (promotionVault(), server.js
// draftBaseRoot() -> L760) and on every draft/promotion target resolved
// against it — both directions fail by construction when vaultRoot is an
// ancestor rather than a descendant of allowedRoots, so DEC/LES/Idea drafts
// could never land (see docs/training-defect-report-2026-08-27.md DEF-005).
// This file reproduces exactly that topology end-to-end, plus a path-escape
// negative and confirms the full-permission lane's allowedRoots boundary was
// NOT widened by the fix. See drafts-batch-vaultroot-missing.test.js for the
// "vaultRoot unset/nonexistent still fails closed" negative.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startBridge } = require('./helpers/bridge-harness.js');

let harness, vault, topicDir;
const request = (pathname, options = {}) => harness.request(pathname, { method: options.method, body: options.body })
  .then((res) => ({ ...res, body: res.text }));

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'def005-vault-'));
  topicDir = path.join(vault, '等离子体金属AuNP可见光催化CO2RR', 'CeO2壳厚对Au@CeO2可见光析氢活性的影响');
  fs.mkdirSync(topicDir, { recursive: true });
  const projectPath = path.join(vault, 'Research', 'Projects', 'PRJ-002 topology.md');
  fs.mkdirSync(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, [
    '---',
    'uid: "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b"',
    'display_id: "PRJ-002"',
    'schema_version: 1',
    'type: "project"',
    'created_at: "2026-09-10T00:00:00.000Z"',
    'updated_at: "2026-09-10T00:00:00.000Z"',
    'title: "topology"',
    'status: "active"',
    '---',
    '',
  ].join('\n'), 'utf8');
  harness = await startBridge({ config: {
    workspaceRoot: topicDir, allowedRoots: [topicDir], adapters: {},
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
  } });
});

test.after(() => {
  if (harness) harness.stop();
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('DEC draft batch writes into the vault even though vaultRoot is an ancestor of allowedRoots', async () => {
  // 2026-08-27 发布冲刺项2验收: /v1/drafts/batch 现在会真的解析并校验
  // schema-v1 frontmatter（见 server.js 的 parsedDraft/validateObject 分支），
  // 所以这里不能再用只有 `type: decision` 的占位内容——那从来不是一份
  // 合法的 decision 记录，只是恰好在旧的"不校验、直接写盘"实现下能通过。
  // 这份 fixture 补齐 schema-v1 强制要求的字段（uid/display_id/schema_version/
  // project_uid/title/decision/rationale），但仍然刻意不写 created_at/
  // updated_at，用来同时验证 DEF-005 拓扑修复本身没有回归。
  const items = [{
    path: 'Research/Decisions/DEC-REPRO-TEST.md',
    content: [
      '---',
      'type: decision',
      'uid: 01919c7a-1234-7abc-89ab-1234567890ab',
      'display_id: DEC-999',
      'schema_version: 1',
      'project_uid: 01919c7a-5678-7abc-89ab-1234567890ab',
      'title: repro',
      'decision: repro',
      'rationale: repro',
      '---',
      'repro',
      '',
    ].join('\n'),
  }];
  const preview = await request('/v1/drafts/batch', {
    method: 'POST', body: {
      items, base: 'scholarium-vault', serverManagedMetadata: true,
      projectDisplayId: 'PRJ-002',
    },
  });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);

  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);

  const written = path.join(vault, batch.items[0].path);
  assert.ok(fs.existsSync(written), 'DEC file must actually land in the vault');
  // Proves the schema-metadata fix actually ran on this write, not just that
  // it didn't break it: created_at/updated_at were omitted from the fixture
  // above, so their presence here can only come from server-side auto-fill.
  const writtenContent = fs.readFileSync(written, 'utf8');
  // schema-objects.js's emit() JSON.stringifies every string field, so a
  // server-produced timestamp is quoted (`created_at: "2026-...Z"`), not bare.
  assert.match(writtenContent, /created_at: "?\d{4}-\d{2}-\d{2}T/);
  assert.match(writtenContent, /updated_at: "?\d{4}-\d{2}-\d{2}T/);
});

test('a draft path that tries to escape the vault with ../ is still rejected', async () => {
  const res = await request('/v1/drafts/batch', {
    method: 'POST',
    body: { base: 'scholarium-vault', items: [{ path: '../escape.md', content: 'x' }] },
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /relative \.md path/);
  assert.ok(!fs.existsSync(path.join(vault, '..', 'escape.md')));
});

test('full-permission lane sandbox boundary is not widened: the vault root itself is still outside allowedRoots', async () => {
  const res = await request('/v1/full-tasks/preview', {
    method: 'POST',
    body: {
      category: 'fetch_and_attach_pdf',
      workspace: vault, // the vault itself: allowed for drafts, must stay refused for full-lane spawns
      prompt: '按 DOI 10.1021/example 下载 PDF 并挂载到文献库',
    },
  });
  assert.equal(res.status, 403, res.body);
  assert.match(JSON.parse(res.body).error, /outside configured allowedRoots/);
});

test('full-permission lane sandbox boundary: a sibling topic folder under the vault is still outside allowedRoots', async () => {
  const sibling = path.join(vault, 'some-other-topic');
  fs.mkdirSync(sibling, { recursive: true });
  const res = await request('/v1/full-tasks/preview', {
    method: 'POST',
    body: {
      category: 'fetch_and_attach_pdf',
      workspace: sibling,
      prompt: '按 DOI 10.1021/example 下载 PDF 并挂载到文献库',
    },
  });
  assert.equal(res.status, 403, res.body);
  fs.rmSync(sibling, { recursive: true, force: true });
});
