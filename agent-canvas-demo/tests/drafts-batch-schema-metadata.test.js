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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const schema = require('../../tools/schema-objects.js');
const { startBridge } = require('./helpers/bridge-harness.js');

const TOKEN = 'schema-metadata-' + process.pid;
// Each launch() gets its own Bridge on an OS-assigned port. This file used to
// hand out ports from `let nextPort = 47500 + (process.pid % 200)`, a counter
// that verified nothing and shared its base with other files.
const bridges = new Map();

function request(port, pathname, options = {}) {
  const harness = bridges.get(port);
  return harness.request(pathname, options).then((res) => ({ status: res.status, body: res.text }));
}

async function launch(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-schema-metadata-'));
  const vault = path.join(temp, 'vault');
  fs.mkdirSync(vault, { recursive: true });
  const auditPath = path.join(temp, 'audit');
  if (Array.isArray(options.idAllocations) && options.idAllocations.length) {
    fs.mkdirSync(auditPath, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(auditPath, `id-allocations-${day}.jsonl`), JSON.stringify({
      ts: new Date().toISOString(), event: 'reserved', allocations: options.idAllocations,
    }) + '\n', 'utf8');
  }
  const harness = await startBridge({
    token: TOKEN,
    config: {
      workspaceRoot: vault, allowedRoots: [vault], adapters: {},
      scholarium: { enabled: true, vaultRoot: vault, allowedActions: [] },
    },
    env: { AGENT_BRIDGE_AUDIT_DIR: auditPath },
  });
  bridges.set(harness.port, harness);
  t.after(() => {
    harness.stop();
    bridges.delete(harness.port);
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return { port: harness.port, vault };
}

async function previewAndCommit(port, items, options = {}) {
  const payload = {
    base: 'scholarium-vault',
    serverManagedMetadata: true,
    items,
  };
  if (options.projectDisplayId) payload.projectDisplayId = options.projectDisplayId;
  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify(payload),
  });
  if (preview.status !== 201) return { preview };
  const batch = JSON.parse(preview.body);
  const commit = await request(port, `/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  return { preview, commit, batch };
}

function seedProject(vault, displayId = 'PRJ-002') {
  const uid = schema.uuidV7();
  const now = new Date().toISOString();
  const content = schema.serializeObject({
    type: 'project', uid, display_id: displayId, schema_version: 1,
    title: '测试课题', status: 'active', created_at: now, updated_at: now,
  }, '');
  const target = path.join(vault, 'Research', 'Projects', `${displayId} 测试课题.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return uid;
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
  seedProject(vault);
  const content = ['---', ...VALID_DECISION_FRONTMATTER, '---', 'body'].join('\n');
  const { preview, commit, batch } = await previewAndCommit(port, [{ path: 'Research/Decisions/DEC-999.md', content }], { projectDisplayId: 'PRJ-002' });
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, batch.items[0].path), 'utf8');
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
  const { preview, commit, batch } = await previewAndCommit(port, [{ path: 'Research/Lessons/LES-999.md', content }]);
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, batch.items[0].path), 'utf8');
  assert.match(written, /created_at: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(written, /updated_at: "?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('a server-managed decision replaces caller lifecycle, review and timestamp authority', async (t) => {
  const { port, vault } = await launch(t);
  seedProject(vault);
  const content = ['---', ...VALID_DECISION_FRONTMATTER,
    'status: resolved', 'review_status: confirmed', 'verified_by_user: true',
    'verified_at: 2020-01-03T00:00:00Z',
    'created_at: 2020-01-01T00:00:00Z', 'updated_at: 2020-01-02T00:00:00Z',
    '---', 'body'].join('\n');
  const { preview, commit, batch } = await previewAndCommit(port, [{ path: 'Research/Experiments/wrong-folder.md', content }], { projectDisplayId: 'PRJ-002' });
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const object = schema.parseObject(fs.readFileSync(path.join(vault, batch.items[0].path), 'utf8')).object;
  assert.notEqual(object.created_at, '2020-01-01T00:00:00Z');
  assert.notEqual(object.updated_at, '2020-01-02T00:00:00Z');
  assert.match(object.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(object.status, 'active');
  assert.equal(object.review_status, 'pending');
  assert.equal(object.verified_by_user, false);
  assert.equal(object.verified_at, undefined);
  assert.match(batch.items[0].path, /^Research\/Decisions\/DEC-\d+/);
});

test('a decision draft missing a genuinely required field (rationale) is rejected before anything is written', async (t) => {
  const { port, vault } = await launch(t);
  seedProject(vault);
  const incomplete = VALID_DECISION_FRONTMATTER.filter((line) => !line.startsWith('rationale:'));
  const content = ['---', ...incomplete, '---', 'body'].join('\n');
  const { preview } = await previewAndCommit(port, [{ path: 'Research/Decisions/DEC-999.md', content }], { projectDisplayId: 'PRJ-002' });
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

test('a server-managed EXP draft strips caller provenance instead of accepting an AI researcher claim', async (t) => {
  const { port, vault } = await launch(t);
  seedProject(vault);
  const content = ['---', ...EXP_FRONTMATTER_NO_PROVENANCE, 'data_origin: planned', '---', 'body'].join('\n');
  const { preview, commit, batch } = await previewAndCommit(port, [{ path: 'Research/Experiments/EXP-999.md', content }], { projectDisplayId: 'PRJ-002' });
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, batch.items[0].path), 'utf8');
  assert.doesNotMatch(written, /data_origin:|data_recorded_by:|data_recorded_at:/);
});

test('manual schema preview requires an explicit UI confirmation marker and remains provenance-safe', async (t) => {
  const { port, vault } = await launch(t);
  seedProject(vault);
  const payload = JSON.stringify({
    base: 'scholarium-vault', serverManagedMetadata: true, projectDisplayId: 'PRJ-002',
    items: [{ path: 'provisional.md', content: [
      '---', 'type: experiment', 'title: 手动创建契约',
      'data_origin: measured', 'data_recorded_by: user',
      'verified_by_user: true', '---', '手动填写的实验方案。',
    ].join('\n') }],
  });
  const refused = await request(port, '/v1/manual-drafts/batch', { method: 'POST', body: payload });
  assert.equal(refused.status, 403, refused.body);

  const preview = await request(port, '/v1/manual-drafts/batch', {
    method: 'POST', body: payload, headers: { 'x-scholarium-user-confirmed': 'true' },
  });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  const object = schema.parseObject(batch.items[0].content).object;
  assert.equal(object.created_by, 'user');
  assert.equal(object.review_status, 'pending');
  assert.equal(object.verified_by_user, false);
  assert.equal(object.data_origin, undefined);
  assert.equal(object.data_recorded_by, undefined);
  assert.equal(object.data_recorded_at, undefined);
  assert.ok(batch.items[0].path.startsWith('Research/Experiments/EXP-'));

  const commit = await request(port, `/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);
  const written = schema.parseObject(fs.readFileSync(path.join(vault, batch.items[0].path), 'utf8')).object;
  assert.equal(written.created_by, 'user');
  assert.equal(written.data_origin, undefined);
});

test('one server-managed batch canonicalizes every registered schema-v1 object type', async (t) => {
  const { port, vault } = await launch(t);
  const projectUid = seedProject(vault);
  const fakeUid = '01919c7a-1111-7abc-89ab-1234567890ab';
  const callerClaims = [
    `uid: ${fakeUid}`,
    'display_id: WRONG-999',
    'schema_version: 1',
    'created_at: 2020-01-01T00:00:00Z',
    'updated_at: 2020-01-02T00:00:00Z',
    'created_by: user',
    'review_status: confirmed',
    'verified_by_user: true',
    'verified_at: 2020-01-03T00:00:00Z',
  ];
  const note = (type, fields, body = '') => [
    '---', `type: ${type}`, ...callerClaims, ...fields, '---', body,
  ].join('\n');
  const items = [
    { ref: 'project', path: 'wrong/project.md', content: note('project', ['title: 新课题']) },
    { ref: 'question', path: 'wrong/question.md', content: note('question', ['statement: 问题是什么？']) },
    { ref: 'hypothesis', path: 'wrong/hypothesis.md', content: note('hypothesis', ['statement: 一个可证伪假设']) },
    { ref: 'paper', path: 'wrong/paper.md', content: note('paper', ['title: 一篇论文', 'source: https://doi.org/10.1000/test']) },
    { ref: 'experiment', path: 'wrong/experiment.md', content: note('experiment', [
      'title: 一个实验', 'data_origin: measured', 'data_recorded_by: user',
      'data_recorded_at: 2020-01-04T00:00:00Z', 'tests_hypotheses:', '  - draft:hypothesis',
    ], '## 方案\n\n执行对照实验。') },
    { ref: 'idea', path: 'wrong/idea.md', content: note('idea', ['title: 一个想法']) },
    { ref: 'decision', path: 'wrong/decision.md', content: note('decision', [
      'title: 一个决策', 'decision: 采用对照', 'rationale: 因为可证伪', 'relates_to:', '  - draft:experiment',
    ]) },
    { ref: 'lesson', path: 'wrong/lesson.md', content: note('lesson', [
      'title: 一条经验', 'statement: 先做对照', 'scope: 本课题', 'evidence_summary: 来自待审证据',
      'evidence_refs:', '  - draft:decision', 'source_types:', '  - decision',
    ]) },
    { ref: 'evidence', path: 'wrong/evidence.md', content: note('evidence', [
      'source_type: paper', 'source_uid: draft:paper', 'target_uid: draft:hypothesis',
      'relation: SUPPORTS', 'claim: 论文支持候选假设', 'quote: 可复核引文', 'locator:',
      `  source_sha256: ${'a'.repeat(64)}`, '  anchor: p0001',
      `  quote_hash: ${'b'.repeat(64)}`, '  original_url: https://example.test/paper',
    ]) },
  ];

  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({
      base: 'scholarium-vault', serverManagedMetadata: true,
      projectDisplayId: 'PRJ-002', items,
    }),
  });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  assert.equal(batch.items.length, 9);
  const expectedDirectories = {
    project: 'Research/Projects/', question: 'Research/Questions/',
    hypothesis: 'Research/Hypotheses/', paper: 'Research/Papers/',
    evidence: 'Research/Evidence/', experiment: 'Research/Experiments/',
    idea: 'Research/Ideas/', decision: 'Research/Decisions/', lesson: 'Research/Lessons/',
  };
  const parsed = new Map(batch.items.map((item) => {
    const object = schema.parseObject(item.content).object;
    assert.ok(item.path.startsWith(expectedDirectories[object.type]), `${object.type}: ${item.path}`);
    assert.deepEqual(schema.validateObject(object), [], object.type);
    assert.notEqual(object.uid, fakeUid);
    assert.notEqual(object.display_id, 'WRONG-999');
    assert.equal(object.created_by, 'ai');
    if (['paper', 'evidence', 'hypothesis', 'experiment', 'decision', 'lesson'].includes(object.type)) {
      assert.equal(object.review_status, 'pending');
      assert.equal(object.verified_by_user, false);
      assert.equal(object.verified_at, undefined);
    }
    return [object.type, object];
  }));
  for (const type of ['question', 'hypothesis', 'experiment', 'decision'])
    assert.equal(parsed.get(type).project_uid, projectUid, type);
  assert.equal(parsed.get('experiment').data_origin, undefined);
  assert.equal(parsed.get('experiment').data_recorded_by, undefined);
  assert.equal(parsed.get('evidence').source_uid, parsed.get('paper').uid);
  assert.equal(parsed.get('evidence').target_uid, parsed.get('hypothesis').uid);
  assert.deepEqual(parsed.get('lesson').evidence_refs, [parsed.get('decision').uid]);

  const commit = await request(port, `/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' });
  assert.equal(commit.status, 200, commit.body);
  for (const item of batch.items) assert.equal(fs.existsSync(path.join(vault, item.path)), true, item.path);
});

test('an EXP draft that omits data_origin entirely (the prompt-mandated shape) is accepted, matching a legacy/no-claim record', async (t) => {
  const { port, vault } = await launch(t);
  seedProject(vault);
  const content = ['---', ...EXP_FRONTMATTER_NO_PROVENANCE, '---', 'body'].join('\n');
  const { preview, commit, batch } = await previewAndCommit(port, [{ path: 'Research/Experiments/EXP-999.md', content }], { projectDisplayId: 'PRJ-002' });
  assert.equal(preview.status, 201, preview.body);
  assert.equal(commit.status, 200, commit.body);
  const written = fs.readFileSync(path.join(vault, batch.items[0].path), 'utf8');
  assert.match(written, /created_at: "?\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(written, /data_origin:/);
});

test('server-managed chat drafts allocate identity, bind the current project, strip human claims and remap intra-batch refs', async (t) => {
  const { port, vault } = await launch(t);
  const projectUid = seedProject(vault);
  const existingDir = path.join(vault, 'Research', 'Experiments');
  fs.mkdirSync(existingDir, { recursive: true });
  fs.writeFileSync(path.join(existingDir, 'EXP-009 old.md'), '---\ntype: experiment\ndisplay_id: EXP-009\n---\nold', 'utf8');

  const items = [
    {
      ref: 'hyp-1', path: 'Research/Hypotheses/HYP-009 模型编号.md',
      content: ['---', 'type: hypothesis', 'uid: 01919c7a-1111-7abc-89ab-1234567890ab', 'display_id: HYP-009', 'project_uid: 01919c7a-2222-7abc-89ab-1234567890ab', 'statement: 壳层影响电荷转移', 'status: supported', 'review_status: confirmed', 'verified_by_user: true', 'verified_at: 2026-09-08T00:00:00Z', 'confidence: 0.9', 'confidence_set_by: user', '---', 'hyp body'].join('\n'),
    },
    {
      path: 'Research/Experiments/EXP-009 模型编号.md',
      content: ['---', 'type: experiment', 'uid: 01919c7a-3333-7abc-89ab-1234567890ab', 'display_id: EXP-009', 'project_uid: 01919c7a-2222-7abc-89ab-1234567890ab', 'title: 壳厚实验', 'tests_hypotheses:', '  - draft:hyp-1', 'data_origin: measured', 'data_recorded_by: user', 'data_recorded_at: 2026-09-08T00:00:00Z', '---', 'exp body'].join('\n'),
    },
  ];
  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({
      base: 'scholarium-vault', serverManagedMetadata: true, projectDisplayId: 'PRJ-002', items,
    }),
  });
  assert.equal(preview.status, 201, preview.body);
  const batch = JSON.parse(preview.body);
  const hyp = schema.parseObject(batch.items[0].content).object;
  const exp = schema.parseObject(batch.items[1].content).object;
  assert.match(hyp.uid, /^[0-9a-f-]{14}7/i);
  assert.notEqual(hyp.uid, '01919c7a-1111-7abc-89ab-1234567890ab');
  assert.equal(hyp.project_uid, projectUid);
  assert.equal(exp.project_uid, projectUid);
  assert.deepEqual(exp.tests_hypotheses, [hyp.uid]);
  assert.equal(hyp.confidence, undefined);
  assert.equal(hyp.confidence_set_by, undefined);
  assert.equal(hyp.status, 'proposed');
  assert.equal(hyp.review_status, 'pending');
  assert.equal(hyp.verified_by_user, false);
  assert.equal(hyp.verified_at, undefined);
  assert.equal(exp.data_origin, undefined);
  assert.equal(exp.data_recorded_by, undefined);
  assert.equal(exp.data_recorded_at, undefined);
  assert.match(batch.items[1].content, /scholarium-experiment-template:v1/);
  assert.match(batch.items[1].content, new RegExp(`# ${exp.display_id} · 壳厚实验`));
  assert.match(batch.items[1].content, /## 实验方案与过程\n\nexp body/);
  assert.ok(batch.items[0].path.includes(hyp.display_id));
  assert.ok(batch.items[1].path.includes(exp.display_id));
  assert.notEqual(exp.display_id, 'EXP-009');

  // A second live preview sees the first preview's ids as reservations.
  const second = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({
      base: 'scholarium-vault', serverManagedMetadata: true, projectDisplayId: 'PRJ-002', items,
    }),
  });
  assert.equal(second.status, 201, second.body);
  const secondBatch = JSON.parse(second.body);
  assert.notEqual(schema.parseObject(secondBatch.items[0].content).object.display_id, hyp.display_id);
  assert.notEqual(schema.parseObject(secondBatch.items[1].content).object.display_id, exp.display_id);
});

