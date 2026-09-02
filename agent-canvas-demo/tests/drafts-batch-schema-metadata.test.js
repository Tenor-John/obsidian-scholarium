"use strict";
// 2026-08-27 发布冲刺项2验收发现的真实缺口（非 experiment.transition 本身，
// 而是同一次验收顺带跑出的插件根回归）：/v1/drafts/batch 此前把 content
// 当不透明文本直接写盘，从不解析或校验 schema-v1 frontmatter。
// research-chat-core.js 规则11/15/17（EXP/HYP、decision、lesson 三条草稿
// 通道）从来没教模型要写 created_at/updated_at，于是真实落盘的
// Research/Decisions/DEC-001.md、Research/Lessons/LES-001.md 都缺了这两个
// schema-v1 §4 要求的 ISO8601 字段，只有跑一次全量 vault 校验
// （tools/schema-objects.js validateVault）才会抓到。
//
// 修法见 bridge/server.js 里 /v1/drafts/batch 预览处理器新增的
// parsedDraft/validateObject 分支：只对 frontmatter 里 type 字段命中已知
// schema-v1 类型（PREFIX）的草稿生效——由 Bridge 补全缺失的
// created_at/updated_at，再用完整的 validateObject() 校验一遍；没有 type
// 字段、或 type 不在 PREFIX 里的普通笔记原样透传，不强加 schema。
//
// 这份测试独立于 drafts-batch-vault-validation.test.js（那份测的是 DEF-005
// 的 vaultRoot 拒绝路径），专门盯这条新分支本身。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const TOKEN = 'schema-metadata-' + process.pid;
let nextPort = 47500 + (process.pid % 200);

