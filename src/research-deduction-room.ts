// @ts-nocheck
/* Recovered from the reviewed 3.0.1 deduction-room module.  This is the
 * feature source, not the release bundle: only this module and its explicit
 * dependencies are included.  Internal names are retained while the legacy
 * bundle regression suite is migrated to source-level tests. */
import { fetchWithTimeout as Be } from "./utils/network";
import { schPromptText } from "./prompt-text";
import { schEvidenceTools } from "./research-evidence-tools";
import { schDeductionBridgeBase } from "./runtime-manager";

var Ge = require("obsidian");
var Md = null, // 不再使用固定地址：Bridge 地址由 schDeductionBridgeBase 按本 Vault 的 runtime 端口解析
  po = "https://api.anthropic.com/v1/messages",
  go = {
    designing: "\u8BBE\u8BA1\u4E2D",
    "awaiting-experiment": "\u5F85\u5B9E\u9A8C",
    completed: "\u5DF2\u5B8C\u6210",
    archived: "\u5DF2\u5F52\u6863",
  },
  Rd = [
    {
      name: "search_literature",
      description:
        "\u68C0\u7D22\u5F00\u653E\u83B7\u53D6\u5B66\u672F\u6587\u732E\uFF08\u57FA\u4E8E OpenAlex\uFF09\uFF0C\u7528\u4E8E\u5728\u7ED9\u51FA\u6700\u7EC8\u7ED3\u6784\u5316\u56DE\u590D\u524D\u83B7\u53D6\u8BC1\u636E\u7EBF\u7D22\u3002\u53EF\u591A\u6B21\u8C03\u7528\u3001\u9010\u6B65\u7EC6\u5316\u68C0\u7D22\u5F0F\u3002",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "\u82F1\u6587\u5B66\u672F\u68C0\u7D22\u5F0F",
          },
          why: {
            type: "string",
            description:
              "\u4E3A\u4EC0\u4E48\u9700\u8981\u8FD9\u6761\u8BC1\u636E",
          },
        },
        required: ["query"],
      },
    },
  ];
