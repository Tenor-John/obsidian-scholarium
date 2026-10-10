#!/usr/bin/env node
'use strict';
/*
 * scansci-institutional — Bridge skill runner.
 *
 * Bridges the Pipeline's download tier onto the locally installed scansci-pdf
 * Python package. Runs as a Node script (the Bridge launches *.js with
 * process.execPath) and shells out to a pinned Python interpreter, so it does
 * not depend on whatever `python` happens to be first on PATH.
 *
 * Sci-Hub / LibGen are disabled unconditionally: scihub_enabled=False is passed
 * on every call, overriding scansci-pdf's own config.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_OUT = 'literature/downloaded-pdfs';

/* A run that dies before it starts must not leave the previous run's progress
   file lying around for the UI to poll.

   The 2026-09-05 run failed at resolvePython() — line 147, long before the
   progress file is reset at line ~549 — so the poller kept reading a stale
   document and rendered "11/35（成功 0，失败 11）· 10.1021/nl3029202 · 已 15
   分钟没有更新，任务可能已经停止或崩溃". None of those numbers belonged to
   that run. The file's own header comment already warns about exactly this
   ("a fresh run came up already showing 34/75"), and the guard it describes
   sits after the failure point, so it never ran.

   Clearing on the failure path is the cheap half of the fix: whatever the UI
   reads next is at least not a different run's numbers. */
