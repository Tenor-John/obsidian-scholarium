/**
 * native-weaver-host — Scholarium's side of the native 织研者 page.
 *
 * Embedded into main.js by tools/embed-native-weaver.js, after the vendored
 * page bundle (vendor/native-weaver, built from scholarium-v2-source). It is
 * the only code that knows both worlds:
 *
 *   - Scholarium's dashboard keeps its own tab row (renderBrandBar) and owns
 *     the local runtime (vaultPorts / ensure / serviceUrl);
 *   - the page is mounted under that row, in place of the old iframe, and
 *     talks to the Bridge only through Scholarium's local proxy at
 *     `<canvas>/bridge`, which holds the credential.
 *
 * During the migration the old iframe page stays one command away
 * (「织研者：切换原生页面 / 旧版页面」); the choice is saved in Scholarium's
 * settings as `nativeWeaver.mode`.
 *
 * Plain JS with no build step, because it is embedded as written. `require`
 * is the plugin's own (it resolves `obsidian`); `ScholariumNativeWeaver` is
 * defined by the vendored bundle just above this file in main.js.
 */

var schNativeWeaverHost = (() => {
  const COMMAND_ID = "toggle-native-weaver";
  const DEV_MODE_COMMAND_ID = "toggle-native-weaver-dev-mode";
  const SEND_COMMAND_ID = "send-to-native-weaver";
  const OBJECT_ID = /^(PRJ|Q|HYP|IDEA|DEC|LES|PAPER|EVD|EXP)-\d+$/i;
  const commandRegistered = new WeakSet();

  function config(plugin) {
    const settings = plugin && plugin.settings ? plugin.settings : null;
    if (!settings) return { mode: "legacy", page: {}, devMode: false };
    if (!settings.nativeWeaver || typeof settings.nativeWeaver !== "object") settings.nativeWeaver = { mode: "native", page: {} };
    const conf = settings.nativeWeaver;
    if (conf.mode !== "native" && conf.mode !== "legacy") conf.mode = "native";
    if (!conf.page || typeof conf.page !== "object") conf.page = {};
    if (conf.devMode !== true) conf.devMode = false;
    return conf;
  }

  async function persist(plugin) {
    if (typeof plugin.saveSettings === "function") return plugin.saveSettings();
    return plugin.saveData(plugin.settings);
  }

  function available() {
    return typeof ScholariumNativeWeaver !== "undefined"
      && ScholariumNativeWeaver
      && typeof ScholariumNativeWeaver.mountResearchWeaver === "function";
  }

  /** Obsidian's own yes/no modal; closing it any other way is "no". */
  function confirmWith(app, message) {
    const { Modal } = require("obsidian");
    return new Promise((resolve) => {
      let answered = false;
      const modal = new Modal(app);
      modal.onOpen = () => {
        modal.titleEl.setText("织研者");
        modal.contentEl.createEl("p", { text: message, attr: { style: "white-space: pre-wrap" } });
        const actions = modal.contentEl.createDiv({ cls: "modal-button-container" });
        actions.createEl("button", { text: "取消" }).addEventListener("click", () => modal.close());
        actions.createEl("button", { text: "继续", cls: "mod-warning" }).addEventListener("click", () => {
          answered = true;
          modal.close();
        });
      };
      modal.onClose = () => {
        modal.contentEl.empty();
        resolve(answered);
      };
      modal.open();
    });
  }

  /**
   * The Bridge configuration Scholarium starts this vault's runtime with:
   * `<runtime root>/profiles/<vault scope>/bridge.config.json`, the same path
   * schRuntimeLaunchSpec hands to the runtime. A host that knows better (a
   * test) passes `runtime.profileConfigPath`.
   */
  function profileConfigPath(view, runtime) {
    if (runtime && typeof runtime.profileConfigPath === "function") return runtime.profileConfigPath(view);
    if (typeof schRuntimeRoot !== "function" || typeof schRuntimeScope !== "function") {
      throw new Error("这个版本的 Scholarium 没有本地运行时配置");
    }
    const path = require("path");
    return path.join(schRuntimeRoot(), "profiles", schRuntimeScope(view.app), "bridge.config.json");
  }

  /**
   * Turn the runtime's execution switch on: `allowExecution: true` and nothing
   * else. The Bridge re-reads this field on every task request, so no restart
   * is needed. The file before the first change is kept beside it as
   * `bridge.config.json.before-execution`, and the write is a rename, so a
   * crash never leaves half a configuration.
   */
  function enableExecutionAt(fs, file) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") throw new Error("还没有本库的运行时配置：先点「连接运行时」启动一次");
      throw error;
    }
    let conf;
    try {
      conf = JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (_) {
      throw new Error(`运行时配置不是有效的 JSON，没有修改：${file}`);
    }
    if (!conf || typeof conf !== "object" || Array.isArray(conf)) throw new Error(`运行时配置格式不对，没有修改：${file}`);
    if (conf.allowExecution === true) return file;
    const backup = `${file}.before-execution`;
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, text);
    conf.allowExecution = true;
    const temp = `${file}.tmp-${Date.now()}`;
    fs.writeFileSync(temp, `${JSON.stringify(conf, null, 2)}\n`);
    fs.renameSync(temp, file);
    return file;
  }

  /**
   * Restart this vault's runtime so it starts from the configuration just
   * written. The Bridge only re-reads the execution switch on some routes, so
   * without a restart its agent list keeps reporting "execution off". Only a
   * runtime Scholarium started in this session can be stopped; otherwise this
   * is a no-op and the page reconnects to whatever is running.
   */
  async function restartRuntime(view, runtime) {
    if (runtime && typeof runtime.restart === "function") return runtime.restart(view);
    if (typeof schStopLocalRuntime !== "function" || typeof schRuntimeScope !== "function") return false;
    const scope = schRuntimeScope(view.app);
    const child = typeof schRuntimeChildren !== "undefined" && schRuntimeChildren ? schRuntimeChildren.get(scope) : null;
    if (!child || child.exitCode !== null) return false;
    const exited = new Promise((resolve) => {
      child.once("exit", () => resolve(true));
      window.setTimeout(() => resolve(false), 5000);
    });
    schStopLocalRuntime(scope);
    await exited;
    const ports = runtime.vaultPorts(view);
    if (ports) await runtime.ensure(view, ports);
    return true;
  }

  function manualDownloadItems(items) {
    return (Array.isArray(items) ? items : []).slice(0, 200).map((item) => ({
      id: String(item && item.id || "").slice(0, 240),
      title: String(item && item.title || "待下载论文").slice(0, 500),
      doi: String(item && item.doi || "").slice(0, 240),
      url: String(item && item.url || "").slice(0, 2000),
      reason: String(item && item.reason || "自动下载未成功").slice(0, 300),
      venue: String(item && item.venue || "").slice(0, 500),
      abstract: String(item && item.abstract || "").slice(0, 2000),
      pipelineRunId: String(item && item.pipelineRunId || "").slice(0, 120),
      workspace: String(item && item.workspace || "").slice(0, 2000),
    })).filter((item) => item.id && /^https?:\/\/\S+$/i.test(item.url));
  }

  async function publishManualDownloads(view, items, options = {}) {
    let next = manualDownloadItems(items);
    if (options.append === true) {
      const existing = Array.isArray(view.__manualDownloadQueue)
        ? view.__manualDownloadQueue
        : Array.isArray(view.rssBoard?.manualDownloadQueue) ? view.rssBoard.manualDownloadQueue : [];
      const merged = new Map();
      for (const item of [...next, ...existing]) if (item?.id && !merged.has(item.id)) merged.set(item.id, item);
      next = [...merged.values()].slice(0, 200);
    }
    view.__manualDownloadQueue = next;
    view.rssBoard?.setManualDownloadQueue(next);
    if (options.open === true) {
      view.switchTab?.("feeds");
      window.setTimeout(() => {
        if (!view.rssBoard) return;
        view.rssBoard.hubTab = "pipeline";
        if (view.rssBoard.data) view.rssBoard.data.hubTab = "pipeline";
        view.rssBoard.save?.();
        view.rssBoard.rerender?.();
      }, 250);
    }
    return next.length;
  }

  async function openVaultFile(view, value) {
    const target = String(value || "").replace(/\\/g, "/");
    if (!target || target.startsWith("/") || /^[A-Za-z]:/.test(target) || target.includes("../") || !target.toLowerCase().endsWith(".md")) {
      throw new Error("只能打开当前 Vault 内的 Markdown 文件");
    }
    if (!view.app?.workspace?.openLinkText) throw new Error("当前 Scholarium 宿主不能打开 Vault 文件");
    await view.app.workspace.openLinkText(target, "", true);
  }

  /** Open `note.md` or `note.md#Heading` inside this Vault. */
  async function openVaultLink(view, value) {
    const text = String(value || "").replace(/\\/g, "/");
    const hash = text.indexOf("#");
    const file = hash >= 0 ? text.slice(0, hash) : text;
    if (!file || file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.includes("../") || !file.toLowerCase().endsWith(".md")) {
      throw new Error("只能打开当前 Vault 内的 Markdown 文件");
    }
    if (!view.app?.workspace?.openLinkText) throw new Error("当前 Scholarium 宿主不能打开 Vault 文件");
    await view.app.workspace.openLinkText(text, "", true);
  }

  /* Addresses are written for people: Chinese stays as typed; only the
   * characters that would end or split an address are percent-escaped. Same
   * rule as escapeAnchorPart in scholarium-anchors.ts. */
  const ANCHOR_UNSAFE = /[%\s/#^@`，。；、)）\]]/g;
  function escapeAnchorPart(part) {
    return String(part == null ? "" : part).replace(ANCHOR_UNSAFE, (ch) => encodeURIComponent(ch));
  }

  function headingPaths(headings) {
    const stack = [];
    const out = [];
    for (const heading of headings || []) {
      if (!heading) continue;
      while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
      stack.push(heading);
      out.push(stack.map((item) => String(item.heading || "").trim()));
    }
    return out;
  }

  /** The shortest trailing part of a heading path that names only one heading. */
  function shortestTail(path, all) {
    for (let size = 1; size <= path.length; size += 1) {
      const tail = path.slice(path.length - size);
      const hits = all.filter((other) => other.length >= size && tail.every((part, i) => other[other.length - size + i] === part));
      if (hits.length === 1) return tail;
    }
    return path;
  }

  /** The Scholarium address of a Vault note (and heading path), readable. */
  function anchorForFile(app, file, headings) {
    const cache = app?.metadataCache?.getFileCache?.(file);
    const fm = cache && cache.frontmatter;
    const id = String(fm && fm.display_id || "").trim();
    const base = OBJECT_ID.test(id)
      ? `sch:${id.toUpperCase()}`
      : `sch:note/${String(file.path).replace(/\.md$/i, "").split("/").map(escapeAnchorPart).join("/")}`;
    let path = (headings || []).filter(Boolean);
    if (path.length) path = shortestTail(path, headingPaths(cache && cache.headings));
    return path.length ? `${base}#${path.map(escapeAnchorPart).join("/")}` : base;
  }

  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  /**
   * Quote an address into the native 织研者 composer: open the dashboard,
   * switch to the 织研者 tab, wait for the page, insert. Nothing is sent.
   */
  async function sendToWeaver(plugin, anchor, quote) {
    const { Notice } = require("obsidian");
    try {
      if (!window.__scholariumDashboardView && plugin && typeof plugin.activateDashboard === "function") await plugin.activateDashboard();
      for (let i = 0; i < 30 && !window.__scholariumDashboardView; i += 1) await sleep(100);
      const view = window.__scholariumDashboardView;
      if (!view) throw new Error("没有打开 Scholarium 面板");
      if (view.activePanel !== "deduction" && typeof view.switchTab === "function") view.switchTab("deduction");
      for (let i = 0; i < 50 && !(view.__schNativeWeaver && view.__schNativeWeaver.insertReference); i += 1) await sleep(100);
      const page = view.__schNativeWeaver;
      if (!page || typeof page.insertReference !== "function") throw new Error("原生织研者页面没有就绪（可能处于旧版页面模式）");
      if (view.leaf && view.app?.workspace?.revealLeaf) view.app.workspace.revealLeaf(view.leaf);
      page.insertReference(anchor, quote || "");
    } catch (error) {
      new Notice(`发给织研者失败：${error && error.message ? error.message : error}`, 8000);
    }
  }

  /** Heading path at a line, from Obsidian's metadata cache. */
  function headingPathAt(headings, line) {
    const stack = [];
    for (const heading of headings || []) {
      if (!heading || !heading.position || heading.position.start.line > line) break;
      while (stack.length && stack[stack.length - 1].level >= heading.level) stack.pop();
      stack.push(heading);
    }
    return stack.map((heading) => String(heading.heading || "").trim());
  }

  /** Alt+click on anything marked with data-sch-anchor quotes it to 织研者. */
  function installAltClick(plugin) {
    // Only in a real window: headless hosts (tests, a future mobile shell)
    // have no document to listen on, and the feature is a convenience.
    if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return;
    if (typeof window === "undefined" || !window || typeof window.addEventListener !== "function") return;
    const previous = window.__schAnchorAltClick;
    if (previous) document.removeEventListener("click", previous, true);
    const handler = (event) => {
      if (!event.altKey) return;
      const target = event.target && event.target.closest ? event.target.closest("[data-sch-anchor]") : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      const view = window.__scholariumDashboardView;
      const owner = (view && view.plugin) || plugin;
      const quote = target.getAttribute("data-sch-quote") || "";
      void sendToWeaver(owner, target.getAttribute("data-sch-anchor"), quote);
    };
    window.__schAnchorAltClick = handler;
    document.addEventListener("click", handler, true);
    // While Alt is held, marked places show a dashed outline on hover.
    const previousKeys = window.__schAnchorAltKeys;
    if (previousKeys) { document.removeEventListener("keydown", previousKeys, true); document.removeEventListener("keyup", previousKeys, true); window.removeEventListener("blur", previousKeys); }
    const keys = (event) => document.body && document.body.classList.toggle("scholarium-alt-held", Boolean(event && event.altKey));
    window.__schAnchorAltKeys = keys;
    document.addEventListener("keydown", keys, true);
    document.addEventListener("keyup", keys, true);
    window.addEventListener("blur", keys);
    if (plugin && typeof plugin.register === "function") {
      plugin.register(() => {
        document.removeEventListener("click", handler, true);
        document.removeEventListener("keydown", keys, true);
        document.removeEventListener("keyup", keys, true);
        window.removeEventListener("blur", keys);
        if (document.body) document.body.classList.remove("scholarium-alt-held");
        if (window.__schAnchorAltClick === handler) window.__schAnchorAltClick = null;
        if (window.__schAnchorAltKeys === keys) window.__schAnchorAltKeys = null;
      });
    }
  }

  /* AI 生图服务：配置（服务商、地址、模型、尺寸、密钥）保存在 Scholarium 的
   * 密钥文件 imageGeneration 一节——和其他 API Key 同一个文件、Vault 之外。
   * 织研者设置里可以选择和填写；页面只拿到“密钥有没有”，密钥只在这里用于
   * 发请求的 Authorization 头。 */
  const IMAGE_NOTE = "织研者 AI 生图服务。可在设置中心 → AI 生图 中选择服务商并填写，也可以直接编辑这里。provider：siliconflow / volcengine / zhipu / openai / custom（OpenAI 兼容）；endpoint 不含 /images/generations。";
  const trimmed = (value) => (value === undefined || value === null ? "" : String(value)).trim();

  function imageSection() {
    const fs = require("fs");
    const file = typeof schSecretsFile !== "undefined" && schSecretsFile.filePath ? schSecretsFile.filePath() : "";
    if (!file) throw new Error("这个版本的 Scholarium 没有密钥文件");
    let data = null;
    try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { data = null; }
    const conf = data && data.imageGeneration && typeof data.imageGeneration === "object" ? data.imageGeneration : {};
    return { file, data, conf };
  }

  function writeSecrets(file, data) {
    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
    try { fs.renameSync(tmp, file); } catch (_) { fs.copyFileSync(tmp, file); fs.rmSync(tmp, { force: true }); }
  }

  const imageService = {
    load() {
      const { file, conf } = imageSection();
      return {
        provider: trimmed(conf.provider),
        endpoint: trimmed(conf.endpoint).replace(/\/+$/, ""),
        model: trimmed(conf.model),
        size: trimmed(conf.size),
        hasKey: Boolean(trimmed(conf.apiKey)),
        file,
      };
    },
    save(patch) {
      const { file, data, conf } = imageSection();
      // The secrets module creates and migrates this file when Scholarium
      // loads; never start a fresh one here (that would skip the migration).
      if (!data || typeof data !== "object") throw new Error(`读不到密钥文件 ${file}：请先重新加载 Scholarium，或用命令「打开密钥与地址文件」检查它。`);
      const endpoint = trimmed(patch && patch.endpoint).replace(/\/+$/, "");
      if (endpoint && !/^https:\/\//i.test(endpoint)) throw new Error("生图服务地址必须以 https:// 开头");
      const apiKey = patch && patch.clearKey ? "" : trimmed(patch && patch.apiKey) || trimmed(conf.apiKey);
      const { _说明: _note, ...rest } = conf;
      data.imageGeneration = {
        "_说明": IMAGE_NOTE,
        ...rest,
        provider: trimmed(patch && patch.provider),
        endpoint,
        model: trimmed(patch && patch.model),
        size: trimmed(patch && patch.size),
        apiKey,
      };
      writeSecrets(file, data);
    },
    async post(route, body) {
      const { conf } = imageSection();
      const endpoint = trimmed(conf.endpoint).replace(/\/+$/, "");
      const apiKey = trimmed(conf.apiKey);
      if (!/^https:\/\//i.test(endpoint)) throw new Error("生图服务地址必须是 https://（设置中心 → AI 生图）");
      if (!apiKey) throw new Error("还没有填写生图服务的密钥（设置中心 → AI 生图）");
      const { requestUrl } = require("obsidian");
      const response = await requestUrl({
        url: `${endpoint}${route}`,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        throw: false,
      });
      let json;
      try { json = response.json; } catch (_) { json = undefined; }
      let raw = "";
      try { raw = String(response.text || "").slice(0, 2000); } catch (_) { raw = ""; }
      return { status: response.status, json, text: raw };
    },
    async download(url) {
      if (!/^https:\/\//i.test(String(url))) throw new Error("生图服务返回的图片地址不是 https://");
      const { requestUrl } = require("obsidian");
      const image = await requestUrl({ url: String(url), method: "GET", throw: false });
      if (image.status >= 400) throw new Error(`下载生成的图片失败：HTTP ${image.status}`);
      const type = String((image.headers && (image.headers["content-type"] || image.headers["Content-Type"])) || "image/png").split(";")[0];
      return { base64: Buffer.from(image.arrayBuffer).toString("base64"), mime: /^image\//.test(type) ? type : "image/png" };
    },
  };

  /** Hand a verified browser artifact to the native page. The old iframe
   * postMessage route is retained only as a migration fallback. */
  async function notifyManualCapture(view, item) {
    const nativePage = view.__schNativeWeaver;
    if (nativePage && typeof nativePage.acceptManualCapture === "function") {
      return nativePage.acceptManualCapture(item);
    }
    const frame = view.__weaverFrame;
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage({ type: "scholarium:manual-download-completed", item }, "*");
      return { legacy: true };
    }
    throw new Error("织研者页面尚未挂载，无法把抓取结果写入 Pipeline");
  }

  function destroy(view) {
    if (view.__schNativeWeaver) {
      try { view.__schNativeWeaver.destroy(); } catch (_) { /* a closing page must not break the tab switch */ }
    }
    view.__schNativeWeaver = null;
    view.__schNativeWeaverBody = null;
    view.__notifyManualCapture = null;
  }

  function registerCommand(plugin) {
    if (!plugin || typeof plugin.addCommand !== "function" || commandRegistered.has(plugin)) return;
    commandRegistered.add(plugin);
    installAltClick(plugin);
    plugin.addCommand({
      id: SEND_COMMAND_ID,
      name: "织研者：把当前段落 / 选中内容发给织研者",
      editorCallback: (editor, ctx) => {
        const file = ctx && ctx.file;
        if (!file) return;
        const app = plugin.app;
        const cache = app?.metadataCache?.getFileCache?.(file);
        const line = editor.getCursor("from").line;
        const anchor = anchorForFile(app, file, headingPathAt(cache && cache.headings, line));
        void sendToWeaver(plugin, anchor, editor.getSelection ? editor.getSelection() : "");
      },
    });
    plugin.addCommand({
      id: COMMAND_ID,
      name: "织研者：切换原生页面 / 旧版页面",
      callback: async () => {
        const conf = config(plugin);
        conf.mode = conf.mode === "native" ? "legacy" : "native";
        await persist(plugin);
        const { Notice } = require("obsidian");
        new Notice(conf.mode === "native" ? "织研者：已切换到原生页面" : "织研者：已切换回旧版页面（iframe）");
        const view = window.__scholariumDashboardView;
        if (view && view.activePanel === "deduction" && typeof view.render === "function") await view.render();
      },
    });
    plugin.addCommand({
      id: DEV_MODE_COMMAND_ID,
      name: "织研者：切换开发模式",
      callback: async () => {
        const conf = config(plugin);
        conf.devMode = conf.devMode !== true;
        await persist(plugin);
        const { Notice } = require("obsidian");
        new Notice(conf.devMode ? "织研者：开发模式已开启（重新打开设置可见故障注入与超时）" : "织研者：开发模式已关闭");
        const view = window.__scholariumDashboardView;
        if (view && view.activePanel === "deduction" && typeof view.render === "function") {
          // showDebug is captured when the native page mounts; tear down only
          // that page so the new setting is visible immediately on reopening
          // its settings, while Scholarium's runtime remains untouched.
          destroy(view);
          await view.render();
        }
      },
    });
  }

  /**
   * Draw the 织研者 tab. Returns true when the native page owns the tab body
   * (the caller then returns), false to let Scholarium draw the old iframe.
   */
  function render(view, weaverHost, runtime) {
    const plugin = view.plugin;
    registerCommand(plugin);
    const conf = config(plugin);
    if (conf.mode !== "native" || !available()) {
      destroy(view);
      return false;
    }
    // Already on screen: switching tabs only toggles visibility, exactly as
    // the iframe did, so a running turn is not interrupted.
    if (view.__schNativeWeaver && view.__schNativeWeaverBody && view.__schNativeWeaverBody.parentElement === weaverHost) return true;

    // Coming back from the old page: its iframe goes, so its live Pipeline is
    // not left running behind an invisible frame.
    if (view.__weaverFrame) {
      try { view.__weaverFrame.remove(); } catch (_) { /* already detached */ }
      view.__weaverFrame = null;
    }
    destroy(view);
    weaverHost.empty();
    view.renderBrandBar(weaverHost);
    const body = weaverHost.createDiv({ cls: "scholarium-main scholarium-native-weaver-host" });
    // The host is a persistent absolute panel. `flex-basis:auto` lets the
    // right rail's contents determine this body's height, so an empty/new
    // conversation used to stop well above the bottom of the tab. A zero base
    // makes the body consume precisely the remaining tab height instead.
    body.style.cssText = "flex:1 1 0;height:0;max-height:100%;min-height:0;min-width:0;padding:0;overflow:hidden;display:flex;position:relative;";

    const bridgeBase = (ports) => `${runtime.serviceUrl(ports).replace(/\/+$/, "")}/bridge`;
    try {
      view.__schNativeWeaver = ScholariumNativeWeaver.mountResearchWeaver(body, {
        vault: view.app.vault,
        vaultBasePath: () => {
          const adapter = view.app.vault.adapter;
          const value = adapter && typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
          return typeof value === "string" ? value : "";
        },
        loadSettings: () => config(plugin).page,
        saveSettings: async (next) => {
          config(plugin).page = { ...next };
          await persist(plugin);
        },
        // Where the runtime is, if Scholarium already has one: the ports it
        // recorded. Never a start.
        locate: () => {
          const ports = runtime.vaultPorts(view);
          return ports && ports.canvasPort ? bridgeBase(ports) : null;
        },
        // 「连接运行时」: Scholarium's own start path, the same one the old
        // iframe used, so there is one runtime per vault.
        ensure: async () => {
          const ports = runtime.vaultPorts(view);
          if (!ports) throw new Error("无法确定本 Vault 的运行时端口");
          await runtime.ensure(view, ports);
          return bridgeBase(ports);
        },
        confirm: (message) => confirmWith(view.app, message),
         // 正式构建默认关闭；只由 Scholarium 本地设置中的显式开发开关打开。
         devMode: conf.devMode === true,
        // 「开启执行」: the page has already asked the researcher.
        enableExecution: async () => {
          const file = enableExecutionAt(require("fs"), profileConfigPath(view, runtime));
          await restartRuntime(view, runtime);
          return file;
        },
        publishManualDownloads: (items, options) => publishManualDownloads(view, items.map((item) => ({
          ...item,
          pipelineRunId: item.pipelineRunId || "",
          workspace: item.workspace || (view.app.vault.adapter?.getBasePath?.() || ""),
        })), options),
        openVaultFile: (path) => openVaultFile(view, path),
        openVaultLink: (link) => openVaultLink(view, link),
        // AI 生图：设置与生成都走密钥文件；密钥不进入页面。
        imageService,
        // Confirmed workbench / material / feed actions are queued for this
        // plugin; drain the queue now so the card can show the real outcome.
        flushActionQueue: () => (typeof schPollScholariumQueue === "function" ? schPollScholariumQueue.call(view.plugin) : undefined),
        // Confirmed file-change cards run through Obsidian itself (links kept
        // up to date, nothing overwritten, trash instead of delete, undo).
        app: view.app,
      });
      view.__notifyManualCapture = (item) => notifyManualCapture(view, item);
      view.__schNativeWeaverBody = body;
      return true;
    } catch (error) {
      // A page that cannot mount must not leave the tab empty: fall back to
      // the old page for this render and say why.
      destroy(view);
      weaverHost.empty();
      const { Notice } = require("obsidian");
      new Notice(`原生织研者加载失败，已临时使用旧版页面：${error && error.message ? error.message : error}`, 8000);
      return false;
    }
  }

  return { render, registerCommand, config, available, enableExecutionAt, profileConfigPath, restartRuntime, publishManualDownloads, openVaultFile, openVaultLink, notifyManualCapture, sendToWeaver, anchorForFile, headingPathAt, escapeAnchorPart };
})();
