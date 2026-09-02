"use strict";
/* search-merge.js — multi-source literature search merge/dedupe (pure).
 *
 * Each source returns manifest.records with heterogeneous field names.
 * We normalize just enough to dedupe: DOI first (case/scheme-insensitive),
 * then a normalized title. Records keep every field the source provided and
 * gain `sources: [...]` (all platforms that returned it) plus `source`
 * (the first platform, for simple consumers like the Idea tree).
 */

function normalizeDoi(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "");
}

function normalizeTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function recordKey(record) {
  const doi = normalizeDoi(record.doi);
  if (doi) return `doi:${doi}`;
  const title = normalizeTitle(record.title);
  return title ? `title:${title}` : null;
}

/* lists: [{ source, records }] → flat deduped array, first-hit wins,
 * later duplicates only contribute their source tag. */
function mergeSearchRecords(lists) {
  const seen = new Map();
  const out = [];
  for (const { source, records } of lists || []) {
    for (const record of records || []) {
      if (!record || typeof record !== "object") continue;
      const key = recordKey(record);
      if (key && seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.sources.includes(source)) existing.sources.push(source);
        continue;
      }
      const merged = { ...record, source, sources: [source] };
      if (key) seen.set(key, merged);
      out.push(merged);
    }
  }
  return out;
}

module.exports = { normalizeDoi, normalizeTitle, mergeSearchRecords };
