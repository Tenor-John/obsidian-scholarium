"use strict";
/**
 * 静默批处理必须真的静默。
 *
 * 实测发现（2026-09-06）：Pipeline 第 5 步以 allow_browser:false 调用机构通道，
 * 屏幕上仍然弹出了一个可见的 Chromium，停在 pubs.acs.org/... —— 而且是**出版商
 * 原始 URL**，不是 wvpn.ustc.edu.cn 的改写地址。
 *
 * 原因：scansci_download.js 的补丁只重绑了 instsci._try_instsci_browser 这一个
 * 入口。ACS / Wiley / RSC / Nature / Springer 各自还有独立的浏览器源，注册在
 * sources/publishers.py 的 PUBLISHER_TOOL_MAP（"ACS": ["ACSBrowser", ...]），
 * 实现在 publisher_strategies.py。它们完全在 instsci 之外，allow_browser 够不着。
 *
 * 佐证来自 ~/.scansci-pdf/source_scores.json：那次运行期间
 * ACSBrowser(12:57)、WileyBrowser(12:56)、RSCBrowser(13:03) 都有 attempts。
 * 而且 RSCBrowser 的 latency_ema ≈ 279 秒、NatureBrowser/WileyBrowser ≈ 91 秒，
 * 这也解释了进度为什么长时间停在 0/35。
 *
 * 强制 headless 行不通：publisher_strategies.py 里 launch(headless=False) 是硬
 * 编码的，连 config 的 browser_headless 都不读。所以静默批次里只能把这些源整个
 * 摘掉，剩下的交给 Scholarium 自己的浏览器兜底（tier 2，真 headless、复用
 * WebVPN 持久会话）。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "skills", "scansci-institutional", "scripts", "scansci_download.js"), "utf8");
const ui = fs.readFileSync(path.join(__dirname, "..", "bridge-ui.js"), "utf8");

test("Pipeline 的机构通道调用仍然明确要求静默", () => {
  const call = ui.slice(ui.indexOf("const instInput = JSON.stringify({"), ui.indexOf("const instRun ="));
  assert.match(call, /allow_browser: false/);
  assert.match(call, /publisher_login: false/);
  assert.match(call, /scansci_browser_fallback: false/);
});

test("instsci 那条路径仍然被重绑为 HTTP 优先", () => {
  assert.match(src, /_inst\._try_instsci_browser = _http_first/);
  assert.match(src, /if not _allow_browser:\s*\n\s*return None/);
});

test("出版商专属浏览器源在静默批次里被整个摘掉", () => {
  // 这是本次修复的核心：只补 instsci 挡不住 ACSBrowser 这一族。
  assert.match(src, /PUBLISHER_TOOL_MAP/,
    "没有触及 PUBLISHER_TOOL_MAP，ACSBrowser 之类仍会弹窗");
  assert.match(src, /str\(t\)\.endswith\("Browser"\)/,
    "应按 *Browser 后缀剔除，而不是硬编码几个出版商——新增出版商时不会漏");
  assert.match(src, /publisher_browser_sources_removed=/,
    "剔除结果必须写进 patch_notes，否则下次又只能靠肉眼发现弹窗");
});

test("剔除只在 allow_browser 为假时发生，交互式调用不受影响", () => {
  const block = src.slice(src.indexOf("# Patch 3"), src.indexOf("patch_notes.append(\n        \"tier_order="));
  assert.match(block, /if not _allow_browser and hasattr\(_sources_module, "publishers"\)/,
    "必须以 allow_browser 为条件——研究员手动发起的交互式下载仍应允许开窗");
});

test("补丁失败要留痕，不能静默吞掉", () => {
  assert.match(src, /publisher_browser_patch_failed/,
    "包结构变了导致补丁失效时必须能在 manifest 里看出来，而不是又变成一次神秘弹窗");
});

test("patch_notes 会随结果一起返回，供 UI 与审计查看", () => {
  assert.match(src, /patch_notes/);
  // 三条补丁各自都要报告，缺一条就无法判断静默契约是否真的生效
  assert.match(src, /tier_order=http_first/);
  assert.match(src, /publisher_phase2=delegated_to_scholarium_fallback/);
});

/* 这条锁的是「为什么不能简单地强制 headless」这个判断本身。
 * 如果哪天 scansci-pdf 改成读 config 的 browser_headless，剔除源就不再是唯一
 * 选项，届时应当重新评估——注释里写明了依据，测试盯着注释在。 */
test("代码里记录了不能强制 headless 的原因", () => {
  assert.match(src, /hardcodes\s*\n\s*#\s*launch\(headless=False\)|hardcodes[\s\S]{0,80}headless=False/,
    "必须说明为何选择摘源而不是设 headless，否则后人会以为这是过度处理");
});
