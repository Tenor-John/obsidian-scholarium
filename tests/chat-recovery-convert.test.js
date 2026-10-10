"use strict";
/**
 * Agent R recovery tooling, layer 2: turning recovered history into
 * `scholarium-chat/1` import candidates.
 *
 * The LevelDB fixture builders come from the layer-1 suite so both layers are
 * exercised against the same bytes. Nothing here reads `%APPDATA%`, a real
 * vault, or a real LevelDB; the Markdown fixtures are synthetic notes that copy
 * the frontmatter and heading shape of the ones under
 * `Experiments/Projects/<id>/03_织研者对话/` in this vault.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { describe, it, assert } = require("./harness");
const I = require("../tools/chat-recovery/inventory");
const C = require("../tools/chat-recovery/convert");
const F = require("./chat-recovery-inventory.test");

const PROBE = F.POLICY_PROBE;
const ROLE_PATTERN = /^m-[a-z0-9-]{6,40}$/;

/* ------------------------------------------------------------------ */
/* markdown fixtures                                                   */
/* ------------------------------------------------------------------ */

function theoryTurnNote() {
  return [
    "---",
    "type: research-theory-turn",
    'project_id: "PRJ-001"',
    'design_id: "unassigned"',
    'created_at: "2026-07-24T13:19:08.813Z"',
    "source: research-deduction-room",
    "---",
    "",
    "# 织研者对话",
    "",
    "## 研究员",
    "",
    "请判断这个方向是否值得继续。",
    "",
    "## 织研者主 Agent",
    "",
    "```json",
    '{"status":"revise","summary":"还不能判断"}',
    "```",
    "",
  ].join("\n");
}

function sessionNote() {
  return [
    "---",
    "type: zhiyanzhe-session",
    'project_id: "PRJ-001"',
    'design_id: "unassigned"',
    'session_id: "SES-20260803130851"',
    'title: "旧会话标题"',
    "turns: 3",
    'updated_at: "2026-08-04T09:04:07.738Z"',
    "source: research-deduction-room",
    "---",
    "",
    "# 织研者对话：旧会话标题",
    "",
    "> 保存于 2026-08-04 09:04",
    "",
    "### 你",
    "",
    "第一轮提问",
    "",
    "### 文献检索工具",
    "",
    '- 检索式："x"',
    "",
    "### 织研者主 Agent",
    "",
    "回答内容",
    "",
    "<!--ZHIYANZHE-SESSION-DATA",
    '[{"role":"researcher","content":"第一轮提问"},{"role":"evidence","content":{"query":"x","hit_count":3}},{"role":"agent","content":"回答内容"}]',
    "-->",
    "",
  ].join("\n");
}

function brokenSessionNote() {
  return sessionNote()
    .replace('[{"role":"researcher"', '[[{"role":"researcher"')
    .replace("SES-20260803130851", "SES-20260803130899");
}

/** A chat folder plus notes that must stay out of scope. */
function makeVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-chat-md-"));
  const chatDir = path.join(root, "Experiments", "Projects", "PRJ-001", "03_织研者对话", "unassigned");
  fs.mkdirSync(chatDir, { recursive: true });
  fs.writeFileSync(path.join(chatDir, "2026-07-24T13-19-08-813Z.md"), theoryTurnNote(), "utf8");
  fs.writeFileSync(path.join(chatDir, "SES-20260803130851.md"), sessionNote(), "utf8");
  fs.writeFileSync(path.join(chatDir, "SES-broken.md"), brokenSessionNote(), "utf8");
  fs.writeFileSync(path.join(chatDir, "notes.md"), "---\ntype: something-else\n---\n\n# Not a conversation\n", "utf8");
  // Outside any 03_织研者对话 directory: must never be scanned or reported.
  const projectDir = path.join(root, "Experiments", "Projects", "PRJ-001");
  fs.writeFileSync(path.join(projectDir, "01_完整课题内容.md"), "---\ntype: research-theory-turn\nproject_id: \"PRJ-001\"\n---\n\n## 研究员\n\n这个不属于对话目录。\n", "utf8");
  return { root, projects: path.join(root, "Experiments", "Projects") };
}

function toRelativeFrom(root) {
  return (p) => path.relative(root, p).split(path.sep).join("/");
}

