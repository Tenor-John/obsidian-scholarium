#!/usr/bin/env python3
from __future__ import annotations
import json, re, sys, time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, build_opener, ProxyHandler
from urllib.error import HTTPError, URLError

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
CONTACT = {"tool": "ResearchWeaver", "email": "research-weaver@localhost"}

def load_api_key(root):
    """Same secrets-file pattern as OpenAlex/WebVPN: never hardcoded, never
    committed. NCBI E-utils allows 3 requests/second without a key, 10/second
    with one (one key per NCBI account; issuing a new key retires the old
    one immediately - see Scholarium/secrets/README.md)."""
    return resolve_secret(root, "pubmed-api-key.txt")


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

def http_get(url, params, attempts=2, timeout=30, delay=1.5):
    """Non-crashing retry, mirrors the OpenAlex fetch helpers: a transient
    network/HTTP error degrades to a labeled failure instead of a traceback."""
    last_error = None
    for attempt in range(attempts):
        req = Request(f"{url}?{urlencode(params)}", headers={"User-Agent": "Scholarium/0.1 (mailto:research-weaver@localhost) pubmed-search"})
        try:
            opener = build_opener(ProxyHandler({}))
            with opener.open(req, timeout=timeout) as r:
                return r.read(), None
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")[:400]
            except Exception:
                pass
            last_error = f"HTTP {e.code} from NCBI: {body or e.reason}"
        except URLError as e:
            last_error = f"could not reach NCBI: {e.reason}"
        except Exception as e:
            last_error = f"unexpected error calling NCBI: {e}"
        if attempt + 1 < attempts:
            time.sleep(delay)
    return None, last_error

def is_invalid_key_error(error):
    """NCBI rejects a bad key with HTTP 400 'API key status invalid'.

    A wrong key is strictly worse than no key: unauthenticated E-utilities still
    serve requests at ~3/s, but a bad one 400s every call and zeroes the whole
    step. A stale key sat in secrets/ for three runs producing 0 PubMed hits
    while the same query returned 1604 without any key at all.
    """
    return bool(error) and "400" in error and "api" in error.lower() and "invalid" in error.lower()


def esearch(query, api_key, retmax=20):
    params = {"db": "pubmed", "term": query, "retmode": "json", "retmax": str(retmax), "sort": "relevance", **CONTACT}
    if api_key:
        params["api_key"] = api_key
    body, error = http_get(f"{EUTILS}/esearch.fcgi", params)
    if error and api_key and is_invalid_key_error(error):
        params.pop("api_key", None)
        body, retry_error = http_get(f"{EUTILS}/esearch.fcgi", params)
        if not retry_error:
            error = None
            globals()["_KEY_REJECTED"] = True
    if error:
        return [], None, error
    try:
        payload = json.loads(body.decode("utf-8"))
        result = payload.get("esearchresult", {})
        return result.get("idlist", []), result.get("count"), None
    except Exception as e:
        return [], None, f"could not parse esearch response: {e}"

def esummary(pmids, api_key):
    if not pmids:
        return {}, None
    params = {"db": "pubmed", "id": ",".join(pmids), "retmode": "json", **CONTACT}
    if api_key:
        params["api_key"] = api_key
    body, error = http_get(f"{EUTILS}/esummary.fcgi", params)
    if error:
        return {}, error
    try:
        payload = json.loads(body.decode("utf-8"))
        return payload.get("result", {}), None
    except Exception as e:
        return {}, f"could not parse esummary response: {e}"

def efetch_abstracts(pmids, api_key):
    """Best-effort only: if this fails, records still come back from
    esummary with abstract=None rather than losing the whole search."""
    if not pmids:
        return {}
    params = {"db": "pubmed", "id": ",".join(pmids), "rettype": "abstract", "retmode": "xml", **CONTACT}
    if api_key:
        params["api_key"] = api_key
    body, error = http_get(f"{EUTILS}/efetch.fcgi", params)
    if error or not body:
        return {}
    abstracts = {}
    try:
        root = ET.fromstring(body)
        for article in root.iter("PubmedArticle"):
            pmid_el = article.find(".//MedlineCitation/PMID")
            if pmid_el is None or not pmid_el.text:
                continue
            parts = []
            for ab in article.findall(".//Abstract/AbstractText"):
                label = ab.get("Label")
                text = "".join(ab.itertext()).strip()
                if not text:
                    continue
                parts.append(f"{label}: {text}" if label else text)
            if parts:
                abstracts[pmid_el.text] = " ".join(parts)
    except Exception:
        return {}
    return abstracts

def year_from_pubdate(pubdate):
    match = re.search(r"\d{4}", pubdate or "")
    return int(match.group(0)) if match else None

def doi_from_articleids(articleids):
    for item in articleids or []:
        if item.get("idtype") == "doi":
            return item.get("value")
    return None

def normalize(pmid, summary, abstract):
    return {
        "provider": "PubMed",
        "pmid": pmid,
        "doi": doi_from_articleids(summary.get("articleids")),
        "title": summary.get("title"),
        "year": year_from_pubdate(summary.get("pubdate")),
        "venue": summary.get("fulljournalname"),
        "cited_by_count": None,
        "is_oa": None,
        "oa_status": None,
        "pdf_url": None,
        "landing_page_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "abstract": abstract,
        "evidence_status": "metadata_only",
        "limitations_note": "PubMed itself never serves full text; check PMC separately for an OA copy."
    }

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    query = load_query(sys.argv)
    if not query:
        print(json.dumps({"error": "query required"}, ensure_ascii=False)); return 2
    api_key = load_api_key(root)

    pmids, count, error = esearch(query, api_key)
    if error:
        if not api_key:
            error += " — no PubMed API key configured; get a free one at ncbi.nlm.nih.gov/account/settings (API Key Management) and save it to Scholarium/secrets/pubmed-api-key.txt."
        print(json.dumps({
            "provider": "PubMed", "skill": "pubmed-search", "query": query,
            "api_key_used": bool(api_key), "run_at": datetime.now(timezone.utc).isoformat(),
            "result_count_reported": None, "records": [], "error": error,
            "limitations": ["esearch request failed after retry; see error field", "no records retrieved this run"]
        }, ensure_ascii=False, indent=2))
        return 0

    time.sleep(0.15 if api_key else 0.4)  # stay comfortably under the 10/s (keyed) or 3/s (unkeyed) ceiling
    summaries, summary_error = esummary(pmids, api_key)
    time.sleep(0.15 if api_key else 0.4)
    abstracts = efetch_abstracts(pmids, api_key)

    records = []
    for pmid in pmids:
        summary = summaries.get(pmid)
        if not summary:
            continue
        records.append(normalize(pmid, summary, abstracts.get(pmid)))

    key_rejected = bool(globals().get("_KEY_REJECTED"))
    print(json.dumps({
        "provider": "PubMed", "skill": "pubmed-search", "query": query,
        "api_key_used": bool(api_key) and not key_rejected,
        "api_key_rejected": key_rejected,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "result_count_reported": count, "records": records,
        "limitations": ["metadata + abstract search only", "full-text reading requires PMC OA lookup or institutional access",
                        *(["the configured PubMed API key was rejected; this run fell back to unauthenticated access (~3 req/s). Replace Scholarium/secrets/pubmed-api-key.txt."] if key_rejected else []),
                        *( [f"esummary error: {summary_error}"] if summary_error else [] )]
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
