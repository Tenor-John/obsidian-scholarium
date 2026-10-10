"use strict";
/**
 * 断点续跑：步骤表判定 + UI 接线。
 *
 * 这组测试守的是一条安全边界，不只是功能：质量门的停机（检索式乱码、召回 0
 * 条、本轮下载 0 篇 PDF……）**绝不能**长出续跑按钮。那些 stop 的前提就是
 * 「继续跑会污染证据链」——下载 0 篇时续跑，nature-reader 会去读上一个课题
 * 遗留的旧 PDF，让证据卡片、图谱、综述、手稿全部建立在错误文献上。所以
 * outcome === 'stop' 的记录在任何入口都必须判为不可续。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const core = require("../pipeline-steps-core.js");
const ui = fs.readFileSync(path.join(__dirname, "..", "bridge-ui.js"), "utf8");
const shell = fs.readFileSync(path.join(__dirname, "..", "shell-ui.js"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "bridge", "server.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

/* ── 步骤表 ─────────────────────────────────────────────────────────── */

test("每个步骤的 needs 都能在上游某一步的 produces 里找到（首步除外）", () => {
  const produced = new Set(["question", "workspace"]);
  for (const step of core.PIPELINE_STEPS) {
    for (const need of step.needs || []) {
      assert.ok(produced.has(need),
        `步骤 ${step.id} 需要 ${need}，但没有任何上游步骤产出它——续跑时会拿到 undefined`);
    }
    for (const key of step.produces || []) produced.add(key);
  }
});

test("步骤 id 唯一，且 stepIndex 与数组顺序一致", () => {
  const ids = core.PIPELINE_STEPS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, "重复的步骤 id 会让续跑跳到错误的位置");
  ids.forEach((id, i) => assert.equal(core.stepIndex(id), i));
});

/* ── 空数组必须判为缺失 ─────────────────────────────────────────────── */

test("downloadedPaths 为空数组时判为缺失，不允许从 nature-reader 续跑", () => {
  // 这一条正是证据安全门要拦的场景：本轮一篇都没下到，从 reader 重入会让它
  // 去扫历史 PDF 目录。
  const plan = core.resumePlan({ downloadedPaths: [] }, "nature-reader");
  assert.equal(plan.runnable, false);
  assert.deepEqual(plan.missing, ["downloadedPaths"]);
});

test("0 和 false 是合法值，不判为缺失", () => {
  assert.equal(core.hasValue({ downloadedCount: 0 }, "downloadedCount"), true);
  assert.equal(core.hasValue({ degradedConfirmed: false }, "degradedConfirmed"), true);
  assert.equal(core.hasValue({ query: "   " }, "query"), false, "只有空白的字符串等于没有");
});

/* ── stop / fail 的区分（本组的核心） ───────────────────────────────── */

test("质量门停机的记录永远不可续跑，即使状态包完整", () => {
  const record = {
    status: "stopped", outcome: "stop", stopReason: "证据安全停止：本轮 PDF 下载为 0",
    resumeStepId: "nature-reader",
    state: { question: "q", downloadedPaths: ["literature/downloaded-pdfs/a.pdf"], cards6: [{}] },
  };
  const verdict = core.isResumable(record);
  assert.equal(verdict.resumable, false);
  assert.equal(verdict.reason, "quality-gate-stop");
  assert.match(core.describeResume(record), /安全停止/);
  assert.match(core.describeResume(record), /带进证据链/);
});

test("异常中断的记录可以续跑，并指出会跳过几步", () => {
  const record = {
    status: "failed", outcome: "fail", failureMessage: "Skill 超时",
    resumeStepId: "nature-reader",
    state: { question: "q", downloadedPaths: ["literature/downloaded-pdfs/a.pdf"] },
  };
  const verdict = core.isResumable(record);
  assert.equal(verdict.resumable, true);
  assert.equal(verdict.fromId, "nature-reader");
  assert.equal(verdict.plan.skipped.length, core.stepIndex("nature-reader"));
  assert.match(core.describeResume(record), /将跳过前 \d+ 步/);
});

test("已完成的记录不提供续跑", () => {
  const verdict = core.isResumable({ status: "completed", outcome: "completed", resumeStepId: "nature-polishing", state: {} });
  assert.equal(verdict.resumable, false);
  assert.equal(verdict.reason, "already-completed");
});

test("状态包缺关键项时拒绝续跑，并说明缺什么", () => {
  const record = { status: "failed", outcome: "fail", resumeStepId: "knowledge-graph", state: { question: "q" } };
  const verdict = core.isResumable(record);
  assert.equal(verdict.resumable, false);
  assert.deepEqual(verdict.plan.missing, ["cards6", "downloadedPaths"]);
  assert.match(core.describeResume(record), /缺少 cards6、downloadedPaths/);
});

