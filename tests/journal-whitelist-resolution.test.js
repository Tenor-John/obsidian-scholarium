const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { describe, it, assert } = require("./harness");

/* Regression for the 2026-09-05 "0/35，35 条未通过期刊白名单" run.

   Two defects stacked, and the second was created by the fix for the first.

   The original code hardcoded one developer's drive letter for the whitelist
   directory. Removing it made the skill portable but pointed it at
   `<root>/Scholarium/journal-whitelist`, with a comment asserting that `root`
   is the vault root. It is not: the pipeline invokes this skill with the
   PROJECT folder, because that is where literature/downloaded-pdfs lives. So
   the lookup resolved to …/Au-TiO2/Scholarium/journal-whitelist, found
   nothing, and loadJournalWhitelist returned `enabled: true` with an empty
   allow list — which blocks every record rather than admitting every record.

   Measured on the real run: 35 of 35 blocked as venue_not_whitelisted, zero
   download attempts made on that channel, and the summary told the user to go
   audit whitelist rules that were never consulted.

   The whitelist is vault-wide, so ancestors of `root` are now searched. */

const SCRIPT = path.join(
  __dirname, "..", "agent-canvas-demo", "skills", "paper-downloader", "scripts", "browser_downloader.js",
);

function makeVault(withWhitelist) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "wl-vault-"));
  const project = path.join(vault, "Au-TiO2");
  fs.mkdirSync(path.join(project, "literature"), { recursive: true });
  if (withWhitelist) {
    const dir = path.join(vault, "Scholarium", "journal-whitelist");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "whitelist_journals.json"), JSON.stringify({
      "0028-0836": { issn: "0028-0836", names: ["NATURE"], all_issns: ["0028-0836"] },
      "1936-0851": { issn: "1936-0851", names: ["ACS NANO"], all_issns: ["1936-0851"] },
    }));
  }
  return { vault, project, cleanup: () => fs.rmSync(vault, { recursive: true, force: true }) };
}

function dryRun(root, records) {
  const inputFile = path.join(os.tmpdir(), `wl-input-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(inputFile, JSON.stringify({ mode: "dry_run", records }));
  try {
    const run = spawnSync(process.execPath, [SCRIPT, root, inputFile], {
      encoding: "utf8", windowsHide: true, timeout: 120000,
    });
    try { return JSON.parse(run.stdout); }
    catch (_) { return { parseFailed: true, stdout: run.stdout, stderr: run.stderr }; }
  } finally { try { fs.unlinkSync(inputFile); } catch (_) { /* best effort */ } }
}

const RECORDS = [
  { title: "A", doi: "10.1038/nature01", venue: "Nature", issn: "0028-0836" },
  { title: "B", doi: "10.1021/acsnano01", venue: "ACS Nano", issn: "1936-0851" },
];

describe("期刊白名单：从课题目录也要能找到 vault 级白名单", () => {
  it("课题目录下运行时，向上找到 vault 的白名单", () => {
    // This is the exact invocation shape the pipeline uses.
    const v = makeVault(true);
    try {
      const out = dryRun(v.project, RECORDS);
      assert.ok(!out.parseFailed, "脚本应输出 JSON：" + JSON.stringify(out).slice(0, 200));
      assert.eq(out.whitelist.source, "official_partition_whitelist",
        "从课题目录必须能找到 vault 级白名单，实际 source=" + out.whitelist.source);
      assert.eq(out.whitelist.blocked_not_whitelisted, 0, "白名单内的期刊不该被拦");
      assert.eq(out.candidate_records_after_whitelist, RECORDS.length);
    } finally { v.cleanup(); }
  });

  it("真的没有白名单时，拦截并说明原因，而不是静默放行", () => {
    /* Fail-closed is the right choice for an admission gate — but it must be
       accompanied by a reason, because "blocked" and "no such file" look
       identical from the outside. */
    const v = makeVault(false);
    try {
      const out = dryRun(v.project, RECORDS);
      assert.ok(!out.parseFailed);
      assert.eq(out.whitelist.source, "official_partition_whitelist_missing");
      assert.eq(out.whitelist.blocked_not_whitelisted, RECORDS.length, "缺白名单时必须全拦");
      assert.ok(out.whitelist.error, "必须给出原因，否则用户会去查根本没被读到的规则");
      assert.match(out.whitelist.error, /未找到期刊分区白名单目录/);
      // The searched paths must be reported so the user knows where to put it.
      assert.match(out.whitelist.error, /journal-whitelist/);
    } finally { v.cleanup(); }
  });

  it("环境变量覆盖优先于目录推导", () => {
    const v = makeVault(false);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "wl-explicit-"));
    fs.writeFileSync(path.join(other, "whitelist_journals.json"), JSON.stringify({
      "0028-0836": { issn: "0028-0836", names: ["NATURE"], all_issns: ["0028-0836"] },
    }));
    const previous = process.env.SCHOLARIUM_JOURNAL_WHITELIST_DIR;
    process.env.SCHOLARIUM_JOURNAL_WHITELIST_DIR = other;
    try {
      const out = dryRun(v.project, RECORDS);
      assert.eq(out.whitelist.source, "official_partition_whitelist");
    } finally {
      if (previous === undefined) delete process.env.SCHOLARIUM_JOURNAL_WHITELIST_DIR;
      else process.env.SCHOLARIUM_JOURNAL_WHITELIST_DIR = previous;
      v.cleanup();
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("向上查找是有界的，不会一路 stat 到盘符根", () => {
    // An unbounded walk would stat its way to the drive root on every single
    // download; the bound is eight levels.
    const source = fs.readFileSync(SCRIPT, "utf8");
    assert.match(source, /depth < 8/);
    assert.match(source, /journalWhitelistAncestors/);
  });
});
