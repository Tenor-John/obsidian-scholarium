"use strict";
// Real end-to-end tests for the M2 batch-draft pair: POST /v1/drafts/batch
// (preview N files) and POST /v1/drafts/batch/:id/commit (all-or-nothing
// write). Spawns the actual Bridge against a disposable config + temp
// workspace, same pattern as tests/scholarium-state-endpoint.test.js, so
// this proves the routes work over real HTTP against a real filesystem —
// not just that the handler function exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startBridge } = require('./helpers/bridge-harness.js');

let harness, workspace, auditDir;
const request = (pathname, options = {}) => harness.request(pathname, {
  method: options.method, body: options.body, auth: options.noAuth ? false : undefined,
}).then((res) => ({ ...res, body: res.text }));

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-batch-workspace-'));
  harness = await startBridge({
    config: { workspaceRoot: workspace, allowedRoots: [workspace], adapters: {} },
    env: (scratch) => { auditDir = path.join(scratch, 'audit'); return { AGENT_BRIDGE_AUDIT_DIR: auditDir }; },
  });
});

test.after(() => {
  if (harness) harness.stop();
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
});

function itemsFor(n, prefix) {
  return Array.from({ length: n }, (_, i) => ({ path: `Research/Hypotheses/${prefix}-${i}.md`, content: `# ${prefix}-${i}\n\nbody ${i}` }));
}

test('rejects a batch preview without the bridge token', async () => {
  const res = await request('/v1/drafts/batch', { method: 'POST', noAuth: true, body: JSON.stringify({ items: itemsFor(1, 'noauth') }) });
  assert.equal(res.status, 401);
});

test('previews and commits a multi-file batch atomically', async () => {
  const items = itemsFor(3, 'happy');
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items }) });
  assert.equal(preview.status, 201);
  const batch = JSON.parse(preview.body);
  assert.equal(batch.items.length, 3);
  assert.ok(batch.id);
  assert.ok(batch.expiresAt);
  for (const item of items) assert.equal(fs.existsSync(path.join(workspace, item.path)), false, 'preview must not touch disk');

  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200);
  const committed = JSON.parse(commit.body);
  assert.equal(committed.items.length, 3);
  for (const item of items) {
    const onDisk = fs.readFileSync(path.join(workspace, item.path), 'utf8');
    assert.equal(onDisk, item.content);
  }

  const recommit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(recommit.status, 404, 'a committed batch must not be replayable');
});

test('rejects an empty batch and a batch over the item cap', async () => {
  const empty = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items: [] }) });
  assert.equal(empty.status, 400);

  const tooMany = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items: itemsFor(41, 'cap') }) });
  assert.equal(tooMany.status, 400);
  assert.match(JSON.parse(tooMany.body).error, /limited to/);
});

test('rejects duplicate paths, non-.md paths and traversal within one batch', async () => {
  const dup = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items: [{ path: 'a.md', content: 'x' }, { path: 'a.md', content: 'y' }] }) });
  assert.equal(dup.status, 400);
  assert.match(JSON.parse(dup.body).error, /duplicate path/);

  const notMd = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items: [{ path: 'a.txt', content: 'x' }] }) });
  assert.equal(notMd.status, 400);

  const traversal = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items: [{ path: '../escape.md', content: 'x' }] }) });
  assert.equal(traversal.status, 400);
});

test('preview refuses the whole batch if any single target already exists on disk', async () => {
  const dir = path.join(workspace, 'Research', 'Hypotheses');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'preexisting.md'), 'already here', 'utf8');
  try {
    const res = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({
      items: [{ path: 'Research/Hypotheses/fresh.md', content: 'new' }, { path: 'Research/Hypotheses/preexisting.md', content: 'clobber' }],
    }) });
    assert.equal(res.status, 409);
    assert.equal(fs.existsSync(path.join(workspace, 'Research/Hypotheses/fresh.md')), false, 'no file from a rejected batch should be written');
  } finally {
    fs.rmSync(path.join(dir, 'preexisting.md'), { force: true });
  }
});

