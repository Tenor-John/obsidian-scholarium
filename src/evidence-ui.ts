// @ts-nocheck
/* Thin command and modal surfaces over the verified runtime's evidence tools. */
import * as Eo from "obsidian";
import { Sl } from "./ai-completion";
import { PROVIDER_CONFIG as ut } from "./settings";
import { schEvidenceTools } from "./research-evidence-tools";
import { schOpenMaterialDatasetPicker } from "./material-plotting";

// State changes are explicit, one-step operations.  The registry first
// dry-runs the transition, then writes it only after the user clicks confirm.
function schOpenExperimentTransition(plugin) {
  let tools, entry;
  try {
    tools = schEvidenceTools(plugin);
    const active = plugin.app.workspace.getActiveFile();
    if (!active) throw new Error("请先打开 Research/Experiments/ 下的一条 Experiment 记录");
    entry = tools.experiments.loadAll(tools.vault).find((item) => item.path === active.path);
    if (!entry) throw new Error("当前笔记不是 Schema v1 的 Experiment");
  } catch (error) {
    new Eo.Notice("无法更新实验状态：" + (error.message || error));
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal");
    modal.contentEl.createEl("h2", { text: "更新实验状态" });
    modal.contentEl.createEl("p", { text: `${entry.object.display_id} 当前状态：${entry.object.status}。每次只前进一步，并记录你的理由。`, cls: "setting-item-description" });
    const next = tools.workflow.NEXT[entry.object.status] || [];
    if (!next.length) {
      modal.contentEl.createEl("p", { text: "该 Experiment 已处于生命周期终态，不能再向前推进。" });
      modal.contentEl.createEl("button", { text: "关闭" }).onclick = () => modal.close();
      return;
    }
    const names = { idea: "想法", designed: "已设计", ready: "已准备", running: "进行中", data_pending: "等待数据", analyzing: "分析中", concluded: "已得结论", integrated: "已整合" };
    modal.contentEl.createEl("label", { text: "下一状态" });
    const target = modal.contentEl.createEl("select");
    for (const status of next) target.createEl("option", { value: status, text: names[status] || status });
    modal.contentEl.createEl("label", { text: "推进理由" });
    const reason = modal.contentEl.createEl("textarea", { attr: { rows: "3", placeholder: "例如：捕获剂、对照样品和测量方案均已准备完成。" } });
    const preview = modal.contentEl.createDiv({ cls: "setting-item-description" });
    const actions = modal.contentEl.createDiv({ cls: "scholarium-evidence-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => modal.close();
    const save = actions.createEl("button", { text: "确认更新状态", cls: "mod-cta" });
    save.onclick = () => {
      try {
        const input = { experiment_uid: entry.object.uid, to_status: target.value, reason: reason.value };
        const planned = tools.actions.run(tools.vault, "experiment.transition", input, { dryRun: true, by: "user" });
        preview.setText(`将 ${planned.result.from} → ${planned.result.to}；理由会写入 status_history。`);
        tools.actions.run(tools.vault, "experiment.transition", input, { dryRun: false, confirmed: true, by: "user" });
        modal.close();
        new Eo.Notice(`已更新 ${entry.object.display_id}：${names[planned.result.to] || planned.result.to}。`);
      } catch (error) { preview.setText("无法更新：" + (error.message || error)); }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

// Mirror only scored article metadata and human feedback, never settings or
// credentials from data.json.  The Markdown index is independently rebuildable.
async function schOpenRadarVaultSync(plugin) {
  let tools, data, plan;
  try {
    tools = schEvidenceTools(plugin);
    data = await plugin.loadData();
    plan = tools.radarIndex.plan(tools.vault, data || {});
  } catch (error) { new Eo.Notice("无法读取文献雷达评分：" + (error.message || error)); return; }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal");
    modal.contentEl.createEl("h2", { text: "同步文献雷达评分到 Research" });
    modal.contentEl.createEl("p", { text: `扫描到 ${plan.scanned_articles} 篇 RSS 文献；将镜像 ${plan.selected} 篇当前已有评分或人工反馈的记录。`, cls: "setting-item-description" });
    if (plan.retained_historical_records) modal.contentEl.createEl("p", { text: `另有 ${plan.retained_historical_records} 篇历史评分已不在当前 RSS 内存列表中；为保留研究记录，本次会保留，不会删除。`, cls: "setting-item-description" });
    modal.contentEl.createEl("p", { text: "写入 Research/RadarScores/，只含文献元数据、评分与人工反馈；不会写出 API Key、端点或其他插件设置。", cls: "setting-item-description" });
    const status = modal.contentEl.createDiv({ cls: "setting-item-description" });
    const actions = modal.contentEl.createDiv({ cls: "scholarium-evidence-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.onclick = () => modal.close();
    const write = actions.createEl("button", { text: "确认同步", cls: "mod-cta" });
    write.onclick = () => {
      try {
        const done = tools.radarIndex.sync(tools.vault, data || {}, { dryRun: false });
        const benchmark = tools.radarIndex.benchmark(tools.vault);
        status.setText(`已同步/更新 ${done.written} 条，保留 ${done.retained_historical_records} 条历史评分；人工反馈 ${benchmark.feedback_count}/50。${benchmark.ready_for_calibration ? "已达到校准门槛。" : "尚不足以校准评分。"}`);
        write.disabled = true;
        write.setText("同步完成");
        write.title = "本次同步已完成；以后有新评分或反馈时重新打开此命令即可。";
        cancel.setText("关闭");
      } catch (error) { status.setText("同步失败：" + (error.message || error)); }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

function schShowRadarBenchmark(plugin) {
  try {
    const benchmark = schEvidenceTools(plugin).radarIndex.benchmark(plugin.app.vault.adapter.getBasePath());
    const labels = Object.entries(benchmark.feedback_counts).map(([key, value]) => `${key}: ${value}`).join("，") || "尚无人工反馈";
    new Eo.Notice(`评分校准基线：${benchmark.feedback_count}/50 条人工反馈（${labels}）。${benchmark.ready_for_calibration ? "已达到校准门槛。" : "未达到 50 条门槛。"}`);
  } catch (error) { new Eo.Notice("无法读取评分校准基线：" + (error.message || error)); }
}

// LLM scope is deliberately narrow here: English query expansion only. The
// response is parsed and persisted as a query-pack artifact before it can be
// used for retrieval; it has no route to Evidence confirmation or relations.
async function schExpandEvidenceQueryViaApi(plugin, tools, hypothesis) {
  const settings = plugin.settings || {};
  const provider = settings.aiProvider || "";
  const apiKey = String(settings.aiApiKey || "").trim();
  if (!apiKey) throw new Error("请先在插件设置中配置 AI API Key；该 Key 只用于生成英文检索词包");
  const prompt = tools.expansion.promptForExpansion(hypothesis);
  const parseOrFallback = (text, generator) => {
    try {
      return { parsed: tools.expansion.ensureConceptGroups(tools.expansion.parseExpansion(text), hypothesis), prompt, generator, format_fallback: false };
    } catch (error) {
      // A provider formatting lapse must not turn deterministic retrieval into
      // a click-until-it-works UI. This fallback uses only literal entities and
      // conditions the researcher already wrote in the hypothesis.
      return {
        parsed: tools.expansion.fallbackExpansion(hypothesis), prompt,
        generator: `${generator}:deterministic-format-fallback`, format_fallback: true,
        format_error: error.message || String(error),
      };
    }
  };
  let response;
  if (provider === "claude") {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: settings.aiModel || "claude-sonnet-4-6", max_tokens: 700, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (!response.ok) throw new Error(`英文检索词扩展请求失败（${response.status}）`);
    const json = await response.json();
    const text = tools.expansion.apiResponseText(json);
    if (!text.trim()) throw new Error("LLM 响应未包含可读取文本；请检查所选模型是否支持普通文本输出。");
    return parseOrFallback(text, `claude:${settings.aiModel || "default"}`);
  }
  const endpoint = provider === "custom" ? settings.aiCustomEndpoint : (typeof ut !== "undefined" && ut[provider] && ut[provider].endpoint);
  if (!endpoint) throw new Error("请在插件设置中配置可用的 OpenAI 兼容端点或选择 Claude");
  response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.aiModel,
      messages: [{ role: "system", content: "You only generate auditable English literature-retrieval query phrases. Never judge evidence or assign scientific relations." }, { role: "user", content: prompt }],
      ...(provider === "minimax" ? { max_completion_tokens: 700 } : { max_tokens: 700 }),
      // DeepSeek v4-flash can spend the entire small completion allowance on
      // reasoning_content and return an empty final message. Query expansion
      // needs a compact machine-readable answer, not chain-of-thought.
      ...(provider === "deepseek" ? {
        max_tokens: 1600,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      } : {}),
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`英文检索词扩展请求失败（${response.status}）`);
  const json = await response.json();
  const text = tools.expansion.apiResponseText(json);
  if (!text.trim()) throw new Error("LLM 响应未包含可读取文本；请检查所选模型或 OpenAI 兼容端点。");
  return parseOrFallback(text, `${provider}:${settings.aiModel || "default"}`);
}

// This produces an auditable recommendation only. It deliberately has no
// route to confirmEvidence/rejectEvidence: the researcher must explicitly
// adopt or edit the suggestion in the reviewer.
async function schReviewEvidenceViaApi(plugin, tools, hypothesis, evidence) {
  const settings = plugin.settings || {};
  const provider = settings.aiProvider || "";
  const apiKey = String(settings.aiApiKey || "").trim();
  if (!apiKey) throw new Error("请先在插件设置中配置 AI API Key");
  const prompt = tools.reviewer.promptForReview(hypothesis, evidence);
  const parse = (text, generator) => {
    const parsed = tools.reviewer.parseReview(text);
    return tools.reviewer.makeReview(parsed, { targetUid: hypothesis.uid, model: generator, prompt });
  };
  let response;
  if (provider === "claude") {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: settings.aiModel || "claude-sonnet-4-6", max_tokens: 1000, temperature: 0, messages: [{ role: "user", content: prompt }] }),
    });
    if (!response.ok) throw new Error(`AI 初审请求失败（${response.status}）`);
    const text = tools.expansion.apiResponseText(await response.json());
    if (!text.trim()) throw new Error("AI 初审响应未包含可读取文本");
    return parse(text, `claude:${settings.aiModel || "default"}`);
  }
  const endpoint = provider === "custom" ? settings.aiCustomEndpoint : (typeof ut !== "undefined" && ut[provider] && ut[provider].endpoint);
  if (!endpoint) throw new Error("请在插件设置中配置可用的 OpenAI 兼容端点或选择 Claude");
  response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: settings.aiModel,
      messages: [{ role: "system", content: "You produce auditable evidence-review recommendations only. Never claim human confirmation." }, { role: "user", content: prompt }],
      ...(provider === "minimax" ? { max_completion_tokens: 1000 } : { max_tokens: 1000 }),
      ...(provider === "deepseek" ? { max_tokens: 1600, response_format: { type: "json_object" }, thinking: { type: "disabled" } } : {}),
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`AI 初审请求失败（${response.status}）`);
  const text = tools.expansion.apiResponseText(await response.json());
  if (!text.trim()) throw new Error("AI 初审响应未包含可读取文本；请检查所选模型或 OpenAI 兼容端点。");
  return parse(text, `${provider}:${settings.aiModel || "default"}`);
}

export function schOpenExperimentCreator(plugin) {
  let tools;
  try {
    tools = schEvidenceTools(plugin);
  } catch (error) {
    new Eo.Notice("无法打开实验编辑器：" + (error.message || error));
    return;
  }
  const projects = tools.hypotheses.loadAll(tools.vault, "project");
  if (!projects.length) {
    new Eo.Notice("请先创建至少一个 Project 对象，再创建 Experiment。");
    return;
  }
  const hypotheses = tools.hypotheses.loadAll(tools.vault, "hypothesis");
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal", "scholarium-experiment-create-modal");
    modal.modalEl.setCssStyles({ width: "min(880px, 94vw)", height: "min(860px, 92vh)" });
    const content = modal.contentEl;
    content.empty();
    content.addClass("sch-experiment-create");
    const header = content.createDiv({ cls: "sch-experiment-create__header" });
    header.createEl("h2", { text: "新建实验对象" });
    header.createEl("p", { text: "Schema v1 · 与旧实验看板并存 · 结果可按块生成 Evidence" });
    const form = content.createDiv({ cls: "sch-experiment-create__form" });
    const makeField = (parent, label, hint) => {
      const field = parent.createDiv({ cls: "sch-experiment-create__field" });
      field.createEl("label", { text: label });
      hint && field.createEl("small", { text: hint });
      return field;
    };
    const makeChoicePicker = (field, choices, initialValue) => {
      const native = field.createEl("select", { cls: "sch-experiment-create__native-picker" });
      for (const choice of choices)
        native.createEl("option", { value: choice.value, text: choice.text });
      native.value = initialValue || choices[0].value;
      const picker = field.createDiv({ cls: "sch-experiment-create__choice-picker" });
      const trigger = picker.createEl("button", { cls: "sch-experiment-create__choice-trigger", attr: { type: "button", "aria-expanded": "false" } });
      const menu = picker.createDiv({ cls: "sch-experiment-create__choice-menu" });
      const sync = () => {
        const choice = choices.find((item) => item.value === native.value) || choices[0];
        trigger.setText(choice.text);
        trigger.title = choice.text;
        for (const option of menu.querySelectorAll("button"))
          option.toggleClass("is-selected", option.dataset.value === native.value);
      };
      for (const choice of choices) {
        const option = menu.createEl("button", { text: choice.text, attr: { type: "button", "data-value": choice.value } });
        option.onclick = () => {
          native.value = choice.value;
          native.dispatchEvent(new Event("change"));
          picker.removeClass("is-open");
          trigger.setAttr("aria-expanded", "false");
          sync();
        };
      }
      trigger.onclick = () => {
        const open = !picker.hasClass("is-open");
        picker.toggleClass("is-open", open);
        trigger.setAttr("aria-expanded", String(open));
      };
      native.onchange = sync;
      sync();
      return native;
    };
    const basics = form.createDiv({ cls: "sch-experiment-create__section" });
    basics.createEl("h3", { text: "基本信息" });
    const basicsGrid = basics.createDiv({ cls: "sch-experiment-create__grid" });
    const projectField = makeField(basicsGrid, "所属课题");
    const project = makeChoicePicker(projectField, projects.map((entry) => ({
      value: entry.object.uid, text: `${entry.object.display_id} · ${entry.object.title}`,
    })));
    const titleField = makeField(basicsGrid, "实验名称");
    const title = titleField.createEl("input", { attr: { type: "text", placeholder: "例如：暗态对照下 CO 产率测试" } });
    const hypothesesSection = form.createDiv({ cls: "sch-experiment-create__section" });
    hypothesesSection.createEl("h3", { text: "关联假设" });
    const hypothesisField = makeField(hypothesesSection, "本实验测试的假设", "可多选；未选择时也可先保存实验记录。");
    const hypothesisToolbar = hypothesisField.createDiv({ cls: "sch-experiment-create__hypothesis-toolbar" });
    hypothesisToolbar.createEl("span", { text: "勾选可关联多条假设" });
    const createHypothesis = hypothesisToolbar.createEl("button", { text: "+ 新建假设" });
    const hypothesisList = hypothesisField.createDiv({ cls: "sch-experiment-create__hypothesis-list" });
    const selectedHypotheses = new Set();
    const renderHypotheses = (entries) => {
      hypothesisList.empty();
      if (!entries.length) {
        hypothesisList.createDiv({ text: "尚未创建假设；可先在此处新建。", cls: "sch-experiment-create__empty-hypotheses" });
        return;
      }
      for (const entry of entries) {
        const label = hypothesisList.createEl("label", { cls: "sch-experiment-create__hypothesis-option" });
        const checkbox = label.createEl("input", { attr: { type: "checkbox", value: entry.object.uid } });
        checkbox.checked = selectedHypotheses.has(entry.object.uid);
        checkbox.onchange = () => checkbox.checked ? selectedHypotheses.add(entry.object.uid) : selectedHypotheses.delete(entry.object.uid);
        const copy = label.createDiv();
        copy.createEl("strong", { text: entry.object.display_id });
        copy.createEl("span", { text: entry.object.statement });
      }
    };
    renderHypotheses(hypotheses);
    createHypothesis.onclick = () => schOpenHypothesisCreator(plugin, (object) => {
      hypotheses.push({ object, path: "" });
      selectedHypotheses.add(object.uid);
      renderHypotheses(hypotheses);
    });
    const statusSection = form.createDiv({ cls: "sch-experiment-create__section sch-experiment-create__section--compact" });
    statusSection.createEl("h3", { text: "当前状态" });
    const statusField = makeField(statusSection, "记录阶段");
    const status = makeChoicePicker(statusField, [
      ["idea", "想法"], ["designed", "已设计"], ["ready", "已准备"], ["running", "进行中"],
      ["data_pending", "等待数据"], ["analyzing", "分析中"], ["concluded", "已得结论"],
    ].map(([value, text]) => ({ value, text })), "designed");
    const provenanceSection = form.createDiv({ cls: "sch-experiment-create__section" });
    provenanceSection.createEl("h3", { text: "数据来源与可复核性" });
    const provenanceIntro = provenanceSection.createEl("p", {
      text: "请明确区分实测、模拟和导入数据。此声明不会由 AI 自动填写；它决定实验能否作为已整合的科研结论。",
      cls: "sch-experiment-create__provenance-intro",
    });
    const provenanceGrid = provenanceSection.createDiv({ cls: "sch-experiment-create__grid" });
    const originField = makeField(provenanceGrid, "数据来源类型", "实测或导入数据需登记至少一个可复核入口。模拟数据可用于流程演练，但不能整合为实测结论。");
    const dataOrigin = makeChoicePicker(originField, [
      { value: "planned", text: "尚未产生数据（计划）" },
      { value: "measured", text: "实测数据" },
      { value: "simulated", text: "模拟 / 流程演示数据" },
      { value: "imported", text: "导入数据" },
    ], "planned");
    const refsField = makeField(provenanceSection, "原始数据入口", "每行一个：Vault 相对路径、仪器原始文件路径、受控数据仓库 DOI 或 URL。它是审计入口，不是对象关系。");
    const rawDataRefs = refsField.createEl("textarea", { attr: { rows: "3", placeholder: "例如：Experiments/raw/2026-08-14/GC-MS-run-01.csv\n或：https://doi.org/10.xxxx/dataset" } });
    const noteField = makeField(provenanceSection, "来源说明", "实测/导入：说明样品、仪器或导入范围；模拟：说明模型、假设和它仅用于流程演练。 ");
    const provenanceNote = noteField.createEl("textarea", { attr: { rows: "3", placeholder: "例如：GC-MS 原始导出；样品批次 S24-0814；由研究者完成并登记。" } });
    const resultsSection = form.createDiv({ cls: "sch-experiment-create__section" });
    resultsSection.createEl("h3", { text: "实验结果" });
    const resultField = makeField(resultsSection, "可取证的结果块", "以空行分隔不同结果；每个结果块之后都可单独创建 Evidence。");
    const result = resultField.createEl("textarea", { attr: { rows: "8", placeholder: "例如：暗态对照下 CO 产率未上升。\n\n365 nm 单光照下 CO 产率上升。" } });
    const conclusionSection = form.createDiv({ cls: "sch-experiment-create__section" });
    conclusionSection.createEl("h3", { text: "结论" });
    const conclusionField = makeField(conclusionSection, "对假设的当前解释", "仅当状态为“已得结论”时必填。可在后续继续修订。");
    const conclusion = conclusionField.createEl("textarea", { attr: { rows: "4", placeholder: "说明这些结果对假设意味着什么。" } });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions sch-experiment-create__actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
    const save = actions.createEl("button", { text: "创建实验", cls: "mod-cta" });
    save.onclick = async () => {
      const name = title.value.trim();
      if (!name) { new Eo.Notice("请填写实验名称。"); title.focus(); return; }
      const testedUids = [...selectedHypotheses];
      const refs = rawDataRefs.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const note = provenanceNote.value.trim();
      if (["measured", "imported"].includes(dataOrigin.value) && (!refs.length || !note)) {
        new Eo.Notice("实测或导入数据请填写至少一个原始数据入口和来源说明。");
        (!refs.length ? rawDataRefs : provenanceNote).focus();
        return;
      }
      if (dataOrigin.value === "simulated" && !note) {
        new Eo.Notice("模拟数据请说明模型或假设，避免与实测数据混淆。");
        provenanceNote.focus();
        return;
      }
      try {
        save.disabled = true;
        const made = tools.experiments.saveNew(tools.vault, {
          title: name, project_uid: project.value, tests_hypotheses: testedUids,
          status: status.value, result: result.value, conclusion: conclusion.value,
          data_origin: dataOrigin.value, raw_data_refs: refs, data_provenance_note: note,
        });
        modal.close();
        new Eo.Notice(`已创建 ${made.object.display_id}；结果可在后续作为待确认 Evidence 的来源。`);
        const file = plugin.app.vault.getAbstractFileByPath(made.path);
        file && (await plugin.app.workspace.getLeaf("tab").openFile(file, { active: true }));
      } catch (error) {
        save.disabled = false;
        new Eo.Notice("创建实验失败：" + (error.message || error));
      }
    };
    window.setTimeout(() => title.focus(), 30);
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

// Data provenance is deliberately editable independently of the lifecycle.
// A researcher may register raw files after acquisition without pretending a
// status transition happened, and an already-integrated record still needs a
// way to correct its audit entry.
function schOpenExperimentDataProvenanceEditor(plugin) {
  let tools, entry;
  try {
    tools = schEvidenceTools(plugin);
    const active = plugin.app.workspace.getActiveFile();
    if (!active) throw new Error("请先打开 Research/Experiments/ 下的一条 Experiment 记录");
    entry = tools.experiments.loadAll(tools.vault).find((item) => item.path === active.path);
    if (!entry) throw new Error("当前笔记不是 Schema v1 的 Experiment");
  } catch (error) {
    new Eo.Notice("无法编辑实验数据来源：" + (error.message || error));
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal", "scholarium-experiment-create-modal");
    modal.modalEl.setCssStyles({ width: "min(760px, 94vw)", height: "min(720px, 90vh)" });
    const content = modal.contentEl;
    content.empty();
    content.addClass("sch-experiment-create");
    const header = content.createDiv({ cls: "sch-experiment-create__header" });
    header.createEl("h2", { text: "编辑实验数据来源" });
    header.createEl("p", { text: `${entry.object.display_id} · 仅修改来源声明与审计入口，不改变实验状态或结果正文。` });
    const form = content.createDiv({ cls: "sch-experiment-create__form" });
    const section = form.createDiv({ cls: "sch-experiment-create__section" });
    section.createEl("h3", { text: "数据来源与可复核性" });
    section.createEl("p", {
      text: entry.object.data_origin === undefined
        ? "这是一条遗留 Experiment，尚未声明数据来源。请不要把历史记录默认当作实测。"
        : "修改后会写入可读的 Markdown frontmatter；Agent 无法替你把模拟数据声明为实测。",
      cls: "sch-experiment-create__provenance-intro",
    });
    const makeField = (label, hint) => {
      const field = section.createDiv({ cls: "sch-experiment-create__field" });
      field.createEl("label", { text: label });
      hint && field.createEl("small", { text: hint });
      return field;
    };
    const originField = makeField("数据来源类型", "实测/导入必须有数据入口与说明；模拟记录不能进入 integrated。");
    const origin = originField.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    for (const [value, label] of [["planned", "尚未产生数据（计划）"], ["measured", "实测数据"], ["simulated", "模拟 / 流程演示数据"], ["imported", "导入数据"]])
      origin.createEl("option", { value, text: label });
    origin.value = entry.object.data_origin || "planned";
    const refsField = makeField("原始数据入口", "每行一个：Vault 相对路径、仪器原始文件路径、受控数据仓库 DOI 或 URL。它不是对象关系。");
    const refs = refsField.createEl("textarea", { attr: { rows: "4", placeholder: "例如：Experiments/raw/2026-08-14/GC-MS-run-01.csv" } });
    refs.value = Array.isArray(entry.object.raw_data_refs) ? entry.object.raw_data_refs.join("\n") : "";
    const noteField = makeField("来源说明", "说明样品、仪器/批次、导入范围，或模拟的模型与假设。");
    const note = noteField.createEl("textarea", { attr: { rows: "4", placeholder: "例如：GC-MS 原始导出；样品批次 S24-0814；研究者手动登记。" } });
    note.value = String(entry.object.data_provenance_note || "");
    const status = form.createDiv({ cls: "setting-item-description" });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions sch-experiment-create__actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
    const save = actions.createEl("button", { text: "保存数据来源", cls: "mod-cta" });
    save.onclick = () => {
      const rawRefs = refs.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      const explanation = note.value.trim();
      if (["measured", "imported"].includes(origin.value) && (!rawRefs.length || !explanation)) {
        status.setText("实测或导入数据必须填写至少一个原始数据入口和来源说明。");
        (!rawRefs.length ? refs : note).focus();
        return;
      }
      if (origin.value === "simulated" && !explanation) {
        status.setText("模拟数据必须说明模型或假设，避免与实测混淆。");
        note.focus();
        return;
      }
      try {
        save.disabled = true;
        const now = new Date().toISOString();
        const object = {
          ...entry.object,
          data_origin: origin.value,
          raw_data_refs: rawRefs,
          data_provenance_note: explanation,
          data_recorded_by: "user",
          data_recorded_at: now,
          updated_at: now,
        };
        tools.experiments.saveExisting(tools.vault, entry.path, object);
        modal.close();
        new Eo.Notice(`${object.display_id} 的数据来源已登记为“${origin.options[origin.selectedIndex].text}”。`);
      } catch (error) {
        save.disabled = false;
        status.setText("保存失败：" + (error.message || error));
      }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

function schOpenExperimentEvidenceCreator(plugin) {
  let tools, entry, record;
  try {
    tools = schEvidenceTools(plugin);
    const active = plugin.app.workspace.getActiveFile();
    if (!active) throw new Error("请先打开 Research/Experiments/ 下的一条 Experiment 记录");
    entry = tools.experiments.loadAll(tools.vault).find((item) => item.path === active.path);
    if (!entry) throw new Error("当前笔记不是 Schema v1 的 Experiment；请先用“研究对象：新建实验”创建一条记录");
    record = tools.experiments.readRecord(tools.vault, entry);
    if (!record.blocks.length) throw new Error("这条实验尚未填写结果；请先在“## 结果”下写入可复核的结果块");
  } catch (error) {
    new Eo.Notice("无法从实验记录创建证据：" + (error.message || error));
    return;
  }
  const hypotheses = tools.hypotheses.loadAll(tools.vault, "hypothesis");
  if (!hypotheses.length) { new Eo.Notice("还没有 Hypothesis。请先运行“研究对象：新建假设”。"); return; }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal", "scholarium-experiment-create-modal");
    modal.modalEl.setCssStyles({ width: "min(880px, 94vw)", height: "min(860px, 92vh)" });
    const content = modal.contentEl;
    content.empty();
    content.addClass("sch-experiment-create", "sch-experiment-evidence-create");
    const header = content.createDiv({ cls: "sch-experiment-create__header" });
    header.createEl("h2", { text: "从实验结果创建证据" });
    header.createEl("p", { text: "锁定实验结果的正文与块哈希 · 创建后仍需在审核器确认，才会进入正式关系并写入 Experiment 的 produced_evidence" });
    const form = content.createDiv({ cls: "sch-experiment-create__form" });
    const makeField = (parent, label, hint) => {
      const field = parent.createDiv({ cls: "sch-experiment-create__field" });
      field.createEl("label", { text: label });
      hint && field.createEl("small", { text: hint });
      return field;
    };
    const resultSection = form.createDiv({ cls: "sch-experiment-create__section" });
    resultSection.createEl("h3", { text: "实验结果" });
    const blockField = makeField(resultSection, "选择结果块", "只能选择当前 Experiment 中的已记录结果；引用文本必须来自该结果块。");
    const block = blockField.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    for (const item of record.blocks) {
      const option = block.createEl("option", { value: item.id, text: `${item.id} · ${item.label || item.text.slice(0, 72)}` });
      option.title = item.text;
    }
    const quoteField = makeField(resultSection, "引用文本", "将作为可复核的原始结果；默认填入所选结果块，可酌情截取其一部分。");
    const quote = quoteField.createEl("textarea", { attr: { rows: "6" } });
    const fillQuote = () => { quote.value = record.blocks.find((item) => item.id === block.value)?.text || ""; };
    block.onchange = fillQuote;
    fillQuote();
    const interpretationSection = form.createDiv({ cls: "sch-experiment-create__section" });
    interpretationSection.createEl("h3", { text: "证据解释" });
    const targetField = makeField(interpretationSection, "目标假设", "选择这项结果要检验的假设；完整陈述会显示在下方。 ");
    const target = targetField.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    for (const item of hypotheses)
      target.createEl("option", { value: item.object.uid, text: `${item.object.display_id} · ${item.object.statement}` });
    const linked = new Set(entry.object.tests_hypotheses || []);
    const linkedHypothesis = hypotheses.find((item) => linked.has(item.object.uid));
    if (linkedHypothesis) target.value = linkedHypothesis.object.uid;
    const targetSummary = targetField.createDiv({ cls: "sch-experiment-evidence-create__selected-text" });
    const showTarget = () => {
      const selected = hypotheses.find((item) => item.object.uid === target.value);
      target.title = selected ? `${selected.object.display_id} · ${selected.object.statement}` : "";
      targetSummary.setText(target.title);
    };
    target.onchange = showTarget;
    showTarget();
    const interpretationGrid = interpretationSection.createDiv({ cls: "sch-experiment-evidence-create__grid" });
    const relationField = makeField(interpretationGrid, "与该假设的关系", "这是你的科研判断，不会自动确认。 ");
    const relation = relationField.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    relation.createEl("option", { value: "", text: "请选择关系…" });
    for (const [value, label] of [["SUPPORTS", "支持"], ["CONTRADICTS", "反驳"], ["QUALIFIES", "限定适用条件"], ["REPLICATES", "重复得到"], ["FAILS_TO_REPLICATE", "未能重复"], ["DEPENDS_ON", "依赖条件"]])
      relation.createEl("option", { value, text: label });
    const claimField = makeField(interpretationGrid, "你的证据主张", "用自己的话说明这项结果为何支持、反驳或限定该假设。 ");
    const claim = claimField.createEl("textarea", { attr: { rows: "4", placeholder: "例如：暗态下未检出还原产物，说明光照是该反应发生的必要条件。" } });
    let save = null;
    let aiRejectedCreation = false;
    const updateCreateAvailability = () => {
      if (!save) return;
      const blocked = aiRejectedCreation && !claim.value.trim();
      save.disabled = blocked;
      save.setText(blocked ? "请先填写证据主张" : "创建待确认的证据");
      save.title = blocked ? "AI 未找到可成立的证据主张；请先自行写明主张，或重新让 AI 起草。" : "";
    };
    claim.addEventListener("input", updateCreateAvailability);
    const aiDraft = interpretationSection.createDiv({ cls: "sch-experiment-evidence-create__ai-draft" });
    const aiStatus = aiDraft.createDiv({ text: "可让 AI 根据当前结果块与目标假设起草关系、主张和理由；草案不会自动确认。" });
    const aiReview = aiDraft.createEl("button", { text: "AI 起草证据判断" });
    let reviewDraft = null;
    const runAiDraft = async () => {
      const hypothesis = hypotheses.find((item) => item.object.uid === target.value)?.object;
      if (!hypothesis) throw new Error("AI 初审找不到目标 Hypothesis");
      const current = tools.experiments.readRecord(tools.vault, entry);
      const provisional = tools.locator.createEvidenceFromExperiment(current, {
        anchorId: block.value, quote: quote.value, claim: "候选实验结果，等待 AI 起草判断。",
        targetUid: target.value, relation: "QUALIFIES", createdBy: "user",
        existingDisplayIds: [],
      });
      return schReviewEvidenceViaApi(plugin, tools, hypothesis, provisional);
    };
    aiReview.onclick = async () => {
      try {
        aiReview.disabled = true;
        aiStatus.setText("AI 正在起草证据判断；不会自动确认或写入正式关系…");
        const review = await runAiDraft();
        reviewDraft = review;
        if (review.decision === "confirm") {
          aiRejectedCreation = false;
          relation.value = review.relation;
          claim.value = review.claim;
          aiStatus.setText(`AI 建议：${review.relation}。${review.reason} 你可修改后再创建待确认 Evidence。`);
        } else if (review.decision === "reject") {
          // The rejection draft explains the mismatch. It is intentionally
          // editable and does not select a relation or confirm anything.
          claim.value = review.claim;
          aiRejectedCreation = !claim.value.trim();
          aiStatus.setText(`AI 不建议创建：${review.reason}。已起草“为何不成立”的证据主张；如仍要创建，请核对它与所选关系一致。`);
        } else {
          aiRejectedCreation = false;
          if (review.claim) claim.value = review.claim;
          aiStatus.setText(`AI 建议保留判断：${review.reason} 已填入中性结果摘要；请据此补充主张或自行判定关系。`);
        }
        updateCreateAvailability();
      } catch (error) {
        reviewDraft = null;
        aiStatus.setText("AI 起草失败：" + (error.message || error));
      } finally {
        aiReview.disabled = false;
      }
    };
    target.onchange = () => { showTarget(); reviewDraft = null; aiRejectedCreation = false; aiStatus.setText("目标假设已变更；如需 AI 草案，请重新起草。 "); updateCreateAvailability(); };
    block.addEventListener("change", () => { reviewDraft = null; aiRejectedCreation = false; aiStatus.setText("结果块已变更；如需 AI 草案，请重新起草。 "); updateCreateAvailability(); });
    quote.addEventListener("input", () => { reviewDraft = null; aiRejectedCreation = false; aiStatus.setText("引用文本已修改；如需 AI 草案，请重新起草。 "); updateCreateAvailability(); });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions sch-experiment-create__actions" });
    actions.createEl("button", { text: "关闭" }).onclick = () => modal.close();
    save = actions.createEl("button", { text: "创建待确认的证据", cls: "mod-cta" });
    updateCreateAvailability();
    save.onclick = async () => {
      const statement = claim.value.trim();
      if (!statement) { new Eo.Notice("请写明这项实验结果构成什么证据。"); claim.focus(); return; }
      if (!relation.value) { new Eo.Notice("请选择这项结果与假设的关系。"); relation.focus(); return; }
      try {
        save.disabled = true;
        const existing = tools.hypotheses.loadAll(tools.vault, "evidence").map((item) => item.object.display_id);
        // Re-read at click time: a result changed while this dialog was open is
        // a new source state, never a locator silently bound to old text.
        const current = tools.experiments.readRecord(tools.vault, entry);
        const duplicate = tools.hypotheses.findEvidenceByLocator(tools.vault, {
          sourceUid: current.object.uid, anchor: block.value, targetUid: target.value,
        });
        if (duplicate) {
          throw new Error(`该实验结果已创建为 ${duplicate.object.display_id}（${duplicate.object.review_status || "待审"}）；请审核或编辑原证据，而非重复创建。`);
        }
        const evidence = tools.locator.createEvidenceFromExperiment(current, {
          anchorId: block.value, quote: quote.value, claim: statement,
          targetUid: target.value, relation: relation.value, createdBy: "user",
          ...(reviewDraft && reviewDraft.target_uid === target.value ? { aiReview: reviewDraft } : {}),
          existingDisplayIds: existing,
        });
        const relative = tools.hypotheses.saveObject(tools.vault, evidence);
        modal.close();
        new Eo.Notice(`已创建 ${evidence.display_id}；请在证据审核器确认后写入正式关系。`);
        const file = plugin.app.vault.getAbstractFileByPath(relative);
        file && (await plugin.app.workspace.getLeaf("tab").openFile(file, { active: true }));
      } catch (error) {
        save.disabled = false;
        new Eo.Notice("创建实验来源证据失败：" + (error.message || error));
      }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

function schOpenHypothesisCreator(plugin, onCreated) {
  let tools;
  try {
    tools = schEvidenceTools(plugin);
  } catch (error) {
    new Eo.Notice("无法打开假设编辑器：" + (error.message || error));
    return;
  }
  const projects = tools.hypotheses.loadAll(tools.vault, "project");
  if (!projects.length) {
    new Eo.Notice("请先创建至少一个 Project 对象，再创建 Hypothesis。");
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal");
    const content = modal.contentEl;
    content.createEl("h2", { text: "新建研究假设" });
    content.createEl("p", {
      text: "假设先以“待提出”保存；置信度只能由研究者日后手动设置。",
      cls: "setting-item-description",
    });
    content.createEl("label", { text: "所属课题" });
    const project = content.createEl("select");
    for (const entry of projects)
      project.createEl("option", {
        value: entry.object.uid,
        text: `${entry.object.display_id} · ${entry.object.title}`,
      });
    content.createEl("label", { text: "可检验的假设陈述" });
    const statement = content.createEl("textarea", {
      attr: {
        rows: "5",
        placeholder: "例如：在固定光通量下，界面电荷转移是活性提升的主导因素。",
      },
    });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
    const save = actions.createEl("button", { text: "创建假设", cls: "mod-cta" });
    save.onclick = async () => {
      const text = statement.value.trim();
      if (!text) {
        new Eo.Notice("请填写假设陈述。");
        statement.focus();
        return;
      }
      try {
        save.disabled = true;
        const existing = tools.hypotheses.loadAll(tools.vault, "hypothesis")
          .map((entry) => entry.object.display_id);
        const object = tools.schema.createObject("hypothesis", {
          project_uid: project.value,
          statement: text,
          status: "proposed",
        }, { existingDisplayIds: existing });
        const relative = tools.hypotheses.saveObject(tools.vault, object);
        modal.close();
        onCreated && onCreated(object);
        new Eo.Notice(`已创建 ${object.display_id}：${object.statement.slice(0, 48)}`);
        const file = plugin.app.vault.getAbstractFileByPath(relative);
        file && (await plugin.app.workspace.getLeaf("tab").openFile(file, { active: true }));
      } catch (error) {
        save.disabled = false;
        new Eo.Notice("创建假设失败：" + (error.message || error));
      }
    };
    window.setTimeout(() => statement.focus(), 30);
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

function schOpenEvidenceSelectionReader(plugin) {
  let tools, active, archive, cleanFile;
  try {
    tools = schEvidenceTools(plugin);
    active = plugin.app.workspace.getActiveFile();
    if (!active) throw new Error("请先在 Obsidian 中打开一篇已迁移的 Paper 笔记");
    const cache = plugin.app.metadataCache.getFileCache(active);
    if (((cache && cache.frontmatter) || {}).type !== "paper")
      throw new Error("当前笔记不是 Schema v1 的 Paper；请打开 Research/Papers/ 下的论文笔记");
    archive = tools.locator.loadArchive(tools.vault, active.path);
    const integrity = tools.locator.verifyArchiveIntegrity(archive);
    if (!integrity.ok) throw new Error("归档完整性校验失败：" + integrity.reason);
    cleanFile = plugin.app.vault.getAbstractFileByPath(
      String(archive.paper.source_archive_path || "") + "/source.clean.html",
    );
    if (!cleanFile) throw new Error("找不到 Paper 对应的 source.clean.html");
  } catch (error) {
    new Eo.Notice("无法打开证据阅读器：" + (error.message || error));
    return;
  }
  const hypotheses = tools.hypotheses.loadAll(tools.vault, "hypothesis");
  if (!hypotheses.length) {
    new Eo.Notice("还没有 Hypothesis。请先运行“研究对象：新建假设”。");
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal");
    modal.modalEl.setCssStyles({ width: "min(1280px, 96vw)", height: "min(900px, 92vh)" });
    const content = modal.contentEl;
    content.setCssStyles({ height: "100%", display: "flex", flexDirection: "column", gap: "8px" });
    content.createEl("h2", { text: "从归档正文创建证据" });
    content.createEl("p", {
      text: "在下方正文的同一段落内选中文字，再点击“读取选区”。系统会核验锚点、归档哈希和来源，不接受手填定位。",
      cls: "setting-item-description",
    });
    // app:// resource URLs render in Obsidian itself, but an Electron webview
    // cannot consistently navigate to them.  The result is a blank reader and
    // therefore no possible selection.  source.clean.html is already local,
    // script-free and has a <base>, so render its bytes in same-origin srcdoc.
    // That also lets the host inspect the user's selection without injecting a
    // remote script into a publisher page.
    const reader = document.createElement("iframe");
    reader.setCssStyles({ flex: "1 1 auto", minHeight: "260px", width: "100%", border: "1px solid var(--background-modifier-border)", borderRadius: "6px" });
    content.appendChild(reader);
    const status = content.createDiv({
      text: "尚未读取选区。",
      cls: "setting-item-description scholarium-evidence-selection-status",
    });
    const form = content.createDiv({ cls: "scholarium-evidence-form" });
    form.createEl("label", { text: "目标假设" });
    const target = form.createEl("select");
    for (const entry of hypotheses)
      target.createEl("option", {
        value: entry.object.uid,
        text: `${entry.object.display_id} · ${entry.object.statement}`,
      });
    form.createEl("label", { text: "与该假设的关系" });
    const relation = form.createEl("select");
    for (const [value, label] of [
      ["SUPPORTS", "支持"], ["CONTRADICTS", "反驳"], ["QUALIFIES", "限定适用条件"],
      ["REPLICATES", "重复得到"], ["FAILS_TO_REPLICATE", "未能重复"], ["DEPENDS_ON", "依赖条件"],
    ]) relation.createEl("option", { value, text: label });
    form.createEl("label", { text: "你的证据主张" });
    const claim = form.createEl("textarea", {
      attr: { rows: "2", placeholder: "用一句话说明这段文字为何与该假设有关。" },
    });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions" });
    const read = actions.createEl("button", { text: "读取选区" });
    read.disabled = true;
    const save = actions.createEl("button", { text: "创建待确认的证据", cls: "mod-cta" });
    save.disabled = true;
    actions.createEl("button", { text: "关闭" }).onclick = () => modal.close();
    let picked = null, readerReady = false;
    plugin.app.vault.cachedRead(cleanFile).then((html) => {
      reader.srcdoc = html;
    }).catch((error) => {
      status.setText("归档正文读取失败：" + (error.message || error));
    });
    reader.onload = () => {
      readerReady = true;
      read.disabled = false;
      status.setText("归档正文已加载；请在同一段落内选中文字，再读取选区。");
    };
    read.onclick = async () => {
      try {
        if (!readerReady || !reader.contentDocument)
          throw new Error("归档正文仍在加载，请稍候再试");
        const doc = reader.contentDocument,
          selection = doc.defaultView && doc.defaultView.getSelection();
        if (!selection || selection.rangeCount !== 1 || !selection.toString().trim())
          throw new Error("请先在正文中选择一段文字");
        const element = (node) => node && (node.nodeType === 1 ? node : node.parentElement),
          start = element(selection.anchorNode)?.closest?.("[data-sch-anchor]"),
          end = element(selection.focusNode)?.closest?.("[data-sch-anchor]"),
          value = !start || start !== end
            ? { error: "请只在同一个段落/图注内选择文字" }
            : { anchorId: start.getAttribute("data-sch-anchor"), quote: selection.toString().replace(/\s+/g, " ").trim() };
        if (value.error) throw new Error(value.error);
        const checked = tools.locator.buildLocator(archive, value.anchorId, value.quote);
        picked = { anchorId: value.anchorId, quote: value.quote, region: checked.region };
        claim.value || (claim.value = value.quote);
        status.setText(`已核验锚点 ${picked.anchorId}（${picked.region === "unknown" ? "未标注正文区域" : "正文区域"}）：${picked.quote.slice(0, 100)}`);
        save.disabled = false;
      } catch (error) {
        picked = null;
        save.disabled = true;
        status.setText("选区不可用：" + (error.message || error));
      }
    };
    save.onclick = async () => {
      if (!picked) return;
      const text = claim.value.trim();
      if (!text) {
        new Eo.Notice("请写明这段文字构成什么证据。");
        claim.focus();
        return;
      }
      try {
        save.disabled = true;
        const existing = tools.hypotheses.loadAll(tools.vault, "evidence")
          .map((entry) => entry.object.display_id);
        const evidence = tools.locator.createEvidenceFromQuote(archive, {
          anchorId: picked.anchorId,
          quote: picked.quote,
          claim: text,
          targetUid: target.value,
          relation: relation.value,
          createdBy: "user",
          existingDisplayIds: existing,
        });
        const relative = tools.hypotheses.saveObject(tools.vault, evidence);
        modal.close();
        new Eo.Notice(`已创建 ${evidence.display_id}，等待你确认后才会进入正式支持/反驳关系。`);
        const file = plugin.app.vault.getAbstractFileByPath(relative);
        file && (await plugin.app.workspace.getLeaf("tab").openFile(file, { active: true }));
      } catch (error) {
        save.disabled = false;
        new Eo.Notice("创建证据失败：" + (error.message || error));
      }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

// Candidate generation and scientific judgement are intentionally separate.
// This reviewer is the human boundary: a locator can prove where a quotation
// came from, but cannot prove that it bears on the selected hypothesis.
function schOpenEvidenceReviewer(plugin) {
  let tools, pending, hypotheses;
  try {
    tools = schEvidenceTools(plugin);
    // A workflow demonstration is deliberately neither pending nor a formal
    // relation.  Showing it here would invite a second, contradictory review.
    pending = tools.hypotheses.loadAll(tools.vault, "evidence")
      .filter((entry) => entry.object.review_status === "pending");
    hypotheses = tools.hypotheses.loadAll(tools.vault, "hypothesis");
  } catch (error) {
    new Eo.Notice("无法打开证据审核器：" + (error.message || error));
    return;
  }
  if (!pending.length) {
    new Eo.Notice("没有待确认的证据。已驳回的证据不会再次进入待审队列。");
    return;
  }
  if (!hypotheses.length) {
    new Eo.Notice("没有可关联的 Hypothesis，无法审核证据。");
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    // Keep the action bar outside the scrolling reviewer form. The form uses
    // the same flex layout as the experiment creator, so this modal class must
    // be present for its height and overflow rules to apply.
    modal.modalEl.addClass("scholarium-evidence-modal", "scholarium-experiment-create-modal", "scholarium-evidence-reviewer-modal");
    modal.modalEl.setCssStyles({ position: "relative", overflow: "hidden" });
    modal.modalEl.setCssStyles({ width: "min(900px, 94vw)", height: "min(860px, 92vh)" });
    const content = modal.contentEl;
    content.empty();
    content.addClass("sch-experiment-create");

    const makeField = (parent, label, hint) => {
      const field = parent.createDiv({ cls: "sch-experiment-create__field" });
      field.createEl("label", { text: label });
      hint && field.createEl("small", { text: hint });
      return field;
    };

    // Header
    const header = content.createDiv({ cls: "sch-experiment-create__header" });
    const heading = header.createEl("h2", { text: `审核待确认的证据（${pending.length} 条）` });
    header.createEl("p", {
      text: "系统只核验出处与定位；是否相关、支持还是反驳由你决定。确认才会写入正式关系；驳回会保留原因，今后不会再作为待审候选出现。",
    });

    // Form
    const form = content.createDiv({ cls: "sch-experiment-create__form" });

    // Section: 选择待审证据
    const section1 = form.createDiv({ cls: "sch-experiment-create__section" });
    section1.createEl("h3", { text: "选择待审证据" });
    const fChoose = makeField(section1, "待审证据");
    const choose = fChoose.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    for (const entry of pending) {
      const opt = choose.createEl("option", {
        value: entry.object.uid,
        text: `${entry.object.display_id} · ${(entry.object.claim || "仅检索候选，尚未形成主张").slice(0, 86)}`,
      });
      opt.title = entry.object.claim || "仅检索候选，尚未形成主张";
    }
    const batch = section1.createEl("details", { cls: "scholarium-evidence-batch" });
    batch.style.marginTop = "12px";
    batch.createEl("summary", { text: "批量驳回（仅用于已审过、同样无关的候选）" });
    batch.createEl("p", {
      text: "确认仍需逐条进行。勾选后可将同一驳回理由应用到多条候选，并会要求再次确认。",
      cls: "sch-exp-hint",
    });
    const batchList = batch.createDiv({ cls: "scholarium-evidence-batch-list" });
    const batchSelected = new Set();
    for (const entry of pending) {
      const row = batchList.createEl("label", { cls: "scholarium-evidence-batch-item" });
      row.setAttribute("data-evidence-uid", entry.object.uid);
      const box = row.createEl("input", { type: "checkbox" });
      box.onchange = () => {
        if (box.checked) batchSelected.add(entry.object.uid);
        else batchSelected.delete(entry.object.uid);
        updateBatchButton();
      };
      row.appendText(` ${entry.object.display_id} · ${(entry.object.claim || "仅检索候选，尚未形成主张").slice(0, 110)}`);
    }

    // Section: 证据详情
    const section2 = form.createDiv({ cls: "sch-experiment-create__section" });
    section2.createEl("h3", { text: "证据详情" });
    const fQuote = makeField(section2, "引用文本", "来自证据定位器的原始选区；只读。");
    const quote = fQuote.createEl("textarea", {
      cls: "sch-experiment-create__field",
      attr: { rows: "5", readonly: "true" },
    });
    const fClaim = makeField(section2, "证据主张", "可在此修正证据主张后再确认。");
    const claim = fClaim.createEl("textarea", { attr: { rows: "3" } });

    // Section: 关系判定
    const section3 = form.createDiv({ cls: "sch-experiment-create__section" });
    section3.createEl("h3", { text: "关系判定" });
    const grid3 = section3.createDiv({ cls: "sch-experiment-evidence-create__grid" });
    const fTarget = makeField(grid3, "目标假设", "可在确认前修正目标假设。");
    const target = fTarget.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    for (const entry of hypotheses) {
      const opt = target.createEl("option", {
        value: entry.object.uid,
        text: `${entry.object.display_id} · ${entry.object.statement}`,
      });
      opt.title = `${entry.object.display_id} · ${entry.object.statement}`;
    }
    const fRelation = makeField(grid3, "你判定的关系", "这是你的科研判断，不会自动确认。");
    const relation = fRelation.createEl("select", { cls: "sch-experiment-evidence-create__select" });
    for (const [value, label] of [
      ["", "请选择人工判定"],
      ["SUPPORTS", "支持"],
      ["CONTRADICTS", "反驳"],
      ["QUALIFIES", "限定适用条件"],
      ["REPLICATES", "重复得到"],
      ["FAILS_TO_REPLICATE", "未能重复"],
      ["DEPENDS_ON", "依赖条件"],
    ]) {
      const opt = relation.createEl("option", { value, text: label });
      opt.title = label;
    }

    // Section: 驳回原因
    const section4 = form.createDiv({ cls: "sch-experiment-create__section" });
    section4.createEl("h3", { text: "驳回原因" });
    const fReason = makeField(section4, "驳回原因", "仅在驳回时必填；会成为以后不重复提议的依据。");
    const reason = fReason.createEl("textarea", {
      attr: { rows: "2", placeholder: "例如：该段只讨论 carbyne/cumulene，与 AuNP–BiVO₄ 假设无关。" },
    });

    // Status lines (outside sections, inside form padding)
    const status = form.createDiv({ cls: "sch-exp-hint" });
    status.style.marginTop = "-8px";
    const aiStatus = form.createDiv({ cls: "scholarium-ai-review-status sch-exp-hint" });

    let aiReview, aiReviewAll, acceptAi;
    const current = () => pending.find((entry) => entry.object.uid === choose.value);
    const fill = () => {
      const entry = current();
      if (!entry) return;
      const o = entry.object;
      quote.value = o.quote || "（旧证据未保存选区原文；仍可由 locator 复核）";
      claim.value = o.claim || "";
      target.value = o.target_uid || hypotheses[0].object.uid;
      relation.value = o.relation || "";
      reason.value = "";
      status.setText(`出处：${(o.locator || {}).original_url || "未知"} · 锚点：${(o.locator || {}).anchor || "未知"} · ${o.candidate_only ? "仅检索候选，尚待形成主张" : (o.created_by === "ai" ? "AI 候选" : "用户创建")}`);
      const review = o.ai_review;
      if (review && review.target_uid === target.value) {
        const decision = review.decision === "confirm" ? "建议采纳" : review.decision === "reject" ? "建议驳回" : "建议保留";
        aiStatus.setText(`AI 初审（${review.model}，${review.reviewed_at}）：${decision}。${review.reason}`);
        if (review.decision === "confirm") {
          claim.value = review.claim || claim.value;
          relation.value = review.relation || relation.value;
        } else if (review.decision === "reject") reason.value = review.reason || "";
        if (acceptAi) {
          acceptAi.disabled = review.decision === "uncertain";
          acceptAi.textContent = review.decision === "confirm" ? "采纳 AI 建议：确认" : review.decision === "reject" ? "采纳 AI 建议：驳回" : "AI 建议保留，需人工判断";
        }
      } else {
        aiStatus.setText("尚未进行 AI 初审。AI 只能提出建议；你点击采纳后才会确认或驳回。");
        if (acceptAi) { acceptAi.disabled = true; acceptAi.textContent = "采纳 AI 建议"; }
      }
    };
    choose.onchange = fill;

    // Actions
    // The review form can be much taller than the viewport. Attach the actions
    // to the modal root rather than the scrolling content so submit controls
    // remain visible from the first frame.
    form.style.paddingBottom = "84px";
    const actions = modal.modalEl.createDiv({ cls: "scholarium-evidence-actions sch-experiment-create__actions scholarium-evidence-reviewer__actions" });
    actions.setCssStyles({
      position: "absolute", bottom: "0", left: "0", right: "0", zIndex: "20",
      display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center",
      padding: "12px 24px", background: "var(--background-primary)",
      borderTop: "1px solid var(--background-modifier-border)",
      boxShadow: "0 -6px 18px rgba(0, 0, 0, .12)",
    });
    aiReview = actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__ai", text: "AI 初审本条" });
    aiReviewAll = actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__ai", text: "AI 初审全部待审" });
    acceptAi = actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__accept", text: "采纳 AI 建议" });
    acceptAi.disabled = true;
    const confirm = actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__confirm", text: "确认并写入正式关系" });
    const reject = actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__reject", text: "驳回并记录原因" });
    actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__close", text: "关闭" }).onclick = () => modal.close();
    const batchReject = actions.createEl("button", { cls: "scholarium-btn scholarium-evidence-reviewer__reject", text: "批量驳回已勾选（0）" });
    batchReject.disabled = true;

    const updateBatchButton = () => {
      batchReject.textContent = `批量驳回已勾选（${batchSelected.size}）`;
      batchReject.disabled = batchSelected.size === 0;
    };
    const disable = (value) => {
      confirm.disabled = value;
      reject.disabled = value;
      aiReview.disabled = value;
      aiReviewAll.disabled = value;
      if (value) acceptAi.disabled = true;
      batchReject.disabled = value || batchSelected.size === 0;
    };
    const removeReviewed = (uids) => {
      const ids = new Set(uids);
      const oldIndex = Math.max(0, pending.findIndex((entry) => entry.object.uid === choose.value));
      pending = pending.filter((entry) => !ids.has(entry.object.uid));
      for (const option of Array.from(choose.options)) if (ids.has(option.value)) option.remove();
      for (const uid of ids) {
        batchSelected.delete(uid);
        batchList.querySelector(`[data-evidence-uid="${uid}"]`)?.remove();
      }
      heading.setText(`审核待确认的证据（${pending.length} 条）`);
      updateBatchButton();
      if (!pending.length) {
        modal.close();
        new Eo.Notice("本轮待确认的证据已全部审核完成。");
        return;
      }
      choose.value = pending[Math.min(oldIndex, pending.length - 1)].object.uid;
      fill();
      disable(false);
    };
    const revised = () => {
      const entry = current();
      if (!entry) throw new Error("未找到当前待审证据");
      const text = claim.value.trim();
      if (!text) throw new Error("请保留或修正证据主张");
      if (!relation.value) throw new Error("请由研究者判定该段与假设的关系");
      const object = { ...entry.object, claim: text, target_uid: target.value, relation: relation.value, updated_at: new Date().toISOString() };
      delete object.candidate_only;
      const body = tools.schema.parseObject(require("node:fs").readFileSync(tools.path.join(tools.vault, ...entry.path.split("/")), "utf8")).body;
      tools.hypotheses.saveExistingObject(tools.vault, entry.path, object, body);
      entry.object = object;
      return object;
    };
    const saveAiReview = (entry, review) => {
      const object = { ...entry.object, ai_review: review, updated_at: new Date().toISOString() };
      const body = tools.schema.parseObject(require("node:fs").readFileSync(tools.path.join(tools.vault, ...entry.path.split("/")), "utf8")).body;
      tools.hypotheses.saveExistingObject(tools.vault, entry.path, object, body);
      entry.object = object;
      return object;
    };
    const reviewOneWithAi = async (entry, targetUid) => {
      const hypothesis = hypotheses.find((item) => item.object.uid === targetUid)?.object;
      if (!hypothesis) throw new Error("AI 初审找不到目标 Hypothesis");
      const review = await schReviewEvidenceViaApi(plugin, tools, hypothesis, entry.object);
      return saveAiReview(entry, review);
    };
    aiReview.onclick = async () => {
      const entry = current();
      if (!entry) return;
      try {
        disable(true);
        status.setText("AI 正在初审本条证据；不会自动确认或驳回…");
        await reviewOneWithAi(entry, target.value);
        fill();
        new Eo.Notice(`${entry.object.display_id} 已获得 AI 初审建议；请修改后采纳，或保留为待审。`);
      } catch (error) {
        new Eo.Notice("AI 初审失败：" + (error.message || error));
      } finally {
        disable(false);
        fill();
      }
    };
    aiReviewAll.onclick = async () => {
      const entries = pending.filter((entry) => !entry.object.ai_review);
      if (!entries.length) {
        new Eo.Notice("所有待审证据都已有 AI 初审建议；如需重判，请逐条运行 AI 初审。");
        return;
      }
      if (!window.confirm(`AI 将逐条初审 ${entries.length} 条候选并保存建议，不会自动确认或驳回。是否继续？`)) return;
      disable(true);
      const failed = [];
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        try {
          status.setText(`AI 初审 ${index + 1}/${entries.length}：${entry.object.display_id}…`);
          await reviewOneWithAi(entry, entry.object.target_uid || hypotheses[0].object.uid);
        } catch (error) {
          failed.push(`${entry.object.display_id}：${error.message || error}`);
        }
      }
      fill();
      disable(false);
      new Eo.Notice(failed.length ? `AI 初审完成；${failed.length} 条失败：${failed.join("；")}` : `AI 已初审 ${entries.length} 条候选；请逐条采纳或修改建议。`);
    };
    acceptAi.onclick = () => {
      const entry = current();
      const review = entry?.object.ai_review;
      if (!entry || !review || review.decision === "uncertain") return;
      if (review.target_uid !== target.value) {
        new Eo.Notice("目标假设已变化；请在当前目标下重新运行 AI 初审。");
        return;
      }
      const action = review.decision === "confirm" ? "确认" : "驳回";
      if (!window.confirm(`采纳 AI 的“${action}”建议吗？你可先修改主张、关系或理由；本次点击将作为人工审核记录。`)) return;
      try {
        disable(true);
        if (review.decision === "confirm") {
          const object = revised();
          tools.hypotheses.confirmEvidence(tools.vault, object.uid);
          removeReviewed([object.uid]);
          new Eo.Notice(`${object.display_id} 已采纳 AI 建议并确认。`);
        } else {
          const text = reason.value.trim();
          if (!text) throw new Error("请保留或修正 AI 给出的驳回原因");
          tools.hypotheses.rejectEvidence(tools.vault, entry.object.uid, text);
          removeReviewed([entry.object.uid]);
          new Eo.Notice(`${entry.object.display_id} 已采纳 AI 建议并驳回。`);
        }
      } catch (error) {
        disable(false);
        new Eo.Notice("采纳 AI 建议失败：" + (error.message || error));
      }
    };
    confirm.onclick = () => {
      try {
        disable(true);
        const object = revised();
        tools.hypotheses.confirmEvidence(tools.vault, object.uid);
        removeReviewed([object.uid]);
        new Eo.Notice(`${object.display_id} 已确认，并写入正式 ${relation.options[relation.selectedIndex].text} 关系。`);
      } catch (error) {
        disable(false);
        new Eo.Notice("确认失败：" + (error.message || error));
      }
    };
    reject.onclick = () => {
      const text = reason.value.trim();
      if (!text) {
        new Eo.Notice("驳回前请填写原因；这会成为以后不重复提议的依据。");
        reason.focus();
        return;
      }
      try {
        disable(true);
        const entry = current();
        tools.hypotheses.rejectEvidence(tools.vault, entry.object.uid, text);
        removeReviewed([entry.object.uid]);
        new Eo.Notice(`${entry.object.display_id} 已驳回；出处仍保留，且不会再进入待审队列。`);
      } catch (error) {
        disable(false);
        new Eo.Notice("驳回失败：" + (error.message || error));
      }
    };
    batchReject.onclick = () => {
      const text = reason.value.trim();
      const entries = pending.filter((entry) => batchSelected.has(entry.object.uid));
      if (!entries.length) return;
      if (!text) {
        new Eo.Notice("批量驳回前请填写一个适用于所有勾选项的具体原因。");
        reason.focus();
        return;
      }
      if (!window.confirm(`确认驳回 ${entries.length} 条候选吗？它们将保留出处和原因，但不再进入待审队列。`)) return;
      disable(true);
      const completed = [], failed = [];
      for (const entry of entries) {
        try {
          tools.hypotheses.rejectEvidence(tools.vault, entry.object.uid, text);
          completed.push(entry.object.uid);
        } catch (error) {
          failed.push(`${entry.object.display_id}：${error.message || error}`);
        }
      }
      if (completed.length) removeReviewed(completed);
      if (failed.length) {
        disable(false);
        new Eo.Notice(`已驳回 ${completed.length} 条；${failed.length} 条未完成：${failed.join("；")}`);
      } else new Eo.Notice(`已批量驳回 ${completed.length} 条候选；它们不会再次进入待审队列。`);
    };
    fill();
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

/**
 * Keep a simulated-data Evidence readable and auditable while removing it
 * from formal Research State. This action is intentionally explicit: neither
 * the plugin nor an Agent may silently downgrade a researcher-confirmed link.
 */
function schMarkCurrentEvidenceDemonstration(plugin) {
  let tools, entry, source;
  try {
    tools = schEvidenceTools(plugin);
    const active = plugin.app.workspace.getActiveFile();
    if (!active) throw new Error("请先打开 Research/Evidence/ 下的一条 Evidence");
    entry = tools.hypotheses.loadAll(tools.vault, "evidence").find((item) => item.path === active.path);
    if (!entry) throw new Error("当前笔记不是 Schema v1 的 Evidence");
    if (entry.object.source_type !== "experiment") throw new Error("只有来源为 Experiment 的 Evidence 才能标记为流程演示");
    source = tools.experiments.loadAll(tools.vault).find((item) => item.object.uid === entry.object.source_uid);
    if (!source || source.object.data_origin !== "simulated")
      throw new Error("仅当来源 Experiment 已明确声明为 simulated 时，才可标记为流程演示");
  } catch (error) {
    new Eo.Notice("无法标记流程演示：" + (error.message || error));
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal");
    modal.modalEl.setCssStyles({ width: "min(680px, 94vw)" });
    const content = modal.contentEl;
    content.createEl("h2", { text: "标记为流程演示（退出正式关系）" });
    content.createEl("p", {
      text: `${entry.object.display_id} 来源于 ${source.object.display_id}，其数据来源已声明为“模拟 / 流程演示数据”。此操作会保留引文、定位器、主张和审计记录，但会移出 Hypothesis 的正式支持/反驳关系，并从 Experiment 的 produced_evidence 移除。`,
      cls: "setting-item-description",
    });
    content.createEl("label", { text: "标记原因" });
    const reason = content.createEl("textarea", {
      attr: { rows: "4", placeholder: "例如：来源 Experiment 已声明为模拟数据；该 Evidence 仅用于流程验证/演示，不作为正式科研结论。" },
    });
    reason.value = "来源 Experiment 已声明为模拟数据；该 Evidence 仅用于流程验证/演示，不作为正式科研结论。";
    const status = content.createDiv({ cls: "setting-item-description" });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
    const apply = actions.createEl("button", { text: "确认标记为流程演示", cls: "mod-warning" });
    apply.onclick = () => {
      try {
        if (!reason.value.trim()) throw new Error("请记录原因，方便未来区分流程演示与科研结论");
        apply.disabled = true;
        tools.hypotheses.demonstrateEvidence(tools.vault, entry.object.uid, reason.value, { by: "user" });
        modal.close();
        new Eo.Notice(`${entry.object.display_id} 已标记为流程演示，并退出正式关系。`);
      } catch (error) {
        apply.disabled = false;
        status.setText("标记失败：" + (error.message || error));
      }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}


function schOpenEvidenceProposalFinder(plugin) {
  let tools, hypotheses;
  try {
    tools = schEvidenceTools(plugin);
    hypotheses = tools.hypotheses.loadAll(tools.vault, "hypothesis");
  } catch (error) {
    new Eo.Notice("无法打开证据候选检索器：" + (error.message || error));
    return;
  }
  if (!hypotheses.length) {
    new Eo.Notice("还没有 Hypothesis。请先创建假设。");
    return;
  }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    modal.modalEl.addClass("scholarium-evidence-modal");
    modal.modalEl.setCssStyles({ width: "min(960px, 94vw)" });
    const content = modal.contentEl;
    content.createEl("h2", { text: "为假设检索证据候选" });
    content.createEl("p", {
      text: "先由 LLM 生成可审计的英文词包，再从已验证 HTML 归档与具备权威 URL 的本地 PDF 锚点中确定性排序候选。它不会判断支持/反驳；创建后仍必须由你在审核器中确认或驳回。缺少权威 URL 的 PDF 不会进入 Evidence 队列。",
      cls: "setting-item-description",
    });
    content.createEl("label", { text: "目标假设" });
    const target = content.createEl("select");
    for (const entry of hypotheses)
      target.createEl("option", { value: entry.object.uid, text: `${entry.object.display_id} · ${entry.object.statement}` });
    const limitRow = content.createDiv({ cls: "setting-item" });
    limitRow.createEl("span", { text: "本次候选上限" });
    const limit = limitRow.createEl("input", { type: "number", value: "10", attr: { min: "1", max: "10", step: "1" } });
    const output = content.createDiv({ cls: "scholarium-evidence-proposal-output" });
    const status = content.createDiv({ cls: "setting-item-description" });
    const actions = content.createDiv({ cls: "scholarium-evidence-actions" });
    const search = actions.createEl("button", { text: "生成英文词包并检索" });
    const create = actions.createEl("button", { text: "创建待确认候选", cls: "mod-cta" });
    create.disabled = true;
    actions.createEl("button", { text: "关闭" }).onclick = () => modal.close();
    let result = null;
    const showPrecision = () => {
      const p = tools.proposer.aiPrecision(tools.vault);
      return p.reviewed ? `AI 候选审核：${p.confirmed} 确认 / ${p.rejected} 驳回，精确率 ${(p.precision * 100).toFixed(1)}%（样本 ${p.reviewed}）` : `AI 候选审核：尚无已审核样本（待审 ${p.pending}）`;
    };
    target.onchange = () => { result = null; create.disabled = true; output.empty(); status.setText(showPrecision()); };
    status.setText(showPrecision());
    search.onclick = async () => {
      try {
        search.disabled = true;
        const n = Math.max(1, Math.min(10, Number(limit.value) || 10));
        const hypothesis = hypotheses.find((entry) => entry.object.uid === target.value)?.object;
        if (!hypothesis) throw new Error("未找到所选 Hypothesis");
        status.setText("正在用 LLM 生成可审计的英文检索词包…");
        const expanded = await schExpandEvidenceQueryViaApi(plugin, tools, hypothesis);
        const pack = tools.expansion.saveQueryPack(tools.vault, hypothesis, expanded.parsed, { prompt: expanded.prompt, generator: expanded.generator });
        result = tools.proposer.proposeForHypothesis(tools.vault, target.value, {
          limit: n, queryPhrases: pack.object.terms, queryConceptGroups: pack.object.concept_groups, queryPackPath: pack.path,
        });
        output.empty();
        output.createEl("p", { text: `词包已保存：${pack.path}` });
        if (expanded.format_fallback)
          output.createEl("p", { text: "提示：LLM 输出未满足词包格式，已仅按假设中写明的实体/条件建立保守备用词包；可稍后重试以获得同义词扩展。" });
        output.createEl("p", { text: "英文检索短语：" + pack.object.terms.join(" · ") });
        output.createEl("p", { text: "概念组门槛：" + pack.object.concept_groups.map((group) => `${group.required ? "必需" : "可选"} ${group.label} = ${group.terms.join(" / ")}`).join("；") + "。候选须命中所有必需组，并命中至少一个可选组。" });
        if (!result.candidates.length) {
          output.createEl("p", { text: "没有新的词项重叠候选：已有证据（无论确认、待审或驳回）会按 Paper × 锚点 × 假设自动去重。" });
          create.disabled = true;
        } else {
          output.createEl("p", { text: `找到 ${result.available} 条候选，当前展示前 ${result.candidates.length} 条；创建操作仍需你明确点击。` });
          const list = output.createEl("ol");
           for (const candidate of result.candidates) {
             const item = list.createEl("li");
             const sourceLabel = candidate.source_kind === "pdf" ? "PDF" : "HTML 归档";
             item.createEl("strong", { text: `${sourceLabel} · ${candidate.paper_display_id} · ${candidate.anchor} · 必需：${(candidate.matched_required_concept_groups || []).map((group) => group.label).join(" + ") || "无"} · 可选：${(candidate.matched_optional_concept_groups || []).map((group) => group.label).join(" + ") || "无"}` });
            item.createEl("div", { text: candidate.quote.slice(0, 300) + (candidate.quote.length > 300 ? "…" : "") });
          }
          create.disabled = false;
        }
         status.setText(`${showPrecision()} · 扫描 HTML Paper ${result.scanned_papers} 篇、可定位 PDF ${result.scanned_pdf_sources || 0} 篇；跳过 ${result.skipped.length} 个无法安全定位的归档/锚点与 ${(result.skipped_pdf_sources || []).length} 份不合格 PDF sidecar。`);
      } catch (error) {
        result = null;
        create.disabled = true;
        output.empty();
        status.setText("检索失败：" + (error.message || error));
      } finally {
        search.disabled = false;
      }
    };
    create.onclick = () => {
      if (!result || !result.candidates.length) return;
      try {
        create.disabled = true;
        const made = tools.proposer.createProposals(tools.vault, target.value, {
          limit: result.candidates.length,
          queryPhrases: result.query_phrases,
          queryConceptGroups: result.query_concept_groups,
          queryPackPath: result.candidates[0]?.query_pack_path || "",
        });
        modal.close();
        new Eo.Notice(`已创建 ${made.created.length} 条 AI 候选${made.registered_pdf_papers ? `，并登记 ${made.registered_pdf_papers} 个本地 PDF Paper 来源` : ""}；请运行“证据：审核待确认的证据（确认 / 驳回）”作出科研判断。`);
      } catch (error) {
        create.disabled = false;
        new Eo.Notice("创建候选失败：" + (error.message || error));
      }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}

export function installEvidenceUi(wi) {
const schEvidenceUiOnload = wi.prototype.onload;
wi.prototype.onload = async function () {
  await schEvidenceUiOnload.call(this);
  this.addCommand({
    id: "create-research-hypothesis",
    name: "研究对象：新建假设",
    callback: () => schOpenHypothesisCreator(this),
  });
  this.addCommand({
    id: "create-research-experiment",
    name: "研究对象：新建实验",
    callback: () => schOpenExperimentCreator(this),
  });
  this.addCommand({
    id: "advance-research-experiment-state",
    name: "研究对象：更新当前实验状态",
    callback: () => schOpenExperimentTransition(this),
  });
  this.addCommand({
    id: "edit-research-experiment-data-provenance",
    name: "研究对象：编辑当前实验数据来源",
    callback: () => schOpenExperimentDataProvenanceEditor(this),
  });
  this.addCommand({
    id: "create-evidence-from-experiment-result",
    name: "证据：从当前实验结果创建证据",
    callback: () => schOpenExperimentEvidenceCreator(this),
  });
  this.addCommand({
    id: "create-evidence-from-archived-selection",
    name: "证据：打开归档阅读器并从选区创建证据",
    callback: () => schOpenEvidenceSelectionReader(this),
  });
  this.addCommand({
    id: "review-pending-evidence",
    name: "证据：审核待确认的证据（确认 / 驳回）",
    callback: () => schOpenEvidenceReviewer(this),
  });
  this.addCommand({
    id: "mark-current-evidence-demonstration",
    name: "证据：将当前模拟来源证据标记为流程演示（退出正式关系）",
    callback: () => schMarkCurrentEvidenceDemonstration(this),
  });
  this.addCommand({
    id: "find-deterministic-evidence-candidates",
    name: "证据：生成英文词包并检索候选段落",
    callback: () => schOpenEvidenceProposalFinder(this),
  });
  this.addCommand({
    id: "open-hypothesis-evidence-candidates",
    name: "为假设检索证据候选",
    callback: () => schOpenEvidenceProposalFinder(this),
  });
  this.addCommand({
    id: "sync-radar-scores-to-research",
    name: "文献雷达：同步评分与反馈到 Research 索引",
    callback: () => schOpenRadarVaultSync(this),
  });
  this.addCommand({
    id: "show-radar-feedback-benchmark",
    name: "文献雷达：查看评分校准基线",
    callback: () => schShowRadarBenchmark(this),
  });
  this.addCommand({
    id: "plot-material-library-data",
    name: "织研者：从素材库数据绘图",
    callback: () => schOpenMaterialDatasetPicker(this),
  });
};
}
