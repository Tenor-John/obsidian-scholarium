"use strict";
/**
 * 人工确认后抓取：单篇边界、可跳过、证据降级。
 *
 * 补的是这样一个缺口：出版商反爬拦住自动下载时，研究员就坐在屏幕前、页面也
 * 开着，却没有任何入口能说"我已经过了，抓吧"。
 *
 * 这组测试守的主要不是功能，是**边界**。让自动化复用人工通过的反爬验证，单篇
 * 等同于研究员自己点"下载 PDF"；一旦挂上队列自动推进，就变成拿人工验证给批量
 * 爬虫开路——多数出版商的条款明确禁止批量下载。所以：
 *
 *   · 数组入参必须被拒，而不是"取第一条"；
 *   · 抓完即止，不得有任何自动推进下一篇的逻辑；
 *   · 跳过是一等公民，且必须能持久化，不能下一轮又回来问一遍；
 *   · PDF 拿不到时退存 Markdown，证据等级必须降一档。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dl = fs.readFileSync(path.join(root, "skills", "paper-downloader", "scripts", "browser_downloader.js"), "utf8");
const server = fs.readFileSync(path.join(root, "bridge", "server.js"), "utf8");
const ui = fs.readFileSync(path.join(root, "bridge-ui.js"), "utf8");
const main = fs.readFileSync(path.join(root, "..", "main.js"), "utf8");
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const dlCode = stripComments(dl);
const serverCode = stripComments(server);
function manualCaptureBranch() {
  const start = dlCode.indexOf("if (input.mode === 'manual_capture')");
  const end = start < 0 ? -1 : dlCode.indexOf("if (input.mode === 'login')", start + 1);
  return start < 0 ? '' : dlCode.slice(start, end < 0 ? dlCode.length : end);
}

/* ── 单篇边界 ───────────────────────────────────────────────────────── */

test("Skill 侧拒绝批量入参", () => {
  assert.match(dlCode, /Array\.isArray\(input\.urls\) \|\| Array\.isArray\(input\.records\) \|\| Array\.isArray\(input\.dois\)/);
  assert.match(dlCode, /manual_capture 只接受单篇/);
});

test("Bridge 侧也拒绝，且是拒绝而不是静默取第一条", () => {
  const block = serverCode.slice(
    serverCode.indexOf("'/v1/literature/manual-capture'"),
    serverCode.indexOf("'/v1/literature/manual-skip'"));
  assert.match(block, /for \(const key of \['urls', 'records', 'dois', 'paths'\]\)/);
  assert.match(block, /single-item only/);
  assert.match(block, /return send\(res, 400/);
  assert.doesNotMatch(block, /\[0\]/, "出现下标取值，说明可能在偷偷只取第一条而不是拒绝");
});

test("没有任何自动推进下一篇的逻辑", () => {
  const mode = manualCaptureBranch();
  assert.ok(mode.length > 500, "找不到 manual_capture 分支");
  assert.doesNotMatch(mode, /for \(const (rec|record|item) of/, "出现了遍历文献的循环——单篇契约被破坏");
  assert.match(mode, /single_item: true/);
  assert.match(mode, /auto_advance: false/);
});

test("manual_capture 不建批量进度条", () => {
  // 否则 UI 会显示一条永远 0/1 的假进度，还会覆盖上一轮真实批次的进度文件。
  assert.match(dlCode, /'dry_run', 'manual_capture'\]\.includes\(input\.mode\)/);
});

/* ── 人来决定 ───────────────────────────────────────────────────────── */

test("决定来自页面里的人工点击，不是程序猜测挑战是否通过", () => {
  const mode = manualCaptureBranch();
  assert.match(mode, /exposeBinding\('__scholariumManualDecision'/);
  assert.match(mode, /抓取本篇/);
  assert.match(mode, /跳过本篇/);
});

test("必须有头运行——无头时浮层永远等不到点击", () => {
  assert.match(dlCode, /const isHumanInLoop = isLoginMode \|\| input\.mode === 'manual_capture';/);
  assert.match(dlCode, /headless: isHumanInLoop \? false :/);
});

test("三种未抓取结局各自可区分", () => {
  assert.match(dlCode, /skipped_by_researcher/);
  assert.match(dlCode, /window_closed_before_decision/);
  assert.match(dlCode, /no_decision_within_wait/);
});

/* ── 抓取与证据等级 ─────────────────────────────────────────────────── */

test("PDF 走页面自身会话，并校验 %PDF 魔数", () => {
  const mode = manualCaptureBranch();
  assert.match(mode, /page\.request\.get\(/, "必须用页面自己的上下文，才能带上刚拿到的 clearance cookie");
  assert.match(mode, /isPdfBuffer\(buffer\)/, "不校验魔数会把反爬返回的 HTML 当成 PDF 存下来");
});

test("Markdown 回退证据等级降一档，且默认关闭", () => {
  const mode = manualCaptureBranch();
  assert.match(mode, /input\.allow_markdown_fallback === true/, "回退必须显式开启");
  assert.match(mode, /evidence_tier = 'html_fulltext'/);
  assert.match(mode, /evidence_tier = 'publisher_pdf'/);
  assert.match(mode, /证据等级低于 PDF/, "必须告诉研究员这份证据比 PDF 弱");
});

/* ── 跳过要记得住 ───────────────────────────────────────────────────── */

test("跳过决定落盘，并能读回", () => {
  assert.match(serverCode, /'\/v1\/literature\/manual-skip'/);
  assert.match(serverCode, /'\/v1\/literature\/manual-skips'/);
  assert.match(serverCode, /manual-download-skips\.json/);
  // 原子写：半截 JSON 会让下一次读取整个跳过清单失效
  assert.match(serverCode, /fs\.renameSync\(tmp, file\)/);
});

test("重复跳过同一篇不会写出重复条目", () => {
  assert.match(serverCode, /if \(!skips\.some\(\(item\) => item && item\.key === key\)\)/);
});

test("待手动下载队列会过滤掉已跳过的文献", () => {
  assert.match(ui, /async function loadManualSkips\(\)/);
  assert.match(ui, /async function publishManualDownloadQueue\(items, options = \{\}\)/);
  assert.match(ui, /const manualQueue = await publishManualDownloadQueue\(buildManualDownloadQueue\(combined, results5\)\)/,
    "队列必须用过滤后的结果，否则步骤描述报的条数是错的");
});

test.skip("对话加入 DOI 时采用追加去重，不会覆盖已有人工下载队列（宿主源码待 DEC-008 解闸）", () => {
  assert.match(ui, /publishManualDownloadQueue\(items, \{ open: request\.open !== false, append: true \}\)/);
  assert.match(main, /if \(data\.append === true\)/);
  assert.match(main, /const merged = new Map\(\)/);
});

test("跳过清单取不到时不过滤——宁可多问一次，也不悄悄吞掉文献", () => {
  const fn = ui.slice(ui.indexOf("async function loadManualSkips()"), ui.indexOf("async function publishManualDownloadQueue"));
  assert.match(fn, /catch \{ return new Set\(\); \}/,
    "读取失败应返回空集合（不过滤），而不是抛错或返回全量跳过");
});
