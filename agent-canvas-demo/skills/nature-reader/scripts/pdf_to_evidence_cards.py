#!/usr/bin/env python3
from __future__ import annotations
import hashlib, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SECTION_PATTERNS = [
    ("Methods", re.compile(r"^(experimental( section)?|methods?|materials?\s+and\s+methods?|synthesis( procedure)?|实验部分|实验方法|材料与方法)\b", re.I)),
    ("Results", re.compile(r"^(results?( and discussion)?|结果(与讨论)?)\b", re.I)),
    ("Discussion", re.compile(r"^(discussion|讨论)\b", re.I)),
    ("Conclusion", re.compile(r"^(conclusions?|summary|结论|总结)\b", re.I)),
    ("Introduction", re.compile(r"^(introduction|背景|引言)\b", re.I)),
]
_STOP_SECTION = re.compile(r"^(references?|acknowledge?ments?|参考文献|致谢)\b", re.I)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

def _strip_numbering(line):
    return re.sub(r"^\d+[.)]\s*", "", line)

def _join_lines(lines):
    # PDF line-wrap hyphenation: a line ending in "-" continues on the next
    # line with no space ("hydro-" + "thermal" -> "hydrothermal").
    text = ""
    for line in lines:
        if text.endswith("-"):
            text = text[:-1] + line
        elif text:
            text += " " + line
        else:
            text = line
    return text

def _sentences(lines, section, page):
    if not lines:
        return []
    text = _join_lines(lines)
    tag = f"[p{page}]" + (f"[{section}]" if section else "")
    return [f"{tag} {s.strip()}" for s in _SENTENCE_SPLIT.split(text) if len(s.strip()) > 80]

def extract_text(pdf):
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(pdf))
        pages = []
        for i, page in enumerate(reader.pages[:12], 1):
            pages.append({"page": i, "text": (page.extract_text() or "")[:6000]})
        return pages, "pypdf"
    except Exception as e:
        data = pdf.read_bytes()[:200000].decode("latin-1", errors="ignore")
        return [{"page": None, "text": re.sub(r"\\s+", " ", data[:4000])}], f"fallback:{e}"

def card_for(pdf):
    """Page/section-tagged sentence candidates instead of one blind
    first-N-pages blob. Real paragraph grouping would need per-character
    layout (pdfjs-style) that plain pypdf text extraction doesn't expose
    reliably -- verified against real PDFs in this vault. Section headings
    (Methods/Results/...) do reliably land on their own `\\n`-delimited line
    even in plain-mode pypdf output, so heading detection runs at the line
    level; body text is then joined and split into sentence-level
    candidates. A References/Acknowledgements heading stops extraction for
    the rest of the document so citation lists stop polluting
    claim_candidates."""
    pages, method = extract_text(pdf)
    digest = hashlib.sha1(str(pdf).encode("utf-8")).hexdigest()[:12]
    candidates = []
    if method == "pypdf":
        current_section = None
        for p in pages:
            body_lines, stop = [], False
            for raw_line in p["text"].split("\n"):
                line = raw_line.strip()
                if not line:
                    continue
                head = _strip_numbering(line)
                if len(head) < 60 and _STOP_SECTION.match(head):
                    stop = True
                    break
                matched = next((s for s, pat in SECTION_PATTERNS if len(head) < 60 and pat.match(head)), None)
                if matched:
                    # Cap per page/section run, not globally, so a dense
                    # Introduction on pages 1-2 can't crowd out Methods/
                    # Results/Discussion further into the paper.
                    candidates.extend(_sentences(body_lines, current_section, p["page"])[:6])
                    body_lines, current_section = [], matched
                    continue
                body_lines.append(line)
            candidates.extend(_sentences(body_lines, current_section, p["page"])[:6])
            if stop:
                break
    else:
        text = pages[0]["text"] if pages else ""
        candidates = [s.strip() for s in _SENTENCE_SPLIT.split(text) if len(s.strip()) > 80][:8]
    return {
        "id": f"evidence-{digest}",
        "source_path": str(pdf),
        "reader": method,
        "evidence_tier": "direct_pdf_text" if method == "pypdf" else "needs_manual_review",
        "claim_candidates": candidates[:90],
        "limitations": ["automatic extraction; verify against rendered PDF before high-stakes claims"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }

def load_input(value):
    if not value:
        return {}
    raw = value
    possible = Path(value)
    if possible.exists() and possible.is_file():
        try:
            raw = possible.read_text(encoding="utf-8")
        except Exception:
            return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}

def pdfs_from_input(root, payload):
    paths = []
    if isinstance(payload, dict):
        for key in ("pdf_paths", "downloaded_paths", "paths"):
            if isinstance(payload.get(key), list):
                paths += payload[key]
        if isinstance(payload.get("results"), list):
            paths += [item.get("path") for item in payload["results"] if isinstance(item, dict) and item.get("status") == "downloaded"]
    elif isinstance(payload, list):
        paths = payload
    out = []
    for item in paths:
        if not item:
            continue
        pdf = Path(str(item))
        if not pdf.is_absolute():
            pdf = root / pdf
        if pdf.exists() and pdf.is_file() and pdf.suffix.lower() == ".pdf":
            out.append(pdf.resolve())
    # De-duplicate while preserving order.
    seen, unique = set(), []
    for pdf in out:
        key = str(pdf).lower()
        if key not in seen:
            seen.add(key)
            unique.append(pdf)
    return unique

def write_progress(progress_file, **fields):
    progress_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "skill": "nature-reader",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    temp = progress_file.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(progress_file)

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2]) if len(sys.argv) > 2 else {}
    pdfs = pdfs_from_input(root, payload)
    progress_file = root / "Scholarium" / "runtime" / "nature-reader-progress.json"
    started_at = datetime.now(timezone.utc).isoformat()
    write_progress(progress_file, status="running", completed=0, total=len(pdfs), current_file=None, started_at=started_at)
    if not pdfs:
        write_progress(progress_file, status="completed", completed=0, total=0, current_file=None, started_at=started_at)
        print(json.dumps({
            "skill": "nature-reader",
            "pdf_count": 0,
            "card_count": 0,
            "cards": [],
            "stopped": True,
            "stop_reason": "no_run_scoped_pdfs",
            "message": "No PDFs were provided by the current paper-downloader run. Refusing to scan historical literature/downloaded-pdfs to avoid evidence contamination."
        }, ensure_ascii=False, indent=2))
        return 0
    out = root / "literature" / "evidence-cards"; out.mkdir(parents=True, exist_ok=True)
    cards = []
    for index, pdf in enumerate(pdfs, 1):
        write_progress(progress_file, status="running", completed=index - 1, total=len(pdfs), current_file=pdf.name, started_at=started_at)
        card = card_for(pdf)
        target = out / f"{card['id']}.json"
        target.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
        cards.append({**card, "card_path": str(target.relative_to(root)).replace("\\", "/")})
        write_progress(progress_file, status="running", completed=index, total=len(pdfs), current_file=pdf.name, started_at=started_at)
    write_progress(progress_file, status="completed", completed=len(cards), total=len(pdfs), current_file=None, started_at=started_at)
    print(json.dumps({"skill": "nature-reader", "pdf_count": len(pdfs), "card_count": len(cards), "cards": cards}, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
