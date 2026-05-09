import { requestUrl } from 'obsidian';

export interface MinerUResult {
    text: string;
    markdown: string;
    tables: string[];
}

interface AgentParseResponse {
    code: number;
    msg?: string;
    data?: {
        task_id?: string;
        file_url?: string;
        [key: string]: unknown;
    };
}

interface AgentTaskResponse {
    code: number;
    msg?: string;
    data?: {
        state?: string;
        err_msg?: string;
        full_zip_url?: string;
        markdown_url?: string;
        middle_json_url?: string;
        model_json_url?: string;
        content_list_url?: string;
        [key: string]: unknown;
    };
}

export async function extractTextWithMinerU(
    base64: string,
    mediaType: string,
    _apiKey = '',
    fileName?: string,
): Promise<MinerUResult> {
    const safeName = normalizeFileName(fileName, mediaType);
    const createTask = await requestJson<AgentParseResponse>({
        url: 'https://mineru.net/api/v1/agent/parse/file',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            file_name: safeName,
            language: 'ch_server',
            is_ocr: true,
            enable_table: true,
            enable_formula: true,
        }),
    }, '创建任务');

    if (createTask.code !== 0 || !createTask.data?.task_id || !createTask.data?.file_url) {
        throw new Error(`MinerU 创建识别任务失败：${createTask.msg ?? JSON.stringify(createTask)}`);
    }

    try {
        await requestUrl({
            url: createTask.data.file_url,
            method: 'PUT',
            body: base64ToArrayBuffer(base64),
        });
    } catch (err) {
        throw new Error(`MinerU 上传图片失败：${formatRequestError(err)}。这通常是签名上传 URL 被拒绝或已过期。`);
    }

    const taskId = createTask.data.task_id;
    const result = await pollMinerUTask(taskId);
    if (!result.data?.markdown_url) {
        throw new Error(`MinerU 未返回 Markdown 结果：${result.data?.err_msg ?? result.msg ?? 'unknown'}`);
    }

    let markdownResponse;
    try {
        markdownResponse = await requestUrl({
            url: result.data.markdown_url,
            method: 'GET',
        });
    } catch (err) {
        throw new Error(`MinerU 下载 Markdown 结果失败：${formatRequestError(err)}`);
    }
    const markdown = markdownResponse.text.trim();

    return {
        text: markdownToText(markdown),
        markdown,
        tables: extractMarkdownTables(markdown),
    };
}

async function pollMinerUTask(taskId: string): Promise<AgentTaskResponse> {
    const url = `https://mineru.net/api/v1/agent/parse/${encodeURIComponent(taskId)}`;
    for (let attempt = 0; attempt < 80; attempt++) {
        const result = await requestJson<AgentTaskResponse>({ url, method: 'GET' }, '查询任务');
        const state = String(result.data?.state ?? '').toLowerCase();
        if (result.code !== 0) {
            throw new Error(`MinerU 查询任务失败：${result.msg ?? JSON.stringify(result)}`);
        }
        if (state === 'done' || state === 'completed' || state === 'success') return result;
        if (state === 'failed' || state === 'error') {
            throw new Error(`MinerU 识别失败：${result.data?.err_msg ?? result.msg ?? 'unknown error'}`);
        }
        await sleep(2500);
    }
    throw new Error('MinerU 识别超时，请稍后重试或检查图片大小。');
}

async function requestJson<T>(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: string | ArrayBuffer;
}, stage = '请求'): Promise<T> {
    try {
        const response = await requestUrl(options);
        return response.json as T;
    } catch (err) {
        throw new Error(`MinerU ${stage}失败：${formatRequestError(err)}`);
    }
}

function formatRequestError(err: unknown): string {
    const message = (err as Error).message || String(err);
    if (/status\s+403/i.test(message)) {
        return '服务器返回 403 Forbidden，当前请求被 MinerU/OSS 拒绝';
    }
    if (/status\s+429/i.test(message)) {
        return '服务器返回 429，轻量接口触发 IP 限频，请稍后再试';
    }
    return message;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function normalizeFileName(fileName: string | undefined, mediaType: string): string {
    const extFromType: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/jpg': '.jpg',
        'image/webp': '.webp',
        'image/gif': '.gif',
        'image/bmp': '.bmp',
    };
    const ext = extFromType[mediaType.toLowerCase()] ?? '.png';
    const cleaned = (fileName || `image${ext}`)
        .replace(/[\\/:*?"<>|#^\[\]]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return /\.[a-z0-9]+$/i.test(cleaned) ? cleaned : `${cleaned}${ext}`;
}

function markdownToText(markdown: string): string {
    return markdown
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
        .replace(/!\[\[[^\]]+\]\]/g, '')
        .replace(/`{1,3}/g, '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\|/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractMarkdownTables(markdown: string): string[] {
    return markdown
        .split(/\n{2,}/)
        .map(block => block.trim())
        .filter(block => block.includes('|') && /^ *\|?.+\|.+$/m.test(block));
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}
