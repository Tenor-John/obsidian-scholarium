"use strict";
// DEF-005 negative regression: the fix widens which vaultRoot-vs-allowedRoots
// *shapes* are accepted (ancestor as well as descendant/self), but must not
// turn draftBaseRoot()/promotionVault() into an open write anywhere. When
// scholarium.vaultRoot is configured but the directory does not exist, drafts
// with base:'scholarium-vault' must still fail closed with the original
// "not configured or does not exist" error, exactly as before this fix.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness.js');

let harness, topicDir;

test.before(async () => {
  topicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'def005-neg-topic-'));
  harness = await startBridge({
    config: {
      workspaceRoot: topicDir, allowedRoots: [topicDir], adapters: {},
      // enabled, but vaultRoot points at a directory that does not exist.
      scholarium: { enabled: true, vaultRoot: path.join(topicDir, 'nonexistent-vault'), allowedActions: [] },
    },
  });
});

test.after(() => {
  if (harness) harness.stop();
  if (topicDir && fs.existsSync(topicDir)) fs.rmSync(topicDir, { recursive: true, force: true });
});

test('drafts/batch with base scholarium-vault fails closed, not open, when vaultRoot does not exist', async () => {
  const res = await harness.request('/v1/drafts/batch', {
    method: 'POST',
    body: { base: 'scholarium-vault', items: [{ path: 'Research/Decisions/DEC-X.md', content: 'x' }] },
  });
  assert.equal(res.status, 400, res.text);
  assert.match(JSON.parse(res.text).error, /vaultRoot is not configured or does not exist/);
});
