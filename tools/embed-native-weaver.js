"use strict";

/**
 * Mechanically embeds the native 织研者 page into the frozen Preview main.js
 * and styles.css, the same way tools/embed-runtime-bootstrap.js embeds the
 * runtime bootstrap: BRAT installs only main.js/manifest.json/styles.css, so
 * the page cannot ship as a separate file.
 *
 * Three generated regions, each between markers and replaced in place on every
 * run (the tool is idempotent and deterministic):
 *
 *   1. main.js, top level: the vendored page bundle
 *      (vendor/native-weaver/scholarium-weaver-native.js, built from
 *      scholarium-v2-source by tools/scholarium-host/build-embed.mjs and
 *      checked against vendor/native-weaver/SOURCE.json), then the host glue
 *      (tools/native-weaver-host.js).
 *   2. main.js, the 织研者 branch of the dashboard's render: one call that lets
 *      the native page own the tab body under Scholarium's tab row. It is
 *      placed before the iframe's early return, so switching from the old
 *      page to the native one works without a reload.
 *   3. styles.css, end of file: the page's stylesheet.
 *
 * Every anchor must appear exactly once; anything else is refused rather than
 * guessed at, so a changed main.js fails loudly instead of being half-patched.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const JS_BEGIN = "/* SCHOLARIUM_NATIVE_WEAVER_EMBED_BEGIN */";
const JS_END = "/* SCHOLARIUM_NATIVE_WEAVER_EMBED_END */";
const HOOK_BEGIN = "/* SCHOLARIUM_NATIVE_WEAVER_HOOK_BEGIN */";
const HOOK_END = "/* SCHOLARIUM_NATIVE_WEAVER_HOOK_END */";
const CSS_BEGIN = "/* SCHOLARIUM_NATIVE_WEAVER_STYLES_BEGIN */";
const CSS_END = "/* SCHOLARIUM_NATIVE_WEAVER_STYLES_END */";
/** Where the JS region goes: right after the runtime bootstrap region. */
const BOOTSTRAP_END = "/* SCHOLARIUM_RUNTIME_BOOTSTRAP_EMBED_END */";
/** The iframe branch's early return in the dashboard render. */
const HOOK_ANCHOR = "      if (this.__weaverFrame && this.__weaverFrame.isConnected) return;\n";
const HOOK_LINE =
  "      if (schNativeWeaverHost.render(this, weaverHost, { vaultPorts, ensure, serviceUrl })) return;\n";
// esbuild removes ordinary marker comments from the TypeScript development
// build but retains this call. Remove that source copy before installing the
// reviewed generated hook, otherwise a release would mount the native page twice.
const SOURCE_HOOK_LINE =
  "        if (schNativeWeaverHost.render(this, weaverHost, { vaultPorts, ensure, serviceUrl })) return;\n";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function countOf(text, needle) {
  let count = 0;
  let index = -1;
  while ((index = text.indexOf(needle, index + 1)) >= 0) count += 1;
  return count;
}

/** Remove a previously generated region (markers included), or return the
 * text unchanged when it has none. A half region is refused. */
function withoutRegion(text, begin, end, label) {
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  if ((start >= 0) !== (finish >= 0) || (start >= 0 && finish < start)) {
    throw new Error(`${label} 标记不完整，拒绝覆盖`);
  }
  if (countOf(text, begin) > 1 || countOf(text, end) > 1) throw new Error(`${label} 标记重复，拒绝覆盖`);
  if (start < 0) return { text, at: -1 };
  // The marker line's own indentation belongs to the region too; leaving it
  // would add whitespace on every run.
  let head = start;
  while (head > 0 && (text[head - 1] === " " || text[head - 1] === "\t")) head -= 1;
  let tail = finish + end.length;
  if (text[tail] === "\n") tail += 1;
  return { text: text.slice(0, head) + text.slice(tail), at: head };
}

function readVendor(root) {
  const vendor = path.join(root, "vendor", "native-weaver");
  const source = JSON.parse(fs.readFileSync(path.join(vendor, "SOURCE.json"), "utf8"));
  const files = {};
  for (const name of ["scholarium-weaver-native.js", "scholarium-weaver-native.css"]) {
    const bytes = fs.readFileSync(path.join(vendor, name));
    const expected = source.files && source.files[name] && source.files[name].sha256;
    if (expected !== sha256(bytes)) throw new Error(`vendor/native-weaver/${name} 与 SOURCE.json 记录的 SHA-256 不一致，拒绝嵌入`);
    files[name] = bytes.toString("utf8");
  }
  return { source, bundle: files["scholarium-weaver-native.js"], styles: files["scholarium-weaver-native.css"] };
}

