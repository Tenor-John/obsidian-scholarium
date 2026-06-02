import type { ChemBlock } from './chem-block';
import type ChemELNPlugin from '../main';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export async function mountKetcher(_plugin: ChemELNPlugin, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    void container;
    void initial;
    throw new Error('Ketcher editor is temporarily disabled in this build.');
}
