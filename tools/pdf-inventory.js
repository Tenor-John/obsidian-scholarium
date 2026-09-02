"use strict";
/**
 * Read-only inventory of the PDF corpus.
 *
 * The migration ledger has never seen these files. `migration-preflight-generate`
 * scans `Experiments/` and `Research/`, and 317 of the vault's 340 PDFs live
 * under `literature/` and `新建研究主题/`. The conservation checker asserts that
 * every *scanned* source reaches exactly one terminal state, which was true and
 * also nearly meaningless: it was scanning 7% of the papers.
 *
 * This runs separately rather than inside the preflight because hashing a
 * gigabyte on every preflight run would make the cheap read-only step expensive.
 * The preflight consumes the output the same way it consumes the source
 * reassessment.
 *
 *   node tools/pdf-inventory.js --vault <path> --out pdf-inventory.json
 *
 * Nothing is opened for writing inside the vault, and nothing is deleted. The
 * point of this pass is to make a later de-duplication *decidable*, not to
 * decide it: 42% of the corpus is byte-identical copies, but a copy that a note
 * links to is not interchangeable with one nothing points at.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEFAULT_ROOTS = ["literature", "新建研究主题", "Experiments", "Research"];
const SKIP_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);
const DOI_RE = /\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/;

const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function walk(dir, depth, onFile, maxDepth = 8) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, depth + 1, onFile, maxDepth);
    else onFile(p);
  }
}

/**
 * A DOI carried inside the file, not guessed from its name.
 *
 * Publisher PDFs embed it in XMP or the Info dictionary. Reading the head and
 * tail covers both without decompressing the whole document, which keeps this
 * dependency-free — 74% of this corpus yields a DOI that way.
 */
/**
 * Parentheses are the hard part. A DOI may legitimately contain them —
 * `10.1016/S0022-2836(05)80360-2` is a real Elsevier suffix — but a PDF's Info
 * dictionary is also written with them, so a greedy match ran straight out of
 * the DOI and into the surrounding syntax:
 *
 *   10.1038/s41467-023-35860-2)/producer(itext
 *
 * Dropping parentheses from the character class would lose the valid Elsevier
 * form; keeping them unguarded corrupts the identifier that everything else
 * keys on. So the match is truncated at the first unbalanced `)`, which cuts
 * the dictionary syntax and leaves a balanced suffix intact.
 */
function trimDoi(raw) {
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "(") depth++;
    else if (raw[i] === ")") {
      if (depth === 0) return raw.slice(0, i);
      depth--;
    }
  }
  return raw;
}

function embeddedDoi(buf) {
  const head = buf.slice(0, Math.min(buf.length, 300000)).toString("latin1");
  const tail = buf.slice(Math.max(0, buf.length - 200000)).toString("latin1");
  const hit = DOI_RE.exec(head) || DOI_RE.exec(tail);
  if (!hit) return "";
  return trimDoi(hit[0]).replace(/[.,;>\]]+$/, "").toLowerCase();
}

function readPdf(vault, absolute) {
  const buf = fs.readFileSync(absolute);
  const head = buf.slice(0, Math.min(buf.length, 300000)).toString("latin1");
  const tail = buf.slice(Math.max(0, buf.length - 200000)).toString("latin1");
  return {
    path: rel(vault, absolute),
    sha256: sha256(buf),
    bytes: buf.length,
    doi: embeddedDoi(buf),
    // No font resources means no text layer to anchor into; an encrypted file
    // cannot be opened at all. Both are refusals, not low-quality passes.
    has_text_layer: /\/Font/.test(head),
    encrypted: /\/Encrypt/.test(head) || /\/Encrypt/.test(tail),
  };
}

