"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../../tools/schema-objects.js');

const root = path.resolve(__dirname, '..');
const port = 46900 + (process.pid % 300);
const TOKEN = 'promotion-test-' + process.pid;
let bridge, workspace, topicDir, configPath, secretsPath;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { 'content-type': 'application/json' } : {};
    if (!options.noAuth) headers['x-agent-bridge-token'] = TOKEN;
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: options.method || 'GET', headers }, (res) => {
      let raw = ''; res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, payload: JSON.parse(raw || '{}') }));
    });
    req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}

async function waitForBridge() {
  for (let i = 0; i < 40; i++) {
    try { if ((await request('/health', { noAuth: true })).status === 200) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('bridge did not start');
}

function writeIdea(id, status = 'exploring') {
  const now = '2026-08-20T08:00:00.000Z';
  const object = S.createObject('idea', {
    title: 'Au/CeO2 光催化', status, summary: '研究金属载体相互作用。',
    hotspots: ['界面电荷转移'], gaps: ['缺少原位证据'], key_papers: ['10.1000/test'], promoted_to: '',
  }, { now, display_id: id, uid: S.uuidV7(Date.parse(now)) });
  const target = path.join(workspace, 'Research', 'Ideas', `${id} test.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, S.serializeObject(object, '\n# Idea\n'), 'utf8');
  return target;
}

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'idea-promotion-'));
  topicDir = path.join(workspace, 'TopicSubfolder');
  fs.mkdirSync(topicDir, { recursive: true });
  configPath = path.join(workspace, 'bridge.config.json');
  secretsPath = path.join(workspace, 'bridge.env');
  fs.writeFileSync(configPath, JSON.stringify({
    // The real topology puts the full-lane workspace in one topic below the
    // vault. Promotion remains a controlled schema-v1 vault operation.
    token: TOKEN, allowExecution: false, workspaceRoot: topicDir, allowedRoots: [topicDir], adapters: {},
    scholarium: { enabled: true, vaultRoot: workspace, allowedActions: ['idea.list', 'project.list', 'project.get'] },
  }), 'utf8');
  writeIdea('IDEA-001'); writeIdea('IDEA-002', 'shelved');
  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root, env: { ...process.env, AGENT_BRIDGE_PORT: String(port), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_SECRETS_PATH: secretsPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
});

test('promotion preview is read-only and exposes PRJ/profile paths', async () => {
  const res = await request('/v1/ideas/IDEA-001/promote/preview', {
    method: 'POST', body: JSON.stringify({ profile: { research_question: '界面如何影响载流子？', success_criteria: '得到可重复的因果证据。' } }),
  });
  assert.equal(res.status, 201);
  assert.equal(res.payload.project.display_id, 'PRJ-001');
  assert.equal(res.payload.profile.profile_version, 0);
  assert.equal(fs.existsSync(path.join(workspace, res.payload.paths.project)), false);
  assert.equal(fs.existsSync(path.join(workspace, res.payload.paths.profile)), false);
});

test('commit atomically creates Project/profile and backfills the Idea, then replays idempotently', async () => {
  const preview = await request('/v1/ideas/IDEA-001/promote/preview', {
    method: 'POST', body: JSON.stringify({ profile: { research_question: '界面如何影响载流子？', success_criteria: '得到可重复的因果证据。' } }),
  });
  const committed = await request('/v1/ideas/IDEA-001/promote/commit', {
    method: 'POST', body: JSON.stringify({ previewId: preview.payload.id }),
  });
  assert.equal(committed.status, 200);
  const projectFile = path.join(workspace, committed.payload.paths.projectPath);
  const profileFile = path.join(workspace, committed.payload.paths.profilePath);
  assert.equal(fs.existsSync(projectFile), true);
  assert.equal(fs.existsSync(profileFile), true);
  const project = S.parseObject(fs.readFileSync(projectFile, 'utf8')).object;
  assert.equal(project.type, 'project');
  assert.equal(project.display_id, 'PRJ-001');
  assert.equal(project.profile_version, 0);
  const idea = S.parseObject(fs.readFileSync(path.join(workspace, 'Research', 'Ideas', 'IDEA-001 test.md'), 'utf8')).object;
  assert.equal(idea.status, 'promoted');
  assert.equal(idea.promoted_to, 'PRJ-001');
  const replay = await request('/v1/ideas/IDEA-001/promote/commit', {
    method: 'POST', body: JSON.stringify({ previewId: preview.payload.id }),
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.idempotent, true);
  const again = await request('/v1/ideas/IDEA-001/promote/preview', { method: 'POST', body: '{}' });
  assert.equal(again.status, 200);
  assert.equal(again.payload.alreadyPromoted, true);
  assert.equal(again.payload.project_display_id, 'PRJ-001');
});

test('shelved Ideas cannot be promoted until reopened', async () => {
  const res = await request('/v1/ideas/IDEA-002/promote/preview', { method: 'POST', body: '{}' });
  assert.equal(res.status, 409);
  assert.match(res.payload.error, /reopened/);
});

test('commit refuses a source Idea changed after preview and writes no project', async () => {
  writeIdea('IDEA-003');
  const preview = await request('/v1/ideas/IDEA-003/promote/preview', { method: 'POST', body: '{}' });
  const ideaPath = path.join(workspace, 'Research', 'Ideas', 'IDEA-003 test.md');
  fs.appendFileSync(ideaPath, '\nresearcher edit\n', 'utf8');
  const res = await request('/v1/ideas/IDEA-003/promote/commit', {
    method: 'POST', body: JSON.stringify({ previewId: preview.payload.id }),
  });
  assert.equal(res.status, 409);
  assert.equal(fs.existsSync(path.join(workspace, preview.payload.paths.project)), false);
});
