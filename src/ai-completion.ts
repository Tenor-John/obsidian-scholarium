// @ts-nocheck
/* Shared AI transport recovered from the released RSS/project-profile feature.
 * It retains Anthropic-compatible endpoints, token-limit diagnostics and the
 * Obsidian requestUrl transport used by the existing provider settings. */
import { requestUrlWithTimeout as We } from "./utils/network";

var zs = {
    deepseek: "deepseek-chat",
    claude: "claude-opus-4-5",
    openai: "gpt-4.1",
    gemini: "gemini-2.5-pro",
    minimax: "MiniMax-M2.7",
    "minimax-anthropic": "MiniMax-M3",
    custom: "",
    "custom-anthropic": "",
  },
  Ws = {
    deepseek: "https://api.deepseek.com/chat/completions",
    claude: "https://api.anthropic.com/v1/messages",
    openai: "https://api.openai.com/v1/chat/completions",
    gemini:
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    minimax: "https://api.minimaxi.com/v1/chat/completions",
    "minimax-anthropic": "https://api.minimaxi.com/anthropic/v1/messages",
    custom: "",
    "custom-anthropic": "",
  };

async function hn(o, t = 0, d = 25e3) {
  let e;
  for (let s = 0; s <= t; s++)
    try {
      return await We(o, d);
    } catch (i) {
      e = i;
      let r = String((i == null ? void 0 : i.message) || i);
      if (
        !/RESET|ECONNRESET|ETIMEDOUT|network|timed out|ENOTFOUND|EAI_AGAIN/i.test(
          r,
        )
      )
        throw i;
      await new Promise((n) => setTimeout(n, 800 * (s + 1)));
    }
  throw e;
}
async function Sl(o, t, e, Mx) {
  var a, l, c, h, d, p, u, g;
  let f = e.requestTimeout || 25e3,
    Tk = Mx && Mx > 0 ? Mx : 1200;
    /* SCHOLARIUM_RSS_ANTHROPIC_COMPAT_V2 */
  if (e.provider === "claude" || e.provider === "minimax-anthropic" || e.provider === "custom-anthropic") {
    let y = e.provider === "custom-anthropic" ? (e.customEndpoint || "") : Ws[e.provider];
    y = y.trim();
    if (!y)
      throw new Error(
        "请填写 Anthropic 兼容模型的基础地址或 /v1/messages 完整地址",
      );
    if (e.provider === "custom-anthropic") {
      if (!/^https?:\/\//i.test(y) && /^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(y)) y = `https://${y}`;
      y = y.replace(/\/+$/, "");
      if (!/\/messages(?:[?#].*)?$/i.test(y)) y += /\/v1$/i.test(y) ? "/messages" : "/v1/messages";
    }
    if (!/^https:\/\//i.test(y)) throw new Error("Anthropic 兼容端点必须是 HTTPS 地址");
    if (!e.apiKey.trim()) throw new Error("请填写 Anthropic 兼容 API Key");
    let b = e.model || zs[e.provider];
    if (!b.trim()) throw new Error("请填写 AI 模型型号");
    let m = await hn({
      url: y,
      method: "POST",
      throw: !1,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": e.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        ...(e.provider !== "claude" ? { Authorization: `Bearer ${e.apiKey.trim()}` } : {}),
      },
      body: JSON.stringify({
        model: b,
        max_tokens: Tk,
        system: o,
        messages: [{ role: "user", content: t }],
      }),
    }, 0, f);
    if (m.status >= 400) {
      let hint = m.status === 404
        ? "未找到 Messages 路由"
        : m.status === 405
          ? "该地址不接受 POST，通常是填了基础页而非 Messages 路由"
          : "API 请求失败";
      throw new Error(
        `${e.provider === "claude" ? "Claude" : e.provider === "minimax-anthropic" ? "MiniMax Anthropic" : "Anthropic 兼容端点"} API 错误 ${m.status}：${hint}。实际请求：${y}。${(m.text || "").slice(0, 160)}`,
      );
    }
    let v = m.json;
    return Array.isArray(v == null ? void 0 : v.content)
      ? v.content.map((P) => (P && P.type === "text" ? P.text || "" : "")).filter(Boolean).join("\n")
      : "";
  }
  let s =
    e.provider === "custom"
      ? (h = e.customEndpoint) != null
        ? h
        : ""
      : Ws[e.provider];
  if (!s.trim())
    throw new Error(
      "请填写 AI 模型的自定义端点",
    );
  if (!e.apiKey.trim())
    throw new Error(
      "请填写 AI 模型 API Key（或在主 AI 设置里配置 DeepSeek Key）",
    );
  let i = e.model || zs[e.provider];
  if (!i.trim())
    throw new Error("请填写 AI 模型型号");
  let r = await hn({
    url: s,
    method: "POST",
    throw: !1,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${e.apiKey.trim()}`,
    },
    body: JSON.stringify({
      model: i,
      temperature: 0.3,
      ...(e.provider === "minimax"
        ? { max_completion_tokens: Tk }
        : { max_tokens: Tk }),
      messages: [
        { role: "system", content: o },
        { role: "user", content: t },
      ],
    }),
  }, 0, f);
  if (r.status >= 400)
    throw new Error(
      `${e.provider}(${i}) API 错误 ${r.status}: ${(r.text || "").slice(0, 200)}`,
    );
  let n = r.json;
  let epChoice = n && n.choices ? n.choices[0] : void 0,
    epMsg = epChoice ? epChoice.message : void 0,
    epContent = epMsg && epMsg.content != null ? epMsg.content : "",
    epReasoning = epMsg && epMsg.reasoning_content != null ? epMsg.reasoning_content : "",
    epFinish = epChoice ? epChoice.finish_reason : void 0;
  if (!String(epContent).trim() && epFinish === "length") {
    if (String(epReasoning).trim())
      throw new Error(
        `${e.provider}(${i}) 的回复被 max_tokens 截断：全部 token 预算耗尽在思维链（reasoning）上，正文为空。这是推理型模型（如 DeepSeek 的 -reasoner/-pro 系列）常见问题——请调大 max_tokens，或在设置里换成非推理型号（如 deepseek-chat）。`,
      );
    throw new Error(
      `${e.provider}(${i}) 的回复在正文生成过程中被 max_tokens 截断，返回为空。请调大 max_tokens 后重试。`,
    );
  }
  return epContent;
}

var El = `你是一名科研文献助手。用户会给你一篇论文的标题、作者与摘要或正文。
请用中文输出结构化要点，帮助科研人员快速判断是否值得精读。
要求：直接给要点，不要寒暄；用简洁的 Markdown 列表。包含：
- **一句话结论**：核心发现
- **问题/动机**
- **方法/体系**
- **关键结果**（含关键数据/指标）
- **创新点与局限**（能判断时）
总长度控制在 300 字以内。`;

async function un(o, t, e) {
  let s = o.trim();
  if (!s) throw new Error("没有可总结的文本");
  return (
    await Sl(
      (e && e.trim()) || El,
      `请总结以下论文内容：

${s.slice(0, 12e3)}`,
      t,
    )
  ).trim();
}

var ScholariumDeepPrompt = `你是一名自旋电子器件相关的微电子领域研究生，目标是深入理解并总结论文。
请在阅读论文（用户提供的文本或摘要）后，围绕以下要点进行总结和分析：

首先，请用约1000—1500字对论文做一段整体性的深度分析，不要只做摘要式复述，而要结合论文中的关键细节、核心论点、重要数据、实验结果和图表信息，帮助我从整体上真正理解这篇论文在研究什么、为什么重要、它的核心贡献是什么，以及作者最终得出了什么结论。对于文中出现的关键术语、技术概念或方法名，请在首次出现时用中文进行清晰解释，并在必要时补充英文术语，尽量用通俗语言说明其含义和作用。

随后，请继续围绕以下几个方面展开系统分析：

第一，论文的研究目标是什么，它试图解决什么实际问题，这个问题为什么重要，在学术研究和产业发展中分别具有什么意义；
第二，论文提出了哪些新的思路、方法、模型或框架，这些方法相较于以往工作的主要区别、特点和优势是什么，请尽可能结合论文中的细节说明其设计动机与核心机制；
第三，论文通过哪些实验来验证方法的有效性，实验是如何设计的，使用了哪些数据集、评价指标和对比基线，消融实验、泛化实验或案例分析说明了什么，关键数据和结果又如何支持作者的结论；
第四，结合当前领域的发展现状，分析这篇论文的学术价值和潜在产业意义，并进一步讨论未来在这一方向上还有哪些值得继续探索的问题、挑战、技术机会或投资机会；
第五，从批判性角度分析这篇论文还存在哪些局限、不足或值得质疑的地方，例如方法假设是否过强、实验是否充分、结论是否存在外推风险，以及哪些内容仍需更多证据支持；
第六，从我的学习和应用角度出发，告诉我这篇论文最值得重点吸收的内容是什么，其中哪些思想、方法或分析框架可以直接迁移到研究、工作或项目实践中，同时指出如果我想真正吃透这篇论文，还需要补充哪些背景知识、前置理论或相关工作。

请将整个回答使用中文书写，并采用 Markdown 格式组织内容：
先给出一段“总体深度解读”，再分别用三级标题对应展开上述几个部分；
引用论文原文时请使用 blockquote 格式；关键术语在首次出现时加粗；
在有助于理解时可以适当加入表格，对方法差异、实验结果或优缺点进行总结。

整体写作风格请保持专业、严谨、有判断力，但不要故作艰深，尽量用清楚易懂的语言把“论文写了什么”和“这意味着什么”都讲明白，让我不仅能读懂这篇论文，还能从中提炼出真正可用的研究启发和实践价值。

注意：不要输出任何前言或寒暄，直接开始正文。不要用代码块包裹整篇回答。

最后，在全文结束后另起一行，追加且仅追加一个 yaml 代码块作为机器可读索引（这是整篇回答唯一允许出现的代码块）：

\`\`\`yaml
methods:
  - fsTAS
  - XPS
materials:
  - Au-BiVO4
topics:
  - charge-transfer
  - hot-electron
\`\`\`

上面只是格式示例，必须换成本文真实出现的内容，不要照抄示例值。
methods 写表征、实验或计算方法的英文规范名（缩写保持原样）；materials 写论文实际研究的材料、体系、分子或数据集；topics 写 3-6 个英文小写主题词，多词用连字符连接。
三个列表各最多 6 项，全部用英文，不要写泛词（materials-science、chemistry、research 这类一律不要）。抽不出的列表就留空。`;

async function scholariumDeepSummarize(o, t) {
  let e = String(o || "").trim();
  if (!e) throw new Error("没有可总结的文本");
  return (
    await Sl(
      ScholariumDeepPrompt,
      `请按上述要求，深入解读并总结以下论文全文：

${e.slice(0, 8e4)}`,
      { ...t, requestTimeout: Math.max(t.requestTimeout || 0, 6e5) },
      8e3,
    )
  ).trim();
}

export { Sl, un, scholariumDeepSummarize };
