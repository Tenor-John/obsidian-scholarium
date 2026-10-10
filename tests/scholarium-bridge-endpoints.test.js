"use strict";
// Static analysis of the Bridge server source, matching the existing
// tests/bridge-safety.test.js style: this project's Bridge is a standalone
// process that binds a port and spawns local CLI agents at import time
// (server.listen(...) runs as soon as the module loads), so it is not
// require()-able from a test process without side effects. These assertions
// check the safety properties that matter without starting the server:
// fail-closed defaults, the enabled gate, the vault-root check and the
// whitelist check all appear in the right order in the route handler.
const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

/* 定位 token 门禁。
 *
 * 这三处断言原来写死了字面量 "if (!allowed(req))"。后来门禁扩展成
 *   if (!allowed(req) && !allowedMcpRead(req, url.pathname)) ...
 * （给 MCP 只读能力加了一个带过期时间、且只覆盖若干 GET/POST 只读路由的旁路），
 * 于是 indexOf 返回 -1，断言开始失败——但**代码本身是安全的**，只是测试在盯一个
 * 已经不存在的字符串。
 *
 * 改成按前缀定位，并在下面补一条更强的断言：不是"某一条路由在门禁之后"，而是
 * 源码里每一个 url.pathname === '/v1/...' 判断都在门禁之后。字面量再变一次，
 * 这条也不会跟着腐烂。 */
function tokenGateAt(source) {
  return source.indexOf("if (!allowed(req)");
}

const server = fs.readFileSync(
  path.join(__dirname, "..", "agent-canvas-demo", "bridge", "server.js"),
  "utf8",
);

