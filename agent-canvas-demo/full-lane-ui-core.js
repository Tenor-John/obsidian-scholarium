"use strict";
/* full-lane-ui-core.js — full 车道面板 UI 的纯函数核心。
 *
 * 两块确定性逻辑，抽出来单独可测（沿用 query-loop-core.js 的壳模式）：
 *
 * 1. probeGateFromError(status, message)：dispatch 被 §1 探测门槛拦下时
 *    （503 + 四种 probe 原因），把英文原始错误翻译成结构化信息，UI 据此渲染
 *    "适配器需要重新探测，点这里"的引导按钮，而不是把一句英文错误甩给用户。
 *
 * 2. fullTaskCardModel(run)：把 GET /v1/full-tasks/:id 的运行记录翻译成状态卡
 *    视图模型。关键约束（评审意见）：completed 和 completed-with-violations
 *    在 UI 上必须是两种肉眼可分的呈现，§5 快照 diff 的摘要（新增/修改/删除/
 *    越界清单）必须亮出来，不能吞掉这个区分。
 *
 * 浏览器：window.weaverFullLaneCore；Node：module.exports。
 */

/* 与 bridge/server.js fullLaneProbeBlock() 的四种拒绝文案一一对应。 */
const PROBE_GATE_PATTERN = /adapter '([^']+)' (has never passed a capability probe|failed its last capability probe|configuration changed since its last probe|probe is older than 30 days)/;

