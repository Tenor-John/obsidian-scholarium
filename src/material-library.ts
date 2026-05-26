import { App, Modal, Notice, TFile, TFolder } from 'obsidian';
import ChemELNPlugin from './main';
import type { CloudSyncManager } from './cloud-sync';

export interface MaterialItem {
    id: string;
    path: string;       // vault 内文件路径
    name: string;       // 用户命名的显示名称
    category: string;   // 分类名称
    addedAt: string;    // ISO 日期字符串
}

export interface MaterialLibraryData {
    items: MaterialItem[];
    categories: string[];
}

// ───── 文件类型工具 ─────

type FileKind = 'image' | 'spreadsheet' | 'text' | 'pdf' | 'archive' | 'other';

const EXT_MAP: Record<string, FileKind> = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
    svg: 'image', webp: 'image', bmp: 'image', tiff: 'image',
    xlsx: 'spreadsheet', xls: 'spreadsheet', csv: 'spreadsheet',
    ods: 'spreadsheet', tsv: 'spreadsheet',
    pdf: 'pdf',
    txt: 'text', md: 'text', json: 'text', xml: 'text',
    py: 'text', js: 'text', ts: 'text', html: 'text',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
};

const KIND_ICON: Record<FileKind, string> = {
    image: '🖼️',
    spreadsheet: '📊',
    pdf: '📑',
    text: '📄',
    archive: '🗜️',
    other: '📎',
};

const KIND_COLOR: Record<FileKind, string> = {
    image:       '#29B6F6',
    spreadsheet: '#66BB6A',
    pdf:         '#EF5350',
    text:        '#78909C',
    archive:     '#AB47BC',
    other:       '#FF8A65',
};

function getExt(path: string): string {
    return (path.split('.').pop() ?? '').toLowerCase();
}

function getKind(path: string): FileKind {
    return EXT_MAP[getExt(path)] ?? 'other';
}

function kindIcon(path: string): string {
    return KIND_ICON[getKind(path)];
}

function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
}

// ─────────────────────────────────────────────
// 素材库主类
// ─────────────────────────────────────────────
export class MaterialLibrary {
    private data: MaterialLibraryData = { items: [], categories: [] };
    private currentCategory = 'all';
    private searchText = '';
    private viewMode: 'grid' | 'list' = 'grid';
    private filteredItems: MaterialItem[] = [];
    private container: HTMLElement | null = null;
    private syncManager: CloudSyncManager | null = null;

    constructor(private app: App, private plugin: ChemELNPlugin) {}

    setSyncManager(manager: CloudSyncManager): void {
        this.syncManager = manager;
    }

    async load(): Promise<void> {
        try {
            const pluginData = await this.plugin.loadData() as Record<string, unknown> | null;
            if (pluginData?.materialLibrary) {
                const d = pluginData.materialLibrary as MaterialLibraryData;
                this.data = { items: d.items || [], categories: d.categories || [] };
            } else {
                this.data = { items: [], categories: [] };
            }
        } catch (e) {
            console.error('[MaterialLibrary] 加载失败:', e);
            this.data = { items: [], categories: [] };
        }
    }

    async save(): Promise<void> {
        try {
            await this.plugin.updateData((pluginData) => {
                pluginData.materialLibrary = this.data;
            });
        } catch (e) {
            console.error('[MaterialLibrary] 保存失败:', e);
        }
    }

    // ── 重新渲染整体（保留容器引用）──
    private rerender(): void {
        if (this.container) this.render(this.container);
    }

    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        container.addClass('mat-root');

