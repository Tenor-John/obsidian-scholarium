---
name: zrl-knowledge-graph
description: Build a provenance-aware semantic research knowledge graph and render it as a self-contained interactive HTML file. Use for material–method–mechanism–evidence graphs, not document/excerpt canvases.
---
# ZRL Scientific Knowledge Graph

Turn reviewed research evidence into a semantic entity–relation graph and render it with the bundled deterministic HTML renderer.

Run:

`python scripts/render_graph.py <workspace> <json-input-or-file>`

The input may contain a pre-extracted `graph` object and/or `card_source_paths`. Prefer a reviewed `graph` produced with the extraction contract below. The script validates it and falls back to a conservative keyword graph only when extraction is unavailable.

## Extraction contract

Return one JSON object with:

- `title`, `research_question`, `summary`;
- `nodes`: `{id, label, type, description, source_refs[]}`;
- `edges`: `{source, target, relation, label, confidence, review_status, evidence[]}`;
- `warnings[]`.

Allowed node types are `material`, `precursor`, `condition`, `process`, `structure`, `mechanism`, `characterization`, `outcome`, `paper`, `question`, and the project-structural types `specimen`, `synthesis`, `execution`, `observation`, `claim`.

Allowed relations include `contains`, `prepared_from`, `treated_by`, `under_condition`, `forms`, `changes`, `enables`, `inhibits`, `measured_by`, `correlates_with`, `supports`, `contradicts`, `tests`, and `instance_of`.

Each edge must carry at least one evidence item with `source_path` and a locator or short quote. Use `review_status: inferred` for a plausible relation not directly asserted by the source. Do not convert co-occurrence into causality. Every `quote` is checked verbatim against the source evidence card's text (see `scripts/quote_verify.py`) before an edge is trusted as `supported` — a quote that doesn't verify is downgraded to `inferred` and reported as a warning, regardless of what the extraction step claimed. `supported` requires at least one evidence item with a *verified* quote (2026-09-01 tightening): an item that only carries `source_path`/`locator` with no quote at all is not sufficient on its own, even if `review_status: supported` was claimed — it is downgraded to `inferred` the same way a mismatched quote is.

### Project-structural nodes (2026-09-01)

`specimen`/`synthesis`/`execution`/`observation`/`claim` are a read-only projection of *this project's own* samples and characterization runs onto the same graph as the semantic material/mechanism types above — not a second taxonomy. They are **visualization-only**: rendering them here does not create or require any new committed vault object type. (An earlier draft proposed adding `material_system`/`specimen`/`synthesis_process`/`characterization_execution`/`observation` as new schema-v1 object types in `tools/schema-objects.js`; that proposal was superseded by this decision and should not be revived without re-deciding it — `EXPERIMENT_SCHEMA.md` already models a whole experiment as one `EXP-NNN` object with inline variables, and this graph reads that shape rather than requiring finer-grained committed records.) Use `synthesis`/`claim` for the researcher's own reduction of several observations — don't force a literal `quote` onto them; use `supports`/`contradicts` edges to their evidence instead. Because those edges carry no quote, they will render as `review_status: inferred` under the 2026-09-01 tightening above — that is the correct, honest result until a dedicated verifiable evidence type for experiment records (an `EXP` uid plus a versioned/hashed result-block locator) exists; do not fabricate a quote just to make one of these edges display as `supported`.

## Output

- `knowledge-graph/knowledge_graph.json` — normalized graph data;
- `knowledge-graph/knowledge_graph.html` — self-contained interactive SVG graph;
- `knowledge-graph/knowledge_graph-report.md` — validation and provenance summary.

## Quality boundaries

- A vertical document-to-claim chain is not a knowledge graph.
- Exclude off-topic sources before extraction; report the exclusion count.
- Do not invent entities, quantitative values, DOI, page numbers, or causal relations.
- Keep uncertain relations visible and filterable instead of presenting them as fact.
- The HTML must work offline: no CDN, remote font, or network dependency.
