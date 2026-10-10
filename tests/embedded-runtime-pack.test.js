"use strict";

const crypto = require("crypto");
const { source, describe, it, assert } = require("./harness");

describe("self-contained runtime", () => {
  it("embeds the verified runtime payload in the shipped main.js", () => {
    const src = source();
    const start = src.indexOf("/* SCHOLARIUM_RUNTIME_PACK_EMBED_BEGIN */");
    const end = src.indexOf("/* SCHOLARIUM_RUNTIME_PACK_EMBED_END */", start);
    assert.ok(start >= 0 && end > start, "embedded runtime block is missing");
    const block = src.slice(start, end);
    const metadataMatch = block.match(/var SCH_EMBEDDED_RUNTIME_PACK = Object\.freeze\((\{[^\n]+\})\);/);
    assert.ok(metadataMatch, "embedded runtime metadata is missing");
    const metadata = JSON.parse(metadataMatch[1]);
    const chunks = [...block.matchAll(/^\s*"([A-Za-z0-9+/=]+)"[,]?$/gm)].map((match) => match[1]);
    assert.ok(chunks.length > 0, "embedded runtime payload is empty");
    const pack = Buffer.from(chunks.join(""), "base64");
    assert.eq(pack.length, metadata.size);
    assert.eq(crypto.createHash("sha256").update(pack).digest("hex"), metadata.sha256);
  });

  it("initializes only from the plugin-bundled runtime", () => {
    const src = source();
    const start = src.indexOf("async function schEnsureRuntimeInstalled");
    const end = src.indexOf("async function schResolveRuntimeLaunchSpec", start);
    assert.ok(start >= 0 && end > start, "runtime initializer is missing");
    const initializer = src.slice(start, end);
    assert.match(initializer, /schInstallBundledRuntime\(root, onProgress\)/);
    assert.noMatch(initializer, /manifestUrl|installFromIncoming|fetch\(/);
  });
});
