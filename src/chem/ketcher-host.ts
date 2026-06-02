import type { ChemBlock } from './chem-block';
import type { KetcherRuntimeHandle } from './ketcher-runtime';
import type ChemELNPlugin from '../main';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export async function mountKetcher(_plugin: ChemELNPlugin, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    try {
        ensureBrowserGlobals();
        const runtime = await import('./ketcher-runtime');
        return runtime.mountKetcherRuntime(container, initial);
    } catch (error) {
        console.error('[Scholarium] Unable to mount Ketcher:', error);
        throw new Error(`Ketcher failed to mount: ${(error as Error).message}`);
    }
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
