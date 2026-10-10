"use strict";
/**
 * sidecar-notice — 无 sidecar 运行时时，XLSX 聊天卡/规范化入口的响亮降级。
 *
 * 背景（C2）：BRAT/社区目录只装三件套。没有 sidecar 时 Bridge 根本不存在，
 * XLSX 入口的技能调用会以 `fetch failed` / `ECONNREFUSED` 之类原始错误收场——
 * 用户看不懂，也不知道怎么修。本模块把失败翻译成**明确、可读、可行动**的提示。
 *
 * 设计约束：零依赖、可被 main.js 内联（main.js 是 DEC-008 冻结产物，
 * 集成点见 docs/out-of-box/HANDOFF-agent-c-day1.md 第 2 批——由 Agent A 合入）。
 *
 * 契约（测试锁定）：
 *  - 任何输入都返回 { kind, title, message, actions[], detail? }，绝不抛错；
 *  - message 必须是完整中文句子，包含「是什么坏了」和「怎么办」；
 *  - 原始技术错误只出现在 detail 字段，绝不单独作为 message；
 *  - runtime-absent 时必须给出两条出路：一键下载 / 手动放入包文件（离线）。
 */

const KINDS = Object.freeze({
  RUNTIME_ABSENT: "runtime-absent",       // 三件套环境：运行时从未安装
  RUNTIME_DEGRADED: "runtime-degraded",   // 运行时损坏
  BRIDGE_UNREACHABLE: "bridge-unreachable", // 运行时在，但 Bridge 连不上
  SKILL_NOT_FOUND: "skill-not-found",
  SKILL_DISABLED: "skill-disabled",
  UNKNOWN: "unknown",
});

/** 把原始错误归类。只读 message/code，不执行任何 I/O。 */
function classifyError(error) {
  const text = String((error && (error.message || error.code)) || error || "");
  if (/ECONNREFUSED|ECONNRESET|fetch failed|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up/i.test(text)) {
    return KINDS.BRIDGE_UNREACHABLE;
  }
  if (/未在设置.*启用|未在.*允许|not.*allow/i.test(text)) return KINDS.SKILL_DISABLED;
  if (/未发现.*Skill|not found|404/i.test(text)) return KINDS.SKILL_NOT_FOUND;
  return KINDS.UNKNOWN;
}

const NOTICES = {
  [KINDS.RUNTIME_ABSENT]: {
    title: "本地运行时尚未安装",
    message:
      "XLSX 聊天卡与数据规范化由本地运行时（Bridge 与技能服务）提供，当前安装只包含插件本体，" +
      "运行时还没有下载。修复方式：① 打开「设置 → Scholarium → 本地运行时」点击一键下载（约 90 MB，自动校验安装）；或 " +
      "② 离线环境：把运行时包文件放入运行时目录的 incoming/ 文件夹后点击「从本地安装」。安装完成后此入口自动可用。",
    actions: ["打开运行时设置并下载", "离线：从本地包文件安装"],
  },
  [KINDS.RUNTIME_DEGRADED]: {
    title: "本地运行时文件不完整",
    message:
      "运行时目录存在但内容缺失（可能是被杀毒软件清理或磁盘异常）。请到「设置 → Scholarium → 本地运行时」" +
      "执行「修复」：系统会先尝试回滚到上一可用版本，失败则重新下载安装。你的 Vault 数据不受影响。",
    actions: ["修复运行时（回滚或重装）"],
  },
  [KINDS.BRIDGE_UNREACHABLE]: {
    title: "无法连接本地 Bridge 服务",
    message:
      "运行时已安装，但 Bridge 服务没有响应。通常重启即可恢复：「设置 → Scholarium → 本地运行时 → 重启 Bridge」。" +
      "若反复失败，请从同一面板导出诊断包反馈。XLSX 文件本身未被改动。",
    actions: ["重启 Bridge", "导出诊断包"],
  },
  [KINDS.SKILL_DISABLED]: {
    title: "所需技能未启用",
    message:
      "数据规范化技能（sch-data-normalize）未在「设置 → 织研者 Agent → 素材库 Agent 可调用 Skills」中启用。" +
      "启用后重试即可；这是刻意的人工确认闸门，不是故障。",
    actions: ["前往设置启用技能"],
  },
  [KINDS.SKILL_NOT_FOUND]: {
    title: "Bridge 中未找到所需技能",
    message:
      "Bridge 在运行，但没有注册 sch-data-normalize 技能，通常是运行时版本与插件不匹配。" +
      "请到「设置 → Scholarium → 本地运行时」检查更新，或重启 Bridge 后重试。",
    actions: ["检查运行时更新", "重启 Bridge"],
  },
  [KINDS.UNKNOWN]: {
    title: "读取文件结构失败",
    message:
      "XLSX 聊天卡遇到一个未归类错误，原文件保持只读、未被改动。" +
      "请重试一次；若持续失败，从「设置 → Scholarium → 本地运行时」导出诊断包反馈，技术细节已附在下方。",
    actions: ["重试", "导出诊断包"],
  },
};

/**
 * XLSX 入口降级提示。runtimeState 来自 runtime-bootstrap status().state
 * （absent / ready / degraded）；error 是技能调用捕获到的原始错误（可为空）。
 * 任何情况下都返回完整通知对象——失败必须响亮，且必须告诉用户怎么办。
 */
function describeXlsxEntryUnavailable(runtimeState, error) {
  let kind;
  if (runtimeState === "absent") kind = KINDS.RUNTIME_ABSENT;
  else if (runtimeState === "degraded") kind = KINDS.RUNTIME_DEGRADED;
  else kind = classifyError(error);
  const base = NOTICES[kind] || NOTICES[KINDS.UNKNOWN];
  const notice = { kind, title: base.title, message: base.message, actions: [...base.actions] };
  const detail = String((error && (error.message || error.code)) || error || "").trim();
  if (detail) notice.detail = detail; // 技术细节保留，但只放 detail
  return notice;
}

module.exports = { KINDS, classifyError, describeXlsxEntryUnavailable };
