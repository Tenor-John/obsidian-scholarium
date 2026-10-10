"use strict";
/**
 * runtime-bootstrap — Scholarium 运行时包的下载、校验、原子安装与回滚。
 *
 * 对应策略文档 docs/out-of-box/runtime-pack-strategy.md：
 *  - manifest（schema scholarium-runtime-pack/1）先校验哈希，再逐包 sha256+size 校验；
 *  - 全部字节校验通过前不触碰最终目录；staging 解包 → rename 原子切换；
 *  - current.json 指针先写临时文件再 rename；保留一个旧版本供一键回滚；
 *  - tar 解包拒绝绝对路径、.. 穿越、符号链接（Zip Slip 防护）；
 *  - 运行时根目录在 Vault 与插件目录之外（§3 平台路径）。
 *
 * 纯 Node ≥20 标准库（fetch/zlib/crypto/fs），Obsidian 桌面端 Electron 满足。
 *
 * 主要 API：
 *   defaultRuntimeRoot({ platform, env, homeDir })
 *   status(rootDir)                → { state, activeVersion, previousVersion, packs }
 *   install({ rootDir, manifest, manifestPath, manifestUrl, manifestSha256,
 *             resolvePackUrl, fetchImpl, onProgress })
 *   installFromIncoming(rootDir)   → 离线兜底：安装 incoming/ 里的 .tar.gz
 *   rollback(rootDir)
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const MANIFEST_SCHEMA = "scholarium-runtime-pack/1";

/* ------------------------------------------------------- 路径与状态 ---- */

function defaultRuntimeRoot({ platform = process.platform, env = process.env, homeDir = os.homedir() } = {}) {
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local");
    return path.join(base, "Scholarium", "runtime");
  }
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "Scholarium", "runtime");
  }
  return path.join(env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"), "scholarium", "runtime");
}

function readCurrent(rootDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, "current.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * 解析运行时根的真实路径（C-P0-1）。
 * Windows 上运行时根可以是 NTFS 目录联接（磁盘紧张时把运行时引到别的盘）。
 * 对联接路径直接 mkdirSync(staging) 会报 ENOENT——联接目标是另一个卷上的
 * 绝对路径，相对它的子路径创建必须先在真实目标上落点。所有公开入口
 * （install / installFromIncoming / status / rollback）先过这里。
 * 根不存在时原样返回（install 会创建）；存在则返回解析后的真实路径。
 */
function resolveRoot(rootDir) {
  try {
    return fs.realpathSync(rootDir);
  } catch {
    return rootDir;
  }
}

/** 原子写 JSON：同目录临时文件 + rename。 */
function writeJsonAtomic(file, value) {
  const tmp = file + ".tmp-" + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

/**
 * 状态机（首次启动向导只显示这里的真实状态）：
 *   absent    从未安装
 *   ready     current.json 指向的版本目录完整存在
 *   degraded  指针存在但版本目录缺失/损坏（向导应自动回滚或重装）
 */
function status(rootDir) {
  rootDir = resolveRoot(rootDir);
  const current = readCurrent(rootDir);
  if (!current) return { state: "absent", activeVersion: null, previousVersion: null, packs: [] };
  const versionDir = path.join(rootDir, "versions", current.version);
  const packs = [];
  let intact = fs.existsSync(versionDir);
  if (intact) {
    for (const pack of current.packs || []) {
      const ok = fs.existsSync(path.join(versionDir, pack));
      packs.push({ name: pack, present: ok });
      if (!ok) intact = false;
    }
  }
  return {
    state: intact ? "ready" : "degraded",
    activeVersion: intact ? current.version : null,
    previousVersion: current.previous || null,
    packs,
  };
}

/* ------------------------------------------------------------ tar 读取 ---- */

function parseOctal(buf, off, width) {
  const s = buf.toString("latin1", off, off + width).replace(/\0.*$/s, "").trim();
  return s ? parseInt(s, 8) : 0;
}

/** 解包 tar Buffer 到目标目录。拒绝绝对路径、.. 穿越、符号链接/硬链接。 */
function extractTar(tar, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const destRoot = path.resolve(destDir);
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // 零块结尾
    const magic = header.toString("latin1", 257, 263);
    if (magic !== "ustar\0") throw new Error("不是有效的 ustar 归档");
    const name = header.toString("latin1", 0, 100).replace(/\0.*$/s, "");
    const prefix = header.toString("latin1", 345, 500).replace(/\0.*$/s, "");
    const rel = prefix ? prefix + "/" + name : name;
    const size = parseOctal(header, 124, 12);
    const type = header.toString("latin1", 156, 157);
    off += 512;

    if (!rel || rel.includes("\\")) throw new Error(`非法条目路径: ${rel}`);
    const target = path.resolve(destRoot, rel);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) {
      throw new Error(`拒绝路径穿越条目: ${rel}`);
    }
    if (type === "5") {
      fs.mkdirSync(target, { recursive: true });
    } else if (type === "0" || type === "\0") {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, tar.subarray(off, off + size));
    } else if (type === "1" || type === "2") {
      throw new Error(`运行时包不允许链接条目: ${rel}`);
    } else {
      // 其他类型（pax 扩展头 x/g、设备文件等）一律跳过内容，不接受
      if ("xg".includes(type)) { /* pax 头：跳过数据块即可 */ }
      else throw new Error(`不支持的 tar 条目类型 '${type}': ${rel}`);
    }
    off += Math.ceil(size / 512) * 512;
  }
}

