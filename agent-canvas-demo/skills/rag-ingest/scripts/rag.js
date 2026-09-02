"use strict";
/* rag.js — RAG 入库与检索 runner（mode: ingest | query）。
 *
 * ingest: .md 直接读；.pdf 走 MinerU 云解析（批量上传 → 轮询 → 下载 zip →
 * 取 full.md），解析出的 Markdown 存 Scholarium/runtime/rag-corpus/，切块后
 * 写入 Scholarium/runtime/rag-index/chunks.jsonl（按 source_hash 去重，
 * 重复入库同一文件会替换旧块而不是追加副本）。
 *
 * query: 对 chunks.jsonl 做 BM25 检索，返回 top-k 片段与来源路径。
 *
 * 约定（与其他 runner 一致）：argv[0]=root，argv[1]=input JSON 或其文件路径，
 * 结果 manifest 打到 stdout。MinerU key 从环境变量 MINERU_API_KEY 读取
 * （Bridge 从 bridge.config.json 的 mineruApiKey 注入，本文件不落盘 key）。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { chunkMarkdown, bm25Rank } = require("../../../bridge/rag-core.js");

const MINERU_API = "https://mineru.net/api/v4";
const POLL_INTERVAL_MS = 5000;
const POLL_MAX = 100; // ≈8 分钟

const posix = (p) => p.split(path.sep).join("/");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function corpusDir(root) { return path.join(root, "Scholarium", "runtime", "rag-corpus"); }
function indexFile(root) { return path.join(root, "Scholarium", "runtime", "rag-index", "chunks.jsonl"); }

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
  fs.writeFileSync(file, chunks.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf8");
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

function indexMarkdown(root, absPath, markdown, sourceHash, titleHint) {
  const rel = posix(path.relative(root, absPath));
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
    text: c.text,
    embedding: null, // 预留：未来升级向量检索时填充，索引格式不变
  }));
  const existing = loadIndex(root).filter((c) => c.source_hash !== sourceHash && c.source_path !== rel);
  saveIndex(root, [...existing, ...chunks]);
  return { source: rel, chunks: chunks.length, corpus: posix(path.relative(root, corpusPath)) };
}

async function ingest(root, paths) {
  const ingested = [];
  const errors = [];
  for (const inputPath of paths) {
    try {
      const abs = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
      const rootAbs = path.resolve(root);
      if (!abs.startsWith(rootAbs + path.sep) && abs !== rootAbs) throw new Error("路径在工作区之外，已拒绝");
      if (!fs.existsSync(abs)) throw new Error("文件不存在");
      const ext = path.extname(abs).toLowerCase();
      if (ext === ".md") {
        const text = fs.readFileSync(abs, "utf8");
        ingested.push(indexMarkdown(root, abs, text, sha256(Buffer.from(text, "utf8"))));
      } else if (ext === ".pdf") {
        if (!process.env.MINERU_API_KEY) throw new Error("缺少 MINERU_API_KEY（bridge.config.json 的 mineruApiKey）");
        const sourceHash = sha256(fs.readFileSync(abs));
        const already = loadIndex(root).some((c) => c.source_hash === sourceHash);
        if (already) { ingested.push({ source: posix(path.relative(root, abs)), chunks: 0, skipped: "已入库（内容哈希一致）" }); continue; }
        const zipUrl = await mineruParsePdf(abs);
        const markdown = await extractMarkdownFromZip(zipUrl, sourceHash.slice(0, 8));
        ingested.push(indexMarkdown(root, abs, markdown, sourceHash));
      } else {
        throw new Error(`不支持的格式 ${ext}（只收 .pdf / .md）`);
      }
    } catch (error) {
      errors.push({ path: inputPath, error: error.message });
    }
  }
  return { ingested, errors, index_size: loadIndex(root).length };
}

/* ------------------------------------------------------------- query ---- */

function query(root, queryText, k = 5) {
  const chunks = loadIndex(root);
  const ranked = bm25Rank(chunks, queryText, Math.max(1, Math.min(20, k)));
  return {
    query: queryText,
    index_size: chunks.length,
    results: ranked.map((r) => {
      const c = chunks[r.index];
      return {
        source: c.source_path, title: c.title, heading: c.heading,
        score: Number(r.score.toFixed(3)),
        snippet: c.text.replace(/\s+/g, " ").slice(0, 300),
      };
    }),
  };
}

/* -------------------------------------------------------------- main ---- */

(async () => {
  const args = process.argv.slice(2);
  const root = path.resolve(args[0] || "");
  if (!root || !fs.existsSync(root)) { console.error("workspace root missing"); process.exit(1); }
  const raw = args[1] || "";
  let input = {};
  if (raw) input = fs.existsSync(raw) ? JSON.parse(fs.readFileSync(raw, "utf8")) : JSON.parse(raw);
  const mode = input.mode || "ingest";

  let manifest;
  if (mode === "ingest") {
    const paths = Array.isArray(input.paths) ? input.paths.map(String) : [];
    if (!paths.length) { console.error("ingest 需要 input.paths（.pdf/.md 路径数组）"); process.exit(1); }
    manifest = { skill: "rag-ingest", mode, ...(await ingest(root, paths)) };
  } else if (mode === "query") {
    if (!String(input.query || "").trim()) { console.error("query 模式需要 input.query"); process.exit(1); }
    manifest = { skill: "rag-ingest", mode, ...query(root, String(input.query), input.k) };
  } else {
    console.error(`未知 mode: ${mode}`); process.exit(1);
  }
  process.stdout.write(JSON.stringify(manifest));
})().catch((error) => { console.error(error.message); process.exit(1); });
