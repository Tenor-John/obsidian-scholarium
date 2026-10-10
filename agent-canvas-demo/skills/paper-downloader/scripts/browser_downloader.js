#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Stable institutional paper downloader.
 *
 * Primary rule:
 *   Reuse a user-owned persistent browser session. Do not reverse-engineer
 *   WebVPN host encoding, do not store passwords, and do not use piracy mirrors.
 *
 * Modes:
 *   { "mode": "login" }
 *     Opens a visible browser profile at WebVPN/CARSI for one-time login.
 *
 *   { "urls": ["https://doi.org/..."], "headless": false }
 *     Reuses the profile, navigates publisher/DOI pages, captures PDF responses
 *     or clicks visible PDF/download links. Failures return machine-readable
 *     statuses with screenshots/logs.
 *
 * Fallback:
 *   { "mode": "direct_cookie_jar", ... }
 *     Calls the legacy Netscape cookie-jar Python downloader.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// --- scansci-pdf session bridge ---------------------------------------------
//
// scansci-pdf's own WebVPN login (browser_login.open_login_browser) decides
// "login finished" by checking that the page URL contains none of
// login/cas/sso. USTC's CAS lands a *successful* login on
// https://wvpn.ustc.edu.cn/login?cas_login=true — which contains "login" — so
// that check never fires, the poll loop spins until max_wait, and the cookies
// are never written. The user sees a logged-in page and a hung tool.
//
// This downloader already has the reliable signal: the wengine_vpn_ticket
// cookie on wvpn.ustc.edu.cn. So we detect login here and write the session out
// in the three shapes scansci-pdf reads, letting scansci-institutional reuse a
// login the researcher performed once in this profile.
function hasWebvpnTicket(cookies) {
  return Array.isArray(cookies) && cookies.some((cookie) => (
    /(^|\.)wvpn\.ustc\.edu\.cn$/i.test(String(cookie.domain || '')) &&
    /wengine_vpn_ticket/i.test(String(cookie.name || ''))
  ));
}

// Mirrors scansci_pdf.config.DATA_DIR and instsci.instsci_cookie_path(). Note
// _cfg() prefers the vpnsci_* key whenever it *exists*, even set to "", and an
// empty value then falls through to the cache_dir default — so presence and
// truthiness are two separate checks here, not one.
function scansciTargets() {
  const dataDir = process.env.SCANSCI_PDF_DATA_DIR || path.join(os.homedir(), '.scansci-pdf');
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8').replace(/^﻿/, ''));
  } catch { config = {}; }
  const cacheDir = String(config.cache_dir || path.join(dataDir, 'cache'));
  const configured = Object.prototype.hasOwnProperty.call(config, 'vpnsci_cookie_file')
    ? config.vpnsci_cookie_file
    : config.instsci_cookie_file;
  const cookieFile = configured ? String(configured) : path.join(cacheDir, 'instsci-cookies.json');
  return { cacheDir, cookieFile, stateFile: path.join(cacheDir, 'browser_state.json') };
}

function cookiesToNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File\n'];
  for (const c of cookies) {
    const domain = String(c.domain || '');
    lines.push([
      domain,
      domain.startsWith('.') ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      String(Math.max(0, Math.trunc(Number(c.expires) || 0))),
      c.name || '',
      c.value || ''
    ].join('\t') + '\n');
  }
  return lines.join('');
}

// Only ever called with a ticket present: overwriting instsci-cookies.json with
// a logged-out jar would destroy a session that is still good.
function exportScansciSession(storageState) {
  const cookies = Array.isArray(storageState?.cookies) ? storageState.cookies : [];
  if (!hasWebvpnTicket(cookies)) return { exported: false, reason: 'no_webvpn_ticket_cookie' };
  try {
    const target = scansciTargets();
    fs.mkdirSync(target.cacheDir, { recursive: true });
    fs.mkdirSync(path.dirname(target.cookieFile), { recursive: true });
    fs.writeFileSync(target.cookieFile, JSON.stringify(cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '',
      path: c.path || '/',
      ...(c.secure ? { secure: true } : {}),
      ...(c.httpOnly ? { httpOnly: true } : {})
    })), null, 2), 'utf8');
    fs.writeFileSync(target.cookieFile.replace(/\.json$/i, '.txt'), cookiesToNetscape(cookies), 'utf8');
    const localStorage = {};
    for (const entry of storageState?.origins || []) {
      const items = {};
      for (const kv of entry.localStorage || []) items[kv.name] = kv.value;
      if (Object.keys(items).length) localStorage[entry.origin] = items;
    }
    fs.writeFileSync(target.stateFile, JSON.stringify({ cookies, localStorage }, null, 2), 'utf8');
    return { exported: true, cookie_file: target.cookieFile, state_file: target.stateFile, cookies: cookies.length };
  } catch (error) {
    return { exported: false, reason: error.message };
  }
}

// The ticket cookie outlives the CAS session that issued it: a profile can sit
// there holding wengine_vpn_ticket for days while every request through WebVPN
// is bounced to https://id.ustc.edu.cn/cas/login. So cookie presence alone is
// not evidence of a live session — it is the mirror image of the URL-substring
// bug, wrong in the other direction. Classify the page too.
function webvpnPageState(pageUrl) {
  let host = '';
  let href = String(pageUrl || '');
  try { host = new URL(href).hostname.toLowerCase(); } catch { return 'unknown'; }
  if (/(^|\.)wvpn\.ustc\.edu\.cn$/.test(host)) return 'portal';
  if (/(^|\.)id\.ustc\.edu\.cn$/.test(host) || /cas|sso|authserver/i.test(host) || /\/cas\/login/i.test(href)) return 'login';
  return 'unknown';
}

// --- automated WebVPN login -------------------------------------------------
//
// ~/.scansci-pdf/webvpn_auto_login.py drives the whole CAS flow: fills the form,
// waits for a captcha if one appears, clicks through the post-login
// confirmations, and writes the same three cookie files this script exports.
// Prefer it over the manual browser — it needs no human unless there is a
// captcha.
//
// Credentials never pass through Scholarium. The script reads them from
// USTC_USERNAME/USTC_PASSWORD or ~/.scansci-pdf/webvpn_credentials.json. We
// refuse to launch it unless one of those is already populated, because its
// last-resort branch is input()/getpass(); on a spawned process with no TTY
// that raises EOFError and the run dies with a confusing traceback.
const scansciHome = () => process.env.SCANSCI_PDF_DATA_DIR || path.join(os.homedir(), '.scansci-pdf');

function webvpnCredentialsAvailable() {
  if (process.env.USTC_USERNAME && process.env.USTC_PASSWORD) return { ok: true, source: 'env' };
  const file = path.join(scansciHome(), 'webvpn_credentials.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    if (parsed && parsed.username && parsed.password) return { ok: true, source: 'credentials_file' };
    return { ok: false, reason: `credentials file is missing username/password: ${file}` };
  } catch {
    return { ok: false, reason: `no credentials found — set USTC_USERNAME/USTC_PASSWORD or create ${file}` };
  }
}

// The interpreter must have BOTH cloakbrowser (the script's browser engine) and
// scansci_pdf (its session verifier). Probing for them is cheaper than letting
// the login run for minutes and fail on an import.
function resolveAutoLoginPython() {
  const candidates = [
    process.env.SCANSCI_PYTHON,
    'python',
    'python3'
  ].filter(Boolean);
  for (const exe of candidates) {
    const probe = spawnSync(exe, ['-c', 'import cloakbrowser, scansci_pdf'], { encoding: 'utf8', windowsHide: true });
    if (probe && probe.status === 0) return exe;
  }
  return null;
}