        // ── 公开版 Hero（标题 + 统计药丸） ──
        const hero = container.createDiv({ cls: 'xl-hero' });
        const heroRow = hero.createDiv({ cls: 'xl-hero-row' });
        const heroLeft = heroRow.createDiv();
        heroLeft.createEl('h2', { text: '🗂️ 素材库', cls: 'xl-hero-title' });
        heroLeft.createEl('div', { text: '集中管理 PDF / 图片 / 协议文件，随云端同步', cls: 'xl-hero-sub' });
        const chips = heroRow.createDiv({ cls: 'xl-hero-chips' });
        const totalCount = this.data.items.length;
        const imgCount = this.data.items.filter(it => getKind(it.path) === 'image').length;
        const pdfCount = this.data.items.filter(it => getKind(it.path) === 'pdf').length;
        const totalChip = chips.createSpan({ cls: 'xl-stat-chip accent' });
        totalChip.createSpan({ text: '📦 共 ' });
        totalChip.createSpan({ text: String(totalCount), cls: 'xl-stat-chip-num' });
        totalChip.createSpan({ text: ' 项' });
        const imgChip = chips.createSpan({ cls: 'xl-stat-chip' });
        imgChip.createSpan({ text: '🖼 ' });
        imgChip.createSpan({ text: String(imgCount), cls: 'xl-stat-chip-num' });
        const pdfChip = chips.createSpan({ cls: 'xl-stat-chip' });
        pdfChip.createSpan({ text: '📄 ' });
        pdfChip.createSpan({ text: String(pdfCount), cls: 'xl-stat-chip-num' });

        // ── 顶部工具栏 ──
        const toolbar = container.createDiv({ cls: 'mat-toolbar' });
        const searchWrap = toolbar.createDiv({ cls: 'mat-search-wrap' });
        const searchInput = searchWrap.createEl('input', {
            cls: 'mat-search-input',
            attr: { placeholder: '🔍 搜索名称、分类…', type: 'text' }
        });
        searchInput.value = this.searchText;

        const viewToggle = toolbar.createDiv({ cls: 'mat-view-toggle' });
        const gridBtn = viewToggle.createEl('button', { text: '⊞', cls: 'mat-view-btn' });
        const listBtn = viewToggle.createEl('button', { text: '☰', cls: 'mat-view-btn' });
        if (this.viewMode === 'grid') gridBtn.addClass('active');
        else listBtn.addClass('active');

        gridBtn.onclick = () => {
            this.viewMode = 'grid';
            gridBtn.addClass('active'); listBtn.removeClass('active');
            this.renderGallery(galleryArea);
        };
        listBtn.onclick = () => {
            this.viewMode = 'list';
            listBtn.addClass('active'); gridBtn.removeClass('active');
            this.renderGallery(galleryArea);
        };

        // 云同步按钮（仅在配置了云存储时显示）
        if (this.plugin.settings.cloudProvider !== 'none') {
            const syncBtn = toolbar.createEl('button', { text: '☁️ 同步', cls: 'mat-sync-btn' });
            syncBtn.onclick = async () => {
                syncBtn.textContent = '⏳ 同步中…';
                syncBtn.disabled = true;
                const result = await this.syncManager?.fullSync();
                syncBtn.disabled = false;
                if (result?.success) {
                    syncBtn.textContent = `✅ ${result.uploaded}↑ ${result.downloaded}↓`;
                    setTimeout(() => { syncBtn.textContent = '☁️ 同步'; }, 3000);
                } else {
                    syncBtn.textContent = '❌ 失败';
                    setTimeout(() => { syncBtn.textContent = '☁️ 同步'; }, 3000);
                }
            };
        }

        // ── 主体 ──
        const main = container.createDiv({ cls: 'mat-main' });
        const sidebar = main.createDiv({ cls: 'mat-sidebar' });
        const galleryArea = main.createDiv({ cls: 'mat-gallery' });

        // 搜索事件（延迟到 galleryArea 创建后）
        searchInput.addEventListener('input', () => {
            this.searchText = searchInput.value;
            this.renderGallery(galleryArea);
        });

