"use strict";
// Real end-to-end test for GET /v1/scholarium/state: spawns the actual Bridge
// against a disposable config + fixture vault, then exercises auth, gates,
// whitelist and the L0-only refusal over HTTP. The plugin-side static checks
// (tests/scholarium-bridge-endpoints.test.js) cover source ordering; this file
// proves the route actually works when the process is running.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pluginRoot = path.resolve(root, '..');
const S = require(path.join(pluginRoot, 'tools', 'schema-objects.js'));
const { startBridge } = require('./helpers/bridge-harness.js');

// The port is assigned by the OS. This file used to compute
// `46100 + (process.pid % 300)`, a range that covers the ports a developer's
// own Bridge and canvas actually listen on - a collision did not fail loudly,
// it pointed the test at the live Bridge and the real vault.
let harness;
let vault;

// The harness returns the raw payload as `text`; this file was written against
// a local helper that called it `body`, so keep that name at the call sites.
const withBody = (res) => ({ ...res, body: res.text });
const request = (pathname, options = {}) => harness.request(pathname, { ...options, auth: false }).then(withBody);
const authed = (pathname) => harness.request(pathname).then(withBody);

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-state-endpoint-vault-'));
  const prj = S.createObject('project', { title: '端点测试课题', status: 'active' });
  const dir = path.join(vault, 'Research', 'Projects');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'PRJ-001.md'), S.serializeObject(prj, '\n# 端点测试课题\n'), 'utf8');
  fs.mkdirSync(path.join(vault, 'Literature'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Literature', 'gold-paper.md'), '# Gold paper\nbenzyl alcohol oxidation on Au/TiO2', 'utf8');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(vault, '.obsidian', 'secret.json'), '{"apiKey":"must-not-leak"}', 'utf8');

  harness = await startBridge({
    config: {
      workspaceRoot: vault,
      allowedRoots: [vault],
      adapters: {},
      scholarium: {
        enabled: true,
        vaultRoot: vault,
        allowedActions: ['rss.refresh_feed', 'project.list', 'project.get', 'experiment.scan_outcomes'],
      },
    },
  });
});

test.after(() => {
  if (harness) harness.stop();
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
});

test('rejects requests without the bridge token', async () => {
  const res = await request('/v1/scholarium/state?action=project.list');
  assert.equal(res.status, 401);
});

test('project.list returns the fixture project over HTTP', async () => {
  const res = await authed('/v1/scholarium/state?action=project.list');
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.action, 'project.list');
  assert.equal(payload.result.total, 1);
  assert.equal(payload.result.projects[0].display_id, 'PRJ-001');
  assert.equal(payload.result.projects[0].title, '端点测试课题');
});

test('project.get accepts a display_id and resolves it to the object', async () => {
  const res = await authed('/v1/scholarium/state?action=project.get&input=' + encodeURIComponent(JSON.stringify({ display_id: 'PRJ-001' })));
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).result.project.title, '端点测试课题');
});

test('malformed input JSON fails fast with 400', async () => {
  const res = await authed('/v1/scholarium/state?action=project.get&input=%7Bnot-json');
  assert.equal(res.status, 400);
});

test('an L1 action is refused and told to use the queued POST route', async () => {
  const res = await authed('/v1/scholarium/state?action=rss.refresh_feed');
  assert.equal(res.status, 409);
  assert.match(JSON.parse(res.body).error, /L0 read-only actions only/);
});

test('an action outside the whitelist is refused', async () => {
  const res = await authed('/v1/scholarium/state?action=vault.validate');
  assert.equal(res.status, 403);
});

test('state reads never write into the vault (no queue, no audit dir)', async () => {
  await authed('/v1/scholarium/state?action=project.list');
  await authed('/v1/scholarium/state?action=experiment.scan_outcomes');
  assert.equal(fs.existsSync(path.join(vault, 'Research', '_runs')), false, 'L0 reads must not create Research/_runs');
});

test('bounded vault search/read exposes research text but excludes Obsidian settings', async () => {
  // authedPost carries the harness token; the local TOKEN constant is gone.
  const authedPost = (pathname, payload) => harness.request(pathname, { method: 'POST', body: payload }).then(withBody);
  const searched = await authedPost('/v1/scholarium/vault/search', { query: 'benzyl alcohol', limit: 20 });
  assert.equal(searched.status, 200);
  const searchPayload = JSON.parse(searched.body);
  assert.deepEqual(searchPayload.matches.map((item) => item.path), ['Literature/gold-paper.md']);

  const read = await authedPost('/v1/scholarium/vault/read', { path: 'Literature/gold-paper.md' });
  assert.equal(read.status, 200);
  assert.match(JSON.parse(read.body).content, /Au\/TiO2/);

  const privateRead = await authedPost('/v1/scholarium/vault/read', { path: '.obsidian/secret.json' });
  assert.equal(privateRead.status, 400);
  assert.doesNotMatch(privateRead.body, /must-not-leak/);
});
