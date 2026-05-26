import { fetchWithTimeout, safeParseJson } from './utils/network';

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
