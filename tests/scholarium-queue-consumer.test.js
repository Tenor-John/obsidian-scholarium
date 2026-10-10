"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

const bundle = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

describe("Scholarium queue consumer wiring (main.js)", () => {
  it("defaults allowResearchWeaverActions to off", () => {
    assert.match(bundle, /allowResearchWeaverActions:\s*!1/);
  });

  it("exposes a settings-tab toggle for allowResearchWeaverActions", () => {
    // main.js's settings-tab class emits CJK text as \uXXXX escapes (see
    // tests/settings-ui.test.js for the same pattern elsewhere in this
    // bundle), so match the escaped form rather than the literal characters.
    assert.match(
      bundle,
      /\\u5141\\u8BB8\\u7EC7\\u7814\\u8005\\u6267\\u884C Scholarium \\u52A8\\u4F5C/,
    );
    assert.match(
      bundle,
      /T\.setValue\(!!s\.allowResearchWeaverActions\)\.onChange\(async \(N\) => \{\s*\(s\.allowResearchWeaverActions = N\)/,
    );
  });

  it("places the action-consent toggle in the 织研者 Agent section, not only in RSS settings", () => {
    const agentSelector = bundle.indexOf('localStorage.getItem("scholarium.deductionAgentId")');
    const toggle = bundle.indexOf("\\u5141\\u8BB8\\u7EC7\\u7814\\u8005\\u6267\\u884C Scholarium \\u52A8\\u4F5C");
    const rssHeading = bundle.indexOf("\\u{1F4E1} \\u6587\\u732E\\u8BA2\\u9605");
    assert.ok(agentSelector >= 0, "missing default Agent selector");
    assert.ok(toggle > agentSelector, "consent toggle must follow the Agent selector");
    assert.ok(toggle < rssHeading, "consent toggle must appear before the RSS section");
  });

  it("gates schPollScholariumQueue on the settings toggle before doing anything else", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    assert.ok(start !== -1, "schPollScholariumQueue must exist");
    const head = bundle.slice(start, start + 400);
    assert.match(head, /if \(!this\.settings \|\| !this\.settings\.allowResearchWeaverActions\) return;/);
  });

  it("whitelists exactly the approved action set for the queue consumer", () => {
    const start = bundle.indexOf("const SCH_SCHOLARIUM_QUEUE_ACTIONS");
    assert.ok(start !== -1, "SCH_SCHOLARIUM_QUEUE_ACTIONS must exist");
    const end = bundle.indexOf("];", start);
    const block = bundle.slice(start, end + 2);
    const expected = [
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
    // Exactly the explicitly approved action types: no incidental action
    // name can become executable merely by reaching the queue.
    const entries = block.match(/"[a-z_.-]+"/g) || [];
    assert.eq(entries.length, expected.length, "whitelist must contain exactly the " + expected.length + " permitted actions");
    // The panel-control writes need plugin.loadData/saveData; the live context
    // must hand the consumer's plugin instance through.
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
    assert.match(body, /tools\.actions\.runAsync\(/);
    assert.match(body, /dryRun:\s*false/);
    assert.match(body, /confirmed:\s*true/);
    assert.match(body, /by:\s*"agent:research-weaver"/);
    assert.match(body, /allowedLevels:\s*\["L0",\s*"L1"\]/);
  });

  it("uses a throwaway RssFeedBoard instance, never the live open-dashboard board", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    const end = bundle.indexOf("async function", start + 1);
    const body = bundle.slice(start, end === -1 ? start + 4000 : end);
    assert.match(body, /let board = new Ys\(this\.app, this\);/);
    assert.match(body, /await board\.load\(\);/);
    assert.match(body, /await board\.save\(\);/);
    assert.noMatch(body, /window\.__scholariumRssBoard/);
  });

  it("settles every queue item exactly once via tools.queue.settle, even on handler failure", () => {
    const start = bundle.indexOf("async function schPollScholariumQueue");
    const end = bundle.indexOf("async function", start + 1);
    const body = bundle.slice(start, end === -1 ? start + 4000 : end);
    assert.match(body, /tools\.queue\.settle\(tools\.vault, item\.id, outcome\);/);
  });

  it("polls on a 20s interval registered for automatic cleanup on unload", () => {
    assert.match(
      bundle,
      /this\.registerInterval\(\s*window\.setInterval\(\(\) => schPollScholariumQueue\.call\(this\), 20000\),\s*\);/,
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
    assert.match(body, /const toolsRoot = path\.join\(root, "tools"\)/);
    assert.match(body, /queue:\s*req\(path\.join\(toolsRoot,\s*"bridge-action-queue\.js"\)\)/);
  });
});
