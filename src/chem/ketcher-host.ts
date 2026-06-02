import type { ChemBlock } from './chem-block';
import type ChemELNPlugin from '../main';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

interface KetcherRuntimeGlobal {
    mountKetcherRuntime(container: HTMLElement, initial: ChemBlock): KetcherHost;
}

declare global {
    interface Window {
        ScholariumKetcherRuntime?: KetcherRuntimeGlobal;
    }
}

let runtimeLoadPromise: Promise<KetcherRuntimeGlobal> | null = null;

export async function mountKetcher(plugin: ChemELNPlugin, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    const runtime = await loadRuntime(plugin);
    return runtime.mountKetcherRuntime(container, initial);
}

async function loadRuntime(plugin: ChemELNPlugin): Promise<KetcherRuntimeGlobal> {
    if (window.ScholariumKetcherRuntime) return window.ScholariumKetcherRuntime;
    runtimeLoadPromise ??= injectRuntimeScript(plugin);
    return runtimeLoadPromise;
}

function injectRuntimeScript(plugin: ChemELNPlugin): Promise<KetcherRuntimeGlobal> {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = getRuntimeUrl(plugin);
        script.async = true;
        script.onload = () => {
            if (window.ScholariumKetcherRuntime) {
                resolve(window.ScholariumKetcherRuntime);
            } else {
                runtimeLoadPromise = null;
                reject(new Error('Ketcher runtime did not expose ScholariumKetcherRuntime.'));
            }
        };
        script.onerror = () => {
            runtimeLoadPromise = null;
            reject(new Error('Unable to load ketcher-runtime.js from the plugin folder.'));
        };
        document.head.appendChild(script);
    });
}

function getRuntimeUrl(plugin: ChemELNPlugin): string {
    const manifestWithDir = plugin.manifest as typeof plugin.manifest & { dir?: string };
    if (!manifestWithDir.dir) {
        throw new Error('Plugin manifest directory is unavailable.');
    }

    const runtimePath = `${manifestWithDir.dir}/ketcher-runtime.js`;
    const adapter = plugin.app.vault.adapter as typeof plugin.app.vault.adapter & {
        getResourcePath?: (normalizedPath: string) => string;
        getFullPath?: (normalizedPath: string) => string;
    };

    if (adapter.getResourcePath) return adapter.getResourcePath(runtimePath);
    if (adapter.getFullPath) return pathToFileUrl(adapter.getFullPath(runtimePath));
    return runtimePath;
}

function pathToFileUrl(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const prefixed = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return `file://${encodeURI(prefixed)}`;
}
