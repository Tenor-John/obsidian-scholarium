"use strict";
// Run-history endpoints: GET /v1/history (摘要列表，interrupted 标注),
// GET /v1/literature/searches/:id (磁盘详情), GET /v1/full-tasks/:id 的
// 磁盘回退（Bridge 重启后内存记录消失，历史任务仍可重开）。
// 与 full-tasks-endpoint.test.js 同模式：真实 Bridge 进程 + 真实 HTTP。
// 写侧（派发时落 running、finish 落终态、检索落 manifest）由 fixture 文件
// 模拟——fixture 就是 persistRunRecord 自己会写出的 JSON 形状。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bridgePort = 47200 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;

let bridge;
let workspace;
let runtimeDir;
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

function writeFixture(kind, record) {
  const dir = path.join(runtimeDir, 'run-history', kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
}

const FULL_DONE = {
  id: 'full-done-1', category: 'fetch_and_attach_pdf', adapter: 'claude-full',
  userPrompt: '10.48550/arXiv.1706.03762（Attention Is All You Need, Vaswani et al. 2017）',
  status: 'completed', startedAt: '2026-08-18T10:00:00.000Z', endedAt: '2026-08-18T10:03:00.000Z',
  download: { path: 'literature/downloaded-pdfs/x.pdf', bytes: 1024, status: 'downloaded', source_url: 'https://arxiv.org/pdf/x' },
  diff: { added: ['literature/downloaded-pdfs/x.pdf'], modified: [], deleted: [] }, violations: [],
};
const FULL_RUNNING = {
  id: 'full-run-1', category: 'fetch_and_attach_pdf', adapter: 'claude-full',
  userPrompt: '10.1002/adfm.201801214', status: 'running', startedAt: '2026-08-18T11:00:00.000Z',
};
const SEARCH_REC = {
  id: 'search-1', query: 'Au core BiVO4 shell photocatalyst',
  sources: [{ source: 'openalex', ok: true, count: 2 }],
  manifest: { skill: 'multi-source-search', query: 'Au core BiVO4 shell photocatalyst', record_count: 2, records: [
    { openalex_id: 'W1', doi: '10.1/a', title: 'Paper A', year: 2020, is_oa: true, pdf_url: 'https://x.org/a.pdf' },
    { openalex_id: 'W2', doi: '10.1/b', title: 'Paper B', year: 2021, is_oa: false },
  ] },
  createdAt: '2026-08-18T12:00:00.000Z',
};

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-workspace-'));
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-runtime-'));
  const oldPdf = path.join(workspace, 'literature', 'downloaded-pdfs', 'old.pdf');
  fs.mkdirSync(path.dirname(oldPdf), { recursive: true });
  fs.writeFileSync(oldPdf, '%PDF-1.4 test');
  writeFixture('full-tasks', FULL_DONE);
  writeFixture('full-tasks', FULL_RUNNING);
  writeFixture('searches', SEARCH_REC);
  writeFixture('pipelines', {
    id: 'pipeline-old-1', kind: 'pipeline', title: '旧 Pipeline', workspace,
    status: 'running', startedAt: '2026-08-18T13:00:00.000Z', updatedAt: '2026-08-18T13:01:00.000Z',
    steps: [{ title: '第 5 步 · 下载', detail: '成功 1 篇', state: 'done' }],
    resumeFrom: 'nature-reader', artifacts: { downloadedPaths: ['literature/downloaded-pdfs/old.pdf'] },
  });
  configPath = path.join(os.tmpdir(), `run-history-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN,
    allowExecution: false,
    workspaceRoot: workspace,
    allowedRoots: [workspace],
    adapters: {},
    fullTaskRuntimeDir: runtimeDir,
    fullTaskAuditDir: path.join(runtimeDir, 'audit'),
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
  if (runtimeDir && fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });
});

test('GET /v1/history requires the bridge token', async () => {
  const res = await request('/v1/history', { noAuth: true });
  assert.equal(res.status, 401);
});

test('GET /v1/history lists full-tasks, searches and resumable pipelines', async () => {
  const res = await request('/v1/history');
  assert.equal(res.status, 200);
  const data = JSON.parse(res.body);
  assert.equal(data.fullTasks.length, 2);
  assert.equal(data.searches.length, 1);
  assert.equal(data.pipelines.length, 1);
  assert.equal(data.pipelines[0].status, 'interrupted');
  assert.equal(data.pipelines[0].workspace, workspace);
  assert.equal(data.pipelines[0].pdfCount, 1);
  assert.equal(data.pipelines[0].resumable, true);
  // newest (11:00 running) before 10:00 done
  assert.equal(data.fullTasks[0].id, 'full-run-1');
  // 磁盘自称 running 但内存里没有 → interrupted，不能假装还在跑
  assert.equal(data.fullTasks[0].status, 'interrupted');
  assert.equal(data.fullTasks[1].status, 'completed');
  assert.equal(data.fullTasks[1].title.includes('Attention Is All You Need'), true);
  assert.equal(data.searches[0].recordCount, 2);
  assert.equal(data.searches[0].title, 'Au core BiVO4 shell photocatalyst');
});

test('pipeline checkpoints persist steps and an exact, workspace-confined PDF resume set', async () => {
  const pdf = path.join(workspace, 'literature', 'downloaded-pdfs', 'resume.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4 resume');
  const started = await request('/v1/pipeline-runs', {
    method: 'POST', body: JSON.stringify({ title: '可恢复流程', workspace }),
  });
  assert.equal(started.status, 201);
  const id = JSON.parse(started.body).id;
  const checkpoint = await request(`/v1/pipeline-runs/${id}`, {
    method: 'PATCH', body: JSON.stringify({
      status: 'running', resumeFrom: 'nature-reader',
      steps: [{ title: '第 5 步', detail: '成功下载 1 篇', state: 'done' }],
      artifacts: { downloadedPaths: [pdf, path.join(os.tmpdir(), 'outside.pdf'), 'missing.pdf'] },
    }),
  });
  assert.equal(checkpoint.status, 200);
  const saved = JSON.parse(checkpoint.body);
  assert.deepEqual(saved.artifacts.downloadedPaths, ['literature/downloaded-pdfs/resume.pdf']);
  assert.equal(saved.steps[0].state, 'done');
  assert.equal(saved.resumeFrom, 'nature-reader');

  const detail = await request(`/v1/pipeline-runs/${id}`);
  assert.equal(detail.status, 200);
  assert.equal(JSON.parse(detail.body).status, 'running');

  const finished = await request(`/v1/pipeline-runs/${id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'cancelled', steps: saved.steps }),
  });
  assert.equal(finished.status, 200);
  assert.equal(JSON.parse(finished.body).status, 'cancelled');
});

