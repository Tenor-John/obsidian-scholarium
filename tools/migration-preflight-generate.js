"use strict";
/**
 * Generate a real migration preflight manifest from the vault.
 *
 * READ ONLY. Opens nothing for writing inside the vault. The manifest goes to
 * stdout (or --out <path>, which must be outside the vault unless you pass
 * --allow-vault-out).
 *
 * Feed the result to the conservation checker before any migration runs:
 *
 *   node tools/migration-preflight-generate.js --vault <path> --out preflight.json
 *   node tools/migration-conservation.js preflight.json
 *
 * Dispositions follow schema-v1 §7.3. The generator is deliberately
 * conservative: anything it cannot classify with certainty becomes `candidate`
 * so a human decides, rather than being quietly migrated on a guess.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ------------------------------------------------------------------ */
/* args                                                                */
/* ------------------------------------------------------------------ */
function parseArgs(argv) {
  const o = { vault: null, out: null, allowVaultOut: false, reassessment: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") o.vault = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--reassessment") o.reassessment = argv[++i];
    else if (a === "--pdf-inventory") o.pdfInventory = argv[++i];
    else if (a === "--allow-vault-out") o.allowVaultOut = true;
    else if (a === "-h" || a === "--help") o.help = true;
    else if (!o.vault) o.vault = a;
  }
  return o;
}

const USAGE = `Usage:
  node tools/migration-preflight-generate.js --vault <vault-root> [--out <file>]

  --vault   Vault root. Defaults to four levels above this file
            (.obsidian/plugins/obsidian-scholarium/tools -> vault root).
  --out     Write the manifest here instead of stdout. Refused if the path is
            inside the vault, unless --allow-vault-out is given.
  --reassessment <file>
            Optional tools/source-reassess.js report. Adds detail to held-back
            sources; never promotes one to migrate.

Read only. Never writes inside the vault.`;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const rel = (root, p) => path.relative(root, p).split(path.sep).join("/");

/**
 * Is `target` inside `root`?
 *
 * path.relative alone is not enough on Windows: across drive letters it returns
 * the absolute target ("C:\\x" rather than "..\\x"), so a naive
 * !startsWith("..") check reports a different drive as *inside* the vault.
 * Compare the filesystem roots first, then do a segment-aware prefix test so
 * that "…/Research_mod_backup" is not treated as living inside
 * "…/Research_mod".
 */
function isInside(root, target) {
  const a = path.resolve(root);
  const b = path.resolve(target);
  if (path.parse(a).root.toLowerCase() !== path.parse(b).root.toLowerCase()) return false;
  const r = path.relative(a, b);
  if (r === "") return true;
  if (path.isAbsolute(r)) return false;
  return !r.split(path.sep).includes("..");
}

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return m ? { fm: m[1], body: text.slice(m[0].length) } : { fm: "", body: text };
}

function parseFrontmatter(fm) {
  const out = {};
  const lines = fm.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const key = m[1];
    let v = m[2].trim();
    if (v === "") {
      const arr = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1]))
        arr.push(lines[++i].replace(/^\s*-\s+/, "").trim().replace(/^["']|["']$/g, ""));
      out[key] = arr;
    } else if (v.startsWith("[")) {
      out[key] = v.replace(/^\[|\]$/g, "").split(",")
        .map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else out[key] = v.replace(/^["']|["']$/g, "");
  }
  return out;
}

/* Anything beginning with a dot is a backup or tool directory. schema-v1 §7.3
   requires these to be listed explicitly rather than silently skipped. */
const isHidden = (name) => name.startsWith(".");
const isSummaryNote = (n) => /文献总结/.test(n);
const isLitReviewNote = (n) => /LitReview/.test(n);

/* ------------------------------------------------------------------ */
/* scanners                                                            */
/* ------------------------------------------------------------------ */
function scanWebClips(vault, sources, reassessment) {
  const root = path.join(vault, "Experiments", "WebClips");
  if (!fs.existsSync(root)) return;

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, entry.name);

    if (entry.isFile()) {
      // stray manifests and loose notes at the WebClips root
      if (!entry.name.endsWith(".json") && !entry.name.endsWith(".md")) continue;
      const buf = fs.readFileSync(abs);
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: sha256(buf),
        disposition: /^_source-backfill/.test(entry.name) ? "exclude" : "candidate",
        ...(/^_source-backfill/.test(entry.name)
          ? { reason: "backfill_audit_artefact" }
          : { classification: "loose_file_at_webclips_root_requires_user_review" }),
      });
      continue;
    }

    if (isHidden(entry.name)) {
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: sha256(Buffer.from(entry.name, "utf8")),
        disposition: "exclude",
        reason: "backup_directory",
      });
      continue;
    }

    scanPaperFolder(vault, abs, sources, reassessment);
  }
}

