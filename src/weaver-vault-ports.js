'use strict';

/**
 * Deterministic per-vault ports for the Research Weaver local companion
 * (agent-canvas-demo's launcher + Bridge).
 *
 * Why this exists: research-weaver-mount.ts used to always spawn/connect
 * to a single hardcoded port (127.0.0.1:4173 for the canvas launcher,
 * :4318 for the Bridge -- see agent-canvas-demo/start-local.js's own
 * defaults), identical for every vault. Two Obsidian vaults opened at the
 * same time on the same machine therefore raced for that one port pair:
 * whichever vault's launcher started first "won" the port, and every
 * other vault's plugin instance found that already-running process
 * healthy and silently reused it -- meaning it read the FIRST vault's
 * registry, config, and Bridge task history instead of its own. That is
 * the exact cross-vault contamination reported 2026-09-03: wrong
 * "vaultRoot outside allowedRoots" / "vaultRoot not configured" errors on
 * whichever vault didn't win the race, and one vault's task history
 * showing another vault's runs.
 *
 * The fix: derive a stable, vault-specific port pair from the vault's own
 * absolute base path, so the same vault always gets the same ports across
 * restarts, and two different vaults get (overwhelmingly likely)
 * different ports. Each vault then runs and talks to its own launcher/
 * Bridge process, reading its own bridge.config.json -- already per-vault,
 * since Obsidian installs each plugin separately inside every vault's own
 * .obsidian/plugins/ directory -- and writing its own task history. On the
 * rare occasion two vault paths hash to the same port, the losing
 * process's spawn fails with a clear EADDRINUSE, not a silent cross-vault
 * data mix-up -- already a strict improvement over today's behavior.
 */

const CANVAS_PORT_BASE = 47100;
const CANVAS_PORT_RANGE = 500; // canvas ports span 47100-47599
const BRIDGE_PORT_OFFSET = 1000; // bridge = canvas + 1000 (48100-48599): disjoint from the canvas range with headroom, and from the 4173/4318 legacy defaults and every test file's own pid-derived ranges (45100-46799).

/**
 * A simple, stable (FNV-1a-style) 32-bit string hash. Not cryptographic --
 * it only needs to (a) be identical for the identical path across restarts
 * and platforms, and (b) spread distinct paths reasonably evenly across
 * the port range.
 * @param {string} value
 * @returns {number}
 */
function stableHash(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/**
 * @param {string | null | undefined} vaultBasePath absolute filesystem path
 *   to the vault root (Obsidian's FileSystemAdapter#getBasePath()).
 * @returns {{ canvasPort: number, bridgePort: number, baseUrl: string }}
 */
function deriveWeaverPorts(vaultBasePath) {
    // Normalize path separators and case so the same vault always hashes
    // the same way regardless of how the OS/adapter happened to report the
    // path this run (Windows paths are case-insensitive; getBasePath()'s
    // slash direction has been observed to vary across Obsidian versions).
    const normalized = String(vaultBasePath || '').toLowerCase().replaceAll('\\', '/');
    const offset = stableHash(normalized) % CANVAS_PORT_RANGE;
    const canvasPort = CANVAS_PORT_BASE + offset;
    const bridgePort = canvasPort + BRIDGE_PORT_OFFSET;
    return { canvasPort, bridgePort, baseUrl: `http://127.0.0.1:${canvasPort}/` };
}

module.exports = { deriveWeaverPorts, stableHash, CANVAS_PORT_BASE, CANVAS_PORT_RANGE, BRIDGE_PORT_OFFSET };