function collectPdfs(vault, roots = DEFAULT_ROOTS) {
  const found = [];
  const seen = new Set();
  for (const root of roots) {
    const abs = path.join(vault, root);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) {
      if (/\.pdf$/i.test(abs) && !seen.has(abs)) { seen.add(abs); found.push(readPdf(vault, abs)); }
      continue;
    }
    walk(abs, 0, (p) => {
      if (!/\.pdf$/i.test(p) || seen.has(p)) return;
      seen.add(p);
      found.push(readPdf(vault, p));
    });
  }
  // Loose PDFs directly at the vault root.
  for (const name of fs.readdirSync(vault)) {
    const p = path.join(vault, name);
    if (!/\.pdf$/i.test(name) || seen.has(p)) continue;
    try { if (!fs.statSync(p).isFile()) continue; } catch (e) { continue; }
    seen.add(p);
    found.push(readPdf(vault, p));
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Which notes point at each PDF.
 *
 * This decides retention, so it has to be careful about what it cannot know.
 * A wikilink carries a basename, and in this corpus basenames repeat across
 * folders — that is what duplication means. When a basename resolves to more
 * than one file the link cannot justify keeping any particular copy, so those
 * references are recorded as ambiguous rather than counted as votes.
 */
function auditLinks(vault, pdfs) {
  const byBasename = new Map();
  const byPath = new Map();
  for (const pdf of pdfs) {
    byPath.set(pdf.path.toLowerCase(), pdf);
    const base = path.posix.basename(pdf.path).toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base).push(pdf);
  }

  const links = new Map(pdfs.map((p) => [p.path, { exact: [], ambiguous: [] }]));
  walk(vault, 0, (p) => {
    if (!/\.(md|canvas)$/i.test(p)) return;
    let text;
    try { text = fs.readFileSync(p, "utf8"); } catch (e) { return; }
    if (!/\.pdf/i.test(text)) return;
    const from = rel(vault, p);
    const seenHere = new Set();
    for (const m of text.matchAll(/([^\s"'()\[\]<>|#]+\.pdf)/gi)) {
      let ref = m[1].replace(/\\/g, "/");
      try { ref = decodeURIComponent(ref); } catch (e) { /* keep raw */ }
      const low = ref.toLowerCase().replace(/^\.\//, "");
      if (seenHere.has(low)) continue;
      seenHere.add(low);

      const exact = byPath.get(low) || byPath.get(low.replace(/^\//, ""));
      if (exact) { links.get(exact.path).exact.push(from); continue; }
      const candidates = byBasename.get(path.posix.basename(low)) || [];
      if (candidates.length === 1) links.get(candidates[0].path).exact.push(from);
      else for (const c of candidates) links.get(c.path).ambiguous.push(from);
    }
  });
  return links;
}

/**
 * Exactly one classification per file.
 *
 * These are classifications, not terminal states. schema-v1 §7.3 freezes four
 * dispositions — migrate / candidate / exclude / retained_settings — and none of
 * these five is a decision to migrate or to discard. Every PDF here is a
 * `candidate` awaiting the de-duplication plan; the classification says what
 * kind of candidate it is.
 *
 * Precedence matters where a file qualifies for several. A scanned or encrypted
 * file is reported as such first, because that is a hard limit on what can ever
 * be done with it, and no de-duplication decision changes it.
 */
const CLASSIFICATIONS = [
  "pdf_scanned_or_encrypted",
  "pdf_exact_duplicate",
  "pdf_version_variant",
  "pdf_unidentified",
  "pdf_canonical_candidate",
];

function classify(pdfs, links) {
  const byHash = new Map();
  for (const p of pdfs) {
    if (!byHash.has(p.sha256)) byHash.set(p.sha256, []);
    byHash.get(p.sha256).push(p);
  }
  const byDoi = new Map();
  for (const p of pdfs) {
    if (!p.doi) continue;
    if (!byDoi.has(p.doi)) byDoi.set(p.doi, new Set());
    byDoi.get(p.doi).add(p.sha256);
  }

  return pdfs.map((pdf) => {
    const link = links.get(pdf.path) || { exact: [], ambiguous: [] };
    const group = byHash.get(pdf.sha256) || [pdf];

    /* Retention evidence, recorded rather than acted on. A copy a note actually
       points at is not interchangeable with one nothing references, so the
       ranking is: exact inbound links first, then whether the filename carries
       the publisher's own article id, then path depth as a stable tiebreak.
       The plan proposes; it does not delete. */
    const rank = (p) => {
      const l = links.get(p.path) || { exact: [], ambiguous: [] };
      const base = path.posix.basename(p.path).toLowerCase();
      const publisherNamed = !!p.doi && base.includes(p.doi.split("/").pop().toLowerCase());
      // `-2`, `-3`, `-6` are what the downloader appends when it fetches the
      // same paper again. Without this the keeper came out as `1129493-3.pdf`
      // while `1129493.pdf` was proposed for deletion — link-correct and
      // obviously backwards.
      const redownloaded = /-\d+\.pdf$/.test(base);
      return [
        -l.exact.length,
        publisherNamed ? 0 : 1,
        redownloaded ? 1 : 0,
        p.path.split("/").length,
        p.path,
      ];
    };
    const ordered = [...group].sort((a, b) => {
      const x = rank(a), y = rank(b);
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
      return 0;
    });
    const keeper = ordered[0];

    let classification;
    if (!pdf.has_text_layer || pdf.encrypted) classification = "pdf_scanned_or_encrypted";
    else if (group.length > 1 && pdf.path !== keeper.path) classification = "pdf_exact_duplicate";
    else if (pdf.doi && (byDoi.get(pdf.doi) || new Set()).size > 1) classification = "pdf_version_variant";
    else if (!pdf.doi) classification = "pdf_unidentified";
    else classification = "pdf_canonical_candidate";

    return {
      ...pdf,
      classification,
      linked_from: link.exact,
      ambiguous_links: link.ambiguous,
      duplicate_group_size: group.length,
      proposed_keeper: group.length > 1 ? keeper.path : "",
      doi_variant_count: pdf.doi ? (byDoi.get(pdf.doi) || new Set()).size : 0,
    };
  });
}

function inventory(vault, roots) {
  const pdfs = collectPdfs(vault, roots);
  const links = auditLinks(vault, pdfs);
  const files = classify(pdfs, links);

  const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0]));
  for (const f of files) counts[f.classification]++;
  const total = CLASSIFICATIONS.reduce((a, c) => a + counts[c], 0);

  const uniqueHashes = new Set(files.map((f) => f.sha256)).size;
  const reclaimable = files
    .filter((f) => f.classification === "pdf_exact_duplicate")
    .reduce((a, f) => a + f.bytes, 0);

  /* Obsidian resolves `[[name.pdf]]` by basename. Keeping one copy per content
     hash is therefore not sufficient: where a duplicate group spans several
     basenames and a note references one of the non-keepers, deleting it breaks
     that link even though the bytes still exist under another name. Those files
     are named here so the de-duplication plan can keep them deliberately rather
     than discover the breakage afterwards. */
  const referencedBasenames = new Set();
  for (const f of files)
    if (f.linked_from.length || f.ambiguous_links.length)
      referencedBasenames.add(path.posix.basename(f.path).toLowerCase());

  const linkCritical = [];
  const byHashGroups = new Map();
  for (const f of files) {
    if (!byHashGroups.has(f.sha256)) byHashGroups.set(f.sha256, []);
    byHashGroups.get(f.sha256).push(f);
  }
  for (const group of byHashGroups.values()) {
    if (group.length < 2) continue;
    const keeper = group.find((f) => f.classification !== "pdf_exact_duplicate") || group[0];
    const keeperBase = path.posix.basename(keeper.path).toLowerCase();
    for (const f of group) {
      if (f === keeper) continue;
      const base = path.posix.basename(f.path).toLowerCase();
      if (base !== keeperBase && referencedBasenames.has(base)) linkCritical.push(f.path);
    }
  }
  for (const f of files) f.link_critical = linkCritical.includes(f.path);

  return {
    schema_version: 1,
    kind: "scholarium-pdf-inventory",
    generated_at: new Date().toISOString(),
    generator: "tools/pdf-inventory.js",
    vault_root: path.resolve(vault),
    counts: { scanned: files.length, ...counts },
    // The same assertion the migration ledger makes: every file reaches exactly
    // one classification, and the parts sum to the whole.
    conservation: { every_file_classified: total === files.length },
    unique_by_content: uniqueHashes,
    unique_by_doi: new Set(files.map((f) => f.doi).filter(Boolean)).size,
    duplicate_bytes: reclaimable,
    linked_files: files.filter((f) => f.linked_from.length).length,
    ambiguously_linked_files: files.filter((f) => !f.linked_from.length && f.ambiguous_links.length).length,
    // Duplicates that must survive anyway, because a note links their basename.
    link_critical_duplicates: linkCritical.length,
    reclaimable_bytes: files
      .filter((f) => f.classification === "pdf_exact_duplicate" && !f.link_critical)
      .reduce((a, f) => a + f.bytes, 0),
    files,
  };
}

function isInside(root, target) {
  const a = path.resolve(root), b = path.resolve(target);
  if (path.parse(a).root.toLowerCase() !== path.parse(b).root.toLowerCase()) return false;
  const r = path.relative(a, b);
  if (r === "") return true;
  if (path.isAbsolute(r)) return false;
  return !r.split(path.sep).includes("..");
}

function main() {
  const argv = process.argv;
  let vault = null, out = null, allowVaultOut = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--vault") vault = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--allow-vault-out") allowVaultOut = true;
    else if (!vault) vault = argv[i];
  }
  vault = path.resolve(vault || path.join(__dirname, "..", "..", "..", ".."));
  const report = inventory(vault);
  const json = JSON.stringify(report, null, 2);
  if (!out) { process.stdout.write(json + "\n"); return; }
  const target = path.resolve(out);
  if (isInside(vault, target) && !allowVaultOut) {
    console.error("Refusing to write inside the vault: " + target);
    process.exitCode = 3;
    return;
  }
  fs.writeFileSync(target, json + "\n", "utf8");
  console.error("wrote " + target + "  " + JSON.stringify(report.counts));
}
if (require.main === module) main();

module.exports = {
  inventory, collectPdfs, auditLinks, classify, embeddedDoi, trimDoi, CLASSIFICATIONS,
};
