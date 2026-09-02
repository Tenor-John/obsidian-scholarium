#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Multi-source paper resolver for paper-downloader.
 *
 * Given a list of DOIs / titles / partial records, queries PubMed, OpenAlex,
 * Semantic Scholar, and (optionally) Scopus to fill in missing metadata and
 * locate open-access PDF URLs. Emits the same JSON shape that
 * browser_downloader.js already accepts:
 *
 *   { "records": [{ doi, title, venue, pdf_url, landing_page_url, sources }],
 *     "urls": [ ... ] }
 *
 * Output is printed to stdout. Pipe into browser_downloader.js:
 *
 *   node scripts/api_resolver.js <workspace> input.json > resolved.json
 *   node scripts/browser_downloader.js <workspace> resolved.json
 *
 * API keys are read from environment variables first, then from
 * <workspace>/Scholarium/secrets/api_keys.json (gitignored):
 *
 *   PUBMED_API_KEY
 *   OPENALEX_API_KEY
 *   SEMANTIC_SCHOLAR_API_KEY
 *   SCOPUS_API_KEY
 *
 * If a key is absent, that source is skipped silently. Scopus is always
 * optional because Elsevier enforces a strict quota.
 */
const fs = require('node:fs');
const path = require('node:path');

// Mirror browser_downloader.js so the two never drift. Any host that becomes
// allowed here must also become allowed there, and vice versa.
const BANNED_DOMAINS = /(sci-hub\.[a-z.]{2,}|libgen\.[a-z.]{2,}|library\.lol|z-?lib(?:rary)?\.[a-z.]{2,}|annas-archive\.[a-z.]{2,}|booksc\.[a-z.]{2,})/i;

const CONTACT_EMAIL = 'scholarium-research@localhost'; // OpenAlex polite-pool identifier; replace in production.
const HTTP_TIMEOUT_MS = 20000;
const MAX_PARALLEL = 6;

function readJson(value) {
  if (!value) return {};
  if (fs.existsSync(value)) return JSON.parse(fs.readFileSync(value, 'utf8').replace(/^﻿/, ''));
  try { return JSON.parse(value); } catch { return { dois: [value] }; }
}

function loadKeys(root) {
  const out = {
    pubmed: process.env.PUBMED_API_KEY || '',
    openalex: process.env.OPENALEX_API_KEY || '',
    semantic_scholar: process.env.SEMANTIC_SCHOLAR_API_KEY || '',
    scopus: process.env.SCOPUS_API_KEY || ''
  };
  const file = path.join(root, 'Scholarium', 'secrets', 'api_keys.json');
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!out.pubmed && raw.pubmed_api_key) out.pubmed = String(raw.pubmed_api_key);
      if (!out.openalex && raw.openalex_api_key) out.openalex = String(raw.openalex_api_key);
      if (!out.semantic_scholar && raw.semantic_scholar_api_key) out.semantic_scholar = String(raw.semantic_scholar_api_key);
      if (!out.scopus && raw.scopus_api_key) out.scopus = String(raw.scopus_api_key);
    } catch (error) {
      console.error(`api_resolver: failed to parse ${file}: ${error.message}`);
    }
  }
  return out;
}

function redactKeys(keys) {
  return Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, v ? `${String(v).slice(0, 4)}…(${String(v).length})` : '']));
}

