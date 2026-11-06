"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

const bundle = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

describe("Scholarium queue consumer wiring (main.js)", () => {
  it("defaults allowResearchWeaverActions to off", () => {
    assert.match(bundle, /allowResearchWeaverActions:\s*false/);
  });

  it("exposes a settings-tab toggle for allowResearchWeaverActions", () => {
    assert.match(bundle, /允许织研者执行 Scholarium 动作/);
    assert.match(
      bundle,
      /\.setValue\(!!\w+\.allowResearchWeaverActions\)\.onChange\(async \(\w+\) => \{\s*\w+\.allowResearchWeaverActions = \w+/,
    );
  });

  it("places the action-consent toggle in the 织研者 Agent section, not only in RSS settings", () => {
    const agentHeading = bundle.indexOf("🕸️ 织研者 Agent");
    const toggle = bundle.indexOf("允许织研者执行 Scholarium 动作");
    const rssHeading = bundle.indexOf("📡 文献订阅（RSS）");
    assert.ok(agentHeading >= 0, "missing 织研者 Agent section");
    assert.ok(toggle > agentHeading, "consent toggle must follow the Agent heading");
    assert.ok(rssHeading > toggle, "consent toggle must appear before the RSS section");
  });

  it("gates schPollScholariumQueue on the settings toggle before doing anything else", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    assert.ok(start !== -1, "schPollScholariumQueue must exist");
    const head = bundle.slice(start, start + 400);
    assert.match(head, /if \(!this\.settings \|\| !this\.settings\.allowResearchWeaverActions\) return;/);
  });

  it("whitelists exactly the approved 30-action set for the queue consumer", () => {
    const start = bundle.indexOf("var SCH_SCHOLARIUM_QUEUE_ACTIONS");
    assert.ok(start !== -1, "SCH_SCHOLARIUM_QUEUE_ACTIONS must exist");
    const end = bundle.indexOf("];", start);
    const block = bundle.slice(start, end + 2);
    const expected = [
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
    for (const name of expected) assert.match(block, new RegExp('"' + name.replace(/\./g, "\\.") + '"'), "whitelist must contain " + name);
    const entries = block.match(/"[a-z_.-]+"/g) || [];
    assert.eq(entries.length, expected.length, "whitelist must contain exactly the " + expected.length + " permitted actions");
    const liveStart = bundle.indexOf("live: {", start);
    const liveBlock = bundle.slice(liveStart, bundle.indexOf("},", liveStart));
    assert.match(liveBlock, /plugin: this/, "queue consumer live context must include plugin: this");
  });

  it("re-checks the whitelist inside the consumer loop, not just by construction", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    const end = bundle.indexOf("async function", start + 1);
    const body = bundle.slice(start, end === -1 ? start + 4000 : end);
    assert.match(body, /if \(!SCH_SCHOLARIUM_QUEUE_ACTIONS\.includes\(item\.action\)\) \{/);
    assert.match(body, /action is not permitted from the Scholarium queue consumer/);
  });

  it("executes queued actions for real (not dry-run) with explicit confirmation and a distinct actor", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    const end = bundle.indexOf("async function", start + 1);
    const body = bundle.slice(start, end === -1 ? start + 4000 : end);
    assert.match(body, /tools\d*\.actions\.runAsync\(/);
    assert.match(body, /dryRun:\s*false/);
    assert.match(body, /confirmed:\s*true/);
    assert.match(body, /by:\s*"agent:research-weaver"/);
    assert.match(body, /allowedLevels:\s*\["L0",\s*"L1"\]/);
  });

  it("isolates ordinary RSS writes and limits matrix live-board reuse to this plugin", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    const end = bundle.indexOf("async function", start + 1);
    const body = bundle.slice(start, end === -1 ? start + 4000 : end);
    assert.match(body, /let board = new Ys\d*\(this\.app, this\);/);
    assert.match(body, /await board\.load\(\);/);
    assert.match(body, /await board\.save\(\);/);
    assert.match(body, /matrixLiveBoard = .*pending\.some\(\(item\) => item\.action\.startsWith\("literature\.matrix_"\)\)/);
    assert.match(body, /window\.__scholariumRssBoard.*plugin.*=== this/);
    assert.match(body, /item\.action\.startsWith\("literature\.matrix_"\) && .*=== this \? window\.__scholariumRssBoard : board/);
  });

  it("settles every queue item exactly once via tools.queue.settle, even on handler failure", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    const end = bundle.indexOf("async function", start + 1);
    const body = bundle.slice(start, end === -1 ? start + 4000 : end);
    assert.match(body, /tools\d*\.queue\.settle\(tools\d*\.vault, item\.id, outcome\);/);
  });

  it("polls on a 20s interval registered for automatic cleanup on unload", () => {
    assert.match(
      bundle,
      /this\.registerInterval\(\s*window\.setInterval\(\(\) => schPollScholariumQueue\.call\(this\), (?:20000|2e4)\),?\s*\);/,
    );
  });

  it("retires the old bespoke agent-requests mechanism entirely", () => {
    assert.noMatch(bundle, /schAgentRequestsDir/);
    assert.noMatch(bundle, /schRunAgentAction/);
    assert.noMatch(bundle, /schPollAgentRequests/);
  });

  it("exposes queue and root on the schEvidenceTools registry", () => {
    const start = bundle.indexOf("function schEvidenceTools");
    assert.ok(start !== -1, "schEvidenceTools must exist");
    const end = bundle.indexOf("\n}", start);
    const body = bundle.slice(start, end === -1 ? start + 3000 : end);
    assert.match(body, /const toolsRoot = path\d*\.join\(root\d*, "tools"\)/);
    assert.match(body, /queue:\s*req\(path\d*\.join\(toolsRoot,\s*"bridge-action-queue\.js"\)\)/);
  });
});
