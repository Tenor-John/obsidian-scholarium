---
name: paper-knowledge-graph
description: Build a reviewable, evidence-located knowledge-graph view from Scholarium PDF sidecars. Use for mapping materials, methods, and paper passages without creating or confirming formal research objects.
---

# Paper knowledge graph

Use the PDF sidecars under `.scholarium/pdf-sidecars/` as the only source.
They already contain a PDF hash, stable block id, block hash, and DOI URL.

## Run

Run `scripts/build_paper_graph.js <vault> [input-json]` for a dry-run. The
input may set `limit` (1-50) and `keywords` (an array of optional terms).
The output is a JSON plan and writes nothing.

Only run with `--apply` after the dry-run is valid. It creates timestamped,
rebuildable views under `Canvases/` and `Research/WeaveRuns/`; it never
creates or edits Paper, Hypothesis, Experiment, or Evidence objects.

## Interpretation boundary

- Every graph edge is `MENTIONS`, never `SUPPORTS`, `CONTRADICTS`, or a
  scientific conclusion.
- Every edge must carry `source_sha256`, `anchor`, `quote_hash`, and
  `original_url` from the selected sidecar block.
- Treat the graph as a navigation aid. Create formal Evidence only through
  Scholarium's normal review flow.
