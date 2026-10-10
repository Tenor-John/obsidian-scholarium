"use strict";
/* rag.js — RAG 入库与检索 runner。
 *
 * ingest: .md 直接读；.pdf 走 MinerU 云解析（批量上传 → 轮询 → 下载 zip →
 * 取 full.md），解析出的 Markdown 存 Scholarium/runtime/rag-corpus/，切块后
 * 调用 Hugging Face Inference Providers 生成归一化向量，最后写入本地 JSONL
 * 索引（按 source_hash 去重，重复入库会替换旧块而不是追加副本）。
 *
 * query: 默认用向量 + BM25 的 RRF 混合检索；云端不可用时明确降级 BM25。
 * reindex: 为旧索引或更换模型后的块重新生成向量。status: 只读诊断。
 *
 * MINERU_API_KEY / HF_TOKEN 只从 Bridge 环境注入，绝不落盘。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { chunkMarkdown, bm25Rank, vectorRank, hybridRank, normalizeVector, diversifyBySource } = require("../../../bridge/rag-core.js");

let InferenceClientCtor = null;
function createInferenceClient(token) {
  // BM25/status/read-root operations are fully local and must remain usable
  // when the optional cloud client has not been installed in a fresh worktree.
  // Require it only when an embedding call is actually requested, and fail
  // with the missing dependency as the real cause instead of breaking import.
  if (!InferenceClientCtor) {
    try { ({ InferenceClient: InferenceClientCtor } = require("@huggingface/inference")); }
    catch (error) { throw new Error(`Hugging Face client unavailable: ${error.message}`); }
  }
  return new InferenceClientCtor(token, { retry_on_error: true });
}

const MINERU_API = "https://mineru.net/api/v4";
const POLL_INTERVAL_MS = 5000;
const POLL_MAX = 100; // ≈8 分钟
const DEFAULT_EMBEDDING_MODEL = "ibm-granite/granite-embedding-311m-multilingual-r2";
const DEFAULT_EMBEDDING_PROVIDER = "hf-inference";
const DEFAULT_BATCH_SIZE = 16;

const posix = (p) => p.split(path.sep).join("/");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function corpusDir(root) { return path.join(root, "Scholarium", "runtime", "rag-corpus"); }
function indexFile(root) { return path.join(root, "Scholarium", "runtime", "rag-index", "chunks.jsonl"); }
function indexMetaFile(root) { return path.join(root, "Scholarium", "runtime", "rag-index", "index-meta.json"); }

function loadIndex(root) {
  const file = indexFile(root);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}
function saveIndex(root, chunks) {
  const file = indexFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, chunks.map((c) => JSON.stringify(c)).join("\n") + (chunks.length ? "\n" : ""), "utf8");
  fs.renameSync(temporary, file);
}

function embeddingConfig(overrides = {}) {
  const size = Number(overrides.batch_size || process.env.SCHOLARIUM_RAG_BATCH_SIZE || DEFAULT_BATCH_SIZE);
  return {
    token: String(process.env.HF_TOKEN || ""),
    model: String(overrides.model || process.env.SCHOLARIUM_RAG_MODEL || DEFAULT_EMBEDDING_MODEL),
    provider: String(overrides.provider || process.env.SCHOLARIUM_RAG_PROVIDER || DEFAULT_EMBEDDING_PROVIDER),
    endpointUrl: String(overrides.endpoint_url || process.env.SCHOLARIUM_RAG_ENDPOINT || ""),
    batchSize: Math.max(1, Math.min(64, Number.isFinite(size) ? Math.floor(size) : DEFAULT_BATCH_SIZE)),
  };
}

function safeCloudError(error) {
  const message = String(error?.message || error || "unknown Hugging Face error");
  return message.replace(/hf_[A-Za-z0-9]+/g, "hf_••••").slice(0, 500);
}

function embeddingRequest(config, texts, client) {
  const args = {
    model: config.model,
    provider: config.provider,
    inputs: texts,
    normalize: true,
    truncate: true,
    truncation_direction: "right",
  };
  if (config.endpointUrl) args.endpointUrl = config.endpointUrl;
  return client.featureExtraction(args);
}

function coerceEmbeddingBatch(output, expected) {
  let rows = output;
  if (expected === 1 && Array.isArray(output) && output.every((item) => Number.isFinite(Number(item)))) rows = [output];
  if (!Array.isArray(rows) || rows.length !== expected) throw new Error(`Hugging Face 返回 ${Array.isArray(rows) ? rows.length : "非数组"} 个向量，预期 ${expected}`);
  const vectors = rows.map((row) => normalizeVector(row));
  if (vectors.some((row) => !row)) throw new Error("Hugging Face 模型没有返回每段一个可用的稠密向量；请改用 feature-extraction/embedding 模型");
  const dimensions = new Set(vectors.map((row) => row.length));
  if (dimensions.size !== 1) throw new Error("Hugging Face 返回的向量维度不一致");
  return vectors;
}

async function embedTexts(texts, config, dependencies = {}) {
  if (!config.token) throw new Error("缺少 HF_TOKEN；请在设置中心添加 Hugging Face Token");
  const client = dependencies.client || createInferenceClient(config.token);
  const retries = dependencies.retries === undefined ? 2 : Math.max(0, Number(dependencies.retries));
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try { return coerceEmbeddingBatch(await embeddingRequest(config, texts, client), texts.length); }
    catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(400 * (2 ** attempt));
    }
  }
  throw new Error(`Hugging Face embedding 失败：${safeCloudError(lastError)}`);
}

function needsEmbedding(chunk, config) {
  const contentHash = sha256(Buffer.from(`${chunk.heading || ""}\n${chunk.text || ""}`, "utf8"));
  return !Array.isArray(chunk.embedding) || !chunk.embedding.length
    || chunk.embedding_meta?.model !== config.model
    || chunk.embedding_meta?.content_hash !== contentHash;
}

async function vectorizeChunks(chunks, config, dependencies = {}) {
  const indexes = chunks.map((chunk, index) => needsEmbedding(chunk, config) ? index : -1).filter((index) => index >= 0);
  let dimensions = null;
  const updates = [];
  for (let offset = 0; offset < indexes.length; offset += config.batchSize) {
    const batchIndexes = indexes.slice(offset, offset + config.batchSize);
    const vectors = await embedTexts(batchIndexes.map((index) => `${chunks[index].heading || ""}\n${chunks[index].text}`.trim()), config, dependencies);
    vectors.forEach((vector, position) => {
      const chunk = chunks[batchIndexes[position]];
      const contentHash = sha256(Buffer.from(`${chunk.heading || ""}\n${chunk.text || ""}`, "utf8"));
      updates.push({ index: batchIndexes[position], embedding: vector, embedding_meta: {
        provider: "huggingface",
        inference_provider: config.provider,
        model: config.model,
        dimensions: vector.length,
        normalized: true,
        content_hash: contentHash,
        created_at: new Date().toISOString(),
      } });
      dimensions = vector.length;
    });
    dependencies.onProgress?.({ embedded: Math.min(offset + batchIndexes.length, indexes.length), total: indexes.length });
  }
  // Transactional in memory: a failed later batch leaves every original chunk
  // untouched, so callers can safely choose fail-closed or explicit BM25 fallback.
  for (const update of updates) Object.assign(chunks[update.index], { embedding: update.embedding, embedding_meta: update.embedding_meta });
  return { requested: indexes.length, embedded: indexes.length, dimensions };
}

function indexStatus(root, config = embeddingConfig()) {
  const chunks = loadIndex(root);
  const models = {};
  let vectorized = 0;
  let compatible = 0;
  for (const chunk of chunks) {
    if (!Array.isArray(chunk.embedding) || !chunk.embedding.length) continue;
    vectorized++;
    const model = String(chunk.embedding_meta?.model || "unknown");
    models[model] = (models[model] || 0) + 1;
    if (model === config.model) compatible++;
  }
  return {
    index_path: posix(path.relative(root, indexFile(root))),
    chunks: chunks.length,
    vectorized,
    compatible_vectorized: compatible,
    stale_vectorized: vectorized - compatible,
    pending: chunks.length - compatible,
    coverage: chunks.length ? Number((compatible / chunks.length).toFixed(4)) : 0,
    models,
    configured_model: config.model,
    configured_provider: config.provider,
    hf_token_configured: Boolean(config.token),
  };
}

function saveIndexMeta(root, config) {
  const status = indexStatus(root, config);
  const file = indexMetaFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = { schema_version: 2, updated_at: new Date().toISOString(), ...status };
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, file);
  return payload;
}

/* ------------------------------------------------------------ MinerU ---- */

