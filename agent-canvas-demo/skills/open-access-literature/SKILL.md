---
name: open-access-literature
description: Search OpenAlex for scholarly metadata and obtain only openly licensed or openly hosted full-text links with a reproducible provenance record. Use for literature discovery before analysis; never bypass paywalls, publisher access controls, or institutional authentication.
---

# Open Access Literature

Run `scripts/openalex_search.py <query>` to search the public OpenAlex works index.

The result is metadata and access status, not proof that the paper has been read. Keep DOI, OpenAlex ID, title, publication year, cited-by count, abstract availability, OA flag, and a candidate PDF URL. Use `best_oa_location.pdf_url` only as a candidate; download only after explicit user confirmation, record URL and timestamp, and validate the downloaded file before analysis.

## Boundaries

- Do not use this Skill to access subscription-only articles, circumvent a paywall, or use a campus cookie/session.
- Keep metadata-only records as `pending_fulltext`, not as evidence.
- A download failure is an access result, not evidence that the paper does not exist.
- Search results must carry query, provider, run timestamp, and result count for the audit log.