function clearStaleProgress() {
  try {
    const ws = process.argv[2];
    if (!ws) return;
    const file = path.resolve(ws, 'Scholarium', 'runtime', 'download-progress.json');
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch (_) { /* best-effort: never mask the real error with a cleanup error */ }
}

function fail(message, extra) {
  clearStaleProgress();
  process.stdout.write(JSON.stringify({
    error: message, results: [], downloaded_paths: [],
    session_policy: 'scansci-pdf institutional', browser_mode: 'scansci-pdf', ...(extra || {})
  }));
  process.exit(0);
}

/* Find the interpreter that actually has scansci_pdf.

   Until 2026-09-06 the candidate list was literally one entry —
   process.env.SCANSCI_PYTHON — while the failure message said "not importable
   by any candidate Python interpreter", promising a search that did not exist.
   SCANSCI_PYTHON was set nowhere: not in the process, not at User or Machine
   level, and nowhere in this repo. So the institutional channel failed
   instantly on every run, before a single network request, and the pipeline
   reported it as "机构通道成功 0/35 篇" — which reads like 35 failed downloads
   rather than a channel that never started.

   Measured on this machine: `python` and `py` resolve to Anaconda, which does
   NOT have scansci_pdf; the package is installed under
   %LOCALAPPDATA%\Programs\Python\Python311\python.exe. A PATH-only fallback
   would therefore still have failed, which is why the well-known per-user
   install locations are searched as well.

   `fs.existsSync` is only applied to absolute paths: bare names like `python`
   are resolved by the OS at spawn time and would never pass an existsSync
   check, which is the second reason the original loop could not have found
   anything even with more candidates. */
function pythonCandidates() {
  const out = [process.env.SCANSCI_PYTHON, 'python', 'python3'];
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles;
  const dirs = [];
  if (local) dirs.push(path.join(local, 'Programs', 'Python'));
  if (programFiles) dirs.push(programFiles);
  for (const dir of dirs) {
    let entries = [];
    try { entries = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of entries) {
      if (!/^Python3?\d*$/i.test(name)) continue;
      out.push(path.join(dir, name, 'python.exe'));
    }
  }
  // Newest install first: a machine with 3.9 and 3.11 side by side usually got
  // the package into the newer one.
  const known = out.filter(Boolean);
  return [...new Set(known)];
}

function resolvePython() {
  const candidates = pythonCandidates();
  const tried = [];
  for (const c of candidates) {
    if (path.isAbsolute(c) && !fs.existsSync(c)) { tried.push(`${c} (不存在)`); continue; }
    let probe;
    try {
      probe = spawnSync(c, ['-c', 'import scansci_pdf'], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    } catch (error) { tried.push(`${c} (${error.message})`); continue; }
    if (probe && probe.status === 0) return c;
    const why = String((probe && (probe.stderr || probe.stdout)) || '').trim().split(/\r?\n/).pop();
    tried.push(`${c} (${why || '无法运行'})`.slice(0, 160));
  }
  resolvePython.tried = tried;
  for (const c of ['python', 'python3']) {
    const probe = spawnSync(c, ['-c', 'import scansci_pdf'], { encoding: 'utf8', windowsHide: true, shell: false });
    if (probe.status === 0) return c;
  }
  return null;
}

// A UTF-8 BOM makes JSON.parse throw, and the catch below turns that into a
// silent "no DOIs in input" — the file is right there and looks fine. Anything
// written by PowerShell's Set-Content -Encoding utf8 carries one, so strip it.
const stripBom = (text) => String(text).replace(/^﻿/, '').trim();

function parseInput(raw) {
  if (!raw) return {};
  const trimmed = stripBom(raw);
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch (_) { return {}; }
  }
  try { return JSON.parse(stripBom(fs.readFileSync(trimmed, 'utf8'))); } catch (_) { return {}; }
}

const cleanDoi = (value) => String(value || '')
  .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();

function collectDois(input) {
  const out = [];
  const push = (v) => { const d = cleanDoi(v); if (d && !out.includes(d)) out.push(d); };
  if (Array.isArray(input)) { for (const x of input) push(typeof x === 'string' ? x : x && x.doi); return out; }
  for (const key of ['dois', 'identifiers']) {
    if (Array.isArray(input[key])) for (const x of input[key]) push(x);
  }
  if (Array.isArray(input.records)) for (const r of input.records) push(r && r.doi);
  return out;
}

const workspace = process.argv[2];
if (!workspace || !fs.existsSync(workspace)) fail(`workspace not found: ${workspace || '(missing)'}`);

let input = parseInput(process.argv[3]);
// The Pipeline sends a small control object so it can enforce a silent batch,
// while the DOI list remains in its generated export file.  Resolve that file
// only inside the authorized workspace; this runner must never turn a JSON
// option into arbitrary filesystem access.
if (input && typeof input === 'object' && input.records_file) {
  const recordsFile = path.resolve(workspace, String(input.records_file));
  const relative = path.relative(path.resolve(workspace), recordsFile);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('records_file must be inside the authorized workspace');
  }
  const recordsInput = parseInput(recordsFile);
  input = {
    ...(recordsInput && typeof recordsInput === 'object' ? recordsInput : {}),
    ...input,
    records: Array.isArray(input.records) ? input.records : recordsInput?.records
  };
}
const dois = collectDois(input);
if (!dois.length) fail('no DOIs in input (expected records[].doi or dois[])');

const outRel = String(input.output_dir || DEFAULT_OUT).replace(/^[\\/]+/, '');
const outDir = path.resolve(workspace, outRel);
fs.mkdirSync(outDir, { recursive: true });

const python = resolvePython();
if (!python) {
  /* Report what was actually tried. The old message named no candidate, so a
     user whose package sits in a non-PATH interpreter had nothing to act on. */
  const tried = Array.isArray(resolvePython.tried) ? resolvePython.tried : [];
  fail('没有找到装有 scansci_pdf 的 Python 解释器，机构下载通道无法启动（本次没有发出任何网络请求）。'
    + '已尝试：' + (tried.length ? tried.join(' | ') : '无候选')
    + '。请把 SCANSCI_PYTHON 设为装有该包的解释器完整路径。');
}

