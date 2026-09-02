#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Reuse literature-partition's matcher so "which shelf does this note belong on"
# has exactly one definition in the pipeline.
PARTITION_SCRIPT = Path(__file__).resolve().parents[2] / "literature-partition" / "scripts" / "partition_literature.py"


def load_partition():
    spec = importlib.util.spec_from_file_location("partition_literature", PARTITION_SCRIPT)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception:
        return None
    return module


def safe(v):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(v or "untitled"))
    value = re.sub(r"\s+", " ", value).strip().strip(".")
    return value[:90] or "untitled"


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    records_file = root / "literature" / "exports" / "deduped-records.json"
    records = json.loads(records_file.read_text(encoding="utf-8")).get("records", []) if records_file.exists() else []

    part = load_partition()
    pdfs = part.index_pdfs(root) if part else []
    read_names = part.read_pdf_names(root) if part else set()

    # Lowercase on purpose: the vault's shelf root is `literature/`. Windows
    # hides the difference, a synced Linux/iCloud copy would not, and a
    # split-brain `Literature/` + `literature/` pair would silently halve the
    # note count that every downstream count relies on.
    base = root / "literature"
    created = {"fulltext-read": [], "metadata-only": []}
    counts = {"fulltext_read": 0, "pdf_downloaded_unread": 0, "metadata_only": 0}

    for rec in records:
        pdf = part.match_pdf(rec.get("doi", ""), rec.get("title", ""), pdfs) if part else None
        # Downloaded-but-unread is NOT evidence; it stays on the candidate shelf.
        if pdf and pdf["name"] in read_names:
            status, shelf = "fulltext_read", "fulltext-read"
        elif pdf:
            status, shelf = "pdf_downloaded_unread", "metadata-only"
        else:
            status, shelf = "metadata_only", "metadata-only"
        counts[status] += 1

        folder = base / shelf
        folder.mkdir(parents=True, exist_ok=True)
        stem = f"{rec.get('year', 'nd')}-{rec.get('title', 'untitled')}"
        target = folder / f"{safe(stem)}.md"
        n = 2
        while target.exists():
            target = folder / f"{target.stem}-{n}.md"; n += 1
        content = f"""---
type: literature-note
doi: {rec.get('doi') or ''}
openalex_id: {rec.get('openalex_id') or ''}
year: {rec.get('year') or ''}
venue: {rec.get('venue') or ''}
reading_status: {status}
evidence_shelf: {shelf}
fulltext_path: {pdf['rel'] if pdf else ''}
created_at: {datetime.now(timezone.utc).isoformat()}
---

# {rec.get('title') or 'Untitled'}

## Metadata

- DOI: {rec.get('doi') or ''}
- Venue: {rec.get('venue') or ''}
- Year: {rec.get('year') or ''}
- OA: {rec.get('is_oa')}

## Abstract / Summary

{rec.get('abstract') or 'No abstract in metadata.'}

## Evidence cards

{'See evidence cards generated from ' + pdf['rel'] if status == 'fulltext_read' else 'None. This note is a candidate lead, not evidence.'}
"""
        target.write_text(content, encoding="utf-8")
        created[shelf].append(str(target.relative_to(root)).replace("\\", "/"))

    for shelf, readme in (part.SHELF_README.items() if part else []):
        shelf_dir = base / shelf
        shelf_dir.mkdir(parents=True, exist_ok=True)
        (shelf_dir / "README.md").write_text(readme, encoding="utf-8")

    manifest = {
        "skill": "obsidian-bases",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "partition_available": bool(part),
        "notes_created": sum(len(v) for v in created.values()),
        "counts": counts,
        "notes": created,
    }
    base.mkdir(parents=True, exist_ok=True)
    (base / "_base-index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
