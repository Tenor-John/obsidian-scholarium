"use strict";
var ScholariumNativeWeaver = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/plugin/scholarium-embed.ts
  var scholarium_embed_exports = {};
  __export(scholarium_embed_exports, {
    EMBED_ROOT_CLASS: () => EMBED_ROOT_CLASS,
    ENABLE_EXECUTION_QUESTION: () => ENABLE_EXECUTION_QUESTION,
    USER_CONFIRMED_HEADER: () => USER_CONFIRMED_HEADER,
    mountResearchWeaver: () => mountResearchWeaver
  });

  // src/features/figures/image-providers.ts
  var IMAGE_PROVIDERS = Object.freeze([
    {
      id: "siliconflow",
      label: "硅基流动 SiliconFlow",
      endpoint: "https://api.siliconflow.cn/v1",
      models: ["Qwen/Qwen-Image", "Kwai-Kolors/Kolors", "black-forest-labs/FLUX.1-schnell", "black-forest-labs/FLUX.1-dev"],
      style: "siliconflow",
      keyHint: "在 cloud.siliconflow.cn 的「API 密钥」页面创建"
    },
    {
      id: "volcengine",
      label: "火山方舟（豆包 Seedream）",
      endpoint: "https://ark.cn-beijing.volces.com/api/v3",
      models: ["doubao-seedream-4-0-250828", "doubao-seedream-4-5-251128"],
      style: "ark",
      keyHint: "在火山方舟控制台「API Key 管理」创建，并先开通所选模型"
    },
    {
      id: "zhipu",
      label: "智谱 BigModel（CogView）",
      endpoint: "https://open.bigmodel.cn/api/paas/v4",
      models: ["cogview-4-250304", "cogview-4", "cogview-3-flash"],
      style: "openai",
      keyHint: "在 open.bigmodel.cn 的「API Keys」页面创建"
    },
    {
      id: "openai",
      label: "OpenAI",
      endpoint: "https://api.openai.com/v1",
      models: ["gpt-image-1", "dall-e-3"],
      style: "openai",
      keyHint: "在 platform.openai.com 的 API keys 页面创建"
    },
    {
      id: "custom",
      label: "其他（OpenAI 兼容接口）",
      endpoint: "",
      models: [],
      style: "openai",
      keyHint: "填写服务商提供的 OpenAI 兼容地址（…/v1）与模型名"
    }
  ]);
  function imageProvider(id) {
    return IMAGE_PROVIDERS.find((provider) => provider.id === id) ?? IMAGE_PROVIDERS.find((provider) => provider.id === "custom");
  }
  var SIZE_TABLES = [
    { test: /qwen-image/i, sizes: ["1328x1328", "1664x928", "928x1664", "1472x1140", "1140x1472", "1584x1056", "1056x1584"] },
    { test: /kolors/i, sizes: ["1024x1024", "960x1280", "768x1024", "720x1440", "720x1280"] },
    { test: /flux\.1-schnell/i, sizes: ["1024x1024", "512x1024", "768x512", "768x1024", "1024x576", "576x1024"] },
    { test: /flux\.2|z-image/i, sizes: ["512x512", "768x1024", "1024x768", "576x1024", "1024x576"] },
    { test: /flux/i, sizes: ["1024x1024", "960x1280", "768x1024", "720x1440", "720x1280"] },
    { test: /seedream/i, sizes: ["2048x2048", "2304x1728", "1728x2304", "2560x1440", "1440x2560", "2496x1664", "1664x2496", "3024x1296"] },
    { test: /cogview/i, sizes: ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"] },
    { test: /gpt-image/i, sizes: ["1024x1024", "1536x1024", "1024x1536"] },
    { test: /dall-e-3/i, sizes: ["1024x1024", "1792x1024", "1024x1792"] }
  ];
  function ratio(size) {
    const match = /^(\d{2,5})x(\d{2,5})$/i.exec(size.trim());
    if (!match) return null;
    return Number(match[1]) / Number(match[2]);
  }
  function fitImageSize(model, wanted) {
    const table = SIZE_TABLES.find((entry) => entry.test.test(model));
    const target = ratio(wanted) ?? 1;
    if (!table) return ratio(wanted) ? wanted.trim().toLowerCase() : "1024x1024";
    if (table.sizes.includes(wanted.trim().toLowerCase())) return wanted.trim().toLowerCase();
    let best = table.sizes[0];
    let distance = Number.POSITIVE_INFINITY;
    for (const size of table.sizes) {
      const value = Math.abs(Math.log(ratio(size) / target));
      if (value < distance - 1e-9) {
        best = size;
        distance = value;
      }
    }
    return best;
  }
  function buildImageRequest(config, prompt, wanted) {
    const provider = imageProvider(config.provider);
    const model = config.model.trim();
    const fixed = config.size.trim();
    const size = fixed || fitImageSize(model, wanted || "1024x1024");
    const text6 = String(prompt || "").slice(0, 4e3);
    if (provider.style === "siliconflow") {
      return { path: "/images/generations", body: { model, prompt: text6, image_size: size, batch_size: 1 } };
    }
    if (provider.style === "ark") {
      return { path: "/images/generations", body: { model, prompt: text6, size, response_format: "b64_json", watermark: false } };
    }
    const body = { model, prompt: text6, size };
    if (provider.id === "openai") body.n = 1;
    return { path: "/images/generations", body };
  }
  function readImageResult(json) {
    if (!json || typeof json !== "object") return null;
    const record2 = json;
    const list4 = Array.isArray(record2.data) ? record2.data : Array.isArray(record2.images) ? record2.images : [];
    for (const item of list4) {
      if (!item || typeof item !== "object") continue;
      const entry = item;
      if (typeof entry.b64_json === "string" && entry.b64_json) return { base64: entry.b64_json };
      if (typeof entry.url === "string" && /^https:\/\//i.test(entry.url)) return { url: entry.url };
    }
    return null;
  }
  function errorReason(response) {
    const json = response.json;
    const error = json && typeof json === "object" ? json.error ?? json.message : void 0;
    const reason = error && typeof error === "object" ? String(error.message ?? JSON.stringify(error)) : error !== void 0 ? String(error) : String(response.text ?? "");
    return reason.slice(0, 300);
  }
  var STATUS_HINT = {
    401: "密钥无效或已过期，请在设置中心 → AI 生图 中重新填写",
    402: "账户余额不足",
    403: "没有使用这个模型的权限（有的服务商需要先在控制台开通模型）",
    404: "地址或模型名不对",
    429: "请求太频繁或额度用完，请稍后再试"
  };
  async function generateWithService(service, prompt, wanted) {
    const config = await service.load();
    if (!config.endpoint || !config.model || !config.hasKey) {
      const missing = [!config.endpoint && "服务地址", !config.model && "模型", !config.hasKey && "密钥"].filter(Boolean).join("、");
      throw new Error(`还没有配置生图服务（缺${missing}）：请打开设置中心 → AI 生图，选择服务商并填写密钥后再生成。`);
    }
    const request = buildImageRequest(config, prompt, wanted);
    const response = await service.post(request.path, request.body);
    if (response.status >= 400) {
      const hint = STATUS_HINT[response.status];
      const reason = errorReason(response);
      throw new Error(`生图服务返回 HTTP ${response.status}${hint ? `（${hint}）` : ""}${reason ? `：${reason}` : ""}`);
    }
    const image = readImageResult(response.json);
    if (image?.base64) return { base64: image.base64, mime: "image/png" };
    if (image?.url) return service.download(image.url);
    throw new Error("生图服务没有返回图片");
  }

  // src/adapters/runtime/hosted.ts
  var LOOPBACK_BASE = /^http:\/\/127\.0\.0\.1:(\d{1,5})(\/[A-Za-z0-9._~/-]*)?$/;
  function parseHostedBase(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().replace(/\/+$/, "");
    const match = LOOPBACK_BASE.exec(trimmed);
    if (!match) return null;
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { base: trimmed, port };
  }
  function defaultFetch() {
    const implementation = globalThis.fetch;
    if (typeof implementation !== "function") return null;
    return implementation.bind(globalThis);
  }
  function bodyError(text6) {
    try {
      const parsed = JSON.parse(text6);
      return typeof parsed?.error === "string" ? parsed.error.trim().slice(0, 300) : "";
    } catch {
      return "";
    }
  }
  var failure = (kind, message, detail = {}) => ({
    kind,
    message,
    detail,
    exitCode: null
  });
  var HostedRuntimeAdapter = class {
    vaultHash = "";
    profileDir = "";
    recordPath = "";
    options;
    listeners = /* @__PURE__ */ new Set();
    snapshot = { status: "offline", endpoint: null, failure: null, owns: false };
    constructor(options) {
      this.options = options;
    }
    get host() {
      return this.options.hostName ?? "Scholarium";
    }
    status() {
      return this.snapshot;
    }
    onStatus(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    async discover() {
      let located = null;
      try {
        located = await this.options.locate();
      } catch {
        located = null;
      }
      const parsed = parseHostedBase(located);
      if (!parsed) {
        this.set("offline", null, null);
        return { status: "offline", endpoint: null, reason: `${this.host} 的本机运行时尚未启动。` };
      }
      const healthy = await this.probe(parsed.base);
      if (!healthy.ok) {
        this.set("offline", null, healthy.failure);
        return { status: "offline", endpoint: null, reason: healthy.failure.message };
      }
      const endpoint = this.endpointFor(parsed.base, parsed.port);
      this.set("online", endpoint, null);
      return { status: "online", endpoint, reason: null };
    }
    async start() {
      this.set("starting", this.snapshot.endpoint, null);
      let base;
      try {
        base = await this.options.ensure();
      } catch (error) {
        const failed = failure("spawn-failed", `${this.host} 没能启动本机运行时：${error instanceof Error ? error.message : String(error)}`);
        this.set("offline", null, failed);
        return { ok: false, failure: failed };
      }
      const parsed = parseHostedBase(base);
      if (!parsed) {
        const failed = failure("handshake-invalid", `${this.host} 报告的运行时地址不是本机回环地址。`);
        this.set("offline", null, failed);
        return { ok: false, failure: failed };
      }
      const healthy = await this.probe(parsed.base);
      if (!healthy.ok) {
        this.set("offline", null, healthy.failure);
        return { ok: false, failure: healthy.failure };
      }
      const endpoint = this.endpointFor(parsed.base, parsed.port);
      this.set("online", endpoint, null);
      return { ok: true, value: endpoint };
    }
    /** The host owns the runtime; this page never stops it. */
    async stop() {
      this.set("offline", null, null);
      return { ok: true, value: { stopped: false, pids: [], survivors: [] } };
    }
    async request(path2, options = {}) {
      const endpoint = this.snapshot.endpoint;
      if (!endpoint) return { ok: false, failure: failure("request-failed", "运行时未连接") };
      if (!path2.startsWith("/") || path2.startsWith("//")) {
        return { ok: false, failure: failure("request-failed", "请求路径必须是本运行时下的绝对路径") };
      }
      const fetchImpl = this.options.fetch ?? defaultFetch();
      if (!fetchImpl) return { ok: false, failure: failure("runtime-missing", "这个宿主没有可用的 fetch 实现") };
      const controller = new AbortController();
      const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 15e3;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const headers = { accept: "application/json", ...this.options.headers ?? {} };
        let body;
        if (options.body !== void 0) {
          headers["content-type"] = "application/json";
          body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
        }
        const response = await fetchImpl(`${endpoint.origin}${path2}`, {
          method: options.method ?? "GET",
          headers,
          ...body === void 0 ? {} : { body },
          signal: controller.signal
        });
        const text6 = await response.text();
        if (this.snapshot.status === "degraded") this.set("online", endpoint, null);
        if (!response.ok) {
          const reason = bodyError(text6);
          return {
            ok: false,
            failure: failure("request-failed", reason ? `HTTP ${response.status}：${reason}` : `HTTP ${response.status}`, { status: response.status })
          };
        }
        if (!text6.trim()) return { ok: true, value: { status: response.status, data: null } };
        try {
          return { ok: true, value: { status: response.status, data: JSON.parse(text6) } };
        } catch {
          return { ok: false, failure: failure("request-failed", "运行时返回的不是 JSON") };
        }
      } catch (error) {
        if (!timedOut) {
          const lost = failure("request-failed", `${this.host} 的本机运行时没有回应：${error instanceof Error ? error.message : String(error)}`);
          this.set("degraded", endpoint, lost);
          return { ok: false, failure: lost };
        }
        return { ok: false, failure: failure("request-failed", `请求在 ${timeoutMs} ms 内没有回应`) };
      } finally {
        clearTimeout(timer);
      }
    }
    async probe(base) {
      const fetchImpl = this.options.fetch ?? defaultFetch();
      if (!fetchImpl) return { ok: false, failure: failure("runtime-missing", "这个宿主没有可用的 fetch 实现") };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.probeTimeoutMs ?? 2500);
      try {
        const response = await fetchImpl(`${base}/health`, { method: "GET", headers: { accept: "application/json" }, signal: controller.signal });
        await response.text();
        if (!response.ok) return { ok: false, failure: failure("request-failed", `${this.host} 的本机运行时尚未就绪（HTTP ${response.status}）。`, { status: response.status }) };
        return { ok: true };
      } catch {
        return { ok: false, failure: failure("request-failed", `${this.host} 的本机运行时没有回应。`) };
      } finally {
        clearTimeout(timer);
      }
    }
    endpointFor(base, port) {
      return {
        origin: base,
        port,
        pid: 0,
        instanceId: "scholarium-host",
        vaultHash: "",
        startedAt: Date.now(),
        auth: "proxy"
      };
    }
    set(status, endpoint, failed) {
      this.snapshot = { status, endpoint, failure: failed, owns: false };
      for (const listener of [...this.listeners]) {
        try {
          listener(this.snapshot);
        } catch {
        }
      }
    }
  };

  // src/features/tools/tool-api.ts
  function el(doc, tag, options = {}) {
    const node2 = doc.createElement(tag);
    if (options.cls) node2.className = options.cls;
    if (options.text !== void 0) node2.textContent = options.text;
    for (const [name, value] of Object.entries(options.attrs ?? {})) node2.setAttribute(name, value);
    return node2;
  }
  function button(doc, text6, onClick, attrs = {}, cls = "scholarium-weaver__tool-btn") {
    const node2 = el(doc, "button", { cls, text: text6, attrs: { type: "button", ...attrs } });
    node2.addEventListener("click", onClick);
    return node2;
  }
  function messageOf(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function str(value) {
    return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  }
  function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  // src/features/tools/pipeline/steps-core.ts
  var STATE_BUDGET_BYTES = 4 * 1024 * 1024;
  var PIPELINE_STEPS = Object.freeze([
    {
      id: "query-builder",
      title: "第 1 步 · literature-search-query-builder",
      phase: "P1",
      gate: true,
      needs: ["question"],
      produces: ["step1", "queryV0", "step1Manifest", "query"]
    },
    {
      id: "concept-matrix",
      title: "第 1.2 步 · 概念矩阵生成",
      phase: "P1",
      needs: ["question", "step1Manifest"],
      produces: ["conceptBlocks", "matrixSource"]
    },
    {
      id: "query-refine",
      title: "第 1.5 步 · 自动打磨检索式（双 Agent）",
      phase: "P1",
      needs: ["question", "query", "conceptBlocks"],
      produces: ["query", "queryLoopDegradation"]
    },
    {
      id: "search",
      title: "第 2–3 步 · 多源元数据检索",
      phase: "P1",
      gate: true,
      needs: ["query"],
      produces: ["records2", "records3", "combined", "usedQuery", "relevance"]
    },
    {
      id: "quality-gate",
      title: "第 3.5–3.8 步 · 检索质量评估与深化",
      phase: "P1",
      gate: true,
      optional: true,
      needs: ["combined", "conceptBlocks", "question"],
      produces: ["combined", "usedQuery", "queryV1Executed", "queryV1Audit", "relevance"]
    },
    {
      id: "extra-providers",
      title: "第 3.9 步 · 补充数据源检索",
      phase: "P1",
      optional: true,
      needs: ["usedQuery", "combined"],
      produces: ["combined"]
    },
    {
      id: "final-screen",
      title: "第 3.95 步 · 下载前相关性终筛",
      phase: "P1",
      gate: true,
      needs: ["combined", "conceptBlocks"],
      produces: ["combined"]
    },
    {
      id: "degraded-gate",
      title: "第 3.99 步 · 降级检索人工闸门",
      phase: "P1",
      gate: true,
      optional: true,
      needs: ["combined", "usedQuery"],
      produces: ["degradedConfirmed"]
    },
    {
      id: "dedupe",
      title: "第 4 步 · reference-export-dedupe",
      phase: "P1",
      needs: ["combined"],
      produces: ["step4", "dedupe"]
    },
    {
      id: "download",
      title: "第 5 步 · PDF 获取（机构通道 + 浏览器兜底）",
      phase: "P2",
      gate: true,
      optional: true,
      needs: ["combined", "dedupe"],
      produces: ["results5", "downloadedPaths", "downloadedCount", "blockedCount", "sessionPolicy", "downloadDiagnosticNote", "downloadSummary"]
    },
    {
      id: "nature-reader",
      title: "第 6 步 · nature-reader",
      phase: "P2",
      needs: ["downloadedPaths"],
      produces: ["step6", "cards6", "needsReview"]
    },
    {
      id: "obsidian-bases",
      title: "第 8 步 · obsidian-bases",
      phase: "P2",
      needs: ["downloadedPaths"],
      produces: ["step8", "notes8"]
    },
    {
      id: "knowledge-graph",
      title: "第 9 步 · zrl-knowledge-graph",
      phase: "P2",
      needs: ["question", "cards6", "downloadedPaths"],
      produces: ["step9", "warningCount9", "graph9"]
    },
    {
      id: "deep-research",
      title: "第 10 步 · deep-research",
      phase: "P3",
      needs: ["downloadedPaths"],
      produces: ["step10", "synthesis10"]
    },
    {
      id: "nature-writing",
      title: "第 11 步 · nature-writing",
      phase: "P3",
      needs: ["synthesis10"],
      produces: ["step11", "draft11"]
    },
    {
      id: "nature-polishing",
      title: "第 12 步 · nature-polishing",
      phase: "P3",
      needs: ["draft11"],
      produces: ["step12", "polished12"]
    }
  ]);
  var STEP_INDEX = new Map(PIPELINE_STEPS.map((step, index) => [step.id, index]));
  function stepById(id) {
    const index = STEP_INDEX.get(id);
    return index === void 0 ? null : PIPELINE_STEPS[index] ?? null;
  }
  function stepIndex(id) {
    const index = STEP_INDEX.get(id);
    return index === void 0 ? -1 : index;
  }
  function hasValue(state, key) {
    if (!state || typeof state !== "object" || !Object.prototype.hasOwnProperty.call(state, key)) return false;
    const value = state[key];
    if (value === null || value === void 0) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }
  function resumePlan(state, fromId) {
    const target = stepById(fromId);
    if (!target) return { runnable: false, reason: "unknown-step", missing: [], skipped: [], remaining: [] };
    const missing = (target.needs || []).filter((key) => !hasValue(state, key));
    const index = stepIndex(fromId);
    return {
      runnable: missing.length === 0,
      reason: missing.length === 0 ? "ok" : "missing-state",
      missing,
      skipped: PIPELINE_STEPS.slice(0, index).map((step) => step.id),
      remaining: PIPELINE_STEPS.slice(index).map((step) => step.id),
      fromIndex: index,
      fromTitle: target.title
    };
  }
  function restartPlan(record2, fromId) {
    const target = stepById(fromId);
    if (!target) return { runnable: false, reason: "unknown-step", missing: [], fromId };
    if (!record2?.state) return { runnable: false, reason: "no-state", missing: [], fromId, fromTitle: target.title };
    const dependency = resumePlan(record2.state, fromId);
    if (!dependency.runnable) return { ...dependency, reason: "missing-state", fromId };
    if (record2.outcome !== "completed" && record2.status !== "completed") {
      const checkpoint = Number.isInteger(record2.resumeStepIndex) ? record2.resumeStepIndex : stepIndex(record2.resumeStepId);
      const maxSafeIndex = checkpoint >= 0 ? checkpoint + 1 : 0;
      if (dependency.fromIndex > maxSafeIndex) {
        return { ...dependency, runnable: false, reason: "unsafe-skip", maxSafeIndex, fromId };
      }
    }
    return { ...dependency, runnable: true, reason: "ok", fromId };
  }
  function restartStateForStep(state, fromId) {
    const index = stepIndex(fromId);
    if (index < 0) return null;
    const next = { ...state || {} };
    const targetNeeds = new Set(PIPELINE_STEPS[index].needs || []);
    const staleKeys = /* @__PURE__ */ new Set();
    for (const step of PIPELINE_STEPS.slice(index)) {
      for (const key of step.produces || []) staleKeys.add(key);
    }
    for (const key of staleKeys) if (!targetNeeds.has(key)) delete next[key];
    return next;
  }
  function describeRestart(record2, fromId) {
    const plan = restartPlan(record2, fromId);
    if (plan.runnable) {
      return `将保留前 ${plan.skipped.length} 步的上游状态，清除「${plan.fromTitle}」及其下游旧产物，然后重新执行剩余 ${plan.remaining.length} 步。`;
    }
    if (plan.reason === "no-state") return "这条旧记录没有可验证的状态包，只能使用原始主题从第 1 步重新运行。";
    if (plan.reason === "missing-state") return `不能从「${plan.fromTitle}」重跑：状态包缺少 ${plan.missing.join("、")}。请选择更早的步骤。`;
    if (plan.reason === "unsafe-skip") return "不能跳过尚未完成或尚未通过的质量门；请选择当前安全断点或更早的步骤。";
    return "无法识别要重新运行的 Pipeline 步骤。";
  }
  function isResumable(record2) {
    if (!record2) return { resumable: false, reason: "no-record" };
    if (record2.outcome === "stop") {
      return { resumable: false, reason: "quality-gate-stop", stopReason: record2.stopReason || "" };
    }
    if (record2.status === "completed") return { resumable: false, reason: "already-completed" };
    const state = record2.state || null;
    const fromId = record2.resumeStepId || null;
    if (state && fromId) {
      const plan = resumePlan(state, fromId);
      return plan.runnable ? { resumable: true, reason: "ok", fromId, plan } : { resumable: false, reason: "missing-state", fromId, plan };
    }
    const legacyPaths = record2.artifacts && Array.isArray(record2.artifacts.downloadedPaths) ? record2.artifacts.downloadedPaths : [];
    if (legacyPaths.length && record2.resumeFrom === "nature-reader") {
      return { resumable: true, reason: "legacy-pdf-manifest", fromId: "nature-reader", legacy: true };
    }
    return { resumable: false, reason: "no-state" };
  }
  function utf8Length(text6) {
    let bytes = 0;
    for (let i = 0; i < text6.length; i += 1) {
      const code = text6.charCodeAt(i);
      if (code < 128) bytes += 1;
      else if (code < 2048) bytes += 2;
      else if (code >= 55296 && code <= 56319 && i + 1 < text6.length) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }
  function fitStateToBudget(state, budget = STATE_BUDGET_BYTES) {
    const size = (value) => {
      let text6;
      try {
        text6 = JSON.stringify(value);
      } catch {
        return Infinity;
      }
      if (typeof text6 !== "string") return 0;
      return utf8Length(text6);
    };
    let next = state || {};
    const dropped = [];
    if (size(next) <= budget) return { state: next, dropped, truncated: false };
    if (Array.isArray(next.combined)) {
      next = { ...next, combined: next.combined.map((rec3) => {
        if (!rec3 || typeof rec3 !== "object") return rec3;
        const copy = { ...rec3 };
        delete copy.abstract;
        return copy;
      }) };
      dropped.push("combined[].abstract");
      if (size(next) <= budget) return { state: next, dropped, truncated: true };
    }
    if (Array.isArray(next.results5)) {
      next = { ...next, results5: next.results5.map((item) => {
        const rec3 = item;
        return { status: rec3 && rec3.status, doi: rec3 && rec3.doi, path: rec3 && rec3.path };
      }) };
      dropped.push("results5[].detail");
      if (size(next) <= budget) return { state: next, dropped, truncated: true };
    }
    if (Array.isArray(next.combined) && next.combined.length) {
      next = { ...next, combined: [] };
      dropped.push("combined");
    }
    return { state: next, dropped, truncated: true };
  }
  function describeResume(record2) {
    const verdict2 = isResumable(record2);
    if (verdict2.resumable && verdict2.legacy) {
      const count2 = record2.artifacts.downloadedPaths.length;
      return `可以复用这批 ${count2} 篇 PDF，跳过检索和下载，从第 6 步证据卡片继续。`;
    }
    if (verdict2.resumable) {
      const plan = verdict2.plan;
      return `将跳过前 ${plan.skipped.length} 步已完成的工作，从「${plan.fromTitle}」重新开始，剩余 ${plan.remaining.length} 步。`;
    }
    if (verdict2.reason === "quality-gate-stop") {
      return `这是质量门的安全停止${verdict2.stopReason ? `（${verdict2.stopReason}）` : ""}，不提供续跑：继续运行会把不合格的检索结果带进证据链。请按提示修改后重新运行。`;
    }
    if (verdict2.reason === "missing-state" && verdict2.plan) {
      return `无法从「${verdict2.plan.fromTitle}」续跑：状态包里缺少 ${verdict2.plan.missing.join("、")}。需要重新运行这一步之前的阶段。`;
    }
    if (verdict2.reason === "already-completed") return "这次运行已正常完成，不需要续跑。";
    return "该记录没有保存可恢复的状态包（旧版本记录），需要重新运行。";
  }
  var NATIVE_STAGES = Object.freeze([
    { slug: "literature-search-query-builder", stepId: "query-builder", title: "第 1 步 · 检索式" },
    { slug: "nature-academic-search", stepId: "search", title: "第 2 步 · 精排检索", source: "primary" },
    { slug: "pop8-scholar-search", stepId: "search", title: "第 3 步 · 广召回检索", source: "broad" },
    { slug: "reference-export-dedupe", stepId: "dedupe", title: "第 4 步 · 去重与导出" },
    { slug: "paper-downloader", stepId: "download", title: "第 5 步 · 获取 PDF" },
    { slug: "nature-reader", stepId: "nature-reader", title: "第 6 步 · 证据卡片" },
    { slug: "obsidian-bases", stepId: "obsidian-bases", title: "第 8 步 · 文献笔记" },
    { slug: "zrl-knowledge-graph", stepId: "knowledge-graph", title: "第 9 步 · 知识图谱" },
    { slug: "deep-research", stepId: "deep-research", title: "第 10 步 · 证据综述" },
    { slug: "nature-writing", stepId: "nature-writing", title: "第 11 步 · 手稿初稿" },
    { slug: "nature-polishing", stepId: "nature-polishing", title: "第 12 步 · 手稿润色" }
  ]);
  var SEARCH_SOURCES = Object.freeze([
    { id: "primary", slug: "nature-academic-search", label: "精排检索（nature-academic-search）" },
    { id: "broad", slug: "pop8-scholar-search", label: "广召回检索（pop8-scholar-search）" }
  ]);
  var RECORDS_LIMIT_DEFAULT = 80;
  var RECORDS_LIMIT_MIN = 10;
  var RECORDS_LIMIT_MAX = 200;
  function parsePipelineForm(input) {
    const topic = typeof input.topic === "string" ? input.topic.trim() : "";
    if (!topic) return { ok: false, error: "请先写明本次要检索的研究主题。" };
    const sources = SEARCH_SOURCES.map((source) => source.id).filter((id) => (input.sources ?? []).includes(id));
    if (!sources.length) return { ok: false, error: "至少选择一个检索来源。" };
    const n = Number(input.limit);
    const limit = Number.isFinite(n) && String(input.limit ?? "").trim() !== "" ? Math.round(Math.min(RECORDS_LIMIT_MAX, Math.max(RECORDS_LIMIT_MIN, n))) : RECORDS_LIMIT_DEFAULT;
    return { ok: true, form: { topic, sources, limit } };
  }
  function plannedStages(form) {
    return NATIVE_STAGES.filter((stage) => !stage.source || form.sources.includes(stage.source));
  }
  function previewText(form, workspace) {
    const stages = plannedStages(form);
    return [
      `将按 research-pipeline.json 自动运行文献流程：${stages.map((stage) => stage.title.replace(/^第 [\d.]+ 步 · /, "")).join("→")}。`,
      `研究主题：${form.topic}`,
      `检索来源：${SEARCH_SOURCES.filter((source) => form.sources.includes(source.id)).map((source) => source.label).join("、")}；候选上限 ${form.limit} 条。`,
      `工作区：${workspace}`,
      "全部只读本机课题目录，写入仅限 literature/、Literature/、Canvases/、Research/、Manuscript/ 子目录；运行结束后会列出本次产出清单，可选择保留或整批撤销。建议运行前先登录/刷新 WebVPN。是否继续？"
    ].join("\n");
  }
  function compactPipelineRecords(records, limit) {
    return (records || []).slice(0, limit).map((entry) => {
      const record2 = entry && typeof entry === "object" ? entry : {};
      return {
        doi: record2.doi || "",
        title: record2.title || "",
        year: record2.year || "",
        venue: record2.venue || "",
        openalex_id: record2.openalex_id || "",
        is_oa: Boolean(record2.is_oa),
        pdf_url: record2.pdf_url || "",
        landing_page_url: record2.landing_page_url || "",
        abstract: String(record2.abstract || "").slice(0, 1200)
      };
    });
  }
  function normalizeDoiKey(value) {
    return String(value ?? "").trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, "");
  }
  function buildManualDownloadQueue(records, attempts) {
    const successfulDois = /* @__PURE__ */ new Set();
    const successfulUrls = /* @__PURE__ */ new Set();
    const failuresByDoi = /* @__PURE__ */ new Map();
    for (const value of attempts) {
      const item = rec(value);
      const doi = normalizeDoiKey(item.doi);
      const urls = [item.url, item.final_url, item.page_url].map((entry) => String(entry ?? "").trim()).filter(Boolean);
      if (item.status === "downloaded") {
        if (doi) successfulDois.add(doi);
        for (const url of urls) successfulUrls.add(url);
      } else if (doi && item.status) {
        failuresByDoi.set(doi, String(item.error || item.reason || item.status));
      }
    }
    const seen = /* @__PURE__ */ new Set();
    const queue = [];
    for (const value of records) {
      const record2 = rec(value);
      const title = String(record2.title ?? "").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const doi = normalizeDoiKey(record2.doi);
      const key = doi ? `doi:${doi}` : `title:${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const urls = [record2.pdf_url, record2.landing_page_url, doi ? `https://doi.org/${doi}` : ""].map((entry) => String(entry ?? "").trim()).filter(Boolean);
      if (doi && successfulDois.has(doi) || urls.some((url2) => successfulUrls.has(url2))) continue;
      const url = String(record2.landing_page_url || record2.pdf_url || (doi ? `https://doi.org/${doi}` : "")).trim();
      if (!/^https?:\/\/\S+$/i.test(url)) continue;
      queue.push({
        id: key,
        title,
        doi,
        url,
        reason: failuresByDoi.get(doi) || "自动下载未成功",
        venue: String(record2.venue || record2.journal || "").trim(),
        abstract: String(record2.abstract || "").replace(/\s+/g, " ").trim().slice(0, 1200)
      });
    }
    return queue;
  }
  function runControlView(run) {
    const running = Boolean(run && run.status !== "idle" && run.status !== "done" && run.status !== "stopped" && run.status !== "error");
    return {
      running,
      text: run ? `${run.label} · ${run.paused ? "已暂停，等待继续" : run.stopRequested ? "正在取消当前任务" : run.statusText || "运行中"}` : "空闲",
      stopDisabled: !running,
      pauseDisabled: !running || Boolean(run?.stopRequested),
      pauseLabel: run?.paused ? "继续" : "阶段间暂停"
    };
  }
  function progressOf(rows, planned = 0) {
    const total = Math.max(planned, rows.length);
    const done = rows.filter((row) => row.state !== "pending").length;
    return { done, total, percent: total ? Math.round(done / total * 100) : 0, text: `${done} / ${total}` };
  }
  function persistedStatus(status, stopRequested) {
    if (status === "done") return "completed";
    if (status === "stopped") return stopRequested ? "cancelled" : "stopped";
    if (status === "error") return "failed";
    return "running";
  }
  var SKILL_RUN_SILENCE_WARN_MS = 5 * 60 * 1e3;
  var SKILL_RUN_SILENCE_STOP_MS = 25 * 60 * 1e3;
  function pollStatus(slug2, run, nowMs2) {
    const startedAt = Number(run.startedAt);
    const lastOutputAt = Number(run.lastOutputAt);
    const elapsedMs = Number.isFinite(startedAt) ? Math.max(0, nowMs2 - startedAt) : 0;
    const elapsedMin = Math.max(1, Math.round(elapsedMs / 6e4));
    const elapsedText = elapsedMs < 6e4 ? `${Math.max(1, Math.round(elapsedMs / 1e3))} 秒` : `${elapsedMin} 分钟`;
    const silentMs = Number.isFinite(lastOutputAt) ? Math.max(0, nowMs2 - lastOutputAt) : 0;
    if (silentMs > SKILL_RUN_SILENCE_STOP_MS) {
      return {
        status: "",
        rowDetail: null,
        stalled: `${slug2} 已停止：超过 ${Math.round(SKILL_RUN_SILENCE_STOP_MS / 6e4)} 分钟无任何进展信号，判定为卡死（已运行 ${elapsedMin} 分钟）。请查看该 Skill 的日志后重跑。`
      };
    }
    const silentMin = Math.floor(silentMs / 6e4);
    const progress = run.progress && typeof run.progress === "object" ? run.progress : null;
    const completed = Number.isFinite(progress?.completed) ? progress.completed : progress?.done;
    const countText = Number.isFinite(completed) && Number.isFinite(progress?.total) ? `${completed}/${progress.total}` : "";
    const currentFile = progress?.current_file || progress?.current;
    const currentText = currentFile ? `：${String(currentFile).slice(0, 100)}` : "";
    const phaseText = progress?.phase === "finalizing_sources" ? " · 并行来源已跑完，正在汇总" : "";
    const cancelling = run.status === "cancelling";
    const stateText = cancelling ? "正在取消" : `正在运行 Skill：${slug2}`;
    const status = `${stateText}${countText ? ` · ${countText}${currentText}${phaseText} · ${elapsedText}` : `（已运行 ${elapsedText}${silentMin >= SKILL_RUN_SILENCE_WARN_MS / 6e4 ? `，已 ${silentMin} 分钟无输出` : ""}）`}`;
    const rowDetail = countText ? `${cancelling ? "正在取消" : progress?.phase === "finalizing_sources" ? "正在汇总" : "正在并行获取"} ${countText}${currentText}` : null;
    return { status, rowDetail, stalled: null };
  }
  function rec(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function strings(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && Boolean(entry.trim())) : [];
  }
  function stageDetail(slug2, output) {
    const manifest = rec(rec(output).manifest);
    const error = typeof manifest.error === "string" ? manifest.error.trim() : "";
    if (error) return `${slug2} 返回：${error}`;
    const count2 = ["record_count", "deduped_records", "pdf_count", "card_count", "notes_created"].map((key) => manifest[key]).find((value) => typeof value === "number");
    return count2 === void 0 ? `${slug2} 已完成` : `${slug2} 已完成（${count2}）`;
  }
  function manifestQuery(output) {
    const manifest = rec(rec(output).manifest);
    const pick = (key) => typeof manifest[key] === "string" ? manifest[key].trim() : "";
    return pick("query_v1_after_record_sampling") || pick("query_v0");
  }
  function manifestRecords(output) {
    const records = rec(rec(output).manifest).records;
    return Array.isArray(records) ? records.filter((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
  }
  function manifestPdfPaths(output) {
    return strings(rec(rec(output).manifest).downloaded_paths);
  }
  function downloadGateStop(output) {
    const manifest = rec(rec(output).manifest);
    const summary = rec(manifest.summary);
    const whitelist = rec(manifest.whitelist);
    const session = rec(manifest.scansci_session);
    const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
    const total = number(summary.total);
    const blocked = number(summary.blocked_not_whitelisted);
    const needsLogin = number(summary.needs_login);
    const manual = number(summary.manual_required);
    const failed = number(summary.failed);
    const whitelistError = typeof whitelist.error === "string" ? whitelist.error.trim() : "";
    if (whitelistError) {
      return {
        reason: `期刊白名单未配置；${total ? `${blocked || total}/${total} 条候选被准入门拦截，` : ""}Pipeline 已安全停止。`,
        lines: [
          `白名单检查：${whitelistError}`,
          "请配置 <Vault>/Scholarium/journal-whitelist/whitelist_journals.json 后重新运行；刷新 WebVPN 不能解决白名单缺失。"
        ]
      };
    }
    if (total > 0 && blocked >= total) {
      return {
        reason: `本轮 ${total} 条候选全部未通过期刊白名单；Pipeline 已安全停止。`,
        lines: ["请检查白名单内容或调整研究主题；本次没有候选进入下载阶段。"]
      };
    }
    if (needsLogin > 0 || session.reason === "no_webvpn_ticket_cookie") {
      return {
        reason: `机构全文通道需要登录；${needsLogin ? `${needsLogin} 条候选等待 WebVPN 会话，` : ""}Pipeline 已安全停止。`,
        lines: ["请在右侧打开 WebVPN，完成登录或刷新会话后重新运行。"]
      };
    }
    const counts = [manual ? `${manual} 条需人工处理` : "", failed ? `${failed} 条下载失败` : ""].filter(Boolean).join("，");
    return {
      reason: "本轮没有成功下载 PDF；证据安全门阻止读取旧文件和后续写作。",
      lines: [
        `${counts || "候选中没有可验证的 PDF"}；本轮下载 0 篇。`,
        "请检查候选文献的开放获取地址、下载日志或调整研究主题后重新运行。"
      ]
    };
  }
  function trackedOutputs(outputs) {
    const m = (slug2) => rec(rec(outputs[slug2]).manifest);
    const exportsBase = "literature/exports";
    const notes = strings(m("obsidian-bases").notes);
    const notesFolder = notes.length ? notes[0].split("/").slice(0, -1).join("/") : "";
    const cards = Array.isArray(m("nature-reader").cards) ? m("nature-reader").cards.map((card) => rec(card).card_path).filter((p) => typeof p === "string" && Boolean(p)) : [];
    const one = (slug2, key) => typeof m(slug2)[key] === "string" && m(slug2)[key] ? [m(slug2)[key]] : [];
    const graph = m("zrl-knowledge-graph");
    return [
      { label: "检索导出（第 4 步）", paths: outputs["reference-export-dedupe"] ? [`${exportsBase}/retrieved-literature.md`, `${exportsBase}/deduped-records.json`, `${exportsBase}/doi-list.txt`, `${exportsBase}/references.ris`, `${exportsBase}/references.bib`] : [] },
      { label: "已下载 PDF（第 5 步）", paths: manifestPdfPaths(outputs["paper-downloader"]) },
      { label: "证据卡片（第 6 步）", paths: cards },
      { label: "文献笔记（第 8 步）", paths: notesFolder ? [...notes, `${notesFolder}/_base-index.json`] : notes },
      { label: "交互式知识图谱（第 9 步）", paths: [graph.html, graph.graph, graph.report].filter((p) => typeof p === "string" && Boolean(p)) },
      { label: "证据综述（第 10 步）", paths: one("deep-research", "synthesis") },
      { label: "手稿初稿（第 11 步）", paths: one("nature-writing", "draft") },
      { label: "润色稿（第 12 步）", paths: one("nature-polishing", "output") }
    ];
  }

  // src/features/tools/graph/knowledge-graph-core.ts
  var TYPES = ["material", "precursor", "condition", "process", "structure", "mechanism", "characterization", "outcome", "paper", "question", "specimen", "synthesis", "execution", "observation", "claim"];
  var RELATIONS = ["contains", "prepared_from", "treated_by", "under_condition", "forms", "changes", "enables", "inhibits", "measured_by", "correlates_with", "supports", "contradicts", "tests", "instance_of"];
  function evidencePacket(cards, maxCards = 30, maxChars = 9e4) {
    const packet = [];
    let used = 0;
    for (const raw of (Array.isArray(cards) ? cards : []).slice(0, maxCards)) {
      const card = raw;
      const sourcePath = String(card?.source_path || "unknown");
      const excerpts = (Array.isArray(card?.claim_candidates) ? card.claim_candidates : []).slice(0, 2).map((item2) => String(item2 || "").replace(/\s+/g, " ").slice(0, 3400));
      const item = { id: String(card?.id || ""), source_path: sourcePath, evidence_tier: String(card?.evidence_tier || "needs_manual_review"), excerpts };
      const size = JSON.stringify(item).length;
      if (packet.length && used + size > maxChars) break;
      packet.push(item);
      used += size;
    }
    return packet;
  }
  function buildExtractionPrompt(input = {}) {
    const packet = evidencePacket(input.cards);
    return `你是科研知识图谱工程师。请根据下面“本轮证据卡片”构建一个语义实体—关系图，而不是文件—摘录关系图。

研究问题：${String(input.question || "").trim() || "未提供"}

硬性边界：
1. 只抽取材料、前驱体、条件、过程、结构、机理、表征方法、结果、论文和研究问题等语义实体，以及本课题自身的样品、制备、表征执行、观测、结论等项目结构实体。
2. 每条关系必须指向提供的 source_path，并给出 excerpt 中可定位的短 quote；不能把共同出现写成因果。
3. 直接陈述的关系 review_status=supported；合理但未被原文直接陈述的关系 review_status=inferred，且 confidence <= 0.6。
4. 无关论文不进入图；把排除原因写入 warnings。不得虚构 DOI、页码、数值或实验条件。
5. 合并同义实体（如 ceria/CeO2），节点控制在 12–45 个、关系控制在 12–90 条。证据不足时宁可少画并报警。
6. synthesis/claim 节点是对多条下游观测/证据的归纳，不是某一段原文的逐字摘录——不要为了满足 quote 字段而编造一句"引用"；这类节点的支撑关系走 supports/contradicts，可以不带 quote，但渲染器现在会把任何没有可验证 quote 的关系一律记为 review_status=inferred（2026-09-01 起，不再信任"没有引文也标 supported"的声明）——不要为了让它显示为 supported 而编造引用；在这类支撑/反驳关系缺少可验证 quote 之前，如实标 inferred 就是正确结果。characterization（表征方法）是跨样品复用的受控词表，不要每篇论文重新造一个新节点。

允许节点类型：${TYPES.join(", ")}
允许关系：${RELATIONS.join(", ")}

只输出一个 JSON 对象，不要 Markdown 代码块或解释：
{"title":"...","research_question":"...","summary":"...","nodes":[{"id":"stable-ascii-id","label":"...","type":"material","description":"...","source_refs":["source_path"]}],"edges":[{"source":"id","target":"id","relation":"changes","label":"...","confidence":0.8,"review_status":"supported","evidence":[{"source_path":"...","locator":"摘要/结果/图号（仅在摘录中真实出现时填写）","quote":"不超过80字"}]}],"warnings":["..."]}

本轮证据卡片：
${JSON.stringify(packet)}`;
  }
  function parseGraphReply(text6) {
    const raw = String(text6 || "").trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = (fenced ? fenced[1] : raw).trim();
    let parsed;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("Agent 未返回可解析的知识图谱 JSON。");
      parsed = JSON.parse(candidate.slice(start, end + 1));
    }
    const graph = parsed;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) throw new Error("知识图谱 JSON 缺少 nodes/edges。");
    if (graph.nodes.length > 80 || graph.edges.length > 180) throw new Error("知识图谱超过安全规模，请缩小本轮主题。");
    return graph;
  }

  // src/features/tools/pipeline/v3/paths.ts
  var PIPELINE_RUNS_PATH = "/v1/pipeline-runs";
  var SKILL_RUNS_PATH = "/v1/skill-runs";
  var SKILLS_PATH = "/v1/skills";

  // src/features/tools/pipeline/v3/runner/step-contract.ts
  function fallbackThrew(error) {
    return { status: "skipped", reason: `fallback threw: ${error instanceof Error ? error.message : String(error)}` };
  }

  // src/features/tools/pipeline/v3/runner/runner.ts
  var StepTimeoutError = class extends Error {
    constructor(stepId, timeoutMs) {
      super(`步骤 ${stepId} 超过 ${Math.round(timeoutMs / 1e3)}s 未返回，按失败处理（后台残留已取消/丢弃）`);
      this.stepId = stepId;
      this.timeoutMs = timeoutMs;
      this.name = "StepTimeoutError";
    }
    stepId;
    timeoutMs;
  };
  var VOLATILE_KEYS = /* @__PURE__ */ new Set([
    "startedAt",
    "finishedAt",
    "updatedAt",
    "runId",
    "attemptId",
    "skillRunId",
    "durationMs",
    "elapsedMs",
    "timestamp"
  ]);
  var STEP_VERSION = {};
  function canonical(value, seen) {
    if (Array.isArray(value)) return value.map((item) => canonical(item, seen));
    if (value && typeof value === "object") {
      if (seen.has(value)) return null;
      seen.add(value);
      return Object.fromEntries(
        Object.keys(value).filter((key) => !VOLATILE_KEYS.has(key)).sort().map((key) => [key, canonical(value[key], seen)])
      );
    }
    return value;
  }
  function hashInput(input, version = 1) {
    const stable2 = JSON.stringify({ v: version, input: canonical(input ?? null, /* @__PURE__ */ new Set()) });
    let hash = 2166136261;
    for (let i = 0; i < stable2.length; i += 1) {
      hash ^= stable2.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }
  function hashStepInput(stepId, input) {
    return hashInput(input, STEP_VERSION[stepId] ?? 1);
  }
  var Runner = class {
    constructor(store) {
      this.store = store;
    }
    store;
    listeners = /* @__PURE__ */ new Set();
    onProgress(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    emit(event) {
      for (const listener of [...this.listeners]) {
        try {
          listener(event);
        } catch {
        }
      }
    }
    /** 执行整列步骤；返回最终的 upstream 表。步骤失败不抛出——只有
     * 崩溃模拟和用户中止会抛出。 */
    async execute(ctx, steps, hooks = {}) {
      const prior = await this.store.load(ctx.runId);
      const upstream = ctx.upstream;
      let resumed = 0;
      if (prior) {
        for (const [id, result] of Object.entries(prior.steps)) {
          if (result.status === "ok") {
            upstream[id] = result;
            resumed += 1;
          }
        }
        if (resumed) ctx.log(`续跑：跳过 ${resumed} 个已完成步骤`);
      }
      const persist = async () => {
        const snapshot = { runId: ctx.runId, version: 1, steps: { ...upstream }, ...ctx.meta ? { meta: ctx.meta } : {} };
        try {
          await this.store.save(snapshot);
        } catch (error) {
          const message = `运行记录写盘失败：${error instanceof Error ? error.message : String(error)}；崩溃后可能无法续跑`;
          ctx.log(message);
          ctx.onPersistError?.(message);
        }
      };
      let skippedAny = false;
      let executedAny = false;
      for (const step of steps) {
        if (ctx.signal.aborted) throw new Error("用户已停止运行。");
        if (!step.alwaysRun && upstream[step.id]?.status === "ok") {
          const stored = upstream[step.id];
          const input = step.input(ctx);
          const freshHash = input !== null ? hashStepInput(step.id, input) : null;
          if (stored.inputHash && stored.inputHash === freshHash) {
            skippedAny = true;
            this.emit({ type: "step", stepId: step.id, result: stored, attempt: 0 });
            continue;
          }
          ctx.log(`[${step.id}] ${stored.inputHash ? `输入已变化（哈希 ${stored.inputHash} → ${freshHash ?? "缺失"}）` : "旧记录无输入哈希"}，重跑`);
          delete upstream[step.id];
        }
        const result = await this.executeOne(ctx, step);
        upstream[step.id] = result;
        executedAny = true;
        await persist();
        this.emit({ type: "step", stepId: step.id, result, attempt: 1 });
        hooks.afterStep?.(step.id);
      }
      if (skippedAny && !executedAny) await persist();
      this.emit({ type: "finished" });
      return upstream;
    }
    async executeOne(ctx, step) {
      const input = step.input(ctx);
      if (input === null) {
        const missing = Object.entries(ctx.upstream).filter(([, r]) => r.status !== "ok").map(([id]) => id);
        return { status: "skipped", reason: "必需的上游输入缺失，未执行", cause: `upstream-missing:${missing.join(",") || "unknown"}` };
      }
      const emptyCause = step.emptyCause?.(input) ?? null;
      if (emptyCause !== null) {
        return { status: "degraded", reason: "上游输入为空", cause: emptyCause, inputHash: hashStepInput(step.id, input) };
      }
      const inputHash = hashStepInput(step.id, input);
      const timeoutMs = ctx.timeouts[step.id] ?? step.timeoutMs;
      const execTag = Date.now();
      ctx.log(`[${step.id}] 开始（exec ${execTag}，超时 ${Math.round(timeoutMs / 1e3)}s）`);
      const pausedBaseline = ctx.pausedTotalMs?.() ?? 0;
      const runPromise = step.run(ctx, input);
      let timedOut = false;
      const startedAt = Date.now();
      let timer = null;
      const timeout = new Promise((_, reject2) => {
        timer = setInterval(() => {
          const paused = (ctx.pausedTotalMs?.() ?? 0) - pausedBaseline;
          if (Date.now() - startedAt - paused >= timeoutMs) reject2(new StepTimeoutError(step.id, timeoutMs));
        }, Math.min(250, Math.max(10, timeoutMs / 8)));
      });
      const aborted = new Promise((_, reject2) => {
        if (ctx.signal.aborted) {
          reject2(new Error("用户已停止运行。"));
          return;
        }
        ctx.signal.addEventListener("abort", () => reject2(new Error("用户已停止运行。")), { once: true });
      });
      try {
        const output = await Promise.race([runPromise, timeout, aborted]);
        if (timedOut) {
          ctx.log(`[${step.id}] 超时后晚到的结果已丢弃（exec ${execTag}）`);
          return { status: "degraded", reason: "超时后结果晚到，已丢弃", inputHash };
        }
        return { status: "ok", output: step.persist ? step.persist(output) : output, inputHash };
      } catch (error) {
        if (ctx.signal.aborted) throw error;
        if (error instanceof StepTimeoutError) {
          timedOut = true;
          runPromise.then(
            () => ctx.log(`[${step.id}] 超时后晚到的结果已丢弃（exec ${execTag}）`),
            () => {
            }
          );
          try {
            await step.onTimeout?.(ctx);
          } catch {
          }
          ctx.log(`[${step.id}] ${error.message}`);
        } else {
          ctx.log(`[${step.id}] 失败：${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          const fallen = await step.fallback(ctx, input, error);
          return { ...fallen, inputHash };
        } catch (fallbackError) {
          return fallbackThrew(fallbackError);
        }
      } finally {
        if (timer) clearInterval(timer);
      }
    }
  };

  // src/features/tools/pipeline/v3/runner/run-store.ts
  function bridgeRunStore(request, runsPath) {
    const statePath5 = (runId) => `${runsPath}/${encodeURIComponent(runId)}/state`;
    return {
      load: async (runId) => {
        const read = await request(statePath5(runId), { timeoutMs: 15e3 });
        if (!read.ok) return null;
        const state = read.data?.state ?? read.data;
        const v3 = state?.v3;
        if (!v3 || v3.version !== 1 || typeof v3.steps !== "object" || !v3.steps) return null;
        return v3;
      },
      save: async (snapshot) => {
        const res = await request(statePath5(snapshot.runId), {
          method: "PUT",
          confirmed: true,
          timeoutMs: 2e4,
          body: { state: { v3: snapshot } }
        });
        if (!res.ok) throw new Error(`PUT ${statePath5(snapshot.runId)} 未被受理`);
      }
    };
  }

  // src/features/tools/pipeline/v3/steps/legacy-adapter.ts
  var POLL_INTERVAL_MS = 2e3;
  var MAX_POLL_FAILURES = 3;
  function skillIdFor(host, slug2) {
    const needle = `/${slug2.toLowerCase()}/skill.md`;
    return host.skills.map((entry) => str(asRecord(entry).id)).find((id) => id.replace(/\\/g, "/").toLowerCase().endsWith(needle)) ?? "";
  }
  async function runSkill(host, slug2, input, onTrack) {
    const track = onTrack ?? host.track;
    await host.gate(`准备运行 ${slug2}`);
    const skillId = skillIdFor(host, slug2);
    if (!skillId) throw new Error(`未找到本机 Skill：${slug2}（请确认 Bridge 已扫描到 skills/${slug2}）`);
    const created = await host.ctx.request(SKILL_RUNS_PATH, {
      method: "POST",
      confirmed: true,
      timeoutMs: 2e4,
      body: { skillId, workspace: host.workspace, input }
    });
    if (!created.ok) throw new Error(`${slug2} 未受理：${created.status ?? "无响应"} ${created.error}`);
    const runId = str(created.data?.id);
    if (!runId) throw new Error(`${slug2} 没有返回运行号`);
    track(runId);
    let failures = 0;
    try {
      for (; ; ) {
        await host.gate(`运行 ${slug2}`);
        await host.ctx.sleep(POLL_INTERVAL_MS);
        const read = await host.ctx.request(`${SKILL_RUNS_PATH}/${encodeURIComponent(runId)}`, { timeoutMs: 2e4 });
        if (!read.ok) {
          if (read.status === 404) throw new Error(`${slug2} 的运行记录已不在 Bridge 上（${read.error}）；按已停止处理，不视为成功。`);
          failures += 1;
          if (failures >= MAX_POLL_FAILURES) throw new Error(`Bridge 连接中断，${slug2} 状态无法确认。`);
          continue;
        }
        failures = 0;
        const snapshot = read.data ?? {};
        host.onSnapshot?.(slug2, snapshot);
        const status = str(snapshot.status);
        if (status === "completed") return snapshot.output;
        if (status === "failed") throw new Error(str(snapshot.error) || `${slug2} 执行失败`);
        if (status === "cancelled") throw new Error(`已取消 ${slug2}。`);
      }
    } finally {
      track(null);
    }
  }
  async function listSkills(ctx) {
    const listed = await ctx.request(SKILLS_PATH, { timeoutMs: 2e4 });
    if (!listed.ok) throw new Error(`无法读取本机 Skill：${listed.status ?? "无响应"} ${listed.error}`);
    return asArray(listed.data?.skills);
  }
  async function cancelSkillRun(ctx, runId) {
    try {
      const res = await ctx.request(`${SKILL_RUNS_PATH}/${encodeURIComponent(runId)}/cancel`, {
        method: "POST",
        confirmed: true,
        timeoutMs: 1e4
      });
      if (!res.ok) console.warn(`[pipeline-v3] cancel ${runId} 未被受理：${res.status ?? "无响应"}`);
      return res.ok;
    } catch {
      return false;
    }
  }
  function legacyStep(spec) {
    return {
      id: spec.id,
      title: spec.title,
      timeoutMs: spec.timeoutMs,
      input: spec.input,
      ...spec.emptyCause ? { emptyCause: spec.emptyCause } : {},
      run: spec.run,
      fallback: async (_ctx, input, error) => {
        const output = spec.fallbackOut(input, error);
        const note = spec.reasonNote?.();
        const reason = `${spec.title}失败，已降级：${messageOf(error)}${note ? `；${note}` : ""}`;
        return spec.fallbackStatus === "degraded" ? { status: "degraded", output, reason } : { status: "skipped", output, reason };
      },
      ...spec.persist ? { persist: spec.persist } : {},
      ...spec.onTimeout ? { onTimeout: spec.onTimeout } : {}
    };
  }

  // src/features/tools/pipeline/v3/steps/run-v3.ts
  var PAUSE_TICK_MS = 350;
  var V3_TIMEOUTS = Object.freeze({
    "search.build": 10 * 6e4,
    "search.precise": 5 * 6e4,
    "search.broad": 5 * 6e4,
    "refs.dedupe": 3 * 6e4,
    download: 60 * 6e4,
    "read.cards": 30 * 6e4,
    notes: 5 * 6e4,
    graph: 15 * 6e4,
    review: 30 * 6e4,
    write: 30 * 6e4,
    polish: 20 * 6e4
  });
  var out = (ctx, id) => ctx.upstream[id]?.output;
  var okOut = (ctx, id) => {
    const result = ctx.upstream[id];
    return result?.output !== void 0 ? result.output : null;
  };
  function fallbackQuery(topic) {
    const words = topic.replace(/\s+/g, " ").trim().slice(0, 200);
    return words;
  }
  function markUndownloaded(records, donePaths) {
    return records.map((record2) => ({
      ...record2,
      v3_lane: donePaths.length ? void 0 : str(record2.abstract) ? "abstract_only" : "metadata_only"
    }));
  }
  function recordKeysOf(item) {
    const keys = [];
    const doi = normalizeDoiKey(item.doi);
    if (doi) keys.push(`doi:${doi}`);
    const openalex = str(item.id || item.openalex_id).toLowerCase();
    if (openalex) keys.push(`oa:${openalex}`);
    return keys;
  }
  function buildLegacySteps(host, form, ctx) {
    const { ctx: toolCtx } = host;
    const steps = [];
    let currentExec = null;
    const callSkill = async (slug2, input) => {
      const exec = { runId: null, timedOut: false, active: true };
      currentExec = exec;
      try {
        return await runSkill(host, slug2, input, (skillRunId) => {
          exec.runId = skillRunId;
          if (exec.timedOut) {
            if (skillRunId) void cancelSkillRun(toolCtx, skillRunId);
            return;
          }
          if (exec.active) host.track(skillRunId);
        });
      } finally {
        exec.active = false;
        if (currentExec === exec) currentExec = null;
      }
    };
    const guarded = (spec) => {
      let note = null;
      return legacyStep({
        ...spec,
        onTimeout: async (c) => {
          const exec = currentExec;
          if (!exec) {
            note = "超时发生时没有在飞的 skill run（可能在 LLM 阶段），无法取消";
            c.log(`[${spec.id}] 超时，无在飞执行可取消`);
            return;
          }
          exec.timedOut = true;
          exec.active = false;
          if (!exec.runId) {
            note = "超时发生在拿到运行号之前，取消已挂起，运行号到达即补发";
            c.log(`[${spec.id}] 超时，运行号未到，取消挂起`);
            return;
          }
          const id = exec.runId;
          const res = await Promise.race([
            cancelSkillRun(toolCtx, id),
            new Promise((resolve) => {
              setTimeout(() => resolve(null), 3e3);
            })
          ]);
          if (res === true) {
            note = `超时，已向 Bridge 发出 cancel（${id}）`;
          } else if (res === false) {
            note = "取消请求未被受理，Bridge 上可能有残留任务";
            c.log(`[${spec.id}] cancel ${id} 未被受理，Bridge 可能有残留任务`);
          } else if (res === null) {
            note = "取消结果 3 秒内未确认，Bridge 上可能有残留任务";
            c.log(`[${spec.id}] cancel ${id} 3 秒未确认`);
          }
        },
        reasonNote: () => note
      });
    };
    steps.push(guarded({
      id: "search.build",
      title: "第 1 步 · 检索式",
      timeoutMs: V3_TIMEOUTS["search.build"],
      input: () => form.topic,
      run: async () => {
        const built = await callSkill("literature-search-query-builder", form.topic);
        const query = manifestQuery(built);
        if (!query) throw new Error("检索式为空：未能从研究主题生成检索式");
        return query;
      },
      fallbackOut: () => fallbackQuery(form.topic),
      fallbackStatus: "degraded"
    }));
    const searchInput = (c) => {
      const query = okOut(c, "search.build");
      return query && query.trim() ? query : null;
    };
    for (const [id, slug2, title] of [
      ["search.precise", "nature-academic-search", "第 2 步 · 精排检索"],
      ["search.broad", "pop8-scholar-search", "第 3 步 · 广召回检索"]
    ]) {
      steps.push(guarded({
        id,
        title,
        timeoutMs: V3_TIMEOUTS[id],
        input: searchInput,
        run: async (c, query) => {
          if (c.faults.includes("openalex-503")) throw new Error("注入故障：openalex-503（OpenAlex 返回 503）");
          return manifestRecords(await callSkill(slug2, query));
        },
        fallbackOut: () => [],
        fallbackStatus: "degraded",
        persist: (records) => compactPipelineRecords(records, form.limit)
      }));
    }
    steps.push(guarded({
      id: "refs.dedupe",
      title: "第 4 步 · 去重与导出",
      timeoutMs: V3_TIMEOUTS["refs.dedupe"],
      input: (c) => [
        ...okOut(c, "search.precise") ?? [],
        ...okOut(c, "search.broad") ?? []
      ],
      // 上游都空：记 degraded 并带 cause，不调用旧步骤（评审决策 2）。
      emptyCause: (records) => {
        if (records.length) return null;
        const empty = ["search.precise", "search.broad"].filter((id) => (ctx.upstream[id]?.output ?? []).length === 0);
        return `upstream-empty:${empty.join(",")}`;
      },
      run: async (_c, records) => {
        const deduped = await callSkill("reference-export-dedupe", JSON.stringify({ records }));
        return { records, manifest: asRecord(asRecord(deduped).manifest) };
      },
      fallbackOut: (records) => ({ records: records ?? [], manifest: null }),
      fallbackStatus: "degraded"
    }));
    let downloadSnapshot = null;
    let keptPaths = [];
    let keptFulltextPaths = [];
    let keptAttempts = [];
    let keptDone = /* @__PURE__ */ new Set();
    const absolutize = (path2) => {
      if (/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(path2)) return path2;
      return host.workspace ? `${host.workspace.replace(/[\\/]+$/, "")}/${path2}` : path2;
    };
    steps.push(guarded({
      id: "download",
      title: "第 5 步 · 获取 PDF",
      timeoutMs: V3_TIMEOUTS.download,
      input: (c) => okOut(c, "refs.dedupe")?.records ?? null,
      emptyCause: (records) => records.length ? null : "upstream-empty:refs.dedupe",
      run: async (c, records) => {
        const prior = c.upstream["download"];
        const priorOut = prior?.output ? prior.output : void 0;
        const verify = toolCtx.verifyDownloadedFile;
        let warnedNoVerify = false;
        keptAttempts = [];
        keptPaths = [];
        keptFulltextPaths = [...new Set((priorOut?.fulltextPaths ?? []).map(str).filter(Boolean))];
        keptDone = /* @__PURE__ */ new Set();
        for (const value of priorOut?.attempts ?? []) {
          const item = asRecord(value);
          if (str(item.status) !== "downloaded") {
            keptAttempts.push(value);
            continue;
          }
          const path2 = str(item.path);
          let valid = true;
          if (verify && path2) {
            const verdict2 = await verify(absolutize(path2));
            if (verdict2 === null) c.log(`[download] 无法校验 ${path2}（工作区在 vault 外？），按有效处理——校验未覆盖此文件`);
            else valid = verdict2;
          } else if (!verify && !warnedNoVerify) {
            warnedNoVerify = true;
            c.log("[download] 宿主未提供文件校验能力，按旧结果复用（文件可能已变动）");
          }
          if (valid && path2) {
            keptAttempts.push(value);
            keptPaths.push(path2);
            for (const key of recordKeysOf(item)) keptDone.add(key);
          } else {
            c.log(`[download] 旧文件不可复用（${path2 || "无路径"}），该篇重新下载`);
          }
        }
        const todo = keptDone.size ? records.filter((record2) => !recordKeysOf(record2).some((key) => keptDone.has(key))) : records;
        if (priorOut && todo.length === 0) {
          c.log(`[download] 续跑：${records.length} 条全部已下载，直接复用旧结果`);
          return {
            pdfPaths: [...new Set(keptPaths)],
            fulltextPaths: keptFulltextPaths,
            attempts: keptAttempts,
            catalogPath: priorOut.catalogPath
          };
        }
        if (priorOut && todo.length !== records.length) {
          c.log(`[download] 续跑：跳过已下载的 ${records.length - todo.length} 条，补下载 ${todo.length} 条`);
        }
        const download = await callSkill("paper-downloader", JSON.stringify({ records: todo, headless: true, browser_workers: 1 }));
        const manifest = asRecord(asRecord(download).manifest);
        return {
          pdfPaths: [.../* @__PURE__ */ new Set([...keptPaths, ...manifestPdfPaths(download)])],
          fulltextPaths: keptFulltextPaths,
          attempts: [...keptAttempts, ...asArray(manifest.results)],
          catalogPath: str(manifest.catalog_path) || priorOut?.catalogPath || "literature/exports/retrieved-literature.md"
        };
      },
      // 评审决策 4 + 第四轮 2：先清点本次部分结果；闭包里的已复用旧成果
      // 一并合并，失败/超时也不丢；剩余记录按有无摘要标记。
      fallbackOut: (records) => {
        const partial = asArray(asRecord(downloadSnapshot?.manifest).results);
        const partialPaths = partial.map((item) => str(asRecord(item).path)).filter(Boolean);
        const remaining = (records ?? []).filter((record2) => !recordKeysOf(record2).some((key) => keptDone.has(key)));
        return {
          pdfPaths: [.../* @__PURE__ */ new Set([...keptPaths, ...partialPaths])],
          fulltextPaths: keptFulltextPaths,
          attempts: [...keptAttempts, ...partial.length ? partial : markUndownloaded(remaining, partialPaths)],
          catalogPath: "literature/exports/retrieved-literature.md"
        };
      },
      fallbackStatus: "degraded"
    }));
    const prevSnapshot = host.onSnapshot;
    host.onSnapshot = (slug2, snapshot) => {
      if (slug2 === "paper-downloader") downloadSnapshot = snapshot;
      prevSnapshot?.(slug2, snapshot);
    };
    const canonicalCard = (card) => ({
      id: str(card.id),
      source_path: str(card.source_path ?? card.source ?? card.pdf_path ?? card.path),
      evidence_tier: str(card.evidence_tier),
      claim_candidates: asArray(card.claim_candidates).map(str).filter(Boolean),
      doi: str(card.doi),
      title: str(card.title)
    });
    steps.push(guarded({
      id: "read.cards",
      title: "第 6 步 · 证据卡片",
      timeoutMs: V3_TIMEOUTS["read.cards"],
      input: (c) => {
        const download = okOut(c, "download");
        return download ? { pdfPaths: download.pdfPaths ?? [], markdownPaths: download.fulltextPaths ?? [] } : null;
      },
      emptyCause: (input) => input.pdfPaths.length || input.markdownPaths.length ? null : "upstream-empty:download",
      run: async (_c, input) => {
        const reader = await callSkill("nature-reader", JSON.stringify({
          pdf_paths: input.pdfPaths,
          markdown_paths: input.markdownPaths
        }));
        return asArray(asRecord(asRecord(reader).manifest).cards).map(asRecord);
      },
      fallbackOut: () => [],
      fallbackStatus: "degraded",
      // 落盘只存规范形态：丢掉 full_text 等大字段，快照不至于逼近 8MB 上限。
      persist: (cards) => cards.map(canonicalCard)
    }));
    const usableCards = (c) => {
      return (okOut(c, "read.cards") ?? []).map(canonicalCard).filter((card) => {
        const claims = card.claim_candidates;
        return card.evidence_tier !== "unreadable_pdf" && claims.some((claim) => !/^\s*%PDF-/i.test(claim) && claim.length >= 80);
      });
    };
    steps.push(guarded({
      id: "notes",
      title: "第 8 步 · 文献笔记",
      timeoutMs: V3_TIMEOUTS.notes,
      input: (c) => okOut(c, "read.cards") ?? null,
      run: async () => callSkill("obsidian-bases", ""),
      fallbackOut: () => void 0,
      fallbackStatus: "skipped"
    }));
    steps.push(guarded({
      id: "graph",
      title: "第 9 步 · 知识图谱",
      timeoutMs: V3_TIMEOUTS.graph,
      // 硬性规则：证据为空时绝不调用 LLM（返回 null → Runner 记 skipped）。
      input: (c) => {
        const cards = usableCards(c);
        return cards.length ? cards : null;
      },
      run: async (_c, cards) => {
        const extracted = await toolCtx.askAgent(buildExtractionPrompt({ question: form.topic, cards }), { timeoutMs: 24e4 });
        if (!extracted.ok) throw new Error(`知识图谱语义抽取失败：${extracted.error}`);
        const graph = parseGraphReply(extracted.text);
        if (!graph.nodes.length || !graph.edges.length) throw new Error("Agent 返回了空知识图谱；未写入空图。");
        const download = okOut(_c, "download");
        const paths = [...download?.pdfPaths ?? [], ...download?.fulltextPaths ?? []];
        const rendered = await callSkill("zrl-knowledge-graph", JSON.stringify({
          title: `${form.topic.slice(0, 80)} · 知识图谱`,
          research_question: form.topic,
          card_source_paths: paths,
          graph
        }));
        const manifest = asRecord(asRecord(rendered).manifest);
        if (!Number(manifest.nodes ?? 0) || !Number(manifest.edges ?? 0)) throw new Error("知识图谱渲染结果为空。");
        return manifest;
      },
      fallbackOut: () => void 0,
      fallbackStatus: "skipped"
    }));
    for (const [id, slug2, title] of [
      ["review", "deep-research", "第 10 步 · 证据综述"],
      ["write", "nature-writing", "第 11 步 · 手稿初稿"],
      ["polish", "nature-polishing", "第 12 步 · 手稿润色"]
    ]) {
      steps.push(guarded({
        id,
        title,
        timeoutMs: V3_TIMEOUTS[id],
        // 硬性规则：证据为空时绝不调用 LLM。
        input: (c) => {
          const cards = usableCards(c);
          return cards.length ? cards : null;
        },
        run: async (c) => {
          const paths = okOut(c, "download")?.pdfPaths ?? [];
          return callSkill(slug2, id === "review" ? JSON.stringify({ card_source_paths: paths }) : "");
        },
        fallbackOut: () => void 0,
        fallbackStatus: "skipped"
      }));
    }
    return steps;
  }
  async function driveV3(toolCtx, run, form, options) {
    const { emit: emit2 } = options;
    const write = { confirmed: true, timeoutMs: 2e4 };
    const history = await toolCtx.request(PIPELINE_RUNS_PATH, {
      ...write,
      method: "POST",
      body: { title: `[v3] ${form.topic.slice(0, 150)}`, workspace: run.workspace }
    });
    if (!history.ok || !str(history.data?.id)) {
      run.status = "error";
      run.statusText = `无法建立 Pipeline 历史：${history.ok ? "无运行号" : `${history.status ?? "无响应"} ${history.error}`}`;
      run.outcome = { kind: "failed", title: "Pipeline 未启动", lines: [run.statusText] };
      emit2();
      return;
    }
    run.historyId = str(history.data?.id);
    emit2();
    const skills = await listSkills(toolCtx);
    const abort = new AbortController();
    run.onStopRequested = () => abort.abort();
    let pausedMs = 0;
    let pauseStarted = 0;
    const gate = async (label) => {
      if (run.stopRequested) {
        abort.abort();
        throw new Error("用户已停止运行。");
      }
      while (run.paused && !run.stopRequested) {
        if (!pauseStarted) pauseStarted = Date.now();
        run.statusText = `已暂停：${label}`;
        emit2();
        await toolCtx.sleep(PAUSE_TICK_MS);
      }
      if (pauseStarted) {
        pausedMs += Date.now() - pauseStarted;
        pauseStarted = 0;
      }
      if (run.stopRequested) {
        abort.abort();
        throw new Error("用户已停止运行。");
      }
    };
    const host = {
      ctx: toolCtx,
      workspace: run.workspace,
      skills,
      track: (skillRunId) => {
        run.currentSkillRunId = skillRunId;
        emit2();
      },
      currentSkillRunId: () => run.currentSkillRunId,
      gate
    };
    const store = bridgeRunStore((path2, init) => toolCtx.request(path2, init), PIPELINE_RUNS_PATH);
    const scope = toolCtx.scope();
    const outcomeLines = [];
    const runCtx = {
      runId: run.historyId,
      runDir: `.scholarium/runs/${run.historyId}/`,
      channelUp: {},
      upstream: {},
      faults: scope.debugFaults ?? [],
      timeouts: { ...V3_TIMEOUTS, ...scope.v3Timeouts ?? {} },
      meta: { form: { topic: form.topic, sources: [...form.sources], limit: form.limit } },
      log: (msg) => {
        run.statusText = msg;
        emit2();
      },
      tokens: { add: () => {
      } },
      signal: abort.signal,
      // gate 在用户停止时真正 abort；Runner 在 fallback 前检查并直接抛出
      // 已累计 + 正在进行的暂停（评审第五轮 1）：长暂停期间步骤不被判超时。
      pausedTotalMs: () => pausedMs + (pauseStarted ? Date.now() - pauseStarted : 0),
      onPersistError: (message) => {
        outcomeLines.push(message);
      }
    };
    if (options.resumeFromId) {
      const prior = await store.load(options.resumeFromId);
      let skipped = 0;
      for (const [id, result] of Object.entries(prior?.steps ?? {})) {
        if (result.status === "ok") {
          runCtx.upstream[id] = result;
          skipped += 1;
        } else if (id === "download" && result.status === "degraded" && result.output) {
          runCtx.upstream[id] = result;
        }
      }
      run.statusText = skipped ? `续跑：已恢复 ${skipped} 个已完成步骤` : "续跑：旧记录中没有可复用的步骤";
      emit2();
    }
    const steps = buildLegacySteps(host, form, runCtx);
    run.rows = steps.map((step) => ({ title: step.title, detail: "等待执行", state: "pending" }));
    run.planned = steps.length;
    emit2();
    const runner = new Runner(store);
    const rowOf = (stepId) => run.rows[steps.findIndex((step) => step.id === stepId)];
    runner.onProgress((event) => {
      if (event.type !== "step" || !event.stepId) return;
      const row = rowOf(event.stepId);
      if (!row || !event.result) return;
      row.state = event.result.status === "ok" ? "done" : event.result.status;
      row.detail = event.result.reason ?? (event.result.status === "ok" ? "完成" : "");
      emit2();
    });
    try {
      const upstream = await runner.execute(runCtx, steps, {
        afterStep: (stepId) => {
          if (stepId === "download") {
            if (runCtx.faults.includes("crash-after-s7")) throw new Error("注入故障：crash-after-s7（模拟崩溃）");
          }
        }
      });
      const download = out(runCtx, "download");
      const pdfPaths = download?.pdfPaths ?? [];
      const fulltextPaths = download?.fulltextPaths ?? [];
      const records = out(runCtx, "refs.dedupe")?.records ?? [];
      const cards = out(runCtx, "read.cards") ?? [];
      const query = out(runCtx, "search.build") ?? "";
      if (!pdfPaths.length && !fulltextPaths.length) {
        runCtx.quality = "L1";
        outcomeLines.push("本轮 PDF 0 篇：质量等级 L1，写作类步骤按降级模式处理。");
      }
      if (pdfPaths.length || records.length) {
        const manualQueue = buildManualDownloadQueue(records, download?.attempts ?? []).map((item) => ({
          ...item,
          pipelineRunId: run.historyId,
          workspace: run.workspace
        }));
        run.manualQueue = manualQueue;
        if (toolCtx.publishManualDownloads && manualQueue.length) {
          try {
            const published = await toolCtx.publishManualDownloads(manualQueue, { append: true, open: false });
            run.rows.push({ title: "第 5.5 步 · 转入手动批量下载", detail: `${published} 篇自动下载未成功的文献已加入队列。`, state: "done" });
          } catch (error) {
            run.rows.push({ title: "第 5.5 步 · 转入手动批量下载", detail: `导入队列失败：${messageOf(error)}。`, state: "error" });
          }
        }
      }
      const degraded = steps.filter((step) => upstream[step.id]?.status === "degraded").map((step) => {
        const reason = upstream[step.id]?.reason;
        return reason ? `${step.id}（${reason}）` : step.id;
      });
      const skipped = steps.filter((step) => upstream[step.id]?.status === "skipped").map((step) => step.id);
      outcomeLines.push(
        `检索式：${query || "（空）"}`,
        `候选文献 ${records.length} 条；本轮 PDF ${pdfPaths.length} 篇；网页全文 ${fulltextPaths.length} 篇；待手动下载 ${run.manualQueue?.length ?? 0} 篇；证据卡 ${cards.length} 张`,
        degraded.length ? `降级步骤：${degraded.join("、")}` : "无降级步骤",
        skipped.length ? `跳过步骤：${skipped.join("、")}` : "无跳过步骤",
        `运行历史：${run.historyId}`
      );
      const empty = records.length === 0 && !pdfPaths.length && !fulltextPaths.length;
      if (empty) outcomeLines.unshift("没有检索到任何候选文献：请检查网络/代理与检索式，或换一个不带括号的英文主题后重跑。");
      finishV3(run, "done", empty ? "Pipeline v3 跑完，但没有候选文献" : "Pipeline v3 已完成", {
        kind: "completed",
        title: empty ? "Pipeline v3 跑完，但没有检索到候选文献" : "Pipeline v3 运行完成",
        lines: outcomeLines,
        summary: outcomeLines.join("\n"),
        ...empty ? { warning: true } : {}
      });
    } catch (error) {
      const message = messageOf(error);
      const crashed = runCtx.faults.includes("crash-after-s7") && /crash-after-s7/.test(message);
      if (run.stopRequested) {
        finishV3(run, "stopped", "已取消", { kind: "cancelled", title: "Pipeline 已取消", lines: ["已由用户取消；已落盘的步骤可续跑。"] });
      } else {
        finishV3(run, "error", message, {
          kind: "failed",
          title: crashed ? "Pipeline 崩溃（注入故障），可续跑" : "Pipeline 运行失败",
          lines: [message, `运行历史：${run.historyId}`, "已完成的步骤已落盘；续跑不会重跑它们。"]
        });
      }
    }
    emit2();
  }
  function finishV3(run, status, statusText, outcome) {
    run.status = status;
    run.statusText = statusText;
    run.paused = false;
    run.currentSkillRunId = null;
    delete run.onStopRequested;
    run.outcome = outcome;
    run.recordStatus = persistedStatus(status, run.stopRequested);
  }

  // src/features/tools/pipeline/v3/faults.ts
  var FAULT_NAMES = Object.freeze([
    /** OpenAlex 请求全部返回 503。 */
    "openalex-503",
    /** C2 请求全部表现为跳转登录页（会话过期）。 */
    "webvpn-expired",
    /** OA 链接返回 HTML 页面而不是 PDF。 */
    "oa-html",
    /** 浏览器 worker 不可达。 */
    "worker-down",
    /** S9 的 LLM 调用超时。 */
    "llm-timeout-s9",
    /** S7 结束后抛出未捕获异常（模拟 Obsidian 崩溃）。 */
    "crash-after-s7"
  ]);
  function isFaultName(value) {
    return FAULT_NAMES.includes(value);
  }
  function normalizeFaults(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of raw) {
      if (typeof entry !== "string") continue;
      const name = entry.trim();
      if (isFaultName(name)) seen.add(name);
    }
    return [...seen];
  }

  // src/features/tools/pipeline/v3/index.ts
  var captureChains = /* @__PURE__ */ new Map();
  function acceptManualPipelineCapture(ctx, artifact) {
    const key = str(artifact.pipelineRunId);
    const previous = captureChains.get(key) ?? Promise.resolve();
    const next = previous.catch(() => void 0).then(() => acceptCaptureNow(ctx, artifact));
    const settled = next.catch(() => void 0);
    captureChains.set(key, settled);
    void settled.then(() => {
      if (captureChains.get(key) === settled) captureChains.delete(key);
    });
    return next;
  }
  async function acceptCaptureNow(ctx, artifact) {
    const runId = str(artifact.pipelineRunId);
    const live = currentRun();
    if (live && isRunning(live) && live.historyId === runId) {
      throw new Error("该 Pipeline 正在运行；请等它结束（或停止）后再归入人工抓取结果，文件已保存不会丢。");
    }
    const artifactPath = str(artifact.path).replace(/\\/g, "/");
    if (!runId || !artifactPath || artifactPath.startsWith("/") || /^[A-Za-z]:/.test(artifactPath) || artifactPath.includes("../")) {
      throw new Error("人工抓取结果缺少有效的 Pipeline 运行号或工作区相对路径");
    }
    if (artifact.kind !== "pdf" && artifact.kind !== "webclip") throw new Error("未知的人工抓取结果类型");
    const store = bridgeRunStore((requestPath, init) => ctx.request(requestPath, init), PIPELINE_RUNS_PATH);
    const snapshot = await store.load(runId);
    if (!snapshot) throw new Error(`找不到 Pipeline v3 运行快照：${runId}`);
    const steps = { ...snapshot.steps };
    const previous = asRecord(steps.download);
    const output = asRecord(previous.output);
    const pdfPaths = [.../* @__PURE__ */ new Set([
      ...Array.isArray(output.pdfPaths) ? output.pdfPaths.map(str).filter(Boolean) : [],
      ...artifact.kind === "pdf" ? [artifactPath] : []
    ])];
    const fulltextPaths = [.../* @__PURE__ */ new Set([
      ...Array.isArray(output.fulltextPaths) ? output.fulltextPaths.map(str).filter(Boolean) : [],
      ...artifact.kind === "webclip" ? [artifactPath] : []
    ])];
    const priorAttempts = Array.isArray(output.attempts) ? output.attempts : [];
    const alreadyRecorded = priorAttempts.some((item) => str(asRecord(item).path).replace(/\\/g, "/") === artifactPath && asRecord(item).manual_capture === true);
    const attempts = alreadyRecorded ? priorAttempts : [
      ...priorAttempts,
      {
        id: str(artifact.id),
        doi: str(artifact.doi),
        title: str(artifact.title),
        path: artifactPath,
        status: "downloaded",
        capture_kind: artifact.kind,
        manual_capture: true
      }
    ];
    steps.download = {
      ...previous,
      status: "ok",
      output: {
        ...output,
        pdfPaths,
        fulltextPaths,
        attempts,
        catalogPath: str(output.catalogPath) || "literature/exports/retrieved-literature.md"
      }
    };
    for (const id of ["read.cards", "notes", "graph", "review", "write", "polish"]) delete steps[id];
    const captures = asArray(asRecord(snapshot.meta).manualCaptures).map(asRecord);
    captures.push({
      id: str(artifact.id),
      path: artifactPath,
      kind: artifact.kind,
      doi: str(artifact.doi),
      title: str(artifact.title),
      capturedAt: ctx.now()
    });
    await store.save({
      ...snapshot,
      steps,
      meta: { ...asRecord(snapshot.meta), manualCaptures: captures.slice(-200) }
    });
    return { runId, pdfCount: pdfPaths.length, webclipCount: fulltextPaths.length };
  }
  function isV3Record(record2) {
    const state = asRecord(asRecord(record2).state);
    return Boolean(state.v3 && typeof state.v3 === "object");
  }
  function formFromRecord(record2) {
    const state = asRecord(asRecord(record2).state);
    const v3 = asRecord(state.v3);
    const saved = asRecord(asRecord(v3.meta).form);
    const sources = asArray(saved.sources).map(str).filter((value) => value === "primary" || value === "broad");
    const limitValue = Number(saved.limit);
    return {
      topic: str(saved.topic) || str(state.question) || str(asRecord(record2).title).replace(/^\[v3\] /, ""),
      sources: sources.length ? sources : ["primary", "broad"],
      limit: Number.isFinite(limitValue) ? Math.max(10, Math.min(200, Math.round(limitValue))) : 80
    };
  }
  async function runPipelineV3(ctx, form) {
    const workspace = ctx.scope().workspaceRoot;
    if (!workspace) {
      ctx.notice("未配置工作区路径；Pipeline 不会猜测写入位置。");
      return false;
    }
    if (!await ctx.confirm(`将运行 Pipeline v3（实验性）。

主题：${form.topic}
检索来源：${form.sources.join(" + ")}
上限：${form.limit}
工作区：${workspace}

步骤失败不再中断管线，降级结果会在步骤列表标注。是否继续？`)) return false;
    const run = {
      origin: "local",
      historyId: "",
      topic: form.topic,
      label: "文献 Pipeline v3",
      status: "running",
      statusText: "准备执行",
      paused: false,
      stopRequested: false,
      rows: [],
      planned: 0,
      currentSkillRunId: null,
      workspace,
      outcome: null,
      review: "open",
      reviewNote: ""
    };
    adoptV3Run(run);
    await driveV3(ctx, run, form, { emit: notifyRunChanged });
    return true;
  }
  async function resumePipelineV3(ctx, historyRun) {
    const record2 = historyRun.record;
    if (!record2 || !isV3Record(record2)) {
      ctx.notice("这条历史没有 v3 状态包，不能按 v3 续跑。");
      return false;
    }
    const form = formFromRecord(record2);
    const currentWorkspace = ctx.scope().workspaceRoot.replace(/\\/g, "/").toLowerCase();
    if (!currentWorkspace || currentWorkspace !== historyRun.workspace.replace(/\\/g, "/").toLowerCase()) {
      ctx.notice("这条历史属于另一个工作区，不能在当前库中续跑。");
      return false;
    }
    if (!await ctx.confirm(`将从断点续跑 v3 运行（已完成的步骤不重跑，降级/跳过的步骤会重试）。

原运行：${historyRun.historyId}
主题：${form.topic}
将建立一条新的子运行记录。是否继续？`)) return false;
    const run = {
      origin: "local",
      historyId: "",
      topic: form.topic,
      label: "文献 Pipeline v3（断点续跑）",
      status: "running",
      statusText: "准备从断点继续",
      paused: false,
      stopRequested: false,
      rows: [],
      planned: 0,
      currentSkillRunId: null,
      workspace: historyRun.workspace,
      outcome: null,
      review: "open",
      reviewNote: ""
    };
    adoptV3Run(run);
    await driveV3(ctx, run, form, { emit: notifyRunChanged, resumeFromId: historyRun.historyId });
    return true;
  }

  // src/features/tools/pipeline/run-controller.ts
  var HISTORY_PATH = "/v1/history";
  var DISCARD_PATH = "/v1/pipeline/discard";
  var POLL_INTERVAL_MS2 = 2e3;
  var PAUSE_TICK_MS2 = 350;
  var MAX_POLL_FAILURES2 = 3;
  var listeners = /* @__PURE__ */ new Set();
  var active = null;
  var selectedHistoryId = null;
  function currentRun() {
    return active;
  }
  function selectPipelineHistory(id) {
    selectedHistoryId = id && id.trim() ? id.trim() : null;
    if (active?.origin === "history" && active.historyId !== selectedHistoryId) active = null;
    emit();
  }
  function selectedPipelineHistory() {
    return selectedHistoryId;
  }
  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
  function emit() {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
      }
    }
  }
  function adoptV3Run(run) {
    active = run;
    emit();
  }
  function notifyRunChanged() {
    emit();
  }
  function isRunning(run = active) {
    return Boolean(run && run.origin === "local" && run.status === "running");
  }
  function togglePause() {
    const run = active;
    if (!isRunning(run) || run.stopRequested) return;
    run.paused = !run.paused;
    run.statusText = run.paused ? "暂停于阶段间隙" : "继续运行";
    emit();
  }
  async function requestStop(ctx) {
    const run = active;
    if (!isRunning(run) || run.stopRequested) return;
    if (!await ctx.confirm("取消本次 Pipeline？正在运行的 Skill 会被终止，后续步骤不再执行；已经写入的文件保持不变。")) return;
    if (!isRunning(run) || run.stopRequested) return;
    run.stopRequested = true;
    run.paused = false;
    run.onStopRequested?.();
    const skillRunId = run.currentSkillRunId;
    run.statusText = skillRunId ? "正在取消当前 Skill" : "将在当前阶段结束前停止";
    const pending = [...run.rows].reverse().find((row) => row.state === "pending");
    if (pending && skillRunId) pending.detail = "正在取消当前 Skill，请稍候…";
    emit();
    if (skillRunId) {
      const sent = await ctx.request(`${SKILL_RUNS_PATH}/${encodeURIComponent(skillRunId)}/cancel`, { method: "POST", timeoutMs: 15e3, confirmed: true });
      if (!sent.ok) ctx.notice(`取消当前 Skill 失败：${sent.status ?? "无响应"} ${sent.error}`);
    }
  }
  var PipelineStop = class extends Error {
    constructor(reason, lines) {
      super(reason);
      this.reason = reason;
      this.lines = lines;
    }
    reason;
    lines;
  };
  function nowMs(ctx) {
    const parsed = Date.parse(ctx.now());
    return Number.isFinite(parsed) ? parsed : Date.now();
  }
  async function launchPipeline(ctx, form) {
    if (isRunning()) {
      ctx.notice("已有一轮 Pipeline 正在运行；请等待它结束或先取消。");
      return false;
    }
    if (ctx.scope().pipelineVersion === "v3") return runPipelineV3(ctx, form);
    const workspace = ctx.scope().workspaceRoot;
    if (!workspace) {
      ctx.notice("未配置工作区路径；Pipeline 不会猜测写入位置。");
      return false;
    }
    if (!await ctx.confirm(previewText(form, workspace))) return false;
    if (isRunning()) return false;
    const stages = plannedStages(form);
    const run = {
      origin: "local",
      historyId: "",
      topic: form.topic,
      label: "文献 Pipeline",
      status: "running",
      statusText: "准备执行",
      paused: false,
      stopRequested: false,
      rows: [],
      planned: stages.length,
      currentSkillRunId: null,
      workspace,
      outcome: null,
      review: "open",
      reviewNote: ""
    };
    active = run;
    emit();
    await drive(ctx, run, form, stages);
    return true;
  }
  function formForHistory(run) {
    const state = asRecord(run.record?.state);
    const saved = asRecord(state.pipelineForm);
    const sources = asArray(saved.sources).map(str).filter((value) => value === "primary" || value === "broad");
    const limitValue = Number(saved.limit);
    return {
      topic: str(state.question) || run.topic,
      sources: sources.length ? sources : ["primary", "broad"],
      limit: Number.isFinite(limitValue) ? Math.max(10, Math.min(200, Math.round(limitValue))) : 80
    };
  }
  async function resumePipeline(ctx, historyRun, requestedStep) {
    if (isRunning()) {
      ctx.notice("已有一轮 Pipeline 正在运行；请等待它结束或先取消。");
      return false;
    }
    if (isV3Record(historyRun.record)) return resumePipelineV3(ctx, historyRun);
    const record2 = historyRun.record;
    if (!record2) {
      ctx.notice("这条历史没有可恢复的状态包，请改用“重新运行”。");
      return false;
    }
    const verdict2 = isResumable(record2);
    const fromId = requestedStep || verdict2.fromId || "";
    const plan = restartPlan(record2, fromId);
    if (!fromId || !plan.runnable) {
      ctx.notice(requestedStep ? describeRestart(record2, requestedStep) : describeResume(record2));
      return false;
    }
    const initialState = restartStateForStep(record2.state, fromId);
    if (!initialState) {
      ctx.notice("无法重建断点状态，请从第 1 步重新运行。");
      return false;
    }
    const form = formForHistory(historyRun);
    const currentWorkspace = ctx.scope().workspaceRoot.replace(/\\/g, "/").toLowerCase();
    const historyWorkspace = historyRun.workspace.replace(/\\/g, "/").toLowerCase();
    if (!currentWorkspace || currentWorkspace !== historyWorkspace) {
      ctx.notice("这条历史属于另一个工作区，不能在当前库中续跑。");
      return false;
    }
    if (!await ctx.confirm(`${describeRestart(record2, fromId)}

原运行：${historyRun.historyId}
主题：${form.topic}
将建立一条新的子运行记录。是否继续？`)) return false;
    const stages = plannedStages(form).filter((stage) => stepIndex(stage.stepId) >= stepIndex(fromId));
    const run = {
      origin: "local",
      historyId: "",
      topic: form.topic,
      label: "文献 Pipeline（断点续跑）",
      status: "running",
      statusText: "准备从断点继续",
      paused: false,
      stopRequested: false,
      rows: [],
      planned: stages.length,
      currentSkillRunId: null,
      workspace: historyRun.workspace,
      outcome: null,
      review: "open",
      reviewNote: ""
    };
    active = run;
    emit();
    await drive(ctx, run, form, stages, { initialState, fromStepId: fromId, parentRunId: historyRun.historyId });
    return true;
  }
  async function restartPipeline(ctx, historyRun) {
    return launchPipeline(ctx, formForHistory(historyRun));
  }
  async function drive(ctx, run, form, stages, options = {}) {
    const write = { confirmed: true, timeoutMs: 2e4 };
    const history = await ctx.request(PIPELINE_RUNS_PATH, { ...write, method: "POST", body: {
      title: form.topic.slice(0, 160),
      workspace: run.workspace,
      ...options.parentRunId ? { parentRunId: options.parentRunId } : {}
    } });
    if (!history.ok) return finish(run, "error", "无法建立 Pipeline 历史", { kind: "failed", title: "Pipeline 未启动", lines: [`无法建立 Pipeline 历史：${history.status ?? "无响应"} ${history.error}`] });
    run.historyId = str(history.data?.id);
    if (!run.historyId) return finish(run, "error", "运行时没有返回 Pipeline 历史号", { kind: "failed", title: "Pipeline 未启动", lines: ["运行时没有返回 Pipeline 历史号，未启动。"] });
    emit();
    const historyPath = `${PIPELINE_RUNS_PATH}/${encodeURIComponent(run.historyId)}`;
    const checkpoint = async (extra = {}) => {
      const saved = await ctx.request(historyPath, { ...write, method: "PATCH", body: { steps: run.rows, ...extra } });
      return saved.ok;
    };
    const state = {
      ...options.initialState ?? {},
      question: form.topic,
      workspace: run.workspace,
      pipelineForm: { sources: [...form.sources], limit: form.limit }
    };
    const saveState = async () => {
      const fitted = fitStateToBudget(state);
      const saved = await ctx.request(`${historyPath}/state`, { ...write, method: "PUT", body: { state: fitted.state } });
      if (!saved.ok) ctx.notice(`断点状态保存失败：${saved.error}；本次仍会继续，但中断后不能从这一步续跑。`, "info");
      else if (fitted.truncated) ctx.notice(`状态包超出体积上限，已省略 ${fitted.dropped.join("、")}。`, "info");
    };
    const setStatus = (text6) => {
      run.statusText = text6;
      emit();
    };
    const gate = async (label) => {
      if (run.stopRequested) throw new Error("用户已停止运行。");
      while (run.paused && !run.stopRequested) {
        if (run.statusText !== `已暂停：${label}`) setStatus(`已暂停：${label}`);
        await ctx.sleep(PAUSE_TICK_MS2);
      }
      if (run.stopRequested) throw new Error("用户已停止运行。");
    };
    const outputs = {};
    try {
      const listed = await ctx.request(SKILLS_PATH, { timeoutMs: 2e4 });
      if (!listed.ok) throw new Error(`无法读取本机 Skill：${listed.status ?? "无响应"} ${listed.error}`);
      const skills = asArray(listed.data?.skills);
      const poll = async (runId, slug2, row) => {
        let failures = 0;
        for (; ; ) {
          await gate(`运行 ${slug2}`);
          await ctx.sleep(POLL_INTERVAL_MS2);
          const read = await ctx.request(`${SKILL_RUNS_PATH}/${encodeURIComponent(runId)}`, { timeoutMs: 2e4 });
          if (!read.ok) {
            if (read.status === 404) throw new Error(`${slug2} 的运行记录已不在 Bridge 上（${read.error}）；按已停止处理，不视为成功。`);
            failures += 1;
            setStatus(`正在运行 Skill：${slug2}（Bridge 连接异常，第 ${failures} 次重试）`);
            if (failures >= MAX_POLL_FAILURES2) throw new Error(`Bridge 连接中断，${slug2} 已停止：无法确认任务状态，请勿假定它仍在运行。`);
            continue;
          }
          failures = 0;
          const snapshot = read.data ?? {};
          const status = str(snapshot.status);
          if (status === "completed") return snapshot.output;
          if (status === "failed") throw new Error(str(snapshot.error) || `${slug2} 执行失败`);
          if (status === "cancelled") throw new Error(`用户已取消 ${slug2}。`);
          const view = pollStatus(slug2, snapshot, nowMs(ctx));
          if (view.stalled) throw new Error(view.stalled);
          if (view.rowDetail) row.detail = view.rowDetail;
          setStatus(view.status);
        }
      };
      const stage = async (item, input) => {
        await gate(`准备运行 ${item.slug}`);
        const row = { title: item.title, detail: `正在运行 ${item.slug}`, state: "pending" };
        run.rows.push(row);
        setStatus(`正在运行 Skill：${item.slug}`);
        await checkpoint({ status: "running" });
        const needle = `/${item.slug.toLowerCase()}/skill.md`;
        const skillId = skills.map((entry) => str(asRecord(entry).id)).find((id) => id.replace(/\\/g, "/").toLowerCase().endsWith(needle)) ?? "";
        if (!skillId) throw new Error(`未找到本机 Skill：${item.slug}（请确认 Bridge 已扫描到 skills/${item.slug}）`);
        const created = await ctx.request(SKILL_RUNS_PATH, { ...write, method: "POST", body: { skillId, workspace: run.workspace, input } });
        if (!created.ok) throw new Error(`${item.slug} 未受理：${created.status ?? "无响应"} ${created.error}`);
        const runId = str(created.data?.id);
        if (!runId) throw new Error(`${item.slug} 没有返回运行号`);
        run.currentSkillRunId = runId;
        emit();
        let output;
        try {
          output = await poll(runId, item.slug, row);
        } finally {
          if (run.currentSkillRunId === runId) run.currentSkillRunId = null;
        }
        outputs[item.slug] = output;
        row.state = "done";
        row.detail = stageDetail(item.slug, output);
        emit();
        await saveState();
        await checkpoint({ status: "running", resumeStepId: item.stepId, resumeStepIndex: stepIndex(item.stepId) });
        return output;
      };
      const find = (slug2) => stages.find((item) => item.slug === slug2);
      const stopAt = (row, reason, lines2) => {
        if (row) {
          row.state = "error";
          row.detail = reason;
        }
        throw new PipelineStop(reason, lines2);
      };
      const failGraph = (reason) => {
        const last = run.rows.at(-1);
        if (last && /知识图谱/.test(last.title)) {
          last.state = "error";
          last.detail = reason;
        } else {
          run.rows.push({ title: "第 9 步 · 知识图谱", detail: reason, state: "error" });
        }
        emit();
        throw new Error(reason);
      };
      const fromIndex = options.fromStepId ? stepIndex(options.fromStepId) : -1;
      const shouldRun = (id) => fromIndex < 0 || stepIndex(id) >= fromIndex;
      let query = str(state.usedQuery) || str(state.query);
      if (shouldRun("query-builder")) {
        const built = await stage(find("literature-search-query-builder"), form.topic);
        query = manifestQuery(built);
        if (!query) stopAt(run.rows.at(-1), "检索式为空，Pipeline 已停止（research-pipeline.json stop_rule：query manifest 为空）。", ["未能从研究主题生成检索式；请把研究问题写得更具体（例如包含材料、体系、反应或现象关键词）后重试。"]);
        Object.assign(state, { step1Manifest: asRecord(asRecord(built).manifest), query, usedQuery: query });
      }
      if (!query) stopAt(run.rows.at(-1), "断点状态缺少检索式，不能继续运行。", ["请从第 1 步重新运行 Pipeline。"]);
      let combined = asArray(state.combined).map(asRecord);
      if (shouldRun("search")) {
        const found = [];
        for (const item of stages.filter((entry) => entry.source)) {
          const records = manifestRecords(await stage(item, query));
          state[item.source === "primary" ? "records2" : "records3"] = compactPipelineRecords(records, form.limit);
          found.push(...records);
        }
        combined = compactPipelineRecords(found, form.limit);
        state.combined = combined;
      }
      if (!combined.length) stopAt(run.rows.at(-1), "检索没有返回记录，未进入下载或写入阶段。", ["所选检索来源都没有返回记录。请调整研究主题或检索来源后重新运行。"]);
      let deduped = { manifest: state.dedupe };
      if (shouldRun("dedupe")) {
        deduped = await stage(find("reference-export-dedupe"), JSON.stringify({ records: combined }));
        state.dedupe = asRecord(asRecord(deduped).manifest);
        state.catalogPath = str(asRecord(state.dedupe).catalog_path) || "literature/exports/retrieved-literature.md";
      }
      run.catalogPath = str(state.catalogPath) || (combined.length ? "literature/exports/retrieved-literature.md" : "");
      let pdfPaths = asArray(state.downloadedPaths).map(str).filter(Boolean);
      let downloadAttempts = asArray(state.results5);
      if (shouldRun("download")) {
        const download = await stage(find("paper-downloader"), JSON.stringify({ records: combined, headless: true, browser_workers: 1 }));
        const downloadRow = run.rows.at(-1);
        pdfPaths = manifestPdfPaths(download);
        const downloadManifest = asRecord(asRecord(download).manifest);
        downloadAttempts = asArray(downloadManifest.results);
        const manualQueue = buildManualDownloadQueue(combined, downloadAttempts).map((item) => ({
          ...item,
          pipelineRunId: run.historyId,
          workspace: run.workspace
        }));
        Object.assign(state, {
          results5: downloadAttempts,
          downloadedPaths: pdfPaths,
          downloadedCount: pdfPaths.length,
          manualQueue,
          catalogPath: str(downloadManifest.catalog_path) || run.catalogPath || "literature/exports/retrieved-literature.md"
        });
        run.catalogPath = str(state.catalogPath);
        run.manualQueue = manualQueue;
        if (ctx.publishManualDownloads && manualQueue.length) {
          try {
            const published = await ctx.publishManualDownloads(manualQueue, { append: true, open: false });
            run.rows.push({
              title: "第 5.5 步 · 转入手动批量下载",
              detail: `${published} 篇自动下载未成功的文献已加入“文献订阅 → 待手动下载”。`,
              state: "done"
            });
          } catch (error) {
            run.rows.push({
              title: "第 5.5 步 · 转入手动批量下载",
              detail: `导入队列失败：${messageOf(error)}。文献表格和历史记录仍已保留，可稍后重新导入。`,
              state: "error"
            });
            ctx.notice(`手动下载队列导入失败：${messageOf(error)}`, "info");
          }
          emit();
        }
        await saveState();
        await checkpoint({ status: "running", resumeStepId: "download", resumeStepIndex: stepIndex("download") });
        if (!pdfPaths.length) {
          const stopped = downloadGateStop(download);
          stopAt(downloadRow, stopped.reason, [...stopped.lines]);
        }
      }
      run.manualQueue = asArray(state.manualQueue).map(asRecord);
      if (!pdfPaths.length) stopAt(run.rows.at(-1), "断点状态缺少本轮 PDF 清单，不能继续运行。", ["请从第 5 步或更早重新运行 Pipeline。"]);
      let reader = { manifest: { cards: state.cards6, card_count: asArray(state.cards6).length } };
      if (shouldRun("nature-reader")) {
        reader = await stage(find("nature-reader"), JSON.stringify({ pdf_paths: pdfPaths }));
        state.cards6 = asArray(asRecord(asRecord(reader).manifest).cards);
      }
      const usableCards = asArray(state.cards6).filter((value) => {
        const card = asRecord(value);
        const claims = asArray(card.claim_candidates).map(str).filter(Boolean);
        return card.evidence_tier !== "unreadable_pdf" && claims.some((claim) => !/^\s*%PDF-/i.test(claim) && claim.length >= 80);
      });
      if (!usableCards.length) {
        stopAt(run.rows.at(-1), "PDF 没有提取出可用正文；已阻止空证据继续生成图谱和写作。", [
          "本轮 PDF 均未产生可核验的正文摘录。请检查 PDF 是否为扫描件、加密文件或损坏文件，再从第 6 步重试。"
        ]);
      }
      if (shouldRun("obsidian-bases")) await stage(find("obsidian-bases"), "");
      if (shouldRun("knowledge-graph")) {
        setStatus("正在让 Agent 从本轮证据卡片抽取语义图谱");
        const extracted = await ctx.askAgent(buildExtractionPrompt({ question: form.topic, cards: usableCards }), { timeoutMs: 24e4 });
        const answerText = extracted.ok ? extracted.text : failGraph(`知识图谱语义抽取失败：${extracted.error}。可在步骤页从断点继续。`);
        const graph = (() => {
          try {
            return parseGraphReply(answerText);
          } catch (error) {
            return failGraph(`Agent 返回的知识图谱格式无法解析：${error instanceof Error ? error.message : String(error)}。可在步骤页从断点继续。`);
          }
        })();
        if (!graph.nodes.length || !graph.edges.length) {
          failGraph("Agent 返回了空知识图谱；未写入空图。请确认本轮 PDF 与主题相关，再在步骤页从断点继续。");
        }
        const renderedGraph = await stage(find("zrl-knowledge-graph"), JSON.stringify({
          title: `${form.topic.slice(0, 80)} · 知识图谱`,
          research_question: form.topic,
          card_source_paths: pdfPaths,
          graph
        }));
        const graphManifest = asRecord(asRecord(renderedGraph).manifest);
        const nodeCount = Number(graphManifest.nodes ?? 0) || 0;
        const edgeCount = Number(graphManifest.edges ?? 0) || 0;
        if (!nodeCount || !edgeCount) {
          failGraph(`知识图谱渲染结果为空（节点 ${nodeCount}、关系 ${edgeCount}）；未把空图当作成功。可在步骤页从断点继续。`);
        }
        Object.assign(state, { step9: graphManifest, graph9: graphManifest.graph, warningCount9: asArray(graphManifest.warnings).length });
      }
      if (shouldRun("deep-research")) await stage(find("deep-research"), JSON.stringify({ card_source_paths: pdfPaths }));
      if (shouldRun("nature-writing")) await stage(find("nature-writing"), "");
      if (shouldRun("nature-polishing")) await stage(find("nature-polishing"), "");
      const cardCount = Number(asRecord(asRecord(reader).manifest).card_count ?? 0) || 0;
      const dedupedCount = asRecord(asRecord(deduped).manifest).deduped_records;
      const tracked = trackedOutputs(outputs);
      await checkpoint({ status: "completed", outcome: "completed", artifacts: { downloadedPaths: pdfPaths } });
      const lines = [
        `检索式：${query}`,
        `候选文献 ${combined.length} 条 → 去重后 ${typeof dedupedCount === "number" ? dedupedCount : "未知"} 条`,
        `本轮 PDF：${pdfPaths.length}/${combined.length} 篇；待手动下载：${run.manualQueue?.length ?? 0} 篇；证据卡：${cardCount} 张`,
        `Obsidian 文献表格：${run.catalogPath || "literature/exports/retrieved-literature.md"}`,
        `运行历史：${run.historyId}`,
        "手稿仍需核验证据、补写讨论与结论后才能作为最终稿。"
      ];
      finish(run, "done", "Pipeline 已完成，等待确认保留或撤销", {
        kind: "completed",
        title: "Pipeline 运行完成",
        lines,
        tracked,
        summary: `原生 Pipeline 已完成。主题：${form.topic}
候选文献：${combined.length} 条；本轮 PDF：${pdfPaths.length} 篇；待手动下载：${run.manualQueue?.length ?? 0} 篇；证据卡：${cardCount} 张。
文献表格：${run.catalogPath || "literature/exports/retrieved-literature.md"}
运行历史：${run.historyId}`
      });
    } catch (error) {
      if (error instanceof PipelineStop) {
        await checkpoint({ status: "stopped", outcome: "stop", stopReason: error.reason });
        return finish(run, "stopped", error.reason, { kind: "stopped", title: "Pipeline 已安全停止", lines: [...error.lines, "这是质量门的安全停止，不提供续跑。"] });
      }
      const pending = [...run.rows].reverse().find((row) => row.state === "pending");
      if (run.stopRequested) {
        if (pending) {
          pending.state = "stopped";
          pending.detail = "已由用户取消；该步骤和后续步骤均未继续执行。";
        }
        await checkpoint({ status: "cancelled", outcome: "fail", failureMessage: "用户取消" });
        return finish(run, "stopped", "已取消", { kind: "cancelled", title: "Pipeline 已取消", lines: ["已由用户取消；该步骤和后续步骤均未继续执行。已经写入的文件保持不变。"] });
      }
      const message = messageOf(error);
      if (pending) {
        pending.state = "error";
        pending.detail = `本步失败：${message}`;
      }
      await checkpoint({ status: "failed", outcome: "fail", failureMessage: message });
      finish(run, "error", message, { kind: "failed", title: "Pipeline 运行失败", lines: [message, `运行历史：${run.historyId}`] });
      ctx.notice(`Pipeline 运行失败：${message}`);
    }
  }
  function finish(run, status, statusText, outcome) {
    run.status = status;
    run.statusText = statusText;
    run.paused = false;
    run.currentSkillRunId = null;
    run.outcome = outcome;
    run.recordStatus = persistedStatus(status, run.stopRequested);
    emit();
  }
  function keepOutputs() {
    if (!active || active.outcome?.kind !== "completed" || active.review !== "open") return;
    active.review = "kept";
    active.reviewNote = "已确认保留；这些文件已经在课题工作区中，无需再做任何操作。";
    emit();
  }
  async function discardOutputs(ctx) {
    const run = active;
    if (!run || run.outcome?.kind !== "completed" || run.review !== "open") return;
    const paths = (run.outcome.tracked ?? []).flatMap((group) => group.paths);
    if (!await ctx.confirm(`将删除本次 Pipeline 写入/下载的全部 ${paths.length} 个文件（工作区外或本次运行之前已存在的文件不受影响）。此操作不可撤销，是否继续？`)) return;
    run.review = "discarding";
    run.reviewNote = "正在撤销…";
    emit();
    const result = await ctx.request(DISCARD_PATH, { method: "POST", confirmed: true, timeoutMs: 3e4, body: { workspace: run.workspace, paths } });
    if (!result.ok) {
      run.review = "open";
      run.reviewNote = `撤销失败：${result.status ?? "无响应"} ${result.error}`;
      ctx.notice(run.reviewNote);
    } else {
      const deleted = asArray(result.data?.deleted).length;
      const skipped = asArray(result.data?.skipped).length;
      run.review = "discarded";
      run.reviewNote = `已删除 ${deleted} 个文件${skipped ? `，${skipped} 个未删除（已不存在或路径异常）` : ""}。可以调整研究主题后重新运行 Pipeline。`;
    }
    emit();
  }
  var RECORD_STATUS_LABEL = Object.freeze({
    running: "运行中",
    interrupted: "已中断（无心跳）",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
    stopped: "质量门停止"
  });
  async function loadLastRun(ctx, requestedId = selectedHistoryId) {
    const listed = await ctx.request(HISTORY_PATH, { timeoutMs: 15e3 });
    if (!listed.ok) return { ok: false, error: `无法读取运行历史：${listed.status ?? "无响应"} ${listed.error}` };
    const entries = asArray(listed.data?.pipelines).map(asRecord).filter((entry) => str(entry.id));
    if (!entries.length) return { ok: true, run: null };
    const latest = requestedId ? entries.find((entry) => str(entry.id) === requestedId) : entries.sort((a, b) => str(b.startedAt).localeCompare(str(a.startedAt)))[0];
    if (!latest) return { ok: false, error: `找不到 Pipeline 历史：${requestedId}` };
    const read = await ctx.request(`${PIPELINE_RUNS_PATH}/${encodeURIComponent(str(latest.id))}`, { timeoutMs: 15e3 });
    if (!read.ok) return { ok: false, error: `无法读取 Pipeline 记录：${read.status ?? "无响应"} ${read.error}` };
    const record2 = read.data ?? {};
    const recordStatus = str(record2.status) || str(latest.status);
    const rows = asArray(record2.steps).map(asRecord).map((step) => ({
      title: str(step.title),
      detail: str(step.detail),
      state: ["pending", "done", "error", "stopped"].includes(str(step.state)) ? str(step.state) : "pending"
    })).filter((row) => row.title);
    const lines = [];
    if (str(record2.stopReason)) lines.push(`停止原因：${str(record2.stopReason)}`);
    if (str(record2.failureMessage)) lines.push(`失败原因：${str(record2.failureMessage)}`);
    const pdfs = asArray(asRecord(record2.artifacts).downloadedPaths).length;
    if (pdfs) lines.push(`本轮 PDF：${pdfs} 篇`);
    const savedState = asRecord(record2.state);
    const manualQueue = asArray(savedState.manualQueue).map(asRecord);
    const catalogPath = str(savedState.catalogPath);
    if (manualQueue.length) lines.push(`待手动下载：${manualQueue.length} 篇`);
    if (catalogPath) lines.push(`Obsidian 文献表格：${catalogPath}`);
    const status = recordStatus === "completed" ? "done" : recordStatus === "failed" || recordStatus === "interrupted" ? "error" : recordStatus === "running" ? "running" : "stopped";
    return {
      ok: true,
      run: {
        origin: "history",
        historyId: str(record2.id) || str(latest.id),
        topic: str(record2.title),
        label: str(record2.title) || "文献 Pipeline",
        status,
        statusText: RECORD_STATUS_LABEL[recordStatus] ?? recordStatus,
        paused: false,
        stopRequested: false,
        rows,
        planned: 0,
        currentSkillRunId: null,
        workspace: str(record2.workspace),
        recordStatus,
        outcome: lines.length ? { kind: status === "done" ? "completed" : status === "error" ? "failed" : "stopped", title: RECORD_STATUS_LABEL[recordStatus] ?? recordStatus, lines } : null,
        review: "kept",
        reviewNote: "",
        record: record2,
        catalogPath,
        manualQueue
      }
    };
  }

  // src/features/tools/pipeline/ui.ts
  var C = "scholarium-weaver__";
  function drawRun(root, ctx, run, options) {
    const doc = ctx.document;
    const nodes = [];
    const view = runControlView(run && run.origin === "local" ? run : null);
    const bar = el(doc, "div", { cls: `${C}tool-section`, attrs: { "data-role": "pipeline-control", role: "status", "aria-live": "polite" } });
    const statusText = run && run.origin === "history" ? `${run.label} · ${run.statusText}` : view.text;
    bar.append(el(doc, "div", { cls: `${C}tool-muted`, text: statusText, attrs: { "data-role": "pipeline-control-status" } }));
    const actions2 = el(doc, "div", { cls: `${C}tool-actions` });
    const pause = button(doc, view.pauseLabel, () => togglePause(), { "data-role": "pipeline-pause" });
    pause.disabled = view.pauseDisabled;
    const stop = button(doc, "取消本次 Pipeline", () => {
      void requestStop(ctx);
    }, { "data-role": "pipeline-stop" });
    stop.disabled = view.stopDisabled;
    actions2.append(pause, stop);
    bar.append(actions2);
    if (run && run.origin === "history") {
      const verdict2 = isResumable(run.record);
      bar.append(el(doc, "div", { cls: `${C}tool-muted`, text: verdict2.resumable ? describeResume(run.record) : `${describeResume(run.record)} 你仍可按原主题从第 1 步建立一条新运行。` }));
      const historyActions = el(doc, "div", { cls: `${C}tool-actions` });
      if (verdict2.resumable) {
        historyActions.append(button(doc, "从断点继续", () => {
          void resumePipeline(ctx, run);
        }, { "data-role": "pipeline-resume" }));
      }
      historyActions.append(button(doc, "从第 1 步重新运行", () => {
        void restartPipeline(ctx, run);
      }, { "data-role": "pipeline-restart" }));
      bar.append(historyActions);
    }
    nodes.push(bar);
    if (!run) {
      nodes.push(el(doc, "p", { cls: `${C}tool-muted`, text: options.empty, attrs: { "data-role": "pipeline-empty" } }));
      root.replaceChildren(...nodes);
      return;
    }
    const progress = progressOf(run.rows, run.planned);
    const meter = el(doc, "div", { cls: `${C}tool-section`, attrs: { "data-role": "pipeline-progress" } });
    const bar2 = el(doc, "progress", { attrs: { max: String(Math.max(1, progress.total)), value: String(progress.done), "aria-label": "Pipeline 进度" } });
    meter.append(bar2, el(doc, "span", { cls: `${C}tool-muted`, text: progress.text, attrs: { "data-role": "pipeline-progress-text" } }));
    if (run.topic) meter.append(el(doc, "div", { cls: `${C}tool-muted`, text: `主题：${run.topic}${run.historyId ? ` · 历史 ${run.historyId}` : ""}` }));
    nodes.push(meter);
    const list4 = el(doc, "ol", { cls: `${C}tool-steps`, attrs: { "data-role": "pipeline-steps" } });
    const ROW_ICON = { done: "✓", degraded: "⚠", skipped: "↷", error: "✗", stopped: "✗" };
    for (const row of run.rows) {
      const item = el(doc, "li", { cls: `${C}tool-step`, attrs: { "data-state": row.state === "pending" ? run.status === "running" ? "running" : "pending" : row.state === "stopped" ? "error" : row.state, "data-row-state": row.state } });
      const icon = ROW_ICON[row.state];
      item.append(
        el(doc, "b", { text: `${icon ? `${icon} ` : ""}${row.title}` }),
        el(doc, "div", { cls: `${C}tool-muted`, text: row.detail })
      );
      list4.append(item);
    }
    nodes.push(list4);
    const outcome = run.outcome;
    if (outcome) {
      const box = el(doc, "div", { cls: `${C}tool-section`, attrs: { "data-role": "pipeline-result", "data-kind": outcome.kind } });
      box.append(el(doc, "div", { cls: outcome.kind === "completed" && !outcome.warning ? `${C}tool-ok` : `${C}tool-error`, text: outcome.title }));
      const ul = el(doc, "ul", { cls: `${C}tool-list` });
      for (const line2 of outcome.lines) ul.append(el(doc, "li", { text: line2 }));
      box.append(ul);
      if (run.catalogPath && ctx.openVaultFile || run.manualQueue?.length && ctx.publishManualDownloads) {
        const artifacts = el(doc, "div", { cls: `${C}tool-actions`, attrs: { "data-role": "pipeline-literature-actions" } });
        if (run.catalogPath && ctx.openVaultFile) {
          const path2 = run.catalogPath;
          artifacts.append(button(doc, "打开检索文献表格", () => {
            void ctx.openVaultFile(path2).catch((error) => ctx.notice(`无法打开文献表格：${error instanceof Error ? error.message : String(error)}`));
          }, { "data-role": "pipeline-open-catalog" }));
        }
        if (run.manualQueue?.length && ctx.publishManualDownloads) {
          const queue = run.manualQueue;
          artifacts.append(button(doc, `打开 ${queue.length} 篇手动批量下载`, () => {
            void ctx.publishManualDownloads(queue, { append: true, open: true }).catch((error) => ctx.notice(`无法打开手动下载队列：${error instanceof Error ? error.message : String(error)}`));
          }, { "data-role": "pipeline-open-manual-downloads" }));
        }
        box.append(artifacts);
      }
      if (outcome.tracked && run.origin === "local") {
        const total = outcome.tracked.reduce((sum, group) => sum + group.paths.length, 0);
        box.append(el(doc, "div", { text: `本次共写入/下载 ${total} 个文件。确认保留，或整批撤销这次产出后再重跑：` }));
        const details = el(doc, "details");
        details.append(el(doc, "summary", { text: "查看本次产出清单（按步骤分组）" }));
        const groups = el(doc, "ul", { cls: `${C}tool-list`, attrs: { "data-role": "pipeline-tracked" } });
        for (const group of outcome.tracked) groups.append(el(doc, "li", { text: `${group.label}：${group.paths.length ? group.paths.join("、") : "（无）"}` }));
        details.append(groups);
        box.append(details);
        if (run.review === "open") {
          const review = el(doc, "div", { cls: `${C}tool-actions` });
          review.append(
            button(doc, "确认保留本次结果", () => keepOutputs(), { "data-role": "pipeline-keep" }),
            button(doc, "不满意，撤销本次全部产出", () => {
              void discardOutputs(ctx);
            }, { "data-role": "pipeline-discard" })
          );
          box.append(review);
        }
        if (run.reviewNote) box.append(el(doc, "div", { cls: run.review === "open" ? `${C}tool-error` : `${C}tool-muted`, text: run.reviewNote, attrs: { "data-role": "pipeline-review-note" } }));
      }
      if (options.showPostToChat && outcome.summary) {
        const summary = outcome.summary;
        const post = el(doc, "div", { cls: `${C}tool-actions` });
        post.append(button(doc, "发送结果到对话", () => {
          void ctx.postToChat(summary);
        }, { "data-role": "pipeline-post" }));
        box.append(post);
      }
      nodes.push(box);
    }
    root.replaceChildren(...nodes);
  }
  var pipelineRunTool = {
    id: "pipeline-run",
    label: "运行 Pipeline",
    title: "按 research-pipeline.json 自动执行检索式生成→检索→去重→下载→读取→笔记/图谱→综述→初稿→润色。固定流程，不读取画布节点。",
    placement: "action",
    opensRailTool: "pipeline-steps",
    requiresRuntime: true,
    render(container, ctx) {
      const doc = ctx.document;
      const formBox = el(doc, "div", { attrs: { "data-role": "pipeline-form" } });
      const runBox = el(doc, "div", { attrs: { "data-role": "pipeline-run" } });
      const intro = el(doc, "p", { cls: `${C}tool-muted`, text: "Pipeline 只会根据下面这段“检索主题”生成检索式，不会自动读取聊天框、画布节点标题或上一轮对话。每次换主题前，请在这里确认一次。" });
      const topicField = el(doc, "label", { cls: `${C}tool-field` });
      topicField.append(el(doc, "span", { text: "本次检索主题" }));
      const topic = el(doc, "textarea", { attrs: { rows: "5", "data-role": "pipeline-topic", placeholder: "材料/体系 + 关键机制 + 反应或应用场景 + 你想判断的问题" } });
      topicField.append(topic);
      const tip = el(doc, "div", { cls: `${C}tool-muted`, text: "建议写法：BiVO4 可见光催化在低效率条件下是否仍有研究价值，需要检索公开文献中的效率基线、机制证据和可改性策略。" });
      const sourcesBox = el(doc, "div", { cls: `${C}tool-section` });
      sourcesBox.append(el(doc, "div", { cls: `${C}tool-section-title`, text: "检索来源" }));
      const sourceInputs = [];
      for (const source of SEARCH_SOURCES) {
        const label = el(doc, "label");
        const input = el(doc, "input", { attrs: { type: "checkbox", "data-source": source.id } });
        input.checked = true;
        sourceInputs.push(input);
        label.append(input, el(doc, "span", { text: ` ${source.label}` }));
        sourcesBox.append(label);
      }
      const limitField = el(doc, "label", { cls: `${C}tool-field` });
      limitField.append(el(doc, "span", { text: `候选上限（${RECORDS_LIMIT_MIN}–${RECORDS_LIMIT_MAX} 条，进入去重与下载的元数据记录数）` }));
      const limit = el(doc, "input", { attrs: { type: "number", min: String(RECORDS_LIMIT_MIN), max: String(RECORDS_LIMIT_MAX), "data-role": "pipeline-limit" } });
      limit.value = String(RECORDS_LIMIT_DEFAULT);
      limitField.append(limit);
      const message = el(doc, "div", { attrs: { "data-role": "pipeline-message" } });
      const preview = el(doc, "pre", { cls: `${C}tool-pre`, attrs: { "data-role": "pipeline-preview" } });
      preview.hidden = true;
      const readForm = () => parsePipelineForm({
        topic: topic.value,
        sources: sourceInputs.filter((input) => input.checked).map((input) => input.getAttribute("data-source")),
        limit: limit.value
      });
      const actions2 = el(doc, "div", { cls: `${C}tool-actions` });
      const previewBtn = button(doc, "预览", () => {
        const parsed = readForm();
        if (!parsed.ok) {
          message.className = `${C}tool-error`;
          message.textContent = parsed.error;
          preview.hidden = true;
          return;
        }
        const workspace = ctx.scope().workspaceRoot;
        if (!workspace) {
          message.className = `${C}tool-error`;
          message.textContent = "未配置工作区路径；Pipeline 不会猜测写入位置。";
          preview.hidden = true;
          return;
        }
        message.className = `${C}tool-muted`;
        message.textContent = "请核对下面的运行预览；点击「用这个主题运行 Pipeline」后还会再请你确认一次。";
        preview.textContent = previewText(parsed.form, workspace);
        preview.hidden = false;
      }, { "data-role": "pipeline-preview-btn" });
      const runBtn = button(doc, "确认并运行 Pipeline", () => {
        const parsed = readForm();
        if (!parsed.ok) {
          message.className = `${C}tool-error`;
          message.textContent = parsed.error;
          preview.hidden = true;
          return;
        }
        if (!ctx.online()) {
          message.className = `${C}tool-error`;
          message.textContent = "运行时未连接；请先连接运行时再启动 Pipeline。";
          return;
        }
        runBtn.disabled = true;
        message.className = `${C}tool-muted`;
        message.textContent = "请在确认窗口核对主题、检索来源和工作区。";
        void launchPipeline(ctx, parsed.form).then((started) => {
          message.className = `${C}tool-muted`;
          message.textContent = started ? "Pipeline 已结束；结果与步骤见下方及右栏“步骤”。" : "没有启动 Pipeline。";
          runBtn.disabled = isRunning();
        });
      }, { "data-role": "pipeline-launch" });
      runBtn.disabled = isRunning();
      actions2.append(previewBtn, runBtn);
      formBox.append(intro, topicField, tip, sourcesBox, limitField, actions2, message, preview);
      const redraw = () => {
        const run = currentRun();
        const mine = run && run.origin === "local" ? run : null;
        runBtn.disabled = isRunning(mine);
        if (mine) drawRun(runBox, ctx, mine, { empty: "", showPostToChat: true });
        else runBox.replaceChildren();
      };
      container.replaceChildren(formBox, runBox);
      redraw();
      return subscribe(redraw);
    }
  };
  var pipelineStepsTool = {
    id: "pipeline-steps",
    label: "步骤",
    title: "文献 Pipeline 的执行步骤、进度与结果",
    placement: "rail",
    requiresRuntime: false,
    render(container, ctx) {
      const doc = ctx.document;
      const workspace = el(doc, "div", { attrs: { "data-role": "pipeline-workspace" } });
      const head = el(doc, "div", { cls: `${C}tool-actions` });
      const body = el(doc, "div", { attrs: { "data-role": "pipeline-steps-pane" } });
      const note = el(doc, "div", { attrs: { "data-role": "pipeline-history-note" } });
      let history = null;
      let loadedHistoryId = null;
      let closed = false;
      const empty = "还没有运行记录。点击「运行 Pipeline」后，每个阶段的进度与产出会实时出现在这里。";
      const redraw = () => {
        if (closed) return;
        if (currentRun()) {
          body.hidden = true;
          body.replaceChildren();
          return;
        }
        body.hidden = false;
        drawRun(body, ctx, history, { empty, showPostToChat: false });
      };
      const refresh = async () => {
        if (currentRun()) return redraw();
        if (!ctx.online()) {
          note.className = `${C}tool-muted`;
          note.textContent = "运行时未连接，暂时无法读取 Bridge 上的 Pipeline 历史。";
          return redraw();
        }
        const requested = selectedPipelineHistory();
        const loaded = await loadLastRun(ctx, requested);
        if (closed) return;
        if (!loaded.ok) {
          note.className = `${C}tool-error`;
          note.textContent = loaded.error;
        } else {
          note.className = `${C}tool-muted`;
          note.textContent = loaded.run && requested ? `已打开历史 ${loaded.run.historyId}；可在下方从断点继续或重新运行。` : "";
          history = loaded.run;
          loadedHistoryId = loaded.run?.historyId ?? null;
        }
        redraw();
      };
      head.append(button(doc, "刷新", () => {
        void refresh();
      }, { "data-role": "pipeline-refresh" }));
      container.replaceChildren(workspace, head, note, body);
      const workspaceCleanup = pipelineRunTool.render(workspace, ctx);
      redraw();
      void refresh();
      const unsubscribe = subscribe(() => {
        const selected = selectedPipelineHistory();
        if (!currentRun() && selected && selected !== loadedHistoryId) void refresh();
        else redraw();
      });
      return () => {
        closed = true;
        unsubscribe();
        if (typeof workspaceCleanup === "function") workspaceCleanup();
      };
    }
  };
  var PIPELINE_TOOLS = Object.freeze([pipelineRunTool, pipelineStepsTool]);

  // src/features/tools/query-loop/query-loop-core.ts
  var SCORE_THRESHOLD = 75;
  var MAX_CYCLES = 3;
  function extractJsonObject(raw) {
    const text6 = String(raw || "").trim();
    const fenced = text6.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text6;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] !== "{") continue;
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let j = i; j < candidate.length; j++) {
        const ch = candidate[j];
        if (inString) {
          if (escape) escape = false;
          else if (ch === "\\") escape = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(candidate.slice(i, j + 1));
            } catch {
            }
            break;
          }
        }
      }
    }
    return null;
  }
  function clip(text6, max) {
    const t = String(text6 || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }
  function replyFingerprint(text6) {
    const value = String(text6 || "");
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
  }
  function normalizeAgentReply(value) {
    if (typeof value === "string") return { text: value, taskId: null };
    if (value && typeof value === "object") {
      const v = value;
      return {
        text: typeof v.text === "string" ? v.text : String(v.output || v.result || ""),
        taskId: v.taskId || v.task_id || v.id || null
      };
    }
    return { text: String(value || ""), taskId: null };
  }
  function replyDiagnostic(reply, parseError) {
    const normalized = normalizeAgentReply(reply);
    return {
      task_id: normalized.taskId,
      parse_error: String(parseError || ""),
      reply_fingerprint: replyFingerprint(normalized.text),
      reply_length: normalized.text.length,
      reply_preview: clip(normalized.text, 600)
    };
  }
  function queryMetrics(query) {
    const text6 = String(query || "");
    let depth = 0;
    let maxDepth = 0;
    for (const ch of text6) {
      if (ch === "(") maxDepth = Math.max(maxDepth, ++depth);
      else if (ch === ")") depth = Math.max(0, depth - 1);
    }
    return {
      characters: text6.length,
      and_blocks: (text6.match(/\bAND\b/gi) || []).length + 1,
      or_terms: (text6.match(/\bOR\b/gi) || []).length,
      not_terms: (text6.match(/\bNOT\b/gi) || []).length,
      doi_literals: (text6.match(/10\.\d{4,9}\/[\w.()/:;-]+/gi) || []).length,
      max_parenthesis_depth: maxDepth
    };
  }
  function scoreQuerySimplicity(query, cycle = 1) {
    const metrics = queryMetrics(query);
    const penalties = [];
    const penalize = (points, reason) => {
      if (points > 0) penalties.push({ points, reason });
    };
    penalize(Math.min(8, Math.max(0, Math.ceil((metrics.characters - 450) / 100) * 2)), "检索式超过首轮建议的 450 字符");
    penalize(Math.min(9, Math.max(0, metrics.and_blocks - 2) * 3), "必需概念块过多，容易损失召回");
    penalize(Math.min(4, Math.max(0, Math.ceil((metrics.or_terms - 18) / 6))), "同义词扩展过密");
    penalize(metrics.not_terms ? cycle < 3 ? 6 : 2 : 0, cycle < 3 ? "过早使用 NOT" : "NOT 仍有误删风险");
    penalize(metrics.doi_literals ? 6 : 0, "把 DOI/已知标题混入主题检索；应单独做覆盖检查");
    penalize(metrics.max_parenthesis_depth > 4 ? 3 : 0, "括号嵌套过深，跨库执行和审计困难");
    const deducted = Math.min(20, penalties.reduce((sum, item) => sum + item.points, 0));
    return { score: 20 - deducted, metrics, penalties };
  }
  function buildBuilderPrompt({ topic, feedback = null, cycle = 1 }) {
    const critiqueBlock = feedback ? `
上一轮质疑者指出的问题：
${feedback.problems.map((p, i) => `${i + 1}. ${p}`).join("\n")}
质疑者的修改建议：${feedback.suggestion || "（无具体建议）"}
上一轮检索式：${feedback.query}
` : "";
    const stageRule = cycle === 1 ? "这是宽召回发现版：只保留 2–3 个真正必需的概念块，每块先用少量高价值同义词；不得加入 DOI、已知论文标题或 NOT；目标不超过 450 字符。" : cycle === 2 ? "这是诊断修订版：根据真实命中样本一次只修改一个组件（补一个缺失同义词，或收紧一个明确噪声源）；不要同时新增多个 AND 块。" : "这是最后的精度版：仅在样本证明噪声持续存在时增加 1 个上下文块；NOT 只能针对已观察到的具体噪声，并说明可能漏掉什么；目标不超过 700 字符。";
    return `你是"织研者"的检索式构建者。为下面的研究主题构建一条可审计的文献检索式（第 ${cycle} 轮，共 ${MAX_CYCLES} 轮）。

研究主题：${topic}
${critiqueBlock}
要求：
1. ${stageRule}
2. 检索式用英文，OR 只连接同一概念的替代表达，AND 只连接真正必需的概念块；查询不是越长越好。
3. 面向跨库使用（OpenAlex / PubMed / Semantic Scholar / Scopus），避免只有单一数据库支持的字段代码。
4. 主题中的多个替代反应、应用或路线必须放在同一个 OR 概念块中，不能拆成多个 AND 条件；否则会要求一篇论文同时满足所有替代路线。
5. 若用户要“寻找/筛选/确定”一个尚未知的材料、机制或第三组分，它是待发现目标，不得把一个臆测答案作为必需 AND 条件。可以用通用结构/功能词表达发现边界。
6. 不使用通配符 *、?；由确定性数据库适配器处理各库差异。若有质疑者反馈，只做反馈指定的最小改动，不得机械堆词。

只输出 JSON：
{"query":"...","rationale":"这条检索式的设计理由（中文，100 字内）"}`;
  }
  function parseBuilderReply(raw) {
    const parsed = extractJsonObject(raw);
    if (!parsed) return { ok: false, error: "构建者回复不是可解析的 JSON" };
    const query = String(parsed.query || "").trim();
    if (query.length < 3) return { ok: false, error: "构建者没有给出检索式" };
    return { ok: true, query: clip(query, 2e3), rationale: clip(parsed.rationale || "", 400) };
  }
  function buildBuilderRepairPrompt({ rawReply, parseError }) {
    return `你刚才生成的检索式没有通过机器可读格式校验。只修复输出格式，不重新设计主题，不加入新术语，也不要删除原回复中的检索概念。

校验错误：${clip(parseError, 300)}
原回复：${clip(rawReply, 3e3)}

只输出一个 JSON 对象，不加 Markdown 围栏或解释：
{"query":"原回复中的英文检索式","rationale":"原回复中的设计理由（中文，100 字内）"}`;
  }
  async function reviewBuilderWithRepair({ invoke, agentId, prompt, onRepair = () => {
  } }) {
    const firstReply = normalizeAgentReply(await invoke(agentId, prompt));
    const firstParsed = parseBuilderReply(firstReply.text);
    if (firstParsed.ok) {
      return { ...firstParsed, protocol: { status: "valid", repair_attempted: false, attempts: [replyDiagnostic(firstReply, "")] } };
    }
    onRepair({ error: firstParsed.error, taskId: firstReply.taskId });
    const repairReply = normalizeAgentReply(await invoke(agentId, buildBuilderRepairPrompt({ rawReply: firstReply.text, parseError: firstParsed.error })));
    const repaired = parseBuilderReply(repairReply.text);
    const attempts = [
      replyDiagnostic(firstReply, firstParsed.error),
      replyDiagnostic(repairReply, repaired.ok ? "" : repaired.error)
    ];
    if (repaired.ok) return { ...repaired, protocol: { status: "repaired", repair_attempted: true, attempts } };
    return {
      ok: false,
      error: `构建者格式修复后仍不合格：${repaired.error}`,
      protocol: { status: "degraded-no-query", repair_attempted: true, attempts }
    };
  }
  function buildCriticPrompt({ topic, query, records = [], cycle = 1 }) {
    const sample = records.slice(0, 15).map(
      (r, i) => `[${i + 1}] ${clip(r.title || "(无标题)", 140)}${r.publication_year || r.year ? ` (${String(r.publication_year || r.year)})` : ""}${r.source ? ` <${String(r.source)}>` : ""}`
    ).join("\n") || "（本次检索没有命中任何记录）";
    const simplicity = scoreQuerySimplicity(query, cycle);
    return `你是"织研者"的检索式质疑者。你的职责是根据真实命中样本诊断，不奖励检索式长度。

研究主题：${topic}
待评估检索式：${query}
该检索式实际命中的记录（共 ${records.length} 条，抽样前 15 条）：
${sample}

代码已计算的复杂度诊断：${JSON.stringify(simplicity)}

评分总计 100 分，必须逐项给分：
- 样本相关性 0-40：抽样标题与主题是否贴合、噪声比例；
- 发现阶段召回 0-25：是否覆盖主题的必要概念；不要因为没有塞入所有下位机制词而扣分；
- 跨库可执行性 0-15：布尔语法是否健康，是否依赖单库字段或不可移植写法；
- 简洁与渐进性 0-20：由代码固定为 ${simplicity.score} 分，禁止修改。长查询、多 AND 块、过早 NOT、把 DOI 混入查询都会扣分。

总分由程序相加，不接受一个无依据的总分。若要修订，只建议下一轮改动一个组件；已知 DOI/标题只能作为单独覆盖检查，不能 OR 进主题查询。
若主题列出多个替代反应/应用，把它们错误拆成多个 AND 块会造成系统性漏检，应在召回或可执行性中扣分。未知的待发现材料/机制不能被臆测成必需条件。

只输出 JSON：
{"score_breakdown":{"relevance":32,"recall":20,"executability":13},"problems":["具体问题1","具体问题2"],"suggestion":"下一轮只改一个组件的具体做法（中文，150 字内）"}
程序会加上 simplicity=${simplicity.score}，总分达到 ${SCORE_THRESHOLD} 即通过。`;
  }
  function buildCriticRepairPrompt({ rawReply, parseError }) {
    return `你刚才的检索式评分没有通过机器可读格式校验。只修复输出格式，不重新检索，不引入新事实，也不要改变原有判断方向。

校验错误：${clip(parseError, 300)}
原回复：${clip(rawReply, 3e3)}

把原回复映射为以下字段名。三个分数必须是数值；如果原回复用了 topic_relevance、precision、coverage、portability 等近义字段，请按含义映射到 relevance、recall、executability，并遵守上限 40/25/15。不要输出 total 或 simplicity，后者由代码计算。

只输出一个 JSON 对象，不加 Markdown 围栏或解释：
{"score_breakdown":{"relevance":32,"recall":20,"executability":13},"problems":["具体问题"],"suggestion":"下一轮只改一个组件的具体做法"}`;
  }
  function parseCriticReply(raw, { query = "", cycle = 1 } = {}) {
    const parsed = extractJsonObject(raw);
    if (!parsed) return { ok: false, error: "质疑者回复不是可解析的 JSON" };
    const parts = parsed.score_breakdown;
    if (!parts || typeof parts !== "object") return { ok: false, error: "质疑者回复缺少 score_breakdown 分项评分" };
    const bounded = (value, max) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : null;
    };
    const relevance = bounded(parts.relevance, 40);
    const recall = bounded(parts.recall, 25);
    const executability = bounded(parts.executability, 15);
    if (relevance == null || recall == null || executability == null) {
      return { ok: false, error: "score_breakdown 必须包含 relevance / recall / executability 数值" };
    }
    const complexity = scoreQuerySimplicity(query, cycle);
    const breakdown = { relevance, recall, executability, simplicity: complexity.score };
    const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
    const problems = Array.isArray(parsed.problems) ? parsed.problems.map((p) => clip(p, 200)).filter(Boolean).slice(0, 8) : [];
    const verdict2 = score >= SCORE_THRESHOLD ? "pass" : "revise";
    return { ok: true, score, verdict: verdict2, breakdown, complexity, problems, suggestion: clip(parsed.suggestion || "", 400) };
  }
  async function reviewCriticWithRepair({ invoke, agentId, prompt, query = "", cycle = 1, onRepair = () => {
  } }) {
    const firstReply = normalizeAgentReply(await invoke(agentId, prompt));
    const firstParsed = parseCriticReply(firstReply.text, { query, cycle });
    if (firstParsed.ok) {
      return { ...firstParsed, protocol: { status: "scored", repair_attempted: false, attempts: [replyDiagnostic(firstReply, "")] } };
    }
    onRepair({ error: firstParsed.error, taskId: firstReply.taskId });
    const repairReply = normalizeAgentReply(await invoke(agentId, buildCriticRepairPrompt({ rawReply: firstReply.text, parseError: firstParsed.error })));
    const repaired = parseCriticReply(repairReply.text, { query, cycle });
    const attempts = [
      replyDiagnostic(firstReply, firstParsed.error),
      replyDiagnostic(repairReply, repaired.ok ? "" : repaired.error)
    ];
    if (repaired.ok) return { ...repaired, protocol: { status: "repaired", repair_attempted: true, attempts } };
    return {
      ok: false,
      error: `质疑者格式修复后仍不合格：${repaired.error}`,
      protocol: { status: "degraded-unscored", repair_attempted: true, attempts }
    };
  }
  function decideNext({ cycle, score, maxCycles = MAX_CYCLES, threshold = SCORE_THRESHOLD }) {
    if (score >= threshold) return "accept";
    if (cycle >= maxCycles) return "exhausted";
    return "revise";
  }

  // src/features/tools/query-loop/concept-query-core.ts
  var MODES = /* @__PURE__ */ new Set(["required", "alternative", "optional"]);
  var SOURCE_QUERY_LIMITS = { openalex: 1500, pubmed: 4e3, "semantic-scholar": 1e3, scopus: 2e3 };
  function clean(value) {
    return String(value || "").trim();
  }
  function uniqueTerms(values) {
    const seen = /* @__PURE__ */ new Set();
    const terms = [];
    for (const value of Array.isArray(values) ? values : []) {
      const term = clean(value);
      const key = term.toLowerCase();
      if (!term || seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
    return terms;
  }
  function looksLikePlaceholder(block) {
    const values = [block?.block, ...block?.terms || []].map((value) => clean(value).toLowerCase()).filter(Boolean);
    return values.some(
      (value) => /^(?:x|y|z|component\s*[xyz]|[xyz]\s*component)$/.test(value) || /(?:third|additional|variable|unspecified|unknown|candidate)\s+(?:material|component|phase|dopant|catalyst)/.test(value) || /(?:placeholder|to be determined|not specified)/.test(value) || /(?:占位|待定|未指定|未知|可变|第三组分|附加组分|额外组分)/.test(value)
    );
  }
  function normalizeConceptBlock(block, index = 0) {
    const role = clean(block?.role).toLowerCase() || "process";
    let mode = clean(block?.mode || block?.query_mode).toLowerCase();
    if (!MODES.has(mode)) {
      if (role === "refinement" || block?.required_in_v0 === false || looksLikePlaceholder(block)) mode = "optional";
      else if (role === "reaction_branch" || role === "application_branch") mode = "alternative";
      else mode = "required";
    }
    if (role === "refinement" || looksLikePlaceholder(block)) mode = "optional";
    const alternativeGroup = mode === "alternative" ? clean(block?.alternative_group || block?.group || "research-branch") : "";
    return {
      ...block,
      block: clean(block?.block) || `concept-${index + 1}`,
      role,
      terms: uniqueTerms(block?.terms),
      mode,
      alternative_group: alternativeGroup,
      required_in_v0: mode !== "optional"
    };
  }
  function normalizeConceptBlocks(blocks) {
    const normalized = (Array.isArray(blocks) ? blocks : []).map((block, index) => normalizeConceptBlock(block, index)).filter((block) => block.terms.length);
    const groupCounts = /* @__PURE__ */ new Map();
    for (const block of normalized) {
      if (block.mode === "alternative") groupCounts.set(block.alternative_group, (groupCounts.get(block.alternative_group) || 0) + 1);
    }
    const warnings = [];
    for (const [group, count2] of groupCounts) {
      if (count2 < 2) warnings.push(`备选分组“${group}”只有一个分支；建议 Agent 补全其他分支。`);
    }
    return { blocks: normalized, warnings };
  }
  function quoteTerm(term) {
    const value = clean(term);
    return /\s/.test(value) && !(value.startsWith('"') && value.endsWith('"')) ? `"${value.replace(/"/g, "")}"` : value;
  }
  function blockClause(block) {
    return `(${block.terms.map(quoteTerm).join(" OR ")})`;
  }
  function groupBlocks(blocks) {
    const normalized = normalizeConceptBlocks(blocks).blocks;
    const required = normalized.filter((block) => block.mode === "required");
    const optional = normalized.filter((block) => block.mode === "optional");
    const alternatives = /* @__PURE__ */ new Map();
    for (const block of normalized.filter((item) => item.mode === "alternative")) {
      const group = block.alternative_group || "research-branch";
      if (!alternatives.has(group)) alternatives.set(group, []);
      alternatives.get(group).push(block);
    }
    return { normalized, required, optional, alternatives };
  }
  function buildBooleanPlan(blocks) {
    const grouped = groupBlocks(blocks);
    const baseParts = grouped.required.map(blockClause);
    for (const alternatives of grouped.alternatives.values()) {
      baseParts.push(`(${alternatives.map(blockClause).join(" OR ")})`);
    }
    const v0 = baseParts.join(" AND ");
    const optionalClause = grouped.optional.length ? `(${grouped.optional.map(blockClause).join(" OR ")})` : "";
    const v1 = [v0, optionalClause].filter(Boolean).join(" AND ");
    const variants = grouped.optional.map((block) => ({
      label: `refine-${block.block}`,
      query: [v0, blockClause(block)].filter(Boolean).join(" AND "),
      rationale: `Single optional refinement: ${block.block}`
    }));
    return { ...grouped, v0, v1, variants };
  }
  function fitQueryToLimit(blocks, limit = 1500) {
    const grouped = groupBlocks(blocks);
    const plan = buildBooleanPlan(blocks);
    const dropped = [];
    if (plan.v1.length <= limit) return { query: plan.v1, ok: true, dropped, degraded: false };
    dropped.push("optional 块");
    if (plan.v0.length <= limit) return { query: plan.v0, ok: true, dropped, degraded: true };
    for (const keepTerms of [6, 4, 3, 2, 1]) {
      const shrink = (block) => ({
        ...block,
        terms: [...block.terms].sort((a, b) => a.length - b.length).slice(0, keepTerms)
      });
      const parts = grouped.required.map((b) => blockClause(shrink(b)));
      for (const members of grouped.alternatives.values()) {
        parts.push(`(${members.map((b) => blockClause(shrink(b))).join(" OR ")})`);
      }
      const candidate = parts.join(" AND ");
      if (candidate.length <= limit) {
        dropped.push(`每块同义词保留 ${keepTerms} 个`);
        return { query: candidate, ok: true, dropped, degraded: true };
      }
    }
    return { query: plan.v0, ok: false, dropped, degraded: true };
  }

  // src/features/tools/query-loop/concept-matrix.ts
  function conceptMatrixPrompt(question) {
    return `你是文献检索概念分解器。把研究问题分解为概念块，用于生成布尔检索式和逐篇相关性门槛。

研究问题：${question}

规则：
1. 先识别概念之间的逻辑关系，而不是把名词平铺后全部 AND。每块必须给 mode：required / alternative / optional。
2. 只有催化剂、载体、功能材料等研究体系的核心材料才使用 role="material", mode="required"。反应底物、试剂和产物不是核心材料，禁止仅因它是化学物质就标成 material。
3. 多个并列的反应、应用或研究路线是可替代分支：每条完整路线各建一个 role="reaction_branch", mode="alternative" 的块，并填写相同 alternative_group。程序会在分支之间使用 OR；一个分支内部的底物与转化必须成对出现，例如用完整短语表达，不能把两个分支的底物拆成两个必选块。
4. 所有分支共同需要的反应条件或机理使用 role="process", mode="required"。
5. 未指定的变量/占位组分（如 X、任意第三组分）、形貌、拓扑、界面、电荷、表征和性能读数使用 role="refinement", mode="optional"，绝不能设为 required。
6. 每块给 4–12 个英文检索词，覆盖化学式、缩写、英文名和常见同义词。备选分支的 terms 应尽量使用同时包含对象与转化的完整短语。
7. 只输出一个 JSON 对象，不要输出解释或 Markdown。格式：
{"blocks":[{"block":"core catalyst","role":"material","mode":"required","alternative_group":"","terms":["..."]},{"block":"route A","role":"reaction_branch","mode":"alternative","alternative_group":"application-route","terms":["..."]},{"block":"interface descriptors","role":"refinement","mode":"optional","alternative_group":"","terms":["..."]}]}

JSON 要求：blocks 为数组；每项必须包含 block、role（material/process/refinement/reaction_branch/application_branch）、mode（required/alternative/optional）、alternative_group（alternative 时非空）和非空 terms。`;
  }
  var ROLES = /* @__PURE__ */ new Set(["material", "process", "refinement", "reaction_branch", "application_branch"]);
  var MATRIX_MODES = /* @__PURE__ */ new Set(["required", "alternative", "optional"]);
  function parseConceptMatrixReply(raw) {
    const text6 = String(raw || "").replace(/```(?:json)?/gi, "");
    let parsed = null;
    const starts = [];
    for (let i = 0; i < text6.length; i++) if (text6[i] === "{") starts.push(i);
    for (const start of starts) {
      for (let end = text6.length - 1; end > start; end--) {
        if (text6[end] !== "}") continue;
        try {
          parsed = JSON.parse(text6.slice(start, end + 1));
          break;
        } catch {
        }
      }
      if (parsed) break;
    }
    if (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length) return null;
    const blocks = [];
    for (const item of parsed.blocks.slice(0, 10)) {
      const name = String(item?.block || "").trim().slice(0, 60);
      const role = ROLES.has(item?.role) ? item.role : null;
      const mode = MATRIX_MODES.has(item?.mode) ? item.mode : null;
      const alternativeGroup = String(item?.alternative_group || "").trim().slice(0, 60);
      const terms = Array.isArray(item?.terms) ? item.terms.map((term) => String(term || "").trim()).filter(Boolean).map((term) => term.slice(0, 60)).slice(0, 24) : [];
      if (!name || !role || !mode || !terms.length) return null;
      if (mode === "alternative" && !alternativeGroup) return null;
      blocks.push({ block: name, role, mode, alternative_group: alternativeGroup, required_in_v0: mode !== "optional", terms, notes: "Agent-generated relationship-aware concept matrix" });
    }
    return blocks.length ? normalizeConceptBlocks(blocks).blocks : null;
  }
  var ELEMENT_SYMBOLS = new Set("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" "));
  var ELEMENT_NAMES = { H: "hydrogen", He: "helium", Li: "lithium", Be: "beryllium", B: "boron", C: "carbon", N: "nitrogen", O: "oxygen", F: "fluorine", Na: "sodium", Mg: "magnesium", Al: "aluminium", Si: "silicon", P: "phosphorus", S: "sulfur", Cl: "chlorine", K: "potassium", Ca: "calcium", Sc: "scandium", Ti: "titanium", V: "vanadium", Cr: "chromium", Mn: "manganese", Fe: "iron", Co: "cobalt", Ni: "nickel", Cu: "copper", Zn: "zinc", Ga: "gallium", Ge: "germanium", As: "arsenic", Se: "selenium", Br: "bromine", Rb: "rubidium", Sr: "strontium", Y: "yttrium", Zr: "zirconium", Nb: "niobium", Mo: "molybdenum", Ru: "ruthenium", Rh: "rhodium", Pd: "palladium", Ag: "silver", Cd: "cadmium", In: "indium", Sn: "tin", Sb: "antimony", Te: "tellurium", I: "iodine", Cs: "caesium", Ba: "barium", La: "lanthanum", Ce: "cerium", Pr: "praseodymium", Nd: "neodymium", Sm: "samarium", Eu: "europium", Gd: "gadolinium", Tb: "terbium", Dy: "dysprosium", Ho: "holmium", Er: "erbium", Tm: "thulium", Yb: "ytterbium", Lu: "lutetium", Hf: "hafnium", Ta: "tantalum", W: "tungsten", Re: "rhenium", Os: "osmium", Ir: "iridium", Pt: "platinum", Au: "gold", Hg: "mercury", Tl: "thallium", Pb: "lead", Bi: "bismuth", Th: "thorium", U: "uranium" };
  var ANION_NAMES = { O: "oxide", N: "nitride", S: "sulfide", P: "phosphide", C: "carbide", F: "fluoride", Cl: "chloride", Br: "bromide", I: "iodide" };
  var ELEMENT_TOKEN_WHITELIST = /* @__PURE__ */ new Set(["Au", "Ag", "Cu", "Pt", "Pd", "Rh", "Ru", "Ir", "Os", "Fe", "Co", "Ni", "Zn", "Cd", "Al", "Mg", "Ti", "Zr", "Hf", "Sn", "Pb", "Bi", "Sb", "Cr", "Mn", "Mo", "W", "Nb", "Ta", "Ga", "Ge", "Si"]);
  var FORMULA_BLOCKLIST = /* @__PURE__ */ new Set(["H2", "O2", "N2"]);
  var COMMON_MATERIAL_ALIASES = {
    CeO2: ["ceria"],
    TiO2: ["titania"],
    ZrO2: ["zirconia"],
    Al2O3: ["alumina"],
    SiO2: ["silica"],
    Fe2O3: ["hematite"],
    Fe3O4: ["magnetite"],
    "g-C3N4": ["graphitic carbon nitride", "carbon nitride"],
    C3N4: ["graphitic carbon nitride", "carbon nitride"]
  };
  function normalizeFormulaCase(text6) {
    return String(text6 || "").replace(/[₀-₉]/g, (ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch)));
  }
  function parseFormulaToken(token) {
    let rest = token;
    const parts = [];
    while (rest.length) {
      const m = /^([A-Z][a-z]?)(\d*)/.exec(rest);
      if (!m || !ELEMENT_SYMBOLS.has(m[1])) return null;
      parts.push({ symbol: m[1], count: m[2] ? parseInt(m[2], 10) : 1 });
      rest = rest.slice(m[0].length);
    }
    return parts.length ? parts : null;
  }
  function expandFormulaAliases(formula, parts) {
    const aliases = [formula];
    for (const alias of COMMON_MATERIAL_ALIASES[formula] || []) aliases.push(alias);
    if (parts.length === 1 && ELEMENT_NAMES[parts[0].symbol]) {
      aliases.push(ELEMENT_NAMES[parts[0].symbol]);
    } else if (parts.length === 2) {
      const [first, second] = parts;
      const GREEK = ["", "mono", "di", "tri", "tetra"];
      if (ANION_NAMES[second.symbol] && ELEMENT_NAMES[first.symbol]) {
        const anion = ANION_NAMES[second.symbol];
        aliases.push(`${ELEMENT_NAMES[first.symbol]} ${anion}`);
        if (second.count >= 2 && GREEK[second.count]) aliases.push(`${ELEMENT_NAMES[first.symbol]} ${GREEK[second.count]}${anion}`);
      } else if (ANION_NAMES[first.symbol] && ELEMENT_NAMES[second.symbol]) {
        aliases.push(`${ELEMENT_NAMES[second.symbol]} ${ANION_NAMES[first.symbol]}`);
      }
    }
    return [...new Set(aliases)];
  }
  function extractMaterialBlocks(question) {
    const text6 = normalizeFormulaCase(question);
    const found = /* @__PURE__ */ new Map();
    const addMaterial = (formula, terms) => {
      if (FORMULA_BLOCKLIST.has(formula) || found.has(formula)) return;
      found.set(formula, { formula, terms });
    };
    const candidateRe = /(?<![A-Za-z])([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)+|[A-Z][a-z])(?![a-z])/g;
    for (const match of text6.matchAll(candidateRe)) {
      const token = match[1];
      if (token.length < 2) continue;
      const hasDigit = /\d/.test(token);
      if (!hasDigit && !ELEMENT_TOKEN_WHITELIST.has(token)) continue;
      const parts = parseFormulaToken(token);
      if (!parts) continue;
      addMaterial(token, expandFormulaAliases(token, parts));
    }
    for (const match of text6.matchAll(/\b((?:ZIF|UiO|UIO|MIL|MOF|HKUST|PCN|NU|CAU)-?\d{1,4}(?:-[A-Za-z0-9]+)?)/g)) {
      const code = match[1];
      addMaterial(code, [.../* @__PURE__ */ new Set([code, code.replace("-", "")])]);
    }
    if (/\bg?-?C3N4\b/i.test(text6)) {
      addMaterial("g-C3N4", ["g-C3N4", "C3N4", "graphitic carbon nitride", "carbon nitride"]);
      found.delete("C3N4");
    }
    return [...found.values()].slice(0, 8);
  }
  function normalizeTermKey(term) {
    return normalizeFormulaCase(String(term || "")).toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function ensureFormulaCoverage(blocks, question) {
    const materials = extractMaterialBlocks(question);
    const existing = /* @__PURE__ */ new Set();
    for (const block of blocks || []) {
      for (const term of block?.terms || []) existing.add(normalizeTermKey(term));
    }
    const out2 = [...blocks || []];
    const added = [];
    for (const material of materials) {
      const covered = material.terms.some((term) => existing.has(normalizeTermKey(term)));
      if (covered) continue;
      out2.push({
        block: `material-${material.formula}`,
        role: "material",
        required_in_v0: true,
        terms: material.terms,
        notes: "Deterministically extracted from the topic text (formula-coverage safety net)."
      });
      added.push(material.formula);
    }
    return { blocks: out2, added };
  }
  function compositeFormulasOf(block) {
    const text6 = [block?.block || "", ...block?.terms || []].join(" ");
    return new Set(extractMaterialBlocks(text6).map((material) => material.formula));
  }
  function demoteRedundantCompositeBlocks(blocks) {
    const list4 = [...blocks || []];
    const materialBlocks = list4.filter((block) => block?.role === "material" && block?.required_in_v0 !== false);
    const atomic = /* @__PURE__ */ new Map();
    for (const block of materialBlocks) {
      const formulas = compositeFormulasOf(block);
      if (formulas.size === 1) atomic.set([...formulas][0], block);
    }
    const demoted = [];
    const out2 = list4.map((block) => {
      if (block?.role !== "material" || block?.required_in_v0 === false) return block;
      const formulas = compositeFormulasOf(block);
      if (formulas.size < 2) return block;
      const everyPartCovered = [...formulas].every((formula) => {
        const owner = atomic.get(formula);
        return owner && owner !== block;
      });
      if (!everyPartCovered) return block;
      demoted.push({ block: block.block, formulas: [...formulas] });
      return {
        ...block,
        required_in_v0: false,
        mode: "optional",
        notes: `${block.notes || ""} 复合体系块，其组成（${[...formulas].join("、")}）已由各自的必需材料块覆盖；降为加分项以免连写形式排除三元体系与分写形式。`.trim()
      };
    });
    return { blocks: out2, demoted };
  }
  function formulaQueryClause(material) {
    return "(" + material.terms.map((term) => String(term).includes(" ") ? `"${term}"` : term).join(" OR ") + ")";
  }
  function termAtBoundary(text6, term) {
    if (term.length <= 5 && !term.includes(" ")) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text6);
    }
    return text6.includes(term);
  }
  function applyFormulaGuards(query, question) {
    const materials = extractMaterialBlocks(question);
    const qText = normalizeFormulaCase(String(query || "")).toLowerCase();
    const missing = materials.filter((material) => !material.terms.some((term) => termAtBoundary(qText, normalizeFormulaCase(term).toLowerCase())));
    if (!missing.length) return { query, injected: [] };
    const extra = missing.map(formulaQueryClause).join(" AND ");
    return { query: query ? `${query} AND ${extra}` : extra, injected: missing.map((m) => m.formula) };
  }
  function normalizeMatchText(value) {
    return String(value || "").toLowerCase().replace(/<[^>]+>/g, " ").replace(/[₀-₉]/g, (ch) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(ch))).replace(/\s+/g, " ");
  }
  function recordMatchesTerms(record2, terms) {
    const text6 = normalizeMatchText(`${record2.title || ""} ${record2.abstract || ""}`);
    const compactText = text6.replace(/[^a-z0-9]+/g, "");
    return (terms || []).some((term) => {
      const value = normalizeMatchText(String(term || "").replace(/[*?]/g, ""));
      if (!value) return false;
      if (termAtBoundary(text6, value)) return true;
      const compactTerm = value.replace(/[^a-z0-9]+/g, "");
      return compactTerm.length >= 3 && compactText.includes(compactTerm);
    });
  }
  function conceptBlockStats(records, blocks) {
    const normalized = normalizeConceptBlocks(blocks).blocks;
    const list4 = Array.isArray(records) ? records : [];
    const blockHits = normalized.map((block) => ({
      block: block.block,
      role: block.role || "",
      kind: block.mode === "alternative" ? "branch" : block.required_in_v0 === false ? "optional" : "hard",
      hits: list4.filter((record2) => recordMatchesTerms(record2, block.terms)).length
    }));
    return {
      blockHits,
      missingAbstracts: list4.filter((record2) => !String(record2.abstract || "").trim()).length
    };
  }
  function relevanceDiagnosis(relevance) {
    const hits = relevance?.blockHits || [];
    const total = relevance?.total || 0;
    if (!hits.length || !total) return "";
    const hard = hits.filter((item) => item.kind === "hard").sort((a, b) => a.hits - b.hits);
    const branches = hits.filter((item) => item.kind === "branch");
    const notes = [];
    const worst = hard[0];
    if (worst && worst.hits / total < 0.5) {
      notes.push(`必需块「${worst.block}」只命中 ${worst.hits}/${total} 条，是当前最主要的拦截点；它的同义词可能没覆盖这批文献的写法。`);
    }
    if (branches.length) {
      const best = Math.max(...branches.map((item) => item.hits));
      if (best / total < 0.2) {
        notes.push(`反应支（${branches.map((item) => item.block).join("、")}）最高只命中 ${best}/${total} 条。反应支现在只用于区分核心/外围，不再拦截记录；若你希望它更常命中，把词条从长短语拆成词组会更有效。`);
      }
    }
    const missing = relevance?.missingAbstracts || 0;
    if (missing) {
      notes.push(`本批 ${missing}/${total} 条没有摘要，只能用标题参与匹配——长词组类的概念块对这部分记录几乎必然不命中。`);
    }
    return notes.join(" ");
  }
  function pickAgents(agents) {
    const installed = (agents || []).filter((a) => a && a.installed && typeof a.id === "string" && !/-full$/.test(a.id) && a.permission !== "full");
    const find = (id) => installed.find((a) => a.id === id);
    const builder = find("codex") || installed[0] || null;
    const claude = find("claude");
    const critic = claude && builder?.id !== "claude" ? claude : builder;
    return { builder: builder?.id ?? null, critic: critic?.id ?? null, shared: Boolean(builder && critic && builder.id === critic.id) };
  }
  function sourceNote(records, sources) {
    return sources?.length ? `命中 ${records.length} 条（` + sources.map((s) => s.ok ? `${String(s.source)} ${String(s.count)}` : `${String(s.source)} 失败`).join(" · ") + "）" : `命中 ${records.length} 条`;
  }

  // src/features/tools/query-loop/query-loop-run.ts
  var Aborted = class extends Error {
  };
  async function runQueryLoop(deps) {
    const { topic, builder, critic, shared, invoke, search } = deps;
    const status = deps.onStatus ?? (() => {
    });
    const log = deps.onLog ?? (() => {
    });
    const aborted = deps.isAborted ?? (() => false);
    const history = [];
    let best = null;
    let feedback = null;
    try {
      for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
        if (aborted()) throw new Aborted("已手动中止。");
        const tag = `第 ${cycle}/${MAX_CYCLES} 轮`;
        status(`${tag}：构建者（${builder}）正在写检索式…`);
        const built = await reviewBuilderWithRepair({
          invoke,
          agentId: builder,
          prompt: buildBuilderPrompt({ topic, feedback, cycle }),
          onRepair: ({ error }) => status(`${tag}：构建者格式不合格（${error}），正在做一次纯格式修复…`)
        });
        if (!built.ok) {
          return finishError(`构建者输出不合格：${built.error}`, history, best, log, built.protocol);
        }
        status(`${tag}：多源并行检索中…`);
        const found = await search(built.query);
        const note = sourceNote(found.records, found.sources);
        if (aborted()) throw new Aborted("已手动中止。");
        status(`${tag}：质疑者（${critic}${shared ? " · 同 CLI 双角色" : ""}）正在评分…`);
        const judged = await reviewCriticWithRepair({
          invoke,
          agentId: critic,
          prompt: buildCriticPrompt({ topic, query: built.query, records: found.records, cycle }),
          query: built.query,
          cycle,
          onRepair: ({ error }) => status(`${tag}：质疑者格式不合格（${error}），正在做一次纯格式修复…`)
        });
        if (!judged.ok) {
          const failedEntry = {
            cycle,
            query: built.query,
            rationale: built.rationale,
            score: null,
            complexity: scoreQuerySimplicity(built.query, cycle),
            problems: [judged.error],
            searchNote: note,
            records: found.records,
            sources: found.sources,
            protocol: judged.protocol,
            builderProtocol: built.protocol,
            final: true
          };
          history.push(failedEntry);
          best = best ? { ...best, degraded: true } : { ...failedEntry, degraded: true };
          log(history, best);
          return {
            status: "degraded",
            history,
            best,
            protocol: judged.protocol,
            message: `已降级为待确认候选。质疑者两次未满足 JSON 契约；保留${best.score == null ? "本轮未评分" : "此前评分最高"}检索式用于人工审查，不把它标成已通过。`
          };
        }
        const entry = {
          cycle,
          query: built.query,
          rationale: built.rationale,
          score: judged.score,
          breakdown: judged.breakdown,
          complexity: judged.complexity,
          problems: judged.problems,
          suggestion: judged.suggestion,
          searchNote: note,
          records: found.records,
          sources: found.sources,
          protocol: judged.protocol,
          builderProtocol: built.protocol
        };
        history.push(entry);
        if (!best || judged.score > (best.score ?? -1)) best = { ...entry };
        log(history, best);
        const next = decideNext({ cycle, score: judged.score });
        if (next === "accept" || next === "exhausted") {
          entry.final = true;
          log(history, best);
          return {
            status: next,
            history,
            best,
            message: next === "accept" ? `达标。第 ${cycle} 轮获得 ${judged.score} 分（≥${SCORE_THRESHOLD}），循环收敛。` : `轮数用尽。${MAX_CYCLES} 轮未达 ${SCORE_THRESHOLD} 分，已取历史最佳（第 ${best.cycle} 轮，${best.score} 分）。你可以采纳，也可以带上质疑意见再跑一轮。`
          };
        }
        feedback = { problems: judged.problems, suggestion: judged.suggestion, query: built.query, breakdown: judged.breakdown };
      }
    } catch (error) {
      return finishError(error instanceof Error ? error.message : String(error), history, best, log);
    }
    return { status: "exhausted", history, best, message: "" };
  }
  function finishError(message, history, best, log, protocol) {
    if (best) log(history, best);
    return { status: "error", history, best, message, error: message, ...protocol ? { protocol } : {} };
  }

  // src/features/tools/query-loop/query-loop-tool.ts
  var SEARCH_PATH = "/v1/literature/search";
  var AGENTS_PATH = "/v1/agents";
  var C2 = "scholarium-weaver__";
  async function buildConceptMatrix(ctx, topic) {
    let blocks = [];
    let source = "Agent 语义生成";
    let note = "";
    const answer = await ctx.askAgent(conceptMatrixPrompt(topic));
    if (answer.ok) {
      const parsed = parseConceptMatrixReply(answer.text);
      if (parsed) blocks = parsed;
      else {
        source = "无 Agent 矩阵";
        note = "Agent 未返回合规的概念矩阵（输出不符合契约），只保留化学式兜底块。";
      }
    } else {
      source = "无 Agent 矩阵";
      note = `Agent 概念矩阵生成失败：${answer.error}；只保留化学式兜底块。`;
    }
    const coverage = ensureFormulaCoverage(blocks, topic);
    blocks = coverage.blocks;
    if (coverage.added.length) source += `＋化学式兜底补块（${coverage.added.join("、")}）`;
    const demotion = demoteRedundantCompositeBlocks(blocks);
    blocks = demotion.blocks;
    if (demotion.demoted.length) source += `；复合体系块已降为加分项（${demotion.demoted.map((item) => String(item.block)).join("、")}）`;
    const normalized = normalizeConceptBlocks(blocks);
    if (normalized.warnings.length) note += `${note ? " " : ""}${normalized.warnings.join(" ")}`;
    const plan = buildBooleanPlan(normalized.blocks);
    const fitted = fitQueryToLimit(normalized.blocks, SOURCE_QUERY_LIMITS.openalex);
    return { blocks: normalized.blocks, source, note, v0: plan.v0, v1: plan.v1, fitted };
  }
  function chatSummary(topic, outcome, finalQuery, guardNote) {
    const best = outcome.best;
    const head = best.score == null || best.degraded ? `**打磨检索式** · 降级候选（${best.score == null ? "未评分" : `此前最佳 ${best.score} 分`}，需人工审查）` : `**打磨检索式** · 第 ${best.cycle} 轮 · ${best.score} 分（阈值 ${SCORE_THRESHOLD}）`;
    const lines = [head, "", `研究主题：${topic}`, "", "```", finalQuery, "```"];
    if (best.rationale) lines.push("", `设计理由：${best.rationale}`);
    if (guardNote) lines.push("", guardNote);
    lines.push("", "各轮：");
    for (const entry of outcome.history) {
      lines.push(`- 第 ${entry.cycle} 轮 · ${entry.score == null ? "未评分" : `${entry.score} 分`} · ${entry.searchNote}`);
    }
    lines.push("", `结论：${outcome.message}`);
    return lines.join("\n");
  }
  function recordsOf(data) {
    const payload = asRecord(data);
    return {
      records: asArray(asRecord(payload.manifest).records),
      sources: asArray(payload.sources),
      searchId: str(payload.id)
    };
  }
  function render(container, ctx) {
    const doc = ctx.document;
    let alive2 = true;
    let busy = false;
    let aborted = false;
    let agents = null;
    let agentNote = "";
    let matrix = null;
    let outcome = null;
    let topicUsed = "";
    let finalQuery = "";
    let guardNote = "";
    const intro = el(doc, "div", { cls: `${C2}tool-section` });
    const topicField = el(doc, "label", { cls: `${C2}tool-field` });
    topicField.append(el(doc, "span", { cls: `${C2}tool-section-title`, text: "研究主题" }));
    const topic = el(doc, "textarea", { attrs: { rows: "3", "data-role": "ql-topic", placeholder: "例如：双波长光热耦合调控等离子体半导体的 CO2 还原动力学" } });
    topicField.append(topic);
    const agentLine = el(doc, "p", { cls: `${C2}tool-muted`, text: "构建者 / 质疑者：连接 Bridge 后自动分配。", attrs: { "data-role": "ql-agents" } });
    const rules = el(doc, "p", {
      cls: `${C2}tool-muted`,
      text: `由简到繁：首轮只保留必要概念块，后续根据真实命中一次只改一个组件。评分公开为相关性 40 + 召回 25 + 跨库可执行性 15 + 代码计算的简洁度 20；达到 ${SCORE_THRESHOLD} 分即停止，最多 ${MAX_CYCLES} 轮。DOI/已知标题只做覆盖检查，不混入主题检索式。`
    });
    const conceptLabel = el(doc, "label", { cls: `${C2}tool-muted` });
    const conceptBox = el(doc, "input", { attrs: { type: "checkbox", "data-role": "ql-concepts" } });
    conceptBox.checked = true;
    conceptLabel.append(conceptBox, el(doc, "span", { text: " 先做概念分解（Agent 概念矩阵 + 化学式兜底），用于逐轮命中诊断" }));
    intro.append(topicField, agentLine, rules, conceptLabel);
    const status = el(doc, "div", { cls: `${C2}tool-muted`, attrs: { "data-role": "ql-status", "aria-live": "polite" } });
    const matrixBox = el(doc, "div", { cls: `${C2}tool-section`, attrs: { "data-role": "ql-matrix" } });
    matrixBox.hidden = true;
    const results = el(doc, "div", { cls: `${C2}tool-section`, attrs: { "data-role": "ql-results" } });
    results.hidden = true;
    const finalBox = el(doc, "div", { cls: `${C2}tool-section`, attrs: { "data-role": "ql-final" } });
    finalBox.hidden = true;
    const actions2 = el(doc, "div", { cls: `${C2}tool-actions` });
    const runBtn = button(doc, "开始打磨", () => {
      void run();
    }, { "data-role": "ql-run" });
    const abortBtn = button(doc, "中止循环", () => {
      aborted = true;
      setStatus("将在当前步骤结束后中止…");
    }, { "data-role": "ql-abort" });
    const fillBtn = button(doc, "用作检索主题（填入输入框）", () => fill(), { "data-role": "ql-fill" });
    const postBtn = button(doc, "发到对话", () => {
      void post();
    }, { "data-role": "ql-post" });
    actions2.append(runBtn, abortBtn, fillBtn, postBtn);
    container.replaceChildren(intro, actions2, status, matrixBox, results, finalBox);
    setPhase("input");
    void loadAgents();
    function setStatus(text6, kind = "") {
      status.className = kind === "error" ? `${C2}tool-error` : kind === "ok" ? `${C2}tool-ok` : `${C2}tool-muted`;
      status.textContent = text6;
    }
    function setPhase(phase) {
      runBtn.hidden = phase === "running";
      runBtn.textContent = phase === "done" ? "重新打磨" : "开始打磨";
      abortBtn.hidden = phase !== "running";
      fillBtn.hidden = phase !== "done";
      postBtn.hidden = phase !== "done";
      runBtn.disabled = busy;
      fillBtn.disabled = busy;
      postBtn.disabled = busy;
      topic.disabled = busy;
      conceptBox.disabled = busy;
    }
    async function loadAgents() {
      if (!ctx.online()) return false;
      const answer = await ctx.request(AGENTS_PATH, { method: "GET" });
      if (!alive2) return false;
      if (answer.ok) {
        agents = pickAgents(asArray(asRecord(answer.data).agents));
        agentNote = "";
      } else {
        const selected = ctx.scope().agentId;
        agents = selected ? { builder: selected, critic: selected, shared: true } : { builder: null, critic: null, shared: false };
        agentNote = `无法读取 Agent 列表（${answer.status ?? "无响应"}：${answer.error}）；使用当前选择的 Agent。`;
      }
      agentLine.textContent = agents.builder ? `构建者：${agents.builder} · 质疑者：${agents.critic}${agents.shared ? "（同一 CLI 分饰两角；安装第二个 CLI 后自动变为真·双 Agent）" : ""}${agentNote ? ` ${agentNote}` : ""}` : "未检测到已安装的 Agent CLI。";
      return true;
    }
    async function search(query) {
      const workspace = ctx.scope().workspaceRoot;
      const answer = await ctx.request(SEARCH_PATH, {
        method: "POST",
        body: workspace ? { workspace, query } : { query },
        timeoutMs: 24e4
      });
      if (!answer.ok) throw new Error(`文献检索失败（${answer.status ?? "无响应"}）：${answer.error}`);
      return recordsOf(answer.data);
    }
    async function invoke(agentId, prompt) {
      const answer = await ctx.askAgent(prompt, { agentId });
      if (!answer.ok) throw new Error(`Agent（${agentId}）任务失败：${answer.error}`);
      return { text: answer.text, taskId: answer.taskId };
    }
    async function run() {
      if (busy) return;
      const text6 = topic.value.trim();
      if (!text6) {
        setStatus("请先写明研究主题。", "error");
        return;
      }
      if (!ctx.online()) {
        setStatus("Bridge 未连接。", "error");
        return;
      }
      if (!agents) await loadAgents();
      if (!alive2) return;
      if (!agents?.builder || !agents.critic) {
        setStatus("没有可用的已安装 Agent CLI。", "error");
        return;
      }
      busy = true;
      aborted = false;
      outcome = null;
      matrix = null;
      finalQuery = "";
      guardNote = "";
      topicUsed = text6;
      results.replaceChildren();
      results.hidden = true;
      matrixBox.replaceChildren();
      matrixBox.hidden = true;
      finalBox.replaceChildren();
      finalBox.hidden = true;
      setPhase("running");
      try {
        if (conceptBox.checked) {
          setStatus("概念分解：Agent 正在生成概念矩阵…");
          matrix = await buildConceptMatrix(ctx, text6);
          if (!alive2) return;
          drawMatrix(matrix);
        }
        const { builder, critic, shared } = agents;
        outcome = await runQueryLoop({
          topic: text6,
          builder,
          critic,
          shared,
          invoke,
          search,
          isAborted: () => aborted || !alive2,
          onStatus: (line2) => {
            if (alive2) setStatus(line2);
          },
          onLog: (history, best) => {
            if (alive2) drawLog(history, best);
          }
        });
      } catch (error) {
        outcome = { status: "error", history: [], best: null, message: messageOf(error), error: messageOf(error) };
      }
      if (!alive2) return;
      busy = false;
      const done = outcome;
      setStatus(done.message, done.status === "accept" ? "ok" : done.status === "error" || done.status === "degraded" ? "error" : "");
      if (done.best) {
        drawLog(done.history, done.best);
        drawFinal(done);
        setPhase("done");
      } else {
        setPhase("input");
      }
    }
    function drawMatrix(value) {
      const title = el(doc, "div", { cls: `${C2}tool-section-title`, text: `概念矩阵 · ${value.blocks.length} 个概念块（来源：${value.source}）` });
      const list4 = el(doc, "ul", { cls: `${C2}tool-list` });
      for (const block of value.blocks) {
        const item = el(doc, "li", { cls: `${C2}tool-item` });
        const kind = block.mode === "alternative" ? `备选分支 · ${block.alternative_group}` : block.mode === "optional" ? "加分项" : "必需";
        item.append(el(doc, "b", { text: block.block }), el(doc, "span", { cls: `${C2}tool-muted`, text: ` ${block.role} · ${kind}` }), el(doc, "div", { cls: `${C2}tool-muted`, text: block.terms.join(" · ") }));
        list4.append(item);
      }
      const parts = [title];
      if (value.note) parts.push(el(doc, "div", { cls: `${C2}tool-muted`, text: value.note }));
      parts.push(list4);
      if (value.v0) {
        parts.push(el(doc, "div", { cls: `${C2}tool-muted`, text: "确定性草稿 v0（仅作对照，打磨仍由构建者从主题出发）：" }));
        parts.push(el(doc, "pre", { cls: `${C2}tool-pre`, text: value.v0, attrs: { "data-role": "ql-v0" } }));
        if (value.fitted.degraded) {
          parts.push(el(doc, "div", {
            cls: `${C2}tool-muted`,
            text: value.fitted.ok ? `v1 ${value.v1.length} 字符超出 OpenAlex ${SOURCE_QUERY_LIMITS.openalex} 上限，可降级：${value.fitted.dropped.join("、")}` : `概念矩阵过大，无法压进 OpenAlex ${SOURCE_QUERY_LIMITS.openalex} 字符上限。`
          }));
        }
      }
      matrixBox.replaceChildren(...parts);
      matrixBox.hidden = false;
    }
    function cycleCard(entry) {
      const card = el(doc, "li", { cls: `${C2}tool-item${entry.final ? " is-active" : ""}`, attrs: { "data-role": "ql-cycle", "data-cycle": String(entry.cycle) } });
      const pass = entry.score != null && entry.score >= SCORE_THRESHOLD;
      const head = el(doc, "div");
      head.append(
        el(doc, "b", { text: `第 ${entry.cycle} 轮 ` }),
        el(doc, "span", { cls: pass ? `${C2}tool-ok` : `${C2}tool-error`, text: entry.score == null ? "未评分" : `${entry.score} 分`, attrs: { "data-role": "ql-score" } })
      );
      card.append(head, el(doc, "pre", { cls: `${C2}tool-pre`, text: entry.query, attrs: { "data-role": "ql-query" } }));
      if (entry.rationale) card.append(el(doc, "div", { text: entry.rationale }));
      const b = entry.breakdown;
      if (b) card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: `评分：相关性 ${b.relevance}/40 · 召回 ${b.recall}/25 · 可执行性 ${b.executability}/15 · 简洁度 ${b.simplicity}/20` }));
      const penalties = entry.complexity?.penalties ?? [];
      if (penalties.length) card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: `复杂度扣分：${penalties.map((item) => `${item.reason} -${item.points}`).join("；")}` }));
      card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: entry.searchNote }));
      for (const source of entry.sources) {
        if (!source.ok && source.error) card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: `${String(source.source)}：${String(source.error)}` }));
      }
      if (entry.protocol?.repair_attempted) {
        card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: `协议恢复：${entry.protocol.status === "repaired" ? "已通过一次纯格式修复恢复评分" : "格式修复仍失败，本轮不得视为已评分"}` }));
      }
      if (matrix && matrix.blocks.length && entry.records.length) {
        const stats = conceptBlockStats(entry.records, matrix.blocks);
        const line2 = stats.blockHits.map((item) => `${item.block} ${item.hits}/${entry.records.length}`).join(" · ");
        card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: `概念块命中：${line2}`, attrs: { "data-role": "ql-block-hits" } }));
        const diagnosis = relevanceDiagnosis({ ...stats, total: entry.records.length });
        if (diagnosis) card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: diagnosis }));
      }
      if (entry.problems.length) {
        const problems = el(doc, "ul");
        for (const problem of entry.problems) problems.append(el(doc, "li", { text: problem }));
        card.append(problems);
      }
      if (entry.suggestion && !entry.final) card.append(el(doc, "div", { cls: `${C2}tool-muted`, text: `修改建议：${entry.suggestion}` }));
      if (entry.records.length) {
        const details = el(doc, "details");
        details.append(el(doc, "summary", { text: `命中样本（前 ${Math.min(15, entry.records.length)} 条，质疑者看到的就是这些）` }));
        const list4 = el(doc, "ol", { attrs: { "data-role": "ql-hits" } });
        for (const record2 of entry.records.slice(0, 15)) {
          const r = asRecord(record2);
          const year = str(r.publication_year) || str(r.year);
          list4.append(el(doc, "li", { text: `${str(r.title) || "(无标题)"}${year ? ` (${year})` : ""}${str(r.source) ? ` <${str(r.source)}>` : ""}` }));
        }
        details.append(list4);
        card.append(details);
      }
      return card;
    }
    function drawLog(history, _best) {
      const list4 = el(doc, "ol", { cls: `${C2}tool-list` });
      for (const entry of history) list4.append(cycleCard(entry));
      results.replaceChildren(el(doc, "div", { cls: `${C2}tool-section-title`, text: "打磨记录" }), list4);
      results.hidden = false;
    }
    function drawFinal(done) {
      const best = done.best;
      finalQuery = best.query;
      guardNote = "";
      const label = best.score == null ? "未评分 · 降级候选" : `${best.score} 分${best.degraded ? " · 降级候选" : ""}`;
      const pre = el(doc, "pre", { cls: `${C2}tool-pre`, text: finalQuery, attrs: { "data-role": "ql-final-query" } });
      const parts = [el(doc, "div", { cls: `${C2}tool-section-title`, text: `最终检索式（第 ${best.cycle} 轮，${label}）` }), pre];
      const guarded = applyFormulaGuards(finalQuery, topicUsed);
      if (guarded.injected.length) {
        const warn = el(doc, "div", { cls: `${C2}tool-error`, attrs: { "data-role": "ql-guard-note" }, text: `质量门：课题中的 ${guarded.injected.join("、")} 未出现在检索式中。` });
        const guardBtn = button(doc, `把 ${guarded.injected.join("、")} AND 回检索式`, () => {
          finalQuery = guarded.query;
          guardNote = `质量门：课题中的 ${guarded.injected.join("、")} 未出现在 Agent 检索式中，已按研究者确认 AND 回去。`;
          pre.textContent = finalQuery;
          warn.textContent = guardNote;
          warn.className = `${C2}tool-muted`;
          guardBtn.remove();
        }, { "data-role": "ql-guard" });
        parts.push(warn, guardBtn);
      }
      finalBox.replaceChildren(...parts);
      finalBox.hidden = false;
    }
    function fill() {
      if (!outcome?.best || !finalQuery) return;
      ctx.fillComposer(finalQuery);
      const best = outcome.best;
      ctx.notice(best.score == null || best.degraded ? "已将未评分的降级检索式填入输入框；请先人工审查。" : `已将最终检索式（${best.score} 分）填入输入框。`, "info");
    }
    async function post() {
      if (!outcome?.best || !finalQuery || busy) return;
      const best = outcome.best;
      const degraded = best.score == null || Boolean(best.degraded);
      const ok2 = await ctx.confirm(degraded ? "把这条未通过评分的降级检索式写入当前对话？它会保存到库里的对话记录，请先人工审查。" : `把最终检索式（第 ${best.cycle} 轮，${best.score} 分）写入当前对话？它会保存到库里的对话记录。`);
      if (!ok2 || !alive2) return;
      busy = true;
      setPhase("done");
      try {
        await ctx.postToChat(chatSummary(topicUsed, outcome, finalQuery, guardNote));
      } catch (error) {
        ctx.notice(`没能写入对话：${messageOf(error)}`, "error");
      } finally {
        busy = false;
        if (alive2) setPhase("done");
      }
    }
    return () => {
      alive2 = false;
      aborted = true;
    };
  }
  var queryLoopTool = {
    id: "query-loop",
    label: "打磨检索式",
    title: "由简到繁：一个 Agent 构建，另一个按相关性、召回、可执行性与代码计算的简洁度分项评分；最多 3 轮，每轮只改一个组件",
    placement: "action",
    requiresRuntime: true,
    render
  };

  // src/features/tools/idea/idea-core.ts
  var MAX_QUESTIONS = 6;
  var MAX_HYPOTHESES = 6;
  var MAX_STATEMENT = 120;
  var MAX_HOTSPOTS = 6;
  var MAX_GAPS = 6;
  var MAX_SHORT_ITEM = 80;
  var MAX_KEY_PAPERS = 8;
  function extractJsonObject2(raw) {
    const text6 = String(raw || "").trim();
    const fenced = text6.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text6;
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  function clip2(text6, max) {
    const t = String(text6 || "").replace(/\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max - 1) + "…" : t;
  }
  function recordLine(record2, index) {
    const bits = [
      `[${index + 1}]`,
      clip2(record2.title || "(无标题)", 140),
      record2.publication_year || record2.year || "",
      record2.doi ? `doi:${record2.doi}` : "",
      record2.is_oa ? "OA" : ""
    ].filter(Boolean);
    return bits.join(" ");
  }
  function buildIdeaPrompt({ topic, records = [], corpus = [] }) {
    const list4 = records.map(recordLine).join("\n") || "（没有检索到记录）";
    const corpusBlock = corpus.length ? `
研究员自己的文献库中命中的相关片段（编号 [C1]…，可信度高于在线元数据，可用作依据）：
${corpus.map((c, i) => `[C${i + 1}] ${clip2(c.snippet || "", 260)}（来源：${c.source}${c.heading ? `#${c.heading}` : ""}）`).join("\n")}
` : "";
    return `你是"织研者"的 Idea 模式引擎。研究员给出一个感兴趣的主题，并附上一组刚刚从开放文献库真实检索到的记录。你的任务是基于这些记录做一次快速侦察式综合。

主题：${topic}

实际检索到的记录（编号 [n] 之后复述时只能用这些编号引用）：
${list4}
${corpusBlock}
严格规则：
1. 只能基于上面列出的记录与文献库片段发言；不得虚构文献、作者、年份、DOI 或数据。没有直接依据的判断标为"推测"。
2. 总结不超过 250 字：这个领域的研究现状、主流路线、明显分歧或空白。
3. 列出 ${MAX_HOTSPOTS} 个以内研究热点聚类（hotspots）：每条不超过 ${MAX_SHORT_ITEM / 2} 字的短语，不是句子。
4. 列出 ${MAX_GAPS} 个以内明显的空白点（gaps）：这个领域目前缺什么，同样是短语级别。
5. 提出 ${MAX_QUESTIONS} 个以内值得追的科学问题（question）：要具体、可证伪、与该主题直接相关。
6. 提出 ${MAX_HYPOTHESES} 个以内可检验的假设（hypothesis）：每条写清陈述和提出理由（rationale），理由里用 [n] 引用检索记录${corpus.length ? "、用 [Cn] 引用文献库片段" : ""}。
7. 所有输出用中文。

只输出 JSON（不要加 Markdown 代码块以外的任何东西）：
{"summary":"...","hotspots":["...","..."],"gaps":["...","..."],"questions":[{"statement":"...","why":"..."}],"hypotheses":[{"statement":"...","rationale":"... 依据 ${corpus.length ? "[1][C1]" : "[1][3]"}"}]}`;
  }
  function parseIdeaReply(raw, opts = {}) {
    const maxQ = opts.maxQuestions || MAX_QUESTIONS;
    const maxH = opts.maxHypotheses || MAX_HYPOTHESES;
    const parsed = extractJsonObject2(raw);
    if (!parsed) return { ok: false, error: "Agent 回复不是可解析的 JSON" };
    const summary = String(parsed.summary || "").trim();
    if (!summary) return { ok: false, error: "回复缺少 summary 字段" };
    const dropped = [];
    const cleanList = (value, kind, max) => {
      if (!Array.isArray(value)) return [];
      const out2 = [];
      for (const item of value) {
        if (out2.length >= max) {
          dropped.push(`${kind} 超出上限 ${max}，多余条目已丢弃`);
          break;
        }
        const statement = clip2(item?.statement, MAX_STATEMENT);
        if (!statement) {
          dropped.push(`${kind} 条目缺 statement，已丢弃`);
          continue;
        }
        out2.push({
          statement,
          note: clip2(item?.why || item?.rationale || "", 400)
        });
      }
      return out2;
    };
    const cleanShortList = (value, max) => {
      if (!Array.isArray(value)) return [];
      return value.map((item) => clip2(item, MAX_SHORT_ITEM)).filter(Boolean).slice(0, max);
    };
    const questions = cleanList(parsed.questions, "question", maxQ);
    const hypotheses = cleanList(parsed.hypotheses, "hypothesis", maxH);
    const hotspots = cleanShortList(parsed.hotspots, MAX_HOTSPOTS);
    const gaps = cleanShortList(parsed.gaps, MAX_GAPS);
    if (!questions.length && !hypotheses.length)
      return { ok: false, error: "回复里没有可用的问题或假设", dropped };
    return { ok: true, summary, hotspots, gaps, questions, hypotheses, dropped };
  }
  function sanitizeFileName(text6, max = 24) {
    return clip2(text6, max).replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "未命名";
  }
  function allocateIds(existingIds, prefix, count2) {
    let max = 0;
    for (const id of existingIds || []) {
      const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(id));
      if (m) max = Math.max(max, Number(m[1]));
    }
    return Array.from({ length: count2 }, (_, i) => `${prefix}-${String(max + i + 1).padStart(3, "0")}`);
  }
  function uuidV7(now = Date.now()) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    let stamp = BigInt(now);
    for (let i = 5; i >= 0; i--) {
      bytes[i] = Number(stamp & 255n);
      stamp >>= 8n;
    }
    bytes[6] = 112 | bytes[6] & 15;
    bytes[8] = 128 | bytes[8] & 63;
    const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function yamlQuote(value) {
    return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  function noteFrontmatter({ uid, displayId, type, statement, status, at, topic, projectUid }) {
    return [
      "---",
      `uid: ${yamlQuote(uid)}`,
      `display_id: ${yamlQuote(displayId)}`,
      "schema_version: 1",
      `type: ${yamlQuote(type)}`,
      `created_at: ${yamlQuote(at)}`,
      `updated_at: ${yamlQuote(at)}`,
      `project_uid: ${yamlQuote(projectUid)}`,
      `statement: ${yamlQuote(statement)}`,
      `status: ${yamlQuote(status)}`,
      'created_by: "ai"',
      'review_status: "pending"',
      'source: "idea-mode"',
      `idea_topic: ${yamlQuote(topic)}`,
      "---"
    ].join("\n");
  }
  function sourceSection(records) {
    if (!records.length) return "";
    const lines = records.slice(0, 10).map((r, i) => `- [${i + 1}] ${clip2(r.title || "(无标题)", 120)}${r.doi ? ` — doi:${r.doi}` : ""}`);
    return ["", "## 检索线索（仅元数据，未读全文）", "", ...lines, ""].join("\n");
  }
  function yamlList(key, items2, indent = "") {
    if (!items2.length) return `${indent}${key}: []`;
    return [`${indent}${key}:`, ...items2.map((v) => `${indent}  - ${yamlQuote(v)}`)].join("\n");
  }
  function pickKeyPapers(records, max = MAX_KEY_PAPERS) {
    return records.filter((r) => r?.doi).slice(0, max).map((r) => String(r.doi));
  }
  function buildIdeaCard({ topic, summary, hotspots = [], gaps = [], records = [], existingIds = [], at, uid }) {
    const now = at || (/* @__PURE__ */ new Date()).toISOString();
    const resolvedUid = uid || uuidV7();
    const displayId = allocateIds(existingIds, "IDEA", 1)[0];
    const keyPapers = pickKeyPapers(records);
    const frontmatter3 = [
      "---",
      `uid: ${yamlQuote(resolvedUid)}`,
      `display_id: ${yamlQuote(displayId)}`,
      "schema_version: 1",
      'type: "idea"',
      `created_at: ${yamlQuote(now)}`,
      `updated_at: ${yamlQuote(now)}`,
      `title: ${yamlQuote(topic)}`,
      'status: "exploring"',
      `summary: ${yamlQuote(summary)}`,
      yamlList("hotspots", hotspots),
      yamlList("key_papers", keyPapers),
      yamlList("gaps", gaps),
      'promoted_to: ""',
      'created_by: "ai"',
      'source: "idea-mode"',
      "---"
    ].join("\n");
    const papersSection = records.length ? sourceSection(records) : "";
    const body = `

# ${displayId} ${topic}

## 侦察总结

${summary}

${hotspots.length ? `## 研究热点

${hotspots.map((h) => `- ${h}`).join("\n")}
` : ""}
${gaps.length ? `## 明显空白点

${gaps.map((g) => `- ${g}`).join("\n")}
` : ""}
> 本卡片由 Idea 模式生成（created_by: ai），status: exploring。搁置或（M3 起）升级为课题在列表页操作。
${papersSection}`;
    return { path: `Research/Ideas/${displayId} ${sanitizeFileName(topic)}.md`, content: frontmatter3 + body, displayId };
  }
  function buildIdeaNotes({ topic, summary, questions = [], hypotheses = [], existingIds = [], records = [], at, uidFn, projectUid }) {
    if (!projectUid) throw new Error("Question/Hypothesis 草稿必须绑定正式 Project uid");
    const now = at || (/* @__PURE__ */ new Date()).toISOString();
    const uid = uidFn || (() => uuidV7());
    const items2 = [];
    const queIds = allocateIds(existingIds, "Q", questions.length);
    questions.forEach((q, i) => {
      const displayId = queIds[i];
      items2.push({
        path: `Research/Questions/${displayId} ${sanitizeFileName(q.statement)}.md`,
        content: `${noteFrontmatter({ uid: uid(), displayId, type: "question", statement: q.statement, status: "open", at: now, topic, projectUid })}

# ${displayId} ${q.statement}

${q.note ? `## 为什么值得追

${q.note}
` : ""}
## Idea 模式摘要

${summary}

> 检索主题：${topic}
> 本笔记由 Idea 模式生成（created_by: ai），等待研究者审阅（review_status: pending）。
${sourceSection(records)}`
      });
    });
    const hypIds = allocateIds(existingIds, "HYP", hypotheses.length);
    hypotheses.forEach((h, i) => {
      const displayId = hypIds[i];
      items2.push({
        path: `Research/Hypotheses/${displayId} ${sanitizeFileName(h.statement)}.md`,
        content: `${noteFrontmatter({ uid: uid(), displayId, type: "hypothesis", statement: h.statement, status: "proposed", at: now, topic, projectUid })}

# ${displayId} ${h.statement}

${h.note ? `## 提出理由

${h.note}
` : ""}
## Idea 模式摘要

${summary}

> 检索主题：${topic}
> 本笔记由 Idea 模式生成（created_by: ai），等待研究者审阅（review_status: pending）。
${sourceSection(records)}`
      });
    });
    return items2;
  }
  var IDEA_STATUS_LABEL = Object.freeze({ exploring: "探索中", promoted: "已升级", shelved: "已搁置" });
  var IDEA_FILTERS = Object.freeze([
    ["all", "全部"],
    ["exploring", "探索中"],
    ["promoted", "已升级"],
    ["shelved", "已搁置"]
  ]);
  var text = (value) => typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  var texts = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
  function ideasFromList(result) {
    const ideas = result && typeof result === "object" && Array.isArray(result.ideas) ? result.ideas : [];
    return ideas.filter((idea) => idea && typeof idea === "object").map((raw) => {
      const idea = raw;
      return {
        display_id: text(idea.display_id),
        title: text(idea.title),
        status: text(idea.status),
        summary: text(idea.summary),
        hotspots: texts(idea.hotspots),
        gaps: texts(idea.gaps),
        key_papers: texts(idea.key_papers),
        promoted_to: text(idea.promoted_to),
        path: text(idea.path)
      };
    });
  }
  function filterIdeas(ideas, filter) {
    return ideas.filter((idea) => filter === "all" || idea.status === filter);
  }
  function cardActions(idea) {
    const canToggle = idea.status === "exploring" || idea.status === "shelved";
    return {
      promote: idea.status === "exploring",
      toggleTo: canToggle ? idea.status === "shelved" ? "exploring" : "shelved" : null,
      toggleLabel: canToggle ? idea.status === "shelved" ? "重新探索" : "搁置" : ""
    };
  }
  function promotionDefaults(idea) {
    return {
      title: idea.title || "",
      research_question: idea.title || "",
      boundaries_do: (idea.hotspots || []).join("\n"),
      boundaries_dont: "",
      constraints: "",
      success_criteria: "在进入实验设计前补充可量化、可证伪的成功标准。"
    };
  }
  function profileFromForm(form) {
    const lines = (value) => value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    return {
      title: form.title.trim(),
      research_question: form.research_question.trim(),
      boundaries_do: lines(form.boundaries_do),
      boundaries_dont: lines(form.boundaries_dont),
      constraints: lines(form.constraints),
      success_criteria: form.success_criteria.trim()
    };
  }
  function missingProfileFields(profile) {
    const missing = [];
    if (!profile.title) missing.push("课题标题");
    if (!profile.research_question) missing.push("核心研究问题");
    if (!profile.success_criteria) missing.push("成功标准");
    return missing;
  }
  function promotionConfirmMessage(displayId, preview) {
    return `将执行一次原子升级：

${displayId} → ${preview?.project?.display_id}
课题：${preview?.paths?.project}
画像：${preview?.paths?.profile}

确认后会同时创建两个文件并回填 Idea；任何一步失败都会回滚。是否继续？`;
  }

  // src/features/tools/idea/idea-ui.ts
  var C3 = "scholarium-weaver__";
  var SEARCH_PATH2 = "/v1/literature/search";
  var RAG_PATH = "/v1/rag/query";
  var BATCH_PATH = "/v1/drafts/batch";
  var STATE_PATH = "/v1/scholarium/state";
  var ideasChanged = /* @__PURE__ */ new Set();
  function notifyIdeasChanged() {
    for (const listener of [...ideasChanged]) {
      try {
        listener();
      } catch {
      }
    }
  }
  function failureText(result) {
    const status = result.status === null ? "" : `HTTP ${result.status}`;
    if (!status || result.error.includes(status)) return result.error || status || "未知错误";
    return `${result.error}（${status}）`;
  }
  var BridgeError = class extends Error {
    constructor(result) {
      super(failureText(result));
      this.result = result;
    }
    result;
  };
  function unwrap(result) {
    if (!result.ok) throw new BridgeError(result);
    return result.data;
  }
  function statePath(action, input) {
    const query = new URLSearchParams({ action });
    if (input) query.set("input", JSON.stringify(input));
    return `${STATE_PATH}?${query.toString()}`;
  }
  async function stateRead(ctx, action, input) {
    const data = unwrap(await ctx.request(statePath(action, input), { timeoutMs: 3e4 }));
    return asRecord(data).result ?? null;
  }
  var ideaPath = (displayId, tail) => `/v1/ideas/${encodeURIComponent(displayId)}/${tail}`;
  var emptyState = (topic = "") => ({
    topic,
    records: [],
    summary: "",
    hotspots: [],
    gaps: [],
    questions: [],
    hypotheses: [],
    taskId: "",
    batchId: null,
    paths: []
  });
  async function collectExistingIds(ctx) {
    const ids = [];
    const list4 = asRecord(await stateRead(ctx, "project.list"));
    for (const p of asArray(list4.projects)) {
      const displayId = str(asRecord(p).display_id);
      if (!displayId) continue;
      try {
        const detail = asRecord(await stateRead(ctx, "project.get", { display_id: displayId }));
        for (const x of asArray(detail.hypotheses)) ids.push(str(asRecord(x).display_id));
        for (const x of asArray(detail.questions)) ids.push(str(asRecord(x).display_id));
      } catch {
      }
    }
    try {
      const ideaList = asRecord(await stateRead(ctx, "idea.list"));
      for (const idea of asArray(ideaList.ideas)) ids.push(str(asRecord(idea).display_id));
    } catch {
    }
    return ids.filter(Boolean);
  }
  function renderIdeaMode(container, ctx) {
    const doc = ctx.document;
    let busy = false;
    let closed = false;
    let state = emptyState();
    const section2 = el(doc, "div", { cls: `${C3}tool-section`, attrs: { "data-role": "idea-mode" } });
    const intro = el(doc, "div", {
      cls: `${C3}tool-muted`,
      text: "先用真实检索拿到记录，再让 Agent 只基于这些记录综合。产出只是草稿：问题/假设笔记全部标记 created_by: ai、review_status: pending，写入前你要逐条勾选并确认。"
    });
    const topicField = el(doc, "label", { cls: `${C3}tool-field`, text: "想侦察的主题" });
    const topicInput = el(doc, "textarea", {
      attrs: { rows: "3", "data-role": "idea-topic", placeholder: "例如：单原子光催化剂中金属-载体强相互作用对 CO2 还原选择性的影响" }
    });
    topicField.append(topicInput);
    const countField = el(doc, "label", { cls: `${C3}tool-field`, text: "检索记录上限" });
    const countSelect = el(doc, "select", { attrs: { "data-role": "idea-count" } });
    for (const [value, label] of [["10", "10 条（快）"], ["20", "20 条（均衡）"], ["30", "30 条（全面但慢）"]]) {
      const option = el(doc, "option", { text: label, attrs: { value } });
      if (value === "20") option.setAttribute("selected", "");
      countSelect.append(option);
    }
    countSelect.value = "20";
    countField.append(countSelect);
    const statusEl = el(doc, "div", { cls: `${C3}tool-muted`, attrs: { "data-role": "idea-status" } });
    const results = el(doc, "div", { cls: `${C3}tool-section`, attrs: { "data-role": "idea-results" } });
    results.hidden = true;
    const runBtn = button(doc, "开始侦察", () => {
      void runRecon();
    }, { "data-role": "idea-run" });
    const previewBtn = button(doc, "预览选中笔记", () => {
      void previewNotes();
    }, { "data-role": "idea-preview" });
    const commitBtn = button(doc, "确认写入", () => {
      void commitNotes();
    }, { "data-role": "idea-commit" });
    const backBtn = button(doc, "返回修改勾选", () => {
      state.batchId = null;
      state.paths = [];
      renderProposal([]);
      setPhase("proposal");
      setStatus("");
    }, { "data-role": "idea-back" });
    const actions2 = el(doc, "div", { cls: `${C3}tool-actions` });
    actions2.append(runBtn, previewBtn, backBtn, commitBtn);
    section2.append(intro, topicField, countField, actions2, statusEl, results);
    container.replaceChildren(section2);
    function setStatus(text6, kind = "muted") {
      statusEl.className = `${C3}tool-${kind}`;
      statusEl.textContent = text6;
    }
    let phase = "input";
    function setPhase(next) {
      phase = next;
      runBtn.hidden = false;
      previewBtn.hidden = next !== "proposal";
      backBtn.hidden = next !== "preview";
      commitBtn.hidden = next !== "preview";
      for (const b of [runBtn, previewBtn, backBtn, commitBtn]) b.disabled = busy;
      topicInput.disabled = busy;
      countSelect.disabled = busy;
    }
    setPhase("input");
    async function runRecon() {
      if (busy) return;
      const topic = String(topicInput.value || "").trim();
      if (!topic) {
        setStatus("请先写明要侦察的主题。", "error");
        return;
      }
      if (!ctx.online()) {
        setStatus("运行时未连接。先连接运行时，再开始侦察。", "error");
        return;
      }
      const limit = Number(countSelect.value) || 20;
      busy = true;
      state = emptyState(topic);
      results.hidden = true;
      results.replaceChildren();
      setPhase("input");
      try {
        setStatus("第 1/3 步：正在检索开放文献…");
        const scope = ctx.scope();
        const search = unwrap(await ctx.request(SEARCH_PATH2, {
          method: "POST",
          body: { workspace: scope.workspaceRoot, query: topic },
          timeoutMs: 18e4
        }));
        state.records = asArray(asRecord(asRecord(search).manifest).records).filter((r) => r && typeof r === "object").slice(0, limit);
        if (!state.records.length) {
          setStatus("检索没有命中任何记录，换个主题写法试试。", "error");
          return;
        }
        setStatus(`第 2/3 步：检索到 ${state.records.length} 条在线记录，正在查你的文献库…`);
        let corpus = [];
        const rag = await ctx.request(RAG_PATH, { method: "POST", body: { query: topic, k: 5 }, timeoutMs: 6e4 });
        if (rag.ok) corpus = asArray(asRecord(asRecord(rag.data).manifest).results).filter((r) => r && typeof r === "object");
        setStatus(`第 2/3 步：${state.records.length} 条在线记录 + 文献库命中 ${corpus.length} 段，Agent 正在综合（可能需要几分钟）…`);
        const answer = await ctx.askAgent(buildIdeaPrompt({ topic, records: state.records, corpus }));
        if (!answer.ok) throw new Error(answer.error);
        state.taskId = answer.taskId;
        setStatus("第 3/3 步：校验综合结果…");
        const parsed = parseIdeaReply(answer.text);
        if (!parsed.ok) {
          setStatus(`综合结果未通过校验：${parsed.error}`, "error");
          return;
        }
        state.summary = parsed.summary;
        state.hotspots = parsed.hotspots;
        state.gaps = parsed.gaps;
        state.questions = parsed.questions.map((q) => ({ ...q, checked: true }));
        state.hypotheses = parsed.hypotheses.map((h) => ({ ...h, checked: true }));
        renderProposal(parsed.dropped);
        setStatus(`综合完成：${state.questions.length} 个问题 · ${state.hypotheses.length} 条假设。勾选后要预览笔记。`);
      } catch (error) {
        setStatus(`侦察失败：${messageOf(error)}`, "error");
      } finally {
        busy = false;
        if (!closed) setPhase(results.hidden ? "input" : "proposal");
      }
    }
    function chips(list4) {
      const row = el(doc, "div", { cls: `${C3}tool-pills` });
      for (const s of list4) row.append(el(doc, "span", { cls: `${C3}tool-pill`, text: s }));
      return row;
    }
    function block(title, ...body) {
      const box = el(doc, "div", { cls: `${C3}tool-section` });
      box.append(el(doc, "div", { cls: `${C3}tool-section-title`, text: title }), ...body);
      return box;
    }
    function itemRow(kind, index, item) {
      const row = el(doc, "label", { cls: `${C3}tool-item idea-item`, attrs: { "data-role": "idea-candidate", "data-kind": kind, "data-index": String(index) } });
      const box = el(doc, "input", { attrs: { type: "checkbox", "data-kind": kind, "data-index": String(index) } });
      box.checked = item.checked;
      box.addEventListener("change", () => {
        item.checked = Boolean(box.checked);
      });
      const body = el(doc, "span", { cls: "idea-item-body" });
      body.append(el(doc, "b", { text: item.statement }));
      if (item.note) body.append(el(doc, "small", { cls: `${C3}tool-muted`, text: item.note }));
      row.append(box, body);
      return row;
    }
    function renderProposal(dropped) {
      const parts = [block("侦察总结", el(doc, "p", { text: state.summary }))];
      if (state.hotspots.length) parts.push(block("研究热点", chips(state.hotspots)));
      if (state.gaps.length) parts.push(block("明显空白点", chips(state.gaps)));
      parts.push(el(doc, "p", { cls: `${C3}tool-muted`, text: "这次综合会先落一张 Idea 卡片（可在「Idea 库」标签页浏览/搁置），下面勾选的问题/假设会作为草稿笔记一起写入。" }));
      if (dropped.length) parts.push(el(doc, "p", { cls: `${C3}tool-muted`, text: dropped.join("；") }));
      if (state.questions.length) {
        const list4 = el(doc, "div", { cls: `${C3}tool-list` });
        state.questions.forEach((item, i) => list4.append(itemRow("q", i, item)));
        parts.push(block(`候选问题（${state.questions.length}）`, list4));
      }
      if (state.hypotheses.length) {
        const list4 = el(doc, "div", { cls: `${C3}tool-list` });
        state.hypotheses.forEach((item, i) => list4.append(itemRow("h", i, item)));
        parts.push(block(`候选假设（${state.hypotheses.length}）`, list4));
      }
      results.replaceChildren(...parts);
      results.hidden = false;
    }
    function selectedItems(existingIds, projectUid) {
      const card = buildIdeaCard({
        topic: state.topic,
        summary: state.summary,
        hotspots: state.hotspots,
        gaps: state.gaps,
        records: state.records,
        existingIds,
        at: ctx.now()
      });
      const notes = buildIdeaNotes({
        topic: state.topic,
        summary: state.summary,
        questions: state.questions.filter((q) => q.checked),
        hypotheses: state.hypotheses.filter((h) => h.checked),
        existingIds: [...existingIds, card.displayId],
        records: state.records,
        projectUid,
        at: ctx.now()
      });
      return [{ path: card.path, content: card.content }, ...notes];
    }
    async function previewNotes() {
      if (busy) return;
      const projectDisplayId = String(ctx.scope().projectId || "").trim();
      if (!projectDisplayId) {
        setStatus("候选 Question/Hypothesis 必须绑定正式课题；请先给当前主题绑定 PRJ，再预览。表单内容已保留。", "error");
        return;
      }
      busy = true;
      setPhase("proposal");
      try {
        const projectData = asRecord(await stateRead(ctx, "project.get", { display_id: projectDisplayId }));
        const projectUid = str(asRecord(projectData.project).uid);
        if (!projectUid) throw new Error(`未能解析 ${projectDisplayId} 的正式 project uid`);
        setStatus("正在生成笔记预览（整批校验，任一冲突即整批拒绝）…");
        const send = async () => ctx.request(BATCH_PATH, {
          method: "POST",
          body: {
            base: "scholarium-vault",
            serverManagedMetadata: true,
            projectDisplayId,
            items: selectedItems(await collectExistingIds(ctx), projectUid),
            ...state.taskId ? { sourceTaskId: state.taskId } : {}
          }
        });
        let res = await send();
        if (!res.ok && (res.status === 409 || /already exists|409/.test(res.error))) res = await send();
        const batch = asRecord(unwrap(res));
        const batchId = str(batch.id);
        if (!batchId) throw new Error("Bridge 未返回批次 ID。");
        state.batchId = batchId;
        state.paths = asArray(batch.items).map((item) => str(asRecord(item).path)).filter(Boolean);
        const list4 = el(doc, "ul", { cls: `${C3}tool-list`, attrs: { "data-role": "idea-paths" } });
        for (const p of state.paths) list4.append(el(doc, "li", { cls: `${C3}tool-item`, text: p }));
        results.replaceChildren(block(
          `预览通过，将写入 ${state.paths.length} 个笔记：`,
          list4,
          el(doc, "p", { cls: `${C3}tool-muted`, text: "确认后整批写入（全部成功或全部不写）。写入后仍需你在笔记里逐条审阅并把 review_status 改为 confirmed。" })
        ));
        results.hidden = false;
        setStatus("预览就绪。确认写入前可以再回到上一步修改勾选。");
      } catch (error) {
        setStatus(`预览被拒绝：${messageOf(error)}`, "error");
      } finally {
        busy = false;
        if (!closed) setPhase(state.batchId ? "preview" : "proposal");
      }
    }
    async function commitNotes() {
      if (busy || !state.batchId) return;
      const batchId = state.batchId;
      const count2 = state.paths.length;
      const ok2 = await ctx.confirm(`将整批写入 ${count2} 个笔记（含 1 张 Idea 卡片）：

${state.paths.join("\n")}

全部标记 created_by: ai、review_status: pending。是否继续？`);
      if (!ok2) {
        setStatus("已取消，未写入任何文件。");
        return;
      }
      busy = true;
      setPhase("preview");
      try {
        unwrap(await ctx.request(`${BATCH_PATH}/${encodeURIComponent(batchId)}/commit`, { method: "POST" }));
        ctx.notice(`Idea 笔记已写入 ${count2} 个文件（含 1 张 Idea 卡片），等待你的审阅。`, "info");
        const topic = state.topic;
        state = emptyState(topic);
        results.hidden = true;
        results.replaceChildren();
        setStatus(`已写入 ${count2} 个文件，等待你的审阅。`, "ok");
        notifyIdeasChanged();
      } catch (error) {
        setStatus(`写入失败（整批已回滚，未留下半个批次）：${messageOf(error)}`, "error");
      } finally {
        busy = false;
        if (!closed) setPhase(state.batchId ? "preview" : "input");
      }
    }
    return () => {
      closed = true;
    };
  }
  var ideaModeTool = Object.freeze({
    id: "idea-mode",
    label: "Idea 模式",
    title: "给一个主题：检索开放文献 → Agent 综合 → 生成候选问题/假设草稿",
    placement: "action",
    requiresRuntime: true,
    render: renderIdeaMode
  });
  var PROMOTION_FIELDS = [
    ["title", "课题标题", false, ""],
    ["research_question", "核心研究问题", true, ""],
    ["boundaries_do", "研究边界：要做什么", true, "每行一项"],
    ["boundaries_dont", "研究边界：明确不做什么", true, "每行一项"],
    ["constraints", "已知约束", true, "仪器、经费、时间；每行一项"],
    ["success_criteria", "成功标准", true, ""]
  ];
  function renderIdeaLibrary(container, ctx) {
    const doc = ctx.document;
    let ideas = [];
    let activeFilter = "all";
    let loading = false;
    let closed = false;
    let promoting = null;
    const root = el(doc, "div", { cls: `${C3}tool-section`, attrs: { "data-role": "idea-library" } });
    const toolbar = el(doc, "div", { cls: `${C3}tool-actions` });
    const filters = el(doc, "div", { cls: `${C3}tool-pills`, attrs: { "data-role": "idea-filters" } });
    const pills = /* @__PURE__ */ new Map();
    for (const [value, label] of IDEA_FILTERS) {
      const pill = button(doc, label, () => {
        activeFilter = value;
        for (const [key, node2] of pills) node2.setAttribute("aria-pressed", String(key === value));
        if (ideas.length) renderCards();
      }, { "data-filter": value, "aria-pressed": String(value === "all") }, `${C3}tool-pill`);
      pills.set(value, pill);
      filters.append(pill);
    }
    const refreshBtn = button(doc, "刷新", () => {
      void refresh();
    }, { "data-role": "idea-refresh" });
    toolbar.append(filters, refreshBtn);
    const overlay = el(doc, "div", { cls: `${C3}tool-muted`, attrs: { "data-role": "idea-overlay" }, text: "还没有加载 Idea 卡片。点上方「刷新」，或先用「Idea 模式」侦察一个主题。" });
    const cards = el(doc, "div", { cls: `${C3}tool-list`, attrs: { "data-role": "idea-cards" } });
    cards.hidden = true;
    root.append(toolbar, overlay, cards);
    container.replaceChildren(root);
    function showOverlay(text6, isError = false) {
      overlay.className = isError ? `${C3}tool-error` : `${C3}tool-muted`;
      overlay.textContent = text6;
      overlay.hidden = false;
      cards.hidden = true;
    }
    function hideOverlay() {
      overlay.hidden = true;
      cards.hidden = false;
    }
    async function load() {
      if (!ctx.online()) {
        showOverlay("运行时未连接。先连接运行时，再回来刷新。");
        return;
      }
      showOverlay("正在读取 Idea 卡片…");
      try {
        ideas = ideasFromList(await stateRead(ctx, "idea.list"));
        if (closed) return;
        if (!ideas.length) {
          showOverlay("还没有 Idea 卡片。用「Idea 模式」侦察一个主题，综合完成后会在这里先落一张卡片。");
          return;
        }
        renderCards();
        hideOverlay();
      } catch (error) {
        showOverlay(`Idea 卡片读取失败：${messageOf(error)}`, true);
      }
    }
    async function refresh() {
      if (loading) return;
      loading = true;
      refreshBtn.disabled = true;
      try {
        await load();
      } finally {
        loading = false;
        refreshBtn.disabled = false;
      }
    }
    function chipRow(list4, kind) {
      const row = el(doc, "div", { cls: `${C3}tool-pills`, attrs: { "data-chips": kind } });
      for (const s of list4.slice(0, 6)) row.append(el(doc, "span", { cls: `${C3}tool-pill idea-chip-${kind}`, text: s }));
      return row;
    }
    function renderCards() {
      const visible = filterIdeas(ideas, activeFilter);
      if (!visible.length) {
        cards.replaceChildren(el(doc, "p", { cls: `${C3}tool-muted`, text: "没有符合筛选条件的 Idea 卡片。" }));
        return;
      }
      cards.replaceChildren(...visible.map(card));
    }
    function card(idea) {
      const node2 = el(doc, "article", { cls: `${C3}tool-item idea-list-card`, attrs: { "data-idea": idea.display_id, "data-status": idea.status } });
      const head = el(doc, "div", { cls: "idea-list-card-head" });
      head.append(el(doc, "b", { text: idea.title }), el(doc, "span", { cls: `idea-status-badge idea-status-${idea.status}`, text: IDEA_STATUS_LABEL[idea.status] ?? idea.status }));
      node2.append(head);
      if (idea.summary) node2.append(el(doc, "p", { cls: `${C3}tool-muted`, text: idea.summary }));
      if (idea.hotspots.length) node2.append(chipRow(idea.hotspots, "hotspot"));
      if (idea.gaps.length) node2.append(chipRow(idea.gaps, "gap"));
      if (idea.key_papers.length) node2.append(el(doc, "p", { cls: `${C3}tool-muted idea-list-card-papers`, text: `关键文献：${idea.key_papers.join(" · ")}` }));
      const foot = el(doc, "div", { cls: "idea-list-card-foot" });
      foot.append(el(doc, "span", { cls: `${C3}tool-muted`, text: `${idea.display_id} · ${idea.path}` }));
      const acts = el(doc, "span", { cls: `${C3}tool-actions` });
      const plan = cardActions(idea);
      if (plan.promote) {
        const promote = button(doc, "升级为课题", () => openPromotion(idea, node2), { "data-role": "idea-promote", "data-id": idea.display_id });
        acts.append(promote);
      } else if (idea.status === "promoted") {
        acts.append(el(doc, "span", { cls: `${C3}tool-ok`, text: idea.promoted_to || "已创建课题" }));
      }
      if (plan.toggleTo) {
        const to = plan.toggleTo;
        const toggle = button(doc, plan.toggleLabel, () => {
          void setStatus(idea.display_id, to, toggle);
        }, { "data-role": "idea-toggle", "data-to": to, "data-id": idea.display_id });
        acts.append(toggle);
      }
      foot.append(acts);
      node2.append(foot);
      return node2;
    }
    async function setStatus(displayId, target, btn) {
      const label = IDEA_STATUS_LABEL[target] ?? target;
      if (!await ctx.confirm(`将 ${displayId} 标记为「${label}」？只改这张卡片的 status 字段。`)) return;
      const originalLabel = btn.textContent ?? "";
      btn.disabled = true;
      btn.textContent = "处理中…";
      try {
        unwrap(await ctx.request(ideaPath(displayId, "status"), { method: "POST", body: { status: target } }));
        await refresh();
      } catch (error) {
        ctx.notice(`更新状态失败：${messageOf(error)}`, "error");
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    }
    function openPromotion(idea, host) {
      if (promoting) return;
      promoting = idea.display_id;
      const defaults = promotionDefaults(idea);
      const form = el(doc, "div", { cls: `${C3}tool-section`, attrs: { "data-role": "idea-promote-form" } });
      form.append(
        el(doc, "div", { cls: `${C3}tool-section-title`, text: "升级为正式课题" }),
        el(doc, "p", { cls: `${C3}tool-muted`, text: "以下内容将写入课题画像 v0。提交前还会展示 PRJ 编号和实际文件路径。" })
      );
      const inputs = /* @__PURE__ */ new Map();
      for (const [name, label, multi, placeholder] of PROMOTION_FIELDS) {
        const field = el(doc, "label", { cls: `${C3}tool-field`, text: label });
        const input = multi ? el(doc, "textarea", { attrs: { rows: "3", name, "data-field": name, ...placeholder ? { placeholder } : {} } }) : el(doc, "input", { attrs: { name, "data-field": name, maxlength: "300" } });
        input.value = defaults[name];
        inputs.set(name, input);
        field.append(input);
        form.append(field);
      }
      const errorEl = el(doc, "div", { cls: `${C3}tool-error`, attrs: { "data-role": "idea-promote-error" } });
      errorEl.hidden = true;
      const close = () => {
        form.remove();
        promoting = null;
      };
      const submit = button(doc, "生成升级预览", () => {
        void run();
      }, { "data-role": "idea-promote-submit" });
      const cancel = button(doc, "取消", close, { "data-role": "idea-promote-cancel" });
      const row = el(doc, "div", { cls: `${C3}tool-actions` });
      row.append(cancel, submit);
      form.append(errorEl, row);
      host.append(form);
      const fail2 = (text6) => {
        errorEl.textContent = text6;
        errorEl.hidden = false;
      };
      async function run() {
        const values = {};
        for (const [name] of PROMOTION_FIELDS) values[name] = String(inputs.get(name)?.value ?? "");
        const profile = profileFromForm(values);
        const missing = missingProfileFields(profile);
        if (missing.length) {
          fail2(`请填写：${missing.join("、")}`);
          return;
        }
        errorEl.hidden = true;
        submit.disabled = true;
        cancel.disabled = true;
        submit.textContent = "生成预览…";
        const displayId = idea.display_id;
        try {
          const preview = asRecord(unwrap(await ctx.request(ideaPath(displayId, "promote/preview"), { method: "POST", body: { profile } })));
          if (preview.alreadyPromoted) {
            ctx.notice(`${displayId} 已升级为 ${str(preview.project_display_id) || "课题"}。`, "info");
            close();
            await refresh();
            return;
          }
          if (!await ctx.confirm(promotionConfirmMessage(displayId, preview))) {
            submit.textContent = "生成升级预览";
            return;
          }
          submit.textContent = "正在升级…";
          const committed = asRecord(unwrap(await ctx.request(ideaPath(displayId, "promote/commit"), { method: "POST", body: { previewId: str(preview.id) } })));
          ctx.notice(`${displayId} 已升级为 ${str(asRecord(committed.project).display_id)}，课题画像 v0 已创建。`, "info");
          close();
          await refresh();
        } catch (error) {
          fail2(`升级课题失败：${messageOf(error)}`);
          ctx.notice(`升级课题失败：${messageOf(error)}`, "error");
          submit.textContent = "生成升级预览";
        } finally {
          submit.disabled = false;
          cancel.disabled = false;
        }
      }
    }
    const listener = () => {
      void refresh();
    };
    ideasChanged.add(listener);
    void refresh();
    return () => {
      closed = true;
      ideasChanged.delete(listener);
    };
  }
  var ideaLibraryTool = Object.freeze({
    id: "idea-library",
    label: "Idea 库",
    title: "Idea 卡片：筛选、搁置/重新探索、升级为课题",
    placement: "rail",
    requiresRuntime: true,
    render: renderIdeaLibrary
  });
  var IDEA_TOOLS = Object.freeze([ideaModeTool, ideaLibraryTool]);

  // src/features/tools/tree/tree-core.ts
  var STATE_PATH2 = "/v1/scholarium/state";
  function statePath2(action, input) {
    const query = new URLSearchParams({ action });
    if (input) query.set("input", JSON.stringify(input));
    return `${STATE_PATH2}?${query.toString()}`;
  }
  function verdict(hypothesis) {
    const s = asRecord(asRecord(hypothesis).settlement);
    const n = (key) => typeof s[key] === "number" ? s[key] : 0;
    if (n("contradicts") > 0) return "contradicted";
    if (n("qualifies") > 0) return "qualified";
    if (n("supports") > 0) return "supported";
    if (n("pending") > 0) return "pending";
    return "unrated";
  }
  var VERDICT_LABEL = Object.freeze({
    contradicted: "有反驳",
    qualified: "有限定",
    supported: "有支持",
    pending: "待结算",
    unrated: "未评审"
  });
  var VERDICT_COLOR = Object.freeze({
    contradicted: "var(--sw-error)",
    qualified: "var(--sw-warning)",
    supported: "var(--sw-success)",
    pending: "var(--sw-faint)",
    unrated: "var(--sw-faint)"
  });
  var TREE_FILTERS = Object.freeze([
    { id: "all", label: "全部" },
    { id: "supported", label: "有支持", color: VERDICT_COLOR.supported },
    { id: "contradicted", label: "有反驳", color: VERDICT_COLOR.contradicted },
    { id: "qualified", label: "有限定", color: VERDICT_COLOR.qualified },
    { id: "pending", label: "待结算", color: "var(--sw-faint)" }
  ]);
  function normalizeDetail(result) {
    if (!result || typeof result !== "object") return null;
    const r = asRecord(result);
    const records = (value) => asArray(value).map(asRecord).filter((x) => str(x.display_id));
    return {
      project: asRecord(r.project),
      path: str(r.path),
      hypotheses: records(r.hypotheses),
      experiments: records(r.experiments),
      questions: records(r.questions),
      counts: asRecord(r.counts)
    };
  }
  function projectOptions(result) {
    return asArray(asRecord(result).projects).map(asRecord).filter((p) => str(p.display_id)).map((p) => ({ value: str(p.display_id), label: `${str(p.display_id)} · ${str(p.title) || "未命名课题"}` }));
  }
  function testsOf(experiment) {
    return asArray(experiment.tests_hypotheses).map((t) => str(asRecord(t).display_id)).filter(Boolean);
  }
  function awaitingExpsFor(detail, hypId) {
    return detail.experiments.filter((e) => testsOf(e).includes(hypId) && e.has_conclusion === true && e.status !== "integrated");
  }
  function buildModel(detail, options = {}) {
    const random = options.random ?? Math.random;
    const p = detail.project;
    const hypotheses = detail.hypotheses;
    const experiments = detail.experiments;
    const questions = detail.questions;
    const W = Math.max(260, options.width || 320);
    const H = Math.max(320, options.height || 480);
    const cx = W / 2, cy = H / 2;
    const orphans = experiments.filter((e) => !asArray(e.tests_hypotheses).length);
    const clusters = hypotheses.map((h) => ({ key: str(h.display_id), label: str(h.display_id), color: VERDICT_COLOR[verdict(h)] }));
    if (orphans.length) clusters.push({ key: "__orphans", label: "未关联实验", color: "var(--sw-faint)" });
    if (questions.length) clusters.push({ key: "__questions", label: "问题", color: "var(--sw-accent-soft)" });
    const RX = W * 0.38;
    const RY = Math.min(H * 0.34, 260);
    const centers = {};
    clusters.forEach((cl, i) => {
      const angle = i / clusters.length * 2 * Math.PI - Math.PI / 2;
      centers[cl.key] = { x: cx + RX * Math.cos(angle), y: cy + RY * Math.sin(angle) };
    });
    const blank = { tx: 0, ty: 0, pull: 0, x: 0, y: 0, vx: 0, vy: 0 };
    const nodes = [];
    const links = [];
    const hypIdsKnown = new Set(hypotheses.map((h) => str(h.display_id)));
    const projectId = str(p.display_id) || "PRJ";
    nodes.push({
      ...blank,
      id: projectId,
      kind: "project",
      label: str(p.display_id) || "课题",
      r: 11,
      color: "var(--sw-text)",
      cluster: "__hub",
      hypIds: [],
      search: `${str(p.display_id)} ${str(p.title)}`.toLowerCase()
    });
    for (const h of hypotheses) {
      const id = str(h.display_id);
      const v = verdict(h);
      nodes.push({
        ...blank,
        id,
        kind: "hypothesis",
        label: id,
        verdict: v,
        awaiting: awaitingExpsFor(detail, id).length,
        r: 9,
        color: VERDICT_COLOR[v],
        cluster: id,
        hypIds: [],
        search: `${id} ${str(h.statement)}`.toLowerCase()
      });
      links.push({ source: id, target: projectId, rel: "隶属于" });
    }
    for (const e of experiments) {
      const id = str(e.display_id);
      const hypIds = testsOf(e).filter((h) => hypIdsKnown.has(h));
      const cross = hypIds.length >= 2;
      nodes.push({
        ...blank,
        id,
        kind: "experiment",
        label: id,
        r: cross ? 7 : 5,
        color: e.has_conclusion === true ? "var(--sw-accent)" : "var(--sw-faint)",
        cluster: hypIds.length === 1 ? hypIds[0] : "__orphans",
        hypIds,
        cross,
        search: `${id} ${str(e.title)} ${str(e.conclusion_excerpt)}`.toLowerCase()
      });
      for (const hid of hypIds) links.push({ source: id, target: hid, rel: "测试" });
    }
    for (const q of questions) {
      const id = str(q.display_id);
      nodes.push({
        ...blank,
        id,
        kind: "question",
        label: id,
        r: 5,
        color: "var(--sw-accent-soft)",
        cluster: "__questions",
        hypIds: [],
        search: `${id} ${str(q.statement)}`.toLowerCase()
      });
    }
    for (const n of nodes) {
      if (n.kind === "project") {
        n.tx = cx;
        n.ty = cy;
        n.pull = 0.15;
      } else if (n.cross) {
        n.tx = n.hypIds.reduce((s, h) => s + (centers[h]?.x ?? cx), 0) / n.hypIds.length;
        n.ty = n.hypIds.reduce((s, h) => s + (centers[h]?.y ?? cy), 0) / n.hypIds.length;
        n.pull = 0.04;
      } else {
        const center = centers[n.cluster] ?? { x: cx, y: cy };
        n.tx = center.x;
        n.ty = center.y;
        n.pull = n.kind === "hypothesis" ? 0.3 : 0.18;
      }
      n.x = n.tx + (random() - 0.5) * 40;
      n.y = n.ty + (random() - 0.5) * 40;
      n.vx = 0;
      n.vy = 0;
    }
    return { nodes, links, clusters, centers, W, H, alpha: 0 };
  }
  function statsLine(model, detail) {
    const c = detail.counts;
    const n = (key) => typeof c[key] === "number" ? c[key] : 0;
    return `${model.nodes.length} 节点 · ${model.links.length} 关系 · ${model.clusters.length} 簇 · 假设 ${n("hypotheses")} / 实验 ${n("experiments")} / 证据 ${n("evidence")}`;
  }
  function nodeMatches(n, filter, searchText) {
    if (n.kind === "project") return true;
    if (searchText && !n.search.includes(searchText)) return false;
    if (n.kind === "hypothesis" && filter !== "all") {
      if (filter === "pending") return (n.awaiting ?? 0) > 0;
      return n.verdict === filter;
    }
    return true;
  }
  function computeVisible(model, filter, searchText) {
    const text6 = searchText.trim().toLowerCase();
    const visible = new Set(model.nodes.filter((n) => nodeMatches(n, filter, text6)).map((n) => n.id));
    for (const n of model.nodes) {
      if (n.kind !== "experiment" || !visible.has(n.id)) continue;
      if (filter === "all") continue;
      if (n.hypIds.length && !n.hypIds.some((h) => visible.has(h))) visible.delete(n.id);
    }
    return visible;
  }
  function neighborIds(model, id) {
    const out2 = /* @__PURE__ */ new Set([id]);
    for (const link2 of model.links) {
      if (link2.source === id) out2.add(link2.target);
      if (link2.target === id) out2.add(link2.source);
    }
    return out2;
  }
  function touchedClusters(model, id) {
    const out2 = /* @__PURE__ */ new Set();
    const node2 = model.nodes.find((n) => n.id === id);
    if (node2) {
      if (node2.cluster && !node2.cluster.startsWith("__")) out2.add(node2.cluster);
      for (const h of node2.hypIds) out2.add(h);
    }
    return out2;
  }
  var ALPHA_MIN = 0.015;
  function tick(model, random = Math.random) {
    model.alpha *= 0.985;
    const a = model.alpha;
    const nodes = model.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of nodes) {
      if (n.fx != null && n.fy != null) {
        n.x = n.fx;
        n.y = n.fy;
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      n.vx += (n.tx - n.x) * n.pull * a;
      n.vy += (n.ty - n.y) * n.pull * a;
    }
    for (const link2 of model.links) {
      const s = byId.get(link2.source), t = byId.get(link2.target);
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      const f = (dist - 55) / dist * 0.25 * a;
      s.vx += dx * f * 0.5;
      s.vy += dy * f * 0.5;
      t.vx -= dx * f * 0.5;
      t.vy -= dy * f * 0.5;
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i], B = nodes[j];
        let dx = B.x - A.x, dy = B.y - A.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = random() - 0.5;
          dy = random() - 0.5;
          d2 = 1;
        }
        if (d2 > 4e4) continue;
        const dist = Math.sqrt(d2);
        const rep = 120 / d2 * a;
        const fx = dx / dist * rep, fy = dy / dist * rep;
        A.vx -= fx;
        A.vy -= fy;
        B.vx += fx;
        B.vy += fy;
        const minDist = A.r + B.r + 10;
        if (dist < minDist) {
          const push = (minDist - dist) / dist * 0.5;
          A.vx -= dx * push;
          A.vy -= dy * push;
          B.vx += dx * push;
          B.vy += dy * push;
        }
      }
    }
    for (const n of nodes) {
      if (n.fx != null) continue;
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
  function settle(model, alpha = 1, random = Math.random, maxTicks = 400) {
    model.alpha = Math.max(model.alpha, alpha);
    let ticks2 = 0;
    while (model.alpha > ALPHA_MIN && ticks2 < maxTicks) {
      tick(model, random);
      ticks2++;
    }
    return ticks2;
  }
  function hullPoints(pts) {
    if (!pts.length) return null;
    const expanded = [];
    for (const p of pts) {
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        expanded.push([p.x + 26 * Math.cos(a), p.y + 26 * Math.sin(a)]);
      }
    }
    expanded.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of expanded) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = expanded.length - 1; i >= 0; i--) {
      const p = expanded[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }
  function hullShapes(model, visible) {
    return model.clusters.map((cl) => {
      const pts = model.nodes.filter((n) => n.cluster === cl.key && n.kind !== "project" && visible.has(n.id));
      const poly = hullPoints(pts);
      if (!poly) return { key: cl.key, d: "", labelX: 0, labelY: 0 };
      const fmt = (v) => String(Math.round(v * 10) / 10);
      return {
        key: cl.key,
        d: "M" + poly.map((p) => `${fmt(p[0])},${fmt(p[1])}`).join("L") + "Z",
        labelX: pts.reduce((s, n) => s + n.x, 0) / pts.length,
        labelY: Math.min(...pts.map((n) => n.y)) - 32
      };
    });
  }
  function rehearseLabel(awaiting) {
    return `对该假设运行结算预演${awaiting ? `（待结算 ${awaiting}）` : ""}`;
  }
  function detailCard(detail, kind, id) {
    if (kind === "project") {
      const p = detail.project;
      return {
        title: `${str(p.display_id)} · ${str(p.title)}`,
        state: "",
        lines: [
          { text: str(p.goal) || str(p.description) || "（课题对象没有 goal/description 字段）" },
          { text: detail.path, muted: true }
        ]
      };
    }
    if (kind === "hypothesis") {
      const h = detail.hypotheses.find((x) => str(x.display_id) === id);
      if (!h) return null;
      const s = asRecord(h.settlement);
      const n = (key) => typeof s[key] === "number" ? s[key] : 0;
      const confidence = h.confidence === null || h.confidence === void 0 ? "—" : String(h.confidence);
      const awaiting = awaitingExpsFor(detail, id).length;
      return {
        title: str(h.display_id),
        state: VERDICT_LABEL[verdict(h)],
        lines: [
          { text: str(h.statement) },
          { text: `状态 ${str(h.status) || "—"} · 置信度 ${confidence} · 支持 ${n("supports")} / 反驳 ${n("contradicts")} / 限定 ${n("qualifies")} / 待审 ${n("pending")} / 驳回 ${n("rejected")}`, muted: true },
          { text: str(h.path), muted: true }
        ],
        rehearse: { hypothesisId: str(h.display_id), awaiting, label: rehearseLabel(awaiting) }
      };
    }
    if (kind === "experiment") {
      const e = detail.experiments.find((x) => str(x.display_id) === id);
      if (!e) return null;
      const tests = testsOf(e);
      const excerpt = str(e.conclusion_excerpt);
      const produced = typeof e.produced_evidence_count === "number" ? e.produced_evidence_count : 0;
      return {
        title: str(e.display_id),
        state: str(e.status),
        lines: [
          { text: str(e.title) || "(无标题实验)", strong: true },
          excerpt ? { text: excerpt } : { text: "还没有结论。", muted: true },
          { text: `测试假设：${tests.join("、") || "未声明"} · 产出证据 ${produced} 条`, muted: true },
          { text: str(e.path), muted: true }
        ]
      };
    }
    if (kind === "question") {
      const q = detail.questions.find((x) => str(x.display_id) === id);
      if (!q) return null;
      return {
        title: str(q.display_id),
        state: str(q.status),
        lines: [{ text: str(q.statement) }, { text: str(q.path), muted: true }]
      };
    }
    return null;
  }

  // src/features/tools/tree/tree-rehearsal.ts
  var REHEARSAL_DIR = "Research/_runs/p7-rehearsal";
  function awaitingForHypothesis(scanResult, hypothesisId) {
    return asArray(asRecord(scanResult).awaiting_integration).map(asRecord).map((e) => ({
      display_id: str(e.display_id),
      title: str(e.title),
      conclusion_excerpt: str(e.conclusion_excerpt),
      tests: asArray(e.tests_hypotheses).map((t) => str(asRecord(t).display_id)).filter(Boolean),
      project_display_id: str(e.project_display_id),
      data_origin: e.data_origin ?? null,
      path: str(e.path)
    })).filter((e) => e.display_id && (!hypothesisId || e.tests.includes(hypothesisId)));
  }
  function extractFrontmatterField(markdown, field) {
    const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(String(markdown || ""));
    if (!match) return "";
    const lines = match[1].split(/\r?\n/);
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const head = new RegExp(`^${escaped}\\s*:\\s*(.*)$`);
    for (let i = 0; i < lines.length; i++) {
      const found = head.exec(lines[i]);
      if (!found) continue;
      const value = found[1].trim();
      if (/^[|>][+-]?$/.test(value)) {
        const block = [];
        for (let j = i + 1; j < lines.length; j++) {
          const line2 = lines[j];
          if (line2.trim() && !/^\s/.test(line2)) break;
          block.push(line2);
        }
        const indent = Math.min(...block.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
        const body = block.map((l) => l.slice(Number.isFinite(indent) ? indent : 0));
        return (value.startsWith(">") ? body.join(" ").replace(/\s+/g, " ") : body.join("\n")).trim();
      }
      if (value.startsWith('"')) {
        try {
          return String(JSON.parse(value)).trim();
        } catch {
          return value.replace(/^"|"$/g, "").trim();
        }
      }
      if (value.startsWith("'")) return value.replace(/^'|'$/g, "").replace(/''/g, "'").trim();
      return value;
    }
    return "";
  }
  var REHEARSAL_VERDICTS = ["supports", "contradicts", "qualifies", "insufficient"];
  var REHEARSAL_VERDICT_LABEL = Object.freeze({
    supports: "支持",
    contradicts: "反驳",
    qualifies: "限定",
    insufficient: "证据不足"
  });
  function rehearsalConfirmText(o) {
    const scopeNote = o.hypothesisId ? `范围：仅 ${o.hypothesisId}（Idea 树入口）。
` : "";
    return `${scopeNote}将对 ${o.experiments} 个未结算实验 × ${o.hypotheses} 条假设运行 P7 结算预演（${o.project}）。

Agent（${o.agent}）只读分析，产出结算建议草稿；不写入任何正式对象。是否继续？`;
  }
  function buildRehearsalPrompt(input) {
    const hyp = input.hypotheses.map((h) => {
      const s = asRecord(h.settlement);
      const n = (k) => typeof s[k] === "number" ? s[k] : 0;
      return `- ${h.display_id}（状态 ${h.status || "—"}；现有账本 支持 ${n("supports")} / 反驳 ${n("contradicts")} / 限定 ${n("qualifies")} / 待审 ${n("pending")}）
  陈述：${h.statement || "（空）"}`;
    }).join("\n");
    const exp = input.experiments.map((e) => `- ${e.display_id} ${e.title || "(无标题实验)"}
  声明测试：${e.tests.join("、") || "未声明"}${e.data_origin ? `；数据来源：${typeof e.data_origin === "string" ? e.data_origin : JSON.stringify(e.data_origin)}` : ""}
  结论：${e.conclusion || "（空）"}`).join("\n");
    return [
      `你在做 P7 闭环回扫的结算预演（课题 ${input.project.display_id}${input.project.title ? ` · ${input.project.title}` : ""}）。这是只读分析：不要修改、创建或删除任何文件，只给出建议草稿。`,
      "",
      "## 被测假设",
      hyp,
      "",
      "## 已出结论但尚未结算（integrated）的实验",
      exp,
      "",
      "## 任务",
      "对每个「实验 × 其声明测试的假设」判断该实验结论对假设的作用：supports（支持）/ contradicts（反驳）/ qualifies（限定，只在部分条件下成立）/ insufficient（证据不足以结算）。",
      "只能使用上面列出的假设编号和实验编号；不要编造编号。若某实验结论明显指向一条它没有声明测试的假设，放进 spillover，不要放进 settlements。",
      "",
      "## 输出",
      "只输出一个 JSON 对象（可以放在 ```json 代码块里），格式：",
      '{"settlements":[{"hypothesis":"HYP-001","verdict":"supports","based_on":["EXP-001"],"reason":"一两句理由"}],"spillover":[{"experiment":"EXP-001","hypothesis":"HYP-002","note":"说明"}],"notes":"整体备注，可为空"}'
    ].join("\n");
  }
  function extractJson(raw) {
    const text6 = String(raw || "");
    const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text6);
    const candidates = [fenced?.[1], text6.slice(text6.indexOf("{"), text6.lastIndexOf("}") + 1)];
    for (const candidate of candidates) {
      if (!candidate || !candidate.trim()) continue;
      try {
        return JSON.parse(candidate);
      } catch {
      }
    }
    return void 0;
  }
  function parseRehearsalReply(raw, known) {
    const data = extractJson(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "Agent 回复里没有可解析的 JSON 对象" };
    const record2 = asRecord(data);
    if (!Array.isArray(record2.settlements)) return { ok: false, error: "Agent 回复缺少 settlements 数组" };
    const hyps = new Set(known.hypotheses);
    const exps = new Set(known.experiments);
    const dropped = [];
    const settlements = [];
    for (const item of record2.settlements.map(asRecord)) {
      const hypothesis = str(item.hypothesis);
      const verdict2 = str(item.verdict);
      if (!hyps.has(hypothesis)) {
        dropped.push({ why: `假设 ${hypothesis || "(空)"} 不在本次预演范围` });
        continue;
      }
      if (!REHEARSAL_VERDICTS.includes(verdict2)) {
        dropped.push({ why: `${hypothesis} 的建议 ${verdict2 || "(空)"} 不是可识别的判定` });
        continue;
      }
      const based = [];
      for (const id of asArray(item.based_on).map(str)) {
        if (exps.has(id)) based.push(id);
        else dropped.push({ why: `${hypothesis} 的依据 ${id || "(空)"} 不是本次的待结算实验` });
      }
      if (!based.length) {
        dropped.push({ why: `${hypothesis} 的建议没有有效依据` });
        continue;
      }
      settlements.push({ hypothesis, verdict: verdict2, based_on: based, reason: str(item.reason) });
    }
    const spillover = [];
    for (const item of asArray(record2.spillover).map(asRecord)) {
      const experiment = str(item.experiment);
      if (!exps.has(experiment)) {
        dropped.push({ why: `旁证里的实验 ${experiment || "(空)"} 不是本次的待结算实验` });
        continue;
      }
      spillover.push({ experiment, hypothesis: str(item.hypothesis), note: str(item.note) });
    }
    return { ok: true, settlements, spillover, dropped, notes: str(record2.notes) };
  }
  function renderRehearsalMarkdown(parsed, meta) {
    const cell = (v) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const lines = [
      "---",
      "type: p7-rehearsal-draft",
      `project: ${JSON.stringify(meta.project)}`,
      ...meta.hypothesisId ? [`hypothesis: ${JSON.stringify(meta.hypothesisId)}`] : [],
      `agent: ${JSON.stringify(meta.agent)}`,
      `created_at: ${JSON.stringify(meta.at)}`,
      "status: suggestion",
      "---",
      "",
      "# P7 结算预演建议",
      "",
      "> 只读预演的建议草稿，未写入任何正式对象，也不改变任何假设账本。",
      "",
      "| 假设 | 建议 | 依据 | 理由 |",
      "| --- | --- | --- | --- |",
      ...parsed.settlements.length ? parsed.settlements.map((s) => `| ${s.hypothesis} | ${REHEARSAL_VERDICT_LABEL[s.verdict]} | ${s.based_on.join("、")} | ${cell(s.reason)} |`) : ["| — | 无通过校验的建议 | — | — |"]
    ];
    if (parsed.notes) lines.push("", "## 备注", "", parsed.notes);
    if (parsed.spillover.length) {
      lines.push("", "## 旁证（结论指向未声明测试的假设）", "");
      for (const s of parsed.spillover) lines.push(`- ${s.experiment} → ${s.hypothesis || "?"}：${s.note}`);
    }
    if (parsed.dropped.length) {
      lines.push("", "## 幻觉防护丢弃", "");
      for (const d of parsed.dropped) lines.push(`- ${d.why}`);
    }
    return lines.join("\n") + "\n";
  }
  function rehearsalDraftPath(nowIso) {
    const stamp = String(nowIso).replace(/[:.]/g, "-").slice(0, 19);
    return `${REHEARSAL_DIR}/${stamp}.md`;
  }

  // src/features/tools/tree/tree-tool.ts
  var SVGNS = "http://www.w3.org/2000/svg";
  function failureText2(result) {
    return result.status ? `${result.error}（HTTP ${result.status}）` : result.error;
  }
  function setClass(node2, name, on) {
    if (on) node2.classList.add(name);
    else node2.classList.remove(name);
  }
  function renderHypothesisTree(container, ctx) {
    const doc = ctx.document;
    const win = doc.defaultView ?? null;
    let disposed = false;
    let loading = false;
    let loadToken = 0;
    let detail = null;
    let model = null;
    let painted = null;
    let visible = /* @__PURE__ */ new Set();
    let filter = "all";
    let searchText = "";
    let selectedId = null;
    let raf = 0;
    const transform = { x: 0, y: 0, k: 1 };
    const root = el(doc, "div", { cls: "scholarium-tree", attrs: { "data-tool": "hypothesis-tree" } });
    const toolbar = el(doc, "div", { cls: "scholarium-weaver__tool-section scholarium-tree__toolbar" });
    const searchField = el(doc, "label", { cls: "scholarium-weaver__tool-field" });
    const searchEl = el(doc, "input", { attrs: { type: "text", placeholder: "搜索假设 / 实验 / 问题…", "data-role": "tree-search", "aria-label": "搜索假设 / 实验 / 问题" } });
    searchField.append(searchEl);
    const pills = el(doc, "div", { cls: "scholarium-weaver__tool-pills", attrs: { "data-role": "tree-filters" } });
    const pillButtons = /* @__PURE__ */ new Map();
    for (const f of TREE_FILTERS) {
      const pill = button(doc, f.label, () => setFilter(f.id), { "data-filter": f.id, "aria-pressed": String(f.id === "all") }, "scholarium-weaver__tool-pill");
      if (f.color) pill.setAttribute("style", `--scholarium-tree-dot: ${f.color}`);
      pillButtons.set(f.id, pill);
      pills.append(pill);
    }
    const projectRow = el(doc, "div", { cls: "scholarium-weaver__tool-actions" });
    const projectSelect = el(doc, "select", { cls: "scholarium-tree__project", attrs: { "data-role": "tree-project", "aria-label": "课题" } });
    const refreshBtn = button(doc, "刷新", () => {
      void refresh();
    }, { "data-role": "tree-refresh" });
    projectRow.append(projectSelect, refreshBtn);
    toolbar.append(searchField, pills, projectRow);
    const graphEl = el(doc, "div", { cls: "scholarium-tree__graph", attrs: { "data-role": "tree-graph" } });
    const svgEl = doc.createElementNS(SVGNS, "svg");
    svgEl.setAttribute("class", "scholarium-weaver__tool-svg scholarium-tree__svg");
    svgEl.setAttribute("data-role", "tree-svg");
    svgEl.setAttribute("role", "img");
    svgEl.setAttribute("aria-label", "假设—实验关系网络");
    const overlayEl = el(doc, "p", {
      cls: "scholarium-weaver__tool-muted scholarium-tree__overlay",
      attrs: { "data-role": "tree-overlay" },
      text: "还没有加载课题数据。点上方「刷新」从课题注册表读取假设 / 实验 / 问题，生成 Idea 网络。"
    });
    const statsEl = el(doc, "div", { cls: "scholarium-weaver__tool-muted scholarium-tree__stats", attrs: { "data-role": "tree-stats" } });
    statsEl.hidden = true;
    graphEl.append(svgEl, overlayEl, statsEl);
    const detailEl = el(doc, "div", { cls: "scholarium-weaver__tool-section scholarium-tree__detail", attrs: { "data-role": "tree-detail" } });
    detailEl.hidden = true;
    const rehearsalEl = el(doc, "div", { cls: "scholarium-weaver__tool-section scholarium-tree__rehearsal", attrs: { "data-role": "tree-rehearsal" } });
    rehearsalEl.hidden = true;
    root.append(toolbar, graphEl, detailEl, rehearsalEl);
    container.replaceChildren(root);
    function showOverlay(text6, isError = false) {
      overlayEl.textContent = text6;
      overlayEl.className = isError ? "scholarium-weaver__tool-error scholarium-tree__overlay" : "scholarium-weaver__tool-muted scholarium-tree__overlay";
      overlayEl.hidden = false;
      statsEl.hidden = true;
    }
    function hideOverlay() {
      overlayEl.hidden = true;
      statsEl.hidden = false;
    }
    async function stateFetch2(action, input) {
      return ctx.request(statePath2(action, input));
    }
    async function loadProjects() {
      if (!ctx.online()) {
        showOverlay("Bridge 未连接。先连接运行时，再回来刷新。");
        return;
      }
      showOverlay("正在读取课题注册表…");
      const token = ++loadToken;
      const list4 = await stateFetch2("project.list");
      if (disposed || token !== loadToken) return;
      if (!list4.ok) {
        showOverlay(`Idea 树读取失败：${failureText2(list4)}`, true);
        return;
      }
      const options = projectOptions(asRecord(list4.data).result);
      const previous = projectSelect.value;
      projectSelect.replaceChildren();
      if (!options.length) {
        projectSelect.append(el(doc, "option", { text: "（注册表为空）", attrs: { value: "" } }));
        projectSelect.value = "";
        clearGraph();
        showOverlay("课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。");
        return;
      }
      for (const option of options) projectSelect.append(el(doc, "option", { text: option.label, attrs: { value: option.value } }));
      projectSelect.value = options.some((o) => o.value === previous) ? previous : options[0].value;
      await loadProject(projectSelect.value);
    }
    async function loadProject(displayId) {
      if (!displayId) return;
      showOverlay("正在展开课题结构…");
      const token = ++loadToken;
      const got = await stateFetch2("project.get", { display_id: displayId });
      if (disposed || token !== loadToken) return;
      if (!got.ok) {
        showOverlay(`课题读取失败：${failureText2(got)}`, true);
        return;
      }
      detail = normalizeDetail(asRecord(got.data).result);
      selectedId = null;
      detailEl.hidden = true;
      buildGraph();
    }
    async function refresh() {
      if (loading) return;
      loading = true;
      refreshBtn.disabled = true;
      try {
        await loadProjects();
      } catch (error) {
        if (!disposed) showOverlay(`Idea 树读取失败：${messageOf(error)}`, true);
      } finally {
        loading = false;
        refreshBtn.disabled = false;
      }
    }
    function clearGraph() {
      stopSim();
      model = null;
      painted = null;
      svgEl.replaceChildren();
    }
    function graphSize() {
      const rect = typeof graphEl.getBoundingClientRect === "function" ? graphEl.getBoundingClientRect() : null;
      return { width: rect?.width || 320, height: rect?.height || 480 };
    }
    function buildGraph() {
      clearGraph();
      if (!detail) {
        showOverlay("没有可显示的数据。");
        return;
      }
      const size = graphSize();
      model = buildModel(detail, size);
      svgEl.setAttribute("viewBox", `0 0 ${model.W} ${model.H}`);
      svgEl.setAttribute("data-width", String(model.W));
      draw();
      hideOverlay();
      statsEl.textContent = statsLine(model, detail);
      settle(model, 1);
      paint();
      if (selectedId && model.nodes.some((n) => n.id === selectedId)) highlight(selectedId);
    }
    function svg(tag, attrs = {}) {
      const node2 = doc.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) node2.setAttribute(k, v);
      return node2;
    }
    function draw() {
      if (!model) return;
      const gRoot = svg("g", { "data-role": "tree-root" });
      const gHulls = svg("g", { class: "scholarium-tree__hulls" });
      const gLinks = svg("g", { class: "scholarium-tree__links" });
      const gNodes = svg("g", { class: "scholarium-tree__nodes" });
      const gLabels = svg("g", { class: "scholarium-tree__labels" });
      gRoot.append(gHulls, gLinks, gNodes, gLabels);
      svgEl.replaceChildren(gRoot);
      const p = { root: gRoot, hulls: /* @__PURE__ */ new Map(), links: [], nodes: /* @__PURE__ */ new Map() };
      for (const cl of model.clusters) {
        const path2 = svg("path", { class: "scholarium-tree__hull", style: `fill: ${cl.color}; stroke: ${cl.color}`, "data-cluster": cl.key });
        const label = svg("text", { class: "scholarium-tree__hull-label", style: `fill: ${cl.color}`, "text-anchor": "middle" });
        label.textContent = cl.label;
        gHulls.append(path2, label);
        p.hulls.set(cl.key, { path: path2, label });
      }
      for (const link2 of model.links) {
        const line2 = svg("line", { class: "scholarium-tree__link", "data-source": link2.source, "data-target": link2.target });
        gLinks.append(line2);
        p.links.push({ line: line2, source: link2.source, target: link2.target });
      }
      for (const n of model.nodes) {
        const style = n.kind === "project" ? `fill: ${n.color}; stroke: var(--sw-accent); stroke-width: 1.5` : `fill: ${n.color}`;
        const circle = svg("circle", { class: `scholarium-tree__node is-${n.kind}`, r: String(n.r), style, "data-id": n.id, "data-kind": n.kind, tabindex: "0" });
        const title = svg("title");
        title.textContent = n.label;
        circle.append(title);
        circle.addEventListener("click", (ev) => {
          ev.stopPropagation?.();
          selectNode(n.id);
        });
        circle.addEventListener("keydown", (ev) => {
          const key = ev.key;
          if (key === "Enter" || key === " ") selectNode(n.id);
        });
        circle.addEventListener("pointerdown", (ev) => startDrag(ev, n));
        gNodes.append(circle);
        const label = svg("text", { class: "scholarium-tree__node-label", dy: String(n.r + 10), "text-anchor": "middle" });
        label.textContent = n.label;
        gLabels.append(label);
        p.nodes.set(n.id, { circle, label });
      }
      painted = p;
      applyTransform();
      applyVisibility();
    }
    const fmt = (v) => String(Math.round(v * 10) / 10);
    function paint() {
      if (!model || !painted) return;
      const byId = new Map(model.nodes.map((n) => [n.id, n]));
      for (const { line: line2, source, target } of painted.links) {
        const s = byId.get(source), t = byId.get(target);
        if (!s || !t) continue;
        line2.setAttribute("x1", fmt(s.x));
        line2.setAttribute("y1", fmt(s.y));
        line2.setAttribute("x2", fmt(t.x));
        line2.setAttribute("y2", fmt(t.y));
      }
      for (const n of model.nodes) {
        const drawn = painted.nodes.get(n.id);
        if (!drawn) continue;
        drawn.circle.setAttribute("cx", fmt(n.x));
        drawn.circle.setAttribute("cy", fmt(n.y));
        drawn.label.setAttribute("x", fmt(n.x));
        drawn.label.setAttribute("y", fmt(n.y));
      }
      paintHulls();
    }
    function paintHulls() {
      if (!model || !painted) return;
      for (const shape of hullShapes(model, visible)) {
        const drawn = painted.hulls.get(shape.key);
        if (!drawn) continue;
        drawn.path.setAttribute("d", shape.d);
        if (!shape.d) {
          drawn.label.setAttribute("opacity", "0");
          continue;
        }
        drawn.label.setAttribute("x", fmt(shape.labelX));
        drawn.label.setAttribute("y", fmt(shape.labelY));
        drawn.label.setAttribute("opacity", "0.55");
      }
    }
    function applyTransform() {
      painted?.root.setAttribute("transform", `translate(${fmt(transform.x)} ${fmt(transform.y)}) scale(${Math.round(transform.k * 1e3) / 1e3})`);
    }
    function applyVisibility() {
      if (!model || !painted) return;
      visible = computeVisible(model, filter, searchText);
      for (const n of model.nodes) {
        const drawn = painted.nodes.get(n.id);
        if (!drawn) continue;
        setClass(drawn.circle, "is-hidden", !visible.has(n.id));
        setClass(drawn.label, "is-hidden", !visible.has(n.id));
      }
      for (const { line: line2, source, target } of painted.links) setClass(line2, "is-hidden", !(visible.has(source) && visible.has(target)));
      paintHulls();
    }
    function stopSim() {
      if (raf && win?.cancelAnimationFrame) win.cancelAnimationFrame(raf);
      raf = 0;
      if (model) model.alpha = 0;
    }
    function frame() {
      raf = 0;
      if (disposed || !model) return;
      tick(model);
      paint();
      if (model.alpha > ALPHA_MIN) raf = win.requestAnimationFrame(frame);
    }
    function reheat(alpha) {
      if (!model) return;
      model.alpha = Math.max(model.alpha, alpha);
      if (win?.requestAnimationFrame) {
        if (!raf) raf = win.requestAnimationFrame(frame);
        return;
      }
      for (let i = 0; i < 20 && model.alpha > ALPHA_MIN; i++) tick(model);
      paint();
    }
    function highlight(id) {
      if (!model || !painted) return;
      const nb = neighborIds(model, id);
      const touched = touchedClusters(model, id);
      graphEl.classList.add("is-dimmed");
      for (const [nid, drawn] of painted.nodes) {
        setClass(drawn.circle, "is-hl", nb.has(nid));
        setClass(drawn.label, "is-hl", nb.has(nid));
      }
      for (const { line: line2, source, target } of painted.links) setClass(line2, "is-hl", source === id || target === id);
      for (const [key, drawn] of painted.hulls) {
        setClass(drawn.path, "is-hl", touched.has(key));
        setClass(drawn.label, "is-hl", touched.has(key));
      }
    }
    function clearHighlight() {
      graphEl.classList.remove("is-dimmed");
      if (!painted) return;
      for (const drawn of painted.nodes.values()) {
        drawn.circle.classList.remove("is-hl");
        drawn.label.classList.remove("is-hl");
      }
      for (const { line: line2 } of painted.links) line2.classList.remove("is-hl");
      for (const drawn of painted.hulls.values()) {
        drawn.path.classList.remove("is-hl");
        drawn.label.classList.remove("is-hl");
      }
    }
    function selectNode(id) {
      if (!model) return;
      selectedId = id;
      highlight(id);
      const node2 = model.nodes.find((n) => n.id === id);
      showDetail(node2?.kind, id);
    }
    function deselect() {
      selectedId = null;
      clearHighlight();
      detailEl.hidden = true;
    }
    function setFilter(next) {
      filter = next;
      for (const [id, pill] of pillButtons) pill.setAttribute("aria-pressed", String(id === next));
      applyVisibility();
    }
    const onSearch = () => {
      searchText = String(searchEl.value || "").trim().toLowerCase();
      applyVisibility();
    };
    searchEl.addEventListener("input", onSearch);
    projectSelect.addEventListener("change", () => {
      void loadProject(projectSelect.value);
    });
    svgEl.addEventListener("click", () => deselect());
    svgEl.addEventListener("wheel", (ev) => {
      const e = ev;
      e.preventDefault?.();
      const rect = svgEl.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const k2 = Math.min(4, Math.max(0.3, transform.k * Math.exp(-e.deltaY * 1e-3)));
      transform.x = mx - (mx - transform.x) / transform.k * k2;
      transform.y = my - (my - transform.y) / transform.k * k2;
      transform.k = k2;
      applyTransform();
    }, { passive: false });
    let panStart = null;
    svgEl.addEventListener("pointerdown", (ev) => {
      const e = ev;
      if (e.target !== svgEl) return;
      panStart = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
      try {
        svgEl.setPointerCapture?.(e.pointerId);
      } catch {
      }
    });
    svgEl.addEventListener("pointermove", (ev) => {
      if (!panStart) return;
      const e = ev;
      transform.x = panStart.tx + (e.clientX - panStart.x);
      transform.y = panStart.ty + (e.clientY - panStart.y);
      applyTransform();
    });
    const endPan = () => {
      panStart = null;
    };
    svgEl.addEventListener("pointerup", endPan);
    svgEl.addEventListener("pointercancel", endPan);
    let dragCleanup = null;
    function startDrag(ev, node2) {
      ev.stopPropagation?.();
      ev.preventDefault?.();
      const rect = svgEl.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 0 };
      const scale = model && rect.width ? model.W / rect.width : 1;
      const move = (e2) => {
        const p = e2;
        node2.fx = ((p.clientX - rect.left) * scale - transform.x) / transform.k;
        node2.fy = ((p.clientY - rect.top) * scale - transform.y) / transform.k;
        reheat(0.3);
      };
      const up = () => {
        node2.fx = null;
        node2.fy = null;
        doc.removeEventListener("pointermove", move);
        doc.removeEventListener("pointerup", up);
        dragCleanup = null;
      };
      doc.addEventListener("pointermove", move);
      doc.addEventListener("pointerup", up);
      dragCleanup = up;
    }
    let resizeTimer = null;
    let observer = null;
    const RO = win?.ResizeObserver;
    if (RO) {
      observer = new RO(() => {
        if (!model || !detail) return;
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!model || disposed) return;
          const size = graphSize();
          if (Math.abs(Math.max(260, size.width) - model.W) < 2 && Math.abs(Math.max(320, size.height) - model.H) < 2) return;
          buildGraph();
        }, 180);
      });
      observer.observe(graphEl);
    }
    function showDetail(kind, id) {
      if (!detail) return;
      const card = detailCard(detail, kind, id);
      if (!card) return;
      const head = el(doc, "div", { cls: "scholarium-tree__detail-head" });
      head.append(el(doc, "span", { cls: "scholarium-weaver__tool-section-title", text: "节点详情" }));
      head.append(button(doc, "收起", () => {
        detailEl.hidden = true;
      }, { "data-role": "tree-detail-close" }));
      const title = el(doc, "h4", { cls: "scholarium-tree__detail-title", text: card.title, attrs: { "data-role": "tree-detail-title" } });
      if (card.state) title.append(el(doc, "span", { cls: "scholarium-weaver__tool-pill scholarium-tree__state", text: card.state }));
      const body = [head, title];
      for (const line2 of card.lines) {
        if (!line2.text) continue;
        const p = el(doc, "p", { cls: line2.muted ? "scholarium-weaver__tool-muted" : "", text: line2.strong ? "" : line2.text });
        if (line2.strong) p.append(el(doc, "b", { text: line2.text }));
        body.push(p);
      }
      if (card.rehearse) {
        const r = card.rehearse;
        const actions2 = el(doc, "div", { cls: "scholarium-weaver__tool-actions" });
        actions2.append(button(doc, r.label, () => {
          void runRehearsal(r.hypothesisId);
        }, {
          "data-role": "tree-rehearse",
          title: "只读预演：捞出声明测试该假设且尚未结算的实验，让 Agent 给出结算建议草稿；不写任何正式对象"
        }));
        body.push(actions2);
      }
      detailEl.replaceChildren(...body);
      detailEl.hidden = false;
    }
    let rehearsalBusy = false;
    function rehearsalStatus(text6, isError = false) {
      rehearsalEl.hidden = false;
      rehearsalEl.replaceChildren(el(doc, "p", { cls: isError ? "scholarium-weaver__tool-error" : "scholarium-weaver__tool-muted", text: text6, attrs: { "data-role": "tree-rehearsal-status" } }));
    }
    async function readWorkspaceFile2(relativePath) {
      const got = await ctx.request(`/v1/workspace-file?path=${encodeURIComponent(relativePath)}`);
      if (!got.ok) throw new Error(`读取 ${relativePath} 失败：${failureText2(got)}`);
      return got.data && got.data.exists ? String(got.data.content || "") : "";
    }
    async function runRehearsal(hypothesisId) {
      if (rehearsalBusy) return;
      if (!ctx.online()) {
        rehearsalStatus("Bridge 未连接，无法预演。", true);
        return;
      }
      const agent = ctx.scope().agentId;
      if (!agent) {
        rehearsalStatus("没有可用的已安装 Agent CLI。", true);
        return;
      }
      rehearsalBusy = true;
      try {
        rehearsalStatus("第 1/4 步：扫描未结算实验…");
        const scan = await stateFetch2("experiment.scan_outcomes");
        if (!scan.ok) {
          rehearsalStatus(`预演失败：${failureText2(scan)}`, true);
          return;
        }
        const awaiting = awaitingForHypothesis(asRecord(scan.data).result, hypothesisId);
        if (!awaiting.length) {
          rehearsalStatus(`${hypothesisId} 没有待结算的实验（concluded 但未 integrated），该假设的账本暂时无事可做。`);
          return;
        }
        rehearsalStatus(`第 2/4 步：读取 ${awaiting.length} 个实验的完整结论与被测假设原文…`);
        let projectIds = [...new Set(awaiting.map((e) => e.project_display_id).filter(Boolean))];
        if (!projectIds.length) {
          const list4 = await stateFetch2("project.list");
          if (!list4.ok) {
            rehearsalStatus(`预演失败：${failureText2(list4)}`, true);
            return;
          }
          projectIds = projectOptions(asRecord(list4.data).result).map((o) => o.value);
        }
        const involved = new Set(awaiting.flatMap((e) => e.tests));
        const hypothesisById = /* @__PURE__ */ new Map();
        for (const pid of projectIds) {
          const got = await stateFetch2("project.get", { display_id: pid });
          if (!got.ok) {
            rehearsalStatus(`预演失败：${failureText2(got)}`, true);
            return;
          }
          for (const h of asArray(asRecord(asRecord(got.data).result).hypotheses).map(asRecord)) {
            const id = str(h.display_id);
            if (!id || !involved.has(id)) continue;
            const full = str(h.path) ? await readWorkspaceFile2(str(h.path)) : "";
            hypothesisById.set(id, { display_id: id, statement: extractFrontmatterField(full, "statement") || str(h.statement), status: str(h.status), settlement: h.settlement });
          }
        }
        const experiments = [];
        for (const e of awaiting) {
          const full = e.path ? await readWorkspaceFile2(e.path) : "";
          experiments.push({ display_id: e.display_id, title: e.title, conclusion: extractFrontmatterField(full, "conclusion") || e.conclusion_excerpt, tests: e.tests, data_origin: e.data_origin });
        }
        const involvedIds = [...new Set(experiments.flatMap((e) => e.tests))];
        const hypotheses = involvedIds.map((id) => hypothesisById.get(id)).filter((h) => Boolean(h));
        if (!hypotheses.length) {
          rehearsalStatus("待结算实验没有可解析的被测假设，预演中止。", true);
          return;
        }
        const projectLabel = str(detail?.project.display_id) || projectIds.join("、") || "（未关联课题）";
        const ok2 = await ctx.confirm(rehearsalConfirmText({ hypothesisId, experiments: experiments.length, hypotheses: hypotheses.length, project: projectLabel, agent }));
        if (!ok2) {
          rehearsalStatus("已取消预演。");
          return;
        }
        rehearsalStatus(`第 3/4 步：${agent} 正在结算分析（只读，可能需要几分钟）…`);
        const prompt = buildRehearsalPrompt({ project: { display_id: projectLabel }, hypotheses, experiments });
        const answer = await ctx.askAgent(prompt, { timeoutMs: 15 * 60 * 1e3 });
        if (disposed) return;
        if (!answer.ok) {
          rehearsalStatus(`预演失败：${answer.error}`, true);
          return;
        }
        const parsed = parseRehearsalReply(answer.text, { hypotheses: involvedIds, experiments: experiments.map((e) => e.display_id) });
        if (!parsed.ok) {
          rehearsalStatus(`${parsed.error}。原始回复前 500 字：`, true);
          rehearsalEl.append(el(doc, "pre", { cls: "scholarium-weaver__tool-pre", text: answer.text.slice(0, 500), attrs: { "data-role": "tree-rehearsal-raw" } }));
          return;
        }
        renderRehearsalCard(parsed, { project: projectLabel, agent, hypothesisId });
      } catch (error) {
        if (!disposed) rehearsalStatus(`预演失败：${messageOf(error)}`, true);
      } finally {
        rehearsalBusy = false;
      }
    }
    function renderRehearsalCard(parsed, meta) {
      const head = el(doc, "div", { cls: "scholarium-tree__detail-head" });
      head.append(el(doc, "b", { text: "P7 结算预演建议" }));
      head.append(el(doc, "span", { cls: "scholarium-weaver__tool-muted", text: `${meta.project} · ${meta.agent} · 未写入任何正式对象` }));
      const list4 = el(doc, "ul", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "tree-rehearsal-list" } });
      if (!parsed.settlements.length) list4.append(el(doc, "li", { cls: "scholarium-weaver__tool-item scholarium-weaver__tool-muted", text: "无通过校验的建议" }));
      for (const s of parsed.settlements) {
        list4.append(el(doc, "li", { cls: "scholarium-weaver__tool-item", text: `${s.hypothesis} · ${REHEARSAL_VERDICT_LABEL[s.verdict]} · 依据 ${s.based_on.join("、")}${s.reason ? ` — ${s.reason}` : ""}` }));
      }
      const parts = [head, list4];
      if (parsed.notes) parts.push(el(doc, "p", { text: parsed.notes }));
      if (parsed.spillover.length) parts.push(el(doc, "p", { cls: "scholarium-weaver__tool-muted", text: `旁证 ${parsed.spillover.length} 条（结论指向未声明测试的假设，详见草稿）。` }));
      if (parsed.dropped.length) parts.push(el(doc, "p", { cls: "scholarium-weaver__tool-muted", attrs: { "data-role": "tree-rehearsal-dropped" }, text: `幻觉防护丢弃 ${parsed.dropped.length} 条：${parsed.dropped.map((d) => d.why).join("；")}` }));
      const actions2 = el(doc, "div", { cls: "scholarium-weaver__tool-actions" });
      const out2 = el(doc, "div", { attrs: { "data-role": "tree-draft-result" } });
      const save = button(doc, "存为建议笔记（需确认）", () => {
        void saveDraft(parsed, meta, save, out2);
      }, { "data-role": "tree-save-draft" });
      actions2.append(save);
      parts.push(actions2, out2);
      rehearsalEl.replaceChildren(...parts);
      rehearsalEl.hidden = false;
    }
    async function saveDraft(parsed, meta, save, out2) {
      if (save.disabled) return;
      save.disabled = true;
      const fail2 = (text6) => {
        out2.append(el(doc, "p", { cls: "scholarium-weaver__tool-error", text: text6, attrs: { "data-role": "tree-draft-error" } }));
        ctx.notice(text6, "error");
        save.disabled = false;
      };
      try {
        const at = ctx.now();
        const relative = rehearsalDraftPath(at);
        const content = renderRehearsalMarkdown(parsed, { ...meta, at });
        const draft = await ctx.request("/v1/drafts", { method: "POST", body: { path: relative, content } });
        out2.replaceChildren();
        if (!draft.ok) {
          fail2(`建议笔记写入失败：${failureText2(draft)}`);
          return;
        }
        const id = str(draft.data?.id);
        const draftPath = str(draft.data?.path) || relative;
        if (!id) {
          fail2("建议笔记写入失败：Bridge 没有返回草稿编号");
          return;
        }
        out2.replaceChildren(
          el(doc, "p", { cls: "scholarium-weaver__tool-muted", text: `预览（${draftPath}）：` }),
          el(doc, "pre", { cls: "scholarium-weaver__tool-pre", text: content, attrs: { "data-role": "tree-draft-preview" } })
        );
        const ok2 = await ctx.confirm(`建议笔记已生成预览（${draftPath}）。
写入后仅是一份草稿笔记，不会改变任何假设账本。确认写入？`);
        if (!ok2) {
          out2.append(el(doc, "p", { cls: "scholarium-weaver__tool-muted", text: "已取消，草稿未写入。" }));
          save.disabled = false;
          return;
        }
        const commit = await ctx.request(`/v1/drafts/${encodeURIComponent(id)}/commit`, { method: "POST", confirmed: true });
        if (!commit.ok) {
          fail2(`建议笔记写入失败：${failureText2(commit)}`);
          return;
        }
        const written = str(commit.data?.path) || draftPath;
        out2.append(el(doc, "p", { cls: "scholarium-weaver__tool-ok", text: `建议笔记已写入 ${written}`, attrs: { "data-role": "tree-draft-written" } }));
        save.textContent = "已写入";
        ctx.notice(`建议笔记已写入 ${written}`, "info");
      } catch (error) {
        fail2(`建议笔记写入失败：${messageOf(error)}`);
      }
    }
    void refresh();
    return () => {
      disposed = true;
      stopSim();
      dragCleanup?.();
      if (resizeTimer) clearTimeout(resizeTimer);
      observer?.disconnect();
    };
  }
  var hypothesisTreeTool = Object.freeze({
    id: "hypothesis-tree",
    label: "假设—实验",
    title: "假设—实验关系：课题下的假设、实验与问题网络",
    placement: "rail",
    requiresRuntime: true,
    render: (container, ctx) => renderHypothesisTree(container, ctx)
  });

  // src/features/tools/graph/graph-projection-core.ts
  var text2 = (value, max = 800) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  var slug = (value, prefix) => {
    const cleaned = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return cleaned.slice(0, 48) || prefix;
  };
  var CONCLUDABLE_STATUSES = /* @__PURE__ */ new Set(["concluded", "integrated"]);
  function projectExperiment(raw) {
    const nodes = [];
    const edges = [];
    const exp = raw;
    if (!exp || !exp.uid || !exp.display_id || !text2(exp.title)) return { nodes, edges };
    const uid = String(exp.uid);
    const sourcePath = text2(exp.__vault_path || exp.path, 500);
    const execId = `exec-${slug(exp.display_id, uid.slice(0, 8))}`;
    const isSimulated = exp.data_origin === "simulated";
    const isInvalidated = exp.status === "invalidated";
    const isUnverifiable = exp.data_origin === "unverifiable";
    const execDescriptionParts = [`来自 ${exp.display_id}（status: ${text2(exp.status, 40) || "未知"}）`];
    if (isSimulated) execDescriptionParts.push("模拟数据，非真实测量执行");
    if (isUnverifiable) execDescriptionParts.push("来源追溯已完成但无法核实");
    if (isInvalidated) execDescriptionParts.push("该实验记录已失效，不得进入结论链");
    nodes.push({
      id: execId,
      label: text2(exp.title, 200),
      type: "execution",
      description: execDescriptionParts.join("；"),
      source_refs: sourcePath ? [sourcePath] : []
    });
    const result = text2(exp.result, 1200);
    if (result) {
      const obsId = `obs-${slug(exp.display_id, uid.slice(0, 8))}`;
      nodes.push({
        id: obsId,
        label: result.slice(0, 60),
        type: "observation",
        description: isInvalidated ? `已失效历史记录：${result}` : isSimulated ? `模拟数据：${result}` : result,
        source_refs: sourcePath ? [sourcePath] : []
      });
      edges.push({
        source: obsId,
        target: execId,
        relation: "measured_by",
        label: "measured_by",
        confidence: 0.5,
        review_status: "inferred",
        evidence: sourcePath ? [{ source_path: sourcePath, locator: "result" }] : []
      });
    }
    const conclusion = text2(exp.conclusion, 1200);
    if (conclusion && CONCLUDABLE_STATUSES.has(exp.status)) {
      const claimId = `claim-${slug(exp.display_id, uid.slice(0, 8))}`;
      nodes.push({
        id: claimId,
        label: conclusion.slice(0, 60),
        type: "claim",
        description: conclusion,
        source_refs: sourcePath ? [sourcePath] : []
      });
      edges.push({
        source: execId,
        target: claimId,
        relation: "tests",
        label: "tests",
        confidence: 0.5,
        review_status: "inferred",
        evidence: sourcePath ? [{ source_path: sourcePath, locator: "conclusion" }] : []
      });
    }
    return { nodes, edges };
  }
  function buildProjectGraphProjection({ project, experiments } = {}) {
    const warnings = [];
    const proj = project;
    if (!proj || !proj.uid) {
      warnings.push("buildProjectGraphProjection: 缺少 project，跳过投影。");
      return { nodes: [], edges: [], warnings };
    }
    const nodes = [];
    const edges = [];
    const seenNodeIds = /* @__PURE__ */ new Set();
    for (const raw of Array.isArray(experiments) ? experiments : []) {
      const exp = raw;
      if (exp && exp.project_uid && exp.project_uid !== proj.uid) continue;
      const { nodes: expNodes, edges: expEdges } = projectExperiment(exp);
      for (const node2 of expNodes) {
        if (seenNodeIds.has(node2.id)) continue;
        seenNodeIds.add(node2.id);
        nodes.push(node2);
      }
      edges.push(...expEdges);
    }
    return { nodes, edges, warnings };
  }
  function mergeGraphDrafts(semanticGraph, projectionGraph) {
    const semantic = semanticGraph && typeof semanticGraph === "object" ? semanticGraph : {};
    const projection = projectionGraph && typeof projectionGraph === "object" ? projectionGraph : {};
    const nodes = Array.isArray(semantic.nodes) ? [...semantic.nodes] : [];
    const seen = new Set(nodes.map((n) => n && n.id).filter(Boolean));
    for (const node2 of Array.isArray(projection.nodes) ? projection.nodes : []) {
      const id = node2 && node2.id;
      if (!node2 || !id || seen.has(id)) continue;
      seen.add(id);
      nodes.push(node2);
    }
    const edges = [
      ...Array.isArray(semantic.edges) ? semantic.edges : [],
      ...Array.isArray(projection.edges) ? projection.edges : []
    ];
    const warnings = [
      ...Array.isArray(semantic.warnings) ? semantic.warnings : [],
      ...Array.isArray(projection.warnings) ? projection.warnings : []
    ];
    return {
      title: semantic.title || projection.title || "",
      research_question: semantic.research_question || projection.research_question || "",
      summary: semantic.summary || projection.summary || "",
      nodes,
      edges,
      warnings
    };
  }

  // src/features/tools/graph/graph-review-core.ts
  var rec2 = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  var arr = (value) => Array.isArray(value) ? value : [];
  var SEMANTIC_EXTRACTION_TIMEOUT_MS = 6e4;
  var SKILL_RUN_POLLS = 200;
  var SKILL_RUN_POLL_MS = 1500;
  function statePath3(action, input) {
    const query = new URLSearchParams({ action });
    if (input) query.set("input", JSON.stringify(input));
    return `/v1/scholarium/state?${query.toString()}`;
  }
  var publishListPath = (displayId) => `/v1/knowledge-graph/publish/list?project_display_id=${encodeURIComponent(displayId)}`;
  var publishFilePath = (runId, kind) => `/v1/knowledge-graph/publish/file?run_id=${encodeURIComponent(runId)}&kind=${encodeURIComponent(kind)}`;
  var evidencePath = (question) => `/v1/knowledge-graph/evidence?query=${encodeURIComponent(question)}`;
  var projectObjectsPath = (displayId) => `/v1/knowledge-graph/project-objects?display_id=${encodeURIComponent(displayId)}`;
  var publishCommitPath = (previewId) => `/v1/knowledge-graph/publish/${previewId}/commit`;
  function pipelineSkillId(skills, slug2) {
    const needle = `/${String(slug2).toLowerCase()}/skill.md`;
    const candidates = arr(skills).filter((item) => String(rec2(item).id || "").toLowerCase().endsWith(needle));
    if (!candidates.length) throw new Error(`未找到本机 Skill：${slug2}（请确认 Bridge 已扫描到 skills/${slug2}）`);
    const preferred = candidates.find((item) => String(rec2(item).id || "").toLowerCase().includes("/agent-canvas-demo/skills/"));
    return String(rec2(preferred || candidates[0]).id);
  }
  function projectOptions2(list4) {
    return arr(rec2(list4).projects).map((raw) => {
      const p = rec2(raw);
      const id = String(p.display_id ?? "");
      return { value: id, label: `${id} · ${String(p.title || "未命名课题")}` };
    }).filter((option) => option.value);
  }
  function reviewQuestion(projectGet) {
    const project = rec2(rec2(projectGet).project);
    return String(project.research_question || project.thesis || project.title || "");
  }
  function publishedRuns(payload) {
    return arr(rec2(payload).runs).map((raw) => {
      const r = rec2(raw);
      return {
        id: String(r.id ?? ""),
        publishedAt: String(r.publishedAt ?? ""),
        nodeCount: r.nodeCount === void 0 || r.nodeCount === null ? "?" : String(r.nodeCount),
        edgeCount: r.edgeCount === void 0 || r.edgeCount === null ? "?" : String(r.edgeCount),
        warnings: arr(r.warnings).map(String),
        targetDir: String(r.targetDir ?? "")
      };
    }).filter((run) => run.id);
  }
  function formatTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso || "" : date.toLocaleString("zh-CN");
  }
  function edgeStatusLabel(edge) {
    return rec2(edge).review_status === "supported" ? "supported（quote 已核验）" : "inferred";
  }
  function evidenceLine(ev) {
    const e = rec2(ev);
    return `${String(e.source_path || "")}${e.locator ? ` · ${String(e.locator)}` : ""}${e.quote ? `：“${String(e.quote)}”` : ""}`;
  }
  function collectGraphSelections(graphRaw, nodeChoices, edgeChoices) {
    const graph = rec2(graphRaw);
    const graphNodes = arr(graph.nodes);
    const graphEdges = arr(graph.edges);
    const includedNodeIds = /* @__PURE__ */ new Set();
    const nodes = [];
    graphNodes.forEach((raw, i) => {
      const choice = nodeChoices[i];
      if (!choice || !choice.include) return;
      const original = rec2(raw);
      includedNodeIds.add(original.id);
      nodes.push({ ...original, label: choice.label || original.label });
    });
    const edges = [];
    graphEdges.forEach((raw, i) => {
      const choice = edgeChoices[i];
      if (!choice || !choice.include) return;
      const original = rec2(raw);
      if (!includedNodeIds.has(original.source) || !includedNodeIds.has(original.target)) return;
      edges.push({
        ...original,
        relation: choice.relation,
        confidence: Math.max(0, Math.min(1, Number(choice.confidence) || 0))
      });
    });
    return { title: graph.title, research_question: graph.research_question, summary: graph.summary, nodes, edges, warnings: arr(graph.warnings) };
  }
  var EDGE_RELATIONS = RELATIONS;
  function layoutGraph(graphRaw, width = 360, height = 320) {
    const graph = rec2(graphRaw);
    const raw = arr(graph.nodes).map(rec2).filter((n) => n.id !== void 0 && n.id !== null && n.id !== "");
    const sorted = raw.map((n, i) => ({ n, i })).sort((a, b) => String(a.n.type ?? "").localeCompare(String(b.n.type ?? "")) || a.i - b.i);
    const cx = width / 2, cy = height / 2;
    const radius = Math.max(40, Math.min(width, height) / 2 - 36);
    const count2 = sorted.length;
    const nodes = sorted.map(({ n }, k) => {
      const angle = count2 === 1 ? 0 : 2 * Math.PI * k / count2 - Math.PI / 2;
      const r = count2 === 1 ? 0 : radius;
      return {
        id: String(n.id),
        label: String(n.label ?? n.id),
        type: String(n.type ?? ""),
        x: Math.round((cx + r * Math.cos(angle)) * 10) / 10,
        y: Math.round((cy + r * Math.sin(angle)) * 10) / 10
      };
    });
    const at = new Map(nodes.map((n) => [n.id, n]));
    const edges = [];
    for (const rawEdge of arr(graph.edges)) {
      const e = rec2(rawEdge);
      const a = at.get(String(e.source)), b = at.get(String(e.target));
      if (!a || !b) continue;
      edges.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, relation: String(e.relation ?? ""), inferred: e.review_status !== "supported" });
    }
    return { width, height, nodes, edges };
  }

  // src/features/tools/graph/graph-tool.ts
  var C4 = "scholarium-weaver__";
  var SVG_NS = "http://www.w3.org/2000/svg";
  function failure2(result) {
    if (result.ok) return "";
    const status = result.status !== null && !result.error.includes(String(result.status)) ? `（HTTP ${result.status}）` : "";
    return `${result.error}${status}`;
  }
  var Failed = class extends Error {
  };
  async function need(ctx, path2, options) {
    const result = await ctx.request(path2, options);
    if (!result.ok) throw new Failed(failure2(result));
    return result.data;
  }
  function renderGraphTool(container, ctx) {
    const doc = ctx.document;
    let disposed = false;
    let loading = false;
    const root = el(doc, "div", { cls: `${C4}tool-section`, attrs: { "data-tool": "graph" } });
    const head = el(doc, "div", { cls: `${C4}tool-actions` });
    const projectSelect = el(doc, "select", { attrs: { "data-role": "graph-project", "aria-label": "课题" } });
    const refreshBtn = button(doc, "刷新", () => {
      void refresh();
    }, { "data-role": "graph-refresh" });
    const reviewBtn = button(doc, "知识图谱审核发布", () => {
      void openReview(projectSelect.value);
    }, { "data-role": "graph-review-open" });
    head.append(projectSelect, refreshBtn, reviewBtn);
    const overlay = el(doc, "p", { cls: `${C4}tool-muted`, attrs: { "data-role": "graph-overlay" }, text: "还没有加载已发布的知识图谱。选择课题后点「刷新」。" });
    const cards = el(doc, "div", { cls: `${C4}tool-list`, attrs: { "data-role": "graph-cards" } });
    cards.hidden = true;
    const preview = el(doc, "div", { attrs: { "data-role": "graph-preview" } });
    preview.hidden = true;
    const review = el(doc, "div", { cls: `${C4}tool-section`, attrs: { "data-role": "graph-review" } });
    review.hidden = true;
    root.append(head, overlay, cards, preview, review);
    container.replaceChildren(root);
    function showOverlay(text6, isError = false) {
      overlay.textContent = text6;
      overlay.className = isError ? `${C4}tool-error` : `${C4}tool-muted`;
      overlay.hidden = false;
      cards.hidden = true;
    }
    function hideOverlay() {
      overlay.hidden = true;
      cards.hidden = false;
    }
    async function loadProjects() {
      if (!ctx.online()) {
        showOverlay("运行时未连接。先连接运行时，再回来刷新。");
        return;
      }
      showOverlay("正在读取课题注册表…");
      const result = await ctx.request(statePath3("project.list"));
      if (disposed) return;
      if (!result.ok) {
        showOverlay(`知识图谱列表读取失败：${failure2(result)}`, true);
        return;
      }
      const options = projectOptions2(asRecord(result.data).result ?? { projects: [] });
      const previous = projectSelect.value;
      projectSelect.replaceChildren();
      if (!options.length) {
        projectSelect.append(el(doc, "option", { text: "（注册表为空）", attrs: { value: "" } }));
        projectSelect.value = "";
        showOverlay("课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。");
        return;
      }
      for (const option of options) projectSelect.append(el(doc, "option", { text: option.label, attrs: { value: option.value } }));
      const scopeProject = ctx.scope().projectId;
      projectSelect.value = previous && options.some((o) => o.value === previous) ? previous : scopeProject && options.some((o) => o.value === scopeProject) ? scopeProject : options[0].value;
      await loadRuns(projectSelect.value);
    }
    async function loadRuns(displayId) {
      if (!displayId) return;
      showOverlay("正在读取已发布版本…");
      const result = await ctx.request(publishListPath(displayId));
      if (disposed) return;
      if (!result.ok) {
        showOverlay(`已发布版本读取失败：${failure2(result)}`, true);
        return;
      }
      const runs = publishedRuns(result.data);
      if (!runs.length) {
        showOverlay("该课题还没有已发布的知识图谱版本。点上方「知识图谱审核发布」生成草案，审核通过并确认发布后会出现在这里。");
        return;
      }
      cards.replaceChildren(...runs.map((run) => {
        const card = el(doc, "article", { cls: `${C4}tool-item`, attrs: { "data-run": run.id } });
        const title = el(doc, "div");
        title.append(el(doc, "b", { text: formatTime(run.publishedAt) }), el(doc, "span", { cls: `${C4}tool-muted`, text: ` ${run.nodeCount} 节点 · ${run.edgeCount} 关系` }));
        card.append(title);
        if (run.warnings.length) card.append(el(doc, "p", { cls: `${C4}tool-muted`, text: `质量警告：${run.warnings.join("；")}` }));
        card.append(el(doc, "p", { cls: `${C4}tool-muted`, text: run.targetDir ? `库内文件：${run.targetDir}/knowledge_graph.html、knowledge_graph-report.md` : "" }));
        const actions2 = el(doc, "div", { cls: `${C4}tool-actions` });
        actions2.append(button(doc, "打开图谱", () => {
          void openGraph(run.id);
        }, { "data-role": "graph-open", "data-id": run.id }));
        card.append(actions2);
        return card;
      }));
      hideOverlay();
    }
    async function refresh() {
      if (loading) return;
      loading = true;
      try {
        await loadProjects();
      } finally {
        loading = false;
      }
    }
    projectSelect.addEventListener("change", () => {
      void loadRuns(projectSelect.value);
    });
    async function openGraph(runId) {
      preview.hidden = false;
      preview.replaceChildren(el(doc, "p", { cls: `${C4}tool-muted`, text: "正在读取图谱数据…" }));
      const result = await ctx.request(publishFilePath(runId, "json"));
      if (disposed) return;
      if (!result.ok) {
        preview.replaceChildren(el(doc, "p", { cls: `${C4}tool-error`, text: `图谱读取失败：${failure2(result)}` }));
        return;
      }
      drawGraph(result.data, runId);
    }
    function drawGraph(graph, runId) {
      const layout = layoutGraph(graph);
      const g = asRecord(graph);
      const headRow = el(doc, "div", { cls: `${C4}tool-actions` });
      headRow.append(el(doc, "b", { text: String(g.title || "知识图谱") }), button(doc, "收起", () => {
        preview.hidden = true;
        preview.replaceChildren();
      }, { "data-role": "graph-preview-close" }));
      const parts = [headRow];
      parts.push(el(doc, "p", { cls: `${C4}tool-muted`, text: `${layout.nodes.length} 节点 · ${layout.edges.length} 关系；实线 = supported（quote 已核验），虚线 = inferred。` }));
      if (typeof doc.createElementNS === "function" && layout.nodes.length) {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", `${C4}tool-svg`);
        svg.setAttribute("viewBox", `0 0 ${layout.width} ${layout.height}`);
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", `知识图谱 ${runId}`);
        svg.setAttribute("data-role", "graph-svg");
        for (const edge of layout.edges) {
          const line2 = doc.createElementNS(SVG_NS, "line");
          line2.setAttribute("x1", String(edge.x1));
          line2.setAttribute("y1", String(edge.y1));
          line2.setAttribute("x2", String(edge.x2));
          line2.setAttribute("y2", String(edge.y2));
          line2.setAttribute("stroke", "currentColor");
          line2.setAttribute("stroke-opacity", "0.45");
          if (edge.inferred) line2.setAttribute("stroke-dasharray", "4 3");
          const tip = doc.createElementNS(SVG_NS, "title");
          tip.textContent = edge.relation;
          line2.appendChild(tip);
          svg.appendChild(line2);
        }
        for (const node2 of layout.nodes) {
          const group = doc.createElementNS(SVG_NS, "g");
          group.setAttribute("data-node", node2.id);
          const dot = doc.createElementNS(SVG_NS, "circle");
          dot.setAttribute("cx", String(node2.x));
          dot.setAttribute("cy", String(node2.y));
          dot.setAttribute("r", "5");
          dot.setAttribute("class", `${C4}graph-node is-${node2.type}`);
          const label = doc.createElementNS(SVG_NS, "text");
          label.setAttribute("x", String(node2.x + 7));
          label.setAttribute("y", String(node2.y + 3));
          label.setAttribute("font-size", "9");
          label.setAttribute("fill", "currentColor");
          label.textContent = node2.label.length > 14 ? `${node2.label.slice(0, 14)}…` : node2.label;
          const tip = doc.createElementNS(SVG_NS, "title");
          tip.textContent = `${node2.label}（${node2.type}）`;
          group.append(dot, label, tip);
          svg.appendChild(group);
        }
        parts.push(svg);
      } else if (!layout.nodes.length) {
        parts.push(el(doc, "p", { cls: `${C4}tool-muted`, text: "图谱数据里没有节点。" }));
      }
      preview.replaceChildren(...parts);
    }
    function stage(body, actions2) {
      const heading = el(doc, "div", { cls: `${C4}tool-actions` });
      heading.append(el(doc, "b", { text: "知识图谱审核发布" }), button(doc, "×", () => closeReview(), { "data-role": "graph-review-close", "aria-label": "关闭" }));
      const footer = el(doc, "div", { cls: `${C4}tool-actions`, attrs: { "data-role": "graph-review-actions" } });
      footer.append(...actions2);
      const bodyEl = el(doc, "div", { attrs: { "data-role": "graph-review-body" } });
      bodyEl.append(...body);
      review.replaceChildren(heading, bodyEl, footer);
      review.hidden = false;
    }
    const muted = (text6) => el(doc, "p", { cls: `${C4}tool-muted`, text: text6 });
    const closeReview = () => {
      review.hidden = true;
      review.replaceChildren();
    };
    async function openReview(displayId) {
      if (!displayId) {
        ctx.notice("先选择一个课题。");
        return;
      }
      stage([muted("正在读取课题…")], []);
      const got = await ctx.request(statePath3("project.get", { display_id: displayId }));
      if (disposed) return;
      if (!got.ok) {
        stage([el(doc, "p", { cls: `${C4}tool-error`, text: `读取课题失败：${failure2(got)}` })], [button(doc, "关闭", closeReview, { "data-role": "graph-review-cancel" })]);
        return;
      }
      const state = { displayId, project: asRecord(asRecord(got.data).result), dryRunGraph: null, nodeInputs: [], edgeInputs: [] };
      const p = asRecord(state.project.project);
      const intro = el(doc, "p");
      intro.append("课题：", el(doc, "b", { text: String(p.display_id || displayId) }), ` · ${String(p.title || "")}`);
      const start = button(doc, "生成图谱草案", () => {
        start.disabled = true;
        start.textContent = "生成中…";
        void buildDraft(state).catch((error) => {
          if (disposed) return;
          ctx.notice(`图谱草案生成失败：${messageOf(error)}`);
          stage([el(doc, "p", { cls: `${C4}tool-error`, text: `图谱草案生成失败：${messageOf(error)}` })], [button(doc, "关闭", closeReview, { "data-role": "graph-review-cancel" })]);
        });
      }, { "data-role": "graph-review-start" });
      stage(
        [intro, muted("将读取受限来源包（本课题证据卡 + 已存在的 Project/Experiment 只读投影），派发只读 Agent 生成图谱草案；此步骤不写入任何文件。")],
        [button(doc, "取消", closeReview, { "data-role": "graph-review-cancel" }), start]
      );
    }
    async function buildDraft(state) {
      const question = reviewQuestion(state.project);
      stage([muted("正在检索本课题相关的文献证据卡片（只读，来自文献流水线已生成的 literature/evidence-cards）…")], []);
      let evidenceCards = [];
      const evidence = await ctx.request(evidencePath(question));
      if (evidence.ok) {
        const list4 = asRecord(evidence.data).cards;
        evidenceCards = Array.isArray(list4) ? list4 : [];
      } else {
        ctx.notice(`文献证据卡检索失败，语义抽取将仅依据课题问题本身：${failure2(evidence)}`);
      }
      if (disposed) return;
      stage([muted(`Agent 正在只读分析${evidenceCards.length ? `${evidenceCards.length} 张文献证据卡片 + ` : ""}课题信息（不写入任何文件；最多等待 ${SEMANTIC_EXTRACTION_TIMEOUT_MS / 1e3}s，超时自动降级为只读投影）…`)], []);
      let semanticGraph = null;
      const answer = await ctx.askAgent(buildExtractionPrompt({ question, cards: evidenceCards }), { timeoutMs: SEMANTIC_EXTRACTION_TIMEOUT_MS });
      if (answer.ok) {
        try {
          semanticGraph = parseGraphReply(answer.text);
        } catch (error) {
          ctx.notice(`语义抽取超时/失败，仅使用课题自身的 Project/Experiment 投影：${messageOf(error)}`);
        }
      } else {
        ctx.notice(`语义抽取超时/失败，仅使用课题自身的 Project/Experiment 投影：${answer.error}`);
      }
      if (disposed) return;
      stage([muted("正在读取本课题已有的 Project/Experiment 对象（只读投影）…")], []);
      const objects = await need(ctx, projectObjectsPath(state.displayId));
      const projection = buildProjectGraphProjection({ project: objects.project, experiments: objects.experiments });
      const merged = mergeGraphDrafts(semanticGraph || {}, projection);
      if (!merged.nodes.length) {
        stage([el(doc, "p", { text: "没有可用于生成图谱的节点——既没有语义抽取结果，本课题也没有已结题的 Experiment 记录。" })], [button(doc, "结束", closeReview, { "data-role": "graph-review-cancel" })]);
        return;
      }
      stage([muted("正在对草案做只读校验预览（复用渲染器的引文核验，不写入任何文件）…")], []);
      const p = asRecord(state.project.project);
      const output = asRecord(await dispatchSkillRun("zrl-knowledge-graph", { graph: merged, dry_run: true, title: merged.title || `${String(p.display_id ?? "")} 知识图谱` }));
      const graph = asRecord(output.manifest).graph;
      if (!graph || typeof graph !== "object") throw new Error("图谱渲染器未返回可审核的 graph 草案");
      state.dryRunGraph = graph;
      if (!disposed) renderReviewCards(state);
    }
    async function dispatchSkillRun(slug2, payload) {
      const skills = asRecord(await need(ctx, "/v1/skills")).skills;
      const skillId = pipelineSkillId(skills, slug2);
      const created = asRecord(await need(ctx, "/v1/skill-runs", {
        method: "POST",
        body: { skillId, workspace: ctx.scope().workspaceRoot, input: JSON.stringify(payload) }
      }));
      const id = String(created.id ?? "");
      if (!id) throw new Error(`${slug2} 没有返回运行号`);
      for (let attempt = 0; attempt < SKILL_RUN_POLLS; attempt++) {
        if (disposed) throw new Error("已关闭");
        const run = asRecord(await need(ctx, `/v1/skill-runs/${id}`));
        if (run.status === "completed") return run.output;
        if (run.status === "failed") throw new Error(String(run.error || `${slug2} 执行失败`));
        if (run.status === "cancelled") throw new Error(`${slug2} 已取消`);
        await ctx.sleep(SKILL_RUN_POLL_MS);
      }
      throw new Error(`等待 ${slug2} 超时`);
    }
    function renderReviewCards(state) {
      const graph = state.dryRunGraph;
      const nodes = Array.isArray(graph.nodes) ? graph.nodes.map(asRecord) : [];
      const edges = Array.isArray(graph.edges) ? graph.edges.map(asRecord) : [];
      const warnings = Array.isArray(graph.warnings) ? graph.warnings.map(String) : [];
      const body = [muted("review_status 由渲染器对每条边的 quote 做过真实核验，直接反映最终发布结果——不是研究者需要另外验证的猜测。取消勾选可整条排除；节点标签、边的关系/置信度可编辑。")];
      if (warnings.length) body.push(muted(`质量警告：${warnings.join("；")}`));
      const previous = { nodes: state.nodeInputs, edges: state.edgeInputs };
      state.nodeInputs = [];
      state.edgeInputs = [];
      const nodeList = el(doc, "div", { cls: `${C4}tool-list`, attrs: { "data-role": "graph-review-nodes" } });
      nodes.forEach((n, i) => {
        const row = el(doc, "div", { cls: `${C4}tool-item`, attrs: { "data-node": String(i) } });
        const include = el(doc, "input", { attrs: { type: "checkbox", "data-node-include": "", "aria-label": "保留节点" } });
        include.checked = previous.nodes[i] ? previous.nodes[i].include.checked : true;
        const label = el(doc, "input", { attrs: { type: "text", "data-node-label": "" } });
        label.value = previous.nodes[i] ? previous.nodes[i].label.value : String(n.label ?? "");
        const refs = Array.isArray(n.source_refs) ? n.source_refs.map(String).join(", ") : "";
        row.append(include, label, el(doc, "span", { cls: `${C4}tool-muted`, text: ` ${String(n.type ?? "")}${refs ? ` · ${refs}` : ""}` }));
        nodeList.append(row);
        state.nodeInputs.push({ include, label });
      });
      body.push(el(doc, "b", { text: `节点（${nodes.length}）` }), nodeList);
      const edgeList = el(doc, "div", { cls: `${C4}tool-list`, attrs: { "data-role": "graph-review-edges" } });
      const labelOf = (id) => String(nodes.find((n) => n.id === id)?.label ?? id);
      edges.forEach((e, i) => {
        const card = el(doc, "div", { cls: `${C4}tool-item`, attrs: { "data-edge": String(i), "data-status": e.review_status === "supported" ? "supported" : "inferred" } });
        const include = el(doc, "input", { attrs: { type: "checkbox", "data-edge-include": "", "aria-label": "保留关系" } });
        include.checked = previous.edges[i] ? previous.edges[i].include.checked : true;
        const headLine = el(doc, "p");
        headLine.append(include, ` ${labelOf(e.source)} → ${labelOf(e.target)} `, el(doc, "span", { cls: e.review_status === "supported" ? `${C4}tool-ok` : `${C4}tool-muted`, text: edgeStatusLabel(e) }));
        const relation = el(doc, "select", { attrs: { "data-edge-relation": "", "aria-label": "关系" } });
        for (const r of EDGE_RELATIONS) relation.append(el(doc, "option", { text: r, attrs: { value: r } }));
        relation.value = previous.edges[i] ? previous.edges[i].relation.value : String(e.relation ?? "");
        const confidence = el(doc, "input", { attrs: { type: "number", min: "0", max: "1", step: "0.05", "data-edge-confidence": "", "aria-label": "置信度" } });
        confidence.value = previous.edges[i] ? previous.edges[i].confidence.value : String(e.confidence ?? 0.5);
        const fields = el(doc, "div", { cls: `${C4}tool-actions` });
        fields.append("关系", relation, "置信度", confidence);
        card.append(headLine, fields);
        const evidence = Array.isArray(e.evidence) ? e.evidence : [];
        if (evidence.length) for (const ev of evidence) card.append(muted(evidenceLine(ev)));
        else card.append(muted("无来源摘录（等待研究者判断）"));
        edgeList.append(card);
        state.edgeInputs.push({ include, relation, confidence });
      });
      body.push(el(doc, "b", { text: `关系（${edges.length}）` }), edgeList);
      stage(body, [
        button(doc, "取消", closeReview, { "data-role": "graph-review-cancel" }),
        button(doc, "生成发布预览", () => {
          void previewPublish(state);
        }, { "data-role": "graph-review-preview" })
      ]);
    }
    function selections(state) {
      const nodeChoices = state.nodeInputs.map((input) => ({ include: Boolean(input.include.checked), label: input.label.value }));
      const edgeChoices = state.edgeInputs.map((input) => ({ include: Boolean(input.include.checked), relation: input.relation.value, confidence: input.confidence.value }));
      return collectGraphSelections(state.dryRunGraph, nodeChoices, edgeChoices);
    }
    async function previewPublish(state) {
      const graph = selections(state);
      if (!graph.nodes.length) {
        ctx.notice("至少保留一个节点。");
        return;
      }
      stage([muted("正在生成发布预览…")], []);
      const result = await ctx.request("/v1/knowledge-graph/publish/preview", {
        method: "POST",
        body: { workspace: ctx.scope().workspaceRoot, project_display_id: state.displayId, graph }
      });
      if (disposed) return;
      if (!result.ok) {
        ctx.notice(`生成预览失败：${failure2(result)}`);
        renderReviewCards(state);
        return;
      }
      const pv = asRecord(result.data);
      const targetDir = String(pv.targetDir ?? "");
      const commit = button(doc, "确认发布", () => {
        void commitPublish(state, pv, commit);
      }, { "data-role": "graph-review-commit" });
      stage([
        el(doc, "p", { text: `即将发布：${String(pv.nodeCount ?? "?")} 个节点、${String(pv.edgeCount ?? "?")} 条关系。` }),
        muted(`写入 ${targetDir}/（knowledge_graph.json/.html/-report.md），不会覆盖当前的 knowledge-graph/knowledge_graph.json；"提升为当前图谱"不在本次流程范围内，需另外手动处理。`)
      ], [button(doc, "返回编辑", () => renderReviewCards(state), { "data-role": "graph-review-back" }), commit]);
    }
    async function commitPublish(state, pv, commit) {
      const targetDir = String(pv.targetDir ?? "");
      const id = String(pv.id ?? "");
      if (!id) {
        ctx.notice("发布预览没有返回预览号，无法确认。");
        return;
      }
      if (!await ctx.confirm(`将写入 ${targetDir}/ 下的三个文件，确认吗？`)) return;
      commit.disabled = true;
      const result = await ctx.request(publishCommitPath(id), { method: "POST", confirmed: true });
      if (disposed) return;
      if (!result.ok) {
        commit.disabled = false;
        ctx.notice(`发布失败：${failure2(result)}`);
        return;
      }
      const record2 = asRecord(result.data);
      ctx.notice(`已发布版本化图谱：${String(record2.targetDir ?? targetDir)}`, "info");
      stage([
        el(doc, "p", { text: `已发布版本化图谱：${String(record2.targetDir ?? targetDir)}/` }),
        muted(`${String(record2.nodeCount ?? "?")} 个节点、${String(record2.edgeCount ?? "?")} 条关系；当前 knowledge-graph/knowledge_graph.json（若存在）未被覆盖。`)
      ], [button(doc, "结束", closeReview, { "data-role": "graph-review-cancel" })]);
      if (projectSelect.value === state.displayId) void loadRuns(state.displayId);
    }
    void refresh();
    return () => {
      disposed = true;
    };
  }
  var knowledgeGraphTool = {
    id: "knowledge-graph",
    label: "知识图谱",
    title: "已发布的知识图谱版本与审核发布",
    placement: "rail",
    requiresRuntime: true,
    render: (container, ctx) => renderGraphTool(container, ctx)
  };

  // src/features/workbench/full-lane.ts
  var FETCH_CATEGORY = "fetch_and_attach_pdf";
  var PROBE_GATE_PATTERN = /adapter '([^']+)' (has never passed a capability probe|failed its last capability probe|configuration changed since its last probe|probe is older than 30 days)/;
  var PROBE_REASON_TEXT = {
    "has never passed a capability probe": "这个适配器还没有通过过能力探测",
    "failed its last capability probe": "这个适配器上一次能力探测未通过",
    "configuration changed since its last probe": "这个适配器的配置在上次探测后被改过",
    "probe is older than 30 days": "这个适配器的探测结果已超过 30 天"
  };
  function probeGateFromError(status, message) {
    if (status !== 503) return null;
    const match = PROBE_GATE_PATTERN.exec(String(message || ""));
    if (!match) return null;
    return { adapter: match[1], reason: match[2], reasonText: PROBE_REASON_TEXT[match[2]] || match[2] };
  }
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "大小未知";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }
  var DOWNLOAD_STATUS_TEXT = {
    downloaded: "新下载",
    already_present: "已存在（字节一致，未重复保存）",
    variant_saved: "同名不同内容，已存为变体"
  };
  function fullTaskCardModel(run) {
    const diff = run && run.diff ? run.diff : { added: [], modified: [], deleted: [] };
    const violations = Array.isArray(run?.violations) ? run?.violations : [];
    const download = run?.download && typeof run.download === "object" ? run.download : null;
    const base = {
      status: typeof run?.status === "string" && run.status ? run.status : "unknown",
      added: diff.added || [],
      modified: diff.modified || [],
      deleted: diff.deleted || [],
      violations,
      adapter: typeof run?.adapter === "string" ? run.adapter : "",
      category: typeof run?.category === "string" ? run.category : "",
      finalMessage: typeof run?.finalMessage === "string" ? run.finalMessage : null,
      landing: run?.landing && typeof run.landing === "object" ? run.landing : null,
      download: download ? { ...download, bytesText: formatBytes(download.bytes), statusText: DOWNLOAD_STATUS_TEXT[String(download.status)] || String(download.status) } : null
    };
    if (base.status === "running") {
      return { ...base, tone: "running", title: "任务运行中", summary: "Agent 正在定位开放获取 PDF；完成后 Bridge 会自行下载并校验。" };
    }
    if (base.status === "completed" && base.landing && !base.download) {
      return {
        ...base,
        tone: "info",
        title: "未找到开放获取 PDF",
        summary: base.landing.reason || "该文献没有开放获取版本。可打开下方出版方页面，用 WebClip 保存为 md 到素材库阅读。"
      };
    }
    if (base.status === "completed") {
      return { ...base, tone: "ok", title: "已完成", summary: "所有文件改动都在声明的路径范围内。" };
    }
    if (base.status === "completed-with-violations") {
      return {
        ...base,
        tone: "warn",
        title: "已完成，但检测到声明范围外的文件改动",
        summary: `快照 diff 发现 ${violations.length} 处越界改动。系统不做自动回滚——请人工核对下方清单后决定如何处理。`
      };
    }
    if (base.status === "failed") {
      return { ...base, tone: "error", title: "任务失败", summary: typeof run?.failureMessage === "string" && run.failureMessage ? run.failureMessage : "任务失败，未提供原因。" };
    }
    if (base.status === "cancelled") {
      return { ...base, tone: "info", title: "任务已取消", summary: "由你主动取消。下方仍列出取消前已发生的文件改动（如有），请核对。" };
    }
    if (base.status === "interrupted") {
      return { ...base, tone: "error", title: "任务已中断", summary: "Bridge 重启导致这个任务的进程被终止。可以重新派发一次（审计日志 bridge/audit/ 留有中断前的记录）。" };
    }
    return { ...base, tone: "error", title: `未知状态：${base.status}`, summary: "运行记录缺失或已过期（Bridge 重启后内存中的运行记录会丢失，审计日志 bridge/audit/ 是持久记录）。" };
  }
  function buildFetchPromptFromRecord(record2) {
    if (!record2 || typeof record2 !== "object") return "";
    const doi = String(record2.doi || "").trim();
    const title = String(record2.title || "").trim();
    const authors = String(record2.authors || "").trim();
    const year = record2.year ? String(record2.year).trim() : "";
    const head = doi || title;
    if (!head) return "";
    const detail = [doi && title ? title : "", [authors, year].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    return detail ? `${head}（${detail}）` : head;
  }
  function doiFromPrompt(text6) {
    const match = /10\.\d{4,9}\/[^\s，,（）()"']+/i.exec(String(text6 || ""));
    return match ? match[0].replace(/[.。;；,，]+$/, "") : null;
  }
  function fullTaskPreviewFrom(data) {
    if (!data || typeof data !== "object") return null;
    const body = data;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return null;
    return {
      id,
      category: String(body.category ?? ""),
      network: body.network === true,
      plannedTools: Array.isArray(body.plannedTools) ? body.plannedTools.map(String) : [],
      pathScope: String(body.pathScope ?? ""),
      description: String(body.description ?? ""),
      adapter: String(body.adapter ?? ""),
      enforcement: String(body.enforcement ?? ""),
      expiresAt: String(body.expiresAt ?? "")
    };
  }
  function previewConfirmText(preview, title) {
    const enforcement = preview.enforcement === "prevention" ? "预防式（操作系统沙箱在越界发生前拦截）" : "仅检测式（无法预先拦截；Bridge 在任务后用快照 diff 核对越界改动）";
    return [
      `用完整权限车道抓取《${title}》的全文？`,
      "",
      `类别：${preview.category}${preview.description ? `（${preview.description}）` : ""}`,
      `联网：${preview.network ? "是" : "否"}`,
      `写入范围：${preview.pathScope || "（未声明）"}/`,
      `计划工具：${preview.plannedTools.join("、") || "（无）"}`,
      `适配器：${preview.adapter || "未知"}；执法：${enforcement}`,
      "PDF 由 Bridge 自己下载并校验后保存；Agent 只负责定位地址。"
    ].join("\n");
  }

  // src/features/tools/misc/core.ts
  function pipelineSkillId2(skills, slug2) {
    const needle = `/${slug2.toLowerCase()}/skill.md`;
    const candidates = asArray(skills).map(asRecord).filter((item) => String(item.id ?? "").toLowerCase().endsWith(needle));
    if (!candidates.length) throw new Error(`未找到本机 Skill：${slug2}（请确认 Bridge 已扫描到 skills/${slug2}）`);
    const preferred = candidates.find((item) => String(item.id ?? "").toLowerCase().includes("/agent-canvas-demo/skills/"));
    return String((preferred ?? candidates[0]).id);
  }
  var WEBVPN_LOGIN_STATUS_PATH = "Scholarium/runtime/webvpn-login-status.json";
  var DEFAULT_WEBVPN_URL = "https://wvpn.ustc.edu.cn/";
  var WEBVPN_MANUAL_WAIT_MS = 18e4;
  function webvpnStatusFrom(content) {
    if (typeof content !== "string" || !content.trim()) return null;
    let parsed;
    try {
      parsed = asRecord(JSON.parse(content));
    } catch {
      return null;
    }
    const session = asRecord(parsed.scansci_session);
    return {
      status: str(parsed.status) || "unknown",
      loggedIn: parsed.logged_in === true,
      nextStep: str(parsed.next_step),
      startedAt: str(parsed.started_at) || str(parsed.run_at),
      exported: typeof session.exported === "boolean" ? session.exported : null
    };
  }
  function statusBelongsToAttempt(status, notBeforeMs) {
    if (!notBeforeMs) return true;
    const stamp = Date.parse(status.startedAt) || 0;
    return stamp >= notBeforeMs - 5e3;
  }
  function statusIsTerminal(status) {
    return Boolean(status.status) && status.status !== "running" && status.status !== "starting";
  }
  function webvpnStatusText(status) {
    if (!status) return "还没有 WebVPN 登录记录（工作区里没有 webvpn-login-status.json）。";
    const at = status.startedAt ? `（${status.startedAt}）` : "";
    if (status.loggedIn) {
      const exported = status.exported === true ? "，已同步给机构通道" : status.exported === false ? "，但机构通道 cookie 导出失败" : "";
      return `最近一次登录已验证${exported}${at}。会话可能已过期；机构通道报 needs_login 时再刷新。`;
    }
    return `最近一次登录未成功：${status.status}${status.nextStep ? `；${status.nextStep}` : ""}${at}`;
  }
  function autoLoginOutcome(manifest) {
    const body = asRecord(manifest);
    const status = str(body.status);
    return { loggedIn: body.logged_in === true, unavailable: status === "auto_login_unavailable" || status === "credentials_missing", status: status || "unknown" };
  }
  function manualLoginFailure(status) {
    return status.status === "running" ? "WebVPN 登录未在等待时间内完成；请在弹出的 Chrome 中登录后重试（登录成功后窗口会自动关闭）。" : `WebVPN 登录未成功（${status.status || "unknown"}）：${status.nextStep || "WebVPN 门户仍被重定向到 CAS。"}`;
  }
  function manualLoginSuccess(status) {
    return status.exported ? "WebVPN/CARSI 会话已验证，并已同步给 scansci-institutional 机构通道。" : "WebVPN/CARSI 会话已验证；但机构通道 cookie 导出失败，第 5 步可能仍会回落到浏览器兜底。";
  }
  var CREDENTIAL_VALIDATORS = {
    HF_TOKEN: (v) => /^hf_[A-Za-z0-9]{20,}$/.test(v) || "应为 hf_ 开头的 Hugging Face Token，请核对是否复制完整",
    MINERU_API_KEY: (v) => /^eyJ[\w.-]{20,}$/.test(v) || v.length >= 20 || "密钥长度异常，请核对是否复制完整",
    SEMANTIC_SCHOLAR_API_KEY: (v) => /^[A-Za-z0-9_-]{20,}$/.test(v) || "应为 20 位以上字母数字（可含 - 或 _），请核对是否复制完整",
    SCOPUS_API_KEY: (v) => /^[0-9a-f]{32}$/i.test(v) || "应为 32 位十六进制，请核对",
    UNPAYWALL_EMAIL: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || "请填写有效邮箱地址",
    OPENALEX_EMAIL: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) || "请填写有效邮箱地址",
    NCBI_API_KEY: (v) => /^[0-9a-f]{36}$/i.test(v) || "应为 36 位十六进制，请核对"
  };
  function validateCredential(envVar, value) {
    const rule = CREDENTIAL_VALIDATORS[envVar];
    if (!value) return "请先粘贴新值";
    return rule ? rule(value) : true;
  }
  var CREDENTIAL_SOURCE_TEXT = {
    env: "环境变量",
    file: "bridge/.env",
    config: "bridge.config.json 遗留明文，建议点下方「迁移遗留明文密钥」"
  };
  function credentialViews(data) {
    return asArray(asRecord(data).credentials).map(asRecord).filter((item) => str(item.envVar)).map((item) => {
      const configured = item.configured === true;
      const source = str(item.source);
      return {
        envVar: str(item.envVar),
        label: str(item.label) || str(item.envVar),
        costLabel: str(item.costLabel),
        purpose: str(item.purpose),
        applyUrl: /^https:\/\//.test(str(item.applyUrl)) ? str(item.applyUrl) : "",
        configured,
        stateText: configured ? `已配置（来源：${CREDENTIAL_SOURCE_TEXT[source] ?? source}）` : `未配置。${str(item.fallback)}`,
        isEmail: str(item.envVar).includes("EMAIL")
      };
    });
  }
  var AGENT_GUIDES = {
    codex: { label: "Codex CLI", guide: "https://developers.openai.com/codex/cli" },
    claude: { label: "Claude Code（只读）", guide: "https://docs.anthropic.com/en/docs/claude-code/overview" },
    "claude-research": { label: "Claude Code · 科研车道", guide: "https://docs.anthropic.com/en/docs/claude-code/overview" },
    "claude-full": { label: "Claude Code · 完整权限车道", guide: "" },
    "codex-full": { label: "Codex · 完整权限车道", guide: "" },
    "opencode-full": { label: "OpenCode · 完整权限车道", guide: "" },
    opencode: { label: "OpenCode", guide: "https://opencode.ai/docs/" },
    hermes: { label: "Hermes", guide: "" },
    openclaw: { label: "OpenClaw", guide: "" }
  };
  function agentViews(data) {
    return asArray(asRecord(data).agents).map(asRecord).filter((agent) => str(agent.id)).map((agent) => {
      const id = str(agent.id);
      const guide = AGENT_GUIDES[id] ?? { label: id, guide: "" };
      const readiness = str(agent.readiness);
      const available = typeof agent.available === "boolean" ? agent.available : agent.installed === true && readiness !== "missing" && readiness !== "broken";
      const state = available ? "已检测到，可用" : readiness === "broken" ? "已检测到，但无法运行" : "未检测到";
      const extra = [
        agent.sandboxed === true ? "（只读沙箱）" : "",
        agent.permission === "full" ? "（完整权限车道）" : "",
        str(agent.detectedVersion) ? ` · ${str(agent.detectedVersion)}` : "",
        str(agent.problem) ? ` · ${str(agent.problem)}` : ""
      ].join("");
      return { id, label: guide.label, available, text: `${state}${extra}`, guide: available ? "" : guide.guide };
    });
  }
  function ragStatusText(status) {
    if (!status || typeof status !== "object") return "RAG 状态不可用。";
    const s = status;
    const n = (value) => typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0;
    const token = s.hf_token_configured ? "Hugging Face 已配置" : "Hugging Face 未配置";
    const coverage = `${n(s.compatible_vectorized)}/${n(s.chunks)} chunks`;
    const percent = n(s.chunks) ? `${Math.round(n(s.coverage) * 100)}%` : "0%";
    const stale = s.stale_vectorized ? `；另有 ${String(s.stale_vectorized)} 个旧模型向量待替换` : "";
    return `${token}；当前模型 ${str(s.configured_model) || "未知"}；向量覆盖 ${coverage}（${percent}）${stale}。默认查询使用混合检索，无可用向量时会明确降级 BM25。`;
  }
  function parseKeywordInput(raw) {
    return String(raw ?? "").split(/[,，\n\r;；]/).map((part) => part.trim()).filter(Boolean);
  }
  function graphKeywordView(payload) {
    const body = asRecord(payload);
    const suggestions = asArray(body.suggestions).map(asRecord).filter((item) => str(item.term));
    const corpus = asRecord(body.corpus);
    let box = "";
    let source;
    if (Array.isArray(body.configured)) {
      const configured = body.configured.map(String);
      box = configured.join(", ");
      source = configured.length ? `当前使用你固定的 ${configured.length} 个关键词。` : "当前明确不使用额外关键词，只用内置领域正则。";
    } else {
      source = `当前自动从语料推导（${Number(corpus.papers) || 0} 篇 / ${Number(corpus.chunks) || 0} 块），本次会用 ${asArray(body.effective).length} 个词。`;
    }
    const hint = suggestions.length ? `语料候选（按出现在多少篇论文里排序）：${suggestions.slice(0, 12).map((item) => `${str(item.term)}(${str(item.papers) || 0}篇)`).join("、")}${suggestions.length > 12 ? " …" : ""}` : str(corpus.note) || "语料里没有找到可建议的候选词。";
    return { box, source, hint, suggestions: suggestions.map((item) => str(item.term)) };
  }
  function graphPreviewText(response) {
    const body = asRecord(response);
    const graph = asRecord(asRecord(asRecord(body.manifest).graph).graph);
    const kw = asRecord(body.keywords);
    const origins = { derived: "自动从语料推导", configured: "你固定的", request: "本次指定的", unavailable: "（读不到语料，未使用）" };
    const origin = origins[str(kw.source)] ?? str(kw.source);
    return `知识图谱预演完成：${asArray(graph.papers).length} 篇论文、${asArray(graph.entities).length} 个实体、${asArray(graph.edges).length} 条可定位 MENTIONS；关键词为${origin} ${asArray(kw.used).length} 个；未写入 Vault。`;
  }
  function projectDetailFrom(result) {
    const body = asRecord(result);
    const project = asRecord(body.project);
    const counts = asRecord(body.counts);
    const n = (value) => typeof value === "number" ? value : Array.isArray(value) ? value.length : 0;
    return {
      displayId: str(project.display_id),
      title: str(project.title),
      countsText: `假设 ${n(counts.hypotheses)} · 实验 ${n(counts.experiments)} · 证据 ${n(counts.evidence)}`,
      hypotheses: asArray(body.hypotheses).map(asRecord).map((h) => {
        const s = asRecord(h.settlement);
        return {
          displayId: str(h.display_id),
          statement: str(h.statement),
          status: str(h.status),
          tally: `${n(s.supports)}/${n(s.contradicts)}/${n(s.qualifies)}/${n(s.pending)}/${n(s.rejected)}`,
          path: str(h.path)
        };
      })
    };
  }
  function statePath4(action, input) {
    const query = new URLSearchParams({ action });
    if (input) query.set("input", JSON.stringify(input));
    return `/v1/scholarium/state?${query.toString()}`;
  }
  function workspaceFilePath(relative) {
    return `/v1/workspace-file?path=${encodeURIComponent(relative)}`;
  }
  function institutionalInput(doi) {
    return JSON.stringify({ dois: [doi], allow_browser: false, publisher_login: false, scansci_browser_fallback: false, browser_workers: 1 });
  }
  function institutionalOutcome(output) {
    const manifest = asRecord(asRecord(output).manifest);
    const results = asArray(manifest.results).map(asRecord);
    const ok2 = results.find((item) => item.status === "downloaded");
    if (ok2) return { kind: "downloaded", path: str(ok2.path), source: str(ok2.source) };
    if (manifest.needs_login === true || results.some((item) => item.status === "needs_login")) return { kind: "needs_login" };
    const first = results[0] ?? {};
    return { kind: "failed", reason: str(manifest.error) || str(first.error) || str(first.status) || "未知原因" };
  }

  // src/features/tools/misc/ui.ts
  function section(doc, title, role) {
    const node2 = el(doc, "section", { cls: "scholarium-weaver__tool-section", attrs: { "data-role": role } });
    node2.append(el(doc, "div", { cls: "scholarium-weaver__tool-section-title", text: title }));
    return node2;
  }
  var FOLD_OPEN = /* @__PURE__ */ new Map();
  function foldSection(doc, title, role, open = false) {
    const node2 = el(doc, "details", { cls: "scholarium-weaver__tool-section scholarium-weaver__tool-fold", attrs: { "data-role": role } });
    node2.open = FOLD_OPEN.get(role) ?? open;
    node2.append(el(doc, "summary", { cls: "scholarium-weaver__tool-section-title", text: title }));
    node2.addEventListener("toggle", () => {
      FOLD_OPEN.set(role, node2.open);
    });
    return node2;
  }
  function line(doc, text6, role, cls = "scholarium-weaver__tool-muted") {
    return el(doc, "p", { cls, text: text6, attrs: role ? { "data-role": role } : {} });
  }
  function setLine(node2, text6, tone = "muted") {
    node2.className = `scholarium-weaver__tool-${tone}`;
    node2.textContent = text6;
  }
  function actions(doc, ...buttons) {
    const row = el(doc, "div", { cls: "scholarium-weaver__tool-actions" });
    row.append(...buttons);
    return row;
  }
  function failure3(result) {
    return result.status ? `HTTP ${result.status}：${result.error}` : result.error;
  }
  async function must(ctx, path2, options) {
    const result = await ctx.request(path2, options);
    if (!result.ok) throw new Error(failure3(result));
    return result.data;
  }
  function link(doc, text6, href) {
    return el(doc, "a", { text: text6, attrs: { href, target: "_blank", rel: "noopener noreferrer" } });
  }
  function clockMs(ctx) {
    const parsed = Date.parse(ctx.now());
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  // src/features/tools/misc/skill-run.ts
  async function runSkill2(ctx, slug2, options) {
    const skills = await must(ctx, "/v1/skills");
    const skillId = pipelineSkillId2(asRecord(skills).skills, slug2);
    const created = await ctx.request("/v1/skill-runs", {
      method: "POST",
      body: { skillId, workspace: options.workspace, input: options.input },
      ...options.confirmed ? { confirmed: true } : {}
    });
    if (!created.ok) throw new Error(`${slug2} 提交失败：${failure3(created)}`);
    const id = str(asRecord(created.data).id);
    if (!id) throw new Error(`${slug2} 提交后 Bridge 没有返回运行编号。`);
    let failures = 0;
    let waited = 0;
    const pollMs = options.pollMs ?? 2e3;
    for (; ; ) {
      if (options.stopped?.()) throw new Error(`已停止等待 ${slug2}（任务可能仍在 Bridge 后台运行）。`);
      await ctx.sleep(pollMs);
      waited += pollMs;
      const read = await ctx.request(`/v1/skill-runs/${encodeURIComponent(id)}`);
      if (!read.ok) {
        if (read.status === 404) throw new Error(`${slug2} 的运行记录已不存在（${read.error}）。`);
        failures += 1;
        if (failures >= 3) throw new Error(`Bridge 连接中断，${slug2} 已停止等待：无法确认任务状态，请勿假定它仍在运行。`);
        continue;
      }
      failures = 0;
      const run = asRecord(read.data);
      if (run.status === "completed") return run.output;
      if (run.status === "failed") throw new Error(str(run.error) || `${slug2} 执行失败`);
      if (run.status === "cancelled") throw new Error(`${slug2} 已被取消。`);
      options.onTick?.(Math.round(waited / 1e3));
      if (options.maxWaitMs && waited >= options.maxWaitMs) throw new Error(`等待 ${slug2} 超时；任务可能仍在 Bridge 后台运行。`);
    }
  }

  // src/features/tools/misc/fulltext.ts
  var POLL_MS = 2e3;
  var MAX_POLLS = 360;
  function previewList(doc, preview) {
    const list4 = el(doc, "ul", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "fulltext-preview" } });
    const enforcement = preview.enforcement === "prevention" ? "预防式执法（OS 沙箱）" : "检测式执法（写前快照 + 写后 diff，事后发现）";
    const rows = [
      ["操作类别", `${preview.category}${preview.description ? ` — ${preview.description}` : ""}`],
      ["联网", preview.network ? "需要（查询出版方 / arXiv 等开放获取来源）" : "不需要"],
      ["写入范围", `${preview.pathScope}/（仅此目录，且由 Bridge 落盘）`],
      ["计划工具", `${preview.plannedTools.join("、") || "（无）"}（无 Write：Agent 只报告地址）`],
      ["执行适配器", `${preview.adapter} · ${enforcement}`],
      ["预览有效期至", preview.expiresAt]
    ];
    list4.append(...rows.map(([k, v]) => el(doc, "li", { cls: "scholarium-weaver__tool-item", text: `${k}：${v}` })));
    return list4;
  }
  var fetchFullTextTool = {
    id: "fetch-oa-pdf",
    label: "抓取开放全文",
    title: "完整权限车道：Agent 联网定位开放获取 PDF 并报告地址，Bridge 校验后自行下载到 literature/downloaded-pdfs/（Agent 无写入工具）",
    placement: "action",
    requiresRuntime: true,
    render(container, ctx) {
      const doc = ctx.document;
      let disposed = false;
      let preview = null;
      let prompt = "";
      let running = false;
      const box = section(doc, "抓取开放获取 PDF", "fulltext");
      const input = el(doc, "textarea", { cls: "scholarium-weaver__tool-field", attrs: { rows: "3", "data-role": "fulltext-input", placeholder: "例如：10.48550/arXiv.1706.03762（Attention Is All You Need, Vaswani et al. 2017）" } });
      const stage = el(doc, "div", { attrs: { "data-role": "fulltext-stage" } });
      const status = line(doc, "", "fulltext-status");
      const result = el(doc, "div", { attrs: { "data-role": "fulltext-result" } });
      const say = (text6, tone = "muted") => {
        if (!disposed) setLine(status, text6, tone);
      };
      const workspace = () => ctx.scope().workspaceRoot;
      const makePreview = async () => {
        const text6 = String(input.value ?? "").trim();
        if (text6.length < 3) {
          say("请先填写 DOI 或文献信息。", "error");
          return;
        }
        if (!workspace()) {
          say("未配置工作区路径；不会猜测写入位置。", "error");
          return;
        }
        previewBtn.disabled = true;
        say("正在生成预览…");
        try {
          const made = await ctx.request("/v1/full-tasks/preview", { method: "POST", body: { category: FETCH_CATEGORY, workspace: workspace(), prompt: text6 }, timeoutMs: 2e4 });
          if (!made.ok) {
            say(`操作预览失败：${failure3(made)}`, "error");
            return;
          }
          const parsed = fullTaskPreviewFrom(made.data);
          if (!parsed) {
            say("操作预览失败：Bridge 没有返回预览编号。", "error");
            return;
          }
          preview = parsed;
          prompt = text6;
          showPreview();
          say("请核对操作预览；点击「确认并派发」后任务才真正启动（预览 15 分钟内有效，一次性使用）。");
        } finally {
          previewBtn.disabled = false;
        }
      };
      const showPreview = () => {
        if (!preview || disposed) return;
        const dispatchBtn = button(doc, "确认并派发", () => void dispatch(), { "data-role": "fulltext-dispatch" });
        const back = button(doc, "返回修改", () => {
          preview = null;
          stage.replaceChildren();
          say("");
        }, { "data-role": "fulltext-back" });
        stage.replaceChildren(previewList(doc, preview), actions(doc, dispatchBtn, back));
      };
      const dispatch = async () => {
        if (!preview || running) return;
        const current = preview;
        if (!await ctx.confirm(previewConfirmText(current, prompt.slice(0, 80)))) {
          say("已取消，没有派发。");
          return;
        }
        const sent = await ctx.request("/v1/full-tasks", {
          method: "POST",
          body: { previewId: current.id, category: current.category, workspace: workspace(), prompt },
          confirmed: true,
          timeoutMs: 2e4
        });
        if (!sent.ok) {
          const gate = probeGateFromError(sent.status, sent.error);
          if (gate) {
            showProbe(gate.adapter, gate.reasonText);
            return;
          }
          say(`派发失败：${failure3(sent)}`, "error");
          return;
        }
        const id = str(asRecord(sent.data).id);
        if (!id) {
          say("派发失败：Bridge 没有返回任务编号。", "error");
          return;
        }
        preview = null;
        stage.replaceChildren(line(doc, `操作预览已确认：${str(asRecord(sent.data).adapter)} · ${str(asRecord(sent.data).enforcement)}`));
        await watch(id);
      };
      const showProbe = (adapter, reasonText) => {
        const detail = line(doc, "", "fulltext-probe-detail");
        const probe = button(doc, `立即探测 ${adapter}`, () => void runProbe(adapter, probe, detail), { "data-role": "fulltext-probe" });
        const back = button(doc, "返回预览", () => showPreview(), { "data-role": "fulltext-back" });
        stage.replaceChildren(
          el(doc, "b", { text: "适配器需要先完成一次能力探测" }),
          line(doc, `${reasonText}（适配器 ${adapter}）。探测是一次真实的最小任务——验证“声明允许的工具确实可用”和“边界确实拦得住”，通常需要 1–2 分钟。你的操作预览仍然有效，探测通过后再点「确认并派发」即可。`),
          actions(doc, probe, back),
          detail
        );
        say("");
      };
      const runProbe = async (adapter, probe, detail) => {
        if (!await ctx.confirm(`对适配器 ${adapter} 运行一次能力探测？这是一次真实的 Agent 调用（约 1–2 分钟）。`)) return;
        probe.disabled = true;
        probe.textContent = "正在探测（真实 Agent 调用，约 1–2 分钟）…";
        try {
          const probed = await ctx.request("/v1/full-tasks/probe", { method: "POST", body: { adapter }, confirmed: true, timeoutMs: 24e4 });
          const body = probed.ok ? asRecord(probed.data) : {};
          if (probed.ok && body.ok === true) {
            ctx.notice(`${adapter} 探测通过（工具可用性 + 边界执法均验证）`, "info");
            showPreview();
            say(`${adapter} 探测通过；请再点「确认并派发」。`, "ok");
            return;
          }
          const checks = probed.ok && body.checks && typeof body.checks === "object" ? Object.entries(body.checks).map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v)}`).join("；") : probed.ok ? str(body.error) || "未知原因" : failure3(probed);
          setLine(detail, `探测未通过——${checks}。可先排查 CLI 登录/网络后重试。`, "error");
          probe.textContent = `重试探测 ${adapter}`;
        } finally {
          probe.disabled = false;
        }
      };
      const watch = async (id) => {
        running = true;
        const cancel = button(doc, "取消任务", () => void (async () => {
          if (!await ctx.confirm("取消这个抓取任务？Bridge 会结束它的进程树；取消前已发生的改动仍会列在结果里。")) return;
          cancel.disabled = true;
          const sent = await ctx.request(`/v1/full-tasks/${encodeURIComponent(id)}/cancel`, { method: "POST", confirmed: true });
          if (!sent.ok) {
            cancel.disabled = false;
            say(`取消失败：${failure3(sent)}`, "error");
            return;
          }
          say("已发送取消信号，等待进程退出…");
        })(), { "data-role": "fulltext-cancel" });
        result.replaceChildren(actions(doc, cancel));
        try {
          for (let i = 0; i < MAX_POLLS; i++) {
            if (disposed) return;
            const read = await ctx.request(`/v1/full-tasks/${encodeURIComponent(id)}`, { timeoutMs: 15e3 });
            if (!read.ok && read.status === 404) {
              say("运行记录已过期（Bridge 重启会清空内存中的运行记录；bridge/audit/ 仍有审计）", "error");
              result.replaceChildren();
              return;
            }
            if (read.ok && asRecord(read.data).status !== "running") {
              renderCard(asRecord(read.data));
              return;
            }
            if (read.ok) say(`Agent 正在定位开放获取 PDF…（已运行 ${Math.round(i * POLL_MS / 1e3)} 秒）`);
            await ctx.sleep(POLL_MS);
          }
          say("等待超过 12 分钟；任务可能仍在后台运行，审计日志可查", "error");
        } finally {
          running = false;
        }
      };
      const renderCard = (run) => {
        if (disposed) return;
        const model = fullTaskCardModel(run);
        const tone = model.tone === "ok" || model.tone === "info" ? "ok" : model.tone === "running" ? "muted" : "error";
        say(model.title, tone);
        const card = el(doc, "div", { cls: "scholarium-weaver__tool-item", attrs: { "data-role": "fulltext-card", "data-tone": model.tone } });
        const head = el(doc, "div");
        head.append(el(doc, "b", { text: model.title }), el(doc, "span", { cls: "scholarium-weaver__tool-pill", text: `${model.adapter} · ${model.category}` }));
        card.append(head, el(doc, "p", { text: model.summary }));
        if (model.finalMessage) {
          const note = el(doc, "details");
          if (model.tone === "error") note.setAttribute("open", "");
          note.append(el(doc, "summary", { text: "Agent 的完整说明" }), el(doc, "pre", { cls: "scholarium-weaver__tool-pre", text: model.finalMessage }));
          card.append(note);
        }
        if (model.landing?.url) {
          card.append(line(doc, "出版方页面（非开放获取，未下载任何文件）："), el(doc, "a", { text: model.landing.url, attrs: { href: model.landing.url, target: "_blank", rel: "noopener noreferrer" } }));
        }
        if (model.download) {
          card.append(el(doc, "p", { cls: "scholarium-weaver__tool-ok", attrs: { "data-role": "fulltext-download" }, text: `Bridge 落盘：${str(model.download.path)}（${model.download.bytesText} · ${model.download.statusText}）来源：${str(model.download.source_url)}` }));
        }
        card.append(line(doc, `快照 diff：新增 ${model.added.length} · 修改 ${model.modified.length} · 删除 ${model.deleted.length}${[...model.added, ...model.modified, ...model.deleted].length ? `（${[...model.added.map((p) => `+${p}`), ...model.modified.map((p) => `~${p}`), ...model.deleted.map((p) => `-${p}`)].join("，")}）` : ""}`));
        if (model.violations.length) {
          card.append(el(doc, "p", { cls: "scholarium-weaver__tool-error", attrs: { "data-role": "fulltext-violations" }, text: `⚠ 声明范围外的改动（系统不自动回滚，请人工核对）：${model.violations.map(String).join("，")}` }));
        }
        const doi = model.tone === "error" ? doiFromPrompt(prompt) ?? doiFromPrompt(model.finalMessage) : null;
        if (doi) card.append(institutional(doi));
        result.replaceChildren(card);
      };
      const institutional = (doi) => {
        const wrap = el(doc, "div", { attrs: { "data-role": "fulltext-institutional" } });
        const state = line(doc, `首选回退：按 DOI ${doi} 经学校出口（WebVPN 会话）访问出版方并下载 PDF，无需重复登录。`);
        const go = button(doc, "经机构通道（WebVPN）下载 PDF", () => void (async () => {
          if (!await ctx.confirm(`经机构通道（scansci-institutional，复用 WebVPN 会话，不开浏览器窗口）下载 ${doi} 的 PDF 到工作区？`)) return;
          go.disabled = true;
          setLine(state, "正在通过机构通道下载（WebVPN 会话）…");
          try {
            const output = await runSkill2(ctx, "scansci-institutional", {
              workspace: workspace(),
              input: institutionalInput(doi),
              confirmed: true,
              pollMs: 3e3,
              maxWaitMs: 45e4,
              stopped: () => disposed,
              onTick: (s) => setLine(state, `机构通道下载中…（已等 ${s} 秒）`)
            });
            const outcome = institutionalOutcome(output);
            if (outcome.kind === "downloaded") {
              setLine(state, `PDF 已保存：${outcome.path}${outcome.source ? `（来源：${outcome.source}）` : ""}`, "ok");
              return;
            }
            if (outcome.kind === "needs_login") {
              setLine(state, "机构通道报告 WebVPN 会话不可用。请先在「WebVPN」工具里完成登录，再重试。", "error");
              return;
            }
            setLine(state, `机构通道未下载成功：${outcome.reason}`, "error");
          } catch (error) {
            setLine(state, `机构通道失败：${messageOf(error)}`, "error");
          } finally {
            go.disabled = false;
          }
        })(), { "data-role": "fulltext-institutional-go" });
        wrap.append(el(doc, "b", { text: "首选：经机构通道（WebVPN）下载" }), state, actions(doc, go));
        return wrap;
      };
      const previewBtn = button(doc, "生成操作预览", () => void makePreview(), { "data-role": "fulltext-make-preview" });
      box.append(
        el(doc, "label", { cls: "scholarium-weaver__tool-muted", text: "DOI 或文献信息" }),
        input,
        line(doc, "完整权限车道：Agent 联网定位开放获取 PDF 并报告地址，Bridge 校验（%PDF 魔数 · 512B–50MB · sha256 去重）后自行下载到 literature/downloaded-pdfs/。Agent 在此类别下没有文件写入工具——写入由 Bridge 执行。"),
        actions(doc, previewBtn),
        stage,
        status,
        result
      );
      container.append(box);
      return () => {
        disposed = true;
      };
    }
  };

  // src/features/workbench/workbench-model.ts
  var isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  var str2 = (value) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  var num = (value) => typeof value === "number" && Number.isFinite(value) ? value : 0;
  var list = (value) => Array.isArray(value) ? value : [];
  var count = (value) => Array.isArray(value) ? value.length : num(value);
  function authorName(value) {
    if (typeof value === "string") return value.trim();
    if (isObject(value)) return str2(value.name ?? value.display_name).trim();
    return "";
  }
  function literatureRecordFrom(value) {
    if (!isObject(value)) return null;
    const title = str2(value.title).trim();
    if (!title) return null;
    const year = typeof value.year === "number" && Number.isFinite(value.year) ? value.year : null;
    return {
      title,
      authors: list(value.authors).map(authorName).filter(Boolean),
      year,
      venue: str2(value.venue).trim(),
      doi: str2(value.doi).trim(),
      abstract: str2(value.abstract).trim(),
      isOa: value.is_oa === true,
      pdfUrl: str2(value.pdf_url).trim(),
      oaStatus: str2(value.oa_status).trim(),
      citedBy: num(value.cited_by_count),
      openalexId: str2(value.openalex_id).trim()
    };
  }
  function literatureFrom(data, query) {
    const body = isObject(data) ? data : {};
    const manifest = isObject(body.manifest) ? body.manifest : {};
    const records = list(manifest.records).map(literatureRecordFrom).filter((r) => r !== null);
    const sources = list(body.sources).map((s) => isObject(s) ? str2(s.name ?? s.source ?? s.id) : str2(s)).filter(Boolean);
    return { id: str2(body.id), query, records, sources };
  }
  function downloadable(record2) {
    return record2.isOa && record2.openalexId !== "";
  }
  function broadenQuery(query) {
    const blocks = query.match(/\([^()]*\)/g);
    if (!blocks || blocks.length < 2) return null;
    return blocks.slice(0, -1).join(" AND ");
  }
  function projectsFrom(result) {
    const body = isObject(result) ? result : {};
    const out2 = [];
    for (const item of list(body.projects)) {
      if (!isObject(item)) continue;
      const displayId = str2(item.display_id).trim();
      if (!displayId) continue;
      const counts = isObject(item.counts) ? item.counts : {};
      out2.push({
        uid: str2(item.uid),
        displayId,
        title: str2(item.title).trim() || displayId,
        status: str2(item.status),
        stage: str2(item.stage),
        updatedAt: str2(item.updated_at),
        path: str2(item.path),
        counts: {
          questions: num(counts.questions),
          hypotheses: num(counts.hypotheses),
          experiments: num(counts.experiments),
          evidence: num(counts.evidence)
        },
        openQuestions: count(item.open_questions),
        unsettledExperiments: count(item.unsettled_experiments)
      });
    }
    return out2;
  }
  function ideasFrom(result) {
    const body = isObject(result) ? result : {};
    const out2 = [];
    for (const item of list(body.ideas)) {
      if (!isObject(item)) continue;
      const displayId = str2(item.display_id).trim();
      const title = str2(item.title).trim();
      if (!displayId && !title) continue;
      out2.push({
        uid: str2(item.uid),
        displayId,
        title: title || displayId,
        status: str2(item.status),
        summary: str2(item.summary).trim(),
        promotedTo: str2(item.promoted_to),
        updatedAt: str2(item.updated_at ?? item.created_at),
        path: str2(item.path)
      });
    }
    return out2;
  }
  function historyFrom(data) {
    const body = isObject(data) ? data : {};
    const out2 = [];
    for (const item of list(body.fullTasks)) {
      if (!isObject(item) || !str2(item.id)) continue;
      out2.push({
        id: str2(item.id),
        kind: "full-task",
        title: str2(item.title).trim() || "完整权限任务",
        status: str2(item.status),
        at: str2(item.startedAt),
        detail: [str2(item.category), str2(item.adapter)].filter(Boolean).join(" · ")
      });
    }
    for (const item of list(body.searches)) {
      if (!isObject(item) || !str2(item.id)) continue;
      out2.push({
        id: str2(item.id),
        kind: "search",
        title: str2(item.title).trim() || "文献检索",
        status: "completed",
        at: str2(item.createdAt),
        detail: `${num(item.recordCount)} 条记录`
      });
    }
    for (const item of list(body.pipelines)) {
      if (!isObject(item) || !str2(item.id)) continue;
      out2.push({
        id: str2(item.id),
        kind: "pipeline",
        title: str2(item.title).trim() || "文献 Pipeline",
        status: str2(item.status),
        at: str2(item.updatedAt ?? item.startedAt),
        detail: `${num(item.completedSteps)}/${num(item.stepCount)} 步 · ${num(item.pdfCount)} 篇 PDF`
      });
    }
    return out2.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  }
  var HISTORY_KIND_LABEL = {
    "full-task": "完整任务",
    search: "检索",
    pipeline: "Pipeline"
  };

  // src/features/tools/misc/p7-rehearsal-core.ts
  var VERDICTS = ["supports", "contradicts", "qualifies", "inconclusive"];
  var VERDICT_LABEL2 = {
    supports: "支持",
    contradicts: "反驳",
    qualifies: "限定",
    inconclusive: "证据不足"
  };
  function extractFrontmatterField2(markdown, field) {
    const text6 = String(markdown ?? "").replace(/\r\n/g, "\n");
    const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text6);
    if (!match) return "";
    const lines = match[1].split("\n");
    const head = new RegExp(`^${field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`);
    for (let i = 0; i < lines.length; i++) {
      const found = head.exec(lines[i]);
      if (!found) continue;
      const rest = found[1].trim();
      if (/^[|>][+-]?$/.test(rest)) {
        const block = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^\s/.test(lines[j])) break;
          block.push(lines[j].replace(/^\s{1,}/, ""));
        }
        const joined = rest.startsWith(">") ? block.join(" ").replace(/\s+/g, " ") : block.join("\n");
        return joined.trim();
      }
      if (rest.startsWith('"') && rest.endsWith('"') || rest.startsWith("'") && rest.endsWith("'")) {
        return rest.slice(1, -1).trim();
      }
      return rest;
    }
    return "";
  }
  function tallyText(settlement) {
    const s = asRecord(settlement);
    const n = (value) => typeof value === "number" ? value : 0;
    return `支持 ${n(s.supports)} / 反驳 ${n(s.contradicts)} / 限定 ${n(s.qualifies)} / 待审 ${n(s.pending)} / 驳回 ${n(s.rejected)}`;
  }
  function buildRehearsalPrompt2(input) {
    const hyps = input.hypotheses.map((h) => `- ${h.display_id}（状态 ${h.status || "未知"}；现有账本 ${tallyText(h.settlement)}）：${h.statement || "（无陈述）"}`);
    const exps = input.experiments.map((e) => [
      `### ${e.display_id} ${e.title || ""}`.trim(),
      `- 声明测试：${e.tests.join("、") || "（无）"}`,
      e.data_origin ? `- 数据来源：${typeof e.data_origin === "string" ? e.data_origin : JSON.stringify(e.data_origin)}` : "",
      `- 结论：${e.conclusion || "（无结论文本）"}`
    ].filter(Boolean).join("\n"));
    return [
      "你是织研者的 P7 闭环回扫助手。只做只读分析，不要修改、创建或删除任何文件。",
      `任务：下面这些实验已经得出结论（concluded）但还没有结算进假设账本（未 integrated）。请判断每个实验的结论对它声明测试的假设意味着什么，给出结算建议草稿，由研究员审阅。`,
      `课题：${input.project.display_id}${input.project.title ? ` · ${input.project.title}` : ""}`,
      "",
      "## 被测假设",
      ...hyps,
      "",
      "## 待结算实验",
      ...exps,
      "",
      "## 输出要求",
      "只输出一个 ```json 代码块，结构如下：",
      '{"settlements":[{"hypothesis":"HYP-…","verdict":"supports|contradicts|qualifies|inconclusive","based_on":["EXP-…"],"reason":"一句话理由"}],"spillover":[{"experiment":"EXP-…","hypothesis":"…","note":"…"}],"notes":"可选的总体说明"}',
      "规则：",
      "1. hypothesis 只能使用上面「被测假设」列出的编号；based_on 只能使用上面「待结算实验」列出的编号。不要编造编号。",
      "2. 证据不足以判断时用 inconclusive，不要勉强下结论。",
      "3. 若某个实验的结论实际指向一条它没有声明测试的假设，放进 spillover，不要放进 settlements。"
    ].join("\n");
  }
  function jsonCandidate(raw) {
    const fences = [...raw.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
    for (const body of fences.reverse()) {
      try {
        return JSON.parse(body);
      } catch {
      }
    }
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1));
      } catch {
      }
    }
    return void 0;
  }
  function parseRehearsalReply2(raw, known) {
    const text6 = String(raw ?? "");
    const parsed = jsonCandidate(text6);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "Agent 回复里没有可解析的 JSON 结算建议" };
    const body = parsed;
    const hyps = new Set(known.hypotheses);
    const exps = new Set(known.experiments);
    const dropped = [];
    const settlements = [];
    for (const item of asArray(body.settlements).map(asRecord)) {
      const hypothesis = str(item.hypothesis);
      const verdict2 = str(item.verdict);
      if (!hyps.has(hypothesis)) {
        dropped.push({ why: `未知假设编号 ${hypothesis || "（空）"}` });
        continue;
      }
      if (!VERDICTS.includes(verdict2)) {
        dropped.push({ why: `${hypothesis} 的建议类型无效：${verdict2 || "（空）"}` });
        continue;
      }
      const cited = asArray(item.based_on).map((id) => str(id)).filter(Boolean);
      const unknown = cited.filter((id) => !exps.has(id));
      for (const id of unknown) dropped.push({ why: `${hypothesis} 引用了未知实验编号 ${id}` });
      const basedOn = cited.filter((id) => exps.has(id));
      if (!basedOn.length) {
        dropped.push({ why: `${hypothesis} 没有可核对的实验依据` });
        continue;
      }
      settlements.push({ hypothesis, verdict: verdict2, based_on: basedOn, reason: str(item.reason) });
    }
    const spillover = [];
    for (const item of asArray(body.spillover).map(asRecord)) {
      const experiment = str(item.experiment);
      if (!exps.has(experiment)) {
        dropped.push({ why: `旁证引用了未知实验编号 ${experiment || "（空）"}` });
        continue;
      }
      spillover.push({ experiment, hypothesis: str(item.hypothesis), note: str(item.note) });
    }
    return { ok: true, settlements, spillover, dropped, notes: str(body.notes) };
  }
  function renderRehearsalMarkdown2(parsed, meta) {
    const cell = (value) => value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
    const lines = [
      "---",
      "type: p7-rehearsal-draft",
      `generated_at: ${meta.at}`,
      `project: "${meta.project.replace(/"/g, "'")}"`,
      `agent: ${meta.agent}`,
      "status: suggestion",
      "---",
      "",
      "# P7 结算预演建议",
      "",
      "> 这是一份建议草稿，不改变任何假设账本。结算需研究员逐条确认后另行执行。",
      "",
      "| 假设 | 建议 | 依据 | 理由 |",
      "| --- | --- | --- | --- |",
      ...parsed.settlements.length ? parsed.settlements.map((s) => `| ${s.hypothesis} | ${VERDICT_LABEL2[s.verdict]} | ${s.based_on.join("、")} | ${cell(s.reason)} |`) : ["| — | — | — | 无通过校验的建议 |"]
    ];
    if (parsed.spillover.length) {
      lines.push("", "## 旁证", "", ...parsed.spillover.map((s) => `- ${s.experiment} → ${s.hypothesis || "（未指明）"}：${s.note}`));
    }
    if (parsed.notes) lines.push("", "## 说明", "", parsed.notes);
    if (parsed.dropped.length) lines.push("", "## 幻觉防护丢弃", "", ...parsed.dropped.map((d) => `- ${d.why}`));
    return `${lines.join("\n")}
`;
  }
  function awaitingFrom(scan, hypothesisId) {
    let awaiting = asArray(asRecord(scan).awaiting_integration).map(asRecord);
    if (hypothesisId) {
      awaiting = awaiting.filter((e) => asArray(e.tests_hypotheses).map(asRecord).some((h) => h.display_id === hypothesisId));
    }
    return awaiting;
  }

  // src/features/tools/misc/projects.ts
  async function stateRead2(ctx, action, input) {
    const read = await must(ctx, statePath4(action, input), { timeoutMs: 3e4 });
    return asRecord(read).result ?? null;
  }
  async function readWorkspaceFile(ctx, relative) {
    const read = await ctx.request(workspaceFilePath(relative));
    if (!read.ok) return "";
    const body = asRecord(read.data);
    return body.exists === true ? str(body.content) : "";
  }
  var projectRegistryTool = {
    id: "project-registry",
    label: "课题登记",
    title: "课题注册表与 P7 结算预演（只读）",
    placement: "action",
    requiresRuntime: true,
    render(container, ctx) {
      const doc = ctx.document;
      let disposed = false;
      let busy = false;
      const registry = section(doc, "课题注册表", "project-registry");
      const list4 = el(doc, "div", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "project-list" } });
      const refresh = button(doc, "刷新", () => void loadRegistry(), { "data-role": "project-refresh" });
      registry.append(actions(doc, refresh), list4);
      let openId = "";
      const loadRegistry = async () => {
        list4.replaceChildren(line(doc, "正在读取课题注册表…"));
        try {
          const projects = projectsFrom(await stateRead2(ctx, "project.list"));
          if (disposed) return;
          if (!projects.length) {
            list4.replaceChildren(line(doc, "课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。"));
            return;
          }
          list4.replaceChildren(...projects.map((project) => {
            const row = el(doc, "div", { cls: "scholarium-weaver__tool-item", attrs: { "data-project": project.displayId } });
            const head = el(doc, "div");
            head.append(el(doc, "b", { text: project.displayId }), el(doc, "span", { cls: "scholarium-weaver__tool-muted", text: ` ${project.status}${project.stage ? ` · ${project.stage}` : ""}` }));
            const meta = el(doc, "div", { cls: "scholarium-weaver__tool-muted", text: `假设 ${project.counts.hypotheses} · 实验 ${project.counts.experiments} · 证据 ${project.counts.evidence}` });
            const detail = el(doc, "div", { attrs: { "data-role": "project-detail" } });
            detail.hidden = true;
            const toggle = button(doc, "详情", () => void toggleDetail(project.displayId, detail), { "data-role": "project-detail-toggle" });
            row.append(head, el(doc, "div", { text: project.title || "（无标题）" }), meta);
            if (project.unsettledExperiments) row.append(el(doc, "span", { cls: "scholarium-weaver__tool-pill", text: `待结算 ${project.unsettledExperiments}` }));
            row.append(actions(doc, toggle), detail);
            return row;
          }));
        } catch (error) {
          if (!disposed) list4.replaceChildren(line(doc, `课题注册表读取失败：${messageOf(error)}`, void 0, "scholarium-weaver__tool-error"));
        }
      };
      const toggleDetail = async (displayId, detail) => {
        if (openId === displayId && !detail.hidden) {
          detail.hidden = true;
          openId = "";
          return;
        }
        openId = displayId;
        detail.hidden = false;
        detail.replaceChildren(line(doc, "正在读取课题详情…"));
        try {
          const data = projectDetailFrom(await stateRead2(ctx, "project.get", { display_id: displayId }));
          if (disposed) return;
          const rows = data.hypotheses.map((h) => el(doc, "li", { cls: "scholarium-weaver__tool-item", text: `${h.displayId} · ${h.statement || "（无陈述）"} · 支持/反驳/限定/待审/驳回 ${h.tally}`, attrs: { "data-hypothesis": h.displayId } }));
          const table = el(doc, "ul", { cls: "scholarium-weaver__tool-list" });
          table.append(...rows);
          detail.replaceChildren(line(doc, `${data.title}${data.title ? " · " : ""}${data.countsText}`), rows.length ? table : line(doc, "尚无关联假设。"));
        } catch (error) {
          if (!disposed) detail.replaceChildren(line(doc, `课题详情读取失败：${messageOf(error)}`, void 0, "scholarium-weaver__tool-error"));
        }
      };
      const rehearsal = section(doc, "结算预演（P7 闭环回扫 · 只读）", "rehearsal");
      const result = el(doc, "div", { attrs: { "data-role": "rehearsal-result" } });
      const run = button(doc, "结算预演", () => void runRehearsal(), {
        "data-role": "run-rehearsal",
        title: "P7 闭环回扫的只读预演：捞出已出结论但未结算的实验，让 Agent 给出假设结算建议草稿。不写任何正式对象，建议笔记需你确认后才落盘。"
      });
      rehearsal.append(line(doc, "捞出已出结论但未结算的实验，让 Agent 给出假设结算建议草稿。不写任何正式对象；建议笔记需你确认后才落盘。"), actions(doc, run), result);
      const progress = (text6, tone = "muted") => {
        if (disposed) return;
        const node2 = line(doc, text6, "rehearsal-progress");
        setLine(node2, text6, tone);
        result.replaceChildren(node2);
      };
      const runRehearsal = async () => {
        if (busy) return;
        busy = true;
        run.disabled = true;
        try {
          const agentId = ctx.scope().agentId;
          if (!agentId) {
            progress("没有可用的已安装 Agent CLI（未选择 Agent）。", "error");
            return;
          }
          progress("第 1/4 步：扫描未结算实验…");
          const awaiting = awaitingFrom(await stateRead2(ctx, "experiment.scan_outcomes"));
          if (!awaiting.length) {
            progress("没有待结算的实验（concluded 但未 integrated）。结算预演无事可做——这本身就是闭环健康的好信号。");
            return;
          }
          progress(`第 2/4 步：读取 ${awaiting.length} 个实验的完整结论与被测假设原文…`);
          let projectIds = [...new Set(awaiting.map((e) => str(e.project_display_id)).filter(Boolean))];
          if (!projectIds.length) projectIds = projectsFrom(await stateRead2(ctx, "project.list")).map((p) => p.displayId);
          const byId = /* @__PURE__ */ new Map();
          for (const pid of projectIds) {
            const detail = asRecord(await stateRead2(ctx, "project.get", { display_id: pid }));
            for (const h of asArray(detail.hypotheses).map(asRecord)) {
              const full = str(h.path) ? await readWorkspaceFile(ctx, str(h.path)) : "";
              byId.set(str(h.display_id), {
                display_id: str(h.display_id),
                statement: extractFrontmatterField2(full, "statement") || str(h.statement),
                status: str(h.status),
                settlement: h.settlement
              });
            }
          }
          const experiments = [];
          for (const e of awaiting) {
            const full = str(e.path) ? await readWorkspaceFile(ctx, str(e.path)) : "";
            experiments.push({
              display_id: str(e.display_id),
              title: str(e.title),
              conclusion: extractFrontmatterField2(full, "conclusion") || str(e.conclusion_excerpt),
              tests: asArray(e.tests_hypotheses).map((h) => str(asRecord(h).display_id)).filter(Boolean),
              data_origin: e.data_origin ?? null
            });
          }
          const involved = [...new Set(experiments.flatMap((e) => e.tests))];
          const hypotheses = involved.map((id) => byId.get(id)).filter((h) => Boolean(h));
          if (!hypotheses.length) {
            progress("待结算实验没有可解析的被测假设，预演中止。", "error");
            return;
          }
          const projectLabel = projectIds.join("、") || "（未关联课题）";
          const ok2 = await ctx.confirm(`将对 ${experiments.length} 个未结算实验 × ${hypotheses.length} 条假设运行 P7 结算预演（${projectLabel}）。

Agent（${agentId}）只读分析，产出结算建议草稿；不写入任何正式对象。是否继续？`);
          if (!ok2) {
            progress("已取消预演。");
            return;
          }
          progress(`第 3/4 步：${agentId} 正在结算分析（只读，可能需要几分钟）…`);
          const prompt = buildRehearsalPrompt2({ project: { display_id: projectLabel }, hypotheses, experiments });
          const answer = await ctx.askAgent(prompt, { agentId });
          if (!answer.ok) {
            progress(`预演失败：${answer.error}`, "error");
            return;
          }
          const parsed = parseRehearsalReply2(answer.text, { hypotheses: involved, experiments: experiments.map((e) => e.display_id) });
          if (!parsed.ok) {
            if (disposed) return;
            const raw = el(doc, "pre", { cls: "scholarium-weaver__tool-pre", text: answer.text.slice(0, 500) });
            result.replaceChildren(line(doc, `${parsed.error}。原始回复前 500 字：`, "rehearsal-progress", "scholarium-weaver__tool-error"), raw);
            return;
          }
          progress("第 4/4 步：校验完成。");
          renderCard(parsed, { project: projectLabel, agent: agentId });
        } catch (error) {
          progress(`预演失败：${messageOf(error)}`, "error");
        } finally {
          busy = false;
          run.disabled = false;
        }
      };
      const renderCard = (parsed, meta) => {
        if (disposed) return;
        const card = el(doc, "div", { cls: "scholarium-weaver__tool-item", attrs: { "data-role": "rehearsal-card" } });
        const head = el(doc, "div");
        head.append(el(doc, "b", { text: "P7 结算预演建议" }), el(doc, "span", { cls: "scholarium-weaver__tool-muted", text: ` ${meta.project} · ${meta.agent} · 未写入任何正式对象` }));
        const rows = el(doc, "ul", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "rehearsal-settlements" } });
        if (parsed.settlements.length) {
          rows.append(...parsed.settlements.map((s) => el(doc, "li", { cls: "scholarium-weaver__tool-item", text: `${s.hypothesis} · ${VERDICT_LABEL2[s.verdict]} · 依据 ${s.based_on.join("、")} · ${s.reason}`, attrs: { "data-hypothesis": s.hypothesis } })));
        } else {
          rows.append(el(doc, "li", { cls: "scholarium-weaver__tool-muted", text: "无通过校验的建议" }));
        }
        card.append(head, rows);
        if (parsed.notes) card.append(el(doc, "p", { text: parsed.notes }));
        if (parsed.spillover.length) card.append(line(doc, `旁证 ${parsed.spillover.length} 条（结论指向未声明测试的假设，详见草稿）。`));
        if (parsed.dropped.length) card.append(line(doc, `幻觉防护丢弃 ${parsed.dropped.length} 条：${parsed.dropped.map((d) => d.why).join("；")}`, "rehearsal-dropped"));
        const saveState = line(doc, "", "rehearsal-save-state");
        const save = button(doc, "存为建议笔记（需确认）", () => void saveDraft(parsed, meta, save, saveState), { "data-role": "save-rehearsal" });
        card.append(actions(doc, save), saveState);
        result.replaceChildren(card);
      };
      const saveDraft = async (parsed, meta, save, state) => {
        save.disabled = true;
        try {
          const at = ctx.now();
          const stamp = at.replace(/[:.]/g, "-").slice(0, 19);
          const relative = `Research/_runs/p7-rehearsal/${stamp}.md`;
          const content = renderRehearsalMarkdown2(parsed, { ...meta, at });
          const draft = await ctx.request("/v1/drafts", { method: "POST", body: { path: relative, content } });
          if (!draft.ok) {
            setLine(state, `建议笔记写入失败：${failure3(draft)}`, "error");
            return;
          }
          const id = str(asRecord(draft.data).id);
          const path2 = str(asRecord(draft.data).path) || relative;
          if (!id) {
            setLine(state, "建议笔记写入失败：Bridge 没有返回草稿编号。", "error");
            return;
          }
          if (!await ctx.confirm(`建议笔记已生成预览（${path2}）。
写入后仅是一份草稿笔记，不会改变任何假设账本。确认写入？`)) {
            setLine(state, "已取消写入；预览会在过期后自动丢弃。");
            return;
          }
          const commit = await ctx.request(`/v1/drafts/${encodeURIComponent(id)}/commit`, { method: "POST", confirmed: true });
          if (!commit.ok) {
            setLine(state, `建议笔记写入失败：${failure3(commit)}`, "error");
            return;
          }
          setLine(state, `建议笔记已写入 ${path2}`, "ok");
          ctx.notice(`建议笔记已写入 ${path2}`, "info");
        } finally {
          save.disabled = false;
        }
      };
      container.append(registry, rehearsal);
      void loadRegistry();
      return () => {
        disposed = true;
      };
    }
  };

  // src/features/tools/misc/image-settings.ts
  function loadedProvider(loaded) {
    return imageProvider(loaded.provider || (loaded.endpoint ? "custom" : "siliconflow")).id;
  }
  function imagePatch(fields, loaded) {
    const patch = {
      provider: fields.provider,
      endpoint: fields.endpoint.trim().replace(/\/+$/, ""),
      model: fields.model.trim(),
      size: fields.size.trim(),
      ...fields.apiKey.trim() && !fields.clearKey ? { apiKey: fields.apiKey.trim() } : {},
      ...fields.clearKey ? { clearKey: true } : {}
    };
    const same = patch.provider === loaded.provider && patch.endpoint === loaded.endpoint && patch.model === loaded.model && patch.size === loaded.size;
    if (same && !patch.apiKey && !patch.clearKey) return null;
    if (patch.endpoint && !/^https:\/\//i.test(patch.endpoint)) throw new Error("服务地址必须以 https:// 开头。");
    if (patch.size && !/^(\d{3,5}x\d{3,5}|[124]K)$/i.test(patch.size)) throw new Error(`固定尺寸“${patch.size}”格式不对：应为 1024x1024 这样的宽x高，或 1K / 2K / 4K。`);
    return patch;
  }
  function renderImageSettings(doc, box, service, say) {
    const draw = (loaded) => {
      const field = (label, control, hint) => {
        const wrap = el(doc, "label", { cls: "scholarium-weaver__tool-field" });
        const hintEl = line(doc, hint);
        wrap.append(el(doc, "span", { text: label }), control, hintEl);
        box.append(wrap);
        return hintEl;
      };
      const provider = el(doc, "select", { cls: "dropdown", attrs: { "data-role": "image-provider" } });
      for (const item of IMAGE_PROVIDERS) {
        const option = el(doc, "option", { text: item.label, attrs: { value: item.id } });
        option.value = item.id;
        provider.append(option);
      }
      provider.value = loadedProvider(loaded);
      const providerHint = field("服务商", provider, "");
      const endpoint = el(doc, "input", { attrs: { type: "text", "data-role": "image-endpoint", placeholder: "https://…/v1", spellcheck: "false" } });
      endpoint.value = loaded.endpoint;
      field("服务地址", endpoint, "不含 /images/generations；必须是 https://。选服务商会自动填写。");
      const listId = `sch-image-models-${Math.random().toString(36).slice(2, 8)}`;
      const model = el(doc, "input", { attrs: { type: "text", "data-role": "image-model", list: listId, spellcheck: "false" } });
      model.value = loaded.model;
      const models = el(doc, "datalist", { attrs: { id: listId } });
      box.append(models);
      field("模型", model, "可从建议中选，也可以手填服务商的其他模型名。");
      const size = el(doc, "input", { attrs: { type: "text", "data-role": "image-size", placeholder: "留空：按图卡要求自动选", spellcheck: "false" } });
      size.value = loaded.size;
      field("固定尺寸（可选）", size, "如 1024x1024 或 2K。留空时按图卡的宽高比挑模型支持的最接近尺寸。");
      const keyText = (clear2) => clear2 ? "保存后删除已保存的密钥" : loaded.hasKey ? "已设置（留空则不修改）" : "未设置";
      const key = el(doc, "input", { attrs: { type: "password", autocomplete: "off", "data-role": "image-key", placeholder: keyText(false) } });
      const keyHint = field("API 密钥", key, "");
      let clearKey = false;
      const clear = button(doc, "删除密钥", () => {
        clearKey = !clearKey;
        clear.textContent = clearKey ? "撤销删除" : "删除密钥";
        key.value = "";
        key.disabled = clearKey;
        key.setAttribute("placeholder", keyText(clearKey));
      }, { "data-role": "image-key-clear" });
      clear.hidden = !loaded.hasKey;
      const save = button(doc, "保存生图设置", () => void (async () => {
        let patch;
        try {
          patch = imagePatch({ provider: provider.value, endpoint: endpoint.value, model: model.value, size: size.value, apiKey: key.value, clearKey }, loaded);
        } catch (error) {
          say(`AI 生图：${messageOf(error)}`, "error");
          return;
        }
        if (!patch) {
          say("AI 生图：没有改动。");
          return;
        }
        save.disabled = true;
        try {
          await service.save(patch);
          key.value = "";
          say(patch.clearKey ? "AI 生图：已删除密钥，其余设置已保存到密钥文件。" : "AI 生图：已保存到密钥文件。", "ok");
          box.replaceChildren(line(doc, "正在读取…"));
          await load();
        } catch (error) {
          say(`AI 生图保存失败：${messageOf(error)}`, "error");
        } finally {
          key.value = "";
          save.disabled = false;
        }
      })(), { "data-role": "image-save" });
      box.append(actions(doc, save, clear));
      box.append(line(doc, `保存位置：${loaded.file || "Scholarium 密钥文件"}（与其他 API Key 同一个文件，不在 Vault 中；Agent 读不到）。`, "image-secrets-file"));
      const presetEndpoints = new Set(IMAGE_PROVIDERS.map((item) => item.endpoint).filter(Boolean));
      const presetModels = new Set(IMAGE_PROVIDERS.flatMap((item) => item.models));
      const describe2 = () => {
        const chosen = imageProvider(provider.value);
        providerHint.textContent = chosen.id === "custom" ? "任何提供 OpenAI 兼容 /images/generations 接口的服务。" : `接口：${chosen.endpoint}/images/generations`;
        keyHint.textContent = chosen.keyHint;
        models.replaceChildren(...chosen.models.map((name) => {
          const option = el(doc, "option", { attrs: { value: name } });
          option.value = name;
          return option;
        }));
      };
      provider.addEventListener("change", () => {
        const chosen = imageProvider(provider.value);
        if (chosen.endpoint && (!endpoint.value.trim() || presetEndpoints.has(endpoint.value.trim()))) endpoint.value = chosen.endpoint;
        if (chosen.models.length && (!model.value.trim() || presetModels.has(model.value.trim()))) model.value = chosen.models[0];
        describe2();
      });
      describe2();
      if (!loaded.endpoint && !loaded.model) {
        const chosen = imageProvider(provider.value);
        endpoint.value = chosen.endpoint;
        model.value = chosen.models[0] ?? "";
      }
    };
    const load = async () => {
      try {
        const loaded = await service.load();
        box.replaceChildren();
        draw(loaded);
      } catch (error) {
        box.replaceChildren(line(doc, `生图设置读取失败：${messageOf(error)}`, void 0, "scholarium-weaver__tool-error"));
      }
    };
    box.replaceChildren(line(doc, "正在读取…"));
    void load();
  }

  // src/features/tools/misc/settings.ts
  var settingsCenterTool = {
    id: "settings-center",
    label: "设置中心",
    title: "Agent 接入状态与 API 钥匙串：所有可自行配置的项目、申请入口与降级说明都在这里",
    placement: "action",
    requiresRuntime: true,
    render(container, ctx) {
      const doc = ctx.document;
      let disposed = false;
      const status = line(doc, "", "settings-status");
      const say = (text6, tone = "muted") => {
        if (!disposed) setLine(status, text6, tone);
      };
      container.append(line(doc, "所有可自行配置的项目都在这里：用哪个 Agent、哪些 API 钥匙（点标题展开或折叠）。每一项都标注用途、费用与申请入口；没有配置时会明确说明降级后还能用什么。密钥只保存在本机 bridge/.env，不会进入任何明文配置或聊天内容，本页也不显示密钥内容。"));
      const agentBox = foldSection(doc, "Agent 接入", "settings-agents", true);
      const agentList = el(doc, "div", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "agent-list" } });
      agentBox.append(line(doc, "织研者调用你本机已登录的 Agent CLI 执行任务。状态由 Bridge 实时探测。"), agentList);
      const loadAgents = async () => {
        agentList.replaceChildren(line(doc, "正在读取…"));
        const read = await ctx.request("/v1/agents");
        if (disposed) return;
        if (!read.ok) {
          agentList.replaceChildren(line(doc, `无法读取 Agent 状态：${failure3(read)}（Bridge 未连接？）`, void 0, "scholarium-weaver__tool-error"));
          return;
        }
        const agents = agentViews(read.data);
        if (!agents.length) {
          agentList.replaceChildren(line(doc, "Bridge 未报告任何 Agent 适配器。"));
          return;
        }
        agentList.replaceChildren(...agents.map((agent) => {
          const row = el(doc, "div", { cls: "scholarium-weaver__tool-item", attrs: { "data-agent": agent.id } });
          row.append(el(doc, "b", { text: agent.label }), el(doc, "span", { cls: agent.available ? "scholarium-weaver__tool-ok" : "scholarium-weaver__tool-muted", text: ` ${agent.text}` }));
          if (agent.guide) row.append(el(doc, "span", { text: " " }), link(doc, "安装与登录指引", agent.guide));
          return row;
        }));
      };
      const credBox = foldSection(doc, "API 钥匙串", "settings-credentials");
      const credList = el(doc, "div", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "credential-list" } });
      const migrate = button(doc, "迁移遗留明文密钥", () => void migrateLegacy(), { "data-role": "migrate-secrets", title: "把 bridge.config.json 里遗留的明文密钥搬进 bridge/.env 并从配置中清除" });
      credBox.append(credList, actions(doc, migrate));
      const credentialCard = (item) => {
        const card = el(doc, "div", { cls: "scholarium-weaver__tool-item", attrs: { "data-credential": item.envVar } });
        const head = el(doc, "div");
        head.append(el(doc, "b", { text: item.label }), el(doc, "span", { cls: "scholarium-weaver__tool-muted", text: item.costLabel ? ` ${item.costLabel}` : "" }));
        const input = el(doc, "input", {
          cls: "scholarium-weaver__tool-field",
          attrs: {
            type: "password",
            autocomplete: "off",
            "data-role": "credential-input",
            placeholder: item.configured ? "已配置（输入新值以替换）" : `粘贴 ${item.label} 的${item.isEmail ? "邮箱" : "密钥"}`
          }
        });
        const save = button(doc, "保存", () => void saveCredential(item, input, save), { "data-role": "credential-save" });
        const row = actions(doc, input, save);
        if (item.applyUrl) row.append(link(doc, "去申请", item.applyUrl));
        card.append(
          head,
          line(doc, item.purpose),
          el(doc, "p", { cls: item.configured ? "scholarium-weaver__tool-ok" : "scholarium-weaver__tool-muted", text: item.stateText, attrs: { "data-role": "credential-state" } }),
          row
        );
        return card;
      };
      const loadCredentials = async () => {
        credList.replaceChildren(line(doc, "正在读取…"));
        const read = await ctx.request("/v1/settings/credentials");
        if (disposed) return;
        if (!read.ok) {
          credList.replaceChildren(line(doc, `无法读取凭据状态：${failure3(read)}（Bridge 未连接或版本过旧？）`, void 0, "scholarium-weaver__tool-error"));
          return;
        }
        credList.replaceChildren(...credentialViews(read.data).map(credentialCard));
      };
      const saveCredential = async (item, input, save) => {
        const value = String(input.value ?? "").trim();
        const verdict2 = validateCredential(item.envVar, value);
        if (verdict2 !== true) {
          say(`${item.label}：${verdict2}`, "error");
          return;
        }
        if (!await ctx.confirm(`把新的 ${item.label} ${item.isEmail ? "邮箱" : "密钥"}保存到本机 bridge/.env？${item.configured ? "\n会替换已配置的值。" : ""}`)) {
          say(`${item.label}：已取消，没有保存。`);
          return;
        }
        save.disabled = true;
        try {
          const sent = await ctx.request("/v1/settings/credentials", { method: "POST", body: { envVar: item.envVar, value }, confirmed: true });
          if (!sent.ok) {
            say(`${item.label} 保存失败：${failure3(sent)}`, "error");
            return;
          }
          input.value = "";
          say(`${item.label} 已保存到 bridge/.env。`, "ok");
          await loadCredentials();
          if (item.envVar === "HF_TOKEN") await loadRag();
        } finally {
          input.value = "";
          save.disabled = false;
        }
      };
      const migrateLegacy = async () => {
        if (!await ctx.confirm("把 bridge.config.json 里遗留的明文密钥搬进 bridge/.env，并从配置文件中清除？")) return;
        migrate.disabled = true;
        try {
          const sent = await ctx.request("/v1/settings/credentials/migrate", { method: "POST", body: {}, confirmed: true });
          if (!sent.ok) {
            say(`迁移失败：${failure3(sent)}`, "error");
            return;
          }
          const migrated = asArray(asRecord(sent.data).migrated).map((m) => str(asRecord(m).envVar)).filter(Boolean);
          say(migrated.length ? `已迁移 ${migrated.length} 项：${migrated.join("、")}。bridge.config.json 中对应明文已清除。` : "没有发现遗留明文密钥，无需迁移。", "ok");
          await loadCredentials();
        } finally {
          migrate.disabled = false;
        }
      };
      const ragBox = foldSection(doc, "论文 RAG", "settings-rag");
      const ragStatus = line(doc, "正在读取索引状态…", "rag-status");
      const loadRag = async () => {
        setLine(ragStatus, "正在读取索引状态…");
        const read = await ctx.request("/v1/rag/status", { timeoutMs: 6e4 });
        if (disposed) return;
        setLine(ragStatus, read.ok ? ragStatusText(asRecord(read.data).manifest) : `无法读取 RAG 状态：${failure3(read)}`, read.ok ? "muted" : "error");
      };
      const reindex = button(doc, "向量化现有语料", () => void runReindex(), { "data-role": "rag-reindex", title: "使用当前 Hugging Face 模型为旧 chunks 补算或重算向量" });
      const runReindex = async () => {
        if (!await ctx.confirm("这会调用 Hugging Face 云端额度，为全部缺失或旧模型 chunks 生成向量。继续吗？")) return;
        reindex.disabled = true;
        say("正在向量化现有语料；请勿关闭 Bridge…");
        try {
          const sent = await ctx.request("/v1/rag/reindex", { method: "POST", body: {}, confirmed: true, timeoutMs: 18e5 });
          if (!sent.ok) {
            say(`向量化失败：${failure3(sent)}`, "error");
            return;
          }
          const vec = asRecord(asRecord(asRecord(sent.data).manifest).vectorization);
          say(`向量化完成：本次 ${str(vec.embedded) || "0"} chunks，维度 ${str(vec.dimensions) || "未知"}。`, "ok");
          await loadRag();
        } finally {
          reindex.disabled = false;
        }
      };
      const preview = button(doc, "预演知识图谱", () => void runPreview(), { "data-role": "rag-graph-preview", title: "只生成知识图谱 dry-run，不写入 Vault" });
      const runPreview = async () => {
        preview.disabled = true;
        say("正在从 RAG chunks 预演知识图谱…");
        try {
          const sent = await ctx.request("/v1/rag/graph", { method: "POST", body: { limit: 50 }, timeoutMs: 3e5 });
          if (!sent.ok) {
            say(`知识图谱预演失败：${failure3(sent)}`, "error");
            return;
          }
          say(graphPreviewText(sent.data), "ok");
          await loadKeywords();
        } finally {
          preview.disabled = false;
        }
      };
      ragBox.append(ragStatus, actions(doc, button(doc, "刷新状态", () => void loadRag(), { "data-role": "rag-refresh" }), reindex, preview));
      const kwBox = foldSection(doc, "图谱关键词", "settings-graph-keywords");
      const kwSource = line(doc, "正在读取…", "graph-keyword-source");
      const kwInput = el(doc, "textarea", { cls: "scholarium-weaver__tool-field", attrs: { rows: "3", "data-role": "graph-keyword-input", placeholder: "每行或逗号分隔一个词；留空并保存＝退回仅用内置领域正则" } });
      const kwHint = line(doc, "", "graph-keyword-hint");
      let suggestions = [];
      const loadKeywords = async () => {
        const read = await ctx.request("/v1/rag/graph/keywords");
        if (disposed) return;
        if (!read.ok) {
          setLine(kwSource, `读取关键词失败：${failure3(read)}`, "error");
          return;
        }
        const view = graphKeywordView(read.data);
        suggestions = view.suggestions;
        kwInput.value = view.box;
        setLine(kwSource, view.source);
        setLine(kwHint, view.hint);
      };
      const saveKeywords = async (keywords) => {
        const sent = await ctx.request("/v1/rag/graph/keywords", { method: "POST", body: { keywords }, confirmed: true });
        if (!sent.ok) throw new Error(failure3(sent));
        await loadKeywords();
        return asRecord(sent.data);
      };
      const kwSave = button(doc, "保存关键词", () => void (async () => {
        const keywords = parseKeywordInput(kwInput.value);
        if (!await ctx.confirm(keywords.length ? `把这 ${keywords.length} 个关键词固定为知识图谱关键词（写入 bridge.config.json）？` : "保存为空＝不使用额外关键词、只用内置领域正则（写入 bridge.config.json）。继续？")) return;
        try {
          const payload = await saveKeywords(keywords);
          say(keywords.length ? `已固定 ${asArray(payload?.configured).length} 个关键词。` : "已设为不使用额外关键词（只用内置正则）。想恢复自动推导请点「恢复自动推导」。", "ok");
        } catch (error) {
          say(`保存关键词失败：${messageOf(error)}`, "error");
        }
      })(), { "data-role": "graph-keyword-save" });
      const kwAdopt = button(doc, "采纳语料建议", () => {
        if (!suggestions.length) {
          say("暂无可采纳的语料建议。");
          return;
        }
        const merged = [.../* @__PURE__ */ new Set([...parseKeywordInput(kwInput.value), ...suggestions])];
        kwInput.value = merged.join(", ");
        say(`已填入 ${merged.length} 个候选词，请删掉不需要的（作者名、期刊缩写等）后再点「保存关键词」。`);
      }, { "data-role": "graph-keyword-adopt" });
      const kwReset = button(doc, "恢复自动推导", () => void (async () => {
        if (!await ctx.confirm("清除固定关键词，改为每次预演时自动从语料推导（写入 bridge.config.json）？")) return;
        try {
          const payload = await saveKeywords(null);
          say(`已恢复自动推导，本次会用 ${asArray(payload?.effective).length} 个从语料推导的词。`, "ok");
        } catch (error) {
          say(`恢复失败：${messageOf(error)}`, "error");
        }
      })(), { "data-role": "graph-keyword-reset" });
      kwBox.append(kwSource, kwInput, kwHint, actions(doc, kwSave, kwAdopt, kwReset));
      let imageBox = null;
      if (ctx.imageService) {
        imageBox = foldSection(doc, "AI 生图", "settings-image");
        const imageBody = el(doc, "div", { attrs: { "data-role": "image-settings" } });
        imageBox.append(line(doc, "织研者对话里「AI 生图」图卡用的服务。选服务商、填模型和密钥；保存到 Scholarium 密钥文件（与其他 API Key 同一个文件）。"), imageBody);
        renderImageSettings(doc, imageBody, ctx.imageService, say);
      }
      container.append(...[agentBox, credBox, imageBox, ragBox, kwBox].filter((box) => box !== null), status);
      void loadAgents();
      void loadCredentials();
      void loadRag();
      void loadKeywords();
      return () => {
        disposed = true;
      };
    }
  };

  // src/features/tools/misc/webvpn.ts
  async function readWebvpnStatus(ctx) {
    const read = await must(ctx, workspaceFilePath(WEBVPN_LOGIN_STATUS_PATH));
    const body = asRecord(read);
    return body.exists === true ? webvpnStatusFrom(body.content) : null;
  }
  var webvpnTool = {
    id: "webvpn",
    label: "WebVPN",
    title: "登录/刷新 WebVPN：复用本机浏览器的 WebVPN/CARSI 登录态给机构通道下载",
    placement: "action",
    requiresRuntime: true,
    render(container, ctx) {
      const doc = ctx.document;
      let disposed = false;
      let busy = false;
      const box = section(doc, "WebVPN / CARSI 会话", "webvpn");
      const status = line(doc, "正在读取登录状态…", "webvpn-status");
      const urlInput = el(doc, "input", { cls: "scholarium-weaver__tool-field", attrs: { type: "text", "data-role": "webvpn-url", "aria-label": "WebVPN 门户地址" } });
      urlInput.value = DEFAULT_WEBVPN_URL;
      const progress = line(doc, "", "webvpn-progress");
      const note = line(doc, "账号密码不经过 Scholarium：自动登录由你机构的本地脚本在仓库外读取凭据；手动登录在弹出的 Chrome 中完成，登录成功后窗口会自动关闭。");
      const refreshStatus = async () => {
        setLine(status, "正在读取登录状态…");
        try {
          const current = await readWebvpnStatus(ctx);
          if (!disposed) setLine(status, webvpnStatusText(current), current?.loggedIn ? "ok" : "muted");
        } catch (error) {
          if (!disposed) setLine(status, `无法读取登录状态：${messageOf(error)}`, "error");
        }
      };
      const refresh = async () => {
        if (busy) return;
        const url = urlInput.value.trim() || DEFAULT_WEBVPN_URL;
        busy = true;
        go.disabled = true;
        try {
          const workspace = asRecord(await must(ctx, "/v1/workspace"));
          const root = typeof workspace.root === "string" ? workspace.root : "";
          if (workspace.isDirectory !== true || !root) throw new Error("请先设置存在的课题工作区。");
          const ok2 = await ctx.confirm([
            "登录/刷新 WebVPN？",
            "",
            "1. 先把当前工作区重新提交给 Bridge 授权：" + root,
            "2. 尝试自动登录（paper-downloader auto_login，最长 5 分钟；需要你机构的本地登录脚本）；",
            `3. 自动登录未成功时，在本机弹出 Chrome 打开 ${url}，等待你手动完成 WebVPN/CARSI 登录（最长 3 分钟）。`,
            "",
            "登录态保存在工作区 Scholarium/runtime/webvpn-browser-profile，并同步给机构通道；账号密码不经过 Scholarium。"
          ].join("\n"));
          if (!ok2) {
            setLine(progress, "已取消，没有启动任何登录。");
            return;
          }
          setLine(progress, "正在同步工作区授权…");
          const put = await ctx.request("/v1/workspace", { method: "PUT", body: { root }, confirmed: true });
          if (!put.ok) throw new Error(`工作区授权同步失败：${failure3(put)}`);
          setLine(progress, "第 1 步：尝试自动登录…");
          const auto = await runSkill2(ctx, "paper-downloader", {
            workspace: root,
            input: JSON.stringify({ mode: "auto_login", timeoutSec: 300 }),
            confirmed: true,
            stopped: () => disposed,
            onTick: (s) => setLine(progress, `第 1 步：自动登录中…（${s} 秒）`)
          });
          const outcome = autoLoginOutcome(asRecord(auto).manifest);
          if (outcome.loggedIn) {
            setLine(progress, "WebVPN 自动登录成功，会话已验证并同步给机构通道。", "ok");
            ctx.notice("WebVPN 自动登录成功，会话已验证并同步给机构通道。", "info");
            await refreshStatus();
            return;
          }
          setLine(progress, outcome.unavailable ? "自动登录未配置，已切换到人工 WebVPN 登录窗口。" : `自动登录未成功（${outcome.status}），改用手动浏览器登录…`);
          const startedAt = clockMs(ctx);
          const started = await runSkill2(ctx, "paper-downloader", {
            workspace: root,
            input: JSON.stringify({ mode: "login", url, waitMs: WEBVPN_MANUAL_WAIT_MS }),
            confirmed: true,
            stopped: () => disposed
          });
          const manifest = asRecord(asRecord(started).manifest);
          const startError = asRecord(manifest.error);
          if (manifest.error) throw new Error(String(startError.message || startError.status || manifest.error) || "WebVPN 会话刷新失败");
          setLine(progress, "第 2 步：请在弹出的 Chrome 中完成 WebVPN/CARSI 登录…");
          const until = WEBVPN_MANUAL_WAIT_MS + 3e4;
          let waited = 0;
          let last = { status: "running", loggedIn: false, nextStep: "", startedAt: "", exported: null };
          for (; ; ) {
            if (disposed) return;
            try {
              const current = await readWebvpnStatus(ctx);
              if (current && statusBelongsToAttempt(current, startedAt)) {
                last = current;
                if (statusIsTerminal(current)) break;
              }
            } catch {
            }
            if (waited >= until) break;
            await ctx.sleep(2e3);
            waited += 2e3;
            setLine(progress, `第 2 步：等待你在 Chrome 中登录…（${Math.round(waited / 1e3)} 秒）`);
          }
          if (!last.loggedIn) throw new Error(manualLoginFailure(last));
          setLine(progress, manualLoginSuccess(last), "ok");
          ctx.notice(manualLoginSuccess(last), "info");
          await refreshStatus();
        } catch (error) {
          if (!disposed) {
            setLine(progress, `WebVPN 会话刷新失败：${messageOf(error)}`, "error");
            ctx.notice(`WebVPN 会话刷新失败：${messageOf(error)}`);
          }
        } finally {
          busy = false;
          go.disabled = false;
        }
      };
      const go = button(doc, "登录/刷新 WebVPN", () => void refresh(), { "data-role": "webvpn-refresh" });
      const reread = button(doc, "刷新状态", () => void refreshStatus(), { "data-role": "webvpn-reread" });
      box.append(status, el(doc, "label", { cls: "scholarium-weaver__tool-muted", text: "WebVPN 门户地址（手动登录时打开）" }), urlInput, actions(doc, go, reread), progress, note);
      container.append(box);
      void refreshStatus();
      return () => {
        disposed = true;
      };
    }
  };

  // src/features/tools/misc/index.ts
  var MISC_TOOLS = Object.freeze([webvpnTool, fetchFullTextTool, projectRegistryTool, settingsCenterTool]);

  // src/features/tools/seed/bridge.ts
  var BridgeError2 = class extends Error {
    constructor(message, status) {
      super(message);
      this.status = status;
    }
    status;
  };
  async function call(ctx, path2, options) {
    const result = await ctx.request(path2, options);
    if (result.ok) return result.data;
    const status = result.status;
    const reason = result.error || "未知错误";
    throw new BridgeError2(status !== null && !reason.includes(String(status)) ? `${reason}（HTTP ${status}）` : reason, status);
  }
  async function stateFetch(ctx, action, input) {
    const query = `action=${encodeURIComponent(action)}${input ? `&input=${encodeURIComponent(JSON.stringify(input))}` : ""}`;
    const data = await call(ctx, `/v1/scholarium/state?${query}`);
    return data?.result ?? null;
  }
  function stateOf(ctx, displayId) {
    return stateFetch(ctx, "project.get", { display_id: displayId });
  }
  function para(doc, text6, cls = "") {
    return el(doc, "p", { cls, text: text6 });
  }
  var MUTED = "scholarium-weaver__tool-muted";
  var ERROR = "scholarium-weaver__tool-error";
  var OK = "scholarium-weaver__tool-ok";
  function labelled(doc, label, control) {
    const wrap = el(doc, "label", { cls: "scholarium-weaver__tool-field" });
    wrap.append(el(doc, "span", { text: label }), control);
    return wrap;
  }
  function textInput(doc, value, attrs = {}) {
    const input = el(doc, "input", { attrs: { type: "text", ...attrs } });
    input.value = value;
    return input;
  }
  function textArea(doc, value, rows = 2, attrs = {}) {
    const area = el(doc, "textarea", { attrs: { rows: String(rows), ...attrs } });
    area.value = value;
    return area;
  }
  function checkbox(doc, checked, disabled = false, attrs = {}) {
    const box = el(doc, "input", { attrs: { type: "checkbox", ...attrs } });
    box.checked = checked;
    box.disabled = disabled;
    return box;
  }
  function select(doc, options, selected, attrs = {}) {
    const node2 = el(doc, "select", { attrs });
    for (const [value, label] of options) {
      const option = el(doc, "option", { text: label, attrs: { value } });
      option.value = value;
      node2.append(option);
    }
    node2.value = options.some(([value]) => value === selected) ? selected : options[0]?.[0] ?? "";
    return node2;
  }

  // src/features/tools/seed/project-mode-core.ts
  var text3 = (value, max = 800) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  var list2 = (value, cap = 12, max = 240) => [...new Set((Array.isArray(value) ? value : []).map((v) => text3(v, max)).filter(Boolean))].slice(0, cap);
  var yaml = (value) => JSON.stringify(String(value ?? ""));
  var safe = (value) => text3(value, 70).replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/[. ]+$/g, "") || "draft";
  function uuidV72(now = Date.now()) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    let stamp = BigInt(now);
    for (let i = 5; i >= 0; i--) {
      bytes[i] = Number(stamp & 255n);
      stamp >>= 8n;
    }
    bytes[6] = 112 | bytes[6] & 15;
    bytes[8] = 128 | bytes[8] & 63;
    const h = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function allocate(prefix, existing = [], count2 = 1) {
    const used = new Set(existing);
    const out2 = [];
    let n = 1;
    while (out2.length < count2) {
      const id = `${prefix}-${String(n++).padStart(3, "0")}`;
      if (!used.has(id)) {
        used.add(id);
        out2.push(id);
      }
    }
    return out2;
  }
  function buildProjectPlanPrompt(projectData) {
    const payload = JSON.stringify(projectData).slice(0, 18e3);
    return `你是 Scholarium 课题模式的 P3-P5 规划 Agent。你可以阅读工作区内本课题已有的文献综合和知识图谱，但只能输出草案，不能声称写入文件或确认科研结论。

课题状态：
${payload}

优先核对 Research/deep-research-synthesis.json、knowledge-graph/knowledge_graph.json、knowledge-graph/knowledge_graph-report.md 和本课题画像；不存在就明确证据不足。图谱中的 inferred 关系只能作为待验证假设，不能当成已确认事实。生成 1-5 条可证伪假设、每条至少一个区分性实验，以及未来一周的可调整任务草案。不要编造 DOI、实验结果、仪器可用性或已有证据。

只输出 JSON：
{"summary":"","evidence_gaps":[],"hypotheses":[{"statement":"","predicts":"","falsified_if":"","assumptions":[],"alternative_explanations":[],"required_tests":[]}],"experiments":[{"title":"","hypothesis_indexes":[0],"independent_variables":[],"dependent_variables":[],"controlled_variables":[],"replicates":"","procedure_outline":[],"estimated_hours":4,"blocked_by":[]}],"week_plan":[{"day":"周一","task":"","experiment_index":0,"hours":2,"dependency":""}]}

索引从 0 开始；experiment_index 可以为 null。`;
  }
  function parseProjectPlanReply(raw) {
    let value;
    try {
      const match = String(raw || "").match(/```(?:json)?\s*([\s\S]*?)```/i);
      value = JSON.parse(match ? match[1] : String(raw || "").slice(String(raw || "").indexOf("{"), String(raw || "").lastIndexOf("}") + 1));
    } catch {
      return { ok: false, error: "Agent 返回的 P3-P5 规划不是有效 JSON" };
    }
    const hypotheses = (Array.isArray(value.hypotheses) ? value.hypotheses : []).slice(0, 5).map((h) => ({
      statement: text3(h.statement, 700),
      predicts: text3(h.predicts, 700),
      falsified_if: text3(h.falsified_if, 700),
      assumptions: list2(h.assumptions),
      alternative_explanations: list2(h.alternative_explanations),
      required_tests: list2(h.required_tests)
    })).filter((h) => h.statement && h.predicts && h.falsified_if);
    if (!hypotheses.length) return { ok: false, error: "没有同时写明 statement、predicts、falsified_if 的可证伪假设" };
    const experiments = (Array.isArray(value.experiments) ? value.experiments : []).slice(0, 8).map((e) => ({
      title: text3(e.title, 300),
      hypothesis_indexes: [...new Set((Array.isArray(e.hypothesis_indexes) ? e.hypothesis_indexes : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < hypotheses.length))],
      independent_variables: list2(e.independent_variables),
      dependent_variables: list2(e.dependent_variables),
      controlled_variables: list2(e.controlled_variables),
      replicates: text3(e.replicates, 200),
      procedure_outline: list2(e.procedure_outline, 16),
      estimated_hours: Math.max(0.5, Math.min(24, Number(e.estimated_hours) || 4)),
      blocked_by: list2(e.blocked_by)
    })).filter((e) => e.title && e.hypothesis_indexes.length);
    if (!experiments.length) return { ok: false, error: "没有与假设索引关联的实验草案" };
    const week_plan = (Array.isArray(value.week_plan) ? value.week_plan : []).slice(0, 20).map((w) => ({
      day: text3(w.day, 20),
      task: text3(w.task, 400),
      experiment_index: w.experiment_index === null || w.experiment_index === void 0 ? null : Number(w.experiment_index),
      hours: Math.max(0.5, Math.min(12, Number(w.hours) || 2)),
      dependency: text3(w.dependency, 240)
    })).filter((w) => w.day && w.task && (w.experiment_index === null || Number.isInteger(w.experiment_index) && w.experiment_index >= 0 && w.experiment_index < experiments.length));
    return { ok: true, value: { summary: text3(value.summary, 1200), evidence_gaps: list2(value.evidence_gaps, 16), hypotheses, experiments, week_plan } };
  }
  function frontmatter(object) {
    const lines = ["---"];
    for (const [key, value] of Object.entries(object)) {
      if (Array.isArray(value)) {
        if (!value.length) lines.push(`${key}: []`);
        else {
          lines.push(`${key}:`);
          for (const item of value) lines.push(`  - ${typeof item === "object" ? JSON.stringify(item) : yaml(item)}`);
        }
      } else if (value && typeof value === "object") {
        lines.push(`${key}:`);
        for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
      } else if (typeof value === "number" || typeof value === "boolean") lines.push(`${key}: ${value}`);
      else lines.push(`${key}: ${yaml(value)}`);
    }
    return lines.concat("---", "").join("\n");
  }
  function isoWeek(date = /* @__PURE__ */ new Date()) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const year = d.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil(((d.getTime() - start.getTime()) / 864e5 + 1) / 7);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  function buildProjectDrafts({ project, parsed, existingHypothesisIds = [], existingExperimentIds = [], at, uidFn = uuidV72 }) {
    if (!project?.uid || !project?.display_id) throw new Error("缺少正式 Project 上下文");
    const value = parsed?.value || parsed;
    const now = at || (/* @__PURE__ */ new Date()).toISOString();
    const hypIds = allocate("HYP", existingHypothesisIds, value.hypotheses.length);
    const hypotheses = value.hypotheses.map((h, i) => ({ ...h, uid: uidFn(), display_id: hypIds[i] }));
    const expIds = allocate("EXP", existingExperimentIds, value.experiments.length);
    const experiments = value.experiments.map((e, i) => ({ ...e, uid: uidFn(), display_id: expIds[i] }));
    const items2 = [];
    hypotheses.forEach((h) => {
      const object = {
        uid: h.uid,
        display_id: h.display_id,
        schema_version: 1,
        type: "hypothesis",
        created_at: now,
        updated_at: now,
        project_uid: project.uid,
        statement: h.statement,
        status: "proposed",
        predicts: h.predicts,
        falsified_if: h.falsified_if,
        supporting_evidence: [],
        contradicting_evidence: [],
        assumptions: h.assumptions,
        alternative_explanations: h.alternative_explanations,
        required_tests: h.required_tests,
        history: [],
        created_by: "ai",
        review_status: "pending"
      };
      items2.push({ path: `Research/Hypotheses/${h.display_id} ${safe(h.statement)}.md`, content: frontmatter(object) + `# ${h.display_id} · 假设草案

## 预测

${h.predicts}

## 证伪条件

${h.falsified_if}

> AI 草案，必须由研究者审阅；未设置人工 confidence。
` });
    });
    experiments.forEach((e) => {
      const tests = e.hypothesis_indexes.map((index) => hypotheses[index].uid);
      const object = {
        uid: e.uid,
        display_id: e.display_id,
        schema_version: 1,
        type: "experiment",
        created_at: now,
        updated_at: now,
        project_uid: project.uid,
        title: e.title,
        tests_hypotheses: tests,
        status: "designed",
        result: "",
        conclusion: "",
        produced_evidence: [],
        raw_data_refs: [],
        data_provenance_note: "P4 设计草案，尚未执行或产生数据；数据来源必须由研究者在执行后声明。",
        variables: { independent: e.independent_variables, dependent: e.dependent_variables, controlled: e.controlled_variables, replicates: e.replicates },
        blocked_by: e.blocked_by,
        estimated_hours: e.estimated_hours,
        created_by: "ai",
        review_status: "pending"
      };
      const outline = e.procedure_outline.map((step, n) => `${n + 1}. ${step}`).join("\n") || "等待研究者补充。";
      items2.push({ path: `Research/Experiments/${e.display_id} ${safe(e.title)}.md`, content: frontmatter(object) + `# ${e.display_id} · ${e.title}

## 操作草案

${outline}

> AI 生成的 designed 草案；转入 ready/running 必须人工确认。
` });
    });
    const week = isoWeek(new Date(now));
    const rows = value.week_plan.map((task) => {
      const exp = task.experiment_index === null ? null : experiments[task.experiment_index];
      return `| ${task.day} | ${task.task} | ${exp?.display_id || "通用"} | ${task.hours} | ${task.dependency || "—"} |`;
    }).join("\n") || "| 待安排 | 研究者拖拽或补充本周任务 | 通用 | 1 | — |";
    const schedulePath = `Research/Projects/${project.display_id}/Schedule/${week}.md`;
    items2.push({ path: schedulePath, content: frontmatter({ artifact: "weekly_schedule_proposal", schema_version: 1, project_uid: project.uid, project_display_id: project.display_id, week, status: "proposed", created_at: now, updated_at: now, experiment_uids: experiments.map((e) => e.uid) }) + `# ${project.display_id} · ${week} 周计划草案

| 日期 | 任务 | 实验 | 工时 | 依赖 |
|---|---|---:|---:|---|
${rows}

> 这是 L2 提议，不代表已经排入博士工作台；请调整后再人工确认。
` });
    return { items: items2, hypotheses, experiments, schedulePath, week };
  }
  function p35ConfirmText(displayId, built) {
    return `${displayId} 的首圈草案已经生成：

假设 ${built.hypotheses.length} 条
实验 ${built.experiments.length} 个
周计划 ${built.week}
共写入 ${built.items.length} 个 Markdown 文件

这些内容全部保持 AI 草案/提议状态，不会自动确认 Evidence、启动实验或提交博士工作台。是否写入？`;
  }
  function projectTopic(project) {
    return String(project?.research_question || project?.thesis || project?.title || "");
  }
  function resumablePipelineCandidate(history, workspace, projectTitle) {
    const candidates = (Array.isArray(history?.pipelines) ? history.pipelines : []).filter((run) => run.resumable && run.workspace === workspace && String(run.title || "").includes(projectTitle || "")).sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
    return candidates.length ? candidates[0] : null;
  }

  // src/features/tools/seed/seed-reconstruction-core.ts
  var text4 = (value, max = 800) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
  var list3 = (value, cap = 12, max = 240) => [...new Set((Array.isArray(value) ? value : []).map((v) => text4(v, max)).filter(Boolean))].slice(0, cap);
  var yaml2 = (value) => JSON.stringify(String(value ?? ""));
  var safe2 = (value) => text4(value, 70).replace(/[\\/:*?"<>|#[\]]/g, "-").replace(/[. ]+$/g, "") || "draft";
  var DOI_RE = /^10\.\d{4,9}\/\S+$/i;
  function frontmatter2(object) {
    const lines = ["---"];
    for (const [key, value] of Object.entries(object)) {
      if (value === void 0) continue;
      if (Array.isArray(value)) {
        if (!value.length) lines.push(`${key}: []`);
        else {
          lines.push(`${key}:`);
          for (const item of value) lines.push(`  - ${typeof item === "object" ? JSON.stringify(item) : yaml2(item)}`);
        }
      } else if (value && typeof value === "object") {
        lines.push(`${key}:`);
        for (const [k, v] of Object.entries(value)) lines.push(`  ${k}: ${JSON.stringify(v)}`);
      } else if (typeof value === "number" || typeof value === "boolean") lines.push(`${key}: ${value}`);
      else lines.push(`${key}: ${yaml2(value)}`);
    }
    return lines.concat("---", "").join("\n");
  }
  function buildCandidateDiscoveryPrompt({ project, seeds, sourceManifest = [] }) {
    const crossrefSources = (Array.isArray(sourceManifest) ? sourceManifest : []).map((source) => ({
      source: source?.source,
      endpoint: source?.endpoint,
      seed_doi: source?.seed_doi,
      fetched_at: source?.fetched_at,
      work: source?.work,
      references: (Array.isArray(source?.references) ? source.references : []).slice(0, 200).map((reference) => ({
        doi: text4(reference.doi, 200),
        title: text4(reference.title, 300),
        journal: text4(reference.journal, 180),
        authors: text4(reference.authors, 180),
        year: Number.isFinite(Number(reference.year)) ? Number(reference.year) : null
      }))
    }));
    const payload = JSON.stringify({
      project_display_id: project?.display_id,
      project_title: project?.title,
      research_question: project?.research_question || project?.thesis || "",
      seeds: list3(seeds, 10, 120),
      crossref_source_manifest: crossrefSources
    }).slice(0, 48e3);
    return [
      "你是 Scholarium 种子文献证据重建的候选发现 Agent，只读权限：只能用检索/抓取类工具查找已发表文献的元数据（标题、期刊、ISSN、年份、作者、DOI）与引用关系（谁引用了种子文献、种子文献引用了谁），不能写入任何文件，不能声称已经准入或确认任何科研结论。",
      "",
      `课题状态：
${payload}`,
      "",
      "下面的 crossref_source_manifest 是 Bridge 刚刚从 Crossref 固定 HTTPS 端点读取并附在本提示里的原始来源清单。候选发现阶段不得调用 WebFetch、WebSearch 或其他工具；只能从这份清单的 references 中挑选候选，不能补写训练记忆里的 DOI。最多输出 12 条候选，且不要输出 tentative_relevance=exclude 的条目。不要把泛泛的“期刊领域相近”当成相关性。题名非空时，必须能从题名直接看出同一材料/核壳体系或可复用的合成/表征方法；题名缺失时，只可保留作者字段与 seed work.authors 中姓氏精确匹配的同作者链条，其他缺题名条目必须省略。对每个候选，source_query 必须原样填写它所属 source_manifest 的 endpoint（不是另拼一个逐篇 URL）；source_response_excerpt 必须摘录该条 reference 的 DOI 和题名/作者字段。题名、期刊、作者、年份必须逐字采用 source_manifest 的相应字段；缺失就留空，绝不可补写或猜测。符合上述条件但应用不同的同体系、同作者链或方法学论文标为 methodology_reference；不要因为不是直接结论证据静默丢弃。Crossref 条目若只有 DOI 而缺题名，但满足同作者条件，仍可作为 methodology_reference 输出，并在 relevance_reason 说明“元数据待后续审阅”。如果清单确实没有任何相关条目，才输出空 candidates 数组；这属于正常结果。",
      "",
      "只输出 JSON：",
      '{"candidates":[{"doi":"","title":"","journal":"","issn":"","year":0,"authors":[],"relation_to_seed":"references|cited_by","source_query":"","source_response_excerpt":"","tentative_relevance":"direct_evidence|methodology_reference|exclude","relevance_reason":""}]}'
    ].join("\n");
  }
  function jsonOf(raw) {
    const s = String(raw || "");
    const match = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return JSON.parse(match ? match[1] : s.slice(s.indexOf("{"), s.lastIndexOf("}") + 1));
  }
  function parseCandidateDiscoveryReply(raw, { allowedSourceQueries = [], sourceManifest = [] } = {}) {
    let value;
    try {
      value = jsonOf(raw);
    } catch {
      return { ok: false, error: "Agent 返回的候选发现结果不是有效 JSON" };
    }
    const rawCandidates = Array.isArray(value.candidates) ? value.candidates : null;
    if (rawCandidates && rawCandidates.length === 0) return { ok: true, value: { candidates: [], empty_result: true } };
    const seen = /* @__PURE__ */ new Set();
    const allowedSources = new Set((allowedSourceQueries || []).map((v) => text4(v, 300)));
    const sourceByDoi = /* @__PURE__ */ new Map();
    const seedSurnames = /* @__PURE__ */ new Set();
    for (const source of Array.isArray(sourceManifest) ? sourceManifest : []) {
      const endpoint = text4(source?.endpoint, 300);
      for (const author of Array.isArray(source?.work?.authors) ? source.work.authors : []) {
        const words = text4(author, 180).toLowerCase().split(/[^a-z]+/).filter(Boolean);
        if (words.length) seedSurnames.add(words[words.length - 1]);
      }
      for (const reference of Array.isArray(source?.references) ? source.references : []) {
        const doi = text4(reference?.doi, 200).toLowerCase();
        if (DOI_RE.test(doi) && endpoint) sourceByDoi.set(doi, {
          endpoint,
          title: text4(reference?.title, 400),
          journal: text4(reference?.journal, 200),
          authors: text4(reference?.authors, 150),
          year: Number.isFinite(Number(reference?.year)) ? Number(reference.year) : null
        });
      }
    }
    const candidates = (rawCandidates || []).slice(0, 80).map((c) => ({
      doi: text4(c.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, ""),
      title: text4(c.title, 400),
      journal: text4(c.journal, 200),
      issn: text4(c.issn, 20),
      year: Number.isFinite(Number(c.year)) ? Number(c.year) : null,
      authors: list3(c.authors, 20, 150),
      relation_to_seed: ["references", "cited_by"].includes(c.relation_to_seed) ? c.relation_to_seed : "cited_by",
      source_query: text4(c.source_query, 300),
      source_response_excerpt: text4(c.source_response_excerpt, 600),
      tentative_relevance: ["direct_evidence", "methodology_reference", "exclude"].includes(c.tentative_relevance) ? c.tentative_relevance : "exclude",
      relevance_reason: text4(c.relevance_reason, 500)
    })).filter((c) => DOI_RE.test(c.doi) && c.source_query && c.source_response_excerpt).filter((c) => !allowedSources.size || allowedSources.has(c.source_query)).filter((c) => c.source_response_excerpt.toLowerCase().includes(c.doi.toLowerCase())).filter((c) => !sourceByDoi.size || sourceByDoi.has(c.doi.toLowerCase())).filter((c) => c.tentative_relevance !== "exclude").filter((c) => {
      const source = sourceByDoi.get(c.doi.toLowerCase());
      if (!source || source.title || !seedSurnames.size) return true;
      const authorWords = String(source.authors).toLowerCase().split(/[^a-z]+/).filter(Boolean);
      return authorWords.some((word) => seedSurnames.has(word));
    }).map((c) => {
      const source = sourceByDoi.get(c.doi.toLowerCase());
      if (!source) return c;
      return {
        ...c,
        source_query: source.endpoint,
        title: source.title,
        journal: source.journal,
        authors: source.authors ? [source.authors] : [],
        year: source.year,
        issn: "",
        source_response_excerpt: `DOI: ${c.doi}; title: ${source.title || "(empty)"}; journal: ${source.journal || "(empty)"}; authors: ${source.authors || "(empty)"}; year: ${source.year || "(empty)"}`
      };
    }).filter((c) => seen.has(c.doi) ? false : (seen.add(c.doi), true));
    if (!candidates.length && rawCandidates && rawCandidates.every((c) => String(c?.tentative_relevance || "") === "exclude")) return { ok: true, value: { candidates: [], empty_result: true } };
    if (!candidates.length) return { ok: false, error: "没有附带可核查检索来源与摘录的候选（来源门未通过）" };
    return { ok: true, value: { candidates } };
  }
  function enrichCandidatesWithCrossrefMetadata(candidates, metadataResults = []) {
    const byDoi = /* @__PURE__ */ new Map();
    for (const result of Array.isArray(metadataResults) ? metadataResults : []) {
      const doi = text4(result?.doi || result?.manifest?.work?.doi || result?.manifest?.seed_doi, 200).toLowerCase();
      if (DOI_RE.test(doi)) byDoi.set(doi, result || {});
    }
    return (candidates || []).map((candidate) => {
      const doi = text4(candidate?.doi, 200).toLowerCase();
      const result = byDoi.get(doi);
      const work = result?.manifest?.work || null;
      const title = text4(work?.title, 400) || text4(candidate?.title, 400);
      const wasTitleless = !text4(candidate?.title, 400);
      const authors = Array.isArray(work?.authors) && work.authors.length ? list3(work.authors, 20, 150) : list3(candidate?.authors, 20, 150);
      const issn = Array.isArray(work?.issn) ? text4(work.issn[0], 20) : text4(candidate?.issn, 20);
      return {
        ...candidate,
        title,
        authors,
        issn,
        journal: text4(work?.journal, 200) || text4(candidate?.journal, 200),
        year: Number.isFinite(Number(work?.year)) ? Number(work.year) : Number.isFinite(Number(candidate?.year)) ? Number(candidate?.year) : null,
        metadata_status: title ? work ? "enriched" : "available" : result?.error ? "unavailable" : "incomplete",
        metadata_source: work ? text4(result?.manifest?.endpoint, 300) : "",
        metadata_fetched_at: work ? text4(result?.manifest?.fetched_at, 80) : "",
        metadata_error: result?.error ? text4(result.error, 300) : "",
        relevance_reason: work && wasTitleless ? "Bridge 已补全 Crossref 题名；本项仅因同作者链进入候选，需研究者按题名人工复核。" : text4(candidate?.relevance_reason, 500)
      };
    });
  }
  function buildContentAdmissionPrompt({ project, admittedInputs, existingHypotheses }) {
    const payload = JSON.stringify({
      project_display_id: project?.display_id,
      admitted_inputs: (admittedInputs || []).map((a) => ({ doi: a.doi, path: a.path })),
      existing_hypotheses: (existingHypotheses || []).map((h) => ({ uid: h.uid, display_id: h.display_id, statement: text4(h.statement, 300) }))
    }).slice(0, 14e3);
    return [
      "你是 Scholarium 种子文献证据重建的内容准入分析 Agent，只读权限。你只能读取下面 admitted_inputs 列出的精确文件路径，严禁扫描或读取 literature/downloaded-pdfs/ 或任何未在列表中出现的路径——本轮分析必须只基于本轮新下载、已通过下载校验的文献。",
      "",
      `任务上下文：
${payload}`,
      "",
      "对每篇文献：判断正文是否同时命中课题体系关键词与目标变量/结果关键词；每一条结论都必须提供一句可在原文定位的直接引用（quote）与定位信息（anchor，如小节标题或图表编号）——拿不出可定位引用就不要生成这条结论，改为把该点标记为 insufficient_evidence:true 并说明原因。可以针对 existing_hypotheses 里给出的具体 uid 提出建议关系（relation）与混杂说明，但这只是建议，不代表已经确认，不要使用「确认」「证实」这类措辞。",
      "",
      "只输出 JSON：",
      '{"papers":[{"doi":"","suggested_role":"direct_evidence|methodology_reference|exclude","role_reason":"","findings":[{"quote":"","anchor":"","target_hypothesis_uid":"","relation":"SUPPORTS|CONTRADICTS|QUALIFIES|INCONCLUSIVE|NONE","claim":"","confound_note":"","insufficient_evidence":false,"insufficient_reason":""}]}]}'
    ].join("\n");
  }
  var RELATIONS2 = /* @__PURE__ */ new Set(["SUPPORTS", "CONTRADICTS", "QUALIFIES", "INCONCLUSIVE", "NONE"]);
  function parseContentAdmissionReply(raw, { admittedInputs = [], existingHypothesisUids = [] } = {}) {
    let value;
    try {
      value = jsonOf(raw);
    } catch {
      return { ok: false, error: "Agent 返回的内容准入分析不是有效 JSON" };
    }
    const allowedDois = new Set((admittedInputs || []).map((a) => a.doi));
    const hypUids = new Set(existingHypothesisUids || []);
    const papers = (Array.isArray(value.papers) ? value.papers : []).map((p) => {
      const doi = text4(p.doi, 200).replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
      if (!allowedDois.has(doi)) return null;
      const findings = (Array.isArray(p.findings) ? p.findings : []).slice(0, 20).map((f) => {
        const insufficient = Boolean(f.insufficient_evidence);
        const quote = text4(f.quote, 2e3);
        const anchor = text4(f.anchor, 300);
        if (!insufficient && !(quote && anchor)) return null;
        const targetUid = text4(f.target_hypothesis_uid, 60);
        if (targetUid && !hypUids.has(targetUid)) return null;
        const relation = RELATIONS2.has(f.relation) ? f.relation : "NONE";
        return {
          quote,
          anchor,
          target_hypothesis_uid: targetUid || null,
          relation,
          claim: text4(f.claim, 1200),
          confound_note: text4(f.confound_note, 1200),
          insufficient_evidence: insufficient,
          insufficient_reason: text4(f.insufficient_reason, 500)
        };
      }).filter(Boolean);
      const suggestedRole = ["direct_evidence", "methodology_reference", "exclude"].includes(p.suggested_role) ? p.suggested_role : "exclude";
      return { doi, suggested_role: suggestedRole, role_reason: text4(p.role_reason, 800), findings };
    }).filter(Boolean);
    if (!papers.length) return { ok: false, error: "没有任何一篇通过内容准入分析（可能全部缺少可定位引用，或 DOI 不在本轮下载清单内）" };
    return { ok: true, value: { papers } };
  }
  function buildReviewPackage({ discovery, contentFindings, admittedInputs = [], dedupHits = {}, existingHypotheses = [], at }) {
    const hypByUid = new Map((existingHypotheses || []).map((h) => [h.uid, h]));
    const candidateByDoi = new Map((discovery?.candidates || []).map((candidate) => [candidate.doi, candidate]));
    const papersDedup = dedupHits.papers || {};
    const evidenceDedup = Array.isArray(dedupHits.evidence) ? dedupHits.evidence : [];
    const papers = (contentFindings?.papers || []).map((p) => {
      const input = admittedInputs.find((a) => a.doi === p.doi) || {};
      const candidate = candidateByDoi.get(p.doi) || {};
      return {
        doi: p.doi,
        title: candidate.title || p.doi,
        journal: candidate.journal || "",
        year: candidate.year || null,
        authors: candidate.authors || [],
        source_query: candidate.source_query || "",
        source_response_excerpt: candidate.source_response_excerpt || "",
        pdf_path: input.path || null,
        pdf_sha256: input.sha256 || null,
        suggested_role: p.suggested_role,
        role_reason: p.role_reason,
        existing_paper: papersDedup[p.doi] || null,
        findings: p.findings.map((f) => ({
          ...f,
          target_hypothesis_display_id: f.target_hypothesis_uid ? hypByUid.get(f.target_hypothesis_uid)?.display_id || null : null,
          existing_evidence: evidenceDedup.find((e) => e.source_doi === p.doi && e.target_uid === f.target_hypothesis_uid) || null
        }))
      };
    });
    return { candidates: discovery?.candidates || [], papers, generated_at: at || (/* @__PURE__ */ new Date()).toISOString() };
  }
  function defaultPaperIncluded(paper) {
    return Boolean(paper && !paper.existing_paper && paper.suggested_role !== "exclude");
  }
  function buildAdmissionDrafts({ project, selections, uidFn = uuidV72, existingPaperIds = [], existingPaperDois = [], existingEvidenceIds = [], existingDecisionIds = [], admittedInputs = [], existingHypothesisIds = [], at }) {
    if (!project?.uid || !project?.display_id) throw new Error("缺少正式 Project 上下文");
    const now = at || (/* @__PURE__ */ new Date()).toISOString();
    const allowedDois = new Set((admittedInputs || []).map((a) => a.doi));
    const hypUidSet = new Set(existingHypothesisIds || []);
    const selectedPapers = (selections?.papers || []).filter((p) => p.include && allowedDois.has(p.doi));
    const existingDoiSet = new Set((existingPaperDois || []).map((doi) => String(doi).toLowerCase()));
    const duplicate = selectedPapers.find((p) => existingDoiSet.has(String(p.doi).toLowerCase()));
    if (duplicate) throw new Error(`已有 Paper 使用 DOI ${duplicate.doi}；本工作流只能查看/跳过既有对象，不能新建重复记录`);
    const papers = selectedPapers;
    const paperIds = allocate("PAPER", existingPaperIds, papers.length);
    const items2 = [];
    const paperUidByDoi = /* @__PURE__ */ new Map();
    papers.forEach((p, i) => {
      const input = admittedInputs.find((a) => a.doi === p.doi);
      const uid = uidFn();
      paperUidByDoi.set(p.doi, uid);
      const object = {
        uid,
        display_id: paperIds[i],
        schema_version: 1,
        type: "paper",
        created_at: now,
        updated_at: now,
        title: text4(p.title, 400) || p.doi,
        source: `https://doi.org/${p.doi}`,
        doi: p.doi,
        journal: text4(p.journal, 200),
        year: Number(p.year) || void 0,
        authors: list3(p.authors, 30, 200),
        keywords: list3(p.tags, 16, 80),
        projects: [project.uid],
        source_kind: "local_pdf",
        source_pdf_path: text4(input?.path, 500),
        source_pdf_sha256: text4(input?.sha256, 64),
        bibliographic_status: "doi_only",
        created_by: "ai",
        review_status: "pending",
        verified_by_user: false
      };
      items2.push({
        path: `Research/Papers/${paperIds[i]} Local PDF · ${safe2(String(p.doi).replace(/\//g, "-"))}.md`,
        content: frontmatter2(object) + `# ${text4(p.title, 300) || p.doi}

${p.notes ? text4(p.notes, 2e3) + "\n\n" : ""}> 经种子文献重建工作流准入，AI 起草，研究者已在审阅界面确认纳入；未设置人工 confidence。
`
      });
    });
    const evidenceSelections = (selections?.evidence || []).filter((e) => e.include && allowedDois.has(e.source_doi) && paperUidByDoi.has(e.source_doi) && e.target_hypothesis_uid && hypUidSet.has(e.target_hypothesis_uid) && text4(e.quote, 1) && text4(e.anchor, 1) && text4(e.quote_hash, 1));
    const evIds = allocate("EVD", existingEvidenceIds, evidenceSelections.length);
    evidenceSelections.forEach((e, i) => {
      const source = admittedInputs.find((a) => a.doi === e.source_doi);
      const object = {
        uid: uidFn(),
        display_id: evIds[i],
        schema_version: 1,
        type: "evidence",
        created_at: now,
        updated_at: now,
        claim: text4(e.claim, 1500),
        source_type: "paper",
        source_uid: paperUidByDoi.get(e.source_doi),
        target_uid: e.target_hypothesis_uid,
        relation: RELATIONS2.has(e.relation) && e.relation !== "NONE" ? e.relation : "QUALIFIES",
        strength: Math.max(0, Math.min(5, Number(e.strength) || 2)),
        limitations: text4(e.limitations, 1500),
        conditions: text4(e.conditions, 800),
        quote: text4(e.quote, 2e3),
        created_by: "ai",
        verified_by_user: false,
        review_status: "pending",
        candidate_only: false,
        ...e.ai_review ? { ai_review: e.ai_review } : {},
        locator: { source_sha256: text4(source?.sha256, 64), anchor: text4(e.anchor, 300), quote_hash: text4(e.quote_hash, 128), original_url: `https://doi.org/${e.source_doi}` }
      };
      items2.push({
        path: `Research/Evidence/${evIds[i]} ${safe2(e.claim)}.md`,
        content: frontmatter2(object) + `# ${evIds[i]}

${text4(e.claim, 1500)}

> AI 起草的待审候选证据，未经研究者确认，不构成对目标 Hypothesis 正式支持/反驳数组的写入。
`
      });
    });
    let decisionUid = null;
    if (selections?.decision?.include && (papers.length || evidenceSelections.length)) {
      const decIds = allocate("DEC", existingDecisionIds, 1);
      decisionUid = uidFn();
      const decisionText = text4(selections.decision.decision, 3e3) || `准入 ${papers.length} 篇 Paper、${evidenceSelections.length} 条待审 Evidence，均为 review_status: pending，未结算为对任一假设的正式支持。`;
      const rationaleText = text4(selections.decision.rationale, 6e3);
      const triggerText = text4(selections.decision.trigger_condition, 2e3);
      const object = {
        uid: decisionUid,
        display_id: decIds[0],
        schema_version: 1,
        type: "decision",
        created_at: now,
        updated_at: now,
        project_uid: project.uid,
        title: text4(selections.decision.title, 200) || `${project.display_id} 种子文献重建准入`,
        decision: decisionText,
        rationale: rationaleText,
        trigger_condition: triggerText,
        relates_to: [...paperUidByDoi.values()],
        status: "active",
        created_by: "ai",
        review_status: "pending",
        verified_by_user: false
      };
      items2.push({
        path: `Research/Decisions/${decIds[0]} ${safe2(object.title)}.md`,
        content: frontmatter2(object) + `## 决议

${decisionText}

## 依据

${rationaleText}

## 触发重新评估的条件

${triggerText}

> AI 起草的流程决议，需研究者审阅确认；未设置人工 confidence。
`
      });
    }
    if (!items2.length) throw new Error("没有任何一项被勾选纳入——请先在审阅界面选择要准入的 Paper/Evidence");
    return { items: items2, paperCount: papers.length, evidenceCount: evidenceSelections.length, decisionUid };
  }
  function selectedReadAgent(agents) {
    const all = Array.isArray(agents) ? agents : [];
    for (const id of ["codex", "claude"]) {
      const agent = all.find((a) => a && a.id === id && a.installed);
      if (agent) return agent.id;
    }
    return null;
  }
  function parseSeedDois(value) {
    return String(value || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  function candidateRowState(c) {
    const reviewable = Boolean(String(c.title || "").trim());
    return {
      reviewable,
      checked: c.whitelistStatus === "whitelist" && c.tentative_relevance === "direct_evidence",
      disabled: c.whitelistStatus === "blacklist" || !reviewable
    };
  }
  function candidateFetchPrompt(candidate) {
    return `${candidate.doi}（${candidate.title}, ${(candidate.authors || []).join("; ")} ${candidate.year || ""}）`;
  }
  function fetchConfirmText(doi, preview) {
    return `即将对 ${doi} 派发 fetch_and_attach_pdf（唯一 full 类别）：
联网：${preview.network ? "是" : "否"}
写入范围：${preview.pathScope}/
计划工具：${(preview.plannedTools || []).join(", ")}（无 Write）

确认派发？`;
  }
  var FULL_TASK_TERMINAL = ["completed", "completed-with-violations", "failed", "cancelled", "interrupted"];
  function downloadRowFromRun(doi, taskId, run) {
    if (run.status === "completed" && run.download) {
      return { doi, status: "downloaded", path: run.download.path, sha256: run.download.sha256, fullTaskId: taskId };
    }
    return { doi, status: run.status || "failed", reason: run.failureMessage || run.landing?.reason || "未获得已校验 PDF", fullTaskId: taskId };
  }
  function admittedInputsOf(downloads) {
    return downloads.filter((d) => d.status === "downloaded").map((d) => ({ doi: d.doi, path: d.path, sha256: d.sha256 }));
  }
  function draftSummaryText(built) {
    return `即将新建 ${built.items.length} 个文件（${built.paperCount} 篇 Paper、${built.evidenceCount} 条 Evidence${built.decisionUid ? "、1 条 Decision" : ""}），均为 created_by: ai、review_status: pending，不写入任何 Hypothesis 的 supporting_evidence/contradicting_evidence。`;
  }

  // src/features/tools/seed/seed-reconstruction.ts
  var SEED_TITLE = "从种子重建 P1";
  var FETCH_CATEGORY2 = "fetch_and_attach_pdf";
  var RUNS = "/v1/seed-reconstruction";
  async function computeQuoteHash(value) {
    try {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) return "";
      const buffer = await subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return "";
    }
  }
  function mountSeedReconstruction(host, ctx, options) {
    const doc = ctx.document;
    let disposed = false;
    const state = {
      displayId: options.displayId ?? "",
      project: null,
      run: null,
      candidates: [],
      downloads: [],
      admittedInputs: [],
      discoveryTaskId: "",
      contentTaskId: "",
      existingHypotheses: [],
      allIds: {},
      dedup: {},
      reviewPackage: null,
      form: null
    };
    const root = el(doc, "div", { cls: "scholarium-weaver__tool-section scholarium-seed", attrs: { "data-role": "seed-flow" } });
    const head = el(doc, "div", { cls: "scholarium-seed__head" });
    head.append(el(doc, "span", { cls: MUTED, text: "SEED RECONSTRUCTION · P1" }), el(doc, "b", { text: SEED_TITLE }));
    const body = el(doc, "div", { attrs: { "data-role": "seed-body" } });
    const actions2 = el(doc, "div", { cls: "scholarium-weaver__tool-actions", attrs: { "data-role": "seed-actions" } });
    root.append(head, body, actions2);
    host.replaceChildren(root);
    const close = () => {
      disposed = true;
      options.onClose();
    };
    const setStage = (nodes, buttons = []) => {
      if (disposed) return;
      body.replaceChildren(...nodes);
      actions2.replaceChildren(...buttons);
    };
    const faint = (text6) => para(doc, text6, MUTED);
    const closeButton = (text6 = "关闭") => button(doc, text6, close, { "data-action": "close" });
    const errorStage = (text6, extra = [], buttons = [closeButton()]) => setStage([el(doc, "p", { cls: ERROR, text: text6, attrs: { "data-role": "seed-error" } }), ...extra], buttons);
    const patchRun = async (patch) => {
      state.run = await call(ctx, `${RUNS}/${encodeURIComponent(String(state.run?.id ?? ""))}`, { method: "PATCH", body: patch });
    };
    const pickProject = async () => {
      setStage([faint("正在读取课题注册表…")]);
      let projects = [];
      try {
        projects = (await stateFetch(ctx, "project.list") || {}).projects || [];
      } catch (error) {
        errorStage(`课题注册表读取失败：${messageOf(error)}`);
        return;
      }
      if (!projects.length) {
        errorStage("课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。");
        return;
      }
      const scoped = ctx.scope().projectId;
      const picker = select(doc, projects.map((p) => [String(p.display_id), `${p.display_id} · ${p.title || "未命名课题"}`]), scoped, { "data-role": "seed-project" });
      setStage([labelled(doc, "课题", picker)], [
        closeButton("取消"),
        button(doc, "下一步", () => {
          state.displayId = picker.value;
          void identityStage();
        }, { "data-action": "pick" })
      ]);
    };
    const identityStage = async () => {
      setStage([faint("正在核对课题与工作区身份…")]);
      try {
        state.project = await stateOf(ctx, state.displayId);
      } catch (error) {
        errorStage(`读取课题失败：${messageOf(error)}`);
        return;
      }
      const project = state.project?.project ?? {};
      const seedsInput = textArea(doc, options.prefillDoi ?? "", 3, { placeholder: "10.1039/D0TA00811G", "data-role": "seed-dois" });
      const line2 = el(doc, "p");
      line2.append(doc.createTextNode("课题："), el(doc, "b", { text: String(project.display_id || state.displayId) }), doc.createTextNode(` · ${project.title || ""}`));
      const start = button(doc, "开始候选发现", () => void startRun(), { "data-action": "start" });
      const startRun = async () => {
        const seeds = parseSeedDois(seedsInput.value);
        if (!seeds.length) {
          ctx.notice("请至少填写一个种子 DOI。", "info");
          return;
        }
        start.disabled = true;
        start.textContent = "核对身份中…";
        try {
          state.run = await call(ctx, RUNS, {
            method: "POST",
            body: { project_uid: project.uid, project_display_id: project.display_id, project_title: project.title, workspace: ctx.scope().workspaceRoot, seeds }
          });
        } catch (error) {
          errorStage(`身份门未通过：${messageOf(error)}`);
          return;
        } finally {
          start.disabled = false;
          start.textContent = "开始候选发现";
        }
        try {
          await runDiscovery();
        } catch (error) {
          errorStage(`候选发现失败：${messageOf(error)}`);
        }
      };
      setStage([
        line2,
        faint(`工作区：${ctx.scope().workspaceRoot || "（未配置）"}`),
        labelled(doc, "种子 DOI（可多个，每行一个）", seedsInput),
        faint("提交后 Bridge 会核对课题标题与工作区 topic.json 的 name 是否一致；不一致直接阻断，不派发任何 Agent 任务。")
      ], [closeButton("取消"), start]);
    };
    const listOf = (items2) => {
      const ul = el(doc, "ul", { cls: "scholarium-weaver__tool-list" });
      for (const item of items2) ul.append(el(doc, "li", { cls: "scholarium-weaver__tool-item", text: item }));
      return ul;
    };
    const readAgent = async () => {
      const agents = await call(ctx, "/v1/agents");
      const agentId = selectedReadAgent(agents?.agents);
      if (!agentId) throw new Error("没有可用的只读本地 Agent（claude/codex）。");
      return agentId;
    };
    const runDiscovery = async () => {
      const agentId = await readAgent();
      setStage([faint("正在读取 Crossref 种子引用清单（只读，不会下载或写入课题）…")]);
      const sourceManifest = [];
      for (const seed of state.run?.seeds || []) {
        if (disposed) return;
        sourceManifest.push(await call(ctx, `/v1/literature/crossref/works/${encodeURIComponent(seed)}`));
      }
      await patchRun({ source_manifest: sourceManifest });
      setStage([faint("Agent 正在根据已记录的 Crossref 来源清单初筛候选…")]);
      const prompt = buildCandidateDiscoveryPrompt({ project: state.project?.project, seeds: state.run?.seeds, sourceManifest });
      const answer = await ctx.askAgent(prompt, { agentId });
      if (!answer.ok) throw new Error(answer.error);
      state.discoveryTaskId = answer.taskId;
      await patchRun({ source_task_id: answer.taskId });
      const parsed = parseCandidateDiscoveryReply(answer.text, { allowedSourceQueries: sourceManifest.map((source) => source.endpoint), sourceManifest });
      if (!parsed.ok) throw new Error(parsed.error);
      setStage([faint(`正在补全 ${parsed.value.candidates.length} 条候选的 Crossref 题名与期刊元数据（只读）…`)]);
      const metadataResults = [];
      for (const candidate of parsed.value.candidates) {
        if (disposed) return;
        try {
          metadataResults.push({ doi: candidate.doi, manifest: await call(ctx, `/v1/literature/crossref/works/${encodeURIComponent(candidate.doi)}`) });
        } catch (error) {
          metadataResults.push({ doi: candidate.doi, error: messageOf(error) || "Crossref 元数据读取失败" });
        }
      }
      const enriched = enrichCandidatesWithCrossrefMetadata(parsed.value.candidates, metadataResults);
      const checked = await call(ctx, "/v1/literature/whitelist-check", { method: "POST", body: { candidates: enriched } });
      state.candidates = Array.isArray(checked?.candidates) ? checked.candidates : [];
      const metadataManifest = metadataResults.filter((result) => result.manifest).map((result) => result.manifest);
      await patchRun({ candidates: state.candidates, metadata_manifest: metadataManifest, status: "candidates-ready" });
      renderCandidateSelection();
    };
    const candidateRow = (c, box) => {
      const item = el(doc, "li", { cls: "scholarium-weaver__tool-item scholarium-seed__row", attrs: { "data-role": "seed-candidate", "data-doi": String(c.doi) } });
      const { reviewable } = candidateRowState(c);
      const tag = c.whitelistStatus === "whitelist" ? `✅ ${c.whitelistTier || "白名单"}` : c.whitelistStatus === "blacklist" ? "❌ 黑名单" : "⚠️ 未收录";
      const metadata = reviewable ? "Crossref 题名已核对" : `不可下载：Crossref 未提供题名${c.metadata_error ? `（${c.metadata_error}）` : ""}`;
      const main = el(doc, "div", { cls: "scholarium-seed__main" });
      main.append(el(doc, "div", { text: String(c.title || c.doi) }), el(doc, "div", { cls: `${MUTED} scholarium-seed__mono`, text: String(c.doi) }));
      const pills = el(doc, "div", { cls: "scholarium-weaver__tool-pills" });
      if (c.journal) pills.append(el(doc, "span", { cls: "scholarium-weaver__tool-pill", text: String(c.journal) }));
      pills.append(
        el(doc, "span", { cls: "scholarium-weaver__tool-pill", text: tag, attrs: { "data-whitelist": String(c.whitelistStatus || "unknown") } }),
        el(doc, "span", { cls: `scholarium-weaver__tool-pill${reviewable ? "" : " scholarium-seed__bad"}`, text: metadata }),
        el(doc, "span", { cls: "scholarium-weaver__tool-pill", text: String(c.tentative_relevance || "") })
      );
      main.append(pills, el(doc, "div", { cls: MUTED, text: String(c.relevance_reason || "") }), el(doc, "div", { cls: `${MUTED} scholarium-seed__mono`, text: String(c.source_query || "") }));
      item.append(box, main);
      return item;
    };
    const renderCandidateSelection = () => {
      if (!state.candidates.length) {
        setStage([
          para(doc, "本轮在受限检索预算内没有找到附带可核查来源的候选。"),
          faint("这不是准入失败，也不会下载或写入任何内容。可换种子 DOI、补充一个明确的引用来源后再试。")
        ], [closeButton("结束")]);
        return;
      }
      const boxes = state.candidates.map((c) => {
        const row = candidateRowState(c);
        return checkbox(doc, row.checked, row.disabled, { "data-role": "seed-candidate-box" });
      });
      const ul = el(doc, "ul", { cls: "scholarium-weaver__tool-list" });
      state.candidates.forEach((c, i) => ul.append(candidateRow(c, boxes[i])));
      const fetch = button(doc, "下载勾选项（逐篇走 full 车道）", () => void onFetch(), { "data-action": "fetch" });
      const onFetch = async () => {
        const selected = state.candidates.filter((_, i) => boxes[i].checked && !boxes[i].disabled);
        if (!selected.length) {
          ctx.notice("请至少勾选一项。", "info");
          return;
        }
        fetch.disabled = true;
        try {
          await patchRun({ selected_dois: selected.map((c) => c.doi), status: "downloading" });
          await runDownloads(selected);
        } catch (error) {
          errorStage(`下载阶段失败：${messageOf(error)}`);
        }
      };
      setStage([
        faint("候选来自种子文献的引用网络，均附带检索来源与摘录（来源门）。Bridge 已逐篇补全 Crossref 题名；题名仍缺失的条目不可下载。黑名单期刊也不可勾选。"),
        ul
      ], [closeButton("取消"), fetch]);
    };
    const pollFullTask = async (id) => {
      for (let attempt = 0; attempt < 400; attempt++) {
        if (disposed) throw new Error("面板已关闭，停止等待 full-task");
        const run = await call(ctx, `/v1/full-tasks/${encodeURIComponent(id)}`);
        if (FULL_TASK_TERMINAL.includes(run?.status)) return run;
        await ctx.sleep(900);
      }
      throw new Error("等待 full-task 超时");
    };
    const runDownloads = async (selected) => {
      const downloads = [];
      const workspace = ctx.scope().workspaceRoot;
      for (const candidate of selected) {
        if (disposed) return;
        setStage([
          faint(`正在处理 ${candidate.doi}（${downloads.length + 1}/${selected.length}）…`),
          listOf(downloads.map((d) => `${d.doi} — ${d.status}`))
        ]);
        try {
          const prompt = candidateFetchPrompt(candidate);
          const preview = await call(ctx, "/v1/full-tasks/preview", { method: "POST", body: { category: FETCH_CATEGORY2, workspace, prompt }, timeoutMs: 2e4 });
          if (!await ctx.confirm(fetchConfirmText(candidate.doi, preview))) {
            downloads.push({ doi: candidate.doi, status: "skipped_by_user" });
            continue;
          }
          const dispatched = await call(ctx, "/v1/full-tasks", {
            method: "POST",
            body: { previewId: preview.id, category: preview.category, workspace, prompt },
            timeoutMs: 2e4,
            confirmed: true
          });
          const run = await pollFullTask(String(dispatched.id));
          downloads.push(downloadRowFromRun(candidate.doi, String(dispatched.id), run));
        } catch (error) {
          downloads.push({ doi: candidate.doi, status: "failed", reason: messageOf(error) });
        }
      }
      state.downloads = downloads;
      await patchRun({ downloads, status: "downloads-done" });
      state.admittedInputs = admittedInputsOf(downloads);
      await patchRun({ admitted_inputs: state.admittedInputs });
      renderDownloadReport();
    };
    const renderDownloadReport = () => {
      const ul = el(doc, "ul", { cls: "scholarium-weaver__tool-list" });
      for (const d of state.downloads) {
        const item = el(doc, "li", { cls: "scholarium-weaver__tool-item", attrs: { "data-role": "seed-download", "data-status": String(d.status) } });
        item.append(el(doc, "span", { cls: "scholarium-seed__mono", text: String(d.doi) }), doc.createTextNode(` — ${d.status} `), el(doc, "span", { cls: MUTED, text: String(d.reason || d.path || "") }));
        ul.append(item);
      }
      const content = button(doc, "对已下载 PDF 做内容准入分析", () => void runContentAdmission(content), { "data-action": "content" });
      content.disabled = !state.admittedInputs.length;
      setStage([
        faint("下载门结果——只有 status=downloaded 的条目会进入内容准入分析；失败或密码保护项停在这里，不会混入后续输入。"),
        ul
      ], [closeButton("结束（不继续）"), content]);
    };
    const runContentAdmission = async (trigger) => {
      trigger.disabled = true;
      try {
        const agentId = await readAgent();
        setStage([faint("Agent 正在只读分析本轮下载的精确 PDF 清单（不扫描历史 downloaded-pdfs/）…")]);
        const ids = (await stateFetch(ctx, "research.ids", { types: ["hypothesis", "paper", "evidence", "decision"] }))?.ids || {};
        const existingHypotheses = (state.project?.hypotheses || []).map((h) => ({ uid: h.uid, display_id: h.display_id, statement: h.statement }));
        const prompt = buildContentAdmissionPrompt({ project: state.project?.project, admittedInputs: state.admittedInputs, existingHypotheses });
        const answer = await ctx.askAgent(prompt, { agentId });
        if (!answer.ok) throw new Error(answer.error);
        state.contentTaskId = answer.taskId;
        await patchRun({ source_task_id: answer.taskId });
        const parsed = parseContentAdmissionReply(answer.text, { admittedInputs: state.admittedInputs, existingHypothesisUids: existingHypotheses.map((h) => h.uid) });
        if (!parsed.ok) {
          ctx.notice(parsed.error);
          renderDownloadReport();
          return;
        }
        state.existingHypotheses = existingHypotheses;
        state.allIds = ids;
        state.dedup = await call(ctx, `${RUNS}/dedup`, { method: "POST", body: { dois: state.admittedInputs.map((input) => input.doi) } });
        state.reviewPackage = buildReviewPackage({ discovery: { candidates: state.candidates }, contentFindings: parsed.value, admittedInputs: state.admittedInputs, dedupHits: state.dedup, existingHypotheses });
        state.form = null;
        renderReviewPackage();
      } catch (error) {
        errorStage(`内容准入分析失败：${messageOf(error)}`, [], [closeButton("结束"), button(doc, "返回下载结果", renderDownloadReport, { "data-action": "back" })]);
      }
    };
    const buildForm = () => {
      const pkg = state.reviewPackage;
      const papers = [];
      const nodes = [faint("逐项勾选/编辑；未勾选的项不会生成任何文件。研究者的编辑会覆盖 Agent 的原始建议。")];
      const hypOptions = [["", "不创建 Evidence"], ...state.existingHypotheses.map((h) => [String(h.uid), `${h.display_id} · ${h.statement || ""}`])];
      for (const p of pkg.papers) {
        const card = el(doc, "section", { cls: "scholarium-weaver__tool-section scholarium-seed__card", attrs: { "data-role": "seed-paper", "data-doi": String(p.doi) } });
        const include = checkbox(doc, defaultPaperIncluded(p), Boolean(p.existing_paper), { "data-role": "paper-include" });
        const h = el(doc, "label", { cls: "scholarium-seed__title" });
        h.append(include, doc.createTextNode(` ${p.doi}`));
        const form = {
          doi: p.doi,
          include,
          title: textInput(doc, String(p.title ?? ""), { "data-role": "paper-title" }),
          journal: textInput(doc, String(p.journal ?? ""), { "data-role": "paper-journal" }),
          year: textInput(doc, p.year ? String(p.year) : "", { type: "number", "data-role": "paper-year" }),
          authors: textInput(doc, (p.authors || []).join(", "), { "data-role": "paper-authors" }),
          tags: textInput(doc, "", { placeholder: "逗号分隔", "data-role": "paper-tags" }),
          notes: textArea(doc, "", 2, { "data-role": "paper-notes" }),
          findings: []
        };
        card.append(
          h,
          faint(`Agent 建议角色：${p.suggested_role} — ${p.role_reason}`),
          faint(`候选来源：${p.source_query || "未提供"}${p.source_response_excerpt ? `
${p.source_response_excerpt}` : ""}`),
          labelled(doc, "标题", form.title),
          labelled(doc, "期刊", form.journal),
          labelled(doc, "年份", form.year),
          labelled(doc, "作者（逗号分隔）", form.authors),
          labelled(doc, "标签", form.tags),
          labelled(doc, "备注", form.notes)
        );
        if (p.existing_paper) card.append(faint(`⚠️ 已存在 Paper：${p.existing_paper.display_id || ""}（仅查看/跳过；本流程不会覆盖、迁移或再建重复 Paper）`));
        if (!p.findings.length) card.append(faint("未生成可定位的 Evidence（可能标记为 insufficient_evidence）。"));
        for (const f of p.findings) {
          const box = el(doc, "div", { cls: "scholarium-seed__finding", attrs: { "data-role": "seed-finding" } });
          const finding = {
            include: checkbox(doc, !f.insufficient_evidence, Boolean(f.insufficient_evidence), { "data-role": "finding-include" }),
            relation: select(doc, ["SUPPORTS", "CONTRADICTS", "QUALIFIES", "INCONCLUSIVE"].map((r) => [r, r]), String(f.relation), { "data-role": "finding-relation" }),
            target: select(doc, hypOptions, String(f.target_hypothesis_uid ?? ""), { "data-role": "finding-target" }),
            claim: textArea(doc, String(f.claim ?? ""), 2, { "data-role": "finding-claim" }),
            quote: textArea(doc, String(f.quote ?? ""), 2, { "data-role": "finding-quote" }),
            anchor: textInput(doc, String(f.anchor ?? ""), { "data-role": "finding-anchor" }),
            limitations: textArea(doc, String(f.confound_note ?? ""), 2, { "data-role": "finding-limitations" })
          };
          const includeLabel = el(doc, "label");
          includeLabel.append(finding.include, doc.createTextNode(" 纳入这条 Evidence"));
          box.append(includeLabel);
          if (f.insufficient_evidence) box.append(faint(`证据不足：${f.insufficient_reason || "未提供可定位引用"}；本轮可保留 Paper，但不会生成 Evidence。`));
          box.append(
            labelled(doc, "建议关系", finding.relation),
            labelled(doc, "目标假设", finding.target),
            labelled(doc, "主张", finding.claim),
            labelled(doc, "原文引用", finding.quote),
            labelled(doc, "定位", finding.anchor),
            labelled(doc, "限制/混杂说明", finding.limitations)
          );
          if (f.existing_evidence) box.append(faint(`⚠️ 已存在类似 Evidence：${f.existing_evidence.display_id || ""}（只读，不会被本流程修改）`));
          form.findings.push(finding);
          card.append(box);
        }
        papers.push(form);
        nodes.push(card);
      }
      const decisionInclude = checkbox(doc, true, false, { "data-role": "decision-include" });
      const decisionLabel = el(doc, "label");
      decisionLabel.append(decisionInclude, doc.createTextNode(" 同时生成一条 Decision 记录本轮准入范围与理由"));
      const decisionTitle = textInput(doc, `${state.project?.project?.display_id ?? state.displayId} 种子文献重建准入`, { "data-role": "decision-title" });
      const decisionRationale = textArea(doc, "", 3, { "data-role": "decision-rationale" });
      nodes.push(decisionLabel, labelled(doc, "Decision 标题", decisionTitle), labelled(doc, "Decision 理由", decisionRationale));
      return { nodes, papers, decisionInclude, decisionTitle, decisionRationale };
    };
    const renderReviewPackage = () => {
      if (!state.form) state.form = buildForm();
      setStage(state.form.nodes, [closeButton("取消"), button(doc, "生成 P1 草案预览", () => void previewDrafts(), { "data-action": "preview" })]);
    };
    const collectSelections = async () => {
      const form = state.form;
      const pkg = state.reviewPackage;
      const papers = [];
      const evidence = [];
      const split = (value) => String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
      for (const [pi, pf] of form.papers.entries()) {
        const include = pf.include.checked;
        papers.push({ include, doi: pkg.papers[pi].doi, title: pf.title.value, journal: pf.journal.value, year: pf.year.value, authors: split(pf.authors.value), tags: split(pf.tags.value), notes: pf.notes.value });
        if (!include) continue;
        for (const ff of pf.findings) {
          if (!ff.include.checked) continue;
          const quote = ff.quote.value;
          evidence.push({
            include: true,
            source_doi: pkg.papers[pi].doi,
            target_hypothesis_uid: ff.target.value,
            relation: ff.relation.value,
            claim: ff.claim.value,
            limitations: ff.limitations.value,
            conditions: "",
            strength: 2,
            quote,
            anchor: ff.anchor.value,
            quote_hash: await computeQuoteHash(quote)
          });
        }
      }
      const decision = { include: form.decisionInclude.checked, title: form.decisionTitle.value, decision: "", rationale: form.decisionRationale.value, trigger_condition: "" };
      return { papers, evidence, decision };
    };
    const previewDrafts = async () => {
      const selections = await collectSelections();
      let built;
      try {
        built = buildAdmissionDrafts({
          project: state.project?.project,
          selections,
          admittedInputs: state.admittedInputs,
          existingHypothesisIds: state.existingHypotheses.map((h) => h.uid),
          existingPaperIds: state.allIds.paper || [],
          existingPaperDois: Object.keys(state.dedup?.papers || {}),
          existingEvidenceIds: state.allIds.evidence || [],
          existingDecisionIds: state.allIds.decision || []
        });
      } catch (error) {
        ctx.notice(messageOf(error));
        return;
      }
      const commit = button(doc, "预览并确认写入", () => void onCommit(), { "data-action": "commit" });
      const onCommit = async () => {
        commit.disabled = true;
        try {
          const projectDisplayId = String(state.project?.project?.display_id ?? state.displayId);
          const preview = await call(ctx, "/v1/drafts/batch", {
            method: "POST",
            body: { base: "scholarium-vault", serverManagedMetadata: true, projectDisplayId, sourceTaskId: state.contentTaskId || state.discoveryTaskId, items: built.items }
          });
          if (!await ctx.confirm(`将原子写入 ${built.items.length} 个新文件，确认吗？`)) return;
          await call(ctx, `/v1/drafts/batch/${encodeURIComponent(String(preview.id))}/commit`, { method: "POST", confirmed: true });
          await patchRun({ draft_batch_id: String(preview.id), status: "admitted" });
          ctx.notice(`已写入 ${built.items.length} 个文件（均为 pending，待研究者逐条确认）。`, "info");
          renderCompletion();
        } catch (error) {
          ctx.notice(`准入失败：${messageOf(error)}`);
          body.append(el(doc, "p", { cls: ERROR, text: `准入失败：${messageOf(error)}`, attrs: { "data-role": "seed-error" } }));
        } finally {
          commit.disabled = false;
        }
      };
      setStage([
        faint(draftSummaryText(built)),
        listOf(built.items.map((item) => item.path))
      ], [button(doc, "返回编辑", renderReviewPackage, { "data-action": "back" }), commit]);
    };
    const renderCompletion = () => {
      const done = el(doc, "p", { attrs: { "data-role": "seed-done" } });
      done.append(doc.createTextNode("P1 准入已完成：新建对象均保持 "), el(doc, "code", { text: "review_status: pending" }), doc.createTextNode("，仍可在 Scholarium 中继续人工审阅。"));
      setStage([done, faint("P2 版本化知识图谱尚未接入真实图谱生成器，因此本轮不会创建 manifest 或任何图谱占位文件，也不会覆盖当前图谱。")], [closeButton("结束")]);
    };
    if (state.displayId) void identityStage();
    else void pickProject();
    return () => {
      disposed = true;
    };
  }

  // src/features/tools/seed/project-mode.ts
  var P12_LABEL = "运行 P1–P2 文献与图谱";
  var P35_LABEL = "生成 P3–P5 首圈草案";
  var SEED_LABEL = "从种子重建 P1（P2 待接入）";
  var GRAPH_OPEN_LABEL = "打开最新版本";
  async function runP3P5(ctx, displayId, btn, out2) {
    const agentId = ctx.scope().agentId;
    if (!agentId) {
      ctx.notice("没有可用的本地 Agent；请先连接 Bridge 并选择 Codex/Claude。");
      return;
    }
    btn.disabled = true;
    btn.textContent = "读取课题…";
    try {
      const data = await stateOf(ctx, displayId);
      const prompt = buildProjectPlanPrompt(data);
      btn.textContent = "Agent 正在规划…";
      const answer = await ctx.askAgent(prompt, { agentId });
      if (!answer.ok) throw new Error(answer.error);
      const parsed = parseProjectPlanReply(answer.text);
      if (!parsed.ok) throw new Error(parsed.error);
      const allIds = (await stateFetch(ctx, "research.ids", { types: ["hypothesis", "experiment"] }) || {}).ids || {};
      const built = buildProjectDrafts({
        project: data.project,
        parsed,
        existingHypothesisIds: allIds.hypothesis || [],
        existingExperimentIds: allIds.experiment || [],
        at: ctx.now()
      });
      btn.textContent = "生成写入预览…";
      const preview = await call(ctx, "/v1/drafts/batch", {
        method: "POST",
        body: { base: "scholarium-vault", serverManagedMetadata: true, projectDisplayId: displayId, sourceTaskId: answer.taskId, items: built.items }
      });
      const list4 = el(ctx.document, "ul", { cls: "scholarium-weaver__tool-list", attrs: { "data-role": "p35-paths" } });
      for (const item of built.items) list4.append(el(ctx.document, "li", { cls: "scholarium-weaver__tool-item", text: item.path }));
      out2.node(list4);
      if (!await ctx.confirm(p35ConfirmText(displayId, built))) {
        out2.info("已取消写入；没有文件被创建。");
        return;
      }
      btn.textContent = "正在原子写入…";
      await call(ctx, `/v1/drafts/batch/${encodeURIComponent(String(preview.id))}/commit`, { method: "POST", confirmed: true });
      const done = `${displayId} 的 P3 假设、P4 实验与 P5 周计划草案已写入。`;
      out2.ok(done);
      ctx.notice(done, "info");
    } catch (error) {
      const message = `P3-P5 生成失败：${messageOf(error)}`;
      out2.error(message);
      ctx.notice(message);
    } finally {
      btn.disabled = false;
      btn.textContent = P35_LABEL;
    }
  }
  function pipelineRunMessage(displayId, topic) {
    const block = JSON.stringify({ operation: "pipeline.run", topic, reason: `${displayId} 课题模式：运行 P1–P2 文献与图谱` });
    return [
      `**${displayId} · ${P12_LABEL}**`,
      "",
      `研究主题：${topic}`,
      "",
      "点击下方确认卡后才会运行。注意：页面内的 Pipeline 在 P2 知识图谱之后还会继续生成证据综述与手稿初稿（旧面板“只跑到图谱”的开关在这里没有对应项）。",
      "",
      "```scholarium-run",
      block,
      "```"
    ].join("\n");
  }
  async function runP1P2(ctx, displayId, btn, out2) {
    btn.disabled = true;
    btn.textContent = "准备 Pipeline…";
    try {
      const data = await stateOf(ctx, displayId);
      const project = data.project ?? {};
      const topic = projectTopic(project);
      if (!topic) throw new Error("课题没有 research_question / thesis / title，无法确定检索主题");
      const history = await call(ctx, "/v1/history");
      const candidate = resumablePipelineCandidate(history, ctx.scope().workspaceRoot, String(project.title || ""));
      if (candidate) {
        const parent = await call(ctx, `/v1/pipeline-runs/${encodeURIComponent(String(candidate.id))}`);
        const paths = Array.isArray(parent?.artifacts?.downloadedPaths) ? parent.artifacts.downloadedPaths : [];
        if (paths.length) {
          out2.info(`${displayId} 找到一批同工作区的可恢复文献资产：历史运行：${parent.title || candidate.title}；PDF：${paths.length} 篇（路径已由 Bridge 记录）；恢复点：第 6 步 nature-reader。页面内尚未接入“从历史 PDF 恢复 P2”，下面只能发起新的 P1 检索。`);
        }
      }
      if (!await ctx.confirm(`把 ${displayId} 的 P1–P2 运行请求放入对话？

研究主题：${topic}

这一步只生成确认卡；在卡片上再次确认后才会检索、下载和写入。`)) return;
      await ctx.postToChat(pipelineRunMessage(displayId, topic));
      out2.ok(`已把 ${displayId} 的 Pipeline 运行请求放入对话；在确认卡上点击后才会运行。`);
    } catch (error) {
      const message = `P1-P2 运行失败：${messageOf(error)}`;
      out2.error(message);
      ctx.notice(message);
    } finally {
      btn.disabled = false;
      btn.textContent = P12_LABEL;
    }
  }
  async function openLatestGraphRun(ctx, displayId, btn, out2) {
    const original = btn.textContent ?? GRAPH_OPEN_LABEL;
    btn.disabled = true;
    btn.textContent = "查找已发布版本…";
    try {
      const data = await call(ctx, `/v1/knowledge-graph/publish/list?project_display_id=${encodeURIComponent(displayId)}`);
      const runs = Array.isArray(data?.runs) ? data.runs : [];
      if (!runs.length) {
        out2.info(`${displayId} 还没有已发布的知识图谱版本；请先用「知识图谱审核发布」生成。`);
        return;
      }
      const run = runs[0];
      const warnings = Array.isArray(run.warnings) && run.warnings.length ? `；警告 ${run.warnings.length} 条` : "";
      out2.ok(`最新版本 ${run.id} · 发布于 ${run.publishedAt || "未知时间"} · 节点 ${run.nodeCount ?? "?"} · 边 ${run.edgeCount ?? "?"}${warnings}。报告位于工作区 ${run.targetDir || "（未记录目录）"}。`);
    } catch (error) {
      out2.error(`打开知识图谱失败：${messageOf(error)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }
  function renderProjectTool(container, ctx) {
    const doc = ctx.document;
    let seedCleanup = null;
    let selected = null;
    const root = el(doc, "div", { cls: "scholarium-weaver__tool-section scholarium-project", attrs: { "data-role": "project-mode" } });
    const registry = el(doc, "div", { attrs: { "data-role": "project-registry" } });
    const flow = el(doc, "div", { attrs: { "data-role": "project-flow" } });
    flow.hidden = true;
    const head = el(doc, "div", { cls: "scholarium-weaver__tool-actions" });
    const refresh = button(doc, "刷新", () => void load(), { "data-action": "refresh" });
    head.append(el(doc, "b", { text: "课题注册表" }), refresh);
    const listEl = el(doc, "div", { attrs: { "data-role": "project-list" } });
    registry.append(head, listEl);
    root.append(registry, flow);
    container.replaceChildren(root);
    const status = (text6, cls = MUTED) => listEl.replaceChildren(para(doc, text6, cls));
    const openSeed = (displayId, prefillDoi = "") => {
      registry.hidden = true;
      flow.hidden = false;
      seedCleanup?.();
      seedCleanup = mountSeedReconstruction(flow, ctx, {
        displayId,
        prefillDoi,
        onClose: () => {
          seedCleanup?.();
          seedCleanup = null;
          flow.replaceChildren();
          flow.hidden = true;
          registry.hidden = false;
        }
      });
    };
    const outFor = (box) => ({
      ok: (text6) => box.append(para(doc, text6, OK)),
      error: (text6) => box.append(para(doc, text6, ERROR)),
      info: (text6) => box.append(para(doc, text6, MUTED)),
      node: (node2) => box.append(node2)
    });
    const renderDetail = (data, detail) => {
      const p = data.project ?? {};
      const displayId = String(p.display_id || "");
      const counts = data.counts ?? {};
      const out2 = el(doc, "div", { attrs: { "data-role": "project-output" } });
      const bar = el(doc, "div", { cls: "scholarium-weaver__tool-actions" });
      const clear = () => out2.replaceChildren();
      const p12 = button(doc, P12_LABEL, () => {
        clear();
        void runP1P2(ctx, displayId, p12, outFor(out2));
      }, { "data-action": "p12" });
      const p35 = button(doc, P35_LABEL, () => {
        clear();
        void runP3P5(ctx, displayId, p35, outFor(out2));
      }, { "data-action": "p35" });
      const seed = button(doc, SEED_LABEL, () => openSeed(displayId), { "data-action": "seed" });
      const graph = button(doc, GRAPH_OPEN_LABEL, () => {
        clear();
        void openLatestGraphRun(ctx, displayId, graph, outFor(out2));
      }, { "data-action": "graph-open" });
      bar.append(p12, p35, seed, graph);
      detail.replaceChildren(
        para(doc, `${p.title || ""} · 假设 ${counts.hypotheses || 0} · 实验 ${counts.experiments || 0} · 证据 ${counts.evidence || 0}`, MUTED),
        bar,
        out2
      );
      const hyps = data.hypotheses ?? [];
      if (!hyps.length) {
        detail.append(para(doc, "尚无关联假设。", MUTED));
        return;
      }
      detail.append(para(doc, "假设 · 支持/反驳/限定/待审/驳回", MUTED));
      const ul = el(doc, "ul", { cls: "scholarium-weaver__tool-list" });
      for (const h of hyps) {
        const s = h.settlement ?? {};
        ul.append(el(doc, "li", { cls: "scholarium-weaver__tool-item", text: `${h.display_id} ${h.statement ?? ""} — ${s.supports || 0}/${s.contradicts || 0}/${s.qualifies || 0}/${s.pending || 0}/${s.rejected || 0}` }));
      }
      detail.append(ul);
    };
    const toggle = async (displayId, detail, rows) => {
      const was = selected === displayId;
      for (const other of rows.values()) {
        other.hidden = true;
        other.replaceChildren();
      }
      if (was) {
        selected = null;
        return;
      }
      selected = displayId;
      detail.hidden = false;
      detail.replaceChildren(para(doc, "正在读取课题详情…", MUTED));
      try {
        renderDetail(await stateOf(ctx, displayId), detail);
      } catch (error) {
        detail.replaceChildren(para(doc, `课题详情读取失败：${messageOf(error)}`, ERROR));
      }
    };
    const load = async () => {
      if (!ctx.online()) {
        status("运行时未连接；连接后刷新课题注册表。");
        return;
      }
      status("正在读取课题注册表…");
      let projects = [];
      try {
        projects = (await stateFetch(ctx, "project.list") || {}).projects || [];
      } catch (error) {
        status(`课题注册表读取失败：${messageOf(error)}`, ERROR);
        return;
      }
      if (!projects.length) {
        status("课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。");
        return;
      }
      const ul = el(doc, "ul", { cls: "scholarium-weaver__tool-list" });
      const details = /* @__PURE__ */ new Map();
      for (const project of projects) {
        const id = String(project.display_id);
        const counts = project.counts || {};
        const item = el(doc, "li", { cls: "scholarium-weaver__tool-item", attrs: { "data-role": "project-row", "data-display-id": id } });
        const headLine = el(doc, "div");
        headLine.append(el(doc, "b", { text: id }), el(doc, "span", { cls: MUTED, text: ` ${project.status || ""}${project.stage ? ` · ${project.stage}` : ""}` }));
        const pending = project.unsettled_experiments || 0;
        const meta = el(doc, "div", { cls: MUTED, text: `假设 ${counts.hypotheses || 0} · 实验 ${counts.experiments || 0} · 证据 ${counts.evidence || 0}${pending ? ` · 待结算 ${pending}` : ""}` });
        const detail = el(doc, "div", { attrs: { "data-role": "project-detail", "data-detail-for": id } });
        detail.hidden = true;
        details.set(id, detail);
        const open = button(doc, "展开", () => void toggle(id, detail, details), { "data-action": "toggle" });
        item.append(headLine, el(doc, "div", { text: String(project.title || "（无标题）") }), meta, open, detail);
        ul.append(item);
      }
      listEl.replaceChildren(ul);
      if (selected && details.has(selected)) {
        const again = selected;
        selected = null;
        void toggle(again, details.get(again), details);
      }
    };
    void load();
    return () => {
      seedCleanup?.();
      seedCleanup = null;
    };
  }
  var projectModeTool = Object.freeze({
    id: "project-mode",
    label: "课题模式",
    title: "课题注册表与课题模式（P1–P2 · P3–P5 · 种子重建）",
    placement: "rail",
    requiresRuntime: true,
    render: renderProjectTool
  });

  // src/features/tools/seed/index.ts
  var seedReconstructionTool = Object.freeze({
    id: "seed-reconstruction",
    label: SEED_TITLE,
    title: "从种子 DOI 出发：Crossref 候选 → 逐篇下载 → 内容准入 → P1 草案（P2 待接入）",
    placement: "action",
    requiresRuntime: true,
    render(container, ctx) {
      let cleanup = () => {
      };
      const start = () => {
        cleanup();
        cleanup = mountSeedReconstruction(container, ctx, { onClose: start });
      };
      start();
      return () => cleanup();
    }
  });
  var SEED_TOOLS = Object.freeze([projectModeTool, seedReconstructionTool]);

  // src/features/tools/registry.ts
  var WEAVER_TOOLS = Object.freeze([
    // action
    pipelineRunTool,
    queryLoopTool,
    ideaModeTool,
    seedReconstructionTool,
    fetchFullTextTool,
    projectRegistryTool,
    webvpnTool,
    settingsCenterTool,
    // rail
    pipelineStepsTool,
    hypothesisTreeTool,
    knowledgeGraphTool,
    ideaLibraryTool,
    projectModeTool
  ]);

  // src/features/chat/model.ts
  var CHAT_ROLES = ["user", "agent", "system", "error"];
  var ROLE_LABEL = {
    user: "研究员",
    agent: "织研者",
    system: "系统",
    error: "错误"
  };
  var SCHEMA = "scholarium-chat/1";
  var SESSION_ID_PATTERN = /^s-[a-z0-9]{4,16}-[0-9a-f]{8}$/;
  var MESSAGE_ID_PATTERN = /^m-[a-z0-9-]{6,40}$/;
  var EVENT_ID_PATTERN = /^evt-[a-z0-9-]{6,40}$/;
  var OPERATION_ID_PATTERN = /^op-[a-z0-9-]{6,40}$/;
  var CONFIRMATION_STATES = ["pending", "claimed", "confirmed", "failed", "abandoned"];
  var CONFIRMATION_KINDS = [
    "action",
    "draft",
    "legacyNoteEdit",
    "run",
    "normalize",
    "plot",
    "plotRevision",
    "suggestReconstruction",
    "files",
    "patch",
    "figure"
  ];
  var DEFAULT_PAGE_LIMIT = 50;
  var MAX_PAGE_LIMIT = 500;
  var SCOPE_HASH_LENGTH = 24;
  var ChatModelError = class extends Error {
    code;
    /** 1-based line number in the session file, when the failure has one. */
    line;
    file;
    constructor(code, message, details = {}) {
      super(message);
      this.name = "ChatModelError";
      this.code = code;
      this.line = details.line ?? null;
      this.file = details.file ?? null;
    }
  };
  var fallbackCounter = 0;
  function defaultRandom(bytes) {
    const out2 = new Uint8Array(bytes);
    const webCrypto = globalThis.crypto;
    if (webCrypto?.getRandomValues) {
      webCrypto.getRandomValues(out2);
      return out2;
    }
    for (let i = 0; i < bytes; i++) {
      fallbackCounter = (fallbackCounter + 1) % 16777216;
      out2[i] = Date.now() + fallbackCounter * 2654435761 + i * 40503 & 255;
    }
    return out2;
  }
  function base36(bytes, length) {
    let text6 = "";
    for (const byte of bytes) text6 += byte.toString(36).padStart(2, "0");
    return text6.replace(/[^a-z0-9]/g, "0").slice(0, length).padEnd(length, "0");
  }
  function hex(bytes, length) {
    let text6 = "";
    for (const byte of bytes) text6 += byte.toString(16).padStart(2, "0");
    return text6.slice(0, length);
  }
  function newSessionId(random = defaultRandom) {
    return `s-${base36(random(6), 8)}-${hex(random(4), 8)}`;
  }
  function newMessageId(random = defaultRandom) {
    return `m-${base36(random(5), 8)}-${hex(random(4), 8)}`;
  }
  function newEventId(random = defaultRandom) {
    return `evt-${base36(random(5), 8)}-${hex(random(4), 8)}`;
  }
  function newOperationId(random = defaultRandom) {
    return `op-${base36(random(5), 8)}-${hex(random(4), 8)}`;
  }
  function isSessionId(value) {
    return typeof value === "string" && SESSION_ID_PATTERN.test(value);
  }
  function isMessageId(value) {
    return typeof value === "string" && MESSAGE_ID_PATTERN.test(value);
  }
  function isChatRole(value) {
    return typeof value === "string" && CHAT_ROLES.includes(value);
  }
  function assertSessionId(value) {
    if (!isSessionId(value)) {
      throw new ChatModelError("INVALID_SESSION_ID", `unsupported session id: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function assertMessageId(value) {
    if (!isMessageId(value)) {
      throw new ChatModelError("INVALID_MESSAGE_ID", `unsupported message id: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function assertRole(value) {
    if (!isChatRole(value)) {
      throw new ChatModelError("INVALID_ROLE", `unsupported role: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function isConfirmationKind(value) {
    return typeof value === "string" && CONFIRMATION_KINDS.includes(value);
  }
  function assertConfirmationKind(value) {
    if (!isConfirmationKind(value)) {
      throw new ChatModelError("INVALID_EVENT", `unsupported confirmation kind: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function isConfirmationState(value) {
    return typeof value === "string" && CONFIRMATION_STATES.includes(value);
  }
  function assertConfirmationState(value) {
    if (!isConfirmationState(value)) {
      throw new ChatModelError("INVALID_EVENT", `unsupported confirmation state: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function isEventId(value) {
    return typeof value === "string" && EVENT_ID_PATTERN.test(value);
  }
  function assertEventId(value) {
    if (!isEventId(value)) {
      throw new ChatModelError("INVALID_EVENT", `unsupported event id: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function isOperationId(value) {
    return typeof value === "string" && OPERATION_ID_PATTERN.test(value);
  }
  function assertOperationId(value) {
    if (!isOperationId(value)) {
      throw new ChatModelError("INVALID_EVENT", `unsupported operation id: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function assertTimestamp(value) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
      throw new ChatModelError("INVALID_TIMESTAMP", `not an ISO timestamp: ${JSON.stringify(value)}`);
    }
    return value;
  }
  function assertScopeKey(value) {
    const text6 = typeof value === "string" ? value.trim() : "";
    const match = /^(project|topic):(.+)$/.exec(text6);
    if (!match || !match[2].trim() || text6.length > 300 || /[\u0000-\u001f]/.test(text6)) {
      throw new ChatModelError("INVALID_SCOPE_KEY", `unsupported scope key: ${JSON.stringify(value)}`);
    }
    return text6;
  }
  function scopeRefFrom(input) {
    const projectId = clean2(input.projectId);
    const topicId = clean2(input.topicId) || clean2(input.flowId) || projectId;
    const scopeKey = assertScopeKey(projectId ? `project:${projectId}` : `topic:${topicId}`);
    return { scopeKey, topicId, projectId: projectId || null };
  }
  function clean2(value) {
    return typeof value === "string" ? value.trim() : value === void 0 || value === null ? "" : String(value).trim();
  }
  function sha256Hex(input) {
    return hex(sha256Bytes(new TextEncoder().encode(input)), 64);
  }
  var SHA256_K = new Uint32Array([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  function rotateRight(value, bits) {
    return (value >>> bits | value << 32 - bits) >>> 0;
  }
  function sha256Bytes(input) {
    const state = new Uint32Array([
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ]);
    const padded = new Uint8Array((input.length + 8 >> 6) + 1 << 6);
    padded.set(input);
    padded[input.length] = 128;
    const paddedView = new DataView(padded.buffer);
    paddedView.setUint32(padded.length - 8, Math.floor(input.length / 536870912));
    paddedView.setUint32(padded.length - 4, input.length << 3 >>> 0);
    const schedule = new Uint32Array(64);
    for (let base = 0; base < padded.length; base += 64) {
      for (let i = 0; i < 16; i++) schedule[i] = paddedView.getUint32(base + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = schedule[i - 15];
        const y = schedule[i - 2];
        const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ x >>> 3;
        const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ y >>> 10;
        schedule[i] = schedule[i - 16] + s0 + schedule[i - 7] + s1 >>> 0;
      }
      let a = state[0], b = state[1], c = state[2], d = state[3];
      let e = state[4], f = state[5], g = state[6], h = state[7];
      for (let i = 0; i < 64; i++) {
        const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = e & f ^ ~e & g;
        const temp1 = h + s1 + choose + SHA256_K[i] + schedule[i] >>> 0;
        const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = a & b ^ a & c ^ b & c;
        const temp2 = s0 + majority >>> 0;
        h = g;
        g = f;
        f = e;
        e = d + temp1 >>> 0;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2 >>> 0;
      }
      state[0] = state[0] + a >>> 0;
      state[1] = state[1] + b >>> 0;
      state[2] = state[2] + c >>> 0;
      state[3] = state[3] + d >>> 0;
      state[4] = state[4] + e >>> 0;
      state[5] = state[5] + f >>> 0;
      state[6] = state[6] + g >>> 0;
      state[7] = state[7] + h >>> 0;
    }
    const digest = new Uint8Array(32);
    const digestView = new DataView(digest.buffer);
    for (let i = 0; i < 8; i++) digestView.setUint32(i * 4, state[i]);
    return digest;
  }
  function scopeHash(scopeKey) {
    return sha256Hex(assertScopeKey(scopeKey)).slice(0, SCOPE_HASH_LENGTH);
  }
  function serializeHeader(header) {
    return `${JSON.stringify({
      v: 1,
      schema: SCHEMA,
      type: "session",
      sessionId: assertSessionId(header.sessionId),
      scopeKey: assertScopeKey(header.scopeKey),
      topicId: header.topicId,
      projectId: header.projectId ?? null,
      title: header.title,
      createdAt: assertTimestamp(header.createdAt)
    })}
`;
  }
  function serializeMessage(message) {
    const payload = message.payload ?? null;
    if (payload !== null && (typeof payload !== "object" || Array.isArray(payload))) {
      throw new ChatModelError("INVALID_EVENT", "a message payload must be a JSON object or null");
    }
    return `${JSON.stringify({
      type: "message",
      messageId: assertMessageId(message.messageId),
      role: assertRole(message.role),
      text: message.text,
      at: assertTimestamp(message.at),
      taskId: message.taskId ?? null,
      provider: message.provider ?? null,
      payload
    })}
`;
  }
  function serializeState(state) {
    const event = { type: "state", at: assertTimestamp(state.at) };
    if (state.archived !== void 0) event.archived = state.archived;
    if (state.title !== void 0) event.title = state.title;
    if (state.hiddenCardId !== void 0) event.hiddenCardId = assertCardId(state.hiddenCardId);
    if (event.archived === void 0 && event.title === void 0 && event.hiddenCardId === void 0) {
      throw new ChatModelError("INVALID_EVENT", "a state event must carry archived, title or hiddenCardId");
    }
    return `${JSON.stringify(event)}
`;
  }
  function assertCardId(value) {
    const text6 = typeof value === "string" ? value : "";
    const split = text6.lastIndexOf("#");
    if (split <= 0 || !/^[adrfp]\d+$/.test(text6.slice(split + 1))) {
      throw new ChatModelError("INVALID_EVENT", `unsupported card id: ${JSON.stringify(value)}`);
    }
    assertMessageId(text6.slice(0, split));
    return text6;
  }
  function normalizeOperationId(state, value) {
    if (value === null || value === void 0) {
      if (state !== "pending" && state !== "abandoned") {
        throw new ChatModelError("INVALID_EVENT", `a ${state} confirmation event must carry an operationId`);
      }
      return null;
    }
    return assertOperationId(value);
  }
  function serializeConfirmation(event) {
    const state = assertConfirmationState(event.state);
    const operationId = normalizeOperationId(state, event.operationId ?? null);
    const detail = event.detail ?? null;
    if (detail !== null && (typeof detail !== "object" || Array.isArray(detail))) {
      throw new ChatModelError("INVALID_EVENT", "a confirmation detail must be a JSON object or null");
    }
    return `${JSON.stringify({
      type: "confirmation",
      eventId: assertEventId(event.eventId),
      messageId: assertMessageId(event.messageId),
      kind: assertConfirmationKind(event.kind),
      state,
      operationId,
      ...detail === null ? {} : { detail },
      at: assertTimestamp(event.at)
    })}
`;
  }
  function parseSessionFile(contents, file = null) {
    const text6 = contents.startsWith("\uFEFF") ? contents.slice(1) : contents;
    const lines = text6.split("\n");
    if (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
    const events = [];
    const lineOf = /* @__PURE__ */ new Map();
    for (let index = 0; index < lines.length; index++) {
      const line2 = lines[index];
      const isLast = index === lines.length - 1;
      let parsed;
      try {
        parsed = JSON.parse(line2);
      } catch (error) {
        if (isLast) break;
        throw new ChatModelError("CORRUPT_LINE", `${describe(file)}:${index + 1} is not valid JSON`, {
          line: index + 1,
          file
        });
      }
      try {
        const event = decodeEvent(parsed);
        events.push(event);
        lineOf.set(event, index + 1);
      } catch (error) {
        throw new ChatModelError(
          "CORRUPT_LINE",
          `${describe(file)}:${index + 1} is not a chat event: ${error.message}`,
          { line: index + 1, file }
        );
      }
    }
    return mergeEvents(events, { file, lineOf: (event) => lineOf.get(event) ?? null });
  }
  function describe(file) {
    return file || "chat session";
  }
  function laterOf(a, b) {
    return b > a ? b : a;
  }
  function decodeEvent(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ChatModelError("INVALID_EVENT", "an event must be a JSON object");
    }
    const event = value;
    if (event.type === "session") {
      if (event.schema !== SCHEMA) {
        throw new ChatModelError("INVALID_EVENT", `unsupported schema: ${JSON.stringify(event.schema)}`);
      }
      return {
        v: 1,
        schema: SCHEMA,
        type: "session",
        sessionId: assertSessionId(event.sessionId),
        scopeKey: assertScopeKey(event.scopeKey),
        topicId: typeof event.topicId === "string" ? event.topicId : "",
        projectId: typeof event.projectId === "string" ? event.projectId : null,
        title: typeof event.title === "string" ? event.title : "",
        createdAt: assertTimestamp(event.createdAt)
      };
    }
    if (event.type === "message") {
      const payload = event.payload;
      if (payload !== void 0 && payload !== null && (typeof payload !== "object" || Array.isArray(payload))) {
        throw new ChatModelError("INVALID_EVENT", "a message payload must be a JSON object or null");
      }
      return {
        type: "message",
        messageId: assertMessageId(event.messageId),
        role: assertRole(event.role),
        text: typeof event.text === "string" ? event.text : String(event.text ?? ""),
        at: assertTimestamp(event.at),
        taskId: typeof event.taskId === "string" ? event.taskId : null,
        provider: typeof event.provider === "string" ? event.provider : null,
        payload: payload ?? null
      };
    }
    if (event.type === "confirmation") {
      const state = assertConfirmationState(event.state);
      const detail = event.detail;
      if (detail !== void 0 && detail !== null && (typeof detail !== "object" || Array.isArray(detail))) {
        throw new ChatModelError("INVALID_EVENT", "a confirmation detail must be a JSON object or null");
      }
      return {
        type: "confirmation",
        eventId: assertEventId(event.eventId),
        messageId: assertMessageId(event.messageId),
        kind: assertConfirmationKind(event.kind),
        state,
        operationId: normalizeOperationId(state, event.operationId ?? null),
        detail: detail ?? null,
        at: assertTimestamp(event.at)
      };
    }
    if (event.type === "state") {
      const state = { type: "state", at: assertTimestamp(event.at) };
      const next = { ...state };
      if (event.archived !== void 0) {
        if (typeof event.archived !== "boolean") throw new ChatModelError("INVALID_EVENT", "archived must be a boolean");
        next.archived = event.archived;
      }
      if (event.title !== void 0) {
        if (typeof event.title !== "string") throw new ChatModelError("INVALID_EVENT", "title must be a string");
        next.title = event.title;
      }
      if (event.hiddenCardId !== void 0) next.hiddenCardId = assertCardId(event.hiddenCardId);
      if (next.archived === void 0 && next.title === void 0 && next.hiddenCardId === void 0) {
        throw new ChatModelError("INVALID_EVENT", "a state event must carry archived, title or hiddenCardId");
      }
      return next;
    }
    throw new ChatModelError("INVALID_EVENT", `unknown event type: ${JSON.stringify(event.type)}`);
  }
  function mergeEvents(events, options = {}) {
    const file = options.file ?? null;
    const headers = events.filter((event) => event.type === "session");
    if (headers.length === 0) {
      throw new ChatModelError(
        "MISSING_HEADER",
        `${describe(file)} has no session header${events.length ? "" : " (it holds no complete line at all)"}`,
        { file }
      );
    }
    if (headers.length > 1) {
      throw new ChatModelError("DUPLICATE_HEADER", `${describe(file)} has ${headers.length} session headers; a session has exactly one`, { file });
    }
    const header = headers[0];
    const messages = [];
    const seen = /* @__PURE__ */ new Set();
    const states = [];
    const confirmationEvents = [];
    let archived = false;
    let title = header.title;
    let updatedAt = header.createdAt;
    for (const event of events) {
      if (event.type === "session") continue;
      if (event.type === "message") {
        if (seen.has(event.messageId)) continue;
        seen.add(event.messageId);
        messages.push(event);
      } else if (event.type === "confirmation") {
        confirmationEvents.push(event);
      } else {
        states.push(event);
        if (event.archived !== void 0) archived = event.archived;
        if (event.title !== void 0) title = event.title;
      }
      updatedAt = laterOf(updatedAt, event.at);
    }
    const confirmations = buildConfirmationLedger(confirmationEvents, { file, lineOf: options.lineOf });
    const firstAt = messages.length ? messages[0].at : header.createdAt;
    const lastAt = messages.length ? messages[messages.length - 1].at : header.createdAt;
    return {
      header,
      sessionId: header.sessionId,
      scopeKey: header.scopeKey,
      topicId: header.topicId,
      projectId: header.projectId,
      title,
      createdAt: header.createdAt,
      updatedAt,
      firstAt,
      lastAt,
      archived,
      messages,
      states,
      confirmations
    };
  }
  function withEvent(view, event, file = null) {
    return mergeEvents([view.header, ...view.messages, ...view.states, ...view.confirmations.events, event], { file });
  }
  var CONFIRMATION_TRANSITIONS = {
    pending: ["pending", "claimed", "abandoned"],
    claimed: ["confirmed", "failed"],
    confirmed: [],
    failed: [],
    abandoned: []
  };
  function isDispatchableConfirmation(state) {
    return state === "pending";
  }
  function isLockedConfirmation(state) {
    return !isDispatchableConfirmation(state);
  }
  function canTransitionConfirmation(from, to) {
    return CONFIRMATION_TRANSITIONS[from].includes(to);
  }
  function confirmationKey(messageId, kind) {
    return `${messageId}#${kind}`;
  }
  function buildConfirmationLedger(events, options = {}) {
    const file = options.file ?? null;
    const lineOf = options.lineOf;
    const seenEventIds = /* @__PURE__ */ new Set();
    const unique = [];
    for (const event of events) {
      if (seenEventIds.has(event.eventId)) continue;
      seenEventIds.add(event.eventId);
      unique.push(event);
    }
    const ordered = [...unique].sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    const groups = /* @__PURE__ */ new Map();
    for (const event of ordered) {
      const key = confirmationKey(event.messageId, event.kind);
      const group = groups.get(key);
      if (group) group.push(event);
      else groups.set(key, [event]);
    }
    const entries = /* @__PURE__ */ new Map();
    const applied = [];
    for (const [key, group] of groups) {
      let entry = null;
      for (const event of group) {
        entry = applyConfirmation(entry, event, { file, line: lineOf?.(event) ?? null });
        applied.push(event);
      }
      if (entry) entries.set(key, entry);
    }
    return { entries, events: applied };
  }
  function applyConfirmation(previous, event, context) {
    const from = previous?.state ?? "pending";
    const where = `${describe(context.file)}${context.line === null ? "" : `:${context.line}`}`;
    const reject2 = (why) => {
      throw new ChatModelError(
        "ILLEGAL_CONFIRMATION_TRANSITION",
        `${where} — ${why} (${event.messageId}, ${event.kind})`,
        { file: context.file, line: context.line }
      );
    };
    if (!canTransitionConfirmation(from, event.state)) {
      reject2(`a confirmation cannot go ${from} → ${event.state}`);
    }
    if (from === "claimed" && (event.state === "confirmed" || event.state === "failed") && event.operationId !== previous?.operationId) {
      reject2(`a ${event.state} must carry the claimed operationId ${JSON.stringify(previous?.operationId)}, not ${JSON.stringify(event.operationId)}`);
    }
    return {
      messageId: event.messageId,
      kind: event.kind,
      state: event.state,
      operationId: event.operationId ?? previous?.operationId ?? null,
      eventId: event.eventId,
      at: event.at,
      detail: event.detail ?? null,
      history: [...previous?.history ?? [], event.state]
    };
  }
  function confirmationStateOf(ledger, messageId, kind) {
    return ledger.entries.get(confirmationKey(messageId, kind))?.state ?? "pending";
  }
  function confirmationEntryOf(ledger, messageId, kind) {
    return ledger.entries.get(confirmationKey(messageId, kind)) ?? null;
  }
  function derivedConfirmationStates(ledger, messageId) {
    const confirmationStates = {};
    const entries = {};
    const locked = [];
    for (const kind of CONFIRMATION_KINDS) {
      const entry = ledger.entries.get(confirmationKey(messageId, kind));
      if (!entry) continue;
      confirmationStates[kind] = entry.state;
      entries[kind] = entry;
      if (isLockedConfirmation(entry.state)) locked.push(kind);
    }
    return {
      confirmationStates,
      actionsState: confirmationStates.action ?? "pending",
      draftsState: confirmationStates.draft ?? "pending",
      locked,
      entries
    };
  }
  function summarize(view) {
    return {
      sessionId: view.sessionId,
      scopeKey: view.scopeKey,
      topicId: view.topicId,
      projectId: view.projectId,
      title: view.title,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
      messageCount: view.messages.length,
      archived: view.archived,
      firstAt: view.firstAt,
      lastAt: view.lastAt
    };
  }
  function clampLimit(limit) {
    const value = typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_PAGE_LIMIT;
    return Math.min(MAX_PAGE_LIMIT, Math.max(1, value));
  }
  function pageMessages(messages, options = {}) {
    const limit = clampLimit(options.limit);
    const total = messages.length;
    let end = total;
    if (options.before !== void 0 && options.before !== null && options.before !== "") {
      const at = messages.findIndex((message) => message.messageId === options.before);
      if (at < 0) {
        throw new ChatModelError("UNKNOWN_CURSOR", `no message ${JSON.stringify(options.before)} in this session`);
      }
      end = at;
    }
    const start = Math.max(0, end - limit);
    const page = messages.slice(start, end);
    const hasMore = start > 0;
    return {
      messages: page,
      hasMore,
      nextCursor: hasMore && page.length ? page[0].messageId : null,
      total
    };
  }
  var SCHOLARIUM_PROTOCOL_NAMES = /* @__PURE__ */ new Set([
    "scholarium-action",
    "scholarium-draft",
    "scholarium-run",
    "scholarium-note-edit",
    "scholarium-normalize",
    "scholarium-plot",
    "scholarium-plot-revise",
    "scholarium-suggest-reconstruction",
    "scholarium-files",
    "scholarium-patch",
    "scholarium-figure"
  ]);
  function actionInput(parsed) {
    for (const key of ["input", "params", "arguments", "payload"]) {
      const value = parsed?.[key];
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) {
        return value;
      }
    }
    return null;
  }
  function protocolAttemptCount(text6, name) {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = String(text6 || "").match(new RegExp("(?:^|\\r?\\n)`{1,}[ \\t]*" + escaped + "(?![\\w-])", "g"));
    return matches ? matches.length : 0;
  }
  function protocolStats(attempted, parsed) {
    return { attempted, parsed, rejected: Math.max(0, attempted - parsed) };
  }
  function malformedProtocolSummary(protocol, payload) {
    let parsed = null;
    const source = String(payload || "");
    try {
      parsed = JSON.parse(source.trim());
    } catch {
    }
    const rawPath = parsed?.path || source.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] || "";
    let decodedPath = String(rawPath);
    try {
      decodedPath = JSON.parse(`"${decodedPath}"`);
    } catch {
    }
    const path2 = String(decodedPath).replace(/\\/g, "/").slice(0, 300);
    const operation = String(parsed?.action || parsed?.operation || "").slice(0, 120);
    const target = path2 || operation || "未能读取目标";
    const guidance = protocol === "scholarium-draft" && /^Experiments\//i.test(path2) ? "这是既有笔记；它不能用新建草稿协议覆盖。请重新生成可确认的笔记修改请求。" : "协议围栏必须使用三个反引号；请重新生成请求。";
    return { protocol, target, guidance };
  }
  function concealMalformedProtocolBlocks(text6) {
    const source = String(text6 || "");
    const failures = [];
    const opener = /(^|\r?\n)(`{1,2})[ \t]*(scholarium-[a-z-]+)[ \t]*\r?\n/g;
    let cursor = 0;
    let output = "";
    let match;
    while (match = opener.exec(source)) {
      const protocol = String(match[3] || "").toLowerCase();
      if (!SCHOLARIUM_PROTOCOL_NAMES.has(protocol)) continue;
      const start = match.index;
      const bodyStart = opener.lastIndex;
      const fence = match[2];
      const closer = new RegExp("(?:^|\\r?\\n)" + fence.replace(/`/g, "\\`") + "[ \\t]*(?=\\r?\\n|$)", "m");
      const tail = source.slice(bodyStart);
      const closing = closer.exec(tail);
      const end = closing ? bodyStart + closing.index + closing[0].length : source.length;
      output += source.slice(cursor, start);
      failures.push(malformedProtocolSummary(protocol, source.slice(bodyStart, closing ? bodyStart + closing.index : end)));
      cursor = end;
      opener.lastIndex = end;
    }
    output += source.slice(cursor);
    if (!failures.length) {
      const orphanAt = output.search(/\{\s*"path"\s*:\s*"(?:\\.|[^"\\])*\.md"\s*,\s*"content"\s*:/i);
      if (orphanAt >= 0) {
        const payload = output.slice(orphanAt);
        failures.push(malformedProtocolSummary("scholarium-draft", payload));
        output = output.slice(0, orphanAt).replace(/(?:^|\r?\n)`{1,3}[ \t]*scholarium-draft[ \t]*$/i, "");
      }
    }
    return { text: output.replace(/\n{3,}/g, "\n\n").trim(), failures };
  }
  function detectWriteClaim(text6) {
    const source = String(text6 || "");
    const pattern = /(?:已|已经|成功)(?:为你|帮你)?(?:添加|保存|写入|创建|更新|记录|排入|安排)|(?:添加|保存|写入|创建|更新|记录|排入|安排)(?:成功|完成|好了)|已(?:重新)?提交(?:了)?(?:修改|写入|保存)?请求/g;
    let match;
    while (match = pattern.exec(source)) {
      const prefix = source.slice(Math.max(0, match.index - 10), match.index);
      if (!/(?:未|没有|并未|尚未|不能|不可|不得|不会|等待|待你|待确认)[^，。；：\n]{0,5}$/.test(prefix)) return match[0];
    }
    return "";
  }
  function parseActionRequests(text6) {
    const source = String(text6 || "");
    const attempted = protocolAttemptCount(source, "scholarium-action");
    const actions2 = [];
    const cleaned = source.replace(/```scholarium-action\s*\n([\s\S]*?)```/g, (match, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        const input = actionInput(parsed);
        if (parsed && typeof parsed.action === "string" && parsed.action.includes(".") && input) {
          actions2.push({
            action: parsed.action,
            input,
            reason: String(parsed.reason || "").slice(0, 300),
            ...typeof parsed.anchor === "string" && parsed.anchor.startsWith("sch:") ? { anchor: parsed.anchor.slice(0, 400) } : {},
            ...typeof parsed.base === "string" && parsed.base ? { base: parsed.base.slice(0, 128) } : {}
          });
          return "";
        }
      } catch {
      }
      return match;
    });
    return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), actions: actions2, stats: protocolStats(attempted, actions2.length) };
  }
  function isValidDraftPath(value) {
    const path2 = String(value || "").replace(/\\/g, "/");
    return Boolean(path2) && !path2.startsWith("/") && !/^[A-Za-z]:/.test(path2) && !path2.includes("../") && path2.toLowerCase().endsWith(".md");
  }
  function parseDraftRequests(text6) {
    const source = String(text6 || "");
    const attempted = protocolAttemptCount(source, "scholarium-draft");
    const drafts = [];
    const cleaned = source.replace(/(`{3,})[ \t]*scholarium-draft[ \t]*\r?\n([\s\S]*?)\1/g, (match, _fence, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        const rawItems = Array.isArray(parsed?.items) ? parsed.items : parsed?.path ? [parsed] : null;
        if (!rawItems) return match;
        const items2 = rawItems.map((item) => ({
          path: String(item?.path || "").replace(/\\/g, "/").slice(0, 300),
          content: String(item?.content || "").slice(0, 2e5),
          ...item?.ref ? { ref: String(item.ref).trim().slice(0, 80) } : {}
        }));
        const allValid = items2.length > 0 && items2.every((item) => isValidDraftPath(item.path) && item.content.trim());
        if (!allValid) return match;
        drafts.push({
          items: items2,
          reason: String(parsed.reason || "").slice(0, 300),
          openAfterCommit: parsed.open_after_commit === true
        });
        return "";
      } catch {
        return match;
      }
    });
    return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), drafts, stats: protocolStats(attempted, drafts.length) };
  }
  var MAX_FILE_OPS = 300;
  var EDITABLE_EXTENSIONS = /\.(md|txt|csv|tsv|json|canvas)$/i;
  function isSafeVaultPath(value) {
    const path2 = String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
    if (!path2 || path2.startsWith("/") || /^[A-Za-z]:/.test(path2)) return false;
    const parts = path2.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) return false;
    const head = (parts[0] ?? "").toLowerCase();
    return head !== ".obsidian" && head !== ".trash" && head !== ".git";
  }
  function normalizePath(value) {
    return String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").trim().slice(0, 400);
  }
  function fileOpFrom(raw) {
    const op = String(raw?.op ?? raw?.type ?? "").trim().toLowerCase();
    if (op === "mkdir" || op === "create_folder" || op === "folder") {
      const path2 = normalizePath(raw.path);
      return isSafeVaultPath(path2) ? { op: "mkdir", path: path2 } : null;
    }
    if (op === "move" || op === "rename") {
      const from = normalizePath(raw.from ?? raw.path);
      const to = normalizePath(raw.to);
      return isSafeVaultPath(from) && isSafeVaultPath(to) && from !== to ? { op: "move", from, to } : null;
    }
    if (op === "create" || op === "write" || op === "new") {
      const path2 = normalizePath(raw.path);
      const content = String(raw.content ?? "");
      return isSafeVaultPath(path2) && EDITABLE_EXTENSIONS.test(path2) ? { op: "create", path: path2, content: content.slice(0, 4e5) } : null;
    }
    if (op === "edit" || op === "modify" || op === "update") {
      const path2 = normalizePath(raw.path);
      const content = String(raw.content ?? "");
      if (!isSafeVaultPath(path2) || !EDITABLE_EXTENSIONS.test(path2) || !content.trim()) return null;
      const changes = Array.isArray(raw.changes) ? raw.changes.slice(0, 50).map((change) => ({
        location: String(change?.location ?? "").slice(0, 200),
        before: String(change?.before ?? "").slice(0, 2e3),
        after: String(change?.after ?? "").slice(0, 2e3)
      })) : void 0;
      return { op: "edit", path: path2, content: content.slice(0, 4e5), ...changes?.length ? { changes } : {} };
    }
    if (op === "trash" || op === "delete" || op === "remove") {
      const path2 = normalizePath(raw.path);
      return isSafeVaultPath(path2) ? { op: "trash", path: path2 } : null;
    }
    return null;
  }
  function parseFilesRequests(text6) {
    const source = String(text6 || "");
    const attempted = protocolAttemptCount(source, "scholarium-files") + protocolAttemptCount(source, "scholarium-note-edit");
    const files = [];
    const cleaned = source.replace(/(`{3,})[ \t]*scholarium-(files|note-edit)[ \t]*\r?\n([\s\S]*?)\1/g, (match, _fence, kind, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        const rawOps = kind === "note-edit" ? [{ ...parsed, op: "edit" }] : Array.isArray(parsed?.ops) ? parsed.ops : null;
        if (!rawOps || !rawOps.length || rawOps.length > MAX_FILE_OPS) return match;
        const ops = rawOps.map(fileOpFrom);
        if (ops.some((op) => op === null)) return match;
        files.push({ ops, reason: String(parsed?.reason ?? "").slice(0, 300) });
        return "";
      } catch {
        return match;
      }
    });
    return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), files, stats: protocolStats(attempted, files.length) };
  }
  function patchOpFrom(raw) {
    const op = String(raw?.op ?? "").trim();
    const anchor = String(raw?.anchor ?? "").trim().slice(0, 500);
    const base = String(raw?.base ?? "").trim().slice(0, 100);
    if (!anchor.startsWith("sch:")) return null;
    if (op === "set_field") return { op, anchor, value: raw.value, base };
    if (op === "replace_section" || op === "append_section") {
      const content = String(raw?.content ?? "").slice(0, 2e5);
      return content.trim() ? { op, anchor, content, base } : null;
    }
    if (op === "replace_text") {
      const find = String(raw?.find ?? "").slice(0, 2e4);
      const replace = String(raw?.replace ?? "").slice(0, 2e4);
      const occurrence = raw?.occurrence === void 0 ? void 0 : Number(raw.occurrence);
      if (!find || occurrence !== void 0 && (!Number.isInteger(occurrence) || occurrence < 1)) return null;
      return { op, anchor, find, replace, base, ...occurrence === void 0 ? {} : { occurrence } };
    }
    return null;
  }
  function parsePatchRequests(text6) {
    const source = String(text6 || "");
    const attempted = protocolAttemptCount(source, "scholarium-patch");
    const patches = [];
    const cleaned = source.replace(/(`{3,})[ \t]*scholarium-patch[ \t]*\r?\n([\s\S]*?)\1/g, (match, _fence, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        const rawOps = Array.isArray(parsed?.ops) ? parsed.ops : null;
        if (!rawOps?.length || rawOps.length > MAX_FILE_OPS) return match;
        const ops = rawOps.map(patchOpFrom);
        if (ops.some((op) => op === null)) return match;
        patches.push({ ops, reason: String(parsed?.reason ?? "").slice(0, 300) });
        return "";
      } catch {
        return match;
      }
    });
    return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), patches, stats: protocolStats(attempted, patches.length) };
  }
  var MAX_FIGURES = 6;
  function figureFrom(raw) {
    const kind = String(raw?.kind ?? "").trim();
    const title = String(raw?.title ?? "").trim().slice(0, 200);
    const saveTo = String(raw?.save_to ?? "").trim().replace(/\\/g, "/").slice(0, 400);
    if (!saveTo || !isSafeVaultPath(saveTo)) return null;
    if (kind === "svg") {
      const svg = String(raw?.svg ?? "");
      if (!/\.svg$/i.test(saveTo) || !/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg) || svg.length > 5e5) return null;
      return { kind, title, save_to: saveTo, svg };
    }
    if (kind === "plot") {
      const dataPath = String(raw?.data_path ?? "").trim().replace(/\\/g, "/");
      const x = String(raw?.x ?? "").trim();
      const y = (Array.isArray(raw?.y) ? raw.y : [raw?.y]).map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 8);
      const type = String(raw?.type ?? "line");
      if (!dataPath || !isSafeVaultPath(dataPath) || !/\.(csv|tsv|txt)$/i.test(dataPath) || !x || !y.length) return null;
      if (!["line", "scatter", "bar"].includes(type) || !/\.svg$/i.test(saveTo)) return null;
      const xLabel = String(raw?.x_label ?? "").trim().slice(0, 120);
      const yLabel = String(raw?.y_label ?? "").trim().slice(0, 120);
      return { kind, title, save_to: saveTo, data_path: dataPath, x, y, type, ...xLabel ? { x_label: xLabel } : {}, ...yLabel ? { y_label: yLabel } : {} };
    }
    if (kind === "generate") {
      const prompt = String(raw?.prompt ?? "").trim().slice(0, 4e3);
      const size = /^\d{3,4}x\d{3,4}$/.test(String(raw?.size ?? "")) ? String(raw?.size) : "1024x1024";
      if (!prompt || !/\.(png|jpe?g|webp)$/i.test(saveTo)) return null;
      return { kind, title, save_to: saveTo, prompt, size };
    }
    return null;
  }
  function parseFigureRequests(text6) {
    const source = String(text6 || "");
    const attempted = protocolAttemptCount(source, "scholarium-figure");
    const figures = [];
    const cleaned = source.replace(/(`{3,})[ \t]*scholarium-figure[ \t]*\r?\n([\s\S]*?)\1/g, (match, _fence, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        const raw = Array.isArray(parsed?.figures) ? parsed.figures : null;
        if (!raw?.length || raw.length > MAX_FIGURES) return match;
        const specs = raw.map(figureFrom);
        if (specs.some((spec) => spec === null)) return match;
        figures.push({ figures: specs, reason: String(parsed?.reason ?? "").slice(0, 300) });
        return "";
      } catch {
        return match;
      }
    });
    return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), figures, stats: protocolStats(attempted, figures.length) };
  }
  var RUN_OPERATIONS = /* @__PURE__ */ new Set(["pipeline.run", "literature.search", "literature.queue", "pipeline.rerun"]);
  function parseRunRequests(text6) {
    const source = String(text6 || "");
    const attempted = protocolAttemptCount(source, "scholarium-run");
    const runs = [];
    const cleaned = source.replace(/```scholarium-run\s*\n([\s\S]*?)```/g, (match, body) => {
      try {
        const parsed = JSON.parse(body.trim());
        const operation = String(parsed?.operation || "").trim();
        if (!RUN_OPERATIONS.has(operation)) return match;
        const topic = String(parsed?.topic || parsed?.query || "").trim().slice(0, 4e3);
        const reason = String(parsed?.reason || "").trim().slice(0, 300);
        if ((operation === "pipeline.run" || operation === "literature.search") && !topic) return match;
        if (operation === "literature.queue") {
          const rawItems = Array.isArray(parsed?.items) ? parsed.items.slice(0, 100) : [];
          const items2 = rawItems.map((item) => {
            const doi = String(item?.doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").slice(0, 240);
            const title = String(item?.title || "").trim().slice(0, 500);
            const url = String(item?.url || (doi ? `https://doi.org/${doi}` : "")).trim().slice(0, 2e3);
            return {
              doi,
              title: title || doi || "待下载论文",
              url,
              reason: String(item?.reason || item?.priority || "织研者筛选后加入").trim().slice(0, 300)
            };
          }).filter((item) => item.doi && /^10\.\d{4,9}\/[\S]+$/i.test(item.doi) && /^https?:\/\/\S+$/i.test(item.url));
          if (!items2.length) return match;
          runs.push({ operation: "literature.queue", items: items2, open: parsed?.open !== false, reason });
          return "";
        }
        if (operation === "pipeline.rerun") {
          const fromStep = String(parsed?.from_step || "").trim();
          const runId = String(parsed?.run_id || "latest").trim();
          if (!fromStep || !/^[a-z0-9-]+$/i.test(fromStep)) return match;
          if (!runId || runId !== "latest" && !/^[a-zA-Z0-9._-]+$/.test(runId)) return match;
          const topicOverride = String(parsed?.topic || "").trim().slice(0, 4e3);
          const queryOverride = String(parsed?.query || "").trim().slice(0, 8e3);
          runs.push({
            operation: "pipeline.rerun",
            run_id: runId.slice(0, 160),
            from_step: fromStep.slice(0, 80),
            reason,
            ...topicOverride ? { topic: topicOverride } : {},
            ...queryOverride ? { query: queryOverride } : {}
          });
        } else {
          runs.push({ operation, topic, reason });
        }
        return "";
      } catch {
        return match;
      }
    });
    return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), runs, stats: protocolStats(attempted, runs.length) };
  }
  function confirmationCards(messages, ledger) {
    const cards = [];
    for (const message of messages) {
      if (message.role !== "agent") continue;
      const actions2 = parseActionRequests(message.text);
      actions2.actions.forEach((request, index) => {
        cards.push(cardFor(message, "action", `${message.messageId}#a${index}`, ledger, {
          reason: request.reason,
          action: request.action,
          input: request.input,
          ...request.anchor ? { anchor: request.anchor } : {},
          ...request.base ? { base: request.base } : {}
        }));
      });
      const drafts = parseDraftRequests(message.text);
      drafts.drafts.forEach((draft, index) => {
        cards.push(cardFor(message, "draft", `${message.messageId}#d${index}`, ledger, {
          reason: draft.reason,
          items: draft.items
        }));
      });
      const run = parseRunRequests(message.text).runs[0];
      if (run) cards.push(cardFor(message, "run", `${message.messageId}#r0`, ledger, { reason: run.reason, run }));
      const batch = parseFilesRequests(message.text).files[0];
      if (batch) cards.push(cardFor(message, "files", `${message.messageId}#f0`, ledger, { reason: batch.reason, files: batch }));
      const patch = parsePatchRequests(message.text).patches[0];
      if (patch) cards.push(cardFor(message, "patch", `${message.messageId}#p0`, ledger, { reason: patch.reason, patch }));
      const figure = parseFigureRequests(message.text).figures[0];
      if (figure) cards.push(cardFor(message, "figure", `${message.messageId}#g0`, ledger, { reason: figure.reason, figure }));
    }
    return cards;
  }
  function cardFor(message, kind, cardId, ledger, request) {
    const entry = confirmationEntryOf(ledger, message.messageId, kind);
    const state = entry?.state ?? "pending";
    return {
      cardId,
      messageId: message.messageId,
      kind,
      state,
      dispatchable: isDispatchableConfirmation(state),
      locked: isLockedConfirmation(state),
      operationId: entry?.operationId ?? null,
      history: entry?.history ?? [],
      detail: entry?.detail ?? null,
      reason: request.reason,
      ...request.action === void 0 ? {} : { action: request.action },
      ...request.input === void 0 ? {} : { input: request.input },
      ...request.anchor === void 0 ? {} : { anchor: request.anchor },
      ...request.base === void 0 ? {} : { base: request.base },
      ...request.items === void 0 ? {} : { items: request.items },
      ...request.run === void 0 ? {} : { run: request.run },
      ...request.files === void 0 ? {} : { files: request.files },
      ...request.patch === void 0 ? {} : { patch: request.patch },
      ...request.figure === void 0 ? {} : { figure: request.figure }
    };
  }
  function replyForDisplay(text6) {
    const source = String(text6 || "");
    const concealed = concealMalformedProtocolBlocks(source);
    const actions2 = parseActionRequests(concealed.text);
    const drafts = parseDraftRequests(actions2.text);
    const runs = parseRunRequests(drafts.text);
    const files = parseFilesRequests(runs.text);
    const patches = parsePatchRequests(files.text);
    const figures = parseFigureRequests(patches.text);
    return {
      text: figures.text,
      figures: figures.figures,
      actions: actions2.actions,
      drafts: drafts.drafts,
      runs: runs.runs,
      files: files.files,
      patches: patches.patches,
      failures: concealed.failures,
      writeClaim: detectWriteClaim(source)
    };
  }

  // src/features/files/vault-file-ops.ts
  var MANIFEST_DIR = "Scholarium/file-ops";
  function parentOf(path2) {
    const at = path2.lastIndexOf("/");
    return at > 0 ? path2.slice(0, at) : "";
  }
  function fingerprint(text6) {
    let hash = 2166136261;
    for (let i = 0; i < text6.length; i += 1) {
      hash ^= text6.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `${text6.length}:${(hash >>> 0).toString(36)}`;
  }
  function lineDiff(before, after, context = 2, maxLines = 4e3) {
    const a = before.split("\n");
    const b = after.split("\n");
    if (a.length > maxLines || b.length > maxLines) {
      return [{ kind: "gap", text: `（文件较大：原 ${a.length} 行 → 新 ${b.length} 行，未逐行比对）` }];
    }
    const n = a.length, m = b.length;
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i2 = n - 1; i2 >= 0; i2 -= 1) {
      const row = table[i2], below = table[i2 + 1];
      for (let j2 = m - 1; j2 >= 0; j2 -= 1) {
        row[j2] = a[i2] === b[j2] ? below[j2 + 1] + 1 : Math.max(below[j2], row[j2 + 1]);
      }
    }
    const raw = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        raw.push({ kind: "same", text: a[i] });
        i += 1;
        j += 1;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        raw.push({ kind: "del", text: a[i] });
        i += 1;
      } else {
        raw.push({ kind: "add", text: b[j] });
        j += 1;
      }
    }
    while (i < n) raw.push({ kind: "del", text: a[i++] });
    while (j < m) raw.push({ kind: "add", text: b[j++] });
    const keep = new Array(raw.length).fill(false);
    raw.forEach((line2, index) => {
      if (line2.kind === "same") return;
      for (let k = Math.max(0, index - context); k <= Math.min(raw.length - 1, index + context); k += 1) keep[k] = true;
    });
    const out2 = [];
    let skipped = 0;
    raw.forEach((line2, index) => {
      if (keep[index]) {
        if (skipped) out2.push({ kind: "gap", text: `… ${skipped} 行未改动 …` });
        skipped = 0;
        out2.push(line2);
      } else skipped += 1;
    });
    if (skipped && out2.length) out2.push({ kind: "gap", text: `… ${skipped} 行未改动 …` });
    return out2.length ? out2 : [{ kind: "gap", text: "（内容没有变化）" }];
  }
  function schemaWarning(path2) {
    return /^Research\//i.test(path2) ? ["这是 Scholarium 正式研究对象（Research/），改动后 Bridge 的字段校验可能报错，请仔细核对。"] : [];
  }
  async function previewFileOps(api, ops) {
    const planned = /* @__PURE__ */ new Map();
    const kindOf = async (path2) => planned.has(path2) ? planned.get(path2) ?? null : api.kind(path2);
    const out2 = [];
    for (const [index, op] of ops.entries()) {
      const fail2 = (problem) => {
        out2.push({ index, op, ok: false, problem, warnings: [] });
      };
      if (op.op === "mkdir") {
        const existing = await kindOf(op.path);
        if (existing === "file") {
          fail2("同名文件已存在");
          continue;
        }
        out2.push({ index, op, ok: true, problem: "", warnings: existing === "folder" ? ["文件夹已存在，将跳过"] : [] });
        planned.set(op.path, "folder");
        continue;
      }
      if (op.op === "move") {
        const source = await kindOf(op.from);
        if (!source) {
          fail2("源文件/文件夹不存在");
          continue;
        }
        if (await kindOf(op.to)) {
          fail2("目标位置已有同名文件，不会覆盖");
          continue;
        }
        out2.push({ index, op, ok: true, problem: "", warnings: [...schemaWarning(op.from), ...source === "folder" ? ["将移动整个文件夹"] : []] });
        planned.set(op.from, null);
        planned.set(op.to, source);
        continue;
      }
      if (op.op === "create") {
        if (await kindOf(op.path)) {
          fail2("文件已存在，不会覆盖（要修改请用“修改”）");
          continue;
        }
        out2.push({ index, op, ok: true, problem: "", warnings: schemaWarning(op.path) });
        planned.set(op.path, "file");
        continue;
      }
      if (op.op === "edit") {
        const kind2 = await kindOf(op.path);
        if (kind2 !== "file") {
          fail2(kind2 === "folder" ? "这是文件夹，不能按笔记修改" : "要修改的笔记不存在");
          continue;
        }
        let current = "";
        try {
          current = await api.read(op.path);
        } catch (error) {
          fail2(`读取失败：${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        out2.push({
          index,
          op,
          ok: true,
          problem: "",
          warnings: schemaWarning(op.path),
          baseHash: fingerprint(current),
          diff: lineDiff(current, op.content)
        });
        continue;
      }
      const kind = await kindOf(op.path);
      if (!kind) {
        fail2("要删除的文件不存在");
        continue;
      }
      out2.push({ index, op, ok: true, problem: "", warnings: ["移到 Obsidian 回收站（.trash），可撤销恢复", ...schemaWarning(op.path)] });
      planned.set(op.path, null);
    }
    return out2;
  }
  async function ensureFolder(api, path2, steps) {
    if (!path2) return;
    const kind = await api.kind(path2);
    if (kind === "folder") return;
    if (kind === "file") throw new Error(`${path2} 是文件，不能作为文件夹`);
    await ensureFolder(api, parentOf(path2), steps);
    await api.createFolder(path2);
    steps.push({ op: "mkdir", path: path2 });
  }
  async function applyFileOps(api, previews, selected, context) {
    const manifest = {
      operationId: context.operationId,
      createdAt: context.now(),
      reason: context.reason,
      steps: [],
      failed: null,
      undoneAt: null
    };
    await context.save(manifest);
    for (const preview of previews) {
      if (!selected.has(preview.index) || !preview.ok) continue;
      const op = preview.op;
      try {
        if (op.op === "mkdir") {
          await ensureFolder(api, op.path, manifest.steps);
        } else if (op.op === "move") {
          if (!await api.kind(op.from)) throw new Error(`${op.from} 已不存在`);
          if (await api.kind(op.to)) throw new Error(`${op.to} 已存在，不会覆盖`);
          await ensureFolder(api, parentOf(op.to), manifest.steps);
          await api.rename(op.from, op.to, true);
          manifest.steps.push({ op: "move", from: op.from, to: op.to });
        } else if (op.op === "create") {
          if (await api.kind(op.path)) throw new Error(`${op.path} 已存在，不会覆盖`);
          await ensureFolder(api, parentOf(op.path), manifest.steps);
          await api.create(op.path, op.content);
          manifest.steps.push({ op: "create", path: op.path });
        } else if (op.op === "edit") {
          const before = await api.read(op.path);
          if (preview.baseHash && fingerprint(before) !== preview.baseHash) {
            throw new Error(`${op.path} 在预览之后被改动过；为避免覆盖你的修改，已停止。请让织研者重新生成修改。`);
          }
          await api.modify(op.path, op.content);
          manifest.steps.push({ op: "edit", path: op.path, before, afterHash: fingerprint(op.content) });
        } else {
          const to = `.trash/scholarium/${context.operationId}/${op.path}`;
          await ensureFolder(api, parentOf(to), []);
          await api.rename(op.path, to, false);
          manifest.steps.push({ op: "trash", from: op.path, to });
        }
        await context.save(manifest);
      } catch (error) {
        manifest.failed = { index: preview.index, error: error instanceof Error ? error.message : String(error) };
        await context.save(manifest);
        break;
      }
    }
    return manifest;
  }
  async function undoFileOps(api, manifest, revertRegions) {
    const problems = [];
    for (const step of [...manifest.steps].reverse()) {
      try {
        if (step.op === "move") {
          if (await api.kind(step.from)) {
            problems.push(`${step.from} 处已有文件，未移回`);
            continue;
          }
          await api.rename(step.to, step.from, true);
        } else if (step.op === "trash") {
          if (await api.kind(step.from)) {
            problems.push(`${step.from} 处已有文件，未从回收站恢复`);
            continue;
          }
          await api.rename(step.to, step.from, false);
        } else if (step.op === "edit") {
          const now = await api.read(step.path);
          if (fingerprint(now) === step.afterHash) {
            await api.modify(step.path, step.before);
            continue;
          }
          if (step.regions?.length && revertRegions) {
            const reverted = revertRegions(now, step.regions);
            if (reverted.content !== now) await api.modify(step.path, reverted.content);
            for (const problem of reverted.problems) problems.push(`${step.path}：${problem}`);
            continue;
          }
          problems.push(`${step.path} 在改动后又被编辑过，未恢复（原文保存在回滚清单里）`);
        } else if (step.op === "create") {
          const to = `.trash/scholarium/${manifest.operationId}-undo/${step.path}`;
          if (await api.kind(step.path)) {
            await ensureFolder(api, parentOf(to), []);
            await api.rename(step.path, to, false);
          }
        }
      } catch (error) {
        problems.push(`${"path" in step ? step.path : step.from}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    manifest.undoneAt = (/* @__PURE__ */ new Date()).toISOString();
    return problems;
  }
  function manifestPath(operationId) {
    return `${MANIFEST_DIR}/${operationId.replace(/[^\w.-]/g, "_")}.json`;
  }
  function describeOp(op) {
    switch (op.op) {
      case "mkdir":
        return `新建文件夹 ${op.path}`;
      case "move":
        return `移动 ${op.from} → ${op.to}`;
      case "create":
        return `新建 ${op.path}`;
      case "edit":
        return `修改 ${op.path}`;
      default:
        return `移到回收站 ${op.path}`;
    }
  }

  // src/features/anchors/scholarium-anchors.ts
  var OBJECT_PREFIX = /^(PRJ|Q|HYP|IDEA|DEC|LES|PAPER|EVD|EXP)-\d+$/i;
  var ALWAYS_PROTECTED = /* @__PURE__ */ new Set(["uid", "display_id", "schema_version", "review_status"]);
  var EXP_PROTECTED = /* @__PURE__ */ new Set(["data_origin", "data_recorded_by", "data_recorded_at", "data_provenance_note"]);
  var DATA_ORIGINS = ["planned", "measured", "simulated", "imported", "demonstration", "unknown", "unverifiable"];
  var ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  var ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  var PROVENANCE_RULES = {
    data_origin: `只能是 ${DATA_ORIGINS.join(" / ")} 之一`,
    data_recorded_by: "只能是 user（user 即研究员本人；人名写进 data_provenance_note）",
    data_recorded_at: "ISO8601 时间，如 2026-10-08T00:00:00（只给日期时插件补 T00:00:00）",
    data_provenance_note: "simulated / unverifiable / measured / imported 必填，说明数据怎么来的、谁记录的"
  };
  var HYP_PROTECTED = /* @__PURE__ */ new Set(["confidence", "confidence_set_by"]);
  var PROTECTED_SECTION = /* @__PURE__ */ new Set(["数据来源"]);
  var DIRECT_ACTION_ONLY = /* @__PURE__ */ new Set(["status"]);
  function cleanPath(path2) {
    return path2.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  }
  function decode(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  function parseAnchor(value) {
    const raw = String(value ?? "").trim();
    if (!raw.startsWith("sch:")) return null;
    let body = raw.slice(4);
    const blockAt = body.lastIndexOf("^");
    const blockId = blockAt >= 0 ? body.slice(blockAt + 1).trim() : "";
    if (blockAt >= 0) body = body.slice(0, blockAt);
    const hashAt = body.indexOf("#");
    const heading = hashAt >= 0 ? body.slice(hashAt + 1) : "";
    if (hashAt >= 0) body = body.slice(0, hashAt);
    const fieldAt = body.lastIndexOf("@");
    const field = fieldAt >= 0 ? body.slice(fieldAt + 1).trim() : "";
    if (fieldAt >= 0) body = body.slice(0, fieldAt);
    const decoded = decode(body.trim());
    const isNote = decoded.toLowerCase().startsWith("note/");
    const objectId = isNote ? "" : decoded;
    let notePath = isNote ? cleanPath(decoded.slice(5)) : "";
    if (notePath && !/\.[a-z0-9]+$/i.test(notePath)) notePath += ".md";
    if (!isNote && !OBJECT_PREFIX.test(objectId) || isNote && (!notePath || notePath.includes(".."))) return null;
    if (field && heading) return null;
    return {
      raw,
      kind: isNote ? "note" : "object",
      objectId,
      notePath,
      field,
      headingPath: heading.split("/").map((part) => decode(part).trim()).filter(Boolean),
      blockId
    };
  }
  var ANCHOR_UNSAFE = /[%\s/#^@`，。；、)）\]]/g;
  function escapeAnchorPart(part) {
    return String(part ?? "").replace(ANCHOR_UNSAFE, (ch) => encodeURIComponent(ch));
  }
  function escapeAnchorPath(path2) {
    return String(path2 ?? "").split("/").map(escapeAnchorPart).join("/");
  }
  function formatHeadingPath(parts) {
    return parts.map(escapeAnchorPart).join("/");
  }
  function shortestTail(section2, all) {
    for (let size = 1; size <= section2.path.length; size += 1) {
      const tail = section2.path.slice(section2.path.length - size);
      if (all.filter((other) => samePath(other.path, tail)).length === 1) return tail;
    }
    return section2.path;
  }
  function canonicalAnchor(value) {
    const parsed = parseAnchor(value);
    if (!parsed) return String(value ?? "").trim();
    const head = parsed.kind === "object" ? `sch:${parsed.objectId.toUpperCase()}` : `sch:note/${escapeAnchorPath(parsed.notePath.replace(/\.md$/i, ""))}`;
    return `${head}${parsed.field ? `@${parsed.field}` : ""}${parsed.headingPath.length ? `#${formatHeadingPath(parsed.headingPath)}` : ""}${parsed.blockId ? `^${parsed.blockId}` : ""}`;
  }
  function extractAnchorRefs(text6) {
    const found = String(text6 ?? "").match(/sch:(?:note\/[^\s#@^`，。；、)）\]]+|(?:PRJ|Q|HYP|IDEA|DEC|LES|PAPER|EVD|EXP)-\d+)(?:@[A-Za-z0-9_\-\u4e00-\u9fff]+|#[^\s`，。；、)）\]]+)?(?:\^sch-[A-Za-z0-9-]+)?/gi) ?? [];
    return [...new Set(found.map((item) => item.replace(/[)\]}>"']+$/, "")))].slice(0, 20);
  }
  function scalar(value) {
    const text6 = value.trim();
    if (!text6) return "";
    if (text6 === "true") return true;
    if (text6 === "false") return false;
    if (text6 === "null" || text6 === "~") return null;
    if (/^-?\d+(?:\.\d+)?$/.test(text6)) return Number(text6);
    if (text6.startsWith("[") && text6.endsWith("]") || text6.startsWith("{") && text6.endsWith("}")) {
      try {
        return JSON.parse(text6.replace(/'/g, '"'));
      } catch {
      }
    }
    return text6.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_m, a, b) => a ?? b ?? text6);
  }
  function frontMatter(content) {
    const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    if (!match) return { start: 0, end: 0, values: {}, ranges: {} };
    const values = {};
    const ranges = {};
    const body = match[1] ?? "";
    const bodyStart = match[0].indexOf(body);
    const lines = [];
    const linePattern = /[^\r\n]*(?:\r\n|\n|$)/g;
    let lineMatch;
    while ((lineMatch = linePattern.exec(body)) && lineMatch[0]) {
      const raw = lineMatch[0];
      const text6 = raw.replace(/\r?\n$/, "");
      lines.push({ text: text6, start: bodyStart + lineMatch.index, end: bodyStart + lineMatch.index + text6.length, next: bodyStart + lineMatch.index + raw.length });
    }
    for (let i = 0; i < lines.length; i += 1) {
      const row = lines[i];
      const line2 = row.text;
      const item = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(line2);
      if (item) {
        let end = row.end;
        let j = i + 1;
        let extra = "";
        while (j < lines.length && /^(?:\s+|\s*-\s+)/.test(lines[j]?.text ?? "")) {
          extra += `
${lines[j]?.text ?? ""}`;
          end = lines[j]?.end ?? end;
          j += 1;
        }
        values[item[1]] = extra ? `${item[2] ?? ""}${extra}` : scalar(item[2] ?? "");
        ranges[item[1]] = [row.start, end];
        i = j - 1;
      }
    }
    return { start: 0, end: match[0].length, values, ranges };
  }
  function sectionsOf(content, bodyStart) {
    const heading = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
    const rows = [];
    const stack = [];
    heading.lastIndex = bodyStart;
    let match;
    while (match = heading.exec(content)) {
      const level = (match[1] ?? "").length;
      const title = (match[2] ?? "").trim();
      while (stack.length && (stack.at(-1)?.level ?? 0) >= level) stack.pop();
      stack.push({ title, level });
      const newline = content.indexOf("\n", match.index);
      rows.push({ title, level, headingStart: match.index, bodyStart: newline < 0 ? content.length : newline + 1, path: stack.map((item) => item.title) });
    }
    return rows.map((row, index) => ({ ...row, end: rows.slice(index + 1).find((next) => next.level <= row.level)?.headingStart ?? content.length }));
  }
  function samePath(actual, requested) {
    if (!requested.length || requested.length > actual.length) return false;
    const tail = actual.slice(actual.length - requested.length);
    return tail.every((value, index) => value === requested[index]);
  }
  function protectedField(id, field) {
    if (ALWAYS_PROTECTED.has(field)) return "研究员专属字段";
    if (/^EXP-/i.test(id) && EXP_PROTECTED.has(field)) return "实验数据来源与记录人只能由研究员维护";
    if (/^HYP-/i.test(id) && HYP_PROTECTED.has(field)) return "假设置信度和设置者只能由研究员维护";
    if (DIRECT_ACTION_ONLY.has(field)) return "status 只能通过 experiment.transition 等白名单动作推进，不能直接改字段";
    return "";
  }
  function declarable(id, field, path2 = []) {
    if (!/^EXP-/i.test(id)) return false;
    return field ? EXP_PROTECTED.has(field) : path2.some((title) => PROTECTED_SECTION.has(title));
  }
  var squash = (text6) => String(text6 ?? "").replace(/\s+/g, "");
  var ORIGIN_TERMS = {
    planned: ["计划", "拟", "准备", "尚未产生", "还没有数据", "待做", "设计阶段"],
    measured: ["实测", "测量", "测试", "表征", "仪器", "实验数据", "样品"],
    simulated: ["模拟", "仿真", "计算", "dft", "gaussian", "量化", "分子动力学"],
    imported: ["导入", "来自", "源自", "数据库", "文献", "检索", "外部", "元数据", "下载"],
    demonstration: ["演示", "示例", "测试用", "验收", "占位"],
    unknown: ["未知", "不清楚", "暂不确定", "未判定"],
    unverifiable: ["无法核实", "不可核验", "无法验证", "追溯不到", "找不到原始"]
  };
  var FIELD_LABEL = {
    data_origin: "数据来源类型",
    data_recorded_by: "记录人",
    data_recorded_at: "记录日期",
    data_provenance_note: "来源说明"
  };
  function localDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  }
  function hostToday() {
    const now = /* @__PURE__ */ new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }
  function chineseDate(text6) {
    const match = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(text6);
    return match ? `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}` : "";
  }
  function originIsStated(origin, text6) {
    const said = String(text6 ?? "").toLowerCase();
    if (said.includes(origin)) return true;
    return (ORIGIN_TERMS[origin] ?? []).some((term) => said.includes(term));
  }
  function sourceIsStated(text6) {
    return /数据来源|来源|数据来自|来自|源自|原始数据|元数据|文献|数据库|检索|测量|实验|计算|模拟|仿真|导入|下载/.test(text6);
  }
  function declaredOp(op, field, researcherText, reason, today = hostToday()) {
    if (!researcherText.trim()) throw new Error(`${reason}。这次消息里还没有说明数据从哪里来、由谁记录或记录时间；请用自然语言补充即可。`);
    if (op.op !== "set_field") return { op, basis: "根据你本轮对数据来源的说明整理；请在确认卡中核对正文。" };
    const value = op.value;
    const said = squash(researcherText);
    const quoted = (text6) => said.includes(squash(text6));
    if (field === "data_recorded_by") {
      if (value !== "user") throw new Error(`data_recorded_by ${PROVENANCE_RULES.data_recorded_by}`);
      if (!/(我|本人|由我|我来|研究员本人|自己)/.test(researcherText) && !/data_recorded_by\s*:\s*user/i.test(researcherText)) throw new Error("无法确认记录人：请自然地说明“由我记录”或“我今天录入”。");
      return { op, basis: "将“我/本人”规范为系统记录人 user。" };
    }
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} 必须是非空文本`);
    if (field === "data_origin") {
      if (!DATA_ORIGINS.includes(value)) throw new Error(`数据来源类型无效：${PROVENANCE_RULES.data_origin}`);
      if (!originIsStated(value, researcherText)) {
        throw new Error(`无法把你的描述归类为“${value}”。请用自然语言说明它是计划、实测、计算模拟、导入的资料、演示数据，还是无法核实；不需要填写字段名。`);
      }
      return { op, basis: `根据你本轮的来源描述，系统归类为“${value}”。` };
    }
    if (field === "data_recorded_at") {
      const normalizedToday = localDate(today);
      const explicitDate = chineseDate(researcherText);
      if (ISO_DATE.test(value.trim()) && quoted(value.trim())) return { op: { ...op, value: `${value.trim()}T00:00:00` }, basis: `将你说的日期规范化为 ${value.trim()} 00:00。` };
      if (ISO_DATETIME.test(value.trim()) && quoted(value.trim())) return { op, basis: "采用你本轮明确给出的记录时间。" };
      if (/今天|当天|现在/.test(researcherText) && normalizedToday && value.trim().startsWith(normalizedToday)) {
        return { op: { ...op, value: `${normalizedToday}T00:00:00` }, basis: `将“今天”按本机日期规范化为 ${normalizedToday} 00:00。` };
      }
      if (explicitDate && value.trim().startsWith(explicitDate)) {
        return { op: { ...op, value: `${explicitDate}T00:00:00` }, basis: `将你说的 ${explicitDate} 规范化为当天 00:00。` };
      }
      throw new Error("无法确认记录日期：可以自然地说“今天录入”或“2026 年 10 月 9 日记录”，确认卡会展示系统换算后的日期。 ");
    }
    if (field === "data_provenance_note") {
      if (!quoted(value) && !sourceIsStated(researcherText)) {
        throw new Error("无法生成来源说明：请用自己的话说明数据来自哪里、如何获得；系统会在确认卡中展示整理后的表述。 ");
      }
      return { op, basis: quoted(value) ? "照录你本轮的来源说明。" : "根据你本轮的来源说明整理为可追溯摘要；请核对措辞。" };
    }
    if (!quoted(value)) throw new Error(`${FIELD_LABEL[field] ?? field} 的拟写内容无法在本轮说明中找到依据；请补充一句自然语言说明。`);
    return { op, basis: "照录你本轮的说明。" };
  }
  function provenanceProblems(content) {
    const values = frontMatter(content).values;
    const origin = values.data_origin;
    if (origin === void 0 || origin === null || origin === "") return [];
    const problems = [];
    const text6 = (key) => String(values[key] ?? "").trim();
    const substantive = (key) => text6(key).replace(/[|>+\-\s]/g, "").length > 0;
    if (!DATA_ORIGINS.includes(String(origin))) problems.push(`data_origin ${PROVENANCE_RULES.data_origin}`);
    if (!text6("data_recorded_by")) problems.push("缺 data_recorded_by（必须为 user）");
    else if (text6("data_recorded_by") !== "user") problems.push("data_recorded_by 必须为 user");
    if (!ISO_DATETIME.test(text6("data_recorded_at"))) problems.push("data_recorded_at 必须是 ISO8601 时间");
    if (["simulated", "unverifiable", "measured", "imported"].includes(String(origin)) && !substantive("data_provenance_note")) {
      problems.push(`data_origin 为 ${String(origin)} 时必须填写 data_provenance_note`);
    }
    if (["measured", "imported"].includes(String(origin))) {
      const refs = values.raw_data_refs;
      const count2 = Array.isArray(refs) ? refs.filter((ref) => String(ref).trim()).length : String(refs ?? "").split("\n").filter((line2) => /^\s*-\s*\S/.test(line2)).length;
      if (!count2) problems.push(`data_origin 为 ${String(origin)} 时至少需要一条 raw_data_refs`);
    }
    return problems.map((problem) => `${problem}（勾选的声明项要一起执行才完整）`);
  }
  function editableSection(path2) {
    return path2.some((title) => PROTECTED_SECTION.has(title)) ? "“数据来源”段及其子段只能由研究员维护" : "";
  }
  async function markdownPaths(api) {
    return api.listMarkdownPaths ? api.listMarkdownPaths() : [];
  }
  async function resolvePath(api, anchor) {
    if (anchor.kind === "note") {
      if (await api.kind(anchor.notePath) !== "file") throw new Error(`笔记不存在：${anchor.notePath}`);
      return anchor.notePath;
    }
    const paths = await markdownPaths(api);
    const candidates = [...paths].sort((a, b) => {
      const rank = (path2) => /^Research\//i.test(path2) ? 0 : /^Experiments\//i.test(path2) ? 1 : 2;
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    const matches = [];
    for (const path2 of candidates) {
      const content = await api.read(path2);
      const fm = frontMatter(content);
      if (String(fm.values.display_id ?? "").trim().toLowerCase() === anchor.objectId.toLowerCase()) matches.push(path2);
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`研究对象 ${anchor.objectId} 有 ${matches.length} 份重复记录：${matches.join("、")}`);
    throw new Error(`没有找到研究对象 ${anchor.objectId}`);
  }
  function titleOf(content, fm, path2) {
    const h1 = /^#\s+(.+)$/m.exec(content.slice(fm.end));
    return String(fm.values.title ?? h1?.[1] ?? path2.split("/").at(-1)?.replace(/\.md$/i, "") ?? path2);
  }
  async function describeAnchor(api, value) {
    const anchor = parseAnchor(value);
    if (!anchor) throw new Error(`无效的 Scholarium 地址：${value}`);
    if (anchor.blockId) throw new Error("块 ID 属于 P4，P1 不会自动写入或修改块 ID");
    const path2 = await resolvePath(api, anchor);
    const content = await api.read(path2);
    const fm = frontMatter(content);
    const id = anchor.objectId || String(fm.values.display_id ?? "");
    const fields = {};
    for (const [field, value2] of Object.entries(fm.values)) {
      const reason = protectedField(id, field);
      const declare = Boolean(reason) && declarable(id, field);
      fields[field] = {
        value: value2,
        editable: reason ? field === "status" ? "via:experiment.transition" : declare ? "researcher-declaration" : false : true,
        ...reason ? { reason: declare ? `${reason}；研究员在本轮消息里亲口给出时可作为“研究员声明”提交，规则：${PROVENANCE_RULES[field] ?? ""}` : reason } : {}
      };
    }
    const all = sectionsOf(content, fm.end);
    const base = anchor.kind === "object" ? `sch:${anchor.objectId}` : `sch:note/${escapeAnchorPath(anchor.notePath.replace(/\.md$/i, ""))}`;
    const sections = all.map((section2) => {
      const reason = editableSection(section2.path);
      return {
        anchor: `${base}#${formatHeadingPath(shortestTail(section2, all))}`,
        chars: Math.max(0, section2.end - section2.bodyStart),
        editable: !reason,
        ...reason ? { reason } : {}
      };
    });
    return { anchor: value, path: path2, title: titleOf(content, fm, path2), version: fingerprint(content), fields, sections, ops: ["set_field", "replace_section", "append_section", "replace_text"] };
  }
  async function describeAnchorsBlock(api, text6) {
    const refs = extractAnchorRefs(text6);
    if (!refs.length) return "";
    const results = [];
    for (const anchor of refs) {
      try {
        results.push(await describeAnchor(api, anchor));
      } catch (error) {
        results.push({ anchor, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return `

【Scholarium 本地 describe（由当前 Vault 读取，不联网）】
${JSON.stringify(results, null, 2)}
【自然语言数据来源声明】研究员不需要输入 data_origin 等字段名。若消息说“这是我今天从文献数据库导入的元数据”或“这是我做的 Gaussian 计算”，请将其转换为相应的字段修改；卡片会展示你的归类、日期换算与拟写说明，供研究员逐项勾选。不要在信息不足时猜测：只问一个自然语言问题，并说明缺少什么，例如“这是实测数据、计算数据，还是从外部资料导入？”
`;
  }
  function yamlValue(value) {
    if (typeof value === "string") return /^[A-Za-z0-9_./\-\u4e00-\u9fff ]+$/.test(value) && !/^(true|false|null|~|\d)/i.test(value) ? value : JSON.stringify(value);
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value === null) return "null";
    return JSON.stringify(value);
  }
  function setField(content, fm, field, value) {
    if (!fm.end) throw new Error("这份笔记没有 YAML frontmatter，不能按字段修改");
    const next = `${field}: ${yamlValue(value)}`;
    const range = fm.ranges[field];
    if (range) return content.slice(0, range[0]) + next + content.slice(range[1]);
    const close = content.lastIndexOf("---", fm.end - 2);
    if (close < 0) throw new Error("frontmatter 结束标记无效");
    return content.slice(0, close) + `${next}
` + content.slice(close);
  }
  function sectionFor(content, fm, path2) {
    const matches = sectionsOf(content, fm.end).filter((section2) => samePath(section2.path, path2));
    if (!matches.length) throw new Error(`没有找到段落：${path2.join("/")}`);
    if (matches.length > 1) throw new Error(`段落地址不唯一，请写完整标题路径：${path2.join("/")}`);
    return matches[0];
  }
  function replaceSection(content, section2, body, append) {
    const normalized = body.replace(/^\n+|\n+$/g, "");
    const current = content.slice(section2.bodyStart, section2.end).replace(/\s+$/, "");
    const nextBody = append ? `${current}${current ? "\n\n" : ""}${normalized}

` : `${normalized}

`;
    return content.slice(0, section2.bodyStart) + nextBody + content.slice(section2.end).replace(/^\n*/, "");
  }
  function replaceExact(source, find, replacement, occurrence) {
    if (!find) throw new Error("replace_text.find 不能为空");
    const positions = [];
    let at = 0;
    while ((at = source.indexOf(find, at)) >= 0) {
      positions.push(at);
      at += Math.max(1, find.length);
    }
    if (!positions.length) throw new Error("没有找到要替换的原文");
    if (occurrence === void 0 && positions.length !== 1) throw new Error(`原文出现 ${positions.length} 次；必须给出 occurrence`);
    const which = occurrence ?? 1;
    if (!Number.isInteger(which) || which < 1 || which > positions.length) throw new Error(`occurrence 超出范围（共 ${positions.length} 处）`);
    const index = positions[which - 1];
    return source.slice(0, index) + replacement + source.slice(index + find.length);
  }
  function applyOne(content, op, parsed, declared = false) {
    const fm = frontMatter(content);
    const id = parsed.objectId || String(fm.values.display_id ?? "");
    if (op.op === "set_field") {
      if (!parsed.field) throw new Error("set_field 地址必须包含 @字段名");
      const reason = protectedField(id, parsed.field);
      if (reason && !(declared && declarable(id, parsed.field))) throw new Error(reason);
      return setField(content, fm, parsed.field, op.value);
    }
    if (!parsed.headingPath.length && op.op !== "replace_text") throw new Error(`${op.op} 地址必须包含 #段落标题`);
    if (parsed.headingPath.length) {
      const target = sectionFor(content, fm, parsed.headingPath);
      const reason = editableSection(target.path);
      if (reason && !(declared && declarable(id, "", target.path))) throw new Error(reason);
      if (op.op === "replace_section") return replaceSection(content, target, op.content, false);
      if (op.op === "append_section") return replaceSection(content, target, op.content, true);
      if (op.op !== "replace_text") throw new Error("操作与地址不匹配");
      const body = content.slice(target.bodyStart, target.end);
      const next = replaceExact(body, op.find, op.replace, op.occurrence);
      return content.slice(0, target.bodyStart) + next + content.slice(target.end);
    }
    if (op.op !== "replace_text") throw new Error("操作与地址不匹配");
    return replaceExact(content, op.find, op.replace, op.occurrence);
  }
  function declarationTarget(content, op, parsed) {
    const fm = frontMatter(content);
    const id = parsed.objectId || String(fm.values.display_id ?? "");
    if (op.op === "set_field") {
      const reason = protectedField(id, parsed.field);
      return reason && declarable(id, parsed.field) ? { field: parsed.field, reason } : null;
    }
    if (!parsed.headingPath.length) return null;
    const matches = sectionsOf(content, fm.end).filter((section3) => samePath(section3.path, parsed.headingPath));
    const section2 = matches[0];
    return matches.length === 1 && section2 && declarable(id, "", section2.path) ? { field: "", reason: editableSection(section2.path) } : null;
  }
  async function previewPatchOps(api, ops, context = {}) {
    const out2 = [];
    for (const [index, original] of ops.entries()) {
      let op = original;
      let parsed = null;
      let path2 = "";
      let current = "";
      try {
        parsed = parseAnchor(op.anchor);
        if (!parsed) throw new Error("地址无效或不属于 P1");
        if (parsed.blockId) throw new Error("块 ID 属于 P4，P1 不执行");
        path2 = await resolvePath(api, parsed);
        current = await api.read(path2);
        const version = fingerprint(current);
        if (!op.base) throw new Error(`缺少 base 版本；请先 describe ${op.anchor}`);
        if (op.base !== version) throw new Error(`版本不一致：补丁基于 ${op.base}，当前是 ${version}；请重新 describe 后生成`);
        const target = declarationTarget(current, op, parsed);
        const declaration = target ? declaredOp(op, target.field, context.researcherText ?? "", target.reason, context.today) : null;
        if (declaration) op = declaration.op;
        const after = applyOne(current, op, parsed, Boolean(target));
        if (after === current) throw new Error("修改前后相同");
        out2.push({ index, op, ok: true, problem: "", path: path2, baseHash: version, before: current, after, diff: lineDiff(current, after), ...target ? { declaration: true, declarationBasis: declaration?.basis ?? "" } : {} });
      } catch (error) {
        out2.push({ index, op, ok: false, problem: error instanceof Error ? error.message : String(error), path: path2, baseHash: current ? fingerprint(current) : "", before: current, after: current, diff: [] });
      }
    }
    return out2;
  }
  function regionText(content, op, parsed) {
    const fm = frontMatter(content);
    if (op.op === "set_field") {
      const range = fm.ranges[parsed.field];
      return range ? content.slice(range[0], range[1]) : null;
    }
    if (!parsed.headingPath.length) return content;
    const matches = sectionsOf(content, fm.end).filter((section3) => samePath(section3.path, parsed.headingPath));
    if (matches.length !== 1) return null;
    const section2 = matches[0];
    return content.slice(section2.bodyStart, section2.end);
  }
  function replaceRegion(content, op, parsed, next) {
    const fm = frontMatter(content);
    if (op.op === "set_field") {
      const range = fm.ranges[parsed.field];
      if (next === null) {
        if (!range) return content;
        const end = content[range[1]] === "\r" ? range[1] + 2 : content[range[1]] === "\n" ? range[1] + 1 : range[1];
        return content.slice(0, range[0]) + content.slice(end);
      }
      if (range) return content.slice(0, range[0]) + next + content.slice(range[1]);
      const close = content.lastIndexOf("---", fm.end - 2);
      return close < 0 ? null : content.slice(0, close) + `${next}
` + content.slice(close);
    }
    if (!parsed.headingPath.length) return next;
    const matches = sectionsOf(content, fm.end).filter((section3) => samePath(section3.path, parsed.headingPath));
    if (matches.length !== 1 || next === null) return null;
    const section2 = matches[0];
    return content.slice(0, section2.bodyStart) + next + content.slice(section2.end);
  }
  function revertPatchRegions(content, regions) {
    let text6 = content;
    const problems = [];
    for (const region of [...regions].reverse()) {
      const parsed = parseAnchor(region.anchor);
      const op = { op: region.op, anchor: region.anchor };
      if (!parsed) {
        problems.push(`${region.anchor} 地址无效，未恢复`);
        continue;
      }
      const now = regionText(text6, op, parsed);
      if (now !== region.after) {
        problems.push(`${readableAnchor(region.anchor)} 在改动后又被编辑过，这一处未恢复（原文保存在回滚清单里）`);
        continue;
      }
      const next = replaceRegion(text6, op, parsed, region.before);
      if (next === null) {
        problems.push(`${readableAnchor(region.anchor)} 无法定位，未恢复`);
        continue;
      }
      text6 = next;
    }
    return { content: text6, problems };
  }
  async function revalidatePatchPreviews(api, previews) {
    const current = /* @__PURE__ */ new Map();
    const out2 = [];
    for (const preview of previews) {
      if (!preview.ok) {
        out2.push(preview);
        continue;
      }
      if (!current.has(preview.path)) {
        try {
          current.set(preview.path, await api.read(preview.path));
        } catch {
          current.set(preview.path, null);
        }
      }
      const now = current.get(preview.path) ?? null;
      if (now === null) {
        out2.push({ ...preview, ok: false, problem: `笔记已不存在：${preview.path}` });
        continue;
      }
      if (fingerprint(now) === preview.baseHash) {
        out2.push(preview);
        continue;
      }
      const parsed = parseAnchor(preview.op.anchor);
      const same = parsed ? regionText(preview.before, preview.op, parsed) === regionText(now, preview.op, parsed) : false;
      out2.push(same ? { ...preview, warning: "这份笔记的其它位置在预览后有改动；本处未变，仍可执行" } : { ...preview, ok: false, problem: `版本冲突：${readableAnchor(preview.op.anchor)} 在预览后被改过；请让织研者重新 describe 后生成` });
    }
    return out2;
  }
  function selectionProblems(previews, selected) {
    const groups = /* @__PURE__ */ new Map();
    for (const preview of previews) {
      if (!preview.ok || !selected.has(preview.index)) continue;
      groups.set(preview.path, [...groups.get(preview.path) ?? [], preview]);
    }
    const problems = [];
    for (const [path2, group] of groups) {
      if (!group.some((item) => item.declaration)) continue;
      let after = group[0]?.before ?? "";
      try {
        for (const preview of [...group].sort((a, b) => a.index - b.index)) {
          const parsed = parseAnchor(preview.op.anchor);
          if (parsed) after = applyOne(after, preview.op, parsed, Boolean(preview.declaration));
        }
      } catch (error) {
        problems.push(`${path2}：${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      for (const problem of provenanceProblems(after)) problems.push(`${path2}：${problem}`);
    }
    return problems;
  }
  async function applyPatchOps(api, previews, selected, context) {
    const manifest = { operationId: context.operationId, createdAt: context.now(), reason: context.reason, steps: [], failed: null, undoneAt: null };
    await context.save(manifest);
    const groups = /* @__PURE__ */ new Map();
    for (const preview of previews) {
      if (!preview.ok || !selected.has(preview.index)) continue;
      const group = groups.get(preview.path) ?? [];
      group.push(preview);
      groups.set(preview.path, group);
    }
    for (const [path2, group] of groups) {
      try {
        const before = await api.read(path2);
        const expected = group[0]?.baseHash ?? "";
        if (group.some((item) => item.baseHash !== expected)) throw new Error(`${path2} 的同批操作基于不同版本；未写入`);
        if (fingerprint(before) !== expected) {
          const conflicts = group.filter((item) => {
            const parsed = parseAnchor(item.op.anchor);
            return !parsed || regionText(item.before, item.op, parsed) !== regionText(before, item.op, parsed);
          });
          if (conflicts.length) {
            throw new Error(`版本冲突：${conflicts.map((item) => readableAnchor(item.op.anchor)).join("、")} 在预览后被改过；这份笔记未写入`);
          }
        }
        let after = before;
        const regions = [];
        for (const preview of group.sort((a, b) => a.index - b.index)) {
          const parsed = parseAnchor(preview.op.anchor);
          if (!parsed) throw new Error(`第 ${preview.index + 1} 项地址无效`);
          const regionBefore = regionText(after, preview.op, parsed);
          after = applyOne(after, preview.op, parsed, Boolean(preview.declaration));
          regions.push({ anchor: preview.op.anchor, op: preview.op.op, before: regionBefore, after: regionText(after, preview.op, parsed) });
        }
        if (group.some((item) => item.declaration)) {
          const problems = provenanceProblems(after);
          if (problems.length) throw new Error(`数据来源声明不完整，未写入：${problems.join("；")}`);
        }
        await api.modify(path2, after);
        manifest.steps.push({ op: "edit", path: path2, before, afterHash: fingerprint(after), regions });
        await context.save(manifest);
      } catch (error) {
        manifest.failed = { index: group[0]?.index ?? -1, error: error instanceof Error ? error.message : String(error) };
        await context.save(manifest);
        break;
      }
    }
    return manifest;
  }
  function readableAnchor(value) {
    const anchor = parseAnchor(value);
    if (!anchor) return decode(String(value ?? ""));
    const head = anchor.kind === "object" ? anchor.objectId : anchor.notePath.replace(/\.md$/i, "");
    let path2 = [...anchor.headingPath];
    if (anchor.kind === "object" && path2.length > 1 && path2[0]?.toUpperCase().startsWith(anchor.objectId.toUpperCase())) path2 = path2.slice(1);
    return [
      head,
      anchor.field ? ` @ ${anchor.field}` : "",
      path2.length ? ` › ${path2.join(" › ")}` : "",
      anchor.blockId ? ` ^${anchor.blockId}` : ""
    ].join("");
  }
  function describePatchOp(op) {
    const label = { set_field: "修改字段", replace_section: "替换段落", append_section: "追加段落", replace_text: "定位替换" }[op.op];
    return `${label} ${readableAnchor(op.anchor)}`;
  }

  // src/features/anchors/control-plane-anchors.ts
  var SAFE_ID = /^[^\s/#@^`，。；、)）\]\\]+$/;
  function decode2(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  function parseControlAnchor(value) {
    const raw = String(value ?? "").trim();
    if (!raw.startsWith("sch:")) return null;
    const parts = raw.slice(4).split("/").map(decode2);
    if (parts.length !== 3 || !parts.every(Boolean)) return null;
    const [namespace, collection, id] = parts;
    if (!SAFE_ID.test(id) || id === "." || id === "..") return null;
    if (namespace === "workspace" && collection === "timeblocks") return { raw, kind: "workspace-timeblock", id };
    if (namespace === "workspace" && collection === "tasks") return { raw, kind: "workspace-task", id };
    if (namespace === "material" && collection === "items") return { raw, kind: "material-item", id };
    if (namespace === "feed" && collection === "articles") return { raw, kind: "feed-article", id };
    return null;
  }
  function canonicalControlAnchor(value) {
    const parsed = parseControlAnchor(value);
    if (!parsed) return String(value ?? "").trim();
    const id = encodeURIComponent(parsed.id);
    switch (parsed.kind) {
      case "workspace-timeblock":
        return `sch:workspace/timeblocks/${id}`;
      case "workspace-task":
        return `sch:workspace/tasks/${id}`;
      case "material-item":
        return `sch:material/items/${id}`;
      case "feed-article":
        return `sch:feed/articles/${id}`;
    }
  }
  function extractControlAnchorRefs(text6) {
    const pattern = /sch:(?:workspace\/(?:timeblocks|tasks)|material\/items|feed\/articles)\/[^\s#@^`，。；、)）\]\\]+/gi;
    return [...new Set((String(text6 ?? "").match(pattern) ?? []).map((item) => item.replace(/[)\]}>'\"]+$/, "")))].slice(0, 20);
  }
  function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function items(value) {
    return Array.isArray(value) ? value.map(record) : [];
  }
  function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      const row = value;
      return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  function fieldsOf(item, editable) {
    const allowed = new Set(editable);
    return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, { value, editable: allowed.has(key) }]));
  }
  function feedProjection(article) {
    const relevance = record(article.relevance);
    return {
      id: article.id,
      feedId: article.feedId,
      title: article.title,
      link: article.link,
      published: article.published,
      author: article.author,
      overall_score: relevance.overallScore ?? null,
      score_reason: relevance.reason ?? "",
      read: Boolean(article.read),
      starred: Boolean(article.starred)
    };
  }
  async function itemFor(reader, anchor) {
    let action = "";
    let input = {};
    let pick = () => [];
    if (anchor.kind === "workspace-timeblock") {
      action = "workspace.get_state";
      input = { section: "timeblocks" };
      pick = (result) => items(record(result).value);
    } else if (anchor.kind === "workspace-task") {
      action = "workspace.get_state";
      input = { section: "tasks" };
      pick = (result) => items(record(result).value);
    } else if (anchor.kind === "material-item") {
      action = "material.list";
      pick = (result) => items(record(result).items);
    } else {
      action = "rss.list_articles";
      pick = (result) => items(record(result).articles);
    }
    const read = await reader(action, input);
    if (!read.ok) throw new Error(read.error);
    const item = pick(read.result).find((candidate) => String(candidate.id ?? "") === anchor.id);
    if (!item) throw new Error(`识别点不存在或已被删除：${canonicalControlAnchor(anchor.raw)}`);
    return item;
  }
  async function describeControlAnchor(reader, value) {
    const anchor = parseControlAnchor(value);
    if (!anchor) throw new Error(`无效的 P2 Scholarium 地址：${value}`);
    const item = await itemFor(reader, anchor);
    const base = canonicalControlAnchor(value);
    if (anchor.kind === "workspace-timeblock") {
      return { anchor: base, title: String(item.title ?? anchor.id), version: sha256Hex(stable(item)), fields: fieldsOf(item, ["date", "startTime", "endTime", "category", "title", "note", "experimentUid", "executionStatus", "executionNote"]), actions: ["workspace.timeblock_update"] };
    }
    if (anchor.kind === "workspace-task") {
      return { anchor: base, title: String(item.title ?? anchor.id), version: sha256Hex(stable(item)), fields: fieldsOf(item, ["title", "status", "due", "note"]), actions: ["workspace.task_update"] };
    }
    if (anchor.kind === "material-item") {
      return { anchor: base, title: String(item.name ?? item.path ?? anchor.id), version: sha256Hex(stable(item)), fields: fieldsOf(item, ["name", "category"]), actions: ["material.update"] };
    }
    const projected = feedProjection(item);
    return { anchor: base, title: String(projected.title ?? anchor.id), version: sha256Hex(stable(projected)), fields: fieldsOf(projected, ["overall_score", "read", "starred"]), actions: ["rss.set_article_score", "rss.mark_article"] };
  }
  async function describeControlAnchorsBlock(reader, text6) {
    const refs = extractControlAnchorRefs(text6);
    if (!refs.length) return "";
    const manifests = await Promise.all(refs.map(async (anchor) => {
      try {
        return await describeControlAnchor(reader, anchor);
      } catch (error) {
        return { anchor, error: error instanceof Error ? error.message : String(error) };
      }
    }));
    return `

【Scholarium P2 本地 describe（工作台/订阅/素材库；由本机 Bridge 读取，不联网）】
${JSON.stringify(manifests, null, 2)}
`;
  }
  var ACTIONS = {
    "workspace-timeblock": ["workspace.timeblock_update"],
    "workspace-task": ["workspace.task_update"],
    "material-item": ["material.update"],
    "feed-article": ["rss.set_article_score", "rss.mark_article"]
  };
  async function verifyControlAction(reader, request) {
    const anchor = parseControlAnchor(request.anchor);
    if (!anchor) throw new Error(`无效的 P2 Scholarium 地址：${request.anchor}`);
    if (!request.base) throw new Error("P2 修改缺少 describe.version；请重新 describe 后再提交");
    if (!ACTIONS[anchor.kind].includes(request.action)) throw new Error(`${canonicalControlAnchor(request.anchor)} 不允许动作 ${request.action}`);
    const idKey = anchor.kind === "feed-article" ? "article_id" : "id";
    if (String(request.input[idKey] ?? "") !== anchor.id) throw new Error(`动作 ${request.action} 的 ${idKey} 必须与识别点一致`);
    const current = await describeControlAnchor(reader, request.anchor);
    if (current.version !== request.base) throw new Error(`版本冲突：${current.anchor} 在预览后被改过；请重新 describe 后生成`);
    return current;
  }
  var INPUT_FIELDS = {
    "workspace.task_update": { title: "title", status: "status", due: "due", note: "note" },
    "workspace.timeblock_update": {
      date: "date",
      startTime: "startTime",
      endTime: "endTime",
      category: "category",
      title: "title",
      note: "note",
      execution_status: "executionStatus",
      execution_note: "executionNote"
    },
    "material.update": { name: "name", category: "category" },
    "rss.set_article_score": { overall_score: "overall_score", score: "overall_score" },
    "rss.mark_article": { read: "read", starred: "starred" }
  };
  var REVERSIBLE = {
    "workspace.task_update": /* @__PURE__ */ new Set(["title", "status", "due", "note"]),
    "workspace.timeblock_update": /* @__PURE__ */ new Set(["date", "startTime", "endTime", "category", "title", "note"]),
    "material.update": /* @__PURE__ */ new Set(["name", "category"]),
    "rss.set_article_score": /* @__PURE__ */ new Set(["overall_score"]),
    "rss.mark_article": /* @__PURE__ */ new Set(["read", "starred"])
  };
  function controlChanges(manifest, action, input) {
    const map = INPUT_FIELDS[action] ?? {};
    const out2 = [];
    for (const [key, value] of Object.entries(input)) {
      const field = map[key];
      if (!field) continue;
      out2.push({ field, before: manifest.fields[field]?.value ?? null, after: value });
    }
    return out2;
  }
  function inverseControlAction(before, action, input) {
    const anchor = parseControlAnchor(before.anchor);
    if (!anchor) return { reason: "地址无效" };
    const map = INPUT_FIELDS[action] ?? {};
    const reversible = REVERSIBLE[action] ?? /* @__PURE__ */ new Set();
    const idKey = anchor.kind === "feed-article" ? "article_id" : "id";
    const inverse = { [idKey]: anchor.id };
    const skipped = [];
    for (const key of Object.keys(input)) {
      const field = map[key];
      if (!field) continue;
      if (!reversible.has(field)) {
        skipped.push(field);
        continue;
      }
      const previous = before.fields[field]?.value;
      if (action === "rss.set_article_score") {
        if (typeof previous !== "number") return { reason: "这篇文章修改前没有评分，评分无法撤回为“未评分”" };
        inverse.overall_score = previous;
        inverse.reason = `撤销织研者的评分修改，恢复为 ${previous}`;
        continue;
      }
      if (previous === void 0) {
        skipped.push(field);
        continue;
      }
      inverse[key === "score" ? "overall_score" : key] = previous;
    }
    if (Object.keys(inverse).length <= (action === "rss.set_article_score" ? 2 : 1)) {
      return { reason: skipped.length ? `${skipped.join("、")} 是执行记录，不能用撤销抹掉` : "没有可撤销的字段" };
    }
    return { undo: { action, input: inverse, ...skipped.length ? { note: `${skipped.join("、")} 不会被撤销` } : {} } };
  }

  // src/plugin/views/markdown-lite.ts
  var active2 = {};
  var ANCHOR_TEXT = /^sch:(?:note\/[^\s`，。；、)）\]]+|(?:PRJ|Q|HYP|IDEA|DEC|LES|PAPER|EVD|EXP)-\d+(?:@[A-Za-z0-9_\-]+|#[^\s`，。；、)）\]]+)?|workspace\/(?:timeblocks|tasks)\/[^\s`，。；、)）\]]+|material\/items\/[^\s`，。；、)）\]]+|feed\/articles\/[^\s`，。；、)）\]]+)$/i;
  function anchorLink(doc, raw) {
    const value = raw.replace(/[.,;:!?。，；：！？]+$/, "");
    const noteAnchor = parseAnchor(value);
    const controlAnchor = parseControlAnchor(value);
    if (!ANCHOR_TEXT.test(value) || !noteAnchor && !controlAnchor) return null;
    const link2 = node(doc, "a", `${C5}-anchor`);
    link2.setAttribute("data-sch-anchor", value);
    link2.setAttribute("href", "#");
    link2.setAttribute("title", `${value}
点击打开 · Alt+点击引用到输入框`);
    link2.textContent = noteAnchor ? readableAnchor(value) : value.slice(4).replaceAll("/", " › ");
    const handler = active2.onAnchor;
    if (handler) {
      link2.addEventListener("click", (event) => {
        event.preventDefault?.();
        handler(value, event);
      });
    }
    return link2;
  }
  var C5 = "scholarium-weaver__md";
  function node(doc, tag, cls) {
    const element = doc.createElement(tag);
    if (cls) element.className = cls;
    return element;
  }
  function textRun(doc, value) {
    if (typeof doc.createTextNode === "function") return doc.createTextNode(value);
    const span = doc.createElement("span");
    span.textContent = value;
    return span;
  }
  function safeHref(raw) {
    const href = raw.trim().replace(/^<|>$/g, "");
    return /^https?:\/\/[^\s]+$/i.test(href) ? href : null;
  }
  function appendInline(doc, parent, text6) {
    let rest = text6;
    const pattern = /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()（），。；]+)|(sch:[^\s`，。；、)）\]]+)|!\[([^\]]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/;
    while (rest) {
      const match = pattern.exec(rest);
      if (!match) {
        parent.appendChild(textRun(doc, rest));
        return;
      }
      if (match.index > 0) parent.appendChild(textRun(doc, rest.slice(0, match.index)));
      const [whole, , code, bold1, bold2, del, em1, em2, linkText, linkHref, bare, schRef, imageAlt, imageAngled, imagePlain] = match;
      const imageSrc = imageAngled ?? imagePlain;
      if (imageSrc !== void 0) {
        const url = active2.resolveImage?.(imageSrc) ?? null;
        if (url) {
          const image = node(doc, "img", `${C5}-image`);
          image.setAttribute("src", url);
          image.setAttribute("alt", imageAlt ?? "");
          image.setAttribute("title", imageAlt || imageSrc);
          image.setAttribute("data-src", imageSrc);
          const open = active2.onImage;
          if (open) image.addEventListener("click", () => open(imageSrc));
          parent.appendChild(image);
        } else {
          parent.appendChild(textRun(doc, whole));
        }
        rest = rest.slice(match.index + whole.length);
        continue;
      }
      const codeAnchor = code !== void 0 ? anchorLink(doc, code.trim()) : null;
      if (codeAnchor) {
        parent.appendChild(codeAnchor);
      } else if (schRef !== void 0) {
        const value = schRef.replace(/[.,;:!?。，；：！？]+$/, "");
        const link2 = anchorLink(doc, value);
        const trailing = link2 ? schRef.slice(value.length) : "";
        parent.appendChild(link2 ?? textRun(doc, schRef));
        if (link2 && trailing) parent.appendChild(textRun(doc, trailing));
      } else if (code !== void 0) {
        const element = node(doc, "code", `${C5}-code`);
        element.textContent = code.replace(/^ (.*) $/, "$1");
        parent.appendChild(element);
      } else if (bold1 !== void 0 || bold2 !== void 0) {
        const element = node(doc, "strong");
        appendInline(doc, element, bold1 ?? bold2);
        parent.appendChild(element);
      } else if (del !== void 0) {
        const element = node(doc, "del");
        appendInline(doc, element, del);
        parent.appendChild(element);
      } else if (em1 !== void 0 || em2 !== void 0) {
        const element = node(doc, "em");
        appendInline(doc, element, em1 ?? em2);
        parent.appendChild(element);
      } else if (linkText !== void 0) {
        const href = safeHref(linkHref ?? "");
        if (href) {
          const anchor = node(doc, "a", `${C5}-link`);
          anchor.setAttribute("href", href);
          anchor.setAttribute("target", "_blank");
          anchor.setAttribute("rel", "noopener noreferrer");
          appendInline(doc, anchor, linkText);
          parent.appendChild(anchor);
        } else {
          appendInline(doc, parent, linkText);
        }
      } else if (bare !== void 0) {
        const anchor = node(doc, "a", `${C5}-link`);
        anchor.setAttribute("href", bare);
        anchor.setAttribute("target", "_blank");
        anchor.setAttribute("rel", "noopener noreferrer");
        anchor.textContent = bare;
        parent.appendChild(anchor);
      } else {
        parent.appendChild(textRun(doc, whole));
      }
      rest = rest.slice(match.index + whole.length);
    }
  }
  function splitRow(line2) {
    let body = line2.trim();
    if (body.startsWith("|")) body = body.slice(1);
    if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
    const cells = [];
    let current = "";
    let inCode = false;
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === "\\" && body[i + 1] === "|") {
        current += "|";
        i += 1;
        continue;
      }
      if (ch === "`") inCode = !inCode;
      if (ch === "|" && !inCode) {
        cells.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    cells.push(current.trim());
    return cells;
  }
  var TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  var LIST_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  var HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  var RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
  var FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)\s*$/;
  function renderMarkdown(doc, text6, options) {
    if (options === void 0) return renderBlocks(doc, text6);
    const previous = active2;
    active2 = options;
    try {
      return renderBlocks(doc, text6);
    } finally {
      active2 = previous;
    }
  }
  function renderBlocks(doc, text6) {
    const root = node(doc, "div", C5);
    const lines = String(text6 ?? "").replace(/\r\n?/g, "\n").split("\n");
    let i = 0;
    const isBlockStart = (line2, next) => HEADING.test(line2) || RULE.test(line2) || FENCE.test(line2) || /^\s{0,3}>/.test(line2) || LIST_ITEM.test(line2) || line2.includes("|") && next !== void 0 && TABLE_SEPARATOR.test(next);
    while (i < lines.length) {
      const line2 = lines[i];
      if (!line2.trim()) {
        i += 1;
        continue;
      }
      const fence = FENCE.exec(line2);
      if (fence) {
        const marker = fence[1][0];
        const body = [];
        i += 1;
        while (i < lines.length && !new RegExp(`^\\s{0,3}\\${marker}{3,}\\s*$`).test(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        i += 1;
        const pre = node(doc, "pre", `${C5}-pre`);
        const code = node(doc, "code");
        if (fence[2]) code.setAttribute("data-lang", fence[2]);
        code.textContent = body.join("\n");
        pre.appendChild(code);
        root.appendChild(pre);
        continue;
      }
      const heading = HEADING.exec(line2);
      if (heading) {
        const level = Math.min(6, heading[1].length + 1);
        const element = node(doc, `h${level}`, `${C5}-h`);
        appendInline(doc, element, heading[2]);
        root.appendChild(element);
        i += 1;
        continue;
      }
      if (RULE.test(line2)) {
        root.appendChild(node(doc, "hr", `${C5}-hr`));
        i += 1;
        continue;
      }
      const next = lines[i + 1];
      if (line2.includes("|") && next !== void 0 && TABLE_SEPARATOR.test(next)) {
        const head = splitRow(line2);
        const align = splitRow(next).map((cell) => /^:-+:$/.test(cell) ? "center" : /-+:$/.test(cell) ? "right" : "");
        const wrap = node(doc, "div", `${C5}-table-wrap`);
        const table = node(doc, "table", `${C5}-table`);
        const thead = node(doc, "thead");
        const headRow = node(doc, "tr");
        head.forEach((cell, index) => {
          const th = node(doc, "th");
          if (align[index]) th.setAttribute("style", `text-align:${align[index]}`);
          appendInline(doc, th, cell);
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = node(doc, "tbody");
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          const cells = splitRow(lines[i]);
          const tr = node(doc, "tr");
          for (let index = 0; index < head.length; index += 1) {
            const td = node(doc, "td");
            if (align[index]) td.setAttribute("style", `text-align:${align[index]}`);
            appendInline(doc, td, cells[index] ?? "");
            tr.appendChild(td);
          }
          tbody.appendChild(tr);
          i += 1;
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        root.appendChild(wrap);
        continue;
      }
      if (/^\s{0,3}>/.test(line2)) {
        const body = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
          body.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
          i += 1;
        }
        const quote = node(doc, "blockquote", `${C5}-quote`);
        quote.appendChild(renderBlocks(doc, body.join("\n")));
        root.appendChild(quote);
        continue;
      }
      if (LIST_ITEM.test(line2)) {
        const items2 = [];
        while (i < lines.length) {
          const current = lines[i];
          const item = LIST_ITEM.exec(current);
          if (item) {
            items2.push({ indent: item[1].replace(/\t/g, "    ").length, ordered: /\d/.test(item[2]), text: item[3] });
            i += 1;
            continue;
          }
          if (current.trim() && /^\s{2,}/.test(current) && items2.length) {
            const last = items2[items2.length - 1];
            last.text += "\n" + current.trim();
            i += 1;
            continue;
          }
          break;
        }
        const stack = [];
        for (const item of items2) {
          while (stack.length && item.indent < stack[stack.length - 1].indent) stack.pop();
          let top = stack[stack.length - 1];
          if (top && item.indent === top.indent && top.ordered !== item.ordered) {
            stack.pop();
            top = stack[stack.length - 1];
          }
          if (!top || item.indent > top.indent) {
            const list4 = node(doc, item.ordered ? "ol" : "ul", `${C5}-list`);
            if (top && top.lastItem) top.lastItem.appendChild(list4);
            else root.appendChild(list4);
            top = { indent: item.indent, ordered: item.ordered, list: list4, lastItem: null };
            stack.push(top);
          }
          const li = node(doc, "li");
          item.text.split("\n").forEach((part, index) => {
            if (index) li.appendChild(node(doc, "br"));
            appendInline(doc, li, part);
          });
          top.list.appendChild(li);
          top.lastItem = li;
        }
        continue;
      }
      const paragraph = node(doc, "p", `${C5}-p`);
      let first = true;
      while (i < lines.length && lines[i].trim() && (first || !isBlockStart(lines[i], lines[i + 1]))) {
        if (!first) paragraph.appendChild(node(doc, "br"));
        appendInline(doc, paragraph, lines[i]);
        first = false;
        i += 1;
      }
      root.appendChild(paragraph);
    }
    return root;
  }

  // src/features/figures/figures.ts
  function sanitizeSvg(raw) {
    let svg = String(raw ?? "").replace(/^﻿/, "").trim();
    svg = svg.replace(/<\?xml[^>]*>\s*/i, "").replace(/<!DOCTYPE[^>]*>\s*/gi, "");
    if (!/^<svg[\s>]/i.test(svg)) throw new Error("不是 SVG（必须以 <svg 开头）");
    if (svg.length > 5e5) throw new Error("SVG 超过 500 KB");
    svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "").replace(/<script[^>]*\/>/gi, "").replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "").replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s(?:xlink:)?href\s*=\s*("|')\s*(?!#|data:image\/(?:png|jpe?g|gif|webp);base64,)[^"']*\1/gi, "").replace(/javascript:/gi, "");
    if (!/\sxmlns\s*=/.test(svg.slice(0, svg.indexOf(">")))) svg = svg.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return svg;
  }
  function svgDataUrl(svg) {
    const bytes = new TextEncoder().encode(svg);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }
  function parseTable(text6) {
    const source = String(text6 ?? "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const firstLine = source.split("\n").find((line2) => line2.trim() && !line2.trim().startsWith("#")) ?? "";
    const delimiter = firstLine.includes("	") ? "	" : firstLine.includes(",") ? "," : firstLine.includes(";") ? ";" : /\s{2,}|\t/.test(firstLine) ? "ws" : ",";
    const rows = [];
    for (const line2 of source.split("\n")) {
      if (!line2.trim() || line2.trim().startsWith("#")) continue;
      if (delimiter === "ws") {
        rows.push(line2.trim().split(/\s+/));
        continue;
      }
      const cells = [];
      let cell = "";
      let quoted = false;
      for (let i = 0; i < line2.length; i += 1) {
        const ch = line2[i];
        if (quoted) {
          if (ch === '"' && line2[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else if (ch === '"') quoted = false;
          else cell += ch;
        } else if (ch === '"') quoted = true;
        else if (ch === delimiter) {
          cells.push(cell.trim());
          cell = "";
        } else cell += ch;
      }
      cells.push(cell.trim());
      rows.push(cells);
    }
    const [header, ...body] = rows;
    if (!header) throw new Error("数据文件是空的");
    return { columns: header, rows: body };
  }
  function column(table, name) {
    const wanted = name.trim().toLowerCase();
    const index = table.columns.findIndex((column2) => column2.trim().toLowerCase() === wanted);
    if (index < 0) throw new Error(`数据里没有列「${name}」；现有列：${table.columns.join("、")}`);
    return index;
  }
  var PALETTE = ["#2f6db5", "#d1495b", "#3c9d5d", "#e09f3e", "#7b5ea7", "#2a9d8f", "#8c564b", "#555555"];
  var escapeXml = (value) => String(value).replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[ch]);
  function ticks(min, max, count2 = 6) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const raw = (max - min) / Math.max(1, count2 - 1);
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((value) => value >= raw) ?? raw;
    const out2 = [];
    for (let value = Math.floor(min / step) * step; value <= max + step * 1e-9; value += step) out2.push(Number(value.toPrecision(12)));
    return out2;
  }
  var format = (value) => {
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e5 || abs < 1e-3)) return value.toExponential(1);
    return String(Number(value.toPrecision(6)));
  };
  function plotSvg(table, spec) {
    const xi = column(table, spec.x);
    const yi = spec.y.map((name) => column(table, name));
    const numericX = spec.type !== "bar" && table.rows.every((row) => row[xi] === void 0 || row[xi] === "" || Number.isFinite(Number(row[xi])));
    const series = yi.map((index, s) => ({
      name: spec.y[s],
      color: PALETTE[s % PALETTE.length],
      points: table.rows.map((row, r) => ({ x: numericX ? Number(row[xi]) : r, label: String(row[xi] ?? ""), y: Number(row[index]) })).filter((point) => Number.isFinite(point.y) && (!numericX || Number.isFinite(point.x)))
    }));
    const all = series.flatMap((item) => item.points);
    if (!all.length) throw new Error("所选列里没有可画的数值");
    const W = 800, H = 500, L = 80, R = 24, T = spec.title ? 56 : 28, B = 72;
    const xs = all.map((point) => point.x);
    const ys = all.map((point) => point.y);
    const xTicks = numericX ? ticks(Math.min(...xs), Math.max(...xs)) : [];
    const yTicks = ticks(Math.min(spec.type === "bar" ? 0 : Infinity, ...ys), Math.max(...ys));
    const x0 = numericX ? xTicks[0] : -0.5;
    const x1 = numericX ? xTicks[xTicks.length - 1] : table.rows.length - 0.5;
    const y0 = yTicks[0], y1 = yTicks[yTicks.length - 1];
    const px = (value) => L + (value - x0) / (x1 - x0 || 1) * (W - L - R);
    const py = (value) => H - B - (value - y0) / (y1 - y0 || 1) * (H - T - B);
    const parts = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="13">`);
    parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
    if (spec.title) parts.push(`<text x="${W / 2}" y="30" text-anchor="middle" font-size="17" font-weight="bold">${escapeXml(spec.title)}</text>`);
    for (const value of yTicks) {
      const y = py(value).toFixed(1);
      parts.push(`<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="#e6e6e6"/>`);
      parts.push(`<text x="${L - 8}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="#333">${format(value)}</text>`);
    }
    if (numericX) {
      for (const value of xTicks) {
        const x = px(value).toFixed(1);
        parts.push(`<line x1="${x}" x2="${x}" y1="${H - B}" y2="${H - B + 5}" stroke="#333"/>`);
        parts.push(`<text x="${x}" y="${H - B + 20}" text-anchor="middle" fill="#333">${format(value)}</text>`);
      }
    } else {
      const every = Math.max(1, Math.ceil(table.rows.length / 12));
      table.rows.forEach((row, r) => {
        if (r % every) return;
        parts.push(`<text x="${px(r).toFixed(1)}" y="${H - B + 20}" text-anchor="middle" fill="#333">${escapeXml(String(row[xi] ?? "").slice(0, 14))}</text>`);
      });
    }
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#333"/>`);
    parts.push(`<line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#333"/>`);
    parts.push(`<text x="${(L + W - R) / 2}" y="${H - 22}" text-anchor="middle" fill="#111">${escapeXml(spec.x_label || spec.x)}</text>`);
    parts.push(`<text transform="translate(22 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" fill="#111">${escapeXml(spec.y_label || (spec.y.length === 1 ? spec.y[0] : ""))}</text>`);
    const band = (W - L - R) / Math.max(1, table.rows.length);
    series.forEach((item, s) => {
      if (spec.type === "line") {
        const d = item.points.map((point, i) => `${i ? "L" : "M"}${px(point.x).toFixed(1)} ${py(point.y).toFixed(1)}`).join(" ");
        parts.push(`<path d="${d}" fill="none" stroke="${item.color}" stroke-width="2"/>`);
      } else if (spec.type === "scatter") {
        for (const point of item.points) parts.push(`<circle cx="${px(point.x).toFixed(1)}" cy="${py(point.y).toFixed(1)}" r="3.5" fill="${item.color}"/>`);
      } else {
        const width = Math.max(2, band * 0.8 / series.length);
        for (const point of item.points) {
          const x = px(point.x) - band * 0.8 / 2 + s * width;
          const top = py(Math.max(point.y, 0)), base = py(Math.min(point.y, 0));
          parts.push(`<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${width.toFixed(1)}" height="${Math.max(0, base - top).toFixed(1)}" fill="${item.color}"/>`);
        }
      }
    });
    if (series.length > 1) {
      series.forEach((item, s) => {
        const y = T + 8 + s * 18;
        parts.push(`<rect x="${W - R - 150}" y="${y - 6}" width="14" height="4" fill="${item.color}"/>`);
        parts.push(`<text x="${W - R - 130}" y="${y}" dominant-baseline="middle" fill="#111">${escapeXml(item.name.slice(0, 20))}</text>`);
      });
    }
    parts.push("</svg>");
    return parts.join("\n");
  }
  async function freePath(exists, wanted) {
    if (!await exists(wanted)) return wanted;
    const dot = wanted.lastIndexOf(".");
    const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
    const ext = dot > 0 ? wanted.slice(dot) : "";
    for (let n = 2; n < 1e3; n += 1) {
      const candidate = `${stem}-${n}${ext}`;
      if (!await exists(candidate)) return candidate;
    }
    throw new Error(`${wanted} 已有太多同名文件`);
  }

  // src/features/chat/session.ts
  var DEFAULT_SEARCH_LIMIT = 200;
  var NO_CONFIRMATIONS = { entries: /* @__PURE__ */ new Map(), events: [] };
  function messageOf2(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function undispatchableReason(state) {
    if (state === "failed") return "本次投递没有生效，请重新发起（会重新生成预览）；不会在原卡上重跑";
    return `这条确认已处于 ${state}，不会再次投递`;
  }
  var ChatSession = class {
    persistence;
    scope;
    now;
    random;
    titleForNewSession;
    /** Whether the caller named the session. When it did not, the first turn
     * names it instead of every new conversation being "未命名课题". */
    titleIsExplicit;
    requestedSessionId;
    forceNew;
    unavailableReason;
    status = "loading";
    view = null;
    messages = [];
    unsaved = [];
    lastError = null;
    constructor(persistence, options) {
      this.persistence = persistence;
      this.scope = options.scope;
      this.now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
      this.random = options.random;
      this.titleForNewSession = options.title?.trim() || "未命名课题";
      this.titleIsExplicit = Boolean(options.title?.trim());
      this.requestedSessionId = options.sessionId ?? null;
      this.forceNew = options.newSession === true;
      this.unavailableReason = options.unavailableReason ?? "对话存储不可用";
    }
    snapshot() {
      return {
        status: this.status,
        sessionId: this.view?.sessionId ?? null,
        scopeKey: this.scope.scopeKey,
        title: this.view?.title ?? this.titleForNewSession,
        archived: this.view?.archived ?? false,
        messages: [...this.messages],
        unsaved: [...this.unsaved],
        confirmations: this.cards(),
        error: this.lastError
      };
    }
    /** The derived confirmation state of the whole session. There is no other
     * source: every card's state is read from here. */
    ledger() {
      return this.view?.confirmations ?? NO_CONFIRMATIONS;
    }
    /** Every card the transcript holds, with its state read from the ledger. */
    cards() {
      return confirmationCards(this.messages, this.ledger());
    }
    /** A dismissed card is hidden only from the inline transcript. Its request,
     * confirmation events and right-rail audit entry remain on disk. */
    isCardHidden(cardId) {
      return Boolean(this.view?.states.some((state) => state.hiddenCardId === cardId));
    }
    /** `confirmationStates[kind]` / `actionsState` / `draftsState` for one
     * message, derived from the events. */
    derivedStates(messageId) {
      return derivedConfirmationStates(this.ledger(), messageId);
    }
    stateOf(messageId, kind) {
      return confirmationStateOf(this.ledger(), messageId, kind);
    }
    /**
     * Find the scope's conversation, or stay empty and ready to create one on
     * the first send.
     *
     * A missing or unreadable vault is a state, not an exception: the page still
     * renders and says why it is empty.
     */
    async load() {
      if (!this.persistence) {
        this.status = "unavailable";
        this.lastError = this.unavailableReason;
        return this.snapshot();
      }
      this.status = "loading";
      try {
        const found = this.requestedSessionId || this.forceNew ? this.requestedSessionId ? { sessionId: this.requestedSessionId } : null : await this.persistence.latestSession(this.scope.scopeKey, { includeArchived: true });
        if (found?.sessionId) this.adopt(await this.persistence.readSession(this.scope.scopeKey, found.sessionId));
        else this.status = "ready";
        this.lastError = null;
      } catch (error) {
        this.status = "unavailable";
        this.lastError = messageOf2(error);
      }
      return this.snapshot();
    }
    adopt(view) {
      this.view = view;
      this.messages = [...view.messages];
    }
    /** Create the session file, if the first send is the first thing that ever
     * happened in this scope. */
    async ensureSession(firstText) {
      if (this.view) return this.view;
      if (!this.persistence) throw new Error(this.unavailableReason);
      const created = await this.persistence.createSession({
        scope: this.scope,
        title: this.titleIsExplicit ? this.titleForNewSession : titleFromText(firstText) || this.titleForNewSession,
        ...this.requestedSessionId ? { sessionId: this.requestedSessionId } : {}
      });
      this.adopt(created.view);
      this.status = "ready";
      return created.view;
    }
    /**
     * Persist a researcher turn, then say whether it may be dispatched.
     *
     * The order is the guarantee. A message that is not on disk is not sent, and
     * it stays in `unsaved` so the researcher can retry or copy it; the
     * alternative — send now, save later — is how a turn ends up in a model's
     * context and nowhere else.
     */
    async send(text6) {
      const message = {
        type: "message",
        messageId: this.nextMessageId(),
        role: "user",
        text: String(text6 ?? ""),
        at: this.now(),
        taskId: null,
        provider: null,
        payload: null
      };
      const written = await this.persist(message, "awaiting-reply");
      if (!written.ok) return { dispatched: false, message, error: written.error };
      return { dispatched: true, message };
    }
    /** Persist an agent (or system / error) turn. Same order, same guarantee: it
     * is on disk before the UI calls it finished. */
    async recordReply(input) {
      const message = {
        type: "message",
        messageId: this.nextMessageId(),
        role: input.role ?? "agent",
        text: String(input.text ?? ""),
        at: this.now(),
        taskId: input.taskId ?? null,
        provider: input.provider ?? null,
        payload: input.payload ?? null
      };
      return this.persist(message, "ready");
    }
    /**
     * Lock a card before it is executed.
     *
     * This is the fix for the double write: the `claimed` event is on disk before
     * the caller gets an operation id back, so a reload in between re-reads the
     * card as claimed and offers it as "being reconciled" rather than as a fresh
     * confirmation.
     *
     * Only a `pending` card can be claimed. In particular a `failed` card cannot
     * be claimed in place (§2.4): a thrown controller means that dispatch's result
     * is unknown or partial, so the request is re-issued by running the flow that
     * produced the card again — a new card — and not by pressing this one twice.
     */
    async claim(messageId, kind) {
      const state = this.stateOf(messageId, kind);
      if (!isDispatchableConfirmation(state)) {
        return { ok: false, error: undispatchableReason(state) };
      }
      const operationId = this.random ? newOperationId(this.random) : newOperationId();
      const event = {
        type: "confirmation",
        eventId: this.nextEventId(),
        messageId,
        kind,
        state: "claimed",
        operationId,
        detail: null,
        at: this.now()
      };
      const written = await this.persistConfirmation(event);
      if (!written.ok) return { ok: false, error: written.error };
      return { ok: true, operationId };
    }
    /** Record what an execution did: `confirmed` on success, `failed` with the
     * reason. Only the operation that was claimed can settle the card. */
    async settle(messageId, kind, operationId, outcome, detail = null) {
      const event = {
        type: "confirmation",
        eventId: this.nextEventId(),
        messageId,
        kind,
        state: outcome,
        operationId,
        detail,
        at: this.now()
      };
      const written = await this.persistConfirmation(event);
      return written.ok ? { ok: true } : { ok: false, error: written.error };
    }
    /**
     * The researcher cancelled a card that has never run.
     *
     * Only a `pending` card can be abandoned. Once a claim is on disk the request
     * may already have gone out, so `abandoned` would assert something nobody can
     * know; a claimed card stays claimed for reconciliation. That refusal is made
     * here, with the reason, rather than left to the file to reject.
     */
    async abandon(messageId, kind) {
      const state = this.stateOf(messageId, kind);
      if (state !== "pending") {
        return {
          ok: false,
          error: state === "claimed" ? "这条确认已提交执行，无法直接放弃；请核对执行结果后标记为已确认或失败" : `这条确认已处于 ${state}，不能再次放弃`
        };
      }
      const event = {
        type: "confirmation",
        eventId: this.nextEventId(),
        messageId,
        kind,
        state: "abandoned",
        operationId: null,
        detail: null,
        at: this.now()
      };
      const written = await this.persistConfirmation(event);
      return written.ok ? { ok: true } : { ok: false, error: written.error };
    }
    /** Re-attempt every in-memory message, oldest first, and keep whatever still
     * fails. In order, because two unsaved turns must not swap places. */
    async retryUnsaved() {
      const pending = [...this.unsaved];
      this.unsaved = [];
      const saved = [];
      const failed = [];
      for (const entry of pending) {
        const written = await this.persist(entry.message, "ready");
        if (written.ok) saved.push(entry.message.messageId);
        else failed.push(entry.message.messageId);
      }
      return { saved, failed };
    }
    async persist(message, successStatus) {
      if (!this.persistence) {
        return this.keepUnsaved(message, this.unavailableReason);
      }
      this.status = "saving";
      try {
        const view = await this.ensureSession(message.role === "user" ? message.text : void 0);
        const { view: next } = await this.persistence.appendMessage(this.scope.scopeKey, view.sessionId, message);
        this.adopt(next);
        this.status = successStatus;
        this.lastError = null;
        return { ok: true, message };
      } catch (error) {
        return this.keepUnsaved(message, messageOf2(error));
      }
    }
    keepUnsaved(message, failure5) {
      this.lastError = failure5;
      this.unsaved = [...this.unsaved, { message, error: failure5 }];
      this.status = "unsaved";
      return { ok: false, message, error: failure5 };
    }
    async persistConfirmation(event) {
      try {
        const view = await this.ensureSession();
        if (!this.persistence) throw new Error(this.unavailableReason);
        const { view: next } = await this.persistence.appendConfirmation(this.scope.scopeKey, view.sessionId, event);
        this.adopt(next);
        this.lastError = null;
        return { ok: true };
      } catch (error) {
        const failure5 = messageOf2(error);
        this.lastError = failure5;
        return { ok: false, error: failure5 };
      }
    }
    /** Archive or restore. The body is never moved or deleted: this appends one
     * state event, exactly as the format requires. */
    async archive(archived = true) {
      return this.setState({ type: "state", at: this.now(), archived });
    }
    async rename(title) {
      const trimmed = String(title ?? "").trim();
      if (!trimmed) return { ok: false, error: "标题不能为空" };
      return this.setState({ type: "state", at: this.now(), title: trimmed });
    }
    async hideCard(cardId) {
      const card = this.cards().find((candidate) => candidate.cardId === cardId);
      if (!card) return { ok: false, error: "找不到这张任务卡" };
      if (card.state === "pending" || card.state === "claimed") {
        return { ok: false, error: "待确认或正在执行的任务卡不能隐藏" };
      }
      if (this.isCardHidden(cardId)) return { ok: true };
      return this.setState({ type: "state", at: this.now(), hiddenCardId: cardId });
    }
    async setState(state) {
      try {
        const view = await this.ensureSession();
        if (!this.persistence) throw new Error(this.unavailableReason);
        const { view: next } = await this.persistence.appendState(this.scope.scopeKey, view.sessionId, state);
        this.adopt(next);
        this.lastError = null;
        return { ok: true };
      } catch (error) {
        const failure5 = messageOf2(error);
        this.lastError = failure5;
        return { ok: false, error: failure5 };
      }
    }
    /** One page of the loaded transcript, for the chat's "load earlier" control. */
    page(options = {}) {
      return pageMessages(this.messages, options);
    }
    /**
     * Search the whole transcript, not the page that happens to be rendered.
     *
     * This is a vault read, so it is available with no Bridge; a search that
     * only looked at the loaded window would answer "not found" for a turn the
     * researcher can see is in the conversation.
     */
    search(query, options = {}) {
      const needle = String(query ?? "").trim().toLowerCase();
      if (!needle) return { query: "", matches: [], total: 0 };
      const all = this.messages.filter((message) => message.text.toLowerCase().includes(needle));
      const limit = Math.max(1, options.limit ?? DEFAULT_SEARCH_LIMIT);
      return { query: String(query).trim(), matches: all.slice(0, limit), total: all.length };
    }
    /** The transcript as plain text, for the copy/export a researcher does when
     * the Bridge is down. Same labels the page shows. */
    exportText() {
      if (!this.messages.length) return "";
      return `${this.messages.map((message) => `${ROLE_LABEL[message.role]}：${message.text}`).join("\n\n")}
`;
    }
    nextMessageId() {
      return this.random ? newMessageId(this.random) : newMessageId();
    }
    nextEventId() {
      return this.random ? newEventId(this.random) : newEventId();
    }
  };
  function titleFromText(text6) {
    if (!text6) return "";
    const line2 = text6.split(/\r?\n/).map((part) => part.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
    const chars = [...line2];
    return chars.length > 24 ? `${chars.slice(0, 24).join("")}…` : line2;
  }

  // src/plugin/views/weaver-product-model.ts
  var RAIL_TABS = Object.freeze([
    ["trace", "确认记录"],
    ["ideas", "Idea"],
    ["history", "历史"]
  ]);
  var PRODUCT_CAPABILITIES = Object.freeze([
    "chat.send",
    "chat.archive",
    "chat.export",
    "card.action",
    "card.draft",
    "runtime.connect",
    "literature.search",
    "literature.download",
    "project.list",
    "project.bind",
    "idea.list",
    "memory.read",
    "history.read",
    "literature.fetchFull",
    "card.runSearch"
  ]);
  var VAULT_ONLY = /* @__PURE__ */ new Set(["chat.archive", "chat.export", "project.bind"]);
  var RUNTIME_BOUND = /* @__PURE__ */ new Set([
    "chat.send",
    "card.action",
    "card.draft",
    "literature.search",
    "literature.download",
    "project.list",
    "idea.list",
    "memory.read",
    "history.read",
    "literature.fetchFull",
    "card.runSearch"
  ]);
  function contextLabel(context) {
    const projectId = context.projectId.trim();
    if (projectId) return { kind: "课题", name: projectId };
    return { kind: "课题流", name: context.flowId.trim() || "未命名" };
  }
  function pathTail(path2, segments = 2) {
    const trimmed = path2.trim();
    if (!trimmed) return "";
    const parts = trimmed.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= segments) return trimmed;
    return `…/${parts.slice(-segments).join("/")}`;
  }
  function capabilityState(capability, bridgeStatus) {
    if (!isProductCapability(capability)) return "unavailable";
    if (VAULT_ONLY.has(capability)) return "ready";
    if (capability === "runtime.connect") return "ready";
    if (RUNTIME_BOUND.has(capability)) return bridgeStatus === "online" ? "ready" : "offline";
    return "unavailable";
  }
  function isProductCapability(value) {
    return PRODUCT_CAPABILITIES.includes(value);
  }
  var READINESS_DETAIL = {
    missing: "未安装或找不到命令",
    broken: "已安装但无法运行"
  };
  function agentOptionsFromResponse(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { agents: [], error: "运行时返回的 Agent 列表不是对象" };
    }
    const list4 = payload.agents;
    if (!Array.isArray(list4)) return { agents: [], error: "运行时返回的 Agent 列表缺少 agents 数组" };
    const agents = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of list4) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return { agents: [], error: "运行时返回的 Agent 条目格式不对" };
      }
      const record2 = entry;
      const id = typeof record2.id === "string" ? record2.id.trim() : "";
      if (!id || id.length > 100) return { agents: [], error: "运行时返回的 Agent 条目缺少 id" };
      if (seen.has(id)) continue;
      seen.add(id);
      if (record2.permission === "full") continue;
      const name = typeof record2.name === "string" && record2.name.trim() ? record2.name.trim() : id;
      const readiness = typeof record2.readiness === "string" ? record2.readiness : "";
      const executionEnabled = record2.executionEnabled !== false;
      const chatAllowed = !(record2.sandboxed === false && record2.lane !== "research");
      const runnable = readiness === "ready" || readiness === "command_detected";
      const ready = runnable && executionEnabled && chatAllowed;
      let detail;
      if (!executionEnabled) detail = EXECUTION_DISABLED_DETAIL;
      else if (!chatAllowed) detail = "未启用只读沙箱，对话车道不接受";
      else if (readiness === "command_detected") detail = "已找到命令，尚未做环境验证";
      else if (!runnable) {
        const problem = typeof record2.problem === "string" && record2.problem.trim() ? record2.problem.trim() : "";
        detail = problem || READINESS_DETAIL[readiness] || "运行时没有报告可用状态";
      }
      const selectable = ready || runnable && chatAllowed;
      agents.push({ id, label: name, ready, ...selectable && !ready ? { selectable: true } : {}, ...detail ? { detail } : {} });
    }
    return { agents, error: null };
  }
  function agentSelectable(agent) {
    return agent.ready || agent.selectable === true;
  }
  var EXECUTION_DISABLED_DETAIL = "运行时未开启执行";
  function agentChoices(agents, currentId) {
    const rank = (agent) => agent.ready ? 0 : agent.selectable ? 1 : 2;
    const choices = agents.map((agent, index) => ({ agent, index })).sort((a, b) => rank(a.agent) - rank(b.agent) || a.index - b.index).map(({ agent }) => agent);
    if (currentId && !choices.some((agent) => agent.id === currentId)) {
      choices.unshift({ id: currentId, label: currentId, ready: false, detail: "运行时没有这个 Agent" });
    }
    return choices;
  }
  var agentKey = (value) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  function resolveAgentId(agents, value) {
    const raw = value.trim();
    if (!raw) return null;
    if (agents.some((agent) => agent.id === raw)) return raw;
    const key = agentKey(raw);
    if (!key) return null;
    const unique = (list4) => {
      const ids = [...new Set(list4.map((agent) => agent.id))];
      return ids.length === 1 ? ids[0] : null;
    };
    const exact = agents.filter((agent) => agentKey(agent.id) === key || agentKey(agent.label) === key);
    if (exact.length) return unique(exact);
    const prefixed = agents.filter((agent) => {
      const id = agentKey(agent.id);
      return id.length >= 2 && key.startsWith(id);
    });
    return unique(prefixed);
  }
  function shortTime(iso) {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return iso;
    const pad = (value) => String(value).padStart(2, "0");
    return `${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }

  // src/plugin/views/weaver-workbench.ts
  var FULL_LANE_MAX_POLLS = 360;
  var LITERATURE_PAYLOAD_KIND = "literature-search";
  function literaturePayload(result, limit = 25) {
    return {
      kind: LITERATURE_PAYLOAD_KIND,
      searchId: result.id,
      query: result.query,
      sources: [...result.sources],
      records: result.records.slice(0, limit).map((record2) => ({ ...record2, abstract: record2.abstract.slice(0, 600) }))
    };
  }
  function isLiteraturePayload(value) {
    if (!value || typeof value !== "object") return false;
    const payload = value;
    return payload.kind === LITERATURE_PAYLOAD_KIND && Array.isArray(payload.records) && typeof payload.searchId === "string";
  }
  function literatureSummaryText(result, limit = 25) {
    const records = result.records.slice(0, limit);
    if (!records.length) return `检索“${result.query}”没有返回记录。可以换关键词或放宽条件后再试。`;
    const lines = records.map((record2, index) => {
      const meta = [record2.year ?? "", record2.venue, record2.doi ? `DOI ${record2.doi}` : ""].filter(Boolean).join(" · ");
      return `${index + 1}. ${record2.title}${meta ? `（${meta}）` : ""}${downloadable(record2) ? " [开放全文]" : ""}`;
    });
    const openCount = records.filter(downloadable).length;
    const head = `检索“${result.query}”：${result.records.length} 条记录${result.sources.length ? `（来源：${result.sources.join("、")}）` : ""}，其中 ${openCount} 篇有开放全文。`;
    const more = result.records.length > records.length ? `
……另有 ${result.records.length - records.length} 条未列出。` : "";
    return `${head}
${lines.join("\n")}${more}`;
  }
  var idle = () => ({ state: "idle", data: null, error: "" });
  var WeaverWorkbench = class {
    deps;
    env;
    projects = idle();
    ideas = idle();
    memory = idle();
    history = idle();
    /** `searchId:openalexId` → what happened to that download. */
    downloads = /* @__PURE__ */ new Map();
    /** `searchId:record` → the 抓取全文 run started from that row. */
    fullRuns = /* @__PURE__ */ new Map();
    rerender = () => {
    };
    constructor(deps, env) {
      this.deps = deps ?? {};
      this.env = env;
    }
    /** Called by the page whenever the workbench's state changes. */
    onChange(listener) {
      this.rerender = listener;
    }
    get canSearch() {
      return Boolean(this.deps.searchLiterature);
    }
    /** Forget what was read: a reconnect, or a new binding, reads again. */
    invalidate() {
      this.projects = idle();
      this.ideas = idle();
      this.memory = idle();
      this.history = idle();
    }
    async search(query) {
      const search = this.deps.searchLiterature;
      if (!search) throw new Error("这个版本没有接入文献检索。");
      return search(query);
    }
    /* ------------------------------------------------------ literature -- */
    /** The card under a persisted search result: one row per record, and a
     * confirmed download for each record that has an open full text. */
    renderLiteratureCard(message) {
      const payload = message.payload;
      if (!isLiteraturePayload(payload)) return null;
      const doc = this.env.doc;
      const card = el2(doc, "div", { cls: "scholarium-weaver__literature", attrs: { "data-role": "literature-card", "data-search": payload.searchId } });
      const head = el2(doc, "div", { cls: "scholarium-weaver__literature-head" });
      head.append(el2(doc, "span", { cls: "scholarium-weaver__kicker", text: `文献检索 · ${payload.records.length} 条` }));
      const open = payload.records.filter(downloadable);
      if (open.length > 1 && this.deps.downloadOpenAccess) {
        const all = el2(doc, "button", { cls: "scholarium-weaver__literature-all", text: `下载全部开放全文（${open.length}）`, attrs: { type: "button", "data-role": "download-all" } });
        all.disabled = this.env.status() !== "online";
        all.addEventListener("click", () => void this.downloadAll(payload, open));
        head.append(all);
      }
      card.append(head);
      for (const record2 of payload.records) card.append(this.recordRow(payload, record2));
      return card;
    }
    recordRow(payload, record2) {
      const doc = this.env.doc;
      const row = el2(doc, "div", { cls: "scholarium-weaver__paper", attrs: { "data-paper": record2.openalexId || record2.doi || record2.title } });
      row.append(el2(doc, "div", { cls: "scholarium-weaver__paper-title", text: record2.title }));
      const authors = record2.authors.length > 3 ? `${record2.authors.slice(0, 3).join(", ")} 等` : record2.authors.join(", ");
      const meta = [authors, record2.year ?? "", record2.venue, record2.citedBy ? `被引 ${record2.citedBy}` : ""].filter(Boolean).join(" · ");
      if (meta) row.append(el2(doc, "div", { cls: "scholarium-weaver__paper-meta", text: meta }));
      const foot = el2(doc, "div", { cls: "scholarium-weaver__paper-foot" });
      if (record2.doi) {
        const link2 = el2(doc, "a", { cls: "scholarium-weaver__paper-doi", text: record2.doi, attrs: { href: `https://doi.org/${record2.doi.replace(/^https?:\/\/doi\.org\//, "")}`, target: "_blank", rel: "noopener" } });
        foot.append(link2);
      }
      foot.append(el2(doc, "span", { cls: `scholarium-weaver__tag${downloadable(record2) ? " is-accent" : ""}`, text: downloadable(record2) ? `开放获取${record2.oaStatus ? ` · ${record2.oaStatus}` : ""}` : "无开放全文" }));
      const key = `${payload.searchId}:${record2.openalexId}`;
      const done = this.downloads.get(key);
      if (done) {
        foot.append(el2(doc, "span", { cls: `scholarium-weaver__paper-status is-${done.state}`, attrs: { "data-download-state": done.state }, text: done.text }));
      }
      if (downloadable(record2) && this.deps.downloadOpenAccess && done?.state !== "saved" && done?.state !== "running") {
        const button2 = el2(doc, "button", { cls: "scholarium-weaver__paper-download", text: "下载开放全文", attrs: { type: "button", "data-role": "download-oa" } });
        button2.disabled = this.env.status() !== "online";
        button2.addEventListener("click", () => void this.downloadOne(payload, record2));
        foot.append(button2);
      }
      const fullKey = this.fullKey(payload, record2);
      const full = this.fullRuns.get(fullKey);
      if (!downloadable(record2) && this.deps.fullLane && (record2.doi || record2.title) && (!full || full.phase === "done" && full.tone !== "ok")) {
        const fetch = el2(doc, "button", { cls: "scholarium-weaver__paper-download", text: full ? "重新抓取全文" : "抓取全文（完整权限）", attrs: { type: "button", "data-role": "fetch-full" } });
        fetch.disabled = this.env.status() !== "online" || Boolean(full && full.phase !== "done");
        fetch.addEventListener("click", () => void this.fetchFullText(payload, record2));
        foot.append(fetch);
      }
      row.append(foot);
      if (full) {
        const status = el2(doc, "div", {
          cls: `scholarium-weaver__paper-status is-${full.phase === "done" ? full.tone : "running"}`,
          attrs: { "data-full-state": full.phase === "done" ? full.tone : full.phase },
          text: full.text
        });
        if (full.phase === "running" && full.runId) {
          const cancel = el2(doc, "button", { cls: "scholarium-weaver__paper-download", text: "取消任务", attrs: { type: "button", "data-role": "cancel-full" } });
          cancel.addEventListener("click", () => void this.cancelFull(full));
          status.append(cancel);
        }
        if (full.landing) {
          status.append(el2(doc, "a", { cls: "scholarium-weaver__paper-doi", text: " 出版方页面", attrs: { href: full.landing, target: "_blank", rel: "noopener" } }));
        }
        row.append(status);
      }
      return row;
    }
    fullKey(payload, record2) {
      return `${payload.searchId}:${record2.openalexId || record2.doi || record2.title}`;
    }
    /**
     * 抓取全文 through the full-permission lane, in the lane's own order:
     * preview (starts nothing) → the researcher reads what will happen and
     * confirms → dispatch with that preview → if the adapter has not passed its
     * capability probe, a second confirmation for the probe, then the same
     * preview again → watch until it ends. The Bridge downloads and verifies the
     * PDF itself; the agent only finds where it is.
     */
    async fetchFullText(payload, record2) {
      const lane = this.deps.fullLane;
      if (!lane) return;
      const key = this.fullKey(payload, record2);
      const prompt = buildFetchPromptFromRecord({ doi: record2.doi, title: record2.title, authors: record2.authors.join(", "), year: record2.year ?? "" });
      const set = (state) => {
        this.fullRuns.set(key, state);
        this.rerender();
      };
      const fail2 = (text6) => set({ phase: "done", runId: "", tone: "error", text: text6, landing: "" });
      let preview;
      try {
        preview = await lane.preview(prompt);
      } catch (error) {
        this.env.notice(messageOf3(error));
        return;
      }
      if (!await this.ask(previewConfirmText(preview, record2.title))) return;
      set({ phase: "preparing", runId: "", tone: "", text: "正在派发…", landing: "" });
      try {
        let sent = await lane.dispatch(preview, prompt);
        if ("probe" in sent) {
          const gate = sent.probe;
          const agree = await this.ask(`${gate.reasonText}（适配器 ${gate.adapter}）。

完整权限车道要求适配器先通过一次能力探测：一次真实的最小 Agent 调用，验证声明的工具确实可用、越界写入确实被拦下，通常 1–2 分钟。

现在探测？探测通过后会用刚才确认过的预览继续派发。`);
          if (!agree) {
            fail2(`没有派发：${gate.adapter} 尚未通过能力探测。`);
            return;
          }
          set({ phase: "probing", runId: "", tone: "", text: `正在探测 ${gate.adapter}（真实 Agent 调用，约 1–2 分钟）…`, landing: "" });
          const probed = await lane.probe(gate.adapter);
          if (!probed.ok) {
            fail2(`能力探测未通过：${probed.detail}。可先检查 CLI 登录与网络后重试。`);
            return;
          }
          sent = await lane.dispatch(preview, prompt);
          if ("probe" in sent) {
            fail2(`探测后仍被拒绝：${sent.probe.reasonText}`);
            return;
          }
        }
        const started = Date.now();
        set({ phase: "running", runId: sent.id, tone: "", text: `已派发（${sent.adapter} · ${sent.enforcement}），Agent 正在定位 PDF…`, landing: "" });
        const interval = Math.max(0, this.deps.pollIntervalMs ?? 2e3);
        for (let attempt = 0; attempt < FULL_LANE_MAX_POLLS; attempt += 1) {
          if (attempt > 0 && interval > 0) await this.wait(interval);
          const read = await lane.status(sent.id);
          if (!read.found) {
            fail2("运行记录已过期（Bridge 重启会清空内存中的记录；审计日志仍在）。");
            return;
          }
          const model = fullTaskCardModel(read.run);
          if (model.tone === "running") {
            set({ phase: "running", runId: sent.id, tone: "", text: `Agent 正在定位 PDF…（已运行 ${Math.round((Date.now() - started) / 1e3)} 秒）`, landing: "" });
            continue;
          }
          const saved = model.download ? `：${String(model.download.path ?? "")}（${model.download.statusText}，${model.download.bytesText}）` : "";
          const violations = model.violations.length ? `；越界改动 ${model.violations.length} 处，请人工核对` : "";
          set({
            phase: "done",
            runId: sent.id,
            tone: model.tone,
            text: `${model.title}${saved}。${model.summary}${violations}`,
            landing: model.landing?.url ?? ""
          });
          return;
        }
        set({ phase: "done", runId: sent.id, tone: "error", text: "等待超过 12 分钟；任务可能仍在后台运行，可在「历史」里查看。", landing: "" });
      } catch (error) {
        fail2(messageOf3(error));
      }
    }
    async cancelFull(run) {
      const lane = this.deps.fullLane;
      if (!lane || !run.runId) return;
      if (!await this.ask("取消这个抓取任务？Bridge 会结束它的进程树；取消前已发生的改动仍会列在结果里。")) return;
      try {
        await lane.cancel(run.runId);
      } catch (error) {
        this.env.notice(messageOf3(error));
      }
    }
    wait(ms) {
      if (this.deps.sleep) return this.deps.sleep(ms);
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    async ask(message) {
      const confirm = this.deps.confirm;
      if (!confirm) {
        this.env.notice("这个宿主没有确认对话框，操作没有执行。");
        return false;
      }
      return Boolean(await confirm(message));
    }
    async downloadOne(payload, record2, confirmed = false) {
      const download = this.deps.downloadOpenAccess;
      if (!download || !downloadable(record2)) return;
      if (!confirmed && !await this.ask(`把《${record2.title}》的开放全文 PDF 下载到工作区的 literature/downloaded-pdfs？`)) return;
      const key = `${payload.searchId}:${record2.openalexId}`;
      this.downloads.set(key, { state: "running", text: "下载中…" });
      this.rerender();
      try {
        const saved = await download(payload.searchId, record2.openalexId);
        this.downloads.set(key, { state: "saved", text: `已保存：${saved.path || "（运行时未报告路径）"}` });
      } catch (error) {
        this.downloads.set(key, { state: "failed", text: messageOf3(error) });
      }
      this.rerender();
    }
    async downloadAll(payload, open) {
      const pending = open.filter((record2) => this.downloads.get(`${payload.searchId}:${record2.openalexId}`)?.state !== "saved");
      if (!pending.length) return;
      if (!await this.ask(`把这次检索里 ${pending.length} 篇开放全文 PDF 下载到工作区？`)) return;
      for (const record2 of pending) await this.downloadOne(payload, record2, true);
    }
    /* -------------------------------------------------------- projects -- */
    /** The registry under 课题信息: every project the vault has, with the bound
     * one marked and the others bindable. */
    renderProjects(container) {
      const doc = this.env.doc;
      if (!this.deps.listProjects) return;
      const section2 = el2(doc, "div", { cls: "scholarium-weaver__registry", attrs: { "data-role": "project-registry" } });
      section2.append(this.sectionHead("课题注册表", () => this.load("projects", true)));
      this.fill(section2, this.projects, "projects", (projects) => {
        if (!projects.length) return [el2(doc, "div", { cls: "scholarium-weaver__empty", text: "Vault 里还没有课题（Research/Projects）。" })];
        const bound = this.env.projectId();
        return projects.map((project) => {
          const row = el2(doc, "div", { cls: `scholarium-weaver__registry-row${project.displayId === bound ? " is-bound" : ""}`, attrs: { "data-project": project.displayId } });
          row.append(
            el2(doc, "div", { cls: "scholarium-weaver__registry-title", text: `${project.displayId} · ${project.title}` }),
            el2(doc, "div", {
              cls: "scholarium-weaver__registry-meta",
              text: [project.stage || project.status, `问题 ${project.counts.questions}`, `假设 ${project.counts.hypotheses}`, `实验 ${project.counts.experiments}`, `证据 ${project.counts.evidence}`].filter(Boolean).join(" · ")
            })
          );
          if (project.unsettledExperiments || project.openQuestions) {
            row.append(el2(doc, "div", { cls: "scholarium-weaver__registry-open", text: `未结实验 ${project.unsettledExperiments} · 开放问题 ${project.openQuestions}` }));
          }
          if (project.displayId === bound) {
            row.append(el2(doc, "span", { cls: "scholarium-weaver__tag is-accent", text: "当前关联" }));
          } else if (this.deps.bindProject) {
            const bind = el2(doc, "button", { cls: "scholarium-weaver__bind", text: "关联此课题", attrs: { type: "button", "data-role": "bind-project", "data-bind": project.displayId } });
            bind.addEventListener("click", () => void this.bind(project));
            row.append(bind);
          }
          return row;
        });
      });
      container.append(section2);
    }
    async bind(project) {
      const bind = this.deps.bindProject;
      if (!bind) return;
      if (!await this.ask(`把织研者关联到课题 ${project.displayId}「${project.title}」？页面会在该课题的范围内重新打开，之前的会话仍保留在原范围。`)) return;
      try {
        await bind(project.displayId);
      } catch (error) {
        this.env.notice(`关联课题失败：${messageOf3(error)}`);
      }
      this.rerender();
    }
    /* ------------------------------------------------------- rail tabs -- */
    renderIdeas(container) {
      const doc = this.env.doc;
      container.append(this.sectionHead("Idea 卡片", () => this.load("ideas", true)));
      this.fill(container, this.ideas, "ideas", (ideas) => {
        if (!ideas.length) return [el2(doc, "div", { cls: "scholarium-weaver__empty", text: "还没有 Idea 卡片（Research/Ideas）。" })];
        return ideas.map((idea) => {
          const row = el2(doc, "div", { cls: "scholarium-weaver__idea", attrs: { "data-idea": idea.displayId || idea.uid } });
          row.append(el2(doc, "div", { cls: "scholarium-weaver__idea-title", text: idea.displayId ? `${idea.displayId} · ${idea.title}` : idea.title }));
          if (idea.summary) row.append(el2(doc, "div", { cls: "scholarium-weaver__idea-summary", text: idea.summary }));
          const meta = [idea.status, idea.promotedTo ? `已提升为 ${idea.promotedTo}` : "", idea.updatedAt ? shortTime(idea.updatedAt) : ""].filter(Boolean).join(" · ");
          if (meta) row.append(el2(doc, "div", { cls: "scholarium-weaver__idea-meta", text: meta }));
          return row;
        });
      });
    }
    renderMemory(container) {
      const doc = this.env.doc;
      container.append(this.sectionHead("长期记忆", () => this.load("memory", true)));
      this.fill(container, this.memory, "memory", (files) => {
        const names = Object.keys(files).sort();
        if (!names.length) return [el2(doc, "div", { cls: "scholarium-weaver__empty", text: "还没有长期记忆文件（.scholarium/agent）。" })];
        return names.map((name) => {
          const text6 = files[name] ?? "";
          const pending = (text6.match(/\[状态[:：]\s*待确认\s*\]/g) ?? []).length;
          const row = el2(doc, "details", { cls: "scholarium-weaver__memory", attrs: { "data-memory": name } });
          row.append(
            el2(doc, "summary", { cls: "scholarium-weaver__memory-name", text: `${name}${pending ? ` · 待确认 ${pending}` : ""}` }),
            el2(doc, "pre", { cls: "scholarium-weaver__memory-body", text: text6.trim() || "（空）" })
          );
          return row;
        });
      });
    }
    renderHistory(container) {
      const doc = this.env.doc;
      container.append(this.sectionHead("运行历史", () => this.load("history", true)));
      this.fill(container, this.history, "history", (entries) => {
        if (!entries.length) return [el2(doc, "div", { cls: "scholarium-weaver__empty", text: "运行时还没有检索、Pipeline 或完整任务的记录。" })];
        return entries.slice(0, 60).map((entry) => {
          const row = el2(doc, "div", { cls: `scholarium-weaver__run is-${entry.kind}`, attrs: { "data-run": entry.id, "data-kind": entry.kind } });
          row.append(
            el2(doc, "div", { cls: "scholarium-weaver__run-title", text: entry.title }),
            el2(doc, "div", {
              cls: "scholarium-weaver__run-meta",
              text: [HISTORY_KIND_LABEL[entry.kind], entry.status, entry.detail, entry.at ? shortTime(entry.at) : ""].filter(Boolean).join(" · ")
            })
          );
          if (entry.kind === "pipeline" && this.deps.openHistory) {
            row.setAttribute("role", "button");
            row.setAttribute("tabindex", "0");
            row.setAttribute("title", "在“步骤”中打开，可继续或重新运行");
            const open = () => this.deps.openHistory?.(entry);
            row.addEventListener("click", open);
            row.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") open();
            });
          }
          return row;
        });
      });
    }
    /* --------------------------------------------------------- loading -- */
    sectionHead(title, refresh) {
      const doc = this.env.doc;
      const head = el2(doc, "div", { cls: "scholarium-weaver__section-head" });
      head.append(el2(doc, "span", { cls: "scholarium-weaver__section-title", text: title }));
      const button2 = el2(doc, "button", { cls: "scholarium-weaver__refresh", text: "刷新", attrs: { type: "button", "data-role": "rail-refresh" } });
      button2.disabled = this.env.status() !== "online";
      button2.addEventListener("click", refresh);
      head.append(button2);
      return head;
    }
    fill(container, slot, name, draw) {
      const doc = this.env.doc;
      if (this.env.status() !== "online" && slot.state !== "ready") {
        container.append(el2(doc, "div", { cls: "scholarium-weaver__empty", attrs: { "data-rail-offline": name }, text: "需要连接运行时后读取。" }));
        return;
      }
      if (slot.state === "idle") {
        void this.load(name, false);
        container.append(el2(doc, "div", { cls: "scholarium-weaver__empty", text: "读取中…" }));
        return;
      }
      if (slot.state === "loading") {
        container.append(el2(doc, "div", { cls: "scholarium-weaver__empty", text: "读取中…" }));
        return;
      }
      if (slot.state === "error") {
        container.append(el2(doc, "div", { cls: "scholarium-weaver__empty is-error", attrs: { "data-rail-error": name }, text: `读取失败：${slot.error}` }));
        return;
      }
      if (slot.data !== null) for (const node2 of draw(slot.data)) container.append(node2);
    }
    async load(name, force) {
      const reader = this.readerFor(name);
      const slot = this.slot(name);
      if (!reader || this.env.status() !== "online") return;
      if (slot.state === "loading" || !force && slot.state !== "idle") return;
      this.setSlot(name, { state: "loading", data: slot.data, error: "" });
      this.rerender();
      try {
        const data = await reader();
        this.setSlot(name, { state: "ready", data, error: "" });
      } catch (error) {
        this.setSlot(name, { state: "error", data: null, error: messageOf3(error) });
      }
      this.rerender();
    }
    readerFor(name) {
      switch (name) {
        case "projects":
          return this.deps.listProjects ?? null;
        case "ideas":
          return this.deps.listIdeas ?? null;
        case "memory":
          return this.deps.agentMemory ?? null;
        case "history":
          return this.deps.runHistory ?? null;
      }
    }
    slot(name) {
      return this[name];
    }
    setSlot(name, value) {
      this[name] = value;
    }
    /** Which rail tabs have a reader. A tab without one is not drawn. */
    hasTab(tab) {
      if (tab === "ideas") return Boolean(this.deps.listIdeas);
      if (tab === "memory") return Boolean(this.deps.agentMemory);
      return Boolean(this.deps.runHistory);
    }
  };
  function messageOf3(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function el2(doc, tag, options = {}) {
    const node2 = doc.createElement(tag);
    if (options.cls) node2.className = options.cls;
    if (options.text !== void 0) node2.textContent = options.text;
    for (const [name, value] of Object.entries(options.attrs ?? {})) node2.setAttribute(name, value);
    return node2;
  }

  // src/plugin/views/research-weaver-view.ts
  function decodeURIComponentSafe(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  function base64ToBuffer(base64) {
    const binary = atob(base64.replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  var EXPERIMENT_EDIT_ACTIONS = /* @__PURE__ */ new Set(["experiment.transition", "experiment.invalidate_provenance"]);
  var BRIDGE_LABEL = {
    offline: "未连接",
    connecting: "连接中",
    online: "已连接",
    degraded: "连接中断"
  };
  var NATIVE_CARD_KINDS = /* @__PURE__ */ new Set(["action", "draft"]);
  var IMAGE_MARKDOWN = /!\[[^\]]*\]\(/;
  var IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
  var ATTACHMENT_DIR = "Scholarium/Chat/attachments";
  var NATIVE_ORCHESTRATED_RUNS = /* @__PURE__ */ new Set(["pipeline.run", "pipeline.rerun"]);
  var EXECUTION_DISABLED_HINT = "运行时已连接，但执行开关关闭，Agent 暂时都不能执行。请点击 Agent 右侧的“开启执行”；它只会为当前库打开 allowExecution，并自动刷新 Agent 列表。";
  var EXECUTION_DISABLED_FALLBACK_HINT = "运行时已连接，但执行开关关闭，Agent 暂时都不能执行。请在运行时的 bridge.config.json 中设为 allowExecution=true（Scholarium 的在 %LOCALAPPDATA%\\Scholarium\\runtime\\profiles\\<库>\\ 下），然后重新连接。";
  var OFFLINE_HINT = "历史、归档和导出可用；发送与执行需要连接运行时。";
  var DEFAULT_PAGE_SIZE = 50;
  var LONG_MESSAGE_CHARS = 1e3;
  var LONG_MESSAGE_LINES = 12;
  var LONG_MESSAGE_PREVIEW_CHARS = 520;
  var LONG_PASTE_CHARS = 3e3;
  var LONG_PASTE_LINES = 30;
  var INPUT_ATTACHMENT_DIR = "Scholarium/input-attachments";
  function messagePreview(text6) {
    const normalized = String(text6 || "").trim();
    const firstParagraph = normalized.split(/\r?\n\s*\r?\n/).find((part) => part.trim())?.trim() ?? normalized;
    const chars = [...firstParagraph];
    return chars.length > LONG_MESSAGE_PREVIEW_CHARS ? `${chars.slice(0, LONG_MESSAGE_PREVIEW_CHARS).join("")}…` : `${firstParagraph}${firstParagraph.length < normalized.length ? "…" : ""}`;
  }
  var CARD_STATE_LABEL = {
    pending: "待确认",
    claimed: "已领取，等待结算",
    confirmed: "已执行",
    failed: "未生效",
    abandoned: "已放弃"
  };
  var ResearchWeaverView = class {
    host;
    deps;
    pageSize;
    title;
    document;
    /** The most messages the DOM may hold. Four pages: enough to scroll through
     * what was loaded, bounded so a 5,000-message session cannot become 5,000
     * nodes. */
    maxDisplayed;
    session;
    context;
    sessions = [];
    /** Set when the last index read failed. Kept apart from `sessions` so an
     * unreadable index cannot render as "this scope has no conversations". */
    sessionListError = null;
    displayed = [];
    railTab = "trace";
    drawer = null;
    archivedExpanded = false;
    rendered = false;
    unsubscribe = null;
    busy = false;
    /** The turn waiting for its reply: shown as a live "thinking" bubble at the
     * end of the transcript and replaced by the answer when it arrives. */
    pendingTurn = null;
    thinkingEl = null;
    thinkingBodyEl = null;
    /** File-card previews and the researcher's ticks, by card id. */
    filePreviews = /* @__PURE__ */ new Map();
    /** Precise anchor-patch previews and the researcher's per-operation ticks. */
    patchPreviews = /* @__PURE__ */ new Map();
    thinkingTimer = null;
    connecting = false;
    agents = [];
    /** Whether the agent list was read for the current `online` period. Reset
     * when the status leaves `online`, so a reconnect reads it again. */
    agentsLoaded = false;
    agentsLoading = false;
    rootEl = null;
    noticeEl = null;
    contextEl = null;
    scopeCardEl = null;
    leftEl = null;
    centerEl = null;
    rightEl = null;
    sessionsEl = null;
    sessionTitleEl = null;
    sessionMetaEl = null;
    messagesEl = null;
    earlierButton = null;
    composerEl = null;
    composerHintEl = null;
    enableExecutionButton = null;
    enablingExecution = false;
    toolPanelEl = null;
    toolPanelCleanup = null;
    toolButtons = /* @__PURE__ */ new Map();
    railToolCleanup = /* @__PURE__ */ new Map();
    textareaEl = null;
    sendButton = null;
    searchEl = null;
    exportButton = null;
    archiveCurrentButton = null;
    newSessionButton = null;
    agentSelectEl = null;
    agentDotEl = null;
    scopeKindEl = null;
    workspaceEl = null;
    runtimeFooterEl = null;
    crumbScopeEl = null;
    pendingTagEl = null;
    railStateEl = null;
    connectButton = null;
    settingsButton = null;
    mobileLeftButton = null;
    mobileRightButton = null;
    /** The last search the researcher asked for, or null when the page is
     * showing the conversation rather than a result set. */
    lastSearch = null;
    traceEl = null;
    workbench;
    mode = "chat";
    modeButtons = /* @__PURE__ */ new Map();
    railButtons = /* @__PURE__ */ new Map();
    railPanels = /* @__PURE__ */ new Map();
    cardButtons = [];
    /** Long messages start folded. Expansion is a reading preference for the
     * current view and never changes the stored transcript. */
    expandedMessages = /* @__PURE__ */ new Set();
    attachmentCounter = 0;
    /** Failures reported to this view directly (an archive that threw, an
     * unreadable index). Rendered alongside the session's own states, and not
     * cleared by the next render. */
    notices = [];
    constructor(host, deps) {
      this.host = host;
      this.deps = deps;
      this.pageSize = Math.max(1, deps.pageSize ?? DEFAULT_PAGE_SIZE);
      this.maxDisplayed = this.pageSize * 4;
      this.title = deps.title ?? "织研者";
      this.document = host.document ?? host.containerEl.ownerDocument;
      this.context = deps.context ?? {
        projectId: deps.scope.projectId ?? "",
        flowId: deps.scope.topicId,
        agentId: "",
        workspaceRoot: ""
      };
      this.session = new ChatSession(deps.store, {
        scope: deps.scope,
        ...deps.now ? { now: deps.now } : {},
        unavailableReason: deps.store ? "对话存储不可用" : "未找到 Vault，历史对话不可用"
      });
      this.workbench = new WeaverWorkbench(deps.workbench ? {
        ...deps.workbench,
        openHistory: (entry) => {
          if (entry.kind !== "pipeline") return;
          selectPipelineHistory(entry.id);
          this.showRailTab("tool:pipeline-steps");
        }
      } : deps.workbench, {
        doc: this.document,
        status: () => this.bridgeStatus(),
        projectId: () => this.context.projectId,
        notice: (message) => this.showNotice(message)
      });
      this.workbench.onChange(() => {
        this.renderMessages();
        this.renderRightRail();
      });
      this.watchBridge();
    }
    /* ------------------------------------------------------------- shell -- */
    /**
     * The synchronous first frame: the product bar, the three columns, and the
     * empty places the history will be drawn into.
     *
     * It performs no read, no request and no wait. Everything slow happens in
     * `open()`, after this is on screen.
     */
    renderShell() {
      if (this.rendered) return;
      this.rendered = true;
      const doc = this.document;
      this.host.containerEl.replaceChildren();
      const root = el3(doc, "div", { cls: "scholarium-weaver", attrs: { "data-role": "weaver-root", "data-drawer": "" } });
      root.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && this.drawer) this.setDrawer(null);
      });
      root.append(this.buildTopbar(doc));
      this.noticeEl = el3(doc, "div", { cls: "scholarium-weaver__notice", attrs: { "data-role": "notice", "aria-live": "polite" } });
      root.append(this.noticeEl);
      const workspace = el3(doc, "div", { cls: "scholarium-weaver__workspace", attrs: { "data-role": "workspace" } });
      this.leftEl = this.buildLeft(doc);
      this.centerEl = this.buildCenter(doc);
      this.rightEl = this.buildRight(doc);
      const scrim = el3(doc, "div", { cls: "scholarium-weaver__scrim", attrs: { "data-role": "drawer-scrim", "aria-hidden": "true" } });
      scrim.addEventListener("click", () => this.setDrawer(null));
      workspace.append(this.leftEl, this.centerEl, this.rightEl, scrim);
      root.append(workspace);
      this.host.containerEl.append(root);
      this.rootEl = root;
      this.showRailTab(this.railTab);
      this.renderContext();
      this.renderStatus();
    }
    buildTopbar(doc) {
      const topbar = el3(doc, "div", { cls: "scholarium-weaver__topbar", attrs: { "data-role": "topbar" } });
      this.mobileLeftButton = el3(doc, "button", {
        cls: "scholarium-weaver__mobile-toggle is-left",
        text: "会话",
        attrs: { type: "button", "data-role": "toggle-left", "aria-expanded": "false" }
      });
      this.mobileLeftButton.addEventListener("click", () => this.setDrawer(this.drawer === "left" ? null : "left"));
      const brand = el3(doc, "div", { cls: "scholarium-weaver__brand" });
      brand.append(
        el3(doc, "span", { cls: "scholarium-weaver__brand-product", text: "Scholarium" }),
        el3(doc, "span", { cls: "scholarium-weaver__brand-sep", text: "/", attrs: { "aria-hidden": "true" } }),
        el3(doc, "span", { cls: "scholarium-weaver__brand-feature scholarium-weaver__title", text: this.title }),
        el3(doc, "span", { cls: "scholarium-weaver__brand-kicker", text: "RESEARCH WEAVER", attrs: { "aria-hidden": "true" } })
      );
      this.mobileRightButton = el3(doc, "button", {
        cls: "scholarium-weaver__mobile-toggle is-right",
        text: "追踪",
        attrs: { type: "button", "data-role": "toggle-right", "aria-expanded": "false" }
      });
      this.mobileRightButton.addEventListener("click", () => this.setDrawer(this.drawer === "right" ? null : "right"));
      topbar.append(this.mobileLeftButton, brand, this.mobileRightButton);
      return topbar;
    }
    /** The runtime belongs to the conversation it will answer. Keeping its
     * picker above that conversation also leaves Scholarium's own tab bar as the
     * only product-level navigation when embedded. */
    buildAgentPicker(doc) {
      const controls = el3(doc, "div", { cls: "scholarium-weaver__conversation-agent-controls" });
      const agent = el3(doc, "label", { cls: "scholarium-weaver__agent scholarium-weaver__conversation-agent" });
      this.agentDotEl = el3(doc, "span", { cls: "scholarium-weaver__agent-dot", attrs: { "aria-live": "polite" } });
      agent.append(this.agentDotEl, el3(doc, "span", { cls: "scholarium-weaver__agent-label", text: "Agent ·" }));
      this.agentSelectEl = el3(doc, "select", { cls: "scholarium-weaver__agent-select dropdown", attrs: { "data-role": "agent-select", "aria-label": "当前 Agent" } });
      this.agentSelectEl.addEventListener("change", () => void this.onSelectAgent(this.agentSelectEl?.value ?? ""));
      this.agentSelectEl.addEventListener("click", (event) => {
        if (this.bridgeStatus() === "online") return;
        event.preventDefault?.();
        void this.onConnectRuntime();
      });
      agent.append(this.agentSelectEl);
      const runtime = el3(doc, "div", { cls: "scholarium-weaver__runtime-controls scholarium-weaver__conversation-runtime" });
      if (this.deps.connectRuntime) {
        this.connectButton = el3(doc, "button", {
          cls: "scholarium-weaver__connect mod-cta",
          text: "连接运行时",
          attrs: { type: "button", "data-role": "connect-runtime", "aria-label": "连接运行时" }
        });
        this.connectButton.addEventListener("click", () => void this.onConnectRuntime());
        runtime.append(this.connectButton);
      }
      if (this.deps.openSettings) {
        this.settingsButton = el3(doc, "button", {
          cls: "scholarium-weaver__settings",
          text: "设置",
          attrs: { type: "button", "data-role": "open-settings" }
        });
        this.settingsButton.addEventListener("click", () => this.deps.openSettings?.());
        runtime.append(this.settingsButton);
      }
      this.enableExecutionButton = el3(doc, "button", {
        cls: "scholarium-weaver__enable-execution mod-cta",
        text: "开启执行",
        attrs: { type: "button", "data-role": "enable-execution" }
      });
      this.enableExecutionButton.hidden = true;
      this.enableExecutionButton.addEventListener("click", () => void this.onEnableExecution());
      runtime.append(this.enableExecutionButton);
      controls.append(agent, runtime);
      this.renderAgentOptions();
      return controls;
    }
    buildLeft(doc) {
      const left = el3(doc, "aside", { cls: "scholarium-weaver__left", attrs: { "data-role": "left", "aria-label": "课题与会话" } });
      const scroll = el3(doc, "div", { cls: "scholarium-weaver__left-scroll" });
      const scopeSection = el3(doc, "section", { cls: "scholarium-weaver__left-section" });
      this.scopeKindEl = el3(doc, "div", { cls: "scholarium-weaver__kicker", text: "当前课题" });
      this.scopeCardEl = el3(doc, "div", { cls: "scholarium-weaver__scope-card", attrs: { "data-role": "scope-card" } });
      scopeSection.append(this.scopeKindEl, this.scopeCardEl);
      const workspaceSection = el3(doc, "section", { cls: "scholarium-weaver__left-section" });
      this.workspaceEl = el3(doc, "div", { cls: "scholarium-weaver__path-chip", attrs: { "data-role": "workspace-root" } });
      workspaceSection.append(el3(doc, "div", { cls: "scholarium-weaver__kicker", text: "工作区" }), this.workspaceEl);
      const sessionSection = el3(doc, "section", { cls: "scholarium-weaver__left-section is-sessions" });
      this.newSessionButton = el3(doc, "button", {
        cls: "scholarium-weaver__new-session",
        text: "＋ 新建会话",
        attrs: { type: "button", "data-role": "new-session" }
      });
      this.newSessionButton.disabled = !this.deps.store;
      this.newSessionButton.addEventListener("click", () => void this.onNewSession());
      this.sessionsEl = el3(doc, "div", { cls: "scholarium-weaver__sessions", attrs: { "data-role": "sessions" } });
      const storage = el3(doc, "div", {
        cls: "scholarium-weaver__storage",
        attrs: { "data-role": "storage" },
        text: this.deps.store ? "对话保存在 Vault：Scholarium/Chat/v1" : "未找到 Vault：对话无法保存"
      });
      sessionSection.append(this.newSessionButton, this.sessionsEl, storage);
      scroll.append(scopeSection, workspaceSection, sessionSection);
      this.runtimeFooterEl = el3(doc, "footer", { cls: "scholarium-weaver__runtime-footer", attrs: { "data-role": "runtime-footer" } });
      left.append(scroll, this.runtimeFooterEl);
      return left;
    }
    buildCenter(doc) {
      const center = el3(doc, "main", { cls: "scholarium-weaver__center scholarium-weaver__conversation", attrs: { "data-role": "center" } });
      const header = el3(doc, "div", { cls: "scholarium-weaver__conversation-header" });
      const heading = el3(doc, "div", { cls: "scholarium-weaver__conversation-heading" });
      const crumbs = el3(doc, "nav", { cls: "scholarium-weaver__crumbs", attrs: { "aria-label": "当前位置" } });
      this.crumbScopeEl = el3(doc, "span", { cls: "scholarium-weaver__crumb" });
      this.sessionTitleEl = el3(doc, "span", { cls: "scholarium-weaver__crumb is-current scholarium-weaver__conversation-title", text: "课题对话", attrs: { "data-role": "session-title" } });
      crumbs.append(
        el3(doc, "span", { cls: "scholarium-weaver__crumb is-root", text: "课题对话" }),
        el3(doc, "span", { cls: "scholarium-weaver__crumb-sep", text: "›", attrs: { "aria-hidden": "true" } }),
        this.crumbScopeEl,
        el3(doc, "span", { cls: "scholarium-weaver__crumb-sep", text: "›", attrs: { "aria-hidden": "true" } }),
        this.sessionTitleEl
      );
      this.sessionMetaEl = el3(doc, "div", { cls: "scholarium-weaver__conversation-meta", attrs: { "data-role": "session-meta" } });
      heading.append(crumbs, this.sessionMetaEl);
      const tools = el3(doc, "div", { cls: "scholarium-weaver__conversation-tools scholarium-weaver__tools" });
      this.searchEl = el3(doc, "input", { cls: "scholarium-weaver__search", attrs: { type: "search", placeholder: "搜索本会话", "aria-label": "搜索本会话", "data-role": "search" } });
      this.searchEl.addEventListener("input", () => this.onSearch(this.searchEl?.value ?? ""));
      this.exportButton = el3(doc, "button", { cls: "scholarium-weaver__export", text: "复制全部", attrs: { type: "button", "data-role": "export", title: "把本会话复制为纯文本" } });
      this.exportButton.addEventListener("click", () => void this.onExport());
      this.archiveCurrentButton = el3(doc, "button", { cls: "scholarium-weaver__archive-current", text: "归档", attrs: { type: "button", "data-role": "archive-current" } });
      this.archiveCurrentButton.addEventListener("click", () => void this.onArchiveCurrent());
      this.pendingTagEl = el3(doc, "span", { cls: "scholarium-weaver__tag", attrs: { "data-role": "pending-count" } });
      tools.append(this.searchEl, this.exportButton, this.archiveCurrentButton, this.pendingTagEl);
      header.append(heading, this.buildAgentPicker(doc), tools);
      const history = el3(doc, "div", { cls: "scholarium-weaver__history", attrs: { "data-role": "history" } });
      this.messagesEl = el3(doc, "div", { cls: "scholarium-weaver__messages", attrs: { "data-role": "messages", "aria-live": "polite" } });
      this.earlierButton = el3(doc, "button", { cls: "scholarium-weaver__earlier", text: "加载更早", attrs: { type: "button", "data-role": "earlier" } });
      this.earlierButton.addEventListener("click", () => this.loadEarlier());
      history.append(this.earlierButton, this.messagesEl);
      this.composerEl = el3(doc, "div", { cls: "scholarium-weaver__composer" });
      const inputRow = el3(doc, "div", { cls: "scholarium-weaver__composer-row" });
      this.textareaEl = el3(doc, "textarea", { cls: "scholarium-weaver__input", attrs: { rows: "3", "data-role": "input", placeholder: "向织研者提问，Ctrl+Enter 发送", "aria-label": "消息" } });
      this.textareaEl.addEventListener("keydown", (event) => {
        const key = event;
        if (key.key === "Enter" && (key.ctrlKey || key.metaKey)) {
          key.preventDefault?.();
          void this.onSend();
        }
      });
      this.textareaEl.addEventListener("paste", (event) => this.onComposerPaste(event));
      this.textareaEl.addEventListener("dragover", (event) => {
        const drag = event;
        if ([...drag.dataTransfer?.items ?? []].some((item) => item.type.startsWith("image/"))) drag.preventDefault?.();
      });
      this.textareaEl.addEventListener("drop", (event) => {
        const drag = event;
        const images = [...drag.dataTransfer?.files ?? []].filter((file) => file.type.startsWith("image/"));
        if (!images.length) return;
        drag.preventDefault?.();
        void this.attachImages(images);
      });
      this.sendButton = el3(doc, "button", { cls: "scholarium-weaver__send mod-cta", text: "发送", attrs: { type: "button", "data-role": "send" } });
      this.sendButton.addEventListener("click", () => {
        if (this.pendingTurn && this.deps.cancelAgentTurn) void this.onStopTurn();
        else void this.onSend();
      });
      inputRow.append(this.textareaEl, this.sendButton);
      this.composerHintEl = el3(doc, "div", { cls: "scholarium-weaver__composer-hint", attrs: { "data-role": "composer-hint" } });
      if (this.workbench.canSearch) {
        const modes = el3(doc, "div", { cls: "scholarium-weaver__modes", attrs: { role: "tablist", "data-role": "composer-modes" } });
        for (const [mode, label] of [["chat", "对话"], ["literature", "检索开放文献"]]) {
          const button2 = el3(doc, "button", { cls: "scholarium-weaver__mode", text: label, attrs: { type: "button", role: "tab", "data-mode": mode } });
          button2.addEventListener("click", () => this.setMode(mode));
          this.modeButtons.set(mode, button2);
          modes.append(button2);
        }
        this.composerEl.append(modes);
      }
      this.composerEl.append(inputRow, this.composerHintEl);
      this.setMode(this.mode);
      center.append(header, history, this.composerEl);
      return center;
    }
    buildRight(doc) {
      const right = el3(doc, "aside", { cls: "scholarium-weaver__right", attrs: { "data-role": "right", "aria-label": "研究工具与确认记录" } });
      const railHead = el3(doc, "div", { cls: "scholarium-weaver__rail-head" });
      this.railStateEl = el3(doc, "span", { cls: "scholarium-weaver__tag", attrs: { "data-role": "rail-state" } });
      railHead.append(el3(doc, "span", { cls: "scholarium-weaver__rail-title", text: "工具与运行" }), this.railStateEl);
      right.append(railHead);
      const actionTools = this.tools().filter((tool) => tool.placement === "action");
      if (actionTools.length) {
        const dock = el3(doc, "section", { cls: "scholarium-weaver__tool-dock", attrs: { "data-role": "tool-dock" } });
        dock.append(el3(doc, "div", { cls: "scholarium-weaver__tool-dock-title", text: "研究工具" }));
        const row = el3(doc, "div", { cls: "scholarium-weaver__tool-row", attrs: { "data-role": "tool-row" } });
        for (const tool of actionTools) {
          const button2 = el3(doc, "button", {
            cls: "scholarium-weaver__tool-launch",
            text: tool.label,
            attrs: { type: "button", "data-tool": tool.id, ...tool.title ? { title: tool.title } : {} }
          });
          button2.addEventListener("click", () => {
            if (tool.opensRailTool) {
              const tab = `tool:${tool.opensRailTool}`;
              if (this.railPanels.has(tab)) {
                this.showRailTab(tab);
                return;
              }
            }
            this.openTool(tool);
          });
          this.toolButtons.set(tool.id, button2);
          row.append(button2);
        }
        dock.append(row);
        right.append(dock);
      }
      this.toolPanelEl = el3(doc, "section", { cls: "scholarium-weaver__tool-panel", attrs: { "data-role": "tool-panel", "aria-live": "polite" } });
      this.toolPanelEl.hidden = true;
      right.append(this.toolPanelEl);
      const tabs = el3(doc, "div", { cls: "scholarium-weaver__rail-tabs", attrs: { role: "tablist" } });
      for (const [tab, label] of RAIL_TABS) {
        if ((tab === "ideas" || tab === "history") && !this.workbench.hasTab(tab)) continue;
        if (tab === "ideas" && this.tools().some((tool) => tool.id === "idea-library")) continue;
        const button2 = el3(doc, "button", {
          cls: `scholarium-weaver__rail-tab is-${tab}`,
          text: label,
          attrs: { type: "button", role: "tab", "data-rail-tab": tab }
        });
        button2.addEventListener("click", () => this.showRailTab(tab));
        this.railButtons.set(tab, button2);
        tabs.append(button2);
      }
      this.traceEl = el3(doc, "div", { cls: "scholarium-weaver__rail-panel scholarium-weaver__trace", attrs: { "data-role": "trace", "data-rail-panel": "trace", role: "tabpanel" } });
      this.railPanels.set("trace", this.traceEl);
      right.append(tabs, this.traceEl);
      for (const tab of ["ideas", "history"]) {
        if (!this.railButtons.has(tab)) continue;
        const panel = el3(doc, "div", { cls: `scholarium-weaver__rail-panel scholarium-weaver__${tab}`, attrs: { "data-role": `rail-${tab}`, "data-rail-panel": tab, role: "tabpanel" } });
        this.railPanels.set(tab, panel);
        right.append(panel);
      }
      for (const tool of this.tools().filter((candidate) => candidate.placement === "rail")) {
        const tab = `tool:${tool.id}`;
        const button2 = el3(doc, "button", {
          cls: `scholarium-weaver__rail-tab is-${tab}`,
          text: tool.label,
          attrs: { type: "button", role: "tab", "data-rail-tab": tab, ...tool.title ? { title: tool.title } : {} }
        });
        button2.addEventListener("click", () => this.showRailTab(tab));
        this.railButtons.set(tab, button2);
        tabs.append(button2);
        const panel = el3(doc, "div", { cls: "scholarium-weaver__rail-panel scholarium-weaver__tool-rail", attrs: { "data-role": `rail-tool-${tool.id}`, "data-rail-panel": tab, role: "tabpanel" } });
        panel.hidden = true;
        this.railPanels.set(tab, panel);
        right.append(panel);
      }
      return right;
    }
    /**
     * The first screen: the scope's index, then the newest page of the
     * conversation it points at.
     *
     * The shell is drawn before the first read, so a slow vault shows a page
     * that is filling in rather than an empty window. The agent list is not
     * asked for here: it waits for the status to become `online`.
     */
    async open() {
      this.renderShell();
      await this.session.load();
      await this.refreshSessions();
      this.resetWindow();
      this.renderAll();
      this.scrollToBottom();
      this.deps.connectBridge?.();
      if (this.bridgeStatus() === "online") void this.refreshAgents();
      return this.snapshot();
    }
    /** Scholarium's research browser calls this after a verified PDF/WebClip is
     * saved. It updates the v3 checkpoint directly; no iframe/postMessage bridge
     * is involved. */
    async acceptManualCapture(artifact) {
      const result = await acceptManualPipelineCapture(this.toolContext(), artifact);
      selectPipelineHistory(result.runId);
      this.showNotice(
        `已归入 Pipeline：PDF ${result.pdfCount} 篇，网页全文 ${result.webclipCount} 篇；继续运行将从证据卡步骤开始。`,
        "info"
      );
      this.renderAll();
      return result;
    }
    destroy() {
      if (this.thinkingTimer) clearInterval(this.thinkingTimer);
      this.thinkingTimer = null;
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.closeTool();
      for (const cleanup of this.railToolCleanup.values()) {
        try {
          cleanup();
        } catch {
        }
      }
      this.railToolCleanup.clear();
      this.toolButtons.clear();
      this.cardButtons = [];
      this.railButtons.clear();
      this.railPanels.clear();
      this.agents = [];
      this.rendered = false;
      this.rootEl?.remove();
      this.rootEl = null;
    }
    snapshot() {
      const state = this.session.snapshot();
      return {
        railTab: this.railTab,
        tab: this.railTab,
        context: this.context,
        selectedAgentId: this.context.agentId,
        agents: [...this.agents],
        drawer: this.drawer,
        bridgeStatus: this.bridgeStatus(),
        status: state.status,
        sessionId: state.sessionId,
        title: state.title,
        archived: state.archived,
        sessions: [...this.sessions],
        messages: [...this.displayed],
        hasMore: this.messagesBeforeWindow() > 0,
        confirmations: state.confirmations,
        unsaved: state.unsaved.map((entry) => entry.message.text),
        error: state.error,
        historyAvailable: state.status !== "unavailable",
        search: this.lastSearch
      };
    }
    /**
     * The settings changed while this view is open.
     *
     * The agent is a dispatch parameter, so it changes in place. The scope is
     * not: a conversation on screen belongs to the scope it was opened with, and
     * switching it underneath would write the next turn into another project's
     * folder. So a scope change is a notice asking for a reopen.
     */
    applyContext(next) {
      const scopeChanged = next.projectId !== this.context.projectId || next.flowId !== this.context.flowId || next.workspaceRoot !== this.context.workspaceRoot;
      this.context = { ...this.context, agentId: next.agentId };
      this.renderStatus();
      if (scopeChanged) this.showNotice("课题、课题流或工作区已修改：重新打开织研者后切换到新范围。当前页面仍写入原范围。");
    }
    /** How many messages exist before the window's first one. This, not the
     * window's size, is what "加载更早" is gated on. */
    messagesBeforeWindow() {
      const first = this.displayed[0];
      if (!first) return 0;
      return this.session.snapshot().messages.findIndex((message) => message.messageId === first.messageId);
    }
    /* ------------------------------------------------------------ bridge -- */
    watchBridge() {
      const bridge = this.deps.bridge;
      if (!bridge) return;
      this.unsubscribe = bridge.onStatus((status) => {
        if (status !== "online") {
          this.agentsLoaded = false;
          this.workbench.invalidate();
        }
        this.renderStatus();
        this.renderNotice();
        this.renderRightRail();
        this.renderMessages();
        if (status === "online") void this.refreshAgents();
      });
    }
    bridgeStatus() {
      return this.deps.bridge?.status ?? "offline";
    }
    /** An online Bridge may still refuse execution, or a saved agent may no
     * longer exist there. Do not persist a researcher turn that cannot be
     * dispatched; the picker explains how to resolve either state. */
    agentDispatchIssue() {
      if (!this.deps.getAgents || this.bridgeStatus() !== "online" || !this.agentsLoaded) return null;
      const selected = this.agents.find((agent) => agent.id === this.context.agentId);
      if (!selected) return `当前 Agent “${this.context.agentId || "未配置"}”不在运行时列表中，请在对话上方选择可用 Agent。`;
      if (selected.ready) return null;
      if (selected.detail === EXECUTION_DISABLED_DETAIL) {
        return this.deps.enableExecution ? EXECUTION_DISABLED_HINT : EXECUTION_DISABLED_FALLBACK_HINT;
      }
      return `当前 Agent 不可用（${selected.detail ?? "运行时没有报告可用状态"}），请在对话上方选择可用 Agent。`;
    }
    /** Sending needs a live Bridge, a runnable configured Agent and a stored
     * session. An archived conversation is read-only. */
    canDispatch() {
      const state = this.session.snapshot();
      return capabilityState("chat.send", this.bridgeStatus()) === "ready" && Boolean(this.deps.sendToAgent) && !this.agentDispatchIssue() && !this.busy && state.status !== "unavailable" && !state.archived;
    }
    /** Confirming needs a live Bridge and an executor. The click is what makes
     * this true; nothing here decides on its own.
     *
     * An archived conversation is browsable and not actionable: emptying an
     * archive should not be able to dispatch a write from a page the researcher
     * opened to read. */
    canExecute() {
      return capabilityState("card.action", this.bridgeStatus()) === "ready" && Boolean(this.deps.executeCard) && !this.busy && !this.session.snapshot().archived;
    }
    /** Whether this build has a real path for the card at all. A run card is
     * runnable only for the operations the page itself runs; the rest are shown
     * as not migrated. */
    cardRunnable(card) {
      if (card.kind === "run") {
        if (card.run?.operation === "literature.search") return this.workbench.canSearch;
        return Boolean(card.run && NATIVE_ORCHESTRATED_RUNS.has(card.run.operation) && this.deps.executeRun);
      }
      return NATIVE_CARD_KINDS.has(card.kind);
    }
    canExecuteCard(card) {
      if (!this.cardRunnable(card)) return false;
      if (card.kind === "run") {
        if (card.run?.operation === "literature.search") return this.canSearchNow();
        return capabilityState("card.action", this.bridgeStatus()) === "ready" && Boolean(this.deps.executeRun) && !this.busy && !this.session.snapshot().archived;
      }
      return this.canExecute();
    }
    /**
     * The explicit connect: the only thing on this page that may start a
     * runtime. Its failure is a notice, not a silence, and it never clears the
     * page.
     */
    async onConnectRuntime() {
      const connect = this.deps.connectRuntime;
      if (!connect || this.connecting) return;
      this.connecting = true;
      this.renderStatus();
      try {
        const status = await connect();
        if (status !== "online") this.showNotice(`运行时没有连上（${BRIDGE_LABEL[status]}）；原因见“设置 → 运行时诊断”。`);
        else {
          this.agentsLoaded = false;
        }
      } catch (error) {
        this.showNotice(`连接运行时失败：${messageOf4(error)}`);
      } finally {
        this.connecting = false;
        this.renderStatus();
      }
      if (this.bridgeStatus() === "online") await this.refreshAgents();
    }
    /* ------------------------------------------------------------ agents -- */
    /**
     * Read the agents the runtime reports. Only while `online`, only once per
     * online period, and a failure is a notice that leaves the history alone.
     */
    async refreshAgents() {
      const getAgents = this.deps.getAgents;
      if (!getAgents || this.bridgeStatus() !== "online" || this.agentsLoaded || this.agentsLoading) return;
      this.agentsLoading = true;
      try {
        this.agents = [...await getAgents()];
        this.agentsLoaded = true;
      } catch (error) {
        this.showNotice(`无法读取 Agent 列表：${messageOf4(error)}`);
      } finally {
        this.agentsLoading = false;
      }
      this.renderStatus();
      if (this.agentsLoaded) await this.reconcileAgentId();
    }
    /**
     * A saved agent that is a display name rather than a runtime id ("claude
     * code" for `claude`) is refused by the runtime as unknown. When it names
     * exactly one reported agent, save that id and say so; otherwise leave it,
     * and the composer hint asks for a choice.
     */
    async reconcileAgentId() {
      const saved = this.context.agentId;
      if (!saved || this.agents.some((agent) => agent.id === saved)) return;
      const resolved = resolveAgentId(this.agents, saved);
      if (!resolved || !this.deps.selectAgent) return;
      try {
        await this.deps.selectAgent(resolved);
        this.context = { ...this.context, agentId: resolved };
        this.showNotice(`已把设置里的 Agent “${saved}” 对应为运行时 id “${resolved}”并保存。`, "info");
      } catch (error) {
        this.showNotice(`保存 Agent 失败：${messageOf4(error)}`);
      }
      this.renderStatus();
    }
    /** The researcher asked for the execution switch. The host asks first and
     * writes the runtime's configuration; the agents are then read again, since
     * the runtime reports the switch per agent. */
    async onEnableExecution() {
      const enable = this.deps.enableExecution;
      if (!enable || this.enablingExecution) return;
      this.enablingExecution = true;
      this.renderStatus();
      try {
        await enable();
        this.agentsLoaded = false;
        if (this.deps.connectRuntime) {
          this.connecting = true;
          this.renderStatus();
          try {
            await this.deps.connectRuntime();
          } finally {
            this.connecting = false;
          }
        }
        await this.refreshAgents();
        const stillOff = this.agentDispatchIssue() === EXECUTION_DISABLED_HINT;
        if (stillOff) this.showNotice("配置已写入，但运行时仍报告执行关闭。请点“重新连接”；仍不行时重启 Obsidian。");
        else this.showNotice("已开启执行：Agent 现在可以接收对话。", "info");
      } catch (error) {
        this.showNotice(`没有开启执行：${messageOf4(error)}`);
      } finally {
        this.enablingExecution = false;
      }
      this.renderStatus();
    }
    async onSelectAgent(agentId) {
      const previous = this.context.agentId;
      if (!agentId || agentId === previous) return;
      const select2 = this.deps.selectAgent;
      const option = this.agents.find((agent) => agent.id === agentId);
      if (!select2 || !option || !agentSelectable(option)) {
        this.showNotice(`Agent ${agentId} 当前不可用，没有切换。`);
        this.renderStatus();
        return;
      }
      try {
        await select2(agentId);
        this.context = { ...this.context, agentId };
      } catch (error) {
        this.showNotice(`切换 Agent 失败：${messageOf4(error)}`);
      }
      this.renderStatus();
    }
    renderAgentOptions() {
      const selectEl = this.agentSelectEl;
      if (!selectEl) return;
      const doc = this.document;
      const current = this.context.agentId;
      const status = this.bridgeStatus();
      const choices = this.agentsLoaded ? agentChoices(this.agents, current) : current ? [{ id: current, label: status === "online" ? "正在读取模型…" : "点击选择并连接运行时", ready: false, detail: "运行时未连接" }] : [];
      selectEl.replaceChildren();
      if (!choices.length) {
        const empty = el3(doc, "option", { text: "未配置", attrs: { value: "" } });
        empty.value = "";
        selectEl.append(empty);
      }
      for (const choice of choices) {
        const label = choice.ready || !this.agentsLoaded ? choice.label : choice.detail === EXECUTION_DISABLED_DETAIL ? `${choice.label}（待开启执行）` : `${choice.label}（${choice.detail ?? "不可用"}）`;
        const option = el3(doc, "option", { text: label, attrs: { value: choice.id, "data-agent": choice.id, "data-ready": String(choice.ready) } });
        option.value = choice.id;
        option.disabled = !agentSelectable(choice) && choice.id !== current;
        selectEl.append(option);
      }
      selectEl.value = current;
      selectEl.disabled = status === "online" ? !this.deps.selectAgent || !this.agentsLoaded : !this.deps.connectRuntime || this.connecting;
      selectEl.setAttribute("title", this.agentsLoaded ? "选择运行时报告的对话模型" : "点击连接运行时，连接成功后可选择对话模型");
    }
    /* ------------------------------------------------------------ layout -- */
    showRailTab(tab) {
      if (this.toolPanelEl && !this.toolPanelEl.hidden) this.closeTool();
      this.railTab = tab;
      for (const [name, button2] of this.railButtons) {
        button2.className = `scholarium-weaver__rail-tab is-${name}${name === tab ? " is-active" : ""}`;
        button2.setAttribute("aria-selected", String(name === tab));
      }
      for (const [name, panel] of this.railPanels) panel.hidden = name !== tab;
      if (tab.startsWith("tool:")) this.mountRailTool(tab.slice(5));
      this.renderRightRail();
    }
    /* ------------------------------------------------------------- tools -- */
    /** The registered tools this page offers: none without a runtime side. */
    tools() {
      if (!this.deps.tools) return [];
      return this.deps.tools.registry ?? WEAVER_TOOLS;
    }
    /** What a tool gets: the runtime through the page, never around it. */
    toolContext() {
      const tools = this.deps.tools;
      const confirm = this.deps.workbench?.confirm ?? this.deps.confirmDiscardDraft ?? null;
      return {
        document: this.document,
        request: tools.request,
        online: () => this.bridgeStatus() === "online",
        confirm: async (message) => confirm ? Boolean(await confirm(message)) : false,
        notice: (message, kind) => this.showNotice(message, kind ?? "error"),
        scope: () => tools.scope(),
        askAgent: (prompt, options) => tools.askAgent(prompt, options),
        postToChat: async (text6) => {
          const written = await this.session.recordReply({ role: "agent", text: text6, provider: "weaver-tool" });
          if (!written.ok) {
            this.showNotice(`没能写入对话：${written.error}`);
            return;
          }
          await this.refreshSessions();
          this.syncWindow();
          this.renderAll();
          this.scrollToBottom();
        },
        fillComposer: (text6) => {
          if (this.textareaEl) {
            this.textareaEl.value = text6;
            this.setMode("chat");
            this.textareaEl.focus?.();
          }
        },
        ...tools.publishManualDownloads ? { publishManualDownloads: tools.publishManualDownloads } : {},
        ...tools.openVaultFile ? { openVaultFile: tools.openVaultFile } : {},
        ...tools.imageService ? { imageService: tools.imageService } : {},
        // Pipeline v3 续跑复用下载结果前的文件校验（vault 只读）。
        ...this.deps.store ? { verifyDownloadedFile: (path2) => this.deps.store.verifyDownloadedFile(path2) } : {},
        sleep: (ms) => tools.sleep ? tools.sleep(ms) : new Promise((resolve) => {
          setTimeout(resolve, ms);
        }),
        now: () => this.deps.now ? this.deps.now() : (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    /** Open an action tool in the right rail. The conversation and its composer
     * never move; the same button again closes the tool. */
    openTool(tool) {
      const panel = this.toolPanelEl;
      if (!panel || !this.deps.tools) return;
      const already = panel.getAttribute("data-open-tool");
      this.closeTool();
      if (already === tool.id) return;
      const doc = this.document;
      const head = el3(doc, "div", { cls: "scholarium-weaver__tool-head" });
      head.append(el3(doc, "span", { cls: "scholarium-weaver__tool-title", text: tool.label }));
      const close = el3(doc, "button", { cls: "scholarium-weaver__tool-close", text: "×", attrs: { type: "button", "aria-label": "关闭", "data-role": "tool-close" } });
      close.addEventListener("click", () => this.closeTool());
      head.append(close);
      const body = el3(doc, "div", { cls: "scholarium-weaver__tool-body", attrs: { "data-tool-body": tool.id } });
      panel.replaceChildren(head, body);
      panel.setAttribute("data-open-tool", tool.id);
      panel.hidden = false;
      this.rightEl?.setAttribute("data-tool-open", "true");
      this.toolButtons.get(tool.id)?.setAttribute("aria-pressed", "true");
      try {
        const cleanup = tool.render(body, this.toolContext());
        this.toolPanelCleanup = typeof cleanup === "function" ? cleanup : null;
      } catch (error) {
        body.replaceChildren(el3(doc, "div", { cls: "scholarium-weaver__tool-error", text: `${tool.label} 无法打开：${messageOf4(error)}` }));
      }
    }
    closeTool() {
      const panel = this.toolPanelEl;
      try {
        this.toolPanelCleanup?.();
      } catch {
      }
      this.toolPanelCleanup = null;
      for (const button2 of this.toolButtons.values()) button2.setAttribute("aria-pressed", "false");
      if (!panel) return;
      panel.replaceChildren();
      panel.setAttribute("data-open-tool", "");
      panel.hidden = true;
      this.rightEl?.setAttribute("data-tool-open", "");
    }
    /** Draw a rail tool the first time its tab is shown. */
    mountRailTool(id) {
      if (this.railToolCleanup.has(id)) return;
      const tool = this.tools().find((candidate) => candidate.id === id);
      const panel = this.railPanels.get(`tool:${id}`);
      if (!tool || !panel) return;
      this.railToolCleanup.set(id, () => {
      });
      try {
        const cleanup = tool.render(panel, this.toolContext());
        if (typeof cleanup === "function") this.railToolCleanup.set(id, cleanup);
      } catch (error) {
        panel.replaceChildren(el3(this.document, "div", { cls: "scholarium-weaver__tool-error", text: `${tool.label} 无法打开：${messageOf4(error)}` }));
      }
    }
    setDrawer(drawer) {
      this.drawer = drawer;
      this.rootEl?.setAttribute("data-drawer", drawer ?? "");
      this.mobileLeftButton?.setAttribute("aria-expanded", String(drawer === "left"));
      this.mobileRightButton?.setAttribute("aria-expanded", String(drawer === "right"));
    }
    /* ---------------------------------------------------------- sessions -- */
    async refreshSessions() {
      const store = this.deps.store;
      if (!store) {
        this.sessions = [];
        this.sessionListError = null;
        return;
      }
      try {
        this.sessions = await store.listSessions(this.deps.scope.scopeKey, { includeArchived: true });
        this.sessionListError = null;
      } catch (error) {
        const failure5 = messageOf4(error);
        this.sessions = [];
        this.sessionListError = failure5;
        this.showNotice(`无法读取会话索引：${failure5}`);
      }
    }
    resetWindow() {
      const all = this.session.snapshot().messages;
      this.displayed = all.slice(Math.max(0, all.length - this.pageSize));
    }
    onSearch(query) {
      const result = this.session.search(query);
      this.lastSearch = result.query ? result : null;
      this.renderMessages();
    }
    clearSearch() {
      this.lastSearch = null;
      if (this.searchEl) this.searchEl.value = "";
      this.renderMessages();
    }
    /** Copy the whole transcript as text. A vault read and a clipboard write:
     * available with the Bridge down, like the history it copies. */
    async onExport() {
      const copy = this.deps.copyText;
      if (!copy) return;
      try {
        await copy(this.session.exportText());
      } catch (error) {
        this.showNotice(`复制失败：${messageOf4(error)}`);
      }
    }
    /**
     * One page further back, keeping the message the researcher was looking at
     * where it was: the scroll offset grows by exactly the height that was
     * added above it.
     */
    loadEarlier() {
      const all = this.session.snapshot().messages;
      const first = this.displayed[0];
      if (!first) return;
      const at = all.findIndex((message) => message.messageId === first.messageId);
      if (at <= 0) {
        this.renderMessages();
        return;
      }
      const container = this.messagesEl;
      const beforeHeight = numberOr(container?.scrollHeight, 0);
      const beforeTop = numberOr(container?.scrollTop, 0);
      const from = Math.max(0, at - this.pageSize);
      this.displayed = [...all.slice(from, at), ...this.displayed].slice(-this.maxDisplayed);
      this.renderMessages();
      if (container && typeof container.scrollHeight === "number") {
        container.scrollTop = beforeTop + (container.scrollHeight - beforeHeight);
      }
    }
    scrollToBottom() {
      const container = this.messagesEl;
      if (container && typeof container.scrollHeight === "number") container.scrollTop = container.scrollHeight;
    }
    /**
     * A fresh conversation in the same scope.
     *
     * The file is not created here. `ChatSession` creates it with the first
     * persisted turn, so pressing the button and walking away leaves no empty
     * session behind. A draft in the composer is not thrown away silently: the
     * host is asked, and a host that cannot ask leaves the draft where it is.
     */
    async onNewSession() {
      const store = this.deps.store;
      if (!store || this.busy) return;
      const draft = this.textareaEl?.value ?? "";
      if (draft.trim()) {
        const ask = this.deps.confirmDiscardDraft;
        if (!ask) {
          this.showNotice("输入框里还有未发送的文字：先发送或清空，再新建会话。");
          return;
        }
        let discard = false;
        try {
          discard = await ask("输入框里还有未发送的文字。新建会话会丢弃它，继续吗？");
        } catch {
          discard = false;
        }
        if (!discard) return;
        if (this.textareaEl) this.textareaEl.value = "";
      }
      this.busy = true;
      this.renderStatus();
      try {
        const session = new ChatSession(store, {
          scope: this.deps.scope,
          newSession: true,
          ...this.deps.now ? { now: this.deps.now } : {}
        });
        await session.load();
        this.session = session;
        this.displayed = [];
        this.lastSearch = null;
        if (this.searchEl) this.searchEl.value = "";
      } catch (error) {
        this.showNotice(`新建会话失败：${messageOf4(error)}`);
      } finally {
        this.busy = false;
      }
      await this.refreshSessions();
      this.resetWindow();
      this.renderAll();
      this.setDrawer(null);
      this.textareaEl?.focus?.();
    }
    /* ------------------------------------------------------------- send --- */
    /** A search needs the same things a turn does, except an agent: a live
     * Bridge, a stored session that is not archived, and nothing in flight. */
    canSearchNow() {
      const state = this.session.snapshot();
      return this.workbench.canSearch && capabilityState("literature.search", this.bridgeStatus()) === "ready" && !this.busy && state.status !== "unavailable" && !state.archived;
    }
    setMode(mode) {
      this.mode = mode === "literature" && this.workbench.canSearch ? "literature" : "chat";
      for (const [name, button2] of this.modeButtons) {
        button2.className = `scholarium-weaver__mode${name === this.mode ? " is-active" : ""}`;
        button2.setAttribute("aria-selected", String(name === this.mode));
      }
      if (this.textareaEl) {
        this.textareaEl.setAttribute("placeholder", this.mode === "literature" ? "输入检索主题或 Boolean 检索式，如 (MOF) AND (photocatalytic CO2 reduction)" : "向织研者提问，Ctrl+Enter 发送");
      }
      if (this.sendButton) this.sendButton.textContent = this.mode === "literature" ? "检索" : "发送";
      this.composerEl?.setAttribute("data-mode", this.mode);
      this.renderStatus();
    }
    onComposerPaste(event) {
      if (this.mode !== "chat") return;
      const images = [...event.clipboardData?.files ?? []].filter((file) => file.type.startsWith("image/"));
      if (images.length) {
        event.preventDefault?.();
        void this.attachImages(images);
        return;
      }
      const text6 = event.clipboardData?.getData("text/plain") ?? "";
      const long = text6.length > LONG_PASTE_CHARS || text6.split(/\r?\n/).length > LONG_PASTE_LINES;
      if (!long) return;
      event.preventDefault?.();
      const start = this.textareaEl?.selectionStart ?? this.textareaEl?.value.length ?? 0;
      const end = this.textareaEl?.selectionEnd ?? start;
      void this.handleLongPaste(text6, start, end);
    }
    async handleLongPaste(text6, start, end) {
      const api = this.deps.vaultFiles;
      if (!api) {
        this.insertComposerText(text6, start, end);
        this.showNotice("当前宿主没有 Vault 文件接口，长文本已按原文粘贴。", "info");
        return;
      }
      const ask = this.deps.workbench?.confirm ?? this.deps.confirmDiscardDraft ?? null;
      let asFile = true;
      if (ask) {
        try {
          asFile = Boolean(await ask(`粘贴内容有 ${text6.length} 字。是否保存为 Vault 内的本地 .txt 文件，并在消息中引用？

选择取消会按原文粘贴。`));
        } catch {
          asFile = false;
        }
      }
      if (!asFile) {
        this.insertComposerText(text6, start, end);
        return;
      }
      try {
        const path2 = await this.savePastedText(text6);
        const reference = `
[长文本输入：[[${path2}]]]
请读取这个 Vault 本地文本文件，作为本条消息的完整输入。
`;
        this.insertComposerText(reference, start, end);
        this.showNotice(`长文本已保存到 ${path2}`, "info");
      } catch (error) {
        this.insertComposerText(text6, start, end);
        this.showNotice(`保存长文本文件失败，已按原文粘贴：${messageOf4(error)}`);
      }
    }
    insertComposerText(text6, start, end) {
      const input = this.textareaEl;
      if (!input) return;
      const before = input.value.slice(0, Math.max(0, start));
      const after = input.value.slice(Math.max(start, end));
      input.value = `${before}${text6}${after}`;
      const cursor = before.length + text6.length;
      input.setSelectionRange?.(cursor, cursor);
      input.focus?.();
    }
    async savePastedText(text6) {
      const api = this.deps.vaultFiles;
      if (!api) throw new Error("Vault 文件接口不可用");
      if (!await api.kind("Scholarium")) await api.createFolder("Scholarium");
      if (!await api.kind(INPUT_ATTACHMENT_DIR)) await api.createFolder(INPUT_ATTACHMENT_DIR);
      const instant = (this.deps.now?.() ?? (/* @__PURE__ */ new Date()).toISOString()).replace(/[^0-9]/g, "").slice(0, 14) || "undated";
      let path2 = "";
      do {
        this.attachmentCounter += 1;
        path2 = `${INPUT_ATTACHMENT_DIR}/${instant}-${String(this.attachmentCounter).padStart(2, "0")}.txt`;
      } while (await api.kind(path2));
      await api.create(path2, text6);
      return path2;
    }
    /**
     * 检索开放文献: the query is saved as the researcher's turn, the search runs
     * on the Bridge, and the result is saved as the reply — records in its
     * payload, a readable list in its text — so the agent sees what was found
     * on the next turn and the card survives a reload.
     */
    async onLiteratureSearch(query) {
      if (!this.canSearchNow()) return;
      const knownBefore = this.session.snapshot().sessionId;
      this.busy = true;
      this.renderStatus();
      try {
        const decision = await this.session.send(`检索开放文献：${query}`);
        if (!decision.dispatched) {
          this.renderAll();
          return;
        }
        if (this.textareaEl) this.textareaEl.value = "";
        this.syncWindow();
        if (knownBefore === null) await this.refreshSessions();
        this.renderAll();
        this.scrollToBottom();
        let reply;
        try {
          const result = await this.workbench.search(query);
          reply = {
            role: "agent",
            text: literatureSummaryText(result),
            provider: "literature-search",
            payload: literaturePayload(result)
          };
        } catch (error) {
          reply = { role: "error", text: `文献检索失败：${messageOf4(error)}` };
        }
        await this.session.recordReply(reply);
        await this.refreshSessions();
      } finally {
        this.busy = false;
      }
      this.syncWindow();
      this.renderAll();
      this.scrollToBottom();
    }
    async onSend() {
      const text6 = this.textareaEl?.value ?? "";
      if (this.mode === "literature") {
        if (text6.trim()) await this.onLiteratureSearch(text6.trim());
        return;
      }
      if (!text6.trim() || !this.canDispatch()) return;
      const knownBefore = this.session.snapshot().sessionId;
      this.busy = true;
      this.renderStatus();
      try {
        const decision = await this.session.send(text6);
        if (decision.dispatched) {
          if (this.textareaEl) this.textareaEl.value = "";
          this.syncWindow();
        }
        if (decision.dispatched && knownBefore === null) await this.refreshSessions();
        this.renderAll();
        this.scrollToBottom();
        if (!decision.dispatched) return;
      } finally {
        this.busy = false;
      }
      await this.dispatch();
    }
    async dispatch() {
      const send = this.deps.sendToAgent;
      const sessionId = this.session.snapshot().sessionId;
      const lastUser = [...this.session.snapshot().messages].reverse().find((message) => message.role === "user");
      if (!send || !sessionId || !lastUser) return;
      this.busy = true;
      this.startThinking();
      this.renderStatus();
      try {
        let reply = null;
        try {
          reply = await send(
            { sessionId, message: lastUser, history: this.session.snapshot().messages },
            (progress) => this.updateThinking(progress.phase, progress.steps)
          );
        } catch (error) {
          reply = { role: "error", text: `执行失败：${messageOf4(error)}` };
        }
        if (reply) {
          await this.session.recordReply(reply);
        }
        await this.refreshSessions();
      } finally {
        this.busy = false;
        this.stopThinking();
      }
      this.syncWindow();
      this.renderAll();
      this.scrollToBottom();
    }
    stopping = false;
    /** 「停止」: end the turn in flight. The reply slot is filled by the
     * runtime's own "已停止" note when the wait returns. */
    async onStopTurn(button2) {
      const cancel = this.deps.cancelAgentTurn;
      if (!cancel || !this.pendingTurn || this.stopping) return;
      this.stopping = true;
      if (button2) {
        button2.disabled = true;
        button2.textContent = "正在停止…";
      }
      this.renderStatus();
      try {
        const message = await cancel();
        this.showNotice(message, "info");
      } catch (error) {
        this.showNotice(`停止失败：${messageOf4(error)}`, "error");
        this.stopping = false;
        if (button2) {
          button2.disabled = false;
          button2.textContent = "停止";
        }
      }
    }
    startThinking() {
      this.stopping = false;
      this.pendingTurn = { phase: "context", steps: [], startedAt: Date.now() };
      if (this.thinkingTimer) clearInterval(this.thinkingTimer);
      this.thinkingTimer = setInterval(() => this.paintThinking(), 1e3);
      const ticker = this.thinkingTimer;
      if (typeof ticker?.unref === "function") ticker.unref();
      this.renderMessages();
      this.scrollToBottom();
    }
    updateThinking(phase, steps) {
      if (!this.pendingTurn) return;
      this.pendingTurn.phase = phase;
      if (steps.length) this.pendingTurn.steps = [...steps];
      const list4 = this.messagesEl;
      const nearBottom = list4 ? list4.scrollHeight - list4.scrollTop - list4.clientHeight < 80 : false;
      this.paintThinking();
      if (nearBottom) this.scrollToBottom();
    }
    stopThinking() {
      if (this.thinkingTimer) clearInterval(this.thinkingTimer);
      this.thinkingTimer = null;
      this.pendingTurn = null;
      this.thinkingEl?.remove();
      this.thinkingEl = null;
      this.thinkingBodyEl = null;
    }
    /** Fill the thinking bubble in place (no full transcript re-render, so the
     * page does not flicker while the agent works). */
    paintThinking() {
      const turn = this.pendingTurn;
      const body = this.thinkingBodyEl;
      if (!turn || !body) return;
      const doc = this.document;
      const seconds = Math.max(0, Math.round((Date.now() - turn.startedAt) / 1e3));
      const label = turn.phase === "context" ? "正在准备" : turn.phase === "dispatched" ? "已交给 Agent" : "正在思考";
      const head = el3(doc, "div", { cls: "scholarium-weaver__thinking-head" });
      head.append(
        el3(doc, "span", { cls: "scholarium-weaver__thinking-dots", attrs: { "aria-hidden": "true" } }),
        el3(doc, "span", { text: `${label} · ${seconds} 秒` })
      );
      const steps = turn.steps.slice(-6);
      const list4 = el3(doc, "div", { cls: "scholarium-weaver__thinking-steps" });
      if (turn.steps.length > steps.length) {
        list4.append(el3(doc, "div", { cls: "scholarium-weaver__thinking-more", text: `（前面还有 ${turn.steps.length - steps.length} 步）` }));
      }
      steps.forEach((step, index) => {
        list4.append(el3(doc, "div", {
          cls: `scholarium-weaver__thinking-step${index === steps.length - 1 ? " is-current" : ""}`,
          text: step.length > 240 ? `${step.slice(0, 240)}…` : step
        }));
      });
      body.replaceChildren(head, list4);
    }
    /**
     * One click, in the only order that is safe: claim, then execute, then
     * settle.
     *
     * The claim is on disk before the executor is called at all, so if anything
     * — a reload, a crash, a closed laptop — interrupts the sequence, the card
     * comes back as `claimed` rather than as an untouched confirmation the
     * researcher can click a second time. The operation id travels with the
     * execution so the ledger can be reconciled by hand.
     */
    async onConfirm(card) {
      if (card.kind === "patch") {
        await this.onConfirmPatch(card);
        return;
      }
      if (card.kind === "files") {
        await this.onConfirmFiles(card);
        return;
      }
      if (card.kind === "figure") {
        await this.onConfirmFigure(card);
        return;
      }
      if (card.kind === "run") {
        await this.onConfirmRun(card);
        return;
      }
      const execute = this.deps.executeCard;
      if (!execute || !this.canExecute() || !NATIVE_CARD_KINDS.has(card.kind)) return;
      this.busy = true;
      this.renderStatus();
      let operationId = null;
      try {
        const claim = await this.session.claim(card.messageId, card.kind);
        if (!claim.ok) {
          this.showNotice(`未能确认：${claim.error}`);
          return;
        }
        operationId = claim.operationId;
        const result = await execute(await this.withExperimentUid(card), { operationId });
        await this.session.settle(card.messageId, card.kind, operationId, result.status === "executed" ? "confirmed" : "failed", {
          ...result.detail ? { detail: result.detail } : {},
          ...result.undo ? { undo: result.undo } : {}
        });
      } catch (error) {
        const failure5 = messageOf4(error);
        if (operationId) await this.session.settle(card.messageId, card.kind, operationId, "failed", { error: failure5 });
        else this.showNotice(`未能确认：${failure5}`);
      } finally {
        this.busy = false;
      }
      this.syncWindow();
      this.renderAll();
    }
    /**
     * A run card, in the same claim → run → settle order as every other card.
     * 仅检索文献 runs the page's own search and records the result card as a
     * reply, so a confirmed run leaves the same thing a typed search does.
     */
    async onConfirmRun(card) {
      const run = card.run;
      if (!run || !this.canExecuteCard(card)) return;
      this.busy = true;
      this.renderStatus();
      let operationId = null;
      try {
        const claim = await this.session.claim(card.messageId, card.kind);
        if (!claim.ok) {
          this.showNotice(`未能确认：${claim.error}`);
          return;
        }
        operationId = claim.operationId;
        if (run.operation === "pipeline.rerun") {
          const requestedId = run.run_id && run.run_id !== "latest" ? run.run_id : null;
          selectPipelineHistory(requestedId);
          this.showRailTab("tool:pipeline-steps");
          const loaded = await loadLastRun(this.toolContext(), requestedId);
          if (!loaded.ok || !loaded.run) throw new Error(loaded.ok ? "没有可继续的 Pipeline 历史。" : loaded.error);
          const started = await resumePipeline(this.toolContext(), loaded.run, run.from_step);
          await this.session.settle(card.messageId, card.kind, operationId, started ? "confirmed" : "failed", {
            detail: started ? `已从 ${run.from_step ?? "安全断点"} 建立新的续跑记录。` : "没有启动续跑。"
          });
          return;
        }
        if (run.operation !== "literature.search") {
          const execute = this.deps.executeRun;
          if (!execute) throw new Error("这个版本没有接入该运行操作。");
          const result = await execute(run, { operationId });
          if (result.reply) await this.session.recordReply(result.reply);
          if (result.manualQueue?.length) {
            await this.deps.tools?.publishManualDownloads?.(result.manualQueue, { open: false, append: true });
          }
          await this.session.settle(card.messageId, card.kind, operationId, result.status === "executed" ? "confirmed" : "failed", {
            ...result.detail ? { detail: result.detail } : {}
          });
          return;
        }
        const query = run.topic ?? "";
        let detail;
        try {
          const result = await this.workbench.search(query);
          await this.session.recordReply({
            role: "agent",
            text: literatureSummaryText(result),
            provider: "literature-search",
            payload: literaturePayload(result)
          });
          detail = `检索完成：${result.records.length} 条；实际检索式：${result.query}`;
        } catch (error) {
          await this.session.settle(card.messageId, card.kind, operationId, "failed", { error: messageOf4(error), detail: messageOf4(error) });
          return;
        }
        await this.session.settle(card.messageId, card.kind, operationId, "confirmed", { detail });
      } catch (error) {
        const failure5 = messageOf4(error);
        if (operationId) await this.session.settle(card.messageId, card.kind, operationId, "failed", { error: failure5 });
        else this.showNotice(`未能确认：${failure5}`);
      } finally {
        this.busy = false;
        await this.refreshSessions();
        this.syncWindow();
        this.renderAll();
        this.scrollToBottom();
      }
    }
    /** A settled run card is an audit record and stays immutable. Its action
     * starts a new Pipeline (or child resume record) after a fresh confirmation
     * instead of trying to dispatch the old card twice. */
    async restartRunCard(card) {
      const run = card.run;
      if (!run || this.busy || this.session.snapshot().archived) return;
      if (!this.deps.tools || this.bridgeStatus() !== "online") {
        this.showNotice("请先连接运行时，再重新运行或继续 Pipeline。");
        return;
      }
      this.showRailTab("tool:pipeline-steps");
      if (run.operation === "pipeline.run") {
        const topic = String(run.topic ?? "").trim();
        if (!topic) return this.showNotice("原运行卡片没有研究主题，无法重新运行。");
        await launchPipeline(this.toolContext(), { topic, sources: ["primary", "broad"], limit: 80 });
        return;
      }
      if (run.operation === "pipeline.rerun") {
        const requestedId = run.run_id && run.run_id !== "latest" ? run.run_id : null;
        selectPipelineHistory(requestedId);
        const loaded = await loadLastRun(this.toolContext(), requestedId);
        if (!loaded.ok || !loaded.run) {
          this.showNotice(loaded.ok ? "没有可继续的 Pipeline 历史。" : loaded.error);
          return;
        }
        await resumePipeline(this.toolContext(), loaded.run, run.from_step);
      }
    }
    async onArchiveCurrent() {
      const state = this.session.snapshot();
      if (!state.sessionId) return;
      const summary = this.sessions.find((entry) => entry.sessionId === state.sessionId);
      if (summary) {
        await this.onToggleArchive(summary);
        return;
      }
      const result = await this.session.archive(!state.archived);
      if (!result.ok) this.showNotice(`归档失败：${result.error}`);
      await this.refreshSessions();
      this.renderAll();
    }
    async onToggleArchive(summary) {
      const store = this.deps.store;
      const archived = !summary.archived;
      try {
        if (this.session.snapshot().sessionId === summary.sessionId) {
          const result = await this.session.archive(archived);
          if (!result.ok) throw new Error(result.error);
        } else if (store) {
          await store.appendState(this.deps.scope.scopeKey, summary.sessionId, {
            type: "state",
            at: this.deps.now ? this.deps.now() : (/* @__PURE__ */ new Date()).toISOString(),
            archived
          });
        }
      } catch (error) {
        this.showNotice(`归档失败：${messageOf4(error)}`);
      }
      await this.refreshSessions();
      this.renderAll();
    }
    async onRetry() {
      await this.session.retryUnsaved();
      this.syncWindow();
      this.renderAll();
    }
    /** New messages from the session join the window; the window stays bounded. */
    syncWindow() {
      const all = this.session.snapshot().messages;
      const known = new Set(this.displayed.map((message) => message.messageId));
      const newest = this.displayed.length ? this.displayed[this.displayed.length - 1].at : null;
      for (const message of all) {
        if (known.has(message.messageId)) continue;
        if (newest !== null && message.at < newest) continue;
        this.displayed.push(message);
      }
      if (this.displayed.length > this.maxDisplayed) this.displayed = this.displayed.slice(-this.maxDisplayed);
    }
    /* ---------------------------------------------------------- rendering -- */
    renderAll() {
      this.renderNotice();
      this.renderStatus();
      this.renderContext();
      this.renderSessions();
      this.renderConversationHeader();
      this.renderMessages();
      this.renderRightRail();
    }
    /** What a connection changes: the Agent dot, the connect button, the agent
     * picker, the offline hint, and whether the buttons that need the Bridge are
     * enabled. It never removes content. */
    renderStatus() {
      const status = this.bridgeStatus();
      if (this.agentDotEl) {
        const online = status === "online";
        this.agentDotEl.className = `scholarium-weaver__agent-dot${online ? " is-ready" : ""} is-${status}`;
        this.agentDotEl.setAttribute("data-status", status);
        this.agentDotEl.setAttribute("aria-label", BRIDGE_LABEL[status]);
      }
      if (this.connectButton) {
        const online = status === "online";
        const pending = this.connecting || status === "connecting";
        this.connectButton.textContent = pending ? "连接中…" : online ? "重新连接" : "连接运行时";
        this.connectButton.disabled = pending;
        this.connectButton.hidden = false;
        this.connectButton.setAttribute("title", online ? "重新连接本机运行时并刷新 Agent 列表" : "启动或接入本机运行时");
        this.connectButton.className = `scholarium-weaver__connect${online ? " is-connected" : " mod-cta"}`;
      }
      const state = this.session.snapshot();
      if (this.sendButton) {
        const running = Boolean(this.pendingTurn && this.deps.cancelAgentTurn) && this.mode !== "literature";
        this.sendButton.textContent = running ? this.stopping ? "正在停止…" : "停止" : this.mode === "literature" ? "检索" : "发送";
        this.sendButton.disabled = running ? this.stopping : this.mode === "literature" ? !this.canSearchNow() : !this.canDispatch();
      }
      if (this.textareaEl) this.textareaEl.disabled = state.archived;
      if (this.exportButton) this.exportButton.disabled = capabilityState("chat.export", status) !== "ready" || !this.deps.copyText;
      if (this.archiveCurrentButton) {
        this.archiveCurrentButton.disabled = !this.deps.store || !state.sessionId || this.busy;
        this.archiveCurrentButton.textContent = state.archived ? "恢复" : "归档";
      }
      if (this.newSessionButton) this.newSessionButton.disabled = !this.deps.store || this.busy;
      for (const [button2, card] of this.cardButtons) button2.disabled = !this.canExecuteCard(card);
      const agentIssue = this.agentDispatchIssue();
      if (this.composerHintEl) {
        this.composerHintEl.textContent = state.archived ? "会话已归档，只读；恢复后才能继续发送。" : status === "online" ? this.busy ? "织研者正在处理…" : this.mode === "literature" ? "检索 OpenAlex / PubMed 等多源开放文献；结果保存进本会话，开放全文可逐篇确认下载。" : agentIssue ?? "消息会先保存到 Vault，再发送给 Agent。" : OFFLINE_HINT;
      }
      if (this.enableExecutionButton) {
        const offered = status === "online" && Boolean(this.deps.enableExecution) && agentIssue === EXECUTION_DISABLED_HINT;
        this.enableExecutionButton.hidden = !offered;
        this.enableExecutionButton.disabled = this.enablingExecution;
        this.enableExecutionButton.textContent = this.enablingExecution ? "正在开启…" : "开启执行";
      }
      if (this.composerEl) this.composerEl.setAttribute("data-hint", status === "online" ? "" : OFFLINE_HINT);
      if (this.runtimeFooterEl) {
        const doc = this.document;
        const footer = this.runtimeFooterEl;
        footer.className = `scholarium-weaver__runtime-footer is-${status}`;
        footer.replaceChildren(
          el3(doc, "span", { cls: "scholarium-weaver__runtime-dot", attrs: { "aria-hidden": "true" } })
        );
        const text6 = el3(doc, "div", { cls: "scholarium-weaver__runtime-text" });
        text6.append(
          el3(doc, "span", { cls: "scholarium-weaver__runtime-title", text: `本机运行时${BRIDGE_LABEL[status]}` }),
          el3(doc, "span", {
            cls: "scholarium-weaver__runtime-sub",
            text: status === "online" ? `Agent ${this.context.agentId || "未配置"} · 发送前先写入 Vault` : "历史与归档照常可用",
            ...status === "online" ? {} : { attrs: { "data-role": "bridge-notice" } }
          })
        );
        footer.append(text6);
      }
      this.renderAgentOptions();
    }
    renderContext() {
      const doc = this.document;
      const label = contextLabel(this.context);
      if (this.contextEl) {
        this.contextEl.replaceChildren(
          el3(doc, "span", { cls: "scholarium-weaver__context-kind", text: label.kind }),
          el3(doc, "span", { cls: "scholarium-weaver__context-name", text: label.name, attrs: { title: this.deps.scope.scopeKey } })
        );
      }
      if (this.scopeKindEl) this.scopeKindEl.textContent = "课题与课题流";
      if (this.scopeCardEl) {
        const card = this.scopeCardEl;
        card.replaceChildren();
        const head = el3(doc, "div", { cls: "scholarium-weaver__scope-head" });
        head.append(el3(doc, "span", { cls: "scholarium-weaver__scope-id", text: this.deps.scope.scopeKey }));
        card.append(head);
        if (this.context.projectId.trim()) {
          card.append(el3(doc, "div", { cls: "scholarium-weaver__scope-title", text: `课题：${this.context.projectId.trim()}`, attrs: { "data-role": "scope-project", title: this.deps.scope.scopeKey } }));
          card.append(el3(doc, "div", { cls: "scholarium-weaver__scope-flow", text: `课题流：${this.context.flowId.trim() || "未命名"}`, attrs: { "data-role": "scope-flow" } }));
        } else {
          card.append(el3(doc, "div", { cls: "scholarium-weaver__scope-title", text: `课题流：${this.context.flowId.trim() || "未命名"}`, attrs: { "data-role": "scope-flow" } }));
        }
        const active3 = this.sessions.filter((summary) => !summary.archived).length;
        const archived = this.sessions.length - active3;
        card.append(el3(doc, "div", {
          cls: "scholarium-weaver__scope-meta",
          text: `会话 ${active3}${archived ? ` · 已归档 ${archived}` : ""}`
        }));
      }
      if (this.workspaceEl) {
        const root = this.context.workspaceRoot;
        this.workspaceEl.textContent = root ? pathTail(root, 3) : "Vault 根目录";
        this.workspaceEl.setAttribute("title", root || "未单独配置工作区，Agent 在 Vault 自身路径下工作");
      }
    }
    renderSessions() {
      const doc = this.document;
      const list4 = this.sessionsEl;
      if (!list4) return;
      list4.replaceChildren();
      const state = this.session.snapshot();
      const open = state.sessionId;
      const active3 = this.sessions.filter((summary) => !summary.archived);
      const archived = this.sessions.filter((summary) => summary.archived);
      const activeGroup = el3(doc, "div", { cls: "scholarium-weaver__session-group is-active", attrs: { "data-group": "active" } });
      const activeHead = el3(doc, "div", { cls: "scholarium-weaver__section-title" });
      activeHead.append(
        el3(doc, "span", { text: "历史会话" }),
        el3(doc, "span", { cls: "scholarium-weaver__session-count", text: String(active3.length) })
      );
      activeGroup.append(activeHead);
      if (!open && this.deps.store && state.status !== "unavailable" && this.sessions.length) {
        activeGroup.append(el3(doc, "div", { cls: "scholarium-weaver__session is-open is-draft", text: "新会话 · 发送第一条后保存" }));
      }
      if (!this.sessions.length) {
        const empty = !this.deps.store ? "未找到 Vault，无法读取历史。" : this.sessionListError ? `会话目录读取失败：${this.sessionListError}` : "这个课题还没有对话。";
        activeGroup.append(el3(doc, "div", { cls: "scholarium-weaver__empty", text: empty }));
      }
      for (const summary of active3) activeGroup.append(this.sessionRow(summary, open));
      list4.append(activeGroup);
      if (!archived.length) return;
      const expanded = this.archivedExpanded || archived.some((summary) => summary.sessionId === open);
      const archivedGroup = el3(doc, "div", { cls: "scholarium-weaver__session-group is-archived", attrs: { "data-group": "archived" } });
      const toggle = el3(doc, "button", {
        cls: "scholarium-weaver__section-title scholarium-weaver__group-toggle",
        attrs: { type: "button", "data-role": "archived-toggle", "aria-expanded": String(expanded) }
      });
      toggle.append(
        el3(doc, "span", { text: `${expanded ? "▾" : "▸"} 已归档` }),
        el3(doc, "span", { cls: "scholarium-weaver__session-count", text: String(archived.length) })
      );
      toggle.addEventListener("click", () => {
        this.archivedExpanded = !expanded;
        this.renderSessions();
      });
      const rows = el3(doc, "div", { cls: "scholarium-weaver__session-list" });
      rows.hidden = !expanded;
      for (const summary of archived) rows.append(this.sessionRow(summary, open));
      archivedGroup.append(toggle, rows);
      list4.append(archivedGroup);
    }
    sessionRow(summary, open) {
      const doc = this.document;
      const isOpen = summary.sessionId === open;
      const name = summary.title || "未命名会话";
      const row = el3(doc, "div", {
        cls: `scholarium-weaver__session${isOpen ? " is-open" : ""}${summary.archived ? " is-archived" : ""}`,
        attrs: {
          "data-session": summary.sessionId,
          "data-open": String(isOpen),
          ...summary.archived ? { "data-archived": summary.sessionId } : {}
        }
      });
      const title = el3(doc, "button", {
        cls: "scholarium-weaver__session-title",
        text: name,
        attrs: { type: "button", "data-open-session": summary.sessionId, "aria-current": isOpen ? "true" : "false", title: name }
      });
      title.addEventListener("click", () => void this.onOpenSession(summary));
      const meta = el3(doc, "span", {
        cls: "scholarium-weaver__session-meta",
        text: `${summary.messageCount} 条 · ${shortTime(summary.updatedAt)}${summary.archived ? " · 已归档" : ""}`
      });
      const toggle = el3(doc, "button", {
        cls: "scholarium-weaver__archive scholarium-weaver__session-actions",
        text: summary.archived ? "恢复" : "归档",
        attrs: { type: "button", "data-archive": summary.sessionId, "aria-label": `${summary.archived ? "恢复" : "归档"}：${name}` }
      });
      toggle.addEventListener("click", (event) => {
        event?.stopPropagation?.();
        void this.onToggleArchive(summary);
      });
      row.append(title, meta, toggle);
      return row;
    }
    /**
     * Switch the page to another conversation in the same scope.
     *
     * A vault read from end to end — no Bridge, no request — so an offline page
     * can browse every session it lists rather than only the newest one. The
     * transcript is reloaded through the same paging rules as the first screen,
     * so nothing about the window changes with how the session was reached.
     */
    async onOpenSession(summary) {
      const store = this.deps.store;
      if (!store || this.session.snapshot().sessionId === summary.sessionId) return;
      this.busy = true;
      this.renderStatus();
      try {
        const session = new ChatSession(store, {
          scope: this.deps.scope,
          sessionId: summary.sessionId,
          ...this.deps.now ? { now: this.deps.now } : {}
        });
        await session.load();
        if (session.snapshot().status === "unavailable") throw new Error(session.snapshot().error ?? "会话不可读");
        this.session = session;
        this.lastSearch = null;
        if (this.searchEl) this.searchEl.value = "";
        this.resetWindow();
      } catch (error) {
        this.showNotice(`打开会话失败：${messageOf4(error)}`);
      } finally {
        this.busy = false;
      }
      this.renderAll();
      this.scrollToBottom();
      this.setDrawer(null);
    }
    renderConversationHeader() {
      const state = this.session.snapshot();
      if (this.crumbScopeEl) this.crumbScopeEl.textContent = contextLabel(this.context).name;
      if (this.pendingTagEl) {
        const pending = this.session.cards().filter((card) => card.state === "pending").length;
        this.pendingTagEl.textContent = `待确认 ${pending}`;
        this.pendingTagEl.className = `scholarium-weaver__tag${pending ? " is-accent" : ""}`;
      }
      if (this.sessionTitleEl) {
        this.sessionTitleEl.textContent = state.sessionId ? state.title || "未命名会话" : "新会话";
      }
      if (this.sessionMetaEl) {
        const parts = [
          `课题对话 · ${state.messages.length} 条消息`,
          ...state.archived ? ["已归档，只读"] : [],
          ...state.status === "unavailable" ? ["历史不可用"] : []
        ];
        this.sessionMetaEl.textContent = parts.join(" · ");
      }
    }
    /**
     * Re-render the transcript without moving the researcher's viewport.
     *
     * `replaceChildren()` empties the scroll container, and a browser clamps an
     * empty container's `scrollTop` to 0 — so every checkbox tick, card
     * confirmation or undo used to throw the reader back to the top of the
     * conversation. The scroll offsets of the transcript and of any scrolled
     * ancestor are taken before the rebuild and put back after it. Callers that
     * do want the newest message (a sent turn, a fresh reply) still call
     * `scrollToBottom()` afterwards, which wins.
     */
    renderMessages() {
      const kept = [];
      let node2 = this.messagesEl;
      for (let depth = 0; node2 && depth < 12; depth += 1) {
        const top = node2.scrollTop;
        if (typeof top === "number" && top > 0) kept.push([node2, top]);
        if (node2 === this.host.containerEl) break;
        node2 = node2.parentElement ?? null;
      }
      this.renderMessagesNow();
      for (const [element, top] of kept) element.scrollTop = top;
    }
    renderMessagesNow() {
      const doc = this.document;
      const container = this.messagesEl;
      if (!container) return;
      this.cardButtons = [];
      container.replaceChildren();
      const search = this.lastSearch;
      if (this.earlierButton) this.earlierButton.hidden = search !== null || this.messagesBeforeWindow() === 0;
      const shown = search ? search.matches : this.displayed;
      const cardsByMessage = /* @__PURE__ */ new Map();
      if (!search) {
        for (const card of this.session.cards()) {
          if (this.session.isCardHidden(card.cardId)) continue;
          const cards = cardsByMessage.get(card.messageId) ?? [];
          cards.push(card);
          cardsByMessage.set(card.messageId, cards);
        }
      }
      if (search) {
        const summary = el3(doc, "div", {
          cls: "scholarium-weaver__search-summary",
          attrs: { "data-role": "search-summary" }
        });
        summary.append(el3(doc, "span", {
          text: search.total > shown.length ? `搜索“${search.query}”：${search.total} 条，显示前 ${shown.length} 条` : `搜索“${search.query}”：${search.total} 条`
        }));
        const clear = el3(doc, "button", { cls: "scholarium-weaver__search-clear", text: "清除搜索", attrs: { type: "button", "data-role": "clear-search" } });
        clear.addEventListener("click", () => this.clearSearch());
        summary.append(clear);
        container.append(summary);
      }
      if (!shown.length) {
        const isNewConversation = !search && !this.session.snapshot().sessionId;
        const emptyClass = `scholarium-weaver__empty is-conversation${isNewConversation ? " is-new-session" : ""}`;
        container.append(el3(doc, "div", { cls: emptyClass, text: search ? "没有匹配的消息。" : this.emptyMessage() }));
        return;
      }
      for (const message of shown) {
        const derived = this.session.derivedStates(message.messageId);
        const row = el3(doc, "div", {
          cls: `scholarium-weaver__message is-${message.role}`,
          attrs: {
            "data-message": message.messageId,
            "data-actions-state": derived.actionsState,
            "data-drafts-state": derived.draftsState
          }
        });
        row.append(el3(doc, "div", { cls: "scholarium-weaver__role", text: ROLE_LABEL[message.role] }));
        const body = replyForDisplay(message.text);
        const literature = message.role === "agent" ? this.workbench.renderLiteratureCard(message) : null;
        const shownText = message.role !== "agent" ? message.text : literature ? body.text.split("\n")[0] ?? "" : body.text;
        row.append(this.renderMessageBody(message, shownText, message.role === "agent" && !literature || message.role === "user" && IMAGE_MARKDOWN.test(shownText)));
        if (message.role === "agent" && body.writeClaim) {
          row.append(el3(doc, "div", { cls: "scholarium-weaver__claim", text: "模型称已写入，但本页不据此认定已保存。" }));
        }
        row.append(el3(doc, "div", { cls: "scholarium-weaver__time", text: shortTime(message.at), attrs: { title: message.at } }));
        if (literature) row.append(literature);
        container.append(row);
        for (const card of cardsByMessage.get(message.messageId) ?? []) container.append(this.renderCard(card));
      }
      if (!search) {
        this.appendThinking(container);
      }
    }
    renderMessageBody(message, text6, markdown) {
      const doc = this.document;
      const long = text6.length > LONG_MESSAGE_CHARS || text6.split(/\r?\n/).length > LONG_MESSAGE_LINES;
      const expanded = this.expandedMessages.has(message.messageId);
      const shown = long && !expanded ? messagePreview(text6) : text6;
      const shell = el3(doc, "div", {
        cls: `scholarium-weaver__message-body${long ? " is-long" : ""}${expanded ? " is-expanded" : " is-collapsed"}`,
        attrs: { "data-role": "message-body", "data-message-body": message.messageId }
      });
      if (markdown) {
        const rendered = renderMarkdown(doc, shown, {
          onAnchor: (anchor, event) => {
            if (event?.altKey) this.insertReference(anchor);
            else void this.openAnchor(anchor);
          },
          resolveImage: (src) => this.imageUrl(src),
          onImage: (src) => {
            if (!src.startsWith("data:")) void this.deps.openVaultLink?.(decodeURIComponentSafe(src));
          }
        });
        rendered.className = `${rendered.className} scholarium-weaver__text is-markdown`;
        shell.append(rendered);
      } else {
        shell.append(el3(doc, "div", { cls: "scholarium-weaver__text", text: shown }));
      }
      if (long) {
        const toggle = el3(doc, "button", {
          cls: "scholarium-weaver__message-toggle",
          text: expanded ? "收起" : `展开全文（${text6.length} 字）`,
          attrs: {
            type: "button",
            "data-toggle-message": message.messageId,
            "aria-expanded": String(expanded)
          }
        });
        toggle.addEventListener("click", () => {
          const scrollTop = this.messagesEl?.scrollTop ?? 0;
          if (expanded) this.expandedMessages.delete(message.messageId);
          else this.expandedMessages.add(message.messageId);
          this.renderMessages();
          if (this.messagesEl) this.messagesEl.scrollTop = scrollTop;
        });
        shell.append(toggle);
      }
      return shell;
    }
    appendThinking(container) {
      if (!this.pendingTurn) return;
      const doc = this.document;
      const thinking = el3(doc, "div", {
        cls: "scholarium-weaver__message is-agent is-thinking",
        attrs: { "data-role": "thinking", "aria-live": "polite" }
      });
      const body = el3(doc, "div", { cls: "scholarium-weaver__thinking-body" });
      thinking.append(el3(doc, "div", { cls: "scholarium-weaver__role", text: ROLE_LABEL.agent }), body);
      if (this.deps.cancelAgentTurn) {
        const stop = el3(doc, "button", {
          cls: "scholarium-weaver__thinking-stop",
          text: this.stopping ? "正在停止…" : "停止",
          attrs: { type: "button", "data-role": "stop-turn", title: "终止这一轮：结束 Agent 进程，不执行任何修改" }
        });
        stop.disabled = this.stopping;
        stop.addEventListener("click", () => void this.onStopTurn(stop));
        thinking.append(stop);
      }
      container.append(thinking);
      this.thinkingEl = thinking;
      this.thinkingBodyEl = body;
      this.paintThinking();
    }
    /**
     * A card, with the state it actually has.
     *
     * Only `pending` reaches the button at the bottom — the same rule the model
     * states as `dispatchable`. Every other state returns above with words
     * instead, and there is nothing for a click to reach: not merely a disabled
     * control. `claimed` says the execution is being reconciled and prints the
     * operation id it must be checked against; `failed` says this dispatch did not
     * take effect and asks for the request to be re-issued, because §2.4 does not
     * allow the same card to be sent twice.
     *
     * A kind the native Preview has no dispatch path for is shown and never
     * offered: the card says the capability has not been migrated, and has no
     * button at all.
     */
    renderCardHead(title, card) {
      const doc = this.document;
      const head = el3(doc, "div", { cls: "scholarium-weaver__card-head" });
      const controls = el3(doc, "div", { cls: "scholarium-weaver__card-head-controls" });
      controls.append(el3(doc, "span", {
        cls: `scholarium-weaver__card-state is-${card.state}`,
        text: CARD_STATE_LABEL[card.state] ?? card.state
      }));
      if (["confirmed", "failed", "abandoned"].includes(card.state)) {
        const close = el3(doc, "button", {
          cls: "scholarium-weaver__card-close",
          text: "×",
          attrs: {
            type: "button",
            "data-dismiss-card": card.cardId,
            "aria-label": "关闭这张已结算任务卡",
            title: "关闭卡片；执行记录仍保留在右侧审计中"
          }
        });
        close.addEventListener("click", () => void this.onDismissCard(card));
        controls.append(close);
      }
      head.append(el3(doc, "span", { cls: "scholarium-weaver__card-title", text: title }), controls);
      return head;
    }
    renderCard(card) {
      if (card.kind === "patch") return this.renderPatchCard(card);
      if (card.kind === "files") return this.renderFilesCard(card);
      if (card.kind === "figure") return this.renderFigureCard(card);
      const doc = this.document;
      const node2 = el3(doc, "div", {
        cls: `scholarium-weaver__card is-${card.kind} is-${card.state}`,
        attrs: { "data-card": card.cardId, "data-state": card.state, "data-dispatchable": String(card.dispatchable) }
      });
      const statePrefix = card.state === "pending" ? "待确认" : card.state === "claimed" ? "已提交" : card.state === "confirmed" ? "已执行" : card.state === "failed" ? "运行失败" : "已关闭";
      const heading = card.kind === "action" ? `${statePrefix}的修改请求` : card.kind === "draft" ? `${statePrefix}的新建笔记` : card.kind === "run" && card.run ? `${statePrefix}：${RUN_LABEL[card.run.operation] ?? card.run.operation}` : `${statePrefix}：${card.kind}`;
      node2.append(this.renderCardHead(heading, card));
      const summary = card.kind === "action" ? `${card.action ?? ""}${card.anchor ? `
识别点：${card.anchor}` : ""}${card.reason ? `
理由：${card.reason}` : ""}`.trim() : card.kind === "run" && card.run ? `${runDetail(card.run)}${card.run.reason ? `
理由：${card.run.reason}` : ""}` : `${card.items?.length ?? 0} 个文件：${(card.items ?? []).map((item) => item.path).join("、")}`;
      node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-body", text: summary }));
      const result = card.detail && typeof card.detail.detail === "string" ? card.detail.detail : "";
      const appendRunAgain = (label) => {
        if (card.kind !== "run" || !card.run || !["pipeline.run", "pipeline.rerun"].includes(card.run.operation)) return;
        const actions3 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
        actions3.append(el3(doc, "button", {
          cls: "scholarium-weaver__confirm",
          text: label,
          attrs: { type: "button", "data-restart-run": card.cardId }
        }));
        actions3.children[0]?.addEventListener("click", () => void this.restartRunCard(card));
        node2.append(actions3);
      };
      switch (card.state) {
        case "confirmed": {
          node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-result", text: `已确认并执行：${result}`.trim().replace(/：$/, "") }));
          appendRunAgain(card.run?.operation === "pipeline.rerun" ? "再次从断点继续" : "按原主题重新运行");
          const undo = card.detail && typeof card.detail.undo === "object" && card.detail.undo ? card.detail.undo : null;
          if (undo && this.deps.undoControlAction && !this.undoneCards.has(card.cardId)) {
            const actions3 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
            const button2 = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "撤销这次修改", attrs: { type: "button", "data-undo-action": card.cardId } });
            button2.addEventListener("click", () => void this.onUndoControl(card, undo));
            actions3.append(button2);
            node2.append(actions3);
          }
          return node2;
        }
        case "abandoned":
          node2.className = `${node2.className} is-compact`.trim();
          node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-result", text: "已关闭；已放弃，不会执行。" }));
          appendRunAgain(card.run?.operation === "pipeline.rerun" ? "继续运行" : "重新运行");
          return node2;
        case "claimed":
          node2.append(el3(doc, "div", {
            cls: "scholarium-weaver__card-status is-claimed",
            attrs: { "data-operation": card.operationId ?? "" },
            text: `正在核对执行结果：操作 ${card.operationId ?? "未知"} 已提交。请在 Vault 中核对后再决定标记为已确认或失败；不会自动重跑。`
          }));
          if (card.run?.operation === "pipeline.rerun") appendRunAgain("在步骤中继续");
          return node2;
        case "failed":
          node2.append(el3(doc, "div", {
            cls: "scholarium-weaver__card-status is-failed",
            text: card.kind === "run" && card.run && ["pipeline.run", "pipeline.rerun"].includes(card.run.operation) ? `本次没有生效：${result || "未记录原因"}。下面的按钮会建立一条新的运行记录，不会重放这张旧卡。` : `本次没有生效：${result || "未记录原因"}。请重新发起这项请求；不会重放这张旧卡。`
          }));
          appendRunAgain(card.run?.operation === "pipeline.rerun" ? "从断点继续" : "重新运行");
          return node2;
        default:
          break;
      }
      if (!this.cardRunnable(card)) {
        node2.append(el3(doc, "div", {
          cls: "scholarium-weaver__card-status is-unmigrated",
          attrs: { "data-role": "unmigrated-card" },
          text: "此能力尚未迁移到原生 Preview，本页不会执行它。"
        }));
        return node2;
      }
      if (card.kind === "action" && card.anchor) node2.append(this.renderControlPreview(card));
      const archived = this.session.snapshot().archived;
      node2.append(el3(doc, "div", {
        cls: "scholarium-weaver__card-status",
        text: archived ? "预览：尚未执行（会话已归档，只读；恢复后才能确认）" : "预览：尚未执行"
      }));
      if (archived) return node2;
      const actions2 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
      const confirm = el3(doc, "button", {
        cls: "scholarium-weaver__confirm mod-cta",
        text: card.run?.operation === "pipeline.rerun" ? "确认并继续运行" : card.kind === "run" ? "确认并开始运行" : "确认执行",
        attrs: { type: "button", "data-confirm": card.cardId }
      });
      confirm.disabled = !this.canExecuteCard(card);
      confirm.addEventListener("click", () => void this.onConfirm(card));
      this.cardButtons.push([confirm, card]);
      actions2.append(confirm);
      if (card.state === "pending") {
        const abandon = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "关闭", attrs: { type: "button", "data-abandon": card.cardId, "aria-label": "关闭这条待确认请求" } });
        abandon.addEventListener("click", () => void this.onAbandon(card));
        actions2.append(abandon);
      }
      node2.append(actions2);
      return node2;
    }
    /* ------------------------------------------------------ patch cards --- */
    loadPatchPreview(card) {
      const api = this.deps.vaultFiles;
      if (!api || !card.patch || this.patchPreviews.has(card.cardId)) return;
      const entry = { status: "loading", previews: [], selected: /* @__PURE__ */ new Set(), error: "" };
      this.patchPreviews.set(card.cardId, entry);
      const now = /* @__PURE__ */ new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      void previewPatchOps(api, card.patch.ops, { researcherText: this.researcherTextFor(card.messageId), today }).then((previews) => {
        entry.status = "ready";
        entry.previews = previews;
        entry.selected = new Set(previews.filter((preview) => preview.ok && !preview.declaration).map((preview) => preview.index));
      }, (error) => {
        entry.status = "error";
        entry.error = messageOf4(error);
      }).finally(() => this.renderMessages());
    }
    /**
     * Put a Scholarium address (and optionally the passage it points at) into
     * the composer, so the next turn is about exactly that place. Called by
     * Alt+click on any marked element in Scholarium, by the editor command
     * 「发给织研者」, and by Alt+click on an address in a reply. Nothing is sent.
     */
    insertReference(anchor, quote = "") {
      const input = this.textareaEl;
      if (!input) return;
      const readable = canonicalAnchor(anchor);
      const lines = [readable];
      const passage = String(quote ?? "").trim().slice(0, 2e3);
      if (passage) lines.push(...passage.split(/\r?\n/).map((line2) => `> ${line2}`));
      const current = input.value.replace(/\s+$/, "");
      input.value = `${current}${current ? "\n" : ""}${lines.join("\n")}
`;
      input.focus?.();
      const end = input.value.length;
      try {
        input.setSelectionRange?.(end, end);
      } catch {
      }
      this.showNotice(`已引用 ${readableAnchor(readable)}，补充你的要求后发送。`, "info");
    }
    /** Open the note (and heading) an address points at. */
    async openAnchor(anchor) {
      const api = this.deps.vaultFiles;
      const parsed = parseAnchor(anchor);
      if (!api || !parsed) return;
      try {
        const manifest = await describeAnchor(api, anchor);
        const heading = parsed.headingPath.at(-1) ?? "";
        const open = this.deps.openVaultLink;
        if (open) await open(heading ? `${manifest.path}#${heading}` : manifest.path);
        else if (this.deps.tools?.openVaultFile) await this.deps.tools.openVaultFile(manifest.path);
        else this.showNotice(`${readableAnchor(anchor)} 在 ${manifest.path}`, "info");
      } catch (error) {
        this.showNotice(`打不开 ${readableAnchor(anchor)}：${messageOf4(error)}`, "error");
      }
    }
    /** The researcher's own message that this reply answers (the nearest one before it). */
    researcherTextFor(messageId) {
      const messages = this.session.snapshot().messages;
      const at = messages.findIndex((message) => message.messageId === messageId);
      for (let i = (at < 0 ? messages.length : at) - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.role === "user") return String(message.text ?? "");
      }
      return "";
    }
    renderPatchCard(card) {
      const doc = this.document;
      const ops = card.patch?.ops ?? [];
      const node2 = el3(doc, "div", {
        cls: `scholarium-weaver__card is-patch is-${card.state}`,
        attrs: { "data-card": card.cardId, "data-state": card.state, "data-dispatchable": String(card.dispatchable) }
      });
      node2.append(this.renderCardHead(`识别点精细修改 · ${ops.length} 项`, card), el3(doc, "div", {
        cls: "scholarium-weaver__card-body",
        text: `${card.reason || "按 Scholarium 地址精确修改"}
每项独立确认；保护字段与版本冲突由执行层拦截。`
      }));
      const detail = card.detail ?? {};
      if (card.state === "confirmed" || card.state === "failed" || card.state === "claimed") {
        const text6 = typeof detail.detail === "string" ? detail.detail : typeof detail.error === "string" ? detail.error : "";
        node2.append(el3(doc, "div", {
          cls: `scholarium-weaver__card-status is-${card.state}`,
          text: card.state === "claimed" ? `正在核对：操作 ${card.operationId ?? ""} 已开始。回滚清单在 ${MANIFEST_DIR}/ 下。` : text6
        }));
        const manifestFile = typeof detail.manifest === "string" ? detail.manifest : card.operationId ? manifestPath(card.operationId) : "";
        if (manifestFile && this.deps.vaultFiles && card.state !== "claimed") {
          const actions3 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
          const undo = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "撤销这些精细修改", attrs: { type: "button" } });
          undo.addEventListener("click", () => void this.onUndoFiles(manifestFile));
          actions3.append(undo);
          node2.append(actions3);
        }
        return node2;
      }
      if (card.state === "abandoned") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-result", text: "已关闭；没有改动任何识别点。" }));
        return node2;
      }
      if (!this.deps.vaultFiles) {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status is-unmigrated", text: "当前宿主没有提供 Vault 文件接口，不会执行精细修改。" }));
        return node2;
      }
      this.loadPatchPreview(card);
      const entry = this.patchPreviews.get(card.cardId);
      if (!entry || entry.status === "loading") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status", text: "正在本地解析地址并核对版本…" }));
        return node2;
      }
      if (entry.status === "error") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status is-failed", text: `检查失败：${entry.error}` }));
        return node2;
      }
      const label = { set_field: "字段", replace_section: "替换段落", append_section: "追加段落", replace_text: "定位替换" };
      let confirmButton = null;
      const refreshConfirm = () => {
        if (!confirmButton) return;
        confirmButton.textContent = `执行选中的 ${entry.selected.size} 项`;
        confirmButton.disabled = !this.canRunFiles() || entry.selected.size === 0;
      };
      const list4 = el3(doc, "div", { cls: "scholarium-weaver__fileops scholarium-weaver__patchops" });
      for (const preview of entry.previews) {
        const row = el3(doc, "div", { cls: `scholarium-weaver__fileop${preview.ok ? "" : " is-blocked"}` });
        const line2 = el3(doc, "label", { cls: "scholarium-weaver__fileop-line" });
        const box = el3(doc, "input", { attrs: { type: "checkbox", "data-patchop": String(preview.index) } });
        box.checked = entry.selected.has(preview.index);
        box.disabled = !preview.ok || card.state !== "pending";
        box.addEventListener("change", () => {
          if (box.checked) entry.selected.add(preview.index);
          else entry.selected.delete(preview.index);
          refreshConfirm();
        });
        line2.append(
          box,
          el3(doc, "span", {
            cls: `scholarium-weaver__fileop-kind is-${preview.declaration ? "declaration" : preview.op.op}`,
            text: preview.declaration ? "研究员声明" : label[preview.op.op] ?? preview.op.op
          }),
          el3(doc, "span", { cls: "scholarium-weaver__fileop-path", text: describePatchOp(preview.op) })
        );
        row.append(line2);
        if (!preview.ok) row.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-problem", text: `不能执行：${preview.problem}` }));
        if (preview.ok) {
          row.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-warning", text: `${preview.path} · 版本 ${preview.baseHash}` }));
          if (preview.warning) row.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-warning", text: preview.warning }));
          if (preview.declaration) {
            row.append(el3(doc, "div", {
              cls: "scholarium-weaver__fileop-declaration",
              text: `根据你本轮的自然语言说明整理，写入后记为研究员本人（user）的声明。${preview.declarationBasis ? `系统理解：${preview.declarationBasis}` : ""} 默认不勾选，请核对后亲自勾选。${preview.op.op === "set_field" ? `写入值：${JSON.stringify(preview.op.value)}` : ""}`
            }));
          }
          const details = el3(doc, "details", { cls: "scholarium-weaver__fileop-diff" });
          const added = preview.diff.filter((item) => item.kind === "add").length;
          const removed = preview.diff.filter((item) => item.kind === "del").length;
          this.keepDetailsOpen(details, `${card.cardId}:patch:${preview.index}`);
          details.append(el3(doc, "summary", { text: `查看这个识别点的修改前后（+${added} / −${removed} 行）` }));
          for (const diff of preview.diff.slice(0, 400)) {
            details.append(el3(doc, "div", {
              cls: `scholarium-weaver__diff-line is-${diff.kind}`,
              text: `${diff.kind === "add" ? "+ " : diff.kind === "del" ? "− " : "  "}${diff.text}`
            }));
          }
          row.append(details);
        }
        list4.append(row);
      }
      node2.append(list4);
      const archived = this.session.snapshot().archived;
      node2.append(el3(doc, "div", {
        cls: "scholarium-weaver__card-status",
        text: archived ? "预览：会话已归档，只读。" : "预览：尚未写入。每项可单独取消；执行前会再次核对整份笔记版本。"
      }));
      if (archived) return node2;
      const actions2 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
      const confirm = el3(doc, "button", {
        cls: "scholarium-weaver__confirm mod-cta",
        text: `执行选中的 ${entry.selected.size} 项`,
        attrs: { type: "button", "data-confirm": card.cardId }
      });
      confirm.disabled = !this.canRunFiles() || entry.selected.size === 0;
      confirmButton = confirm;
      confirm.addEventListener("click", () => void this.onConfirm(card));
      const abandon = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "关闭", attrs: { type: "button" } });
      abandon.addEventListener("click", () => void this.onAbandon(card));
      actions2.append(confirm, abandon);
      node2.append(actions2);
      return node2;
    }
    async onConfirmPatch(card) {
      const api = this.deps.vaultFiles;
      const entry = this.patchPreviews.get(card.cardId);
      if (!api || !card.patch || !entry || entry.status !== "ready" || !this.canRunFiles() || !entry.selected.size) return;
      const checked = await revalidatePatchPreviews(api, entry.previews);
      const conflicts = checked.filter((preview) => !preview.ok && entry.selected.has(preview.index));
      entry.previews = checked;
      if (conflicts.length) {
        for (const preview of conflicts) entry.selected.delete(preview.index);
        this.showNotice(`有 ${conflicts.length} 项在预览后被改过（版本冲突），已取消勾选、未写入。${entry.selected.size ? "其余各项可再次点击执行。" : "请让织研者重新 describe 后生成。"}`, "error");
        this.renderMessages();
        return;
      }
      const incomplete = selectionProblems(checked, entry.selected);
      if (incomplete.length) {
        this.showNotice(`没有执行：${incomplete.join("；")}`, "error");
        return;
      }
      this.busy = true;
      this.renderStatus();
      let operationId = null;
      try {
        const claim = await this.session.claim(card.messageId, card.kind);
        if (!claim.ok) {
          this.showNotice(`未能确认：${claim.error}`);
          return;
        }
        operationId = claim.operationId;
        const manifest = await applyPatchOps(api, entry.previews, entry.selected, {
          operationId,
          reason: card.reason,
          now: () => (/* @__PURE__ */ new Date()).toISOString(),
          save: (next) => this.saveManifest(next)
        });
        const summary = manifest.failed ? `精细修改在写入 ${manifest.steps.length} 份笔记后停止：${manifest.failed.error}。已完成部分可以撤销。` : `已执行 ${entry.selected.size} 项精细修改（写入 ${manifest.steps.length} 份笔记）。回滚清单：${manifestPath(operationId)}`;
        await this.session.settle(card.messageId, card.kind, operationId, manifest.failed ? "failed" : "confirmed", {
          detail: summary,
          manifest: manifestPath(operationId)
        });
        this.showNotice(summary, manifest.failed ? "error" : "info");
      } catch (error) {
        const failure5 = messageOf4(error);
        if (operationId) await this.session.settle(card.messageId, card.kind, operationId, "failed", { error: failure5, manifest: manifestPath(operationId) });
        else this.showNotice(`未能确认：${failure5}`);
      } finally {
        this.busy = false;
      }
      this.syncWindow();
      this.renderAll();
    }
    /* ------------------------------------------------------- file cards --- */
    canRunFiles() {
      return Boolean(this.deps.vaultFiles) && !this.busy && !this.session.snapshot().archived;
    }
    loadFilePreview(card) {
      const api = this.deps.vaultFiles;
      if (!api || !card.files || this.filePreviews.has(card.cardId)) return;
      const entry = { status: "loading", previews: [], selected: /* @__PURE__ */ new Set(), error: "" };
      this.filePreviews.set(card.cardId, entry);
      void previewFileOps(api, card.files.ops).then((previews) => {
        entry.status = "ready";
        entry.previews = previews;
        entry.selected = new Set(previews.filter((preview) => preview.ok).map((preview) => preview.index));
      }, (error) => {
        entry.status = "error";
        entry.error = messageOf4(error);
      }).finally(() => this.renderMessages());
    }
    renderFilesCard(card) {
      const doc = this.document;
      const ops = card.files?.ops ?? [];
      const node2 = el3(doc, "div", {
        cls: `scholarium-weaver__card is-files is-${card.state}`,
        attrs: { "data-card": card.cardId, "data-state": card.state, "data-dispatchable": String(card.dispatchable) }
      });
      const counts = ops.reduce((acc, op) => {
        acc[op.op] = (acc[op.op] ?? 0) + 1;
        return acc;
      }, {});
      const label = { mkdir: "新建文件夹", move: "移动/重命名", create: "新建文件", edit: "修改", trash: "移到回收站" };
      node2.append(this.renderCardHead(`文件改动请求 · ${ops.length} 项`, card));
      node2.append(el3(doc, "div", {
        cls: "scholarium-weaver__card-body",
        text: `${Object.entries(counts).map(([op, count2]) => `${label[op] ?? op} ${count2}`).join(" · ")}${card.reason ? `
理由：${card.reason}` : ""}`
      }));
      const detail = card.detail ?? {};
      if (card.state === "confirmed" || card.state === "failed" || card.state === "claimed") {
        const text6 = typeof detail.detail === "string" ? detail.detail : typeof detail.error === "string" ? detail.error : "";
        node2.append(el3(doc, "div", {
          cls: `scholarium-weaver__card-status is-${card.state}`,
          text: card.state === "claimed" ? `正在核对：操作 ${card.operationId ?? ""} 已开始。回滚清单在 ${MANIFEST_DIR}/ 下。` : text6
        }));
        const manifestFile = typeof detail.manifest === "string" ? detail.manifest : card.operationId ? manifestPath(card.operationId) : "";
        if (manifestFile && this.deps.vaultFiles && card.state !== "claimed") {
          const actions3 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
          const undo = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "撤销这批改动", attrs: { type: "button", "data-undo-files": card.cardId } });
          undo.addEventListener("click", () => void this.onUndoFiles(manifestFile));
          actions3.append(undo);
          node2.append(actions3);
        }
        return node2;
      }
      if (card.state === "abandoned") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-result", text: "已关闭；没有改动任何文件。" }));
        return node2;
      }
      if (!this.deps.vaultFiles) {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status is-unmigrated", text: "当前宿主没有提供 Vault 文件接口，本页不会执行文件改动。" }));
        return node2;
      }
      this.loadFilePreview(card);
      const entry = this.filePreviews.get(card.cardId);
      if (!entry || entry.status === "loading") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status", text: "正在对照 Vault 检查每一项…" }));
        return node2;
      }
      if (entry.status === "error") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status is-failed", text: `检查失败：${entry.error}` }));
        return node2;
      }
      let confirmButton = null;
      const refreshConfirm = () => {
        if (!confirmButton) return;
        confirmButton.textContent = `执行选中的 ${entry.selected.size} 项`;
        confirmButton.disabled = !this.canRunFiles() || entry.selected.size === 0;
      };
      const list4 = el3(doc, "div", { cls: "scholarium-weaver__fileops" });
      for (const preview of entry.previews) {
        const row = el3(doc, "div", { cls: `scholarium-weaver__fileop${preview.ok ? "" : " is-blocked"}` });
        const line2 = el3(doc, "label", { cls: "scholarium-weaver__fileop-line" });
        const box = el3(doc, "input", { attrs: { type: "checkbox", "data-fileop": String(preview.index) } });
        box.checked = entry.selected.has(preview.index);
        box.disabled = !preview.ok || card.state !== "pending";
        box.addEventListener("change", () => {
          if (box.checked) entry.selected.add(preview.index);
          else entry.selected.delete(preview.index);
          refreshConfirm();
        });
        line2.append(
          box,
          el3(doc, "span", { cls: `scholarium-weaver__fileop-kind is-${preview.op.op}`, text: label[preview.op.op] ?? preview.op.op }),
          el3(doc, "span", { cls: "scholarium-weaver__fileop-path", text: describeOp(preview.op).replace(/^\S+\s/, "") })
        );
        row.append(line2);
        if (!preview.ok) row.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-problem", text: `不能执行：${preview.problem}` }));
        for (const warning of preview.warnings) row.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-warning", text: warning }));
        if (preview.op.op === "edit" && preview.diff) {
          const details = el3(doc, "details", { cls: "scholarium-weaver__fileop-diff" });
          const added = preview.diff.filter((d) => d.kind === "add").length;
          const removed = preview.diff.filter((d) => d.kind === "del").length;
          this.keepDetailsOpen(details, `${card.cardId}:file:${preview.index}`);
          details.append(el3(doc, "summary", { text: `查看修改前后对比（+${added} / −${removed} 行）` }));
          for (const lineDiff2 of preview.diff.slice(0, 400)) {
            details.append(el3(doc, "div", {
              cls: `scholarium-weaver__diff-line is-${lineDiff2.kind}`,
              text: `${lineDiff2.kind === "add" ? "+ " : lineDiff2.kind === "del" ? "− " : "  "}${lineDiff2.text}`
            }));
          }
          row.append(details);
        }
        if (preview.op.op === "create") {
          const details = el3(doc, "details", { cls: "scholarium-weaver__fileop-diff" });
          this.keepDetailsOpen(details, `${card.cardId}:new:${preview.index}`);
          details.append(el3(doc, "summary", { text: "查看新文件内容" }));
          details.append(el3(doc, "pre", { cls: "scholarium-weaver__fileop-content", text: preview.op.content.slice(0, 2e4) }));
          row.append(details);
        }
        list4.append(row);
      }
      node2.append(list4);
      const archived = this.session.snapshot().archived;
      node2.append(el3(doc, "div", {
        cls: "scholarium-weaver__card-status",
        text: archived ? "预览：尚未执行（会话已归档，只读）" : "预览：尚未执行。勾选要执行的项；不会覆盖已有文件，删除只移到回收站，执行后可一键撤销。"
      }));
      if (archived) return node2;
      const actions2 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
      const confirm = el3(doc, "button", {
        cls: "scholarium-weaver__confirm mod-cta",
        text: `执行选中的 ${entry.selected.size} 项`,
        attrs: { type: "button", "data-confirm": card.cardId }
      });
      confirm.disabled = !this.canRunFiles() || entry.selected.size === 0;
      confirmButton = confirm;
      confirm.addEventListener("click", () => void this.onConfirm(card));
      actions2.append(confirm);
      const abandon = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "关闭", attrs: { type: "button", "data-abandon": card.cardId } });
      abandon.addEventListener("click", () => void this.onAbandon(card));
      actions2.append(abandon);
      node2.append(actions2);
      return node2;
    }
    /**
     * The Bridge's experiment edits look a record up by its frontmatter `uid`,
     * but a model naturally writes the display id (`EXP-001`). Translate it
     * here, from the vault itself, rather than letting the edit fail with
     * experiment_not_found. Anything that is not a clean display id is passed on
     * untouched and the Bridge judges it.
     */
    async withExperimentUid(card) {
      if (card.kind !== "action" || !EXPERIMENT_EDIT_ACTIONS.has(card.action ?? "")) return card;
      const given = String(card.input?.experiment_uid ?? "").trim();
      const api = this.deps.vaultFiles;
      if (!api || !/^EXP-\d+$/i.test(given)) return card;
      try {
        const manifest = await describeAnchor(api, `sch:${given.toUpperCase()}`);
        const uid = String(manifest.fields.uid?.value ?? "").trim();
        if (!uid) return card;
        return { ...card, input: { ...card.input ?? {}, experiment_uid: uid } };
      } catch {
        return card;
      }
    }
    /* ------------------------------------------------------ images --- */
    /** The URL an <img> may load: a Vault image, or an inline data: image.
     * Remote URLs are never loaded. */
    imageUrl(src) {
      const value = String(src ?? "").trim();
      if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
      const path2 = decodeURIComponentSafe(value).replace(/\\/g, "/").replace(/^\/+/, "");
      if (!IMAGE_EXT.test(path2) || path2.includes("..") || /^[a-z]+:/i.test(path2)) return null;
      const url = this.deps.vaultFiles?.resourceUrl?.(path2) ?? "";
      return url || null;
    }
    /** Save pasted / dropped images into the Vault and quote them in the composer. */
    async attachImages(files) {
      const api = this.deps.vaultFiles;
      const input = this.textareaEl;
      if (!api?.createBinary || !input) {
        this.showNotice("这个环境不能保存图片附件。", "error");
        return;
      }
      const now = /* @__PURE__ */ new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const folder = `${ATTACHMENT_DIR}/${month}`;
      const lines = [];
      for (const file of files.slice(0, 8)) {
        if (file.size > 20 * 1024 * 1024) {
          this.showNotice(`${file.name || "图片"} 超过 20 MB，没有添加。`, "error");
          continue;
        }
        const ext = (/\.(png|jpe?g|gif|webp|bmp)$/i.exec(file.name || "")?.[1] ?? (file.type.split("/")[1] || "png")).toLowerCase().replace("jpeg", "jpg");
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
        const base = (file.name || "image").replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40) || "image";
        try {
          for (const part of [ATTACHMENT_DIR.split("/")[0], ATTACHMENT_DIR.split("/").slice(0, 2).join("/"), ATTACHMENT_DIR, folder]) {
            if (!await api.kind(part)) await api.createFolder(part);
          }
          const path2 = await freePath(async (candidate) => Boolean(await api.kind(candidate)), `${folder}/${stamp}-${base}.${ext}`);
          await api.createBinary(path2, await file.arrayBuffer());
          lines.push(`![${base}](${path2})`);
        } catch (error) {
          this.showNotice(`图片没有保存：${messageOf4(error)}`, "error");
        }
      }
      if (!lines.length) return;
      const current = input.value.replace(/\s+$/, "");
      input.value = `${current}${current ? "\n" : ""}${lines.join("\n")}
`;
      input.focus?.();
      this.showNotice(`已添加 ${lines.length} 张图片（保存在 ${folder}），写上你的问题后发送。`, "info");
    }
    /* ------------------------------------------------------ figures --- */
    figurePreviews = /* @__PURE__ */ new Map();
    loadFigurePreview(card) {
      if (!card.figure || this.figurePreviews.has(card.cardId)) return;
      const entry = { status: "loading", items: [], selected: /* @__PURE__ */ new Set() };
      this.figurePreviews.set(card.cardId, entry);
      const api = this.deps.vaultFiles;
      void Promise.all(card.figure.figures.map(async (spec) => {
        try {
          if (spec.kind === "svg") return { spec, ok: true, problem: "", svg: sanitizeSvg(spec.svg) };
          if (spec.kind === "plot") {
            if (!api) throw new Error("没有 Vault 访问");
            const table = parseTable(await api.read(spec.data_path));
            return { spec, ok: true, problem: "", svg: plotSvg(table, { x: spec.x, y: spec.y, type: spec.type, title: spec.title, ...spec.x_label ? { x_label: spec.x_label } : {}, ...spec.y_label ? { y_label: spec.y_label } : {} }) };
          }
          return { spec, ok: Boolean(this.deps.generateImage), problem: this.deps.generateImage ? "" : "没有配置生图服务" };
        } catch (error) {
          return { spec, ok: false, problem: messageOf4(error) };
        }
      })).then((items2) => {
        entry.items = items2;
        entry.status = "ready";
        entry.selected = new Set(items2.map((item, index) => item.ok && item.svg ? index : -1).filter((index) => index >= 0));
      }).finally(() => this.renderMessages());
    }
    renderFigureCard(card) {
      const doc = this.document;
      const figures = card.figure?.figures ?? [];
      const node2 = el3(doc, "div", {
        cls: `scholarium-weaver__card is-figure is-${card.state}`,
        attrs: { "data-card": card.cardId, "data-state": card.state, "data-dispatchable": String(card.dispatchable) }
      });
      node2.append(this.renderCardHead(`图片 · ${figures.length} 张`, card));
      if (card.reason) node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-body", text: card.reason }));
      const detail = card.detail ?? {};
      if (card.state !== "pending") {
        const text6 = typeof detail.detail === "string" ? detail.detail : typeof detail.error === "string" ? detail.error : "";
        node2.append(el3(doc, "div", { cls: `scholarium-weaver__card-status is-${card.state}`, text: text6 }));
        const saved = Array.isArray(detail.saved) ? detail.saved.map(String) : [];
        const gallery2 = el3(doc, "div", { cls: "scholarium-weaver__figure-gallery" });
        for (const path2 of saved) {
          const url = this.imageUrl(path2);
          const box = el3(doc, "div", { cls: "scholarium-weaver__figure" });
          if (url) {
            const image = el3(doc, "img", { cls: "scholarium-weaver__figure-image", attrs: { src: url, alt: path2, title: `${path2}（点击在 Obsidian 中打开）` } });
            image.addEventListener("click", () => void this.deps.openVaultLink?.(path2));
            box.append(image);
          }
          box.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-warning", text: path2 }));
          gallery2.append(box);
        }
        if (saved.length) node2.append(gallery2);
        const manifestFile = typeof detail.manifest === "string" ? detail.manifest : "";
        if (card.state === "confirmed" && manifestFile) {
          const actions3 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
          const undo = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "撤销（移到回收站）", attrs: { type: "button", "data-undo-files": card.cardId } });
          undo.addEventListener("click", () => void this.onUndoFiles(manifestFile));
          actions3.append(undo);
          node2.append(actions3);
        }
        return node2;
      }
      this.loadFigurePreview(card);
      const entry = this.figurePreviews.get(card.cardId);
      if (!entry || entry.status === "loading") {
        node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status", text: "正在生成预览…" }));
        return node2;
      }
      let confirmButton = null;
      const refreshConfirm = () => {
        if (!confirmButton) return;
        confirmButton.textContent = `保存选中的 ${entry.selected.size} 张`;
        confirmButton.disabled = !this.canRunFiles() || entry.selected.size === 0;
      };
      const label = { svg: "示意图", plot: "数据图", generate: "AI 生图" };
      const gallery = el3(doc, "div", { cls: "scholarium-weaver__figure-gallery" });
      entry.items.forEach((item, index) => {
        const box = el3(doc, "div", { cls: `scholarium-weaver__figure${item.ok ? "" : " is-blocked"}` });
        const line2 = el3(doc, "label", { cls: "scholarium-weaver__fileop-line" });
        const tick2 = el3(doc, "input", { attrs: { type: "checkbox", "data-figure": String(index) } });
        tick2.checked = entry.selected.has(index);
        tick2.disabled = !item.ok || !(item.svg || item.image);
        tick2.addEventListener("change", () => {
          if (tick2.checked) entry.selected.add(index);
          else entry.selected.delete(index);
          refreshConfirm();
        });
        line2.append(
          tick2,
          el3(doc, "span", { cls: "scholarium-weaver__fileop-kind", text: label[item.spec.kind] ?? item.spec.kind }),
          el3(doc, "span", { cls: "scholarium-weaver__fileop-path", text: `${item.spec.title || "未命名"} → ${item.spec.save_to}` })
        );
        box.append(line2);
        if (item.svg) {
          const image = el3(doc, "img", { cls: "scholarium-weaver__figure-image", attrs: { src: svgDataUrl(item.svg), alt: item.spec.title } });
          box.append(image);
        } else if (item.image) {
          box.append(el3(doc, "img", { cls: "scholarium-weaver__figure-image", attrs: { src: `data:${item.image.mime};base64,${item.image.base64}`, alt: item.spec.title } }));
        }
        if (item.spec.kind === "generate") {
          box.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-warning", text: `提示词：${item.spec.prompt}（${item.spec.size}）` }));
          if (item.ok && this.deps.generateImage) {
            const generate = el3(doc, "button", { cls: "scholarium-weaver__confirm", text: item.generating ? "正在生成…" : item.image ? "重新生成" : "生成预览", attrs: { type: "button", "data-generate": String(index) } });
            generate.disabled = Boolean(item.generating);
            generate.addEventListener("click", () => {
              const spec = item.spec;
              if (spec.kind !== "generate" || !this.deps.generateImage) return;
              item.generating = true;
              this.renderMessages();
              void this.deps.generateImage(spec.prompt, spec.size).then((image) => {
                item.image = image;
                item.problem = "";
                entry.selected.add(index);
              }, (error) => {
                item.problem = messageOf4(error);
              }).finally(() => {
                item.generating = false;
                this.renderMessages();
              });
            });
            box.append(generate);
          }
        }
        if (item.problem) box.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-problem", text: item.ok ? item.problem : `不能保存：${item.problem}` }));
        gallery.append(box);
      });
      node2.append(gallery);
      const archived = this.session.snapshot().archived;
      node2.append(el3(doc, "div", { cls: "scholarium-weaver__card-status", text: archived ? "预览：会话已归档，只读。" : "预览：尚未保存。勾选要保存的图片；同名文件不会被覆盖（自动加序号）。" }));
      if (archived) return node2;
      const actions2 = el3(doc, "div", { cls: "scholarium-weaver__card-actions" });
      const confirm = el3(doc, "button", { cls: "scholarium-weaver__confirm mod-cta", text: "", attrs: { type: "button", "data-confirm": card.cardId } });
      confirmButton = confirm;
      refreshConfirm();
      confirm.addEventListener("click", () => void this.onConfirm(card));
      const abandon = el3(doc, "button", { cls: "scholarium-weaver__abandon", text: "关闭", attrs: { type: "button" } });
      abandon.addEventListener("click", () => void this.onAbandon(card));
      actions2.append(confirm, abandon);
      node2.append(actions2);
      return node2;
    }
    async onConfirmFigure(card) {
      const api = this.deps.vaultFiles;
      const entry = this.figurePreviews.get(card.cardId);
      if (!api || !entry || entry.status !== "ready" || !entry.selected.size || !this.canRunFiles()) return;
      this.busy = true;
      this.renderStatus();
      let operationId = null;
      try {
        const claim = await this.session.claim(card.messageId, card.kind);
        if (!claim.ok) {
          this.showNotice(`未能确认：${claim.error}`);
          return;
        }
        operationId = claim.operationId;
        const manifest = { operationId, createdAt: (/* @__PURE__ */ new Date()).toISOString(), reason: card.reason, steps: [], failed: null, undoneAt: null };
        await this.saveManifest(manifest);
        const saved = [];
        for (const index of [...entry.selected].sort((a, b) => a - b)) {
          const item = entry.items[index];
          if (!item) continue;
          try {
            const wanted = item.spec.save_to;
            const folder = wanted.split("/").slice(0, -1);
            for (let i = 1; i <= folder.length; i += 1) {
              const sub = folder.slice(0, i).join("/");
              if (!await api.kind(sub)) {
                await api.createFolder(sub);
                manifest.steps.push({ op: "mkdir", path: sub });
              }
            }
            const path2 = await freePath(async (candidate) => Boolean(await api.kind(candidate)), wanted);
            if (item.svg) await api.create(path2, item.svg);
            else if (item.image && api.createBinary) await api.createBinary(path2, base64ToBuffer(item.image.base64));
            else throw new Error("这张图还没有可保存的内容");
            manifest.steps.push({ op: "create", path: path2 });
            saved.push(path2);
            await this.saveManifest(manifest);
          } catch (error) {
            manifest.failed = { index, error: messageOf4(error) };
            await this.saveManifest(manifest);
            break;
          }
        }
        const summary = manifest.failed ? `保存了 ${saved.length} 张后停止：${manifest.failed.error}` : `已保存 ${saved.length} 张图片。`;
        await this.session.settle(card.messageId, card.kind, operationId, manifest.failed && !saved.length ? "failed" : "confirmed", {
          detail: summary,
          manifest: manifestPath(operationId),
          saved
        });
        this.showNotice(summary, manifest.failed ? "error" : "info");
      } catch (error) {
        const failure5 = messageOf4(error);
        if (operationId) await this.session.settle(card.messageId, card.kind, operationId, "failed", { error: failure5 });
        else this.showNotice(`未能确认：${failure5}`);
      } finally {
        this.busy = false;
      }
      this.syncWindow();
      this.renderAll();
    }
    /** P2 previews, read once per card; undone P2 cards in this session. */
    controlPreviews = /* @__PURE__ */ new Map();
    undoneCards = /* @__PURE__ */ new Set();
    renderControlPreview(card) {
      const doc = this.document;
      const box = el3(doc, "div", { cls: "scholarium-weaver__control-preview", attrs: { "data-control-preview": card.cardId } });
      const preview = this.deps.previewControlCard;
      if (!preview) return box;
      let entry = this.controlPreviews.get(card.cardId);
      if (!entry) {
        entry = { status: "loading", lines: [], stale: false, error: "" };
        this.controlPreviews.set(card.cardId, entry);
        const target = entry;
        void preview(card).then((result) => {
          target.status = "ready";
          target.stale = result.stale;
          const show = (value) => value === null || value === void 0 || value === "" ? "（空）" : typeof value === "string" ? value : JSON.stringify(value);
          target.lines = result.changes.map((change) => `${change.field}：${show(change.before)} → ${show(change.after)}`);
        }, (error) => {
          target.status = "error";
          target.error = messageOf4(error);
        }).finally(() => this.renderMessages());
      }
      if (entry.status === "loading") box.append(el3(doc, "div", { cls: "scholarium-weaver__card-status", text: "正在读取这条目前的值…" }));
      else if (entry.status === "error") box.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-problem", text: `读取失败：${entry.error}` }));
      else {
        for (const line2 of entry.lines) box.append(el3(doc, "div", { cls: "scholarium-weaver__diff-line is-change", text: line2 }));
        if (!entry.lines.length) box.append(el3(doc, "div", { cls: "scholarium-weaver__card-status", text: "这项请求没有改动可识别的字段。" }));
        if (entry.stale) box.append(el3(doc, "div", { cls: "scholarium-weaver__fileop-problem", text: "版本冲突：这条在织研者读取之后被改过，确认时会被拒绝；请让织研者重新读取后生成。" }));
      }
      return box;
    }
    async onUndoControl(card, undo) {
      const run = this.deps.undoControlAction;
      if (!run || this.busy) return;
      const ask = this.deps.workbench?.confirm ?? this.deps.confirmDiscardDraft ?? null;
      if (ask && !await ask("撤销这次修改？只会把这一条恢复成修改前的值；如果它之后又被改过，不会覆盖。")) return;
      this.busy = true;
      this.renderStatus();
      try {
        const result = await run(undo);
        if (result.status === "executed") this.undoneCards.add(card.cardId);
        this.showNotice(result.detail ?? (result.status === "executed" ? "已撤销。" : "撤销失败。"), result.status === "executed" ? "info" : "error");
      } catch (error) {
        this.showNotice(`撤销失败：${messageOf4(error)}`, "error");
      } finally {
        this.busy = false;
        this.renderAll();
      }
    }
    /** Diff panels stay open across re-renders (a tick elsewhere, a status change). */
    openDetails = /* @__PURE__ */ new Set();
    keepDetailsOpen(details, key) {
      if (this.openDetails.has(key)) details.open = true;
      details.addEventListener("toggle", () => {
        if (details.open) this.openDetails.add(key);
        else this.openDetails.delete(key);
      });
    }
    async saveManifest(manifest) {
      const api = this.deps.vaultFiles;
      if (!api) return;
      const path2 = manifestPath(manifest.operationId);
      const body = JSON.stringify(manifest, null, 2);
      if (!await api.kind(MANIFEST_DIR)) {
        if (!await api.kind("Scholarium")) await api.createFolder("Scholarium");
        await api.createFolder(MANIFEST_DIR);
      }
      if (await api.kind(path2)) await api.modify(path2, body);
      else await api.create(path2, body);
    }
    async onConfirmFiles(card) {
      const api = this.deps.vaultFiles;
      const entry = this.filePreviews.get(card.cardId);
      if (!api || !card.files || !entry || entry.status !== "ready" || !this.canRunFiles() || !entry.selected.size) return;
      this.busy = true;
      this.renderStatus();
      let operationId = null;
      try {
        const claim = await this.session.claim(card.messageId, card.kind);
        if (!claim.ok) {
          this.showNotice(`未能确认：${claim.error}`);
          return;
        }
        operationId = claim.operationId;
        const manifest = await applyFileOps(api, entry.previews, entry.selected, {
          operationId,
          reason: card.reason,
          now: () => (/* @__PURE__ */ new Date()).toISOString(),
          save: (next) => this.saveManifest(next)
        });
        const done = manifest.steps.filter((step) => step.op !== "mkdir" || entry.previews.some((p) => p.op.op === "mkdir")).length;
        const summary = manifest.failed ? `已执行 ${manifest.steps.length} 步后停止：${manifest.failed.error}。已完成的部分可以撤销。` : `已完成 ${done} 项文件改动。回滚清单：${manifestPath(operationId)}`;
        await this.session.settle(card.messageId, card.kind, operationId, manifest.failed ? "failed" : "confirmed", {
          detail: summary,
          manifest: manifestPath(operationId)
        });
        this.showNotice(summary, manifest.failed ? "error" : "info");
      } catch (error) {
        const failure5 = messageOf4(error);
        if (operationId) await this.session.settle(card.messageId, card.kind, operationId, "failed", { error: failure5, manifest: manifestPath(operationId) });
        else this.showNotice(`未能确认：${failure5}`);
      } finally {
        this.busy = false;
      }
      this.syncWindow();
      this.renderAll();
    }
    async onUndoFiles(path2) {
      const api = this.deps.vaultFiles;
      if (!api || this.busy) return;
      const ask = this.deps.workbench?.confirm ?? this.deps.confirmDiscardDraft ?? null;
      const confirmed = ask ? Boolean(await ask("撤销这批文件改动？移动会移回原处，修改会恢复原文，新建的文件会移到回收站。")) : true;
      if (!confirmed) return;
      this.busy = true;
      try {
        const manifest = JSON.parse(await api.read(path2));
        if (manifest.undoneAt) {
          this.showNotice(`这批改动已在 ${manifest.undoneAt} 撤销过。`);
          return;
        }
        const problems = await undoFileOps(api, manifest, revertPatchRegions);
        await this.saveManifest(manifest);
        this.showNotice(problems.length ? `已撤销，但有 ${problems.length} 项没能恢复：${problems.join("；")}` : "已撤销这批文件改动。", problems.length ? "error" : "info");
      } catch (error) {
        this.showNotice(`撤销失败：${messageOf4(error)}`, "error");
      } finally {
        this.busy = false;
        this.renderAll();
      }
    }
    async onAbandon(card) {
      const result = await this.session.abandon(card.messageId, card.kind);
      if (!result.ok) this.showNotice(`放弃失败：${result.error}`);
      this.syncWindow();
      this.renderAll();
    }
    async onDismissCard(card) {
      const result = await this.session.hideCard(card.cardId);
      if (!result.ok) this.showNotice(`关闭卡片失败：${result.error}`);
      this.syncWindow();
      this.renderAll();
    }
    /** The right rail: the trace of this conversation's confirmations, and the
     * scope as a summary. Always beside the conversation, never instead of it. */
    renderRightRail() {
      const doc = this.document;
      const cards = this.session.cards();
      if (this.traceEl) {
        const trace = this.traceEl;
        trace.replaceChildren();
        trace.append(el3(doc, "p", {
          cls: "scholarium-weaver__tool-muted",
          attrs: { "data-role": "trace-help" },
          text: "这里是本会话确认卡的审计记录：哪些请求待确认、已执行、失败或关闭。Pipeline 的逐步进度、续跑与重跑请打开“步骤”。"
        }));
        const counts = { pending: 0, claimed: 0, confirmed: 0, failed: 0, abandoned: 0 };
        for (const card of cards) counts[card.state] = (counts[card.state] ?? 0) + 1;
        if (this.railStateEl) {
          const [text6, tone] = counts.claimed ? [`核对中 ${counts.claimed}`, " is-warning"] : counts.pending ? [`待确认 ${counts.pending}`, " is-accent"] : cards.length ? ["已结算", ""] : ["尚无确认", ""];
          this.railStateEl.textContent = text6;
          this.railStateEl.className = `scholarium-weaver__tag${tone}`;
        }
        const settledCount = counts.confirmed + counts.failed + counts.abandoned;
        const progress = el3(doc, "div", { cls: "scholarium-weaver__progress", attrs: { "data-role": "trace-progress" } });
        const progressHead = el3(doc, "div", { cls: "scholarium-weaver__progress-head" });
        progressHead.append(
          el3(doc, "span", { text: "请求处理进度" }),
          el3(doc, "span", { text: `${settledCount} / ${cards.length}` })
        );
        const bar = el3(doc, "div", { cls: "scholarium-weaver__progress-bar" });
        const fill = el3(doc, "div", { cls: "scholarium-weaver__progress-fill" });
        fill.setAttribute("style", `width:${cards.length ? Math.round(settledCount / cards.length * 100) : 0}%`);
        bar.append(fill);
        progress.append(progressHead, bar);
        trace.append(progress);
        const metrics = el3(doc, "div", { cls: "scholarium-weaver__metrics", attrs: { "data-role": "trace-metrics" } });
        for (const [state, label] of [["pending", "待确认"], ["claimed", "核对中"], ["confirmed", "已执行"], ["failed", "未生效"]]) {
          const metric = el3(doc, "div", { cls: `scholarium-weaver__metric is-${state}`, attrs: { "data-metric": state } });
          metric.append(
            el3(doc, "span", { cls: "scholarium-weaver__metric-value", text: String(counts[state] ?? 0) }),
            el3(doc, "span", { cls: "scholarium-weaver__metric-label", text: label })
          );
          metrics.append(metric);
        }
        trace.append(metrics);
        const lastTask = [...this.session.snapshot().messages].reverse().find((message) => message.taskId);
        if (lastTask?.taskId) {
          trace.append(el3(doc, "div", {
            cls: "scholarium-weaver__trace-task",
            attrs: { "data-role": "trace-task" },
            text: `最近任务 ${lastTask.taskId}${lastTask.provider ? ` · ${lastTask.provider}` : ""} · ${shortTime(lastTask.at)}`
          }));
        }
        const settled = cards.filter((card) => card.history.length > 0).reverse();
        const list4 = el3(doc, "div", { cls: "scholarium-weaver__trace-list" });
        if (!settled.length) {
          list4.append(el3(doc, "div", {
            cls: "scholarium-weaver__empty",
            text: "本会话还没有确认记录。确认过的卡会在这里留下状态与操作号。"
          }));
        }
        for (const card of settled) {
          const row = el3(doc, "div", {
            cls: `scholarium-weaver__trace-row is-${card.state}`,
            attrs: { "data-trace": card.cardId, "data-state": card.state }
          });
          row.append(
            el3(doc, "div", { cls: "scholarium-weaver__trace-title", text: `${card.action ?? card.kind}` }),
            el3(doc, "div", { cls: "scholarium-weaver__trace-path", text: card.history.map((state) => CARD_STATE_LABEL[state] ?? state).join(" → ") })
          );
          if (card.operationId) row.append(el3(doc, "div", { cls: "scholarium-weaver__trace-op", text: card.operationId }));
          const detail = card.detail && typeof card.detail.detail === "string" ? card.detail.detail : "";
          if (detail) row.append(el3(doc, "div", { cls: "scholarium-weaver__trace-detail", text: detail }));
          list4.append(row);
        }
        trace.append(list4);
      }
      for (const tab of ["ideas", "history"]) {
        const panel = this.railPanels.get(tab);
        if (!panel) continue;
        panel.replaceChildren();
        if (this.railTab !== tab) continue;
        if (tab === "ideas") this.workbench.renderIdeas(panel);
        else this.workbench.renderHistory(panel);
      }
    }
    emptyMessage() {
      const state = this.session.snapshot();
      if (state.status === "unavailable") return `历史对话不可用：${state.error ?? "未知原因"}`;
      if (state.unsaved.length) return "有消息尚未保存到 Vault，见上方提示。";
      if (!state.sessionId) return "这是一段新会话。在下方输入问题；发送前会先保存到 Vault，因此这里的每一条都已经落盘。";
      return "还没有消息。发送前会先保存，因此这里的每一条都已经在 Vault 里。";
    }
    /** The 未保存 / error banner. Both are states the researcher must be able to
     * see and act on, so neither is ever rendered as a silent absence. */
    /**
     * The floating notices: a stack in the page's corner, over the content
     * rather than above it, so an error never pushes the conversation down.
     * Errors stay until dismissed; an information line fades on its own.
     */
    renderNotice() {
      const doc = this.document;
      const notice = this.noticeEl;
      if (!notice) return;
      notice.replaceChildren();
      this.notices.forEach((entry) => {
        const row = el3(doc, "div", { cls: `scholarium-weaver__notice-row is-${entry.kind}`, attrs: { role: entry.kind === "error" ? "alert" : "status" } });
        row.append(el3(doc, "span", { cls: "scholarium-weaver__notice-text", text: entry.message }));
        const dismiss = el3(doc, "button", { cls: "scholarium-weaver__notice-dismiss", text: "×", attrs: { type: "button", "aria-label": "关闭", "data-dismiss-notice": entry.message } });
        dismiss.addEventListener("click", () => this.dismissNotice(entry));
        row.append(dismiss);
        notice.append(row);
      });
      const state = this.session.snapshot();
      if (state.status === "unavailable") {
        notice.append(el3(doc, "div", { cls: "scholarium-weaver__notice-row is-error", text: `历史不可用：${state.error ?? ""}` }));
      }
      if (state.unsaved.length) {
        const row = el3(doc, "div", { cls: "scholarium-weaver__notice-row is-unsaved", attrs: { "data-role": "unsaved" } });
        row.append(el3(doc, "span", { text: `${state.unsaved.length} 条消息未保存到 Vault：${state.unsaved.map((entry) => entry.message.text).join(" / ")}` }));
        const retry = el3(doc, "button", { cls: "scholarium-weaver__retry", text: "重试保存", attrs: { type: "button", "data-role": "retry" } });
        retry.addEventListener("click", () => void this.onRetry());
        row.append(retry);
        notice.append(row);
      }
      notice.hidden = notice.children.length === 0;
    }
    dismissNotice(entry) {
      this.notices = this.notices.filter((candidate) => candidate !== entry);
      this.renderNotice();
    }
    /** A failure that happened in this view (a write the store refused, an index
     * that would not read) stays until the researcher dismisses it: an error
     * that disappears on the next render is an error nobody can act on. The
     * same sentence twice is one notice. */
    showNotice(message, kind = "error") {
      this.notices = this.notices.filter((entry2) => entry2.message !== message);
      const entry = { message, kind };
      this.notices = [...this.notices, entry];
      this.renderNotice();
      if (kind === "info") {
        const timer = setTimeout(() => this.dismissNotice(entry), 6e3);
        timer.unref?.();
      }
    }
  };
  var RUN_LABEL = {
    "pipeline.run": "运行完整文献 Pipeline",
    "literature.search": "仅检索文献",
    "literature.queue": "加入人工下载队列",
    "pipeline.rerun": "从指定步骤重新运行 Pipeline"
  };
  function runDetail(run) {
    if (run.operation === "literature.queue") {
      return `论文：${run.items?.length ?? 0} 篇
${(run.items ?? []).map((item) => `${item.doi} · ${item.title}`).join("\n")}`;
    }
    if (run.operation === "pipeline.rerun") {
      return `历史任务：${run.run_id === "latest" ? "当前工作区最近一次 Pipeline" : run.run_id ?? ""}
起点：${run.from_step ?? ""}`;
    }
    return `主题：${run.topic ?? ""}`;
  }
  function messageOf4(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function numberOr(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function el3(doc, tag, options = {}) {
    const node2 = doc.createElement(tag);
    if (options.cls) node2.className = options.cls;
    if (options.text !== void 0) node2.textContent = options.text;
    for (const [name, value] of Object.entries(options.attrs ?? {})) node2.setAttribute(name, value);
    return node2;
  }

  // src/adapters/runtime/bridge-client.ts
  var DEFAULT_TIMEOUT_MS = 1200;
  var DEFAULT_BUDGET_MS = 2e3;
  var NO_ADDRESS = "没有可用的地址：运行时地址只能来自启动器回报的记录";
  function hostFetch() {
    const implementation = globalThis.fetch;
    if (typeof implementation !== "function") {
      return async () => {
        throw new Error("no fetch implementation in this host");
      };
    }
    return implementation.bind(globalThis);
  }
  var BridgeClient = class {
    options;
    fetchImpl;
    listeners = /* @__PURE__ */ new Set();
    currentStatus = "offline";
    currentBaseUrl = null;
    currentError = null;
    inFlight = null;
    constructor(options = {}) {
      this.options = options;
      this.fetchImpl = options.fetch ?? hostFetch();
    }
    get status() {
      return this.currentStatus;
    }
    /** The address that last answered, or null when none has. */
    get baseUrl() {
      return this.currentBaseUrl;
    }
    get lastError() {
      return this.currentError;
    }
    get timeoutMs() {
      return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    }
    onStatus(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    /**
     * The addresses this client is allowed to try, in order.
     *
     * Empty when the caller supplied none, which is a legitimate and common
     * state: a client built before a runtime has reported an origin has nothing
     * to try, and an empty list is what makes `connect()` resolve `offline` at
     * once instead of reaching for a port it chose itself.
     */
    candidateUrls() {
      const declared = this.options.baseUrl ? [this.options.baseUrl.replace(/\/+$/, "")] : [];
      const ordered = [this.currentBaseUrl, ...declared, ...this.options.candidates ?? []];
      return [...new Set(ordered.filter((value) => Boolean(value)).map((value) => value.replace(/\/+$/, "")))];
    }
    /**
     * Find a Bridge. Always resolves; the resolved value is the new status.
     *
     * Concurrent calls share one attempt, so two things asking for the same
     * connection (a button and a background timer) cannot both flip the badge.
     */
    async connect() {
      if (this.inFlight) return this.inFlight;
      this.inFlight = this.runConnect().finally(() => {
        this.inFlight = null;
      });
      return this.inFlight;
    }
    async runConnect() {
      this.setStatus("connecting");
      if (!this.candidateUrls().length) {
        this.currentError = NO_ADDRESS;
        this.setStatus(this.currentBaseUrl ? "degraded" : "offline");
        return this.currentStatus;
      }
      let lastError = NO_ADDRESS;
      const deadline = Date.now() + (this.options.budgetMs ?? DEFAULT_BUDGET_MS);
      for (const base of this.candidateUrls()) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          lastError = `no bridge answered within ${this.options.budgetMs ?? DEFAULT_BUDGET_MS} ms`;
          break;
        }
        const result = await this.probe(base, Math.min(this.timeoutMs, remaining));
        if (result.ok) {
          this.currentBaseUrl = base;
          this.currentError = null;
          this.setStatus("online");
          return this.currentStatus;
        }
        lastError = result.error;
      }
      this.currentError = lastError;
      this.setStatus(this.currentBaseUrl ? "degraded" : "offline");
      return this.currentStatus;
    }
    async probe(base, timeoutMs) {
      return this.requestAgainst(`${base}/health`, { method: "GET", timeoutMs });
    }
    /** Forget the connection. No request is made; the status changes at once. */
    disconnect() {
      this.currentBaseUrl = null;
      this.currentError = null;
      this.setStatus("offline");
    }
    /**
     * A request that cannot throw and cannot hang.
     *
     * A failure only moves the status; it is the caller's to render, not to
     * catch. A success after a failure is the recovery path, and it restores
     * `online` without anyone restarting the plugin.
     */
    async request(path2, options = {}) {
      const base = options.baseUrl ?? this.currentBaseUrl ?? this.options.baseUrl;
      if (!base) return { ok: false, error: NO_ADDRESS, status: null, timedOut: false };
      const result = await this.requestAgainst(`${base.replace(/\/+$/, "")}${path2}`, options);
      if (result.ok) {
        this.currentBaseUrl = base.replace(/\/+$/, "");
        this.currentError = null;
        this.setStatus("online");
      } else {
        this.currentError = result.error;
        this.setStatus("degraded");
      }
      return result;
    }
    async requestAgainst(url, options) {
      const timeoutMs = options.timeoutMs ?? this.timeoutMs;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const headers = { accept: "application/json", ...this.options.headers ?? {} };
        const token = this.options.token;
        if (token) headers["x-agent-bridge-token"] = token;
        let body;
        if (options.body !== void 0) {
          headers["content-type"] = "application/json";
          body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
        }
        const response = await this.fetchImpl(url, {
          method: options.method ?? "GET",
          headers,
          ...body === void 0 ? {} : { body },
          signal: controller.signal
        });
        const text6 = await response.text();
        if (!response.ok) {
          let reason = "";
          try {
            const parsed = JSON.parse(text6);
            if (typeof parsed?.error === "string") reason = parsed.error.trim().slice(0, 300);
          } catch {
            reason = "";
          }
          if (token && reason.includes(token)) reason = reason.split(token).join("[redacted]");
          return { ok: false, error: reason ? `HTTP ${response.status}：${reason}` : `HTTP ${response.status}`, status: response.status, timedOut: false };
        }
        let data = null;
        if (text6.trim()) {
          try {
            data = JSON.parse(text6);
          } catch {
            return { ok: false, error: "the bridge returned a body that is not JSON", status: response.status, timedOut: false };
          }
        }
        return { ok: true, status: response.status, data };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          error: timedOut ? `no answer within ${timeoutMs} ms` : message,
          status: null,
          timedOut
        };
      } finally {
        clearTimeout(timer);
      }
    }
    setStatus(status) {
      if (this.currentStatus === status) return;
      this.currentStatus = status;
      for (const listener of [...this.listeners]) {
        try {
          listener(status);
        } catch {
        }
      }
    }
  };

  // src/adapters/runtime/endpoint.ts
  var LOOPBACK_HOST = "127.0.0.1";
  var MIN_PORT = 1;
  var MAX_PORT = 65535;
  var DEFAULT_PROBE_TIMEOUT_MS = 1200;
  var reject = (reason) => ({ ok: false, reason });
  var accept = (value) => ({ ok: true, value });
  var isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  function parsePort(value) {
    if (typeof value !== "number") {
      const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      return reject(`a port must be a number; got ${kind}`);
    }
    if (Number.isNaN(value)) return reject("a port must be a number; got NaN");
    if (!Number.isInteger(value)) return reject(`a port must be a whole number; got ${value}`);
    if (value < MIN_PORT) return reject(`a port must be at least ${MIN_PORT}; got ${value}`);
    if (value > MAX_PORT) return reject(`a port must be at most ${MAX_PORT}; got ${value}`);
    return accept(value);
  }
  function parseLoopbackOrigin(value) {
    if (typeof value !== "string") return reject("an origin must be a string");
    if (value.length === 0) return reject("an origin must not be empty");
    if (value !== value.trim()) return reject("an origin must not be padded with whitespace");
    let url;
    try {
      url = new URL(value);
    } catch {
      return reject(`"${value}" is not a URL`);
    }
    if (url.protocol !== "http:") return reject(`an origin must be http, not ${url.protocol}`);
    if (url.username !== "" || url.password !== "") return reject("an origin must not carry credentials");
    if (url.hostname !== LOOPBACK_HOST) {
      return reject(`an origin must be hosted at ${LOOPBACK_HOST}, not ${url.hostname}`);
    }
    if (url.port === "") return reject("an origin must name a port");
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      return reject("an origin must not carry a path, a query or a fragment");
    }
    const parsedPort = parsePort(Number(url.port));
    if (!parsedPort.ok) return parsedPort;
    if (value !== url.origin) {
      return reject(`"${value}" is not the canonical form of its own origin (${url.origin})`);
    }
    return accept({ origin: url.origin, port: parsedPort.value });
  }
  var isInstanceId = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value);
  var isVaultHash = (value) => typeof value === "string" && /^[0-9a-f]{16,64}$/.test(value);
  var isPid = (value) => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;
  var isAuthMode = (value) => value === "proxy" || value === "direct";
  function parseEndpointReport(raw, expected) {
    if (!isPlainObject(raw)) return reject("an endpoint report must be an object");
    const origin = parseLoopbackOrigin(raw.origin);
    if (!origin.ok) return origin;
    const port = parsePort(raw.port);
    if (!port.ok) return port;
    if (port.value !== origin.value.port) {
      return reject(`the reported port ${port.value} is not the port in the reported origin`);
    }
    if (!isPid(raw.pid)) return reject("a report must carry the launcher's process id");
    if (!isInstanceId(raw.instanceId)) return reject("a report must carry an instance id");
    if (!isVaultHash(raw.vaultHash)) return reject("a report must carry the vault hash");
    if (!isAuthMode(raw.auth)) return reject("a report must say where the credential lives");
    if (raw.vaultHash !== expected.vaultHash) return reject("the report is for a different vault");
    if (raw.instanceId !== expected.instanceId) return reject("the report is from a different instance");
    const startedAt = typeof raw.startedAt === "number" && Number.isFinite(raw.startedAt) ? raw.startedAt : 0;
    return accept({
      origin: origin.value.origin,
      port: port.value,
      pid: raw.pid,
      instanceId: raw.instanceId,
      vaultHash: raw.vaultHash,
      startedAt,
      auth: raw.auth
    });
  }
  var HEALTH_PATH = "/health";

  // src/adapters/runtime/process-tree.ts
  var DEFAULT_KILL_TIMEOUT_MS = 4e3;
  var DEFAULT_POLL_MS = 50;
  function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
  var defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  var alive = (pid, options) => (options.isAlive ?? isProcessAlive)(pid);
  async function waitForDeath(pid, options, deadline) {
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const sleep = options.sleep ?? defaultSleep;
    for (; ; ) {
      if (!alive(pid, options)) return true;
      if (Date.now() >= deadline) return false;
      await sleep(pollMs);
    }
  }
  async function terminateProcessTree(pid, options) {
    const platform = options.platform ?? process.platform;
    const timeoutMs = options.timeoutMs ?? DEFAULT_KILL_TIMEOUT_MS;
    const run = options.run;
    if (!Number.isInteger(pid) || pid <= 0) {
      return { ok: true, pids: [], survivors: [], detail: `no process to stop for pid ${String(pid)}` };
    }
    if (!alive(pid, options)) {
      return { ok: true, pids: [pid], survivors: [], detail: `pid ${pid} was already gone` };
    }
    const deadline = Date.now() + timeoutMs;
    let detail;
    if (platform === "win32") {
      const result = run("taskkill", ["/PID", String(pid), "/T", "/F"]);
      if (result.status === 128) {
        return { ok: true, pids: [pid], survivors: [], detail: `pid ${pid} exited before it could be stopped` };
      }
      detail = result.status === 0 ? `taskkill stopped the tree at ${pid}` : `taskkill exited ${String(result.status)} for ${pid}`;
    } else {
      try {
        process.kill(pid, "SIGTERM");
        detail = `SIGTERM sent to ${pid}`;
      } catch (error) {
        const code = error.code;
        if (code === "ESRCH") return { ok: true, pids: [pid], survivors: [], detail: `pid ${pid} was already gone` };
        detail = `SIGTERM to ${pid} failed: ${code ?? "unknown"}`;
      }
    }
    if (await waitForDeath(pid, options, deadline)) {
      return { ok: true, pids: [pid], survivors: [], detail };
    }
    if (platform !== "win32") {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
      }
      if (await waitForDeath(pid, options, deadline)) {
        return { ok: true, pids: [pid], survivors: [], detail: `${detail}, then SIGKILL` };
      }
    }
    return {
      ok: false,
      pids: [pid],
      survivors: [pid],
      detail: `${detail}; pid ${pid} is still alive after ${timeoutMs} ms`
    };
  }
  async function terminateAll(pids, options) {
    const unique = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
    const survivors = [];
    const details = [];
    for (const pid of unique) {
      const report = await terminateProcessTree(pid, options);
      survivors.push(...report.survivors);
      details.push(report.detail);
    }
    return {
      ok: survivors.length === 0,
      pids: unique,
      survivors,
      detail: details.length ? details.join("; ") : "no processes to stop"
    };
  }

  // src/adapters/runtime/redaction.ts
  var REDACTED = "[redacted]";
  var SHAPE_PATTERNS = Object.freeze([
    /\b(x-agent-bridge-token|authorization|proxy-authorization|x-api-key|api[-_]?key)\b(\s*[:=]\s*)("?)([^"\s,;]+)\3/gi,
    /\b(bearer)\s+([A-Za-z0-9._~+/=-]{8,})/gi,
    /\b(sk-ant-[A-Za-z0-9_-]{8,}|sk-proj-[A-Za-z0-9_-]{8,}|sk-svcacct-[A-Za-z0-9_-]{8,}|sk[-_][A-Za-z0-9_-]{16,})/g,
    /\b(sk_live_[A-Za-z0-9]{8,}|rk_live_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{16,}|xoxb-[A-Za-z0-9-]{8,}|AKIA[0-9A-Z]{12,})/g
  ]);
  var SHAPE_REPLACEMENTS = Object.freeze([
    (_whole, name, separator, quote) => `${name}${separator}${quote}${REDACTED}${quote}`,
    (_whole, scheme) => `${scheme} ${REDACTED}`,
    (_whole) => REDACTED,
    (_whole) => REDACTED
  ]);
  function createRedactor(initial = []) {
    const secrets = /* @__PURE__ */ new Set();
    const register = (secret) => {
      if (typeof secret === "string" && secret.length >= 6) secrets.add(secret);
    };
    for (const secret of initial) register(secret);
    const redact = (text6) => {
      if (typeof text6 !== "string" || text6.length === 0) return text6 ?? "";
      let out2 = text6;
      for (const secret of secrets) {
        if (out2.includes(secret)) out2 = out2.split(secret).join(REDACTED);
      }
      SHAPE_PATTERNS.forEach((pattern, index) => {
        const replacement = SHAPE_REPLACEMENTS[index];
        out2 = out2.replace(pattern, (match, ...groups) => replacement(match, ...groups));
      });
      return out2;
    };
    return {
      register,
      containsSecret: (text6) => {
        if (typeof text6 !== "string" || text6.length === 0) return false;
        for (const secret of secrets) if (text6.includes(secret)) return true;
        return false;
      },
      redact,
      secrets: () => [...secrets]
    };
  }
  function assertClean(redactor, label, bytes) {
    if (redactor.containsSecret(bytes)) {
      throw new Error(`${label} would contain a registered secret; refusing to write it`);
    }
  }

  // src/adapters/runtime/record.ts
  var HANDSHAKE_VERSION = 1;
  var READY_MESSAGE_TYPE = "scholarium-runtime/ready";
  var ERROR_MESSAGE_TYPE = "scholarium-runtime/error";
  var ERROR_CODES = Object.freeze([
    "runtime-missing",
    "spawn-failed",
    "bind-failed",
    "profile-unwritable"
  ]);
  var isPlainObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
  function parseLauncherMessage(raw, expected, redact = (text6) => text6) {
    if (!isPlainObject2(raw)) return reject("a launcher message must be an object");
    if (raw.version !== HANDSHAKE_VERSION) {
      return reject(`a launcher message must be version ${HANDSHAKE_VERSION}`);
    }
    if (raw.type === ERROR_MESSAGE_TYPE) {
      const code = typeof raw.code === "string" && ERROR_CODES.includes(raw.code) ? raw.code : "spawn-failed";
      const message = typeof raw.message === "string" && raw.message.trim() ? redact(raw.message.trim().slice(0, 500)) : "";
      const exitCode = typeof raw.exitCode === "number" && Number.isFinite(raw.exitCode) ? raw.exitCode : null;
      return accept({ kind: "error", code, message, exitCode });
    }
    if (raw.type !== READY_MESSAGE_TYPE) return reject(`"${String(raw.type)}" is not a launcher message`);
    const endpoint = parseEndpointReport(raw, expected);
    if (!endpoint.ok) return endpoint;
    return accept({ kind: "ready", endpoint: endpoint.value, children: parseChildren(raw.children) });
  }
  var MAX_CHILDREN = 64;
  function parseChildren(value) {
    if (!Array.isArray(value)) return [];
    const pids = value.filter(isPid2).slice(0, MAX_CHILDREN);
    return [...new Set(pids)];
  }
  function endpointToRecord(endpoint, launcherDigest2) {
    return {
      version: HANDSHAKE_VERSION,
      vaultHash: endpoint.vaultHash,
      instanceId: endpoint.instanceId,
      pid: endpoint.pid,
      origin: endpoint.origin,
      port: endpoint.port,
      auth: endpoint.auth,
      startedAt: endpoint.startedAt,
      launcherDigest: launcherDigest2
    };
  }
  function recordToEndpoint(record2) {
    return {
      origin: record2.origin,
      port: record2.port,
      pid: record2.pid,
      instanceId: record2.instanceId,
      vaultHash: record2.vaultHash,
      startedAt: record2.startedAt,
      auth: record2.auth
    };
  }
  function serializeRuntimeRecord(record2) {
    return `${JSON.stringify({
      version: HANDSHAKE_VERSION,
      vaultHash: record2.vaultHash,
      instanceId: record2.instanceId,
      pid: record2.pid,
      origin: record2.origin,
      port: record2.port,
      auth: record2.auth,
      startedAt: record2.startedAt,
      launcherDigest: record2.launcherDigest
    })}
`;
  }
  var isInstanceId2 = (value) => typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value);
  var isVaultHash2 = (value) => typeof value === "string" && /^[0-9a-f]{16,64}$/.test(value);
  var isPid2 = (value) => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 2147483647;
  function parseRuntimeRecord(raw) {
    if (!isPlainObject2(raw)) return reject("a runtime record must be an object");
    if (raw.version !== HANDSHAKE_VERSION) return reject(`a runtime record must be version ${HANDSHAKE_VERSION}`);
    if (!isVaultHash2(raw.vaultHash)) return reject("a runtime record must carry a vault hash");
    if (!isInstanceId2(raw.instanceId)) return reject("a runtime record must carry an instance id");
    if (!isPid2(raw.pid)) return reject("a runtime record must carry a process id");
    if (raw.auth !== "proxy" && raw.auth !== "direct") return reject("a runtime record must say where the credential lives");
    if (typeof raw.launcherDigest !== "string" || !/^[0-9a-f]{12}$/.test(raw.launcherDigest)) {
      return reject("a runtime record must carry a launcher digest");
    }
    const origin = parseLoopbackOrigin(raw.origin);
    if (!origin.ok) return origin;
    const port = parsePort(raw.port);
    if (!port.ok) return port;
    if (port.value !== origin.value.port) {
      return reject(`the recorded port ${port.value} is not the port in the recorded origin`);
    }
    const startedAt = typeof raw.startedAt === "number" && Number.isFinite(raw.startedAt) ? raw.startedAt : 0;
    return accept({
      version: HANDSHAKE_VERSION,
      vaultHash: raw.vaultHash,
      instanceId: raw.instanceId,
      pid: raw.pid,
      origin: origin.value.origin,
      port: port.value,
      auth: raw.auth,
      startedAt,
      launcherDigest: raw.launcherDigest
    });
  }

  // src/adapters/runtime/vault-profile.ts
  var import_node_crypto = __require("node:crypto");
  var import_node_os = __require("node:os");
  var import_node_path = __toESM(__require("node:path"), 1);
  var RECORD_FILE_NAME = "runtime.json";
  function normalizeVaultPath(vaultPath) {
    if (typeof vaultPath !== "string") return "";
    const unified = vaultPath.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
    const withoutTrailing = unified.length > 1 ? unified.replace(/\/+$/, "") : unified;
    return withoutTrailing.toLowerCase();
  }
  function vaultScopeHash(vaultPath) {
    const normalized = normalizeVaultPath(vaultPath);
    if (!normalized) {
      throw new Error("a vault hash needs a vault path; an empty one would name every unset vault the same");
    }
    return (0, import_node_crypto.createHash)("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
  }
  var HASH_PATTERN = /^[0-9a-f]{16,64}$/;
  function profileDirFor(root, vaultHash) {
    if (typeof root !== "string" || root.trim() === "") throw new Error("a runtime root is required");
    if (typeof vaultHash !== "string" || !HASH_PATTERN.test(vaultHash)) {
      throw new Error(`"${String(vaultHash)}" is not a vault hash`);
    }
    return import_node_path.default.join(root, vaultHash);
  }
  function recordPathFor(root, vaultHash) {
    return import_node_path.default.join(profileDirFor(root, vaultHash), RECORD_FILE_NAME);
  }
  function recordTempPathFor(root, vaultHash, suffix) {
    const safe3 = typeof suffix === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(suffix) ? suffix : String(process.pid);
    return `${recordPathFor(root, vaultHash)}.${safe3}.tmp`;
  }
  function defaultRuntimeRoot() {
    return import_node_path.default.join((0, import_node_os.homedir)() || (0, import_node_os.tmpdir)(), ".scholarium", "runtime");
  }
  function launcherDigest(command, args = []) {
    const text6 = [String(command ?? ""), ...args.map((arg) => String(arg ?? ""))].join("\0");
    return (0, import_node_crypto.createHash)("sha256").update(text6, "utf8").digest("hex").slice(0, 12);
  }

  // src/adapters/runtime/launcher.ts
  var DEFAULT_HANDSHAKE_TIMEOUT_MS = 15e3;
  var DEFAULT_STOP_TIMEOUT_MS = 4e3;
  var DEFAULT_REQUEST_TIMEOUT_MS = 5e3;
  var STDERR_TAIL_LINES = 12;
  var ok = (value) => ({ ok: true, value });
  var fail = (failure5) => ({ ok: false, failure: failure5 });
  function bodyError2(text6) {
    try {
      const parsed = JSON.parse(text6);
      return typeof parsed?.error === "string" ? parsed.error.trim().slice(0, 300) : "";
    } catch {
      return "";
    }
  }
  var errorCode = (error) => typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  var failure4 = (kind, message, detail = {}, exitCode) => ({ kind, message, detail, exitCode: exitCode ?? null });
  function categorySentence(kind) {
    switch (kind) {
      case "runtime-missing":
        return "没有找到可用的运行时";
      case "spawn-failed":
        return "运行时进程没能启动";
      case "bind-failed":
        return "运行时没能占用端口";
      case "profile-unwritable":
        return "运行时的配置目录不可写";
      case "exited-early":
        return "运行时在报告端口之前就退出了";
      case "handshake-timeout":
        return "运行时没有在限定时间内报告端口";
      case "handshake-invalid":
        return "运行时报告了一个不合法的地址";
      case "record-invalid":
        return "这个 Vault 的运行时记录无法解析";
      case "request-failed":
        return "运行时没有正常回应这次请求";
      case "stop-failed":
        return "运行时进程没有停下来";
      default:
        return "运行时不可用";
    }
  }
  var LAUNCHER_CODE_TO_KIND = Object.freeze({
    "runtime-missing": "runtime-missing",
    "spawn-failed": "spawn-failed",
    "bind-failed": "bind-failed",
    "profile-unwritable": "profile-unwritable"
  });
  var RuntimeLauncher = class {
    options;
    redactor = createRedactor();
    fs;
    spawnImpl;
    listeners = /* @__PURE__ */ new Set();
    configurationFailure;
    vaultHash;
    profileDir;
    recordPath;
    runtimeRoot;
    currentStatus = "offline";
    currentEndpoint = null;
    lastFailure = null;
    currentInstanceId = null;
    child = null;
    announcedChildren = [];
    stderrTail = [];
    startInFlight = null;
    constructor(options) {
      this.options = options;
      this.runtimeRoot = options.runtimeRoot ?? defaultRuntimeRoot();
      this.fs = options.host.fs;
      this.spawnImpl = options.host.spawn;
      if (options.onStatus) this.listeners.add(options.onStatus);
      if (options.auth === "direct") this.redactor.register(options.directToken);
      let vaultHash = "";
      let configurationFailure = null;
      try {
        if (!normalizeVaultPath(options.vaultPath)) {
          throw new Error("a vault path is required to name this vault's runtime profile");
        }
        vaultHash = vaultScopeHash(options.vaultPath);
      } catch (error) {
        configurationFailure = failure4("record-invalid", this.redactor.redact(String(error?.message ?? error)));
      }
      this.vaultHash = vaultHash;
      this.configurationFailure = configurationFailure;
      this.profileDir = vaultHash ? profileDirFor(this.runtimeRoot, vaultHash) : this.runtimeRoot;
      this.recordPath = vaultHash ? recordPathFor(this.runtimeRoot, vaultHash) : this.runtimeRoot;
      if (configurationFailure) this.lastFailure = configurationFailure;
    }
    /* ------------------------------------------------------------ status -- */
    status() {
      return {
        status: this.configurationFailure ? "degraded" : this.currentStatus,
        endpoint: this.currentEndpoint,
        failure: this.lastFailure,
        owns: this.child !== null
      };
    }
    onStatus(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    /* ---------------------------------------------------------- discover -- */
    async discover() {
      try {
        if (this.configurationFailure) {
          return { status: "degraded", endpoint: null, reason: this.configurationFailure.message };
        }
        const reading = await this.readRecord();
        if (reading.kind === "absent") {
          this.update(null, "offline", null);
          return { status: "offline", endpoint: null, reason: "这个 Vault 还没有运行时记录" };
        }
        if (reading.kind === "invalid") {
          const why = failure4("record-invalid", reading.reason);
          this.update(null, "degraded", why);
          return { status: "degraded", endpoint: null, reason: reading.reason };
        }
        if (reading.record.vaultHash !== this.vaultHash) {
          const why = failure4("record-invalid", "运行时记录属于另一个 Vault");
          this.update(null, "degraded", why);
          return { status: "degraded", endpoint: null, reason: why.message };
        }
        const endpoint = recordToEndpoint(reading.record);
        this.currentInstanceId = endpoint.instanceId;
        if (!this.isAlive(endpoint.pid)) {
          const why = failure4("exited-early", categorySentence("exited-early"), { pid: endpoint.pid });
          this.update(endpoint, "degraded", why);
          return { status: "degraded", endpoint, reason: why.message };
        }
        const health = await this.probe(endpoint.origin);
        if (health.ok) {
          this.update(endpoint, "online", null);
          return { status: "online", endpoint, reason: null };
        }
        this.update(endpoint, "degraded", health.failure);
        return { status: "degraded", endpoint, reason: health.failure.message };
      } catch (error) {
        const why = failure4("record-invalid", this.redactor.redact(String(error?.message ?? error)));
        this.update(null, "degraded", why);
        return { status: "degraded", endpoint: null, reason: why.message };
      }
    }
    /* ------------------------------------------------------------- start -- */
    async start() {
      if (this.startInFlight) return this.startInFlight;
      this.startInFlight = this.runStart().finally(() => {
        this.startInFlight = null;
      });
      return this.startInFlight;
    }
    async runStart() {
      let spawned = null;
      try {
        if (this.configurationFailure) {
          this.update(null, "degraded", this.configurationFailure);
          return fail(this.configurationFailure);
        }
        const existing = await this.liveRecordedEndpoint();
        if (existing) {
          this.currentInstanceId = existing.instanceId;
          this.update(existing, "online", null);
          return ok(existing);
        }
        const launcher = this.options.launcher;
        if (!launcher || typeof launcher.command !== "string" || launcher.command.trim() === "") {
          const why = failure4("runtime-missing", categorySentence("runtime-missing"));
          this.update(null, "offline", why);
          return fail(why);
        }
        const instanceId = this.newInstanceId();
        this.currentInstanceId = instanceId;
        this.announcedChildren = [];
        this.stderrTail = [];
        this.update(null, "starting", null);
        try {
          await this.fs.mkdir(this.profileDir, { recursive: true });
        } catch (error) {
          const why = failure4("profile-unwritable", `${categorySentence("profile-unwritable")}: ${errorCode(error) || "unknown"}`);
          this.update(null, "offline", why);
          return fail(why);
        }
        const handshakeTimeoutMs = this.options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS;
        try {
          spawned = this.spawnImpl(launcher.command, launcher.args ?? [], {
            ...launcher.cwd ? { cwd: launcher.cwd } : {},
            env: {
              ...process.env,
              ...launcher.env ?? {},
              // What the launcher needs to know, and nothing about credentials:
              // in proxy mode there is no token on this side to pass.
              SCHOLARIUM_VAULT_HASH: this.vaultHash,
              SCHOLARIUM_INSTANCE_ID: instanceId,
              SCHOLARIUM_PROFILE_DIR: this.profileDir,
              SCHOLARIUM_PORT_PROTOCOL: "ipc-v1"
            },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
            windowsHide: true,
            detached: false
          });
        } catch (error) {
          const why = failure4("spawn-failed", `${categorySentence("spawn-failed")}: ${this.redactor.redact(String(error?.message ?? error))}`);
          this.update(null, "offline", why);
          return fail(why);
        }
        this.child = spawned;
        this.captureOutput(spawned);
        const handshake = await this.awaitHandshake(spawned, handshakeTimeoutMs, instanceId);
        if (!handshake.ok) {
          await this.discard(spawned);
          this.child = null;
          this.announcedChildren = [];
          this.currentInstanceId = null;
          this.update(null, "offline", handshake.failure);
          this.log(`${handshake.failure.kind}: ${handshake.failure.message}`);
          return handshake;
        }
        const ready = handshake.value;
        const endpoint = ready.endpoint;
        this.announcedChildren = ready.children;
        try {
          await this.writeRecord(endpoint);
        } catch (error) {
          await this.discard(spawned);
          this.child = null;
          this.currentInstanceId = null;
          const why = failure4(
            "profile-unwritable",
            `${categorySentence("profile-unwritable")}: ${this.redactor.redact(String(error?.message ?? error))}`
          );
          this.update(null, "offline", why);
          return fail(why);
        }
        this.watchForExit(spawned, endpoint);
        this.update(endpoint, "online", null);
        this.log(`runtime online at ${endpoint.origin} (pid ${endpoint.pid}, ${endpoint.auth})`);
        return ok(endpoint);
      } catch (error) {
        if (spawned) await this.discard(spawned);
        this.child = null;
        this.currentInstanceId = null;
        const why = failure4("spawn-failed", this.redactor.redact(String(error?.message ?? error)));
        this.update(null, "offline", why);
        return fail(why);
      }
    }
    /* -------------------------------------------------------------- stop -- */
    async stop() {
      try {
        if (this.configurationFailure) {
          this.update(null, "degraded", this.configurationFailure);
          return fail(this.configurationFailure);
        }
        this.update(this.currentEndpoint, "stopping", null);
        const pids = [];
        const owned = this.child?.pid;
        if (typeof owned === "number") pids.push(owned);
        pids.push(...this.announcedChildren);
        const reading = await this.readRecord();
        const record2 = reading.kind === "ok" ? reading.record : null;
        const recordIsOurs = record2 !== null && record2.vaultHash === this.vaultHash && // Either the record names the instance this adapter is running, or this
        // adapter has never run one — the recovery case, where a previous host
        // process left a runtime behind. A record naming a *different* live
        // instance of this vault is not ours to kill.
        (this.currentInstanceId === null || record2.instanceId === this.currentInstanceId);
        if (recordIsOurs && record2) pids.push(record2.pid);
        const report = await this.killTree([...new Set(pids)]);
        const survivors = [...new Set(report.survivors)];
        let recordRemoved = true;
        if (recordIsOurs) {
          try {
            await this.fs.unlink(this.recordPath);
          } catch (error) {
            recordRemoved = errorCode(error) === "ENOENT";
          }
        }
        this.child = null;
        this.announcedChildren = [];
        this.currentInstanceId = null;
        this.currentEndpoint = null;
        if (!report.ok || !recordRemoved) {
          const why = failure4("stop-failed", categorySentence("stop-failed"), {
            pids: pids.join(","),
            survivors: survivors.join(","),
            recordRemoved
          });
          this.update(null, "degraded", why);
          return fail(why);
        }
        this.update(null, "offline", null);
        this.log(`runtime stopped (${report.detail})`);
        return ok({ stopped: true, pids: report.pids, survivors: [] });
      } catch (error) {
        const why = failure4("stop-failed", this.redactor.redact(String(error?.message ?? error)));
        this.update(null, "degraded", why);
        return fail(why);
      }
    }
    /* ----------------------------------------------------------- request -- */
    async request(path2, options = {}) {
      const endpoint = this.currentEndpoint;
      if (!endpoint) return fail(failure4("runtime-missing", categorySentence("runtime-missing")));
      if (!/^\/(?!\/)[^\s]*$/.test(path2)) {
        return fail(failure4("handshake-invalid", "请求路径不合法"));
      }
      const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const headers = { accept: "application/json" };
        if (endpoint.auth === "direct" && this.options.directToken) {
          headers["x-agent-bridge-token"] = this.options.directToken;
        }
        let body;
        if (options.body !== void 0) {
          headers["content-type"] = "application/json";
          body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
        }
        const fetchImpl = this.options.fetch ?? defaultFetch2();
        if (!fetchImpl) return fail(failure4("runtime-missing", "这个宿主没有可用的 fetch 实现"));
        const response = await fetchImpl(`${endpoint.origin}${path2}`, {
          method: options.method ?? "GET",
          headers,
          ...body === void 0 ? {} : { body },
          signal: controller.signal
        });
        const text6 = await response.text();
        if (!response.ok) {
          const reason = this.redactor.redact(bodyError2(text6));
          return fail(failure4("request-failed", reason ? `HTTP ${response.status}：${reason}` : `HTTP ${response.status}`, { status: response.status }));
        }
        if (!text6.trim()) return ok({ status: response.status, data: null });
        try {
          return ok({ status: response.status, data: JSON.parse(text6) });
        } catch {
          return fail(failure4("request-failed", "运行时返回的不是 JSON"));
        }
      } catch (error) {
        const message = this.redactor.redact(String(error?.message ?? error));
        return fail(failure4("request-failed", timedOut ? `请求在 ${timeoutMs} ms 内没有回应` : message));
      } finally {
        clearTimeout(timer);
      }
    }
    /* ---------------------------------------------------------- internals -- */
    isAlive(pid) {
      return (this.options.isAlive ?? isAliveDefault)(pid);
    }
    async probe(origin) {
      const fetchImpl = this.options.fetch ?? defaultFetch2();
      if (!fetchImpl) return fail(failure4("runtime-missing", "这个宿主没有可用的 fetch 实现"));
      const timeoutMs = this.options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(`${origin}${HEALTH_PATH}`, {
          method: "GET",
          // No token: in proxy mode there is none, and in direct mode a health
          // check is exactly the request that should not need one.
          headers: { accept: "application/json" },
          signal: controller.signal
        });
        if (!response.ok) return fail(failure4("exited-early", `HTTP ${response.status}`, { status: response.status }));
        return ok({ status: response.status });
      } catch (error) {
        return fail(
          failure4(
            "exited-early",
            this.redactor.redact(timedOut ? `这个地址在 ${timeoutMs} ms 内没有回应` : String(error?.message ?? error))
          )
        );
      } finally {
        clearTimeout(timer);
      }
    }
    async readRecord() {
      let text6;
      try {
        text6 = await this.fs.readFile(this.recordPath, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return { kind: "absent" };
        return { kind: "invalid", reason: this.redactor.redact(`运行时记录无法读取：${errorCode(error) || "unknown"}`) };
      }
      let parsed;
      try {
        parsed = JSON.parse(text6);
      } catch {
        return { kind: "invalid", reason: "运行时记录不是 JSON" };
      }
      const validated = parseRuntimeRecord(parsed);
      if (!validated.ok) return { kind: "invalid", reason: validated.reason };
      return { kind: "ok", record: validated.value };
    }
    /** The recorded runtime if it is still answering. `null` covers absent,
     * malformed, another vault's, and one that has quietly died — all of which
     * mean "start one" rather than "fail". */
    async liveRecordedEndpoint() {
      const reading = await this.readRecord();
      if (reading.kind !== "ok" || reading.record.vaultHash !== this.vaultHash) return null;
      const endpoint = recordToEndpoint(reading.record);
      if (!this.isAlive(endpoint.pid)) return null;
      const health = await this.probe(endpoint.origin);
      return health.ok ? endpoint : null;
    }
    async writeRecord(endpoint) {
      const record2 = endpointToRecord(endpoint, launcherDigest(this.options.launcher?.command, this.options.launcher?.args ?? []));
      const bytes = serializeRuntimeRecord(record2);
      assertClean(this.redactor, "runtime record", bytes);
      await this.fs.mkdir(this.profileDir, { recursive: true });
      const temp = recordTempPathFor(this.runtimeRoot, this.vaultHash, endpoint.instanceId);
      await this.fs.writeFile(temp, bytes, "utf8");
      await this.fs.rename(temp, this.recordPath);
    }
    captureOutput(child) {
      const capture = (stream) => {
        if (!stream) return;
        stream.on("data", (...args) => {
          const chunk = args[0];
          const text6 = typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
          if (!text6) return;
          for (const line2 of this.redactor.redact(text6).split(/\r?\n/)) {
            if (!line2.trim()) continue;
            this.stderrTail.push(line2.slice(0, 400));
          }
          if (this.stderrTail.length > STDERR_TAIL_LINES) {
            this.stderrTail = this.stderrTail.slice(-STDERR_TAIL_LINES);
          }
        });
      };
      capture(child.stdout);
      capture(child.stderr);
    }
    awaitHandshake(child, timeoutMs, instanceId) {
      return new Promise((resolve) => {
        let settled = false;
        const finish2 = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          finish2(
            fail(
              failure4("handshake-timeout", `${categorySentence("handshake-timeout")}（${timeoutMs} ms）`, {
                stderr: this.stderrTail.join(" | ")
              })
            )
          );
        }, timeoutMs);
        child.on("message", (...args) => {
          const parsed = parseLauncherMessage(args[0], { vaultHash: this.vaultHash, instanceId }, this.redactor.redact);
          if (!parsed.ok) {
            finish2(fail(failure4("handshake-invalid", parsed.reason, { stderr: this.stderrTail.join(" | ") })));
            return;
          }
          const message = parsed.value;
          if (message.kind === "error") {
            finish2(
              fail(
                failure4(LAUNCHER_CODE_TO_KIND[message.code] ?? "spawn-failed", message.message || categorySentence("spawn-failed"), {
                  reported: message.code,
                  stderr: this.stderrTail.join(" | ")
                }, message.exitCode)
              )
            );
            return;
          }
          finish2(ok(message));
        });
        child.on("error", (...args) => {
          const error = args[0];
          const code = errorCode(error);
          finish2(
            fail(
              failure4(code === "ENOENT" ? "runtime-missing" : "spawn-failed", this.redactor.redact(String(error?.message ?? error)), {
                code
              })
            )
          );
        });
        child.on("exit", (...args) => {
          const code = typeof args[0] === "number" ? args[0] : null;
          const signal = typeof args[1] === "string" ? args[1] : null;
          finish2(
            fail(
              failure4("exited-early", categorySentence("exited-early"), { signal: signal ?? "", stderr: this.stderrTail.join(" | ") }, code)
            )
          );
        });
      });
    }
    /** Keep the badge honest after a successful start: a runtime that dies while
     * nobody is watching becomes `degraded`, not a lie. */
    watchForExit(child, endpoint) {
      child.on("exit", (...args) => {
        if (this.child !== child) return;
        const code = typeof args[0] === "number" ? args[0] : null;
        this.child = null;
        this.announcedChildren = [];
        const why = failure4("exited-early", categorySentence("exited-early"), { stderr: this.stderrTail.join(" | ") }, code);
        this.update(endpoint, "degraded", why);
      });
    }
    /** Stop a child this adapter just failed to adopt. Best effort by design: the
     * caller is already returning a failure and must not be turned into a
     * different one by a second failure here. */
    async discard(child) {
      const pid = child.pid;
      if (typeof pid !== "number") return;
      try {
        await this.killTree([pid]);
      } catch {
      }
    }
    async killTree(pids) {
      const timeoutMs = this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
      const injected = this.options.killTree;
      if (injected) return injected(pids, { timeoutMs });
      return terminateAll(pids, { timeoutMs, run: this.options.host.run });
    }
    newInstanceId() {
      if (this.options.randomId) return this.options.randomId();
      return globalThis.crypto.randomUUID();
    }
    log(line2) {
      if (!this.options.log) return;
      this.options.log(this.redactor.redact(line2));
    }
    update(endpoint, status, why) {
      this.currentEndpoint = endpoint;
      this.currentStatus = status;
      this.lastFailure = why;
      const snapshot = this.status();
      for (const listener of [...this.listeners]) {
        try {
          listener(snapshot);
        } catch {
        }
      }
    }
  };
  function isAliveDefault(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === "EPERM";
    }
  }
  function defaultFetch2() {
    const implementation = globalThis.fetch;
    if (typeof implementation !== "function") return null;
    return implementation.bind(globalThis);
  }
  function createRuntimeAdapter(options) {
    return new RuntimeLauncher(options);
  }

  // src/adapters/obsidian/vault-chat-store.ts
  var CHAT_ROOT = "Scholarium/Chat/v1";
  var INDEX_FILE = `${CHAT_ROOT}/index.json`;
  var VaultChatStoreError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "VaultChatStoreError";
      this.code = code;
    }
  };
  var VaultChatStore = class {
    vault;
    now;
    random;
    root;
    index = null;
    /** Set when the cache could not be written. The transcript is intact; this
     * is reported so a caller can rebuild instead of guessing. */
    indexWarning = null;
    constructor(vault, options = {}) {
      this.vault = vault;
      this.now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
      this.random = options.random;
      this.root = options.root ?? CHAT_ROOT;
    }
    get rootPath() {
      return this.root;
    }
    get lastIndexWarning() {
      return this.indexWarning;
    }
    /**
     * 只读校验一个已下载文件是否仍可复用（Pipeline v3 续跑复用前调用）：
     * 存在、≥30KB、头部含 %PDF- 魔数。相对路径按 vault 根解析（与 Bridge
     * 工作区同根的既有约定一致）；绝对路径仅当位于 vault 根之下才转换。
     * 返回 null 表示无法判定（vault 外路径、宿主缺 stat/readBinary、IO
     * 异常），调用方按"可信但记日志"处理，不得据此重下。
     */
    async verifyDownloadedFile(path2) {
      try {
        const adapter = this.vault.adapter;
        if (!adapter.stat || !adapter.readBinary) return null;
        let rel = path2.replace(/\\/g, "/");
        if (/^[a-zA-Z]:\//.test(rel) || rel.startsWith("//")) {
          const base = adapter.getBasePath?.();
          if (!base) return null;
          const root = String(base).replace(/\\/g, "/").replace(/\/+$/, "");
          if (!rel.toLowerCase().startsWith(`${root.toLowerCase()}/`)) return null;
          rel = rel.slice(root.length + 1);
        }
        if (!await adapter.exists(rel)) return false;
        const stat = await adapter.stat(rel);
        if (!stat || stat.size < 3e4) return false;
        const bytes = new Uint8Array(await adapter.readBinary(rel));
        const text6 = new TextDecoder().decode(bytes);
        return text6.slice(0, 1024).includes("%PDF-") && text6.slice(-2048).includes("%%EOF");
      } catch {
        return null;
      }
    }
    /* ------------------------------------------------------------- paths -- */
    /** The scope's folder: `sha256(scopeKey)` truncated to 24 hex characters. A
     * project title with a slash, a colon or an emoji cannot reach the
     * filesystem at all. */
    scopeFolder(scopeKey) {
      return assertInsideRoot(`${this.root}/${scopeHash(scopeKey)}`, this.root);
    }
    /** The cache's path, under this store's own root. */
    get indexPath() {
      return assertInsideRoot(`${this.root}/index.json`, this.root);
    }
    sessionPath(scopeKey, sessionId) {
      return assertInsideRoot(`${this.scopeFolder(scopeKey)}/${assertSessionIdSegment(sessionId)}.jsonl`, this.root);
    }
    /* ------------------------------------------------------------- index -- */
    /**
     * The scope index, from the cache file when it is usable and from a scan
     * otherwise.
     *
     * `index.json` is a cache and is treated as one: missing or unreadable is a
     * reason to rebuild, never a reason to report that a conversation does not
     * exist.
     */
    async readIndex() {
      if (this.index) return this.index;
      try {
        this.index = decodeIndex(await this.vault.adapter.read(this.indexPath));
        return this.index;
      } catch {
        return this.rebuildIndex();
      }
    }
    /** Scan the store and rewrite the cache. Used when the cache is missing, and
     * by a caller that has reason to distrust it. */
    async rebuildIndex() {
      const sessions = [];
      const listing = await this.vault.adapter.list(this.root);
      for (const folder of listing.folders) {
        const scopeFolderName = leafOf(folder);
        const inside = await this.vault.adapter.list(folder);
        for (const file of inside.files) {
          if (!file.endsWith(".jsonl")) continue;
          const path2 = assertInsideRoot(file, this.root);
          const view = parseSessionFile(await this.vault.adapter.read(path2), path2);
          sessions.push(indexEntryFor(summarize(view), scopeFolderName, path2.slice(this.root.length + 1)));
        }
      }
      const index = {
        schema: SCHEMA,
        version: 1,
        generatedAt: this.now(),
        sessions: newestFirst(sessions)
      };
      this.index = index;
      await this.writeIndex(index);
      return index;
    }
    async writeIndex(index) {
      try {
        await this.ensureFolder(this.root);
        await this.vault.adapter.write(this.indexPath, `${JSON.stringify(index, null, 2)}
`);
        this.indexWarning = null;
      } catch (error) {
        this.indexWarning = error instanceof Error ? error.message : String(error);
      }
    }
    /** Archived sessions are left out unless asked for, matching the Bridge
     * route's `includeArchived` flag. */
    async listSessions(scopeKey, options = {}) {
      const index = await this.readIndex();
      const wanted = scopeHash(scopeKey);
      return newestFirst(
        index.sessions.filter((entry) => entry.scopeHash === wanted).filter((entry) => options.includeArchived === true || !entry.archived).map(summaryOfEntry)
      );
    }
    /** The conversation a scope opens on: the most recently updated one. */
    async latestSession(scopeKey, options = {}) {
      return (await this.listSessions(scopeKey, options))[0] ?? null;
    }
    /* ---------------------------------------------------------- sessions -- */
    /**
     * Create the session file, or return the one already stored under the same
     * id.
     *
     * Idempotent on purpose: a caller that created a file and crashed before it
     * learned the id must be able to retry without forking the conversation.
     */
    async createSession(input) {
      const scopeKey = input.scope.scopeKey;
      const sessionId = input.sessionId ?? (this.random ? newSessionId(this.random) : newSessionId());
      const path2 = this.sessionPath(scopeKey, sessionId);
      if (await this.vault.adapter.exists(path2)) {
        return { view: await this.readSession(scopeKey, sessionId), created: false };
      }
      const header = {
        v: 1,
        schema: SCHEMA,
        type: "session",
        sessionId,
        scopeKey,
        topicId: input.scope.topicId,
        projectId: input.scope.projectId,
        title: input.title?.trim() || "未命名课题",
        createdAt: this.now()
      };
      await this.ensureFolder(this.scopeFolder(scopeKey));
      await this.vault.create(path2, serializeHeader(header));
      const view = mergeEvents([header], { file: path2 });
      await this.remember(summarize(view), path2);
      return { view, created: true };
    }
    /** The whole transcript. A damaged file throws — with its name and the line —
     * rather than returning the part that happened to decode. */
    async readSession(scopeKey, sessionId) {
      const path2 = this.sessionPath(scopeKey, sessionId);
      if (!await this.vault.adapter.exists(path2)) {
        throw new VaultChatStoreError("SESSION_NOT_FOUND", `session not found: ${sessionId}`);
      }
      return parseSessionFile(await this.vault.adapter.read(path2), path2);
    }
    /** One page, oldest-first. The window is taken from the whole file, so
     * `total` is the conversation's real length and paging never truncates it. */
    async readPage(scopeKey, sessionId, options = {}) {
      const view = await this.readSession(scopeKey, sessionId);
      return { session: summarize(view), page: pageMessages(view.messages, options) };
    }
    /**
     * Append one message.
     *
     * Read-then-append is not a race here: the plugin is the only writer of this
     * file, and the duplicate check needs the file's ids anyway. An id already
     * present is a no-op, so a retry after an unacknowledged write cannot double
     * a turn.
     */
    async appendMessage(scopeKey, sessionId, message) {
      const view = await this.readSession(scopeKey, sessionId);
      if (view.messages.some((existing) => existing.messageId === message.messageId)) {
        return {
          result: { appended: [], duplicates: [message.messageId], total: view.messages.length },
          summary: summarize(view),
          view
        };
      }
      const path2 = this.sessionPath(scopeKey, sessionId);
      await this.vault.adapter.append(path2, serializeMessage(message));
      const next = withEvent(view, message, path2);
      const summary = summarize(next);
      await this.remember(summary, path2);
      return { result: { appended: [message.messageId], duplicates: [], total: summary.messageCount }, summary, view: next };
    }
    /** Append a state change. Archiving never moves, rewrites or deletes a line
     * of the body: it adds one, and the merge decides what it means. */
    async appendState(scopeKey, sessionId, state) {
      const view = await this.readSession(scopeKey, sessionId);
      const path2 = this.sessionPath(scopeKey, sessionId);
      await this.vault.adapter.append(path2, serializeState(state));
      const next = withEvent(view, state, path2);
      const summary = summarize(next);
      await this.remember(summary, path2);
      return { summary, view: next };
    }
    /**
     * Append one confirmation state change — the claim, or the outcome.
     *
     * Idempotent on `eventId`, for the same reason messages are idempotent on
     * `messageId`: "claim, then execute" means a claim whose acknowledgement was
     * lost gets retried, and a retried claim must not become two claims.
     *
     * That is the whole of the claim this file makes. Whether a *dispatch* is
     * idempotent is the executor's business, keyed by `operationId` in
     * `operations.jsonl`, and it is not uniform across kinds: per contract §2.3
     * the `run` kind has the claim lock and no endpoint-level idempotency at all,
     * so nothing here may be read as promising a replay-safe `run`.
     */
    async appendConfirmation(scopeKey, sessionId, event) {
      const view = await this.readSession(scopeKey, sessionId);
      if (view.confirmations.events.some((existing) => existing.eventId === event.eventId)) {
        return { appended: false, summary: summarize(view), view };
      }
      const path2 = this.sessionPath(scopeKey, sessionId);
      const next = withEvent(view, event, path2);
      await this.vault.adapter.append(path2, serializeConfirmation(event));
      const summary = summarize(next);
      await this.remember(summary, path2);
      return { appended: true, summary, view: next };
    }
    /* ----------------------------------------------------------- plumbing -- */
    async remember(summary, path2) {
      const index = await this.readIndex().catch(() => null);
      const entry = indexEntryFor(summary, scopeHash(summary.scopeKey), path2.slice(this.root.length + 1));
      const sessions = (index?.sessions ?? []).filter((existing) => existing.sessionId !== summary.sessionId);
      sessions.push(entry);
      const next = { schema: SCHEMA, version: 1, generatedAt: this.now(), sessions: newestFirst(sessions) };
      this.index = next;
      await this.writeIndex(next);
    }
    async ensureFolder(path2) {
      const segments = path2.replace(/\\/g, "/").split("/").filter(Boolean);
      let current = "";
      for (const segment of segments) {
        current = current ? `${current}/${segment}` : segment;
        if (!await this.vault.adapter.exists(current)) await this.vault.createFolder(current);
      }
    }
  };
  function leafOf(path2) {
    return path2.replace(/\\/g, "/").split("/").pop() ?? "";
  }
  function newestFirst(entries) {
    return [...entries].sort((a, b) => a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);
  }
  function assertInsideRoot(path2, root) {
    const normalized = path2.replace(/\\/g, "/");
    const segments = normalized.split("/");
    const escaped = normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("//") || /[\u0000-\u001f]/.test(normalized) || segments.some((segment) => segment === "" || segment === "." || segment === "..");
    if (escaped || !(normalized === root || normalized.startsWith(`${root}/`))) {
      throw new VaultChatStoreError("PATH_ESCAPED", `session path escaped the chat store root: ${JSON.stringify(path2)}`);
    }
    return normalized;
  }
  function assertSessionIdSegment(sessionId) {
    if (!/^s-[a-z0-9]{4,16}-[0-9a-f]{8}$/.test(String(sessionId ?? ""))) {
      throw new VaultChatStoreError("PATH_ESCAPED", `unsupported session id: ${JSON.stringify(sessionId)}`);
    }
    return sessionId;
  }
  function decodeIndex(text6) {
    const parsed = JSON.parse(text6);
    if (!parsed || parsed.schema !== SCHEMA || !Array.isArray(parsed.sessions)) {
      throw new VaultChatStoreError("INVALID_INDEX", "the chat index is not a scholarium-chat/1 index");
    }
    return {
      schema: SCHEMA,
      version: 1,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : "",
      sessions: parsed.sessions
    };
  }
  function indexEntryFor(summary, hash, relativeFile) {
    return {
      sessionId: summary.sessionId,
      scopeKey: summary.scopeKey,
      scopeHash: hash,
      file: relativeFile,
      title: summary.title,
      createdAt: summary.createdAt,
      updatedAt: summary.updatedAt,
      messageCount: summary.messageCount,
      archived: summary.archived,
      firstAt: summary.firstAt,
      lastAt: summary.lastAt
    };
  }
  function summaryOfEntry(entry) {
    const [kind, ...rest] = entry.scopeKey.split(":");
    const id = rest.join(":");
    return {
      sessionId: entry.sessionId,
      scopeKey: entry.scopeKey,
      topicId: id,
      projectId: kind === "project" ? id : null,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      messageCount: entry.messageCount,
      archived: entry.archived,
      firstAt: entry.firstAt,
      lastAt: entry.lastAt
    };
  }

  // src/features/chat/research-chat-core.ts
  function clean3(value) {
    return String(value || "").trim();
  }
  function conversationExcerpt(messages, currentMessage, maxTurns = 14, maxChars = 14e3) {
    const current = clean3(currentMessage);
    const eligible = (Array.isArray(messages) ? messages : []).filter((item) => item && (item.role === "user" || item.role === "agent")).filter((item, index, list4) => !(index === list4.length - 1 && item.role === "user" && clean3(item.text) === current)).slice(-maxTurns).map((item) => `${item.role === "user" ? "研究员" : "织研者"}：${clean3(item.text)}`).filter((line2) => !/：$/.test(line2));
    const selected = [];
    let used = 0;
    for (let index = eligible.length - 1; index >= 0; index--) {
      const line2 = eligible[index];
      if (selected.length && used + line2.length > maxChars) break;
      selected.unshift(line2);
      used += line2.length;
    }
    return selected.join("\n\n");
  }
  function researchQuestionCoachProtocol() {
    return `研究问题教练协议（当研究员在形成问题、假设或课题时启用；普通事实问题仍直接回答）：
- 先描述现象，再讨论归因；区分 What（发生什么）、Why（为何发生）、How（如何调控）。
- 从多个开放问题发散，但每轮最终只推进一个核心问题；开放问题用于探索，封闭问题用于验证。
- 持续维护课题骨架：对象/体系、变量或处理、对照、可量化结果、时间或稳定性边界、候选机理、混杂因素、资源约束、意义与受众。
- 用领域适配的 PICOT 补全“对象—处理—对照—结果—时间”，再用 FINER 检查可行、有趣、新颖、伦理/安全和相关性。新颖性必须经针对性检索，不能凭措辞判断。
- 把直觉写成“如果 X，那么在 Z 条件下 Y”的可证伪假设；说明反证结果、零结果和可信的第三种解释。列出最多 5 个“我可能错了”的原因，并优先设计最有判别力的验证。
- 追问“然后呢、谁在乎、答案会改变什么决定”，形成二阶/三阶贡献，而不只追求性能提高。
- 每轮只问 1–3 个会改变课题走向的高信息问题；信息足够时先给暂定版本，不连续抛清单审问研究员。
- 教练模式下，每轮末尾给出简短“当前课题骨架”：已确认、待验证假设、尚缺信息、下一项决策。不要把未确认建议写成事实。
- 只有当问题能用一句话表达、允许被否定、三个月后仍值得关心、有明确受众、且初步检索未发现大量完全相同工作时，才称为基本成形。
- 最终共同形成一页课题声明：核心问题、重要性、假设、变量与对照、指标、反证标准、可行性风险、新颖性证据和下一步。`;
  }
  var PROMPT_CHAR_BUDGET = 12e4;
  function chemistryRigorProtocol() {
    return `化学严谨性协议（涉及分子、反应式、配平、机理或化学结构时强制执行）：
- 先区分“结构表示”和“化学方程式”：Ketcher/SMILES/RXN 只是表示法，画出来或能解析不等于反应真实、方程式已配平，也不等于机理成立。
- 反应式审查顺序固定为：确认每个物种的身份与来源 → 明确反应物/产物边界（溶剂、催化剂、条件和旁观离子不能悄悄当成产物）→ 解析完整结构与分子式 → 逐元素核对原子数 → 核对净电荷；涉及氧化还原时再核对电子/氧化数，涉及离子或配位物时核对价态与配位数。
- 只有左右两侧每种元素和净电荷都相等、结构的价态/芳香性/键级可被化学工具解析、且所有物种都有可追溯来源，才能称为“已验证/已配平”。缺少副产物、H+/OH−、H2O、电子、气体或相态信息时，必须标为“方程式不完整/待核验”，不能用视觉上好看的系数掩盖。
- 系数必须化为最小整数比，并同时给出人类可读的规范方程式。RXN/SMILES 中重复物种只是编码系数的办法；Ketcher 可能把重复物种画成多个独立图形，不能把图形数量直接当作已显示的系数。
- 需要写入反应式时，先调用只读 \`experiment.validate_chem\`；只有返回 \`valid: true\` 且 \`status: balanced\`，才可提交 \`experiment.insert_chem\` 并传 \`strict_validation: true\`。返回 \`unbalanced\`、\`invalid\` 或 \`unavailable\` 时禁止写入反应式，改用 \`experiment.append_note\` 记录待核验文字。
- 不得从截图、名称、反应箭头或“常见反应”反推缺失结构、产物、系数、条件或机理。结构不确定时先追问或只写文字描述；不得编造 SMILES、molfile、分子式或“守恒已通过”。
- 研究员要求写入实验记录时：仅写入来源明确的结构；对尚未完成上述检查的内容使用“待核验”措辞，并在回答中列出缺失物种/守恒项/验证工具，不得把未验证结构写成最终化学结论。`;
  }
  var TRUNCATION_NOTICE = "\n…（超出本轮长度预算，以上内容已截断；完整数据可通过上方能力清单里的只读端点重新查询）";
  var DROPPED_BLOCK_NOTICES = [
    "【此前对话：本轮因长度预算未加载】不得把本轮误判为会话第一条消息，也不得触发仅限首轮的全量回扫。",
    "【项目状态：本轮因长度预算未加载】不得据此断言任何 PRJ/HYP/EXP 不存在、未找到或处于某种状态；需要时必须用能力清单中的只读端点重新查询。",
    "【长期记忆：本轮因长度预算未加载】不得把未加载解释为没有既有记忆。",
    "【文献命中：本轮因长度预算未加载】不得把未加载解释为没有相关文献。"
  ];
  function fitCompressibleBlocks(blocksByPriority, budget, overheadChars) {
    let remaining = Math.max(0, budget);
    return blocksByPriority.map((text6, index) => {
      if (!text6) return "";
      const overhead = overheadChars && overheadChars[index] || 0;
      const droppedNotice = DROPPED_BLOCK_NOTICES[index] || "【上下文块：本轮因长度预算未加载】不得把未加载解释为不存在。";
      const futureReserve = blocksByPriority.slice(index + 1).reduce((sum, future, futureOffset) => {
        if (!future) return sum;
        const futureIndex = index + futureOffset + 1;
        const notice = DROPPED_BLOCK_NOTICES[futureIndex] || "【上下文块：本轮因长度预算未加载】不得把未加载解释为不存在。";
        return sum + notice.length + (overheadChars && overheadChars[futureIndex] || 0);
      }, 0);
      const spendable = Math.max(0, remaining - futureReserve);
      if (text6.length + overhead <= spendable) {
        remaining -= text6.length + overhead;
        return text6;
      }
      const room = spendable - overhead;
      const kept = room > TRUNCATION_NOTICE.length + 200 ? text6.slice(0, room - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE : droppedNotice;
      remaining = Math.max(0, remaining - kept.length - overhead);
      return kept;
    });
  }
  function buildResearchChatPrompt(input = {}) {
    const history = conversationExcerpt(input.messages, input.message);
    const taskGoal = clean3(input.taskGoal) || "尚未填写；从对话中识别当前研究问题。";
    const workspace = clean3(input.workspace) || "未设置";
    const message = clean3(input.message);
    const ragBlock = clean3(input.ragBlock);
    const memoryBlock = clean3(input.memoryBlock);
    const projectBlock2 = clean3(input.projectBlock);
    const capabilities = clean3(input.capabilities);
    const render2 = (historyText, projectText, memoryText, ragText) => `你是“织研者”，研究员的对话式科研合作者。你不是固定流程修改器，也不是看到问题就启动批量 Pipeline 的调度器。

课题目标：${taskGoal}
工作区：${workspace}

此前对话（这是本轮推理上下文；新信息与旧判断冲突时，必须明确修正旧判断）：
${historyText || "暂无此前对话。"}

研究员本轮问题：
${message}

工作协议：
1. 先回答研究员真正问的问题。延续上下文，识别本轮是在补充条件、质疑旧结论、切换子问题，还是授权执行；不要把每句话当成孤立的新任务。
2. 先提出当前最可能解释，同时列出关键替代解释和能区分它们的证据。用户补充材料、配体、pH、温度、时间或现象后，重新排序假设；若判断改变，要直说“基于新信息，我修正上一轮判断”。
3. 只在准确回答确实需要外部事实时做针对性检索。先从一个短而明确的检索问题开始，查看真实标题/摘要；不足时一次只增加一个概念。不要用超长 Boolean 式代替推理，不要把低相关记录批量下载。
4. 精确晶格常数、投料量、峰位、性能数字、DOI 或实验步骤必须核查来源。区分“全文已核实”“摘要/元数据支持”“机理推断”“待验证假设”；来源缺失时如实说明，不能补造。
5. 默认对话路径是：直接分析 → 必要时小范围检索 → 检查少量候选 → 必要时读取关键全文 → 回答。只有研究员明确要求系统综述、批量检索或运行完整链条时，才建议或启动文献 Pipeline。
6. 回答以结论或当前判断开头，随后解释证据链、替代解释和最有判别力的验证方法。格式随问题自然变化，不要机械套模板；信息不足但不妨碍给出条件化判断时，先回答再说明需要补充什么。
7. 讨论不等于写入。只有研究员明确要求保存、更新或执行时，才提出 Scholarium 修改请求，并等待确认。不得把“找到线索”说成“已验证”，不得把“提交请求”说成“已经写入”。
8. 可以指出研究员或你先前判断中的化学、统计或证据问题。优先追求可证伪、可复现和诚实的不确定性，而不是迎合已有结论。
9. 涉及化学结构或反应式时，必须执行下方“化学严谨性协议”；若不能完成守恒、结构有效性和来源核验，只能给条件化判断并明确标为待核验，不得把 Ketcher 的图形排版当作验证结果。
9. 下方“项目长期记忆”来自工作区 .scholarium/agent/，是你跨会话的记忆：延续其中的目标、决策与上次检查点，不要当成空白开始。你不能直接改这些文件；当本轮产生了值得长期保留的决策、证据或经验时，在回复末尾明确建议“建议记入 decisions/evidence-ledger/lessons：<一句话>”，由研究员确认后保存。
10. 执行任何检索/下载/提取类任务时，遵循 playbook 的五步循环（思考→决策→调用→观察→迭代）：每拿到一次工具返回就重新评估，而非按原定计划一条路走到黑；优先走 fallback 链（失败先判“环境问题还是逻辑问题”，再换链的下一项或换工具）；先小步验证再批量放大；不确定时诚实说明卡点并给手动路径。
11. 当研究员明确要求把实验设计、假设、文献笔记等保存为正式记录时，不要自己写文件。在回复末尾输出一个 \`\`\`scholarium-draft 围栏块，内容是 JSON：单文件用 {“path”:”相对路径/实验标题.md”,”content”:”完整 Markdown”,”reason”:”一句话”,”open_after_commit”:true}；多文件用 {“items”:[{...},{...}],”open_after_commit”:true}。frontmatter 只写记录类型与科研内容字段；uid、display_id、schema_version、project_uid、创建/更新时间、AI 草稿状态均由 Bridge 从当前绑定课题与 Vault 实况生成或覆盖，模型给出的同名值不会被信任。HYP 的 confidence/confidence_set_by 与 EXP 的 data_origin/data_recorded_by/data_recorded_at 属于研究员声明，Bridge 会从 AI 草稿中强制移除；把相关判断如实写进正文即可。EXP 正文会在预览时统一为“实验方案与过程→数据来源→结果→结论”模板，模型只需把真实方案写清楚，不要伪造空结果或来源声明。EXP 的 tests_hypotheses 引用已有 HYP 时只用 project.get/experiment.scan_outcomes 返回的真实 uid；同一批新建 HYP+EXP 时，可给 HYP item 加 "ref":"hyp-1"，并在 EXP 的 tests_hypotheses 中写 "draft:hyp-1"，Bridge 会在预览时替换为服务端生成的真实 uid。精确文献数字、DOI、反应计量和“从未报道”等判断必须已核验，否则在正文中标为待核验。确认卡片只出现在该条回复下方；研究员点击「确认写入」后才落盘。只能说“已生成待确认请求”，不得声称“已保存/已写入”。
12. 研究员要求把具体安排”写入工作台”、”排进日程”，或让你”设计一天/一周的实验安排”时：
    - 先判断这是有具体时间点的日程，还是一件没有时间属性的待办——前者用 workspace.timeblock_add（每条必须带 date/start/end），后者才用 workspace.task_add；不要把有时间意图的安排写成不带时间的任务，研究员看不到你排的时间就等于没排。
    - 研究员只给了”做什么”、没给具体日期时间时，不要直接编造一个时间硬填进 timeblock_add——按当前”今天”日期与常识产出一版合理排期（比如制样、表征、测试分几天，每步给出时长和先后顺序），并在正文里说明这是你安排的，请研究员确认或调整。
    - 研究员要你”根据课题设计”或”自主设计”实验（尤其是要排一天/一周这种多步安排）时，先用只读端点查 project.get（必要时加 experiment.scan_outcomes）取当前课题的假设状态、已有实验结果和未决问题，把安排建立在这些真实记录上，不要脱离课题现状凭通用科研常识排。安排里每一步要能说清楚它对应哪个假设或哪个待验证问题，步骤之间的先后关系（如制样先于表征、表征先于性能测试）要体现在 date/start/end 的顺序里。
    - 这段时间是在为某个已存在的 EXP-00X 做事时，timeblock_add/update 必须带 experiment_uid（或人类可读的 experiment_display_id，会被服务端解析）做正式关联——这是唯一会被系统读取用来判断”这块时间对应哪个实验”的字段，写进 note 里的 "对应 EXP-007" 只是给人看的一句话，不产生关联，事后也没法用来做漂移检查。哪个 EXP 还没定下来时，宁可不关联。
    - 一次回复里可以给出覆盖多天的多个 workspace.timeblock_add 块，不必要求研究员一步步来。给出安排后仍遵守规则 7：这是”已提交修改请求”，不是”已经排好”，确认权在研究员手里。
13. 若下方有“项目状态（Bridge L0 实读）”，它是本轮关于 HYP/EXP/PRJ 是否存在、状态和关联的唯一项目事实源；不得用工作目录下的局部 Glob/Grep 覆盖它。若状态标为“未验证”，只能说“未验证”，不得断言“未找到”或“不存在”。其中的“时间块↔实验漂移检查”是同一唯一事实源的一部分：标为“本轮未读取”时不得断言当前没有漂移；列出具体条目时，凡 blocked/unreviewed 的实验都不得视为”可以按计划执行”，需要在回复里如实指出；unbackfilled 条目说明日期已经过了，但从来没人说过这块时间实际发生了什么——这是最基础、最该先问的一类：研究员来聊天时，如果本轮问题和这块时间/这个实验相关，主动问一句"这个安排完成了吗"，不要假装没看见。stale 条目更进一步：已经回填过执行状态（有人说了完成/未完成/被阻塞），但实验记录本身没有推进——这是要报告给研究员的执行落差，不是需要你去掩饰或替研究员找借口的问题，也不是你自己能补的，需要研究员决定是否该更新实验记录。新增指向某个 EXP 的时间块前，若这次对话没有更新的漂移信息，建议用 workspace.timeblock_drift_audit 现查一次再决定。project.get 返回里的 decisions 数组是这个课题已经落盘的正式决策——讨论排期或下一步前，先看有没有相关的 active 决策（比如"这个实验本周不排"），不要在不知情的情况下建议一个和已有决策冲突的安排；如果发现某条决策的 trigger_condition 现在已经满足，在回复里指出来，不要自己去改那条记录。project.get 返回里的 lessons 数组是已经研究员确认过的经验（见规则17）——给建议、排期或诊断问题前，先看有没有相关的 active 经验，引用它的 statement 和 scope 时要连 scope 里写的适用边界一起说，不要断章取义成一条无条件成立的规律。
14. 执行回填——研究员告诉你某个已排期、关联了 EXP 的时间块"做完了/没做/被卡住了"（不管是你主动问的，还是研究员自己提的）：
    - 先用 workspace.timeblock_update 写回这块时间的最小事实：{id, execution_status: "completed"|"not_completed"|"blocked", execution_note}——execution_note 写研究员实际说的情况（数据、原因、卡在哪），不要编造细节，研究员没说的就不写。execution_status 必填；不确定该选哪个就直接问，不要猜。
    - 若研究员说的内容构成一条值得记进实验记录的观察（不管完成、没完成还是被阻塞，都算——"没做"和"卡住"本身就是有信息量的记录），额外输出一个 experiment.append_note {experiment_uid, text} 把这条观察追加进实验的日志；这一步几乎总该做，因为它是纯追加、不改状态，风险最低。
    - 若研究员的话明确构成一次状态判断（不只是"做完了"，而是"这批数据够了，可以往下推进"这类），输出 experiment.transition {experiment_uid, to_status, reason}——2026-08-27 起这条通道已经接通（走 /v1/edits 两阶段确认，不经 Obsidian 队列）。to_status 只能是生命周期里紧挨着当前状态的下一步（idea→designed→ready→running→data_pending→analyzing→concluded→integrated，一次只能走一步，不能跳级）；reason 必填，写清楚"为什么现在推进"，不要留空或写套话。不确定当前状态或研究员的话是否够格构成一次正式的状态判断时，宁可只做 append_note 附加观察、在正文里问一句"要不要把 EXP-00X 推进到 running"，不要替研究员做这个决定。这仍然只是"已提交修改请求"，确认权在研究员手里，遵守规则 7。
    - provenance 审计不是普通状态推进。只有研究员在本轮明确把某条 EXP 判定为 simulated / demonstration，或明确说已完成追溯但无法核实（unverifiable），并要求撤出正式研究链时，才可输出 experiment.invalidate_provenance {experiment_uid, data_origin, reason, data_provenance_note}。文件搜索、Agent 推断、DEC 中的待确认建议都不能替代研究员声明。该动作会在二阶段确认后把 Experiment 置为 invalidated、同步降级其 Evidence、撤出 Hypothesis 关系并写恢复快照；不要再额外输出 experiment.transition 或手工修改其中任何一端。
    - 一次回复可以同时输出多个动作块（timeblock_update + append_note），面板会作为一批展示，研究员一次性确认。仍然遵守规则 7：这是"已提交修改请求"，不是"已经写回"。
15. 研究员把某个结论、判断或安排定为最终结果时（比如"这个实验这周先不排了""就这么定""记一条决策"），在回复末尾输出一个 \`\`\`scholarium-draft 围栏块，把它写成 decision 记录（复用规则 11 的两段式确认）。frontmatter 的科研内容必须包含 type: decision、title（一句话标签）、decision（决策本身）、rationale（依据，不得为空）；relates_to 可选，只放项目状态中确实存在的对象 uid，不得编造对象、uid、依据或研究员没有作出的决定；trigger_condition 可选，没有就不写。身份、编号、课题关联与审计字段全部交给 Bridge。这条记录走 Research/Decisions/，同一批可以和 Q/H 草稿一起提交。
16. 全量回扫（M4）——若上方"此前对话"是"暂无此前对话"（本轮是这次会话的第一条消息），先用只读端点调用一次 workspace.rescan_pending（不带 project_uid，扫全库，不限于本轮是否绑定了课题）。返回里的 due 是唯一判据，不要自己算日期：
    - due 为 false：距上次提醒还没到节流周期（返回里的 cadence_days，由研究员在 bridge.config.json 配置，默认每天最多一次），什么都不做，也不要在正文里提这件事。
    - due 为 true：再调用 workspace.get_state {"section":"tasks"} 看现有任务里已经出现过哪些 RESCAN-TB:<id> / RESCAN-DEC:<uid> 标记——这些是之前已经提议过的，不要重复生成。对剩下真正新出现的条目，按 blocked/unreviewed 优先、其次 unbackfilled、再 stale、最后决策触发条件排序，最多挑 8 条，各输出一个 workspace.task_add {title, note}，note 里原样带上对应 marker（例如 "RESCAN-TB:tb-xxx · unbackfilled：日期已过未回填"），这样下一次回扫才能认出它、不再重复提议。做完提议（哪怕去重后一条新的都没有）之后，必须用只读端点打一次 GET .../v1/scholarium/rescan-checkpoint-mark（具体地址见下方能力清单）重置节流计时——这一步不需要研究员确认，只是记"什么时候查过"，不改任何研究记录；漏掉这一步下次还是会判定 due，节流失效。这个端点只在 due 为 true 这一分支里才允许调用。
    这一步只在会话第一条消息时尝试一次，不要每轮重复触发；这批任务和研究员当前问题无关也可以照常提议——它们是对"整体待确认清单"的主动汇报，遵守规则 7：仍是"已提交请求"，需研究员在工作台确认。
17. 经验候选提取（M5 步骤1）——这一步只在研究员明确要求总结经验/规律/共性问题时才做（比如"这类实验有什么共性问题""总结一下最近的经验教训""有没有什么规律"），不要在没人问的时候主动提炼，也不要挂在规则16的会话首条消息回扫里一起做——回扫是"有没有漏掉的事实性待办"，这一步是"从事实里提炼出解释性判断"，判断比事实更容易出错，必须等研究员主动要，不能自己决定研究员现在需要一条经验总结。
    - 证据来源只有三类：workspace.get_state {"section":"timeblocks"} 里的执行回填记录（executionStatus/executionNote，看有没有反复出现的完成/受阻模式）、workspace.rescan_pending 或 workspace.timeblock_drift_audit 的漂移条目、decision.list 或 project.get 里的 decisions（一条决策本身已经是研究员深思过的判断，可以单独作为经验来源；执行回填和漂移条目不算——同一现象只出现一次就写经验草稿，几乎总是把巧合当规律，至少要能指出两条独立的时间块/实验记录里出现同样的模式才够格；找不到第二条独立证据时，直接告诉研究员"目前只看到一次，样本不够，还不构成经验"，不要硬凑一条草稿。
    - 有了够格的证据后，在回复末尾输出一个 \`\`\`scholarium-draft 围栏块，写成 lesson 记录（复用规则 11/15 的两段式确认）。frontmatter 的科研内容必须包含：type: lesson，title（一句话标签），statement（经验本身，说清楚"在什么情况下会发生什么"），scope（适用边界，不确定时宁可写窄），evidence_summary（可复核的证据说明），evidence_refs（真实对象 uid 数组，不能引用 timeblock id），source_types（只能取 execution_backfill / drift_audit / decision）。身份、编号与审计字段交给 Bridge；当前通道不会让模型自行声明 project_uid，因此课题限定必须明确写进 scope。这条记录走 Research/Lessons/。
    - 这条经验候选被确认写入后，不代表你可以据此改变后续的排期/建议策略——它和其它已确认记录一样，只是给研究员看的一份可复核参考；规则13已经讲了怎么在给建议前先看 project.get 的 lessons 数组，照做即可，不要因为"自己刚提出过这条经验"就在后续对话里把它当成不言自明的前提反复强化。

${chemistryRigorProtocol()}

${researchQuestionCoachProtocol()}

${capabilities}
${projectText ? `
${projectText}
` : ""}
${memoryText ? `
${memoryText}
` : ""}${ragText ? `
${ragText}
` : ""}
请用中文自然回复，专业但像持续合作的科研伙伴。不要因为没有立即检索就拒绝讨论，也不要用“请运行 Pipeline”逃避本可直接完成的分析。不要使用 emoji。`;
    const fixedLength = render2("", "", "", "").length;
    const [fittedHistory, fittedProject, fittedMemory, fittedRag] = fitCompressibleBlocks(
      [history, projectBlock2, memoryBlock, ragBlock],
      PROMPT_CHAR_BUDGET - fixedLength,
      [0, 2, 2, 2]
    );
    return render2(fittedHistory, fittedProject, fittedMemory, fittedRag);
  }
  function projectContextBlock(projectId, project, outcomes, error = "", drift = null) {
    if (!projectId) return "【项目状态：未验证】当前聊天尚未显式绑定 schema-v1 课题。不得断言任何 HYP/EXP/PRJ 记录不存在；请研究员在“关联课题”中选择后再判断。";
    if (error || !project) return `【项目状态：未验证】已绑定 ${projectId}，但本轮 Bridge L0 读取失败${error ? `：${clean3(error).slice(0, 240)}` : ""}。不得断言任何记录不存在。`;
    const driftLine = drift ? Array.isArray(drift.findings) && drift.findings.length ? `

【时间块↔实验漂移检查（Bridge L0 实读）】
${JSON.stringify(drift.findings).slice(0, 6e3)}` : "\n\n【时间块↔实验漂移检查（Bridge L0 实读）】本课题当前没有已关联实验的时间块存在漂移。" : "\n\n【时间块↔实验漂移检查：本轮未读取】";
    return `【项目状态（Bridge L0 实读）】
绑定课题：${projectId}
project.get 返回：
${JSON.stringify(project).slice(0, 12e3)}

experiment.scan_outcomes 返回：
${JSON.stringify(outcomes || {}).slice(0, 6e3)}${driftLine}`;
  }
  function laneCapabilities(adapterId) {
    if (adapterId === "claude-research") {
      return `你当前在「科研车道」（claude-research）：可以使用 WebSearch、WebFetch，并可通过受限 mcp__scholarium__* 工具搜索/读取 Vault 安全文本；没有 Bash、PowerShell、Write 或 Edit。读取本机 Scholarium/Obsidian 时必须优先使用受限 MCP，禁止用 WebFetch、curl 或猜测 localhost 端口访问本机 Bridge。凡涉及文献、DOI、配方、实验数据的问题，必须联网核查真实来源（OpenAlex/Crossref/WebSearch），不允许只凭本地文献库或记忆作答；本地库命中只作补充。`;
    }
    if (adapterId === "codex") {
      return `你当前的适配器（codex）没有网络访问能力（沙箱禁网），只能使用本地文件与文献库。若问题需要联网核查（文献、DOI、最新数据），在回答开头明确说明"当前车道无法联网，以下仅基于本地库"，并建议研究员改用 claude-research 车道重问。`;
    }
    return "";
  }
  function scholariumCapabilities() {
    return `你可以直接读取和操作研究员的 Scholarium 插件（Obsidian 里的科研管理系统）。

【读取：立即执行】对任何"库里有什么/我的日程/订阅文章评分"类问题，使用 mcp__scholarium__scholarium_state（参数 action 与 input）拿真实数据再回答，不要凭记忆编造。要查整个 Obsidian 仓库中的文件，使用 mcp__scholarium__vault_search；要读取命中的文本文件，使用 mcp__scholarium__vault_read。MCP 是本地只读控制通道，不依赖 localhost WebFetch，也不需要 Bash/PowerShell。
可用读取动作：
- workspace.get_state —— 博士工作台。input {"section":"timeblocks|checkin|tasks|captures|focus|habits|emotions|..."} 取某分区；不带 input 返回各分区摘要。
- material.list —— 素材库全部条目和分类。
- project.list / project.get —— 课题列表 / 单个课题（input {"display_id":"PRJ-001"}）。
- experiment.scan_outcomes —— 实验记录扫描（拿 experiment_uid）。
- workspace.timeblock_drift_audit —— 时间块↔实验正式关联的漂移检查（input 可选 {"project_uid":"..."} 限定课题）。返回每条已关联时间块的 flags：orphaned（关联的实验记录已不存在）、blocked（实验仍有未清 blocked_by）、unreviewed（review_status 不是 confirmed）、unbackfilled（日期已过但从没人回填过 execution_status——最基础的一类，该主动问）、stale（日期已过、已经回填过 execution_status，但实验记录状态没跟上——回填了但没传导到正式记录）。unbackfilled 和 stale 互斥。
- idea.list —— Idea 卡片列表。
- decision.list —— 已落盘的决策记录（input 可选 {"project_uid":"..."} 限定课题）；project.get 的返回里也已经带了当前课题的 decisions，多数情况不用单独调这个。
- lesson.list —— 已确认的经验候选（input 可选 {"project_uid":"..."} 限定课题；project_uid 为空的经验是跨课题都成立的方法论层面经验，任何限定下都会带上）。project.get 的返回里也已经带了当前课题相关的 lessons，多数情况不用单独调这个。经验候选怎么从执行回填/漂移/决策里提炼、怎么写成 scholarium-draft，见对话协议规则17——只在研究员明确要求总结经验时才做，不主动提炼。
- workspace.rescan_pending —— 全量（不限于当前绑定课题）回扫：所有已关联实验的时间块里带 flags 的条目（orphaned/blocked/unreviewed/unbackfilled/stale），以及所有 active 且填了 trigger_condition 的决策。每条都带一个稳定的 marker 字符串（RESCAN-TB:<id> / RESCAN-DEC:<uid>），用来和已经生成过的工作台任务去重。返回里还带 due（布尔，是否到了该提醒的时候——节流周期由研究员在 bridge.config.json 里配置，默认每天最多一次，日期数学在服务端算好，不要自己心算）、last_checked_at（上次真正提醒是什么时候，null 表示从没提醒过）、cadence_days、next_due_at。见下方规则 9，due 是这批数据能不能拿去提议任务的唯一判据。
示例：调用 mcp__scholarium__scholarium_state，参数 {"action":"workspace.get_state","input":{"section":"timeblocks"}}。若 MCP 工具真实返回错误，如实报告工具名和错误；不得把“没有调用工具”误报为 Bridge 不在线。

【修改：只能请求，不能自称已做】要修改 Scholarium 里的任何内容（排日程、打卡、记心情/习惯、加任务、登记素材、改文章评分、标已读收藏、给实验记日志），在回复末尾输出一个或多个如下格式的代码块：
\`\`\`scholarium-action
{"action":"workspace.timeblock_add","input":{"date":"2026-08-21","start":"09:00","end":"11:00","title":"HPLC 测液相产物"},"reason":"研究员要求"}
\`\`\`
可用修改动作（input 字段）：
- workspace.timeblock_add {date:YYYY-MM-DD, start:HH:MM, end:HH:MM, title, category?, note?, experiment_uid?, experiment_display_id?} —— 排日程；这段时间对应某个已存在的 EXP 时，用 experiment_uid（从 experiment.scan_outcomes/project.get 读到的真实 uid）或 experiment_display_id（人类可读的 "EXP-007"，会被服务端解析成 uid）做正式关联——不要只把 EXP 编号写进 note，note 不参与关联判断，系统不会去解析它。
- workspace.timeblock_update {id, 待改字段, experiment_uid?, experiment_display_id?, execution_status?, execution_note?} —— 同上；experiment_uid 传空字符串可解除既有关联。execution_status（"completed"|"not_completed"|"blocked"）是执行回填专用字段：研究员告诉你某块已排期的时间实际发生了什么后，用它写回最小事实，execution_note 放研究员实际说的情况；execution_status 必填，execution_note 可留空但不能反过来只给 note 不给 status / workspace.timeblock_remove {id}
- workspace.checkin_upsert {date, period:morning|afternoon|evening, note?, clear?} —— 考勤打卡
- workspace.habit_add {name, cadence?} / workspace.habit_log {habit_id, date?, done?, note?}
- workspace.emotion_log {mood, score?, note?, date?} —— 记心情
- workspace.task_add {title, due?, note?} / workspace.task_update {id, title?/status?/due?/note?} / workspace.task_remove {id}
- workspace.focus_log {title, date?, start?, end?, minutes?} —— 补记专注
- workspace.capture_add {text} —— 速记
- material.add {path:vault相对路径, name?, category?} / material.update {id, name?/category?} / material.remove {id} / material.category_add {name} / material.category_remove {name} —— 删除分类前必须先用 material.list 确认没有任何条目仍在使用它；被使用的分类会被服务端拒绝。
- rss.set_article_score {article_id, overall_score:0-100, reason:必填} —— 改单篇文章评分
- rss.mark_article {article_id, read?, starred?} —— 标已读/收藏
- experiment.append_note {experiment_uid, text} —— 给实验记录追加日志
- experiment.validate_chem {smiles? 或 reaction_smiles?（至少给一个）} —— 只读化学门禁：检查结构能否解析；反应式检查逐元素守恒和净电荷守恒。只有返回 valid:true 且 status:balanced 才能称为已配平并继续写入。
- experiment.insert_chem {experiment_uid, smiles? 或 reaction_smiles?（至少给一个）, title?, type?, molfile?, ket?} —— 往实验记录正文插入一个化学结构块，研究员点"编辑"能直接用 Ketcher 打开继续画。它只固化结构表示，不自动证明方程式正确：调用前必须确认物种来源和反应物/产物边界，逐元素核对原子数与净电荷，涉及氧化还原再核对电子/氧化数，涉及离子/配位物再核对价态与配位数；系数化为最小整数比并给出人类可读方程式。Ketcher 把重复物种画成多个图形不等于显示了系数。任一项未核实就标为“待核验/方程式不完整”，拿不准就问研究员或用 experiment.append_note 写文字，绝不编造 SMILES、分子式、产物或“已配平”结论。
- experiment.transition {experiment_uid, to_status, reason:必填} —— 推进实验生命周期状态（idea→designed→ready→running→data_pending→analyzing→concluded→integrated，一次只能走到紧挨着当前状态的下一步，不能跳级）。这个动作不经 Obsidian 队列，走独立的两阶段确认通道，点确认后 Bridge 直接执行、不用等 Obsidian 打开。
- experiment.invalidate_provenance {experiment_uid, data_origin:"simulated"|"demonstration"|"unverifiable", reason:必填, data_provenance_note:必填} —— 研究者完成来源判定后，使实验进入 invalidated，并在一个带恢复快照的事务中同步降级其 Evidence、撤出 Hypothesis 正式关系。只有研究者在本轮明确声明来源类别并要求处置时才可请求；Agent 的文件推断、审计发现或“看起来像模拟”都不构成研究者声明。unknown 是尚未判定，unverifiable 是研究者已完成追溯但仍无法核实，两者不得混用。
规则：
1. 需要 id 的修改，先用读取动作查到真实 id，禁止编造。
2. 日期推算以对话中给出的"今天"日期为准，"明天"=今天+1 天。
3. 输出动作块后，在正文里明确说"已提交修改请求，等你确认后生效"——绝对不能声称修改已经完成，确认按钮在研究员手里。
4. 研究员只是询问或讨论时不要输出动作块。
5. 排日程用 workspace.timeblock_add，加没有具体时间的待办才用 workspace.task_add——两者不能混用。研究员说"安排/排进/几点做什么/设计一天一周的实验"这类带时间意图的请求，即使没给出具体日期时间，也要用 timeblock_add 给出你安排的日期/时间段（并在正文说明这是你排的、请确认），不要因为怕排错时间就退化成一堆不带时间的 task_add，那样研究员在工作台的日程视图里什么都看不到。
6. 这段时间对应某个已存在的 EXP-00X（研究员点名了，或上文 project.get/experiment.scan_outcomes 里能查到）时，timeblock_add/update 必须带上 experiment_uid 或 experiment_display_id 做正式关联，不能只在 note 里写"对应 EXP-007"——那样系统读不出这条关联，之后既查不到这块时间是为哪个实验排的，也没法做漂移检查。不确定具体是哪个 EXP、或研究员还没定下来时，宁可不关联，也不要猜一个填上去。
7. 新增指向某个 EXP 的时间块前，或研究员在讨论本周/下周安排时，建议先用 workspace.timeblock_drift_audit 查一遍：若目标实验仍 blocked（有未清 blocked_by）或 unreviewed（review_status 非 confirmed），要在正文里如实提醒"这个实验还没准备好/还没审核，按计划排上但可能执行不了"，不要当没看见就直接排；若发现已有关联时间块被标 unbackfilled（日期已过、从没人说过实际发生了什么），主动问一句这块时间完成情况；被标 stale（已经回填过但实验记录没跟上）则告诉研究员这个执行落差，这不是你的错误。
8. 研究员回答了某个已排期时间块的完成情况（完成/没完成/被卡住，附带原因或结果）：输出 workspace.timeblock_update {id, execution_status, execution_note} 写回最小事实；若这条回答本身构成一条值得记录的实验观察，同时输出 experiment.append_note {experiment_uid, text} 追加进实验日志——两个动作块可以在同一条回复里一起给。研究员的话若明确到"该推进状态了"（不只是汇报完成情况，而是一次状态判断），可以额外输出 experiment.transition {experiment_uid, to_status, reason}——2026-08-27 起这条通道已接通（走 /v1/edits 两阶段确认，面板会同步执行、不用等 Obsidian 轮询）。to_status 只能是生命周期里紧挨着当前状态的下一步，不能跳级；reason 必填。拿不准算不算"正式判断"时，宁可只做 append_note、在正文里问一句要不要推进，不要替研究员做这个决定。
9. 这次对话是本次会话的第一条消息（没有此前对话）时，先调用 workspace.rescan_pending 做一次全量回扫。只看它返回的 due：
   - due 为 false：说明距上次提醒还没到节流周期（cadence_days 天），什么都不用做——不要提议任务，也不要在正文里提"我查了一下"，当作这一步没发生过。
   - due 为 true：再调用 workspace.get_state {"section":"tasks"} 看已有任务的 note 里有没有 RESCAN-TB:<id> / RESCAN-DEC:<uid> 这样的 marker——已经出现过 marker 的条目不再重复提议。对剩下真正新出现的条目，按 blocked/unreviewed 优先、其次 unbackfilled、再 stale、最后决策触发条件的顺序，最多挑 8 条，各输出一个 workspace.task_add {title, note}，note 里必须原样带上对应 marker（比如 "RESCAN-TB:tb-20260810-01 · unbackfilled：日期已过未回填"），这样它才能被下一轮识别、去重。即使去重后一条新的都没有，也要调用 mcp__scholarium__rescan_checkpoint_mark，把节流计时重置——这一步不需要研究员确认，它只记录“什么时候查过”，不改任何研究内容。只有 due 为 true 这一分支才允许调用，due 为 false 时绝不能调用。
10. 研究员在描述某个实验的反应体系、底物或产物，而对应的 EXP 记录里还没有这条结构时，可以输出 experiment.insert_chem 把它固化进笔记正文。先调用 experiment.validate_chem；只有 valid:true 且 status:balanced，才允许继续调用 experiment.insert_chem 并传 strict_validation:true。验证器返回 unbalanced、invalid 或 unavailable 时禁止写入反应式，改用 experiment.append_note 记录“待核验/方程式不完整”。前提是结构本身来自研究员的话、文献原文或已有记录——你自己推断出来的、或只是"大概是这么个反应"的，一律不要写：一条编造的 SMILES 在笔记里和一条真实结构长得一模一样，事后没人分得清。

【对话运行：只能请求，确认后执行】当研究员明确要求“运行完整 Pipeline”“只检索文献”或“从某个步骤重新运行”时，在回复末尾输出一个且只输出一个运行块。你不能声称任务已经启动；面板会把它变成确认卡，研究员点击后才运行。
- 完整 Pipeline：
\`\`\`scholarium-run
{"operation":"pipeline.run","topic":"研究主题或问题","reason":"研究员明确要求运行完整链条"}
\`\`\`
- 仅检索文献（不下载、不生成证据卡/图谱/手稿）：
\`\`\`scholarium-run
{"operation":"literature.search","query":"检索主题或问题","reason":"研究员明确要求只检索"}
\`\`\`
- 将已经核实的 DOI 清单放入“文献订阅 → Pipeline 待处理”，供研究员逐篇选择下载，并在确认后直接打开该列表：
\`\`\`scholarium-run
{"operation":"literature.queue","items":[{"doi":"10.xxxx/xxxx","title":"论文标题","url":"https://doi.org/10.xxxx/xxxx","reason":"P0 · 摘要命中核心问题"}],"open":true,"reason":"研究员要求加入人工下载队列"}
\`\`\`
- 研究员同时要求扫描摘要、打标签并保存文献笔记时：先核实每篇摘要，再输出一个 \`\`\`scholarium-draft 块，items 中每篇一份 Markdown，建议路径为 Literature/<安全文件名>.md。每篇 frontmatter 只写 paper 的科研内容字段：type: paper、title、source（真实 DOI/出版方 URL）、doi、tags；uid、PAPER 编号、schema_version、时间戳与 AI 草稿状态由 Bridge 生成。JSON 顶层设 "open_after_commit":true。不得把没有拿到的摘要补造出来；只拿到元数据时明确写“摘要待补”。队列块与草稿块可以在同一回复中各出现一次，二者会分别显示确认卡。
- 修改已经存在的人工实验笔记时，不得输出 scholarium-draft（它只会新建文件，绝不覆盖）。只允许修改 \`Experiments/\` 下的既有 Markdown，必须输出一个严格的三反引号 \`\`\`scholarium-note-edit 围栏块：{"path":"Experiments/现有文件.md","content":"完整修改后 Markdown","reason":"研究员要求","changes":[{"location":"位置","before":"原文","after":"修改后"}]}。changes 至少列出每处实质修改，面板会把它渲染成确认表格；研究员点击确认后 Bridge 才会预览、检测并发改动并原子写入。不得用这条路径修改 Research/ 下的 schema-v1 对象、\`.obsidian\` 文件或任何非 Markdown 文件。
- 研究员想对素材库里的 XLSX 工作簿绘图时：先输出一个 \`\`\`scholarium-normalize 围栏块，把它结构化转换成一份带源哈希的 UTF-8 CSV（TXT/DAT 不需要这一步，绘图器直接嗅探它们的分隔符；只有确实需要把分隔符和表头行固化下来时才规范化）：
\`\`\`scholarium-normalize
{"data_path":"Materials/kinetics.xlsx","sheet":"Raw","header_row":2,"formula_mode":"cached","reason":"工作簿有多个工作表，研究员点名用 Raw"}
\`\`\`
data_path 必须是 Vault 内相对路径，后缀只能是 .csv/.tsv/.txt/.dat/.xlsx。sheet 只在工作簿有多个可见工作表时必填，且必须是研究员点名或你实际读到的工作表名——不要猜一个填上去。header_row 不确定时整个字段省略，交给 Skill 自动识别，不要编一个行号。formula_mode 默认 cached（读公式格已缓存的值）；研究员明确要求保留公式文本时用 formula_text；要求"有公式就别转"时用 reject。
绝不要输出 allow_missing_formula_cache：公式格没有缓存值时 Skill 会拒绝，这是对的——那种情况下转换出来的是一整列空白，接着画出的图看着完全正常。只有研究员能在确认卡上自己解除这道闸，你没有办法知道那些公式本该算出什么。
这条链是两段的，不要合并：规范化完成后面板会告诉研究员产物路径，绘图是另一次明确请求，x/y 列与图型必须由研究员指定。不要在同一条回复里既请求规范化又声称已经画好图。原文件全程只读，转换不清洗、不过滤、不平滑任何数值；你也不得在正文里把转换描述成"数据已整理好"。
- 研究员指定了数据文件和要画的列之后，输出一个 \`\`\`scholarium-plot 围栏块请求出图（data_path 接受 .csv/.tsv/.txt/.dat；绘图器会嗅探 TXT/DAT 的分隔符、跳过注释行，分隔符有歧义时会拒绝而不是猜。只有 XLSX 工作簿必须先走上面的 normalize）：
\`\`\`scholarium-plot
{"data_path":"Materials/_normalized/<哈希>/normalized.csv","x_column":"time","y_columns":["signal"],"plot_kind":"line","title":"信号随时间变化","chart_style":{"theme":"publication"},"reason":"研究员点名 time 对 signal"}
\`\`\`
x_column / y_columns 必须是你在该文件表头里实际读到的列名，不得猜测、不得改写大小写或空格。plot_kind 只能是 line/scatter/bar。拿不准画哪一列就先问研究员，不要挑一个看起来合理的填上去——图画出来之后没人会回头核对列名选得对不对。
- 只改已有图的外观（配色、字号、网格、图例、坐标范围、标注等）时，用 \`\`\`scholarium-plot-revise，指向那张图的 manifest：
\`\`\`scholarium-plot-revise
{"target_manifest_path":"Materials/_analysis/<目录>/plot-manifest.json","chart_style":{"theme":"soft","show_grid":false,"series_colors":["#3366cc"]},"reason":"研究员要求去掉网格线"}
\`\`\`
改版块里绝不要写 data_path、x_column、y_columns 或 save_mode——换数据或换列就是另一张图，必须走完整的 scholarium-plot 重新确认；覆盖旧版本只能由研究员在卡片上勾选。整块带了这些字段会被直接拒绝。
你永远不直接编辑 SVG，只提交渲染参数，由绘图器从源 CSV 确定性重画——这样每一张图都始终能从数据复现。也不要把改样式说成"更新了数据"或"修正了曲线"。
- 从最近一次 Pipeline 的指定步骤重跑：
\`\`\`scholarium-run
{"operation":"pipeline.rerun","run_id":"latest","from_step":"search","query":"可选：研究员明确给出的新检索式","reason":"研究员要求从检索步骤重新运行"}
\`\`\`
可用 from_step 只有：query-builder、concept-matrix、query-refine、search、quality-gate、extra-providers、final-screen、degraded-gate、dedupe、download、nature-reader、obsidian-bases、knowledge-graph、deep-research、nature-writing、nature-polishing。研究员说“第 3.7 步”时用 quality-gate；说“重新检索”时用 search；说“重新下载”时用 download。除非研究员点名某个真实运行 id，否则 run_id 用 latest，禁止编造 id。研究员同时明确给出新课题主题时可加 topic；明确给出新 Boolean 检索式时可加 query。修改主题会由面板安全回退到第 1 步，修改 query 且所选步骤晚于 search 时会回退到 search。旧任务没有状态包或目标步骤缺上游状态时，面板会拒绝跨步并解释需要从哪里重跑。研究员只是讨论 Pipeline、询问为什么失败或问某一步做什么时，不输出运行块。`;
  }

  // src/features/chat/research-prompt.ts
  function buildWeaverPrompt(input) {
    const messages = input.history.filter((entry) => entry.role === "user" || entry.role === "agent").map((entry) => ({ role: entry.role, text: entry.role === "agent" ? replyForDisplay(entry.text).text : entry.text }));
    const prompt = buildResearchChatPrompt({
      message: input.message,
      messages,
      taskGoal: input.taskGoal ?? "",
      workspace: input.workspace ?? "",
      ragBlock: input.ragBlock ?? "",
      memoryBlock: input.memoryBlock ?? "",
      projectBlock: input.projectBlock ?? "",
      capabilities: `${laneCapabilities(input.agentId)}

${scholariumCapabilities()}

${nativeFileProtocol()}

${anchorPatchProtocol()}

${controlPlaneAnchorProtocol()}

${figureProtocol()}`
    });
    return `${prompt}${input.anchorBlock ?? ""}`;
  }
  function nativeFileProtocol() {
    return `【Vault 文件改动（原生面板）】你的车道不能直接写文件（没有 Write/Edit/Bash），这不是“做不到”：研究员明确要求整理/新建/移动/重命名文件或文件夹、修改已有笔记（含 Experiments/ 下的实验记录）、删除文件时，在回复末尾输出一个严格三反引号的 \`\`\`scholarium-files 围栏块（每条回复最多一个），内容是 JSON：{"reason":"一句话","ops":[...]}。ops 每项只能是：{"op":"mkdir","path":"文件夹"}；{"op":"move","from":"原路径","to":"新路径"}（重命名也用 move，可整体移动文件夹）；{"op":"create","path":"新文件.md","content":"完整内容"}；{"op":"edit","path":"已有笔记.md","content":"修改后的完整内容","changes":[{"location":"位置","before":"原文","after":"修改后"}]}；{"op":"trash","path":"要删除的文件"}。路径一律是 Vault 内相对路径（不以 / 或盘符开头，不含 ..，不碰 .obsidian/）。先用只读工具核实文件真实存在与当前内容，不得猜路径；edit 必须基于刚读到的原文给出完整新内容，只改研究员要求之处，changes 列出每处实质修改；move/create 的目标不能已存在（不会覆盖）；删除只会移到回收站。面板逐项显示预览和修改前后对比，研究员勾选并点击执行后才由 Obsidian 落盘，执行后可一键撤销；一次最多 300 项，大批量整理先给分类方案、研究员同意后再输出操作块。只能说“已生成待确认的文件改动”，不得声称已移动/已修改。Research/ 下正式研究对象（HYP/EXP/Decision 等）的新建仍优先用 scholarium-draft。`;
  }
  function anchorPatchProtocol() {
    return `【Scholarium AI 识别点（P1，本地）】地址以 sch: 开头：研究对象如 sch:EXP-012@tags、sch:EXP-012#结果；普通笔记如 sch:note/路径/笔记#段落。地址里的中文标题照原样写（如 sch:EXP-001#实验方案与过程），不要做 URL 编码，只有空格写成 %20；同名标题才需要写出上级，如 #结果/体系。研究员消息中的地址会由插件直接从当前 Vault describe，并把字段、段落、可编辑性和 version 放在上下文中。提出精细修改时，在回复末尾输出最多一个严格三反引号的 \`\`\`scholarium-patch 围栏，围栏内容是 JSON：{"reason":"原因","ops":[...]}; P1 op 只能是 {"op":"set_field","anchor":"...@字段","value":值,"base":"describe.version"}、{"op":"replace_section"|"append_section","anchor":"...#标题路径","content":"内容","base":"版本"}、{"op":"replace_text","anchor":"...#可选段落","find":"原文","replace":"新文","occurrence":1,"base":"版本"}。每项只碰一个识别点且都必须带刚 describe 得到的 base；不知道版本时不要猜，先请研究员给出/再次引用地址。uid、display_id、schema_version、review_status，假设 confidence/confidence_set_by 都不可改。实验的数据来源字段与“数据来源”段仍需研究员本轮说明，但研究员可以完全用自然语言：例如“这是我今天从文献数据库导入的元数据”“这组数据是我做的 Gaussian 计算”。你负责把明确说明归类为 planned/measured/simulated/imported/demonstration/unknown/unverifiable，并把“我/本人”规范为 user、把“今天”规范化为本机日期；在卡片中清楚说明你的归类和换算，等待研究员逐项勾选。不要要求研究员输入 data_origin 这类字段名，也不要把自然语言改写成超出原意的新事实。说明不足时，只问一个具体、自然的问题（如“这是实测数据、计算数据，还是从外部资料导入？”），并说明为什么需要它。simulated/measured/imported/unverifiable 仍需来源说明，measured/imported 还需可定位的原始数据入口；若入口不清楚，先询问位置，不要编造。status 不得 set_field，只能以后经白名单 transition。面板会逐项对比、逐项勾选，版本冲突和保护字段不可勾选，执行后可撤销。只能说“已生成待确认的精细修改”，不得声称已写入。`;
  }
  function figureProtocol() {
    return `【图片（本地）】研究员消息里的 ![说明](Vault 路径) 是研究员附上的图片；插件会在上下文里给出它的绝对路径，你可以用 Read 工具直接查看图片内容再回答。你不能自己写文件；需要出图时，在回复末尾输出最多一个严格三反引号的 \`\`\`scholarium-figure 围栏，内容是 JSON：{"reason":"原因","figures":[...]}，最多 6 张，每张是以下三种之一：
1. 示意图 {"kind":"svg","title":"标题","save_to":"文件夹/名称.svg","svg":"<svg xmlns=\\"http://www.w3.org/2000/svg\\" viewBox=\\"0 0 800 500\\">…</svg>"}：机理图、流程图、能级/能带示意、装置示意等。只用纯 SVG 图形和文字，不要脚本、事件、外部链接或嵌入网页；文字字号不小于 12，中文可读。
2. 数据图 {"kind":"plot","title":"标题","save_to":"文件夹/名称.svg","data_path":"Vault 内 CSV/TSV 路径","x":"列名","y":["列名"],"type":"line|scatter|bar","x_label":"","y_label":""}：插件读取数据文件原样绘制，你不要自己编造或改动数值；列名必须与表头完全一致，不确定时先读文件确认。
3. AI 生图 {"kind":"generate","title":"标题","save_to":"文件夹/名称.png","prompt":"详细的画面描述","size":"1024x1024"}：由研究员配置的生图服务生成，研究员点“生成预览”后才会调用；只用于示意性插画，不得用来伪造实验数据、表征图谱或显微照片。
没有指定位置时 save_to 用 Scholarium/Figures/ 下的文件夹。每张图研究员都可以先预览再勾选保存，同名文件不会被覆盖。只能说“已生成待确认的图片”，不得声称已保存。在回复里展示 Vault 中已有的图片，写 ![说明](Vault 路径)。`;
  }
  function controlPlaneAnchorProtocol() {
    return `【Scholarium AI 识别点（P2，本地控制面）】工作台、素材库和文献订阅的条目地址分别是 sch:workspace/timeblocks/<id>、sch:workspace/tasks/<id>、sch:material/items/<id>、sch:feed/articles/<id>。研究员消息出现这些地址时，插件从本机 Bridge 读取该条目的字段、可编辑性与 version；不联网、不访问 GitHub、不读取密钥。不要把这些地址放进 scholarium-patch；它们只能走现有的 scholarium-action 白名单。一次 action 只改一个 P2 地址，且必须包含 anchor 与 describe 的 base，例如 {"action":"workspace.task_update","anchor":"sch:workspace/tasks/t-1","base":"describe.version","input":{"id":"t-1","status":"done"},"reason":"研究员要求"}。动作映射固定：时间块→workspace.timeblock_update，待办→workspace.task_update，素材→material.update，文章评分→rss.set_article_score，文章已读/收藏→rss.mark_article；input 中 id（文章为 article_id）必须等于地址最后一段。input 字段名固定：待办 {id,title?,status?,due?,note?}；时间块 {id,date?,startTime?,endTime?,category?,title?,note?,execution_status?,execution_note?}；素材 {id,name?,category?}；评分 {article_id,overall_score(0-100),reason(必填，写清为什么改)}；已读/收藏 {article_id,read?,starred?}。只放要改的字段。每个 action 都是一张独立确认卡；点击确认前插件再次读取并核对 base，版本不一致就拒绝投递。不得虚构条目 id、不得用此协议新增/删除条目、不得修改设置或密钥。只能说“已生成待确认的修改请求”，不得声称已写入。`;
  }
  function projectBlock(projectId, project, outcomes, error = "", drift = null) {
    const build = projectContextBlock;
    return build(projectId, project, outcomes, error, drift);
  }
  function ragBlockFrom(response) {
    const manifest = response?.manifest;
    const hits = Array.isArray(manifest?.results) ? manifest?.results : [];
    if (!hits.length) return "";
    const retrieval = typeof manifest?.retrieval === "string" ? manifest.retrieval : "unknown";
    const warning = Array.isArray(manifest?.warnings) ? (manifest?.warnings).map(String).join("；") : "";
    return `

你的文献库检索命中（实际检索：${retrieval}${warning ? `；告警：${warning}` : ""}。回答时优先基于这些内容，并在相关处用（来源：文件路径#小节）标注出处；命中内容不相关就忽略，不要硬引）：
` + hits.map((hit, index) => `[${index + 1}] 来源：${String(hit.source ?? "")}${hit.heading ? `#${String(hit.heading)}` : ""}
${String(hit.snippet ?? "")}`).join("\n\n");
  }
  function memoryBlockFrom(response) {
    const block = response?.block;
    return typeof block === "string" && block ? `

${block}
` : "";
  }
  function checkpointExcerpt(replyText) {
    const plain = replyText.replace(/```[\s\S]*?```/g, " ").replace(/[#>*`[\]()]/g, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
    const parts = plain.split(/(?<=[。！？.!?])\s*/).filter(Boolean);
    return (parts.slice(0, 2).join("") || plain).slice(0, 300);
  }
  function memorySuggestions(replyText) {
    const pattern = /建议记入\s*(decisions|evidence-ledger|lessons)[：:]\s*([^\n]+)/g;
    const found = [];
    for (const match of replyText.matchAll(pattern)) {
      if (found.length >= 3) break;
      found.push({ file: `${match[1]}.md`, title: match[2].slice(0, 80), body: match[2] });
    }
    return found;
  }

  // src/plugin/weaver-runtime.ts
  var DEFAULT_FLOW_ID = "weaver";
  var DEFAULT_SETTINGS = Object.freeze({
    projectId: "",
    flowId: DEFAULT_FLOW_ID,
    agentId: "codex",
    workspaceRoot: "",
    pipelineVersion: "v2",
    v3: Object.freeze({ timeouts: Object.freeze({}) }),
    debug: Object.freeze({ faults: Object.freeze([]) })
  });
  function text5(value, fallback, limit = 300) {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return !trimmed || trimmed.length > limit ? fallback : trimmed;
  }
  function optionalText(value, limit = 300) {
    return typeof value === "string" ? value.trim().slice(0, limit) : "";
  }
  function normalizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      projectId: optionalText(source.projectId),
      flowId: text5(source.flowId, DEFAULT_FLOW_ID),
      agentId: text5(source.agentId, DEFAULT_SETTINGS.agentId, 100),
      workspaceRoot: optionalText(source.workspaceRoot, 1e3),
      pipelineVersion: source.pipelineVersion === "v3" ? "v3" : "v2",
      v3: { timeouts: timeoutTable(asRecord2(source.v3).timeouts) },
      debug: { faults: normalizeFaults(asRecord2(source.debug).faults) }
    };
  }
  function timeoutTable(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const table = {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) table[key] = Math.round(value);
    }
    return table;
  }
  function resolveScope(settings) {
    const safe3 = normalizeSettings(settings);
    return scopeRefFrom({ projectId: safe3.projectId, flowId: safe3.flowId });
  }
  var TASK_PATH = "/v1/tasks";
  var ACTION_PATH = "/v1/scholarium/actions";
  var DRAFT_BATCH_PATH = "/v1/drafts/batch";
  var AGENTS_PATH2 = "/v1/agents";
  var RAG_PATH2 = "/v1/rag/query";
  var MEMORY_PATH = "/v1/agent-memory";
  var MEMORY_CONTEXT_PATH = "/v1/agent-memory/context";
  var MEMORY_CHECKPOINT_PATH = "/v1/agent-memory/checkpoint";
  var MEMORY_ENTRY_PATH = "/v1/agent-memory/entry";
  var STATE_PATH3 = "/v1/scholarium/state";
  var LITERATURE_SEARCH_PATH = "/v1/literature/search";
  var LITERATURE_PREFIX = "/v1/literature";
  var HISTORY_PATH2 = "/v1/history";
  var FULL_TASKS_PATH = "/v1/full-tasks";
  var PIPELINE_RUNS_PATH2 = "/v1/pipeline-runs";
  var SKILL_RUNS_PATH2 = "/v1/skill-runs";
  var SKILLS_PATH2 = "/v1/skills";
  var REQUESTED_BY = "weaver-plugin";
  var EDIT_ACTIONS = /* @__PURE__ */ new Map([
    ["experiment.transition", "/v1/edits/experiment-transition/preview"],
    ["experiment.invalidate_provenance", "/v1/edits/provenance-invalidation/preview"]
  ]);
  function explainEditError(raw) {
    const text6 = String(raw ?? "");
    const step = /invalid_experiment_transition:([\w-]+)→([\w-]+)/.exec(text6);
    if (step) return `状态只能逐级推进：当前是 ${step[1]}，不能直接到 ${step[2]}。请让织研者按下一步重新发起。`;
    if (/experiment_not_found:/.test(text6)) return "找不到这条实验：experiment_uid 必须是实验笔记 frontmatter 里的 uid（不是 EXP-xxx 编号）。";
    if (/transition_reason_required/.test(text6)) return "推进状态必须写明理由（reason）。";
    if (/conclusion_required_before_concluded/.test(text6)) return "进入 concluded 之前，实验的 conclusion 字段必须先有实质内容。";
    if (/data_required_before_concluded/.test(text6)) return "data_origin 还是 planned，没有真实数据不能进入 concluded / integrated；数据来源需由你在笔记里声明。";
    if (/simulated_data_cannot_be_integrated/.test(text6)) return "模拟数据（simulated）不能进入 integrated。";
    if (/produced_evidence_required_before_integrated/.test(text6)) return "进入 integrated 之前需要至少一条 produced_evidence。";
    if (/unknown_experiment_status:/.test(text6)) return `未知的实验状态：${text6.split("unknown_experiment_status:")[1] ?? ""}`;
    if (/Scholarium actions are disabled/.test(text6)) return "运行时的 Scholarium 动作未开启（bridge.config.json 里 scholarium.enabled=false）。";
    return text6;
  }
  async function executeEditAction(client, action, input) {
    const endpoint = EDIT_ACTIONS.get(action);
    const invalidating = action === "experiment.invalidate_provenance";
    const body = invalidating ? { ...input } : { experiment_uid: input.experiment_uid, to_status: input.to_status, reason: input.reason };
    const preview = await client.request(endpoint, { method: "POST", body });
    if (!preview.ok) return { status: "failed", detail: `预检未通过：${explainEditError(preview.error)}` };
    const previewId = typeof preview.data?.id === "string" ? preview.data.id : "";
    if (!previewId) return { status: "failed", detail: "运行时没有返回预检编号，未提交。" };
    const commit = await client.request(`/v1/edits/${encodeURIComponent(previewId)}/commit`, { method: "POST", body: {} });
    if (!commit.ok) return { status: "failed", detail: `提交未通过：${explainEditError(commit.error)}` };
    const plan = commit.data?.result ?? {};
    if (invalidating) {
      const evidence = Array.isArray(plan.evidence_uids) ? plan.evidence_uids.length : 0;
      const hypotheses = Array.isArray(plan.hypothesis_uids) ? plan.hypothesis_uids.length : 0;
      return { status: "executed", detail: `${String(plan.display_id ?? input.experiment_uid ?? "")}：${String(plan.from_status ?? "")} → ${String(plan.to_status ?? "")}；降级 ${evidence} 条 Evidence，撤出 ${hypotheses} 条 Hypothesis 关系。` };
    }
    if (plan.noop) return { status: "executed", detail: `状态已经是 ${String(plan.to ?? input.to_status ?? "")}，没有变化。` };
    return { status: "executed", detail: `实验状态已推进：${String(plan.from ?? "?")} → ${String(plan.to ?? input.to_status ?? "?")}。` };
  }
  var OPERATION_HEADER = "x-scholarium-operation-id";
  var DEFAULT_POLL_INTERVAL_MS = 900;
  var DEFAULT_MAX_POLLS = 800;
  function asTaskEvents(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((event) => Boolean(event) && typeof event === "object");
  }
  function taskText(task) {
    const direct = typeof task?.finalMessage === "string" ? String(task.finalMessage).trim() : "";
    if (direct) return direct;
    const events = asTaskEvents(task?.events);
    const result = [...events].reverse().find((event) => event.type === "result");
    const failure5 = [...events].reverse().find((event) => event.type === "error");
    const said = typeof result?.text === "string" ? result.text : typeof failure5?.text === "string" ? failure5.text : "";
    return said.trim();
  }
  function progressSteps(task) {
    return asTaskEvents(task?.events).filter((event) => (event.type === "step" || event.type === "stage") && typeof event.text === "string" && event.text.trim()).map((event) => String(event.text).trim());
  }
  function stoppedReply(steps, taskId) {
    const done = steps.filter((step) => step.trim()).slice(-6);
    const text6 = [
      "已停止：这一轮被研究员终止，织研者没有给出回答，也没有提出任何修改。",
      done.length ? `停止前进行到：
${done.map((step) => `- ${step.length > 160 ? `${step.slice(0, 160)}…` : step}`).join("\n")}` : "",
      "想继续时，直接补充说明后重新发送即可。"
    ].filter(Boolean).join("\n\n");
    return { role: "system", text: text6, ...taskId ? { taskId } : {} };
  }
  function decodeSafe(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  function errorReply(text6, taskId) {
    return { role: "error", text: text6, ...taskId ? { taskId } : {} };
  }
  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }
  function asRecord2(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
  function valueAt(output, path2) {
    let current = output;
    for (const key of path2) current = asRecord2(current)[key];
    return current;
  }
  function textAt(output, path2) {
    const value = valueAt(output, path2);
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  }
  function stringsAt(output, path2) {
    const value = valueAt(output, path2);
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && Boolean(entry.trim())) : [];
  }
  function recordsAt(output) {
    const records = valueAt(output, ["manifest", "records"]);
    return Array.isArray(records) ? records.filter((entry) => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];
  }
  function pipelineSkillId3(skills, slug2) {
    const suffix = `/${slug2.toLowerCase()}/skill.md`;
    const found = skills.map((entry) => asRecord2(entry).id).filter((id) => typeof id === "string").find((id) => id.replace(/\\/g, "/").toLowerCase().endsWith(suffix));
    return found ?? "";
  }
  function pipelineStepDetail(slug2, output) {
    const manifest = asRecord2(output.manifest);
    const error = textAt(output, ["manifest", "error"]);
    if (error) return `${slug2} 返回：${error}`;
    const count2 = ["record_count", "deduped_records", "pdf_count", "card_count", "notes_created"].map((key) => manifest[key]).find((value) => typeof value === "number");
    return count2 === void 0 ? `${slug2} 已完成` : `${slug2} 已完成（${count2}）`;
  }
  function toBridgeStatus(status) {
    switch (status) {
      case "online":
        return "online";
      case "starting":
        return "connecting";
      case "degraded":
        return "degraded";
      case "stopping":
      case "offline":
        return "offline";
      default:
        return "offline";
    }
  }
  function failureSentence(failure5) {
    const category = categorySentence(failure5.kind);
    const message = failure5.message.trim();
    if (!message) return category;
    return message.startsWith(category) ? message : `${category}：${message}`;
  }
  var RuntimeBridge = class {
    environment;
    /** The transport, when the host brought its own. Absent in production, where
     * the adapter uses the host's global `fetch`; present in a test, so that no
     * test opens a socket. */
    transport;
    listeners = /* @__PURE__ */ new Set();
    adapter = null;
    currentStatus = "offline";
    reason = null;
    constructor(environment, transport) {
      this.environment = environment;
      this.transport = transport;
    }
    get status() {
      return this.currentStatus;
    }
    /** The address that was actually reported, or null when nothing is connected.
     * This is the only address the UI ever shows, and there is no way to type
     * one. */
    get origin() {
      return this.adapter?.status().endpoint?.origin ?? null;
    }
    /** The last reason the status is not `online`, already safe to render. */
    get lastReason() {
      return this.reason;
    }
    /** The pidfile this vault's runtime would use. A path, never a secret, and
     * shown only in the diagnostics section. */
    get recordPath() {
      return this.adapter?.recordPath ?? null;
    }
    onStatus(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    /**
     * Look for a runtime. Never starts one.
     *
     * This is what the page calls after its first frame. It reads one file and
     * probes one address, and an absent runtime is `offline` in the time it takes
     * to read that file — no scan, no second address, no port range.
     */
    async discover() {
      const adapter = this.buildAdapter();
      if (!adapter) return this.publish("offline");
      const found = await adapter.discover();
      this.reason = found.reason;
      return this.publish(toBridgeStatus(found.status));
    }
    /**
     * Adopt the runtime this vault already has, or start one.
     *
     * Only ever called from an explicit action: the connect command, a send, a
     * confirmed card. It is not called on a timer and not called from a frame.
     */
    async connect() {
      const adapter = this.buildAdapter();
      if (!adapter) return this.publish("offline");
      const started = await adapter.start();
      if (started.ok) {
        this.reason = null;
        return this.publish("online");
      }
      this.reason = failureSentence(started.failure);
      return this.publish(toBridgeStatus(adapter.status().status));
    }
    /** Whether a request can be made right now, without starting anything. */
    get isOnline() {
      return this.currentStatus === "online" && this.adapter?.status().endpoint !== null;
    }
    /**
     * A request against the reported origin. Never throws; a failure is a value.
     *
     * The path is handed to the adapter rather than composed into a URL here, so
     * that the one rule about what a request path may be (`//host` would leave
     * this origin and take the credential with it) is enforced in one place.
     */
    async request(path2, options = {}) {
      const adapter = this.adapter;
      if (!adapter) {
        return { ok: false, error: this.reason ?? "没有可用的运行时", status: null, timedOut: false };
      }
      const result = await adapter.request(path2, options);
      if (result.ok) return { ok: true, status: result.value.status, data: result.value.data };
      const sentence = failureSentence(result.failure);
      this.reason = sentence;
      return {
        ok: false,
        error: sentence,
        status: typeof result.failure.detail.status === "number" ? result.failure.detail.status : null,
        // The only thing the adapter calls a timeout is a request that ran out of
        // its own deadline; every other failure is an answer of some kind.
        timedOut: result.failure.kind === "request-failed" && /没有回应/.test(result.failure.message)
      };
    }
    /**
     * Stop the runtime, and only if this process is the one that started it.
     *
     * Called from `unload`. An adopted runtime is left running: it belongs to
     * whoever started it, which may be another Obsidian window or a terminal the
     * researcher is watching, and closing a view is not a reason to kill it.
     */
    async dispose() {
      const adapter = this.adapter;
      this.adapter = null;
      this.currentStatus = "offline";
      this.reason = null;
      if (!adapter) return;
      if (!adapter.status().owns) return;
      try {
        await adapter.stop();
      } catch {
      }
    }
    /** Remember a reason a caller learned before the adapter could: a host with
     * no vault directory, or one that cannot reach Node at all. */
    publish(status, reason = this.reason) {
      if (reason !== this.reason) this.reason = reason;
      if (status === this.currentStatus) return this.currentStatus;
      this.currentStatus = status;
      for (const listener of [...this.listeners]) {
        try {
          listener(status);
        } catch {
        }
      }
      return this.currentStatus;
    }
    /**
     * The adapter, built on first use.
     *
     * Three things can make it impossible, and all three are `offline` with a
     * sentence rather than a throw: the host has no vault directory, the host has
     * no Node capabilities, or the vault path cannot name a profile.
     */
    buildAdapter() {
      if (this.adapter) return this.adapter;
      const environment = this.environment;
      if (environment.adapter) {
        try {
          const hosted = environment.adapter();
          hosted.onStatus((snapshot) => {
            if (snapshot.failure) this.reason = failureSentence(snapshot.failure);
            this.publish(toBridgeStatus(snapshot.status));
          });
          this.adapter = hosted;
          return hosted;
        } catch (error) {
          this.reason = `运行时适配器无法建立：${error instanceof Error ? error.message : String(error)}`;
          return null;
        }
      }
      let vaultPath = "";
      try {
        vaultPath = environment.vaultPath() ?? "";
      } catch {
        vaultPath = "";
      }
      if (!vaultPath.trim()) {
        this.reason = "宿主没有给出 Vault 的磁盘路径，运行时不可用。";
        return null;
      }
      let host;
      try {
        host = environment.host();
      } catch (error) {
        this.reason = `无法访问本机 Node 能力：${error instanceof Error ? error.message : String(error)}`;
        return null;
      }
      const options = {
        vaultPath,
        host,
        // A *getter*, and not a value. Finding a launcher stats a path, and
        // `discover` is a read of one pidfile that must not become a walk of the
        // plugin folder as well — the launcher is only ever wanted by a start.
        // The adapter reads `options.launcher` inside `start()`, so a property
        // that runs then is a property that runs at the right moment.
        get launcher() {
          return environment.launcher();
        },
        ...environment.runtimeRoot ? { runtimeRoot: environment.runtimeRoot } : {},
        // The transport the host gave, if it gave one. Absent in production,
        // where the adapter falls back to the host's own `fetch`; present in a
        // test, so that no test opens a socket.
        ...this.transport ? { fetch: this.transport } : {},
        onStatus: (snapshot) => {
          if (snapshot.failure) this.reason = failureSentence(snapshot.failure);
          this.publish(toBridgeStatus(snapshot.status));
        }
      };
      try {
        this.adapter = createRuntimeAdapter(options);
      } catch (error) {
        this.reason = `运行时适配器无法建立：${error instanceof Error ? error.message : String(error)}`;
        return null;
      }
      return this.adapter;
    }
  };
  var WeaverRuntime = class {
    store;
    bridge;
    host;
    settings;
    constructor(host, settings, environment) {
      this.host = host;
      this.settings = normalizeSettings(settings);
      this.store = new VaultChatStore(host.vault, host.now ? { now: host.now } : {});
      this.bridge = new RuntimeBridge(environment, host.fetch);
    }
    get currentSettings() {
      return this.settings;
    }
    /** Replace the settings. Nothing has to be rebuilt: the scope is read per
     * view, and the runtime's address was never a setting. */
    applySettings(next) {
      this.settings = normalizeSettings(next);
      return this.settings;
    }
    scope() {
      return resolveScope(this.settings);
    }
    viewDeps(scope = this.scope()) {
      return {
        store: this.store,
        scope,
        context: this.context(),
        bridge: this.bridge,
        sendToAgent: (turn, onProgress) => this.sendTurn(turn, onProgress),
        cancelAgentTurn: () => this.cancelTurn(),
        executeCard: (card, context) => this.executeCard(card, context),
        previewControlCard: (card) => this.previewControlCard(card),
        undoControlAction: (undo) => this.undoControlAction(undo),
        executeRun: (run, context) => this.executeRun(run, context),
        copyText: (text6) => this.copyText(text6),
        connectBridge: () => {
          void this.bridge.discover();
        },
        // The page's "连接运行时" button: the one page action that may start a
        // process. Kept apart from `connectBridge` on purpose.
        connectRuntime: () => this.connect(),
        getAgents: () => this.listAgents(),
        tools: {
          request: (path2, options) => this.toolRequest(path2, options),
          askAgent: (prompt, options) => this.askAgent(prompt, options),
          scope: () => this.toolScope(),
          ...this.host.sleep ? { sleep: this.host.sleep } : {}
        },
        // The workbench: every entry is a real Bridge route. Binding a project
        // is a settings write, so the host (main.ts) adds it.
        workbench: {
          searchLiterature: (query) => this.searchLiterature(query),
          downloadOpenAccess: (searchId, openalexId) => this.downloadOpenAccess(searchId, openalexId),
          listProjects: () => this.listProjects(),
          listIdeas: () => this.listIdeas(),
          agentMemory: () => this.agentMemory(),
          runHistory: () => this.runHistory(),
          fullLane: {
            preview: (prompt) => this.fullTaskPreview(prompt),
            dispatch: (preview, prompt) => this.fullTaskDispatch(preview, prompt),
            probe: (adapter) => this.fullTaskProbe(adapter),
            status: (id) => this.fullTaskStatus(id),
            cancel: (id) => this.fullTaskCancel(id)
          }
        }
      };
    }
    /** What the product bar and the project panel describe. A copy, so a view
     * holds the values it was opened with. */
    context() {
      return {
        projectId: this.settings.projectId,
        flowId: this.settings.flowId,
        agentId: this.settings.agentId,
        workspaceRoot: this.settings.workspaceRoot
      };
    }
    /**
     * The agents the runtime reports, from `GET /v1/agents`.
     *
     * Never connects: with no runtime online the answer is the configured agent,
     * marked not ready, and no request is made. Nothing is probed from the
     * plugin's own process — which commands are on PATH is the runtime's
     * business, and it already reports it. Nothing is cached across calls
     * either: the page asks once per online period, so a reconnect re-reads.
     *
     * A body that does not parse is an error, not an empty list: the page shows
     * why the picker has nothing in it.
     */
    async listAgents() {
      const current = this.settings.agentId;
      if (!this.bridge.isOnline) {
        return current ? [{ id: current, label: current, ready: false, detail: "运行时未连接" }] : [];
      }
      const result = await this.bridge.request(AGENTS_PATH2);
      if (!result.ok) throw new Error(`读取 Agent 列表失败：${result.error}`);
      const parsed = agentOptionsFromResponse(result.data);
      if (parsed.error) throw new Error(parsed.error);
      return parsed.agents;
    }
    /** Make `agentId` the one the next turn is dispatched to. In memory only:
     * writing `data.json` is the plugin's job, and it calls this after. */
    selectAgent(agentId) {
      return this.applySettings({ ...this.settings, agentId });
    }
    /** What the diagnostics section shows: no address a person could type, only
     * the one a process reported. */
    diagnostics() {
      return {
        status: this.bridge.status,
        origin: this.bridge.origin,
        reason: this.bridge.lastReason,
        recordPath: this.bridge.recordPath
      };
    }
    /** Find a runtime without starting one. */
    discover() {
      return this.bridge.discover();
    }
    /** Adopt or start one. An explicit action, and the only path that spawns. */
    connect() {
      return this.bridge.connect();
    }
    /** Give the runtime back on unload: the process tree if this plugin started
     * it, and the in-memory state either way. */
    dispose() {
      return this.bridge.dispose();
    }
    /** The transcript as text, copied to the host's clipboard. A vault read and a
     * clipboard write: available with the runtime down, like the history it
     * copies. */
    copyText(text6) {
      const clipboard = globalThis.navigator?.clipboard;
      if (!clipboard || typeof clipboard.writeText !== "function") {
        return Promise.reject(new Error("当前宿主没有剪贴板接口"));
      }
      return clipboard.writeText(text6);
    }
    /* --------------------------------------------------------- dispatch -- */
    /**
     * Send one persisted researcher turn to an agent and wait for its reply.
     *
     * The turn is already on disk when this is called — the page saves before it
     * dispatches, and a turn that could not be saved is never sent — so the only
     * thing that can be lost here is the reply, and a lost reply is reported as
     * an error turn rather than as a silence. The reply is returned, not written;
     * the page persists it before it counts as finished.
     */
    async sendTurn(turn, onProgress) {
      const report = (progress) => {
        try {
          onProgress?.(progress);
        } catch {
        }
      };
      const turnState = { cancelled: false, taskId: "" };
      this.activeTurn = turnState;
      try {
        return await this.runTurn(turn, report, turnState);
      } finally {
        if (this.activeTurn === turnState) this.activeTurn = null;
      }
    }
    /** The turn in flight, so 「停止」 can reach it. */
    activeTurn = null;
    /**
     * Stop the turn in flight: no task is created if it has not been yet, and a
     * running one is terminated by the Bridge (the whole agent process tree).
     * Nothing the agent already proposed is executed by this — proposals only
     * run from a confirmed card.
     */
    async cancelTurn() {
      const turn = this.activeTurn;
      if (!turn) return "当前没有进行中的织研者任务。";
      turn.cancelled = true;
      if (!turn.taskId) return "已停止：任务还没有交给 Agent。";
      const sent = await this.bridge.request(`${TASK_PATH}/${encodeURIComponent(turn.taskId)}/cancel`, { method: "POST", timeoutMs: 15e3 });
      return sent.ok ? "已停止：Agent 进程已终止。" : `已停止等待，但运行时没有确认终止（${sent.error}）；它可能仍在后台运行一会儿。`;
    }
    async runTurn(turn, report, turnState) {
      const agentId = this.settings.agentId;
      if (!agentId) return errorReply("未配置 Agent id（织研者设置 → Agent id），无法派发任务。");
      const cwd = this.workspaceRoot();
      if (!cwd) return errorReply("未配置工作区路径（织研者设置 → 工作区路径）；运行时不会接受没有 cwd 的任务。");
      if (!await this.ensureStarted()) {
        return errorReply(`运行时未连接，任务没有派发：${this.bridge.lastReason ?? "原因未知"}`);
      }
      const text6 = turn.message.text;
      report({ phase: "context", steps: ["正在读取课题资料、长期记忆与文献库…"] });
      const [context, noteAnchorBlock, controlAnchorBlock] = await Promise.all([
        this.researchContext(text6),
        describeAnchorsBlock(this.anchorReadApi(), text6).catch((error) => `

【Scholarium 本地 describe】
读取失败：${error instanceof Error ? error.message : String(error)}
`),
        describeControlAnchorsBlock((action, input = {}) => this.controlStateRead(action, input), text6).catch((error) => `

【Scholarium P2 本地 describe】
读取失败：${error instanceof Error ? error.message : String(error)}
`)
      ]);
      const prompt = buildWeaverPrompt({
        message: text6,
        history: turn.history ?? [turn.message],
        agentId,
        taskGoal: context.taskGoal,
        workspace: cwd,
        ragBlock: context.ragBlock,
        memoryBlock: context.memoryBlock,
        projectBlock: context.projectBlock,
        anchorBlock: `${noteAnchorBlock}${controlAnchorBlock}${this.imageBlock(text6)}`
      });
      if (turnState.cancelled) return stoppedReply([]);
      const created = await this.bridge.request(TASK_PATH, {
        method: "POST",
        body: { agentId, cwd, prompt, permission: "read", execute: true }
      });
      if (!created.ok) return errorReply(`无法派发任务：${created.error}`);
      const taskId = typeof created.data?.id === "string" ? created.data.id : "";
      if (!taskId) return errorReply("运行时没有返回任务号，无法等待结果。");
      turnState.taskId = taskId;
      if (turnState.cancelled) {
        await this.bridge.request(`${TASK_PATH}/${encodeURIComponent(taskId)}/cancel`, { method: "POST", timeoutMs: 15e3 });
        return stoppedReply([], taskId);
      }
      report({ phase: "dispatched", steps: [`已交给 ${agentId}，等待它开始…`], taskId });
      const reply = await this.awaitTask(taskId, agentId, (steps) => report({ phase: "running", steps, taskId }), () => turnState.cancelled);
      if (reply && reply.role === "agent") void this.checkpoint(text6, reply.text);
      return reply;
    }
    /** The researcher's attached images, as absolute paths the agent can Read. */
    imageBlock(text6) {
      const base = this.workspaceBase();
      const refs = [...String(text6 ?? "").matchAll(/!\[([^\]]*)\]\((?:<([^>\n]+)>|([^)\s]+))\)/g)].map((match) => ({ alt: match[1] ?? "", path: decodeSafe(match[2] ?? match[3] ?? "").replace(/\\/g, "/") })).filter((ref) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ref.path) && !ref.path.includes("..") && !/^[a-z]+:/i.test(ref.path)).slice(0, 8);
      if (!refs.length || !base) return "";
      const sep = base.includes("\\") ? "\\" : "/";
      const lines = refs.map((ref) => `- ${ref.alt || "图片"}：${base}${sep}${ref.path.split("/").join(sep)}`);
      return `

【研究员附带的图片（Vault 内，可用 Read 查看）】
${lines.join("\n")}
`;
    }
    workspaceBase() {
      const adapter = this.host.vault.adapter;
      const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
      return typeof basePath === "string" ? basePath.replace(/[\\/]+$/, "") : "";
    }
    /** Read-only Vault surface for P1 anchor describe. It walks the local Vault
     * adapter and never asks the Bridge or a remote service. */
    anchorReadApi() {
      const adapter = this.host.vault.adapter;
      return {
        kind: async (path2) => await adapter.exists(path2) ? "file" : null,
        read: (path2) => adapter.read(path2),
        listMarkdownPaths: async () => {
          const pending = [""];
          const seen = /* @__PURE__ */ new Set();
          const files = [];
          while (pending.length && seen.size < 2e4) {
            const folder = pending.shift();
            if (seen.has(folder)) continue;
            seen.add(folder);
            let listing;
            try {
              listing = await adapter.list(folder);
            } catch {
              continue;
            }
            for (const file of listing.files) if (/\.md$/i.test(file)) files.push(file.replace(/\\/g, "/"));
            for (const child of listing.folders) pending.push(child.replace(/\\/g, "/"));
          }
          return files;
        }
      };
    }
    /**
     * What one turn is told besides the conversation: the corpus hits, the
     * long-term memory, and — when a project is bound — its L0 state. Each read
     * is best-effort and independent: a service that is down is an empty block,
     * and a project that cannot be read is the "未验证" block, never a guess.
     */
    async researchContext(query) {
      const rag = await this.bridge.request(RAG_PATH2, { method: "POST", body: { query, k: 4 }, timeoutMs: 6e4 });
      const memory = await this.bridge.request(`${MEMORY_CONTEXT_PATH}?query=${encodeURIComponent(query.slice(0, 2e3))}`, { timeoutMs: 2e4 });
      const projectId = this.settings.projectId;
      let project = null;
      let outcomes = null;
      let drift = null;
      let error = "";
      let taskGoal = "";
      if (projectId) {
        const got = await this.stateRead("project.get", { display_id: projectId });
        if (got.ok) {
          project = got.result;
          const uid = typeof got.result?.project?.uid === "string" ? got.result.project.uid : "";
          const title = got.result?.project?.title ?? got.result?.project?.question;
          taskGoal = typeof title === "string" ? title : "";
          const scanned = await this.stateRead("experiment.scan_outcomes", { project_uid: uid });
          outcomes = scanned.ok ? scanned.result : null;
          if (uid) {
            const audited = await this.stateRead("workspace.timeblock_drift_audit", { project_uid: uid });
            drift = audited.ok ? audited.result : null;
          }
        } else {
          error = got.error;
        }
      }
      return {
        ragBlock: rag.ok ? ragBlockFrom(rag.data) : "",
        memoryBlock: memory.ok ? memoryBlockFrom(memory.data) : "",
        projectBlock: projectBlock(projectId, project, outcomes, error, drift),
        taskGoal
      };
    }
    /** One L0 read through `GET /v1/scholarium/state`. Never throws. */
    async stateRead(action, input = {}) {
      const query = new URLSearchParams({ action, input: JSON.stringify(input) }).toString();
      const read = await this.bridge.request(`${STATE_PATH3}?${query}`, { timeoutMs: 3e4 });
      if (!read.ok) return { ok: false, error: read.error };
      return { ok: true, result: read.data?.result ?? null };
    }
    /** P2 article describe has a local read fallback during Bridge upgrades.
     * It projects only the RSS board's public item fields, never the surrounding
     * plugin settings (where local credentials can live). Other P2 namespaces
     * remain on their existing Bridge L0 action routes. */
    async controlStateRead(action, input = {}) {
      if (action !== "rss.list_articles") return this.stateRead(action, input);
      const adapter = this.host.vault.adapter;
      const paths = [
        ".obsidian/plugins/obsidian-scholarium/data.json",
        ".obsidian/plugins/scholarium/data.json"
      ];
      for (const path2 of paths) {
        try {
          if (!await adapter.exists(path2)) continue;
          const data = JSON.parse(await adapter.read(path2));
          const board = data?.rssBoard ?? {};
          const wanted = String(input.article_id ?? "").trim();
          const articles = (Array.isArray(board.articles) ? board.articles : []).filter((item) => !wanted || String(item?.id ?? "") === wanted).slice(0, wanted ? 1 : 500);
          const feeds = (Array.isArray(board.feeds) ? board.feeds : []).slice(0, 200);
          return { ok: true, result: { articles, feeds } };
        } catch (error) {
          return { ok: false, error: `RSS 本地只读失败：${error instanceof Error ? error.message : String(error)}` };
        }
      }
      return { ok: false, error: "没有找到 RSS 订阅数据文件" };
    }
    /**
     * The task checkpoint and the memory suggestions a reply carries, filed the
     * way the deployed shell filed them: the checkpoint overwrites
     * `task-checkpoint.md`, suggestions land as 待确认 entries for the researcher
     * to promote. Best-effort, after the reply is already on its way.
     */
    async checkpoint(question, replyText) {
      try {
        await this.bridge.request(MEMORY_CHECKPOINT_PATH, {
          method: "POST",
          body: { lastQuestion: question, replyExcerpt: checkpointExcerpt(replyText) }
        });
        for (const suggestion of memorySuggestions(replyText)) {
          await this.bridge.request(MEMORY_ENTRY_PATH, {
            method: "POST",
            body: { file: suggestion.file, title: suggestion.title, body: suggestion.body, status: "待确认" }
          });
        }
      } catch {
      }
    }
    /* -------------------------------------------------------- workbench -- */
    /**
     * Multi-source literature search (OpenAlex / PubMed / Semantic Scholar /
     * Scopus), exactly the Bridge route the deployed "检索开放文献" used. When the
     * query has at least two parenthesised blocks and returns nothing, it is
     * retried once without the last block — the deployed `broadenQuery`.
     */
    async searchLiterature(query) {
      if (!await this.ensureStarted()) throw new Error(`运行时未连接：${this.bridge.lastReason ?? "原因未知"}`);
      const cwd = this.workspaceRoot();
      const run = async (value) => {
        const found = await this.bridge.request(LITERATURE_SEARCH_PATH, {
          method: "POST",
          body: { workspace: cwd, query: value },
          timeoutMs: 18e4
        });
        if (!found.ok) throw new Error(`检索失败：${found.error}`);
        return literatureFrom(found.data, value);
      };
      const first = await run(query);
      if (first.records.length) return first;
      const wider = broadenQuery(query);
      if (!wider) return first;
      const retry = await run(wider);
      return retry.records.length ? retry : first;
    }
    /** Download one open-access PDF from a search that is still live (30 min on
     * the Bridge). The confirmation is the researcher's click; `confirm: true`
     * is only ever sent from that click. */
    async downloadOpenAccess(searchId, openalexId) {
      const saved = await this.bridge.request(
        `${LITERATURE_PREFIX}/${encodeURIComponent(searchId)}/download`,
        { method: "POST", body: { openalexId, confirm: true }, timeoutMs: 12e4 }
      );
      if (!saved.ok) {
        throw new Error(saved.status === 410 ? "这次检索已过期（Bridge 只保留 30 分钟），请重新检索后再下载。" : `下载失败：${saved.error}`);
      }
      return { path: String(saved.data?.path ?? ""), title: String(saved.data?.title ?? "") };
    }
    /* ---------------------------------------------------- full lane ----- */
    /**
     * Step 1 of the full-permission lane: a preview. Starts nothing; it returns
     * what the researcher is about to confirm (category, network, write scope,
     * adapter and its enforcement level), valid for a limited time.
     */
    async fullTaskPreview(prompt) {
      if (!await this.ensureStarted()) throw new Error(`运行时未连接：${this.bridge.lastReason ?? "原因未知"}`);
      const made = await this.bridge.request(FULL_TASKS_PATH + "/preview", {
        method: "POST",
        body: { category: FETCH_CATEGORY, workspace: this.workspaceRoot(), prompt },
        timeoutMs: 2e4
      });
      if (!made.ok) throw new Error(`操作预览失败：${made.error}`);
      const preview = fullTaskPreviewFrom(made.data);
      if (!preview) throw new Error("运行时没有返回预览编号。");
      return preview;
    }
    /**
     * Step 2, only after the researcher confirmed that preview: dispatch with
     * its id and the byte-identical prompt. A capability-probe refusal comes
     * back as `{ probe }` rather than an error, because it is a step the
     * researcher can take, and the preview is not consumed by it.
     */
    async fullTaskDispatch(preview, prompt) {
      const sent = await this.bridge.request(FULL_TASKS_PATH, {
        method: "POST",
        body: { previewId: preview.id, category: preview.category, workspace: this.workspaceRoot(), prompt },
        timeoutMs: 2e4
      });
      if (!sent.ok) {
        const gate = probeGateFromError(sent.status, sent.error);
        if (gate) return { probe: gate };
        throw new Error(`派发失败：${sent.error}`);
      }
      const id = typeof sent.data?.id === "string" ? sent.data.id : "";
      if (!id) throw new Error("运行时没有返回任务编号。");
      return { id, adapter: String(sent.data?.adapter ?? ""), enforcement: String(sent.data?.enforcement ?? "") };
    }
    /** The capability probe a -full adapter must pass before it takes a task: a
     * real, minimal agent run (one to two minutes). */
    async fullTaskProbe(adapter) {
      const probed = await this.bridge.request(FULL_TASKS_PATH + "/probe", {
        method: "POST",
        body: { adapter },
        timeoutMs: 24e4
      });
      if (probed.ok && probed.data?.ok === true) return { ok: true, detail: "" };
      return { ok: false, detail: probed.ok ? "探测未通过" : probed.error };
    }
    async fullTaskStatus(id) {
      const read = await this.bridge.request(`${FULL_TASKS_PATH}/${encodeURIComponent(id)}`, { timeoutMs: 15e3 });
      if (!read.ok) {
        if (read.status === 404) return { found: false, run: null };
        throw new Error(read.error);
      }
      return { found: true, run: read.data ?? null };
    }
    async fullTaskCancel(id) {
      const sent = await this.bridge.request(`${FULL_TASKS_PATH}/${encodeURIComponent(id)}/cancel`, { method: "POST", timeoutMs: 15e3 });
      if (!sent.ok) throw new Error(`取消失败：${sent.error}`);
    }
    /** The project registry: `project.list`, read-only. */
    async listProjects() {
      const read = await this.stateRead("project.list", {});
      if (!read.ok) throw new Error(read.error);
      return projectsFrom(read.result);
    }
    /** Idea cards: `idea.list`, read-only. */
    async listIdeas() {
      const read = await this.stateRead("idea.list", {});
      if (!read.ok) throw new Error(read.error);
      return ideasFrom(read.result);
    }
    /** The runtime's own run history (`/v1/history`), read-only. */
    async runHistory() {
      const read = await this.bridge.request(HISTORY_PATH2, { timeoutMs: 2e4 });
      if (!read.ok) throw new Error(read.error);
      return historyFrom(read.data);
    }
    /** The long-term memory files under `.scholarium/agent/`, read-only. */
    async agentMemory() {
      const read = await this.bridge.request(MEMORY_PATH, { timeoutMs: 2e4 });
      if (!read.ok) throw new Error(read.error);
      const files = {};
      for (const [name, value] of Object.entries(read.data?.files ?? {})) files[name] = typeof value === "string" ? value : "";
      return files;
    }
    async awaitTask(taskId, provider, onSteps, stopped) {
      let lastCount = -1;
      let lastSteps = [];
      const pollInterval = Math.max(0, this.host.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
      const polls = Math.max(1, this.host.maxPolls ?? DEFAULT_MAX_POLLS);
      for (let attempt = 0; attempt < polls; attempt += 1) {
        if (attempt > 0 && pollInterval > 0) await this.wait(pollInterval);
        if (stopped?.()) return stoppedReply(lastSteps, taskId);
        const result = await this.bridge.request(`${TASK_PATH}/${encodeURIComponent(taskId)}`);
        if (!result.ok) return errorReply(`无法读取任务 ${taskId}：${result.error}`, taskId);
        const status = typeof result.data?.status === "string" ? result.data.status : "";
        if (onSteps && status !== "completed") {
          const steps = progressSteps(result.data);
          lastSteps = steps;
          if (steps.length !== lastCount) {
            lastCount = steps.length;
            try {
              onSteps(steps);
            } catch {
            }
          }
        }
        if (status === "completed") {
          return {
            role: "agent",
            text: taskText(result.data) || "任务完成，但没有返回可展示的结果。",
            taskId,
            provider
          };
        }
        if (status === "cancelled") return stoppedReply(lastSteps, taskId);
        if (status === "failed") {
          return errorReply(taskText(result.data) || `任务结束：${status}`, taskId);
        }
      }
      return errorReply(`等待任务 ${taskId} 超时；它可能仍在运行，请稍后在运行时里查看。`, taskId);
    }
    /**
     * Run a confirmed card. Called only from the page's click handler, and only
     * after the card's `claimed` event is on disk — `context.operationId` is that
     * claim, and it is sent as `x-scholarium-operation-id` so the ledger on the
     * other end can recognise a second delivery of the same ticket.
     *
     * Only two kinds reach here, because only two can be produced: the card
     * parser in `src/features/chat/model.ts` reads `action` and `draft` blocks
     * out of a reply and nothing else. The other six kinds exist in the state
     * machine but have no card to click, so a wiring that pretended to dispatch
     * them would be a contract invented in this file. Such a card throws, and the
     * page records it as failed with the reason — loud, and impossible to mistake
     * for a write that happened.
     */
    async executeCard(card, context) {
      const client = this.dispatchClient(context.operationId);
      if (!client) {
        return { status: "failed", detail: "运行时没有报告地址，本次确认没有投递。" };
      }
      let before = null;
      if (card.kind === "action" && card.anchor) {
        try {
          before = await verifyControlAction(
            (action, input = {}) => this.controlStateRead(action, input),
            { action: card.action ?? "", input: card.input ?? {}, anchor: card.anchor, base: card.base ?? "" }
          );
        } catch (error) {
          return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
        }
      }
      if (card.kind === "action" && EDIT_ACTIONS.has(card.action ?? "")) {
        return executeEditAction(client, card.action ?? "", card.input ?? {});
      }
      if (card.kind === "action") {
        const outcome = await this.submitQueuedAction(client, card.action ?? "", card.input ?? {}, context.operationId);
        if (outcome.status !== "executed" || !before || !card.anchor) return outcome;
        return { ...outcome, ...await this.undoFor(before, card.action ?? "", card.input ?? {}) };
      }
      if (card.kind === "draft") {
        const preview = await client.request(DRAFT_BATCH_PATH, {
          method: "POST",
          // schema-v1 objects are vault-level state: the deployed shell's
          // 2026-08-26 fix pins them to `scholarium-vault`, never workspaceRoot.
          body: {
            items: card.items ?? [],
            base: "scholarium-vault",
            serverManagedMetadata: true,
            projectDisplayId: this.settings.projectId ?? ""
          }
        });
        if (!preview.ok) return { status: "failed", detail: `草稿预览未通过：${preview.error}` };
        const batchId = typeof preview.data?.id === "string" ? preview.data.id : "";
        if (!batchId) return { status: "failed", detail: "运行时没有返回预览批次号，未提交。" };
        const commit = await client.request(
          `${DRAFT_BATCH_PATH}/${encodeURIComponent(batchId)}/commit`,
          { method: "POST", body: {} }
        );
        if (!commit.ok) return { status: "failed", detail: `提交未通过：${commit.error}` };
        return { status: "executed", detail: `运行时已受理（HTTP ${commit.status}，操作 ${context.operationId}）。` };
      }
      throw new Error(`这个版本的接线没有为 ${card.kind} 定义派发路径；它没有被投递。`);
    }
    /**
     * Execute the native conversation Pipeline. The old canvas implemented the
     * orchestration in browser globals; this path keeps the same Bridge-owned
     * Skills and durable run history, but has no dependency on that iframe.
     *
     * Each external effect travels through the one operation-scoped client made
     * after the researcher claimed the card. A reload after the claim therefore
     * leaves the card in reconciliation rather than starting another Pipeline.
     */
    async executeRun(run, context) {
      if (run.operation !== "pipeline.run") {
        return { status: "failed", detail: `原生页面尚未为 ${run.operation} 接入执行链路。` };
      }
      const client = this.dispatchClient(context.operationId);
      if (!client) return { status: "failed", detail: "运行时没有报告地址，本次 Pipeline 没有投递。" };
      const workspace = this.workspaceRoot();
      if (!workspace) return { status: "failed", detail: "未配置工作区路径；Pipeline 不会猜测写入位置。" };
      const topic = String(run.topic ?? "").trim();
      if (!topic) return { status: "failed", detail: "Pipeline 缺少研究主题。" };
      const history = await client.request(PIPELINE_RUNS_PATH2, {
        method: "POST",
        body: { title: topic.slice(0, 160), workspace },
        timeoutMs: 2e4
      });
      if (!history.ok) return { status: "failed", detail: `无法建立 Pipeline 历史：${history.error}` };
      const historyId = typeof history.data?.id === "string" ? history.data.id : "";
      if (!historyId) return { status: "failed", detail: "运行时没有返回 Pipeline 历史号，未启动。" };
      const steps = [];
      let catalogPath = "";
      let manualQueue = [];
      const checkpoint = async (status) => {
        const saved = await client.request(`${PIPELINE_RUNS_PATH2}/${encodeURIComponent(historyId)}`, {
          method: "PATCH",
          body: { status, steps },
          timeoutMs: 2e4
        });
        return saved.ok;
      };
      const fail2 = async (detail) => {
        steps.push({ title: "Pipeline", detail, state: "error" });
        await checkpoint("failed");
        return { status: "failed", detail: `${detail}（历史 ${historyId}）`, catalogPath, manualQueue };
      };
      try {
        const listed = await client.request(SKILLS_PATH2, { timeoutMs: 2e4 });
        if (!listed.ok) return fail2(`无法读取本机 Skill：${listed.error}`);
        const skills = Array.isArray(listed.data?.skills) ? listed.data.skills : [];
        const stage = async (slug2, title, input) => {
          steps.push({ title, detail: `正在运行 ${slug2}`, state: "pending" });
          await checkpoint("running");
          const skillId = pipelineSkillId3(skills, slug2);
          if (!skillId) throw new Error(`未找到本机 Skill：${slug2}`);
          const created = await client.request(SKILL_RUNS_PATH2, {
            method: "POST",
            body: { skillId, workspace, input },
            timeoutMs: 2e4
          });
          if (!created.ok) throw new Error(`${slug2} 未受理：${created.error}`);
          const runId = typeof created.data?.id === "string" ? created.data.id : "";
          if (!runId) throw new Error(`${slug2} 没有返回运行号`);
          const output = await this.awaitPipelineSkill(client, runId, slug2);
          const row = steps.at(-1);
          if (row) {
            row.state = "done";
            row.detail = pipelineStepDetail(slug2, output);
          }
          await checkpoint("running");
          return output;
        };
        const queryBuilder = await stage("literature-search-query-builder", "第 1 步 · 检索式", topic);
        const query = textAt(queryBuilder, ["manifest", "query_v1_after_record_sampling"]) || textAt(queryBuilder, ["manifest", "query_v0"]);
        if (!query) return fail2("检索式为空，质量门已停止 Pipeline");
        const primary = await stage("nature-academic-search", "第 2 步 · 精排检索", query);
        const broad = await stage("pop8-scholar-search", "第 3 步 · 广召回检索", query);
        const records = [...recordsAt(primary), ...recordsAt(broad)];
        if (!records.length) return fail2("两个检索源都没有返回记录，未进入下载或写入阶段");
        const deduped = await stage("reference-export-dedupe", "第 4 步 · 去重与导出", JSON.stringify({ records }));
        catalogPath = textAt(deduped, ["manifest", "catalog_path"]);
        const download = await stage("paper-downloader", "第 5 步 · 获取 PDF", JSON.stringify({
          // The legacy dedupe Skill writes its canonical list to exports rather
          // than echoing it in the manifest. Passing the bounded in-memory
          // candidates is therefore the same data thread it receives there.
          records,
          headless: true,
          browser_workers: 1
        }));
        catalogPath = textAt(download, ["manifest", "catalog_path"]) || catalogPath;
        const attempts = Array.isArray(asRecord2(download.manifest).results) ? asRecord2(download.manifest).results : [];
        manualQueue = buildManualDownloadQueue(records, attempts).map((item) => ({ ...item, pipelineRunId: historyId, workspace }));
        const pdfPaths = stringsAt(download, ["manifest", "downloaded_paths"]);
        if (!pdfPaths.length) return fail2(downloadGateStop(download).reason);
        const reader = await stage("nature-reader", "第 6 步 · 证据卡片", JSON.stringify({ pdf_paths: pdfPaths }));
        const cards = Array.isArray(asRecord2(reader.manifest).cards) ? asRecord2(reader.manifest).cards : [];
        const usableCards = cards.filter((value) => {
          const card = asRecord2(value);
          const claims = Array.isArray(card.claim_candidates) ? card.claim_candidates.map(String).filter(Boolean) : [];
          return card.evidence_tier !== "unreadable_pdf" && claims.some((claim) => !/^\s*%PDF-/i.test(claim) && claim.length >= 80);
        });
        if (!usableCards.length) return fail2("PDF 没有提取出可用正文；已阻止空证据继续生成图谱和写作");
        await stage("obsidian-bases", "第 8 步 · 文献笔记", "");
        const extracted = await this.askAgent(buildExtractionPrompt({ question: topic, cards: usableCards }), { timeoutMs: 24e4 });
        if (!extracted.ok) return fail2(`知识图谱语义抽取失败：${extracted.error}`);
        const graph = parseGraphReply(extracted.text);
        if (!graph.nodes.length || !graph.edges.length) return fail2("Agent 返回了空知识图谱；未写入空图");
        const renderedGraph = await stage("zrl-knowledge-graph", "第 9 步 · 知识图谱", JSON.stringify({
          title: `${topic.slice(0, 80)} · 知识图谱`,
          research_question: topic,
          card_source_paths: pdfPaths,
          graph
        }));
        const graphManifest = asRecord2(renderedGraph.manifest);
        if (!(Number(graphManifest.nodes) > 0) || !(Number(graphManifest.edges) > 0)) return fail2("知识图谱渲染结果为空；未把空图当作成功");
        await stage("deep-research", "第 10 步 · 证据综述", JSON.stringify({ card_source_paths: pdfPaths }));
        await stage("nature-writing", "第 11 步 · 手稿初稿", "");
        await stage("nature-polishing", "第 12 步 · 手稿润色", "");
        await checkpoint("completed");
        const cardCount = Number(textAt(reader, ["manifest", "card_count"]) || 0);
        return {
          status: "executed",
          detail: `Pipeline 已完成：${records.length} 条候选、${pdfPaths.length} 篇本轮 PDF、${cardCount} 张证据卡（历史 ${historyId}，操作 ${context.operationId}）。`,
          reply: { role: "agent", provider: "native-pipeline", text: `原生 Pipeline 已完成。主题：${topic}
候选文献：${records.length} 条；本轮 PDF：${pdfPaths.length} 篇；证据卡：${cardCount} 张。
运行历史：${historyId}` },
          catalogPath,
          manualQueue
        };
      } catch (error) {
        return fail2(errorMessage(error));
      }
    }
    /** Polls the Bridge-owned async Skill record. It intentionally has no
     * automatic retry: after a card was claimed a second submission could write
     * a second batch, so an uncertain result is reported for reconciliation. */
    async awaitPipelineSkill(client, runId, slug2) {
      const pollInterval = Math.max(500, this.host.pollIntervalMs ?? 2e3);
      const polls = Math.max(1, this.host.maxPolls ?? 900);
      for (let attempt = 0; attempt < polls; attempt += 1) {
        if (attempt > 0) await this.wait(pollInterval);
        const read = await client.request(
          `${SKILL_RUNS_PATH2}/${encodeURIComponent(runId)}`,
          { timeoutMs: 2e4 }
        );
        if (!read.ok) throw new Error(`无法读取 ${slug2} 状态：${read.error}`);
        const status = String(read.data?.status ?? "");
        if (status === "completed") return asRecord2(read.data?.output);
        if (status === "failed" || status === "cancelled") throw new Error(`${slug2} ${status}：${String(read.data?.error ?? "未提供原因")}`);
      }
      throw new Error(`${slug2} 等待超时；该步骤可能仍在运行，请在运行历史中核对，不会自动重跑。`);
    }
    /* ---------------------------------------------------------- plumbing -- */
    /**
     * A start that an explicit action asked for.
     *
     * `action` is only used in the doc comment's sense of "who asked": the reason
     * a start failed is already a full sentence on the bridge, and this returns
     * whether there is a runtime now.
     */
    /**
     * A Bridge request for a migrated tool. `confirmed` sends the host's
     * explicit-click marker (Scholarium's proxy forwards only that); a tool sets
     * it only after the researcher confirmed that exact action.
     */
    async toolRequest(path2, options = {}) {
      const { confirmed, ...rest } = options;
      if (!confirmed) {
        const result2 = await this.bridge.request(path2, rest);
        return result2.ok ? { ok: true, status: result2.status, data: result2.data } : { ok: false, error: result2.error, status: result2.status };
      }
      if (!await this.ensureStarted()) return { ok: false, error: `运行时未连接：${this.bridge.lastReason ?? "原因未知"}`, status: null };
      const client = this.dispatchClient(`tool-${Date.now().toString(36)}`);
      if (!client) return { ok: false, error: "运行时没有报告地址", status: null };
      const result = await client.request(path2, rest);
      return result.ok ? { ok: true, status: result.status, data: result.data } : { ok: false, error: result.error, status: result.status };
    }
    /**
     * One read-only agent task with exactly this prompt, for a tool (Idea 模式,
     * 打磨检索式 …). The chat protocol is not wrapped around it: the tool owns
     * its prompt, as the old panel did.
     */
    async askAgent(prompt, options = {}) {
      const agentId = options.agentId || this.settings.agentId;
      if (!agentId) return { ok: false, error: "未配置 Agent" };
      const cwd = this.workspaceRoot();
      if (!cwd) return { ok: false, error: "未配置工作区路径" };
      if (!await this.ensureStarted()) return { ok: false, error: `运行时未连接：${this.bridge.lastReason ?? "原因未知"}` };
      const created = await this.bridge.request(TASK_PATH, {
        method: "POST",
        body: { agentId, cwd, prompt, permission: "read", execute: true }
      });
      if (!created.ok) return { ok: false, error: `无法派发任务：${created.error}` };
      const taskId = typeof created.data?.id === "string" ? created.data.id : "";
      if (!taskId) return { ok: false, error: "运行时没有返回任务号" };
      const reply = await this.awaitTask(taskId, agentId);
      if (reply && reply.role === "agent") return { ok: true, text: reply.text, taskId };
      return { ok: false, error: reply?.text ?? "任务没有返回结果" };
    }
    /** The tool scope: the settings, with the workspace resolved. */
    toolScope() {
      return {
        projectId: this.settings.projectId,
        flowId: this.settings.flowId,
        agentId: this.settings.agentId,
        workspaceRoot: this.workspaceRoot() ?? "",
        pipelineVersion: this.settings.pipelineVersion,
        v3Timeouts: this.settings.v3.timeouts,
        // 读取处的门禁：非开发模式一律清空，无论设置文件里留了什么。
        debugFaults: this.host.devMode ? this.settings.debug.faults : []
      };
    }
    async ensureStarted() {
      if (this.bridge.isOnline) return true;
      return await this.bridge.connect() === "online";
    }
    /**
     * A one-shot client for the one request that carries a header.
     *
     * `RuntimeAdapter.request` takes no per-request headers and is part of an
     * interface this module does not own, so the operation id is attached the only
     * way left: a client over the origin the runtime reported, whose headers are
     * fixed for exactly this dispatch and which is then dropped. It starts at that
     * origin and has no candidate list, because the only address this product has
     * is the one a launcher reported.
     */
    /**
     * Queue an L1 action and wait for its real outcome. The Bridge only queues
     * it (HTTP 202); Obsidian's consumer runs it and settles the item. Saying
     * “已执行” on the 202 alone used to report writes that later failed.
     */
    async submitQueuedAction(client, action, input, operationId) {
      const result = await client.request(ACTION_PATH, {
        method: "POST",
        body: { action, input, by: REQUESTED_BY }
      });
      if (!result.ok) return { status: "failed", detail: `运行时未受理：${result.error}` };
      const id = typeof result.data?.id === "string" ? result.data.id : "";
      if (!id) return { status: "executed", detail: `运行时已受理（HTTP ${result.status}，操作 ${operationId}）。` };
      try {
        await this.host.flushActionQueue?.();
      } catch {
      }
      const interval = Math.max(0, this.host.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
      const polls = Math.max(1, this.host.actionPolls ?? 50);
      for (let attempt = 0; attempt < polls; attempt += 1) {
        if (attempt > 0 && interval > 0) await this.wait(interval);
        const read = await client.request(`${ACTION_PATH}/${encodeURIComponent(id)}`);
        if (!read.ok) continue;
        const outcome = read.data?.outcome ?? null;
        const status = typeof outcome?.status === "string" ? outcome.status : "";
        if (status === "completed") return { status: "executed", detail: `已执行（队列 ${id}）。` };
        if (status === "failed" || status === "rejected") {
          return { status: "failed", detail: `Obsidian 执行失败：${String(outcome?.error ?? "未说明原因")}` };
        }
      }
      return {
        status: "failed",
        detail: `已投递到 Obsidian 队列（${id}），但在等待时间内没有结算。它可能稍后完成——请到对应面板核实，不要重复确认；重复的请求会因版本不一致被拒绝。`
      };
    }
    /** The undo record for a confirmed P2 action, read after it ran. */
    async undoFor(before, action, input) {
      const inverse = inverseControlAction(before, action, input);
      if ("reason" in inverse) return { detail: `已执行。不可撤销：${inverse.reason}` };
      try {
        const after = await describeControlAnchor((name, value = {}) => this.controlStateRead(name, value), before.anchor);
        const undo = { anchor: before.anchor, afterVersion: after.version, ...inverse.undo };
        return { detail: `已执行，可撤销。${inverse.undo.note ? `（${inverse.undo.note}）` : ""}`, undo };
      } catch (error) {
        return { detail: `已执行；读取执行后状态失败，无法提供撤销：${error instanceof Error ? error.message : String(error)}` };
      }
    }
    /** Field changes a pending P2 card would make, against the item as it is now. */
    async previewControlCard(card) {
      if (card.kind !== "action" || !card.anchor) return { changes: [], version: "", stale: false };
      const manifest = await describeControlAnchor((name, value = {}) => this.controlStateRead(name, value), card.anchor);
      return { changes: controlChanges(manifest, card.action ?? "", card.input ?? {}), version: manifest.version, stale: Boolean(card.base) && manifest.version !== card.base };
    }
    /** Put back what a confirmed P2 action changed, if the item is still as that action left it. */
    async undoControlAction(undo) {
      const client = this.dispatchClient(`undo-${Date.now().toString(36)}`);
      if (!client) return { status: "failed", detail: "运行时没有报告地址，撤销没有投递。" };
      try {
        const now = await describeControlAnchor((name, value = {}) => this.controlStateRead(name, value), undo.anchor);
        if (now.version !== undo.afterVersion) return { status: "failed", detail: `${undo.anchor} 在修改后又被改过，没有撤销（不覆盖之后的改动）。` };
      } catch (error) {
        return { status: "failed", detail: error instanceof Error ? error.message : String(error) };
      }
      const outcome = await this.submitQueuedAction(client, undo.action, undo.input, "undo");
      return outcome.status === "executed" ? { status: "executed", detail: "已撤销这次修改。" } : outcome;
    }
    dispatchClient(operationId) {
      const origin = this.bridge.origin;
      if (!origin) return null;
      const options = {
        baseUrl: origin,
        candidates: [],
        headers: this.host.confirmationHeaders ? this.host.confirmationHeaders(operationId) : { [OPERATION_HEADER]: operationId },
        ...this.host.fetch ? { fetch: this.host.fetch } : {}
      };
      return new BridgeClient(options);
    }
    wait(ms) {
      if (this.host.sleep) return this.host.sleep(ms);
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }
    /**
     * The directory a task's `cwd` is checked against.
     *
     * The setting wins; without it, a desktop vault's adapter knows the vault's
     * own path, and that is the directory the conversation is about. `getBasePath`
     * is declared optional because the mobile adapter has no filesystem at all —
     * and when it is missing, the honest answer is "unknown", which the caller
     * turns into a visible refusal rather than a task dispatched with a guessed
     * path.
     */
    workspaceRoot() {
      if (this.settings.workspaceRoot) return this.settings.workspaceRoot;
      const adapter = this.host.vault.adapter;
      const basePath = typeof adapter.getBasePath === "function" ? adapter.getBasePath() : "";
      return typeof basePath === "string" ? basePath : "";
    }
  };

  // src/plugin/settings-modal.ts
  var SETTINGS_FIELDS = Object.freeze([
    {
      key: "projectId",
      label: "课题 ID",
      hint: "从已有课题中选择，或选“新建课题”输入名称后自动编号（PRJ-001、PRJ-002…）。选“不绑定课题”则按课题流归档。",
      section: "对话范围"
    },
    {
      key: "flowId",
      label: "课题流 ID",
      hint: "不绑定课题时使用的对话范围，按 topic:<课题流 ID> 归档。可选已有课题流，或新建一个。",
      section: "对话范围"
    },
    {
      key: "agentId",
      label: "默认 Agent",
      hint: "从运行时报告的 Agent 中选择；也可以在织研者对话上方直接切换。",
      section: "Agent 与工作区"
    },
    {
      key: "workspaceRoot",
      label: "工作区路径",
      hint: "Agent 工作目录，不是 Vault 聊天存储目录。点“选择文件夹”在仓库里挑一个位置，或新建并命名一个文件夹；留空则用 Vault 根目录。",
      section: "Agent 与工作区"
    },
    {
      key: "pipelineVersion",
      label: "Pipeline 版本",
      hint: "v2 为当前管线；v3 在改造验收通过前不可用（P0 开关，随时可退回 v2）。",
      section: "Pipeline"
    }
  ]);
  var STATUS_LABEL = {
    offline: "未连接",
    connecting: "连接中",
    online: "已连接",
    degraded: "连接中断"
  };
  var NEW_VALUE = "__sch_new__";
  var FALLBACK_AGENT_IDS = Object.freeze(["claude", "codex", "opencode", "hermes", "openclaw"]);
  function parseTimeouts(value) {
    const table = {};
    for (const part of value.split(",")) {
      const separator = part.indexOf("=");
      if (separator < 1) continue;
      const key = part.slice(0, separator).trim().slice(0, 100);
      const number = Number(part.slice(separator + 1).trim());
      if (key && Number.isFinite(number) && number > 0) table[key] = Math.round(number);
    }
    return table;
  }
  function formatTimeouts(value) {
    return Object.entries(value).map(([key, number]) => `${key}=${number}`).join(", ");
  }
  var WeaverSettingsModal = class {
    host;
    options;
    document;
    root = null;
    inputs = /* @__PURE__ */ new Map();
    scopeEl = null;
    errorEl = null;
    faultsInput = null;
    timeoutsInput = null;
    saving = false;
    memoryLoad = 0;
    constructor(host, options) {
      this.host = host;
      this.options = options;
      this.document = host.document ?? host.containerEl.ownerDocument;
    }
    isOpen() {
      return this.root !== null;
    }
    /** Draw the dialog. Synchronous: it reads nothing and waits for nothing. */
    open() {
      if (this.root) return this.root;
      const doc = this.document;
      const overlay = el4(doc, "div", { cls: "scholarium-weaver-modal", attrs: { "data-role": "settings-modal" } });
      const panel = el4(doc, "div", { cls: "scholarium-weaver-modal__panel" });
      panel.append(el4(doc, "div", { cls: "scholarium-weaver-modal__title", text: this.options.showDebug ? "织研者设置（DEV 构建）" : "织研者设置", attrs: { "data-role": "settings-title" } }));
      let section2;
      for (const field of SETTINGS_FIELDS) {
        if (field.section && field.section !== section2) {
          section2 = field.section;
          panel.append(el4(doc, "div", { cls: "scholarium-weaver-modal__section-title", text: section2 }));
        }
        const catalog = this.options.catalog ?? null;
        const rich = field.key === "projectId" && Boolean(catalog?.listProjects) || field.key === "flowId" && Boolean(catalog?.listFlows) || field.key === "workspaceRoot" && Boolean(catalog?.listFolders);
        const row = el4(doc, rich ? "div" : "label", { cls: "scholarium-weaver-modal__row", attrs: { "data-field": field.key } });
        row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__label", text: field.label }));
        if (rich && field.key === "projectId") {
          this.projectField(doc, row);
          row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__hint", text: field.hint }));
          panel.append(row);
          continue;
        }
        if (rich && field.key === "flowId") {
          this.flowField(doc, row);
          row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__hint", text: field.hint }));
          panel.append(row);
          continue;
        }
        if (rich && field.key === "workspaceRoot") {
          this.workspaceField(doc, row);
          row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__hint", text: field.hint }));
          panel.append(row);
          continue;
        }
        const input = field.key === "agentId" ? this.agentSelect(doc) : field.key === "pipelineVersion" ? this.pipelineVersionSelect(doc) : el4(doc, "input", {
          cls: "scholarium-weaver-modal__input",
          attrs: {
            type: field.secret ? "password" : "text",
            "data-setting": field.key,
            ...field.secret ? { autocomplete: "off" } : {}
          }
        });
        input.value = this.options.settings[field.key];
        input.addEventListener(field.key === "agentId" || field.key === "pipelineVersion" ? "change" : "input", () => this.refreshScope());
        this.inputs.set(field.key, input);
        row.append(input);
        row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__hint", text: field.hint }));
        panel.append(row);
      }
      this.scopeEl = el4(doc, "div", { cls: "scholarium-weaver-modal__scope", attrs: { "data-role": "scope-preview" } });
      this.errorEl = el4(doc, "div", { cls: "scholarium-weaver-modal__error", attrs: { "data-role": "settings-error" } });
      panel.append(this.scopeEl, this.errorEl);
      if (this.options.showDebug) panel.append(this.debugSection(doc));
      panel.append(this.diagnosticsSection(doc));
      panel.append(this.memorySection(doc));
      panel.append(el4(doc, "div", {
        cls: "scholarium-weaver-modal__note",
        text: "Agent 选择保存后立即用于下一次发送。课题或课题流变化需重新打开织研者，避免跨范围误写。"
      }));
      const actions2 = el4(doc, "div", { cls: "scholarium-weaver-modal__actions" });
      const cancel = el4(doc, "button", { cls: "scholarium-weaver-modal__cancel", text: "取消", attrs: { type: "button", "data-role": "settings-cancel" } });
      cancel.addEventListener("click", () => this.close());
      const save = el4(doc, "button", { cls: "scholarium-weaver-modal__save", text: "保存", attrs: { type: "button", "data-role": "settings-save" } });
      save.addEventListener("click", () => void this.save());
      actions2.append(cancel, save);
      panel.append(actions2);
      overlay.append(panel);
      this.root = overlay;
      this.refreshScope();
      this.document.body.append(overlay);
      return overlay;
    }
    close() {
      this.memoryLoad += 1;
      this.root?.remove();
      this.root = null;
      this.inputs.clear();
      this.scopeEl = null;
      this.errorEl = null;
      this.faultsInput = null;
      this.timeoutsInput = null;
    }
    /**
     * The Agent field is a choice, not a box: the ids the runtime reported (a
     * runtime refuses any other id), each with the runtime's reason when it
     * cannot run yet. The saved value is always among the options, so opening
     * and saving the dialog never changes it silently.
     */
    agentSelect(doc) {
      const select2 = el4(doc, "select", {
        cls: "scholarium-weaver-modal__input scholarium-weaver-modal__select dropdown",
        attrs: { "data-setting": "agentId", "data-role": "settings-agent" }
      });
      const reported = this.options.agents ?? [];
      const current = this.options.settings.agentId;
      const choices = reported.length ? reported.map((agent) => ({
        id: agent.id,
        label: agent.ready ? `${agent.label}${agent.label === agent.id ? "" : `（${agent.id}）`}` : `${agent.label}（${agent.detail ?? "暂不可用"}）`
      })) : FALLBACK_AGENT_IDS.map((id) => ({ id, label: `${id}（未连接运行时，尚未验证）` }));
      if (current && !choices.some((choice) => choice.id === current)) {
        choices.unshift({ id: current, label: `${current}（运行时没有这个 Agent）` });
      }
      for (const choice of choices) {
        const option = el4(doc, "option", { text: choice.label, attrs: { value: choice.id, "data-agent": choice.id } });
        option.value = choice.id;
        select2.append(option);
      }
      return select2;
    }
    /* ------------------------------------------------ choosing a project --- */
    /** A select of the real projects plus 「+ 新建课题」, which creates the
     * project files with the next free number and selects it. */
    projectField(doc, row) {
      const catalog = this.options.catalog;
      const select2 = el4(doc, "select", {
        cls: "scholarium-weaver-modal__input scholarium-weaver-modal__select dropdown",
        attrs: { "data-setting": "projectId", "data-role": "settings-project" }
      });
      let current = this.options.settings.projectId ?? "";
      const fill = (projects2, loading = false) => {
        select2.replaceChildren();
        const add = (value, label) => {
          const option = el4(doc, "option", { text: label, attrs: { value } });
          option.value = value;
          select2.append(option);
        };
        add("", "（不绑定课题，按课题流归档）");
        if (current && !projects2.some((project) => project.id === current)) add(current, `${current}（${loading ? "读取中…" : "仓库里没有这个课题"}）`);
        for (const project of projects2) add(project.id, `${project.id} · ${project.title}`);
        if (catalog.createProject) add(NEW_VALUE, "+ 新建课题（自动编号）…");
        select2.value = current;
      };
      fill([], true);
      const creator = el4(doc, "div", { cls: "scholarium-weaver-modal__inline", attrs: { "data-role": "new-project" } });
      creator.hidden = true;
      const name = el4(doc, "input", { cls: "scholarium-weaver-modal__input", attrs: { type: "text", placeholder: "新课题名称，如：CO2 电催化计算", "data-role": "new-project-name" } });
      const create = el4(doc, "button", { cls: "scholarium-weaver-modal__save", text: "创建", attrs: { type: "button", "data-role": "new-project-create" } });
      const cancel = el4(doc, "button", { cls: "scholarium-weaver-modal__cancel", text: "取消", attrs: { type: "button" } });
      const status = el4(doc, "span", { cls: "scholarium-weaver-modal__hint", attrs: { "data-role": "new-project-status" } });
      creator.append(name, create, cancel, status);
      let projects = [];
      select2.addEventListener("change", () => {
        if (select2.value === NEW_VALUE) {
          select2.value = current;
          creator.hidden = false;
          name.focus?.();
          return;
        }
        current = select2.value;
        this.refreshScope();
      });
      cancel.addEventListener("click", () => {
        creator.hidden = true;
        name.value = "";
        status.textContent = "";
      });
      const submit = async () => {
        const title = name.value.trim();
        if (!title) {
          status.textContent = "请先输入课题名称。";
          return;
        }
        create.disabled = true;
        status.textContent = "正在创建…";
        try {
          const made = await catalog.createProject(title);
          projects = [...projects.filter((project) => project.id !== made.id), made].sort((a, b) => a.id.localeCompare(b.id));
          current = made.id;
          fill(projects);
          creator.hidden = true;
          name.value = "";
          status.textContent = "";
          this.refreshScope();
          if (this.errorEl) this.errorEl.textContent = `已创建 ${made.id} · ${made.title}，点“保存”后织研者切换到这个课题。`;
        } catch (error) {
          status.textContent = `创建失败：${error instanceof Error ? error.message : String(error)}`;
        } finally {
          create.disabled = false;
        }
      };
      create.addEventListener("click", () => void submit());
      name.addEventListener("keydown", (event) => {
        const key = event;
        if (key.key === "Enter" && !key.isComposing) {
          key.preventDefault?.();
          void submit();
        }
      });
      this.inputs.set("projectId", select2);
      row.append(select2, creator);
      void catalog.listProjects().then((list4) => {
        projects = list4;
        if (this.root) fill(projects);
      }, () => {
        if (this.root) fill(projects);
      });
    }
    /** Existing flows plus 「+ 新建课题流」. A new flow is just a new name. */
    flowField(doc, row) {
      const catalog = this.options.catalog;
      const select2 = el4(doc, "select", {
        cls: "scholarium-weaver-modal__input scholarium-weaver-modal__select dropdown",
        attrs: { "data-setting": "flowId", "data-role": "settings-flow" }
      });
      let current = this.options.settings.flowId || "weaver";
      let flows = [];
      const fill = () => {
        select2.replaceChildren();
        const all = [...new Set([current, ...flows].filter(Boolean))];
        for (const flow of all) {
          const option = el4(doc, "option", { text: flow, attrs: { value: flow } });
          option.value = flow;
          select2.append(option);
        }
        const add = el4(doc, "option", { text: "+ 新建课题流…", attrs: { value: NEW_VALUE } });
        add.value = NEW_VALUE;
        select2.append(add);
        select2.value = current;
      };
      fill();
      const creator = el4(doc, "div", { cls: "scholarium-weaver-modal__inline", attrs: { "data-role": "new-flow" } });
      creator.hidden = true;
      const name = el4(doc, "input", { cls: "scholarium-weaver-modal__input", attrs: { type: "text", placeholder: "新课题流名称，如：CO2电催化-文献调研", "data-role": "new-flow-name" } });
      const ok2 = el4(doc, "button", { cls: "scholarium-weaver-modal__save", text: "添加", attrs: { type: "button", "data-role": "new-flow-add" } });
      const status = el4(doc, "span", { cls: "scholarium-weaver-modal__hint" });
      creator.append(name, ok2, status);
      select2.addEventListener("change", () => {
        if (select2.value === NEW_VALUE) {
          select2.value = current;
          creator.hidden = false;
          name.focus?.();
          return;
        }
        current = select2.value;
        this.refreshScope();
      });
      const submit = () => {
        const id = name.value.trim();
        if (!id || !/^[\w\u4e00-\u9fff-]{1,60}$/.test(id)) {
          status.textContent = "只能用中文、字母、数字、下划线和短横线（最多 60 字）。";
          return;
        }
        flows = [.../* @__PURE__ */ new Set([...flows, id])];
        current = id;
        fill();
        creator.hidden = true;
        name.value = "";
        status.textContent = "";
        this.refreshScope();
      };
      ok2.addEventListener("click", submit);
      name.addEventListener("keydown", (event) => {
        const key = event;
        if (key.key === "Enter" && !key.isComposing) {
          key.preventDefault?.();
          submit();
        }
      });
      this.inputs.set("flowId", select2);
      row.append(select2, creator);
      void catalog.listFlows().then((list4) => {
        flows = [...list4];
        if (this.root) fill();
      }, () => void 0);
    }
    /** The workspace path, chosen from the Vault's folders (or a new one). */
    workspaceField(doc, row) {
      const catalog = this.options.catalog;
      const base = (catalog.vaultBasePath?.() ?? "").replace(/[\\/]+$/, "");
      const sep = base.includes("\\") ? "\\" : "/";
      const absolute = (relative) => relative ? `${base}${sep}${relative.split("/").join(sep)}` : "";
      const relativeOf = (value) => {
        const normal = value.replace(/\\/g, "/").replace(/\/+$/, "");
        const root = base.replace(/\\/g, "/");
        if (!value) return "";
        return root && normal.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? normal.slice(root.length + 1) : "";
      };
      const input = el4(doc, "input", {
        cls: "scholarium-weaver-modal__input",
        attrs: { type: "text", "data-setting": "workspaceRoot", placeholder: base ? `${base}（Vault 根目录）` : "Vault 根目录" }
      });
      input.value = this.options.settings.workspaceRoot ?? "";
      input.addEventListener("input", () => this.refreshScope());
      const open = el4(doc, "button", { cls: "scholarium-weaver-modal__cancel", text: "选择文件夹…", attrs: { type: "button", "data-role": "pick-workspace" } });
      const picker = el4(doc, "div", { cls: "scholarium-weaver-modal__picker", attrs: { "data-role": "workspace-picker" } });
      picker.hidden = true;
      const filter = el4(doc, "input", { cls: "scholarium-weaver-modal__input", attrs: { type: "search", placeholder: "筛选文件夹" } });
      const list4 = el4(doc, "div", { cls: "scholarium-weaver-modal__picker-list" });
      const newRow = el4(doc, "div", { cls: "scholarium-weaver-modal__inline" });
      const parentLabel = el4(doc, "span", { cls: "scholarium-weaver-modal__hint" });
      const newName = el4(doc, "input", { cls: "scholarium-weaver-modal__input", attrs: { type: "text", placeholder: "新文件夹名称", "data-role": "new-folder-name" } });
      const newButton = el4(doc, "button", { cls: "scholarium-weaver-modal__save", text: "新建并选用", attrs: { type: "button", "data-role": "new-folder-create" } });
      const status = el4(doc, "span", { cls: "scholarium-weaver-modal__hint" });
      newRow.append(parentLabel, newName, newButton, status);
      picker.append(filter, list4, newRow);
      let folders = [];
      let parent = relativeOf(input.value);
      const paintParent = () => {
        parentLabel.textContent = `在「${parent || "Vault 根目录"}」下：`;
      };
      const choose = (relative) => {
        input.value = absolute(relative);
        parent = relative;
        paintParent();
        paint();
        this.refreshScope();
      };
      const paint = () => {
        const query = filter.value.trim().toLowerCase();
        const shown = folders.filter((folder) => !query || folder.toLowerCase().includes(query)).slice(0, 300);
        const item = (relative, label) => {
          const button2 = el4(doc, "button", {
            cls: `scholarium-weaver-modal__picker-item${relative === parent ? " is-selected" : ""}`,
            text: label,
            attrs: { type: "button", "data-folder": relative }
          });
          button2.addEventListener("click", () => choose(relative));
          return button2;
        };
        list4.replaceChildren(item("", "Vault 根目录（留空）"), ...shown.map((folder) => item(folder, folder)));
      };
      filter.addEventListener("input", paint);
      open.addEventListener("click", () => {
        picker.hidden = !picker.hidden;
        if (picker.hidden) return;
        paintParent();
        list4.replaceChildren(el4(doc, "div", { cls: "scholarium-weaver-modal__hint", text: "正在读取仓库文件夹…" }));
        void catalog.listFolders().then((all) => {
          folders = all;
          paint();
        }, (error) => {
          list4.replaceChildren(el4(doc, "div", { cls: "scholarium-weaver-modal__error", text: `读取文件夹失败：${error instanceof Error ? error.message : String(error)}` }));
        });
      });
      newButton.disabled = !catalog.createFolder;
      const create = async () => {
        const nameText = newName.value.trim();
        if (!nameText || /[\\/:*?"<>|]/.test(nameText) || nameText.startsWith(".")) {
          status.textContent = '名称不能为空，也不能包含 \\ / : * ? " < > | 或以点开头。';
          return;
        }
        const relative = parent ? `${parent}/${nameText}` : nameText;
        newButton.disabled = true;
        try {
          if (!folders.includes(relative)) await catalog.createFolder(relative);
          folders = [.../* @__PURE__ */ new Set([...folders, relative])].sort();
          newName.value = "";
          status.textContent = `已新建：${relative}`;
          choose(relative);
        } catch (error) {
          status.textContent = `新建失败：${error instanceof Error ? error.message : String(error)}`;
        } finally {
          newButton.disabled = false;
        }
      };
      newButton.addEventListener("click", () => void create());
      newName.addEventListener("keydown", (event) => {
        const key = event;
        if (key.key === "Enter" && !key.isComposing) {
          key.preventDefault?.();
          void create();
        }
      });
      this.inputs.set("workspaceRoot", input);
      const line2 = el4(doc, "div", { cls: "scholarium-weaver-modal__inline" });
      line2.append(input, open);
      row.append(line2, picker);
    }
    /** Pipeline 版本是二选一，不是自由文本：v3 拼错不该静默退回 v2 还让人
     * 以为在跑新管线。 */
    pipelineVersionSelect(doc) {
      const select2 = el4(doc, "select", {
        cls: "scholarium-weaver-modal__input scholarium-weaver-modal__select dropdown",
        attrs: { "data-setting": "pipelineVersion", "data-role": "settings-pipeline-version" }
      });
      for (const [value, label] of [["v2", "v2（当前管线）"], ["v3", "v3（验收中）"]]) {
        const option = el4(doc, "option", { text: label, attrs: { value } });
        option.value = value;
        select2.append(option);
      }
      return select2;
    }
    /** 故障注入栏（P0）：仅开发模式渲染。值是逗号分隔的故障名，保存时由
     * normalizeFaults 过滤掉不认识的值。 */
    debugSection(doc) {
      const section2 = el4(doc, "div", { cls: "scholarium-weaver-modal__diagnostics", attrs: { "data-role": "debug-section" } });
      section2.append(el4(doc, "div", { cls: "scholarium-weaver-modal__section-title", text: "开发调试（仅开发模式可见）" }));
      const row = el4(doc, "label", { cls: "scholarium-weaver-modal__row", attrs: { "data-field": "debug.faults" } });
      row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__label", text: "故障注入" }));
      const input = el4(doc, "input", {
        cls: "scholarium-weaver-modal__input",
        attrs: { type: "text", "data-setting": "debug.faults", "data-role": "settings-debug-faults", placeholder: "openalex-503, webvpn-expired, …" }
      });
      input.value = this.options.settings.debug.faults.join(", ");
      this.faultsInput = input;
      row.append(input);
      row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__hint", text: `可选值：${FAULT_NAMES.join("、")}。逗号分隔；不认识的值保存时丢弃。` }));
      section2.append(row);
      const timeoutRow = el4(doc, "label", { cls: "scholarium-weaver-modal__row", attrs: { "data-field": "v3.timeouts" } });
      timeoutRow.append(el4(doc, "span", { cls: "scholarium-weaver-modal__label", text: "v3 超时（毫秒）" }));
      const timeoutInput = el4(doc, "input", {
        cls: "scholarium-weaver-modal__input",
        attrs: { type: "text", "data-setting": "v3.timeouts", "data-role": "settings-v3-timeouts", placeholder: "download=60000, search.precise=30000" }
      });
      timeoutInput.value = formatTimeouts(this.options.settings.v3.timeouts);
      this.timeoutsInput = timeoutInput;
      timeoutRow.append(timeoutInput);
      timeoutRow.append(el4(doc, "span", { cls: "scholarium-weaver-modal__hint", text: "按 step id=正整数毫秒填写，逗号分隔；留空表示使用默认超时。" }));
      section2.append(timeoutRow);
      return section2;
    }
    /** What is in the boxes right now, normalized. */
    read() {
      const raw = {};
      for (const [key, input] of this.inputs) raw[key] = input.value;
      const next = normalizeSettings(raw);
      const faults = this.faultsInput ? this.faultsInput.value.split(",") : this.options.settings.debug.faults;
      const timeouts = this.timeoutsInput ? parseTimeouts(this.timeoutsInput.value) : this.options.settings.v3.timeouts;
      return { ...next, v3: { timeouts }, debug: { faults: normalizeFaults(faults) } };
    }
    /**
     * The runtime's report, drawn as text and never as an input.
     *
     * `data-role="runtime-endpoint"` carries the origin verbatim so that a check —
     * a person's or a test's — can read the same string the process reported
     * rather than a rendering of it. When there is no runtime the row says so and
     * carries the reason, which is the sentence the badge cannot fit.
     */
    diagnosticsSection(doc) {
      const section2 = el4(doc, "div", { cls: "scholarium-weaver-modal__diagnostics", attrs: { "data-role": "diagnostics" } });
      section2.append(el4(doc, "div", {
        cls: "scholarium-weaver-modal__section-title",
        text: "运行时（只读诊断）"
      }));
      const report = this.options.diagnostics;
      const status = report?.status ?? "offline";
      const origin = report?.origin ?? "";
      const row = el4(doc, "div", { cls: "scholarium-weaver-modal__diagnostic-row" });
      row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__label", text: "状态" }));
      row.append(el4(doc, "span", { cls: "scholarium-weaver-modal__diagnostic-value", text: STATUS_LABEL[status], attrs: { "data-role": "runtime-status" } }));
      section2.append(row);
      const addressRow = el4(doc, "div", { cls: "scholarium-weaver-modal__diagnostic-row" });
      addressRow.append(el4(doc, "span", { cls: "scholarium-weaver-modal__label", text: "实际地址" }));
      addressRow.append(el4(doc, "span", {
        cls: "scholarium-weaver-modal__diagnostic-value",
        text: origin || "（暂无：尚未连接）",
        attrs: { "data-role": "runtime-endpoint" }
      }));
      section2.append(addressRow);
      if (report?.recordPath) {
        const recordRow = el4(doc, "div", { cls: "scholarium-weaver-modal__diagnostic-row" });
        recordRow.append(el4(doc, "span", { cls: "scholarium-weaver-modal__label", text: "记录文件" }));
        recordRow.append(el4(doc, "span", { cls: "scholarium-weaver-modal__diagnostic-value", text: report.recordPath, attrs: { "data-role": "runtime-record" } }));
        section2.append(recordRow);
      }
      if (report?.reason) {
        section2.append(el4(doc, "div", {
          cls: "scholarium-weaver-modal__diagnostic-reason",
          text: report.reason,
          attrs: { "data-role": "runtime-reason" }
        }));
      }
      section2.append(el4(doc, "div", {
        cls: "scholarium-weaver-modal__hint",
        text: "端口由运行时自己绑定后回报，令牌留在运行时进程里：这里没有可以填错的地方。用织研者顶栏的“连接运行时”按钮（或命令“织研者：连接运行时”）启动或接入。"
      }));
      return section2;
    }
    /** Long-term Agent memory is a settings concern: it affects future turns,
     * but it is not an execution trace. The section is lazy and read-only. */
    memorySection(doc) {
      const section2 = el4(doc, "section", { cls: "scholarium-weaver-modal__memory", attrs: { "data-role": "settings-memory" } });
      const head = el4(doc, "div", { cls: "scholarium-weaver-modal__memory-head" });
      head.append(el4(doc, "div", { cls: "scholarium-weaver-modal__section-title", text: "长期记忆" }));
      const refresh = el4(doc, "button", { text: "刷新", attrs: { type: "button", "data-role": "settings-memory-refresh" } });
      head.append(refresh);
      const body = el4(doc, "div", { cls: "scholarium-weaver-modal__memory-list", attrs: { "data-role": "settings-memory-list" } });
      section2.append(head, body);
      const load = async () => {
        const reader = this.options.loadMemory;
        const turn = ++this.memoryLoad;
        if (!reader) {
          body.replaceChildren(el4(doc, "div", { cls: "scholarium-weaver-modal__hint", text: "当前宿主未接入长期记忆读取。" }));
          refresh.disabled = true;
          return;
        }
        refresh.disabled = true;
        body.replaceChildren(el4(doc, "div", { cls: "scholarium-weaver-modal__hint", text: "正在读取长期记忆…" }));
        try {
          const files = await reader();
          if (!this.root || turn !== this.memoryLoad) return;
          const names = Object.keys(files).sort();
          if (!names.length) {
            body.replaceChildren(el4(doc, "div", { cls: "scholarium-weaver-modal__hint", text: "还没有长期记忆文件（.scholarium/agent）。" }));
            return;
          }
          body.replaceChildren(...names.map((name) => {
            const details = el4(doc, "details", { cls: "scholarium-weaver-modal__memory-file" });
            details.append(
              el4(doc, "summary", { text: name }),
              el4(doc, "pre", { text: files[name] ?? "" })
            );
            return details;
          }));
        } catch (error) {
          if (!this.root || turn !== this.memoryLoad) return;
          body.replaceChildren(el4(doc, "div", { cls: "scholarium-weaver-modal__error", text: `长期记忆读取失败：${error instanceof Error ? error.message : String(error)}` }));
        } finally {
          if (this.root && turn === this.memoryLoad) refresh.disabled = false;
        }
      };
      refresh.addEventListener("click", () => void load());
      void load();
      return section2;
    }
    refreshScope() {
      if (!this.scopeEl) return;
      try {
        this.scopeEl.textContent = `本次会话写入范围：${resolveScope(this.read()).scopeKey}`;
      } catch (error) {
        this.scopeEl.textContent = `范围无效：${error instanceof Error ? error.message : String(error)}`;
      }
    }
    async save() {
      if (this.saving) return;
      this.saving = true;
      try {
        const next = this.read();
        if (next.projectId && !/^PRJ-\d{3,}$/.test(next.projectId)) {
          throw new Error(`课题 ID 必须是正式编号（如 PRJ-002），而不是课题名称“${next.projectId}”。请在“课题登记”里查到编号后填写，或留空。`);
        }
        await this.options.onSave(next);
        this.close();
      } catch (error) {
        if (this.errorEl) this.errorEl.textContent = `保存失败：${error instanceof Error ? error.message : String(error)}`;
      } finally {
        this.saving = false;
      }
    }
  };
  function el4(doc, tag, options = {}) {
    const node2 = doc.createElement(tag);
    if (options.cls) node2.className = options.cls;
    if (options.text !== void 0) node2.textContent = options.text;
    for (const [name, value] of Object.entries(options.attrs ?? {})) node2.setAttribute(name, value);
    return node2;
  }

  // src/features/projects/project-catalog.ts
  var PROJECT_DIR = "Research/Projects";
  var PROFILE_DIR = "Research/ProjectProfiles";
  var PROJECT_ID = /^PRJ-(\d{3,})$/i;
  function frontValue(content, key) {
    const fm = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!fm) return "";
    const line2 = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(fm[1] ?? "");
    if (!line2) return "";
    const raw = (line2[1] ?? "").trim();
    if (/^".*"$/.test(raw)) {
      try {
        return String(JSON.parse(raw));
      } catch {
        return raw.slice(1, -1);
      }
    }
    return raw.replace(/^'(.*)'$/, "$1");
  }
  async function listProjects(api) {
    const paths = await api.listMarkdownPaths?.() ?? [];
    const out2 = [];
    for (const path2 of paths) {
      if (!path2.startsWith(`${PROJECT_DIR}/`) || path2.slice(PROJECT_DIR.length + 1).includes("/")) continue;
      let content = "";
      try {
        content = await api.read(path2);
      } catch {
        continue;
      }
      const id = (frontValue(content, "display_id") || path2.split("/").pop()?.replace(/\.md$/i, "") || "").toUpperCase();
      if (!PROJECT_ID.test(id)) continue;
      out2.push({ id, title: frontValue(content, "title") || id, path: path2 });
    }
    return out2.sort((a, b) => a.id.localeCompare(b.id));
  }
  function nextProjectId(existing) {
    const used = new Set(existing.map((id2) => id2.toUpperCase()));
    let n = 1;
    for (const id2 of used) {
      const match = PROJECT_ID.exec(id2);
      if (match) n = Math.max(n, Number(match[1]) + 1);
    }
    let id = `PRJ-${String(n).padStart(3, "0")}`;
    while (used.has(id)) id = `PRJ-${String(++n).padStart(3, "0")}`;
    return id;
  }
  function uuidV73(now = Date.now(), random = (n) => {
    const bytes = new Uint8Array(n);
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }) {
    const bytes = random(16);
    let time = BigInt(now);
    for (let i = 5; i >= 0; i -= 1) {
      bytes[i] = Number(time & 255n);
      time >>= 8n;
    }
    bytes[6] = 112 | (bytes[6] ?? 0) & 15;
    bytes[8] = 128 | (bytes[8] ?? 0) & 63;
    const hex2 = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex2.slice(0, 8)}-${hex2.slice(8, 12)}-${hex2.slice(12, 16)}-${hex2.slice(16, 20)}-${hex2.slice(20)}`;
  }
  async function ensureFolder2(api, path2) {
    const parts = path2.split("/");
    for (let i = 1; i <= parts.length; i += 1) {
      const sub = parts.slice(0, i).join("/");
      if (!await api.kind(sub)) await api.createFolder(sub);
    }
  }
  async function createProject(api, title, now = (/* @__PURE__ */ new Date()).toISOString(), uid = uuidV73()) {
    const name = String(title ?? "").trim();
    if (!name) throw new Error("课题名称不能为空");
    if (name.length > 200) throw new Error("课题名称太长（最多 200 字）");
    const id = nextProjectId((await listProjects(api)).map((project) => project.id));
    const path2 = `${PROJECT_DIR}/${id}.md`;
    const profileFolder = `${PROFILE_DIR}/${id}`;
    if (await api.kind(path2)) throw new Error(`${path2} 已存在，没有覆盖`);
    await ensureFolder2(api, PROJECT_DIR);
    await ensureFolder2(api, profileFolder);
    await api.create(path2, [
      "---",
      `uid: "${uid}"`,
      `display_id: "${id}"`,
      "schema_version: 1",
      'type: "project"',
      `created_at: "${now}"`,
      `updated_at: "${now}"`,
      `title: ${JSON.stringify(name)}`,
      'status: "active"',
      'stage: "P0"',
      'thesis: ""',
      "active_hypothesis_uids: []",
      "legacy_hypothesis_summaries: []",
      "current_problems: []",
      "methods_needed: []",
      "excluded_topics: []",
      'primary_system: ""',
      'secondary_system: ""',
      "wavelengths: []",
      'next_gate: ""',
      "tags: []",
      "---",
      "",
      `# ${name}`,
      "",
      ""
    ].join("\n"));
    const profile = `${profileFolder}/profile-v0.md`;
    if (!await api.kind(profile)) {
      await api.create(profile, [
        "---",
        "schema_version: 1",
        `created_at: "${now}"`,
        `updated_at: "${now}"`,
        'artifact: "project_profile"',
        `project_uid: "${uid}"`,
        `project_display_id: "${id}"`,
        "profile_version: 0",
        `research_question: ${JSON.stringify(name)}`,
        "boundaries:",
        "  do: []",
        "  dont: []",
        "core_concepts: []",
        "keywords_zh: []",
        "keywords_en: []",
        "constraints: []",
        "known: []",
        "unknown: []",
        "controversial: []",
        'success_criteria: ""',
        'revision_note: "由织研者设置里的新建课题生成。"',
        "---",
        "",
        `# ${id} · 课题画像 v0`,
        "",
        "## 研究问题",
        "",
        name,
        "",
        "> 本画像由手动创建生成。v0 是进入 P1 前的起点，不代表文献或实验已经证实其中内容。",
        ""
      ].join("\n"));
    }
    return { id, title: name, path: path2 };
  }

  // src/features/files/obsidian-vault-files.ts
  var clean4 = (path2) => String(path2).replace(/\\/g, "/").replace(/\/+$/, "");
  function obsidianVaultFiles(app) {
    const { vault } = app;
    const indexed = (path2) => vault.getAbstractFileByPath(clean4(path2));
    return {
      async kind(path2) {
        const file = indexed(path2);
        if (file) return file.children !== void 0 ? "folder" : "file";
        const stat = await vault.adapter.stat(clean4(path2));
        return stat ? stat.type : null;
      },
      async read(path2) {
        return vault.adapter.read(clean4(path2));
      },
      async listMarkdownPaths() {
        return (vault.getMarkdownFiles?.() ?? []).map((file) => clean4(file.path));
      },
      async listFolders() {
        return (vault.getAllLoadedFiles?.() ?? []).filter((file) => file.children !== void 0 && file.path && file.path !== "/").map((file) => clean4(file.path)).filter((path2) => !path2.split("/").some((part) => part.startsWith("."))).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
      },
      resourceUrl(path2) {
        return vault.adapter.getResourcePath ? vault.adapter.getResourcePath(clean4(path2)) : "";
      },
      async createBinary(path2, data) {
        const target = clean4(path2);
        if (await vault.adapter.stat(target)) throw new Error(`${target} 已存在，没有覆盖`);
        if (vault.createBinary) await vault.createBinary(target, data);
        else if (vault.adapter.writeBinary) await vault.adapter.writeBinary(target, data);
        else throw new Error("这个 Obsidian 版本不支持写入图片文件");
      },
      async createFolder(path2) {
        const target = clean4(path2);
        if (target.startsWith(".")) await vault.adapter.mkdir(target);
        else await vault.createFolder(target);
      },
      async create(path2, content) {
        await vault.create(clean4(path2), content);
      },
      async modify(path2, content) {
        const file = indexed(path2);
        if (file && file.children === void 0) await vault.modify(file, content);
        else await vault.adapter.write(clean4(path2), content);
      },
      async rename(from, to, updateLinks) {
        const source = indexed(from);
        const target = clean4(to);
        if (source && !target.startsWith(".")) {
          if (updateLinks && app.fileManager) await app.fileManager.renameFile(source, target);
          else await vault.rename(source, target);
          return;
        }
        await vault.adapter.rename(clean4(from), target);
      }
    };
  }

  // src/plugin/scholarium-embed.ts
  var EMBED_ROOT_CLASS = "scholarium-v2dev";
  var USER_CONFIRMED_HEADER = "x-scholarium-user-confirmed";
  var ENABLE_EXECUTION_QUESTION = [
    "开启本库运行时的执行开关（allowExecution=true）？",
    "",
    "开启后，织研者可以在本机启动已安装的 Agent（Claude Code、Codex 等）回答对话。对话车道只派发只读任务；写入、全文抓取等仍需逐项确认。",
    "这会修改 Scholarium 为本库生成的 bridge.config.json，可随时改回 false。"
  ].join("\n");
  function mountResearchWeaver(container, host) {
    const doc = container.ownerDocument;
    let settings = normalizeSettings(host.loadSettings());
    const runtime = new WeaverRuntime(
      {
        vault: host.vault,
        ...host.devMode ? { devMode: true } : {},
        ...host.fetch ? { fetch: host.fetch } : {},
        ...host.now ? { now: host.now } : {},
        ...host.flushActionQueue ? { flushActionQueue: host.flushActionQueue } : {},
        confirmationHeaders: () => ({ [USER_CONFIRMED_HEADER]: "true" })
      },
      settings,
      {
        vaultPath: () => host.vaultBasePath(),
        configDir: () => "",
        pluginId: () => "",
        host: () => {
          throw new Error("the embedded page never starts a process");
        },
        launcher: () => null,
        adapter: () => new HostedRuntimeAdapter({
          locate: host.locate,
          ensure: host.ensure,
          ...host.fetch ? { fetch: host.fetch } : {},
          hostName: "Scholarium"
        })
      }
    );
    container.classList.add(EMBED_ROOT_CLASS, "scholarium-weaver-embed");
    let mount = doc.createElement("div");
    mount.className = "scholarium-weaver-embed__page";
    container.replaceChildren(mount);
    let page;
    let modal = null;
    const save = async (next) => {
      const normalized = normalizeSettings(next);
      await host.saveSettings(normalized);
      settings = normalized;
      runtime.applySettings(normalized);
      page.applyContext(runtime.context());
    };
    const remount = () => {
      page.destroy();
      mount = doc.createElement("div");
      mount.className = "scholarium-weaver-embed__page";
      container.replaceChildren(mount);
      page = build();
      void page.open();
    };
    const settingsCatalog = () => {
      if (!host.app) return null;
      const files = obsidianVaultFiles(host.app);
      return {
        listProjects: () => listProjects(files),
        createProject: (title) => createProject(files, title),
        listFlows: async () => {
          const index = await runtime.viewDeps().store?.readIndex();
          const flows = (index?.sessions ?? []).map((entry) => entry.scopeKey).filter((key) => key.startsWith("topic:")).map((key) => key.slice("topic:".length));
          return [...new Set(flows)].sort();
        },
        listFolders: async () => await files.listFolders?.() ?? [],
        createFolder: async (path2) => {
          const parts = path2.split("/").filter(Boolean);
          for (let i = 1; i <= parts.length; i += 1) {
            const sub = parts.slice(0, i).join("/");
            if (!await files.kind(sub)) await files.createFolder(sub);
          }
        },
        vaultBasePath: () => host.vaultBasePath()
      };
    };
    const deps = () => {
      const base = runtime.viewDeps();
      return {
        ...base,
        title: "织研者",
        openSettings: () => {
          modal?.close();
          modal = new WeaverSettingsModal({ containerEl: container, document: doc }, {
            settings,
            diagnostics: runtime.diagnostics(),
            agents: page.snapshot().agents,
            loadMemory: () => runtime.agentMemory(),
            showDebug: Boolean(host.devMode),
            catalog: settingsCatalog(),
            onSave: async (next) => {
              const before = runtime.scope().scopeKey;
              await save(next);
              if (runtime.scope().scopeKey !== before) remount();
            }
          });
          modal.open();
        },
        ...host.enableExecution ? {
          enableExecution: async () => {
            const agreed = await host.confirm(ENABLE_EXECUTION_QUESTION);
            if (!agreed) throw new Error("已取消");
            await host.enableExecution();
          }
        } : {},
        selectAgent: async (agentId) => {
          await save({ ...settings, agentId });
        },
        confirmDiscardDraft: (message) => host.confirm(message),
        ...host.app ? { vaultFiles: obsidianVaultFiles(host.app) } : {},
        ...host.openVaultLink ? { openVaultLink: host.openVaultLink } : {},
        ...host.imageService ? { generateImage: (prompt, size) => generateWithService(host.imageService, prompt, size) } : host.generateImage ? { generateImage: host.generateImage } : {},
        workbench: {
          ...base.workbench ?? {},
          confirm: (message) => host.confirm(message),
          bindProject: async (displayId) => {
            await save({ ...settings, projectId: displayId });
            remount();
          }
        },
        tools: base.tools ? {
          ...base.tools,
          ...host.publishManualDownloads ? { publishManualDownloads: host.publishManualDownloads } : {},
          ...host.openVaultFile ? { openVaultFile: host.openVaultFile } : {},
          ...host.imageService ? { imageService: host.imageService } : {}
        } : base.tools
      };
    };
    const build = () => new ResearchWeaverView({ containerEl: mount, document: doc }, deps());
    page = build();
    void page.open();
    return {
      get page() {
        return page;
      },
      isMounted: () => container.isConnected && mount.parentElement === container,
      acceptManualCapture: (artifact) => page.acceptManualCapture(artifact),
      insertReference: (anchor, quote) => page.insertReference(anchor, quote),
      destroy: () => {
        modal?.close();
        modal = null;
        page.destroy();
        container.replaceChildren();
      }
    };
  }
  return __toCommonJS(scholarium_embed_exports);
})();
