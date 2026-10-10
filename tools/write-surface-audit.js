"use strict";

/**
 * Static persistence-surface inventory.
 *
 * This is deliberately a tripwire, not a security sandbox. It makes every
 * production source change that adds, removes, or rewrites a known persistence
 * primitive review-visible. The human-readable authority classification lives
 * in docs/audits/write-path-matrix-*.md; this module prevents that document
 * from silently becoming stale again.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_EXCLUDES = new Set([
  ".git", "node_modules", "tests", "development", "docs", "backup",
]);

const SOURCE_EXTENSIONS = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx"]);

const PRIMITIVES = Object.freeze([
  { kind: "obsidian-vault", pattern: /\b(?:vault|\.vault)\.(?:create|createFolder|modify|append|delete|trash|rename|copy|createBinary|modifyBinary|process)\s*\(/g },
  { kind: "obsidian-editor", pattern: /\b(?:editor|\.editor)\.(?:replaceSelection|replaceRange|setValue)\s*\(/g },
  { kind: "obsidian-adapter", pattern: /\b(?:adapter|\.adapter)\.(?:write|append|remove|rename|mkdir|writeBinary)\s*\(/g },
  { kind: "obsidian-frontmatter", pattern: /\b(?:fileManager|\.fileManager)\.(?:processFrontMatter|trashFile)\s*\(/g },
  { kind: "node-fs", pattern: /\b(?:fs\.)?(?:writeFileSync|appendFileSync|renameSync|rmSync|unlinkSync|mkdirSync|copyFileSync)\s*\(/g },
  // The descriptor-based half of `fs`. It was invisible until 2026-09-23: a
  // tool copied user data to a backup directory and wrote a manifest with
  // `cpSync` / `openSync`+`writeSync`, and this scan reported zero writes for
  // it. Bypassing the tripwire was not the intent there, but a persistence
  // primitive the audit cannot see is the exact failure this module exists to
  // prevent — the write-path matrix would have gone stale without saying so.
  //
  // Kept deliberately narrow. A bare `cp(` also matches minified third-party
  // code (`l.cp(` in ketcher.js produced six false sites), so only the Sync
  // names and the `promises.` namespace are listed.
  //
  // This is a name-based tripwire, not a mode-aware analyzer: an openSync call
  // whose mode string is "r" counts as a site even though it only reads.
  // Over-reporting is the safe direction, and the semantic classification
  // lives in the write-path matrix. (Written without a call-shaped example on
  // purpose: this scan reads its own source, so `name(args)` in a comment here
  // registers as a real site and would inflate its own fingerprint.)
  { kind: "node-fs-open-write", pattern: /\b(?:fs\.)?(?:cpSync|openSync|writeSync|truncateSync|ftruncateSync|fdatasyncSync|fsyncSync|symlinkSync|linkSync|chmodSync|rmdirSync)\s*\(/g },
  { kind: "node-fs-promises", pattern: /\b(?:fs\.)?promises\.(?:writeFile|appendFile|rename|rm|unlink|mkdir|copyFile|open|write|truncate|symlink|link|chmod|rmdir|cp)\s*\(/g },
  { kind: "browser-state", pattern: /\b(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear)\s*\(/g },
  { kind: "plugin-data", pattern: /\b(?:this\.|plugin\.)?(?:saveData|updateData)\s*\(/g },
]);

function slash(value) {
  return String(value).split(path.sep).join("/");
}

function walk(root, relative = "", excludes = DEFAULT_EXCLUDES) {
  const directory = path.join(root, relative);
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludes.has(entry.name)) continue;
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walk(root, child, excludes));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) out.push(child);
  }
  return out;
}

function surfaceFor(relativePath) {
  const file = slash(relativePath);
  if (file === "main.js") return "generated-main";
  if (file === "ketcher.js") return "third-party-generated-bundle";
  if (file === "version-bump.mjs") return "build-tooling";
  if (file.startsWith("agent-canvas-demo/bridge/")) return "bridge-runtime";
  if (file.startsWith("agent-canvas-demo/skills/")) return "skill-runtime";
  if (file.startsWith("agent-canvas-demo/")) return "agent-ui-state";
  if (file.startsWith("tools/")) return "domain-and-maintenance-tools";
  if (file.startsWith("src/")) return "gated-build-source";
  return "unknown";
}

function normalizedLine(line) {
  return String(line).trim().replace(/\s+/g, " ");
}

function scanProductionWrites(root, options = {}) {
  const resolved = path.resolve(root);
  const excludes = new Set(options.excludes || DEFAULT_EXCLUDES);
  const files = walk(resolved, "", excludes).sort((a, b) => slash(a).localeCompare(slash(b)));
  const sites = [];
  for (const relative of files) {
    const file = slash(relative);
    const surface = surfaceFor(file);
    const lines = fs.readFileSync(path.join(resolved, relative), "utf8").split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const primitive of PRIMITIVES) {
        primitive.pattern.lastIndex = 0;
        let match;
        let occurrence = 0;
        while ((match = primitive.pattern.exec(line))) {
          occurrence += 1;
          const statementHash = crypto.createHash("sha256")
            .update(normalizedLine(line), "utf8").digest("hex");
          sites.push({
            file,
            line: index + 1,
            occurrence,
            kind: primitive.kind,
            surface,
            statement_sha256: statementHash,
          });
          if (match[0].length === 0) primitive.pattern.lastIndex += 1;
        }
      }
    }
  }
  sites.sort((a, b) =>
    a.file.localeCompare(b.file)
      || a.line - b.line
      || a.kind.localeCompare(b.kind)
      || a.occurrence - b.occurrence,
  );
  const approvedShape = sites.map(({ file, occurrence, kind, surface, statement_sha256 }) => ({
    file, occurrence, kind, surface, statement_sha256,
  }));
  const digest = crypto.createHash("sha256")
    .update(JSON.stringify(approvedShape), "utf8").digest("hex");
  const bySurface = {};
  const byKind = {};
  for (const site of sites) {
    bySurface[site.surface] = (bySurface[site.surface] || 0) + 1;
    byKind[site.kind] = (byKind[site.kind] || 0) + 1;
  }
  return {
    schema: "scholarium-write-surface-audit-v1",
    root: slash(resolved),
    digest,
    count: sites.length,
    unknown: sites.filter((site) => site.surface === "unknown"),
    by_surface: bySurface,
    by_kind: byKind,
    sites,
  };
}

function main(argv = process.argv.slice(2)) {
  const rootArg = argv.indexOf("--root");
  const root = rootArg >= 0 ? argv[rootArg + 1] : path.resolve(__dirname, "..");
  const result = scanProductionWrites(root);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.unknown.length) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { PRIMITIVES, scanProductionWrites, surfaceFor };