async function mineruJson(endpoint, options = {}) {
  const res = await fetch(`${MINERU_API}${endpoint}`, {
    ...options,
    headers: { Authorization: `Bearer ${process.env.MINERU_API_KEY || ""}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.code !== 0) throw new Error(`MinerU ${endpoint} → HTTP ${res.status}: ${payload.msg || res.statusText}`);
  return payload.data;
}

async function mineruParsePdf(absPath) {
  const name = path.basename(absPath);
  // data_id 只是批内关联 ID，MinerU 限 128 字符——长中文文件名会超限，用哈希代替
  const dataId = sha256(Buffer.from(name, "utf8")).slice(0, 32);
  // 1) 申请上传地址
  const batch = await mineruJson("/file-urls/batch", {
    method: "POST",
    body: JSON.stringify({
      enable_formula: false, enable_table: true, language: "ch",
      files: [{ name, is_ocr: true, data_id: dataId }],
    }),
  });
  const uploadUrl = batch.file_urls?.[0];
  if (!batch.batch_id || !uploadUrl) throw new Error("MinerU 未返回上传地址");
  // 2) 上传文件本体（OSS 签名 URL 不含 Content-Type，带上会 403）
  const put = await fetch(uploadUrl, { method: "PUT", body: fs.readFileSync(absPath) });
  if (!put.ok) throw new Error(`MinerU 上传失败 HTTP ${put.status}`);
  // 3) 轮询批量结果
  for (let i = 0; i < POLL_MAX; i++) {
    await sleep(POLL_INTERVAL_MS);
    const result = await mineruJson(`/extract-results/batch/${batch.batch_id}`);
    const item = (result.extract_result || [])[0];
    if (!item) continue;
    if (item.state === "done" && item.full_zip_url) return item.full_zip_url;
    if (item.state === "failed") throw new Error(`MinerU 解析失败: ${item.err_msg || "unknown"}`);
  }
  throw new Error("MinerU 解析超时（约 8 分钟）");
}

async function extractMarkdownFromZip(zipUrl, tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `rag-mineru-${tag}-`));
  try {
    const zipPath = path.join(dir, "result.zip");
    const res = await fetch(zipUrl);
    if (!res.ok) throw new Error(`下载解析结果失败 HTTP ${res.status}`);
    fs.writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
    // 必须用系统自带的 bsdtar（支持 zip）；PATH 里的 GNU tar（Git Bash）会把
    // "C:\..." 误当远程主机（Cannot connect to C: resolve）。
    const TAR = fs.existsSync("C:\\Windows\\System32\\tar.exe") ? "C:\\Windows\\System32\\tar.exe" : "tar";
    const out = path.join(dir, "out");
    fs.mkdirSync(out, { recursive: true });
    const run = spawnSync(TAR, ["-xf", zipPath, "-C", out], { encoding: "utf8", windowsHide: true, timeout: 60000 });
    if (run.status !== 0) throw new Error(`解压失败: ${String(run.stderr || run.stdout).slice(0, 200)}`);
    const mds = [];
    (function walk(d) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.md$/i.test(e.name)) mds.push(p);
      }
    })(out);
    if (!mds.length) throw new Error("解析结果里没有 Markdown");
    mds.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    return fs.readFileSync(mds[0], "utf8");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

/* ------------------------------------------------------------ ingest ---- */

/* --- 只读扩展根 -----------------------------------------------------------
 *
 * 语料源不一定在工作区里。Zotero 的 PDF 全部住在它自己的 storage 目录
 * （D:\Zotero\storage），把它们复制进 Obsidian 库只是为了绕过"路径必须在
 * root 内"这条检查——代价是 1316 篇论文重复占用 6.18 GB，而且每同步一次就要
 * 再复制一遍。
 *
 * 所以引入只读扩展根：源文件可以位于白名单目录内，但**一切写入仍然只落在
 * root 内**（语料 corpus、索引 index、图谱产物都由 corpusDir(root) /
 * indexFile(root) 决定，本次改动一个字都没碰）。也就是说这些目录对本工具
 * 永远是只读的。
 *
 * 白名单只能由 Bridge 从 bridge.config.json 注入，绝不接受请求体传入——
 * 否则浏览器侧一个 POST 就能把任意目录变成可读，这条检查也就白设了。
 */
function readRootsOf(root, options = {}) {
  const roots = [path.resolve(root)];
  for (const item of Array.isArray(options.read_roots) ? options.read_roots : []) {
    const text = String(item || "").trim();
    if (text) roots.push(path.resolve(text));
  }
  return roots;
}
function isInsideAny(absPath, roots) {
  return roots.some((base) => absPath === base || absPath.startsWith(base + path.sep));
}
/* root 之外的源用绝对 posix 路径作标识。
 * path.relative 在跨盘时（F: → D:）本来就会退回绝对路径，这里显式化，免得
 * source_path 时而相对、时而绝对，让图谱的 source_paths 比对失准。 */
function sourceIdFor(root, absPath) {
  const rootAbs = path.resolve(root);
  const inside = absPath === rootAbs || absPath.startsWith(rootAbs + path.sep);
  return inside ? posix(path.relative(rootAbs, absPath)) : posix(absPath);
}

function prepareMarkdown(root, absPath, markdown, sourceHash, titleHint) {
  const rel = sourceIdFor(root, absPath);
  const safeName = path.basename(absPath).replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|#^[\]]+/g, "-").slice(0, 60);
  const corpusPath = path.join(corpusDir(root), `${sourceHash.slice(0, 12)}-${safeName}.md`);
  fs.mkdirSync(corpusDir(root), { recursive: true });
  fs.writeFileSync(corpusPath, markdown, "utf8");

  const title = titleHint || (/^#\s+(.+)$/m.exec(markdown)?.[1] || safeName).slice(0, 120);
  const chunks = chunkMarkdown(markdown).map((c, i) => ({
    id: `${sourceHash.slice(0, 12)}-${i}`,
    source_path: rel,
    source_hash: sourceHash,
    title,
    heading: c.heading,
    chunk_index: i,
    start_index: c.start_index,
    end_index: c.end_index,
    text: c.text,
    content_hash: sha256(Buffer.from(`${c.heading || ""}\n${c.text}`, "utf8")),
    embedding: null,
    embedding_meta: null,
  }));
  return { chunks, result: { source: rel, source_hash: sourceHash, chunks: chunks.length, corpus: posix(path.relative(root, corpusPath)) } };
}

async function ingest(root, paths, options = {}, dependencies = {}) {
  const ingested = [];
  const errors = [];
  const warnings = [];
  const config = embeddingConfig(options);
  const embeddingMode = String(options.embedding || "auto").toLowerCase();
  if (!new Set(["auto", "required", "off"]).has(embeddingMode)) throw new Error("embedding 必须是 auto、required 或 off");
  // root 本身永远在列；额外的只读根来自 Bridge 注入的配置。
  const readRoots = readRootsOf(root, options);
  let chunks = loadIndex(root);
  for (const inputPath of paths) {
    try {
      const abs = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
      if (!isInsideAny(abs, readRoots)) {
        throw new Error(`路径既不在工作区内，也不在已配置的只读语料目录内，已拒绝：${abs}`);
      }
      if (!fs.existsSync(abs)) throw new Error("文件不存在");
      const ext = path.extname(abs).toLowerCase();
      let prepared;
      if (ext === ".md") {
        const text = fs.readFileSync(abs, "utf8");
        prepared = prepareMarkdown(root, abs, text, sha256(Buffer.from(text, "utf8")));
      } else if (ext === ".pdf") {
        if (!process.env.MINERU_API_KEY) throw new Error("缺少 MINERU_API_KEY（bridge.config.json 的 mineruApiKey）");
        const sourceHash = sha256(fs.readFileSync(abs));
        const already = chunks.some((c) => c.source_hash === sourceHash);
        if (already) {
          ingested.push({ source: sourceIdFor(root, abs), source_hash: sourceHash, chunks: 0, skipped: "已入库（内容哈希一致）；仍会补齐缺失向量" });
          continue;
        }
        const zipUrl = await mineruParsePdf(abs);
        prepared = prepareMarkdown(root, abs, await extractMarkdownFromZip(zipUrl, sourceHash.slice(0, 8)), sourceHash);
      } else {
        throw new Error(`不支持的格式 ${ext}（只收 .pdf / .md）`);
      }
      chunks = chunks.filter((chunk) => chunk.source_path !== prepared.result.source && chunk.source_hash !== prepared.result.source_hash);
      chunks.push(...prepared.chunks);
      ingested.push(prepared.result);
    } catch (error) {
      errors.push({ path: inputPath, error: error.message });
    }
  }

  let vectorization = { requested: 0, embedded: 0, dimensions: null, status: "off" };
  if (embeddingMode !== "off") {
    if (!config.token) {
      if (embeddingMode === "required") throw new Error("缺少 HF_TOKEN；required 模式拒绝写入未向量化索引");
      warnings.push("HF_TOKEN 未配置：本次已切块入库，但仅能使用 BM25；设置 Token 后运行 mode=reindex 补齐向量");
      vectorization.status = "degraded_bm25";
    } else {
      try {
        vectorization = { ...(await vectorizeChunks(chunks, config, dependencies)), status: "completed", model: config.model, provider: config.provider };
      } catch (error) {
        if (embeddingMode === "required") throw error;
        warnings.push(`${safeCloudError(error)}；已明确降级为 BM25，未将空向量标成成功`);
        vectorization = { requested: chunks.filter((chunk) => needsEmbedding(chunk, config)).length, embedded: 0, dimensions: null, status: "degraded_bm25", model: config.model, provider: config.provider };
      }
    }
  }
  saveIndex(root, chunks);
  const index = saveIndexMeta(root, config);
  return { ingested, errors, warnings, vectorization, index };
}

/* ------------------------------------------------------------- query ---- */

function resultRows(ranked, chunks) {
  return ranked.map((item, rank) => {
    const chunk = chunks[item.index];
    return {
      rank: rank + 1,
      chunk_id: chunk.id,
      source: chunk.source_path,
      source_hash: chunk.source_hash,
      title: chunk.title,
      heading: chunk.heading,
      locator: { chunk_index: chunk.chunk_index, start_index: chunk.start_index, end_index: chunk.end_index },
      score: Number(item.score.toFixed(6)),
      scores: {
        bm25: item.bm25_score === null || item.bm25_score === undefined ? null : Number(item.bm25_score.toFixed(6)),
        vector: item.vector_score === null || item.vector_score === undefined ? null : Number(item.vector_score.toFixed(6)),
      },
      snippet: chunk.text.replace(/\s+/g, " ").slice(0, 500),
    };
  });
}

async function query(root, queryText, options = {}, dependencies = {}) {
  const chunks = loadIndex(root);
  const config = embeddingConfig(options);
  const k = Math.max(1, Math.min(20, Number(options.k || 5)));
  const retrieval = String(options.retrieval || "hybrid").toLowerCase();
  const maxPerSource = Math.max(1, Math.min(k, Number(options.max_per_source || 3)));
  if (!new Set(["hybrid", "vector", "bm25"]).has(retrieval)) throw new Error("retrieval 必须是 hybrid、vector 或 bm25");
  const expanded = Math.min(chunks.length, Math.max(20, k * 6));
  const compatible = chunks.filter((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length && chunk.embedding_meta?.model === config.model).length;
  const warnings = [];
  let actual = retrieval;
  let degraded = false;
  let ranked;

  if (retrieval === "bm25") {
    ranked = bm25Rank(chunks, queryText, expanded).map((item) => ({ ...item, bm25_score: item.score, vector_score: null }));
  } else if (!compatible) {
    if (retrieval === "vector") throw new Error(`当前索引没有模型 ${config.model} 的向量；请先运行 mode=reindex`);
    actual = "bm25"; degraded = true;
    warnings.push(`当前索引没有模型 ${config.model} 的向量，混合检索已降级为 BM25`);
    ranked = bm25Rank(chunks, queryText, expanded).map((item) => ({ ...item, bm25_score: item.score, vector_score: null }));
  } else if (!config.token) {
    if (retrieval === "vector") throw new Error("缺少 HF_TOKEN，无法编码查询向量");
    actual = "bm25"; degraded = true;
    warnings.push("HF_TOKEN 未配置，混合检索已降级为 BM25");
    ranked = bm25Rank(chunks, queryText, expanded).map((item) => ({ ...item, bm25_score: item.score, vector_score: null }));
  } else {
    try {
      const [queryEmbedding] = await embedTexts([queryText], config, dependencies);
      ranked = retrieval === "vector"
        ? vectorRank(chunks, queryEmbedding, expanded, { model: config.model }).map((item) => ({ ...item, bm25_score: null, vector_score: item.score }))
        : hybridRank(chunks, queryText, queryEmbedding, expanded, { model: config.model, candidateLimit: expanded });
    } catch (error) {
      if (retrieval === "vector") throw error;
      actual = "bm25"; degraded = true;
      warnings.push(`${safeCloudError(error)}；混合检索已降级为 BM25`);
      ranked = bm25Rank(chunks, queryText, expanded).map((item) => ({ ...item, bm25_score: item.score, vector_score: null }));
    }
  }
  ranked = diversifyBySource(ranked, chunks, k, maxPerSource);
  return {
    query: queryText,
    index_size: chunks.length,
    vector_coverage: chunks.length ? Number((compatible / chunks.length).toFixed(4)) : 0,
    requested_retrieval: retrieval,
    retrieval: actual,
    degraded,
    model: config.model,
    provider: config.provider,
    warnings,
    results: resultRows(ranked, chunks),
  };
}

async function reindex(root, options = {}, dependencies = {}) {
  const config = embeddingConfig(options);
  if (!config.token) throw new Error("缺少 HF_TOKEN；无法重建向量索引");
  const chunks = loadIndex(root);
  if (!chunks.length) throw new Error("RAG 索引为空；请先执行 ingest");
  const vectorization = await vectorizeChunks(chunks, config, dependencies);
  saveIndex(root, chunks);
  return { vectorization: { ...vectorization, status: "completed", model: config.model, provider: config.provider }, index: saveIndexMeta(root, config) };
}

async function evaluate(root, options = {}, dependencies = {}) {
  const cases = Array.isArray(options.cases) ? options.cases.slice(0, 100) : [];
  if (!cases.length) throw new Error("evaluate 需要 cases: [{query, expected_sources, k?}]");
  const rows = [];
  for (const item of cases) {
    const queryText = String(item.query || "").trim();
    const expected = Array.isArray(item.expected_sources) ? item.expected_sources.map(String).filter(Boolean) : [];
    if (!queryText || !expected.length) throw new Error("每个 evaluate case 都需要 query 和非空 expected_sources");
    const result = await query(root, queryText, { ...options, k: item.k || options.k || 5 }, dependencies);
    const ranks = result.results.map((hit, index) => expected.includes(hit.source) ? index + 1 : 0).filter(Boolean);
    const firstRank = ranks.length ? Math.min(...ranks) : null;
    rows.push({ query: queryText, expected_sources: expected, hit: firstRank !== null, first_rank: firstRank, reciprocal_rank: firstRank ? Number((1 / firstRank).toFixed(6)) : 0, retrieval: result.retrieval, degraded: result.degraded, returned_sources: result.results.map((hit) => hit.source) });
  }
  return {
    cases: rows.length,
    recall_at_k: Number((rows.filter((row) => row.hit).length / rows.length).toFixed(6)),
    mean_reciprocal_rank: Number((rows.reduce((sum, row) => sum + row.reciprocal_rank, 0) / rows.length).toFixed(6)),
    degraded_cases: rows.filter((row) => row.degraded).length,
    results: rows,
  };
}

async function graph(root, input = {}) {
  const { buildPlan, applyPlan } = require("../../paper-knowledge-graph/scripts/build_paper_graph.js");
  const graphInput = { ...(input.graph || input), source: "rag" };
  /* 缺省把图谱范围限定在本次 ingest 的这批 PDF 上。
   *
   * 调用方过去总是把同一份路径清单同时放进 input.paths 和
   * graph.source_paths；Bridge 现在会在两者相同时省掉后者（1842 篇的批处理
   * 载荷因此减半）。但下面那行 delete graphInput.paths 会把范围信息一并抹掉，
   * 于是没有 source_paths 的调用会退化成"扫描整个 RAG 语料"——把往期课题的
   * 文献混进本批次图谱，正是证据边界要防的事。所以这里显式回退。 */
  if (!Array.isArray(graphInput.source_paths) && Array.isArray(input.paths) && input.paths.length) {
    graphInput.source_paths = input.paths.map(String);
  }
  /* 范围比对的是 chunk 的 source_path，而那是 sourceIdFor() 产出的：root 内
   * 用相对 posix、root 外（只读根，如 Zotero storage）用绝对 posix。调用方
   * 传来的可能是 Windows 反斜杠或相对写法，这里统一走同一个函数，否则
   * 只读根上的图谱会因为路径形态不一致而匹配到 0 张卡片。 */
  if (Array.isArray(graphInput.source_paths)) {
    graphInput.source_paths = graphInput.source_paths.map((value) => {
      const text = String(value || "");
      if (!text) return text;
      const abs = path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
      return sourceIdFor(root, abs);
    });
  }
  delete graphInput.mode; delete graphInput.paths; delete graphInput.embedding; delete graphInput.apply;
  const plan = buildPlan(root, graphInput);
  if (input.apply === true) plan.applied = applyPlan(plan);
  return plan;
}

async function run(root, input = {}, dependencies = {}) {
  const mode = String(input.mode || "ingest");
  if (mode === "ingest" || mode === "ingest-and-graph") {
    const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
    if (!paths.length) throw new Error("ingest 需要 input.paths（.pdf/.md 路径数组）");
    const ingestResult = await ingest(root, paths, input, dependencies);
    if (mode === "ingest-and-graph") return { skill: "rag-ingest", mode, ...ingestResult, graph: await graph(root, input) };
    return { skill: "rag-ingest", mode, ...ingestResult };
  }
  if (mode === "query") {
    if (!String(input.query || "").trim()) throw new Error("query 模式需要 input.query");
    return { skill: "rag-ingest", mode, ...(await query(root, String(input.query), input, dependencies)) };
  }
  if (mode === "reindex") return { skill: "rag-ingest", mode, ...(await reindex(root, input, dependencies)) };
  if (mode === "status") return { skill: "rag-ingest", mode, ...indexStatus(root, embeddingConfig(input)) };
  if (mode === "evaluate") return { skill: "rag-ingest", mode, ...(await evaluate(root, input, dependencies)) };
  if (mode === "graph") return { skill: "rag-ingest", mode, graph: await graph(root, input) };
  throw new Error(`未知 mode: ${mode}`);
}

/* -------------------------------------------------------------- main ---- */

async function main() {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] || "");
  if (!root || !fs.existsSync(root)) throw new Error("workspace root missing");
  const raw = args[1] || "";
  let input = {};
  if (raw) input = fs.existsSync(raw) ? JSON.parse(fs.readFileSync(raw, "utf8")) : JSON.parse(raw);
  process.stdout.write(JSON.stringify(await run(root, input)));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });

module.exports = {
  DEFAULT_EMBEDDING_MODEL, embeddingConfig, coerceEmbeddingBatch, embedTexts,
  vectorizeChunks, indexStatus, prepareMarkdown, ingest, query, reindex, evaluate, graph, run,
  readRootsOf, isInsideAny, sourceIdFor,
};
