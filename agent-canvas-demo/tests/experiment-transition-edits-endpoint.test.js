"use strict";
// 2026-08-27 发布冲刺项2验收发现的真实缺口：/v1/edits/experiment-transition/
// {preview,commit} 此前只有 tests/scholarium-bridge-endpoints.test.js 对
// server.js 源码做静态字符串匹配（有没有 dryRun:true / confirmed:true 这些
// 关键字），从没有真正起一个 Bridge 进程、对一份真实的 Experiment 记录走一
// 遍 preview -> commit，确认磁盘上的文件真的按预期变了、重复提交真的被拒、
// commit 真的是基于磁盘最新状态重新校验（而不是照抄 preview 时缓存的 plan）。
// 这份测试补的就是这一层，风格照抄 drafts-batch-vault-validation.test.js /
// drafts-batch-production-topology.test.js：起一个真实子进程 + 真实 HTTP。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness.js');

const repoRoot = path.resolve(__dirname, '..', '..');
const schemaObjects = require(path.join(repoRoot, 'tools', 'schema-objects.js'));
const experimentStore = require(path.join(repoRoot, 'tools', 'experiment-store.js'));

const TOKEN = 'exp-transition-edits-' + process.pid;
// Each launch() gets its own Bridge on an OS-assigned port. This file used to
// hand out ports from `let nextPort = 47700 + (process.pid % 200)`, a counter
// that verified nothing. The map keyed by the reported port keeps the existing
// request(port, ...) call sites and the one-Bridge-per-test shape unchanged.
const bridges = new Map();

function request(port, pathname, options = {}) {
  return bridges.get(port).request(pathname, options)
    .then((res) => ({ status: res.status, body: res.text }));
}



