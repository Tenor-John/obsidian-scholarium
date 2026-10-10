const assert = require('node:assert/strict');
const test = require('node:test');
const { researchPassed, pathScopePassed, acceptanceRecord } = require('../bridge/verify-live.js');
const { openAlexResultEvidence } = require('../bridge/probe-research-lane.js');

test('live verifier recognizes only complete research capability evidence', () => {
  const complete = { exitCode: 0, output: 'final status: completed\ntool_call_evidence: webfetch=1 websearch=1\npermission_denials 事件数: 0' };
  assert.equal(researchPassed(complete), true);
  const promptWordsOnly = { exitCode: 0, output: 'final status: completed\n请报告 WebFetch、WebSearch 是否可用\npermission_denials 事件数: 0' };
  assert.equal(researchPassed(promptWordsOnly), false, 'prompt wording is never evidence that a tool call happened');
  assert.equal(researchPassed({ ...complete, output: complete.output.replace('事件数: 0', '事件数: 1') }), false);
  assert.equal(researchPassed({ ...complete, output: complete.output.replace('webfetch=1', 'webfetch=0') }), false);
  assert.equal(researchPassed({ ...complete, exitCode: 1 }), false);
});

test('live verifier requires direct write capabilities to be unreachable', () => {
  assert.equal(pathScopePassed({ exitCode: 0, output: 'RESULT research-direct-write-unreachable: task completed and sentinel absent' }), true);
  assert.equal(pathScopePassed({ exitCode: 0, output: 'RESULT research-direct-write-reachable: sentinel was written' }), false);
});

test('historical OpenAlex evidence parser requires a direct result or same-path persisted read', () => {
  const direct = [{ text: '工具返回 PowerShell（成功）：{"meta":{"count":1},"results":[{}]}' }];
  assert.equal(openAlexResultEvidence(direct), 1);

  const persisted = [
    { text: '工具返回 Bash（成功）：<persisted-output> Full output saved to: C:\\tmp\\tool-results\\openalex.txt </persisted-output>' },
    { text: '调用 Read：C:\\tmp\\tool-results\\openalex.txt' },
    { text: '工具返回 Read（成功）：1 {"meta":{"count":1},"results":[{"doi":"10.1/x"}]}' },
  ];
  assert.equal(openAlexResultEvidence(persisted), 1);
  assert.equal(openAlexResultEvidence([
    persisted[0],
    { text: '调用 Read：C:\\tmp\\tool-results\\other.txt' },
    persisted[2],
  ]), 0, 'Read 必须读取 shell 返回的同一路径');
  assert.equal(openAlexResultEvidence([
    persisted[0], persisted[1],
    { text: '工具返回 Read（失败）：permission denied {"meta":{},"results":[]}' },
  ]), 0, '失败的 Read 不能成为证据');
});

test('acceptance audit retains every probe and fails overall on one failure', () => {
  const record = acceptanceRecord({ research: { ok: true }, pathScope: { ok: true }, claudeFull: { ok: false } });
  assert.equal(record.event, 'live-acceptance-completed');
  assert.equal(record.overallOk, false);
  assert.equal(record.probes.claudeFull.ok, false);
});
