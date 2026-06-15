import { ItemView, WorkspaceLeaf, TFile, Notice, MarkdownRenderer, getFrontMatterInfo, parseYaml } from 'obsidian';
import ChemELNPlugin from './main';
import { WORKSPACE_ROLE_LABELS, WORKSPACE_ROLE_ICONS } from './settings';
import { AIChatModal } from './ai-chat-modal';
import { PhDWorkspace } from './phd-workspace';
import { fetchWithTimeout } from './utils/network';
import { MaterialLibrary } from './material-library';
import { ResearchToolLibrary } from './research-tool-library';
import type { CloudSyncManager } from './cloud-sync';
import { t } from './i18n';
import { iconSvg } from './icons';
import { avatar as makeAvatar, segmented, card as uiCard, sectionHeader, pill, button as uiButton, input as uiInput, insetBlock } from './components/ui';
import { IdeaLibrary } from './idea-library';
import { RssFeedBoard } from './rss-feed-board';
import { openInsertChemModalForFile } from './chem/chem-markdown';
import { parseChemBlock, CHEM_CODE_BLOCK } from './chem/chem-block';
import { namespaceSvgIds } from './chem/svg-ids';

// 本地打包 smiles-drawer（兼容 esbuild 的 ESM→CJS 转换）
// sync-touch: chem block dashboard preview
// @ts-ignore
import _SD from 'smiles-drawer';
// esbuild 打包时 default export 可能挂在 .default 上
const SD = (_SD as { default?: unknown } & Record<string, unknown>)?.default ?? _SD;

// 给 SmiDrawer 生成的 SVG 扩展 viewBox，避免左侧的隐式氢（如 HBr/HCl 的 H）被裁切
export function padSvgViewBox(svg: SVGSVGElement, ratio = 0.06, min = 1.5): void {
    const vb = svg.getAttribute('viewBox');
    if (!vb) return;
    const p = vb.split(/[\s,]+/).map(Number);
    if (p.length !== 4 || p.some(isNaN)) return;
    const [x = 0, y = 0, w = 0, h = 0] = p;
    const pad = Math.max(Math.max(w, h) * ratio, min);
    svg.setAttribute('viewBox', `${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`);
}

function normalizeReactionPreviewSmiles(smiles: string, isReaction: boolean): string {
    if (!isReaction || !smiles.includes('>>')) return smiles;
    return smiles
        .split('>>')
        .map((side) => side
            .split('.')
            .map((fragment) => HYDROGEN_HALIDE_PREVIEW[fragment.trim()] ?? fragment)
            .join('.'))
        .join('>>');
}

const HYDROGEN_HALIDE_PREVIEW: Record<string, string> = {
    F: '[H]F',
    Cl: '[H]Cl',
    Br: '[H]Br',
    I: '[H]I',
};

export const DASHBOARD_VIEW_TYPE = 'scholarium-dashboard';

interface ExperimentNote {
    file: TFile;
    noteType: 'experiment' | 'research-learning';
    title: string;
    date: string;         // 严格来自 frontmatter.date 或文件名，不依赖 mtime
    status: string;
    smiles: string;
    reaction_smiles: string;
    results: string;
    reagents: string[];
    bookmarked: boolean;
    excalidraw: string;   // 关联的绘图文件路径
}

