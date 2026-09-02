#!/usr/bin/env python3
"""Read-only OpenAlex discovery with an audit-friendly compact result schema."""
from __future__ import annotations

import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError


def sanitize_for_openalex(query):
    """Make a WoS/Scopus-style Boolean draft acceptable to OpenAlex.

    See search_openalex.py for the measurements. OpenAlex ``search`` does honour
    AND/OR/NOT and parentheses and only rejects wildcards (HTTP 400); the term
    bag this used to send is ANDed rather than ranked, which collapses recall.
    """
    return re.sub(r"\s{2,}", " ", re.sub(r"[*?]", "", query)).strip()


def term_bag_for_openalex(query):
    """Low-recall fallback, retried only if the Boolean form gets a 5xx."""
    phrases = re.findall(r'"([^"]+)"', query)
    without_phrases = re.sub(r'"[^"]+"', " ", query)
    without_boolean = re.sub(r"\b(?:AND|OR|NOT)\b", " ", without_phrases, flags=re.I)
    without_boolean = re.sub(r"[*?()]", " ", without_boolean)
    raw_terms = phrases + re.split(r"[\s,;]+", without_boolean)
    seen = set()
    terms = []
    for term in raw_terms:
        # See search_openalex.py: quoted phrases bypass the [*?()] scrub above,
        # so a wildcard inside quotes reaches OpenAlex and 400s the request.
        cleaned = re.sub(r"\s+", " ", re.sub(r"[*?]", " ", term).strip(" '\"\t\r\n")).strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        terms.append(cleaned)
    return " ".join(terms)


def load_api_key(root):
    """See nature-academic-search's load_api_key: OpenAlex requires a free API
    key since Feb 2026; without one you're in a near-empty anonymous pool."""
    return resolve_secret(root, "openalex-api-key.txt")


def resolve_secret(root, filename):
    """Look for the key under root, then walk up to the vault root.

    Creating a new research topic repoints the workspace at a subfolder
    (.../Research_mod/<topic>/), and Scholarium/secrets/ does not move with it.
    Every key then reads as absent and the step reports "no API key configured"
    while the file sits one directory up. Keys are per-researcher, not
    per-topic, so a parent copy is the right thing to inherit.
    """
    for base in [Path(root), *Path(root).parents][:6]:
        candidate = base / "Scholarium" / "secrets" / filename
        if candidate.exists():
            try:
                return candidate.read_text(encoding="utf-8").strip().lstrip("\ufeff")
            except Exception:
                return ""
    return ""

