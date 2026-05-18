import { App, Modal, Notice } from 'obsidian';
import ChemELNPlugin from './main';
import { DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS } from './settings';
import { EMOJI_GROUPS, searchEmojis } from './emoji-data';

export interface ResearchToolItem {
    id: string;
    name: string;
    url: string;
    icon: string;
    category: string;
    description: string;
    addedAt: string;
}

export interface ResearchToolLibraryData {
    items: ResearchToolItem[];
    categories: string[];
}

const DEFAULT_CATEGORIES = ['学校服务', '开发工具', '文献获取', 'AI 助手', '数据分析', '绘图制图', '数据库', '论文写作'];

function generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function normalizeUrl(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
}

function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
        return false;
    }
}

function hostLabel(value: string): string {
    try {
        return new URL(value).hostname.replace(/^www\./, '');
    } catch {
        return value;
    }
}

export class ResearchToolLibrary {
    private data: ResearchToolLibraryData = { items: [], categories: DEFAULT_CATEGORIES.slice() };
    private searchText = '';
    private container: HTMLElement | null = null;
    private gridEl: HTMLElement | null = null;
    private navEl: HTMLElement | null = null;
    private navListEl: HTMLElement | null = null;

    constructor(private app: App, private plugin: ChemELNPlugin) {}

    async load(): Promise<void> {
        try {
            const pluginData = await this.plugin.loadData() as Record<string, unknown> | null;
            const raw = pluginData?.researchToolLibrary as Partial<ResearchToolLibraryData> | undefined;
            const categories = Array.from(new Set([...(raw?.categories || []), ...DEFAULT_CATEGORIES]));
            this.data = {
                items: raw?.items || [],
                categories,
            };
        } catch (e) {
            console.error('[ResearchToolLibrary] 加载失败:', e);
            this.data = { items: [], categories: DEFAULT_CATEGORIES.slice() };
        }
    }

    async save(): Promise<void> {
        try {
            const pluginData = ((await this.plugin.loadData()) as Record<string, unknown>) || {};
            pluginData.researchToolLibrary = this.data;
            await this.plugin.saveData(pluginData);
        } catch (e) {
            console.error('[ResearchToolLibrary] 保存失败:', e);
            new Notice('科研库保存失败：' + (e as Error).message);
        }
    }

    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        container.addClass('rtl-root');

        // 标题栏：保持文档流，正常随页面滚动。
        const hero = container.createDiv({ cls: 'rtl-hero' });
        hero.createEl('h2', { text: '学术工具库 | Tools', cls: 'rtl-hero-title' });
        hero.createEl('div', {
            text: '常用学术网站与工具收录，涵盖 AI 助手、文献获取、计算工具、计算化学等',
            cls: 'rtl-hero-sub'
        });

        // 主体：左侧 sticky 栏（搜索 + 按钮 + 分类导航） + 右侧卡片网格。
        const main = container.createDiv({ cls: 'rtl-main' });
        // 外层占位列：被 grid 拉伸到与右栏等高，作为内层 sticky 元素的 containing block。
        const navCol = main.createDiv({ cls: 'rtl-nav-col' });
        // 真正的 sticky 容器：搜索栏 + 添加按钮 + 分类导航 一起贴顶。
        this.navEl = navCol.createDiv({ cls: 'rtl-nav' });

        // 头部工具区（搜索 + 添加 + 新建分类），随 .rtl-nav 一起 sticky。
        const navToolbar = this.navEl.createDiv({ cls: 'rtl-nav-toolbar' });
        const search = navToolbar.createEl('input', {
            cls: 'rtl-search-input',
            attr: { type: 'text', placeholder: '搜索工具、网址、介绍…' },
        });
        search.value = this.searchText;
        search.addEventListener('input', () => {
            this.searchText = search.value;
            this.renderMain();
        });
        const btnRow = navToolbar.createDiv({ cls: 'rtl-nav-btn-row' });
        btnRow.createEl('button', { text: '＋ 添加工具', cls: 'rtl-add-btn' })
            .onclick = () => this.showEditModal();
        btnRow.createEl('button', { text: '＋ 新建分类', cls: 'rtl-secondary-btn' })
            .onclick = () => this.showCategoryModal();

