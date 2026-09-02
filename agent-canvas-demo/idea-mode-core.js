"use strict";
/* idea-mode-core.js — Idea 模式的纯函数核心（浏览器与 Node 双端可用）。
 *
 * Idea 模式（docs/self-evolving-agent-design.md M2）：给一个主题 → 调
 * /v1/literature/search 检索 → Agent 综合成总结 + 候选问题/假设 → 以
 * schema-v1 笔记（created_by: ai, review_status: pending）经
 * /v1/drafts/batch 两段确认落盘。本文件只负责其中可单测的四步：
 *
 *   buildIdeaPrompt    组装综合 prompt（只允许基于实际检索到的记录发言）
 *   parseIdeaReply     解析并校验 Agent 回复（结构/数量/长度门禁）
 *   allocateIds        在既有 display_id 集合上分配下一批 QUE-xxx / HYP-xxx / IDEA-xxx
 *   buildIdeaNotes     把通过校验的问题/假设渲染成 schema-v1 笔记 { path, content }
 *   buildIdeaCard      把综合结果渲染成 schema-v1 §5.1 的 Idea 卡片笔记（type: idea）
 *
 * 浏览器：window.weaverIdeaModeCore；Node：module.exports。
 */

const MAX_QUESTIONS = 6;
const MAX_HYPOTHESES = 6;
const MAX_STATEMENT = 120;
const MAX_HOTSPOTS = 6;
const MAX_GAPS = 6;
const MAX_SHORT_ITEM = 80;
const MAX_KEY_PAPERS = 8;

