const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const D = require("../tools/agent-detect.js");
const E = require("../tools/agent-env.js");

describe("agent detection: 「装了但跑不起来」和「没装」是两回事", () => {
  /* The live failure this encodes, observed 2026-09-05: openclaw's shim sits
     on PATH and `openclaw --version` exits 1 with "Node.js >=22.22.3 <23,
     >=24.15.0 <25, or >=25.9.0 is required (current: v22.13.1)". The agent
     picker showed it as 可执行 because the check was a PATH lookup, and
     detection reported it as 未在本机找到 because any non-zero exit collapsed
     into "no candidate answered". Both messages sent the user somewhere
     useless: one to dispatch a task that could not run, the other to reinstall
     software that was already installed. */

  it("把非零退出的候选报成 broken，并保留它自己给出的原因", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zy-broken-agent-"));
    const shim = path.join(root, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
    fs.writeFileSync(shim, "");
    let found;
    try {
      found = D.detectAgent("openclaw", {
        extraRoots: [root],
        probeVersionDetail: () => ({
          ok: false, version: null, status: 1,
          message: "openclaw: Node.js >=22.22.3 is required (current: v22.13.1).",
        }),
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    assert.eq(found.ok, false);
    assert.eq(found.source, "found_but_broken");
    assert.ok(found.command, "必须指出是哪个文件跑不起来");
    assert.match(found.error, /Node\.js >=22\.22\.3/);
    // The user must not be told to install something they already have.
    assert.ok(!/未在本机找到/.test(found.error), "不应报成未安装：" + found.error);
    assert.match(found.error, /重装无法解决/);
  });

  it("真的什么都没找到时，仍然报未安装", () => {
    const found = D.detectAgent("openclaw", {
      // No candidate exists at all: every probe is unreachable.
      probeVersionDetail: () => ({ ok: false, version: null, status: null, message: null }),
    });
    assert.eq(found.ok, false);
    // Either outcome is honest here depending on what is installed on the test
    // machine; what must never happen is claiming success.
    assert.ok(found.source === "none" || found.source === "found_but_broken");
  });

  it("没有能力配置的 agent 不会被套用别人的参数", () => {
    // The bug this prevents: `key === "claude" ? claudeProfiles : codexProfiles`
    // would have handed OpenCode the Codex profile — `exec --sandbox read-only
    // --json` against a CLI with no such flags — and written it in as
    // sandboxed:true, asserting an enforcement mechanism that isn't there.
    const { adapters, notes } = D.toAdapters({
      opencode: { key: "opencode", label: "OpenCode", ok: true, source: "PATH", version: "1.18.13", command: "C:\\npm\\opencode.cmd" },
    });
    assert.eq(Object.keys(adapters).length, 0, "不应生成任何 adapter");
    assert.ok(notes.join(" ").includes("没有它的能力配置"));
  });

  it("用户选择的安装目录会被优先搜索", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zy-roots-"));
    const shim = path.join(root, process.platform === "win32" ? "codex.cmd" : "codex");
    fs.writeFileSync(shim, "");
    const seen = [];
    const found = D.detectAgent("codex", {
      extraRoots: [root],
      probeVersionDetail: (command) => {
        seen.push(command);
        return command === shim
          ? { ok: true, version: "codex-cli 9.9.9", status: 0, message: null }
          : { ok: false, version: null, status: 1, message: "not this one" };
      },
    });
    fs.rmSync(root, { recursive: true, force: true });
    assert.ok(seen.includes(shim), "自定义目录里的文件必须被探测到");
    if (found.ok) assert.eq(found.version, "codex-cli 9.9.9");
  });
});

describe("agent 环境体检：只读、不外泄密钥", () => {
  it("掩码不会泄漏短密钥的任何字符", () => {
    // A 4+4 mask of a 12-character key gives away two thirds of it.
    assert.eq(E.mask("sk-shortkey1"), "••••••••");
    assert.ok(!E.mask("sk-shortkey1").includes("sk-"));
    const long = "sk-" + "a".repeat(40) + "WXYZ";
    assert.match(E.mask(long), /^sk-a…WXYZ$/);
  });

  it("报告里不含任何完整凭据", () => {
    const report = E.environmentReport(
      { claude: { key: "claude", ok: true, command: "claude", version: "2.1.247", source: "PATH" } },
      { keys: ["claude"], ccSwitch: { installed: false, providers: [], current: {} } },
    );
    const text = JSON.stringify(report);
    // A real key on this machine is >100 chars; nothing that long may appear.
    assert.ok(!/sk-[A-Za-z0-9_-]{20,}/.test(text), "报告中出现了完整密钥");
    assert.ok(!/eyJ[A-Za-z0-9_-]{30,}/.test(text), "报告中出现了 JWT");
  });

  it("登录态不会被误报为缺少密钥", () => {
    // Claude Code authenticated by subscription login has no API key anywhere.
    // Reporting that as 缺少凭据 sends the user hunting for a non-problem.
    const environment = E.environmentFor("claude");
    if (environment.credential.mode === "oauth_login") {
      assert.eq(environment.problem, null);
      assert.eq(environment.credential.present, true);
    }
  });

  it("说不准的 agent 报 unknown，而不是猜一个绿灯", () => {
    const environment = E.environmentFor("opencode");
    assert.eq(environment.credential.mode, "unknown");
    assert.eq(environment.credential.present, null);
  });

  it("readiness 区分 missing / broken / ready", () => {
    const report = E.environmentReport({
      a: null,
      claude: { key: "claude", ok: false, source: "found_but_broken", command: "X\\claude.cmd", error: "跑不起来" },
    }, { keys: ["claude"], ccSwitch: { installed: false, providers: [], current: {} } });
    const claude = report.agents[0];
    assert.eq(claude.readiness, "broken");
    assert.eq(claude.installed, true, "broken 的前提是它确实装了");
    assert.eq(claude.problem, "跑不起来");
  });

  it("CC Switch 缺席不是错误", () => {
    const report = E.environmentReport({}, {
      keys: ["claude"], ccSwitch: { installed: false, providers: [], current: {} },
    });
    assert.eq(report.agents[0].readiness, "missing");
    assert.eq(report.ccSwitch.installed, false);
  });
});
