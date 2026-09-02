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
async function waitForServer() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const response = await request('/bridge/health'); if (response.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('local launcher did not start');
}

test.before(async () => {
  launcher = spawn(process.execPath, ['start-local.js'], { cwd: root, env: { ...process.env, AGENT_CANVAS_PORT: String(canvasPort), AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath }, stdio: 'ignore', windowsHide: true });
  await waitForServer();
});
test.after(() => {
  if (launcher && !launcher.killed) launcher.kill();
  if (fs.existsSync(configPath)) fs.rmSync(configPath);
});

test('local launcher serves the canvas and injects Bridge authentication', async () => {
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
