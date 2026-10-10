"use strict";
/*
 * 实验记录看板：让卡片和详情页显示笔记的全部 “## 段落” 内容。
 *
 * 旧代码有两个问题：
 *   1. extractNoteSections 的正则在多行模式下用 `\s*$` 作结束条件，`$` 会在
 *      每一行末尾匹配，于是每个段落只取到第一行；标题后面空一行的段落则直接
 *      变成空串、被跳过。新建的 Schema v1 实验记录（标题下空一行）因此整张
 *      卡片一片空白。
 *   2. 卡片只认固定的几个标题（实验目的 / 实验步骤 / 注意事项……），详情页只
 *      认“实验步骤”和“注意事项”。Schema v1 的“实验方案与过程 / 数据来源 /
 *      结果 / 结论”一个都不显示。
 *
 * 这个补丁把段落解析改成逐行切分，卡片按“常用标题在前、其余按笔记顺序”显示
 * 每一段（用 Obsidian 的 Markdown 渲染，表格、列表都能正常显示，卡片内可滚
 * 动），详情页同样显示全部段落。只读，不改任何笔记。
 *
 *   node tools/patch-experiment-board-sections.js [插件目录或 main.js 路径]
 *
 * 不带参数时修补本仓库的 main.js / styles.css。重复运行是安全的。
 */
const fs = require("node:fs");
const path = require("node:path");

const MARK = "/* SCHOLARIUM_BOARD_SECTIONS_PATCHED */";
const ANCHOR_MARK = "/* SCHOLARIUM_BOARD_ANCHORS_PATCHED */";
const CSS_BEGIN = "/* SCHOLARIUM_BOARD_SECTIONS_CSS_BEGIN */";
const CSS_END = "/* SCHOLARIUM_BOARD_SECTIONS_CSS_END */";

const OLD_EXTRACT = `    extractNoteSections(e) {
      var l, c, h;
      let s = e.match(/^---[\\s\\S]*?---\\s*([\\s\\S]*)$/),
        i = s ? ((l = s[1]) != null ? l : "") : e,
        r = new Map(),
        n = /^##\\s+(.+?)\\s*\\n([\\s\\S]*?)(?=^##\\s+|\\s*$)/gm,
        a;
      for (; (a = n.exec(i)) !== null; ) {
        let d = ((c = a[1]) != null ? c : "").trim(),
          p = ((h = a[2]) != null ? h : "").trim();
        d && p && r.set(d, p);
      }
      return r;
    }`;

const NEW_EXTRACT = `    extractNoteSections(e) {
      ${MARK}
      // Split line by line on level-2 headings. A "### sub" heading stays
      // inside its section; fenced code is skipped so a "## " inside a code
      // block is not mistaken for a heading.
      let s = String(e || "").match(/^---[\\s\\S]*?---\\s*([\\s\\S]*)$/),
        i = s ? (s[1] != null ? s[1] : "") : String(e || ""),
        r = new Map(),
        cur = null,
        buf = [],
        fence = null;
      const flush = () => {
        if (cur === null) return;
        const body = buf.join("\\n").trim();
        if (body && !r.has(cur)) r.set(cur, body);
      };
      for (const line of i.split(/\\r?\\n/)) {
        const f = /^\\s{0,3}(\`{3,}|~{3,})/.exec(line);
        if (f) fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1].slice(0, 3);
        const m = fence ? null : /^##[ \\t]+(.+?)[ \\t]*#*[ \\t]*$/.exec(line);
        if (m) { flush(); cur = m[1].trim(); buf = []; }
        else if (cur !== null) buf.push(line);
      }
      flush();
      return r;
    }`;

const OLD_CARD_LOOP_TAIL = `        let b = l.createDiv({ cls: "exp-note-card-section" });
        b.createEl("h4", { text: f }),
          b.createDiv({ cls: "exp-note-card-text", text: w });
      }`;

const CARD_LOOP_HEAD = `      let g = this.extractNoteSections(c);
      for (let f of s.noteType === "research-learning"`;

const NEW_CARD_LOOP_TAIL = `        let b = l.createDiv({ cls: "exp-note-card-section" });
        b.createEl("h4", { text: f });
        let __t = b.createDiv({ cls: "exp-note-card-text markdown-rendered" });
        try {
          await me.MarkdownRenderer.render(this.app, w.length > 6000 ? w.slice(0, 6000) + "\\n\\n…" : w, __t, s.file.path, this);
        } catch (__err) {
          __t.setText(w);
        }
      }`;

// The card loop iterates a fixed list; after the patch it iterates that list
// first and then every other section in note order (experiments only — a
// research-learning card already shows its whole text above).
const NEW_CARD_LOOP_HEAD = `      let g = this.extractNoteSections(c);
      const __sectionOrder = (preferred) => s.noteType === "research-learning"
        ? preferred
        : [...preferred.filter((f) => g.has(f)), ...[...g.keys()].filter((f) => !preferred.includes(f))];
      for (let f of __sectionOrder(s.noteType === "research-learning"`;

