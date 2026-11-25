'use strict';

// Upgrade the standard Claude read-only adapter at dispatch time, including
// existing profiles, without changing its tool or permission configuration.
function streamTaskAdapter(agentId, adapter) {
  if (agentId !== 'claude' || !Array.isArray(adapter.args)) return adapter;
  const args = [...adapter.args];
  const format = args.indexOf('--output-format');
  if (format < 0 || args[format + 1] !== 'json') return adapter;
  args[format + 1] = 'stream-json';
  if (!args.includes('--verbose')) args.push('--verbose');
  return { ...adapter, args };
}

function resumeTaskAdapter(agentId, adapter, sessionId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(sessionId || ''))) throw new Error('Agent 会话编号无效，无法恢复。');
  const args = [...adapter.args];
  if (agentId === 'claude' || agentId === 'claude-research') args.push('--resume', sessionId);
  else if (agentId === 'codex') {
    const exec = args.indexOf('exec');
    const stdin = args.lastIndexOf('-');
    if (exec < 0 || stdin < exec) throw new Error('当前 Codex 配置不支持恢复会话。');
    args.splice(stdin, 0, 'resume', sessionId);
  } else throw new Error('当前 Agent 不支持会话恢复。');
  return { ...adapter, args };
}

module.exports = { streamTaskAdapter, resumeTaskAdapter };
