// @ts-nocheck -- Legacy JavaScript port pending incremental type migration.
/* global schRuntimeBootstrap, schNativeWeaverHost -- Bundled runtime status and Weaver host used by the queue consumer. */
/* Unified, opt-in queue consumer.  Every action is checked against both this
 * allowlist and the runtime registry, executes non-dry-run with an explicit
 * actor, and is settled exactly once. */
import { RssFeedBoard as Ys } from "./rss-feed-board";
import { schEvidenceTools } from "./research-evidence-tools";
import { schMaterialRunSkill } from "./material-plotting";
import {
  schRuntimeRoot,
  schEnsureRuntimeInstalled,
  schStopLocalRuntime,
  schRuntimeScope,
} from "./runtime-manager";

const SCH_SCHOLARIUM_QUEUE_ACTIONS = [
  "literature.matrix_process",
  "literature.matrix_write_summary",
  "rss.refresh_feed",
  "rss.score_feed",
  "rss.clip_high_score",
  "rss.clip_url",
  "rss.fetch_pdf",
  "rss.set_article_score",
  "rss.mark_article",
  "sch-data-plot",
  "sch-data-profile-audit",
  "workspace.timeblock_add",
  "workspace.timeblock_update",
  "workspace.timeblock_remove",
  "workspace.checkin_upsert",
  "workspace.habit_add",
  "workspace.habit_log",
  "workspace.emotion_log",
  "workspace.task_add",
  "workspace.task_update",
  "workspace.task_remove",
  "workspace.focus_log",
  "workspace.capture_add",
  "material.add",
  "material.update",
  "material.remove",
  "material.category_add",
  "material.category_remove",
  "experiment.append_note",
  "experiment.insert_chem",
];
async function schPollScholariumQueue() {
  if (this._schScholariumBusy) return;
  if (!this.settings || !this.settings.allowResearchWeaverActions) return;
  let tools;
  try {
    tools = schEvidenceTools(this);
  } catch (e) {
    return; // no desktop vault path available; nothing safe to do
  }
  let pending;
  try {
    pending = tools.queue.listPending(tools.vault);
  } catch (e) {
    return;
  }
  if (!pending.length) return;
  this._schScholariumBusy = true;
  try {
    let board = new Ys(this.app, this);
    await board.load();
    const matrixLiveBoard = window.__scholariumRssBoard?.plugin === this && pending.some((item) => item.action.startsWith("literature.matrix_")) ? window.__scholariumRssBoard : null;
    if (matrixLiveBoard) board.data = matrixLiveBoard.data;
    for (let item of pending) {
      let outcome;
      if (!SCH_SCHOLARIUM_QUEUE_ACTIONS.includes(item.action)) {
        outcome = {
          status: "failed",
          error: "action is not permitted from the Scholarium queue consumer: " + item.action,
        };
      } else {
        try {
          let manifest = await tools.actions.runAsync(
            tools.vault,
            item.action,
            item.input || {},
            {
              dryRun: false,
              confirmed: true,
              by: "agent:research-weaver",
              allowedLevels: ["L0", "L1"],
              live: {
                board: item.action.startsWith("literature.matrix_") && window.__scholariumRssBoard?.plugin === this ? window.__scholariumRssBoard : board,
                plugin: this,
                settings: this.settings,
                runSkill: (name, input) => schMaterialRunSkill(this, name, input),
              },
            },
          );
          outcome = { status: "completed", result: manifest.result };
        } catch (error) {
          outcome = {
            status: "failed",
            error: String((error && error.message) || error),
          };
        }
      }
      try {
        tools.queue.settle(tools.vault, item.id, outcome);
      } catch (error) {
        console.error(
          "[Scholarium][agent-bridge] failed to settle queue item",
          item.id,
          error,
        );
      }
    }
    // Handlers mutate board.data in place (e.g. refreshOneFeed pushes new
    // articles); one save after the whole batch is cheap and means a
    // handler that forgets to persist internally can never silently lose
    // work, same belt-and-suspenders reasoning as refreshAll()'s own
    // trailing await this.save().
    await board.save();
  } finally {
    this._schScholariumBusy = false;
  }
}

export { SCH_SCHOLARIUM_QUEUE_ACTIONS, schPollScholariumQueue };
export function installScholariumQueue(wi) {
const schScholariumBridgeOnload = wi.prototype.onload;
wi.prototype.onload = async function () {
  await schScholariumBridgeOnload.call(this);
  this.__schRuntimeRoot = schRuntimeRoot();
  this.__schRuntimeStatus = () => schRuntimeBootstrap.status(this.__schRuntimeRoot);
  this.__schEnsureRuntime = (options = {}) => schEnsureRuntimeInstalled(this, options.onProgress);
  // Start the verified core installation as soon as the plugin is enabled so
  // synchronous command handlers never need Node/npm/Python setup from the
  // researcher. The promise is retained for diagnostics; failures stay loud
  // at the feature entry point and never fall back to plugin-directory bytes.
  this.__schRuntimeReadyPromise = this.__schEnsureRuntime().catch((error) => {
    console.warn("[Scholarium] verified runtime bootstrap failed:", error);
    return null;
  });
  this.register(() => schStopLocalRuntime(schRuntimeScope(this.app)));
  this._schScholariumBusy = false;
  /* SCHOLARIUM_NATIVE_WEAVER_SIDEBAR_HOOK */
  try {
    if (typeof schNativeWeaverHost !== "undefined" && schNativeWeaverHost.installSidebar) schNativeWeaverHost.installSidebar(this);
  } catch (error) {
    console.warn("[Scholarium] 侧边栏织研者注册失败:", error);
  }
  // 20s poll: fast enough that a Bridge caller waiting on a queued action
  // doesn't sit idle for long, cheap enough (one directory listing) to run
  // forever in the background. registerInterval() clears it on unload.
  this.registerInterval(
    window.setInterval(() => schPollScholariumQueue.call(this), 20000),
  );
};
}
