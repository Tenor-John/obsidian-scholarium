import { Modal, Notice, TFile } from 'obsidian';
import type ChemELNPlugin from './main';
import { PROVIDER_CONFIG, providerLabel } from './settings';
import { requestUrlWithTimeout } from './utils/network';

export interface ExperimentContext {
    filePath: string;
    title: string;
    date: string;
    createdAt: string;
    status: string;
    favorite: boolean;
    smiles: string;
    reaction_smiles: string;
    results: string;
    reagents: string[];
}

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
    role: ChatRole;
    content: string;
}

interface AiResponsePayload {
    reply: string;
    operations?: AiOperation[];
}

interface ParsedPayload {
    payload: AiResponsePayload;
    repaired: boolean;
}

type AiOperation =
    | {
        type: 'create_experiment';
        data?: Partial<AiExperimentData>;
    }
    | {
        type: 'update_experiment';
        target?: 'selected' | 'path';
        path?: string;
        updates?: Partial<AiExperimentData>;
    };

interface AiExperimentData {
    title: string;
    date: string;
    createdAt: string;
    status: 'planned' | 'in-progress' | 'completed' | 'failed';
    favorite: boolean;
    smiles: string;
    reaction_smiles: string;
    reagents: string[];
    results: string;
    objective: string;
    procedure: string;
    observations: string;
    nextSteps: string;
    tags: string[];
}

const STATUS_WHITELIST = new Set(['planned', 'in-progress', 'completed', 'failed']);

export class AIAssistantModal extends Modal {
    private readonly plugin: ChemELNPlugin;
    private readonly context?: ExperimentContext;
    private readonly messages: ChatMessage[] = [];

    private messagesEl!: HTMLElement;
    private inputEl!: HTMLTextAreaElement;
    private sendBtn!: HTMLButtonElement;

    constructor(plugin: ChemELNPlugin, context?: ExperimentContext) {
        super(plugin.app);
        this.plugin = plugin;
        this.context = context;
    }

