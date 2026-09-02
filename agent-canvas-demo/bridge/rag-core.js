"use strict";
/* rag-core.js — RAG 的纯函数核心：切块 + BM25 检索（浏览器与 Node 双端）。
 *
 * 设计取舍（2026-08-17）：MinerU 负责 PDF→Markdown 的结构化解析，本模块
 * 负责切块与检索。检索用 BM25（词项匹配，CJK 走二元切分），不引入向量
 * embedding——零依赖、零额外 API、可单测；索引条目的 schema 预留了
 * embedding 字段位，以后要升级语义检索时无需重建索引格式。
 */

/* 拉丁按词、CJK 按二元组切分，混合文本两边都覆盖。 */
function tokenize(text) {
  const s = String(text || "").toLowerCase();
  const tokens = [];
  const latin = s.match(/[a-z0-9][a-z0-9._-]*/g);
  if (latin) tokens.push(...latin);
  const cjk = s.match(/[一-鿿]+/g) || [];
  for (const run of cjk) {
    if (run.length === 1) { tokens.push(run); continue; }
    for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2));
  }
  return tokens;
}

/* 按 Markdown 标题切段，段内按长度再切，段间留重叠，保留所在标题作上下文。 */
function chunkMarkdown(text, { maxChars = 1200, overlap = 150 } = {}) {
  const lines = String(text || "").split(/\r?\n/);
  const sections = [];
  let heading = "";
  let buffer = [];
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) sections.push({ heading, body });
    buffer = [];
  };
  for (const line of lines) {
    const m = /^(#{1,4})\s+(.*)$/.exec(line);
    if (m) { flush(); heading = m[2].trim().slice(0, 120); continue; }
    buffer.push(line);
  }
  flush();

  const chunks = [];
  for (const section of sections) {
    const body = section.body;
    if (body.length <= maxChars) {
      chunks.push({ heading: section.heading, text: body });
      continue;
    }
    let start = 0;
    while (start < body.length) {
      chunks.push({ heading: section.heading, text: body.slice(start, start + maxChars) });
      start += maxChars - overlap;
    }
  }
  return chunks.filter((c) => c.text.trim().length >= 30);
}

/* BM25 (k1=1.5, b=0.75)。chunks: [{text, ...}] → ranked [{index, score}]。 */
function bm25Rank(chunks, query, k = 5) {
  const docs = chunks.map((c) => tokenize(`${c.heading || ""} ${c.text}`));
  const qTokens = [...new Set(tokenize(query))];
  if (!docs.length || !qTokens.length) return [];
  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / docs.length || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const k1 = 1.5, b = 0.75;
  const scores = docs.map((doc, index) => {
    const tf = new Map();
    for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const t of qTokens) {
      const n = df.get(t) || 0;
      if (!n) continue;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const f = tf.get(t) || 0;
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgdl));
    }
    return { index, score };
  });
  return scores
    .filter((s) => s.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k);
}

const ragCoreApi = { tokenize, chunkMarkdown, bm25Rank };
if (typeof module !== "undefined" && module.exports) module.exports = ragCoreApi;
if (typeof window !== "undefined") window.weaverRagCore = ragCoreApi;
