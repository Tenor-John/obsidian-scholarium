#!/usr/bin/env python3
from __future__ import annotations
import json, sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def load_input(value):
    """Optional JSON (inline or a file path) carrying this run's PDF list."""
    if not value:
        return {}
    try:
        candidate = Path(value)
        if candidate.exists() and candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8").lstrip("﻿"))
    except OSError:
        pass
    try:
        return json.loads(value)
    except Exception:
        return {}


def scope_filter(payload):
    """Names of the PDFs this run downloaded, or None for 'no scoping'.

    literature/evidence-cards/ accumulates across runs, and every consumer here
    used to glob the whole directory. A run on a new topic therefore synthesised
    over the previous topic's cards — 39 new cards silently joined by 37 left
    from another subject, with the manuscript written over the union. Cards carry
    no DOI (only id/source_path/evidence_tier/claim_candidates), so the scope has
    to key on source_path; basenames compare cleanly whether the caller passed
    absolute or workspace-relative paths.
    """
    paths = payload.get("card_source_paths") or payload.get("pdf_paths")
    if not isinstance(paths, list) or not paths:
        return None
    return {Path(str(p)).name for p in paths if p}


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    scope = scope_filter(payload)
    records_file = root / "literature" / "exports" / "deduped-records.json"
    cards_dir = root / "literature" / "evidence-cards"
    records = json.loads(records_file.read_text(encoding="utf-8")).get("records", []) if records_file.exists() else []
    cards = []
    skipped_out_of_scope = 0
    if cards_dir.exists():
        for file in cards_dir.glob("*.json"):
            try: card = json.loads(file.read_text(encoding="utf-8"))
            except Exception: continue
            if scope is not None and Path(str(card.get("source_path") or "")).name not in scope:
                skipped_out_of_scope += 1
                continue
            cards.append(card)
    direct = [c for c in cards if c.get("evidence_tier") == "direct_pdf_text"]
    synthesis = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "record_count": len(records),
        "evidence_card_count": len(cards),
        "scoped_to_current_run": scope is not None,
        "cards_skipped_out_of_scope": skipped_out_of_scope,
        "established_evidence": [claim for c in direct for claim in (c.get("claim_candidates") or [])[:2]][:12],
        "indirect_leads": [r.get("title") for r in records[:12] if r.get("title")],
        "unknowns": [
            "Which claims are supported by read full text rather than metadata?",
            "Which experimental controls distinguish mechanism from correlation?",
            "Which gap is novel after deduplication and full-text reading?"
        ],
        "research_gaps": [
            "Evidence gap: current synthesis is weak until downloaded PDFs are read and coded.",
            "Design gap: explicit H0/H1 and discriminating controls are needed before strong manuscript claims."
        ],
        "next_actions": [
            "Download or manually add the top priority PDFs.",
            "Run nature-reader to create evidence cards.",
            "Use the evidence cards to update the research question and stop/go criteria."
        ]
    }
    out = root / "Research"; out.mkdir(parents=True, exist_ok=True)
    target = out / "deep-research-synthesis.json"
    target.write_text(json.dumps(synthesis, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"skill": "deep-research", "synthesis": str(target.relative_to(root)).replace("\\", "/"), **synthesis}, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