const PY = `
import json, sys, os, subprocess, threading
payload = json.loads(sys.stdin.read())
dois = payload["dois"]
out_dir = payload["out_dir"]
use_vpnsci = bool(payload.get("use_vpnsci", True))
progress_file = payload.get("progress_file")

# The Bridge runs this skill with async spawn precisely so the UI can poll this
# file while the batch is still going. batch_download() fans out over worker
# threads, so the counters need a lock, and the file is written via os.replace
# so a poll can never observe a half-written JSON document.
_progress_lock = threading.Lock()
import time as _time
# started_at lets the UI reject a progress file left behind by an earlier run.
# Deleting it from the Node side is not enough: if this script fails to launch at
# all (a syntax error in the JS wrapper, a missing interpreter), the deletion
# never happens and the old file is still sitting there for the poller to find —
# which is how a fresh run came up already showing "34/75 (5 ok, 17 failed)".
_state = {"done": 0, "total": len(dois), "downloaded": 0, "failed": 0,
          "resolved": 0, "skipped_or_resumed": 0, "current": "", "status": "running",
          "phase": "parallel_sources", "started_at": int(_time.time() * 1000),
          "updated_at": int(_time.time() * 1000), "downloaded_paths": []}


def _write_progress():
    if not progress_file:
        return
    try:
        _state["updated_at"] = int(_time.time() * 1000)
        os.makedirs(os.path.dirname(progress_file), exist_ok=True)
        tmp = progress_file + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(_state, fh, ensure_ascii=False)
        os.replace(tmp, progress_file)
    except Exception:
        pass


def _on_progress(done, total, identifier, result):
    ok = isinstance(result, dict) and (result.get("success") or result.get("status") == "downloaded")
    with _progress_lock:
        # batch_download's "done" counts resumed and invalid identifiers too, but
        # those never reach this callback, so downloaded+failed lags behind it.
        # Reporting both as if they described the same thing produced
        # "34/75 (5 ok, 17 failed)" — three numbers that cannot all be right.
        # Keep them as what they are: "done" is progress through the queue,
        # "resolved" is what this callback actually saw.
        _state["done"] = done
        _state["total"] = total
        _state["current"] = str(identifier or "")
        if ok:
            _state["downloaded"] += 1
            if result.get("path") and result.get("path") not in _state["downloaded_paths"]:
                _state["downloaded_paths"].append(result.get("path"))
        else:
            _state["failed"] += 1
        _state["resolved"] = _state["downloaded"] + _state["failed"]
        _state["skipped_or_resumed"] = max(0, done - _state["resolved"])
        if done >= total:
            # scansci-pdf may still enter its publisher-grouped second phase
            # after the public/HTTP worker pool is exhausted.  Calling this
            # "running" with no phase made a completed counter look frozen.
            _state["phase"] = "finalizing_sources"
        _write_progress()


_write_progress()

from scansci_pdf.config import load_config
from scansci_pdf.sources import batch_download

# ── runtime patches over scansci-pdf ────────────────────────────────────────
# Applied here rather than edited into site-packages, so a pip upgrade cannot
# silently revert them and the change stays in this repo's history.
patch_notes = []

# Patch 1 — the WAYF institution name.
# publisher_strategies._IDP_MAP maps the configured Chinese name to whatever
# gets typed into the publisher's "find your institution" box. It ships as
# "USTC", which does not match the federation's listing; the correct string is
# the full English name.
try:
    from scansci_pdf import publisher_strategies as _ps
    _FULL_NAME = "University of Science and Technology of China"
    if _ps._IDP_MAP.get("中国科学技术大学") != _FULL_NAME:
        _ps._IDP_MAP["中国科学技术大学"] = _FULL_NAME
        # _school_auth_patterns() derives IDP *URL* tokens from the same dict and
        # keeps every word longer than 3 chars. With the full name in place it
        # would return ("university","science","technology","china") — which no
        # longer matches ustc.edu.cn and matches half the web besides. Pin it to
        # the token it produced before this patch.
        _ps._school_auth_patterns = lambda config, _tokens=("ustc",): _tokens
        patch_notes.append("idp_name=full_english+auth_patterns_pinned")
except Exception as exc:
    patch_notes.append("idp_patch_failed:%s" % exc)

# Patch 2 — tier order, and a cap on concurrent browsers.
# try_instsci() runs the stealth browser FIRST (instsci.py:1087) and only falls
# back to the silent HTTP path (instsci.py:1096). With a valid WebVPN cookie the
# HTTP path is both faster and invisible, so the shipped order opens one visible
# Chrome per DOI and starves the cheap path. try_instsci() looks both tiers up in
# module globals at call time, so rebinding the browser tier reorders the flow
# without touching the orchestrator — which matters because vpnsci.py already did
# "from .instsci import try_instsci" and holds its own reference.
# (No backticks in this block: it lives inside a JS template literal.)
try:
    from scansci_pdf.sources import instsci as _inst
    import scansci_pdf.sources as _sources_module
    _orig_browser = _inst._try_instsci_browser
    _orig_http = _inst._try_instsci_http
    _allow_browser = bool(payload.get("allow_browser", True))
    _browser_gate = threading.Semaphore(max(1, int(payload.get("browser_workers", 1))))

    # ── publisher-triggered institutional login ─────────────────────────────
    # scansci-pdf's own CARSI browser is what produced the popup-per-DOI storm
    # and could not find the institutional-access entry point. Replace it with
    # ~/.scansci-pdf/webvpn_auto_login.py --mode publisher, which walks
    # article page → "Access through your institution" → institution picker →
    # CAS → post-login Continue/Accept buttons, pausing for a human only if a
    # captcha appears.
    #
    # That script only establishes *access*; it never saves a PDF. So on success
    # the HTTP tier is retried, and it is the one that actually downloads.
    _login_script = os.path.join(os.path.expanduser("~"), ".scansci-pdf", "webvpn_auto_login.py")
    _publisher_login_enabled = bool(payload.get("publisher_login", True)) and os.path.exists(_login_script)
    _publisher_login_timeout = int(payload.get("publisher_login_timeout", 300))
    _attempted_publishers = set()
    _publisher_lock = threading.Lock()
    _cookie_file = os.path.join(os.path.expanduser("~"), ".scansci-pdf", "cache", "instsci-cookies.json")


    def _read_cookie_jar():
        try:
            with open(_cookie_file, encoding="utf-8") as fh:
                data = json.load(fh)
            return data if isinstance(data, list) else []
        except Exception:
            return []


    def _merge_cookie_jars(before, after):
        """Union by (name, domain, path); the newer login wins on conflict.

        webvpn_auto_login.py overwrites instsci-cookies.json with whatever its
        own browser context holds. In publisher mode that context may go
        article → CARSI → IdP without ever touching wvpn.ustc.edu.cn, so a
        straight overwrite can drop the WebVPN ticket and break the HTTP tier
        for every remaining DOI in the batch.
        """
        merged = {}
        for cookie in list(before) + list(after):
            if not isinstance(cookie, dict) or not cookie.get("name"):
                continue
            merged[(cookie.get("name"), cookie.get("domain", ""), cookie.get("path", "/"))] = cookie
        return list(merged.values())


    def _publisher_host(doi):
        try:
            resolved = _inst._resolve_doi_url(doi) or ""
            from urllib.parse import urlparse as _urlparse
            return (_urlparse(resolved).hostname or "").lower()
        except Exception:
            return ""


    _shib_script = payload.get("shibboleth_script") or ""
    _entity_id = payload.get("entity_id") or "https://idp.ustc.edu.cn/idp/shibboleth"


    def _try_shibboleth(doi):
        """entityID deep link: no picker page, so no per-publisher selectors.

        The picker only exists to choose an entityID, and the entityID is a
        federation-wide constant, while the display text is not — ACS lists us as
        "UNIV SCIENCE AND TECHNOLOGY CHINA", which matches neither "USTC" nor the
        full English name. Going straight to the SP endpoint sidesteps all of it.
        """
        if not (_shib_script and os.path.exists(_shib_script)):
            return False
        try:
            article = _inst._resolve_doi_url(doi) or ""
        except Exception:
            article = ""
        if not article:
            return False
        try:
            run = subprocess.run(
                [sys.executable, _shib_script, "--target", article,
                 "--entity-id", _entity_id, "--timeout", "90"],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=240, env=dict(os.environ, PYTHONIOENCODING="utf-8"),
            )
            return run.returncode == 0
        except Exception:
            return False


    def _try_publisher_login(doi):
        """Establish access once per publisher per batch: deep link, then picker."""
        host = _publisher_host(doi) or "unknown"
        with _publisher_lock:
            if host in _attempted_publishers:
                return False
            _attempted_publishers.add(host)
        if _try_shibboleth(doi):
            _state.setdefault("publisher_logins", []).append({"host": host, "ok": True, "via": "shibboleth"})
            _write_progress()
            return True
        before = _read_cookie_jar()
        try:
            run = subprocess.run(
                [sys.executable, _login_script, "--mode", "publisher", "--doi", doi,
                 "--timeout", str(_publisher_login_timeout)],
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                timeout=_publisher_login_timeout + 120,
                env=dict(os.environ, PYTHONIOENCODING="utf-8"),
            )
            ok = run.returncode == 0
        except Exception:
            ok = False
        after = _read_cookie_jar()
        if after and before:
            try:
                with open(_cookie_file, "w", encoding="utf-8") as fh:
                    json.dump(_merge_cookie_jars(before, after), fh, ensure_ascii=False, indent=2)
            except Exception:
                pass
        _state.setdefault("publisher_logins", []).append({"host": host, "ok": ok, "via": "picker"})
        _write_progress()
        return ok


    def _http_first(doi, output_path, config):
        try:
            result = _orig_http(doi, output_path, config)
            if result:
                return result
        except Exception:
            pass
        if not _allow_browser:
            return None
        # Serialised: this tier is the only thing that can put a window on the
        # researcher's screen, and N failures used to mean N simultaneous popups.
        with _browser_gate:
            if _publisher_login_enabled:
                if _try_publisher_login(doi):
                    try:
                        result = _orig_http(doi, output_path, config)
                        if result:
                            return result
                    except Exception:
                        pass
                # Login ran (or was already tried for this publisher). Fall back
                # to scansci-pdf's own browser only when explicitly asked; by
                # default it stays off, since it is what we just replaced.
                if not bool(payload.get("scansci_browser_fallback", False)):
                    return None
            return _orig_browser(doi, output_path, config)

    _inst._try_instsci_browser = _http_first

    # scansci-pdf's built-in Phase 2 always launches a publisher browser and
    # processes publisher groups serially.  A normal Pipeline call explicitly
    # sets allow_browser=false, so entering that phase both violates the silent
    # batch contract and is the reason progress can sit at N/N for many minutes.
    # The HTTP/WebVPN/open-source worker pool above has already run in parallel;
    # remaining papers are handed to Scholarium's persistent-browser/manual
    # fallback instead.  Interactive calls keep scansci-pdf's original Phase 2.
    if not _allow_browser and hasattr(_sources_module, "_batch_institutional_phase"):
        _sources_module._batch_institutional_phase = lambda *args, **kwargs: None
        patch_notes.append("publisher_phase2=delegated_to_scholarium_fallback")

    # Patch 3 - the publisher-specific browser sources.
    #
    # Rebinding _try_instsci_browser above only silences ONE path. ACS, Wiley,
    # RSC, Nature and Springer each have their own browser source, registered in
    # sources/publishers.py PUBLISHER_TOOL_MAP (e.g. "ACS": ["ACSBrowser", ...])
    # and implemented in publisher_strategies.py. They live entirely outside the
    # instsci module, so allow_browser=false never reached them.
    #
    # Observed live: with allow_browser=false the run still put a visible
    # Chromium on screen at pubs.acs.org/... - the RAW publisher URL, not a
    # wvpn.ustc.edu.cn rewrite, because only instsci does WebVPN rewriting.
    # source_scores.json confirmed ACSBrowser/WileyBrowser/RSCBrowser all ran
    # during that batch.
    #
    # Forcing them headless is not an option: publisher_strategies.py hardcodes
    # launch(headless=False) and never reads config browser_headless. So in a
    # silent batch they are removed from the tool map entirely; whatever they
    # would have fetched is handed to Scholarium's own browser fallback (tier 2),
    # which honours headless and reuses the persistent WebVPN session.
    if not _allow_browser and hasattr(_sources_module, "publishers"):
        try:
            _pub = _sources_module.publishers
            _tool_map = getattr(_pub, "PUBLISHER_TOOL_MAP", None)
            if isinstance(_tool_map, dict):
                _removed = set()
                for _publisher, _tools in _tool_map.items():
                    _kept = [t for t in _tools if not str(t).endswith("Browser")]
                    if len(_kept) != len(_tools):
                        _removed.update(t for t in _tools if str(t).endswith("Browser"))
                        _tool_map[_publisher] = _kept
                patch_notes.append("publisher_browser_sources_removed=%s" % (",".join(sorted(_removed)) or "none"))
        except Exception as exc:
            patch_notes.append("publisher_browser_patch_failed:%s" % exc)
    patch_notes.append(
        "tier_order=http_first,allow_browser=%s,browser_workers=%s,publisher_login=%s"
        % (_allow_browser, payload.get("browser_workers", 1), _publisher_login_enabled))
except Exception as exc:
    patch_notes.append("tier_patch_failed:%s" % exc)

# Fail fast on an expired institutional session. Without this the resolver walks
# every source for every DOI and the run hangs for tens of minutes before
# reporting nothing useful — the operator needs "go log in again", not a stall.
session_valid = None
if use_vpnsci:
    try:
        from scansci_pdf.sources.instsci import _validate_session
        session_valid = bool(_validate_session(load_config()))
    except Exception:
        session_valid = None
    if session_valid is False:
        _state["status"] = "needs_login"
        _state["phase"] = "finished"
        _write_progress()
        print(json.dumps({
            "results": [{"status": "needs_login", "path": "", "doi": d, "title": "",
                         "source": "", "error": "WebVPN/CARSI session expired"} for d in dois],
            "downloaded_paths": [],
            "session_policy": "scansci-pdf institutional (session expired)",
            "browser_mode": "scansci-pdf",
            "needs_login": True,
            "hint": "Run scansci_pdf_vpnsci_login (or: scansci-pdf instsci-login) to refresh the session, then re-run.",
            "requested": len(dois),
        }, ensure_ascii=False))
        sys.exit(0)

try:
    res = batch_download(
        dois,
        out_dir,
        scihub_enabled=False,   # pirate mirrors stay off, by policy
        use_tor=False,
        use_vpnsci=use_vpnsci,
        resume=True,
        progress_callback=_on_progress,
    )
except Exception as exc:
    _state["status"] = "error"
    _state["phase"] = "finished"
    _write_progress()
    print(json.dumps({"error": f"{type(exc).__name__}: {exc}", "results": []}))
    sys.exit(0)

_state["status"] = "finished"
_state["phase"] = "finished"
_write_progress()

MIN_PDF_BYTES = 8 * 1024


def valid_pdf(path):
    """A login wall or Cloudflare interstitial saved with a .pdf name is the
    classic silent failure: the run reports N downloads and every one of them is
    3 KB of HTML. Require the %PDF magic and the same 8 KB floor evidence-gate
    uses, so a bad file is reported as an error rather than counted as evidence."""
    try:
        if os.path.getsize(path) < MIN_PDF_BYTES:
            return False
        with open(path, "rb") as fh:
            return fh.read(5).startswith(b"%PDF")
    except OSError:
        return False


def norm(item):
    if not isinstance(item, dict):
        return {"status": "error", "error": str(item)}
    ok = bool(item.get("success")) or item.get("status") == "downloaded"
    p = item.get("path") or item.get("file") or item.get("output_path") or ""
    if ok and p and os.path.exists(p) and not valid_pdf(p):
        return {"status": "error", "path": "", "doi": item.get("doi") or "",
                "title": item.get("title") or "", "source": item.get("source") or "",
                "error": "downloaded file is not a valid PDF (login wall or block page)"}
    status = "downloaded" if (ok and p and os.path.exists(p)) else (item.get("status") or "error")
    if status not in ("downloaded", "needs_login", "access_denied", "not_found", "error"):
        status = "error" if not ok else "downloaded"
    return {
        "status": status,
        "path": p.replace("\\\\", "/") if p else "",
        "doi": item.get("doi") or item.get("identifier") or "",
        "title": item.get("title") or "",
        "source": item.get("source") or item.get("tier") or "",
        "error": item.get("error") or "",
    }

raw = res.get("results") if isinstance(res, dict) else res
if isinstance(raw, dict):
    raw = [dict(v, doi=v.get("doi") or k) if isinstance(v, dict) else {"doi": k, "status": "error"} for k, v in raw.items()]
results = [norm(x) for x in (raw or [])]

print(json.dumps({
    "results": results,
    "downloaded_paths": [r["path"] for r in results if r["status"] == "downloaded" and r["path"]],
    "session_policy": "scansci-pdf institutional (scihub disabled)",
    "browser_mode": "scansci-pdf",
    "requested": len(dois),
    # Surfaced so a silently-failed patch (renamed internal after a scansci-pdf
    # upgrade) shows up in the manifest instead of quietly restoring the old
    # popup-per-DOI behaviour.
    "patches": patch_notes,
}, ensure_ascii=False))
`;