        this.renderSidebar(sidebar, galleryArea);
        this.renderGallery(galleryArea);
    }

    // ── 左侧分类栏 ──
    private renderSidebar(sidebar: HTMLElement, galleryArea: HTMLElement): void {
        sidebar.empty();

        const makeItem = (label: string, value: string, count: number) => {
            const el = sidebar.createDiv({ cls: 'mat-sidebar-item' });
            if (this.currentCategory === value) el.addClass('active');
            const icon = el.createEl('span', { text: label.startsWith('📁') ? '📁' : label.slice(0, 2), cls: 'mat-sidebar-icon' });
            const txt  = el.createEl('span', { text: label.replace(/^📁\s*/, ''), cls: 'mat-sidebar-label' });
            const badge = el.createEl('span', { text: String(count), cls: 'mat-sidebar-count' });
            el.onclick = () => {
                sidebar.querySelectorAll('.mat-sidebar-item').forEach(e => e.removeClass('active'));
                el.addClass('active');
                this.currentCategory = value;
                this.renderGallery(galleryArea);
            };
            return el;
        };

        // 全部
        makeItem('📁 全部', 'all', this.data.items.length);

        // 用户分类
        for (const cat of this.data.categories) {
            const count = this.data.items.filter(i => i.category === cat).length;
            const el = makeItem(`📁 ${cat}`, cat, count);
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showCategoryMenu(el, cat, sidebar, galleryArea);
            });
        }

        // 未分类
        const uncatCount = this.data.items.filter(i => !i.category).length;
        if (uncatCount > 0) {
            makeItem('📁 未分类', '__uncategorized__', uncatCount);
        }

        sidebar.createDiv({ cls: 'mat-sidebar-divider' });
        const addBtn = sidebar.createEl('button', { text: '＋ 新建分类', cls: 'mat-sidebar-add' });
        addBtn.onclick = () => this.showNewCategoryDialog(sidebar, galleryArea);
    }

    // ── 画廊 ──
    private renderGallery(container: HTMLElement): void {
        container.empty();
        container.addClass('mat-gallery');

        // 过滤
        let filtered = this.data.items.slice();
        if (this.currentCategory !== 'all') {
            if (this.currentCategory === '__uncategorized__') {
                filtered = filtered.filter(i => !i.category);
            } else {
                filtered = filtered.filter(i => i.category === this.currentCategory);
            }
        }
        if (this.searchText) {
            const q = this.searchText.toLowerCase();
            filtered = filtered.filter(i =>
                i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
        }
        this.filteredItems = filtered;

        // 设置拖拽（总是挂载，无论是否有内容）
        this.setupDragDrop(container);

        if (filtered.length === 0) {
            const empty = container.createDiv({ cls: 'mat-empty' });
            empty.createEl('div', { cls: 'mat-empty-icon', text: '📂' });
            empty.createEl('p', { text: '将文件拖入此处' });
            empty.createEl('p', { cls: 'mat-empty-hint', text: '支持图片、CSV、Excel、TXT、PDF 等所有格式' });
            return;
        }

        const grid = container.createDiv({
            cls: `mat-grid ${this.viewMode === 'grid' ? 'mat-grid-mode' : 'mat-list-mode'}`
        });
        for (const item of filtered) {
            this.createCard(grid, item);
        }
    }

    // ── 卡片（图片 or 文件图标）──
    private createCard(gallery: HTMLElement, item: MaterialItem): void {
        const card = gallery.createDiv({ cls: 'mat-card' });
        const kind = getKind(item.path);
        const vaultFile = this.app.vault.getAbstractFileByPath(item.path);

        // ── 缩略图区域 ──
        const thumb = card.createDiv({ cls: 'mat-card-thumb' });

        if (kind === 'image' && vaultFile instanceof TFile) {
            const src = this.app.vault.getResourcePath(vaultFile);
            thumb.createEl('img', { cls: 'mat-card-img', attr: { src, alt: item.name } });
        } else {
            // 非图片：大图标 + 扩展名
            thumb.addClass('mat-card-file-thumb');
            thumb.style.setProperty('--kind-color', KIND_COLOR[kind]);
            thumb.createEl('div', { text: kindIcon(item.path), cls: 'mat-card-file-icon' });
            thumb.createEl('div', { text: getExt(item.path).toUpperCase(), cls: 'mat-card-file-ext' });
        }

        // ── 悬停遮罩 ──
        const overlay = thumb.createDiv({ cls: 'mat-card-overlay' });
        const actions = overlay.createDiv({ cls: 'mat-card-actions' });

        // 预览/打开
        const zoomBtn = actions.createEl('button', {
            text: kind === 'image' ? '🔍' : '📂',
            cls: 'mat-action-btn',
            attr: { title: kind === 'image' ? '放大预览' : '在 Obsidian 中打开' }
        });
        zoomBtn.onclick = (e) => {
            e.stopPropagation();
            if (kind === 'image') {
                const idx = this.filteredItems.indexOf(item);
                this.showLightbox(this.filteredItems, idx);
            } else if (vaultFile instanceof TFile) {
                this.app.workspace.getLeaf(false).openFile(vaultFile);
            }
        };

        const renameBtn = actions.createEl('button', { text: '✏️', cls: 'mat-action-btn', attr: { title: '改名' } });
        renameBtn.onclick = (e) => { e.stopPropagation(); this.showRenameDialog(item); };

        const moveBtn = actions.createEl('button', { text: '📁', cls: 'mat-action-btn', attr: { title: '移动分类' } });
        moveBtn.onclick = (e) => { e.stopPropagation(); this.showMoveCategoryDialog(item); };

        const delBtn = actions.createEl('button', { text: '🗑️', cls: 'mat-action-btn', attr: { title: '删除' } });
        delBtn.onclick = (e) => { e.stopPropagation(); this.deleteItem(item); };

        // ── 底部信息 ──
        const info = card.createDiv({ cls: 'mat-card-info' });
        info.createEl('div', { text: item.name, cls: 'mat-card-name', attr: { title: item.name } });
        if (item.category) {
            const badge = info.createEl('span', { text: item.category, cls: 'mat-badge' });
            badge.style.background = this.catColor(item.category);
        }
    }

    // ── 拖拽 ──
    private setupDragDrop(container: HTMLElement): void {
        let dragCounter = 0;

        container.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragCounter++;
            container.addClass('mat-drag-over');
        });
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });
        container.addEventListener('dragleave', () => {
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                container.removeClass('mat-drag-over');
            }
        });
        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            container.removeClass('mat-drag-over');
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length === 0) return;
            for (const file of files) {
                await this.handleDroppedFile(file);
            }
        });
    }

    private async handleDroppedFile(file: File): Promise<void> {
        try {
            // 确保 Materials 文件夹存在
            if (!(this.app.vault.getAbstractFileByPath('Materials') instanceof TFolder)) {
                await this.app.vault.createFolder('Materials');
            }

            const buf = await file.arrayBuffer();

            // 防重名
            let targetPath = `Materials/${file.name}`;
            let counter = 1;
            while (this.app.vault.getAbstractFileByPath(targetPath)) {
                const dot = file.name.lastIndexOf('.');
                const base = dot >= 0 ? file.name.slice(0, dot) : file.name;
                const ext  = dot >= 0 ? file.name.slice(dot) : '';
                targetPath = `Materials/${base}_${counter}${ext}`;
                counter++;
            }

            await this.app.vault.createBinary(targetPath, buf);

            // 自动同步到云盘（如果启用）
            if (this.syncManager && this.plugin.settings.cloudAutoSync) {
                this.syncManager.uploadFile(targetPath).catch(e => console.warn('[CloudSync]', e));
            }

            this.showAddDialog(file, targetPath);
        } catch (e) {
            console.error('[MaterialLibrary] 上传失败:', e);
            new Notice('❌ 文件上传失败：' + (e as Error).message);
        }
    }

    // ── 对话框 ──
    private showAddDialog(file: File, path: string): void {
        new MaterialAddModal(this.app, file, path, this.data, async (item) => {
            this.data.items.push(item);
            if (item.category && !this.data.categories.includes(item.category)) {
                this.data.categories.push(item.category);
            }
            await this.save();
            new Notice('✅ 素材已添加');
            this.rerender();
        }).open();
    }

    private showRenameDialog(item: MaterialItem): void {
        new MaterialRenameModal(this.app, item, async (newName) => {
            item.name = newName;
            await this.save();
            this.rerender();
        }).open();
    }

    private showMoveCategoryDialog(item: MaterialItem): void {
        new MaterialMoveCategoryModal(this.app, item, this.data.categories, async (newCat) => {
            item.category = newCat;
            await this.save();
            this.rerender();
        }).open();
    }

    private showNewCategoryDialog(sidebar?: HTMLElement, galleryArea?: HTMLElement): void {
        new MaterialNewCategoryModal(this.app, this.data.categories, async (name) => {
            if (!this.data.categories.includes(name)) {
                this.data.categories.push(name);
                await this.save();
                this.rerender();
            }
        }).open();
    }

    private showCategoryMenu(el: HTMLElement, cat: string, sidebar: HTMLElement, galleryArea: HTMLElement): void {
        document.querySelectorAll('.mat-ctx-menu').forEach(m => m.remove());

        const menu = document.body.createDiv({ cls: 'mat-ctx-menu' });
        const rect = el.getBoundingClientRect();
        menu.style.cssText = `position:fixed;left:${rect.right + 4}px;top:${rect.top}px;`;

        menu.createEl('div', { text: '✏️ 重命名', cls: 'mat-ctx-item' }).onclick = () => {
            menu.remove();
            new MaterialRenameCategoryModal(this.app, cat, this.data.categories, async (newName) => {
                this.data.items.forEach(i => { if (i.category === cat) i.category = newName; });
                const idx = this.data.categories.indexOf(cat);
                if (idx >= 0) this.data.categories[idx] = newName;
                if (this.currentCategory === cat) this.currentCategory = newName;
                await this.save();
                this.rerender();
            }).open();
        };

        menu.createEl('div', { text: '🗑️ 删除', cls: 'mat-ctx-item mat-ctx-danger' }).onclick = () => {
            menu.remove();
            if (!confirm(`删除分类「${cat}」？该分类下的素材将变为未分类。`)) return;
            this.data.items.forEach(i => { if (i.category === cat) i.category = ''; });
            this.data.categories = this.data.categories.filter(c => c !== cat);
            if (this.currentCategory === cat) this.currentCategory = 'all';
            this.save().then(() => this.rerender());
        };

        const closeMenu = (e: MouseEvent) => {
            if (!menu.contains(e.target as Node)) {
                menu.remove();
                document.removeEventListener('mousedown', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
    }

    private deleteItem(item: MaterialItem): void {
        if (!confirm(`确认删除素材「${item.name}」？`)) return;
        const vf = this.app.vault.getAbstractFileByPath(item.path);
        if (vf instanceof TFile) this.app.vault.delete(vf);
        this.data.items = this.data.items.filter(i => i !== item);
        this.save().then(() => this.rerender());
    }

    private showLightbox(items: MaterialItem[], index: number): void {
        // 只对图片列表过滤
        const imgItems = items.filter(i => getKind(i.path) === 'image');
        const clicked = items[index];
        const imgIdx = clicked ? imgItems.indexOf(clicked) : 0;
        new MaterialLightboxModal(this.app, imgItems, Math.max(0, imgIdx)).open();
    }

    private catColor(cat: string): string {
        const colors = ['#FF7043','#FF8A65','#66BB6A','#4DB6AC','#29B6F6','#42A5F5','#AB47BC','#EC407A'];
        let h = 0;
        for (let i = 0; i < cat.length; i++) { h = ((h << 5) - h) + cat.charCodeAt(i); h |= 0; }
        return colors[Math.abs(h) % colors.length] ?? '#FF7043';
    }

    destroy(): void {
        document.querySelectorAll('.mat-ctx-menu').forEach(m => m.remove());
    }
}

// ─────────────────────────────────────────────
// 添加素材 Modal
// ─────────────────────────────────────────────
class MaterialAddModal extends Modal {
    constructor(
        app: App,
        private file: File,
        private path: string,
        private data: MaterialLibraryData,
        private onConfirm: (item: MaterialItem) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('mat-modal');
        contentEl.createEl('h2', { text: '添加素材', cls: 'mat-modal-title' });

        // ── 预览区 ──
        const preview = contentEl.createDiv({ cls: 'mat-modal-preview' });
        const kind = getKind(this.path);
        if (kind === 'image') {
            const url = URL.createObjectURL(this.file);
            preview.createEl('img', { cls: 'mat-modal-img', attr: { src: url, alt: this.file.name } });
            // 释放 object URL（延迟，等图片加载完成）
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } else {
            preview.addClass('mat-modal-file-preview');
            preview.style.setProperty('--kind-color', KIND_COLOR[kind]);
            preview.createEl('div', { text: kindIcon(this.path), cls: 'mat-modal-file-icon' });
            preview.createEl('div', { text: this.file.name, cls: 'mat-modal-file-label' });
            const sizeKB = (this.file.size / 1024).toFixed(1);
            preview.createEl('div', { text: `${getExt(this.path).toUpperCase()} · ${sizeKB} KB`, cls: 'mat-modal-file-size' });
        }

        // ── 名称 ──
        contentEl.createEl('label', { text: '名称', cls: 'mat-modal-label' });
        const nameInput = contentEl.createEl('input', {
            cls: 'mat-modal-input',
            attr: { type: 'text', placeholder: '素材名称' }
        });
        const dot = this.file.name.lastIndexOf('.');
        nameInput.value = dot >= 0 ? this.file.name.slice(0, dot) : this.file.name;

        // ── 分类 ──
        contentEl.createEl('label', { text: '分类', cls: 'mat-modal-label' });
        const catSelect = contentEl.createEl('select', { cls: 'mat-modal-select' });
        catSelect.createEl('option', { text: '未分类', attr: { value: '' } }).selected = true;
        for (const c of this.data.categories) {
            catSelect.createEl('option', { text: c, attr: { value: c } });
        }
        catSelect.createEl('option', { text: '＋ 新建分类…', attr: { value: '__new__' } });

        // ── 新建分类输入框（独立 wrapper，默认隐藏）──
        const newCatWrap = contentEl.createDiv({ cls: 'mat-modal-newcat-wrap' });
        newCatWrap.style.display = 'none';
        newCatWrap.createEl('label', { text: '新分类名称', cls: 'mat-modal-label' });
        const newCatInput = newCatWrap.createEl('input', {
            cls: 'mat-modal-input',
            attr: { type: 'text', placeholder: '输入新分类名称' }
        });

        catSelect.addEventListener('change', () => {
            newCatWrap.style.display = catSelect.value === '__new__' ? 'block' : 'none';
            if (catSelect.value === '__new__') newCatInput.focus();
        });

        // ── 按钮 ──
        const btnRow = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        btnRow.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        const okBtn = btnRow.createEl('button', { text: '确认添加', cls: 'mat-modal-btn mat-modal-btn-primary' });
        okBtn.onclick = () => {
            const name = nameInput.value.trim() || this.file.name;
            let category = catSelect.value;
            if (category === '__new__') {
                category = newCatInput.value.trim();
                if (!category) { new Notice('❌ 请输入分类名称'); return; }
            }
            this.onConfirm({ id: generateId(), path: this.path, name, category, addedAt: new Date().toISOString() });
            this.close();
        };

        // 回车确认
        contentEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) okBtn.click(); });
    }

    onClose(): void { this.contentEl.empty(); }
}