function applyPlotToolPatches(page) {
  // The vendored bytes and SOURCE.json remain pinned. These reviewed patches
  // bridge its existing plot/plotRevision ledger kinds to the unified runtime.
  const replacements = [
    [
      '- 研究员指定了数据文件和要画的列之后，输出一个',
      '- 原始 CSV/TSV/TXT/DAT 含中文表头时，字段画像和绘图器会按 UTF-8、GB18030、GBK 严格解码；GBK/GB18030 编码本身不是 normalize 的理由。研究员已给出实际中文列名并要求直接绘图时，必须直接提交 scholarium-plot，不得先输出 scholarium-normalize，也不得把 UTF-8 副本说成唯一出路。只有 XLSX 或确有结构化转换需求时才先规范化；任何情况下源文件只读。\n- 研究员指定了数据文件和要画的列之后，输出一个',
      "中文编码绘图提示词",
    ],
    [
      '    "scholarium-plot",\n    "scholarium-plot-revise",',
      '    "scholarium-plot",\n    "scholarium-plot-revise",\n    "scholarium-plot-tool",',
      "绘图协议名称",
    ],
    [
      '      if (message.role !== "agent") continue;\n      const actions2 = parseActionRequests(message.text);',
      '      if (message.role !== "agent") continue;\n      const plotProtocols = schNativeWeaverPlotTools.parse(message.text);\n      for (const request of plotProtocols.requests) {\n        const cardId = `${message.messageId}#${request.kind === "plot" ? "plot0" : "plotRevision0"}`;\n        cards.push(cardFor(message, request.kind, cardId, ledger, { reason: request.reason, plot: request }));\n      }\n      const actions2 = parseActionRequests(message.text);',
      "绘图确认卡生成",
    ],
    [
      '      ...request.figure === void 0 ? {} : { figure: request.figure }',
      '      ...request.figure === void 0 ? {} : { figure: request.figure },\n      ...request.plot === void 0 ? {} : { plot: request.plot }',
      "绘图卡载荷",
    ],
    [
      '    const figures = parseFigureRequests(patches.text);\n    return {\n      text: figures.text,',
      '    const figures = parseFigureRequests(patches.text);\n    const plotProtocols = schNativeWeaverPlotTools.parse(figures.text);\n    return {\n      text: plotProtocols.text,',
      "绘图围栏正文清理",
    ],
    [
      '    if (!canTransitionConfirmation(from, event.state)) {\n      reject2(`a confirmation cannot go ${from} → ${event.state}`);',
      '    const plotRetry = from === "failed" && event.state === "claimed" && (event.kind === "plot" || event.kind === "plotRevision");\n    if (!plotRetry && !canTransitionConfirmation(from, event.state)) {\n      reject2(`a confirmation cannot go ${from} → ${event.state}`);',
      "绘图失败手动重试状态迁移",
    ],
    [
      '      const state = this.stateOf(messageId, kind);\n      if (!isDispatchableConfirmation(state)) {\n        return { ok: false, error: undispatchableReason(state) };',
      '      const state = this.stateOf(messageId, kind);\n      const plotRetry = state === "failed" && (kind === "plot" || kind === "plotRevision");\n      if (!isDispatchableConfirmation(state) && !plotRetry) {\n        return { ok: false, error: undispatchableReason(state) };',
      "绘图失败手动重试认领",
    ],
    [
      '    canExecuteCard(card) {\n      if (!this.cardRunnable(card)) return false;',
      '    canExecuteCard(card) {\n      if (card.kind === "plot" || card.kind === "plotRevision") return this.deps.plotTools?.canExecute(this, card) === true;\n      if (!this.cardRunnable(card)) return false;',
      "绘图执行开关",
    ],
    [
      '    async onConfirm(card) {\n      if (card.kind === "patch") {',
      '    async onConfirm(card) {\n      if (card.kind === "plot" || card.kind === "plotRevision") {\n        await this.deps.plotTools?.confirm(this, card);\n        return;\n      }\n      if (card.kind === "patch") {',
      "绘图确认分发",
    ],
    [
      '    renderCard(card) {\n      if (card.kind === "patch") return this.renderPatchCard(card);',
      '    renderCard(card) {\n      if (card.kind === "plot" || card.kind === "plotRevision") return this.deps.plotTools.renderCard(this, card);\n      if (card.kind === "patch") return this.renderPatchCard(card);',
      "绘图确认卡渲染",
    ],
    [
      '        ...base,\n        title: "织研者",',
      '        ...base,\n        title: "织研者",\n        ...host.plotTools ? { plotTools: host.plotTools } : {},\n        ...host.executePlotTool ? { executePlotTool: host.executePlotTool } : {},',
      "绘图宿主依赖",
    ],
  ];
  let patched = page;
  for (const [anchor, replacement, label] of replacements) {
    if (countOf(patched, anchor) !== 1) throw new Error(`原生${label}锚点不是恰好一处，拒绝构建`);
    patched = patched.replace(anchor, () => replacement);
  }
  return patched;
}

