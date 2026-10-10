"use strict";
/**
 * Tests for the preflight generator and the offline source reassessor.
 *
 * These run against a synthetic vault built in a temp directory, so they assert
 * behaviour rather than the current contents of anyone's real vault.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const gen = require("../tools/migration-preflight-generate");
const { validatePreflight } = require("../tools/migration-conservation");
const reassess = require("../tools/source-reassess");

/* ------------------------------------------------------------------ */
/* synthetic vault                                                     */
/* ------------------------------------------------------------------ */
function anchors(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: "b" + i, tag: "p", len: 40, hash: "x", head: "body text " + i,
  }));
}

function makeVault(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-vault-"));
  fs.mkdirSync(path.join(root, "Experiments", "WebClips"), { recursive: true });
  build({
    root,
    /** Write one WebClips paper folder. */
    clip(name, opts) {
      const dir = path.join(root, "Experiments", "WebClips", name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, name + ".md"),
        "---\ntitle: " + name + "\n" + (opts.noteDoi === undefined ? "" : "doi: " + opts.noteDoi + "\n")
          + (opts.doi ? "doi: " + opts.doi + "\n" : "") + "---\n" + (opts.body || "text"),
        "utf8",
      );
      if (opts.summary)
        fs.writeFileSync(path.join(dir, name + "-文献总结.md"), "summary", "utf8");
      if (opts.assets) {
        fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
        fs.writeFileSync(path.join(dir, "assets", "img-01.png"), "png", "utf8");
      }
      if (opts.meta !== null) {
        fs.writeFileSync(path.join(dir, "source.raw.html"), opts.raw || "<html>article</html>", "utf8");
        fs.writeFileSync(path.join(dir, "source.clean.html"), "<html>clean</html>", "utf8");
        fs.writeFileSync(
          path.join(dir, "source.meta.json"),
          JSON.stringify({
            schema_version: 1,
            capture_state: opts.captureState,
            http_status: opts.httpStatus === undefined ? 200 : opts.httpStatus,
            doi: opts.doi || "",
            final_url: opts.url || "",
            clean: { anchor_count: opts.anchorCount === undefined ? 200 : opts.anchorCount },
            anchors: anchors(opts.anchorCount === undefined ? 200 : opts.anchorCount),
          }),
          "utf8",
        );
      }
      return dir;
    },
  });
  return root;
}

const find = (m, re) => m.sources.filter((s) => re.test(s.source_path));
const one = (m, re) => {
  const hits = find(m, re);
  assert.eq(hits.length, 1, "expected exactly one source matching " + re);
  return hits[0];
};

