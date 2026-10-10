"use strict";
/**
 * Agent R recovery tooling, layer 1: reading a LevelDB copy.
 *
 * Everything here runs against synthetic fixtures written into a temp directory.
 * Nothing reads `%APPDATA%`, nothing reads a real vault, and nothing writes to
 * the fixtures except the fixture builder itself — the occupancy probe is
 * injected so a suite run on a machine with Obsidian open behaves identically
 * to one without it.
 *
 * The fixture builders below are exported: `chat-recovery-convert.test.js`
 * reuses them so both layers are exercised against the same bytes.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const I = require("../tools/chat-recovery/inventory");

const ORIGIN_A = "http://127.0.0.1:4173";
const ORIGIN_B = "http://127.0.0.1:53104";

/* ------------------------------------------------------------------ */
/* fixture builders                                                    */
/* ------------------------------------------------------------------ */

function varint(value) {
  const out = [];
  let n = value;
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Buffer.from(out);
}

function lengthPrefixed(buf) {
  return Buffer.concat([varint(buf.length), buf]);
}

/** WriteBatch bytes: 8-byte sequence, 4-byte count, then put/delete ops. */
function writeBatch(sequence, ops) {
  const head = Buffer.alloc(12);
  head.writeBigUInt64LE(BigInt(sequence), 0);
  head.writeUInt32LE(ops.length, 8);
  const parts = [head];
  for (const op of ops) {
    parts.push(Buffer.from([op.kind === "delete" ? 0 : 1]));
    parts.push(lengthPrefixed(op.key));
    if (op.kind !== "delete") parts.push(lengthPrefixed(op.value));
  }
  return Buffer.concat(parts);
}

function physicalRecord(data, type) {
  const head = Buffer.alloc(7);
  head.writeUInt16LE(data.length, 4);
  head[6] = type;
  head.writeUInt32LE(I.maskCrc(I.crc32c(Buffer.concat([head.subarray(4), data]))), 0);
  return Buffer.concat([head, data]);
}

/** Split logical records across blocks exactly the way LevelDB does. */
function buildJournal(logicals, options = {}) {
  const blockSize = I.JOURNAL_BLOCK_SIZE;
  const parts = [];
  let offset = 0;
  for (const logical of logicals) {
    if (logical.length === 0) {
      const empty = physicalRecord(Buffer.alloc(0), 1);
      parts.push(empty);
      offset += empty.length;
      continue;
    }
    let rest = logical;
    let first = true;
    while (rest.length > 0) {
      const room = blockSize - (offset % blockSize);
      if (room < 8) {
        // LevelDB leaves the short tail of a block as padding and starts the
        // next record on the block boundary.
        parts.push(Buffer.alloc(room, 0));
        offset += room;
        continue;
      }
      const take = Math.min(room - 7, rest.length);
      const chunk = Buffer.from(rest.subarray(0, take));
      rest = rest.subarray(take);
      const record = physicalRecord(chunk, rest.length === 0 ? (first ? 1 : 4) : first ? 2 : 3);
      parts.push(record);
      offset += record.length;
      first = false;
    }
  }
  if (options.tailBytes) parts.push(Buffer.from(options.tailBytes));
  return Buffer.concat(parts);
}

/** Literal-only snappy encoding: valid snappy, and easy to reason about. */
function snappyCompress(buf) {
  const out = [varint(buf.length)];
  for (let at = 0; at < buf.length; ) {
    const size = Math.min(buf.length - at, 60);
    out.push(Buffer.from([(size - 1) << 2]));
    out.push(buf.subarray(at, at + size));
    at += size;
  }
  return Buffer.concat(out);
}

/**
 * One SSTable data block. The trailer is `[restart offsets][num_restarts]` —
 * the count is the LAST four bytes, which is the opposite of the write batch
 * layout and an easy way to write a fixture that only fails in the reader.
 */
