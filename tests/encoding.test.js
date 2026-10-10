"use strict";
/**
 * Source encoding guard.
 *
 * This project has been bitten twice. Once by a PowerShell `Set-Content` round
 * trip that turned em dashes into replacement characters, and once by a
 * rollback error message that read 杩愯中断于创建目标 instead of
 * 运行中断于创建目标 — in the one message a user sees when a migration has been
 * interrupted and the vault state is ambiguous.
 *
 * The second case is the reason this file checks more than U+FFFD. That text
 * was *valid* UTF-8; it simply encoded the wrong characters, because UTF-8
 * bytes had been read as GBK and re-encoded. Byte-level validation passes
 * cleanly on it. The only cheap signal left is the characters themselves:
 * UTF-8-read-as-GBK produces a small, recognisable set of obscure CJK
 * ideographs that essentially never occur in real Chinese product copy.
 *
 * That makes the check below a heuristic, not a proof. It is tuned to catch the
 * failure that actually happened rather than to be exhaustive.
 */
const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

const ROOT = path.join(__dirname, "..");
const DIRS = ["tools", "tests"];

/* Leading bytes of UTF-8 Chinese (E4–E9) reinterpreted as GBK land almost
   entirely in this set. None of them is plausible in hand-written copy. */
const MOJIBAKE = [
  "鍜", "鎴", "鐨", "鏄", "浣", "瀹", "璇", "娌", "杩", "鑰", "鏈", "涔",
  "浠", "鎵", "澶", "灏", "寮", "鐢", "鏂", "鑳", "鍦", "瀛", "鍑", "鍙",
  "鍐", "鎬", "鏃", "鍚", "鐜", "闂", "鏋", "鐮", "鏁", "缁", "杞", "褰",
];

function sourceFiles() {
  const out = [];
  for (const dir of DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const name of fs.readdirSync(abs))
      if (/\.(js|md)$/.test(name)) out.push(path.join(dir, name));
  }
  return out;
}

describe("source encoding", () => {
  it("has no replacement characters in tools or tests", () => {
    for (const file of sourceFiles()) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      // Written as an escape on purpose: a literal one here would make this
      // test fail on itself, which it promptly did.
      const line = text.split("\n").findIndex((l) => l.includes("\uFFFD"));
      assert.eq(line, -1, file + " line " + (line + 1) + " contains U+FFFD");
    }
  });

  it("round-trips every source file through UTF-8 unchanged", () => {
    for (const file of sourceFiles()) {
      const raw = fs.readFileSync(path.join(ROOT, file));
      assert.eq(
        Buffer.compare(Buffer.from(raw.toString("utf8"), "utf8"), raw), 0,
        file + " is not valid UTF-8",
      );
    }
  });

  it("has no UTF-8-read-as-GBK mojibake in user-facing strings", () => {
    for (const file of sourceFiles()) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      // Skip this file: it necessarily contains the very characters it hunts.
      if (file.endsWith("encoding.test.js")) continue;
      for (const ch of MOJIBAKE) {
        const at = text.indexOf(ch);
        if (at < 0) continue;
        const line = text.slice(0, at).split("\n").length;
        assert.ok(false,
          file + " line " + line + " contains mojibake " + JSON.stringify(ch) +
          " — this is UTF-8 that was read as GBK somewhere in the edit path: " +
          JSON.stringify(text.slice(Math.max(0, at - 30), at + 30)));
      }
    }
  });

  it("starts no tool file with a shebang", () => {
    // Node's CommonJS loader strips `#!` before compiling, so `node --check`,
    // the CLI tools and the whole test suite pass with one present. Obsidian's
    // renderer loader does not strip it, so V8 sees `#` as the first token and
    // throws "Invalid or unexpected token" — which is what the hypothesis
    // editor reported, from three files that every local check said were fine.
    //
    // The tools are invoked as `node tools/<x>.js`, never as `./tools/<x>.js`,
    // so the shebang bought nothing and cost the entire plugin-side feature.
    for (const file of sourceFiles()) {
      if (!file.startsWith("tools")) continue;
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      assert.notOk(text.startsWith("#!"),
        file + " begins with a shebang; Obsidian cannot require it");
    }
  });

  it("keeps the interrupted-rollback message readable", () => {
    // The specific string that was corrupted. It is the message shown when a
    // migration died mid-write and the vault state cannot be inferred, so it
    // has to be legible.
    const text = fs.readFileSync(path.join(ROOT, "tools", "migration-transaction.js"), "utf8");
    assert.match(text, /运行中断于创建目标/);
  });
});
