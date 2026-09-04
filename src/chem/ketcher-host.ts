import type { ChemBlock } from './chem-block';
import { getChemStructureSource } from './chem-source';
import type ChemELNPlugin from '../main';

interface KetcherInstance {
    getSmiles(isExtended?: boolean): Promise<string>;
    getMolfile(format?: 'v2000' | 'v3000'): Promise<string>;
    getRxn(format?: 'v2000' | 'v3000'): Promise<string>;
    getKet(): Promise<string>;
    containsReaction(): boolean;
    generateImage(data: string, options: { outputFormat: 'svg'; backgroundColor?: string; bondThickness?: number }): Promise<Blob>;
}

interface KetcherRuntime {
    mount(container: HTMLElement, initialSource: string, staticResourcesUrl: string): Promise<{
        ketcher: KetcherInstance;
        destroy(): void;
    }>;
}

declare global {
    interface Window {
        __scholariumKetcherRuntime?: KetcherRuntime;
        __scholariumKetcherRuntimeLoading?: Promise<KetcherRuntime>;
    }
}

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export async function mountKetcher(plugin: ChemELNPlugin, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    const runtime = await loadKetcherRuntime(plugin);
    const pluginDir = plugin.manifest.dir ?? 'obsidian-scholarium';
    const staticResourcesUrl = resolveKetcherResource(
        plugin.app.vault.adapter.getResourcePath(pluginDir),
        '',
    );
    const mounted = await runtime.mount(container, getChemStructureSource(initial), staticResourcesUrl);

    return {
        async getBlock(): Promise<ChemBlock> {
            const [smiles, ket] = await Promise.all([
                mounted.ketcher.getSmiles(),
                mounted.ketcher.getKet(),
            ]);
            const next = { ...initial };
            const reaction = mounted.ketcher.containsReaction() || initial.type === 'reaction' && smiles.includes('>');
            next.ket = ket;
            next.smiles = reaction ? '' : smiles;
            next.reactionSmiles = reaction ? smiles : '';
            next.format = reaction ? 'rxn' : 'ket';

            try {
                next.molfile = await mounted.ketcher.getMolfile('v3000');
            } catch {
                next.molfile = '';
            }
            try {
                next.rxn = reaction ? await mounted.ketcher.getRxn('v3000') : '';
            } catch {
                next.rxn = '';
            }

            if (smiles.trim()) {
                try {
                    const image = await mounted.ketcher.generateImage(ket || smiles, {
                        outputFormat: 'svg',
                        backgroundColor: '#ffffff',
                        bondThickness: 2,
                    });
                    next.previewSvg = await blobToText(image);
                } catch (error) {
                    console.warn('[Scholarium] Ketcher SVG export failed:', error);
                }
            } else {
                next.previewSvg = '';
                next.smiles = '';
                next.reactionSmiles = '';
            }
            return next;
        },
        destroy(): void {
            mounted.destroy();
        },
    };
}

/**
 * Obsidian's Content-Security-Policy allows `app:` URLs for `script-src` but NOT for
 * `style-src-elem`, so `<link rel="stylesheet" href="app://.../ketcher.css">` is
 * silently blocked and Ketcher mounts completely unstyled. Inline `<style>` elements
 * are permitted (that is how Obsidian injects every plugin's styles.css), so read the
 * file through the vault adapter and inject its text instead. Every url() inside
 * ketcher.css is a data: URI, so nothing needs to resolve relative to the stylesheet.
 */
async function ensureKetcherStyle(
    plugin: ChemELNPlugin,
    pluginDir: string,
    styleUrl: string,
): Promise<void> {
    if (document.querySelector('style[data-scholarium-ketcher-style]')) return;
    document.querySelector('link[data-scholarium-ketcher-style]')?.remove();

    try {
        const css = await plugin.app.vault.adapter.read(`${pluginDir}/ketcher.css`);
        if (!css.trim()) throw new Error('ketcher.css 为空');
        const style = document.createElement('style');
        style.dataset.scholariumKetcherStyle = 'true';
        style.textContent = css;
        document.head.appendChild(style);
        return;
    } catch (error) {
        console.warn('[Scholarium] 读取 ketcher.css 失败，回退到 <link>（可能被 CSP 拦截）：', error);
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = styleUrl;
    link.dataset.scholariumKetcherStyle = 'true';
    document.head.appendChild(link);
}

async function loadKetcherRuntime(plugin: ChemELNPlugin): Promise<KetcherRuntime> {
    const pluginDir = plugin.manifest.dir ?? 'obsidian-scholarium';
    const resourcePath = plugin.app.vault.adapter.getResourcePath(pluginDir);
    const scriptUrl = resolveKetcherResource(resourcePath, 'ketcher.js');
    const styleUrl = resolveKetcherResource(resourcePath, 'ketcher.css');

    // Runs before the cached-runtime checks so a session that already loaded the
    // script (back when the stylesheet was blocked) still picks up its styles.
    await ensureKetcherStyle(plugin, pluginDir, styleUrl);

    if (window.__scholariumKetcherRuntime) return window.__scholariumKetcherRuntime;
    if (window.__scholariumKetcherRuntimeLoading) return window.__scholariumKetcherRuntimeLoading;

    const loading = new Promise<KetcherRuntime>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = scriptUrl;
        script.async = true;
        script.dataset.scholariumKetcherRuntime = 'true';
        script.onload = () => {
            const runtime = window.__scholariumKetcherRuntime;
            if (runtime) resolve(runtime);
            else reject(new Error('Ketcher runtime loaded without registering its API'));
        };
        script.onerror = () => reject(new Error(`无法加载 Ketcher 运行时：${scriptUrl}`));
        document.head.appendChild(script);
    }).finally(() => {
        window.__scholariumKetcherRuntimeLoading = undefined;
    });
    window.__scholariumKetcherRuntimeLoading = loading;
    return loading;
}

function resolveKetcherResource(resourcePath: string, fileName: string): string {
    try {
        const url = new URL(resourcePath, window.location.href);
        // Obsidian appends a cache-busting query to getResourcePath(). Strip it
        // before adding a child path; otherwise the child becomes part of the
        // query ("...?timestamp/ketcher.js") and the request returns 404.
        url.search = '';
        url.hash = '';
        url.pathname = `${url.pathname.replace(/\/?$/, '/')}${fileName}`;
        return url.toString();
    } catch {
        const base = resourcePath.split(/[?#]/, 1)[0] ?? resourcePath;
        return `${base.replace(/\/?$/, '/')}${fileName}`;
    }
}

async function blobToText(blob: Blob): Promise<string> {
    if (typeof blob.text === 'function') return blob.text();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('读取 SVG 失败'));
        reader.readAsText(blob);
    });
}
