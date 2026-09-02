const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const canvasPort = 45100 + (process.pid % 300);
const bridgePort = canvasPort + 400;
// The real bridge.config.json on this machine points workspaceRoot at the
// researcher's live Obsidian vault (not at this project directory), so a
// test process reading it would validate paths against the vault and write
// (or fail to find) files there instead of under `root`. Point the spawned
// Bridge at a disposable config file instead: with no file at this path yet,
// server.js's loadConfig() falls back to its built-in default, which sets
// workspaceRoot to the Bridge's own project root — exactly `root` above.
const configPath = path.join(os.tmpdir(), `agent-canvas-bridge-test-${process.pid}.config.json`);
let launcher;
let launcherExit = null; // set to { code, signal } once the process has exited
const launcherStderr = [];
const STDERR_TAIL_LINES = 40;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: canvasPort, path: pathname, method: options.method || 'GET', headers: options.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(options.body) } : {} }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Assembled on demand (readiness failures and, for the one test most exposed
// to it below, request failures too) so a bare "504 !== 200" never has to be
// debugged blind: shows whether the Bridge process is even still alive, and
// its own stderr, not just the HTTP status the launcher's proxy timeout
// produced.
function launcherDiagnostics() {
  const state = launcherExit
    ? `bridge/launcher process exited (code=${launcherExit.code}, signal=${launcherExit.signal})`
    : `bridge/launcher process still running (pid ${launcher && launcher.pid})`;
  const tail = launcherStderr.slice(-STDERR_TAIL_LINES).join('\n') || '(no stderr captured)';
  return `${state}\n--- launcher/bridge stderr (last ${STDERR_TAIL_LINES} lines) ---\n${tail}`;
}

// `/bridge/health` (bridge/server.js) is a cheap, synchronous handler that
// answers as soon as the HTTP server is listening. `/bridge/v1/diagnostics`
// is not: it calls resolveCommand() per configured agent adapter, which
// shells out to `where.exe`/`which` via spawnSync — real, blocking work that
// this test's own first request also depends on (`payload.agents`). Waiting
// only for /health used to declare the launcher "ready" before diagnostics
// had ever been asked to do that work once, so the first diagnostics call in
// the test body could still be a cold call, racing start-local.js's own
// SHORT_BRIDGE_TIMEOUT_MS (15s) as if it were a readiness check. Poll both
// endpoints here instead, with bounded retries, and only proceed once both
// have actually answered 200 — a real readiness probe for what the test is
// about to exercise, not a fixed sleep-then-assume.
async function waitForServer() {
  const deadline = Date.now() + 30000;
  let lastFailure = 'no attempt made yet';
  while (Date.now() < deadline) {
    if (launcherExit) {
      throw new Error(`Bridge/launcher exited before becoming ready.\n${launcherDiagnostics()}`);
    }
    try {
      const health = await request('/bridge/health');
      if (health.status !== 200) {
        lastFailure = `GET /bridge/health -> ${health.status}: ${health.body.slice(0, 300)}`;
      } else {
        const diagnostics = await request('/bridge/v1/diagnostics');
        if (diagnostics.status === 200) return;
        lastFailure = `GET /bridge/v1/diagnostics -> ${diagnostics.status}: ${diagnostics.body.slice(0, 300)}`;
      }
    } catch (error) {
      lastFailure = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`local launcher did not become ready within 30s.\nLast probe: ${lastFailure}\n${launcherDiagnostics()}`);
}

test.before(async () => {
  launcher = spawn(process.execPath, ['start-local.js'], {
    cwd: root,
    env: { ...process.env, AGENT_CANVAS_PORT: String(canvasPort), AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  launcher.stderr.setEncoding('utf8');
  launcher.stderr.on('data', (chunk) => {
    for (const line of chunk.split(/\r?\n/)) if (line) launcherStderr.push(line);
  });
  launcher.on('exit', (code, signal) => { launcherExit = { code, signal }; });
  await waitForServer();
});
test.after(() => {
  if (launcher && !launcher.killed) launcher.kill();
  if (fs.existsSync(configPath)) fs.rmSync(configPath);
});

test('local launcher serves the canvas and injects Bridge authentication', async () => {
  try {
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(page.body, /Research Weaver/);

    const diagnostics = await request('/bridge/v1/diagnostics');
    assert.equal(diagnostics.status, 200);
    const payload = JSON.parse(diagnostics.body);
    assert.equal(typeof payload.executionEnabled, 'boolean');
    assert.equal(typeof payload.workspace.root, 'string');
    assert.ok(payload.agents.every((agent) => ['command_detected', 'missing'].includes(agent.readiness)));

    const skills = await request('/bridge/v1/skills');
    assert.equal(skills.status, 200);
    assert.ok(Array.isArray(JSON.parse(skills.body).skills));
  } catch (error) {
    // This specific test is the one most exposed to the diagnostics
    // endpoint's spawnSync-driven variability (see waitForServer above), so
    // give it the same failure diagnostics rather than a bare assertion.
    error.message = `${error.message}\n${launcherDiagnostics()}`;
    throw error;
  }
});

test('long-running literature search is not assigned the 15-second proxy timeout', () => {
  const launcherSource = fs.readFileSync(path.join(root, 'start-local.js'), 'utf8');
  assert.match(launcherSource, /tasks\|literature\\\/search/);
  assert.match(launcherSource, /isLongBridgeRequest \? LONG_BRIDGE_TIMEOUT_MS/);
});

test('workspace endpoint rejects unsafe paths, but can explicitly create a fresh topic folder', async () => {
  const response = await request('/bridge/v1/workspace', { method: 'PUT', body: JSON.stringify({ root: 'not-an-absolute-path' }) });
  assert.equal(response.status, 400);
  assert.match(JSON.parse(response.body).error, /absolute local path/);

  const fresh = path.join(root, `workspace-created-by-test-${process.pid}`);
  try {
    const created = await request('/bridge/v1/workspace', { method: 'PUT', body: JSON.stringify({ root: fresh, createMissing: true }) });
    assert.equal(created.status, 200);
    assert.equal(JSON.parse(created.body).root, fresh);
    assert.ok(fs.statSync(fresh).isDirectory());
    const restored = await request('/bridge/v1/workspace', { method: 'PUT', body: JSON.stringify({ root }) });
    assert.equal(restored.status, 200);
  } finally {
    if (fs.existsSync(fresh)) fs.rmSync(fresh, { recursive: true, force: true });
  }
});

test('source inventory is an allow-listed read-only executable Skill', async () => {
  const skillList = await request('/bridge/v1/skills');
  const inventory = JSON.parse(skillList.body).skills.find((skill) => skill.name === 'research-source-inventory');
  assert.ok(inventory, 'the local inventory Skill should be discoverable');
  const run = await request('/bridge/v1/skills/run', { method: 'POST', body: JSON.stringify({ skillId: inventory.id, workspace: root }) });
  assert.equal(run.status, 200);
  const payload = JSON.parse(run.body);
  assert.equal(payload.skill.name, 'research-source-inventory');
  assert.equal(typeof payload.manifest.no_scientific_sources_found, 'boolean');
  assert.ok(Array.isArray(payload.manifest.candidate_evidence));
});

test('query builder produces an unexecuted, reproducible search manifest', async () => {
  const skillList = await request('/bridge/v1/skills');
  const builder = JSON.parse(skillList.body).skills.find((skill) => skill.name === 'research-query-builder');
  assert.ok(builder, 'the local query builder Skill should be discoverable');
  const run = await request('/bridge/v1/skills/run', { method: 'POST', body: JSON.stringify({ skillId: builder.id, workspace: root, input: 'Au nanoparticles on semiconductors for visible-light CO2 reduction' }) });
  assert.equal(run.status, 200);
  const manifest = JSON.parse(run.body).manifest;
  assert.match(manifest.query_v0, /Au|gold/i);
  assert.match(manifest.query_v0, /CO2 reduction/i);
  assert.equal(manifest.database_status, 'database-neutral draft; not executed');
});

test('research question coach is discoverable as a local conversational Skill', async () => {
  const skillList = await request('/bridge/v1/skills');
  const coach = JSON.parse(skillList.body).skills.find((skill) => skill.name === 'research-question-coach');
  assert.ok(coach, 'the research question coach should be discoverable');
  assert.match(coach.description, /falsifiable research question/i);
});

test('draft notes require a fresh preview and never overwrite an existing note', async () => {
  const relativePath = `agent-output/bridge-draft-${process.pid}.md`;
  const target = path.join(root, relativePath);
  try {
    const created = await request('/bridge/v1/drafts', { method: 'POST', body: JSON.stringify({ path: relativePath, content: '# 保真 Markdown\n\n| a | b |\n| --- | --- |\n| 1 | 2 |' }) });
    assert.equal(created.status, 201);
    const draft = JSON.parse(created.body);
    assert.ok(draft.expiresAt);
    const committed = await request(`/bridge/v1/drafts/${draft.id}/commit`, { method: 'POST' });
    assert.equal(committed.status, 200);
    assert.match(fs.readFileSync(target, 'utf8'), /\| a \| b \|/);

    const duplicate = await request('/bridge/v1/drafts', { method: 'POST', body: JSON.stringify({ path: relativePath, content: 'replacement' }) });
    assert.equal(duplicate.status, 409);
  } finally {
    if (fs.existsSync(target)) fs.rmSync(target);
  }
});

test('final workflow stage is required to synthesize a decision report, not concatenate stages', () => {
  const client = fs.readFileSync(path.join(root, 'bridge-ui.js'), 'utf8');
  assert.match(client, /function finalSynthesisProtocol/);
  assert.match(client, /统一证据矩阵/);
  assert.match(client, /停止条件/);
  assert.match(client, /audit-appendix/);
  assert.match(client, /reportQualityGate/);
  assert.match(client, /function finalAcceptance/);
  assert.match(client, /function repairFinalReport/);
  assert.match(client, /function executeSkillNode/);
  assert.match(client, /open-access-download/);
  assert.match(client, /本机 Skill 已实际执行/);
  assert.match(client, /最终验收：未通过，禁止写入笔记/);
});

test('bridge converts quota diagnostics into a safe, actionable retry message', () => {
  const server = fs.readFileSync(path.join(root, 'bridge', 'server.js'), 'utf8');
  assert.match(server, /function actionableFailure/);
  assert.match(server, /Codex 使用额度已耗尽/);
  assert.match(server, /stderr: undefined/);
  assert.match(server, /diagnostics: undefined/);
  assert.match(server, /task\.failureMessage/);
  assert.match(server, /余额或账单不可用/);
  const client = fs.readFileSync(path.join(root, 'bridge-ui.js'), 'utf8');
  assert.match(client, /partial-run/);
  assert.match(client, /未生成最终综合报告/);
  assert.match(client, /function runnableProfile/);
  assert.match(client, /科研论单 Agent 模式/);
  assert.match(client, /科研论主 Agent/);
  assert.match(client, /const upstream = outputs\.slice\(-4\)/);
});
