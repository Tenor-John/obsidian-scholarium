---
name: pop8-scholar-search
description: Broaden scholarly discovery with a second metadata search pass and return dedupe-ready records.
---
# POP8 Scholar Search

Use this as an independent broadening pass after `nature-academic-search`.

Run `scripts/search_openalex_broad.py <query>` to retrieve a broader OpenAlex result set with relaxed ranking. The output is dedupe-ready metadata, not full-text evidence.

## Boundaries

- Do not treat search hits as read papers.
- Prefer recall over precision, then dedupe and screen.
- Preserve query, provider, timestamp, and record IDs.

