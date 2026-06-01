import { fetchWithTimeout, requestUrlWithTimeout, safeParseJson } from './utils/network';

export type WritingProvider = 'deepseek' | 'claude' | 'openai' | 'gemini' | 'custom';

export interface WriterSettings {
    provider: WritingProvider;
    apiKey: string;
    model?: string;
    customEndpoint?: string;
}

export interface VisionAgentAction {
    type: 'create_experiment' | 'update_experiment';
    target?: 'current' | 'path' | 'title' | 'latest';
    path?: string;
    title?: string;
    mode?: 'merge' | 'replace';
    data: Record<string, unknown>;
}

const DEFAULT_MODELS: Record<WritingProvider, string> = {
    deepseek: 'deepseek-chat',
    claude: 'claude-opus-4-5',
    openai: 'gpt-4.1',
    gemini: 'gemini-2.5-pro',
    custom: '',
};

const ENDPOINTS: Record<WritingProvider, string> = {
    deepseek: 'https://api.deepseek.com/chat/completions',
    claude: 'https://api.anthropic.com/v1/messages',
    openai: 'https://api.openai.com/v1/chat/completions',
    gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    custom: '',
};

const SYSTEM_PROMPT = `你是一个化学实验记录整理助手。
用户会发送一段从手写记录图片中提取的 OCR 文本，可能包含噪声、错别字、断行、表格或公式。
你需要理解真实实验含义，以符合人类逻辑的方式重新整理，输出标准实验记录动作。

严格要求：只输出纯 JSON，不加 markdown 代码块或说明文字。

输出格式：
{
  "type": "create_experiment",
  "data": {
    "title": "实验标题，不能为空，识别不到则根据内容推断",
    "date": "YYYY-MM-DD 或 null",
    "status": "in-progress",
    "catalyst": "催化剂体系或 null",
    "objective": "实验目的，用完整句子重新表述，不要照抄 OCR 原文",
    "reagents": ["试剂A", "试剂B"],
    "steps": ["步骤1，逻辑顺序，语句通顺", "步骤2"],
    "observations": "现象记录",
    "results": "数据/结果摘要",
    "issues": "问题与异常，无则为 null",
    "reaction_smiles": "SMILES 字符串或 null",
    "tags": ["photocatalysis"]
  }
}`;

async function callOpenAIStyle(
    ocrText: string,
    settings: WriterSettings,
    endpoint: string,
): Promise<string> {
    if (!endpoint.trim()) throw new Error('请填写 AI 重写模型的自定义端点');
    if (!settings.apiKey.trim()) throw new Error('请填写 AI 重写模型 API Key，或复用主 AI Key');

    const model = settings.model || DEFAULT_MODELS[settings.provider];
    if (!model.trim()) throw new Error('请填写 AI 重写模型型号');

    const response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${settings.apiKey.trim()}`,
        },
        body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 2000,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: `以下是从手写实验记录图片中提取的 OCR 文本，请整理为实验记录：\n\n${ocrText}`,
                },
            ],
        }),
    });

    if (!response.ok) {
        throw new Error(`${settings.provider} API 错误 ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
}

