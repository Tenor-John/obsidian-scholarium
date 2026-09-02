---
name: paper-downloader
description: Download explicitly requested papers through a stable user-owned browser session, with WebVPN/CARSI login reuse and a legacy cookie-jar fallback.
---
# Paper Downloader

Run:

```bash
node scripts/browser_downloader.js <workspace> <json-input-or-file>
```

## Non-negotiable access rule

Do not reverse-engineer WebVPN URL encryption.

Do not hard-code `wvpn.ustc.edu.cn/{scheme}/{encoded_host}` host mappings as the primary strategy.

Do not store or ask for account passwords.

The primary strategy is a persistent local browser profile:

```text
<workspace>/Scholarium/runtime/webvpn-browser-profile
```

The researcher logs in to WebVPN/CARSI once in a visible browser window. The downloader later reuses that same local browser session to open DOI, publisher, and PDF pages. This follows the actual institution/publisher web flow instead of guessing WebVPN internals.

## Modes

### 1a. Automated login (preferred)

```json
{ "mode": "auto_login", "timeoutSec": 300 }
```

Shells out to `~/.scansci-pdf/webvpn_auto_login.py`, which drives the whole CAS flow: fills the form, waits for a captcha if one appears, clicks through post-login confirmations, and writes the three cookie files. Headed by default — a captcha is the one step it cannot automate, and headless leaves nowhere to solve it. Pass `"headless": true` only when you know there is no captcha.

Success is not taken from the script's own self-report. After it exits, `_validate_session(load_config())` is called — the same check `scansci-institutional` runs before every batch — and `logged_in` reflects that, not the exit code.

**Credentials never pass through Scholarium.** The script reads them from `USTC_USERNAME` / `USTC_PASSWORD` or `~/.scansci-pdf/webvpn_credentials.json`. This mode refuses to launch unless one of those is already populated, because the script's last resort is `input()` / `getpass()`, which raises `EOFError` on a spawned process with no TTY. Statuses: `logged_in`, `login_unverified`, `credentials_missing`, `auto_login_unavailable`, `failed`.

Note the tradeoff this accepts: `webvpn_credentials.json` holds the password in plaintext, which is why the rest of this skill still stores nothing. It lives outside the repo, so it is not a commit risk, but it is readable by anything running as this user.

### 1b. Login / refresh institutional session (manual fallback)

```json
{
  "mode": "login",
  "url": "https://wvpn.ustc.edu.cn/",
  "waitMs": 180000
}
```

Use this when the downloader returns `needs_login`, or when the session has expired. A visible Chrome window opens. The user signs in manually. Scholarium stores no password.

Login detection polls every 2s and requires **both** signals, then confirms with an active probe:

1. the `wengine_vpn_ticket…` cookie exists on `wvpn.ustc.edu.cn`, **and**
2. the page is on a `wvpn.ustc.edu.cn` host rather than `id.ustc.edu.cn` / CAS, **and**
3. re-navigating to the portal still lands on `wvpn.ustc.edu.cn` instead of bouncing to CAS.

All three are needed because each cheap signal fails on its own:

- **URL substrings lie.** USTC's CAS lands a *successful* login on `https://wvpn.ustc.edu.cn/login?cas_login=true`, which contains `login`. Any "URL contains no `login`/`cas`/`sso`" heuristic never fires and spins until timeout — this is the bug in scansci-pdf's own `browser_login.open_login_browser`.
- **The ticket cookie lies too, in the other direction.** It outlives the CAS session that issued it, so a profile can hold `wengine_vpn_ticket` for days while every WebVPN request is bounced to `https://id.ustc.edu.cn/cas/login`. Detecting on cookie presence alone makes the login window flash open and shut, report success, and export a dead session.

The step returns as soon as the session is *verified*; the researcher does not have to close the window.

On success the session is also exported for the institutional tier, in the three shapes `scansci_pdf.sources.instsci` reads:

```text
~/.scansci-pdf/cache/instsci-cookies.json    # {name,value,domain,path} — the HTTP path
~/.scansci-pdf/cache/instsci-cookies.txt     # Netscape jar — CloakBrowser import
~/.scansci-pdf/cache/browser_state.json      # {cookies, localStorage} — the Playwright path
```

Paths honour `SCANSCI_PDF_DATA_DIR` and the `cache_dir` / `vpnsci_cookie_file` / `instsci_cookie_file` keys in `~/.scansci-pdf/config.json`. The export only runs on a *verified* session, so a stale or logged-out run can never overwrite a still-valid jar — and never leaves the institutional tier believing it has cookies when it does not. `mode=session_status` and every download run refresh the same files, since the ticket rotates as the session is used.

Because the Bridge launches `mode=login` detached (its stdout is discarded so the UI is not blocked for the whole wait), the same manifest is also written to `Scholarium/runtime/webvpn-login-status.json` with `status: running` → `logged_in` / `login_wait_timeout` / `login_window_closed_by_user`. The UI polls that file; it must not report success from the Bridge's immediate `login_started` reply.

