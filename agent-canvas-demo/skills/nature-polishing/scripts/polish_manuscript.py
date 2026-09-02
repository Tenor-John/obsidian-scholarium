#!/usr/bin/env python3
from __future__ import annotations
import importlib.util, json, re, sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

GATE_SCRIPT = Path(__file__).resolve().parents[2] / "evidence-gate" / "scripts" / "evidence_gate.py"

STRONG_TO_WEAK = {
    "prove": "suggest",
    "proves": "suggests",
    "demonstrate": "show",
    "demonstrates": "shows",
    "theory": "framework",
    "universal": "potentially general",
    "mechanism": "possible mechanism"
}


def load_gate():
    """Fail closed -- polishing an evidence-thin draft only makes it more
    convincing, which is the opposite of what this pipeline should do."""
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
    except Exception as exc:
        print(json.dumps({
            "skill": "nature-polishing",
            "status": "blocked",
            "reason": "evidence_gate_unavailable",
            "error": str(exc),
            "output": None,
        }, ensure_ascii=False, indent=2))
        return 0

    if verdict["status"] == "blocked":
        report = gate.write_diagnostic(root, verdict)
        print(json.dumps({
            "skill": "nature-polishing",
            "status": "blocked",
            "reason": "insufficient_fulltext_evidence",
            "failed_rules": verdict["failed_rules"],
            "metrics": verdict["metrics"],
            "output": None,
            "diagnostic_report": report,
        }, ensure_ascii=False, indent=2))
        return 0

    src = root / "Manuscript" / "manuscript-draft.md"
    if not src.exists():
        print(json.dumps({"error": "Manuscript/manuscript-draft.md not found"}, ensure_ascii=False)); return 2
    text = src.read_text(encoding="utf-8")
    changes = []
    polished = text
    for strong, weak in STRONG_TO_WEAK.items():
        pattern = re.compile(rf"\b{re.escape(strong)}\b", re.I)
        if pattern.search(polished):
            polished = pattern.sub(weak, polished)
            changes.append({"from": strong, "to": weak, "reason": "claim-strength downgrade unless direct evidence is explicit"})
    target = root / "Manuscript" / "manuscript-polished.md"
    target.write_text(polished + f"\n\n<!-- polished_at: {datetime.now(timezone.utc).isoformat()} gate_status: {verdict['status']} -->\n", encoding="utf-8")
    print(json.dumps({
        "skill": "nature-polishing",
        "status": verdict["status"],
        "source": str(src.relative_to(root)).replace("\\", "/"),
        "output": str(target.relative_to(root)).replace("\\", "/"),
        "metrics": verdict["metrics"],
        "claim_strength_changes": changes,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
