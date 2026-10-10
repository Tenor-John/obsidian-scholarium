---
name: paper-knowledge-graph
description: Build a reviewable, evidence-located knowledge-graph view from Scholarium PDF sidecars, RAG chunks, or both. Use for mapping materials, methods, and paper passages without creating or confirming formal research objects.
---

# Paper knowledge graph

Use one of these provenance-preserving sources:

- `source: "sidecars"` (default): `.scholarium/pdf-sidecars/`
- `source: "rag"`: `Scholarium/runtime/rag-index/chunks.jsonl`
- `source: "both"`: merge both by source hash without duplicate papers

Both routes carry a source hash, stable block/chunk id and text hash. RAG chunks
also carry heading and character offsets. Embedding proximity is never treated
as a scientific relation.

## Run

Run `scripts/build_paper_graph.js <vault> [input-json]` for a dry-run. The
input may set `source`, `limit` (1-50), and `keywords` (an array of optional terms).
The output is a JSON plan and writes nothing.

Only run with `--apply` after the dry-run is valid. It creates timestamped,
rebuildable views under `Canvases/` and `Research/WeaveRuns/`; it never
creates or edits Paper, Hypothesis, Experiment, or Evidence objects.

## Interpretation boundary

- Every graph edge is `MENTIONS`, never `SUPPORTS`, `CONTRADICTS`, or a
  scientific conclusion.
- Every edge must carry `source_sha256`, `anchor`, `quote_hash`, `source_type`,
  and a source reference from the selected sidecar or RAG chunk.
- Treat the graph as a navigation aid. Create formal Evidence only through
  Scholarium's normal review flow.
