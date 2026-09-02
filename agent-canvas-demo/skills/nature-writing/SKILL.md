---
name: nature-writing
description: Draft manuscript sections from evidence cards and the deep-research synthesis.
---
# Nature Writing

Run `scripts/draft_manuscript.py <workspace> <json-input-or-file>`.

## Precondition: evidence gate

脚本启动时会调用 `skills/evidence-gate` 的 `evaluate()`。未达证据下限时**不出稿**，
改为返回 `status: blocked` 并生成 `Research/retrieval-download-diagnostic.md`。
证据门本身加载失败也一律拒绝出稿（fail closed）。

默认下限：本地全文 ≥ 10 篇、全文/候选 ≥ 20%、`direct_pdf_text` 证据卡 ≥ 20 张。

## Boundaries

- Draft text must carry evidence references or TODO markers.
- Do not fabricate citations, statistics, or claims.
- Strong claim words must match evidence strength.

