"use strict";
/* Locate the coding agents (Claude Code, Codex) already installed on this
   machine, so that bridge.config.json does not have to be hand-written with
   absolute paths before anything works at all.
   ------------------------------------------------------------------------
   Why this exists: `bridge.config.example.json` ships seven `C:\path\to\...`
   placeholders. Every one of them has to be replaced correctly before the
   Bridge will dispatch a single task, and getting one wrong fails at dispatch
   time with a message about the adapter, not about the path. On the author's
   machine those seven values were filled in months ago and never thought about
   again; on anyone else's machine they are the whole install.

   What this deliberately does NOT do: guess. A detection that silently falls
   back to a differently-capable binary is worse than no detection, because the
   agent still answers — just less well, from a smaller context or an older
   model — and nothing in the transcript says why. Every result therefore
   carries `source` (how it was found) and `version` (what actually answered),
   and an entry that could not be verified is returned with `ok: false` rather
   than being quietly dropped or substituted. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("node:child_process");
const {
  CLAUDE_SAFE_TOOLS,
  CLAUDE_RESEARCH_TOOLS,
  CLAUDE_RESEARCH_ALLOWED_TOOLS,
  assertMinimalResearchCapabilities,
} = require("./agent-capabilities.js");

const WINDOWS = process.platform === "win32";

/* `where` on Windows and `which` elsewhere. Both print one path per line and
   exit non-zero when nothing matched. */
function onPath(command) {
  try {
    const probe = spawnSync(WINDOWS ? "where" : "which", [command], {
      encoding: "utf8", windowsHide: true, timeout: 5000,
    });
    if (probe.status !== 0) return [];
    return String(probe.stdout || "")
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  } catch (_) { return []; }
}

/* `npm root -g`. On Windows npm is itself a .cmd shim, so this needs the same
   shell treatment as probeVersion below — without it the call returns null and
   every known_location lookup that depends on it silently finds nothing. */
function npmGlobalRoot() {
  try {
    const probe = spawnSync(WINDOWS ? "npm.cmd" : "npm", ["root", "-g"], {
      encoding: "utf8", windowsHide: true, timeout: 20000, shell: WINDOWS,
    });
    if (probe.status === 0) {
      const dir = String(probe.stdout || "").trim();
      if (dir && fs.existsSync(dir)) return dir;
    }
  } catch (_) { /* fall through to the filesystem guess */ }
  // Fallback for when npm cannot be run at all (not on PATH, policy-blocked):
  // the global prefix is the parent of the shims, so a shim we already found
  // tells us where node_modules is.
  for (const guess of [
    WINDOWS ? path.join(process.env.APPDATA || "", "npm", "node_modules") : null,
    WINDOWS ? null : "/usr/local/lib/node_modules",
    WINDOWS ? null : "/opt/homebrew/lib/node_modules",
  ].filter(Boolean)) {
    try { if (fs.existsSync(guess)) return guess; } catch (_) { /* next */ }
  }
  return null;
}

/* Both agents install on Windows as `claude.cmd` / `codex.cmd` batch shims.
   Since the CVE-2024-27980 mitigation, Node refuses to spawn a .cmd or .bat
   without `shell: true` — it fails with EINVAL. The first version of this
   module did not do that, and so reported "未在本机找到 Claude Code" on a
   machine where `claude --version` prints 2.1.247 at the prompt. That is
   precisely the silent-downgrade failure this module exists to prevent, so
   it is worth naming: a batch shim needs a shell, and quoting, because the
   npm path runs through AppData and can contain spaces. */
function needsShell(command) {
  return WINDOWS && /\.(cmd|bat)$/i.test(String(command || ""));
}

/* Ask the binary what it is. A path that exists proves nothing: a stale
   shim, a wrapper script from a half-removed install, or a same-named tool
   will all pass fs.existsSync and then behave differently at dispatch. */
