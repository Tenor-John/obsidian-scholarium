"use strict";
/**
 * Skill 输入不得被静默截断。
 *
 * 真实故障：Zotero 全库批处理（1842 篇）点「所选 → 织研者 RAG + HTML 图谱」，
 * 报 `Unterminated string in JSON at position 200000 (line 1 column 200001)`。
 *
 * 位置 200000 是个整数，这就是线索——它不是数据边界，是截断上限。链条是：
 *   1. 插件 POST /v1/rag/ingest，body 里 paths 与 graph.source_paths 各放了
 *      同一份 1842 条路径清单（载荷凭空翻倍，约 330 KB）；
 *   2. Bridge 转发给 executableSkill 时 slice(0, 200000)；
 *   3. 截断后的半截 JSON 写进临时文件；
 *   4. rag.js JSON.parse 该文件 → 在字符串中间断开 → 上面那条错误。
 *
 * 那个截断本是为 Windows 命令行长度上限（~32K）加的，但加错了位置：真正做这
 * 件事的是 materializeArg——超过 MAX_INLINE_ARG_LENGTH（4000）就自动落盘，
 * forceFileInput 的 runner 更是无条件走文件。所以它从不保护命令行，只负责
 * 损坏大载荷。
 *
 * 核心不变式：**截断 JSON 得到的是非法 JSON，不是更短的 JSON。**
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const server = fs.readFileSync(path.join(root, "bridge", "server.js"), "utf8");
const ragjs = fs.readFileSync(path.join(root, "skills", "rag-ingest", "scripts", "rag.js"), "utf8");

/* 断言要针对**代码**，不是注释。
 * 本文件第一版就栽在这里：解释这次修复的注释里原样写了
 * "String(skillInput).slice(0, 200000)" 和 "delete graphInput.paths"，
 * 于是"确认旧写法已消失"的断言反而被自己的注释命中。 */
const stripComments = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/^[ \t]*\/\/.*$/gm, " ");
const serverCode = stripComments(server);
const ragCode = stripComments(ragjs);

/* ── 复现：为什么截断一定产生非法 JSON ─────────────────────────────── */

test("1842 条路径的批处理载荷确实超过旧的 200000 上限", () => {
  const paths = Array.from({ length: 1842 }, (_, i) =>
    `literature/downloaded-pdfs/2024-some-fairly-long-author-and-title-slug-${String(i).padStart(4, "0")}.pdf`);
  const payload = JSON.stringify({
    mode: "ingest-and-graph", paths, embedding: "auto",
    graph: { limit: 50, source_paths: paths }, apply: true,
  });
  assert.ok(payload.length > 200000,
    `批处理载荷应超过旧上限，实际 ${payload.length} 字符`);
  // 而且断点落在字符串中间——连"少了几条记录"都算不上，整份输入作废
  assert.throws(() => JSON.parse(payload.slice(0, 200000)), /Unterminated string in JSON/);
});

test("截断永远不可能产出合法 JSON（除非恰好切在结尾）", () => {
  const payload = JSON.stringify({ paths: Array.from({ length: 500 }, (_, i) => `p/${i}.pdf`) });
  for (const cut of [100, 1000, payload.length - 1]) {
    assert.throws(() => JSON.parse(payload.slice(0, cut)), SyntaxError,
      `切在 ${cut} 处仍被当成合法 JSON，说明这条测试的前提错了`);
  }
});

/* ── 修复：不再截断 ─────────────────────────────────────────────────── */

test("executableSkill 不再对 skill 输入做 slice", () => {
  assert.doesNotMatch(serverCode, /skillInput[^\n]*\.slice\(0,\s*200000\)/,
    "静默截断回来了——大批处理会重新变成 Unterminated JSON");
  assert.match(serverCode, /const input = String\(skillInput \|\| ''\);/);
});

test("改为超限明确报错，并说清该怎么办", () => {
  assert.match(server, /MAX_SKILL_INPUT_LENGTH/);
  assert.match(server, /split the batch into smaller groups/);
  assert.match(server, /truncating would hand the tool invalid JSON/);
});

test("上限远高于真实批处理载荷，正常用法不会被拦", () => {
  const declared = /const MAX_SKILL_INPUT_LENGTH = ([^;]+);/.exec(server);
  assert.ok(declared, "找不到 MAX_SKILL_INPUT_LENGTH 声明");
  const limit = Function(`"use strict";return (${declared[1]})`)();
  assert.ok(limit >= 16 * 1024 * 1024, `上限 ${limit} 太低，会拦住正常的全库批处理`);
});

test("命令行长度保护仍在 materializeArg 手里，没有被这次改动削弱", () => {
  assert.match(server, /const MAX_INLINE_ARG_LENGTH = 4000;/);
  assert.match(server, /if \(!forceFile && text\.length <= MAX_INLINE_ARG_LENGTH\) return \{ value: text, tempFile: null \};/);
  // rag-ingest 无条件走临时文件，命令行根本不经手这份载荷
  assert.match(server, /'rag-ingest': \{ script: 'rag\.js'[^}]*forceFileInput: true/);
});

/* ── 去掉重复序列化，但不能弄丢证据边界 ───────────────────────────── */

test("source_paths 与 paths 相同时省略，载荷减半", () => {
  assert.match(server, /delete graphInput\.source_paths;/);
  assert.match(server, /graphInput\.source_paths\.every\(\(value, index\) => String\(value\) === paths\[index\]\)/);
});

test("rag.js 在 source_paths 缺失时回退到 paths——图谱范围不能悄悄扩大", () => {
  // 这是本次改动最危险的一处：graph() 会 delete graphInput.paths，
  // 少了回退就会退化成扫描整个 RAG 语料，把往期课题的文献混进本批次图谱。
  assert.match(ragCode, /if \(!Array\.isArray\(graphInput\.source_paths\) && Array\.isArray\(input\.paths\) && input\.paths\.length\)/);
  const graphFn = ragCode.slice(ragCode.indexOf("async function graph(root, input = {})"), ragCode.indexOf("async function run(root, input"));
  const fallbackAt = graphFn.indexOf("graphInput.source_paths = input.paths.map(String)");
  const deleteAt = graphFn.indexOf("delete graphInput.paths");
  assert.ok(fallbackAt > 0 && deleteAt > fallbackAt, "回退必须发生在 delete graphInput.paths 之前");
});

test("回退逻辑在真实输入形状上成立", () => {
  // 直接跑 rag.js 导出的 graph() 太重（要拉起 build_paper_graph），
  // 这里复刻它对 graphInput 的处理，验证两种调用形状都能拿到范围。
  const derive = (input) => {
    const graphInput = { ...(input.graph || input), source: "rag" };
    if (!Array.isArray(graphInput.source_paths) && Array.isArray(input.paths) && input.paths.length) {
      graphInput.source_paths = input.paths.map(String);
    }
    delete graphInput.mode; delete graphInput.paths; delete graphInput.embedding; delete graphInput.apply;
    return graphInput;
  };
  const paths = ["a.pdf", "b.pdf"];
  // 省略了 source_paths（新形状）
  assert.deepEqual(derive({ mode: "ingest-and-graph", paths, graph: { limit: 50 } }).source_paths, paths);
  // 显式给了 source_paths（旧形状 / 有意收窄）：以显式值为准
  assert.deepEqual(derive({ mode: "ingest-and-graph", paths, graph: { limit: 50, source_paths: ["a.pdf"] } }).source_paths, ["a.pdf"]);
});
