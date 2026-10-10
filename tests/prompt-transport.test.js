"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("./harness");
const {
  MAX_ARGV_PROMPT_CHARS,
  migrateKnownPromptTransports,
  preparePromptTransport,
} = require("../tools/prompt-transport.js");

describe("agent prompt transport", () => {
  it("keeps a large verified-adapter prompt entirely out of argv", () => {
    const prompt = "研".repeat(120000);
    const prepared = preparePromptTransport({ promptTransport: "stdin", args: ["exec", "-"] }, prompt);
    assert.equal(prepared.stdin, prompt);
    assert.equal(prepared.args.join(" ").includes(prompt.slice(0, 100)), false);
  });

  it("removes legacy prompt markers and Claude's now-unused terminal separator", () => {
    const config = { adapters: { "claude-research": { command: "claude", args: ["-p", "--strict-mcp-config", "--", "{{prompt}}"] } } };
    migrateKnownPromptTransports(config);
    assert.equal(config.adapters["claude-research"].promptTransport, "stdin");
    assert.deepEqual(config.adapters["claude-research"].args, ["-p", "--strict-mcp-config"]);
  });

  it("substitutes tool policy without putting the prompt back in argv", () => {
    const prepared = preparePromptTransport(
      { promptTransport: "stdin", args: ["-p", "--allowedTools", "{{tools}}"] },
      "private prompt",
      { tools: "Read,Grep" },
    );
    assert.deepEqual(prepared.args, ["-p", "--allowedTools", "Read,Grep"]);
    assert.equal(prepared.stdin, "private prompt");
  });

  it("fails loudly when an unverified argv adapter would exceed the Windows ceiling", () => {
    assert.throws(
      () => preparePromptTransport({ args: ["run", "{{prompt}}"] }, "x".repeat(MAX_ARGV_PROMPT_CHARS + 1)),
      /prompt_transport_argv_limit/,
    );
  });

  it("preserves a bounded legacy argv adapter without claiming stdin support", () => {
    const prepared = preparePromptTransport({ args: ["run", "{{prompt}}"] }, "hello");
    assert.deepEqual(prepared, { mode: "argv", args: ["run", "hello"], stdin: null, promptChars: 5 });
  });
});
