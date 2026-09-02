"use strict";

/**
 * Convenience "do everything" entry point for the RSS pipeline: fans a
 * refresh_feed + score_feed pair out per subscribed feed into the same
 * Scholarium action queue (Research/_runs/queue/) that
 * POST /v1/scholarium/actions and the fine-grained per-feed actions use, then
 * waits for the plugin's own queue consumer (main.js's
 * schPollScholariumQueue) to settle every item.
 *
 * This used to write to a bespoke .obsidian/plugins/obsidian-scholarium/
 * agent-requests/ folder and drive a single combined "refresh_and_score"
 * action (schRunAgentAction). That mechanism is retired: unifying onto one
 * queue means one whitelist, one audit trail (Research/_runs/actions/) and
 * one on/off switch (settings.allowResearchWeaverActions in Scholarium,
 * checked by the consumer — plus scholarium.enabled here, checked before
 * queueing anything at all) instead of two uncoordinated ones.
 *
 * Obsidian itself never listens on a socket, so this must be running with
 * this vault open, the plugin enabled, and BOTH gates on, or nothing will
 * ever pick these items up — this script reports that honestly instead of
 * pretending to have succeeded.
 */

const fs = require("fs");
const path = require("path");
const queue = require("../../../../tools/bridge-action-queue.js");

const POLL_INTERVAL_MS = 3000;
// Comfortably under the Bridge's own SKILL_RUNNERS timeoutMs for this skill
// (see bridge/server.js) so a genuine timeout is reported by *this* script,
// with a clear message, rather than the Bridge hard-killing the process.
const POLL_TIMEOUT_MS = 14 * 60 * 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadBridgeConfig() {
  const configPath = path.join(__dirname, "..", "..", "..", "bridge", "bridge.config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Bridge config not found at ${configPath}. Start the Bridge once to generate it.`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

// scholarium.vaultRoot (not the generic workspaceRoot/allowedRoots this
// Skill also receives as `root`) is authoritative here: workspaceRoot is
// commonly scoped to a project subfolder, but Research/_runs/queue/ and
// data.json both live at the real Obsidian vault root, and that is what the
// plugin's consumer reads from.
function resolveVaultRoot(config, fallbackRoot) {
  if (config.scholarium && config.scholarium.vaultRoot) return path.resolve(config.scholarium.vaultRoot);
  if (fallbackRoot) return path.resolve(fallbackRoot);
  throw new Error("scholarium.vaultRoot is not set in bridge.config.json, and no fallback root was given.");
}

function loadFeeds(vaultRoot) {
  const dataPath = path.join(vaultRoot, ".obsidian", "plugins", "obsidian-scholarium", "data.json");
  if (!fs.existsSync(dataPath)) throw new Error(`Scholarium data.json not found at ${dataPath}`);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  return (data.rssBoard && Array.isArray(data.rssBoard.feeds)) ? data.rssBoard.feeds : [];
}

async function waitForSettlement(vaultRoot, ids) {
  const remaining = new Set(ids);
  const settled = new Map();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (remaining.size && Date.now() < deadline) {
    for (const id of [...remaining]) {
      const item = queue.read(vaultRoot, id);
      if (item && item.status !== "pending") {
        settled.set(id, item);
        remaining.delete(id);
      }
    }
    if (!remaining.size) break;
    await sleep(POLL_INTERVAL_MS);
  }
  for (const id of remaining) {
    settled.set(id, { id, status: "timeout", error: "timed out waiting for the Scholarium queue consumer to pick this up" });
  }
  return settled;
}

async function requestAndWait(fallbackRoot) {
  const config = loadBridgeConfig();
  if (!config.scholarium || !config.scholarium.enabled) {
    throw new Error(
      "scholarium.enabled is false in bridge.config.json. Set it to true, and turn on " +
      "“允许织研者执行 Scholarium 动作” in Scholarium's own settings, before running this skill.",
    );
  }
  const vaultRoot = resolveVaultRoot(config, fallbackRoot);
  const feeds = loadFeeds(vaultRoot);
  if (!feeds.length) return { status: "ok", feeds: 0, perFeed: [], newlyScored: 0, newArticles: 0 };

  const submissions = feeds.map((feed) => ({
    feed,
    refresh: queue.submit(vaultRoot, "rss.refresh_feed", { feed_id: feed.id }, { by: "skill:rss-refresh-and-score" }),
    score: queue.submit(vaultRoot, "rss.score_feed", { feed_id: feed.id }, { by: "skill:rss-refresh-and-score" }),
  }));
  const allIds = submissions.flatMap((s) => [s.refresh.id, s.score.id]);
  const settled = await waitForSettlement(vaultRoot, allIds);

  let newlyScored = 0, newArticles = 0, anyFailed = false;
  const perFeed = submissions.map(({ feed, refresh, score }) => {
    const refreshOutcome = settled.get(refresh.id);
    const scoreOutcome = settled.get(score.id);
    if (refreshOutcome.status !== "completed" || scoreOutcome.status !== "completed") anyFailed = true;
    newArticles += Number(refreshOutcome.result?.new_articles || 0);
    newlyScored += Number(scoreOutcome.result?.scored || 0);
    return {
      feedId: feed.id,
      title: feed.title || feed.url,
      refresh: { status: refreshOutcome.status, ...refreshOutcome.result, error: refreshOutcome.error },
      score: { status: scoreOutcome.status, ...scoreOutcome.result, error: scoreOutcome.error },
    };
  });

  return {
    status: anyFailed ? "partial" : "ok",
    feeds: feeds.length,
    newlyScored,
    newArticles,
    perFeed,
  };
}

function main() {
  const fallbackRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
  requestAndWait(fallbackRoot)
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      process.exitCode = result.status === "ok" ? 0 : 1;
    })
    .catch((err) => {
      process.stderr.write(String((err && err.message) || err) + "\n");
      process.exitCode = 1;
    });
}
if (require.main === module) main();

module.exports = { loadBridgeConfig, resolveVaultRoot, loadFeeds, waitForSettlement, requestAndWait };
