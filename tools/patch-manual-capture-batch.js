"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MAIN = path.join(ROOT, "main.js");
const METHODS_BEGIN = "/* SCHOLARIUM_MANUAL_CAPTURE_BATCH_METHODS_BEGIN */";
const METHODS_END = "/* SCHOLARIUM_MANUAL_CAPTURE_BATCH_METHODS_END */";

function count(text, needle) { return text.split(needle).length - 1; }
function replaceOnce(text, needle, value, label) {
  if (count(text, needle) !== 1) throw new Error(`${label} 锚点不是恰好一处，拒绝修改`);
  return text.replace(needle, value);
}
function region(text, begin, end, anchor, body, label, before = false) {
  const start = text.indexOf(begin), finish = text.indexOf(end);
  if ((start >= 0) !== (finish >= 0)) throw new Error(`${label} 标记不完整`);
  if (start >= 0) {
    let tail = finish + end.length;
    if (text[tail] === "\n") tail++;
    text = text.slice(0, start) + text.slice(tail);
  }
  const block = `${begin}\n${body.trimEnd()}\n${end}\n`;
  return replaceOnce(text, anchor, before ? block + anchor : anchor + block, label);
}

function patch() {
  let text = fs.readFileSync(MAIN, "utf8");
  const methods = fs.readFileSync(path.join(ROOT, "tools", "manual-capture-batch-methods.jsfrag"), "utf8");
  text = region(text, METHODS_BEGIN, METHODS_END, "    setManualDownloadQueue(t, e = !0) {\n", methods, "批量抓取方法", true);

  const replacements = [
    [
      "      let n = this.buildWriterSettings();\n      if (!n.apiKey) {\n",
      "      let n = this.buildWriterSettings();\n      if (!opts.skipSummary && !n.apiKey) {\n",
      "跳过总结时不要求 AI Key",
    ],
    [
      "        let o = this.findExistingClip(e);\n",
      "        let o = opts.forceNewCapture ? null : this.findExistingClip(e);\n",
      "批量抓取强制写入本轮工作区",
    ],
    [
      "    async saveClipBundle(t, e, x, M) {\n      let i = this.clipRoot();\n",
      "    async saveClipBundle(t, e, x, M) {\n      let i = M && M.__targetFolder ? String(M.__targetFolder) : this.clipRoot();\n",
      "WebClip 目标目录",
    ],
    [
      "        let Mt = this.extractCitationMeta(c, h),\n          p = await this.saveClipBundle(\n",
      "        let Mt = this.extractCitationMeta(c, h);\n        if (e.manualQueueId && e.targetWorkspace) {\n          const clipTools = schEvidenceTools(this.plugin), vaultBase = clipTools.path.resolve(clipTools.vault), requested = clipTools.path.resolve(e.targetWorkspace), rel = clipTools.path.relative(vaultBase, requested);\n          if (!rel.startsWith(\"..\") && !clipTools.path.isAbsolute(rel)) Mt.__targetFolder = (rel ? rel.replace(/\\\\/g, \"/\") + \"/\" : \"\") + \"literature/webclips\";\n        }\n        let p = await this.saveClipBundle(\n",
      "WebClip 写入 Pipeline 工作区",
    ],
  ];
  replacements.push(
    [
      "        let pdfPageUrl =\n          (typeof t.getURL == \"function\" && t.getURL()) || e.link || \"\";\n        let isPdfPage = /\\.pdf([?#].*)?$/i.test(pdfPageUrl);\n",
      "        const explicitPdf = Array.isArray(opts.pdfCandidates) ? opts.pdfCandidates.filter((u) => /^https?:\\/\\/\\S+$/i.test(String(u || \"\"))) : [];\n        let pdfPageUrl =\n          explicitPdf[0] || (typeof t.getURL == \"function\" && t.getURL()) || e.link || \"\";\n        let isPdfPage = explicitPdf.length > 0 || /\\.pdf([?#].*)?$/i.test(pdfPageUrl);\n",
      "显式 PDF 候选地址",
    ],
    [
      "          let pdfCandidateUrls = [pdfPageUrl];\n",
      "          let pdfCandidateUrls = explicitPdf.length ? [...explicitPdf] : [pdfPageUrl];\n",
      "PDF 候选列表",
    ],
  );
  for (const [needle, value, label] of replacements) {
    if (text.includes(value)) continue;
    text = replaceOnce(text, needle, value, label);
  }

  const oldPdfNotify = `          if (e.manualQueueId) {\n            const dashboard = window.__scholariumDashboardView;\n            const queueItem = (Array.isArray(dashboard?.__manualDownloadQueue)\n              ? dashboard.__manualDownloadQueue : []).find((item) => item.id === e.manualQueueId);\n            this.completeManualDownload(e.manualQueueId);\n            // Return to the Weaver panel and hand the verified local PDF back\n            // to the exact Pipeline that created this manual-download item.\n            // The iframe then checkpoints the artifact and resumes from the\n            // reader step; search/export/download are not repeated.\n            try {\n              dashboard?.switchTab?.(\"deduction\");\n              setTimeout(() => {\n                dashboard?.__weaverFrame?.contentWindow?.postMessage({\n                  type: \"scholarium:manual-download-completed\",\n                  item: {\n                    id: e.manualQueueId,\n                    doi: e.doi || queueItem?.doi || \"\",\n                    title: e.title || queueItem?.title || \"\",\n                    pipelineRunId: queueItem?.pipelineRunId || \"\",\n                    path: safeWorkspace\n                      ? pdfTools.path.relative(safeWorkspace, pdfTools.path.join(vaultBase, savedPdf.path)).replace(/\\\\/g, \"/\")\n                      : savedPdf.path || \"\",\n                  },\n                }, \"*\");\n              }, 500);\n            } catch (error) {\n              console.error(\"[Scholarium] manual download completion callback failed\", error);\n            }\n          }\n`;
  const newPdfNotify = "          if (e.manualQueueId) await this.notifyManualCaptureResult(e, \"pdf\", savedPdf.path || \"\");\n";
  if (!text.includes(newPdfNotify)) text = replaceOnce(text, oldPdfNotify, newPdfNotify, "PDF 原生完成通知");

  const webclipAnchor = "        if (\n          (new Ne.Notice(\n            \"已保存正文笔记：\" + p.file.basename,\n          ),\n";
  const webclipBlock = "        if (opts.skipSummary) {\n          if (e.manualQueueId) await this.notifyManualCaptureResult(e, \"webclip\", p.file.path);\n          new Ne.Notice(\"已保存网页全文：\" + p.file.basename);\n          return { status: \"completed\", clip: p.file };\n        }\n";
  if (!text.includes(webclipBlock)) text = replaceOnce(text, webclipAnchor, webclipBlock + webclipAnchor, "WebClip 原生完成通知");

  const uiAnchor = "      s.createEl(\"b\", { text: `Pipeline 待处理 · ${this.manualDownloadQueue.length} 篇` });\n";
  const uiBlock = `      let batchButton = s.createEl("button", { cls: "rss-btn rss-btn-primary", text: this.__manualCaptureBatchRunning ? "批量抓取中…" : "批量抓取（半自动）" });\n      batchButton.setCssStyles({ marginLeft: "10px" });\n      this.__manualCaptureBatchRunning && batchButton.setAttribute("disabled", "true");\n      batchButton.onclick = () => this.startManualCaptureBatch();\n      const mineruConf = this.mineruConfig();\n      let mineruButton = s.createEl("button", { cls: "rss-btn", text: mineruConf.token && mineruConf.mode !== "off" ? (mineruConf.mode === "all" ? "在线识别：全部 PDF" : "在线识别：扫描版 PDF") : "在线识别（MinerU）：未开启" });\n      mineruButton.setCssStyles({ marginLeft: "6px" });\n      mineruButton.onclick = () => this.openMineruSettings();\n      const lastBatch = this.manualCaptureLastReport || this.data.manualCaptureLastReport;\n      if (lastBatch) s.createEl("small", { text: \`　上次：PDF \${lastBatch.pdf || 0} / 网页全文 \${lastBatch.webclip || 0} / 跳过 \${lastBatch.skipped || 0} / 失败 \${lastBatch.failed || 0}\${lastBatch.remaining ? " / 未处理 " + lastBatch.remaining : ""} / 共 \${lastBatch.total || 0}\` }).setCssStyles({ color: "var(--text-muted)" });\n`;
  if (!text.includes("批量抓取（半自动）")) text = replaceOnce(text, uiAnchor, uiAnchor + uiBlock, "批量抓取按钮");
  else {
    // 已打过旧版补丁：只把“上次”统计行升级为带未处理/总数的版本。
    const summaryLine = uiBlock.split("\n").find((line) => line.startsWith("      if (lastBatch) "));
    text = text.replace(/^      if \(lastBatch\) s\.createEl\(.*$/m, () => summaryLine);
    // “上次”统计行升级为结果面板（成功列表 + 按原因分组的修复办法）。
    text = text.replace(/^      if \(lastBatch\) s\.createEl\(.*$/m, () => "      if (lastBatch) this.renderManualCaptureReport(e, lastBatch);");
    // 逐篇显示最近一次抓取的结果与处理办法。
    const attemptAnchor = '          p.createEl("small", { text: [h.doi, h.reason].filter(Boolean).join(" · ") }).setCssStyles({ color: "var(--text-muted)" });\n';
    const attemptLine = '          if (h.lastAttempt) { const la = p.createEl("div", { text: (h.lastAttempt.status === "failed" ? "上次批量：失败 — " : "上次批量：跳过 — ") + h.lastAttempt.reason }); la.setCssStyles({ color: h.lastAttempt.status === "failed" ? "var(--text-error)" : "var(--color-orange)", fontSize: "12px" }); p.createEl("div", { text: "处理办法：" + this.manualCaptureFixHint(h.lastAttempt.reason) }).setCssStyles({ color: "var(--text-muted)", fontSize: "12px" }); }\n';
    if (!text.includes(attemptLine)) text = replaceOnce(text, attemptAnchor, attemptAnchor + attemptLine, "逐篇抓取结果");
    if (!text.includes("this.openMineruSettings()")) {
      const mineruLines = uiBlock.split("\n").filter((line) => /mineru/i.test(line)).join("\n") + "\n";
      text = replaceOnce(text, "      batchButton.onclick = () => this.startManualCaptureBatch();\n", "      batchButton.onclick = () => this.startManualCaptureBatch();\n" + mineruLines, "在线识别按钮");
    }
  }

  fs.writeFileSync(MAIN, text, "utf8");
  return { bytes: Buffer.byteLength(text), methods: count(text, METHODS_BEGIN), hasBatch: text.includes("批量抓取（半自动）") };
}

if (require.main === module) process.stdout.write(JSON.stringify(patch(), null, 2) + "\n");
module.exports = { patch, METHODS_BEGIN, METHODS_END };
