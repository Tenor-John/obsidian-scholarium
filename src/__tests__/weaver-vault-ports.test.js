'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { deriveWeaverPorts, CANVAS_PORT_BASE, CANVAS_PORT_RANGE, BRIDGE_PORT_OFFSET } = require('../weaver-vault-ports');

// Fixture vault paths, including the two real vaults from the 2026-09-03
// cross-vault-contamination report (Research_mod and Scholarium\Scholarium)
// -- this is the exact scenario the fix exists for, so it belongs in the
// regression coverage, not just a synthetic example.
const RESEARCH_MOD = 'F:\\Obsidian科研库\\Research_mod';
const SCHOLARIUM_TEST_VAULT = 'F:\\Obsidian科研库\\Scholarium\\Scholarium';

test('the same vault path always derives the same ports', () => {
    const a = deriveWeaverPorts(RESEARCH_MOD);
    const b = deriveWeaverPorts(RESEARCH_MOD);
    assert.deepStrictEqual(a, b);
});

test('the two real vaults from the 2026-09-03 report derive different ports', () => {
    const researchMod = deriveWeaverPorts(RESEARCH_MOD);
    const scholariumTest = deriveWeaverPorts(SCHOLARIUM_TEST_VAULT);
    assert.notStrictEqual(researchMod.canvasPort, scholariumTest.canvasPort);
    assert.notStrictEqual(researchMod.baseUrl, scholariumTest.baseUrl);
});

test('a representative sample of distinct vault paths derive pairwise-distinct canvas ports', () => {
    const paths = [
        RESEARCH_MOD,
        SCHOLARIUM_TEST_VAULT,
        'C:\\Users\\TorJohn\\Documents\\TestVault',
        'D:\\vaults\\lab-notebook',
        '/home/user/vault-alpha',
    ];
    const ports = paths.map((p) => deriveWeaverPorts(p).canvasPort);
    assert.strictEqual(new Set(ports).size, ports.length, `expected all distinct, got ${JSON.stringify(ports)}`);
});

test('path casing and slash direction do not change the result (Windows paths are case-insensitive)', () => {
    const lower = deriveWeaverPorts('c:\\users\\researcher\\vault');
    const upperBackslash = deriveWeaverPorts('C:\\USERS\\RESEARCHER\\VAULT');
    const forwardSlash = deriveWeaverPorts('C:/Users/Researcher/Vault');
    assert.deepStrictEqual(lower, upperBackslash);
    assert.deepStrictEqual(lower, forwardSlash);
});

test('canvasPort always falls within the documented range, and bridgePort is always exactly BRIDGE_PORT_OFFSET above it', () => {
    for (const p of [RESEARCH_MOD, SCHOLARIUM_TEST_VAULT, 'Z:\\anything\\else', '']) {
        const result = deriveWeaverPorts(p);
        assert.ok(result.canvasPort >= CANVAS_PORT_BASE, `canvasPort ${result.canvasPort} below base ${CANVAS_PORT_BASE}`);
        assert.ok(result.canvasPort < CANVAS_PORT_BASE + CANVAS_PORT_RANGE, `canvasPort ${result.canvasPort} outside range`);
        assert.strictEqual(result.bridgePort, result.canvasPort + BRIDGE_PORT_OFFSET);
        assert.strictEqual(result.baseUrl, `http://127.0.0.1:${result.canvasPort}/`);
    }
});

test('a missing/empty/non-string vault path degrades to a valid, non-throwing result rather than crashing', () => {
    for (const bad of [null, undefined, '']) {
        const result = deriveWeaverPorts(bad);
        assert.strictEqual(typeof result.canvasPort, 'number');
        assert.strictEqual(typeof result.bridgePort, 'number');
        assert.match(result.baseUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    }
});
