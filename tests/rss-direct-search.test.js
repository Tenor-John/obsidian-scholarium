"use strict";

// 文献订阅"直接打开文献页 + 文献检索"（2026-08-19 立项）的 bundle 测试。
// 逻辑写在 main.js 的 RssFeedBoard 类里、无法直接 require，所以这里用两种
// 姿势：关键纯函数（resolveDirectOpenTarget / fromCrossref / fromOpenAlex）
// 从 bundle 提取方法体后真实执行做行为断言；其余做接线守卫。
const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

const bundle = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

// Extract a class method's source by name and brace-match to its end. Only
// used for methods whose string/regex literals contain balanced braces.
function extractMethod(name) {
  const start = bundle.indexOf("    " + name + "(");
  assert.ok(start !== -1, name + " must exist in main.js");
  const open = bundle.indexOf("{", start);
  let depth = 0;
  for (let j = open; j < bundle.length; j++) {
    if (bundle[j] === "{") depth++;
    else if (bundle[j] === "}") { depth--; if (!depth) return bundle.slice(start, j + 1); }
  }
  throw new Error("unbalanced braces while extracting " + name);
}
function loadMethod(name) {
  // eslint-disable-next-line no-new-func
  return new Function("return function " + extractMethod(name))();
}

describe("RssFeedBoard direct-open & literature search (bundle)", () => {
  it("render() wires the literature-hub sub-tabs and routes each sub-panel", () => {
    // 文献中心二级导航始终渲染；检索/直开浏览器只在 search 子面板连线，
    // 下载队列只在 pipeline 子面板连线，订阅流面板保持纯粹。
    assert.match(bundle, /this\.renderHubTabs\(t\);/);
    assert.match(bundle, /this\.hubTab === "search"[\s\S]{0,200}this\.renderDirectOpenBar\(t\),\s*this\.renderSearchResults\(t\),\s*this\.renderDirectViewer\(t\);/);
    assert.match(bundle, /this\.hubTab === "pipeline"[\s\S]{0,200}this\.renderPipelineTab\(t\)/);
    assert.match(bundle, /this\.hubTab === "zotero"[\s\S]{0,200}this\.renderZoteroTab\(t\)/);
  });
  it("constructor initializes the direct/search state", () => {
    assert.match(bundle, /this\.directWeb = null;/);
    assert.match(bundle, /this\.searchResults = null;/);
    assert.match(bundle, /this\.searching = !1;/);
    assert.match(bundle, /this\.manualDownloadQueue = \[\];/);
  });
  it("receives a bounded manual-download queue and keeps its PDF target in downloaded-pdfs", () => {
    assert.match(bundle, /scholarium:set-manual-download-queue/);
    assert.match(bundle, /slice\(0, 100\)/);
    assert.match(bundle, /待手动下载/);
    assert.match(bundle, /literature\/downloaded-pdfs/);
    assert.match(bundle, /manualQueueId/);
    assert.match(bundle, /notifyManualCaptureResult\(e, "pdf", savedPdf\.path/);
    assert.match(bundle, /notifyManualCaptureResult\(e, "webclip", p\.file\.path/);
    assert.match(bundle, /this\.completeManualDownload\(article\.manualQueueId\)/);
    assert.match(bundle, /manualDownloadQueue:\s*\(r == null \? void 0 : r\.manualDownloadQueue\) \|\| \[\]/);
    assert.match(bundle, /this\.data\.manualDownloadQueue = this\.manualDownloadQueue/);
  });
  it("the inline-web close button also dismisses a directly opened page", () => {
    assert.match(bundle, /this\.directWeb && this\.directWeb\.link === s && \(this\.directWeb = null\)/);
  });
  it("clipSearchResult reuses the hidden-webview clip path and maps paywall errors to a retry hint", () => {
    assert.match(bundle, /clipSearchResult[\s\S]{0,2000}loadUrlInHiddenWebview/);
    assert.match(bundle, /clipSearchResult[\s\S]{0,4000}需先过验证/);
  });

  it("pipeline downloads never fall back to the default library when the workspace is unknown", () => {
    // 统一下载上下文：带 manualQueueId 的任务在 targetWorkspace 缺失/无效时
    // 必须报错阻止，而不是写进 vault 根目录的默认文献库。
    assert.match(bundle, /manualQueueId && !safeWorkspace/);
    assert.match(bundle, /目标课题不可确定/);
    assert.match(bundle, /Pipeline 待处理/);
  });
  it("persists the active hub tab and search download target", () => {
    assert.match(bundle, /this\.hubTab = i, this\.data\.hubTab = i, this\.save\(\)/);
    assert.match(bundle, /hubTab:\s*\(r == null \? void 0 : r\.hubTab\) \|\| "feed"/);
    assert.match(bundle, /this\.data\.downloadTarget = rt\.value, this\.save\(\)/);
  });

  it("resolveDirectOpenTarget resolves DOI forms to doi.org and passes URLs through", () => {
    const resolve = loadMethod("resolveDirectOpenTarget");
    assert.eq(resolve("10.1016/j.colcom.2022.100599"), "https://doi.org/10.1016/j.colcom.2022.100599");
    assert.eq(resolve("doi:10.1002/adfm.201801214"), "https://doi.org/10.1002/adfm.201801214");
    assert.eq(resolve("https://doi.org/10.48550/arXiv.1706.03762"), "https://doi.org/10.48550/arXiv.1706.03762");
    // Trailing punctuation copied from a sentence must not leak into the DOI.
    assert.eq(resolve("10.1000/xyz."), "https://doi.org/10.1000/xyz");
    assert.eq(resolve("https://www.sciencedirect.com/science/article/pii/S2215038222000322"), "https://www.sciencedirect.com/science/article/pii/S2215038222000322");
    // Keywords and junk must NOT be treated as pages to open.
    assert.eq(resolve("gold nanostars MOPS buffer"), null);
    assert.eq(resolve(""), null);
    assert.eq(resolve("javascript:alert(1)"), null);
  });

  it("fromCrossref maps a works item into the result card shape", () => {
    const fromCrossref = loadMethod("fromCrossref");
    const item = fromCrossref({
      DOI: "10.1016/j.colcom.2022.100599",
      title: ["The dual role of Au nanoparticles"],
      author: [{ family: "Guo", given: "X." }, { family: "Li", given: "Y." }],
      issued: { "date-parts": [[2022, 3]] },
      "container-title": ["Colloid and Interface Science Communications"],
      URL: "https://doi.org/10.1016/j.colcom.2022.100599",
    });
    assert.eq(item.source, "Crossref");
    assert.eq(item.doi, "10.1016/j.colcom.2022.100599");
    assert.eq(item.title, "The dual role of Au nanoparticles");
    assert.eq(item.authors, "Guo X., Li Y.");
    assert.eq(item.year, 2022);
    assert.eq(item.journal, "Colloid and Interface Science Communications");
    // Missing metadata must degrade to safe defaults, never throw.
    const bare = fromCrossref({ DOI: "10.1000/xyz" });
    assert.eq(bare.title, "10.1000/xyz");
    assert.eq(bare.url, "https://doi.org/10.1000/xyz");
  });

  it("fromOpenAlex maps a work into the result card shape including OA/pdf hints", () => {
    const fromOpenAlex = loadMethod("fromOpenAlex");
    const item = fromOpenAlex({
      doi: "https://doi.org/10.48550/arXiv.1706.03762",
      display_name: "Attention Is All You Need",
      authorships: [{ author: { display_name: "Ashish Vaswani" } }, { author: { display_name: "Noam Shazeer" } }],
      publication_year: 2017,
      primary_location: { source: { display_name: "NeurIPS" }, pdf_url: "" },
      best_oa_location: { pdf_url: "https://arxiv.org/pdf/1706.03762.pdf" },
      open_access: { is_oa: true },
    });
    assert.eq(item.source, "OpenAlex");
    assert.eq(item.doi, "10.48550/arXiv.1706.03762");
    assert.eq(item.authors, "Ashish Vaswani, Noam Shazeer");
    assert.eq(item.journal, "NeurIPS");
    assert.eq(item.pdfUrl, "https://arxiv.org/pdf/1706.03762.pdf");
    assert.eq(item.oa, true);
    assert.eq(item.url, "https://doi.org/10.48550/arXiv.1706.03762");
  });
});