// Ground truth, not the script's own self-report: this is the exact check
// scansci-institutional runs before every batch.
function validateScansciSession(python) {
  const probe = spawnSync(python, ['-c',
    'from scansci_pdf.config import load_config\n'
    + 'from scansci_pdf.sources.instsci import _validate_session\n'
    + 'print("SESSION_VALID" if _validate_session(load_config()) else "SESSION_INVALID")'
  ], { encoding: 'utf8', windowsHide: true, timeout: 90000 });
  return String(probe?.stdout || '').includes('SESSION_VALID');
}

function runAutoLogin(root, input) {
  const base = {
    skill: 'paper-downloader',
    run_at: new Date().toISOString(),
    mode: 'auto_login',
    logged_in: false
  };
  const script = input.script || path.join(scansciHome(), 'webvpn_auto_login.py');
  if (!fs.existsSync(script)) {
    return { ...base, status: 'auto_login_unavailable', error: `script not found: ${script}`,
      next_step: 'Fall back to mode=login and sign in manually.' };
  }
  const creds = webvpnCredentialsAvailable();
  if (!creds.ok) {
    return { ...base, status: 'credentials_missing', error: creds.reason,
      next_step: 'Create the credentials file (or export USTC_USERNAME/USTC_PASSWORD), or fall back to mode=login.' };
  }
  const python = resolveAutoLoginPython();
  if (!python) {
    return { ...base, status: 'auto_login_unavailable',
      error: 'no interpreter has both cloakbrowser and scansci_pdf importable; set SCANSCI_PYTHON',
      next_step: 'Fall back to mode=login and sign in manually.' };
  }

  const timeoutSec = Number(input.timeoutSec || 300);
  const args = [script, '--mode', input.loginMode === 'publisher' ? 'publisher' : 'webvpn', '--timeout', String(timeoutSec)];
  if (input.loginMode === 'publisher' && input.doi) args.push('--doi', String(input.doi));
  // Headed by default: a captcha is the one thing this cannot automate, and in
  // headless mode the researcher has no window in which to solve it.
  if (input.headless === true) args.push('--headless');

  const run = spawnSync(python, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: (timeoutSec + 120) * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });

  const tail = String(run.stdout || '').split(/\r?\n/).filter(Boolean).slice(-12).join('\n');
  if (run.error) {
    return { ...base, status: 'failed', error: `auto-login launch failed: ${run.error.message}`, log_tail: tail };
  }
  const sessionValid = validateScansciSession(python);
  const scansciExport = {
    exported: sessionValid,
    cookie_file: path.join(scansciHome(), 'cache', 'instsci-cookies.json'),
    state_file: path.join(scansciHome(), 'cache', 'browser_state.json'),
    ...(sessionValid ? {} : { reason: 'session did not validate after auto-login' })
  };
  return {
    ...base,
    status: sessionValid ? 'logged_in' : (run.status === 0 ? 'login_unverified' : 'failed'),
    logged_in: sessionValid,
    evidence: sessionValid ? 'scansci_validate_session_passed' : 'scansci_validate_session_failed',
    credentials_source: creds.source,
    python,
    exit_code: run.status,
    scansci_session: scansciExport,
    log_tail: tail,
    next_step: sessionValid
      ? 'Institutional tier is ready. Rerun the Pipeline.'
      : 'Auto-login did not produce a valid session (captcha, wrong credentials, or CAS change). Retry headed, or fall back to mode=login.'
  };
}

