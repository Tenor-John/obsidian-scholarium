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
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = 47100 + (process.pid % 300);
const token = 'def005-token-' + process.pid;

let bridge, vault, topicDir, configPath;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { 'content-type': 'application/json' } : {};
    headers['x-agent-bridge-token'] = token;
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForBridge() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const res = await request('/health'); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'def005-vault-'));
  topicDir = path.join(vault, '等离子体金属AuNP可见光催化CO2RR', 'CeO2壳厚对Au@CeO2可见光析氢活性的影响');
  fs.mkdirSync(topicDir, { recursive: true });
  configPath = path.join(os.tmpdir(), `def005-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token, allowExecution: false,
    workspaceRoot: topicDir,
    // The defect's exact shape: allowedRoots is a *descendant* subfolder,
    // NOT the vault itself.
    allowedRoots: [topicDir],
    adapters: {},
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
  }, null, 2), 'utf8');

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(port), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (configPath && fs.existsSync(configPath)) fs.rmSync(configPath, { force: true });
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
    method: 'POST', body: JSON.stringify({ items, base: 'scholarium-vault' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);

  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);

  const written = path.join(vault, 'Research', 'Decisions', 'DEC-REPRO-TEST.md');
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
    body: JSON.stringify({ base: 'scholarium-vault', items: [{ path: '../escape.md', content: 'x' }] }),
  });
  assert.equal(res.status, 400, res.body);
  assert.match(JSON.parse(res.body).error, /relative \.md path/);
  assert.ok(!fs.existsSync(path.join(vault, '..', 'escape.md')));
});

test('full-permission lane sandbox boundary is not widened: the vault root itself is still outside allowedRoots', async () => {
  const res = await request('/v1/full-tasks/preview', {
    method: 'POST',
    body: JSON.stringify({
      category: 'fetch_and_attach_pdf',
      workspace: vault, // the vault itself: allowed for drafts, must stay refused for full-lane spawns
      prompt: '按 DOI 10.1021/example 下载 PDF 并挂载到文献库',
    }),
  });
  assert.equal(res.status, 403, res.body);
  assert.match(JSON.parse(res.body).error, /outside configured allowedRoots/);
});

test('full-permission lane sandbox boundary: a sibling topic folder under the vault is still outside allowedRoots', async () => {
  const sibling = path.join(vault, 'some-other-topic');
  fs.mkdirSync(sibling, { recursive: true });
  const res = await request('/v1/full-tasks/preview', {
    method: 'POST',
    body: JSON.stringify({
      category: 'fetch_and_attach_pdf',
      workspace: sibling,
      prompt: '按 DOI 10.1021/example 下载 PDF 并挂载到文献库',
    }),
  });
  assert.equal(res.status, 403, res.body);
  fs.rmSync(sibling, { recursive: true, force: true });
});
