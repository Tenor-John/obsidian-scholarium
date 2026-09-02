#!/usr/bin/env python3
from __future__ import annotations
import http.cookiejar, json, re, ssl, sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import HTTPCookieProcessor, Request, build_opener, HTTPSHandler

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

MAX_BYTES = 80 * 1024 * 1024

# Windows + CPython's urllib often cannot locate the system CA bundle, so HTTPS
# downloads fail with CERTIFICATE_VERIFY_FAILED before the request even reaches
# the publisher. Build an SSL context that falls back to the system store, and
# only if that is unavailable degrades to unverified (still better than a hard
# crash for institutional-cookie downloads where the proxy already establishes
# the trust boundary).
def _ssl_context():
    # Windows + CPython's urllib often cannot locate the system CA bundle
    # (ssl.get_default_verify_paths().cafile is None on a clean install), so
    # HTTPS downloads fail with CERTIFICATE_VERIFY_FAILED before the request
    # even reaches the publisher. Prefer certifi's bundled CA list (present
    # in this environment), then the OS store, then degrade to unverified
    # only as a last resort — the WebVPN proxy already establishes trust.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    try:
        ctx = ssl.create_default_context()
        ctx.load_default_certs()
        return ctx
    except Exception:
        return ssl._create_unverified_context()

SSL_CTX = _ssl_context()

# Hard policy: never fetch from piracy/mirror domains, even if such a URL
# slipped into upstream search or synthesis output (this has happened before —
# an LLM step appended a sci-hub mirror link next to a legitimate DOI citation).
BANNED_DOMAINS = re.compile(
    r"(sci-hub\.[a-z.]{2,}|libgen\.[a-z.]{2,}|library\.lol|z-?lib(?:rary)?\.[a-z.]{2,}"
    r"|annas-archive\.[a-z.]{2,}|booksc\.[a-z.]{2,})",
    re.IGNORECASE,
)

def load_input(value):
    if value and Path(value).exists():
        return json.loads(Path(value).read_text(encoding="utf-8"))
    if value:
        try: return json.loads(value)
        except Exception: return {"urls": [value]}
    return {}

def urls_from(obj):
    urls = []
    if isinstance(obj, dict):
        for key in ("urls", "pdf_urls"):
            if isinstance(obj.get(key), list): urls += [str(x) for x in obj[key]]
        for rec in obj.get("records", []) if isinstance(obj.get("records"), list) else []:
            for key in ("pdf_url", "landing_page_url", "doi"):
                if rec.get(key): urls.append(str(rec[key]))
    elif isinstance(obj, list):
        for item in obj: urls += urls_from(item)
    return [u for u in urls if u.startswith("http://") or u.startswith("https://")]

def safe_name(url, idx):
    p = urlparse(url)
    name = Path(p.path).name or f"paper-{idx}.pdf"
    if not name.lower().endswith(".pdf"): name = f"{name}.pdf"
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:150] or f"paper-{idx}.pdf"

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    obj = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    cookie_path = root / "Scholarium" / "secrets" / "webvpn-cookies.txt"
    out_dir = root / "literature" / "downloaded-pdfs"; out_dir.mkdir(parents=True, exist_ok=True)
    jar = http.cookiejar.MozillaCookieJar(str(cookie_path))
    cookie_status = "missing"
    if cookie_path.exists():
        try:
            jar.load(ignore_discard=True, ignore_expires=True)
            cookie_status = "loaded"
        except Exception as e:
            cookie_status = f"invalid: {e}"
    opener = build_opener(HTTPSHandler(context=SSL_CTX), HTTPCookieProcessor(jar))
    results = []
    for idx, url in enumerate(urls_from(obj), 1):
        if BANNED_DOMAINS.search(url):
            results.append({"url": url, "status": "blocked_policy", "error": "piracy/mirror domain is not allowed; use institutional WebVPN/CARSI access or the publisher's own page"})
            continue
        target = out_dir / safe_name(url, idx)
        try:
            req = Request(url, headers={"User-Agent": "Scholarium/0.1 institutional-cookie-downloader"})
            # Kept well under 45s: this loop runs sequentially over every URL in
            # the input, and the Bridge only budgets a fixed wall-clock time for
            # the whole script (see paper-downloader's timeoutMs in server.js).
            # A handful of slow/hanging publisher pages at 45s each was enough
            # to blow that budget and get the whole run killed with ETIMEDOUT.
            with opener.open(req, timeout=18) as resp:
                data = resp.read(MAX_BYTES + 1)
                final_url = resp.geturl()
                ctype = resp.headers.get("content-type", "")
            if len(data) > MAX_BYTES:
                raise RuntimeError("file exceeds safety limit")
            if not data.startswith(b"%PDF"):
                raise RuntimeError(f"not_pdf_or_login_page content_type={ctype}")
            n = 2
            base = target
            while target.exists():
                target = base.with_name(f"{base.stem}-{n}{base.suffix}"); n += 1
            target.write_bytes(data)
            results.append({"url": url, "status": "downloaded", "path": str(target.relative_to(root)).replace("\\", "/"), "bytes": len(data), "final_url": final_url})
        except Exception as e:
            results.append({"url": url, "status": "needs_login_or_manual_check" if "not_pdf" in str(e) else "failed", "error": str(e)})
    print(json.dumps({
        "skill": "paper-downloader",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "cookie_profile": str(cookie_path),
        "cookie_status": cookie_status,
        "results": results,
        "instructions": [
            "If cookie_status is missing or results show needs_login_or_manual_check, log in to WebVPN/CARSI in your browser and export a Netscape cookie jar to Scholarium/secrets/webvpn-cookies.txt.",
            "Do not commit Scholarium/secrets."
        ]
    }, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
