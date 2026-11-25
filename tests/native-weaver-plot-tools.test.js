"use strict";
const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");
const contract = require("../agent-canvas-demo/plot-tool-contract.js");
const embed = require("../tools/embed-native-weaver.js");

const ROOT = path.join(__dirname, "..");
const tools = new Function(
  "schPlotToolContract",
  `${fs.readFileSync(path.join(ROOT, "tools/native-weaver-plot-tools.js"), "utf8")}\nreturn schNativeWeaverPlotTools;`,
)(contract);

function nativeModel() {
  let page = embed.applyPlotToolPatches(fs.readFileSync(path.join(ROOT, "vendor/native-weaver/scholarium-weaver-native.js"), "utf8"));
  const anchor = "  return __toCommonJS(scholarium_embed_exports);";
  assert.equal(page.split(anchor).length - 1, 1);
  page = page.replace(anchor, "  globalThis.__nativePlotTest = { confirmationCards, replyForDisplay, buildConfirmationLedger };\n" + anchor);
  const sandbox = { schNativeWeaverPlotTools: tools, require, console };
  sandbox.globalThis = sandbox;
  new Function("sandbox", `with (sandbox) {\n${page}\n}`)(sandbox);
  return sandbox.__nativePlotTest;
}

const native = nativeModel();
const EMPTY_LEDGER = { entries: new Map(), events: [] };

function historicalMessage() {
  return require("./fixtures/native-chat-history")()[7];
}

function observation(overrides = {}) {
  return {
    schema_version: 1,
    status: "success",
    tool: "render_plot",
    plot_id: "Materials/_analysis/smoke-v1/plot-manifest.json",
    target_manifest_id: "Materials/_analysis/smoke-v1/plot-manifest.json",
    current_version: 1,
    svg_path: "Materials/_analysis/smoke-v1/plot.svg",
    manifest_path: "Materials/_analysis/smoke-v1/plot-manifest.json",
    manifest_summary: {
      version: 1,
      title: "冒烟测试",
      chart_type: "line",
      x_column: "时间(分钟)",
      series_list: [{ id: "series:信号值(微伏)", y_column: "信号值(微伏)", color: "#3366cc" }],
      annotations_list: [],
      style: { theme: "publication", show_grid: true, legend: "bottom", x_range: null, y_range: null },
    },
    column_mapping: {
      status: "verified",
      x: { requested: "时间(分钟)", resolved: "时间(分钟)", status: "matched" },
      series: [{ id: "series:信号值(微伏)", requested: "信号值(微伏)", resolved: "信号值(微伏)", status: "matched" }],
    },
    warnings: [{ code: "TITLE_WRAPPED", severity: "info", message: "标题已换行" }],
    audit: { dataset_path: "Materials/AuCdSPt-0_50--信号文件.CSV", dataset_readonly: true, save_mode: "new_version" },
    ...overrides,
  };
}

function fakeView(card, execute) {
  const events = [];
  const view = {
    deps: { executePlotTool: execute },
    busy: false,
    cardButtons: [],
    notices: [],
    bridgeStatus: () => "online",
    renderStatus() {},
    syncWindow() {},
    renderAll() {},
    showNotice(text) { view.notices.push(text); },
    session: {
      snapshot: () => ({ archived: false }),
      async claim(messageId, kind) {
        if (card.state !== "pending" && card.state !== "failed") return { ok: false, error: "locked" };
        card.state = "claimed";
        const event = { type: "confirmation", eventId: `evt-claim-${events.length}`, messageId, kind, state: "claimed", operationId: "op-native-plot", detail: null, at: new Date().toISOString() };
        events.push(event);
        return { ok: true, operationId: "op-native-plot" };
      },
      async settle(messageId, kind, operationId, state, detail) {
        card.state = state;
        card.detail = detail;
        events.push({ type: "confirmation", eventId: `evt-settle-${events.length}`, messageId, kind, state, operationId, detail, at: new Date().toISOString() });
        return { ok: true };
      },
    },
  };
  return { view, events };
}

