"use strict";

const { source, describe, it, assert } = require("./harness");

describe("织研者执行追踪器跨页面持久化", () => {
  it("keeps the Weaver iframe mounted while legacy Scholarium panels render", () => {
    const src = source();
    const start = src.indexOf("const originalRender = proto.render;");
    const end = src.indexOf("// 织研者 iframe", start);
    const renderPatch = src.slice(start, end);
    assert.match(renderPatch, /__scholariumPersistentShell/);
    assert.match(renderPatch, /__scholariumLegacyHost/);
    assert.match(renderPatch, /__scholariumWeaverHost/);
    assert.match(renderPatch, /this\.contentEl = legacyHost/);
    assert.match(renderPatch, /finally \{ this\.contentEl = realContent; \}/);
    assert.match(renderPatch, /this\.__weaverFrame && this\.__weaverFrame\.isConnected/);
    assert.noMatch(renderPatch, /if \(this\.activePanel !== "deduction"\)\s*return originalRender/);
  });

  it("switches panels by visibility rather than removing the live iframe", () => {
    const src = source();
    assert.match(src, /weaverHost\.style\.visibility = "hidden"/);
    assert.match(src, /weaverHost\.style\.visibility = "visible"/);
    assert.match(src, /legacyHost\.style\.visibility = "hidden"/);
    assert.match(src, /legacyHost\.style\.visibility = "visible"/);
  });

  it("returns a completed manual download to the actual Weaver tab", () => {
    const src = source();
    assert.match(src, /dashboard\?\.switchTab\?\.\("deduction"\)/);
    assert.noMatch(src, /dashboard\?\.switchTab\?\.\("weaver"\)/);
  });
});
