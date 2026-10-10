"use strict";
/**
 * C1/C6：core 包装配——sidecar 与 bridge 同级（先于 Ketcher）、
 * 许可证集合强制随包（缺一即响亮失败）、禁止内容 fail-closed。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const { assembleCore } = require("../tools/runtime-pack-assemble.js");
const { buildPack } = require("../tools/runtime-pack-build.js");
const bootstrap = require("../tools/runtime-bootstrap.js");

function tmpdir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sch-asm-${tag}-`));
}

function w(base, rel, content) {
  const abs = path.join(base, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content || "x");
}

/** 最小但结构完整的假基线（保留仓库相对布局）。 */
function makeBaseline() {
  const base = tmpdir("baseline");
  w(base, "agent-canvas-demo/start-local.js", "// launcher");
  w(base, "agent-canvas-demo/index.html", "<html></html>");
  w(base, "agent-canvas-demo/shell-ui.js", "// XLSX chat card");
  w(base, "agent-canvas-demo/app.js", "// app");
  w(base, "agent-canvas-demo/README.md", "doc, not shipped"); // .md 不进 sidecar
  w(base, "agent-canvas-demo/research-pipeline.json", "{}");
  w(base, "agent-canvas-demo/bridge/server.js", "// bridge");
  w(base, "agent-canvas-demo/bridge/runtime/state.tmp", "ephemeral"); // 排除
  for (const moduleName of ["playwright", "playwright-core"]) {
    w(base, `agent-canvas-demo/node_modules/${moduleName}/package.json`, JSON.stringify({ name: moduleName, version: "1.62.0" }));
    w(base, `agent-canvas-demo/node_modules/${moduleName}/LICENSE`, "L".repeat(256));
    w(base, `agent-canvas-demo/node_modules/${moduleName}/NOTICE`, "N".repeat(256));
    w(base, `agent-canvas-demo/node_modules/${moduleName}/ThirdPartyNotices.txt`, "T".repeat(256));
  }
  w(base, "agent-canvas-demo/skills/sch-data-plot/scripts/generate_plot.py", "# plot");
  w(base, "agent-canvas-demo/skills/sch-data-plot/scripts/download_with_cookies.py", "# legit"); // 不误伤
  w(base, "tools/schema-objects.js", "// tool");
  w(base, "ketcher.js", "ketcher");
  w(base, "ketcher.css", "k");
  return base;
}

function fakeRuntime() {
  const node = tmpdir("node");
  w(node, process.platform === "win32" ? "node.exe" : "bin/node", "node");
  const py = tmpdir("python");
  w(py, "python.exe", "python");
  return { node, py };
}

describe("C1 装配顺序：sidecar 与 bridge 同级，先于 Ketcher", () => {
  it("完整基线装配成功，布局保留仓库相对结构", () => {
    const base = makeBaseline();
    const { node, py } = fakeRuntime();
    const out = tmpdir("out");
    const r = assembleCore({ baseline: base, nodeDist: node, pythonEmbed: py, out });
    assert.deepEq(r.missing, []);
    const must = [
      "agent-canvas-demo/start-local.js",
      "agent-canvas-demo/bridge/server.js",
      "agent-canvas-demo/shell-ui.js", // sidecar 载荷关键项
      "agent-canvas-demo/index.html",
      "agent-canvas-demo/node_modules/playwright/package.json",
      "agent-canvas-demo/node_modules/playwright-core/package.json",
      "agent-canvas-demo/skills/sch-data-plot/scripts/generate_plot.py",
      "agent-canvas-demo/skills/sch-data-plot/scripts/download_with_cookies.py",
      "tools/schema-objects.js",
      "ketcher/ketcher.js",
      "THIRD_PARTY/node.LICENSE.txt",
      "THIRD_PARTY/python.LICENSE.txt",
      "THIRD_PARTY/ketcher.LICENSE.txt",
      "THIRD_PARTY/ketcher.NOTICE.txt",
    ];
    const have = new Set(r.files.map((f) => f.path.replace(/\\/g, "/")));
    for (const m of must) assert.eq(have.has(m), true, `缺少 ${m}`);
    // 排除项
    assert.eq(have.has("agent-canvas-demo/README.md"), false, "文档不进 sidecar 载荷");
    assert.eq(have.has("agent-canvas-demo/bridge/runtime/state.tmp"), false, "短暂状态被排除");
    assert.eq(r.counts.sidecar > 0 && r.counts.bridge > 0, true, "sidecar 与 bridge 同级计数");
  });

  it("缺 shell-ui.js 时响亮失败——sidecar 是载荷关键项，不可静默跳过", () => {
    const base = makeBaseline();
    fs.rmSync(path.join(base, "agent-canvas-demo", "shell-ui.js"));
    const { node, py } = fakeRuntime();
    const r = assembleCore({ baseline: base, nodeDist: node, pythonEmbed: py, out: tmpdir("out") });
    assert.eq(r.missing.some((m) => m.includes("shell-ui.js")), true);
  });

  it("缺 Playwright 模块时在装配期失败，而不是首次 WebVPN 登录时才失败", () => {
    const base = makeBaseline();
    fs.rmSync(path.join(base, "agent-canvas-demo", "node_modules", "playwright"), { recursive: true });
    const { node, py } = fakeRuntime();
    const r = assembleCore({ baseline: base, nodeDist: node, pythonEmbed: py, out: tmpdir("out") });
    assert.eq(r.missing.some((m) => m.includes("node_modules/playwright")), true);
  });
});

