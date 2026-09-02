"use strict";
// Real end-to-end test for GET /v1/agents/discover and POST
// /v1/agents/adapters: spawns the actual Bridge against a disposable config
// (same pattern as tests/scholarium-state-endpoint.test.js), with a fake
// executable planted on PATH so the "found and resolvable" path can be
// exercised without requiring any real agent CLI to be installed on the
// machine running this test.
//
// Why these routes exist: GET /v1/agents (agentStatus()) only ever reports
// on adapters already hand-written into bridge.config.json — useless on a
// fresh install where that object is empty. /discover probes PATH for the
// tools/known-agents.js registry regardless of what is configured, and
// POST /v1/agents/adapters lets a researcher turn a "found" result into a
// usable adapter with one click instead of hand-editing JSON.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const bridgePort = 46500 + (process.pid % 300);
const TOKEN = 'test-token-' + process.pid;

let bridge;
let vault;
let configPath;
let fakeBinDir;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: bridgePort, path: pathname, method: options.method || 'GET', headers: options.headers || {} },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
const authed = (pathname, options = {}) =>
  request(pathname, { ...options, headers: { 'x-agent-bridge-token': TOKEN, ...(options.headers || {}) } });

async function waitForBridge() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const res = await request('/health'); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('bridge did not start');
}

