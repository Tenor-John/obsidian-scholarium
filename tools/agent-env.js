"use strict";
/* What a detected agent needs in order to actually answer: which provider it
   is pointed at, and whether it has credentials at all.
   ------------------------------------------------------------------------
   agent-detect.js answers "is the binary there and does it run". That is not
   the same question as "will it produce an answer". A `claude` that runs
   --version perfectly will still fail every dispatch if ANTHROPIC_BASE_URL
   points at a provider whose key was revoked, and the failure surfaces as a
   task error deep in the transcript rather than as anything the settings page
   would show.

   The design rule here, and the reason this file reads rather than writes:
   Claude Code, Codex and the rest already read their own credentials from
   their own config files, and on this machine CC Switch is what writes those
   files. If 织研者 kept its own copy of ANTHROPIC_AUTH_TOKEN, there would be
   two sources of truth that disagree the moment the user switches provider in
   CC Switch's tray — and the plugin's copy would live in the vault, which is
   synced. So: this module reports what the agents will actually see, and
   never stores a secret of its own.

   Secrets are never returned. A credential is reported as {present, masked,
   source} and nothing else — the masked form exists so a user can tell two
   keys apart, not so anything can use one. */

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir() || "";

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}
function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; }
}
function exists(file) {
  try { return Boolean(file) && fs.existsSync(file); } catch (_) { return false; }
}

/* Show enough of a credential to tell two of them apart, and no more. Short
   values are not partially revealed: a 12-character key would be most of the
   way given away by a 4+4 mask. */