function safeHost(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isBanned(url) {
  return BANNED_DOMAINS.test(url || '');
}

function nonPdfResource(url) {
  return /\.(?:jpe?g|png|gif|webp|svg|bmp|tiff?|json|xml|html?|txt|csv|ris|bib)(?:[?#].*)?$/i.test(url || '')
    && !/\.pdf(?:[?#].*)?$/i.test(url || '');
}

function normalizeDoi(input) {
  let value = String(input || '').trim();
  if (!value) return '';
  value = value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  value = value.replace(/^doi:\s*/i, '');
  return value;
}

async function fetchJson(url, headers, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status, body: null };
    }
    const body = await response.json().catch(() => null);
    return { ok: true, status: response.status, body };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

async function runWithLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function pump() {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  const pumps = Array.from({ length: Math.min(limit, items.length) }, pump);
  await Promise.all(pumps);
  return out;
}

// ----- PubMed E-utilities ---------------------------------------------------

function pubmedSummaryUrl(doi, key) {
  const params = new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    id: doi
  });
  if (key) {
    params.set('term', `${doi}[doi]`);
    params.set('retmax', '1');
    return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}`;
  }
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${params}`;
}

function pubmedLinkUrl(pmid, key) {
  const params = new URLSearchParams({ dbfrom: 'pubmed', db: 'pmc', id: pmid, retmode: 'json' });
  if (key) params.set('api_key', key);
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?${params}`;
}

async function resolvePubmed(doi, keys, trace) {
  if (!doi) return null;
  let pmid = '';
  let title = '';
  let venue = '';
  let pmcId = '';
  let pdfUrl = '';
  let landingUrl = `https://doi.org/${doi}`;

  const searchParams = new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    term: `${doi}[doi]`,
    retmax: '1'
  });
  if (keys.pubmed) searchParams.set('api_key', keys.pubmed);
  const search = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${searchParams}`);
  if (!search.ok || !search.body) {
    trace.push({ source: 'pubmed', doi, ok: false, status: search.status });
    return null;
  }
  const idList = search.body?.esearchresult?.idlist || [];
  pmid = String(idList[0] || '');
  if (!pmid) {
    trace.push({ source: 'pubmed', doi, ok: false, status: 'no_pmid' });
    return null;
  }

  const summaryParams = new URLSearchParams({ db: 'pubmed', retmode: 'json', id: pmid });
  if (keys.pubmed) summaryParams.set('api_key', keys.pubmed);
  const summary = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?${summaryParams}`);
  if (summary.ok && summary.body) {
    const rec = summary.body?.result?.[pmid] || {};
    title = String(rec.title || '').replace(/\.\s*$/, '');
    venue = String(rec.fulljournalname || rec.source || '');
  }

  // Look up PMC full text and PDF link via elink.
  const linkParams = new URLSearchParams({ dbfrom: 'pubmed', db: 'pmc', id: pmid, retmode: 'json' });
  if (keys.pubmed) linkParams.set('api_key', keys.pubmed);
  const link = await fetchJson(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi?${linkParams}`);
  if (link.ok && link.body) {
    const linksets = link.body?.linksets || [];
    for (const set of linksets) {
      for (const target of (set.linksetdbs || [])) {
        if (String(target.dbto || '').toLowerCase() !== 'pmc') continue;
        for (const linkEntry of (target.links || [])) {
          pmcId = String(linkEntry?.id || '');
          if (pmcId) break;
        }
      }
      if (pmcId) break;
    }
    if (pmcId) {
      landingUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/`;
      pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pmcId}/pdf/${`PMC${pmcId}.pdf`}`;
    }
  }

  trace.push({ source: 'pubmed', doi, ok: true, pmid, pmc: pmcId || null });
  return { doi, pmid, pmc: pmcId, title, venue, pdf_url: pdfUrl, landing_page_url: landingUrl };
}

// ----- OpenAlex --------------------------------------------------------------

async function resolveOpenalex(doi, keys, trace) {
  if (!doi) return null;
  // OpenAlex's per-work endpoint only accepts OpenAlex-native IDs (W...).
  // Arbitrary DOIs must use the `filter=doi:<doi>` form on the list endpoint.
  // OpenAlex authentication is just a polite-pool `mailto=` parameter; the
  // "OPENALEX_API_KEY" env var is reserved for future premium-tier auth but
  // is currently unused.
  const url = `https://api.openalex.org/works?filter=doi:${encodeURIComponent(doi)}&mailto=${encodeURIComponent(CONTACT_EMAIL)}`;
  const result = await fetchJson(url, {});
  if (!result.ok || !result.body) {
    trace.push({ source: 'openalex', doi, ok: false, status: result.status });
    return null;
  }
  const work = (result.body.results || [])[0];
  if (!work) {
    trace.push({ source: 'openalex', doi, ok: false, status: 'not_found' });
    return null;
  }
  const oa = work.best_oa_location || {};
  const locations = Array.isArray(work.locations) ? work.locations : [];
  const candidate = locations.find((loc) => loc?.pdf_url) || oa;
  let pdfUrl = candidate?.pdf_url || '';
  let landingUrl = candidate?.landing_page_url || work.doi || `https://doi.org/${doi}`;
  if (!pdfUrl && oa?.landing_page_url) landingUrl = oa.landing_page_url;
  if (!pdfUrl && work.open_access?.oa_url) landingUrl = work.open_access.oa_url;
  const venue = work.primary_location?.source?.display_name || work.host_venue?.display_name || '';
  trace.push({ source: 'openalex', doi, ok: true, has_oa: Boolean(pdfUrl || work.open_access?.is_oa) });
  return {
    doi,
    title: work.title || work.display_name || '',
    venue,
    pdf_url: pdfUrl,
    landing_page_url: landingUrl,
    venue_issn_l: work.primary_location?.source?.issn_l ? [work.primary_location.source.issn_l] : [],
    openalex_id: work.id || ''
  };
}

// ----- Semantic Scholar ------------------------------------------------------

