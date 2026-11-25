"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup(ready) {
  const source = fs.readFileSync(path.join(__dirname, "..", "rss-feed-board.ts"), "utf8");
  const begin = source.indexOf("    async startManualCaptureBatch(items) {");
  const end = source.indexOf("    /* ---- PDF 文献资产", begin);
  assert.ok(begin >= 0 && end > begin);
  const buttons = [];
  let overlay, webview;
  class Element {
    constructor(tag) { this.tag = tag; this.listeners = new Map(); this.removed = false; }
    setCssStyles() {}
    setText(text) { this.text = text; }
    createDiv() { return new Element("div"); }
    createEl(tag, opts) { const child = new Element(tag); child.text = opts?.text; if (tag === "button") buttons.push(child); return child; }
    appendChild(child) { if (child.tag === "webview") webview = child; }
    remove() { this.removed = true; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    removeEventListener(name, fn) { if (this.listeners.get(name) === fn) this.listeners.delete(name); }
    setAttribute(name, value) { if (name === "src" && value !== "about:blank") queueMicrotask(() => this.listeners.get("did-finish-load")?.()); }
    stop() {}
  }
  const document = {
    createElement(tag) { const element = new Element(tag); if (tag === "div") overlay = element; return element; },
    body: { appendChild() { if (ready) queueMicrotask(() => webview.listeners.get("dom-ready")?.()); } },
  };
  const window = { setTimeout(fn, ms) { return setTimeout(fn, ms === 1600 ? 0 : ms); }, clearTimeout, setInterval, clearInterval };
  const context = { document, window, Ne: { Notice: function() {} }, schEvidenceTools() {}, console, Date, Map, Set, Promise };
  const methods = vm.runInNewContext(`({${source.slice(begin, end)}})`, context);
  const item = { id: "one", url: "https://example.org/article", title: "One" };
  let quickStarted;
  const quickCalled = new Promise((resolve) => { quickStarted = resolve; });
  const subject = {
    ...methods, manualDownloadQueue: [item], data: {}, plugin: {},
    manualCapturePublisherKey() { return "example.org"; },
    manualCaptureQuickCheck() { quickStarted(); return new Promise(() => {}); },
    pipelineBatchState() { return { batches: [] }; }, save() {}, rerender() {}, recordManualAttempt() { throw new Error("cancel should not mark failure"); },
  };
  return { subject, item, buttons, getOverlay: () => overlay, quickCalled };
}

for (const ready of [false, true]) {
  test(`closing a batch is immediate while ${ready ? "page inspection" : "webview startup"} is stuck`, async () => {
    const fixture = setup(ready);
    const run = fixture.subject.startManualCaptureBatch([fixture.item]);
    if (ready) await fixture.quickCalled;
    const stop = fixture.buttons.find((button) => button.text === "结束本轮");
    assert.ok(stop);
    stop.onclick();
    assert.equal(fixture.getOverlay().removed, true, "window must close synchronously");
    await Promise.race([run, new Promise((_, reject) => setTimeout(() => reject(new Error("batch did not settle")), 1000))]);
    assert.equal(fixture.subject.__manualCaptureBatchRunning, false);
    assert.equal(fixture.subject.manualDownloadQueue.length, 1);
    assert.equal(fixture.subject.manualCaptureLastReport.failed, 0);
    assert.equal(fixture.subject.manualCaptureLastReport.remaining, 1);
    assert.equal(fixture.subject.manualCaptureLastReport.stopped, true);
  });
}
