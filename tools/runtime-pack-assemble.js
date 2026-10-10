"use strict";
/**
 * runtime-pack-assemble — 从冻结基线装配 core 运行时包的 staging 目录。
 *
 * 装配顺序（C1，2026-09-20 协调结论）：sidecar 是载荷关键项——
 * agent-canvas-demo/shell-ui.js 承载已宣称的 XLSX 聊天卡功能，不是可选增强。
 * 因此 sidecar 与 bridge 同级，排在 Ketcher 之前：
 *
 *   1. bridge/       agent-canvas-demo/bridge/** + start-local.js + 生产 node_modules
 *   2. sidecar/      agent-canvas-demo 的浏览器载荷（index.html、shell-ui.js、
 *                    *-core.js / UI js、*.css、fonts/、assets/、research-pipeline.json）
 *   3. skills/       agent-canvas-demo/skills/**
 *   4. tools/        仓库根 tools/**
 *   5. runtime/node/ + runtime/python/   解释器（--node-dist / --python-embed）
 *   6. ketcher/      ketcher.js + ketcher.css
 *   7. THIRD_PARTY/  许可证集合（C6：缺一即构建失败，不允许裁剪）
 *
 * 目录布局**完整保留仓库相对结构**：
 *   <pack>/agent-canvas-demo/{start-local.js, index.html, shell-ui.js, …, bridge/, skills/, node_modules/}
 *   <pack>/tools/
 * 因为 bridge 与 skills 以 `../skills`、`../../tools` 相对引用（见
 * bridge/server.js 的 require('../../tools/…')），任何扁平化都会让 Bridge 起不来。
 *
 * 排除（对齐 A 归属表「Prohibited release content」）：bridge.config.json、
 * runtime/、audit/、agent-output/、output/、tests/、*.bak*、日志、pidfile、
 * cookie、.env。Playwright 的 JavaScript 模块属于 core：即使复用系统
 * Edge/Chrome，paper-downloader 也必须先能 require('playwright')。
 *
 * 用法：
 *   node tools/runtime-pack-assemble.js --baseline <冻结基线目录> \
 *     --node-dist <node 解压目录> --python-embed <python embeddable 解压目录> \
 *     --out <staging 目录>
 *
 * 任何必需项缺失：响亮失败（非零退出 + 可读清单），绝不产出残缺包。
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SIDECAR_WEB_EXT = new Set([".html", ".js", ".css", ".json", ".svg", ".png", ".woff", ".woff2", ".ttf"]);

/** 凭据/私密内容：出现即响亮失败（fail closed，对齐 A 的发布扫描器）。 */
const FORBIDDEN = [
  /bridge\.config\.json$/i,
  /(^|[\\/])\.env(\.|$)/i,
  /\.(pid|token)$/i,
  /(^|[\\/])[^\\/]*cookies?\.(txt|json|sqlite)$/i, // cookie 存储；不误伤 download_with_cookies.py
  /data\.json$/i,
];

/** 短暂/开发产物：静默排除（桥接运行时状态、审计输出、缓存、测试）。 */
const EXCLUDED = [
  /(^|[\\/])(agent-output|output|runtime|audit|__pycache__|tests|docs)([\\/]|$)/i,
  /\.bak[.-]/i,
  /\.log$/i,
];

function assertForbiddenFree(rel) {
  for (const re of FORBIDDEN) {
    if (re.test(rel)) throw new Error(`禁止发布的内容进入装配: ${rel}`);
  }
}
function isExcluded(rel) {
  return EXCLUDED.some((re) => re.test(rel));
}

