import { ItemView, WorkspaceLeaf, TFile, Notice } from 'obsidian';
import ChemELNPlugin from './main';
import { WORKSPACE_ROLE_LABELS, WORKSPACE_ROLE_ICONS } from './settings';
import { AIChatModal } from './ai-chat-modal';
import { PhDWorkspace } from './phd-workspace';
import { MaterialLibrary } from './material-library';
import { ResearchCanvas } from './research-canvas';
import type { CloudSyncManager } from './cloud-sync';

// 本地打包 smiles-drawer（兼容 esbuild 的 ESM→CJS 转换）
// @ts-ignore
import _SD from 'smiles-drawer';
// esbuild 打包时 default export 可能挂在 .default 上
const SD = (_SD as { default?: unknown } & Record<string, unknown>)?.default ?? _SD;

export const DASHBOARD_VIEW_TYPE = 'scholarium-dashboard';

interface ExperimentNote {
    file: TFile;
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
    // 研究画布
    private researchCanvas: ResearchCanvas | null = null;
    private activePanel: 'lab' | 'workspace' | 'materials' | 'canvas' = 'lab';

    constructor(leaf: WorkspaceLeaf, plugin: ChemELNPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() { return DASHBOARD_VIEW_TYPE; }
    getDisplayText() { return this.plugin.settings.pluginDisplayName || '实验记录本'; }
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
            // 初始化研究画布
            this.researchCanvas = new ResearchCanvas(this.app, this.plugin);
            await this.researchCanvas.load();
            await this.render();
            this.clockInterval = window.setInterval(() => this.updateClock(), 60000);
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
        this.researchCanvas?.destroy();
    }

