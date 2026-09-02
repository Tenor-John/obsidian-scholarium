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

function parseActionRequests(text) {
  const actions = [];
  const cleaned = String(text || "").replace(/```scholarium-action\s*\n([\s\S]*?)```/g, (match, body) => {
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
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), actions };
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
  const drafts = [];
  const cleaned = String(text || "").replace(/```scholarium-draft\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const rawItems = Array.isArray(parsed?.items) ? parsed.items : (parsed?.path ? [parsed] : null);
      if (!rawItems) return match;
      const items = rawItems.map((item) => ({
        path: String(item?.path || "").replace(/\\/g, "/").slice(0, 300),
        content: String(item?.content || "").slice(0, 200000),
      }));
      const allValid = items.length > 0 && items.every((item) => isValidDraftPath(item.path) && item.content.trim());
      if (!allValid) return match; // 路径/内容不合法：留给服务端兜底，同时让用户看到原块
      drafts.push({ items, reason: String(parsed.reason || "").slice(0, 300) });
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), drafts };
}

/* parseSuggestReconstructionRequests —— ```scholarium-suggest-reconstruction```
 * 围栏块：比 scholarium-action（L1 白名单动作）和 scholarium-draft（新建草稿）
 * 都更弱的一类——模型只能表达"建议从这个种子 DOI 开始做一次证据重建"的意图，
 * 内容只有 { seed_doi, reason }，不带任何可执行载荷。渲染成的卡片只有一个
 * "打开重建面板"按钮，点击后跳转到项目面板的种子重建弹窗并预填 DOI；全程不
 * 发起任何网络请求或写入——真正的候选发现/审计/下载/准入都在弹窗里，受各自
 * 已有的权限车道约束（研究只读 / fetch_and_attach_pdf / drafts/batch）。 */
function parseSuggestReconstructionRequests(text) {
  const suggestions = [];
  const cleaned = String(text || "").replace(/```scholarium-suggest-reconstruction\s*\n([\s\S]*?)```/g, (match, body) => {
    try {
      const parsed = JSON.parse(body.trim());
      const seedDoi = String(parsed?.seed_doi || "").trim();
      if (!seedDoi) return match;
      suggestions.push({ seed_doi: seedDoi.slice(0, 200), reason: String(parsed.reason || "").slice(0, 300) });
      return "";
    } catch { return match; }
  });
  return { text: cleaned.replace(/\n{3,}/g, "\n\n").trim(), suggestions };
}

const chatActionsApi = { parseActionRequests, parseDraftRequests, parseSuggestReconstructionRequests };
if (typeof module !== "undefined" && module.exports) module.exports = chatActionsApi;
if (typeof window !== "undefined") window.weaverChatActionsCore = chatActionsApi;
