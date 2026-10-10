/* concept-query-core.js — relationship-aware concept matrices and Boolean plans.
 *
 * A flat list of concepts is not enough to build a safe search query: some
 * concepts are mandatory, some are alternative research branches, and some
 * are merely useful refinements. Treating every block as AND can narrow a
 * valid topic to zero results. This module keeps those relationships explicit
 * and is intentionally pure so the browser pipeline and tests share rules.
 *
 * Browser: window.weaverConceptQuery; Node: module.exports.
 */

"use strict";

const MODES = new Set(["required", "alternative", "optional"]);

/* 各数据源对检索式长度的硬上限。OpenAlex 的 1500 是它自己在 400 响应里写明的
 * （"Your search is too long (1938 characters; the limit is 1500)"）。 */
const SOURCE_QUERY_LIMITS = { openalex: 1500, pubmed: 4000, "semantic-scholar": 1000, scopus: 2000 };

function clean(value) {
  return String(value || "").trim();
}

function uniqueTerms(values) {
  const seen = new Set();
  const terms = [];
  for (const value of Array.isArray(values) ? values : []) {
    const term = clean(value);
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

function looksLikePlaceholder(block) {
  const values = [block?.block, ...(block?.terms || [])]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  return values.some((value) =>
    /^(?:x|y|z|component\s*[xyz]|[xyz]\s*component)$/.test(value)
    || /(?:third|additional|variable|unspecified|unknown|candidate)\s+(?:material|component|phase|dopant|catalyst)/.test(value)
    || /(?:placeholder|to be determined|not specified)/.test(value)
    || /(?:占位|待定|未指定|未知|可变|第三组分|附加组分|额外组分)/.test(value)
  );
}

function normalizeConceptBlock(block, index = 0) {
  const role = clean(block?.role).toLowerCase() || "process";
  let mode = clean(block?.mode || block?.query_mode).toLowerCase();
  if (!MODES.has(mode)) {
    if (role === "refinement" || block?.required_in_v0 === false || looksLikePlaceholder(block)) mode = "optional";
    else if (role === "reaction_branch" || role === "application_branch") mode = "alternative";
    else mode = "required";
  }
  // Refinements and unresolved placeholders can never become hard filters,
  // even when an Agent accidentally marks required_in_v0=true.
  if (role === "refinement" || looksLikePlaceholder(block)) mode = "optional";

  const alternativeGroup = mode === "alternative"
    ? clean(block?.alternative_group || block?.group || "research-branch")
    : "";
  return {
    ...block,
    block: clean(block?.block) || `concept-${index + 1}`,
    role,
    terms: uniqueTerms(block?.terms),
    mode,
    alternative_group: alternativeGroup,
    required_in_v0: mode !== "optional",
  };
}

function normalizeConceptBlocks(blocks) {
  const normalized = (Array.isArray(blocks) ? blocks : [])
    .map(normalizeConceptBlock)
    .filter((block) => block.terms.length);
  const groupCounts = new Map();
  for (const block of normalized) {
    if (block.mode === "alternative") groupCounts.set(block.alternative_group, (groupCounts.get(block.alternative_group) || 0) + 1);
  }
  const warnings = [];
  for (const [group, count] of groupCounts) {
    if (count < 2) warnings.push(`备选分组“${group}”只有一个分支；建议 Agent 补全其他分支。`);
  }
  return { blocks: normalized, warnings };
}

function quoteTerm(term) {
  const value = clean(term);
  return /\s/.test(value) && !(value.startsWith('"') && value.endsWith('"'))
    ? `"${value.replace(/"/g, "")}"`
    : value;
}

function blockClause(block) {
  return `(${block.terms.map(quoteTerm).join(" OR ")})`;
}

function groupBlocks(blocks) {
  const normalized = normalizeConceptBlocks(blocks).blocks;
  const required = normalized.filter((block) => block.mode === "required");
  const optional = normalized.filter((block) => block.mode === "optional");
  const alternatives = new Map();
  for (const block of normalized.filter((item) => item.mode === "alternative")) {
    const group = block.alternative_group || "research-branch";
    if (!alternatives.has(group)) alternatives.set(group, []);
    alternatives.get(group).push(block);
  }
  return { normalized, required, optional, alternatives };
}

function buildBooleanPlan(blocks) {
  const grouped = groupBlocks(blocks);
  const baseParts = grouped.required.map(blockClause);
  for (const alternatives of grouped.alternatives.values()) {
    baseParts.push(`(${alternatives.map(blockClause).join(" OR ")})`);
  }
  const v0 = baseParts.join(" AND ");
  // query_v1 asks for at least one refinement signal instead of requiring
  // every optional concept. Individual refinements are emitted as variants.
  const optionalClause = grouped.optional.length
    ? `(${grouped.optional.map(blockClause).join(" OR ")})`
    : "";
  const v1 = [v0, optionalClause].filter(Boolean).join(" AND ");
  const variants = grouped.optional.map((block) => ({
    label: `refine-${block.block}`,
    query: [v0, blockClause(block)].filter(Boolean).join(" AND "),
    rationale: `Single optional refinement: ${block.block}`,
  }));
  return { ...grouped, v0, v1, variants };
}

/* 把检索式压到数据源的长度上限之内。
 *
 * OpenAlex 的 search 参数硬上限是 1500 字符，超了直接 400
 * （"Search query too long … the limit is 1500"）。而 buildBooleanPlan 的 v1
 * 是"v0 AND (所有 optional 块 OR 起来)"，块一多必然超——一次真实运行里 v1
 * 拼到了 1938 字符，第 3.6 步的两次重检索双双 400，UI 上只报了一句笼统的
 * "请求失败"，把一个纯粹的长度问题伪装成了数据源故障。
 *
 * 降级顺序按"丢掉后信息损失最小"排：
 *   1. 先丢 optional 块——它们本来就是加分项，v0 仍然完整；
 *   2. 还超就逐块截同义词（每块保留前 keepTerms 个，优先保留短的：化学式和
 *      缩写通常最短，也最可能出现在题录里）；
 *   3. 仍然超就只能整块截断，此时返回 ok:false，让调用方明确报告"这个课题的
 *      概念矩阵太大，无法压进上限"，而不是发一个必然 400 的请求。
 */
function fitQueryToLimit(blocks, limit = 1500) {
  const grouped = groupBlocks(blocks);
  const plan = buildBooleanPlan(blocks);
  const dropped = [];
  if (plan.v1.length <= limit) return { query: plan.v1, ok: true, dropped, degraded: false };

  dropped.push("optional 块");
  if (plan.v0.length <= limit) return { query: plan.v0, ok: true, dropped, degraded: true };

  for (const keepTerms of [6, 4, 3, 2, 1]) {
    const shrink = (block) => ({
      ...block,
      terms: [...block.terms].sort((a, b) => a.length - b.length).slice(0, keepTerms),
    });
    const parts = grouped.required.map((b) => blockClause(shrink(b)));
    for (const members of grouped.alternatives.values()) {
      parts.push(`(${members.map((b) => blockClause(shrink(b))).join(" OR ")})`);
    }
    const candidate = parts.join(" AND ");
    if (candidate.length <= limit) {
      dropped.push(`每块同义词保留 ${keepTerms} 个`);
      return { query: candidate, ok: true, dropped, degraded: true };
    }
  }
  return { query: plan.v0, ok: false, dropped, degraded: true };
}

function hardRequirementGroups(blocks) {
  const grouped = groupBlocks(blocks);
  return {
    required: grouped.required,
    alternatives: [...grouped.alternatives.entries()].map(([group, members]) => ({ group, members })),
  };
}

function passesHardRequirements(blocks, matchesBlock) {
  const hard = hardRequirementGroups(blocks);
  if (!hard.required.every((block) => matchesBlock(block))) return false;
  return hard.alternatives.every(({ members }) => members.some((block) => matchesBlock(block)));
}

const conceptQueryApi = {
  MODES,
  looksLikePlaceholder,
  normalizeConceptBlock,
  normalizeConceptBlocks,
  blockClause,
  groupBlocks,
  buildBooleanPlan,
  hardRequirementGroups,
  passesHardRequirements,
  fitQueryToLimit,
  SOURCE_QUERY_LIMITS,
};

if (typeof module !== "undefined" && module.exports) module.exports = conceptQueryApi;
if (typeof window !== "undefined") window.weaverConceptQuery = conceptQueryApi;
