'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { describeMountState, buildWeaverEntryUrl } = require('../research-weaver-mount-state');

// M1 contract: mobile/non-desktop always degrades to the plain notice, no
// matter what the connection state is — agent-canvas-demo's launcher spawns
// a Node child process, which mobile Obsidian cannot do.
test('non-desktop always degrades to the unsupported notice, regardless of connection state', () => {
    for (const connection of ['idle', 'connecting', 'ready', 'error']) {
        const state = describeMountState(false, connection, 'some error');
        assert.strictEqual(state.kind, 'unsupported');
        assert.match(state.text, /桌面端/);
    }
});

// M1 contract: on desktop, before the local Bridge/launcher is confirmed
// reachable, the panel must show an understandable "connecting" status
// rather than a blank or permanently-loading iframe.
test('desktop + not yet reachable shows a connecting status, not a blank iframe', () => {
    const state = describeMountState(true, 'connecting');
    assert.strictEqual(state.kind, 'connecting');
    assert.ok(state.text.length > 0);
});

test('desktop + idle (render just called, health check not yet run) also reads as connecting', () => {
    const state = describeMountState(true, 'idle');
    assert.strictEqual(state.kind, 'connecting');
});

// M1 contract: if the launcher/health-check ultimately fails, the failure
// reason must reach the UI text, not just the console.
test('desktop + confirmed unreachable surfaces the failure reason in the status text', () => {
    const state = describeMountState(true, 'error', '未找到 agent-canvas-demo/start-local.js');
    assert.strictEqual(state.kind, 'error');
    assert.match(state.text, /未找到 agent-canvas-demo\/start-local\.js/);
});

test('desktop + confirmed unreachable with no error message still produces readable text', () => {
    const state = describeMountState(true, 'error');
    assert.strictEqual(state.kind, 'error');
    assert.ok(state.text.length > 0);
});

// M1 contract: on desktop, once the local service is confirmed reachable,
// the panel mounts the entry — this is the "desktop can mount the Research
// Weaver entry" contract at the decision-logic level; the DOM side (createEl
// iframe) is a thin, untested-here consequence of this becoming true.
test('desktop + ready mounts the entry (no placeholder text)', () => {
    const state = describeMountState(true, 'ready');
    assert.strictEqual(state.kind, 'ready');
    assert.strictEqual(state.text, '');
});

test('the entry URL carries the resolved Obsidian theme', () => {
    const light = buildWeaverEntryUrl('http://127.0.0.1:4173/', 'light');
    const dark = buildWeaverEntryUrl('http://127.0.0.1:4173/', 'dark');
    assert.strictEqual(new URL(light).searchParams.get('theme'), 'light');
    assert.strictEqual(new URL(dark).searchParams.get('theme'), 'dark');
    assert.strictEqual(new URL(light).origin, 'http://127.0.0.1:4173');
});