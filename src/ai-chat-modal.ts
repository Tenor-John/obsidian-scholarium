import { App, FuzzySuggestModal, Modal, Notice, TFile } from 'obsidian';
import ChemELNPlugin from './main';
import { DEFAULT_AI_SYSTEM_PROMPT, PROVIDER_CONFIG } from './settings';
import { extractTextWithMinerU } from './vision-ocr';
import { rewriteOcrToAgent, type WritingProvider } from './vision-writer';
import { fetchWithTimeout } from './utils/network';

interface Message { role: 'user' | 'assistant'; content: string; }

interface ExperimentData {
    noteType?: 'experiment' | 'research-learning';
    title?: string;
    date?: string;
    status?: string;
    smiles?: string;
    reaction_smiles?: string;
    reagents?: string[];
    results?: string;
    steps?: string;
    objective?: string;
    observations?: string;
    nextSteps?: string;
    notes?: string;
    references?: string;
    catalyst?: string;
    issues?: string;
    source_image?: string;
    source_images?: string[];
    tags?: string[];
    sections?: Record<string, string>;
    body?: string;
}

type AgentAction =
    | {
        type: 'create_experiment';
        data: ExperimentData;
        titleSuggestion?: string;
    }
    | {
        type: 'update_experiment';
        target?: 'current' | 'path' | 'title' | 'latest';
        path?: string;
        title?: string;
        mode?: 'merge' | 'replace';
        data: ExperimentData;
    };

interface AgentPayload {
    reply?: string;
    actions?: AgentAction[];
}

interface ParsedAIResponse {
    text: string;
    data: ExperimentData | null;
    agent: AgentPayload | null;
}

class ExperimentPickerModal extends FuzzySuggestModal<TFile> {
    constructor(
        app: App,
        private expFiles: TFile[],
        private onPick: (file: TFile) => void,
    ) {
        super(app);
        this.setPlaceholder('输入关键词搜索实验记录...');
        this.setInstructions([
            { command: '↑↓', purpose: '选择' },
            { command: '↵', purpose: '补充到此记录' },
            { command: 'esc', purpose: '取消' },
        ]);
    }

    getItems(): TFile[] { return this.expFiles; }

    getItemText(file: TFile): string {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return `${fm?.title ?? file.basename} ${fm?.date ?? ''} [${fm?.status ?? ''}] ${file.path}`;
    }

    onChooseItem(file: TFile): void { this.onPick(file); }
}

export class AIChatModal extends Modal {
    plugin: ChemELNPlugin;
    messages: Message[] = [];
    chatContainer!: HTMLElement;
    inputEl!: HTMLTextAreaElement;
    sendBtn!: HTMLButtonElement;
    isLoading = false;

    private targetFile: TFile | null;
    private noteContent: string;
    private selectedImageFiles: File[] = [];
    private imagePreviewEl: HTMLElement | null = null;
    private imageStatusEl: HTMLElement | null = null;
    private analyzeImageBtn: HTMLButtonElement | null = null;
    private startImagePanel: boolean;

    constructor(app: App, plugin: ChemELNPlugin, targetFile?: TFile, noteContent?: string, startImagePanel = false) {
        super(app);
        this.plugin = plugin;
        this.targetFile = targetFile ?? null;
        this.noteContent = noteContent ?? '';
        this.startImagePanel = startImagePanel;
        this.modalEl.addClass('scholarium-chat-modal-wrap');
        this.plugin.applyThemeAttributes(this.modalEl);
    }

    get isEditMode() { return this.targetFile !== null; }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('scholarium-chat-modal');

        if (this.isEditMode) {
            const fm = this.app.metadataCache.getFileCache(this.targetFile!)?.frontmatter;
            contentEl.createEl('h2', { text: 'AI 修改笔记', cls: 'chat-title' });
            contentEl.createEl('p', {
                text: `当前目标：${(fm?.title as string | undefined) ?? this.targetFile!.basename}`,
                cls: 'chat-subtitle chat-subtitle-edit',
            });
        } else {
            contentEl.createEl('h2', { text: 'AI 实验记录 Agent', cls: 'chat-title' });
            contentEl.createEl('p', {
                text: '可以创建新实验，也可以按标题、日期或上下文修改已有实验记录。',
                cls: 'chat-subtitle',
            });
        }

        const apiBar = contentEl.createDiv({ cls: 'chat-api-bar' });
        if (this.plugin.settings.aiApiKey) {
            const cfg = PROVIDER_CONFIG[this.plugin.settings.aiProvider];
            apiBar.createEl('span', { text: `已连接：${cfg.label} · ${this.plugin.settings.aiModel}`, cls: 'chat-api-ok' });
        } else {
            apiBar.createEl('span', { text: '未配置 API Key，请先到设置中填写', cls: 'chat-api-warn' });
            apiBar.createEl('button', { text: '去设置', cls: 'scholarium-btn' })
                .onclick = () => {
                    this.close();
                    (this.app as unknown as { setting: { open(): void } }).setting.open();
                };
        }

        this.renderImageAgentPanel(contentEl);

        this.chatContainer = contentEl.createDiv({ cls: 'chat-messages' });
        this.appendMessage(
            'assistant',
            this.isEditMode
                ? '我已经加载了当前实验记录。你可以直接说“完善实验步骤”“补充这些结果”“把这段文献整理进参考文献”，我会把修改写回当前笔记。'
                : '告诉我要新建哪条实验，或要修改哪条已有记录。比如：“新建一条钙钛矿退火实验记录”“把 2026-04-21 的实验补充试剂 A/B 和观察结果”。',
        );

