"use strict";
/* p7-rehearsal.js — P7 闭环回扫的只读预演（纯函数模块，浏览器与 Node 双端可用）。
 *
 * 这是 docs/self-evolving-agent-design.md §3 P7 的"排练"版本：感知（M1 的
 * experiment.scan_outcomes）和产出（建议笔记）都在，唯独没有写通道——
 * 结算建议只作为草稿交给研究者确认，假设账本一个字段都不改。
 * 这样 P7 的推理质量可以先用真实数据验证，L2 propose 写路径留到 M4 按规格做。
 *
 * 三个函数各司其职：
 *   extractFrontmatterField  从实验/假设笔记里取完整字段（摘要 280 字不够推理用）
 *   buildRehearsalPrompt     组装发给本机 Agent CLI 的结算预演 prompt
 *   parseRehearsalReply      解析并校验回复：白名单外的编号、枚举外的结论一律丢弃
 *   renderRehearsalMarkdown  把通过校验的建议渲染成待确认的草稿笔记
 *
 * 浏览器：window.weaverP7Rehearsal；Node：module.exports（agent-canvas-demo 的
 * node --test 直接测这个文件，与 bridge-ui.js 里运行的是同一份代码）。
 */

const VERDICTS = ["supports", "contradicts", "qualifies", "inconclusive"];

/* Extract one scalar frontmatter field. Values are written with
 * JSON.stringify by tools/schema-objects.js, so quoted values are read back
 * with JSON.parse — hand-stripping quotes adds a backslash level on every
 * save, a bug this project has already shipped once. */
function extractFrontmatterField(text, key) {
  const source = String(text || "");
  if (!source.startsWith("---")) return "";
  const end = source.indexOf("\n---", 3);
  const frontmatter = end > 0 ? source.slice(3, end) : source.slice(3);
  const match = new RegExp("^" + key + ":\\s*(.*)$", "m").exec(frontmatter);
  if (!match) return "";
  const raw = match[1].trim();
  if (/^".*"$/.test(raw)) {
    try { return JSON.parse(raw); } catch { return raw.slice(1, -1); }
  }
  return raw.replace(/^'|'$/g, "");
}

/* experiments: [{ display_id, title, conclusion, tests: [display_id...], data_origin }]
 * hypotheses: [{ display_id, statement, status, settlement }]
 * project:   { display_id, title }                                        */
function buildRehearsalPrompt({ project, hypotheses, experiments }) {
  const hypLines = hypotheses.map((h) => {
    const s = h.settlement || {};
    return `- ${h.display_id}（当前状态：${h.status || "未知"}；已结算账本：支持 ${s.supports || 0} / 反驳 ${s.contradicts || 0} / 限定 ${s.qualifies || 0}）\n  陈述：${h.statement}`;
  }).join("\n");

  const expLines = experiments.map((e) => {
    const simulated = e.data_origin === "simulated"
      ? "\n  ⚠ 数据来源：模拟/演练数据（data_origin: simulated）——按 schema-v1 §4.6，模拟数据不得进入 integrated，任何基于它的结算建议都必须标注这一限制。"
      : "";
    return `### ${e.display_id} ${e.title}\n被测假设：${(e.tests || []).join("、") || "未声明"}\n结论：\n${e.conclusion}${simulated}`;
  }).join("\n\n");

  return `你是"织研者"P7 闭环回扫的结算预演 Agent。这是一次**只读预演**：你的产出是给人看的结算建议草稿，不会写入任何正式对象。

# 课题
${project.display_id} ${project.title}

# 待裁决假设（只允许引用这些编号）
${hypLines}

# 已出结论、尚未结算的实验（只允许引用这些编号）
${expLines}

# 任务
逐个判断：每个实验的结论对其被测假设意味着什么。只基于上面给出的实验结论，不得使用你的训练知识补充"事实"，不得引用上面未列出的假设或实验编号。

# 硬性规则
1. verdict 只能取：supports（结论直接支持假设）/ contradicts（直接反驳）/ qualifies（在特定条件下成立或收窄适用范围）/ inconclusive（不足以裁决）。
2. inconclusive 是合法答案。证据不足时不得硬写 supports——把不确定写成支持是这个系统定义里的 bug。
3. 数据来源标注为"模拟"的实验，verdict 最高只能给 qualifies，且 reason 必须说明证据等级限制。
4. reason 必须引用实验结论里的具体内容（数据、对照、统计量），不接受"结论表明……"式的空转述。
5. 如果一个实验的结论还指向了未被它声明测试的假设，写进 spillover，不要写进 settlements。

# 输出契约（严格）
先输出不超过 5 句的中文总结，然后输出一个 \`\`\`json 代码块，结构如下：
\`\`\`json
{
  "settlements": [
    { "hypothesis": "HYP-001", "verdict": "supports", "based_on": ["EXP-001"], "reason": "引用具体数据的理由" }
  ],
  "spillover": [
    { "experiment": "EXP-001", "hypothesis": "HYP-002", "note": "结论还暗示了……" }
  ],
  "notes": "对研究者的一句话提醒（可选）"
}
\`\`\``;
}

