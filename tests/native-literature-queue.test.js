const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'tools/native-weaver-host.js'), 'utf8');
const start = host.indexOf('  function manualDownloadItems(items) {');
const end = host.indexOf('  async function openVaultFile(view, value)', start);
const { publish } = vm.runInNewContext(`(() => { ${host.slice(start, end)}; return {publish: publishManualDownloads}; })()`, { window: { setTimeout() {} } });

test('queue keeps existing entries, persists new DOI and returns accepted count', async () => {
  let saved = 0;
  const board = { manualDownloadQueue: [{ id: 'doi:old', url: 'https://doi.org/10.1/old' }], setManualDownloadQueue(items) { this.manualDownloadQueue = items; }, async save() { saved++; } };
  const view = { rssBoard: board };
  const count = await publish(view, [{ id: 'doi:10.1234/new', doi: '10.1234/new', url: 'https://doi.org/10.1234/new', batchId: 'batch:1' }], { append: true });
  assert.equal(count, 1);
  assert.equal(board.manualDownloadQueue.length, 2);
  assert.equal(board.manualDownloadQueue[0].batchId, 'batch:1');
  assert.equal(saved, 1);
});

test('unavailable host cannot claim the queue was updated', async () => {
  await assert.rejects(publish({}, [], {}), /尚未初始化/);
});
