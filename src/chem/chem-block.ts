import { parseYaml } from 'obsidian';

export type ChemBlockType = 'molecule' | 'reaction' | 'cycle' | 'scheme';

export interface ChemBlock {
    id: string;
    type: ChemBlockType;
    title: string;
    locked: boolean;
    format: 'ket' | 'rxn' | 'mol';
    ket: string;
    rxn: string;
    molfile: string;
    smiles: string;
    reactionSmiles: string;
    previewSvg: string;
    created: string;
    updated: string;
}

export const CHEM_CODE_BLOCK = 'scholarium-chem';

export function createChemId(): string {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `chem-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyChemBlock(type: ChemBlockType = 'reaction'): ChemBlock {
    const now = new Date().toISOString();
    return {
        id: createChemId(),
        type,
        title: type === 'molecule' ? 'Untitled molecule' : 'Untitled reaction',
        locked: true,
        format: 'ket',
        ket: '',
        rxn: '',
        molfile: '',
        smiles: '',
        reactionSmiles: '',
        previewSvg: '',
        created: now,
        updated: now,
    };
}

export function parseChemBlock(source: string): ChemBlock {
    const raw = safeParseChemYaml(source);
    const fallback = createEmptyChemBlock(asChemType(raw.type));
    return {
        ...fallback,
        id: asString(raw.id) || fallback.id,
        type: asChemType(raw.type),
        title: asString(raw.title) || fallback.title,
        locked: asBoolean(raw.locked, true),
        format: asFormat(raw.format),
        ket: asString(raw.ket),
        rxn: asString(raw.rxn),
        molfile: asString(raw.molfile),
        smiles: asString(raw.smiles),
        reactionSmiles: asString(raw.reactionSmiles ?? raw.reaction_smiles),
        previewSvg: asString(raw.previewSvg ?? raw.preview_svg),
        created: asString(raw.created) || fallback.created,
        updated: asString(raw.updated) || fallback.updated,
    };
}

export function serializeChemBlock(block: ChemBlock): string {
    const lines: string[] = [
        `id: ${quoteYaml(block.id)}`,
        `type: ${block.type}`,
        `title: ${quoteYaml(block.title)}`,
        `locked: ${block.locked}`,
        `format: ${block.format}`,
        `created: ${quoteYaml(block.created)}`,
        `updated: ${quoteYaml(block.updated)}`,
        `ket: ${quoteYaml(block.ket)}`,
        `rxn: ${quoteYaml(block.rxn)}`,
        `molfile: ${quoteYaml(block.molfile)}`,
        `smiles: ${quoteYaml(block.smiles)}`,
        `reactionSmiles: ${quoteYaml(block.reactionSmiles)}`,
        `previewSvg: ${quoteYaml(block.previewSvg)}`,
    ];
    return lines.join('\n');
}

export function wrapChemBlock(block: ChemBlock): string {
    return `\`\`\`${CHEM_CODE_BLOCK}\n${serializeChemBlock(block)}\n\`\`\``;
}

function safeParseChemYaml(source: string): Record<string, unknown> {
    try {
        return (parseYaml(source) ?? {}) as Record<string, unknown>;
    } catch (error) {
        console.warn('[Scholarium] Chem block YAML parse failed; falling back to scalar salvage.', error);
        return salvageScalarFields(source);
    }
}

// Best-effort recovery for legacy blocks whose multi-line values broke YAML parsing.
// Pulls simple `key: value` scalar lines so the card can still render with an edit
// button instead of going blank.
function salvageScalarFields(source: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const scalarKeys = ['id', 'type', 'title', 'locked', 'format', 'created', 'updated', 'smiles', 'reactionSmiles', 'reaction_smiles'];
    for (const line of source.split('\n')) {
        const match = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
        if (!match) continue;
        const key = match[1] ?? '';
        if (!scalarKeys.includes(key)) continue;
        let value = (match[2] ?? '').trim();
        if (value === '|' || value === '>' || value === '') continue;
        const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
        if (quoted) {
            try {
                value = JSON.parse('"' + value.slice(1, -1).replace(/"/g, '\\"') + '"');
            } catch {
                value = value.slice(1, -1);
            }
        }
        result[key] = value;
    }
    return result;
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.toLowerCase() === 'true';
    return fallback;
}

function asChemType(value: unknown): ChemBlockType {
    return value === 'molecule' || value === 'cycle' || value === 'scheme' || value === 'reaction'
        ? value
        : 'reaction';
}

function asFormat(value: unknown): ChemBlock['format'] {
    return value === 'rxn' || value === 'mol' || value === 'ket' ? value : 'ket';
}

function quoteYaml(value: string): string {
    return JSON.stringify(value ?? '');
}