test("步骤重跑会清除目标步骤及全部下游旧产物，但保留上游依赖", () => {
  const state = { question: "q", query: "q0", conceptBlocks: [{}], combined: [{}], downloadedPaths: ["a.pdf"], cards6: [{}], graph9: {} };
  const next = core.restartStateForStep(state, "search");
  assert.equal(next.query, "q0");
  assert.deepEqual(next.conceptBlocks, [{}]);
  assert.equal(next.combined, undefined);
  assert.equal(next.downloadedPaths, undefined);
  assert.equal(next.graph9, undefined);
  const gateState = core.restartStateForStep(state, "quality-gate");
  assert.deepEqual(gateState.combined, [{}], "会读取并覆写 combined 的目标步骤必须保留它作为输入");
});

test("完成记录可从任意依赖完整的步骤重跑；中断记录不能越过未通过的门", () => {
  const state = { question: "q", query: "q0", conceptBlocks: [{}], combined: [{}], usedQuery: "q0" };
  assert.equal(core.restartPlan({ status: "completed", outcome: "completed", state }, "final-screen").runnable, true);
  const interrupted = { status: "failed", outcome: "fail", resumeStepId: "search", resumeStepIndex: core.stepIndex("search"), state };
  assert.equal(core.restartPlan(interrupted, "quality-gate").runnable, true, "断点的下一步可重跑");
  assert.equal(core.restartPlan(interrupted, "dedupe").reason, "unsafe-skip", "不得越过尚未通过的质量门");
});

test("旧记录（只有 PDF 清单、没有状态包）仍按原规则从 nature-reader 续", () => {
  const verdict = core.isResumable({
    status: "interrupted", resumeFrom: "nature-reader",
    artifacts: { downloadedPaths: ["literature/downloaded-pdfs/a.pdf"] },
  });
  assert.equal(verdict.resumable, true);
  assert.equal(verdict.legacy, true);
  assert.equal(verdict.fromId, "nature-reader");
});

/* ── 状态包体积 ─────────────────────────────────────────────────────── */

test("超预算时先丢摘要，再丢 results5 明细，最后才丢 combined", () => {
  const bulky = {
    question: "q",
    combined: Array.from({ length: 200 }, (_, i) => ({ doi: `10.1/${i}`, title: `t${i}`, abstract: "x".repeat(500) })),
    results5: Array.from({ length: 200 }, (_, i) => ({ status: "downloaded", doi: `10.1/${i}`, path: `p${i}.pdf`, log: "y".repeat(500) })),
  };
  const fitted = core.fitStateToBudget(bulky, 20 * 1024);
  assert.equal(fitted.truncated, true);
  assert.ok(fitted.dropped.includes("combined[].abstract"));
  // doi/title 必须留着：下游的去重和下载靠它们
  assert.equal(fitted.state.combined[0].doi, "10.1/0");
  assert.equal(fitted.state.combined[0].abstract, undefined);
});

test("没超预算就原样返回，不做任何裁剪", () => {
  const small = { question: "q", combined: [{ doi: "10.1/a", abstract: "keep me" }] };
  const fitted = core.fitStateToBudget(small);
  assert.equal(fitted.truncated, false);
  assert.deepEqual(fitted.dropped, []);
  assert.equal(fitted.state.combined[0].abstract, "keep me");
});

/* ── UI 接线 ────────────────────────────────────────────────────────── */