function probeGateFromError(status, message) {
  if (status !== 503) return null;
  const match = PROBE_GATE_PATTERN.exec(String(message || ""));
  if (!match) return null;
  const reasonText = {
    "has never passed a capability probe": "这个适配器还没有通过过能力探测",
    "failed its last capability probe": "这个适配器上一次能力探测未通过",
    "configuration changed since its last probe": "这个适配器的配置在上次探测后被改过",
    "probe is older than 30 days": "这个适配器的探测结果已超过 30 天",
  }[match[2]] || match[2];
  return { adapter: match[1], reason: match[2], reasonText };
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "大小未知";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const DOWNLOAD_STATUS_TEXT = {
  downloaded: "新下载",
  already_present: "已存在（字节一致，未重复保存）",
  variant_saved: "同名不同内容，已存为变体",
};

function fullTaskCardModel(run) {
  const diff = run && run.diff ? run.diff : { added: [], modified: [], deleted: [] };
  const violations = Array.isArray(run?.violations) ? run.violations : [];
  const base = {
    status: run?.status || "unknown",
    added: diff.added || [],
    modified: diff.modified || [],
    deleted: diff.deleted || [],
    violations,
    adapter: run?.adapter || "",
    category: run?.category || "",
    finalMessage: run?.finalMessage || null,
    landing: run?.landing || null,
    download: run?.download
      ? { ...run.download, bytesText: formatBytes(run.download.bytes), statusText: DOWNLOAD_STATUS_TEXT[run.download.status] || run.download.status }
      : null,
  };
  if (base.status === "running") {
    return { ...base, tone: "running", title: "任务运行中", summary: "Agent 正在定位开放获取 PDF；完成后 Bridge 会自行下载并校验。" };
  }
  if (base.status === "completed" && base.landing && !base.download) {
    // 合法的非下载结局：Agent 确认没有 OA 版本并给出了着陆页。不是失败，
    // 但也不是"已完成下载"——用独立的 info 态呈现，给出 WebClip 建议。
    return {
      ...base, tone: "info", title: "未找到开放获取 PDF",
      summary: base.landing.reason || "该文献没有开放获取版本。可打开下方出版方页面，用 WebClip 保存为 md 到素材库阅读。",
    };
  }
  if (base.status === "completed") {
    return { ...base, tone: "ok", title: "已完成", summary: "所有文件改动都在声明的路径范围内。" };
  }
  if (base.status === "completed-with-violations") {
    return {
      ...base, tone: "warn", title: "已完成，但检测到声明范围外的文件改动",
      summary: `快照 diff 发现 ${violations.length} 处越界改动。系统不做自动回滚——请人工核对下方清单后决定如何处理。`,
    };
  }
  if (base.status === "failed") {
    return { ...base, tone: "error", title: "任务失败", summary: run?.failureMessage || "任务失败，未提供原因。" };
  }
  if (base.status === "cancelled") {
    // 用户主动取消：不是失败也不是成功。快照 diff 照常展示——被取消的
    // 进程在收到信号前可能已经写过东西，藏起这个信息反而不诚实。
    return { ...base, tone: "info", title: "任务已取消", summary: "由你主动取消。下方仍列出取消前已发生的文件改动（如有），请核对。" };
  }
  if (base.status === "interrupted") {
    // 磁盘记录自称 running 但 Bridge 内存里已没有：进程随 Bridge 重启死掉了。
    return { ...base, tone: "error", title: "任务已中断", summary: "Bridge 重启导致这个任务的进程被终止。可以重新派发一次（审计日志 bridge/audit/ 留有中断前的记录）。" };
  }
  return { ...base, tone: "error", title: `未知状态：${base.status}`, summary: "运行记录缺失或已过期（Bridge 重启后内存中的运行记录会丢失，审计日志 bridge/audit/ 是持久记录）。" };
}

/* 从检索结果记录构造 full 车道对话框的预填文本。格式与对话框占位符一致：
 * "DOI（标题, 作者 年份）"——DOI 优先，无 DOI 时退到标题。 */
function buildFetchPromptFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  const doi = String(record.doi || "").trim();
  const title = String(record.title || "").trim();
  const authors = String(record.authors || "").trim();
  const year = record.year ? String(record.year).trim() : "";
  const head = doi || title;
  if (!head) return "";
  const detail = [doi && title ? title : "", [authors, year].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return detail ? `${head}（${detail}）` : head;
}

/* 从 full 车道任务的 prompt 里提取标题提示，供 rss.clip_url 命名剪藏文件夹。
 * prompt 形如 "10.1002/adfm.201801214（Some Title, Author et al. 2018）"，
 * 取括号内到第一个逗号为止的部分；取不到就返回空串，让抓取方用页面自身的
 * 标题（clipAndSummarize 里 e.title || d.title 的 fallback 顺序）。 */
function titleHintFromPrompt(prompt) {
  const match = /[（(]([^（）()]+?)[,，]/.exec(String(prompt || ""));
  return match ? match[1].trim().slice(0, 120) : "";
}

/* 从失败任务的 Agent 说明里解析它报告过的 PDF 候选（full 车道 prompt 契约
 * 要求 Agent 以 PDF_URL= / PDF_NAME= 行汇报）。只在"任务失败但 Agent 其实
 * 找到了地址"时有值——这正是 Bridge 直连下载被反爬/付费墙拦下的情形，UI
 * 据此给出"经浏览器会话重试下载"的回退按钮（rss.fetch_pdf 动作）。 */
function reportedPdfFromMessage(message) {
  const text = String(message || "");
  const urlMatch = /PDF_URL=(https?:\/\/\S+)/i.exec(text);
  if (!urlMatch) return null;
  const pdfUrl = urlMatch[1].replace(/[)\]）】>'"，。；;.]+$/, "");
  if (!/^https?:\/\/\S+$/i.test(pdfUrl)) return null;
  const nameMatch = /PDF_NAME=([^\n\r]+)/i.exec(text);
  const pdfName = nameMatch ? nameMatch[1].trim().replace(/[)\]>'"，。；;]+$/, "").slice(0, 110) : "";
  return { pdfUrl, pdfName };
}

/* 从 full 车道 prompt（或 Agent 说明）里提取 DOI，供"经机构通道（WebVPN）
 * 下载"回退按钮调用 scansci-institutional。prompt 契约是
 * "10.xxxx/...（标题, 作者 年份）"，DOI 在句首；容错起见全文找第一个
 * 合法 DOI。 */
function doiFromPrompt(text) {
  const match = /10\.\d{4,9}\/[^\s，,（）()"']+/i.exec(String(text || ""));
  return match ? match[0].replace(/[.。;；,，]+$/, "") : null;
}

/* buildFetchAndAttachPreviewBody / buildFetchAndAttachDispatchBody — 唯一一对
 * 构造 fetch_and_attach_pdf 请求体的纯函数。此前这两个 JSON 字面量只内联在
 * openFullLaneDialog() 的两处点击处理里；新增的种子文献重建工作流（阶段 C，
 * 每篇候选各自逐一派发同一个 full-lane 类别）需要复用同一套请求体构造，不能
 * 重新拼一份、也不能新增 full-lane 类别——抽出来是为了让第二个调用方不必复制
 * 这段 JSON 形状。不改变原有两处调用点的行为。 */
function buildFetchAndAttachPreviewBody({ workspace, prompt }) {
  return { category: "fetch_and_attach_pdf", workspace, prompt };
}

function buildFetchAndAttachDispatchBody({ previewId, category, workspace, prompt }) {
  return { previewId, category, workspace, prompt };
}

const fullLaneUiApi = { PROBE_GATE_PATTERN, probeGateFromError, formatBytes, fullTaskCardModel, DOWNLOAD_STATUS_TEXT, buildFetchPromptFromRecord, titleHintFromPrompt, reportedPdfFromMessage, doiFromPrompt, buildFetchAndAttachPreviewBody, buildFetchAndAttachDispatchBody };
if (typeof module !== "undefined" && module.exports) module.exports = fullLaneUiApi;
if (typeof window !== "undefined") window.weaverFullLaneCore = fullLaneUiApi;
