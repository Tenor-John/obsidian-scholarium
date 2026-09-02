"use strict";
/**
 * Bridge rebuildable PDF sidecars to Schema-v1 Paper identity.
 *
 * A sidecar is an index, never a Paper.  Only when a researcher explicitly
 * creates a pending Evidence proposal do we register a locator-ready PDF as a
 * minimal Paper object.  This keeps retrieval read-only while ensuring every
 * Evidence.source_uid resolves to a real object.
 */
const fs = require("fs");
const path = require("path");
const S = require("./schema-objects");

const SHA256 = /^[a-f0-9]{64}$/i;
const SIDE_DIR = [".scholarium", "pdf-sidecars"];
const normDoi = (value) => String(value || "").trim().replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase();
const sidecarDirectory = (vault) => path.join(vault, ...SIDE_DIR);
const relative = (vault, absolute) => path.relative(vault, absolute).split(path.sep).join("/");
const contained = (vault, relativePath) => {
  const root = path.resolve(vault);
  const target = path.resolve(root, ...String(relativePath || "").split("/"));
  return target !== root && target.startsWith(root + path.sep) ? target : null;
};

function sidecarIssues(vault, sidecar) {
  const issues = [];
  if (!sidecar || sidecar.kind !== "scholarium-pdf-anchor-sidecar") issues.push("not_pdf_sidecar");
  if (sidecar?.evidence_locator_status !== "ready") issues.push("locator_not_ready");
  if (!SHA256.test(String(sidecar?.source_sha256 || ""))) issues.push("missing_source_sha256");
  if (!String(sidecar?.original_url || "").trim()) issues.push("missing_original_url");
  const source = contained(vault, sidecar?.source_path);
  if (!source || !fs.existsSync(source)) issues.push("missing_pdf_source");
  return issues;
}

function loadReadySidecars(vault) {
  const dir = sidecarDirectory(vault);
  const ready = [], skipped = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort(); } catch (_) { return { ready, skipped }; }
  for (const name of names) {
    const absolute = path.join(dir, name);
    try {
      const sidecar = JSON.parse(fs.readFileSync(absolute, "utf8"));
      const issues = sidecarIssues(vault, sidecar);
      if (issues.length) skipped.push({ sidecar_path: relative(vault, absolute), reason: issues.join(",") });
      else ready.push({ sidecar_path: relative(vault, absolute), sidecar });
    } catch (error) {
      skipped.push({ sidecar_path: relative(vault, absolute), reason: "unreadable_sidecar:" + (error.message || String(error)) });
    }
  }
  return { ready, skipped };
}

function loadReadySidecar(vault, sidecarPath) {
  const absolute = contained(vault, sidecarPath);
  const base = sidecarDirectory(vault) + path.sep;
  if (!absolute || !absolute.startsWith(base) || !absolute.endsWith(".json")) throw new Error("invalid_pdf_sidecar_path");
  const sidecar = JSON.parse(fs.readFileSync(absolute, "utf8"));
  const issues = sidecarIssues(vault, sidecar);
  if (issues.length) throw new Error("pdf_sidecar_not_locator_ready:" + issues.join(","));
  return { sidecar_path: relative(vault, absolute), sidecar };
}

function paperDoi(object) {
  return normDoi(object.doi || object.source || "");
}

function findPaperForSidecar(vault, sidecar) {
  const doi = normDoi(sidecar.doi || sidecar.original_url);
  return S.readVaultObjects(vault)
    .filter((entry) => entry.object.type === "paper")
    .find((entry) => String(entry.object.source_pdf_sha256 || "") === sidecar.source_sha256
      || (doi && paperDoi(entry.object) === doi)) || null;
}

function safeTitle(sidecar) {
  const doi = normDoi(sidecar.doi || sidecar.original_url);
  return doi ? "Local PDF · " + doi : "Local PDF source";
}

function paperPath(vault, object) {
  const name = (object.display_id + " " + safeTitle({ doi: object.doi || object.source }))
    .replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 160);
  return path.join(vault, "Research", "Papers", name + ".md");
}

function ensurePaperForSidecar(vault, sidecar) {
  const issues = sidecarIssues(vault, sidecar);
  if (issues.length) throw new Error("PDF sidecar cannot become an Evidence source: " + issues.join(","));
  const existing = findPaperForSidecar(vault, sidecar);
  if (existing) return { entry: existing, created: false };
  const papers = S.readVaultObjects(vault).filter((entry) => entry.object.type === "paper");
  const doi = normDoi(sidecar.doi || sidecar.original_url);
  const object = S.createObject("paper", {
    title: safeTitle(sidecar),
    source: sidecar.original_url,
    ...(doi ? { doi } : {}),
    source_kind: "local_pdf_sidecar",
    source_pdf_path: sidecar.source_path,
    source_pdf_sha256: sidecar.source_sha256,
    source_pdf_sidecar_path: sidecar.sidecar_path || "",
    bibliographic_status: "doi_only",
  }, { existingDisplayIds: papers.map((entry) => entry.object.display_id) });
  const absolute = paperPath(vault, object);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = absolute + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFileSync(temporary, S.serializeObject(object, "# " + object.title + "\n\nLocal PDF source registered for auditable evidence location.\n"), "utf8");
  fs.renameSync(temporary, absolute);
  return { entry: { path: relative(vault, absolute), object }, created: true };
}

module.exports = { SIDE_DIR, normDoi, sidecarDirectory, sidecarIssues, loadReadySidecars, loadReadySidecar, findPaperForSidecar, ensurePaperForSidecar };
