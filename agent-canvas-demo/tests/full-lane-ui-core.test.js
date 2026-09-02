"use strict";
// Unit tests for the full-lane panel UI core (full-lane-ui-core.js): probe-gate
// error translation and the status-card view model — including the review
// requirement that completed vs completed-with-violations stay visually
// distinct and the §5 diff summary is never swallowed.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../full-lane-ui-core.js');

const SERVER_MESSAGES = [
  "adapter 'claude-full' has never passed a capability probe; run POST /v1/full-tasks/probe {\"adapter\":\"claude-full\"} first (design §1)",
  "adapter 'claude-full' failed its last capability probe; re-run POST /v1/full-tasks/probe",
  "adapter 'claude-full' configuration changed since its last probe; re-run POST /v1/full-tasks/probe",
  "adapter 'claude-full' probe is older than 30 days; re-run POST /v1/full-tasks/probe",
];

test('probeGateFromError translates all four server-side probe-gate refusals', () => {
  for (const message of SERVER_MESSAGES) {
    const gate = core.probeGateFromError(503, message);
    assert.ok(gate, `should recognise: ${message}`);
    assert.equal(gate.adapter, 'claude-full');
    assert.ok(gate.reasonText.length > 0);
    assert.ok(!/[a-z]{4}\s[a-z]{4}\s[a-z]{4}/i.test(gate.reasonText), 'reasonText should be the Chinese explanation, not raw English');
  }
});

test('probeGateFromError ignores non-probe errors', () => {
  assert.equal(core.probeGateFromError(503, 'execution disabled: set allowExecution=true in bridge.config.json'), null);
  assert.equal(core.probeGateFromError(503, "no -full adapter 'claude-full' is configured for category 'fetch_and_attach_pdf'"), null);
  assert.equal(core.probeGateFromError(403, 'dispatch requires a valid previewId'), null);
  assert.equal(core.probeGateFromError(409, 'dispatch prompt does not match the previewed one'), null);
  assert.equal(core.probeGateFromError(503, ''), null);
});

test('formatBytes renders human-readable sizes', () => {
  assert.equal(core.formatBytes(512), '512 B');
  assert.equal(core.formatBytes(2048), '2.0 KB');
  assert.equal(core.formatBytes(2215244), '2.11 MB');
  assert.equal(core.formatBytes(undefined), '大小未知');
});

test('completed run: ok tone, download info with human bytes, diff lists passed through', () => {
  const model = core.fullTaskCardModel({
    status: 'completed', adapter: 'claude-full', category: 'fetch_and_attach_pdf',
    diff: { added: ['literature/downloaded-pdfs/a.pdf'], modified: [], deleted: [] },
    violations: [],
    download: { path: 'literature/downloaded-pdfs/a.pdf', bytes: 2215244, status: 'downloaded', source_url: 'https://arxiv.org/pdf/x' },
  });
  assert.equal(model.tone, 'ok');
  assert.equal(model.title, '已完成');
  assert.equal(model.download.bytesText, '2.11 MB');
  assert.equal(model.download.statusText, '新下载');
  assert.deepEqual(model.added, ['literature/downloaded-pdfs/a.pdf']);
  assert.deepEqual(model.violations, []);
});

test('completed-with-violations: warn tone, visually distinct from completed, violations preserved', () => {
  const model = core.fullTaskCardModel({
    status: 'completed-with-violations',
    diff: { added: ['evil.txt'], modified: [], deleted: [] },
    violations: ['evil.txt'],
    download: { path: 'a.pdf', bytes: 1000, status: 'already_present', source_url: 'https://x' },
  });
  assert.equal(model.tone, 'warn');
  assert.notEqual(model.title, '已完成', 'the distinction must not be swallowed');
  assert.match(model.summary, /越界/);
  assert.deepEqual(model.violations, ['evil.txt']);
  assert.equal(model.download.statusText, '已存在（字节一致，未重复保存）');
});

test('completed run with a landing page (no OA) is an info outcome, not ok and not error', () => {
  const model = core.fullTaskCardModel({
    status: 'completed',
    landing: { url: 'https://onlinelibrary.wiley.com/doi/x', reason: 'Wiley 付费墙，无 OA 版本' },
    download: null,
    diff: { added: [], modified: [], deleted: [] },
    violations: [],
  });
  assert.equal(model.tone, 'info');
  assert.equal(model.title, '未找到开放获取 PDF');
  assert.match(model.summary, /付费墙/);
  assert.equal(model.landing.url, 'https://onlinelibrary.wiley.com/doi/x');
  assert.equal(model.download, null);
});

test('cancelled run: info tone, neither ok nor error, diff still shown', () => {
  const model = core.fullTaskCardModel({
    status: 'cancelled',
    diff: { added: ['literature/downloaded-pdfs/partial.tmp'], modified: [], deleted: [] },
    violations: [],
  });
  assert.equal(model.tone, 'info');
  assert.equal(model.title, '任务已取消');
  assert.deepEqual(model.added, ['literature/downloaded-pdfs/partial.tmp'], '取消前已发生的改动必须如实列出');
});

