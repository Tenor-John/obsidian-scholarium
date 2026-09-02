---
name: json-canvas
description: Create an Obsidian JSON Canvas knowledge graph from claims, papers, gaps, and hypotheses.
---
# JSON Canvas

Run `scripts/build_canvas.py <workspace> <json-input-or-file>`.

Creates:

`Canvases/research-knowledge-graph.canvas`

## Boundaries

- Use graph edges only for explicit relationships in evidence cards or synthesis outputs.
- Mark inferred edges as `needs_review`.

