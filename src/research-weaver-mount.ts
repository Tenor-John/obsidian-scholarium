import { App, FileSystemAdapter, Platform, requestUrl } from 'obsidian';
import ChemELNPlugin from './main';
import { describeMountState, buildWeaverEntryUrl } from './research-weaver-mount-state';
import type { WeaverConnectionState } from './research-weaver-mount-state';
import { WEAVER_LOCAL_URL } from './weaver-constants';
import { checkReadiness, listProjects, scanExperimentOutcomes, ScholariumStateError } from './bridge-client';
import type { ProjectSummary, ExperimentOutcomeScan } from './bridge-client';

const WEAVER_HEALTH_RETRY_MS = 250;
const WEAVER_START_ATTEMPTS = 50;

// Obsidian's lint rules forbid importing Node built-ins (`import/no-nodejs-modules`),
// even dynamically, so we reach them the same way every desktop-only plugin does:
// through Electron's `window.require`. These are structural types for only the
// handful of calls this file makes — enough to keep the compiler and linter honest
// without pulling in `@types/node`'s ambient globals.
interface NodeRequireLike {
    (id: 'node:path'): { join(...parts: string[]): string; dirname(p: string): string };
    (id: 'node:fs'): { existsSync(p: string): boolean };
    (id: 'node:child_process'): {
        spawn(
            command: string,
            args: string[],
            options: { cwd?: string; stdio?: string; windowsHide?: boolean; shell?: boolean },
        ): unknown;
    };
}

/**
 * What the project-context header (M2) currently knows about the Bridge's
 * read-only Scholarium channel. Independent of `connection` above: that
 * tracks the canvas launcher's own static page (WEAVER_LOCAL_URL `/`);
 * this tracks GET /v1/scholarium/status + /v1/scholarium/state behind its
 * `/bridge/*` proxy, which can be unavailable (channel disabled, vaultRoot
 * unset) even while the launcher itself answers fine.
 */
type ProjectContextState =
    | { kind: 'loading' }
    | { kind: 'unavailable'; message: string }
    | { kind: 'ready' };

/**
 * Minimal mount for the Research Weaver ("织研者") local companion app.
 *
 * Research Weaver (`agent-canvas-demo/`) is a separate, unbundled static web
 * app plus a local Bridge server that ships alongside this plugin but is not
 * part of the compiled main.js — it runs as its own Node process on
 * 127.0.0.1:4173. This module's job is:
 *
 *   1. make sure the local launcher (`agent-canvas-demo/start-local.js`) is
 *      running, starting it on demand via Obsidian's desktop Node access;
 *   2. embed the running app in an iframe that tracks the Obsidian
 *      light/dark theme;
 *   3. show an understandable status (connecting / error) instead of a
 *      blank iframe while that launcher is still starting or failed;
 *   4. (M2) read the current topic's confirmed Project/Experiment/Evidence/
 *      Hypothesis state through the Bridge's existing read-only channel
 *      (src/bridge-client.ts) and show it natively above the iframe, so a
 *      researcher can see what is actually confirmed before opening the
 *      chat to ask Research Weaver for a next-step suggestion.
 *
 * All of the pure state → UI decisions for (1)-(3) live in the
 * dependency-free ./research-weaver-mount-state.js, and the pure response
 * classification for (4) lives in ./bridge-state-response.js, so both are
 * unit-testable without an Obsidian/DOM harness — this file only wires
 * those decisions to real Obsidian and DOM calls.
 *
 * It deliberately does not talk to any Project/Experiment/Evidence *write*
 * APIs (POST /v1/scholarium/actions) and does not generate suggestions
 * itself — that reasoning already runs inside Research Weaver's own chat
 * (agent-canvas-demo/research-chat-core.js), which already treats this same
 * read-only state as its single fact source. The "在织研者中生成建议" button
 * here only focuses that existing, already-reviewed chat surface; it does
 * not duplicate its logic. Institution-specific (e.g. USTC WebVPN) access
 * is out of scope for this file entirely (see the migration map, §4-5).
 *
 * Desktop-only: agent-canvas-demo's launcher is a Node child process, which
 * mobile Obsidian cannot spawn. render() shows a plain notice on mobile
 * instead of touching any Node API.
 */