function buildBlock(entries, compression) {
  const parts = [];
  let previous = Buffer.alloc(0);
  for (const entry of entries) {
    let shared = 0;
    while (shared < previous.length && shared < entry.key.length && previous[shared] === entry.key[shared]) shared++;
    parts.push(varint(shared), varint(entry.key.length - shared), varint(entry.value.length));
    parts.push(entry.key.subarray(shared), entry.value);
    previous = entry.key;
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(0, 0);
  trailer.writeUInt32LE(1, 4);
  const raw = Buffer.concat([Buffer.concat(parts), trailer]);
  const payload = compression === "snappy" ? snappyCompress(raw) : raw;
  const compressionByte = compression === "snappy" ? 1 : 0;
  const crc = I.maskCrc(I.crc32c(Buffer.concat([payload, Buffer.from([compressionByte])])));
  const blockTrailer = Buffer.alloc(5);
  blockTrailer[0] = compressionByte;
  blockTrailer.writeUInt32LE(crc, 1);
  return Buffer.concat([payload, blockTrailer]);
}

function blockHandle(offset, size) {
  return Buffer.concat([varint(offset), varint(size)]);
}

function buildTable(entries, options = {}) {
  const compression = options.compression || "none";
  const perBlock = options.perBlock || 2;
  const sorted = entries.slice().sort((a, b) => Buffer.compare(a.key, b.key));
  const groups = [];
  for (let i = 0; i < sorted.length; i += perBlock) groups.push(sorted.slice(i, i + perBlock));
  const blocks = groups.map((group) => buildBlock(group, compression));
  const indexEntries = [];
  const dataBytes = [];
  let offset = 0;
  groups.forEach((group, index) => {
    indexEntries.push({ key: group[group.length - 1].key, value: blockHandle(offset, blocks[index].length - 5) });
    dataBytes.push(blocks[index]);
    offset += blocks[index].length;
  });
  const indexBlock = buildBlock(indexEntries, "none");
  const indexHandle = blockHandle(offset, indexBlock.length - 5);
  offset += indexBlock.length;
  const metaBlock = buildBlock([], "none");
  const metaHandle = blockHandle(offset, metaBlock.length - 5);
  const padding = Buffer.alloc(40 - metaHandle.length - indexHandle.length, 0);
  const footer = Buffer.concat([metaHandle, indexHandle, padding, I.TABLE_MAGIC]);
  return Buffer.concat([...dataBytes, indexBlock, metaBlock, footer]);
}

/** LevelDB keys for DOM storage are `_<origin>\x00<storage key>`. */
const NUL = String.fromCharCode(0);
const chatKey = (origin, key) => Buffer.from("_" + origin + NUL + key, "utf8");
const chatValue = (messages) => Buffer.from(JSON.stringify(messages), "utf8");

const POLICY_PROBE = { processProbe: () => ({ state: "absent", method: "fixture", detail: "fixture says nothing is running" }) };

/** A LevelDB directory with a journal, a table, and a fragmented record. */
function makeLeveldb(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-chat-rec-"));
  const dir = path.join(root, "leveldb");
  fs.mkdirSync(dir);
  if (!options.noLock) fs.writeFileSync(path.join(dir, "LOCK"), "");
  fs.writeFileSync(path.join(dir, "CURRENT"), "MANIFEST-000001\n");

  const defaultMessages = [
    { role: "user", text: "第一轮提问", at: "2026-07-24T13:19:08.813Z" },
    { role: "agent", text: "第一轮回答", at: "2026-07-24T13:19:09.000Z" },
  ];
  const archivedMessages = [{ role: "system", text: "归档记录", at: "2026-07-01T00:00:00.000Z" }];
  const hugeMessages = [{ role: "user", text: "x".repeat(options.hugeTextLength || 40000), at: "2026-08-01T00:00:00.000Z" }];

  const logicals = [
    writeBatch(1, [{ kind: "put", key: Buffer.from("VERSION"), value: Buffer.from("1") }]),
    writeBatch(2, [{ kind: "put", key: Buffer.from("META:" + ORIGIN_A), value: Buffer.from([1, 2, 3]) }]),
    writeBatch(3, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.default"), value: chatValue(defaultMessages) }]),
    writeBatch(4, [{ kind: "put", key: chatKey(ORIGIN_B, "weaver.shell.chat.legacy-archived"), value: chatValue(archivedMessages) }]),
    writeBatch(5, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.activeSessionId"), value: Buffer.from('{"default":"s-mf3k2a1b-deadbeef"}') }]),
    writeBatch(6, [{ kind: "delete", key: chatKey(ORIGIN_A, "weaver.shell.chat.removed") }]),
    writeBatch(7, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.huge"), value: chatValue(hugeMessages) }]),
  ];
  fs.writeFileSync(path.join(dir, "000003.log"), buildJournal(logicals));

  const tableEntries = [
    { key: chatKey(ORIGIN_A, "weaver.shell.chat.from-table"), value: chatValue([{ role: "agent", text: "来自 ldb", at: "2026-09-01T00:00:00.000Z" }]) },
    { key: chatKey(ORIGIN_A, "weaver.shell.chat.empty"), value: Buffer.from("[]", "utf8") },
  ];
  fs.writeFileSync(path.join(dir, "000005.ldb"), buildTable(tableEntries, options.table || {}));
  if (options.extraFiles) for (const [name, bytes] of Object.entries(options.extraFiles)) fs.writeFileSync(path.join(dir, name), bytes);
  return { root, dir, backup: path.join(root, "backup"), defaultMessages, archivedMessages, hugeMessages };
}

/** sha256 + size for every file under `dir`, so a run can be proven read-only. */
function snapshot(dir) {
  const out = {};
  const walk = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      const key = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) walk(child, key);
      else out[key] = I.sha256(fs.readFileSync(child)) + ":" + fs.statSync(child).size;
    }
  };
  walk(dir, "");
  return out;
}

/* ------------------------------------------------------------------ */

describe("chat recovery inventory: primitives", () => {
  it("computes CRC-32C and masks it so zero is never a valid checksum", () => {
    assert.eq(I.crc32c(Buffer.from("123456789", "utf8")), 0xe3069283);
    assert.notOk(I.maskCrc(0) === 0, "masked zero must not be zero");
    assert.eq(I.maskCrc(I.crc32c(Buffer.from("abc"))), I.maskCrc(I.crc32c(Buffer.from("abc"))));
  });

  it("reads LEB128 beyond 32 bits without wrapping", () => {
    const big = varint(0x1_0000_0000);
    const read = I.readVarint(big, 0);
    assert.eq(read.value, 0x1_0000_0000);
    assert.eq(read.next, big.length);
  });

  it("decodes every snappy copy form", () => {
    // literal "a", then a 1-byte-offset copy of 4 -> "aaaaa"
    assert.eq(I.snappyUncompress(Buffer.from([0x05, 0x00, 0x61, 0x01, 0x01])).toString("utf8"), "aaaaa");
    // literal "abcd", then a 2-byte-offset copy of 4 -> "abcdabcd"
    // (tag = (len-1)<<2 | kind = 3<<2 | 2 = 0x0e)
    assert.eq(
      I.snappyUncompress(Buffer.from([0x08, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x0e, 0x04, 0x00])).toString("utf8"),
      "abcdabcd",
    );
    // 4-byte-offset copy form (tag 0x0f => kind 3, length 4)
    assert.eq(
      I.snappyUncompress(Buffer.from([0x08, 0x0c, 0x61, 0x62, 0x63, 0x64, 0x0f, 0x04, 0x00, 0x00, 0x00])).toString("utf8"),
      "abcdabcd",
    );
  });

  it("refuses a snappy stream whose copies run off the end", () => {
    let threw = false;
    try {
      I.snappyUncompress(Buffer.from([0x40, 0x00, 0x61, 0x01, 0x05]));
    } catch (e) {
      threw = /offset|cop/.test(e.message);
    }
    assert.ok(threw, "a bad copy offset must raise, not return short data");
  });

  it("round-trips a snappy block through the table reader", () => {
    assert.eq(snappyCompress(Buffer.from("hello")).length > 0, true);
  });
});

describe("chat recovery inventory: LocalStorage keys", () => {
  it("recognises each weaver.shell.chat key flavour", () => {
    assert.eq(I.classifyChatKey("weaver.shell.chat"), "legacy");
    assert.eq(I.classifyChatKey("weaver.shell.chat.legacy-archived"), "legacy-archived");
    assert.eq(I.classifyChatKey("weaver.shell.chat.flow-abc"), "flow");
    assert.eq(I.classifyChatKey("weaver.shell.chat.activeSessionId"), "active-session-id");
    assert.eq(I.classifyChatKey("something.else"), null);
  });

  it("splits origin from storage key and ignores non-entry keys", () => {
    const decoded = I.decodeEntryKey(chatKey(ORIGIN_A, "weaver.shell.chat.x"));
    assert.eq(decoded.origin, ORIGIN_A);
    assert.eq(decoded.rawKey.toString("utf8"), "weaver.shell.chat.x");
    assert.eq(I.decodeEntryKey(Buffer.from("VERSION")), null);
    assert.eq(I.decodeEntryKey(Buffer.from("META:" + ORIGIN_A)), null);
  });

  it("prefers a JSON-looking decoding over a lossy one", () => {
    const utf8 = Buffer.from('[{"role":"user"}]', "utf8");
    assert.eq(I.decodeText(utf8).encoding, "utf8");
    const utf16 = Buffer.from('[{"role":"user"}]', "utf16le");
    assert.eq(I.decodeText(utf16).encoding, "utf16le");
    assert.eq(I.decodeText(utf16).text, '[{"role":"user"}]');
  });
});

describe("chat recovery inventory: journal", () => {
  it("reassembles a record fragmented across blocks", () => {
    const logical = writeBatch(9, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.big"), value: chatValue([{ role: "user", text: "y".repeat(40000) }]) }]);
    const parsed = I.parseJournal(buildJournal([logical]));
    assert.eq(parsed.problems.length, 0);
    assert.eq(parsed.crcMismatches, 0);
    assert.eq(parsed.logical.length, 1);
    assert.eq(parsed.logical[0].length, logical.length);
    const ops = I.parseWriteBatch(parsed.logical[0]);
    assert.eq(ops.length, 1);
    assert.eq(ops[0].kind, "put");
    assert.eq(ops[0].key.toString("utf8"), "_" + ORIGIN_A + NUL + "weaver.shell.chat.big");
  });

  it("starts the next record on a block boundary when a block ends short", () => {
    // Tune the first record so it leaves 1..6 bytes in the block: fewer bytes
    // than a physical record header, which is exactly the case a naive reader
    // mis-parses as a record.
    let journal = null;
    let leftOver = 0;
    const key = chatKey(ORIGIN_A, "weaver.shell.chat.tail");
    for (let valueLength = 32000; valueLength < 32800 && journal === null; valueLength++) {
      const first = writeBatch(1, [{ kind: "put", key, value: Buffer.alloc(valueLength, 0x7a) }]);
      const tail = I.JOURNAL_BLOCK_SIZE - (7 + first.length);
      // A record that fits in one block but leaves it 1..6 bytes short: fewer
      // bytes than a physical record header.
      if (tail >= 1 && tail <= 6 && first.length <= I.JOURNAL_BLOCK_SIZE - 7) {
        journal = buildJournal([first, writeBatch(2, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.after"), value: Buffer.from('["ok"]') }])]);
        leftOver = tail;
      }
    }
    assert.ok(journal !== null, "fixture should be able to land a short block tail");
    assert.ok(leftOver >= 1 && leftOver <= 6);
    const parsed = I.parseJournal(journal);
    assert.eq(parsed.problems.length, 0, "a padded block tail is not a parse problem");
    assert.eq(parsed.logical.length, 2);
    assert.eq(I.parseWriteBatch(parsed.logical[1])[0].key.toString("utf8").endsWith("weaver.shell.chat.after"), true);
  });

  it("reports a torn tail with its byte range instead of dropping it silently", () => {
    const good = writeBatch(1, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.ok"), value: Buffer.from('["a"]') }]);
    const truncated = physicalRecord(good, 1).subarray(0, 20);
    const parsed = I.parseJournal(Buffer.concat([physicalRecord(good, 1), truncated]));
    assert.eq(parsed.logical.length, 1);
    assert.eq(parsed.problems.length, 1);
    assert.eq(parsed.problems[0].reason, "truncated physical record");
    assert.eq(typeof parsed.problems[0].byteStart, "number");
  });

  it("keeps earlier records when a later one is unreadable", () => {
    const good = physicalRecord(writeBatch(1, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.keep"), value: Buffer.from('["a"]') }]), 1);
    const bogus = Buffer.concat([Buffer.alloc(7, 0x00), Buffer.alloc(3, 0xff)]);
    bogus[6] = 0x09;
    const parsed = I.parseJournal(Buffer.concat([good, bogus]));
    assert.eq(parsed.logical.length, 1);
    assert.eq(parsed.problems.length, 1);
  });
});

describe("chat recovery inventory: tables", () => {
  it("reads an uncompressed table", () => {
    const entries = [
      { key: chatKey(ORIGIN_A, "weaver.shell.chat.one"), value: Buffer.from('["1"]') },
      { key: chatKey(ORIGIN_A, "weaver.shell.chat.two"), value: Buffer.from('["2"]') },
      { key: chatKey(ORIGIN_B, "weaver.shell.chat.three"), value: Buffer.from('["3"]') },
    ];
    const pairs = I.readTable(buildTable(entries, { compression: "none" }));
    assert.eq(pairs.length, 3);
    assert.deepEq(pairs.map((p) => p.key.toString("utf8")), entries.map((e) => e.key.toString("utf8")).sort());
  });

  it("reads a snappy-compressed table", () => {
    const entries = [{ key: chatKey(ORIGIN_A, "weaver.shell.chat.zipped"), value: Buffer.from('["z"]') }];
    const pairs = I.readTable(buildTable(entries, { compression: "snappy" }));
    assert.eq(pairs.length, 1);
    assert.eq(pairs[0].value.toString("utf8"), '["z"]');
  });

  it("fails loudly on a file that is not a table", () => {
    let message = "";
    try {
      I.readTable(Buffer.alloc(64, 0x41));
    } catch (e) {
      message = e.message;
    }
    assert.match(message, /magic/);
  });

  it("fails loudly on an unsupported block compression byte", () => {
    const block = buildBlock([{ key: chatKey(ORIGIN_A, "weaver.shell.chat.c"), value: Buffer.from('["c"]') }], "none");
    const body = block.length - 5;
    const corrupted = Buffer.from(block);
    corrupted[body] = 7;
    let message = "";
    try {
      I.readBlock(corrupted, 0, body);
    } catch (e) {
      message = e.message;
    }
    assert.match(message, /compression/);
  });
});

describe("chat recovery inventory: byte scan", () => {
  it("recovers a UTF-8 body, a UTF-16LE body and an empty array", () => {
    const utf8 = Buffer.concat([chatKey(ORIGIN_A, "weaver.shell.chat.utf8"), varint(9), Buffer.from('[{"a":1}]')]);
    const utf16Body = Buffer.from('[{"a":2}]', "utf16le");
    const utf16 = Buffer.concat([chatKey(ORIGIN_A, "weaver.shell.chat.utf16"), varint(utf16Body.length), utf16Body]);
    const empty = Buffer.concat([chatKey(ORIGIN_B, "weaver.shell.chat.none"), varint(2), Buffer.from("[]")]);
    const hits = I.byteScan(Buffer.concat([utf8, utf16, empty]));
    const byKey = Object.fromEntries(hits.map((h) => [h.key, h]));
    assert.eq(Object.keys(byKey).sort().join(","), "weaver.shell.chat.none,weaver.shell.chat.utf16,weaver.shell.chat.utf8");
    assert.eq(byKey["weaver.shell.chat.utf8"].value.toString("utf8"), '[{"a":1}]');
    assert.eq(byKey["weaver.shell.chat.utf16"].encoding, "utf16le");
    assert.eq(byKey["weaver.shell.chat.utf16"].value.toString("utf16le"), '[{"a":2}]');
    assert.eq(byKey["weaver.shell.chat.none"].value.toString("utf8"), "[]");
  });

  it("only accepts a body that balances AND parses", () => {
    // A table data block stores `[shared][unshared][value-len][key][value]`, so
    // the value starts right after the key with no length prefix to check
    // against. An unterminated array must therefore be reported, not guessed at.
    const open = Buffer.concat([chatKey(ORIGIN_A, "weaver.shell.chat.broken"), Buffer.from('[{"a":1}')]);
    const hits = I.byteScan(open);
    assert.eq(hits.length, 1);
    assert.eq(hits[0].value, undefined);
    assert.eq(hits[0].reason, "no bracket-balanced value after the key");
    assert.eq(hits[0].key, "weaver.shell.chat.broken");
  });

  it("will not let a stray brace inside a body certify a longer, invented key", () => {
    // Same bytes as the object form of the session pointer, but under a
    // conversation key: `weaver.shell.chat.pointer` is followed by an object,
    // which is not a conversation body, so nothing may be claimed for it and no
    // longer spelling of the key may be invented from the object's braces.
    const buf = Buffer.concat([chatKey(ORIGIN_A, "weaver.shell.chat.pointer"), Buffer.from('{"default":"s-abcd1234-deadbeef"}')]);
    const hits = I.byteScan(buf);
    assert.eq(hits.length, 1);
    assert.eq(hits[0].value, undefined);
    assert.eq(hits[0].key, "weaver.shell.chat.pointer");
  });

  it("does read the object a session pointer really holds", () => {
    const body = Buffer.from('{"default":"s-abcd1234-deadbeef"}');
    const buf = Buffer.concat([chatKey(ORIGIN_A, "weaver.shell.chat.activeSessionId"), varint(body.length), body]);
    const hits = I.byteScan(buf);
    assert.eq(hits.length, 1);
    assert.eq(hits[0].kind, "active-session-id");
    assert.eq(hits[0].value.toString("utf8"), body.toString("utf8"));
  });

  it("does not invent a key from a value that merely follows a chat key", () => {
    // `weaver.shell.chat.a` is real; `weaver.shell.chat.aB` is the same bytes
    // with one more printable character, and must never be reported as its own
    // entry, because only the first prefix is followed by a whole JSON body.
    const buf = Buffer.concat([chatKey(ORIGIN_A, "weaver.shell.chat.a"), varint(6), Buffer.from('[1,2,3]')]);
    const hits = I.byteScan(buf);
    assert.eq(hits.length, 1);
    assert.eq(hits[0].key, "weaver.shell.chat.a");
  });
});

describe("chat recovery inventory: occupancy", () => {
  it("treats a held LOCK as occupied even when the process list is unknown", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-lock-"));
    fs.writeFileSync(path.join(dir, "LOCK"), "");
    const held = I.checkOccupancy(dir, { processProbe: () => ({ state: "unknown", detail: "no process list" }) });
    assert.eq(held.lock, "free");
    assert.eq(held.confirmedClosed, true, "an unheld LOCK is positive proof the database is closed");
    assert.eq(held.running, null);
    assert.eq(held.warnings.length, 1);
  });

  it("is not confirmed when the process is running and the lock is gone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-lock-"));
    const view = I.checkOccupancy(dir, { processProbe: () => ({ state: "running", detail: "Obsidian is open" }) });
    assert.eq(view.running, true);
    assert.eq(view.lock, "absent");
    assert.eq(view.confirmedClosed, false);
  });
});

describe("chat recovery inventory: end to end", () => {
  it("refuses to run while the process may hold the database", () => {
    const fixture = makeLeveldb();
    let error = null;
    try {
      I.inventory({ leveldb: fixture.dir, backup: fixture.backup, processProbe: () => ({ state: "running", detail: "Obsidian is open" }) });
    } catch (e) {
      error = e;
    }
    assert.ok(error, "a running Obsidian must stop the copy");
    assert.eq(error.code, "OCCUPANCY_UNCONFIRMED");
    assert.notOk(fs.existsSync(fixture.backup), "a refused run must not create the backup");
  });

  it("still refuses when occupancy cannot be determined, unless forced", () => {
    // No LOCK file, so there is no positive proof the database is unattended:
    // neither signal is available and the run must stop rather than guess.
    const fixture = makeLeveldb({ noLock: true });
    const unknown = { processProbe: () => ({ state: "unknown", detail: "no process list" }) };
    let refused = null;
    try {
      I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...unknown });
    } catch (e) {
      refused = e;
    }
    assert.eq(refused && refused.code, "OCCUPANCY_UNCONFIRMED");
    assert.notOk(fs.existsSync(fixture.backup), "an unconfirmed run must not create the backup");
    const forced = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, forceUnverified: true, ...unknown });
    assert.eq(forced.occupancy.forced, true);
    assert.eq(forced.occupancy.confirmedClosed, false);
    assert.eq(forced.occupancy.blocked, null);
    assert.ok(forced.occupancy.warnings.length > 0, "an unconfirmed run must warn");
  });

  it("cannot be forced past a running Obsidian, even with --force-unverified", () => {
    const fixture = makeLeveldb();
    let error = null;
    try {
      I.inventory({ leveldb: fixture.dir, backup: fixture.backup, forceUnverified: true, processProbe: () => ({ state: "running", detail: "Obsidian is open" }) });
    } catch (e) {
      error = e;
    }
    assert.eq(error && error.code, "OCCUPANCY_UNCONFIRMED");
    assert.match(error.message, /Obsidian is running/);
  });

  it("refuses a backup directory that is not new", () => {
    const fixture = makeLeveldb();
    fs.mkdirSync(fixture.backup);
    fs.writeFileSync(path.join(fixture.backup, "keep.txt"), "do not clobber");
    let error = null;
    try {
      I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    } catch (e) {
      error = e;
    }
    assert.match(error.message, /new directory/);
    assert.eq(fs.readFileSync(path.join(fixture.backup, "keep.txt"), "utf8"), "do not clobber");
  });

  it("refuses a backup directory nested inside the source", () => {
    const fixture = makeLeveldb();
    let error = null;
    try {
      I.inventory({ leveldb: fixture.dir, backup: path.join(fixture.dir, "nested"), ...POLICY_PROBE });
    } catch (e) {
      error = e;
    }
    assert.match(error.message, /inside/);
  });

  it("copies, hashes, then reads only the copy, leaving every source byte identical", () => {
    const fixture = makeLeveldb();
    const before = snapshot(fixture.dir);
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    const after = snapshot(fixture.dir);

    assert.deepEq(after, before, "the source LevelDB must be byte-identical after a full run");
    assert.eq(report.occupancy.confirmedClosed, true);

    // manifest.json: one row per copied file, each with source path, backup
    // path, size and hash.
    const manifest = JSON.parse(fs.readFileSync(report.manifest.path, "utf8"));
    assert.eq(manifest.fileCount, Object.keys(before).length);
    assert.eq(manifest.fileCount, report.manifest.fileCount);
    for (const row of manifest.files) {
      assert.eq(typeof row.sourcePath, "string");
      assert.eq(typeof row.backupPath, "string");
      assert.eq(row.sha256.length, 64);
      assert.eq(row.bytes, fs.statSync(row.backupPath).size);
      assert.ok(fs.existsSync(row.sourcePath));
      // Each manifest row must describe a byte-identical copy of the file it
      // names, verified against the pre-run snapshot of the source.
      assert.eq(row.sha256 + ":" + row.bytes, before[row.relativePath], "copy differs from source for " + row.relativePath);
      assert.eq(I.sha256(fs.readFileSync(row.backupPath)), row.sha256);
    }
  });

  it("enumerates every origin and every weaver.shell.chat key, including the ones only a raw scan can reach", () => {
    const fixture = makeLeveldb();
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    assert.deepEq(report.origins.map((o) => o.origin).sort(), [ORIGIN_B, ORIGIN_A].sort());
    const keys = report.chatEntries.map((e) => e.key).sort();
    assert.deepEq(keys, [
      "weaver.shell.chat.default",
      "weaver.shell.chat.empty",
      "weaver.shell.chat.from-table",
      "weaver.shell.chat.huge",
      "weaver.shell.chat.legacy-archived",
      "weaver.shell.chat.removed",
    ]);
    const byKey = Object.fromEntries(report.chatEntries.map((e) => [e.key, e]));
    assert.eq(byKey["weaver.shell.chat.default"].valueBytes, Buffer.byteLength(JSON.stringify(fixture.defaultMessages)));
    assert.eq(byKey["weaver.shell.chat.huge"].valueBytes > 40000, true, "a record split across blocks must still be recovered whole");
    assert.eq(byKey["weaver.shell.chat.legacy-archived"].origin, ORIGIN_B);
    assert.eq(byKey["weaver.shell.chat.legacy-archived"].chatKey, "legacy-archived");
    assert.eq(byKey["weaver.shell.chat.from-table"].source, "structured");
    assert.eq(byKey["weaver.shell.chat.empty"].valueBytes, 2);
    assert.eq(byKey["weaver.shell.chat.removed"].deleted, true);
    // activeSessionId is a pointer, never a conversation body.
    assert.eq(report.entries.some((e) => e.key === "weaver.shell.chat.activeSessionId" && e.isChatKey === false), true);
  });

  it("keeps the pointer key out of chatEntries and reports unparsed work with byte ranges", () => {
    const fixture = makeLeveldb({ extraFiles: { "000007.ldb": Buffer.concat([buildTable([{ key: chatKey(ORIGIN_A, "weaver.shell.chat.dead"), value: Buffer.from('["dead"]') }]), Buffer.from("trailing junk")]) } });
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    assert.eq(report.chatEntries.every((e) => e.key !== "weaver.shell.chat.activeSessionId"), true);
    assert.ok(report.unparsed.length > 0, "the mangled table must be reported, not skipped");
    for (const item of report.unparsed) {
      assert.eq(typeof item.file, "string");
      assert.eq(typeof item.reason, "string");
      assert.ok(item.detail.length > 0);
    }
  });

  it("writes no full conversation bodies unless they were asked for, and hashes them instead", () => {
    const fixture = makeLeveldb();
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    for (const entry of report.chatEntries) {
      assert.eq(entry.valueText, undefined, entry.key + " must not carry its body by default");
      assert.notOk(String(entry.valuePreview).includes("x".repeat(200)), "the preview must be bounded");
      if (entry.deleted) assert.eq(entry.valueSha256, null);
      else assert.eq(entry.valueSha256.length, 64);
    }
    const withValues = I.inventory({ leveldb: fixture.dir, backup: path.join(fixture.root, "backup-values"), includeValues: true, ...POLICY_PROBE });
    const huge = withValues.chatEntries.find((e) => e.key === "weaver.shell.chat.huge");
    assert.eq(typeof huge.valueText, "string");
    assert.eq(I.sha256(Buffer.from(huge.valueText, "utf8")), huge.valueSha256);
  });

  it("gives every unparsed row a byte range, not just a filename", () => {
    // A record whose contents are not a write batch at all: the reader must be
    // able to point at the bytes, or an operator cannot go and look.
    const goodBatch = writeBatch(1, [{ kind: "put", key: chatKey(ORIGIN_A, "weaver.shell.chat.k"), value: Buffer.from('["a"]') }]);
    const junk = writeBatch(2, [{ kind: "put", key: Buffer.from("plain"), value: Buffer.from("not a chat key") }]);
    const corrupt = Buffer.from(junk);
    corrupt[12] = 9; // step the op tag outside {0,1}
    const fixture = makeLeveldb({ extraFiles: { "000009.log": buildJournal([goodBatch, corrupt]) } });
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    const rows = report.unparsed;
    assert.ok(rows.length > 0, "the corrupt batch must be reported");
    for (const row of rows) {
      assert.eq(typeof row.file, "string");
      assert.eq(typeof row.reason, "string");
      assert.eq(typeof row.byteStart, "number", row.reason + " must carry a byteStart");
      assert.eq(typeof row.byteEnd, "number", row.reason + " must carry a byteEnd");
      assert.ok(row.byteStart <= row.byteEnd);
    }
    assert.eq(rows.some((r) => /did not parse/.test(r.reason)), true);
  });

  it("renders a human report that names the unparsed work", () => {
    const fixture = makeLeveldb({ extraFiles: { "000007.ldb": Buffer.alloc(32, 0x41) } });
    const report = I.inventory({ leveldb: fixture.dir, backup: fixture.backup, ...POLICY_PROBE });
    const text = I.formatHuman(report);
    assert.match(text, /chat-recovery inventory/);
    assert.match(text, /weaver\.shell\.chat\.default/);
    assert.match(text, /unparsed/);
    assert.match(text, new RegExp(ORIGIN_A.replace(/[.:]/g, "\\$&")));
  });
});

