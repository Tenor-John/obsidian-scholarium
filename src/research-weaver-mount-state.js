'use strict';

/**
 * Pure decision logic for the Research Weaver mount panel.
 *
 * Deliberately has zero dependency on Obsidian's API or the DOM, so it can be
 * unit tested with plain `node --test` (see
 * src/__tests__/research-weaver-mount-state.test.js) the same way
 * agent-canvas-demo's own tests work — no test harness or mocking framework
 * needed. src/research-weaver-mount.ts imports this and is the only place
 * that turns these decisions into actual DOM/Obsidian calls.
 */

/**
 * Decide what the mount panel should show.
 *
 *   - non-desktop: always a plain "unsupported" notice, regardless of
 *     connection state — agent-canvas-demo's launcher is a Node child
 *     process that mobile Obsidian cannot spawn.
 *   - desktop + not yet confirmed reachable: a "connecting" status.
 *   - desktop + confirmed unreachable after retries: an "error" status that
 *     includes the failure reason, instead of a blank/broken iframe.
 *   - desktop + confirmed reachable: "ready" (caller mounts the iframe).
 *
 * @param {boolean} isDesktopApp
 * @param {'idle'|'connecting'|'ready'|'error'} connection
 * @param {string} [errorMessage]
 * @returns {{ kind: 'unsupported'|'connecting'|'ready'|'error', text: string }}
 */
function describeMountState(isDesktopApp, connection, errorMessage) {
    if (!isDesktopApp) {
        return {
            kind: 'unsupported',
            text: '织研者需要在桌面端 Obsidian 中运行（需要启动本机的本地服务进程）。',
        };
    }
    if (connection === 'ready') {
        return { kind: 'ready', text: '' };
    }
    if (connection === 'error') {
        return {
            kind: 'error',
            text: `织研者本地服务未能启动：${errorMessage || '未知错误'}`,
        };
    }
    return { kind: 'connecting', text: '正在连接织研者本地服务…' };
}

/**
 * Build the iframe entry URL, carrying the current Obsidian theme so the
 * embedded app can render itself consistently on first paint.
 *
 * @param {string} baseUrl
 * @param {'light'|'dark'} theme
 * @returns {string}
 */
function buildWeaverEntryUrl(baseUrl, theme) {
    const u = new URL(baseUrl);
    u.searchParams.set('theme', theme);
    return u.toString();
}

module.exports = { describeMountState, buildWeaverEntryUrl };