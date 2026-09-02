"use strict";
/**
 * Build reproducible, PDF-backed text anchors for a deliberately small pilot.
 *
 * A PDF is the immutable source.  The generated JSON sidecar is a rebuildable
 * index, not a Schema-v1 object and not evidence.  By default this command is
 * read-only: it prints a plan.  `--write` is required to write indexes under
 * the vault's hidden `.scholarium/pdf-sidecars/` directory.
 *
 * Production extraction uses a local Poppler-compatible `pdftotext` command.
 * Publisher PDFs commonly need font/CMap decoding, so the small built-in stream
 * helpers below are retained only for deterministic unit tests: they are never
 * a production fallback.  If `pdftotext` is unavailable or extraction fails,
 * the PDF is reported as a refusal rather than silently indexed with corrupt
 * text.  A second extraction of identical source bytes must produce the same
 * block ids and hashes before any sidecar is written.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const childProcess = require("child_process");
const S = require("./schema-objects");
const P = require("./pdf-inventory");
const PDFTOTEXT_ARGS = ["-enc", "UTF-8", "-nopgbrk", "{source_path}", "-"];

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const rel = (root, value) => path.relative(root, value).split(path.sep).join("/");
const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
const textHash = (value) => sha256(normalize(value)).slice(0, 32);

function decodePdfLiteral(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    let ch = raw[i];
    if (ch !== "\\") { bytes.push(raw.charCodeAt(i) & 255); continue; }
    ch = raw[++i] || "";
    if (/[0-7]/.test(ch)) {
      let octal = ch;
      for (let n = 0; n < 2 && /[0-7]/.test(raw[i + 1] || ""); n++) octal += raw[++i];
      bytes.push(parseInt(octal, 8));
    } else if (ch === "n") bytes.push(10);
    else if (ch === "r") bytes.push(13);
    else if (ch === "t") bytes.push(9);
    else if (ch === "b") bytes.push(8);
    else if (ch === "f") bytes.push(12);
    else if (ch === "\r") { if (raw[i + 1] === "\n") i++; }
    else bytes.push(ch.charCodeAt(0) & 255);
  }
  const buffer = Buffer.from(bytes);
  // BOM-marked PDF strings are UTF-16BE.  Most publisher content streams use
  // single-byte encodings, where latin1 preserves the printable characters.
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    let out = "";
    for (let i = 2; i + 1 < buffer.length; i += 2) out += String.fromCharCode(buffer.readUInt16BE(i));
    return out;
  }
  return buffer.toString("latin1");
}

function literalStrings(stream) {
  const out = [];
  for (let i = 0; i < stream.length; i++) {
    if (stream[i] !== "(") continue;
    let depth = 1, escaped = false, raw = "";
    for (i++; i < stream.length; i++) {
      const ch = stream[i];
      if (escaped) { raw += "\\" + ch; escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === "(") { depth++; raw += ch; continue; }
      if (ch === ")" && --depth === 0) break;
      raw += ch;
    }
    if (depth === 0) {
      const value = normalize(decodePdfLiteral(raw));
      // Ignore PDF dictionary crumbs and glyph-map identifiers.  A genuine
      // readable fragment is longer than a single glyph but no English phrase
      // has to be arbitrarily long to count.
      if (value.length >= 3 && /[A-Za-z0-9]/.test(value)) out.push(value);
    }
  }
  return out;
}

function literalAt(stream, start) {
  if (stream[start] !== "(") return null;
  let depth = 1, escaped = false, raw = "";
  for (let i = start + 1; i < stream.length; i++) {
    const ch = stream[i];
    if (escaped) { raw += "\\" + ch; escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === "(") { depth++; raw += ch; continue; }
    if (ch === ")" && --depth === 0)
      return { text: normalize(decodePdfLiteral(raw)), end: i + 1 };
    raw += ch;
  }
  return null;
}

/**
 * PDF content streams contain font maps, metadata and graphic resources as
 * strings too.  Only text-show operations inside BT…ET are article text.
 * Reading every parenthesised string was fast to sketch and catastrophically
 * wrong in reality: a font's glyph fragments became `oth ermal Synth`.
 */
