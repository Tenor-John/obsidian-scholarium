"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../../tools/schema-objects.js');
const { startBridge } = require('./helpers/bridge-harness.js');

let harness, workspace, topicDir;
const request = (pathname, options = {}) => harness.request(pathname, {
  method: options.method, body: options.body, auth: options.noAuth ? false : undefined,
}).then((res) => ({ ...res, payload: JSON.parse(res.text || '{}') }));

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
  writeIdea('IDEA-001'); writeIdea('IDEA-002', 'shelved');
  harness = await startBridge({
    config: {
      // The fixture Vault stays separate from harness scratch. The topic is
      // the task workspace; schema-v1 promotion is scoped to the Vault root.
      workspaceRoot: topicDir, allowedRoots: [topicDir], adapters: {},
      scholarium: { enabled: true, vaultRoot: workspace, allowedActions: ['idea.list', 'project.list', 'project.get'] },
    },
  });
});

test.after(() => {
  if (harness) harness.stop();
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
});

test('promotion preview is read-only and exposes PRJ/profile paths', async () => {
  const res = await request('/v1/ideas/IDEA-001/promote/preview', {
    method: 'POST', body: { profile: { research_question: '界面如何影响载流子？', success_criteria: '得到可重复的因果证据。' } },
  });
  assert.equal(res.status, 201);
  assert.equal(res.payload.project.display_id, 'PRJ-001');
  assert.equal(res.payload.profile.profile_version, 0);
  assert.equal(fs.existsSync(path.join(workspace, res.payload.paths.project)), false);
  assert.equal(fs.existsSync(path.join(workspace, res.payload.paths.profile)), false);
});

test('commit atomically creates Project/profile and backfills the Idea, then replays idempotently', async () => {
  const preview = await request('/v1/ideas/IDEA-001/promote/preview', {
    method: 'POST', body: { profile: { research_question: '界面如何影响载流子？', success_criteria: '得到可重复的因果证据。' } },
  });
  const committed = await request('/v1/ideas/IDEA-001/promote/commit', {
    method: 'POST', body: { previewId: preview.payload.id },
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
    method: 'POST', body: { previewId: preview.payload.id },
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.idempotent, true);
  const again = await request('/v1/ideas/IDEA-001/promote/preview', { method: 'POST', body: {} });
  assert.equal(again.status, 200);
  assert.equal(again.payload.alreadyPromoted, true);
  assert.equal(again.payload.project_display_id, 'PRJ-001');
});

test('shelved Ideas cannot be promoted until reopened', async () => {
  const res = await request('/v1/ideas/IDEA-002/promote/preview', { method: 'POST', body: {} });
  assert.equal(res.status, 409);
  assert.match(res.payload.error, /reopened/);
});

test('commit refuses a source Idea changed after preview and writes no project', async () => {
  writeIdea('IDEA-003');
  const preview = await request('/v1/ideas/IDEA-003/promote/preview', { method: 'POST', body: {} });
  const ideaPath = path.join(workspace, 'Research', 'Ideas', 'IDEA-003 test.md');
  fs.appendFileSync(ideaPath, '\nresearcher edit\n', 'utf8');
  const res = await request('/v1/ideas/IDEA-003/promote/commit', {
    method: 'POST', body: { previewId: preview.payload.id },
  });
  assert.equal(res.status, 409);
  assert.equal(fs.existsSync(path.join(workspace, preview.payload.paths.project)), false);
});