/** Keep Agent dispatch independent from non-critical DOM repainting. The chat
 * turn is already persisted before these methods run: a broken historical card
 * must be visible as an error, never become a silent dropped Agent turn. */
function applyChatRuntimePatches(page, recoveryOnly = false) {
  const replacements = [
    [
      '      "想继续时，直接补充说明后重新发送即可。"',
      '      "发送“继续”可尝试恢复已保存的 Agent 会话；恢复后会先检查已有进展。"',
      "停止后的恢复说明",
    ],
    [
      '      const text8 = turn.message.text;\n      report({ phase: "context", steps: ["正在读取课题资料、长期记忆与文献库…"] });',
      '      const text8 = turn.message.text;\n      const previousTask = [...(turn.history ?? [])].reverse().find((message) => message.taskId);\n      if (/^\\s*继续[。.!！]?\\s*$/.test(text8) && previousTask && previousTask.role !== "agent") {\n        report({ phase: "dispatched", steps: ["正在查找上次任务，避免重复派发…"] });\n        const resumed = await this.bridge.request(`${TASK_PATH}/${encodeURIComponent(previousTask.taskId)}/resume`, { method: "POST", body: {} });\n        if (!resumed.ok) return errorReply(`无法恢复上次任务：${resumed.error}`, previousTask.taskId);\n        const taskId = String(resumed.data?.id ?? "");\n        if (!taskId) return errorReply("运行时没有返回恢复后的任务编号。", previousTask.taskId);\n        turnState.taskId = taskId;\n        if (turnState.cancelled) { await this.bridge.request(`${TASK_PATH}/${encodeURIComponent(taskId)}/cancel`, { method: "POST" }); return stoppedReply([], taskId); }\n        report({ phase: "running", steps: [resumed.data?.reattached ? "已接回原任务，等待进展…" : "已恢复 Agent 会话，正在检查已有进展…"], taskId });\n        return this.awaitTask(taskId, agentId, (steps) => report({ phase: "running", steps, taskId }), () => turnState.cancelled);\n      }\n      report({ phase: "context", steps: ["正在读取课题资料、长期记忆与文献库…"] });',
      "继续上次任务",
    ],
    [
      '        if (status2 === "cancelled") return stoppedReply(lastSteps, taskId);',
      '        if (status2 === "interrupted") return errorReply("运行时已重启，原任务中断。发送“继续”可尝试恢复已保存的 Agent 会话。", taskId);\n        if (status2 === "cancelled") return stoppedReply(lastSteps, taskId);',
      "运行时重启状态",
    ],
    [
      '      for (let attempt = 0; attempt < polls; attempt += 1) {\n        if (attempt > 0 && pollInterval > 0) await this.wait(pollInterval);',
      '      for (let attempt = 0; this.host.maxPolls == null || attempt < polls; attempt += 1) {\n        if (attempt > 0 && pollInterval > 0) await this.wait(pollInterval);\n        if (attempt === polls && onSteps) onSteps([...lastSteps, "任务仍在运行，继续等待；本机运行时连接正常不代表模型 API 已响应。"]);',
      "长任务持续等待",
    ],
    [
      '        if (!result.ok) return errorReply(`无法读取任务 ${taskId}：${result.error}`, taskId);',
      '        if (!result.ok) return errorReply(`暂时无法读取任务 ${taskId}：${result.error}。这不能说明任务已停止；请先检查运行时状态，避免重复派发。`, taskId);',
      "任务读取失败说明",
    ],
    [
      '      const previousTask = [...(turn.history ?? [])].reverse().find((message) => message.taskId);',
      '      let previousTask = [...(turn.history ?? [])].reverse().find((message) => message.taskId);\n      if (/^\\s*继续[。.!！]?\\s*$/.test(text8) && (!previousTask || previousTask.role !== "agent")) {\n        const latest = await this.bridge.request(`/v1/chat-tasks/latest?conversationId=${encodeURIComponent(turn.sessionId)}`);\n        if (latest.ok && latest.data?.id) previousTask = { taskId: latest.data.id, role: "system" };\n        else if (!latest.ok && latest.status !== 404) return errorReply(`无法查询上次任务：${latest.error}`);\n      }',
      "查找未完成的任务",
    ],
    [
      '          body: { agentId, cwd, prompt: body, permission: "read", execute: true }',
      '          body: { agentId, cwd, prompt: body, conversationId: turn.sessionId, permission: "read", execute: true }',
      "记录任务所属会话",
    ],
    [
      '    /* ---------------------------------------------------------- rendering -- */\n    renderAll() {',
      '    /* ---------------------------------------------------------- rendering -- */\n    tryTurnRender(stage, draw) {\n      try {\n        draw();\n      } catch (error) {\n        const failure = messageOf4(error);\n        console.error(`[Scholarium] ${stage}`, error);\n        const message = `界面刷新失败（${stage}）：${failure}。对话已保存，Agent 调用不会因界面错误中断。`;\n        try {\n          this.showNotice(message);\n        } catch (noticeError) {\n          console.error(`[Scholarium] ${stage}错误提示也无法绘制`, noticeError);\n          if (this.composerHintEl) this.composerHintEl.textContent = message;\n        }\n      }\n    }\n    renderAll() {',
      "对话安全重绘助手",
    ],
    [
      '        if (this.session === targetSession) {\n          this.renderAll();\n          this.scrollToBottom();\n        }\n        if (!decision.dispatched) return;\n      } finally {',
      '        if (this.session === targetSession) {\n          this.tryTurnRender("发送后的对话", () => {\n            this.renderAll();\n            this.scrollToBottom();\n          });\n        }\n        if (!decision.dispatched) return;\n      } finally {',
      "发送后重绘隔离",
    ],
    [
      '      if (this.session === targetSession) {\n        this.renderMessages();\n        this.scrollToBottom();\n        this.renderStatus();\n      }\n    }\n    updateThinking(',
      '      if (this.session === targetSession) {\n        this.tryTurnRender("运行状态", () => {\n          this.renderMessages();\n          this.scrollToBottom();\n          this.renderStatus();\n        });\n      }\n    }\n    updateThinking(',
      "运行状态重绘隔离",
    ],
    [
      '      if (this.session === targetSession) {\n        this.thinkingEl?.remove();\n        this.thinkingEl = null;\n        this.thinkingBodyEl = null;\n        this.renderStatus();\n      }\n    }',
      '      if (this.session === targetSession) {\n        this.tryTurnRender("结束运行状态", () => {\n          this.thinkingEl?.remove();\n          this.thinkingEl = null;\n          this.thinkingBodyEl = null;\n          this.renderStatus();\n        });\n      }\n    }',
      "结束状态重绘隔离",
    ],
    [
      '      if (this.session === targetSession) {\n        this.syncWindow();\n        this.renderAll();\n        this.scrollToBottom();\n      } else {\n        this.renderSessions();\n        this.renderSideTabs();\n      }\n    }\n    currentSessionId() {',
      '      if (this.session === targetSession) {\n        this.tryTurnRender("回复后的对话", () => {\n          this.syncWindow();\n          this.renderAll();\n          this.scrollToBottom();\n        });\n      } else {\n        this.renderSessions();\n        this.renderSideTabs();\n      }\n    }\n    currentSessionId() {',
      "回复后重绘隔离",
    ],
  ];
  let patched = page;
  for (const [anchor, replacement, label] of (recoveryOnly ? replacements.slice(0, 7) : replacements)) {
    if (countOf(patched, anchor) !== 1) throw new Error(`原生${label}锚点不是恰好一处，拒绝构建`);
    patched = patched.replace(anchor, () => replacement);
  }
  return patched;
}

