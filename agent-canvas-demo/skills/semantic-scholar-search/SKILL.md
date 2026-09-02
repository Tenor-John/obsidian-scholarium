---
name: semantic-scholar-search
description: Search Semantic Scholar's Graph API for cross-discipline literature metadata, citation counts, and open-access PDF links.
---
# Semantic Scholar Search

Use as an additional metadata search pass alongside `nature-academic-search`/`pop8-scholar-search` (OpenAlex) and `pubmed-search`. Semantic Scholar's `openAccessPdf` field surfaces a free PDF link for a subset of records — still not full-text coverage of everything returned.

Run `scripts/search_semantic_scholar.py <root> <query>` to retrieve records (title, year, venue, DOI, citation count, open-access PDF link where available, abstract).

## Boundaries

- Do not treat search hits as read papers.
- Preserve query, provider, timestamp, and record IDs (paperId/DOI).
- Auth is header-based (`x-api-key`), unlike OpenAlex's `api_key` query parameter — the script handles this; don't try to pass the key in the query string manually.
