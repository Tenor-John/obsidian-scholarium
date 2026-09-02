import { App, FileSystemAdapter, Platform, requestUrl } from 'obsidian';
import ChemELNPlugin from './main';

const WEAVER_LOCAL_URL = 'http://127.0.0.1:4173/';
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
 * Minimal mount for the Research Weaver ("织研者") local companion app.
 *
 * Research Weaver (`agent-canvas-demo/`) is a separate, unbundled static web
 * app plus a local Bridge server that ships alongside this plugin but is not
 * part of the compiled main.js — it runs as its own Node process on
 * 127.0.0.1:4173. This module's only job is:
 *
 *   1. make sure the local launcher (`agent-canvas-demo/start-local.js`) is
 *      running, starting it on demand via Obsidian's desktop Node access;
 *   2. embed the running app in an iframe that tracks the Obsidian
 *      light/dark theme.
 *
 * It deliberately does not talk to any Project/Experiment/Evidence write
 * APIs and knows nothing about institution-specific (e.g. USTC WebVPN)
 * access — those live entirely inside the Research Weaver app itself and
 * are out of scope for this milestone (see the migration map, section 4-5).
 *
 * Desktop-only: agent-canvas-demo's launcher is a Node child process, which
 * mobile Obsidian cannot spawn. render() shows a plain notice on mobile
 * instead of touching any Node API.
 */
export class ResearchWeaverPanel {
    private frame: HTMLIFrameElement | null = null;
    private themeObserver: MutationObserver | null = null;
    private starting: Promise<void> | null = null;

    constructor(private app: App, private plugin: ChemELNPlugin) {}

    async load(): Promise<void> {
        // Nothing to preload; the local service is started lazily on first render.
        return Promise.resolve();
    }

    render(container: HTMLElement): void {
        if (!Platform.isDesktopApp) {
            container.empty();
            container.createEl('p', {
                text: '织研者需要在桌面端 Obsidian 中运行（需要启动本机的本地服务进程）。',
                cls: 'scholarium-placeholder',
            });
            return;
        }

        if (!this.frame) {
            container.empty();
            this.frame = container.createEl('iframe', {
                attr: {
                    src: this.withTheme(WEAVER_LOCAL_URL),
                    sandbox: 'allow-scripts allow-forms allow-same-origin allow-popups allow-downloads',
                },
            });
            this.frame.setCssStyles({ width: '100%', height: '100%', border: '0' });
        } else if (this.frame.parentElement !== container) {
            container.empty();
            container.appendChild(this.frame);
        }

        this.ensureThemeSync();
        void this.ensureRunning();
    }

    destroy(): void {
        this.themeObserver?.disconnect();
        this.themeObserver = null;
        // The local Bridge/launcher is a long-lived shared process — other
        // panels or a future re-open of this tab may still want it, so we
        // deliberately do not kill it here.
    }

    private resolveTheme(): 'light' | 'dark' {
        return activeDocument.body.classList.contains('theme-light') ? 'light' : 'dark';
    }

    private withTheme(url: string): string {
        const u = new URL(url);
        u.searchParams.set('theme', this.resolveTheme());
        return u.toString();
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
        } catch (error) {
            console.error('[Scholarium] Research Weaver 启动失败:', error);
        } finally {
            this.starting = null;
        }
    }
}