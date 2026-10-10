"use strict";
/* Which terms the knowledge graph should look for.
   ------------------------------------------------------------------------
   build_paper_graph.js extracts entities with three hardcoded regexes for a
   photocatalysis vocabulary (bivo4, zno, tio2, co2 reduction, ...). Against
   this vault's actual corpus — gold nanostar synthesis in Good's buffers —
   they match almost nothing that matters: 512 edges, of which 161 hang off
   the single token "au", while HEPES, MOPS, EPPS, nanostar and seed-mediated
   never appear in the graph at all because no pattern mentions them.

   The obvious fix is to add those words to the regex table. That is the same
   mistake a second time: it would work until the researcher's next project,
   and this one already has two (plasmonic photocatalysis, Au@CeO2 hydrogen
   evolution) whose vocabularies differ from the indexed literature.

   So no domain words are hardcoded here. The keyword list is configuration,
   and when it has never been configured the terms are derived from the
   corpus the user actually indexed. A vault of battery papers gets battery
   terms without anyone editing this file. */

const fs = require("fs");
const path = require("path");

/* Words that are frequent in any English scientific corpus and therefore
   carry no signal about what a paper is about. Kept deliberately short:
   over-filtering silently removes real domain terms, and the user reviews
   the suggestions anyway. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "was", "were", "are", "have", "has", "been",
  "which", "these", "those", "their", "than", "then", "when", "where", "while", "into", "onto",
  "using", "used", "use", "can", "may", "also", "such", "other", "more", "most", "some", "both",
  "between", "during", "after", "before", "under", "over", "each", "well", "would", "could",
  "shown", "show", "shows", "showed", "found", "observed", "obtained", "reported", "described",
  "results", "result", "study", "studies", "work", "paper", "article", "figure", "table", "fig",
  "data", "method", "methods", "analysis", "based", "different", "high", "low", "large", "small",
  "however", "therefore", "thus", "further", "respectively", "addition", "due", "including",
  "one", "two", "three", "first", "second", "new", "same", "all", "not", "but", "its", "our",
  "we", "it", "as", "at", "by", "in", "of", "on", "to", "is", "be", "an", "a", "or", "if", "no",
  "et", "al", "doi", "https", "http", "www", "org", "com", "pdf", "vol", "pp", "issn", "isbn",
  "elsevier", "springer", "wiley", "acs", "rsc", "nature", "science", "journal", "copyright",
  "author", "authors", "university", "department", "supporting", "information", "received",
  "accepted", "published", "online", "available", "license", "creative", "commons",
  /* Lab-generic nouns. These are frequent in any wet-chemistry corpus and
     describe the apparatus of doing science rather than its subject, so as
     graph entities they connect every paper to every other paper and carry no
     navigational value. Measured against this vault's corpus they were 14 of
     the top 40 candidates. */
  "water", "solution", "solutions", "concentration", "concentrations", "temperature",
  "time", "times", "size", "sizes", "final", "initial", "surface", "particles",
  "diameter", "stock", "volume", "sample", "samples", "mixture", "mixing", "ratio",
  "amount", "value", "values", "range", "rate", "process", "system", "systems",
  "properties", "property", "applications", "application", "stability", "control",
  "effect", "effects", "increase", "decrease", "change", "changes", "via", "only",
  "reducing", "modified", "typical", "average", "total", "single", "multiple",
]);

/* YAML frontmatter keys. The RAG index contains this vault's own Markdown
   notes, whose frontmatter (`---`, `tags:`, `status:`, `uid:`, `display_id:`)
   appears once in nearly every note. That gives those keys a high document
   count and made six of them rank in the top 40 — as graph entities they
   would be edges asserting that a paper "mentions" the word `title`. */
/* Words that are too generic to be an entity on their own, but which carry
   real meaning inside a phrase. Blanket-stopwording them would be wrong: this
   researcher works on photocatalysis, where "visible light" and "core shell"
   are exactly the terms worth graphing even though "light" and "core" alone
   connect everything to everything. So they are barred as single-word
   candidates and still allowed to form bigrams. */
const WEAK_ALONE = new Set([
  "light", "dark", "blue", "red", "green", "acid", "agent", "core", "shell",
  "shape", "particle", "conditions", "stable", "higher", "lower", "without",
  "chem", "synthesized", "formation", "optical", "electron", "max", "min",
]);

const FRONTMATTER_KEYS = new Set([
  "tags", "status", "title", "date", "type", "uid", "aliases", "cssclass",
  "display_id", "schema_version", "created", "updated", "author", "source",
  "project", "related", "links", "summary", "id",
]);

