"use strict";
// DEF-005 negative regression cases.  Each test owns a Bridge process and a
// config/secrets pair, so no request can read the developer's running Bridge
// or live vault configuration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness.js');

async function launch(t, vaultRoot) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-vault-validation-'));
  const topic = path.join(temp, 'TopicSubfolder');
  fs.mkdirSync(topic, { recursive: true });
  const harness = await startBridge({
    config: {
      workspaceRoot: topic, allowedRoots: [topic], adapters: {},
      scholarium: { enabled: true, vaultRoot, allowedActions: [] },
    },
  });
  t.after(() => {
    harness.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  return harness;
}

test('scholarium-vault rejects a missing vaultRoot without writing', async (t) => {
  const harness = await launch(t, null);
  const res = await harness.request('/v1/drafts/batch', {
    method: 'POST',
    body: { base: 'scholarium-vault', items: [{ path: 'Research/Decisions/DEC-901.md', content: '# DEC' }] },
  });
  assert.equal(res.status, 400, res.text);
  assert.match(JSON.parse(res.text).error, /scholarium\.vaultRoot is not configured or does not exist/);
});

test('scholarium-vault rejects a nonexistent vaultRoot without writing', async (t) => {
  const nonexistentVault = path.join(os.tmpdir(), `missing-vault-${process.pid}-${Date.now()}`);
  const harness = await launch(t, nonexistentVault);
  const res = await harness.request('/v1/drafts/batch', {
    method: 'POST',
    body: { base: 'scholarium-vault', items: [{ path: 'Research/Lessons/LES-901.md', content: '# LES' }] },
  });
  assert.equal(res.status, 400, res.text);
  assert.match(JSON.parse(res.text).error, /scholarium\.vaultRoot is not configured or does not exist/);
  assert.equal(fs.existsSync(path.join(nonexistentVault, 'Research', 'Lessons', 'LES-901.md')), false);
});
