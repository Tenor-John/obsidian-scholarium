"use strict";
/**
 * Offline re-assessment of archived sources.
 *
 * READ ONLY, and deliberately so. Historical `source.meta.json` files are the
 * record of what happened at capture time; this tool does not touch them. Its
 * verdict lands in a separate report as `reassessed_capture_state`, alongside
 * the untouched `capture_state`, so the two can never be confused.
 *
 *   node tools/source-reassess.js --vault <path> --out reassessment.json
 *   node tools/migration-preflight-generate.js --reassessment reassessment.json ...
 *
 * WHY THIS EXISTS
 * ---------------
 * schema-v1 §7.3 forbids inferring `verified` from file presence or hash
 * agreement, and rightly: those say the bytes are intact, not that the bytes
 * are the paper. But we do hold the bytes, and reading them is a different
 * kind of evidence from merely observing that they exist. So we read them.
 *
 * WHAT A PASS DOES AND DOES NOT MEAN
 * ----------------------------------
 * Passing means "nothing in the archive contradicts this being the article".
 * It does not mean "this is the authoritative version of record" — no offline
 * check can establish that. A pass therefore promotes a source to *eligible
 * for review*, never straight to `migrate`.
 *
 * SINGLE SOURCE OF TRUTH
 * ----------------------
 * The primary verdict comes from the plugin's own `sourceCaptureAssessment`,
 * extracted from the shipping bundle rather than reimplemented here. A second
 * copy of the detector would drift from the one that actually runs, and then
 * the audit would be measuring the wrong thing.
 */
const fs = require("fs");
const path = require("path");
const { sandbox } = require("../tests/harness.js");

/* ------------------------------------------------------------------ */
/* the shipping detector                                               */
/* ------------------------------------------------------------------ */
const shipping = sandbox({
  methods: { sourceCaptureAssessment: ["t", "e"] },
}).sourceCaptureAssessment;

/* ------------------------------------------------------------------ */
/* offline-only corroboration                                          */
/* ------------------------------------------------------------------ */
/**
 * The shipping detector matches English challenge prose ("Just a moment",
 * "Checking your browser"). Publishers serve those pages in the reader's
 * language: the archives here contain Cloudflare interstitials written in
 * Chinese, which that regex cannot see. These markers are structural instead
 * of linguistic — script paths and cookie names are the same in every locale.
 *
 * They are NOT sufficient on their own, and an earlier draft of this file was
 * wrong to treat them as such. Cloudflare injects
 * `/cdn-cgi/challenge-platform/scripts/jsd/main.js` into pages it serves
 * *successfully*, so the marker appears on perfectly good article captures.
 * It disqualified a genuine 200-status, 170-anchor ACS article here, while its
 * duplicate capture of the same article passed — which is how the mistake
 * surfaced. The markers are therefore corroborating evidence only: they
 * sharpen the label on a source that has already failed some other check, and
 * never fail one by themselves.
 */
const STRUCTURAL_CHALLENGE = [
  "challenge-platform",
  "cf_chl_opt",
  "__cf_chl",
  "cf-browser-verification",
  "cf_captcha",
  "_cf_chl_opt",
];

/** Kept only as a secondary signal; see STRUCTURAL_CHALLENGE for the reason. */
const LOCALIZED_CHALLENGE = [
  "正在进行安全验证",
  "安全验证",
  "人机验证",
  "验证您是真人",
  "セキュリティチェック",
  "Verificando",
  "Überprüfung",
];

const MIN_ANCHORS = 20; // matches canSkipVerifiedSource in the bundle

function readMeta(folder) {
  const p = path.join(folder, "source.meta.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { __unparseable: e.message };
  }
}