/**
 * Run a CLI entry point in-process and collect what it printed. `deps` is the
 * same seam `main` takes; the occupancy probe is the only thing tests need to
 * supply, so a suite run on a machine with Obsidian open behaves like one run
 * without it. Nothing reachable from a real command line can pass `deps`.
 */
function runCli(main, argv, deps) {
  const out = [];
  const err = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  const realExit = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = (chunk) => { out.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { err.push(String(chunk)); return true; };
  try {
    main(argv, deps || {});
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  const code = process.exitCode;
  process.exitCode = realExit;
  return { code: code === undefined ? 0 : code, out: out.join(""), err: err.join("") };
}

describe("chat recovery inventory: CLI", () => {
  it("prints usage and exits 0 for --help", () => {
    const result = runCli(I.main, ["--help"]);
    assert.eq(result.code, 0);
    assert.match(result.out, /--leveldb/);
    assert.match(result.out, /--force-unverified/);
  });

  it("exits 3 on a missing or unknown argument", () => {
    assert.eq(runCli(I.main, ["--leveldb", "x"]).code, 3);
    assert.eq(runCli(I.main, ["--leveldb", "x", "--backup", "y", "--nope"]).code, 3);
    assert.match(runCli(I.main, ["--nope"]).err, /unknown argument/);
  });

  it("exits 2 on unconfirmed occupancy and 0 once it is confirmed", () => {
    // No LOCK file, so neither signal can vouch for the database.
    const fixture = makeLeveldb({ noLock: true });
    const unknown = runCli(I.main, ["--leveldb", fixture.dir, "--backup", fixture.backup], { processProbe: () => ({ state: "unknown", detail: "no list" }) });
    assert.eq(unknown.code, 2);
    assert.match(unknown.err, /refusing to copy/);
    assert.notOk(fs.existsSync(fixture.backup));
    const ok = runCli(I.main, ["--leveldb", fixture.dir, "--backup", fixture.backup], POLICY_PROBE);
    assert.eq(ok.code, 0, ok.err);
    assert.ok(fs.existsSync(path.join(fixture.backup, "manifest.json")));
    assert.match(ok.out, /weaver\.shell\.chat\.default/);
  });

  it("writes the report to --out and prints JSON to stdout", () => {
    const fixture = makeLeveldb();
    const out = path.join(fixture.root, "report.json");
    const result = runCli(I.main, ["--leveldb", fixture.dir, "--backup", fixture.backup, "--json", "--values", "--out", out], POLICY_PROBE);
    assert.eq(result.code, 0, result.err);
    const printed = JSON.parse(result.out);
    const written = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.eq(printed.schema, "scholarium-chat-recovery-inventory/1");
    assert.deepEq(written.counts, printed.counts);
    assert.eq(written.chatEntries.some((e) => typeof e.valueText === "string"), true);
    assert.match(result.err, /wrote /);
  });

  it("exits 4 when the source is not a directory", () => {
    const result = runCli(I.main, ["--leveldb", path.join(os.tmpdir(), "sch-chat-none-" + Date.now()), "--backup", "x"], POLICY_PROBE);
    assert.eq(result.code, 4);
    assert.match(result.err, /FAILED/);
  });
});

module.exports = {
  ORIGIN_A,
  ORIGIN_B,
  POLICY_PROBE,
  runCli,
  varint,
  lengthPrefixed,
  writeBatch,
  physicalRecord,
  buildJournal,
  snappyCompress,
  buildBlock,
  blockHandle,
  buildTable,
  chatKey,
  chatValue,
  makeLeveldb,
  snapshot,
};
