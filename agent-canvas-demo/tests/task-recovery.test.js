'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('task session survives a bridge restart and can resume', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-task-recovery-'));
  const config = path.join(dir, 'config.json');
  const session = '12345678-1234-1234-1234-123456789abc';
  const script = `console.log(JSON.stringify({type:'system',subtype:'init',session_id:'${session}'})); console.log(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'处理中'}]}})); console.log(JSON.stringify({type:'result',result:process.argv.includes('--resume')?'已恢复':'首次完成'}));`;
  fs.writeFileSync(config, JSON.stringify({ token: 'test-token', allowExecution: true, workspaceRoot: dir, allowedRoots: [dir], agentDetection: { status: 'ready' }, adapters: { claude: { command: process.execPath, args: ['-e', script, '--', '--output-format', 'json'], promptTransport: 'stdin', sandboxed: true } } }));
  let child;
  t.after(() => { if (child && child.exitCode === null) child.kill(); try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
  async function launch() {
    child = spawn(process.execPath, [path.join(__dirname, '../bridge/server.js')], { env: { ...process.env, AGENT_BRIDGE_CONFIG_PATH: config, AGENT_BRIDGE_PORT: '0' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    return await new Promise((resolve, reject) => { child.on('message', (m) => { if (m.type === 'listening') resolve(m.port); }); child.once('exit', (c) => reject(new Error(`bridge exited ${c}`))); });
  }
  let port = await launch();
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': 'test-token' };
  const request = async (url, body) => { const r = await fetch(`http://127.0.0.1:${port}${url}`, { headers, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) }); return { status: r.status, data: await r.json() }; };
  const created = await request('/v1/tasks', { agentId: 'claude', cwd: dir, prompt: 'test', conversationId: 'conversation-1', permission: 'read', execute: true });
  assert.equal(created.status, 202);
  const id = created.data.id;
  async function done(taskId) { for (let i = 0; i < 100; i++) { const r = await request(`/v1/tasks/${taskId}`); if (['completed', 'failed'].includes(r.data.status)) return r.data; await new Promise((resolve) => setTimeout(resolve, 50)); } throw new Error('task timeout'); }
  const first = await done(id);
  assert.equal(first.status, 'completed');
  assert.equal(first.sessionId, session);
  assert.ok(first.events.some((e) => e.text.includes('处理中')));
  await new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
  const recordPath = path.join(dir, 'chat-tasks', `${id}.json`);
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  record.status = 'cancelled'; record.pid = null;
  fs.writeFileSync(recordPath, JSON.stringify(record));
  port = await launch();
  assert.equal((await request('/v1/chat-tasks/latest?conversationId=conversation-1')).data.id, id);
  const resumed = await request(`/v1/tasks/${id}/resume`, {});
  assert.equal(resumed.status, 202);
  const second = await done(resumed.data.id);
  assert.equal(second.status, 'completed');
  assert.equal(second.finalMessage, '已恢复');
});
