"use strict";
/**
 * 相关性判定回归：用一次真实故障的原始数据当夹具。
 *
 * 背景（2026-09-06，Au/TiO2 光催化课题）：OpenAlex 返回 80 条完全对口的题录，
 * Pipeline 却报「低相关比例 98%」并停机。被毙掉的包括
 * "Interfacial facet engineering on the Schottky barrier between plasmonic Au
 * and TiO2…"、"Synthesis of Core−Shell Au@TiO2 Nanoparticles…" 这类正中靶心的
 * 论文。
 *
 * 原因不在检索，而在两道门用了两套互相矛盾的规则：
 *   · 第 3.5 步的比例门走 passesHardRequirements，把 alternative 组当成
 *     「至少命中一个」的硬要求 → 2/80 通过；
 *   · 第 3.95 步的 classifyRecordTier 把 alternative 排除在 required 之外
 *     → 64/80 通过。
 * Pipeline 死在前一道门上，后一道门根本没机会执行。
 *
 * 而 alternative 组之所以只有 2/80，是因为 Agent 生成的反应支词条是
 * "photocatalytic organic oxidation"、"benzyl alcohol oxidation" 这类长逐字
 * 短语，匹配又是连续子串比对；再叠加这批 80 条里有 40 条没有摘要（只能拿标题
 * 撞词组），命中数注定接近 0。
 *
 * 这组测试锁住修复后的行为，防止将来有人把反应支改回硬门槛。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cq = require("../concept-query-core.js");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "au-tio2-relevance.json"), "utf8"));
const ui = fs.readFileSync(path.join(__dirname, "..", "bridge-ui.js"), "utf8");

/* bridge-ui.js 是浏览器脚本，不能直接 require。这里复刻它的匹配与分层规则，
 * 并在下面用源码断言把两边钉在一起——复刻件漂了，那条断言会先失败。 */
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
const hardBlocks = (blocks) => blocks.filter((b) => b.required_in_v0 !== false && b.mode !== "alternative");
const alternativeBlocks = (blocks) => blocks.filter((b) => b.mode === "alternative");
const passesHardConceptGate = (record, blocks) => {
  const required = hardBlocks(cq.normalizeConceptBlocks(blocks).blocks);
  return !required.length || required.every((b) => recordMatchesTerms(record, b.terms));
};
function classifyRecordTier(record, blocks) {
  const normalized = cq.normalizeConceptBlocks(blocks).blocks;
  const required = hardBlocks(normalized);
  const branches = alternativeBlocks(normalized);
  const branchHit = !branches.length || branches.some((b) => recordMatchesTerms(record, b.terms));
  if (!required.length) return branchHit ? "core" : "peripheral";
  const materials = required.filter((b) => b.role === "material");
  if (!materials.length) {
    if (!required.every((b) => recordMatchesTerms(record, b.terms))) return "background";
    return branchHit ? "core" : "peripheral";
  }
  if (!materials.every((b) => recordMatchesTerms(record, b.terms))) return "background";
  if (!required.every((b) => recordMatchesTerms(record, b.terms))) return "peripheral";
  return branchHit ? "core" : "peripheral";
}

const { records, conceptBlocks } = fixture;

test("夹具就是那次故障的原始数据：80 条，其中 40 条没有摘要", () => {
  assert.equal(records.length, 80);
  assert.equal(records.filter((r) => !String(r.abstract || "").trim()).length, 40);
  assert.equal(conceptBlocks.filter((b) => b.mode === "alternative").length, 4);
});

test("旧口径（反应支作硬门槛）在这批数据上只放行 2/80——复现 98% 停机", () => {
  const pass = records.filter((r) => cq.passesHardRequirements(conceptBlocks, (b) => recordMatchesTerms(r, b.terms))).length;
  assert.equal(pass, 2, "这是修复前的行为，保留它是为了让回归的对照组是真实数字");
  assert.equal(Math.round((1 - pass / records.length) * 100), 98);
});

