---
name: scansci-institutional
description: Download paywalled papers through the locally installed scansci-pdf institutional channels (WebVPN/CARSI/EZproxy, Unpaywall, Europe PMC). Pirate mirrors are explicitly disabled.
---
# scansci-institutional

Run:

```bash
node scripts/scansci_download.js <workspace> <json-input-or-file>
```

## Why this exists

`paper-downloader` drives one persistent Chrome profile. That works when the
publisher lets a browser through, but it is a single channel: when Cloudflare
challenges a headless session, the run returns 0 PDFs and the evidence gate
stops the whole pipeline.

`scansci-pdf` (installed separately as a Python package) already implements a
tiered institutional resolver — WebVPN over SOCKS5, CARSI federated login,
EZproxy, Unpaywall, Europe PMC, OpenAlex, Semantic Scholar — with per-source
scoring and retry. This skill exposes that resolver to the Bridge so the
Pipeline can use it as its institutional download tier.

## Access policy

`scihub_enabled=False` is passed on every call and is not configurable from the
skill input. This skill routes only through subscriptions the institution
actually holds and through openly licensed copies. Mirror/pirate sources stay
off regardless of what `scansci-pdf`'s own config file says.

## Input

```json
{
  "records": [{ "doi": "10.1016/j.example.2020.01.001", "title": "..." }],
  "dois": ["10.1021/acs.jpcc.5b06729"],
  "output_dir": "literature/downloaded-pdfs",
  "use_vpnsci": true
}
```

`records` and `dois` are merged; a bare string input is treated as a path to a
JSON file with the same shape. `output_dir` is resolved relative to the
workspace and defaults to `literature/downloaded-pdfs`.

## Output

A single JSON manifest on stdout, shaped like `paper-downloader`'s so the
Pipeline can consume either interchangeably:

```json
{
  "results": [{ "status": "downloaded", "path": "...", "doi": "...", "source": "WebVPN" }],
  "downloaded_paths": ["..."],
  "session_policy": "scansci-pdf institutional",
  "browser_mode": "scansci-pdf"
}
```

Statuses: `downloaded`, `needs_login`, `access_denied`, `not_found`, `error`.

## Boundaries

- Requires `scansci-pdf` to be importable by the configured Python interpreter.
- Requires a valid WebVPN/CARSI session; run `scansci_pdf_vpnsci_login` (or the
  CLI equivalent) first when the manifest reports `needs_login`.
- Downloads only. This skill does not read PDFs or emit evidence cards.
