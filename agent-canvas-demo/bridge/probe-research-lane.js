/* claude-research 车道真实探测（项目文档 §1 硬规矩：能力声明前必须真跑一次）。
 * 用真实 bridge.config.json 在独立端口起 Bridge，派发一个真实任务：
 * 让 Agent 用 WebFetch 打 OpenAlex、再尝试 WebSearch，回收完整事件流，
 * 检查：1) 是否真的联网拿到数据 2) permission_denials 是否为空 3) 过程事件是否流出。 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 4610;
const bridgeDir = __dirname;
const call = (headers, p, opts = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { headers, ...opts }).then((r) => r.json());

function openAlexResultEvidence(steps) {
  const texts = (steps || []).map((step) => String(step?.text || ''));
  const hasOpenAlexJson = (text) => /"meta"\s*:/.test(text) && /"results"\s*:/.test(text);
  const direct = texts.filter((text) => /工具返回\s+(?:Bash|PowerShell)（成功）[：:]/i.test(text) && hasOpenAlexJson(text)).length;
  if (direct) return direct;

  // Claude Code 会把过大的 shell 输出保存到 tool-results，再以 Read 读取。
  // 这条间接链只有在路径确实由成功的 shell 结果给出、Read 调用读取同一路径，
  // 且 Read 成功返回 OpenAlex JSON 时才算证据；最终回复中的自述仍不参与。
  for (let i = 0; i < texts.length; i++) {
    const saved = texts[i].match(/工具返回\s+(?:Bash|PowerShell)（成功）[：:].*Full output saved to:\s*([^<\r\n]+)/i)?.[1]?.trim();
    if (!saved) continue;
    const savedPath = saved.replaceAll('\\', '/').toLowerCase();
    for (let j = i + 1; j < texts.length; j++) {
      const read = texts[j].match(/调用\s+Read[：:]\s*(.+)$/i)?.[1]?.trim();
      if (!read) continue;
      const readPath = read.replaceAll('\\', '/').toLowerCase();
      if (!(savedPath.startsWith(readPath) || readPath.startsWith(savedPath))) continue;
      const result = texts.slice(j + 1).find((text) => /工具返回\s+Read（成功）[：:]/i.test(text));
      if (result && hasOpenAlexJson(result)) return 1;
    }
  }
  return 0;
}

async function main() {
  // Keep real deployment credentials out of module import so parser/unit tests
  // remain hermetic in a clean worktree that intentionally has no live config.
  const cfg = require(path.join(bridgeDir, 'bridge.config.json'));
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': cfg.token };
  const child = spawn(process.execPath, [path.join(bridgeDir, 'server.js')], {
    env: { ...process.env, AGENT_BRIDGE_PORT: String(PORT) }, // 用真实配置（只读加载，不写）
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const agents = await call(headers, '/v1/agents');
    const research = agents.agents.find((a) => a.id === 'claude-research');
    console.log('claude-research installed:', research?.installed, '| lane:', research?.lane);

    const created = await call(headers, '/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        agentId: 'claude-research',
        cwd: cfg.workspaceRoot,
        permission: 'read',
        execute: true,
        prompt: '这是一次能力探测。请严格执行两步并简短汇报：1) 用 WebFetch 读取 "https://api.openalex.org/works?search=plasmonic+catalysis&per-page=2"，列出前两篇的标题和 DOI；2) 用 WebSearch 搜 "Au@CeO2 plasmonic hydrogen" 并说一句是否成功。最后明确报告：WebFetch、WebSearch 是否可用，有没有任何工具调用被拒绝。不要尝试 Bash、PowerShell、Write 或 Edit。',
      }),
    });
    if (!created.id) { console.log('DISPATCH FAILED:', JSON.stringify(created)); return; }
    console.log('task dispatched:', created.id);

    let info = null;
    for (let i = 0; i < 240; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      info = await call(headers, `/v1/tasks/${created.id}`);
      if (['completed', 'failed', 'cancelled'].includes(info.status)) break;
    }
    console.log('final status:', info.status);
    const steps = (info.events || []).filter((e) => e.type === 'step');
    console.log('--- 过程事件（step，共 ' + steps.length + ' 条，显示前 12 条）---');
    for (const s of steps.slice(0, 12)) console.log(' •', s.text.slice(0, 180));
    // 这是 Bridge 从真实事件流派生的验收证据，不接受 Agent 自述或 prompt
    // 中恰好出现的词语作为“工具已经实际调用”的证明。
    const webFetchCalls = steps.filter((s) => /调用\s+WebFetch[：:]/i.test(String(s.text))).length;
    const webSearchCalls = steps.filter((s) => /调用\s+WebSearch[：:]/i.test(String(s.text))).length;
    console.log(`tool_call_evidence: webfetch=${webFetchCalls} websearch=${webSearchCalls}`);
    console.log('--- 最终回复（前 800 字）---');
    console.log(String(info.finalMessage || info.failureMessage || '(none)').slice(0, 800));
    const denied = (info.events || []).filter((e) => /permission_denial/i.test(e.text));
    console.log('permission_denials 事件数:', denied.length);
    const passed = info.status === 'completed'
      && webFetchCalls > 0 && webSearchCalls > 0
      && denied.length === 0;
    console.log('probe_passed:', passed);
    if (!passed) process.exitCode = 1;
  } finally {
    child.kill();
  }
}

if (require.main === module) main().catch((e) => { console.error('PROBE FAIL:', e.message); process.exit(1); });
module.exports = { openAlexResultEvidence };
