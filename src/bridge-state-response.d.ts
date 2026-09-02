export type ScholariumStateErrorKind =
    | 'disabled'
    | 'vault_missing'
    | 'not_allowed'
    | 'not_l0'
    | 'not_found'
    | 'bad_input'
    | 'unknown';

export type ScholariumStateClassification<T = unknown> =
    | { ok: true; result: T }
    | { ok: false; kind: ScholariumStateErrorKind; message: string; ref?: string };

export function classifyScholariumState(
    httpStatus: number,
    body: { action?: string; at?: string; result?: unknown; error?: string } | undefined,
): ScholariumStateClassification;

export interface ScholariumStatusLike {
    enabled?: boolean;
    vaultRootConfigured?: boolean;
    vaultRootExists?: boolean;
    allowedActions?: string[];
}

export type ScholariumReadiness =
    | { ready: true }
    | { ready: false; kind: 'disabled' | 'vault_missing' | 'not_allowed'; message: string };

export function describeScholariumReadiness(
    status: ScholariumStatusLike | undefined,
    requiredAction: string,
): ScholariumReadiness;
