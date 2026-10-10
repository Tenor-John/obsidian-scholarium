/* research lane 派发门槛测试：
 * - lane:'research' 适配器在 researchLaneEnabled=false 时必须被拒（fail-closed）
 * - researchLaneEnabled=true 时放行
 * - 无 lane 标记且 sandboxed!==true 的适配器仍然被拒（原有行为不变） */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Capabilities = require('../../tools/agent-capabilities.js');

function researchArgs(script) {
  // Everything after `--` is delivered to the synthetic node program as argv,
  // while still letting Bridge validate the same explicit capability contract
  // required from the real claude-research adapter.
  return [
    '-e', script, '--',
    '--tools', Capabilities.CLAUDE_RESEARCH_TOOLS,
    '--allowedTools', Capabilities.CLAUDE_RESEARCH_ALLOWED_TOOLS,
  ];
}

function startBridge(tmp, configPath) {
  const bridgePath = path.join(__dirname, '..', 'bridge', 'server.js');
  const launcher = `
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
  const child = spawn(process.execPath, ['-e', launcher], {
    env: {
      ...process.env,
      AGENT_BRIDGE_PORT: '0',
      AGENT_BRIDGE_CONFIG_PATH: configPath,
      AGENT_BRIDGE_SECRETS_PATH: path.join(tmp, 's.env'),
    },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const port = new Promise((resolve, reject) => {
    child.once('message', (message) => {
      if (message?.type === 'listening' && Number.isInteger(message.port) && message.port > 0) resolve(message.port);
      else reject(new Error(`Bridge reported an invalid listening port: ${JSON.stringify(message)}`));
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      reject(new Error(`Bridge exited before reporting its port (code=${code}, signal=${signal})`));
    });
  });
  return { child, port };
}

async function waitForBridge(port, child, timeoutMs = 10000) {
  let lastError = null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((r) => setTimeout(r, Math.min(100, Math.max(1, deadline - Date.now()))));
  }
  throw new Error(`Bridge did not become healthy on dynamic port ${port} within ${timeoutMs}ms: ${lastError?.message || 'unknown error'}`);
}

async function stopBridge(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function removeTempDir(tmp) {
  for (let i = 0; i < 5; i++) {
    try { fs.rmSync(tmp, { recursive: true, force: true }); return; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

async function cleanupBridge(child, tmp) {
  await stopBridge(child);
  await removeTempDir(tmp);
}

async function withBridge(t, adapters, extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-test-'));
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const configPath = path.join(tmp, 'bridge.config.json');
  if (extra?.scholarium?.vaultRoot === '$workspace') extra = { ...extra, scholarium: { ...extra.scholarium, vaultRoot: workspace } };
  fs.writeFileSync(configPath, JSON.stringify({
    token: 'lanetoken', allowExecution: true, workspaceRoot: workspace, allowedRoots: [workspace],
    skillDirectories: [], scholarium: { enabled: false, vaultRoot: workspace, allowedActions: [] },
    fullTaskCategories: {}, adapters, ...extra,
  }), 'utf8');
  const { child, port } = startBridge(tmp, configPath);
  t.after(() => cleanupBridge(child, tmp));
  const PORT = await port;
  await waitForBridge(PORT, child);
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': 'lanetoken' };
  const dispatch = (agentId, prompt = 'ping') => fetch(`http://127.0.0.1:${PORT}/v1/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ agentId, cwd: workspace, prompt, permission: 'read', execute: true }),
  }).then((r) => r.json());
  dispatch.configPath = configPath;
  dispatch.task = (id) => fetch(`http://127.0.0.1:${PORT}/v1/tasks/${id}`, { headers }).then((r) => r.json());
  return dispatch;
}

test('lane:research 在 researchLaneEnabled=false 时被拒', async (t) => {
  const dispatch = await withBridge(t, { fake: { command: 'node', args: researchArgs('1'), lane: 'research' } }, { researchLaneEnabled: false });
  const res = await dispatch('fake');
  assert.equal(res.error?.includes('refusing to dispatch'), true);
});

test('lane:research 在 researchLaneEnabled=true 时放行', async (t) => {
  const dispatch = await withBridge(t, { fake: { command: 'node', args: researchArgs('1'), lane: 'research' } }, { researchLaneEnabled: true });
  const res = await dispatch('fake');
  assert.ok(['queued', 'running'].includes(res.status), `expected dispatch accepted, got ${JSON.stringify(res)}`);
});