test('server-managed relations must resolve to the live Vault or the same batch', async (t) => {
  const { port } = await launch(t);
  const projectUid = schema.uuidV7();
  const { preview } = await previewAndCommit(port, [{
    path: 'Research/Lessons/LES-999.md',
    content: schema.serializeObject({
      type: 'lesson', title: '不可解析关系', statement: 's', scope: 's',
      evidence_summary: 's', source_types: ['decision'], evidence_refs: [projectUid],
    }, 'body'),
  }]);
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /lesson\.evidence_refs points to an unknown uid/);
});

test('server-managed project-scoped drafts fail visibly when the chat has no valid project binding', async (t) => {
  const { port } = await launch(t);
  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({
      base: 'scholarium-vault', serverManagedMetadata: true,
      items: [{ path: 'Research/Experiments/experiment.md', content: '---\ntype: experiment\ntitle: t\n---\nbody' }],
    }),
  });
  assert.equal(preview.status, 400, preview.body);
  assert.match(JSON.parse(preview.body).error, /valid projectDisplayId/);
});

test('server-managed display ids remain monotonic across Bridge restarts via the allocation ledger', async (t) => {
  const { port, vault } = await launch(t, { idAllocations: [{ type: 'experiment', displayId: 'EXP-042' }] });
  seedProject(vault);
  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({
      base: 'scholarium-vault', serverManagedMetadata: true, projectDisplayId: 'PRJ-002',
      items: [{ path: 'Research/Experiments/experiment.md', content: '---\ntype: experiment\ntitle: t\n---\nbody' }],
    }),
  });
  assert.equal(preview.status, 201, preview.body);
  const object = schema.parseObject(JSON.parse(preview.body).items[0].content).object;
  assert.equal(object.display_id, 'EXP-043');
});