describe("native 织研者绘图卡：真实历史与统一协议", () => {
  it("提示词允许 GBK 中文源 CSV 直接绘图，不把 normalize 当编码前置条件", () => {
    const page = embed.applyPlotToolPatches(fs.readFileSync(path.join(ROOT, "vendor/native-weaver/scholarium-weaver-native.js"), "utf8"));
    assert.match(page, /GBK\/GB18030 编码本身不是 normalize 的理由/);
    assert.match(page, /不得把 UTF-8 副本说成唯一出路/);
    assert.match(page, /只有 XLSX 或确有结构化转换需求时才先规范化/);
  });

  it("把真实 GB18030 中文列名历史消息恢复成待确认卡并剥离围栏", () => {
    const message = historicalMessage();
    const cards = native.confirmationCards([message], EMPTY_LEDGER);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].kind, "plot");
    assert.equal(cards[0].state, "pending");
    assert.equal(cards[0].plot.dataPath, "Materials/AuCdSPt-0_50--信号文件.CSV");
    assert.equal(cards[0].plot.recipe.x_column, "时间(分钟)");
    assert.deepEqual(cards[0].plot.recipe.y_columns, ["信号值(微伏)"]);
    assert.equal(tools.requestText(cards[0].plot).includes("series:信号值(微伏)"), true);
    const body = native.replyForDisplay(message.text);
    assert.equal(body.text.includes("```scholarium-plot"), false);
    assert.equal(body.text.includes("已重新提交绘图请求"), true);
  });

  it("解析新 render/revise 协议，旧改版保留缺失基线，非法 JSON 不可执行", () => {
    const source = [
      "```scholarium-plot-tool",
      JSON.stringify({ name: "render_plot", arguments: { dataset_path: "Materials\\smoke.csv", recipe: { plot_kind: "line", x_column: "time", y_columns: ["signal"], chart_style: {} } } }),
      "```",
      "```scholarium-plot-tool",
      JSON.stringify({ name: "revise_plot", arguments: { target_manifest_id: "Materials\\_analysis\\smoke-v1\\plot-manifest.json", base_version: 2, revision_reason: "改色", patch: { series_updates: [{ id: "series:signal", color: "#AABBCC" }] } } }),
      "```",
      "```scholarium-plot-revise",
      JSON.stringify({ target_manifest_path: "Materials\\_analysis\\older\\plot-manifest.json", chart_style: { show_grid: false }, reason: "旧卡" }),
      "```",
      "```scholarium-plot-tool",
      "{ broken json",
      "```",
    ].join("\n");
    const parsed = tools.parse(source);
    assert.equal(parsed.requests.length, 2, "同 kind 的新旧改版共用账本键，只接受第一张；非法 JSON 不生成卡");
    assert.equal(parsed.requests[0].dataPath, "Materials/smoke.csv");
    const revision = parsed.requests.find((request) => request.kind === "plotRevision");
    assert.equal(revision.targetManifestId, "Materials/_analysis/smoke-v1/plot-manifest.json");
    assert.equal(revision.baseVersion, 2);
    assert.equal(parsed.text.includes("broken json"), true);
    const legacy = tools.parse("```scholarium-plot-revise\n{\"target_manifest_path\":\"Materials\\\\_analysis\\\\old\\\\plot-manifest.json\",\"chart_style\":{\"show_grid\":false}}\n```");
    assert.equal(legacy.requests[0].baseVersion, null);
    assert.equal(legacy.requests[0].targetManifestId, "Materials/_analysis/old/plot-manifest.json");
  });
});

