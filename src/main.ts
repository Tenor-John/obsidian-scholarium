import { Plugin, WorkspaceLeaf } from 'obsidian';
import { DASHBOARD_VIEW_TYPE, DashboardView } from './dashboard-view';
import { ChemELNSettingTab, DEFAULT_SETTINGS } from './settings';
import type { ChemELNSettings } from './settings';
import { AIAssistantModal } from './ai-assistant-modal';
import type { ExperimentContext } from './ai-assistant-modal';
import { CloudSyncManager, buildSyncConfig } from './cloud-sync';

export default class ChemELNPlugin extends Plugin {
    settings: ChemELNSettings;
    syncManager: CloudSyncManager | null = null;

    // ─── CSS 主题变量注入 ─────────────────────────────────
    injectThemeVars(): void {
        const existing = document.getElementById('scholarium-theme-vars');
        if (existing) existing.remove();

        const { themeAccent, themeGradient, themeAlpha } = this.settings;

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
        const light  = toHex(ac.r + (255 - ac.r) * 0.22, ac.g + (255 - ac.g) * 0.22, ac.b + (255 - ac.b) * 0.22);
        const medium = toHex(ac.r * 0.90, ac.g * 0.90, ac.b * 0.90);
        const deeper = toHex(ac.r * 0.70, ac.g * 0.70, ac.b * 0.70);

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
}`;
        document.head.appendChild(style);
    }

    async onload() {
        await this.loadSettings();
        this.injectThemeVars();

        // 注册仪表盘视图
        this.registerView(
            DASHBOARD_VIEW_TYPE,
            (leaf) => new DashboardView(leaf, this)
        );

        // 左侧栏按钮：点击打开仪表盘
        this.addRibbonIcon('flask-conical', '打开化学实验记录本', () => {
            this.activateDashboard();
        });

        // 命令面板命令
        this.addCommand({
            id: 'open-chem-dashboard',
            name: '打开化学实验仪表盘',
            callback: () => this.activateDashboard(),
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
            name: '打开 AI 实验助理',
            callback: () => this.openAIAssistant(),
        });

        // 设置页
        this.addSettingTab(new ChemELNSettingTab(this.app, this));

        // 初始化云同步
        this.initCloudSync();

        // 启动时自动打开
        if (this.settings.openOnStartup) {
            this.app.workspace.onLayoutReady(() => this.activateDashboard());
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
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.injectThemeVars();       // 颜色变化立即生效
        this.initCloudSync();
        this.refreshDashboards();     // 重渲染所有面板
    }

    openAIAssistant(context?: ExperimentContext) {
        new AIAssistantModal(this, context).open();
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
