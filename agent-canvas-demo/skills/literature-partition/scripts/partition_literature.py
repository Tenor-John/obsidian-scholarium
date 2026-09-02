#!/usr/bin/env python3
"""Split literature notes into metadata-only vs fulltext-read shelves.

Why this exists
---------------
Every note used to land in one flat folder regardless of whether anyone had
opened the paper.  70 notes in `Literature/` reads as "70 papers reviewed" when
the truth may be "70 abstracts skimmed, 1 PDF fetched".  Physically separating
the two shelves makes the evidence level impossible to misread -- by the
researcher and by any downstream step.

Shelves:
  Literature/fulltext-read/   PDF exists locally AND an evidence card was built
                              from that PDF. Only these may back strong claims.
  Literature/metadata-only/   everything else -- candidate leads, not evidence.
                              Notes whose PDF is downloaded but unread are kept
                              here and tagged `pdf_downloaded_unread`.

Run: python partition_literature.py <workspace> [<json-input-or-file>]
Input: {"dry_run": true} to preview without moving anything.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ARCHIVE_DIR_NAMES = {"_archive-irrelevant", "_archive", "_trash", "_rejected"}
MIN_PDF_BYTES = 8 * 1024
SHELVES = {"fulltext-read", "metadata-only"}
# Folders under literature/ that hold artefacts, not notes.
NON_NOTE_DIRS = {"downloaded-pdfs", "evidence-cards", "exports"} | SHELVES

SHELF_README = {
    "fulltext-read": (
        "# fulltext-read\n\n"
        "本目录中的每篇笔记都满足：本地存在 PDF **且**已由 nature-reader/pdf 生成证据卡片。\n"
        "只有这些笔记可以支撑综述结论、研究空白判断与 manuscript 论断。\n\n"
        "自动由 `literature-partition` 维护，请勿手工往这里搬运未读文献。\n"
    ),
    "metadata-only": (
        "# metadata-only\n\n"
        "本目录是**候选文献线索池**，不是证据库。笔记内容来自检索返回的元数据/摘要。\n\n"
        "- `reading_status: metadata_only` — 没有本地全文。\n"
        "- `reading_status: pdf_downloaded_unread` — PDF 已下载但没读，仍不算证据。\n\n"
        "引用这里的任何内容前必须先下载并阅读全文，笔记会随之被移入 `fulltext-read/`。\n"
    ),
}


def load_input(value):
    if value and Path(value).exists():
        try:
            return json.loads(Path(value).read_text(encoding="utf-8"))
        except Exception:
            return {}
    if value:
        try:
            return json.loads(value)
        except Exception:
            return {}
    return {}


def _rel(root: Path, path: Path) -> str:
    try:
        return str(path.relative_to(root)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def norm_doi(value: str) -> str:
    doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", str(value or "").strip(), flags=re.I)
    return doi.lower().strip().strip(".")


def doi_keys(doi: str) -> set[str]:
    """Filenames encode DOIs inconsistently (`/` becomes -, _ or .)."""
    doi = norm_doi(doi)
    if not doi:
        return set()
    return {doi, doi.replace("/", "-"), doi.replace("/", "_"), doi.replace("/", ".")}


def index_pdfs(root: Path) -> list[dict]:
    base = root / "literature" / "downloaded-pdfs"
    if not base.exists():
        return []
    out = []
    for pdf in base.rglob("*.pdf"):
        if any(part in ARCHIVE_DIR_NAMES for part in pdf.relative_to(base).parts[:-1]):
            continue
        try:
            if pdf.stat().st_size < MIN_PDF_BYTES:
                continue
        except OSError:
            continue
        out.append({"path": pdf, "name": pdf.name.lower(), "rel": _rel(root, pdf)})
    return out


def read_pdf_names(root: Path) -> set[str]:
    """Basenames of PDFs that actually produced a full-text evidence card."""
    base = root / "literature" / "evidence-cards"
    names: set[str] = set()
    if not base.exists():
        return names
    for file in base.glob("*.json"):
        try:
            card = json.loads(file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if card.get("evidence_tier") != "direct_pdf_text":
            continue
        if not any(str(claim).strip() for claim in (card.get("claim_candidates") or [])):
            continue
        source = str(card.get("source_path") or "")
        if source:
            names.add(Path(source.replace("\\", "/")).name.lower())
    return names


def frontmatter(text: str) -> dict:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    data = {}
    for line in text[3:end].splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            data[key.strip()] = value.strip()
    return data


def set_frontmatter(text: str, updates: dict) -> str:
    if not text.startswith("---"):
        header = "\n".join(f"{k}: {v}" for k, v in updates.items())
        return f"---\n{header}\n---\n\n{text}"
    end = text.find("\n---", 3)
    if end == -1:
        return text
    lines = text[3:end].strip("\n").splitlines()
    remaining = dict(updates)
    out = []
    for line in lines:
        key = line.partition(":")[0].strip()
        if key in remaining:
            out.append(f"{key}: {remaining.pop(key)}")
        else:
            out.append(line)
    out += [f"{k}: {v}" for k, v in remaining.items()]
    return "---\n" + "\n".join(out) + text[end:]


def note_files(root: Path) -> list[Path]:
    """Top-level notes plus anything already sitting on a shelf (so reruns can
    promote a note from metadata-only to fulltext-read)."""
    base = root / "literature"
    if not base.exists():
        return []
    files = [p for p in base.glob("*.md") if p.name.lower() != "readme.md"]
    for shelf in SHELVES:
        files += list((base / shelf).glob("*.md")) if (base / shelf).exists() else []
    return [p for p in files if "type: literature-note" in _head(p)]


def _head(path: Path, limit: int = 600) -> str:
    try:
        return path.read_text(encoding="utf-8")[:limit]
    except Exception:
        return ""


def match_pdf(note_doi: str, title: str, pdfs: list[dict]) -> dict | None:
    keys = doi_keys(note_doi)
    for pdf in pdfs:
        if any(key and key in pdf["name"] for key in keys):
            return pdf
    tokens = [t for t in re.findall(r"[a-z0-9]{5,}", (title or "").lower())][:8]
    if len(tokens) >= 3:
        for pdf in pdfs:
            hits = sum(1 for t in tokens if t in pdf["name"])
            if hits >= 3:
                return pdf
    return None


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    dry_run = bool(payload.get("dry_run")) if isinstance(payload, dict) else False

    base = root / "literature"
    pdfs = index_pdfs(root)
    read_names = read_pdf_names(root)
    notes = note_files(root)

    moves = []
    counts = {"fulltext_read": 0, "pdf_downloaded_unread": 0, "metadata_only": 0}

    for note in notes:
        text = note.read_text(encoding="utf-8")
        meta = frontmatter(text)
        title_match = re.search(r"^#\s+(.+)$", text, re.M)
        pdf = match_pdf(meta.get("doi", ""), title_match.group(1) if title_match else note.stem, pdfs)
        if pdf and pdf["name"] in read_names:
            status, shelf = "fulltext_read", "fulltext-read"
        elif pdf:
            status, shelf = "pdf_downloaded_unread", "metadata-only"
        else:
            status, shelf = "metadata_only", "metadata-only"
        counts[status] += 1

        target_dir = base / shelf
        target = target_dir / note.name
        if not dry_run:
            target_dir.mkdir(parents=True, exist_ok=True)
            updated = set_frontmatter(text, {
                "reading_status": status,
                "evidence_shelf": shelf,
                "fulltext_path": pdf["rel"] if pdf else "",
                "partitioned_at": datetime.now(timezone.utc).isoformat(),
            })
            if target.resolve() != note.resolve():
                n = 2
                while target.exists():
                    target = target_dir / f"{note.stem}-{n}.md"; n += 1
                note.write_text(updated, encoding="utf-8")
                shutil.move(str(note), str(target))
            else:
                target.write_text(updated, encoding="utf-8")
        moves.append({
            "note": _rel(root, note),
            "moved_to": _rel(root, target),
            "reading_status": status,
            "fulltext_path": pdf["rel"] if pdf else None,
        })

    if not dry_run:
        for shelf, readme in SHELF_README.items():
            shelf_dir = base / shelf
            shelf_dir.mkdir(parents=True, exist_ok=True)
            (shelf_dir / "README.md").write_text(readme, encoding="utf-8")

    stray = []
    if base.exists():
        for child in base.iterdir():
            if child.is_dir() and child.name not in NON_NOTE_DIRS and not child.name.startswith("."):
                stray += [_rel(root, p) for p in child.glob("*.md")]

    manifest = {
        "skill": "literature-partition",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry_run,
        "notes_processed": len(notes),
        "counts": counts,
        "fulltext_pdfs_indexed": len(pdfs),
        "read_pdfs_with_evidence_cards": len(read_names),
        "unclassified_notes_in_other_subfolders": stray,
        "moves": moves,
    }
    if not dry_run:
        (base / "_partition-index.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