test("新口径放行 56/80，低相关比例 30%，低于 0.6 阈值 → Pipeline 会继续", () => {
  const pass = records.filter((r) => passesHardConceptGate(r, conceptBlocks)).length;
  assert.equal(pass, 56);
  const lowRatio = 1 - pass / records.length;
  assert.equal(Math.round(lowRatio * 100), 30);
  assert.ok(lowRatio < 0.6, "必须低于默认阈值 lowRelevanceRatio，否则这次修复没有解决停机");
});

test("反应支害死的那些对口论文，现在都能过门", () => {
  const rescued = [
    "Synthesis of Core−Shell Au@TiO2 Nanoparticles",
    "UV and visible light photocatalytic activity of Au/TiO2 nanoforests",
    "Bifunctional Au@TiO2 core–shell nanoparticle films",
  ];
  for (const needle of rescued) {
    const record = records.find((r) => String(r.title || "").includes(needle.slice(0, 40)));
    assert.ok(record, `夹具里应当有这篇：${needle}`);
    assert.equal(passesHardConceptGate(record, conceptBlocks), true, `仍被误杀：${record.title}`);
  }
});

/* 反应支修好之后，下一个约束浮出水面：复合材料块。
 *
 * 「Au–TiO2 photocatalyst system」这个 role=material 的块，词条是 "Au/TiO2"、
 * "Au–TiO2"、"gold titania" 这类**连写**形式，而 material-Au 和 material-TiO2
 * 两个块（ensureFormulaCoverage 自动补的）已经分别管住了 Au 和 TiO2。于是同
 * 一个约束被要了两遍，且第二遍要求论文把化合物写成连续词。
 *
 * 代价是 61→56，而且被拦下的偏偏是三元体系（Au–CuS–TiO2）和分开写的
 * （"plasmonic Au and TiO2"）——正是 Au/TiO2/X 这类课题最需要的那部分文献。
 *
 * 这条测试不主张对错，只把当前行为和它的代价钉住：将来若决定放宽复合块，
 * 这里的数字会立刻提醒改动影响了多少篇。 */
test("复合材料块与元素块重复约束，代价是 5 篇（当前行为存档）", () => {
  const normalized = cq.normalizeConceptBlocks(conceptBlocks).blocks;
  const hard = hardBlocks(normalized);
  const composite = hard.find((b) => b.block === "Au–TiO2 photocatalyst system");
  assert.ok(composite, "夹具里应当有这个复合块");
  const withComposite = records.filter((r) => hard.every((b) => recordMatchesTerms(r, b.terms))).length;
  const withoutComposite = records.filter((r) => hard.filter((b) => b !== composite).every((b) => recordMatchesTerms(r, b.terms))).length;
  assert.equal(withComposite, 56);
  assert.equal(withoutComposite, 61);
  // 三元体系被复合块拦下——这正是 Au/TiO2/X 课题要研究的对象
  const ternary = records.find((r) => String(r.title || "").includes("Au–CuS–TiO2"));
  assert.ok(ternary, "夹具里应当有这篇三元体系论文");
  assert.equal(recordMatchesTerms(ternary, composite.terms), false, "三元体系写法不匹配连写的复合块词条");
});

test("材料/工艺块仍然守得住——它们本来就工作正常，不能被这次放宽波及", () => {
  const byName = (name) => conceptBlocks.find((b) => b.block === name);
  const hit = (b) => records.filter((r) => recordMatchesTerms(r, b.terms)).length;
  assert.equal(hit(byName("material-Au")), 69);
  assert.equal(hit(byName("material-TiO2")), 74);
  assert.equal(hit(byName("photocatalytic process")), 72);
  // 缺材料块的记录必须仍被隔离为 background
  const background = records.filter((r) => classifyRecordTier(r, conceptBlocks) === "background").length;
  assert.ok(background > 0, "终筛必须仍然能隔离掉缺核心材料的记录");
});