test('科研车道通过 stdin 完整接收超过旧 Windows argv 上限的提示词', async (t) => {
  const script = [
    'let input="";',
    'process.stdin.setEncoding("utf8");',
    'process.stdin.on("data", chunk => input += chunk);',
    'process.stdin.on("end", () => console.log(JSON.stringify({type:"result",is_error:false,result:`LEN=${input.length};TAIL=${input.slice(-8)}`,permission_denials:[]})));',
  ].join('');
  const adapters = {
    fake: { command: 'node', args: researchArgs(script), lane: 'research', promptTransport: 'stdin' },
  };
  const dispatch = await withBridge(t, adapters, { researchLaneEnabled: true });
  const prompt = '长'.repeat(70000) + 'END-MARK';
  const created = await dispatch('fake', prompt);
  assert.ok(created.id, JSON.stringify(created));
  let info = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    info = await dispatch.task(created.id);
    if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
  }
  assert.equal(info.status, 'completed', JSON.stringify(info));
  assert.ok(
    (info.events || []).some((event) => event.type === 'result' && event.text === `LEN=${prompt.length};TAIL=END-MARK`),
    JSON.stringify({ status: info.status, events: info.events, stderr: info.stderr, diagnostics: info.diagnostics }),
  );
});

test('research Agent receives a scoped MCP capability that can read but cannot submit writes', async (t) => {
  const script = `
    (async()=>{
      const base=process.env.SCHOLARIUM_MCP_BRIDGE_URL;
      const token=process.env.SCHOLARIUM_MCP_READ_TOKEN;
      const headers={'x-scholarium-mcp-token':token};
      const read=await fetch(base+'/v1/scholarium/state?action=project.list',{headers});
      const write=await fetch(base+'/v1/scholarium/actions',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'workspace.task_add',input:{title:'must not run'}})});
      process.stdout.write(JSON.stringify({type:'result',is_error:false,result:JSON.stringify({read:read.status,write:write.status,mcp:!!process.env.SCHOLARIUM_MCP_SERVER_PATH})}));
    })().catch((e)=>{process.stderr.write(e.stack);process.exit(1)})`;
  const dispatch = await withBridge(t, { fake: { command: 'node', args: researchArgs(script), lane: 'research' } }, {
    researchLaneEnabled: true,
    scholarium: { enabled: true, vaultRoot: '$workspace', allowedActions: ['project.list', 'workspace.task_add'] },
  });
  const created = await dispatch('fake');
  let info;
  for (let i = 0; i < 40; i++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    info = await dispatch.task(created.id);
    if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
  }
  const evidence = (info.events || []).map((event) => event.text).join('\n');
  assert.match(evidence, /"read":200/);
  assert.match(evidence, /"write":401/);
  assert.match(evidence, /"mcp":true/);
  assert.equal(Object.prototype.hasOwnProperty.call(info, 'mcpReadToken'), false, 'scoped token must never be serialized in task responses');
});

test('researchLaneEnabled 热改后无需重启即可启用，并在字段删除时 fail-closed', async (t) => {
  const adapters = { fake: { command: 'node', args: researchArgs('1'), lane: 'research' } };
  const dispatch = await withBridge(t, adapters, { researchLaneEnabled: false });

  const disabled = await dispatch('fake');
  assert.equal(disabled.error?.includes('refusing to dispatch'), true);

  const enabledConfig = JSON.parse(fs.readFileSync(dispatch.configPath, 'utf8'));
  enabledConfig.researchLaneEnabled = true;
  fs.writeFileSync(dispatch.configPath, JSON.stringify(enabledConfig), 'utf8');
  const enabledTime = new Date(Date.now() + 2000);
  fs.utimesSync(dispatch.configPath, enabledTime, enabledTime);
  const enabled = await dispatch('fake');
  assert.ok(['queued', 'running'].includes(enabled.status), `expected hot-enabled dispatch, got ${JSON.stringify(enabled)}`);

  const missingConfig = JSON.parse(fs.readFileSync(dispatch.configPath, 'utf8'));
  delete missingConfig.researchLaneEnabled;
  fs.writeFileSync(dispatch.configPath, JSON.stringify(missingConfig), 'utf8');
  const missingTime = new Date(Date.now() + 4000);
  fs.utimesSync(dispatch.configPath, missingTime, missingTime);
  const missing = await dispatch('fake');
  assert.equal(missing.error?.includes('refusing to dispatch'), true);
});

