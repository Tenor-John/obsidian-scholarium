"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../query-loop-core.js');

function loadLoop() {
  const entryButton = { addEventListener() {} };
  const context = {
    window: { weaverQueryLoopCore: Core },
    document: { querySelector: (selector) => selector === '#queryLoopBtn' ? entryButton : null },
    zhiyanBridge: { online: true, agents: [{ id: 'portable-agent', installed: true }] },
    connectBridge: async () => {},
    workspaceRoot: 'portable-workspace',
    bridgeFetch: async () => { throw new Error('unexpected real bridge call'); },
    waitTask: async () => { throw new Error('unexpected real task wait'); },
    safeHtml: (value) => String(value),
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'query-loop.js'), 'utf8'), context, { filename: 'query-loop.js' });
  return context.window.weaverQueryLoop;
}

test('headless loop repairs critic output without repeating the literature search', async () => {
  const loop = loadLoop();
  const replies = [
    '{"query":"gold AND photocatalysis","rationale":"portable"}',
    '{"score_breakdown":{"topic_relevance":40,"coverage":25,"portability":15}}',
    '{"score_breakdown":{"relevance":40,"recall":25,"executability":15},"problems":[]}',
  ];
  let searches = 0;
  const phases = [];
  loop._runAgent = async () => ({ text: replies.shift(), taskId: `task-${4 - replies.length}` });
  loop._search = async () => { searches++; return { records: [{ title: 'Gold photocatalysis' }], sources: [] }; };
  const result = await loop.runAuto('gold photocatalysis', { onProgress: (p) => phases.push(p.phase) });
  assert.equal(searches, 1);
  assert.equal(result.degraded, false);
  assert.equal(result.quality_status, 'repaired');
  assert.ok(phases.includes('critic-repair'));
  assert.deepEqual(phases, ['build', 'search', 'critic', 'critic-repair', 'scored', 'accept']);
});

test('headless loop repairs a provider-specific builder wrapper before searching', async () => {
  const loop = loadLoop();
  const replies = [
    'I suggest the following query: gold AND titania',
    '{"query":"gold AND titania","rationale":"格式修复"}',
    '{"score_breakdown":{"relevance":40,"recall":25,"executability":15},"problems":[]}',
  ];
  let searches = 0;
  const phases = [];
  loop._runAgent = async () => ({ text: replies.shift(), taskId: `task-${4 - replies.length}` });
  loop._search = async (query) => { searches++; assert.equal(query, 'gold AND titania'); return { records: [], sources: [] }; };
  const result = await loop.runAuto('gold titania', { onProgress: (p) => phases.push(p.phase) });
  assert.equal(searches, 1);
  assert.equal(result.degraded, false);
  assert.ok(phases.includes('builder-repair'));
});

test('headless loop returns a traceable unscored candidate when critic format repair also fails', async () => {
  const loop = loadLoop();
  const replies = [
    '{"query":"gold AND photocatalysis","rationale":"portable"}',
    'plain prose',
    '{"score":88}',
  ];
  const phases = [];
  loop._runAgent = async () => ({ text: replies.shift(), taskId: `task-${4 - replies.length}` });
  loop._search = async () => ({ records: [], sources: [] });
  const result = await loop.runAuto('gold photocatalysis', { onProgress: (p) => phases.push(p.phase) });
  assert.equal(result.query, 'gold AND photocatalysis');
  assert.equal(result.score, null);
  assert.equal(result.degraded, true);
  assert.equal(result.requiresConfirmation, true);
  assert.equal(result.quality_status, 'degraded-unscored');
  assert.equal(result.degradation.used_query_source, 'last-valid-builder-cycle-1');
  assert.equal(result.degradation.protocol.attempts.length, 2);
  assert.equal(phases.at(-1), 'degraded');
});

test('full Pipeline keeps degraded runs behind a second explicit download gate', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');
  const degradeAssignment = source.indexOf('queryLoopDegradation = loopResult.degraded');
  const gate = source.indexOf('if (queryLoopDegradation)');
  const confirmation = source.indexOf('是否接受这次降级结果并继续？', gate);
  const dedupe = source.indexOf("const row4 = addStep('第 4 步 · reference-export-dedupe'", gate);
  assert.ok(degradeAssignment >= 0, 'Pipeline must retain the degradation contract');
  assert.ok(gate > degradeAssignment, 'second gate must occur after degraded metadata search');
  assert.ok(confirmation > gate, 'gate must explicitly ask for researcher confirmation');
  assert.ok(dedupe > confirmation, 'confirmation must occur before dedupe/download/evidence stages');
  // 这道闸门原来用 finishRunControl('stopped', …) + return 收尾。断点续跑改造
  // 把每个步骤包进了 stage() 闭包，闭包里的 return 只会退出闭包、让 Pipeline
  // 继续往下跑，所以全部改成抛出带停止标记的 stopPipeline()——语义不变，仍然
  // 是「终止整轮、不进入去重/下载/证据生成」，且这类停止永远不给续跑入口。
  assert.match(source.slice(gate, dedupe), /stopPipeline\('降级检索结果未获人工确认'/);
  assert.doesNotMatch(source.slice(gate, dedupe), /\breturn;/,
    '闸门不能再用裸 return——它在 stage 闭包里拦不住 Pipeline');
});

test('full Pipeline can preview metadata with deterministic v0 when Agent adapters are unavailable', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');
  assert.match(source, /used_query_source: 'deterministic-v0'/);
  assert.match(source, /保留确定性 v0 仅继续元数据检索与相关性筛选，下载前必须再次确认/);
  assert.doesNotMatch(source, /未执行宽泛 v0，也未进入下载/);
});
