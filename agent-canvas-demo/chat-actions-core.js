"use strict";
/* chat-actions-core.js — 织研者对话里 Scholarium 修改请求的纯函数核心
 * （浏览器与 Node 双端可用）。
 *
 * 织研者在只读车道里无法直接写 Scholarium；它能做的是在回复里输出
 * ```scholarium-action 块来「请求」修改。本文件负责其中可单测的一步：
 *
 *   parseActionRequests  从回复文本中剥离并校验动作块
 *
 * 规则（与 shell-ui.js 的注释一致）：
 * - 合法块（JSON 可解析、action 是含点的字符串、input 是非空对象）从正文剥离，
 *   由面板渲染成确认卡片，用户点「确认执行」后才投递队列——模型永远够不到
 *   写路径本身，这和 action-registry 的 requires_confirmation 是同一道闸。
 * - 格式错的块不静默吞掉：原样留在正文里，让用户看到模型试图做什么但写错了。
 *
 * 浏览器：window.weaverChatActionsCore；Node：module.exports。
 */

function actionInput(parsed) {
  // 规范键始终是 input；兼容常见 LLM 输出别名，避免一份内容完整的
  // 请求仅因键名漂移被渲染成空载荷确认卡。空对象没有可确认的修改意图，
  // 留在正文中比生成一个必然被预检拒绝的卡片更诚实。
  for (const key of ["input", "params", "arguments", "payload"]) {
    const value = parsed?.[key];
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0) return value;
  }
  return null;
}

function protocolAttemptCount(text, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Count a one- or two-backtick protocol-looking line as an *attempt* too.
  // The parsers below still accept only proper Markdown fences (three or more
  // backticks), but counting the malformed attempt makes the P0 safety alert
  // visible instead of silently treating `` `scholarium-draft`` as prose.
  // The trailing guard excludes a hyphen as well as word characters: `\b` alone
  // matches between "scholarium-plot" and "-revise", so every revise block would
  // also be counted as a failed plot attempt and the audit log would show
  // rejections that never happened.
  const matches = String(text || "").match(new RegExp("(?:^|\\r?\\n)`{1,}[ \\t]*" + escaped + "(?![\\w-])", "g"));
  return matches ? matches.length : 0;
}

function protocolStats(attempted, parsed) {
  return { attempted, parsed, rejected: Math.max(0, attempted - parsed) };
}

// A malformed protocol block must never turn the transcript into a giant JSON
// dump.  The executable parsers stay strict (three-or-more backticks only),
// but after they have had their chance the UI can replace one-/two-backtick
// attempts with a small non-executable render card.  This is presentation, not
// recovery: it neither parses a request into an action nor creates a write
// path.  The original attempt remains counted in the audit as rejected.
const SCHOLARIUM_PROTOCOL_NAMES = new Set([
  "scholarium-action", "scholarium-draft", "scholarium-run",
  "scholarium-note-edit", "scholarium-normalize",
  "scholarium-plot", "scholarium-plot-revise",
  "scholarium-suggest-reconstruction",
]);

function malformedProtocolSummary(protocol, payload) {
  let parsed = null;
  const source = String(payload || "");
  try { parsed = JSON.parse(source.trim()); } catch { /* no unsafe recovery */ }
  // A legacy transcript can retain only the JSON body after an earlier
  // renderer consumed or mangled its fence.  Extract just the bounded target
  // label for display; never turn this fallback into an executable request.
  const rawPath = parsed?.path || source.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] || "";
  let decodedPath = String(rawPath);
  try { decodedPath = JSON.parse(`"${decodedPath}"`); } catch { /* plain text is still safe to label */ }
  const path = String(decodedPath).replace(/\\/g, "/").slice(0, 300);
  const operation = String(parsed?.action || parsed?.operation || "").slice(0, 120);
  const target = path || operation || "未能读取目标";
  const guidance = protocol === "scholarium-draft" && /^Experiments\//i.test(path)
    ? "这是既有笔记；它不能用新建草稿协议覆盖。请重新生成可确认的笔记修改请求。"
    : "协议围栏必须使用三个反引号；请重新生成请求。";
  return { protocol, target, guidance };
}

