const assert = require('node:assert/strict');
const test = require('node:test');
const { researchPassed, pathScopePassed, acceptanceRecord } = require('../bridge/verify-live.js');

test('live verifier recognizes only complete research capability evidence', () => {
  const complete = { exitCode: 0, output: 'final status: completed\ntool_call_evidence: curl=1 websearch=1\npermission_denials 事件数: 0' };
  assert.equal(researchPassed(complete), true);
  const promptWordsOnly = { exitCode: 0, output: 'final status: completed\n请报告 curl 是否通了外网、WebSearch 是否可用\npermission_denials 事件数: 0' };
  assert.equal(researchPassed(promptWordsOnly), false, 'prompt wording is never evidence that a tool call happened');
  assert.equal(researchPassed({ ...complete, output: complete.output.replace('事件数: 0', '事件数: 1') }), false);
  assert.equal(researchPassed({ ...complete, exitCode: 1 }), false);
});

test('live verifier documents research escape as expected detection evidence', () => {
  assert.equal(pathScopePassed({ exitCode: 0, output: '结果: 越界文件被真实写出 → research 车道无预防式路径边界' }), true);
  assert.equal(pathScopePassed({ exitCode: 0, output: '结果: 任务失败且文件未写出' }), false);
});

test('acceptance audit retains every probe and fails overall on one failure', () => {
  const record = acceptanceRecord({ research: { ok: true }, pathScope: { ok: true }, claudeFull: { ok: false } });
  assert.equal(record.event, 'live-acceptance-completed');
  assert.equal(record.overallOk, false);
  assert.equal(record.probes.claudeFull.ok, false);
});
