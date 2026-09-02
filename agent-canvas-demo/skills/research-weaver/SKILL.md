---
name: research-weaver
description: Turn one research seed into a small, reviewable map of candidate Questions and literature metadata without creating a parallel research database.
---

# Research Weaver / 织研者

Use this skill to explore a research seed in a disciplined way. It grows a
small, reviewable branch of the research graph; it does not assert novelty,
create evidence, or manufacture a second Paper database.

## Core rule

Schema-v1 objects remain the source of truth:

- A topic profile belongs to an existing **Project**. Update the Project's
  `thesis`, `current_problems`, `methods_needed`, and `excluded_topics`; do not
  create `Research/topic-profile.json`.
- A sub-topic becomes a **Question** only after the researcher adopts it. Until
  then it is a candidate question in a temporary weave bundle or a generated
  view.
- Search hits are **metadata candidates**, not Papers. A hit becomes a Paper
  only after the normal clipping/archival pipeline preserves it.
- A Canvas and its Markdown report are rebuildable views, never truth sources.

## Five phases

### 1. Profile one Project

Ask only for information that changes the Project: material system, target
reaction/phenomenon, current bottleneck, available methods, and exclusions.
Show the proposed Project edits for approval before writing them.

### 2. Diverge narrowly

Use these eight lenses: Material, Synthesis, Mechanism, Characterization,
Theory, Performance, Analogy, and Application.

Generate **at most 12 candidate questions in the first pass** (normally one or
two per useful axis). Each candidate needs a research question, an English
search strategy, and an L0–L5 evidence-density label. Do not generate 20–60
leaves in one run. The researcher chooses which one or two candidates to expand
or adopt as real Question objects.

### 3. Search as bounded metadata collection

For each approved candidate, search OpenAlex or another configured metadata
source. Store a temporary bundle at:

`Research/weave-bundles/<safe-node-id>.json`

Each bundle must contain `node_id`, `axis`, `title`, `research_question`,
`search_query`, `evidence_level`, `summary`, and `papers` (an array; it may be
empty). Keep each query small and bounded. Results are metadata only.

L0–L5 describes the quality of the current search trail, not a novelty claim:

- **L0** no direct result with the current query
- **L1** few direct results after synonym expansion
- **L2** adjacent evidence, but not the target combination
- **L3** no direct research found after reviews/citation chains/patents
- **L4** a feasible connection with a concrete unresolved question
- **L5** a testable hypothesis and executable experiment plan

Never infer “unexplored” from result counts. A zero-hit bundle is still a valid
input and must be retained with its query and search date.

### 4. Dry-run merge and graph plan

Run the registered skill tool or, from the plugin repository:

```powershell
node agent-canvas-demo/skills/research-weaver/scripts/merge_and_build_graph.js "F:\path\to\vault"
```

The default mode writes nothing. It reports a terminal status for every bundle,
deduplicates metadata by DOI, resolves any DOI already present in a schema-v1
Paper, and refuses malformed bundles. It never creates Project, Question,
Paper, Hypothesis, or Evidence objects.

During this phase, Research Weaver also invokes the registered
`paper-knowledge-graph` builder in **dry-run mode**. It reads only valid PDF
sidecars and returns a separate, locator-preserving PDF graph plan. This keeps
metadata-search mapping and PDF-passage mapping connected without treating
either one as a scientific conclusion.

When called through the local Bridge, ordinary instructions remain dry-run.
Only the exact structured input `{"mode":"apply"}` authorizes rebuilding the
views described below; it still never creates schema objects or confirms Evidence.

### 4.5 Optional: dual-agent review of the merge plan (pilot)

Before applying, the candidate-question summaries and any result-derived
claims in the dry-run plan may be routed through the
[`dual-agent-review`](../dual-agent-review/SKILL.md) skill: draft the claim,
re-read it fresh as a critic, and only proceed to `--apply` once the cycle
returns `passed`. This is the pilot flow the design in
`docs/多Agent科研探索方法.md` §4.3 asked for — one narrow flow first, not a
rewrite of every skill. If the cycle returns `blocked_by_rejection`,
`exhausted`, or `stalled`, stop and show the researcher `outcome.openClaims`
and `outcome.message` instead of applying the plan anyway.

### 5. Create rebuildable views only after review

After inspecting the dry-run plan, explicitly apply it:

```powershell
node agent-canvas-demo/skills/research-weaver/scripts/merge_and_build_graph.js "F:\path\to\vault" --apply
```

This creates new timestamped files only:

- `Canvases/research-weaver-<timestamp>.canvas`
- `Research/WeaveRuns/research-weaver-<timestamp>.md`
- When valid PDF sidecars exist: `Canvases/paper-knowledge-graph-<timestamp>.canvas`,
  `Canvases/paper-knowledge-graph-<timestamp>.html`, and its companion report.

The HTML graph uses the supplied editorial dark knowledge-map style. It
compresses repeated mentions into one view edge per Paper/entity pair while the
underlying plan retains each source locator.

It never overwrites a previous view. The Canvas distinguishes existing Papers
from external metadata candidates, and distinguishes adopted Question UIDs from
candidate questions.

## Boundaries

- Do not claim that a relation is established unless the Evidence pipeline has
  preserved a source locator and a researcher has confirmed it.
- Do not make an LLM or agent automatically create/confirm Evidence or decide
  `SUPPORTS`/`CONTRADICTS`.
- Do not promote metadata into a Paper merely because its DOI was seen in
  search.
- Do not use Canvas node IDs as durable identities. Use schema-v1 `uid` values
  only when an existing object is explicitly resolved.
- Do not run `--apply` until the dry-run plan is valid and reviewed.
