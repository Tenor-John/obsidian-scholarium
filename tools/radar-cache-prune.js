"use strict";
// Prunes only disposable RSS cache rows. Score history remains in
// Research/RadarScores, which is the durable, credentials-free audit trail.
const crypto = require("crypto");
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");

function scores(article) { return Array.isArray(article && article.radarScores) ? article.radarScores : []; }
function hasFeedback(article) {
  return article && article.feedback !== undefined || scores(article).some((score) => score && score.feedback !== undefined);
}
function isZeroScore(article) {
  const rows = scores(article);
  return rows.length > 0 && rows.every((score) => Number.isFinite(Number(score && score.priority)) && Number(score.priority) === 0);
}
function protectedReason(article) {
  if (!scores(article).length) return "unscored";
  if (!isZeroScore(article)) return "nonzero_or_incomplete_score";
  if (hasFeedback(article)) return "human_feedback";
  if (article.starred || article.favorite || article.favorited) return "favorite";
  if (article.read || article.isRead) return "read";
  return "";
}
function plan(data) {
  const articles = Array.isArray(data && data.rssBoard && data.rssBoard.articles) ? data.rssBoard.articles : [];
  const removable = [], kept = {};
  for (const article of articles) {
    const reason = protectedReason(article);
    if (!reason) removable.push(String(article.id || ""));
    else kept[reason] = (kept[reason] || 0) + 1;
  }
  return {
    kind: "radar_zero_score_prune_plan",
    source_fingerprint: hash(articles),
    scanned_articles: articles.length,
    removable_article_ids: removable,
    removable_count: removable.length,
    retained_by_reason: kept,
  };
}
function execute(data, approvedPlan) {
  const fresh = plan(data);
  if (!approvedPlan || approvedPlan.source_fingerprint !== fresh.source_fingerprint) throw new Error("radar_cache_changed_replan_required");
  const remove = new Set(fresh.removable_article_ids);
  data.rssBoard.articles = data.rssBoard.articles.filter((article) => !remove.has(String(article.id || "")));
  return { ...fresh, removed: remove.size, remaining_articles: data.rssBoard.articles.length };
}
module.exports = { scores, hasFeedback, isZeroScore, protectedReason, plan, execute };
