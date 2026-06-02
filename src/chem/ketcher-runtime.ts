import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from 'ketcher-react';
import * as KetcherStandalone from 'ketcher-standalone';
import type { Ketcher } from 'ketcher-core';
import type { ChemBlock } from './chem-block';

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
            const source = initial.ket || initial.rxn || initial.molfile || initial.smiles || initial.reactionSmiles;
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
                async () => blobToText(await ketcher!.generateImage(next.ket || next.rxn || next.molfile || next.smiles, {
                    outputFormat: 'svg',
                    backgroundColor: 'transparent',
                } as never)),
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