function textShowOperations(stream) {
  const out = [];
  for (const textBlock of stream.matchAll(/\bBT\b([\s\S]*?)\bET\b/g)) {
    const body = textBlock[1];
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "(") {
        const literal = literalAt(body, i);
        if (!literal) continue;
        const after = body.slice(literal.end).replace(/^\s+/, "");
        if (/^(?:Tj|['"])(?=\s|$)/.test(after) && literal.text.length) out.push(literal.text);
        i = literal.end - 1;
        continue;
      }
      if (body[i] !== "[") continue;
      let end = i + 1, depth = 1, escaped = false;
      for (; end < body.length && depth; end++) {
        if (escaped) { escaped = false; continue; }
        if (body[end] === "\\") { escaped = true; continue; }
        if (body[end] === "[") depth++;
        if (body[end] === "]") depth--;
      }
      if (depth || !/^\s*TJ(?=\s|$)/.test(body.slice(end))) continue;
      // In a TJ array the individual strings are pieces of one painted run;
      // adding artificial spaces between them is the exact corruption this
      // parser exists to avoid.
      const run = literalStrings(body.slice(i + 1, end - 1)).join("");
      if (run.length) out.push(run);
      i = end - 1;
    }
  }
  return out;
}

function contentStreams(pdf) {
  const streams = [];
  const marker = Buffer.from("stream");
  const endMarker = Buffer.from("endstream");
  for (let at = pdf.indexOf(marker); at >= 0; at = pdf.indexOf(marker, at + marker.length)) {
    // The token must be followed by its required line ending, otherwise a
    // literal word "stream" in the PDF body would be misread as a stream.
    let start = at + marker.length;
    if (pdf[start] === 13 && pdf[start + 1] === 10) start += 2;
    else if (pdf[start] === 10 || pdf[start] === 13) start += 1;
    else continue;
    const end = pdf.indexOf(endMarker, start);
    if (end < 0) continue;
    const header = pdf.slice(Math.max(0, at - 2048), at).toString("latin1");
    // Images, embedded fonts and ICC profiles dominate the compressed bytes in
    // publisher PDFs but cannot carry a literal text-show operation.  Trying
    // to inflate them made an otherwise read-only pilot take minutes and gave
    // a malformed PDF an unbounded decompression opportunity.
    if (/\/(?:Subtype\s*\/Image|FontFile|ICCProfile)/.test(header)) continue;
    const raw = pdf.slice(start, end);
    let decoded;
    try {
      decoded = /\/FlateDecode/.test(header)
        ? zlib.inflateSync(raw, { maxOutputLength: 4 * 1024 * 1024 })
        : raw;
    } catch (_) { continue; }
    streams.push(decoded.toString("latin1"));
  }
  return streams;
}

function extractPdfText(pdf) {
  const parts = contentStreams(pdf).flatMap(textShowOperations);
  return normalize(parts.join(" "));
}

function blocksFromText(text, size = 900) {
  const source = normalize(text);
  const blocks = [];
  let rest = source, ordinal = 1;
  while (rest.length >= 120) {
    let cut = Math.min(size, rest.length);
    if (cut < rest.length) {
      const min = Math.floor(size * 0.65);
      const tail = rest.slice(min, cut + 1);
      const boundary = Math.max(tail.lastIndexOf(". "), tail.lastIndexOf("; "), tail.lastIndexOf(" "));
      if (boundary >= 0) cut = min + boundary + 1;
    }
    const text = normalize(rest.slice(0, cut));
    if (text.length >= 120) blocks.push({
      id: "p" + String(ordinal++).padStart(4, "0"),
      text,
      text_hash: textHash(text),
      // `text_hash` is retained as a readable implementation name.  The
      // locator contract calls this same value `quote_hash`.
      quote_hash: textHash(text),
      char_count: text.length,
    });
    rest = rest.slice(cut).trim();
  }
  return blocks;
}

function findPdftotext(explicit) {
  const executable = explicit || process.env.SCHOLARIUM_PDFTOTEXT || "pdftotext";
  const probe = childProcess.spawnSync(executable, ["-v"], { encoding: "utf8", windowsHide: true });
  if (probe.error || probe.status !== 0)
    throw new Error("未找到可用的 pdftotext。PDF 锚点拒绝使用不可靠的零依赖字符串提取；请安装 Poppler 或设置 SCHOLARIUM_PDFTOTEXT。");
  return executable;
}

function popplerProvenance(executable) {
  const probe = childProcess.spawnSync(executable, ["-v"], { encoding: "utf8", windowsHide: true });
  if (probe.error || probe.status !== 0) throw new Error("pdftotext_version_probe_failed");
  return {
    command: executable,
    argv: PDFTOTEXT_ARGS,
    version: normalize(String(probe.stdout || "") + "\n" + String(probe.stderr || "")),
  };
}

function extractWithPoppler(absolute, executable) {
  const result = childProcess.spawnSync(executable, PDFTOTEXT_ARGS.map((arg) => arg === "{source_path}" ? absolute : arg), {
    encoding: "utf8", windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error("pdftotext_failed" + (result.stderr ? ": " + normalize(result.stderr).slice(0, 240) : ""));
  const text = normalize(result.stdout);
  if (text.length < 500) throw new Error("too_little_extractable_text");
  return text;
}

function loadQueryPack(vault, queryPackPath) {
  if (!queryPackPath) throw new Error("必须提供 --query-pack <Research/QueryPacks/...md>");
  const absolute = path.resolve(vault, ...String(queryPackPath).split("/"));
  const { object } = S.parseObject(fs.readFileSync(absolute, "utf8"));
  if (object.artifact !== "evidence_query_expansion") throw new Error("不是可审计的查询词包：" + queryPackPath);
  if (!Array.isArray(object.concept_groups) || object.concept_groups.length < 2)
    throw new Error("查询词包缺少至少两组必要概念");
  return { path: rel(vault, absolute), object };
}

function loadInventory(vault, inventoryPath) {
  if (!inventoryPath) return P.inventory(vault);
  const absolute = path.resolve(inventoryPath);
  const report = JSON.parse(fs.readFileSync(absolute, "utf8"));
  if (report.kind !== "scholarium-pdf-inventory" || !Array.isArray(report.files))
    throw new Error("不是 PDF inventory 报告：" + inventoryPath);
  if (!report.conservation || report.conservation.every_file_classified !== true)
    throw new Error("PDF inventory 未通过守恒校验：" + inventoryPath);
  if (path.resolve(report.vault_root || "") !== path.resolve(vault))
    throw new Error("PDF inventory 属于另一个 Vault：" + inventoryPath);
  return report;
}

function containsPhrase(text, phrase) {
  const source = normalize(text).toLowerCase();
  const needle = normalize(phrase).toLowerCase();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(?:^|[^a-z0-9])" + escaped + "(?=$|[^a-z0-9])", "i").test(source);
}

function matchingGroups(text, groups) {
  return groups.flatMap((group) => {
    const matched = (group.terms || []).filter((term) => containsPhrase(text, term));
    return matched.length ? [{ label: group.label, matched }] : [];
  });
}

function sidecarPath(vault, sourceSha256) {
  return path.join(vault, ".scholarium", "pdf-sidecars", sourceSha256 + ".json");
}

function doiUrl(doi) {
  const clean = normalize(doi).replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
  return clean ? "https://doi.org/" + clean : "";
}

function planPilot(vault, queryPackPath, options = {}) {
  const pack = loadQueryPack(vault, queryPackPath);
  const inventory = loadInventory(vault, options.inventoryPath);
  const extractor = options.extract ? "test-extractor" : findPdftotext(options.pdftotext);
  const extraction = options.extract
    ? { command: extractor, argv: [], version: "test-only" }
    : popplerProvenance(extractor);
  const seen = new Set();
  const accepted = [], rejected = [];
  const max = Math.max(1, Math.min(Number(options.max) || 30, 30));
  const minGroups = Math.max(2, Number(options.minGroups) || 3);
  for (const file of inventory.files) {
    if (seen.has(file.sha256)) { rejected.push({ path: file.path, reason: "duplicate_content" }); continue; }
    seen.add(file.sha256);
    if (file.classification === "pdf_scanned_or_encrypted") { rejected.push({ path: file.path, reason: "no_readable_text_layer" }); continue; }
    let text;
    try {
      const absolute = path.join(vault, ...file.path.split("/"));
      text = options.extract ? options.extract(absolute) : extractWithPoppler(absolute, extractor);
    }
    catch (error) { rejected.push({ path: file.path, reason: "extract_error:" + error.message }); continue; }
    if (!text || text.length < 500) { rejected.push({ path: file.path, reason: "too_little_extractable_text" }); continue; }
    const groups = matchingGroups(text, pack.object.concept_groups);
    if (groups.length < minGroups) { rejected.push({ path: file.path, reason: "concept_groups_below_threshold", matched_concept_groups: groups }); continue; }
    const blocks = blocksFromText(text);
    if (!blocks.length) { rejected.push({ path: file.path, reason: "no_stable_blocks" }); continue; }
    accepted.push({
      source_path: file.path,
      source_sha256: file.sha256,
      bytes: file.bytes,
      doi: file.doi,
      original_url: doiUrl(file.doi),
      evidence_locator_status: file.doi ? "ready" : "missing_original_url",
      matched_concept_groups: groups,
      text_char_count: text.length,
      extracted_text_sha256: sha256(text),
      anchor_count: blocks.length,
      proposed_sidecar_path: rel(vault, sidecarPath(vault, file.sha256)),
      _blocks: blocks,
    });
  }
  accepted.sort((a, b) => b.matched_concept_groups.length - a.matched_concept_groups.length || a.source_path.localeCompare(b.source_path));
  const selected = accepted.slice(0, max);
  const output = selected.map(({ _blocks, ...item }) => item);
  return {
    kind: "scholarium-pdf-anchor-pilot-plan",
    schema_version: 1,
    generator: "tools/pdf-anchor-sidecar.js",
    generated_at: new Date().toISOString(),
    vault_root: path.resolve(vault),
    query_pack_path: pack.path,
    query_pack_sha256: sha256(fs.readFileSync(path.resolve(vault, ...pack.path.split("/")))),
    min_concept_groups: minGroups,
    max_pdfs: max,
    extractor,
    extraction,
    scanned: inventory.files.length,
    unique_content_scanned: seen.size,
    selected: output,
    rejected,
    conservation: {
      every_unique_pdf_has_terminal_state: selected.length + rejected.filter((r) => r.reason !== "duplicate_content").length === seen.size,
      selected_within_cap: selected.length <= max,
      creates_no_schema_objects: true,
      overwrites_no_existing_files: true,
    },
    _selected: selected,
  };
}

function writeSidecars(vault, plan, options = {}) {
  if (!plan || !plan.conservation || !plan.conservation.every_unique_pdf_has_terminal_state)
    throw new Error("拒绝写入：PDF 试点计划未通过守恒校验");
  const written = [];
  for (const item of plan._selected || []) {
    const source = path.join(vault, ...item.source_path.split("/"));
    const bytes = fs.readFileSync(source);
    if (sha256(bytes) !== item.source_sha256) throw new Error("PDF 源字节已变化：" + item.source_path);
    const text = options.extract
      ? options.extract(source)
      : extractWithPoppler(source, options.pdftotext || plan.extractor);
    if (sha256(text) !== item.extracted_text_sha256)
      throw new Error("PDF 文本提取结果与已审核计划不一致：" + item.source_path);
    const blocks = blocksFromText(text);
    const sidecar = {
      kind: "scholarium-pdf-anchor-sidecar",
      schema_version: 2,
      source_path: item.source_path,
      source_sha256: item.source_sha256,
      source_bytes: bytes.length,
      extractor: plan.extractor,
      extraction: plan.extraction,
      extracted_at: new Date().toISOString(),
      query_pack_path: plan.query_pack_path,
      matched_concept_groups: item.matched_concept_groups,
      doi: item.doi || "",
      original_url: item.original_url || "",
      evidence_locator_status: item.evidence_locator_status,
      text_char_count: text.length,
      extracted_text_sha256: item.extracted_text_sha256,
      anchor_count: blocks.length,
      anchors: blocks,
    };
    const target = sidecarPath(vault, item.source_sha256);
    if (fs.existsSync(target)) {
      if (!options.replaceExisting) throw new Error("拒绝覆盖已有 sidecar：" + rel(vault, target));
      const existing = JSON.parse(fs.readFileSync(target, "utf8"));
      if (existing.kind !== "scholarium-pdf-anchor-sidecar" || existing.source_sha256 !== item.source_sha256)
        throw new Error("拒绝替换来源不一致的 sidecar：" + rel(vault, target));
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = target + ".tmp-" + process.pid + "-" + Date.now();
    fs.writeFileSync(temporary, JSON.stringify(sidecar, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, target);
    written.push(rel(vault, target));
  }
  return { written, count: written.length };
}

function main() {
  const args = process.argv.slice(2);
  const take = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : ""; };
  const vault = path.resolve(take("--vault") || path.join(__dirname, "..", "..", "..", ".."));
  const queryPack = take("--query-pack");
  const plan = planPilot(vault, queryPack, {
    max: take("--max"), minGroups: take("--min-groups"), inventoryPath: take("--inventory"), pdftotext: take("--pdftotext"),
  });
  const safe = { ...plan }; delete safe._selected;
  if (args.includes("--write")) safe.write = writeSidecars(vault, plan, {
    pdftotext: take("--pdftotext"), replaceExisting: args.includes("--replace-existing"),
  });
  process.stdout.write(JSON.stringify(safe, null, 2) + "\n");
}
if (require.main === module) main();

module.exports = {
  sha256, normalize, textHash, decodePdfLiteral, contentStreams, literalAt, textShowOperations, extractPdfText, blocksFromText,
  findPdftotext, popplerProvenance, extractWithPoppler, doiUrl,
  loadQueryPack, loadInventory, matchingGroups, planPilot, writeSidecars, sidecarPath,
};