async function resolveSemanticScholar(doi, title, keys, trace) {
  const headers = {};
  if (keys.semantic_scholar) headers['x-api-key'] = keys.semantic_scholar;
  let result = null;
  if (doi) {
    const url = `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=title,venue,openAccessPdf,externalIds`;
    result = await fetchJson(url, headers);
  }
  if ((!result || !result.ok || !result.body) && title) {
    const searchUrl = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=title,venue,openAccessPdf,externalIds`;
    result = await fetchJson(searchUrl, headers);
    const hit = result?.body?.data?.[0];
    if (hit) {
      trace.push({ source: 'semantic_scholar', doi: doi || null, ok: true, via: 'title_search' });
      return {
        doi: doi || hit?.externalIds?.DOI || '',
        title: hit.title || title,
        venue: hit.venue || '',
        pdf_url: hit.openAccessPdf?.url || '',
        landing_page_url: hit.openAccessPdf?.url || `https://doi.org/${doi}`
      };
    }
  }
  if (!result || !result.ok || !result.body) {
    trace.push({ source: 'semantic_scholar', doi: doi || null, ok: false, status: result?.status });
    return null;
  }
  const paper = result.body;
  trace.push({ source: 'semantic_scholar', doi: doi || null, ok: true, via: 'doi_lookup' });
  return {
    doi: doi || paper.externalIds?.DOI || '',
    title: paper.title || title || '',
    venue: paper.venue || '',
    pdf_url: paper.openAccessPdf?.url || '',
    landing_page_url: paper.openAccessPdf?.url || `https://doi.org/${doi}`
  };
}

// ----- Scopus (optional) -----------------------------------------------------

async function resolveScopus(doi, keys, trace) {
  if (!keys.scopus || !doi) return null;
  // Scopus Abstract Retrieval API. Requires an Elsevier API key (InstToken
  // not required for /abstract/doi lookups but rate limits apply).
  const url = `https://api.elsevier.com/content/abstract/doi/${encodeURIComponent(doi)}?view=FULL`;
  const headers = { Accept: 'application/json', 'X-ELS-APIKey': keys.scopus };
  const result = await fetchJson(url, headers);
  if (!result.ok || !result.body) {
    trace.push({ source: 'scopus', doi, ok: false, status: result.status });
    return null;
  }
  const coredata = result.body?.['abstracts-retrieval-response']?.coredata || {};
  const openArchive = result.body?.['abstracts-retrieval-response']?.item?.['open-access']?.['open-access-content'] || {};
  let pdfUrl = '';
  if (typeof openArchive === 'object' && Array.isArray(openArchive)) {
    for (const entry of openArchive) {
      if (entry?.['content-type'] === 'PDF' && entry?.url) pdfUrl = entry.url;
    }
  }
  trace.push({ source: 'scopus', doi, ok: true, has_oa: Boolean(pdfUrl) });
  return {
    doi,
    title: String(coredata['dc:title'] || ''),
    venue: String(coredata['prism:publicationName'] || ''),
    pdf_url: pdfUrl,
    landing_page_url: `https://doi.org/${doi}`
  };
}

// ----- Merge -----------------------------------------------------------------

function mergeRecords(parts) {
  const map = new Map();
  const ensure = (doi) => {
    const key = doi || `__synthetic_${map.size}`;
    if (!map.has(key)) {
      map.set(key, {
        doi: doi || '',
        title: '',
        venue: '',
        venue_issn_l: [],
        pdf_url: '',
        landing_page_url: '',
        sources: []
      });
    }
    return map.get(key);
  };
  for (const part of parts) {
    if (!part) continue;
    const rec = ensure(part.doi);
    if (part.doi) rec.doi = part.doi;
    if (part.title && (!rec.title || rec.title.length < part.title.length)) rec.title = part.title;
    if (part.venue && !rec.venue) rec.venue = part.venue;
    if (Array.isArray(part.venue_issn_l)) {
      for (const issn of part.venue_issn_l) {
        if (issn && !rec.venue_issn_l.includes(issn)) rec.venue_issn_l.push(issn);
      }
    }
    if (part.pdf_url && !isBanned(part.pdf_url) && !nonPdfResource(part.pdf_url)) {
      if (!rec.pdf_url) rec.pdf_url = part.pdf_url;
    }
    if (part.landing_page_url && !rec.landing_page_url) rec.landing_page_url = part.landing_page_url;
    if (part.openalex_id) rec.openalex_id = part.openalex_id;
    if (part.pmid) rec.pmid = part.pmid;
    if (part.pmc) rec.pmc = part.pmc;
    if (Array.isArray(rec.sources)) rec.sources.push(...(Array.isArray(part.sources) ? part.sources : []));
  }
  // If we still have no landing page, fall back to doi.org.
  for (const rec of map.values()) {
    if (!rec.landing_page_url && rec.doi) rec.landing_page_url = `https://doi.org/${rec.doi}`;
  }
  return [...map.values()];
}

