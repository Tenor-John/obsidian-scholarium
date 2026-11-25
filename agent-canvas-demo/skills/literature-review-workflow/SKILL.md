---
name: literature-review-workflow
description: Build a traceable literature pool and collaboratively plan and draft a literature-driven review using the researcher's supplied records.
---

# Literature pool and collaborative review

Use this workflow when the researcher asks for a literature search, a literature pool, or a review based on supplied records. The input may be a Zotero export, a database export, a literature-matrix export, or an Excel workbook. Keep source identifiers and original records so selections and citations can be traced back.

## Search and screening

1. Decompose the research topic into concepts, synonyms, abbreviations, and required or optional terms. Prepare balanced, high-recall, and high-precision queries in the syntax of the researcher's chosen database. Record assumptions, query text, database, date, and filters.
2. Use only available, authorized search tools. If Web of Science or another subscribed database is unavailable, say so and let the researcher supply an export; never present a proposed query as executed. Preserve database and original record identifiers, title, authors, year, DOI, abstract, and source when available.
3. Deduplicate with DOI or other stable identifiers while retaining aliases and provenance. Mark missing abstracts and uncertain matches. Screen for topic relevance and assign explicit reading priorities with reasons; do not infer full-text evidence from a title or abstract.

## Review writing

Start by inspecting the actual selected files with this skill's read-only runner, for example `{"data_path":"literature/pool.xlsx","sheet":"Main_Classification","offset":0,"limit":20}`. It lists sheets and fields, counts records and field coverage, and returns a page of source rows with a source hash. It defaults to `Main_Classification` if present; otherwise specify a sheet when multiple are visible. Use `offset` and `limit` (at most 200) for additional pages. Source must be inside the authorized workspace. It supports XLSX, CSV, TSV, TXT and DAT; XLS must first be converted. Cached formula values only; macros and external links are not executed. Do not claim a workbook was read if the runner fails. The existing `sch-data-normalize` skill can also inspect an authorized XLSX, but normalization creates separate artifacts and must follow its stated scope.

Progress through topic positioning, an evidence-led outline, a literature-to-claim matrix, figure/table planning, introduction, individual body sections, challenges and future directions, abstract/conclusions, consistency review, and the manuscript package. Deliver each stage for the researcher to review and follow their instructions on when to advance.

For main sections use approximately 40% representative literature, 40% comparative critical analysis, and 20% synthesis as a guide, not a mechanical quota. Prefer P0/P1 records when present, distinguish full text from abstract-only evidence, and trace claims to supplied identifiers. Cite only supplied material unless the researcher explicitly asks for additional searching; mark insufficient evidence and avoid invented papers, figures, results or mechanisms.

The exported literature matrix supplies short metadata, not the complete articles. Ask to read relevant source notes or PDFs where detailed claims require them. Never infer that a missing abstract means a negative result or that an unverified interpretation is an author conclusion.
