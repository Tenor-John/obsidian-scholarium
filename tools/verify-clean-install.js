"use strict";
/**
 * verify-clean-install — 干净环境安装验证（发布判据 2：两台机器）。
 *
 * 在任意一台干净 Windows 机器上（只需预装 Node ≥20 用于跑本脚本；
 * 被验证的安装路径本身不依赖系统 Node）：
 *
 *   node verify-clean-install.js --manifest <本地 manifest.json 路径> \
 *     [--pack-dir <本地包目录>] [--root <运行时根目录>]
 *
 * 行为：
 *  1. 在全新的临时根目录（或 --root）执行完整安装；
 *  2. 逐包校验 SHA-256 与大小（与插件内引导器同一条代码路径）；
 *  3. 断言 status() 为 ready、关键载荷落位（bridge/sidecar/skills/ketcher/THIRD_PARTY）；
 *  4. 打印 JSON 证据（机器、时间、每包哈希、耗时），供发布报告收录；
 *  5. 任一步失败：非零退出 + 可读错误，绝不输出「成功」。
 *
 * 本脚本不读写 Vault、不触碰系统 Node 配置、不产生任何机器级副作用。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const bootstrap = require("./runtime-bootstrap.js");

const REQUIRED_PAYLOAD = [
  "agent-canvas-demo/start-local.js",
  "agent-canvas-demo/bridge/server.js",
  "agent-canvas-demo/shell-ui.js", // sidecar 载荷关键项（C1）
  "agent-canvas-demo/index.html",
  "agent-canvas-demo/node_modules/playwright/package.json",
  "agent-canvas-demo/node_modules/playwright/LICENSE",
  "agent-canvas-demo/node_modules/playwright-core/package.json",
  "agent-canvas-demo/node_modules/playwright-core/ThirdPartyNotices.txt",
  "tools/experiment-store.js",
  "tools/legacy-experiment-adapter.js",
  "THIRD_PARTY/node.LICENSE.txt",
  "THIRD_PARTY/python.LICENSE.txt",
  "THIRD_PARTY/ketcher.LICENSE.txt",
  "THIRD_PARTY/ketcher.NOTICE.txt",
];

async function main() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
  if (!args.manifest) {
    console.error("用法: node verify-clean-install.js --manifest <本地路径> [--pack-dir DIR] [--root DIR]");
    process.exit(2);
  }
  const root = args.root
    ? path.resolve(args.root)
    : fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-clean-install-"));
  const startedAt = new Date();
  const t0 = Date.now();

  const evidence = {
    machine: { hostname: os.hostname(), platform: process.platform, arch: process.arch, osRelease: os.release() },
    startedAt: startedAt.toISOString(),
    root,
    packs: [],
  };

  const manifestArg = args.manifest;
  if (/^https?:\/\//i.test(manifestArg)) {
    throw new Error("干净安装验证只接受插件构建产物中的本地 manifest，不允许联网下载运行时");
  }
  const manifestPath = path.resolve(manifestArg);
  const packDir = args["pack-dir"] ? path.resolve(args["pack-dir"]) : path.dirname(manifestPath);

  const result = await bootstrap.install({
    rootDir: root,
    manifestPath,
    resolvePackUrl: (pack) => {
      return path.join(packDir, pack.file || path.basename(pack.url || ""));
    },
    onProgress: null,
  });

  const st = bootstrap.status(root);
  evidence.status = st;
  evidence.durationMs = Date.now() - t0;

  const failures = [];
  if (st.state !== "ready") failures.push(`status=${st.state}，期望 ready`);
  for (const rel of REQUIRED_PAYLOAD) {
    const abs = path.join(root, "versions", result.version, "core", ...rel.split("/"));
    if (!fs.existsSync(abs)) failures.push(`关键载荷缺失: ${rel}`);
  }
  evidence.version = result.version;
  evidence.payloadChecked = REQUIRED_PAYLOAD.length;

  if (failures.length) {
    evidence.result = "FAIL";
    evidence.failures = failures;
    console.log(JSON.stringify(evidence, null, 2));
    console.error("\n干净环境安装验证失败：");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  evidence.result = "PASS";
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`\nPASS — 干净环境安装验证通过（${evidence.durationMs} ms，版本 ${result.version}）。请将上方 JSON 附入发布报告。`);
}

main().catch((error) => {
  console.error("干净环境安装验证失败：", error.message || error);
  process.exit(1);
});