function captureStateOf(folder) {
  const mp = path.join(folder, "source.meta.json");
  if (!fs.existsSync(mp)) return { state: "absent", meta: null };
  try {
    const meta = JSON.parse(fs.readFileSync(mp, "utf8"));
    // schema-v1 §7.3: an archive predating capture_state must NOT be inferred
    // as verified from file presence or hash agreement.
    return { state: meta.capture_state || "unknown", meta };
  } catch (e) {
    return { state: "unparseable", meta: null };
  }
}

/**
 * Does the note point at files that live beside it in its own folder?
 *
 * Obsidian resolves `[[wikilinks]]` by filename across the whole vault, so
 * those survive a move as long as the basename is preserved. Relative markdown
 * paths like `assets/img-01.png` do not: they are resolved against the note's
 * own directory and break the moment the note moves without its folder.
 * Remote https:// images are unaffected either way.
 */
function relativeAssetLinks(text) {
  const out = [];
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    // `![alt](path "title")` — the title is not part of the path.
    const raw = m[1].trim().replace(/\s+["'(].*$/, "");
    if (/^(?:https?:|data:|#|\/)/i.test(raw)) continue;
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch (e) { /* keep raw */ }
    out.push(decoded.replace(/^\.\//, ""));
  }
  return out;
}

function hasRelativeAssetLinks(text) {
  return relativeAssetLinks(text).length > 0;
}

/**
 * The files a paper carries with it.
 *
 * These are not sources needing their own disposition and not Asset objects —
 * schema-v1 §5 leaves Asset's fields unfrozen and the checker accepts only the
 * six first-loop types as migration targets. They travel as part of the paper's
 * own migrate entry, which is what keeps the note's bytes untouched: the
 * relative link `assets/img-01.png` still resolves because the folder moves
 * with the note.
 */
function listAssets(vault, folder) {
  const dir = path.join(folder, "assets");
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile()) continue;
    const abs = path.join(dir, f.name);
    out.push({ name: f.name, from: rel(vault, abs), sha256: sha256(fs.readFileSync(abs)) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function scanPaperFolder(vault, folder, sources, reassessment) {
  const files = fs.readdirSync(folder, { withFileTypes: true });
  const { state } = captureStateOf(folder);
  const reassessed = reassessment.get(path.basename(folder)) || null;

  // The note's disposition depends on what is in `assets/`, so read that first
  // rather than hoping the directory entry is visited before the note.
  const assets = listAssets(vault, folder);
  let assetsTravelWithPaper = false;

  for (const f of files) {
    const abs = path.join(folder, f.name);
    if (f.isDirectory()) continue;
    if (!f.name.endsWith(".md")) continue;

    const buf = fs.readFileSync(abs);
    const text = buf.toString("utf8");
    const fm = parseFrontmatter(splitFrontmatter(text).fm);
    const hash = sha256(buf);

    if (isSummaryNote(f.name) || isLitReviewNote(f.name)) {
      // schema-v1 §3 registers thirteen object types and none is a literature
      // summary. Ruled: do not widen the frozen registry for this; keep the
      // notes where they are and revisit if they ever need their own retrieval,
      // versioning or relations. So this is a settled decision, not an open
      // question, and `candidate` — "进入人工归类队列" — would misreport it.
      // `exclude` here means "not migrated", never "discarded".
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: hash,
        disposition: "exclude",
        reason: "derived_knowledge_layer_retained_in_place_no_v1_object_type",
        retained_in_place: true,
      });
      continue;
    }

    // Allowlist, not denylist. An earlier version excluded only unknown /
    // absent / unparseable, which let `suspect` fall through to `migrate` —
    // and `suspect` is exactly the state that means "these bytes may be a
    // paywall or challenge page rather than the article". Nothing but a
    // positive `verified` may migrate.
    if (state !== "verified") {
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: hash,
        __clip: true,
        __doi: fm.doi || "",
        disposition: "candidate",
        classification: reassessed && !reassessed.eligible
          ? "source_archive_" + state + "_reassessed_" + reassessed.reassessed_capture_state
          : "source_archive_capture_state_" + state,
        ...(reassessed ? { reassessment: reassessed } : {}),
      });
      continue;
    }

    // The basename is load-bearing: the summary notes reference these papers by
    // `[[basename]]`, which Obsidian resolves vault-wide. Rename them during
    // migration and those links go dangling.
    const base = f.name.replace(/\.md$/, "");
    const links = relativeAssetLinks(text);

    // A note that resolves images through its own folder can only move if the
    // folder moves with it. Packaging is what keeps the note's bytes untouched
    // — no link rewriting, so §7.2's body-hash conservation still holds.
    if (links.length) {
      const insideAssets = links.every((l) => /^assets\//.test(l));
      const allPresent = links.every((l) => fs.existsSync(path.join(folder, l)));
      if (!insideAssets || !allPresent || !assets.length) {
        sources.push({
          source_path: rel(vault, abs),
          source_sha256: hash,
          __clip: true,
          __doi: fm.doi || "",
          disposition: "candidate",
          // Packaging `assets/` would not repair a link that points elsewhere or
          // at a file that is already missing, so do not pretend it would.
          classification: !allPresent
            ? "relative_asset_link_target_missing"
            : "relative_asset_links_outside_assets_directory",
        });
        continue;
      }

      const pkg = "Research/Papers/" + base;
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: hash,
        __clip: true,
        __doi: fm.doi || "",
        disposition: "migrate",
        target: {
          type: "paper",
          target_path: pkg + "/" + f.name,
          source_sha256: hash,
          // Per-paper packages, not a shared Research/Papers/assets: `img-01.png`
          // repeats across papers and a flat pool would have them overwrite each
          // other silently.
          attachments: assets.map((a) => ({
            from: a.from, to: pkg + "/assets/" + a.name, sha256: a.sha256,
          })),
        },
        notes: { capture_state: state, doi: fm.doi || "", journal: fm.journal || "" },
      });
      assetsTravelWithPaper = true;
      continue;
    }

    sources.push({
      source_path: rel(vault, abs),
      source_sha256: hash,
      __clip: true,
      __doi: fm.doi || "",
      disposition: "migrate",
      target: {
        type: "paper",
        target_path: "Research/Papers/" + f.name,
        source_sha256: hash,
      },
      notes: { capture_state: state, doi: fm.doi || "", journal: fm.journal || "" },
    });
  }

  // Directories are accounted for after the notes, because whether `assets/`
  // still needs a disposition depends on whether a paper claimed it.
  for (const f of files) {
    if (!f.isDirectory()) continue;
    const abs = path.join(folder, f.name);
    if (f.name === "assets" && assetsTravelWithPaper) continue; // now target.attachments
    if (f.name !== "assets" && f.name !== "source-attempts") continue;
    sources.push({
      source_path: rel(vault, abs),
      source_sha256: sha256(Buffer.from(rel(vault, abs), "utf8")),
      disposition: "candidate",
      classification: f.name === "assets"
        ? "asset_directory_without_migrating_paper"
        : "historical_capture_attempts_retained_for_audit",
    });
  }
}

function scanProjects(vault, sources) {
  const root = path.join(vault, "Experiments", "Projects");
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const profile = path.join(dir, "00_课题画像.md");
    if (fs.existsSync(profile)) {
      const buf = fs.readFileSync(profile);
      sources.push({
        source_path: rel(vault, profile),
        source_sha256: sha256(buf),
        disposition: "migrate",
        target: {
          type: "project",
          target_path: "Research/Projects/" + entry.name + ".md",
          source_sha256: sha256(buf),
        },
      });
    } else {
      const pm = path.join(dir, "project.md");
      if (!fs.existsSync(pm)) continue;
      const buf = fs.readFileSync(pm);
      sources.push({
        source_path: rel(vault, pm),
        source_sha256: sha256(buf),
        disposition: "candidate",
        classification: "project_without_profile_requires_user_review",
      });
    }
  }
}

/* Experiments/ root and Literature/ stay `candidate` by explicit instruction:
   they were never part of the WebClips pipeline and their object type is not
   established. */
function scanCandidateAreas(vault, sources) {
  const E = path.join(vault, "Experiments");
  if (!fs.existsSync(E)) return;

  for (const entry of fs.readdirSync(E, { withFileTypes: true })) {
    const abs = path.join(E, entry.name);
    if (entry.isFile() && entry.name.endsWith(".md")) {
      const buf = fs.readFileSync(abs);
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: sha256(buf),
        disposition: "candidate",
        classification: "experiments_root_note_requires_user_review",
      });
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (isHidden(entry.name)) {
      sources.push({
        source_path: rel(vault, abs),
        source_sha256: sha256(Buffer.from(rel(vault, abs), "utf8")),
        disposition: "exclude",
        reason: "backup_directory",
      });
      continue;
    }
    if (entry.name === "WebClips" || entry.name === "Projects") continue;

    let mds = [];
    try {
      mds = fs.readdirSync(abs, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.endsWith(".md"));
    } catch (e) { continue; }
    for (const f of mds) {
      const p = path.join(abs, f.name);
      sources.push({
        source_path: rel(vault, p),
        source_sha256: sha256(fs.readFileSync(p)),
        disposition: "candidate",
        classification: entry.name === "Literature"
          ? "literature_folder_note_requires_user_review"
          : "experiments_subfolder_note_requires_user_review",
      });
    }
  }
}

