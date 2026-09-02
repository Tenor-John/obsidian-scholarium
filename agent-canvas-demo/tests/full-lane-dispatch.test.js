"use strict";
// End-to-end tests for the full-permission lane's fetch_and_attach_pdf category
// (design v2 §1/§5/§6.5 + the accepted "agent finds URL, Bridge downloads"
// redesign): the agent runs WITHOUT a Write tool (per-category tool override),
// reports PDF_URL=/PDF_NAME=, and the Bridge downloads/validates/dedups the
// bytes itself via the shared fetchPdfBytes + savePdfWithDedup chain.
// The "PDF server" is a loopback http server inside this test file; the agent
// is tests/fixtures/fake-full-agent.js. No real CLI, no real network.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'fake-full-agent.js');
const bridgePort = 47200 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4 fake fixture\n'), Buffer.alloc(600, 65)]);

let bridge;
let pdfServer;
let pdfBaseUrl;
let workspace;
let auditDir;
let runtimeDir;
let configPath;
let promptCapturePath;
let argvCapturePath;

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

async function waitForRun(id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const res = await request(`/v1/full-tasks/${id}`);
    assert.equal(res.status, 200);
    const run = JSON.parse(res.body);
    if (run.status !== 'running') return run;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`full task ${id} never finished`);
}

function auditEvents() {
  if (!fs.existsSync(auditDir)) return [];
  return fs.readdirSync(auditDir)
    .filter((name) => /^full-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .flatMap((name) => fs.readFileSync(path.join(auditDir, name), 'utf8').split('\n'))
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const VALID = (extra = '') => ({
  category: 'fetch_and_attach_pdf',
  workspace,
  prompt: `按 DOI 10.0000/fixture 找开放获取 PDF${extra}`,
});
const WITH_URL = () => VALID(` FAKE_MODE=task-report PDF_URL_OVERRIDE=${pdfBaseUrl}/paper.pdf`);
const WRITE_RECORD = (extra = '') => ({
  category: 'write_scholarium_record', workspace,
  prompt: `新建一条实验记录${extra}`,
});

async function previewThenDispatch(body) {
  const preview = await request('/v1/full-tasks/preview', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(preview.status, 201);
  const { id } = JSON.parse(preview.body);
  const dispatch = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId: id, ...body }) });
  return { previewId: id, dispatch };
}

