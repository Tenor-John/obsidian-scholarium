"use strict";
/**
 * Turn recovered chat history into `scholarium-chat/1` import candidates.
 *
 * Two sources feed this, exactly as §3 of the execution plan lists them:
 *
 *   1. the `weaver.shell.chat*` bodies that `inventory.js` reads out of a
 *      LevelDB **copy**. Every candidate keeps `sourceOrigin`, `sourcePath`,
 *      `sourceKey` and the SHA-256 of the bytes it came from, so a reviewer can
 *      go back to the backup and check any single message.
 *   2. Markdown notes under `Experiments/Projects/<id>/03_织研者对话/`, whose
 *      frontmatter `type` is `research-theory-turn` or `zhiyanzhe-session`.
 *      `zhiyanzhe-session` notes carry a machine-readable
 *      `<!--ZHIYANZHE-SESSION-DATA ... -->` array which is used in preference to
 *      the rendered `###` headings, because the rendered headings are a lossy
 *      view of it.
 *
 * Nothing here writes to the vault, to `localStorage`, or to the LevelDB copy.
 * The output is a candidate package for `POST /v1/chat/import/preview`; the
 * decision to import belongs to a human, and `import/commit` only ever creates
 * new sessions.
 *
 *   node tools/chat-recovery/convert.js \
 *     --backup  "<the inventory backup dir>" \
 *     --markdown "<vault>/Experiments/Projects" \
 *     --out     candidates.json [--json] [--values]
 *
 * `--vault <root>` is accepted as a shorthand for
 * `--markdown <root>/Experiments/Projects`.
 *
 * Deduplication uses the contract key
 * `sha256(sourceKey + "|" + role + "|" + at + "|" + text).slice(0, 32)`, which is
 * also the `m-imp-<32hex>` message id §1 assigns to imported messages, so the
 * server and this tool agree on identity without either guessing.
 */
const fs = require("fs");
const path = require("path");
const {
  scanBackupEntries,
  decodeText,
  sha256,
  writeJsonFile,
  CHAT_KEY_PREFIX,
  ACTIVE_SESSION_KEY,
} = require("./inventory");

const ROLES = new Set(["user", "agent", "system", "error"]);
const MARKDOWN_TYPES = new Set(["research-theory-turn", "zhiyanzhe-session"]);
const CHAT_DIR_NAME = "03_织研者对话";
const SCAN_DIRS = new Set([".git", "node_modules", ".obsidian", ".trash"]);

/* ------------------------------------------------------------------ */
/* shared                                                             */
/* ------------------------------------------------------------------ */

/**
 * Contract §4.3 dedup key. `join` renders null/undefined as "", so a message
 * with no timestamp still gets a stable key instead of an exception.
 */
function dedupeKey(sourceKey, role, at, text) {
  return sha256(Buffer.from([sourceKey, role, at, text].join("|"), "utf8")).slice(0, 32);
}

function messageIdFor(sourceKey, role, at, text) {
  return "m-imp-" + dedupeKey(sourceKey, role, at, text);
}

/** `topic:<flowId>` when unbound, `project:<id>` when the note knows its project. */
function scopeFor(projectId, topicId) {
  return projectId ? "project:" + projectId : "topic:" + topicId;
}

/**
 * A localStorage body is a JSON array of `{role, text, at}`. Anything else —
 * an object, a scalar, a message with a role the contract rejects — is reported
 * rather than coerced, because guessing a role silently rewrites history.
 */
