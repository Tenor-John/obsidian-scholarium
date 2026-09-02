"use strict";
/**
 * Parse and persist LLM-produced query-expansion packs.
 *
 * The model is allowed to suggest English search phrases only. This module has
 * no network access and cannot create Evidence: it turns a model response into
 * a small, inspectable Markdown artifact under Research/QueryPacks.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const S = require("./schema-objects");

const MAX_TERMS = 20;
const asciiTerm = /^[\x20-\x7e]+$/;
const GENERIC_GROUP_WORDS = new Set([
  "activity", "catalyst", "catalytic", "efficiency", "enhancement", "interface", "light", "mechanism",
  "nanoparticle", "photocatalysis", "photocatalyst", "plasmonic", "reaction", "surface", "transfer", "visible",
]);
const CHEMICAL_SYMBOLS = new Set(["ag", "al", "au", "bi", "cd", "co", "cu", "fe", "ni", "pt", "ti", "zn"]);

function normalizeTerm(value) {
  const term = String(value || "").replace(/\s+/g, " ").trim();
  if (!term || term.length > 100 || !asciiTerm.test(term)) return "";
  // Search phrases, not a Boolean query language. This prevents a generated
  // string from smuggling a query syntax or a prose explanation into matching.
  if (!/[a-z]/i.test(term) || /[{}\[\]`";]/.test(term)) return "";
  return term;
}

function normalizeConceptGroups(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 6)
    throw new Error("LLM 词包的 concept_groups 必须是至多 6 组的数组");
  const seen = new Set();
  return value.map((group, index) => {
    if (!group || typeof group !== "object" || Array.isArray(group))
      throw new Error("LLM 词包的 concept_groups 项必须是对象");
    const label = normalizeTerm(group.label || "") || `concept-${index + 1}`;
    if (!Array.isArray(group.terms) || group.terms.length < 1 || group.terms.length > 6)
      throw new Error("每个 concept group 必须有 1 到 6 个英文同义表达");
    const terms = [...new Set(group.terms.map(normalizeTerm))];
    if (terms.some((term) => !term)) throw new Error("concept group 只能包含有效 ASCII 英文表达");
    const key = terms.map((term) => term.toLowerCase()).sort().join("\u0000");
    if (seen.has(key)) throw new Error("concept_groups 不得重复");
    seen.add(key);
    return { label, terms, required: group.required === true };
  });
}

function literalSignatures(hypothesis) {
  const source = [
    hypothesis && hypothesis.statement,
    ...((hypothesis && hypothesis.assumptions) || []),
    ...((hypothesis && hypothesis.alternative_explanations) || []),
  ].join(" ");
  const found = new Set();
  for (const raw of source.match(/\b\d{2,4}\s*nm\b/gi) || [])
    found.add(raw.replace(/\s+/g, " ").toLowerCase());
  for (const raw of source.match(/\b[A-Za-z][A-Za-z0-9-]*\b/g) || []) {
    const token = raw.toLowerCase();
    const formulaLike = /\d/.test(raw) || /[a-z][A-Z]/.test(raw) || CHEMICAL_SYMBOLS.has(token);
    if (formulaLike) found.add(token);
  }
  return [...found];
}

function signatureGroup(signature) {
  const unit = /^(\d{2,4})\s*nm$/i.exec(signature);
  if (unit) return { label: `${unit[1]} nm`, terms: [`${unit[1]} nm`, `${unit[1]}nm`] };
  const terms = [signature];
  // AuNP, PtNP and similar abbreviations often appear in prose as the bare
  // chemical symbol. This is a transparent spelling expansion, not a claim
  // that the two materials are scientifically interchangeable.
  const symbol = /^([a-z]{1,2})(?:np|nps)$/i.exec(signature);
  if (symbol && CHEMICAL_SYMBOLS.has(symbol[1].toLowerCase())) terms.push(symbol[1]);
  return { label: signature, terms };
}

function fallbackConceptGroups(hypothesis, phraseList = []) {
  const groups = literalSignatures(hypothesis).map(signatureGroup);
  if (groups.length >= 2) return groups.slice(0, 6);
  // A hypothesis without formulae or stated conditions can still use a small,
  // deterministic fallback from repeated non-generic terms in the model pack.
  // It remains deliberately conservative: a single broad word never passes the
  // later two-group gate.
  const counts = new Map();
  for (const phrase of phraseList) {
    for (const raw of String(phrase || "").toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || []) {
      if (!GENERIC_GROUP_WORDS.has(raw)) counts.set(raw, (counts.get(raw) || 0) + 1);
    }
  }
  for (const [term, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (groups.length >= 6) break;
    if (count < 2 || groups.some((group) => group.terms.includes(term))) continue;
    groups.push({ label: term, terms: [term] });
  }
  return groups;
}

function ensureConceptGroups(parsed, hypothesis) {
  if ((parsed.concept_groups || []).length >= 2) {
    const groups = parsed.concept_groups;
    // A pack which never identifies its discriminating condition reduces to
    // "any two broad words".  That was the source of the first 16 irrelevant
    // candidates, so a model pack must make the restrictive choice explicit.
    if (!groups.some((group) => group.required))
      throw new Error("LLM 词包必须至少标记一组 required: true 的区分性概念");
    if (groups.every((group) => group.required))
      throw new Error("LLM 词包必须保留至少一组 optional 概念用于交叉命中");
    return { ...parsed, concept_group_source: "model" };
  }
  const groups = fallbackConceptGroups(hypothesis, parsed.terms);
  if (groups.length < 2)
    throw new Error("词包缺少至少两组必要概念，且假设中没有可安全识别的英文实体或条件；请补充材料名称、条件或英文缩写后重试。");
  // A format fallback cannot honestly infer which condition is scientifically
  // decisive. Require every literal signature rather than pretending that one
  // arbitrary signature is the key condition; this safely prefers zero
  // candidates to a broad, misleading queue.
  return { ...parsed, concept_groups: groups.map((group) => ({ ...group, required: true })), concept_group_source: "deterministic_fallback" };
}

function fallbackExpansion(hypothesis) {
  const groups = fallbackConceptGroups(hypothesis, []);
  if (groups.length < 2) throw new Error("LLM 未返回可解析词包，且假设中没有足够的可安全识别实体来建立备用检索词包。");
  const terms = [...new Set(groups.flatMap((group) => group.terms.map((term) => term.toLowerCase())))];
  if (terms.length < 4) throw new Error("LLM 未返回可解析词包，且备用词包少于 4 条；请在假设中补充材料名称、波长或其他英文缩写后重试。");
  return {
    terms,
    concept_groups: groups.map((group) => ({ ...group, required: true })),
    concept_group_source: "deterministic_fallback_after_llm_format_failure",
    rationale: "LLM response was not parseable; this conservative pack was derived only from literal entities and conditions written in the hypothesis.",
  };
}

/**
 * Extract the first complete JSON object without guessing where a prose reply
 * ends. `/{[\s\S]*}/` is greedy: an otherwise valid response followed by an
 * explanatory `{example}` becomes unparsable.  This small scanner honours JSON
 * quoted strings and escapes, so a fenced answer or surrounding prose stays
 * harmless while we still accept only a complete JSON object.
 */
