"use strict";
// Generic 生成 → 批判 → 打回 → 修订 loop, usable by any skill in
// agent-canvas-demo/skills/ (deep-research, research-weaver,
// research-query-builder, ...), one round at a time.
//
// This module does NOT run two separate agent processes. There is no
// multi-CLI adapter layer in this repository yet (see
// docs/多Agent科研探索方法.md §9 for that larger, not-yet-built design). What
// exists today is a single agent session — Claude or whichever assistant is
// executing the skill — that plays both roles in sequence: draft as
// "researcher", then re-read its own draft fresh and critique it as "critic",
// exactly as the design doc's shared-document protocol describes. That is
// honestly "one model" doing adversarial self-review, not two independent
// minds; the value is the structure (forced structured verdicts, a hard
// round cap, deterministic termination), not simulated independence.
//
// Every judgement call that can be made by code — is this record shaped
// correctly, has this cycle converged, must it stop — lives here, in tested
// deterministic functions. Only the verdict *content* (does this claim
// actually hold up) is left to the calling agent's prompt.
const fs = require("fs");
const path = require("path");

const DIR = "Research/_runs/review";
const VERDICTS = ["pass", "revise", "reject"];
const DEFAULT_MAX_ROUNDS = 3;

function segments(relative) { return relative.split("/"); }
function reviewDir(vault) { return path.join(vault, ...segments(DIR)); }

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function nonEmpty(value) { return String(value || "").trim().length > 0; }
function stringArray(value) { return Array.isArray(value) ? value.filter((v) => nonEmpty(v)) : []; }

/**
 * One structured dispute-record entry — the shared-document protocol from
 * docs/多Agent科研探索方法.md §4.2, kept exactly as specified there so a
 * human reading the JSON needs no separate legend:
 *   claim, supported_evidence_ids, gaps, verdict, reason
 *
 * `reason` exists precisely so "打回" is never a bare thumbs-down: every
 * revise/reject must say, in words a second reader can check, why.
 */
function createDisputeRecord(fields = {}) {
  if (!nonEmpty(fields.claim)) throw new Error("dispute record 缺少 claim：批判必须针对一句具体的结论");
  if (!VERDICTS.includes(fields.verdict)) throw new Error("verdict 必须是 " + VERDICTS.join(" | ") + "，实际为 " + JSON.stringify(fields.verdict));
  if (!nonEmpty(fields.reason)) throw new Error("dispute record 缺少 reason：判定必须可复现，不能只给结论");
  if (fields.supported_evidence_ids !== undefined && !Array.isArray(fields.supported_evidence_ids))
    throw new Error("supported_evidence_ids 必须是数组");
  if (fields.gaps !== undefined && !Array.isArray(fields.gaps))
    throw new Error("gaps 必须是数组");
  if (fields.verdict === "revise" && !stringArray(fields.gaps).length)
    throw new Error("verdict 为 revise 时 gaps 不能为空：必须说明修订什么");
  if (fields.verdict === "reject" && !stringArray(fields.gaps).length)
    throw new Error("verdict 为 reject 时 gaps 不能为空：必须说明为何不成立");
  return {
    claim: String(fields.claim).trim(),
    supported_evidence_ids: stringArray(fields.supported_evidence_ids),
    gaps: stringArray(fields.gaps),
    verdict: fields.verdict,
    reason: String(fields.reason).trim(),
  };
}

/** Deterministic summary of one round's records — no judgement, only counting. */
function summarizeRound(records) {
  if (!Array.isArray(records) || !records.length) throw new Error("一轮批判至少需要一条 dispute record");
  const anyReject = records.some((r) => r.verdict === "reject");
  const allPass = records.every((r) => r.verdict === "pass");
  const open = records.filter((r) => r.verdict !== "pass");
  const openClaims = open.map((r) => r.claim).sort();
  // A signature per open claim, including its gaps. Two rounds can share the
  // same *claim* (revision is still in progress) without being a stall — the
  // stall check below needs to see whether the gaps actually changed, not
  // just whether the same claim is still open.
  const openSignatures = open.map((r) => r.claim + "␟" + [...r.gaps].sort().join("␞")).sort();
  return { anyReject, allPass, openClaims, openSignatures };
}