function messagesFromStored(valueText, context) {
  const accepted = [];
  const skipped = [];
  const unparsed = [];
  let parsed;
  try {
    parsed = JSON.parse(valueText);
  } catch (e) {
    unparsed.push({ file: context.file, byteStart: null, byteEnd: null, reason: "stored value is not JSON", detail: e.message + " (" + context.key + ")" });
    return { accepted, skipped, unparsed };
  }
  if (!Array.isArray(parsed)) {
    skipped.push({ sourceKey: context.key, index: null, reason: "stored value is not an array of messages", detail: "got " + (parsed === null ? "null" : typeof parsed), text: null });
    return { accepted, skipped, unparsed };
  }
  if (!parsed.length) {
    // An empty array is a real (if uninteresting) history. It is recorded as
    // skipped so the arithmetic "candidates = imported + skipped" closes.
    skipped.push({ sourceKey: context.key, index: null, reason: "stored value holds no messages", detail: "empty array", text: null });
    return { accepted, skipped, unparsed };
  }
  parsed.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      skipped.push({ sourceKey: context.key, index, reason: "message is not an object", detail: JSON.stringify(entry).slice(0, 120), text: null });
      return;
    }
    const role = entry.role;
    const text = typeof entry.text === "string" ? entry.text : null;
    if (!ROLES.has(role)) {
      skipped.push({ sourceKey: context.key, index, reason: "unsupported role", detail: String(role), text });
      return;
    }
    if (text === null) {
      skipped.push({ sourceKey: context.key, index, reason: "message has no string text", detail: Object.keys(entry).join(","), text: null });
      return;
    }
    const at = typeof entry.at === "string" && entry.at ? entry.at : null;
    const rest = Object.fromEntries(Object.entries(entry).filter(([k]) => k !== "role" && k !== "text" && k !== "at"));
    const payload = Object.keys(rest).length ? rest : null;
    accepted.push({ role, text, at, payload });
  });
  return { accepted, skipped, unparsed };
}

/* ------------------------------------------------------------------ */
/* source 1: the LevelDB copy                                         */
/* ------------------------------------------------------------------ */

/** `weaver.shell.chat.legacy-archived` -> `legacy-archived`; the bare key -> `legacy`. */
function topicIdFromChatKey(key) {
  if (key === CHAT_KEY_PREFIX) return "legacy";
  const suffix = key.slice(CHAT_KEY_PREFIX.length + 1);
  return suffix || "default";
}

function itemsFromBackup(backupDir, options = {}) {
  const entries = options.entries || scanBackupEntries(backupDir);
  const items = [];
  const skipped = [];
  const unparsed = [];
  for (const entry of entries) {
    const key = decodeText(entry.rawKey).text;
    if (key === ACTIVE_SESSION_KEY) {
      skipped.push({ sourceKey: key, index: null, reason: "pointer key, not a conversation body", detail: entry.origin, text: null });
      continue;
    }
    if (!key.startsWith(CHAT_KEY_PREFIX)) continue;
    if (!entry.value) {
      skipped.push({ sourceKey: key, index: null, reason: "key was deleted with no surviving value", detail: entry.origin, text: null });
      continue;
    }
    const valueText = decodeText(entry.value).text;
    const extracted = messagesFromStored(valueText, { key, file: entry.file });
    unparsed.push(...extracted.unparsed);
    skipped.push(...extracted.skipped);
    if (!extracted.accepted.length) continue;
    const topicId = topicIdFromChatKey(key);
    items.push({
      scopeKey: scopeFor(null, topicId),
      topicId,
      projectId: null,
      title: "旧版对话 · " + topicId,
      sourceOrigin: entry.origin,
      sourcePath: null,
      sourceKey: key,
      sourceSha256: sha256(entry.value),
      sourceKind: entry.source === "bytescan" ? "leveldb-bytescan" : "leveldb-structured",
      sourceFile: entry.file,
      messages: extracted.accepted,
    });
  }
  return { items, skipped, unparsed };
}

function itemsFromInventoryJson(report) {
  const entries = (report.chatEntries || []).map((entry) => {
    // A deleted key carries no value by definition, so its absence is data, not
    // a missing --values. Everything else has to be present: a report without
    // bodies cannot be converted, and guessing would be worse than failing.
    if (entry.valueSha256 === null) {
      return { origin: entry.origin, rawKey: Buffer.from(entry.key, "utf8"), value: null, file: entry.file, source: entry.source };
    }
    if (typeof entry.valueText !== "string") {
      throw new Error(
        "inventory JSON has no full value for " + entry.origin + " / " + entry.key +
          "; re-run inventory with --values, or point convert at --backup instead",
      );
    }
    return {
      origin: entry.origin,
      rawKey: Buffer.from(entry.key, "utf8"),
      value: Buffer.from(entry.valueText, "utf8"),
      file: entry.file,
      source: entry.source,
    };
  });
  return itemsFromBackup(null, { entries });
}

/* ------------------------------------------------------------------ */
/* source 2: Markdown notes                                           */
/* ------------------------------------------------------------------ */

/** Minimal YAML frontmatter reader: `key: value` pairs, quoted or bare. */
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { present: false, data: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { present: false, data: {}, body: text };
  const data = {};
  for (const line of text.slice(text.indexOf("\n", 3) + 1, end).split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    data[match[1]] = value;
  }
  return { present: true, data, body: text.slice(end + 4) };
}

