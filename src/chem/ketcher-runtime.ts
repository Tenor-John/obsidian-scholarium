import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from 'ketcher-react';
import * as KetcherStandalone from 'ketcher-standalone';
import type { Ketcher } from 'ketcher-core';
import type { ChemBlock } from './chem-block';
import { getChemStructureSource } from './chem-source';

ensureKetcherGlobals();

export interface KetcherRuntimeHandle {
    getBlock(): Promise<ChemBlock>;
    destroy(): void;
}

export function mountKetcherRuntime(container: HTMLElement, initial: ChemBlock): KetcherRuntimeHandle {
    const root = createRoot(container);
    let ketcher: Ketcher | null = null;
    const structServiceProvider = createStandaloneStructServiceProvider();

    root.render(React.createElement(Editor as never, {
        staticResourcesUrl: '',
        structServiceProvider,
        errorHandler: (message: string) => console.warn('[Scholarium] Ketcher:', message),
        disableMacromoleculesEditor: true,
        onInit: async (instance: Ketcher) => {
            ketcher = instance;
            const source = getChemStructureSource(initial);
            if (!source) return;
            try {
                await instance.setMolecule(source);
            } catch (error) {
                console.warn('[Scholarium] Failed to load structure into Ketcher:', error);
            }
        },
    } as never));

    return {
        async getBlock(): Promise<ChemBlock> {
            if (!ketcher) throw new Error('Ketcher is still loading.');
            const next: ChemBlock = {
                ...initial,
                locked: true,
                updated: new Date().toISOString(),
            };

            next.ket = await safeExport(() => ketcher!.getKet(), initial.ket);
            next.rxn = await safeExport(() => ketcher!.getRxn('v3000' as never), initial.rxn);
            next.molfile = await safeExport(() => ketcher!.getMolfile('v3000' as never), initial.molfile);
            next.smiles = await safeExport(() => ketcher!.getSmiles(), initial.smiles);
            next.reactionSmiles = await safeExport(() => ketcher!.getSmiles(true), initial.reactionSmiles);
            next.previewSvg = await safeExport(
                async () => padPreviewSvg(await blobToText(await ketcher!.generateImage(next.ket || next.rxn || next.molfile || next.smiles, {
                    outputFormat: 'svg',
                    backgroundColor: '#ffffff',
                } as never))),
                initial.previewSvg,
            );
            return next;
        },
        destroy(): void {
            root.unmount();
        },
    };
}

function createStandaloneStructServiceProvider(): unknown {
    const Provider = (KetcherStandalone as unknown as {
        StandaloneStructServiceProvider?: new () => unknown;
    }).StandaloneStructServiceProvider;
    if (!Provider) throw new Error('StandaloneStructServiceProvider is unavailable.');
    return new Provider();
}

async function safeExport(exporter: () => Promise<string>, fallback: string): Promise<string> {
    try {
        return await exporter();
    } catch {
        return fallback;
    }
}

async function blobToText(blob: Blob): Promise<string> {
    return await blob.text();
}

function padPreviewSvg(svgText: string): string {
    try {
        const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
        const svg = doc.querySelector('svg');
        if (!svg) return svgText;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('overflow', 'visible');
        svg.setAttribute('style', mergeSvgStyle(svg.getAttribute('style')));
        padSvgViewBox(svg);
        return new XMLSerializer().serializeToString(svg);
    } catch {
        return svgText;
    }
}

function mergeSvgStyle(style: string | null): string {
    const trimmed = style?.trim();
    const suffix = 'background:#ffffff;overflow:visible;';
    return trimmed ? `${trimmed.replace(/;?$/, ';')}${suffix}` : suffix;
}

function padSvgViewBox(svg: Element, ratio = 0.12, min = 8): void {
    const vb = svg.getAttribute('viewBox');
    if (!vb) return;
    const p = vb.split(/[\s,]+/).map(Number);
    if (p.length !== 4 || p.some(isNaN)) return;
    const [x = 0, y = 0, w = 0, h = 0] = p;
    const pad = Math.max(Math.max(w, h) * ratio, min);
    svg.setAttribute('viewBox', `${x - pad} ${y - pad} ${w + pad * 2} ${h + pad * 2}`);
}

function ensureKetcherGlobals(): void {
    const root = globalThis as unknown as {
        global?: typeof globalThis;
        process?: { env?: Record<string, string | undefined> };
    };

    root.global ??= globalThis;
    root.process ??= { env: {} };
    root.process.env ??= {};
    root.process.env.NODE_ENV ??= 'production';
}