test('Claude stream-json 的 tool_result 会按工具关联并区分成功与失败', async (t) => {
  const stream = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'shell-1', name: 'PowerShell', input: { command: 'curl.exe -s https://api.openalex.org/works' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'shell-1', content: '{"meta":{"count":1},"results":[{"doi":"10.1/example"}]}' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'web-1', name: 'WebSearch', input: { query: 'plasmonic catalysis' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'web-1', is_error: true, content: 'network denied' }] } },
    { type: 'result', is_error: false, result: 'done' },
  ].map((item) => JSON.stringify(item)).join('\n');
  // 刻意从 JSON 行中间拆成两次 stdout 写入，并让最后一行没有换行符；Bridge
  // 必须跨 data chunk 缓冲，并在 close 时刷新尾行。
  const script = `const out=${JSON.stringify(stream)}; const cut=Math.floor(out.length/2); process.stdout.write(out.slice(0,cut)); setTimeout(()=>process.stdout.write(out.slice(cut)),25)`;
  const dispatch = await withBridge(t, { fake: { command: 'node', args: researchArgs(script), lane: 'research' } }, { researchLaneEnabled: true });
  const created = await dispatch('fake');
  assert.ok(created.id, JSON.stringify(created));

  let info = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    info = await dispatch.task(created.id);
    if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
  }
  const texts = (info.events || []).map((event) => event.text);
  assert.ok(texts.some((text) => /工具返回 PowerShell（成功）.*"results"/.test(text)), texts.join('\n'));
  assert.ok(texts.some((text) => /工具返回 WebSearch（失败）：network denied/.test(text)), texts.join('\n'));
  assert.equal(Object.prototype.hasOwnProperty.call(info, '_claudeToolNames'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(info, '_stdoutLineBuffer'), false);
});

test('旧配置缺省 researchLaneEnabled=false（loadConfig fail-closed 回填）', async (t) => {
  // 不传 researchLaneEnabled 字段，模拟 2026-08-21 之前的旧配置
  const dispatch = await withBridge(t, { fake: { command: 'node', args: researchArgs('1'), lane: 'research' } });
  const res = await dispatch('fake');
  assert.equal(res.error?.includes('refusing to dispatch'), true);
});

test('无 lane 且无 sandboxed 的适配器依旧被拒（原行为不变）', async (t) => {
  const dispatch = await withBridge(t, { fake: { command: 'node', args: ['-e', '1'] } }, { researchLaneEnabled: true });
  const res = await dispatch('fake');
  assert.equal(res.error?.includes('refusing to dispatch'), true);
});

test('防御性快照仍能检出异常研究进程产生的净写入', async (t) => {
  // 用 node 子进程模拟"会写文件的 Agent"：不需要真实 Claude，验证 start() 的
  // 快照 diff 逻辑本身（越界探测需真实模型，由 probe-path-scope.js 负责）。
  const writeSnippet = 'require("node:fs").writeFileSync("audit-target.md","x")';
  let bridge;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-audit-'));
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const configPath = path.join(tmp, 'bridge.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    token: 'lanetoken', allowExecution: true, workspaceRoot: workspace, allowedRoots: [workspace],
    skillDirectories: [], scholarium: { enabled: false, vaultRoot: workspace, allowedActions: [] },
    fullTaskCategories: {}, researchLaneEnabled: true,
    adapters: { fake: { command: 'node', args: researchArgs(writeSnippet), lane: 'research' } },
  }), 'utf8');
  const { child, port } = startBridge(tmp, configPath);
  t.after(() => cleanupBridge(child, tmp));
  const PORT = await port;
  await waitForBridge(PORT, child);
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': 'lanetoken' };
  const created = await fetch(`http://127.0.0.1:${PORT}/v1/tasks`, {
    method: 'POST', headers,
    body: JSON.stringify({ agentId: 'fake', cwd: workspace, prompt: 'p', permission: 'read', execute: true }),
  }).then((r) => r.json());
  assert.ok(created.id, JSON.stringify(created));
  let info = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    info = await fetch(`http://127.0.0.1:${PORT}/v1/tasks/${created.id}`, { headers }).then((r) => r.json());
    if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
  }
  assert.equal(fs.existsSync(path.join(workspace, 'audit-target.md')), true);
  const auditEvent = (info.events || []).find((e) => /本轮实际写入了 1 个文件/.test(e.text));
  assert.ok(auditEvent, '应产生写入审计事件');
  assert.ok(auditEvent.text.includes('audit-target.md'));
  void bridge;
});