    onOpen() {
        this.modalEl.addClass('scholarium-chat-modal-wrap');
        this.plugin.applyThemeAttributes(this.modalEl);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('scholarium-chat-modal');

        contentEl.createEl('h3', { text: 'AI 实验助理', cls: 'chat-title' });
        const subtitle = this.context
            ? `当前上下文：${this.context.title}（可直接让 AI 修改该实验）`
            : '你可以让 AI 自动生成实验记录，或按自然语言修改已有记录。';
        contentEl.createEl('p', { text: subtitle, cls: 'chat-subtitle' });

        const providerText = `${providerLabel(this.plugin.settings.aiProvider)} · ${this.plugin.settings.aiModel}`;
        const apiBar = contentEl.createDiv({ cls: 'chat-api-bar' });
        if (this.plugin.settings.aiApiKey.trim()) {
            apiBar.createEl('span', { text: `已连接：${providerText}`, cls: 'chat-api-ok' });
        } else {
            apiBar.createEl('span', { text: '未配置 API Key，请先到插件设置填写', cls: 'chat-api-warn' });
        }

        this.messagesEl = contentEl.createDiv({ cls: 'chat-messages' });

        this.pushMessage('assistant', '你好，我可以帮你：\n1. 自动生成实验记录\n2. 修改当前实验的标题、状态、试剂、结果、SMILES 等字段\n3. 批量给出实验步骤草案和注意事项');

        if (this.context) {
            this.pushMessage('assistant', `已选中实验：${this.context.title}\n你可以说："把状态改为 completed，并补充结果产率 87%"`);
        }

        const inputWrap = contentEl.createDiv({ cls: 'chat-input-wrap' });
        this.inputEl = inputWrap.createEl('textarea', {
            cls: 'chat-input',
            placeholder: '例如：请创建一个 Suzuki 偶联实验记录，给出试剂、步骤和结果模板。'
        });

        const row = inputWrap.createDiv({ cls: 'chat-btn-row' });
        const closeBtn = row.createEl('button', { text: '关闭', cls: 'scholarium-btn' });
        closeBtn.onclick = () => this.close();

        this.sendBtn = row.createEl('button', { text: '发送并执行', cls: 'scholarium-btn primary' });
        this.sendBtn.onclick = () => {
            void this.handleSend();
        };

        this.inputEl.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void this.handleSend();
            }
        });
    }

    private pushMessage(role: ChatRole, content: string) {
        this.messages.push({ role, content });
        const msg = this.messagesEl.createDiv({ cls: `chat-msg chat-${role}` });
        msg.createDiv({ text: content, cls: 'chat-bubble' });
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    private setSendingState(sending: boolean) {
        this.sendBtn.disabled = sending;
        this.inputEl.disabled = sending;
        this.sendBtn.setText(sending ? '处理中...' : '发送并执行');
    }

    private async handleSend() {
        const input = this.inputEl.value.trim();
        if (!input) {
            return;
        }
        if (!this.plugin.settings.aiApiKey.trim()) {
            new Notice('请先在设置中填写 AI API Key。');
            return;
        }

        this.inputEl.value = '';
        this.pushMessage('user', input);
        this.setSendingState(true);

        try {
            const payload = await this.askModelAndParse(input);
            this.pushMessage('assistant', payload.reply || '已处理。');
            const applySummary = await this.applyOperations(payload.operations ?? []);
            if (applySummary) {
                this.pushMessage('assistant', applySummary);
            }
            this.plugin.refreshDashboards();
        } catch (error) {
            console.error(error);
            const message = error instanceof Error ? error.message : 'AI 调用失败';
            this.pushMessage('assistant', `执行失败：${message}`);
        } finally {
            this.setSendingState(false);
            this.inputEl.focus();
        }
    }

    private buildSystemPrompt(): string {
        return [
            '你是化学电子实验记录助手。',
            '你必须输出严格 JSON，不要输出 Markdown。',
            'JSON 结构：{"reply": string, "operations": AiOperation[] }。',
            'AiOperation 仅允许两种：',
            '1) {"type":"create_experiment","data":{...}}',
            '2) {"type":"update_experiment","target":"selected"|"path","path":"可选","updates":{...}}',
            '可更新字段：title,date,status,smiles,reaction_smiles,reagents,results,favorite,tags,objective,procedure,observations,nextSteps。',
            'status 只能是 planned/in-progress/completed/failed。',
            'reagents/tags 必须是字符串数组。',
            '如果用户只聊天不修改数据，operations 返回空数组。',
            '如果用户要求修改“当前实验”，请使用 target=selected。',
            '当需要改正文时，使用 updates.objective/procedure/observations/nextSteps。',
            '不要返回任何未定义字段，不要在 JSON 中写注释。',
        ].join('\n');
    }

    private buildUserPrompt(userInput: string): string {
        const contextText = this.context
            ? JSON.stringify(this.context, null, 2)
            : 'null';

        return [
            `用户输入：${userInput}`,
            '当前选中实验（可能为空）：',
            contextText,
            `当前时间：${new Date().toISOString()}`,
        ].join('\n\n');
    }

    private async askModelAndParse(userInput: string): Promise<AiResponsePayload> {
        const history = this.messages.slice(-8);
        const systemPrompt = this.buildSystemPrompt();
        const userPrompt = this.buildUserPrompt(userInput);
        const provider = this.plugin.settings.aiProvider;
        // claude uses Anthropic protocol; all others use OpenAI-compatible format
        const protocol: 'openai' | 'anthropic' = provider === 'claude' ? 'anthropic' : 'openai';
        const apiKey = this.plugin.settings.aiApiKey.trim();
        const model = this.plugin.settings.aiModel.trim();
        const baseUrl = this.plugin.settings.aiCustomEndpoint.trim() || PROVIDER_CONFIG[provider].baseUrl;

        let rawText = '';
        if (protocol === 'openai') {
            rawText = await this.callOpenAICompatible(baseUrl, apiKey, model, systemPrompt, history, userPrompt);
        } else if (protocol === 'anthropic') {
            rawText = await this.callAnthropic(baseUrl, apiKey, model, systemPrompt, history, userPrompt);
        } else {
            rawText = await this.callGemini(baseUrl, apiKey, model, systemPrompt, history, userPrompt);
        }

        const parsed = await this.parsePayloadWithRepair(rawText, userInput, protocol, baseUrl, apiKey, model, systemPrompt, history);
        if (parsed.repaired) {
            parsed.payload.reply = `${parsed.payload.reply}\n\n（已自动修复一次结构化输出格式）`;
        }
        return parsed.payload;
    }

    private async callOpenAICompatible(
        baseUrl: string,
        apiKey: string,
        model: string,
        systemPrompt: string,
        history: ChatMessage[],
        userPrompt: string
    ): Promise<string> {
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map((msg) => ({ role: msg.role, content: msg.content })),
            { role: 'user', content: userPrompt },
        ];

        const response = await requestUrlWithTimeout({
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: this.plugin.settings.aiTemperature ?? 0.7,
                response_format: { type: 'json_object' },
            }),
        });

        const choice = response.json?.choices?.[0]?.message?.content;
        if (typeof choice !== 'string') {
            throw new Error('模型没有返回可解析文本。');
        }
        return choice;
    }

    private async callAnthropic(
        baseUrl: string,
        apiKey: string,
        model: string,
        systemPrompt: string,
        history: ChatMessage[],
        userPrompt: string
    ): Promise<string> {
        const url = `${baseUrl.replace(/\/$/, '')}/messages`;
        const messages = [
            ...history.map((msg) => ({
                role: msg.role,
                content: [{ type: 'text', text: msg.content }],
            })),
            {
                role: 'user',
                content: [{ type: 'text', text: userPrompt }],
            },
        ];

        const response = await requestUrlWithTimeout({
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model,
                max_tokens: 2000,
                temperature: this.plugin.settings.aiTemperature ?? 0.7,
                system: systemPrompt,
                messages,
            }),
        });

        const text = response.json?.content?.find((part: { type?: string }) => part.type === 'text')?.text;
        if (typeof text !== 'string') {
            throw new Error('Claude 返回格式异常。');
        }
        return text;
    }

    private async callGemini(
        baseUrl: string,
        apiKey: string,
        model: string,
        systemPrompt: string,
        history: ChatMessage[],
        userPrompt: string
    ): Promise<string> {
        const url = `${baseUrl.replace(/\/$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const contents = [
            ...history.map((msg) => ({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }],
            })),
            { role: 'user', parts: [{ text: userPrompt }] },
        ];

        const response = await requestUrlWithTimeout({
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                generationConfig: {
                    temperature: this.plugin.settings.aiTemperature ?? 0.7,
                    responseMimeType: 'application/json',
                },
                contents,
            }),
        });

        const parts = response.json?.candidates?.[0]?.content?.parts;
        const text = Array.isArray(parts)
            ? parts.map((part: { text?: string }) => part.text ?? '').join('\n').trim()
            : '';
        if (!text) {
            throw new Error('Gemini 返回格式异常。');
        }
        return text;
    }

    private extractJson(raw: string): string {
        const trimmed = raw.trim();
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            return trimmed;
        }
        const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) {
            return fenced[1].trim();
        }
        const first = trimmed.indexOf('{');
        const last = trimmed.lastIndexOf('}');
        if (first >= 0 && last > first) {
            return trimmed.slice(first, last + 1);
        }
        throw new Error('模型未返回 JSON。');
    }

    private normalizePayload(payload: AiResponsePayload): AiResponsePayload {
        const normalized: AiResponsePayload = {
            reply: typeof payload.reply === 'string' && payload.reply.trim() ? payload.reply.trim() : '已完成请求。',
            operations: [],
        };

        if (!Array.isArray(payload.operations)) {
            return normalized;
        }

        const operations: AiOperation[] = [];
        for (const operation of payload.operations) {
            if (!operation || typeof operation !== 'object' || !('type' in operation)) {
                continue;
            }

            if (operation.type === 'create_experiment') {
                operations.push({
                    type: 'create_experiment',
                    data: operation.data,
                });
                continue;
            }

            if (operation.type === 'update_experiment') {
                operations.push({
                    type: 'update_experiment',
                    target: operation.target,
                    path: operation.path,
                    updates: operation.updates,
                });
            }
        }

        normalized.operations = operations;
        return normalized;
    }

    private async parsePayloadWithRepair(
        rawText: string,
        userInput: string,
        protocol: 'openai' | 'anthropic' | 'gemini',
        baseUrl: string,
        apiKey: string,
        model: string,
        systemPrompt: string,
        history: ChatMessage[]
    ): Promise<ParsedPayload> {
        const firstTry = this.tryParsePayload(rawText);
        if (firstTry) {
            return { payload: firstTry, repaired: false };
        }

        const repairPrompt = [
            '请将下面文本严格转换为合法 JSON。',
            '必须输出格式：{"reply": string, "operations": []}。',
            '不得输出任何解释、代码块或额外字段。',
            `原始文本：${rawText}`,
            `用户原始意图：${userInput}`,
        ].join('\n\n');

        let repairedRaw = '';
        if (protocol === 'openai') {
            repairedRaw = await this.callOpenAICompatible(baseUrl, apiKey, model, systemPrompt, history, repairPrompt);
        } else if (protocol === 'anthropic') {
            repairedRaw = await this.callAnthropic(baseUrl, apiKey, model, systemPrompt, history, repairPrompt);
        } else {
            repairedRaw = await this.callGemini(baseUrl, apiKey, model, systemPrompt, history, repairPrompt);
        }

        const repaired = this.tryParsePayload(repairedRaw);
        if (repaired) {
            return { payload: repaired, repaired: true };
        }

        throw new Error('AI 返回格式不稳定，无法解析为结构化指令。');
    }

    private tryParsePayload(raw: string): AiResponsePayload | null {
        try {
            const normalized = this.extractJson(raw);
            const parsed = JSON.parse(normalized) as AiResponsePayload;
            return this.normalizePayload(parsed);
        } catch (error) {
            console.warn('[Scholarium] Unable to parse AI assistant payload:', error);
            return null;
        }
    }

    private async applyOperations(operations: AiOperation[]): Promise<string> {
        if (operations.length === 0) {
            return '';
        }

        let created = 0;
        let updated = 0;
        let sectionPatched = 0;

        for (const operation of operations) {
            if (operation.type === 'create_experiment') {
                await this.createExperimentFromAi(operation.data ?? {});
                created += 1;
            }
            if (operation.type === 'update_experiment') {
                const result = await this.updateExperimentFromAi(operation);
                if (result.updatedFrontmatter) {
                    updated += 1;
                }
                if (result.updatedSections) {
                    sectionPatched += 1;
                }
            }
        }

        const pieces: string[] = [];
        if (created > 0) {
            pieces.push(`已创建 ${created} 条实验记录`);
        }
        if (updated > 0) {
            pieces.push(`已更新 ${updated} 条实验记录`);
        }
        if (sectionPatched > 0) {
            pieces.push(`已改写 ${sectionPatched} 条正文分节`);
        }
        return pieces.join('，');
    }

    private normalizeData(input: Partial<AiExperimentData>): AiExperimentData {
        const now = new Date();
        const today = now.toISOString().split('T')[0] ?? now.toISOString().slice(0, 10);
        const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
            ? input.date
            : today;
        const status = typeof input.status === 'string' && STATUS_WHITELIST.has(input.status)
            ? input.status
            : 'in-progress';

        const asString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
        const asStringArray = (value: unknown): string[] => Array.isArray(value)
            ? value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
            : [];

        return {
            title: asString(input.title) || `AI实验_${date}`,
            date,
            createdAt: asString(input.createdAt) || now.toISOString(),
            status: status as AiExperimentData['status'],
            favorite: Boolean(input.favorite),
            smiles: asString(input.smiles),
            reaction_smiles: asString(input.reaction_smiles),
            reagents: asStringArray(input.reagents),
            results: asString(input.results),
            objective: asString(input.objective),
            procedure: asString(input.procedure),
            observations: asString(input.observations),
            nextSteps: asString(input.nextSteps),
            tags: asStringArray(input.tags),
        };
    }

    private async createExperimentFromAi(input: Partial<AiExperimentData>) {
        const data = this.normalizeData(input);
        const folder = this.plugin.settings.experimentsFolder;
        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }

        const date = data.date;
        const now = new Date();
        const stamp = `${date}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const baseName = `实验记录_AI_${stamp}`;
        let fileName = `${folder ? `${folder}/` : ''}${baseName}.md`;
        let suffix = 2;
        while (this.app.vault.getAbstractFileByPath(fileName)) {
            fileName = `${folder ? `${folder}/` : ''}${baseName}-${suffix}.md`;
            suffix += 1;
        }

        const tags = data.tags.length > 0 ? data.tags : ['experiment', 'ai-generated'];
        const template = `---
type: experiment
title: ${data.title}
date: ${data.date}
createdAt: ${data.createdAt}
favorite: ${data.favorite}
status: ${data.status}
smiles: "${data.smiles}"
reaction_smiles: "${data.reaction_smiles}"
reagents:
${data.reagents.length > 0 ? data.reagents.map((r) => `  - ${r}`).join('\n') : '  - 待补充'}
results: "${data.results}"
tags: [${tags.join(', ')}]
---

# ${data.title}

## 实验目的
${data.objective || '（由 AI 生成，可按需修改）'}

## 实验步骤
${data.procedure || '1. 在此补充实验步骤\n2. 在此补充关键参数'}

## 观察与现象
${data.observations || '（记录颜色变化、沉淀、温度等）'}

## 实验结果
${data.results || '（在此填写产率、纯度、谱图编号等）'}

## 下一步计划
${data.nextSteps || '（在此填写后续优化方向）'}
`;

        const file = await this.app.vault.create(fileName, template);
        await this.app.workspace.getLeaf(false).openFile(file);
    }

    private async updateExperimentFromAi(operation: Extract<AiOperation, { type: 'update_experiment' }>): Promise<{ updatedFrontmatter: boolean; updatedSections: boolean }> {
        let targetFile: TFile | null = null;

        if (operation.target === 'selected' && this.context) {
            const found = this.app.vault.getAbstractFileByPath(this.context.filePath);
            if (found instanceof TFile) {
                targetFile = found;
            }
        }

        if (!targetFile && operation.target === 'path' && operation.path) {
            const found = this.app.vault.getAbstractFileByPath(operation.path);
            if (found instanceof TFile) {
                targetFile = found;
            }
        }

        if (!targetFile) {
            return { updatedFrontmatter: false, updatedSections: false };
        }

        const updates = this.normalizeData(operation.updates ?? {});
        const shouldUpdateFrontmatter = Boolean(
            operation.updates?.title
            || operation.updates?.date
            || typeof operation.updates?.favorite !== 'undefined'
            || operation.updates?.status
            || operation.updates?.smiles
            || operation.updates?.reaction_smiles
            || operation.updates?.results
            || operation.updates?.reagents
            || operation.updates?.tags
            || operation.updates?.createdAt
        );

        const shouldUpdateSections = Boolean(
            operation.updates?.objective
            || operation.updates?.procedure
            || operation.updates?.observations
            || operation.updates?.nextSteps
            || operation.updates?.results
        );

        if (shouldUpdateFrontmatter) {
        await this.app.fileManager.processFrontMatter(targetFile, (fm) => {
            fm.type = 'experiment';
            if (operation.updates?.title) fm.title = updates.title;
            if (operation.updates?.date) fm.date = updates.date;
            if (operation.updates?.createdAt) fm.createdAt = updates.createdAt;
            if (typeof operation.updates?.favorite !== 'undefined') fm.favorite = updates.favorite;
            if (operation.updates?.status) fm.status = updates.status;
            if (operation.updates?.smiles) fm.smiles = updates.smiles;
            if (operation.updates?.reaction_smiles) fm.reaction_smiles = updates.reaction_smiles;
            if (operation.updates?.results) fm.results = updates.results;
            if (operation.updates?.reagents) fm.reagents = updates.reagents;
            if (operation.updates?.tags) fm.tags = updates.tags;
        });
        }

        let updatedSections = false;
        if (shouldUpdateSections) {
            const oldContent = await this.app.vault.read(targetFile);
            let newContent = oldContent;
            if (operation.updates?.objective) {
                newContent = this.upsertSection(newContent, '实验目的', updates.objective);
            }
            if (operation.updates?.procedure) {
                newContent = this.upsertSection(newContent, '实验步骤', updates.procedure);
            }
            if (operation.updates?.observations) {
                newContent = this.upsertSection(newContent, '观察与现象', updates.observations);
            }
            if (operation.updates?.results) {
                newContent = this.upsertSection(newContent, '实验结果', updates.results);
            }
            if (operation.updates?.nextSteps) {
                newContent = this.upsertSection(newContent, '下一步计划', updates.nextSteps);
            }
            if (newContent !== oldContent) {
                await this.app.vault.modify(targetFile, newContent);
                updatedSections = true;
            }
        }

        return { updatedFrontmatter: shouldUpdateFrontmatter, updatedSections };
    }

    private upsertSection(content: string, heading: string, sectionBody: string): string {
        const body = sectionBody.trim();
        if (!body) {
            return content;
        }

        const headingPattern = new RegExp(`(^##\\s+${this.escapeRegExp(heading)}\\s*$)`, 'm');
        const match = headingPattern.exec(content);
        if (!match || typeof match.index !== 'number') {
            const suffix = content.endsWith('\n') ? '' : '\n';
            return `${content}${suffix}\n## ${heading}\n${body}\n`;
        }

        const start = match.index;
        const fromHeading = content.slice(start);
        const nextHeadingMatch = /^##\s+.+$/m.exec(fromHeading.slice(match[0].length));

        const sectionStart = start;
        const sectionBodyStart = start + match[0].length;
        const sectionEnd = nextHeadingMatch && typeof nextHeadingMatch.index === 'number'
            ? sectionBodyStart + nextHeadingMatch.index
            : content.length;

        const before = content.slice(0, sectionStart);
        const after = content.slice(sectionEnd).replace(/^\s*/, '\n');
        return `${before}## ${heading}\n${body}\n${after}`;
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}