/* data.json holds API keys. schema-v1 §7.3 allows only retained_settings, and
   the sole permitted extraction is the radar scores. */
function scanPluginData(vault, sources) {
  const p = path.join(
    vault, ".obsidian", "plugins", "obsidian-scholarium", "data.json",
  );
  if (!fs.existsSync(p)) return;
  sources.push({
    source_path: rel(vault, p),
    source_sha256: sha256(fs.readFileSync(p)),
    disposition: "retained_settings",
    reason: "contains local plugin settings and credentials",
    allowed_extractions: ["rssBoard.articles[].radarScores"],
  });
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */
/**
 * Load a `tools/source-reassess.js` report, if one was supplied.
 *
 * The report is advisory. It can add detail to why a source is held back, and
 * it can mark one as worth a human's attention, but it cannot promote anything
 * to `migrate` on its own — schema-v1 §7.3 wants a person in that loop, and
 * reading archived bytes tells us they are not obviously wrong, not that they
 * are right.
 */
function loadReassessment(file) {
  const map = new Map();
  if (!file) return map;
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  if (report.kind !== "scholarium-source-reassessment")
    throw new Error("not a source reassessment report: " + file);
  for (const r of report.results || [])
    map.set(r.folder, {
      reassessed_capture_state: r.reassessed_capture_state,
      eligible: !!r.eligible,
      reasons: r.reasons || [],
    });
  return map;
}

/**
 * Collapse repeat captures of one article down to a single Paper.
 *
 * The same article gets clipped more than once — a retry after a failed
 * capture, or the same DOI reached by two routes. Migrating each copy would
 * mint two Paper objects for one paper, and every relation drawn to either one
 * would then be half the picture.
 *
 * Ruled: keep the most complete verified capture as the Paper; the rest stay
 * where they are as raw clippings carrying `duplicate_of`. Nothing is deleted —
 * a duplicate capture is still evidence of what the publisher served that day.
 *
 * Winner order: verified first, then most anchors, then the earliest folder
 * name. That last tiebreak is not cosmetic: a manifest that reshuffles between
 * runs cannot be reviewed or diffed.
 */
/**
 * Papers that have already been migrated out of WebClips.
 *
 * A migrated Paper still owns its article's identity, but it no longer appears
 * in any WebClips scan. The dedup pass used to see only WebClips, so the moment
 * a winner migrated, the duplicates it had been suppressing looked like
 * originals again — the first batch moved PAPER-004 out and its `-2` capture
 * was immediately promoted to `migrate`, ready to mint a second Paper for the
 * same DOI. Migration was quietly dismantling the one-Paper-per-article rule it
 * had just enforced.
 */
function migratedPapers(vault) {
  const root = path.join(vault, "Research", "Papers");
  const out = [];
  if (!fs.existsSync(root)) return out;

  /* Recursive, because Papers now live in two shapes. The six migrated in the
     first batch are flat `Research/Papers/<name>.md`; anything carrying
     attachments is a package `Research/Papers/<name>/<name>.md`. A flat-only
     scan would miss every package, and a missed Paper stops being the winner of
     its duplicate group — which is exactly how the first batch nearly minted a
     second Paper for an article that already had one. */
  const visit = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "assets" || depth >= 1) continue;
        visit(abs, depth + 1);
        continue;
      }
      if (!e.name.endsWith(".md")) continue;
      let fm;
      try { fm = parseFrontmatter(splitFrontmatter(fs.readFileSync(abs, "utf8")).fm); }
      catch (err) { continue; }
      if (fm.type !== "paper") continue;
      out.push({
        path: rel(vault, abs),
        uid: fm.uid || "",
        display_id: fm.display_id || "",
        doi: fm.doi || "",
        url: fm.source || "",
        archive: fm.source_archive_path || "",
      });
    }
  };
  visit(root, 0);
  return out;
}