/* A term the graph would find anyway. Suggesting these wastes the user's
   attention on words that change nothing. Mirrors ENTITY_PATTERNS in
   build_paper_graph.js; if that table grows, this should follow. */
const ALREADY_MATCHED = [
  /^(?:au|au\s*np|aunp|au\s*nanoparticles?|gold nanoparticles?|bivo4|bi2o2co3|zno|tio2|g-c3n4|mos2)$/i,
  /^(?:xrd|xps|tem|sem|uv[- ]?vis|drs|pl|eis|ftir|raman|photocatalysis|transient absorption)$/i,
  /^(?:co2 reduction|co production|methane|hydrogen evolution|photocatalytic activity|catalytic efficiency)$/i,
];

function alreadyMatched(term) {
  return ALREADY_MATCHED.some((pattern) => pattern.test(term));
}

/* Normalize a user-supplied list. Terms are lowercased because
   extractEntities matches case-insensitively and two casings of one word
   would otherwise become two graph nodes. */
function normalize(input, limit = 60) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const term = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim().toLowerCase();
    if (!term || term.length < 2 || term.length > 60) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= limit) break;
  }
  return out;
}

/* Three states, and the difference between the last two matters:
     null / undefined -> never configured; derive from the corpus
     []               -> explicitly configured to add nothing
     [...]            -> use exactly these
   Collapsing [] into "unset" would make it impossible to turn the feature
   off, which is the same fail-closed distinction the Bridge config already
   draws for fullTaskCategories. */
function isConfigured(value) {
  return Array.isArray(value);
}

/* Remove a leading YAML frontmatter block before anything else looks at the
   text. Chunks from this vault's own notes begin with one, and its keys are
   metadata about the note rather than content of the paper. */