export class ResearchWeaverPanel {
    private container: HTMLElement | null = null;
    private headerEl: HTMLElement | null = null;
    private bodyEl: HTMLElement | null = null;
    private frame: HTMLIFrameElement | null = null;
    private themeObserver: MutationObserver | null = null;
    private starting: Promise<void> | null = null;
    private connection: WeaverConnectionState = 'idle';
    private lastError: string | undefined;

    private projectContext: ProjectContextState = { kind: 'loading' };
    private projects: ProjectSummary[] = [];
    private selectedDisplayId: string | null = null;
    private outcomeScan: ExperimentOutcomeScan | null = null;
    private outcomeScanError: string | null = null;

    constructor(private app: App, private plugin: ChemELNPlugin) {}

    async load(): Promise<void> {
        // Nothing to preload; the local service is started lazily on first render.
        return Promise.resolve();
    }

    render(container: HTMLElement): void {
        this.container = container;
        container.empty();
        this.headerEl = container.createDiv({ cls: 'scholarium-weaver-header' });
        this.bodyEl = container.createDiv({ cls: 'scholarium-weaver-body' });
        this.repaint();
        this.ensureThemeSync();
        void this.ensureRunning();
        void this.loadProjectContext();
    }

    destroy(): void {
        this.themeObserver?.disconnect();
        this.themeObserver = null;
        this.container = null;
        this.headerEl = null;
        this.bodyEl = null;
        // The local Bridge/launcher is a long-lived shared process — other
        // panels or a future re-open of this tab may still want it, so we
        // deliberately do not kill it here.
    }

    private repaint(): void {
        this.paintHeader();
        this.paintBody();
    }

    /** Re-render the iframe/placeholder into its last-known body container. */
    private paintBody(): void {
        const container = this.bodyEl;
        if (!container) return;
        const state = describeMountState(Platform.isDesktopApp, this.connection, this.lastError);

        if (state.kind !== 'ready') {
            this.frame = null;
            container.empty();
            container.createEl('p', {
                text: state.text,
                cls: `scholarium-placeholder scholarium-weaver-status is-${state.kind}`,
            });
            return;
        }

        if (!this.frame) {
            container.empty();
            this.frame = container.createEl('iframe', {
                attr: {
                    src: buildWeaverEntryUrl(WEAVER_LOCAL_URL, this.resolveTheme()),
                    sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads',
                },
            });
            this.frame.setCssStyles({ width: '100%', height: '100%', border: '0' });
        } else if (this.frame.parentElement !== container) {
            container.empty();
            container.appendChild(this.frame);
        }
    }

