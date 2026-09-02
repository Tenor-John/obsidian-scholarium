---
name: nature-academic-search
description: Search high-impact academic metadata sources for a research question and return auditable records.
---
# Nature Academic Search

Use this after `literature-search-query-builder`.

Run `scripts/search_openalex.py <query>` to retrieve scholarly metadata from OpenAlex. This is a discovery step, not proof that papers have been read.

## Boundaries

- Keep all records as metadata or abstract-level evidence unless a PDF/full text is later downloaded and read.
- Preserve DOI, OpenAlex ID, title, year, venue, cited-by count, abstract, OA status, and source URL.
- Do not claim systematic coverage from this single source.