/**
 * H2/H3 sections in document order. One pass over both levels, because two
 * separate passes would silently reorder a note that mixes them (every H2 turn
 * before every H3 turn) — a reordering that no assertion about counts would
 * catch.
 */
function sections(body, levels = [2, 3]) {
  const wanted = levels.map((level) => "#".repeat(level) + " ");
  const out = [];
  let current = null;
  for (const line of body.split(/\r?\n/)) {
    const marker = wanted.find((m) => line.startsWith(m) && !line.startsWith(m + "#"));
    if (marker) {
      if (current) out.push(current);
      current = { level: marker.length - 1, heading: line.slice(marker.length).trim(), lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) out.push(current);
  return out.map((section) => ({ level: section.level, heading: section.heading, text: section.lines.join("\n").trim() }));
}

function roleForHeading(heading) {
  const text = String(heading || "");
  if (text.includes("研究员") || text === "你") return "user";
  if (text.includes("Agent") || text.includes("织研者")) return "agent";
  return "system";
}

const SESSION_DATA_RE = /<!--\s*ZHIYANZHE-SESSION-DATA\s*([\s\S]*?)-->/;

const SESSION_ROLES = { researcher: "user", agent: "agent", evidence: "system", tool: "system", system: "system" };

/**
 * The session data block is the authoritative record; the `###` headings above
 * it are a rendering of it. Prefer the block, and say so when it is malformed
 * instead of silently falling back to the lossier view.
 */
function messagesFromSessionData(blockText, context) {
  const accepted = [];
  const skipped = [];
  const unparsed = [];
  let parsed;
  try {
    parsed = JSON.parse(blockText.trim());
  } catch (e) {
    unparsed.push({ file: context.file, byteStart: null, byteEnd: null, reason: "ZHIYANZHE-SESSION-DATA block is not JSON", detail: e.message });
    return { accepted, skipped, unparsed, usable: false };
  }
  if (!Array.isArray(parsed)) {
    unparsed.push({ file: context.file, byteStart: null, byteEnd: null, reason: "ZHIYANZHE-SESSION-DATA block is not an array", detail: typeof parsed });
    return { accepted, skipped, unparsed, usable: false };
  }
  parsed.forEach((entry, index) => {
    const role = SESSION_ROLES[entry && entry.role];
    if (!role) {
      skipped.push({ sourceKey: context.key, index, reason: "unsupported session role", detail: String(entry && entry.role), text: null });
      return;
    }
    const content = entry.content;
    if (typeof content === "string") {
      accepted.push({ role, text: content, at: null, payload: null });
      return;
    }
    if (content && typeof content === "object") {
      // §2 keeps the complete original object in `payload`; the readable text is
      // a rendering of it, and both are handed on so nothing is flattened away.
      accepted.push({ role, text: JSON.stringify(content, null, 2), at: null, payload: content });
      return;
    }
    skipped.push({ sourceKey: context.key, index, reason: "session entry has no text content", detail: String(content), text: null });
  });
  return { accepted, skipped, unparsed, usable: true };
}

function itemsFromMarkdown(roots, options = {}) {
  const files = [];
  const items = [];
  const skipped = [];
  const unparsed = [];
  for (const root of roots) {
    const resolved = path.resolve(root);
    if (!fs.existsSync(resolved)) {
      unparsed.push({ file: options.toRelative ? options.toRelative(resolved) : resolved, byteStart: null, byteEnd: null, reason: "markdown root does not exist", detail: "nothing was scanned here" });
      continue;
    }
    walkMarkdown(resolved, files, path.basename(resolved) === CHAT_DIR_NAME);
  }
  files.sort((a, b) => a.localeCompare(b));

  for (const file of files) {
    const relative = (options.toRelative || ((p) => p))(file);
    const raw = fs.readFileSync(file);
    const front = parseFrontmatter(raw.toString("utf8"));
    const type = front.data.type;
    if (!MARKDOWN_TYPES.has(type)) {
      // A note in the chat folder that is neither flavour: report it by name so
      // the folder can be swept clean rather than silently ignored.
      unparsed.push({ file: relative, byteStart: null, byteEnd: null, reason: "unrecognised note type", detail: type ? "type: " + type : "no frontmatter type" });
      continue;
    }
    const projectId = front.data.project_id || null;
    const topicId = front.data.design_id || front.data.session_id || path.basename(path.dirname(file));
    const sourceKey = "md:" + type + ":" + relative;
    const sourceSha256 = sha256(raw);
    const at = front.data.created_at || front.data.updated_at || null;
    const atSource = front.data.created_at ? "frontmatter.created_at" : front.data.updated_at ? "frontmatter.updated_at" : null;

    let extracted;
    if (type === "zhiyanzhe-session") {
      const block = SESSION_DATA_RE.exec(raw.toString("utf8"));
      if (block) {
        extracted = messagesFromSessionData(block[1], { file: relative, key: sourceKey });
      } else {
        extracted = { accepted: [], skipped: [], unparsed: [], usable: false };
        unparsed.push({ file: relative, byteStart: null, byteEnd: null, reason: "zhiyanzhe-session note has no ZHIYANZHE-SESSION-DATA block", detail: "falling back to the rendered headings, which are a lossy view" });
      }
      if (!extracted.usable) {
        extracted = fallbackFromHeadings(front.body, { file: relative, key: sourceKey }, extracted);
      }
    } else {
      extracted = fallbackFromHeadings(front.body, { file: relative, key: sourceKey }, { skipped: [], unparsed: [] });
    }

    skipped.push(...(extracted.skipped || []));
    unparsed.push(...(extracted.unparsed || []));
    if (!extracted.accepted.length) {
      unparsed.push({ file: relative, byteStart: null, byteEnd: null, reason: "no conversation turns recognised", detail: "expected `## <speaker>` or `### <speaker>` sections" });
      continue;
    }
    for (const message of extracted.accepted) {
      if (!message.at) {
        message.at = at;
        message.atSource = atSource || "unknown";
      } else {
        message.atSource = "message";
      }
    }
    items.push({
      scopeKey: scopeFor(projectId, topicId),
      topicId,
      projectId,
      title: front.data.title || path.basename(file, ".md"),
      sourceOrigin: null,
      sourcePath: relative,
      sourceKey,
      sourceSha256,
      sourceKind: type,
      sourceSessionId: front.data.session_id || null,
      messages: extracted.accepted,
    });
  }
  return { items, skipped, unparsed };
}

/**
 * Headings are the only record when a note predates the data block, so they are
 * read as turns and the shared frontmatter timestamp is attached — the note has
 * no per-turn time and inventing one would be worse than saying so.
 */
function fallbackFromHeadings(body, context, carried) {
  const accepted = [];
  const skipped = carried.skipped || [];
  const unparsed = carried.unparsed || [];
  for (const section of sections(body)) {
    if (!section.text.trim()) continue;
    // The text is kept verbatim, fence included: an agent turn in these notes
    // is a fenced JSON block, and stripping the fence would turn a structured
    // answer into prose that no longer round-trips.
    accepted.push({ role: roleForHeading(section.heading), text: section.text, at: null, payload: null });
  }
  return { accepted, skipped, unparsed, usable: accepted.length > 0 };
}

/**
 * Only files inside a `03_织研者对话` directory are conversation notes. Scanning
 * the whole project tree instead would report every experiment record and
 * roadmap as an "unrecognised note type", which is noise that hides the notes
 * that really did fail to parse.
 */
function walkMarkdown(root, out, inside = false, depth = 0) {
  if (depth > 8) return;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SCAN_DIRS.has(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out, inside || entry.name === CHAT_DIR_NAME, depth + 1);
    else if (inside && entry.isFile() && entry.name.toLowerCase().endsWith(".md")) out.push(full);
  }
}

/* ------------------------------------------------------------------ */
/* package                                                            */
/* ------------------------------------------------------------------ */

/**
 * A package `items` array is byte-for-byte the `POST /v1/chat/import/preview`
 * body: §4.3 fixes those field names, so the dedup keys travel beside it in
 * `dedupe` rather than inside it.
 */
function buildPackage(options) {
  const fromBackup = options.entries
    ? itemsFromBackup(null, { entries: options.entries })
    : options.inventoryReport
      ? itemsFromInventoryJson(options.inventoryReport)
      : options.backup
        ? itemsFromBackup(options.backup)
        : { items: [], skipped: [], unparsed: [] };

  const markdown = options.markdownRoots && options.markdownRoots.length
    ? itemsFromMarkdown(options.markdownRoots, { toRelative: options.toRelative })
    : { items: [], skipped: [], unparsed: [] };

  const raw = fromBackup.items.concat(markdown.items);
  const seen = new Map();
  let duplicateMessages = 0;
  const dedupe = [];
  const provenance = [];
  for (const item of raw) {
    provenance.push({
      sourceKey: item.sourceKey,
      sourceKind: item.sourceKind,
      sourceFile: item.sourceFile || null,
      sourceSessionId: item.sourceSessionId || null,
      messageCount: item.messages.length,
    });
    item.messages.forEach((message, index) => {
      const key = dedupeKey(item.sourceKey, message.role, message.at, message.text);
      dedupe.push({ item: item.sourceKey, index, messageId: messageIdFor(item.sourceKey, message.role, message.at, message.text), key });
      if (seen.has(key)) duplicateMessages++;
      else seen.set(key, true);
    });
  }

  return {
    schema: "scholarium-chat-candidate/1",
    generatedAt: new Date().toISOString(),
    sources: {
      backupDir: options.backup ? path.resolve(options.backup) : null,
      inventoryPath: options.inventoryPath ? path.resolve(options.inventoryPath) : null,
      markdownRoots: (options.markdownRoots || []).map((root) => path.resolve(root)),
    },
    // `items` is exactly a POST /v1/chat/import/preview body: §4.3 fixes those
    // field names, so everything this tool knows beyond the contract — where the
    // bytes came from, which message ids the server will mint — travels beside
    // it instead of inside it, and no reader has to guess which extra keys a
    // strict validator would reject.
    items: raw.map(toContractItem),
    provenance,
    dedupe: {
      algorithm: 'sha256(sourceKey + "|" + role + "|" + at + "|" + text).slice(0, 32)',
      messageIdPrefix: "m-imp-",
      duplicateMessages,
      keys: dedupe,
    },
    skipped: fromBackup.skipped.concat(markdown.skipped),
    unparsed: fromBackup.unparsed.concat(markdown.unparsed),
    counts: {
      items: raw.length,
      messages: dedupe.length,
      duplicateMessages,
      skipped: fromBackup.skipped.length + markdown.skipped.length,
      unparsed: fromBackup.unparsed.length + markdown.unparsed.length,
      sources: {
        leveldb: fromBackup.items.length,
        markdown: markdown.items.length,
      },
    },
  };
}

/** §4.3, and nothing but §4.3 — plus `payload` when §2 says there is one. */
function toContractItem(item) {
  return {
    scopeKey: item.scopeKey,
    topicId: item.topicId,
    projectId: item.projectId,
    title: item.title,
    sourceOrigin: item.sourceOrigin,
    sourcePath: item.sourcePath,
    sourceKey: item.sourceKey,
    sourceSha256: item.sourceSha256,
    messages: item.messages.map((message) => {
      const out = { role: message.role, text: message.text, at: message.at };
      if (message.payload) out.payload = message.payload;
      return out;
    }),
  };
}

function formatHuman(pkg) {
  const lines = [];
  lines.push("chat-recovery candidates  " + pkg.generatedAt);
  lines.push("backup  : " + (pkg.sources.backupDir || "-"));
  lines.push("inventory: " + (pkg.sources.inventoryPath || "-"));
  lines.push("markdown: " + (pkg.sources.markdownRoots.join(", ") || "-"));
  lines.push("");
  lines.push(
    "items " + pkg.counts.items + " (leveldb " + pkg.counts.sources.leveldb + ", markdown " + pkg.counts.sources.markdown + ")" +
      "  messages " + pkg.counts.messages + "  duplicate-of-another-item " + pkg.counts.duplicateMessages,
  );
  for (const item of pkg.items) {
    const times = item.messages.map((m) => m.at).filter(Boolean).sort();
    lines.push("");
    lines.push("  " + item.title);
    lines.push("    scopeKey   " + item.scopeKey + "   topicId " + item.topicId + "   projectId " + (item.projectId || "-"));
    lines.push("    source     " + [item.sourceKind, item.sourceOrigin, item.sourcePath].filter(Boolean).join("  "));
    lines.push("    sourceKey  " + item.sourceKey);
    lines.push("    sha256     " + item.sourceSha256);
    lines.push("    messages   " + item.messages.length + "   first " + (times[0] || "unknown") + "   last " + (times[times.length - 1] || "unknown"));
    const roles = {};
    for (const m of item.messages) roles[m.role] = (roles[m.role] || 0) + 1;
    lines.push("    roles      " + JSON.stringify(roles));
    if (item.messages[0]) lines.push("    head       " + JSON.stringify(item.messages[0].text).slice(0, 100));
  }
  lines.push("");
  lines.push("skipped (" + pkg.skipped.length + ")");
  for (const s of pkg.skipped) lines.push("  " + s.sourceKey + "[" + s.index + "]  " + s.reason + " :: " + s.detail);
  if (!pkg.skipped.length) lines.push("  none");
  lines.push("");
  lines.push("unparsed (" + pkg.unparsed.length + ")");
  for (const u of pkg.unparsed) lines.push("  " + u.file + (u.byteStart === null ? "" : " bytes " + u.byteStart + ".." + u.byteEnd) + "  " + u.reason + " :: " + u.detail);
  if (!pkg.unparsed.length) lines.push("  none");
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { json: false, markdownRoots: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--backup") options.backup = argv[++i];
    else if (arg === "--inventory") options.inventoryPath = argv[++i];
    else if (arg === "--vault") options.vault = argv[++i];
    else if (arg === "--markdown") options.markdownRoots.push(argv[++i]);
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("unknown argument: " + arg);
  }
  return options;
}

const HELP =
  "node tools/chat-recovery/convert.js (--backup <dir> | --inventory <json>) [--vault <root> | --markdown <dir>]... [--out <file>] [--json]\n" +
  "\n" +
  "  Emits scholarium-chat/1 import candidates. Reads only; never writes to the\n" +
  "  vault, the backup, or localStorage.\n" +
  "\n" +
  "  --backup <dir>     an inventory.js backup to re-read for full bodies\n" +
  "  --inventory <json> a previous inventory report (needs --values for bodies)\n" +
  "  --vault <root>     shorthand for <root>/Experiments/Projects\n" +
  "  --markdown <dir>   a directory to search directly\n" +
  "\n" +
  "  Only notes inside a `" + CHAT_DIR_NAME + "` directory are read, so a project's\n" +
  "  experiment records are neither parsed nor reported as failures.\n" +
  "  Output: `items` is exactly a POST /v1/chat/import/preview body; provenance\n" +
  "  and the dedupe keys travel beside it in `provenance` and `dedupe`.\n";

/** `deps` mirrors inventory.main's seam so tests can drive this command line. */
function main(argv = process.argv.slice(2), deps = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    process.stderr.write(e.message + "\n");
    process.exitCode = 3;
    return;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!options.backup && !options.inventoryPath) {
    process.stderr.write("one of --backup or --inventory is required (see --help)\n");
    process.exitCode = 3;
    return;
  }
  const markdownRoots = options.markdownRoots.slice();
  let toRelative = (p) => p.split(path.sep).join("/");
  if (options.vault) {
    const vault = path.resolve(options.vault);
    markdownRoots.push(path.join(vault, "Experiments", "Projects"));
    toRelative = (p) => path.relative(vault, p).split(path.sep).join("/");
  }
  let pkg;
  try {
    const input = { backup: options.backup, markdownRoots, toRelative, inventoryPath: options.inventoryPath };
    if (options.inventoryPath) input.inventoryReport = JSON.parse(fs.readFileSync(options.inventoryPath, "utf8"));
    pkg = buildPackage(input);
  } catch (e) {
    process.stderr.write("FAILED: " + e.message + "\n");
    process.exitCode = 4;
    return;
  }
  if (options.out) {
    writeJsonFile(options.out, pkg);
    process.stderr.write("wrote " + path.resolve(options.out) + "  " + JSON.stringify(pkg.counts) + "\n");
  }
  process.stdout.write((options.json ? JSON.stringify(pkg, null, 2) : options.out ? formatHuman(pkg) : formatHuman(pkg)) + "\n");
}

if (require.main === module) main();

module.exports = {
  buildPackage,
  main,
  toContractItem,
  itemsFromBackup,
  itemsFromInventoryJson,
  itemsFromMarkdown,
  messagesFromStored,
  messagesFromSessionData,
  fallbackFromHeadings,
  parseFrontmatter,
  sections,
  roleForHeading,
  topicIdFromChatKey,
  scopeFor,
  dedupeKey,
  messageIdFor,
  formatHuman,
  parseArgs,
  walkMarkdown,
  ROLES,
  MARKDOWN_TYPES,
  CHAT_DIR_NAME,
};
