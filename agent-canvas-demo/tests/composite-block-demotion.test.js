"use strict";
/**
 * 复合材料块降级：真实数据回归。
 *
 * 反应支修好之后，浮出来的第二个约束。Agent 生成的「Au–TiO2 photocatalyst
 * system」块（terms 全是 "Au/TiO2"、"Au–TiO2"、"gold-titania" 这类**连写**
 * 形式）与 ensureFormulaCoverage 自动补的 material-Au、material-TiO2 重复
 * 约束了同一件事，且额外要求论文把化合物写成连续词。
 *
 * 连写匹配天然歧视三元体系——第三个组分插在中间就断了。这正好打在
 * Au/TiO2/X 这类课题的要害上。
 *
 * bridge-ui.js 是浏览器脚本不能直接 require，所以这里用和 demote-probe 相同
 * 的办法：把公式解析层从源码里切出来在 Node 里实跑，测的是真实实现而不是复
 * 刻件。切片锚点变了测试会立刻失败，这是有意的。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cq = require("../concept-query-core.js");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "bridge-ui.js"), "utf8");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "au-tio2-relevance.json"), "utf8"));

function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a);
  assert.ok(a >= 0 && b > a, `bridge-ui.js 里找不到片段：${startMarker}`);
  return src.slice(a, b);
}
const code = [
  slice("const ELEMENT_SYMBOLS = new Set(", "function normalizeFormulaCase"),
  slice("function normalizeFormulaCase", "function normalizeTermKey"),
  slice("function normalizeTermKey", "function ensureFormulaCoverage"),
  slice("function ensureFormulaCoverage", "/* 复合材料块在元素块已覆盖时降为 optional"),
  slice("function compositeFormulasOf(block)", "function formulaQueryClause"),
  "module.exports={extractMaterialBlocks,ensureFormulaCoverage,compositeFormulasOf,demoteRedundantCompositeBlocks};",
].join("\n");
const mod = { exports: {} };
new Function("module", "window", code)(mod, {});
const { compositeFormulasOf, demoteRedundantCompositeBlocks, ensureFormulaCoverage } = mod.exports;

/* 与 bridge-ui.js 一致的逐条匹配规则（relevance-gate-regression.test.js 里
 * 有同一份，两处都靠下方的源码断言钉住）。 */
const normalize = (v) => String(v || "").toLowerCase().replace(/<[^>]+>/g, " ")
  .replace(/[₀-₉]/g, (ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch))).replace(/\s+/g, " ");
function termAtBoundary(text, value) {
  const i = text.indexOf(value);
  if (i < 0) return false;
  const before = text[i - 1], after = text[i + value.length];
  const w = (c) => c !== undefined && /[a-z0-9]/.test(c);
  return !w(before) && !w(after);
}
function recordMatchesTerms(record, terms) {
  const text = normalize(`${record.title || ""} ${record.abstract || ""}`);
  const compactText = text.replace(/[^a-z0-9]+/g, "");
  return (terms || []).some((term) => {
    const value = normalize(String(term || "").replace(/[*?]/g, ""));
    if (!value) return false;
    if (termAtBoundary(text, value)) return true;
    const ct = value.replace(/[^a-z0-9]+/g, "");
    return ct.length >= 3 && compactText.includes(ct);
  });
}
const hardPass = (record, blocks) => {
  const required = cq.normalizeConceptBlocks(blocks).blocks
    .filter((b) => b.required_in_v0 !== false && b.mode !== "alternative");
  return !required.length || required.every((b) => recordMatchesTerms(record, b.terms));
};

const { records, conceptBlocks } = fixture;

/* ── 识别 ───────────────────────────────────────────────────────────── */

test("复合块解析出两个化学式，元素块各解析出一个", () => {
  const byName = (n) => conceptBlocks.find((b) => b.block === n);
  assert.deepEqual([...compositeFormulasOf(byName("Au–TiO2 photocatalyst system"))].sort(), ["Au", "TiO2"]);
  assert.deepEqual([...compositeFormulasOf(byName("material-Au"))], ["Au"]);
  assert.deepEqual([...compositeFormulasOf(byName("material-TiO2"))], ["TiO2"]);
});

test("只有复合块被降级，元素块原样保留为必需", () => {
  const result = demoteRedundantCompositeBlocks(conceptBlocks);
  assert.deepEqual(result.demoted.map((d) => d.block), ["Au–TiO2 photocatalyst system"]);
  const stillRequired = result.blocks
    .filter((b) => b.role === "material" && b.required_in_v0 !== false)
    .map((b) => b.block);
  assert.deepEqual(stillRequired, ["material-Au", "material-TiO2"]);
});