const OLD_DETAIL_START = "    renderNoteBodySections(e, s) {\n";
const NEW_DETAIL = `    renderNoteBodySections(e, s) {
      ${MARK}
      if (!s) return;
      const sections = this.extractNoteSections(s);
      for (const [title, raw] of sections) {
        let body = String(raw || "")
          .replace(new RegExp("\`\`\`" + xt + "[\\\\s\\\\S]*?\`\`\`", "g"), "")
          .trim();
        if (body.length < 2 || body === "\\uFF08\\u6682\\u65E0\\uFF09" || /^1\\.\\s*步骤/.test(body)) continue;
        const box = e.createDiv({ cls: "detail-section" });
        box.createEl("h4", { text: title, cls: "section-title" });
        const out = box.createDiv({ cls: "exp-note-card-text markdown-rendered scholarium-detail-md" });
        const file = this.selectedExperiment && this.selectedExperiment.file ? this.selectedExperiment.file.path : "";
        Promise.resolve(me.MarkdownRenderer.render(this.app, body, out, file, this)).catch(() => out.setText(body));
      }
    }
    __legacyRenderNoteBodySections(e, s) {
`;

const CSS = `${CSS_BEGIN}
/* Full note sections on experiment cards and in the detail view. */
.exp-note-card-text.markdown-rendered table { display: block; max-width: 100%; overflow-x: auto; font-size: 0.92em; border-collapse: collapse; }
.exp-note-card-text.markdown-rendered th,
.exp-note-card-text.markdown-rendered td { padding: 3px 6px; border: 1px solid var(--background-modifier-border, rgba(127,127,127,.3)); }
.exp-note-card-text.markdown-rendered pre { max-width: 100%; overflow-x: auto; white-space: pre-wrap; }
.exp-note-card-text.markdown-rendered h3,
.exp-note-card-text.markdown-rendered h4 { font-size: 1em; margin: 8px 0 4px; }
.exp-note-card-text.markdown-rendered ul,
.exp-note-card-text.markdown-rendered ol { padding-left: 1.3em; margin: 4px 0; }
.detail-section .scholarium-detail-md { font-size: 0.95em; }
body.scholarium-alt-held [data-sch-anchor]:hover { outline: 1px dashed var(--interactive-accent, #7b6cd9); outline-offset: 2px; cursor: copy; }
${CSS_END}
`;

function patchMain(source) {
  if (source.includes(MARK)) return { text: source, changed: false };
  let text = source;
  const need = (needle, label) => {
    const at = text.indexOf(needle);
    if (at < 0) throw new Error(`main.js 里找不到 ${label}；这个版本的看板代码和补丁不匹配，未修改。`);
    if (text.indexOf(needle, at + 1) >= 0) throw new Error(`main.js 里 ${label} 出现了不止一次，未修改。`);
    return at;
  };
  need(OLD_EXTRACT, "extractNoteSections");
  text = text.replace(OLD_EXTRACT, () => NEW_EXTRACT);

  const head = need(CARD_LOOP_HEAD, "卡片段落循环");
  const tail = text.indexOf(OLD_CARD_LOOP_TAIL, head);
  if (tail < 0) throw new Error("main.js 里找不到卡片段落循环的结尾，未修改。");
  // close the extra "(" opened by __sectionOrder( ... ) right before ") {" of the for
  let middle = text.slice(head + CARD_LOOP_HEAD.length, tail);
  const close = middle.indexOf("]) {");
  if (close < 0) throw new Error("卡片段落循环的标题列表结构不符，未修改。");
  middle = middle.slice(0, close) + "])) {" + middle.slice(close + "]) {".length);
  text = text.slice(0, head) + NEW_CARD_LOOP_HEAD + middle + NEW_CARD_LOOP_TAIL + text.slice(tail + OLD_CARD_LOOP_TAIL.length);

  need(OLD_DETAIL_START, "renderNoteBodySections");
  text = text.replace(OLD_DETAIL_START, () => NEW_DETAIL);
  return { text, changed: true };
}

/*
 * Stage 2 (P3 识别点): every experiment card, card section, detail title and
 * detail section carries `data-sch-anchor`, so Alt+click quotes exactly that
 * place into 织研者; and the dashboard registers the 织研者 commands (Alt+click,
 * 「发给织研者」) on its first render, not only once the 织研者 tab is opened.
 */