def load_query(argv):
    raw = (argv[2] if len(argv) > 2 else "").strip()
    if raw:
        possible_file = Path(raw)
        if possible_file.exists() and possible_file.is_file():
            try:
                return possible_file.read_text(encoding="utf-8").strip()
            except Exception:
                return raw
    return raw

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def fetch_openalex(params, attempts=2, timeout=25, delay=1.5):
    last_error = None
    bypass_proxy = False
    for attempt in range(attempts):
        request = Request(
            f"https://api.openalex.org/works?{params}",
            headers={"User-Agent": "Research-Weaver/0.1 (mailto:research-weaver@localhost) literature-discovery"}
        )
        try:
            opener = build_opener(ProxyHandler({})) if bypass_proxy else build_opener()
            with opener.open(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8")), None
        except HTTPError as error:
            body = ""
            try:
                body = error.read().decode("utf-8", errors="ignore")[:400]
            except Exception:
                pass
            last_error = f"HTTP {error.code} from OpenAlex: {body or error.reason}"
            # See nature-academic-search's fetch_openalex: a billing-shaped 429
            # (costUsd/creditsRequired) is not something OpenAlex's real API
            # returns - it's a local proxy/VPN metering traffic. Bypass once.
            if not bypass_proxy and ("costUsd" in body or "creditsRequired" in body):
                bypass_proxy = True
                continue
        except URLError as error:
            last_error = f"could not reach OpenAlex: {error.reason}"
        except Exception as error:
            last_error = f"unexpected error calling OpenAlex: {error}"
        if attempt + 1 < attempts:
            time.sleep(delay)
    if bypass_proxy and last_error:
        last_error += " (already retried bypassing local proxy/VPN settings)"
    return None, last_error


def abstract_from_index(inverted):
    if not isinstance(inverted, dict):
        return None
    positions = []
    for word, indexes in inverted.items():
        for index in indexes or []:
            positions.append((index, word))
    return " ".join(word for _, word in sorted(positions)) if positions else None


def author_names(work, limit=3):
    """A card needs to answer "whose work is this" at a glance; the full
    authorship list would bury that, so keep the leading names and a count."""
    names = [(entry.get("author") or {}).get("display_name") for entry in (work.get("authorships") or [])]
    names = [name for name in names if name]
    if not names:
        return "", 0
    shown = ", ".join(names[:limit])
    return (f"{shown} 等" if len(names) > limit else shown), len(names)


def normalize(work):
    location = work.get("best_oa_location") or {}
    primary = work.get("primary_location") or {}
    source = primary.get("source") or location.get("source") or {}
    doi = work.get("doi") or ""
    authors, author_count = author_names(work)
    return {
        "openalex_id": work.get("id"),
        "doi": doi,
        "title": work.get("display_name"),
        "authors": authors,
        "author_count": author_count,
        "venue": source.get("display_name"),
        "year": work.get("publication_year"),
        "type": work.get("type"),
        "cited_by_count": work.get("cited_by_count"),
        "is_oa": bool((work.get("open_access") or {}).get("is_oa")),
        "oa_status": (work.get("open_access") or {}).get("oa_status"),
        "pdf_url": location.get("pdf_url"),
        "landing_page_url": location.get("landing_page_url") or work.get("doi"),
        "abstract": abstract_from_index(work.get("abstract_inverted_index")),
        "fulltext_status": "candidate_open_file" if location.get("pdf_url") else "metadata_only"
    }


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    query = load_query(sys.argv)
    if not query:
        print(json.dumps({"error": "query is required"}, ensure_ascii=False))
        return 2
    api_key = load_api_key(root)

    def run(search_string):
        param_dict = {"search": search_string, "per-page": "20"}
        if api_key:
            param_dict["api_key"] = api_key
        return fetch_openalex(urlencode(param_dict))

    sanitized = sanitize_for_openalex(query)
    payload, error = run(sanitized)
    if error:
        fallback = term_bag_for_openalex(query)
        if fallback and fallback != sanitized and "HTTP 5" in error:
            retry_payload, retry_error = run(fallback)
            if not retry_error:
                payload, error = retry_payload, None
    if error:
        if not api_key:
            error += " — no OpenAlex API key configured; OpenAlex requires one since Feb 2026 and the anonymous demo pool is tiny. Get a free key at openalex.org/settings/api and save it to Scholarium/secrets/openalex-api-key.txt."
        print(json.dumps({
            "provider": "OpenAlex",
            "run_at": datetime.now(timezone.utc).isoformat(),
            "query": query,
            "result_count_returned": 0,
            "result_count_reported": None,
            "records": [],
            "api_key_used": bool(api_key),
            "error": f"OpenAlex search failed after retry: {error}",
            "limitations": ["OpenAlex request failed; see error field", "no records retrieved this run"]
        }, ensure_ascii=False, indent=2))
        return 0
    works = [normalize(work) for work in payload.get("results", [])]
    result = {
        "provider": "OpenAlex",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "query": query,
        "api_key_used": bool(api_key),
        "result_count_returned": len(works),
        "result_count_reported": (payload.get("meta") or {}).get("count"),
        "records": works,
        "limitations": [
            "Search is a metadata discovery step, not a systematic-database search.",
            "Records without a downloaded full text remain metadata-only and cannot support detailed scientific claims.",
            "Only explicitly open PDF candidates may be requested for download after user confirmation."
        ]
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
