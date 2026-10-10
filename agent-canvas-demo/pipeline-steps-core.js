/* pipeline-steps-core.js — 文献 Pipeline 的步骤表与断点续跑判定（纯函数核心）。
 *
 * 这个文件存在的理由，是此前 Pipeline 只有「一个」续跑点。
 *
 * 原来的 runResearchPipeline() 是一条 660 行的直线函数，步骤之间靠局部变量
 * （query / combined / downloadedPaths / cards6 …）串联，而落盘的 checkpoint
 * 只存了步骤行的「标题/描述/状态」这三段 UI 文字：
 *
 *     function pipelineHistorySteps() {
 *       return [...document.querySelectorAll('#runSteps .run-step')].map(...)
 *     }
 *
 * 也就是说，追踪器记住的是每一步「说了什么」，不是它「产出了什么」。唯一被
 * 额外存下来的产出是 downloadedPaths，所以全流程只有 resumeFrom ===
 * 'nature-reader' 这一个可恢复点；任何其他位置中断，状态包里都没有下游需要
 * 的值，只能整轮重跑。用户看到的那句「该记录没有保存可恢复的 PDF 清单，不能
 * 安全地从下游继续」，就是这个结构的直接后果。
 *
 * 这里把步骤变成一张显式的表：每一步声明自己 needs 什么、produces 什么。
 * 驱动循环在每步结束后把整个状态包落盘，续跑时用 resumePlan() 校验状态包是否
 * 真的满足目标步的 needs——满足才允许从那步重入，不满足就明确说缺哪一项，
 * 而不是让 Pipeline 带着 undefined 往下跑。
 *
 * ── 两种「停下」必须区分开 ──────────────────────────────────────────
 *
 * 这是本模块最重要的一条约束，也是唯一一处不能图省事的地方。
 *
 *   STOP（质量门主动停机）：检索式乱码、检索式漏掉核心概念、召回 0 条、
 *     终筛后无相关文献、降级检索未获人工确认、本轮下载 0 篇 PDF。
 *     这些 return 是 Pipeline 在**正确地行使否决权**。它们的前提是「继续跑
 *     会污染证据链」——比如下载 0 篇时继续跑，nature-reader 会去读工作区里
 *     上一个课题遗留的旧 PDF，让证据卡片、知识图谱、综述、手稿全部建立在
 *     错误的文献上。给这类记录一个「继续」按钮，等于给用户一键绕过安全门的
 *     入口，比没有续跑功能更糟。所以 STOP 记录永远不可续跑，UI 上显示的是
 *     「这是安全停止，请修改后重跑」。
 *
 *   FAIL（异常中断）：宿主卸载 iframe、Bridge 重启、Skill 抛错、网络中断。
 *     这些跟证据正确性无关，纯粹是执行环境出了问题，前面若干步的产出完全
 *     有效。这才是断点续跑要解决的场景。
 *
 * 判定入口是 isResumable(record)：只看 outcome，不看 status 文字。
 *
 * 浏览器：window.weaverPipelineSteps；Node：module.exports。
 */

"use strict";

/* 状态包落盘体积上限。combined（元数据记录数组，含摘要）是这里唯一可能失控
 * 的字段——compactPipelineRecords 已经截断过，但一次几千条的召回仍可能到几
 * MB。超限时按 fitStateToBudget() 的顺序降级，而不是整包放弃落盘。 */
const STATE_BUDGET_BYTES = 4 * 1024 * 1024;

/* 步骤表。
 *
 * needs：从这一步「重入」时，状态包里必须已经存在的键。故意只写硬依赖——
 *   写多了会让本可以续的记录被误判为不可续。
 * produces：这一步写回状态包的键，供 resumePlan 解释「续跑会跳过什么」。
 * phase：给 UI 分组用（P1 检索 / P2 证据 / P3 写作）。
 * gate：这一步含质量门，可能 STOP。
 * optional：会按设置或运行时条件跳过，不构成下游硬依赖。
 */