describe("native 织研者绘图卡：确认、版本与恢复", () => {
  it("未确认零调用，确认后仅一次 render_plot，Observation 随账本序列化恢复", async () => {
    const message = historicalMessage();
    const card = native.confirmationCards([message], EMPTY_LEDGER)[0];
    const calls = [];
    const { view, events } = fakeView(card, async (name, input, options) => {
      calls.push({ name, input, options });
      return observation();
    });
    assert.equal(calls.length, 0);
    await tools.confirm(view, card);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "render_plot");
    assert.equal(calls[0].input.dataset_path, "Materials/AuCdSPt-0_50--信号文件.CSV");
    assert.equal(calls[0].input.recipe.x_column, "时间(分钟)");
    assert.equal(calls[0].options.researcher_confirmed, true);
    assert.equal(calls[0].options.researcher_save_mode, "new_version");
    assert.equal(card.state, "confirmed");
    assert.equal(card.detail.observation.manifest_summary.series_list[0].id, "series:信号值(微伏)");
    const restoredLedger = native.buildConfirmationLedger(JSON.parse(JSON.stringify(events)));
    const restored = native.confirmationCards([message], restoredLedger)[0];
    assert.equal(restored.state, "confirmed");
    assert.equal(restored.detail.observation.warnings[0].code, "TITLE_WRAPPED");
    await tools.confirm(view, restored);
    assert.equal(calls.length, 1, "已完成卡不能重复执行");
  });

  it("旧改版确认后读取当前版本，路径归一化且 Patch 不改数据映射", async () => {
    const parsed = tools.parse("```scholarium-plot-revise\n{\"target_manifest_path\":\"Materials\\\\_analysis\\\\smoke-v1\\\\plot-manifest.json\",\"chart_style\":{\"series_colors\":{\"信号值(微伏)\":\"#3366CC\"}},\"reason\":\"改色\"}\n```");
    const calls = [];
    const prepared = await tools.prepare(parsed.requests[0], async (name, input, options) => {
      calls.push({ name, input, options });
      return { status: "success", active: { version: 7 } };
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "get_plot_context");
    assert.equal(calls[0].input.target_manifest_id, "Materials/_analysis/smoke-v1/plot-manifest.json");
    assert.equal(prepared.call.name, "revise_plot");
    assert.equal(prepared.call.arguments.base_version, 7);
    assert.equal(prepared.call.arguments.target_manifest_id, "Materials/_analysis/smoke-v1/plot-manifest.json");
    assert.deepEqual(Object.keys(prepared.call.arguments.patch), ["chart_style"]);
    assert.equal(prepared.call.arguments.save_mode, "new_version");
  });

  it("失败重试强制刷新新协议基线，版本冲突 Observation 原样保留", async () => {
    const parsed = tools.parse("```scholarium-plot-tool\n{\"name\":\"revise_plot\",\"arguments\":{\"target_manifest_id\":\"Materials/_analysis/smoke-v2/plot-manifest.json\",\"base_version\":2,\"revision_reason\":\"改色\",\"patch\":{\"chart_style\":{\"show_grid\":false}}}}\n```");
    const request = parsed.requests[0];
    const prepared = await tools.prepare(request, async () => ({ status: "success", active: { version: 5 } }), { refreshBaseVersion: true });
    assert.equal(prepared.call.arguments.base_version, 5);
    const conflict = observation({
      status: "error",
      tool: "revise_plot",
      current_version: 6,
      manifest_summary: null,
      column_mapping: null,
      warnings: [],
      audit: null,
      error: { code: "VERSION_CONFLICT", message: "target is v6, request is based on v5", retryable: true },
    });
    const serialized = JSON.parse(JSON.stringify({ observation: conflict, base_version: 5 }));
    assert.equal(serialized.observation.error.code, "VERSION_CONFLICT");
    assert.equal(serialized.observation.current_version, 6);
    assert.equal(serialized.base_version, 5);
  });

  it("卡片展示 Manifest 摘要、映射、路径与告警；完成卡无执行按钮，冲突卡可手动重试", () => {
    const doc = {
      createElement(tag) {
        return {
          tag,
          children: [],
          className: "",
          textContent: "",
          attrs: {},
          disabled: false,
          append(...nodes) { this.children.push(...nodes); },
          setAttribute(key, value) { this.attrs[key] = value; },
          addEventListener() {},
        };
      },
    };
    const textOf = (node) => [node.textContent || "", ...(node.children || []).map(textOf)].join("\n");
    const message = historicalMessage();
    const card = native.confirmationCards([message], EMPTY_LEDGER)[0];
    const calls = [];
    const { view } = fakeView(card, async () => { calls.push(1); });
    view.document = doc;
    view.renderCardHead = (title) => {
      const node = doc.createElement("div");
      node.textContent = title;
      return node;
    };
    const pending = tools.renderCard(view, card);
    assert.match(textOf(pending), /series:信号值\(微伏\)/);
    assert.equal(view.cardButtons.length, 1);
    assert.equal(calls.length, 0, "绘制卡片不能调用运行时");

    card.state = "confirmed";
    card.detail = { detail: "绘图完成", observation: observation() };
    view.cardButtons = [];
    const confirmed = tools.renderCard(view, card);
    assert.match(textOf(confirmed), /series:信号值\(微伏\) ↔ 信号值\(微伏\)/);
    assert.match(textOf(confirmed), /Materials\/_analysis\/smoke-v1\/plot\.svg/);
    assert.match(textOf(confirmed), /TITLE_WRAPPED/);
    assert.equal(view.cardButtons.length, 0);

    card.kind = "plotRevision";
    card.state = "failed";
    card.plot = { kind: "plotRevision", targetManifestId: "Materials/_analysis/smoke-v2/plot-manifest.json", baseVersion: 2, patch: { chart_style: { show_grid: false } } };
    card.detail = { observation: observation({ status: "error", manifest_summary: null, column_mapping: null, warnings: [], error: { code: "VERSION_CONFLICT", message: "target is v6", retryable: true } }) };
    view.cardButtons = [];
    const failed = tools.renderCard(view, card);
    assert.match(textOf(failed), /VERSION_CONFLICT/);
    assert.match(textOf(failed), /未自动覆盖或重试写入/);
    assert.equal(view.cardButtons.length, 1);
    assert.equal(view.cardButtons[0][0].disabled, false);
  });
});
