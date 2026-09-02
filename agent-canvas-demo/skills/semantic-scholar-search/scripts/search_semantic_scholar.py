#!/usr/bin/env python3
from __future__ import annotations
import json, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

API = "https://api.semanticscholar.org/graph/v1/paper/search"
FIELDS = "title,year,venue,externalIds,abstract,citationCount,isOpenAccess,openAccessPdf"

def load_api_key(root):
    """Same secrets-file pattern as OpenAlex/PubMed. Unlike those two, this
    key must go in an HTTP header (x-api-key), not a URL query parameter -
    Semantic Scholar's search endpoint does not authenticate a key passed as
    ?x-api-key=... Without a key: ~1 req/s. With a key: up to ~100 req/s,
    though newly issued keys start throttled at 1 req/s until the account
    is established (per Semantic Scholar's own release notes)."""
    return resolve_secret(root, "semantic-scholar-api-key.txt")


def resolve_secret(root, filename):
    """Look for the key under root, then walk up to the vault root.

    Creating a new research topic repoints the workspace at a subfolder
    (\u2026/Research_mod/\u65b0\u5efa\u7814\u7a76\u4e3b\u9898/), and Scholarium/secrets/ does not move with
    it. Every key then reads as absent and the step reports "no API key
    configured" while the file sits one directory up. Keys are per-researcher,
    not per-topic, so a parent copy is the right thing to inherit.
    """
    seen = []
    for base in [Path(root), *Path(root).parents][:6]:
        candidate = base / "Scholarium" / "secrets" / filename
        seen.append(candidate)
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
                return possible_file.read_text(encoding="utf-8").strip().lstrip("\ufeff")
            except Exception:
                return raw
    return raw

def fetch(query, api_key, limit=20, attempts=4, timeout=30, delay=2.0):
    params = {"query": query, "limit": str(limit), "fields": FIELDS}
    last_error = None
    for attempt in range(attempts):
        headers = {"User-Agent": "Scholarium/0.1 (mailto:research-weaver@localhost) semantic-scholar-search"}
        if api_key:
            headers["x-api-key"] = api_key
        req = Request(f"{API}?{urlencode(params)}", headers=headers)
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8")), None
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")[:400]
            except Exception:
                pass
            last_error = f"HTTP {e.code} from Semantic Scholar: {body or e.reason}"
            if e.code == 429 and attempt + 1 < attempts:
                # The personal-key pool is ~1 req/s and the Pipeline fires all
                # sources at once, so one short sleep is not enough. Honour
                # Retry-After when present, else back off 5s/15s/45s.
                retry_after = e.headers.get("Retry-After") if e.headers else None
                try:
                    wait = float(retry_after) if retry_after else None
                except (TypeError, ValueError):
                    wait = None
                if wait is None:
                    wait = [5, 15, 45][min(attempt, 2)]
                time.sleep(wait)
                continue
        except URLError as e:
            last_error = f"could not reach Semantic Scholar: {e.reason}"
        except Exception as e:
            last_error = f"unexpected error calling Semantic Scholar: {e}"
        if attempt + 1 < attempts:
            time.sleep(delay)
    return None, last_error

def normalize(paper):
    external = paper.get("externalIds") or {}
    oa = paper.get("openAccessPdf") or {}
    paper_id = paper.get("paperId")
    return {
        "provider": "Semantic Scholar",
        "semantic_scholar_id": paper_id,
        "doi": external.get("DOI"),
        "title": paper.get("title"),
        "year": paper.get("year"),
        "venue": paper.get("venue"),
        "cited_by_count": paper.get("citationCount"),
        "is_oa": paper.get("isOpenAccess"),
        "oa_status": "oa" if paper.get("isOpenAccess") else "closed",
        "pdf_url": oa.get("url"),
        "landing_page_url": f"https://www.semanticscholar.org/paper/{paper_id}" if paper_id else None,
        "abstract": paper.get("abstract"),
        "evidence_status": "metadata_only"
    }

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    query = load_query(sys.argv)
    if not query:
        print(json.dumps({"error": "query required"}, ensure_ascii=False)); return 2
    api_key = load_api_key(root)

    payload, error = fetch(query, api_key)
    if error:
        if not api_key:
            error += " — no Semantic Scholar API key configured; request one at semanticscholar.org/product/api and save it to Scholarium/secrets/semantic-scholar-api-key.txt. Unauthenticated requests are limited to ~1 req/s and are more likely to 429."
        print(json.dumps({
            "provider": "Semantic Scholar", "skill": "semantic-scholar-search", "query": query,
            "api_key_used": bool(api_key), "run_at": datetime.now(timezone.utc).isoformat(),
            "result_count_reported": None, "records": [], "error": error,
            "limitations": ["Semantic Scholar request failed after retry; see error field", "no records retrieved this run"]
        }, ensure_ascii=False, indent=2))
        return 0

    records = [normalize(p) for p in payload.get("data", [])]
    print(json.dumps({
        "provider": "Semantic Scholar", "skill": "semantic-scholar-search", "query": query,
        "api_key_used": bool(api_key), "run_at": datetime.now(timezone.utc).isoformat(),
        "result_count_reported": payload.get("total"), "records": records,
        "limitations": ["metadata search only", "openAccessPdf covers only a subset of records; not full-text coverage"]
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