function collectInputQueries(input) {
  const queries = [];
  if (Array.isArray(input.records)) {
    for (const rec of input.records) {
      const doi = normalizeDoi(rec?.doi);
      const title = String(rec?.title || '').trim();
      if (doi || title) queries.push({ doi, title, provided_pdf: rec?.pdf_url || '', provided_landing: rec?.landing_page_url || rec?.url || '' });
    }
  }
  for (const doi of (Array.isArray(input.dois) ? input.dois : [])) {
    const normalized = normalizeDoi(doi);
    if (normalized) queries.push({ doi: normalized, title: '', provided_pdf: '', provided_landing: '' });
  }
  for (const title of (Array.isArray(input.titles) ? input.titles : [])) {
    const trimmed = String(title || '').trim();
    if (trimmed) queries.push({ doi: '', title: trimmed, provided_pdf: '', provided_landing: '' });
  }
  // Deduplicate by doi (or title).
  const seen = new Set();
  const out = [];
  for (const q of queries) {
    const key = q.doi ? `doi:${q.doi}` : `title:${q.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function synthesizeBlocked(query, reason) {
  return {
    doi: query.doi || '',
    title: query.title || '',
    pdf_url: '',
    landing_page_url: query.provided_landing || (query.doi ? `https://doi.org/${query.doi}` : ''),
    sources: [],
    status: reason
  };
}

async function main() {
  const root = path.resolve(process.argv[2] || process.cwd());
  const inputArg = process.argv[3] || '';
  const input = readJson(inputArg);
  const keys = loadKeys(root);
  const queries = collectInputQueries(input);
  const trace = [];

  const parts = await runWithLimit(queries, MAX_PARALLEL, async (q) => {
    const [pubmed, openalex, semantic, scopus] = await Promise.all([
      resolvePubmed(q.doi, keys, trace),
      resolveOpenalex(q.doi, keys, trace),
      resolveSemanticScholar(q.doi, q.title, keys, trace),
      resolveScopus(q.doi, keys, trace)
    ]);
    const merged = mergeRecords([pubmed, openalex, semantic, scopus].filter(Boolean));
    if (merged[0]) {
      merged[0].sources.push(...(Array.isArray(merged[0].sources) ? [] : []));
    }
    // Honour user-provided PDF/landing if resolver found nothing.
    if (q.provided_pdf && !merged[0]?.pdf_url) merged[0].pdf_url = q.provided_pdf;
    if (q.provided_landing && !merged[0]?.landing_page_url) merged[0].landing_page_url = q.provided_landing;
    return merged;
  });

  const flat = parts.flat();
  const records = [];
  const blocked = [];
  for (let i = 0; i < queries.length; i += 1) {
    const q = queries[i];
    const rec = flat[i] || null;
    if (!rec || (!rec.doi && !rec.title)) {
      blocked.push({ ...synthesizeBlocked(q, 'no_metadata_found'), query_index: i });
      continue;
    }
    if (rec.pdf_url && isBanned(rec.pdf_url)) {
      blocked.push({ ...rec, status: 'blocked_policy', pdf_url: '' });
      continue;
    }
    if (!rec.pdf_url) {
      // Still emit the record — browser_downloader will try the landing page via WebVPN/CARSI.
      rec.status = 'no_open_access_found';
    } else {
      rec.status = 'resolved_open_access';
    }
    records.push(rec);
  }

  const urls = [];
  for (const rec of records) {
    if (rec.pdf_url && !isBanned(rec.pdf_url) && !nonPdfResource(rec.pdf_url)) urls.push(rec.pdf_url);
    if (rec.landing_page_url && !isBanned(rec.landing_page_url)) urls.push(rec.landing_page_url);
    if (rec.doi) urls.push(`https://doi.org/${rec.doi}`);
  }

  const manifest = {
    skill: 'paper-downloader.api_resolver',
    run_at: new Date().toISOString(),
    input_count: queries.length,
    keys_present: redactKeys(keys),
    sources_queried: [
      keys.pubmed ? 'pubmed' : null,
      keys.openalex ? 'openalex' : null,
      keys.semantic_scholar ? 'semantic_scholar' : null,
      keys.scopus ? 'scopus' : null
    ].filter(Boolean),
    trace,
    records,
    blocked,
    urls: [...new Set(urls)]
  };
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    skill: 'paper-downloader.api_resolver',
    results: [],
    error: { status: 'failed', message: error.message, stack: error.stack }
  }, null, 2));
  process.exit(1);
});