function firstJsonObject(text) {
  const raw = String(text || "");
  for (let start = raw.indexOf("{"); start >= 0; start = raw.indexOf("{", start + 1)) {
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) return raw.slice(start, i + 1);
    }
  }
  return "";
}

function parseExpansion(text) {
  const raw = String(text || "").trim();
  const objectText = firstJsonObject(raw);
  let value;
  try { value = JSON.parse(objectText); } catch (_) { throw new Error("LLM 没有返回可解析的 JSON 词包"); }
  if (!Array.isArray(value.terms)) throw new Error("LLM 词包缺少 terms 数组");
  const normalized = value.terms.map(normalizeTerm);
  // Do not silently drop a Chinese/prose fragment and proceed with a partial
  // pack: that would conceal an LLM format failure and make the audit record
  // lie about what was returned. A pack is accepted whole or not at all.
  if (normalized.some((term) => !term))
    throw new Error("LLM 词包只能包含有效的 ASCII 英文检索短语");
  const terms = [...new Set(normalized.map((term) => term.toLowerCase()))];
  if (terms.length < 4) throw new Error("LLM 词包有效英文短语少于 4 条");
  if (terms.length > MAX_TERMS) throw new Error(`LLM 词包超过 ${MAX_TERMS} 条上限`);
  return {
    terms,
    concept_groups: normalizeConceptGroups(value.concept_groups),
    rationale: String(value.rationale || "").replace(/\s+/g, " ").trim().slice(0, 500),
  };
}

