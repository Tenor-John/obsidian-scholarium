"use strict";
/* query-adapt.js — deterministic, rule-based per-source query translator.
 *
 * The builder/critic loop (query-loop-core.js) always produces exactly ONE
 * canonical, Boolean-ish, cross-database English query — the Agent never
 * sees or reasons about per-source syntax. Each real search source's actual
 * query syntax differs (confirmed by reading each skill's scripts folder):
 *   - OpenAlex (open-access-literature / nature-academic-search /
 *     pop8-scholar-search): Boolean AND/OR/NOT + parens + quoted phrases,
 *     native support via the `search=` param. openalex_search.py already has
 *     its own sanitize_for_openalex()/term_bag_for_openalex() fallback, so
 *     this adapter passes the canonical query through unchanged.
 *   - PubMed (pubmed-search): E-utilities' `term=` param supports Boolean
 *     AND/OR/NOT and field tags ([tiab], [mesh], [au]) — but ONLY when the
 *     operators are UPPERCASE; lowercase "and"/"or"/"not" are treated as
 *     literal search terms, not operators. search_pubmed.py does zero
 *     sanitization of its own.
 *   - Semantic Scholar (semantic-scholar-search): the /paper/search endpoint
 *     is plain relevance-ranked free text — it does not reliably honor
 *     Boolean operators or parentheses. A Boolean-syntax query would be
 *     matched as literal tokens (degrading recall), so this degrades the
 *     canonical query to a term bag. search_semantic_scholar.py also does
 *     zero sanitization of its own.
 *   - Scopus (scopus-search): field-qualified syntax (TITLE-ABS-KEY(...)
 *     etc.). search_scopus.py's own sanitize_for_scopus() already wraps a
 *     bare query in TITLE-ABS-KEY(...) server-side, so this adapter passes
 *     the canonical query through unchanged (kept as its own case rather
 *     than merged with openalex's, so a future divergence — e.g. fixing
 *     that function's existing quote-stripping — is a one-line change here
 *     without touching the openalex case).
 *
 * Deterministic and pure: same input always produces the same output, no
 * network, no Agent call. This is what "Agent 只产一条标准化查询，代码做
 * 确定性规则翻译" means in practice.
 *
 * Browser: window.weaverQueryAdapt; Node: module.exports.
 */

const SOURCES = ["openalex", "pubmed", "semantic-scholar", "scopus"];

// Boundary is whitespace/parens/string-edge, NOT plain \b — \b alone treats
// a hyphen as a boundary too, so "not-a-drug" or "and-doped" would otherwise
// be misread as the operator "not"/"and" plus a stray "-a-drug"/"-doped".
// Real Boolean operators in these queries are always space/paren-delimited.
const OPERATOR_BOUNDARY = "(?<=^|[\\s(])(and|or|not)(?=[\\s)]|$)";

function upperBooleanOperators(query) {
  return String(query || "").replace(new RegExp(OPERATOR_BOUNDARY, "g"), (m) => m.toUpperCase());
}

function stripBooleanToFreeText(query) {
  let text = String(query || "");
  text = text.replace(/[()]/g, " "); // drop grouping parens, keep contents
  text = text.replace(new RegExp(OPERATOR_BOUNDARY, "gi"), " "); // drop operators
  text = text.replace(/\s+/g, " ").trim(); // collapse whitespace
  return text;
}

function adaptQueryForSource(query, source) {
  const q = String(query || "").trim();
  if (!q) return q;
  switch (source) {
    case "openalex": return q;
    case "pubmed": return upperBooleanOperators(q);
    case "semantic-scholar": return stripBooleanToFreeText(q);
    case "scopus": return q;
    default: return q;
  }
}

const queryAdaptApi = { SOURCES, adaptQueryForSource, upperBooleanOperators, stripBooleanToFreeText };
if (typeof module !== "undefined" && module.exports) module.exports = queryAdaptApi;
if (typeof window !== "undefined") window.weaverQueryAdapt = queryAdaptApi;