test('server-managed display ids honor retired identities recorded by a Decision', async (t) => {
  const { port, vault } = await launch(t);
  const projectUid = seedProject(vault);
  const now = new Date().toISOString();
  const decision = schema.serializeObject({
    type: 'decision', uid: schema.uuidV7(), display_id: 'DEC-001', schema_version: 1,
    created_at: now, updated_at: now, project_uid: projectUid, title: 'retire id',
    decision: 'EXP-011 was deleted after a workflow rehearsal.', rationale: 'audit remains',
    status: 'active', relates_to: [], retired_object_uids: ['01a07ed0-0000-7ace-9f21-b802c4d77e10'],
    retired_display_ids: ['EXP-011'],
  }, '');
  const target = path.join(vault, 'Research', 'Decisions', 'DEC-001.md');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, decision, 'utf8');
  const preview = await request(port, '/v1/drafts/batch', {
    method: 'POST', body: JSON.stringify({
      base: 'scholarium-vault', serverManagedMetadata: true, projectDisplayId: 'PRJ-002',
      items: [{ path: 'Research/Experiments/experiment.md', content: '---\ntype: experiment\ntitle: t\n---\nbody' }],
    }),
  });
  assert.equal(preview.status, 201, preview.body);
  const object = schema.parseObject(JSON.parse(preview.body).items[0].content).object;
  assert.equal(object.display_id, 'EXP-012');
});