        const inputWrap = contentEl.createDiv({ cls: 'chat-input-wrap' });
        this.inputEl = inputWrap.createEl('textarea', {
            cls: 'chat-input',
            attr: {
                placeholder: this.isEditMode
                    ? '例如：把试剂 A 和试剂 B 整理成独立条目，并补充实验目的...'
                    : '例如：新建一条实验记录；或修改 2026-04-21 的记录，补充结果...',
                rows: '5',
            },
        });
        this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                void this.sendMessage();
            }
        });

        const btnRow = inputWrap.createDiv({ cls: 'chat-btn-row' });
        btnRow.createEl('button', { text: '清空对话', cls: 'scholarium-btn' })
            .onclick = () => {
                this.messages = [];
                this.chatContainer.empty();
            };
        this.sendBtn = btnRow.createEl('button', { text: '发送 →', cls: 'scholarium-btn primary' });
        this.sendBtn.onclick = () => void this.sendMessage();

        setTimeout(() => this.inputEl.focus(), 100);
    }

    private renderImageAgentPanel(contentEl: HTMLElement) {
        const panel = contentEl.createDiv({ cls: `chat-image-agent${this.startImagePanel ? ' is-open' : ''}` });
        const head = panel.createDiv({ cls: 'chat-image-head' });
        const titleWrap = head.createDiv();
        titleWrap.createEl('div', {
            text: this.isEditMode ? '图片识别并补充当前记录' : '图片识别生成实验记录',
            cls: 'chat-image-title',
        });
        titleWrap.createEl('div', {
            text: this.isEditMode
                ? '粘贴或上传图片，AI 提取整理后由你确认写回当前记录。'
                : '上传手写记录、实验台照片或仪器截图，AI 会自动提取并整理成新实验记录。',
            cls: 'chat-image-subtitle',
        });
        const headActions = head.createDiv({ cls: 'chat-image-head-actions' });
        const pasteBtn = headActions.createEl('button', {
            text: '粘贴图片',
            cls: 'scholarium-btn chat-image-paste',
        });
        const toggleBtn = headActions.createEl('button', {
            text: this.startImagePanel ? '收起' : '展开',
            cls: 'scholarium-btn chat-image-toggle',
        });

        const body = panel.createDiv({ cls: 'chat-image-body' });
        const drop = body.createDiv({ cls: 'chat-image-drop' });
        const copy = drop.createDiv({ cls: 'chat-image-drop-copy' });
        copy.createEl('div', { text: '选择、拖入或粘贴图片', cls: 'chat-image-drop-title' });
        copy.createEl('div', { text: '支持 PNG / JPG / WEBP；复制截图后在此窗口按 Ctrl+V，可直接识别整理。', cls: 'chat-image-drop-sub' });
        const fileInput = drop.createEl('input', {
            cls: 'chat-image-file',
            attr: { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: 'true' },
        }) as HTMLInputElement;
        fileInput.onchange = () => {
            const files = Array.from(fileInput.files ?? []);
            if (files.length) this.addSelectedImageFiles(files);
            fileInput.value = '';
        };

        drop.addEventListener('dragover', (event) => {
            event.preventDefault();
            drop.addClass('is-dragging');
        });
        drop.addEventListener('dragleave', () => drop.removeClass('is-dragging'));
        drop.addEventListener('drop', (event) => {
            event.preventDefault();
            drop.removeClass('is-dragging');
            const files = Array.from(event.dataTransfer?.files ?? [])
                .filter((file) => file.type.startsWith('image/'));
            if (files.length) this.addSelectedImageFiles(files);
        });
        this.modalEl.addEventListener('paste', (event: ClipboardEvent) => {
            const imageFiles = this.imagesFromPasteEvent(event);
            if (!imageFiles.length) return;
            event.preventDefault();
            panel.addClass('is-open');
            toggleBtn.setText('收起');
            this.addSelectedImageFiles(imageFiles);
            this.setImageStatus(`已从剪贴板添加 ${imageFiles.length} 张图片。`);
        });

        this.imagePreviewEl = body.createDiv({ cls: 'chat-image-preview' });
        this.imageStatusEl = body.createDiv({ cls: 'chat-image-status' });
        this.setImageStatus('等待选择图片。');

        const actions = body.createDiv({ cls: 'chat-image-actions' });
        this.analyzeImageBtn = actions.createEl('button', { text: '识别图片并生成笔记', cls: 'scholarium-btn primary' });
        this.analyzeImageBtn.onclick = () => void this.runImageAnalysis();
        pasteBtn.onclick = () => void this.readClipboardImages(panel, toggleBtn);

        toggleBtn.onclick = () => {
            panel.toggleClass('is-open', !panel.hasClass('is-open'));
            toggleBtn.setText(panel.hasClass('is-open') ? '收起' : '展开');
        };
    }

    private addSelectedImageFiles(files: File[]) {
        const images = files.filter((file) => file.type.startsWith('image/'));
        if (!images.length) {
            new Notice('剪贴板或所选文件中没有图片');
            return;
        }
        this.selectedImageFiles.push(...images);
        this.renderSelectedImageFiles();
    }

    private renderSelectedImageFiles() {
        if (!this.imagePreviewEl) return;
        this.imagePreviewEl.empty();
        const gallery = this.imagePreviewEl.createDiv({ cls: 'chat-image-preview-grid' });
        this.selectedImageFiles.forEach((file, index) => {
            const preview = gallery.createDiv({ cls: 'chat-image-preview-card' });
            preview.createEl('img', { attr: { src: URL.createObjectURL(file), alt: file.name } });
            const info = preview.createDiv({ cls: 'chat-image-file-info' });
            info.createEl('strong', { text: file.name });
            info.createEl('span', { text: `${Math.max(1, Math.round(file.size / 1024))} KB` });
            const removeBtn = preview.createEl('button', {
                text: '移除',
                cls: 'scholarium-btn chat-image-remove',
                attr: { 'aria-label': `移除 ${file.name}` },
            });
            removeBtn.onclick = () => {
                this.selectedImageFiles.splice(index, 1);
                this.renderSelectedImageFiles();
            };
        });
        if (this.analyzeImageBtn) {
            this.analyzeImageBtn.setText(this.selectedImageFiles.length ? `识别并整理 ${this.selectedImageFiles.length} 张图片` : '识别图片并生成笔记');
        }
        this.setImageStatus(this.selectedImageFiles.length ? `已选择 ${this.selectedImageFiles.length} 张图片，可以开始识别。` : '等待选择图片。');
    }

    private imagesFromPasteEvent(event: ClipboardEvent): File[] {
        const data = event.clipboardData;
        const files = Array.from(data?.files ?? []).filter((entry) => entry.type.startsWith('image/'));
        if (files.length) return files.map((file, index) => this.renameClipboardFile(file, index));
        return Array.from(data?.items ?? [])
            .filter((entry) => entry.kind === 'file' && entry.type.startsWith('image/'))
            .map((entry, index) => entry.getAsFile())
            .filter((file): file is File => Boolean(file))
            .map((file, index) => this.renameClipboardFile(file, index));
    }

    private async readClipboardImages(panel: HTMLElement, toggleBtn: HTMLButtonElement) {
        try {
            if (!navigator.clipboard?.read) throw new Error('当前 Obsidian 环境不支持主动读取剪贴板');
            const items = await navigator.clipboard.read();
            const files: File[] = [];
            for (const item of items) {
                for (const type of item.types.filter((value) => value.startsWith('image/'))) {
                    const blob = await item.getType(type);
                    files.push(this.renameClipboardFile(new File([blob], 'clipboard', { type }), files.length));
                }
            }
            if (!files.length) {
                new Notice('剪贴板中没有可读取的图片');
                return;
            }
            panel.addClass('is-open');
            toggleBtn.setText('收起');
            this.addSelectedImageFiles(files);
            this.setImageStatus(`已从剪贴板添加 ${files.length} 张图片。`);
        } catch (error) {
            console.warn('[Scholarium] Clipboard image read failed:', error);
            new Notice('无法读取剪贴板图片，请允许剪贴板权限，或将图片拖入此处');
        }
    }

    private renameClipboardFile(file: File, index: number): File {
        const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        return new File([file], `clipboard-${stamp}-${index + 1}.${extension}`, {
            type: file.type,
            lastModified: Date.now(),
        });
    }

    private async runImageAnalysis() {
        return this.runImageAnalysisWithMinerUAgent();
    }

    private async runImageAnalysisWithMinerUAgent() {
        if (!this.selectedImageFiles.length) {
            new Notice('请先添加图片');
            return;
        }

        const provider = this.plugin.settings.writingProvider as WritingProvider;
        const apiKey = this.plugin.settings.writingApiKey || (
            provider === 'deepseek' ? this.plugin.settings.aiApiKey : ''
        );
        if (!apiKey) {
            this.setImageStatus('请先配置 AI 重写模型 API Key，或选择 DeepSeek 复用主 Key。', true);
            return;
        }

        this.analyzeImageBtn!.disabled = true;
        this.analyzeImageBtn!.setText('识别中...');
        this.appendMessage('user', `图片识别：共 ${this.selectedImageFiles.length} 张`);

        try {
            const imagePaths: string[] = [];
            const ocrResults: Array<{ text: string; markdown: string }> = [];
            for (const [index, image] of this.selectedImageFiles.entries()) {
                this.setImageStatus(`阶段 1/2：正在识别第 ${index + 1}/${this.selectedImageFiles.length} 张图片...`);
                imagePaths.push(await this.saveImageToVault(image));
                ocrResults.push(await extractTextWithMinerU(
                    await this.fileToBase64(image),
                    image.type || 'image/png',
                    this.plugin.settings.mineruApiKey,
                    image.name,
                ));
            }
            const ocrResult = {
                text: ocrResults.map((result, index) => `图片 ${index + 1}\n${result.text}`).join('\n\n'),
                markdown: ocrResults.map((result, index) => `## 图片 ${index + 1}\n\n${result.markdown}`).join('\n\n'),
            };

            this.setImageStatus(`阶段 2/2：AI 正在整理 ${this.selectedImageFiles.length} 张图片的识别结果...`);
            this.analyzeImageBtn!.setText('生成中...');
            const action = await rewriteOcrToAgent(ocrResult, {
                provider,
                apiKey,
                model: this.plugin.settings.writingModel || undefined,
                customEndpoint: this.plugin.settings.writingCustomEndpoint || undefined,
            });

            if (action.type !== 'create_experiment') {
                throw new Error('图片识别当前只允许创建新的实验记录');
            }

            const data = this.normalizeVisionExperimentData(action.data, imagePaths);
            if (this.isEditMode) {
                const response = this.appendMessage('assistant', '图片内容已经识别并整理，请确认后写入当前记录。');
                const actions: AgentAction[] = [{
                    type: 'update_experiment',
                    target: 'current',
                    mode: 'merge',
                    data,
                }];
                this.renderProcessingSummary(response, actions);
                this.renderAgentActions(response, actions);
                this.setImageStatus('识别完成，等待确认写入当前记录。');
            } else {
                const file = await this.createExperimentFromAgent(data);
                this.setImageStatus(`已创建：${file.basename}`);
                this.appendMessage('assistant', `已根据图片创建实验记录：${file.basename}`);
                this.plugin.refreshDashboards();
                new Notice(`实验记录已创建：${file.basename}`);
                await this.app.workspace.getLeaf(false).openFile(file);
            }
        } catch (err) {
            this.setImageStatus((err as Error).message, true);
            this.appendMessage('assistant', `图片识别失败：${(err as Error).message}`);
        } finally {
            this.analyzeImageBtn!.disabled = false;
            this.analyzeImageBtn!.setText(this.selectedImageFiles.length ? `识别并整理 ${this.selectedImageFiles.length} 张图片` : '识别图片并生成笔记');
        }
    }

    private async runImageAnalysisLegacy() {
        if (!this.selectedImageFiles.length) {
            new Notice('请先添加图片');
            return;
        }
        if (!this.plugin.settings.mineruApiKey) {
            this.setImageStatus('请先在设置中填写 MinerU API Key。', true);
            return;
        }

        const provider = this.plugin.settings.writingProvider as WritingProvider;
        const apiKey = this.plugin.settings.writingApiKey || (
            provider === 'deepseek' ? this.plugin.settings.aiApiKey : ''
        );
        if (!apiKey) {
            this.setImageStatus('请先配置 AI 重写模型 API Key，或选择 DeepSeek 复用主 Key。', true);
            return;
        }

        this.analyzeImageBtn!.disabled = true;
        this.analyzeImageBtn!.setText('识别中...');
        this.appendMessage('user', `图片识别：共 ${this.selectedImageFiles.length} 张`);

        try {
            const imagePaths: string[] = [];
            const ocrResults: Array<{ text: string; markdown: string }> = [];
            for (const [index, image] of this.selectedImageFiles.entries()) {
                this.setImageStatus(`阶段 1/2：正在识别第 ${index + 1}/${this.selectedImageFiles.length} 张图片...`);
                imagePaths.push(await this.saveImageToVault(image));
                ocrResults.push(await extractTextWithMinerU(
                    await this.fileToBase64(image),
                    image.type || 'image/png',
                    this.plugin.settings.mineruApiKey,
                    image.name,
                ));
            }
            const ocrResult = {
                text: ocrResults.map((result, index) => `图片 ${index + 1}\n${result.text}`).join('\n\n'),
                markdown: ocrResults.map((result, index) => `## 图片 ${index + 1}\n\n${result.markdown}`).join('\n\n'),
            };

            this.setImageStatus('阶段 2/2：AI 正在整理为实验记录...');
            this.analyzeImageBtn!.setText('生成中...');
            const action = await rewriteOcrToAgent(ocrResult, {
                provider,
                apiKey,
                model: this.plugin.settings.writingModel || undefined,
                customEndpoint: this.plugin.settings.writingCustomEndpoint || undefined,
            });

            if (action.type !== 'create_experiment') {
                throw new Error('图片识别当前只允许创建新的实验记录');
            }

            const data = this.normalizeVisionExperimentData(action.data, imagePaths);
            const file = await this.createExperimentFromAgent(data);
            this.setImageStatus(`已创建：${file.basename}`);
            this.appendMessage('assistant', `已根据图片创建实验记录：${file.basename}`);
            this.plugin.refreshDashboards();
            new Notice(`实验记录已创建：${file.basename}`);
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (err) {
            this.setImageStatus((err as Error).message, true);
            this.appendMessage('assistant', `图片识别失败：${(err as Error).message}`);
        } finally {
            this.analyzeImageBtn!.disabled = false;
            this.analyzeImageBtn!.setText(this.selectedImageFiles.length ? `识别并整理 ${this.selectedImageFiles.length} 张图片` : '识别图片并生成笔记');
        }
    }

    private setImageStatus(message: string, isError = false) {
        if (!this.imageStatusEl) return;
        this.imageStatusEl.setText(message);
        this.imageStatusEl.toggleClass('is-error', isError);
    }

    appendMessage(role: 'user' | 'assistant', content: string, data?: ExperimentData): HTMLElement {
        const msgEl = this.chatContainer.createDiv({ cls: `chat-msg chat-${role}` });
        const bubble = msgEl.createDiv({ cls: 'chat-bubble' });

        if (role === 'assistant') {
            bubble.innerHTML = this.renderBasicMarkdown(content || '已处理。');
            if (data && this.hasExperimentData(data)) this.renderLegacyActions(msgEl, data);
        } else {
            bubble.setText(content);
        }
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        return msgEl;
    }

    private renderBasicMarkdown(content: string): string {
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    private hasExperimentData(data: ExperimentData): boolean {
        return Boolean(
            data.title || data.results || data.steps || data.objective || data.observations ||
            data.nextSteps || data.notes || data.references ||
            data.body || (data.sections && Object.keys(data.sections).length > 0),
        );
    }

    private renderLegacyActions(msgEl: HTMLElement, data: ExperimentData) {
        this.renderProcessingSummary(msgEl, []);
        const actionEl = msgEl.createDiv({ cls: 'chat-action' });
        const preview = actionEl.createDiv({ cls: 'exp-preview' });

        if (data.noteType === 'research-learning') preview.createEl('div', { text: '类型：研究学习笔记', cls: 'preview-field' });
        if (this.isEditMode && data.body?.trim()) preview.createEl('div', { text: '写入方式：替换当前正文', cls: 'preview-field' });
        if (data.title) preview.createEl('div', { text: `标题：${data.title}`, cls: 'preview-title' });
        if (data.status) preview.createEl('div', { text: `状态：${data.status}`, cls: 'preview-field' });
        if (data.results) preview.createEl('div', { text: `结果：${data.results.substring(0, 100)}`, cls: 'preview-field' });
        if (data.smiles) preview.createEl('div', { text: `SMILES：${data.smiles}`, cls: 'preview-field smiles' });
        if (data.reagents?.length) preview.createEl('div', { text: `试剂：${data.reagents.join('、')}`, cls: 'preview-field' });
        if (data.steps) preview.createEl('div', { text: `步骤：${data.steps.substring(0, 100)}`, cls: 'preview-field' });
        if (data.references) preview.createEl('div', { text: `参考文献：${data.references.split('\n').filter(Boolean).length} 条`, cls: 'preview-field' });

        const btnGroup = actionEl.createDiv({ cls: 'chat-action-btns' });
        if (this.isEditMode) {
            const applyBtn = btnGroup.createEl('button', { text: '应用到当前笔记', cls: 'scholarium-btn primary' });
            applyBtn.onclick = () => void this.applyProposalToFile(
                this.targetFile!,
                data,
                applyBtn,
                data.body?.trim() ? 'replace' : 'merge',
            );
        } else {
            const createBtn = btnGroup.createEl('button', { text: data.noteType === 'research-learning' ? '保存研究学习笔记' : '创建新实验记录', cls: 'scholarium-btn primary' });
            createBtn.onclick = () => void this.createExperimentNote(data, createBtn);
            const appendBtn = btnGroup.createEl('button', { text: '补充到现有记录...', cls: 'scholarium-btn' });
            appendBtn.onclick = () => this.openExperimentPicker(data, appendBtn);
        }
    }

    async sendMessage() {
        const text = this.inputEl.value.trim();
        if (!text || this.isLoading) return;
        if (!this.plugin.settings.aiApiKey) {
            new Notice('请先在设置中填写 API Key');
            return;
        }

        this.inputEl.value = '';
        this.messages.push({ role: 'user', content: text });
        this.appendMessage('user', text);

        this.isLoading = true;
        this.sendBtn.disabled = true;
        this.sendBtn.setText('思考中...');

        const loadingEl = this.chatContainer.createDiv({ cls: 'chat-msg chat-assistant' });
        loadingEl.createDiv({ cls: 'chat-bubble loading-bubble', text: 'AI 正在分析并准备执行...' });
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;

        try {
            const raw = await this.callAI(this.messages);
            loadingEl.remove();
            const parsed = this.parseAIResponse(raw);
            const clean = parsed.text || parsed.agent?.reply || '我已经准备好修改方案，请确认后写入实验记录。';
            this.messages.push({ role: 'assistant', content: raw });
            const responseEl = this.appendMessage('assistant', clean, parsed.data ?? undefined);

            if (parsed.agent?.actions?.length) {
                const actions = this.normalizeActionsForMode(parsed.agent.actions);
                this.renderProcessingSummary(responseEl, actions);
                this.renderAgentActions(responseEl, actions);
            } else if (!parsed.data && this.isEditMode && clean.trim()) {
                this.renderUnstructuredEditActions(responseEl, clean);
            }
        } catch (e) {
            loadingEl.remove();
            const msg = (e as Error).message;
            this.appendMessage('assistant', `请求失败：${msg}\n\n请检查 API Key、模型名称和网络连接。`);
        }

        this.isLoading = false;
        this.sendBtn.disabled = false;
        this.sendBtn.setText('发送 →');
        this.inputEl.focus();
    }

    async callAI(messages: Message[]): Promise<string> {
        const { aiProvider, aiApiKey, aiModel, aiCustomEndpoint } = this.plugin.settings;
        const today = new Date().toISOString().split('T')[0]!;
        const cfg = PROVIDER_CONFIG[aiProvider];
        const systemPrompt = this.buildAgentPrompt(today);

        if (aiProvider === 'claude') {
            const res = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': aiApiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    model: aiModel || 'claude-sonnet-4-6',
                    max_tokens: 4096,
                    system: systemPrompt,
                    messages: messages.map(m => ({ role: m.role, content: m.content })),
                }),
            });
            if (!res.ok) throw new Error(`Claude API 错误 ${res.status}: ${await res.text()}`);
            const d = await res.json() as { content: Array<{ type: string; text: string }> };
            return d.content.find(c => c.type === 'text')?.text ?? '';
        }

        const endpoint = aiProvider === 'custom' ? aiCustomEndpoint : cfg.endpoint;
        if (!endpoint) throw new Error('请在设置中填写自定义 API 端点地址');
        const res = await fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${aiApiKey}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model: aiModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages.map(m => ({ role: m.role, content: m.content })),
                ],
                max_tokens: 4096,
                temperature: this.plugin.settings.aiTemperature,
            }),
        });
        if (!res.ok) throw new Error(`${cfg.label} API 错误 ${res.status}: ${await res.text()}`);
        const d = await res.json() as { choices: Array<{ message: { content: string } }> };
        return d.choices[0]?.message?.content ?? '';
    }

    private buildAgentPrompt(today: string): string {
        const customTone = (this.plugin.settings.aiSystemPrompt || DEFAULT_AI_SYSTEM_PROMPT)
            .split('{{date}}').join(today)
            .slice(0, 4000);
        const index = this.buildExperimentIndex();
        const currentContext = this.isEditMode
            ? `\n当前编辑目标：${this.targetFile!.path}\n当前笔记全文：\n${this.noteContent.slice(0, 12000)}`
            : '';

        return `你是 Obsidian 研究记录插件里的记录 Agent。你的任务是判断用户内容应形成实验记录，还是研究学习笔记，并决定创建新笔记或修改已有笔记。
今天日期：${today}

插件会执行你输出的 actions。请优先输出一个 json_agent 代码块，格式如下：
\`\`\`json_agent
{
  "reply": "给用户看的简短说明",
  "actions": [
    {
      "type": "create_experiment",
       "data": {
        "noteType": "experiment | research-learning",
        "title": "自动命名的实验标题",
        "date": "${today}",
        "status": "planned | in-progress | completed | failed",
        "smiles": "",
        "reaction_smiles": "",
        "reagents": ["试剂A", "试剂B"],
        "objective": "实验目的",
        "steps": "1. ...\\n2. ...",
        "results": "结果摘要",
        "observations": "观察现象",
        "nextSteps": "下一步计划",
        "notes": "注意事项",
        "references": "参考文献",
        "sections": { "任意章节名": "章节内容" },
        "body": "研究学习笔记使用的完整 Markdown 正文"
      }
    },
    {
      "type": "update_experiment",
      "target": "current | path | title | latest",
      "path": "已有实验记录路径，target=path 时必须填写",
      "title": "已有实验记录标题，target=title 时填写",
      "mode": "merge",
      "data": { "要更新或补充的字段": "内容" }
    }
  ]
}
\`\`\`

规则：
- 用户提供实验过程、配方、操作条件、表征或结果时，noteType 使用 experiment，并按实验字段整理。
- 用户提供概念学习、文献阅读、方法理解、研究思路或知识总结而非一次具体实验时，noteType 使用 research-learning。
- research-learning 不使用实验模板；必须把整理后的、可直接阅读的 Markdown 全文放入 data.body，可使用小标题、列表和公式说明，去除对话口吻和“我来帮你”等措辞。
- 用户要求“修改、完善、补充、丰富、整理已有/当前记录”时，必须使用 update_experiment，不能新建。
- 用户明确要求“替换、改写全文、重写正文”时，update_experiment 使用 mode: "replace"，并将整理完成、可直接阅读的完整 Markdown 正文放入 data.body。
- 当前处于 AI 修改笔记模式时，默认 target 使用 current。
- 当前处于 AI 修改笔记模式时，用户粘贴的内容应整理为可写回记录的 data 字段，并必须返回 update_experiment action；不要只给聊天建议。
- 普通 AI 助手模式下，如果用户提到已有记录，请从“已有实验记录索引”中选择最匹配的 path。
- 用户要求新实验、创建、记录一个新的实验时，使用 create_experiment，并根据实验主题自动命名 title。
- 不要删除用户已有内容；mode 默认 merge。只输出需要修改或补充的字段。
- 试剂必须作为数组输出，避免把“试剂A 试剂B”挤在同一行。
- 多行正文放在 data 的 steps/results/notes/references/sections 中，不要只写在 reply 里。
- 如果目标不明确到无法安全修改，请不要输出 actions，只在 reply 中问一个简短问题。

已有实验记录索引（最多 40 条，按最近修改排序）：
${JSON.stringify(index, null, 2)}
${currentContext}

用户自定义风格提示（只影响写作风格，不覆盖上面的动作格式）：
${customTone}`;
    }

    parseAIResponse(content: string): ParsedAIResponse {
        let text = content;
        let data: ExperimentData | null = null;
        let agent: AgentPayload | null = null;

        const agentMatch = content.match(/```json_agent\s*([\s\S]*?)```/);
        if (agentMatch) {
            agent = this.parseJsonSafely<AgentPayload>((agentMatch[1] ?? '').trim());
            text = text.replace(/```json_agent[\s\S]*?```/g, '').trim();
        } else {
            const rawAgent = this.parseJsonSafely<AgentPayload>(content.trim());
            if (rawAgent?.actions) {
                agent = rawAgent;
                text = rawAgent.reply ?? '';
            }
        }

        const jsonMatch = content.match(/```json_experiment\s*([\s\S]*?)```/);
        if (jsonMatch) {
            data = this.parseJsonSafely<ExperimentData>((jsonMatch[1] ?? '').trim());
            text = text.replace(/```json_experiment[\s\S]*?```/g, '').trim();
        }

        const sectionRe = /\[SECTION:\s*(.+?)\]\n([\s\S]*?)\[\/SECTION\]/g;
        let m: RegExpExecArray | null;
        while ((m = sectionRe.exec(content)) !== null) {
            const heading = (m[1] ?? '').trim();
            const body = (m[2] ?? '').trim();
            if (heading && body) {
                if (!data) data = {};
                if (!data.sections) data.sections = {};
                data.sections[heading] = body;
            }
        }
        text = text.replace(/\[SECTION:[\s\S]*?\[\/SECTION\]/g, '').trim();

        return { text, data, agent };
    }

    private parseJsonSafely<T>(raw: string): T | null {
        try {
            return JSON.parse(raw) as T;
        } catch {
            try {
                return JSON.parse(this.repairJson(raw)) as T;
            } catch {
                return null;
            }
        }
    }

    private repairJson(raw: string): string {
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

    private buildExperimentIndex() {
        return this.getExperimentFiles()
            .sort((a, b) => b.stat.mtime - a.stat.mtime)
            .slice(0, 40)
            .map(file => {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                return {
                    path: file.path,
                    title: fm?.title ?? file.basename,
                    date: fm?.date ?? '',
                    status: fm?.status ?? '',
                    modified: new Date(file.stat.mtime).toISOString(),
                };
            });
    }

    private getExperimentFiles(): TFile[] {
        const folder = this.plugin.settings.experimentsFolder?.replace(/\/+$/, '');
        return this.app.vault.getMarkdownFiles().filter(file => {
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            return fm?.type === 'experiment' || Boolean(folder && file.path.startsWith(`${folder}/`));
        });
    }

    private async applyAgentPayload(payload: AgentPayload): Promise<string> {
        const actions = payload.actions ?? [];
        const results: string[] = [];
        let lastFile: TFile | null = null;

        for (const action of actions) {
            if (action.type === 'create_experiment') {
                const file = await this.createExperimentFromAgent(action.data, action.titleSuggestion);
                lastFile = file;
                results.push(`已创建：${file.basename}`);
                continue;
            }

            if (action.type === 'update_experiment') {
                const file = this.resolveAgentTarget(action);
                if (!file) {
                    results.push(`未找到要修改的实验记录：${action.path ?? action.title ?? action.target ?? '未指定'}`);
                    continue;
                }
                await this.patchExperimentFile(file, action.data);
                lastFile = file;
                results.push(`已更新：${file.basename}`);
            }
        }

        if (lastFile) {
            await this.app.workspace.getLeaf(false).openFile(lastFile);
        }

        const summary = results.length ? results.join('\n') : '没有执行写入动作。';
        new Notice(summary);
        return summary;
    }

    private renderAgentActions(msgEl: HTMLElement, actions: AgentAction[]) {
        const actionWrap = msgEl.createDiv({ cls: 'chat-proposals' });
        for (const action of actions) {
            const card = actionWrap.createDiv({ cls: 'exp-preview chat-proposal-card' });
            if (action.type === 'update_experiment') {
                const file = this.resolveAgentTarget(action);
                card.createEl('div', { text: '拟修改实验记录', cls: 'preview-title' });
                card.createEl('div', { text: file ? file.basename : '未找到目标笔记', cls: 'preview-field' });
                this.renderProposalFields(card, action.data, action.mode);
                const buttons = card.createDiv({ cls: 'chat-action-btns' });
                const applyBtn = buttons.createEl('button', { text: '应用修改', cls: 'scholarium-btn primary' });
                applyBtn.disabled = !file;
                applyBtn.onclick = () => {
                    if (file) void this.applyProposalToFile(file, action.data, applyBtn, action.mode);
                };
                if (!this.isEditMode) {
                    const createBtn = buttons.createEl('button', { text: '另存为新记录', cls: 'scholarium-btn' });
                    createBtn.onclick = () => void this.createExperimentNote(action.data, createBtn);
                }
                continue;
            }

            card.createEl('div', { text: action.data.noteType === 'research-learning' ? '拟创建研究学习笔记' : '拟创建实验记录', cls: 'preview-title' });
            this.renderProposalFields(card, action.data);
            const buttons = card.createDiv({ cls: 'chat-action-btns' });
            const createBtn = buttons.createEl('button', { text: action.data.noteType === 'research-learning' ? '保存研究学习笔记' : '保存为新实验记录', cls: 'scholarium-btn primary' });
            createBtn.onclick = () => void this.createExperimentNote(action.data, createBtn);
            if (this.targetFile) {
                const applyBtn = buttons.createEl('button', { text: '应用到当前记录', cls: 'scholarium-btn' });
                applyBtn.onclick = () => void this.applyProposalToFile(this.targetFile!, action.data, applyBtn);
            }
        }
    }

    private renderProposalFields(card: HTMLElement, data: ExperimentData, mode?: 'merge' | 'replace') {
        const fields: Array<[string, string | undefined]> = [
            ['写入方式', mode === 'replace' ? '替换当前正文' : mode === 'merge' ? '合并更新字段' : undefined],
            ['类型', data.noteType === 'research-learning' ? '研究学习笔记' : data.noteType === 'experiment' ? '实验记录' : undefined],
            ['标题', data.title],
            ['状态', data.status],
            ['实验目的', data.objective],
            ['实验步骤', data.steps],
            ['结果', data.results],
            ['观察', data.observations],
            ['下一步', data.nextSteps],
            ['正文', data.body],
        ];
        for (const [label, value] of fields) {
            if (!value?.trim()) continue;
            const shortValue = value.length > 120 ? `${value.slice(0, 120)}...` : value;
            card.createEl('div', { text: `${label}：${shortValue}`, cls: 'preview-field' });
        }
    }

    private normalizeActionsForMode(actions: AgentAction[]): AgentAction[] {
        if (!this.isEditMode) return actions;
        return actions.map((action): AgentAction => {
            if (action.type === 'create_experiment') {
                return {
                    type: 'update_experiment',
                    target: 'current',
                    mode: action.data.body?.trim() ? 'replace' : 'merge',
                    data: action.data,
                };
            }
            return { ...action, target: 'current' };
        });
    }

    private renderProcessingSummary(msgEl: HTMLElement, actions: AgentAction[]) {
        const summary = msgEl.createDiv({ cls: 'chat-processing-summary' });
        summary.createEl('div', { text: '处理进度', cls: 'chat-processing-title' });
        summary.createEl('div', { text: '已分析输入内容和当前笔记', cls: 'chat-processing-step is-done' });
        summary.createEl('div', { text: '已整理可写入的修改方案', cls: 'chat-processing-step is-done' });
        summary.createEl('div', {
            text: this.isEditMode
                ? '等待你确认后写回当前记录'
                : `等待你确认后保存 ${actions.length || 1} 条记录`,
            cls: 'chat-processing-step is-pending',
        });
    }

    private renderUnstructuredEditActions(msgEl: HTMLElement, content: string) {
        const card = msgEl.createDiv({ cls: 'exp-preview chat-proposal-card' });
        card.createEl('div', { text: 'AI 未生成可直接写回的字段', cls: 'preview-title' });
        card.createEl('div', { text: '可以先将当前文本存入“注意事项”，或继续要求 AI 按实验字段整理。', cls: 'preview-field' });
        const buttons = card.createDiv({ cls: 'chat-action-btns' });
        const noteBtn = buttons.createEl('button', { text: '存入注意事项', cls: 'scholarium-btn' });
        noteBtn.onclick = () => {
            if (this.targetFile) void this.applyProposalToFile(this.targetFile, { notes: content }, noteBtn);
        };
    }

    private async applyProposalToFile(file: TFile, data: ExperimentData, btn: HTMLButtonElement, mode: 'merge' | 'replace' = 'merge') {
        btn.disabled = true;
        const originalText = btn.textContent ?? '应用修改';
        btn.setText('写入中...');
        try {
            await this.patchExperimentFile(file, data, mode);
            btn.setText('已写入');
            this.plugin.refreshDashboards();
            new Notice(`已更新实验记录：${file.basename}`);
            this.appendMessage('assistant', `已将修改写回当前记录：${file.basename}。看板内容已同步刷新。`);
        } catch (error) {
            btn.disabled = false;
            btn.setText(originalText);
            new Notice(`写入失败：${(error as Error).message}`);
        }
    }

    private resolveAgentTarget(action: Extract<AgentAction, { type: 'update_experiment' }>): TFile | null {
        if ((action.target === 'current' || !action.target) && this.targetFile) return this.targetFile;

        const files = this.getExperimentFiles();
        if (action.path) {
            const byPath = this.app.vault.getAbstractFileByPath(action.path);
            if (byPath instanceof TFile) return byPath;
            const normalized = action.path.toLowerCase();
            const fuzzyPath = files.find(file => file.path.toLowerCase() === normalized || file.path.toLowerCase().endsWith(normalized));
            if (fuzzyPath) return fuzzyPath;
        }

        if (action.title) {
            const needle = action.title.toLowerCase();
            const exact = files.find(file => {
                const fmTitle = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename).toLowerCase();
                return fmTitle === needle || file.basename.toLowerCase() === needle;
            });
            if (exact) return exact;
            const fuzzy = files.find(file => {
                const fmTitle = String(this.app.metadataCache.getFileCache(file)?.frontmatter?.title ?? file.basename).toLowerCase();
                return fmTitle.includes(needle) || needle.includes(fmTitle) || file.basename.toLowerCase().includes(needle);
            });
            if (fuzzy) return fuzzy;
        }

        if (action.target === 'latest') {
            return files.sort((a, b) => b.stat.mtime - a.stat.mtime)[0] ?? null;
        }

        return null;
    }

    private async applyAgentDataToCurrent(data: ExperimentData): Promise<string> {
        if (!this.targetFile) return '当前没有可修改的目标笔记。';
        await this.patchExperimentFile(this.targetFile, data);
        await this.app.workspace.getLeaf(false).openFile(this.targetFile);
        new Notice(`已更新：${this.targetFile.basename}`);
        return `已更新：${this.targetFile.basename}`;
    }

    async applyToCurrentNote(data: ExperimentData, btn: HTMLButtonElement) {
        if (!this.targetFile) return;
        btn.disabled = true;
        btn.setText('应用中...');
        try {
            await this.patchExperimentFile(this.targetFile, data);
            btn.setText('已应用');
            new Notice(`已更新：${this.targetFile.basename}`);
        } catch (e) {
            btn.disabled = false;
            btn.setText('应用到当前笔记');
            new Notice(`应用失败：${(e as Error).message}`);
        }
    }

    private async patchExperimentFile(file: TFile, data: ExperimentData, mode: 'merge' | 'replace' = 'merge') {
        let content = await this.app.vault.read(file);
        content = this.patchFrontmatter(content, data);

        if (data.title) {
            if (/^# .+/m.test(content)) content = content.replace(/^# .+$/m, `# ${data.title}`);
            else content = `${content.trimEnd()}\n\n# ${data.title}\n`;
        }

        const sectionMap: Array<[keyof ExperimentData, string]> = [
            ['objective', '实验目的'],
            ['steps', '实验步骤'],
            ['results', '实验结果'],
            ['observations', '观察与现象'],
            ['nextSteps', '下一步计划'],
            ['notes', '注意事项'],
            ['references', '参考文献'],
        ];
        for (const [key, heading] of sectionMap) {
            const value = data[key];
            if (typeof value === 'string' && value.trim().length > 0) {
                content = this.replaceSection(content, heading, value.trim());
            }
        }
        if (data.sections) {
            for (const [heading, body] of Object.entries(data.sections)) {
                if (body.trim()) content = this.replaceSection(content, heading, body.trim());
            }
        }
        if (data.source_images?.length) {
            content = this.replaceSection(content, '实验图片', this.renderImageLinks(data.source_images));
        }
        if (data.noteType === 'research-learning' || (mode === 'replace' && data.body?.trim())) {
            const replacementBody = data.noteType === 'research-learning'
                ? this.researchLearningBody(data)
                : data.body!.trim();
            const fallbackType = data.noteType ?? 'experiment';
            const frontmatter = content.match(/^---[\s\S]*?\n---/)?.[0] ?? `---\ntype: ${fallbackType}\n---`;
            content = `${frontmatter}\n\n# ${data.title || file.basename}\n\n${replacementBody}\n`;
        }

        await this.app.vault.modify(file, content);
        if (this.targetFile?.path === file.path) this.noteContent = content;
    }

    patchFrontmatter(content: string, data: ExperimentData): string {
        let updated = this.ensureFrontmatter(content);
        if (data.noteType) updated = this.fmSet(updated, 'type', this.yamlQuote(data.noteType));
        if (data.title) updated = this.fmSet(updated, 'title', this.yamlQuote(data.title));
        if (data.date) updated = this.fmSet(updated, 'date', this.yamlQuote(data.date));
        if (data.status) updated = this.fmSet(updated, 'status', this.yamlQuote(data.status));
        if (data.smiles !== undefined) updated = this.fmSet(updated, 'smiles', this.yamlQuote(data.smiles));
        if (data.reaction_smiles !== undefined) updated = this.fmSet(updated, 'reaction_smiles', this.yamlQuote(data.reaction_smiles));
        if (data.results) updated = this.fmSet(updated, 'results', this.yamlQuote(data.results.substring(0, 500)));
        if (data.reagents?.length) updated = this.fmSetReagents(updated, data.reagents);
        return updated;
    }

    private ensureFrontmatter(content: string): string {
        if (/^---\n[\s\S]*?\n---/.test(content)) return content;
        return `---\ntype: experiment\ntags: [experiment]\n---\n\n${content}`;
    }

    private fmSet(content: string, key: string, value: string): string {
        const re = new RegExp(`^(${this.escapeRegExp(key)}:[ \\t]*).*$`, 'm');
        return re.test(content)
            ? content.replace(re, `$1${value}`)
            : content.replace(/^(---[\s\S]*?)\n(---)/, `$1\n${key}: ${value}\n$2`);
    }

    private fmSetReagents(content: string, reagents: string[]): string {
        const lines = reagents.map(r => `  - ${String(r).trim()}`).filter(line => line !== '  - ').join('\n');
        const block = `reagents:\n${lines || '  - '}`;
        const re = /^reagents:\n(?:[ \t]*- .+\n?)*/m;
        return re.test(content)
            ? content.replace(re, `${block}\n`)
            : content.replace(/^(---[\s\S]*?)\n(---)/, `$1\n${block}\n$2`);
    }

    private replaceSection(content: string, heading: string, newBody: string): string {
        const escaped = this.escapeRegExp(heading);
        const headRe = new RegExp(`^##\\s+${escaped}\\s*$`, 'm');
        if (!headRe.test(content)) {
            return `${content.trimEnd()}\n\n## ${heading}\n\n${newBody}\n`;
        }
        return content.replace(
            new RegExp(`(^##\\s+${escaped}\\s*$)\\n[\\s\\S]*?(?=\\n##\\s+[^\\n]+|$)`, 'm'),
            `$1\n\n${newBody}`,
        );
    }

    openExperimentPicker(data: ExperimentData, btn: HTMLButtonElement) {
        const files = this.getExperimentFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
        if (!files.length) {
            new Notice('暂无实验记录');
            return;
        }
        new ExperimentPickerModal(this.app, files, async (file) => {
            await this.appendToExperiment(data, file, btn);
        }).open();
    }

    async appendToExperiment(data: ExperimentData, file: TFile, btn: HTMLButtonElement) {
        btn.disabled = true;
        btn.setText('补充中...');
        try {
            await this.patchExperimentFile(file, data);
            new Notice(`已补充到：${file.basename}`);
            this.close();
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (e) {
            new Notice(`补充失败：${(e as Error).message}`);
            btn.disabled = false;
            btn.setText('补充到现有记录...');
        }
    }

    async createExperimentNote(data: ExperimentData, btn: HTMLButtonElement) {
        btn.disabled = true;
        btn.setText('创建中...');
        try {
            const file = await this.createExperimentFromAgent(data);
            new Notice(`${data.noteType === 'research-learning' ? '研究学习笔记' : '实验笔记'}已创建：${file.basename}`);
            this.plugin.refreshDashboards();
            this.close();
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (e) {
            new Notice(`创建失败：${(e as Error).message}`);
            btn.disabled = false;
            btn.setText(data.noteType === 'research-learning' ? '保存研究学习笔记' : '创建新实验记录');
        }
    }

    private normalizeVisionExperimentData(raw: Record<string, unknown>, imagePaths: string[]): ExperimentData {
        const steps = this.asStringArray(raw.steps);
        return {
            title: this.asString(raw.title),
            date: this.asString(raw.date),
            status: this.asString(raw.status) || 'in-progress',
            smiles: this.asString(raw.smiles),
            reaction_smiles: this.asString(raw.reaction_smiles),
            catalyst: this.asString(raw.catalyst),
            reagents: this.asStringArray(raw.reagents),
            objective: this.asString(raw.objective),
            steps: steps.map((step, index) => `${index + 1}. ${step}`).join('\n'),
            observations: this.asString(raw.observations),
            results: this.asString(raw.results),
            notes: this.asString(raw.notes),
            issues: this.asString(raw.issues),
            source_image: imagePaths[0],
            source_images: imagePaths,
            tags: Array.from(new Set([...this.asStringArray(raw.tags), 'from-image'])),
        };
    }

    private async saveImageToVault(file: File): Promise<string> {
        const root = this.plugin.settings.experimentsFolder?.replace(/\/+$/, '') || 'Experiments';
        const folder = `${root}/Images`;
        if (!this.app.vault.getAbstractFileByPath(root)) {
            await this.app.vault.createFolder(root);
        }
        if (!this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }

        const ext = file.name.match(/\.[^.]+$/)?.[0] || '.png';
        const base = this.safeFileName(file.name.replace(/\.[^.]+$/, '')) || 'image';
        const path = await this.uniqueAssetPath(`${folder}/${new Date().toISOString().slice(0, 10)}-${base}${ext}`);
        await this.app.vault.createBinary(path, await file.arrayBuffer());
        return path;
    }

    private async fileToBase64(file: File): Promise<string> {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
        return btoa(binary);
    }

    private async createExperimentFromAgent(data: ExperimentData, titleSuggestion?: string): Promise<TFile> {
        const folder = this.plugin.settings.experimentsFolder?.replace(/\/+$/, '');
        const date = this.normalizeDate(data.date);
        const title = this.normalizeExperimentTitle(
            data.title || titleSuggestion,
            date,
            data.noteType === 'research-learning' ? '研究学习笔记' : '图片识别实验记录',
        );
        const safeTitle = this.safeFileName(`${date}-${title}`);
        const fileName = await this.uniqueMarkdownPath(folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`);

        if (folder && !this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }

        const reagentsYaml = data.reagents?.length
            ? data.reagents.map(r => `  - ${String(r).trim()}`).join('\n')
            : '  - ';
        const sourceImages = data.source_images?.length ? data.source_images : (data.source_image ? [data.source_image] : []);
        const sourceImage = sourceImages[0] || '';
        const sourceImagesYaml = sourceImages.length
            ? `\nsource_images:\n${sourceImages.map((path) => `  - ${this.yamlQuote(path)}`).join('\n')}`
            : '';
        const tags = Array.from(new Set(['experiment', ...(data.tags ?? [])]))
            .map(tag => this.safeTag(tag))
            .filter(Boolean)
            .join(', ');
        const noteContent = data.noteType === 'research-learning' ? `---
type: research-learning
title: ${this.yamlQuote(title)}
date: ${this.yamlQuote(date)}
status: ${this.yamlQuote('study')}
tags: [research-learning, study-note]
---

# ${title}

${this.researchLearningBody(data)}
` : `---
type: experiment
title: ${this.yamlQuote(title)}
date: ${this.yamlQuote(date)}
status: ${this.yamlQuote(data.status || 'in-progress')}
smiles: ${this.yamlQuote(data.smiles || '')}
reaction_smiles: ${this.yamlQuote(data.reaction_smiles || '')}
catalyst: ${this.yamlQuote(data.catalyst || '')}
reagents:
${reagentsYaml}
results: ${this.yamlQuote(data.results || '')}
source_image: ${this.yamlQuote(sourceImage)}${sourceImagesYaml}
tags: [${tags || 'experiment'}]
---

# ${title}

## 实验目的

${data.objective || ''}

## 实验步骤

${Array.isArray(data.steps) ? data.steps.map((step, index) => `${index + 1}. ${step}`).join('\n') : (data.steps || '')}

## 实验结果

${data.results || ''}

## 观察与现象

${data.observations || ''}

${data.issues ? `## 问题与异常\n\n${data.issues}\n` : ''}

## 下一步计划

${data.nextSteps || ''}

## 实验图片

${sourceImages.length ? this.renderImageLinks(sourceImages) : '（在此粘贴截图，格式：![描述](图片路径)）'}

## 注意事项

${data.notes || ''}
${data.references ? `\n## 参考文献\n\n${data.references}\n` : ''}`;

        return this.app.vault.create(fileName, noteContent);
    }

    private renderImageLinks(paths: string[]): string {
        return paths.map((path, index) => `![实验图片 ${index + 1}](${path})`).join('\n\n');
    }

    private async uniqueMarkdownPath(path: string): Promise<string> {
        if (!this.app.vault.getAbstractFileByPath(path)) return path;
        const withoutExt = path.replace(/\.md$/i, '');
        for (let i = 2; i < 1000; i++) {
            const candidate = `${withoutExt}-${i}.md`;
            if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
        }
        return `${withoutExt}-${Date.now()}.md`;
    }

    private safeFileName(name: string): string {
        return name.replace(/[\\/:*?"<>|#^\[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90) || '实验记录';
    }

    private normalizeDate(value?: string): string {
        const today = new Date().toISOString().split('T')[0]!;
        if (!value) return today;
        const match = String(value).match(/\d{4}-\d{1,2}-\d{1,2}/);
        if (!match) return today;
        const [y, m, d] = match[0].split('-');
        return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
    }

    private researchLearningBody(data: ExperimentData): string {
        if (data.body?.trim()) return data.body.trim();
        if (data.sections && Object.keys(data.sections).length > 0) {
            return Object.entries(data.sections)
                .filter(([, body]) => body.trim())
                .map(([heading, body]) => `## ${heading}\n\n${body.trim()}`)
                .join('\n\n');
        }
        return data.notes?.trim() || data.objective?.trim() || data.results?.trim() || '待补充研究学习内容。';
    }

    private normalizeExperimentTitle(value: string | undefined, date: string, fallback = '图片识别实验记录'): string {
        let title = (value || '').trim()
            .replace(/^#+\s*/, '')
            .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
            .replace(/^(Experiments|实验记录)\s*[\\/]\s*/i, '')
            .replace(new RegExp(`^${this.escapeRegExp(date)}[-_\\s]*`), '')
            .replace(/\.(md|markdown)$/i, '')
            .replace(/\s+/g, ' ')
            .trim();

        if (!title || /^\d+$/.test(title) || title.length < 2) {
            title = fallback;
        }
        return title.slice(0, 60);
    }

    private async uniqueAssetPath(path: string): Promise<string> {
        if (!this.app.vault.getAbstractFileByPath(path)) return path;
        const ext = path.match(/\.[^.]+$/)?.[0] || '';
        const base = ext ? path.slice(0, -ext.length) : path;
        for (let i = 2; i < 1000; i++) {
            const candidate = `${base}-${i}${ext}`;
            if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
        }
        return `${base}-${Date.now()}${ext}`;
    }

    private safeTag(tag: string): string {
        return tag.replace(/[,\[\]\s#]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }

    private asString(value: unknown): string {
        if (value === null || value === undefined) return '';
        if (Array.isArray(value)) return value.map(v => this.asString(v)).filter(Boolean).join('\n');
        return String(value).trim();
    }

    private asStringArray(value: unknown): string[] {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(v => this.asString(v)).filter(Boolean);
        return this.asString(value).split(/\n|,|，|;|；/).map(v => v.trim()).filter(Boolean);
    }

    private yamlQuote(value: string): string {
        return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    onClose() { this.contentEl.empty(); }
}