const requestedProgressFile = String(input.progress_file || '').trim();
const progressFile = requestedProgressFile
  ? path.resolve(workspace, requestedProgressFile)
  : path.resolve(workspace, 'Scholarium', 'runtime', 'download-progress.json');
const progressRelative = path.relative(path.resolve(workspace), progressFile);
if (progressRelative === '..' || progressRelative.startsWith(`..${path.sep}`) || path.isAbsolute(progressRelative)) {
  fail('progress_file must be inside the authorized workspace');
}
// Clear any leftover file up front: a poller must never mistake the previous
// run's counts for this run's.
try { fs.mkdirSync(path.dirname(progressFile), { recursive: true }); fs.rmSync(progressFile, { force: true }); } catch { /* best-effort */ }

const run = spawnSync(python, ['-c', PY], {
  input: JSON.stringify({
    dois,
    out_dir: outDir,
    use_vpnsci: input.use_vpnsci !== false,
    progress_file: progressFile,
    // allow_browser:false is the stop-the-bleeding switch — HTTP tier only, no
    // window ever appears. browser_workers caps how many can be open at once.
    allow_browser: input.allow_browser === true,
    browser_workers: Number(input.browser_workers) || 1,
    publisher_login: input.publisher_login === true,
    publisher_login_timeout: Number(input.publisher_login_timeout) || 300,
    scansci_browser_fallback: input.scansci_browser_fallback === true,
    // Shipped alongside this runner so the deep-link tier is version-controlled
    // with the pipeline rather than living in the user's home directory.
    shibboleth_script: input.shibboleth_login === false
      ? ''
      : path.join(__dirname, 'shibboleth_login.py'),
    entity_id: input.entity_id || 'https://idp.ustc.edu.cn/idp/shibboleth'
  }),
  encoding: 'utf8',
  windowsHide: true,
  maxBuffer: 64 * 1024 * 1024,
  timeout: Number(input.timeout_ms) || 40 * 60 * 1000,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
});

if (run.error) fail(`python launch failed: ${run.error.message}`);
const stdout = String(run.stdout || '').trim();
if (!stdout) fail(`scansci-pdf produced no output${run.stderr ? `: ${String(run.stderr).slice(-600)}` : ''}`);

/* scansci-pdf logs progress on stdout too, so take the last line that parses
   as a JSON object rather than slicing at the last "{" (which lands inside a
   nested object). */
let manifest = null;
const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
for (let i = lines.length - 1; i >= 0; i--) {
  if (!lines[i].startsWith('{')) continue;
  try { manifest = JSON.parse(lines[i]); break; } catch (_) { /* keep looking */ }
}
if (!manifest) fail('could not parse scansci-pdf output', { raw: stdout.slice(-800), stderr: String(run.stderr || '').slice(-600) });
process.stdout.write(JSON.stringify(manifest));