// Builds a real, schema-v1-valid Experiment note directly on disk (via the
// same schema-objects.js the server itself validates against), independent
// of the /v1/drafts/batch channel — this test is about the edit channel, not
// about how the record originally got there.
function writeExperiment(vault, status) {
  const object = schemaObjects.createObject('experiment', {
    project_uid: '01919c7a-0001-7abc-89ab-1234567890ab',
    title: 'live transition fixture',
    status,
    data_origin: 'planned',
    // schema-objects.js's experiment-specific validateObject block (added to
    // guard against a real defect where legacy data-origin claims went
    // unattributed) requires data_recorded_by/data_recorded_at whenever
    // data_origin is set at all, not only for measured/imported data.
    // data_recorded_by must literally be "user" — an Agent may never declare
    // where data came from.
    data_recorded_by: 'user',
    data_recorded_at: '2026-08-27T00:00:00Z',
  }, { uid: '01919c7a-0002-7abc-89ab-1234567890ab', display_id: 'EXP-001' });
  const file = path.join(vault, 'Research', 'Experiments', 'EXP-001.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, schemaObjects.serializeObject(object, '# fixture\n'), 'utf8');
  return { object, file };
}

function readStatus(file) {
  const { object } = schemaObjects.parseObject(fs.readFileSync(file, 'utf8'));
  return object;
}

function writeCanonicalPlanExperiment(vault) {
  const object = schemaObjects.createObject('experiment', {
    project_uid: '01919c7a-0001-7abc-89ab-1234567890ab',
    title: 'plan edit fixture', status: 'designed',
    result: '### 产率\n\n记录值 81%。', conclusion: '保留当前结论。',
    data_origin: 'measured', raw_data_refs: ['raw/run.csv'],
    data_provenance_note: '研究者登记的原始数据。', data_recorded_by: 'user',
    data_recorded_at: '2026-09-12T00:00:00Z',
  }, { uid: '01919c7a-0010-7abc-89ab-1234567890ab', display_id: 'EXP-010' });
  const body = experimentStore.bodyFor(object, '### 旧步骤\n\n1. 旧方案。');
  const file = path.join(vault, 'Research', 'Experiments', 'EXP-010.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, schemaObjects.serializeObject(object, body), 'utf8');
  return { object, file };
}

function writeProvenanceGraph(vault) {
  const now = '2026-09-09T00:00:00.000Z';
  const ids = {
    project: '019fef48-5be0-786b-8da5-39a220613712',
    hypothesis: '019fef48-5be1-79a0-82ad-2770965f8be4',
    experiment: '019fef48-5be2-7e08-90af-b24d6d796866',
    evidence: '019fef48-5be3-7163-96ef-e4c61a51dbe5',
  };
  const objects = [
    ['Projects/PRJ-001.md', schemaObjects.createObject('project', {
      title: 'provenance endpoint fixture', status: 'active',
    }, { now, uid: ids.project, display_id: 'PRJ-001' })],
    ['Hypotheses/HYP-001.md', schemaObjects.createObject('hypothesis', {
      project_uid: ids.project, statement: 'formal relation must be withdrawn',
      supporting_evidence: [ids.evidence],
    }, { now, uid: ids.hypothesis, display_id: 'HYP-001' })],
    ['Experiments/EXP-001.md', schemaObjects.createObject('experiment', {
      project_uid: ids.project, title: 'historically integrated fixture', status: 'integrated',
      result: 'recorded result', conclusion: 'historical conclusion', produced_evidence: [ids.evidence],
      data_origin: 'measured', raw_data_refs: ['raw/run.csv'],
      data_provenance_note: 'old declaration', data_recorded_by: 'user', data_recorded_at: now,
    }, { now, uid: ids.experiment, display_id: 'EXP-001' })],
    ['Evidence/EVD-001.md', schemaObjects.createObject('evidence', {
      claim: 'historical result supports target', source_type: 'experiment', source_uid: ids.experiment,
      target_uid: ids.hypothesis, relation: 'SUPPORTS', created_by: 'user',
      verified_by_user: true, review_status: 'confirmed', verified_at: now,
      quote: 'recorded result', anchor_region: 'experiment_result',
      locator: { source_sha256: 'a'.repeat(64), anchor: 'r0001', quote_hash: 'b'.repeat(32), original_url: 'scholarium://experiment/' + ids.experiment },
    }, { now, uid: ids.evidence, display_id: 'EVD-001' })],
  ];
  for (const [relative, object] of objects) {
    const file = path.join(vault, 'Research', ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, schemaObjects.serializeObject(object, '# fixture\n'), 'utf8');
  }
  return ids;
}

async function launch(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'exp-transition-edits-'));
  const vault = path.join(temp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const harness = await startBridge({
    token: TOKEN,
    config: {
      workspaceRoot: vault, allowedRoots: [vault], adapters: {},
      // allowedActions 刻意留空数组：experiment.transition 走 /v1/edits，不经
      // scholarium.allowedActions 那张队列白名单，这本身就是要验证的行为之一
      // （见 scholarium-bridge-endpoints.test.js 的 "is not folded into
      // scholarium.allowedActions" 静态测试）。
      scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
    },
  });
  bridges.set(harness.port, harness);
  t.after(() => {
    harness.stop();
    bridges.delete(harness.port);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return { port: harness.port, vault };
}

test('legacy note edit is explicit-confirmation-only, atomic, and refuses a stale whole-note replacement', async (t) => {
  const { port, vault } = await launch(t);
  const relativePath = 'Experiments/FTO.md';
  const file = path.join(vault, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# FTO\n\n电解质：0.5 M Na₂SO₄ + 1% 乙醇\n', 'utf8');
  const next = '# FTO\n\n电解质：0.5 M Na₂SO₄\n';
  const changes = [{ location: '电解质', before: '电解质：0.5 M Na₂SO₄ + 1% 乙醇', after: '电解质：0.5 M Na₂SO₄' }];

  const denied = await request(port, '/v1/legacy-note-edits/preview', {
    method: 'POST', body: JSON.stringify({ path: relativePath, content: next, reason: '移除乙醇牺牲剂', changes }),
  });
  assert.equal(denied.status, 403, denied.body);

  const preview = await request(port, '/v1/legacy-note-edits/preview', {
    method: 'POST', headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({ path: relativePath, content: next, reason: '移除乙醇牺牲剂', changes }),
  });
  assert.equal(preview.status, 201, preview.body);
  const planned = JSON.parse(preview.body);
  assert.equal(planned.action, 'legacy.note_edit');
  assert.equal(fs.readFileSync(file, 'utf8'), '# FTO\n\n电解质：0.5 M Na₂SO₄ + 1% 乙醇\n', 'preview must not write');

  fs.writeFileSync(file, '# FTO\n\n研究者刚刚手动更新了此记录。\n', 'utf8');
  const stale = await request(port, `/v1/edits/${planned.id}/commit`, {
    method: 'POST', headers: { 'x-scholarium-user-confirmed': 'true' }, body: '{}',
  });
  assert.equal(stale.status, 409, stale.body);
  assert.match(stale.body, /changed after preview/i);
  assert.match(fs.readFileSync(file, 'utf8'), /研究者刚刚手动更新/);

  const refreshed = '# FTO\n\n研究者刚刚手动更新了此记录。\n\n电解质：0.5 M Na₂SO₄\n';
  const freshChanges = [{ location: '电解质', before: '研究者刚刚手动更新了此记录。', after: '研究者刚刚手动更新了此记录。\n\n电解质：0.5 M Na₂SO₄' }];
  const fresh = await request(port, '/v1/legacy-note-edits/preview', {
    method: 'POST', headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({ path: relativePath, content: refreshed, reason: '保留研究者并发更新后移除乙醇牺牲剂', changes: freshChanges }),
  });
  assert.equal(fresh.status, 201, fresh.body);
  const committed = await request(port, `/v1/edits/${JSON.parse(fresh.body).id}/commit`, {
    method: 'POST', headers: { 'x-scholarium-user-confirmed': 'true' }, body: '{}',
  });
  assert.equal(committed.status, 200, committed.body);
  assert.equal(JSON.parse(committed.body).result.path, relativePath);
  assert.equal(fs.readFileSync(file, 'utf8'), refreshed);
});

test('legacy note edit rejects Research schema paths even with explicit confirmation', async (t) => {
  const { port, vault } = await launch(t);
  const protectedFile = path.join(vault, 'Research', 'Experiments', 'EXP-001.md');
  fs.mkdirSync(path.dirname(protectedFile), { recursive: true });
  fs.writeFileSync(protectedFile, '# protected\n', 'utf8');
  const response = await request(port, '/v1/legacy-note-edits/preview', {
    method: 'POST', headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({ path: 'Research/Experiments/EXP-001.md', content: '# replaced\n', reason: 'attempt bypass', changes: [{ location: 'test', before: '# protected', after: '# replaced' }] }),
  });
  assert.equal(response.status, 400, response.body);
  assert.match(response.body, /restricted to Experiments/i);
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), '# protected\n');
});

test('legacy note edit rejects review rows that do not match the current or proposed note', async (t) => {
  const { port, vault } = await launch(t);
  const relativePath = 'Experiments/FTO.md';
  const file = path.join(vault, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# FTO\n\n电解质：0.5 M Na₂SO₄ + 1% 乙醇\n', 'utf8');
  const bad = await request(port, '/v1/legacy-note-edits/preview', {
    method: 'POST', headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({ path: relativePath, content: '# FTO\n\n电解质：0.5 M Na₂SO₄\n', reason: 'test', changes: [{ location: '电解质', before: '不存在的原文', after: '电解质：0.5 M Na₂SO₄' }] }),
  });
  assert.equal(bad.status, 409, bad.body);
  assert.match(bad.body, /review row no longer matches/i);
  assert.match(fs.readFileSync(file, 'utf8'), /1% 乙醇/);
});

test('preview computes the plan without writing; commit actually advances the on-disk status and appends status_history', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');

  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'ready', reason: '设计已确认，可以进入准备阶段' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const previewBody = JSON.parse(preview.body);
  assert.equal(previewBody.plan.from, 'designed');
  assert.equal(previewBody.plan.to, 'ready');
  assert.equal(previewBody.plan.noop, false);

  // Preview must be a pure dry-run: the file on disk is untouched so far.
  assert.equal(readStatus(file).status, 'designed');

  const commit = await request(port, `/v1/edits/${previewBody.id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  const commitBody = JSON.parse(commit.body);
  assert.equal(commitBody.result.from, 'designed');
  assert.equal(commitBody.result.to, 'ready');

  const after = readStatus(file);
  assert.equal(after.status, 'ready');
  assert.ok(Array.isArray(after.status_history) && after.status_history.length === 1, 'status_history must record the transition');
  assert.equal(after.status_history[0].from, 'designed');
  assert.equal(after.status_history[0].to, 'ready');
  assert.equal(after.status_history[0].reason, '设计已确认，可以进入准备阶段');
  assert.equal(after.status_history[0].by, 'weaver-chat-confirmed');
});

test('explicit manual transition records user as actor and ignores a forged input.by', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');
  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({
      experiment_uid: object.uid, to_status: 'ready', reason: '研究者从看板确认推进', by: 'forged-agent-label',
    }),
  });
  assert.equal(preview.status, 201, preview.body);
  assert.equal(JSON.parse(preview.body).actor, 'user');
  const commit = await request(port, `/v1/edits/${JSON.parse(preview.body).id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  assert.equal(readStatus(file).status_history[0].by, 'user');
});

test('plan edit requires an explicit confirmation marker and changes only the canonical plan section', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeCanonicalPlanExperiment(vault);
  const before = fs.readFileSync(file, 'utf8');
  const beforeBody = schemaObjects.parseObject(before).body;
  const protectedSuffix = beforeBody.slice(beforeBody.indexOf('## 数据来源'));
  const payload = JSON.stringify({
    experiment_uid: object.uid,
    plan_markdown: '### 新步骤\n\n1. 只修改实验方案。',
  });

  const refused = await request(port, '/v1/edits/experiment-plan/preview', { method: 'POST', body: payload });
  assert.equal(refused.status, 403, refused.body);

  const preview = await request(port, '/v1/edits/experiment-plan/preview', {
    method: 'POST', body: payload, headers: { 'x-scholarium-user-confirmed': 'true' },
  });
  assert.equal(preview.status, 201, preview.body);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'preview must remain pure');

  const planned = JSON.parse(preview.body);
  const commit = await request(port, `/v1/edits/${planned.id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  const after = fs.readFileSync(file, 'utf8');
  const afterBody = schemaObjects.parseObject(after).body;
  assert.match(afterBody, /### 新步骤\n\n1\. 只修改实验方案。/);
  assert.equal(afterBody.slice(afterBody.indexOf('## 数据来源')), protectedSuffix,
    'provenance, result and conclusion bytes must remain identical');
  assert.deepEqual(experimentStore.resultBlocks(afterBody), experimentStore.resultBlocks(beforeBody));
});

test('plan edit rejects every undeclared field instead of silently discarding lifecycle, result or provenance input', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeCanonicalPlanExperiment(vault);
  const before = fs.readFileSync(file, 'utf8');
  const preview = await request(port, '/v1/edits/experiment-plan/preview', {
    method: 'POST',
    headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({
      experiment_uid: object.uid, plan_markdown: 'new plan',
      status: 'integrated', result: 'invented', data_origin: 'measured',
    }),
  });
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /accepts only.*status.*result.*data_origin/i);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('plan edit rejects oversized content instead of silently truncating it', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeCanonicalPlanExperiment(vault);
  const before = fs.readFileSync(file, 'utf8');
  const preview = await request(port, '/v1/edits/experiment-plan/preview', {
    method: 'POST',
    headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({ experiment_uid: object.uid, plan_markdown: 'x'.repeat(120001) }),
  });
  assert.equal(preview.status, 413, preview.body);
  assert.match(JSON.parse(preview.body).error, /120000 character limit/i);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('plan edit commit refuses a stale preview after any concurrent file change', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeCanonicalPlanExperiment(vault);
  const preview = await request(port, '/v1/edits/experiment-plan/preview', {
    method: 'POST',
    headers: { 'x-scholarium-user-confirmed': 'true' },
    body: JSON.stringify({ experiment_uid: object.uid, plan_markdown: '### 新方案\n\n内容。' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const id = JSON.parse(preview.body).id;
  fs.appendFileSync(file, '\n研究者并发备注。\n', 'utf8');
  const concurrent = fs.readFileSync(file, 'utf8');

  const commit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 409, commit.body);
  assert.match(JSON.parse(commit.body).error, /changed after preview/i);
  assert.equal(fs.readFileSync(file, 'utf8'), concurrent, 'stale commit must not overwrite concurrent work');
});

test('committing the same preview id a second time is rejected — the edit preview is consumed on first success', async (t) => {
  const { port, vault } = await launch(t);
  const { object } = writeExperiment(vault, 'designed');

  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'ready', reason: 'first confirm' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const { id } = JSON.parse(preview.body);

  const firstCommit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(firstCommit.status, 200, firstCommit.body);

  const secondCommit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(secondCommit.status, 404, secondCommit.body);
  assert.match(JSON.parse(secondCommit.body).error, /edit preview not found or expired/);
});

test('committing an id that was never previewed is rejected the same way (no way to forge a commit without a real preview)', async (t) => {
  const { port } = await launch(t);
  const res = await request(port, '/v1/edits/never-previewed-id/commit', { method: 'POST', body: '{}' });
  assert.equal(res.status, 404, res.body);
  assert.match(JSON.parse(res.body).error, /edit preview not found or expired/);
});

test('preview rejects a multi-step jump before anything is written, and the file stays untouched', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');

  // designed -> running skips over "ready"; experiment-workflow.js's NEXT map
  // only allows one lifecycle step at a time.
  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'running', reason: 'skip ahead' }),
  });
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /invalid_experiment_transition/);
  assert.equal(readStatus(file).status, 'designed');
});

test('commit re-derives the transition from the current on-disk status, not the plan cached at preview time', async (t) => {
  const { port, vault } = await launch(t);
  const { object, file } = writeExperiment(vault, 'designed');

  const preview = await request(port, '/v1/edits/experiment-transition/preview', {
    method: 'POST',
    body: JSON.stringify({ experiment_uid: object.uid, to_status: 'ready', reason: '准备阶段' }),
  });
  assert.equal(preview.status, 201, preview.body);
  const { id } = JSON.parse(preview.body);

  // Simulate the record having already been advanced to "ready" by some
  // other confirmed action between preview and commit (e.g. a second click,
  // or a concurrent session). If commit blindly replayed the preview's
  // cached { from: 'designed', to: 'ready' } plan, this would either silently
  // overwrite an already-current status_history or misreport the transition.
  const current = readStatus(file);
  fs.writeFileSync(file, schemaObjects.serializeObject({ ...current, status: 'ready' }, '# fixture\n'), 'utf8');

  const commit = await request(port, `/v1/edits/${id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  const commitBody = JSON.parse(commit.body);
  // transitionPlan() sees from === to on the freshly re-read record and
  // reports a noop, proving commit re-read the disk rather than trusting the
  // preview's stale snapshot.
  assert.equal(commitBody.result.noop, true);
  assert.equal(commitBody.result.from, 'ready');
});

test('provenance invalidation preview is pure and commit withdraws the entire graph with a recovery snapshot', async (t) => {
  const { port, vault } = await launch(t);
  const ids = writeProvenanceGraph(vault);
  const preview = await request(port, '/v1/edits/provenance-invalidation/preview', {
    method: 'POST',
    body: JSON.stringify({
      experiment_uid: ids.experiment,
      data_origin: 'simulated',
      reason: '研究者确认数值来自模拟常量',
      data_provenance_note: '已核对生成脚本和输入依赖，没有独立原始数据。',
    }),
  });
  assert.equal(preview.status, 201, preview.body);
  const planned = JSON.parse(preview.body);
  assert.equal(planned.plan.mode, 'dry_run');
  assert.deepEqual(planned.plan.evidence_uids, [ids.evidence]);
  assert.equal(schemaObjects.readVaultObjects(vault).find((e) => e.object.uid === ids.experiment).object.status, 'integrated');

  const commit = await request(port, `/v1/edits/${planned.id}/commit`, { method: 'POST', body: '{}' });
  assert.equal(commit.status, 200, commit.body);
  const result = JSON.parse(commit.body).result;
  assert.equal(result.mode, 'committed');
  assert.equal(result.from_status, 'integrated');
  assert.equal(result.to_status, 'invalidated');
  const byUid = new Map(schemaObjects.readVaultObjects(vault).map((entry) => [entry.object.uid, entry.object]));
  assert.equal(byUid.get(ids.experiment).status, 'invalidated');
  assert.equal(byUid.get(ids.evidence).review_status, 'demonstration');
  assert.deepEqual(byUid.get(ids.hypothesis).supporting_evidence, []);
  assert.deepEqual(schemaObjects.validateVault(vault).problems, []);
  assert.equal(fs.existsSync(path.join(vault, ...result.recovery_path.split('/'))), true);
});

// True 15-minute TTL expiry (DRAFT_TTL_MS, shared with /v1/drafts/batch) is
// not exercised live here with a real wait, for the same reason none of the
// other TTL-bound preview/commit channels in this suite (drafts batch, full
// tasks, idea promotion) do either: 15 minutes is too slow for a test run,
// and this codebase has no test-only clock override. The `Date.parse(...) <=
// Date.now()` check and its ordering relative to the not-found check are
// covered by static analysis in scholarium-bridge-endpoints.test.js ("commit
// checks the preview exists and has not expired before running anything").
// This file instead exercises the reachable, real-time part of the same
// contract: a *consumed* preview (the practical everyday case — a duplicate
// click) is rejected with the identical "not found or expired" response, via
// the same code path a genuinely expired id would take.
