"use strict";
/* rag-core.js — RAG 的纯函数核心（浏览器与 Node 双端）。
 *
 * MinerU 负责 PDF→Markdown；本模块负责结构感知切块、BM25、向量余弦检索
 * 与 reciprocal-rank fusion。Embedding 的远程调用留在 runner 内，避免把
 * 凭据或网络副作用带进浏览器端和纯函数测试。
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
function chunkMarkdown(text, { maxChars = 900, overlap = 100 } = {}) {
  const source = String(text || "");
  const lines = source.split(/\r?\n/);
  const sections = [];
  let heading = "";
  let buffer = [];
  let searchFrom = 0;
  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) {
      const located = source.indexOf(body, searchFrom);
      const startIndex = located >= 0 ? located : searchFrom;
      sections.push({ heading, body, start_index: startIndex });
      searchFrom = startIndex + body.length;
    }
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
      chunks.push({ heading: section.heading, text: body, start_index: section.start_index, end_index: section.start_index + body.length });
      continue;
    }
    let start = 0;
    while (start < body.length) {
      let end = Math.min(body.length, start + maxChars);
      if (end < body.length) {
        const floor = Math.min(end, start + Math.floor(maxChars * 0.65));
        const window = body.slice(floor, end);
        const breaks = ["\n\n", "\n", "。", "！", "？", ". ", "; ", "；"];
        let best = -1;
        let width = 0;
        for (const marker of breaks) {
          const index = window.lastIndexOf(marker);
          if (index > best) { best = index; width = marker.length; }
        }
        if (best >= 0) end = floor + best + width;
      }
      const chunkText = body.slice(start, end).trim();
      const leading = body.slice(start, end).indexOf(chunkText);
      const chunkStart = start + Math.max(0, leading);
      chunks.push({
        heading: section.heading,
        text: chunkText,
        start_index: section.start_index + chunkStart,
        end_index: section.start_index + chunkStart + chunkText.length,
      });
      if (end >= body.length) break;
      start = Math.max(start + 1, end - overlap);
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

function normalizeVector(value) {
  if (!Array.isArray(value) || !value.length || value.some((item) => !Number.isFinite(Number(item)))) return null;
  const vector = value.map(Number);
  const norm = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  if (!Number.isFinite(norm) || norm <= 0) return null;
  return vector.map((item) => item / norm);
}

function cosineSimilarity(left, right) {
  const a = normalizeVector(left), b = normalizeVector(right);
  if (!a || !b || a.length !== b.length) return null;
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

/* 向量候选必须与查询维度一致；model 可选，用于拒绝混用不同向量空间。 */
function vectorRank(chunks, queryEmbedding, k = 5, { model = "" } = {}) {
  const query = normalizeVector(queryEmbedding);
  if (!query) return [];
  return chunks.map((chunk, index) => {
    if (model && chunk.embedding_meta?.model !== model) return null;
    const score = cosineSimilarity(query, chunk.embedding);
    return score === null ? null : { index, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, k);
}

/* BM25 与向量分数尺度不同，用 RRF 按名次融合，避免任一分数域压倒另一方。 */
function hybridRank(chunks, query, queryEmbedding, k = 5, options = {}) {
  const limit = Math.max(k, Math.min(chunks.length, Number(options.candidateLimit || Math.max(20, k * 4))));
  const bm25 = bm25Rank(chunks, query, limit);
  const vector = vectorRank(chunks, queryEmbedding, limit, { model: options.model || "" });
  const bm25Weight = Number.isFinite(Number(options.bm25Weight)) ? Number(options.bm25Weight) : 0.35;
  const vectorWeight = Number.isFinite(Number(options.vectorWeight)) ? Number(options.vectorWeight) : 0.65;
  const rrfK = Math.max(1, Number(options.rrfK || 60));
  const combined = new Map();
  const add = (list, kind, weight) => list.forEach((item, rank) => {
    const row = combined.get(item.index) || { index: item.index, score: 0, bm25_score: null, vector_score: null };
    row.score += weight / (rrfK + rank + 1);
    row[`${kind}_score`] = item.score;
    combined.set(item.index, row);
  });
  add(bm25, "bm25", bm25Weight);
  add(vector, "vector", vectorWeight);
  return [...combined.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

/* 防止 top-k 全被同一篇长文占满；不改变候选分数，只做来源多样性约束。 */
function diversifyBySource(ranked, chunks, k, maxPerSource = 3) {
  const counts = new Map();
  const selected = [];
  const deferred = [];
  for (const item of ranked) {
    const source = String(chunks[item.index]?.source_path || "");
    const count = counts.get(source) || 0;
    if (count < maxPerSource) {
      selected.push(item);
      counts.set(source, count + 1);
    } else deferred.push(item);
    if (selected.length >= k) return selected;
  }
  for (const item of deferred) {
    selected.push(item);
    if (selected.length >= k) break;
  }
  return selected;
}

const ragCoreApi = { tokenize, chunkMarkdown, bm25Rank, normalizeVector, cosineSimilarity, vectorRank, hybridRank, diversifyBySource };
if (typeof module !== "undefined" && module.exports) module.exports = ragCoreApi;
if (typeof window !== "undefined") window.weaverRagCore = ragCoreApi;