// ─────────────────────────────────────────────
// 重命名素材 Modal
// ─────────────────────────────────────────────
class MaterialRenameModal extends Modal {
    constructor(app: App, private item: MaterialItem, private onConfirm: (name: string) => void) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('mat-modal');
        contentEl.createEl('h2', { text: '重命名素材', cls: 'mat-modal-title' });
        const input = contentEl.createEl('input', { cls: 'mat-modal-input', attr: { type: 'text' } });
        input.value = this.item.name;
        const btnRow = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        btnRow.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        const ok = btnRow.createEl('button', { text: '确认', cls: 'mat-modal-btn mat-modal-btn-primary' });
        ok.onclick = () => { const v = input.value.trim(); if (v) { this.onConfirm(v); this.close(); } };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
        setTimeout(() => { input.select(); }, 50);
    }
    onClose(): void { this.contentEl.empty(); }
}

// ─────────────────────────────────────────────
// 移动分类 Modal
// ─────────────────────────────────────────────
class MaterialMoveCategoryModal extends Modal {
    constructor(
        app: App,
        private item: MaterialItem,
        private categories: string[],
        private onConfirm: (cat: string) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('mat-modal');
        contentEl.createEl('h2', { text: '移动分类', cls: 'mat-modal-title' });
        contentEl.createEl('p', { text: `素材：${this.item.name}`, cls: 'mat-modal-sub' });
        const sel = contentEl.createEl('select', { cls: 'mat-modal-select' });
        sel.createEl('option', { text: '未分类', attr: { value: '' } }).selected = !this.item.category;
        for (const c of this.categories) {
            const opt = sel.createEl('option', { text: c, attr: { value: c } });
            if (c === this.item.category) opt.selected = true;
        }
        const btnRow = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        btnRow.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        btnRow.createEl('button', { text: '确认', cls: 'mat-modal-btn mat-modal-btn-primary' }).onclick = () => {
            this.onConfirm(sel.value); this.close();
        };
    }
    onClose(): void { this.contentEl.empty(); }
}