test('commit is all-or-nothing: a target created after preview aborts the whole batch and writes nothing', async () => {
  const items = itemsFor(3, 'race');
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items }) });
  assert.equal(preview.status, 201);
  const batch = JSON.parse(preview.body);

  // Simulate a race: something else creates one of the batch's targets
  // between preview and commit.
  const clashPath = path.join(workspace, items[1].path);
  fs.mkdirSync(path.dirname(clashPath), { recursive: true });
  fs.writeFileSync(clashPath, 'raced in', 'utf8');
  try {
    const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
    assert.equal(commit.status, 409);
    // Neither of the other two files should have been written either — the
    // whole batch must abort, not just the clashing item.
    assert.equal(fs.existsSync(path.join(workspace, items[0].path)), false);
    assert.equal(fs.existsSync(path.join(workspace, items[2].path)), false);
    assert.equal(fs.readFileSync(clashPath, 'utf8'), 'raced in', 'the file that raced in must be untouched');
  } finally {
    fs.rmSync(clashPath, { force: true });
  }
});

test('committing an unknown batch id returns 404', async () => {
  const res = await request('/v1/drafts/batch/does-not-exist/commit', { method: 'POST' });
  assert.equal(res.status, 404);
});

// Drafts-lane audit trail (added 2026-08-22): drafts/batch is the default and
// only channel for knowledge-management writes since write_scholarium_record
// was retired from the full lane (design §7), so its previews, commits and
// rejections must leave an append-only trail in drafts-YYYY-MM-DD.jsonl —
// separate from full-*.jsonl because the two lanes have different enforcement
// levels (preventive vs detective) and must never mix in one file.
function auditLines() {
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `drafts-${day}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('drafts lane audit records preview-created, commit-succeeded and rejections with sourceTaskId', async () => {
  const before = auditLines().length;

  // 1. success path: preview-created then commit-succeeded, both carrying sourceTaskId
  const items = itemsFor(2, 'audit');
  const preview = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items, sourceTaskId: 'task-abc-123' }) });
  assert.equal(preview.status, 201);
  const batch = JSON.parse(preview.body);
  const commit = await request(`/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200);

  // 2. 409 conflict: preview-rejected recorded, nothing written
  const clashDir = path.join(workspace, 'Research', 'Hypotheses');
  fs.writeFileSync(path.join(clashDir, 'audit-clash.md'), 'already here', 'utf8');
  const conflict = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({
    items: [{ path: 'Research/Hypotheses/audit-clash.md', content: 'clobber' }], sourceTaskId: 'task-evil',
  }) });
  assert.equal(conflict.status, 409);

  // 3. 400 illegal path: preview-rejected recorded
  const illegal = await request('/v1/drafts/batch', { method: 'POST', body: JSON.stringify({ items: [{ path: '../escape.md', content: 'x' }] }) });
  assert.equal(illegal.status, 400);

  const lines = auditLines().slice(before);
  const events = lines.map((l) => l.event);
  assert.ok(events.includes('preview-created'), `missing preview-created in ${events.join(',')}`);
  assert.ok(events.includes('commit-succeeded'), `missing commit-succeeded in ${events.join(',')}`);
  assert.equal(events.filter((e) => e === 'preview-rejected').length, 2, 'both the 409 and the 400 must be audited');

  const created = lines.find((l) => l.event === 'preview-created');
  assert.equal(created.sourceTaskId, 'task-abc-123');
  assert.equal(created.provider.trust, 'untrusted', 'unknown source task must fail closed instead of being labelled official');
  assert.deepEqual(created.paths, items.map((i) => i.path));
  assert.equal(created.batchId, batch.id);

  const succeeded = lines.find((l) => l.event === 'commit-succeeded');
  assert.equal(succeeded.batchId, batch.id);
  assert.equal(succeeded.sourceTaskId, 'task-abc-123');
  assert.equal(succeeded.provider.trust, 'untrusted');
  assert.deepEqual(succeeded.paths, items.map((i) => i.path));

  const rejected = lines.filter((l) => l.event === 'preview-rejected');
  assert.ok(rejected.some((l) => l.sourceTaskId === 'task-evil' && /already exists/.test(l.reason)));
  assert.ok(rejected.some((l) => /relative \.md path/.test(l.reason)));

  // audit files must never leak into the workspace itself
  assert.equal(fs.existsSync(path.join(workspace, 'audit')), false);
});

