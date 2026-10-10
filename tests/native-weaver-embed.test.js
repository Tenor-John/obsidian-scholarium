"use strict";
/**
 * The native 织研者 page inside Scholarium.
 *
 * Covers the embed tool (markers, anchors, vendor hashes, idempotence) and the
 * host glue's rules: the tab row is always Scholarium's own, the native page
 * replaces only the iframe, the old page stays one setting away, and a page
 * that cannot mount falls back to the old one instead of an empty tab.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");

const ROOT = path.join(__dirname, "..");
const tool = require("../tools/embed-native-weaver.js");

function count(text, needle) {
  let n = 0;
  let i = -1;
  while ((i = text.indexOf(needle, i + 1)) >= 0) n += 1;
  return n;
}

/** A scratch copy of exactly what the tool reads. */
function scratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-native-weaver-"));
  for (const rel of ["main.js", "styles.css", "tools/native-weaver-host.js", "tools/patch-manual-capture-batch.js", "tools/manual-capture-batch-methods.jsfrag", "tools/patch-native-weaver-layout.js", "vendor/native-weaver/SOURCE.json",
    "vendor/native-weaver/scholarium-weaver-native.js", "vendor/native-weaver/scholarium-weaver-native.css"]) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), target);
  }
  return dir;
}

describe("native 织研者 embed: the shipped files", () => {
  const main = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

  it("has each generated region exactly once", () => {
    for (const marker of [tool.JS_BEGIN, tool.JS_END, tool.HOOK_BEGIN, tool.HOOK_END]) assert.equal(count(main, marker), 1, marker);
    for (const marker of [tool.CSS_BEGIN, tool.CSS_END]) assert.equal(count(styles, marker), 1, marker);
    assert.equal(count(main, "SCHOLARIUM_MANUAL_CAPTURE_BATCH_METHODS_BEGIN"), 1);
    // The shell stays in normal flow: a position:fixed shell is offset by any
    // transformed ancestor inside an Obsidian leaf.
    assert.equal(count(main, "SCHOLARIUM_NATIVE_WEAVER_LAYOUT_BEGIN"), 0);
    assert.ok(!/shell\.style\.cssText = "display:flex;position:fixed/.test(main));
    // 织研者 fills the whole leaf: the host padding is dropped only on that tab.
    assert.match(main, /content\.toggleClass\("sch-weaver-active", weaverActive\)/);
    assert.match(main, /content\.style\.setProperty\("padding", "0", "important"\)/);
    // The native workspace is pinned to the stretching grid row.
    assert.match(styles, /\.scholarium-weaver__workspace \{[^}]*grid-row: 3;/);
    assert.match(main, /批量抓取（半自动）/);
    assert.match(main, /10000 - \(Date\.now\(\) - lastStartedAt\)/, "每篇至少间隔 10 秒");
    assert.match(main, /\(publisherCounts\.get\(publisher\) \|\| 0\) >= 20/, "每家出版社每轮最多 20 篇");
    // 登录/验证页上只做只读轮询：完整评估（会重新请求页面）只在正文页上运行。
    assert.match(main, /async manualCaptureQuickCheck\(webview\)/);
    // 网页没有完整正文（老文章只有扫描 PDF）时改走 PDF 下载。
    assert.match(main, /async manualCapturePdfCandidates\(webview\)/);
    // MinerU 在线识别：Token 只存在 Vault 之外，绝不进 data.json。
    // 所有密钥与地址集中在 Vault 之外的一个文件：scholarium-secrets.json。
    assert.equal(count(main, "SCHOLARIUM_SECRETS_FILE_BEGIN"), 1);
    assert.match(main, /path\.join\(os\.homedir\(\), "Scholarium", "scholarium-secrets\.json"\)/);
    assert.match(main, /async loadSettings\(\) \{\n    var n, a;\n    schSecretsFile\.install\(this\);/);
    assert.match(main, /schSecretsFile\.renderSettingsBox\(e, this\.plugin\);/);
    // 运行时出错要告诉用户怎么修；批量抓取逐篇显示结果与处理办法。
    assert.equal(count(main, "SCHOLARIUM_RUNTIME_DIAGNOSIS_BEGIN"), 1);
    assert.match(main, /throw new Error\(schRuntimeExplain\(error\)\);/);
    assert.match(main, /id: "diagnose-runtime", name: "诊断本机运行时"/);
    assert.match(main, /this\.renderManualCaptureReport\(e, lastBatch\)/);
    assert.match(main, /if \(h\.lastAttempt\)/);
    assert.ok(!/this\.data\.mineru(Token|Config)/.test(main), "token must not be written into plugin data");
    assert.match(main, /this\.scheduleMineruOcr\(absolute\)/);
    assert.match(main, /let pdfCandidateUrls = explicitPdf\.length \? \[\.\.\.explicitPdf\] : \[pdfPageUrl\];/);
    assert.match(main, /quick\.kind === "login" \|\| quick\.kind === "challenge"/);
    assert.match(main, /streak >= 3/, "连续三篇验证触发熔断");
  });

  it("puts the page after the runtime bootstrap and the hook before the iframe's early return", () => {
    assert.ok(main.indexOf(tool.JS_BEGIN) > main.indexOf("/* SCHOLARIUM_RUNTIME_BOOTSTRAP_EMBED_END */"));
    const hook = main.indexOf(tool.HOOK_END);
    assert.equal(main.indexOf(tool.HOOK_ANCHOR), hook + tool.HOOK_END.length + 1, "the hook runs first, so switching from the iframe works");
    assert.ok(main.indexOf("this.renderBrandBar(weaverHost);") > hook, "Scholarium's own tab row code is untouched");
  });

  it("is exactly what the tool produces (running it again changes nothing)", () => {
    const dir = scratchRepo();
    tool.embed({ root: dir });
    assert.equal(fs.readFileSync(path.join(dir, "main.js"), "utf8"), main);
    assert.equal(fs.readFileSync(path.join(dir, "styles.css"), "utf8"), styles);
  });
});

describe("native 织研者 embed: refusals", () => {
  it("refuses a vendored bundle whose hash does not match SOURCE.json", () => {
    const dir = scratchRepo();
    fs.appendFileSync(path.join(dir, "vendor/native-weaver/scholarium-weaver-native.js"), "\n// tampered\n");
    assert.throws(() => tool.embed({ root: dir }), /SHA-256/);
  });

  it("refuses a main.js whose iframe branch has changed", () => {
    const dir = scratchRepo();
    const file = path.join(dir, "main.js");
    const stripped = tool.withoutRegion(fs.readFileSync(file, "utf8"), tool.HOOK_BEGIN, tool.HOOK_END, "hook").text;
    fs.writeFileSync(file, stripped.replace(tool.HOOK_ANCHOR, "      if (this.__weaverFrame) return;\n"));
    assert.throws(() => tool.embed({ root: dir }), /锚点/);
  });

  it("refuses a half region instead of guessing", () => {
    const dir = scratchRepo();
    const file = path.join(dir, "main.js");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(tool.JS_END, ""));
    assert.throws(() => tool.embed({ root: dir }), /标记不完整/);
  });
});

/* ----------------------------------------------------------- the glue --- */

function loadGlue({ mount, notices = [] } = {}) {
  const src = fs.readFileSync(path.join(ROOT, "tools", "native-weaver-host.js"), "utf8");
  const fakeObsidian = {
    Notice: function Notice(text) { notices.push(text); },
    Modal: function Modal() {},
  };
  const nativeWeaver = mount === null ? undefined : { mountResearchWeaver: mount };
  const window = { setTimeout: (fn) => { fn(); return 1; } };
  const factory = new Function("ScholariumNativeWeaver", "require", "window", `${src}\nreturn schNativeWeaverHost;`);
  const req = (id) => {
    if (id === "obsidian") return fakeObsidian;
    if (id === "fs" || id === "path") return require(id);
    throw new Error(id);
  };
  return { host: factory(nativeWeaver, req, window), window, notices };
}

function el(tag = "div") {
  const node = {
    tag, children: [], parentElement: null, style: {}, cls: "",
    empty() { for (const child of node.children) child.parentElement = null; node.children = []; },
    createDiv(opts = {}) { const child = el("div"); child.cls = opts.cls || ""; child.parentElement = node; node.children.push(child); return child; },
    remove() { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter((c) => c !== node); node.parentElement = null; },
  };
  return node;
}

function fakeView(mode) {
  const saved = [];
  const commands = [];
  const plugin = {
    settings: mode ? { nativeWeaver: { mode, page: { agentId: "claude" } } } : {},
    saveSettings: async () => { saved.push(JSON.parse(JSON.stringify(plugin.settings.nativeWeaver))); },
    addCommand: (command) => commands.push(command),
  };
  const view = {
    plugin,
    app: { vault: { adapter: { getBasePath: () => "D:/vault" } }, workspace: { openLinkText: async () => {} } },
    brandBars: 0,
    renderBrandBar(host) { view.brandBars += 1; host.createDiv({ cls: "sch-brandbar" }); },
  };
  return { view, plugin, saved, commands };
}

const RUNTIME = {
  vaultPorts: () => ({ scope: "v1", canvasPort: 41234 }),
  ensure: async () => ({ ok: true }),
  serviceUrl: (ports) => `http://127.0.0.1:${ports.canvasPort}/`,
};

describe("native 织研者 embed: the host glue", () => {
  it("draws Scholarium's tab row, then the native page under it, and does it once", () => {
    const mounts = [];
    const { host } = loadGlue({ mount: (body, deps) => { mounts.push({ body, deps }); return { destroy() {}, isMounted: () => true }; } });
    const { view, commands } = fakeView("native");
    const weaverHost = el();
    assert.equal(host.render(view, weaverHost, RUNTIME), true);
    assert.equal(view.brandBars, 1, "the tab row is Scholarium's own renderBrandBar");
    assert.equal(weaverHost.children[0].cls, "sch-brandbar");
    assert.equal(mounts.length, 1);
    assert.equal(mounts[0].body.parentElement, weaverHost);
    assert.match(mounts[0].body.style.cssText, /flex:1 1 0;height:0;max-height:100%/,
      "the native body fills the remaining tab height instead of sizing to the right rail");
    assert.equal(mounts[0].deps.locate(), "http://127.0.0.1:41234/bridge", "the page talks to Scholarium's proxy");
    assert.equal(host.render(view, weaverHost, RUNTIME), true, "switching tabs back keeps the same page");
    assert.equal(mounts.length, 1);
    assert.deepEqual(commands.map((entry) => entry.id).sort(),
      ["send-to-native-weaver", "toggle-native-weaver", "toggle-native-weaver-dev-mode"],
      "the native/legacy switch, the development-mode switch and 「发送到织研者」 are each registered once");
  });

  it("defaults to the native page and remembers the page's settings in Scholarium's data", async () => {
    let deps = null;
    const { host } = loadGlue({ mount: (body, d) => { deps = d; return { destroy() {}, isMounted: () => true }; } });
    const { view, saved } = fakeView(undefined);
    assert.equal(host.render(view, el(), RUNTIME), true);
    await deps.saveSettings({ agentId: "codex", flowId: "weaver", projectId: "", workspaceRoot: "" });
    assert.equal(saved.at(-1).mode, "native");
    assert.equal(saved.at(-1).page.agentId, "codex");
    assert.equal(deps.vaultBasePath(), "D:/vault");
    assert.equal(deps.devMode, false, "the formal host default keeps development mode off");
  });

  it("passes Scholarium's explicit development-mode switch into the native page", async () => {
    let deps = null;
    const { host } = loadGlue({ mount: (body, d) => { deps = d; return { destroy() {}, isMounted: () => true }; } });
    const { view, plugin, commands, saved } = fakeView("native");
    plugin.settings.nativeWeaver.devMode = true;
    assert.equal(host.render(view, el(), RUNTIME), true);
    assert.equal(deps.devMode, true);
    const command = commands.find((entry) => entry.id === "toggle-native-weaver-dev-mode");
    assert.ok(command, "the host exposes a development-mode command");
    await command.callback();
    assert.equal(plugin.settings.nativeWeaver.devMode, false);
    assert.equal(saved.at(-1).devMode, false);
  });

  it("publishes Pipeline leftovers to Literature Subscription and can open the Obsidian catalog", async () => {
    let deps = null;
    const queued = [];
    const opened = [];
    const tabs = [];
    const { host } = loadGlue({ mount: (body, d) => { deps = d; return { destroy() {}, isMounted: () => true }; } });
    const { view } = fakeView("native");
    view.app.workspace.openLinkText = async (...args) => { opened.push(args); };
    view.switchTab = (tab) => tabs.push(tab);
    view.rssBoard = {
      data: {}, setManualDownloadQueue: (items) => queued.push(items), save() {}, rerender() {},
    };
    assert.equal(host.render(view, el(), RUNTIME), true);
    const count = await deps.publishManualDownloads([
      { id: "doi:10.1/a", title: "A", doi: "10.1/a", url: "https://doi.org/10.1/a", venue: "J", abstract: "Abstract" },
      { id: "bad", title: "Bad", url: "file:///tmp/a.pdf" },
    ], { append: true, open: true });
    assert.equal(count, 1);
    assert.equal(queued.at(-1)[0].venue, "J");
    assert.deepEqual(tabs, ["feeds"]);
    assert.equal(view.rssBoard.hubTab, "pipeline");
    await deps.openVaultFile("literature/exports/retrieved-literature.md");
    assert.deepEqual(opened[0], ["literature/exports/retrieved-literature.md", "", true]);
    let rejected = null;
    try { await deps.openVaultFile("../outside.md"); } catch (error) { rejected = error; }
    assert.ok(rejected);
    assert.match(String(rejected.message || rejected), /只能打开/);
  });

  it("routes a completed capture to the native page instead of the retired iframe", async () => {
    const received = [];
    const { host } = loadGlue({ mount: () => ({
      destroy() {}, isMounted: () => true,
      acceptManualCapture: async (item) => { received.push(item); return { runId: item.pipelineRunId }; },
    }) });
    const { view } = fakeView("native");
    assert.equal(host.render(view, el(), RUNTIME), true);
    const item = { pipelineRunId: "run-1", kind: "pdf", path: "literature/a.pdf" };
    await view.__notifyManualCapture(item);
    assert.deepEqual(received, [item]);
  });

  it("in legacy mode leaves the tab to the old iframe and closes the native page", () => {
    let destroyed = 0;
    const { host } = loadGlue({ mount: () => ({ destroy() { destroyed += 1; }, isMounted: () => true }) });
    const { view, plugin } = fakeView("native");
    const weaverHost = el();
    host.render(view, weaverHost, RUNTIME);
    plugin.settings.nativeWeaver.mode = "legacy";
    assert.equal(host.render(view, weaverHost, RUNTIME), false);
    assert.equal(destroyed, 1);
  });

  it("switching from the old page removes its iframe", () => {
    const { host } = loadGlue({ mount: () => ({ destroy() {}, isMounted: () => true }) });
    const { view } = fakeView("native");
    const weaverHost = el();
    const frame = weaverHost.createDiv({ cls: "iframe" });
    view.__weaverFrame = frame;
    assert.equal(host.render(view, weaverHost, RUNTIME), true);
    assert.equal(view.__weaverFrame, null);
    assert.ok(!weaverHost.children.includes(frame));
  });

  it("falls back to the old page, with a notice, when the page cannot mount", () => {
    const notices = [];
    const { host } = loadGlue({ mount: () => { throw new Error("boom"); }, notices });
    const { view } = fakeView("native");
    const weaverHost = el();
    assert.equal(host.render(view, weaverHost, RUNTIME), false);
    assert.equal(weaverHost.children.length, 0, "the caller draws the iframe into an empty host");
    assert.match(notices[0], /boom/);
  });

  it("without the bundle it behaves exactly like the old plugin", () => {
    const { host } = loadGlue({ mount: null });
    const { view } = fakeView("native");
    assert.equal(host.render(view, el(), RUNTIME), false);
  });
});

describe("native 织研者 embed: 开启执行", () => {
  function profile(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-native-weaver-profile-"));
    const file = path.join(dir, "bridge.config.json");
    if (content !== undefined) fs.writeFileSync(file, content);
    return file;
  }

  it("sets allowExecution=true, keeps every other field, and keeps the original beside it", () => {
    const { host } = loadGlue({ mount: null });
    const original = `\uFEFF${JSON.stringify({ token: "t", allowExecution: false, researchLaneEnabled: false, adapters: { claude: { sandboxed: true } } }, null, 2)}`;
    const file = profile(original);
    assert.equal(host.enableExecutionAt(fs, file), file);
    const after = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(after.allowExecution, true);
    assert.equal(after.researchLaneEnabled, false, "only the execution switch changes");
    assert.deepEqual(after.adapters, { claude: { sandboxed: true } });
    assert.equal(after.token, "t");
    assert.equal(fs.readFileSync(`${file}.before-execution`, "utf8"), original);
    assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((name) => name.includes(".tmp-")), [], "no temp file is left");
  });

  it("refuses a missing or broken configuration instead of creating one", () => {
    const { host } = loadGlue({ mount: null });
    assert.throws(() => host.enableExecutionAt(fs, profile()), /连接运行时/);
    const broken = profile("{ not json");
    assert.throws(() => host.enableExecutionAt(fs, broken), /没有修改/);
    assert.equal(fs.readFileSync(broken, "utf8"), "{ not json");
  });

  it("is offered to the page and writes the vault's own profile", async () => {
    let deps = null;
    const { host } = loadGlue({ mount: (body, d) => { deps = d; return { destroy() {}, isMounted: () => true }; } });
    const { view } = fakeView("native");
    const file = profile(JSON.stringify({ allowExecution: false }));
    const restarts = [];
    const runtime = { ...RUNTIME, profileConfigPath: () => file, restart: async (v) => { restarts.push(v); return true; } };
    assert.equal(host.render(view, el(), runtime), true);
    assert.equal(typeof deps.enableExecution, "function");
    assert.equal(await deps.enableExecution(), file);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).allowExecution, true);
    assert.equal(restarts.length, 1, "the runtime is restarted so its agent list reports the new switch");
    assert.ok(restarts[0] === view, "this vault's runtime");
  });
});
