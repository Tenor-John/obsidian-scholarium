import type { ChemBlock } from './chem-block';
import { getChemStructureSource } from './chem-source';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export async function mountKetcher(_plugin: unknown, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    const textarea = container.createEl('textarea', {
        cls: 'sch-chem-fallback-textarea',
        attr: { placeholder: 'SMILES, reaction SMILES, KET, RXN, or Molfile' },
    });
    textarea.value = getChemStructureSource(initial);

    return {
        async getBlock(): Promise<ChemBlock> {
            const source = textarea.value.trim();
            const next = { ...initial };
            if (initial.type === 'reaction') {
                next.reactionSmiles = source;
            } else {
                next.smiles = source;
            }
            return next;
        },
        destroy(): void {
            textarea.remove();
        },
    };
}
