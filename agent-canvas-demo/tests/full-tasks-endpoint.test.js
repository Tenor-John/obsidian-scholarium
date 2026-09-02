"use strict";
// Real end-to-end tests for the full-permission lane slice 1 (design doc
// docs/full-permission-lane-design.md v2, §3.5/§4): POST /v1/full-tasks/preview
// issues a one-time, TTL-bound preview token; POST /v1/full-tasks re-validates
// that token server-side (existence, expiry, exact category/workspace/prompt
// match) before anything is allowed through, and every attempt — accepted or
// rejected — lands in an append-only JSONL audit log. Slice 1 deliberately
// starts no agent process: a fully valid dispatch gets an explicit 409.
// Same real-Bridge-over-real-HTTP pattern as drafts-batch-endpoint.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bridgePort = 46900 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;

let bridge;
let workspace;
let auditDir;
let configPath;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { 'content-type': 'application/json' } : {};
    if (!options.noAuth) headers['x-agent-bridge-token'] = TOKEN;
    const req = http.request({
      host: '127.0.0.1', port: bridgePort, path: pathname, method: options.method || 'GET', headers,
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
    try { const res = await request('/health', { noAuth: true }); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

function auditEvents() {
  if (!fs.existsSync(auditDir)) return [];
  return fs.readdirSync(auditDir)
    .filter((name) => /^full-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .flatMap((name) => fs.readFileSync(path.join(auditDir, name), 'utf8').split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const VALID = () => ({ category: 'fetch_and_attach_pdf', workspace, prompt: '按 DOI 10.1021/example 下载 PDF 并挂载到文献库' });

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'full-tasks-workspace-'));
  auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-tasks-audit-'));
  configPath = path.join(os.tmpdir(), `full-tasks-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN,
    allowExecution: false,
    workspaceRoot: workspace,
    allowedRoots: [workspace],
    adapters: {},
    fullTaskAuditDir: auditDir,
  }, null, 2), 'utf8');

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (configPath && fs.existsSync(configPath)) fs.rmSync(configPath);
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
  if (auditDir && fs.existsSync(auditDir)) fs.rmSync(auditDir, { recursive: true, force: true });
});

test('rejects preview and dispatch without the bridge token', async () => {
  const preview = await request('/v1/full-tasks/preview', { method: 'POST', noAuth: true, body: JSON.stringify(VALID()) });
  assert.equal(preview.status, 401);
  const dispatch = await request('/v1/full-tasks', { method: 'POST', noAuth: true, body: JSON.stringify({ previewId: 'x', ...VALID() }) });
  assert.equal(dispatch.status, 401);
});

test('preview rejects an unknown category and audits the rejection', async () => {
  const res = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify({ ...VALID(), category: 'delete_everything' }) });
  assert.equal(res.status, 400);
  assert.match(JSON.parse(res.body).error, /unknown full-task category/);
  const hit = auditEvents().find((e) => e.event === 'preview-rejected' && e.category === 'delete_everything');
  assert.ok(hit, 'rejected previews must be audited');
  assert.equal(hit.reason, 'unknown category');
});

test('preview rejects a workspace outside allowedRoots and a too-short prompt', async () => {
  const outside = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify({ ...VALID(), workspace: path.join(os.tmpdir(), 'not-allowed-here') }) });
  assert.equal(outside.status, 403);
  assert.ok(auditEvents().some((e) => e.event === 'preview-rejected' && e.reason === 'workspace outside allowedRoots'));

  const short = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify({ ...VALID(), prompt: 'ab' }) });
  assert.equal(short.status, 400);
  assert.ok(auditEvents().some((e) => e.event === 'preview-rejected' && e.reason === 'prompt too short'));
});

test('dispatch without a valid previewId is refused and audited', async () => {
  const res = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: 'never-issued', ...VALID() }) });
  assert.equal(res.status, 403);
  assert.match(JSON.parse(res.body).error, /previewId/);
  assert.ok(auditEvents().some((e) => e.event === 'dispatch-rejected' && /previewId/.test(e.reason)));
});

test('dispatch must match the previewed category, workspace and prompt verbatim', async () => {
  const preview = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify(VALID()) });
  assert.equal(preview.status, 201);
  const { id } = JSON.parse(preview.body);
  assert.ok(id);

  const wrongPrompt = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: id, ...VALID(), prompt: '把刚才预览过的内容换掉' }) });
  assert.equal(wrongPrompt.status, 409);
  assert.match(JSON.parse(wrongPrompt.body).error, /prompt does not match/);

  const wrongWorkspace = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: id, ...VALID(), workspace: path.join(workspace, 'sub') }) });
  assert.equal(wrongWorkspace.status, 409);
  assert.match(JSON.parse(wrongWorkspace.body).error, /workspace does not match/);

  // 被拒绝的不一致派发不能消耗预览——它属于用户尚未确认的内容。切片 2 之后，
  // 内容一致的派发会再往后走一道门：本测试的 Bridge 没配 -full 适配器，
  // 所以停在 503；配置类拒绝同样不消耗预览。
  const stillThere = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: id, ...VALID() }) });
  assert.equal(stillThere.status, 503, 'no -full adapter is configured in this test bridge');
  assert.match(JSON.parse(stillThere.body).error, /no -full adapter/);
  const onceMore = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: id, ...VALID() }) });
  assert.equal(onceMore.status, 503, 'a config-level refusal must not consume the confirmed preview');
});

test('a preview and dispatch compare the complete prompt beyond 20000 characters', async () => {
  const sharedPrefix = 'x'.repeat(20000);
  const original = { ...VALID(), prompt: `${sharedPrefix} 已确认下载 A` };
  const preview = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify(original) });
  assert.equal(preview.status, 201);
  const { id } = JSON.parse(preview.body);

  const changedTail = await request('/v1/full-tasks', {
    method: 'POST',
    body: JSON.stringify({ previewId: id, ...original, prompt: `${sharedPrefix} 改为下载 B` }),
  });
  assert.equal(changedTail.status, 409, 'a changed tail must not pass confirmation');
  assert.match(JSON.parse(changedTail.body).error, /prompt does not match/);

  const exact = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: id, ...original }) });
  assert.equal(exact.status, 503, 'the exact long prompt still reaches the later adapter gate');
});

test('happy path: preview -> gated dispatch (503, no -full adapter here) leaves preview alive, all audited', async () => {
  const preview = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify(VALID()) });
  assert.equal(preview.status, 201);
  const body = JSON.parse(preview.body);
  assert.ok(body.id);
  assert.equal(body.category, 'fetch_and_attach_pdf');
  assert.equal(body.network, true);
  assert.deepEqual(body.plannedTools, ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'], 'fetch_and_attach_pdf dispatches WITHOUT Write — the Bridge downloads the bytes itself');
  assert.equal(body.adapter, 'claude-full', 'preview must name the adapter so the §3 dialog can show it');
  assert.equal(body.enforcement, 'detection', 'preview must state the enforcement level (§2.5/§3); this test config has no sandboxed-full adapter');
  assert.equal(body.pathScope, 'literature/downloaded-pdfs');
  assert.ok(body.expiresAt);
  assert.ok(auditEvents().some((e) => e.event === 'preview-created' && e.previewId === body.id));

  // 本测试的 Bridge 配置里 adapters 是空的——切片 2 的真实派发门槛
  // （适配器/probe/快照）由 full-lane-dispatch.test.js 覆盖；这里验证的是
  // 内容一致性校验仍然先于一切配置门槛，且配置类拒绝不消耗预览。
  const dispatch = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: body.id, ...VALID() }) });
  assert.equal(dispatch.status, 503);
  assert.match(JSON.parse(dispatch.body).error, /no -full adapter/);
  const retry = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: body.id, ...VALID() }) });
  assert.equal(retry.status, 503, 'a config-level refusal must not consume the preview');
  assert.ok(auditEvents().filter((e) => e.event === 'dispatch-rejected' && e.previewId === body.id).length >= 2);
});

test('cancel endpoint: unknown id 404, and it requires the token', async () => {
  const noAuth = await request('/v1/full-tasks/whatever/cancel', { method: 'POST', noAuth: true });
  assert.equal(noAuth.status, 401);
  const missing = await request('/v1/full-tasks/00000000-0000-0000-0000-000000000000/cancel', { method: 'POST' });
  assert.equal(missing.status, 404);
});