test('malformed JSON is rejected before any Vault path is created', async (t) => {
  const { port, vault } = await launch(t);
  const response = await request(port, '/v1/drafts/batch', { method: 'POST', body: '{"base":' });
  assert.equal(response.status, 400, response.body);
  assert.match(JSON.parse(response.body).error, /invalid JSON/);
  assert.equal(fs.existsSync(path.join(vault, 'Research')), false);
});

test('concurrent managed previews reserve distinct identities and both commit without overwrite', async (t) => {
  const { port, vault } = await launch(t);
  seedProject(vault);
  const payload = JSON.stringify({
    base: 'scholarium-vault', serverManagedMetadata: true, projectDisplayId: 'PRJ-002',
    items: [{ path: 'Research/Experiments/provisional.md', content: '---\ntype: experiment\ntitle: 并发权威测试\n---\nbody' }],
  });
  const previews = await Promise.all([
    request(port, '/v1/drafts/batch', { method: 'POST', body: payload }),
    request(port, '/v1/drafts/batch', { method: 'POST', body: payload }),
  ]);
  for (const preview of previews) assert.equal(preview.status, 201, preview.body);
  const batches = previews.map((preview) => JSON.parse(preview.body));
  const objects = batches.map((batch) => schema.parseObject(batch.items[0].content).object);
  assert.notEqual(objects[0].uid, objects[1].uid);
  assert.notEqual(objects[0].display_id, objects[1].display_id);
  assert.notEqual(batches[0].items[0].path, batches[1].items[0].path);
  const commits = await Promise.all(batches.map((batch) => request(port, `/v1/drafts/batch/${batch.id}/commit`, { method: 'POST' })));
  for (const commit of commits) assert.equal(commit.status, 200, commit.body);
  for (const batch of batches) {
    const target = path.join(vault, batch.items[0].path);
    assert.equal(fs.existsSync(target), true);
    assert.deepEqual(schema.validateObject(schema.parseObject(fs.readFileSync(target, 'utf8')).object), []);
  }
});
