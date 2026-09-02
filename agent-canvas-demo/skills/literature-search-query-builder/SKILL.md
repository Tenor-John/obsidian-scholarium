---
name: literature-search-query-builder
description: Build auditable Boolean search queries from a research question for downstream scholarly search.
---
# Literature Search Query Builder

Run `scripts/build_query.py <research-question>`.

This is the first skill in the Scholarium research pipeline.

## Boundaries

- This produces search strategy, not search results.
- Preserve query versions and assumptions.
- Run `nature-academic-search` and `pop8-scholar-search` after this step.