function mask(value) {
  const text = String(value == null ? "" : value);
  if (!text) return null;
  if (text.length < 16) return "•".repeat(8);
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

/* ------------------------------------------------------------------ *
 * CC Switch (read-only)                                              *
 * ------------------------------------------------------------------ */

/* CC Switch's on-disk shape has changed between versions: the widely-cited
   layout is ~/.cc-switch/config.json, but the build installed on this machine
   keeps providers in a SQLite database (cc-switch.db) with a small
   settings.json beside it holding the current selection. Both are handled,
   and neither is required — an absent CC Switch is a normal state, not an
   error, because the agents' own config files are the real source and this is
   only here to put a human-readable provider NAME on what is otherwise a bare
   base_url. */
const CC_SWITCH_DIR = path.join(HOME, ".cc-switch");

function ccSwitchCurrentSelection() {
  const settings = readJson(path.join(CC_SWITCH_DIR, "settings.json")) || {};
  return {
    claude: settings.currentProviderClaude || null,
    codex: settings.currentProviderCodex || null,
    gemini: settings.currentProviderGemini || null,
    openclaw: settings.currentProviderOpenclaw || null,
    opencode: settings.currentProviderOpencode || null,
  };
}

/* node:sqlite is still flagged experimental on Node 22 and prints a warning to
   stderr on first use. It is loaded lazily and inside a try for that reason:
   if a future Node removes or renames it, CC Switch simply stops contributing
   a provider name and everything else on the page keeps working. Opened
   read-only — this process must never be the reason a user's provider list
   gets corrupted. */
function ccSwitchProviders() {
  const db = path.join(CC_SWITCH_DIR, "cc-switch.db");
  if (!exists(db)) return { available: false, reason: "no_db", providers: [] };
  let DatabaseSync;
  try { ({ DatabaseSync } = require("node:sqlite")); }
  catch (error) { return { available: false, reason: "no_sqlite", providers: [] }; }
  let handle = null;
  try {
    handle = new DatabaseSync(db, { readOnly: true });
    const rows = handle.prepare(
      "select id, app_type, name, settings_config, website_url from providers"
    ).all();
    const providers = rows.map((row) => {
      // settings_config holds the provider's full env, key included. Parse it
      // only to extract the non-secret descriptors; the token never leaves
      // this function.
      let baseUrl = null;
      let model = null;
      try {
        const parsed = JSON.parse(row.settings_config);
        const env = (parsed && parsed.env) || {};
        baseUrl = env.ANTHROPIC_BASE_URL || env.OPENAI_BASE_URL || env.BASE_URL || null;
        model = env.ANTHROPIC_MODEL || env.MODEL || null;
      } catch (_) {
        // Codex providers store a TOML blob rather than JSON env; pull the
        // base URL out textually if it is there, and otherwise leave it null
        // rather than guessing.
        const text = String(row.settings_config || "");
        const found = text.match(/base_url\s*=\s*["']([^"']+)["']/i);
        if (found) baseUrl = found[1];
      }
      return {
        id: row.id, appType: row.app_type, name: row.name,
        baseUrl, model, websiteUrl: row.website_url || null,
      };
    });
    return { available: true, reason: null, providers };
  } catch (error) {
    return { available: false, reason: `read_failed:${error.message}`, providers: [] };
  } finally {
    try { if (handle) handle.close(); } catch (_) { /* best effort */ }
  }
}

function ccSwitchStatus() {
  const installed = exists(CC_SWITCH_DIR);
  if (!installed) return { installed: false, providers: [], current: {}, note: null };
  const { available, reason, providers } = ccSwitchProviders();
  const current = ccSwitchCurrentSelection();
  return {
    installed: true, providers, current,
    note: available ? null
      : reason === "no_sqlite"
        ? "本机 Node 不支持 node:sqlite，无法读取 CC Switch 的供应商名称；下方仍显示各 agent 配置文件里的真实取值。"
        : reason === "no_db"
          ? "已找到 CC Switch 目录，但没有 cc-switch.db（可能是更早的版本）。"
          : `无法读取 CC Switch 数据库：${reason}`,
  };
}

/* ------------------------------------------------------------------ *
 * What each agent will actually read at dispatch time                *
 * ------------------------------------------------------------------ */

/* Claude Code resolves credentials from more than one place, and reporting
   only one of them produces false alarms. A subscription login (oauthAccount
   in ~/.claude.json) is a perfectly working setup with no API key anywhere;
   flagging that as "缺少密钥" would send the user hunting for a problem that
   does not exist. Both paths are therefore checked, and "unknown" is a real
   outcome — better than a confident wrong red dot. */
function claudeEnvironment() {
  const settings = readJson(path.join(HOME, ".claude", "settings.json")) || {};
  const env = settings.env || {};
  const token = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || null;
  const oauth = Boolean((readJson(path.join(HOME, ".claude.json")) || {}).oauthAccount);

  const credential = token
    ? { present: true, masked: mask(token), source: "~/.claude/settings.json → env", mode: "api_key" }
    : oauth
      ? { present: true, masked: null, source: "~/.claude.json → oauthAccount", mode: "oauth_login" }
      : { present: false, masked: null, source: null, mode: "none" };

  return {
    key: "claude",
    configFile: path.join(HOME, ".claude", "settings.json"),
    credential,
    baseUrl: env.ANTHROPIC_BASE_URL || null,
    model: env.ANTHROPIC_MODEL || null,
    // Everything non-secret from the env block, so the settings page can show
    // what is actually in effect (timeouts, model aliases, proxy switches).
    env: Object.fromEntries(Object.entries(env).filter(([name]) => !/key|token|secret/i.test(name))),
    problem: credential.present ? null
      : "没有找到 Claude 的凭据：既没有 settings.json 里的 ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY，也没有登录态。请在 CC Switch 中选择一个供应商，或运行 claude 登录。",
  };
}

/* Codex keeps auth in ~/.codex/auth.json (either an API key or an OAuth token
   bundle) and settings in config.toml. Only presence and shape are read. */
function codexEnvironment() {
  const auth = readJson(path.join(HOME, ".codex", "auth.json")) || {};
  const configText = readText(path.join(HOME, ".codex", "config.toml")) || "";
  const apiKey = auth.OPENAI_API_KEY || null;
  const hasTokens = Boolean(auth.tokens && (auth.tokens.access_token || auth.tokens.refresh_token));

  const credential = apiKey
    ? { present: true, masked: mask(apiKey), source: "~/.codex/auth.json → OPENAI_API_KEY", mode: "api_key" }
    : hasTokens
      ? { present: true, masked: null, source: "~/.codex/auth.json → tokens", mode: "oauth_login" }
      : { present: false, masked: null, source: null, mode: "none" };

  const model = (configText.match(/^\s*model\s*=\s*["']([^"']+)["']/m) || [])[1] || null;
  const baseUrl = (configText.match(/base_url\s*=\s*["']([^"']+)["']/i) || [])[1] || null;

  return {
    key: "codex",
    configFile: path.join(HOME, ".codex", "config.toml"),
    credential, baseUrl, model, env: {},
    problem: credential.present ? null
      : "没有找到 Codex 的凭据：~/.codex/auth.json 里既没有 OPENAI_API_KEY 也没有登录令牌。请在 CC Switch 中选择供应商，或运行 codex login。",
  };
}

/* opencode and openclaw are dispatched to but not owned by this project, and
   their config layouts are not stable enough to assert anything about. They
   are reported as "unknown" rather than guessed at: an unknown credential
   state that says so is honest; a green dot derived from a file that happens
   to exist is not. */
function opaqueEnvironment(key, configFile) {
  return {
    key, configFile,
    credential: { present: null, masked: null, source: null, mode: "unknown" },
    baseUrl: null, model: null, env: {},
    problem: null,
  };
}

const ENVIRONMENTS = {
  claude: claudeEnvironment,
  codex: codexEnvironment,
  opencode: () => opaqueEnvironment("opencode", path.join(HOME, ".config", "opencode")),
  openclaw: () => opaqueEnvironment("openclaw", path.join(HOME, ".openclaw")),
  /* environmentFor already falls back to an opaque entry for an unknown key,
     so these two are listed for one reason only: the report's keys come from
     Object.keys(ENVIRONMENTS), and an agent absent from here is never named at
     all. Both are reported opaquely because this module reads no credential it
     cannot verify — hermes keeps its own configuration under HERMES_HOME, and
     pi's location is not something this module can establish, so claiming to
     know either would be worse than saying nothing. */
  hermes: () => opaqueEnvironment(
    "hermes",
    process.env.HERMES_HOME ? path.join(process.env.HERMES_HOME, "config.yaml") : null,
  ),
  pi: () => opaqueEnvironment("pi", null),
};

function environmentFor(key) {
  const build = ENVIRONMENTS[key];
  return build ? build() : opaqueEnvironment(key, null);
}

/* Attach the CC Switch provider name to an agent's effective config, matching
   on base URL. The agent's own config file stays authoritative — CC Switch is
   only consulted for a label, so a stale or mismatched CC Switch entry can
   never change what this reports as being in effect. */
function labelProvider(environment, ccSwitch) {
  if (!ccSwitch.installed || !ccSwitch.providers.length) return null;
  const currentId = ccSwitch.current[environment.key];
  const byId = ccSwitch.providers.find(
    (p) => p.id === currentId && p.appType === environment.key
  );
  if (byId) {
    // A selection that disagrees with the file on disk is worth saying out
    // loud: it usually means something wrote the config after CC Switch did.
    const agrees = !byId.baseUrl || !environment.baseUrl || byId.baseUrl === environment.baseUrl;
    return {
      name: byId.name, id: byId.id, websiteUrl: byId.websiteUrl,
      agreesWithConfigFile: agrees,
      note: agrees ? null
        : `CC Switch 当前选中「${byId.name}」（${byId.baseUrl}），但 ${environment.configFile} 里实际是 ${environment.baseUrl}。以配置文件为准。`,
    };
  }
  const byUrl = environment.baseUrl
    ? ccSwitch.providers.find((p) => p.baseUrl === environment.baseUrl)
    : null;
  return byUrl
    ? { name: byUrl.name, id: byUrl.id, websiteUrl: byUrl.websiteUrl, agreesWithConfigFile: true, note: null }
    : null;
}

/* The whole report. `detected` is agent-detect.js's output; passing it in
   keeps this module free of process spawning, which makes it cheap to call
   from a settings page that re-renders. */
function environmentReport(detected = {}, options = {}) {
  const ccSwitch = options.ccSwitch || ccSwitchStatus();
  const keys = options.keys || Object.keys(ENVIRONMENTS);
  const agents = keys.map((key) => {
    const found = detected[key] || null;
    const environment = environmentFor(key);
    const provider = labelProvider(environment, ccSwitch);

    // Three-state readiness, deliberately not two. "installed" and "works" are
    // different facts, and collapsing them is exactly what let openclaw show a
    // green dot on a machine where it exits 1 on startup.
    const readiness = !found || !found.command ? "missing"
      : !found.ok ? "broken"
        : environment.problem ? "no_credential"
          : "ready";

    return {
      key,
      label: found?.label || key,
      readiness,
      installed: Boolean(found && found.command),
      command: found?.command || null,
      version: found?.version || null,
      source: found?.source || null,
      detectError: found?.error || null,
      provider,
      configFile: environment.configFile,
      credential: environment.credential,
      baseUrl: environment.baseUrl,
      model: environment.model,
      env: environment.env,
      problem: readiness === "broken" ? found.error
        : readiness === "no_credential" ? environment.problem
          : null,
    };
  });
  return { agents, ccSwitch, generatedAt: new Date().toISOString() };
}

module.exports = {
  environmentReport, environmentFor, ccSwitchStatus, ccSwitchProviders,
  ccSwitchCurrentSelection, labelProvider, mask, ENVIRONMENTS,
};

if (require.main === module) {
  const detect = require("./agent-detect.js");
  const report = environmentReport(detect.detectAll({ keys: Object.keys(ENVIRONMENTS) }));
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}