function probeVersionDetail(command, args = ["--version"]) {
  const shell = needsShell(command);
  try {
    const probe = spawnSync(shell ? `"${command}"` : command, args, {
      encoding: "utf8", windowsHide: true, timeout: 20000, shell,
    });
    const text = String(probe.stdout || probe.stderr || "").trim();
    const first = text ? text.split(/\r?\n/)[0].slice(0, 200) : null;
    return {
      ok: probe.status === 0 && Boolean(first),
      version: probe.status === 0 ? first : null,
      status: probe.status,
      // What the binary said when it refused to run. This is the difference
      // between "openclaw is not installed" and "openclaw is installed but
      // needs Node >=22.22.3" — the first sends the user to npm install, the
      // second to nvm, and only one of them is true.
      message: probe.status === 0 ? null : (first || (probe.error && probe.error.message) || null),
    };
  } catch (error) { return { ok: false, version: null, status: null, message: error.message }; }
}

function probeVersion(command, args = ["--version"]) {
  return probeVersionDetail(command, args).version;
}

const HOME = os.homedir() || "";
function existing(...parts) {
  const file = path.join(...parts.filter(Boolean));
  try { return fs.existsSync(file) ? file : null; } catch (_) { return null; }
}

/* Well-known install locations, in the order a user is most likely to have
   used. npm-global first because both agents ship as npm packages. */
function knownLocations(names, extraRoots = []) {
  const out = [];
  const root = npmGlobalRoot();
  for (const name of names) {
    /* Folders the user chose in settings, searched before the system-wide
       locations. An agent installed with `npm install --prefix <folder>` puts
       its shim at <folder>/<cmd>.cmd (Windows) or <folder>/bin/<cmd>, and its
       package under <folder>/node_modules — all three are tried, because which
       one exists depends on the npm version rather than on anything we
       control. Searched first so that a deliberate local install wins over a
       stale global one the user has forgotten about. */
    for (const base of extraRoots) {
      if (!base) continue;
      out.push(existing(base, name.cmd + (WINDOWS ? ".cmd" : "")));
      out.push(existing(base, "bin", name.cmd + (WINDOWS ? ".cmd" : "")));
      out.push(existing(base, "node_modules", name.pkg, name.bin));
      out.push(existing(base, "node_modules", ".bin", name.cmd + (WINDOWS ? ".cmd" : "")));
    }
    if (root) {
      out.push(existing(root, name.pkg, name.bin));
      out.push(existing(path.dirname(root), name.cmd + (WINDOWS ? ".cmd" : "")));
    }
    if (WINDOWS) {
      out.push(existing(process.env.APPDATA, "npm", name.cmd + ".cmd"));
      out.push(existing(process.env.LOCALAPPDATA, "Programs", name.cmd, name.cmd + ".exe"));
    } else {
      out.push(existing("/usr/local/bin", name.cmd));
      out.push(existing("/opt/homebrew/bin", name.cmd));
      out.push(existing(HOME, ".local", "bin", name.cmd));
    }
    out.push(existing(HOME, "." + name.cmd, "bin", name.cmd + (WINDOWS ? ".exe" : "")));
  }
  return out.filter(Boolean);
}

/* The agents this build knows how to drive. `lane` and `sandboxed` mirror the
   fields bridge/server.js already reads off an adapter, so a detected entry
   can be dropped straight into `adapters` without translation. */
