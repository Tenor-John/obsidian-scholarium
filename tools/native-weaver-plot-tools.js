"use strict";
/* Native 织研者 plot confirmation cards. Embedded by embed-native-weaver.js.
 * Parsing is side-effect free. The only write path is confirm(), after the
 * researcher clicks and ChatSession has persisted its claim. */
function schNativeWeaverPlotToolsFactory(contract) {
  if (!contract) throw new Error("缺少统一绘图契约，原生绘图卡不可用");

  const PLOT_KINDS = new Set(["plot", "plotRevision"]);
  const own = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const messageOf = (error) => String(error && error.message || error || "未知错误");
  const codeOf = (error) => String(error && error.code || "PLOT_TOOL_ERROR");
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function attempted(source, name) {
    const matches = String(source || "").match(new RegExp("(?:^|\\r?\\n)`{1,}[ \\t]*" + name + "(?![\\w-])", "g"));
    return matches ? matches.length : 0;
  }

  function validateRevisionPatch(patch) {
    const columns = Array.isArray(patch && patch.series_updates)
      ? patch.series_updates.map((entry) => contract.columnForSeriesId(entry && entry.id)).filter(Boolean)
      : [];
    contract.applyPlotPatch({
      plot: { kind: "line", title: "validation", x_column: "x", y_columns: columns, chart_style: {} },
    }, patch);
  }

  function fromToolCall(parsed) {
    if (!own(parsed) || Object.keys(parsed).some((key) => !["name", "arguments", "reason"].includes(key))) return null;
    if (!own(parsed.arguments)) return null;
    if (parsed.name === "render_plot") {
      const args = contract.normalizeRenderInput(parsed.arguments);
      return {
        kind: "plot",
        reason: String(parsed.reason || "").trim().slice(0, 300),
        dataPath: args.dataset_path,
        recipe: args.recipe,
        toolCall: { name: "render_plot", arguments: args },
      };
    }
    if (parsed.name === "revise_plot") {
      const args = contract.normalizeReviseInput(parsed.arguments);
      validateRevisionPatch(args.patch);
      return {
        kind: "plotRevision",
        reason: args.revision_reason,
        targetManifestId: args.target_manifest_id,
        baseVersion: args.base_version,
        patch: args.patch,
        toolCall: { name: "revise_plot", arguments: args },
      };
    }
    return null;
  }

  function fromLegacyRender(parsed) {
    const allowed = new Set(["data_path", "x_column", "y_columns", "plot_kind", "title", "chart_style", "save_mode", "reason"]);
    if (!own(parsed) || Object.keys(parsed).some((key) => !allowed.has(key))) return null;
    if (parsed.save_mode !== undefined && String(parsed.save_mode).toLowerCase() !== "new") return null;
    const call = contract.legacyRenderToolCall(parsed);
    const args = contract.normalizeRenderInput(call.arguments);
    return {
      kind: "plot",
      reason: String(parsed.reason || "").trim().slice(0, 300),
      dataPath: args.dataset_path,
      recipe: args.recipe,
      legacy: {
        data_path: args.dataset_path,
        x_column: args.recipe.x_column,
        y_columns: args.recipe.y_columns,
        plot_kind: args.recipe.plot_kind,
        ...(args.recipe.title === undefined ? {} : { title: args.recipe.title }),
        chart_style: args.recipe.chart_style,
      },
    };
  }

  function fromLegacyRevision(parsed) {
    const allowed = new Set(["target_manifest_path", "chart_style", "reason"]);
    if (!own(parsed) || Object.keys(parsed).some((key) => !allowed.has(key))) return null;
    if (!own(parsed.chart_style) || !Object.keys(parsed.chart_style).length) return null;
    // A placeholder validates the legacy Patch shape only. The real base version
    // is read from the current target after the researcher confirms.
    const call = contract.legacyReviseToolCall(parsed, 1);
    const args = contract.normalizeReviseInput(call.arguments);
    validateRevisionPatch(args.patch);
    return {
      kind: "plotRevision",
      reason: String(parsed.reason || "").trim().slice(0, 300) || "Legacy chart style revision",
      targetManifestId: args.target_manifest_id,
      baseVersion: null,
      patch: args.patch,
      legacy: {
        target_manifest_path: args.target_manifest_id,
        chart_style: args.patch.chart_style,
        reason: String(parsed.reason || "").trim().slice(0, 300),
      },
    };
  }

  function replaceProtocol(source, name, convert, requests, seen) {
    const expression = new RegExp("(`{3,})[ \\t]*" + name + "[ \\t]*\\r?\\n([\\s\\S]*?)\\1", "g");
    return source.replace(expression, (match, _fence, body) => {
      try {
        const request = convert(JSON.parse(body.trim()));
        // The existing ledger is keyed by message ID + kind. A second request of
        // the same kind therefore stays visible and non-executable rather than
        // sharing another card's confirmation state.
        if (!request || seen.has(request.kind)) return match;
        seen.add(request.kind);
        requests.push(request);
        return "";
      } catch (_) {
        return match;
      }
    });
  }

  function parse(text) {
    const source = String(text || "");
    const requests = [];
    const seen = new Set();
    let cleaned = replaceProtocol(source, "scholarium-plot-tool", fromToolCall, requests, seen);
    cleaned = replaceProtocol(cleaned, "scholarium-plot-revise", fromLegacyRevision, requests, seen);
    cleaned = replaceProtocol(cleaned, "scholarium-plot", fromLegacyRender, requests, seen);
    const count = attempted(source, "scholarium-plot-tool") + attempted(source, "scholarium-plot-revise") + attempted(source, "scholarium-plot");
    return {
      text: cleaned.replace(/\n{3,}/g, "\n\n").trim(),
      requests,
      stats: { attempted: count, parsed: requests.length, rejected: Math.max(0, count - requests.length) },
    };
  }

  function targetOf(request) {
    return String(request.targetManifestId || request.toolCall && request.toolCall.arguments.target_manifest_id || "").replace(/\\/g, "/");
  }

  function executableCall(request, baseVersion) {
    if (request.toolCall) return clone(request.toolCall);
    if (request.kind === "plot") return contract.legacyRenderToolCall(request.legacy);
    return contract.legacyReviseToolCall(request.legacy, baseVersion);
  }

  async function prepare(request, execute, options = {}) {
    let baseVersion = request.baseVersion;
    if (request.kind === "plotRevision" && (options.refreshBaseVersion === true || !Number.isInteger(baseVersion))) {
      const target = targetOf(request);
      const context = await execute("get_plot_context", { target_manifest_id: target }, { researcher_confirmed: false });
      if (!context || context.status === "error" || !context.active) {
        const error = new Error(context && context.error && context.error.message || "读取目标 Manifest 当前版本失败");
        error.code = context && context.error && context.error.code || "PLOT_CONTEXT_UNAVAILABLE";
        error.observation = context || null;
        throw error;
      }
      baseVersion = Number(context.active.version);
      if (!Number.isInteger(baseVersion) || baseVersion < 1) {
        const error = new Error("目标 Manifest 没有有效的当前版本号");
        error.code = "INVALID_MANIFEST";
        throw error;
      }
    }
    const call = executableCall(request, baseVersion);
    if (call.name === "revise_plot") call.arguments = contract.normalizeReviseInput({ ...call.arguments, base_version: baseVersion });
    else call.arguments = contract.normalizeRenderInput(call.arguments);
    return { call, baseVersion: baseVersion || null };
  }

  function canExecute(view, card) {
    return PLOT_KINDS.has(card.kind)
      && (card.state === "pending" || card.state === "failed")
      && typeof view.deps.executePlotTool === "function"
      && view.bridgeStatus() === "online"
      && !view.busy
      && !view.session.snapshot().archived;
  }

  async function confirm(view, card) {
    if (!card.plot || !canExecute(view, card)) return;
    const execute = view.deps.executePlotTool;
    view.busy = true;
    view.renderStatus();
    let operationId = null;
    let baseVersion = card.plot.baseVersion || null;
    try {
      const claim = await view.session.claim(card.messageId, card.kind);
      if (!claim.ok) {
        view.showNotice(`未能确认：${claim.error}`);
        return;
      }
      operationId = claim.operationId;
      const prepared = await prepare(card.plot, execute, { refreshBaseVersion: card.state === "failed" });
      baseVersion = prepared.baseVersion;
      const observation = await execute(prepared.call.name, prepared.call.arguments, {
        researcher_confirmed: true,
        researcher_save_mode: "new_version",
      });
      const success = observation && observation.status === "success";
      const problem = observation && observation.error;
      const detailText = success
        ? `${prepared.call.name === "render_plot" ? "绘图" : "改版"}完成：v${observation.current_version} · ${observation.manifest_path}`
        : problem && problem.message || "绘图工具未返回成功 Observation";
      await view.session.settle(card.messageId, card.kind, operationId, success ? "confirmed" : "failed", {
        detail: detailText,
        observation: clone(observation || { status: "error", error: { code: "INVALID_OBSERVATION", message: detailText } }),
        ...(baseVersion ? { base_version: baseVersion } : {}),
      });
      view.showNotice(detailText, success ? "info" : "error");
    } catch (error) {
      const failure = messageOf(error);
      const detail = {
        detail: failure,
        error: failure,
        error_code: codeOf(error),
        ...(baseVersion ? { base_version: baseVersion } : {}),
        ...(error && error.observation ? { observation: clone(error.observation) } : {}),
      };
      if (operationId) await view.session.settle(card.messageId, card.kind, operationId, "failed", detail);
      else view.showNotice(`未能确认：${failure}`);
    } finally {
      view.busy = false;
    }
    view.syncWindow();
    view.renderAll();
  }

  function el(doc, tag, options = {}) {
    const node = doc.createElement(tag);
    if (options.cls) node.className = options.cls;
    if (options.text !== undefined) node.textContent = String(options.text);
    for (const [key, value] of Object.entries(options.attrs || {})) node.setAttribute(key, String(value));
    return node;
  }

  function requestText(request) {
    if (request.kind === "plot") {
      const recipe = request.recipe || request.toolCall && request.toolCall.arguments.recipe || {};
      return [
        `数据：${request.dataPath || request.toolCall && request.toolCall.arguments.dataset_path || ""}`,
        `图型：${recipe.plot_kind || "line"} · 标题：${recipe.title || "（默认）"}`,
        `X：${recipe.x_column || ""}`,
        `Y：${(recipe.y_columns || []).join("、")}`,
        `Series ID：${(recipe.y_columns || []).map(contract.seriesIdForColumn).join("、")}`,
      ].join("\n");
    }
    return [
      `目标 Manifest：${targetOf(request)}`,
      `基线版本：${Number.isInteger(request.baseVersion) ? `v${request.baseVersion}` : "确认后自动读取当前版本"}`,
      `增量 Patch：${JSON.stringify(request.patch || request.toolCall && request.toolCall.arguments.patch || {}, null, 2)}`,
      "保存方式：新版本（不会覆盖旧版本）",
    ].join("\n");
  }

  function appendObservation(doc, node, observation) {
    if (!observation) return;
    const summary = observation.manifest_summary;
    if (summary) {
      const series = (summary.series_list || []).map((entry) => `${entry.id} ↔ ${entry.y_column}${entry.color ? ` · ${entry.color}` : ""}`).join("\n");
      node.append(el(doc, "pre", {
        cls: "scholarium-weaver__plot-observation",
        text: [
          `当前：v${observation.current_version} · ${summary.title || "（无标题）"} · ${summary.chart_type || ""}`,
          `X：${summary.x_column || ""}`,
          `Series：\n${series || "（无）"}`,
          `样式：${summary.style && summary.style.theme || "publication"} · 网格 ${summary.style && summary.style.show_grid !== false ? "开" : "关"} · 图例 ${summary.style && summary.style.legend || "bottom"}`,
        ].join("\n"),
      }));
    }
    if (observation.column_mapping) {
      const mapping = observation.column_mapping;
      const entries = [mapping.x, ...(mapping.series || [])].filter(Boolean);
      node.append(el(doc, "div", {
        cls: "scholarium-weaver__plot-mapping",
        text: `列映射：${mapping.status}\n${entries.map((entry) => `${entry.id ? `${entry.id} · ` : ""}${entry.requested} → ${entry.resolved || "（缺失）"} · ${entry.status}`).join("\n")}`,
      }));
    }
    const paths = [
      observation.svg_path ? `SVG：${observation.svg_path}` : "",
      observation.manifest_path ? `Manifest：${observation.manifest_path}` : "",
    ].filter(Boolean).join("\n");
    if (paths) node.append(el(doc, "div", { cls: "scholarium-weaver__plot-paths", text: paths }));
    for (const warning of observation.warnings || []) {
      node.append(el(doc, "div", {
        cls: `scholarium-weaver__plot-warning is-${warning.severity || "info"}`,
        text: `渲染告警 ${warning.code || "WARNING"}：${warning.message || ""}${warning.suggested_fix ? `\n建议：${warning.suggested_fix}` : ""}`,
      }));
    }
    if (observation.error) {
      node.append(el(doc, "div", {
        cls: "scholarium-weaver__plot-error",
        text: `${observation.error.code || "PLOT_TOOL_ERROR"}：${observation.error.message || "未知错误"}${observation.error.code === "VERSION_CONFLICT" ? "\n目标已发生变化；未自动覆盖或重试写入。重试时会重新读取当前版本。" : ""}`,
      }));
    }
  }

  function renderCard(view, card) {
    const doc = view.document;
    const request = card.plot;
    const statePrefix = card.state === "pending" ? "待确认" : card.state === "claimed" ? "已提交" : card.state === "confirmed" ? "已执行" : card.state === "failed" ? "运行失败" : "已关闭";
    const node = el(doc, "div", {
      cls: `scholarium-weaver__card is-${card.kind} is-${card.state} scholarium-weaver__plot-card`,
      attrs: { "data-card": card.cardId, "data-state": card.state, "data-dispatchable": String(card.state === "pending" || card.state === "failed") },
    });
    node.append(view.renderCardHead(`${statePrefix}：${card.kind === "plot" ? "绘图" : "增量改版"}`, card));
    node.append(el(doc, "pre", { cls: "scholarium-weaver__card-body scholarium-weaver__plot-request", text: requestText(request) }));
    if (request.reason) node.append(el(doc, "div", { cls: "scholarium-weaver__card-status", text: `理由：${request.reason}` }));
    const detail = card.detail || {};
    const observation = detail.observation || null;
    appendObservation(doc, node, observation);
    if (card.state === "confirmed") {
      node.append(el(doc, "div", { cls: "scholarium-weaver__card-result", text: `已确认并执行：${detail.detail || "完成"}。此卡不会重复执行。` }));
      return node;
    }
    if (card.state === "claimed") {
      node.append(el(doc, "div", {
        cls: "scholarium-weaver__card-status is-claimed",
        attrs: { "data-operation": card.operationId || "" },
        text: `正在核对执行结果：操作 ${card.operationId || "未知"} 已提交；不会自动重跑。`,
      }));
      return node;
    }
    if (card.state === "abandoned") {
      node.append(el(doc, "div", { cls: "scholarium-weaver__card-result", text: "已关闭；不会执行。" }));
      return node;
    }
    if (card.state === "failed" && !observation) {
      node.append(el(doc, "div", { cls: "scholarium-weaver__plot-error", text: `${detail.error_code || "PLOT_TOOL_ERROR"}：${detail.error || detail.detail || "未记录原因"}` }));
    }
    const archived = view.session.snapshot().archived;
    node.append(el(doc, "div", {
      cls: "scholarium-weaver__card-status",
      text: archived ? "会话已归档，只读。" : card.state === "failed" ? "可手动重试；改版会重新读取基线版本并再次进行乐观版本检查。" : "预览：尚未执行。点击确认后才会调用统一绘图运行时。",
    }));
    if (archived) return node;
    const actions = el(doc, "div", { cls: "scholarium-weaver__card-actions" });
    const confirmButton = el(doc, "button", {
      cls: "scholarium-weaver__confirm mod-cta",
      text: card.state === "failed" ? (card.kind === "plotRevision" ? "重新读取版本并重试" : "重试绘图") : (card.kind === "plot" ? "确认并绘图" : "确认并生成新版本"),
      attrs: { type: "button", "data-confirm": card.cardId },
    });
    confirmButton.disabled = !canExecute(view, card);
    confirmButton.addEventListener("click", () => void confirm(view, card));
    view.cardButtons.push([confirmButton, card]);
    actions.append(confirmButton);
    if (card.state === "pending") {
      const abandon = el(doc, "button", { cls: "scholarium-weaver__abandon", text: "关闭", attrs: { type: "button", "data-abandon": card.cardId } });
      abandon.addEventListener("click", () => void view.onAbandon(card));
      actions.append(abandon);
    }
    node.append(actions);
    return node;
  }

  return { parse, prepare, executableCall, canExecute, confirm, renderCard, requestText };
}
var schNativeWeaverPlotTools = schNativeWeaverPlotToolsFactory(globalThis.schPlotToolContract);