/* ------------------------------------------------------------------ */
describe("migration preflight generator", () => {
  it("migrates only archives positively marked verified", () => {
    const vault = makeVault(({ clip }) => {
      clip("good", { captureState: "verified" });
      clip("suspect-paywall", { captureState: "suspect" });
      clip("challenged", { captureState: "challenge" });
      clip("failed-attempt", { captureState: "failed" });
      clip("legacy-no-state", { captureState: undefined });
    });
    const m = gen.generate(vault);

    assert.eq(one(m, /good\/good\.md/).disposition, "migrate");
    // The bug this pins: an earlier denylist checked only unknown/absent/
    // unparseable, so `suspect` -- the state that means "possibly a paywall or
    // challenge page" -- fell straight through into `migrate`.
    for (const name of ["suspect-paywall", "challenged", "failed-attempt", "legacy-no-state"]) {
      const s = one(m, new RegExp(name + "/" + name + "\\.md"));
      assert.eq(s.disposition, "candidate", name + " must not migrate");
      assert.ok(s.classification, name + " needs a classification");
    }
  });

  it("moves a remote-image paper flat and a local-image paper as a package", () => {
    // How a note resolves its images decides its shape. Remote URLs survive any
    // move, so those papers stay flat; a relative path only survives if the
    // folder travels with the note. This replaced an earlier rule that held
    // local-image papers back entirely — correct while nothing could carry the
    // assets, wrong once packages exist, and it would have blocked every
    // well-captured paper, since good captures are exactly the ones with images.
    const vault = makeVault(({ clip }) => {
      clip("remote-images", { captureState: "verified", body: "![fig](https://example.org/f.png)" });
      clip("local-images", { captureState: "verified", assets: true, body: "![fig](assets/img-01.png)" });
    });
    const m = gen.generate(vault);

    const remote = one(m, /remote-images\/remote-images\.md/);
    assert.eq(remote.disposition, "migrate");
    assert.eq(remote.target.target_path, "Research/Papers/remote-images.md");
    assert.notOk(remote.target.attachments, "nothing to carry");

    const local = one(m, /local-images\/local-images\.md/);
    assert.eq(local.disposition, "migrate");
    assert.eq(local.target.target_path, "Research/Papers/local-images/local-images.md");
    assert.eq(local.target.attachments.length, 1);
  });

  it("classifies asset links by resolution rule, not by file extension", () => {
    assert.ok(gen.hasRelativeAssetLinks("![a](assets/x.png)"));
    assert.ok(gen.hasRelativeAssetLinks("![a](./sub/x.webp)"));
    assert.notOk(gen.hasRelativeAssetLinks("![a](https://e.org/x.png)"));
    assert.notOk(gen.hasRelativeAssetLinks("![a](data:image/svg+xml;base64,AAA)"));
    assert.notOk(gen.hasRelativeAssetLinks("no images at all"));
  });

  it("retains literature summaries in place rather than queueing them", () => {
    const vault = makeVault(({ clip }) => clip("paper", { captureState: "verified", summary: true }));
    const m = gen.generate(vault);
    const s = one(m, /文献总结/);
    // Ruled: no new v1 object type for these. The decision is made, so
    // `candidate` ("awaiting human classification") would misreport it.
    assert.eq(s.disposition, "exclude");
    assert.ok(s.reason, "exclude needs a reason");
    assert.eq(s.retained_in_place, true, "exclude here means not migrated, not discarded");
  });

  it("keeps the paper basename so vault-wide wikilinks keep resolving", () => {
    const vault = makeVault(({ clip }) => clip("named-paper", { captureState: "verified" }));
    const s = one(gen.generate(vault), /named-paper\/named-paper\.md/);
    assert.eq(path.posix.basename(s.target.target_path), "named-paper.md");
  });

  it("produces a manifest the conservation checker accepts", () => {
    const vault = makeVault(({ clip }) => {
      clip("a", { captureState: "verified", summary: true });
      clip("b", { captureState: "unknown" });
      clip("c", { captureState: "suspect", assets: true, body: "![f](assets/img-01.png)" });
    });
    const m = gen.generate(vault);
    const report = validatePreflight(m);
    assert.ok(report.valid, report.errors.join("; "));
    const total = report.counts.migrate + report.counts.candidate
      + report.counts.exclude + report.counts.retained_settings;
    assert.eq(total, report.counts.scanned, "every source needs exactly one terminal state");
  });

  it("lets a reassessment annotate a held-back source but never promote it", () => {
    const vault = makeVault(({ clip }) => clip("held", { captureState: "unknown" }));
    const map = new Map([["held", {
      reassessed_capture_state: "offline_eligible", eligible: true, reasons: [],
    }]]);
    const s = one(gen.generate(vault, map), /held\/held\.md/);
    assert.eq(s.disposition, "candidate",
      "reading archived bytes is not a person confirming them");
  });

  it("mints one Paper per article, not one per capture", () => {
    const DOI = "10.1021/jacs.6c01656";
    const vault = makeVault(({ clip }) => {
      clip("first-try", { captureState: "verified", doi: DOI, anchorCount: 167 });
      clip("fullest", { captureState: "verified", doi: DOI, anchorCount: 170 });
      clip("blocked", { captureState: "unknown", doi: DOI, anchorCount: 4 });
      clip("unrelated", { captureState: "verified", doi: "10.1038/other" });
    });
    const m = gen.generate(vault);
    const migrating = m.sources.filter((s) => s.disposition === "migrate");
    assert.eq(migrating.length, 2, "one per article: the duplicate group plus the unrelated paper");

    const winner = one(m, /fullest\/fullest\.md/);
    assert.eq(winner.disposition, "migrate", "the most complete verified capture wins");
    assert.eq(winner.notes.duplicate_captures, 2);

    for (const name of ["first-try", "blocked"]) {
      const s = one(m, new RegExp(name + "/" + name + "\\.md"));
      assert.eq(s.disposition, "candidate", name + " must not become a second Paper");
      assert.eq(s.duplicate_of, winner.source_path);
      // Nothing is deleted: a duplicate capture still records what the
      // publisher served that day.
      assert.match(s.classification, /retained_as_raw_clipping/);
    }
  });

  it("nominates no winner when a duplicate group has no verified capture", () => {
    const vault = makeVault(({ clip }) => {
      clip("blocked-a", { captureState: "unknown", doi: "10.1000/x", anchorCount: 4 });
      clip("blocked-b", { captureState: "unknown", doi: "10.1000/x", anchorCount: 4 });
    });
    const m = gen.generate(vault);
    assert.eq(m.sources.filter((s) => s.disposition === "migrate").length, 0,
      "several copies of a challenge page still do not make a Paper");
    assert.eq(one(m, /blocked-a/).duplicate_group, "doi:10.1000/x");
  });

  it("picks the same winner on every run", () => {
    const build = ({ clip }) => {
      clip("bbb", { captureState: "verified", doi: "10.1000/tie", anchorCount: 100 });
      clip("aaa", { captureState: "verified", doi: "10.1000/tie", anchorCount: 100 });
    };
    // Equal anchor counts must not leave the choice to directory order; a
    // manifest that reshuffles between runs cannot be reviewed or diffed.
    const first = gen.generate(makeVault(build));
    const second = gen.generate(makeVault(build));
    const won = (m) => m.sources.find((s) => s.disposition === "migrate").source_path;
    assert.eq(won(first), won(second));
    assert.match(won(first), /aaa/, "ties break on the earliest folder name");
  });

  it("matches a blocked capture to its twin through the note's own doi", () => {
    // The failed captures never recorded a DOI in their metadata, so keying on
    // capture metadata alone put them in a URL group of their own while the
    // successful capture sat in a DOI group -- one article seen as two.
    const vault = makeVault(({ clip }) => {
      clip("good", { captureState: "verified", doi: "10.1000/x", anchorCount: 300 });
      clip("blocked", { captureState: "unknown", noteDoi: "10.1000/x", url: "https://pubs.acs.org/doi/10.1000/x", anchorCount: 4 });
    });
    const m = gen.generate(vault);
    assert.eq(one(m, /blocked\/blocked\.md/).duplicate_of, "Experiments/WebClips/good/good.md");
  });

  it("reads identity out of a /doi/ publisher url when nothing else recorded it", () => {
    const vault = makeVault(({ clip }) => {
      clip("a", { captureState: "verified", url: "https://pubs.acs.org/doi/10.1021/jacs.1c1", anchorCount: 300 });
      clip("b", { captureState: "verified", doi: "10.1021/jacs.1c1", anchorCount: 200 });
    });
    assert.eq(gen.generate(vault).sources.filter((s) => s.disposition === "migrate").length, 1);
  });

  it("keeps captures together when they share a url but disagree on doi", () => {
    // Real data: two clippings of one Nature article, one of which carries a
    // J. Med. Chem. DOI scraped out of a citation in the page body.
    const vault = makeVault(({ clip }) => {
      clip("right", { captureState: "unknown", noteDoi: "10.1038/s41557-026-02148-z", url: "https://www.nature.com/articles/s41557-026-02148-z" });
      clip("wrong-doi", { captureState: "unknown", noteDoi: "10.1021/acs.jmedchem.4c01122", url: "https://www.nature.com/articles/s41557-026-02148-z" });
    });
    const m = gen.generate(vault);
    const a = one(m, /right\/right\.md/), b = one(m, /wrong-doi\/wrong-doi\.md/);
    assert.eq(a.duplicate_group, b.duplicate_group, "a wrong DOI must not split a real duplicate");
    assert.deepEq(a.duplicate_doi_conflict,
      ["doi:10.1021/acs.jmedchem.4c01122", "doi:10.1038/s41557-026-02148-z"]);
  });

  it("holds back a migration whose duplicate group disagrees on doi", () => {
    const vault = makeVault(({ clip }) => {
      clip("cap-a", { captureState: "verified", noteDoi: "10.1000/aaa", url: "https://e.org/art", anchorCount: 300 });
      clip("cap-b", { captureState: "verified", noteDoi: "10.2000/bbb", url: "https://e.org/art", anchorCount: 200 });
    });
    const m = gen.generate(vault);
    assert.eq(m.sources.filter((s) => s.disposition === "migrate").length, 0,
      "a Paper carrying the wrong DOI is worse than a Paper that arrives later");
    assert.match(one(m, /cap-a/).classification, /disagrees_on_doi/);
  });

  it("groups repeat captures by url when no doi was recorded", () => {
    const vault = makeVault(({ clip }) => {
      clip("route-a", { captureState: "verified", url: "https://e.org/art?utm=1", anchorCount: 300 });
      clip("route-b", { captureState: "verified", url: "https://e.org/art#s2", anchorCount: 200 });
    });
    const m = gen.generate(vault);
    assert.eq(m.sources.filter((s) => s.disposition === "migrate").length, 1,
      "query strings and fragments do not make it a different article");
  });

  it("does not mint a second Paper for an article already migrated", () => {
    // The exact regression from batch one: PAPER-004 moved to Research/Papers,
    // and its "-2" capture — which had been a suppressed duplicate — was
    // promoted to `migrate` the moment its winner left the WebClips scan.
    const DOI = "10.1021/jacs.6c01656";
    const vault = makeVault(({ root, clip }) => {
      clip("leftover-2", { captureState: "verified", doi: DOI, anchorCount: 167 });
      const papers = path.join(root, "Research", "Papers");
      fs.mkdirSync(papers, { recursive: true });
      fs.writeFileSync(path.join(papers, "already.md"),
        "---\nuid: 019fef48-5be0-786b-8da5-39a220613712\ndisplay_id: PAPER-004\n"
        + "schema_version: 1\ntype: paper\ndoi: \"" + DOI + "\"\n"
        + "source_archive_path: \"Experiments/WebClips/gone\"\n---\nbody", "utf8");
    });
    const m = gen.generate(vault);

    assert.eq(m.sources.filter((s) => s.disposition === "migrate").length, 0,
      "the article already has a Paper");
    const left = one(m, /leftover-2/);
    assert.eq(left.classification, "duplicate_of_already_migrated_paper");
    assert.eq(left.duplicate_of, "Research/Papers/already.md");
    assert.eq(left.duplicate_of_uid, "019fef48-5be0-786b-8da5-39a220613712",
      "schema-v1 §2.1: relations reference uid, and the winner has one now");
  });

  it("matches a leftover capture to its Paper by archive path alone", () => {
    // Metadata can be missing or wrong; the folder a Paper was migrated out of
    // is unambiguous.
    const vault = makeVault(({ root, clip }) => {
      clip("orphan", { captureState: "verified", url: "https://e.org/a" });
      const papers = path.join(root, "Research", "Papers");
      fs.mkdirSync(papers, { recursive: true });
      fs.writeFileSync(path.join(papers, "p.md"),
        "---\nuid: 019fef48-5be0-786b-8da5-39a220613712\ntype: paper\n"
        + "source_archive_path: \"Experiments/WebClips/orphan\"\n---\nbody", "utf8");
    });
    const s = one(gen.generate(vault), /orphan\/orphan\.md/);
    assert.eq(s.disposition, "candidate");
    assert.eq(s.classification, "duplicate_of_already_migrated_paper");
  });

  it("ignores non-paper files sitting in Research/Papers", () => {
    const vault = makeVault(({ root, clip }) => {
      clip("real", { captureState: "verified", doi: "10.1038/aaa" });
      const papers = path.join(root, "Research", "Papers");
      fs.mkdirSync(papers, { recursive: true });
      fs.writeFileSync(path.join(papers, "README.md"), "just a note, no frontmatter", "utf8");
      fs.writeFileSync(path.join(papers, "index.md"),
        "---\ntype: project\ndoi: \"10.1038/aaa\"\n---\nnot a paper", "utf8");
    });
    assert.eq(one(gen.generate(vault), /real\/real\.md/).disposition, "migrate",
      "a stray file must not be mistaken for an existing Paper");
  });

  it("packages a paper with its assets instead of moving the note alone", () => {
    const vault = makeVault(({ clip }) => {
      clip("withimg", { captureState: "verified", assets: true, body: "![f](assets/img-01.png)" });
    });
    const m = gen.generate(vault);
    const s = one(m, /withimg\/withimg\.md/);
    assert.eq(s.disposition, "migrate");
    assert.eq(s.target.target_path, "Research/Papers/withimg/withimg.md",
      "the note keeps its basename and gains a package directory");
    assert.eq(s.target.attachments.length, 1);
    assert.eq(s.target.attachments[0].to, "Research/Papers/withimg/assets/img-01.png",
      "the relative link assets/img-01.png must still resolve after the move");
    assert.match(s.target.attachments[0].sha256, /^[0-9a-f]{64}$/);
    assert.eq(find(m, /withimg\/assets$/).length, 0,
      "the assets directory is accounted for as attachments, not as a leftover candidate");
  });

  it("keeps same-named attachments from colliding across papers", () => {
    // The whole reason for per-paper packages: img-01.png is what the clipper
    // names every first image, so a shared Research/Papers/assets pool would
    // have papers silently overwrite each other.
    const vault = makeVault(({ clip }) => {
      clip("paper-a", { captureState: "verified", assets: true, body: "![f](assets/img-01.png)" });
      clip("paper-b", { captureState: "verified", assets: true, body: "![f](assets/img-01.png)" });
    });
    const m = gen.generate(vault);
    const tos = m.sources.filter((s) => s.target && s.target.attachments)
      .flatMap((s) => s.target.attachments.map((a) => a.to));
    assert.eq(tos.length, 2);
    assert.eq(new Set(tos).size, 2, "two papers must not write to the same attachment path");
    assert.ok(validatePreflight(m).valid, validatePreflight(m).errors.join("; "));
  });

  it("does not package a note whose images live outside assets/", () => {
    const vault = makeVault(({ clip }) => {
      const dir = clip("odd", { captureState: "verified", assets: true, body: "![f](figures/x.png)" });
      fs.mkdirSync(path.join(dir, "figures"), { recursive: true });
      fs.writeFileSync(path.join(dir, "figures", "x.png"), "png", "utf8");
    });
    const s = one(gen.generate(vault), /odd\/odd\.md/);
    assert.eq(s.disposition, "candidate");
    assert.match(s.classification, /outside_assets_directory/,
      "packaging assets/ would not repair a link that points somewhere else");
  });

  it("does not package a note whose image is already missing", () => {
    const vault = makeVault(({ clip }) =>
      clip("broken", { captureState: "verified", assets: true, body: "![f](assets/gone.png)" }));
    const s = one(gen.generate(vault), /broken\/broken\.md/);
    assert.eq(s.disposition, "candidate");
    assert.match(s.classification, /target_missing/);
  });

  it("recognises a packaged Paper as an existing winner", () => {
    // The flat-only index would miss packages entirely, and a missed Paper stops
    // suppressing its duplicates — the same regression the first batch hit.
    const vault = makeVault(({ root, clip }) => {
      clip("leftover", { captureState: "verified", doi: "10.1000/pkg", anchorCount: 300 });
      const pkg = path.join(root, "Research", "Papers", "packaged");
      fs.mkdirSync(path.join(pkg, "assets"), { recursive: true });
      fs.writeFileSync(path.join(pkg, "packaged.md"),
        "---\nuid: 019fef48-5be0-786b-8da5-39a220613712\ntype: paper\ndoi: \"10.1000/pkg\"\n---\nbody", "utf8");
      fs.writeFileSync(path.join(pkg, "assets", "img-01.png"), "png", "utf8");
    });
    const m = gen.generate(vault);
    assert.eq(m.sources.filter((s) => s.disposition === "migrate").length, 0);
    assert.eq(one(m, /leftover\/leftover\.md/).duplicate_of, "Research/Papers/packaged/packaged.md");
  });

  it("still finds flat Papers from the first batch", () => {
    const vault = makeVault(({ root, clip }) => {
      clip("leftover", { captureState: "verified", doi: "10.1000/flat", anchorCount: 300 });
      const dir = path.join(root, "Research", "Papers");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "flat.md"),
        "---\nuid: 019fef48-5be0-786b-8da5-39a220613712\ntype: paper\ndoi: \"10.1000/flat\"\n---\nbody", "utf8");
    });
    assert.eq(one(gen.generate(vault), /leftover/).duplicate_of, "Research/Papers/flat.md",
      "the six already-migrated flat Papers must keep working");
  });

  it("reads image paths without tripping over titles or escapes", () => {
    assert.deepEq(gen.relativeAssetLinks('![a](assets/x.png "a title")'), ["assets/x.png"]);
    assert.deepEq(gen.relativeAssetLinks("![a](assets/a%20b.png)"), ["assets/a b.png"]);
    assert.deepEq(gen.relativeAssetLinks("![a](https://e.org/x.png)"), []);
  });

  it("refuses a report that is not a reassessment", () => {
    const f = path.join(os.tmpdir(), "not-a-reassessment.json");
    fs.writeFileSync(f, JSON.stringify({ kind: "something-else" }), "utf8");
    let threw = false;
    try { gen.loadReassessment(f); } catch (e) { threw = /reassessment report/.test(e.message); }
    assert.ok(threw, "a wrong-kind report must not be silently ignored");
  });
});

