"use strict";

/**
 * Require a B-sync trailer on every future commit that changes main.js.
 *
 * 35ab710 is the reviewed Preview.4 integration checkpoint.  The preceding
 * P1/P2 embed commits are covered together by the dated 2026-10-10 write-path
 * and asset audits; after that checkpoint, source-recovery Agent B must be
 * told exactly which bundle symbols changed instead of discovering drift by
 * comparing hashes later.
 */
const { execFileSync } = require("node:child_process");

const ADOPTION_BASE = "35ab710";
const TRAILER = /^B-sync:\s*\S.+$/mi;

function auditCommits(commits) {
  return commits.filter((entry) => entry.touchesMain && !TRAILER.test(entry.message || ""));
}

function readMainCommits({ cwd = process.cwd(), base = ADOPTION_BASE, head = "HEAD" } = {}) {
  const hashes = execFileSync("git", ["rev-list", "--reverse", `${base}..${head}`, "--", "main.js"], {
    cwd, encoding: "utf8",
  }).trim().split(/\r?\n/).filter(Boolean);
  return hashes.map((hash) => ({
    hash,
    touchesMain: true,
    message: execFileSync("git", ["show", "-s", "--format=%B", hash], { cwd, encoding: "utf8" }),
  }));
}

function main(argv = process.argv.slice(2)) {
  const baseAt = argv.indexOf("--base");
  const headAt = argv.indexOf("--head");
  const base = baseAt >= 0 ? argv[baseAt + 1] : ADOPTION_BASE;
  const head = headAt >= 0 ? argv[headAt + 1] : "HEAD";
  const commits = readMainCommits({ base, head });
  const missing = auditCommits(commits);
  if (missing.length) {
    console.error("main.js changed without the required B-sync trailer:");
    for (const entry of missing) console.error(`  ${entry.hash.slice(0, 12)}`);
    console.error("Add a commit-message trailer such as: B-sync: schEvidenceTools, createExperimentFromAgent");
    process.exitCode = 1;
    return;
  }
  console.log(`B-sync guard PASS (${commits.length} main.js-changing commit(s) after ${base})`);
}

if (require.main === module) main();

module.exports = { ADOPTION_BASE, TRAILER, auditCommits, readMainCommits };
