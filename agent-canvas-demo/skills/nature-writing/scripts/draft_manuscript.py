#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# The evidence gate lives in its own Skill; load it by path rather than by
# package import because each Skill script is spawned standalone by the bridge.
GATE_SCRIPT = Path(__file__).resolve().parents[2] / "evidence-gate" / "scripts" / "evidence_gate.py"


def load_gate():
    """Fail closed: if the gate cannot be loaded, no manuscript is produced.

    A missing or broken gate must never degrade into "write anyway" -- that is
    exactly the failure mode the gate exists to prevent.
    """
    spec = importlib.util.spec_from_file_location("evidence_gate", GATE_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"evidence gate not loadable at {GATE_SCRIPT}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()

    try:
        gate = load_gate()
        verdict = gate.evaluate(root)
    except Exception as exc:  # fail closed
        print(json.dumps({
            "skill": "nature-writing",
            "status": "blocked",
            "reason": "evidence_gate_unavailable",
            "error": str(exc),
            "draft": None,
            "next_actions": ["Restore skills/evidence-gate/scripts/evidence_gate.py, then rerun."],
        }, ensure_ascii=False, indent=2))
        return 0

    if verdict["status"] == "blocked":
        report = gate.write_diagnostic(root, verdict)
        (root / "Research").mkdir(parents=True, exist_ok=True)
        (root / "Research" / "evidence-gate.json").write_text(
            json.dumps(verdict, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({
            "skill": "nature-writing",
            "status": "blocked",
            "reason": "insufficient_fulltext_evidence",
            "failed_rules": verdict["failed_rules"],
            "metrics": verdict["metrics"],
            "draft": None,
            "diagnostic_report": report,
            "next_actions": [
                "Fix the download path (see the diagnostic's failure breakdown), then rerun paper-downloader.",
                "Run nature-reader/pdf on the downloaded PDFs to build evidence cards.",
                "Rerun evidence-gate; only a pass unlocks nature-writing.",
            ],
        }, ensure_ascii=False, indent=2))
        return 0

    synth_file = root / "Research" / "deep-research-synthesis.json"
    synth = json.loads(synth_file.read_text(encoding="utf-8")) if synth_file.exists() else {}
    out = root / "Manuscript"; out.mkdir(parents=True, exist_ok=True)
    target = out / "manuscript-draft.md"
    established = synth.get("established_evidence") or []
    unknowns = synth.get("unknowns") or []
    metrics = verdict["metrics"]
    overridden = verdict["status"] == "override"
    banner = ""
    if overridden:
        banner = (
            "> **EVIDENCE-INSUFFICIENT DRAFT — NOT CITABLE.** 本稿在证据门未通过的情况下"
            f"被人工放行（理由：{verdict['override']['reason']}）。"
            "其中任何论断都不得直接进入投稿、开题或综述。\n\n"
        )
    content = f"""---
type: manuscript-draft
created_at: {datetime.now(timezone.utc).isoformat()}
claim_policy: evidence_bounded
gate_status: {verdict['status']}
citable: {'false' if overridden else 'true'}
evidence_base: {metrics['evidence_cards_direct']} full-text evidence cards from {metrics['fulltext_pdfs']} PDFs / {metrics['candidate_records']} candidates
---

# Manuscript Draft

{banner}## Working title

TODO: concise evidence-bounded title.

## Abstract

TODO: Draft after the main claim is supported by direct evidence cards.

## Introduction

Current evidence suggests the following leads:

{chr(10).join('- ' + x for x in (synth.get('indirect_leads') or [])[:8]) or '- TODO'}

## Results

Evidence-supported points:

{chr(10).join('- ' + x for x in established[:8]) or '- TODO: run nature-reader on local PDFs.'}

## Discussion

Known unknowns:

{chr(10).join('- ' + x for x in unknowns[:8]) or '- TODO'}

## Claim-strength audit

- Evidence base: {metrics['evidence_cards_direct']} direct full-text cards, {metrics['download_ratio']:.1%} of the candidate pool read.
- Do not use mechanism/kinetic/generalized/theory unless direct evidence supports it.
- Mark unsupported statements as TODO or hypothesis.
"""
    target.write_text(content, encoding="utf-8")
    print(json.dumps({
        "skill": "nature-writing",
        "status": verdict["status"],
        "draft": str(target.relative_to(root)).replace("\\", "/"),
        "metrics": metrics,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
