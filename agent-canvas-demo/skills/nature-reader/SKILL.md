---
name: nature-reader
description: Read downloaded PDFs and generate source-grounded evidence cards.
---
# Nature Reader

Run `scripts/pdf_to_evidence_cards.py <workspace> <json-input-or-file>`.

## Output

Evidence cards under:

`literature/evidence-cards/*.json`

## Boundaries

- Extract evidence from actual local PDFs only.
- Each card must keep source path, page/section hint when available, quote or paraphrase, claim candidate, and evidence tier.
- Do not infer experimental details not present in the file.