describe("Scholarium action control plane (Bridge side)", () => {
  it("defaults scholarium.enabled to false, both for a fresh config and when migrating an old one", () => {
    assert.match(server, /function defaultScholariumConfig\(\)\s*\{\s*return\s*\{\s*enabled:\s*false/);
    assert.match(server, /existing\.scholarium \?\?= defaultScholariumConfig\(\)/);
  });
  it("never spawns a process for a Scholarium action; it only queues a file for the plugin's own consumer", () => {
    const start = server.indexOf("POST' && url.pathname === '/v1/scholarium/actions'");
    const block = server.slice(start, start + 2000);
    assert.noMatch(block, /spawn\(|spawnSync\(/);
    assert.match(block, /scholariumQueue\.submit\(/);
  });
  it("checks scholarium.enabled before touching the vault or the whitelist", () => {
    const start = server.indexOf("POST' && url.pathname === '/v1/scholarium/actions'");
    const block = server.slice(start, start + 2000);
    const enabledCheck = block.indexOf("status.enabled");
    const vaultCheck = block.indexOf("vaultRootExists");
    const whitelistCheck = block.indexOf("allowedActions.includes");
    assert.ok(enabledCheck > -1 && vaultCheck > enabledCheck && whitelistCheck > vaultCheck, "expected enabled -> vaultRoot -> whitelist, in that order");
  });
  it("dry-runs the action before queueing it, so a malformed request fails fast", () => {
    const start = server.indexOf("POST' && url.pathname === '/v1/scholarium/actions'");
    const block = server.slice(start, start + 2000);
    assert.match(block, /runAsync\([\s\S]{0,80}dryRun:\s*true/);
    assert.match(block, /scholariumQueue\.submit\(/);
  });
  it("keeps every /v1/scholarium/* route behind the existing bearer-token gate", () => {
    const tokenGateIndex = tokenGateAt(server);
    const firstScholariumRoute = server.indexOf("/v1/scholarium/status");
    assert.ok(tokenGateIndex > -1 && tokenGateIndex < firstScholariumRoute, "the token check must run before any /v1/scholarium/* route is reached");
    // 必须匹配路由判断本身，不能只搜路径字符串：源码里注释也提到这些路径，
    // 而注释出现在门禁之前，会让这条断言假失败。
    assert.ok(tokenGateIndex < server.indexOf("url.pathname === '/v1/scholarium/state'"),
      "the token check must also run before the state read endpoint");
  });

  it("puts EVERY /v1 route behind the gate, not just the scholarium ones", () => {
    /* 比上面那条强：逐个数，不是抽查一条。
     * 之前的写法只要 /v1/scholarium/status 在门禁之后就算过；将来若有人在门禁
     * 之前插一条新路由，那条断言照样通过。这里改成全量核对。 */
    const gate = tokenGateAt(server);
    assert.ok(gate > -1, "token gate not found");
    const routes = [...server.matchAll(/url\.pathname === '(\/v1\/[^']+)'/g)]
      .map((m) => ({ path: m[1], at: m.index }));
    assert.ok(routes.length > 40, `expected the full route table, found ${routes.length}`);
    const leaked = routes.filter((r) => r.at < gate).map((r) => r.path);
    assert.deepEq(leaked, [], "these routes are matched before the bearer-token check");
  });

  it("the MCP read bypass is scoped, expiring, and read-only", () => {
    /* 门禁里的 !allowedMcpRead(...) 是一个有意的旁路，必须保持窄口径：
     * 独立 token、带过期、且只覆盖点名的只读路由。 */
    const fn = server.slice(server.indexOf("function allowedMcpRead"), server.indexOf("function allowedMcpRead") + 900);
    assert.match(fn, /x-scholarium-mcp-token/, "must use its own header, not the main bearer token");
    assert.match(fn, /expiresAt < Date\.now\(\)/, "capability must expire");
    assert.match(fn, /pathname === '\/v1\/scholarium\/state'/, "bypass must name the routes it covers");
    // 这个 harness 没有 doesNotMatch，用 ok(!test) 表达同一件事。
    assert.ok(!/return true;\s*\}\s*$/.test(fn), "must not fall through to an unconditional allow");
  });
});

describe("Scholarium state read endpoint (Bridge side)", () => {
  const route = server.slice(server.indexOf("GET' && url.pathname === '/v1/scholarium/state'"));
  it("checks scholarium.enabled before touching the vault or the whitelist", () => {
    const enabledCheck = route.indexOf("status.enabled");
    const vaultCheck = route.indexOf("vaultRootExists");
    const whitelistCheck = route.indexOf("allowedActions.includes");
    assert.ok(enabledCheck > -1 && vaultCheck > enabledCheck && whitelistCheck > vaultCheck, "expected enabled -> vaultRoot -> whitelist, in that order");
  });
  it("serves L0 actions only; anything that writes must stay on the queued POST route", () => {
    assert.match(route, /policy\.level !== 'L0'/);
    assert.match(route, /POST \/v1\/scholarium\/actions instead/);
  });
  it("never queues, spawns or writes for a state read", () => {
    const block = route.slice(0, route.indexOf("404"));
    assert.noMatch(block, /scholariumQueue\.submit\(/);
    assert.noMatch(block, /spawn\(|spawnSync\(/);
    assert.noMatch(block, /writeFileSync|renameSync|unlinkSync/);
  });
  it("runs reads as dry-run manifests so Research/_runs/actions/ is not spammed by polling", () => {
    assert.match(route, /scholariumActions\.run\([\s\S]{0,120}dryRun:\s*true/);
  });
  it("whitelists the project reads and timeblock drift audit by default for fresh configs", () => {
    const defaults = server.slice(server.indexOf("function defaultScholariumConfig"), server.indexOf("function scholariumConfig"));
    for (const name of ["project.list", "project.get", "experiment.scan_outcomes", "workspace.timeblock_drift_audit"])
      assert.ok(defaults.includes("'" + name + "'"), "defaultScholariumConfig must list " + name);
  });
});

// 2026-08-26 M4 第二步：GET /v1/scholarium/rescan-checkpoint-mark is a
// deliberate, narrow exception to "reads never write" — see
// tools/pending-review-scan.js's header comment for why it's allowed to
// exist at all. These checks make sure the exception stays exactly as
// narrow as designed: gated the same way every other route is, and placed
// so it can never be mistaken for part of the state-read contract above.
describe("Scholarium rescan checkpoint-mark route (Bridge side, M4 第二步)", () => {
  const routeStart = server.indexOf("url.pathname === '/v1/scholarium/rescan-checkpoint-mark'");
  it("exists and is placed before the read-only /v1/scholarium/state block", () => {
    assert.ok(routeStart > -1, "rescan-checkpoint-mark route must exist");
    const stateStart = server.indexOf("GET' && url.pathname === '/v1/scholarium/state'");
    assert.ok(routeStart < stateStart, "must sit before /v1/scholarium/state so that route's own-writes checks stay accurate");
  });
  it("checks scholarium.enabled, vaultRootExists and the workspace.rescan_pending whitelist entry before writing", () => {
    const block = server.slice(routeStart, routeStart + 2000);
    const enabledCheck = block.indexOf("status.enabled");
    const vaultCheck = block.indexOf("vaultRootExists");
    const whitelistCheck = block.indexOf("allowedActions.includes");
    const writeCall = block.indexOf("writeCheckpoint");
    assert.ok(enabledCheck > -1 && vaultCheck > enabledCheck && whitelistCheck > vaultCheck && writeCall > whitelistCheck,
      "expected enabled -> vaultRoot -> whitelist -> write, in that order");
  });
  it("sits behind the same bearer-token gate as every other /v1/scholarium/* route", () => {
    const tokenGateIndex = tokenGateAt(server);
    assert.ok(tokenGateIndex > -1 && tokenGateIndex < routeStart, "the token check must run before this route is reached");
  });
  it("never queues or spawns a process — it only writes the checkpoint file", () => {
    const block = server.slice(routeStart, routeStart + 2000);
    assert.noMatch(block, /scholariumQueue\.submit\(/);
    assert.noMatch(block, /spawn\(|spawnSync\(/);
  });
});

// 2026-08-27 发布冲刺：experiment.transition 的两阶段编辑通道。main.js 的
// SCH_SCHOLARIUM_QUEUE_ACTIONS 白名单不可改，这条通道存在的全部意义就是
// "不经过那张白名单也能安全写"——测试要盯住三件事：确实不碰队列、
// commit 真的重新校验（不是照抄 preview 存的 plan 硬写）、以及
// checkAndPrepare() 的 confirmed:true 门槛真的被过了（这原本是实现时漏掉、
// 会让每一次点击"确认执行"都报 explicit_confirmation_required 的一个真实
// bug，被这批测试之前的人工审查发现并修复——留着这条测试防止它再回来）。
describe("experiment.transition edit channel (Bridge side, 发布冲刺 2026-08-27)", () => {
  const previewStart = server.indexOf("url.pathname === '/v1/edits/experiment-transition/preview'");
  const commitStart = server.indexOf("/^\\/v1\\/edits\\/[\\w-]+\\/commit$/");
  const commitEnd = server.indexOf("/^\\/v1\\/ideas\\/[^/]+\\/promote\\/preview$/", commitStart);
  const commitBlock = server.slice(commitStart, commitEnd > commitStart ? commitEnd : undefined);

  it("both routes exist, placed before the read-only /v1/scholarium/state block", () => {
    const commitStart = server.indexOf("/^\\/v1\\/edits\\/[\\w-]+\\/commit$/");
    assert.ok(previewStart > -1, "preview route must exist");
    assert.ok(commitStart > -1, "commit route must exist");
    const stateStart = server.indexOf("GET' && url.pathname === '/v1/scholarium/state'");
    assert.ok(previewStart < stateStart && commitStart < stateStart, "both routes must sit before /v1/scholarium/state");
  });

  it("preview runs experiment.transition as a pure dry-run and never writes or queues", () => {
    const block = server.slice(previewStart, previewStart + 2200);
    assert.match(block, /scholariumActions\.run\([\s\S]{0,200}dryRun:\s*true/);
    assert.noMatch(block, /writeFileSync|renameSync|unlinkSync/);
    assert.noMatch(block, /scholariumQueue\.submit\(/);
    assert.noMatch(block, /spawn\(|spawnSync\(/);
  });

  it("commit re-runs experiment.transition for real (dryRun:false) with confirmed:true, and never touches the Obsidian queue", () => {
    assert.ok(commitStart > -1, "commit route regex must exist");
    // The exact bug this test guards against: checkAndPrepare() in
    // action-registry.js throws explicit_confirmation_required for any L1
    // action run with dryRun:false unless confirmed:true is also passed.
    assert.match(commitBlock, /dryRun:\s*false/);
    assert.match(commitBlock, /confirmed:\s*true/);
    assert.match(commitBlock, /scholariumActions\.run\(/);
    assert.noMatch(commitBlock, /scholariumQueue\.submit\(/);
    assert.noMatch(commitBlock, /spawn\(|spawnSync\(/);
  });

  it("commit checks the preview exists and has not expired before running anything", () => {
    const notFoundCheck = commitBlock.indexOf("edit preview not found or expired");
    const expiryCheck = commitBlock.indexOf("Date.parse(preview.expiresAt)");
    const runCall = commitBlock.indexOf("scholariumActions.run(");
    assert.ok(notFoundCheck > -1 && expiryCheck > notFoundCheck && runCall > expiryCheck,
      "expected not-found check -> expiry check -> real run, in that order");
  });

  it("is not folded into scholarium.allowedActions — that array is the queue whitelist's counterpart, not this channel's", () => {
    const defaults = server.slice(server.indexOf("function defaultScholariumConfig"), server.indexOf("function scholariumConfig"));
    assert.notOk(defaults.includes("'experiment.transition'"), "experiment.transition must stay out of the queue-submission whitelist to avoid a second, silently-stuck path to the same action name");
  });

  it("sits behind the same bearer-token gate as every other /v1 route", () => {
    const tokenGateIndex = tokenGateAt(server);
    assert.ok(tokenGateIndex > -1 && tokenGateIndex < previewStart, "the token check must run before the preview route is reached");
  });
});
