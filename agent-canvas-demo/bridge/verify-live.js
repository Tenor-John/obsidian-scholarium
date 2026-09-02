/* Real-model acceptance: intentionally excluded from npm test. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const BRIDGE_DIR = __dirname;
const ROOT = path.resolve(BRIDGE_DIR, '..');

function runNode(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { output += chunk; process.stderr.write(chunk); });
    child.on('error', (error) => resolve({ exitCode: 1, output: `${output}\nspawn error: ${error.message}` }));
    child.on('close', (code) => resolve({ exitCode: code ?? 1, output }));
  });
}

function researchPassed(run) {
  return run.exitCode === 0
    && /final status:\s*completed/i.test(run.output)
    && /permission_denials .*?:\s*0/i.test(run.output)
    // probe-research-lane 从真实 Bridge step 事件输出的机器可读证据；不要
    // 依赖 Agent 的自由文本或 prompt 中“curl 是否通了”之类的字样。
    && /tool_call_evidence:\s*curl=[1-9]\d*\s+websearch=[1-9]\d*/i.test(run.output);
}

function pathScopePassed(run) {
  // 对 claude-research，临时越界哨兵被写出是检测式边界的预期现场证据，
  // 不是“越界已被预防”的成功。probe-path-scope.js 结束时会清理临时目录。
  return run.exitCode === 0 && /结果: 越界文件被真实写出/.test(run.output);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForBridge(port, headers) {
  let lastError;
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/agents`, { headers });
      if (response.ok) return;
      lastError = new Error(`Bridge returned ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error('Bridge did not start');
}

async function runFullProbe() {
  const cfg = require(path.join(BRIDGE_DIR, 'bridge.config.json'));
  const port = await reservePort();
  const headers = { 'content-type': 'application/json', 'x-agent-bridge-token': cfg.token };
  const child = spawn(process.execPath, [path.join(BRIDGE_DIR, 'server.js')], {
    cwd: ROOT, env: { ...process.env, AGENT_BRIDGE_PORT: String(port) }, stdio: 'ignore',
  });
  try {
    await waitForBridge(port, headers);
    const response = await fetch(`http://127.0.0.1:${port}/v1/full-tasks/probe`, {
      method: 'POST', headers, body: JSON.stringify({ adapter: 'claude-full' }),
    });
    const body = await response.json();
    return { ok: response.ok && body.ok === true, status: response.status, checks: body.checks || {}, notes: body.notes || [] };
  } catch (error) {
    return { ok: false, status: null, checks: {}, notes: [error.message] };
  } finally {
    child.kill();
  }
}

function acceptanceRecord(results) {
  return {
    ts: new Date().toISOString(), event: 'live-acceptance-completed', source: 'bridge/verify-live.js',
    overallOk: results.research.ok && results.pathScope.ok && results.claudeFull.ok, probes: results,
  };
}

function appendAcceptanceAudit(record) {
  const cfg = require(path.join(BRIDGE_DIR, 'bridge.config.json'));
  const auditDir = path.resolve(cfg.fullTaskAuditDir || path.join(BRIDGE_DIR, 'audit'));
  fs.mkdirSync(auditDir, { recursive: true });
  fs.appendFileSync(path.join(auditDir, `acceptance-${record.ts.slice(0, 10)}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
}

async function main() {
  console.log('Live acceptance: real Claude/network calls; intentionally outside npm test.');
  const researchRun = await runNode(path.join(BRIDGE_DIR, 'probe-research-lane.js'));
  const pathScopeRun = await runNode(path.join(BRIDGE_DIR, 'probe-path-scope.js'));
  const full = await runFullProbe();
  const results = {
    research: { ok: researchPassed(researchRun), exitCode: researchRun.exitCode },
    pathScope: { ok: pathScopePassed(pathScopeRun), exitCode: pathScopeRun.exitCode, expected: 'escape-written-and-cleaned' },
    claudeFull: full,
  };
  const record = acceptanceRecord(results);
  appendAcceptanceAudit(record);
  console.log('\n--- Live acceptance summary ---');
  console.log(JSON.stringify(record, null, 2));
  if (!record.overallOk) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => { console.error(`LIVE ACCEPTANCE FAILED: ${error.stack || error.message}`); process.exitCode = 1; });

module.exports = { researchPassed, pathScopePassed, acceptanceRecord };