function concealMalformedProtocolBlocks(text) {
  const source = String(text || "");
  const failures = [];
  const opener = /(^|\r?\n)(`{1,2})[ \t]*(scholarium-[a-z-]+)[ \t]*\r?\n/g;
  let cursor = 0;
  let output = "";
  let match;
  while ((match = opener.exec(source))) {
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
  // Last-resort display-only recovery for a historical orphaned draft body:
  // {"path":"…md","content":"…"}.  Do not leave it as a giant escaped
  // JSON block merely because no opening fence survived in localStorage.
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

// A prose success claim is not proof of a write. Keep this deliberately narrow:
// it is only a UI safety signal, and nearby negation ("未保存"/"不得声称已保存")
// must not trigger a false alarm.
function detectWriteClaim(text) {
  const source = String(text || "");
  const pattern = /(?:已|已经|成功)(?:为你|帮你)?(?:添加|保存|写入|创建|更新|记录|排入|安排)|(?:添加|保存|写入|创建|更新|记录|排入|安排)(?:成功|完成|好了)|已(?:重新)?提交(?:了)?(?:修改|写入|保存)?请求/g;
  let match;
  while ((match = pattern.exec(source))) {
    const prefix = source.slice(Math.max(0, match.index - 10), match.index);
    if (!/(?:未|没有|并未|尚未|不能|不可|不得|不会|等待|待你|待确认)[^，。；：\n]{0,5}$/.test(prefix)) return match[0];
  }
  return "";
}

function parseActionRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-action");
  const actions = [];
  const cleaned = source.replace(/```scholarium-action\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const input = actionInput(parsed);
      if (parsed && typeof parsed.action === "string" && parsed.action.includes(".") && input) {
        actions.push({
          action: parsed.action,
          input,
          reason: String(parsed.reason || "").slice(0, 300),
        });
        return ""; // 合法块从正文剥离，渲染成卡片
      }
    } catch { /* fall through: keep the malformed block visible */ }
    return match;
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), actions, stats: protocolStats(attempted, actions.length) };
}

/* parseRunRequests —— ```scholarium-run``` 对话运行请求。
 *
 * 这不是一个“模型可直接执行”的后门。模型只描述它希望面板做什么；shell-ui
 * 把合法块剥离成一张可审计确认卡，研究员点击后才调用浏览器侧既有入口。
 * operation 刻意保持很窄：完整 Pipeline、仅文献检索、把明确的论文清单加入
 * 人工下载队列、从历史运行的指定步骤重新运行。任何未知 operation、空主题或
 * 缺失步骤都原样留在正文中。 */
const RUN_OPERATIONS = new Set(["pipeline.run", "literature.search", "literature.queue", "pipeline.rerun"]);

function parseRunRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-run");
  const runs = [];
  const cleaned = source.replace(/```scholarium-run\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const operation = String(parsed?.operation || "").trim();
      if (!RUN_OPERATIONS.has(operation)) return match;
      const topic = String(parsed?.topic || parsed?.query || "").trim().slice(0, 4000);
      const reason = String(parsed?.reason || "").trim().slice(0, 300);
      if ((operation === "pipeline.run" || operation === "literature.search") && !topic) return match;
      if (operation === "literature.queue") {
        const rawItems = Array.isArray(parsed?.items) ? parsed.items.slice(0, 100) : [];
        const items = rawItems.map((item) => {
          const doi = String(item?.doi || "").trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").slice(0, 240);
          const title = String(item?.title || "").trim().slice(0, 500);
          const url = String(item?.url || (doi ? `https://doi.org/${doi}` : "")).trim().slice(0, 2000);
          return {
            doi, title: title || doi || "待下载论文", url,
            reason: String(item?.reason || item?.priority || "织研者筛选后加入").trim().slice(0, 300),
          };
        }).filter((item) => item.doi && /^10\.\d{4,9}\/[\S]+$/i.test(item.doi) && /^https?:\/\/\S+$/i.test(item.url));
        if (!items.length) return match;
        runs.push({ operation, items, open: parsed?.open !== false, reason });
        return "";
      }
      if (operation === "pipeline.rerun") {
        const fromStep = String(parsed?.from_step || "").trim();
        const runId = String(parsed?.run_id || "latest").trim();
        if (!fromStep || !/^[a-z0-9-]+$/i.test(fromStep)) return match;
        if (!runId || (runId !== "latest" && !/^[a-zA-Z0-9._-]+$/.test(runId))) return match;
        const topicOverride = String(parsed?.topic || "").trim().slice(0, 4000);
        const queryOverride = String(parsed?.query || "").trim().slice(0, 8000);
        runs.push({
          operation, run_id: runId.slice(0, 160), from_step: fromStep.slice(0, 80), reason,
          ...(topicOverride ? { topic: topicOverride } : {}),
          ...(queryOverride ? { query: queryOverride } : {}),
        });
      } else {
        runs.push({ operation, topic, reason });
      }
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), runs, stats: protocolStats(attempted, runs.length) };
}