/** Normalise text-style and content-block-style chat responses. */
function responseText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => {
    if (typeof part === "string") return part;
    return part && typeof part === "object" ? responseText(part.text || part.content || part.value || "") : "";
  }).join("\n");
  if (value && typeof value === "object") return responseText(value.text || value.content || value.value || "");
  return "";
}

/**
 * Providers expose the same assistant text through different envelopes:
 * Anthropic `content`, Chat Completions `choices[0].message.content`, and
 * Responses API `output_text` / `output[].content`. Keep that provider
 * variance here, away from the audit parser and from scientific logic.
 */
function apiResponseText(payload) {
  const json = payload || {};
  const chat = (((json.choices || [])[0] || {}).message || {});
  return responseText(json.output_text || chat.content || json.content || json.output || "");
}

function promptForExpansion(hypothesis) {
  return `You are expanding a research hypothesis into an auditable English literature-retrieval query pack. You are NOT judging evidence, proposing a claim, or assigning SUPPORTS/CONTRADICTS. Return ONLY valid JSON with this exact shape:\n{"terms":["short concept phrase","another phrase"],"concept_groups":[{"label":"critical condition","terms":["synonym A","synonym B"],"required":true},{"label":"material B","terms":["synonym C"],"required":false}],"rationale":"one short sentence"}\n\nRules:\n- Return 6 to 16 concise English academic concept phrases in terms (normally 1–5 words; do not write full Boolean-style search queries).\n- Return 2 to 6 concept_groups. Each group holds 1–6 interchangeable literal English names for ONE distinct material, mechanism, condition, or outcome.\n- Mark one to three groups required:true. Required groups must capture the hypothesis's discriminating backbone (for example a critical wavelength/condition or a specific material system), never generic "activity", "efficiency", or "photocatalysis". Keep at least one group required:false for additional cross-matching.\n- Include material names, synonyms, mechanisms, methods, and wavelength/condition variants when present.\n- Each phrase must be ASCII English; no Boolean operators, no explanations in terms, no Chinese.\n- Do not assert that the hypothesis is true.\n\nHypothesis:\n${hypothesis.statement || ""}\n\nAssumptions:\n${(hypothesis.assumptions || []).join("; ")}\n\nAlternative explanations:\n${(hypothesis.alternative_explanations || []).join("; ")}`;
}

function stamp(now) { return String(now || new Date().toISOString()).replace(/[:.]/g, "-"); }

function saveQueryPack(vault, hypothesis, parsed, options = {}) {
  const now = options.now || new Date().toISOString();
  const id = hypothesis.display_id || hypothesis.uid;
  const dir = path.join(vault, "Research", "QueryPacks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}-${stamp(now)}.md`);
  const prompt = options.prompt || promptForExpansion(hypothesis);
  const object = {
    artifact: "evidence_query_expansion",
    hypothesis_uid: hypothesis.uid,
    hypothesis_display_id: hypothesis.display_id,
    generated_at: now,
    generator: options.generator || "llm",
    prompt_sha256: crypto.createHash("sha256").update(prompt, "utf8").digest("hex"),
    terms: parsed.terms,
    concept_groups: parsed.concept_groups,
    concept_group_source: parsed.concept_group_source || "model",
    rationale: parsed.rationale || "",
  };
  const body = [
    "# 可审计检索词包", "",
    `- 假设：${hypothesis.statement || ""}`,
    `- 生成器：${object.generator}`,
    `- 提示词 SHA-256：${object.prompt_sha256}`,
    "", "## 英文检索短语", "",
    ...parsed.terms.map((term) => `- ${term}`),
    "", "## 概念组与门槛", "",
    ...parsed.concept_groups.map((group) => `- **${group.label}** (${group.required ? "必需" : "可选"}): ${group.terms.join(" / ")}`),
    "", "## 生成说明", "", parsed.rationale || "（模型未提供说明）", "",
    "该文件只记录检索扩展，不构成证据、结论或关系判断。",
  ].join("\n");
  fs.writeFileSync(file, S.serializeObject(object, body + "\n"), "utf8");
  return { path: path.relative(vault, file).split(path.sep).join("/"), object };
}

module.exports = { MAX_TERMS, normalizeTerm, normalizeConceptGroups, literalSignatures, fallbackConceptGroups, ensureConceptGroups, fallbackExpansion, firstJsonObject, parseExpansion, responseText, apiResponseText, promptForExpansion, saveQueryPack };