/** Every identifier one capture or Paper carries, normalised. */
function identityKeys({ doi, url, archive }) {
  const keys = [];
  const d = String(doi || "").trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:/, "");
  if (/^10\.\d{4,9}\//.test(d)) keys.push("doi:" + d);
  const u = String(url || "").split(/[?#]/)[0].toLowerCase();
  if (u) {
    keys.push("url:" + u);
    const fromUrl = /\/doi\/(?:abs\/|full\/|pdf\/)?(10\.\d{4,9}\/\S+)$/i.exec(u);
    if (fromUrl) keys.push("doi:" + fromUrl[1].toLowerCase());
  }
  // The archive folder is the strongest link of all: a clip living in folder X
  // and a Paper whose source_archive_path is X are the same article, whatever
  // their metadata says.
  const a = String(archive || "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (a) keys.push("archive:" + a.toLowerCase());
  return keys;
}

function dedupeByArticle(vault, sources) {
  /* Union-find over every identifier a capture carries, rather than picking one
     "best" identifier per capture. Two captures are the same article if they
     agree on ANY of DOI or landing URL.

     A single key does not survive this data. Keying on DOI alone split a pair
     that shares a Nature URL but disagrees on DOI, because one note's DOI was
     scraped from a citation in the page body and belongs to a different journal
     entirely. Keying on URL alone split a blocked capture from its successful
     twin reached by a different route. Union keeps both pairs together. */
  const parent = new Map();
  const find = (k) => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const add = (k) => { if (!parent.has(k)) parent.set(k, k); return find(k); };
  const union = (a, b) => { const x = add(a), y = add(b); if (x !== y) parent.set(x, y); };

  const clips = [];
  const enrol = (entry, keys) => {
    if (!keys.length) return;
    for (const k of keys.slice(1)) union(keys[0], k);
    add(keys[0]);
    clips.push({ ...entry, root: keys[0], dois: keys.filter((k) => k.startsWith("doi:")) });
  };

  for (const s of sources) {
    if (!s.__clip) continue;
    const folder = path.dirname(path.join(vault, s.source_path));
    const { meta } = captureStateOf(folder);
    s.__anchors = Number((meta && meta.clean && meta.clean.anchor_count) || 0);
    enrol({ s, paper: null }, identityKeys({
      doi: s.__doi || (s.notes && s.notes.doi) || (meta && meta.doi),
      url: (meta && (meta.final_url || meta.url)) || "",
      archive: rel(vault, folder),
    }));
  }

  for (const paper of migratedPapers(vault))
    enrol({ s: null, paper }, identityKeys(paper));

  const groups = new Map();
  for (const c of clips) {
    const root = find(c.root);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(c);
  }

  for (const group of groups.values()) {
    const inVault = group.filter((c) => c.s);
    if (group.length < 2 || !inVault.length) continue;
    // Name the group by its lowest DOI when it has one, so the label does not
    // depend on which capture happened to be scanned first.
    const allDois = [...new Set(group.flatMap((c) => c.dois))].sort();
    const label = allDois[0] || find(group[0].root);
    for (const c of inVault) {
      c.s.duplicate_group = label;
      if (allDois.length > 1) c.s.duplicate_doi_conflict = allDois;
    }

    // An already-migrated Paper wins outright. It is not a candidate to be
    // re-judged: a person accepted it and it carries a uid that other objects
    // may already reference. Everything still in WebClips is a leftover copy.
    const already = group.filter((c) => c.paper)
      .sort((a, b) => a.paper.path.localeCompare(b.paper.path))[0];
    if (already) {
      for (const c of inVault) {
        delete c.s.target;
        delete c.s.notes;
        c.s.disposition = "candidate";
        c.s.classification = "duplicate_of_already_migrated_paper";
        c.s.duplicate_of = already.paper.path;
        // §2.1: relations reference uid. The winner has one now, so use it.
        if (already.paper.uid) c.s.duplicate_of_uid = already.paper.uid;
      }
      continue;
    }

    const migratable = inVault.filter((c) => c.s.disposition === "migrate");
    // No verified capture, no winner: several copies of a challenge page do not
    // add up to a Paper.
    if (!migratable.length) continue;

    // A conflicting DOI means at least one of these notes is mislabelled, and a
    // Paper carrying the wrong DOI is worse than a Paper that arrives later.
    if (allDois.length > 1) {
      for (const c of migratable) {
        delete c.s.target; delete c.s.notes;
        c.s.disposition = "candidate";
        c.s.classification = "duplicate_group_disagrees_on_doi_requires_user_review";
      }
      continue;
    }

    const [winner, ...rest] = [...migratable].sort(
      (a, b) => b.s.__anchors - a.s.__anchors || a.s.source_path.localeCompare(b.s.source_path),
    );
    winner.s.notes.duplicate_captures = group.length - 1;
    for (const c of [...rest, ...inVault.filter((x) => x.s.disposition !== "migrate")]) {
      delete c.s.target;
      delete c.s.notes;
      c.s.disposition = "candidate";
      c.s.classification = "duplicate_capture_retained_as_raw_clipping";
      c.s.duplicate_of = winner.s.source_path;
    }
  }
  for (const s of sources) { delete s.__anchors; delete s.__clip; delete s.__doi; }
}

/**
 * Fold the PDF inventory into the ledger.
 *
 * Every PDF becomes a `candidate`. schema-v1 §7.3 freezes four terminal states
 * and none of the five PDF classifications is a decision to migrate or to
 * discard — `pdf_exact_duplicate` in particular is a finding awaiting the
 * de-duplication plan, not permission to delete. The classification says what
 * kind of candidate a file is; the disposition still says the same thing it
 * always said, which is "a person decides".
 *
 * The inventory is passed in rather than recomputed because hashing a gigabyte
 * on every preflight run would make the cheap read-only step expensive.
 */
function loadPdfInventory(file) {
  if (!file) return [];
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  if (report.kind !== "scholarium-pdf-inventory")
    throw new Error("not a pdf inventory report: " + file);
  return report.files || [];
}

function scanPdfInventory(sources, files) {
  for (const f of files) {
    sources.push({
      source_path: f.path,
      source_sha256: f.sha256,
      disposition: "candidate",
      classification: f.classification,
      pdf: {
        bytes: f.bytes,
        doi: f.doi || "",
        has_text_layer: !!f.has_text_layer,
        encrypted: !!f.encrypted,
        linked_from: f.linked_from || [],
        ambiguous_links: f.ambiguous_links || [],
        duplicate_group_size: f.duplicate_group_size || 1,
        proposed_keeper: f.proposed_keeper || "",
        link_critical: !!f.link_critical,
      },
    });
  }
}

function generate(vault, reassessment = new Map(), pdfFiles = []) {
  const sources = [];
  scanWebClips(vault, sources, reassessment);
  scanProjects(vault, sources);
  scanCandidateAreas(vault, sources);
  scanPluginData(vault, sources);
  scanPdfInventory(sources, pdfFiles);
  dedupeByArticle(vault, sources);

  const counts = { scanned: sources.length, migrate: 0, candidate: 0, exclude: 0, retained_settings: 0 };
  for (const s of sources) counts[s.disposition]++;

  return {
    schema_version: 1,
    kind: "scholarium-migration-preflight",
    generated_at: new Date().toISOString(),
    generator: "tools/migration-preflight-generate.js",
    vault_root: vault,
    declared_counts: counts,
    sources,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(USAGE); return; }

  const vault = path.resolve(
    args.vault || path.join(__dirname, "..", "..", "..", ".."),
  );
  if (!fs.existsSync(path.join(vault, "Experiments"))) {
    console.error("Not a Scholarium vault (no Experiments/): " + vault);
    process.exitCode = 2;
    return;
  }

  const manifest = generate(
    vault, loadReassessment(args.reassessment), loadPdfInventory(args.pdfInventory),
  );
  const json = JSON.stringify(manifest, null, 2);

  if (!args.out) { process.stdout.write(json + "\n"); return; }

  const out = path.resolve(args.out);
  const inside = isInside(vault, out);
  if (inside && !args.allowVaultOut) {
    console.error(
      "Refusing to write inside the vault: " + out +
      "\nThis generator is read-only with respect to the vault. Write elsewhere, " +
      "or pass --allow-vault-out if you really mean it.",
    );
    process.exitCode = 3;
    return;
  }
  fs.writeFileSync(out, json + "\n", "utf8");
  console.error(
    "wrote " + out + "  (" + manifest.declared_counts.scanned + " sources: " +
    manifest.declared_counts.migrate + " migrate, " +
    manifest.declared_counts.candidate + " candidate, " +
    manifest.declared_counts.exclude + " exclude, " +
    manifest.declared_counts.retained_settings + " retained_settings)",
  );
}

if (require.main === module) main();
module.exports = {
  generate, parseFrontmatter, splitFrontmatter, hasRelativeAssetLinks, loadReassessment,
  dedupeByArticle, relativeAssetLinks, listAssets, migratedPapers,
  loadPdfInventory, scanPdfInventory,
};