    /**
     * Re-render the project-context header: Bridge read-channel status, a
     * project picker, the selected project's confirmed-state summary, and
     * the "在织研者中生成建议" entry point into the (already-mounted, already
     * reviewed) chat below. Safe to call at any point — independent of
     * paintBody()'s iframe lifecycle.
     */
    private paintHeader(): void {
        const el = this.headerEl;
        if (!el) return;
        el.empty();

        if (this.projectContext.kind === 'loading') {
            el.createEl('p', { text: '正在读取课题状态…', cls: 'scholarium-weaver-context-status' });
            return;
        }
        if (this.projectContext.kind === 'unavailable') {
            el.createEl('p', { text: this.projectContext.message, cls: 'scholarium-weaver-context-status is-error' });
            return;
        }

        const row = el.createDiv({ cls: 'scholarium-weaver-picker-row' });
        const select = row.createEl('select', { cls: 'scholarium-weaver-project-select' });
        select.createEl('option', { text: '选择课题…', value: '' });
        for (const project of this.projects) {
            select.createEl('option', {
                text: `${project.display_id} · ${project.title || '(未命名)'}`,
                value: project.display_id,
            });
        }
        select.value = this.selectedDisplayId || '';
        select.addEventListener('change', () => {
            this.selectedDisplayId = select.value || null;
            void this.onProjectSelected();
        });

        const genBtn = row.createEl('button', { text: '在织研者中生成建议', cls: 'scholarium-weaver-generate-btn' });
        genBtn.disabled = !this.selectedDisplayId || this.connection !== 'ready';
        genBtn.title = this.connection !== 'ready'
            ? '等待织研者本地服务连接完成'
            : !this.selectedDisplayId
                ? '先选择一个课题'
                : '滚动到下方的织研者面板，在其中针对该课题继续对话生成建议（生成与写入仍需你在聊天里逐步确认）';
        genBtn.addEventListener('click', () => {
            this.frame?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            this.frame?.focus();
        });

        if (!this.projects.length) {
            el.createEl('p', {
                text: '未发现任何课题（当前研究库中没有 project 对象，或尚未创建）。',
                cls: 'scholarium-weaver-context-status',
            });
            return;
        }

        if (!this.selectedDisplayId) return;
        const project = this.projects.find((p) => p.display_id === this.selectedDisplayId);
        if (!project) return;

        const summaryEl = el.createDiv({ cls: 'scholarium-weaver-project-summary' });
        summaryEl.createEl('p', {
            text: `${project.title || '(未命名)'} · ${project.status || '未标注状态'} / ${project.stage || '未标注阶段'}`,
        });
        summaryEl.createEl('p', {
            text: `问题 ${project.counts.questions}（未决 ${project.open_questions}） · 假设 ${project.counts.hypotheses} · 实验 ${project.counts.experiments}（待整合 ${project.unsettled_experiments}） · 证据 ${project.counts.evidence}`,
            cls: 'scholarium-weaver-project-counts',
        });
        if (this.outcomeScanError) {
            summaryEl.createEl('p', { text: this.outcomeScanError, cls: 'scholarium-weaver-context-status is-error' });
        } else if (this.outcomeScan) {
            summaryEl.createEl('p', {
                text: `等待结果整合的实验 ${this.outcomeScan.awaiting_integration.length} 个 · 进行中 ${this.outcomeScan.in_progress.length} 个`,
                cls: 'scholarium-weaver-project-counts',
            });
        }
    }

    private resolveTheme(): 'light' | 'dark' {
        return activeDocument.body.classList.contains('theme-light') ? 'light' : 'dark';
    }

    private ensureThemeSync(): void {
        if (this.themeObserver) return;
        let lastTheme = this.resolveTheme();
        this.themeObserver = new MutationObserver(() => {
            const theme = this.resolveTheme();
            if (theme === lastTheme || !this.frame) return;
            lastTheme = theme;
            try {
                const u = new URL(this.frame.src);
                if (u.origin !== new URL(WEAVER_LOCAL_URL).origin) return;
                u.searchParams.set('theme', theme);
                u.searchParams.set('embedded', String(Date.now()));
                this.frame.src = u.toString();
            } catch {
                /* ignore cross-origin / malformed URL edge cases */
            }
        });
        this.themeObserver.observe(activeDocument.body, { attributes: true, attributeFilter: ['class'] });
    }

    private async health(): Promise<void> {
        await requestUrl({ url: WEAVER_LOCAL_URL, method: 'GET' });
    }

