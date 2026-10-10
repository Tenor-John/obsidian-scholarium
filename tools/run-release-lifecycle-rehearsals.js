"use strict";

/**
 * A4 release lifecycle rehearsal.
 *
 * This is a headless release-artifact drill, not a substitute for the final
 * Obsidian UI drill.  It installs exactly the three files delivered by BRAT,
 * preserves representative user state, upgrades from the last 2.0.8 commit,
 * and restores the exact 2.0.8 bytes on rollback.  It also fails loudly while
 * the 2.0.9 main.js has no verified-runtime bootstrap integration.
 *
 * Usage:
 *   node tools/run-release-lifecycle-rehearsals.js \
 *     --work-root D:\scholarium-a4-rehearsals --rounds 2
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RELEASE_FILES = ["main.js", "manifest.json", "styles.css"];
const DEFAULT_OLD_REF = "0010d25^";
const RUNTIME_BOOTSTRAP_MARKERS = [
  /scholarium-runtime-pack\/1/,
  /scholarium-runtime-manifest/,
  /runtime-bootstrap/,
];

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 2) {
    const key = String(argv[index] || "").replace(/^--/, "");
    const value = argv[index + 1];
    if (!key || value == null) throw new Error(`参数缺少值: ${argv[index] || "(empty)"}`);
    args[key] = value;
  }
  return args;
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function ensureSafeWorkRoot(workRoot, repoRoot) {
  const resolved = path.resolve(workRoot);
  const repo = path.resolve(repoRoot);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) throw new Error("演练根目录不能是磁盘根目录");
  if (resolved === repo || resolved.startsWith(repo + path.sep)) {
    throw new Error("演练根目录必须在仓库外，防止覆盖源码或部署插件");
  }
  if (resolved.length < parsed.root.length + 8) throw new Error("演练根目录过宽，已拒绝");
  return resolved;
}

function gitBlob(repoRoot, ref, rel) {
  return execFileSync("git", ["show", `${ref}:${rel}`], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function candidateBlob(repoRoot, rel) {
  return fs.readFileSync(path.join(repoRoot, rel));
}

function releaseFromRef(repoRoot, ref) {
  const files = Object.fromEntries(RELEASE_FILES.map((rel) => [rel, gitBlob(repoRoot, ref, rel)]));
  return { files, manifest: JSON.parse(files["manifest.json"].toString("utf8")) };
}

function releaseFromDisk(repoRoot) {
  const files = Object.fromEntries(RELEASE_FILES.map((rel) => [rel, candidateBlob(repoRoot, rel)]));
  return { files, manifest: JSON.parse(files["manifest.json"].toString("utf8")) };
}

function installRelease(pluginDir, release) {
  fs.mkdirSync(pluginDir, { recursive: true });
  for (const rel of RELEASE_FILES) fs.writeFileSync(path.join(pluginDir, rel), release.files[rel]);
}

function releaseHashes(release) {
  return Object.fromEntries(RELEASE_FILES.map((rel) => [rel, sha256Buffer(release.files[rel])]));
}

function diskHashes(pluginDir) {
  return Object.fromEntries(RELEASE_FILES.map((rel) => [rel, sha256File(path.join(pluginDir, rel))]));
}

function sameHashes(actual, expected) {
  return RELEASE_FILES.every((rel) => actual[rel] === expected[rel]);
}

function writeFixtureState(vaultRoot) {
  const files = {
    ".obsidian/plugins/obsidian-scholarium/data.json": JSON.stringify({
      fixture: "A4-preserve-me",
      schemaVersion: 1,
    }, null, 2) + "\n",
    "Materials/source.txt": "time signal\n0 1\n1 2\n",
    "Research/existing-note.md": "# Existing research\n\nMust survive install, upgrade, and rollback.\n",
  };
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(vaultRoot, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return Object.fromEntries(Object.keys(files).map((rel) => [rel, sha256File(path.join(vaultRoot, ...rel.split("/")))]));
}

function stateHashes(vaultRoot, expected) {
  return Object.fromEntries(Object.keys(expected).map((rel) => {
    const target = path.join(vaultRoot, ...rel.split("/"));
    return [rel, fs.existsSync(target) ? sha256File(target) : null];
  }));
}

function runtimeBootstrapStatus(mainBuffer) {
  const source = mainBuffer.toString("utf8");
  const markers = RUNTIME_BOOTSTRAP_MARKERS.filter((re) => re.test(source)).map(String);
  const legacySidecarReferences = ["agent-canvas-demo", "ketcher.js"].filter((needle) => source.includes(needle));
  return {
    integrated: markers.length > 0,
    markers,
    legacySidecarReferences,
  };
}

function nodeSyntaxCheck(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { encoding: "utf8", stdio: "pipe" });
    return { pass: true };
  } catch (error) {
    return { pass: false, error: String(error.stderr || error.message || error).trim() };
  }
}

function result(name, checks, details = {}) {
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([key]) => key);
  return { name, pass: failed.length === 0, failed, checks, ...details };
}

function cleanInstallDrill(roundRoot, candidate) {
  const vault = path.join(roundRoot, "clean-install-vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
  fs.mkdirSync(vault, { recursive: true });
  installRelease(pluginDir, candidate);
  const runtime = runtimeBootstrapStatus(candidate.files["main.js"]);
  return result("clean-vault-install", {
    candidate_version_is_2_0_9: candidate.manifest.version === "2.0.9",
    three_release_files_exact: sameHashes(diskHashes(pluginDir), releaseHashes(candidate)),
    main_js_syntax_valid: nodeSyntaxCheck(path.join(pluginDir, "main.js")).pass,
    runtime_bootstrap_wiring_marker_present: runtime.integrated,
  }, { vault, runtime });
}

function upgradeDrill(roundRoot, oldRelease, candidate) {
  const vault = path.join(roundRoot, "upgrade-vault");
  const pluginDir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
  installRelease(pluginDir, oldRelease);
  const beforeState = writeFixtureState(vault);
  const oldHashes = diskHashes(pluginDir);
  installRelease(pluginDir, candidate);
  const afterState = stateHashes(vault, beforeState);
  const runtime = runtimeBootstrapStatus(candidate.files["main.js"]);
  return {
    drill: result("upgrade-2.0.8-to-2.0.9", {
      old_version_is_2_0_8: oldRelease.manifest.version === "2.0.8",
      old_release_installed_exactly: sameHashes(oldHashes, releaseHashes(oldRelease)),
      candidate_release_installed_exactly: sameHashes(diskHashes(pluginDir), releaseHashes(candidate)),
      plugin_data_preserved: afterState[".obsidian/plugins/obsidian-scholarium/data.json"] === beforeState[".obsidian/plugins/obsidian-scholarium/data.json"],
      materials_preserved: afterState["Materials/source.txt"] === beforeState["Materials/source.txt"],
      research_preserved: afterState["Research/existing-note.md"] === beforeState["Research/existing-note.md"],
      runtime_bootstrap_wiring_marker_present: runtime.integrated,
    }, { vault, runtime }),
    vault,
    pluginDir,
    beforeState,
  };
}

function rollbackDrill(upgrade, oldRelease) {
  installRelease(upgrade.pluginDir, oldRelease);
  const afterState = stateHashes(upgrade.vault, upgrade.beforeState);
  return result("rollback-to-2.0.8", {
    old_release_restored_byte_for_byte: sameHashes(diskHashes(upgrade.pluginDir), releaseHashes(oldRelease)),
    plugin_data_preserved: afterState[".obsidian/plugins/obsidian-scholarium/data.json"] === upgrade.beforeState[".obsidian/plugins/obsidian-scholarium/data.json"],
    materials_preserved: afterState["Materials/source.txt"] === upgrade.beforeState["Materials/source.txt"],
    research_preserved: afterState["Research/existing-note.md"] === upgrade.beforeState["Research/existing-note.md"],
  }, { vault: upgrade.vault });
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, "..");
  const workRoot = ensureSafeWorkRoot(args["work-root"] || path.join(process.cwd(), ".release-rehearsals"), repoRoot);
  const rounds = Number(args.rounds || 2);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 20) throw new Error("--rounds 必须是 1..20 的整数");
  const oldRef = args["old-ref"] || DEFAULT_OLD_REF;
  const oldRelease = releaseFromRef(repoRoot, oldRef);
  const candidate = releaseFromDisk(repoRoot);

  fs.rmSync(workRoot, { recursive: true, force: true });
  fs.mkdirSync(workRoot, { recursive: true });
  const report = {
    schema: "scholarium-release-lifecycle-rehearsal/1",
    generatedAt: new Date().toISOString(),
    classification: "headless-preflight-not-final-obsidian-ui-acceptance",
    repoRoot,
    workRoot,
    oldRef,
    oldVersion: oldRelease.manifest.version,
    candidateVersion: candidate.manifest.version,
    rounds: [],
  };

  for (let round = 1; round <= rounds; round++) {
    const roundRoot = path.join(workRoot, `round-${round}`);
    fs.mkdirSync(roundRoot, { recursive: true });
    const clean = cleanInstallDrill(roundRoot, candidate);
    const upgrade = upgradeDrill(roundRoot, oldRelease, candidate);
    const rollback = rollbackDrill(upgrade, oldRelease);
    report.rounds.push({ round, cleanInstall: clean, upgrade: upgrade.drill, rollback });
  }
  report.summary = {
    cleanInstall: report.rounds.map((item) => item.cleanInstall.pass),
    upgrade: report.rounds.map((item) => item.upgrade.pass),
    rollback: report.rounds.map((item) => item.rollback.pass),
    finalObsidianUiAcceptanceRequired: true,
  };
  const reportPath = path.join(workRoot, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  const passed = [...report.summary.cleanInstall, ...report.summary.upgrade, ...report.summary.rollback].every(Boolean);
  if (!passed) {
    process.stderr.write(`\nA4 演练存在失败；证据已写入 ${reportPath}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    console.error(`A4 演练无法开始: ${error.message || error}`);
    process.exit(2);
  }
}

module.exports = {
  ensureSafeWorkRoot,
  runtimeBootstrapStatus,
  releaseHashes,
  sameHashes,
};