function $t(o) {
  return JSON.stringify(
    String(o != null ? o : "")
      .replace(/\r?\n/g, " ")
      .trim(),
  );
}
function $d(o) {
  return Array.isArray(o)
    ? o.map((t) => String(t != null ? t : "").trim()).filter(Boolean)
    : [];
}
function Tt(o) {
  let t = $d(o);
  return t.length
    ? t.map((e) => `- ${e}`).join(`
`)
    : "- \u5F85\u8865\u5145\u3002";
}
function _d(o, t) {
  return `${(o.settings.experimentsFolder || "Experiments").replace(/\/+$/, "")}/Projects/${t}`;
}
async function mo(o, t) {
  if (o.vault.getAbstractFileByPath(t)) return;
  let e = t.split("/").slice(0, -1).join("/");
  e && (await mo(o, e)), await o.vault.createFolder(t);
}
// Extract the first complete JSON object that carries the expected reply field.
// Agent output occasionally includes a short preface, a fenced block, or braces
// inside quoted text. A greedy /{[\s\S]*}/ match merges those into invalid JSON.
// This scanner observes JSON string escaping, including escaped backslashes.
function schExtractJsonReplyObject(t, e) {
  let s = String(t || ""),
    o = String.fromCharCode(123),
    u = String.fromCharCode(125);
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== o) continue;
    let r = 0,
      n = null,
      a = !1;
    for (let l = i; l < s.length; l++) {
      let c = s[l];
      if (n) {
        if (a) {
          a = !1;
          continue;
        }
        if (c === "\\") {
          a = !0;
          continue;
        }
        c === n && (n = null);
        continue;
      }
      if (c === '"') {
        n = c;
        continue;
      }
      if (c === o) r++;
      else if (c === u && --r === 0) {
        try {
          let h = JSON.parse(s.slice(i, l + 1));
          if (
            h &&
            typeof h == "object" &&
            !Array.isArray(h) &&
            Object.prototype.hasOwnProperty.call(h, e)
          )
            return h;
        } catch (h) {
        }
        break;
      }
    }
  }
  return null;
}
var yi = class {
  constructor(t) {
    this.host = t;
    this.selectedId = null;
    this.unboundFormal = !1;
    this.draft = null;
    this.history = [];
    this.pendingEvidence = null;
    this.historyProjectId = null;
    this.formalTopicId = null;
    this.compactedSummaryCache = null;
  }
  async render(t) {
    var c;
    let r = t.createDiv({ cls: "deduction-room" }),
      n = r.createEl("aside", { cls: "deduction-pane deduction-list-pane" }),
      a = r.createEl("section", {
        cls: "deduction-pane deduction-dialogue-pane",
      }),
      l = r.createEl("aside", { cls: "deduction-pane deduction-plan-pane" });
    let e = await this.context();
    await this.restoreActiveFormalTopic(e);
    let s = await this.designs(e);
    !this.selectedId && !this.unboundFormal && s[0] && (this.selectedId = s[0].id);
    let i = (c = s.find((h) => h.id === this.selectedId)) != null ? c : null;
    this.renderList(n, e, s),
      await this.renderDialogue(a, e, i),
      await this.renderPlan(l, i);
  }
  async context() {
    var l;
    let t = await this.host.plugin.loadData(),
      e = t == null ? void 0 : t.projectWorkspace,
      s = t == null ? void 0 : t.rssBoard,
      i = String(
        (e == null ? void 0 : e.activeProjectId) ||
          (s == null ? void 0 : s.researchProjectId) ||
          "PRJ-001",
      ),
      r = _d(this.host.plugin, i),
      n = this.host.app.vault.getAbstractFileByPath(`${r}/project.md`),
      a =
        n instanceof Ge.TFile
          ? (l = this.host.app.metadataCache.getFileCache(n)) == null
            ? void 0
            : l.frontmatter
          : void 0;
    return {
      projectId: i,
      folder: r,
      title: String((a == null ? void 0 : a.title) || i),
    };
  }
  async designs(t) {
    var i;
    let e = `${t.folder}/designs/`,
      s = [];
    for (let r of this.host.app.vault
      .getMarkdownFiles()
      .filter((n) => n.path.startsWith(e))) {
      let n =
        (i = this.host.app.metadataCache.getFileCache(r)) == null
          ? void 0
          : i.frontmatter;
      (n == null ? void 0 : n.type) === "experiment-design" &&
        s.push({
          file: r,
          id: String(n.design_id || r.basename),
          title: String(n.title || r.basename),
          status: n.status || "designing",
          version: String(n.version || "v1.0"),
          auditPassed: n.audit_passed === !0 || n.audit_passed === "true",
        });
    }
    return s.sort((r, n) => n.file.stat.mtime - r.file.stat.mtime);
  }
  renderList(t, e, s) {
    let i = t.createDiv({ cls: "deduction-pane-head" });
    i.createEl("h2", { text: "\u5B9E\u9A8C\u8BBE\u8BA1" });
    let r = i.createEl("button", {
      cls: "scholarium-btn primary",
      text: "\uFF0B \u65B0\u5EFA\u8BBE\u8BA1",
    });
    (r.onclick = () => {
      this.createDesign(e);
    }),
      t.createEl("p", {
        cls: "deduction-project-label",
        text: `${e.projectId} \xB7 ${e.title}`,
      });
    let n = t.createDiv({ cls: "deduction-design-list" });
    s.length ||
      n.createEl("p", {
        cls: "deduction-empty",
        text: "\u5C1A\u65E0\u8BBE\u8BA1\u4EFB\u52A1\u3002\u65B0\u5EFA\u8349\u6848\uFF0C\u6216\u5148\u5728\u7EC7\u7814\u8005\u4E2D\u63A8\u6F14\u65B9\u6848\u3002",
      });
    for (let a of s) {
      let l = n.createEl("button", {
        cls: `deduction-design-card ${a.id === this.selectedId ? "is-selected" : ""}`,
      });
      l.createEl("small", { text: `${a.id} \xB7 ${a.version}` }),
        l.createEl("strong", { text: a.title }),
        l.createSpan({
          cls: `deduction-status status-${a.status}`,
          text: go[a.status] || a.status,
        }),
        (l.onclick = async () => {
          if (a.id !== this.selectedId) {
            try {
              await this.persistHistory(e);
            } catch (_) {}
            (this.selectedId = a.id),
              (this.unboundFormal = !1),
              (this.draft = null),
              this.host.rerender();
          }
        });
    }
    this.renderSessionList(t, e).catch((err) =>
      console.warn("[Scholarium] 会话列表渲染失败:", err),
    );
  }
  async renderDialogue(t, e, s) {
    var u;
    await this.restoreFormalTopic(e);
    if (
      this.historyProjectId !== e.projectId ||
      this.historyDesignId !== this.currentDesignKey()
    ) {
      (this.history = await this.loadPersistedHistory(e)),
        (this.historyProjectId = e.projectId),
        (this.historyDesignId = this.currentDesignKey()),
        (this.pendingEvidence = null),
        (this.compactedSummaryCache = null);
      let g = [...this.history].reverse().find((v) => v.role === "agent"),
        m = [...this.history].reverse().find((v) => v.role === "researcher");
      this.draft = g
        ? {
            message: String(
              (u = m == null ? void 0 : m.content) != null ? u : "",
            ),
            reply: g.content,
          }
        : null;
    }
    let i = t.createDiv({ cls: "deduction-pane-head" }),
      r = i.createDiv();
    r.createEl("h2", { text: "\u7EC7\u7814\u8005\u5BF9\u8BDD" });
    let n = !!(
      this.host.plugin.settings.researchTheoryNativeApi &&
      this.host.plugin.settings.aiProvider === "claude" &&
      this.host.plugin.settings.aiApiKey
    );
    r.createEl("p", {
      text: `\u5355 Agent \xB7 \u8BC1\u636E\u7EA6\u675F \xB7 \u4EC5\u751F\u6210\u8349\u7A3F${n ? " \xB7 \u539F\u751F API \u5DE5\u5177\u8C03\u7528" : ""}`,
    });
    let a = await this.bridgeState(),
      l = i.createEl("button", {
        cls: "scholarium-btn",
        text: a.online ? "Bridge \u5DF2\u8FDE\u63A5" : "\u8FDE\u63A5 Bridge",
      });
    (l.onclick = async () => {
      let g = await this.bridgeState();
      g.online ||
        new Ge.Notice(
          `\u65E0\u6CD5\u8FDE\u63A5\u672C\u673A Bridge\uFF1A${g.error || "\u8BF7\u8FD0\u884C Research Weaver \u7684 npm start"}`,
        ),
        this.host.rerender();
    }),
      t.createEl("p", {
        cls: `deduction-bridge-state ${a.online ? "is-online" : ""}`,
        text: a.online
          ? `\u672C\u673A Bridge \u5DF2\u8FDE\u63A5 \xB7 \u53EF\u7528 CLI\uFF1A${
              a.agents
                .filter((g) => g.installed)
                .map((g) => g.id)
                .join("\u3001") || "\u672A\u68C0\u6D4B\u5230"
            }`
          : "\u672C\u673A Bridge \u672A\u8FDE\u63A5\u3002\u63D2\u4EF6\u53EA\u901A\u8FC7\u672C\u5730\u542F\u52A8\u5668\u4EE3\u7406\u8C03\u7528\uFF0C\u4E0D\u8BFB\u53D6\u6216\u4FDD\u5B58 Bridge token\u3002",
      });
    let c = t.createDiv({ cls: "deduction-transcript" });
    (this.__elTranscript = c), this.renderDraft(c);
    c.addEventListener("scroll", () => {
      this.__ts = c.scrollTop;
    }),
      window.requestAnimationFrame(() => {
        c.isConnected &&
          (c.scrollTop =
            typeof this.__ts == "number" ? this.__ts : c.scrollHeight);
      });
    let h = t.createEl("form", { cls: "deduction-composer" }),
      d = h.createEl("textarea", {
        attr: {
          placeholder: s
            ? `\u56F4\u7ED5\u300C${s.title}\u300D\u8865\u5145\u6761\u4EF6\u3001\u89C2\u5BDF\u6216\u95EE\u9898\u2026`
            : "\u63CF\u8FF0\u7814\u7A76\u95EE\u9898\u3001\u5DF2\u6709\u8BC1\u636E\u3001\u4EEA\u5668\u6761\u4EF6\u548C\u6210\u529F\u6807\u51C6\u2026",
        },
      });
    let __fm = this.formalMode === !0,
      __row = h.createDiv({ cls: "deduction-composer-actions" }),
      __tg = __row.createEl("button", {
        cls:
          "scholarium-btn deduction-mode-toggle" + (__fm ? " is-active" : ""),
        attr: {
          type: "button",
          title:
            "\u5F00\u542F\u540E\u672C\u8F6E\u8D70\u5B8C\u6574\u7EC7\u7814\u8005\u534F\u8BAE\uFF1A\u6B63\u5F0F\u63A8\u6F14 + \u81EA\u5BA1\u8BA1 + \u6587\u732E\u68C0\u7D22\u3002\u5173\u95ED\u65F6\u53EA\u662F\u666E\u901A\u5BF9\u8BDD\uFF0C\u4E0D\u68C0\u7D22\u3001\u4E0D\u843D\u76D8\u3002\u4E5F\u53EF\u4EE5\u76F4\u63A5\u5728\u6D88\u606F\u91CC\u5199\u300C\u4F7F\u7528\u7EC7\u7814\u8005\u300D\u3002",
        },
        text: __fm
          ? "\u2697 \u7EC7\u7814\u8005\u6A21\u5F0F\uFF1A\u5F00"
          : "\u2697 \u7EC7\u7814\u8005\u6A21\u5F0F\uFF1A\u5173",
      });
    let __nt = __row.createEl("button", {
      cls: "scholarium-btn deduction-new-topic",
      attr: {
        type: "button",
        title:
          "新建独立话题；不会带入此前普通对话或织研者推演的历史。织研者模式下会新建未绑定设计的临时话题。",
      },
      text: "新话题",
    });
    let __sv = __row.createEl("button", {
      cls: "scholarium-btn deduction-save-session",
      attr: {
        type: "button",
        title:
          "\u628A\u5F53\u524D\u5BF9\u8BDD\u5B58\u6210 md \u6587\u4EF6\uFF1B\u5DE6\u680F\u300C\u5BF9\u8BDD\u8BB0\u5F55\u300D\u91CC\u53EF\u4EE5\u70B9\u51FB\u91CD\u65B0\u8F7D\u5165",
      },
      text: "\u4FDD\u5B58\u4F1A\u8BDD",
    });
    __sv.onclick = () => {
      this.saveSession();
    };
    let p = __row.createEl("button", {
      cls: "scholarium-btn primary",
      attr: { type: "submit" },
      text: __fm ? "\u53D1\u9001\u7ED9\u7EC7\u7814\u8005" : "\u53D1\u9001",
    });
    __tg.onclick = async () => {
      try {
        await this.persistHistory(e);
      } catch (_) {}
      let v = this.formalMode !== !0;
      (this.formalMode = v),
        v && this.selectedId == null && this.ensureFormalTopic(),
        (this.historyProjectId = null),
        (this.historyDesignId = null),
        (this.pendingEvidence = null),
        (this.compactedSummaryCache = null),
        (this.draft = null),
        this.host.rerender();
    };
    __nt.onclick = async () => {
      try {
        await this.persistHistory(e);
      } catch (_) {}
      this.formalMode === !0
        ? ((this.selectedId = null),
          (this.unboundFormal = !0),
          (this.formalTopicId = this.newDialogueTopic("formal")),
          new Ge.Notice("已新建未绑定设计的织研者话题。"))
        : (this.chatTopicId = this.newDialogueTopic("chat")),
        (this.history = []),
        (this.historyProjectId = null),
        (this.historyDesignId = null),
        (this.pendingEvidence = null),
        (this.compactedSummaryCache = null),
        (this.draft = null),
        this.host.rerender();
    };
    h.onsubmit = (g) => {
      g.preventDefault();
      let m = d.value.trim();
      if (!m) return;
      let __go =
        this.formalMode === !0 ||
        /\u4F7F\u7528\u7EC7\u7814\u8005|\u7EC7\u7814\u8005\u6A21\u5F0F|\u542F\u52A8\u7EC7\u7814\u8005|^\/\u7EC7\u7814\u8005/.test(
          m,
        );
      d.value = "";
      let um = c.createDiv({ cls: "deduction-message user" });
      um.createEl("small", { text: "\u4F60" }), um.createEl("p", { text: m });
      let pm = c.createDiv({ cls: "deduction-message tool deduction-pending" });
      pm.createEl("small", {
        text: __go
          ? "\u7EC7\u7814\u8005 \u00B7 \u5BA1\u8BA1\u4E2D"
          : "\u79D1\u7814\u52A9\u624B \u00B7 \u56DE\u590D\u4E2D",
      }),
        pm.createEl("p", {
          text: "\u6B63\u5728\u7B49\u5F85\u672C\u673A Agent \u8FD4\u56DE\u2026",
        }),
        (this.__ts = 1e9),
        (c.scrollTop = c.scrollHeight),
        (async () => {
          // A message such as "使用织研者" is a real mode transition, not merely
          // a one-off prompt flag.  Load the formal thread before its message is
          // appended, otherwise a formal deduction would be persisted in chat.
          if (__go && this.formalMode !== !0)
            await this.activateFormalThread(e);
          await this.runTheory(e, a, m, p, __go);
        })();
      };
  }
  renderDraft(t) {
    if (!this.history.length && !this.pendingEvidence) {
      t.createEl("p", {
        cls: "deduction-empty deduction-intro",
        text: "\u7EC7\u7814\u8005\u4F1A\u5148\u8FA8\u522B\u5DF2\u6709\u8BC1\u636E\u548C\u7F3A\u5931\u7EA6\u675F\uFF1B\u672A\u901A\u8FC7\u81EA\u5BA1\u8BA1\uFF0C\u4E0D\u4F1A\u521B\u5EFA\u5B9E\u9A8C\u65B9\u6848\u6216\u5199\u5165 Vault\u3002",
      });
      return;
    }
    for (let e of this.history)
      if (e.role === "researcher") {
        let s = t.createDiv({ cls: "deduction-message user" });
        s.createEl("small", { text: "\u4F60" }),
          s.createEl("p", { text: String(e.content) });
      } else
        e.role === "evidence"
          ? this.renderEvidenceLogEntry(t, e.content)
          : e.role === "agent" && this.renderAgentReply(t, e.content);
    this.pendingEvidence && this.renderEvidenceConfirmation(t);
  }
  renderAgentReply(t, e) {
    var n, a, l, c, h, d, p;
    let s = t.createDiv({ cls: "deduction-message agent" });
    if (e && e.chat === !0) {
      s.createEl("small", { text: "科研助手 · 普通对话（未调用织研者）" }),
        this.renderReplyMarkdown(s, e.summary || "");
      return;
    }
    s.createEl("small", {
      text: "\u7EC7\u7814\u8005\u4E3B Agent \xB7 \u672C\u8F6E\u5DF2\u542F\u7528\u5B8C\u6574\u534F\u8BAE \xB7 \u5355\u4E00\u6267\u884C\u5668",
    }),
      this.renderReplyMarkdown(
        s,
        e.summary || "\u672A\u8FD4\u56DE\u6458\u8981\u3002",
      );
    let i = s.createDiv({ cls: "deduction-evidence" });
    for (let [u, g] of [
      ["direct", "\u76F4\u63A5\u8BC1\u636E"],
      ["indirect", "\u95F4\u63A5\u7EBF\u7D22"],
      ["unverified", "\u5F85\u9A8C\u8BC1"],
    ]) {
      let m = ((n = e.evidence) == null ? void 0 : n[u]) || [],
        v = i.createEl("span", {
          cls: `evidence-${u}`,
          text: `${g} ${m.length}`,
        });
      v.title =
        m.join(`
`) || "\u672A\u63D0\u4F9B";
    }
    if ((a = e.questions) != null && a.length) {
      let u = s.createEl("ol", { cls: "deduction-questions" });
      e.questions.forEach((g) =>
        u.createEl("li", {
          text: `${g.question || "\u5F85\u8865\u5145"}${g.why ? ` \u2014\u2014 ${g.why}` : ""}`,
        }),
      );
    }
    let r = [
      ...(((l = e.audit) == null ? void 0 : l.evidence_gaps) || []),
      ...(((c = e.audit) == null ? void 0 : c.feasibility_gaps) || []),
    ];
    s.createEl("p", {
      cls: `deduction-audit ${(h = e.audit) != null && h.passed ? "passed" : ""}`,
      text:
        (d = e.audit) != null && d.passed
          ? "\u81EA\u5BA1\u8BA1\u901A\u8FC7\uFF1A\u53EF\u521B\u5EFA\u786E\u8BA4\u7248\u672C\u3002"
          : `\u81EA\u5BA1\u8BA1\u672A\u901A\u8FC7\uFF1A${r.join("\uFF1B") || ((p = e.audit) == null ? void 0 : p.revision_action) || "\u8BF7\u8865\u5145\u5173\u952E\u7EA6\u675F\u6216\u8BC1\u636E\u3002"}`,
    });
    this.renderFormalActionRequests(s, e);
  }
  renderFormalActionRequests(t, e) {
    if (!Array.isArray(e == null ? void 0 : e.action_requests) || !e.action_requests.length) return;
    let s = t.createDiv({ cls: "deduction-action-requests" });
    s.createEl("p", { text: `修改提议（${e.action_requests.length} 项；逐项确认后才写入 Scholarium）` });
    for (let i of e.action_requests) {
      let r = s.createDiv({ cls: "deduction-action-request" }),
        n = String((i == null ? void 0 : i.type) || "unknown_action"),
        a = i != null && i.input && typeof i.input == "object" ? i.input : {};
      r.createEl("b", { text: n });
      i != null && i.why && r.createEl("span", { text: ` — ${String(i.why)}` });
      r.createEl("pre", { text: JSON.stringify(a, null, 2) });
      if (i != null && i.queue_status === "queued") {
        r.createEl("small", { text: `已提交队列：${i.queue_id || "等待结算"}` });
        continue;
      }
      if (i != null && i.queue_status && i.queue_status.startsWith("confirmation_failed:")) {
        r.createEl("small", { text: `未提交：${i.queue_status.slice("confirmation_failed:".length)}` });
      }
      let l = r.createEl("button", { text: i != null && i.confirming ? "正在校验…" : "确认执行" });
      let c = !this.host.plugin.settings || !this.host.plugin.settings.allowResearchWeaverActions;
      l.disabled = Boolean((i == null ? void 0 : i.confirming) || c);
      if (c) l.title = "请先在 Scholarium 设置中开启允许织研者动作";
      l.onclick = () => this.confirmFormalActionRequest(e, i);
    }
  }
  async confirmFormalActionRequest(t, e) {
    if (!e || e.confirming || e.queue_status === "queued") return;
    if (!this.host.plugin.settings || !this.host.plugin.settings.allowResearchWeaverActions) {
      e.queue_status = "confirmation_failed: allowResearchWeaverActions is off in Scholarium settings";
      this.softRefresh();
      return;
    }
    e.confirming = !0;
    this.softRefresh();
    try {
      let s = schEvidenceTools(this.host.plugin),
        i = e.input && typeof e.input == "object" ? e.input : {};
      // Confirm 的第一步仍只做 dry-run：未知 action、坏参数都不能留下队列文件。
      await s.actions.runAsync(s.vault, e.type, i, { dryRun: !0, by: "agent:research-weaver-proposal" });
      let r = s.queue.submit(s.vault, e.type, i, { by: "agent:research-weaver-confirmed" });
      e.queue_status = "queued";
      e.queue_id = r.id;
      e.confirmed_at = new Date().toISOString();
    } catch (s) {
      e.queue_status = "confirmation_failed: " + (s instanceof Error ? s.message : String(s));
    } finally {
      e.confirming = !1;
      this.softRefresh();
      try {
        await this.persistHistory(await this.context());
      } catch (_) {}
    }
  }
  renderReplyMarkdown(t, e) {
    let s = String(e || ""),
      i = t.createDiv({ cls: "deduction-markdown markdown-rendered" }),
      r = this.host.app.workspace.getActiveFile();
    try {
      this.replyMarkdownComponent ||
        ((this.replyMarkdownComponent = new Ge.Component()),
        this.replyMarkdownComponent.load()),
        Promise.resolve(
          Ge.MarkdownRenderer.render(
            this.host.app,
            s,
            i,
            (r == null ? void 0 : r.path) || "",
            this.replyMarkdownComponent,
          ),
        ).catch(() => {
          i.isConnected && (i.empty(), i.createEl("pre", { text: s }));
        });
    } catch (_) {
      i.empty(), i.createEl("pre", { text: s });
    }
    return i;
  }
  renderEvidenceLogEntry(t, e) {
    var c;
    let s = t.createDiv({ cls: "deduction-message tool" }),
      i = s.createDiv({ cls: "deduction-tool-top" });
    if (
      (i.createEl("small", { text: "\u6587\u732E\u68C0\u7D22\u5DE5\u5177" }),
      i.createSpan({ text: e.error ? "\u5931\u8D25" : "\u5DF2\u6267\u884C" }),
      s.createEl("p", { text: `\u68C0\u7D22\u5F0F\uFF1A${e.query || ""}` }),
      e.error)
    ) {
      s.createEl("p", { text: `\u68C0\u7D22\u5931\u8D25\uFF1A${e.error}` });
      return;
    }
    let r = e.downloaded || [],
      n = r.filter((h) => h && !("error" in h)).length,
      a = r.length - n,
      l = `\u547D\u4E2D ${(c = e.hit_count) != null ? c : e.records ? e.records.length : 0} \u6761`;
    (l += r.length
      ? `\uFF1B\u6210\u529F\u4E0B\u8F7D ${n} \u7BC7${a ? `\uFF0C\u5931\u8D25 ${a} \u7BC7` : ""}`
      : "\uFF1B\u672C\u8F6E\u672A\u4E0B\u8F7D\u5168\u6587\uFF08\u65E0\u53EF\u4E0B\u8F7D OA \u5019\u9009\u6216\u7814\u7A76\u5458\u672A\u786E\u8BA4\uFF09"),
      s.createEl("p", { text: l });
  }
  renderEvidenceConfirmation(t) {
    var n, a;
    let e = this.pendingEvidence;
    if (!e) return;
    for (let l of e.groups) {
      let c = t.createDiv({ cls: "deduction-message tool pending" }),
        h = c.createDiv({ cls: "deduction-tool-top" });
      if (
        (h.createEl("small", {
          text: "\u6587\u732E\u68C0\u7D22\u5DE5\u5177 \xB7 \u5F85\u786E\u8BA4\u4E0B\u8F7D",
        }),
        h.createSpan({
          text: l.error
            ? "\u5931\u8D25"
            : `\u547D\u4E2D ${(n = l.hit_count) != null ? n : 0} \u6761`,
        }),
        c.createEl("p", { text: `\u68C0\u7D22\u5F0F\uFF1A${l.query || ""}` }),
        l.error)
      ) {
        c.createEl("p", { text: `\u68C0\u7D22\u5931\u8D25\uFF1A${l.error}` });
        continue;
      }
      if (!((a = l.candidates) != null && a.length)) {
        c.createEl("p", {
          text: "\u672A\u53D1\u73B0\u53EF\u76F4\u63A5\u4E0B\u8F7D\u7684\u5F00\u653E\u83B7\u53D6\u5168\u6587\uFF0C\u4EE5\u4E0B\u7ED3\u679C\u4EC5\u4F5C\u7EBF\u7D22\u53C2\u8003\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u4E0B\u8F7D\u3002",
        });
        continue;
      }
      c.createEl("p", {
        text: "\u4EE5\u4E0B\u4E3A\u5F00\u653E\u83B7\u53D6\uFF08OA\uFF09\u5019\u9009\uFF0C\u52FE\u9009\u540E\u70B9\u51FB\u4E0B\u65B9\u6309\u94AE\u4E0B\u8F7D\uFF1B\u4E0D\u52FE\u9009\u5219\u8DF3\u8FC7\u8BE5\u7BC7\uFF1A",
      });
      let d = c.createDiv({ cls: "deduction-evidence-candidates" });
      for (let p of l.candidates) {
        let u = d.createDiv({ cls: "deduction-candidate-row" }),
          g = u.createEl("label"),
          m = g.createEl("input", { attr: { type: "checkbox" } });
        (m.checked = p.selected !== !1),
          (m.onchange = () => {
            p.selected = m.checked;
          }),
          g.createSpan({
            text: ` ${p.title || "\uFF08\u65E0\u6807\u9898\uFF09"}${p.year ? ` (${p.year})` : ""}`,
          }),
          p.doi && u.createEl("small", { text: `DOI: ${p.doi}` });
      }
    }
    let s = t.createDiv({ cls: "deduction-evidence-actions" }),
      i = s.createEl("button", {
        cls: "scholarium-btn primary",
        text: "\u4E0B\u8F7D\u6240\u9009\u5E76\u7EE7\u7EED\u5BF9\u8BDD",
      }),
      r = s.createEl("button", {
        cls: "scholarium-btn",
        text: "\u4E0D\u4E0B\u8F7D\uFF0C\u76F4\u63A5\u7EE7\u7EED",
      });
    (i.onclick = async () => {
      (i.disabled = !0),
        (r.disabled = !0),
        i.setText("\u4E0B\u8F7D\u4E2D\u2026"),
        await this.finalizePendingEvidence(!1);
    }),
      (r.onclick = async () => {
        (i.disabled = !0),
          (r.disabled = !0),
          r.setText("\u7EE7\u7EED\u4E2D\u2026"),
          await this.finalizePendingEvidence(!0);
      });
  }
  async renderPlan(t, e) {
    this.__elPlanPane = t;
    let s = t.createDiv({ cls: "deduction-pane-head" }),
      i = s.createDiv();
    if (
      (i.createEl("h2", { text: "\u5B9E\u9A8C\u65B9\u6848\u5361\u7247" }),
      i.createEl("p", {
        text: "\u4EC5\u5C55\u793A\u5DF2\u786E\u8BA4\u7248\u672C\uFF0C\u4E0D\u968F\u5BF9\u8BDD\u81EA\u52A8\u843D\u76D8",
      }),
      !e)
    ) {
      t.createEl("p", {
        cls: "deduction-empty",
        text: "\u5C1A\u672A\u9009\u62E9\u786E\u8BA4\u8BBE\u8BA1\u3002\u7EC7\u7814\u8005\u901A\u8FC7\u81EA\u5BA1\u8BA1\u540E\uFF0C\u53EF\u5728\u6B64\u521B\u5EFA\u4E0D\u53EF\u8986\u76D6\u7684\u786E\u8BA4\u7248\u672C\u3002",
      }),
        this.renderDraftActions(t);
      return;
    }
    s.createEl("button", {
      cls: "scholarium-btn",
      text: "\u6253\u5F00\u65B9\u6848",
    }).onclick = () => {
      this.host.app.workspace.getLeaf("tab").openFile(e.file, { active: !0 });
    };
    let r = t.createDiv({ cls: "deduction-plan-card" }),
      n = await this.host.app.vault.cachedRead(e.file);
    r.createEl("small", { text: `${e.id} \xB7 ${e.version}` }),
      r.createEl("h3", { text: e.title }),
      r.createSpan({
        cls: `deduction-status status-${e.status}`,
        text: go[e.status] || e.status,
      }),
      [...n.matchAll(/^##\s+(.+?)\s*\n([\s\S]*?)(?=^##\s+|$)/gm)]
        .slice(0, 5)
        .forEach((c) => {
          let h = r.createDiv({ cls: "deduction-plan-section" });
          h.createEl("h4", { text: c[1] }),
            h.createEl("p", {
              text:
                (c[2] || "")
                  .replace(/\|.*\|/g, "\u8868\u683C\u89C1\u539F\u65B9\u6848")
                  .replace(/[-*#`]/g, "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .slice(0, 220) || "\u5F85\u8865\u5145",
            });
        });
    let a = t.createEl("button", {
        cls: "scholarium-btn primary deduction-create-experiment",
        text: "\u521B\u5EFA\u5B9E\u9A8C\u8BB0\u5F55",
      }),
      l = e.status === "awaiting-experiment" && e.auditPassed;
    (a.disabled = !l),
      (a.title = l
        ? "\u4ECE\u5DF2\u786E\u8BA4\u65B9\u6848\u8FDB\u5165\u5B9E\u9A8C\u8BB0\u5F55"
        : "\u4EC5\u9650\u901A\u8FC7\u81EA\u5BA1\u8BA1\u7684\u5DF2\u786E\u8BA4\u65B9\u6848"),
      (a.onclick = () => {
        l && this.host.createExperimentRecord();
      }),
      this.renderDraftActions(t);
  }
  renderDraftActions(t) {
    var i;
    let e = this.draft;
    if (!e || !e.reply || this.pendingEvidence) return;
    let s = t.createDiv({ cls: "deduction-draft-actions" });
    (s.createEl("button", {
      cls: "scholarium-btn",
      text: "\u4FDD\u5B58\u672C\u8F6E\u4E3A md",
    }).onclick = () => {
      this.saveTurn();
    }),
      e.reply.status === "ready" &&
      ((i = e.reply.audit) == null ? void 0 : i.passed) === !0
        ? (s.createEl("button", {
            cls: "scholarium-btn primary",
            text: "\u521B\u5EFA\u786E\u8BA4\u7248\u672C",
          }).onclick = () => {
            this.confirmDesign();
          })
        : s.createEl("p", {
            text: "\u65B9\u6848\u4ECD\u662F\u5185\u5B58\u8349\u7A3F\uFF1B\u4EC5\u81EA\u5BA1\u8BA1\u901A\u8FC7\u540E\u5141\u8BB8\u521B\u5EFA\u786E\u8BA4\u7248\u672C\u3002",
          });
  }
  async createDesign(t) {
    let e = await schPromptText(
      "\u8BBE\u8BA1\u4EFB\u52A1\u540D\u79F0\uFF1A",
      "\u65B0\u7684\u5B9E\u9A8C\u8BBE\u8BA1",
    );
    if (!(e != null && e.trim())) return;
    let s = await this.nextId(t),
      i = `${t.folder}/designs/${s}.md`,
      r = this.markdown(s, t.projectId, e.trim(), "designing", !1);
    window.confirm(`\u5C06\u65B0\u5EFA\uFF08\u4E0D\u4F1A\u8986\u76D6\u5DF2\u6709\u6587\u4EF6\uFF09\uFF1A
${i}

${r.slice(0, 1e3)}

\u786E\u8BA4\u521B\u5EFA\u5417\uFF1F`) &&
      (await this.createOnly(i, r),
      await this.persistHistory(t),
      (this.selectedId = s),
      (this.unboundFormal = !1),
      (this.history = []),
      (this.draft = null),
      (this.sessionId = null),
      (this.pendingEvidence = null),
      (this.compactedSummaryCache = null),
      (this.historyDesignId = s),
      await this.persistHistory(t),
      new Ge.Notice(`\u5DF2\u65B0\u5EFA\u8BBE\u8BA1\u8349\u6848\uFF1A${s}`),
      this.host.rerender());
  }
  async confirmDesign() {
    var l, c, h, d, p, u, g, m, v, f, w, b, y, C, S, k;
    let t = (l = this.draft) == null ? void 0 : l.reply;
    if (
      !t ||
      t.status !== "ready" ||
      ((c = t.audit) == null ? void 0 : c.passed) !== !0
    )
      throw new Error(
        "\u65B9\u6848\u672A\u901A\u8FC7\u81EA\u5BA1\u8BA1\uFF0C\u4E0D\u80FD\u521B\u5EFA\u786E\u8BA4\u7248\u672C\u3002",
      );
    let e = await this.context(),
      s = await this.nextId(e),
      i =
        ((h = t.design) == null ? void 0 : h.title) ||
        "\u7EC7\u7814\u8005\u786E\u8BA4\u8BBE\u8BA1",
      r = `
## \u79D1\u5B66\u95EE\u9898

${((d = t.design) == null ? void 0 : d.scientific_question) || t.summary || "\u5F85\u8865\u5145\u3002"}

## \u6838\u5FC3\u5047\u8BBE\uFF08H0 / H1\uFF09

- **H0**\uFF1A${((p = t.hypotheses) == null ? void 0 : p.h0) || "\u5F85\u8865\u5145\u3002"}
- **H1**\uFF1A${((u = t.hypotheses) == null ? void 0 : u.h1) || "\u5F85\u8865\u5145\u3002"}

## \u7ADE\u4E89\u89E3\u91CA / \u66FF\u4EE3\u5047\u8BBE

${Tt((g = t.hypotheses) == null ? void 0 : g.alternatives)}

## \u5173\u952E\u53D8\u91CF\u8BBE\u8BA1

${Tt((m = t.plan) == null ? void 0 : m.variables)}

## \u5BF9\u7167\u5B9E\u9A8C\u7EC4

${Tt((v = t.plan) == null ? void 0 : v.controls)}

## \u8868\u5F81\u4E0E\u6D4B\u8BD5

${Tt((f = t.plan) == null ? void 0 : f.measurements)}

## \u9884\u671F\u7ED3\u679C

${Tt((w = t.plan) == null ? void 0 : w.expected_results)}

## \u6F5C\u5728\u98CE\u9669\u4E0E\u5BF9\u7B56

${Tt((b = t.plan) == null ? void 0 : b.risks)}

## \u4E0B\u4E00\u6B65\u8BA1\u5212

${String(((y = t.plan) == null ? void 0 : y.next_action) || "\u5F85\u8865\u5145\u3002")}

## \u8BC1\u636E\u8303\u56F4

- **\u76F4\u63A5\u8BC1\u636E**\uFF1A${Tt((C = t.evidence) == null ? void 0 : C.direct).replace(/^- /gm, "")}
- **\u95F4\u63A5\u7EBF\u7D22**\uFF1A${Tt((S = t.evidence) == null ? void 0 : S.indirect).replace(/^- /gm, "")}
- **\u5F85\u9A8C\u8BC1**\uFF1A${Tt((k = t.evidence) == null ? void 0 : k.unverified).replace(/^- /gm, "")}
`,
      n = `${e.folder}/designs/${s}.md`,
      a = this.markdown(s, e.projectId, i, "awaiting-experiment", !0, r);
    window.confirm(`\u4EE5\u4E0B\u786E\u8BA4\u7248\u672C\u5C06\u88AB\u65B0\u5EFA\uFF0C\u4E0D\u4F1A\u8986\u76D6\u5386\u53F2\u7248\u672C\uFF1A
${n}

${a.slice(0, 1800)}

\u786E\u8BA4\u521B\u5EFA\u5417\uFF1F`) &&
      (await this.createOnly(n, a),
      (this.selectedId = s),
      (this.unboundFormal = !1),
      (this.draft = null),
      new Ge.Notice(
        `\u5DF2\u521B\u5EFA\u5DF2\u786E\u8BA4\u65B9\u6848\uFF1A${s}`,
      ),
      this.host.rerender());
  }
  sessionsDir(c) {
    return `${c.folder}/03_织研者对话/${this.currentDesignKey()}`;
  }
  sessionTitleFromHistory() {
    let f = this.history.find((x) => x.role === "researcher"),
      s = String((f && f.content) || "")
        .replace(/\s+/g, " ")
        .trim();
    return s ? (s.length > 40 ? s.slice(0, 40) + "…" : s) : "未命名对话";
  }
  parseFrontmatter(txt) {
    let mm = String(txt || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!mm) return null;
    let o = {};
    for (let line of mm[1].split(/\r?\n/)) {
      let x = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      x && (o[x[1]] = x[2].trim().replace(/^["']|["']$/g, ""));
    }
    return o;
  }
  async listSessions(c) {
    let d = this.sessionsDir(c) + "/",
      o = [];
    for (let f of this.host.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(d)) continue;
      let m = this.host.app.metadataCache.getFileCache(f);
      if (
        ((m = m && m.frontmatter),
        m ||
          (m = await this.host.app.vault
            .cachedRead(f)
            .then((x) => this.parseFrontmatter(x))
            .catch(() => null)),
        !m || m.type !== "zhiyanzhe-session")
      )
        continue;
      o.push({
        file: f,
        id: String(m.session_id || f.basename),
        title: String(m.title || f.basename),
        turns: Number(m.turns) || 0,
        updatedAt: String(m.updated_at || ""),
      });
    }
    return o.sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
  }
  sessionTranscriptMd() {
    let out = [];
    for (let it of this.history) {
      let c = it.content;
      if (it.role === "researcher") out.push("### 你\n\n" + String(c) + "\n");
      else if (it.role === "evidence")
        (c = c || {}),
          out.push(
            "### 文献检索工具\n\n- 检索式：" +
              (c.query || "") +
              "\n- " +
              (c.error
                ? "失败：" + c.error
                : "命中 " + (c.hit_count != null ? c.hit_count : 0) + " 条") +
              "\n",
          );
      else if (it.role === "pipeline") {
        c = c || {};
        out.push(
          "### 文献 Pipeline · " +
            ((c.result && c.result.title) || c.status || "") +
            "\n",
        );
        c.topic && out.push("- 检索主题：" + c.topic);
        for (const s of c.steps || [])
          out.push(`- **${s.title}**：${s.note || ""}`);
        for (const l of (c.result && c.result.lines) || []) out.push("- " + l);
        out.push("");
      } else if (it.role === "agent")
        if (((c = c || {}), c.chat === !0))
          out.push("### 织研者 · 普通对话\n\n" + (c.summary || "") + "\n");
        else {
          out.push("### 织研者主 Agent\n\n" + (c.summary || "") + "\n"),
            c.questions &&
              c.questions.length &&
              out.push(
                c.questions
                  .map(
                    (q, i) =>
                      i +
                      1 +
                      ". " +
                      (q.question || "") +
                      (q.why ? " —— " + q.why : ""),
                  )
                  .join("\n") + "\n",
              );
          let ok = c.audit && c.audit.passed;
          out.push("> 自审计：" + (ok ? "通过" : "未通过") + "\n");
        }
    }
    return out.join("\n");
  }
  async saveSession(c) {
    let e = c || (await this.context());
    if (!this.history.length) {
      new Ge.Notice("当前没有可保存的对话。");
      return;
    }
    let now = new Date().toISOString();
    this.sessionId ||
      (this.sessionId = "SES-" + now.replace(/[-:T]/g, "").slice(0, 14));
    let dir = this.sessionsDir(e),
      p = dir + "/" + this.sessionId + ".md",
      title = this.sessionTitleFromHistory(),
      data = JSON.stringify(this.history).replace(/-->/g, "--\\u003e"),
      body =
        "---\ntype: zhiyanzhe-session\nproject_id: " +
        $t(e.projectId) +
        "\ndesign_id: " +
        $t(this.currentDesignKey()) +
        "\nsession_id: " +
        $t(this.sessionId) +
        "\ntitle: " +
        $t(title) +
        "\nturns: " +
        this.history.length +
        "\nupdated_at: " +
        $t(now) +
        "\nsource: research-deduction-room\n---\n\n# 织研者对话：" +
        title +
        "\n\n> 保存于 " +
        now.replace("T", " ").slice(0, 16) +
        " · 共 " +
        this.history.length +
        " 条消息。在研究推演室左栏的「对话记录」中点击本会话即可载入并继续。\n\n" +
        this.sessionTranscriptMd() +
        "\n\n---\n\n<!--ZHIYANZHE-SESSION-DATA\n" +
        data +
        "\n-->\n";
    try {
      await mo(this.host.app, dir);
      let f = this.host.app.vault.getAbstractFileByPath(p);
      f
        ? await this.host.app.vault.modify(f, body)
        : await this.host.app.vault.create(p, body),
        new Ge.Notice("会话已保存：" + title),
        this.host.rerender();
    } catch (err) {
      new Ge.Notice("保存会话失败：" + ((err && err.message) || err));
    }
  }
  async loadSession(it, c) {
    let e = c || (await this.context());
    try {
      let raw = await this.host.app.vault.read(it.file),
        m = raw.match(/<!--ZHIYANZHE-SESSION-DATA\r?\n([\s\S]*?)\r?\n-->/);
      if (!m) throw new Error("这个 md 里没有会话数据块，可能被手动编辑过。");
      let h = JSON.parse(m[1]);
      if (!Array.isArray(h)) throw new Error("会话数据格式不正确。");
      (this.history = h),
        (this.historyProjectId = e.projectId),
        (this.historyDesignId = this.currentDesignKey()),
        (this.sessionId = it.id),
        (this.pendingEvidence = null),
        (this.compactedSummaryCache = null);
      let g = [...h].reverse().find((v) => v.role === "agent"),
        r = [...h].reverse().find((v) => v.role === "researcher");
      (this.draft = g
        ? {
            message: String(r && r.content != null ? r.content : ""),
            reply: g.content,
          }
        : null),
        await this.persistHistory(e),
        (this.__ts = 1e9),
        new Ge.Notice("已载入会话：" + it.title),
        this.host.rerender();
    } catch (err) {
      new Ge.Notice("载入会话失败：" + ((err && err.message) || err));
    }
  }
  async newSession(c) {
    let e = c || (await this.context());
    if (
      this.history.length &&
      !window.confirm(
        "新建对话会清空当前对话区（未保存的内容会丢失）。继续吗？",
      )
    )
      return;
    try {
      await this.persistHistory(e);
    } catch (_) {}
    this.formalMode === !0 && !this.selectedId
      ? (this.formalTopicId = this.newDialogueTopic("formal"))
      : this.formalMode !== !0 &&
        (this.chatTopicId = this.newDialogueTopic("chat"));
    (this.history = []),
      (this.draft = null),
      (this.sessionId = null),
      (this.pendingEvidence = null),
      (this.compactedSummaryCache = null),
      (this.historyDesignId = this.currentDesignKey()),
      await this.persistHistory(e),
      (this.__ts = 0),
      this.host.rerender();
  }
  async renderSessionList(t, e) {
    let hd = t.createDiv({ cls: "deduction-pane-head deduction-session-head" });
    let dk = this.currentDesignKey(),
      hi = hd.createDiv();
    hi.createEl("h2", { text: "对话记录" }),
      hi.createEl("small", {
        cls: "deduction-session-scope",
        text: this.selectedId
          ? dk
          : this.formalMode === !0
            ? "未绑定设计的临时话题"
            : "普通对话话题",
      });
    let nb = hd.createEl("button", {
      cls: "scholarium-btn",
      text: "＋ 新对话",
    });
    nb.onclick = () => {
      this.newSession(e);
    };
    let list = t.createDiv({ cls: "deduction-session-list" }),
      items = await this.listSessions(e);
    if (!items.length) {
      list.createEl("p", {
        cls: "deduction-empty",
        text:
          dk === "unassigned"
            ? "这条对话线还没有保存的记录。点输入框旁的「保存会话」存成 md。"
            : `${dk} 下还没有保存的对话。点输入框旁的「保存会话」存成 md。`,
      });
      return;
    }
    for (let it of items) {
      let b = list.createEl("button", {
        cls:
          "deduction-session-card" +
          (it.id === this.sessionId ? " is-selected" : ""),
      });
      b.createEl("strong", { text: it.title }),
        b.createEl("small", {
          text:
            (it.updatedAt || "").replace("T", " ").slice(5, 16) +
            " · " +
            it.turns +
            " 条",
        }),
        (b.title = it.title),
        (b.onclick = () => {
          this.loadSession(it, e);
        });
      let op = b.createSpan({ cls: "deduction-session-open", text: "↗" });
      (op.title = "在 Obsidian 中打开该 md"),
        (op.onclick = (ev) => {
          ev.stopPropagation(),
            this.host.app.workspace
              .getLeaf("tab")
              .openFile(it.file, { active: !0 });
        });
    }
  }
  async saveTurn() {
    let t = this.draft;
    if (!t || !t.reply) return;
    let e = await this.context(),
      s = this.selectedId || "unassigned",
      i = new Date().toISOString().replace(/[:.]/g, "-"),
      r = `${e.folder}/03_\u7EC7\u7814\u8005\u5BF9\u8BDD/${s}/${i}.md`,
      n = `---
type: research-theory-turn
project_id: ${$t(e.projectId)}
design_id: ${$t(s)}
created_at: ${$t(new Date().toISOString())}
source: research-deduction-room
---

# \u7EC7\u7814\u8005\u5BF9\u8BDD

## \u7814\u7A76\u5458

${t.message}

## \u7EC7\u7814\u8005\u4E3B Agent

\`\`\`json
${JSON.stringify(t.reply, null, 2)}
\`\`\`
`;
    window.confirm(`\u5C06\u4FDD\u5B58\u672C\u8F6E\u5BF9\u8BDD\uFF08\u4EC5\u65B0\u5EFA\uFF09\uFF1A
${r}

\u786E\u8BA4\u5417\uFF1F`) &&
      (await this.createOnly(r, n),
      new Ge.Notice(
        "\u672C\u8F6E\u7EC7\u7814\u8005\u5BF9\u8BDD\u5DF2\u4FDD\u5B58",
      ));
  }
  async runChatOnly(t, e, s, i) {
    let o = i.textContent;
    (i.disabled = !0),
      i.setText("回复中…"),
      this.history.push({ role: "researcher", content: s });
    try {
      let r =
          e.agents.find((v) => v.id === "codex" && v.installed) ||
          e.agents.find((v) => v.installed),
        n = this.host.app.vault.adapter.getBasePath?.();
      if (!r || !n)
        throw new Error(
          "Bridge 未检测到可用本机 Agent，或当前 Vault 不是桌面本地 Vault。",
        );
      let a = `${n.replace(/[\\/]+$/, "")}\\${t.folder.replace(/\//g, "\\")}`,
        q = `你是 Scholarium 的科研助手，当前是【普通对话模式】。课题背景：${t.title} (${t.projectId})。
严格要求：用中文自然语言简短回答研究员这一句话即可。不要输出 JSON；不要做实验设计或自审计；不要提出任何文献检索式；不要读取或写入任何文件；不要主动展开课题分析。
如果研究员想进入正式推演，告诉他打开输入框下方的「⚗ 织研者模式」按钮，或在消息里写「使用织研者」。
研究员本轮输入：${s}`,
        f = await this.bridgeFetch("/v1/tasks", {
          method: "POST",
          body: JSON.stringify({
            agentId: r.id,
            cwd: a,
            permission: "read",
            execute: !0,
            prompt: q,
          }),
        }),
        w = await this.waitTask(String(f.id));
      this.history.push({
        role: "agent",
        content: {
          chat: !0,
          summary: String(w || "").trim() || "（未返回内容）",
        },
      });
    } catch (err) {
      this.history.push({
        role: "agent",
        content: {
          chat: !0,
          summary: "普通对话失败：" + ((err && err.message) || err),
        },
      });
    }
    try {
      await this.persistHistory(t);
    } catch (_) {}
    (i.disabled = !1), i.setText(o || "发送"), this.softRefresh();
  }
  async activateFormalThread(t) {
    try {
      await this.persistHistory(t);
    } catch (_) {}
    (this.formalMode = !0),
      (await this.restoreFormalTopic(t)),
      (this.history = await this.loadPersistedHistory(t)),
      (this.historyProjectId = t.projectId),
      (this.historyDesignId = this.currentDesignKey()),
      (this.pendingEvidence = null),
      (this.compactedSummaryCache = null),
      (this.draft = null);
  }
  async runTheory(t, e, s, i, fm) {
    if (!e.online) {
      new Ge.Notice("请先连接本机 Bridge。");
      return;
    }
    this.__ts = 1e9;
    return this.runTheoryFormal(t, e, s, i);
  }
  async runTheoryFormal(t, e, s, i) {
    if (!e.online) {
      new Ge.Notice("\u8BF7\u5148\u8FDE\u63A5\u672C\u673A Bridge\u3002");
      return;
    }
    (i.disabled = !0), i.setText("\u7EC7\u7814\u8005\u5BA1\u8BA1\u4E2D\u2026");
    let {
      aiProvider: r,
      aiApiKey: n,
      researchTheoryNativeApi: a,
    } = this.host.plugin.settings;
    a && r === "claude" && n
      ? await this.runTheoryNative(t, e, s, i)
      : await this.runTheoryCli(t, e, s, i);
  }
  async runTheoryCli(t, e, s, i) {
    var l, c, h, d, p, u, g, m;
    let r =
        e.agents.find((v) => v.id === "codex" && v.installed) ||
        e.agents.find((v) => v.installed),
      n =
        (c = (l = this.host.app.vault.adapter).getBasePath) == null
          ? void 0
          : c.call(l);
    if (!r || !n) {
      new Ge.Notice(
        "Bridge \u672A\u68C0\u6D4B\u5230\u53EF\u7528\u672C\u673A Agent\uFF0C\u6216\u5F53\u524D Vault \u4E0D\u662F\u684C\u9762\u672C\u5730 Vault\u3002",
      ),
        (i.disabled = !1),
        i.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005");
      return;
    }
    let a = `${n.replace(/[\\/]+$/, "")}\\${t.folder.replace(/\//g, "\\")}`;
    try {
      this.pendingEvidence = null;
      let v = await this.getCompactedHistory((C) =>
          this.summarizeViaCli(C, r.id, a),
        ),
        f = await this.bridgeFetch("/v1/tasks", {
          method: "POST",
          body: JSON.stringify({
            agentId: r.id,
            cwd: a,
            permission: "read",
            execute: !0,
            prompt: this.protocol(t, s, v),
          }),
        }),
        w = await this.waitTask(String(f.id)),
        b = this.parseReply(w),
        y = [
          ...(((h = b.audit) == null ? void 0 : h.evidence_gaps) || []),
          ...(((d = b.audit) == null ? void 0 : d.feasibility_gaps) || []),
          b.summary || "",
        ].join(" ");
      if (
        !((p = b.evidence_requests) != null && p.length) &&
        /literature|published|external evidence|文献|已发表|外部证据|检索支持/i.test(
          y,
        )
      )
        try {
          let C = `Your previous reply mentioned a missing public-literature / external-evidence gap in audit.evidence_gaps or summary, but evidence_requests was empty. Output ONLY one JSON object with a single field evidence_requests: 1-3 concrete English academic search phrases for that gap. No other fields, no explanation, no code fence: {"evidence_requests":[{"query":"","why":""}]}
previous summary: ${b.summary || ""}
previous evidence_gaps: ${JSON.stringify(((u = b.audit) == null ? void 0 : u.evidence_gaps) || [])}`,
            S = await this.bridgeFetch("/v1/tasks", {
              method: "POST",
              body: JSON.stringify({
                agentId: r.id,
                cwd: a,
                permission: "read",
                execute: !0,
                prompt: C,
              }),
            }),
            k = await this.waitTask(String(S.id)),
            L = schExtractJsonReplyObject(k, "evidence_requests");
          if (
            (g = L == null ? void 0 : L.evidence_requests) != null &&
            g.length
          )
            b.evidence_requests = L.evidence_requests;
          else {
            let I = await this.deriveEvidenceQueryFallback(s, a, e);
            I
              ? (b.evidence_requests = [
                  {
                    query: I,
                    why: "\u81EA\u52A8\u515C\u5E95\uFF1AAgent \u672A\u7ED9\u51FA\u68C0\u7D22\u5F0F\uFF0C\u7CFB\u7EDF\u4ECE\u672C\u8F6E\u95EE\u9898\u63D0\u53D6\u82F1\u6587\u68C0\u7D22\u8BCD",
                  },
                ])
              : this.history.push({
                  role: "evidence",
                  content: {
                    query:
                      "(\u8FFD\u95EE\u4E0E\u515C\u5E95\u90FD\u672A\u8FD4\u56DE\u6709\u6548\u68C0\u7D22\u5F0F)",
                    error: k
                      ? String(k).slice(0, 300)
                      : "Agent \u672A\u8FD4\u56DE\u7ED3\u6784\u5316 JSON",
                  },
                });
          }
        } catch (C) {
          this.history.push({
            role: "evidence",
            content: {
              query: "(\u8FFD\u95EE\u8BF7\u6C42\u5931\u8D25)",
              error: C instanceof Error ? C.message : String(C),
            },
          });
        }
      if (
        (this.history.push({ role: "researcher", content: s }),
        (m = b.evidence_requests) != null && m.length)
      ) {
        let C = await this.searchEvidenceCandidates(b.evidence_requests, a);
        if (
          C.some((A) => {
            var L;
            return (L = A.candidates) == null ? void 0 : L.length;
          })
        ) {
          (this.pendingEvidence = {
            mode: "cli",
            ctx: t,
            message: s,
            pendingReply: b,
            groups: C,
            agentId: r.id,
            cwd: a,
            submit: i,
          }),
            (this.draft = { message: s, reply: null }),
            (this.history = this.history.slice(-60)),
            (i.disabled = !1),
            i.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005"),
            this.softRefresh(),
            await this.persistHistory(t);
          return;
        }
        for (let A of C)
          this.history.push({
            role: "evidence",
            content: { ...A, downloaded: [] },
          });
        let k = C.length
          ? `Automatic literature search completed but found no open-access downloadable full text this round. Treat as leads only:
` + JSON.stringify(C)
          : "";
        k && (b = await this.continueCliTurn(t, r.id, a, k));
      }
      this.history.push({ role: "agent", content: b }),
        (this.history = this.history.slice(-60)),
        (this.draft = { message: s, reply: b }),
        (i.disabled = !1),
        i.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005"),
        this.softRefresh(),
        await this.persistHistory(t);
    } catch (v) {
      new Ge.Notice(
        `\u7EC7\u7814\u8005\u5BF9\u8BDD\u5931\u8D25\uFF1A${v instanceof Error ? v.message : String(v)}`,
      ),
        (i.disabled = !1),
        i.setText("\u91CD\u8BD5\u7EC7\u7814\u8005");
    }
  }
  async continueCliTurn(t, e, s, i) {
    let r =
        `Automatic evidence retrieval has completed. Use the following OpenAlex / open-access results as retrieved evidence or leads. Do not invent unread full-text details. If evidence is still insufficient, ask concise follow-up questions.

` + i,
      n = await this.getCompactedHistory((c) => this.summarizeViaCli(c, e, s)),
      a = await this.bridgeFetch("/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          agentId: e,
          cwd: s,
          permission: "read",
          execute: !0,
          prompt: this.protocol(t, r, n),
        }),
      }),
      l = await this.waitTask(String(a.id));
    return this.parseReply(l);
  }
  async runTheoryNative(t, e, s, i) {
    var a, l, c;
    let r =
      (l = (a = this.host.app.vault.adapter).getBasePath) == null
        ? void 0
        : l.call(a);
    if (!r) {
      new Ge.Notice(
        "\u5F53\u524D Vault \u4E0D\u662F\u684C\u9762\u672C\u5730 Vault\uFF0C\u65E0\u6CD5\u786E\u5B9A\u68C0\u7D22\u5DE5\u4F5C\u76EE\u5F55\u3002",
      ),
        (i.disabled = !1),
        i.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005");
      return;
    }
    let n = `${r.replace(/[\\/]+$/, "")}\\${t.folder.replace(/\//g, "\\")}`;
    try {
      (this.pendingEvidence = null),
        this.history.push({ role: "researcher", content: s });
      let h = await this.runNativeLoop(t, n);
      if ((c = h.evidence_requests) != null && c.length) {
        let d = await this.searchEvidenceCandidates(h.evidence_requests, n);
        if (
          d.some((u) => {
            var g;
            return (g = u.candidates) == null ? void 0 : g.length;
          })
        ) {
          (this.pendingEvidence = {
            mode: "native",
            ctx: t,
            message: s,
            pendingReply: h,
            groups: d,
            agentId: "",
            cwd: n,
            submit: i,
          }),
            (this.draft = { message: s, reply: null }),
            (this.history = this.history.slice(-60)),
            (i.disabled = !1),
            i.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005"),
            this.softRefresh(),
            await this.persistHistory(t);
          return;
        }
        for (let u of d)
          this.history.push({
            role: "evidence",
            content: { ...u, downloaded: [] },
          });
        h = await this.runNativeLoop(
          t,
          n,
          "\u4EE5\u4E0A\u662F\u8865\u5145\u68C0\u7D22\u7ED3\u679C\uFF0C\u672A\u53D1\u73B0\u53EF\u4E0B\u8F7D\u5168\u6587\uFF0C\u4EC5\u4F5C\u7EBF\u7D22\u53C2\u8003\uFF0C\u8BF7\u7ED9\u51FA\u66F4\u65B0\u540E\u7684\u6700\u7EC8 JSON \u56DE\u590D\u3002",
        );
      }
      this.history.push({ role: "agent", content: h }),
        (this.history = this.history.slice(-60)),
        (this.draft = { message: s, reply: h }),
        (i.disabled = !1),
        i.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005"),
        this.softRefresh(),
        await this.persistHistory(t);
    } catch (h) {
      new Ge.Notice(
        `\u7EC7\u7814\u8005\u5BF9\u8BDD\u5931\u8D25\uFF1A${h instanceof Error ? h.message : String(h)}`,
      ),
        (i.disabled = !1),
        i.setText("\u91CD\u8BD5\u7EC7\u7814\u8005");
    }
  }
  async runNativeLoop(t, e, s) {
    var c, h, d, p, u;
    let { aiApiKey: i, aiModel: r } = this.host.plugin.settings;
    if (!i)
      throw new Error(
        "\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u586B\u5199 Claude API Key\u3002",
      );
    let n = this.nativeSystemPrompt(t),
      a = await this.getCompactedHistory((g) => this.summarizeViaNativeApi(g)),
      l = [];
    for (let g of a) {
      let m = this.turnToNativeMessage(g);
      m && l.push(m);
    }
    s && l.push({ role: "user", content: [{ type: "text", text: s }] });
    for (let g = 0; g < 6; g++) {
      let m = await Be(po, {
        method: "POST",
        headers: {
          "x-api-key": i,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: r || "claude-sonnet-5",
          max_tokens: 4096,
          system: n,
          tools: Rd,
          messages: l,
        }),
      });
      if (!m.ok)
        throw new Error(
          `Claude API \u9519\u8BEF ${m.status}: ${await m.text()}`,
        );
      let v = await m.json();
      if (
        (l.push({ role: "assistant", content: v.content }),
        v.stop_reason !== "tool_use")
      ) {
        let w = v.content
          .filter((b) => b.type === "text")
          .map((b) => b.text || "").join(`
`);
        return this.parseReply(w);
      }
      let f = [];
      for (let w of v.content.filter((b) => b.type === "tool_use"))
        if (w.name === "search_literature") {
          let b = String(
              ((c = w.input) == null ? void 0 : c.query) || "",
            ).trim(),
            y = String(((h = w.input) == null ? void 0 : h.why) || ""),
            S = (
              b
                ? await this.searchEvidenceCandidates([{ query: b, why: y }], e)
                : []
            )[0],
            k = S
              ? S.error
                ? `\u68C0\u7D22\u5931\u8D25\uFF1A${S.error}`
                : `\u547D\u4E2D ${(d = S.hit_count) != null ? d : 0} \u6761\uFF0C\u5176\u4E2D ${(u = (p = S.candidates) == null ? void 0 : p.length) != null ? u : 0} \u7BC7\u6709\u5F00\u653E\u83B7\u53D6\u5168\u6587\u53EF\u4F9B\u4E0B\u8F7D\uFF08\u4E0B\u8F7D\u9700\u7814\u7A76\u5458\u786E\u8BA4\uFF09\uFF1A
${
  (S.records || [])
    .slice(0, 6)
    .map(
      (A) =>
        `- ${A.title}${A.year ? ` (${A.year})` : ""}${A.doi ? ` DOI:${A.doi}` : ""}`,
    ).join(`
`) || "\uFF08\u65E0\u7ED3\u679C\uFF09"
}`
              : "\u68C0\u7D22\u5F0F\u4E3A\u7A7A\uFF0C\u672A\u6267\u884C\u68C0\u7D22\u3002";
          S &&
            this.history.push({
              role: "evidence",
              content: { ...S, downloaded: [] },
            }),
            this.softRefresh(),
            f.push({ type: "tool_result", tool_use_id: w.id, content: k });
        } else
          f.push({
            type: "tool_result",
            tool_use_id: w.id,
            content: "\u672A\u77E5\u5DE5\u5177",
            is_error: !0,
          });
      l.push({ role: "user", content: f });
    }
    throw new Error(
      "\u7EC7\u7814\u8005 Agent \u5DE5\u5177\u8C03\u7528\u8F6E\u6B21\u8D85\u9650\uFF0C\u8BF7\u91CD\u8BD5\u6216\u7B80\u5316\u95EE\u9898\u3002",
    );
  }
  nativeSystemPrompt(t) {
    return `\u4F60\u662F"\u7EC7\u7814\u8005\u4E3B Agent"\u3002\u8BFE\u9898\uFF1A${t.title} (${t.projectId})\u3002\u4F60\u53EF\u4EE5\u591A\u6B21\u8C03\u7528 search_literature \u5DE5\u5177\u68C0\u7D22\u5F00\u653E\u83B7\u53D6\u6587\u732E\uFF0C\u5728\u83B7\u5F97\u68C0\u7D22\u7ED3\u679C\u540E\u7EE7\u7EED\u63A8\u7406\u3001\u6309\u9700\u518D\u6B21\u68C0\u7D22\u3002\u5B8C\u6210\u63A8\u7406\u540E\u4E0D\u8981\u518D\u8C03\u7528\u5DE5\u5177\uFF0C\u76F4\u63A5\u4EE5\u7EAF\u6587\u672C\u56DE\u590D\u4E14\u53EA\u5305\u542B\u4E00\u4E2A JSON \u5BF9\u8C61\uFF08\u4E0D\u8981\u7528\u4EE3\u7801\u5757\u5305\u88F9\uFF09\uFF1A{"status":"questions|revise|ready","summary":"","questions":[{"question":"","why":""}],"hypotheses":{"h0":"","h1":"","alternatives":[]},"plan":{"variables":[],"controls":[],"measurements":[],"expected_results":[],"risks":[],"next_action":""},"evidence":{"direct":[],"indirect":[],"unverified":[]},"evidence_requests":[{"query":"","why":""}],"audit":{"passed":false,"evidence_gaps":[],"feasibility_gaps":[]},"design":{"title":"","scientific_question":""}}
\u89C4\u5219\uFF1A\u53EA\u5F15\u7528 search_literature \u5DE5\u5177\u5B9E\u9645\u8FD4\u56DE\u7684\u8D44\u6599\uFF0C\u4E0D\u5F97\u7F16\u9020\u672A\u68C0\u7D22\u5230\u7684\u5185\u5BB9\uFF1B\u672A\u77E5\u5185\u5BB9\u6807\u5F85\u9A8C\u8BC1\uFF1B\u7F3A\u5C11\u5173\u952E\u7EA6\u675F\u65F6\u6700\u591A\u63D0\u51FA 5 \u4E2A\u95EE\u9898\uFF1B\u53EA\u6709 H0/H1\u3001\u66FF\u4EE3\u89E3\u91CA\u3001\u53D8\u91CF\u3001\u5BF9\u7167\u3001\u6D4B\u91CF\u3001\u91CD\u590D/\u7EDF\u8BA1\u3001stop/go\u3001\u98CE\u9669\u9F50\u5907\u4E14 audit.passed=true \u65F6\u624D\u80FD ready\uFF1B\u4E0D\u5F97\u5199\u6587\u4EF6\u3002\u82E5\u4F60\u8BA4\u4E3A\u67D0\u51E0\u7BC7\u68C0\u7D22\u5230\u7684\u5F00\u653E\u83B7\u53D6\u5168\u6587\u503C\u5F97\u4E0B\u8F7D\u7CBE\u8BFB\uFF0C\u628A\u5BF9\u5E94\u68C0\u7D22\u5F0F\u5217\u5165 evidence_requests\uFF0C\u7CFB\u7EDF\u4F1A\u5148\u5F81\u6C42\u7814\u7A76\u5458\u540C\u610F\u540E\u624D\u4E0B\u8F7D\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u4E0B\u8F7D\u3002`;
  }
  turnToNativeMessage(t) {
    return t.role === "researcher"
      ? { role: "user", content: [{ type: "text", text: String(t.content) }] }
      : t.role === "agent"
        ? {
            role: "assistant",
            content: [{ type: "text", text: JSON.stringify(t.content) }],
          }
        : t.role === "evidence"
          ? {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `[literature search result] ${JSON.stringify(t.content)}`,
                },
              ],
            }
          : t.role === "summary"
            ? {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `[earlier conversation summary] ${String(t.content)}`,
                  },
                ],
              }
            : null;
  }
  async summarizeViaNativeApi(t) {
    var n, a;
    let { aiApiKey: e, aiModel: s } = this.host.plugin.settings,
      i = await Be(po, {
        method: "POST",
        headers: {
          "x-api-key": e || "",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: s || "claude-sonnet-5",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `\u4EE5\u4E0B\u662F\u66F4\u65E9\u7684\u7EC7\u7814\u8005\u5BF9\u8BDD\u5386\u53F2\uFF08JSON \u6570\u7EC4\uFF09\uFF0C\u8BF7\u538B\u7F29\u4E3A\u4E0D\u8D85\u8FC7 300 \u5B57\u7684\u4E2D\u6587\u6458\u8981\uFF0C\u4FDD\u7559\u5173\u952E\u5047\u8BBE\u3001\u5DF2\u786E\u8BA4\u8BC1\u636E\u7ED3\u8BBA\u548C\u672A\u51B3\u95EE\u9898\uFF1B\u53EA\u8F93\u51FA\u6458\u8981\u6B63\u6587\uFF1A
${t}`,
            },
          ],
        }),
      });
    if (!i.ok)
      throw new Error(`\u6458\u8981\u8BF7\u6C42\u5931\u8D25 (${i.status})`);
    return (a =
      (n = (await i.json()).content.find((l) => l.type === "text")) == null
        ? void 0
        : n.text) != null
      ? a
      : "";
  }
  async finalizePendingEvidence(t) {
    let e = this.pendingEvidence;
    if (!e) return;
    this.pendingEvidence = null;
    let s = e.groups.length;
    for (let n of e.groups) {
      if (n.error) {
        this.history.push({ role: "evidence", content: n });
        continue;
      }
      let a = [];
      if (!t)
        for (let l of (n.candidates || []).filter((c) => c.selected !== !1))
          try {
            a.push(
              await this.bridgeFetch(`/v1/literature/${n.search_id}/download`, {
                method: "POST",
                body: JSON.stringify({
                  openalexId: l.openalex_id,
                  confirm: !0,
                }),
              }),
            );
          } catch (c) {
            a.push({
              title: l.title,
              error: c instanceof Error ? c.message : String(c),
            });
          }
      this.history.push({
        role: "evidence",
        content: {
          query: n.query,
          why: n.why,
          search_id: n.search_id,
          hit_count: n.hit_count,
          records: n.records,
          downloaded: a,
        },
      });
    }
    let i = this.history.filter((n) => n.role === "evidence").slice(-s),
      r = i.length
        ? (t
            ? `Literature search completed. The researcher reviewed the candidates and chose NOT to download any full text this round; treat the following as unread leads only, not verified evidence:
`
            : `Automatic literature evidence retrieval results (researcher reviewed the candidate list and approved the following downloads):
`) + JSON.stringify(i.map((n) => n.content))
        : "";
    await this.continueAfterEvidence(e, r, t);
  }
  async continueAfterEvidence(t, e, s) {
    let i = t.pendingReply;
    if (e)
      try {
        i =
          t.mode === "native"
            ? await this.runNativeLoop(
                t.ctx,
                t.cwd,
                s
                  ? "\u4EE5\u4E0A\u4E3A\u7814\u7A76\u5458\u9009\u62E9\u4E0D\u4E0B\u8F7D\u7684\u68C0\u7D22\u7EBF\u7D22\uFF0C\u8BF7\u7ED9\u51FA\u66F4\u65B0\u540E\u7684\u6700\u7EC8 JSON \u56DE\u590D\u3002"
                  : "\u4EE5\u4E0A\u4E3A\u7814\u7A76\u5458\u5DF2\u786E\u8BA4\u4E0B\u8F7D\u7684\u68C0\u7D22\u7ED3\u679C\uFF0C\u8BF7\u7ED9\u51FA\u66F4\u65B0\u540E\u7684\u6700\u7EC8 JSON \u56DE\u590D\u3002",
              )
            : await this.continueCliTurn(t.ctx, t.agentId, t.cwd, e);
      } catch (r) {
        new Ge.Notice(
          `\u7EC7\u7814\u8005\u7EE7\u7EED\u5931\u8D25\uFF1A${r instanceof Error ? r.message : String(r)}`,
        );
      }
    this.history.push({ role: "agent", content: i }),
      (this.history = this.history.slice(-60)),
      (this.draft = { message: t.message, reply: i }),
      t.submit &&
        ((t.submit.disabled = !1),
        t.submit.setText("\u53D1\u9001\u7ED9\u7EC7\u7814\u8005")),
      this.softRefresh(),
      await this.persistHistory(t.ctx);
  }
  async searchEvidenceCandidates(t, e) {
    let s = (Array.isArray(t) ? t : [])
      .map((r) => (typeof r == "string" ? { query: r } : r))
      .filter(
        (r) =>
          r &&
          String(r.query || r.search_query || r.topic || "").trim().length >= 3,
      )
      .slice(0, 3);
    if (!s.length) return [];
    let i = [];
    for (let r of s) {
      let n = String(r.query || r.search_query || r.topic || "")
        .trim()
        .slice(0, 8e3);
      try {
        new Ge.Notice(`Research-theory evidence search: ${n.slice(0, 80)}`);
        let a = await this.bridgeFetch("/v1/literature/search", {
            method: "POST",
            body: JSON.stringify({ workspace: e, query: n }),
          }),
          l = a.manifest || {},
          c = Array.isArray(l.records)
            ? l.records
            : Array.isArray(a.records)
              ? a.records
              : [],
          h = Math.max(1, Math.min(Number(r.max_results) || 8, 12)),
          d = c
            .slice(0, h)
            .map((u) => ({
              title: String(u.title || ""),
              year: u.year || u.publication_year || "",
              doi: String(u.doi || ""),
              openalex_id: String(u.openalex_id || u.id || ""),
              is_oa: !!u.is_oa,
              pdf_url: String(u.pdf_url || ""),
            })),
          p = d
            .filter((u) => u.is_oa && u.pdf_url && u.openalex_id)
            .slice(0, 6)
            .map((u) => ({ ...u, selected: !0 }));
        i.push({
          query: n,
          why: r.why || "",
          search_id: String(a.id || ""),
          hit_count: Number(l.total || l.count || c.length),
          records: d,
          candidates: p,
        });
      } catch (a) {
        i.push({
          query: n,
          why: r.why || "",
          error: a instanceof Error ? a.message : String(a),
          records: [],
          candidates: [],
        });
      }
    }
    return i;
  }
  async deriveEvidenceQueryFallback(t, e, s) {
    var i;
    try {
      let n = ((await this.bridgeFetch("/v1/skills")).skills || []).find(
        (a) => a.name === "research-query-builder",
      );
      if (n) {
        let l = (
            await this.bridgeFetch("/v1/skills/run", {
              method: "POST",
              body: JSON.stringify({ skillId: n.id, workspace: e, input: t }),
            })
          ).manifest,
          c = l == null ? void 0 : l.concept_matrix;
        if (
          Array.isArray(c) &&
          c.length &&
          !(
            c.length === 1 &&
            ((i = c[0]) == null ? void 0 : i.block) === "topic"
          )
        ) {
          let h = Array.from(
            new Set(
              c.flatMap((d) =>
                (d.terms || []).map((p) => String(p).replace(/[*"]/g, "")),
              ),
            ),
          )
            .slice(0, 14)
            .join(" ");
          if (h) return h;
        }
      }
    } catch (r) {}
    try {
      let r =
        s.agents.find((l) => l.id === "codex" && l.installed) ||
        s.agents.find((l) => l.installed);
      if (!r) return "";
      let n = await this.bridgeFetch("/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          agentId: r.id,
          cwd: e,
          permission: "read",
          execute: !0,
          prompt: `Translate the following research question into 3 to 6 concise English academic search keyword phrases suitable for OpenAlex title/abstract search. Output only the keyword phrases separated by spaces, no explanation, no punctuation, no quotes, no Chinese characters: ${t}`,
        }),
      });
      return (await this.waitTask(String(n.id)))
        .replace(/[`"\n]/g, " ")
        .trim()
        .slice(0, 300);
    } catch (r) {
      return "";
    }
  }
  async getCompactedHistory(t) {
    let r = this.history.map((c) => {
      if (JSON.stringify(c).length <= 1200) return c;
      if (c.role === "evidence") {
        let d = c.content;
        return {
          role: "evidence",
          content: {
            query: d.query,
            hit_count: d.hit_count,
            downloaded: (d.downloaded || []).length,
            titles: (d.records || []).slice(0, 3).map((p) => p.title),
          },
        };
      }
      return {
        role: c.role,
        content: JSON.stringify(c.content).slice(0, 1200),
      };
    });
    if (JSON.stringify(r).length <= 9e3) return r;
    let n = 0;
    for (; JSON.stringify(r.slice(n)).length > 9e3 && r.length - n > 4; ) n++;
    let a = r.slice(0, n),
      l = r.slice(n);
    if (!a.length) return l;
    if (
      this.compactedSummaryCache &&
      this.compactedSummaryCache.forTurnCount === n
    )
      return [
        { role: "summary", content: this.compactedSummaryCache.text },
        ...l,
      ];
    try {
      let c =
        (await t(JSON.stringify(a).slice(0, 12e3))).trim().slice(0, 600) ||
        "\uFF08\u65E9\u671F\u5BF9\u8BDD\u6458\u8981\u4E3A\u7A7A\uFF09";
      return (
        (this.compactedSummaryCache = { forTurnCount: n, text: c }),
        [{ role: "summary", content: c }, ...l]
      );
    } catch (c) {
      return l;
    }
  }
  async summarizeViaCli(t, e, s) {
    let i = `\u4EE5\u4E0B\u662F\u540C\u4E00\u7EC7\u7814\u8005\u8BBE\u8BA1\u7EBF\u7A0B\u7684\u66F4\u65E9\u5BF9\u8BDD\u5386\u53F2\uFF08JSON \u6570\u7EC4\uFF09\uFF0C\u8BF7\u538B\u7F29\u4E3A\u4E0D\u8D85\u8FC7 300 \u5B57\u7684\u4E2D\u6587\u6458\u8981\uFF0C\u53EA\u4FDD\u7559\u672C\u7EBF\u7A0B\u7684\u5173\u952E\u5047\u8BBE\u3001\u5DF2\u786E\u8BA4\u8BC1\u636E\u7ED3\u8BBA\u548C\u672A\u51B3\u95EE\u9898\uFF1B\u4E0D\u5F97\u5F15\u5165\u3001\u63A8\u6D4B\u6216\u4FDD\u7559\u5176\u4ED6\u8BDD\u9898\u3001\u666E\u901A\u5BF9\u8BDD\u6216\u5176\u4ED6\u8BBE\u8BA1\u7684\u5047\u8BBE\u3002\u53EA\u8F93\u51FA\u6458\u8981\u6B63\u6587\uFF1A
${t}`,
      r = await this.bridgeFetch("/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          agentId: e,
          cwd: s,
          permission: "read",
          execute: !0,
          prompt: i,
        }),
      });
    return await this.waitTask(String(r.id));
  }
  newDialogueTopic(t) {
    return (
      t +
      "-" +
      Date.now().toString(36) +
      "-" +
      Math.random().toString(36).slice(2, 8)
    );
  }
  ensureFormalTopic() {
    return (
      this.selectedId ||
      this.formalTopicId ||
      (this.formalTopicId = this.newDialogueTopic("formal"))
    );
  }
  async restoreActiveFormalTopic(t) {
    if (this.selectedId || this.formalTopicId) return !1;
    try {
      let e = await this.host.plugin.loadData(),
        s = e == null ? void 0 : e.researchDeduction,
        i = s == null ? void 0 : s[t.projectId],
        r = i == null ? void 0 : i.activeFormalTopicId;
      typeof r == "string" && /^formal-[a-z0-9-]+$/i.test(r) &&
        ((this.formalTopicId = r), (this.unboundFormal = !0));
    } catch (_) {}
    return !!this.formalTopicId;
  }
  async restoreFormalTopic(t) {
    if (this.formalMode !== !0 || this.selectedId) return;
    await this.restoreActiveFormalTopic(t);
    this.ensureFormalTopic();
  }
  currentDesignKey() {
    return this.formalMode === !0
      ? this.ensureFormalTopic()
      : this.chatTopicId || "chat-default";
  }
  softRefresh() {
    let c = this.__elTranscript;
    if (!c || !c.isConnected) return this.host.rerender(), !0;
    c.empty(), this.renderDraft(c);
    let p = this.__elPlanPane;
    if (p && p.isConnected) {
      let old = p.querySelector(".deduction-draft-actions");
      old && old.remove(), this.renderDraftActions(p);
    }
    return (
      window.requestAnimationFrame(() => {
        c.isConnected &&
          (c.scrollTop =
            typeof this.__ts == "number" ? this.__ts : c.scrollHeight);
      }),
      !0
    );
  }
  async loadPersistedHistory(t) {
    try {
      let e = await this.host.plugin.loadData(),
        s = e == null ? void 0 : e.researchDeduction,
        i = s == null ? void 0 : s[t.projectId],
        k = this.currentDesignKey(),
        th = i && i.threads && i.threads[k];
      return (
        !th &&
          k === "unassigned" &&
          Array.isArray(i == null ? void 0 : i.history) &&
          (th = { history: i.history, sessionId: i.sessionId || null }),
        (this.sessionId = (th && th.sessionId) || null),
        Array.isArray(th == null ? void 0 : th.history) ? th.history : []
      );
    } catch (e) {
      return (this.sessionId = null), [];
    }
  }
  async persistHistory(t) {
    try {
      let e = (await this.host.plugin.loadData()) || {},
        s = e.researchDeduction || {};
      let p = s[t.projectId] || {},
        th = p.threads || {},
        i = this.currentDesignKey();
      (th[i] = {
        history: this.history.slice(-60),
        sessionId: this.sessionId || null,
        updatedAt: new Date().toISOString(),
      }),
        this.formalMode === !0 &&
          !this.selectedId &&
          /^formal-[a-z0-9-]+$/i.test(i) &&
          (p.activeFormalTopicId = i),
        (p.threads = th),
        (p.updatedAt = new Date().toISOString()),
        (s[t.projectId] = p),
        (e.researchDeduction = s),
        await this.host.plugin.saveData(e);
    } catch (e) {
      console.warn(
        "[Scholarium] \u7EC7\u7814\u8005\u5BF9\u8BDD\u6301\u4E45\u5316\u5931\u8D25",
        e,
      );
    }
  }
  parseReply(t) {
    let e = schExtractJsonReplyObject(t, "status");
    return e
      ? e
      : {
          status: "questions",
          summary: t,
          audit: {
            passed: !1,
            evidence_gaps: [
              "Agent \u672A\u8FD4\u56DE\u53EF\u89E3\u6790\u7684\u7ED3\u6784\u5316 JSON",
            ],
          },
        };
  }
  protocol(t, e, s) {
    return `\u4F60\u662F"\u7EC7\u7814\u8005\u4E3B Agent"\u3002\u8BFE\u9898\uFF1A${t.title} (${t.projectId})\u3002\u5386\u53F2\uFF1A${JSON.stringify(s)}\u3002\u7814\u7A76\u5458\u672C\u8F6E\u8F93\u5165\uFF1A${e}
\u89C4\u5219\uFF1A\u53EA\u5F15\u7528\u5B9E\u9645\u8BFB\u53D6\u7684\u672C\u5730\u8D44\u6599\uFF1B\u672A\u77E5\u5185\u5BB9\u6807\u5F85\u9A8C\u8BC1\uFF1B\u7F3A\u5C11\u5173\u952E\u7EA6\u675F\u65F6\u6700\u591A\u63D0\u51FA 5 \u4E2A\u95EE\u9898\uFF1B\u53EA\u6709 H0/H1\u3001\u66FF\u4EE3\u89E3\u91CA\u3001\u53D8\u91CF\u3001\u5BF9\u7167\u3001\u6D4B\u91CF\u3001\u91CD\u590D/\u7EDF\u8BA1\u3001stop/go\u3001\u98CE\u9669\u9F50\u5907\u4E14 audit.passed=true \u65F6\u624D\u80FD ready\u3002
\u5982\u679C\u81EA\u5BA1\u8BA1 evidence_gaps \u6216 summary \u63D0\u5230\u7F3A\u5C11\u516C\u5F00\u53D1\u8868\u7684\u6587\u732E/\u5916\u90E8\u8BC1\u636E\uFF0C\u5219 evidence_requests \u5FC5\u987B\u975E\u7A7A\uFF0C\u81F3\u5C11\u7ED9\u51FA\u4E00\u4E2A\u5177\u4F53\u7684\u82F1\u6587\u5B66\u672F\u68C0\u7D22\u77ED\u8BED\uFF1B\u4E0D\u5141\u8BB8\u4E00\u8FB9\u5728 evidence_gaps \u91CC\u5199\u7F3A\u6587\u732E\u3001\u4E00\u8FB9\u628A evidence_requests \u7559\u7A7A\u3002
如果当前课题下有可执行的已批准动作，可以在 action_requests 里最多提议 3 个；面板会逐项展示输入和理由，只有研究员点击“确认执行”后才会进入 Scholarium 队列，你自己不直接写入任何文件。可提议的 type 只有以下九种：rss.refresh_feed、rss.score_feed、rss.clip_high_score（三者的 input 都是 {"feed_id":""}）；rss.fetch_pdf（{"pdf_url":"https://...pdf","file_name":"可选.pdf","title":"可选标题"}，只能使用已经得到的直接 PDF URL，不能编造 URL）；rss.clip_url（{"url":"https://...","title":"可选标题"}）；rss.set_article_score（{"article_id":"","overall_score":0-100,"reason":""}，reason 必填）；rss.mark_article（{"article_id":"","read":true/false 可选,"starred":true/false 可选，至少给一个标记）；sch-data-plot（input 为 {"data_path":"","x_column":"","y_columns":[],"plot_kind":"","title":"","chart_style":{"theme":"publication|soft|dark","markers":"auto|all|none","show_grid":true,"line_width":2.6}}，对指定 CSV/TSV 生成图表；chart_style 只允许视觉美化，禁止平滑、筛选或修改测量值；只读源数据，只写入插件设置中配置的素材库根目录/_analysis/（默认 Materials/_analysis/）；sch-data-profile-audit（input 为 {"data_path":""}，对指定 CSV/TSV 生成字段画像审计，同样只读源数据）。不确定当前课题下有哪些可用的 feed_id、article_id、直接 PDF URL 或 data_path 时，先在 questions 里问，不要瞎猜；没有要提议的动作时 action_requests 给空数组。
\u53EA\u8F93\u51FA JSON\uFF1A{"status":"questions|revise|ready","summary":"","questions":[{"question":"","why":""}],"hypotheses":{"h0":"","h1":"","alternatives":[]},"plan":{"variables":[],"controls":[],"measurements":[],"expected_results":[],"risks":[],"next_action":""},"evidence":{"direct":[],"indirect":[],"unverified":[]},"evidence_requests":[{"query":"","why":""}],"action_requests":[{"type":"","input":{},"why":""}],"audit":{"passed":false,"evidence_gaps":[],"feasibility_gaps":[]},"design":{"title":"","scientific_question":""}}`;
  }
  async bridgeState() {
    try {
      return {
        online: !0,
        agents: (await this.bridgeFetch("/v1/agents")).agents || [],
      };
    } catch (t) {
      return {
        online: !1,
        agents: [],
        error: t instanceof Error ? t.message : String(t),
      };
    }
  }
  async bridgeFetch(t, e = {}) {
    const __base = await schDeductionBridgeBase(this.host);
    let { timeoutMs: __tm = 15e3, ...__opt } = e,
      __ac = new AbortController(),
      __ti = window.setTimeout(() => __ac.abort(), __tm),
      s;
    try {
      s = await fetch(`${__base}${t}`, {
        ...__opt,
        signal: __ac.signal,
        headers: { "content-type": "application/json", ...__opt.headers },
      });
    } catch (__e2) {
      throw __ac.signal.aborted
        ? new Error(`Bridge 请求超时（${Math.round(__tm / 1e3)} 秒）：${t}`)
        : __e2;
    } finally {
      window.clearTimeout(__ti);
    }
    let i = await s.json();
    if (!s.ok)
      throw new Error(
        String(i.error || `Bridge \u8BF7\u6C42\u5931\u8D25 (${s.status})`),
      );
    return i;
  }
  async waitTask(t) {
    var e, s;
    for (let i = 0; i < 600; i++) {
      let r = await this.bridgeFetch(`/v1/tasks/${t}`),
        n = String(r.status || "");
      if (["completed", "failed", "cancelled"].includes(n)) {
        let a = Array.isArray(r.events) ? r.events : [];
        if (n !== "completed")
          throw new Error(
            ((e = a.filter((l) => l.type === "error").at(-1)) == null
              ? void 0
              : e.text) || `\u4EFB\u52A1\u7ED3\u675F\uFF1A${n}`,
          );
        return (
          ((s = a.filter((l) => l.type === "result").at(-1)) == null
            ? void 0
            : s.text) ||
          "\u4EFB\u52A1\u5B8C\u6210\uFF0C\u4F46\u672A\u8FD4\u56DE\u7ED3\u679C\u3002"
        );
      }
      await new Promise((a) => window.setTimeout(a, 900));
    }
    throw new Error("\u7B49\u5F85\u7EC7\u7814\u8005 Agent \u8D85\u65F6");
  }
  async nextId(t) {
    let e = (await this.designs(t)).map((s) => {
      var i;
      return (
        Number((i = s.id.match(/EXP-D-(\d+)/)) == null ? void 0 : i[1]) || 0
      );
    });
    return `EXP-D-${String((e.length ? Math.max(...e) : 0) + 1).padStart(3, "0")}`;
  }
  async createOnly(t, e) {
    let s = t.split("/");
    if (
      (s.pop(),
      await mo(this.host.app, s.join("/")),
      this.host.app.vault.getAbstractFileByPath(t))
    )
      throw new Error(
        "\u76EE\u6807\u6587\u4EF6\u5DF2\u7ECF\u5B58\u5728\uFF0C\u5DF2\u53D6\u6D88\u4EE5\u907F\u514D\u8986\u76D6\u3002",
      );
    await this.host.app.vault.create(t, e);
  }
  markdown(t, e, s, i, r, n = "") {
    return `---
type: experiment-design
design_id: ${$t(t)}
project_id: ${$t(e)}
title: ${$t(s)}
status: ${$t(i)}
version: "v1.0"
source: research-deduction-room
confirmed_at: ${$t(new Date().toISOString())}
audit_passed: ${r}
tags: []
---

# ${s}
${
  n ||
  `
## \u79D1\u5B66\u95EE\u9898

\u5F85\u901A\u8FC7\u7EC7\u7814\u8005\u5BF9\u8BDD\u8865\u5145\u3002

## \u6838\u5FC3\u5047\u8BBE\uFF08H0 / H1\uFF09

- **H0**\uFF1A\u5F85\u9A8C\u8BC1\u3002
- **H1**\uFF1A\u5F85\u9A8C\u8BC1\u3002

## \u7ADE\u4E89\u89E3\u91CA / \u66FF\u4EE3\u5047\u8BBE

\u5F85\u9A8C\u8BC1\u3002

## \u5173\u952E\u53D8\u91CF\u8BBE\u8BA1

| \u53D8\u91CF | \u8BBE\u7F6E | \u76EE\u7684 |
| --- | --- | --- |
| \u5F85\u8865\u5145 | \u5F85\u8865\u5145 | \u5F85\u8865\u5145 |

## \u5BF9\u7167\u5B9E\u9A8C\u7EC4

| \u7EC4\u522B | \u8BBE\u7F6E | \u6392\u9664\u7684\u6548\u5E94 |
| --- | --- | --- |
| \u5F85\u8865\u5145 | \u5F85\u8865\u5145 | \u5F85\u8865\u5145 |

## \u8868\u5F81\u4E0E\u6D4B\u8BD5

\u5F85\u8865\u5145\u3002

## \u9884\u671F\u7ED3\u679C

\u5F85\u8865\u5145\u3002

## \u6F5C\u5728\u98CE\u9669\u4E0E\u5BF9\u7B56

\u5F85\u8865\u5145\u3002

## \u4E0B\u4E00\u6B65\u8BA1\u5212

\u5148\u5728\u7EC7\u7814\u8005\u5BF9\u8BDD\u4E2D\u8865\u9F50\u8BC1\u636E\u3001\u7EA6\u675F\u4E0E\u51B3\u7B56\u95E8\u3002

## \u8BC1\u636E\u8303\u56F4

- **\u76F4\u63A5\u8BC1\u636E**\uFF1A\u5F85\u8865\u5145\u3002
- **\u95F4\u63A5\u7EBF\u7D22**\uFF1A\u5F85\u8865\u5145\u3002
- **\u5F85\u9A8C\u8BC1**\uFF1A\u5F85\u8865\u5145\u3002
`
}`;
  }
};

export { yi as ResearchDeductionRoom };
export type ResearchDeductionRoom = InstanceType<typeof yi>;
