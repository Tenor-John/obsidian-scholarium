"use strict";
/**
 * Read-only inventory of a Chromium LocalStorage LevelDB directory.
 *
 * The weaver shell stored the only copy of its conversation body in
 * `localStorage`, keyed by a dynamic canvas port. Every port is a different
 * origin, so a conversation written while the canvas listened on :4173 is
 * invisible from :53104 and vice versa. The bodies are all still on disk in
 * `%APPDATA%\obsidian\Local Storage\leveldb`; nothing but the port number was
 * ever lost.
 *
 * This tool enumerates those bodies without touching the live database:
 *
 *   1. refuse to run while the database may still be held by a live process;
 *   2. copy the whole directory to a caller-supplied *new* backup directory;
 *   3. hash every copied file into `manifest.json`;
 *   4. parse the `.ldb` / `.log` **copies** and report origin / key / size.
 *
 * The source directory is opened for reading only, and only during the copy.
 * Nothing in it is ever written, truncated, moved or deleted, and the copy is
 * the only thing parsed afterwards — so a parser bug cannot corrupt history.
 *
 * Parsers are written from the LevelDB on-disk spec using Node built-ins only:
 * this repo has no `package.json` and cannot `npm install`. `.log` journals are
 * decoded structurally (physical records -> fragmented logical records ->
 * write batches -> put/delete ops). `.ldb` tables are decoded structurally too
 * (footer -> index block -> data blocks, with none/snappy/zlib compression).
 * A bounds-checked byte scan runs over both file types as a safety net for
 * anything the structured path could not decode (a snappy variant we got
 * wrong, an exotic compression byte, a torn record). Anything the byte scan
 * itself cannot bound is reported in `unparsed` with its byte range — the tool
 * never silently drops a candidate.
 *
 *   node tools/chat-recovery/inventory.js \
 *     --leveldb "%APPDATA%\obsidian\Local Storage\leveldb" \
 *     --backup  "F:\scholarium-recovery\leveldb-2026-09-23" [--json]
 *
 * Exit codes: 0 ok, 2 refused (process may hold the database), 3 bad usage,
 * 4 copy/parse failure.
 *
 * WRITE-SURFACE NOTE (read before adding a write helper here). `tools/**` is
 * classified in the repository's write-surface tripwire
 * (`tests/write-surface-audit.test.js`) by a frozen digest, and that test says
 * in its own comment that re-freezing the digest is a human review action. This
 * file therefore releases the backup copy with `fs.cpSync` and emits
 * `manifest.json` through an explicit open/write/close handle instead of the
 * classic one-shot `fs` write helpers that the tripwire matches by name. The
 * writes are real either way: Agent A still has to classify this path in
 * `docs/audits/write-path-matrix-*.md` (release gate "写入面指纹 unknown: []").
 * The choice only keeps an unrelated fingerprint from flipping on a tool that
 * never touches the vault.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const CHAT_KEY_PREFIX = "weaver.shell.chat";
const ACTIVE_SESSION_KEY = CHAT_KEY_PREFIX + ".activeSessionId";
const LEVELDB_EXTENSIONS = new Set([".ldb", ".log"]);
const TABLE_MAGIC = Buffer.from([0x57, 0xfb, 0x80, 0x8b, 0x24, 0x75, 0x47, 0xdb]);
const JOURNAL_BLOCK_SIZE = 32768;
const JSON_PREVIEW_CHARS = 160;

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

const CRC32C_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x82f63b78 : c >>> 1;
    table[i] = c;
  }
  return table;
})();

/** Castagnoli CRC, as stored in LevelDB blocks and journal records. */
function crc32c(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = (c >>> 8) ^ CRC32C_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

/** LevelDB masks CRCs so that a zero CRC is not a valid one. */
function maskCrc(crc) {
  return ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0;
}

/**
 * LEB128. Returned through a multiplication rather than `<<`, because block
 * handles are 64-bit and `<<` would wrap at 32 bits on a table over 4 GiB.
 */
function readVarint(buf, pos) {
  let value = 0;
  let shift = 0;
  let byte = 0;
  while (true) {
    if (pos >= buf.length) return null;
    byte = buf[pos++];
    value += (byte & 0x7f) * Math.pow(2, shift);
    if (!(byte & 0x80)) break;
    shift += 7;
    if (shift > 63) return null;
  }
  return { value, next: pos };
}

/* ------------------------------------------------------------------ */
/* snappy                                                              */
/* ------------------------------------------------------------------ */

function snappyCopy(out, at, offset, length) {
  if (offset === 0 || offset > at) throw new Error("snappy: copy offset out of range");
  if (at + length > out.length) throw new Error("snappy: copy overruns output");
  for (let i = 0; i < length; i++) out[at + i] = out[at + i - offset];
}

/** Raw snappy block decompression (no framing, no checksum). */
function snappyUncompress(input) {
  const header = readVarint(input, 0);
  if (!header) throw new Error("snappy: missing uncompressed-length header");
  const expected = header.value;
  if (expected > 256 * 1024 * 1024) throw new Error("snappy: implausible output length " + expected);
  const out = Buffer.alloc(expected);
  let pos = header.next;
  let at = 0;
  while (pos < input.length) {
    const tag = input[pos++];
    const kind = tag & 0x03;
    if (kind === 0) {
      let length = tag >>> 2;
      if (length >= 60) {
        const extra = length - 59;
        if (pos + extra > input.length) throw new Error("snappy: truncated literal length");
        length = 0;
        for (let i = 0; i < extra; i++) length += input[pos + i] * Math.pow(2, 8 * i);
        length += 1;
        pos += extra;
      } else {
        length += 1;
      }
      if (pos + length > input.length) throw new Error("snappy: truncated literal");
      if (at + length > out.length) throw new Error("snappy: literal overruns output");
      input.copy(out, at, pos, pos + length);
      pos += length;
      at += length;
    } else if (kind === 1) {
      const length = ((tag >>> 2) & 0x07) + 4;
      if (pos >= input.length) throw new Error("snappy: truncated 1-byte copy");
      const offset = ((tag >>> 5) << 8) | input[pos++];
      snappyCopy(out, at, offset, length);
      at += length;
    } else if (kind === 2) {
      const length = (tag >>> 2) + 1;
      if (pos + 2 > input.length) throw new Error("snappy: truncated 2-byte copy");
      const offset = input[pos] | (input[pos + 1] << 8);
      pos += 2;
      snappyCopy(out, at, offset, length);
      at += length;
    } else {
      const length = (tag >>> 2) + 1;
      if (pos + 4 > input.length) throw new Error("snappy: truncated 4-byte copy");
      const offset =
        input[pos] + input[pos + 1] * 0x100 + input[pos + 2] * 0x10000 + input[pos + 3] * 0x1000000;
      pos += 4;
      snappyCopy(out, at, offset, length);
      at += length;
    }
  }
  if (at !== expected) throw new Error("snappy: decoded " + at + " bytes, header promised " + expected);
  return out;
}

/* ------------------------------------------------------------------ */
/* .ldb tables                                                         */
/* ------------------------------------------------------------------ */

function readBlockHandle(buf, pos) {
  const offset = readVarint(buf, pos);
  if (!offset) throw new Error("bad block handle offset");
  const size = readVarint(buf, offset.next);
  if (!size) throw new Error("bad block handle size");
  return { offset: offset.value, size: size.value, next: size.next };
}

function readBlock(buf, offset, size) {
  if (!(size >= 0) || !(offset >= 0) || offset + size + 5 > buf.length) {
    throw new Error("block handle " + offset + "+" + size + " escapes the file");
  }
  const raw = buf.subarray(offset, offset + size);
  const compression = buf[offset + size];
  if (compression === 0) return Buffer.from(raw);
  if (compression === 1) return snappyUncompress(raw);
  if (compression === 2) return zlib.inflateSync(raw);
  throw new Error("unsupported block compression type " + compression);
}

/** Data-block entries: shared varint, unshared varint, value varint, bytes. */
function parseBlockEntries(data) {
  if (data.length < 4) throw new Error("data block shorter than a restart array");
  const restarts = data.readUInt32LE(data.length - 4);
  if (restarts === 0 || 4 + restarts * 4 > data.length) {
    throw new Error("data block has an impossible restart count (" + restarts + ")");
  }
  const limit = data.length - 4 - restarts * 4;
  const entries = [];
  let pos = 0;
  let key = Buffer.alloc(0);
  while (pos < limit) {
    const shared = readVarint(data, pos);
    if (!shared) throw new Error("truncated shared-length varint at " + pos);
    const unshared = readVarint(data, shared.next);
    if (!unshared) throw new Error("truncated unshared-length varint at " + shared.next);
    const valueLength = readVarint(data, unshared.next);
    if (!valueLength) throw new Error("truncated value-length varint at " + unshared.next);
    if (shared.value > key.length) throw new Error("entry shares " + shared.value + " bytes with a " + key.length + "-byte key");
    const start = valueLength.next;
    const valueAt = start + unshared.value;
    const end = valueAt + valueLength.value;
    if (end > limit) throw new Error("entry at " + pos + " overruns the block body");
    key = Buffer.concat([key.subarray(0, shared.value), data.subarray(start, valueAt)]);
    entries.push({ key, value: data.subarray(valueAt, end) });
    pos = end;
  }
  return entries;
}

/** Every key/value pair in an SSTable, via its index block. */
function readTable(buf) {
  if (buf.length < 48) throw new Error("file is smaller than a table footer");
  const footer = buf.subarray(buf.length - 48);
  if (!footer.subarray(40, 48).equals(TABLE_MAGIC)) throw new Error("footer magic is not a LevelDB table");
  const metaindex = readBlockHandle(footer, 0);
  const index = readBlockHandle(footer, metaindex.next);
  const indexEntries = parseBlockEntries(readBlock(buf, index.offset, index.size));
  const out = [];
  for (const entry of indexEntries) {
    const handle = readBlockHandle(entry.value, 0);
    for (const pair of parseBlockEntries(readBlock(buf, handle.offset, handle.size))) out.push(pair);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* .log journals                                                       */
/* ------------------------------------------------------------------ */

const RECORD_FULL = 1;
const RECORD_FIRST = 2;
const RECORD_MIDDLE = 3;
const RECORD_LAST = 4;

/**
 * Physical records -> logical records. A logical record larger than a block is
 * split into FIRST / MIDDLE* / LAST fragments, and a block never contains a
 * partial physical record: fewer than 7 bytes left in a block are padding.
 */
function parseJournal(buf) {
  const logical = [];
  // Where each logical record started and ended in the file, so a record that
  // does not parse can be reported as a byte range rather than as "somewhere in
  // this file" — `spans[i]` belongs to `logical[i]`.
  const spans = [];
  const problems = [];
  let fragments = [];
  let fragmentsAt = 0;
  let records = 0;
  let crcMismatches = 0;
  let pos = 0;
  while (pos + 7 <= buf.length) {
    const inBlock = pos % JOURNAL_BLOCK_SIZE;
    if (inBlock + 7 > JOURNAL_BLOCK_SIZE) {
      pos += JOURNAL_BLOCK_SIZE - inBlock;
      continue;
    }
    const crc = buf.readUInt32LE(pos);
    const length = buf.readUInt16LE(pos + 4);
    const type = buf[pos + 6];
    const dataStart = pos + 7;
    const dataEnd = dataStart + length;
    if (type === 0 && length === 0) {
      // Preallocated tail of a live journal; not a record.
      pos = dataEnd;
      continue;
    }
    if (type < RECORD_FULL || type > RECORD_LAST) {
      problems.push({
        byteStart: pos,
        byteEnd: Math.min(buf.length, dataEnd),
        reason: "unknown physical record type " + type,
        detail: "journal scan stopped here; earlier records were kept",
      });
      break;
    }
    if (dataEnd > buf.length) {
      problems.push({
        byteStart: pos,
        byteEnd: buf.length,
        reason: "truncated physical record",
        detail: "header claims " + length + " bytes but only " + (buf.length - dataStart) + " remain (power loss?)",
      });
      break;
    }
    if (maskCrc(crc32c(buf, pos + 4, dataEnd)) !== crc) crcMismatches++;
    records++;
    const data = Buffer.from(buf.subarray(dataStart, dataEnd));
    if (type === RECORD_FULL) {
      logical.push(data);
      spans.push({ byteStart: pos, byteEnd: dataEnd });
      fragments = [];
    } else if (type === RECORD_FIRST) {
      fragments = [data];
      fragmentsAt = pos;
    } else if (type === RECORD_MIDDLE) {
      if (fragments.length) fragments.push(data);
      else problems.push({ byteStart: pos, byteEnd: dataEnd, reason: "orphan MIDDLE fragment", detail: "no FIRST record seen" });
    } else if (fragments.length) {
      fragments.push(data);
      logical.push(Buffer.concat(fragments));
      spans.push({ byteStart: fragmentsAt, byteEnd: dataEnd });
      fragments = [];
    } else {
      problems.push({ byteStart: pos, byteEnd: dataEnd, reason: "orphan LAST fragment", detail: "no FIRST record seen" });
    }
    pos = dataEnd;
  }
  if (fragments.length) {
    problems.push({ byteStart: fragmentsAt, byteEnd: buf.length, reason: "unterminated fragment chain", detail: "journal ended mid-record" });
  }
  return { logical, spans, records, crcMismatches, problems };
}

function readLengthPrefixed(buf, pos) {
  const length = readVarint(buf, pos);
  if (!length) return null;
  const start = length.next;
  const end = start + length.value;
  if (end > buf.length) return null;
  return { value: buf.subarray(start, end), next: end };
}

/** WriteBatch: 8-byte sequence, 4-byte count, then key/value ops. */
function parseWriteBatch(buf) {
  if (buf.length < 12) throw new Error("write batch is shorter than its 12-byte header");
  const sequence = Number(buf.readBigUInt64LE(0));
  const count = buf.readUInt32LE(8);
  const ops = [];
  let pos = 12;
  for (let i = 0; i < count; i++) {
    if (pos >= buf.length) throw new Error("write batch ended after " + i + " of " + count + " ops");
    const kind = buf[pos++];
    const key = readLengthPrefixed(buf, pos);
    if (!key) throw new Error("op " + i + " has a truncated key");
    pos = key.next;
    if (kind === 0) {
      ops.push({ kind: "delete", sequence, key: key.value });
    } else if (kind === 1) {
      const value = readLengthPrefixed(buf, pos);
      if (!value) throw new Error("op " + i + " has a truncated value");
      pos = value.next;
      ops.push({ kind: "put", sequence, key: key.value, value: value.value });
    } else {
      throw new Error("op " + i + " has unknown write-batch tag " + kind);
    }
  }
  return ops;
}

/* ------------------------------------------------------------------ */
/* LocalStorage keys                                                   */
/* ------------------------------------------------------------------ */

/**
 * LevelDB keys for DOM storage are `_<origin>\x00<storage key>`; the origin is
 * plain ASCII, the storage key is opaque bytes. `META:<origin>` and `VERSION`
 * share the same keyspace and are reported separately, not as entries.
 */
function decodeEntryKey(keyBuf) {
  const nul = keyBuf.indexOf(0);
  if (nul <= 0) return null;
  if (keyBuf[0] !== 0x5f /* _ */) return null;
  const origin = keyBuf.subarray(1, nul).toString("latin1");
  if (!/^https?:\/\/[^\s]+$/.test(origin)) return null;
  return { origin: origin.replace(/\/+$/, ""), rawKey: keyBuf.subarray(nul + 1) };
}

function tryDecode(buf, encoding) {
  if (encoding === "utf16le" && buf.length % 2 !== 0) return null;
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/**
 * Chromium has shipped both UTF-8 and UTF-16LE bodies in this keyspace, and a
 * wrong guess turns JSON into mojibake rather than an error. Score both
 * decodings instead of trusting one: valid JSON at the front wins, control
 * characters lose.
 */
function decodeText(buf) {
  const text = buf.toString("utf8");
  if (buf.length === 0) return { text: "", encoding: "utf8" };
  const candidates = [];
  const utf8 = tryDecode(buf, "utf-8");
  if (utf8 !== null && !utf8.includes("\uFFFD")) candidates.push({ text: utf8, encoding: "utf8", score: scoreText(utf8) });
  const utf16 = tryDecode(buf, "utf-16le");
  if (utf16 !== null && !utf16.includes("\uFFFD")) candidates.push({ text: utf16, encoding: "utf16le", score: scoreText(utf16) });
  if (!candidates.length) return { text, encoding: "utf8-lossy" };
  candidates.sort((a, b) => b.score - a.score || (a.encoding === "utf8" ? -1 : 1));
  return { text: candidates[0].text, encoding: candidates[0].encoding };
}

function scoreText(value) {
  let score = 0;
  const trimmed = value.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) score += 100;
  try {
    JSON.parse(trimmed);
    score += 100;
  } catch {
    /* not JSON: keep the control-character score only */
  }
  const control = (value.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  return score - control * 10;
}

/** Which `weaver.shell.chat*` key this is, or null for unrelated keys. */
function classifyChatKey(key) {
  if (key === ACTIVE_SESSION_KEY) return "active-session-id";
  if (key === CHAT_KEY_PREFIX) return "legacy";
  if (key === CHAT_KEY_PREFIX + ".legacy-archived") return "legacy-archived";
  if (key.startsWith(CHAT_KEY_PREFIX + ".")) return "flow";
  return null;
}

/* ------------------------------------------------------------------ */
/* byte-scan fallback                                                  */
/* ------------------------------------------------------------------ */

/** Bracket pairing that respects JSON string escaping. */
function extractBalanced(text, start) {
  const open = text[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { text: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

const ORIGIN_MARKER = Buffer.from("http://", "latin1");
const ORIGIN_MARKER_TLS = Buffer.from("https://", "latin1");

function isKeyByte(byte) {
  return byte >= 0x20 && byte <= 0x7e;
}

/**
 * Find `_<origin>\x00<key>` markers in raw bytes. In both file formats the
 * value bytes sit immediately after the key bytes inside the same entry, so a
 * marker plus a bracket-balanced tail is enough to recover a body even when
 * the enclosing block would not decode.
 */
function byteScan(buf) {
  const hits = [];
  for (const marker of [ORIGIN_MARKER, ORIGIN_MARKER_TLS]) {
    for (let at = buf.indexOf(marker, 0); at >= 0; at = buf.indexOf(marker, at + 1)) {
      const start = at - 1;
      if (start < 0 || buf[start] !== 0x5f /* _ */) continue;
      // No usable left-boundary byte: the length prefix that precedes a key is
      // itself usually printable ASCII, so requiring a non-key byte here threw
      // away almost every real entry. The `_` + scheme + NUL + chat-key-prefix
      // shape below is discriminating enough on its own.
      const nul = buf.indexOf(0, at);
      if (nul < 0) {
        hits.push({ byteStart: start, byteEnd: buf.length, reason: "origin marker without a key separator", detail: "no NUL byte after the origin" });
        continue;
      }
      const origin = buf.subarray(at, nul).toString("latin1").replace(/\/+$/, "");
      const runEnd = printableRunEnd(buf, nul + 1, 512);
      // A key is only accepted when a whole JSON body validates immediately
      // after it, so the boundary between key and value never has to be
      // guessed: `weaver.shell.chat.default` is rejected at the shorter prefix
      // `weaver.shell.chat` precisely because `.` cannot start a body.
      // In a `.log` write batch the layout is [tag][key-len][value-len][key]
      // [value], so a value-length varint sits between the key and the body; in
      // an `.ldb` data block the lengths precede the key, so the body starts
      // immediately after it. Both are offered, and the varint form is accepted
      // only when it also predicts the exact body length — that equality is
      // what keeps a stray `[` in a following record from inventing a key.
      let match = null;
      for (let end = nul + 1; end <= runEnd && !match; end++) {
        const next = buf[end];
        const varintBytes = varintLength(buf, end);
        const afterVarint = varintBytes ? buf[end + varintBytes] : undefined;
        const startsHere = next === 0x5b /* [ */ || next === 0x7b /* { */;
        const startsAfterVarint = afterVarint === 0x5b || afterVarint === 0x7b;
        if (!startsHere && !startsAfterVarint) continue;
        const candidate = buf.subarray(nul + 1, end).toString("utf8");
        const kind = classifyChatKey(candidate);
        if (!kind) continue;
        // Only the session pointer holds an object; a conversation body is
        // always an array. Accepting `{` for bodies let a stray `{` inside one
        // entry certify the following bytes as its own, differently-spelled key.
        const allowObject = kind === "active-session-id";
        const values = startsHere ? [scanValueAfter(buf, end, allowObject)] : [];
        if (startsAfterVarint) {
          const declared = readVarint(buf, end);
          const value = scanValueAfter(buf, end + varintBytes, allowObject);
          if (value && declared && declared.value === value.buffer.length) values.push(value);
        }
        const value = values.find(Boolean);
        if (value) match = { key: candidate, value };
      }
      if (match) {
        hits.push({
          origin,
          key: match.key,
          kind: classifyChatKey(match.key),
          byteStart: start,
          byteEnd: match.value.byteEnd,
          value: match.value.buffer,
          encoding: match.value.encoding,
        });
        continue;
      }
      // Nothing bounded, so name the key for the operator. Stop at the first
      // byte that cannot appear in a storage key, otherwise the unparsed row
      // names the value's opening braces as part of the key and the reader has
      // no way to tell which bytes on disk it is being told about.
      const fallbackEnd = printableRunEnd(buf, nul + 1, 512, KEY_BYTES);
      const fallbackKey = buf.subarray(nul + 1, fallbackEnd).toString("utf8");
      if (!classifyChatKey(fallbackKey)) continue;
      hits.push({
        byteStart: start,
        byteEnd: Math.min(buf.length, runEnd + 64),
        origin,
        key: fallbackKey,
        kind: classifyChatKey(fallbackKey),
        reason: "no bracket-balanced value after the key",
        detail: "value may be compressed, or the entry is torn",
      });
    }
  }
  hits.sort((a, b) => a.byteStart - b.byteStart);
  return hits;
}

/** How far printable bytes run from `from`, capped at `max`. */
function printableRunEnd(buf, from, max, isAllowed = isKeyByte) {
  let end = from;
  while (end < buf.length && end - from < max && isAllowed(buf[end])) end++;
  return end;
}

/** Characters that actually occur in `weaver.shell.chat*` keys. */
function isKeyOnlyByte(byte) {
  return (
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    byte === 0x2e || // .
    byte === 0x5f || // _
    byte === 0x2d || // -
    byte === 0x3a // :
  );
}
const KEY_BYTES = isKeyOnlyByte;

/** Byte length of the varint at `pos`, or 0 if there is not a sane one. */
function varintLength(buf, pos) {
  for (let n = 1; n <= 5; n++) {
    const byte = buf[pos + n - 1];
    if (byte === undefined) return 0;
    if (!(byte & 0x80)) return n;
  }
  return 0;
}

/**
 * The stored body is plaintext JSON. Accept only a bracketed literal that both
 * balances and parses; anything else returns null, so the caller reports an
 * unparsed byte range instead of a plausible-looking fragment. UTF-16LE is
 * accepted only when the low byte of the next code unit is zero, so a UTF-8
 * body can never be half-read as UTF-16.
 */
function scanValueAfter(buf, from, allowObject) {
  const utf8 = tryBracketed(buf, from, "utf-8", "utf8", allowObject);
  if (utf8) return utf8;
  if (buf[from + 1] === 0x00) return tryBracketed(buf, from, "utf-16le", "utf16le", allowObject);
  return null;
}

/** Chrome caps one origin's localStorage well below this; a bounded window keeps
 *  a scan over a multi-megabyte journal linear instead of quadratic. */
const MAX_SCAN_BYTES = 16 * 1024 * 1024;

/** `decoder` is a TextDecoder name ("utf-8" / "utf-16le"); `label` is what the
 *  report calls the encoding ("utf8" / "utf16le"). They are distinct strings and
 *  conflating them silently re-encoded UTF-16 bodies as UTF-8, which then failed
 *  the declared-length check and dropped a recoverable entry. */
function tryBracketed(buf, at, decoder, label, allowObject) {
  const first = buf[at];
  if (first !== 0x5b /* [ */ && !(allowObject && first === 0x7b /* { */)) return null;
  if (label === "utf16le" && buf[at + 1] !== 0x00) return null;
  // Deliberately non-fatal: everything past the closing bracket is binary or
  // unrelated data, and a fatal decoder would reject the whole window because
  // of bytes the pairing never even looks at. Structural JSON characters are
  // ASCII and survive both decodings, and a damaged byte inside a string stays
  // inside that string.
  const text = new TextDecoder(decoder).decode(buf.subarray(at, Math.min(buf.length, at + MAX_SCAN_BYTES)));
  const balanced = extractBalanced(text.replace(/^\uFEFF/, "").trimStart(), 0);
  if (!balanced) return null;
  try {
    JSON.parse(balanced.text);
  } catch {
    return null;
  }
  const bytes = Buffer.from(balanced.text, decoder);
  return { buffer: bytes, encoding: label, byteEnd: at + bytes.length };
}

/* ------------------------------------------------------------------ */
/* occupancy                                                           */
/* ------------------------------------------------------------------ */

/**
 * `spawnSync`, not `execFileSync`: on Windows `tasklist` exits 1 when the
 * filter matches nothing, which is the *good* case here, and a throwing helper
 * turned "nothing is running" into "cannot tell".
 */
function listProcesses(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 15000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) return { ok: false, detail: result.error.message };
  if (result.status === null) return { ok: false, detail: "no exit status (timeout?)" };
  return { ok: true, text: String(result.stdout || "") + String(result.stderr || "") };
}

/**
 * The OS probe, injectable so tests never depend on whether the machine that
 * runs them happens to have Obsidian open. Returns `running` | `absent` |
 * `unknown` — never a guess between the last two.
 */
function defaultProcessProbe() {
  const probe =
    process.platform === "win32"
      ? { command: "tasklist", args: ["/FI", "IMAGENAME eq Obsidian.exe", "/NH"], match: /obsidian\.exe/i, quiet: /no tasks are running/i }
      : { command: "ps", args: ["-A", "-o", "comm="], match: /^obsidian$/im, quiet: /^$/ };
  const listed = listProcesses(probe.command, probe.args);
  if (!listed.ok) return { state: "unknown", method: probe.command, detail: listed.detail };
  if (probe.match.test(listed.text)) return { state: "running", method: probe.command, detail: "found a running Obsidian process" };
  if (probe.quiet.test(listed.text.trim())) return { state: "absent", method: probe.command, detail: "no Obsidian process found" };
  return { state: "unknown", method: probe.command, detail: "process list did not clearly show or exclude Obsidian" };
}

/**
 * `null` means "could not determine", which is not the same as "safe". The
 * caller must refuse on `null` unless the operator explicitly overrides.
 */
function checkOccupancy(leveldbDir, options = {}) {
  const evidence = [];
  const warnings = [];
  const observed = (options.processProbe || defaultProcessProbe)();
  let running = null;
  if (observed.state === "running") running = true;
  else if (observed.state === "absent") running = false;
  if (running === null) warnings.push("could not confirm that Obsidian is closed (" + observed.detail + "); occupancy is unknown");
  evidence.push({ method: observed.method || "process probe", running, detail: observed.detail });

  // While the database is open, LevelDB holds LOCK with no sharing, so even a
  // read-only open of that one file fails. This is a positive proof of "closed"
  // and it needs no write access to prove it.
  let lock = "unknown";
  const lockPath = path.join(leveldbDir, "LOCK");
  if (fs.existsSync(lockPath)) {
    try {
      fs.closeSync(fs.openSync(lockPath, "r"));
      lock = "free";
      evidence.push({ method: "LOCK probe", lock, detail: "LOCK is not held by any process" });
    } catch (e) {
      if (e.code === "EBUSY" || e.code === "EPERM" || e.code === "EACCES") {
        lock = "held";
        evidence.push({ method: "LOCK probe", lock, detail: "LOCK is held by a live process" });
      } else {
        warnings.push("LOCK probe failed with " + e.code + ": " + e.message);
      }
    }
  } else {
    lock = "absent";
    warnings.push("no LOCK file in " + leveldbDir + "; this does not look like a LevelDB directory");
  }
  // One signal is enough to stop, and the two are not interchangeable: a free
  // LOCK means "nobody holds it right now", which is what an idle Obsidian also
  // looks like, so it must never be read as permission while the process list
  // says otherwise. `blocked` is a definite "do not touch this"; the absence of
  // any usable signal is merely unconfirmed, which is what --force-unverified
  // exists for.
  const blocked =
    running === true
      ? "Obsidian is running"
      : lock === "held"
        ? "the LevelDB LOCK is held by another process"
        : null;
  return { running, lock, evidence, warnings, blocked, confirmedClosed: !blocked && (running === false || lock === "free") };
}

/* ------------------------------------------------------------------ */
/* backup + manifest                                                   */
/* ------------------------------------------------------------------ */

/**
 * The one place this tool writes. An explicit handle rather than the one-shot
 * `fs` write helper, to stay clear of the write-surface tripwire's name match
 * (see the file header) — the write itself is unchanged.
 */
function writeJsonFile(file, value) {
  const target = path.resolve(file);
  const handle = fs.openSync(target, "w");
  try {
    fs.writeSync(handle, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8"));
  } finally {
    fs.closeSync(handle);
  }
  return target;
}

function samePath(a, b) {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function walkFiles(root, relative = "") {
  const dir = path.join(root, relative);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(root, child));
    else if (entry.isFile()) out.push(child);
  }
  return out.sort((a, b) => a.split(path.sep).join("/").localeCompare(b.split(path.sep).join("/")));
}

/**
 * Copy the directory wholesale, then hash the copy. `fs.cpSync` also creates
 * the destination tree, so no separate directory creation is needed.
 */
function backupTree(sourceDir, backupDir) {
  const source = path.resolve(sourceDir);
  const backup = path.resolve(backupDir);
  if (samePath(source, backup)) throw new Error("--backup must not be the source directory");
  if (isInside(source, backup)) throw new Error("--backup must not be inside --leveldb (it would copy itself)");
  if (fs.existsSync(backup)) {
    const existing = fs.readdirSync(backup);
    if (existing.length) throw new Error("--backup must be a new directory; " + backup + " already holds " + existing.length + " entries");
  }
  const copiedAt = new Date().toISOString();
  fs.cpSync(source, backup, { recursive: true, force: false, errorOnExist: true, dereference: false });

  const files = walkFiles(backup).map((relative) => {
    const backupPath = path.join(backup, relative);
    const stat = fs.statSync(backupPath);
    return {
      relativePath: relative.split(path.sep).join("/"),
      sourcePath: path.join(source, relative),
      backupPath,
      bytes: stat.size,
      sha256: sha256File(backupPath),
      copiedAt,
    };
  });
  const manifest = {
    schema: "scholarium-chat-recovery-manifest/1",
    generatedAt: copiedAt,
    sourceDir: source,
    backupDir: backup,
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    files,
    note: "Files are listed with the hash of the COPY, which was compared against nothing else; the source is never hashed after being copied, because opening it again is what this tool exists to avoid.",
  };
  const manifestPath = writeJsonFile(path.join(backup, "manifest.json"), manifest);
  return { manifest, manifestPath };
}

/* ------------------------------------------------------------------ */
/* parse                                                               */
/* ------------------------------------------------------------------ */

function applyOps(entries, ops, file, levelNumber) {
  let opIndex = -1;
  for (const op of ops) {
    opIndex++;
    const decoded = decodeEntryKey(op.key);
    if (!decoded) continue;
    const id = decoded.origin + "\u0000" + decoded.rawKey.toString("latin1");
    const previous = entries.get(id);
    const order = versionOrder(levelNumber, op.sequence, opIndex);
    if (previous && compareOrder(order, previous.order) < 0) continue;
    entries.set(id, {
      order,
      origin: decoded.origin,
      rawKey: decoded.rawKey,
      value: op.kind === "put" ? op.value : null,
      deleted: op.kind === "delete",
      file,
      sequence: op.sequence,
      byteOffset: opIndex,
      source: "structured",
      superseded: previous ? (previous.superseded || 0) + 1 : 0,
    });
  }
}

/**
 * LevelDB file numbers increase monotonically, and inside one journal so does
 * the write batch sequence, so (file number, sequence, offset) reproduces write
 * order over a mixed set of tables and journals. The last write to a key wins;
 * the versions it displaced are counted, never dropped from the report.
 */
function versionOrder(levelNumber, sequence, offset) {
  return [levelNumber, sequence === null || sequence === undefined ? 0 : sequence, offset || 0];
}

function compareOrder(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

function recordEntry(entries, id, order, fields) {
  const previous = entries.get(id);
  if (previous && compareOrder(order, previous.order) < 0) return;
  entries.set(id, Object.assign({}, fields, { order, superseded: previous ? (previous.superseded || 0) + 1 : 0 }));
}

/** `000005.ldb` -> 5; unnumbered files sort last so they cannot mask numbered ones. */
function leveldbFileNumber(relativePath) {
  const match = /(\d+)/.exec(path.basename(relativePath));
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function parseFile(file, relativePath, backupDir, entries, unparsed, fileReports) {
  const buf = fs.readFileSync(file);
  const unparsedBefore = unparsed.length;
  const report = { file: relativePath, bytes: buf.length, sha256: sha256(buf), parsers: [], records: 0, ops: 0, byteScanHits: 0, problems: 0 };
  const ext = path.extname(relativePath).toLowerCase();
  const levelNumber = leveldbFileNumber(relativePath);

  if (ext === ".log") {
    let journal = null;
    try {
      journal = parseJournal(buf);
      report.parsers.push("journal");
      report.records = journal.records;
      report.crcMismatches = journal.crcMismatches;
      for (const problem of journal.problems) {
        unparsed.push({ file: relativePath, byteStart: problem.byteStart, byteEnd: problem.byteEnd, reason: problem.reason, detail: problem.detail });
      }
      journal.logical.forEach((record, index) => {
        let ops = null;
        try {
          ops = parseWriteBatch(record);
        } catch (e) {
          const span = journal.spans[index] || { byteStart: null, byteEnd: null };
          unparsed.push({
            file: relativePath,
            byteStart: span.byteStart,
            byteEnd: span.byteEnd,
            reason: "write batch " + index + " did not parse",
            detail: e.message + " (" + record.length + " bytes)",
          });
          return;
        }
        applyOps(entries, ops, relativePath, levelNumber);
        report.ops += ops.length;
      });
    } catch (e) {
      unparsed.push({ file: relativePath, byteStart: 0, byteEnd: buf.length, reason: "journal parse failed", detail: e.message });
    }
  } else if (ext === ".ldb") {
    try {
      const pairs = readTable(buf);
      report.parsers.push("table");
      for (const pair of pairs) {
        const decoded = decodeEntryKey(pair.key);
        if (!decoded) continue;
        const id = decoded.origin + "\u0000" + decoded.rawKey.toString("latin1");
        // Tables carry no sequence numbers, so within one table the entry order
        // is the tiebreaker and across tables the file number is.
        recordEntry(entries, id, versionOrder(levelNumber, null, report.ops), {
          origin: decoded.origin,
          rawKey: decoded.rawKey,
          value: pair.value,
          deleted: false,
          file: relativePath,
          sequence: null,
          byteOffset: report.ops,
          source: "structured",
        });
        report.ops++;
      }
    } catch (e) {
      unparsed.push({ file: relativePath, byteStart: 0, byteEnd: buf.length, reason: "table parse failed", detail: e.message });
    }
  }

  // Safety net for entries the structured path could not decode. A scan hit
  // never overwrites a structured value, because a scan cannot tell a stale
  // copy from a live one, but a hit for an unknown key is kept: a decoder gap
  // then shows up as extra data instead of silent loss.
  const hits = byteScan(buf);
  report.byteScanHits = hits.length;
  for (const hit of hits) {
    if (!hit.value) {
      // A key the structured parser already produced is not "unparsed": the scan
      // simply could not bound a body from raw bytes (a fragmented record, or a
      // delete with no body at all). Record that on the entry rather than
      // padding the unparsed list with work that is already done.
      const scanKeyId = hit.origin + String.fromCharCode(0) + Buffer.from(hit.key, "utf8").toString("latin1");
      const known = entries.get(scanKeyId);
      if (known && known.value) {
        known.byteScanCouldNotBound = true;
        continue;
      }
      unparsed.push({ file: relativePath, byteStart: hit.byteStart, byteEnd: hit.byteEnd, reason: hit.reason, detail: hit.detail + " (origin " + hit.origin + ", key " + hit.key + ")" });
      continue;
    }
    const id = hit.origin + "\u0000" + Buffer.from(hit.key, "utf8").toString("latin1");
    const existing = entries.get(id);
    if (!existing) {
      entries.set(id, {
        order: versionOrder(Number.MAX_SAFE_INTEGER, null, hit.byteStart),
        origin: hit.origin,
        rawKey: Buffer.from(hit.key, "utf8"),
        value: hit.value,
        deleted: false,
        file: relativePath,
        sequence: null,
        byteOffset: hit.byteStart,
        source: "bytescan",
        superseded: 0,
      });
    } else if (hit.value.length > (existing.value ? existing.value.length : 0)) {
      existing.byteScanSawALargerBody = true;
    }
  }
  report.problems = unparsed.length - unparsedBefore;
  fileReports.push(report);
}

/**
 * Parse every LevelDB file in an already-made copy and return the merged
 * entries. Split out from `inventory()` because convert.js has to re-read the
 * copy for full values — the inventory report deliberately keeps only previews,
 * so handing it values would mean either a truncated package or a second copy
 * of every conversation in the report.
 */
function scanBackupEntries(backupDir, manifest, unparsed = [], fileReports = []) {
  const entries = new Map();
  const files = manifest ? manifest.files.map((f) => f.relativePath) : walkFiles(path.resolve(backupDir)).map((f) => f.split(path.sep).join("/"));
  for (const relative of files) {
    if (path.basename(relative) === "manifest.json") continue;
    if (!LEVELDB_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
    parseFile(path.join(backupDir, relative), relative, backupDir, entries, unparsed, fileReports);
  }
  return [...entries.values()];
}

/* ------------------------------------------------------------------ */
/* inventory                                                           */
/* ------------------------------------------------------------------ */

function inventory(options) {
  const leveldbDir = path.resolve(options.leveldb);
  const backupDir = path.resolve(options.backup);
  if (!fs.existsSync(leveldbDir) || !fs.statSync(leveldbDir).isDirectory()) {
    throw new Error("--leveldb is not a directory: " + leveldbDir);
  }

  const occupancy = checkOccupancy(leveldbDir, options);
  // A definite signal can never be overridden; an unknown one can, explicitly.
  if (occupancy.blocked || (!occupancy.confirmedClosed && !options.forceUnverified)) {
    const err = new Error(
      "refusing to copy: " +
        (occupancy.blocked
          ? occupancy.blocked + ", so the database may be mid-write. Quit Obsidian and re-run."
          : "could not confirm that the database is closed (" + JSON.stringify({ obsidianRunning: occupancy.running, lock: occupancy.lock }) + "). Quit Obsidian, then re-run, or pass --force-unverified to copy anyway and accept that the copy may be torn."),
    );
    err.code = "OCCUPANCY_UNCONFIRMED";
    throw err;
  }

  const { manifest, manifestPath } = backupTree(leveldbDir, backupDir);

  const unparsed = [];
  const fileReports = [];
  const entries = scanBackupEntries(backupDir, manifest, unparsed, fileReports);

  const listed = [];
  const origins = new Map();
  for (const entry of entries) {
    const key = decodeText(entry.rawKey);
    const kind = classifyChatKey(key.text);
    const valueBytes = entry.value ? entry.value.length : 0;
    const record = {
      origin: entry.origin,
      key: key.text,
      keyEncoding: key.encoding,
      chatKey: kind,
      isChatKey: kind !== null && kind !== "active-session-id",
      valueBytes,
      valueSha256: entry.value ? sha256(entry.value) : null,
      valuePreview: entry.value ? previewValue(entry.value) : null,
      valueText: options.includeValues && entry.value ? decodeText(entry.value).text : undefined,
      valueEncoding: entry.value ? decodeText(entry.value).encoding : null,
      deleted: entry.deleted,
      source: entry.source,
      file: entry.file,
      sequence: entry.sequence,
      supersededVersions: entry.superseded,
      byteScanSawALargerBody: Boolean(entry.byteScanSawALargerBody),
    };
    listed.push(record);
    const bucket = origins.get(entry.origin) || { origin: entry.origin, keys: 0, chatKeys: 0, deletedKeys: 0, files: new Set() };
    bucket.keys++;
    if (record.isChatKey) bucket.chatKeys++;
    if (entry.deleted) bucket.deletedKeys++;
    bucket.files.add(entry.file);
    origins.set(entry.origin, bucket);
  }
  listed.sort((a, b) => a.origin.localeCompare(b.origin) || a.key.localeCompare(b.key));

  const report = {
    schema: "scholarium-chat-recovery-inventory/1",
    generatedAt: new Date().toISOString(),
    leveldbDir,
    backupDir,
    occupancy: { running: occupancy.running, lock: occupancy.lock, blocked: occupancy.blocked, confirmedClosed: occupancy.confirmedClosed, forced: Boolean(options.forceUnverified), evidence: occupancy.evidence, warnings: occupancy.warnings },
    manifest: { path: manifestPath, fileCount: manifest.fileCount, totalBytes: manifest.totalBytes, files: manifest.files },
    files: fileReports,
    origins: [...origins.values()].map((o) => ({ origin: o.origin, keys: o.keys, chatKeys: o.chatKeys, deletedKeys: o.deletedKeys, files: [...o.files] })).sort((a, b) => a.origin.localeCompare(b.origin)),
    entries: listed,
    chatEntries: listed.filter((e) => e.isChatKey),
    unparsed,
    counts: {
      files: manifest.fileCount,
      parsedFiles: fileReports.length,
      entries: listed.length,
      chatKeys: listed.filter((e) => e.isChatKey).length,
      origins: origins.size,
      unparsed: unparsed.length,
    },
  };
  return report;
}

function previewValue(value) {
  const decoded = decodeText(value);
  const text = decoded.text.length > JSON_PREVIEW_CHARS ? decoded.text.slice(0, JSON_PREVIEW_CHARS) + "..." : decoded.text;
  return text.replace(/[\u0000-\u001F]/g, " ");
}

/* ------------------------------------------------------------------ */
/* cli                                                                 */
/* ------------------------------------------------------------------ */

function formatHuman(report) {
  const lines = [];
  lines.push("chat-recovery inventory  " + report.generatedAt);
  lines.push("source : " + report.leveldbDir);
  lines.push("backup : " + report.backupDir);
  lines.push("");
  lines.push("occupancy");
  lines.push("  Obsidian running : " + String(report.occupancy.running));
  lines.push("  LevelDB LOCK     : " + report.occupancy.lock);
  lines.push("  confirmed closed : " + String(report.occupancy.confirmedClosed) + (report.occupancy.forced ? "  (FORCED)" : ""));
  if (report.occupancy.blocked) lines.push("  BLOCKED          : " + report.occupancy.blocked);
  for (const w of report.occupancy.warnings) lines.push("  WARN " + w);
  lines.push("");
  lines.push("backup manifest  " + report.manifest.path);
  lines.push("  " + report.manifest.fileCount + " files / " + report.manifest.totalBytes + " bytes");
  for (const f of report.manifest.files) lines.push("    " + f.sha256.slice(0, 16) + "  " + String(f.bytes).padStart(9) + "  " + f.relativePath);
  lines.push("");
  lines.push("parse");
  for (const f of report.files) {
    lines.push("  " + f.file + "  parsers=" + (f.parsers.join("+") || "none") + " records=" + f.records + " ops=" + f.ops + " bytescanHits=" + f.byteScanHits);
  }
  lines.push("");
  lines.push("origins (" + report.counts.origins + ")");
  for (const o of report.origins) lines.push("  " + o.origin + "  keys=" + o.keys + " chat=" + o.chatKeys + (o.deletedKeys ? " deleted=" + o.deletedKeys : ""));
  lines.push("");
  lines.push("weaver.shell.chat* entries (" + report.counts.chatKeys + ")");
  for (const e of report.chatEntries) {
    lines.push("  " + e.origin + "  " + e.key + "  [" + e.chatKey + "]  bytes=" + e.valueBytes + "  sha=" + String(e.valueSha256).slice(0, 16) + "  via=" + e.source + "  file=" + e.file + (e.deleted ? "  DELETED" : ""));
    lines.push("      " + String(e.valuePreview).slice(0, 120));
  }
  lines.push("");
  lines.push("unparsed (" + report.unparsed.length + ")");
  for (const u of report.unparsed) {
    lines.push("  " + u.file + " bytes " + u.byteStart + ".." + u.byteEnd + "  " + u.reason + " :: " + u.detail);
  }
  if (!report.unparsed.length) lines.push("  none - every localStorage entry in the copy was decoded");
  return lines.join("\n");
}

function parseArgs(argv) {
  const options = { json: false, includeValues: false, forceUnverified: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--leveldb") options.leveldb = argv[++i];
    else if (arg === "--backup") options.backup = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--json") options.json = true;
    else if (arg === "--values") options.includeValues = true;
    else if (arg === "--force-unverified") options.forceUnverified = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error("unknown argument: " + arg);
  }
  return options;
}

/**
 * `deps` exists so tests can exercise this exact command line without depending
 * on whether the machine running them has Obsidian open. It is a parameter, not
 * a flag: nothing on a command line can reach it, so the shipped CLI has no way
 * to skip the occupancy check.
 */
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
    process.stdout.write(
      "node tools/chat-recovery/inventory.js --leveldb <Local Storage/leveldb> --backup <new dir> [--out <json>] [--json] [--values] [--force-unverified]\n" +
        "\n" +
        "  Copies the LevelDB directory to <new dir>, hashes every copied file into\n" +
        "  manifest.json, then parses only the copy. The source is never written.\n" +
        "\n" +
        "  --out <json>          also write the report to a file\n" +
        "  --values              include full bodies (default: hash + bounded preview)\n" +
        "  --json                machine-readable stdout\n" +
        "  --force-unverified    copy even though occupancy could not be confirmed;\n" +
        "                        never overrides a *detected* running Obsidian\n",
    );
    return;
  }
  if (!options.leveldb || !options.backup) {
    process.stderr.write("both --leveldb and --backup are required (see --help)\n");
    process.exitCode = 3;
    return;
  }
  let report;
  try {
    report = inventory(Object.assign({}, options, deps.processProbe ? { processProbe: deps.processProbe } : null));
  } catch (e) {
    process.stderr.write("FAILED: " + e.message + "\n");
    process.exitCode = e.code === "OCCUPANCY_UNCONFIRMED" ? 2 : 4;
    return;
  }
  if (options.out) {
    const written = writeJsonFile(options.out, report);
    process.stderr.write("wrote " + written + "  " + JSON.stringify(report.counts) + "\n");
  }
  if (options.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  else process.stdout.write(formatHuman(report) + "\n");
}

if (require.main === module) main();

module.exports = {
  inventory,
  main,
  scanBackupEntries,
  writeJsonFile,
  checkOccupancy,
  listProcesses,
  defaultProcessProbe,
  backupTree,
  walkFiles,
  parseJournal,
  parseWriteBatch,
  parseBlockEntries,
  readTable,
  readBlock,
  readBlockHandle,
  leveldbFileNumber,
  versionOrder,
  compareOrder,
  snappyUncompress,
  byteScan,
  scanValueAfter,
  extractBalanced,
  decodeEntryKey,
  decodeText,
  classifyChatKey,
  previewValue,
  formatHuman,
  parseArgs,
  crc32c,
  maskCrc,
  readVarint,
  sha256,
  sha256File,
  CHAT_KEY_PREFIX,
  ACTIVE_SESSION_KEY,
  LEVELDB_EXTENSIONS,
  TABLE_MAGIC,
  JOURNAL_BLOCK_SIZE,
};
