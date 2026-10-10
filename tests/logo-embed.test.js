"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BEGIN, END, sha256, renderLogoBlock, replaceBlock } = require("../tools/embed-logo.js");

test("[L1] logo embed is deterministic and records the exact source hash", () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  const first = renderLogoBlock(bytes);
  const second = renderLogoBlock(bytes);
  assert.equal(first, second);
  assert.match(first, new RegExp(`source_sha256=${sha256(bytes)}`));
  assert.match(first, /data:image\/png;base64,iVBORw==/);
});

test("[L1] logo embed replaces only the marked block", () => {
  const source = `before\n${BEGIN}\nold\n${END}\nafter`;
  const block = renderLogoBlock(Buffer.from("new"));
  assert.equal(replaceBlock(source, block), `before\n${block}\nafter`);
});

test("[L1] logo embed fails loudly when the bundle has no markers", () => {
  assert.throws(() => replaceBlock("unmarked", "block"), /missing the Scholarium logo embed markers/);
});
