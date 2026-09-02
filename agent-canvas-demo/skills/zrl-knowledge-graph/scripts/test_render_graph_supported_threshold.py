#!/usr/bin/env python3
"""test_render_graph_supported_threshold.py

Standalone regression test for the `supported` vs `inferred` gate in
render_graph.normalize_graph(). No framework, plain assertions, PASS/FAIL
print + exit code — same convention as quote_verify.py's own __main__
self-test, since this repo's `npm run verify` only runs `tests/*.test.js`
and has no Python test runner wired in (a real, separately-tracked gap;
this file is meant to be run by hand with `python test_render_graph_
supported_threshold.py` until that gap is closed).

What this locks in: a literature-evidence edge may be `review_status:
supported` ONLY when at least one of its evidence entries carries a quote
that verify_quote() confirms appears verbatim in the cited card's text.
Carrying a source_path/locator with no quote at all — or the model simply
asserting review_status: supported — must never be sufficient on its own.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from render_graph import normalize_graph  # noqa: E402

CARD_TEXT = "SEM图像（图2a）显示S1呈现规则片状形貌，片层厚度约20 nm，边缘平整。"
CARDS = [{"source_path": "literature/downloaded-pdfs/sample.pdf", "claim_candidates": [CARD_TEXT]}]
REAL_QUOTE = "S1呈现规则片状形貌，片层厚度约20 nm"


def base_raw(evidence, review_status="supported"):
    return {
        "nodes": [
            {"id": "a", "label": "A", "type": "material"},
            {"id": "b", "label": "B", "type": "outcome"},
        ],
        "edges": [{
            "id": "e1", "source": "a", "target": "b", "relation": "correlates_with",
            "review_status": review_status, "evidence": evidence,
        }],
    }


def edge_of(graph):
    assert len(graph["edges"]) == 1, f"expected exactly one surviving edge, got {len(graph['edges'])}"
    return graph["edges"][0]


def test_locator_only_evidence_downgrades():
    raw = base_raw([{"source_path": CARDS[0]["source_path"], "locator": "Fig. 2a", "quote": ""}], review_status="supported")
    graph, warnings = normalize_graph(raw, CARDS, 0)
    e = edge_of(graph)
    assert e["review_status"] == "inferred", e
    assert any("no" in w and "quote" in w for w in warnings), warnings


def test_verified_quote_keeps_supported():
    raw = base_raw([{"source_path": CARDS[0]["source_path"], "locator": "Fig. 2a", "quote": REAL_QUOTE}], review_status="supported")
    graph, _warnings = normalize_graph(raw, CARDS, 0)
    e = edge_of(graph)
    assert e["review_status"] == "supported", e


def test_unverifiable_quote_still_downgrades():
    raw = base_raw([{"source_path": CARDS[0]["source_path"], "locator": "Fig. 2a", "quote": "this text does not appear anywhere"}], review_status="supported")
    graph, warnings = normalize_graph(raw, CARDS, 0)
    e = edge_of(graph)
    assert e["review_status"] == "inferred", e
    assert any("not found verbatim" in w for w in warnings), warnings


def test_no_evidence_is_inferred():
    raw = base_raw([], review_status="supported")
    graph, _warnings = normalize_graph(raw, CARDS, 0)
    e = edge_of(graph)
    assert e["review_status"] == "inferred", e


def test_one_bad_one_good_quote_still_supported():
    raw = base_raw([
        {"source_path": CARDS[0]["source_path"], "locator": "Fig. 2a", "quote": "not in the source"},
        {"source_path": CARDS[0]["source_path"], "locator": "Fig. 2a", "quote": REAL_QUOTE},
    ], review_status="supported")
    graph, _warnings = normalize_graph(raw, CARDS, 0)
    e = edge_of(graph)
    assert e["review_status"] == "supported", e


def test_already_inferred_locator_only_edge_has_no_spurious_warning():
    raw = base_raw([{"source_path": CARDS[0]["source_path"], "locator": "Fig. 2a", "quote": ""}], review_status="inferred")
    graph, warnings = normalize_graph(raw, CARDS, 0)
    e = edge_of(graph)
    assert e["review_status"] == "inferred", e
    # These fixtures are deliberately minimal (2 nodes, 1 edge), so the
    # unrelated "graph is sparse" warning always fires here — only assert
    # that no quote/downgrade warning was spuriously added for an edge the
    # model never claimed was supported in the first place.
    assert not any("quote" in w for w in warnings), warnings


TESTS = [
    ("locator-only evidence (no quote) claimed supported must downgrade to inferred", test_locator_only_evidence_downgrades),
    ("a verified quote keeps supported", test_verified_quote_keeps_supported),
    ("an unverifiable quote claimed supported still downgrades (pre-existing behavior, must not regress)", test_unverifiable_quote_still_downgrades),
    ("no evidence at all is inferred regardless of claimed review_status", test_no_evidence_is_inferred),
    ("one bad quote plus one verified quote on the same edge still counts as supported", test_one_bad_one_good_quote_still_supported),
    ("an edge the model already labeled inferred with locator-only evidence stays inferred with no spurious warning", test_already_inferred_locator_only_edge_has_no_spurious_warning),
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
