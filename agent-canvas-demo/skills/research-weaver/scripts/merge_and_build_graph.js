"use strict";

/**
 * Research Weaver Phase 4–5.
 *
 * This is deliberately an *index builder*, not a second research database.
 * It reads temporary search bundles, resolves any DOI already represented by
 * a schema-v1 Paper, and creates only disposable views (a Canvas and a
 * Markdown report).  It never mints Paper, Question, Evidence, or Project
 * objects.  The default command is dry-run; writing requires `--apply`.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
// Phase 4 composes the PDF-sidecar graph through its public module interface.
// Both builders remain dry-run until this script is explicitly invoked with
// --apply; neither one creates a formal schema object.
const paperKnowledgeGraph = require(path.resolve(__dirname, "..", "..", "paper-knowledge-graph", "scripts", "build_paper_graph.js"));

const AXES = ["material", "synthesis", "mechanism", "characterization",
  "theory", "performance", "analogy", "application"];
const LEVELS = new Set(["L0", "L1", "L2", "L3", "L4", "L5"]);
const COLORS = { material: "1", synthesis: "1", mechanism: "2", characterization: "3",
  theory: "4", performance: "2", analogy: "4", application: "6" };

function posix(p) { return p.split(path.sep).join("/"); }
function sha(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }
function compact(text, n = 180) { return String(text || "").replace(/\s+/g, " ").trim().slice(0, n); }
function normalizeDoi(value) {
  const doi = String(value || "").trim().toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  return /^10\.\d{4,9}\/.+\S$/.test(doi) ? doi : "";
}
function safeId(value) { return sha(value).slice(0, 16); }
function nowStamp(now = new Date()) { return now.toISOString().replace(/[:.]/g, "-"); }

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readBundles(vault) {
  const dir = path.join(vault, "Research", "weave-bundles");
  if (!fs.existsSync(dir)) return { dir, entries: [] };
  const entries = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try { entries.push({ file, relative: posix(path.relative(vault, file)), bundle: readJson(file) }); }
    catch (error) { entries.push({ file, relative: posix(path.relative(vault, file)), error: "invalid_json: " + error.message }); }
  }
  return { dir, entries };
}

function validateBundle(entry) {
  if (entry.error) return { status: "rejected", reason: entry.error };
  const b = entry.bundle;
  if (!b || typeof b !== "object" || Array.isArray(b)) return { status: "rejected", reason: "bundle_not_an_object" };
  if (!String(b.node_id || "").trim()) return { status: "rejected", reason: "missing_node_id" };
  if (!AXES.includes(String(b.axis || "").toLowerCase())) return { status: "rejected", reason: "unknown_axis" };
  if (!String(b.title || "").trim()) return { status: "rejected", reason: "missing_title" };
  if (!LEVELS.has(String(b.evidence_level || ""))) return { status: "rejected", reason: "invalid_evidence_level" };
  if (!Array.isArray(b.papers)) return { status: "rejected", reason: "papers_must_be_an_array" };
  return { status: "accepted" };
}

function loadExistingPapers(vault) {
  const schemaPath = path.resolve(__dirname, "..", "..", "..", "..", "tools", "schema-objects.js");
  if (!fs.existsSync(schemaPath)) return new Map();
  const { readVaultObjects } = require(schemaPath);
  const byDoi = new Map();
  for (const record of readVaultObjects(vault)) {
    if (record.object.type !== "paper") continue;
    const doi = normalizeDoi(record.object.doi || record.object.source || "");
    if (doi) byDoi.set(doi, { uid: record.object.uid, display_id: record.object.display_id, path: record.path });
  }
  return byDoi;
}

function buildPlan(vault) {
  const loaded = readBundles(vault);
  const existingPapers = loadExistingPapers(vault);
  const paperGraphPlan = paperKnowledgeGraph.buildPlan(vault, { limit: 10 });
  const terminal = loaded.entries.map((entry) => ({ path: entry.relative, ...validateBundle(entry) }));
  const accepted = loaded.entries.filter((_, i) => terminal[i].status === "accepted");
  const records = new Map();
  const subtopics = [];

  for (const entry of accepted) {
    const b = entry.bundle;
    const axis = String(b.axis).toLowerCase();
    const sourceKey = `${axis}:${b.node_id}`;
    const subtopic = {
      source_path: entry.relative, node_id: String(b.node_id), axis, title: compact(b.title, 200),
      summary: compact(b.summary, 500), evidence_level: b.evidence_level,
      question_uid: String(b.question_uid || ""),
      // This is intentionally only a proposal until the user makes a schema-v1 Question.
      candidate_question: compact(b.research_question || b.question || b.title, 400),
      paper_keys: [],
    };
    for (let index = 0; index < b.papers.length; index++) {
      const paper = b.papers[index] || {};
      const doi = normalizeDoi(paper.doi);
      const fallback = "metadata:" + sha([paper.title, paper.year, paper.venue, sourceKey, index].join("|"));
      const key = doi || fallback;
      if (!records.has(key)) records.set(key, {
        key, doi, title: compact(paper.title || "Untitled metadata record", 220),
        year: paper.year || "", venue: compact(paper.venue || "", 100),
        cited_by_count: Number(paper.cited_by_count || 0) || 0,
        axes: [], subtopics: [], existing_paper: doi ? existingPapers.get(doi) || null : null,
        metadata_only: !(doi && existingPapers.has(doi)),
      });
      const record = records.get(key);
      if (!record.axes.includes(axis)) record.axes.push(axis);
      if (!record.subtopics.includes(subtopic.node_id)) record.subtopics.push(subtopic.node_id);
      subtopic.paper_keys.push(key);
    }
    subtopics.push(subtopic);
  }
  const acceptedCount = terminal.filter((x) => x.status === "accepted").length;
  const rejectedCount = terminal.filter((x) => x.status === "rejected").length;
  const plan = {
    artifact: "research_weaver_merge_plan", version: 1, generated_at: new Date().toISOString(), vault,
    write_mode: "dry_run", input: { bundle_directory: posix(path.relative(vault, loaded.dir)), scanned: terminal.length,
      accepted: acceptedCount, rejected: rejectedCount, terminal },
    invariants: {
      every_input_has_terminal_state: terminal.length === loaded.entries.length,
      accepted_plus_rejected_equals_scanned: acceptedCount + rejectedCount === terminal.length,
      creates_no_schema_objects: true,
      overwrites_no_existing_files: true,
      paper_knowledge_graph_dry_run_valid: paperGraphPlan.valid,
    },
    paper_knowledge_graph: {
      invoked: true,
      write_mode: "dry_run",
      plan: paperGraphPlan,
      summary: {
        sidecars_scanned: paperGraphPlan.source.scanned,
        pdf_sources_accepted: paperGraphPlan.source.accepted,
        entities: paperGraphPlan.graph.entities.length,
        located_mentions: paperGraphPlan.graph.edges.length,
      },
    },
    subtopics,
    records: [...records.values()],
    summary: {
      candidate_questions: subtopics.filter((s) => !s.question_uid).length,
      resolved_existing_papers: [...records.values()].filter((r) => r.existing_paper).length,
      external_metadata_candidates: [...records.values()].filter((r) => r.metadata_only).length,
      cross_axis_records: [...records.values()].filter((r) => r.axes.length > 1).length,
    },
  };
  plan.valid = Object.values(plan.invariants).every(Boolean);
  return plan;
}

function canvasFromPlan(plan) {
  const nodes = [], edges = [], axes = [...new Set(plan.subtopics.map((s) => s.axis))];
  const seed = "Research Weaver — reviewed search map";
  nodes.push({ id: "weaver-root", type: "text", x: 600, y: 0, width: 520, height: 140,
    text: `# ${seed}\n${plan.subtopics.length} candidate questions · ${plan.records.length} metadata records\nCanvas is a rebuildable view, not a source of truth.`, color: "5" });
  const positions = new Map();
  axes.forEach((axis, i) => {
    const y = 220 + i * 300; positions.set(axis, { x: 20, y });
    nodes.push({ id: "axis-" + axis, type: "text", x: 20, y, width: 240, height: 100,
      text: `## ${axis}\n${plan.subtopics.filter((s) => s.axis === axis).length} candidate questions`, color: COLORS[axis] || "4" });
    edges.push({ id: "root-" + axis, fromNode: "weaver-root", toNode: "axis-" + axis });
  });
  const seen = new Set();
  plan.subtopics.forEach((s, index) => {
    const p = positions.get(s.axis) || { x: 300, y: 220 + index * 220 };
    const id = "subtopic-" + safeId(s.axis + ":" + s.node_id);
    const question = s.question_uid ? `Question: ${s.question_uid}` : `Candidate question — adopt before treating as Question`;
    nodes.push({ id, type: "text", x: p.x + 290, y: p.y + index % 3 * 170, width: 420, height: 140,
      text: `## ${s.title}\n${question}\nEvidence density: ${s.evidence_level}\n${s.summary || "No summary supplied."}`, color: COLORS[s.axis] || "4" });
    edges.push({ id: "axis-to-" + id, fromNode: "axis-" + s.axis, toNode: id, label: s.evidence_level });
    for (const key of s.paper_keys.slice(0, 5)) {
      const record = plan.records.find((r) => r.key === key); if (!record) continue;
      const rid = "record-" + safeId(key);
      if (!seen.has(rid)) {
        seen.add(rid);
        const label = record.existing_paper
          ? `[[${record.existing_paper.path.replace(/\.md$/, "")}]]\n${record.title}`
          : `Metadata candidate — not a Paper\n${record.title}\n${record.doi || "No DOI"}`;
        const node = record.existing_paper
          ? { id: rid, type: "file", x: p.x + 760, y: p.y + (seen.size % 6) * 115,
            width: 380, height: 92, file: record.existing_paper.path }
          : { id: rid, type: "text", x: p.x + 760, y: p.y + (seen.size % 6) * 115,
            width: 380, height: 92, text: label };
        nodes.push(node);
      }
      edges.push({ id: id + "-" + rid, fromNode: id, toNode: rid, label: record.existing_paper ? "existing Paper" : "search metadata" });
    }
  });
  for (const record of plan.records.filter((r) => r.axes.length > 1)) {
    for (let i = 1; i < record.axes.length; i++) edges.push({ id: "cross-" + safeId(record.key + i),
      fromNode: "axis-" + record.axes[i - 1], toNode: "axis-" + record.axes[i], label: `shared metadata: ${record.title.slice(0, 60)}` });
  }
  return { nodes, edges };
}

function markdownFromPlan(plan) {
  const out = ["# Research Weaver search map", "", "> This is a rebuildable search view. Search metadata is not a Paper, and candidate questions are not formal Questions until adopted.", "",
    "## Audit", "", `- Input bundles: ${plan.input.scanned}; accepted: ${plan.input.accepted}; rejected: ${plan.input.rejected}`, `- Existing Papers resolved by DOI: ${plan.summary.resolved_existing_papers}`, `- External metadata candidates: ${plan.summary.external_metadata_candidates}`, `- Candidate Questions awaiting adoption: ${plan.summary.candidate_questions}`, `- Paper Knowledge Graph: ${plan.paper_knowledge_graph.summary.pdf_sources_accepted}/${plan.paper_knowledge_graph.summary.sidecars_scanned} PDF sources, ${plan.paper_knowledge_graph.summary.located_mentions} located mentions`, "", "## Candidate questions", ""];
  for (const s of plan.subtopics) {
    out.push(`### ${s.title}`, "", `- Axis: ${s.axis}`, `- Evidence density: ${s.evidence_level}`, `- ${s.question_uid ? "Formal Question UID: " + s.question_uid : "Status: candidate; create/adopt a Question object only after review."}`);
    if (s.candidate_question) out.push(`- Proposed question: ${s.candidate_question}`);
    if (s.summary) out.push(`- Search summary: ${s.summary}`);
    out.push("");
  }
  out.push("## Cross-axis records", "");
  for (const r of plan.records.filter((r) => r.axes.length > 1)) out.push(`- ${r.title} — ${r.axes.join(" / ")} ${r.doi ? "(DOI: " + r.doi + ")" : "(metadata without DOI)"}`);
  if (!plan.records.some((r) => r.axes.length > 1)) out.push("_None in this run._");
  out.push("", "## Suggested next step", "", "Review one or two candidate questions, create formal Question objects only for those you adopt, then read/clip candidate papers before making Evidence.");
  return out.join("\n") + "\n";
}

function applyPlan(plan, options = {}) {
  if (!plan.valid) throw new Error("refusing to write an invalid merge plan");
  const stamp = options.stamp || nowStamp();
  const canvasRelative = `Canvases/research-weaver-${stamp}.canvas`;
  const summaryRelative = `Research/WeaveRuns/research-weaver-${stamp}.md`;
  const canvasPath = path.join(plan.vault, ...canvasRelative.split("/"));
  const summaryPath = path.join(plan.vault, ...summaryRelative.split("/"));
  for (const file of [canvasPath, summaryPath]) if (fs.existsSync(file)) throw new Error("refusing to overwrite existing artifact: " + file);
  fs.mkdirSync(path.dirname(canvasPath), { recursive: true });
  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(canvasPath, JSON.stringify(canvasFromPlan(plan), null, 2) + "\n", "utf8");
  fs.writeFileSync(summaryPath, markdownFromPlan(plan), "utf8");
  const output = { canvas: canvasRelative, summary: summaryRelative, created_paths: [canvasRelative, summaryRelative] };
  if (plan.paper_knowledge_graph.summary.pdf_sources_accepted > 0) {
    output.paper_knowledge_graph = paperKnowledgeGraph.applyPlan(plan.paper_knowledge_graph.plan);
    output.created_paths.push(output.paper_knowledge_graph.canvas, output.paper_knowledge_graph.visualization, output.paper_knowledge_graph.report);
  }
  return output;
}

function readExecutionRequest(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return { mode: "dry_run" };
  const raw = fs.existsSync(candidate) ? fs.readFileSync(candidate, "utf8").trim() : candidate;
  if (!raw) return { mode: "dry_run" };
  try {
    const request = JSON.parse(raw);
    // A natural-language prompt must never turn a read-only plan into a write.
    // Only this exact, structured request is allowed to create rebuildable views.
    return request && request.mode === "apply" ? { mode: "apply" } : { mode: "dry_run" };
  } catch {
    return { mode: "dry_run" };
  }
}

function parseArgs(argv) {
  const args = argv.slice(2); let vault = "", apply = false, out = ""; const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--out") out = args[++i] || "";
    else if (!args[i].startsWith("-")) positional.push(args[i]);
  }
  vault = positional[0] || process.cwd();
  const request = readExecutionRequest(positional[1]);
  return { vault: path.resolve(vault), apply: apply || request.mode === "apply", out, request };
}
function main() {
  const args = parseArgs(process.argv); const plan = buildPlan(args.vault);
  let result = { ...plan, write_mode: args.apply ? "apply" : "dry_run" };
  if (args.apply) result = { ...result, output: applyPlan(plan) };
  if (args.out) {
    const out = path.resolve(args.out);
    if (fs.existsSync(out)) throw new Error("refusing to overwrite --out file: " + out);
    fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = plan.valid ? 0 : 1;
}
if (require.main === module) main();

module.exports = { AXES, LEVELS, normalizeDoi, validateBundle, buildPlan, canvasFromPlan, markdownFromPlan, applyPlan, parseArgs, readExecutionRequest };
