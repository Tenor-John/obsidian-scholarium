"use strict";
/**
 * Regression suite for obsidian-scholarium.
 *
 *   node tests/run.js
 *
 * No npm install, no package.json, no network. Run it before and after every
 * edit to main.js.
 */
const fs = require("fs");
const path = require("path");
const h = require("./harness");

const files = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.js"))
  .sort();

console.log("Scholarium regression suite");
console.log("bundle: " + h.MAIN);
console.log(
  "        " +
    h.source().length.toLocaleString() +
    " chars / " +
    h.source().split(/\r?\n/).length.toLocaleString() +
    " lines",
);
console.log("files : " + files.join(", "));

for (const f of files) require(path.join(__dirname, f));

h.run().then((ok) => {
  if (!ok) {
    console.log("\n⚠ Do not ship main.js until these pass.");
    process.exitCode = 1;
  }
});
