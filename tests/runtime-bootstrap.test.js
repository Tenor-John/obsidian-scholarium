"use strict";
/**
 * runtime-bootstrap / runtime-pack-build 原型测试。
 *
 * 覆盖：确定性构建、安装回环、哈希拒绝、Zip Slip 防护、升级与回滚、
 * 插件内置本地包约束、平台路径。全部使用本地文件，无网络。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { describe, it, assert } = require("./harness");

const { buildPack } = require("../tools/runtime-pack-build.js");
const bootstrap = require("../tools/runtime-bootstrap.js");

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sch-rt-${tag}-`));
}

/** 造一个带固定内容的源目录。 */
function makeSource(files) {
  const dir = tmpdir("src");
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

function localResolve(outDir) {
  return (pack) => path.join(outDir, pack.file);
}

describe("runtime-pack-build: 确定性构建", () => {
  it("同一输入两次构建逐字节一致", () => {
    const src = makeSource({ "bin/node.exe": "NODE", "skills/a/SKILL.md": "# A" });
    const out = tmpdir("out");
    const r1 = buildPack({ name: "core", version: "9.9.9", platform: "win32-x64", from: src, out });
    const r2 = buildPack({ name: "core", version: "9.9.9", platform: "win32-x64", from: src, out });
    assert.eq(r1.sha256, r2.sha256, "两次构建 sha256");
    assert.eq(r1.size, r2.size, "两次构建大小");
  });

  it("manifest 记录 sha256/size 且 core 默认 required", () => {
    const src = makeSource({ "a.txt": "hello" });
    const out = tmpdir("out");
    buildPack({ name: "core", version: "1.0.0", platform: "win32-x64", from: src, out });
    const m = JSON.parse(fs.readFileSync(path.join(out, "scholarium-runtime-manifest-1.0.0.json"), "utf8"));
    assert.eq(m.schema, "scholarium-runtime-pack/1");
    assert.eq(m.packs.length, 1);
    assert.eq(m.packs[0].required, true);
    assert.eq(typeof m.packs[0].sha256, "string");
    assert.eq(m.packs[0].size > 0, true);
  });
});

describe("runtime-bootstrap: 安装回环", () => {
  it("安装后文件落位、status 变 ready", async () => {
    const src = makeSource({ "bin/node.exe": "NODE", "skills/x/run.py": "print(1)" });
    const out = tmpdir("out");
    buildPack({ name: "core", version: "1.0.0", platform: "win32-x64", from: src, out });
    const m = JSON.parse(fs.readFileSync(path.join(out, "scholarium-runtime-manifest-1.0.0.json"), "utf8"));

    const root = tmpdir("root");
    assert.eq(bootstrap.status(root).state, "absent");
    const r = await bootstrap.install({ rootDir: root, manifest: m, resolvePackUrl: localResolve(out) });
    assert.deepEq(r.packs, ["core"]);
    const installed = path.join(root, "versions", "1.0.0", "core");
    assert.eq(fs.readFileSync(path.join(installed, "bin", "node.exe"), "utf8"), "NODE");
    assert.eq(fs.readFileSync(path.join(installed, "skills", "x", "run.py"), "utf8"), "print(1)");
    const st = bootstrap.status(root);
    assert.eq(st.state, "ready");
    assert.eq(st.activeVersion, "1.0.0");
    assert.eq(fs.existsSync(path.join(root, "staging")), false, "staging 已清空");
  });

  it("SHA-256 不符时拒绝安装且不留下任何状态", async () => {
    const src = makeSource({ "a.txt": "hello" });
    const out = tmpdir("out");
    buildPack({ name: "core", version: "1.0.0", platform: "win32-x64", from: src, out });
    const m = JSON.parse(fs.readFileSync(path.join(out, "scholarium-runtime-manifest-1.0.0.json"), "utf8"));
    m.packs[0].sha256 = "0".repeat(64); // 篡改

    const root = tmpdir("root");
    let threw = null;
    try {
      await bootstrap.install({ rootDir: root, manifest: m, resolvePackUrl: localResolve(out) });
    } catch (e) { threw = e; }
    assert.eq(!!threw, true, "应当抛错");
    // C3（发布判据 4）：响亮 + 可读 + 给出路，绝不降级运行或静默跳过
    assert.eq(/SHA-256 不符/.test(threw.message), true, "指明哈希不符");
    assert.eq(/已拒绝安装/.test(threw.message), true, "明确拒绝而非降级");
    assert.eq(/未被改动/.test(threw.message), true, "告知现状未变");
    assert.eq(/重新安装完整的 Scholarium 插件包/.test(threw.message), true, "给出完整插件重装出路");
    assert.eq(bootstrap.status(root).state, "absent", "不应改变现状");
    assert.eq(fs.existsSync(path.join(root, "staging")), false, "staging 应清空");
    assert.eq(fs.existsSync(path.join(root, "versions", "1.0.0")), false, "不应产生版本目录");
  });

  it("tar 解包拒绝 .. 路径穿越", () => {
    // 手工构造一个含 ../evil.txt 条目的最小 ustar
    const header = Buffer.alloc(512);
    header.write("../evil.txt", 0, "latin1");
    header.write("0000644\0", 100, "latin1");
    header.write("0000000\0", 108, "latin1");
    header.write("0000000\0", 116, "latin1");
    header.write("00000000004\0", 124, "latin1");
    header.write("00000000000\0", 136, "latin1");
    header.fill(0x20, 148, 156);
    header.write("0", 156, "latin1");
    header.write("ustar\0", 257, "latin1");
    header.write("00", 263, "latin1");
    let sum = 0;
    for (const b of header) sum += b;
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "latin1");
    const data = Buffer.from("EVIL");
    const tar = Buffer.concat([header, data, Buffer.alloc(512 - 4), Buffer.alloc(1024)]);

    const dest = tmpdir("extract");
    let threw = null;
    try { bootstrap.extractTar(tar, dest); } catch (e) { threw = e; }
    assert.eq(!!threw, true, "应当拒绝");
    assert.eq(/穿越/.test(threw.message), true);
    assert.eq(fs.existsSync(path.join(dest, "..", "evil.txt")), false);
  });
});

