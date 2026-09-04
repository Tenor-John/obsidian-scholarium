import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from 'ketcher-react';
import { StandaloneStructServiceProvider } from 'ketcher-standalone';
import 'ketcher-react/dist/index.css';

interface KetcherApi {
    getSmiles(isExtended?: boolean): Promise<string>;
    getMolfile(format?: 'v2000' | 'v3000'): Promise<string>;
    getRxn(format?: 'v2000' | 'v3000'): Promise<string>;
    getKet(): Promise<string>;
    containsReaction(): boolean;
    setMolecule(structure: string): Promise<void | undefined>;
    generateImage(data: string, options: { outputFormat: 'svg'; backgroundColor?: string; bondThickness?: number }): Promise<Blob>;
}

interface MountedKetcher {
    ketcher: KetcherApi;
    destroy(): void;
}

interface RuntimeWindow extends Window {
    __scholariumKetcherRuntime?: {
        mount(container: HTMLElement, initialSource: string, staticResourcesUrl: string): Promise<MountedKetcher>;
    };
}

function mount(container: HTMLElement, initialSource: string, staticResourcesUrl: string): Promise<MountedKetcher> {
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
        while (container.firstChild) container.removeChild(container.firstChild);
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
            staticResourcesUrl: staticResourcesUrl.replace(/\/$/, ''),
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

(window as RuntimeWindow).__scholariumKetcherRuntime = { mount };