test.before(async () => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-discovery-vault-'));
  fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-discovery-fakebin-'));

  // A fake, harmless "codex" command on PATH so resolveCommand('codex')
  // actually resolves during this test, without depending on any real
  // agent CLI being installed on whatever machine runs the suite.
  // resolveCommand()'s Windows branch treats a *.cmd match specially -- it
  // parses the file for an npm-shim-style `"%dp0%\..."` relative-entry
  // reference and refuses anything that doesn't look like one, so a bare
  // placeholder .cmd is deliberately rejected by the real implementation.
  // A *.exe match has no such content requirement (only where.exe's PATH
  // search + a filename-extension check matter), so an empty dummy .exe is
  // the faithful, simplest fixture here.
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(fakeBinDir, 'codex.exe'), Buffer.from([0]));
  } else {
    const shPath = path.join(fakeBinDir, 'codex');
    fs.writeFileSync(shPath, '#!/bin/sh\necho fake codex\n');
    fs.chmodSync(shPath, 0o755);
  }

  configPath = path.join(os.tmpdir(), `agent-discovery-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN,
    allowExecution: false,
    workspaceRoot: vault,
    allowedRoots: [vault],
    // Pre-seed a hand-customized entry for one known id, to prove
    // POST /v1/agents/adapters never overwrites an adapter the researcher
    // already configured (by hand or by a previous call to this route).
    adapters: { opencode: { command: 'opencode', args: ['run', '--custom-flag', '{{prompt}}'] } },
  }, null, 2), 'utf8');

  // Build a PATH containing ONLY fakeBinDir plus the bare minimum Windows
  // needs to run where.exe/cmd.exe itself (System32) -- deliberately
  // excluding the rest of this machine's real PATH, so a real agent CLI
  // that happens to already be installed here (this is a working dev
  // machine, not a clean CI box) can never leak into these results. That
  // is also a more faithful test of the actual feature: "a fresh install
  // on a machine whose PATH we don't control" is exactly the case
  // discovery exists for. process.env may expose the Windows PATH variable
  // under either casing (PATH or Path); strip both before setting our own,
  // since leaving one of the original casings in place would let the real
  // PATH win for that key even though we set the other.
  const childEnv = { ...process.env };
  delete childEnv.PATH;
  delete childEnv.Path;
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || 'C:\\Windows';
  const isolatedPath = process.platform === 'win32'
    ? [fakeBinDir, path.join(systemRoot, 'System32'), systemRoot].join(path.delimiter)
    : [fakeBinDir, '/usr/bin', '/bin'].join(path.delimiter);
  childEnv.PATH = isolatedPath;
  if (process.platform === 'win32') childEnv.Path = isolatedPath;

  bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...childEnv, AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (configPath && fs.existsSync(configPath)) fs.rmSync(configPath);
  if (vault && fs.existsSync(vault)) fs.rmSync(vault, { recursive: true, force: true });
  if (fakeBinDir && fs.existsSync(fakeBinDir)) fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

test('rejects requests without the bridge token', async () => {
  const res = await request('/v1/agents/discover');
  assert.equal(res.status, 401);
});

test('reports all known agents with the expected shape, regardless of what is configured', async () => {
  const res = await authed('/v1/agents/discover');
  assert.equal(res.status, 200);
  const { agents } = JSON.parse(res.body);
  assert.equal(agents.length, 8);
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  for (const id of ['claude', 'codex', 'opencode', 'hermes', 'openclaw', 'pi', 'dsh', 'kimi']) {
    assert.ok(byId[id], `missing ${id} from the discovery response`);
    assert.equal(typeof byId[id].label, 'string');
    assert.equal(typeof byId[id].available, 'boolean');
    assert.equal(typeof byId[id].alreadyConfigured, 'boolean');
  }
});

test('the fake-PATH codex resolves as available with a real path', async () => {
  const { agents } = JSON.parse((await authed('/v1/agents/discover')).body);
  const codex = agents.find((a) => a.id === 'codex');
  assert.equal(codex.available, true);
  assert.match(codex.path, /codex/i);
  assert.equal(codex.alreadyConfigured, false);
});

test('an agent genuinely absent from PATH resolves as unavailable', async () => {
  const { agents } = JSON.parse((await authed('/v1/agents/discover')).body);
  const kimi = agents.find((a) => a.id === 'kimi');
  assert.equal(kimi.available, false);
  assert.equal(kimi.path, null);
});

test('a pre-configured adapter is reported as alreadyConfigured', async () => {
  const { agents } = JSON.parse((await authed('/v1/agents/discover')).body);
  const opencode = agents.find((a) => a.id === 'opencode');
  assert.equal(opencode.alreadyConfigured, true);
});

test('POST /v1/agents/adapters rejects an id outside the known-agents registry', async () => {
  const res = await authed('/v1/agents/adapters', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'not-a-real-agent' }),
  });
  assert.equal(res.status, 404);
});

test('POST /v1/agents/adapters refuses to enable a command that is not on PATH', async () => {
  const res = await authed('/v1/agents/adapters', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'kimi' }),
  });
  assert.equal(res.status, 409);
});

test('POST /v1/agents/adapters is a no-op for an id already configured, and never overwrites its custom args', async () => {
  const res = await authed('/v1/agents/adapters', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'opencode' }),
  });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.alreadyConfigured, true);
  const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.deepEqual(onDisk.adapters.opencode.args, ['run', '--custom-flag', '{{prompt}}']);
});

test('POST /v1/agents/adapters enables a newly-found agent and persists it to bridge.config.json', async () => {
  const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(before.adapters.codex, undefined);

  const res = await authed('/v1/agents/adapters', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'codex' }),
  });
  assert.equal(res.status, 201);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.alreadyConfigured, false);
  assert.match(payload.path, /codex/i);

  const onDisk = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.ok(onDisk.adapters.codex, 'codex adapter should now be persisted on disk');
  assert.equal(onDisk.adapters.codex.command, 'codex');
  assert.deepEqual(onDisk.adapters.codex.args, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--json', '{{prompt}}']);
  // the pre-existing custom opencode adapter must still be untouched by this write
  assert.deepEqual(onDisk.adapters.opencode.args, ['run', '--custom-flag', '{{prompt}}']);

  // and the existing configured-only list now reports it too
  const listPayload = JSON.parse((await authed('/v1/agents')).body);
  assert.ok(listPayload.agents.some((a) => a.id === 'codex' && a.installed === true));
});

test('enabling the same agent again is idempotent (200, not a duplicate write)', async () => {
  const res = await authed('/v1/agents/adapters', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'codex' }),
  });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).alreadyConfigured, true);
});
