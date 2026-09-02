---
name: reference-export-dedupe
description: Merge scholar-search records, deduplicate by DOI/title, and export RIS, BibTeX, and DOI lists.
---
# Reference Export and Deduplication

Run `scripts/export_dedupe.py <workspace> <json-records-or-file>` after metadata search.

## Output

- `literature/exports/references.ris`
- `literature/exports/references.bib`
- `literature/exports/doi-list.txt`
- `literature/exports/deduped-records.json`

## Boundaries

- Deduplication is conservative. Same DOI is a match; title-only matches are marked as title_match.
- Exported references remain metadata until full text is read.