        // 分类导航容器（被 renderNav 填充内容，不再代表整个 sticky 元素）。
        this.navListEl = this.navEl.createDiv({ cls: 'rtl-nav-list' });

        this.gridEl = main.createDiv({ cls: 'rtl-grid-wrap' });

        this.renderMain();
    }

    private renderMain(): void {
        // 注意：只刷新分类列表区，避免把搜索框/按钮一起清掉而丢失焦点与输入状态。
        if (this.navListEl) this.renderNav(this.navListEl);
        if (this.gridEl) this.renderGrid(this.gridEl);
    }

    private renderNav(nav: HTMLElement): void {
        nav.empty();
        const items = this.getFilteredItems();
        const groups = this.groupItems(items);

        nav.createEl('div', { text: '分类导航', cls: 'rtl-nav-title' });
        this.createNavItem(nav, '全部', 'top', items.length);
        for (const [category, categoryItems] of groups) {
            this.createNavItem(nav, category, this.sectionId(category), categoryItems.length);
        }
    }

    private createNavItem(nav: HTMLElement, label: string, targetId: string, count: number): void {
        const item = nav.createEl('button', { cls: 'rtl-nav-item' });
        const color = targetId === 'top' ? this.plugin.settings.themeAccent : this.getCategoryColor(label);
        item.style.setProperty('--rtl-category-color', color);
        item.createSpan({ text: label, cls: 'rtl-nav-label' });
        item.createSpan({ text: String(count), cls: 'rtl-nav-count' });
        item.onclick = () => {
            const target = targetId === 'top'
                ? this.container?.querySelector('.rtl-hero')
                : this.container?.querySelector(`#${CSS.escape(targetId)}`);
            target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        };
    }

    private renderGrid(container: HTMLElement): void {
        container.empty();
        const items = this.getFilteredItems();
        if (items.length === 0) {
            const empty = container.createDiv({ cls: 'rtl-empty' });
            empty.createEl('div', { text: '🧭', cls: 'rtl-empty-icon' });
            empty.createEl('p', { text: '还没有匹配的科研工具' });
            empty.createEl('p', { text: '点击上方加号，把常用网站、软件主页或数据库收进来。', cls: 'rtl-empty-hint' });
            return;
        }

        for (const [category, categoryItems] of this.groupItems(items)) {
            const section = container.createDiv({ cls: 'rtl-section' });
            section.id = this.sectionId(category);
            section.style.setProperty('--rtl-category-color', this.getCategoryColor(category));
            const head = section.createDiv({ cls: 'rtl-section-head' });
            head.createEl('h3', { text: category, cls: 'rtl-section-title' });
            head.createEl('span', { text: `${categoryItems.length} 项`, cls: 'rtl-section-count' });

            const grid = section.createDiv({ cls: 'rtl-grid' });
            for (const item of categoryItems) this.createCard(grid, item);
        }
    }

    private createCard(grid: HTMLElement, item: ResearchToolItem): void {
        const card = grid.createDiv({ cls: 'rtl-card' });
        card.style.setProperty('--rtl-category-color', this.getCategoryColor(item.category || '未分类'));

        const top = card.createDiv({ cls: 'rtl-card-top' });
        const titleWrap = top.createDiv({ cls: 'rtl-card-title-wrap' });
        titleWrap.createEl('div', { text: item.name, cls: 'rtl-card-title', attr: { title: item.name } });
        top.createDiv({ text: item.icon || '↗', cls: 'rtl-card-icon' });

        const desc = item.description || '暂无介绍';
        card.createEl('p', { text: desc, cls: 'rtl-card-desc' });

        const link = card.createDiv({ cls: 'rtl-card-link' });
        link.createSpan({ text: '↗ 外部链接' });
        link.createSpan({ text: hostLabel(item.url), cls: 'rtl-card-host', attr: { title: item.url } });

        const actions = card.createDiv({ cls: 'rtl-card-actions' });
        actions.createEl('button', { text: '打开', cls: 'rtl-mini-btn primary', attr: { title: '打开外部链接' } })
            .onclick = (e) => {
                e.stopPropagation();
                window.open(item.url, '_blank');
            };
        actions.createEl('button', { text: '编辑', cls: 'rtl-mini-btn', attr: { title: '编辑卡片' } })
            .onclick = (e) => {
                e.stopPropagation();
                this.showEditModal(item);
            };
        actions.createEl('button', { text: '删除', cls: 'rtl-mini-btn danger', attr: { title: '删除卡片' } })
            .onclick = (e) => {
                e.stopPropagation();
                this.deleteTool(item);
            };

        card.onclick = () => window.open(item.url, '_blank');
    }

    private getFilteredItems(): ResearchToolItem[] {
        let items = this.data.items.slice();

        const q = this.searchText.trim().toLowerCase();
        if (q) {
            items = items.filter(item =>
                item.name.toLowerCase().includes(q) ||
                item.url.toLowerCase().includes(q) ||
                item.category.toLowerCase().includes(q) ||
                item.description.toLowerCase().includes(q));
        }

        return items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }

    private groupItems(items: ResearchToolItem[]): Array<[string, ResearchToolItem[]]> {
        const groups = new Map<string, ResearchToolItem[]>();
        for (const item of items) {
            const category = item.category || '未分类';
            if (!groups.has(category)) groups.set(category, []);
            groups.get(category)?.push(item);
        }

        const orderedCategories = [
            ...this.data.categories,
            ...Array.from(groups.keys()).filter(category => !this.data.categories.includes(category)),
        ];

        return orderedCategories
            .map(category => [category, groups.get(category) || []] as [string, ResearchToolItem[]])
            .filter(([, groupItems]) => groupItems.length > 0);
    }

    private sectionId(category: string): string {
        let hash = 0;
        for (let i = 0; i < category.length; i++) {
            hash = ((hash << 5) - hash) + category.charCodeAt(i);
            hash |= 0;
        }
        return `rtl-section-${Math.abs(hash)}`;
    }

    private getCategoryColor(category: string): string {
        const colors = {
            ...DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS,
            ...(this.plugin.settings.researchToolCategoryColors || {}),
        };
        return colors[category] || DEFAULT_RESEARCH_TOOL_CATEGORY_COLORS['未分类'] || this.plugin.settings.themeAccent;
    }

    private showEditModal(item?: ResearchToolItem): void {
        new ResearchToolEditModal(this.app, this.data.categories, item, async (draft) => {
            const url = normalizeUrl(draft.url);
            if (!draft.name.trim()) {
                new Notice('请填写工具名称');
                return false;
            }
            if (!isHttpUrl(url)) {
                new Notice('请填写有效的网址');
                return false;
            }

            if (item) {
                item.name = draft.name.trim();
                item.url = url;
                item.icon = draft.icon.trim() || '🔗';
                item.category = draft.category.trim();
                item.description = draft.description.trim();
            } else {
                this.data.items.push({
                    id: generateId(),
                    name: draft.name.trim(),
                    url,
                    icon: draft.icon.trim() || '🔗',
                    category: draft.category.trim(),
                    description: draft.description.trim(),
                    addedAt: new Date().toISOString(),
                });
            }

            if (draft.category.trim() && !this.data.categories.includes(draft.category.trim())) {
                this.data.categories.push(draft.category.trim());
            }
            await this.save();
            this.renderMain();
            new Notice(item ? '科研工具已更新' : '科研工具已添加');
            return true;
        }).open();
    }

    private showCategoryModal(): void {
        new ResearchToolCategoryModal(this.app, this.data.categories, async (name) => {
            const category = name.trim();
            if (!category) return;
            if (!this.data.categories.includes(category)) {
                this.data.categories.push(category);
                await this.save();
                this.renderMain();
            }
        }).open();
    }

    private deleteTool(item: ResearchToolItem): void {
        if (!confirm(`删除科研工具「${item.name}」？`)) return;
        this.data.items = this.data.items.filter(existing => existing.id !== item.id);
        this.save().then(() => this.renderMain());
    }

    destroy(): void {
        // 不再有需要解绑的全局监听；保留方法以兼容外部调用。
    }
}