/* parseDraftRequests —— ```scholarium-draft 块：模型请求"新建一份 Markdown 记录"
 * （EXP/HYP/文献笔记等），落盘走 /v1/drafts/batch 的预防式两段提交（设计文档 §7：
 * 知识管理新建不走 full 车道）。
 *
 * 块内容为 JSON，两种形态都接受：
 *   { "path": "records/EXP-006.md", "content": "---\n..." }      —— 单文件
 *   { "items": [ { "path": ..., "content": ... }, ... ] }        —— 批量（如 EXP+HYP 关联对）
 * 校验规则与 /v1/drafts/batch 服务端一致：相对 .md 路径、不含 ../、内容非空。
 * 合法块剥离正文；格式错的块原样保留，让用户看到模型试图保存什么但写错了。 */
function isValidDraftPath(value) {
  const p = String(value || "").replace(/\\/g, "/");
  return Boolean(p) && !p.startsWith("/") && !/^[A-Za-z]:/.test(p) && !p.includes("../") && p.toLowerCase().endsWith(".md");
}

function parseDraftRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-draft");
  const drafts = [];
  // Markdown permits whitespace between a fence and its info string and allows
  // fences longer than three backticks.  Agents occasionally use either form;
  // accepting them here prevents a valid draft from being left as inert text
  // with no confirmation card.
  const cleaned = source.replace(/(`{3,})[ \t]*scholarium-draft[ \t]*\r?\n([\s\S]*?)\1/g, (match, fence, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : (parsed?.path ? [parsed] : null);
      if (!rawItems) return match;
      const items = rawItems.map((item) => ({
        path: String(item?.path || "").replace(/\\/g, "/").slice(0, 300),
        content: String(item?.content || "").slice(0, 200000),
        ...(item?.ref ? { ref: String(item.ref).trim().slice(0, 80) } : {}),
      }));
      const allValid = items.length > 0 && items.every((item) => isValidDraftPath(item.path) && item.content.trim());
      if (!allValid) return match; // 路径/内容不合法：留给服务端兜底，同时让用户看到原块
        drafts.push({
          items,
          reason: String(parsed.reason || "").slice(0, 300),
          openAfterCommit: parsed.open_after_commit === true,
        });
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), drafts, stats: protocolStats(attempted, drafts.length) };
}

/* parseLegacyNoteEditRequests —— ```scholarium-note-edit 块：修改已经存在的
 * 人工 legacy Markdown 笔记。它不是 scholarium-draft 的“覆盖版”：只允许
 * Experiments/ 下的 .md，并且 UI 点击确认后仍须经 Bridge preview -> hash
 * checked commit。Research/ schema-v1 对象不能通过这条路绕过权威端点。 */
function parseLegacyNoteEditRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-note-edit");
  const edits = [];
  const cleaned = source.replace(/(`{3,})[ \t]*scholarium-note-edit[ \t]*\r?\n([\s\S]*?)\1/g, (match, fence, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const path = String(parsed?.path || "").replace(/\\/g, "/").slice(0, 300);
      const content = String(parsed?.content || "").slice(0, 200000);
      const reason = String(parsed?.reason || "").trim().slice(0, 600);
      const changes = (Array.isArray(parsed?.changes) ? parsed.changes : []).slice(0, 30).map((change) => ({
        location: String(change?.location || "").trim().slice(0, 240),
        before: String(change?.before || "").trim().slice(0, 600),
        after: String(change?.after || "").trim().slice(0, 600),
      })).filter((change) => change.location && change.before && change.after);
      // A deliberately narrow legacy surface. New files still use
      // scholarium-draft; schema-v1 Research objects use their own endpoints.
      // A legacy replacement is reviewable only when it carries at least one
      // concrete before/after row. Without that, the UI would show a confirm
      // button but no "judgement table" for the researcher to inspect.
      if (!/^Experiments\/.+\.md$/i.test(path) || !isValidDraftPath(path) || !content.trim() || !reason || !changes.length) return match;
      edits.push({ path, content, reason, changes });
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), edits, stats: protocolStats(attempted, edits.length) };
}

/* parseSuggestReconstructionRequests —— ```scholarium-suggest-reconstruction```
 * 围栏块：比 scholarium-action（L1 白名单动作）和 scholarium-draft（新建草稿）
 * 都更弱的一类——模型只能表达"建议从这个种子 DOI 开始做一次证据重建"的意图，
 * 内容只有 { seed_doi, reason }，不带任何可执行载荷。渲染成的卡片只有一个
 * "打开重建面板"按钮，点击后跳转到项目面板的种子重建弹窗并预填 DOI；全程不
 * 发起任何网络请求或写入——真正的候选发现/审计/下载/准入都在弹窗里，受各自
 * 已有的权限车道约束（研究只读 / fetch_and_attach_pdf / drafts/batch）。 */
function parseSuggestReconstructionRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-suggest-reconstruction");
  const suggestions = [];
  const cleaned = source.replace(/```scholarium-suggest-reconstruction\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const seedDoi = String(parsed?.seed_doi || "").trim();
      if (!seedDoi) return match;
      suggestions.push({ seed_doi: seedDoi.slice(0, 200), reason: String(parsed.reason || "").slice(0, 300) });
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), suggestions, stats: protocolStats(attempted, suggestions.length) };
}

/* parseNormalizeRequests 解析 ```scholarium-normalize``` 围栏块：模型表达
 * “把这份 XLSX/TXT 规范化成一份 UTF-8 CSV，用这个 sheet、这一行当表头”。
 *
 * 和 scholarium-run 同一类——模型只描述意图，shell-ui 剥离成确认卡片，研究员
 * 点击后才由 Bridge 调 sch-data-normalize。原文件全程只读，产物落在
 * Materials/_normalized/<hash>/，不清洗、不过滤、不平滑任何数值。
 *
 * 刻意不接受 allow_missing_formula_cache：公式格没有缓存值时 normalize 默认
 * fail-closed，因为那会静默产出一整列空白，然后画出一张看起来正常的图。这道
 * 闸只能由研究员在卡片上自己解除，不能由模型在提议里预先解除——模型没有办法
 * 知道那些公式本该算出什么。 */
const NORMALIZE_SUFFIXES = new Set([".csv", ".tsv", ".txt", ".dat", ".xlsx"]);
const NORMALIZE_FORMULA_MODES = new Set(["cached", "formula_text", "reject"]);

function parseNormalizeRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-normalize");
  const normalizations = [];
  const cleaned = source.replace(/```scholarium-normalize\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const dataPath = String(parsed?.data_path || "").trim().replace(/\\/g, "/").slice(0, 400);
      if (!dataPath) return match;
      // Bounded to a Vault-relative path. An absolute path, a drive letter or
      // any ".." segment is rejected outright rather than normalised away.
      if (dataPath.startsWith("/") || /^[a-zA-Z]:/.test(dataPath)) return match;
      if (dataPath.split("/").some((segment) => segment === "..")) return match;
      const suffix = dataPath.slice(dataPath.lastIndexOf(".")).toLowerCase();
      if (!NORMALIZE_SUFFIXES.has(suffix)) return match;

      const request = { data_path: dataPath, reason: String(parsed?.reason || "").trim().slice(0, 300) };

      if (parsed?.sheet !== undefined && parsed?.sheet !== null) {
        const sheet = String(parsed.sheet).trim().slice(0, 200);
        if (!sheet) return match;
        request.sheet = sheet;
      }
      if (parsed?.header_row !== undefined && parsed?.header_row !== null) {
        const headerRow = Number(parsed.header_row);
        if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 10000) return match;
        request.header_row = headerRow;
      }
      if (parsed?.formula_mode !== undefined && parsed?.formula_mode !== null) {
        const formulaMode = String(parsed.formula_mode).trim().toLowerCase();
        if (!NORMALIZE_FORMULA_MODES.has(formulaMode)) return match;
        request.formula_mode = formulaMode;
      }

      normalizations.push(request);
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), normalizations, stats: protocolStats(attempted, normalizations.length) };
}

/* Reproducible chart requests -------------------------------------------------
 *
 * `scholarium-plot` is a request for a fresh chart recipe.  It is deliberately
 * not a generic SVG edit surface: the renderer alone produces SVG from a
 * source CSV/TSV plus this bounded recipe, and the parser always fixes the
 * model-visible save mode to `new`.
 *
 * `scholarium-plot-revise` is still narrower.  The model may point at one
 * existing plot manifest and request a visual-only chart_style patch, but may
 * not smuggle a new data_path, column choice, plot kind, or overwrite into a
 * purported style change.  The UI must load source/column choices from the
 * selected manifest itself and render a new version after confirmation. */
const PLOT_SUFFIXES = new Set([".csv", ".tsv", ".txt", ".dat"]);
const PLOT_KINDS = new Set(["line", "scatter", "bar"]);
const PLOT_STYLE_KEYS = new Set([
  "theme", "markers", "show_grid", "line_width", "x_range", "y_range",
  "annotations", "series_colors", "fig_size", "spines", "border_width",
  "title_size", "label_size", "tick_size", "x_label", "y_label", "legend",
  "marker_size", "line_style", "tick_count",
]);

function vaultRelativePath(value, suffixes, maxLength = 400) {
  const result = String(value || "").trim().replace(/\\/g, "/").slice(0, maxLength);
  if (!result || result.startsWith("/") || /^[a-zA-Z]:/.test(result)) return null;
  if (result.split("/").some((segment) => segment === "..")) return null;
  const suffix = result.slice(result.lastIndexOf(".")).toLowerCase();
  return suffixes.has(suffix) ? result : null;
}

function boundedText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maxLength ? text : null;
}

function finiteNumber(value, minimum, maximum, integer = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum || (integer && !Number.isInteger(number))) return null;
  return number;
}

function plotRange(value) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const low = finiteNumber(value[0], -Number.MAX_VALUE, Number.MAX_VALUE);
  const high = finiteNumber(value[1], -Number.MAX_VALUE, Number.MAX_VALUE);
  return low === null || high === null || low >= high ? undefined : [low, high];
}

function parsePlotStyle(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !PLOT_STYLE_KEYS.has(key))) return null;
  const style = {};
  if (value.theme !== undefined) {
    const theme = String(value.theme).toLowerCase();
    if (!new Set(["publication", "soft", "dark"]).has(theme)) return null;
    style.theme = theme;
  }
  if (value.markers !== undefined) {
    const markers = String(value.markers).toLowerCase();
    if (!new Set(["auto", "all", "none"]).has(markers)) return null;
    style.markers = markers;
  }
  if (value.show_grid !== undefined) {
    if (typeof value.show_grid !== "boolean") return null;
    style.show_grid = value.show_grid;
  }
  for (const [key, min, max, integer] of [
    ["line_width", 1, 6, false], ["border_width", 0.5, 4, false],
    ["title_size", 10, 40, false], ["label_size", 8, 24, false],
    ["tick_size", 6, 20, false], ["marker_size", 1, 10, false],
    ["tick_count", 3, 10, true],
  ]) {
    if (value[key] === undefined) continue;
    const number = finiteNumber(value[key], min, max, integer);
    if (number === null) return null;
    style[key] = number;
  }
  for (const key of ["x_range", "y_range"]) {
    if (value[key] === undefined) continue;
    const range = plotRange(value[key]);
    if (range === undefined) return null;
    style[key] = range;
  }
  if (value.fig_size !== undefined) {
    if (!Array.isArray(value.fig_size) || value.fig_size.length !== 2) return null;
    const width = finiteNumber(value.fig_size[0], 400, 2400, true);
    const height = finiteNumber(value.fig_size[1], 300, 1800, true);
    if (width === null || height === null) return null;
    style.fig_size = [width, height];
  }
  if (value.spines !== undefined) {
    if (!value.spines || typeof value.spines !== "object" || Array.isArray(value.spines)) return null;
    if (Object.keys(value.spines).some((key) => !["top", "right", "left", "bottom"].includes(key))) return null;
    const spines = {};
    for (const side of ["top", "right", "left", "bottom"]) {
      if (value.spines[side] === undefined) continue;
      if (typeof value.spines[side] !== "boolean") return null;
      spines[side] = value.spines[side];
    }
    if (!Object.keys(spines).length) return null;
    style.spines = spines;
  }
  if (value.legend !== undefined) {
    const legend = String(value.legend).toLowerCase();
    if (!new Set(["bottom", "right", "none"]).has(legend)) return null;
    style.legend = legend;
  }
  if (value.line_style !== undefined) {
    const lineStyle = String(value.line_style).toLowerCase();
    if (!new Set(["solid", "dashed", "dotted"]).has(lineStyle)) return null;
    style.line_style = lineStyle;
  }
  for (const key of ["x_label", "y_label"]) {
    if (value[key] === undefined) continue;
    if (value[key] === null) { style[key] = null; continue; }
    const label = boundedText(value[key], 60);
    if (!label) return null;
    style[key] = label;
  }
  if (value.annotations !== undefined) {
    if (!Array.isArray(value.annotations) || value.annotations.length > 8) return null;
    const annotations = [];
    for (const entry of value.annotations) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      if (Object.keys(entry).some((key) => !["type", "value", "label"].includes(key))) return null;
      const type = String(entry.type).toLowerCase();
      const position = finiteNumber(entry.value, -Number.MAX_VALUE, Number.MAX_VALUE);
      if (!new Set(["hline", "vline"]).has(type) || position === null) return null;
      const label = entry.label === undefined ? "" : String(entry.label).trim();
      if (label.length > 60) return null;
      annotations.push({ type, value: position, label });
    }
    style.annotations = annotations;
  }
  if (value.series_colors !== undefined) {
    if (!value.series_colors || typeof value.series_colors !== "object" || Array.isArray(value.series_colors)) return null;
    const entries = Object.entries(value.series_colors);
    if (entries.length > 12) return null;
    const colors = {};
    for (const [column, color] of entries) {
      const name = boundedText(column, 200);
      const hex = String(color || "").trim();
      if (!name || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(hex)) return null;
      colors[name] = hex.toLowerCase();
    }
    style.series_colors = colors;
  }
  return style;
}

function parsePlotRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-plot");
  const plots = [];
  const cleaned = source.replace(/```scholarium-plot\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const allowed = new Set(["data_path", "x_column", "y_columns", "plot_kind", "title", "chart_style", "save_mode", "reason"]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => !allowed.has(key))) return match;
      if (parsed.save_mode !== undefined && String(parsed.save_mode).toLowerCase() !== "new") return match;
      const dataPath = vaultRelativePath(parsed.data_path, PLOT_SUFFIXES);
      const xColumn = boundedText(parsed.x_column, 200);
      const plotKind = String(parsed.plot_kind || "").toLowerCase();
      const yColumns = Array.isArray(parsed.y_columns) ? parsed.y_columns.map((value) => boundedText(value, 200)) : [];
      if (!dataPath || !xColumn || !PLOT_KINDS.has(plotKind) || !yColumns.length || yColumns.length > 6 || yColumns.some((value) => !value) || new Set(yColumns).size !== yColumns.length || yColumns.includes(xColumn)) return match;
      const style = parsePlotStyle(parsed.chart_style);
      if (style === null) return match;
      const request = { data_path: dataPath, x_column: xColumn, y_columns: yColumns, plot_kind: plotKind, chart_style: style, save_mode: "new", reason: String(parsed.reason || "").trim().slice(0, 300) };
      if (parsed.title !== undefined) {
        const title = boundedText(parsed.title, 180);
        if (!title) return match;
        request.title = title;
      }
      plots.push(request);
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), plots, stats: protocolStats(attempted, plots.length) };
}