function assessFolder(folder) {
  const name = path.basename(folder);
  const meta = readMeta(folder);
  const rawPath = path.join(folder, "source.raw.html");
  const cleanPath = path.join(folder, "source.clean.html");

  const out = {
    folder: name,
    capture_state: meta && meta.capture_state ? meta.capture_state : "unknown",
    reassessed_capture_state: null,
    eligible: false,
    reasons: [],
    evidence: {},
  };

  if (!meta) {
    out.reassessed_capture_state = "unassessable";
    out.reasons.push("no_source_meta_json");
    return out;
  }
  if (meta.__unparseable) {
    out.reassessed_capture_state = "unassessable";
    out.reasons.push("unparseable_source_meta_json");
    return out;
  }
  if (!fs.existsSync(rawPath) || !fs.existsSync(cleanPath)) {
    out.reassessed_capture_state = "unassessable";
    out.reasons.push("missing_raw_or_clean_html");
    return out;
  }

  const raw = fs.readFileSync(rawPath, "utf8");
  const anchors = Array.isArray(meta.anchors) ? meta.anchors : [];
  const anchorCount = Number((meta.clean && meta.clean.anchor_count) || anchors.length || 0);
  const status = Number(meta.http_status || 0);

  // 1. the shipping detector, run on exactly what it would have seen
  const ship = shipping(raw, { anchors });
  out.evidence.shipping_verdict = ship.captureState;
  out.evidence.shipping_reason = ship.reason || "";

  // 2. transport status. A 4xx/5xx body is a publisher error or interstitial,
  //    never the article, no matter how it reads.
  out.evidence.http_status = status || null;
  const statusOk = status >= 200 && status < 300;

  // 3. structural challenge markers, language-independent
  const haystack =
    raw + "\n" + anchors.map((a) => String((a && a.head) || "")).join("\n");
  const structural = STRUCTURAL_CHALLENGE.filter((m) => haystack.includes(m));
  const localized = LOCALIZED_CHALLENGE.filter((m) => haystack.includes(m));
  out.evidence.structural_challenge_markers = structural;
  out.evidence.localized_challenge_markers = localized;

  // 4. body sufficiency
  out.evidence.anchor_count = anchorCount;

  // Disqualifying checks. Each one, alone, is enough to keep a source out.
  if (!statusOk) out.reasons.push("http_status_" + (status || "absent"));
  if (anchorCount < MIN_ANCHORS) out.reasons.push("too_few_anchors");
  if (ship.captureState !== "verified")
    out.reasons.push("shipping_detector_" + ship.captureState);

  // Corroborating only — see STRUCTURAL_CHALLENGE. A marker on an otherwise
  // healthy capture means Cloudflare instrumentation, not a blocked page.
  if (structural.length && !out.reasons.length)
    out.notes = ["cloudflare_instrumentation_present_on_healthy_capture"];

  out.eligible = out.reasons.length === 0;
  out.reassessed_capture_state = out.eligible
    ? "offline_eligible"
    : ship.captureState === "challenge" || ((structural.length || localized.length) && out.reasons.length)
      ? "challenge"
      : "suspect";

  return out;
}

function reassess(vault) {
  const root = path.join(vault, "Experiments", "WebClips");
  const results = [];
  if (fs.existsSync(root)) {
    for (const d of fs.readdirSync(root, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith(".")) continue;
      results.push(assessFolder(path.join(root, d.name)));
    }
  }

  const counts = { scanned: results.length, eligible: 0, suspect: 0, challenge: 0, unassessable: 0 };
  for (const r of results) {
    if (r.eligible) counts.eligible++;
    else if (r.reassessed_capture_state === "challenge") counts.challenge++;
    else if (r.reassessed_capture_state === "unassessable") counts.unassessable++;
    else counts.suspect++;
  }

  return {
    schema_version: 1,
    kind: "scholarium-source-reassessment",
    generated_at: new Date().toISOString(),
    generator: "tools/source-reassess.js",
    note:
      "Offline re-read of archived bytes. Historical capture_state is preserved " +
      "verbatim; reassessed_capture_state is advisory and never promotes a " +
      "source past `candidate` on its own.",
    min_anchors: MIN_ANCHORS,
    counts,
    results,
  };
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */
function isInside(root, target) {
  const a = path.resolve(root);
  const b = path.resolve(target);
  if (path.parse(a).root.toLowerCase() !== path.parse(b).root.toLowerCase()) return false;
  const r = path.relative(a, b);
  if (r === "") return true;
  if (path.isAbsolute(r)) return false;
  return !r.split(path.sep).includes("..");
}

function main() {
  const argv = process.argv;
  let vault = null;
  let out = null;
  let allowVaultOut = false;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--vault") vault = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
    else if (argv[i] === "--allow-vault-out") allowVaultOut = true;
    else if (!vault) vault = argv[i];
  }
  vault = path.resolve(vault || path.join(__dirname, "..", "..", "..", ".."));
  if (!fs.existsSync(path.join(vault, "Experiments"))) {
    console.error("Not a Scholarium vault (no Experiments/): " + vault);
    process.exitCode = 2;
    return;
  }

  const report = reassess(vault);
  const json = JSON.stringify(report, null, 2);
  if (!out) {
    process.stdout.write(json + "\n");
    return;
  }
  const target = path.resolve(out);
  if (isInside(vault, target) && !allowVaultOut) {
    console.error("Refusing to write inside the vault: " + target);
    process.exitCode = 3;
    return;
  }
  fs.writeFileSync(target, json + "\n", "utf8");
  console.error(
    "wrote " + target + "  " + JSON.stringify(report.counts),
  );
}

if (require.main === module) main();
module.exports = { reassess, assessFolder, STRUCTURAL_CHALLENGE, MIN_ANCHORS };
