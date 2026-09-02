#!/usr/bin/env python3
from __future__ import annotations
import json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def load_input(value):
    if value and Path(value).exists():
        return json.loads(Path(value).read_text(encoding="utf-8"))
    if value:
        try: return json.loads(value)
        except Exception: return {"records": []}
    return {"records": []}

def flatten(obj):
    if isinstance(obj, list): return obj
    records = []
    if isinstance(obj, dict):
        if isinstance(obj.get("records"), list): records += obj["records"]
        for key in ("results", "manifests", "searches"):
            if isinstance(obj.get(key), list):
                for item in obj[key]: records += flatten(item)
    return records

def norm_doi(v):
    return re.sub(r"^https?://(dx\.)?doi\.org/", "", str(v or "").strip().lower())

def norm_title(v):
    return re.sub(r"\W+", " ", str(v or "").lower()).strip()

def bib_key(rec, idx):
    author = "paper"
    year = rec.get("year") or "nd"
    title = norm_title(rec.get("title")).split(" ")
    stem = next((w for w in title if len(w) > 4), "record")
    return re.sub(r"[^A-Za-z0-9_:-]", "", f"{author}{year}{stem}{idx}")

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    raw = sys.argv[2] if len(sys.argv) > 2 else ""
    records = flatten(load_input(raw))
    seen, out = {}, []
    for rec in records:
        doi, title = norm_doi(rec.get("doi")), norm_title(rec.get("title"))
        key = f"doi:{doi}" if doi else f"title:{title}"
        if not title: continue
        if key in seen: continue
        seen[key] = True
        rec = dict(rec); rec["dedupe_key"] = key; out.append(rec)
    folder = root / "literature" / "exports"; folder.mkdir(parents=True, exist_ok=True)
    (folder / "deduped-records.json").write_text(json.dumps({"run_at": datetime.now(timezone.utc).isoformat(), "records": out}, ensure_ascii=False, indent=2), encoding="utf-8")
    (folder / "doi-list.txt").write_text("\n".join(filter(None, [norm_doi(r.get("doi")) for r in out])), encoding="utf-8")
    ris_lines, bib_lines = [], []
    for i, r in enumerate(out, 1):
        ris_lines += ["TY  - JOUR", f"TI  - {r.get('title','')}", f"PY  - {r.get('year','')}", f"JO  - {r.get('venue','')}", f"DO  - {norm_doi(r.get('doi'))}", "ER  - ", ""]
        bib_lines += [f"@article{{{bib_key(r,i)},", f"  title = {{{r.get('title','')}}},", f"  year = {{{r.get('year','')}}},", f"  journal = {{{r.get('venue','')}}},", f"  doi = {{{norm_doi(r.get('doi'))}}}", "}", ""]
    (folder / "references.ris").write_text("\n".join(ris_lines), encoding="utf-8")
    (folder / "references.bib").write_text("\n".join(bib_lines), encoding="utf-8")
    print(json.dumps({"skill": "reference-export-dedupe", "input_records": len(records), "deduped_records": len(out), "output_dir": str(folder)}, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
