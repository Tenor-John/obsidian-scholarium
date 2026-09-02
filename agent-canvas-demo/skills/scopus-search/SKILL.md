---
name: scopus-search
description: Search Elsevier Scopus for literature metadata. Requires an Elsevier API key, and full results typically require a subscribing institution's IP range.
---
# Scopus Search

Use as an additional metadata search pass alongside `nature-academic-search`/`pop8-scholar-search` (OpenAlex), `pubmed-search`, and `semantic-scholar-search`.

Run `scripts/search_scopus.py <root> <query>` to retrieve records (title, year, venue, DOI, citation count).

## Important caveat before treating an empty/error result as a bug

Elsevier commonly restricts full Scopus Search entitlements to requests that originate from an IP address inside a subscribing institution's registered range (or that carry an additional `X-ELS-Insttoken`). A personal API key run from a home network can be completely valid and still return zero or heavily limited results. If this happens, that's expected Elsevier behavior, not a misconfigured key — running the same query over an institutional VPN/WebVPN session is the usual fix, not re-issuing the key.

## Boundaries

- Do not treat search hits as read papers.
- Preserve query, provider, timestamp, and record IDs (Scopus EID/DOI).
- Auth is header-based (`X-ELS-APIKey`); the script handles this.