const AGENTS = {
  claude: {
    label: "Claude Code",
    cmd: "claude",
    locations: [{ cmd: "claude", pkg: "@anthropic-ai/claude-code", bin: "cli.js" }],
  },
  codex: {
    label: "Codex",
    cmd: "codex",
    locations: [{ cmd: "codex", pkg: "@openai/codex", bin: path.join("bin", "codex.js") }],
  },
  /* opencode and openclaw are dispatched to by existing configs but this
     module has no capability profile for either (see toAdapters below). They
     are listed here so they get the same real `--version` probe as the others
     and can be reported honestly in the settings page. Detection reporting and
     adapter generation are deliberately separate concerns: being probed here
     grants an agent nothing. */
  opencode: {
    label: "OpenCode",
    cmd: "opencode",
    profiles: false,
    locations: [{ cmd: "opencode", pkg: "opencode-ai", bin: path.join("bin", "opencode.js") }],
  },
  openclaw: {
    label: "OpenClaw",
    cmd: "openclaw",
    profiles: false,
    locations: [{ cmd: "openclaw", pkg: "openclaw", bin: path.join("bin", "openclaw.js") }],
  },
  /* hermes and pi are not npm packages, so there is no package path to look
     under and `locations` stays empty: PATH is the only way to find either.
     That has a consequence worth stating, because it looks like a bug when it
     bites. hermes ships as a real .exe installed by uv, and a PATH entry added
     after a process started is not visible to that process. A Bridge launched
     before hermes was installed will report it missing however correct this
     entry is, and the fix is to restart the Bridge, not to edit this list.
     pi resolves through a .cmd shim that was already on PATH, so it is found
     straight away. */
  hermes: {
    label: "Hermes Agent",
    cmd: "hermes",
    profiles: false,
    locations: [],
  },
  pi: {
    label: "Pi",
    cmd: "pi",
    profiles: false,
    locations: [],
  },
};

/* Detect one agent. `override` is the manually-entered path from settings and
   always wins — auto-detection is a convenience, never a veto over what the
   researcher says is installed. An override that does not answer is reported
   as broken rather than silently ignored, because a user who typed a path
   needs to be told it is wrong, not routed around. */
function detectAgent(key, options = {}) {
  const spec = AGENTS[key];
  if (!spec) throw new Error("unknown_agent:" + key);
  const override = String(options.override || "").trim();
  const probe = options.probeVersion || probeVersion;

  if (override) {
    const exists = (() => { try { return fs.existsSync(override); } catch (_) { return false; } })();
    const version = exists ? probe(override, ["--version"]) : null;
    return {
      key, label: spec.label, command: override, source: "manual",
      ok: Boolean(exists && version), version: version || null,
      error: !exists ? "手动填写的路径不存在：" + override
        : !version ? "路径存在但无法执行 --version，可能不是 " + spec.label + "：" + override
          : null,
    };
  }

  const seen = new Set();
  const extraRoots = Array.isArray(options.extraRoots) ? options.extraRoots : [];
  const all = [...onPath(spec.cmd), ...knownLocations(spec.locations, extraRoots)]
    .filter((file) => file && !seen.has(file) && seen.add(file));
  /* `where.exe openclaw` returns three lines: the extensionless Bash shim, the
     .cmd, and the .ps1. Node cannot spawn the first one at all (ENOENT), and
     probing it first made the diagnosis "ENOENT" — which is about our spawn
     call, not about the user's install. The .cmd is the one Windows actually
     runs, so runnable extensions are probed first; extensionless entries are
     kept only as a last resort, and on POSIX nothing is reordered. */
  const candidates = WINDOWS
    ? [...all.filter((file) => /\.(cmd|bat|exe)$/i.test(file)),
       ...all.filter((file) => /\.ps1$/i.test(file) === false && !/\.(cmd|bat|exe)$/i.test(file))]
    : all;
  /* Two different failures used to collapse into one message. A candidate that
     exists but exits non-zero was reported as "未在本机找到" — telling the user
     to install software they already have. openclaw on this machine is exactly
     that case: the shim is on PATH and exits 1 with "Node.js >=22.22.3 is
     required". The first refusal is therefore kept and reported verbatim. */
  const detail = options.probeVersionDetail
    || (options.probeVersion
      ? (file, args) => {
        const version = options.probeVersion(file, args);
        return { ok: Boolean(version), version: version || null, status: version ? 0 : 1, message: null };
      }
      : probeVersionDetail);
  let refused = null;
  for (const command of candidates) {
    const result = detail(command, ["--version"]);
    if (result.ok) {
      return {
        key, label: spec.label, command, version: result.version, ok: true,
        source: onPath(spec.cmd).includes(command) ? "PATH" : "known_location",
        error: null,
      };
    }
    /* Keep the most informative refusal, not merely the first. A shim that
       cannot be spawned tells the user nothing; one that printed "Node.js
       >=22.22.3 is required" tells them exactly what to do. */
    const informative = Boolean(result.message) && !/ENOENT|EINVAL/i.test(String(result.message));
    if (!refused || (informative && !refused.informative)) {
      refused = { command, informative, ...result };
    }
  }
  if (refused) {
    return {
      key, label: spec.label, command: refused.command, version: null, ok: false,
      source: "found_but_broken", exitStatus: refused.status,
      error: spec.label + " 已安装于 " + refused.command + "，但无法运行"
        + (refused.status == null ? "" : "（退出码 " + refused.status + "）")
        + "：" + (refused.message || "没有输出")
        + " —— 这不是缺少安装，重装无法解决。",
    };
  }
  return {
    key, label: spec.label, command: null, version: null, ok: false, source: "none",
    error: "未在本机找到 " + spec.label + "。已查找 PATH 与常见安装位置（"
      + (candidates.length ? candidates.join(" | ") : "无候选")
      + "）。可在设置中手动填写可执行文件路径，或使用「安装」按钮。",
  };
}