/* ------------------------------------------------------------------ */
describe("offline source reassessment", () => {
  const assessOne = (opts) => {
    const vault = makeVault(({ clip }) => clip("f", opts));
    return reassess.reassess(vault).results[0];
  };

  it("passes a healthy archive", () => {
    const r = assessOne({ captureState: "unknown", httpStatus: 200, anchorCount: 200 });
    assert.eq(r.eligible, true, r.reasons.join(","));
    assert.eq(r.reassessed_capture_state, "offline_eligible");
  });

  it("never rewrites the historical capture_state", () => {
    const r = assessOne({ captureState: "unknown", httpStatus: 200, anchorCount: 200 });
    assert.eq(r.capture_state, "unknown",
      "the record of what happened at capture time is not ours to edit");
    assert.ok(r.reassessed_capture_state !== r.capture_state);
  });

  it("rejects a non-2xx response however the body reads", () => {
    const r = assessOne({ captureState: "unknown", httpStatus: 403, anchorCount: 200 });
    assert.eq(r.eligible, false);
    assert.match(r.reasons.join(","), /http_status_403/);
  });

  it("rejects a body too thin to carry evidence anchors", () => {
    const r = assessOne({ captureState: "unknown", httpStatus: 200, anchorCount: 4 });
    assert.eq(r.eligible, false);
    assert.match(r.reasons.join(","), /too_few_anchors/);
  });

  it("treats a Cloudflare script tag as corroboration, not as a verdict", () => {
    // Cloudflare injects challenge-platform/scripts/jsd/main.js into pages it
    // serves successfully. Failing on that marker alone rejected a real
    // 200-status article here while its duplicate capture passed.
    const r = assessOne({
      captureState: "unknown", httpStatus: 200, anchorCount: 200,
      raw: "<html><script src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'></script>article</html>",
    });
    assert.eq(r.eligible, true, "marker alone must not disqualify: " + r.reasons.join(","));
    assert.deepEq(r.notes, ["cloudflare_instrumentation_present_on_healthy_capture"]);
  });

  it("labels a marker-bearing failure as a challenge rather than a plain suspect", () => {
    const r = assessOne({
      captureState: "unknown", httpStatus: 403, anchorCount: 4,
      raw: "<html>cf_chl_opt 正在进行安全验证</html>",
    });
    assert.eq(r.reassessed_capture_state, "challenge");
  });

  it("reports an archive it cannot read instead of guessing", () => {
    const r = assessOne({ captureState: "unknown", meta: null });
    assert.eq(r.eligible, false);
    assert.eq(r.reassessed_capture_state, "unassessable");
  });

  it("defers to the shipping detector so the two cannot drift apart", () => {
    // The English-prose branch belongs to main.js; this asserts we call it
    // rather than carrying a second copy that quietly diverges.
    const r = assessOne({
      captureState: "unknown", httpStatus: 200, anchorCount: 200,
      raw: "<html><title>Just a moment...</title></html>",
    });
    assert.eq(r.eligible, false);
    assert.match(r.reasons.join(","), /shipping_detector_challenge/);
  });
});
