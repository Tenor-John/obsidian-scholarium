import type { ChemBlock } from './chem-block';
import type { KetcherRuntimeHandle } from './ketcher-runtime';
import type ChemELNPlugin from '../main';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

interface KetcherRuntimeModule {
    mountKetcherRuntime(container: HTMLElement, initial: ChemBlock): KetcherRuntimeHandle;
}

declare const require: (id: string) => unknown;

export async function mountKetcher(plugin: ChemELNPlugin, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    const runtime = loadKetcherRuntime(plugin);
    return runtime.mountKetcherRuntime(container, initial);
}

function loadKetcherRuntime(plugin: ChemELNPlugin): KetcherRuntimeModule {
    try {
        ensureBrowserGlobals();
        const runtimePath = getRuntimePath(plugin);
        return require(runtimePath) as KetcherRuntimeModule;
    } catch (error) {
        console.error('[Scholarium] Unable to load ketcher-runtime.js:', error);
        throw new Error(`Ketcher runtime is missing: ${(error as Error).message}`);
    }
}

function getRuntimePath(plugin: ChemELNPlugin): string {
    const manifestWithDir = plugin.manifest as typeof plugin.manifest & { dir?: string };
    if (!manifestWithDir.dir) {
        throw new Error('Plugin manifest directory is unavailable.');
    }

    const adapter = plugin.app.vault.adapter as typeof plugin.app.vault.adapter & {
        getFullPath?: (normalizedPath: string) => string;
    };
    const pluginRelativePath = `${manifestWithDir.dir}/ketcher-runtime.cjs`;
    const fullPath = adapter.getFullPath ? adapter.getFullPath(pluginRelativePath) : pluginRelativePath;
    return fullPath.replace(/\\/g, '/');
}

function ensureBrowserGlobals(): void {
    const globals = globalThis as typeof globalThis & {
        Worker?: typeof Worker;
        Blob?: typeof Blob;
        URL?: typeof URL;
        atob?: typeof atob;
        btoa?: typeof btoa;
    };
    const win = window as typeof window & {
        Worker?: typeof Worker;
    };
    if (!globals.Worker && win.Worker) globals.Worker = win.Worker;
    if (!globals.Blob && window.Blob) globals.Blob = window.Blob;
    if (!globals.URL && window.URL) globals.URL = window.URL;
    if (!globals.atob && window.atob) globals.atob = window.atob.bind(window);
    if (!globals.btoa && window.btoa) globals.btoa = window.btoa.bind(window);
}
