"use strict";
/**
 * Schema-v1 Experiment persistence and the small, deterministic record format
 * used for experiment-sourced Evidence.
 *
 * The Experiment object remains the source of truth.  Its Markdown body is a
 * readable projection with stable result blocks (r0001, r0002 …), not a new
 * Result object type.  Evidence locators bind to that body at the instant a
 * researcher takes a result as evidence, so later edits are detectable.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const S = require("./schema-objects");

const DIR = "Research/Experiments";
const normalize = (value) => String(value == null ? "" : value).replace(/\s+/g, " ").trim();
const sha256 = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const blockHash = (value) => sha256(normalize(value)).slice(0, 32);
const substantive = (value) => String(value || "").replace(/[|>+\-\s]/g, "").length > 0;
const slug = (value) => String(value || "实验").replace(/[\\/:*?\"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "实验";

function objectPath(vault, object) {
  if (object.type !== "experiment") throw new Error("experiment_store_requires_experiment");
  return path.join(vault, ...DIR.split("/"), `${object.display_id} ${slug(object.title)}.md`);
}

const CANONICAL_BODY_VERSION = 1;
const RESERVED_BODY_SECTIONS = new Set(["数据来源", "结果", "实验结果", "结论"]);

function planFromBody(body) {
  let text = String(body || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  text = text.replace(/^#[ \t]+[^\n]+\n*/, "").trim();
  text = text.replace(/^<!--[ \t]*scholarium-experiment-template:v\d+[ \t]*-->\n*/, "").trim();
  if (!text) return "";
  const matches = [...text.matchAll(/^##[ \t]+([^\n]+)[ \t]*$/gm)];
  if (!matches.length) return text;
  const parts = [];
  const prefix = text.slice(0, matches[0].index).trim();
  if (prefix) parts.push(prefix);
  for (let index = 0; index < matches.length; index++) {
    const title = normalize(matches[index][1]);
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : text.length;
    const content = text.slice(start, end).trim();
    if (RESERVED_BODY_SECTIONS.has(title)) continue;
    if (title === "实验方案与过程") {
      if (content) parts.push(content);
      continue;
    }
    parts.push(`### ${title}${content ? `\n\n${content}` : ""}`);
  }
  return parts.join("\n\n").trim();
}

function bodyFor(object, sourceBody = "") {
  const originLabels = {
    planned: "尚未产生数据（计划）",
    measured: "实测数据",
    simulated: "模拟 / 流程演示数据",
    imported: "导入数据",
    demonstration: "验收演示数据",
    unknown: "来源尚未判定",
    unverifiable: "已追溯但无法核实来源",
  };
  const origin = object.data_origin;
  const source = origin === undefined ? "未由研究者声明（当前不可作为实测证据）" : (originLabels[origin] || origin);
  const refs = Array.isArray(object.raw_data_refs) && object.raw_data_refs.length
    ? object.raw_data_refs.map((ref) => `- ${String(ref)}`).join("\n")
    : "- 未登记";
  const note = String(object.data_provenance_note || "").trim() || "未补充说明";
  const plan = planFromBody(sourceBody) || "待研究者补充。";
  const title = `${String(object.display_id || "EXP")} · ${String(object.title || "未命名实验")}`;
  return `# ${title}\n\n<!-- scholarium-experiment-template:v${CANONICAL_BODY_VERSION} -->\n\n## 实验方案与过程\n\n${plan}\n\n## 数据来源\n\n- 类型：${source}\n- 声明者：${String(object.data_recorded_by || "未声明")}\n- 声明时间：${String(object.data_recorded_at || "未声明")}\n\n### 原始数据入口\n\n${refs}\n\n### 说明\n\n${note}\n\n## 结果\n\n${String(object.result || "").trim()}\n\n## 结论\n\n${String(object.conclusion || "").trim()}\n`;
}

function canonicalizeBody(object, sourceBody) {
  if (!object || object.type !== "experiment") throw new Error("canonical_experiment_body_requires_experiment");
  return bodyFor(object, sourceBody);
}

function replacePlanSection(body, planMarkdown) {
  const text = String(body || "");
  if (!/<!--[ \t]*scholarium-experiment-template:v\d+[ \t]*-->/.test(text))
    throw new Error("experiment_plan_edit_requires_canonical_body");
  const planHeading = /^##[ \t]+实验方案与过程[ \t]*$/m.exec(text);
  if (!planHeading) throw new Error("experiment_plan_section_missing");
  const suffixPattern = /^##[ \t]+数据来源[ \t]*$/gm;
  suffixPattern.lastIndex = planHeading.index + planHeading[0].length;
  const sourceHeading = suffixPattern.exec(text);
  if (!sourceHeading) throw new Error("experiment_provenance_section_missing");
  const plan = String(planMarkdown || "").replace(/\r\n/g, "\n").trim() || "待研究者补充。";
  if (/^##[ \t]+(?:数据来源|结果|实验结果|结论)[ \t]*$/m.test(plan))
    throw new Error("experiment_plan_contains_reserved_section");
  return `${text.slice(0, planHeading.index + planHeading[0].length)}\n\n${plan}\n\n${text.slice(sourceHeading.index)}`;
}

function writeAt(vault, file, object, body) {
  const errors = S.validateObject(object);
  if (errors.length) throw new Error("拒绝写入不合法 Experiment：" + errors.join("；"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + ".tmp";
  fs.writeFileSync(temp, S.serializeObject(object, body), "utf8");
  fs.renameSync(temp, file);
  return path.relative(vault, file).split(path.sep).join("/");
}

function loadAll(vault) {
  return S.readVaultObjects(vault).filter((entry) => entry.object.type === "experiment");
}

function reservedDisplayIds(vault) {
  const ids = [];
  for (const entry of S.readVaultObjects(vault)) {
    if (entry.object.type === "experiment" && entry.object.display_id) ids.push(entry.object.display_id);
    for (const displayId of Array.isArray(entry.object.retired_display_ids) ? entry.object.retired_display_ids : [])
      if (/^EXP-\d+$/.test(String(displayId))) ids.push(String(displayId));
  }
  return [...new Set(ids)];
}

function nextDisplayId(vault) {
  return S.nextDisplayId(reservedDisplayIds(vault), "experiment");
}

function prepareNew(vault, fields, options = {}) {
  const recordedAt = fields.data_recorded_at || options.now || new Date().toISOString();
  const object = S.createObject("experiment", {
    title: String(fields.title || "").trim(),
    project_uid: fields.project_uid,
    tests_hypotheses: Array.isArray(fields.tests_hypotheses) ? fields.tests_hypotheses : [],
    status: fields.status || "designed",
    result: String(fields.result || "").trim(),
    conclusion: String(fields.conclusion || "").trim(),
    produced_evidence: [],
    data_origin: fields.data_origin || "planned",
    raw_data_refs: Array.isArray(fields.raw_data_refs) ? fields.raw_data_refs.map((ref) => String(ref).trim()).filter(Boolean) : [],
    data_provenance_note: String(fields.data_provenance_note || "").trim(),
    data_recorded_by: fields.data_recorded_by || "user",
    data_recorded_at: recordedAt,
    ...(fields.method_uid ? { method_uid: fields.method_uid } : {}),
    ...(fields.protocol_uid ? { protocol_uid: fields.protocol_uid } : {}),
  }, {
    existingDisplayIds: reservedDisplayIds(vault),
    now: options.now,
  });
  const errors = S.validateObject(object);
  if (errors.length) throw new Error("拒绝写入不合法 Experiment：" + errors.join("；"));
  const file = objectPath(vault, object);
  const body = bodyFor(object, fields.plan || "");
  return {
    object,
    path: path.relative(vault, file).split(path.sep).join("/"),
    content: S.serializeObject(object, body),
    body,
  };
}

function saveNew(vault, fields, options = {}) {
  const prepared = prepareNew(vault, fields, options);
  return {
    object: prepared.object,
    path: writeAt(vault, objectPath(vault, prepared.object), prepared.object, prepared.body),
  };
}

function saveExisting(vault, relativePath, object, options = {}) {
  const root = path.resolve(vault);
  const file = path.resolve(root, ...String(relativePath || "").split("/"));
  if (!file.startsWith(root + path.sep)) throw new Error("experiment_path_outside_vault");
  // Relationship changes (for example produced_evidence after confirmation)
  // must never erase notes a researcher added below the structured result.
  // A future record editor may explicitly request a body refresh; metadata-only
  // saves preserve the existing human-readable body byte-for-byte.
  // A planned Experiment can carry a human-readable protocol body before it
  // has any results.  It is deliberately caller-supplied rather than derived
  // from `result` so a design is never mistaken for an observation.
  const body = typeof options.body === "string"
    ? options.body
    : (options.refreshBody || !fs.existsSync(file)
      ? bodyFor(object)
      : S.parseObject(fs.readFileSync(file, "utf8")).body);
  return writeAt(vault, file, object, body);
}

function saveRecord(vault, relativePath, object) {
  return saveExisting(vault, relativePath, object, { refreshBody: true });
}

function readRecord(vault, entry) {
  if (!entry || entry.object.type !== "experiment") throw new Error("not_experiment");
  const file = path.join(vault, ...entry.path.split("/"));
  if (!fs.existsSync(file)) throw new Error("experiment_note_missing");
  const parsed = S.parseObject(fs.readFileSync(file, "utf8"));
  const body = parsed.body || bodyFor(entry.object);
  return { object: recoverStructuredFields(entry.object, body), body, source_sha256: sha256(body), blocks: resultBlocks(body) };
}

function bodySection(body, heading) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  // `\s*` around the heading used to be able to run across blank lines, so an
  // EMPTY section swallowed the rest of the note: on a freshly created record
  // (whose "## 结果" section is blank) recoverStructuredFields read result back
  // as "## 结论…" and the next save wrote that heading into frontmatter as if it
  // were the experiment's result. Only horizontal whitespace belongs on a
  // heading line; the terminator is likewise a heading line, not any whitespace.
  const match = new RegExp("(?:^|\\n)##[ \\t]*" + heading + "[ \\t]*\\n([\\s\\S]*?)(?=\\n##[ \\t]|$)").exec(text);
  return match ? match[1].trim() : "";
}

// A few early records were written with a YAML block indicator ("|") as the
// frontmatter value while their readable Markdown projection held the real
// result and conclusion.  Read those records faithfully and let the next
// explicit lifecycle transition repair the structured fields without touching
// the researcher-authored body.
function recoverStructuredFields(object, body) {
  const result = !substantive(object.result) ? bodySection(body, "\\u7ed3\\u679c") : String(object.result || "").trim();
  const conclusion = !substantive(object.conclusion) ? bodySection(body, "\\u7ed3\\u8bba") : String(object.conclusion || "").trim();
  return {
    ...object,
    ...(result ? { result } : {}),
    ...(conclusion ? { conclusion } : {}),
  };
}

function makeBlocks(parts) {
  return parts.map((part, index) => ({
    id: "r" + String(index + 1).padStart(4, "0"),
    text: part.text,
    quote_hash: blockHash(part.text),
    ...(part.label ? { label: part.label } : {}),
  }));
}

function paragraphBlocks(result) {
  return makeBlocks(result.split(/\n\s*\n/).map((block) => normalize(block)).filter(Boolean)
    .map((text) => ({ text })));
}

function headedBlocks(result) {
  const headings = [];
  const pattern = /(?:^|\n)###\s+([^\n]+)\n([\s\S]*?)(?=\n###\s+|$)/g;
  let match;
  while ((match = pattern.exec(result))) {
    const heading = normalize(match[1]);
    const text = normalize((match[0] || "").replace(/^\n/, ""));
    if (!heading || !text) continue;
    headings.push({
      text,
      // Keep the native select compact.  The full, unmodified result remains
      // in the quote preview immediately below it.
      label: heading.replace(/^\d+\s*[.\u3001:\uff1a-]\s*/, "").slice(0, 72),
    });
  }
  return headings;
}

function resultBlocks(body) {
  const text = String(body || "").replace(/\r\n/g, "\n");
  // `[ \t]*` is intentional here.  A `\s*` after the heading also consumes
  // the next blank line, which makes an empty Result section swallow the
  // following Conclusion heading and turn it into a fake evidence block.
  const match = /(?:^|\n)##[ \t]*\u7ed3\u679c[ \t]*\n([\s\S]*?)(?=\n##[ \t]|$)/.exec(text);
  const result = (match ? match[1] : text).trim();
  // A designed Experiment deliberately has an empty result section.  Its
  // surrounding protocol is not an observation and must never be exposed as
  // an Evidence candidate merely because the section is blank.
  if (!result) return [];
  // A structured record (such as EXP-004) uses one level-3 heading for each
  // scientifically reviewable result.  Treating blank lines inside a table,
  // observation, or method note as separate evidence blocks makes the chooser
  // unreadable and weakens provenance.  Older free-form records keep their
  // paragraph-level behaviour.
  const headings = headedBlocks(result);
  return headings.length >= 2 ? makeBlocks(headings) : paragraphBlocks(result);
}

function buildLocator(record, anchorId, quote) {
  if (!record || !record.object || record.object.type !== "experiment") throw new Error("not_experiment_record");
  const block = (record.blocks || []).find((item) => item.id === anchorId);
  if (!block) throw new Error("experiment_result_block_missing:" + anchorId);
  const wanted = normalize(quote);
  if (!wanted || !block.text.includes(wanted)) throw new Error("experiment_quote_not_in_result_block:" + anchorId);
  return {
    locator: {
      source_sha256: record.source_sha256,
      anchor: anchorId,
      quote_hash: block.quote_hash,
      original_url: "scholarium://experiment/" + record.object.uid,
    },
    quote: wanted,
    block,
  };
}

/**
 * Recheck at confirmation time.
 *
 * An Experiment is a living record, so a later note, protocol clarification, or
 * conclusion edit must not invalidate a citation whose *result block* is still
 * byte-for-byte the same.  The anchored block and the quoted text are the
 * provenance boundary; a changed whole-record hash is reported to the caller
 * as revision context, but is not by itself a reason to reject the Evidence.
 */
function verifyEvidenceSource(vault, evidence) {
  if (!evidence || evidence.source_type !== "experiment") return { ok: true };
  const entry = loadAll(vault).find((item) => item.object.uid === evidence.source_uid);
  if (!entry) return { ok: false, reason: "实验来源对象不存在" };
  const record = readRecord(vault, entry);
  const locator = evidence.locator || {};
  const block = record.blocks.find((item) => item.id === locator.anchor);
  if (!block) return { ok: false, reason: "实验结果块已不存在：" + String(locator.anchor || "") };
  if (block.quote_hash !== locator.quote_hash)
    return { ok: false, reason: "实验结果块哈希已变化" };
  if (!normalize(evidence.quote) || !block.text.includes(normalize(evidence.quote)))
    return { ok: false, reason: "证据引文已不在当前实验结果块中" };
  return {
    ok: true,
    record,
    source_revised: locator.source_sha256 !== record.source_sha256,
    cited_source_sha256: locator.source_sha256 || "",
    current_source_sha256: record.source_sha256,
  };
}

function addProducedEvidence(vault, experimentUid, evidenceUid, options = {}) {
  const entry = loadAll(vault).find((item) => item.object.uid === experimentUid);
  if (!entry) throw new Error("experiment_source_not_found:" + experimentUid);
  const current = Array.isArray(entry.object.produced_evidence) ? entry.object.produced_evidence : [];
  const object = {
    ...entry.object,
    produced_evidence: current.includes(evidenceUid) ? current : [...current, evidenceUid],
    updated_at: options.now || new Date().toISOString(),
  };
  saveExisting(vault, entry.path, object);
  return object;
}

function removeProducedEvidence(vault, experimentUid, evidenceUid, options = {}) {
  const entry = loadAll(vault).find((item) => item.object.uid === experimentUid);
  if (!entry) throw new Error("experiment_source_not_found:" + experimentUid);
  const current = Array.isArray(entry.object.produced_evidence) ? entry.object.produced_evidence : [];
  const object = {
    ...entry.object,
    produced_evidence: current.filter((uid) => uid !== evidenceUid),
    updated_at: options.now || new Date().toISOString(),
  };
  saveExisting(vault, entry.path, object);
  return object;
}

module.exports = {
  DIR, CANONICAL_BODY_VERSION, normalize, sha256, blockHash, planFromBody, bodyFor, canonicalizeBody, replacePlanSection, objectPath, loadAll, reservedDisplayIds, nextDisplayId,
  prepareNew, saveNew, saveExisting, saveRecord, readRecord, recoverStructuredFields, resultBlocks, buildLocator, verifyEvidenceSource, addProducedEvidence, removeProducedEvidence,
};