/* ------------------------------------------------------------------ */

describe("chat recovery convert: dedupe keys", () => {
  it("matches the contract formula and yields a legal message id", () => {
    const key = C.dedupeKey("weaver.shell.chat.default", "user", "2026-07-24T13:19:08.813Z", "你好");
    const expected = crypto
      .createHash("sha256")
      .update('weaver.shell.chat.default|user|2026-07-24T13:19:08.813Z|你好', "utf8")
      .digest("hex")
      .slice(0, 32);
    assert.eq(key, expected);
    assert.eq(key.length, 32);
    assert.match(C.messageIdFor("k", "user", "at", "t"), ROLE_PATTERN);
  });

  it("stays stable when the timestamp is missing", () => {
    assert.eq(C.dedupeKey("k", "user", null, "t"), C.dedupeKey("k", "user", undefined, "t"));
    assert.eq(C.dedupeKey("k", "user", null, "t").length, 32);
  });

  it("separates messages that differ in any one field", () => {
    const base = C.dedupeKey("k", "user", "at", "text");
    assert.notOk(base === C.dedupeKey("k2", "user", "at", "text"));
    assert.notOk(base === C.dedupeKey("k", "agent", "at", "text"));
    assert.notOk(base === C.dedupeKey("k", "user", "at2", "text"));
    assert.notOk(base === C.dedupeKey("k", "user", "at", "text2"));
  });
});

describe("chat recovery convert: stored bodies", () => {
  it("accepts the shell's {role,text,at} array and keeps unknown fields as payload", () => {
    const stored = JSON.stringify([
      { role: "user", text: "问", at: "2026-01-01T00:00:00.000Z" },
      { role: "agent", text: "答", at: "2026-01-01T00:00:01.000Z", confirmationStates: { a: 1 } },
    ]);
    const out = C.messagesFromStored(stored, { key: "k", file: "f.log" });
    assert.eq(out.accepted.length, 2);
    assert.deepEq(out.accepted[0], { role: "user", text: "问", at: "2026-01-01T00:00:00.000Z", payload: null });
    assert.deepEq(out.accepted[1].payload, { confirmationStates: { a: 1 } });
    assert.eq(out.skipped.length, 0);
    assert.eq(out.unparsed.length, 0);
  });

  it("reports a role the contract forbids instead of coercing it", () => {
    const stored = JSON.stringify([{ role: "tool", text: "x", at: "2026-01-01T00:00:00.000Z" }]);
    const out = C.messagesFromStored(stored, { key: "k", file: "f.log" });
    assert.eq(out.accepted.length, 0);
    assert.eq(out.skipped.length, 1);
    assert.eq(out.skipped[0].reason, "unsupported role");
    assert.eq(out.skipped[0].detail, "tool");
    assert.eq(out.skipped[0].text, "x", "the text is kept so nothing is lost with the skip");
  });

  it("keeps every accepted role the shell already writes", () => {
    const stored = JSON.stringify(["user", "agent", "system", "error"].map((role) => ({ role, text: role, at: "2026-01-01T00:00:00.000Z" })));
    const out = C.messagesFromStored(stored, { key: "k", file: "f.log" });
    assert.deepEq(out.accepted.map((m) => m.role), ["user", "agent", "system", "error"]);
  });

  it("accounts for empty, non-array and malformed bodies", () => {
    const empty = C.messagesFromStored("[]", { key: "k", file: "f.log" });
    assert.eq(empty.accepted.length, 0);
    assert.eq(empty.skipped[0].reason, "stored value holds no messages");
    const object = C.messagesFromStored('{"default":"s-abcd1234-deadbeef"}', { key: "k", file: "f.log" });
    assert.eq(object.skipped[0].reason, "stored value is not an array of messages");
    const broken = C.messagesFromStored("[{", { key: "k", file: "f.log" });
    assert.eq(broken.unparsed.length, 1);
    assert.eq(broken.unparsed[0].reason, "stored value is not JSON");
  });

  it("reports a message with no usable text", () => {
    const stored = JSON.stringify([{ role: "user", at: "2026-01-01T00:00:00.000Z" }, { role: "user", text: 7, at: "x" }]);
    const out = C.messagesFromStored(stored, { key: "k", file: "f.log" });
    assert.eq(out.accepted.length, 0);
    assert.eq(out.skipped.length, 2);
    assert.eq(out.skipped.every((s) => s.reason === "message has no string text"), true);
  });
});