function extractJsonObject(raw) {
  const text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

function clip(text, max) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function recordLine(record, index) {
  const bits = [
    `[${index + 1}]`,
    clip(record.title || "(无标题)", 140),
    record.publication_year || record.year || "",
    record.doi ? `doi:${record.doi}` : "",
    record.is_oa ? "OA" : "",
  ].filter(Boolean);
  return bits.join(" ");
}

function buildIdeaPrompt({ topic, records = [], corpus = [] }) {
  const list = records.map(recordLine).join("\n") || "（没有检索到记录）";
  const corpusBlock = corpus.length
    ? `\n研究员自己的文献库中命中的相关片段（编号 [C1]…，可信度高于在线元数据，可用作依据）：\n${corpus.map((c, i) => `[C${i + 1}] ${clip(c.snippet || "", 260)}（来源：${c.source}${c.heading ? `#${c.heading}` : ""}）`).join("\n")}\n`
    : "";
  return `你是"织研者"的 Idea 模式引擎。研究员给出一个感兴趣的主题，并附上一组刚刚从开放文献库真实检索到的记录。你的任务是基于这些记录做一次快速侦察式综合。

主题：${topic}

实际检索到的记录（编号 [n] 之后复述时只能用这些编号引用）：
${list}
${corpusBlock}
严格规则：
1. 只能基于上面列出的记录与文献库片段发言；不得虚构文献、作者、年份、DOI 或数据。没有直接依据的判断标为"推测"。
2. 总结不超过 250 字：这个领域的研究现状、主流路线、明显分歧或空白。
3. 列出 ${MAX_HOTSPOTS} 个以内研究热点聚类（hotspots）：每条不超过 ${MAX_SHORT_ITEM / 2} 字的短语，不是句子。
4. 列出 ${MAX_GAPS} 个以内明显的空白点（gaps）：这个领域目前缺什么，同样是短语级别。
5. 提出 ${MAX_QUESTIONS} 个以内值得追的科学问题（question）：要具体、可证伪、与该主题直接相关。
6. 提出 ${MAX_HYPOTHESES} 个以内可检验的假设（hypothesis）：每条写清陈述和提出理由（rationale），理由里用 [n] 引用检索记录${corpus.length ? "、用 [Cn] 引用文献库片段" : ""}。
7. 所有输出用中文。

只输出 JSON（不要加 Markdown 代码块以外的任何东西）：
{"summary":"...","hotspots":["...","..."],"gaps":["...","..."],"questions":[{"statement":"...","why":"..."}],"hypotheses":[{"statement":"...","rationale":"... 依据 ${corpus.length ? "[1][C1]" : "[1][3]"}"}]}`;
}

function parseIdeaReply(raw, opts = {}) {
  const maxQ = opts.maxQuestions || MAX_QUESTIONS;
  const maxH = opts.maxHypotheses || MAX_HYPOTHESES;
  const parsed = extractJsonObject(raw);
  if (!parsed) return { ok: false, error: "Agent 回复不是可解析的 JSON" };
  const summary = String(parsed.summary || "").trim();
  if (!summary) return { ok: false, error: "回复缺少 summary 字段" };

  const dropped = [];
  const cleanList = (value, kind, max) => {
    if (!Array.isArray(value)) return [];
    const out = [];
    for (const item of value) {
      if (out.length >= max) { dropped.push(`${kind} 超出上限 ${max}，多余条目已丢弃`); break; }
      const statement = clip(item?.statement, MAX_STATEMENT);
      if (!statement) { dropped.push(`${kind} 条目缺 statement，已丢弃`); continue; }
      out.push({
        statement,
        note: clip(item?.why || item?.rationale || "", 400),
      });
    }
    return out;
  };

  // 热点/空白点是短语级别的字符串数组（不是 {statement} 对象）：截断更短、
  // 丢弃空白项、按上限截断，静默丢弃不报错——它们只是卡片摘要的一部分，不
  // 像 question/hypothesis 那样是笔记生成的主体，空数组也应当是合法结果。
  const cleanShortList = (value, max) => {
    if (!Array.isArray(value)) return [];
    return value.map((item) => clip(item, MAX_SHORT_ITEM)).filter(Boolean).slice(0, max);
  };

  const questions = cleanList(parsed.questions, "question", maxQ);
  const hypotheses = cleanList(parsed.hypotheses, "hypothesis", maxH);
  const hotspots = cleanShortList(parsed.hotspots, MAX_HOTSPOTS);
  const gaps = cleanShortList(parsed.gaps, MAX_GAPS);
  if (!questions.length && !hypotheses.length)
    return { ok: false, error: "回复里没有可用的问题或假设", dropped };
  return { ok: true, summary, hotspots, gaps, questions, hypotheses, dropped };
}

/* 文件名只允许安全字符；陈述截断到 24 字。 */
function sanitizeFileName(text, max = 24) {
  return clip(text, max).replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "未命名";
}

/* 在既有编号集合上分配下一批连续编号：HYP-001 + 2 → [HYP-002, HYP-003]。 */
function allocateIds(existingIds, prefix, count) {
  let max = 0;
  for (const id of existingIds || []) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(id));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(max + i + 1).padStart(3, "0")}`);
}

function yamlQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function noteFrontmatter({ uid, displayId, type, statement, status, at, topic }) {
  return [
    "---",
    `uid: ${yamlQuote(uid)}`,
    `display_id: ${yamlQuote(displayId)}`,
    "schema_version: 1",
    `type: ${yamlQuote(type)}`,
    `created_at: ${yamlQuote(at)}`,
    `updated_at: ${yamlQuote(at)}`,
    `statement: ${yamlQuote(statement)}`,
    `status: ${yamlQuote(status)}`,
    'created_by: "ai"',
    'review_status: "pending"',
    'source: "idea-mode"',
    `idea_topic: ${yamlQuote(topic)}`,
    "---",
  ].join("\n");
}

function sourceSection(records) {
  if (!records.length) return "";
  const lines = records.slice(0, 10).map((r, i) =>
    `- [${i + 1}] ${clip(r.title || "(无标题)", 120)}${r.doi ? ` — doi:${r.doi}` : ""}`);
  return ["", "## 检索线索（仅元数据，未读全文）", "", ...lines, ""].join("\n");
}

function yamlList(key, items, indent = "") {
  if (!items.length) return `${indent}${key}: []`;
  return [`${indent}${key}:`, ...items.map((v) => `${indent}  - ${yamlQuote(v)}`)].join("\n");
}

/* 从实际检索到的记录里确定性地取带 DOI 的 Top-N，绝不让 Agent 自己编 DOI
 * 列表（§5.1 key_papers 是 schema-v1 对象的一个字段，schema-objects.js 的
 * 红线是"不得虚构文献引用"——这条只能从已经真实检索到的 records 派生）。 */
function pickKeyPapers(records, max = MAX_KEY_PAPERS) {
  return records.filter((r) => r?.doi).slice(0, max).map((r) => String(r.doi));
}

/* 把 Idea 综合结果渲染成 schema-v1 §5.1 的 Idea 卡片：{ path, content }。
 * 独立于 buildIdeaNotes 的 Question/Hypothesis 草稿——卡片先落盘、随时可
 * 浏览/搁置，是否进一步产出 Question/Hypothesis 草稿是使用者另外的选择，
 * 不由这个函数决定。status 恒为 exploring：从 exploring 升级到 promoted
 * 需要通过 M3 的原子 promotion 事务真正创建 PRJ；卡片生成阶段不冒充。 */
function buildIdeaCard({ topic, summary, hotspots = [], gaps = [], records = [], existingIds = [], at, uid }) {
  const now = at || new Date().toISOString();
  const resolvedUid = uid || (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `uid-${Math.random().toString(36).slice(2)}`);
  const displayId = allocateIds(existingIds, "IDEA", 1)[0];
  const keyPapers = pickKeyPapers(records);
  const frontmatter = [
    "---",
    `uid: ${yamlQuote(resolvedUid)}`,
    `display_id: ${yamlQuote(displayId)}`,
    "schema_version: 1",
    'type: "idea"',
    `created_at: ${yamlQuote(now)}`,
    `updated_at: ${yamlQuote(now)}`,
    `title: ${yamlQuote(topic)}`,
    'status: "exploring"',
    `summary: ${yamlQuote(summary)}`,
    yamlList("hotspots", hotspots),
    yamlList("key_papers", keyPapers),
    yamlList("gaps", gaps),
    'promoted_to: ""',
    'created_by: "ai"',
    'source: "idea-mode"',
    "---",
  ].join("\n");
  const papersSection = records.length ? sourceSection(records) : "";
  const body = `

