'use strict';

/**
 * Pure response-classification logic for the Bridge's L0 read channel
 * (GET /v1/scholarium/status, GET /v1/scholarium/state — see
 * agent-canvas-demo/bridge/server.js, "Scholarium read channel" section).
 *
 * Deliberately has zero dependency on Obsidian, the DOM, or any HTTP client,
 * so it can be unit tested with plain `node --test` the same way
 * research-weaver-mount-state.js is — feed it a captured (httpStatus, body)
 * pair and assert on the classification, no live Bridge or mocking needed.
 * src/bridge-client.ts is the only place that pairs this with a real
 * requestUrl() call.
 *
 * The classification mirrors bridge/server.js's actual gate order for
 * GET /v1/scholarium/state (enabled -> vaultRoot -> whitelist -> L0-only ->
 * action-specific error) so a UI can show a specific, actionable message
 * instead of a bare "request failed" — this is the M2 "错误降级"
 * requirement: connection/config problems must degrade to an understandable
 * status, not a blank or stuck panel.
 */

/**
 * @param {number} httpStatus
 * @param {{ action?: string, at?: string, result?: unknown, error?: string }} body
 * @returns {
 *   | { ok: true, result: unknown }
 *   | { ok: false, kind: 'disabled'|'vault_missing'|'not_allowed'|'not_l0'|'not_found'|'bad_input'|'unknown', message: string, ref?: string }
 * }
 */
function classifyScholariumState(httpStatus, body) {
    const error = String((body && body.error) || '');

    if (httpStatus === 200) {
        return { ok: true, result: body ? body.result : undefined };
    }
    if (httpStatus === 409 && /disabled/i.test(error)) {
        return { ok: false, kind: 'disabled', message: error || 'Scholarium 读取通道未启用' };
    }
    if (httpStatus === 409 && /L0 read-only actions only/i.test(error)) {
        return { ok: false, kind: 'not_l0', message: error || '该 action 不是只读（L0），此通道拒绝提供' };
    }
    if (httpStatus === 400 && /vaultRoot is not configured/i.test(error)) {
        return { ok: false, kind: 'vault_missing', message: error || 'scholarium.vaultRoot 未配置或不存在' };
    }
    if (httpStatus === 403 && /allowedActions/i.test(error)) {
        return { ok: false, kind: 'not_allowed', message: error || 'action 不在 scholarium.allowedActions 白名单中' };
    }
    if (httpStatus === 400 && error.startsWith('project_not_found:')) {
        return { ok: false, kind: 'not_found', message: error, ref: error.slice('project_not_found:'.length) };
    }
    if (httpStatus === 400) {
        return { ok: false, kind: 'bad_input', message: error || '请求参数无效' };
    }
    return { ok: false, kind: 'unknown', message: error || `未预期的响应状态：${httpStatus}` };
}

/**
 * Classify GET /v1/scholarium/status into what a UI needs to decide whether
 * it can even attempt a state read, and if not, why.
 *
 * @param {{ enabled?: boolean, vaultRootConfigured?: boolean, vaultRootExists?: boolean, allowedActions?: string[] }} status
 * @param {string} requiredAction action the caller is about to use, e.g. 'project.list'
 * @returns {
 *   | { ready: true }
 *   | { ready: false, kind: 'disabled'|'vault_missing'|'not_allowed', message: string }
 * }
 */
function describeScholariumReadiness(status, requiredAction) {
    if (!status || !status.enabled) {
        return { ready: false, kind: 'disabled', message: 'Scholarium 读取通道未启用（bridge.config.json 中 scholarium.enabled）' };
    }
    if (!status.vaultRootExists) {
        return {
            ready: false,
            kind: 'vault_missing',
            message: status.vaultRootConfigured
                ? 'scholarium.vaultRoot 已配置但路径不存在'
                : 'scholarium.vaultRoot 未配置',
        };
    }
    const allowed = Array.isArray(status.allowedActions) ? status.allowedActions : [];
    if (requiredAction && !allowed.includes(requiredAction)) {
        return { ready: false, kind: 'not_allowed', message: `${requiredAction} 不在 scholarium.allowedActions 白名单中` };
    }
    return { ready: true };
}

module.exports = { classifyScholariumState, describeScholariumReadiness };