class ResearchToolEditModal extends Modal {
    /** Modal 关闭时需要执行的清理回调（移除全局监听等）。 */
    private cleanupCallbacks: Array<() => void> = [];

    constructor(
        app: App,
        private categories: string[],
        private item: ResearchToolItem | undefined,
        private onConfirm: (draft: Omit<ResearchToolItem, 'id' | 'addedAt'>) => Promise<boolean>
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rtl-modal');
        contentEl.createEl('h3', { text: this.item ? '编辑科研工具' : '添加科研工具', cls: 'mat-modal-title' });

        const nameInput = this.addInput('名称', this.item?.name || '', '例如：PubMed / Origin / BioRender');
        const iconInput = this.addIconInput(this.item?.icon || '🔗');
        const urlInput = this.addInput('网址', this.item?.url || '', 'https://...');
        const categoryInput = this.addCategoryInput(this.item?.category || '');
        const descInput = this.addTextarea('介绍', this.item?.description || '', '这个工具适合做什么，使用时要注意什么');

        const buttons = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        buttons.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        buttons.createEl('button', { text: this.item ? '保存' : '添加', cls: 'mat-modal-btn mat-modal-btn-primary' })
            .onclick = async () => {
                const ok = await this.onConfirm({
                    name: nameInput.value,
                    icon: iconInput.value,
                    url: urlInput.value,
                    category: categoryInput.value,
                    description: descInput.value,
                });
                if (ok) this.close();
            };
    }