const PIPELINE_STEPS = [
  { id: "query-builder", title: "第 1 步 · literature-search-query-builder", phase: "P1", gate: true,
    needs: ["question"], produces: ["step1", "queryV0", "step1Manifest", "query"] },

  { id: "concept-matrix", title: "第 1.2 步 · 概念矩阵生成", phase: "P1",
    needs: ["question", "step1Manifest"], produces: ["conceptBlocks", "matrixSource"] },

  { id: "query-refine", title: "第 1.5 步 · 自动打磨检索式（双 Agent）", phase: "P1",
    needs: ["question", "query", "conceptBlocks"], produces: ["query", "queryLoopDegradation"] },

  { id: "search", title: "第 2–3 步 · 多源元数据检索", phase: "P1", gate: true,
    needs: ["query"], produces: ["records2", "records3", "combined", "usedQuery", "relevance"] },

  { id: "quality-gate", title: "第 3.5–3.8 步 · 检索质量评估与深化", phase: "P1", gate: true, optional: true,
    needs: ["combined", "conceptBlocks", "question"], produces: ["combined", "usedQuery", "queryV1Executed", "queryV1Audit", "relevance"] },

  { id: "extra-providers", title: "第 3.9 步 · 补充数据源检索", phase: "P1", optional: true,
    needs: ["usedQuery", "combined"], produces: ["combined"] },

  { id: "final-screen", title: "第 3.95 步 · 下载前相关性终筛", phase: "P1", gate: true,
    needs: ["combined", "conceptBlocks"], produces: ["combined"] },

  { id: "degraded-gate", title: "第 3.99 步 · 降级检索人工闸门", phase: "P1", gate: true, optional: true,
    needs: ["combined", "usedQuery"], produces: ["degradedConfirmed"] },

  { id: "dedupe", title: "第 4 步 · reference-export-dedupe", phase: "P1",
    needs: ["combined"], produces: ["step4", "dedupe"] },

  { id: "download", title: "第 5 步 · PDF 获取（机构通道 + 浏览器兜底）", phase: "P2", gate: true, optional: true,
    needs: ["combined", "dedupe"], produces: ["results5", "downloadedPaths", "downloadedCount", "blockedCount", "sessionPolicy", "downloadDiagnosticNote", "downloadSummary"] },

  { id: "nature-reader", title: "第 6 步 · nature-reader", phase: "P2",
    needs: ["downloadedPaths"], produces: ["step6", "cards6", "needsReview"] },

  { id: "obsidian-bases", title: "第 8 步 · obsidian-bases", phase: "P2",
    needs: ["downloadedPaths"], produces: ["step8", "notes8"] },

  { id: "knowledge-graph", title: "第 9 步 · zrl-knowledge-graph", phase: "P2",
    needs: ["question", "cards6", "downloadedPaths"], produces: ["step9", "warningCount9", "graph9"] },

  { id: "deep-research", title: "第 10 步 · deep-research", phase: "P3",
    needs: ["downloadedPaths"], produces: ["step10", "synthesis10"] },

  { id: "nature-writing", title: "第 11 步 · nature-writing", phase: "P3",
    needs: ["synthesis10"], produces: ["step11", "draft11"] },

  { id: "nature-polishing", title: "第 12 步 · nature-polishing", phase: "P3",
    needs: ["draft11"], produces: ["step12", "polished12"] },
];

const STEP_INDEX = new Map(PIPELINE_STEPS.map((step, index) => [step.id, index]));

function stepById(id) {
  const index = STEP_INDEX.get(id);
  return index === undefined ? null : PIPELINE_STEPS[index];
}

function stepIndex(id) {
  const index = STEP_INDEX.get(id);
  return index === undefined ? -1 : index;
}

/* 状态包里一个键是否「真的有值」。
 *
 * 空数组要判为缺失：downloadedPaths: [] 表示这一轮一篇都没下到，从
 * nature-reader 重入会让 reader 去扫历史 PDF 目录——正是证据安全门要拦的
 * 那件事。0 和 false 则是合法值（downloadedCount: 0 有意义）。 */
