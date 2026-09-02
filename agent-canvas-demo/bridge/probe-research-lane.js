/* claude-research 车道真实探测（项目文档 §1 硬规矩：能力声明前必须真跑一次）。
 * 用真实 bridge.config.json 在独立端口起 Bridge，派发一个真实任务：
 * 让 Agent 用 Bash+curl 打 OpenAlex、再尝试 WebSearch，回收完整事件流，
 * 检查：1) 是否真的联网拿到数据 2) permission_denials 是否为空 3) 过程事件是否流出。 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 4610;
const bridgeDir = __dirname;
const child = spawn(process.execPath, [path.join(bridgeDir, 'server.js')], {
  env: { ...process.env, AGENT_BRIDGE_PORT: String(PORT) }, // 用真实配置（只读加载，不写）
  stdio: 'ignore',
});
const cfg = require(path.join(bridgeDir, 'bridge.config.json'));
const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': cfg.token };
const call = (p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers, ...opts }).then((r) => r.json());

(async () => {
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const agents = await call('/v1/agents');
    const research = agents.agents.find((a) => a.id === 'claude-research');
    console.log('claude-research installed:', research?.installed, '| lane:', research?.lane);

    const created = await call('/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'claude-research',
        cwd: cfg.workspaceRoot,
        permission: 'read',
        execute: true,
        prompt: '这是一次能力探测。请严格执行两步并简短汇报：1) 用 Bash 运行 curl -s "https://api.openalex.org/works?search=plasmonic+catalysis&per-page=2" 拿回 JSON，列出前两篇的标题和 DOI；2) 用 WebSearch 搜 "Au@CeO2 plasmonic hydrogen" 并说一句是否成功。最后明确报告：curl 是否通了外网、WebSearch 是否可用、有没有任何工具调用被拒绝。',
      }),
    });
    if (!created.id) { console.log('DISPATCH FAILED:', JSON.stringify(created)); return; }
    console.log('task dispatched:', created.id);

    let info = null;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      info = await call(`/v1/tasks/${created.id}`);
      if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
    }
    console.log('final status:', info.status);
    const steps = (info.events || []).filter((e) => e.type === 'step');
    console.log('--- 过程事件（step，共 ' + steps.length + ' 条，显示前 12 条）---');
    for (const s of steps.slice(0, 12)) console.log(' •', s.text.slice(0, 180));
    // 这是 Bridge 从真实事件流派生的验收证据，不接受 Agent 自述或 prompt
    // 中恰好出现的词语作为“工具已经实际调用”的证明。
    const curlCalls = steps.filter((s) => /调用\s+Bash[：:].*\bcurl\b/i.test(String(s.text))).length;
    const webSearchCalls = steps.filter((s) => /调用\s+WebSearch[：:]/i.test(String(s.text))).length;
    console.log(`tool_call_evidence: curl=${curlCalls} websearch=${webSearchCalls}`);
    console.log('--- 最终回复（前 800 字）---');
    console.log(String(info.finalMessage || info.failureMessage || '(none)').slice(0, 800));
    const denied = (info.events || []).filter((e) => /permission_denial/i.test(e.text));
    console.log('permission_denials 事件数:', denied.length);
  } finally {
    child.kill();
  }
})().catch((e) => { console.error('PROBE FAIL:', e.message); child.kill(); process.exit(1); });
