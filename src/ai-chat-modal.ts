import { App, Modal, Notice, FuzzySuggestModal, TFile } from 'obsidian';
import ChemELNPlugin from './main';
import { PROVIDER_CONFIG, DEFAULT_AI_SYSTEM_PROMPT } from './settings';

interface Message { role: 'user' | 'assistant'; content: string; }

interface ExperimentData {
    title?:      string;
    date?:       string;
    status?:     string;
    smiles?:     string;
    reagents?:   string[];
    results?:    string;
    steps?:      string;
    notes?:      string;
    references?: string;
    // 任意章节 key → 内容（从 [SECTION] 块解析而来）
    sections?:   Record<string, string>;
}

// ──────────────────────────────────────────────
// 实验文件选择器（模糊搜索已有实验）
// ──────────────────────────────────────────────
class ExperimentPickerModal extends FuzzySuggestModal<TFile> {
    private expFiles: TFile[];
    private onPick: (file: TFile) => void;
    constructor(app: App, files: TFile[], onPick: (file: TFile) => void) {
        super(app);
        this.expFiles = files;
        this.onPick   = onPick;
        this.setPlaceholder('输入关键词搜索实验记录…');
        this.setInstructions([
            { command: '↑↓', purpose: '选择' },
            { command: '↵',  purpose: '补充到此记录' },
            { command: 'esc', purpose: '取消' },
        ]);
    }
    getItems(): TFile[] { return this.expFiles; }
    getItemText(file: TFile): string {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return `${fm?.title ?? file.basename}  ${fm?.date ?? ''}  [${fm?.status ?? ''}]`;
    }
    onChooseItem(file: TFile): void { this.onPick(file); }
}

// ──────────────────────────────────────────────
// AI 聊天弹窗
// ──────────────────────────────────────────────
export class AIChatModal extends Modal {
    plugin:       ChemELNPlugin;
    messages:     Message[] = [];
    chatContainer!: HTMLElement;
    inputEl!:     HTMLTextAreaElement;
    sendBtn!:     HTMLButtonElement;
    isLoading  =  false;

    private targetFile:  TFile | null;
    private noteContent: string;

    constructor(app: App, plugin: ChemELNPlugin, targetFile?: TFile, noteContent?: string) {
        super(app);
        this.plugin      = plugin;
        this.targetFile  = targetFile ?? null;
        this.noteContent = noteContent ?? '';
        this.modalEl.addClass('scholarium-chat-modal-wrap');
    }

    get isEditMode() { return this.targetFile !== null; }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('scholarium-chat-modal');

        if (this.isEditMode) {
            contentEl.createEl('h2', { text: '🤖 AI 修改笔记', cls: 'chat-title' });
            const fm = this.app.metadataCache.getFileCache(this.targetFile!)?.frontmatter;
            contentEl.createEl('p', {
                text: `正在修改：${(fm?.title as string | undefined) ?? this.targetFile!.basename}`,
                cls: 'chat-subtitle chat-subtitle-edit'
            });
        } else {
            contentEl.createEl('h2', { text: '🤖 AI 实验助手', cls: 'chat-title' });
            contentEl.createEl('p', {
                text: '用自然语言描述你的实验，AI 帮你整理成规范记录。',
                cls: 'chat-subtitle'
            });
        }

        // API 状态栏
        const apiBar = contentEl.createDiv({ cls: 'chat-api-bar' });
        if (this.plugin.settings.aiApiKey) {
            const cfg = PROVIDER_CONFIG[this.plugin.settings.aiProvider];
            apiBar.createEl('span', { text: `✅ ${cfg.label} · ${this.plugin.settings.aiModel}`, cls: 'chat-api-ok' });
        } else {
            apiBar.createEl('span', { text: '⚠️ 未配置 API Key，请先去设置中填写', cls: 'chat-api-warn' });
            apiBar.createEl('button', { text: '去设置', cls: 'scholarium-btn' })
                .onclick = () => { this.close(); (this.app as unknown as { setting: { open(): void } }).setting.open(); };
        }

        this.chatContainer = contentEl.createDiv({ cls: 'chat-messages' });

