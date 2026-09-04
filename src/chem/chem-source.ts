import type { ChemBlock } from './chem-block';

export function getChemStructureSource(block: ChemBlock): string {
    return firstNonEmpty([
        block.reactionSmiles,
        block.smiles,
        sourceForFormat(block),
        block.ket,
        block.rxn,
        block.molfile,
    ]);
}

export function getChemPreviewSmiles(block: ChemBlock): string {
    return firstNonEmpty([block.reactionSmiles, block.smiles]);
}

function sourceForFormat(block: ChemBlock): string {
    if (block.format === 'rxn') return block.rxn;
    if (block.format === 'mol') return block.molfile;
    return block.ket;
}

function firstNonEmpty(values: string[]): string {
    for (const value of values) {
        if (value.trim()) return value;
    }
    return '';
}
