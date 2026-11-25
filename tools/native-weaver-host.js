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

  async function executeNativePlotTool(plugin, name, input, options = {}) {
    // Source-built releases expose the shared TypeScript client. The controlled
    // installed-plugin hotfix keeps the older shell intact, so fall back to the
    // same Bridge contract without requiring a full main.js replacement.
    let observation;
    if (typeof schCreatePlotToolClient === "function") {
      observation = await schCreatePlotToolClient(plugin).execute(name, input, options);
    } else {
      if (typeof schMaterialBridgeJson !== "function") throw new Error("当前插件缺少绘图 Bridge 传输");
      const workspace = plugin.app.vault.adapter.getBasePath?.();
      if (!workspace) throw new Error("当前 Vault 不是本地桌面 Vault，无法使用绘图工具");
      const response = await schMaterialBridgeJson(plugin, `/v1/plot-tools/${name}`, {
        method: "POST",
        body: JSON.stringify({
          arguments: input,
          context: {
            workspace,
            output_root: options.output_root,
            active_target_manifest_id: options.active_target_manifest_id,
            researcher_confirmed: options.researcher_confirmed === true,
            researcher_save_mode: options.researcher_save_mode || "new_version",
          },
        }),
      });
      if (!response || !response.observation) throw new Error("绘图工具运行时未返回 Observation");
      observation = response.observation;
    }
    if ((name === "render_plot" || name === "revise_plot") && observation?.status === "success") {
      // A successful chart is already durable. A stale library cache must never
      // turn that success into an error Observation or trigger a second render.
      try {
        const dashboard = window.__scholariumDashboardView;
        const library = dashboard?.materialLib;
        if (library && typeof library.loadGeneratedImages === "function") {
          await library.loadGeneratedImages();
          if (dashboard.activePanel === "materials" && typeof library.rerender === "function") library.rerender();
        }
      } catch (error) {
        console.warn("[Scholarium] 绘图已完成，但素材库图表缓存刷新失败", error);
      }
    }
    return observation;
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
      batchId: String(item && item.batchId || "").slice(0, 240),
      workspace: String(item && item.workspace || "").slice(0, 2000),
    })).filter((item) => item.id && /^https?:\/\/\S+$/i.test(item.url));
  }

  async function publishManualDownloads(view, items, options = {}) {
    if (!view?.rssBoard?.setManualDownloadQueue) throw new Error("文献订阅下载队列尚未初始化，请打开文献订阅后重试。");
    const requested = manualDownloadItems(items);
    let next = requested;
    if (options.append === true) {
      const existing = Array.isArray(view.__manualDownloadQueue)
        ? view.__manualDownloadQueue
        : Array.isArray(view.rssBoard?.manualDownloadQueue) ? view.rssBoard.manualDownloadQueue : [];
      const merged = new Map();
      for (const item of [...next, ...existing]) if (item?.id && !merged.has(item.id)) merged.set(item.id, item);
      next = [...merged.values()].slice(0, 200);
    }
    view.__manualDownloadQueue = next;
    view.rssBoard.setManualDownloadQueue(next);
    await view.rssBoard.save?.();
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
    const accepted = new Set((view.rssBoard.manualDownloadQueue || []).map((item) => item.id));
    return requested.filter((item) => accepted.has(item.id)).length;
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
      const side = openSidePanel();
      if (side) {
        if (side.app && side.app.workspace && side.app.workspace.revealLeaf) side.app.workspace.revealLeaf(side.leaf);
        side.__pseudo.__schNativeWeaver.insertReference(anchor, quote || "");
        return;
      }
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

  // Keep the browser's native paste action inside Scholarium inputs while
  // allowing target handlers (including image and long-text paste) to run.
  function installEditablePasteIsolation(plugin) {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (window.__schEditablePasteIsolation) document.removeEventListener("keydown", window.__schEditablePasteIsolation, true);
    const listener = (event) => {
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey) || String(event.key).toLowerCase() !== "v") return;
      const target = event.target;
      if (!target || typeof target.closest !== "function" || !target.closest(".scholarium-dashboard, .scholarium-weaver, .scholarium-native-weaver-side")) return;
      const editable = target.closest("input, textarea, [contenteditable]:not([contenteditable=\"false\"]) ");
      if (!editable || editable.disabled || editable.readOnly) return;
      target.addEventListener("keydown", (current) => current.stopPropagation(), { once: true });
    };
    window.__schEditablePasteIsolation = listener;
    document.addEventListener("keydown", listener, true);
    plugin?.register?.(() => {
      document.removeEventListener("keydown", listener, true);
      if (window.__schEditablePasteIsolation === listener) window.__schEditablePasteIsolation = null;
    });
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

  /* ------------------------------------------------ Claude Code 模型选择 --- */
  /*
   * 织研者调用本机 Claude Code 时用哪个模型、是否开 1M 上下文。写在本库运行时
   * 配置（profiles/<库>/bridge.config.json）里 claude 系适配器的参数上：
   * `--model <模型>` 或 `--model <模型>[1m]`。Bridge 每次派发任务前都会热读适配
   * 器配置，所以改完不用重启。只改对话用的 claude / claude-research 的 --model
   * 参数；全权限车道（permission: "full"）的参数受探针哈希约束，不在这里改。
   * 其余字段（含 token）原样保留。
   */
  const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,119}$/;
  const isClaudeAdapter = (id) => id === "claude" || /^claude-/.test(String(id || ""));

  function readProfileConfig(fs, file) {
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") throw new Error("还没有本库的运行时配置：先点「连接运行时」启动一次");
      throw error;
    }
    let conf;
    try { conf = JSON.parse(text.replace(/^﻿/, "")); } catch (_) { throw new Error(`运行时配置不是有效的 JSON，没有修改：${file}`); }
    if (!conf || typeof conf !== "object" || Array.isArray(conf)) throw new Error(`运行时配置格式不对，没有修改：${file}`);
    return { text, conf };
  }

  function modelOfArgs(args) {
    const list = Array.isArray(args) ? args.map(String) : [];
    for (let index = 0; index < list.length; index += 1) {
      if (list[index] === "--model") return list[index + 1] || "";
      if (list[index].startsWith("--model=")) return list[index].slice(8);
    }
    return "";
  }

  function argsWithoutModel(args) {
    const list = Array.isArray(args) ? args.map(String) : [];
    const out = [];
    for (let index = 0; index < list.length; index += 1) {
      if (list[index] === "--model") { index += 1; continue; }
      if (list[index].startsWith("--model=")) continue;
      out.push(list[index]);
    }
    return out;
  }

  /** What the given agent runs with now: `{ model, longContext, adapters }`. */
  function readAgentModel(fs, file, agentId) {
    const { conf } = readProfileConfig(fs, file);
    const adapters = conf.adapters && typeof conf.adapters === "object" ? conf.adapters : {};
    const names = Object.keys(adapters).filter((name) => isClaudeAdapter(name) && adapters[name] && adapters[name].permission !== "full");
    const own = adapters[agentId] || adapters.claude || adapters[names[0]] || {};
    const raw = modelOfArgs(own.args);
    return {
      supported: isClaudeAdapter(agentId),
      model: raw.replace(/\[1m\]$/i, ""),
      longContext: /\[1m\]$/i.test(raw),
      adapters: names,
    };
  }

  /** Write `--model` onto every Claude adapter of this vault's profile. */
  function applyAgentModel(fs, file, choice) {
    const model = String((choice && choice.model) || "").trim().replace(/\[1m\]$/i, "");
    const longContext = Boolean(choice && choice.longContext) && Boolean(model);
    if (model && !MODEL_ID.test(model)) throw new Error(`模型名“${model}”不合法（只允许字母、数字和 . _ - : / @）`);
    const { text, conf } = readProfileConfig(fs, file);
    const adapters = conf.adapters && typeof conf.adapters === "object" ? conf.adapters : {};
    const names = Object.keys(adapters).filter((name) => isClaudeAdapter(name) && adapters[name] && adapters[name].permission !== "full");
    if (!names.length) throw new Error("本库的运行时配置里没有 Claude Code 适配器，无法设置模型");
    for (const name of names) {
      const adapter = adapters[name];
      if (!adapter || typeof adapter !== "object") continue;
      const args = argsWithoutModel(adapter.args);
      if (model) args.push("--model", longContext ? `${model}[1m]` : model);
      adapter.args = args;
    }
    const path = require("path");
    const backup = `${file}.before-model`;
    if (!fs.existsSync(backup)) writeSecrets(backup, JSON.parse(text.replace(/^﻿/, "")));
    // writeSecrets is the plugin's one atomic JSON write (temp file, mode 0600,
    // rename): the profile holds the runtime token, so the same care applies.
    writeSecrets(file, conf);
    return { model, longContext, adapters: names, file: path.basename(file) };
  }

  /* --------------------------------------- 联网与其他 Agent 的只读接入 --- */
  /*
   * Codex 网页搜索：在本库运行时配置里 codex 适配器的参数上加
   * `-c web_search="cached|live|disabled"`（插在 exec 之后），沙箱仍是 read-only。
   *
   * 其他 Agent：对话车道只接受能由命令行本身保证只读的适配器。能做到的 CLI
   * 由一段固定的 node 启动脚本（WRAPPER，经 `node -e` 运行，不落地成文件）带着
   * 只读设置启动：
   *   - opencode：OPENCODE_PERMISSION / OPENCODE_CONFIG_CONTENT 把除读取、搜索、
   *     webfetch/websearch 以外的权限全部设为 deny（全局和 build agent 两层），
   *     `opencode run --agent build`，提问从 stdin 传入；
   *   - Hermes Agent：`hermes chat --oneshot -Q -t web -q <提问>`，只启用网页工具，
   *     另设 HERMES_WRITE_SAFE_ROOT 指向一个不存在的临时目录；
   *   - OpenClaw：工具权限只能写在它自己的全局配置里，不接入。
   * 接入前在系统临时目录的探针文件夹里真正跑一次：要求它写文件、运行命令、
   * 改文件；结束后文件夹必须只剩原样的 sentinel.json，且回复里有 PROBE-END
   * （证明提问确实送达）。通过后才写入 `<id>-readonly` 适配器（sandboxed:true）；
   * 重新验证失败会把它撤掉。
   */
  const WEB_SEARCH_MODES = ["disabled", "cached", "live"];

  function webSearchOfArgs(args) {
    const list = Array.isArray(args) ? args.map(String) : [];
    for (let index = 0; index < list.length; index += 1) {
      const value = (list[index] === "-c" || list[index] === "--config") ? list[index + 1] || "" : list[index].startsWith("--config=") ? list[index].slice(9) : "";
      const match = /^web_search\s*=\s*"?([a-z]+)"?$/.exec(value);
      if (match && WEB_SEARCH_MODES.includes(match[1])) return match[1];
    }
    return "default";
  }

  function argsWithoutWebSearch(args) {
    const list = Array.isArray(args) ? args.map(String) : [];
    const out = [];
    for (let index = 0; index < list.length; index += 1) {
      if ((list[index] === "-c" || list[index] === "--config") && /^web_search\s*=/.test(list[index + 1] || "")) { index += 1; continue; }
      if (/^--config=web_search\s*=/.test(list[index])) continue;
      out.push(list[index]);
    }
    return out;
  }

  function codexAdapter(conf) {
    const adapter = conf.adapters && typeof conf.adapters === "object" ? conf.adapters.codex : null;
    if (!adapter || typeof adapter !== "object" || !Array.isArray(adapter.args)) throw new Error("本库的运行时配置里没有 codex 适配器");
    return adapter;
  }

  function readCodexWebSearch(fs, file) {
    return webSearchOfArgs(codexAdapter(readProfileConfig(fs, file).conf).args);
  }

  function applyCodexWebSearch(fs, file, mode) {
    if (mode !== "default" && !WEB_SEARCH_MODES.includes(mode)) throw new Error(`不认识的网页搜索模式：${mode}`);
    const { text, conf } = readProfileConfig(fs, file);
    const adapter = codexAdapter(conf);
    const args = argsWithoutWebSearch(adapter.args);
    if (mode !== "default") {
      const at = args.indexOf("exec");
      args.splice(at >= 0 ? at + 1 : args.length, 0, "-c", `web_search="${mode}"`);
    }
    adapter.args = args;
    const backup = `${file}.before-web-search`;
    if (!fs.existsSync(backup)) writeSecrets(backup, JSON.parse(text.replace(/^﻿/, "")));
    writeSecrets(file, conf);
    return { mode };
  }

  /**
   * 研究员要求所有对话 Agent 都能联网：Codex 的网页搜索在本库第一次读到运行时
   * 配置时打开一次（实时结果）。之后以设置里的选择为准——改成「默认」或「关闭」
   * 不会被再次打开。
   */
  function ensureCodexWebSearchOn(plugin, file) {
    const conf = config(plugin);
    if (conf.codexWebSearchDefaulted === true) return false;
    const fs = require("fs");
    let current;
    try { current = readCodexWebSearch(fs, file); } catch (_) { return false; }
    if (current === "default") applyCodexWebSearch(fs, file, "live");
    conf.codexWebSearchDefaulted = true;
    void persist(plugin);
    return current === "default";
  }

  /** Runs one CLI with its read-only settings. Passed to node with -e, so it is never a file. */
  const READONLY_WRAPPER = String.raw`"use strict";
const cp = require("child_process"), fs = require("fs"), path = require("path");
const spec = JSON.parse(process.argv[1]);
const fail = (message) => { process.stderr.write("[scholarium] " + message + "\n"); process.exit(2); };
function fromShim(file) {
  // npm / pnpm .cmd shims end with:  "%dp0%\node_modules\<pkg>\<bin>" %*
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (_) { return null; }
  const found = [...text.matchAll(/"%~?dp0%?\\?([^"%]+?)"\s+%\*/g)].map((m) => m[1]).filter((p) => !/node(\.exe)?$/i.test(p));
  const rel = found.pop();
  if (!rel) return null;
  const target = path.resolve(path.dirname(file), rel.replace(/\\/g, path.sep));
  if (!fs.existsSync(target)) return null;
  if (/\.exe$/i.test(target)) return { file: target, pre: [] };
  if (/\.(cmd|bat|ps1|sh)$/i.test(target)) return null;
  return { file: process.execPath, pre: [target] };
}
function locate(names) {
  for (const name of [].concat(names)) {
    let out = "";
    try { out = cp.execFileSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8", windowsHide: true }); } catch (_) { continue; }
    const lines = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const exe = lines.find((line) => /\.exe$/i.test(line));
    if (exe) return { file: exe, pre: [] };
    for (const line of lines) {
      if (!/\.(cmd|bat)$/i.test(line)) continue;
      const shim = fromShim(line);
      if (shim) return shim;
    }
    if (process.platform !== "win32" && lines[0]) return { file: lines[0], pre: [] };
  }
  return null;
}
const target = locate(spec.cli);
if (!target) fail([].concat(spec.cli).join(" / ") + " 没有安装，或不在 PATH 中（或无法安全启动）");
const run = (raw) => {
  let input = raw;
  const args = [...target.pre, ...spec.args];
  if (spec.prompt === "arg") {
    input = input.trim();
    const limit = spec.maxArg || 28000;
    if (input.length > limit) fail("这轮发给 " + [].concat(spec.cli)[0] + " 的内容有 " + input.length + " 字，超过它能通过命令行接收的约 " + limit + " 字；请新建一段对话再问");
    args.push(input);
  }
  const child = cp.spawn(target.file, args, { stdio: [spec.prompt === "stdin" ? "pipe" : "ignore", "inherit", "inherit"], env: { ...process.env, ...(spec.env || {}) }, windowsHide: true, shell: false });
  if (spec.prompt === "stdin") { child.stdin.on("error", () => {}); child.stdin.end(input); }
  child.on("error", (error) => fail(error.message));
  child.on("close", (code) => process.exit(code === null ? 1 : code));
};
if (spec.prompt === "none") run("");
else {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => run(input));
}
`;

  const OPENCODE_READONLY = {
    "*": "deny", read: "allow", glob: "allow", grep: "allow", list: "allow", lsp: "allow",
    webfetch: "allow", websearch: "allow", codesearch: "allow", todoread: "allow",
  };

  function readOnlyCatalog() {
    const os = require("os");
    const path = require("path");
    return {
      opencode: {
        label: "opencode",
        capability: "可以读取、搜索当前工作区的文件，可以 webfetch / websearch 联网（websearch 经 Exa，对任何服务商开放）；编辑、写入、运行命令、启动子代理一律拒绝（opencode 权限配置 deny，全局与 build agent 两层）。",
        spec: {
          cli: ["opencode"],
          args: ["run", "--agent", "build"],
          prompt: "stdin",
          env: {
            OPENCODE_PERMISSION: JSON.stringify(OPENCODE_READONLY),
            OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: OPENCODE_READONLY, agent: { build: { permission: OPENCODE_READONLY } } }),
            // websearch 默认只对 OpenCode Zen 的模型开放；这个开关让其他服务商也能用（Exa）。
            OPENCODE_ENABLE_EXA: "true",
          },
        },
        staticCheck: ["debug", "agent", "build"],
      },
      hermes: {
        label: "Hermes Agent",
        capability: "只启用网页工具（联网搜索、读取网页；没有配置搜索服务时 Hermes 自动用免密钥的 Exa / Parallel / Firecrawl / Keenable 轮换）；不能读写本机文件、不能运行命令。提问通过命令行参数传入，单轮约 2.8 万字以内。",
        spec: {
          cli: ["hermes"],
          args: ["chat", "--oneshot", "-Q", "-t", "web", "-q"],
          prompt: "arg",
          maxArg: 28000,
          env: { HERMES_WRITE_SAFE_ROOT: path.join(os.tmpdir(), "scholarium-hermes-no-writes") },
        },
      },
      openclaw: {
        label: "OpenClaw",
        unsupported: "OpenClaw 的工具权限只能写在它自己的全局配置（openclaw.json）里，通常还要经过它的 Gateway 运行，没有可按次指定的只读方式；Scholarium 不修改你的 OpenClaw 配置，所以暂不接入对话车道。",
      },
      kimi: {
        label: "Kimi CLI",
        capability: "Kimi 计划模式：只用只读工具（读文件、搜索、联网搜索 / 抓取网页取决于你的 Kimi 账号）；不写文件、不运行命令。提问通过命令行参数传入，单轮约 2.8 万字以内。",
        spec: { cli: ["kimi"], args: ["--plan", "--quiet", "-p"], prompt: "arg", maxArg: 28000 },
      },
      qoder: {
        label: "Qoder CLI",
        capability: "Qoder 计划模式（--permission-mode plan）：只读工具；不写文件、不运行命令。提问通过命令行参数传入。",
        spec: { cli: ["qodercli", "qoder"], args: ["--permission-mode", "plan", "-p"], prompt: "arg", maxArg: 28000 },
      },
      gemini: {
        label: "Gemini CLI",
        capability: "Gemini 计划模式（--approval-mode plan）：读文件、搜索、Google 搜索；不写文件、不运行命令。",
        spec: { cli: ["gemini"], args: ["--approval-mode", "plan", "-p"], prompt: "arg", maxArg: 28000 },
      },
      qwen: {
        label: "Qwen Code",
        capability: "Qwen Code 计划模式（--approval-mode plan）：只读工具；不写文件、不运行命令。",
        spec: { cli: ["qwen"], args: ["--approval-mode", "plan", "-p"], prompt: "arg", maxArg: 28000 },
      },
      copilot: {
        label: "GitHub Copilot CLI",
        capability: "Copilot 命令行：禁止 shell 与 write 工具（--deny-tool，优先级高于任何允许）；可以读文件。",
        spec: { cli: ["copilot"], args: ["--deny-tool", "shell", "--deny-tool", "write", "-p"], prompt: "arg", maxArg: 28000 },
      },
      cursor: {
        label: "Cursor Agent",
        capability: "Cursor 命令行输出模式（-p，不加 --force）：只给回答，不落地任何改动。",
        spec: { cli: ["cursor-agent"], args: ["-p", "--output-format", "text"], prompt: "arg", maxArg: 28000 },
      },
    };
  }

  function runtimeNodeExe() {
    const fs = require("fs");
    const path = require("path");
    if (typeof schRuntimeRoot !== "function" || typeof SCH_RUNTIME_RELEASE === "undefined") throw new Error("这个版本的 Scholarium 没有本机运行时");
    const exe = path.join(schRuntimeRoot(), "versions", SCH_RUNTIME_RELEASE.version, "core", "runtime", "node", process.platform === "win32" ? "node.exe" : "bin/node");
    if (!fs.existsSync(exe)) throw new Error("本机运行时还没有安装好：先在织研者点「连接运行时」");
    return exe;
  }

  /** Run the wrapper exactly as the Bridge will. */
  function runReadOnly(nodeExe, spec, { cwd, input = "", timeoutMs = 240000 } = {}) {
    const { spawn } = require("child_process");
    return new Promise((resolve) => {
      const child = spawn(nodeExe, ["-e", READONLY_WRAPPER, JSON.stringify(spec)], { cwd, windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = window.setTimeout(() => { timedOut = true; try { child.kill(); } catch (_) { /* gone */ } }, timeoutMs);
      child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-200000); });
      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-20000); });
      child.on("error", (error) => { window.clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
      child.on("close", (code) => { window.clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }

  const PROBE_PROMPT = [
    "这是一次只读能力测试。请按顺序尝试下面四件事，不要询问确认，能做的就直接做，并如实报告每一步是否成功：",
    "1. 读取当前目录下的 sentinel.json，写出其中 sentinel 字段的值。",
    "2. 在当前目录新建文件 probe-write.txt，内容为 WRITE。",
    "3. 运行一个命令，把 RUN 写入当前目录的 probe-run.txt。",
    "4. 把 sentinel.json 的内容改成 {\"sentinel\":\"CHANGED\"}。",
    "最后单独一行输出 PROBE-END。",
  ].join("\n");

  const readOnlyId = (id) => `${id}-readonly`;

  function readOnlyFailures(plugin) {
    const conf = config(plugin);
    if (!conf.readOnlyFailures || typeof conf.readOnlyFailures !== "object") conf.readOnlyFailures = {};
    return conf.readOnlyFailures;
  }

  async function readOnlyRows(view, runtime) {
    const fs = require("fs");
    let adapters = {};
    try { adapters = readProfileConfig(fs, profileConfigPath(view, runtime)).conf.adapters || {}; } catch (_) { adapters = {}; }
    let nodeExe = "";
    try { nodeExe = runtimeNodeExe(); } catch (_) { nodeExe = ""; }
    const failures = readOnlyFailures(view.plugin);
    const checks = Object.entries(readOnlyCatalog()).map(async ([id, item]) => {
      const base = { id, label: item.label, adapterId: readOnlyId(id), capability: item.capability || "", version: "", note: "", verifiedAt: "" };
      if (item.unsupported) return { ...base, state: "unsupported", note: item.unsupported };
      const existing = adapters[readOnlyId(id)];
      const probe = existing && existing.readOnlyProbe ? existing.readOnlyProbe : null;
      if (!nodeExe) return { ...base, state: existing ? "enabled" : "missing", note: "本机运行时还没有安装好，暂时无法检查或验证。", verifiedAt: probe ? String(probe.verifiedAt || "") : "" };
      const version = await runReadOnly(nodeExe, { ...item.spec, args: ["--version"], prompt: "none" }, { timeoutMs: 20000 });
      if (version.code !== 0 && /没有安装/.test(version.stderr)) return { ...base, state: existing ? "enabled" : "missing", note: existing ? "已接入，但现在找不到这个程序；对话会失败。" : "" };
      const versionText = (version.stdout.trim().split(/\r?\n/).pop() || "").slice(0, 60);
      const failure = failures[id];
      if (!existing && failure && failure.version === versionText) {
        return { ...base, state: "failed", version: versionText, note: String(failure.reason || "") };
      }
      return {
        ...base,
        state: existing ? "enabled" : "available",
        version: versionText,
        verifiedAt: probe ? String(probe.verifiedAt || "") : "",
        note: probe && probe.version && versionText && probe.version !== versionText ? "验证之后这个程序升级过，建议重新验证。" : "",
      };
    });
    return Promise.all(checks);
  }

  function writeReadOnlyAdapter(view, runtime, id, adapter) {
    const fs = require("fs");
    const file = profileConfigPath(view, runtime);
    const { text, conf } = readProfileConfig(fs, file);
    conf.adapters = conf.adapters && typeof conf.adapters === "object" ? conf.adapters : {};
    if (adapter) conf.adapters[readOnlyId(id)] = adapter;
    else if (conf.adapters[readOnlyId(id)]) delete conf.adapters[readOnlyId(id)];
    else return false;
    const backup = `${file}.before-readonly`;
    if (!fs.existsSync(backup)) writeSecrets(backup, JSON.parse(text.replace(/^﻿/, "")));
    writeSecrets(file, conf);
    return true;
  }

  async function verifyReadOnly(view, runtime, id) {
    const fs = require("fs");
    const path = require("path");
    const os = require("os");
    const item = readOnlyCatalog()[id];
    if (!item) throw new Error(`不认识的 Agent：${id}`);
    if (item.unsupported) throw new Error(item.unsupported);
    const nodeExe = runtimeNodeExe();
    const steps = [];
    const version = await runReadOnly(nodeExe, { ...item.spec, args: ["--version"], prompt: "none" }, { timeoutMs: 20000 });
    if (version.code !== 0) throw new Error((version.stderr || version.stdout || `${item.label} 无法启动`).trim().slice(0, 300));
    const versionText = (version.stdout.trim().split(/\r?\n/).pop() || "").slice(0, 60);
    steps.push(`找到 ${item.label}${versionText ? ` ${versionText}` : ""}`);
    if (item.staticCheck) {
      const check = await runReadOnly(nodeExe, { ...item.spec, args: item.staticCheck, prompt: "none" }, { timeoutMs: 30000 });
      steps.push(check.code === 0 && /deny/i.test(check.stdout) ? "它报告的生效权限里包含 deny 规则" : "没能读到它报告的生效权限，只依据下面的实测");
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.join(os.tmpdir(), "scholarium-readonly-probe", `${id}-${stamp}`);
    const sentinelFile = path.join(dir, "sentinel.json");
    const token = `S-${Math.random().toString(36).slice(2, 10)}`;
    writeSecrets(sentinelFile, { sentinel: token });
    const before = fs.readFileSync(sentinelFile, "utf8");
    const run = await runReadOnly(nodeExe, item.spec, { cwd: dir, input: PROBE_PROMPT });
    let entries = [];
    try { entries = fs.readdirSync(dir).sort(); } catch (_) { entries = []; }
    let after = "";
    try { after = fs.readFileSync(sentinelFile, "utf8"); } catch (_) { after = ""; }
    const unchanged = entries.length === 1 && entries[0] === "sentinel.json" && after === before;
    const reached = /PROBE-END/.test(run.stdout);
    if (run.timedOut) steps.push("超过 4 分钟没有结束，已停止");
    else steps.push(run.code === 0 ? "测试对话正常结束" : `测试对话以代码 ${run.code} 结束${run.stderr.trim() ? `：${run.stderr.trim().slice(-200)}` : ""}`);
    steps.push(reached ? "提问已送达（回复里有 PROBE-END）" : "回复里没有 PROBE-END：提问可能没有送达，或模型没有完成");
    steps.push(unchanged ? "测试文件夹没有任何变化（没有新文件，sentinel.json 未被修改）" : `测试文件夹被改动了：${entries.join("、") || "sentinel.json 不见了"}${after !== before ? "；sentinel.json 内容变了" : ""}`);
    if (id === "opencode") steps.push(run.stdout.includes(token) ? "能读取工作区文件" : "回复里没有 sentinel 的值：读取文件可能也被拦了");
    steps.push(`测试文件夹：${dir}`);
    const ok = !run.timedOut && run.code === 0 && reached && unchanged;
    const tail = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(-220);
    const reason = ok ? "" : run.timedOut ? "超过 4 分钟没有结束"
      : !unchanged ? `测试文件夹被改动了（${entries.join("、") || "sentinel.json 不见了"}），它不是只读的`
      : run.code !== 0 ? `运行出错：${tail(run.stderr || run.stdout) || `退出代码 ${run.code}`}`
      : "回复里没有结束标记：提问没有送达，或模型没有完成";
    const failures = readOnlyFailures(view.plugin);
    if (ok) delete failures[id];
    else failures[id] = { at: new Date().toISOString(), version: versionText, reason };
    void persist(view.plugin);
    if (ok) {
      writeReadOnlyAdapter(view, runtime, id, {
        command: nodeExe,
        args: ["-e", READONLY_WRAPPER, JSON.stringify(item.spec)],
        sandboxed: true,
        promptTransport: "stdin",
        readOnlyProbe: { verifiedAt: new Date().toISOString(), version: versionText, method: "scholarium-readonly-probe/1" },
      });
      steps.push("已写入本库运行时配置，正在重启运行时");
      try { await restartRuntime(view, runtime); } catch (error) { steps.push(`重启运行时失败：${error.message}；请手动点「重新连接」`); }
    } else if (writeReadOnlyAdapter(view, runtime, id, null)) {
      steps.push("之前的接入已撤掉");
      try { await restartRuntime(view, runtime); } catch (_) { /* reconnect by hand */ }
    }
    const rows = await readOnlyRows(view, runtime);
    return { ok, reason, row: rows.find((row) => row.id === id), steps };
  }

  async function disableReadOnly(view, runtime, id) {
    if (writeReadOnlyAdapter(view, runtime, id, null)) await restartRuntime(view, runtime);
    const rows = await readOnlyRows(view, runtime);
    return rows.find((row) => row.id === id);
  }

  /* ------------------------------------------------- 织研者代为联网 --- */
  /*
   * Agent 在回复里写 ```scholarium-web 请求时，页面通过这里取网页：Obsidian 的
   * requestUrl 由主进程发出，没有跨域限制，并使用系统代理。只做 GET；拒绝本机、
   * 内网和非 http(s) 地址（页面那边也检查一遍）；正文最多 2 MB。
   */
  function privateHost(value) {
    let url;
    try { url = new URL(String(value)); } catch (_) { return true; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return true;
    if (url.username || url.password) return true;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return !host || host === "localhost" || /\.(localhost|local|internal)$/.test(host)
      || /^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
      || host === "::1" || /^(fc|fd|fe80)/.test(host) || /^\d+$/.test(host);
  }

  async function hostWebFetch(url, accept) {
    if (privateHost(url)) throw new Error("不访问本机、内网或非 http(s) 地址");
    const { requestUrl } = require("obsidian");
    const response = await requestUrl({ url: String(url), method: "GET", headers: { Accept: accept || "*/*" }, throw: false });
    let text = "";
    try { text = String(response.text || ""); } catch (_) { text = ""; }
    const headers = response.headers || {};
    return {
      status: Number(response.status) || 0,
      text: text.slice(0, 2 * 1024 * 1024),
      contentType: String(headers["content-type"] || headers["Content-Type"] || ""),
      url: String(url),
    };
  }

  /** 「织研者代为联网」：默认开启，设置里可以关。 */
  function webProxyOn(plugin) {
    return config(plugin).webProxy !== false;
  }

  /*
   * Claude Code 的 WebFetch 每次先向 claude.ai 做域名预检；国内网络或第三方中转
   * 时这一步失败，所有网页都抓不了（“Unable to verify if domain … is safe to
   * fetch”）。打开后在织研者调用的 Claude 适配器上加
   * `--settings {"skipWebFetchPreflight":true}`，不改研究员自己的 Claude Code 配置。
   */
  const PREFLIGHT_SETTINGS = JSON.stringify({ skipWebFetchPreflight: true });

  function claudeChatAdapters(conf) {
    const adapters = conf.adapters && typeof conf.adapters === "object" ? conf.adapters : {};
    return Object.keys(adapters).filter((name) => isClaudeAdapter(name) && adapters[name] && adapters[name].permission !== "full" && Array.isArray(adapters[name].args)).map((name) => adapters[name]);
  }

  function preflightSkipped(args) {
    const list = Array.isArray(args) ? args.map(String) : [];
    const at = list.indexOf("--settings");
    if (at < 0) return false;
    try { return JSON.parse(list[at + 1] || "{}").skipWebFetchPreflight === true; } catch (_) { return false; }
  }

  function readClaudePreflight(fs, file) {
    const adapters = claudeChatAdapters(readProfileConfig(fs, file).conf);
    if (!adapters.length) throw new Error("本库的运行时配置里没有 Claude Code 适配器");
    return adapters.every((adapter) => preflightSkipped(adapter.args));
  }

  function applyClaudePreflight(fs, file, on) {
    const { text, conf } = readProfileConfig(fs, file);
    const adapters = claudeChatAdapters(conf);
    if (!adapters.length) throw new Error("本库的运行时配置里没有 Claude Code 适配器");
    for (const adapter of adapters) {
      const list = adapter.args.map(String);
      const at = list.indexOf("--settings");
      if (at >= 0) list.splice(at, 2);
      if (on) list.push("--settings", PREFLIGHT_SETTINGS);
      adapter.args = list;
    }
    const backup = `${file}.before-preflight`;
    if (!fs.existsSync(backup)) writeSecrets(backup, JSON.parse(text.replace(/^﻿/, "")));
    writeSecrets(file, conf);
    return { on: Boolean(on) };
  }

  /** 研究员要求所有 Agent 都能联网：第一次读到本库运行时配置时打开一次；之后以设置为准。 */
  function ensureClaudePreflightOff(plugin, file) {
    const conf = config(plugin);
    if (conf.claudePreflightDefaulted === true) return false;
    const fs = require("fs");
    let skipped;
    try { skipped = readClaudePreflight(fs, file); } catch (_) { return false; }
    if (!skipped) applyClaudePreflight(fs, file, true);
    conf.claudePreflightDefaulted = true;
    void persist(plugin);
    return !skipped;
  }

  const CLAUDE_ALIASES = [
    { id: "sonnet", label: "sonnet（最新 Sonnet）" },
    { id: "opus", label: "opus（最新 Opus）" },
    { id: "haiku", label: "haiku（最新 Haiku）" },
    { id: "opusplan", label: "opusplan（规划用 Opus，执行用 Sonnet）" },
  ];

  /** Where Claude Code sends requests and with which key: its settings file's
   * `env` block (cc-switch writes the selected provider there), then the
   * environment. The key stays in this function's caller; it is never returned
   * to the page. */
  function claudeEndpoint(fs, path, home, env) {
    let settingsEnv = {};
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8").replace(/^﻿/, ""));
      if (parsed && parsed.env && typeof parsed.env === "object") settingsEnv = parsed.env;
    } catch (_) { /* no settings file: use the environment */ }
    const pick = (name) => trimmed(settingsEnv[name]) || trimmed(env[name]);
    const configured = ["ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_SMALL_FAST_MODEL"]
      .map(pick).filter(Boolean);
    return {
      base: (pick("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/+$/, ""),
      key: pick("ANTHROPIC_AUTH_TOKEN") || pick("ANTHROPIC_API_KEY"),
      configured: [...new Set(configured.map((value) => value.replace(/\[1m\]$/i, "")))],
    };
  }

  function modelsUrl(base, after) {
    const root = /\/v1$/i.test(base) ? base : `${base}/v1`;
    return `${root}/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ""}`;
  }

  /** Ask the provider Claude Code is configured for which models this key may
   * use (`GET /v1/models`, as cc-switch does). Returns ids and labels only. */
  async function scanClaudeModels(request) {
    const fs = require("fs"), path = require("path"), os = require("os");
    const home = process.env.USERPROFILE || os.homedir();
    const endpoint = claudeEndpoint(fs, path, home, process.env);
    let host = "";
    try { host = new URL(endpoint.base).host; } catch (_) { throw new Error(`Claude Code 的服务地址无效：${endpoint.base}`); }
    const local = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
    if (!/^https:\/\//i.test(endpoint.base) && !local) throw new Error(`服务地址不是 https，未扫描：${host}`);
    const result = { host, configured: endpoint.configured, aliases: CLAUDE_ALIASES, models: [], note: "" };
    if (!endpoint.key) {
      result.note = "本机 Claude Code 用账号登录（没有 API Key），服务商不提供模型列表；可选下面的别名或手动输入模型名。";
      return result;
    }
    const send = request || require("obsidian").requestUrl;
    const seen = new Map();
    let after = "";
    for (let page = 0; page < 5; page += 1) {
      const response = await send({
        url: modelsUrl(endpoint.base, after),
        method: "GET",
        headers: { "x-api-key": endpoint.key, Authorization: `Bearer ${endpoint.key}`, "anthropic-version": "2023-06-01" },
        throw: false,
      });
      if (response.status === 401 || response.status === 403) throw new Error(`${host} 拒绝了当前密钥（HTTP ${response.status}）：请在 cc-switch / Claude Code 里检查 API Key`);
      if (response.status === 404 || response.status === 405) {
        result.note = `${host} 不提供模型列表接口；可手动输入模型名，或选下面的别名。`;
        return result;
      }
      if (response.status >= 400) throw new Error(`扫描模型失败：${host} 返回 HTTP ${response.status}`);
      let json = null;
      try { json = response.json; } catch (_) { json = null; }
      const list = json && Array.isArray(json.data) ? json.data : json && Array.isArray(json.models) ? json.models : [];
      for (const item of list) {
        const id = trimmed(item && (item.id || item.name)).replace(/^models\//, "");
        if (id && MODEL_ID.test(id) && !seen.has(id)) seen.set(id, trimmed(item.display_name || item.displayName) || id);
      }
      if (!(json && json.has_more && json.last_id)) break;
      after = String(json.last_id);
    }
    result.models = [...seen].map(([id, label]) => ({ id, label })).sort((a, b) => a.id.localeCompare(b.id));
    if (!result.models.length) result.note = `${host} 没有返回可用模型；可手动输入模型名。`;
    return result;
  }

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
    // The tab's page is gone; an open side panel still takes browser captures.
    const side = view.__side ? null : openSidePanel();
    if (side) {
      view.__notifyManualCapture = (item) => notifyManualCapture(side.__pseudo, item);
      view.__notifyManualCapture.__fromSide = side;
    }
  }

  function registerCommand(plugin) {
    if (!plugin || typeof plugin.addCommand !== "function" || commandRegistered.has(plugin)) return;
    commandRegistered.add(plugin);
    installEditablePasteIsolation(plugin);
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

  /* ---------------------------------------------------- 侧边栏织研者 --- */
  /*
   * 织研者也可以在 Obsidian 右侧边栏打开，和正在看的笔记并排。顶部「织研者」
   * 标签和侧边栏可以同时打开、同时对话：两处用同一个课题、同一份对话记录（同
   * 一个对话存储，写入排队，一处写了另一处立即重读）和同一个本机运行时。同
   * 一段对话同一时间只等一条回复，另一处会显示“正在等待”。
   */
  const SIDE_VIEW = "scholarium-native-weaver-side";
  const SIDE_COMMAND_ID = "open-native-weaver-sidebar";
  const sidebarInstalled = new WeakSet();
  const sidePanels = new Set();
  let lastRuntime = null;

  function openSidePanel() {
    for (const side of sidePanels) if (side.__pseudo && side.__pseudo.__schNativeWeaver) return side;
    return null;
  }

  /** The runtime for a side panel opened before the dashboard ever drew its
   * tab: the same per-vault ports and start path the dashboard uses. */
  function fallbackRuntime() {
    const serviceUrl = (ports) => {
      if (!ports || !ports.canvasPort) throw new Error("Scholarium runtime 尚未回报 canvas 端口");
      return `http://127.0.0.1:${ports.canvasPort}/`;
    };
    const health = async (ports) => {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 1800);
      try {
        const response = await fetch(`${serviceUrl(ports)}bridge/health`, { cache: "no-store", signal: ctrl.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      } finally {
        window.clearTimeout(timer);
      }
    };
    return {
      vaultPorts: (view) => schVaultBridgePorts(view.app),
      serviceUrl,
      ensure: async (view, ports) => {
        if (ports.canvasPort) {
          try { return await health(ports); } catch (_) { /* stale: start this vault's runtime */ }
        }
        return schStartAndWaitLocalRuntime(view.plugin, ports, () => health(ports));
      },
    };
  }

  /** The note the researcher is reading, for the side panel's 「当前笔记」. A
   * click into the side panel is not a note change: only Markdown views count. */
  function activeNoteSource(app) {
    const describe = (file) => (file && /^md$/i.test(String(file.extension || "")) ? { path: file.path, title: file.basename || file.path, anchor: anchorForFile(app, file, []) } : null);
    let last = describe(app.workspace && typeof app.workspace.getActiveFile === "function" ? app.workspace.getActiveFile() : null);
    return {
      current: () => last,
      subscribe: (listener) => {
        const set = (next) => { last = next; listener(last); };
        const refs = [];
        const on = (target, name, handler) => {
          if (target && typeof target.on === "function") refs.push([target, target.on(name, handler)]);
        };
        on(app.workspace, "active-leaf-change", (leaf) => {
          const view = leaf && leaf.view;
          if (view && typeof view.getViewType === "function" && view.getViewType() === "markdown" && view.file) set(describe(view.file));
        });
        on(app.workspace, "file-open", (file) => { const next = describe(file); if (next) set(next); });
        on(app.vault, "rename", (file, oldPath) => { if (last && last.path === oldPath) set(describe(file)); });
        on(app.vault, "delete", (file) => { if (last && file && file.path === last.path) set(null); });
        return () => {
          for (const [target, ref] of refs) { try { target.offref(ref); } catch (_) { /* already gone */ } }
        };
      },
    };
  }

  function mountSide(side) {
    const host = side.contentEl;
    host.empty();
    host.addClass("scholarium-native-weaver-side");
    if (!available()) {
      host.createDiv({ text: "这个版本的 Scholarium 没有原生织研者页面。" });
      return;
    }
    const plugin = side.plugin;
    const pseudo = { app: side.app, plugin, leaf: side.leaf, __side: true, __schNativeWeaver: null };
    side.__pseudo = pseudo;
    const body = host.createDiv({ cls: "scholarium-native-weaver-host" });
    body.style.cssText = "height:100%;min-height:0;min-width:0;padding:0;overflow:hidden;display:flex;position:relative;";
    try {
      pseudo.__schNativeWeaver = ScholariumNativeWeaver.mountResearchWeaver(body, mountOptions(pseudo, lastRuntime || fallbackRuntime(), {
        activeNote: activeNoteSource(side.app),
        // Side panel: opens on a new conversation, numbered tabs, 历史记录 and
        // / commands. Its open tabs are kept in Scholarium's settings.
        layout: "sidebar",
        sideTabs: {
          load: (scopeKey) => {
            const saved = config(plugin).sideTabs;
            return saved && Array.isArray(saved[scopeKey]) ? saved[scopeKey].filter((id) => typeof id === "string") : [];
          },
          save: (scopeKey, ids) => {
            const conf = config(plugin);
            conf.sideTabs = { ...(conf.sideTabs && typeof conf.sideTabs === "object" ? conf.sideTabs : {}), [scopeKey]: [...ids].slice(-12) };
            void persist(plugin);
          },
        },
      }));
      sidePanels.add(side);
    } catch (error) {
      host.empty();
      host.createDiv({ text: `织研者加载失败：${error && error.message ? error.message : error}` });
      return;
    }
    // A browser capture lands in the tab's page when it is open; with only the
    // side panel open, it lands there.
    const dash = window.__scholariumDashboardView;
    if (dash && !dash.__schNativeWeaver) {
      const relay = (item) => notifyManualCapture(pseudo, item);
      relay.__fromSide = side;
      dash.__notifyManualCapture = relay;
    }
  }

  function unmountSide(side) {
    sidePanels.delete(side);
    const pseudo = side.__pseudo;
    if (pseudo && pseudo.__schNativeWeaver) {
      try { pseudo.__schNativeWeaver.destroy(); } catch (_) { /* closing must not throw */ }
      pseudo.__schNativeWeaver = null;
    }
    side.__pseudo = null;
    const dash = window.__scholariumDashboardView;
    if (dash && dash.__notifyManualCapture && dash.__notifyManualCapture.__fromSide === side) {
      const other = openSidePanel();
      dash.__notifyManualCapture = other ? (item) => notifyManualCapture(other.__pseudo, item) : null;
      if (dash.__notifyManualCapture) dash.__notifyManualCapture.__fromSide = other;
    }
  }

  async function revealSidePanel(plugin) {
    const workspace = plugin.app.workspace;
    let leaf = workspace.getLeavesOfType(SIDE_VIEW)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: SIDE_VIEW, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf;
  }

  /**
   * Called from Scholarium's onload: registers the side view (so a side panel
   * left open is restored with the workspace), a ribbon icon and a command.
   * Opening the panel never starts the runtime by itself.
   */
  function installSidebar(plugin) {
    if (!plugin || sidebarInstalled.has(plugin) || typeof plugin.registerView !== "function") return false;
    sidebarInstalled.add(plugin);
    const { ItemView } = require("obsidian");
    class NativeWeaverSideView extends ItemView {
      constructor(leaf) { super(leaf); this.plugin = plugin; }
      getViewType() { return SIDE_VIEW; }
      getDisplayText() { return "织研者"; }
      getIcon() { return "messages-square"; }
      async onOpen() { mountSide(this); }
      async onClose() { unmountSide(this); }
    }
    plugin.registerView(SIDE_VIEW, (leaf) => new NativeWeaverSideView(leaf));
    if (typeof plugin.addRibbonIcon === "function") plugin.addRibbonIcon("messages-square", "在侧边栏打开织研者", () => void revealSidePanel(plugin));
    plugin.addCommand({ id: SIDE_COMMAND_ID, name: "织研者：在侧边栏打开", callback: () => void revealSidePanel(plugin) });
    registerCommand(plugin);
    return true;
  }

  /**
   * Everything the page needs from Scholarium, for one host: the dashboard's
   * 织研者 tab or the side panel. `view` only has to carry `app` and `plugin`.
   */
  function mountOptions(view, runtime, extra = {}) {
    const plugin = view.plugin;
    const conf = config(plugin);
    const bridgeBase = (ports) => `${runtime.serviceUrl(ports).replace(/\/+$/, "")}/bridge`;
    return {
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
      publishManualDownloads: (items, options) => publishManualDownloads(view.__side ? (window.__scholariumDashboardView || view) : view, items.map((item) => ({
        ...item,
        pipelineRunId: item.pipelineRunId || "",
        workspace: item.workspace || (view.app.vault.adapter?.getBasePath?.() || ""),
      })), options),
      openVaultFile: (path) => openVaultFile(view, path),
      openVaultLink: (link) => openVaultLink(view, link),
      // The factory is module-local in the embedded CommonJS bundle, not a window global.
      plotTools: schNativeWeaverPlotTools,
      executePlotTool: (name, input, options) => executeNativePlotTool(plugin, name, input, options),
      // AI 生图：设置与生成都走密钥文件；密钥不进入页面。
      imageService,
      // Claude Code 模型与 1M 上下文：读写本库运行时配置，扫描用本机
      // Claude Code 当前的服务商与密钥（密钥不进入页面）。
      agentModels: {
        read: async (agentId) => readAgentModel(require("fs"), profileConfigPath(view, runtime), agentId),
        apply: async (agentId, choice) => applyAgentModel(require("fs"), profileConfigPath(view, runtime), choice),
        scan: async () => scanClaudeModels(),
      },
      // Codex 网页搜索与其他 Agent 的只读接入：同一份本库运行时配置。
      agentAccess: {
        webProxy: {
          read: async () => webProxyOn(plugin),
          apply: async (on) => { config(plugin).webProxy = Boolean(on); await persist(plugin); },
        },
        claudePreflight: {
          read: async () => {
            const file = profileConfigPath(view, runtime);
            ensureClaudePreflightOff(plugin, file);
            return readClaudePreflight(require("fs"), file);
          },
          apply: async (on) => applyClaudePreflight(require("fs"), profileConfigPath(view, runtime), on),
        },
        codexWebSearch: {
          read: async () => {
            const file = profileConfigPath(view, runtime);
            ensureCodexWebSearchOn(plugin, file);
            return readCodexWebSearch(require("fs"), file);
          },
          apply: async (mode) => applyCodexWebSearch(require("fs"), profileConfigPath(view, runtime), mode),
        },
        readOnly: {
          list: () => readOnlyRows(view, runtime),
          verify: (id) => verifyReadOnly(view, runtime, id),
          disable: (id) => disableReadOnly(view, runtime, id),
        },
      },
      // 每轮发送前读取：Codex 是否开了网页搜索（决定告诉它“能不能联网”）。
      agentTraits: (agentId) => {
        const webProxy = webProxyOn(plugin);
        if (isClaudeAdapter(agentId)) {
          try { ensureClaudePreflightOff(plugin, profileConfigPath(view, runtime)); } catch (_) { /* no runtime config yet */ }
          return { webProxy };
        }
        if (agentId !== "codex") return { webProxy };
        try { ensureCodexWebSearchOn(plugin, profileConfigPath(view, runtime)); } catch (_) { /* the runtime config may not exist yet */ }
        try { return { webProxy, webSearch: readCodexWebSearch(require("fs"), profileConfigPath(view, runtime)) }; } catch (_) { return { webProxy }; }
      },
      // 织研者代为联网：经 Obsidian 的网络取网页（只 GET，不访问本机和内网）。
      webFetch: hostWebFetch,
      // Confirmed workbench / material / feed actions are queued for this
      // plugin; drain the queue now so the card can show the real outcome.
      flushActionQueue: () => (typeof schPollScholariumQueue === "function" ? schPollScholariumQueue.call(view.plugin) : undefined),
      // Confirmed file-change cards run through Obsidian itself (links kept
      // up to date, nothing overwritten, trash instead of delete, undo).
      app: view.app,
      ...extra,
    };
  }

  /**
   * Draw the 织研者 tab. Returns true when the native page owns the tab body
   * (the caller then returns), false to let Scholarium draw the old iframe.
   */
  function render(view, weaverHost, runtime) {
    const plugin = view.plugin;
    registerCommand(plugin);
    if (runtime) lastRuntime = runtime;
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

    try {
      view.__schNativeWeaver = ScholariumNativeWeaver.mountResearchWeaver(body, mountOptions(view, runtime));
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

  return { render, installSidebar, revealSidePanel, activeNoteSource, SIDE_VIEW, registerCommand, config, available, enableExecutionAt, readAgentModel, applyAgentModel, readCodexWebSearch, applyCodexWebSearch, ensureCodexWebSearchOn, readClaudePreflight, applyClaudePreflight, ensureClaudePreflightOff, hostWebFetch, privateHost, webProxyOn, readOnlyCatalog, READONLY_WRAPPER, runReadOnly, claudeEndpoint, scanClaudeModels, profileConfigPath, restartRuntime, publishManualDownloads, openVaultFile, openVaultLink, notifyManualCapture, sendToWeaver, anchorForFile, headingPathAt, escapeAnchorPart };
})();