function copyTree(src, dest, { filter } = {}) {
  if (!fs.existsSync(src)) return { copied: 0, missing: [src] };
  let copied = 0;
  (function walk(s, d, rel) {
    for (const name of fs.readdirSync(s)) {
      const sp = path.join(s, name);
      const r = rel ? rel + "/" + name : name;
      const st = fs.lstatSync(sp);
      if (isExcluded(r)) continue;
      if (st.isDirectory()) { walk(sp, path.join(d, name), r); continue; }
      if (filter && !filter(r)) continue;
      assertForbiddenFree(r);
      fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(sp, path.join(d, name));
      copied++;
    }
  })(src, dest, "");
  return { copied, missing: [] };
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * 装配 core staging。返回 { files, missing, notes, licenses, counts }；
 * missing 非空时调用方必须视为失败（CLI 直接非零退出）。
 */
function assembleCore({ baseline, nodeDist, pythonEmbed, licensesDir, out }) {
  const missing = [];
  const notes = [];
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const demo = path.join(baseline, "agent-canvas-demo");
  const demoOut = path.join(out, "agent-canvas-demo");
  if (!fs.existsSync(demo)) missing.push("agent-canvas-demo/（整个 sidecar 目录）");

  /* 1. bridge（与 sidecar 同级，第一梯队） */
  const bridge = copyTree(path.join(demo, "bridge"), path.join(demoOut, "bridge"));
  missing.push(...bridge.missing.map((m) => `bridge: ${m}`));
  if (!copyFile(path.join(demo, "start-local.js"), path.join(demoOut, "start-local.js"))) {
    missing.push("bridge 启动器 agent-canvas-demo/start-local.js");
  }
  copyFile(path.join(demo, "package.json"), path.join(demoOut, "package.json"));
  const nm = copyTree(path.join(demo, "node_modules"), path.join(demoOut, "node_modules"));
  if (nm.missing.length) {
    notes.push("未找到 node_modules：Bridge 的 Node 技能不可用；发布前必须在基线执行完整 npm ci（Playwright 虽声明为 devDependency，却是 paper-downloader 的运行时依赖，不得 --omit=dev）");
  }
  // Playwright is declared as a devDependency in the development tree, but it
  // is a production runtime dependency of paper-downloader. A core assembled
  // after `npm ci --omit=dev` would otherwise look healthy and fail only when
  // the researcher first opens WebVPN. Fail at packaging time instead.
  for (const moduleName of ["playwright", "playwright-core"]) {
    const moduleDir = path.join(demoOut, "node_modules", moduleName);
    if (!fs.existsSync(path.join(moduleDir, "package.json"))) {
      missing.push(`浏览器运行时模块 node_modules/${moduleName}（core 必需；装配前执行完整 npm ci，不得 --omit=dev）`);
      continue;
    }
    for (const legal of ["LICENSE", "NOTICE", "ThirdPartyNotices.txt"]) {
      if (!fs.existsSync(path.join(moduleDir, legal))) {
        missing.push(`Playwright 许可证文件缺失: node_modules/${moduleName}/${legal}`);
      }
    }
  }

  /* 2. sidecar 浏览器载荷（XLSX 聊天卡所在，与 bridge 同级，先于 Ketcher） */
  let sidecarCount = 0;
  if (fs.existsSync(demo)) {
    for (const name of fs.readdirSync(demo)) {
      const sp = path.join(demo, name);
      if (fs.lstatSync(sp).isDirectory()) {
        if (["fonts", "assets"].includes(name)) {
          sidecarCount += copyTree(sp, path.join(demoOut, name)).copied;
        }
        continue; // bridge/skills/node_modules/tests/docs 等已另行处理或排除
      }
      const ext = path.extname(name).toLowerCase();
      if (SIDECAR_WEB_EXT.has(ext) && !/^package(-lock)?\.json$/.test(name)) {
        assertForbiddenFree(name);
        if (copyFile(sp, path.join(demoOut, name))) sidecarCount++;
      }
    }
  }
  if (!fs.existsSync(path.join(demoOut, "shell-ui.js"))) missing.push("sidecar 载荷 shell-ui.js（XLSX 聊天卡）");
  if (!fs.existsSync(path.join(demoOut, "index.html"))) missing.push("sidecar 载荷 index.html");

  /* 3. skills */
  const skills = copyTree(path.join(demo, "skills"), path.join(demoOut, "skills"));
  missing.push(...skills.missing.map((m) => `skills: ${m}`));

  /* 4. 仓库根 tools/（bridge/skills 经 ../../tools 引用，缺了 Bridge 起不来） */
  const tools = copyTree(path.join(baseline, "tools"), path.join(out, "tools"), {
    filter: (rel) => /\.(js|py)$/.test(rel),
  });
  if (tools.missing.length) missing.push("tools/（Bridge 的 ../../tools 依赖）");

  /* 5. 解释器 */
  const nodeExe = process.platform === "win32" ? "node.exe" : path.join("bin", "node");
  if (nodeDist && fs.existsSync(path.join(nodeDist, nodeExe))) {
    copyTree(nodeDist, path.join(out, "runtime", "node"));
  } else {
    missing.push("Node 运行时（--node-dist 指向官方 zip 解压目录，需含 node.exe）");
  }
  if (pythonEmbed && fs.existsSync(path.join(pythonEmbed, "python.exe"))) {
    copyTree(pythonEmbed, path.join(out, "runtime", "python"));
  } else {
    missing.push("Python embeddable（--python-embed 指向解压目录，需含 python.exe）");
  }

  /* 6. ketcher（排在 sidecar 之后） */
  if (!copyFile(path.join(baseline, "ketcher.js"), path.join(out, "ketcher", "ketcher.js"))) missing.push("ketcher.js");
  if (!copyFile(path.join(baseline, "ketcher.css"), path.join(out, "ketcher", "ketcher.css"))) missing.push("ketcher.css");

  /* 7. C6：许可证集合——缺一即失败，不允许裁剪 */
  const REQUIRED_LICENSES = [
    ["node.LICENSE.txt", "Node.js"],
    ["python.LICENSE.txt", "Python（PSF）"],
    ["apache-2.0.txt", "Apache-2.0（Ketcher 适用条款全文）"],
    ["ketcher.LICENSE.txt", "Ketcher LICENSE"],
    ["ketcher.NOTICE.txt", "Ketcher NOTICE"],
  ];
  const licDir = licensesDir || path.join(__dirname, "runtime-licenses");
  const licenses = [];
  for (const [file, label] of REQUIRED_LICENSES) {
    const src = path.join(licDir, file);
    if (!fs.existsSync(src) || fs.statSync(src).size < 200) {
      missing.push(`许可证缺失或过短: ${file}（${label}）——C6 不可裁剪，缺了不得发布`);
    } else {
      copyFile(src, path.join(out, "THIRD_PARTY", file));
      licenses.push({ file, sha256: sha256File(src) });
    }
  }

  /* 内容清单（供发布审计） */
  const files = [];
  (function walk(dir, rel) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const abs = path.join(dir, name);
      const r = rel ? rel + "/" + name : name;
      if (fs.lstatSync(abs).isDirectory()) walk(abs, r);
      else files.push({ path: r, size: fs.statSync(abs).size, sha256: sha256File(abs) });
    }
  })(out, "");

  return {
    files, missing, notes, licenses,
    counts: { bridge: bridge.copied, sidecar: sidecarCount, skills: skills.copied, tools: tools.copied },
  };
}

/* --------------------------------------------------------------- cli ---- */

if (require.main === module) {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  if (!args.baseline || !args.out) {
    console.error("用法: node tools/runtime-pack-assemble.js --baseline DIR --out DIR [--node-dist DIR] [--python-embed DIR] [--licenses DIR]");
    process.exit(2);
  }
  const r = assembleCore({
    baseline: path.resolve(args.baseline),
    nodeDist: args["node-dist"] && path.resolve(args["node-dist"]),
    pythonEmbed: args["python-embed"] && path.resolve(args["python-embed"]),
    licensesDir: args.licenses && path.resolve(args.licenses),
    out: path.resolve(args.out),
  });
  console.log(`装配: bridge=${r.counts.bridge} sidecar=${r.counts.sidecar} skills=${r.counts.skills} tools=${r.counts.tools}，共 ${r.files.length} 个文件`);
  for (const n of r.notes) console.log(`注意: ${n}`);
  if (r.missing.length) {
    console.error("\n装配失败，缺少必需项:");
    for (const m of r.missing) console.error(`  ✗ ${m}`);
    process.exit(1);
  }
  console.log("装配完整，可进入 runtime-pack-build.js 打包。");
}

module.exports = { assembleCore };