async function callClaude(ocrText: string, settings: WriterSettings): Promise<string> {
    if (!settings.apiKey.trim()) throw new Error('请填写 Claude API Key');

    const response = await fetchWithTimeout(ENDPOINTS.claude, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.apiKey.trim(),
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: settings.model || DEFAULT_MODELS.claude,
            max_tokens: 2000,
            system: SYSTEM_PROMPT,
            messages: [{
                role: 'user',
                content: `以下是从手写实验记录图片中提取的 OCR 文本，请整理为实验记录：\n\n${ocrText}`,
            }],
        }),
    });

    if (!response.ok) {
        throw new Error(`Claude API 错误 ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as { content?: Array<{ text?: string }> };
    return data.content?.[0]?.text ?? '';
}

// ───────────────────────────────────────────────
// 通用文献总结（复用同一套 provider 配置）
// ───────────────────────────────────────────────
const SUMMARY_SYSTEM = `你是一名科研文献助手。用户会给你一篇论文的标题、作者与摘要或正文。
请用中文输出结构化要点，帮助科研人员快速判断是否值得精读。
要求：直接给要点，不要寒暄；用简洁的 Markdown 列表。包含：
- **一句话结论**：核心发现
- **问题/动机**
- **方法/体系**
- **关键结果**（含关键数据/指标）
- **创新点与局限**（能判断时）
总长度控制在 300 字以内。`;

// 带重试的 requestUrl（应对 ERR_CONNECTION_RESET 等瞬时网络错误）
async function postWithRetry(req: Parameters<typeof requestUrlWithTimeout>[0], retries = 2): Promise<Awaited<ReturnType<typeof requestUrlWithTimeout>>> {
    let lastErr: unknown;
    for (let i = 0; i <= retries; i++) {
        try {
            return await requestUrlWithTimeout(req);
        } catch (e) {
            lastErr = e;
            const msg = String((e as Error)?.message || e);
            // 仅对网络层错误重试
            if (!/RESET|ECONNRESET|ETIMEDOUT|network|timed out|ENOTFOUND|EAI_AGAIN/i.test(msg)) throw e;
            await new Promise(r => setTimeout(r, 800 * (i + 1)));
        }
    }
    throw lastErr;
}

// 用 Obsidian requestUrl（绕过浏览器 CORS）
async function chatComplete(systemPrompt: string, userContent: string, settings: WriterSettings): Promise<string> {
    if (settings.provider === 'claude') {
        if (!settings.apiKey.trim()) throw new Error('请填写 Claude API Key');
        const res = await postWithRetry({
            url: ENDPOINTS.claude,
            method: 'POST',
            throw: false,
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': settings.apiKey.trim(),
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: settings.model || DEFAULT_MODELS.claude,
                max_tokens: 1200,
                system: systemPrompt,
                messages: [{ role: 'user', content: userContent }],
            }),
        });
        if (res.status >= 400) throw new Error(`Claude API 错误 ${res.status}: ${(res.text || '').slice(0, 200)}`);
        const data = res.json as { content?: Array<{ text?: string }> } | undefined;
        return data?.content?.[0]?.text ?? '';
    }

    const endpoint = settings.provider === 'custom' ? (settings.customEndpoint ?? '') : ENDPOINTS[settings.provider];
    if (!endpoint.trim()) throw new Error('请填写 AI 模型的自定义端点');
    if (!settings.apiKey.trim()) throw new Error('请填写 AI 模型 API Key（或在主 AI 设置里配置 DeepSeek Key）');
    const model = settings.model || DEFAULT_MODELS[settings.provider];
    if (!model.trim()) throw new Error('请填写 AI 模型型号');
    const res = await postWithRetry({
        url: endpoint,
        method: 'POST',
        throw: false,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey.trim()}` },
        body: JSON.stringify({
            model,
            temperature: 0.3,
            max_tokens: 1200,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent },
            ],
        }),
    });
    if (res.status >= 400) throw new Error(`${settings.provider}(${model}) API 错误 ${res.status}: ${(res.text || '').slice(0, 200)}`);
    const data = res.json as { choices?: Array<{ message?: { content?: string } }> } | undefined;
    return data?.choices?.[0]?.message?.content ?? '';
}

export async function summarizeArticle(text: string, settings: WriterSettings, systemPrompt?: string): Promise<string> {
    const input = text.trim();
    if (!input) throw new Error('没有可总结的文本');
    const out = await chatComplete((systemPrompt && systemPrompt.trim()) || SUMMARY_SYSTEM, `请总结以下论文内容：\n\n${input.slice(0, 12000)}`, settings);
    return out.trim();
}

export async function rewriteOcrToAgent(
    ocrResult: { text: string; markdown: string },
    settings: WriterSettings,
): Promise<VisionAgentAction> {
    const input = (ocrResult.markdown || ocrResult.text || '').trim();
    if (!input) throw new Error('MinerU 未提取到可用文字');

    let rawText: string;
    if (settings.provider === 'claude') {
        rawText = await callClaude(input, settings);
    } else {
        const endpoint = settings.provider === 'custom'
            ? (settings.customEndpoint ?? '')
            : ENDPOINTS[settings.provider];
        rawText = await callOpenAIStyle(input, settings, endpoint);
    }

    const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    try {
        const parsed = safeParseJson<VisionAgentAction>(cleaned, 'vision writer output');
        if (!parsed) throw new Error('invalid JSON');
        if (!parsed.type || !parsed.data) throw new Error('missing type/data');
        return parsed;
    } catch {
        console.error('[VisionWriter] JSON parse failed:', rawText);
        throw new Error(`模型输出无法解析：${cleaned.slice(0, 120)}`);
    }
}
