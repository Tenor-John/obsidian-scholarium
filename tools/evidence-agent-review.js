"use strict";
/*
 * Validate an LLM's proposed review without granting it review authority.
 * This module cannot confirm, reject, or link Evidence. It only turns a
 * provider response into an auditable `ai_review` draft that a researcher can
 * inspect and explicitly adopt in the UI.
 */
const Q = require("./evidence-query-expansion");
const crypto = require("crypto");

const DECISIONS = new Set(["confirm", "reject", "uncertain"]);
const RELATIONS = new Set([
  "SUPPORTS", "CONTRADICTS", "QUALIFIES", "REPLICATES",
  "FAILS_TO_REPLICATE", "DEPENDS_ON",
]);

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseReview(text) {
  let value;
  try { value = JSON.parse(Q.firstJsonObject(text)); }
  catch (_) { throw new Error("AI 初审没有返回可解析的 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("AI 初审必须返回一个 JSON 对象");
  const decision = String(value.decision || "").toLowerCase();
  if (!DECISIONS.has(decision))
    throw new Error("AI 初审 decision 必须是 confirm | reject | uncertain");
  const relation = String(value.relation || "").toUpperCase();
  const claim = compact(value.claim, 700);
  const reason = compact(value.reason, 1000);
  if (!reason) throw new Error("AI 初审必须给出可审阅理由");
  if (decision === "confirm") {
    if (!RELATIONS.has(relation)) throw new Error("AI 建议采纳时必须提供合法 relation");
    if (claim.length < 8) throw new Error("AI 建议采纳时必须给出可核对的 claim");
  }
  if (decision === "uncertain" && claim.length < 8)
    throw new Error("AI 建议保留判断时必须提供中性结果摘要");
  // Rejection removes the proposed scientific relation, not the source's
  // factual content. Keep a concise, source-grounded draft so researchers
  // can review why the passage is unsuitable instead of seeing a blank form.
  if (decision === "reject" && claim.length < 8)
    throw new Error("AI 建议不创建时也必须起草可审阅的证据主张");
  return {
    decision,
    relation: decision === "confirm" ? relation : "",
    claim,
    reason,
  };
}

function promptForReview(hypothesis, evidence) {
  return `You are an evidence-review assistant. Assess ONLY whether the quoted passage bears on the target hypothesis. You do not have authority to confirm or reject Evidence; your output is a recommendation for a researcher to inspect.

Return ONLY valid JSON exactly shaped as:
{"decision":"confirm|reject|uncertain","relation":"SUPPORTS|CONTRADICTS|QUALIFIES|REPLICATES|FAILS_TO_REPLICATE|DEPENDS_ON|","claim":"concise statement of what the quote establishes for this hypothesis","reason":"specific, falsifiable reason grounded in the quote"}

Rules:
- "confirm" only when the quote directly bears on the hypothesis. Set one valid relation and a claim that does not exceed the quote.
- "reject" when overlap is merely broad terminology, a different material/system/reaction, or no direct bearing. Leave relation empty. In claim, write one concise, source-grounded sentence explaining what the quote reports and why it cannot support or refute the target hypothesis; explain the mismatch in reason as well.
- "uncertain" when the passage could be relevant but does not establish a relation. Leave relation empty. Still write a concise, neutral result summary in claim: say only what the passage reports and what it does not establish for the hypothesis. Do not imply support or contradiction.
- Never infer experimental replication from a theory, review, or unrelated study.
- Do not use confidence scores, citations not shown, or chain-of-thought.

Target hypothesis:
${hypothesis.statement || ""}

Candidate's existing claim:
${evidence.claim || ""}

Quoted source passage:
${evidence.quote || ""}

Source URL:
${((evidence.locator || {}).original_url) || ""}`;
}

function makeReview(parsed, options = {}) {
  const now = options.now || new Date().toISOString();
  return {
    decision: parsed.decision,
    relation: parsed.relation || "",
    claim: parsed.claim || "",
    reason: parsed.reason,
    target_uid: String(options.targetUid || ""),
    model: compact(options.model || "unknown", 160),
    reviewed_at: now,
    prompt_sha256: crypto.createHash("sha256").update(String(options.prompt || ""), "utf8").digest("hex"),
  };
}

function suggestedAction(review) {
  if (!review || review.decision === "uncertain") return "";
  return review.decision === "confirm" ? "confirm" : "reject";
}

module.exports = { DECISIONS, RELATIONS, parseReview, promptForReview, makeReview, suggestedAction };
