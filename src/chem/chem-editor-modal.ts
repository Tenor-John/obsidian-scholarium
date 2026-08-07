import { App, Modal, Notice } from 'obsidian';
import type ChemELNPlugin from '../main';
import { createEmptyChemBlock, type ChemBlock, type ChemBlockType } from './chem-block';
import { getChemStructureSource } from './chem-source';
import { mountKetcher, type KetcherHost } from './ketcher-host';

interface ChemEditorModalOptions {
    block?: ChemBlock;
    type?: ChemBlockType;
    onSave: (block: ChemBlock) => Promise<void> | void;
}

export class ChemEditorModal extends Modal {
    private block: ChemBlock;
    private host: KetcherHost | null = null;
    private saveButton: HTMLButtonElement | null = null;

    constructor(
        app: App,
        private plugin: ChemELNPlugin,
        private options: ChemEditorModalOptions,
    ) {
        super(app);
        this.block = options.block ?? createEmptyChemBlock(options.type ?? 'reaction');
    }

    onOpen(): void {
        this.modalEl.addClass('sch-chem-modal-wrap');
        const { contentEl } = this;
        contentEl.empty();
        this.plugin.applyThemeAttributes(contentEl);

        const shell = contentEl.createDiv({ cls: 'sch-chem-modal' });
        const header = shell.createDiv({ cls: 'sch-chem-modal-header' });
        const titleWrap = header.createDiv();
        titleWrap.createEl('h2', { text: '化学方程编辑器', cls: 'sch-chem-modal-title' });
        titleWrap.createEl('p', { text: '画完后保存，Scholarium 会把可编辑源数据和 SVG 预览一起写回笔记。', cls: 'sch-chem-modal-subtitle' });

        const titleInput = header.createEl('input', {
            cls: 'sch-chem-title-input',
            attr: { type: 'text', placeholder: '标题' },
        });
        titleInput.value = this.block.title;
        titleInput.addEventListener('input', () => {
            this.block.title = titleInput.value.trim() || this.block.title;
        });

        const editorHost = shell.createDiv({ cls: 'sch-chem-ketcher-host' });
        editorHost.createDiv({ text: '正在加载 Ketcher...', cls: 'sch-chem-loading' });

        const footer = shell.createDiv({ cls: 'sch-chem-modal-footer' });
        const status = footer.createDiv({ text: '保存后会自动锁定为 SVG 预览。', cls: 'sch-chem-status' });
        const buttons = footer.createDiv({ cls: 'sch-chem-modal-actions' });
        const cancelButton = buttons.createEl('button', { text: '取消', cls: 'sch-chem-btn' });
        this.saveButton = buttons.createEl('button', { text: '保存并锁定', cls: 'sch-chem-btn sch-chem-btn-primary' });

        cancelButton.onclick = () => this.close();
        this.saveButton.onclick = () => void this.save(status);

        void this.loadKetcher(editorHost, status);
    }

    onClose(): void {
        this.host?.destroy();
        this.host = null;
        this.contentEl.empty();
    }

    private async loadKetcher(editorHost: HTMLElement, status: HTMLElement): Promise<void> {
        try {
            editorHost.empty();
            this.host = await mountKetcher(this.plugin, editorHost, this.block);
            status.setText('Ketcher 已就绪。');
        } catch (error) {
            console.error('[Scholarium] Ketcher failed to load:', error);
            editorHost.empty();
            const fallback = editorHost.createDiv({ cls: 'sch-chem-fallback' });
            fallback.createEl('strong', { text: 'Ketcher 加载失败' });
            fallback.createEl('p', { text: '可以先保存已有 SVG/结构数据；请稍后检查依赖打包情况。' });
            fallback.createEl('code', { text: (error as Error).message });
            const textarea = fallback.createEl('textarea', {
                cls: 'sch-chem-fallback-textarea',
                attr: { placeholder: 'KET / RXN / Molfile / SMILES' },
            });
            textarea.value = getChemStructureSource(this.block);
            textarea.addEventListener('input', () => {
                this.block.ket = textarea.value;
            });
            status.setText('Ketcher 未能加载，当前使用文本回退编辑。');
        }
    }

    private async save(status: HTMLElement): Promise<void> {
        if (this.saveButton) this.saveButton.disabled = true;
        status.setText('正在保存...');
        try {
            const next = this.host ? await this.host.getBlock() : this.block;
            next.title = this.block.title;
            next.locked = true;
            next.updated = new Date().toISOString();
            await this.options.onSave(next);
            new Notice('化学方程已保存');
            this.close();
        } catch (error) {
            console.error('[Scholarium] Failed to save chemical block:', error);
            new Notice(`保存失败：${(error as Error).message}`);
            status.setText('保存失败，请重试。');
        } finally {
            if (this.saveButton) this.saveButton.disabled = false;
        }
    }
}
