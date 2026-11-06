// @ts-nocheck
/* Structured project profiles and the unified formal/legacy project registry.
 * Recovered as source so schema-v2 fields are not lost in the clean build. */
import { DashboardView as _t } from "./dashboard-view";
import { RssFeedBoard as Ys } from "./rss-feed-board";
import { Sl } from "./ai-completion";
import { schPromptText } from "./prompt-text";
import { schEvidenceTools } from "./research-evidence-tools";

var Le = require("obsidian");
var qe = _t.prototype;
function be(o) {
  return typeof o == "string" && o.trim().length > 0;
}
function it(o) {
  return Array.isArray(o) && o.some((t) => String(t || "").trim());
}
function je(o) {
  return Array.isArray(o)
    ? o.map((t) => String(t || "").trim()).filter(Boolean)
    : String(o || "")
        .split(/[,;\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
}
function fs(o) {
  let t = String(o || ""),
    e = t.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return e
    ? { frontmatter: e[1] || "", body: t.slice(e[0].length) }
    : { frontmatter: "", body: t };
}
function Lr(o) {
  let t = {},
    e = fs(o).frontmatter.split(/\r?\n/);
  for (let s = 0; s < e.length; s++) {
    let i = (e[s] || "").match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!i) continue;
    let r = i[1] || "",
      n = (i[2] || "").trim();
    if (r)
      if (n === "") {
        let a = [];
        for (; s + 1 < e.length && /^\s*-\s+/.test(e[s + 1] || ""); )
          a.push(schUnquote((e[++s] || "").replace(/^\s*-\s+/, "")));
        t[r] = a;
      } else t[r] = schUnquote(n);
  }
  return t;
}
function schUnquote(o) {
  let t = String(o == null ? "" : o).trim();
  if (t.length > 1 && t.charCodeAt(0) === 34 && t.charCodeAt(t.length - 1) === 34)
    try {
      let e = JSON.parse(t);
      if (typeof e == "string") return e;
    } catch (e) {}
  return t.replace(/^["']|["']$/g, "");
}
function vt(o) {
  let t = String(o || "")
    .replace(/\r?\n/g, " ")
    .trim();
  return t ? JSON.stringify(t) : '""';
}
function yo(o) {
  let t = je(o);
  return t.length
    ? `
` +
        t.map((e) => `  - ${vt(e)}`).join(`
`)
    : " []";
}
function $s(o) {
  return {
    projectId: o.projectId,
    title: o.title || o.projectId,
    status: "active",
    priority: "",
    stage: "",
    progress: null,
    thesis: "",
    primarySystem: "",
    secondarySystem: "",
    wavelengths: [],
    nextGate: "",
    tags: [],
    hypotheses: [],
    currentProblems: [],
    methodsNeeded: [],
    excludedTopics: [],
    hasProfile: !1,
  };
}
var Vr = ["hypotheses", "currentProblems", "methodsNeeded", "excludedTopics"];
function Br(o) {
  return (
    be(o.thesis) ||
    be(o.stage) ||
    be(o.primarySystem) ||
    be(o.secondarySystem) ||
    it(o.wavelengths) ||
    be(o.nextGate) ||
    it(o.hypotheses) ||
    it(o.currentProblems) ||
    it(o.methodsNeeded) ||
    it(o.excludedTopics) ||
    Number(o.progress) > 0
  );
}
function st(o, ...t) {
  for (let e of t) {
    let s = o[e];
    if (typeof s == "string" && s.trim()) return s.trim();
  }
  return "";
}
function Mr(o, t) {
  let e = $s(o);
  (e.projectId = st(t, "project_id", "projectId") || e.projectId),
    (e.title = st(t, "title") || e.title),
    (e.status = st(t, "status") || e.status),
    (e.priority = st(t, "priority")),
    (e.stage = st(t, "stage", "current_stage")),
    (e.thesis = st(t, "thesis", "core_thesis", "summary", "hypothesis")),
    (e.primarySystem = st(t, "primary_system", "primarySystem")),
    (e.secondarySystem = st(t, "secondary_system", "secondarySystem")),
    (e.nextGate = st(t, "next_gate", "nextGate"));
  let s = Number(st(t, "progress"));
  return (
    (e.progress = Number.isFinite(s) ? s : null),
    (e.wavelengths = Array.isArray(t.wavelengths)
      ? je(t.wavelengths)
      : je(st(t, "wavelengths"))),
    (e.tags = Array.isArray(t.tags) ? je(t.tags) : je(st(t, "tags"))),
    [
      ["hypotheses", "hypotheses", "hypothesis_list"],
      ["currentProblems", "current_problems", "open_problems"],
      ["methodsNeeded", "methods_needed", "needed_methods"],
      ["excludedTopics", "excluded_topics", "exclude"],
    ].forEach(([s2, ...i2]) => {
      let r2 = i2.find((n2) => Array.isArray(t[n2]) || be(t[n2]));
      e[s2] = r2
        ? Array.isArray(t[r2])
          ? je(t[r2])
          : je(String(t[r2]))
        : [];
    }),
    (e.hasProfile = Br(e)),
    e
  );
}
function Hd(o) {
  return String(o || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
function Rr(o, t) {
  let e = $s(o),
    s =
      t.match(
        /<section[^>]*class=["'][^"']*rp-thesis[^"']*["'][\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i,
      ) ||
      t.match(
        /-\s+\*\*(?:核心命题|Core Thesis)[^*]*\*\*[^\n：:]*[：:]\s*([^\n]+)/i,
      ) ||
      t.match(
        /-\s+\*\*(?:一句话核心命题|核心命题)[^*]*\*\*[^\n：:]*[：:]\s*([^\n]+)/i,
      );
  return (e.thesis = Hd(s == null ? void 0 : s[1])), (e.hasProfile = Br(e)), e;
}
function gs(o) {
  return o && typeof o == "object" ? o : {};
}
function jd(o, t) {
  let e = $s(o);
  return (
    (be(t.summary) ||
      be(t.hypothesis) ||
      it(t.entities) ||
      it(t.methods) ||
      it(t.currentFocus) ||
      be(t.nextGate) ||
      Number(t.progress) > 0) &&
      ((e.projectId = be(t.projectId) ? t.projectId : o.projectId),
      (e.title = be(t.title) ? t.title : o.title),
      (e.status = be(t.status) ? t.status : "active"),
      (e.priority = be(t.priority) ? t.priority : ""),
      (e.thesis = be(t.hypothesis)
        ? t.hypothesis
        : be(t.summary)
          ? t.summary
          : ""),
      (e.stage = it(t.currentFocus)
        ? t.currentFocus.filter(Boolean).join(" / ")
        : be(t.stage)
          ? t.stage
          : ""),
      (e.primarySystem = it(t.entities)
        ? String(t.entities[0] || "")
        : be(t.primarySystem)
          ? t.primarySystem
          : ""),
      (e.secondarySystem = it(t.entities)
        ? String(t.entities[1] || "")
        : be(t.secondarySystem)
          ? t.secondarySystem
          : ""),
      (e.wavelengths = it(t.methods)
        ? t.methods.filter(Boolean).slice(0, 4)
        : je(t.wavelengths)),
      (e.nextGate = be(t.nextGate)
        ? t.nextGate
        : be(t.next_gate)
          ? t.next_gate
          : ""),
      (e.progress = Number.isFinite(Number(t.progress))
        ? Number(t.progress)
        : null),
      (e.tags = je(t.literatureTags)),
      (e.hasProfile = !0)),
    e
  );
}
function $r(o, ...t) {
  let e = { ...o, wavelengths: [...o.wavelengths], tags: [...o.tags] };
  for (let s of Vr) e[s] = je(o[s]);
  for (let s of t.filter(Boolean)) {
    for (let i of [
      "projectId",
      "title",
      "status",
      "priority",
      "stage",
      "thesis",
      "primarySystem",
      "secondarySystem",
      "nextGate",
    ])
      !be(e[i]) && be(s[i]) && (e[i] = s[i]);
    (e.progress === null || e.progress === void 0) &&
      s.progress !== null &&
      s.progress !== void 0 &&
      (e.progress = s.progress),
      !it(e.wavelengths) &&
        it(s.wavelengths) &&
        (e.wavelengths = s.wavelengths),
      !it(e.tags) && it(s.tags) && (e.tags = s.tags);
    for (let i of Vr) !it(e[i]) && it(s[i]) && (e[i] = je(s[i]));
  }
  return (e.hasProfile = Br(e)), e;
}
function _r(o) {
  let t = [...o.matchAll(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/gm)],
    e = t.length,
    s = t.filter((i) => String(i[1]).toLowerCase() === "x").length;
  return { total: e, done: s, percent: e ? Math.round((s / e) * 100) : 0 };
}
function bi(o) {
  return {
    projectId: o.projectId || "",
    title: o.title || "",
    status: o.status || "active",
    priority: o.priority || "",
    stage: o.stage || "",
    progress:
      o.progress === null || o.progress === void 0 ? "" : String(o.progress),
    thesis: o.thesis || "",
    primarySystem: o.primarySystem || "",
    secondarySystem: o.secondarySystem || "",
    wavelengths: je(o.wavelengths),
    nextGate: o.nextGate || "",
    tags: je(o.tags),
    hypotheses: je(o.hypotheses),
    currentProblems: je(o.currentProblems),
    methodsNeeded: je(o.methodsNeeded),
    excludedTopics: je(o.excludedTopics),
  };
}
function bo(o) {
  return `---
type: project-profile
project_id: ${vt(o.projectId)}
title: ${vt(o.title)}
status: ${vt(o.status || "active")}
priority: ${vt(o.priority)}
stage: ${vt(o.stage)}
progress: ${o.progress === "" || o.progress === null ? "null" : Number(o.progress) || 0}
thesis: ${vt(o.thesis)}
primary_system: ${vt(o.primarySystem)}
secondary_system: ${vt(o.secondarySystem)}
wavelengths:${yo(o.wavelengths)}
next_gate: ${vt(o.nextGate)}
hypotheses:${yo(o.hypotheses)}
current_problems:${yo(o.currentProblems)}
methods_needed:${yo(o.methodsNeeded)}
excluded_topics:${yo(o.excludedTopics)}
profile_version: 2
last_updated: ${new Date().toISOString().slice(0, 10)}
tags:${yo(o.tags)}
---

`;
}
function wo(o) {
  let t = je(o.wavelengths).join(" / ") || "\u5F85\u8865\u5145";
  return `## \u753B\u50CF\u6458\u8981

- **\u8BFE\u9898\u540D\u79F0**\uFF1A${o.title || "\u5F85\u8865\u5145"}
- **\u6838\u5FC3\u547D\u9898**\uFF1A${o.thesis || "\u5F85\u8865\u5145"}
- **\u72B6\u6001 / \u4F18\u5148\u7EA7**\uFF1A${o.status || "active"}${o.priority ? " / " + o.priority : ""}
- **\u5F53\u524D\u9636\u6BB5**\uFF1A${o.stage || "\u5F85\u8865\u5145"}
- **\u4E3B\u4F53\u7CFB**\uFF1A${o.primarySystem || "\u5F85\u8865\u5145"}
- **\u62D3\u5C55\u4F53\u7CFB**\uFF1A${o.secondarySystem || "\u5F85\u8865\u5145"}
- **\u5173\u952E\u6CE2\u957F / \u901A\u9053**\uFF1A${t}
- **\u4E0B\u4E00\u9053\u9A8C\u8BC1\u95F8\u95E8**\uFF1A${o.nextGate || "\u5F85\u8865\u5145"}
${schProfileList("\u5F53\u524D\u5047\u8BBE", o.hypotheses)}${schProfileList("\u5F53\u524D\u5361\u70B9", o.currentProblems)}${schProfileList("\u9700\u8981\u5F15\u5165\u7684\u65B9\u6CD5", o.methodsNeeded)}${schProfileList("\u660E\u786E\u6392\u9664\u7684\u65B9\u5411", o.excludedTopics)}
`;
}
function schProfileList(o, t) {
  let e = je(t);
  return e.length
    ? `
**${o}**

` +
        e
          .map((s, i) => `${i + 1}. ${s}`)
          .join(`
`) +
        `
`
    : "";
}
function zd(o, t) {
  let e = wo(t),
    s = /##\s+画像摘要\s*\n[\s\S]*?(?=\n##\s+|\n<div\s|$)/;
  return s.test(o)
    ? o.replace(
        s,
        e.trimEnd() +
          `
`,
      )
    : e + String(o || "").replace(/^\s+/, "");
}
function ms(o) {
  return o instanceof Error ? o.message : String(o);
}
function schParseJsonObject(o) {
  let t = String(o || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, ""),
    e = t.indexOf("{");
  if (e < 0) return null;
  let s = 0,
    i = !1,
    r = !1;
  for (let n = e; n < t.length; n++) {
    let a = t[n];
    if (r) {
      r = !1;
      continue;
    }
    if (i && a === "\\") {
      r = !0;
      continue;
    }
    if (a === '"') {
      i = !i;
      continue;
    }
    if (i) continue;
    if (a === "{") s++;
    else if (a === "}" && --s === 0)
      try {
        return JSON.parse(t.slice(e, n + 1));
      } catch (_) {
        return null;
      }
  }
  return null;
}
function Wd() {
  if (qe.__projectProfileStructuredEditor) return;
  qe.__projectProfileStructuredEditor = !0;
  let o = qe.renderExperimentDashboard;
  (qe.projectProfileContext = async function () {
    let e = {};
    try {
      e = gs(await this.plugin.loadData());
    } catch (c) {
      console.warn("[Scholarium] project data read failed:", c);
    }
    let s = gs(e.projectWorkspace),
      i = gs(e.rssBoard),
      r =
        (be(i.researchProjectId) &&
        i.researchProjectId !== "UNCLASSIFIED" &&
        (!be(s.activeProjectId) || s.activeProjectId === "UNCLASSIFIED")
          ? i.researchProjectId
          : "") ||
        (be(s.activeProjectId) ? s.activeProjectId : "") ||
        (be(i.researchProjectId) ? i.researchProjectId : "") ||
        "PRJ-001",
      n =
        (this.plugin.settings.experimentsFolder || "Experiments").replace(
          /\/+$/,
          "",
        ) +
        "/Projects/" +
        r,
      a = r,
      o = this.app.vault.getMarkdownFiles().find((d) => {
        let f = (this.app.metadataCache.getFileCache(d) || {}).frontmatter || {};
        return f.type === "project" && String(f.migration_source_path || "").replace(/\\/g, "/").includes("/Projects/" + r + "/");
      }),
      l = o || this.app.vault.getAbstractFileByPath(n + "/project.md");
    if (l instanceof Le.TFile) {
      let c = this.app.metadataCache.getFileCache(l),
        h = gs(c == null ? void 0 : c.frontmatter);
      a = be(h.title) ? h.title : l.basename || a;
    }
    return {
      projectId: r,
      folder: n,
      title: a,
      profilePath: o ? o.path : n + "/00_\u8BFE\u9898\u753B\u50CF.md",
      jsonPath: n + "/project_profile.json",
      detailPath: n + "/01_\u5B8C\u6574\u8BFE\u9898\u5185\u5BB9.md",
      roadmapPath: n + "/02_Roadmap.md",
      projectPath: o ? o.path : n + "/project.md",
    };
  }),
    (qe.extractProfileWithAI = async function (e, s) {
      let i = [e.detailPath, e.profilePath, e.projectPath],
        r = "";
      for (let h of i) {
        let d = this.app.vault.getAbstractFileByPath(h);
        if (d instanceof Le.TFile) {
          let p = (await this.app.vault.cachedRead(d))
            .replace(/^---[\s\S]*?\n---\s*/, "")
            .trim();
          p.length > 80 && (r += `\n\n===== ${d.basename} =====\n${p}`);
        }
      }
      if ((r = r.trim()).length < 120)
        throw new Error(
          "没有找到足够的课题正文。请先在「完整课题内容」里写下你的研究背景、目标、假设与当前困难。",
        );
      let n = this.plugin.settings,
        a = String(n.rssAiProvider) === String(n.aiProvider),
        l = {
          provider: n.rssAiProvider || n.aiProvider,
          apiKey:
            n.rssAiApiKey || (a ? n.aiApiKey : "") || n.aiApiKey || "",
          model: n.rssAiModel || (a ? n.aiModel : "") || n.aiModel || void 0,
          customEndpoint:
            n.rssAiCustomEndpoint || n.aiCustomEndpoint || void 0,
          requestTimeout: 12e4,
        };
      if (!l.apiKey)
        throw new Error("请先在设置里配置 AI API Key");
      let c = await Sl(
        `你是科研课题结构化助手。用户会给你他自己写的课题材料（可能零散、口语化、含实验流水账）。
请抽取成结构化课题画像，供下游“文献雷达”给新论文打分使用。规则：
1. 只使用材料中真实出现的信息，不要补充你自己的领域知识，不要臆造材料里没有的体系或方法。
2. 抽不出来的字段返回空字符串或空数组，宁缺勿造。
3. hypotheses 要写成可被证伪的陈述句（“X 由 Y 主导”“提高 A 会降低 B”），不是研究方向。这是判断新论文“支持还是反驳”的锚点，最重要。
4. current_problems 写当前真正卡住的地方（机理不清、某步产率低、某表征做不了），不是宏观目标。
5. methods_needed 写材料中提到"想做但还没做/还不会"的方法与表征。
6. excluded_topics 写明确不关心的方向；材料没说就返回空数组，不要猜。
7. 中文字段用中文，方法名与材料体系保留原文英文缩写。
只输出 JSON，不加 Markdown 代码块。`,
        `课题材料：\n${r.slice(0, 4e4)}\n\n请返回严格 JSON：{"title":"","thesis":"","stage":"","primarySystem":"","secondarySystem":"","wavelengths":[],"nextGate":"","tags":[],"hypotheses":[],"currentProblems":[],"methodsNeeded":[],"excludedTopics":[]}`,
        l,
        12e3,
      ),
        o = schParseJsonObject(c);
      if (!o) throw new Error("AI 未返回可解析的 JSON");
      let u = o,
        g = {},
        m = (h) => (typeof h == "string" ? h.trim() : "");
      for (let h of [
        "title",
        "thesis",
        "stage",
        "primarySystem",
        "secondarySystem",
        "nextGate",
      ])
        m(u[h]) && (g[h] = m(u[h]));
      for (let h of [
        "wavelengths",
        "tags",
        "hypotheses",
        "currentProblems",
        "methodsNeeded",
        "excludedTopics",
      ]) {
        let d = je(u[h]);
        d.length && (g[h] = d);
      }
      return Object.keys(g).length ? g : null;
    }),
    (qe.evaluateProjectProfileWithAI = async function (e, s) {
      let i = [e.detailPath, e.projectPath, e.profilePath, e.roadmapPath],
        r = [],
        n = new Set();
      for (let a of i) {
        let l = this.getProjectProfileFile(a);
        if (!(l instanceof Le.TFile) || n.has(l.path)) continue;
        n.add(l.path);
        try {
          let c = (await this.app.vault.cachedRead(l)).replace(/^---[\s\S]*?\n---\s*/, "").trim();
          c && r.push(`===== ${l.path} =====\n${c}`);
        } catch (c) {}
      }
      let a = r.join("\n\n").slice(0, 4e4);
      if (a.length < 120) throw new Error("没有找到足够的课题材料，无法进行 AI 评估");
      let l = this.plugin.settings,
        c = String(l.rssAiProvider) === String(l.aiProvider),
        h = {
          provider: l.rssAiProvider || l.aiProvider,
          apiKey: l.rssAiApiKey || (c ? l.aiApiKey : "") || l.aiApiKey || "",
          model: l.rssAiModel || (c ? l.aiModel : "") || l.aiModel || void 0,
          customEndpoint: l.rssAiCustomEndpoint || l.aiCustomEndpoint || void 0,
          requestTimeout: 12e4,
        };
      if (!h.apiKey) throw new Error("请先在设置里配置 AI API Key");
      let d = await Sl(
          `你是科研项目进度评估 Agent。只根据提供的课题材料和 Roadmap 评估当前“证据成熟度”，不是评价论文质量，也不能凭空补充实验结果。\n评分规则：0=只有想法，25=已有初步体系或现象，50=已有可重复的核心结果，75=机制证据链基本闭合，100=关键证据和跨体系验证完成。材料没有明确证据时宁可给低分。只输出 JSON，不加 Markdown。`,
          `课题：${e.projectId} · ${e.title}\n当前已记录画像：${JSON.stringify(s || {})}\n材料：\n${a}\n\n请返回严格 JSON：{"progress":0,"stage":"","nextGate":"","reason":""}`,
          h,
          8000,
        ),
        p = schParseJsonObject(d);
      if (!p) throw new Error("AI 未返回可解析的评估 JSON");
      let u = p,
        g = Math.max(0, Math.min(100, Math.round(Number(u.progress))));
      if (!Number.isFinite(g)) throw new Error("AI 返回的 progress 无效");
      let m = this.getProjectProfileFile(e.profilePath);
      m || (m = await this.ensureProjectProfileFile(e, s));
      let x = this.getProjectProfileFile(e.projectPath),
        T = { ...(s || {}), progress: g };
      String(u.stage || "").trim() && (T.stage = String(u.stage).trim());
      String(u.nextGate || "").trim() && (T.nextGate = String(u.nextGate).trim());
      if (x instanceof Le.TFile)
        await this.app.fileManager.processFrontMatter(x, (w) => {
          w.progress = g;
          String(u.stage || "").trim() && (w.stage = String(u.stage).trim());
          String(u.nextGate || "").trim() && (w.next_gate = String(u.nextGate).trim());
          w.updated_at = new Date().toISOString();
        });
      if (m instanceof Le.TFile && m.path !== (x == null ? void 0 : x.path))
        await this.app.fileManager.processFrontMatter(m, (w) => {
          w.progress = g;
          String(u.stage || "").trim() && (w.stage = String(u.stage).trim());
          String(u.nextGate || "").trim() && (w.next_gate = String(u.nextGate).trim());
          w.updated_at = new Date().toISOString();
        });
      await this.syncProjectProfileJson(e, T);
      return { progress: g, stage: String(u.stage || "").trim(), nextGate: String(u.nextGate || "").trim(), reason: String(u.reason || "").trim() };
    }),
      (qe.getProjectProfileFile = function (e) {
      let s = this.app.vault.getAbstractFileByPath(e);
      return s instanceof Le.TFile && s.extension === "md" ? s : null;
    }),
    (qe.loadProjectRoadmap = async function (e) {
      let s = this.getProjectProfileFile(e.roadmapPath);
      if (!s)
        return {
          file: null,
          text: "",
          stats: { total: 0, done: 0, percent: 0 },
        };
      let i = await this.app.vault.cachedRead(s);
      return { file: s, text: i, stats: _r(i) };
    }),
    (qe.loadProjectProfileSummary = async function () {
      let e = await this.projectProfileContext(),
        s = $s(e),
        i = this.getProjectProfileFile(e.profilePath);
      try {
        let r = null,
          n = null,
          a = null;
        if (i) {
          let c = await this.app.vault.cachedRead(i);
          (r = Mr(e, Lr(c))), (n = Rr(e, fs(c).body));
        }
        let l = this.app.vault.getAbstractFileByPath(e.jsonPath);
        l instanceof Le.TFile &&
          (a = jd(e, JSON.parse(await this.app.vault.cachedRead(l)))),
          (s = $r(r || s, n, a));
      } catch (r) {
        console.warn("[Scholarium] project profile read failed:", r);
      }
      return { ctx: e, summary: s, profileFile: i };
    }),
    (qe.ensureProjectProfileFile = async function (e, s) {
      let i = this.getProjectProfileFile(e.profilePath);
      if (i) return i;
      let r = "";
      let n = String(e.profilePath || "").split("/").slice(0, -1).filter(Boolean),
        a = e.folder.split("/");
      for (let l of Array.from(new Set([].concat(a, n))))
        (r = r ? r + "/" + l : l),
          this.app.vault.getAbstractFileByPath(r) ||
            (await this.app.vault.createFolder(r));
      let l = bi(s || $s(e));
      return await this.app.vault.create(
        e.profilePath,
        bo(l) +
          wo(l) +
          `# ${l.title || e.projectId}

`,
      );
    }),
    (qe.syncProjectProfileJson = async function (e, s) {
      let i = {
          schemaVersion: "project-profile-v1",
          projectId: s.projectId || e.projectId,
          profileVersion: 1,
          title: s.title || e.title,
          summary: s.thesis || "",
          entities: [s.primarySystem, s.secondarySystem].filter(Boolean),
          methods: je(s.wavelengths),
          problems: [],
          currentFocus: s.stage ? [s.stage] : [],
          hypothesis: s.thesis || "",
          literatureTags: je(s.tags),
          excludedTags: [],
          nextGate: s.nextGate || "",
          progress: s.progress === "" ? null : Number(s.progress) || 0,
          generatedAt: Date.now(),
          generatedBy: { mode: "structured-editor", model: "" },
        },
        r = this.app.vault.getAbstractFileByPath(e.jsonPath),
        n = JSON.stringify(i, null, 2);
      r instanceof Le.TFile
        ? await this.app.vault.modify(r, n)
        : await this.app.vault.create(e.jsonPath, n);
    }),
    (qe.renderResearchProjectToolbar = async function (e) {
      let s = e.querySelector(".exp-board-tools");
      if (!s || s.querySelector(".project-profile-project-select")) return;
      let i = await this.loadProjectProfileSummary(),
        r = { id: i.ctx.projectId, title: i.summary.title || i.ctx.title },
        n = s.createEl("select", {
          cls: "scholarium-btn project-profile-project-select",
          attr: {
            title: `\u7814\u7A76\u8BFE\u9898\uFF1A${r.id} \xB7 ${r.title}`,
            "aria-label": "\u7814\u7A76\u8BFE\u9898",
          },
        });
      n.createEl("option", {
        text: "\u5168\u90E8\u8BB0\u5F55",
        attr: { value: "__all" },
      }),
        n.createEl("option", {
          text: "\u672A\u5F52\u7C7B",
          attr: { value: "__unclassified" },
        }),
        (() => {
          let a = (this.plugin.settings.experimentsFolder || "Experiments").replace(/\/+$/, "") + "/Projects", l = this.app.vault.getAbstractFileByPath(a), p = new Set([String(r.id).toUpperCase()]);
          for (let c of schUnifiedProjectCatalog(this)) { if (p.has(c.id)) continue; p.add(c.id); n.createEl("option", { text: c.id + " \xB7 " + c.title, attr: { value: c.id } }); }
        })(),
        n.createEl("option", {
        text: `${r.id} \xB7 ${r.title}`,
        attr: { value: i.ctx.projectId },
      }),
        (n.value = this.experimentProjectFilter || "__all"),
        (n.onchange = async () => {
          let a = n.value;
          if (a === "__all" || a === "__unclassified") {
            this.experimentProjectFilter = a === "__all" ? "" : a;
            await this.refreshResearchDashboard(e);
            return;
          }
          this.experimentProjectFilter = a;
          if (a !== i.ctx.projectId) {
            n.disabled = !0;
            try {
              await this.plugin.updateData((l) => {
                (l.projectWorkspace = {
                  ...gs(l.projectWorkspace),
                  activeProjectId: a,
                }),
                  (l.rssBoard = {
                    ...gs(l.rssBoard),
                    researchProjectId: a,
                    researchProfilePath:
                      (
                        this.plugin.settings.experimentsFolder || "Experiments"
                      ).replace(/\/+$/, "") +
                      "/Projects/" +
                      a +
                      "/project.md",
                  });
              }),
                await this.refreshResearchDashboard(e),
                new Le.Notice(
                  "\u5DF2\u5207\u6362\u7814\u7A76\u8BFE\u9898\uFF1A" + a,
                );
            } catch (l) {
              (n.disabled = !1),
                new Le.Notice(
                  "\u5207\u6362\u8BFE\u9898\u5931\u8D25\uFF1A" + ms(l),
                );
            }
          }
        }),
        (() => {
          let a = s.createEl("button", { cls: "scholarium-btn", text: "+ \u65B0\u5EFA\u8BFE\u9898", attr: { title: "\u521B\u5EFA\u65B0\u7684\u7814\u7A76\u8BFE\u9898\u5E76\u5207\u6362\u5230\u5B83" } });
          a.onclick = async () => {
            let l = await schPromptText("\u65B0\u8BFE\u9898\u540D\u79F0", "");
            if (!(l = String(l || "").trim())) return;
            let c = (this.plugin.settings.experimentsFolder || "Experiments").replace(/\/+$/, ""), h = c + "/Projects", d = this.app.vault.getAbstractFileByPath(h), p = new Set();
            for (let v of schUnifiedProjectCatalog(this)) /^PRJ-\d+$/i.test(v.id) && p.add(v.id.toUpperCase());
            let u = 1, g;
            do g = "PRJ-" + String(u++).padStart(3, "0"); while (p.has(g));
            let m = "Research/Projects/" + g + ".md",
              x = schEvidenceTools(this.plugin).schema.uuidV7(),
              T = new Date().toISOString();
            a.disabled = !0;
            try {
              let w = "Research/ProjectProfiles/" + g;
              this.app.vault.getAbstractFileByPath("Research/Projects") || (await this.app.vault.createFolder("Research/Projects"));
              this.app.vault.getAbstractFileByPath(w) || (await this.app.vault.createFolder(w));
              let y = "---\nuid: \"" + x + "\"\ndisplay_id: \"" + g + "\"\nschema_version: 1\ntype: \"project\"\ncreated_at: \"" + T + "\"\nupdated_at: \"" + T + "\"\ntitle: " + JSON.stringify(l) + "\nstatus: \"active\"\nstage: \"P0\"\nthesis: \"\"\nactive_hypothesis_uids: []\nlegacy_hypothesis_summaries: []\ncurrent_problems: []\nmethods_needed: []\nexcluded_topics: []\nprimary_system: \"\"\nsecondary_system: \"\"\nwavelengths: []\nnext_gate: \"\"\ntags: []\n---\n\n# " + l + "\n\n";
              await this.app.vault.create(m, y);
              await this.app.vault.create(w + "/profile-v0.md", "---\nschema_version: 1\ncreated_at: \"" + T + "\"\nupdated_at: \"" + T + "\"\nartifact: \"project_profile\"\nproject_uid: \"" + x + "\"\nproject_display_id: \"" + g + "\"\nprofile_version: 0\nresearch_question: " + JSON.stringify(l) + "\nboundaries:\n  do: []\n  dont: []\ncore_concepts: []\nkeywords_zh: []\nkeywords_en: []\nconstraints: []\nknown: []\nunknown: []\ncontroversial: []\nsuccess_criteria: \"\"\nrevision_note: \"由 Scholarium 手动创建课题生成。\"\n---\n\n# " + g + " · 课题画像 v0\n\n## 研究问题\n\n" + l + "\n\n> 本画像由手动创建生成。v0 是进入 P1 前的起点，不代表文献或实验已经证实其中内容。\n");
              await this.plugin.updateData((v) => { v.projectWorkspace = { ...gs(v.projectWorkspace), activeProjectId: g }; v.rssBoard = { ...gs(v.rssBoard), researchProjectId: g }; });
              await this.refreshResearchDashboard(e), new Le.Notice("\u5DF2\u521B\u5EFA\u5E76\u5207\u6362\u5230\u8BFE\u9898\uFF1A" + g);
            } catch (v) { new Le.Notice("\u521B\u5EFA\u8BFE\u9898\u5931\u8D25\uFF1A" + ms(v)); a.disabled = !1; }
          };
          s.prepend(a, n);
        })();
    }),
    (qe.refreshResearchDashboard = async function (e) {
      (this.allExperiments = await this.getExperiments()),
        this.updateStats(),
        this.renderExpList(),
        e.isConnected &&
          (await this.renderExperimentDashboard(
            e,
            this.getFilteredExperiments(),
          ));
    }),
    (qe.renderProjectProfileBanner = async function (e) {
      let s = await this.loadProjectProfileSummary(),
        { ctx: i, summary: r } = s,
        n = await this.loadProjectRoadmap(i),
        a = je(r.wavelengths).slice(0, 2).join(" \u2194 "),
        l = e.createEl("section", {
          cls: `project-profile-banner${r.hasProfile ? "" : " is-empty"}`,
        }),
        c = l.createDiv({ cls: "project-profile-copy" });
      c.createDiv({
        cls: "project-profile-kicker",
        text: `Project Profile \xB7 ${r.projectId}`,
      }),
        c.createEl("h2", { text: r.title || i.title }),
        c.createEl("p", {
          text: r.hasProfile
            ? r.thesis
            : "\u5F53\u524D\u8BFE\u9898\u8FD8\u6CA1\u6709\u751F\u6210\u6216\u586B\u5199\u8BFE\u9898\u753B\u50CF\u3002",
        });
      let h = c.createDiv({ cls: "project-profile-tags" });
      if (
        (h.createSpan({
          text: `${r.status === "active" ? "Active" : r.status}${r.priority ? " \xB7 " + r.priority : ""}`,
        }),
        r.hasProfile &&
          r.primarySystem &&
          h.createSpan({ text: r.primarySystem }),
        r.hasProfile)
      )
        for (let g of je(r.wavelengths)) h.createSpan({ text: g });
      r.hasProfile &&
        je(r.tags).some((g) => /redox/i.test(g)) &&
        h.createSpan({ text: "Paired Redox" }),
        r.hasProfile &&
          a &&
          c.createDiv({ cls: "project-profile-watermark", text: a });
      let d = l.createDiv({ cls: "project-profile-summary-grid" }),
        p = (g, m) => {
          let v = d.createDiv();
          v.createEl("small", { text: g }),
            v.createEl("strong", { text: m || "\u5F85\u8865\u5145" });
        };
      p("\u5F53\u524D\u9636\u6BB5", r.stage),
        p(
          "\u753B\u50CF\u6210\u719F\u5EA6",
          r.progress === null ? "\u5F85 AI \u8BC4\u4F30" : `${r.progress}%`,
        ),
        p(
          "Roadmap",
          n.stats.total
            ? `${n.stats.done}/${n.stats.total} \xB7 ${n.stats.percent}%`
            : "\u5F85\u5EFA\u7ACB",
        ),
        p("\u4E0B\u4E00\u95F8\u95E8", r.nextGate);
      let u = l.createDiv({ cls: "project-profile-actions" });
      (u.createEl("button", {
        cls: "scholarium-btn primary",
        text: r.hasProfile
          ? "\u6253\u5F00\u8BFE\u9898\u753B\u50CF"
          : "\u65B0\u5EFA\u8BFE\u9898\u753B\u50CF",
      }).onclick = () => {
        this.openProjectProfileDrawer(r.hasProfile ? "overview" : "edit").catch((g) =>
          new Le.Notice("打开课题画像失败：" + ms(g)),
        );
      }),
        (u.createEl("button", {
          cls: "scholarium-btn",
          text: "\u7F16\u8F91\u753B\u50CF\u5185\u5BB9",
        }).onclick = () => {
          this.openProjectProfileDrawer("edit").catch((g) =>
            new Le.Notice("打开画像编辑失败：" + ms(g)),
          );
        }),
        (u.createEl("button", {
          cls: "scholarium-btn",
          text: "\uD83E\uDD16 AI \u8BC4\u4F30\u753B\u50CF",
          attr: { title: "根据旧课题正文、画像和 Roadmap 评估成熟度并写回" },
        }).onclick = async (g) => {
          let m = g.currentTarget,
            v = m.textContent;
          m.disabled = !0;
          try {
            m.setText("AI 评估中…");
            let f = await this.evaluateProjectProfileWithAI(i, r);
            new Le.Notice(`AI 评估完成：${f.progress}%${f.reason ? " · " + f.reason : ""}`);
            await this.refreshResearchDashboard(e);
          } catch (f) {
            new Le.Notice("AI 评估失败：" + ms(f));
          } finally {
            m.disabled = !1;
            m.setText(v);
          }
        }),
        (u.createEl("button", {
          cls: "scholarium-btn",
          text: n.file ? "\u6253\u5F00 Roadmap" : "\u65B0\u5EFA Roadmap",
        }).onclick = () => {
          this.openProjectProfileDrawer("roadmap").catch((g) =>
            new Le.Notice("打开 Roadmap 失败：" + ms(g)),
          );
        });
    }),
    (qe.openProjectProfileDrawer = async function (e = "overview") {
      let s = await this.loadProjectProfileSummary(),
        i = s.ctx,
        r = s.summary,
        n = s.profileFile,
        a =
          this.getProjectProfileFile(i.detailPath) ||
          this.getProjectProfileFile(i.projectPath);
      if (
        (!n && e === "edit" && (n = await this.ensureProjectProfileFile(i, r)),
        !n && e !== "edit" && a && (n = a),
        !n)
      ) {
        new Le.Notice(
          "\u5F53\u524D\u8BFE\u9898\u8FD8\u6CA1\u6709\u8BFE\u9898\u753B\u50CF\u3002",
        );
        return;
      }
      a = a || n;
      let l = await this.loadProjectRoadmap(i),
        c = "",
        h = "",
        d = "",
        p = "",
        u = bi(r);
      try {
        c = await this.app.vault.cachedRead(n);
        let O = fs(c);
        (r = $r(Mr(i, Lr(c)), Rr(i, O.body), r)),
          (u = bi(r)),
          (p = O.body),
          (h = await this.app.vault.cachedRead(a)),
          (d = l.text);
      } catch (O) {
        new Le.Notice(
          "\u8BFE\u9898\u753B\u50CF\u8BFB\u53D6\u5931\u8D25\uFF1A" + ms(O),
        );
        return;
      }
      let g = document.createElement("div");
      g.className = "project-profile-overlay";
      let m = g.createDiv({ cls: "project-profile-drawer" });
      m.setAttribute("role", "dialog"), m.setAttribute("aria-modal", "true");
      let v = () => {
          g.remove(), document.removeEventListener("keydown", f);
        },
        f = (O) => {
          O.key === "Escape" && v();
        };
      document.addEventListener("keydown", f),
        (g.onmousedown = (O) => {
          O.target === g && v();
        });
      let w = m.createEl("header", { cls: "project-profile-drawer-header" }),
        b = w.createDiv();
      b.createEl("small", {
        text: `Research Project Profile \xB7 ${u.projectId}`,
      }),
        b.createEl("h2", { text: u.title || i.title }),
        b.createEl("p", {
          text: "\u8BFE\u9898\u5DE5\u4F5C\u53F0\u5C06\u753B\u50CF\u53C2\u6570\u4E0E\u7814\u7A76\u8DEF\u7EBF\u56FE\u7EDF\u4E00\u7BA1\u7406\uFF1A\u5B57\u6BB5\u4FDD\u5B58\u5230\u8BFE\u9898\u753B\u50CF\uFF0C\u4EFB\u52A1\u53D8\u66F4\u81EA\u52A8\u540C\u6B65\u5230 Roadmap \u4E0E\u770B\u677F\u8FDB\u5EA6\u3002",
        });
      let y = w.createDiv({ cls: "project-profile-drawer-actions" });
      (y.createEl("button", {
        cls: "project-profile-icon-button",
        text: "\u2197",
        attr: {
          title: "\u5728 Obsidian \u4E2D\u6253\u5F00\u8BFE\u9898\u753B\u50CF",
          "aria-label":
            "\u5728 Obsidian \u4E2D\u6253\u5F00\u8BFE\u9898\u753B\u50CF",
        },
      }).onclick = () => {
        this.app.workspace.getLeaf("tab").openFile(n, { active: !0 });
      }),
        (y.createEl("button", {
          cls: "project-profile-close",
          text: "\xD7",
        }).onclick = v);
      let C = m.createEl("nav", { cls: "project-profile-tabs" }),
        S = m.createEl("main", { cls: "project-profile-body" }),
        k = e,
        A = (O, W, R) => {
          S.empty();
          let _ = S.createDiv({ cls: "project-profile-document-toolbar" }),
            K = _.createDiv();
          K.createEl("strong", { text: R.label }),
            K.createSpan({
              text: "\u7F16\u8F91\u89C6\u56FE",
              cls: "project-profile-document-mode is-editing",
            });
          let Z = _.createDiv({
              cls: "project-profile-document-toolbar-actions",
            }),
            j = Z.createEl("button", {
              cls: "scholarium-btn",
              text: "\u4FDD\u5B58\u4FEE\u6539",
            }),
            Q = Z.createEl("button", {
              cls: "scholarium-btn primary",
              text: "\u4FDD\u5B58\u5E76\u8FD4\u56DE\u9605\u8BFB\u89C6\u56FE",
            }),
            T = S.createDiv({ cls: "project-profile-document-editor" });
          T.createDiv({
            text: "\u76F4\u63A5\u7F16\u8F91\u5E76\u4FDD\u5B58\u5230\u5F53\u524D\u9879\u76EE\u6587\u4EF6",
            cls: "project-profile-document-editor-note",
          });
          let N = T.createEl("textarea", {
            cls: "project-profile-document-source",
          });
          N.value = O;
          let U = async (G = !1) => {
            try {
              (j.disabled = !0), (Q.disabled = !0);
              let ne = N.value;
              await R.save(ne),
                new Le.Notice(R.label + "\u5DF2\u4FDD\u5B58"),
                G ? L(ne, W, R) : ((j.disabled = !1), (Q.disabled = !1));
            } catch (ne) {
              (j.disabled = !1),
                (Q.disabled = !1),
                new Le.Notice("\u4FDD\u5B58\u5931\u8D25\uFF1A" + ms(ne));
            }
          };
          (j.onclick = () => {
            U(!1);
          }),
            (Q.onclick = () => {
              U(!0);
            });
        },
        L = async (O, W, R) => {
          var T;
          S.empty();
          let _ = S.createDiv({ cls: "project-profile-document-toolbar" }),
            K = _.createDiv();
          K.createEl("strong", { text: R.label }),
            K.createSpan({
              text: "\u9605\u8BFB\u89C6\u56FE",
              cls: "project-profile-document-mode",
            }),
            (_.createEl("button", {
              cls: "scholarium-btn",
              text: "\u7F16\u8F91\u5E76\u4FDD\u5B58",
            }).onclick = () => A(O, W, R));
          let Z = S.createDiv({
            cls: `project-profile-document-surface is-${R.kind || "detail"}`,
          });
          if (R.kind === "overview") {
            let N = Z.createDiv({ cls: "project-profile-brief" }),
              U = N.createDiv();
            U.createEl("small", { text: "PROJECT BRIEF" }),
              U.createEl("h3", { text: u.title || i.title }),
              U.createEl("p", {
                text:
                  u.thesis ||
                  "\u4EE5\u8BFE\u9898\u753B\u50CF\u5B9A\u4E49\u7814\u7A76\u547D\u9898\u4E0E\u9A8C\u8BC1\u8DEF\u5F84\u3002",
              });
            let G = N.createDiv({ cls: "project-profile-brief-metrics" });
            for (let [ne, de] of [
              ["\u5F53\u524D\u9636\u6BB5", u.stage],
              [
                "\u6210\u719F\u5EA6",
                u.progress === "" ? "\u5F85\u8BC4\u4F30" : u.progress + "%",
              ],
              ["\u6838\u5FC3\u4F53\u7CFB", u.primarySystem],
            ]) {
              let Re = G.createDiv();
              Re.createEl("small", { text: ne }),
                Re.createEl("strong", { text: de || "\u5F85\u8865\u5145" });
            }
          }
          let j =
              R.kind === "detail"
                ? Z.createDiv({ cls: "project-profile-document-layout" })
                : Z,
            Q = j.createDiv({
              cls: "project-profile-markdown markdown-rendered",
            });
          try {
            await Le.MarkdownRenderer.render(this.app, O, Q, W.path, this);
          } catch (N) {
            Q.setText(O);
          }
          for (let N of Array.from(Q.querySelectorAll("table"))) {
            let U = document.createElement("div");
            (U.className = "project-profile-table-scroll"),
              (U.tabIndex = 0),
              U.setAttribute("role", "region"),
              U.setAttribute(
                "aria-label",
                "\u5BBD\u8868\u683C\uFF0C\u53EF\u6A2A\u5411\u6EDA\u52A8\u67E5\u770B\u5168\u90E8\u5217",
              ),
              (T = N.parentElement) == null || T.insertBefore(U, N),
              U.appendChild(N);
          }
          if (R.kind === "detail") {
            let N = j.createEl("aside", {
              cls: "project-profile-document-outline",
            });
            N.createEl("small", { text: "DOCUMENT OUTLINE" }),
              N.createEl("h4", { text: "\u7AE0\u8282\u5BFC\u822A" });
            let U = Array.from(Q.querySelectorAll("h2,h3"));
            for (let [G, ne] of U.entries()) {
              ne.id = ne.id || "project-profile-heading-" + G;
              let de = N.createEl("button", {
                text: ne.textContent || "\u672A\u547D\u540D\u7AE0\u8282",
                cls: "project-profile-outline-item",
              });
              ne.tagName === "H3" && de.addClass("is-subsection"),
                (de.onclick = () =>
                  ne.scrollIntoView({ behavior: "smooth", block: "start" }));
            }
          }
        },
        I = () => {
          S.empty();
          let O = S.createDiv({ cls: "project-profile-form" }),
            W = (Z, j, Q = "text") => {
              var U;
              let T = O.createDiv({ cls: "project-profile-field" });
              T.createEl("label", { text: Z });
              let N =
                Q === "textarea"
                  ? T.createEl("textarea")
                  : T.createEl("input", { attr: { type: Q } });
              return (
                (N.value = Array.isArray(u[j])
                  ? u[j].join(", ")
                  : String((U = u[j]) != null ? U : "")),
                (N.oninput = () => {
                  let G = N.value;
                  j === "wavelengths" ||
                  j === "tags" ||
                  Vr.indexOf(j) >= 0
                    ? (u[j] = je(G))
                    : (u[j] = G);
                }),
                N
              );
            };
          W("\u8BFE\u9898\u540D\u79F0", "title"),
            W(
              "\u4E00\u53E5\u8BDD\u6838\u5FC3\u547D\u9898",
              "thesis",
              "textarea",
            ),
            W("\u72B6\u6001", "status"),
            W("\u4F18\u5148\u7EA7", "priority"),
            W("\u5F53\u524D\u9636\u6BB5", "stage"),
            W(
              "\u753B\u50CF\u6210\u719F\u5EA6\uFF08%\uFF09",
              "progress",
              "number",
            ),
            W("\u4E3B\u4F53\u7CFB", "primarySystem"),
            W("\u62D3\u5C55\u4F53\u7CFB", "secondarySystem"),
            W("\u5173\u952E\u6CE2\u957F / \u901A\u9053", "wavelengths"),
            W(
              "\u4E0B\u4E00\u9053\u9A8C\u8BC1\u95F8\u95E8",
              "nextGate",
              "textarea",
            ),
            W("\u9876\u90E8 tags\uFF08\u9017\u53F7\u5206\u9694\uFF09", "tags"),
            W(
              "\u5F53\u524D\u5047\u8BBE H1/H2\u2026\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u6587\u732E\u96F7\u8FBE\u7528\u5B83\u5224\u65AD\u201C\u652F\u6301/\u53CD\u9A73\u201D\uFF09",
              "hypotheses",
              "textarea",
            ),
            W(
              "\u5F53\u524D\u5361\u70B9 / \u5F85\u89E3\u51B3\u95EE\u9898\uFF08\u9017\u53F7\u5206\u9694\uFF09",
              "currentProblems",
              "textarea",
            ),
            W(
              "\u9700\u8981\u5F15\u5165\u4F46\u5C1A\u672A\u638C\u63E1\u7684\u65B9\u6CD5\uFF08\u9017\u53F7\u5206\u9694\uFF09",
              "methodsNeeded",
              "textarea",
            ),
            W(
              "\u660E\u786E\u6392\u9664\u7684\u65B9\u5411\uFF08\u9017\u53F7\u5206\u9694\uFF0C\u547D\u4E2D\u5219\u964D\u6743\uFF09",
              "excludedTopics",
              "textarea",
            );
          let R = O.createEl("details", { cls: "project-profile-raw-details" });
          R.createEl("summary", {
            text: "\u9AD8\u7EA7\uFF1A\u7F16\u8F91\u753B\u50CF\u6587\u4EF6\u6B63\u6587 Markdown",
          });
          let _ = R.createEl("textarea", { cls: "project-profile-editor" });
          (_.value = p),
            (_.oninput = () => {
              p = _.value;
            });
          let K = S.createDiv({ cls: "project-profile-save-row" }),
            Ex = K.createEl("button", {
              cls: "scholarium-btn",
              text: "\uD83E\uDD16 \u4ECE\u5B8C\u6574\u8BFE\u9898\u5185\u5BB9\u62BD\u753B\u50CF",
            });
          Ex.onclick = async () => {
            Ex.disabled = !0;
            let Z = Ex.textContent;
            Ex.setText("\u62BD\u53D6\u4E2D\u2026");
            try {
              let j = await this.extractProfileWithAI(i, u);
              j
                ? (Object.assign(u, j),
                  new Le.Notice(
                    "\u5DF2\u62BD\u53D6\u5E76\u56DE\u586B\uFF0C\u8BF7\u6838\u5BF9\u540E\u70B9\u300C\u4FDD\u5B58\u753B\u50CF\u5B57\u6BB5\u300D",
                  ),
                  I())
                : new Le.Notice("\u672A\u62BD\u53D6\u5230\u53EF\u7528\u5B57\u6BB5");
            } catch (j) {
              new Le.Notice("\u62BD\u53D6\u5931\u8D25\uFF1A" + ms(j));
            } finally {
              (Ex.disabled = !1), Ex.setText(Z);
            }
          };
          (K.createEl("button", {
            cls: "scholarium-btn primary",
            text: "\u4FDD\u5B58\u753B\u50CF\u5B57\u6BB5",
          }).onclick = async () => {
            try {
              let Z = bo(u) + zd(p, u);
              i.schemaProject
                ? await schSaveFormalProjectProfile(this, i, n, u, p)
                : await this.app.vault.modify(n, Z),
                (c = Z),
                (p = fs(Z).body),
                await this.syncProjectProfileJson(i, u),
                new Le.Notice("\u8BFE\u9898\u753B\u50CF\u5DF2\u4FDD\u5B58"),
                H("overview"),
                this.detailPanel &&
                  this.renderExperimentDashboard(
                    this.detailPanel,
                    this.getFilteredExperiments(),
                  );
            } catch (Z) {
              new Le.Notice(
                "\u4FDD\u5B58\u8BFE\u9898\u753B\u50CF\u5931\u8D25\uFF1A" +
                  ms(Z),
              );
            }
          }),
            K.createEl("p", {
              cls: "project-profile-editor-note",
              text: "\u5B57\u6BB5\u4F1A\u5199\u5165\u540C\u4E00 Markdown \u6587\u4EF6\u7684 frontmatter\uFF0C\u5E76\u540C\u6B65\u66F4\u65B0\u6B63\u6587\u201C\u753B\u50CF\u6458\u8981\u201D\u3002",
            });
        },
        B = () => {
          if (
            (S.empty(),
            S.createDiv({
              cls: "project-profile-editor-note",
              text: "\u5728\u6B64\u4FEE\u6539 Roadmap \u5E76\u4FDD\u5B58\uFF1B\u6E05\u5355\u4E2D - [x] / - [ ] \u4F1A\u53CD\u6620\u5230\u770B\u677F\u8FDB\u5EA6\u3002",
            }),
            !l.file)
          ) {
            S.createEl("button", {
              cls: "scholarium-btn primary",
              text: "\u65B0\u5EFA Roadmap",
            }).onclick = async () => {
              try {
                let _ = await this.app.vault.create(
                  i.roadmapPath,
                  `# Roadmap

- [ ] \u7B2C\u4E00\u4E2A\u91CC\u7A0B\u7891
`,
                );
                (l = {
                  file: _,
                  text: await this.app.vault.cachedRead(_),
                  stats: _r("- [ ] \u7B2C\u4E00\u4E2A\u91CC\u7A0B\u7891"),
                }),
                  (d = l.text),
                  H("roadmap");
              } catch (_) {
                new Le.Notice(
                  "\u65B0\u5EFA Roadmap \u5931\u8D25\uFF1A" + ms(_),
                );
              }
            };
            return;
          }
          let O = S.createEl("textarea", {
            cls: "project-profile-editor project-profile-roadmap-editor",
          });
          O.value = d;
          let W = S.createDiv({ cls: "project-profile-save-row" }),
            R = W.createEl("button", {
              cls: "scholarium-btn primary",
              text: "\u4FDD\u5B58 Roadmap",
            });
          (W.createEl("button", {
            cls: "scholarium-btn",
            text: "\u5728 Obsidian \u4E2D\u6253\u5F00",
          }).onclick = () => {
            this.app.workspace.getLeaf("tab").openFile(l.file, { active: !0 });
          }),
            (R.onclick = async () => {
              try {
                (R.disabled = !0),
                  R.setText("\u4FDD\u5B58\u4E2D\u2026"),
                  (d = O.value),
                  await this.app.vault.modify(l.file, d),
                  (l = { file: l.file, text: d, stats: _r(d) }),
                  new Le.Notice(
                    "Roadmap \u5DF2\u4FDD\u5B58\uFF0C\u8FDB\u5EA6\u5DF2\u66F4\u65B0",
                  ),
                  this.detailPanel &&
                    (await this.renderExperimentDashboard(
                      this.detailPanel,
                      this.getFilteredExperiments(),
                    )),
                  (R.disabled = !1),
                  R.setText("\u4FDD\u5B58 Roadmap");
              } catch (_) {
                (R.disabled = !1),
                  R.setText("\u4FDD\u5B58 Roadmap"),
                  new Le.Notice(
                    "\u4FDD\u5B58 Roadmap \u5931\u8D25\uFF1A" + ms(_),
                  );
              }
            });
        },
        H = (O) => {
          (k = O === "roadmap" ? "edit" : O),
            Array.from(C.children).forEach((W) =>
              W.toggleClass("active", W.dataset.tab === k),
            ),
            O === "overview"
              ? L(c, n, {
                  label: "\u8BFE\u9898\u753B\u50CF\u603B\u89C8",
                  kind: "overview",
                  save: async (W) => {
                    await this.app.vault.modify(n, W), (c = W);
                    let R = fs(W);
                    (p = R.body),
                      (u = bi($r(Mr(i, Lr(W)), Rr(i, R.body), r))),
                      await this.syncProjectProfileJson(i, u),
                      this.detailPanel &&
                        (await this.renderExperimentDashboard(
                          this.detailPanel,
                          this.getFilteredExperiments(),
                        ));
                  },
                })
              : O === "detail"
                ? L(h, a, {
                    label: "\u5B8C\u6574\u8BFE\u9898\u5185\u5BB9",
                    kind: "detail",
                    save: async (W) => {
                      await this.app.vault.modify(a, W),
                        (h = W),
                        a.path === n.path && ((c = W), (p = fs(W).body)),
                        this.detailPanel &&
                          (await this.renderExperimentDashboard(
                            this.detailPanel,
                            this.getFilteredExperiments(),
                          ));
                    },
                  })
                : O === "roadmap"
                  ? B()
                  : I();
        };
      for (let [O, W] of [
        ["overview", "\u753B\u50CF\u603B\u89C8"],
        ["detail", "\u5B8C\u6574\u8BFE\u9898\u5185\u5BB9"],
        ["edit", "\u7F16\u8F91\u753B\u50CF\u5B57\u6BB5"],
        ["roadmap", "Roadmap"],
      ]) {
        let R = C.createEl("button", { text: W });
        (R.dataset.tab = O), (R.onclick = () => H(O));
      }
      document.body.appendChild(g),
        requestAnimationFrame(() => g.addClass("is-open")),
        H(k);
    }),
    (qe.renderExperimentDashboard = async function (e, s) {
      var i;
      await o.call(this, e, s);
      try {
        await this.renderResearchProjectToolbar(e);
        let r = e.querySelector(
          ".exp-board-stats,.exp-board-empty,.exp-card-dashboard",
        );
        if (!r || e.querySelector(".project-profile-banner")) return;
        let n = document.createElement("div");
        (i = r.parentNode) == null || i.insertBefore(n, r),
          await this.renderProjectProfileBanner(n);
      } catch (r) {
        console.warn("[Scholarium] project profile banner failed:", r);
      }
    });
}
Wd();
// Project objects created by Weaver live in Research/Projects, while the
// original experiment dashboard only knew about Experiments/Projects.  Keep a
// single, merged registry so a promoted PRJ becomes available everywhere as
// soon as its schema-v1 Markdown object is written.  Formal objects win over a
// legacy folder with the same id; the legacy folder remains available for its
// optional Roadmap/detail documents.
function schFormalProjectId(o, t) {
  if (!o || !/^Research\/Projects\/[^/]+\.md$/i.test(String(o.path || "")))
    return "";
  let e = String((t || {}).display_id || (t || {}).project_id || "").trim(),
    s = String(o.basename || o.name || "").match(/^(PRJ-\d+)/i);
  // Obsidian can render the dashboard before metadataCache has populated the
  // frontmatter for a newly migrated Project.  The stable PRJ filename is a
  // safe fallback; it is still restricted to Research/Projects/*.md.
  if (!e && s) e = s[1];
  if (String((t || {}).type || "").toLowerCase() !== "project" && !s) return "";
  return /^PRJ-\d+$/i.test(e) ? e.toUpperCase() : "";
}
function schLatestFormalProfile(o, t) {
  let e = `Research/ProjectProfiles/${t}`,
    s = o.app.vault.getAbstractFileByPath(e),
    i = ((s == null ? void 0 : s.children) || [])
      .filter((r) => r.extension === "md" && /^profile-v\d+\.md$/i.test(r.name))
      .sort((r, n) => {
        let a = Number((r.name.match(/profile-v(\d+)/i) || [])[1]) || 0,
          l = Number((n.name.match(/profile-v(\d+)/i) || [])[1]) || 0;
        return l - a || n.stat.mtime - r.stat.mtime;
      });
  return i[0] || null;
}
function schUnifiedProjectCatalog(o) {
  let t = new Map(),
    e = (n, a) => {
      let l = String(n || "").trim();
      l && t.set(l.toUpperCase(), { ...(t.get(l.toUpperCase()) || {}), ...a, id: l.toUpperCase() });
    },
    s = (o.plugin.settings.experimentsFolder || "Experiments").replace(/\/+$/, "") + "/Projects",
    i = o.app.vault.getAbstractFileByPath(s);
  for (let n of (i == null ? void 0 : i.children) || []) {
    if (!n.children) continue;
    let a = o.app.vault.getAbstractFileByPath(s + "/" + n.name + "/project.md"),
      l = (a && o.app.metadataCache.getFileCache(a).frontmatter) || {};
    e(n.name, { title: String(l.title || n.name), legacyFolder: n, legacyProjectFile: a || null });
  }
  for (let n of o.app.vault.getMarkdownFiles()) {
    let a = (o.app.metadataCache.getFileCache(n) || {}).frontmatter || {},
      l = schFormalProjectId(n, a);
    if (!l) continue;
    e(l, {
      title: String(a.title || l).trim() || l,
      uid: String(a.uid || "").trim(),
      formalFile: n,
      formalProfileFile: schLatestFormalProfile(o, l),
    });
  }
  return Array.from(t.values()).sort((n, a) =>
    n.id.localeCompare(a.id, void 0, { numeric: !0, sensitivity: "base" }),
  );
}
function schExistingMarkdown(o, t) {
  for (let e of t || []) {
    let s = o.app.vault.getAbstractFileByPath(String(e || "").replace(/\\/g, "/"));
    if (s instanceof Le.TFile && s.extension === "md") return s;
  }
  return null;
}
function schProjectPathCandidates(o, t, e) {
  let s = (o.plugin.settings.experimentsFolder || "Experiments").replace(/\/+$/, ""),
    i = `${s}/Projects/${t}`,
    r = `Research/ProjectProfiles/${t}`;
  return {
    legacyRoot: i,
    formalRoot: r,
    profile: [`${r}/profile-v0.md`, `${r}/profile.md`, `${i}/00_课题画像.md`],
    detail: [`${i}/01_完整课题内容.md`, `${i}/project.md`, `${r}/detail.md`],
    roadmap: [`${i}/02_Roadmap.md`, `${i}/roadmap.md`, `${r}/roadmap.md`, `${r}/02_Roadmap.md`],
    project: [`Research/Projects/${t}.md`, `${i}/project.md`],
  }[e] || [];
}
async function schSaveFormalProjectProfile(o, t, e, s, i) {
  let r = o.getProjectProfileFile(t.projectPath);
  if (!(r instanceof Le.TFile)) throw new Error("未找到正式课题文件：" + t.projectPath);
  await o.app.fileManager.processFrontMatter(r, (n) => {
    n.title = s.title || n.title || t.projectId;
    n.thesis = s.thesis || "";
    n.status = s.status || n.status || "active";
    s.priority ? (n.priority = s.priority) : delete n.priority;
    n.stage = s.stage || "";
    s.progress === "" || s.progress === null || s.progress === void 0
      ? delete n.progress
      : (n.progress = Number(s.progress) || 0);
    n.primary_system = s.primarySystem || "";
    n.secondary_system = s.secondarySystem || "";
    n.wavelengths = je(s.wavelengths);
    n.next_gate = s.nextGate || "";
    n.tags = je(s.tags);
    n.current_problems = je(s.currentProblems);
    n.methods_needed = je(s.methodsNeeded);
    n.excluded_topics = je(s.excludedTopics);
    n.updated_at = new Date().toISOString();
  });
  let n = await o.app.vault.cachedRead(e),
    a = fs(n),
    l = `---\n${a.frontmatter}\n---\n\n${zd(i, s)}`;
  await o.app.vault.modify(e, l);
  await o.app.fileManager.processFrontMatter(e, (c) => {
    c.schema_version = Number(c.schema_version) || 1;
    c.artifact = c.artifact || "project_profile";
    c.project_uid = c.project_uid || t.projectUid || "";
    c.project_display_id = c.project_display_id || t.projectId;
    c.updated_at = new Date().toISOString();
  });
}

let schLegacyProjectProfileContext = qe.projectProfileContext;
qe.projectProfileContext = async function () {
  let o = {};
  try {
    o = gs(await this.plugin.loadData());
  } catch (p) {
    console.warn("[Scholarium] project data read failed:", p);
  }
  let t = gs(o.projectWorkspace),
    e = gs(o.rssBoard),
    s =
      (be(e.researchProjectId) &&
      e.researchProjectId !== "UNCLASSIFIED" &&
      (!be(t.activeProjectId) || t.activeProjectId === "UNCLASSIFIED")
        ? e.researchProjectId
        : "") ||
      (be(t.activeProjectId) ? t.activeProjectId : "") ||
      (be(e.researchProjectId) ? e.researchProjectId : "") ||
      "PRJ-001",
    i = String(s).trim().toUpperCase(),
    r = await schUnifiedProjectCatalog(this),
    n = r.find((p) => p.id === i);
  if (!n) return schLegacyProjectProfileContext.call(this);
  let a = (this.plugin.settings.experimentsFolder || "Experiments").replace(/\/+$/, "") + "/Projects/" + i,
    l = n.legacyFolder ? a : `Research/ProjectProfiles/${i}`,
    c = schExistingMarkdown(this, [`${a}/00_课题画像.md`]),
    h0 = schExistingMarkdown(this, [`Research/ProjectProfiles/${i}/profile-v0.md`, `Research/ProjectProfiles/${i}/profile.md`]),
    h = n.legacyFolder && c ? c : n.formalProfileFile || h0 || c || null,
    d = n.formalFile || n.legacyProjectFile || schExistingMarkdown(this, schProjectPathCandidates(this, i, "project")),
    f = schExistingMarkdown(this, schProjectPathCandidates(this, i, "detail")),
    g = schExistingMarkdown(this, schProjectPathCandidates(this, i, "roadmap")),
    m = n.formalFile ? `Research/ProjectProfiles/${i}/profile-v0.md` : a + "/00_课题画像.md",
    x = n.formalFile ? `Research/ProjectProfiles/${i}/roadmap.md` : a + "/02_Roadmap.md";
  return {
    projectId: i,
    projectUid: n.uid || "",
    folder: l,
    title: n.title || i,
    profilePath: h ? h.path : m,
    jsonPath: n.formalFile ? `Research/ProjectProfiles/${i}/project_profile.json` : a + "/project_profile.json",
    detailPath: f ? f.path : d ? d.path : a + "/01_完整课题内容.md",
    roadmapPath: g ? g.path : x,
    projectPath: d ? d.path : a + "/project.md",
    schemaProject: !!n.formalFile,
  };
};

qe.loadProjectProfileSummary = async function () {
  let o = await this.projectProfileContext(),
    t = $s(o),
    e = this.getProjectProfileFile(o.profilePath),
    s = this.getProjectProfileFile(o.projectPath);
  // Obsidian can retain a TFile in its cache briefly after a folder was moved
  // or removed outside the app.  Treat that stale handle as missing; otherwise
  // the drawer tries cachedRead() and reports ENOENT instead of rebuilding the
  // formal profile sidecar from the Project object.
  if (e)
    try {
      let p = this.app.vault.adapter;
      p && typeof p.exists == "function" && !(await p.exists(e.path)) && (e = null);
    } catch (p) {}
  try {
    let i = null,
      r = null,
      n = null,
      a = null;
    if (s) {
        let p = await this.app.vault.cachedRead(s),
        u = {
          ...Lr(p),
          ...((this.app.metadataCache.getFileCache(s) || {}).frontmatter || {}),
        };
      i = Mr(o, u);
    }
    !e && o.schemaProject && (e = await this.ensureProjectProfileFile(o, i || t));
    if (e) {
      let p = await this.app.vault.cachedRead(e),
        u = {
          ...Lr(p),
          ...((this.app.metadataCache.getFileCache(e) || {}).frontmatter || {}),
        };
      !u.project_id && u.project_display_id && (u.project_id = u.project_display_id),
        !u.thesis && u.research_question && (u.thesis = u.research_question),
        !u.title && (u.title = o.title),
        (r = Mr(o, u)),
        (n = Rr(o, fs(p).body));
    }
    let l = this.app.vault.getAbstractFileByPath(o.jsonPath);
    l instanceof Le.TFile && (a = jd(o, JSON.parse(await this.app.vault.cachedRead(l))));
    t = o.schemaProject ? $r(i || t, r, n, a) : $r(r || i || t, n, a, i);
    if (o.schemaProject && o.projectUid) {
      let p = this.app.vault.getMarkdownFiles()
        .map((u) => ({ file: u, fm: (this.app.metadataCache.getFileCache(u) || {}).frontmatter || {} }))
        .filter((u) => u.fm.type === "hypothesis" && String(u.fm.project_uid || "") === o.projectUid)
        .map((u) => String(u.fm.statement || u.fm.title || "").trim())
        .filter(Boolean);
      p.length && (t.hypotheses = p), (t.hasProfile = Br(t));
    }
  } catch (i) {
    console.warn("[Scholarium] project profile read failed:", i);
  }
  return { ctx: o, summary: t, profileFile: e };
};

let schLegacyRadarProjectOptions = Ys.prototype.loadRadarProjectOptions;
Ys.prototype.loadRadarProjectOptions = async function () {
  let o = new Map((await schLegacyRadarProjectOptions.call(this)).map((e) => [String(e.id).toUpperCase(), e])),
    t = await schUnifiedProjectCatalog(this);
  for (let e of t) {
    if (!e.formalFile) continue;
    let s = "",
      i = e.formalProfileFile;
    try {
      s = await this.app.vault.cachedRead(e.formalFile);
      i && (s += "\n\n" + (await this.app.vault.cachedRead(i)));
    } catch (r) {
      console.warn("[Scholarium] formal project profile read failed:", e.id, r);
    }
    o.set(e.id, {
      id: e.id,
      profileId: e.id,
      title: e.title,
      file: i || e.formalFile,
      version: this.profileFingerprint(s),
      hasProfile: !!s.trim(),
      text: s,
    });
  }
  return Array.from(o.values()).sort((e, s) => e.id.localeCompare(s.id, void 0, { numeric: !0, sensitivity: "base" }));
};

let schLegacyGetExperiments = qe.getExperiments;
qe.getExperiments = async function () {
  let o = await schLegacyGetExperiments.call(this),
    t = new Map();
  for (let e of await schUnifiedProjectCatalog(this)) e.uid && t.set(e.uid, e.id);
  for (let e of o) {
    if (e.projectId) continue;
    let s = (this.app.metadataCache.getFileCache(e.file) || {}).frontmatter || {};
    if (!s.project_uid)
      try {
        let r = await this.app.vault.cachedRead(e.file),
          n = Le.getFrontMatterInfo(r);
        n.exists && (s = Le.parseYaml(n.frontmatter) || s);
      } catch (r) {}
    let
      i = t.get(String(s.project_uid || ""));
    i && (e.projectId = i);
  }
  return o;
};

let schLegacySyncProjectProfileJson = qe.syncProjectProfileJson;
qe.syncProjectProfileJson = async function (o, t) {
  if (o.schemaProject) return;
  return schLegacySyncProjectProfileJson.call(this, o, t);
};

let schLegacyEnsureProjectProfileFile = qe.ensureProjectProfileFile;
qe.ensureProjectProfileFile = async function (o, t) {
  if (!o.schemaProject) return schLegacyEnsureProjectProfileFile.call(this, o, t);
  let e = this.getProjectProfileFile(o.profilePath);
  let d = !0;
  if (e)
    try {
      let h = this.app.vault.adapter;
      h && typeof h.exists == "function" && (d = await h.exists(e.path));
    } catch (h) {}
  if (e && d) return e;
  let s = "",
    r = String(o.profilePath || "").split("/").slice(0, -1).filter(Boolean),
    n = o.folder.split("/");
  for (let a of Array.from(new Set([].concat(n, r)))) {
    s = s ? s + "/" + a : a;
    this.app.vault.getAbstractFileByPath(s) || (await this.app.vault.createFolder(s));
  }
  let i = bi(t || $s(o)),
    a = new Date().toISOString(),
    l = (c) => {
      let h = je(c);
      return h.length ? "\n" + h.map((c) => "    - " + vt(c)).join("\n") : " []";
    },
    c = `---
schema_version: 1
created_at: ${vt(a)}
updated_at: ${vt(a)}
artifact: project_profile
project_uid: ${vt(o.projectUid)}
project_display_id: ${vt(o.projectId)}
profile_version: 0
research_question: ${vt(i.title)}
boundaries:
  do: []
  dont:${l(i.excludedTopics)}
core_concepts:${yo(i.tags)}
keywords_zh: []
keywords_en: []
constraints: []
known: []
unknown: []
controversial: []
success_criteria: ""
revision_note: "由 Scholarium 从正式 Project 自动补建；请在画像编辑器中继续完善。"
---

# ${i.projectId} · 课题画像 v0

${wo(i)}`;
  // Restore a stale cached TFile directly when its file was removed outside
  // Obsidian.  Calling vault.create() in that state reports "already exists"
  // while cachedRead() reports ENOENT, leaving the profile permanently
  // unusable.  Writing through the adapter restores the exact cached path.
  if (e && !d) {
    let h = this.app.vault.adapter;
    if (!h || typeof h.write != "function")
      throw new Error("无法恢复丢失的课题画像文件：Vault 适配器不可写");
    await h.write(o.profilePath, c);
    return e;
  }
  return this.app.vault.create(o.profilePath, c);
};
// The list uses permanent, non-hovering selection controls.  This deliberately
// replaces the earlier enter/exit batch-mode UI so cards never change width.
qe.renderExperimentAssignmentActions = function (e) {
  let s = this.expListActionsContainer;
  if (!s) return;
  s.empty();
  if (!e.length) return;
  this.experimentBulkSelection || (this.experimentBulkSelection = new Set());
  let i = s.createSpan({
      text: `\u5df2\u9009 ${this.experimentBulkSelection.size} \u6761`,
      cls: "exp-project-bulk-count",
    }),
    r = s.createEl("button", {
      text: "\u6279\u91cf\u5f52\u7c7b",
      cls: "scholarium-btn primary exp-project-bulk-toggle",
      attr: { title: "\u5148\u52fe\u9009\u8bb0\u5f55\uff0c\u518d\u9009\u62e9\u5f52\u5165\u54ea\u4e2a\u8bfe\u9898" },
    });
  r.disabled = this.experimentBulkSelection.size === 0;
  r.onclick = () => {
    let n = this.allExperiments.filter((a) =>
      this.experimentBulkSelection.has(a.file.path),
    );
    this.openExperimentProjectAssignment(n);
  };
};
qe.renderExpListItem = function (e, s) {
  var d, p;
  let i = s.noteType === "research-learning" ? "study" : s.status,
    r = e.createDiv({ cls: `exp-item status-${i}` });
  ((d = this.selectedExperiment) == null ? void 0 : d.file.path) ===
    s.file.path && r.addClass("selected");
  let n = {
    completed: "\u2705",
    "in-progress": "\u{1F504}",
    planned: "\u{1F4CB}",
    failed: "\u274C",
  };
  r.createEl("span", {
    text:
      s.noteType === "research-learning"
        ? "\u{1F4DA}"
        : (p = n[s.status]) != null
          ? p
          : "\u{1F52C}",
    cls: "exp-status-icon",
  });
  let a = r.createDiv({ cls: "exp-item-info" }),
    l = a.createDiv({ cls: "exp-item-title-row" });
  s.bookmarked && l.createEl("span", { text: "\u2605 ", cls: "exp-item-star" }),
    l.createEl("span", { text: s.title });
  let c = new Date(s.file.stat.mtime);
  a.createEl("div", {
    text: `${s.date} ${c.getHours().toString().padStart(2, "0")}:${c.getMinutes().toString().padStart(2, "0")}`,
    cls: "exp-item-date",
  });
  this.experimentBulkSelection || (this.experimentBulkSelection = new Set());
  let h = r.createDiv({ cls: "exp-item-actions" }),
    u = h.createEl("button", {
      cls: "exp-item-select-btn",
      attr: {
        "aria-label": "\u52fe\u9009\u6b64\u8bb0\u5f55\u7528\u4e8e\u6279\u91cf\u5f52\u7c7b",
      },
    }),
    g = this.experimentBulkSelection.has(s.file.path),
    m = () => {
      u.setText(g ? "\u2713" : ""),
        u.toggleClass("is-selected", g),
        u.setAttribute("aria-pressed", String(g)),
        u.setAttribute(
          "title",
          g
            ? "\u5df2\u9009\u4e2d\uff0c\u70b9\u51fb\u53ef\u53d6\u6d88"
            : "\u52fe\u9009\u6b64\u8bb0\u5f55\u7528\u4e8e\u6279\u91cf\u5f52\u7c7b",
        );
    };
  m(),
    (u.onclick = (v) => {
      v.stopPropagation(),
        (g = !g),
        g
          ? this.experimentBulkSelection.add(s.file.path)
          : this.experimentBulkSelection.delete(s.file.path),
        m(),
        this.renderExperimentAssignmentActions(this.getFilteredExperiments());
    });
  let projectButton = h.createEl("button", {
    text: "\u5f52\u7c7b",
    cls: "exp-item-project-assign-btn",
    attr: { title: "\u5c06\u6b64\u8bb0\u5f55\u5f52\u5165\u8bfe\u9898" },
  });
  projectButton.onclick = (v) => {
    v.stopPropagation();
    this.openExperimentProjectAssignment([s]);
  };
  let f = h.createEl("button", {
    text: "\u{1F5D1}",
    cls: "exp-item-del-btn",
    attr: { title: "\u5220\u9664\u8bb0\u5f55" },
  });
  (f.onclick = (v) => {
    v.stopPropagation(), this.confirmDeleteExperiment(s);
  }),
    (r.onclick = () => {
      var v;
      (this.selectedExperiment = s),
        (v = this.expListContainer) == null ||
          v.querySelectorAll(".exp-item").forEach((b) => b.removeClass("selected")),
        r.addClass("selected"),
        this.detailPanel && this.showDetail(this.detailPanel, s);
    });
};
// Keep the project picker stable.  The legacy renderer omitted the active
// project while enumerating folders and appended it afterwards, so merely
// changing the current project reordered the same menu.
let schStableProjectToolbarRenderer = qe.renderResearchProjectToolbar;
qe.renderResearchProjectToolbar = async function (e) {
  await schStableProjectToolbarRenderer.call(this, e);
  let s = e.querySelector(".project-profile-project-select");
  if (!s) return;
  let i = await this.loadProjectProfileSummary(),
    r = i.ctx || {},
    n = String(r.projectId || "").trim(),
    c = new Map(),
    h = (f, g) => {
      let m = String(f || "").trim();
      m && c.set(m.toUpperCase(), { id: m, title: String(g || m).trim() || m });
    };
  for (let f of await schUnifiedProjectCatalog(this)) h(f.id, f.title);
  h(n, (i.summary || {}).title || r.title || n);
  let u = this.experimentProjectFilter || s.value || "__all",
    d = (f, g) => s.createEl("option", { text: f, value: g }),
    v = Array.from(c.values())
      .filter((f) => f.id.toUpperCase() !== "UNCLASSIFIED")
      .sort((f, g) => f.id.localeCompare(g.id, void 0, { numeric: !0, sensitivity: "base" }));
  s.replaceChildren(),
    d("\u5168\u90e8\u8bb0\u5f55", "__all"),
    v.forEach((f) => d(f.id + " \u00b7 " + f.title, f.id)),
    d("\u672a\u5f52\u7c7b", "__unclassified");
  let b = c.get("UNCLASSIFIED");
  b && d(b.id + " \u00b7 " + b.title, b.id),
    Array.from(s.options).some((f) => f.value === u) ? (s.value = u) : (s.value = "__all");
};

export { schUnifiedProjectCatalog };
