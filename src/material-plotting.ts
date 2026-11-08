// @ts-nocheck -- Legacy JavaScript port pending incremental type migration.
/* global schRuntimeBootstrap, SCHOLARIUM_LOGO_DATA_URL */
/* Deterministic Material Library normalization and plotting.  The Bridge may
 * run only reviewed Skills; natural-language patches are reduced to a bounded
 * style schema and never become executable code. */
import * as De from "obsidian";
import { schMaterialsRoot } from "./folders";
import { schRuntimeRoot } from "./runtime-manager";
import { schMaterialBridgeJson, schMaterialRunPlotAgent } from "./material-bridge";
const Eo = De;
const Y = De;
function Ml() {
  return `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

function schMaterialIsPlotData(item) {
  // TXT/DAT are plotted directly: generate_plot.py has sniffed their separator
  // since 27ea568, skipping leading comment lines and refusing an ambiguous
  // file rather than guessing, and it records the detected separator in the
  // manifest. Routing them through normalization first added a second,
  // redundant CSV for no extra provenance. XLSX still cannot be read as text.
  return !!item && /\.(csv|tsv|txt|dat)$/i.test(String(item.path || ""));
}
function schMaterialNeedsNormalization(item) {
  return !!item && /\.(xlsx)$/i.test(String(item.path || ""));
}
function schMaterialIsTiff(item) {
  return !!item && /\.(tif|tiff)$/i.test(String(item.path || ""));
}
async function schMaterialOpenTiff(app, path) {
  try {
    if (typeof app?.openWithDefaultApp === "function") await app.openWithDefaultApp(path);
    else if (typeof app?.showInFolder === "function") app.showInFolder(path);
    else throw new Error("当前 Obsidian 版本不支持调用系统默认程序");
  } catch (error) {
    new De.Notice(`TIFF 无法在素材库内预览；请用系统默认程序打开。${error?.message ? `（${error.message}）` : ""}`);
  }
}
function schMaterialDelimitedHeader(text, ext) {
  const suffix = String(ext || "").toLowerCase();
  const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
  let skipped = 0;
  if (suffix === "txt" || suffix === "dat") {
    while (skipped < lines.length) {
      const value = lines[skipped].trim();
      if (value && !["#", "%", "!", "//"].some((prefix) => value.startsWith(prefix))) break;
      skipped++;
    }
  }
  const sample = lines.slice(skipped).filter((line) => line.trim()).slice(0, 20);
  if (!sample.length) return [];
  let delimiter = suffix === "tsv" ? "\t" : ",";
  if (suffix === "txt" || suffix === "dat") {
    const candidates = [["\t", "tab"], [",", "comma"], [";", "semicolon"]]
      .map(([value, label]) => {
        const counts = new Set(sample.map((line) => line.split(value).length));
        return counts.size === 1 && [...counts][0] >= 2 ? { value, label, columns: [...counts][0] } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.columns - left.columns);
    if (candidates.length > 1 && candidates[0].columns === candidates[1].columns)
      throw new Error(`列分隔符存在歧义：${candidates[0].label} 与 ${candidates[1].label} 都得到 ${candidates[0].columns} 列；请另存为 CSV/TSV 后重试`);
    if (candidates.length) delimiter = candidates[0].value;
    else {
      const counts = new Set(sample.map((line) => line.trim().split(/[ \t]+/).length));
      if (counts.size !== 1 || [...counts][0] < 2)
        throw new Error("无法确定 TXT/DAT 的列分隔符；请另存为 CSV/TSV 后重试");
      delimiter = "whitespace";
    }
  }
  const line = sample[0];
  if (delimiter === "whitespace") return line.trim().split(/[ \t]+/).filter(Boolean);
  const out = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { out.push(value.trim()); value = ""; }
    else value += char;
  }
  out.push(value.trim());
  return out.filter(Boolean);
}
async function schMaterialReadDelimitedText(plugin, file) {
  const binary = await plugin.app.vault.adapter.readBinary(file.path);
  const bytes = binary instanceof ArrayBuffer
    ? new Uint8Array(binary)
    : (ArrayBuffer.isView(binary)
      ? new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength)
      : new Uint8Array(binary));
  const encodings = ["utf-8", "gb18030", "gbk"];
  for (const encoding of encodings) {
    try {
      const text = new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
      return { text, encoding: encoding === "utf-8" ? "UTF-8" : encoding.toUpperCase() };
    } catch (_) { /* try the next explicitly supported legacy encoding */ }
  }
  throw new Error("无法识别 CSV/TSV 编码；请将文件另存为 UTF-8、GB18030 或 GBK 后重试");
}
/* ===== 织研者 Agent 环境面板 =========================================== *
   One settings section that answers the only question that matters before a
   task is dispatched: will this agent actually answer, and if not, what is
   wrong with it.

   It shows, per agent: whether the binary is there, whether it RUNS (a real
   --version probe, not a PATH hit), which provider it is pointed at, and what
   credential it will use. The distinction between "installed" and "runs" is
   the whole point — openclaw sits on this machine's PATH and exits 1 because
   the Node version is too old, and the old agent picker showed it as
   available.

   On credentials, this panel reads and never writes. Claude Code, Codex and
   the rest already resolve their own keys from their own config files, and on
   a machine with CC Switch it is CC Switch that writes those files. A second
   copy stored by this plugin would live in the vault — which syncs — and
   would silently disagree with CC Switch the moment the user switched
   provider in the tray. So the panel points at the file that is actually in
   effect and sends the user to CC Switch to change it. Keys are shown masked;
   the full value is never requested from the Bridge and never rendered. */

const SCH_AGENT_STATE = {
  ready: { text: "可用", cls: "sch-agent-ok" },
  no_credential: { text: "缺少凭据", cls: "sch-agent-warn" },
  broken: { text: "装了但跑不起来", cls: "sch-agent-bad" },
  missing: { text: "未安装", cls: "sch-agent-muted" },
};

async function schAgentEnvFetch(plugin, path, options) {
  return schMaterialBridgeJson(plugin, path, options);
}

/* The Bridge is the only thing that can answer these questions, because it is
   the process that will actually spawn the agent. When it is not running the
   panel says so plainly instead of rendering an empty, falsely-calm table. */
function schRenderAgentEnvironment(containerEl, plugin) {
  new Y.Setting(containerEl).setName("\u{1F916} Agent 环境").setHeading();
  const intro = containerEl.createEl("p", {
    text: "检查本机安装了哪些科研 Agent、它们能否真的运行，以及它们当前指向哪个供应商。密钥由 Agent 自身的配置文件（或 CC Switch）管理，本插件只读不存。",
  });
  intro.setCssStyles({color: "var(--text-muted)"});
  intro.setCssStyles({fontSize: "12px"});

  const bar = containerEl.createDiv();
  bar.addClass("sch-agent-actions");
  const refresh = bar.createEl("button", { text: "重新检测" });
  refresh.addClass("mod-cta");
  const hint = bar.createSpan();
  hint.setCssStyles({fontSize: "12px"});
  hint.setCssStyles({color: "var(--text-muted)"});

  const body = containerEl.createDiv();

  const render = async (force) => {
    body.empty();
    hint.setText("正在检测…");
    let report;
    try {
      report = await schAgentEnvFetch(plugin, "/v1/agents/environment" + (force ? "?refresh=1" : ""));
    } catch (error) {
      hint.setText("");
      const failed = body.createEl("p", {
        text: "无法连接本机 Bridge：" + String(error.message || error)
          + "。请先在织研者面板里连接 Bridge，再回到这里检测。",
      });
      failed.setCssStyles({color: "var(--text-error)"});
      failed.setCssStyles({fontSize: "12px"});
      return;
    }
    hint.setText(report.cachedAt ? "上次检测：" + new Date(report.cachedAt).toLocaleString() : "");

    for (const agent of report.agents || []) {
      const state = SCH_AGENT_STATE[agent.readiness] || SCH_AGENT_STATE.missing;
      const row = body.createDiv();
      row.addClass("sch-agent-row");

      const head = row.createDiv();
      head.addClass("sch-agent-head");
      head.createSpan({ text: agent.label || agent.key }).addClass("sch-agent-name");
      const pill = head.createSpan({ text: state.text });
      pill.addClass("sch-agent-pill");
      pill.addClass(state.cls);
      if (agent.version) {
        const v = head.createSpan({ text: agent.version });
        v.setCssStyles({fontSize: "12px"});
        v.setCssStyles({color: "var(--text-muted)"});
      }

      const meta = row.createDiv();
      meta.addClass("sch-agent-meta");
      const lines = [];
      if (agent.command) lines.push("路径：" + agent.command + (agent.source ? "（" + agent.source + "）" : ""));
      if (agent.provider) {
        lines.push("供应商：" + agent.provider.name
          + (agent.baseUrl ? "  →  " + agent.baseUrl : "")
          + (agent.model ? "  ·  " + agent.model : ""));
        if (agent.provider.note) lines.push("⚠ " + agent.provider.note);
      } else if (agent.baseUrl) {
        lines.push("接口地址：" + agent.baseUrl + (agent.model ? "  ·  " + agent.model : ""));
      }
      if (agent.credential && agent.credential.mode !== "unknown") {
        const modes = { api_key: "API 密钥", oauth_login: "登录态", none: "无" };
        lines.push("凭据：" + (modes[agent.credential.mode] || agent.credential.mode)
          + (agent.credential.masked ? "（" + agent.credential.masked + "）" : "")
          + (agent.credential.source ? "  ←  " + agent.credential.source : ""));
      }
      if (agent.configFile) lines.push("配置文件：" + agent.configFile);
      meta.setText(lines.join("\n"));
      meta.setCssStyles({whiteSpace: "pre-wrap"});

      if (agent.problem) {
        const problem = row.createDiv();
        problem.addClass("sch-agent-problem");
        problem.setText(agent.problem);
      }

      schAgentRowActions(row, plugin, agent, render);
    }

    schRenderCcSwitch(body, report.ccSwitch || {});
  };

  refresh.onclick = () => { render(true); };
  render(false);
  schRenderCredentials(containerEl, plugin);
}

/* Actions differ by failure mode, and that is deliberate.

   A 'broken' agent does NOT get an install button. openclaw is installed and
   refuses to start because the Node runtime is too old; offering "安装" there
   would send the user around a loop that cannot terminate — npm would happily
   reinstall the same package and it would fail the same way. The panel says
   what is actually wrong and offers the manual path override instead. */
function schAgentRowActions(row, plugin, agent, rerender) {
  const actions = row.createDiv();
  actions.addClass("sch-agent-actions");

  if (agent.readiness === "missing") {
    const dir = actions.createEl("input", { type: "text" });
    dir.placeholder = "安装到哪个文件夹（绝对路径）";
    const install = actions.createEl("button", { text: "安装" });
    install.onclick = async () => {
      const directory = String(dir.value || "").trim();
      if (!directory) { new Y.Notice("请先填写安装文件夹。"); return; }
      install.disabled = true;
      const log = row.createDiv();
      log.addClass("sch-agent-log");
      log.setText("正在安装…");
      try {
        await schAgentEnvFetch(plugin, "/v1/agents/install", {
          method: "POST", body: JSON.stringify({ agent: agent.key, directory }),
        });
      } catch (error) {
        log.setText("无法开始安装：" + String(error.message || error));
        install.disabled = false;
        return;
      }
      // Poll rather than hold the request open: npm install routinely runs
      // past any sensible HTTP timeout on a cold cache.
      const poll = async () => {
        let job;
        try { ({ job } = await schAgentEnvFetch(plugin, "/v1/agents/install")); }
        catch (_) { window.setTimeout(poll, 1500); return; }
        log.setText((job.log || "").slice(-3000) || "正在安装…");
        if (job.state === "running") { window.setTimeout(poll, 1500); return; }
        install.disabled = false;
        if (job.state === "done") {
          new Y.Notice(job.label + " 安装完成：" + job.version);
          rerender(true);
        } else {
          new Y.Notice("安装失败：" + (job.error || "未知错误"));
        }
      };
      window.setTimeout(poll, 1200);
    };
  }

  const manual = actions.createEl("input", { type: "text" });
  manual.placeholder = "手动指定可执行文件路径";
  if (agent.command) manual.value = agent.command;
  const apply = actions.createEl("button", { text: "校验并保存" });
  apply.onclick = async () => {
    const value = String(manual.value || "").trim();
    if (!value) { new Y.Notice("请先填写路径。"); return; }
    apply.disabled = true;
    try {
      const overrides = {};
      overrides[agent.key] = value;
      const result = await schAgentEnvFetch(plugin, "/v1/agents/configure", {
        method: "POST", body: JSON.stringify({ overrides }),
      });
      new Y.Notice("已校验并保存：" + ((result.detected || {})[agent.key] || {}).version);
      rerender(true);
    } catch (error) {
      // A path that does not answer --version is reported, never silently
      // accepted: the config is left exactly as it was.
      new Y.Notice("校验失败，配置未改变：" + String(error.message || error));
    } finally { apply.disabled = false; }
  };
}

/* ===== API 密钥（钥匙串） ==============================================
   The Bridge already owns this: a fixed registry of credentials, each written
   to bridge/.env with mode 0600, validated server-side, and read back masked.
   This panel is a second window onto that one store, not a second store —
   adding another copy in the plugin's data.json would put a plaintext key in
   the vault, and the two would disagree the moment either side changed.

   What is deliberately not done here: no value is ever pre-filled into an
   input, no value is echoed in a Notice, and the field is cleared on success.
   The only thing the Bridge will hand back is the mask, and that is all this
   renders. The apply link is part of the row rather than a doc reference
   because "去哪申请" is the question a missing credential actually raises. */

const SCH_CREDENTIAL_SOURCE = {
  env: { text: "进程环境变量", hint: "由启动 Bridge 的环境注入，优先级最高；改这里不会生效。" },
  file: { text: "bridge/.env", hint: null },
  config: { text: "旧版 config（建议迁移）", hint: "仍以明文留在 bridge.config.json 里，点「迁移」搬进 .env。" },
  missing: { text: "未配置", hint: null },
};

function schRenderCredentials(containerEl, plugin) {
  const box = containerEl.createDiv();
  const head = box.createDiv();
  head.addClass("sch-agent-head");
  head.setCssStyles({marginTop: "14px"});
  head.createSpan({ text: "API 密钥" }).addClass("sch-agent-name");
  const refresh = head.createEl("button", { text: "刷新" });

  const note = box.createEl("p", {
    text: "密钥写入 bridge/.env（权限 0600，已在 .gitignore 中），不会进入 bridge.config.json、命令行参数、索引或运行记录。"
      + "注意：若你在 Obsidian Sync 里开启了「同步插件」，该文件仍会随插件目录同步。",
  });
  note.setCssStyles({color: "var(--text-muted)"});
  note.setCssStyles({fontSize: "12px"});
  note.setCssStyles({margin: "4px 0 0"});

  const body = box.createDiv();

  const render = async () => {
    body.empty();
    const fail = (message) => {
      const failed = body.createEl("p", { text: "无法读取密钥状态：" + message });
      failed.setCssStyles({color: "var(--text-error)"});
      failed.setCssStyles({fontSize: "12px"});
    };

    let credentials;
    try {
      const payload = await schMaterialBridgeJson(plugin, "/v1/settings/credentials");
      /* An older Bridge does not have this endpoint and its 404 body carries
         no `credentials`. Reading `.credentials` off that threw, and the throw
         happened inside the settings tab's render — taking the whole Agent
         panel down with it. A reply that is not the expected shape is reported
         as unreadable, never rendered as "一个都没配". */
      credentials = Array.isArray(payload && payload.credentials) ? payload.credentials : null;
      if (!credentials) { fail("Bridge 返回了预期之外的内容；请断开并重新连接 Bridge 以加载新版本。"); return; }
    } catch (error) {
      fail(String((error && error.message) || error));
      return;
    }

    const needsMigration = credentials.some((item) => item.source === "config");
    if (needsMigration) {
      const migrateRow = body.createDiv();
      migrateRow.addClass("sch-agent-actions");
      const warn = migrateRow.createSpan({
        text: "有密钥仍以明文留在 bridge.config.json 中。",
      });
      warn.setCssStyles({fontSize: "12px"});
      warn.setCssStyles({color: "var(--text-warning)"});
      const migrate = migrateRow.createEl("button", { text: "迁移到 .env" });
      migrate.onclick = async () => {
        migrate.disabled = true;
        try {
          const result = await schMaterialBridgeJson(plugin, "/v1/settings/credentials/migrate", { method: "POST" });
          new Y.Notice("已迁移 " + (result.migrated || []).length + " 个密钥到 bridge/.env");
          render();
        } catch (error) {
          new Y.Notice("迁移失败：" + String(error.message || error));
        } finally { migrate.disabled = false; }
      };
    }

    for (const item of credentials) {
      const row = body.createDiv();
      row.addClass("sch-agent-row");

      const rowHead = row.createDiv();
      rowHead.addClass("sch-agent-head");
      rowHead.createSpan({ text: item.label }).addClass("sch-agent-name");

      const state = rowHead.createSpan({ text: item.configured ? "已配置" : "未配置" });
      state.addClass("sch-agent-pill");
      state.addClass(item.configured ? "sch-agent-ok" : "sch-agent-muted");

      const cost = rowHead.createSpan({ text: item.costLabel });
      cost.addClass("sch-agent-pill");
      cost.addClass(item.cost === "institution" || item.cost === "paid" ? "sch-agent-warn" : "sch-agent-muted");

      if (item.configured && item.masked) {
        const masked = rowHead.createSpan({ text: item.masked });
        masked.setCssStyles({fontFamily: "var(--font-monospace)"});
        masked.setCssStyles({fontSize: "12px"});
        masked.setCssStyles({color: "var(--text-muted)"});
      }

      const meta = row.createDiv();
      meta.addClass("sch-agent-meta");
      meta.setCssStyles({whiteSpace: "pre-wrap"});
      const source = SCH_CREDENTIAL_SOURCE[item.source] || SCH_CREDENTIAL_SOURCE.missing;
      const lines = ["用途：" + item.purpose];
      if (item.configured) lines.push("来源：" + source.text + (source.hint ? "  ——  " + source.hint : ""));
      // What the user loses by leaving it unset. Without this the honest
      // answer to "要不要填" is invisible, and every row looks mandatory.
      else if (item.fallback) lines.push("不配置会怎样：" + item.fallback);
      meta.setText(lines.join("\n"));

      const actions = row.createDiv();
      actions.addClass("sch-agent-actions");

      const input = actions.createEl("input", { type: "password" });
      input.placeholder = item.configured ? "填入新值以替换" : "粘贴 " + item.envVar;
      // Never pre-filled: the Bridge only ever returns a mask, and echoing a
      // mask into an editable field invites saving the mask as the key.
      input.value = "";

      const save = actions.createEl("button", { text: "保存" });
      save.addClass("mod-cta");
      save.onclick = async () => {
        const value = String(input.value || "").trim();
        if (!value) { new Y.Notice("请先填写 " + item.envVar + "。"); return; }
        save.disabled = true;
        try {
          const result = await schMaterialBridgeJson(plugin, "/v1/settings/credentials", {
            method: "POST", body: JSON.stringify({ envVar: item.envVar, value }),
          });
          // Only the mask is echoed back, and only the mask is shown.
          new Y.Notice(item.label + " 已保存：" + result.masked);
          input.value = "";
          render();
        } catch (error) {
          // Server-side format validation lands here; the value is not saved.
          new Y.Notice(item.label + " 未保存：" + String(error.message || error));
        } finally { save.disabled = false; }
      };

      if (item.applyUrl) {
        const apply = actions.createEl("a", { text: "去申请 ↗", href: item.applyUrl });
        apply.setCssStyles({fontSize: "12px"});
        apply.setCssStyles({alignSelf: "center"});
        apply.setAttr && apply.setAttr("rel", "noopener");
      }
    }
  };

  refresh.onclick = () => { render(); };
  render();
}

function schRenderCcSwitch(container, ccSwitch) {
  const box = container.createDiv();
  box.addClass("sch-agent-row");
  const head = box.createDiv();
  head.addClass("sch-agent-head");
  head.createSpan({ text: "CC Switch" }).addClass("sch-agent-name");
  const pill = head.createSpan({ text: ccSwitch.installed ? "已安装" : "未检测到" });
  pill.addClass("sch-agent-pill");
  pill.addClass(ccSwitch.installed ? "sch-agent-ok" : "sch-agent-muted");

  const meta = box.createDiv();
  meta.addClass("sch-agent-meta");
  if (!ccSwitch.installed) {
    meta.setText("未找到 CC Switch。上方显示的供应商信息直接来自各 Agent 自己的配置文件。");
    return;
  }
  const lines = ["共 " + (ccSwitch.providers || []).length + " 个供应商配置（只读）。要切换供应商请在 CC Switch 里操作，本插件不会修改它的数据。"];
  if (ccSwitch.note) lines.push("⚠ " + ccSwitch.note);
  const byApp = {};
  for (const p of ccSwitch.providers || []) {
    byApp[p.appType] = byApp[p.appType] || [];
    byApp[p.appType].push(p.name);
  }
  for (const app of Object.keys(byApp)) {
    lines.push(app + "：" + byApp[app].join("、"));
  }
  meta.setText(lines.join("\n"));
  meta.setCssStyles({whiteSpace: "pre-wrap"});
}


const SCH_MATERIAL_DEFAULT_SKILLS = [
  "sch-data-normalize",
  "sch-data-plot",
  "sch-data-profile-audit",
  "sch-data-classifier",
  "sch-data-cleaning-plan",
  "nature-figure",
];
function schMaterialSkillAllowlist(plugin) {
  const configured = plugin?.settings?.materialAgentSkillAllowlist;
  const names = Array.isArray(configured) ? configured.map(String) : SCH_MATERIAL_DEFAULT_SKILLS;
  const allowed = new Set(names);
  const legacyDefaults = ["sch-data-plot", "sch-data-profile-audit", "sch-data-classifier", "sch-data-cleaning-plan"];
  const isLegacyDefault = legacyDefaults.every((name) => allowed.has(name))
    && [...allowed].every((name) => legacyDefaults.includes(name) || name === "nature-figure");
  if (isLegacyDefault) {
    allowed.add("nature-figure");
    allowed.add("sch-data-normalize");
  }
  return allowed;
}
async function schMaterialAllowedSkillCatalog(plugin) {
  const catalog = await schMaterialBridgeJson(plugin, "/v1/skills");
  const allowed = schMaterialSkillAllowlist(plugin);
  return (catalog.skills || []).filter((entry) => entry?.name && allowed.has(String(entry.name)));
}
async function schMaterialRunAllowedSkill(plugin, name, input) {
  if (!schMaterialSkillAllowlist(plugin).has(String(name))) {
    throw new Error(`Skill「${name}」未在设置 → 织研者 Agent → 素材库 Agent 可调用 Skills 中启用`);
  }
  return schMaterialRunSkill(plugin, name, input);
}
function schMaterialFileStem(path) {
  const name = String(path || "").split("/").pop() || "normalized";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
async function schMaterialRegisterNormalizedDataset(library, sourceItem, readyPath) {
  const path = String(readyPath || "").replace(/\\/g, "/");
  if (!schMaterialIsPlotData({ path })) throw new Error("规范化未返回可绘图的 CSV 路径");
  let item = library.data.items.find((entry) => entry?.path === path);
  if (!item) {
    item = {
      id: Ml(), path, name: schMaterialFileStem(path), category: String(sourceItem?.category || ""),
      addedAt: new Date().toISOString(),
    };
    library.data.items.push(item);
    await library.save();
  }
  return item;
}
function schDescribeMaterialRuntimeFailure(error) {
  let state = "absent";
  try { state = schRuntimeBootstrap.status(schRuntimeRoot()).state; }
  catch (_) { /* absent is the safe diagnosis when status itself is unreadable */ }
  const detail = String(error?.message || error || "").trim();
  if (state === "absent") {
    return `本地运行时尚未安装完成。Scholarium 已尝试自动下载并校验；请检查网络后重试。离线时可把 manifest.json 和运行时包放入 %LOCALAPPDATA%\\Scholarium\\runtime\\incoming 后重试。${detail ? ` 技术细节：${detail}` : ""}`;
  }
  if (state === "degraded") {
    return `本地运行时文件不完整或校验失败，系统已拒绝启动它，Vault 原文件未被改动。请重试安装，或将一套校验匹配的 manifest.json 与运行时包放入 incoming 目录。${detail ? ` 技术细节：${detail}` : ""}`;
  }
  if (/ECONNREFUSED|ECONNRESET|fetch failed|ETIMEDOUT|socket hang up|启动超时|监听前退出/i.test(detail)) {
    return `本地 Bridge 未能启动或没有响应。插件已经自动重试；请关闭再启用 Scholarium 后重试，若仍失败请保留这段信息。${detail ? ` 技术细节：${detail}` : ""}`;
  }
  if (/未在.*启用|未在.*允许|not.*allow/i.test(detail)) {
    return `数据规范化 Skill 未在素材库允许列表中启用。请在 Scholarium 设置的素材库 Agent Skill 列表中启用 sch-data-normalize 后重试。${detail ? ` 技术细节：${detail}` : ""}`;
  }
  if (/未发现.*Skill|not found|404/i.test(detail)) {
    return `已启动的运行时没有注册 sch-data-normalize，插件与运行时版本可能不匹配。请重新启用插件以触发同版本运行时校验。${detail ? ` 技术细节：${detail}` : ""}`;
  }
  return `无法读取 XLSX 文件结构；原文件保持只读且未被改动。请重试一次，若仍失败请保留这段信息。${detail ? ` 技术细节：${detail}` : ""}`;
}
async function schOpenMaterialNormalization(library, item) {
  const plugin = library?.plugin;
  if (!plugin || !item?.path) throw new Error("未找到要规范化的素材文件");
  const modal = new De.Modal(plugin.app);
  modal.onOpen = async () => {
    const root = modal.contentEl;
    root.empty();
    root.addClass("sch-material-normalize-modal");
    root.createEl("h2", { text: "规范化数据文件" });
    root.createEl("p", {
      cls: "setting-item-description",
      text: "原文件只读。XLSX 会先读取工作表；多工作表时必须由你选择。成功后只登记带源哈希的 CSV，不会自动绘图。",
    });
    root.createEl("code", { text: item.path });
    const status = root.createDiv({ cls: "setting-item-description", text: "正在读取文件结构…" });
    const fields = root.createDiv({ cls: "sch-material-normalize-fields" });
    const actions = root.createDiv({ cls: "sch-material-plot-actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
    const run = actions.createEl("button", { text: "确认并规范化", cls: "mod-cta" });
    run.disabled = true;
    let sheetSelect = null;
    const headerInput = fields.createEl("input", {
      attr: { type: "number", min: "1", step: "1", placeholder: "表头行（留空则自动识别）" },
    });
    headerInput.setAttribute("aria-label", "表头行，可留空自动识别");
    const formulaMode = fields.createEl("select", { attr: { "aria-label": "公式读取模式" } });
    formulaMode.createEl("option", { text: "公式缓存值（默认）", attr: { value: "cached" } });
    formulaMode.createEl("option", { text: "保留公式文本", attr: { value: "formula_text" } });
    formulaMode.createEl("option", { text: "发现公式即拒绝", attr: { value: "reject" } });
    const allowLabel = fields.createEl("label", { cls: "setting-item-description" });
    const allowMissing = allowLabel.createEl("input", { attr: { type: "checkbox" } });
    allowLabel.append(document.createTextNode(" 允许公式缺少缓存值（会产生空白值；仅在你确认无妨时勾选）"));
    try {
      const inspection = await schMaterialRunAllowedSkill(plugin, "sch-data-normalize", { mode: "inspect", data_path: item.path });
      const sheets = Array.isArray(inspection?.manifest?.workbook?.sheets) ? inspection.manifest.workbook.sheets : [];
      const visible = sheets.filter((sheet) => String(sheet?.state || "visible") === "visible" && String(sheet?.name || "").trim());
      if (visible.length) {
        fields.createEl("label", { text: visible.length > 1 ? "工作表（必选）" : "工作表" });
        sheetSelect = fields.createEl("select", { attr: { "aria-label": "选择要规范化的工作表" } });
        if (visible.length > 1) sheetSelect.createEl("option", { text: "请选择工作表", attr: { value: "" } });
        visible.forEach((sheet) => sheetSelect.createEl("option", { text: `${sheet.name} (${sheet.state})`, attr: { value: sheet.name } }));
        if (visible.length === 1) sheetSelect.value = visible[0].name;
      }
      status.setText(visible.length > 1 ? `检测到 ${visible.length} 个可见工作表；请选择后再规范化。` : "已读取文件结构。请确认参数后继续。");
      run.disabled = false;
    } catch (error) {
      status.setText(schDescribeMaterialRuntimeFailure(error));
      return;
    }
    run.onclick = async () => {
      const sheet = String(sheetSelect?.value || "").trim();
      if (sheetSelect && !sheet) { status.setText("请先选择一个工作表；系统不会替你猜测。" ); return; }
      run.disabled = true;
      status.setText("正在规范化；原文件保持只读…");
      try {
        const input = { data_path: item.path, formula_mode: formulaMode.value };
        if (sheet) input.sheet = sheet;
        const headerRow = Number(headerInput.value);
        if (Number.isInteger(headerRow) && headerRow > 0) input.header_row = headerRow;
        if (allowMissing.checked) input.allow_missing_formula_cache = true;
        const response = await schMaterialRunAllowedSkill(plugin, "sch-data-normalize", input);
        const manifest = response?.manifest || {};
        const readyPath = String(manifest?.ready_for?.data_path || "");
        const normalized = await schMaterialRegisterNormalizedDataset(library, item, readyPath);
        status.setText(`规范化完成：${readyPath}。原文件未被修改。`);
        run.remove();
        const open = actions.createEl("button", { text: "打开 CSV 绘图", cls: "mod-cta" });
        open.onclick = () => { modal.close(); schOpenMaterialWorkbench(library, normalized); };
        library.rerender();
      } catch (error) {
        status.setText(`规范化失败：${error?.message || error}`);
        run.disabled = false;
      }
    };
  };
  modal.onClose = () => modal.contentEl.empty();
  modal.open();
}
function schRenderMaterialAgentSkillSettings(container, plugin) {
  const section = container.createDiv({ cls: "sch-material-skill-settings" });
  const heading = section.createDiv({ cls: "sch-material-skill-settings-head" });
  const title = heading.createDiv();
  title.createEl("strong", { text: "素材库 Agent 可调用 Skills" });
  title.createDiv({ cls: "setting-item-description", text: "可执行型 Skill 由受限 Runner 调用；只有 SKILL.md 的指导型 Skill 会交给本地只读 Agent 转换为受控绘图配置。每次调用都会写入素材操作日志。" });
  const actions = heading.createDiv({ cls: "sch-material-skill-settings-actions" });
  const enableAll = actions.createEl("button", { text: "全部启用" });
  const disableAll = actions.createEl("button", { text: "全部关闭" });
  const refresh = actions.createEl("button", { text: "刷新目录" });
  const status = section.createDiv({ cls: "sch-material-skill-status", text: "正在读取本机 Bridge Skill 目录…" });
  const list = section.createDiv({ cls: "sch-material-skill-list" });
  let catalog = [];
  const saveNames = async (names) => {
    plugin.settings.materialAgentSkillAllowlist = [...new Set(names.map(String))].sort();
    await plugin.saveSettings();
  };
  const paint = () => {
    list.empty();
    const allowed = schMaterialSkillAllowlist(plugin);
    status.setText(catalog.length ? `已发现 ${catalog.length} 个 Skills，已启用 ${catalog.filter((entry) => allowed.has(String(entry.name))).length} 个。` : "Bridge 未返回可用 Skills。请确认本机 Agent Bridge 已启动。");
    catalog.forEach((entry) => {
      const row = list.createEl("label", { cls: "sch-material-skill-row" });
      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = allowed.has(String(entry.name));
      checkbox.setAttribute("aria-label", `启用素材库 Agent Skill：${String(entry.name)}`);
      row.classList.toggle("is-enabled", checkbox.checked);
      const copy = row.createSpan({ cls: "sch-material-skill-row-copy" });
      copy.createEl("strong", { text: String(entry.name) });
      copy.createSpan({ text: `${entry.executable ? "可执行工具" : "Agent 指导"} · ${String(entry.description || entry.subtitle || entry.title || "本机 Bridge Skill")}` });
      checkbox.onchange = async () => {
        const next = schMaterialSkillAllowlist(plugin);
        checkbox.checked ? next.add(String(entry.name)) : next.delete(String(entry.name));
        await saveNames([...next]);
        paint();
      };
    });
  };
  const load = async () => {
    status.setText("正在读取本机 Bridge Skill 目录…");
    try {
      const payload = await schMaterialBridgeJson(plugin, "/v1/skills");
      catalog = (payload.skills || []).filter((entry) => entry?.name).sort((a, b) => String(a.name).localeCompare(String(b.name)));
      paint();
    } catch (error) {
      catalog = [];
      list.empty();
      status.setText(`无法连接 Bridge：${error.message || error}`);
    }
  };
  enableAll.onclick = async () => { await saveNames(catalog.map((entry) => entry.name)); paint(); };
  disableAll.onclick = async () => { await saveNames([]); paint(); };
  refresh.onclick = load;
  load();
  return section;
}
async function schMaterialRunSkill(plugin, name, input) {
  const base = plugin.app.vault.adapter.getBasePath?.();
  if (!base) throw new Error("当前 Vault 不是本地桌面 Vault，无法安全读取素材数据");
  const catalog = await schMaterialBridgeJson(plugin, "/v1/skills");
  const skill = (catalog.skills || []).find((entry) => entry && entry.name === name);
  if (!skill) throw new Error(`Bridge 未发现 ${name} Skill；请重启本机 Agent Bridge 后重试`);
  return schMaterialBridgeJson(plugin, "/v1/skills/run", {
    method: "POST",
    body: JSON.stringify({ skillId: skill.id, workspace: base, input: JSON.stringify(input) }),
  });
}
function schMaterialSelectedValues(select) {
  return Array.from(select.selectedOptions || []).map((option) => option.value).filter(Boolean);
}
async function schMaterialPlotVersions(plugin, sourcePath) {
  const root = schMaterialsRoot(plugin);
  const manifests = plugin.app.vault.getFiles().filter((file) => file.path.startsWith(root + "/_analysis/") && /\/plot-manifest\.json$/i.test(file.path));
  const versions = [];
  for (const manifestFile of manifests) {
    try {
      const manifest = JSON.parse(await plugin.app.vault.adapter.read(manifestFile.path));
      if (manifest?.skill === "sch-data-plot" && manifest?.source?.path === sourcePath && manifest?.plot) {
        versions.push({ file: manifestFile.path, manifest });
      }
    } catch (_) { /* A partial or manually edited manifest is not an editable chart version. */ }
  }
  return versions.sort((left, right) => String(right.manifest.created_at || "").localeCompare(String(left.manifest.created_at || "")));
}
// ── Plot style patch plumbing (chat commands + LLM-translated patches) ──
// Extra visual-only chart_style keys beyond the base panel controls. Every key
// mirrors the bounded schema in skills/sch-data-plot/scripts/generate_plot.py.
const SCH_PLOT_EXTRA_STYLE_KEYS = ["fig_size", "spines", "border_width", "title_size", "label_size", "tick_size", "x_label", "y_label", "y_range", "legend", "marker_size", "line_style", "tick_count"];
const SCH_PLOT_HELP_HTML = '我能理解的指令举例：<code>换成柱状图/折线图/散点图</code>、<code>线宽改为3</code>、<code>虚线/实线</code>、<code>显示/隐藏网格</code>、<code>显示数据点</code>、<code>标题为…</code>、<code>深色样式</code>、<code>截取 10 到 20</code>、<code>y轴 0 到 100</code>（视图缩放）、<code>图片改成 800×600</code>、<code>加完整边框 / 去掉上边框</code>、<code>边框宽度改为2</code>、<code>x轴标签为 Time (min)</code>、<code>图例放右边 / 隐藏图例</code>、<code>标题字号 22</code>、<code>在 y=0 加基线</code>、<code>清除标注</code>。也可以用自然语言描述其他样式调整，我会让绘图 Agent 翻译成样式补丁。注意：基线校正/扣背景属于数据处理，需要用派生数据流程，不能在这里做。';
function schPlotClamp(value, lo, hi) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}
// undefined = 字段缺失或非法；null = 显式重置；[lo, hi] = 设置视图区间
function schPlotRange(value) {
  if (value === null) return null;
  if (Array.isArray(value) && value.length === 2) {
    const lo = Number(value[0]), hi = Number(value[1]);
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) return [lo, hi];
  }
  return undefined;
}
// 白名单校验 + 数值钳制。规则与 generate_plot.py 的 chart_style() 保持一致：
// LLM 或正则翻译出的 patch 只有通过这些字段才能生效，永不执行 AI 代码。
function schPlotSanitizeStylePatch(patch, headers = []) {
  const result = { payload: {}, style: {}, notes: [] };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return result;
  const note = (text) => result.notes.push(text);
  if (typeof patch.title === "string" && patch.title.trim()) {
    result.payload.title = patch.title.trim().slice(0, 180);
    note(`标题 → ${result.payload.title}`);
  }
  const kindValue = String(patch.plot_kind || "").toLowerCase();
  if (["line", "scatter", "bar"].includes(kindValue)) {
    result.payload.plot_kind = kindValue;
    note(`图表类型 → ${{ line: "折线图", scatter: "散点图", bar: "柱状图" }[kindValue]}`);
  }
  if (Array.isArray(headers) && headers.length) {
    if (typeof patch.x_column === "string" && headers.includes(patch.x_column)) {
      result.payload.x_column = patch.x_column;
      note(`X 轴 → ${patch.x_column}`);
    }
    if (Array.isArray(patch.y_columns)) {
      const cols = patch.y_columns.map(String).filter((col) => headers.includes(col)).slice(0, 6);
      if (cols.length) {
        result.payload.y_columns = cols;
        note(`Y 轴 → ${cols.join("、")}`);
      }
    }
  }
  // 允许平铺或嵌套在 chart_style 下两种写法
  const s = { ...patch, ...(patch.chart_style && typeof patch.chart_style === "object" ? patch.chart_style : {}) };
  const themeId = String(s.theme || "").toLowerCase();
  if (["publication", "soft", "dark"].includes(themeId)) {
    result.style.theme = themeId;
    note(`样式 → ${{ publication: "科研出版", soft: "柔和展示", dark: "深色演示" }[themeId]}`);
  }
  const markersValue = String(s.markers || "").toLowerCase();
  if (["auto", "all", "none"].includes(markersValue)) {
    result.style.markers = markersValue;
    note(`数据点 → ${{ auto: "自动", all: "显示", none: "不显示" }[markersValue]}`);
  }
  if (typeof s.show_grid === "boolean") {
    result.style.show_grid = s.show_grid;
    note(`网格 → ${s.show_grid ? "开" : "关"}`);
  }
  const lw = schPlotClamp(s.line_width, 1, 6);
  if (lw !== null) {
    result.style.line_width = Math.round(lw * 10) / 10;
    note(`线宽 → ${result.style.line_width}`);
  }
  const lineStyle = String(s.line_style || "").toLowerCase();
  if (["solid", "dashed", "dotted"].includes(lineStyle)) {
    result.style.line_style = lineStyle;
    note(`线型 → ${{ solid: "实线", dashed: "虚线", dotted: "点线" }[lineStyle]}`);
  }
  const ms = schPlotClamp(s.marker_size, 1, 10);
  if (ms !== null) {
    result.style.marker_size = Math.round(ms * 10) / 10;
    note(`数据点大小 → ${result.style.marker_size}`);
  }
  const xr = schPlotRange(s.x_range);
  if (xr !== undefined) {
    result.style.x_range = xr;
    note(xr ? `X 视图区间 → ${xr[0]}–${xr[1]}（视觉缩放）` : "X 视图区间 → 已重置");
  }
  const yr = schPlotRange(s.y_range);
  if (yr !== undefined) {
    result.style.y_range = yr;
    note(yr ? `Y 视图区间 → ${yr[0]}–${yr[1]}（视觉缩放）` : "Y 视图区间 → 已重置");
  }
  if (Array.isArray(s.annotations)) {
    const list = [];
    for (const entry of s.annotations.slice(0, 8)) {
      if (!entry || typeof entry !== "object") continue;
      const type = String(entry.type || "").toLowerCase();
      const value = Number(entry.value);
      if (!["hline", "vline"].includes(type) || !Number.isFinite(value)) continue;
      list.push({ type, value, label: String(entry.label || "").trim().slice(0, 60) });
    }
    result.style.annotations = list;
    note(list.length ? `标注线 → ${list.length} 条` : "标注线 → 全部清除");
  }
  if (s.series_colors && typeof s.series_colors === "object" && !Array.isArray(s.series_colors)) {
    const colors = {};
    for (const [col, color] of Object.entries(s.series_colors).slice(0, 12)) {
      if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(color || "").trim())) colors[String(col)] = String(color).trim().toLowerCase();
    }
    if (Object.keys(colors).length) {
      result.style.series_colors = colors;
      note(`系列颜色 → ${Object.keys(colors).join("、")}`);
    }
  }
  if (Array.isArray(s.fig_size) && s.fig_size.length === 2) {
    const w = schPlotClamp(s.fig_size[0], 400, 2400);
    const h = schPlotClamp(s.fig_size[1], 300, 1800);
    if (w !== null && h !== null) {
      result.style.fig_size = [Math.round(w), Math.round(h)];
      note(`画布尺寸 → ${Math.round(w)}×${Math.round(h)} px`);
    }
  }
  if (s.spines && typeof s.spines === "object" && !Array.isArray(s.spines)) {
    const spines = {};
    for (const side of ["top", "right", "left", "bottom"]) {
      if (typeof s.spines[side] === "boolean") spines[side] = s.spines[side];
    }
    if (Object.keys(spines).length) {
      result.style.spines = spines;
      note(`边框 → ${{ top: "上", right: "右", left: "左", bottom: "下" }[Object.keys(spines)[0]] || ""}边等 ${Object.keys(spines).length} 处调整`);
    }
  }
  const bw = schPlotClamp(s.border_width, 0.5, 4);
  if (bw !== null) {
    result.style.border_width = Math.round(bw * 10) / 10;
    note(`边框宽度 → ${result.style.border_width}`);
  }
  const titleSize = schPlotClamp(s.title_size, 10, 40);
  if (titleSize !== null) {
    result.style.title_size = Math.round(titleSize * 10) / 10;
    note(`标题字号 → ${result.style.title_size}`);
  }
  const labelSize = schPlotClamp(s.label_size, 8, 24);
  if (labelSize !== null) {
    result.style.label_size = Math.round(labelSize * 10) / 10;
    note(`标签字号 → ${result.style.label_size}`);
  }
  const tickSize = schPlotClamp(s.tick_size, 6, 20);
  if (tickSize !== null) {
    result.style.tick_size = Math.round(tickSize * 10) / 10;
    note(`刻度字号 → ${result.style.tick_size}`);
  }
  for (const [key, label] of [["x_label", "X 轴标签"], ["y_label", "Y 轴标签"]]) {
    if (typeof s[key] === "string") {
      result.style[key] = s[key].trim().slice(0, 60) || null;
      note(result.style[key] ? `${label} → ${result.style[key]}` : `${label} → 恢复默认`);
    } else if (s[key] === null) {
      Object.assign(result.style, { [key]: null });
      note(`${label} → 恢复默认`);
    }
  }
  const legend = String(s.legend || "").toLowerCase();
  if (["bottom", "right", "none"].includes(legend)) {
    result.style.legend = legend;
    note(`图例 → ${{ bottom: "底部", right: "右侧", none: "隐藏" }[legend]}`);
  }
  const tickCount = schPlotClamp(s.tick_count, 3, 10);
  if (tickCount !== null) {
    result.style.tick_count = Math.round(tickCount);
    note(`刻度数量 → ${result.style.tick_count}`);
  }
  return result;
}
// 通过 Bridge 的只读 Agent 把自然语言指令翻译成样式 patch 文本。
async function schMaterialRunPlotAgent(plugin, prompt) {
  const catalog = await schMaterialBridgeJson(plugin, "/v1/agents");
  const agents = catalog.agents || [];
  const agent = agents.find((entry) => entry && entry.id === "claude" && entry.installed) || agents.find((entry) => entry && entry.installed);
  if (!agent) throw new Error("未检测到本机可用的只读 Agent");
  // cwd 必须落在 Bridge 的 allowedRoots 内：优先使用 Bridge 自己配置的工作区根
  // （GET /v1/workspace 返回的就是它运行时认可的那个根）；拿不到则不传 cwd，
  // 让 Bridge 用默认根。切勿传 Vault 根——它通常不在 allowedRoots 里。
  let cwd = "";
  try {
    const ws = await schMaterialBridgeJson(plugin, "/v1/workspace");
    if (ws && ws.root && ws.isDirectory) cwd = String(ws.root);
  } catch (_) { /* keep cwd empty: bridge falls back to its own configured root */ }
  const taskBody = { agentId: agent.id, prompt, permission: "read", execute: true };
  if (cwd) taskBody.cwd = cwd;
  const created = await schMaterialBridgeJson(plugin, "/v1/tasks", {
    method: "POST",
    body: JSON.stringify(taskBody),
  });
  for (let attempt = 0; attempt < 240; attempt++) {
    const task = await schMaterialBridgeJson(plugin, `/v1/tasks/${created.id}`);
    const status = String(task.status || "");
    if (["completed", "failed", "cancelled"].includes(status)) {
      const events = Array.isArray(task.events) ? task.events : [];
      if (status !== "completed") {
        const failure = events.filter((event) => event.type === "error").at(-1);
        throw new Error((failure && failure.text) || `Agent 任务结束：${status}`);
      }
      const done = events.filter((event) => event.type === "result").at(-1);
      return String((done && done.text) || "");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 900));
  }
  throw new Error("等待绘图 Agent 超时");
}
function schMaterialApplyPlotVersion(version, controls, hooks = {}) {
  const plot = version?.manifest?.plot;
  if (!plot) return;
  const { xSelect, yList, kind, title, theme, markers, grid, lineWidth, xMin, xMax, annList, seriesColors, extraStyle } = controls || {};
  if (!xSelect || !yList) return;
  if (plot.x_column) xSelect.value = String(plot.x_column);
  const selected = new Set(Array.isArray(plot.y_columns) ? plot.y_columns.map(String) : []);
  yList.querySelectorAll(".plt-y-item").forEach((el) => el.classList.toggle("plt-selected", selected.has(el.dataset.value)));
  if (["line", "scatter", "bar"].includes(plot.kind)) kind.value = plot.kind;
  title.value = String(plot.title || "");
  const style = plot.chart_style || {};
  if (["publication", "soft", "dark"].includes(style.theme)) theme.value = style.theme;
  if (["auto", "all", "none"].includes(style.markers)) markers.value = style.markers;
  grid.checked = style.show_grid !== false;
  const width = Number(style.line_width);
  if (Number.isFinite(width)) lineWidth.value = String(Math.min(6, Math.max(1, width)));
  // Visual-only extras: view zoom, overlay annotations, series colors.
  if (xMin && xMax) {
    const range = Array.isArray(style.x_range) ? style.x_range : null;
    xMin.value = range ? String(range[0]) : "";
    xMax.value = range ? String(range[1]) : "";
  }
  if (annList && hooks.addAnnRow) {
    annList.empty();
    (Array.isArray(style.annotations) ? style.annotations : []).forEach((note) => {
      if (note && (note.type === "hline" || note.type === "vline") && Number.isFinite(Number(note.value))) {
        hooks.addAnnRow(note.type, String(note.value), String(note.label || ""));
      }
    });
  }
  if (seriesColors) {
    Object.keys(seriesColors).forEach((key) => delete seriesColors[key]);
    const saved = style.series_colors && typeof style.series_colors === "object" ? style.series_colors : {};
    Object.keys(saved).forEach((key) => { seriesColors[key] = String(saved[key]); });
    if (hooks.renderColorRows) hooks.renderColorRows();
  }
  // Extra visual-only style keys (canvas size, spines, fonts, legend, …) are
  // restored through the same whitelist the chat patch path uses.
  if (extraStyle) {
    Object.keys(extraStyle).forEach((key) => delete extraStyle[key]);
    const extra = schPlotSanitizeStylePatch(style).style;
    SCH_PLOT_EXTRA_STYLE_KEYS.forEach((key) => {
      if (extra[key] !== undefined && extra[key] !== null) extraStyle[key] = extra[key];
    });
    if (hooks.syncStylePanel) hooks.syncStylePanel();
  }
}
async function schMaterialPlotAuditEntries(plugin, sourcePath) {
  try {
    const state = await plugin.loadData();
    const rows = Array.isArray(state?.materialPlotAudit) ? state.materialPlotAudit : [];
    return rows.filter((entry) => entry?.sourcePath === sourcePath).slice(-100).reverse();
  } catch (_) {
    return [];
  }
}
async function schMaterialAppendPlotAudit(plugin, sourcePath, entry) {
  const row = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    sourcePath,
    actor: String(entry.actor || "系统"),
    action: String(entry.action || "操作"),
    detail: String(entry.detail || ""),
    skill: entry.skill ? String(entry.skill) : "",
    status: String(entry.status || "done"),
    version: entry.version ? String(entry.version) : "",
  };
  await plugin.updateData((state) => {
    const rows = Array.isArray(state.materialPlotAudit) ? state.materialPlotAudit : [];
    rows.push(row);
    state.materialPlotAudit = rows.slice(-500);
  });
  return row;
}
async function schOpenMaterialPlotter(plugin, item, existingVersion = null, mount = null) {
  const file = plugin.app.vault.getAbstractFileByPath(item.path);
  if (!(file instanceof Eo.TFile)) { new Eo.Notice("找不到素材库中的原始数据文件"); return; }
  const modal = mount ? {
    contentEl: mount.contentEl,
    modalEl: null,
    onOpen: null,
    onClose: null,
    open() { Promise.resolve(this.onOpen?.()).catch((error) => console.error("[MaterialWorkbench] 打开失败", error)); },
    close() { this.onClose?.(); mount.onClose?.(); },
  } : new Eo.Modal(plugin.app);
  modal.onOpen = async () => {
    const root = modal.contentEl;
    root.empty(); root.addClass("sch-material-plot-modal", "plt-modal");
    if (mount) root.addClass("plt-workbench");
    modal.modalEl && modal.modalEl.addClass("plt-modal-el");
    const ICONS = {
      chart: '<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>',
      file: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
      send: '<svg viewBox="0 0 24 24"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
      clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/></svg>',
      download: '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
      edit: '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
      check: '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>',
      spark: '<svg viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 22"/><path d="M12 2a4 4 0 0 0-4 4c0 1.95 1.4 3.58 3.25 3.93"/></svg>',
    };
    const KIND_LABEL = { line: "折线图", scatter: "散点图", bar: "柱状图" };

    // ── Header ──
    const header = root.createDiv({ cls: "plt-header" });
    const hLeft = header.createDiv({ cls: "plt-header-left" });
    const hIcon = hLeft.createDiv({ cls: "plt-header-icon" });
    hIcon.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.chart ?? "")));
    hLeft.createEl("span", { text: "织研者数据绘图", cls: "plt-title" });
    const hStatus = hLeft.createDiv({ cls: "plt-header-status" });
    hStatus.createEl("span", { cls: "plt-status-dot" });
    hStatus.createEl("span", { text: "绘图Agent就绪" });
    const context = hLeft.createDiv({ cls: "plt-context" });
    context.createSpan({ text: "当前素材" });
    context.createEl("strong", { text: item.path.split("/").pop(), attr: { title: item.path } });
    context.createSpan({ text: "· 绘图工作台" });
    const headerActions = header.createDiv({ cls: "plt-header-actions" });
    const skillsBtn = headerActions.createEl("button", { cls: "plt-header-btn", text: "✦ Skills", attr: { title: "调用适用于当前数据的真实 Skill" } });
    const logBtn = headerActions.createEl("button", { cls: "plt-header-btn", text: "☷ 操作日志", attr: { title: "查看此素材的持久化操作日志" } });
    const closeBtn = headerActions.createEl("button", { cls: "plt-close", attr: { "aria-label": "关闭工作台" } });
    closeBtn.replaceChildren(De.sanitizeHTMLToDom(String('<svg viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>' ?? "")));
    closeBtn.onclick = () => modal.close();

    const skillPopover = root.createDiv({ cls: "plt-skill-popover" });
    skillPopover.createDiv({ cls: "plt-skill-title", text: "适用于当前素材的 Skills" });
    const body = root.createDiv({ cls: "plt-body" });

    // ── Left: compact config panel ──
    const config = body.createDiv({ cls: "plt-config" });
    const dsInfo = config.createDiv({ cls: "plt-dataset" });
    const dsIcon = dsInfo.createDiv({ cls: "plt-dataset-icon" });
    dsIcon.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.file ?? "")));
    dsInfo.createEl("span", { text: item.path, cls: "plt-dataset-path", attr: { title: item.path } });

    const xWrap = config.createDiv({ cls: "plt-field" });
    xWrap.createEl("label", { text: "X 轴字段", cls: "plt-label" });
    const xSelect = xWrap.createEl("select", { cls: "plt-input" });
    const yWrap = config.createDiv({ cls: "plt-field" });
    const yLabel = yWrap.createEl("label", { cls: "plt-label" });
    yLabel.appendChild(document.createTextNode("Y 轴 "));
    const yHint = yLabel.createEl("span", { text: "多选", cls: "plt-hint" });
    const yList = yWrap.createDiv({ cls: "plt-ylist" });

    config.createDiv({ cls: "plt-divider" });

    const kindWrap = config.createDiv({ cls: "plt-field" });
    kindWrap.createEl("label", { text: "图表类型", cls: "plt-label" });
    const kind = kindWrap.createEl("select", { cls: "plt-input" });
    [["line", "折线图"], ["scatter", "散点图"], ["bar", "柱状图"]].forEach(([value, text]) => kind.createEl("option", { text, attr: { value } }));
    const titleWrap = config.createDiv({ cls: "plt-field" });
    titleWrap.createEl("label", { text: "图标题", cls: "plt-label" });
    const title = titleWrap.createEl("input", { cls: "plt-input", attr: { type: "text", placeholder: "自动命名" } });

    const themeWrap = config.createDiv({ cls: "plt-field" });
    themeWrap.createEl("label", { text: "科研样式", cls: "plt-label" });
    const theme = themeWrap.createEl("select", { cls: "plt-input" });
    [["publication", "科研出版（推荐）"], ["soft", "柔和展示"], ["dark", "深色演示"]].forEach(([value, text]) => theme.createEl("option", { text, attr: { value } }));
    const markersWrap = config.createDiv({ cls: "plt-field" });
    markersWrap.createEl("label", { text: "数据点标记", cls: "plt-label" });
    const markers = markersWrap.createEl("select", { cls: "plt-input" });
    [["auto", "自动（密集数据不显示）"], ["all", "全部显示"], ["none", "不显示"]].forEach(([value, text]) => markers.createEl("option", { text, attr: { value } }));
    const lineWidthWrap = config.createDiv({ cls: "plt-field" });
    lineWidthWrap.createEl("label", { text: "线条粗细（1–6）", cls: "plt-label" });
    const lineWidth = lineWidthWrap.createEl("input", { cls: "plt-input plt-mono", attr: { type: "number", min: "1", max: "6", step: "0.1", value: "2.6" } });

    const gridWrap = config.createDiv({ cls: "plt-field" });
    gridWrap.createEl("label", { text: "坐标网格", cls: "plt-label" });
    const gridRow = gridWrap.createDiv({ cls: "plt-check-row" });
    const grid = gridRow.createEl("input", { attr: { type: "checkbox", id: "plt-grid-cb" } });
    grid.checked = true;
    gridRow.createEl("label", { text: "显示网格线", cls: "plt-check-label", attr: { for: "plt-grid-cb" } });

    // X 视图区间（视觉缩放，不改动数据）
    const rangeWrap = config.createDiv({ cls: "plt-field" });
    const rangeLabel = rangeWrap.createEl("label", { cls: "plt-label" });
    rangeLabel.appendChild(document.createTextNode("X 视图区间 "));
    rangeLabel.createEl("span", { text: "视觉缩放", cls: "plt-hint" });
    const rangeRow = rangeWrap.createDiv({ cls: "plt-range-row" });
    const xMin = rangeRow.createEl("input", { cls: "plt-input plt-mono", attr: { type: "number", placeholder: "最小", step: "any" } });
    const xMax = rangeRow.createEl("input", { cls: "plt-input plt-mono", attr: { type: "number", placeholder: "最大", step: "any" } });
    const rangeReset = rangeRow.createEl("button", { cls: "plt-btn plt-btn-ghost plt-btn-sm", text: "重置" });

    // 标注线（视觉叠加，最多 8 条）
    const annWrap = config.createDiv({ cls: "plt-field" });
    const annLabel = annWrap.createEl("label", { cls: "plt-label" });
    annLabel.appendChild(document.createTextNode("标注线 "));
    annLabel.createEl("span", { text: "视觉叠加 · 最多 8 条", cls: "plt-hint" });
    const annList = annWrap.createDiv({ cls: "plt-ann-list" });
    const annAdd = annWrap.createEl("button", { cls: "plt-btn plt-btn-ghost plt-btn-sm", text: "+ 添加标注线" });

    // 系列颜色（不设置则用主题调色板）
    const colorWrap = config.createDiv({ cls: "plt-field" });
    const colorLabel = colorWrap.createEl("label", { cls: "plt-label" });
    colorLabel.appendChild(document.createTextNode("系列颜色 "));
    colorLabel.createEl("span", { text: "默认随主题", cls: "plt-hint" });
    const colorList = colorWrap.createDiv({ cls: "plt-color-list" });

    // 画布尺寸（对应 chart_style.fig_size，留空则用默认 1200×760）
    const sizeWrap = config.createDiv({ cls: "plt-field" });
    sizeWrap.createEl("label", { text: "画布尺寸（px）", cls: "plt-label" });
    const sizeRow = sizeWrap.createDiv({ cls: "plt-range-row" });
    const figW = sizeRow.createEl("input", { cls: "plt-input plt-mono", attr: { type: "number", min: "400", max: "2400", step: "10", placeholder: "宽 1200" } });
    const figH = sizeRow.createEl("input", { cls: "plt-input plt-mono", attr: { type: "number", min: "300", max: "1800", step: "10", placeholder: "高 760" } });

    // 边框四边（对应 chart_style.spines，默认左+下）
    const spineWrap = config.createDiv({ cls: "plt-field" });
    spineWrap.createEl("label", { text: "边框（四边）", cls: "plt-label" });
    const spineRow = spineWrap.createDiv({ cls: "plt-check-row" });
    const spineBoxes = {};
    [["top", "上"], ["bottom", "下"], ["left", "左"], ["right", "右"]].forEach(([side, labelText]) => {
      const box = spineRow.createEl("input", { attr: { type: "checkbox", id: `plt-spine-${side}` } });
      box.checked = side === "left" || side === "bottom";
      spineRow.createEl("label", { text: labelText, cls: "plt-check-label", attr: { for: `plt-spine-${side}` } });
      spineBoxes[side] = box;
    });

    const history = config.createDiv({ cls: "plt-history" });
    history.createEl("label", { text: "已有图表版本", cls: "plt-label" });
    const versionSelect = history.createEl("select", { cls: "plt-input" });
    const editVersion = history.createEl("button", { text: "打开所选版本修改", cls: "plt-btn plt-btn-ghost plt-btn-sm" });
    history.createEl("label", { text: "保存修改方式", cls: "plt-label plt-save-mode-label" });
    const saveMode = history.createEl("select", { cls: "plt-input plt-save-mode" });
    saveMode.createEl("option", { text: "保存为新版本（保留原图）", attr: { value: "new" } });
    saveMode.createEl("option", { text: "覆盖所选版本（不新增图片）", attr: { value: "overwrite" } });
    const saveModeHint = history.createDiv({ cls: "plt-save-mode-hint", text: "默认保留原版本；选择覆盖时只改写当前选中的图表版本。" });
    saveMode.onchange = () => {
      saveModeHint.setText(saveMode.value === "overwrite"
        ? "将覆盖当前选中的版本，不会产生新的图表文件。"
        : "将创建一个新版本，并完整保留原图。");
      updateRenderButtonLabel();
    };

    const configActions = config.createDiv({ cls: "plt-config-actions" });
    const profile = configActions.createEl("button", { cls: "plt-btn plt-btn-ghost plt-btn-sm plt-grow" });
    const profileIcon = profile.createEl("span", { cls: "plt-btn-icon" });
    profileIcon.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.spark ?? "")));
    profile.appendChild(document.createTextNode("分析字段"));
    const render = configActions.createEl("button", { cls: "plt-btn plt-btn-primary plt-btn-sm plt-grow" });
    const renderIcon = render.createEl("span", { cls: "plt-btn-icon" });
    renderIcon.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.chart ?? "")));
    const renderLabel = render.createSpan({ cls: "plt-render-label", text: "生成图表" });

    const leftResizer = body.createDiv({ cls: "plt-pane-resizer plt-pane-resizer-left", attr: { role: "separator", "aria-label": "拖动调整参数面板宽度", title: "拖动调整参数面板宽度；双击恢复" } });

    // ── Center: stable chart canvas ──
    const canvas = body.createDiv({ cls: "plt-canvas" });
    const canvasTabs = canvas.createDiv({ cls: "plt-canvas-tabs" });
    const chartTab = canvasTabs.createDiv({ cls: "plt-canvas-tab plt-active", text: "▥ 图表预览" });
    const dataTab = canvasTabs.createDiv({ cls: "plt-canvas-tab", text: "▤ 数据源" });
    const dataPane = canvas.createDiv({ cls: "plt-data-pane" });
    dataPane.createDiv({ cls: "plt-data-note", text: "只读数据预览 · 原始素材不会在工作台中修改" });
    const dataPreview = dataPane.createEl("pre", { cls: "plt-data-preview", text: "正在读取数据…" });
    chartTab.onclick = () => {
      chartTab.addClass("plt-active"); dataTab.removeClass("plt-active");
      canvas.removeClass("plt-show-data");
    };
    dataTab.onclick = () => {
      dataTab.addClass("plt-active"); chartTab.removeClass("plt-active");
      canvas.addClass("plt-show-data");
    };

    const rightResizer = body.createDiv({ cls: "plt-pane-resizer plt-pane-resizer-right", attr: { role: "separator", "aria-label": "拖动调整 Agent 面板宽度", title: "拖动调整 Agent 面板宽度；双击恢复" } });

    // ── Right: independent Agent panel ──
    const chat = body.createDiv({ cls: "plt-chat" });
    const chatHeader = chat.createDiv({ cls: "plt-chat-header" });
    const chLeft = chatHeader.createDiv({ cls: "plt-chat-header-left" });
    const avatar = chLeft.createDiv({ cls: "plt-agent-avatar" });
    avatar.createEl("img", { attr: { src: SCHOLARIUM_LOGO_DATA_URL, alt: "" } });
    avatar.setAttribute("aria-hidden", "true");
    const chName = chLeft.createDiv();
    chName.createDiv({ cls: "plt-agent-name", text: "绘图Agent" });
    const roleText = chName.createDiv({ cls: "plt-agent-role", text: "正在读取数据集…" });
    const collapseAgent = chatHeader.createEl("button", { cls: "plt-tool-btn plt-agent-collapse", text: "›", attr: { title: "折叠 Agent" } });
    const historyBtn = chatHeader.createEl("button", { cls: "plt-tool-btn", attr: { title: "版本历史（定位到左侧版本列表）" } });
    historyBtn.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.clock ?? "")));
    historyBtn.onclick = () => versionSelect.focus();
    collapseAgent.onclick = () => {
      root.classList.toggle("plt-agent-collapsed");
      const collapsed = root.classList.contains("plt-agent-collapsed");
      collapseAgent.setText(collapsed ? "‹" : "›");
      collapseAgent.setAttribute("title", collapsed ? "展开 Agent" : "折叠 Agent");
    };

    const attachPaneResizer = (handle, pane, cssVar, direction, minWidth, maxWidth) => {
      handle.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = pane.getBoundingClientRect().width;
        handle.setPointerCapture?.(event.pointerId);
        root.addClass("plt-resizing");
        const move = (next) => {
          const available = Math.max(minWidth, body.getBoundingClientRect().width - 320);
          const cap = Math.min(maxWidth, available);
          const width = Math.max(minWidth, Math.min(cap, startWidth + direction * (next.clientX - startX)));
          root.style.setProperty(cssVar, `${Math.round(width)}px`);
        };
        const stop = () => {
          root.removeClass("plt-resizing");
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
      });
      handle.ondblclick = () => root.style.removeProperty(cssVar);
    };
    attachPaneResizer(leftResizer, config, "--plt-config-width", 1, 220, 430);
    attachPaneResizer(rightResizer, chat, "--plt-agent-width", -1, 260, 520);

    const contextStrip = chat.createDiv({ cls: "plt-agent-context" });
    contextStrip.createSpan({ text: "素材 · CSV/TSV" });
    contextStrip.createSpan({ text: "工作台 · 绘图" });
    const activeSkillChip = contextStrip.createSpan({ cls: "plt-agent-skill", text: "✦ sch-data-plot" });

    const messages = chat.createDiv({ cls: "plt-messages" });
    const inputArea = chat.createDiv({ cls: "plt-input-area" });
    const inputRow = inputArea.createDiv({ cls: "plt-input-row" });
    const chatInput = inputRow.createEl("input", { cls: "plt-chat-input", attr: { type: "text", placeholder: "描述你想要的图表调整…" } });
    const sendBtn = inputRow.createEl("button", { cls: "plt-send-btn", attr: { "aria-label": "发送" } });
    sendBtn.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.send ?? "")));
    const hint = inputArea.createDiv({ cls: "plt-input-hint" });
    hint.replaceChildren(De.sanitizeHTMLToDom(String("<kbd>Enter</kbd> 发送 · 可直接说“换成柱状图”、“线宽改为3”、“图片改成 800×600”、“加完整边框”、“图例放右边”… 其他样式调整会用自然语言交给绘图 Agent 理解" ?? "")));

    // ── Bottom: durable audit log stored with plugin data ──
    const auditDrawer = root.createDiv({ cls: "plt-audit-drawer" });
    const auditHead = auditDrawer.createDiv({ cls: "plt-audit-head" });
    auditHead.createEl("strong", { text: "操作日志" });
    const auditCount = auditHead.createSpan({ cls: "plt-audit-count", text: "0 条" });
    const auditTabs = auditHead.createDiv({ cls: "plt-audit-tabs" });
    let auditEntries = [], auditFilter = "全部";
    const auditTabEls = ["全部", "Agent", "版本", "Skill"].map((label, index) => {
      const tab = auditTabs.createSpan({ cls: "plt-audit-tab" + (index === 0 ? " plt-active" : ""), text: label });
      tab.onclick = (event) => {
        event.stopPropagation(); auditFilter = label;
        auditTabEls.forEach((entry) => entry.removeClass("plt-active")); tab.addClass("plt-active");
        paintAudit(auditEntries);
      };
      return tab;
    });
    auditHead.createSpan({ cls: "plt-audit-chevron", text: "⌃" });
    const auditList = auditDrawer.createDiv({ cls: "plt-audit-list" });
    const paintAudit = (entries) => {
      auditEntries = entries;
      const visible = entries.filter((entry) => {
        if (auditFilter === "全部") return true;
        if (auditFilter === "Agent") return entry.actor === "Agent" || entry.action === "Agent 指令";
        if (auditFilter === "版本") return !!entry.version;
        return !!entry.skill;
      });
      auditList.empty();
      auditCount.setText(`${entries.length} 条`);
      if (!visible.length) {
        auditList.createDiv({ cls: "plt-audit-empty", text: "该素材尚无工作台操作记录。运行 Skill、生成版本或向 Agent 发出指令后会在这里留痕。" });
        return;
      }
      visible.forEach((entry) => {
        const row = auditList.createDiv({ cls: `plt-audit-row plt-audit-${entry.status || "done"}` });
        row.createSpan({ cls: "plt-audit-time", text: String(entry.at || "").replace("T", " ").slice(11, 19) });
        row.createSpan({ cls: "plt-audit-actor", text: entry.actor || "系统" });
        row.createSpan({ cls: "plt-audit-detail", text: entry.detail || entry.action || "操作" });
        row.createSpan({ cls: "plt-audit-version", text: entry.version || entry.skill || entry.status || "完成" });
      });
    };
    const refreshAudit = async () => paintAudit(await schMaterialPlotAuditEntries(plugin, item.path));
    const recordAudit = async (entry) => {
      try { await schMaterialAppendPlotAudit(plugin, item.path, entry); await refreshAudit(); }
      catch (error) { console.warn("[MaterialWorkbench] 无法写入操作日志", error); }
    };
    auditHead.onclick = () => root.classList.toggle("plt-audit-open");
    logBtn.onclick = () => { root.classList.toggle("plt-audit-open"); refreshAudit(); };
    refreshAudit();

    // ── Chat helpers ──
    const scrollChat = () => { messages.scrollTop = messages.scrollHeight; };
    const addAgent = (html) => {
      const m = messages.createDiv({ cls: "plt-msg-agent" });
      const av = m.createDiv({ cls: "plt-avatar" });
      av.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.spark ?? "")));
      const mBody = m.createDiv({ cls: "plt-msg-body" });
      const t = mBody.createDiv({ cls: "plt-msg-text" });
      t.replaceChildren(De.sanitizeHTMLToDom(String(html ?? "")));
      scrollChat();
      return mBody;
    };
    const addUser = (text) => {
      const m = messages.createDiv({ cls: "plt-msg-user" });
      m.createDiv({ cls: "plt-user-bubble", text });
      scrollChat();
      recordAudit({ actor: "用户", action: "Agent 指令", detail: text, status: "submitted" });
    };
    const addThinking = (text) => {
      const m = messages.createDiv({ cls: "plt-msg-agent" });
      const av = m.createDiv({ cls: "plt-avatar" });
      av.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.spark ?? "")));
      const mBody = m.createDiv({ cls: "plt-msg-body" });
      const tk = mBody.createDiv({ cls: "plt-thinking" });
      const dots = tk.createDiv({ cls: "plt-dots" });
      dots.createEl("span"); dots.createEl("span"); dots.createEl("span");
      tk.appendChild(document.createTextNode(text));
      scrollChat();
      return m;
    };

    // ── Step chips (读取CSV → 识别字段 → 生成图表) ──
    let stepEls = [];
    const renderSteps = (states) => {
      stepEls.forEach((el, i) => {
        el.className = "plt-step" + (states[i] ? ` plt-step-${states[i]}` : "");
      });
    };

    // ── State ──
    let headers = [];
    let versions = [];
    let hasRendered = false;
    let dataSample = "";
    let currentPreviewManifest = null;
    const conversationHistory = [];
    const seriesColors = {};
    // Extra visual-only style keys (fig_size, spines, fonts, legend, …) that
    // have no dedicated base control; merged into collectStyle() output.
    const extraStyle = {};
    const controls = { xSelect, yList, kind, title, theme, markers, grid, lineWidth, xMin, xMax, annList, seriesColors, extraStyle };
    const getY = () => Array.from(yList.querySelectorAll(".plt-y-item.plt-selected")).map((el) => el.dataset.value);
    const updateRenderButtonLabel = () => {
      renderLabel.setText(hasRendered || saveMode.value === "overwrite" ? "保存修改" : "生成图表");
      render.setAttribute("aria-label", renderLabel.textContent);
    };

    // ── Canvas size / spines panel <-> extraStyle sync ──
    const syncStylePanel = () => {
      const size = Array.isArray(extraStyle.fig_size) ? extraStyle.fig_size : null;
      figW.value = size ? String(size[0]) : "";
      figH.value = size ? String(size[1]) : "";
      const sp = extraStyle.spines && typeof extraStyle.spines === "object" ? extraStyle.spines : { top: false, right: false, left: true, bottom: true };
      Object.keys(spineBoxes).forEach((side) => { spineBoxes[side].checked = !!sp[side]; });
    };
    const onSizeInput = () => {
      const w = Number(figW.value), h = Number(figH.value);
      if (Number.isFinite(w) && Number.isFinite(h) && w >= 400 && h >= 300) {
        extraStyle.fig_size = [Math.min(2400, Math.round(w)), Math.min(1800, Math.round(h))];
      } else {
        delete extraStyle.fig_size;
      }
      maybeAutoRender();
    };
    figW.onchange = onSizeInput;
    figH.onchange = onSizeInput;
    Object.values(spineBoxes).forEach((box) => {
      box.onchange = () => {
        extraStyle.spines = { top: spineBoxes.top.checked, right: spineBoxes.right.checked, left: spineBoxes.left.checked, bottom: spineBoxes.bottom.checked };
        maybeAutoRender();
      };
    });

    // ── Annotation rows ──
    const addAnnRow = (type = "hline", value = "", label = "") => {
      if (annList.querySelectorAll(".plt-ann-row").length >= 8) return;
      const rowEl = annList.createDiv({ cls: "plt-ann-row" });
      const typeSel = rowEl.createEl("select", { cls: "plt-input plt-ann-type" });
      [["hline", "水平"], ["vline", "垂直"]].forEach(([v, t]) => typeSel.createEl("option", { text: t, attr: { value: v } }));
      typeSel.value = type;
      const valueInput = rowEl.createEl("input", { cls: "plt-input plt-mono plt-ann-value", attr: { type: "number", step: "any", placeholder: "值" } });
      valueInput.value = value;
      const labelInput = rowEl.createEl("input", { cls: "plt-input plt-ann-label", attr: { type: "text", placeholder: "标签（可空）", maxlength: "60" } });
      labelInput.value = label;
      const del = rowEl.createEl("button", { cls: "plt-btn plt-btn-ghost plt-btn-sm plt-ann-del", text: "✕" });
      del.onclick = () => { rowEl.remove(); maybeAutoRender(); };
      [typeSel, valueInput, labelInput].forEach((el) => { el.onchange = () => maybeAutoRender(); });
      return rowEl;
    };
    annAdd.onclick = () => { addAnnRow(); };

    // ── Series color rows (rebuilt with the Y selection) ──
    const renderColorRows = () => {
      colorList.empty();
      getY().forEach((colName) => {
        const rowEl = colorList.createDiv({ cls: "plt-color-row" });
        const picker = rowEl.createEl("input", { cls: "plt-color-picker", attr: { type: "color" } });
        picker.value = seriesColors[colName] || "#2563eb";
        picker.onchange = () => { seriesColors[colName] = picker.value; maybeAutoRender(); };
        rowEl.createEl("span", { text: colName, cls: "plt-color-name", attr: { title: colName } });
        if (seriesColors[colName]) {
          const clear = rowEl.createEl("button", { cls: "plt-btn plt-btn-ghost plt-btn-sm plt-ann-del", text: "✕", attr: { title: "恢复主题色" } });
          clear.onclick = () => { delete seriesColors[colName]; renderColorRows(); maybeAutoRender(); };
        }
      });
    };

    const collectStyle = () => {
      const lo = parseFloat(xMin.value), hi = parseFloat(xMax.value);
      const annotations = Array.from(annList.querySelectorAll(".plt-ann-row")).map((rowEl) => ({
        type: rowEl.querySelector(".plt-ann-type").value,
        value: parseFloat(rowEl.querySelector(".plt-ann-value").value),
        label: rowEl.querySelector(".plt-ann-label").value.trim(),
      })).filter((entry) => Number.isFinite(entry.value)).slice(0, 8);
      const colors = {};
      Object.keys(seriesColors).forEach((key) => { if (seriesColors[key]) colors[key] = seriesColors[key]; });
      return {
        theme: theme.value, markers: markers.value, show_grid: grid.checked, line_width: Number(lineWidth.value),
        x_range: (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) ? [lo, hi] : null,
        annotations,
        series_colors: colors,
        ...extraStyle,
      };
    };
    rangeReset.onclick = () => { xMin.value = ""; xMax.value = ""; maybeAutoRender(); };
    [xMin, xMax].forEach((el) => { el.onchange = () => maybeAutoRender(); });

    const refreshVersions = async () => {
      try {
        versions = await schMaterialPlotVersions(plugin, item.path);
        versionSelect.empty();
        if (!versions.length) {
          versionSelect.createEl("option", { text: "尚未生成过图表", attr: { value: "" } });
          editVersion.disabled = true;
          saveMode.value = "new";
          saveMode.querySelector('option[value="overwrite"]').disabled = true;
        } else {
          versions.forEach((version, index) => {
            const plot = version.manifest.plot;
            const stamp = String(version.manifest.created_at || "").replace("T", " ").slice(0, 19);
            versionSelect.createEl("option", { text: `${stamp || "历史版本"} · ${plot.title || plot.kind}`, attr: { value: String(index) } });
          });
          editVersion.disabled = false;
          saveMode.querySelector('option[value="overwrite"]').disabled = false;
        }
      } catch (_) {
        versionSelect.empty();
        versionSelect.createEl("option", { text: "无法读取已有版本", attr: { value: "" } });
        editVersion.disabled = true;
      }
    };

    // ── Fixed preview zone: always shows the current chart, replaced in place ──
    const preview = canvas.createDiv({ cls: "plt-preview plt-preview-empty" });
    const previewHeader = preview.createDiv({ cls: "plt-chart-header" });
    const previewTitleEl = previewHeader.createDiv({ cls: "plt-chart-title", text: "图表预览" });
    const previewTag = previewTitleEl.createEl("span", { text: "", cls: "plt-ver-tag" });
    const previewActions = previewHeader.createDiv({ cls: "plt-chart-actions" });
    const previewBody = preview.createDiv({ cls: "plt-preview-body" });
    previewBody.createDiv({ cls: "plt-preview-placeholder", text: "尚未生成图表——左侧配置字段后点「生成图表」，或直接在下方告诉我怎么画（例如“折线图，显示网格”）。" });
    const updatePreview = async (result) => {
      const manifest = result.manifest || {};
      currentPreviewManifest = manifest;
      const plot = manifest.plot || {};
      const stamp = String(manifest.created_at || "").replace("T", " ").slice(11, 19);
      const svgPath = (manifest.outputs || []).find((p) => /plot\.svg$/i.test(p));
      previewTitleEl.firstChild.textContent = plot.title || `${(plot.y_columns || []).join("、")} vs ${plot.x_column || ""}`;
      previewTag.setText(` v${versions.length} · ${stamp}`);
      previewActions.empty();
      if (svgPath) {
        const zoomBtn = previewActions.createEl("button", { attr: { title: "放大查看" } });
        zoomBtn.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.zoom ?? "")));
        zoomBtn.onclick = () => {
          const f = plugin.app.vault.getAbstractFileByPath(svgPath);
          if (f instanceof Eo.TFile) plugin.app.workspace.getLeaf(false).openFile(f);
        };
        const dlBtn = previewActions.createEl("button", { attr: { title: "在系统文件夹中显示 SVG" } });
        dlBtn.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.download ?? "")));
        dlBtn.onclick = () => { try { plugin.app.showInFolder(svgPath); } catch (_) { new Eo.Notice(`已保存到 ${svgPath}`); } };
        const editBtn = previewActions.createEl("button", { attr: { title: "把此版本的参数载回左侧配置" } });
        editBtn.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.edit ?? "")));
        editBtn.onclick = () => {
          const v = versions.find((entry) => entry.manifest === manifest) || { manifest };
          schMaterialApplyPlotVersion(v, controls, { addAnnRow, renderColorRows, syncStylePanel });
          renderQuick();
          new Eo.Notice("已把该图表版本的参数载回左侧配置");
        };
      }
      previewBody.empty();
      if (svgPath) {
        try {
          const svgText = await plugin.app.vault.adapter.read(svgPath);
          previewBody.replaceChildren(De.sanitizeHTMLToDom(String(svgText ?? "")));
          preview.removeClass("plt-preview-empty");
        } catch (_) {
          previewBody.setText("（无法内联预览 SVG，可点击上方按钮打开文件）");
        }
      } else {
        previewBody.setText("（本次输出中未找到 plot.svg）");
      }
    };

    const doRender = async () => {
      const ys = getY().filter((value) => value !== xSelect.value);
      if (!xSelect.value || !ys.length) {
        addAgent("请先在左侧选择一个 <strong>X 轴字段</strong>和至少一个不同的 <strong>Y 轴字段</strong>。");
        return;
      }
      const overwrite = saveMode.value === "overwrite";
      const targetVersion = overwrite ? versions[Number(versionSelect.value)] : null;
      if (overwrite && !targetVersion?.file) {
        addAgent("请选择一个已有图表版本后再覆盖，或把保存方式切换为<strong>保存为新版本</strong>。");
        return;
      }
      render.disabled = true;
      activeSkillChip.setText("✦ sch-data-plot");
      recordAudit({ actor: "用户", action: "调用 Skill", detail: `${overwrite ? "覆盖所选版本" : "保存新版本"} · ${KIND_LABEL[kind.value] || kind.value}`, skill: "sch-data-plot", status: "running" });
      const thinking = addThinking(overwrite ? "正在安全覆盖所选图表版本…" : "正在生成可复现 SVG 图表…");
      try {
        const result = await schMaterialRunAllowedSkill(plugin, "sch-data-plot", {
          data_path: item.path, x_column: xSelect.value, y_columns: ys, plot_kind: kind.value, title: title.value.trim(),
          output_root: schMaterialsRoot(plugin),
          chart_style: collectStyle(),
          save_mode: overwrite ? "overwrite" : "new",
          ...(overwrite ? { target_manifest_path: targetVersion.file } : {}),
        });
        thinking.remove();
        hasRendered = true;
        updateRenderButtonLabel();
        renderSteps(["done", "done", "done"]);
        await refreshVersions();
        render.removeClass("plt-dirty");
        render.removeAttribute("title");
        const sentStyle = collectStyle();
        const styleBits = [`线宽 ${Number(lineWidth.value)}`, grid.checked ? "网格开" : "网格关", markers.value === "all" ? "数据点全显" : markers.value === "none" ? "无数据点" : "数据点自动"];
        if (sentStyle.x_range) styleBits.push(`视图 ${sentStyle.x_range[0]}–${sentStyle.x_range[1]}`);
        if (sentStyle.annotations.length) styleBits.push(`${sentStyle.annotations.length} 条标注线`);
        addAgent(`${overwrite ? "已覆盖所选版本" : "已生成新版本"}（<strong>${KIND_LABEL[kind.value] || kind.value}</strong> · ${styleBits.join(" · ")}），已更新中央预览。原始数据未改动。`);
        await updatePreview(result);
        recordAudit({ actor: "Skill", action: overwrite ? "覆盖图表版本" : "生成图表版本", detail: `${KIND_LABEL[kind.value] || kind.value} · ${styleBits.join(" · ")}`, skill: "sch-data-plot", status: "done", version: overwrite ? "覆盖" : `v${versions.length}` });
        new Eo.Notice(overwrite ? "✅ 所选图表版本已覆盖；原始数据未改动。" : "✅ 图表新版本已生成；原图与原始数据均未覆盖。");
      } catch (error) {
        thinking.remove();
        addAgent(`绘图失败：${error.message || error}`);
        recordAudit({ actor: "Skill", action: "生成图表失败", detail: String(error.message || error), skill: "sch-data-plot", status: "error" });
      } finally {
        render.disabled = false;
      }
    };

    // Editing controls must never create files by itself.  A version is
    // written only after the researcher explicitly clicks the save button.
    const maybeAutoRender = () => {
      render.addClass("plt-dirty");
      render.setAttribute("title", "存在未保存的图表配置修改");
    };

    // ── Quick chips ──
    let quickWrap = null;
    const renderQuick = () => {
      if (!quickWrap) return;
      quickWrap.empty();
      [["line", "折线图"], ["bar", "柱状图"], ["scatter", "散点图"]].forEach(([value, label]) => {
        const c = quickWrap.createEl("span", { cls: "plt-quick" + (kind.value === value ? " plt-on" : ""), text: label });
        c.onclick = () => { kind.value = value; renderQuick(); maybeAutoRender(); };
      });
      const g = quickWrap.createEl("span", { cls: "plt-quick" + (grid.checked ? " plt-on" : ""), text: `网格: ${grid.checked ? "开" : "关"}` });
      g.onclick = () => { grid.checked = !grid.checked; renderQuick(); maybeAutoRender(); };
      const w = quickWrap.createEl("span", { cls: "plt-quick", text: `线宽: ${lineWidth.value}` });
      w.onclick = () => {
        const opts = ["1.8", "2.2", "2.6", "3.2", "4.0"];
        const i = opts.indexOf(lineWidth.value);
        lineWidth.value = opts[(i + 1) % opts.length];
        renderQuick(); maybeAutoRender();
      };
      scrollChat();
    };
    kind.onchange = () => { renderQuick(); maybeAutoRender(); };
    theme.onchange = () => maybeAutoRender();
    markers.onchange = () => maybeAutoRender();
    grid.onchange = () => { renderQuick(); maybeAutoRender(); };
    lineWidth.onchange = () => { renderQuick(); maybeAutoRender(); };
    xSelect.onchange = () => maybeAutoRender();

    // ── Greeting message with step chips + quick chips ──
    {
      const m = messages.createDiv({ cls: "plt-msg-agent" });
      const av = m.createDiv({ cls: "plt-avatar" });
      av.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.spark ?? "")));
      const mBody = m.createDiv({ cls: "plt-msg-body" });
      mBody.createDiv({ cls: "plt-msg-text", text: `已打开 ${item.path}。我会先读取表头；你可以点击「分析字段」让我识别数值列，确认字段后点「生成图表」，也可以直接在下方告诉我怎么调。` });
      const steps = mBody.createDiv({ cls: "plt-steps" });
      stepEls = ["读取CSV", "识别字段", "生成图表"].map((label) => {
        const chip = steps.createEl("span", { cls: "plt-step" });
        chip.createEl("span", { cls: "plt-step-dot" });
        chip.appendChild(document.createTextNode(label));
        return chip;
      });
      quickWrap = mBody.createDiv({ cls: "plt-quick-row" });
    }

    // ── Field filling ──
    const fillFields = (list, numeric) => {
      headers = list;
      xSelect.empty();
      list.forEach((headerText, index) => {
        const x = xSelect.createEl("option", { text: headerText, attr: { value: headerText } });
        if (index === 0) x.selected = true;
      });
      yList.empty();
      list.forEach((headerText, index) => {
        const row = yList.createDiv({ cls: "plt-y-item", attr: { "data-value": headerText } });
        const box = row.createDiv({ cls: "plt-y-check" });
        box.replaceChildren(De.sanitizeHTMLToDom(String(ICONS.check ?? "")));
        row.createEl("span", { text: headerText });
        if (numeric.includes(headerText) && index !== 0) row.addClass("plt-selected");
        row.onclick = () => { row.classList.toggle("plt-selected"); renderColorRows(); maybeAutoRender(); };
      });
      roleText.setText(`已加载 1 个数据集 · ${numeric.length || Math.max(0, list.length - 1)} 个数值列`);
    };

    // ── Chat command parser ──
    // 把一个校验过的 patch 应用到面板控件与 extraStyle（不触发渲染，由调用方决定）。
    const applyStylePatch = (san) => {
      const p = san.payload, st = san.style;
      if (p.title) title.value = p.title;
      if (p.plot_kind) kind.value = p.plot_kind;
      if (p.x_column) xSelect.value = p.x_column;
      if (p.y_columns) {
        const wanted = new Set(p.y_columns);
        yList.querySelectorAll(".plt-y-item").forEach((el) => el.classList.toggle("plt-selected", wanted.has(el.dataset.value)));
      }
      if (st.theme) theme.value = st.theme;
      if (st.markers) markers.value = st.markers;
      if (typeof st.show_grid === "boolean") grid.checked = st.show_grid;
      if (st.line_width !== undefined) lineWidth.value = String(st.line_width);
      if (st.x_range !== undefined) {
        xMin.value = st.x_range ? String(st.x_range[0]) : "";
        xMax.value = st.x_range ? String(st.x_range[1]) : "";
      }
      if (st.annotations) {
        annList.empty();
        st.annotations.forEach((entry) => addAnnRow(entry.type, String(entry.value), entry.label));
      }
      if (st.series_colors) Object.assign(seriesColors, st.series_colors);
      SCH_PLOT_EXTRA_STYLE_KEYS.forEach((key) => {
        if (!(key in st)) return;
        if (st[key] === null || st[key] === undefined) delete extraStyle[key];
        else if (key === "spines") extraStyle.spines = { top: false, right: false, left: true, bottom: true, ...(extraStyle.spines || {}), ...st.spines };
        else extraStyle[key] = st[key];
      });
      syncStylePanel();
      renderQuick();
      renderColorRows();
    };
    const reportChanges = (list) => {
      render.addClass("plt-dirty");
      render.setAttribute("title", "配置已修改；确认保存方式后再生成，不会自动创建新图片");
      const reply = `已调整配置：${list.join("；")}。请确认下方保存方式，再点击「${hasRendered ? "保存修改" : "生成图表"}」。当前修改尚未写入文件。`;
      addAgent(reply);
      conversationHistory.push({ role: "assistant", content: reply.replace(/<[^>]+>/g, "") });
    };
    const handleChat = async () => {
      const text = chatInput.value.trim();
      if (!text) return;
      chatInput.value = "";
      addUser(text);
      conversationHistory.push({ role: "user", content: text });
      if (conversationHistory.length > 20) conversationHistory.splice(0, conversationHistory.length - 20);
      const changes = [];
      // Questions must reach the conversational Agent. Previously any mention
      // of “散点图/网格/线宽” was treated as an imperative and silently changed
      // controls, so “为什么散点图没有点？” could never receive an answer.
      const asksQuestion = /[?？]|为什么|为何|怎么|怎样|如何|什么|是否|能否|可不可以|解释|原因|区别|优缺点|建议|看不到|没有显示|不显示|消失|异常|问题|不对|不合理|重叠|失败|报错|出错/.test(text);
      if (!asksQuestion) {
      if (/柱状/.test(text)) { kind.value = "bar"; changes.push("图表类型 → 柱状图"); }
      else if (/折线/.test(text)) { kind.value = "line"; changes.push("图表类型 → 折线图"); }
      else if (/散点/.test(text)) { kind.value = "scatter"; changes.push("图表类型 → 散点图"); }
      const lw = text.match(/线宽(?:改为|调成|设为|为|=|:|：)?\s*(\d+(?:\.\d+)?)/);
      if (lw) {
        const v = Math.min(6, Math.max(1, Number(lw[1])));
        lineWidth.value = String(v);
        changes.push(`线宽 → ${v}`);
      }
      if (/网格/.test(text)) {
        if (/(关|隐藏|去掉|关闭)/.test(text)) { grid.checked = false; changes.push("网格 → 关"); }
        else if (/(开|显示|打开)/.test(text)) { grid.checked = true; changes.push("网格 → 开"); }
      }
      if (/数据点|标记/.test(text)) {
        if (/(不显示|隐藏|关|去掉)/.test(text)) { markers.value = "none"; changes.push("数据点 → 不显示"); }
        else if (/自动/.test(text)) { markers.value = "auto"; changes.push("数据点 → 自动"); }
        else if (/(显示|全部|所有|开)/.test(text)) { markers.value = "all"; changes.push("数据点 → 显示"); }
      }
      const tm = text.match(/标题(?:改为|设为|为|:|：)\s*(.+)/);
      if (tm) { title.value = tm[1].trim(); changes.push(`标题 → ${tm[1].trim()}`); }
      if (/深色/.test(text)) { theme.value = "dark"; changes.push("样式 → 深色演示"); }
      else if (/柔和/.test(text)) { theme.value = "soft"; changes.push("样式 → 柔和展示"); }
      else if (/出版/.test(text)) { theme.value = "publication"; changes.push("样式 → 科研出版"); }
      // 画布尺寸：图片改成 800×600 / 画布 1000x700（只改视觉尺寸）
      const sm = text.match(/(\d{3,4})\s*[×xX*]\s*(\d{3,4})/);
      if (sm && /(尺寸|大小|画布|图片|改|设|调)/.test(text)) {
        const w = Math.min(2400, Math.max(400, Math.round(Number(sm[1]))));
        const h = Math.min(1800, Math.max(300, Math.round(Number(sm[2]))));
        extraStyle.fig_size = [w, h];
        changes.push(`画布尺寸 → ${w}×${h} px`);
      }
      // 边框：加完整边框 / 去掉上边框 / 边框宽度改为 2
      if (/边框|框线/.test(text)) {
        const sp = { top: false, right: false, left: true, bottom: true, ...(extraStyle.spines || {}) };
        const sides = [["top", "上"], ["bottom", "下"], ["left", "左"], ["right", "右"]];
        let touched = false;
        if (/(完整|全部|所有|四边|四周|都)/.test(text)) {
          const on = !/(去|隐藏|关|无)/.test(text);
          sides.forEach(([side]) => { sp[side] = on; });
          touched = true;
        } else {
          sides.forEach(([side, zh]) => {
            const off = new RegExp(`(去掉|隐藏|关闭|不加|不要|无)[^，。；,.;]*${zh}边框|${zh}边框\\s*(去掉|隐藏|关闭)`);
            const on = new RegExp(`(加|加上|显示|打开|保留)[^，。；,.;]*${zh}边框|${zh}边框\\s*(加上|显示|打开)`);
            if (off.test(text)) { sp[side] = false; touched = true; }
            else if (on.test(text)) { sp[side] = true; touched = true; }
          });
          if (!touched && /(去掉|隐藏|关闭)边框/.test(text)) { sides.forEach(([side]) => { sp[side] = false; }); touched = true; }
          else if (!touched && /(加|显示|打开)边框/.test(text)) { sides.forEach(([side]) => { sp[side] = true; }); touched = true; }
        }
        if (touched) { extraStyle.spines = sp; changes.push("边框 → 已调整"); }
        const bwm = text.match(/边框(?:宽度|粗细)(?:改为|调成|设为|为|=)?\s*(\d+(?:\.\d+)?)/);
        if (bwm) {
          extraStyle.border_width = Math.min(4, Math.max(0.5, Number(bwm[1])));
          changes.push(`边框宽度 → ${extraStyle.border_width}`);
        }
      }
      // 轴标签：x轴标签为 Time (min) / y轴标签改为 Rate
      const xlm = text.match(/[xXＸ]轴标签(?:改为|设为|为|:|：)\s*(.+)/);
      if (xlm) { extraStyle.x_label = xlm[1].trim().slice(0, 60); changes.push(`X 轴标签 → ${extraStyle.x_label}`); }
      const ylm = text.match(/[yYＹ]轴标签(?:改为|设为|为|:|：)\s*(.+)/);
      if (ylm) { extraStyle.y_label = ylm[1].trim().slice(0, 60); changes.push(`Y 轴标签 → ${extraStyle.y_label}`); }
      // 线型 / 字号 / 刻度 / 数据点大小
      if (/虚线/.test(text)) { extraStyle.line_style = "dashed"; changes.push("线型 → 虚线"); }
      else if (/点线|点状线/.test(text)) { extraStyle.line_style = "dotted"; changes.push("线型 → 点线"); }
      else if (/实线/.test(text)) { extraStyle.line_style = "solid"; changes.push("线型 → 实线"); }
      const tsm = text.match(/标题字号(?:改为|设为|调成|为)?\s*(\d+(?:\.\d+)?)/);
      if (tsm) { extraStyle.title_size = Math.min(40, Math.max(10, Number(tsm[1]))); changes.push(`标题字号 → ${extraStyle.title_size}`); }
      const lsm = text.match(/(?:轴)?标签字号(?:改为|设为|调成|为)?\s*(\d+(?:\.\d+)?)/);
      if (lsm) { extraStyle.label_size = Math.min(24, Math.max(8, Number(lsm[1]))); changes.push(`标签字号 → ${extraStyle.label_size}`); }
      const tkm = text.match(/刻度字号(?:改为|设为|调成|为)?\s*(\d+(?:\.\d+)?)/);
      if (tkm) { extraStyle.tick_size = Math.min(20, Math.max(6, Number(tkm[1]))); changes.push(`刻度字号 → ${extraStyle.tick_size}`); }
      const tcm = text.match(/刻度(?:数量|个数)(?:改为|设为|调成|为)?\s*(\d{1,2})/);
      if (tcm) { extraStyle.tick_count = Math.min(10, Math.max(3, Math.round(Number(tcm[1])))); changes.push(`刻度数量 → ${extraStyle.tick_count}`); }
      const msm = text.match(/(?:数据点|标记)(?:大小|尺寸)(?:改为|设为|调成|为)?\s*(\d+(?:\.\d+)?)/);
      if (msm) { extraStyle.marker_size = Math.min(10, Math.max(1, Number(msm[1]))); changes.push(`数据点大小 → ${extraStyle.marker_size}`); }
      // 图例：图例放右边 / 隐藏图例 / 图例放底部
      if (/图例/.test(text)) {
        if (/(隐藏|去掉|关闭|不显示)/.test(text)) { extraStyle.legend = "none"; changes.push("图例 → 隐藏"); }
        else if (/(右|右侧)/.test(text)) { extraStyle.legend = "right"; changes.push("图例 → 右侧"); }
        else if (/(底|下面)/.test(text)) { extraStyle.legend = "bottom"; changes.push("图例 → 底部"); }
      }
      // 视图缩放：截取/放大 a 到 b；时间轴修改成 0-10min 等（只改视图，不改数据）
      let rm = text.match(/(?:截取|放大|聚焦|区间)\s*(-?\d+(?:\.\d+)?)\s*(?:到|至|~|–|—|-)\s*(-?\d+(?:\.\d+)?)/);
      if (!rm) {
        // 轴称谓 + 范围，允许“修改成0-10min”“改成 0 到 10 分钟”等说法
        rm = text.match(/(?:时间轴|时间|横轴|x轴|X轴).{0,8}?(-?\d+(?:\.\d+)?)\s*(?:到|至|~|–|—|-)\s*(-?\d+(?:\.\d+)?)\s*(?:min|分钟|sec|秒)?/);
      }
      if (!rm && /(范围|缩放|视图)/.test(text)) {
        rm = text.match(/(-?\d+(?:\.\d+)?)\s*(?:到|至|~|–|—)\s*(-?\d+(?:\.\d+)?)/);
      }
      if (rm) {
        const lo = Number(rm[1]), hi = Number(rm[2]);
        if (lo < hi) { xMin.value = String(lo); xMax.value = String(hi); changes.push(`X 视图区间 → ${lo}–${hi}（视觉缩放）`); }
      }
      if (/(重置|清除|取消).{0,4}(区间|缩放|视图)/.test(text) && !/[yYＹ]轴|纵轴/.test(text)) { xMin.value = ""; xMax.value = ""; changes.push("X 视图区间 → 已重置"); }
      // Y 视图区间：y轴 0 到 100 / 纵轴改成 0-100（同样只改视图）
      const yrm = text.match(/(?:[yYＹ]轴|纵轴).{0,8}?(-?\d+(?:\.\d+)?)\s*(?:到|至|~|–|—|-)\s*(-?\d+(?:\.\d+)?)/);
      if (yrm && !/标签/.test(text)) {
        const lo = Number(yrm[1]), hi = Number(yrm[2]);
        if (lo < hi) { extraStyle.y_range = [lo, hi]; changes.push(`Y 视图区间 → ${lo}–${hi}（视觉缩放）`); }
      }
      if (/(重置|清除|取消).{0,4}([yYＹ]轴|纵轴)/.test(text)) { delete extraStyle.y_range; changes.push("Y 视图区间 → 已重置"); }
      // 视觉标注线：在 y=0 加基线 / 在 x=15 加标注
      const hm = text.match(/y\s*=\s*(-?\d+(?:\.\d+)?)/);
      const vm = text.match(/x\s*=\s*(-?\d+(?:\.\d+)?)/);
      const lm = text.match(/(?:标注为|标签为|命名为|叫)\s*[「"“]?([^」"”，。；;]+?)[」"”]?\s*$/);
      if (hm && /(加|画|添加|标|基线)/.test(text)) {
        addAnnRow("hline", hm[1], lm ? lm[1] : (/基线/.test(text) ? "基线" : ""));
        changes.push(`水平标注线 → y=${hm[1]}`);
      } else if (vm && /(加|画|添加|标)/.test(text) && !/线宽|粗细/.test(text)) {
        addAnnRow("vline", vm[1], lm ? lm[1] : "");
        changes.push(`垂直标注线 → x=${vm[1]}`);
      }
      if (/清除(所有|全部)?标注/.test(text)) { annList.empty(); changes.push("标注线 → 全部清除"); }
      }
      syncStylePanel();
      renderQuick();
      renderColorRows();
      if (changes.length) {
        reportChanges(changes);
        return;
      }
      // 正则无命中或用户正在提问 → 对话 Agent 在回答、修改与 Skill 之间路由。
      const thinking = addThinking(asksQuestion ? "绘图 Agent 正在分析你的问题…" : "绘图 Agent 正在理解你的要求…");
      sendBtn.disabled = true;
      try {
        const current = { plot_kind: kind.value, title: title.value, x_column: xSelect.value, y_columns: getY(), chart_style: collectStyle() };
        const allowedCatalog = await schMaterialAllowedSkillCatalog(plugin);
        const allowedSummary = allowedCatalog.map((entry) => ({ name: entry.name, description: entry.description || entry.title || "" }));
        const prompt = [
          "你是 Scholarium 中可对话的科研绘图 Agent，不是只能改参数的命令解析器。你可以解释当前图表、诊断显示问题、比较图表类型、讨论数据可视化方法、回答科研绘图问题、提出建议，也可以在用户明确要求时修改图表或调用 Skill。",
          "只输出一个 JSON 对象，不要输出任何解释、Markdown 代码块或多余文字。",
          "",
          `已授权 Skills：${JSON.stringify(allowedSummary)}`,
          "需要调用 Skill 时输出：{\"action\":\"skill\",\"skill\":\"必须来自已授权列表\",\"input\":{}}。当前素材路径会由宿主补入 data_path，不要编造其他文件路径。",
          "用户在提问、要求解释、诊断或建议时输出：{\"action\":\"answer\",\"reply\":\"直接、有针对性的中文回答\"}。提问中出现‘散点图、网格、线宽’等词不代表要求修改。",
          "用户明确要求修改时输出：{\"action\":\"style\",\"patch\":{...},\"reply\":\"简要说明为何这样改\"}。可以同时解释并修改，但只有明确的修改意图才能写 patch。",
          "无法判断时也应优先正常对话，输出 answer 并说明需要用户补充什么；不要退回固定帮助菜单。",
          "",
          "允许写 chart_style 内的字段：theme(publication|soft|dark)、markers(auto|all|none)、show_grid(bool)、line_width(1-6)、line_style(solid|dashed|dotted)、marker_size(1-10)、x_range与y_range([min,max]或null=重置,只是视图缩放,不改数据)、annotations([{type:hline|vline,value:number,label:string}]完整替换,最多8条,空数组=清除)、series_colors({列名:#rrggbb})、fig_size([宽,高],400-2400×300-1800px)、spines({top,right,left,bottom}布尔,全true=完整边框)、border_width(0.5-4)、title_size(10-40)、label_size(8-24)、tick_size(6-20)、x_label与y_label(字符串或null=恢复默认)、legend(bottom|right|none)、tick_count(3-10)。",
          "顶层还允许：plot_kind(line|scatter|bar)、title(字符串)、x_column(列名)、y_columns([列名])。",
          "",
          `数据列：${headers.join("、")}`,
          `数据只读样本（最多40行）：${dataSample}`,
          `当前配置：${JSON.stringify(current)}`,
          `当前预览元数据：${JSON.stringify(currentPreviewManifest?.plot || {})}`,
          `最近对话：${JSON.stringify(conversationHistory.slice(-10, -1))}`,
          `用户指令：${text}`,
          "",
          "规则：先回答用户真正问的问题；Skill 名称必须严格来自已授权列表；只包含用户要求的输入；spines/series_colors 可只写要改的键；要求重置视图区间或轴标签时输出 null。不要声称看到了元数据中没有的信息。",
        ].join("\n");
        const raw = await schMaterialRunPlotAgent(plugin, prompt);
        const jsonText = (String(raw).match(/\{[\s\S]*\}/) || [""])[0];
        let decision = null;
        try { decision = JSON.parse(jsonText); } catch (_) { decision = null; }
        if (decision?.action === "skill") {
          const selected = allowedCatalog.find((entry) => entry.name === decision.skill);
          thinking.remove();
          if (!selected) addAgent(`Agent 请求的 Skill 未获授权或不存在：<code>${String(decision.skill || "")}</code>。请到设置页启用后重试。`);
          else {
            const proposed = decision.input && typeof decision.input === "object" && !Array.isArray(decision.input) ? decision.input : {};
            await runCatalogSkill(selected, { ...proposed, user_request: text, data_path: item.path });
          }
          return;
        }
        if (decision?.action === "answer" && typeof decision.reply === "string" && decision.reply.trim()) {
          thinking.remove();
          const reply = decision.reply.trim();
          const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
          addAgent(escape(reply).replace(/\n/g, "<br>"));
          conversationHistory.push({ role: "assistant", content: reply });
          recordAudit({ actor: "Agent", action: "回答绘图问题", detail: reply.slice(0, 240), status: "done" });
          return;
        }
        const patch = decision?.action === "style" ? decision.patch : decision;
        const san = schPlotSanitizeStylePatch(patch, headers);
        thinking.remove();
        if (san.notes.length) {
          if (typeof decision?.reply === "string" && decision.reply.trim()) {
            const reply = decision.reply.trim();
            const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
            addAgent(escape(reply).replace(/\n/g, "<br>"));
            conversationHistory.push({ role: "assistant", content: reply });
          }
          applyStylePatch(san);
          reportChanges(san.notes);
        } else {
          const fallback = "我可以继续回答当前数据、图表选择、坐标含义、显示异常和论文绘图方面的问题。请补充你想讨论的现象或目标。";
          addAgent(fallback);
          conversationHistory.push({ role: "assistant", content: fallback });
        }
      } catch (error) {
        thinking.remove();
        addAgent(`暂时无法联系绘图 Agent（${error.message || error}）。<br>` + SCH_PLOT_HELP_HTML);
      } finally {
        sendBtn.disabled = false;
      }
    };
    sendBtn.onclick = handleChat;
    chatInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); handleChat(); }
    });

    // ── Version history ──
    await refreshVersions();
    editVersion.onclick = () => {
      const selected = versions[Number(versionSelect.value)];
      if (!selected) return;
      schMaterialApplyPlotVersion(selected, controls, { addAnnRow, renderColorRows, syncStylePanel });
      renderQuick();
      updatePreview({ manifest: selected.manifest });
      hasRendered = true;
      updateRenderButtonLabel();
      saveMode.value = "overwrite";
      saveModeHint.setText("当前将覆盖所选版本；如需保留原图，请切换为“保存为新版本”。");
      render.addClass("plt-dirty");
      addAgent(`已打开版本 <code>${String(selected.manifest.created_at || "").replace("T", " ").slice(0, 19)}</code>，图像已显示在中央。修改后可覆盖该版本，也可另存为新版本。`);
    };

    // ── Initial header read ──
    try {
      const decoded = await schMaterialReadDelimitedText(plugin, file);
      const dataLines = decoded.text.split(/\r?\n/);
      dataSample = dataLines.slice(0, 40).join("\n").slice(0, 12000);
      dataPreview.setText(dataLines.slice(0, 80).join("\n") + (dataLines.length > 80 ? `\n… 其余 ${dataLines.length - 80} 行未显示` : ""));
      const ext = String(item.path).split(".").pop() || "csv";
      const parsed = schMaterialDelimitedHeader(decoded.text, ext);
      if (parsed.length < 2) throw new Error("未读取到至少两列标题");
      fillFields(parsed, parsed.slice(1));
      schMaterialApplyPlotVersion(existingVersion, controls, { addAnnRow, renderColorRows, syncStylePanel });
      renderQuick();
      if (existingVersion?.manifest) {
        hasRendered = true;
        saveMode.value = "overwrite";
        updateRenderButtonLabel();
        await updatePreview({ manifest: existingVersion.manifest });
      }
      renderSteps(["done", "", ""]);
      addAgent(`已读取 <code>${item.path.split("/").pop()}</code>（${decoded.encoding} 编码），检测到 ${parsed.length} 列：<strong>${parsed.join("、")}</strong>。建议以 <strong>${parsed[0]}</strong> 为 X 轴绘图。`);
    } catch (error) {
      addAgent(`读取表头失败：${error.message || error}`);
      render.disabled = true;
    }

    // ── Profile action ──
    profile.onclick = async () => {
      let thinking = null;
      try {
        profile.disabled = true;
        activeSkillChip.setText("✦ sch-data-profile-audit");
        recordAudit({ actor: "用户", action: "调用 Skill", detail: "分析数据字段、缺失值与数值范围", skill: "sch-data-profile-audit", status: "running" });
        renderSteps(["done", "running", ""]);
        thinking = addThinking("织研者正在分析字段（只读）…");
        const result = await schMaterialRunAllowedSkill(plugin, "sch-data-profile-audit", { data_path: item.path });
        thinking.remove();
        const numeric = (result.manifest?.columns || []).filter((column) => column.inferred_type === "numeric").map((column) => column.name);
        const all = (result.manifest?.columns || []).map((column) => column.name);
        if (all.length) fillFields(all, numeric);
        schMaterialApplyPlotVersion(existingVersion, controls, { addAnnRow, renderColorRows, syncStylePanel });
        renderQuick();
        renderSteps(["done", "done", hasRendered ? "done" : ""]);
        const encoding = result.manifest?.input?.encoding ? `，编码 ${result.manifest.input.encoding}` : "";
        addAgent(`分析完成：共 <strong>${result.manifest?.input?.rows || 0}</strong> 行、${all.length} 列；数值列 <strong>${numeric.length}</strong> 个（${numeric.join("、") || "无"}）${encoding}。已自动勾选数值列作为 Y 轴。`);
        recordAudit({ actor: "Skill", action: "字段画像完成", detail: `${result.manifest?.input?.rows || 0} 行 · ${all.length} 列 · ${numeric.length} 个数值列`, skill: "sch-data-profile-audit", status: "done" });
      } catch (error) {
        if (thinking) thinking.remove();
        addAgent(`字段分析失败：${error.message || error}`);
        recordAudit({ actor: "Skill", action: "字段画像失败", detail: String(error.message || error), skill: "sch-data-profile-audit", status: "error" });
        renderSteps(["done", "", ""]);
      } finally {
        profile.disabled = false;
      }
    };
    render.onclick = () => doRender();

    // ── Real Skill launcher: runtime Bridge catalog filtered by settings ──
    const runGuidanceSkill = async (entry, input = {}) => {
      const name = String(entry.name);
      const thinking = addThinking(`正在让本地只读 Agent 应用 ${name}…`);
      recordAudit({ actor: "Agent", action: "应用指导型 Skill", detail: name, skill: name, status: "running" });
      try {
        const current = { plot_kind: kind.value, title: title.value, x_column: xSelect.value, y_columns: getY(), chart_style: collectStyle() };
        const prompt = [
          "你是 Scholarium 的科研绘图配置代理。请应用下面已由用户授权的 SKILL.md 指导，但只能输出受控绘图配置，禁止生成或执行代码。",
          "当前绘图后端已经明确选择 Python；不需要再次询问 Python 或 R。",
          "只输出 JSON，不要 Markdown。绘图指导输出 {\"action\":\"style\",\"patch\":{...},\"summary\":\"一句话说明\"}；纯只读分析输出 {\"action\":\"analysis\",\"summary\":\"分析结论\",\"recommendations\":[\"建议\"]}。",
          "只允许 patch 使用宿主支持的字段：plot_kind、title、x_column、y_columns、chart_style.theme/markers/show_grid/line_width/line_style/marker_size/x_range/y_range/annotations/series_colors/fig_size/spines/border_width/title_size/label_size/tick_size/x_label/y_label/legend/tick_count。",
          "优先保证标题、刻度、轴标签和图例不重叠；长标题应降低字号或增大画布，系列较多时优先右侧图例。不要修改、平滑或筛选原始数据。",
          `Skill：${name}`,
          `Skill 指导：${String(entry.instruction || entry.description || entry.subtitle || "").slice(0, 8000)}`,
          `数据列：${headers.join("、")}`,
          `数据只读样本（最多40行）：${dataSample}`,
          `当前配置：${JSON.stringify(current)}`,
          `本次要求：${JSON.stringify(input || {})}`,
        ].join("\n\n");
        const raw = await schMaterialRunPlotAgent(plugin, prompt);
        const jsonText = (String(raw).match(/\{[\s\S]*\}/) || [""])[0];
        const decision = JSON.parse(jsonText);
        const san = schPlotSanitizeStylePatch(decision?.patch || decision, headers);
        thinking.remove();
        if (!san.notes.length && decision?.action === "analysis" && decision?.summary) {
          const recommendations = Array.isArray(decision.recommendations) ? decision.recommendations.slice(0, 8) : [];
          const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
          addAgent(`<strong>${escape(name)}</strong> 只读分析：${escape(decision.summary)}${recommendations.length ? `<br>建议：${recommendations.map(escape).join("；")}` : ""}`);
          activeSkillChip.setText(`✦ ${name}`);
          recordAudit({ actor: "Skill", action: "只读分析完成", detail: String(decision.summary), skill: name, status: "done" });
          return decision;
        }
        if (!san.notes.length) throw new Error("Skill 没有返回当前绘图器可安全应用的配置或只读分析");
        applyStylePatch(san);
        reportChanges([`已应用 ${name}`, ...san.notes]);
        activeSkillChip.setText(`✦ ${name}`);
        recordAudit({ actor: "Skill", action: "指导已应用", detail: String(decision?.summary || san.notes.join("；")), skill: name, status: "done" });
        return decision;
      } catch (error) {
        thinking.remove();
        addAgent(`指导型 Skill <code>${name}</code> 应用失败：${error.message || error}`);
        recordAudit({ actor: "Skill", action: "指导应用失败", detail: String(error.message || error), skill: name, status: "error" });
        return null;
      }
    };
    const runCatalogSkill = async (entry, input = { data_path: item.path }) => {
      const name = String(entry.name);
      if (name === "sch-data-plot") return doRender();
      if (name === "sch-data-profile-audit") return profile.onclick();
      if (!entry.executable) return runGuidanceSkill(entry, input);
      const thinking = addThinking(`正在调用 ${name}…`);
      recordAudit({ actor: "Agent", action: "调用 Skill", detail: `直接调用 ${name}`, skill: name, status: "running" });
      try {
        let result;
        if (name === "sch-data-cleaning-plan") {
          const profileResult = await schMaterialRunAllowedSkill(plugin, "sch-data-profile-audit", { data_path: item.path });
          result = await schMaterialRunAllowedSkill(plugin, name, { manifest: profileResult.manifest || profileResult });
        } else {
          result = await schMaterialRunAllowedSkill(plugin, name, input);
        }
        thinking.remove();
        const manifest = result.manifest || result;
        const summary = manifest.summary || manifest.recommendation || manifest.classification?.primary || manifest.recommended_template || manifest.status || "执行完成";
        addAgent(`已直接调用 <code>${name}</code>：${typeof summary === "string" ? summary : JSON.stringify(summary)}。`);
        recordAudit({ actor: "Skill", action: "Skill 执行完成", detail: String(typeof summary === "string" ? summary : JSON.stringify(summary)), skill: name, status: "done" });
        return result;
      } catch (error) {
        thinking.remove();
        addAgent(`Skill <code>${name}</code> 调用失败：${error.message || error}`);
        recordAudit({ actor: "Skill", action: "Skill 执行失败", detail: String(error.message || error), skill: name, status: "error" });
        return null;
      }
    };
    const addSkillOption = (entry) => {
      const name = String(entry.name);
      const button = skillPopover.createEl("button", { cls: "plt-skill-item" });
      button.createSpan({ cls: "plt-skill-icon", text: "✦" });
      const copy = button.createSpan({ cls: "plt-skill-copy" });
      copy.createEl("strong", { text: name });
      copy.createSpan({ text: `${entry.executable ? "可执行工具" : "Agent 指导"} · ${String(entry.description || entry.subtitle || entry.title || "本机 Bridge Skill")}` });
      button.onclick = async (event) => {
        event.stopPropagation();
        root.removeClass("plt-skills-open");
        activeSkillChip.setText(`✦ ${name}`);
        await runCatalogSkill(entry);
      };
    };
    const refreshSkillPopover = async () => {
      skillPopover.querySelectorAll(".plt-skill-item,.plt-skill-empty").forEach((node) => node.remove());
      try {
        const allowedCatalog = await schMaterialAllowedSkillCatalog(plugin);
        if (!allowedCatalog.length) skillPopover.createDiv({ cls: "plt-skill-empty", text: "设置页尚未启用任何可调用 Skill，或 Bridge 未连接。" });
        allowedCatalog.forEach(addSkillOption);
      } catch (error) {
        skillPopover.createDiv({ cls: "plt-skill-empty", text: `无法读取 Skills：${error.message || error}` });
      }
    };
    skillsBtn.onclick = (event) => {
      event.stopPropagation();
      root.classList.toggle("plt-skills-open");
      if (root.classList.contains("plt-skills-open")) refreshSkillPopover();
    };
    const onOutsideSkills = (event) => {
      if (!skillPopover.contains(event.target) && !skillsBtn.contains(event.target)) root.removeClass("plt-skills-open");
    };
    document.addEventListener("click", onOutsideSkills);
    root._pltOutsideSkills = onOutsideSkills;
  };
  modal.onClose = () => {
    const handler = modal.contentEl?._pltOutsideSkills;
    if (handler) document.removeEventListener("click", handler);
    if (modal.contentEl) delete modal.contentEl._pltOutsideSkills;
    modal.contentEl.empty();
  };
  modal.open();
}
async function schOpenMaterialDatasetPicker(plugin) {
  const state = await plugin.loadData();
  const datasets = (state?.materialLibrary?.items || []).filter(schMaterialIsPlotData);
  if (!datasets.length) { new Eo.Notice("素材库中尚无 CSV/TSV。请先打开素材库并拖入数据文件。"); return; }
  const modal = new Eo.Modal(plugin.app);
  modal.onOpen = () => {
    const root = modal.contentEl; root.empty(); root.addClass("sch-material-picker-modal");
    root.createEl("h2", { text: "选择素材库数据集" });
    root.createEl("p", { text: "选择后由织研者的安全绘图工具读取数据；原始文件保持只读。", cls: "setting-item-description" });
    const select = root.createEl("select", { cls: "sch-material-picker-select" });
    datasets.forEach((entry) => select.createEl("option", { text: `${entry.name} · ${entry.path}`, attr: { value: entry.id } }));
    const actions = root.createDiv({ cls: "sch-material-plot-actions" });
    actions.createEl("button", { text: "取消" }).onclick = () => modal.close();
    actions.createEl("button", { text: "继续绘图", cls: "mod-cta" }).onclick = () => { const picked = datasets.find((entry) => entry.id === select.value); modal.close(); picked && schOpenMaterialPlotter(plugin, picked); };
  };
  modal.onClose = () => modal.contentEl.empty(); modal.open();
}
async function schOpenMaterialWorkbench(library, item, existingVersion = null) {
  const root = library?.container;
  const host = library?.workbenchHost;
  if (!root || !host) return schOpenMaterialPlotter(library.plugin, item, existingVersion);
  root.addClass("mat-workbench-open");
  if (host._pltOutsideSkills) document.removeEventListener("click", host._pltOutsideSkills);
  host.empty();
  host.setAttribute("data-source", item.path || "");
  await schOpenMaterialPlotter(library.plugin, item, existingVersion, {
    contentEl: host,
    onClose: () => {
      root.removeClass("mat-workbench-open");
      host.removeAttribute("data-source");
      library.loadGeneratedImages().finally(() => { if (root.isConnected) library.render(root); });
    },
  });
}

export function installMaterialPlotting(Vs) {
  const schOriginalMaterialRenderGallery = Vs.prototype.renderGallery;
  Vs.prototype.renderGallery = function (container) {
    schOriginalMaterialRenderGallery.call(this, container);
    const cards = Array.from(container.querySelectorAll(".mat-card"));
    this.filteredItems.forEach((item, index) => {
      if (!schMaterialIsPlotData(item) && !schMaterialNeedsNormalization(item)) return;
      const actions = cards[index]?.querySelector(".mat-card-actions");
      if (!actions || actions.querySelector(".sch-material-plot-action, .sch-material-normalize-action")) return;
      const button = document.createElement("button");
      if (schMaterialIsPlotData(item)) {
        button.textContent = "📈";
        button.className = "mat-action-btn sch-material-plot-action";
        button.title = "织研者数据绘图";
        button.onclick = (event) => { event.stopPropagation(); schOpenMaterialWorkbench(this, item); };
      } else {
        button.textContent = "⇄";
        button.className = "mat-action-btn sch-material-normalize-action";
        button.title = "先规范化为可复现 CSV";
        button.onclick = (event) => { event.stopPropagation(); schOpenMaterialNormalization(this, item); };
      }
      actions.appendChild(button);
    });
  };
}

export {
  schMaterialIsPlotData,
  schMaterialNeedsNormalization,
  schMaterialIsTiff,
  schMaterialOpenTiff,
  schMaterialPlotVersions,
  schDescribeMaterialRuntimeFailure,
  schOpenMaterialNormalization,
  schOpenMaterialPlotter,
  schOpenMaterialDatasetPicker,
  schOpenMaterialWorkbench,
  schMaterialRunSkill,
  schRenderMaterialAgentSkillSettings,
  schRenderAgentEnvironment,
  schPlotSanitizeStylePatch,
};
