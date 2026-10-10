'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');

test('stdio MCP exposes Scholarium tools and forwards state with the scoped token', async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, token: req.headers['x-scholarium-mcp-token'] });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ action: 'project.list', result: { total: 2 } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'bridge', 'scholarium-mcp.js')], {
    env: { ...process.env, SCHOLARIUM_MCP_BRIDGE_URL: `http://127.0.0.1:${port}`, SCHOLARIUM_MCP_READ_TOKEN: 'scoped-read-token' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = [];
  lines.on('line', (line) => pending.shift()?.(JSON.parse(line)));
  const rpc = (message) => new Promise((resolve) => { pending.push(resolve); child.stdin.write(JSON.stringify(message) + '\n'); });

  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'scholarium');
  const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(listed.result.tools.map((item) => item.name), ['scholarium_state', 'vault_search', 'vault_read', 'rescan_checkpoint_mark']);
  const called = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'scholarium_state', arguments: { action: 'project.list' } } });
  assert.equal(JSON.parse(called.result.content[0].text).result.total, 2);
  assert.equal(seen[0].token, 'scoped-read-token');
  assert.match(seen[0].url, /^\/v1\/scholarium\/state\?action=project.list/);
});
