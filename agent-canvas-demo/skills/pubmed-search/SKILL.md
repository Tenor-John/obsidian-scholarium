---
name: pubmed-search
description: Search PubMed (NCBI E-utils) for biomedical/life-science literature metadata and abstracts.
---
# PubMed Search

Use for biomedical/life-science topics as an additional metadata search pass, alongside `nature-academic-search`/`pop8-scholar-search` (OpenAlex).

Run `scripts/search_pubmed.py <root> <query>` to retrieve PubMed records (title, year, journal, DOI, abstract where available). The output is dedupe-ready metadata, not full-text evidence — PubMed itself never serves full text; only the separate PMC Open Access Subset does.

## Boundaries

- Do not treat search hits as read papers.
- Preserve query, provider, timestamp, and record IDs (PMID/DOI).
- Simple keyword query only — PubMed's own Boolean/MeSH syntax is not sanitized here the way OpenAlex queries are; keep queries short and topical.
