---
name: obsidian-bases
description: Build an Obsidian literature base from deduped references and evidence cards.
---
# Obsidian Bases

Run `scripts/build_literature_base.py <workspace> <json-input-or-file>`.

Creates Markdown literature notes and an index under:

`Literature/`

## Boundaries

- Never overwrite existing notes; create versioned filenames on conflict.
- Preserve DOI, source path, evidence tier, and reading status.