// ─────────────────────────────────────────────
// 新建分类 Modal
// ─────────────────────────────────────────────
class MaterialNewCategoryModal extends Modal {
    constructor(app: App, private categories: string[], private onConfirm: (name: string) => void) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('mat-modal');
        contentEl.createEl('h2', { text: '新建分类', cls: 'mat-modal-title' });
        const input = contentEl.createEl('input', { cls: 'mat-modal-input', attr: { type: 'text', placeholder: '分类名称' } });
        const btnRow = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        btnRow.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        const ok = btnRow.createEl('button', { text: '确认', cls: 'mat-modal-btn mat-modal-btn-primary' });
        ok.onclick = () => {
            const name = input.value.trim();
            if (!name) { new Notice('❌ 请输入分类名称'); return; }
            if (this.categories.includes(name)) { new Notice('❌ 分类已存在'); return; }
            this.onConfirm(name); this.close();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
        setTimeout(() => input.focus(), 50);
    }
    onClose(): void { this.contentEl.empty(); }
}

// ─────────────────────────────────────────────
// 重命名分类 Modal
// ─────────────────────────────────────────────
class MaterialRenameCategoryModal extends Modal {
    constructor(
        app: App,
        private oldName: string,
        private categories: string[],
        private onConfirm: (name: string) => void
    ) { super(app); }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.addClass('mat-modal');
        contentEl.createEl('h2', { text: '重命名分类', cls: 'mat-modal-title' });
        const input = contentEl.createEl('input', { cls: 'mat-modal-input', attr: { type: 'text' } });
        input.value = this.oldName;
        const btnRow = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        btnRow.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        const ok = btnRow.createEl('button', { text: '确认', cls: 'mat-modal-btn mat-modal-btn-primary' });
        ok.onclick = () => {
            const name = input.value.trim();
            if (!name) { new Notice('❌ 请输入名称'); return; }
            if (name !== this.oldName && this.categories.includes(name)) { new Notice('❌ 分类已存在'); return; }
            this.onConfirm(name); this.close();
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
        setTimeout(() => { input.select(); }, 50);
    }
    onClose(): void { this.contentEl.empty(); }
}