// Poll instead of waiting out a fixed timer: the researcher should not have to
// close the window to make the tool move on, which is exactly the behaviour
// that made the scansci-pdf login feel broken.
async function waitForWebvpnLogin(context, page, startUrl, waitMs, pollMs = 2000) {
  const until = Date.now() + waitMs;
  for (;;) {
    let cookies;
    let currentUrl;
    try { cookies = await context.cookies(); currentUrl = page.url(); } catch { return 'closed'; }
    // Only re-probe once the cheap signals both look right; while the user is
    // still on the CAS form the state is 'login' and we must not navigate away
    // from the credentials they are typing.
    if (hasWebvpnTicket(cookies) && webvpnPageState(currentUrl) === 'portal') {
      const probed = await page
        .goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        .then(() => page.url())
        .catch(() => '');
      if (webvpnPageState(probed) === 'portal') return 'ticket';
      // Landed back on CAS: the cookie is stale, the session is dead. Fall
      // through and keep waiting for a real sign-in.
    }
    if (Date.now() >= until) return 'timeout';
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const MAX_BYTES = 120 * 1024 * 1024;
const DEFAULT_LOGIN_WAIT_MS = 180000;
const DEFAULT_NAV_TIMEOUT_MS = 70000;
const BANNED_DOMAINS = /(sci-hub\.[a-z.]{2,}|libgen\.[a-z.]{2,}|library\.lol|z-?lib(?:rary)?\.[a-z.]{2,}|annas-archive\.[a-z.]{2,}|booksc\.[a-z.]{2,})/i;
const NON_PDF_RESOURCE_EXT = /\.(?:jpe?g|png|gif|webp|svg|bmp|tiff?|json|xml|html?|txt|csv|ris|bib)(?:[?#].*)?$/i;

function readJson(value) {
  if (!value) return {};
  if (fs.existsSync(value)) return JSON.parse(fs.readFileSync(value, 'utf8').replace(/^\uFEFF/, ''));
  try { return JSON.parse(value); } catch { return { urls: [value] }; }
}

function expandInputFiles(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const file = input.records_file || input.input_file || input.recordsPath;
  if (!file) return input;
  const loaded = readJson(String(file));
  if (!loaded || typeof loaded !== 'object') return input;
  const loadedRecords = Array.isArray(loaded.records) ? loaded.records : (Array.isArray(loaded) ? loaded : []);
  return {
    ...loaded,
    ...input,
    records: Array.isArray(input.records) ? input.records : loadedRecords
  };
}

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeIssn(value) {
  return String(value || '').toUpperCase().replace(/[^0-9X]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
}

function nameMatches(candidate, target) {
  if (!candidate || !target) return false;
  // Blacklist matching must be conservative. Substring matching caused false
  // positives such as blacklist term "sensors" blocking the real journal
  // "Chemosensors". Use exact normalized venue/title aliases only.
  return candidate === target;
}

/* Resolve the journal partition whitelist directory.

   Until 2026-09-05 this was one developer's drive letter, written literally:
   '<developer-drive>\\journal-whitelist'.
   On any other machine that path does not exist, so loadJournalWhitelist fell
   straight through to `official_partition_whitelist_missing` and returned an
   EMPTY allow list — silently. Literature admission (the gate behind DEC-003
   and DEC-004) therefore had no whitelist at all and nothing said so.

   The 2026-09-05 replacement then had its own hole, found the same day by a
   real 0/35 run. The comment below used to say "`root` is the vault root",
   but it is not: the pipeline invokes this skill with the PROJECT folder
   (…/Research_mod/Au-TiO2), because that is where literature/downloaded-pdfs
   lives. So `<root>/Scholarium/journal-whitelist` resolved to
   …/Au-TiO2/Scholarium/journal-whitelist, which does not exist, and every
   record was again blocked as venue_not_whitelisted with an empty allow list.
   Measured: with root=<project> 35 of 35 blocked; with root=<vault> 0 blocked.

   The whitelist is vault-wide, not per-project — one copy per research project
   would be seven megabytes each and would drift apart. So ancestors of `root`
   are searched too, which finds the vault-level copy from any project folder
   without the caller having to know where the vault root is.

   Resolution order, first hit wins:
     1. SCHOLARIUM_JOURNAL_WHITELIST_DIR   (explicit override)
     2. <root>/Scholarium/journal-whitelist
     3. each ancestor of <root>: <ancestor>/Scholarium/journal-whitelist
     4. <repo>/agent-canvas-demo/skills/paper-downloader/journal-whitelist */
function journalWhitelistAncestors(root) {
  const out = [];
  if (!root) return out;
  let current = path.resolve(root);
  // Bounded walk: a vault nested more than eight levels below the project
  // folder is not a layout worth guessing at, and an unbounded loop here would
  // stat its way to the drive root on every download.
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = path.dirname(current);
    if (!parent || parent === current) break;
    current = parent;
    out.push(path.join(current, 'Scholarium', 'journal-whitelist'));
  }
  return out;
}

function resolveJournalWhitelistDir(root) {
  const candidates = [
    process.env.SCHOLARIUM_JOURNAL_WHITELIST_DIR,
    root ? path.join(root, 'Scholarium', 'journal-whitelist') : null,
    ...journalWhitelistAncestors(root),
    path.join(__dirname, '..', 'journal-whitelist'),
  ].filter(Boolean);
  for (const dir of candidates) {
    try { if (fs.existsSync(path.join(dir, 'whitelist_journals.json'))) return { dir, candidates }; }
    catch (_) { /* unreadable candidate is simply not a hit */ }
  }
  return { dir: null, candidates };
}

function loadJournalWhitelist(root) {
  const resolved = resolveJournalWhitelistDir(root);
  const officialDir = resolved.dir || '';
  const officialFile = officialDir ? path.join(officialDir, 'whitelist_journals.json') : '';
  const officialBlacklist = officialDir ? path.join(officialDir, 'blacklist.json') : '';
  const officialNames = officialDir ? path.join(officialDir, 'whitelist_names.txt') : '';
  const out = {
    enabled: true,
    source: 'official_partition_whitelist_missing',
    path: null,
    allow: [],
    allowIssns: [],
    denyTitlePatterns: [],
    blacklistNames: [],
    error: null
  };
  // Say so. An empty whitelist admits nothing and looks identical to a
  // whitelist that legitimately matched nothing; the caller must be able to
  // tell those apart, and so must whoever reads the run log afterwards.
  if (!officialDir) {
    out.error = '未找到期刊分区白名单目录。已尝试：' + resolved.candidates.join(' | ')
      + '。请设置 SCHOLARIUM_JOURNAL_WHITELIST_DIR，或把 whitelist_journals.json 放到 '
      + '<vaultRoot>/Scholarium/journal-whitelist/ 下。当前白名单为空，文献准入不会放行任何期刊。';
    out.searched = resolved.candidates;
    return out;
  }

  try {
    if (fs.existsSync(officialFile)) {
      const raw = JSON.parse(fs.readFileSync(officialFile, 'utf8'));
      const names = new Set();
      const issns = new Set();
      for (const [key, item] of Object.entries(raw || {})) {
        const primaryIssn = normalizeIssn(item?.issn || key);
        if (primaryIssn) issns.add(primaryIssn);
        for (const issn of item?.all_issns || []) {
          const normalized = normalizeIssn(issn);
          if (normalized) issns.add(normalized);
        }
        for (const name of item?.names || []) {
          const normalized = normalizeText(name);
          if (normalized) names.add(normalized);
        }
      }
      if (fs.existsSync(officialNames)) {
        for (const line of fs.readFileSync(officialNames, 'utf8').split(/\r?\n/)) {
          const normalized = normalizeText(line);
          if (normalized) names.add(normalized);
        }
      }
      if (fs.existsSync(officialBlacklist)) {
        const rawBlacklist = JSON.parse(fs.readFileSync(officialBlacklist, 'utf8'));
        for (const [key, item] of Object.entries(rawBlacklist || {})) {
          const name = normalizeText(item?.name || key);
          if (name) out.blacklistNames.push(name);
          const alias = normalizeText(key);
          if (alias) out.blacklistNames.push(alias);
        }
      }
      out.enabled = true;
      out.source = 'official_partition_whitelist';
      out.path = officialFile;
      out.allow = [...names];
      out.allowIssns = [...issns];
      return out;
    }

    out.error = `Official whitelist not found: ${officialFile}`;
  } catch (error) {
    out.error = error.message;
  }
  return out;
}

function recordAllowedByWhitelist(record, whitelist) {
  if (!whitelist?.enabled) return { allowed: true, reason: 'whitelist_disabled' };
  const title = String(record?.title || '');
  const venue = normalizeText(record?.venue || record?.journal || record?.container_title || '');
  if (whitelist.blacklistNames?.some((name) => nameMatches(venue, name))) {
    return { allowed: false, reason: 'blacklisted_venue_or_title' };
  }
  if (whitelist.denyTitlePatterns.some((pattern) => pattern.test(title))) {
    return { allowed: false, reason: 'deny_title_pattern' };
  }
  const recordIssns = []
    .concat(record?.venue_issn_l || [])
    .concat(record?.venue_issns || [])
    .map(normalizeIssn)
    .filter(Boolean);
  if (recordIssns.some((issn) => whitelist.allowIssns?.includes(issn))) {
    return { allowed: true, reason: 'issn_whitelisted', venue, issn: recordIssns.find((issn) => whitelist.allowIssns?.includes(issn)) };
  }
  if (!venue) return { allowed: false, reason: 'missing_venue' };
  const allowed = whitelist.allow.some((name) => venue === name || venue.includes(name) || name.includes(venue));
  return { allowed, reason: allowed ? 'venue_whitelisted' : 'venue_not_whitelisted', venue };
}

function bestUrlsForRecord(rec) {
  const candidates = [];
  const pdf = String(rec?.pdf_url || '').trim();
  const landing = String(rec?.landing_page_url || rec?.url || '').trim();
  const doi = String(rec?.doi || '').trim();
  if (/^https?:\/\//i.test(pdf) && !NON_PDF_RESOURCE_EXT.test(pdf)) candidates.push(pdf);
  if (/^https?:\/\//i.test(landing) && landing !== pdf) candidates.push(landing);
  if (/^https?:\/\//i.test(doi) && doi !== landing && doi !== pdf) candidates.push(doi);
  return candidates;
}

function urlsFrom(input) {
  const urls = [];
  if (Array.isArray(input)) {
    for (const item of input) urls.push(...urlsFrom(item));
  } else if (input && typeof input === 'object') {
    for (const key of ['urls', 'pdf_urls', 'landing_page_urls', 'doi_urls']) {
      if (Array.isArray(input[key])) urls.push(...input[key].map(String));
    }
    if (Array.isArray(input.records)) {
      for (const rec of input.records) {
        if (!rec || typeof rec !== 'object') continue;
        urls.push(...bestUrlsForRecord(rec));
      }
    }
  } else if (typeof input === 'string') {
    urls.push(input);
  }
  return [...new Set(urls.filter((url) => /^https?:\/\//i.test(url)))];
}

function applyDownloadWhitelist(input, whitelist) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.records) || !whitelist?.enabled) {
    return { input, blocked: [] };
  }
  const kept = [];
  const blocked = [];
  for (const record of input.records) {
    const decision = recordAllowedByWhitelist(record, whitelist);
    if (decision.allowed) kept.push(record);
    else blocked.push({
      status: 'blocked_not_whitelisted',
      title: record?.title || '',
      venue: record?.venue || record?.journal || record?.container_title || '',
      doi: record?.doi || '',
      reason: decision.reason
    });
  }
  return { input: { ...input, records: kept }, blocked };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeName(source, idx) {
  let raw = '';
  try {
    const parsed = new URL(source);
    raw = path.basename(decodeURIComponent(parsed.pathname)) || parsed.hostname || `paper-${idx}`;
  } catch {
    raw = `paper-${idx}`;
  }
  if (!/\.pdf$/i.test(raw)) raw = `${raw || `paper-${idx}`}.pdf`;
  raw = raw.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 150);
  return raw || `paper-${idx}.pdf`;
}

function uniqueTarget(outDir, name) {
  const parsed = path.parse(name);
  let target = path.join(outDir, name);
  let n = 2;
  while (fs.existsSync(target)) {
    target = path.join(outDir, `${parsed.name}-${n++}${parsed.ext || '.pdf'}`);
  }
  return target;
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

// Each channel may publish to its own atomically-written state file.  Keeping
// the default preserves existing callers; progress_file lets the orchestrator
// run independent acquisition channels without their counters overwriting one
// another.
function createBatchProgress(root, runtime, total, requestedFile) {
  const target = requestedFile
    ? path.resolve(root, String(requestedFile))
    : path.join(runtime, 'download-progress.json');
  const rel = path.relative(path.resolve(root), target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('progress_file must be inside the authorized workspace');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const state = {
    done: 0, total, downloaded: 0, failed: 0, skipped_or_resumed: 0,
    current: '', status: 'running', phase: 'parallel_browser', started_at: Date.now(),
    updated_at: Date.now(), source: 'paper-downloader',
    downloaded_paths: []
  };
  const write = () => {
    state.updated_at = Date.now();
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), 'utf8');
      fs.renameSync(temporary, target);
    } catch {
      try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    }
  };
  write();
  return {
    update(result, current) {
      state.done += 1;
      state.current = String(current || '');
      if (result?.status === 'downloaded') {
        state.downloaded += 1;
        if (result.path && !state.downloaded_paths.includes(result.path)) state.downloaded_paths.push(result.path);
      }
      else if (result?.status === 'skipped_non_pdf_resource') state.skipped_or_resumed += 1;
      else state.failed += 1;
      write();
    },
    finish(status = 'finished') {
      state.status = status;
      state.phase = 'finished';
      write();
    }
  };
}

/* --- 人工确认后抓取当前页（单篇） -----------------------------------------
 *
 * 出版商的反爬挑战挡住自动下载时，原来的结局是：截图、报 anti_bot_challenge、
 * 结束。可研究员就坐在屏幕前，页面就开着，却没有任何入口能说"我已经过了，
 * 抓吧"。这个模式补的就是这一环。
 *
 * 三条设计约束，都是有意为之：
 *
 * 1) 严格单篇。入参只接受一个 doi/url，给数组直接拒绝，抓完即止、绝不自动
 *    推进下一篇。理由不是技术限制：让自动化复用人工通过的反爬验证，单篇等同
 *    于研究员自己点"下载 PDF"；一旦挂上队列循环，就变成了拿人工验证给批量
 *    爬虫开路，性质完全不同，多数出版商的条款也明确禁止批量下载。
 *
 * 2) 由人在页面里决定。浮层直接注入文章页，"抓取本篇"和"跳过本篇"两个按钮
 *    经 exposeBinding 回传。不猜"挑战是不是过了"——只有研究员知道自己看到了
 *    什么。跳过是一等公民，不是超时的副产品。
 *
 * 3) 抓取走页面自己的会话。page.request 继承该上下文的 cookie（含刚拿到的
 *    Cloudflare clearance），所以不需要把凭据搬到别处，也不会二次触发挑战。
 *
 * PDF 拿不到时退而存 Markdown，但证据等级降一档：HTML 正文常缺图表和补充
 * 材料，下游不该把它当成和 PDF 同等的证据。
 */
function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from('%PDF'));
}

const MANUAL_CAPTURE_OVERLAY_ID = 'scholarium-manual-capture';

async function extractReadableMarkdown(page) {
  return page.evaluate(() => {
    const selectors = ['article', 'main', '[role="main"]', '#content', '.article-content', '.fulltext'];
    let host = null;
    for (const selector of selectors) {
      const candidate = document.querySelector(selector);
      if (candidate?.innerText?.trim().length > 400) { host = candidate; break; }
    }
    host ||= document.body;
    const clone = host.cloneNode(true);
    for (const junk of clone.querySelectorAll(`script,style,nav,footer,noscript,iframe,#${MANUAL_CAPTURE_OVERLAY_ID}`)) junk.remove();
    const title = (document.querySelector('h1') || {}).innerText || document.title || '';
    const text = (clone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    return { title: String(title).trim(), text };
  });
}

function absoluteUrl(href, baseUrl) {
  try { return new URL(href, baseUrl).href; } catch { return null; }
}

function scienceDirectPdfFromElsevierUrl(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/retrieve\/pii\/([^/?#]+)/i) || parsed.pathname.match(/\/science\/article\/pii\/([^/?#]+)/i);
    if (!match) return null;
    return `https://www.sciencedirect.com/science/article/pii/${match[1]}/pdf`;
  } catch {
    return null;
  }
}

function loadPlaywright(root) {
  try {
    return { playwright: require('playwright'), error: null };
  } catch (error) {
    return {
      playwright: null,
      error: {
        status: 'missing_playwright',
        message: 'Playwright is not installed for agent-canvas-demo.',
        install_commands: [
          `cd "${path.join(root, '.obsidian', 'plugins', 'obsidian-scholarium', 'agent-canvas-demo')}"`,
          'npm install',
          'npx playwright install chromium'
        ],
        note: 'After npm install, the downloader tries Chrome, Edge, and the Playwright Chromium browser in that order.'
      }
    };
  }
}

function writeWebvpnLoginStatus(root, manifest) {
  try {
    const runtimeDir = ensureDir(path.join(root, 'Scholarium', 'runtime'));
    fs.writeFileSync(
      path.join(runtimeDir, 'webvpn-login-status.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );
  } catch { /* status file is best-effort */ }
}

function browserChannelCandidates(input) {
  if (input.channel === false) return [false];
  const requested = input.channel || 'chrome';
  const candidates = [requested];
  // Chrome is the historical default, but a clean Windows machine may only
  // have Edge. Keep the requested channel first, then use the Playwright
  // Chromium binary if it was installed by the portable setup step.
  if (requested === 'chrome') candidates.push('msedge');
  candidates.push(false);
  return [...new Set(candidates)];
}

async function launchResearchBrowser(playwright, profileDir, launchOptions, input) {
  let lastError = null;
  for (const channel of browserChannelCandidates(input)) {
    const options = { ...launchOptions };
    if (channel === false) delete options.channel;
    else options.channel = channel;
    try {
      const context = await playwright.chromium.launchPersistentContext(profileDir, options);
      return { context, channel: channel || 'playwright-chromium' };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No supported browser channel is available.');
}

function runLegacyCookieJar(root, inputArg) {
  const legacy = path.join(__dirname, 'download_with_cookies.py');
  const run = spawnSync('python', [legacy, root, inputArg || ''], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (run.error) throw new Error(run.error.message);
  if (run.status !== 0) throw new Error(String(run.stderr || run.stdout || 'legacy downloader failed').slice(0, 800));
  return JSON.parse(run.stdout);
}

function classifyLogin(pageUrl, title, text) {
  const haystack = `${pageUrl}\n${title}\n${text}`.toLowerCase();
  return /(cas|login|sign in|sso|统一身份|身份认证|登录|webvpn|authserver)/i.test(haystack);
}

function assessWebvpnSession(pageUrl, title, text) {
  const haystack = `${pageUrl}\n${title}\n${text}`.toLowerCase();
  const loginLike = /(authserver|cas|passport|login|sign in|统一身份|身份认证|账号|密码|登录)/i.test(haystack);
  const portalLike = /(webvpn|资源|图书馆|数据库|访问|校园网|中国科学技术大学|ustc)/i.test(haystack);
  return {
    logged_in: portalLike && !loginLike,
    needs_login: loginLike,
    url: pageUrl,
    title: title || '',
    evidence: loginLike ? 'login_page_detected' : portalLike ? 'webvpn_portal_detected' : 'unknown_page'
  };
}

function classifyAccessBlock(pageUrl, title, text) {
  const haystack = `${pageUrl}\n${title}\n${text}`.toLowerCase();
  if (/just a moment|checking your browser|cf_chl|cloudflare|verify you are human|challenge-platform/.test(haystack)) {
    return {
      status: 'anti_bot_challenge',
      error: 'Publisher anti-bot/Cloudflare challenge blocked unattended download. Open the page in the persistent browser profile once, solve the challenge, then rerun.'
    };
  }
  if (/access denied|forbidden|request blocked|temporarily unavailable|unusual traffic/.test(haystack)) {
    return {
      status: 'access_denied',
      error: 'Publisher returned an access-denied page instead of a PDF. This may require WebVPN/CARSI login, a visible browser challenge, or a different OA source.'
    };
  }
  return null;
}

async function savePdfBuffer(root, outDir, sourceUrl, idx, buffer, finalUrl) {
  if (!isPdfBuffer(buffer)) return null;
  if (buffer.length > MAX_BYTES) throw new Error('PDF exceeds safety size limit');
  const target = uniqueTarget(outDir, safeName(sourceUrl, idx));
  fs.writeFileSync(target, buffer);
  return {
    status: 'downloaded',
    path: relative(root, target),
    bytes: buffer.length,
    final_url: finalUrl || sourceUrl
  };
}

async function tryRequestPdf(root, outDir, requestContext, url, idx) {
  try {
    const response = await requestContext.get(url, {
      timeout: DEFAULT_NAV_TIMEOUT_MS,
      headers: {
        accept: 'application/pdf,application/octet-stream;q=0.9,text/html;q=0.8,*/*;q=0.7'
      }
    });
    if (!response.ok()) return null;
    const ctype = response.headers()['content-type'] || '';
    const buffer = await response.body();
    if (/pdf/i.test(ctype) || isPdfBuffer(buffer)) {
      const saved = await savePdfBuffer(root, outDir, url, idx, buffer, response.url());
      if (saved) return saved;
    }
  } catch {
    // Browser navigation/clicking may still work; keep this as a best-effort fast path.
  }
  return null;
}

async function tryResponsePdf(root, outDir, page, url, idx) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS });
  const ctype = response?.headers()?.['content-type'] || '';
  if (response && /pdf/i.test(ctype)) {
    const buffer = await response.body();
    const saved = await savePdfBuffer(root, outDir, url, idx, buffer, response.url());
    if (saved) return saved;
  }
  return null;
}

async function tryClickPdf(root, outDir, page, url, idx) {
  const candidates = [
    'a[href$=".pdf"]',
    'a[href*=".pdf"]',
    'a[href*="/pdf"]',
    'a[href*="pdf"]',
    'a[download][href*=".pdf"]',
    'a[aria-label*="PDF" i]',
    'a:has-text("PDF")',
    'a:has-text("Download PDF")',
    'button[aria-label*="PDF" i]',
    'button:has-text("PDF")'
  ];
  for (const selector of candidates) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.count() === 0) continue;
      const href = await locator.getAttribute('href').catch(() => null);
      const targetUrl = href ? absoluteUrl(href, page.url()) : null;
      if (targetUrl && /^https?:\/\//i.test(targetUrl)) {
        const directSaved = await tryRequestPdf(root, outDir, page.context().request, targetUrl, idx);
        if (directSaved) return directSaved;
        const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS });
        const ctype = response?.headers()?.['content-type'] || '';
        if (response && /pdf/i.test(ctype)) {
          const saved = await savePdfBuffer(root, outDir, targetUrl, idx, await response.body(), response.url());
          if (saved) return saved;
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS }).catch(() => {});
        continue;
      }
      const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
      await locator.click({ timeout: 10000 });
      const download = await downloadPromise;
      if (!download) continue;
      const suggested = download.suggestedFilename() || safeName(url, idx);
      const target = uniqueTarget(outDir, safeName(suggested, idx));
      await download.saveAs(target);
      const buffer = fs.readFileSync(target);
      if (!isPdfBuffer(buffer)) {
        fs.unlinkSync(target);
        continue;
      }
      const artifact = await download.path().catch(() => null);
      if (artifact && fs.existsSync(artifact) && path.resolve(artifact) !== path.resolve(target)) {
        fs.unlinkSync(artifact);
      }
      return { status: 'downloaded', path: relative(root, target), bytes: buffer.length, final_url: page.url() };
    } catch {
      // Try the next selector.
    }
  }
  return null;
}

async function downloadOne(root, dirs, context, url, idx) {
  if (BANNED_DOMAINS.test(url)) {
    return { url, status: 'blocked_policy', error: 'Piracy/mirror domains are not allowed. Use institutional WebVPN/CARSI or publisher pages.' };
  }
  if (NON_PDF_RESOURCE_EXT.test(url) && !/\.pdf(?:[?#].*)?$/i.test(url)) {
    return { url, status: 'skipped_non_pdf_resource', error: 'The URL points to a non-PDF resource such as an image or metadata file.' };
  }
  const requestSaved = await tryRequestPdf(root, dirs.out, context.request, url, idx);
  if (requestSaved) return { url, ...requestSaved, method: 'direct_request_pdf' };

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const screenshot = path.join(dirs.screenshots, `paper-${idx}-${Date.now()}.png`);
  try {
    const responseSaved = await tryResponsePdf(root, dirs.out, page, url, idx);
    if (responseSaved) return { url, ...responseSaved, method: 'response_pdf' };

    const title = await page.title().catch(() => '');
    const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    if (classifyLogin(page.url(), title, bodyText.slice(0, 4000))) {
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      return { url, status: 'needs_login', page_url: page.url(), title, screenshot: relative(root, screenshot), error: 'Browser profile is not logged in or institutional access expired.' };
    }

    const accessBlock = classifyAccessBlock(page.url(), title, bodyText.slice(0, 4000));
    if (accessBlock) {
      await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
      return { url, ...accessBlock, page_url: page.url(), title, screenshot: relative(root, screenshot) };
    }

    const elsevierPdf = scienceDirectPdfFromElsevierUrl(page.url());
    if (elsevierPdf) {
      const saved = await tryRequestPdf(root, dirs.out, context.request, elsevierPdf, idx);
      if (saved) return { url, ...saved, method: 'elsevier_pii_pdf' };
    }

    const clickedSaved = await tryClickPdf(root, dirs.out, page, url, idx);
    if (clickedSaved) return { url, ...clickedSaved, method: 'clicked_pdf_link' };

    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    return {
      url,
      status: 'manual_required',
      page_url: page.url(),
      title,
      screenshot: relative(root, screenshot),
      error: 'No downloadable PDF was found automatically. Open the screenshot/page manually, then rerun with a direct PDF URL if available.'
    };
  } catch (error) {
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    return { url, status: /timeout/i.test(error.message) ? 'timeout' : 'failed', page_url: page.url(), screenshot: fs.existsSync(screenshot) ? relative(root, screenshot) : null, error: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const inputArg = process.argv[3] || '';
  let input = expandInputFiles(readJson(inputArg));
  const loginStartedAt = new Date().toISOString();

  // The login runner is launched detached by the Bridge. Stamp the run before
  // loading optional dependencies, otherwise a missing Playwright package can
  // leave the UI polling the previous auto-login result indefinitely.
  if (input.mode === 'login') {
    writeWebvpnLoginStatus(root, {
      skill: 'paper-downloader',
      mode: 'login',
      status: 'starting',
      started_at: loginStartedAt,
      logged_in: false
    });
  }

  if (input.mode === 'direct_cookie_jar') {
    console.log(JSON.stringify(runLegacyCookieJar(root, inputArg), null, 2));
    return;
  }

  // Runs before the Playwright context is launched: auto-login uses its own
  // cloakbrowser process and has nothing to do with the persistent profile.
  if (input.mode === 'auto_login') {
    const manifest = runAutoLogin(root, input);
    try {
      const runtimeDir = ensureDir(path.join(root, 'Scholarium', 'runtime'));
      fs.writeFileSync(path.join(runtimeDir, 'webvpn-login-status.json'), JSON.stringify(manifest, null, 2), 'utf8');
    } catch { /* status file is best-effort */ }
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const runtime = ensureDir(path.join(root, 'Scholarium', 'runtime'));
  const whitelist = loadJournalWhitelist(root);
  const whitelistResult = applyDownloadWhitelist(input, whitelist);
  input = whitelistResult.input;
  const profileDir = ensureDir(input.profileDir ? path.resolve(input.profileDir) : path.join(runtime, 'webvpn-browser-profile'));
  const out = ensureDir(input.outputDir ? path.resolve(input.outputDir) : path.join(root, 'literature', 'downloaded-pdfs'));
  const logs = ensureDir(path.join(runtime, 'download-logs'));
  const screenshots = ensureDir(path.join(runtime, 'download-screenshots'));
  const downloadArtifacts = ensureDir(path.join(runtime, 'download-artifacts'));
  const dirs = { out, logs, screenshots, downloadArtifacts };
  // A manual capture is a researcher-confirmed single-paper action. It must not
  // overwrite or impersonate the progress ledger of an unattended batch.
  const isBatchDownload = !['login', 'session_status', 'status', 'dry_run', 'manual_capture'].includes(input.mode) && input.action !== 'session_status';
  // Calculate this once, before Chromium starts.  It both gives immediate UI
  // feedback and makes the progress total stable for the complete fallback.
  const batchUrls = isBatchDownload ? urlsFrom(input) : null;
  const batchProgress = isBatchDownload ? createBatchProgress(root, runtime, batchUrls.length, input.progress_file) : null;

  if (input.mode === 'dry_run') {
    const urls = urlsFrom(input);
    console.log(JSON.stringify({
      skill: 'paper-downloader',
      run_at: new Date().toISOString(),
      mode: 'dry_run',
      session_policy: 'persistent_browser_profile',
      whitelist: {
        enabled: Boolean(whitelist.enabled),
        path: whitelist.path ? relative(root, whitelist.path) : null,
        source: whitelist.source || null,
        allow_count: whitelist.allow?.length || 0,
        allow_issn_count: whitelist.allowIssns?.length || 0,
        blocked_not_whitelisted: whitelistResult.blocked.length,
        error: whitelist.error || null
      },
      candidate_records_after_whitelist: Array.isArray(input.records) ? input.records.length : null,
      candidate_urls_after_whitelist: urls.length,
      blocked: whitelistResult.blocked.slice(0, 200)
    }, null, 2));
    return;
  }

  const { playwright, error } = loadPlaywright(root);
  if (!playwright) {
    const manifest = {
      skill: 'paper-downloader',
      run_at: new Date().toISOString(),
      mode: input.mode || 'download',
      session_policy: 'persistent_browser_profile',
      profile_dir: relative(root, profileDir),
      results: [],
      error
    };
    if (input.mode === 'login') {
      writeWebvpnLoginStatus(root, {
        ...manifest,
        status: 'login_failed',
        logged_in: false,
        next_step: '请在该演示 Vault 的 agent-canvas-demo 目录执行 npm install；随后执行 npx playwright install chromium，再重试。'
      });
    }
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // Login needs a real, visible window (the researcher has to see and click
  // through WebVPN/CARSI's CAS login page), so it stays headed unless someone
  // explicitly asks otherwise. Every other mode is the unattended batch
  // download step the Pipeline runs against ~dozens/hundreds of URLs, and
  // headless Chromium/Chrome renders pages, clicks links, and captures
  // downloads identically to headed mode — the only difference is no visible
  // window. Default that path to headless so a Pipeline run doesn't pop open
  // one browser tab per paper; still respect an explicit {"headless": false}
  // for debugging a stuck download.
  // login 和 manual_capture 都必须有头：整个流程的前提就是研究员要能看见页面、
  // 亲手过验证。headless 传 true 也不迁就——那会让浮层永远等不到点击。
  const isLoginMode = input.mode === 'login';
  const isHumanInLoop = isLoginMode || input.mode === 'manual_capture';
  const launchOptions = {
    // Human-in-the-loop modes always stay visible; accepting headless=true here
    // would create a dialog that can never receive the required human click.
    headless: isHumanInLoop ? false : (input.headless !== false),
    acceptDownloads: true,
    downloadsPath: downloadArtifacts,
    viewport: { width: 1360, height: 900 }
  };
  let context;
  let browserChannel = null;
  try {
    const launched = await launchResearchBrowser(playwright, profileDir, launchOptions, input);
    context = launched.context;
    browserChannel = launched.channel;
  } catch (error) {
    batchProgress?.finish('error');
    const manifest = {
      skill: 'paper-downloader',
      run_at: new Date().toISOString(),
      mode: input.mode || 'download',
      session_policy: 'persistent_browser_profile',
      profile_dir: relative(root, profileDir),
      results: [],
      error: {
        status: 'browser_launch_failed',
        message: error.message,
        recovery: [
          'Install dependencies with: npm install',
          'Install the portable browser with: npx playwright install chromium',
          'Alternatively install Chrome or Edge and retry.'
        ]
      }
    };
    if (input.mode === 'login') {
      writeWebvpnLoginStatus(root, {
        ...manifest,
        status: 'login_failed',
        logged_in: false,
        next_step: '未能启动 Chrome、Edge 或 Playwright Chromium；请先安装运行依赖和 Chromium，再重试。'
      });
    }
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  try {
    if (input.mode === 'session_status' || input.mode === 'status' || input.action === 'session_status') {
      const page = await context.newPage();
      const startUrl = input.url || 'https://wvpn.ustc.edu.cn/';
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: Number(input.timeoutMs || 30000) }).catch(() => {});
      await page.waitForTimeout(1200).catch(() => {});
      const title = await page.title().catch(() => '');
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      const session = assessWebvpnSession(page.url(), title, bodyText.slice(0, 4000));
      const storageState = await context.storageState({ path: path.join(runtime, 'webvpn-storage-state.json') }).catch(() => ({ cookies: [] }));
      const ticketPresent = hasWebvpnTicket(storageState.cookies);
      const scansciExport = exportScansciSession(storageState);
      await page.close().catch(() => {});
      const loggedIn = Boolean(session.logged_in || ticketPresent);
      console.log(JSON.stringify({
        skill: 'paper-downloader',
        run_at: new Date().toISOString(),
        mode: 'session_status',
        session_policy: 'persistent_browser_profile',
        profile_dir: relative(root, profileDir),
        status: loggedIn ? 'logged_in' : session.needs_login ? 'needs_login' : 'unknown',
        ...session,
        logged_in: loggedIn,
        needs_login: loggedIn ? false : session.needs_login,
        evidence: loggedIn && ticketPresent && !session.logged_in ? 'webvpn_ticket_cookie_present' : session.evidence,
        scansci_session: scansciExport
      }, null, 2));
      return;
    }

    if (input.mode === 'manual_capture') {
      // Enforce the single-paper boundary here as well as at the Bridge. Never
      // silently take the first item from a batch-shaped request.
      if (Array.isArray(input.urls) || Array.isArray(input.records) || Array.isArray(input.dois)) {
        throw new Error('manual_capture 只接受单篇（url 或 doi）；批量入参已拒绝');
      }
      const target = String(input.url || (input.doi
        ? `https://doi.org/${String(input.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`
        : '')).trim();
      if (!target) throw new Error('manual_capture 需要 url 或 doi');

      const page = await context.newPage();
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS }).catch(() => {});

      // 决定权交给页面里的人。不去猜挑战过没过——只有他知道自己看到了什么。
      let decision = null;
      const decided = new Promise((resolve) => {
        page.exposeBinding('__scholariumManualDecision', async (_source, value) => {
          if (decision) return;
          decision = String(value || '').trim() || 'skip';
          resolve(decision);
        }).catch(() => {});
      });
      const renderOverlay = async () => {
        await page.evaluate((overlayId) => {
          if (document.getElementById(overlayId)) return;
          const box = document.createElement('div');
          box.id = overlayId;
          box.setAttribute('style', [
            'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
            'background:#1c1c1e', 'color:#fff', 'padding:14px 16px', 'border-radius:12px',
            'font:13px/1.5 system-ui,sans-serif', 'box-shadow:0 8px 28px rgba(0,0,0,.45)',
            'max-width:320px',
          ].join(';'));
          box.innerHTML = '<div style="font-weight:600;margin-bottom:6px">织研者 · 人工确认抓取</div>'
            + '<div style="opacity:.8;margin-bottom:10px">通过验证 / 登录后再点抓取。只处理这一篇，不会自动继续下一篇。</div>'
            + `<button id="${overlayId}-go" style="background:#30d158;border:0;color:#000;padding:6px 12px;border-radius:8px;font-weight:600;cursor:pointer">抓取本篇</button>`
            + `<button id="${overlayId}-skip" style="background:transparent;border:1px solid #666;color:#ddd;padding:6px 12px;border-radius:8px;margin-left:8px;cursor:pointer">跳过本篇</button>`;
          document.body.appendChild(box);
          document.getElementById(`${overlayId}-go`).onclick = () => window.__scholariumManualDecision('capture');
          document.getElementById(`${overlayId}-skip`).onclick = () => window.__scholariumManualDecision('skip');
        }, MANUAL_CAPTURE_OVERLAY_ID).catch(() => {});
      };
      await renderOverlay();
      // 人工过验证往往要跳转好几次，每次导航都把浮层重新贴上去。
      page.on('domcontentloaded', () => { renderOverlay(); });

      const waitMs = Number(input.waitMs) || 15 * 60 * 1000;
      const closed = new Promise((resolve) => context.once('close', () => resolve('closed')));
      const timedOut = new Promise((resolve) => setTimeout(() => resolve('timeout'), waitMs));
      const outcome = await Promise.race([decided, closed, timedOut]);
      const manifest = {
        skill: 'paper-downloader', run_at: new Date().toISOString(), mode: 'manual_capture',
        single_item: true, auto_advance: false,
        requested: target, decision: outcome,
        profile_dir: relative(root, profileDir),
        results: [], downloaded_paths: [],
      };

      if (outcome !== 'capture') {
        manifest.status = outcome === 'skip' ? 'skipped_by_researcher'
          : outcome === 'closed' ? 'window_closed_before_decision' : 'no_decision_within_wait';
        manifest.next_step = outcome === 'skip'
          ? '已按研究员意愿跳过这一篇；它不会再回到待处理队列。'
          : '没有收到抓取决定，本篇保持未处理。';
        await context.close().catch(() => {});
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }

      // Use the page request context so the just-established session/cookies
      // stay attached. A response is accepted only after the PDF magic bytes.
      const pageUrl = page.url();
      let saved = null;
      const candidates = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
        .map((anchor) => anchor.getAttribute('href'))
        .filter((href) => href && /\.pdf(\?|$)|\/pdf\/|pdfdirect|type=printable|\/doi\/pdf\//i.test(href))
        .slice(0, 12)).catch(() => []);
      const tried = [];
      for (const href of [...new Set(candidates)]) {
        const absolute = absoluteUrl(href, pageUrl);
        if (!absolute) continue;
        tried.push(absolute);
        try {
          const response = await page.request.get(absolute, { timeout: 90000 });
          const buffer = Buffer.from(await response.body());
          if (isPdfBuffer(buffer)) {
            saved = await savePdfBuffer(root, out, absolute, 0, buffer, absolute);
            break;
          }
        } catch { /* try the next candidate */ }
      }

      if (saved) {
        manifest.status = 'downloaded';
        manifest.evidence_tier = 'publisher_pdf';
        manifest.results = [{ status: 'downloaded', url: pageUrl, path: saved.path, via: 'manual_capture_pdf' }];
        manifest.downloaded_paths = [saved.path];
        manifest.next_step = '已保存 PDF；可直接进入证据卡片步骤。';
      } else if (input.allow_markdown_fallback === true) {
        const article = await extractReadableMarkdown(page);
        if (!article.text || article.text.length < 400) {
          manifest.status = 'no_fulltext_on_page';
          manifest.tried_pdf_urls = tried;
          manifest.next_step = '页面上既没有可取的 PDF，正文也太短，未保存任何内容。';
        } else {
          const mdDir = ensureDir(path.join(root, 'literature', 'captured-html'));
          const file = uniqueTarget(mdDir, safeName(article.title || pageUrl, 0).replace(/\.pdf$/i, '') + '.md');
          fs.writeFileSync(file, `---\nsource_url: ${JSON.stringify(pageUrl)}\ncaptured_at: ${JSON.stringify(new Date().toISOString())}\nevidence_tier: html_fulltext\n---\n\n# ${article.title}\n\n${article.text}\n`, 'utf8');
          manifest.status = 'captured_html';
          // 明确降一档：HTML 正文常缺图表与补充材料，下游不能当 PDF 用。
          manifest.evidence_tier = 'html_fulltext';
          manifest.results = [{ status: 'captured_html', url: pageUrl, path: relative(root, file), via: 'manual_capture_markdown' }];
          manifest.captured_paths = [relative(root, file)];
          manifest.next_step = '未取到 PDF，已保存页面正文为 Markdown（证据等级低于 PDF：可能缺图表与补充材料）。';
        }
      } else {
        manifest.status = 'no_pdf_found';
        manifest.tried_pdf_urls = tried;
        manifest.next_step = '页面上没有找到可下载的 PDF 链接；如需保存正文，请在调用时开启 allow_markdown_fallback。';
      }
      await context.close().catch(() => {});
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    if (input.mode === 'login') {
      const page = await context.newPage();
      const startUrl = input.url || 'https://wvpn.ustc.edu.cn/';
      // Stamp "running" before anything can fail, so a poller never mistakes the
      // previous run's result for this one's.
      writeWebvpnLoginStatus(root, {
        skill: 'paper-downloader', mode: 'login', status: 'running',
        started_at: loginStartedAt, logged_in: false,
        browser_channel: browserChannel
      });
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: DEFAULT_NAV_TIMEOUT_MS }).catch(() => {});

      // Finish as soon as the WebVPN ticket cookie appears, rather than sitting
      // out the full waitMs or requiring the researcher to close the window.
      // Racing the context-close event as well, so a closed browser still ends
      // the run instead of polling a dead context.
      const contextClosed = new Promise((resolve) => {
        context.once('close', () => resolve('closed'));
      });
      const reason = await Promise.race([
        contextClosed,
        waitForWebvpnLogin(context, page, startUrl, Number(input.waitMs || DEFAULT_LOGIN_WAIT_MS))
      ]);

      // Export only on a verified live session. Writing a stale jar out to
      // scansci-pdf is worse than writing nothing: the institutional tier then
      // believes it has cookies and fails per-DOI instead of saying needs_login.
      let scansciExport = { exported: false, reason: `login_not_verified:${reason}` };
      if (reason === 'ticket') {
        const storageState = await context
          .storageState({ path: path.join(runtime, 'webvpn-storage-state.json') })
          .catch(() => ({ cookies: [] }));
        scansciExport = exportScansciSession(storageState);
      }
      // If the browser was closed by the user, Playwright's persistent context
      // automatically saves cookies/session to the profile directory on close,
      // but the context is gone, so nothing can be exported from this run.

      const manifest = {
        skill: 'paper-downloader',
        run_at: new Date().toISOString(),
        mode: 'login',
        status: reason === 'ticket'
          ? 'logged_in'
          : reason === 'closed' ? 'login_window_closed_by_user' : 'login_wait_timeout',
        logged_in: reason === 'ticket',
        evidence: reason === 'ticket'
          ? 'webvpn_portal_reachable_with_ticket_cookie'
          : reason === 'closed' ? 'login_window_closed_before_sign_in' : 'still_on_cas_login_when_wait_expired',
        profile_dir: relative(root, profileDir),
        browser_channel: browserChannel,
        scansci_session: scansciExport,
        next_step: reason === 'ticket'
          ? 'WebVPN/CARSI session verified and exported to scansci-pdf. Rerun the Pipeline; the institutional tier will reuse it.'
          : 'The WebVPN portal still redirects to CAS. Rerun mode=login and complete the sign-in; leave the window open — it closes itself once the session is verified.'
      };
      // The Bridge launches mode=login detached (stdio ignored) so the UI is not
      // blocked for the whole wait, which means this stdout goes nowhere. Drop
      // the same manifest on disk so the UI can poll it and report the real
      // outcome instead of optimistically turning the button green.
      writeWebvpnLoginStatus(root, manifest);
      console.log(JSON.stringify(manifest, null, 2));
      return;
    }

    const urls = batchUrls || urlsFrom(input);
    const outcomes = new Array(urls.length);
    let cursor = 0;
    // A persistent authenticated context can safely own a small number of
    // pages.  Two workers materially improve throughput without creating the
    // login/captcha storm caused by one browser process per paper.  The limit
    // remains configurable and deliberately capped.
    const browserWorkers = Math.max(1, Math.min(3, Number(input.browser_workers) || 2));
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= urls.length) return;
        const outcome = await downloadOne(root, dirs, context, urls[i], i + 1);
        outcomes[i] = outcome;
        batchProgress?.update(outcome, urls[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(browserWorkers, Math.max(1, urls.length)) }, worker));
    const results = [...whitelistResult.blocked, ...outcomes.filter(Boolean)];
    // Refresh scansci-pdf's copy on the way out: the ticket cookie is rotated
    // as the session is used, so a downloading run keeps the institutional tier
    // current without the researcher logging in again.
    const finalState = await context
      .storageState({ path: path.join(runtime, 'webvpn-storage-state.json') })
      .catch(() => ({ cookies: [] }));
    const scansciExport = exportScansciSession(finalState);
    const manifest = {
      skill: 'paper-downloader',
      run_at: new Date().toISOString(),
      mode: 'download',
      scansci_session: scansciExport,
      session_policy: 'persistent_browser_profile',
      browser_mode: launchOptions.headless ? 'headless' : 'headed',
      browser_workers: browserWorkers,
      profile_dir: relative(root, profileDir),
      output_dir: relative(root, out),
      downloaded_paths: results
        .filter((r) => r.status === 'downloaded' && r.path)
        .map((r) => r.path),
      whitelist: {
        enabled: Boolean(whitelist.enabled),
        path: whitelist.path ? relative(root, whitelist.path) : null,
        source: whitelist.source || null,
        allow_count: whitelist.allow?.length || 0,
        allow_issn_count: whitelist.allowIssns?.length || 0,
        blocked_not_whitelisted: whitelistResult.blocked.length,
        error: whitelist.error || null
      },
      results,
      summary: {
        total: results.length,
        downloaded: results.filter((r) => r.status === 'downloaded').length,
        needs_login: results.filter((r) => r.status === 'needs_login').length,
        manual_required: results.filter((r) => r.status === 'manual_required').length,
        failed: results.filter((r) => ['failed', 'timeout'].includes(r.status)).length,
        blocked_policy: results.filter((r) => r.status === 'blocked_policy').length,
        blocked_not_whitelisted: results.filter((r) => r.status === 'blocked_not_whitelisted').length,
        skipped_non_pdf_resource: results.filter((r) => r.status === 'skipped_non_pdf_resource').length,
        anti_bot_challenge: results.filter((r) => r.status === 'anti_bot_challenge').length,
        access_denied: results.filter((r) => r.status === 'access_denied').length
      },
      rules: [
        'Primary access uses the persistent browser profile, not reverse-engineered WebVPN host encoding.',
        'Credentials are never stored by Scholarium. Cookies/session state remain local and ignored by git.',
        'If needs_login appears, rerun mode=login and sign in manually.'
      ]
    };
    const logFile = path.join(logs, `paper-downloader-${Date.now()}.json`);
    fs.writeFileSync(logFile, JSON.stringify(manifest, null, 2), 'utf8');
    manifest.log_path = relative(root, logFile);
    batchProgress?.finish('finished');
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    batchProgress?.finish('error');
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error) => {
  console.log(JSON.stringify({
    skill: 'paper-downloader',
    run_at: new Date().toISOString(),
    mode: 'download',
    results: [],
    error: { status: 'failed', message: error.message, stack: error.stack }
  }, null, 2));
});
