---
name: nature-polishing
description: Polish manuscript prose while preserving scientific claim strength and evidence boundaries.
---
# Nature Polishing

Run `scripts/polish_manuscript.py <workspace> <json-input-or-file>`.

## Precondition: evidence gate

与 nature-writing 同一道门。证据不足时拒绝润色——把证据稀薄的稿子润得更顺，
只会让它更像成品、更容易被误引。加载不到证据门同样拒绝执行。

## Boundaries

- Polish language only; do not strengthen scientific claims without evidence.
- Preserve citations, numerical values, caveats, and limitations.
- Return a change log of wording changes that affect claim strength.

