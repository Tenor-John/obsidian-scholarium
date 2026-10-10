#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

def load_api_key(root):
    """OpenAlex requires a free API key as of Feb 2026 (openalex.org/settings/api);
    without one, requests fall into a tiny shared anonymous pool that is
    exhausted almost instantly - that's the "Insufficient budget" 429 this
    project kept hitting. Same secrets-file pattern as the WebVPN cookie: never
    hardcoded, never committed, just a local text file the researcher drops
    their own free key into."""
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
                return possible_file.read_text(encoding="utf-8").strip().lstrip("\ufeff")
            except Exception:
                return raw
    return raw

def sanitize_for_openalex(query):
    """Make a WoS/Scopus-style Boolean draft acceptable to OpenAlex.

    OpenAlex's ``search`` parameter *does* honour AND/OR/NOT and parentheses.
    The only thing it rejects outright is a wildcard: ``*`` or ``?`` returns
    HTTP 400 ("Wildcards require exact (no-stem) search"), and specifically so
    inside a quoted phrase. So the Boolean structure is preserved and only the
    wildcards are dropped — ``photocatal*`` becomes ``photocatal``, which still
    stems to the same family.

    Measured on two real Pipeline topics (per-page=3, meta.count):

        strategy                          Au/CO2RR    BiVO4/urea
        Boolean, wildcards stripped           7095           854
        de-duplicated term bag                   0            69

    The term bag lost because OpenAlex ANDs every term in a bare search string
    rather than ranking them, so a 16-term bag matches almost nothing. It is
    kept only as ``term_bag_for_openalex`` below, for retry after a 5xx.
    """
    return re.sub(r"\s{2,}", " ", re.sub(r"[*?]", "", query)).strip()


def term_bag_for_openalex(query):
    """Fallback: de-duplicated phrase/term bag, no Boolean syntax.

    Much lower recall (see the table above), but it is structurally simple, so
    it is worth one retry if OpenAlex 5xxs on the Boolean form.
    """
    phrases = re.findall(r'"([^"]+)"', query)
    without_phrases = re.sub(r'"[^"]+"', " ", query)
    without_boolean = re.sub(r"\b(?:AND|OR|NOT)\b", " ", without_phrases, flags=re.I)
    without_boolean = re.sub(r"[*?()]", " ", without_boolean)
    raw_terms = phrases + re.split(r"[\s,;]+", without_boolean)
    seen = set()
    terms = []
    for term in raw_terms:
        # Strip wildcards here, not only from the unquoted remainder above:
        # phrases are pulled out verbatim by the findall on line 1 of this
        # function, so a quoted term like "gold nanoparticle*" kept its asterisk
        # and OpenAlex rejected the whole request with HTTP 400 ("Wildcards
        # require exact (no-stem) search"), taking out both search steps at once.
        cleaned = re.sub(r"\s+", " ", re.sub(r"[*?]", " ", term).strip(" '\"\t\r\n")).strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        terms.append(cleaned)
    return " ".join(terms)