    async render() {
        const container = this.contentEl;
        container.empty();
        container.addClass('scholarium-dashboard');

        // ===== 顶部标题栏 =====
        const header = container.createDiv({ cls: 'scholarium-header' });
        header.createEl('div', {
            text: this.plugin.settings.pluginDisplayName || '🧪 实验记录本',
            cls: 'scholarium-logo'
        });

        const infoBar = header.createDiv({ cls: 'scholarium-info-bar' });
        const clockEl = infoBar.createEl('span', { cls: 'scholarium-clock' });
        clockEl.id = 'scholarium-clock';
        this.updateClock();

        const weatherEl = infoBar.createEl('span', { text: '🌡 获取天气中...', cls: 'scholarium-weather' });
        weatherEl.id = 'scholarium-weather';
        this.fetchWeather();

        const statsEl = infoBar.createEl('span', { cls: 'scholarium-stats' });
        statsEl.id = 'scholarium-stats';

        // ===== 面板切换栏（实验记录 | 工作台 | 素材库 | 研究画布）=====
        // 根据角色设置生成工作台标签
        const { workspaceRole, notebookLabel, workspaceTabLabel } = this.plugin.settings;
        const wsTabLabel = workspaceRole !== 'custom'
            ? `${WORKSPACE_ROLE_ICONS[workspaceRole]} ${WORKSPACE_ROLE_LABELS[workspaceRole]}`
            : `📊 ${workspaceTabLabel || '工作台'}`;
        const nbLabel = notebookLabel || '实验记录';

        const panelSwitch = container.createDiv({ cls: 'scholarium-panel-switch' });
        const labBtn = panelSwitch.createEl('button', {
            text: `🧪 ${nbLabel}`,
            cls: `scholarium-switch-btn${this.activePanel === 'lab' ? ' active' : ''}`
        });
        const wsBtn = panelSwitch.createEl('button', {
            text: wsTabLabel,
            cls: `scholarium-switch-btn${this.activePanel === 'workspace' ? ' active' : ''}`
        });
        const matBtn = panelSwitch.createEl('button', {
            text: '🗂️ 素材库',
            cls: `scholarium-switch-btn${this.activePanel === 'materials' ? ' active' : ''}`
        });
        const canvasBtn = panelSwitch.createEl('button', {
            text: '🗺️ 研究画布',
            cls: `scholarium-switch-btn${this.activePanel === 'canvas' ? ' active' : ''}`
        });

        // ===== 操作栏 =====
        const actionBar = container.createDiv({ cls: 'scholarium-action-bar' });
        if (this.activePanel === 'lab') {
            actionBar.createEl('button', { text: '＋ 新建实验', cls: 'scholarium-btn primary' })
                .onclick = () => this.createNewExperiment();
            actionBar.createEl('button', { text: '🔄 刷新', cls: 'scholarium-btn' })
                .onclick = () => this.render();
            actionBar.createEl('button', { text: '🤖 AI 助手', cls: 'scholarium-btn ai-btn' })
                .onclick = () => new AIChatModal(this.app, this.plugin).open();
        } else {
            actionBar.createEl('button', { text: '🔄 刷新', cls: 'scholarium-btn' })
                .onclick = () => this.render();
        }

        // ===== 主体区 =====
        const main = container.createDiv({ cls: 'scholarium-main' });

        if (this.activePanel === 'workspace') {
            // ── PhD 工作台（全宽）──
            const wsPanel = main.createDiv({ cls: 'scholarium-panel ws-full-panel' });
            if (this.workspace) this.workspace.render(wsPanel);

            labBtn.onclick = () => { this.activePanel = 'lab'; this.render(); };
            wsBtn.onclick  = () => {};
            matBtn.onclick = () => { this.activePanel = 'materials'; this.render(); };
            canvasBtn.onclick = () => { this.activePanel = 'canvas'; this.render(); };
        } else if (this.activePanel === 'materials') {
            // ── 素材库（全宽）──
            const matPanel = main.createDiv({ cls: 'scholarium-panel mat-full-panel' });
            if (this.materialLib) this.materialLib.render(matPanel);

            labBtn.onclick = () => { this.activePanel = 'lab'; this.render(); };
            wsBtn.onclick  = () => { this.activePanel = 'workspace'; this.render(); };
            matBtn.onclick = () => {};
            canvasBtn.onclick = () => { this.activePanel = 'canvas'; this.render(); };
        } else if (this.activePanel === 'canvas') {
            // ── 研究画布（全宽）──
            const canvasPanel = main.createDiv({ cls: 'scholarium-panel rc-full-panel' });
            if (this.researchCanvas) {
                const folder = this.plugin.settings.literatureFolder || '';
                await this.researchCanvas.loadNotes(folder);
                this.researchCanvas.render(canvasPanel);
            }

            labBtn.onclick = () => { this.activePanel = 'lab'; this.render(); };
            wsBtn.onclick  = () => { this.activePanel = 'workspace'; this.render(); };
            matBtn.onclick = () => { this.activePanel = 'materials'; this.render(); };
            canvasBtn.onclick = () => {};
        } else {
            // ── 实验记录（左右两栏）──
            labBtn.onclick = () => {};
            wsBtn.onclick  = () => { this.activePanel = 'workspace'; this.render(); };
            matBtn.onclick = () => { this.activePanel = 'materials'; this.render(); };
            canvasBtn.onclick = () => { this.activePanel = 'canvas'; this.render(); };

            // ── 左栏 ──
            const leftPanel = main.createDiv({ cls: 'scholarium-panel left-panel' });
            leftPanel.createEl('h3', { text: `📋 ${nbLabel}`, cls: 'panel-title' });

            // 搜索框
            const searchInput = leftPanel.createDiv({ cls: 'exp-search-wrap' })
                .createEl('input', { cls: 'exp-search-input', attr: { placeholder: '🔍 搜索标题、试剂…', type: 'text' } });
            searchInput.value = this.filterText;
            searchInput.addEventListener('input', () => { this.filterText = searchInput.value; this.renderExpList(); });

            // 状态过滤标签
            const filterTabs = leftPanel.createDiv({ cls: 'filter-tabs' });
            const tabDefs: Array<[string, string, string]> = [
                ['all', '全部', '全部实验'], ['in-progress', '🔄', '进行中'],
                ['completed', '✅', '已完成'], ['planned', '📋', '计划中'], ['failed', '❌', '未成功'],
            ];
            for (const [val, label, title] of tabDefs) {
                const tab = filterTabs.createEl('button', { text: label, attr: { title } });
                tab.addClass('filter-tab');
                if (this.filterStatus === val) tab.addClass('active');
                tab.onclick = () => {
                    this.filterStatus = val;
                    filterTabs.querySelectorAll('.filter-tab').forEach(t => t.removeClass('active'));
                    tab.addClass('active');
                    this.renderExpList();
                };
            }

            this.expListContainer = leftPanel.createDiv({ cls: 'exp-list-container' });

            // 加载数据
            this.allExperiments = await this.getExperiments();
            this.updateStats();
            this.renderExpList();

            // ── 右栏 ──
            const rightPanel = main.createDiv({ cls: 'scholarium-panel right-panel' });
            this.detailPanel = rightPanel;

            const firstExp = this.allExperiments[0];
            if (firstExp) {
                this.selectedExperiment = firstExp;
                this.showDetail(rightPanel, firstExp);
            } else {
                rightPanel.createEl('div', { text: '← 点击左侧实验记录查看详情，或点击"＋ 新建实验"开始。', cls: 'scholarium-placeholder' });
            }
        }
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

        let filtered = this.allExperiments;
        if (this.filterStatus !== 'all') filtered = filtered.filter(e => e.status === this.filterStatus);
        if (this.filterText.trim()) {
            const q = this.filterText.trim().toLowerCase();
            filtered = filtered.filter(e =>
                e.title.toLowerCase().includes(q) ||
                e.reagents.some(r => r.toLowerCase().includes(q)) ||
                e.results.toLowerCase().includes(q)
            );
        }

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
        const item = container.createDiv({ cls: 'exp-item' });
        if (this.selectedExperiment?.file.path === exp.file.path) item.addClass('selected');

        const icons: Record<string, string> = { completed: '✅', 'in-progress': '🔄', planned: '📋', failed: '❌' };
        item.createEl('span', { text: icons[exp.status] ?? '🔬', cls: 'exp-status-icon' });

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
        modal.innerHTML = `
            <div class="exp-del-modal">
                <div class="exp-del-modal-icon">🗑️</div>
                <div class="exp-del-modal-title">确认删除</div>
                <div class="exp-del-modal-body">将把 <strong>${exp.title}</strong> 移入系统回收站，此操作可通过回收站恢复。</div>
                <div class="exp-del-modal-btns">
                    <button class="exp-del-cancel">取消</button>
                    <button class="exp-del-confirm">删除</button>
                </div>
            </div>`;
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

        // Excalidraw 绘图
        const drawBtn = btnGroup.createEl('button', { text: '📐 绘图', cls: 'scholarium-btn' });
        drawBtn.onclick = () => this.openExcalidraw(exp);

        // ✏️ 内联编辑
        btnGroup.createEl('button', { text: '✏️ 编辑', cls: 'scholarium-btn' })
            .onclick = () => this.showDetailEdit(panel, exp);

        // AI 修改（携带笔记内容作为上下文）
        const aiBtn = btnGroup.createEl('button', { text: '🤖 AI 修改', cls: 'scholarium-btn ai-btn' });
        aiBtn.onclick = async () => {
            let nc = '';
            try { nc = await this.app.vault.read(exp.file); } catch { /* ignore */ }
            new AIChatModal(this.app, this.plugin, exp.file, nc).open();
        };

        // —— 状态（可点击改状态）+ 日期 ——
        const meta = panel.createDiv({ cls: 'detail-meta' });
        this.renderStatusPicker(meta, exp, panel);
        meta.createEl('span', { text: `📅 实验日期：${exp.date}`, cls: 'date-tag' });

        // ── 读取笔记正文（一次读取，共享内容）──
        let noteBody = '';
        try { noteBody = await this.app.vault.read(exp.file); } catch { /* ignore */ }

        // —— 1. 实验图片（最优先，放顶部）——
        await this.renderImages(panel, noteBody);

        // —— 2. 化学结构（reaction_smiles 优先，smiles 兜底）——
        const rawSmiles = exp.reaction_smiles || exp.smiles;
        const smilesStr = (rawSmiles || '').replace(/^["']|["']$/g, '').trim();
        if (smilesStr && smilesStr !== '""') {
            const isReaction = !!(exp.reaction_smiles && exp.reaction_smiles.replace(/^["']|["']$/g, '').trim());
            this.renderSmilesSection(panel, smilesStr, isReaction);
        }

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
        closeBtn.innerHTML = '✕';
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
        prevBtn.innerHTML = '‹';
        prevBtn.onclick = (e) => { e.stopPropagation(); navigate(-1); };

        const nextBtn = document.createElement('button');
        nextBtn.className = 'img-lightbox-nav img-lightbox-next';
        nextBtn.innerHTML = '›';
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

    // ───── 化学结构渲染入口 ─────
    renderSmilesSection(panel: HTMLElement, smiles: string, isReaction: boolean) {
        const sec = panel.createDiv({ cls: 'detail-section' });
        sec.createEl('h4', { text: isReaction ? '⚗️ 反应方程式' : '⚗️ 化学结构', cls: 'section-title' });

        const canvasWrap = sec.createDiv({ cls: 'canvas-wrap' });
        const canvas = canvasWrap.createEl('canvas', { cls: 'smiles-canvas' });
        canvas.width  = isReaction ? 600 : 480;
        canvas.height = isReaction ? 240 : 200;
        // 分配唯一 ID，供 smiles-drawer 使用
        canvas.id = 'scholarium-canvas-' + Date.now() + '-' + Math.floor(Math.random() * 10000);

        sec.createEl('code', { text: smiles, cls: 'smiles-text' });

        const copyBtn = sec.createEl('button', { text: '📋 复制 SMILES', cls: 'scholarium-btn smiles-copy-btn' });
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(smiles).then(() => {
                copyBtn.setText('✅ 已复制！');
                setTimeout(() => copyBtn.setText('📋 复制 SMILES'), 2000);
            });
        };

        // 延迟渲染（等 canvas 挂载到 DOM）
        setTimeout(() => {
            if (isReaction) this.drawReactionSmiles(smiles, canvas);
            else            this.drawSmiles(smiles, canvas);
        }, 150);
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
            const div = sec.createDiv({ cls: 'steps-content' });
            div.innerHTML = steps
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/^(\d+\.\s+)/gm, '<span class="step-num">$1</span>')
                .replace(/\n/g, '<br>');
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
        try { noteContent = await this.app.vault.read(exp.file); } catch { /* ignore */ }

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
    async getExperiments(): Promise<ExperimentNote[]> {
        const results: ExperimentNote[] = [];
        for (const file of this.app.vault.getMarkdownFiles()) {
            try {
                const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                if (fm?.type === 'experiment') {
                    // 日期优先级：frontmatter.date > 文件名中的日期 > ctime（创建时间，不是修改时间）
                    const filenameDate = file.basename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
                    const fallbackDate = filenameDate || (new Date(file.stat.ctime).toISOString().split('T')[0] ?? '');
                    const date: string = (typeof fm.date === 'string' ? fm.date : undefined) ?? fallbackDate;

                    results.push({
                        file,
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
            } catch { /* skip */ }
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
                const g = await (await fetch('https://ipapi.co/json/')).json() as { latitude: number; longitude: number; city: string };
                lat = g.latitude; lon = g.longitude; city = g.city ?? '';
            }
            const d = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`)).json() as { current: { temperature_2m: number; weather_code: number } };
            const c = d.current;
            el.setText(`${this.weatherIcon(c.weather_code)} ${Math.round(c.temperature_2m)}°C ${this.weatherDesc(c.weather_code)}${city ? ' · ' + city : ''}`);
        } catch { el.setText('🌡 天气暂不可用'); }
    }

    weatherIcon(c: number) { return c === 0 ? '☀️' : c <= 3 ? '⛅' : c <= 49 ? '🌫' : c <= 67 ? '🌧' : c <= 77 ? '❄️' : c <= 82 ? '🌦' : '⛈'; }
    weatherDesc(c: number) { return c === 0 ? '晴' : c <= 3 ? '多云' : c <= 49 ? '有雾' : c <= 67 ? '有雨' : c <= 77 ? '有雪' : c <= 82 ? '阵雨' : '雷雨'; }

    // ───── 新建实验 ─────
    async createNewExperiment() {
        const folder = this.plugin.settings.experimentsFolder;
        const date = new Date().toISOString().split('T')[0];
        const ts = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
        const path = `${folder ? folder + '/' : ''}实验记录_${date}_${ts}.md`;
        const tpl = `---
type: experiment
title: 新实验_${date}
date: ${date}
status: in-progress
smiles: ""
reaction_smiles: ""
reagents:
  - 试剂A
  - 试剂B
results: ""
bookmarked: false
excalidraw: ""
tags: [experiment]
---

# 新实验

## 实验目的


## 实验步骤

1. 步骤一
2. 步骤二

## 实验结果


## 实验图片

（在此粘贴截图，格式：![[图片文件名.png]]）

## 注意事项

`;
        try {
            if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
            const f = await this.app.vault.create(path, tpl);
            await this.app.workspace.getLeaf(false).openFile(f);
        } catch (e) { console.error('[ChemELN] 创建实验笔记失败:', e); }
    }
}
