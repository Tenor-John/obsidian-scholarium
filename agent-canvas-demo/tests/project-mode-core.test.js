"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../project-mode-core.js');
const S = require('../../tools/schema-objects.js');

const PROJECT = {
  uid: '01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b', display_id: 'PRJ-001',
  schema_version: 1, type: 'project', created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z',
  title: 'Au/CeO2', status: 'active',
};

function reply() {
  return JSON.stringify({
    summary: '首圈规划', evidence_gaps: ['缺少原位证据'],
    hypotheses: [{ statement: '界面氧空位提高载流子寿命', predicts: '寿命随空位增加', falsified_if: '控制空位后寿命不变', assumptions: ['样品可比'], alternative_explanations: ['粒径效应'], required_tests: ['原位光谱'] }],
    experiments: [{ title: '氧空位梯度实验', hypothesis_indexes: [0], independent_variables: ['空位浓度'], dependent_variables: ['寿命'], controlled_variables: ['粒径'], replicates: 'n=3', procedure_outline: ['制备梯度', '测量'], estimated_hours: 6, blocked_by: [] }],
    week_plan: [{ day: '周一', task: '制备样品', experiment_index: 0, hours: 4, dependency: '' }],
  });
}

test('parseProjectPlanReply accepts bounded falsifiable P3-P5 JSON', () => {
  const parsed = Core.parseProjectPlanReply(reply());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.hypotheses.length, 1);
  assert.equal(parsed.value.experiments[0].hypothesis_indexes[0], 0);
  assert.equal(parsed.value.week_plan[0].hours, 4);
});

test('parseProjectPlanReply refuses hypotheses without predicts/falsified_if', () => {
  const parsed = Core.parseProjectPlanReply(JSON.stringify({ hypotheses: [{ statement: 'vague' }], experiments: [] }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /可证伪假设/);
});

test('buildProjectDrafts creates schema-valid linked hypotheses and experiments plus proposed schedule', () => {
  const parsed = Core.parseProjectPlanReply(reply());
  let n = 100;
  const built = Core.buildProjectDrafts({ project: PROJECT, parsed, at: '2026-08-20T01:00:00.000Z', uidFn: () => S.uuidV7(n++) });
  assert.equal(built.items.length, 3);
  const hyp = S.parseObject(built.items[0].content).object;
  const exp = S.parseObject(built.items[1].content).object;
  assert.deepEqual(S.validateObject(hyp), []);
  assert.deepEqual(S.validateObject(exp), []);
  assert.equal(exp.project_uid, PROJECT.uid);
  assert.deepEqual(exp.tests_hypotheses, [hyp.uid]);
  assert.equal(exp.data_origin, 'planned');
  assert.match(built.items[2].content, /status: "proposed"/);
  assert.match(built.schedulePath, /^Research\/Projects\/PRJ-001\/Schedule\/\d{4}-W\d{2}\.md$/);
});

test('buildProjectPlanPrompt includes the selected Project and hard no-fabrication rule', () => {
  const prompt = Core.buildProjectPlanPrompt({ project: PROJECT, hypotheses: [], experiments: [] });
  assert.match(prompt, /PRJ-001/);
  assert.match(prompt, /不要编造 DOI/);
  assert.match(prompt, /P3-P5/);
});

test('M3 P1-P2 confirmation states the P2 stop boundary rather than the full pipeline', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');
  assert.match(ui, /options\.stopAfterGraph/);
  assert.match(ui, /本次严格停在 P2/);
  assert.match(ui, /不生成 P3–P5 假设\/实验\/周计划草案/);
  assert.match(ui, /也不生成证据综述、手稿或润色稿/);
});

test('M3 P1-P2 offers explicit same-workspace recovery before a fresh search', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'project-mode.js'), 'utf8');
  assert.match(ui, /resumablePipelineForProject/);
  assert.match(ui, /run\.resumable && run\.workspace === workspaceRoot/);
  assert.match(ui, /不会重新检索或下载，也不会进入 P3–P5/);
  assert.match(ui, /resumeScholariumPipelineFromHistory/);
});

test('history recovery resets the run title so an old interruption is not misreported as the new P2 run', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');
  assert.match(ui, /M3 P1–P2 · 从历史 PDF 恢复/);
});