def fetch_openalex(params, attempts=2, timeout=30, delay=1.5):
    """Never let a transient network/HTTP error crash the whole pipeline step.
    Returns (payload, None) on success or (None, error_message) on failure after
    retrying once; the caller turns a failure into a valid, honestly-labeled
    zero-record manifest instead of an unhandled traceback."""
    last_error = None
    bypass_proxy = False
    for attempt in range(attempts):
        req = Request(
            f"https://api.openalex.org/works?{params}",
            headers={"User-Agent": "Scholarium/0.1 (mailto:research-weaver@localhost) academic-search"}
        )
        try:
            opener = build_opener(ProxyHandler({})) if bypass_proxy else build_opener()
            with opener.open(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8")), None
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")[:400]
            except Exception:
                pass
            last_error = f"HTTP {e.code} from OpenAlex: {body or e.reason}"
            # OpenAlex's real public API never returns per-request billing fields
            # like costUsd/creditsRequired - that shape is a signature of a local
            # system/VPN proxy metering "international" traffic, not OpenAlex
            # itself. If we see it, retry once bypassing any configured proxy
            # (env vars or Windows system proxy) instead of just waiting it out.
            if not bypass_proxy and ("costUsd" in body or "creditsRequired" in body):
                bypass_proxy = True
                continue
        except URLError as e:
            last_error = f"could not reach OpenAlex: {e.reason}"
        except Exception as e:
            last_error = f"unexpected error calling OpenAlex: {e}"
        if attempt + 1 < attempts:
            time.sleep(delay)
    if bypass_proxy and last_error:
        last_error += " (already retried bypassing local proxy/VPN settings)"
    return None, last_error

def abstract_from_index(inv):
    if not isinstance(inv, dict): return None
    parts = []
    for word, indexes in inv.items():
        for idx in indexes or []: parts.append((idx, word))
    return " ".join(word for _, word in sorted(parts)) if parts else None

def normalize(work):
    loc = work.get("best_oa_location") or {}
    primary = work.get("primary_location") or {}
    source = (primary.get("source") or loc.get("source") or {})
    return {
        "provider": "OpenAlex",
        "openalex_id": work.get("id"),
        "doi": work.get("doi"),
        "title": work.get("display_name"),
        "year": work.get("publication_year"),
        "venue": source.get("display_name"),
        "venue_issn_l": source.get("issn_l"),
        "venue_issns": source.get("issn") or [],
        "cited_by_count": work.get("cited_by_count"),
        "is_oa": bool((work.get("open_access") or {}).get("is_oa")),
        "oa_status": (work.get("open_access") or {}).get("oa_status"),
        "pdf_url": loc.get("pdf_url"),
        "landing_page_url": loc.get("landing_page_url") or work.get("doi"),
        "abstract": abstract_from_index(work.get("abstract_inverted_index")),
        "evidence_status": "metadata_only"
    }

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    query = load_query(sys.argv)
    if not query.strip():
        print(json.dumps({"error": "query required"}, ensure_ascii=False)); return 2
    query = query.strip()
    api_key = load_api_key(root)

    def run(search_string):
        # Sort by relevance, not citations. A refined Pipeline query is a wide
        # OR net (thousands of hits); cited_by_count:desc then floats generic
        # high-cited reviews to the top and buries the on-topic recent
        # experiments the query was built to find. Measured on the Au@CeO2
        # shell-thickness topic (2026-08-20): same query, cited_by_count gave
        # agri-food/wastewater reviews in the top 10; relevance gave the
        # hot-carrier / water-splitting papers the query targeted.
        param_dict = {"search": search_string, "per-page": "50", "sort": "relevance_score:desc"}
        if api_key:
            param_dict["api_key"] = api_key
        return fetch_openalex(urlencode(param_dict))

    sanitized = sanitize_for_openalex(query)
    payload, error = run(sanitized)
    if error:
        # Retry once on the low-recall term bag. Only worth it for a server-side
        # failure on the Boolean form; a 400 means the query itself is malformed
        # and the bag would not fix it.
        fallback = term_bag_for_openalex(query)
        if fallback and fallback != sanitized and "HTTP 5" in error:
            retry_payload, retry_error = run(fallback)
            if not retry_error:
                payload, error, sanitized = retry_payload, None, fallback
    if error:
        if not api_key:
            error += " — no OpenAlex API key configured; OpenAlex requires one since Feb 2026 and the anonymous demo pool is tiny. Get a free key at openalex.org/settings/api and save it to Scholarium/secrets/openalex-api-key.txt."
        print(json.dumps({
            "provider": "OpenAlex",
            "skill": "nature-academic-search",
            "query": query,
            "query_sent_to_openalex": sanitized,
            "api_key_used": bool(api_key),
            "run_at": datetime.now(timezone.utc).isoformat(),
            "result_count_reported": None,
            "records": [],
            "error": error,
            "limitations": ["OpenAlex request failed after retry; see error field", "no records retrieved this run"]
        }, ensure_ascii=False, indent=2))
        return 0
    records = [normalize(w) for w in payload.get("results", [])]
    print(json.dumps({
        "provider": "OpenAlex",
        "skill": "nature-academic-search",
        "query": query,
        "query_sent_to_openalex": sanitized,
        "api_key_used": bool(api_key),
        "run_at": datetime.now(timezone.utc).isoformat(),
        "result_count_reported": (payload.get("meta") or {}).get("count"),
        "records": records,
        "limitations": ["metadata search only", "full-text reading required before evidence claims"]
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