function stripFrontmatter(text) {
  const value = String(text || "");
  const match = value.match(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? value.slice(match[0].length) : value;
}

function tokenize(text) {
  // Keep digits, hyphens and @ inside words: "au@ceo2", "seed-mediated" and
  // "agno3" are single domain terms, and splitting them destroys exactly the
  // vocabulary this is meant to find.
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9@\-°\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function candidateTerms(text) {
  const words = tokenize(stripFrontmatter(text));
  const grams = [];
  for (let i = 0; i < words.length; i += 1) {
    const w1 = words[i];
    /* A candidate must contain a letter: rules and table borders in extracted
       PDF text tokenize to things like "-----------", which ranked 14th on
       this corpus before this check existed. */
    if (w1.length >= 3 && w1.length <= 40 && !STOPWORDS.has(w1)
      && !FRONTMATTER_KEYS.has(w1) && !WEAK_ALONE.has(w1) && /[a-z]/.test(w1)) grams.push(w1);
    // Two-word terms carry most of the useful vocabulary ("gold nanostar",
    // "seed-mediated growth"); three-word ones are mostly sentence fragments.
    if (i + 1 < words.length) {
      const w2 = words[i + 1];
      // WEAK_ALONE words are deliberately allowed here — this is the branch
      // that recovers "visible light" and "core shell".
      if (!STOPWORDS.has(w1) && !STOPWORDS.has(w2)
        && !FRONTMATTER_KEYS.has(w1) && !FRONTMATTER_KEYS.has(w2)
        && w1.length >= 3 && w2.length >= 3
        && /[a-z]/.test(w1) && /[a-z]/.test(w2)) {
        const bigram = `${w1} ${w2}`;
        if (bigram.length <= 45) grams.push(bigram);
      }
    }
  }
  return grams;
}

function readChunks(chunksFile) {
  const rows = [];
  let raw;
  try { raw = fs.readFileSync(chunksFile, "utf8"); } catch (_) { return rows; }
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    try { rows.push(JSON.parse(text)); } catch (_) { /* a damaged line is skipped, not fatal */ }
  }
  return rows;
}

/* Rank by how many DISTINCT papers a term appears in, not by raw count.

   Raw frequency surfaces whatever one long paper happens to repeat — a single
   methods section saying "nanostar" ninety times outranks a term that every
   paper in the corpus uses once. Document frequency is what separates "this
   field's vocabulary" from "this document's vocabulary", and the graph is
   built across papers, so that is the axis that matters. */
function suggestFromCorpus(chunksFile, options = {}) {
  const existing = new Set(normalize(options.existing || []));
  const minPapers = Number.isFinite(options.minPapers) ? options.minPapers : 3;
  const minCount = Number.isFinite(options.minCount) ? options.minCount : 8;
  const limit = Number.isFinite(options.limit) ? options.limit : 40;

  const chunks = readChunks(chunksFile);
  if (!chunks.length) {
    return { suggestions: [], papers: 0, chunks: 0, note: "语料为空或读不到 chunks.jsonl；请先运行 RAG 切块。" };
  }

  const total = new Map();
  const papers = new Map();
  const allPapers = new Set();
  for (const chunk of chunks) {
    const source = String(chunk.source_hash || chunk.source_path || "");
    if (source) allPapers.add(source);
    const seenHere = new Set();
    for (const term of candidateTerms(chunk.text)) {
      total.set(term, (total.get(term) || 0) + 1);
      if (source && !seenHere.has(term)) {
        seenHere.add(term);
        if (!papers.has(term)) papers.set(term, new Set());
        papers.get(term).add(source);
      }
    }
  }

  /* A domain term recurs INSIDE a document; metadata and author names appear
     about once per document. Measured on this corpus: hepes 477 occurrences
     across 21 papers (22.7 each), auns 461/17 (27.1), haucl4 104/21 (5.0) —
     versus tags 19/19 (1.0), status 17/17 (1.0), title 16/16 (1.0), date
     16/16 (1.0). The ratio separates them cleanly where document frequency
     alone cannot, because both kinds appear in nearly every paper. */
  const minRepetition = Number.isFinite(options.minRepetition) ? options.minRepetition : 2;

  const scored = [];
  for (const [term, count] of total) {
    if (count < minCount) continue;
    const paperCount = papers.has(term) ? papers.get(term).size : 0;
    if (paperCount < minPapers) continue;
    if (count / paperCount < minRepetition) continue;
    if (existing.has(term) || alreadyMatched(term)) continue;
    scored.push({ term, count, papers: paperCount, perPaper: Number((count / paperCount).toFixed(1)) });
  }

  /* A term in every paper is as useless as a term in one: "nanoparticles"
     across a nanoparticle corpus separates nothing. Terms present in more
     than 85% of papers are dropped for the same reason stopwords are.

     The rule needs a population to mean anything, though. On a four-paper
     corpus "appears in all four" is not evidence that a word is generic, and
     applying the ceiling there removed every candidate — the filter deleted
     precisely the cross-document vocabulary it exists to surface. So it only
     engages once the corpus is large enough for the proportion to carry
     information. */
  const CEILING_MIN_PAPERS = 10;
  const useful = allPapers.size >= CEILING_MIN_PAPERS
    ? scored.filter((item) => item.papers <= Math.floor(allPapers.size * 0.85))
    : scored;

  useful.sort((a, b) => (b.papers - a.papers) || (b.count - a.count) || a.term.localeCompare(b.term));

  /* Drop a single word when a longer phrase containing it scores at least as
     well: "nanostar" and "gold nanostar" both surviving means the user has to
     read the same idea twice. The phrase wins because it is more specific. */
  const kept = [];
  for (const item of useful) {
    const subsumed = kept.some((other) => other.term.includes(item.term) && other.papers >= item.papers);
    if (!subsumed) kept.push(item);
    if (kept.length >= limit) break;
  }

  return {
    suggestions: kept,
    papers: allPapers.size,
    chunks: chunks.length,
    note: null,
  };
}

function corpusPath(vaultRoot) {
  return path.join(vaultRoot, "Scholarium", "runtime", "rag-index", "chunks.jsonl");
}

/* What the graph should actually run with, and where it came from. The source
   is reported so the UI can say "这次用的是自动推导的词" instead of leaving the
   user to guess why the graph changed after they indexed new papers. */
function resolveKeywords(configured, vaultRoot, options = {}) {
  if (isConfigured(configured)) {
    return { keywords: normalize(configured), source: "configured", derived: null };
  }
  const derived = suggestFromCorpus(corpusPath(vaultRoot), {
    limit: Number.isFinite(options.limit) ? options.limit : 30,
  });
  return {
    keywords: derived.suggestions.map((item) => item.term),
    source: "derived",
    derived,
  };
}

module.exports = {
  STOPWORDS, FRONTMATTER_KEYS, WEAK_ALONE, ALREADY_MATCHED, normalize, isConfigured, alreadyMatched,
  tokenize, stripFrontmatter, candidateTerms, suggestFromCorpus, resolveKeywords, corpusPath,
};

if (require.main === module) {
  const vault = process.argv[2];
  if (!vault) { process.stderr.write("usage: node graph-keywords.js <vault>\n"); process.exit(2); }
  process.stdout.write(JSON.stringify(suggestFromCorpus(corpusPath(vault)), null, 2) + "\n");
}
