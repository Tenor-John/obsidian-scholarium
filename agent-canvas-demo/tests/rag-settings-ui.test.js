"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const ui = fs.readFileSync(path.join(root, "settings-ui.js"), "utf8");

test("settings center exposes RAG status, vectorization and graph dry-run controls", () => {
  for (const id of ["settingsRagStatus", "refreshRagStatus", "reindexRag", "previewRagGraph"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(ui, /\/v1\/rag\/status/);
  assert.match(ui, /\/v1\/rag\/reindex/);
  assert.match(ui, /\/v1\/rag\/graph/);
  assert.match(ui, /window\.confirm\([^)]*Hugging Face/s, "cloud reindex must disclose quota use before it starts");
  assert.match(ui, /未写入 Vault/, "graph button must remain a dry-run in settings");
});