test('chat-turn audit records parser attempts and confirmation state without trusting browser provider metadata', async () => {
  const payload = {
    event: 'parsed', taskId: 'missing-task-for-audit', flowId: 'flow-1', replyLength: 321,
    blocks: {
      action: { attempted: 2, parsed: 1 }, draft: { attempted: 1, parsed: 0 },
      legacyNoteEdit: { attempted: 1, parsed: 1 },
      run: { attempted: 0, parsed: 0 }, normalize: { attempted: 1, parsed: 1 },
      plot: { attempted: 1, parsed: 1 }, plotRevision: { attempted: 1, parsed: 0 },
      suggestReconstruction: { attempted: 0, parsed: 0 },
    },
    renderedCards: 1,
    cardStates: { action: 'pending', draft: 'none', legacyNoteEdit: 'pending', run: 'none', normalize: 'confirmed', plot: 'pending', plotRevision: 'none', suggestReconstruction: 'none' },
    writeClaim: '已添加',
    provider: { trust: 'official-provider', label: 'forged in browser' },
  };
  const response = await request('/v1/chat-turns/audit', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(response.status, 202, response.body);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `chat-turns-${day}.jsonl`);
  const entry = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(entry.event, 'parsed');
  assert.equal(entry.taskId, payload.taskId);
  assert.deepEqual(entry.blocks.action, { attempted: 2, parsed: 1, rejected: 1 });
  assert.deepEqual(entry.blocks.draft, { attempted: 1, parsed: 0, rejected: 1 });
  assert.deepEqual(entry.blocks.legacyNoteEdit, { attempted: 1, parsed: 1, rejected: 0 });
  assert.deepEqual(entry.blocks.normalize, { attempted: 1, parsed: 1, rejected: 0 });
  assert.deepEqual(entry.blocks.plot, { attempted: 1, parsed: 1, rejected: 0 });
  assert.deepEqual(entry.blocks.plotRevision, { attempted: 1, parsed: 0, rejected: 1 });
  assert.equal(entry.cardStates.action, 'pending');
  assert.equal(entry.cardStates.legacyNoteEdit, 'pending');
  assert.equal(entry.cardStates.plot, 'pending');
  assert.equal(entry.provider.trust, 'untrusted');
  assert.notEqual(entry.provider.label, 'forged in browser');
});

test('chat-turn audit records the bounded final Skill recipe after researcher confirmation', async () => {
  const payload = {
    event: 'skill-submission', taskId: 'missing-task-for-submission-audit', flowId: 'flow-plot',
    blocks: { plotRevision: { attempted: 1, parsed: 1 } },
    cardStates: { plotRevision: 'confirmed' },
    submission: {
      kind: 'plotRevision', skill: 'sch-data-plot',
      input: {
        data_path: 'Materials/plot.csv', x_column: 'Time (min)', y_columns: ['Signal A', 'RatioPct'],
        plot_kind: 'line', save_mode: 'new', target_manifest_path: 'Materials/_analysis/a/plot-manifest.json',
        chart_style: { theme: 'dark', line_width: 3, legend: 'right' },
      },
    },
  };
  const response = await request('/v1/chat-turns/audit', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(response.status, 202, response.body);
  const day = new Date().toISOString().slice(0, 10);
  const file = path.join(auditDir, `chat-turns-${day}.jsonl`);
  const entry = fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse).at(-1);
  assert.equal(entry.event, 'skill-submission');
  assert.equal(entry.cardStates.plotRevision, 'confirmed');
  assert.deepEqual(entry.submission, { kind: 'plotRevision', skill: 'sch-data-plot', input: payload.submission.input });
});
