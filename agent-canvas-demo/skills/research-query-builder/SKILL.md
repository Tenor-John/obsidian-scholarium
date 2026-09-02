---
name: research-query-builder
description: Create a reproducible, database-neutral first-pass literature search strategy from an authorized research question. Use before database searching; it never claims that a query was executed or that records were downloaded.
---

# Research Query Builder

Run `scripts/build_query.py <research-question>` before a literature search.

The tool produces a JSON search manifest with a concept matrix, broad discovery query, precision refinement query, known assumptions, and a search-log template. It is intentionally database-neutral. Translate the Boolean logic only after the researcher selects a database and verifies that database's current search syntax.

## Boundaries

- The generated query is a planned search, not a result set. Never invent hit counts, citations, or downloaded papers.
- Preserve the manifest alongside later search results so every query change is auditable.
- Inspect a sample of real records before adding exclusions or narrowing the query.
- For a systematic review, obtain the database, collection, run date, limits, deduplication and screening protocol from the researcher before claiming a reproducible systematic search.

## Output contract

Return the JSON manifest unchanged to downstream steps, then state the next action: run the query in a named database and save the exported RIS/Bib/CSV results in the authorized workspace.
