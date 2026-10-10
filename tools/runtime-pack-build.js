"use strict";
/**
 * runtime-pack-build — 构建 Scholarium 运行时包（core / browser）。
 *
 * 产出：
 *   scholarium-runtime-<pack>-<version>-<platform>.tar.gz   确定性 ustar+gzip
 *   scholarium-runtime-manifest-<version>.json              每包 sha256+size
 *
 * 确定性保证：条目按路径排序、mtime 归零、mode 固定（目录 0755 / 文件 0644）、
 * gzip mtime 字段归零。同一输入目录两次构建逐字节一致（对齐 Agent B
 * 「两个干净目录逐字一致产物」的发布要求）。
 *
 * 用法：
 *   node tools/runtime-pack-build.js \
 *     --name core --version 2.0.9 --platform win32-x64 \
 *     --from <staging-dir> --out <out-dir>
 *   # 多包连续调用，用 --manifest <path> 累积到同一份 manifest：
 *   node tools/runtime-pack-build.js --name browser ... --manifest <m.json>
 *
 * 纯 Node ≥20 标准库，无第三方依赖。
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const MANIFEST_SCHEMA = "scholarium-runtime-pack/1";

/* ------------------------------------------------------------ ustar ---- */

function octal(value, width) {
  const s = value.toString(8).padStart(width - 1, "0");
  return Buffer.from(s.slice(-(width - 1)) + "\0", "latin1");
}

function field(text, width) {
  const b = Buffer.alloc(width);
  b.write(String(text).slice(0, width), 0, "latin1");
  return b;
}

/** 长路径拆分：name≤100 放不下时，在 '/' 处拆成 prefix(≤155)+name(≤100)。 */
function splitName(rel) {
  if (Buffer.byteLength(rel) <= 100) return { prefix: "", name: rel };
  const parts = rel.split("/");
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join("/");
    const name = parts.slice(i).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { prefix, name };
    }
  }
  throw new Error(`路径过长，无法放入 ustar 头: ${rel}`);
}

function tarHeader(rel, { type, size }) {
  const { prefix, name } = splitName(rel);
  const h = Buffer.alloc(512);
  let off = 0;
  const put = (buf) => { buf.copy(h, off); off += buf.length; };
  put(field(name, 100));
  put(octal(type === "5" ? 0o755 : 0o644, 8));   // mode
  put(octal(0, 8));                                // uid
  put(octal(0, 8));                                // gid
  put(octal(size, 12));                            // size
  put(octal(0, 12));                               // mtime（归零 → 确定性）
  h.fill(0x20, off, off + 8); off += 8;            // chksum 占位（空格）
  put(field(type, 1));                             // typeflag
  put(field("", 100));                             // linkname
  put(field("ustar\0", 6));                        // magic
  put(field("00", 2));                             // version
  put(field("", 32));                              // uname
  put(field("", 32));                              // gname
  put(octal(0, 8)); put(octal(0, 8));              // devmajor/devminor
  put(field(prefix, 155));                         // prefix
  let sum = 0;
  for (const byte of h) sum += byte;
  const chk = Buffer.from(sum.toString(8).padStart(6, "0") + "\0 ", "latin1");
  chk.copy(h, 148);
  return h;
}

/** 目录 → 确定性 tar Buffer。条目为相对路径，统一 '/' 分隔。 */
function buildTar(sourceDir) {
  const entries = [];
  (function walk(dir, rel) {
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const r = rel ? rel + "/" + name : name;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new Error(`运行时包不允许符号链接: ${r}`);
      if (st.isDirectory()) { entries.push({ rel: r + "/", type: "5" }); walk(abs, r); }
      else if (st.isFile()) entries.push({ rel: r, type: "0", abs, size: st.size });
    }
  })(sourceDir, "");
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const chunks = [];
  for (const e of entries) {
    chunks.push(tarHeader(e.rel, { type: e.type, size: e.size || 0 }));
    if (e.type === "0") {
      const data = fs.readFileSync(e.abs);
      chunks.push(data);
      const pad = (512 - (data.length % 512)) % 512;
      if (pad) chunks.push(Buffer.alloc(pad));
    }
  }
  chunks.push(Buffer.alloc(1024)); // 两个零块结尾
  return Buffer.concat(chunks);
}

/* ---------------------------------------------------------- manifest ---- */

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function loadManifest(manifestPath, { version, platform }) {
  if (manifestPath && fs.existsSync(manifestPath)) {
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (m.schema !== MANIFEST_SCHEMA) throw new Error(`未知 manifest schema: ${m.schema}`);
    if (m.version !== version) throw new Error(`manifest 版本 ${m.version} 与本次构建 ${version} 不一致`);
    if (m.platform !== platform) throw new Error(`manifest 平台 ${m.platform} 与本次构建 ${platform} 不一致`);
    return m;
  }
  return { schema: MANIFEST_SCHEMA, version, platform, createdAt: new Date().toISOString(), packs: [] };
}

function buildPack({ name, version, platform, from, out, manifestPath }) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`非法包名: ${name}`);
  if (!fs.existsSync(from)) throw new Error(`源目录不存在: ${from}`);
  fs.mkdirSync(out, { recursive: true });

  const fileName = `scholarium-runtime-${name}-${version}-${platform}.tar.gz`;
  const tar = buildTar(from);
  // zlib 的 gzip 头固定写 MTIME=0（无选项可改），配合上面的确定性 tar，
  // 整体输出逐字节可复现。
  const gz = zlib.gzipSync(tar, { level: 9 });
  const target = path.join(out, fileName);
  fs.writeFileSync(target, gz);

  const mPath = manifestPath || path.join(out, `scholarium-runtime-manifest-${version}.json`);
  const manifest = loadManifest(mPath, { version, platform });
  manifest.packs = manifest.packs.filter((p) => p.name !== name);
  manifest.packs.push({
    name,
    file: fileName,
    url: "", // 发布时由流水线填 GitHub Release asset URL（Agent A 集成点）
    sha256: sha256(gz),
    size: gz.length,
    required: name === "core",
  });
  manifest.packs.sort((a, b) => (a.name < b.name ? -1 : 1));
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { file: target, manifest: mPath, sha256: sha256(gz), size: gz.length };
}

/* --------------------------------------------------------------- cli ---- */

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    args[argv[i].replace(/^--/, "")] = argv[i + 1];
  }
  return args;
}

if (require.main === module) {
  const a = parseArgs(process.argv);
  if (!a.name || !a.version || !a.platform || !a.from || !a.out) {
    console.error("用法: node tools/runtime-pack-build.js --name core --version X --platform P --from DIR --out DIR [--manifest FILE]");
    process.exit(2);
  }
  const r = buildPack({
    name: a.name,
    version: a.version,
    platform: a.platform,
    from: path.resolve(a.from),
    out: path.resolve(a.out),
    manifestPath: a.manifest ? path.resolve(a.manifest) : undefined,
  });
  console.log(`pack:     ${r.file}`);
  console.log(`manifest: ${r.manifest}`);
  console.log(`sha256:   ${r.sha256}`);
  console.log(`size:     ${r.size} bytes`);
}

module.exports = { buildPack, buildTar, MANIFEST_SCHEMA };