    private addInput(label: string, value: string, placeholder: string): HTMLInputElement {
        this.contentEl.createEl('label', { text: label, cls: 'mat-modal-label' });
        const input = this.contentEl.createEl('input', {
            cls: 'mat-modal-input',
            attr: { type: 'text', placeholder },
        });
        input.value = value;
        return input;
    }

    /**
     * 图标字段：emoji 下拉选择器。
     * - 触发块左侧预览当前 emoji，右侧是文本输入（仍允许自由键入任意字符）。
     * - 点击触发块或下拉箭头展开/收起选择面板。
     * - 面板顶部带搜索框，下方按分组显示所有内置 emoji。
     * - 返回真正的 <input>，使外层提交逻辑（this.onConfirm）保持不变。
     */
    private addIconInput(value: string): HTMLInputElement {
        this.contentEl.createEl('label', { text: '图标', cls: 'mat-modal-label' });

        const wrap = this.contentEl.createDiv({ cls: 'rtl-icon-field' });

        // 触发块：预览 + 文本输入 + 箭头
        const trigger = wrap.createDiv({ cls: 'rtl-icon-trigger' });
        const preview = trigger.createDiv({ cls: 'rtl-icon-preview' });
        const input = trigger.createEl('input', {
            cls: 'mat-modal-input rtl-icon-input',
            attr: { type: 'text', placeholder: '点击选择 emoji，或直接输入', maxlength: '16' },
        });
        input.value = value;
        preview.textContent = value || '🔗';
        const caret = trigger.createSpan({ cls: 'rtl-icon-caret', text: '▾' });

        // 弹出面板
        const popup = wrap.createDiv({ cls: 'rtl-emoji-popup is-hidden' });
        const searchInput = popup.createEl('input', {
            cls: 'mat-modal-input rtl-emoji-search',
            attr: { type: 'text', placeholder: '搜索 emoji（中英文关键词）' },
        });
        const list = popup.createDiv({ cls: 'rtl-emoji-list' });

        const renderGroups = () => {
            list.empty();
            for (const group of EMOJI_GROUPS) {
                const sectionEl = list.createDiv({ cls: 'rtl-emoji-group' });
                sectionEl.createEl('div', { text: group.name, cls: 'rtl-emoji-group-title' });
                const grid = sectionEl.createDiv({ cls: 'rtl-emoji-grid' });
                for (const entry of group.items) {
                    const btn = grid.createEl('button', {
                        text: entry.char,
                        cls: 'rtl-emoji-cell',
                        attr: { type: 'button', title: entry.keywords.slice(0, 3).join(' / ') },
                    });
                    btn.onclick = (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        pickEmoji(entry.char);
                    };
                }
            }
        };

        const renderSearchResults = (query: string) => {
            list.empty();
            const results = searchEmojis(query);
            if (results.length === 0) {
                list.createDiv({ text: '没有匹配的 emoji', cls: 'rtl-emoji-empty' });
                return;
            }
            const grid = list.createDiv({ cls: 'rtl-emoji-grid' });
            for (const entry of results) {
                const btn = grid.createEl('button', {
                    text: entry.char,
                    cls: 'rtl-emoji-cell',
                    attr: { type: 'button', title: entry.keywords.slice(0, 3).join(' / ') },
                });
                btn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pickEmoji(entry.char);
                };
            }
        };