test("质量门的早期 return 已全部改成 stopPipeline（否则包进 stage 后会漏跑安全门）", () => {
  // 包进 stage 闭包之后，`return` 只退出闭包、让 Pipeline 继续往下跑。
  // 这是最危险的失败模式，所以这里直接盯住旧写法不再出现。
  // 旧写法的特征是「渲染结果卡 → finishRunControl('stopped') → return」这三连。
  // handlePipelineOutcome 里那处 finishRunControl('stopped') 是新的统一收口，
  // 不在 stage 闭包内，所以这里只盯前面带 result.classList 的那种组合。
  assert.doesNotMatch(ui, /result\.classList\.remove\('hidden'\);\s*\n\s*finishRunControl\('stopped'/,
    "还有质量门用 result.innerHTML + finishRunControl + return 的旧写法，包进 stage 后会被跳过");
  for (const reason of [
    "质量门停止：检索式乱码",
    "质量门停止：检索式缺少核心概念",
    "质量门停止：检索结果为 0",
    "质量门停止：终筛后无相关文献",
    "降级检索结果未获人工确认",
    "证据安全停止：本轮 PDF 下载为 0",
  ]) {
    assert.ok(ui.includes(`stopPipeline('${reason}'`), `${reason} 没有走 stopPipeline`);
  }
});

test("失败与停机写入不同的 outcome", () => {
  assert.match(ui, /outcome: 'stop', stopReason: stop\.reason/);
  assert.match(ui, /status: 'failed', outcome: 'fail'/);
  assert.match(ui, /status: 'completed', outcome: 'completed'/);
});

test("三个续跑入口都存在，且都经过 isResumable 判定", () => {
  assert.match(ui, /button\.className = 'button ghost wv-step-resume'/, "入口 1：失败步骤行内联");
  assert.match(ui, /function renderInlineResumeButtons\(\)/);
  assert.match(ui, /renderInlineResumeButtons\(\);/, "失败收口处必须真的去画这个按钮");
  assert.match(ui, /class="button primary pipeline-resume"/, "入口 2：中断记录面板");
  assert.match(ui, /class="button ghost wv-history-resume"/, "入口 3：历史任务列表");
  assert.match(ui, /stepsCore\.isResumable\(payload\)/);
  assert.match(ui, /core\.isResumable\(payload\)/);
});

test("每个 stage 结束后都会落盘状态包并推进重入点", () => {
  assert.match(ui, /await savePipelineState\(historyId, S\)/);
  assert.match(ui, /resumeStepId: id, resumeStepIndex: index/);
  assert.match(ui, /if \(index >= 0 && index < startIndex\) return undefined;/);
});

test("Pipeline 的每一个步骤表条目都在 bridge-ui 里被 stage 包住", () => {
  for (const step of core.PIPELINE_STEPS) {
    assert.ok(ui.includes(`await stage('${step.id}'`), `步骤 ${step.id} 没有 stage 包裹，中断后无法从它续跑`);
  }
});

test("index.html 在 bridge-ui.js 之前加载步骤表模块", () => {
  const coreAt = html.indexOf("pipeline-steps-core.js");
  const uiAt = html.indexOf("bridge-ui.js\"></script>");
  assert.ok(coreAt > -1, "index.html 没有引入 pipeline-steps-core.js");
  assert.ok(coreAt < uiAt, "步骤表模块必须先于 bridge-ui.js 加载");
});

test("对话运行块经过确认卡，且只接到窄化的浏览器编排入口", () => {
  assert.match(shell, /parseRunRequests\(reply\.text\)/);
  assert.match(shell, /runRequestCard\(msg\)/);
  assert.match(shell, /确认并运行/);
  assert.match(shell, /window\.runScholariumConversationOperation\(request\)/);
  assert.match(ui, /window\.runScholariumConversationOperation = runConversationOperation/);
  assert.match(ui, /operation === 'literature\.search'/);
  assert.match(ui, /operation === 'pipeline\.rerun'/);
  assert.match(ui, /operation === 'pipeline\.run'/);
  assert.match(ui, /restartStateForStep\(record\.state, fromId\)/);
  assert.match(ui, /renderPipelineRestartControls\(result, payload\)/);
  assert.match(ui, /修改并从指定步骤重新运行/);
  assert.match(ui, /topicChanged\) fromId = 'query-builder'/);
  assert.match(ui, /queryChanged && core\.stepIndex\(fromId\) > core\.stepIndex\('search'\)/);
});

/* ── Bridge 端 ──────────────────────────────────────────────────────── */

test("状态包 sidecar 不会被历史列表当成运行记录", () => {
  // <id>.state.json 和 <id>.json 同目录同后缀，漏掉排除会让每条 Pipeline 在
  // 历史列表里多出一条没有 id/status 的幽灵记录。
  assert.match(server, /!name\.endsWith\('\.state\.json'\)/);
});

test("Bridge 收窄 outcome 取值，拼错的值不能让安全停止获得续跑入口", () => {
  assert.match(server, /\['stop', 'fail', 'completed'\]\.includes\(input\.outcome\)/);
});

test("Bridge 的 resumable 排除质量门停机与已完成", () => {
  assert.match(server, /r\.outcome !== 'stop' && r\.status !== 'completed'/);
});

test("状态包有体积上限，超限拒绝写入", () => {
  assert.match(server, /PIPELINE_STATE_MAX_BYTES/);
  assert.match(server, /pipeline state exceeds/);
});

test("详情端点带状态包，摘要列表端点不带", () => {
  assert.match(server, /state: readPipelineState\(record\.id\)/);
  const historyBlock = server.slice(server.indexOf("const pipelines = listRunRecords('pipelines')"), server.indexOf("return send(res, 200, { fullTasks: fullRuns, searches, pipelines })"));
  assert.doesNotMatch(historyBlock, /readPipelineState/, "摘要列表读状态包会让历史面板随记录数变慢");
});