/**
 * Decide what happens after the latest round, given every prior round.
 *
 * `rounds` is an array of rounds-so-far, each round an array of dispute
 * records (already through createDisputeRecord). The *latest* round is
 * `rounds[rounds.length - 1]`.
 *
 * Termination is entirely code, matching §4.2's "防死循环" requirement:
 *   - any `reject` in the latest round → stop immediately, human required.
 *     A reject means the claim doesn't hold; looping "revise" attempts at it
 *     would just keep dressing up a claim that was never sound.
 *   - every record in the latest round is `pass` → stop, passed.
 *   - the open (claim, gaps) set is identical to the previous round's →
 *     stalled. Same claims with newly-narrowed gaps still counts as
 *     progress; only a byte-for-byte repeat means another round would not
 *     converge either.
 *   - round count has reached maxRounds → exhausted, human required.
 *   - otherwise → continue, one more round.
 */
function evaluateCycle(rounds, options = {}) {
  const maxRounds = options.maxRounds || DEFAULT_MAX_ROUNDS;
  if (!Array.isArray(rounds) || !rounds.length) throw new Error("evaluateCycle 需要至少一轮记录");
  const latest = summarizeRound(rounds[rounds.length - 1]);
  const round = rounds.length;

  if (latest.anyReject)
    return { status: "blocked_by_rejection", shouldContinue: false, round, openClaims: latest.openClaims,
      message: "至少一条 claim 被判定 reject；这不是可修订的缺口，需要研究者介入，不再自动重试。" };

  if (latest.allPass)
    return { status: "passed", shouldContinue: false, round, openClaims: [],
      message: "本轮全部 claim 通过批判。" };

  if (round > 1) {
    const previous = summarizeRound(rounds[round - 2]);
    const same = previous.openSignatures.length === latest.openSignatures.length
      && previous.openSignatures.every((sig, i) => sig === latest.openSignatures[i]);
    if (same)
      return { status: "stalled", shouldContinue: false, round, openClaims: latest.openClaims,
        message: "本轮未解决的 claim 与上一轮的缺口完全相同：修订没有产生实际差异，继续循环不会收敛，需要研究者介入。" };
  }

  if (round >= maxRounds)
    return { status: "exhausted", shouldContinue: false, round, openClaims: latest.openClaims,
      message: `已达到最大轮数（${maxRounds}），仍有未通过的 claim，需要研究者介入。` };

  return { status: "revising", shouldContinue: true, round, openClaims: latest.openClaims,
    message: "存在待修订的 claim，且未超过轮数上限，继续下一轮。" };
}

/**
 * Persist one finished cycle for audit — mirrors tools/bridge-action-queue.js's
 * atomic-write convention. This is a record of what happened, not a new
 * schema-v1 object type: it never creates Evidence, never confirms a claim.
 */
function writeCycleLog(vault, { skill, nodeId, rounds, outcome, now }) {
  if (!nonEmpty(skill)) throw new Error("writeCycleLog 需要 skill 名称");
  if (!nonEmpty(nodeId)) throw new Error("writeCycleLog 需要 nodeId（对应产出的稳定标识）");
  const at = now || new Date().toISOString();
  const safeId = String(nodeId).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "review";
  const file = path.join(reviewDir(vault), skill, `${safeId}-${at.replace(/[:.]/g, "-")}.json`);
  const record = { skill, node_id: nodeId, at, rounds, outcome };
  writeJsonAtomic(file, record);
  return path.relative(vault, file).split(path.sep).join("/");
}

module.exports = {
  DIR, VERDICTS, DEFAULT_MAX_ROUNDS,
  createDisputeRecord, summarizeRound, evaluateCycle, writeCycleLog,
};