        const pickEmoji = (char: string) => {
            input.value = char;
            preview.textContent = char;
            // 触发 input 的 change/input 事件以兼容潜在监听
            input.dispatchEvent(new Event('input', { bubbles: true }));
            closePopup();
        };

        const openPopup = () => {
            if (!popup.hasClass('is-hidden')) return;
            popup.removeClass('is-hidden');
            wrap.addClass('is-open');
            // 默认按分组展示
            searchInput.value = '';
            renderGroups();
            // 自动聚焦搜索框，方便键盘输入过滤
            setTimeout(() => searchInput.focus(), 0);
        };
        const closePopup = () => {
            if (popup.hasClass('is-hidden')) return;
            popup.addClass('is-hidden');
            wrap.removeClass('is-open');
        };

        // 点击预览/箭头切换面板；不打扰文本输入框上的点击
        preview.onclick = (e) => { e.stopPropagation(); popup.hasClass('is-hidden') ? openPopup() : closePopup(); };
        caret.onclick = (e) => { e.stopPropagation(); popup.hasClass('is-hidden') ? openPopup() : closePopup(); };

        // 直接键入也同步预览
        input.addEventListener('input', () => {
            preview.textContent = input.value || '🔗';
        });

        // 点击外部（且不是图标字段内）时关闭
        const outsideClickHandler = (e: MouseEvent) => {
            if (!wrap.contains(e.target as Node)) closePopup();
        };
        document.addEventListener('mousedown', outsideClickHandler);
        // Modal 关闭时移除监听
        this.addCleanup(() => document.removeEventListener('mousedown', outsideClickHandler));

        // 搜索框实时过滤
        searchInput.addEventListener('input', () => {
            const q = searchInput.value;
            if (q.trim()) renderSearchResults(q);
            else renderGroups();
        });

        return input;
    }

    private addCleanup(fn: () => void): void {
        this.cleanupCallbacks.push(fn);
    }

    onClose(): void {
        for (const fn of this.cleanupCallbacks) {
            try { fn(); } catch { /* ignore */ }
        }
        this.cleanupCallbacks = [];
    }

    private addCategoryInput(value: string): HTMLInputElement {
        this.contentEl.createEl('label', { text: '分类', cls: 'mat-modal-label' });
        const input = this.contentEl.createEl('input', {
            cls: 'mat-modal-input',
            attr: { type: 'text', list: 'rtl-category-options', placeholder: '选择或输入新分类' },
        });
        input.value = value;
        const datalist = this.contentEl.createEl('datalist', { attr: { id: 'rtl-category-options' } });
        for (const category of this.categories) {
            datalist.createEl('option', { attr: { value: category } });
        }
        return input;
    }

    private addTextarea(label: string, value: string, placeholder: string): HTMLTextAreaElement {
        this.contentEl.createEl('label', { text: label, cls: 'mat-modal-label' });
        const textarea = this.contentEl.createEl('textarea', {
            cls: 'mat-modal-input rtl-modal-textarea',
            attr: { placeholder },
        });
        textarea.value = value;
        return textarea;
    }
}

class ResearchToolCategoryModal extends Modal {
    constructor(
        app: App,
        private categories: string[],
        private onConfirm: (name: string) => void
    ) {
        super(app);
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('rtl-modal');
        contentEl.createEl('h3', { text: '新建科研库分类', cls: 'mat-modal-title' });
        contentEl.createEl('p', { text: `已有分类：${this.categories.join('、')}`, cls: 'mat-modal-sub' });
        contentEl.createEl('label', { text: '分类名称', cls: 'mat-modal-label' });
        const input = contentEl.createEl('input', {
            cls: 'mat-modal-input',
            attr: { type: 'text', placeholder: '例如：组会常用 / 结构生物学 / 投稿查询' },
        });
        const buttons = contentEl.createDiv({ cls: 'mat-modal-buttons' });
        buttons.createEl('button', { text: '取消', cls: 'mat-modal-btn' }).onclick = () => this.close();
        buttons.createEl('button', { text: '创建', cls: 'mat-modal-btn mat-modal-btn-primary' })
            .onclick = () => {
                this.onConfirm(input.value);
                this.close();
            };
        input.focus();
    }
}