/* -------------------------------------------------------- 下载与校验 ---- */

async function fetchBuffer(url, fetchImpl, onProgress, expectedSize) {
  const res = await (fetchImpl || fetch)(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const total = Number(res.headers.get("content-length")) || expectedSize || 0;
  const chunks = [];
  let received = 0;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    received += chunk.length;
    if (onProgress) onProgress({ received, total });
  }
  return Buffer.concat(chunks);
}

/**
 * 校验失败必须响亮且可读（C3）：拒绝安装、说明现状未变、给出出路，
 * 技术细节附后。绝不降级运行、绝不静默跳过。
 */
function verifyBuffer(buf, { sha256, size }, label) {
  const guidance =
    "已拒绝安装，现有运行时环境未被改动。可能原因：下载损坏或文件被篡改。" +
    "你可以重试下载；离线环境可把正确的包文件放入运行时目录的 incoming/ 文件夹后选择「从本地安装」。";
  if (typeof size === "number" && buf.length !== size) {
    throw new Error(`${label}完整性校验失败（文件大小不符）。${guidance}技术细节：期望 ${size} 字节，实际 ${buf.length} 字节。`);
  }
  const actual = crypto.createHash("sha256").update(buf).digest("hex");
  if (actual !== sha256) {
    throw new Error(`${label}完整性校验失败（SHA-256 不符）。${guidance}技术细节：期望 ${sha256}，实际 ${actual}。`);
  }
}

function loadManifest({ manifest, manifestPath }) {
  const raw = manifest !== undefined
    ? manifest
    : JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (raw.schema !== MANIFEST_SCHEMA) throw new Error(`未知 manifest schema: ${raw.schema}`);
  if (!raw.version || !Array.isArray(raw.packs) || raw.packs.length === 0) {
    throw new Error("manifest 缺少 version 或 packs");
  }
  for (const p of raw.packs) {
    if (!p.name || !p.sha256 || typeof p.size !== "number" || !(p.url || p.file)) {
      throw new Error(`manifest 中包条目不完整: ${JSON.stringify(p)}`);
    }
  }
  return raw;
}

/* ------------------------------------------------------------ 安装 ---- */

function emptyDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * 安装运行时。默认只装 required 包；includeOptional:['browser'] 显式追加。
 * 任一必需包失败：staging 清空、current.json 不动，旧版本继续可用。
 */
