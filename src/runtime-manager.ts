// @ts-nocheck
/* Verified local-runtime lifecycle recovered as an explicit source module.
 * schRuntimeBootstrap is embedded by the deterministic release build from
 * tools/runtime-bootstrap.js; it is never downloaded as executable JS. */

/* Agent C runtime-pack contract, wired by Agent A after clean-install review.
 * These values are build-time release pins, never user settings. */
var SCH_RUNTIME_RELEASES = Object.freeze({
  "win32-x64": Object.freeze({
    version: "2.0.9-preview.4",
    platform: "win32-x64",
    manifestFile: "scholarium-runtime-manifest-2.0.9-preview.4.json",
    coreFile: "scholarium-runtime-core-2.0.9-preview.4-win32-x64.tar.gz",
    manifestUrl: "https://github.com/Tenor-John/scholarium-research_weaver/releases/download/2.0.9/scholarium-runtime-manifest-2.0.9-preview.4.json",
    manifestSha256: "b3cf62be30a322b1f39c40cc11cf1960dd250b3173cf17588ec87da51602620e",
  }),
  "linux-x64": Object.freeze({
    version: "2.0.9-preview.4",
    platform: "linux-x64",
    manifestFile: "scholarium-runtime-manifest-2.0.9-preview.4-linux-x64.json",
    coreFile: "scholarium-runtime-core-2.0.9-preview.4-linux-x64.tar.gz",
    manifestUrl: "https://github.com/Tenor-John/scholarium-research_weaver/releases/download/2.0.9/scholarium-runtime-manifest-2.0.9-preview.4-linux-x64.json",
    manifestSha256: "d0c4056fa323038920c04daaed70b40fe4ad354b2689c9076965c02ce0419104",
  }),
});
function schRuntimeReleaseFor(platform = process.platform, arch = process.arch) {
  return SCH_RUNTIME_RELEASES[`${platform}-${arch}`] || null;
}
function schRuntimeRequiredRelease() {
  const release = schRuntimeReleaseFor();
  if (!release) throw new Error(`Scholarium runtime 尚不支持 ${process.platform}-${process.arch}；当前支持 win32-x64、linux-x64。`);
  return release;
}
var SCH_RUNTIME_RELEASE = schRuntimeReleaseFor();
var schRuntimeInstallPromise = null;
var schRuntimeChildren = new Map();
var schRuntimeStartPromises = new Map();
var schRuntimePortsByScope = new Map();

function schRuntimeRoot() {
  return schRuntimeBootstrap.defaultRuntimeRoot();
}

