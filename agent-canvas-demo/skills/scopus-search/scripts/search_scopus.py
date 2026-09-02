#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

API = "https://api.elsevier.com/content/search/scopus"

def load_api_key(root):
    """Same secrets-file pattern as the other providers. Key goes in an HTTP
    header (X-ELS-APIKey), not a URL query parameter. Even with a valid key,
    Elsevier commonly requires the request to originate from a subscribing
    institution's IP range (or an added X-ELS-Insttoken) for full
    entitlements - see this skill's SKILL.md before treating an empty
    result as a broken key."""
    return resolve_secret(root, "scopus-api-key.txt")


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
                return possible_file.read_text(encoding="utf-8").strip().lstrip("\ufeff")
            except Exception:
                return raw
    return raw

def sanitize_for_scopus(query):
    """Scopus expects field-qualified queries (TITLE-ABS-KEY(...), TITLE(...),
    etc.). If the caller already wrote one (contains a Scopus field prefix),
    pass it through untouched; otherwise wrap a plain keyword string in
    TITLE-ABS-KEY() so a bare query still searches something sensible."""
    if re.search(r"\b[A-Z][A-Z-]*\(", query):
        return query
    cleaned = query.strip().replace('"', "")
    return f"TITLE-ABS-KEY({cleaned})"

def fetch(query, api_key, count=20, attempts=2, timeout=30, delay=2.0):
    params = {"query": query, "count": str(count)}
    last_error = None
    for attempt in range(attempts):
        headers = {"User-Agent": "Scholarium/0.1 (mailto:research-weaver@localhost) scopus-search", "Accept": "application/json"}
        if api_key:
            headers["X-ELS-APIKey"] = api_key
        req = Request(f"{API}?{urlencode(params)}", headers=headers)
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8")), None
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")[:500]
            except Exception:
                pass
            hint = ""
            if e.code in (401, 403):
                hint = " (401/403 from Scopus very often means: valid key, but this network is outside your institution's registered IP range - see SKILL.md)"
            last_error = f"HTTP {e.code} from Scopus: {body or e.reason}{hint}"
            if e.code == 429 and attempt + 1 < attempts:
                time.sleep(delay * 2)
                continue
        except URLError as e:
            last_error = f"could not reach Scopus: {e.reason}"
        except Exception as e:
            last_error = f"unexpected error calling Scopus: {e}"
        if attempt + 1 < attempts:
            time.sleep(delay)
    return None, last_error

def year_from_cover_date(cover_date):
    match = re.search(r"^\d{4}", cover_date or "")
    return int(match.group(0)) if match else None

def landing_url(entry):
    for link in entry.get("link", []) or []:
        if link.get("@ref") == "scopus":
            return link.get("@href")
    return entry.get("prism:url")

def normalize(entry):
    doi = entry.get("prism:doi")
    return {
        "provider": "Scopus",
        "eid": entry.get("eid"),
        "doi": doi,
        "title": entry.get("dc:title"),
        "year": year_from_cover_date(entry.get("prism:coverDate")),
        "venue": entry.get("prism:publicationName"),
        "cited_by_count": int(entry["citedby-count"]) if str(entry.get("citedby-count", "")).isdigit() else None,
        "is_oa": entry.get("openaccessFlag") if "openaccessFlag" in entry else None,
        "oa_status": None,
        "pdf_url": None,
        "landing_page_url": landing_url(entry) or (f"https://doi.org/{doi}" if doi else None),
        "abstract": None,
        "evidence_status": "metadata_only",
        "limitations_note": "Scopus search results do not include abstracts or PDF links by default; a separate Abstract Retrieval API call would be needed."
    }

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    query = load_query(sys.argv)
    if not query:
        print(json.dumps({"error": "query required"}, ensure_ascii=False)); return 2
    api_key = load_api_key(root)
    sanitized = sanitize_for_scopus(query)

    payload, error = fetch(sanitized, api_key)
    if error:
        if not api_key:
            error += " — no Scopus API key configured; register one at dev.elsevier.com and save it to Scholarium/secrets/scopus-api-key.txt."
        print(json.dumps({
            "provider": "Scopus", "skill": "scopus-search", "query": query,
            "query_sent_to_scopus": sanitized, "api_key_used": bool(api_key),
            "run_at": datetime.now(timezone.utc).isoformat(), "result_count_reported": None,
            "records": [], "error": error,
            "limitations": ["Scopus request failed after retry; see error field", "no records retrieved this run"]
        }, ensure_ascii=False, indent=2))
        return 0

    results = payload.get("search-results", {})
    entries = [e for e in results.get("entry", []) if "dc:title" in e]  # entries with only an error field lack dc:title
    records = [normalize(e) for e in entries]
    print(json.dumps({
        "provider": "Scopus", "skill": "scopus-search", "query": query,
        "query_sent_to_scopus": sanitized, "api_key_used": bool(api_key),
        "run_at": datetime.now(timezone.utc).isoformat(),
        "result_count_reported": results.get("opensearch:totalResults"), "records": records,
        "limitations": ["metadata search only, no abstracts", "full results typically require an institutional IP range - see SKILL.md"]
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