async function install({
  rootDir,
  manifest,
  manifestPath,
  manifestUrl,
  manifestSha256,
  resolvePackUrl, // (pack, manifest) => 可下载的 URL 或本地文件路径
  fetchImpl,
  includeOptional = [],
  onProgress,
}) {
  let m = manifest || (manifestPath ? loadManifest({ manifestPath }) : null);
  if (!m && manifestUrl) {
    const buf = await fetchBuffer(manifestUrl, fetchImpl, null);
    if (manifestSha256) verifyBuffer(buf, { sha256: manifestSha256 }, "运行时清单（manifest）");
    m = loadManifest({ manifest: JSON.parse(buf.toString("utf8")) });
  }
  if (!m) throw new Error("install 需要 manifest / manifestPath / manifestUrl 之一");

  // C-P0-1：先建根再解析联接。运行时根可以是 NTFS 目录联接（磁盘紧张时
  // 引向其他盘）；对联接下的子路径直接 mkdir 会 ENOENT，必须落到真实目标。
  if (!rootDir) throw new Error("install 需要 rootDir");
  fs.mkdirSync(rootDir, { recursive: true });
  rootDir = resolveRoot(rootDir);

  const staging = path.join(rootDir, "staging");
  const versionDir = path.join(rootDir, "versions", m.version);
  emptyDir(staging);

  const wanted = m.packs.filter((p) => p.required || includeOptional.includes(p.name));
  const installedPacks = [];
  try {
    for (const pack of wanted) {
      const url = resolvePackUrl ? resolvePackUrl(pack, m) : pack.url;
      if (!url) throw new Error(`包 ${pack.name} 没有可用下载地址（发布流水线未填 url）`);
      let buf;
      if (/^https?:\/\//.test(url)) {
        buf = await fetchBuffer(url, fetchImpl,
          onProgress && ((p) => onProgress({ pack: pack.name, ...p })), pack.size);
      } else {
        buf = fs.readFileSync(url); // 本地文件路径（离线兜底与测试共用同一条校验路径）
      }
      verifyBuffer(buf, pack, `运行时包「${pack.name}」`);
      const packDir = path.join(staging, pack.name);
      extractTar(zlib.gunzipSync(buf), packDir);
      installedPacks.push(pack.name);
    }
    // 全部必需包校验解包完成，才原子切换
    if (fs.existsSync(versionDir)) fs.rmSync(versionDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(versionDir), { recursive: true });
    fs.renameSync(staging, versionDir);
    const prev = readCurrent(rootDir);
    writeJsonAtomic(path.join(rootDir, "current.json"), {
      version: m.version,
      previous: prev && prev.version !== m.version ? prev.version : (prev ? prev.previous || null : null),
      installedAt: new Date().toISOString(),
      packs: installedPacks,
    });
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { version: m.version, packs: installedPacks };
}

/** 离线兜底：安装用户通过文件选择器放入 incoming/ 的包（走同一条校验路径）。 */
async function installFromIncoming(rootDir, { manifestPath, manifest } = {}) {
  rootDir = resolveRoot(rootDir); // C-P0-1：incoming 也必须在真实目标上读取
  const incoming = path.join(rootDir, "incoming");
  const m = loadManifest({ manifest, manifestPath: manifestPath || path.join(incoming, "manifest.json") });
  return install({
    rootDir,
    manifest: m,
    resolvePackUrl: (pack) => {
      const candidate = path.join(incoming, pack.file || path.basename(pack.url || ""));
      if (!fs.existsSync(candidate)) throw new Error(`incoming/ 中缺少包文件: ${path.basename(candidate)}`);
      return candidate;
    },
  });
}

/** 回滚：指针退回上一版本。零数据移动；无 previous 时转为 absent。 */
function rollback(rootDir) {
  rootDir = resolveRoot(rootDir);
  const current = readCurrent(rootDir);
  if (!current) throw new Error("没有已安装的运行时，无法回滚");
  if (!current.previous) {
    fs.rmSync(path.join(rootDir, "current.json"), { force: true });
    return { rolledBackTo: null };
  }
  const prevDir = path.join(rootDir, "versions", current.previous);
  if (!fs.existsSync(prevDir)) throw new Error(`上一版本目录已不存在: ${current.previous}`);
  writeJsonAtomic(path.join(rootDir, "current.json"), {
    version: current.previous,
    previous: null,
    installedAt: new Date().toISOString(),
    rolledBackFrom: current.version,
    packs: fs.readdirSync(prevDir).sort(),
  });
  return { rolledBackTo: current.previous };
}

module.exports = {
  MANIFEST_SCHEMA,
  defaultRuntimeRoot,
  status,
  install,
  installFromIncoming,
  rollback,
  resolveRoot,
  extractTar, // 导出供测试
};