describe("chat recovery convert: markdown shape", () => {
  it("reads frontmatter values with and without quotes", () => {
    const front = C.parseFrontmatter('---\ntype: research-theory-turn\nproject_id: "PRJ-001"\nturns: 12\n---\n\nbody\n');
    assert.eq(front.present, true);
    assert.eq(front.data.type, "research-theory-turn");
    assert.eq(front.data.project_id, "PRJ-001");
    assert.eq(front.data.turns, "12");
    assert.eq(front.body.trim(), "body");
  });

  it("keeps mixed H2/H3 sections in document order", () => {
    const body = ["## 一", "", "a", "", "### 二", "", "b", "", "## 三", "", "c"].join("\n");
    const found = C.sections(body);
    assert.deepEq(found.map((s) => s.heading), ["一", "二", "三"]);
    assert.deepEq(found.map((s) => s.level), [2, 3, 2]);
    assert.deepEq(found.map((s) => s.text), ["a", "b", "c"]);
  });

  it("maps the speaker headings the deduction room actually writes", () => {
    assert.eq(C.roleForHeading("研究员"), "user");
    assert.eq(C.roleForHeading("你"), "user");
    assert.eq(C.roleForHeading("织研者主 Agent"), "agent");
    assert.eq(C.roleForHeading("织研者 · 普通对话"), "agent");
    assert.eq(C.roleForHeading("文献检索工具"), "system");
  });
});

