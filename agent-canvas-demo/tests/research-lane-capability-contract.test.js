"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Capabilities = require("../../tools/agent-capabilities.js");
const Detection = require("../../tools/agent-detect.js");

function detectedClaude() {
  return {
    claude: { key: "claude", ok: true, source: "PATH", version: "fixture", command: "claude" },
  };
}

test("shared research capability policy exposes no shell or native write/edit capability", () => {
  assert.equal(Capabilities.assertMinimalResearchCapabilities([
    "--tools", Capabilities.CLAUDE_RESEARCH_TOOLS,
    "--allowedTools", Capabilities.CLAUDE_RESEARCH_ALLOWED_TOOLS,
  ]), true);
});

test("the automatic configuration generator uses the shared capability minimum", () => {
  const adapter = Detection.toAdapters(detectedClaude(), { mcpResearchConfig: "fixture.json" }).adapters["claude-research"];
  assert.equal(Capabilities.assertMinimalResearchCapabilities(adapter.args), true);
  assert.ok(Capabilities.listedTools(adapter.args, "--allowedTools").includes("mcp__scholarium__vault_read"));
});

test("the runtime guard rejects a configuration generator regression", () => {
  assert.throws(
    () => Capabilities.assertMinimalResearchCapabilities(["--tools", "Read,Bash", "--allowedTools", "Read,Bash"]),
    /forbidden direct capabilities: Bash/,
  );
  assert.throws(
    () => Capabilities.assertMinimalResearchCapabilities([]),
    /must explicitly declare --tools and --allowedTools/,
  );
  assert.throws(
    () => Capabilities.assertMinimalResearchCapabilities([
      "--tools", "Read,Grep,Glob,WebFetch,WebSearch",
      "--allowedTools", "Read,Grep,Glob,WebFetch,WebSearch,mcp__scholarium__vault_read,mcp__unexpected__write",
    ]),
    /differ from the canonical minimum/,
  );
});

test("Bridge startup fails closed with the capability reason, not a false JSON error", (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "research-capability-startup-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const configPath = path.join(tmp, "bridge.config.json");
  fs.writeFileSync(configPath, JSON.stringify({
    token: "fixture", allowExecution: false, workspaceRoot: tmp, allowedRoots: [tmp],
    researchLaneEnabled: true,
    scholarium: { enabled: false, vaultRoot: tmp, allowedActions: [] },
    adapters: { "claude-research": { command: "claude", args: [], lane: "research" } },
  }), "utf8");
  const run = spawnSync(process.execPath, [path.join(__dirname, "..", "bridge", "server.js")], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_BRIDGE_CONFIG_PATH: configPath,
      AGENT_BRIDGE_SECRETS_PATH: path.join(tmp, "secrets.env"),
      AGENT_BRIDGE_PORT: "4597",
    },
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /must explicitly declare --tools and --allowedTools/);
  assert.doesNotMatch(run.stderr, /Invalid JSON/);
});