function buildJsBlock({ source, bundle }, glue, plot = {}) {
  let page = bundle.replace(/^﻿/, "").replace(/^"use strict";\s*/, "").trimEnd();
  if (!/^var ScholariumNativeWeaver = \(\(\) => \{/.test(page)) throw new Error("vendor bundle 不是预期的 ScholariumNativeWeaver IIFE");
  // The upstream native page is pinned independently. Add the host's literature
  // contract at its single prompt anchor without altering the vendored bytes.
  const anchor = "12. 研究员要求把具体安排”写入工作台”";
  if (countOf(page, anchor) !== 1) throw new Error("织研者文献总结提示词锚点变化，拒绝构建");
  const matrixInstruction = "11a. 研究员要求保存或更新文献总结时，在同一个总结 Markdown 文件的 YAML frontmatter 中填写 type: literature-summary、title、doi、fulltext_path 和 matrix_fields。matrix_fields 必须包含“领域基础知识”“研究背景”“作者的问题意识”“研究意义”“研究结论”“对领域的贡献”“未来研究方向提及”“未来研究方向思考”八个键，值为基于文献的简明字符串；缺乏依据时写“原文未说明”，个人推测须明确标注。各列分别填写概念原理、已有研究及缺口、论文具体问题、研究价值、实际结论与证据、对领域的具体贡献、作者提出的未来工作、标注为推测的个人延伸；禁止把同一段复制到多列，缺少依据时如实说明。总结正文须是详细的科研精读笔记，包含总体深度解读、研究目标、方法、实验和关键结果、研究意义、局限与批判性分析以及学习启发与未来方向；七个矩阵字段只是 metadata，不能替代总结正文。不得把这些 metadata 另存为独立文档；若通过 literature.matrix_write_summary 提交，则使用该工具生成的同一总结笔记。不得伪造原文未核实的信息。\n";
  const researchWorkflow = "11b. 用户要求广泛检索或建立综述文献池时：拆解主题、同义词和缩写，提供平衡、高召回和高精确三种适配目标数据库的检索式；数据库不可访问时说明需要用户导入结果，不得声称已查询。保留标题、作者、年份、DOI、摘要及来源，标记缺失，按相关性和阅读优先级筛选，并记录纳入排除理由。\n11c. 用户要求基于给定文献池撰写综述时：先检查选题和 Excel/文献记录的字段覆盖、缺失与可追溯性；若 literature-review-workflow 的只读检查工具可用，按文件路径调用并分批读取，不可用时明确提示。分阶段进行定位、大纲、证据矩阵、图表计划、引言、逐章正文、挑战展望及一致性检查。仅依据提供的材料，不编造文献；区分摘要和全文证据，优先 P0/P1 文献，主体以代表文献、比较批判、综合归纳约 40/40/20 为指导，引用须可追溯。每阶段提供可审阅成果，并按用户要求迭代。\n";
  page = applyChatRuntimePatches(applyPlotToolPatches(page.replace(anchor, matrixInstruction + researchWorkflow + anchor)));
  const host = glue.replace(/^﻿/, "").trimEnd();
  // Mask CommonJS inside the contract UMD: main.js is itself a CommonJS bundle,
  // so allowing the embedded contract to assign module.exports would replace the
  // Obsidian plugin's exports. The browser global is the intended interface.
  const contract = plot.contract ? `(function (module) {\n${String(plot.contract).trimEnd()}\n})(undefined);\n` : "";
  const tools = plot.tools ? `${String(plot.tools).trimEnd()}\n` : "";
  return `${JS_BEGIN}\n` +
    `/* page: scholarium-v2-source@${source.commit}${source.uncommittedSourceChanges ? "+uncommitted" : ""} ` +
    `sha256=${sha256(bundle)}; host: tools/native-weaver-host.js sha256=${sha256(glue)}; ` +
    `literature-prompt-patch=1; plot-tool-patch=1; chat-dispatch-patch=1; generated by tools/embed-native-weaver.js */\n` +
    `${contract}${tools}${page}\n${host}\n${JS_END}\n`;
}

function embed({ root }) {
  const mainPath = path.join(root, "main.js");
  const stylesPath = path.join(root, "styles.css");
  const vendor = readVendor(root);
  const glue = fs.readFileSync(path.join(root, "tools", "native-weaver-host.js"), "utf8");
  const plot = {
    contract: fs.readFileSync(path.join(root, "agent-canvas-demo", "plot-tool-contract.js"), "utf8"),
    tools: fs.readFileSync(path.join(root, "tools", "native-weaver-plot-tools.js"), "utf8"),
    styles: fs.readFileSync(path.join(root, "tools", "native-weaver-plot-tools.css"), "utf8"),
  };

  // main.js: drop the old regions, then insert fresh ones.
  let main = fs.readFileSync(mainPath, "utf8");
  main = withoutRegion(main, JS_BEGIN, JS_END, "main.js 原生织研者代码").text;
  const hookRemoved = withoutRegion(main, HOOK_BEGIN, HOOK_END, "main.js 原生织研者挂载点");
  main = hookRemoved.text;
  const hadGeneratedHook = hookRemoved.at >= 0;
  if (countOf(main, HOOK_ANCHOR) !== 1) throw new Error("main.js 中织研者 iframe 分支的锚点不是恰好一处，拒绝插入");
  const sourceHookCount = countOf(main, SOURCE_HOOK_LINE);
  // A fresh esbuild bundle has one source call and no generated hook. An already
  // embedded release has the reverse. Both are valid inputs; having neither or
  // both would make a second mount or a guessed insertion point possible.
  if (sourceHookCount !== (hadGeneratedHook ? 0 : 1)) {
    throw new Error("main.js 中源码与生成织研者挂载调用必须恰好保留一种，拒绝插入");
  }
  if (!hadGeneratedHook) main = main.replace(SOURCE_HOOK_LINE, "");

  if (countOf(main, BOOTSTRAP_END) !== 1) throw new Error("main.js 中 runtime bootstrap 结束标记不是恰好一处，拒绝插入");
  const afterBootstrap = main.indexOf(BOOTSTRAP_END) + BOOTSTRAP_END.length;
  main = `${main.slice(0, afterBootstrap)}\n${buildJsBlock(vendor, glue, plot)}${main.slice(afterBootstrap).replace(/^\n/, "")}`;

  if (countOf(main, HOOK_ANCHOR) !== 1) throw new Error("main.js 中织研者 iframe 分支的锚点不是恰好一处，拒绝插入");
  const hookAt = main.indexOf(HOOK_ANCHOR);
  const hookLineStart = main.lastIndexOf("\n", hookAt) + 1;
  if (main.slice(hookLineStart, hookAt).trim()) throw new Error("main.js 中织研者挂载锚点前存在非空白代码，拒绝插入");
  // Insert at the physical line start. The source branch is indented by eight
  // spaces while HOOK_ANCHOR contains six; anchoring inside that indentation
  // would leave two spaces before the generated marker on the first run only.
  main = `${main.slice(0, hookLineStart)}      ${HOOK_BEGIN}\n${HOOK_LINE}      ${HOOK_END}\n${main.slice(hookAt)}`;
  fs.writeFileSync(mainPath, main, "utf8");
  // Manual capture is implemented in src/rss-feed-board.ts. The release build
  // must not reapply the historical patch aimed at the old minified bundle.
  // No measured/fixed-position shell: position:fixed inside an Obsidian leaf is
  // offset by any transformed ancestor (the page landed ~80px down/right and
  // ran off the right edge). The real cause of the short page was the native
  // grid placing its workspace in an auto row; that is fixed in its CSS.
  main = fs.readFileSync(mainPath, "utf8");

  // styles.css: the pinned page stylesheet plus the reviewed plot-card extension.
  let styles = fs.readFileSync(stylesPath, "utf8");
  styles = withoutRegion(styles, CSS_BEGIN, CSS_END, "styles.css 原生织研者样式").text.replace(/\s+$/, "");
  styles = `${styles}\n\n${CSS_BEGIN}\n/* scholarium-v2-source@${vendor.source.commit}; plot-tool-patch=1; generated by tools/embed-native-weaver.js */\n${vendor.styles.trimEnd()}\n${plot.styles.trimEnd()}\n${CSS_END}\n`;
  // The release is pinned to LF by .gitattributes. Normalize both inherited
  // source CSS and vendored CSS so a Windows autocrlf checkout is byte-identical.
  styles = styles.replace(/\r\n?/g, "\n");
  fs.writeFileSync(stylesPath, styles, "utf8");

  return {
    pageCommit: vendor.source.commit,
    uncommittedSource: Boolean(vendor.source.uncommittedSourceChanges),
    mainSha256: sha256(main),
    stylesSha256: sha256(styles),
    mainBytes: Buffer.byteLength(main),
    stylesBytes: Buffer.byteLength(styles),
  };
}

if (require.main === module) {
  const result = embed({ root: path.resolve(__dirname, "..") });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

module.exports = { JS_BEGIN, JS_END, HOOK_BEGIN, HOOK_END, CSS_BEGIN, CSS_END, HOOK_ANCHOR, embed, buildJsBlock, applyPlotToolPatches, applyChatRuntimePatches, withoutRegion, sha256 };