function request(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = { 'x-agent-bridge-token': TOKEN };
    if (options.body) headers['content-type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForBridge(port) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await request(port, '/health')).status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

async function launch(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-schema-metadata-'));
  const vault = path.join(temp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const configPath = path.join(temp, 'bridge.config.json');
  const secretsPath = path.join(temp, 'bridge.env');
  const port = nextPort++;
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN, allowExecution: false, workspaceRoot: vault, allowedRoots: [vault], adapters: {},
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
  }, null, 2), 'utf8');
  const bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(port), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: secretsPath },
    stdio: 'ignore', windowsHide: true,
  });
  t.after(() => {
    if (!bridge.killed) bridge.kill();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await waitForBridge(port);
  return { port, vault };
}

async function previewAndCommit(port, items) {
  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({ base: 'scholarium-vault', items }),
  });
  if (preview.status !== 201) return { preview };
  const batch = JSON.parse(preview.body);
  const commit = await request(port, `/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  return { preview, commit };
}

const VALID_DECISION_FRONTMATTER = [
  'type: decision',
  'uid: 01919c7a-1234-7abc-89ab-1234567890ab',
  'display_id: DEC-999',
  'schema_version: 1',
  'project_uid: 01919c7a-5678-7abc-89ab-1234567890ab',
  'title: t',
  'decision: d',
  'rationale: r',
];

const VALID_LESSON_FRONTMATTER = [
  'type: lesson',
  'uid: 01919c7a-4321-7abc-89ab-1234567890ab',
  'display_id: LES-999',
  'schema_version: 1',
  'title: t',
  'statement: s',
  'scope: sc',
  'evidence_summary: es',
  'evidence_refs:',
  '  - 01919c7a-4321-7abc-89ab-1234567890ab',
  'source_types:',
  '  - decision',
];

test('a decision draft missing created_at/updated_at is auto-filled with valid ISO8601 timestamps, not rejected', async (t) => {
  const { port, vault } = await launch(t);
  const content = ['---', ...VALID_DECISION_FRONTMATTER, '---', 'body'].join('\n');
  const { preview, commit } = await previewAndCommit(port, [{ path: 'Research/Decisions/DEC-999.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, 'Research', 'Decisions', 'DEC-999.md'), 'utf8');
  // schema-objects.js's emit() runs every string value (including a valid
  // ISO date) through JSON.stringify before writing it, so a server-produced
  // frontmatter value is always quoted (`created_at: "2026-08-27T...Z"`), not
  // bare. The regex has to tolerate that quote — it's the real, correct
  // output shape, not a bug.
  assert.match(written, /created_at: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(written, /updated_at: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('a lesson draft missing created_at/updated_at is auto-filled with valid ISO8601 timestamps, not rejected', async (t) => {
  const { port, vault } = await launch(t);
  const content = ['---', ...VALID_LESSON_FRONTMATTER, '---', 'body'].join('\n');
  const { preview, commit } = await previewAndCommit(port, [{ path: 'Research/Lessons/LES-999.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, 'Research', 'Lessons', 'LES-999.md'), 'utf8');
  assert.match(written, /created_at: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(written, /updated_at: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('a decision draft that already supplies created_at/updated_at keeps those exact values, not overwritten', async (t) => {
  const { port, vault } = await launch(t);
  const content = ['---', ...VALID_DECISION_FRONTMATTER, 'created_at: 2020-01-01T00:00:00Z', 'updated_at: 2020-01-02T00:00:00Z', '---', 'body'].join('\n');
  const { preview, commit } = await previewAndCommit(port, [{ path: 'Research/Decisions/DEC-999.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, 'Research', 'Decisions', 'DEC-999.md'), 'utf8');
  assert.match(written, /created_at: "?2020-01-01T00:00:00Z"?/);
  assert.match(written, /updated_at: "?2020-01-02T00:00:00Z"?/);
});

test('a decision draft missing a genuinely required field (rationale) is rejected before anything is written', async (t) => {
  const { port, vault } = await launch(t);
  const incomplete = VALID_DECISION_FRONTMATTER.filter((line) => !line.startsWith('rationale:'));
  const content = ['---', ...incomplete, '---', 'body'].join('\n');
  const { preview } = await previewAndCommit(port, [{ path: 'Research/Decisions/DEC-999.md', content }]);
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /schema-v1/);
  assert.match(JSON.parse(preview.body).error, /rationale/);
  assert.equal(fs.existsSync(path.join(vault, 'Research', 'Decisions', 'DEC-999.md')), false);
});

test('a draft with no type field (plain note) is written byte-for-byte, no schema enforced, no timestamps injected', async (t) => {
  const { port, vault } = await launch(t);
  const content = '# just a note\n\nno frontmatter at all here.\n';
  const { preview, commit } = await previewAndCommit(port, [{ path: 'Research/Notes/plain.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, 'Research', 'Notes', 'plain.md'), 'utf8');
  assert.equal(written, content);
});

test('a draft whose type is not a known schema-v1 type is written byte-for-byte, no schema enforced', async (t) => {
  const { port, vault } = await launch(t);
  const content = '---\ntype: scratchpad\n---\nsomething informal\n';
  const { preview, commit } = await previewAndCommit(port, [{ path: 'Research/Notes/scratch.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, 'Research', 'Notes', 'scratch.md'), 'utf8');
  assert.equal(written, content);
});

// 2026-08-28 发布冲刺项3实测发现的真实 P0，reproduced here: a chat-drafted
// EXP note (created_by: ai, exactly EXP-011's shape) that sets data_origin
// but has no way to legitimately supply data_recorded_by (only "user" is a
// valid value, and an AI draft can never honestly claim that) used to reach
// disk anyway, then blow up one step later at experiment.transition with a
// confusing "拒绝写入不合法 Experiment" error that contradicted the
// "already saved" confirmation the researcher had just clicked. This must be
// caught right here, at draft-preview time, before anything is written.
const EXP_FRONTMATTER_NO_PROVENANCE = [
  'type: experiment',
  'uid: 01919c7a-9999-7abc-89ab-1234567890ab',
  'display_id: EXP-999',
  'schema_version: 1',
  'project_uid: 01919c7a-5678-7abc-89ab-1234567890ab',
  'title: t',
  'status: designed',
  'created_by: ai',
];

test('an EXP draft with data_origin set but no data_recorded_by/data_recorded_at is rejected at preview, not written, and never reaches transition', async (t) => {
  const { port, vault } = await launch(t);
  const content = ['---', ...EXP_FRONTMATTER_NO_PROVENANCE, 'data_origin: planned', '---', 'body'].join('\n');
  const { preview } = await previewAndCommit(port, [{ path: 'Research/Experiments/EXP-999.md', content }]);
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /schema-v1/);
  assert.match(JSON.parse(preview.body).error, /data_recorded_by/);
  assert.match(JSON.parse(preview.body).error, /data_recorded_at/);
  assert.equal(fs.existsSync(path.join(vault, 'Research', 'Experiments', 'EXP-999.md')), false);
});

test('an EXP draft that omits data_origin entirely (the prompt-mandated shape) is accepted, matching a legacy/no-claim record', async (t) => {
  const { port, vault } = await launch(t);
  const content = ['---', ...EXP_FRONTMATTER_NO_PROVENANCE, '---', 'body'].join('\n');
  const { preview, commit } = await previewAndCommit(port, [{ path: 'Research/Experiments/EXP-999.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, 'Research', 'Experiments', 'EXP-999.md'), 'utf8');
  assert.match(written, /created_at: "?\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(written, /data_origin:/);
});
