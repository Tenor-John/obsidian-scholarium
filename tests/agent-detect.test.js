"use strict";
const path = require("path");
const { describe, it, assert } = require("./harness");
const D = require("../tools/agent-detect.js");

describe("agent detection: capability profiles are transcribed, not invented", () => {
    // The failure this guards against is not a crash. It is an agent that
    // still answers, from a smaller tool set, with nothing saying why.
    const found = {
      claude: { key: "claude", ok: true, source: "PATH", version: "2.1.247 (Claude Code)",
        command: "C:\\npm\\claude.cmd" },
      codex: { key: "codex", ok: true, source: "PATH", version: "codex-cli 0.149.1",
        command: "C:\\npm\\codex.cmd" },
    };

    it("emits every adapter profile, not just one per agent", () => {
      const { adapters } = D.toAdapters(found);
      for (const name of ["claude", "claude-research", "claude-full", "codex", "codex-full"])
        assert.ok(adapters[name], "缺少 adapter：" + name);
    });

    it("keeps claude's JSON output, tool allowlist and strict MCP config", () => {
      const { adapters } = D.toAdapters(found);
      const args = adapters.claude.args.join(" ");
      assert.match(args, /--output-format json/);
      assert.match(args, /--allowedTools Read,Grep,Glob,WebFetch,WebSearch/);
      assert.match(args, /--strict-mcp-config/);
      assert.eq(adapters.claude.promptTransport, "stdin");
      assert.notOk(adapters.claude.args.some((arg) => String(arg).includes("{{prompt}}")));
    });

    it("gives the research lane bounded read tools and strict MCP config", () => {
      const { adapters } = D.toAdapters(found, { mcpResearchConfig: "X\\mcp.research.json" });
      const research = adapters["claude-research"];
      assert.eq(research.lane, "research");
      assert.eq(research.promptTransport, "stdin");
      const args = research.args.join(" ");
      assert.match(args, /--output-format stream-json/);
      assert.match(args, /--tools Read,Grep,Glob,WebFetch,WebSearch/);
      assert.notOk(/Bash|PowerShell|Write|Edit/.test(args));
      assert.match(args, /mcp__scholarium__vault_search/);
      assert.match(args, /mcp__scholarium__vault_read/);
      assert.match(args, /--mcp-config X\\mcp\.research\.json/);
    });

    it("keeps the two codex sandboxes distinct", () => {
      const { adapters } = D.toAdapters(found);
      assert.match(adapters.codex.args.join(" "), /--sandbox read-only/);
      assert.eq(adapters.codex.sandboxed, true);
      assert.eq(adapters.codex.promptTransport, "stdin");
      assert.eq(adapters.codex.args[adapters.codex.args.length - 1], "-");
      assert.match(adapters["codex-full"].args.join(" "), /--sandbox workspace-write/);
      assert.eq(adapters["codex-full"].permission, "full");
    });

    it("records how each binary was found so a downgrade is diagnosable", () => {
      const { adapters } = D.toAdapters(found);
      assert.eq(adapters.claude.detected_version, "2.1.247 (Claude Code)");
      assert.eq(adapters.claude.detected_source, "PATH");
      assert.eq(adapters.claude.detected_command, "C:\\npm\\claude.cmd");
    });

    it("omits a missing agent and says why, instead of guessing a path", () => {
      const { adapters, notes } = D.toAdapters({
        claude: found.claude,
        codex: { key: "codex", ok: false, command: null, error: "未在本机找到 Codex。" },
      });
      assert.ok(adapters.claude);
      assert.notOk(adapters.codex);
      assert.eq(notes.length, 1);
      assert.match(notes[0], /未在本机找到 Codex/);
    });
  });

  describe("agent detection: Windows batch shims", () => {
    it("knows a .cmd shim cannot be spawned without a shell", () => {
      // Node refuses .cmd/.bat without shell:true (CVE-2024-27980 mitigation).
      // Missing this made detection report "not installed" for an agent that
      // answers `--version` perfectly well at the prompt.
      if (process.platform === "win32") {
        assert.eq(D.needsShell("C:\\npm\\claude.cmd"), true);
        assert.eq(D.needsShell("C:\\npm\\claude.BAT"), true);
      }
      assert.eq(D.needsShell("/usr/local/bin/claude"), false);
      assert.eq(D.needsShell(""), false);
    });
  });

  describe("agent detection: manual override", () => {
    it("reports a wrong hand-typed path instead of silently falling back", () => {
      const result = D.detectAgent("claude", {
        override: path.join(__dirname, "does-not-exist-anywhere.exe"),
      });
      assert.eq(result.ok, false);
      assert.eq(result.source, "manual");
      assert.match(result.error, /不存在/);
    });

    it("accepts an override that answers --version", () => {
      const result = D.detectAgent("claude", {
        override: process.execPath, probeVersion: () => "v20.0.0",
      });
      assert.eq(result.ok, true);
      assert.eq(result.source, "manual");
      assert.eq(result.version, "v20.0.0");
    });
});
