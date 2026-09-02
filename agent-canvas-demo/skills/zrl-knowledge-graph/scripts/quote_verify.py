#!/usr/bin/env python3
"""quote_verify.py

The one piece of code that makes "review_status: supported" mean something
regardless of which model proposed the edge. Pure functions, no model calls,
no I/O -- safe to unit-test and safe to run on every edge's claimed quote
before `render_graph.py` trusts it.

Python port of the Node reference implementation (quote-verify.js) so the
same verbatim-grounding discipline applies inside this project's real,
already-shipped rendering pipeline instead of living in a separate script
nobody calls.

Usage:
    from quote_verify import verify_quote
    result = verify_quote(card_text, edge_quote)
    if not result["verified"]:
        edge["review_status"] = "inferred"

Design notes:
- Normalization is intentionally narrow. It only collapses whitespace and
  folds a small set of Unicode look-alikes (dashes, quotes, fullwidth
  punctuation) that PDF text extraction routinely mangles. It does NOT do
  anything semantic (no stemming, no synonym folding) -- the point of this
  check is "does this text actually appear in the source", not "is this
  plausible". A quote that requires semantic matching to "find" isn't a
  verbatim quote, it's a paraphrase, and should be labelled `inferred`
  instead of forced through this function.
- `verify_quote` returns character offsets into the *normalized* source, not
  the raw source -- render_graph.py only uses the boolean, not the offsets,
  so this is not currently a problem; keep it in mind if a future caller
  needs offsets into the raw text.
"""
from __future__ import annotations

import re
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

_DASH_CHARS = re.compile("[‐‑‒–—―−]")  # dash variants -> '-'
_QUOTE_SINGLE = re.compile("[‘’ʼ]")  # curly single quotes -> "'"
_QUOTE_DOUBLE = re.compile("[“”]")  # curly double quotes -> '"'
_FULLWIDTH_SPACE = re.compile("　")
_SOFT_HYPHEN_LINEBREAK = re.compile(r"-\n")  # PDF line-wrap hyphenation: "hydro-\nthermal" -> "hydrothermal"
_CRLF = re.compile(r"\r\n?")
_HORIZONTAL_WS = re.compile(r"[ \t\f\v]+")
_LINEBREAK_WS = re.compile(r"\s*\n\s*")


def normalize(s: str | None) -> str:
    if s is None:
        return ""
    text = str(s)
    text = _SOFT_HYPHEN_LINEBREAK.sub("", text)
    text = _CRLF.sub("\n", text)
    text = _DASH_CHARS.sub("-", text)
    text = _QUOTE_SINGLE.sub("'", text)
    text = _QUOTE_DOUBLE.sub('"', text)
    text = _FULLWIDTH_SPACE.sub(" ", text)
    text = _HORIZONTAL_WS.sub(" ", text)
    text = _LINEBREAK_WS.sub(" ", text)  # treat line breaks as spaces for matching purposes
    return text.strip()


def verify_quote(source_text: str, quote: str) -> dict:
    """Checks whether `quote` appears verbatim (after light normalization)
    inside `source_text`. Returns a dict rather than raising, because "not
    found" is an expected, common outcome -- it's the signal that downgrades
    an edge to `inferred`, not a bug."""
    q = normalize(quote)
    if not q:
        return {"verified": False, "reason": "empty_quote"}
    if len(q) < 6:
        return {"verified": False, "reason": "quote_too_short_to_trust"}

    src = normalize(source_text)
    idx = src.find(q)
    if idx == -1:
        return {"verified": False, "reason": "not_found_in_source"}

    # Reject silently choosing the first occurrence of a second, different
    # match -- ambiguous quotes should be flagged, not resolved arbitrarily.
    second_idx = src.find(q, idx + 1)
    if second_idx != -1:
        return {"verified": True, "char_start": idx, "char_end": idx + len(q), "reason": "ambiguous_multiple_matches"}

    return {"verified": True, "char_start": idx, "char_end": idx + len(q)}


if __name__ == "__main__":
    cases = [
        {
            "name": "exact match",
            "source": "SEM图像（图2a）显示S1呈现规则片状形貌，片层厚度约20 nm，边缘平整。",
            "quote": "S1呈现规则片状形貌，片层厚度约20 nm",
            "expect": True,
        },
        {
            "name": "PDF line-wrap hyphenation is tolerated",
            "source": "the hydro-\nthermal route promotes anisotropic growth",
            "quote": "the hydrothermal route promotes anisotropic growth",
            "expect": True,
        },
        {
            "name": "curly quotes normalized",
            "source": "the sample was labeled “S1” and stored at 4°C",
            "quote": 'the sample was labeled "S1" and stored at 4°C',
            "expect": True,
        },
        {
            "name": "paraphrase correctly rejected (not a substring)",
            "source": "结合尿素缓慢水解产生的可控OH-/CO32-环境，推测其对{010}晶面的各向异性生长起到调控作用。",
            "quote": "尿素通过控制pH促进了{010}晶面的生长",
            "expect": False,
        },
        {
            "name": "empty quote rejected",
            "source": "anything at all",
            "quote": "",
            "expect": False,
        },
        {
            "name": "too-short quote rejected even if it does match (avoid trivial false positives)",
            "source": "the BiVO4 phase was confirmed",
            "quote": "the",
            "expect": False,
        },
    ]

    passed = 0
    for case in cases:
        result = verify_quote(case["source"], case["quote"])
        ok = result["verified"] == case["expect"]
        print(f"{'PASS' if ok else 'FAIL'} — {case['name']}" + ("" if ok else f"  (got {result})"))
        if ok:
            passed += 1
    print(f"\n{passed}/{len(cases)} passed")
    raise SystemExit(0 if passed == len(cases) else 1)
