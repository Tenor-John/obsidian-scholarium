import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DASHBOARD_VIEW_TYPE, DashboardView } from './dashboard-view';
import { ChemELNSettingTab, DEFAULT_SETTINGS } from './settings';
import type { ChemELNSettings } from './settings';
import type { ExperimentContext } from './ai-assistant-modal';
import { CloudSyncManager, buildSyncConfig } from './cloud-sync';
import { AIChatModal } from './ai-chat-modal';
import { SCHOLARIUM_ACCENTS, SCHOLARIUM_DENSITY, SCHOLARIUM_SEMANTIC, SCHOLARIUM_THEMES, accentVarsFromHex } from './theme/tokens';
import type { AccentKey, ThemeKey } from './theme/tokens';
import { registerChemMarkdown } from './chem/chem-markdown';
import { registerChemInsertionControls } from './chem/chem-controls';

export default class ChemELNPlugin extends Plugin {
    settings: ChemELNSettings;
    syncManager: CloudSyncManager | null = null;
    private saveQueue: Promise<void> = Promise.resolve();
    private themeObserver: MutationObserver | null = null;
    private tabTitleObserver: MutationObserver | null = null;
    private tabTitleFrame: number | null = null;

    updateData(mutator: (data: Record<string, unknown>) => void): Promise<void> {
        const run = this.saveQueue.then(async () => {
            const raw = ((await this.loadData()) as Record<string, unknown> | null) ?? {};
            mutator(raw);
            await this.saveData(raw);
        });
        this.saveQueue = run.catch((error) => {
            console.error('[Scholarium] Failed to persist plugin data:', error);
        });
        return run;
    }

    injectThemeVars(): void {
        document.querySelectorAll<HTMLElement>('.scholarium-root').forEach((root) => this.applyThemeAttributes(root));
    }