# ${displayId} ${topic}

## 侦察总结

${summary}

${hotspots.length ? `## 研究热点\n\n${hotspots.map((h) => `- ${h}`).join("\n")}\n` : ""}
${gaps.length ? `## 明显空白点\n\n${gaps.map((g) => `- ${g}`).join("\n")}\n` : ""}
> 本卡片由 Idea 模式生成（created_by: ai），status: exploring。搁置或（M3 起）升级为课题在列表页操作。
${papersSection}`;
  return { path: `Research/Ideas/${displayId} ${sanitizeFileName(topic)}.md`, content: frontmatter + body, displayId };
}

/* 把通过校验的 Idea 结果渲染成待确认的 schema-v1 笔记批次。 */
function buildIdeaNotes({ topic, summary, questions = [], hypotheses = [], existingIds = [], records = [], at, uidFn }) {
  const now = at || new Date().toISOString();
  const uid = uidFn || (() => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `uid-${Math.random().toString(36).slice(2)}`));
  const items = [];

  const queIds = allocateIds(existingIds, "QUE", questions.length);
  questions.forEach((q, i) => {
    const displayId = queIds[i];
    items.push({
      path: `Research/Questions/${displayId} ${sanitizeFileName(q.statement)}.md`,
      content: `${noteFrontmatter({ uid: uid(), displayId, type: "question", statement: q.statement, status: "open", at: now, topic })}

# ${displayId} ${q.statement}

${q.note ? `## 为什么值得追\n\n${q.note}\n` : ""}
## Idea 模式摘要

${summary}

> 检索主题：${topic}
> 本笔记由 Idea 模式生成（created_by: ai），等待研究者审阅（review_status: pending）。
${sourceSection(records)}`,
    });
  });

  const hypIds = allocateIds(existingIds, "HYP", hypotheses.length);
  hypotheses.forEach((h, i) => {
    const displayId = hypIds[i];
    items.push({
      path: `Research/Hypotheses/${displayId} ${sanitizeFileName(h.statement)}.md`,
      content: `${noteFrontmatter({ uid: uid(), displayId, type: "hypothesis", statement: h.statement, status: "proposed", at: now, topic })}

# ${displayId} ${h.statement}

${h.note ? `## 提出理由\n\n${h.note}\n` : ""}
## Idea 模式摘要

${summary}

> 检索主题：${topic}
> 本笔记由 Idea 模式生成（created_by: ai），等待研究者审阅（review_status: pending）。
${sourceSection(records)}`,
    });
  });

  return items;
}

const ideaCoreApi = {
  MAX_QUESTIONS, MAX_HYPOTHESES, MAX_HOTSPOTS, MAX_GAPS,
  buildIdeaPrompt, parseIdeaReply, allocateIds, sanitizeFileName, buildIdeaNotes, buildIdeaCard,
};
if (typeof module !== "undefined" && module.exports) module.exports = ideaCoreApi;
if (typeof window !== "undefined") window.weaverIdeaModeCore = ideaCoreApi;