test("降级只改 required/mode，不动 terms——它仍要参与打分", () => {
  const result = demoteRedundantCompositeBlocks(conceptBlocks);
  const before = conceptBlocks.find((b) => b.block === "Au–TiO2 photocatalyst system");
  const after = result.blocks.find((b) => b.block === "Au–TiO2 photocatalyst system");
  assert.equal(after.required_in_v0, false);
  assert.equal(after.mode, "optional");
  assert.deepEqual(after.terms, before.terms);
});

/* ── 安全网不能被拆掉 ───────────────────────────────────────────────── */

test("复合块是唯一材料来源时不降级——那正是兜底安全网本身", () => {
  const lonely = [
    { block: "Au–TiO2 system", role: "material", mode: "required", required_in_v0: true, alternative_group: "", terms: ["Au/TiO2", "gold titania"] },
    { block: "photocatalytic process", role: "process", mode: "required", required_in_v0: true, alternative_group: "", terms: ["photocatalytic"] },
  ];
  const result = demoteRedundantCompositeBlocks(lonely);
  assert.deepEqual(result.demoted, [], "没有元素块兜底时降级会让课题材料彻底失去约束");
  assert.equal(result.blocks[0].required_in_v0, true);
});

test("只覆盖了一半也不降级", () => {
  const half = [
    { block: "Au–TiO2 system", role: "material", mode: "required", required_in_v0: true, alternative_group: "", terms: ["Au/TiO2"] },
    { block: "material-Au", role: "material", mode: "required", required_in_v0: true, alternative_group: "", terms: ["Au", "gold"] },
  ];
  assert.deepEqual(demoteRedundantCompositeBlocks(half).demoted, [], "TiO2 没有自己的必需块，复合块仍是唯一约束来源");
});

test("单一化学式的材料块永远不会被当成复合块", () => {
  const single = [
    { block: "material-TiO2", role: "material", mode: "required", required_in_v0: true, alternative_group: "", terms: ["TiO2", "titania", "titanium dioxide"] },
  ];
  assert.deepEqual(demoteRedundantCompositeBlocks(single).demoted, []);
});

/* ── 真实 80 条上的效果 ─────────────────────────────────────────────── */

test("降级后通过数 56 → 61，低相关比例 30% → 24%", () => {
  const before = records.filter((r) => hardPass(r, conceptBlocks)).length;
  const after = records.filter((r) => hardPass(r, demoteRedundantCompositeBlocks(conceptBlocks).blocks)).length;
  assert.equal(before, 56);
  assert.equal(after, 61);
  assert.equal(Math.round((1 - after / records.length) * 100), 24);
});

test("被连写形式误杀的三元体系与分写形式都捞回来了", () => {
  const demoted = demoteRedundantCompositeBlocks(conceptBlocks).blocks;
  const rescued = [
    "Au–CuS–TiO2",                                   // 三元体系：第三组分插在中间，连写必断
    "between plasmonic Au and TiO2",                 // Au 与 TiO2 分开写
  ];
  for (const needle of rescued) {
    const record = records.find((r) => String(r.title || "").includes(needle));
    assert.ok(record, `夹具里应当有：${needle}`);
    assert.equal(hardPass(record, conceptBlocks), false, "修复前应当被拦下（对照组）");
    assert.equal(hardPass(record, demoted), true, `仍被误杀：${record.title}`);
  }
});

test("材料约束没有被放松——缺 Au 或缺 TiO2 的仍然过不了", () => {
  const demoted = demoteRedundantCompositeBlocks(conceptBlocks).blocks;
  const au = demoted.find((b) => b.block === "material-Au");
  const tio2 = demoted.find((b) => b.block === "material-TiO2");
  const offenders = records.filter((r) => !recordMatchesTerms(r, au.terms) || !recordMatchesTerms(r, tio2.terms));
  assert.ok(offenders.length > 0, "夹具里应当有缺核心材料的记录");
  for (const r of offenders) {
    assert.equal(hardPass(r, demoted), false, `材料块失守：${r.title}`);
  }
});

/* ── 接线 ───────────────────────────────────────────────────────────── */

test("降级紧跟在化学式兜底补块之后执行", () => {
  // 补块正是复合块变成冗余约束的原因，两者必须成对出现。
  const coverageAt = src.indexOf("const coverage = ensureFormulaCoverage(conceptBlocks, question)");
  const demoteAt = src.indexOf("const demotion = demoteRedundantCompositeBlocks(conceptBlocks)");
  const manifestAt = src.indexOf("step1.manifest.concept_matrix = conceptBlocks");
  assert.ok(coverageAt > 0 && demoteAt > coverageAt, "降级必须在兜底补块之后");
  assert.ok(manifestAt > demoteAt, "降级必须在矩阵写回 manifest 之前");
});

test("降级动作会写进矩阵来源说明，用户看得见", () => {
  assert.match(src, /复合体系块已降为加分项/);
});