describe("C6 许可证集合：不可裁剪", () => {
  it("许可证目录为空时装配失败并点名 C6", () => {
    const base = makeBaseline();
    const { node, py } = fakeRuntime();
    const r = assembleCore({ baseline: base, nodeDist: node, pythonEmbed: py, licensesDir: tmpdir("nolicense"), out: tmpdir("out") });
    const lic = r.missing.filter((m) => m.includes("许可证"));
    assert.eq(lic.length, 5, "五份必需许可证全部点名");
    assert.eq(r.missing.some((m) => m.includes("C6 不可裁剪")), true);
  });

  it("真实许可证文件全部随包且非空（>200 字节防占位符）", () => {
    const licDir = path.join(__dirname, "..", "tools", "runtime-licenses");
    for (const f of ["node.LICENSE.txt", "python.LICENSE.txt", "apache-2.0.txt", "ketcher.LICENSE.txt", "ketcher.NOTICE.txt"]) {
      const abs = path.join(licDir, f);
      assert.eq(fs.existsSync(abs), true, `存在 ${f}`);
      assert.eq(fs.statSync(abs).size > 200, true, `${f} 非占位符`);
    }
  });
});

describe("装配安全：凭据 fail-closed", () => {
  it("bridge.config.json（含 token）出现在基线时直接抛错", () => {
    const base = makeBaseline();
    w(base, "agent-canvas-demo/bridge/bridge.config.json", '{"token":"secret"}');
    const { node, py } = fakeRuntime();
    let threw = null;
    try {
      assembleCore({ baseline: base, nodeDist: node, pythonEmbed: py, out: tmpdir("out") });
    } catch (e) { threw = e; }
    assert.eq(!!threw, true);
    assert.eq(threw.message.includes("禁止发布"), true);
  });
});

describe("装配→打包→安装 全链路", () => {
  it("从假基线到 ready 状态端到端", async () => {
    const base = makeBaseline();
    const { node, py } = fakeRuntime();
    const staging = tmpdir("staging");
    const asm = assembleCore({ baseline: base, nodeDist: node, pythonEmbed: py, out: staging });
    assert.deepEq(asm.missing, []);
    const out = tmpdir("packs");
    buildPack({ name: "core", version: "2.0.9", platform: "win32-x64", from: staging, out });
    const m = JSON.parse(fs.readFileSync(path.join(out, "scholarium-runtime-manifest-2.0.9.json"), "utf8"));
    const root = tmpdir("root");
    await bootstrap.install({ rootDir: root, manifest: m, resolvePackUrl: (p) => path.join(out, p.file) });
    assert.eq(bootstrap.status(root).state, "ready");
    const installed = path.join(root, "versions", "2.0.9", "core");
    assert.eq(fs.existsSync(path.join(installed, "agent-canvas-demo", "shell-ui.js")), true);
    assert.eq(fs.existsSync(path.join(installed, "THIRD_PARTY", "ketcher.NOTICE.txt")), true);
  });
});