// ─────────────────────────────────────────────
// 灯箱 Modal（仅图片）
// ─────────────────────────────────────────────
class MaterialLightboxModal extends Modal {
    private idx: number;
    private lbImg: HTMLImageElement | null = null;
    private lbTitle: HTMLElement | null = null;
    private lbMeta: HTMLElement | null = null;

    constructor(app: App, private items: MaterialItem[], startIdx: number) {
        super(app);
        this.idx = startIdx;
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        modalEl.addClass('mat-lightbox-modal-wrap');
        contentEl.addClass('mat-lightbox-modal');

        // 关闭按钮
        const closeBtn = contentEl.createEl('button', { text: '✕', cls: 'mat-lb-close' });
        closeBtn.onclick = () => this.close();

        // 计数
        const counter = contentEl.createEl('div', { cls: 'mat-lb-counter' });

        // 图片
        this.lbImg = contentEl.createEl('img', { cls: 'mat-lb-img' });

        // 标题 + 信息
        this.lbTitle = contentEl.createEl('div', { cls: 'mat-lb-title' });
        this.lbMeta  = contentEl.createEl('div', { cls: 'mat-lb-meta' });

        // 导航
        if (this.items.length > 1) {
            const prev = contentEl.createEl('button', { text: '◀', cls: 'mat-lb-nav mat-lb-prev' });
            const next = contentEl.createEl('button', { text: '▶', cls: 'mat-lb-nav mat-lb-next' });
            prev.onclick = () => { this.idx = (this.idx - 1 + this.items.length) % this.items.length; this.refresh(); };
            next.onclick = () => { this.idx = (this.idx + 1) % this.items.length; this.refresh(); };
        }
    }

    private refresh(): void {
        const it = this.items[this.idx];
        if (!it || !this.lbImg || !this.lbTitle || !this.lbMeta) return;
        this.lbImg.setAttribute('src', (it as any).src || '');
        this.lbTitle.setText(it.name || '');
        this.lbMeta.setText('');
    }

    onClose() { this.contentEl.empty(); }
}
