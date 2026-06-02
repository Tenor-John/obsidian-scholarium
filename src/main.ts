import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DASHBOARD_VIEW_TYPE, DashboardView } from './dashboard-view';
import { ChemELNSettingTab, DEFAULT_SETTINGS } from './settings';
import type { ChemELNSettings } from './settings';
import type { ExperimentContext } from './ai-assistant-modal';
import { CloudSyncManager, buildSyncConfig } from './cloud-sync';
import { AIChatModal } from './ai-chat-modal';
import { SCHOLARIUM_ACCENTS, accentVarsFromHex, scholariumThemeCss } from './theme/tokens';
import type { AccentKey, ThemeKey } from './theme/tokens';
import { openInsertChemModal, registerChemMarkdown } from './chem/chem-markdown';

export default class ChemELNPlugin extends Plugin {
    settings: ChemELNSettings;
    syncManager: CloudSyncManager | null = null;
    private saveQueue: Promise<void> = Promise.resolve();
    private themeObserver: MutationObserver | null = null;

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
        const existing = document.getElementById('scholarium-theme-vars');
        if (existing) existing.remove();

        const { themeAccent, themeGradient, themeAlpha } = this.settings;
        const fontScaleMap: Record<string, number> = {
            small: 0.92,
            medium: 1,
            large: 1.12,
            xlarge: 1.24,
        };
        const fontScale = fontScaleMap[this.settings.fontSize] ?? 1;

        const hexRgb = (hex: string): string => {
            const c = hex.replace('#', '');
            const r = parseInt(c.slice(0, 2), 16);
            const g = parseInt(c.slice(2, 4), 16);
            const b = parseInt(c.slice(4, 6), 16);
            return `${r}, ${g}, ${b}`;
        };

        const hexComp = (hex: string) => ({
            r: parseInt(hex.slice(1, 3), 16),
            g: parseInt(hex.slice(3, 5), 16),
            b: parseInt(hex.slice(5, 7), 16),
        });
        const toHex = (r: number, g: number, b: number): string =>
            `#${[r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

        const ac = hexComp(themeAccent);
        const light = toHex(ac.r + (255 - ac.r) * 0.22, ac.g + (255 - ac.g) * 0.22, ac.b + (255 - ac.b) * 0.22);
        const medium = toHex(ac.r * 0.90, ac.g * 0.90, ac.b * 0.90);
        const deeper = toHex(ac.r * 0.70, ac.g * 0.70, ac.b * 0.70);

        const resolvedTheme = this.resolveTheme();
        const style = document.createElement('style');
        style.id = 'scholarium-theme-vars';
        style.textContent = `
:root {
    --celn-accent:            ${themeAccent};
    --celn-accent-rgb:        ${hexRgb(themeAccent)};
    --celn-accent-light:      ${light};
    --celn-accent-light-rgb:  ${hexRgb(light)};
    --celn-accent-medium:     ${medium};
    --celn-accent-medium-rgb: ${hexRgb(medium)};
    --celn-accent-dark:       ${themeGradient};
    --celn-accent-dark-rgb:   ${hexRgb(themeGradient)};
    --celn-accent-deeper:     ${deeper};
    --celn-alpha:             ${themeAlpha};
    --scholarium-font-scale:  ${fontScale};
    --scholarium-font-size:   ${14 * fontScale}px;
    --scholarium-space-scale: ${Math.max(1, fontScale)};
}
${scholariumThemeCss(resolvedTheme, this.settings.accent, this.settings.density, this.settings.themeAccent)}`;
        document.head.appendChild(style);
        document.querySelectorAll<HTMLElement>('.scholarium-root').forEach((root) => this.applyThemeAttributes(root));
    }

    applyThemeAttributes(root: HTMLElement): void {
        root.addClass('scholarium-root');
        const resolvedTheme = this.resolveTheme();
        root.dataset.theme = resolvedTheme;
        root.dataset.themeMode = this.settings.theme;
        root.dataset.accent = this.settings.accent;
        const customAccent = accentVarsFromHex(this.settings.themeAccent, resolvedTheme);
        const accent = this.settings.accent === 'custom'
            ? {
                ...customAccent,
                soft: `rgba(${customAccent.rgb}, ${this.settings.themeAlpha})`,
                deep: this.settings.themeGradient,
            }
            : SCHOLARIUM_ACCENTS[this.settings.accent];
        root.style.setProperty('--accent', accent.base);
        root.style.setProperty('--accent-rgb', accent.rgb);
        root.style.setProperty('--accent-dim', accent.soft);
        root.style.setProperty('--accent-deep', accent.deep);
        root.style.setProperty('--accent-text', accent.text);
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

        this.addRibbonIcon('flask-conical', '打开 Scholarium', () => {
            void this.activateDashboard();
        });

        this.addCommand({
            id: 'open-chem-dashboard',
            name: '打开 Scholarium',
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

        this.addCommand({
            id: 'insert-chem-structure',
            name: '插入化学结构',
            callback: () => openInsertChemModal(this, 'reaction'),
        });

        this.addSettingTab(new ChemELNSettingTab(this.app, this));
        this.initCloudSync();

        if (this.settings.openOnStartup) {
            this.app.workspace.onLayoutReady(() => void this.activateDashboard());
        }
    }

    onunload() {
        this.syncManager?.destroy();
        document.getElementById('scholarium-theme-vars')?.remove();
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
            if (leaf) workspace.revealLeaf(leaf);
            return;
        }

        const leaf: WorkspaceLeaf = workspace.getLeaf(false);
        await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
        workspace.revealLeaf(leaf);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<ChemELNSettings>);
        this.settings.pluginDisplayName = 'scholarium';
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
            this.settings.accent = selectedAccent as AccentKey;
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