export class DashboardView extends ItemView {
    plugin: ChemELNPlugin;
    private clockInterval: number | null = null;
    private selectedExperiment: ExperimentNote | null = null;
    private detailPanel: HTMLElement | null = null;
    private allExperiments: ExperimentNote[] = [];
    private filterText = '';
    private filterStatus = 'all';
    private expListContainer: HTMLElement | null = null;
    // PhD 工作台
    private workspace: PhDWorkspace | null = null;
    // 素材库
    private materialLib: MaterialLibrary | null = null;
    // 科研库
    private researchToolLib: ResearchToolLibrary | null = null;
    // 想法库（Notebook → Ideas，重设计 M5）
    private ideaLib: IdeaLibrary | null = null;
    // 文献订阅工作台（RSS）
    private rssBoard: RssFeedBoard | null = null;
    private notebookMode: 'experiments' | 'ideas' = 'experiments';
    private activePanel: 'lab' | 'feeds' | 'workspace' | 'materials' | 'tools' = 'lab';
    private resizeTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: ChemELNPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return 'scholarium'; }
    getIcon() { return 'flask-conical'; }

    setSyncManager(manager: CloudSyncManager): void {
        if (this.materialLib) {
            this.materialLib.setSyncManager(manager);
        }
    }

    async onOpen() {
        try {
            // 初始化 PhD 工作台（预加载数据）
            this.workspace = new PhDWorkspace(this.app, this.plugin);
            await this.workspace.load();
            // 初始化素材库
            this.materialLib = new MaterialLibrary(this.app, this.plugin);
            await this.materialLib.load();
            // 初始化科研库
            this.researchToolLib = new ResearchToolLibrary(this.app, this.plugin);
            await this.researchToolLib.load();
            // 想法库
            this.ideaLib = new IdeaLibrary(this.app, this.plugin);
            await this.ideaLib.load();
            // 文献订阅工作台
            this.rssBoard = new RssFeedBoard(this.app, this.plugin);
            await this.rssBoard.load();
            await this.render();
            this.clockInterval = this.registerInterval(window.setInterval(() => this.updateClock(), 60000));
            // 窗口/叶子尺寸变化（如折叠侧边栏）时防抖重渲染，让按窗口测量的高度与布局自适应
            this.registerDomEvent(window, 'resize', () => {
                if (this.resizeTimer) window.clearTimeout(this.resizeTimer);
                this.resizeTimer = window.setTimeout(() => { void this.render(); }, 200);
            });
        } catch (e) {
            console.error('[ChemELN] onOpen 出错:', e);
            const c = this.contentEl;
            c.empty();
            c.createEl('p', { text: '⚠️ 仪表盘加载出错，请重新打开。错误：' + (e as Error).message });
        }
    }

    async onClose() {
        if (this.clockInterval !== null) window.clearInterval(this.clockInterval);
        this.workspace?.destroy();
        this.materialLib?.destroy();
        this.researchToolLib?.destroy();
        this.rssBoard?.destroy();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('scholarium-dashboard');
        this.plugin.applyThemeAttributes(container);

        // ===== 顶部品牌栏（重设计：logo · 4 Tab · 搜索 · AI · 设置 · 头像）=====
        this.renderBrandBar(container);
        const nbLabel = this.plugin.settings.notebookLabel || '实验记录';

        // ===== 主体区 =====
        const main = container.createDiv({ cls: 'scholarium-main' });

        if (this.activePanel === 'feeds') {
            // ── 文献订阅工作台（全宽）──
            const rssPanel = main.createDiv({ cls: 'scholarium-panel rss-full-panel' });
            if (this.rssBoard) this.rssBoard.render(rssPanel);
        } else if (this.activePanel === 'workspace') {
            // ── PhD 工作台（全宽）──
            const wsPanel = main.createDiv({ cls: 'scholarium-panel ws-full-panel' });
            if (this.workspace) this.workspace.render(wsPanel);
        } else if (this.activePanel === 'materials') {
            // ── 素材库（全宽）──
            const matPanel = main.createDiv({ cls: 'scholarium-panel mat-full-panel' });
            if (this.materialLib) this.materialLib.render(matPanel);
        } else if (this.activePanel === 'tools') {
            // ── 科研库（全宽）──
            const toolsPanel = main.createDiv({ cls: 'scholarium-panel rtl-full-panel' });
            if (this.researchToolLib) this.researchToolLib.render(toolsPanel);
        } else {
            // ── Notebook 模式条（实验 ⇄ 想法，重设计 M5）──
            const lang = this.plugin.settings.language;
            const modeBar = container.createDiv({ cls: 'sch-notebook-modebar' });
            Object.assign(modeBar.style, { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' });
            main.before(modeBar);
            segmented(
                modeBar,
                [
                    { value: 'experiments', label: this.plugin.settings.notebookLabel || t('notebook', lang) },
                    { value: 'ideas', label: lang === 'zh' ? '想法库' : 'Ideas' },
                ],
                this.notebookMode,
                (v) => { this.notebookMode = v as 'experiments' | 'ideas'; void this.render(); },
            );

            if (this.notebookMode === 'ideas') {
                const ideasPanel = main.createDiv({ cls: 'scholarium-panel ideas-full-panel' });
                this.allExperiments = await this.getExperiments();
                if (this.ideaLib) {
                    this.ideaLib.experimentIndex = this.allExperiments.map(e => ({ id: e.file.basename, title: e.title }));
                    this.ideaLib.render(ideasPanel);
                }
                return;
            }

            // ── 实验记录（左右两栏）──
            // ── 左栏 ──
            const leftPanel = main.createDiv({ cls: 'scholarium-panel left-panel' });
            const sidebarWidth = Math.min(440, Math.max(280, this.plugin.settings.notebookSidebarWidth || 300));
            leftPanel.style.width = `${sidebarWidth}px`;
            leftPanel.style.minWidth = `${sidebarWidth}px`;
            leftPanel.createEl('h3', { text: `📋 ${nbLabel}`, cls: 'panel-title' });

            // 搜索框
            const searchInput = leftPanel.createDiv({ cls: 'exp-search-wrap' })
                .createEl('input', { cls: 'exp-search-input', attr: { placeholder: '🔍 搜索标题、试剂…', type: 'text' } });
            searchInput.value = this.filterText;
            searchInput.addEventListener('input', () => {
                this.filterText = searchInput.value;
                this.selectedExperiment = null;
                this.renderExpList();
                if (this.detailPanel) void this.renderExperimentDashboard(this.detailPanel, this.getFilteredExperiments());
            });

            // 状态过滤标签
            const filterTabs = leftPanel.createDiv({ cls: 'filter-tabs' });
            const tabDefs: Array<[string, string, string]> = [
                ['all', '全部', '全部实验'],
                ['study', '📚 研究学习', '研究学习笔记'],
                ['in-progress', '🔄 进行中', '进行中'],
                ['completed', '✅ 已完成', '已完成'],
                ['planned', '📋 计划中', '计划中'],
                ['failed', '❌ 未成功', '未成功'],
            ];
            for (const [val, label, title] of tabDefs) {
                const tab = filterTabs.createEl('button', { text: label, attr: { title } });
                tab.addClass('filter-tab');
                if (this.filterStatus === val) tab.addClass('active');
                tab.onclick = () => {
                    this.filterStatus = val;
                    this.selectedExperiment = null;
                    filterTabs.querySelectorAll('.filter-tab').forEach(t => t.removeClass('active'));
                    tab.addClass('active');
                    this.renderExpList();
                    if (this.detailPanel) void this.renderExperimentDashboard(this.detailPanel, this.getFilteredExperiments());
                };
            }

            this.expListContainer = leftPanel.createDiv({ cls: 'exp-list-container' });

            // 加载数据
            this.allExperiments = await this.getExperiments();
            this.updateStats();
            this.renderExpList();

            const resizeHandle = main.createDiv({ cls: 'notebook-sidebar-resizer', attr: { title: '拖拽调整侧栏宽度' } });
            this.bindNotebookSidebarResize(resizeHandle, leftPanel);

            // ── 右栏 ──
            const rightPanel = main.createDiv({ cls: 'scholarium-panel right-panel' });
            this.detailPanel = rightPanel;
            this.selectedExperiment = null;
            await this.renderExperimentDashboard(rightPanel, this.getFilteredExperiments());
            return;
            if (false) {

                rightPanel.createEl('div', { text: '← 点击左侧实验记录查看详情，或点击"＋ 新建实验"开始。', cls: 'scholarium-placeholder' });
            }
        }
    }

    // ───── 顶部品牌栏（重设计 M3）─────
    private switchTab(panel: 'lab' | 'feeds' | 'workspace' | 'materials' | 'tools'): void {
        if (this.activePanel === panel) return;
        this.activePanel = panel;
        void this.render();
    }

    private bindNotebookSidebarResize(handle: HTMLElement, panel: HTMLElement): void {
        handle.addEventListener('pointerdown', (event: PointerEvent) => {
            event.preventDefault();
            const startX = event.clientX;
            const startWidth = panel.getBoundingClientRect().width;
            handle.addClass('is-dragging');
            document.body.addClass('scholarium-resizing-sidebar');

            const move = (moveEvent: PointerEvent) => {
                const width = Math.min(440, Math.max(280, startWidth + moveEvent.clientX - startX));
                panel.style.width = `${width}px`;
                panel.style.minWidth = `${width}px`;
            };
            const finish = () => {
                document.removeEventListener('pointermove', move);
                document.removeEventListener('pointerup', finish);
                document.removeEventListener('pointercancel', finish);
                handle.removeClass('is-dragging');
                document.body.removeClass('scholarium-resizing-sidebar');
                this.plugin.settings.notebookSidebarWidth = Math.round(panel.getBoundingClientRect().width);
                void this.plugin.saveSettings();
            };
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', finish, { once: true });
            document.addEventListener('pointercancel', finish, { once: true });
        });
    }

    private brandIconButton(parent: HTMLElement, icon: string, title: string): HTMLButtonElement {
        const btn = parent.createEl('button', { attr: { title } });
        Object.assign(btn.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '34px', height: '34px', border: '1px solid var(--sch-line)',
            borderRadius: '10px', background: 'transparent', color: 'var(--sch-ink2)',
            cursor: 'pointer', flexShrink: '0', transition: 'all .15s ease',
        });
        btn.appendChild(iconSvg(icon, { size: 16 }));
        return btn;
    }

    private renderBrandBar(container: HTMLElement): void {
        const s = this.plugin.settings;
        const lang = s.language;

        const bar = container.createDiv({ cls: 'sch-brandbar' });
        Object.assign(bar.style, {
            display: 'flex', alignItems: 'center', gap: '10px 14px', flexWrap: 'wrap', minWidth: '0',
            padding: '10px 16px', marginBottom: '14px',
            background: 'var(--sch-surface)', border: '1px solid var(--sch-line)',
            borderRadius: 'var(--sch-radius)',
            boxShadow: '0 1px 2px rgba(0,0,0,.02), 0 1px 0 rgba(255,255,255,.5) inset',
        });

        // logo
        const logo = bar.createDiv({ cls: 'sch-brandbar-logo' });
        Object.assign(logo.style, { display: 'flex', alignItems: 'center', gap: '8px', flex: '0 1 auto', minWidth: '0' });
        const logoIcon = iconSvg('flask', { size: 20 });
        logoIcon.setCssProps({ "color": 'var(--sch-accent)' });
        logo.appendChild(logoIcon);
        const logoText = logo.createSpan({ text: 'scholarium' });
        Object.assign(logoText.style, {
            fontFamily: 'var(--sch-font-serif)', fontWeight: '600', fontSize: '16px',
            color: 'var(--sch-ink)', whiteSpace: 'normal', overflowWrap: 'anywhere', lineHeight: '1.35',
        });

        // 4 tabs
        const tabsWrap = bar.createDiv({ cls: 'sch-brandbar-tabs' });
        Object.assign(tabsWrap.style, { display: 'flex', alignItems: 'center', gap: '4px', flex: '1 1 360px', minWidth: '0', flexWrap: 'wrap' });
        const roleLabel = s.workspaceRole !== 'custom'
            ? (WORKSPACE_ROLE_LABELS[s.workspaceRole] ?? t('workspace', lang))
            : (s.workspaceTabLabel || t('workspace', lang));
        const tabs: Array<{ key: 'lab' | 'feeds' | 'workspace' | 'materials' | 'tools'; icon: string; label: string }> = [
            { key: 'lab',        icon: 'notebook',  label: s.notebookLabel || t('notebook', lang) },
            { key: 'feeds',      icon: 'rss',       label: lang === 'zh' ? '文献订阅' : 'Feeds' },
            { key: 'workspace',  icon: 'workspace', label: roleLabel },
            { key: 'materials',  icon: 'folder',    label: t('materials', lang) },
            { key: 'tools',      icon: 'tool',      label: t('tools', lang) },
        ];
        for (const tab of tabs) {
            const active = this.activePanel === tab.key;
            const btn = tabsWrap.createEl('button');
            Object.assign(btn.style, {
                display: 'flex', alignItems: 'center', gap: '7px',
                height: '34px', padding: '0 14px', border: '0', borderRadius: '10px',
                background: active ? 'var(--sch-accent-soft)' : 'transparent',
                color: active ? 'var(--sch-accent-ink)' : 'var(--sch-mute)',
                fontWeight: '600', fontSize: '13.5px', cursor: 'pointer',
                fontFamily: 'inherit', whiteSpace: 'nowrap', transition: 'all .15s ease',
            });
            btn.appendChild(iconSvg(tab.icon, { size: 16 }));
            btn.appendChild(document.createTextNode(tab.label));
            btn.addEventListener('click', () => this.switchTab(tab.key));
        }

        const actions = bar.createDiv({ cls: 'sch-brandbar-actions' });
        Object.assign(actions.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            gap: '8px', marginLeft: 'auto', flex: '0 1 auto', minWidth: '0', flexWrap: 'wrap',
        });

        // clock chip (keep id so updateClock() keeps working)
        const clock = actions.createSpan({ cls: 'scholarium-clock' });
        clock.id = 'scholarium-clock';
        Object.assign(clock.style, {
            fontFamily: 'var(--sch-font-mono)', fontSize: '12.5px',
            color: 'var(--sch-mute)', whiteSpace: 'nowrap',
        });
        this.updateClock();

        // search → Obsidian command palette
        const searchBtn = this.brandIconButton(actions, 'search', t('search', lang));
        searchBtn.addEventListener('click', () => {
            const cmd = (this.app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands;
            cmd?.executeCommandById?.('command-palette:open');
        });

        // AI assistant
        const aiBtn = this.brandIconButton(actions, 'sparkle', t('ai', lang));
        aiBtn.addEventListener('click', () => new AIChatModal(this.app, this.plugin).open());

        // settings
        const setBtn = this.brandIconButton(actions, 'settings', t('settings', lang));
        setBtn.addEventListener('click', () => {
            const setting = (this.app as unknown as { setting?: { open?: () => void; openTabById?: (id: string) => void } }).setting;
            if (setting?.open) { setting.open(); setting.openTabById?.('scholarium'); }
        });

        // avatar (initial)
        makeAvatar(actions, 'S', { size: 30 });
    }

    // ───── 统计 ─────
    updateStats() {
        const el = document.getElementById('scholarium-stats');
        if (!el) return;
        const t = this.allExperiments.length;
        if (!t) { el.setText(''); return; }
        const c = this.allExperiments.filter(e => e.status === 'completed').length;
        const p = this.allExperiments.filter(e => e.status === 'in-progress').length;
        const bk = this.allExperiments.filter(e => e.bookmarked).length;
        el.setText(`🔬 共${t}条 · ✅${c} · 🔄${p}${bk ? ' · ★'+bk : ''}`);
    }

    // ───── 实验列表 ─────
    renderExpList() {
        if (!this.expListContainer) return;
        this.expListContainer.empty();

        const filtered = this.getFilteredExperiments();

        if (!filtered.length) {
            this.expListContainer.createEl('div', {
                text: (this.filterText || this.filterStatus !== 'all')
                    ? '没有匹配的实验记录'
                    : '尚无实验记录。\n点击"＋ 新建实验"或"🤖 AI 助手"开始！',
                cls: 'scholarium-empty'
            });
            return;
        }

        const listEl = this.expListContainer.createDiv({ cls: 'exp-list' });
        for (const [date, exps] of this.groupByDate(filtered)) {
            const dh = listEl.createDiv({ cls: 'exp-day-group' });
            dh.createEl('span', { text: this.formatDateLabel(date), cls: 'exp-day-label' });
            dh.createEl('span', { text: `${exps.length} 条`, cls: 'exp-day-count' });
            for (const exp of exps) this.renderExpListItem(listEl, exp);
        }
    }

    getFilteredExperiments(): ExperimentNote[] {
        let filtered = this.allExperiments;
        if (this.filterStatus === 'study') filtered = filtered.filter(e => e.noteType === 'research-learning');
        else if (this.filterStatus !== 'all') filtered = filtered.filter(e => e.noteType === 'experiment' && e.status === this.filterStatus);
        if (this.filterText.trim()) {
            const q = this.filterText.trim().toLowerCase();
            filtered = filtered.filter(e =>
                e.title.toLowerCase().includes(q) ||
                e.reagents.some(r => r.toLowerCase().includes(q)) ||
                e.results.toLowerCase().includes(q) ||
                e.date.toLowerCase().includes(q)
            );
        }
        return filtered;
    }

    async renderExperimentDashboard(panel: HTMLElement, experiments: ExperimentNote[]) {
        panel.empty();
        panel.addClass('exp-dashboard-panel');

        const header = panel.createDiv({ cls: 'exp-board-header' });
        const titleWrap = header.createDiv();
        titleWrap.createEl('h2', { text: '研究记录看板', cls: 'detail-title exp-board-title' });
        titleWrap.createEl('div', {
            text: experiments.length ? `共 ${experiments.length} 条记录，包含实验与研究学习笔记。` : '还没有符合条件的记录。',
            cls: 'exp-board-subtitle',
        });

        const tools = header.createDiv({ cls: 'exp-board-tools' });
        tools.createEl('button', { text: '＋ 新建实验', cls: 'scholarium-btn primary' })
            .onclick = () => this.createNewExperiment();
        tools.createEl('button', { text: 'AI 整理 / 新建', cls: 'scholarium-btn ai-btn' })
            .onclick = () => new AIChatModal(this.app, this.plugin).open();

        if (!experiments.length) {
            const empty = panel.createDiv({ cls: 'exp-board-empty' });
            empty.createEl('div', { text: '暂无研究记录', cls: 'exp-board-empty-title' });
            empty.createEl('div', { text: '可以新建实验，或使用 AI 整理研究学习笔记。', cls: 'exp-board-empty-text' });
            return;
        }

        const stats = panel.createDiv({ cls: 'exp-board-stats' });
        this.renderBoardStat(stats, '全部记录', String(experiments.length));
        this.renderBoardStat(stats, '已完成', String(experiments.filter(e => e.status === 'completed').length));
        this.renderBoardStat(stats, '进行中', String(experiments.filter(e => e.status === 'in-progress').length));
        this.renderBoardStat(stats, '研究学习', String(experiments.filter(e => e.noteType === 'research-learning').length));

        const grid = panel.createDiv({ cls: 'exp-card-dashboard' });
        for (const exp of experiments) {
            const cardStatus = exp.noteType === 'research-learning' ? 'study' : exp.status;
            const card = grid.createDiv({ cls: `exp-note-card status-${cardStatus}` });
            if (exp.bookmarked) card.addClass('is-bookmarked');
            await this.renderExperimentCard(card, exp);
        }
    }

    private renderBoardStat(container: HTMLElement, label: string, value: string) {
        const item = container.createDiv({ cls: 'exp-board-stat' });
        item.createEl('span', { text: value, cls: 'exp-board-stat-value' });
        item.createEl('span', { text: label, cls: 'exp-board-stat-label' });
    }

    private async renderExperimentCard(card: HTMLElement, exp: ExperimentNote) {
        card.empty();

        const top = card.createDiv({ cls: 'exp-note-card-top' });
        top.createEl('span', {
            text: exp.noteType === 'research-learning' ? '研究学习' : this.statusLabel(exp.status),
            cls: `status-badge status-${exp.noteType === 'research-learning' ? 'study' : exp.status}`
        });
        top.createEl('span', { text: exp.date, cls: 'exp-note-card-date' });

        const body = card.createDiv({ cls: 'exp-note-card-scroll' });
        body.createEl('h3', { text: exp.title, cls: 'exp-note-card-title' });

        const meta = body.createDiv({ cls: 'exp-note-card-meta' });
        const mt = new Date(exp.file.stat.mtime);
        meta.createEl('span', { text: `修改 ${mt.getHours().toString().padStart(2, '0')}:${mt.getMinutes().toString().padStart(2, '0')}` });
        if (exp.bookmarked) meta.createEl('span', { text: '收藏' });

        let noteBody = '';
        try { noteBody = await this.app.vault.read(exp.file); } catch (error) { console.warn('[Scholarium] Unable to read experiment preview:', exp.file.path, error); }

        if (exp.noteType === 'research-learning') {
            const content = this.stripFrontmatterAndTitle(noteBody);
            if (content) {
                const sec = body.createDiv({ cls: 'exp-note-card-section' });
                sec.createEl('h4', { text: '研究学习笔记' });
                const div = sec.createDiv({ cls: 'exp-note-card-text' });
                await MarkdownRenderer.render(this.app, content.slice(0, 700), div, exp.file.path, this);
            }
        }

        const images = this.extractMarkdownImages(noteBody).slice(0, 3);
        if (images.length) {
            const imageRow = body.createDiv({ cls: 'exp-note-card-images' });
            for (const img of images) {
                const imageEl = imageRow.createEl('img', { attr: { src: img.src, alt: img.alt } });
                imageEl.onclick = (e) => {
                    e.stopPropagation();
                    this.showImageLightbox(images, 0);
                };
            }
        }

        // 卡片中渲染正文里的 scholarium-chem 结构（紧凑缩略图）
        this.renderChemBlocksOnCard(body, noteBody);

        const rawSmiles = exp.noteType === 'experiment' ? (exp.reaction_smiles || exp.smiles) : '';
        const smilesStr = (rawSmiles || '').replace(/^["']|["']$/g, '').trim();
        if (smilesStr && smilesStr !== '""') {
            const sec = body.createDiv({ cls: 'exp-note-card-section' });
            sec.createEl('h4', { text: exp.reaction_smiles ? '反应式' : '化学结构' });
            sec.createEl('code', { text: smilesStr, cls: 'smiles-text' });
        }

        if (exp.noteType === 'experiment' && exp.reagents?.length) {
            const sec = body.createDiv({ cls: 'exp-note-card-section' });
            sec.createEl('h4', { text: '试剂与原料' });
            const ul = sec.createEl('ul', { cls: 'reagent-list' });
            exp.reagents.forEach(r => ul.createEl('li', { text: r }));
        }

        const resultsStr = (exp.results || '').replace(/^["']|["']$/g, '').trim();
        if (exp.noteType === 'experiment' && resultsStr) {
            const sec = body.createDiv({ cls: 'exp-note-card-section' });
            sec.createEl('h4', { text: '实验结果' });
            sec.createEl('p', { text: resultsStr, cls: 'results-text' });
        }

        const sections = this.extractNoteSections(noteBody);
        for (const heading of exp.noteType === 'research-learning'
            ? ['摘要', '核心概念', '方法理解', '关键结论', '问题与思考', '参考文献']
            : ['实验目的', '目的', '实验步骤', '步骤', '观察与现象', '下一步计划', '注意事项', '备注', '参考文献']) {
            let content = sections.get(heading);
            if (!content) continue;
            // 去掉 scholarium-chem 代码块（已用结构图单独渲染），避免显示原始代码文本
            content = content.replace(new RegExp('```' + CHEM_CODE_BLOCK + '[\\s\\S]*?```', 'g'), '').trim();
            if (content.length < 2) continue;
            const sec = body.createDiv({ cls: 'exp-note-card-section' });
            sec.createEl('h4', { text: heading });
            sec.createDiv({ cls: 'exp-note-card-text', text: content });
        }

        const footer = card.createDiv({ cls: 'exp-note-card-footer' });
        footer.createEl('button', { text: '查看详情', cls: 'scholarium-btn' }).onclick = (e) => {
            e.stopPropagation();
            this.selectedExperiment = exp;
            if (this.detailPanel) void this.showDetail(this.detailPanel, exp);
        };
        footer.createEl('button', { text: '打开笔记', cls: 'scholarium-btn' }).onclick = (e) => {
            e.stopPropagation();
            void this.app.workspace.getLeaf(false).openFile(exp.file);
        };

        card.onclick = () => {
            this.selectedExperiment = exp;
            if (this.detailPanel) void this.showDetail(this.detailPanel, exp);
        };
    }

    private statusLabel(status: string): string {
        const labelMap: Record<string, string> = {
            completed: '已完成',
            'in-progress': '进行中',
            planned: '计划中',
            failed: '未成功',
        };
        return labelMap[status] ?? status;
    }

    private extractNoteSections(content: string): Map<string, string> {
        const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
        const body = bodyMatch ? (bodyMatch[1] ?? '') : content;
        const map = new Map<string, string>();
        const re = /^##\s+(.+?)\s*\n([\s\S]*?)(?=^##\s+|\s*$)/gm;
        let match: RegExpExecArray | null;
        while ((match = re.exec(body)) !== null) {
            const heading = (match[1] ?? '').trim();
            const value = (match[2] ?? '').trim();
            if (heading && value) map.set(heading, value);
        }
        return map;
    }

    private formatPlainMarkdown(content: string): string {
        return content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/^(\d+\.\s+)/gm, '<span class="step-num">$1</span>')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    private stripFrontmatterAndTitle(content: string): string {
        return content
            .replace(/^---[\s\S]*?---\s*/m, '')
            .replace(/^#\s+.+?\n+/m, '')
            .trim();
    }

    groupByDate(exps: ExperimentNote[]): Map<string, ExperimentNote[]> {
        const map = new Map<string, ExperimentNote[]>();
        for (const e of exps) { if (!map.has(e.date)) map.set(e.date, []); map.get(e.date)!.push(e); }
        return map;
    }

    formatDateLabel(d: string): string {
        const today = new Date().toISOString().split('T')[0];
        const yest  = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        return d === today ? '📅 今天' : d === yest ? '📅 昨天' : `📅 ${d}`;
    }

    renderExpListItem(container: HTMLElement, exp: ExperimentNote) {
        const itemStatus = exp.noteType === 'research-learning' ? 'study' : exp.status;
        const item = container.createDiv({ cls: `exp-item status-${itemStatus}` });
        if (this.selectedExperiment?.file.path === exp.file.path) item.addClass('selected');

        const icons: Record<string, string> = { completed: '✅', 'in-progress': '🔄', planned: '📋', failed: '❌' };
        item.createEl('span', { text: exp.noteType === 'research-learning' ? '📚' : (icons[exp.status] ?? '🔬'), cls: 'exp-status-icon' });

        const info = item.createDiv({ cls: 'exp-item-info' });
        // 标题前显示收藏星
        const titleRow = info.createDiv({ cls: 'exp-item-title-row' });
        if (exp.bookmarked) titleRow.createEl('span', { text: '★ ', cls: 'exp-item-star' });
        titleRow.createEl('span', { text: exp.title });
        // 显示实验日期 + 修改时间
        const mt = new Date(exp.file.stat.mtime);
        info.createEl('div', {
            text: `${exp.date} ${mt.getHours().toString().padStart(2,'0')}:${mt.getMinutes().toString().padStart(2,'0')}`,
            cls: 'exp-item-date'
        });

        // ── 删除按钮（hover 时显示）──
        const delBtn = item.createEl('button', { text: '🗑', cls: 'exp-item-del-btn', attr: { title: '删除记录' } });
        delBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            this.confirmDeleteExperiment(exp);
        };

        item.onclick = () => {
            this.selectedExperiment = exp;
            this.expListContainer?.querySelectorAll('.exp-item').forEach(el => el.removeClass('selected'));
            item.addClass('selected');
            if (this.detailPanel) this.showDetail(this.detailPanel, exp);
        };
    }

    // ───── 删除确认 ─────
    confirmDeleteExperiment(exp: ExperimentNote) {
        const modal = document.createElement('div');
        modal.className = 'exp-del-modal-overlay';
        const dialog = modal.createDiv({ cls: 'exp-del-modal' });
        dialog.createDiv({ cls: 'exp-del-modal-icon', text: 'Delete' });
        dialog.createDiv({ cls: 'exp-del-modal-title', text: 'Confirm deletion' });
        dialog.createDiv({ cls: 'exp-del-modal-body', text: `Move ${exp.title} to the system trash? You can restore it from the trash.` });
        const buttons = dialog.createDiv({ cls: 'exp-del-modal-btns' });
        buttons.createEl('button', { cls: 'exp-del-cancel', text: 'Cancel' });
        buttons.createEl('button', { cls: 'exp-del-confirm', text: 'Delete' });
        document.body.appendChild(modal);

        const close = () => document.body.removeChild(modal);

        (modal.querySelector('.exp-del-cancel') as HTMLButtonElement).onclick = close;
        (modal.querySelector('.exp-del-confirm') as HTMLButtonElement).onclick = async () => {
            close();
            try {
                await this.app.vault.trash(exp.file, true);
                // 如当前选中的正是被删记录，清空右栏
                if (this.selectedExperiment?.file.path === exp.file.path) {
                    this.selectedExperiment = null;
                    if (this.detailPanel) {
                        this.detailPanel.empty();
                        this.detailPanel.createEl('div', {
                            text: '← 记录已删除，请选择其他实验。',
                            cls: 'scholarium-placeholder'
                        });
                    }
                }
                // 刷新列表
                this.allExperiments = await this.getExperiments();
                this.updateStats();
                this.renderExpList();
                new Notice('🗑️ 已移入回收站');
            } catch (err) {
                new Notice('❌ 删除失败：' + (err as Error).message);
            }
        };

        // 点击遮罩关闭
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    }

    // ───── 详情面板（async，含图片优先） ─────
    async showDetail(panel: HTMLElement, exp: ExperimentNote) {
        panel.empty();

        // —— 标题 + 操作按钮 ——
        const dh = panel.createDiv({ cls: 'detail-header' });
        dh.createEl('h2', { text: exp.title, cls: 'detail-title' });
        const btnGroup = dh.createDiv({ cls: 'detail-btn-group' });
        btnGroup.createEl('button', { text: '返回看板', cls: 'scholarium-btn' })
            .onclick = () => {
                this.selectedExperiment = null;
                void this.renderExperimentDashboard(panel, this.getFilteredExperiments());
            };

        // 收藏按钮
        const starBtn = btnGroup.createEl('button', {
            text: exp.bookmarked ? '★ 已收藏' : '☆ 收藏',
            cls: `scholarium-btn${exp.bookmarked ? ' bookmarked' : ''}`
        });
        starBtn.onclick = async () => {
            await this.toggleBookmark(exp);
            starBtn.setText(exp.bookmarked ? '★ 已收藏' : '☆ 收藏');
            exp.bookmarked ? starBtn.addClass('bookmarked') : starBtn.removeClass('bookmarked');
        };

        // 打开笔记
        btnGroup.createEl('button', { text: '✏️ 打开笔记', cls: 'scholarium-btn' })
            .onclick = () => this.app.workspace.getLeaf(false).openFile(exp.file);

        if (exp.noteType === 'experiment') {
            const drawBtn = btnGroup.createEl('button', { text: '📐 绘图', cls: 'scholarium-btn' });
            drawBtn.onclick = () => this.openExcalidraw(exp);
            btnGroup.createEl('button', { text: '添加化学结构', cls: 'scholarium-btn' })
                .onclick = () => openInsertChemModalForFile(this.plugin, exp.file, 'reaction');
            btnGroup.createEl('button', { text: '✏️ 编辑', cls: 'scholarium-btn' })
                .onclick = () => this.showDetailEdit(panel, exp);
        }

        // AI 修改（携带笔记内容作为上下文）
        const aiBtn = btnGroup.createEl('button', { text: '🤖 AI 修改', cls: 'scholarium-btn ai-btn' });
        aiBtn.onclick = async () => {
            let nc = '';
            try { nc = await this.app.vault.read(exp.file); } catch (error) { console.warn('[Scholarium] Unable to read experiment content:', exp.file.path, error); }
            new AIChatModal(this.app, this.plugin, exp.file, nc).open();
        };

        // —— 状态（可点击改状态）+ 日期 ——
        const meta = panel.createDiv({ cls: 'detail-meta' });
        if (exp.noteType === 'experiment') this.renderStatusPicker(meta, exp, panel);
        else meta.createEl('span', { text: '📚 研究学习笔记', cls: 'status-badge status-study' });
        meta.createEl('span', { text: `📅 ${exp.noteType === 'experiment' ? '实验日期' : '记录日期'}：${exp.date}`, cls: 'date-tag' });

        // ── 读取笔记正文（一次读取，共享内容）──
        let noteBody = '';
        try { noteBody = await this.app.vault.read(exp.file); } catch (error) { console.warn('[Scholarium] Unable to read experiment detail:', exp.file.path, error); }

        // —— 1. 实验图片（最优先，放顶部）——
        await this.renderImages(panel, noteBody);

        if (exp.noteType === 'research-learning') {
            const sec = panel.createDiv({ cls: 'detail-section' });
            sec.createEl('h4', { text: '📚 整理后的学习笔记', cls: 'section-title' });
            const text = sec.createDiv({ cls: 'exp-note-card-text' });
            await MarkdownRenderer.render(this.app, this.stripFrontmatterAndTitle(noteBody), text, exp.file.path, this);
            return;
        }

        // —— 2. 化学结构（reaction_smiles 优先，smiles 兜底）——
        const rawSmiles = exp.reaction_smiles || exp.smiles;
        const smilesStr = (rawSmiles || '').replace(/^["']|["']$/g, '').trim();
        if (smilesStr && smilesStr !== '""') {
            const isReaction = !!(exp.reaction_smiles && exp.reaction_smiles.replace(/^["']|["']$/g, '').trim());
            this.renderSmilesSection(panel, smilesStr, isReaction);
        }

        // —— 2b. 笔记正文里的化学方程代码块（scholarium-chem）——
        this.renderChemBlocksFromBody(panel, noteBody);

        // —— 3. 试剂 ——
        if (exp.reagents?.length) {
            const sec = panel.createDiv({ cls: 'detail-section' });
            sec.createEl('h4', { text: '🧪 试剂与原料', cls: 'section-title' });
            const ul = sec.createEl('ul', { cls: 'reagent-list' });
            exp.reagents.forEach(r => ul.createEl('li', { text: r }));
        }

        // —— 4. 结果摘要 ——
        const resultsStr = (exp.results || '').replace(/^["']|["']$/g, '').trim();
        if (resultsStr) {
            const sec = panel.createDiv({ cls: 'detail-section' });
            sec.createEl('h4', { text: '📊 实验结果', cls: 'section-title' });
            sec.createEl('p', { text: resultsStr, cls: 'results-text' });
        }

        // —— 5. 步骤 + 注意事项（从正文提取）——
        this.renderNoteBodySections(panel, noteBody);
    }

    // ───── 状态快捷修改下拉 ─────
    renderStatusPicker(container: HTMLElement, exp: ExperimentNote, _detailPanel: HTMLElement) {
        const labelMap: Record<string, string> = {
            completed: '✅ 已完成', 'in-progress': '🔄 进行中',
            planned: '📋 计划中', failed: '❌ 未成功'
        };
        const wrapper = container.createDiv({ cls: 'status-wrapper' });
        const badge = wrapper.createEl('span', {
            text: labelMap[exp.status] ?? exp.status,
            cls: `status-badge status-${exp.status} status-clickable`,
            attr: { title: '点击修改状态' }
        });

        const menu = wrapper.createDiv({ cls: 'status-menu' });
        const opts: Array<[string, string]> = [
            ['completed', '✅ 已完成'], ['in-progress', '🔄 进行中'],
            ['planned', '📋 计划中'], ['failed', '❌ 未成功'],
        ];
        for (const [val, label] of opts) {
            const opt = menu.createEl('div', {
                text: label,
                cls: 'status-menu-item',
                attr: { 'data-status': val }
            });
            if (exp.status === val) opt.addClass('active');
            opt.addEventListener('click', async (e) => {
                e.stopPropagation();
                menu.removeClass('open');
                await this.updateExpStatus(exp, val);
            });
        }

        // 点击 badge 切换菜单
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.hasClass('open');
            // 先关闭所有其他打开的 status-menu
            document.querySelectorAll('.status-menu.open').forEach(m => m.removeClass('open'));
            if (!isOpen) menu.addClass('open');
        });

        // 点其他地方关闭菜单（用 capture 确保在 stopPropagation 之前触发，only once per open）
        const closeOnOutside = (e: MouseEvent) => {
            if (!wrapper.contains(e.target as Node)) {
                menu.removeClass('open');
            }
        };
        // 使用 capturing phase 监听，确保点击外部能正确关闭
        document.addEventListener('click', closeOnOutside, true);
        // 组件销毁时自动解绑（通过 Obsidian registerDomEvent 机制）
        this.register(() => document.removeEventListener('click', closeOnOutside, true));
    }

    async updateExpStatus(exp: ExperimentNote, newStatus: string) {
        try {
            const content = await this.app.vault.read(exp.file);
            const updated = content.replace(/^(status:\s*)\S+[ \t]*$/m, `$1${newStatus}`);
            await this.app.vault.modify(exp.file, updated);
            exp.status = newStatus;
            // 只更新 allExperiments 中的对应条目（不重新加载全部，避免mtime问题）
            const idx = this.allExperiments.findIndex(e => e.file.path === exp.file.path);
            if (idx >= 0) (this.allExperiments[idx] as ExperimentNote).status = newStatus;
            this.updateStats();
            this.renderExpList();
            if (this.detailPanel) this.showDetail(this.detailPanel, exp);
            new Notice(`✅ 状态已更新为：${newStatus}`);
        } catch (e) {
            console.error('[ChemELN] 更新状态失败:', e);
            new Notice('❌ 状态更新失败');
        }
    }

    // ───── 收藏切换（不重新加载全部实验，避免日期跳变）─────
    async toggleBookmark(exp: ExperimentNote) {
        try {
            const content = await this.app.vault.read(exp.file);
            const newVal = !exp.bookmarked;
            let updated: string;
            if (/^bookmarked:/m.test(content)) {
                updated = content.replace(/^(bookmarked:\s*).*$/m, `$1${newVal}`);
            } else {
                // 在 frontmatter 末尾（--- 前）插入
                updated = content.replace(/^(---[\s\S]*?)(---)/, `$1bookmarked: ${newVal}\n$2`);
            }
            await this.app.vault.modify(exp.file, updated);
            exp.bookmarked = newVal;
            // 同步 allExperiments
            const idx = this.allExperiments.findIndex(e => e.file.path === exp.file.path);
            if (idx >= 0) (this.allExperiments[idx] as ExperimentNote).bookmarked = newVal;
            this.updateStats();
            this.renderExpList();
            new Notice(newVal ? '★ 已添加收藏' : '☆ 已取消收藏');
        } catch (e) {
            console.error('[ChemELN] 收藏失败:', e);
            new Notice('❌ 收藏操作失败');
        }
    }

    // ───── Excalidraw 集成 ─────
    async openExcalidraw(exp: ExperimentNote) {
        // 检测是否安装了 Excalidraw 插件
        const app = this.app as unknown as Record<string, unknown>;
        const plugins = (app.plugins as Record<string, unknown>)?.plugins as Record<string, unknown> | undefined;
        const hasExcalidraw = plugins && (
            'obsidian-excalidraw-plugin' in plugins ||
            'excalidraw' in plugins
        );

        if (!hasExcalidraw) {
            new Notice('⚠️ 请先在社区插件中安装 Excalidraw 插件后使用此功能');
            return;
        }

        let drawFile: TFile | null = null;

        // 1. 从 frontmatter 读取已关联的绘图文件
        if (exp.excalidraw) {
            const f = this.app.vault.getAbstractFileByPath(exp.excalidraw);
            if (f instanceof TFile) drawFile = f;
        }

        // 2. 没有则创建新文件
        if (!drawFile) {
            const folder = this.plugin.settings.experimentsFolder;
            const drawPath = `${folder ? folder + '/' : ''}绘图_${exp.file.basename}.excalidraw`;
            try {
                const emptyDraw = JSON.stringify({
                    type: 'excalidraw', version: 2,
                    source: 'scholarium-plugin',
                    elements: [],
                    appState: { gridSize: null, viewBackgroundColor: '#ffffff' }
                }, null, 2);

                if (!this.app.vault.getAbstractFileByPath(drawPath)) {
                    drawFile = await this.app.vault.create(drawPath, emptyDraw);
                } else {
                    drawFile = this.app.vault.getAbstractFileByPath(drawPath) as TFile;
                }

                // 更新实验 frontmatter，记录绘图文件路径
                const content = await this.app.vault.read(exp.file);
                let updated: string;
                if (/^excalidraw:/m.test(content)) {
                    updated = content.replace(/^(excalidraw:\s*).*$/m, `$1${drawPath}`);
                } else {
                    updated = content.replace(/^(---[\s\S]*?)(---)/, `$1excalidraw: ${drawPath}\n$2`);
                }
                await this.app.vault.modify(exp.file, updated);
                exp.excalidraw = drawPath;
                new Notice(`📐 已创建绘图文件：${drawPath}`);
            } catch (e) {
                console.error('[ChemELN] 创建绘图失败:', e);
                new Notice('❌ 创建绘图文件失败');
                return;
            }
        }

        await this.app.workspace.getLeaf(false).openFile(drawFile);
    }

    // ───── 实验图片（从笔记正文读取，优先展示）─────
    private extractMarkdownImages(noteContent: string): Array<{ src: string; alt: string }> {
        const wikiMatches = [...noteContent.matchAll(/!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp))[^\]]*\]\]/gi)];
        const mdMatches = [...noteContent.matchAll(/!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|svg|webp|bmp))\)/gi)];
        const validImgs: Array<{ src: string; alt: string }> = [];

        for (const m of wikiMatches.slice(0, 8)) {
            const imgPath = ((m[1] ?? '').split('|')[0] ?? '').trim();
            const imgFile = this.app.vault.getAbstractFileByPath(imgPath)
                ?? this.app.metadataCache.getFirstLinkpathDest(imgPath, '');
            if (imgFile instanceof TFile) {
                validImgs.push({ src: this.app.vault.getResourcePath(imgFile), alt: imgPath });
            }
        }

        for (const m of mdMatches.slice(0, 8)) {
            if (validImgs.length >= 8) break;
            const imgPath = (m[2] ?? '').trim();
            const imgFile = this.app.vault.getAbstractFileByPath(imgPath)
                ?? this.app.metadataCache.getFirstLinkpathDest(imgPath, '');
            if (imgFile instanceof TFile) {
                validImgs.push({ src: this.app.vault.getResourcePath(imgFile), alt: m[1] || '实验图片' });
            }
        }

        return validImgs;
    }

    async renderImages(panel: HTMLElement, noteContent: string) {
        // 匹配 Obsidian 嵌入图片: ![[文件名]] 和标准 MD 图片: ![alt](path)
        const wikiMatches = [...noteContent.matchAll(/!\[\[([^\]]+\.(png|jpg|jpeg|gif|svg|webp|bmp))[^\]]*\]\]/gi)];
        const mdMatches   = [...noteContent.matchAll(/!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|svg|webp|bmp))\)/gi)];

        const validImgs: Array<{ src: string; alt: string }> = [];

        for (const m of wikiMatches.slice(0, 8)) {
            const imgPath = ((m[1] ?? '').split('|')[0] ?? '').trim();
            const imgFile = this.app.vault.getAbstractFileByPath(imgPath)
                ?? this.app.metadataCache.getFirstLinkpathDest(imgPath, '');
            if (imgFile instanceof TFile) {
                validImgs.push({ src: this.app.vault.getResourcePath(imgFile), alt: imgPath });
            }
        }

        for (const m of mdMatches.slice(0, 8)) {
            if (validImgs.length >= 8) break;
            const imgPath = (m[2] ?? '').trim();
            const imgFile = this.app.vault.getAbstractFileByPath(imgPath);
            if (imgFile instanceof TFile) {
                validImgs.push({ src: this.app.vault.getResourcePath(imgFile), alt: m[1] || '实验图片' });
            }
        }

        if (!validImgs.length) return;

        const sec = panel.createDiv({ cls: 'detail-section img-section-top' });
        sec.createEl('h4', { text: `🖼 实验图片（${validImgs.length} 张）`, cls: 'section-title' });
        const grid = sec.createDiv({ cls: 'img-grid-top' });
        validImgs.forEach(({ src, alt }, idx) => {
            const wrap = grid.createDiv({ cls: 'img-thumb-wrap' });
            const img = wrap.createEl('img', { cls: 'img-thumb-top', attr: { src, alt } });
            // ➕ 放大镜遮罩
            const overlay = wrap.createDiv({ cls: 'img-thumb-overlay' });
            overlay.createEl('span', { text: '🔍', cls: 'img-zoom-icon' });
            wrap.onclick = () => this.showImageLightbox(validImgs, idx);
        });
    }

    // ───── 图片灯箱（全屏预览）─────
    showImageLightbox(images: Array<{ src: string; alt: string }>, startIdx: number) {
        let currentIdx = startIdx;

        // 背景遮罩
        const backdrop = document.createElement('div');
        backdrop.className = 'img-lightbox-backdrop';

        // 关闭函数
        const close = () => {
            backdrop.classList.add('img-lightbox-hide');
            setTimeout(() => backdrop.remove(), 200);
            document.removeEventListener('keydown', onKey);
        };
        backdrop.onclick = (e) => { if (e.target === backdrop || (e.target as HTMLElement).classList.contains('img-lightbox-inner')) close(); };

        // 内层容器（防止点击图片本身关闭）
        const inner = document.createElement('div');
        inner.className = 'img-lightbox-inner';
        backdrop.appendChild(inner);

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.className = 'img-lightbox-close';
        closeBtn.setText('Close');
        closeBtn.onclick = close;
        inner.appendChild(closeBtn);

        // 图片计数
        const counter = document.createElement('div');
        counter.className = 'img-lightbox-counter';
        inner.appendChild(counter);

        // 大图
        const imgEl = document.createElement('img');
        imgEl.className = 'img-lightbox-img';
        imgEl.onclick = (e) => e.stopPropagation();
        inner.appendChild(imgEl);

        // 文件名
        const caption = document.createElement('div');
        caption.className = 'img-lightbox-caption';
        inner.appendChild(caption);

        // 左/右箭头（多图时显示）
        const prevBtn = document.createElement('button');
        prevBtn.className = 'img-lightbox-nav img-lightbox-prev';
        prevBtn.setText('Previous');
        prevBtn.onclick = (e) => { e.stopPropagation(); navigate(-1); };

        const nextBtn = document.createElement('button');
        nextBtn.className = 'img-lightbox-nav img-lightbox-next';
        nextBtn.setText('Next');
        nextBtn.onclick = (e) => { e.stopPropagation(); navigate(1); };

        if (images.length > 1) {
            inner.appendChild(prevBtn);
            inner.appendChild(nextBtn);
        }

        // 切换图片
        const navigate = (delta: number) => {
            currentIdx = (currentIdx + delta + images.length) % images.length;
            update();
        };

        const update = () => {
            const cur = images[currentIdx];
            if (!cur) return;
            const { src, alt } = cur;
            imgEl.src = src;
            imgEl.alt = alt;
            caption.textContent = alt || '';
            counter.textContent = images.length > 1 ? `${currentIdx + 1} / ${images.length}` : '';
            prevBtn.style.display = images.length > 1 ? '' : 'none';
            nextBtn.style.display = images.length > 1 ? '' : 'none';
        };

        // 键盘事件
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowLeft'  && images.length > 1) navigate(-1);
            if (e.key === 'ArrowRight' && images.length > 1) navigate(1);
        };
        document.addEventListener('keydown', onKey);

        document.body.appendChild(backdrop);
        update();
        // 触发淡入动画
        requestAnimationFrame(() => backdrop.classList.add('img-lightbox-show'));
    }

    // ───── 提取并渲染正文中的 scholarium-chem 代码块 ─────
    renderChemBlocksFromBody(panel: HTMLElement, noteBody: string) {
        if (!noteBody) return;
        const fence = new RegExp('```' + CHEM_CODE_BLOCK + '\\r?\\n([\\s\\S]*?)```', 'g');
        let match: RegExpExecArray | null;
        let idx = 0;
        while ((match = fence.exec(noteBody)) !== null) {
            try {
                const block = parseChemBlock(match[1] ?? '');
                const smiles = (block.reactionSmiles || block.smiles || '').trim();
                if (!smiles) continue;
                idx++;
                const sec = panel.createDiv({ cls: 'detail-section' });
                const isReaction = !!block.reactionSmiles || block.type === 'reaction';
                sec.createEl('h4', { text: `⚗️ ${block.title || (isReaction ? '反应方程式' : '化学结构')}`, cls: 'section-title' });
                const wrap = sec.createDiv({ cls: 'canvas-wrap' });
                this.drawSmilesSvg(wrap, smiles, isReaction);
                sec.createEl('code', { text: smiles, cls: 'smiles-text' });
            } catch (e) {
                console.warn('[Scholarium] renderChemBlocksFromBody:', e);
            }
        }
    }

    // ───── 卡片中渲染正文里的 scholarium-chem 结构（紧凑缩略图）─────
    renderChemBlocksOnCard(body: HTMLElement, noteBody: string) {
        if (!noteBody) return;
        const fence = new RegExp('```' + CHEM_CODE_BLOCK + '\\r?\\n([\\s\\S]*?)```', 'g');
        let match: RegExpExecArray | null;
        while ((match = fence.exec(noteBody)) !== null) {
            try {
                const block = parseChemBlock(match[1] ?? '');
                const smiles = (block.reactionSmiles || block.smiles || '').trim();
                if (!smiles) continue;
                const isReaction = !!block.reactionSmiles || block.type === 'reaction';
                const sec = body.createDiv({ cls: 'exp-note-card-section' });
                sec.createEl('h4', { text: block.title || (isReaction ? '反应式' : '化学结构') });
                const wrap = sec.createDiv({ cls: 'canvas-wrap exp-card-chem' });
                this.drawSmilesSvg(wrap, smiles, isReaction);
            } catch (e) {
                console.warn('[Scholarium] renderChemBlocksOnCard:', e);
            }
        }
    }

    // ───── 用 SmiDrawer 渲染到 SVG（可正确绘制整条反应式），失败回退 canvas ─────
    drawSmilesSvg(container: HTMLElement, smiles: string, isReaction: boolean) {
        const lib = SD as Record<string, unknown>;
        const SmiDrawer = lib.SmiDrawer as (new (mol: object, rxn: object) => {
            draw(s: string, t: SVGElement | string, theme: string, ok: ((x: unknown) => void) | null, err: ((e: unknown) => void) | null, w?: unknown): void;
        }) | undefined;
        const drawableSmiles = normalizeReactionPreviewSmiles(smiles, isReaction);
        if (typeof SmiDrawer === 'function') {
            const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
            svgEl.addClass('smiles-svg');
            container.appendChild(svgEl);
            setTimeout(() => {
                try {
                    const sd = new SmiDrawer({}, {});
                    sd.draw(drawableSmiles, svgEl, 'light', () => {
                        namespaceSvgIds(svgEl);
                        // 让 viewBox 驱动缩放：移除内联固定宽高，避免结构被裁切
                        svgEl.style.removeProperty('width');
                        svgEl.style.removeProperty('height');
                        svgEl.removeAttribute('width');
                        svgEl.removeAttribute('height');
                        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                        padSvgViewBox(svgEl);
                        svgEl.setCssProps({ "overflow": 'visible' });
                        svgEl.setAttribute('overflow', 'visible');
                    }, (err) => {
                        console.warn('[Scholarium] SmiDrawer failed, fallback to canvas:', err);
                        svgEl.remove();
                        this.drawSmilesCanvasFallback(container, drawableSmiles, isReaction);
                    });
                } catch (e) {
                    console.warn('[Scholarium] SmiDrawer threw, fallback to canvas:', e);
                    svgEl.remove();
                    this.drawSmilesCanvasFallback(container, drawableSmiles, isReaction);
                }
            }, 60);
            return;
        }
        this.drawSmilesCanvasFallback(container, drawableSmiles, isReaction);
    }

    private drawSmilesCanvasFallback(container: HTMLElement, smiles: string, isReaction: boolean) {
        const canvas = container.createEl('canvas', { cls: 'smiles-canvas' });
        canvas.width = isReaction ? 600 : 480;
        canvas.height = isReaction ? 240 : 200;
        canvas.id = 'scholarium-canvas-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
        setTimeout(() => {
            if (isReaction) this.drawReactionSmiles(smiles, canvas);
            else this.drawSmiles(smiles, canvas);
        }, 60);
    }

    // ───── 化学结构渲染入口 ─────
    renderSmilesSection(panel: HTMLElement, smiles: string, isReaction: boolean) {
        const sec = panel.createDiv({ cls: 'detail-section' });
        sec.createEl('h4', { text: isReaction ? '⚗️ 反应方程式' : '⚗️ 化学结构', cls: 'section-title' });

        const canvasWrap = sec.createDiv({ cls: 'canvas-wrap' });
        this.drawSmilesSvg(canvasWrap, smiles, isReaction);

        sec.createEl('code', { text: smiles, cls: 'smiles-text' });

        const copyBtn = sec.createEl('button', { text: '📋 复制 SMILES', cls: 'scholarium-btn smiles-copy-btn' });
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(smiles).then(() => {
                copyBtn.setText('✅ 已复制！');
                setTimeout(() => copyBtn.setText('📋 复制 SMILES'), 2000);
            });
        };
    }

    // ───── 解析 smiles-drawer 的 API 结构（支持 namespace / class 两种模式）─────
    private getSmilesDrawerAPI(): { DrawerClass: (new (o: object) => { draw(t: unknown, c: HTMLCanvasElement | string, th: string, iso: boolean): void }) | null; parseFn: ((s: string, ok: (t: unknown) => void, err: (e: unknown) => void) => void) | null } {
        try {
            const lib = SD as Record<string, unknown>;
            // 模式1：SmilesDrawer 命名空间 { Drawer, ReactionDrawer, parse }
            if (typeof lib.Drawer === 'function') {
                const DrawerClass = lib.Drawer as (new (o: object) => { draw(t: unknown, c: HTMLCanvasElement | string, th: string, iso: boolean): void });
                const parseFn = (lib.parse as (s: string, ok: (t: unknown) => void, err: (e: unknown) => void) => void)
                    || ((DrawerClass as unknown as Record<string, unknown>).parse as (s: string, ok: (t: unknown) => void, err: (e: unknown) => void) => void);
                if (typeof parseFn === 'function') return { DrawerClass, parseFn };
            }
            // 模式2：SD 本身就是 Drawer 类
            if (typeof SD === 'function') {
                const DrawerClass = SD as unknown as (new (o: object) => { draw(t: unknown, c: HTMLCanvasElement | string, th: string, iso: boolean): void });
                const parseFn = (SD as unknown as Record<string, unknown>).parse as ((s: string, ok: (t: unknown) => void, err: (e: unknown) => void) => void);
                if (typeof parseFn === 'function') return { DrawerClass, parseFn };
            }
        } catch (e) {
            console.error('[ChemELN] getSmilesDrawerAPI:', e);
        }
        return { DrawerClass: null, parseFn: null };
    }

    // ───── 单分子 SMILES 渲染 ─────
    drawSmiles(smiles: string, canvas: HTMLCanvasElement) {
        try {
            const { DrawerClass, parseFn } = this.getSmilesDrawerAPI();
            if (!DrawerClass || !parseFn) {
                this.drawText(canvas, '化学结构库未就绪\n请检查插件控制台', '#888');
                return;
            }
            const drawer = new DrawerClass({ width: canvas.width, height: canvas.height, bondThickness: 1.4 });
            parseFn(smiles,
                (tree) => {
                    try {
                        drawer.draw(tree, canvas, 'light', false);
                    } catch (e1) {
                        // 降级：传 id 字符串
                        try { drawer.draw(tree, canvas.id, 'light', false); }
                        catch (e2) {
                            console.error('[ChemELN] draw err:', e2);
                            this.drawText(canvas, '渲染失败，请检查SMILES', '#e74c3c');
                        }
                    }
                },
                (_err) => { this.drawText(canvas, 'SMILES 格式有误', '#e74c3c'); }
            );
        } catch (e) {
            console.error('[ChemELN] drawSmiles:', e);
            this.drawText(canvas, 'SMILES 渲染失败', '#e74c3c');
        }
    }

    // ───── Reaction SMILES 渲染 ─────
    drawReactionSmiles(smiles: string, canvas: HTMLCanvasElement) {
        try {
            const lib = SD as Record<string, unknown>;
            // 尝试用 ReactionDrawer（传 CSS 选择器 #id）
            if (typeof lib.ReactionDrawer === 'function') {
                try {
                    const rd = new (lib.ReactionDrawer as new (o: object, a: object) => { draw(s: string, sel: string, th: string): void })(
                        { width: canvas.width, height: canvas.height },
                        { width: Math.floor(canvas.width * 0.38), height: canvas.height }
                    );
                    rd.draw(smiles, '#' + canvas.id, 'light');
                    return;
                } catch (e1) {
                    console.warn('[ChemELN] ReactionDrawer failed, fallback:', e1);
                }
            }
            // 降级：取产物部分（>> 后）用 Drawer 渲染
            const parts = smiles.split('>>');
            const product = (parts[parts.length - 1] ?? smiles).split('.')[0];
            this.drawSmiles(product || smiles, canvas);
        } catch (e) {
            console.error('[ChemELN] drawReactionSmiles:', e);
            this.drawText(canvas, smiles.substring(0, 80), '#555');
        }
    }

    drawText(canvas: HTMLCanvasElement, text: string, color = '#888') {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = color;
        ctx.font = '13px monospace';
        let line = ''; let y = 24;
        for (const ch of text) {
            if (ctx.measureText(line + ch).width > canvas.width - 20) {
                ctx.fillText(line, 12, y); line = ch; y += 20;
            } else { line += ch; }
        }
        if (line) ctx.fillText(line, 12, y);
    }

    // ───── 提取并渲染笔记正文中的步骤 / 注意事项 ─────
    renderNoteBodySections(panel: HTMLElement, content: string) {
        if (!content) return;
        const bodyMatch = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
        const body = bodyMatch ? (bodyMatch[1] ?? '') : content;

        const extract = (heading: string) => {
            const re = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`);
            const m = body.match(re);
            return m ? (m[1] ?? '').trim() : '';
        };

        const steps = extract('实验步骤');
        const notes = extract('注意事项');

        if (steps && !steps.match(/^1\.\s*步骤/) && steps.length > 4) {
            const sec = panel.createDiv({ cls: 'detail-section' });
            sec.createEl('h4', { text: '📝 实验步骤', cls: 'section-title' });
            sec.createDiv({ cls: 'steps-content', text: steps });
        }
        if (notes && notes !== '（暂无）' && notes.length > 2) {
            const sec = panel.createDiv({ cls: 'detail-section' });
            sec.createEl('h4', { text: '⚠️ 注意事项', cls: 'section-title' });
            sec.createEl('p', { text: notes, cls: 'notes-text' });
        }
    }

    // ═══════════════════════════════════════════════════
    //  内联编辑：showDetailEdit  /  saveInlineEdit
    // ═══════════════════════════════════════════════════

    async showDetailEdit(panel: HTMLElement, exp: ExperimentNote) {
        panel.empty();

        let noteContent = '';
        try { noteContent = await this.app.vault.read(exp.file); } catch (error) { console.warn('[Scholarium] Unable to read experiment note:', exp.file.path, error); }

        // 提取正文各章节
        const bodyMatch = noteContent.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
        const body = bodyMatch?.[1] ?? noteContent;
        const extractSec = (heading: string) => {
            const m = body.match(new RegExp(`##\\s+${heading}[^\\n]*\\n([\\s\\S]*?)(?=\\n##[^#]|$)`));
            return (m?.[1] ?? '').trim();
        };

        // ── 顶部：标题 + 操作按钮 ──
        const dh = panel.createDiv({ cls: 'detail-header' });
        const titleInput = dh.createEl('input', { cls: 'edit-title-input' }) as HTMLInputElement;
        titleInput.value = exp.title;
        titleInput.placeholder = '实验标题';

        const btnGroup = dh.createDiv({ cls: 'detail-btn-group' });
        const saveBtn = btnGroup.createEl('button', { text: '💾 保存', cls: 'scholarium-btn primary' });
        btnGroup.createEl('button', { text: '✕ 取消', cls: 'scholarium-btn' })
            .onclick = () => this.showDetail(panel, exp);

        // ── 状态 + 日期 ──
        const meta = panel.createDiv({ cls: 'detail-meta' });
        const statusSel = meta.createEl('select', { cls: 'edit-select' }) as HTMLSelectElement;
        for (const [val, label] of [
            ['completed', '✅ 已完成'], ['in-progress', '🔄 进行中'],
            ['planned', '📋 计划中'],   ['failed', '❌ 未成功'],
        ] as [string, string][]) {
            const opt = statusSel.createEl('option', { text: label, attr: { value: val } });
            if (exp.status === val) opt.selected = true;
        }
        meta.createEl('span', { text: `📅 ${exp.date}`, cls: 'date-tag' });

        // ── 表单 ──
        const form = panel.createDiv({ cls: 'edit-form' });

        const mkGroup = (label: string) => {
            const g = form.createDiv({ cls: 'edit-group' });
            g.createEl('label', { text: label, cls: 'edit-label' });
            return g;
        };

        // Reaction SMILES
        const rSmilesIn = mkGroup('⚗️ Reaction SMILES')
            .createEl('input', { cls: 'edit-input' }) as HTMLInputElement;
        rSmilesIn.value = exp.reaction_smiles.replace(/^["']|["']$/g, '');

        // 分子 SMILES
        const smilesIn = mkGroup('🔬 分子 SMILES')
            .createEl('input', { cls: 'edit-input' }) as HTMLInputElement;
        smilesIn.value = exp.smiles.replace(/^["']|["']$/g, '');

        // 试剂
        const reagentsTA = mkGroup('🧪 试剂（每行一个）')
            .createEl('textarea', { cls: 'edit-textarea' }) as HTMLTextAreaElement;
        reagentsTA.rows = 4;
        reagentsTA.value = exp.reagents.join('\n');

        // 结果摘要
        const resultsTA = mkGroup('📊 实验结果摘要')
            .createEl('textarea', { cls: 'edit-textarea' }) as HTMLTextAreaElement;
        resultsTA.rows = 3;
        resultsTA.value = exp.results.replace(/^["']|["']$/g, '').trim();

        // 实验步骤
        const stepsTA = mkGroup('📝 实验步骤（正文）')
            .createEl('textarea', { cls: 'edit-textarea edit-textarea-tall' }) as HTMLTextAreaElement;
        stepsTA.rows = 8;
        stepsTA.value = extractSec('实验步骤');

        // 注意事项
        const notesTA = mkGroup('⚠️ 注意事项（正文）')
            .createEl('textarea', { cls: 'edit-textarea' }) as HTMLTextAreaElement;
        notesTA.rows = 3;
        notesTA.value = extractSec('注意事项');

        saveBtn.onclick = async () => {
            saveBtn.disabled = true;
            saveBtn.setText('保存中…');
            await this.saveInlineEdit(exp, {
                title:           titleInput.value.trim() || exp.title,
                status:          statusSel.value,
                reaction_smiles: rSmilesIn.value.trim(),
                smiles:          smilesIn.value.trim(),
                reagents:        reagentsTA.value.split('\n').map(r => r.trim()).filter(Boolean),
                results:         resultsTA.value.trim(),
                steps:           stepsTA.value.trim(),
                notes:           notesTA.value.trim(),
            }, panel);
        };
    }

    async saveInlineEdit(exp: ExperimentNote, fields: {
        title: string; status: string; reaction_smiles: string; smiles: string;
        reagents: string[]; results: string; steps: string; notes: string;
    }, panel: HTMLElement) {
        try {
            let content = await this.app.vault.read(exp.file);

            // frontmatter 字段
            content = this.fmSet(content, 'title',           fields.title);
            content = this.fmSet(content, 'status',          fields.status);
            content = this.fmSet(content, 'smiles',          `"${fields.smiles.replace(/"/g, '\\"')}"`);
            content = this.fmSet(content, 'reaction_smiles', `"${fields.reaction_smiles.replace(/"/g, '\\"')}"`);
            content = this.fmSet(content, 'results',         `"${fields.results.replace(/"/g, '\\"').substring(0, 500)}"`);
            content = this.fmSetReagents(content, fields.reagents);

            // H1 标题同步
            if (/^# .+/m.test(content)) {
                content = content.replace(/^# .+$/m, `# ${fields.title}`);
            }

            // 正文章节替换
            if (fields.steps) content = this.replaceSection(content, '实验步骤', fields.steps);
            if (fields.notes) content = this.replaceSection(content, '注意事项', fields.notes);

            await this.app.vault.modify(exp.file, content);

            // 同步内存状态
            exp.title          = fields.title;
            exp.status         = fields.status;
            exp.smiles         = fields.smiles;
            exp.reaction_smiles= fields.reaction_smiles;
            exp.results        = fields.results;
            exp.reagents       = fields.reagents;
            const idx = this.allExperiments.findIndex(e => e.file.path === exp.file.path);
            if (idx >= 0) Object.assign(this.allExperiments[idx]!, exp);

            this.updateStats();
            this.renderExpList();
            new Notice('✅ 已保存');
            await this.showDetail(panel, exp);
        } catch (e) {
            console.error('[ChemELN] saveInlineEdit:', e);
            new Notice('❌ 保存失败：' + (e as Error).message);
        }
    }

    // ── frontmatter 辅助 ──
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

    // 替换正文中的二级标题章节内容（章节不存在则追加）
    private replaceSection(content: string, heading: string, newBody: string): string {
        const headRe = new RegExp(`^##\\s+${heading}`, 'm');
        if (!headRe.test(content)) {
            return content.trimEnd() + `\n\n## ${heading}\n\n${newBody}\n`;
        }
        return content.replace(
            new RegExp(`(##\\s+${heading}[^\\n]*)\\n[\\s\\S]*?(?=\\n##[^#]|$)`),
            (_, headLine) => `${headLine}\n\n${newBody}`
        );
    }

    // ───── 获取所有实验（日期严格按 frontmatter.date 或文件名，不用 mtime）─────
    /** 公开版风格：直接在 vault 中新建一份带标准 frontmatter 的实验记录笔记 */
    async createNewExperiment(): Promise<void> {
        const today = new Date().toISOString().split('T')[0]!;
        const folder = (this.plugin.settings as { experimentFolder?: string }).experimentFolder || 'Experiments';
        try {
            if (!this.app.vault.getAbstractFileByPath(folder)) {
                await this.app.vault.createFolder(folder);
            }
        } catch (error) {
            console.warn('[Scholarium] Unable to ensure experiment folder:', folder, error);
        }
        const baseName = `${today}-实验记录`;
        let path = `${folder}/${baseName}.md`;
        let i = 1;
        while (this.app.vault.getAbstractFileByPath(path)) {
            path = `${folder}/${baseName}-${++i}.md`;
        }
        const tpl = `---
type: experiment
title: 新实验记录
date: ${today}
status: planned
reagents: []
smiles: ""
reaction_smiles: ""
results: ""
---

## 目的


## 步骤


## 结果


## 备注

`;
        try {
            const f = await this.app.vault.create(path, tpl);
            await this.app.workspace.getLeaf(false).openFile(f);
        } catch (e) {
            new Notice('创建失败：' + (e as Error).message);
        }
    }

    async getExperiments(): Promise<ExperimentNote[]> {
        const results: ExperimentNote[] = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            try {
                let fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                if (!fm) {
                    const content = await this.app.vault.cachedRead(file);
                    const info = getFrontMatterInfo(content);
                    fm = info.exists ? parseYaml(info.frontmatter) : undefined;
                }
                if (fm?.type === 'experiment' || fm?.type === 'research-learning') {
                    // 日期优先级：frontmatter.date > 文件名中的日期 > ctime（创建时间，不是修改时间）
                    const filenameDate = file.basename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
                    const fallbackDate = filenameDate || (new Date(file.stat.ctime).toISOString().split('T')[0] ?? '');
                    const date: string = (typeof fm.date === 'string' ? fm.date : undefined) ?? fallbackDate;

                    results.push({
                        file,
                        noteType: fm.type === 'research-learning' ? 'research-learning' : 'experiment',
                        title: (fm.title as string | undefined) ?? file.basename,
                        date,
                        status: (fm.status as string | undefined) ?? 'in-progress',
                        smiles: (fm.smiles as string | undefined) ?? '',
                        reaction_smiles: (fm.reaction_smiles as string | undefined) ?? '',
                        results: (fm.results as string | undefined) ?? '',
                        reagents: Array.isArray(fm.reagents) ? fm.reagents as string[] : [],
                        bookmarked: fm.bookmarked === true,
                        excalidraw: (fm.excalidraw as string | undefined) ?? '',
                    });
                }
            } catch (error) {
                console.warn('[Scholarium] Skipping unreadable experiment metadata:', file.path, error);
            }
        }
        results.sort((a, b) => {
            // 收藏的永远排最前
            if (a.bookmarked && !b.bookmarked) return -1;
            if (!a.bookmarked && b.bookmarked) return 1;
            // 再按日期降序
            const dc = b.date.localeCompare(a.date);
            if (dc !== 0) return dc;
            // 同日按修改时间降序
            return b.file.stat.mtime - a.file.stat.mtime;
        });
        return results;
    }

    // ───── 时钟 ─────
    updateClock() {
        const el = document.getElementById('scholarium-clock');
        if (!el) return;
        const now = new Date();
        const days = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
        el.setText(`📅 ${now.getFullYear()}年${now.getMonth()+1}月${now.getDate()}日 ${days[now.getDay()]} ${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`);
    }

    // ───── 天气 ─────
    async fetchWeather() {
        const el = document.getElementById('scholarium-weather');
        if (!el) return;
        try {
            let lat = this.plugin.settings.latitude, lon = this.plugin.settings.longitude, city = this.plugin.settings.cityName;
            if (!lat || !lon) {
                const g = await (await fetchWithTimeout('https://ipapi.co/json/')).json() as { latitude: number; longitude: number; city: string };
                lat = g.latitude; lon = g.longitude; city = g.city ?? '';
            }
            const d = await (await fetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`)).json() as { current: { temperature_2m: number; weather_code: number } };
            const c = d.current;
            el.setText(`${this.weatherIcon(c.weather_code)} ${Math.round(c.temperature_2m)}°C ${this.weatherDesc(c.weather_code)}${city ? ' · ' + city : ''}`);
        } catch (error) {
            console.warn('[Scholarium] Weather request failed:', error);
            el.setText('🌡 天气暂不可用');
        }
    }

    weatherIcon(c: number) {
        if (c === 0) return '☀';
        if (c <= 3) return '⛅';
        if (c >= 51 && c <= 67) return '🌧️';
        if (c >= 71 && c <= 86) return '❄️';
        if (c >= 95) return '⛈';
        return '☁️';
    }
    weatherDesc(c: number) {
        if (c === 0) return '晴';
        if (c <= 3) return '多云';
        if (c >= 51 && c <= 67) return '雨';
        if (c >= 71 && c <= 86) return '雪';
        if (c >= 95) return '雷暴';
        return '阴';
    }
}
