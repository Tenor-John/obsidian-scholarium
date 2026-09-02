'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyScholariumState, describeScholariumReadiness } = require('../bridge-state-response');

// Each fixture below mirrors an actual response shape produced by
// GET /v1/scholarium/state in agent-canvas-demo/bridge/server.js (see the
// "Scholarium read channel (L0 only, served directly)" block) — the
// messages are copied from that route's send(res, ...) calls, not
// paraphrased, so a wording change there is caught by these tests.

test('200 classifies as ok, carrying the manifest result', () => {
    const c = classifyScholariumState(200, { action: 'project.list', at: '2026-09-02T00:00:00.000Z', result: { projects: [] } });
    assert.strictEqual(c.ok, true);
    assert.deepStrictEqual(c.result, { projects: [] });
});

test('409 "disabled" classifies as kind disabled', () => {
    const c = classifyScholariumState(409, { error: 'Scholarium actions are disabled. Set scholarium.enabled=true in bridge.config.json after reviewing which actions you are allowing.' });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'disabled');
});

test('409 "L0 read-only actions only" classifies as kind not_l0', () => {
    const c = classifyScholariumState(409, { error: "the state endpoint serves L0 read-only actions only; submit workspace.task_add via POST /v1/scholarium/actions instead" });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'not_l0');
});

test('400 "vaultRoot is not configured" classifies as kind vault_missing', () => {
    const c = classifyScholariumState(400, { error: 'scholarium.vaultRoot is not configured or does not exist; set it to the real Obsidian vault root in bridge.config.json' });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'vault_missing');
});

test('403 "not in scholarium.allowedActions" classifies as kind not_allowed', () => {
    const c = classifyScholariumState(403, { error: 'action is not in scholarium.allowedActions: project.get' });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'not_allowed');
});

test('400 "project_not_found:<ref>" classifies as kind not_found and extracts ref', () => {
    const c = classifyScholariumState(400, { error: 'project_not_found:PRJ-999' });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'not_found');
    assert.strictEqual(c.ref, 'PRJ-999');
});

test('other 400s classify as kind bad_input without crashing on a missing error field', () => {
    const c = classifyScholariumState(400, { error: 'input must be a JSON object' });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'bad_input');
    const c2 = classifyScholariumState(400, undefined);
    assert.strictEqual(c2.ok, false);
    assert.strictEqual(c2.kind, 'bad_input');
});

test('an unrecognized status falls back to kind unknown rather than throwing', () => {
    const c = classifyScholariumState(500, { error: 'boom' });
    assert.strictEqual(c.ok, false);
    assert.strictEqual(c.kind, 'unknown');
});

test('describeScholariumReadiness: disabled takes priority over everything else', () => {
    const r = describeScholariumReadiness({ enabled: false, vaultRootExists: false, allowedActions: [] }, 'project.list');
    assert.strictEqual(r.ready, false);
    assert.strictEqual(r.kind, 'disabled');
});

test('describeScholariumReadiness: enabled but vaultRoot missing distinguishes configured vs not', () => {
    const notConfigured = describeScholariumReadiness({ enabled: true, vaultRootConfigured: false, vaultRootExists: false }, 'project.list');
    assert.strictEqual(notConfigured.kind, 'vault_missing');
    assert.match(notConfigured.message, /未配置/);

    const configuredButMissing = describeScholariumReadiness({ enabled: true, vaultRootConfigured: true, vaultRootExists: false }, 'project.list');
    assert.strictEqual(configuredButMissing.kind, 'vault_missing');
    assert.match(configuredButMissing.message, /不存在/);
});

test('describeScholariumReadiness: enabled + vaultRoot present but action not whitelisted', () => {
    const r = describeScholariumReadiness({ enabled: true, vaultRootExists: true, allowedActions: ['workspace.get_state'] }, 'project.list');
    assert.strictEqual(r.ready, false);
    assert.strictEqual(r.kind, 'not_allowed');
});

test('describeScholariumReadiness: ready when enabled, vaultRoot present, and action whitelisted', () => {
    const r = describeScholariumReadiness({ enabled: true, vaultRootExists: true, allowedActions: ['project.list', 'project.get'] }, 'project.list');
    assert.deepStrictEqual(r, { ready: true });
});
