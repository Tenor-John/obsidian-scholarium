#!/usr/bin/env python3
"""Establish publisher access via a Shibboleth entityID deep link.

Why this exists
---------------
Every publisher renders the "Access through your institution" picker
differently — ACS puts the label in `aria-label` and offers a second
Federation path built from two <select>s, Wiley uses an autocomplete, and so
on. Scraping each one is a treadmill: scansci-pdf ships selectors for 8
publishers and none of them is ACS, and its click helper only looks at
`[class*=result], li, a, button` — never at `<option>`, so a <select>-based
picker cannot be driven at all.

But the picker is only a UI for choosing an entityID, and the entityID is a
federation-wide constant. Read straight off the ACS page:

    <option value="https://idp.ustc.edu.cn/idp/shibboleth">
      UNIV SCIENCE AND TECHNOLOGY CHINA</option>

Note the display text: "UNIV SCIENCE AND TECHNOLOGY CHINA" — not "USTC", and
not "University of Science and Technology of China" either. Matching on the
display string is exactly the treadmill; the value is stable.

So skip the picker. Every Shibboleth SP exposes the same endpoint:

    https://<publisher>/Shibboleth.sso/Login?entityID=<idp>&target=<article>

If the IdP session from the WebVPN/CARSI login is still alive, that is a pure
redirect chain with nothing to type.

Output: JSON on stdout. Exit 0 on success, 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import quote, urlparse

if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

DATA_DIR = Path(os.environ.get("SCANSCI_PDF_DATA_DIR", str(Path.home() / ".scansci-pdf")))
CACHE_DIR = DATA_DIR / "cache"
COOKIE_FILE = CACHE_DIR / "instsci-cookies.json"
NETSCAPE_FILE = CACHE_DIR / "instsci-cookies.txt"
STATE_FILE = CACHE_DIR / "browser_state.json"

DEFAULT_ENTITY_ID = "https://idp.ustc.edu.cn/idp/shibboleth"

# Landing here means the SP handed us to the IdP and the IdP wants credentials.
AUTH_HOSTS = ("id.ustc.edu.cn", "idp.ustc.edu.cn")


def deep_link(target_url: str, entity_id: str) -> str:
    host = urlparse(target_url).hostname or ""
    return (f"https://{host}/Shibboleth.sso/Login"
            f"?entityID={quote(entity_id, safe='')}&target={quote(target_url, safe='')}")


def load_jar() -> list:
    try:
        data = json.loads(COOKIE_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def merge_jars(before: list, after: list) -> list:
    """Union by (name, domain, path); newer wins.

    The publisher leg of this flow may never touch wvpn.ustc.edu.cn, so writing
    only the new cookies would drop the WebVPN ticket and break the HTTP tier
    for every remaining DOI in the batch.
    """
    merged = {}
    for c in list(before) + list(after):
        if isinstance(c, dict) and c.get("name"):
            merged[(c.get("name"), c.get("domain", ""), c.get("path", "/"))] = c
    return list(merged.values())


def save_cookies(context) -> int:
    cookies = context.cookies()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    merged = merge_jars(load_jar(), [
        {"name": c["name"], "value": c["value"],
         "domain": c.get("domain", ""), "path": c.get("path", "/")}
        for c in cookies
    ])
    COOKIE_FILE.write_text(json.dumps(merged, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = ["# Netscape HTTP Cookie File\n"]
    for c in cookies:
        domain = c.get("domain", "")
        lines.append("\t".join([
            domain, "TRUE" if domain.startswith(".") else "FALSE", c.get("path", "/"),
            "TRUE" if c.get("secure") else "FALSE", str(max(0, int(c.get("expires", 0) or 0))),
            c.get("name", ""), c.get("value", ""),
        ]) + "\n")
    NETSCAPE_FILE.write_text("".join(lines), encoding="utf-8")

    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        state = {}
    state["cookies"] = cookies
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
    return len(merged)


def classify(url: str, target_host: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if host in AUTH_HOSTS or "/cas/login" in url.lower():
        return "idp_login"
    if host.endswith(target_host):
        return "publisher"
    return "in_transit"


def main() -> int:
    ap = argparse.ArgumentParser(description="Publisher access via Shibboleth entityID deep link")
    ap.add_argument("--target", required=True, help="Article URL on the publisher's site")
    ap.add_argument("--entity-id", default=os.environ.get("CARSI_ENTITY_ID", DEFAULT_ENTITY_ID))
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--headless", action="store_true")
    args = ap.parse_args()

    target_host = (urlparse(args.target).hostname or "").lower()
    url = deep_link(args.target, args.entity_id)
    out = {"skill": "shibboleth_login", "target": args.target, "entity_id": args.entity_id,
           "deep_link": url, "status": "failed"}

    try:
        from cloakbrowser import launch
    except ImportError:
        out["error"] = "cloakbrowser not installed"
        print(json.dumps(out, ensure_ascii=False))
        return 1

    # Headed by default. The SP endpoint sits behind Cloudflare on at least ACS,
    # and a visible window is both more likely to clear it and the only place a
    # human can respond if it asks.
    browser = launch(headless=args.headless, humanize=True,
                     args=["--disable-features=CrossOriginOpenerPolicy"])
    context = browser.new_context()
    page = context.new_page()

    # Seed the saved session so the IdP recognises us and the chain runs silently.
    saved = load_jar()
    if saved:
        try:
            context.add_cookies([
                {"name": c["name"], "value": c["value"],
                 "domain": c.get("domain", ""), "path": c.get("path", "/")}
                for c in saved if c.get("domain")
            ])
        except Exception:
            pass

    try:
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as exc:
            out["nav_warning"] = str(exc)[:200]

        deadline = time.time() + args.timeout
        state = "in_transit"
        while time.time() < deadline:
            time.sleep(2)
            try:
                state = classify(page.url, target_host)
            except Exception:
                out["error"] = "browser closed"
                break
            if state == "publisher":
                break
            if state == "idp_login":
                # The WebVPN session is gone; this script never types credentials.
                out["status"] = "needs_login"
                out["error"] = "IdP asked for credentials — refresh the WebVPN/CARSI session first"
                break

        if state == "publisher":
            out["status"] = "ok"
            out["final_host"] = (urlparse(page.url).hostname or "")
            out["cookies_saved"] = save_cookies(context)
        elif out["status"] != "needs_login":
            out.setdefault("error", f"did not reach the publisher within {args.timeout}s")
            try:
                out["final_host"] = (urlparse(page.url).hostname or "")
                out["page_title"] = (page.title() or "")[:80]
            except Exception:
                pass
    finally:
        try:
            browser.close()
        except Exception:
            pass

    print(json.dumps(out, ensure_ascii=False))
    return 0 if out["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