test('finalMessage is carried into the model so failed cards can show the agent explanation', () => {
  const model = core.fullTaskCardModel({ status: 'failed', failureMessage: 'x', finalMessage: '这篇是 Wiley 付费墙论文，建议改用……' });
  assert.equal(model.finalMessage, '这篇是 Wiley 付费墙论文，建议改用……');
});

test('failed run: error tone surfaces failureMessage; running and missing records are handled', () => {
  const failed = core.fullTaskCardModel({ status: 'failed', failureMessage: 'bridge-side download failed: HTTP 404' });
  assert.equal(failed.tone, 'error');
  assert.equal(failed.summary, 'bridge-side download failed: HTTP 404');

  const running = core.fullTaskCardModel({ status: 'running' });
  assert.equal(running.tone, 'running');

  const missing = core.fullTaskCardModel(null);
  assert.equal(missing.tone, 'error');
  assert.match(missing.title, /未知状态/);
});

test('buildFetchPromptFromRecord formats DOI-first prompts matching the dialog placeholder', () => {
  const full = core.buildFetchPromptFromRecord({ doi: '10.48550/arXiv.1706.03762', title: 'Attention Is All You Need', authors: 'Vaswani et al.', year: 2017 });
  assert.equal(full, '10.48550/arXiv.1706.03762（Attention Is All You Need, Vaswani et al. 2017）');

  // No DOI: fall back to the title as the head, no duplication inside parens.
  const noDoi = core.buildFetchPromptFromRecord({ title: 'Some Paper', authors: 'Li et al.', year: 2024 });
  assert.equal(noDoi, 'Some Paper（Li et al. 2024）');

  // DOI only: no dangling parens.
  assert.equal(core.buildFetchPromptFromRecord({ doi: '10.1000/xyz' }), '10.1000/xyz');

  // Empty / junk records must not produce a submittable prompt.
  assert.equal(core.buildFetchPromptFromRecord({}), '');
  assert.equal(core.buildFetchPromptFromRecord(null), '');
  assert.equal(core.buildFetchPromptFromRecord({ authors: 'x', year: 2020 }), '');
});

test('titleHintFromPrompt extracts the title from a prefilled prompt, else empty', () => {
  assert.equal(core.titleHintFromPrompt('10.48550/arXiv.1706.03762（Attention Is All You Need, Vaswani et al. 2017）'), 'Attention Is All You Need');
  assert.equal(core.titleHintFromPrompt('10.1002/adfm.201801214(Some Title, X 2018)'), 'Some Title');
  assert.equal(core.titleHintFromPrompt('10.1000/xyz'), '');
  assert.equal(core.titleHintFromPrompt(''), '');
  assert.equal(core.titleHintFromPrompt(null), '');
});

test('interrupted run (disk record says running but Bridge restarted) gets an honest error card', () => {
  const model = core.fullTaskCardModel({ status: 'interrupted', userPrompt: '10.1000/xyz' });
  assert.equal(model.tone, 'error');
  assert.match(model.title, /已中断/);
  assert.match(model.summary, /Bridge 重启/);
});

test('doiFromPrompt extracts a DOI from prompt contract text or agent messages', () => {
  assert.equal(core.doiFromPrompt('10.48550/arXiv.1706.03762（Attention Is All You Need, Vaswani et al. 2017）'), '10.48550/arXiv.1706.03762');
  assert.equal(core.doiFromPrompt('10.1016/j.colcom.2022.100599'), '10.1016/j.colcom.2022.100599');
  // Anywhere in the text (agent explanations mention the DOI mid-sentence).
  assert.equal(core.doiFromPrompt('The Crossref record for 10.1002/adfm.201801214 confirms…'), '10.1002/adfm.201801214');
  // Trailing punctuation must not leak into the DOI.
  assert.equal(core.doiFromPrompt('doi 10.1000/xyz.'), '10.1000/xyz');
  // No DOI present → null, never a guess.
  assert.equal(core.doiFromPrompt('Some Title（Li et al. 2024）'), null);
  assert.equal(core.doiFromPrompt(''), null);
  assert.equal(core.doiFromPrompt(null), null);
});

test('reportedPdfFromMessage parses the PDF_URL=/PDF_NAME= contract lines', () => {
  const message = 'A) 找到了开放获取 PDF：\n\nPDF_URL=https://www.sciencedirect.com/science/article/pii/S2215038222000322/pdf\n\nPDF_NAME=Guo_2022_Au_g-C3N4_dual_role.pdf\n\n说明：gold OA。';
  const parsed = core.reportedPdfFromMessage(message);
  assert.equal(parsed.pdfUrl, 'https://www.sciencedirect.com/science/article/pii/S2215038222000322/pdf');
  assert.equal(parsed.pdfName, 'Guo_2022_Au_g-C3N4_dual_role.pdf');

  // Trailing punctuation / markdown after the URL must not leak into the address.
  assert.equal(core.reportedPdfFromMessage('PDF_URL=https://example.org/x.pdf）。').pdfUrl, 'https://example.org/x.pdf');

  // No PDF_URL line, junk, or non-http value → no fallback button.
  assert.equal(core.reportedPdfFromMessage('没有找到 OA 版本。'), null);
  assert.equal(core.reportedPdfFromMessage(''), null);
  assert.equal(core.reportedPdfFromMessage(null), null);
  assert.equal(core.reportedPdfFromMessage('PDF_URL=not-a-url'), null);
});