function detectAll(options = {}) {
  const overrides = options.overrides || {};
  const results = {};
  const keys = Array.isArray(options.keys) ? options.keys : Object.keys(AGENTS);
  // extraRoots reaches detectAgent through the spread below; named here so the
  // contract is visible at the entry point rather than only at the call site.
  void options.extraRoots;
  for (const key of keys)
    results[key] = detectAgent(key, { ...options, override: overrides[key] });
  return results;
}

/* Adapter capability profiles.
   ------------------------------------------------------------------------
   These are transcribed from the working bridge.config.json, NOT invented.
   That distinction is the whole point of this table: detection's job is to
   find out WHERE the binary is, never to decide WHAT it may do. An earlier
   draft of this file emitted `claude` with `args: ["--print"]`, which runs —
   and is a severe downgrade: no JSON output, no tool allowlist, no
   --strict-mcp-config, no research lane. The agent would still answer, just
   with less context and fewer tools, and nothing anywhere would say so.

   Every flag below therefore has a reason recorded in bridge/server.js's own
   comments. Prompts use stdin so Windows' CreateProcess command-line limit
   cannot silently discard context. {{tools}} is still substituted by the
   Bridge at dispatch. */
function claudeProfiles(exec, mcpResearchConfig) {
  return {
    claude: {
      ...exec, sandboxed: true, promptTransport: "stdin",
      args: [...exec.args, "-p", "--output-format", "json",
        "--tools", CLAUDE_SAFE_TOOLS, "--allowedTools", CLAUDE_SAFE_TOOLS,
        "--strict-mcp-config"],
    },
    "claude-research": {
      ...exec, lane: "research", promptTransport: "stdin",
      args: [...exec.args, "-p", "--output-format", "stream-json", "--verbose",
        "--tools", CLAUDE_RESEARCH_TOOLS, "--allowedTools", CLAUDE_RESEARCH_ALLOWED_TOOLS,
        ...(mcpResearchConfig ? ["--mcp-config", mcpResearchConfig] : []),
        "--strict-mcp-config"],
    },
    "claude-full": {
      ...exec, permission: "full", sandbox: "none", promptTransport: "stdin",
      defaultTools: ["Read", "Write", "Glob", "Grep", "WebFetch"],
      args: [...exec.args, "-p", "--output-format", "json",
        "--allowedTools", "{{tools}}", "--strict-mcp-config"],
    },
  };
}

function codexProfiles(exec) {
  return {
    codex: {
      ...exec, sandboxed: true, promptTransport: "stdin",
      args: [...exec.args, "exec", "--sandbox", "read-only", "--skip-git-repo-check", "--json", "-"],
    },
    "codex-full": {
      ...exec, permission: "full", sandbox: "workspace-write", promptTransport: "stdin",
      args: [...exec.args, "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--json", "-"],
    },
  };
}

