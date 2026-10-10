"use strict";

/**
 * Read-only audit for Obsidian wiki links across an entire Vault.
 *
 * It follows Obsidian's useful resolution cases without pretending to be the
 * application: exact Vault paths, paths relative to the source note, and a
 * unique filename match. Ambiguous basename links are reported separately
 * because choosing one automatically would change meaning.
 *
 *   node tools/vault-link-audit.js --vault <vault-root>
 */
const fs = require("fs");
const path = require("path");

function slash(value) {
  return String(value).replace(/\\/g, "/");
}

function walk(root, dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Obsidian does not treat dot-directories, plugin sources, trash or package
    // dependencies as ordinary Vault notes. Including their docs/examples made
    // the report mostly about template links such as [[note-name]], not the
    // user's knowledge graph.
    if ((entry.isDirectory() && entry.name.startsWith(".")) || entry.name === "node_modules") continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, absolute, out);
    else out.push(slash(path.relative(root, absolute)));
  }
  return out;
}

function normalizeTarget(raw) {
  let target = String(raw || "").split("|")[0].trim();
  if (!target || target.startsWith("#") || target.startsWith("^")) return "";
  target = target.split("#")[0].split("^")[0].trim();
  try { target = decodeURIComponent(target); } catch { /* preserve malformed text for reporting */ }
  return slash(target).replace(/^\.\//, "");
}

function auditVault(vault) {
  const root = path.resolve(vault);
  const files = walk(root);
  const exact = new Set(files.map((file) => file.toLowerCase()));
  const markdown = files.filter((file) => file.toLowerCase().endsWith(".md"));
  const byStem = new Map();
  for (const file of files) {
    const stem = path.posix.basename(file, path.posix.extname(file)).toLowerCase();
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(file);
  }

  const unresolved = [];
  const ambiguous = [];
  let links = 0;
  for (const source of markdown) {
    const body = fs.readFileSync(path.join(root, ...source.split("/")), "utf8");
    const re = /!?\[\[([^\]\n]+)\]\]/g;
    let match;
    while ((match = re.exec(body))) {
      const target = normalizeTarget(match[1]);
      if (!target) continue;
      links++;
      const candidates = [target];
      if (!path.posix.extname(target)) candidates.push(target + ".md");
      const sourceDir = path.posix.dirname(source);
      for (const candidate of [...candidates])
        candidates.push(path.posix.normalize(path.posix.join(sourceDir, candidate)));
      if (candidates.some((candidate) => exact.has(candidate.toLowerCase()))) continue;

      // Obsidian accepts short links by filename. A unique stem is safe; more
      // than one is an ambiguity that a person must resolve with a path.
      const stem = path.posix.basename(target, path.posix.extname(target)).toLowerCase();
      const matches = byStem.get(stem) || [];
      const record = { source, target, line: body.slice(0, match.index).split(/\r?\n/).length };
      if (matches.length === 1) continue;
      if (matches.length > 1) ambiguous.push({ ...record, matches });
      else unresolved.push(record);
    }
  }
  return {
    vault: root,
    scanned_files: files.length,
    scanned_markdown: markdown.length,
    wiki_links: links,
    unresolved,
    ambiguous,
    valid: unresolved.length === 0 && ambiguous.length === 0,
  };
}

function main() {
  const index = process.argv.indexOf("--vault");
  const vault = path.resolve(index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : process.cwd());
  const report = auditVault(vault);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.valid ? 0 : 1;
}

if (require.main === module) main();
module.exports = { normalizeTarget, auditVault };
