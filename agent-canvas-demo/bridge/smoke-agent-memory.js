/* 冒烟测试：/v1/agent-memory/* 四个端点的真实行为（临时工作区，不碰真实 Vault） */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-mem-smoke-'));
const workspace = path.join(tmp, 'workspace');
fs.mkdirSync(workspace, { recursive: true });
const configPath = path.join(tmp, 'bridge.config.json');
const token = 'smoketoken123';
fs.writeFileSync(configPath, JSON.stringify({
  token, allowExecution: false, workspaceRoot: workspace, allowedRoots: [workspace],
  skillDirectories: [], scholarium: { enabled: false, vaultRoot: workspace, allowedActions: [] },
  fullTaskCategories: {}, adapters: {},
}), 'utf8');

const PORT = 4519;
const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  env: { ...process.env, AGENT_BRIDGE_PORT: String(PORT), AGENT_BRIDGE_CONFIG_PATH: configPath },
  stdio: 'ignore',
});
const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': token };
const call = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers, ...opts }).then((r) => r.json());

(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  try {
    // 1. 上下文装载：首次调用应创建 6 个记忆文件
    const ctx1 = await call('/v1/agent-memory/context?query=' + encodeURIComponent('钙钛矿 稳定性 湿度'));
    console.log('context.ok:', ctx1.ok, '| block length:', (ctx1.block || '').length);
    const memDir = path.join(workspace, '.scholarium', 'agent');
    console.log('files created:', fs.readdirSync(memDir).sort().join(', '));

    // 2. 追加一条待确认决策，再检索应命中
    const entry = await call('/v1/agent-memory/entry', { method: 'POST', body: JSON.stringify({
      file: 'decisions.md', title: '湿度稳定性测试用 85%RH', body: '决定用 85%RH/85°C 双85条件做钙钛矿湿度老化，理由：行业标准。', status: '待确认',
    }) });
    console.log('entry.ok:', entry.ok, '| status:', entry.status);
    const ctx2 = await call('/v1/agent-memory/context?query=' + encodeURIComponent('钙钛矿 湿度 老化条件'));
    console.log('context includes decision:', ctx2.block.includes('85%RH'));

    // 3. 无命中关键词时仍保留最新条目（兜底）
    const ctx3 = await call('/v1/agent-memory/context?query=' + encodeURIComponent('zzzqqq'));
    console.log('fallback keeps latest entry:', ctx3.block.includes('85%RH'));

    // 4. checkpoint：结构化字段拼成标准格式并落盘
    const cp = await call('/v1/agent-memory/checkpoint', { method: 'POST', body: JSON.stringify({
      lastQuestion: '双85条件是否合理？', replyExcerpt: '合理，但建议补充湿热循环作为对照……', nextStep: '检索 IEC 61215 标准原文',
    }) });
    console.log('checkpoint.ok:', cp.ok);
    const cpContent = fs.readFileSync(path.join(memDir, 'task-checkpoint.md'), 'utf8');
    console.log('checkpoint file has nextStep:', cpContent.includes('IEC 61215'));

    // 5. 全量查看端点
    const all = await call('/v1/agent-memory');
    console.log('list.ok:', all.ok, '| files:', Object.keys(all.files).length);

    // 6. 非法文件名被拒
    const bad = await call('/v1/agent-memory/entry', { method: 'POST', body: JSON.stringify({ file: 'profile.md', title: 'x', body: 'y' }) });
    console.log('entry to profile.md rejected:', Boolean(bad.error));
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error('SMOKE FAIL:', e.message); child.kill(); process.exit(1); });
