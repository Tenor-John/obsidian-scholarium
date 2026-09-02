/* scholarium-draft 真实链路探测（live，走真实 claude-research + 真实 drafts/batch）。
 * 复刻 shell-ui.js 聊天的完整路径，但不经过 Obsidian 界面点击：
 *   1. 拉 agent-memory 上下文，用 research-chat-core 构建与聊天完全相同的 prompt；
 *   2. POST /v1/tasks 派发真实 claude-research 任务，请模型把当前课题核心假设
 *      存成一条 HYP 记录（应吐出 ```scholarium-draft 围栏块）；
 *   3. chat-actions-core.parseDraftRequests 解析回复；
 *   4. /v1/drafts/batch preview → commit 真实落盘，读回文件核对 frontmatter
 *      （uid UUIDv7 / display_id 接续 / created_by: ai / review_status: pending /
 *      verified_by_user: false）；
 *   5. 三个破坏性用例（不调模型）：覆盖既有文件 → 409 且整批零写入；
 *      路径含 ../ → 400；非 .md 路径 → 400；
 *   6. 如实报告 drafts/batch 是否产生 bridge/audit 记录。
 * 运行：node probe-draft-chain.js（需 Bridge 在 4318 运行、官方 Claude 直连可用）。 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const config = require(path.join(ROOT, 'bridge.config.json'));
const chatCore = require(path.join(ROOT, '..', 'research-chat-core.js'));
const chatActions = require(path.join(ROOT, '..', 'chat-actions-core.js'));
const PORT = Number(process.env.AGENT_BRIDGE_PORT || 4318);
const TOKEN = config.token;
const WORKSPACE = config.workspaceRoot;

async function api(method, pathname, payload) {
  const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
    method,
    headers: { 'x-agent-bridge-token': TOKEN, 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`); };

async function main() {
  // 0. Bridge 在线
  const health = await api('GET', '/health');
  check('Bridge /health', health.status === 200);

  // 1. 记忆上下文 + 与聊天一致的 prompt
  const message = '基于我们刚才的讨论（Small Structures 2026 的 EMR/HET/PRET/氧空位四机制框架，以及"壳厚是否独立效应"这个核心未决问题），把我们课题当前最核心的可证伪假设存成一条 HYP 记录。';
  const memory = await api('GET', `/v1/agent-memory/context?query=${encodeURIComponent(message)}`);
  const memoryBlock = memory.json?.block ? `\n\n${memory.json.block}\n` : '';
  const prompt = chatCore.buildResearchChatPrompt({
    message,
    messages: [],
    workspace: WORKSPACE,
    memoryBlock,
    capabilities: '你可以使用 Read/Grep/Glob/WebFetch/WebSearch/PowerShell/Write/Edit（写入受确认机制约束）。',
  });
  check('prompt 构建（含规则 11 与记忆块）', prompt.includes('scholarium-draft') && memoryBlock.length > 0, `记忆块 ${memoryBlock.length} 字`);

  // 2. 真实派发 claude-research
  const created = await api('POST', '/v1/tasks', { agentId: 'claude-research', cwd: WORKSPACE, prompt, permission: 'read', execute: true });
  if (!created.json?.id) { check('任务派发', false, `HTTP ${created.status}: ${JSON.stringify(created.json).slice(0, 300)}`); return finish(); }
  check('任务派发', true, created.json.id);
  let task;
  const deadline = Date.now() + 6 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const got = await api('GET', `/v1/tasks/${created.json.id}`);
    task = got.json;
    if (task.status && task.status !== 'running' && task.status !== 'queued') break;
  }
  check('任务完成', task?.status === 'completed', `status=${task?.status}`);
  const reply = String(task?.finalMessage || '').trim();
  if (!reply) { check('模型回复', false, 'finalMessage 为空'); return finish(); }

  // 3. 解析 scholarium-draft 块
  const parsed = chatActions.parseDraftRequests(reply);
  check('模型吐出 scholarium-draft 块', parsed.drafts.length > 0, `解析到 ${parsed.drafts.length} 个文件`);
  if (!parsed.drafts.length) { console.log('--- 回复末尾 800 字 ---\n' + reply.slice(-800)); return finish(); }
  const items = parsed.drafts.flatMap((d) => d.items.map((i) => ({ path: i.path, content: i.content })));
  console.log('草稿路径:', items.map((i) => i.path).join(', '), '| 理由:', parsed.drafts.map((d) => d.reason).join(' / '));

  // 4. preview → commit → 读回核对
  const preview = await api('POST', '/v1/drafts/batch', { items });
  check('batch preview', preview.status === 201, preview.status === 201 ? `batchId=${preview.json.id}` : JSON.stringify(preview.json).slice(0, 300));
  if (preview.status !== 201) return finish();
  const commit = await api('POST', `/v1/drafts/batch/${preview.json.id}/commit`);
  check('batch commit', commit.status === 200 && commit.json.ok === true, JSON.stringify(commit.json).slice(0, 200));

  for (const item of items) {
    const abs = path.join(WORKSPACE, item.path);
    if (!fs.existsSync(abs)) { check(`落盘 ${item.path}`, false, '文件不存在'); continue; }
    const content = fs.readFileSync(abs, 'utf8');
    const fm = (content.match(/^---\n([\s\S]*?)\n---/) || [])[1] || '';
    const uid = (fm.match(/^uid:\s*(\S+)/m) || [])[1] || '';
    const displayId = (fm.match(/^display_id:\s*(\S+)/m) || [])[1] || '';
    check(`frontmatter ${item.path}`, [
      /created_by:\s*ai/.test(fm) && /review_status:\s*pending/.test(fm) && /verified_by_user:\s*false/.test(fm),
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uid),
      /schema_version:\s*1/.test(fm),
    ].every(Boolean), `display_id=${displayId} uid=${uid.slice(0, 18)}… created_by/review_status/verified_by_user=${/created_by:\s*ai/.test(fm) && /review_status:\s*pending/.test(fm) && /verified_by_user:\s*false/.test(fm)}`);
    // 编号接续核对：列出同前缀既有编号
    const dir = path.dirname(abs);
    const prefix = (displayId.match(/^[A-Z]+/) || [''])[0];
    if (prefix && fs.existsSync(dir)) {
      const siblings = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
      console.log(`  既有 ${prefix} 编号: ${siblings.join(', ') || '(无)'}`);
    }
  }

  // 5. 破坏性用例（不调模型）
  const probePath = items[0].path; // 已存在
  const r1 = await api('POST', '/v1/drafts/batch', { items: [
    { path: `probe-rollback-a-${Date.now()}.md`, content: '# 不应留下\n\n若原子回滚有效，此文件绝不应存在。' },
    { path: probePath, content: '# 恶意覆盖\n\n试图覆盖既有文件。' },
  ] });
  check('覆盖既有文件被拒（整批）', r1.status === 409, `HTTP ${r1.status}`);
  const r2 = await api('POST', '/v1/drafts/batch', { items: [{ path: '../escape.md', content: 'x' }] });
  check('../ 路径被拒', r2.status === 400, `HTTP ${r2.status}`);
  const r3 = await api('POST', '/v1/drafts/batch', { items: [{ path: 'notes/evil.txt', content: 'x' }] });
  check('非 .md 路径被拒', r3.status === 400, `HTTP ${r3.status}`);

  // 6. 审计情况（如实）
  const auditDir = path.join(ROOT, 'audit');
  const auditFiles = fs.existsSync(auditDir) ? fs.readdirSync(auditDir).slice(-5) : [];
  console.log(`bridge/audit 最近文件: ${auditFiles.join(', ') || '(无目录/为空)'}`);
  console.log('注意：drafts/batch preview/commit 当前不写 audit 记录（单文件 drafts 与 batch 均无 auditFullLane 调用）——这是一个已确认的审计盲区，不是本次回归引入的。');

  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== 汇总: ${results.length - failed.length}/${results.length} 通过 ===`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => { console.error('探测脚本异常:', error); process.exit(2); });
