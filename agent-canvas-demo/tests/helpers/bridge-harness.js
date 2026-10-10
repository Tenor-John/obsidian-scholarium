'use strict';
/* Shared harness for every test that needs a live Bridge.
 *
 * Why this exists: the suite grew four different port strategies, and three of
 * them are unsound on a real machine.
 *
 *   - a fixed port (4407) cannot be bound at all when it falls inside a Windows
 *     excluded port range. That is EACCES, not EADDRINUSE, so it survives every
 *     "is this port free?" check and looks like flakiness forever.
 *   - `46500 + (pid % 300)` has 300 slots, verifies nothing, and collides.
 *   - `freePort()` binds :0, reads the port and closes it, leaving a window in
 *     which another test can take it before the Bridge binds.
 *
 * The only sound option is to let the OS assign the port to the Bridge itself
 * and have the Bridge report back what it actually got. That removes the race,
 * the excluded-range problem, and the need to probe anything.
 *
 * The harness also keeps the Bridge's output. Tests used to spawn it with
 * stdio 'ignore', so a failure to start surfaced only as "Bridge did not start"
 * with the real cause discarded - the same silent-failure shape this project
 * has been removing everywhere else.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const BRIDGE = path.join(__dirname, '..', '..', 'bridge', 'server.js');
const START_TIMEOUT_MS = 20000;

// Patch listen() in the child so the Bridge reports its real port over IPC.
// Injecting it here keeps server.js free of test-only code.
const launcher = (bridgePath) => `
  const http = require('node:http');
  const originalListen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (...args) {
    this.once('listening', () => {
      if (process.send) process.send({ type: 'listening', port: this.address().port });
    });
    return originalListen.apply(this, args);
  };
  require(${JSON.stringify(bridgePath)});
`;

async function startBridge(options = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-harness-'));
  const configPath = path.join(scratch, 'bridge.config.json');
  const token = options.token || `test-${Math.random().toString(16).slice(2, 14)}`;

  const base = {
    token,
    allowExecution: false,
    workspaceRoot: scratch,
    allowedRoots: [scratch],
  };
  const supplied = typeof options.config === 'function' ? options.config(scratch) : options.config;
  // JSON.stringify, never a shell redirect: a UTF-8 BOM makes the config
  // unparseable and the Bridge exits before it ever binds.
  fs.writeFileSync(configPath, JSON.stringify({ ...base, ...(supplied || {}) }, null, 2));

  const suppliedEnv = typeof options.env === 'function' ? options.env(scratch) : options.env;
  const child = spawn(process.execPath, ['-e', launcher(BRIDGE)], {
    env: {
      ...process.env,
      AGENT_BRIDGE_PORT: '0',
      AGENT_BRIDGE_CONFIG_PATH: configPath,
      AGENT_BRIDGE_SECRETS_PATH: path.join(scratch, 'secrets.env'),
      ...(suppliedEnv || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });

  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.stdout.on('data', (chunk) => { output += chunk; });

  const cleanup = () => {
    try { child.kill(); } catch { /* already gone */ }
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  const port = await new Promise((resolve, reject) => {
    const detail = () => `\n--- bridge output ---\n${output.trim() || '(nothing on stdout/stderr)'}`;
    const timer = setTimeout(() => {
      reject(new Error(`Bridge did not report a port within ${START_TIMEOUT_MS}ms.${detail()}`));
    }, START_TIMEOUT_MS);
    const fail = (message) => { clearTimeout(timer); reject(new Error(message + detail())); };
    child.once('message', (message) => {
      if (message && message.type === 'listening' && Number.isInteger(message.port) && message.port > 0) {
        clearTimeout(timer);
        resolve(message.port);
      } else fail(`Bridge reported an invalid listening message: ${JSON.stringify(message)}`);
    });
    child.once('error', (error) => fail(`Bridge failed to spawn: ${error.message}`));
    child.once('exit', (code, signal) => fail(`Bridge exited before listening (code=${code} signal=${signal}).`));
  }).catch((error) => { cleanup(); throw error; });

  const request = (pathname, init = {}) => new Promise((resolve, reject) => {
    const body = init.body === undefined ? undefined
      : (typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
    // auth: false sends no bearer token, so tests can assert the 401 path.
    const auth = init.auth === false ? {} : { 'x-agent-bridge-token': init.token || token };
    const req = http.request({
      host: '127.0.0.1', port, path: pathname, method: init.method || 'GET',
      headers: {
        ...auth,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.headers || {}),
      },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text, headers: res.headers }));
    });
    req.once('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

  const json = async (pathname, init) => {
    const res = await request(pathname, init);
    try { return { ...res, body: JSON.parse(res.text) }; }
    catch { return { ...res, body: null }; }
  };

  return { port, token, scratch, configPath, child, request, json, output: () => output, stop: cleanup };
}

module.exports = { startBridge };