### 2. Download

```json
{
  "urls": [
    "https://doi.org/10.xxxx/example",
    "https://www.nature.com/articles/xxxx"
  ]
}
```

Runs headless by default (no visible window per paper) so a Pipeline run against dozens/hundreds of URLs doesn't pop open a browser tab for every one — it reuses the same persistent profile/session either way. Pass `"headless": false` to watch it work while debugging a stuck download. `mode: "login"` always opens a visible window regardless of this flag, since that step requires the researcher to see and complete the CAS/WebVPN login.

The tool:

1. Opens each URL with the persistent browser profile.
2. Saves direct PDF responses when possible.
3. Otherwise tries visible PDF / Download links.
4. Writes PDFs to `literature/downloaded-pdfs/`.
5. Writes logs to `Scholarium/runtime/download-logs/`.
6. Writes failure screenshots to `Scholarium/runtime/download-screenshots/`.

### 3. Legacy fallback

```json
{
  "mode": "direct_cookie_jar",
  "urls": ["https://publisher.example/file.pdf"]
}
```

This calls the old Netscape cookie-jar downloader using:

```text
<workspace>/Scholarium/secrets/webvpn-cookies.txt
```

Use it only for known direct PDF URLs. It is not the primary WebVPN/CARSI strategy.

### 4. Resolve DOIs / titles through PubMed, OpenAlex, Semantic Scholar, and Scopus

When you only have DOIs (or just titles) and no working landing pages, run the resolver first to locate open-access PDFs and fill in missing metadata. The resolver emits the same JSON shape `browser_downloader.js` already accepts, so the two scripts compose naturally:

```bash
node scripts/api_resolver.js <workspace> input.json > resolved.json
node scripts/browser_downloader.js <workspace> resolved.json
```

Input — any combination of these keys:

```json
{
  "dois": ["10.1038/nature12373"],
  "titles": ["Attention is all you need"],
  "records": [{ "doi": "10.1126/science.adi8755", "title": "..." }]
}
```

Output (printed to stdout, piped into the downloader):

```json
{
  "skill": "paper-downloader.api_resolver",
  "records": [
    {
      "doi": "10.1038/nature12373",
      "title": "...",
      "venue": "Nature",
      "pdf_url": "https://...pdf",
      "landing_page_url": "https://doi.org/...",
      "venue_issn_l": ["0028-0836"],
      "sources": ["pubmed", "openalex", "semantic_scholar"],
      "status": "resolved_open_access"
    }
  ],
  "blocked": [{ "doi": "...", "status": "blocked_policy" }],
  "urls": ["https://...pdf", "https://doi.org/..."],
  "trace": [{ "source": "pubmed", "doi": "...", "ok": true }]
}
```

Keys are loaded in this order — env vars first, then `Scholarium/secrets/api_keys.json` (gitignored):

| Env var | Source |
|---|---|
| `PUBMED_API_KEY` | NCBI E-utilities (10 req/s with key, 3 req/s without) |
| `OPENALEX_API_KEY` | OpenAlex (polite pool; key optional for low volume) |
| `SEMANTIC_SCHOLAR_API_KEY` | Semantic Scholar Graph API (100 req/s with key) |
| `SCOPUS_API_KEY` | Elsevier Abstract Retrieval (optional — hard daily quota) |

If a key is absent, that source is skipped silently. A `*.json.example` template lives at `scripts/api_keys.json.example` — copy to `Scholarium/secrets/api_keys.json` and fill in your values. Never commit that file.

### 5. Machine-readable statuses

Resolver (`api_resolver.js`):

- `resolved_open_access`: at least one source returned a direct PDF URL.
- `no_open_access_found`: metadata was resolved but no legal OA PDF surfaced; `browser_downloader.js` will try the landing page through WebVPN/CARSI.
- `no_metadata_found`: no source returned enough to populate a record.
- `blocked_policy`: a candidate PDF came from a banned domain and was dropped.

Downloader (`browser_downloader.js`):

- `downloaded`: a real PDF was saved and passed `%PDF` validation.
- `needs_login`: the browser reached WebVPN/CAS/login instead of the paper.
- `manual_required`: the landing page loaded, but no PDF was found automatically.
- `missing_playwright`: install dependencies before using browser mode.
- `browser_launch_failed`: Chrome/Playwright browser launch failed.
- `blocked_policy`: the URL points to a piracy or mirror domain and was not requested.
- `timeout`: a publisher page hung or timed out.
- `failed`: unexpected failure; inspect the JSON log and screenshot.

## Safety boundaries

- Only download URLs/DOIs explicitly supplied by the researcher or previous search steps.
- Do not use Sci-Hub, LibGen, Anna's Archive, z-library, or mirror domains.
- Do not commit `Scholarium/secrets/` or `Scholarium/runtime/`.
- Respect publisher terms and institutional access rules.
- If login expires, return `needs_login`; never retry credentials automatically.