    applyThemeAttributes(root: HTMLElement): void {
        root.addClass('scholarium-root');
        const resolvedTheme = this.resolveTheme();
        root.dataset.theme = resolvedTheme;
        root.dataset.themeMode = this.settings.theme;
        root.dataset.accent = this.settings.accent;
        const theme = SCHOLARIUM_THEMES[resolvedTheme];
        const density = SCHOLARIUM_DENSITY[this.settings.density] ?? SCHOLARIUM_DENSITY.regular;
        const fontScale = { small: 0.92, medium: 1, large: 1.12, xlarge: 1.24 }[this.settings.fontSize] ?? 1;
        const customAccent = accentVarsFromHex(this.settings.themeAccent, resolvedTheme);
        const accent = this.settings.accent === 'custom'
            ? {
                ...customAccent,
                soft: `rgba(${customAccent.rgb}, ${this.settings.themeAlpha})`,
                deep: this.settings.themeGradient,
            }
            : SCHOLARIUM_ACCENTS[this.settings.accent];
        const vars: Record<string, string> = {
            '--bg-base': theme.bg,
            '--bg-panel': theme.bgDeep,
            '--bg-surface': theme.surface,
            '--bg-elevated': theme.surface2,
            '--text-primary': theme.ink,
            '--text-secondary': theme.ink2,
            '--text-muted': theme.mute,
            '--text-placeholder': theme.muteSoft,
            '--border': theme.line,
            '--border-soft': theme.lineSoft,
            '--sch-pad': `${density.pad}px`,
            '--sch-gap': `${density.gap}px`,
            '--sch-radius': `${density.radius}px`,
            '--sch-radius-inset': `${Math.max(4, density.radius - 4)}px`,
            '--sch-body': `${density.body}px`,
            '--sch-h1': `${density.h1}px`,
            '--scholarium-font-scale': String(fontScale),
            '--scholarium-font-size': `${14 * fontScale}px`,
            '--scholarium-space-scale': String(Math.max(1, fontScale)),
        };
        for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value);
        root.style.setProperty('--accent', accent.base);
        root.style.setProperty('--accent-rgb', accent.rgb);
        root.style.setProperty('--accent-dim', accent.soft);
        root.style.setProperty('--accent-deep', accent.deep);
        root.style.setProperty('--accent-text', accent.text);
        for (const [key, value] of Object.entries(SCHOLARIUM_SEMANTIC)) {
            root.style.setProperty(`--sch-${key}`, value.base);
            root.style.setProperty(`--sch-${key}-fg`, value.fg);
            root.style.setProperty(`--sch-${key}-bg`, value.bg);
        }
    }

    resolveTheme(): ThemeKey {
        if (this.settings.theme === 'light' || this.settings.theme === 'dark') return this.settings.theme;
        if (document.body.classList.contains('theme-dark')) return 'dark';
        if (document.body.classList.contains('theme-light')) return 'light';
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    async onload() {
        await this.loadSettings();
        this.injectThemeVars();
        this.registerEvent(this.app.workspace.on('css-change', () => this.injectThemeVars()));
        this.registerEvent(this.app.workspace.on('layout-change', () => this.scheduleScholariumTabTitleRestore()));
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.scheduleScholariumTabTitleRestore()));
        this.app.workspace.onLayoutReady(() => this.scheduleScholariumTabTitleRestore());
        this.tabTitleObserver = new MutationObserver(() => this.scheduleScholariumTabTitleRestore());
        this.tabTitleObserver.observe(this.app.workspace.containerEl, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'aria-label', 'title'],
        });
        this.register(() => {
            this.tabTitleObserver?.disconnect();
            this.tabTitleObserver = null;
            if (this.tabTitleFrame !== null) {
                window.cancelAnimationFrame(this.tabTitleFrame);
                this.tabTitleFrame = null;
            }
        });
        this.themeObserver = new MutationObserver(() => this.injectThemeVars());
        this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        this.register(() => {
            this.themeObserver?.disconnect();
            this.themeObserver = null;
        });
        const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
        const handleColorSchemeChange = () => {
            this.injectThemeVars();
        };
        colorScheme?.addEventListener('change', handleColorSchemeChange);
        this.register(() => colorScheme?.removeEventListener('change', handleColorSchemeChange));

        this.registerView(
            DASHBOARD_VIEW_TYPE,
            (leaf) => new DashboardView(leaf, this)
        );
        registerChemMarkdown(this);
        registerChemInsertionControls(this);

        this.addRibbonIcon('flask-conical', '打开工作台', () => {
            void this.activateDashboard();
        });

        this.addCommand({
            id: 'open-chem-dashboard',
            name: '打开工作台',
            callback: () => void this.activateDashboard(),
        });

        this.addCommand({
            id: 'new-experiment',
            name: '新建实验记录',
            callback: async () => {
                await this.activateDashboard();
            },
        });

        this.addCommand({
            id: 'open-ai-assistant',
            name: '打开 AI 实验助手',
            callback: () => this.openAIAssistant(),
        });

        this.addCommand({
            id: 'image-to-experiment',
            name: '图片识别生成实验记录',
            callback: () => this.openImageLab(),
        });

        this.addSettingTab(new ChemELNSettingTab(this.app, this));
        this.initCloudSync();

        if (this.settings.openOnStartup) {
            this.app.workspace.onLayoutReady(() => void this.activateDashboard());
        }
    }

    onunload() {
        this.syncManager?.destroy();
    }

    private initCloudSync(): void {
        if (this.syncManager) {
            this.syncManager.destroy();
            this.syncManager = null;
        }

        if (this.settings.cloudProvider !== 'none') {
            this.syncManager = new CloudSyncManager(this.app, this, buildSyncConfig(this.settings));
            this.syncManager.startAutoSync();

            const dashboardLeaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
            for (const leaf of dashboardLeaves) {
                const view = leaf.view;
                if (view instanceof DashboardView) {
                    view.setSyncManager(this.syncManager);
                }
            }
        }
    }

    async activateDashboard() {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
        if (existing.length > 0) {
            const leaf = existing[0];
            if (leaf) void workspace.revealLeaf(leaf);
            this.scheduleScholariumTabTitleRestore();
            return;
        }

        const leaf: WorkspaceLeaf = workspace.getLeaf(false);
        await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
        void workspace.revealLeaf(leaf);
        this.scheduleScholariumTabTitleRestore();
    }

    private scheduleScholariumTabTitleRestore(): void {
        if (this.tabTitleFrame !== null) window.cancelAnimationFrame(this.tabTitleFrame);
        this.tabTitleFrame = window.requestAnimationFrame(() => {
            this.tabTitleFrame = null;
            this.restoreScholariumTabTitle();
        });
    }

    private restoreScholariumTabTitle(): void {
        const label = this.settings?.pluginDisplayName?.trim() || 'Scholarium';
        const repairedHeaders = new Set<HTMLElement>();
        for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)) {
            const header = (leaf as WorkspaceLeaf & { tabHeaderEl?: HTMLElement }).tabHeaderEl;
            if (!header) continue;
            this.applyScholariumTabTitle(header, label);
            repairedHeaders.add(header);
        }

        const headers = this.app.workspace.containerEl.querySelectorAll<HTMLElement>('.workspace-tab-header');

        for (const header of Array.from(headers)) {
            if (repairedHeaders.has(header)) continue;
            const title = header.querySelector<HTMLElement>('.workspace-tab-header-inner-title');
            const inner = header.querySelector<HTMLElement>('.workspace-tab-header-inner');
            const rawLabel = [
                header.getAttribute('aria-label'),
                header.getAttribute('title'),
                title?.textContent,
            ].filter(Boolean).join(' ').toLowerCase();
            const isScholariumHeader = rawLabel.includes('scholarium');

            if (!isScholariumHeader) {
                if (header.hasClass('scholarium-native-tab-title')) {
                    this.clearScholariumTabTitleStyles(header, inner, title);
                }
                continue;
            }
            this.applyScholariumTabTitle(header, label);
        }
    }

    private applyScholariumTabTitle(header: HTMLElement, label: string): void {
        let title = header.querySelector<HTMLElement>('.workspace-tab-header-inner-title');
        const inner = header.querySelector<HTMLElement>('.workspace-tab-header-inner');
        if (!title && inner) {
            title = inner.createSpan({ cls: 'workspace-tab-header-inner-title' });
            title.dataset.scholariumInjectedTitle = 'true';
        }
        if (!title) return;

        header.addClass('scholarium-native-tab-title');
        header.setAttribute('aria-label', label);
        header.setAttribute('title', label);
        inner?.addClass('scholarium-native-tab-title-inner');
        title.removeClass('is-hidden');
        title.addClass('scholarium-native-tab-title-text');
        title.dataset.scholariumInjectedTitle = 'true';
        title.setText(label);
    }

    private clearScholariumTabTitleStyles(header: HTMLElement, inner: HTMLElement | null, title: HTMLElement | null): void {
        header.removeClass('scholarium-native-tab-title');
        header.removeAttribute('title');
        inner?.removeClass('scholarium-native-tab-title-inner');
        if (!title) return;
        title.removeClass('scholarium-native-tab-title-text');
        if (title.dataset.scholariumInjectedTitle === 'true') {
            title.textContent = '';
            delete title.dataset.scholariumInjectedTitle;
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ChemELNSettings>);
        this.settings.pluginDisplayName = 'Scholarium';
        this.settings.notebookSidebarWidth = Math.min(440, Math.max(280, Number(this.settings.notebookSidebarWidth) || 300));
        this.settings.theme = 'system';
        const legacyAccents: Record<string, AccentKey> = {
            emerald: 'green',
            indigo: 'blue',
            plum: 'purple',
        };
        const storedHex = this.settings.themeAccent.toLowerCase();
        const matchingPreset = Object.entries(SCHOLARIUM_ACCENTS)
            .find(([, preset]) => preset.base.toLowerCase() === storedHex)?.[0] as AccentKey | undefined;
        const selectedAccent = legacyAccents[String(this.settings.accent)] ?? this.settings.accent;
        if (matchingPreset) {
            this.settings.accent = matchingPreset;
        } else if (/^#[0-9a-f]{6}$/i.test(this.settings.themeAccent)) {
            this.settings.accent = 'custom';
        } else if (Object.prototype.hasOwnProperty.call(SCHOLARIUM_ACCENTS, selectedAccent)) {
            this.settings.accent = selectedAccent;
            this.settings.themeAccent = SCHOLARIUM_ACCENTS[selectedAccent as keyof typeof SCHOLARIUM_ACCENTS].base;
            this.settings.themeGradient = SCHOLARIUM_ACCENTS[selectedAccent as keyof typeof SCHOLARIUM_ACCENTS].deep;
        } else {
            this.settings.accent = 'green';
            this.settings.themeAccent = SCHOLARIUM_ACCENTS.green.base;
            this.settings.themeGradient = SCHOLARIUM_ACCENTS.green.deep;
        }
    }

    async saveSettings() {
        await this.updateData((data) => {
            Object.assign(data, this.settings);
        });
        this.injectThemeVars();
        this.initCloudSync();
        this.refreshDashboards();
    }

    async openAIAssistant(context?: ExperimentContext) {
        const targetFile = context
            ? this.app.vault.getMarkdownFiles().find((file) => file.path === context.filePath)
            : undefined;
        const noteContent = targetFile ? await this.app.vault.read(targetFile) : undefined;
        new AIChatModal(this.app, this, targetFile, noteContent).open();
    }

    openImageLab() {
        new AIChatModal(this.app, this, undefined, undefined, true).open();
    }

    refreshDashboards() {
        const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
        for (const leaf of leaves) {
            const view = leaf.view;
            if (view instanceof DashboardView) {
                void view.render();
            }
        }
    }
}