        if (this.isEditMode) {
            this.appendMessage('assistant',
                '我已加载该实验的完整笔记内容。\n\n' +
                '你可以告诉我：\n' +
                '**"整理实验步骤"** — 重新排列步骤格式\n' +
                '**"把这些文献加到笔记里"**（粘贴引用）— 自动创建参考文献章节\n' +
                '**"补充实验结果"** — 更新结果字段和正文\n' +
                '**"帮我重新整理整个笔记"** — 规范化所有章节'
            );
        } else {
            this.appendMessage('assistant',
                '你好！我是你的化学实验助手 🧪\n\n' +
                '描述实验内容，我会整理成规范记录：\n' +
                '• **创建新实验记录** — 生成一条全新的笔记\n' +
                '• **补充到现有记录** — 追加到已有实验，不删除原内容'
            );
        }

        const inputWrap = contentEl.createDiv({ cls: 'chat-input-wrap' });
        this.inputEl = inputWrap.createEl('textarea', {
            cls: 'chat-input',
            attr: {
                placeholder: this.isEditMode
                    ? '例如：把下面这些文献加到笔记里，然后整理一下实验步骤…'
                    : '描述你的实验内容… (Ctrl+Enter 发送)',
                rows: '5'
            }
        });
        this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.sendMessage(); }
        });

        const btnRow = inputWrap.createDiv({ cls: 'chat-btn-row' });
        btnRow.createEl('button', { text: '清空对话', cls: 'scholarium-btn' })
            .onclick = () => { this.messages = []; this.chatContainer.empty(); };
        this.sendBtn = btnRow.createEl('button', { text: '发送 ↵', cls: 'scholarium-btn primary' });
        this.sendBtn.onclick = () => this.sendMessage();

        setTimeout(() => this.inputEl.focus(), 100);
    }

    // ───── 消息渲染 ─────
    appendMessage(role: 'user' | 'assistant', content: string, data?: ExperimentData) {
        const msgEl = this.chatContainer.createDiv({ cls: `chat-msg chat-${role}` });
        const bubble = msgEl.createDiv({ cls: 'chat-bubble' });

        if (role === 'assistant') {
            bubble.innerHTML = content
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/\n/g, '<br>');

            const hasData = data && (
                data.title || data.results || data.steps || data.notes ||
                data.references || (data.sections && Object.keys(data.sections).length > 0)
            );
            if (hasData && data) {
                const actionEl = msgEl.createDiv({ cls: 'chat-action' });
                const preview  = actionEl.createDiv({ cls: 'exp-preview' });

                if (data.title)            preview.createEl('div', { text: `📌 ${data.title}`, cls: 'preview-title' });
                if (data.status)           preview.createEl('div', { text: `🔖 ${data.status}`, cls: 'preview-field' });
                if (data.results)          preview.createEl('div', { text: `📊 ${data.results.substring(0, 100)}`, cls: 'preview-field' });
                if (data.smiles)           preview.createEl('div', { text: `⚗️ ${data.smiles}`, cls: 'preview-field smiles' });
                if (data.reagents?.length) preview.createEl('div', { text: `🧪 ${data.reagents.join('、')}`, cls: 'preview-field' });
                if (data.steps)            preview.createEl('div', { text: `📝 步骤：${data.steps.substring(0, 100)}…`, cls: 'preview-field' });
                if (data.references)       preview.createEl('div', { text: `📚 参考文献（${data.references.split('\n').filter(Boolean).length} 条）`, cls: 'preview-field' });

                // 显示任意章节预览
                if (data.sections) {
                    for (const [name, body] of Object.entries(data.sections)) {
                        const lines = body.split('\n').filter(Boolean).length;
                        preview.createEl('div', { text: `📄 ${name}（${lines} 行）`, cls: 'preview-field' });
                    }
                }

                const btnGroup = actionEl.createDiv({ cls: 'chat-action-btns' });

                if (this.isEditMode) {
                    const applyBtn = btnGroup.createEl('button', { text: '✅ 应用到当前笔记', cls: 'scholarium-btn primary' });
                    applyBtn.onclick = () => this.applyToCurrentNote(data, applyBtn);
                } else {
                    const createBtn = btnGroup.createEl('button', { text: '📝 创建新实验记录', cls: 'scholarium-btn primary' });
                    createBtn.onclick = () => this.createExperimentNote(data, createBtn);
                    const appendBtn = btnGroup.createEl('button', { text: '📂 补充到现有记录…', cls: 'scholarium-btn' });
                    appendBtn.onclick = () => this.openExperimentPicker(data, appendBtn);
                }
            }
        } else {
            bubble.setText(content);
        }
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    // ───── 应用修改到当前笔记（修改模式）─────
    async applyToCurrentNote(data: ExperimentData, btn: HTMLButtonElement) {
        if (!this.targetFile) return;
        btn.disabled = true;
        btn.setText('应用中…');

        try {
            let content = await this.app.vault.read(this.targetFile);

            // —— frontmatter ——
            if (data.title) {
                content = this.fmSet(content, 'title', data.title);
                if (/^# .+/m.test(content)) content = content.replace(/^# .+$/m, `# ${data.title}`);
            }
            if (data.status)  content = this.fmSet(content, 'status', data.status);
            if (data.smiles)  content = this.fmSet(content, 'smiles', `"${data.smiles.replace(/"/g, '\\"')}"`);
            if (data.results) content = this.fmSet(content, 'results', `"${data.results.replace(/"/g, '\\"').substring(0, 500)}"`);
            if (data.reagents?.length) content = this.fmSetReagents(content, data.reagents);

            // —— json_experiment 内置章节字段 ——
            if (data.steps      && data.steps.trim().length      > 4) content = this.replaceSection(content, '实验步骤', data.steps.trim());
            if (data.results    && data.results.trim().length     > 2) content = this.replaceSection(content, '实验结果', data.results.trim());
            if (data.notes      && data.notes.trim().length       > 2) content = this.replaceSection(content, '注意事项', data.notes.trim());
            if (data.references && data.references.trim().length  > 4) content = this.replaceSection(content, '参考文献', data.references.trim());

            // —— [SECTION] 任意章节 ——
            if (data.sections) {
                for (const [heading, body] of Object.entries(data.sections)) {
                    if (body.trim()) content = this.replaceSection(content, heading, body.trim());
                }
            }

            await this.app.vault.modify(this.targetFile, content);
            this.noteContent = content; // 更新内部缓存，下次 AI 看到最新内容

            const sectionCount = Object.keys(data.sections ?? {}).length;
            const changedParts: string[] = [];
            if (data.title)      changedParts.push('标题');
            if (data.steps)      changedParts.push('步骤');
            if (data.results)    changedParts.push('结果');
            if (data.notes)      changedParts.push('注意事项');
            if (data.references) changedParts.push('参考文献');
            if (sectionCount)    changedParts.push(`${sectionCount} 个章节`);
            new Notice(`✅ 已更新：${changedParts.join('、') || '笔记'}`);
            btn.setText('✅ 已应用');
        } catch (e) {
            new Notice(`❌ 应用失败：${(e as Error).message}`);
            btn.disabled = false;
            btn.setText('✅ 应用到当前笔记');
        }
    }

    // ───── 解析 AI 响应（JSON + [SECTION] 双格式）─────
    parseAIResponse(content: string): { text: string; data: ExperimentData | null } {
        let text = content;
        let data: ExperimentData | null = null;

        // 1. 解析 json_experiment 块
        const jsonMatch = content.match(/```json_experiment\s*([\s\S]*?)```/);
        if (jsonMatch) {
            const raw = (jsonMatch[1] ?? '').trim();
            // 先正常解析
            try {
                data = JSON.parse(raw) as ExperimentData;
            } catch {
                // 容错：把字符串值里的裸换行转为 \n 再试一次
                try {
                    const repaired = this.repairJson(raw);
                    data = JSON.parse(repaired) as ExperimentData;
                } catch { /* 解析失败，data 保持 null */ }
            }
            text = text.replace(/```json_experiment[\s\S]*?```/g, '').trim();
        }

        // 2. 解析 [SECTION: 章节名]...[/SECTION] 块（支持多行内容）
        const sectionRe = /\[SECTION:\s*(.+?)\]\n([\s\S]*?)\[\/SECTION\]/g;
        let m: RegExpExecArray | null;
        while ((m = sectionRe.exec(content)) !== null) {
            const heading = (m[1] ?? '').trim();
            const body    = (m[2] ?? '').trim();
            if (heading && body) {
                if (!data) data = {};
                if (!data.sections) data.sections = {};
                data.sections[heading] = body;
            }
        }
        text = text.replace(/\[SECTION:[\s\S]*?\[\/SECTION\]/g, '').trim();

        return { text, data };
    }

    // 简单 JSON 修复：把字符串值中的裸换行/制表符转义
    private repairJson(raw: string): string {
        // 状态机：在字符串内部时转义裸换行
        let result = '';
        let inString = false;
        let escape = false;
        for (let i = 0; i < raw.length; i++) {
            const ch = raw[i]!;
            if (escape) {
                result += ch;
                escape = false;
                continue;
            }
            if (ch === '\\' && inString) {
                result += ch;
                escape = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                result += ch;
                continue;
            }
            if (inString && ch === '\n') { result += '\\n'; continue; }
            if (inString && ch === '\r') { result += '\\r'; continue; }
            if (inString && ch === '\t') { result += '\\t'; continue; }
            result += ch;
        }
        return result;
    }

    // ───── frontmatter / section 辅助 ─────
    private fmSet(content: string, key: string, value: string): string {
        const re = new RegExp(`^(${key}:[ \\t]*).*$`, 'm');
        return re.test(content)
            ? content.replace(re, `$1${value}`)
            : content.replace(/^(---[\s\S]*?)\n(---)/, `$1\n${key}: ${value}\n$2`);
    }

    private fmSetReagents(content: string, reagents: string[]): string {
        const lines = reagents.map(r => `  - ${r}`).join('\n');
        const block = `reagents:\n${lines}`;
        const re = /reagents:\n(?:[ \t]*- .+\n?)*/;
        return re.test(content)
            ? content.replace(re, block + '\n')
            : content.replace(/^(---[\s\S]*?)\n(---)/, `$1\n${block}\n$2`);
    }

    private replaceSection(content: string, heading: string, newBody: string): string {
        const headRe = new RegExp(`^##\\s+${heading}`, 'm');
        if (!headRe.test(content)) {
            return content.trimEnd() + `\n\n## ${heading}\n\n${newBody}\n`;
        }
        return content.replace(
            new RegExp(`(##\\s+${heading}[^\\n]*)\\n[\\s\\S]*?(?=\\n##[^#]|$)`),
            (_, hl) => `${hl}\n\n${newBody}`
        );
    }

    // ───── 发送消息 ─────
    async sendMessage() {
        const text = this.inputEl.value.trim();
        if (!text || this.isLoading) return;
        if (!this.plugin.settings.aiApiKey) { new Notice('请先在设置中填写 API Key！'); return; }

        this.inputEl.value = '';
        this.messages.push({ role: 'user', content: text });
        this.appendMessage('user', text);

        this.isLoading = true;
        this.sendBtn.disabled = true;
        this.sendBtn.setText('思考中…');

        const loadingEl = this.chatContainer.createDiv({ cls: 'chat-msg chat-assistant' });
        loadingEl.createDiv({ cls: 'chat-bubble loading-bubble', text: '⏳ AI 正在思考…' });
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

        try {
            const raw = await this.callAI(this.messages);
            loadingEl.remove();
            const { text: clean, data } = this.parseAIResponse(raw);
            this.messages.push({ role: 'assistant', content: raw });
            this.appendMessage('assistant', clean, data ?? undefined);
        } catch (e) {
            loadingEl.remove();
            const msg = (e as Error).message;
            this.appendMessage('assistant', `❌ 请求失败：${msg}\n\n请检查 API Key 与网络连接。`);
        }

        this.isLoading = false;
        this.sendBtn.disabled = false;
        this.sendBtn.setText('发送 ↵');
        this.inputEl.focus();
    }

    // ───── 调用 AI ─────
    async callAI(messages: Message[]): Promise<string> {
        const { aiProvider, aiApiKey, aiModel, aiCustomEndpoint } = this.plugin.settings;
        const today = new Date().toISOString().split('T')[0]!;
        const cfg   = PROVIDER_CONFIG[aiProvider];

        let systemPrompt: string;

        if (this.isEditMode && this.noteContent) {
            // ══ 修改模式系统提示词 ══
            systemPrompt =
`你是化学实验室的记录助手，专门帮研究者修改和整理已有的实验笔记。

今天日期：${today}

【当前笔记完整内容】
${this.noteContent}
【/当前笔记内容】

根据用户的指令对上方笔记进行修改。

════════════════════════════════════════
输出规范（严格遵守）
════════════════════════════════════════

① 先用1~2句话说明你做了什么（不要加"我帮您整理了"等套话）

② 如需修改 frontmatter 元数据（标题/状态/SMILES/试剂/结果摘要），使用 JSON 块：
\`\`\`json_experiment
{
  "title": "若修改标题则填写，否则省略此字段",
  "status": "completed 或 in-progress 或 planned 或 failed，若修改则填写",
  "smiles": "SMILES字符串，若修改则填写",
  "results": "简短结果摘要（100字以内），若修改则填写",
  "reagents": ["试剂1","试剂2"]
}
\`\`\`
（只包含实际修改的字段，未修改的省略）

③ 如需修改或新增任意正文章节（实验步骤、参考文献、实验结果、注意事项、讨论等），使用 SECTION 格式：
[SECTION: 章节名称]
完整的章节内容
可以是多行
支持 Markdown 格式
[/SECTION]

示例——添加参考文献：
[SECTION: 参考文献]
1. 作者 et al. 标题. *期刊* **卷**, 页码 (年).
2. 作者 et al. 标题. *期刊* **卷**, 页码 (年).
[/SECTION]

示例——重写实验步骤：
[SECTION: 实验步骤]
1. 称取水杨酸 1.0 g 于 50 mL 圆底烧瓶中
2. 加入乙酸酐 1.5 mL，冰浴搅拌
3. 缓慢滴加浓硫酸 3 滴，催化反应
4. 升温至 85°C 反应 15 分钟
5. 冷却后加水淬灭，过滤，干燥
[/SECTION]

════════════════════════════════════════
重要规则
════════════════════════════════════════
- 多行内容（步骤、参考文献、实验结果正文等）必须用 [SECTION] 格式，不要放进 JSON 字符串
- SECTION 内容会完整替换对应章节，确保输出的是最终完整版本
- 未要求修改的部分不要输出
- 化学式/SMILES 如有错误直接点出`;
        } else {
            // ══ 创建模式系统提示词 ══
            const rawPrompt: string = this.plugin.settings.aiSystemPrompt || DEFAULT_AI_SYSTEM_PROMPT;
            systemPrompt = rawPrompt.split('{{date}}').join(today);
        }

        // Claude 格式
        if (aiProvider === 'claude') {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: { 'x-api-key': aiApiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
                body: JSON.stringify({
                    model:      aiModel || 'claude-sonnet-4-6',
                    max_tokens: 4096,
                    system:     systemPrompt,
                    messages:   messages.map(m => ({ role: m.role, content: m.content })),
                }),
            });
            if (!res.ok) throw new Error(`Claude API 错误 ${res.status}: ${await res.text()}`);
            const d = await res.json() as { content: Array<{ type: string; text: string }> };
            return d.content.find(c => c.type === 'text')?.text ?? '';
        }

        // OpenAI 兼容格式
        const endpoint = aiProvider === 'custom' ? aiCustomEndpoint : cfg.endpoint;
        if (!endpoint) throw new Error('请在设置中填写自定义 API 端点地址');
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${aiApiKey}`, 'content-type': 'application/json' },
            body: JSON.stringify({
                model: aiModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages.map(m => ({ role: m.role, content: m.content })),
                ],
                max_tokens: 4096,
            }),
        });
        if (!res.ok) throw new Error(`${cfg.label} API 错误 ${res.status}: ${await res.text()}`);
        const d = await res.json() as { choices: Array<{ message: { content: string } }> };
        return d.choices[0]?.message?.content ?? '';
    }

    // ───── 打开实验选择器（创建模式）─────
    openExperimentPicker(data: ExperimentData, btn: HTMLButtonElement) {
        const files = this.app.vault.getMarkdownFiles().filter(f =>
            this.app.metadataCache.getFileCache(f)?.frontmatter?.type === 'experiment'
        );
        if (!files.length) { new Notice('暂无实验记录！'); return; }
        files.sort((a, b) => b.stat.mtime - a.stat.mtime);
        new ExperimentPickerModal(this.app, files, async (file) => {
            await this.appendToExperiment(data, file, btn);
        }).open();
    }

    async appendToExperiment(data: ExperimentData, file: TFile, btn: HTMLButtonElement) {
        btn.disabled = true; btn.setText('补充中…');
        try {
            let updated = await this.app.vault.read(file);
            updated = this.patchFrontmatter(updated, data);
            updated = this.appendBodySections(updated, data);
            await this.app.vault.modify(file, updated);
            new Notice(`✅ 已补充到：${file.basename}`);
            this.close();
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (e) {
            new Notice(`❌ 补充失败：${(e as Error).message}`);
            btn.disabled = false; btn.setText('📂 补充到现有记录…');
        }
    }

    patchFrontmatter(content: string, data: ExperimentData): string {
        const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
        if (!fmMatch?.[2]) return content;
        let fm = fmMatch[2];
        if (data.smiles)  fm = fm.replace(/^(smiles:\s*)""\s*$/m, `$1"${data.smiles}"`);
        if (data.results) fm = fm.replace(/^(results:\s*)""\s*$/m, `$1"${data.results.replace(/"/g, '\\"').substring(0, 200)}"`);
        if (data.status === 'completed') fm = fm.replace(/^(status:\s*)in-progress\s*$/m, '$1completed');
        if (data.reagents?.length) {
            const existing = (fm.match(/^  - .+$/gm) ?? []).map(l => l.replace(/^  - /, '').trim());
            const newR = data.reagents.filter(r => !existing.some(e => e.toLowerCase() === r.toLowerCase()));
            if (newR.length) fm = fm.replace(/(reagents:\n(?:  - .+\n?)*)/m, `$1${newR.map(r => `  - ${r}`).join('\n')}\n`);
        }
        return content.replace(fmMatch[2], fm);
    }

    appendBodySections(content: string, data: ExperimentData): string {
        const now = new Date().toLocaleString('zh-CN', { year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit' });
        const div = `\n\n---\n*🤖 AI 补充 · ${now}*\n\n`;
        let updated = content;
        const appendSec = (heading: string, body: string) => {
            if (!body?.trim() || body.trim().length < 3) return;
            const block = `${div}${body.trim()}`;
            updated = new RegExp(`## ${heading}`).test(updated)
                ? updated.replace(new RegExp(`(## ${heading}[\\s\\S]*?)(\\n##[^#]|$)`), (_, sec, next) => `${sec}${block}\n${next}`)
                : updated + `\n\n## ${heading}\n${body.trim()}\n`;
        };
        appendSec('实验步骤', data.steps ?? '');
        appendSec('实验结果', data.results ?? '');
        appendSec('注意事项', data.notes ?? '');
        return updated;
    }

    // ───── 创建新实验笔记 ─────
    async createExperimentNote(data: ExperimentData, btn: HTMLButtonElement) {
        btn.disabled = true; btn.setText('创建中…');
        const folder    = this.plugin.settings.experimentsFolder;
        const date      = data.date || new Date().toISOString().split('T')[0]!;
        const title     = data.title || `实验_${date}`;
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, '_');
        const ts        = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
        const fileName  = `${folder ? folder + '/' : ''}${safeTitle}_${ts}.md`;
        const reagentsYaml = data.reagents?.length ? data.reagents.map(r => `  - ${r}`).join('\n') : '  - ';
        const noteContent =
`---
type: experiment
title: ${title}
date: ${date}
status: ${data.status || 'completed'}
smiles: "${data.smiles || ''}"
reaction_smiles: ""
reagents:
${reagentsYaml}
results: "${data.results || ''}"
tags: [experiment]
---

# ${title}

## 实验步骤

${data.steps || ''}

## 实验结果

${data.results || ''}

## 实验图片

（在此粘贴截图，格式：![描述](图片路径)）

## 注意事项

${data.notes || ''}
`;
        try {
            if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
            const newFile = await this.app.vault.create(fileName, noteContent);
            new Notice(`✅ 实验笔记已创建：${title}`);
            this.close();
            await this.app.workspace.getLeaf(false).openFile(newFile);
        } catch (e) {
            new Notice(`❌ 创建失败：${(e as Error).message}`);
            btn.disabled = false; btn.setText('📝 创建新实验记录');
        }
    }

    onClose() { this.contentEl.empty(); }
}
