import type { ChemBlock } from './chem-block';
import { getChemStructureSource } from './chem-source';

export interface KetcherHost {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export async function mountKetcher(_plugin: unknown, container: HTMLElement, initial: ChemBlock): Promise<KetcherHost> {
    // esbuild keeps this dynamic import inside main.js. The module is evaluated
    // lazily, but no script element, network request, or runtime code generation
    // is involved. This preserves fast plugin startup with a three-file release.
    const { mountKetcherRuntime } = await import('./ketcher-runtime');
    const mounted = await mountKetcherRuntime(container, getChemStructureSource(initial));

    return {
        async getBlock(): Promise<ChemBlock> {
            const [smiles, ket] = await Promise.all([
                mounted.ketcher.getSmiles(),
                mounted.ketcher.getKet(),
            ]);
            const next = { ...initial };
            const reaction = mounted.ketcher.containsReaction()
                || initial.type === 'reaction' && smiles.includes('>');
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
                        backgroundColor: '255, 255, 255',
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

async function blobToText(blob: Blob): Promise<string> {
    if (typeof blob.text === 'function') return blob.text();
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('读取 SVG 失败'));
        reader.readAsText(blob);
    });
}
