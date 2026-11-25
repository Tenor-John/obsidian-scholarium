const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'rss-feed-board.ts'), 'utf8');
function method(name, next) {
  const start = source.indexOf(`    ${name}(`);
  const end = source.indexOf(`    ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('file changes mark the library dirty without refreshing it', () => {
  const handlers = {};
  const board = vm.runInNewContext(`new (class {${method('installVaultPdfLibraryWatcher', 'async parseVaultPdfFromLibrary')}})()`, { window: {} });
  board.app = { vault: { on: (event, handler) => { handlers[event] = handler; } }, metadataCache: { on: () => {} } };
  board.plugin = { registerEvent() {} };
  board.isVaultLibraryPdf = () => false;
  board.isLiteratureMatrixNote = () => true;
  board.refreshVaultPdfLibrary = () => { throw new Error('unexpected automatic scan'); };
  board.installVaultPdfLibraryWatcher();
  handlers.modify({ path: 'literature/paper.md' });
  assert.equal(board.__vaultPdfLibraryDirty, true);
});

test('no task panels are displayed above or below the matrix', () => {
  const board = vm.runInNewContext(`new (class {${method('renderLiteratureMatrixJobs', 'renderHubTabs')}})()`);
  const jobs = [
    { status: 'completed', results: [], total: 2 },
    { status: 'running', results: [], total: 1 },
    { status: 'paused', results: [], total: 1 },
  ];
  board.literatureMatrixJobs = () => jobs;
  let panels = 0;
  const element = { createEl: () => element };
  board.renderLiteratureMatrixJobs({ createEl: () => { panels++; return element; } });
  assert.equal(panels, 0);
  assert.equal(jobs.length, 3);
  assert.equal(source.includes('this.renderLiteratureMatrixJobs(box)'), false);
});

test('row status hides successful retries and dismissed failures without revealing older errors', () => {
  const board = vm.runInNewContext(`new (class {${method('literatureMatrixItem', 'scheduleLiteratureMatrixWork')}})()`);
  const oldFailure = { status: 'needs_attention', label: 'old error' };
  const success = { status: 'completed', label: '总结完成' };
  const jobs = [{ items: { oldPath: oldFailure } }, { items: { oldPath: success } }];
  const record = { path: 'newPath', note_paths: ['oldPath'], ai: {} };
  board.literatureMatrixJobs = () => jobs;
  board.literatureMatrixRecord = () => record;
  assert.equal(board.literatureMatrixItem('newPath'), null);
  success.status = 'needs_attention'; success.label = 'latest error';
  assert.equal(board.literatureMatrixItem('newPath').label, 'latest error');
  success.dismissed = true;
  assert.equal(board.literatureMatrixItem('newPath'), null);
  success.dismissed = false;
  record.summary_path = 'summary.md'; record.ai = { field: 'filled' };
  jobs[1].created_at = '2026-11-25T00:00:00Z';
  board.app = { vault: { getAbstractFileByPath: () => ({ stat: { mtime: Date.parse('2026-11-25T01:00:00Z') } }) } };
  assert.equal(board.literatureMatrixItem('newPath'), null);
});
