export type WeaverConnectionState = 'idle' | 'connecting' | 'ready' | 'error';
export type WeaverMountStateKind = 'unsupported' | 'connecting' | 'ready' | 'error';

export function describeMountState(
    isDesktopApp: boolean,
    connection: WeaverConnectionState,
    errorMessage?: string,
): { kind: WeaverMountStateKind; text: string };

export function buildWeaverEntryUrl(baseUrl: string, theme: 'light' | 'dark'): string;