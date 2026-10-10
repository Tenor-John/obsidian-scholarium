"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const queue = require("../tools/bridge-action-queue");

function tempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-bridge-queue-"));
}

describe("bridge action queue", () => {
  it("round-trips a submitted item through pending, read and settle", () => {
    const vault = tempVault();
    const item = queue.submit(vault, "rss.refresh_feed", { feed_id: "feed-1" }, { by: "bridge" });
    assert.eq(item.status, "pending");
    assert.eq(queue.listPending(vault).length, 1);
    const fetched = queue.read(vault, item.id);
    assert.eq(fetched.action, "rss.refresh_feed");
    const settled = queue.settle(vault, item.id, { status: "completed", result: { ok: true } });
    assert.eq(settled.status, "completed");
    assert.eq(queue.listPending(vault).length, 0, "settled item must leave the pending queue");
    assert.eq(queue.read(vault, item.id).status, "completed", "read() must still find it once archived");
  });
  it("keeps unrelated pending items untouched when one is settled", () => {
    const vault = tempVault();
    const a = queue.submit(vault, "rss.refresh_feed", { feed_id: "feed-1" });
    const b = queue.submit(vault, "rss.score_feed", { feed_id: "feed-2" });
    queue.settle(vault, a.id, { status: "failed", error: "boom" });
    const pending = queue.listPending(vault);
    assert.eq(pending.length, 1);
    assert.eq(pending[0].id, b.id);
  });
  it("returns null for an id that was never submitted", () => {
    const vault = tempVault();
    assert.eq(queue.read(vault, "does-not-exist"), null);
  });
  it("refuses to settle an item twice", () => {
    const vault = tempVault();
    const item = queue.submit(vault, "rss.refresh_feed", { feed_id: "feed-1" });
    queue.settle(vault, item.id, { status: "completed" });
    let threw = false;
    try { queue.settle(vault, item.id, { status: "completed" }); }
    catch (e) { threw = true; assert.match(e.message, /queue_item_not_found/); }
    assert.ok(threw);
  });
  it("lists recent archive entries newest-first and respects the limit", () => {
    const vault = tempVault();
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const item = queue.submit(vault, "rss.refresh_feed", { feed_id: "feed-" + i });
      queue.settle(vault, item.id, { status: "completed" });
      ids.push(item.id);
    }
    const recent = queue.recentArchive(vault, 2);
    assert.eq(recent.length, 2);
  });
});
