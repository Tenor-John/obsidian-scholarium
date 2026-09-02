#!/usr/bin/env python3
"""test_render_graph_dry_run_and_versioned_output.py

Standalone regression test for the two additive render_graph.py changes:
dry-run mode (no disk writes, full normalized graph on stdout) and an
optional versioned output subdirectory. Same convention as this skill's
other standalone self-tests (quote_verify.py's __main__, and
test_render_graph_supported_threshold.py) since `npm run verify` only runs
`tests/*.test.js` and has no Python test runner wired in.

What this locks in:
- payload["dry_run"]=true (or the "--dry-run" CLI flag) must not create or
  modify knowledge-graph/ at all, and must print the full normalized graph
  (not just a summary) so a review UI can show real review_status/warnings
  before anything is published.
- payload["output_subdir"] must redirect the write there and must NOT touch
  the default knowledge-graph/ location -- this is what lets a versioned
  publish coexist with whatever the current canonical graph already is.
- Omitting output_subdir entirely must behave exactly as before this change
  (default single-canonical-file location), so existing callers (the P1-P2
  pipeline's step 9) are unaffected.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "render_graph.py"

MINIMAL_GRAPH = {
    "graph": {
        "title": "dry-run test",
        "nodes": [
            {"id": "a", "label": "A", "type": "material"},
            {"id": "b", "label": "B", "type": "outcome"},
        ],
        "edges": [{"source": "a", "target": "b", "relation": "correlates_with", "review_status": "inferred", "evidence": []}],
        "warnings": [],
    },
}


def run(root: Path, payload: dict, extra_args: list[str] | None = None) -> subprocess.CompletedProcess:
    args = [sys.executable, str(SCRIPT), str(root), json.dumps(payload)] + (extra_args or [])
    return subprocess.run(args, capture_output=True, text=True, timeout=30)


def test_dry_run_writes_nothing_and_prints_full_graph():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        result = run(root, {**MINIMAL_GRAPH, "dry_run": True})
        assert result.returncode == 0, result.stderr
        out = json.loads(result.stdout)
        assert out["dry_run"] is True, out
        assert out["graph"]["nodes"], "dry-run output must include the full normalized graph, not just a summary"
        assert len(out["graph"]["nodes"]) == 2
        assert not (root / "knowledge-graph").exists(), "dry-run must not create knowledge-graph/ at all"


def test_dry_run_cli_flag_is_equivalent_to_payload_flag():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        result = run(root, MINIMAL_GRAPH, extra_args=["--dry-run"])
        assert result.returncode == 0, result.stderr
        out = json.loads(result.stdout)
        assert out["dry_run"] is True, out
        assert not (root / "knowledge-graph").exists()


def test_omitting_output_subdir_preserves_the_exact_default_location():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        result = run(root, MINIMAL_GRAPH)
        assert result.returncode == 0, result.stderr
        assert (root / "knowledge-graph" / "knowledge_graph.json").exists()
        assert (root / "knowledge-graph" / "knowledge_graph.html").exists()
        assert (root / "knowledge-graph" / "knowledge_graph-report.md").exists()


def test_output_subdir_redirects_the_write_without_touching_the_default_location():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        default_dir = root / "knowledge-graph"
        default_dir.mkdir()
        canary = default_dir / "knowledge_graph.json"
        canary.write_text('{"canary": true}', encoding="utf-8")

        result = run(root, {**MINIMAL_GRAPH, "output_subdir": "knowledge-graph/runs/run-123"})
        assert result.returncode == 0, result.stderr

        versioned = root / "knowledge-graph" / "runs" / "run-123"
        assert (versioned / "knowledge_graph.json").exists()
        assert (versioned / "knowledge_graph.html").exists()
        assert (versioned / "knowledge_graph-report.md").exists()

        # the pre-existing canonical file must survive byte-for-byte
        assert canary.read_text(encoding="utf-8") == '{"canary": true}', \
            "output_subdir must never touch the default knowledge-graph/ location"


TESTS = [
    ("dry-run writes nothing and prints the full normalized graph", test_dry_run_writes_nothing_and_prints_full_graph),
    ("--dry-run CLI flag is equivalent to payload.dry_run", test_dry_run_cli_flag_is_equivalent_to_payload_flag),
    ("omitting output_subdir preserves the exact default location", test_omitting_output_subdir_preserves_the_exact_default_location),
    ("output_subdir redirects the write without touching the default location", test_output_subdir_redirects_the_write_without_touching_the_default_location),
]

passed = 0
for name, fn in TESTS:
    try:
        fn()
        print(f"PASS — {name}")
        passed += 1
    except AssertionError as exc:
        print(f"FAIL — {name}\n       {exc}")
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR — {name}\n       {type(exc).__name__}: {exc}")

print(f"\n{passed}/{len(TESTS)} passed")
raise SystemExit(0 if passed == len(TESTS) else 1)