function schRuntimeScope(app) {
  const value = String(app?.vault?.adapter?.getBasePath?.() || app?.vault?.name || "default");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v${(hash >>> 0).toString(36)}`;
}

/* SCHOLARIUM_RUNTIME_DIAGNOSIS_BEGIN */
/** 本机运行时没就绪时，告诉用户“哪里坏了、怎么修”，而不是只说“请稍候”。 */
function schRuntimeDiagnose() {
  const fs = require("node:fs"), path = require("node:path");
  const root = schRuntimeRoot();
  const out = { root, link: "", problems: [], fixes: [] };
  const release = schRuntimeReleaseFor();
  if (!release) {
    out.problems.push(`当前平台 ${process.platform}-${process.arch} 尚无 Scholarium 运行时。`);
    out.fixes.push("当前支持 Windows x64 与 Linux x64；其他架构需要对应的签名发布包。");
    return out;
  }
  let stat = null;
  try { stat = fs.lstatSync(root); } catch (_) { /* absent */ }
  if (!stat) {
    out.problems.push(`运行时目录不存在：${root}`);
    out.fixes.push("在织研者点“连接运行时”，插件会从 GitHub Release 自动下载并安装运行时（需要能访问 GitHub；会使用系统代理设置）。");
    return out;
  }
  if (stat.isSymbolicLink()) {
    try { out.link = fs.readlinkSync(root); } catch (_) { out.link = "（无法读取链接目标）"; }
    if (!fs.existsSync(root)) {
      out.problems.push(`运行时目录是一个链接，指向 ${out.link}，但这个位置已经不存在。`);
      out.fixes.push(`恢复 ${out.link} 这个文件夹；或者删除链接 ${root}，再在织研者点“连接运行时”重新安装。`);
      return out;
    }
  }
  if (!fs.existsSync(path.join(root, "current.json"))) {
    out.problems.push(`运行时目录里没有 current.json，说明安装没有完成${out.link ? `（该目录是指向 ${out.link} 的链接，可能指错了地方）` : ""}。`);
    out.fixes.push(out.link ? `确认链接目标 ${out.link} 是完整的运行时目录（里面应有 current.json 和 versions\\）；不是的话删除链接后重新连接安装。` : "在织研者点“连接运行时”重新安装。");
  }
  let status = null;
  try { status = schRuntimeBootstrap.status(root); } catch (error) { out.problems.push("读取运行时状态失败：" + (error && error.message || error)); }
  if (status && status.state === "degraded") {
    const missing = (status.packs || []).filter((pack) => !pack.present).map((pack) => pack.name);
    out.problems.push("运行时文件不完整" + (missing.length ? "，缺少：" + missing.join("、") : "（版本目录缺失）") + "。");
    out.fixes.push("在织研者点“连接运行时”会自动重新安装缺失部分；若反复失败，删除 " + root + " 后重新连接。");
  }
  if (status && status.state === "ready" && status.activeVersion !== release.version) {
    out.problems.push(`已安装的运行时版本是 ${status.activeVersion}，插件需要 ${release.version}。`);
    out.fixes.push("在织研者点“连接运行时”会安装新版本（需要访问 GitHub）。");
  }
  if (status && status.state === "ready" && status.activeVersion === release.version) {
    try { schRuntimeLaunchSpecUnchecked(); } catch (error) {
      out.problems.push(String(error && error.message || error));
      out.fixes.push("运行时文件被删改过：删除 " + root + "\\versions\\" + status.activeVersion + " 后重新连接安装。");
    }
  }
  const incomingNames = ["manifest.json", release.manifestFile];
  if (incomingNames.some((name) => fs.existsSync(path.join(root, "incoming", name)))) {
    out.fixes.push("检测到 " + path.join(root, "incoming") + " 里有离线安装包，点“连接运行时”会优先用它安装。");
  }
  return out;
}
function schRuntimeLaunchSpecUnchecked() {
  const fs = require("node:fs"), path = require("node:path");
  const release = schRuntimeRequiredRelease();
  const core = path.join(schRuntimeRoot(), "versions", release.version, "core");
  const required = [
    path.join(core, "runtime", "node", process.platform === "win32" ? "node.exe" : "bin/node"),
    path.join(core, "agent-canvas-demo", "start-local.js"),
    path.join(core, "runtime", "python", process.platform === "win32" ? "python.exe" : "bin/python3"),
  ];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error("运行时缺少文件：" + missing.join("；"));
}
/** 离线安装要放的文件（从 Release 页面下载，文件名和内容都不要改）。 */
function schRuntimeOfflineSteps(root) {
  const release = schRuntimeRequiredRelease();
  const releasePage = release.manifestUrl.replace(/\/download\/([^/]+)\/[^/]+$/, "/tag/$1");
  const incoming = root ? require("node:path").join(root, "incoming") : "运行时目录下的 incoming 文件夹";
  return "离线安装：在能访问 GitHub 的电脑打开 " + releasePage + "，下载 " + release.manifestFile + " 和 " + release.coreFile + "，原样放进 " + incoming + "，再点“连接运行时”。";
}

/** 下载失败分几种，各有各的修法；不再一律说“网络连不上”。 */
function schRuntimeDownloadProblem(message) {
  const http = /下载失败 HTTP (\d{3})/.exec(message);
  if (http) {
    const code = Number(http[1]);
    if (code === 404) { const release = schRuntimeRequiredRelease(); return { problem: "GitHub 上找不到运行时安装文件（HTTP 404）：2.0.9 Release 还没有发布，或者发布时少传了清单 / 安装包。", fix: "发布者需要在 GitHub 创建 2.0.9 Release，并上传 " + release.manifestFile + " 和 " + release.coreFile + "；在那之前只能离线安装。" }; }
    if (code === 401 || code === 403) return { problem: `GitHub 拒绝了下载请求（HTTP ${code}）：仓库或 Release 不是公开的，或者短时间内请求太多。`, fix: "确认仓库和 Release 是公开的；稍后再试，或离线安装。" };
    if (code >= 500) return { problem: `GitHub 服务暂时出错（HTTP ${code}）。`, fix: "过几分钟再点“连接运行时”。" };
    return { problem: `从 GitHub 下载运行时失败（HTTP ${code}）。`, fix: "稍后重试，或离线安装。" };
  }
  if (/完整性校验失败/.test(message)) return null; // 校验失败的说明已经写在错误里
  if (/下载失败（网络）|Failed to fetch|fetch failed|ERR_[A-Z_]+|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|getaddrinfo|socket hang up|network/i.test(message)) {
    const proxy = /PROXY/i.test(message);
    return {
      problem: proxy ? "连接代理失败：系统里设置的代理没有在运行或地址不对。" : "网络连不上 GitHub（github.com 或它的下载服务器）。",
      fix: proxy ? "启动代理软件，或在系统设置里关掉失效的代理，再点“连接运行时”。" : "打开代理 / VPN（插件会使用系统代理设置）后再点“连接运行时”。",
    };
  }
  return null;
}

function schRuntimeExplain(error) {
  const message = String(error && error.message || error || "");
  let diagnosis;
  try { diagnosis = schRuntimeDiagnose(); } catch (_) { diagnosis = { root: "", problems: [], fixes: [] }; }
  const download = schRuntimeDownloadProblem(message);
  if (download) {
    diagnosis.problems.push(download.problem);
    diagnosis.fixes.push(download.fix);
  }
  if (download || diagnosis.problems.some((problem) => /运行时目录不存在/.test(problem))) {
    diagnosis.fixes.push(schRuntimeOfflineSteps(diagnosis.root));
  }
  const lines = [message || "本机运行时没有就绪"];
  if (diagnosis.problems.length) lines.push("问题：" + diagnosis.problems.join(" "));
  if (diagnosis.fixes.length) lines.push("如何修复：" + diagnosis.fixes.map((fix, index) => `${index + 1}. ${fix}`).join(" "));
  if (diagnosis.root) lines.push("运行时目录：" + diagnosis.root);
  return lines.join("\n");
}
function schOpenRuntimeDiagnosis(app) {
  const { Modal, Notice } = require("obsidian");
  const diagnosis = schRuntimeDiagnose();
  const modal = new Modal(app);
  modal.titleEl.setText("本机运行时诊断");
  const body = modal.contentEl;
  body.createEl("p", { text: "运行时目录：" + diagnosis.root + (diagnosis.link ? "（链接 → " + diagnosis.link + "）" : "") }).setCssStyles({ wordBreak: "break-all" });
  if (!diagnosis.problems.length) body.createEl("p", { text: "没有发现安装问题。若仍连不上，请在织研者点“连接运行时”，再看错误提示。" });
  for (const problem of diagnosis.problems) body.createEl("p", { text: "问题：" + problem }).setCssStyles({ color: "var(--text-error)" });
  if (diagnosis.fixes.length) {
    body.createEl("b", { text: "如何修复" });
    const list = body.createEl("ol");
    for (const fix of diagnosis.fixes) list.createEl("li", { text: fix });
  }
  const row = body.createDiv();
  row.setCssStyles({ display: "flex", gap: "8px", marginTop: "10px" });
  row.createEl("button", { text: "打开运行时目录" }).onclick = () => {
    try { require("electron").shell.openPath(require("node:fs").existsSync(diagnosis.root) ? diagnosis.root : require("node:path").dirname(diagnosis.root)); }
    catch (_) { new Notice(diagnosis.root); }
  };
  row.createEl("button", { text: "复制诊断信息" }).onclick = () => {
    navigator.clipboard.writeText([diagnosis.root, diagnosis.link, ...diagnosis.problems, ...diagnosis.fixes].filter(Boolean).join("\n"));
    new Notice("已复制");
  };
  modal.open();
}
/* SCHOLARIUM_RUNTIME_DIAGNOSIS_END */
function schRuntimeLaunchSpec(plugin, state) {
  const req = window.require;
  if (!req) throw new Error("Obsidian 未提供本机 Node 接口");
  const fs = req("node:fs"), path = req("node:path");
  const root = schRuntimeRoot();
  const status = state || schRuntimeBootstrap.status(root);
  if (status.state !== "ready" || status.activeVersion !== SCH_RUNTIME_RELEASE.version) {
    throw new Error(`Scholarium runtime ${SCH_RUNTIME_RELEASE.version} 尚未就绪`);
  }
  const core = path.join(root, "versions", status.activeVersion, "core");
  const nodeExe = path.join(core, "runtime", "node", process.platform === "win32" ? "node.exe" : "bin/node");
  const pythonDir = path.join(core, "runtime", "python");
  const launcher = path.join(core, "agent-canvas-demo", "start-local.js");
  const required = [nodeExe, launcher, path.join(pythonDir, process.platform === "win32" ? "python.exe" : "bin/python3")];
  const missing = required.filter((file) => !fs.existsSync(file));
  if (missing.length) throw new Error(`已安装的 Scholarium runtime 不完整：${missing.join("；")}`);
  const scope = schRuntimeScope(plugin.app);
  const profileDir = path.join(root, "profiles", scope);
  fs.mkdirSync(profileDir, { recursive: true });
  return {
    source: "verified-runtime-pack",
    root,
    core,
    nodeExe,
    pythonDir,
    launcher,
    cwd: path.dirname(launcher),
    configPath: path.join(profileDir, "bridge.config.json"),
    pidfile: path.join(profileDir, "weaver.pid.json"),
  };
}

/* SCHOLARIUM_RUNTIME_DOWNLOAD_V2 */
/**
 * 下载运行时清单和安装包。不用页面里的 fetch：Obsidian 页面向 GitHub Release
 * 发跨域请求会被浏览器拦下（报 “Failed to fetch”，看起来像断网），而且它不一定
 * 走系统代理。Obsidian 的 requestUrl 由主进程发出，没有跨域限制，并使用系统代
 * 理设置。返回值是 runtime-bootstrap 的 fetchBuffer 需要的最小形状；内容仍由
 * bootstrap 按 manifest 的 SHA-256 与大小逐字节校验。
 */
async function schRuntimeFetch(url) {
  const { requestUrl } = require("obsidian");
  let response;
  try {
    response = await requestUrl({ url: String(url), method: "GET", throw: false });
  } catch (error) {
    const reason = String(error && error.message || error || "");
    let host = "";
    try { host = new URL(String(url)).host; } catch (_) { host = String(url); }
    const failure = new Error(`下载失败（网络）：连不上 ${host}：${reason}`);
    failure.schRuntimeDownload = "network";
    throw failure;
  }
  const status = Number(response.status) || 0;
  const headers = response.headers || {};
  const bytes = status >= 200 && status < 300 && response.arrayBuffer ? new Uint8Array(response.arrayBuffer) : new Uint8Array(0);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: String(url),
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? headers[name] ?? null },
    body: [bytes],
  };
}

/** 离线安装包里的清单：manifest.json，或从 Release 原样下载的文件名。 */
function schRuntimeIncomingManifest(root) {
  const fs = require("node:fs"), path = require("node:path");
  const release = schRuntimeRequiredRelease();
  const names = ["manifest.json", release.manifestFile];
  for (const name of names) {
    const file = path.join(root, "incoming", name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

async function schEnsureRuntimeInstalled(plugin, onProgress) {
  const req = window.require;
  if (!req) throw new Error("Obsidian 未提供本机 Node 接口");
  const release = schRuntimeRequiredRelease();
  const fs = req("node:fs"), path = req("node:path");
  const root = schRuntimeRoot();
  const current = schRuntimeBootstrap.status(root);
  if (current.state === "ready" && current.activeVersion === release.version) {
    return schRuntimeLaunchSpec(plugin, current);
  }
  if (!schRuntimeInstallPromise) {
    schRuntimeInstallPromise = (async () => {
      const incomingManifest = schRuntimeIncomingManifest(root);
      if (incomingManifest) {
        // 离线安装也认同一个发布清单：清单的 SHA-256 必须等于插件里固定的值，
        // 包再按清单逐个校验。
        const digest = require("node:crypto").createHash("sha256").update(fs.readFileSync(incomingManifest)).digest("hex");
        if (digest !== release.manifestSha256) {
          throw new Error(`离线安装清单与插件要求的版本不符（${path.basename(incomingManifest)} 的 SHA-256 是 ${digest}，需要 ${release.manifestSha256}）。请从 2.0.9 Release 页面重新下载 ${release.manifestFile}，不要修改它的内容。`);
        }
        await schRuntimeBootstrap.installFromIncoming(root, { manifestPath: incomingManifest });
      } else {
        await schRuntimeBootstrap.install({
          rootDir: root,
          manifestUrl: release.manifestUrl,
          manifestSha256: release.manifestSha256,
          fetchImpl: schRuntimeFetch,
          onProgress,
        });
      }
      return schRuntimeBootstrap.status(root);
    })().finally(() => { schRuntimeInstallPromise = null; });
  }
  const installed = await schRuntimeInstallPromise;
  return schRuntimeLaunchSpec(plugin, installed);
}

async function schResolveRuntimeLaunchSpec(plugin, onProgress) {
  // Integrity/install failures must stay failures. Falling back to a plugin-
  // directory sidecar here would silently run unverified bytes immediately
  // after the pinned runtime was rejected, defeating the release trust root.
  return schEnsureRuntimeInstalled(plugin, onProgress);
}

async function schSpawnLocalRuntime(plugin, ports, onProgress) {
  const req = window.require;
  const path = req("node:path"), fs = req("node:fs"), nodeProcess = req("node:process");
  const spawn = req("node:child_process").spawn;
  const existing = schRuntimeChildren.get(ports.scope);
  if (existing && existing.exitCode === null && !existing.killed) return existing;
  const spec = await schResolveRuntimeLaunchSpec(plugin, onProgress);
  ports.canvasPort = 0;
  ports.bridgePort = 0;
  schRuntimePortsByScope.set(ports.scope, ports);
  const base = plugin.app.vault.adapter.getBasePath?.();
  const pathParts = [spec.pythonDir, path.dirname(spec.nodeExe), nodeProcess.env.PATH].filter(Boolean);
  const env = {
    ...nodeProcess.env,
    PATH: pathParts.join(path.delimiter),
    AGENT_CANVAS_PORT: "0",
    AGENT_BRIDGE_PORT: "0",
    AGENT_WEAVER_VAULT_ROOT: String(base || ""),
    SCHOLARIUM_RUNTIME_ASSETS_ROOT: spec.core,
  };
  if (spec.configPath) env.AGENT_BRIDGE_CONFIG_PATH = spec.configPath;
  if (spec.pidfile) env.AGENT_WEAVER_PIDFILE = spec.pidfile;
  const child = spawn(spec.nodeExe, [spec.launcher], {
    cwd: spec.cwd,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
    shell: false,
    env,
  });
  const output = [];
  child.stdout?.on("data", (chunk) => output.push(String(chunk)));
  child.stderr?.on("data", (chunk) => output.push(String(chunk)));
  child.on("message", (message) => {
    if (message?.type === "listening") {
      const canvasPort = Number(message.canvasPort), bridgePort = Number(message.bridgePort);
      if (Number.isInteger(canvasPort) && canvasPort > 0 && Number.isInteger(bridgePort) && bridgePort > 0) {
        ports.canvasPort = canvasPort;
        ports.bridgePort = bridgePort;
        schRuntimePortsByScope.set(ports.scope, ports);
      }
    }
    if (message?.type === "listen-error") {
      child.__schSpawnError = new Error(`${message.service || "runtime"} ${message.code || "LISTEN_FAILED"}: ${message.message || "could not listen"}`);
    }
  });
  child.once("error", (error) => { child.__schSpawnError = error; });
  child.__schOutput = output;
  child.__schSource = spec.source;
  child.once("exit", () => {
    if (schRuntimeChildren.get(ports.scope) === child) schRuntimeChildren.delete(ports.scope);
    if (schRuntimePortsByScope.get(ports.scope) === ports) {
      ports.canvasPort = 0;
      ports.bridgePort = 0;
    }
  });
  schRuntimeChildren.set(ports.scope, child);
  return child;
}

function schRuntimeFailureDetail(child) {
  const output = Array.isArray(child?.__schOutput) ? child.__schOutput.join("").trim() : "";
  const spawnError = child?.__schSpawnError?.message || "";
  return [spawnError, output].filter(Boolean).join("\n").slice(-4000);
}

async function schStartAndWaitLocalRuntime(plugin, ports, healthProbe, onProgress) {
  if (schRuntimeStartPromises.has(ports.scope)) return schRuntimeStartPromises.get(ports.scope);
  const starting = (async () => {
    const child = await schSpawnLocalRuntime(plugin, ports, onProgress);
    let lastError = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (child.__schSpawnError || child.exitCode !== null) {
        const detail = schRuntimeFailureDetail(child);
        throw new Error(`Scholarium runtime 在监听前退出（code=${child.exitCode} signal=${child.signalCode || "null"}）。${detail ? `\n${detail}` : ""}`);
      }
      try {
        return await healthProbe();
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }
    const detail = schRuntimeFailureDetail(child);
    throw new Error(`Scholarium runtime 启动超时${lastError?.message ? `：${lastError.message}` : ""}${detail ? `\n${detail}` : ""}`);
  })();
  schRuntimeStartPromises.set(ports.scope, starting);
  try {
    return await starting;
  } finally {
    schRuntimeStartPromises.delete(ports.scope);
  }
}

function schStopLocalRuntime(scope) {
  const child = schRuntimeChildren.get(scope);
  if (!child || child.exitCode !== null) return;
  const forceStop = () => {
    if (child.exitCode !== null) return;
    try {
      if (process.platform === "win32" && child.pid) {
        window.require("node:child_process").spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      }
    } catch (_) { /* direct kill below remains the fallback */ }
    try { child.kill(); } catch (_) { /* already stopped */ }
  };
  let timer = window.setTimeout(forceStop, 1500);
  child.once("exit", () => { window.clearTimeout(timer); schRuntimeChildren.delete(scope); });
  try {
    if (child.connected) child.send({ type: "shutdown", reason: "plugin-unload" });
    else forceStop();
  } catch (_) { forceStop(); }
}

/* Which runtime belongs to this Vault.
   ------------------------------------------------------------------------
   The hash is an opaque per-Vault identity only; it no longer selects a port.
   Canvas and Bridge each bind port 0 themselves and report the actual ports
   over IPC. This avoids both Windows excluded-port EACCES failures and the
   TOCTOU race of probing a free port before a different process binds it. */
function schVaultPortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/* SCHOLARIUM_RUNTIME_PIDFILE_OWNERSHIP_BEGIN */
function schRuntimeProcessAlive(pid, nodeProcess = window.require("node:process")) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    nodeProcess.kill(value, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but this account cannot signal it.
    return error?.code === "EPERM";
  }
}

function schRuntimeSamePath(left, right, path, platform) {
  if (typeof left !== "string" || !left.trim()) return false;
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

function schRuntimePidfileOwnedByScope(recorded, scope) {
  if (!recorded || typeof recorded !== "object") return false;
  const req = window.require, path = req("node:path"), nodeProcess = req("node:process");
  const expectedConfig = path.join(schRuntimeRoot(), "profiles", scope, "bridge.config.json");
  return schRuntimeSamePath(recorded.configPath, expectedConfig, path, nodeProcess.platform)
    && schRuntimeProcessAlive(recorded.launcherPid, nodeProcess)
    && schRuntimeProcessAlive(recorded.bridgePid, nodeProcess);
}

function schVaultBridgePorts(app) {
  try {
    const basePath = String(app?.vault?.adapter?.getBasePath?.() || app?.vault?.name || "default");
    const scope = `v${schVaultPortHash(basePath).toString(36)}`;
    const cached = schRuntimePortsByScope.get(scope);
    const ownedChild = schRuntimeChildren.get(scope);
    if (cached && ownedChild && ownedChild.exitCode === null && !ownedChild.killed) return cached;
    const ports = cached || { scope, canvasPort: 0, bridgePort: 0 };
    ports.canvasPort = 0;
    ports.bridgePort = 0;
    // Hot reloads may adopt a still-running runtime, but an HTTP 200 on an old
    // port is not ownership proof: Windows can reuse that port for an unrelated
    // Bridge. Require this Vault's config path and both recorded processes.
    try {
      const req = window.require, fs = req("node:fs"), path = req("node:path");
      const pidfile = path.join(schRuntimeRoot(), "profiles", scope, "weaver.pid.json");
      const recorded = JSON.parse(fs.readFileSync(pidfile, "utf8"));
      if (schRuntimePidfileOwnedByScope(recorded, scope)) {
        if (Number.isInteger(recorded.canvasPort) && recorded.canvasPort > 0) ports.canvasPort = recorded.canvasPort;
        if (Number.isInteger(recorded.bridgePort) && recorded.bridgePort > 0) ports.bridgePort = recorded.bridgePort;
      }
    } catch (_) { /* first start or stale/missing/unowned pidfile */ }
    schRuntimePortsByScope.set(scope, ports);
    return ports;
  } catch (_) { return null; }
}
/* SCHOLARIUM_RUNTIME_PIDFILE_OWNERSHIP_END */

/* 研究推演室的 Bridge 地址：本 Vault runtime 回报的 canvas 端口上的 /bridge
 * 代理。端口是随机分配的，所以每次按回报解析；没有回报或探活失败时启动并
 * 等待本 Vault 的 runtime（与素材库、Ketcher 同一条路径），不退回任何固定端口。 */
const schDeductionBridgeChecked = new Map();
async function schDeductionBridgeBase(host) {
  const plugin = host && (host.plugin || host);
  const app = (host && host.app) || (plugin && plugin.app);
  const ports = schVaultBridgePorts(app);
  if (!ports) throw new Error("无法为当前 Vault 分配 Scholarium runtime");
  const health = async () => {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 1800);
    try {
      if (!ports.canvasPort) throw new Error("runtime 尚未回报 canvas 端口");
      const response = await fetch(`http://127.0.0.1:${ports.canvasPort}/bridge/health`, { cache: "no-store", signal: ctrl.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    } finally {
      window.clearTimeout(timer);
    }
  };
  const last = schDeductionBridgeChecked.get(ports.scope);
  const fresh = last && last.port === ports.canvasPort && Date.now() - last.at < 30000;
  if (!fresh) {
    let alive = false;
    if (ports.canvasPort) {
      try { await health(); alive = true; } catch (_) { alive = false; }
    }
    if (!alive) await schStartAndWaitLocalRuntime(plugin, ports, health);
    if (!ports.canvasPort) throw new Error("Scholarium runtime 尚未回报 canvas 端口");
    schDeductionBridgeChecked.set(ports.scope, { port: ports.canvasPort, at: Date.now() });
  }
  return `http://127.0.0.1:${ports.canvasPort}/bridge`;
}

export {
  SCH_RUNTIME_RELEASES,
  SCH_RUNTIME_RELEASE,
  schRuntimeReleaseFor,
  schRuntimeRequiredRelease,
  schRuntimeRoot,
  schRuntimeScope,
  schRuntimeDiagnose,
  schRuntimeExplain,
  schOpenRuntimeDiagnosis,
  schEnsureRuntimeInstalled,
  schResolveRuntimeLaunchSpec,
  schSpawnLocalRuntime,
  schStartAndWaitLocalRuntime,
  schStopLocalRuntime,
  schVaultPortHash,
  schRuntimeProcessAlive,
  schRuntimeSamePath,
  schRuntimePidfileOwnedByScope,
  schVaultBridgePorts,
  schDeductionBridgeBase,
};