describe("runtime-bootstrap: 升级与回滚", () => {
  it("装 v2 后回滚到 v1，零数据移动", async () => {
    const out = tmpdir("out");
    const root = tmpdir("root");
    for (const [version, marker] of [["1.0.0", "V1"], ["2.0.0", "V2"]]) {
      const src = makeSource({ "version.txt": marker });
      buildPack({ name: "core", version, platform: "win32-x64", from: src, out });
      const m = JSON.parse(fs.readFileSync(path.join(out, `scholarium-runtime-manifest-${version}.json`), "utf8"));
      await bootstrap.install({ rootDir: root, manifest: m, resolvePackUrl: localResolve(out) });
    }
    let st = bootstrap.status(root);
    assert.eq(st.activeVersion, "2.0.0");
    assert.eq(st.previousVersion, "1.0.0");

    const r = bootstrap.rollback(root);
    assert.eq(r.rolledBackTo, "1.0.0");
    st = bootstrap.status(root);
    assert.eq(st.activeVersion, "1.0.0");
    assert.eq(fs.readFileSync(path.join(root, "versions", "1.0.0", "core", "version.txt"), "utf8"), "V1");
    // 重装失败演练：status 对缺失版本目录报 degraded
    fs.rmSync(path.join(root, "versions", "1.0.0"), { recursive: true });
    assert.eq(bootstrap.status(root).state, "degraded");
  });
});

describe("runtime-bootstrap: self-contained local contract", () => {
  it("rejects remote runtime sources before any network request", async () => {
    const manifest = {
      schema: "scholarium-runtime-pack/1",
      version: "4.0.0",
      platform: "win32-x64",
      packs: [{ name: "core", file: "core.tar.gz", sha256: "0".repeat(64), size: 1, required: true }],
    };
    let error = null;
    try {
      await bootstrap.install({
        rootDir: tmpdir("root"),
        manifest,
        resolvePackUrl: () => "https://example.invalid/core.tar.gz",
      });
    } catch (caught) { error = caught; }
    assert.ok(error);
    assert.match(error.message, /插件内置的本地资源/);
  });
});

describe("runtime-bootstrap: 平台默认路径", () => {
  it("Windows 用 LOCALAPPDATA，且不在 Vault/插件目录内", () => {
    const p = bootstrap.defaultRuntimeRoot({
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
      homeDir: "C:\\Users\\u",
    });
    assert.eq(p, path.join("C:\\Users\\u\\AppData\\Local", "Scholarium", "runtime"));
  });
  it("macOS/Linux 各有约定路径（断言与运行平台的分隔符无关）", () => {
    const mac = bootstrap.defaultRuntimeRoot({ platform: "darwin", env: {}, homeDir: "/Users/u" });
    assert.eq(mac, path.join("/Users/u", "Library", "Application Support", "Scholarium", "runtime"));
    const linux = bootstrap.defaultRuntimeRoot({ platform: "linux", env: {}, homeDir: "/home/u" });
    assert.eq(linux, path.join("/home/u", ".local", "share", "scholarium", "runtime"));
  });
});

describe("C-P0-1：运行时根为 NTFS 目录联接", () => {
  it("经联接路径安装成功，文件落在真实目标，状态经联接可读", async () => {
    if (process.platform !== "win32") return;
    const real = tmpdir("real-root");
    const linkParent = tmpdir("link-parent");
    const junction = path.join(linkParent, "runtime-link");
    fs.symlinkSync(real, junction, "junction");

    const src = makeSource({ "bin/node.exe": "NODE", "THIRD_PARTY/x.txt": "license" });
    const out = tmpdir("out");
    buildPack({ name: "core", version: "5.0.0", platform: "win32-x64", from: src, out });
    const manifest = JSON.parse(fs.readFileSync(path.join(out, "scholarium-runtime-manifest-5.0.0.json"), "utf8"));

    const result = await bootstrap.install({ rootDir: junction, manifest, resolvePackUrl: localResolve(out) });
    assert.eq(result.version, "5.0.0");
    assert.eq(fs.readFileSync(path.join(real, "versions", "5.0.0", "core", "bin", "node.exe"), "utf8"), "NODE");
    const state = bootstrap.status(junction);
    assert.eq(state.state, "ready");
    assert.eq(state.activeVersion, "5.0.0");
  });

  it("resolveRoot 对不存在路径原样返回，对联接返回真实目标", () => {
    const missing = path.join(tmpdir("missing"), "nope");
    assert.eq(bootstrap.resolveRoot(missing).includes("nope"), true);
    if (process.platform !== "win32") return;
    const real = tmpdir("real-root");
    const junction = path.join(tmpdir("link-parent"), "runtime-link");
    fs.symlinkSync(real, junction, "junction");
    assert.eq(bootstrap.resolveRoot(junction).toLowerCase(), fs.realpathSync(real).toLowerCase());
  });
});
