"use strict";

// Windows CreateProcess limits the complete command line to roughly 32k UTF-16
// characters. Prompts are therefore process input, never command-line data, for
// every locally verified adapter. Unsupported legacy adapters may still use the
// argv placeholder, but they fail visibly before approaching that limit.
const MAX_ARGV_PROMPT_CHARS = 24000;
const STDIN_ADAPTER_IDS = new Set([
  "codex", "codex-full",
  "claude", "claude-research", "claude-full",
  "opencode", "opencode-full",
]);

function isVerifiedStdinBinary(id, adapter) {
  const command = String(adapter?.command || "").replaceAll("\\", "/").toLowerCase();
  const args = (Array.isArray(adapter?.args) ? adapter.args : []).map((arg) => String(arg).replaceAll("\\", "/").toLowerCase());
  if (id.startsWith("claude")) return /(^|\/)claude(?:\.cmd|\.exe)?$/.test(command);
  if (id.startsWith("opencode")) return /(^|\/)opencode(?:\.cmd|\.exe)?$/.test(command);
  if (id.startsWith("codex")) {
    return /(^|\/)codex(?:\.cmd|\.exe)?$/.test(command)
      || args.some((arg) => /\/\@openai\/codex\/.*\/codex\.js$|\/\@openai\/codex\/bin\/codex\.js$/.test(arg));
  }
  return false;
}

function normalizeStdinArgs(args) {
  const normalized = (Array.isArray(args) ? args : []).filter((arg) => String(arg) !== "{{prompt}}");
  // Claude used `-- {{prompt}}` to stop variadic --tools parsing. Once the
  // prompt travels over stdin the terminal `--` has no positional value.
  if (normalized[normalized.length - 1] === "--") normalized.pop();
  return normalized;
}

function migrateKnownPromptTransports(config) {
  for (const [id, adapter] of Object.entries(config?.adapters || {})) {
    if (!adapter || !STDIN_ADAPTER_IDS.has(id) || !isVerifiedStdinBinary(id, adapter)) continue;
    adapter.promptTransport = "stdin";
    adapter.args = normalizeStdinArgs(adapter.args);
  }
  return config;
}

function preparePromptTransport(adapter, prompt, substitutions = {}) {
  if (!adapter || typeof adapter !== "object") throw new Error("adapter is required");
  const text = String(prompt ?? "");
  const mode = String(adapter.promptTransport || "argv");
  const replaceTools = (value) => String(value).replaceAll("{{tools}}", String(substitutions.tools || ""));

  if (mode === "stdin") {
    const args = normalizeStdinArgs(adapter.args).map(replaceTools);
    if (args.some((arg) => arg.includes("{{prompt}}"))) {
      throw new Error("stdin prompt transport cannot retain an embedded {{prompt}} placeholder");
    }
    return { mode, args, stdin: text, promptChars: text.length };
  }

  if (mode !== "argv") throw new Error(`unsupported prompt transport '${mode}'`);
  if (text.length > MAX_ARGV_PROMPT_CHARS) {
    throw new Error(`prompt_transport_argv_limit: ${text.length} characters exceed the ${MAX_ARGV_PROMPT_CHARS}-character safety ceiling; configure a verified stdin transport`);
  }
  let inserted = false;
  const args = (Array.isArray(adapter.args) ? adapter.args : []).map((value) => {
    let rendered = replaceTools(value);
    if (rendered.includes("{{prompt}}")) {
      rendered = rendered.replaceAll("{{prompt}}", text);
      inserted = true;
    }
    return rendered;
  });
  if (!inserted) args.push(text);
  return { mode, args, stdin: null, promptChars: text.length };
}

module.exports = {
  MAX_ARGV_PROMPT_CHARS,
  STDIN_ADAPTER_IDS,
  migrateKnownPromptTransports,
  preparePromptTransport,
};
