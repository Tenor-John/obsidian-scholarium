import React from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import ketcherStyles from 'ketcher-react/dist/index.css';

export interface KetcherApi {
    getSmiles(isExtended?: boolean): Promise<string>;
    getMolfile(format?: 'v2000' | 'v3000'): Promise<string>;
    getRxn(format?: 'v2000' | 'v3000'): Promise<string>;
    getKet(): Promise<string>;
    containsReaction(): boolean;
    setMolecule(structure: string): Promise<void | undefined>;
    generateImage(data: string, options: {
        outputFormat: 'svg';
        backgroundColor?: string;
        bondThickness?: number;
    }): Promise<Blob>;
}

export interface MountedKetcher {
    ketcher: KetcherApi;
    destroy(): void;
}

export function mountKetcherRuntime(container: HTMLElement, initialSource: string): Promise<MountedKetcher> {
    ensureKetcherStyle();
    const root = createRoot(container);
    const provider = new StandaloneStructServiceProvider();
    let resolveReady!: (mounted: MountedKetcher) => void;
    let rejectReady!: (error: unknown) => void;
    let settled = false;

    const ready = new Promise<MountedKetcher>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        rejectReady(new Error('Ketcher 初始化超时'));
        root.unmount();
    }, 30000);

    const destroy = (): void => {
        window.clearTimeout(timeout);
        if (!settled) {
            settled = true;
            rejectReady(new Error('Ketcher 已被关闭'));
        }
        root.unmount();
        container.empty();
    };

    const handleInit = (ketcher: KetcherApi): void => {
        void (async () => {
            try {
                if (initialSource.trim()) await ketcher.setMolecule(initialSource);
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                resolveReady({ ketcher, destroy });
            } catch (error) {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                rejectReady(error);
                root.unmount();
            }
        })();
    };

    try {
        root.render(React.createElement(Editor, {
            staticResourcesUrl: '',
            structServiceProvider: provider,
            disableMacromoleculesEditor: true,
            errorHandler: (message: string) => console.error('[Scholarium] Ketcher:', message),
            onInit: handleInit,
        }));
    } catch (error) {
        settled = true;
        window.clearTimeout(timeout);
        rejectReady(error);
    }

    return ready;
}

function ensureKetcherStyle(): void {
    if (document.querySelector('style[data-scholarium-ketcher-style]')) return;
    const style = document.createElement('style');
    style.dataset.scholariumKetcherStyle = 'true';
    style.textContent = ketcherStyles;
    document.head.appendChild(style);
}