function hasValue(state, key) {
  if (!state || !Object.prototype.hasOwnProperty.call(state, key)) return false;
  const value = state[key];
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/* 从 fromId 这一步重入，状态包够不够。
 *
 * 只校验目标步自己的 needs：它上游的步骤要么已经跑过（产出就在状态包里），
 * 要么被跳过（optional）。逐步累积校验反而会把「第 3.9 步按设置关闭」这类
 * 正常情况误判成不可续。 */
function resumePlan(state, fromId) {
  const target = stepById(fromId);
  if (!target) return { runnable: false, reason: "unknown-step", missing: [], skipped: [], remaining: [] };
  const missing = (target.needs || []).filter((key) => !hasValue(state, key));
  const index = stepIndex(fromId);
  return {
    runnable: missing.length === 0,
    reason: missing.length === 0 ? "ok" : "missing-state",
    missing,
    skipped: PIPELINE_STEPS.slice(0, index).map((step) => step.id),
    remaining: PIPELINE_STEPS.slice(index).map((step) => step.id),
    fromIndex: index,
    fromTitle: target.title,
  };
}

/* “续跑”和“重跑”是两件事：续跑沿用断点；重跑允许研究员显式选择更早的
 * 步骤，但必须删掉该步及其下游的旧产物，否则一次新的检索可能继续使用上一轮
 * 的下载/图谱。已完成记录可从任意满足依赖的步骤重跑；中断/安全停止记录最多
 * 只能重跑到最后 checkpoint 的下一步，禁止越过尚未通过的质量门。 */
function restartPlan(record, fromId) {
  const target = stepById(fromId);
  if (!target) return { runnable: false, reason: "unknown-step", missing: [], fromId };
  if (!record?.state) return { runnable: false, reason: "no-state", missing: [], fromId, fromTitle: target.title };
  const dependency = resumePlan(record.state, fromId);
  if (!dependency.runnable) return { ...dependency, reason: "missing-state", fromId };
  if (record.outcome !== "completed" && record.status !== "completed") {
    const checkpoint = Number.isInteger(record.resumeStepIndex)
      ? record.resumeStepIndex : stepIndex(record.resumeStepId);
    const maxSafeIndex = checkpoint >= 0 ? checkpoint + 1 : 0;
    if (dependency.fromIndex > maxSafeIndex) {
      return { ...dependency, runnable: false, reason: "unsafe-skip", maxSafeIndex, fromId };
    }
  }
  return { ...dependency, runnable: true, reason: "ok", fromId };
}

function restartStateForStep(state, fromId) {
  const index = stepIndex(fromId);
  if (index < 0) return null;
  const next = { ...(state || {}) };
  const targetNeeds = new Set(PIPELINE_STEPS[index].needs || []);
  const staleKeys = new Set();
  for (const step of PIPELINE_STEPS.slice(index)) {
    for (const key of step.produces || []) staleKeys.add(key);
  }
  // query-refine / quality-gate / extra-providers / final-screen 会读取并覆写同一个
  // 字段（query 或 combined）。作为目标步输入的那一份必须保留；其它下游输出
  // 才是要清掉的陈旧状态。
  for (const key of staleKeys) if (!targetNeeds.has(key)) delete next[key];
  return next;
}

function describeRestart(record, fromId) {
  const plan = restartPlan(record, fromId);
  if (plan.runnable) {
    return `将保留前 ${plan.skipped.length} 步的上游状态，清除「${plan.fromTitle}」及其下游旧产物，然后重新执行剩余 ${plan.remaining.length} 步。`;
  }
  if (plan.reason === "no-state") return "这条旧记录没有可验证的状态包，只能使用原始主题从第 1 步重新运行。";
  if (plan.reason === "missing-state") return `不能从「${plan.fromTitle}」重跑：状态包缺少 ${plan.missing.join("、")}。请选择更早的步骤。`;
  if (plan.reason === "unsafe-skip") return "不能跳过尚未完成或尚未通过的质量门；请选择当前安全断点或更早的步骤。";
  return "无法识别要重新运行的 Pipeline 步骤。";
}

/* 一条运行记录能不能续跑，以及从哪一步续。
 *
 * outcome 是驱动循环写进记录的判定结果，只有三种：
 *   'stop'      质量门主动停机 —— 永不可续（见文件头说明）
 *   'fail'      异常中断      —— 可续
 *   'completed' 正常跑完      —— 不需要续
 * 老记录没有 outcome 字段：只要它存了 downloadedPaths 就仍按旧规则从
 * nature-reader 续，保持向后兼容。 */
function isResumable(record) {
  if (!record) return { resumable: false, reason: "no-record" };
  if (record.outcome === "stop") {
    return { resumable: false, reason: "quality-gate-stop", stopReason: record.stopReason || "" };
  }
  if (record.status === "completed") return { resumable: false, reason: "already-completed" };

  const state = record.state || null;
  const fromId = record.resumeStepId || null;
  if (state && fromId) {
    const plan = resumePlan(state, fromId);
    return plan.runnable
      ? { resumable: true, reason: "ok", fromId, plan }
      : { resumable: false, reason: "missing-state", fromId, plan };
  }
  /* 旧记录兼容路径。 */
  const legacyPaths = record.artifacts && Array.isArray(record.artifacts.downloadedPaths)
    ? record.artifacts.downloadedPaths : [];
  if (legacyPaths.length && record.resumeFrom === "nature-reader") {
    return { resumable: true, reason: "legacy-pdf-manifest", fromId: "nature-reader", legacy: true };
  }
  return { resumable: false, reason: "no-state" };
}

/* 把状态包裁到落盘预算之内。
 *
 * 丢弃顺序按「下游还要不要用」排：abstract 只有相关性评估用，而那一步在
 * combined 存在时必然已经跑完；results5 的逐条 diagnostic 明细只用于下载
 * 汇总那一行文字。两者都丢了还超预算，才放弃 combined 本身——此时记录仍能
 * 从 download 之后的步骤续跑（那些步骤的 needs 里没有 combined）。 */
function fitStateToBudget(state, budget = STATE_BUDGET_BYTES) {
  const size = (value) => {
    let text;
    try { text = JSON.stringify(value); } catch { return Infinity; }
    if (typeof text !== "string") return 0;
    return typeof Buffer !== "undefined" ? Buffer.byteLength(text, "utf8") : text.length;
  };
  let next = state || {};
  const dropped = [];
  if (size(next) <= budget) return { state: next, dropped, truncated: false };

  if (Array.isArray(next.combined)) {
    next = { ...next, combined: next.combined.map((rec) => {
      if (!rec || typeof rec !== "object") return rec;
      const copy = { ...rec };
      delete copy.abstract;
      return copy;
    }) };
    dropped.push("combined[].abstract");
    if (size(next) <= budget) return { state: next, dropped, truncated: true };
  }
  if (Array.isArray(next.results5)) {
    next = { ...next, results5: next.results5.map((item) => ({
      status: item && item.status, doi: item && item.doi, path: item && item.path,
    })) };
    dropped.push("results5[].detail");
    if (size(next) <= budget) return { state: next, dropped, truncated: true };
  }
  if (Array.isArray(next.combined) && next.combined.length) {
    next = { ...next, combined: [] };
    dropped.push("combined");
  }
  return { state: next, dropped, truncated: true };
}

/* 给续跑面板用的一句人话：会跳过什么、从哪继续、缺什么。 */
function describeResume(record) {
  const verdict = isResumable(record);
  if (verdict.resumable && verdict.legacy) {
    const count = record.artifacts.downloadedPaths.length;
    return `可以复用这批 ${count} 篇 PDF，跳过检索和下载，从第 6 步证据卡片继续。`;
  }
  if (verdict.resumable) {
    const plan = verdict.plan;
    return `将跳过前 ${plan.skipped.length} 步已完成的工作，从「${plan.fromTitle}」重新开始，剩余 ${plan.remaining.length} 步。`;
  }
  if (verdict.reason === "quality-gate-stop") {
    return `这是质量门的安全停止${verdict.stopReason ? `（${verdict.stopReason}）` : ""}，不提供续跑：继续运行会把不合格的检索结果带进证据链。请按提示修改后重新运行。`;
  }
  if (verdict.reason === "missing-state" && verdict.plan) {
    return `无法从「${verdict.plan.fromTitle}」续跑：状态包里缺少 ${verdict.plan.missing.join("、")}。需要重新运行这一步之前的阶段。`;
  }
  if (verdict.reason === "already-completed") return "这次运行已正常完成，不需要续跑。";
  return "该记录没有保存可恢复的状态包（旧版本记录），需要重新运行。";
}

const pipelineStepsApi = {
  PIPELINE_STEPS, STATE_BUDGET_BYTES,
  stepById, stepIndex, hasValue, resumePlan, restartPlan, restartStateForStep, describeRestart,
  isResumable, fitStateToBudget, describeResume,
};
if (typeof module !== "undefined" && module.exports) module.exports = pipelineStepsApi;
if (typeof window !== "undefined") window.weaverPipelineSteps = pipelineStepsApi;
