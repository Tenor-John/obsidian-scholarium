"use strict";
const fs = require("fs");
const path = require("path");
const {describe, it, assert} = require("./harness");
describe("marketplace manifest identity", () => {
  it("keeps the registered plugin ID and maps the release version", () => {
    const root = path.join(__dirname, "..");
    const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
    const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
    assert.equal(manifest.id, "scholarium");
    assert.equal(versions[manifest.version], manifest.minAppVersion);
  });
});
