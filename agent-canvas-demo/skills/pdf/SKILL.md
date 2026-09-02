---
name: pdf
description: Read local downloaded PDFs and convert them into evidence cards for the research pipeline.
---
# PDF Evidence Reader

Run `scripts/pdf_to_evidence_cards.py <workspace> <json-input-or-file>`.

This is the executable local alias for the PDF evidence-card step.

## Boundaries

- Only read local PDFs inside the authorized workspace.
- Keep extraction method and evidence tier.
- Verify important claims against the rendered PDF before manuscript use.