/* Balanced-brace scan for the first complete JSON object carrying a
 * "settlements" key. Agent output occasionally includes a preface, a fenced
 * block, or braces inside quoted text; a greedy regex merges those into
 * invalid JSON. Same reasoning as main.js's schExtractJsonReplyObject. */
function extractJsonObject(text, requiredKey) {
  const source = String(text || "");
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "{") continue;
    let depth = 0, inString = false, escaped = false;
    for (let j = i; j < source.length; j++) {
      const ch = source[j];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(i, j + 1));
            if (parsed && typeof parsed === "object" && requiredKey in parsed) return parsed;
          } catch { /* not this span — keep scanning */ }
          break;
        }
      }
    }
  }
  return null;
}

/* known: { hypotheses: [display_id...], experiments: [display_id...] }
 * Anything the agent invented — unknown ids, out-of-enum verdicts — is
 * dropped into `dropped` with a reason, not silently trusted and not
 * silently lost. */
function parseRehearsalReply(text, known) {
  const hypIds = new Set(known.hypotheses || []);
  const expIds = new Set(known.experiments || []);
  const parsed = extractJsonObject(text, "settlements");
  if (!parsed) return { ok: false, settlements: [], spillover: [], notes: "", dropped: [], error: "回复中找不到带 settlements 字段的 JSON 块" };

  const settlements = [], dropped = [];
  for (const item of Array.isArray(parsed.settlements) ? parsed.settlements : []) {
    const hyp = String(item && item.hypothesis || "");
    const verdict = String(item && item.verdict || "");
    const basedOn = Array.isArray(item && item.based_on) ? item.based_on.map(String) : [];
    const reason = String(item && item.reason || "").trim();
    if (!hypIds.has(hyp)) { dropped.push({ item, why: `假设编号不在本次白名单内：${hyp || "（空）"}` }); continue; }
    if (!VERDICTS.includes(verdict)) { dropped.push({ item, why: `verdict 非法：${verdict || "（空）"}` }); continue; }
    const unknownRefs = basedOn.filter((id) => !expIds.has(id));
    if (unknownRefs.length) { dropped.push({ item, why: `引用了白名单外的实验：${unknownRefs.join("、")}` }); continue; }
    if (!basedOn.length) { dropped.push({ item, why: "based_on 为空——没有依据的结算建议不接受" }); continue; }
    if (!reason) { dropped.push({ item, why: "reason 为空" }); continue; }
    settlements.push({ hypothesis: hyp, verdict, based_on: basedOn, reason });
  }

  const spillover = (Array.isArray(parsed.spillover) ? parsed.spillover : [])
    .filter((item) => expIds.has(String(item && item.experiment || "")))
    .map((item) => ({
      experiment: String(item.experiment),
      hypothesis: String(item.hypothesis || ""),
      note: String(item.note || "").trim(),
    }));

  return { ok: true, settlements, spillover, notes: String(parsed.notes || "").trim(), dropped };
}

const VERDICT_LABEL = { supports: "支持", contradicts: "反驳", qualifies: "限定", inconclusive: "证据不足" };

function renderRehearsalMarkdown(parsed, meta) {
  const at = meta && meta.at || new Date().toISOString();
  const lines = [
    "---",
    "type: p7-settlement-rehearsal",
    `created_at: ${JSON.stringify(at)}`,
    `project: ${JSON.stringify((meta && meta.project) || "")}`,
    `agent: ${JSON.stringify((meta && meta.agent) || "")}`,
    "status: draft-awaiting-user-review",
    "---",
    "",
    "# P7 结算预演建议（草稿，未写入任何正式对象）",
    "",
    "> 本文件由只读预演生成。采纳任何一条都需要你在正式流程里人工确认；",
    "> 此文件本身不改变假设账本、证据数组或实验状态。",
    "",
    "## 结算建议",
    "",
    "| 假设 | 建议 | 依据实验 | 理由 |",
    "|---|---|---|---|",
  ];
  for (const s of parsed.settlements)
    lines.push(`| ${s.hypothesis} | ${VERDICT_LABEL[s.verdict] || s.verdict} | ${s.based_on.join("、")} | ${s.reason.replace(/\|/g, "\\|")} |`);
  if (!parsed.settlements.length) lines.push("| （无通过校验的建议） | | | |");
  if (parsed.spillover.length) {
    lines.push("", "## 旁证（结论指向了未声明测试的假设）", "");
    for (const s of parsed.spillover) lines.push(`- ${s.experiment} → ${s.hypothesis || "（未指明）"}：${s.note}`);
  }
  if (parsed.dropped.length) {
    lines.push("", "## 被校验丢弃的条目（幻觉防护记录）", "");
    for (const d of parsed.dropped) lines.push(`- ${d.why}`);
  }
  if (parsed.notes) lines.push("", "## Agent 备注", "", parsed.notes);
  lines.push("");
  return lines.join("\n");
}

const api = { VERDICTS, VERDICT_LABEL, extractFrontmatterField, buildRehearsalPrompt, extractJsonObject, parseRehearsalReply, renderRehearsalMarkdown };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.weaverP7Rehearsal = api;
