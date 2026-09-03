export interface WeaverVaultPorts {
    canvasPort: number;
    bridgePort: number;
    baseUrl: string;
}

export function stableHash(value: string): number;

export function deriveWeaverPorts(vaultBasePath: string | null | undefined): WeaverVaultPorts;

export const CANVAS_PORT_BASE: number;
export const CANVAS_PORT_RANGE: number;
export const BRIDGE_PORT_OFFSET: number;
