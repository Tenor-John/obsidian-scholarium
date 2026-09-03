"use strict";
// Regression test for the 2026-09-03 cross-vault contamination report: two
// Obsidian vaults opened at once on the same machine used to race for the
// same hardcoded Bridge port (127.0.0.1:4318), so whichever vault's
// launcher started first silently became "the" Bridge for every vault --
// wrong "vaultRoot outside allowedRoots" errors, and one vault's task
// history showing another vault's runs.
//
// The fix (src/weaver-vault-ports.js) derives each vault's own canvas/
// bridge port pair from its absolute path. This test simulates the actual
// reported scenario end-to-end: two real Bridge processes, spawned with
// the exact ports that function would derive for two different vault
// paths, each with its own fixture project and its own bearer token, run
// concurrently -- and proves each only ever answers with its own vault's
// data, never the other's.
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
const { deriveWeaverPorts } = require(path.join(pluginRoot, 'src', 'weaver-vault-ports.js'));

function request(port, pathname, token) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method: 'GET', headers: token ? { 'x-agent-bridge-token': token } : {} },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => { raw += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function waitHealthy(port) {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const res = await request(port, '/health'); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`bridge on port ${port} never became healthy`);
}

async function spawnVaultBridge(label, projectTitle) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), `dual-vault-${label}-`));
  const dir = path.join(vault, 'Research', 'Projects');
  fs.mkdirSync(dir, { recursive: true });
  const prj = S.createObject('project', { title: projectTitle, status: 'active' });
  fs.writeFileSync(path.join(dir, 'PRJ-001.md'), S.serializeObject(prj, `\n# ${projectTitle}\n`), 'utf8');

  // The same derivation research-weaver-mount.ts's constructor uses --
  // this is what makes the test faithful to the real fix rather than an
  // arbitrary port pair.
  const ports = deriveWeaverPorts(vault);
  const token = `token-${label}-${process.pid}`;
  const configPath = path.join(os.tmpdir(), `dual-vault-${label}-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token, allowExecution: false, workspaceRoot: vault, allowedRoots: [vault], adapters: {},
    scholarium: { enabled: true, vaultRoot: vault, allowedActions: ['project.list', 'project.get'] },
  }, null, 2), 'utf8');

  const bridge = spawn(process.execPath, [path.join(root, 'bridge', 'server.js')], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(ports.bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath },
    stdio: 'ignore', windowsHide: true,
  });
  await waitHealthy(ports.bridgePort);
  return { vault, ports, token, configPath, bridge };
}

function cleanupVaultBridge(handle) {
  if (handle.bridge && !handle.bridge.killed) handle.bridge.kill();
  if (fs.existsSync(handle.configPath)) fs.rmSync(handle.configPath);
  if (fs.existsSync(handle.vault)) fs.rmSync(handle.vault, { recursive: true, force: true });
}

let vaultA;
let vaultB;

test.before(async () => {
  [vaultA, vaultB] = await Promise.all([
    spawnVaultBridge('research-mod', 'ResearchMod 课题真实标题'),
    spawnVaultBridge('scholarium-test', 'ScholariumTest 课题真实标题'),
  ]);
});

test.after(() => {
  cleanupVaultBridge(vaultA);
  cleanupVaultBridge(vaultB);
});

test('two vaults derive different ports (the actual precondition for isolation)', () => {
  assert.notEqual(vaultA.ports.bridgePort, vaultB.ports.bridgePort);
  assert.notEqual(vaultA.ports.canvasPort, vaultB.ports.canvasPort);
});

test('each vault Bridge answers project.list with ONLY its own fixture project', async () => {
  const resA = await request(vaultA.ports.bridgePort, '/v1/scholarium/state?action=project.list', vaultA.token);
  const resB = await request(vaultB.ports.bridgePort, '/v1/scholarium/state?action=project.list', vaultB.token);
  assert.equal(resA.status, 200);
  assert.equal(resB.status, 200);
  const projectsA = JSON.parse(resA.body).result.projects;
  const projectsB = JSON.parse(resB.body).result.projects;
  assert.equal(projectsA.length, 1);
  assert.equal(projectsB.length, 1);
  assert.equal(projectsA[0].title, 'ResearchMod 课题真实标题');
  assert.equal(projectsB[0].title, 'ScholariumTest 课题真实标题');
});

test('a vault\'s bearer token is refused by the other vault\'s Bridge process', async () => {
  const crossA = await request(vaultA.ports.bridgePort, '/v1/scholarium/state?action=project.list', vaultB.token);
  const crossB = await request(vaultB.ports.bridgePort, '/v1/scholarium/state?action=project.list', vaultA.token);
  assert.equal(crossA.status, 401);
  assert.equal(crossB.status, 401);
});
