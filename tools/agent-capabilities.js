"use strict";

// Single source of truth for capabilities that an automatically generated or
// default Bridge configuration may expose. Keeping policy here prevents a safe
// live JSON file from being silently widened by the next configuration run.
const CLAUDE_SAFE_TOOLS = "Read,Grep,Glob,WebFetch,WebSearch";
const SCHOLARIUM_RESEARCH_MCP_TOOLS = [
  "mcp__scholarium__scholarium_state",
  "mcp__scholarium__vault_search",
  "mcp__scholarium__vault_read",
  "mcp__scholarium__rescan_checkpoint_mark",
];
const CLAUDE_RESEARCH_TOOLS = CLAUDE_SAFE_TOOLS;
const CLAUDE_RESEARCH_ALLOWED_TOOLS = [
  ...CLAUDE_SAFE_TOOLS.split(","),
  ...SCHOLARIUM_RESEARCH_MCP_TOOLS,
].join(",");
// Claude exposes the native shell under different names across platforms:
// Bash on macOS/Linux and PowerShell on Windows (confirmed in live init events
// on 2026-08-22). Both names must remain forbidden; checking only one would
// silently reopen direct process-level writes on the other platform.
const RESEARCH_FORBIDDEN_TOOLS = Object.freeze(["Bash", "PowerShell", "Write", "Edit"]);

function listedTools(args, flag) {
  const values = Array.isArray(args) ? args : [];
  const index = values.indexOf(flag);
  return index >= 0 ? String(values[index + 1] || "").split(",").filter(Boolean) : [];
}

function sameToolSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((name) => actual.includes(name));
}

function assertMinimalResearchCapabilities(args) {
  const tools = listedTools(args, "--tools");
  const allowedTools = listedTools(args, "--allowedTools");
  const expectedTools = CLAUDE_RESEARCH_TOOLS.split(",");
  const expectedAllowedTools = CLAUDE_RESEARCH_ALLOWED_TOOLS.split(",");
  if (!tools.length || !allowedTools.length) {
    throw new Error("research adapter must explicitly declare --tools and --allowedTools");
  }
  const exposed = new Set([...tools, ...allowedTools]);
  const forbidden = RESEARCH_FORBIDDEN_TOOLS.filter((name) => exposed.has(name));
  if (forbidden.length) throw new Error(`research adapter exposes forbidden direct capabilities: ${forbidden.join(", ")}`);
  if (!sameToolSet(tools, expectedTools) || !sameToolSet(allowedTools, expectedAllowedTools)) {
    throw new Error("research adapter capabilities differ from the canonical minimum");
  }
  return true;
}

module.exports = {
  CLAUDE_SAFE_TOOLS,
  CLAUDE_RESEARCH_TOOLS,
  CLAUDE_RESEARCH_ALLOWED_TOOLS,
  SCHOLARIUM_RESEARCH_MCP_TOOLS,
  RESEARCH_FORBIDDEN_TOOLS,
  listedTools,
  assertMinimalResearchCapabilities,
};
