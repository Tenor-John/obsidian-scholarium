"use strict";
/* query-loop-core.js — 检索式「构建 → 质疑 → 修订」循环的纯函数核心。
 *
 * 对应 dual-agent-review skill 里只有协议、没有代码的缺口：循环控制全部
 * 是确定性代码——构建者只产出检索式，质疑者只产出评分，是否继续由
 * decideNext 按阈值（≥75）与最大轮数（3）判定，不依赖 Agent 自觉。
 *
 * 一轮 = buildBuilderPrompt → 构建者回复 → parseBuilderReply →（调用方执行
 * 真实检索）→ buildCriticPrompt → 质疑者回复 → parseCriticReply → decideNext。
 *
 * 浏览器：window.weaverQueryLoopCore；Node：module.exports。
 */

const SCORE_THRESHOLD = 75;
const MAX_CYCLES = 3;

function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  // CLI agents routinely wrap the requested JSON in a sentence or two of
  // preamble/aside ("好的，这是我的检索式：{...}" / reasoning that itself
  // mentions "{" in prose). A naive first-"{"-to-last-"}" slice breaks the
  // moment any such text sits between two real JSON fragments, or the reply
  // contains stray braces at all — this was the exact failure mode reported
  // live ("质疑者回复不是可解析的 JSON") with no way to tell whether the
  // agent actually replied with valid JSON. Scan for balanced {...} blocks
  // instead (respecting string literals, so a '{' or '}' inside a quoted
  // "problems" entry does not miscount depth), and try each candidate block
  // left to right until one parses.
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] !== "{") continue;
    let depth = 0, inString = false, escape = false;
    for (let j = i; j < candidate.length; j++) {
      const ch = candidate[j];
      if (inString) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(candidate.slice(i, j + 1)); }
          catch { /* not valid JSON despite balanced braces — try the next "{" */ }
          break;
        }
      }
    }
  }
  return null;
}

