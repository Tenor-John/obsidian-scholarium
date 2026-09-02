"use strict";
/* pdf-url-variants.js — 从 Agent 报告的候选 URL 生成依次尝试的下载变体。
 *
 * 纯函数，单独成模块是为了可测（server.js 无法被 require——它引入即监听）。
 *
 * 目前只有一条规则，但它是真实故障驱动的：2026-08-19，Guo 2022（Colloid and
 * Interface Science Communications, gold OA, CC BY-NC-ND）的规范直链
 *   sciencedirect.com/science/article/pii/<PII>/pdf
 * 对非浏览器请求一律 403（Elsevier 反爬），而同文的 /pdfft 端点是
 * Elsevier 官方的重定向下载入口，配合浏览器 UA 可以通过。Agent 当时也在
 * 回复里建议了这个回退——与其指望每次都解析 Agent 的自然语言建议，不如
 * 把这条确定性规则固化在下载器里。 */
function pdfUrlVariants(url) {
  const original = String(url || '');
  const variants = [original];
  const pii = original.match(/^(https?:\/\/(?:[\w-]+\.)?sciencedirect\.com\/science\/article\/pii\/[\w-]+)\/pdf\b/i);
  if (pii) {
    variants.push(`${pii[1]}/pdfft?isDTMRedir=true&download=true`);
    variants.push(`${pii[1]}/pdfft`);
  }
  return [...new Set(variants)];
}
module.exports = { pdfUrlVariants };
