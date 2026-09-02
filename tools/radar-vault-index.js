"use strict";
// A credentials-free, Markdown-backed projection of rssBoard article scores.
// data.json stays in place; this only mirrors article metadata, scores and
// human feedback so the research layer can rebuild an index without secrets.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const DIR = "Research/RadarScores";
const hash = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const slug = (s) => String(s || "article").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90) || "article";
function selected(article) {
  const scores = Array.isArray(article.radarScores) ? article.radarScores : [];
  // Feedback is attached to the score for its particular Project/Profile
  // version by the live Radar UI. Keep it nested with that score instead of
  // pretending one article has a single global label.
  const feedback = scores.filter((score) => score && score.feedback !== undefined).map((score) => ({
    project_id: String(score.projectId || ""), project_version: String(score.projectVersion || ""),
    value: score.feedback, at: score.feedbackAt || "",
  }));
  return {
    kind: "scholarium_radar_score_index", schema_version: 1,
    article_id: String(article.id || ""), title: String(article.title || ""), link: String(article.link || ""),
    author: String(article.author || ""), summary: String(article.summary || ""), published: article.published || "",
    fetched_at: article.fetchedAt || "", radar_scores: scores, human_feedback: feedback,
  };
}
function candidates(data) {
  const articles = Array.isArray(data && data.rssBoard && data.rssBoard.articles) ? data.rssBoard.articles : [];
  return articles.filter((a) => (a.radarScores || []).length || a.feedback !== undefined).map(selected);
}
function markdown(record) {
  return `# ${record.title || record.article_id}\n\n<!-- scholarium-radar-index; generated without credentials -->\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\`\n`;
}
function parse(text) {
  const hit = /<!-- scholarium-radar-index; generated without credentials -->\s*\n```json\n([\s\S]*?)\n```/.exec(String(text));
  if (!hit) return null;
  const value = JSON.parse(hit[1]);
  if (value.kind !== "scholarium_radar_score_index" || !value.article_id) throw new Error("invalid_radar_index_record");
  return value;
}
function plan(vault, data) {
  const records = candidates(data);
  const seen = new Set();
  const writes = records.map((record) => {
    const key = hash(record.article_id).slice(0, 16);
    if (seen.has(key)) throw new Error("duplicate_article_id:" + record.article_id);
    seen.add(key);
    return { record, relative_path: `${DIR}/${key} ${slug(record.title)}.md`, content_sha256: hash(markdown(record)) };
  });
  // A feed refresh is allowed to prune old RSS rows. The Markdown index is a
  // research record, so never silently delete a previously mirrored score just
  // because that article is no longer in today's in-memory feed.
  const existing = rebuild(vault);
  const incomingIds = new Set(records.map((record) => record.article_id));
  const retainedHistorical = existing.articles.filter((record) => !incomingIds.has(record.article_id));
  return {
    kind: "radar_vault_sync_plan",
    scanned_articles: Array.isArray(data?.rssBoard?.articles) ? data.rssBoard.articles.length : 0,
    selected: records.length,
    existing_index_records: existing.articles.length,
    retained_historical_records: retainedHistorical.length,
    retained_historical_article_ids: retainedHistorical.map((record) => record.article_id),
    existing_index_valid: existing.valid,
    existing_index_problems: existing.problems,
    writes,
  };
}
function sync(vault, data, options = {}) {
  const p = plan(vault, data);
  if (options.dryRun !== false) return p;
  for (const write of p.writes) {
    const file = path.join(vault, ...write.relative_path.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, markdown(write.record), "utf8"); fs.renameSync(tmp, file);
  }
  return { ...p, written: p.writes.length };
}
function rebuild(vault) {
  const root = path.join(vault, ...DIR.split("/"));
  if (!fs.existsSync(root)) return { articles: [], valid: true, problems: [] };
  const articles = [], problems = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".md")) continue;
    try { articles.push(parse(fs.readFileSync(path.join(root, name), "utf8"))); }
    catch (error) { problems.push({ file: name, error: error.message }); }
  }
  const ids = new Set();
  for (const a of articles) { if (ids.has(a.article_id)) problems.push({ article_id: a.article_id, error: "duplicate" }); ids.add(a.article_id); }
  return { articles, valid: !problems.length, problems };
}
function benchmark(vault) {
  const data = rebuild(vault);
  const rows = data.articles.flatMap((article) => Array.isArray(article.human_feedback) ? article.human_feedback : []);
  const counts = rows.reduce((out, row) => ((out[row.value] = (out[row.value] || 0) + 1), out), {});
  return { ...data, feedback_count: rows.length, feedback_counts: counts, ready_for_calibration: rows.length >= 50 };
}
module.exports = { DIR, selected, candidates, markdown, parse, plan, sync, rebuild, benchmark };
