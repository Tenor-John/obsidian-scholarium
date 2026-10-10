"use strict";
/**
 * 只读扩展根：源可以在工作区之外，写入不可以。
 *
 * 起因：Zotero 的 PDF 住在它自己的 storage 目录，而 rag.js 原来要求
 * "路径必须在 root 内"。为了绕过这条检查，插件把每篇 PDF 复制进 Obsidian
 * 库——1316 篇重复占用 6.18 GB，Zotero 里还留着一份一模一样的。
 *
 * 现在允许把 Zotero storage 配成只读语料根。这组测试守的是这次放宽的边界：
 *
 *   1. 只读根之内的绝对路径可以作为**源**被读取；
 *   2. 之外的路径仍然被拒（放宽不等于放开）；
 *   3. 一切**写入**（语料、索引）仍然只落在 root 内——只读根始终只读；
 *   4. 白名单只能由 Bridge 从配置注入，请求体传入的一律无效。
 *
 * 第 4 条是整件事的关键：如果浏览器侧一个 POST 就能塞进 read_roots，
 * 这条边界等于没有。
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rag = require("../skills/rag-ingest/scripts/rag.js");
const server = fs.readFileSync(path.join(__dirname, "..", "bridge", "server.js"), "utf8");
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const serverCode = stripComments(server);

/* ── 判定 ───────────────────────────────────────────────────────────── */

test("root 永远在只读根列表里，即使没配置任何扩展根", () => {
  const roots = rag.readRootsOf("/vault", {});
  assert.equal(roots.length, 1);
  assert.equal(roots[0], path.resolve("/vault"));
});

test("配置的扩展根会被加进来", () => {
  const roots = rag.readRootsOf("/vault", { read_roots: ["/zotero/storage", "  ", ""] });
  assert.equal(roots.length, 2, "空字符串不应产生条目——否则会变成 resolve('') = cwd");
  assert.ok(roots.includes(path.resolve("/zotero/storage")));
});

test("只读根之内的路径被接受，之外的被拒", () => {
  const roots = rag.readRootsOf(path.resolve("/vault"), { read_roots: [path.resolve("/zotero/storage")] });
  assert.equal(rag.isInsideAny(path.resolve("/vault/lit/a.pdf"), roots), true);
  assert.equal(rag.isInsideAny(path.resolve("/zotero/storage/ABCD/x.pdf"), roots), true);
  assert.equal(rag.isInsideAny(path.resolve("/etc/passwd"), roots), false);
  assert.equal(rag.isInsideAny(path.resolve("/zotero/other/x.pdf"), roots), false);
});

test("前缀相同但不是子目录的不算在内", () => {
  // /zotero/storage-backup 不是 /zotero/storage 的子目录，
  // 少了分隔符判断就会被当成命中。
  const roots = rag.readRootsOf(path.resolve("/vault"), { read_roots: [path.resolve("/zotero/storage")] });
  assert.equal(rag.isInsideAny(path.resolve("/zotero/storage-backup/x.pdf"), roots), false);
});

/* ── source_path 形态 ───────────────────────────────────────────────── */

test("root 内用相对路径，root 外用绝对路径", () => {
  const root = path.resolve("/vault");
  assert.equal(rag.sourceIdFor(root, path.resolve("/vault/lit/a.pdf")), "lit/a.pdf");
  const outside = rag.sourceIdFor(root, path.resolve("/zotero/storage/ABCD/x.pdf"));
  assert.ok(path.posix.isAbsolute(outside) || /^[A-Za-z]:\//.test(outside),
    `root 外应给出绝对标识，实际 ${outside}`);
  assert.ok(!outside.includes("\\"), "标识必须是 posix 形态，否则图谱范围比对会因斜杠方向失配");
});

test("同一个文件无论用相对还是绝对写法，标识都一致", () => {
  // 图谱靠 source_path 比对范围；两种写法给出不同标识就会匹配到 0 张卡片。
  const root = path.resolve("/vault");
  const viaAbs = rag.sourceIdFor(root, path.resolve(root, "lit/a.pdf"));
  const viaRel = rag.sourceIdFor(root, path.resolve(root, "./lit/./a.pdf"));
  assert.equal(viaAbs, viaRel);
});

/* ── 写入边界：只读根必须始终只读 ─────────────────────────────────── */

test("语料写入落在 root 内，不写只读根", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rag-root-"));
  const tmpRead = fs.mkdtempSync(path.join(os.tmpdir(), "rag-readonly-"));
  try {
    const source = path.join(tmpRead, "paper.md");
    fs.writeFileSync(source, "# Title\n\nbody text for chunking.\n", "utf8");
    const before = fs.readdirSync(tmpRead);

    const prepared = rag.prepareMarkdown(tmpRoot, source, fs.readFileSync(source, "utf8"), "a".repeat(64));

    // 产物在 root 内
    const corpusAbs = path.resolve(tmpRoot, prepared.result.corpus);
    assert.ok(corpusAbs.startsWith(path.resolve(tmpRoot) + path.sep), "语料必须写在 root 内");
    assert.ok(fs.existsSync(corpusAbs));
    // 只读根一个字节都没多
    assert.deepEqual(fs.readdirSync(tmpRead), before, "只读根被写入了——这条边界破了");
    // 源标识是绝对路径（因为在 root 外）
    assert.ok(!prepared.result.source.startsWith(".."), "root 外的源不该用 ../ 相对路径表示");
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(tmpRead, { recursive: true, force: true });
  }
});

/* ── 白名单来源：只认配置 ───────────────────────────────────────────── */

test("Bridge 从配置取只读根，并显式丢掉请求体里的同名字段", () => {
  assert.match(serverCode, /readOnlyRoots/, "配置项没有被读取");
  assert.match(serverCode, /delete input\.read_roots;/,
    "请求体里的 read_roots 必须被丢掉——否则浏览器侧可自行放开白名单");
  assert.match(serverCode, /if \(graphInput\) delete graphInput\.read_roots;/,
    "graph 子对象也是请求体的一部分，同样不能夹带");
  assert.match(serverCode, /read_roots: readOnlyRoots,/, "注入的必须是配置里的那份");
});

test("注入值来自 config，不来自 input", () => {
  // 只看 readOnlyRoots 这一条赋值语句本身。它后面那句 delete input.read_roots
  // 合法地提到了 input，不能因此判定取值受请求体影响。
  const start = serverCode.indexOf("const readOnlyRoots");
  const stmt = serverCode.slice(start, serverCode.indexOf(";", serverCode.indexOf("[]", start)) + 1);
  assert.ok(stmt.startsWith("const readOnlyRoots"), "找不到 readOnlyRoots 的赋值语句");
  assert.doesNotMatch(stmt, /\binput\b/,
    `只读根的取值表达式里出现了 input，白名单可被请求体影响：\n${stmt}`);
  assert.match(stmt, /scholariumConfig\(\)|config\.rag/, "取值必须来自配置");
});