const ANCHOR_EDITS = [
  {
    label: "卡片识别点",
    find: "    async renderExperimentCard(e, s) {\n      var v;\n      e.empty();\n",
    replace: `    async renderExperimentCard(e, s) {
      var v;
      e.empty();
      ${ANCHOR_MARK}
      const __schBase = typeof schNativeWeaverHost !== "undefined" && schNativeWeaverHost.anchorForFile ? schNativeWeaverHost.anchorForFile(this.app, s.file, []) : "";
      __schBase && (e.setAttribute("data-sch-anchor", __schBase), e.setAttribute("title", "Alt+点击：把这条实验记录发给织研者"));
`,
  },
  {
    label: "卡片段落识别点",
    find: "        b.createEl(\"h4\", { text: f });\n        let __t = b.createDiv(",
    replace: "        b.createEl(\"h4\", { text: f });\n        __schBase && (b.setAttribute(\"data-sch-anchor\", __schBase + \"#\" + schNativeWeaverHost.escapeAnchorPart(f)), b.setAttribute(\"title\", \"Alt+点击：把这一段发给织研者\"));\n        let __t = b.createDiv(",
  },
  {
    label: "详情标题识别点",
    find: "      i.createEl(\"h2\", { text: s.title, cls: \"detail-title\" });\n",
    replace: "      i.createEl(\"h2\", { text: s.title, cls: \"detail-title\" });\n      typeof schNativeWeaverHost !== \"undefined\" && schNativeWeaverHost.anchorForFile && (i.setAttribute(\"data-sch-anchor\", schNativeWeaverHost.anchorForFile(this.app, s.file, [])), i.setAttribute(\"title\", \"Alt+点击：把这条实验记录发给织研者\"));\n",
  },
  {
    label: "详情段落识别点",
    find: "        const box = e.createDiv({ cls: \"detail-section\" });\n        box.createEl(\"h4\", { text: title, cls: \"section-title\" });\n",
    replace: "        const box = e.createDiv({ cls: \"detail-section\" });\n        box.createEl(\"h4\", { text: title, cls: \"section-title\" });\n        if (typeof schNativeWeaverHost !== \"undefined\" && schNativeWeaverHost.anchorForFile && this.selectedExperiment && this.selectedExperiment.file) {\n          box.setAttribute(\"data-sch-anchor\", schNativeWeaverHost.anchorForFile(this.app, this.selectedExperiment.file, [title]));\n          box.setAttribute(\"title\", \"Alt+点击：把这一段发给织研者\");\n        }\n",
  },
  {
    label: "织研者命令注册",
    find: "      window.__scholariumDashboardView = this;\n",
    replace: "      window.__scholariumDashboardView = this;\n      try { typeof schNativeWeaverHost !== \"undefined\" && schNativeWeaverHost.registerCommand(this.plugin); } catch (_) { /* commands are optional */ }\n",
  },
];

function patchAnchors(source) {
  if (source.includes(ANCHOR_MARK)) return { text: source, changed: false };
  if (!source.includes(MARK)) throw new Error("需要先应用看板段落补丁");
  let text = source;
  for (const edit of ANCHOR_EDITS) {
    const at = text.indexOf(edit.find);
    if (at < 0 || text.indexOf(edit.find, at + 1) >= 0) throw new Error(`main.js 里 ${edit.label} 的位置不唯一或找不到，未修改。`);
    text = text.slice(0, at) + edit.replace + text.slice(at + edit.find.length);
  }
  return { text, changed: true };
}

/* Stage-2 code written before 2026-10-08 percent-encoded whole Chinese
 * headings (sch:EXP-001#%E5%AE%9E…). Bring it to the readable form. */
const ANCHOR_MIGRATIONS = [
  ['__schBase + "#" + encodeURIComponent(f)', '__schBase + "#" + schNativeWeaverHost.escapeAnchorPart(f)'],
];

function migrateAnchors(source) {
  let text = source;
  for (const [from, to] of ANCHOR_MIGRATIONS) text = text.split(from).join(to);
  return { text, changed: text !== source };
}

function patchCss(source) {
  const begin = source.indexOf(CSS_BEGIN);
  const end = source.indexOf(CSS_END);
  if (begin >= 0 && end > begin) return source.slice(0, begin) + CSS + source.slice(end + CSS_END.length + 1);
  return `${source.replace(/\s*$/, "\n")}\n${CSS}`;
}

function run(target) {
  const resolved = path.resolve(target);
  const dir = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  const mainPath = fs.statSync(resolved).isDirectory() ? path.join(resolved, "main.js") : resolved;
  const main = fs.readFileSync(mainPath, "utf8");
  const result = patchMain(main);
  const anchors = patchAnchors(result.text);
  const migrated = migrateAnchors(anchors.text);
  if (result.changed || anchors.changed || migrated.changed) fs.writeFileSync(mainPath, migrated.text, "utf8");
  const cssPath = path.join(dir, "styles.css");
  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, "utf8");
    const next = patchCss(css);
    if (next !== css) fs.writeFileSync(cssPath, next, "utf8");
  }
  return result.changed || anchors.changed || migrated.changed ? `${mainPath}：看板段落显示与识别点已修补` : `${mainPath}：看板段落显示与识别点已是最新`;
}

module.exports = { patchMain, patchAnchors, patchCss, run, MARK, ANCHOR_MARK };

if (require.main === module) {
  console.log(run(process.argv[2] || path.resolve(__dirname, "..")));
}
