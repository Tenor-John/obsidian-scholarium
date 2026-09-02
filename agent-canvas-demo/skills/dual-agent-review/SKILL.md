---
name: dual-agent-review
description: Run a structured researcher-then-critic self-review loop over a set of claims before they're treated as final. Used as an optional step inside another skill (research-weaver, deep-research, research-query-builder, research-source-inventory, research-theory-dialogue), not run standalone.
---

# Dual-Agent Review (对抗式复核)

Implements the "生成 → 批判 → 打回 → 修订" loop from
`docs/多Agent科研探索方法.md` §4, with the termination logic (§4.2's
防死循环 requirement) moved into deterministic, tested code:
`tools/dual-agent-review.js`.

## What this actually is

This is **one model reviewing its own work in a second pass, not two
independent agents**. There is no multi-CLI adapter layer in this repository
yet — `docs/多Agent科研探索方法.md` §9 describes that as a separate, larger,
not-yet-built design (auto-detecting installed agent CLIs, pairing different
models as researcher vs. critic). If a researcher asks for genuinely
independent cross-model review, say so plainly rather than presenting this
skill as satisfying that request.

The value here is real even with one model: it forces every claim through a
structured, code-checkable verdict instead of a vague "looks good," it caps
the number of revision rounds so nothing loops forever, and it produces an
auditable JSON record of what was disputed and why.

## When to use it

Any skill that produces claims a researcher will read as settled — a
synthesis paragraph, a set of candidate questions, a literature summary —
can route its draft through this loop before presenting it as final. Do not
use it for pure metadata operations (search, dedupe, download) that have no
"claim" to critique.

## How to run one cycle

1. **Produce the draft** exactly as the calling skill normally would. This
   skill does not change how drafts get written, only what happens after.
2. **Re-read the draft as if seeing it for the first time.** For each
   individual claim (one result, one candidate question, one synthesis
   sentence — not the whole draft as a blob), write a dispute record:
   - `claim`: the specific sentence being judged, quoted verbatim.
   - `supported_evidence_ids`: whatever evidence/paper/result-block IDs
     actually back it, or `[]` if none exist yet.
   - `gaps`: concrete, specific problems — required whenever `verdict` is
     `revise` or `reject`. "不够充分" is not a gap; "缺少对照组数据" is.
   - `verdict`: `pass` | `revise` | `reject`.
   - `reason`: why this verdict, in words a second reader could check
     against the same claim and evidence independently.

   Build each record with `tools/dual-agent-review.js`'s
   `createDisputeRecord(fields)` — it throws on a missing claim/reason, an
   unrecognised verdict, or a revise/reject with no gaps, so a lazy "reject,
   trust me" is not representable.
3. **Evaluate the round.** Call `evaluateCycle(roundsSoFar, { maxRounds })`
   (default `maxRounds: 3`) with every round collected so far, latest last.
   It returns one of:
   - `passed` — every claim passed. Stop; the draft is ready.
   - `blocked_by_rejection` — at least one claim was rejected outright.
     Stop immediately, even on round 1. A reject is not a revisable gap; do
     not keep looping on it, surface it to the researcher.
   - `revising` — some claims still have gaps and rounds remain. Revise the
     draft addressing exactly the listed gaps, then go back to step 2 as a
     **new** round — read the revision fresh, do not just rubber-stamp your
     own edit.
   - `exhausted` — the round cap was hit with claims still open.
   - `stalled` — the exact same (claim, gaps) pairs repeated between two
     consecutive rounds, meaning the revision made no real difference.
     Stop early rather than burning the remaining rounds.
4. **Never keep looping past `blocked_by_rejection`, `exhausted`, or
   `stalled`.** All three mean "a researcher needs to look at this," not "try
   again." Surface `outcome.openClaims` and `outcome.message` verbatim.
5. **Persist the cycle** with `writeCycleLog(vault, { skill, nodeId, rounds,
   outcome })` before treating anything as final. This writes to
   `Research/_runs/review/<skill>/<nodeId>-<timestamp>.json` — an audit
   record, not a new schema-v1 object type. It never creates or confirms
   Evidence.

## Boundaries

- Do not invent supporting evidence IDs to make a gap disappear.
- Do not relabel a `reject` as `revise` to keep the loop going.
- Do not skip `reason` — an unreproducible verdict defeats the entire point
  of structuring this as data instead of prose commentary.
- Do not present this as "independent multi-agent review" in anything shown
  to the researcher. It is one model, two passes, with a code-enforced
  structure. Say that plainly if asked.
- Do not let this loop replace human confirmation anywhere Evidence
  confirmation, relation judgement, or an Experiment status transition is
  required — those remain exactly as gated as they already are elsewhere in
  this plugin.