function clip(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function queryMetrics(query) {
  const text = String(query || "");
  let depth = 0, maxDepth = 0;
  for (const ch of text) {
    if (ch === "(") maxDepth = Math.max(maxDepth, ++depth);
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  return {
    characters: text.length,
    and_blocks: (text.match(/\bAND\b/gi) || []).length + 1,
    or_terms: (text.match(/\bOR\b/gi) || []).length,
    not_terms: (text.match(/\bNOT\b/gi) || []).length,
    doi_literals: (text.match(/10\.\d{4,9}\/[\w.()/:;-]+/gi) || []).length,
    max_parenthesis_depth: maxDepth,
  };
}

// The Agent judges sampled-result relevance/recall. Query complexity is scored
// in code so a model cannot earn points merely by appending more terms.
function scoreQuerySimplicity(query, cycle = 1) {
  const metrics = queryMetrics(query);
  const penalties = [];
  const penalize = (points, reason) => { if (points > 0) penalties.push({ points, reason }); };
  penalize(Math.min(8, Math.max(0, Math.ceil((metrics.characters - 450) / 100) * 2)), "检索式超过首轮建议的 450 字符");
  penalize(Math.min(9, Math.max(0, metrics.and_blocks - 2) * 3), "必需概念块过多，容易损失召回");
  penalize(Math.min(4, Math.max(0, Math.ceil((metrics.or_terms - 18) / 6))), "同义词扩展过密");
  penalize(metrics.not_terms ? (cycle < 3 ? 6 : 2) : 0, cycle < 3 ? "过早使用 NOT" : "NOT 仍有误删风险");
  penalize(metrics.doi_literals ? 6 : 0, "把 DOI/已知标题混入主题检索；应单独做覆盖检查");
  penalize(metrics.max_parenthesis_depth > 4 ? 3 : 0, "括号嵌套过深，跨库执行和审计困难");
  const deducted = Math.min(20, penalties.reduce((sum, item) => sum + item.points, 0));
  return { score: 20 - deducted, metrics, penalties };
}

/* ------------------------------------------------------------- builder -- */

function buildBuilderPrompt({ topic, feedback = null, cycle = 1 }) {
  const critiqueBlock = feedback
    ? `\n上一轮质疑者指出的问题：\n${feedback.problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n质疑者的修改建议：${feedback.suggestion || "（无具体建议）"}\n上一轮检索式：${feedback.query}\n`
    : "";
  const stageRule = cycle === 1
    ? "这是宽召回发现版：只保留 2 个真正必需的概念块，每块先用少量高价值同义词；不得加入 DOI、已知论文标题或 NOT；目标不超过 450 字符。"
    : cycle === 2
      ? "这是诊断修订版：根据真实命中样本一次只修改一个组件（补一个缺失同义词，或收紧一个明确噪声源）；不要同时新增多个 AND 块。"
      : "这是最后的精度版：仅在样本证明噪声持续存在时增加 1 个上下文块；NOT 只能针对已观察到的具体噪声，并说明可能漏掉什么；目标不超过 700 字符。";
  return `你是"织研者"的检索式构建者。为下面的研究主题构建一条可审计的文献检索式（第 ${cycle} 轮，共 ${MAX_CYCLES} 轮）。

研究主题：${topic}
${critiqueBlock}
要求：
1. ${stageRule}
2. 检索式用英文，OR 只连接同一概念的替代表达，AND 只连接真正必需的概念块；查询不是越长越好。
3. 面向跨库使用（OpenAlex / PubMed / Semantic Scholar / Scopus），避免只有单一数据库支持的字段代码。
4. 若有质疑者反馈，先判断是漏检还是噪声，只做反馈指定的最小改动；不得为了“覆盖更多概念”机械堆词。

只输出 JSON：
{"query":"...","rationale":"这条检索式的设计理由（中文，100 字内）"}`;
}

function parseBuilderReply(raw) {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { ok: false, error: "构建者回复不是可解析的 JSON" };
  const query = String(parsed.query || "").trim();
  if (query.length < 3) return { ok: false, error: "构建者没有给出检索式" };
  return { ok: true, query: clip(query, 2000), rationale: clip(parsed.rationale || "", 400) };
}

/* -------------------------------------------------------------- critic -- */

function buildCriticPrompt({ topic, query, records = [], cycle = 1 }) {
  const sample = records.slice(0, 15).map((r, i) =>
    `[${i + 1}] ${clip(r.title || "(无标题)", 140)}${r.publication_year || r.year ? ` (${r.publication_year || r.year})` : ""}${r.source ? ` <${r.source}>` : ""}`
  ).join("\n") || "（本次检索没有命中任何记录）";
  const simplicity = scoreQuerySimplicity(query, cycle);
  return `你是"织研者"的检索式质疑者。你的职责是根据真实命中样本诊断，不奖励检索式长度。

研究主题：${topic}
待评估检索式：${query}
该检索式实际命中的记录（共 ${records.length} 条，抽样前 15 条）：
${sample}

代码已计算的复杂度诊断：${JSON.stringify(simplicity)}

评分总计 100 分，必须逐项给分：
- 样本相关性 0-40：抽样标题与主题是否贴合、噪声比例；
- 发现阶段召回 0-25：是否覆盖主题的必要概念；不要因为没有塞入所有下位机制词而扣分；
- 跨库可执行性 0-15：布尔语法是否健康，是否依赖单库字段或不可移植写法；
- 简洁与渐进性 0-20：由代码固定为 ${simplicity.score} 分，禁止修改。长查询、多 AND 块、过早 NOT、把 DOI 混入查询都会扣分。

总分由程序相加，不接受一个无依据的总分。若要修订，只建议下一轮改动一个组件；已知 DOI/标题只能作为单独覆盖检查，不能 OR 进主题查询。

只输出 JSON：
{"score_breakdown":{"relevance":32,"recall":20,"executability":13},"problems":["具体问题1","具体问题2"],"suggestion":"下一轮只改一个组件的具体做法（中文，150 字内）"}
程序会加上 simplicity=${simplicity.score}，总分达到 ${SCORE_THRESHOLD} 即通过。`;
}

function parseCriticReply(raw, { query = "", cycle = 1 } = {}) {
  const parsed = extractJsonObject(raw);
  if (!parsed) return { ok: false, error: "质疑者回复不是可解析的 JSON" };
  const parts = parsed.score_breakdown;
  if (!parts || typeof parts !== "object") return { ok: false, error: "质疑者回复缺少 score_breakdown 分项评分" };
  const bounded = (value, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : null;
  };
  const relevance = bounded(parts.relevance, 40);
  const recall = bounded(parts.recall, 25);
  const executability = bounded(parts.executability, 15);
  if ([relevance, recall, executability].some((value) => value == null))
    return { ok: false, error: "score_breakdown 必须包含 relevance / recall / executability 数值" };
  const complexity = scoreQuerySimplicity(query, cycle);
  const breakdown = { relevance, recall, executability, simplicity: complexity.score };
  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const problems = Array.isArray(parsed.problems)
    ? parsed.problems.map((p) => clip(p, 200)).filter(Boolean).slice(0, 8)
    : [];
  // verdict 以分数为准——质疑者写 pass 但分数不达标时按 revise 处理。
  const verdict = score >= SCORE_THRESHOLD ? "pass" : "revise";
  return { ok: true, score, verdict, breakdown, complexity, problems, suggestion: clip(parsed.suggestion || "", 400) };
}

/* --------------------------------------------------------- cycle control -- */

/* 'accept' 达标 | 'revise' 继续 | 'exhausted' 轮数用尽（取历史最佳） */
function decideNext({ cycle, score, maxCycles = MAX_CYCLES, threshold = SCORE_THRESHOLD }) {
  if (score >= threshold) return "accept";
  if (cycle >= maxCycles) return "exhausted";
  return "revise";
}

const queryLoopApi = {
  SCORE_THRESHOLD, MAX_CYCLES,
  queryMetrics, scoreQuerySimplicity,
  buildBuilderPrompt, parseBuilderReply,
  buildCriticPrompt, parseCriticReply,
  decideNext,
};
if (typeof module !== "undefined" && module.exports) module.exports = queryLoopApi;
if (typeof window !== "undefined") window.weaverQueryLoopCore = queryLoopApi;