    private async ensureRunning(): Promise<void> {
        if (this.starting) {
            await this.starting;
            return;
        }
        if (!Platform.isDesktopApp) return;

        this.connection = 'connecting';
        this.lastError = undefined;
        this.repaint();

        this.starting = (async () => {
            try {
                await this.health();
                return;
            } catch {
                /* not running yet; fall through and start it below */
            }

            const adapter = this.app.vault.adapter;
            if (!(adapter instanceof FileSystemAdapter)) {
                throw new Error('织研者仅支持桌面端 Obsidian（需要本机文件系统访问）');
            }

            const req = (window as unknown as { require?: NodeRequireLike }).require;
            if (!req) throw new Error('Obsidian 未提供本机 Node 接口，无法启动织研者本地服务');
            const path = req('node:path');
            const fs = req('node:fs');
            const cp = req('node:child_process');

            const launcher = path.join(
                adapter.getBasePath(),
                this.app.vault.configDir,
                'plugins',
                this.plugin.manifest.id,
                'agent-canvas-demo',
                'start-local.js',
            );
            if (!fs.existsSync(launcher)) throw new Error('未找到 agent-canvas-demo/start-local.js');

            cp.spawn('node', [launcher], {
                cwd: path.dirname(launcher),
                stdio: 'ignore',
                windowsHide: true,
                shell: false,
            });

            let lastError: unknown;
            for (let attempt = 0; attempt < WEAVER_START_ATTEMPTS; attempt += 1) {
                try {
                    await this.health();
                    return;
                } catch (error) {
                    lastError = error;
                    await new Promise<void>((resolve) => window.setTimeout(resolve, WEAVER_HEALTH_RETRY_MS));
                }
            }
            throw lastError instanceof Error ? lastError : new Error('织研者服务启动超时');
        })();

        try {
            await this.starting;
            this.connection = 'ready';
        } catch (error) {
            console.error('[Scholarium] Research Weaver 启动失败:', error);
            this.connection = 'error';
            this.lastError = error instanceof Error ? error.message : String(error);
        } finally {
            this.starting = null;
            this.repaint();
        }
    }

    /**
     * Load the read-only Project/Experiment/Evidence/Hypothesis context
     * (M2 step 1) via src/bridge-client.ts. Retries on transient failures
     * (the Bridge behind the launcher's `/bridge/*` proxy can still be
     * starting even after the launcher's own static page answers — the
     * same class of readiness gap fixed in
     * agent-canvas-demo/tests/local-launcher.test.js for M1) with a bounded
     * deadline, not a fixed sleep-then-assume. Does NOT retry on an
     * application-level readiness failure (channel disabled / vaultRoot
     * unset / action not whitelisted) — retrying cannot fix a config state.
     */
    private async loadProjectContext(): Promise<void> {
        this.projectContext = { kind: 'loading' };
        this.paintHeader();

        const deadline = Date.now() + 15000;
        let lastError: unknown;
        while (Date.now() < deadline) {
            try {
                const { readiness } = await checkReadiness('project.list');
                if (!readiness.ready) {
                    this.projectContext = { kind: 'unavailable', message: readiness.message };
                    this.paintHeader();
                    return;
                }
                this.projects = await listProjects();
                this.projectContext = { kind: 'ready' };
                this.paintHeader();
                return;
            } catch (error) {
                lastError = error;
                await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
            }
        }
        this.projectContext = {
            kind: 'unavailable',
            message: `无法连接织研者本地服务的读取通道：${lastError instanceof ScholariumStateError || lastError instanceof Error ? lastError.message : String(lastError)}`,
        };
        this.paintHeader();
    }

    private async onProjectSelected(): Promise<void> {
        this.outcomeScan = null;
        this.outcomeScanError = null;
        this.paintHeader();
        if (!this.selectedDisplayId) return;
        const project = this.projects.find((p) => p.display_id === this.selectedDisplayId);
        if (!project) return;
        try {
            this.outcomeScan = await scanExperimentOutcomes(project.uid);
        } catch (error) {
            this.outcomeScanError = error instanceof ScholariumStateError || error instanceof Error ? error.message : String(error);
        }
        this.paintHeader();
    }
}