/* How to invoke a detected agent.

   bridge/server.js spawns with no `shell` option, so an explicit `.cmd` path
   would fail there with EINVAL exactly as it did in probeVersion. Two ways
   out, and the working config already uses both:
     - claude: pass the bare name ("claude") and let PATH resolution handle
       the shim, which is what the config that works today does.
     - codex: run the package entry point through this very Node binary
       (process.execPath), which sidesteps shims entirely.
   Detection still records the resolved absolute path in `detected_command`
   so a broken PATH is diagnosable. */
function claudeExec(found) {
  if (found.source === "PATH") return { command: AGENTS.claude.cmd, args: [] };
  if (/\.(cmd|bat)$/i.test(found.command)) return { command: found.command, args: [], shell: true };
  if (/\.js$/i.test(found.command)) return { command: process.execPath, args: [found.command] };
  return { command: found.command, args: [] };
}

function codexExec(found) {
  const root = npmGlobalRoot();
  const entry = root ? existing(root, "@openai", "codex", "bin", "codex.js") : null;
  if (entry) return { command: process.execPath, args: [entry] };
  if (/\.js$/i.test(found.command)) return { command: process.execPath, args: [found.command] };
  if (found.source === "PATH") return { command: AGENTS.codex.cmd, args: [] };
  return { command: found.command, args: [], shell: needsShell(found.command) || undefined };
}

/* Only agents that actually answered are emitted. A missing agent is left out
   rather than written in with a guessed path: an adapter that exists but
   cannot run turns a clear "not installed" into an opaque dispatch failure.
   `notes` carries the reason for every omission. */
function toAdapters(detected, options = {}) {
  const adapters = {};
  const notes = [];
  const build = { claude: claudeProfiles, codex: codexProfiles };
  const exec = { claude: claudeExec, codex: codexExec };
  for (const [key, found] of Object.entries(detected)) {
    if (!found.ok || !found.command) { notes.push(found.error); continue; }
    /* Only agents this module has a real capability profile for produce
       adapters. The earlier form of this line was `key === "claude" ? ... :
       codexProfiles(...)`, which would have handed a detected OpenCode the
       whole Codex profile — `exec --sandbox read-only --json` against a CLI
       that has no such flags. It would have been written into the config as
       `sandboxed: true`, claiming an enforcement mechanism that does not
       exist. An agent without a profile is reported by detectAll and left out
       of `adapters` entirely. */
    if (AGENTS[key] && AGENTS[key].profiles === false) {
      notes.push(`${found.label} 已安装（${found.version}），但本版本没有它的能力配置，未写入 adapters。`);
      continue;
    }
    const profiles = key === "claude"
      ? build.claude(exec.claude(found), options.mcpResearchConfig)
      : key === "codex"
        ? build.codex(exec.codex(found))
        : null;
    if (!profiles) { notes.push(`未知代理 ${key}，未生成 adapters。`); continue; }
    for (const [name, profile] of Object.entries(profiles)) {
      if (name.startsWith("_")) continue;
      if (name === "claude-research") assertMinimalResearchCapabilities(profile.args);
      adapters[name] = {
        ...profile,
        detected_version: found.version,
        detected_source: found.source,
        detected_command: found.command,
      };
    }
  }
  return { adapters, notes: notes.filter(Boolean) };
}

module.exports = {
  AGENTS, detectAgent, detectAll, toAdapters,
  onPath, probeVersion, probeVersionDetail, npmGlobalRoot, knownLocations, needsShell,
};

if (require.main === module) {
  // Extra search roots arrive as argv so the Bridge can hand over the folders
  // the user installed into without this module reading the Bridge's config.
  const found = detectAll({ extraRoots: process.argv.slice(2) });
  const { adapters, notes } = toAdapters(found);
  process.stdout.write(JSON.stringify({ detected: found, adapters, notes }, null, 2) + "\n");
  process.exitCode = Object.keys(adapters).length ? 0 : 1;
}