test('GET /v1/literature/searches/:id returns the full manifest from disk', async () => {
  const res = await request('/v1/literature/searches/search-1');
  assert.equal(res.status, 200);
  const rec = JSON.parse(res.body);
  assert.equal(rec.query, 'Au core BiVO4 shell photocatalyst');
  assert.equal(rec.manifest.records.length, 2);
  assert.equal(rec.manifest.records[0].doi, '10.1/a');
});

test('GET /v1/literature/searches/:id 404s for unknown and malformed ids', async () => {
  assert.equal((await request('/v1/literature/searches/nope')).status, 404);
  assert.equal((await request('/v1/literature/searches/..%2F..%2Fetc')).status, 404);
});

test('GET /v1/full-tasks/:id falls back to disk when the run is not in memory', async () => {
  const res = await request('/v1/full-tasks/full-done-1');
  assert.equal(res.status, 200);
  const run = JSON.parse(res.body);
  assert.equal(run.status, 'completed');
  // userPrompt 必须透出（面板重开时的标题/抓取提示），完整模板 prompt 仍然不返回
  assert.match(run.userPrompt, /arXiv\.1706\.03762/);
  assert.equal(run.prompt, undefined);
  assert.equal(run.download.path, 'literature/downloaded-pdfs/x.pdf');
});

test('disk-fallback marks a stale running record as interrupted instead of lying', async () => {
  const res = await request('/v1/full-tasks/full-run-1');
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).status, 'interrupted');
});

test('GET /v1/full-tasks/:id still 404s for truly unknown ids', async () => {
  assert.equal((await request('/v1/full-tasks/never-existed')).status, 404);
});
