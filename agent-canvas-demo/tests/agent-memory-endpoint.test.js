"use strict";
// End-to-end test for /v1/agent-memory/entry near-duplicate dedup and
// /v1/agent-memory/checkpoint formatting. Motivation (2026-08-22 live
// acceptance run): the same Li 2014 / Dao 2021 conclusion was appended to
// evidence-ledger.md twice in two consecutive chat rounds, and the checkpoint
// reply excerpt swallowed an entire 800-char markdown reply. Dedup is
// keyword-Jaccard ≥ 0.6 against existing entries in the same file.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness.js');

let harness, vault;
const post = (pathname, payload) => harness.request(pathname, { method: 'POST', body: payload })
  .then((res) => ({ ...res, body: res.text }));

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-endpoint-vault-'));
  harness = await startBridge({
    config: { workspaceRoot: vault, allowedRoots: [vault], adapters: {} },
  });
});

test.after(() => {
  if (harness) harness.stop();
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('first entry lands as 待确认 and is persisted', async () => {
  const res = await post('/v1/agent-memory/entry', {
    file: 'evidence-ledger.md',
    title: 'Li 2014 证明 Au@CeO2 核壳可见光协同但未建立壳厚因果',
    body: 'Li 2014 证明 Au@CeO2 核壳可见光协同但未建立壳厚因果，证据强度中。',
  });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, '待确认');
  const content = fs.readFileSync(path.join(vault, '.scholarium', 'agent', 'evidence-ledger.md'), 'utf8');
  assert.match(content, /Li 2014/);
  assert.match(content, /\[状态: 待确认\]/);
});

test('near-duplicate entry is deduped, not appended again', async () => {
  const before = fs.readFileSync(path.join(vault, '.scholarium', 'agent', 'evidence-ledger.md'), 'utf8');
  const res = await post('/v1/agent-memory/entry', {
    file: 'evidence-ledger.md',
    title: 'Li 2014 证明 Au@CeO2 核壳的可见光协同，但未建立壳厚因果',
    body: 'Li 2014 证明 Au@CeO2 核壳可见光协同但未建立壳厚因果；证据强度中等。',
  });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.deduped, true);
  const after = fs.readFileSync(path.join(vault, '.scholarium', 'agent', 'evidence-ledger.md'), 'utf8');
  assert.equal(after, before, 'deduped entry must not change the file');
});

test('a genuinely different conclusion on the same topic is still written', async () => {
  const res = await post('/v1/agent-memory/entry', {
    file: 'evidence-ledger.md',
    title: 'Kuo 2026 综述提出核壳析氢四机制框架',
    body: 'Small Structures 2026 综述将 Au@CeO2 核壳析氢归纳为 EMR/HET/PRET/氧空位自催化四机制，壳厚单变量梳理待核实。',
  });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.deduped, undefined, 'different conclusion must not be swallowed by dedup');
  const content = fs.readFileSync(path.join(vault, '.scholarium', 'agent', 'evidence-ledger.md'), 'utf8');
  assert.match(content, /Kuo 2026/);
});

test('placeholder or title-equals-body memory entries are rejected', async () => {
  for (const payload of [
    { file: 'decisions.md', title: '上述定稿。', body: '上述定稿。' },
    { file: 'lessons.md', title: '一个简短结论', body: '一个简短结论' },
  ]) {
    const res = await post('/v1/agent-memory/entry', payload);
    assert.equal(res.status, 400);
    assert.match(JSON.parse(res.body).error, /substantive/);
  }
});

test('checkpoint accepts structured fields and stamps the file', async () => {
  const res = await post('/v1/agent-memory/checkpoint', {
    lastQuestion: '帮我查 Au@CeO2 可见光析氢的最新综述',
    replyExcerpt: '目前没有专门综述。最贴近的是 Small Structures 2026 核壳析氢综述。',
  });
  assert.equal(res.status, 200);
  const content = fs.readFileSync(path.join(vault, '.scholarium', 'agent', 'task-checkpoint.md'), 'utf8');
  assert.match(content, /研究员问题：帮我查 Au@CeO2 可见光析氢的最新综述/);
  assert.match(content, /回复摘要：目前没有专门综述/);
});
