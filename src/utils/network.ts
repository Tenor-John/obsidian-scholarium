import { requestUrl } from 'obsidian';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';

export const NETWORK_TIMEOUT_MS = 45000;

export async function requestUrlWithTimeout(
    request: RequestUrlParam | string,
    timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<RequestUrlResponse> {
    return withTimeout(requestUrl(request), timeoutMs);
}

export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs = NETWORK_TIMEOUT_MS,
): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
        if ((error as Error)?.name === 'AbortError') {
            throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
        }
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

export function safeParseJson<T>(raw: string, context = 'JSON response'): T | null {
    const cleaned = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
    try {
        return JSON.parse(cleaned) as T;
    } catch (error) {
        console.warn(`[Scholarium] Unable to parse ${context}:`, error);
        return null;
    }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: number | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = window.setTimeout(
                    () => reject(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds`)),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timer !== undefined) window.clearTimeout(timer);
    }
}