test("反应支只区分 core / peripheral，不再让记录出局", () => {
  const tiers = { core: 0, peripheral: 0, background: 0 };
  for (const r of records) tiers[classifyRecordTier(r, conceptBlocks)]++;
  assert.equal(tiers.core + tiers.peripheral + tiers.background, 80);
  assert.ok(tiers.peripheral > 0, "没命中反应支的记录应降为 peripheral 而不是被丢弃");
  // 3.95 步比 3.5 步宽 8 条，这是设计如此、不是矛盾：终筛只把「缺核心材料」
  // 判为 background，缺 process 之类的非材料必需块只降为 peripheral 以保召回。
  // 修复前那种「一道门 2/80、另一道门 64/80」的方向性矛盾才是缺陷。
  assert.equal(tiers.core + tiers.peripheral, 64);
  const hardPass = records.filter((r) => passesHardConceptGate(r, conceptBlocks)).length;
  assert.ok(tiers.core + tiers.peripheral >= hardPass, "终筛不得比比例门更严，否则两道门又会互相矛盾");
});

/* ── query_v1 超长降级 ─────────────────────────────────────────────── */

test("这份概念矩阵的 v1 确实超出 OpenAlex 上限，正是当时 400 的原因", () => {
  const plan = cq.buildBooleanPlan(conceptBlocks);
  assert.ok(plan.v1.length > cq.SOURCE_QUERY_LIMITS.openalex,
    `v1 长度 ${plan.v1.length} 应当超过 ${cq.SOURCE_QUERY_LIMITS.openalex}`);
});

test("fitQueryToLimit 把它压进上限，并说明降级了什么", () => {
  const fitted = cq.fitQueryToLimit(conceptBlocks, cq.SOURCE_QUERY_LIMITS.openalex);
  assert.equal(fitted.ok, true);
  assert.ok(fitted.query.length <= cq.SOURCE_QUERY_LIMITS.openalex);
  assert.equal(fitted.degraded, true);
  assert.ok(fitted.dropped.length > 0, "必须说明丢了什么，否则用户无从判断结果为何变化");
});

test("没超限时原样返回，不做无谓降级", () => {
  const small = [{ block: "m", role: "material", mode: "required", alternative_group: "", terms: ["Au"] }];
  const fitted = cq.fitQueryToLimit(small, 1500);
  assert.equal(fitted.degraded, false);
  assert.deepEqual(fitted.dropped, []);
});

/* ── 与 bridge-ui.js 的实现保持一致 ─────────────────────────────────── */

test("bridge-ui 的两道门都走 hardBlocks，反应支不再进硬门槛", () => {
  assert.match(ui, /function hardBlocks\(blocks\)/);
  assert.match(ui, /function alternativeBlocks\(blocks\)/);
  // 硬门槛不能再调用 passesHardRequirements——那正是把 alternative 当硬要求的入口
  const gate = ui.slice(ui.indexOf("function passesHardConceptGate"), ui.indexOf("function classifyRecordTier"));
  assert.doesNotMatch(gate, /passesHardRequirements/,
    "硬门槛一旦调回 passesHardRequirements，反应支又会变成准入条件，98% 停机会复发");
  assert.match(gate, /hardBlocks\(normalized\)/);
});

test("bridge-ui 报告概念块命中率与缺摘要条数", () => {
  assert.match(ui, /function conceptBlockStats\(records, blocks\)/);
  assert.match(ui, /missingAbstracts:/);
  assert.match(ui, /概念块命中：/);
});

test("停止文案不再硬编码别的课题的例子", () => {
  assert.doesNotMatch(ui, /BiVO4 hydrothermal urea morphology facet crystal growth/,
    "这是另一个课题的残留建议，出现在任何课题的停止文案里都只会误导");
  assert.match(ui, /function relevanceDiagnosis\(relevance\)/);
});

test("query_v1 在发出前先压到 OpenAlex 上限内", () => {
  assert.match(ui, /SOURCE_QUERY_LIMITS\?\.openalex/);
  assert.match(ui, /fitQueryToLimit\?\.\(conceptBlocks, limit\)/);
  assert.match(ui, /超出 OpenAlex \$\{limit\} 上限/);
});