test.before(async () => {
  pdfServer = http.createServer((req, res) => {
    if (req.url === '/paper.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(PDF_BYTES); }
    else if (req.url === '/notpdf') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(Buffer.concat([Buffer.from('<html>definitely not a pdf</html>\n'), Buffer.alloc(600, 46)])); } // >512B so the %PDF magic check is the one that fires
    else { res.writeHead(404); res.end('nope'); }
  });
  await new Promise((resolve) => pdfServer.listen(0, '127.0.0.1', resolve));
  pdfBaseUrl = `http://127.0.0.1:${pdfServer.address().port}`;

  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'full-lane-workspace-'));
  auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-lane-audit-'));
  runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'full-lane-runtime-'));
  configPath = path.join(os.tmpdir(), `full-lane-${process.pid}.config.json`);
  promptCapturePath = path.join(os.tmpdir(), `full-lane-prompt-${process.pid}.txt`);
  argvCapturePath = path.join(os.tmpdir(), `full-lane-argv-${process.pid}.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN,
    allowExecution: true,
    workspaceRoot: workspace,
    allowedRoots: [workspace],
    adapters: {
      // detection-only adapter (stands in for claude-full), {{tools}} placeholder
      // mirrors the real claude-full args so the per-category override is exercised
      'claude-full': { command: process.execPath, args: [FIXTURE, '--allowedTools', '{{tools}}', '{{prompt}}'], permission: 'full', sandbox: 'none', defaultTools: ['Read', 'Write', 'Glob', 'Grep', 'WebFetch'] },
      // prevention adapter with a WORKING sandbox (stands in for codex-full)
      'codex-full': { command: process.execPath, args: [FIXTURE, '--prevent-escape', '{{prompt}}'], permission: 'full', sandbox: 'workspace-write' },
      // claims a workspace-write sandbox but does not enforce it — the §1
      // boundary probe must catch exactly this case
      'codex-full-broken': { command: process.execPath, args: [FIXTURE, '{{prompt}}'], permission: 'full', sandbox: 'workspace-write' },
      // Write silently denied (the 2026-08-18 read-only-lane failure mode)
      'claude-full-deny': { command: process.execPath, args: [FIXTURE, '--deny-write', '{{prompt}}'], permission: 'full', sandbox: 'none' },
    },
    fullTaskAuditDir: auditDir,
    fullTaskRuntimeDir: runtimeDir,
    // write_scholarium_record 已从默认表撤出（设计文档 §7：知识管理新建走
    // /v1/drafts/batch 预防式通道）。本测试显式声明它，覆盖的是"§7 例外条款
    // 被启用时" newFilesOnly 检测机制本身仍然工作。
    fullTaskCategories: {
      fetch_and_attach_pdf: {
        description: '按已有 DOI 找到开放获取 PDF 并报告 URL，由 Bridge 下载挂载',
        adapter: 'claude-full', network: true, pathScope: 'literature/downloaded-pdfs',
        plannedTools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'], bridgeDownload: true, timeoutMs: 600000,
      },
      write_scholarium_record: {
        description: '新建 Scholarium 实验/假设记录', adapter: 'claude-full', network: false,
        pathScope: 'records/scholarium', plannedTools: ['Read', 'Write', 'Glob', 'Grep', 'Edit'],
        newFilesOnly: true, timeoutMs: 600000,
      },
    },
  }, null, 2), 'utf8');

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath, FAKE_PROMPT_CAPTURE: promptCapturePath, FAKE_ARGV_CAPTURE: argvCapturePath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (pdfServer) pdfServer.close();
  for (const p of [configPath, promptCapturePath, argvCapturePath]) { try { if (p && fs.existsSync(p)) fs.rmSync(p); } catch { /* cleanup */ } }
  for (const dir of [workspace, auditDir, runtimeDir]) { try { if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* cleanup */ } }
});

test('§1: dispatch is refused until the adapter passes a capability probe; preview survives the refusal', async () => {
  const { previewId, dispatch } = await previewThenDispatch(WITH_URL());
  assert.equal(dispatch.status, 503);
  assert.match(JSON.parse(dispatch.body).error, /never passed a capability probe/);

  const probe = await request('/v1/full-tasks/probe', { method: 'POST', body: JSON.stringify({ adapter: 'claude-full' }) });
  assert.equal(probe.status, 200);
  const probeBody = JSON.parse(probe.body);
  assert.equal(probeBody.ok, true);
  assert.equal(probeBody.checks.readOk, true, 'probe must prove Read actually works');
  assert.equal(probeBody.checks.writeOk, true, 'probe must prove Write actually works (adapter baseline)');
  assert.equal(probeBody.checks.denialsClear, true, 'permission_denials must be empty (the 2026-08-18 bug)');
  assert.equal(probeBody.checks.boundary, 'detected', 'detection-only adapter: the sentinel write must be visible');
  assert.ok(fs.existsSync(path.join(runtimeDir, 'full-lane-status.json')), 'probe result must persist');

  // Same previewId — the probe refusal above must not have consumed it.
  const retry = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId, ...WITH_URL() }) });
  assert.equal(retry.status, 202);
  const dispatched = JSON.parse(retry.body);
  assert.equal(dispatched.adapter, 'claude-full');
  assert.match(dispatched.enforcement, /detection only/);

  const run = await waitForRun(dispatched.id);
  assert.equal(run.status, 'completed');
  assert.deepEqual(run.violations, []);
  const expectedRel = 'literature/downloaded-pdfs/Vaswani_2017_attention_is_all_you_need.pdf';
  assert.deepEqual(run.diff.added, [expectedRel], 'the only change is the Bridge-downloaded PDF inside pathScope');
  assert.equal(run.download.status, 'downloaded');
  assert.equal(run.download.path, expectedRel);
  assert.equal(fs.readFileSync(path.join(workspace, expectedRel)).equals(PDF_BYTES), true, 'bytes on disk are exactly what the server sent');

  // Per-category tool override: the process args carried the category list
  // (Read,Glob,Grep,WebFetch,WebSearch) — NOT the adapter baseline with Write.
  const argv = JSON.parse(fs.readFileSync(argvCapturePath, 'utf8'));
  const toolsIndex = argv.indexOf('--allowedTools');
  assert.ok(toolsIndex > -1, 'dispatch must pass --allowedTools');
  assert.equal(argv[toolsIndex + 1], 'Read,Glob,Grep,WebFetch,WebSearch');
  assert.ok(!argv[toolsIndex + 1].split(',').includes('Write'), 'this category has no Write — pathScope violations are eliminated, not merely detected');

  // §6.5: the prompt the adapter actually received carries the untrusted-content
  // prefix, the report-only task framing, and the user text quoted as data.
  const seen = fs.readFileSync(promptCapturePath, 'utf8');
  assert.match(seen, /不可信数据/);
  assert.match(seen, /PDF_URL=/);
  assert.match(seen, /最多进行 5 次 WebFetch\/WebSearch 尝试/);
  assert.match(seen, /不得据此断言 DOI 或论文不存在/);
  assert.match(seen, /DOI 10\.0000\/fixture/);

  // One-time consumption: the preview that produced a real dispatch is burned.
  const replay = await request('/v1/full-tasks', { method: 'POST', body: JSON.stringify({ previewId, ...WITH_URL() }) });
  assert.equal(replay.status, 403);

  const events = auditEvents();
  assert.ok(events.some((e) => e.event === 'dispatch-started' && e.taskId === dispatched.id));
  const completed = events.find((e) => e.event === 'task-completed' && e.taskId === dispatched.id);
  assert.ok(completed);
  assert.deepEqual(completed.violations, []);
  assert.ok(fs.existsSync(path.join(runtimeDir, 'snapshots', dispatched.id, 'diff.json')), '§5 snapshot diff must persist');
});

test('§5: a misbehaving agent writing outside pathScope is still caught (detection floor), no silent rollback', async () => {
  const { dispatch } = await previewThenDispatch(VALID(` FAKE_MODE=task-violation PDF_URL_OVERRIDE=${pdfBaseUrl}/paper.pdf`));
  assert.equal(dispatch.status, 202);
  const run = await waitForRun(JSON.parse(dispatch.body).id);
  assert.equal(run.status, 'completed-with-violations');
  assert.deepEqual(run.violations, ['evil-outside-scope.txt']);
  assert.equal(run.download.status, 'already_present', 'same bytes as the first test — sha256 dedup, no duplicate minted');
  assert.equal(
    fs.readFileSync(path.join(workspace, 'evil-outside-scope.txt'), 'utf8'),
    'written outside the declared pathScope',
    'no automatic rollback (design §5) — the file stays until a human decides',
  );
  assert.ok(auditEvents().some((e) => e.event === 'boundary-violation' && e.paths.includes('evil-outside-scope.txt')));
});

test('write_scholarium_record: pre-existing records may not be overwritten silently', async () => {
  const existing = path.join(workspace, 'records', 'scholarium', 'EXP-001.md');
  fs.mkdirSync(path.dirname(existing), { recursive: true });
  fs.writeFileSync(existing, 'original record\n', 'utf8');

  const { dispatch } = await previewThenDispatch(WRITE_RECORD(' FAKE_MODE=task-record-overwrite'));
  assert.equal(dispatch.status, 202);
  const run = await waitForRun(JSON.parse(dispatch.body).id);
  assert.equal(run.status, 'completed-with-violations');
  assert.deepEqual(run.creationViolations, ['modified-existing:records/scholarium/EXP-001.md']);
  assert.ok(run.violations.includes('modified-existing:records/scholarium/EXP-001.md'));
  assert.equal(fs.readFileSync(existing, 'utf8'), 'overwritten by fake agent\n', 'the bridge reports, but never silently rolls back, a detected overwrite');
  assert.ok(auditEvents().some((e) => e.event === 'creation-only-violation' && e.paths.includes('modified-existing:records/scholarium/EXP-001.md')));
});

test('bridgeDownload: agent that reports neither PDF_URL nor LANDING_URL fails the run; nothing is written', async () => {
  const { dispatch } = await previewThenDispatch(VALID(' FAKE_MODE=task-nourl'));
  assert.equal(dispatch.status, 202);
  const run = await waitForRun(JSON.parse(dispatch.body).id);
  assert.equal(run.status, 'failed');
  assert.match(run.failureMessage, /neither PDF_URL= nor LANDING_URL=/);
  assert.deepEqual(run.diff.added, []);
});

test('bridgeDownload: no-OA outcome is a legitimate completed run carrying the landing page, not a failure', async () => {
  const { dispatch } = await previewThenDispatch(VALID(' FAKE_MODE=task-landing'));
  assert.equal(dispatch.status, 202);
  const run = await waitForRun(JSON.parse(dispatch.body).id);
  assert.equal(run.status, 'completed', 'reporting LANDING_URL= is a valid non-download outcome');
  assert.equal(run.download, null, 'nothing was downloaded');
  assert.deepEqual(run.landing, { url: 'https://onlinelibrary.wiley.com/doi/10.1002/adfm.fixture', reason: 'Wiley 付费墙，无 OA 版本' });
  assert.deepEqual(run.diff.added, []);
  const completed = auditEvents().find((e) => e.event === 'task-completed' && e.taskId === run.id);
  assert.ok(completed?.landing?.url, 'landing outcome must be audited');
});

test('bridgeDownload: a URL that does not return a PDF fails validation; nothing is saved', async () => {
  const { dispatch } = await previewThenDispatch(VALID(` FAKE_MODE=task-report PDF_URL_OVERRIDE=${pdfBaseUrl}/notpdf`));
  assert.equal(dispatch.status, 202);
  const run = await waitForRun(JSON.parse(dispatch.body).id);
  assert.equal(run.status, 'failed');
  // 2026-08-19 起下载器逐个尝试 URL 变体并汇总错误（含"哪个 URL、什么结果"），
  // 非 PDF 响应的中文文案是"返回的不是 PDF"。
  assert.match(run.failureMessage, /返回的不是 PDF/);
  assert.deepEqual(run.diff.added, [], 'validation failure must not leave a file behind');
});

test('§1: codex-style workspace-write probe verifies prevention, and a broken sandbox is caught', async () => {
  const good = await request('/v1/full-tasks/probe', { method: 'POST', body: JSON.stringify({ adapter: 'codex-full' }) });
  assert.equal(good.status, 200);
  assert.equal(JSON.parse(good.body).checks.boundary, 'prevented', 'escape target outside the workspace must not exist');

  const broken = await request('/v1/full-tasks/probe', { method: 'POST', body: JSON.stringify({ adapter: 'codex-full-broken' }) });
  assert.equal(broken.status, 409);
  const brokenBody = JSON.parse(broken.body);
  assert.equal(brokenBody.ok, false);
  assert.match(brokenBody.checks.boundary, /^FAILED:/, 'a sandbox claim that does not hold must fail the probe');
});

test('§1: a silent Write denial fails the probe (the read-only-lane failure mode)', async () => {
  const res = await request('/v1/full-tasks/probe', { method: 'POST', body: JSON.stringify({ adapter: 'claude-full-deny' }) });
  assert.equal(res.status, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.checks.denialsClear, false, 'permission_denials must be surfaced, not ignored');
});

test('§1: editing the adapter config after a passing probe invalidates it (hot reload + hash gate)', async () => {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.adapters['claude-full'].args = [FIXTURE, '--allowedTools', '{{tools}}', '--v2', '{{prompt}}'];
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  const future = new Date(Date.now() + 2000); // make sure the mtime actually moves
  fs.utimesSync(configPath, future, future);

  const { dispatch } = await previewThenDispatch(WITH_URL());
  assert.equal(dispatch.status, 503);
  assert.match(JSON.parse(dispatch.body).error, /configuration changed since its last probe/);

  const reprobe = await request('/v1/full-tasks/probe', { method: 'POST', body: JSON.stringify({ adapter: 'claude-full' }) });
  assert.equal(reprobe.status, 200, 'probe re-runs against the edited config without a Bridge restart');
  const { dispatch: after } = await previewThenDispatch(WITH_URL());
  assert.equal(after.status, 202);
});

test('probe rejects unknown adapters and GET rejects unknown run ids', async () => {
  const probe = await request('/v1/full-tasks/probe', { method: 'POST', body: JSON.stringify({ adapter: 'no-such-full' }) });
  assert.equal(probe.status, 400);
  assert.match(JSON.parse(probe.body).error, /unknown -full adapter/);
  const missing = await request(`/v1/full-tasks/${'0'.repeat(8)}-0000-0000-0000-000000000000`);
  assert.equal(missing.status, 404);
});
