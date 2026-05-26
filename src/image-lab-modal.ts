import { App, Modal, Notice, TFile } from 'obsidian';
import ChemELNPlugin from './main';
import { extractTextWithMinerU } from './vision-ocr';
import { rewriteOcrToAgent, type VisionAgentAction, type WritingProvider } from './vision-writer';

export class ImageLabModal extends Modal {
    private selectedFile: File | null = null;
    private previewEl!: HTMLElement;
    private statusEl!: HTMLElement;
    private analyzeBtn!: HTMLButtonElement;

    constructor(app: App, private plugin: ChemELNPlugin) {
        super(app);
        this.modalEl.addClass('scholarium-chat-modal-wrap');
        this.plugin.applyThemeAttributes(this.modalEl);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('scholarium-chat-modal');
        contentEl.addClass('image-lab-modal');

        contentEl.createEl('h2', { text: '拍照识别实验记录', cls: 'chat-title' });
        contentEl.createEl('p', {
            text: '上传或拖入手写记录、实验台照片、仪器截图。插件会先用 MinerU 提取文字，再用 AI 重写为实验记录。',
            cls: 'chat-subtitle',
        });

        const drop = contentEl.createDiv({ cls: 'image-lab-drop' });
        drop.createEl('div', { text: '选择图片或拖拽到这里', cls: 'image-lab-drop-title' });
        drop.createEl('div', { text: '支持 PNG / JPG / WEBP', cls: 'image-lab-drop-sub' });
        const fileInput = drop.createEl('input', {
            cls: 'image-lab-file',
            attr: { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp' },
        }) as HTMLInputElement;
        fileInput.onchange = () => {
            const file = fileInput.files?.[0];
            if (file) this.setSelectedFile(file);
        };

        drop.addEventListener('dragover', (event) => {
            event.preventDefault();
            drop.addClass('is-dragging');
        });
        drop.addEventListener('dragleave', () => drop.removeClass('is-dragging'));
        drop.addEventListener('drop', (event) => {
            event.preventDefault();
            drop.removeClass('is-dragging');
            const file = event.dataTransfer?.files?.[0];
            if (file) this.setSelectedFile(file);
        });

        this.previewEl = contentEl.createDiv({ cls: 'image-lab-preview' });
        this.statusEl = contentEl.createDiv({ cls: 'image-lab-status' });
        this.setStatus('等待选择图片。');

        const row = contentEl.createDiv({ cls: 'chat-btn-row' });
        row.createEl('button', { text: '取消', cls: 'scholarium-btn' }).onclick = () => this.close();
        this.analyzeBtn = row.createEl('button', { text: '识别并生成笔记', cls: 'scholarium-btn primary' });
        this.analyzeBtn.onclick = () => void this.runAnalysis();
    }

    private setSelectedFile(file: File) {
        if (!file.type.startsWith('image/')) {
            new Notice('请选择图片文件');
            return;
        }
        this.selectedFile = file;
        this.previewEl.empty();
        const url = URL.createObjectURL(file);
        this.previewEl.createEl('img', { attr: { src: url, alt: file.name } });
        this.previewEl.createEl('div', { text: `${file.name} · ${Math.round(file.size / 1024)} KB`, cls: 'image-lab-file-info' });
        this.setStatus('图片已就绪。');
    }

    private async runAnalysis() {
        if (!this.selectedFile) {
            new Notice('请先选择一张图片');
            return;
        }

        this.analyzeBtn.disabled = true;
        try {
            const base64 = await this.fileToBase64(this.selectedFile);
            const imagePath = await this.saveImageToVault(this.selectedFile);

            this.setStatus('阶段 1/2：MinerU 正在提取文字...');
            this.analyzeBtn.setText('OCR 识别中...');
            const ocrResult = await extractTextWithMinerU(
                base64,
                this.selectedFile.type || 'image/png',
                this.plugin.settings.mineruApiKey,
                this.selectedFile.name,
            );

            this.setStatus('阶段 2/2：AI 正在整理实验记录...');
            this.analyzeBtn.setText('AI 重写中...');
            const provider = this.plugin.settings.writingProvider as WritingProvider;
            const apiKey = this.plugin.settings.writingApiKey || (
                provider === 'deepseek' ? this.plugin.settings.aiApiKey : ''
            );
            const action = await rewriteOcrToAgent(ocrResult, {
                provider,
                apiKey,
                model: this.plugin.settings.writingModel || undefined,
                customEndpoint: this.plugin.settings.writingCustomEndpoint || undefined,
            });

            action.data.source_image = imagePath;
            action.data.tags = Array.from(new Set([
                ...this.asStringArray(action.data.tags),
                'from-image',
            ]));

            this.setStatus('写入实验记录本...');
            this.analyzeBtn.setText('写入中...');
            const file = await this.executeAgent(action);

            new Notice('实验记录已创建');
            this.close();
            await this.app.workspace.getLeaf(false).openFile(file);
        } catch (err) {
            this.setStatus((err as Error).message, true);
            this.analyzeBtn.disabled = false;
            this.analyzeBtn.setText('识别并生成笔记');
        }
    }

    private async executeAgent(action: VisionAgentAction): Promise<TFile> {
        if (action.type !== 'create_experiment') {
            throw new Error('图片识别首版仅支持创建新实验记录');
        }

        const data = action.data;
        const folder = this.plugin.settings.experimentsFolder?.replace(/\/+$/, '') || 'Experiments';
        if (!this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }

        const date = this.normalizeDate(this.asString(data.date));
        const title = this.normalizeExperimentTitle(this.asString(data.title), date);
        const path = await this.uniqueMarkdownPath(`${folder}/${this.safeFileName(`${date}-${title}`)}.md`);
        const reagents = this.asStringArray(data.reagents);
        const steps = this.asStringArray(data.steps);
        const tags = this.asStringArray(data.tags);
        const sourceImage = this.asString(data.source_image);

        const content = `---
type: experiment
title: ${this.yamlQuote(title)}
date: ${this.yamlQuote(date)}
status: ${this.yamlQuote(this.asString(data.status) || 'in-progress')}
smiles: ""
reaction_smiles: ${this.yamlQuote(this.asString(data.reaction_smiles))}
catalyst: ${this.yamlQuote(this.asString(data.catalyst))}
reagents:
${reagents.length ? reagents.map(r => `  - ${r}`).join('\n') : '  - '}
results: ${this.yamlQuote(this.asString(data.results))}
source_image: ${this.yamlQuote(sourceImage)}
tags: [experiment${tags.length ? `, ${tags.map(t => this.safeTag(t)).filter(Boolean).join(', ')}` : ''}]
---

# ${title}

## 实验目的

${this.asString(data.objective)}

## 实验步骤

${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## 实验结果

${this.asString(data.results)}

## 观察与现象

${this.asString(data.observations)}

## 问题与异常

${this.asString(data.issues)}

## 实验图片

${sourceImage ? `![[${sourceImage}]]` : ''}

## 注意事项

${this.asString(data.notes)}
`;

        return this.app.vault.create(path, content);
    }

    private async saveImageToVault(file: File): Promise<string> {
        const folder = `${this.plugin.settings.experimentsFolder?.replace(/\/+$/, '') || 'Experiments'}/Images`;
        if (!this.app.vault.getAbstractFileByPath(folder)) {
            await this.app.vault.createFolder(folder);
        }

        const ext = file.name.match(/\.[^.]+$/)?.[0] || '.png';
        const base = this.safeFileName(file.name.replace(/\.[^.]+$/, '')) || 'image';
        const path = await this.uniquePath(`${folder}/${new Date().toISOString().slice(0, 10)}-${base}${ext}`);
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

    private async uniquePath(path: string): Promise<string> {
        if (!this.app.vault.getAbstractFileByPath(path)) return path;
        const ext = path.match(/\.[^.]+$/)?.[0] || '';
        const base = ext ? path.slice(0, -ext.length) : path;
        for (let i = 2; i < 1000; i++) {
            const candidate = `${base}-${i}${ext}`;
            if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
        }
        return `${base}-${Date.now()}${ext}`;
    }

    private async uniqueMarkdownPath(path: string): Promise<string> {
        return this.uniquePath(path.endsWith('.md') ? path : `${path}.md`);
    }

    private setStatus(message: string, isError = false) {
        if (!this.statusEl) return;
        this.statusEl.setText(message);
        this.statusEl.toggleClass('is-error', isError);
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

    private safeFileName(name: string): string {
        return name.replace(/[\\/:*?"<>|#^\[\]]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90);
    }

    private normalizeDate(value?: string): string {
        const today = new Date().toISOString().split('T')[0]!;
        if (!value) return today;
        const match = String(value).match(/\d{4}-\d{1,2}-\d{1,2}/);
        if (!match) return today;
        const [y, m, d] = match[0].split('-');
        return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
    }

    private normalizeExperimentTitle(value: string | undefined, date: string): string {
        let title = (value || '').trim()
            .replace(/^#+\s*/, '')
            .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
            .replace(/^(Experiments|实验记录)\s*[\\/]\s*/i, '')
            .replace(new RegExp(`^${this.escapeRegExp(date)}[-_\\s]*`), '')
            .replace(/\.(md|markdown)$/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (!title || /^\d+$/.test(title) || title.length < 2) title = '图片识别实验记录';
        return title.slice(0, 60);
    }

    private escapeRegExp(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private safeTag(tag: string): string {
        return tag.replace(/[,\[\]\s#]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }

    private yamlQuote(value: string): string {
        return `"${this.asString(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }

    onClose() {
        this.contentEl.empty();
    }
}