function parsePlotRevisionRequests(text) {
  const source = String(text || "");
  const attempted = protocolAttemptCount(source, "scholarium-plot-revise");
  const revisions = [];
  const cleaned = source.replace(/```scholarium-plot-revise\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const allowed = new Set(["target_manifest_path", "chart_style", "reason"]);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => !allowed.has(key))) return match;
      const target = vaultRelativePath(parsed.target_manifest_path, new Set([".json"]));
      if (!target || !/^Materials\/_analysis\/.+\/plot-manifest\.json$/i.test(target)) return match;
      const style = parsePlotStyle(parsed.chart_style);
      if (style === null || !Object.keys(style).length) return match;
      revisions.push({ target_manifest_path: target, chart_style: style, save_mode: "new", reason: String(parsed.reason || "").trim().slice(0, 300) });
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), revisions, stats: protocolStats(attempted, revisions.length) };
}

const chatActionsApi = { concealMalformedProtocolBlocks, detectWriteClaim, parseActionRequests, parseRunRequests, parseDraftRequests, parseLegacyNoteEditRequests, parseNormalizeRequests, parsePlotRequests, parsePlotRevisionRequests, parseSuggestReconstructionRequests };
if (typeof module !== "undefined" && module.exports) module.exports = chatActionsApi;
if (typeof window !== "undefined") window.weaverChatActionsCore = chatActionsApi;
