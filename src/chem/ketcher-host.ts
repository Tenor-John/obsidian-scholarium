import type { ChemBlock } from './chem-block';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export async function mountKetcher(_plugin: unknown, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    const runtime = await import('./ketcher-runtime');
    return runtime.mountKetcherRuntime(container, initial);
}