describe("chat recovery convert: sources", () => {
  it("carries origin, key and hash for a LevelDB body", () => {
    const fixture = F.makeLeveldb();
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const items = C.itemsFromBackup(fixture.backup);
    const byKey = Object.fromEntries(items.items.map((item) => [item.sourceKey, item]));
    assert.deepEq(Object.keys(byKey).sort(), [
      "weaver.shell.chat.default",
      "weaver.shell.chat.from-table",
      "weaver.shell.chat.huge",
      "weaver.shell.chat.legacy-archived",
    ]);
    const item = byKey["weaver.shell.chat.default"];
    assert.eq(item.sourceOrigin, F.ORIGIN_A);
    assert.eq(item.sourcePath, null);
    assert.eq(item.scopeKey, "topic:default");
    assert.eq(item.projectId, null);
    const stored = report.chatEntries.find((e) => e.key === "weaver.shell.chat.default");
    assert.eq(item.sourceSha256, stored.valueSha256, "the candidate must name the bytes it came from");
    assert.eq(I.sha256(Buffer.from(JSON.stringify(fixture.defaultMessages), "utf8")), item.sourceSha256);
    assert.deepEq(item.messages, fixture.defaultMessages.map((m) => ({ ...m, payload: null })));
  });

  it("skips the session pointer and the deleted key, with reasons", () => {
    const fixture = F.makeLeveldb();
    I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const out = C.itemsFromBackup(fixture.backup);
    const reasons = Object.fromEntries(out.skipped.map((s) => [s.sourceKey, s.reason]));
    assert.eq(reasons["weaver.shell.chat.activeSessionId"], "pointer key, not a conversation body");
    assert.eq(reasons["weaver.shell.chat.removed"], "key was deleted with no surviving value");
    assert.eq(reasons["weaver.shell.chat.empty"], "stored value holds no messages");
    assert.notOk(out.items.some((item) => item.sourceKey.endsWith("activeSessionId")));
  });

  it("prefers the session data block over the rendered headings", () => {
    const vault = makeVault();
    const out = C.itemsFromMarkdown([vault.projects], { toRelative: toRelativeFrom(vault.root) });
    const session = out.items.find((item) => item.sourceKey.includes("SES-20260803130851"));
    assert.ok(session, "the session note must produce a candidate");
    assert.eq(session.projectId, "PRJ-001");
    assert.eq(session.scopeKey, "project:PRJ-001");
    assert.eq(session.title, "旧会话标题");
    assert.eq(session.sourceSessionId, "SES-20260803130851");
    assert.eq(session.messages.length, 3);
    assert.deepEq(session.messages.map((m) => m.role), ["user", "system", "agent"]);
    assert.eq(session.messages[0].text, "第一轮提问");
    assert.eq(session.messages[0].at, "2026-08-04T09:04:07.738Z");
    assert.eq(session.messages[0].atSource, "frontmatter.updated_at");
    // The evidence turn's object survives whole, as §2 requires.
    assert.deepEq(session.messages[1].payload, { query: "x", hit_count: 3 });
    assert.eq(JSON.parse(session.messages[1].text).hit_count, 3);
    assert.eq(session.sourceSha256, I.sha256(fs.readFileSync(path.join(vault.root, session.sourcePath))));
  });

  it("reads a research-theory-turn note and keeps its JSON block verbatim", () => {
    const vault = makeVault();
    const out = C.itemsFromMarkdown([vault.projects], { toRelative: toRelativeFrom(vault.root) });
    const turn = out.items.find((item) => item.sourceKey.endsWith("2026-07-24T13-19-08-813Z.md"));
    assert.ok(turn, "the theory-turn note must produce a candidate");
    assert.eq(turn.sourceKind, "research-theory-turn");
    assert.deepEq(turn.messages.map((m) => m.role), ["user", "agent"]);
    assert.match(turn.messages[1].text, /"status":"revise"/);
    assert.match(turn.messages[1].text, /```json/);
    assert.eq(turn.messages[0].at, "2026-07-24T13:19:08.813Z");
  });

  it("falls back to headings for a broken session block and says so", () => {
    const vault = makeVault();
    const out = C.itemsFromMarkdown([vault.projects], { toRelative: toRelativeFrom(vault.root) });
    const broken = out.items.find((item) => item.sourceKey.includes("SES-broken"));
    assert.ok(broken, "the note must still be recoverable through its headings");
    assert.eq(broken.messages.length, 3);
    assert.eq(broken.messages[0].role, "user");
    assert.ok(
      out.unparsed.some((u) => u.reason === "ZHIYANZHE-SESSION-DATA block is not JSON"),
      "the unreadable block must be reported, not quietly skipped",
    );
  });

  it("reports an unrecognised note inside the chat folder and ignores notes outside it", () => {
    const vault = makeVault();
    const out = C.itemsFromMarkdown([vault.projects], { toRelative: toRelativeFrom(vault.root) });
    const unknown = out.unparsed.filter((u) => u.reason === "unrecognised note type");
    assert.eq(unknown.length, 1);
    assert.match(unknown[0].file, /notes\.md$/);
    assert.notOk(out.items.some((item) => item.sourcePath.includes("01_完整课题内容")));
    assert.eq(out.unparsed.some((u) => String(u.file).includes("01_完整课题内容")), false, "a project note is out of scope, not unparsed");
  });

  it("reports a markdown root that does not exist", () => {
    const out = C.itemsFromMarkdown([path.join(os.tmpdir(), "sch-chat-md-missing-" + Date.now())]);
    assert.eq(out.items.length, 0);
    assert.eq(out.unparsed[0].reason, "markdown root does not exist");
  });
});

describe("chat recovery convert: package", () => {
  it("emits items that are exactly a preview request body", () => {
    const fixture = F.makeLeveldb();
    I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const vault = makeVault();
    const pkg = C.buildPackage({
      backup: fixture.backup,
      markdownRoots: [vault.projects],
      toRelative: toRelativeFrom(vault.root),
    });
    assert.eq(pkg.items.length > 0, true);
    for (const item of pkg.items) {
      assert.deepEq(Object.keys(item), ["scopeKey", "topicId", "projectId", "title", "sourceOrigin", "sourcePath", "sourceKey", "sourceSha256", "messages"]);
      for (const message of item.messages) {
        assert.ok(message.role === "user" || message.role === "agent" || message.role === "system" || message.role === "error");
        assert.eq(typeof message.text, "string");
        assert.ok(message.at === null || typeof message.at === "string");
        assert.notOk("messageId" in message, "§4.3 preview messages are role/text/at; the server mints the id");
        assert.notOk("payload" in message && message.payload === null, "a null payload is omitted, an object one is kept");
      }
      assert.eq(JSON.parse(JSON.stringify({ items: [item] })).items[0].sourceKey, item.sourceKey);
    }
    // Anything this tool knows beyond the contract travels beside it.
    assert.eq(pkg.provenance.length, pkg.items.length);
    assert.eq(pkg.provenance.some((p) => p.sourceKind === "leveldb-structured" && p.sourceFile.endsWith(".log")), true);
    assert.eq(pkg.provenance.some((p) => p.sourceSessionId === "SES-20260803130851"), true);
    assert.eq(pkg.dedupe.keys.length, pkg.counts.messages);
    assert.eq(pkg.counts.messages > 0, true);
    assert.eq(pkg.counts.items, pkg.counts.sources.leveldb + pkg.counts.sources.markdown);
  });

  it("counts duplicates rather than removing them, so preview can report both", () => {
    // The shell really can store the same turn twice (`你好` sent twice in one
    // minute), and §4.3 wants preview to say "12 messages, 1 duplicate" rather
    // than silently shrinking the history.
    const repeated = [
      { role: "user", text: "你好", at: "2026-08-03T12:30:00.000Z" },
      { role: "user", text: "你好", at: "2026-08-03T12:30:00.000Z" },
      { role: "agent", text: "你好！", at: "2026-08-03T12:30:01.000Z" },
    ];
    const entries = [{
      origin: F.ORIGIN_A,
      rawKey: Buffer.from("weaver.shell.chat.dup", "utf8"),
      value: Buffer.from(JSON.stringify(repeated), "utf8"),
      file: "000003.log",
      source: "structured",
    }];
    const pkg = C.buildPackage({ entries, markdownRoots: [] });
    assert.eq(pkg.counts.messages, 3, "no message may be dropped from the candidate");
    assert.eq(pkg.items[0].messages.length, 3);
    assert.eq(pkg.counts.duplicateMessages, 1);
    const keys = pkg.dedupe.keys.map((k) => k.key);
    assert.eq(keys[0], keys[1]);
    assert.notOk(keys[1] === keys[2]);
  });

  it("still offers the keys the server will mint", () => {
    const fixture = F.makeLeveldb();
    I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const pkg = C.buildPackage({ backup: fixture.backup, markdownRoots: [] });
    const item = pkg.items.find((i) => i.sourceKey === "weaver.shell.chat.default");
    const keys = pkg.dedupe.keys.filter((k) => k.item === item.sourceKey);
    assert.eq(keys.length, item.messages.length);
    for (const row of keys) {
      assert.match(row.messageId, ROLE_PATTERN);
      assert.eq(row.messageId, "m-imp-" + row.key);
      const message = item.messages[row.index];
      assert.eq(row.key, C.dedupeKey(item.sourceKey, message.role, message.at, message.text));
    }
  });

  it("renders a human summary naming each candidate and its provenance", () => {
    const fixture = F.makeLeveldb();
    I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const pkg = C.buildPackage({ backup: fixture.backup, markdownRoots: [] });
    const text = C.formatHuman(pkg);
    assert.match(text, /chat-recovery candidates/);
    assert.match(text, /weaver\.shell\.chat\.default/);
    assert.match(text, new RegExp(F.ORIGIN_A.replace(/[.:]/g, "\\$&")));
    assert.match(text, /sha256/);
  });
});

describe("chat recovery convert: the whole pipeline is read-only", () => {
  it("changes no byte of the source fixture or the backup it reads", () => {
    const fixture = F.makeLeveldb();
    const vault = makeVault();
    const sourceBefore = F.snapshot(fixture.dir);
    const vaultBefore = F.snapshot(vault.root);

    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const backupAfterInventory = F.snapshot(fixture.backup);

    const pkg = C.buildPackage({
      backup: fixture.backup,
      inventoryPath: null,
      markdownRoots: [vault.projects],
      toRelative: toRelativeFrom(vault.root),
    });

    assert.deepEq(F.snapshot(fixture.dir), sourceBefore, "the live LevelDB must be untouched");
    assert.deepEq(F.snapshot(fixture.backup), backupAfterInventory, "convert must not write to the backup");
    assert.deepEq(F.snapshot(vault.root), vaultBefore, "no markdown note may be modified");
    // The fixture deletes one chat key, so its bytes are followed by the next
    // record and the raw scan cannot bound a body for it. That single row is the
    // expected shape; the arithmetic below is what proves nothing was dropped.
    assert.eq(report.counts.unparsed, 1);
    assert.match(report.unparsed[0].reason, /bracket-balanced/);
    assert.eq(report.unparsed[0].file, "000003.log");

    // Every candidate names bytes that are still present, with the same hash.
    for (const item of pkg.items) {
      assert.eq(item.sourceSha256.length, 64);
      assert.ok(item.messages.length > 0);
      assert.eq(item.messages.length, pkg.provenance.find((p) => p.sourceKey === item.sourceKey).messageCount);
    }

    // candidates = what the sources held; every `weaver.shell.chat*` entry in
    // the inventory is either an item or a recorded skip, so the arithmetic the
    // recovery report promises closes. This counts every such entry, including
    // the session pointer, because that is the population the inventory saw.
    const leveldbKeys = report.entries.filter((e) => e.key.startsWith(I.CHAT_KEY_PREFIX)).length;
    const accounted = pkg.items.filter((i) => i.sourceKey.startsWith(I.CHAT_KEY_PREFIX)).length;
    const skippedKeys = new Set(pkg.skipped.filter((s) => String(s.sourceKey).startsWith(I.CHAT_KEY_PREFIX)).map((s) => s.sourceKey));
    assert.eq(accounted + skippedKeys.size, leveldbKeys, "every chat key must be an item or an explicit skip");
    assert.eq(leveldbKeys, 7);
  });

  it("refuses an inventory report that has no full values rather than inventing them", () => {
    const fixture = F.makeLeveldb();
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    let error = null;
    try {
      C.itemsFromInventoryJson(report);
    } catch (e) {
      error = e;
    }
    assert.match(error.message, /--values/);
    const withValues = I.inventory({ leveldb: fixture.dir, backup: path.join(fixture.root, "backup-values"), includeValues: true, ...PROBE });
    const items = C.itemsFromInventoryJson(withValues);
    assert.eq(items.items.length > 0, true);
    assert.eq(items.items.every((item) => item.sourceSha256.length === 64), true);
  });
});

describe("chat recovery convert: CLI", () => {
  it("prints usage and exits 0 for --help", () => {
    const result = F.runCli(C.main, ["--help"]);
    assert.eq(result.code, 0);
    assert.match(result.out, /--backup/);
    assert.match(result.out, /import\/preview/);
    assert.match(result.out, /03_织研者对话/);
  });

  it("exits 3 without a source and on an unknown argument", () => {
    assert.eq(F.runCli(C.main, []).code, 3);
    assert.eq(F.runCli(C.main, ["--nope"]).code, 3);
  });

  it("writes a package whose items are a preview body, and prints a summary", () => {
    const fixture = F.makeLeveldb();
    I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const vault = makeVault();
    const out = path.join(fixture.root, "candidates.json");
    const result = F.runCli(C.main, ["--backup", fixture.backup, "--vault", vault.root, "--out", out, "--json"]);
    assert.eq(result.code, 0, result.err);
    const pkg = JSON.parse(result.out);
    assert.deepEq(pkg, JSON.parse(fs.readFileSync(out, "utf8")));
    assert.eq(pkg.counts.sources.markdown, 3, "three readable notes, the broken one recovering via headings");
    assert.eq(pkg.items.length, pkg.provenance.length);
    assert.eq(pkg.items.every((i) => i.messages.length > 0), true);
  });

  it("prints a human summary when --json is absent", () => {
    const fixture = F.makeLeveldb();
    I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...PROBE });
    const result = F.runCli(C.main, ["--backup", fixture.backup]);
    assert.eq(result.code, 0, result.err);
    assert.match(result.out, /chat-recovery candidates/);
    assert.match(result.out, /weaver\.shell\.chat\.default/);
    assert.match(result.out, /duplicate/);
  });

  it("exits 4 on a backup directory that is not there", () => {
    const result = F.runCli(C.main, ["--backup", path.join(os.tmpdir(), "sch-chat-missing-" + Date.now())]);
    assert.eq(result.code, 4);
    assert.match(result.err, /FAILED/);
  });
});

module.exports = { makeVault, theoryTurnNote, sessionNote, brokenSessionNote, toRelativeFrom };
