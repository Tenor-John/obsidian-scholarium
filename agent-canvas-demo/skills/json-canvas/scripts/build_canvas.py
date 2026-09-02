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


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    # See synthesize_gaps.scope_filter: evidence-cards/ accumulates across runs
    # and cards carry no DOI, so a run is scoped by the basenames of the PDFs it
    # actually downloaded. Without this the canvas mixes topics.
    paths = payload.get("card_source_paths") or payload.get("pdf_paths")
    scope = {Path(str(p)).name for p in paths if p} if isinstance(paths, list) and paths else None
    cards_dir = root / "literature" / "evidence-cards"
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
    nodes, edges = [], []
    x, y = 0, 0
    for i, card in enumerate(cards):
        cid = card.get("id") or f"card-{i}"
        nodes.append({"id": cid, "type": "text", "x": x, "y": y, "width": 420, "height": 220, "text": f"{cid}\\n{card.get('source_path','')}\\nTier: {card.get('evidence_tier','needs_review')}"})
        for j, claim in enumerate((card.get("claim_candidates") or [])[:3]):
            qid = f"{cid}-claim-{j+1}"
            nodes.append({"id": qid, "type": "text", "x": x + 520, "y": y + j * 170, "width": 440, "height": 140, "text": f"Claim candidate\\n{claim}"})
            edges.append({"id": f"{cid}-to-{qid}", "fromNode": cid, "toNode": qid, "label": "supports?", "color": "3"})
        y += 300
    canvas = {"nodes": nodes, "edges": edges}
    out = root / "Canvases"; out.mkdir(parents=True, exist_ok=True)
    target = out / "research-knowledge-graph.canvas"
    target.write_text(json.dumps(canvas, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"skill": "json-canvas", "canvas": str(target.relative_to(root)).replace("\\", "/"), "nodes": len(nodes), "edges": len(edges), "cards": len(cards), "scoped_to_current_run": scope is not None, "cards_skipped_out_of_scope": skipped_out_of_scope, "created_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
